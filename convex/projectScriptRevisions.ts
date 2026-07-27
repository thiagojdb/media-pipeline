import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { editableProject, readableProject } from "./projects";

const accessArgs = {
  serverToken: v.string(),
  identitySubject: v.string(),
  channelId: v.id("channels"),
};

const MAX_INSTRUCTION = 4_000;
const MAX_SCRIPT = 100_000;

export const list = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    return ctx.db
      .query("scriptRevisionProposals")
      .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(20);
  },
});

export const propose = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    baseScriptVersionId: v.id("scriptVersions"),
    baseDraft: v.string(),
    instruction: v.string(),
    scope: v.union(v.literal("selection"), v.literal("document")),
    selectionFrom: v.number(),
    selectionTo: v.number(),
    selectedText: v.string(),
    replacementMarkdown: v.string(),
    rationale: v.string(),
    provider: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    estimatedCostUsd: v.number(),
    wallTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    if (project.currentScriptVersionId !== args.baseScriptVersionId) {
      throw new Error(
        "The script changed after this request started. Ask Relay again from the current version.",
      );
    }
    const base = await ctx.db.get(args.baseScriptVersionId);
    if (!base || base.projectId !== project._id) {
      throw new Error("The base script version was not found.");
    }
    const instruction = bounded(args.instruction, MAX_INSTRUCTION, "Request");
    const baseDraft = bounded(args.baseDraft, MAX_SCRIPT, "Draft");
    const selectedText =
      args.scope === "selection"
        ? bounded(args.selectedText, MAX_SCRIPT, "Selected text")
        : baseDraft;
    if (
      !Number.isSafeInteger(args.selectionFrom) ||
      !Number.isSafeInteger(args.selectionTo) ||
      args.selectionFrom < 0 ||
      args.selectionTo < args.selectionFrom
    ) {
      throw new Error("The selected script range is invalid.");
    }

    const replacementMarkdown = bounded(
      args.replacementMarkdown,
      MAX_SCRIPT,
      "Replacement",
    );
    const rationale = bounded(args.rationale, MAX_INSTRUCTION, "Rationale");
    const provider = bounded(args.provider, 200, "Provider");
    const model = bounded(args.model, 200, "Model");
    for (const [label, value] of [
      ["Input tokens", args.inputTokens],
      ["Output tokens", args.outputTokens],
      ["Estimated cost", args.estimatedCostUsd],
      ["Wall time", args.wallTimeMs],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a non-negative number.`);
      }
    }
    const now = Date.now();
    const proposalId = await ctx.db.insert("scriptRevisionProposals", {
      channelId: project.channelId,
      projectId: project._id,
      createdByMembershipId: project.membership._id,
      baseScriptVersionId: base._id,
      baseScriptVersionNumber: base.version,
      baseDraftHash: await sha256(baseDraft),
      scope: args.scope,
      selectionFrom: args.selectionFrom,
      selectionTo: args.selectionTo,
      selectedText,
      instruction,
      replacementMarkdown,
      rationale,
      state: "reviewable",
      provider,
      model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      estimatedCostUsd: args.estimatedCostUsd,
      wallTimeMs: args.wallTimeMs,
      createdAt: now,
      updatedAt: now,
    });
    return { proposalId };
  },
});

export const decide = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    proposalId: v.id("scriptRevisionProposals"),
    decision: v.union(v.literal("apply"), v.literal("reject")),
    baseDraft: v.optional(v.string()),
    selectedText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.projectId !== project._id) {
      throw new Error("Script revision proposal was not found.");
    }
    if (proposal.state !== "reviewable") {
      throw new Error("Only a reviewable script revision can be decided.");
    }
    if (args.decision === "apply") {
      if (project.currentScriptVersionId !== proposal.baseScriptVersionId) {
        throw new Error(
          "The script version changed after this proposal. Ask Relay for a fresh revision.",
        );
      }
      if (
        !args.baseDraft ||
        (await sha256(args.baseDraft)) !== proposal.baseDraftHash
      ) {
        throw new Error(
          "The draft changed after this proposal. Review it and ask Relay again.",
        );
      }
      if (
        proposal.scope === "selection" &&
        args.selectedText !== proposal.selectedText
      ) {
        throw new Error(
          "The selected passage changed after this proposal. Ask Relay again.",
        );
      }
    }
    await ctx.db.patch(proposal._id, {
      state: args.decision === "apply" ? "applied" : "rejected",
      updatedAt: Date.now(),
    });
    return { proposalId: proposal._id };
  },
});

function bounded(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (value.length > maximum) {
    throw new Error(`${label} must be at most ${maximum} characters.`);
  }
  return value;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
