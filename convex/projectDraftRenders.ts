import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import type { ProjectComposition } from "./projectCompositionSchema";
import { projectCompositionSchema } from "./projectCompositionSchema";
import { editableProject, readableProject } from "./projects";

const accessArgs = {
  serverToken: v.string(),
  identitySubject: v.string(),
  channelId: v.id("channels"),
};
const terminalState = v.union(
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("needs_intervention"),
);
const DRAFT_MAX_WIDTH = 640;
const DRAFT_MAX_HEIGHT = 360;
const MAX_ATTEMPTS = 2;

export const enqueue = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    range: v.optional(v.object({ startMs: v.number(), endMs: v.number() })),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    if (!project.currentCompositionVersionId) {
      throw new Error("Save a composition before rendering a draft.");
    }
    const compositionVersion = await ctx.db.get(
      project.currentCompositionVersionId,
    );
    if (!compositionVersion)
      throw new Error("Composition version was not found.");
    const composition = projectCompositionSchema.parse(
      JSON.parse(compositionVersion.compositionJson),
    );
    const narration = await ctx.db.get(compositionVersion.narrationVersionId);
    if (!narration) throw new Error("Pinned narration was not found.");
    const range = args.range ?? { startMs: 0, endMs: narration.durationMs };
    validateRange(range, narration.durationMs);
    const dimensions = draftDimensions(composition.width, composition.height);
    const now = Date.now();
    const jobId = await ctx.db.insert("projectRenderJobs", {
      channelId: project.channelId,
      projectId: project._id,
      compositionVersionId: compositionVersion._id,
      narrationVersionId: narration._id,
      createdByMembershipId: project.membership._id,
      rangeKind: args.range ? "selection" : "full",
      rangeStartMs: range.startMs,
      rangeEndMs: range.endMs,
      width: dimensions.width,
      height: dimensions.height,
      fps: composition.fps,
      state: "queued",
      progress: 0,
      attempt: 0,
      maxAttempts: MAX_ATTEMPTS,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    });
    await event(
      ctx,
      jobId,
      "queued",
      "enqueued",
      "Project draft render queued.",
    );
    return { jobId };
  },
});

export const list = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    const jobs = await ctx.db
      .query("projectRenderJobs")
      .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(20);
    return Promise.all(
      jobs.map(async (job) => ({
        ...job,
        outputUrl:
          job.state === "succeeded" && job.outputStorageId
            ? await ctx.storage.getUrl(job.outputStorageId)
            : null,
      })),
    );
  },
});

export const requestCancel = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    jobId: v.id("projectRenderJobs"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.projectId !== project._id) {
      throw new Error("Project render job was not found.");
    }
    if (terminal(job.state)) return { jobId: job._id };
    const now = Date.now();
    if (job.state === "queued") {
      await ctx.db.patch(job._id, {
        state: "canceled",
        cancelRequested: true,
        terminalCode: "render_canceled",
        terminalMessage: "Draft render canceled by the creator.",
        updatedAt: now,
      });
      await event(
        ctx,
        job._id,
        "canceled",
        "terminal",
        "Draft render canceled by the creator.",
      );
    } else {
      await ctx.db.patch(job._id, { cancelRequested: true, updatedAt: now });
    }
    return { jobId: job._id };
  },
});

