import { z } from "zod";

import { createProject, listProjects } from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
});

export async function GET() {
  try {
    return Response.json(await listProjects());
  } catch (error) {
    return projectError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_project",
          message:
            parsed.error.issues[0]?.message ?? "Project details are invalid.",
        },
        { status: 400 },
      );
    }
    return Response.json(await createProject(parsed.data), { status: 201 });
  } catch (error) {
    return projectError(error);
  }
}

function projectError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "The project request failed. Try again.",
  );
  return Response.json(
    { error: "project_request_failed", message },
    { status: 500 },
  );
}
