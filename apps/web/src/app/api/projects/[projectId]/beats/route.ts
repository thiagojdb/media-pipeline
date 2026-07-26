import { z } from "zod";

import { listProjectBeats, replaceProjectBeats } from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const beatSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(1_000).optional(),
});

const replaceSchema = z.object({
  narrationVersionId: z.string().min(1).max(200),
  beats: z.array(beatSchema).max(200),
});

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json(await listProjectBeats(projectId));
  } catch (error) {
    return beatError(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = replaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_beats",
          message: parsed.error.issues[0]?.message ?? "Beat data is invalid.",
        },
        { status: 400 },
      );
    }
    return Response.json(
      await replaceProjectBeats(
        projectId,
        parsed.data.narrationVersionId,
        parsed.data.beats,
      ),
    );
  } catch (error) {
    return beatError(error);
  }
}

function beatError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "The beat changes could not be saved. Try again.",
  );
  const status = message.includes("not found") ? 404 : 400;
  return Response.json({ error: "beat_request_failed", message }, { status });
}
