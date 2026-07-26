import { z } from "zod";

import {
  listProjectCompositions,
  type ProjectComposition,
  saveProjectComposition,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const saveSchema = z.object({
  provenance: z.enum(["manual", "agent"]).default("manual"),
  composition: z.unknown(),
});

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json(await listProjectCompositions(projectId));
  } catch (error) {
    return compositionError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = saveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_composition",
          message:
            parsed.error.issues[0]?.message ?? "Composition data is invalid.",
        },
        { status: 400 },
      );
    }
    return Response.json(
      await saveProjectComposition(
        projectId,
        parsed.data.composition as ProjectComposition,
        parsed.data.provenance,
      ),
      { status: 201 },
    );
  } catch (error) {
    return compositionError(error);
  }
}

function compositionError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "The composition could not be saved. Try again.",
  );
  const status = message.includes("not found") ? 404 : 400;
  return Response.json(
    { error: "composition_request_failed", message },
    { status },
  );
}
