import { v } from "convex/values";
import { z } from "zod";

import type { ProjectComposition } from "./projectCompositionSchema";
import { projectCompositionSchema } from "./projectCompositionSchema";
import {
  publishCompositionVersion,
  validateCompositionForProject,
} from "./projectCompositions";
import { mutation, query } from "./_generated/server";
import { editableProject, readableProject } from "./projects";

const accessArgs = {
  serverToken: v.string(),
  identitySubject: v.string(),
  channelId: v.id("channels"),
};
const MAX_ATTEMPTS = 2;

export const list = query({
  args: { ...accessArgs, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await readableProject(ctx, args);
    return ctx.db
      .query("compositionProposals")
      .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(20);
  },
});

export const propose = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    request: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const request = bounded(args.request, 4_000);
    if (!project.currentCompositionVersionId) {
      throw new Error("Save a composition before asking Relay to revise it.");
    }
    const base = await ctx.db.get(project.currentCompositionVersionId);
    if (!base) throw new Error("The current composition was not found.");
    const composition = projectCompositionSchema.parse(
      JSON.parse(base.compositionJson),
    );
    const beats = await ctx.db
      .query("beats")
      .withIndex("by_project_narration_order", (q) =>
        q
          .eq("projectId", project._id)
          .eq("narrationVersionId", base.narrationVersionId),
      )
      .collect();
    const beatNumber = requestedBeatNumber(request);
    const beat = beats[beatNumber - 1];
    const tools = [
      "read_current_composition",
      "read_narration_beats",
      "read_approved_component_library",
    ];
    let attempt = 1;
    const evidence: Array<{
      attempt: number;
      valid: boolean;
      message: string;
    }> = [];
    let proposed: ProjectComposition | undefined;
    let patch: unknown;
    let rationale: string;

    if (!beat) {
      rationale = `I could not find beat ${beatNumber} on the pinned narration version.`;
      evidence.push({
        attempt,
        valid: false,
        message: `Beat ${beatNumber} is unavailable.`,
      });
    } else {
      const component = await latestApprovedComponent(
        ctx,
        project.channelId,
        requestedComponentId(request),
      );
      if (!component) {
        rationale =
          "The requested approved component is unavailable in this channel.";
        evidence.push({
          attempt,
          valid: false,
          message: "No matching approved component version was found.",
        });
      } else {
        const fixture = z
          .json()
          .parse(
            firstFixtureInput(
              component.fixturesJson,
              component.inputSchemaJson,
            ),
          );
        const removed = composition.segments.filter((segment) =>
          overlaps(segment.anchor, beat),
        );
        const createCandidate = (componentVersionId: string) =>
          projectCompositionSchema.parse({
            ...composition,
            segments: [
              ...composition.segments.filter(
                (segment) => !removed.includes(segment),
              ),
              {
                id: `agent-${component.componentId}-beat-${beatNumber}`,
                kind: "component" as const,
                componentVersionId,
                input: fixture,
                anchor: {
                  kind: "beat" as const,
                  beatId: beat._id,
                  startMs: beat.startMs,
                  endMs: beat.endMs,
                },
              },
            ].sort((left, right) => left.anchor.startMs - right.anchor.startMs),
          });
        let candidate = createCandidate(
          request.includes("[FAKE_INVALID_FIRST]")
            ? "invalid-component-version"
            : component._id,
        );
        proposed = candidate;
        try {
          await validateCompositionForProject(
            ctx,
            project._id,
            project.channelId,
            candidate,
          );
          evidence.push({
            attempt,
            valid: true,
            message: "Proposal passed independent composition validation.",
          });
        } catch (error) {
          evidence.push({
            attempt,
            valid: false,
            message: safeMessage(error),
          });
          if (
            request.includes("[FAKE_INVALID_FIRST]") &&
            attempt < MAX_ATTEMPTS
          ) {
            attempt += 1;
            candidate = createCandidate(component._id);
            proposed = candidate;
            await validateCompositionForProject(
              ctx,
              project._id,
              project.channelId,
              candidate,
            );
            evidence.push({
              attempt,
              valid: true,
              message: "Bounded repair passed independent validation.",
            });
          } else {
            proposed = undefined;
          }
        }
        patch = {
          operation: removed.length ? "replace" : "insert",
          beatId: beat._id,
          beatTitle: beat.title,
          removeSegmentIds: removed.map((segment) => segment.id),
          componentVersionId: component._id,
          component: `${component.componentId}@${component.version}`,
          input: fixture,
        };
        rationale = removed.length
          ? `Replace the visual on beat ${beatNumber} (${beat.title}) with approved ${component.componentId}@${component.version}.`
          : `Place approved ${component.componentId}@${component.version} on beat ${beatNumber} (${beat.title}).`;
      }
    }

    const proposedJson = proposed ? JSON.stringify(proposed) : undefined;
    const now = Date.now();
    const proposalId = await ctx.db.insert("compositionProposals", {
      channelId: project.channelId,
      projectId: project._id,
      createdByMembershipId: project.membership._id,
      baseCompositionVersionId: base._id,
      request,
      state: proposed ? "reviewable" : "invalid",
      proposedCompositionJson: proposedJson,
      patchJson: patch ? JSON.stringify(patch) : undefined,
      rationale,
      validationEvidenceJson: JSON.stringify(evidence),
      toolActivityJson: JSON.stringify(tools),
      provider: "relay-fake-editor",
      model: "deterministic-composition-v1",
      attempt,
      maxAttempts: MAX_ATTEMPTS,
      inputTokens: Math.ceil(request.length / 4),
      outputTokens: Math.ceil((proposedJson?.length ?? rationale.length) / 4),
      estimatedCostUsd: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { proposalId };
  },
});

