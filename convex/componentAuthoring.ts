import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";

const MAX_SOURCE_BYTES = 256_000;
const MAX_CONTEXT_TEXT = 64_000;
const MAX_SUMMARY = 2_000;
const credentialLikeValue =
  /(?:\bBearer\s+\S+|\bsk-[a-z0-9_-]{8,}|(?:^|[\s?&])(?:api_?key|signature|token)=[^&\s]+)/i;
const authoringState = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("candidate_submitted"),
  v.literal("failed"),
  v.literal("needs_intervention"),
  v.literal("canceled"),
);

const budgets = {
  maxWallTimeMs: v.number(),
  maxModelTurns: v.number(),
  maxToolCalls: v.number(),
  maxTokens: v.number(),
  maxCostUsd: v.number(),
};

export const enqueue = internalMutation({
  args: {
    channelId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    userRequest: v.string(),
    acceptanceCriteria: v.array(v.string()),
    baseSource: v.string(),
    baseSourceHash: v.string(),
    parentCandidateId: v.optional(v.string()),
    baseSnapshotId: v.optional(v.string()),
    channelThemeJson: v.string(),
    assetsMetadataJson: v.string(),
    priorSummaries: v.array(v.string()),
    maxAttempts: v.number(),
    maxRepairAttempts: v.optional(v.number()),
    ...budgets,
  },
  handler: async (ctx, args) => {
    boundedId(args.channelId, "channelId");
    boundedId(args.threadId, "threadId");
    boundedId(args.turnId, "turnId");
    rejectCredentialLikeText(
      bounded(args.userRequest, "userRequest", 8_000),
      "userRequest",
    );
    boundedSource(args.baseSource);
    hash(args.baseSourceHash, "baseSourceHash");
    bounded(args.channelThemeJson, "channelThemeJson", MAX_CONTEXT_TEXT);
    bounded(args.assetsMetadataJson, "assetsMetadataJson", MAX_CONTEXT_TEXT);
    for (const item of args.acceptanceCriteria)
      rejectCredentialLikeText(
        bounded(item, "acceptanceCriterion", 1_000),
        "acceptanceCriterion",
      );
    if (args.acceptanceCriteria.length > 30)
      throw new Error("Too many acceptance criteria.");
    for (const item of args.priorSummaries)
      rejectCredentialLikeText(
        bounded(item, "priorSummary", MAX_SUMMARY),
        "priorSummary",
      );
    if (args.priorSummaries.length > 20)
      throw new Error("Too many prior summaries.");
    validateBudgets(args);
    integerRange(args.maxRepairAttempts ?? 2, "maxRepairAttempts", 0, 3);
    if (args.maxAttempts !== 1)
      throw new Error(
        "Authoring turns allow exactly one paid-capable attempt; creators must explicitly enqueue another turn to retry.",
      );

    const existing = await ctx.db
      .query("authoringTurns")
      .withIndex("by_channel_thread_turn", (q) =>
        q
          .eq("channelId", args.channelId)
          .eq("threadId", args.threadId)
          .eq("turnId", args.turnId),
      )
      .unique();
    if (existing) {
      if (
        existing.baseSource !== args.baseSource ||
        existing.baseSourceHash !== args.baseSourceHash ||
        existing.userRequest !== args.userRequest ||
        JSON.stringify(existing.acceptanceCriteria) !==
          JSON.stringify(args.acceptanceCriteria) ||
        existing.parentCandidateId !== args.parentCandidateId ||
        existing.baseSnapshotId !== args.baseSnapshotId ||
        existing.channelThemeJson !== args.channelThemeJson ||
        existing.assetsMetadataJson !== args.assetsMetadataJson ||
        JSON.stringify(existing.priorSummaries) !==
          JSON.stringify(args.priorSummaries) ||
        existing.maxAttempts !== args.maxAttempts ||
        existing.maxWallTimeMs !== args.maxWallTimeMs ||
        existing.maxModelTurns !== args.maxModelTurns ||
        existing.maxToolCalls !== args.maxToolCalls ||
        existing.maxTokens !== args.maxTokens ||
        existing.maxCostUsd !== args.maxCostUsd ||
        (existing.maxRepairAttempts ?? 2) !== (args.maxRepairAttempts ?? 2)
      )
        throw new Error("This authoring turn already has different inputs.");
      return existing._id;
    }

    const previousTurn = await ctx.db
      .query("authoringTurns")
      .withIndex("by_channel_thread_created", (q) =>
        q.eq("channelId", args.channelId).eq("threadId", args.threadId),
      )
      .order("desc")
      .first();
    const now = Date.now();
    const thread = await ctx.db
      .query("authoringThreads")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", args.channelId).eq("threadId", args.threadId),
      )
      .unique();
    if (!thread) {
      await ctx.db.insert("authoringThreads", {
        channelId: args.channelId,
        threadId: args.threadId,
        createdAt: now,
        updatedAt: now,
        latestTurnId: args.turnId,
      });
    } else {
      await ctx.db.patch(thread._id, {
        updatedAt: now,
        latestTurnId: args.turnId,
      });
    }
    const id = await ctx.db.insert("authoringTurns", {
      ...args,
      rootTurnId: args.turnId,
      repairAttempt: 0,
      maxRepairAttempts: args.maxRepairAttempts ?? 2,
      sessionRef: previousTurn?.sessionRef,
      state: "queued",
      attempt: 0,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    });
    await event(ctx, id, now, "enqueued", "queued", "Authoring turn queued.");
    return id;
  },
});

