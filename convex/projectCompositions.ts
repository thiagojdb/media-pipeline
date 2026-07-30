import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  type ProjectComposition,
  projectCompositionSchema,
} from "./projectCompositionSchema";
import { editableProject, readableProject } from "./projects";

const accessArgs = {
  serverToken: v.string(),
  identitySubject: v.string(),
  channelId: v.id("channels"),
};

export const list = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    const versions = await ctx.db
      .query("compositionVersions")
      .withIndex("by_project_version", (q) => q.eq("projectId", project._id))
      .order("desc")
      .collect();
    return {
      current: project.currentCompositionVersionId
        ? await currentWithComposition(ctx, project.currentCompositionVersionId)
        : null,
      versions: versions.map((version) => ({
        _id: version._id,
        version: version.version,
        narrationVersionId: version.narrationVersionId,
        provenance: version.provenance,
        createdAt: version.createdAt,
        segmentCount: (
          JSON.parse(version.compositionJson) as ProjectComposition
        ).segments.length,
      })),
    };
  },
});

async function currentWithComposition(
  ctx: Parameters<typeof readableProject>[0],
  id: Id<"compositionVersions">,
) {
  const record = await ctx.db.get(id);
  return record
    ? {
        ...record,
        composition: JSON.parse(record.compositionJson) as ProjectComposition,
      }
    : null;
}

export const getByVersion = query({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    if (!Number.isSafeInteger(args.version) || args.version < 1) {
      throw new Error("Composition version is invalid.");
    }
    const record = await ctx.db
      .query("compositionVersions")
      .withIndex("by_project_version", (q) =>
        q.eq("projectId", project._id).eq("version", args.version),
      )
      .unique();
    if (!record) throw new Error("Composition version was not found.");
    return { ...record, composition: JSON.parse(record.compositionJson) };
  },
});

export const save = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    provenance: v.union(v.literal("manual"), v.literal("agent")),
    composition: v.any(),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const parsed = projectCompositionSchema.safeParse(args.composition);
    if (!parsed.success) {
      throw new Error(
        `Composition is invalid: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`,
      );
    }
    await validateCompositionForProject(
      ctx,
      project._id,
      project.channelId,
      parsed.data,
    );
    return publishCompositionVersion(
      ctx,
      project,
      parsed.data,
      args.provenance,
    );
  },
});

export async function validateCompositionForProject(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  channelId: Id<"channels">,
  composition: ProjectComposition,
) {
  const narrationVersionId = ctx.db.normalizeId(
    "narrationVersions",
    composition.narrationVersionId,
  );
  const narration = narrationVersionId
    ? await ctx.db.get(narrationVersionId)
    : null;
  if (!narration || narration.projectId !== projectId) {
    throw new Error("Composition narration version was not found.");
  }
  if (
    narration.alignmentState !== "approved" ||
    !narration.wordTimings?.length
  ) {
    throw new Error("Composition requires approved narration word timing.");
  }
  const durationMs = narration.durationMs;
  const ids = new Set<string>();
  let previousEnd = 0;
  for (const [index, segment] of composition.segments.entries()) {
    if (ids.has(segment.id)) {
      throw new Error(`Composition segment id "${segment.id}" is duplicated.`);
    }
    ids.add(segment.id);
    const { startMs, endMs } = segment.anchor;
    if (endMs <= startMs) {
      throw new Error(`Composition segment ${index + 1} has no duration.`);
    }
    if (endMs > durationMs) {
      throw new Error(
        `Composition segment ${index + 1} exceeds the narration duration.`,
      );
    }
    if (startMs < previousEnd) {
      throw new Error(
        `Composition segment ${index + 1} overlaps its predecessor.`,
      );
    }
    previousEnd = endMs;
    if (segment.anchor.kind === "beat") {
      const beatId = ctx.db.normalizeId("beats", segment.anchor.beatId);
      const beat = beatId ? await ctx.db.get(beatId) : null;
      if (
        !beat ||
        beat.projectId !== projectId ||
        beat.narrationVersionId !== narrationVersionId
      ) {
        throw new Error(
          `Composition segment ${index + 1} references an unavailable beat.`,
        );
      }
      if (beat.startMs !== startMs || beat.endMs !== endMs) {
        throw new Error(
          `Composition segment ${index + 1} timing must match its exact beat.`,
        );
      }
    }
    if (segment.kind === "media") {
      const sourceId = ctx.db.normalizeId("projectSources", segment.sourceId);
      const source = sourceId ? await ctx.db.get(sourceId) : null;
      if (
        !source ||
        source.projectId !== projectId ||
        source.status !== "active"
      ) {
        throw new Error(
          `Composition segment ${index + 1} references an unavailable source.`,
        );
      }
      continue;
    }
    const componentVersionId = ctx.db.normalizeId(
      "componentVersions",
      segment.componentVersionId,
    );
    const componentVersion = componentVersionId
      ? await ctx.db.get(componentVersionId)
      : null;
    if (
      !componentVersion ||
      (componentVersion.channelId !== channelId &&
        componentVersion.channelId !== "relay-local-channel")
    ) {
      throw new Error(
        `Composition segment ${index + 1} requires an approved channel component version.`,
      );
    }
    const schema = JSON.parse(componentVersion.inputSchemaJson) as JsonSchema;
    const inputError = validateJsonSchema(schema, segment.input, "$");
    if (inputError) {
      throw new Error(
        `Composition segment ${index + 1} input is invalid: ${inputError}`,
      );
    }
  }
}

