import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const budgets = {
  maxWallTimeMs: v.number(),
  maxModelTurns: v.number(),
  maxToolCalls: v.number(),
  maxTokens: v.number(),
  maxCostUsd: v.number(),
};

export const getCandidate = internalQuery({
  args: { candidateId: v.id("componentCandidates") },
  handler: async (ctx, { candidateId }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return null;
    return candidateDetails(candidate);
  },
});

export const listCandidates = internalQuery({
  args: { channelId: v.string(), componentId: v.string() },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("componentCandidates")
      .withIndex("by_channel_component_created", (q) =>
        q.eq("channelId", args.channelId).eq("componentId", args.componentId),
      )
      .order("desc")
      .take(100);
    return candidates.map(candidateDetails);
  },
});

export const approve = internalMutation({
  args: {
    candidateId: v.id("componentCandidates"),
    note: v.optional(v.string()),
    acknowledgeCompatibilityWarning: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const candidate = await requireCandidate(ctx, args.candidateId);
    const existing = await ctx.db
      .query("componentVersions")
      .withIndex("by_candidate", (q) => q.eq("candidateId", candidate._id))
      .unique();
    if (existing) return existing._id;
    if (candidate.status !== "reviewable")
      throw new Error("Only a reviewable candidate can be approved.");
    if (candidate.compatibilityWarning && !args.acknowledgeCompatibilityWarning)
      throw new Error(
        "Acknowledge the input-schema compatibility warning before approval.",
      );
    const versionCollision = await ctx.db
      .query("componentVersions")
      .withIndex("by_channel_component_version", (q) =>
        q
          .eq("channelId", candidate.channelId)
          .eq("componentId", candidate.componentId)
          .eq("version", candidate.declaredVersion),
      )
      .unique();
    if (versionCollision)
      throw new Error(
        "That semantic version is already approved; the revision must declare a new version.",
      );
    const now = Date.now();
    const versionId = await ctx.db.insert("componentVersions", {
      channelId: candidate.channelId,
      componentId: candidate.componentId,
      version: candidate.declaredVersion,
      candidateId: candidate._id,
      buildJobId: candidate.buildJobId,
      sourceHash: candidate.sourceHash,
      candidateRef: candidate.candidateRef,
      validationEvidenceJson: candidate.validationEvidenceJson,
      inputSchemaJson: candidate.inputSchemaJson,
      inputSchemaFingerprint: candidate.inputSchemaFingerprint,
      fixturesJson: candidate.fixturesJson,
      dimensionsJson: candidate.dimensionsJson,
      previousVersionId: candidate.baseVersionId,
      approvedAt: now,
    });
    await ctx.db.patch(candidate._id, {
      status: "approved",
      decisionNote: boundedNote(args.note),
      updatedAt: now,
    });
    const component = await ctx.db
      .query("components")
      .withIndex("by_channel_component", (q) =>
        q
          .eq("channelId", candidate.channelId)
          .eq("componentId", candidate.componentId),
      )
      .unique();
    if (!component) throw new Error("Component identity is missing.");
    await ctx.db.patch(component._id, {
      latestApprovedVersionId: versionId,
      updatedAt: now,
    });
    return versionId;
  },
});

export const reject = internalMutation({
  args: { candidateId: v.id("componentCandidates"), note: v.string() },
  handler: (ctx, args) => decide(ctx, args, "rejected"),
});

export const requestChanges = internalMutation({
  args: { candidateId: v.id("componentCandidates"), note: v.string() },
  handler: (ctx, args) => decide(ctx, args, "changes_requested"),
});

