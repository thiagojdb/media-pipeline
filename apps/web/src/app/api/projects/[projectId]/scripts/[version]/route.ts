import { getProjectScriptVersion } from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = {
  params: Promise<{ projectId: string; version: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId, version: rawVersion } = await context.params;
    const version = Number(rawVersion);
    if (!Number.isSafeInteger(version) || version < 1) {
      return Response.json(
        { error: "script_not_found", message: "Script version was not found." },
        { status: 404 },
      );
    }
    return Response.json(await getProjectScriptVersion(projectId, version));
  } catch (error) {
    const message = publicProjectError(
      error,
      "The script request failed. Try again.",
    );
    const status = message.includes("not found") ? 404 : 500;
    return Response.json(
      { error: "script_request_failed", message },
      { status },
    );
  }
}