export const claim = mutation({
  args: { workerToken: v.string(), workerId: v.string(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ctx.db
      .query("projectRenderJobs")
      .withIndex("by_state_created", (q) => q.eq("state", "queued"))
      .first();
    if (!job) return null;
    if (job.cancelRequested) {
      await finishFailure(
        ctx,
        job._id,
        "canceled",
        "render_canceled",
        "Draft render canceled by the creator.",
      );
      return null;
    }
    const compositionVersion = await ctx.db.get(job.compositionVersionId);
    const narration = await ctx.db.get(job.narrationVersionId);
    const narrationUrl = narration
      ? await ctx.storage.getUrl(narration.storageId)
      : null;
    if (!compositionVersion || !narration || !narrationUrl) {
      await finishFailure(
        ctx,
        job._id,
        "failed",
        "render_inputs_missing",
        "Pinned render inputs are unavailable.",
      );
      return null;
    }
    const composition = projectCompositionSchema.parse(
      JSON.parse(compositionVersion.compositionJson),
    );
    const segments = await materializeSegments(ctx, composition);
    const now = Date.now();
    const claimed = {
      state: "running" as const,
      progress: 0,
      attempt: job.attempt + 1,
      leaseOwner: bounded(args.workerId, 120),
      leaseExpiresAt: now + validLease(args.leaseMs),
      heartbeatAt: now,
      updatedAt: now,
    };
    await ctx.db.patch(job._id, claimed);
    await event(ctx, job._id, "running", "claimed", "Project render claimed.");
    return {
      ...job,
      ...claimed,
      composition: { ...composition, segments },
      narrationUrl,
    };
  },
});

export const heartbeat = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("projectRenderJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    leaseMs: v.number(),
    progress: v.number(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (
      !job ||
      job.state !== "running" ||
      job.leaseOwner !== args.workerId ||
      job.attempt !== args.leaseAttempt ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= now
    ) {
      return { owned: false, cancelRequested: true };
    }
    await ctx.db.patch(job._id, {
      progress: Math.min(0.99, Math.max(0, args.progress)),
      heartbeatAt: now,
      leaseExpiresAt: now + validLease(args.leaseMs),
      updatedAt: now,
    });
    return { owned: true, cancelRequested: job.cancelRequested };
  },
});

export const createUploadUrl = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("projectRenderJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    await ownedJob(ctx, args);
    return ctx.storage.generateUploadUrl();
  },
});

export const complete = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("projectRenderJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    storageId: v.id("_storage"),
    sizeBytes: v.number(),
    contentHash: v.string(),
    visualFingerprint: v.string(),
    wallTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ownedJob(ctx, args);
    if (job.cancelRequested) throw new Error("Canceled render cannot publish.");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (
      !metadata ||
      metadata.size !== args.sizeBytes ||
      (metadata.contentType &&
        metadata.contentType.split(";", 1)[0]?.toLowerCase() !== "video/mp4")
    ) {
      throw new Error("Rendered MP4 storage metadata is invalid.");
    }
    const now = Date.now();
    await ctx.db.patch(job._id, {
      state: "succeeded",
      progress: 1,
      outputStorageId: args.storageId,
      outputSizeBytes: args.sizeBytes,
      outputContentHash: hash(args.contentHash),
      visualFingerprint: hash(args.visualFingerprint),
      wallTimeMs: validCount(args.wallTimeMs),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      terminalCode: "render_succeeded",
      terminalMessage: "Draft MP4 rendered with pinned narration.",
      updatedAt: now,
    });
    await event(
      ctx,
      job._id,
      "succeeded",
      "terminal",
      "Draft MP4 rendered with pinned narration.",
    );
    return { jobId: job._id };
  },
});

export const fail = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("projectRenderJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    state: terminalState,
    code: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    await ownedJob(ctx, args);
    await finishFailure(
      ctx,
      args.jobId,
      args.state,
      bounded(args.code, 100),
      bounded(args.message, 500),
    );
    return { jobId: args.jobId };
  },
});