export const listVersions = internalQuery({
  args: { channelId: v.string(), componentId: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("componentVersions")
      .withIndex("by_channel_component_approved", (q) =>
        q.eq("channelId", args.channelId).eq("componentId", args.componentId),
      )
      .order("asc")
      .take(100),
});

export const getVersion = internalQuery({
  args: { versionId: v.id("componentVersions") },
  handler: async (ctx, { versionId }) => {
    const version = await ctx.db.get(versionId);
    if (!version) return null;
    const build = await ctx.db.get(version.buildJobId);
    if (!build || build.state !== "succeeded")
      throw new Error("Approved version source is unavailable.");
    return { ...version, sourceSnapshot: build.sourceSnapshot };
  },
});

export const pinVersion = internalMutation({
  args: {
    channelId: v.string(),
    projectId: v.string(),
    versionId: v.id("componentVersions"),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version || version.channelId !== args.channelId)
      throw new Error("Approved component version was not found.");
    const projectId = bounded(args.projectId, "projectId", 200);
    const existing = await ctx.db
      .query("projectComponentPins")
      .withIndex("by_channel_project_component", (q) =>
        q
          .eq("channelId", args.channelId)
          .eq("projectId", projectId)
          .eq("componentId", version.componentId),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        versionId: version._id,
        updatedAt: now,
      });
      return existing._id;
    }
    return ctx.db.insert("projectComponentPins", {
      channelId: args.channelId,
      projectId,
      componentId: version.componentId,
      versionId: version._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const enqueueRevision = internalMutation({
  args: {
    versionId: v.id("componentVersions"),
    threadId: v.string(),
    turnId: v.string(),
    userRequest: v.string(),
    acceptanceCriteria: v.array(v.string()),
    channelThemeJson: v.string(),
    assetsMetadataJson: v.string(),
    ...budgets,
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new Error("Selected component version was not found.");
    const build = await ctx.db.get(version.buildJobId);
    if (!build || build.state !== "succeeded")
      throw new Error("Selected component version source is unavailable.");
    const threadId = bounded(args.threadId, "threadId", 200);
    const turnId = bounded(args.turnId, "turnId", 200);
    const userRequest = bounded(args.userRequest, "userRequest", 8_000);
    rejectCredentialText(userRequest, "userRequest");
    if (args.acceptanceCriteria.length > 30)
      throw new Error("Too many acceptance criteria.");
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
          .eq("channelId", version.channelId)
          .eq("threadId", threadId)
          .eq("turnId", turnId),
      )
      .unique();
    if (existing) {
      if (
        existing.baseSnapshotId !== String(version._id) ||
        existing.userRequest !== userRequest ||
        JSON.stringify(existing.acceptanceCriteria) !==
          JSON.stringify(args.acceptanceCriteria) ||
        existing.channelThemeJson !== channelThemeJson ||
        existing.assetsMetadataJson !== assetsMetadataJson ||
        existing.maxWallTimeMs !== args.maxWallTimeMs ||
        existing.maxModelTurns !== args.maxModelTurns ||
        existing.maxToolCalls !== args.maxToolCalls ||
        existing.maxTokens !== args.maxTokens ||
        existing.maxCostUsd !== args.maxCostUsd
      )
        throw new Error("This revision turn already has different inputs.");
      return existing._id;
    }
    const now = Date.now();
    let thread = await ctx.db
      .query("authoringThreads")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", version.channelId).eq("threadId", threadId),
      )
      .unique();
    if (!thread) {
      const threadDocId = await ctx.db.insert("authoringThreads", {
        channelId: version.channelId,
        threadId,
        createdAt: now,
        updatedAt: now,
        latestTurnId: turnId,
      });
      thread = await ctx.db.get(threadDocId);
    } else {
      await ctx.db.patch(thread._id, { updatedAt: now, latestTurnId: turnId });
    }
    const previous = await ctx.db
      .query("authoringTurns")
      .withIndex("by_channel_thread_created", (q) =>
        q.eq("channelId", version.channelId).eq("threadId", threadId),
      )
      .order("desc")
      .first();
    const authoringTurnId = await ctx.db.insert("authoringTurns", {
      channelId: version.channelId,
      threadId,
      turnId,
      rootTurnId: turnId,
      repairAttempt: 0,
      maxRepairAttempts: 2,
      userRequest,
      acceptanceCriteria: args.acceptanceCriteria,
      baseSource: build.sourceSnapshot,
      baseSourceHash: version.sourceHash,
      parentCandidateId: String(version.candidateId),
      baseSnapshotId: String(version._id),
      channelThemeJson,
      assetsMetadataJson,
      priorSummaries: [
        `Revise exact approved ${version.componentId}@${version.version} (${version.sourceHash}).`,
      ],
      state: "queued",
      attempt: 0,
      maxAttempts: 1,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
      sessionRef: previous?.sessionRef,
      ...pickBudgets(args),
    });
    await ctx.db.insert("authoringEvents", {
      turnId: authoringTurnId,
      createdAt: now,
      kind: "revision_enqueued",
      state: "queued",
      message: `Revision queued from exact approved ${version.componentId}@${version.version}.`,
    });
    return authoringTurnId;
  },
});

async function decide(
  ctx: MutationCtx,
  args: { candidateId: Doc<"componentCandidates">["_id"]; note: string },
  status: "rejected" | "changes_requested",
) {
  const candidate = await requireCandidate(ctx, args.candidateId);
  if (candidate.status !== "reviewable")
    throw new Error("Only a reviewable candidate can receive this decision.");
  await ctx.db.patch(candidate._id, {
    status,
    decisionNote: bounded(args.note, "note", 2_000),
    updatedAt: Date.now(),
  });
  return true;
}

async function requireCandidate(
  ctx: MutationCtx,
  candidateId: Doc<"componentCandidates">["_id"],
) {
  const candidate = await ctx.db.get(candidateId);
  if (!candidate) throw new Error("Component candidate was not found.");
  return candidate;
}

function candidateDetails(candidate: Doc<"componentCandidates">) {
  return {
    ...candidate,
    validationEvidence: JSON.parse(candidate.validationEvidenceJson) as unknown,
    inputSchema: JSON.parse(candidate.inputSchemaJson) as unknown,
    compatibility: JSON.parse(candidate.compatibilityJson) as unknown,
    fixtures: JSON.parse(candidate.fixturesJson) as unknown,
    dimensions: JSON.parse(candidate.dimensionsJson) as unknown,
  };
}

function bounded(value: string, name: string, maximum: number): string {
  if (!value || value.length > maximum) throw new Error(`${name} is invalid.`);
  return value;
}
function boundedNote(value: string | undefined): string | undefined {
  return value === undefined ? undefined : bounded(value, "note", 2_000);
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
    throw new Error("Revision budgets are invalid.");
}
function pickBudgets(value: {
  maxWallTimeMs: number;
  maxModelTurns: number;
  maxToolCalls: number;
  maxTokens: number;
  maxCostUsd: number;
}) {
  return {
    maxWallTimeMs: value.maxWallTimeMs,
    maxModelTurns: value.maxModelTurns,
    maxToolCalls: value.maxToolCalls,
    maxTokens: value.maxTokens,
    maxCostUsd: value.maxCostUsd,
  };
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
  if (typeof value === "string") {
    rejectCredentialText(value, "context");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(rejectCredentialObject);
    return;
  }
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
