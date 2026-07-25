import { z } from "zod";

import { archiveProject, getProject, updateProject } from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000).optional(),
  }),
  z.object({ action: z.literal("archive") }),
]);

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json(await getProject(projectId));
  } catch (error) {
    return projectError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_project_update",
          message:
            parsed.error.issues[0]?.message ?? "Project update is invalid.",
        },
        { status: 400 },
      );
    }
    if (parsed.data.action === "archive") {
      await archiveProject(projectId);
    } else {
      await updateProject(projectId, parsed.data);
    }
    return Response.json({ projectId });
  } catch (error) {
    return projectError(error);
  }
}

function projectError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "The project request failed. Try again.",
  );
  const status = message.includes("not found") ? 404 : 500;
  return Response.json(
    { error: "project_request_failed", message },
    { status },
  );
}
