import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const budgetArgs = {
  maxWallTimeMs: v.number(),
  maxModelTurns: v.number(),
  maxToolCalls: v.number(),
  maxTokens: v.number(),
  maxCostUsd: v.number(),
};

export const start = mutation({
  args: {
    workerToken: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    userRequest: v.string(),
    acceptanceCriteria: v.array(v.string()),
    baseSource: v.string(),
    baseSourceHash: v.string(),
    channelThemeJson: v.string(),
    assetsMetadataJson: v.string(),
    ...budgetArgs,
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const channelId = bounded(args.channelId, "channelId", 200);
    const threadId = bounded(args.threadId, "threadId", 200);
    const turnId = bounded(args.turnId, "turnId", 200);
    const userRequest = bounded(args.userRequest, "userRequest", 8_000);
    rejectCredentialText(userRequest, "userRequest");
    if (!/^[a-f0-9]{64}$/.test(args.baseSourceHash))
      throw new Error("baseSourceHash is invalid.");
    if (!args.baseSource || args.baseSource.length > 256_000)
      throw new Error("baseSource is invalid.");
    if (
      args.acceptanceCriteria.length < 1 ||
      args.acceptanceCriteria.length > 30
    )
      throw new Error("Acceptance criteria are invalid.");
    args.acceptanceCriteria.forEach((item) => {
      const criterion = bounded(item, "acceptanceCriterion", 1_000);
      rejectCredentialText(criterion, "acceptanceCriterion");
    });
    const channelThemeJson = bounded(
      args.channelThemeJson,
      "channelThemeJson",
      64_000,
    );
    const assetsMetadataJson = bounded(
      args.assetsMetadataJson,
      "assetsMetadataJson",
      64_000,
    );
    rejectCredentialObject(parseJson(channelThemeJson, "channelThemeJson"));
    rejectCredentialObject(parseJson(assetsMetadataJson, "assetsMetadataJson"));
    validateBudgets(args);

    const existing = await ctx.db
      .query("authoringTurns")
      .withIndex("by_channel_thread_turn", (q) =>
        q
          .eq("channelId", channelId)
          .eq("threadId", threadId)
          .eq("turnId", turnId),
      )
      .unique();
    if (existing) {
      if (
        existing.userRequest !== userRequest ||
        existing.baseSourceHash !== args.baseSourceHash ||
        existing.channelThemeJson !== channelThemeJson ||
        existing.assetsMetadataJson !== assetsMetadataJson
      )
        throw new Error("This creator turn already has different inputs.");
      return existing._id;
    }
    const now = Date.now();
    const thread = await ctx.db
      .query("authoringThreads")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", channelId).eq("threadId", threadId),
      )
      .unique();
    if (!thread) {
      await ctx.db.insert("authoringThreads", {
        channelId,
        threadId,
        createdAt: now,
        updatedAt: now,
        latestTurnId: turnId,
      });
    } else {
      await ctx.db.patch(thread._id, { updatedAt: now, latestTurnId: turnId });
    }
    const authoringTurnId = await ctx.db.insert("authoringTurns", {
      channelId,
      threadId,
      turnId,
      rootTurnId: turnId,
      repairAttempt: 0,
      maxRepairAttempts: 2,
      userRequest,
      acceptanceCriteria: args.acceptanceCriteria,
      baseSource: args.baseSource,
      baseSourceHash: args.baseSourceHash,
      channelThemeJson,
      assetsMetadataJson,
      priorSummaries: [],
      state: "queued",
      attempt: 0,
      maxAttempts: 1,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
      maxWallTimeMs: args.maxWallTimeMs,
      maxModelTurns: args.maxModelTurns,
      maxToolCalls: args.maxToolCalls,
      maxTokens: args.maxTokens,
      maxCostUsd: args.maxCostUsd,
    });
    await ctx.db.insert("authoringEvents", {
      turnId: authoringTurnId,
      createdAt: now,
      kind: "creator_request",
      state: "queued",
      message: "Creator request queued for bounded component authoring.",
    });
    return authoringTurnId;
  },
});