export async function publishCompositionVersion(
  ctx: MutationCtx,
  project: Awaited<ReturnType<typeof editableProject>>,
  composition: ProjectComposition,
  provenance: "manual" | "agent",
) {
  const narrationVersionId = ctx.db.normalizeId(
    "narrationVersions",
    composition.narrationVersionId,
  );
  if (!narrationVersionId) {
    throw new Error("Composition narration version was not found.");
  }
  const version = (project.currentCompositionVersionNumber ?? 0) + 1;
  const compositionVersionId = await ctx.db.insert("compositionVersions", {
    channelId: project.channelId,
    projectId: project._id,
    narrationVersionId,
    createdByMembershipId: project.membership._id,
    version,
    schemaVersion: 1,
    provenance,
    compositionJson: JSON.stringify(composition),
    createdAt: Date.now(),
  });
  await ctx.db.patch(project._id, {
    currentCompositionVersionId: compositionVersionId,
    currentCompositionVersionNumber: version,
    updatedAt: Date.now(),
  });
  return { compositionVersionId, version };
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};

function validateJsonSchema(
  schema: JsonSchema,
  value: unknown,
  path: string,
): string | null {
  if (schema.anyOf || schema.oneOf) {
    const choices = schema.anyOf ?? schema.oneOf ?? [];
    if (!choices.some((choice) => !validateJsonSchema(choice, value, path))) {
      return `${path} does not match any allowed shape.`;
    }
    return null;
  }
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    return `${path} must be one of the declared values.`;
  }
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (types.length && !types.some((type) => matchesType(type, value))) {
    return `${path} must be ${types.join(" or ")}.`;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!(required in record)) return `${path}.${required} is required.`;
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!schema.properties?.[key]) return `${path}.${key} is not allowed.`;
      }
    }
    for (const [key, propertySchema] of Object.entries(
      schema.properties ?? {},
    )) {
      if (key in record) {
        const issue = validateJsonSchema(
          propertySchema,
          record[key],
          `${path}.${key}`,
        );
        if (issue) return issue;
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      const issue = validateJsonSchema(schema.items, item, `${path}[${index}]`);
      if (issue) return issue;
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      return `${path} is below its minimum.`;
    if (schema.maximum !== undefined && value > schema.maximum)
      return `${path} exceeds its maximum.`;
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return `${path} is too short.`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return `${path} is too long.`;
  }
  return null;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "object":
      return (
        Boolean(value) && typeof value === "object" && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}
