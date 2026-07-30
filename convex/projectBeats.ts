import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { editableProject, readableProject } from "./projects";

const accessArgs = {
  serverToken: v.string(),
  identitySubject: v.string(),
  channelId: v.id("channels"),
};

const beatInput = v.object({
  startMs: v.number(),
  endMs: v.number(),
  title: v.string(),
  summary: v.optional(v.string()),
});

export const list = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    const beats = await ctx.db
      .query("beats")
      .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
      .collect();
    const narrationVersions = await ctx.db
      .query("narrationVersions")
      .withIndex("by_project_version", (q) => q.eq("projectId", project._id))
      .order("desc")
      .collect();
    return {
      currentNarrationVersionId: project.currentNarrationVersionId ?? null,
      narrationVersions: narrationVersions
        .filter(
          (version) =>
            version.alignmentState === "approved" &&
            Boolean(version.wordTimings?.length),
        )
        .map((version) => ({
          _id: version._id,
          version: version.version,
          durationMs: version.durationMs,
        })),
      beats: beats.sort((left, right) =>
        left.narrationVersionId === right.narrationVersionId
          ? left.order - right.order
          : left.createdAt - right.createdAt,
      ),
    };
  },
});

export const replace = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    narrationVersionId: v.id("narrationVersions"),
    beats: v.array(beatInput),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const narration = await ctx.db.get(args.narrationVersionId);
    if (!narration || narration.projectId !== project._id) {
      throw new Error("Narration version was not found.");
    }
    if (
      narration.alignmentState !== "approved" ||
      !narration.wordTimings?.length
    ) {
      throw new Error("Narration needs approved word timing before beats.");
    }
    const validated = validateBeats(args.beats, narration.durationMs);
    const existing = await ctx.db
      .query("beats")
      .withIndex("by_project_narration_order", (q) =>
        q.eq("projectId", project._id).eq("narrationVersionId", narration._id),
      )
      .collect();
    await Promise.all(existing.map((beat) => ctx.db.delete(beat._id)));
    const now = Date.now();
    const beatIds = [];
    for (const [order, beat] of validated.entries()) {
      beatIds.push(
        await ctx.db.insert("beats", {
          channelId: project.channelId,
          projectId: project._id,
          narrationVersionId: narration._id,
          createdByMembershipId: project.membership._id,
          order,
          ...beat,
          createdAt: now + order,
          updatedAt: now,
        }),
      );
    }
    await ctx.db.patch(project._id, { updatedAt: now });
    return { beatIds };
  },
});

function validateBeats(
  beats: Array<{
    startMs: number;
    endMs: number;
    title: string;
    summary?: string;
  }>,
  durationMs: number,
) {
  if (beats.length > 200)
    throw new Error("A project supports up to 200 beats.");
  return beats.map((beat, index) => {
    if (
      !Number.isSafeInteger(beat.startMs) ||
      !Number.isSafeInteger(beat.endMs)
    ) {
      throw new Error(`Beat ${index + 1} timing must use whole milliseconds.`);
    }
    if (beat.startMs < 0 || beat.endMs > durationMs) {
      throw new Error(`Beat ${index + 1} must stay inside the narration.`);
    }
    if (beat.endMs <= beat.startMs) {
      throw new Error(`Beat ${index + 1} must have a positive duration.`);
    }
    if (index > 0 && beat.startMs < beats[index - 1]!.endMs) {
      throw new Error(`Beat ${index + 1} overlaps the previous beat.`);
    }
    const title = bounded(beat.title, 120, "Beat title");
    const summary = beat.summary?.trim();
    if (summary && summary.length > 1_000) {
      throw new Error("Beat summary must be 1,000 characters or fewer.");
    }
    return { startMs: beat.startMs, endMs: beat.endMs, title, summary };
  });
}

function bounded(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}