export const claim = mutation({
  args: { workerToken: v.string(), workerId: v.string(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const turn = await ctx.db
      .query("authoringTurns")
      .withIndex("by_state_created", (q) => q.eq("state", "queued"))
      .first();
    if (!turn) return null;
    const threadTurns = await ctx.db
      .query("authoringTurns")
      .withIndex("by_channel_thread_created", (q) =>
        q.eq("channelId", turn.channelId).eq("threadId", turn.threadId),
      )
      .order("desc")
      .take(100);
    const sessionRef = threadTurns.find(
      (candidate) => candidate._id !== turn._id && candidate.sessionRef,
    )?.sessionRef;
    const now = Date.now();
    const leaseOwner = bounded(args.workerId, "workerId", 120);
    const leaseExpiresAt = now + boundedLease(args.leaseMs);
    const attempt = turn.attempt + 1;
    await ctx.db.patch(turn._id, {
      state: "running",
      attempt,
      leaseOwner,
      leaseExpiresAt,
      heartbeatAt: now,
      sessionRef: sessionRef ?? turn.sessionRef,
      updatedAt: now,
    });
    await event(
      ctx,
      turn._id,
      now,
      "claimed",
      "running",
      "Authoring turn claimed.",
    );
    return {
      ...turn,
      state: "running" as const,
      attempt,
      leaseOwner,
      leaseExpiresAt,
      heartbeatAt: now,
      sessionRef: sessionRef ?? turn.sessionRef,
      updatedAt: now,
    };
  },
});

export const heartbeat = mutation({
  args: {
    workerToken: v.string(),
    turnId: v.id("authoringTurns"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    leaseMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const turn = await ctx.db.get(args.turnId);
    const now = Date.now();
    if (!ownsLiveLease(turn, args.workerId, args.leaseAttempt, now))
      return false;
    await ctx.db.patch(args.turnId, {
      heartbeatAt: now,
      leaseExpiresAt: now + boundedLease(args.leaseMs),
      updatedAt: now,
    });
    return true;
  },
});

export const recordActivity = mutation({
  args: {
    workerToken: v.string(),
    turnId: v.id("authoringTurns"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    sequence: v.number(),
    name: v.string(),
    status: v.string(),
    inputSummary: v.string(),
    outputSummary: v.string(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const turn = await ctx.db.get(args.turnId);
    if (!ownsLiveLease(turn, args.workerId, args.leaseAttempt, Date.now()))
      throw new Error("Authoring lease is not owned or expired.");
    if (
      !Number.isInteger(args.sequence) ||
      args.sequence < 1 ||
      args.sequence > turn.maxToolCalls
    )
      throw new Error("Tool sequence exceeds budget.");
    const previous = await ctx.db
      .query("authoringToolActivities")
      .withIndex("by_turn_attempt_sequence", (q) =>
        q.eq("turnId", args.turnId).eq("attempt", args.leaseAttempt),
      )
      .order("desc")
      .first();
    if (previous && args.sequence <= previous.sequence)
      throw new Error("Tool activity sequence must increase monotonically.");
    const now = Date.now();
    await ctx.db.insert("authoringToolActivities", {
      turnId: args.turnId,
      attempt: args.leaseAttempt,
      sequence: args.sequence,
      createdAt: now,
      name: bounded(args.name, "toolName", 80),
      status: bounded(args.status, "toolStatus", 40),
      inputSummary: bounded(args.inputSummary, "inputSummary", 1_000),
      outputSummary: bounded(args.outputSummary, "outputSummary", 1_000),
      durationMs: Math.max(0, Math.floor(args.durationMs)),
    });
    await ctx.db.patch(args.turnId, {
      toolCalls: Math.max(turn.toolCalls ?? 0, args.sequence),
      updatedAt: now,
    });
  },
});

export const recordUsage = mutation({
  args: {
    workerToken: v.string(),
    turnId: v.id("authoringTurns"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    toolCalls: v.number(),
    modelTurns: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    costUsd: v.number(),
    wallTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const turn = await ctx.db.get(args.turnId);
    if (!ownsLiveLease(turn, args.workerId, args.leaseAttempt, Date.now()))
      throw new Error("Authoring lease is not owned or expired.");
    validateUsage(turn, args, false);
    for (const [name, amount] of Object.entries({
      toolCalls: args.toolCalls,
      modelTurns: args.modelTurns,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: args.cacheReadTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      costUsd: args.costUsd,
      wallTimeMs: args.wallTimeMs,
    })) {
      const previous = Number(turn[name as keyof typeof turn] ?? 0);
      if (amount < previous) throw new Error(`${name} cannot decrease.`);
    }
    await ctx.db.patch(args.turnId, {
      toolCalls: args.toolCalls,
      modelTurns: args.modelTurns,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: args.cacheReadTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      costUsd: args.costUsd,
      wallTimeMs: args.wallTimeMs,
      updatedAt: Date.now(),
    });
  },
});

export const submitCandidate = mutation({
  args: {
    workerToken: v.string(),
    turnId: v.id("authoringTurns"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    candidateSource: v.string(),
    candidateSourceHash: v.string(),
    contextHash: v.string(),
    sessionRef: v.optional(v.string()),
    assistantSummary: v.string(),
    toolCalls: v.number(),
    modelTurns: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    costUsd: v.number(),
    wallTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const turn = await ctx.db.get(args.turnId);
    if (!turn) throw new Error("Authoring turn not found.");
    if (turn.buildJobId) {
      if (
        turn.candidateSourceHash !== args.candidateSourceHash ||
        turn.contextHash !== args.contextHash
      )
        throw new Error(
          "Authoring turn already submitted a different candidate.",
        );
      return turn.buildJobId;
    }
    const now = Date.now();
    if (!ownsLiveLease(turn, args.workerId, args.leaseAttempt, now))
      throw new Error("Authoring lease is not owned or expired.");
    if (turn.cancelRequested)
      throw new Error("Canceled turn cannot submit a candidate.");
    boundedSource(args.candidateSource);
    hash(args.candidateSourceHash, "candidateSourceHash");
    hash(args.contextHash, "contextHash");
    bounded(args.assistantSummary, "assistantSummary", MAX_SUMMARY);
    validateUsage(turn, args);

    const existingBuild = await ctx.db
      .query("componentBuildJobs")
      .withIndex("by_channel_thread_turn", (q) =>
        q
          .eq("channelId", turn.channelId)
          .eq("threadId", turn.threadId)
          .eq("turnId", turn.turnId),
      )
      .unique();
    let jobId: Doc<"componentBuildJobs">["_id"];
    if (existingBuild) {
      if (
        existingBuild.sourceHash !== args.candidateSourceHash ||
        existingBuild.sourceSnapshot !== args.candidateSource
      )
        throw new Error("This turn already has a different validation job.");
      jobId = existingBuild._id;
    } else {
      jobId = await ctx.db.insert("componentBuildJobs", {
        channelId: turn.channelId,
        threadId: turn.threadId,
        turnId: turn.turnId,
        parentCandidateId: turn.parentCandidateId,
        baseSnapshotId: turn.baseSnapshotId,
        sourceSnapshot: args.candidateSource,
        sourceHash: args.candidateSourceHash,
        state: "queued",
        attempt: 0,
        maxAttempts: 2,
        repairAttempt: turn.repairAttempt ?? 0,
        maxRepairAttempts: turn.maxRepairAttempts ?? 2,
        cancelRequested: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("componentBuildEvents", {
        jobId,
        createdAt: now,
        kind: "enqueued_from_authoring",
        state: "queued",
        message: "Candidate queued for independent component-build validation.",
      });
    }
    await ctx.db.patch(args.turnId, {
      state: "candidate_submitted",
      updatedAt: now,
      contextHash: args.contextHash,
      sessionRef: args.sessionRef,
      assistantSummary: args.assistantSummary,
      toolCalls: args.toolCalls,
      modelTurns: args.modelTurns,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: args.cacheReadTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      costUsd: args.costUsd,
      wallTimeMs: args.wallTimeMs,
      candidateSourceHash: args.candidateSourceHash,
      buildJobId: jobId,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    await event(
      ctx,
      args.turnId,
      now,
      "candidate_submitted",
      "candidate_submitted",
      "Candidate submitted for independent validation; it is not approved.",
    );
    return jobId;
  },
});

export const finish = mutation({
  args: {
    workerToken: v.string(),
    turnId: v.id("authoringTurns"),
    workerId: v.string(),
    leaseAttempt: v.number(),
    state: authoringState,
    code: v.string(),
    message: v.string(),
    assistantSummary: v.optional(v.string()),
    sessionRef: v.optional(v.string()),
    toolCalls: v.number(),
    modelTurns: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    costUsd: v.number(),
    wallTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    if (
      args.state !== "failed" &&
      args.state !== "needs_intervention" &&
      args.state !== "canceled"
    )
      throw new Error("Invalid terminal authoring state.");
    const turn = await ctx.db.get(args.turnId);
    if (
      !turn ||
      !ownsLiveLease(turn, args.workerId, args.leaseAttempt, Date.now())
    )
      throw new Error("Authoring lease is not owned or expired.");
    validateUsage(turn, args, false);
    const now = Date.now();
    await ctx.db.patch(args.turnId, {
      state: args.state,
      updatedAt: now,
      terminalCode: bounded(args.code, "terminalCode", 80),
      terminalMessage: bounded(args.message, "terminalMessage", 1_000),
      assistantSummary: args.assistantSummary
        ? bounded(args.assistantSummary, "assistantSummary", MAX_SUMMARY)
        : undefined,
      sessionRef: args.sessionRef,
      toolCalls: args.toolCalls,
      modelTurns: args.modelTurns,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: args.cacheReadTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      costUsd: args.costUsd,
      wallTimeMs: args.wallTimeMs,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    await event(ctx, args.turnId, now, "terminal", args.state, args.message);
  },
});

export const requestCancel = internalMutation({
  args: { turnId: v.id("authoringTurns") },
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn || terminal(turn.state)) return false;
    await ctx.db.patch(args.turnId, {
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
    const expired = await ctx.db
      .query("authoringTurns")
      .withIndex("by_state_lease", (q) =>
        q.eq("state", "running").lte("leaseExpiresAt", now),
      )
      .take(25);
    for (const turn of expired) {
      const retry = !turn.cancelRequested && turn.attempt < turn.maxAttempts;
      const state = turn.cancelRequested
        ? "canceled"
        : retry
          ? "queued"
          : "needs_intervention";
      await ctx.db.patch(turn._id, {
        state,
        updatedAt: now,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        terminalCode: retry
          ? undefined
          : turn.cancelRequested
            ? "authoring_canceled"
            : "lease_expired",
        terminalMessage: retry
          ? undefined
          : turn.cancelRequested
            ? "Authoring turn canceled after its lease expired."
            : "Authoring lease expired and attempt budget was exhausted.",
      });
      await event(
        ctx,
        turn._id,
        now,
        "lease_recovered",
        state,
        retry
          ? "Expired authoring lease requeued."
          : "Expired authoring lease became terminal.",
      );
    }
    return expired.length;
  },
});

export const getForWorker = query({
  args: { workerToken: v.string(), turnId: v.id("authoringTurns") },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    return ctx.db.get(args.turnId);
  },
});

export const getSafeTurn = internalQuery({
  args: { turnId: v.id("authoringTurns") },
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    return turn ? safeTurn(turn) : null;
  },
});

export const listSafeThread = internalQuery({
  args: { channelId: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    const turns = await ctx.db
      .query("authoringTurns")
      .withIndex("by_channel_thread_created", (q) =>
        q.eq("channelId", args.channelId).eq("threadId", args.threadId),
      )
      .order("desc")
      .take(100);
    return turns.reverse().map(safeTurn);
  },
});

export const listSafeEvents = internalQuery({
  args: { turnId: v.id("authoringTurns") },
  handler: (ctx, args) =>
    ctx.db
      .query("authoringEvents")
      .withIndex("by_turn_created", (q) => q.eq("turnId", args.turnId))
      .order("asc")
      .take(200),
});

export const listSafeActivities = internalQuery({
  args: { turnId: v.id("authoringTurns") },
  handler: (ctx, args) =>
    ctx.db
      .query("authoringToolActivities")
      .withIndex("by_turn_attempt_sequence", (q) => q.eq("turnId", args.turnId))
      .order("asc")
      .take(100),
});

function safeTurn(turn: Doc<"authoringTurns">) {
  return {
    id: turn._id,
    channelId: turn.channelId,
    threadId: turn.threadId,
    turnId: turn.turnId,
    userRequest: turn.userRequest,
    acceptanceCriteria: turn.acceptanceCriteria,
    parentCandidateId: turn.parentCandidateId,
    baseSnapshotId: turn.baseSnapshotId,
    state: turn.state,
    attempt: turn.attempt,
    maxAttempts: turn.maxAttempts,
    cancelRequested: turn.cancelRequested,
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
    contextHash: turn.contextHash,
    assistantSummary: turn.assistantSummary,
    toolCalls: turn.toolCalls,
    modelTurns: turn.modelTurns,
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
    cacheReadTokens: turn.cacheReadTokens,
    cacheWriteTokens: turn.cacheWriteTokens,
    costUsd: turn.costUsd,
    wallTimeMs: turn.wallTimeMs,
    terminalCode: turn.terminalCode,
    terminalMessage: turn.terminalMessage,
    candidateSourceHash: turn.candidateSourceHash,
    buildJobId: turn.buildJobId,
    rootTurnId: turn.rootTurnId ?? turn.turnId,
    repairAttempt: turn.repairAttempt ?? 0,
    maxRepairAttempts: turn.maxRepairAttempts ?? 2,
    validationEvidenceJson: turn.validationEvidenceJson,
  };
}

function authorize(token: string) {
  const expected = process.env.AUTHORING_WORKER_TOKEN;
  if (!expected || token !== expected)
    throw new Error("Authoring worker authorization failed.");
}
function ownsLiveLease(
  turn: Doc<"authoringTurns"> | null,
  workerId: string,
  attempt: number,
  now: number,
): turn is Doc<"authoringTurns"> {
  return Boolean(
    turn &&
    turn.state === "running" &&
    turn.leaseOwner === workerId &&
    turn.attempt === attempt &&
    turn.leaseExpiresAt &&
    turn.leaseExpiresAt > now,
  );
}
function terminal(state: string) {
  return [
    "candidate_submitted",
    "failed",
    "needs_intervention",
    "canceled",
  ].includes(state);
}
function validateBudgets(value: {
  maxWallTimeMs: number;
  maxModelTurns: number;
  maxToolCalls: number;
  maxTokens: number;
  maxCostUsd: number;
}) {
  integerRange(value.maxWallTimeMs, "maxWallTimeMs", 1_000, 300_000);
  integerRange(value.maxModelTurns, "maxModelTurns", 1, 12);
  integerRange(value.maxToolCalls, "maxToolCalls", 1, 30);
  integerRange(value.maxTokens, "maxTokens", 100, 100_000);
  if (
    !Number.isFinite(value.maxCostUsd) ||
    value.maxCostUsd < 0 ||
    value.maxCostUsd > 10
  )
    throw new Error("maxCostUsd is invalid.");
}
function validateUsage(
  turn: Doc<"authoringTurns">,
  value: {
    toolCalls: number;
    modelTurns: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    wallTimeMs: number;
  },
  enforceBudgets = true,
) {
  for (const [name, amount] of Object.entries({
    toolCalls: value.toolCalls,
    modelTurns: value.modelTurns,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cacheReadTokens: value.cacheReadTokens,
    cacheWriteTokens: value.cacheWriteTokens,
    costUsd: value.costUsd,
    wallTimeMs: value.wallTimeMs,
  })) {
    if (!Number.isFinite(amount) || amount < 0)
      throw new Error(`${name} is invalid.`);
  }
  if (!enforceBudgets) return;
  if (value.toolCalls > turn.maxToolCalls)
    throw new Error("Tool-call budget exceeded.");
  if (value.modelTurns > turn.maxModelTurns)
    throw new Error("Model-turn budget exceeded.");
  if (
    value.inputTokens +
      value.outputTokens +
      value.cacheReadTokens +
      value.cacheWriteTokens >
    turn.maxTokens
  )
    throw new Error("Token budget exceeded.");
  if (value.costUsd > turn.maxCostUsd) throw new Error("Cost budget exceeded.");
  if (value.wallTimeMs > turn.maxWallTimeMs)
    throw new Error("Wall-time budget exceeded.");
}
function rejectCredentialLikeText(value: string, name: string) {
  if (credentialLikeValue.test(value))
    throw new Error(`${name} contains a credential-like value.`);
  return value;
}
function bounded(value: string, name: string, max: number) {
  if (!value || value.length > max) throw new Error(`${name} is invalid.`);
  return value;
}
function boundedId(value: string, name: string) {
  return bounded(value, name, 200);
}
function boundedSource(value: string) {
  if (!value || new TextEncoder().encode(value).byteLength > MAX_SOURCE_BYTES)
    throw new Error("Source must be between 1 byte and 256 KB.");
}
function hash(value: string, name: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} is invalid.`);
}
function integerRange(value: number, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} is invalid.`);
}
function boundedLease(value: number) {
  if (!Number.isFinite(value)) throw new Error("leaseMs is invalid.");
  return Math.min(120_000, Math.max(5_000, Math.floor(value)));
}
async function event(
  ctx: {
    db: {
      insert: (
        table: "authoringEvents",
        value: {
          turnId: Doc<"authoringTurns">["_id"];
          createdAt: number;
          kind: string;
          state: string;
          message: string;
        },
      ) => Promise<unknown>;
    };
  },
  turnId: Doc<"authoringTurns">["_id"],
  createdAt: number,
  kind: string,
  state: string,
  message: string,
) {
  await ctx.db.insert("authoringEvents", {
    turnId,
    createdAt,
    kind,
    state,
    message: bounded(message, "eventMessage", 1_000),
  });
}
