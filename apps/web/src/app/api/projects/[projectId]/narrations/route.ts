import { z } from "zod";

import {
  approveNarrationAlignment,
  cancelProjectNarration,
  finalizeNarrationUpload,
  listProjectNarrations,
  prepareNarrationUpload,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    jobId: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("prepare_upload"),
    planVersionId: z.string().min(1).max(200),
    fileName: z.string().trim().min(1).max(255),
    mediaType: z.string().trim().min(1).max(100),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
  }),
  z.object({
    action: z.literal("finalize_upload"),
    planVersionId: z.string().min(1).max(200),
    storageId: z.string().min(1).max(200),
    fileName: z.string().trim().min(1).max(255),
    mediaType: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("approve_alignment"),
    narrationVersionId: z.string().min(1).max(200),
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
    let result:
      | { jobId: string }
      | { uploadUrl: string; maximumBytes: number }
      | { narrationVersionId: string; version: number };
    switch (parsed.data.action) {
      case "cancel":
        result = await cancelProjectNarration(projectId, parsed.data.jobId);
        break;
      case "prepare_upload":
        result = await prepareNarrationUpload(projectId, {
          planVersionId: parsed.data.planVersionId,
          fileName: parsed.data.fileName,
          mediaType: parsed.data.mediaType,
          byteSize: parsed.data.byteSize,
        });
        break;
      case "finalize_upload":
        result = await finalizeNarrationUpload(projectId, {
          planVersionId: parsed.data.planVersionId,
          storageId: parsed.data.storageId,
          fileName: parsed.data.fileName,
          mediaType: parsed.data.mediaType,
        });
        break;
      case "approve_alignment":
        result = await approveNarrationAlignment(
          projectId,
          parsed.data.narrationVersionId,
        );
        break;
    }
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