export const status = query({
  args: {
    workerToken: v.string(),
    channelId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const turns = await ctx.db
      .query("authoringTurns")
      .withIndex("by_channel_thread_created", (q) =>
        q.eq("channelId", args.channelId).eq("threadId", args.threadId),
      )
      .order("asc")
      .take(100);
    const builds = await ctx.db
      .query("componentBuildJobs")
      .withIndex("by_channel_thread_created", (q) =>
        q.eq("channelId", args.channelId).eq("threadId", args.threadId),
      )
      .order("asc")
      .take(100);
    const activities = (
      await Promise.all(
        turns.map((turn) =>
          ctx.db
            .query("authoringToolActivities")
            .withIndex("by_turn_attempt_sequence", (q) =>
              q.eq("turnId", turn._id),
            )
            .order("asc")
            .take(100),
        ),
      )
    ).flat();
    const threadCandidateIds = new Set(
      builds.flatMap((build) =>
        build.candidateId ? [String(build.candidateId)] : [],
      ),
    );
    const candidates = (
      await ctx.db
        .query("componentCandidates")
        .withIndex("by_channel_component_created", (q) =>
          q
            .eq("channelId", args.channelId)
            .eq("componentId", "animated-line-chart"),
        )
        .order("asc")
        .take(100)
    ).filter((candidate) => threadCandidateIds.has(String(candidate._id)));
    const versions = await ctx.db
      .query("componentVersions")
      .withIndex("by_channel_component_approved", (q) =>
        q
          .eq("channelId", args.channelId)
          .eq("componentId", "animated-line-chart"),
      )
      .order("asc")
      .take(100);
    const approvedVersions = new Set(
      versions.map((version) => version.version),
    );
    return {
      channelId: args.channelId,
      threadId: args.threadId,
      turns: turns.map((turn) => ({
        id: turn._id,
        turnId: turn.turnId,
        userRequest: turn.userRequest,
        state: turn.state,
        repairAttempt: turn.repairAttempt ?? 0,
        attempt: turn.attempt,
        toolCalls: turn.toolCalls ?? 0,
        modelTurns: turn.modelTurns ?? 0,
        inputTokens: turn.inputTokens ?? 0,
        outputTokens: turn.outputTokens ?? 0,
        costUsd: turn.costUsd ?? 0,
        wallTimeMs: turn.wallTimeMs ?? 0,
        terminalCode: turn.terminalCode,
        terminalMessage: turn.terminalMessage,
        buildJobId: turn.buildJobId,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
      })),
      activities: activities.map((activity) => ({
        turnId: activity.turnId,
        sequence: activity.sequence,
        name: activity.name,
        status: activity.status,
        outputSummary: activity.outputSummary,
        durationMs: activity.durationMs,
      })),
      builds: builds.map((build) => ({
        id: build._id,
        turnId: build.turnId,
        state: build.state,
        attempt: build.attempt,
        repairAttempt: build.repairAttempt ?? 0,
        terminalCode: build.terminalCode,
        terminalMessage: build.terminalMessage,
        candidateId: build.candidateId,
        validationEvidence: build.validationEvidenceJson
          ? JSON.parse(build.validationEvidenceJson)
          : undefined,
        createdAt: build.createdAt,
        updatedAt: build.updatedAt,
      })),
      candidates: candidates.map((candidate) => ({
        id: candidate._id,
        componentId: candidate.componentId,
        version: candidate.declaredVersion,
        status: candidate.status,
        versionAlreadyApproved: approvedVersions.has(candidate.declaredVersion),
        baseVersionId: candidate.baseVersionId,
        compatibilityWarning: candidate.compatibilityWarning,
        decisionNote: candidate.decisionNote,
        validationEvidence: JSON.parse(candidate.validationEvidenceJson),
        fixtures: JSON.parse(candidate.fixturesJson),
        dimensions: JSON.parse(candidate.dimensionsJson),
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      })),
      versions: versions.map((version) => ({
        id: version._id,
        componentId: version.componentId,
        version: version.version,
        previousVersionId: version.previousVersionId,
        approvedAt: version.approvedAt,
        sourceHash: version.sourceHash,
        candidateRef: version.candidateRef,
      })),
    };
  },
});

function authorize(token: string): void {
  const expected = process.env.COMPONENT_LOOP_WORKER_TOKEN;
  if (!expected || token !== expected)
    throw new Error("Component-loop worker authorization failed.");
}
function bounded(value: string, name: string, maximum: number): string {
  if (!value || value.length > maximum) throw new Error(`${name} is invalid.`);
  return value;
}
function validateBudgets(value: {
  maxWallTimeMs: number;
  maxModelTurns: number;
  maxToolCalls: number;
  maxTokens: number;
  maxCostUsd: number;
}) {
  if (
    !Number.isInteger(value.maxWallTimeMs) ||
    value.maxWallTimeMs < 1_000 ||
    value.maxWallTimeMs > 300_000 ||
    !Number.isInteger(value.maxModelTurns) ||
    value.maxModelTurns < 1 ||
    value.maxModelTurns > 12 ||
    !Number.isInteger(value.maxToolCalls) ||
    value.maxToolCalls < 4 ||
    value.maxToolCalls > 30 ||
    !Number.isInteger(value.maxTokens) ||
    value.maxTokens < 100 ||
    value.maxTokens > 100_000 ||
    !Number.isFinite(value.maxCostUsd) ||
    value.maxCostUsd < 0 ||
    value.maxCostUsd > 10
  )
    throw new Error("Authoring budgets are invalid.");
}

const credentialKey =
  /(?:^|[-_])(api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)(?:$|[-_])/i;
const credentialValue =
  /(?:\bBearer\s+\S+|\bsk-[a-z0-9_-]{8,}|(?:^|[\s?&])(?:api_?key|signature|token)=[^&\s]+)/i;
function rejectCredentialText(value: string, name: string) {
  if (credentialValue.test(value))
    throw new Error(`${name} contains a credential-like value.`);
}
function rejectCredentialObject(value: unknown): void {
  if (typeof value === "string") return rejectCredentialText(value, "context");
  if (Array.isArray(value)) return value.forEach(rejectCredentialObject);
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (credentialKey.test(key))
      throw new Error(`Context contains forbidden credential field ${key}.`);
    rejectCredentialObject(item);
  }
}
function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
}
