import { z } from "zod";

import {
  decideProjectCompositionProposal,
  listProjectCompositionProposals,
  proposeProjectCompositionChange,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose"),
    request: z.string().trim().min(1).max(4_000),
  }),
  z.object({
    action: z.enum(["accept", "reject"]),
    proposalId: z.string().min(1).max(200),
  }),
]);

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json(await listProjectCompositionProposals(projectId));
  } catch (error) {
    return proposalError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_proposal_action",
          message:
            parsed.error.issues[0]?.message ?? "Proposal action is invalid.",
        },
        { status: 400 },
      );
    }
    if (parsed.data.action === "propose") {
      return Response.json(
        await proposeProjectCompositionChange(projectId, parsed.data.request),
        { status: 201 },
      );
    }
    return Response.json(
      await decideProjectCompositionProposal(
        projectId,
        parsed.data.proposalId,
        parsed.data.action,
      ),
    );
  } catch (error) {
    return proposalError(error);
  }
}

function proposalError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "Relay could not complete the editing proposal. Try again.",
  );
  const status = message.includes("not found") ? 404 : 400;
  return Response.json({ error: "proposal_failed", message }, { status });
}
