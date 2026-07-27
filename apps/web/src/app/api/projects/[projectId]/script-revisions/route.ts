import { z } from "zod";

import {
  decideProjectScriptRevision,
  listProjectScriptRevisionProposals,
  proposeProjectScriptRevision,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";
import { forwardWorkerRequest } from "@/lib/worker-api";

type RouteContext = { params: Promise<{ projectId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose"),
    baseScriptVersionId: z.string().min(1).max(200),
    baseDraft: z.string().min(1).max(100_000),
    instruction: z.string().trim().min(1).max(4_000),
    scope: z.enum(["selection", "document"]),
    selectionFrom: z.number().int().min(0),
    selectionTo: z.number().int().min(0),
    selectedText: z.string().max(100_000),
    provider: z.string().trim().min(1).max(100).optional(),
    model: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    action: z.enum(["apply", "reject"]),
    proposalId: z.string().min(1).max(200),
    baseDraft: z.string().max(100_000).optional(),
    selectedText: z.string().max(100_000).optional(),
  }),
]);

const generatedRevisionSchema = z.object({
  replacementMarkdown: z.string().min(1).max(100_000),
  rationale: z.string().min(1).max(4_000),
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  wallTimeMs: z.number().nonnegative(),
});

export async function GET(request: Request, context: RouteContext) {
  try {
    if (new URL(request.url).searchParams.get("models") === "1") {
      return await forwardWorkerRequest("/script-revision-models");
    }
    const { projectId } = await context.params;
    return Response.json(await listProjectScriptRevisionProposals(projectId));
  } catch (error) {
    return revisionError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_script_revision",
          message:
            parsed.error.issues[0]?.message ??
            "The script revision request is invalid.",
        },
        { status: 400 },
      );
    }
    if (parsed.data.action === "propose") {
      const generatedResponse = await forwardWorkerRequest(
        "/script-revisions",
        {
          method: "POST",
          body: JSON.stringify({
            instruction: parsed.data.instruction,
            scope: parsed.data.scope,
            sourceMarkdown:
              parsed.data.scope === "selection"
                ? parsed.data.selectedText
                : parsed.data.baseDraft,
            provider: parsed.data.provider,
            model: parsed.data.model,
          }),
        },
      );
      if (!generatedResponse.ok) return generatedResponse;
      const generated = generatedRevisionSchema.safeParse(
        await generatedResponse.json(),
      );
      if (!generated.success) {
        return Response.json(
          {
            error: "invalid_model_response",
            message:
              "The Relay model returned an invalid script revision. Try again.",
          },
          { status: 502 },
        );
      }
      return Response.json(
        await proposeProjectScriptRevision(projectId, {
          baseScriptVersionId: parsed.data.baseScriptVersionId,
          baseDraft: parsed.data.baseDraft,
          instruction: parsed.data.instruction,
          scope: parsed.data.scope,
          selectionFrom: parsed.data.selectionFrom,
          selectionTo: parsed.data.selectionTo,
          selectedText: parsed.data.selectedText,
          ...generated.data,
        }),
        { status: 201 },
      );
    }
    const { action, ...input } = parsed.data;
    return Response.json(
      await decideProjectScriptRevision(projectId, {
        proposalId: input.proposalId,
        decision: action,
        ...(input.baseDraft !== undefined
          ? { baseDraft: input.baseDraft }
          : {}),
        ...(input.selectedText !== undefined
          ? { selectedText: input.selectedText }
          : {}),
      }),
    );
  } catch (error) {
    return revisionError(error);
  }
}

function revisionError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "Relay could not complete the script revision. Try again.",
  );
  const status = message.includes("not found") ? 404 : 400;
  return Response.json(
    { error: "script_revision_failed", message },
    { status },
  );
}
