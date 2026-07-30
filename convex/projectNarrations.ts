import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { editableProject, readableProject } from "./projects";

const accessArgs = {
  serverToken: v.string(),
  identitySubject: v.string(),
  channelId: v.id("channels"),
};
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_FILE_NAME = 255;
const UPLOAD_MEDIA_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
]);
const workerState = v.union(
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("needs_intervention"),
);
const timingSegment = v.object({
  index: v.number(),
  startMs: v.number(),
  endMs: v.number(),
  text: v.string(),
});
const wordTiming = v.object({
  index: v.number(),
  word: v.string(),
  startMs: v.number(),
  endMs: v.number(),
  cueIndex: v.optional(v.number()),
  planWordIndex: v.optional(v.number()),
  match: v.union(
    v.literal("exact"),
    v.literal("substitution"),
    v.literal("insertion"),
  ),
});

export const prepareUpload = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    planVersionId: v.id("narrationPlanVersions"),
    fileName: v.string(),
    mediaType: v.string(),
    byteSize: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    await approvedPlan(ctx, project._id, args.planVersionId);
    validateUpload(args.fileName, args.mediaType, args.byteSize);
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      maximumBytes: MAX_UPLOAD_BYTES,
    };
  },
});

export const enqueueUpload = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    planVersionId: v.id("narrationPlanVersions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mediaType: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const plan = await approvedPlan(ctx, project._id, args.planVersionId);
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("The uploaded narration was not found.");
    const mediaType = normalizedMediaType(args.mediaType);
    validateUpload(args.fileName, mediaType, metadata.size);
    if (
      metadata.contentType &&
      normalizedMediaType(metadata.contentType) !== mediaType
    ) {
      throw new Error(
        "The uploaded narration type does not match its declaration.",
      );
    }
    const existing = await ctx.db
      .query("narrationJobs")
      .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
      .filter((q) => q.eq(q.field("sourceStorageId"), args.storageId))
      .first();
    if (existing) throw new Error("This narration upload is already queued.");
    const now = Date.now();
    const jobId = await ctx.db.insert("narrationJobs", {
      channelId: project.channelId,
      projectId: project._id,
      planVersionId: plan._id,
      scriptVersionId: plan.scriptVersionId,
      createdByMembershipId: project.membership._id,
      kind: "upload",
      sourceStorageId: args.storageId,
      sourceFileName: bounded(args.fileName, MAX_FILE_NAME),
      sourceMediaType: mediaType,
      provider: "pending-alignment",
      model: "pending-alignment",
      state: "queued",
      attempt: 0,
      maxAttempts: 2,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    });
    await event(
      ctx,
      jobId,
      "queued",
      "enqueued",
      "Narration take queued for word alignment.",
    );
    return { jobId };
  },
});

export const list = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    const [versions, jobs] = await Promise.all([
      ctx.db
        .query("narrationVersions")
        .withIndex("by_project_version", (q) => q.eq("projectId", project._id))
        .order("desc")
        .collect(),
      ctx.db
        .query("narrationJobs")
        .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
        .order("desc")
        .take(20),
    ]);
    return {
      currentNarrationVersionId: project.currentNarrationVersionId ?? null,
      versions: await Promise.all(
        versions
          .filter((version) => version.planVersionId)
          .map(async (version) => ({
            ...version,
            audioUrl: await ctx.storage.getUrl(version.storageId),
          })),
      ),
      jobs,
    };
  },
});

export const requestCancel = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    jobId: v.id("narrationJobs"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.projectId !== project._id) {
      throw new Error("Narration job was not found.");
    }
    if (terminal(job.state)) return { jobId: job._id };
    await ctx.db.patch(job._id, {
      cancelRequested: true,
      updatedAt: Date.now(),
    });
    return { jobId: job._id };
  },
});

export const approveAlignment = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    narrationVersionId: v.id("narrationVersions"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const version = await ctx.db.get(args.narrationVersionId);
    if (
      !version ||
      version.projectId !== project._id ||
      !version.planVersionId
    ) {
      throw new Error("Narration version was not found.");
    }
    if (!version.wordTimings?.length) {
      throw new Error("Narration needs word timing before approval.");
    }
    const now = Date.now();
    await ctx.db.patch(version._id, { alignmentState: "approved" });
    await ctx.db.patch(project._id, {
      currentNarrationVersionId: version._id,
      currentNarrationVersionNumber: version.version,
      updatedAt: now,
    });
    return { narrationVersionId: version._id, version: version.version };
  },
});

