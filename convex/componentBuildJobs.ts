import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";

const state = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("validating"),
  v.literal("failed"),
  v.literal("needs_intervention"),
  v.literal("succeeded"),
  v.literal("canceled"),
);

const MAX_SOURCE_BYTES = 256_000;
const MAX_TEXT = 500;

export const enqueue = internalMutation({
  args: {
    channelId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    parentCandidateId: v.optional(v.string()),
    baseSnapshotId: v.optional(v.string()),
    sourceSnapshot: v.string(),
    sourceHash: v.string(),
    maxAttempts: v.number(),
  },
  handler: async (ctx, args) => {
    for (const [name, value] of Object.entries({
      channelId: args.channelId,
      threadId: args.threadId,
      turnId: args.turnId,
      sourceHash: args.sourceHash,
    })) {
      if (!value || value.length > 200) throw new Error(`${name} is invalid.`);
    }
    if (
      new TextEncoder().encode(args.sourceSnapshot).byteLength >
      MAX_SOURCE_BYTES
    )
      throw new Error("sourceSnapshot exceeds 256 KB.");
    if (
      !Number.isInteger(args.maxAttempts) ||
      args.maxAttempts < 1 ||
      args.maxAttempts > 3
    )
      throw new Error("maxAttempts must be between 1 and 3.");
    for (const [name, value] of Object.entries({
      parentCandidateId: args.parentCandidateId,
      baseSnapshotId: args.baseSnapshotId,
    })) {
      if (value !== undefined) bounded(value, name, 200);
    }
    if (!/^[a-f0-9]{64}$/.test(args.sourceHash))
      throw new Error("sourceHash is invalid.");
    const existing = await ctx.db
      .query("componentBuildJobs")
      .withIndex("by_channel_thread_turn", (q) =>
        q
          .eq("channelId", args.channelId)
          .eq("threadId", args.threadId)
          .eq("turnId", args.turnId),
      )
      .unique();
    if (existing) {
      if (
        existing.sourceHash !== args.sourceHash ||
        existing.parentCandidateId !== args.parentCandidateId ||
        existing.baseSnapshotId !== args.baseSnapshotId
      )
        throw new Error("This component-build turn already has another job.");
      return existing._id;
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("componentBuildJobs", {
      ...args,
      state: "queued",
      attempt: 0,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("componentBuildEvents", {
      jobId,
      createdAt: now,
      kind: "enqueued",
      state: "queued",
      message: "Component build queued.",
    });
    return jobId;
  },
});

export const claim = mutation({
  args: { workerToken: v.string(), workerId: v.string(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const now = Date.now();
    const job = await ctx.db
      .query("componentBuildJobs")
      .withIndex("by_state_created", (q) => q.eq("state", "queued"))
      .first();
    if (!job) return null;
    const leaseMs = boundedLease(args.leaseMs);
    const leaseOwner = bounded(args.workerId, "workerId", 120);
    const leaseExpiresAt = now + leaseMs;
    await ctx.db.patch(job._id, {
      state: "running",
      attempt: job.attempt + 1,
      leaseOwner,
      leaseExpiresAt,
      heartbeatAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("componentBuildEvents", {
      jobId: job._id,
      createdAt: now,
      kind: "claimed",
      state: "running",
      message: "Build claimed by worker.",
    });
    return {
      ...job,
      state: "running" as const,
      attempt: job.attempt + 1,
      leaseOwner,
      leaseExpiresAt,
      heartbeatAt: now,
      updatedAt: now,
    };
  },
});

export const heartbeat = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("componentBuildJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    leaseMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (
      !job ||
      job.leaseOwner !== args.workerId ||
      job.attempt !== args.leaseAttempt ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= now ||
      isTerminal(job.state)
    )
      return false;
    await ctx.db.patch(args.jobId, {
      heartbeatAt: now,
      leaseExpiresAt: now + boundedLease(args.leaseMs),
      updatedAt: now,
    });
    return true;
  },
});

export const transition = mutation({
  args: {
    workerToken: v.string(),
    jobId: v.id("componentBuildJobs"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    nextState: state,
    code: v.optional(v.string()),
    message: v.string(),
    candidateRef: v.optional(v.string()),
    stdout: v.optional(v.string()),
    stderr: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Build job not found.");
    const now = Date.now();
    if (
      job.leaseOwner !== args.workerId ||
      job.attempt !== args.leaseAttempt ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= now
    )
      throw new Error("Build lease is not owned or has expired.");
    if (job.cancelRequested && args.nextState === "succeeded")
      throw new Error("Canceled build cannot publish a candidate.");
    if (args.nextState === "succeeded" && !args.candidateRef)
      throw new Error("Successful build requires a candidate reference.");
    if (!allowedTransition(job.state, args.nextState))
      throw new Error("Invalid build state transition.");
    const message = bounded(args.message, "message", MAX_TEXT);
    const terminal = isTerminal(args.nextState);
    const stdout = boundedLog(args.stdout);
    const stderr = boundedLog(args.stderr);
    await ctx.db.patch(args.jobId, {
      state: args.nextState,
      updatedAt: now,
      terminalCode: terminal ? boundedOptional(args.code, 80) : undefined,
      terminalMessage: terminal ? message : undefined,
      candidateRef:
        args.nextState === "succeeded"
          ? boundedOptional(args.candidateRef, 200)
          : undefined,
      boundedStdout: terminal ? stdout : undefined,
      boundedStderr: terminal ? stderr : undefined,
      leaseOwner: terminal ? undefined : job.leaseOwner,
      leaseExpiresAt: terminal ? undefined : job.leaseExpiresAt,
    });
    await ctx.db.insert("componentBuildEvents", {
      jobId: args.jobId,
      createdAt: now,
      kind: terminal ? "terminal" : "transition",
      state: args.nextState,
      message,
    });
    return true;
  },
});

export const requestCancel = mutation({
  args: { workerToken: v.string(), jobId: v.id("componentBuildJobs") },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    if (!job || isTerminal(job.state)) return false;
    await ctx.db.patch(args.jobId, {
      cancelRequested: true,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const recoverExpired = mutation({
  args: { workerToken: v.string() },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const now = Date.now();
    const [running, validating] = await Promise.all([
      ctx.db
        .query("componentBuildJobs")
        .withIndex("by_state_lease", (q) =>
          q.eq("state", "running").lte("leaseExpiresAt", now),
        )
        .take(25),
      ctx.db
        .query("componentBuildJobs")
        .withIndex("by_state_lease", (q) =>
          q.eq("state", "validating").lte("leaseExpiresAt", now),
        )
        .take(25),
    ]);
    let recovered = 0;
    for (const job of [...running, ...validating]) {
      if (
        !job.leaseExpiresAt ||
        isTerminal(job.state) ||
        job.state === "queued"
      )
        continue;
      const canRetry = !job.cancelRequested && job.attempt < job.maxAttempts;
      const nextState = job.cancelRequested
        ? "canceled"
        : canRetry
          ? "queued"
          : "needs_intervention";
      await ctx.db.patch(job._id, {
        state: nextState,
        updatedAt: now,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        terminalCode: job.cancelRequested
          ? "build_canceled"
          : canRetry
            ? undefined
            : "lease_expired",
        terminalMessage: job.cancelRequested
          ? "Component build canceled after its worker lease expired."
          : canRetry
            ? undefined
            : "Worker lease expired and retry budget was exhausted.",
      });
      await ctx.db.insert("componentBuildEvents", {
        jobId: job._id,
        createdAt: now,
        kind: "lease_recovered",
        state: nextState,
        message: canRetry
          ? "Expired lease returned to queue."
          : "Expired lease reached a terminal state.",
      });
      recovered += 1;
    }
    return recovered;
  },
});

export const getForWorker = query({
  args: { workerToken: v.string(), jobId: v.id("componentBuildJobs") },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    return ctx.db.get(args.jobId);
  },
});

export const getSafeStatus = internalQuery({
  args: { jobId: v.id("componentBuildJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    return job ? safeJob(job) : null;
  },
});

export const listSafeForThread = internalQuery({
  args: { channelId: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("componentBuildJobs")
      .withIndex("by_channel_thread_created", (q) =>
        q.eq("channelId", args.channelId).eq("threadId", args.threadId),
      )
      .order("desc")
      .take(100);
    return jobs.reverse().map(safeJob);
  },
});

export const listSafeEvents = internalQuery({
  args: { jobId: v.id("componentBuildJobs") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("componentBuildEvents")
      .withIndex("by_job_created", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(100);
  },
});

function safeJob(job: Doc<"componentBuildJobs">) {
  return {
    id: job._id,
    channelId: job.channelId,
    threadId: job.threadId,
    turnId: job.turnId,
    parentCandidateId: job.parentCandidateId,
    baseSnapshotId: job.baseSnapshotId,
    state: job.state,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    cancelRequested: job.cancelRequested,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    terminalCode: job.terminalCode,
    terminalMessage: job.terminalMessage,
    candidateRef: job.candidateRef,
  };
}

function authorize(token: string): void {
  const expected = process.env.COMPONENT_BUILD_WORKER_TOKEN;
  if (!expected || token !== expected)
    throw new Error("Worker authorization failed.");
}

function bounded(value: string, name: string, maximum: number): string {
  if (!value || value.length > maximum) throw new Error(`${name} is invalid.`);
  return value;
}
function boundedOptional(
  value: string | undefined,
  maximum: number,
): string | undefined {
  return value === undefined ? undefined : bounded(value, "value", maximum);
}
function boundedLog(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > 64_000) throw new Error("Build log exceeds 64 KB.");
  return value;
}
function boundedLease(value: number): number {
  if (!Number.isFinite(value)) throw new Error("leaseMs is invalid.");
  return Math.min(120_000, Math.max(5_000, Math.floor(value)));
}
function isTerminal(value: string): boolean {
  return ["failed", "needs_intervention", "succeeded", "canceled"].includes(
    value,
  );
}
function allowedTransition(from: string, to: string): boolean {
  const allowed: Record<string, readonly string[]> = {
    running: ["validating", "failed", "needs_intervention", "canceled"],
    validating: ["succeeded", "failed", "needs_intervention", "canceled"],
  };
  return allowed[from]?.includes(to) ?? false;
}
