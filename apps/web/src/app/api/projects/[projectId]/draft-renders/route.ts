import { z } from "zod";

import {
  cancelProjectDraftRender,
  enqueueProjectDraftRender,
  listProjectDraftRenders,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("render"),
    range: z
      .object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
      })
      .optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    jobId: z.string().min(1).max(200),
  }),
]);

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json(await listProjectDraftRenders(projectId));
  } catch (error) {
    return renderError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_render_action",
          message:
            parsed.error.issues[0]?.message ?? "Render action is invalid.",
        },
        { status: 400 },
      );
    }
    if (parsed.data.action === "render") {
      return Response.json(
        await enqueueProjectDraftRender(projectId, parsed.data.range),
        { status: 202 },
      );
    }
    return Response.json(
      await cancelProjectDraftRender(projectId, parsed.data.jobId),
    );
  } catch (error) {
    return renderError(error);
  }
}

function renderError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "Relay could not start the draft render. Try again.",
  );
  return Response.json(
    { error: "project_render_failed", message },
    { status: message.includes("not found") ? 404 : 400 },
  );
}