export const claim = mutation({
  args: { workerToken: v.string(), workerId: v.string(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ctx.db
      .query("narrationJobs")
      .withIndex("by_state_created", (q) => q.eq("state", "queued"))
      .first();
    if (!job) return null;
    if (
      job.kind !== "upload" ||
      !job.sourceStorageId ||
      !job.sourceFileName ||
      !job.sourceMediaType ||
      !job.planVersionId
    ) {
      await finishFailure(
        ctx,
        job._id,
        "failed",
        "invalid_alignment_job",
        "Narration alignment inputs are incomplete.",
      );
      return null;
    }
    const [plan, sourceUrl] = await Promise.all([
      ctx.db.get(job.planVersionId),
      ctx.storage.getUrl(job.sourceStorageId),
    ]);
    if (!plan || plan.state !== "approved" || !sourceUrl) {
      await finishFailure(
        ctx,
        job._id,
        "failed",
        "alignment_inputs_missing",
        "The approved narration plan or audio take is unavailable.",
      );
      return null;
    }
    const now = Date.now();
    const leaseMs = validLease(args.leaseMs);
    const claimed = {
      state: "running" as const,
      attempt: job.attempt + 1,
      leaseOwner: bounded(args.workerId, 120),
      leaseExpiresAt: now + leaseMs,
      heartbeatAt: now,
      updatedAt: now,
    };
    await ctx.db.patch(job._id, claimed);
    await event(
      ctx,
      job._id,
      "running",
      "claimed",
      "Narration alignment claimed.",
    );
    await ctx.scheduler.runAt(
      claimed.leaseExpiresAt,
      internal.projectNarrations.recoverLease,
      { jobId: job._id, leaseAttempt: claimed.attempt },
    );
    return {
      ...job,
      ...claimed,
      sourceUrl,
      plan: {
        _id: plan._id,
        cues: plan.cues,
      },
    };
  },
});

export const getForWorker = query({
  args: { workerToken: v.string(), jobId: v.id("narrationJobs") },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    return ctx.db.get(args.jobId);
  },
});

export const heartbeat = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("narrationJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    leaseMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (
      !job ||
      job.leaseOwner !== args.workerId ||
      job.attempt !== args.leaseAttempt ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= now ||
      terminal(job.state)
    ) {
      return false;
    }
    await ctx.db.patch(job._id, {
      heartbeatAt: now,
      leaseExpiresAt: now + validLease(args.leaseMs),
      updatedAt: now,
    });
    return true;
  },
});

export const completeUpload = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("narrationJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    durationMs: v.number(),
    mediaType: v.string(),
    audioCodec: v.string(),
    sampleRate: v.number(),
    channels: v.number(),
    transcript: v.string(),
    timingSegments: v.array(timingSegment),
    wordTimings: v.array(wordTiming),
    omittedWordCount: v.number(),
    insertedWordCount: v.number(),
    substitutedWordCount: v.number(),
    provider: v.string(),
    model: v.string(),
    wallTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ownedJob(ctx, args);
    if (
      job.kind !== "upload" ||
      !job.sourceStorageId ||
      !job.sourceFileName ||
      !job.planVersionId
    ) {
      throw new Error("This narration job is not an uploaded take.");
    }
    if (job.cancelRequested) {
      throw new Error("Canceled narration cannot publish a version.");
    }
    validateAlignment(args.durationMs, args.timingSegments, args.wordTimings);
    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("Project was not found.");
    const latest = await ctx.db
      .query("narrationVersions")
      .withIndex("by_project_version", (q) => q.eq("projectId", job.projectId))
      .order("desc")
      .first();
    const version = (latest?.version ?? 0) + 1;
    const narrationVersionId = await ctx.db.insert("narrationVersions", {
      channelId: job.channelId,
      projectId: job.projectId,
      scriptVersionId: job.scriptVersionId,
      planVersionId: job.planVersionId,
      createdByMembershipId: job.createdByMembershipId,
      version,
      provenance: "upload",
      storageId: job.sourceStorageId,
      mediaType: normalizedMediaType(args.mediaType),
      durationMs: args.durationMs,
      alignmentState: "reviewable",
      transcript: bounded(args.transcript, 100_000),
      wordTimings: args.wordTimings,
      timingSegments: args.timingSegments,
      omittedWordCount: validCount(args.omittedWordCount),
      insertedWordCount: validCount(args.insertedWordCount),
      substitutedWordCount: validCount(args.substitutedWordCount),
      provider: bounded(args.provider, 120),
      model: bounded(args.model, 120),
      fileName: job.sourceFileName,
      audioCodec: bounded(args.audioCodec, 60),
      sampleRate: validCount(args.sampleRate),
      channels: validCount(args.channels),
      wallTimeMs: validCount(args.wallTimeMs),
      createdAt: Date.now(),
    });
    await ctx.db.patch(job._id, {
      state: "succeeded",
      provider: bounded(args.provider, 120),
      model: bounded(args.model, 120),
      narrationVersionId,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      terminalCode: "narration_aligned",
      terminalMessage: "Narration take aligned with word timing.",
      updatedAt: Date.now(),
    });
    await event(
      ctx,
      job._id,
      "succeeded",
      "terminal",
      "Narration take aligned with word timing.",
    );
    return { narrationVersionId, version };
  },
});

