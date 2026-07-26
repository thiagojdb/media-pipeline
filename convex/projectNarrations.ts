import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { editableProject, readableProject } from "./projects";

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

export const enqueue = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    scriptVersionId: v.id("scriptVersions"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const script = await ctx.db.get(args.scriptVersionId);
    if (!script || script.projectId !== project._id) {
      throw new Error("Script version was not found.");
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("narrationJobs", {
      channelId: project.channelId,
      projectId: project._id,
      scriptVersionId: script._id,
      createdByMembershipId: project.membership._id,
      kind: "generated",
      provider: "relay-fake-tts",
      model: "deterministic-wave-v1",
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
      "Narration generation queued.",
    );
    return { jobId };
  },
});

export const prepareUpload = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    fileName: v.string(),
    mediaType: v.string(),
    byteSize: v.number(),
  },
  handler: async (ctx, args) => {
    await editableProject(ctx, args);
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
    storageId: v.id("_storage"),
    fileName: v.string(),
    mediaType: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
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
      createdByMembershipId: project.membership._id,
      kind: "upload",
      sourceStorageId: args.storageId,
      sourceFileName: bounded(args.fileName, MAX_FILE_NAME),
      sourceMediaType: mediaType,
      provider: "relay-upload",
      model: "ffprobe",
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
      "Narration upload queued for metadata probing.",
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
      versions: await Promise.all(
        versions.map(async (version) => ({
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

export const claim = mutation({
  args: { workerToken: v.string(), workerId: v.string(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const now = Date.now();
    const job = await ctx.db
      .query("narrationJobs")
      .withIndex("by_state_created", (q) => q.eq("state", "queued"))
      .first();
    if (!job) return null;
    const script = job.scriptVersionId
      ? await ctx.db.get(job.scriptVersionId)
      : null;
    const kind = job.kind ?? "generated";
    if (kind === "generated" && !script) {
      await finishFailure(
        ctx,
        job._id,
        "failed",
        "script_missing",
        "The selected script version is unavailable.",
      );
      return null;
    }
    const leaseMs = validLease(args.leaseMs);
    const workerId = bounded(args.workerId, 120);
    const claimed = {
      state: "running" as const,
      attempt: job.attempt + 1,
      leaseOwner: workerId,
      leaseExpiresAt: now + leaseMs,
      heartbeatAt: now,
      updatedAt: now,
    };
    await ctx.db.patch(job._id, claimed);
    await event(ctx, job._id, "running", "claimed", "Narration job claimed.");
    const sourceUrl =
      kind === "upload" && job.sourceStorageId
        ? await ctx.storage.getUrl(job.sourceStorageId)
        : null;
    if (kind === "upload" && !sourceUrl) {
      await finishFailure(
        ctx,
        job._id,
        "failed",
        "upload_missing",
        "The uploaded narration audio is unavailable.",
      );
      return null;
    }
    return {
      ...job,
      ...claimed,
      kind,
      scriptContent: script?.content,
      sourceUrl,
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
    )
      return false;
    await ctx.db.patch(job._id, {
      heartbeatAt: now,
      leaseExpiresAt: now + validLease(args.leaseMs),
      updatedAt: now,
    });
    return true;
  },
});

export const createUploadUrl = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("narrationJobs"),
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
    jobId: v.id("narrationJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    storageId: v.id("_storage"),
    durationMs: v.number(),
    timingSegments: v.array(timingSegment),
    usageCharacters: v.number(),
    estimatedCostUsd: v.number(),
    wallTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ownedJob(ctx, args);
    if ((job.kind ?? "generated") !== "generated" || !job.scriptVersionId) {
      throw new Error("This narration job is not generated audio.");
    }
    if (job.cancelRequested) {
      throw new Error("Canceled narration cannot publish a version.");
    }
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (
      !metadata ||
      metadata.size < 44 ||
      (metadata.contentType &&
        metadata.contentType.split(";", 1)[0]?.toLowerCase() !== "audio/wav")
    ) {
      throw new Error("Generated narration audio is invalid.");
    }
    validateResult(args.durationMs, args.timingSegments);
    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("Project was not found.");
    const version = (project.currentNarrationVersionNumber ?? 0) + 1;
    const narrationVersionId = await ctx.db.insert("narrationVersions", {
      channelId: job.channelId,
      projectId: job.projectId,
      scriptVersionId: job.scriptVersionId,
      createdByMembershipId: job.createdByMembershipId,
      version,
      provenance: "generated",
      storageId: args.storageId,
      mediaType: "audio/wav",
      durationMs: args.durationMs,
      timingSegments: args.timingSegments,
      provider: job.provider,
      model: job.model,
      usageCharacters: validCount(args.usageCharacters),
      estimatedCostUsd: validMoney(args.estimatedCostUsd),
      wallTimeMs: validCount(args.wallTimeMs),
      createdAt: Date.now(),
    });
    await ctx.db.patch(project._id, {
      currentNarrationVersionId: narrationVersionId,
      currentNarrationVersionNumber: version,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(job._id, {
      state: "succeeded",
      narrationVersionId,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      terminalCode: "narration_generated",
      terminalMessage: "Narration generated with timing.",
      updatedAt: Date.now(),
    });
    await event(
      ctx,
      job._id,
      "succeeded",
      "terminal",
      "Narration generated with timing.",
    );
    return { narrationVersionId, version };
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
    wallTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const job = await ownedJob(ctx, args);
    if (job.kind !== "upload" || !job.sourceStorageId || !job.sourceFileName) {
      throw new Error("This narration job is not uploaded audio.");
    }
    if (job.cancelRequested) {
      throw new Error("Canceled narration cannot publish a version.");
    }
    if (!Number.isSafeInteger(args.durationMs) || args.durationMs < 100) {
      throw new Error("Narration duration is invalid.");
    }
    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("Project was not found.");
    const version = (project.currentNarrationVersionNumber ?? 0) + 1;
    const narrationVersionId = await ctx.db.insert("narrationVersions", {
      channelId: job.channelId,
      projectId: job.projectId,
      createdByMembershipId: job.createdByMembershipId,
      version,
      provenance: "upload",
      storageId: job.sourceStorageId,
      mediaType: normalizedMediaType(args.mediaType),
      durationMs: args.durationMs,
      timingSegments: [],
      provider: job.provider,
      model: job.model,
      fileName: job.sourceFileName,
      audioCodec: bounded(args.audioCodec, 80),
      sampleRate: validPositive(args.sampleRate, "sampleRate"),
      channels: validPositive(args.channels, "channels"),
      wallTimeMs: validCount(args.wallTimeMs),
      createdAt: Date.now(),
    });
    await ctx.db.patch(project._id, {
      currentNarrationVersionId: narrationVersionId,
      currentNarrationVersionNumber: version,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(job._id, {
      state: "succeeded",
      narrationVersionId,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      terminalCode: "narration_probed",
      terminalMessage: "Uploaded narration probed and ready.",
      updatedAt: Date.now(),
    });
    await event(
      ctx,
      job._id,
      "succeeded",
      "terminal",
      "Uploaded narration probed and ready.",
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
    const state = job.cancelRequested ? "canceled" : args.state;
    await finishFailure(
      ctx,
      job._id,
      state,
      bounded(args.code, 80),
      bounded(args.message, 500),
    );
    return true;
  },
});

export const recoverExpired = mutation({
  args: { workerToken: v.string() },
  handler: async (ctx, args) => {
    authorizeWorker(args.workerToken);
    const now = Date.now();
    const expired = await ctx.db
      .query("narrationJobs")
      .withIndex("by_state_lease", (q) =>
        q.eq("state", "running").lte("leaseExpiresAt", now),
      )
      .take(25);
    for (const job of expired) {
      const retry = !job.cancelRequested && job.attempt < job.maxAttempts;
      const state = job.cancelRequested
        ? "canceled"
        : retry
          ? "queued"
          : "needs_intervention";
      await ctx.db.patch(job._id, {
        state,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        terminalCode: retry ? undefined : "lease_expired",
        terminalMessage: retry
          ? undefined
          : "Narration worker lease expired and retries were exhausted.",
        updatedAt: now,
      });
      await event(
        ctx,
        job._id,
        state,
        "lease_recovered",
        retry
          ? "Expired narration job returned to the queue."
          : "Expired narration job reached a recoverable terminal state.",
      );
    }
    return expired.length;
  },
});

type WorkerLease = {
  jobId: Id<"narrationJobs">;
  workerId: string;
  leaseAttempt: number;
};

async function ownedJob(ctx: MutationCtx, args: WorkerLease) {
  const job = await ctx.db.get(args.jobId);
  if (
    !job ||
    job.leaseOwner !== args.workerId ||
    job.attempt !== args.leaseAttempt ||
    !job.leaseExpiresAt ||
    job.leaseExpiresAt <= Date.now() ||
    terminal(job.state)
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
  if (
    !process.env.NARRATION_WORKER_TOKEN ||
    token !== process.env.NARRATION_WORKER_TOKEN
  ) {
    throw new Error("Narration worker authorization failed.");
  }
}

function terminal(state: string) {
  return ["succeeded", "failed", "canceled", "needs_intervention"].includes(
    state,
  );
}

function validLease(value: number) {
  if (!Number.isSafeInteger(value) || value < 5_000 || value > 120_000) {
    throw new Error("leaseMs is invalid.");
  }
  return value;
}

function bounded(value: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error("Narration worker value is invalid.");
  }
  return normalized;
}

function validCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Narration telemetry is invalid.");
  }
  return value;
}

function validMoney(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Narration cost telemetry is invalid.");
  }
  return value;
}

function validPositive(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validateUpload(fileName: string, mediaType: string, byteSize: number) {
  bounded(fileName, MAX_FILE_NAME);
  if (!UPLOAD_MEDIA_TYPES.has(normalizedMediaType(mediaType))) {
    throw new Error("This narration audio type is not supported.");
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 44) {
    throw new Error("The narration audio file is empty or invalid.");
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    throw new Error(
      "The narration audio file is larger than the 100 MB limit.",
    );
  }
}

function normalizedMediaType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function validateResult(
  durationMs: number,
  segments: readonly {
    index: number;
    startMs: number;
    endMs: number;
    text: string;
  }[],
) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 100) {
    throw new Error("Narration duration is invalid.");
  }
  if (!segments.length || segments.length > 500) {
    throw new Error("Narration timing is invalid.");
  }
  let cursor = 0;
  for (const [index, segment] of segments.entries()) {
    if (
      segment.index !== index ||
      segment.startMs < cursor ||
      segment.endMs <= segment.startMs ||
      segment.endMs > durationMs ||
      !segment.text.trim() ||
      segment.text.length > 2_000
    ) {
      throw new Error("Narration timing is invalid.");
    }
    cursor = segment.endMs;
  }
}