export const recoverExpired = mutation({
  args: { workerToken: v.string() },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const now = Date.now();
    const expired = await ctx.db
      .query("projectRenderJobs")
      .withIndex("by_state_lease", (q) =>
        q.eq("state", "running").lt("leaseExpiresAt", now),
      )
      .collect();
    for (const job of expired) {
      if (job.cancelRequested) {
        await finishFailure(
          ctx,
          job._id,
          "canceled",
          "render_canceled",
          "Draft render canceled during worker recovery.",
        );
      } else if (job.attempt < job.maxAttempts) {
        await ctx.db.patch(job._id, {
          state: "queued",
          progress: 0,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
        await event(
          ctx,
          job._id,
          "queued",
          "recovered",
          "Expired project render lease recovered for retry.",
        );
      } else {
        await finishFailure(
          ctx,
          job._id,
          "needs_intervention",
          "render_attempts_exhausted",
          "Draft render needs intervention after bounded worker retries.",
        );
      }
    }
    return { recovered: expired.length };
  },
});

async function materializeSegments(
  ctx: MutationCtx,
  composition: ProjectComposition,
) {
  return Promise.all(
    composition.segments.map(async (segment) => {
      if (segment.kind === "component") {
        const id = ctx.db.normalizeId(
          "componentVersions",
          segment.componentVersionId,
        );
        const version = id ? await ctx.db.get(id) : null;
        if (!version)
          throw new Error("Pinned component version is unavailable.");
        return {
          ...segment,
          componentId: version.componentId,
          componentVersion: version.version,
        };
      }
      const id = ctx.db.normalizeId("projectSources", segment.sourceId);
      const source = id ? await ctx.db.get(id) : null;
      if (!source) throw new Error("Pinned project media is unavailable.");
      const sourceUrl = source.storageId
        ? await ctx.storage.getUrl(source.storageId)
        : source.normalizedUrl;
      if (!sourceUrl)
        throw new Error("Pinned project media has no source URL.");
      return { ...segment, sourceUrl, mediaType: source.mediaType };
    }),
  );
}

async function ownedJob(
  ctx: MutationCtx,
  args: {
    jobId: Id<"projectRenderJobs">;
    workerId: string;
    leaseAttempt: number;
  },
) {
  const job = await ctx.db.get(args.jobId);
  if (
    !job ||
    job.state !== "running" ||
    job.leaseOwner !== args.workerId ||
    job.attempt !== args.leaseAttempt ||
    !job.leaseExpiresAt ||
    job.leaseExpiresAt <= Date.now()
  ) {
    throw new Error("Project render lease is stale.");
  }
  return job;
}

async function finishFailure(
  ctx: MutationCtx,
  jobId: Id<"projectRenderJobs">,
  state: "failed" | "canceled" | "needs_intervention",
  code: string,
  message: string,
) {
  await ctx.db.patch(jobId, {
    state,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    terminalCode: code,
    terminalMessage: message,
    updatedAt: Date.now(),
  });
  await event(ctx, jobId, state, "terminal", message);
}

function event(
  ctx: MutationCtx,
  jobId: Id<"projectRenderJobs">,
  state:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"
    | "needs_intervention",
  kind: string,
  message: string,
) {
  return ctx.db.insert("projectRenderJobEvents", {
    jobId,
    state,
    kind,
    message,
    createdAt: Date.now(),
  });
}

function validateRange(
  range: { startMs: number; endMs: number },
  durationMs: number,
) {
  if (
    !Number.isSafeInteger(range.startMs) ||
    !Number.isSafeInteger(range.endMs) ||
    range.startMs < 0 ||
    range.endMs <= range.startMs ||
    range.endMs > durationMs
  ) {
    throw new Error("Draft range must be within the pinned narration.");
  }
}

function draftDimensions(width: number, height: number) {
  const scale = Math.min(DRAFT_MAX_WIDTH / width, DRAFT_MAX_HEIGHT / height, 1);
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

function validLease(value: number) {
  if (!Number.isFinite(value)) return 30_000;
  return Math.min(120_000, Math.max(5_000, Math.floor(value)));
}

function validCount(value: number) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum);
}

function hash(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Render hash is invalid.");
  return value.toLowerCase();
}

function terminal(state: string) {
  return ["succeeded", "failed", "canceled", "needs_intervention"].includes(
    state,
  );
}

function authorizeWorker(token: string) {
  const expected = process.env.NARRATION_WORKER_TOKEN;
  if (!expected || token !== expected) throw new Error("Worker unauthorized.");
}