export const accept = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    proposalId: v.id("compositionProposals"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.projectId !== project._id) {
      throw new Error("Composition proposal was not found.");
    }
    if (proposal.state !== "reviewable" || !proposal.proposedCompositionJson) {
      throw new Error(
        "Only a reviewable composition proposal can be accepted.",
      );
    }
    if (
      project.currentCompositionVersionId !== proposal.baseCompositionVersionId
    ) {
      throw new Error(
        "The composition changed after this proposal. Ask Relay for a fresh revision.",
      );
    }
    const composition = projectCompositionSchema.parse(
      JSON.parse(proposal.proposedCompositionJson),
    );
    await validateCompositionForProject(
      ctx,
      project._id,
      project.channelId,
      composition,
    );
    const published = await publishCompositionVersion(
      ctx,
      project,
      composition,
      "agent",
    );
    await ctx.db.patch(proposal._id, {
      state: "accepted",
      acceptedCompositionVersionId: published.compositionVersionId,
      updatedAt: Date.now(),
    });
    return published;
  },
});

export const reject = mutation({
  args: {
    ...accessArgs,
    projectId: v.id("projects"),
    proposalId: v.id("compositionProposals"),
  },
  handler: async (ctx, args) => {
    const project = await editableProject(ctx, args);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.projectId !== project._id) {
      throw new Error("Composition proposal was not found.");
    }
    if (proposal.state !== "reviewable") {
      throw new Error(
        "Only a reviewable composition proposal can be rejected.",
      );
    }
    await ctx.db.patch(proposal._id, {
      state: "rejected",
      updatedAt: Date.now(),
    });
    return { proposalId: proposal._id };
  },
});

async function latestApprovedComponent(
  ctx: Parameters<typeof editableProject>[0],
  channelId: string,
  componentId: string,
) {
  const local = await ctx.db
    .query("componentVersions")
    .withIndex("by_channel_component_approved", (q) =>
      q.eq("channelId", "relay-local-channel").eq("componentId", componentId),
    )
    .order("desc")
    .first();
  if (local) return local;
  return ctx.db
    .query("componentVersions")
    .withIndex("by_channel_component_approved", (q) =>
      q.eq("channelId", channelId).eq("componentId", componentId),
    )
    .order("desc")
    .first();
}

function requestedBeatNumber(request: string): number {
  const match = request.match(/\bbeat\s+(\d+)\b/i);
  return match ? Number(match[1]) : 1;
}

function requestedComponentId(request: string): string {
  if (/\bline\s+chart\b/i.test(request)) return "animated-line-chart";
  if (/\bbar\s+(?:chart|graph)\b/i.test(request)) return "animated-bar-graph";
  return "animated-line-chart";
}

function firstFixtureInput(
  fixturesJson: string,
  inputSchemaJson: string,
): unknown {
  const fixtures = JSON.parse(fixturesJson) as Array<{ input?: unknown }>;
  if (fixtures[0]?.input !== undefined) return fixtures[0].input;
  return schemaExample(JSON.parse(inputSchemaJson), "visual");
}

function schemaExample(schema: unknown, key: string): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const value = schema as Record<string, unknown>;
  if (value.default !== undefined) return value.default;
  if (Array.isArray(value.enum) && value.enum.length) return value.enum[0];
  if (value.type === "string") {
    const minimum = typeof value.minLength === "number" ? value.minLength : 0;
    const maximum =
      typeof value.maxLength === "number" ? value.maxLength : Infinity;
    const seed = key === "title" ? "Relay visual" : "relay-value";
    return seed.padEnd(minimum, "x").slice(0, maximum);
  }
  if (value.type === "number" || value.type === "integer") {
    const minimum = typeof value.minimum === "number" ? value.minimum : 0;
    const maximum = typeof value.maximum === "number" ? value.maximum : minimum;
    return Math.min(Math.max(0, minimum), maximum);
  }
  if (value.type === "boolean") return false;
  if (value.type === "array") {
    const minimum = typeof value.minItems === "number" ? value.minItems : 0;
    return Array.from({ length: minimum }, (_, index) =>
      schemaExample(value.items, `${key}-${index + 1}`),
    );
  }
  const properties =
    value.properties &&
    typeof value.properties === "object" &&
    !Array.isArray(value.properties)
      ? (value.properties as Record<string, unknown>)
      : {};
  const required = new Set(
    Array.isArray(value.required)
      ? value.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  );
  return Object.fromEntries(
    Object.entries(properties)
      .filter(
        ([propertyKey, property]) =>
          required.has(propertyKey) ||
          (property &&
            typeof property === "object" &&
            !Array.isArray(property) &&
            "default" in property),
      )
      .map(([propertyKey, property]) => [
        propertyKey,
        schemaExample(property, propertyKey),
      ]),
  );
}

function overlaps(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function bounded(value: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Tell Relay what to change.");
  if (normalized.length > maximum) {
    throw new Error(`Editing requests must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Proposal validation failed.";
}