export const fail = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("narrationJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    state: workerState,
    code: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ownedJob(ctx, args);
    await finishFailure(
      ctx,
      args.jobId,
      job.cancelRequested ? "canceled" : args.state,
      bounded(args.code, 120),
      bounded(args.message, 500),
    );
    return { jobId: args.jobId };
  },
});

export const recoverLease = internalMutation({
  args: {
    jobId: v.id("narrationJobs"),
    leaseAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.state !== "running" ||
      job.attempt !== args.leaseAttempt ||
      !job.leaseExpiresAt
    ) {
      return null;
    }
    const now = Date.now();
    if (job.leaseExpiresAt > now) {
      await ctx.scheduler.runAt(
        job.leaseExpiresAt,
        internal.projectNarrations.recoverLease,
        args,
      );
      return null;
    }
    if (job.cancelRequested) {
      await finishFailure(
        ctx,
        job._id,
        "canceled",
        "narration_canceled",
        "Narration alignment canceled.",
      );
    } else if (job.attempt < job.maxAttempts) {
      await ctx.db.patch(job._id, {
        state: "queued",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        heartbeatAt: undefined,
        updatedAt: now,
      });
      await event(
        ctx,
        job._id,
        "queued",
        "recovered",
        "Expired narration alignment returned to the queue.",
      );
    } else {
      await finishFailure(
        ctx,
        job._id,
        "needs_intervention",
        "alignment_attempts_exhausted",
        "Narration alignment retries were exhausted.",
      );
    }
    return null;
  },
});

async function approvedPlan(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  planVersionId: Id<"narrationPlanVersions">,
) {
  const plan = await ctx.db.get(planVersionId);
  if (!plan || plan.projectId !== projectId || plan.state !== "approved") {
    throw new Error("An approved narration plan is required.");
  }
  return plan;
}

async function ownedJob(
  ctx: MutationCtx,
  args: {
    jobId: Id<"narrationJobs">;
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
    throw new Error("Narration lease is not owned or has expired.");
  }
  return job;
}

async function finishFailure(
  ctx: MutationCtx,
  jobId: Id<"narrationJobs">,
  state: "failed" | "canceled" | "needs_intervention",
  code: string,
  message: string,
) {
  await ctx.db.patch(jobId, {
    state,
    terminalCode: code,
    terminalMessage: message,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    updatedAt: Date.now(),
  });
  await event(ctx, jobId, state, "terminal", message);
}

async function event(
  ctx: MutationCtx,
  jobId: Id<"narrationJobs">,
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
  await ctx.db.insert("narrationJobEvents", {
    jobId,
    state,
    kind,
    message,
    createdAt: Date.now(),
  });
}

function authorizeWorker(token: string) {
  const expected = process.env.NARRATION_WORKER_TOKEN;
  if (!expected || token !== expected) {
    throw new Error("Narration worker authorization failed.");
  }
}

function validateUpload(fileName: string, mediaType: string, byteSize: number) {
  bounded(fileName, MAX_FILE_NAME);
  if (!UPLOAD_MEDIA_TYPES.has(normalizedMediaType(mediaType))) {
    throw new Error("This narration audio type is not supported.");
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) {
    throw new Error("The narration audio file is empty or invalid.");
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    throw new Error(
      "The narration audio file is larger than the 100 MB limit.",
    );
  }
}

function validateAlignment(
  durationMs: number,
  segments: Array<{ startMs: number; endMs: number }>,
  words: Array<{ startMs: number; endMs: number; word: string }>,
) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 100) {
    throw new Error("Narration duration is invalid.");
  }
  if (!words.length) throw new Error("Narration word timing is required.");
  let cursor = 0;
  for (const [index, word] of words.entries()) {
    if (
      !word.word.trim() ||
      !Number.isSafeInteger(word.startMs) ||
      !Number.isSafeInteger(word.endMs) ||
      word.startMs < cursor ||
      word.endMs <= word.startMs ||
      word.endMs > durationMs
    ) {
      throw new Error(`Narration word ${index + 1} has invalid timing.`);
    }
    cursor = word.endMs;
  }
  cursor = 0;
  for (const [index, segment] of segments.entries()) {
    if (
      !Number.isSafeInteger(segment.startMs) ||
      !Number.isSafeInteger(segment.endMs) ||
      segment.startMs < cursor ||
      segment.endMs <= segment.startMs ||
      segment.endMs > durationMs
    ) {
      throw new Error(`Narration cue ${index + 1} has invalid timing.`);
    }
    cursor = segment.endMs;
  }
}

function validLease(value: number) {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 120_000) {
    throw new Error("Narration lease is invalid.");
  }
  return value;
}

function validCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Narration worker value is invalid.");
  }
  return value;
}

function normalizedMediaType(value: string) {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function bounded(value: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error("Narration worker value is invalid.");
  }
  return normalized;
}

function terminal(state: string) {
  return ["succeeded", "failed", "canceled", "needs_intervention"].includes(
    state,
  );
}
