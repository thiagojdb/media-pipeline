import { z } from "zod";

import {
  cancelProjectNarration,
  generateProjectNarration,
  listProjectNarrations,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    scriptVersionId: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("cancel"),
    jobId: z.string().min(1).max(200),
  }),
]);

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json(await listProjectNarrations(projectId));
  } catch (error) {
    return narrationError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_narration_action",
          message:
            parsed.error.issues[0]?.message ?? "Narration action is invalid.",
        },
        { status: 400 },
      );
    }
    const result =
      parsed.data.action === "generate"
        ? await generateProjectNarration(projectId, parsed.data.scriptVersionId)
        : await cancelProjectNarration(projectId, parsed.data.jobId);
    return Response.json(result, { status: 202 });
  } catch (error) {
    return narrationError(error);
  }
}

function narrationError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "The narration request failed. Try again.",
  );
  const status = message.includes("not found") ? 404 : 500;
  return Response.json(
    { error: "narration_request_failed", message },
    { status },
  );
}
