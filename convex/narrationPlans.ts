import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { editableProject, readableProject } from "./projects";

const accessArgs = {
  serverToken: v.string(),
  identitySubject: v.string(),
  channelId: v.id("channels"),
};

const cueInput = v.object({
  index: v.number(),
  sourceStart: v.number(),
  sourceEnd: v.number(),
  text: v.string(),
});

export type NarrationCue = {
  index: number;
  sourceStart: number;
  sourceEnd: number;
  text: string;
};

export const list = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    const versions = await ctx.db
      .query("narrationPlanVersions")
      .withIndex("by_project_version", (q) => q.eq("projectId", project._id))
      .order("desc")
      .collect();
    return {
      currentPlanVersionId: project.currentNarrationPlanVersionId ?? null,
      versions,
    };
  },
});

export const createFromScript = mutation({
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
    const existing = await ctx.db
      .query("narrationPlanVersions")
      .withIndex("by_script_version", (q) =>
        q.eq("scriptVersionId", script._id),
      )
      .order("desc")
      .first();
    if (existing?.state === "reviewable") return existing;
    const latest = await ctx.db
      .query("narrationPlanVersions")
      .withIndex("by_project_version", (q) => q.eq("projectId", project._id))
      .order("desc")
      .first();
    const cues = extractNarrationCues(script.content);
    if (!cues.length) {
      throw new Error("The selected script contains no proposed narration.");
    }
    const now = Date.now();
    const wordCount = countWords(cues.map((cue) => cue.text).join(" "));
    const planVersionId = await ctx.db.insert("narrationPlanVersions", {
      channelId: project.channelId,
      projectId: project._id,
      scriptVersionId: script._id,
      createdByMembershipId: project.membership._id,
      version: (latest?.version ?? 0) + 1,
      state: "reviewable",
      cues,
      wordCount,
      estimatedDurationMs: estimateDurationMs(wordCount),
      createdAt: now,
      updatedAt: now,
    });
    return (await ctx.db.get(planVersionId))!;
  },
});

export const updateReviewable = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    planVersionId: v.id("narrationPlanVersions"),
    cues: v.array(cueInput),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const plan = await ctx.db.get(args.planVersionId);
    if (!plan || plan.projectId !== project._id) {
      throw new Error("Narration plan was not found.");
    }
    if (plan.state !== "reviewable") {
      throw new Error("Approved narration plans cannot be changed.");
    }
    const script = await ctx.db.get(plan.scriptVersionId);
    if (!script) throw new Error("Script version was not found.");
    const cues = validateCues(args.cues, script.content.length);
    const wordCount = countWords(cues.map((cue) => cue.text).join(" "));
    await ctx.db.patch(plan._id, {
      cues,
      wordCount,
      estimatedDurationMs: estimateDurationMs(wordCount),
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(plan._id))!;
  },
});

export const approve = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    planVersionId: v.id("narrationPlanVersions"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const plan = await ctx.db.get(args.planVersionId);
    if (!plan || plan.projectId !== project._id) {
      throw new Error("Narration plan was not found.");
    }
    if (plan.state === "approved") return plan;
    if (!plan.cues.length || plan.wordCount < 1) {
      throw new Error("Narration plan must contain spoken text.");
    }
    const now = Date.now();
    await ctx.db.patch(plan._id, {
      state: "approved",
      approvedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(project._id, {
      currentNarrationPlanVersionId: plan._id,
      currentNarrationPlanVersionNumber: plan.version,
      updatedAt: now,
    });
    return (await ctx.db.get(plan._id))!;
  },
});

export function extractNarrationCues(markdown: string): NarrationCue[] {
  const cues: NarrationCue[] = [];
  const blocks = markdown.matchAll(/\S[\s\S]*?(?=\n[ \t]*\n|$)/g);
  for (const match of blocks) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    const spokenText = text.replace(
      /^\*\*(?:NARRATOR|VOICEOVER|VO):\*\*\s*/i,
      "",
    );
    if (!spokenText || excludedBlock(text)) continue;
    const sourceStart = (match.index ?? 0) + leading;
    cues.push({
      index: cues.length,
      sourceStart,
      sourceEnd: sourceStart + text.length,
      text: stripInlineMarkdown(spokenText),
    });
  }
  return cues.filter((cue) => cue.text.length > 0);
}

function excludedBlock(text: string): boolean {
  return (
    /^#{1,6}\s/.test(text) ||
    /^-{3,}$/.test(text) ||
    /^\*\*(?:Estimated runtime|Format|Research status):/i.test(text) ||
    /^\*\*(?:NARRATOR|VOICEOVER|VO):\*\*$/i.test(text) ||
    /^\*\*(?:\[(?:VISUAL|ON SCREEN|SFX|MUSIC|B-ROLL):[\s\S]*\]|(?:VISUAL|ON SCREEN|SFX|MUSIC|B-ROLL):[\s\S]*)\*\*$/i.test(
      text,
    ) ||
    /^(?:END|FADE OUT)$/i.test(text)
  );
}

function stripInlineMarkdown(text: string): string {
  return text
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replaceAll(/^\s*(?:[-+*]|\d+\.)\s+/gm, "")
    .replaceAll(/(\*\*|__|\*|_|~~|`)/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function validateCues(cues: NarrationCue[], scriptLength: number) {
  if (!cues.length) throw new Error("Narration plan needs at least one cue.");
  if (cues.length > 500) throw new Error("Narration plan supports 500 cues.");
  let previousEnd = 0;
  return cues.map((cue, index) => {
    if (
      cue.index !== index ||
      !Number.isSafeInteger(cue.sourceStart) ||
      !Number.isSafeInteger(cue.sourceEnd) ||
      cue.sourceStart < previousEnd ||
      cue.sourceEnd <= cue.sourceStart ||
      cue.sourceEnd > scriptLength
    ) {
      throw new Error(`Narration cue ${index + 1} has an invalid source span.`);
    }
    const text = cue.text.trim();
    if (!text || text.length > 4_000) {
      throw new Error(`Narration cue ${index + 1} has invalid spoken text.`);
    }
    previousEnd = cue.sourceEnd;
    return { ...cue, text };
  });
}

function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function estimateDurationMs(wordCount: number): number {
  return Math.round((wordCount / 150) * 60_000);
}
