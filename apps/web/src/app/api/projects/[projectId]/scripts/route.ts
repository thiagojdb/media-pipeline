import { z } from "zod";

import {
  listProjectScriptVersions,
  saveProjectScriptVersion,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const saveSchema = z.object({
  content: z
    .string()
    .max(100_000)
    .refine((content) => content.trim().length > 0, {
      message: "Script content is required.",
    }),
  provenance: z.enum(["manual", "import"]),
});

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json(await listProjectScriptVersions(projectId));
  } catch (error) {
    return scriptError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = saveSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message =
        issue?.code === "too_big"
          ? "Script content must be at most 100,000 characters."
          : (issue?.message ?? "Script input is invalid.");
      return Response.json(
        { error: "invalid_script", message },
        { status: 400 },
      );
    }
    return Response.json(
      await saveProjectScriptVersion(projectId, parsed.data),
      { status: 201 },
    );
  } catch (error) {
    return scriptError(error);
  }
}

function scriptError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "The script request failed. Try again.",
  );
  const status = message.includes("not found") ? 404 : 500;
  return Response.json({ error: "script_request_failed", message }, { status });
}
