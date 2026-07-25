import { z } from "zod";

import {
  addProjectFileSource,
  addProjectUrlSource,
  listProjectSources,
  prepareProjectFileUpload,
  removeProjectSource,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const sourceActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_url"),
    title: z.string().trim().min(1).max(200),
    url: z.string().trim().min(1).max(2_048),
  }),
  z.object({
    action: z.literal("prepare_file"),
    fileName: z.string().trim().min(1).max(255),
    mediaType: z.string().trim().min(1).max(200),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
  }),
  z.object({
    action: z.literal("finalize_file"),
    title: z.string().trim().min(1).max(200),
    fileName: z.string().trim().min(1).max(255),
    mediaType: z.string().trim().min(1).max(200),
    storageId: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("remove"),
    sourceId: z.string().min(1).max(200),
  }),
]);

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json({ sources: await listProjectSources(projectId) });
  } catch (error) {
    return sourceError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = sourceActionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_source_request",
          message:
            parsed.error.issues[0]?.message ?? "Source details are invalid.",
        },
        { status: 400 },
      );
    }
    switch (parsed.data.action) {
      case "add_url":
        return Response.json(
          await addProjectUrlSource(projectId, {
            title: parsed.data.title,
            url: parsed.data.url,
          }),
          { status: 201 },
        );
      case "prepare_file":
        return Response.json(
          await prepareProjectFileUpload(projectId, {
            fileName: parsed.data.fileName,
            mediaType: parsed.data.mediaType,
            byteSize: parsed.data.byteSize,
          }),
        );
      case "finalize_file":
        return Response.json(
          await addProjectFileSource(projectId, {
            title: parsed.data.title,
            fileName: parsed.data.fileName,
            mediaType: parsed.data.mediaType,
            storageId: parsed.data.storageId,
          }),
          { status: 201 },
        );
      case "remove":
        await removeProjectSource(projectId, parsed.data.sourceId);
        return Response.json({ sourceId: parsed.data.sourceId });
    }
  } catch (error) {
    return sourceError(error);
  }
}

function sourceError(error: unknown): Response {
  const message = publicProjectError(
    error,
    "The source request failed. Try again.",
  );
  const status = message.includes("not found")
    ? 404
    : /(?:allowed|required|valid|limit|credentials|secret|match|contain data)/i.test(
          message,
        )
      ? 400
      : 500;
  return Response.json({ error: "source_request_failed", message }, { status });
}
