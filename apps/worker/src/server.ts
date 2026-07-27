import { createReadStream } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  DraftRenderRequestError,
  DraftRenderService,
} from "./draft-render-service.js";
import {
  ComponentLoopRequestError,
  ComponentLoopService,
} from "./component-loop-service.js";
import {
  type ScriptRevisionAgent,
  ScriptRevisionAuthenticationError,
  scriptRevisionInputSchema,
} from "./script-revision-agent.js";

const MAX_REQUEST_BYTES = 1_000_000;

export const createWorkerServer = ({
  authToken,
  draftRenders,
  componentBuildsEnabled = false,
  componentBuildStatus,
  authoringStatus,
  narrationStatus,
  projectRenderStatus,
  componentLoop,
  scriptRevisionAgent,
}: {
  readonly authToken?: string;
  readonly draftRenders?: DraftRenderService;
  readonly componentBuildsEnabled?: boolean;
  readonly componentBuildStatus?: () =>
    "disabled" | "running" | "degraded" | "stopped";
  readonly authoringStatus?: () =>
    "disabled" | "running" | "degraded" | "stopped";
  readonly narrationStatus?: () =>
    "disabled" | "running" | "degraded" | "stopped";
  readonly projectRenderStatus?: () =>
    "disabled" | "running" | "degraded" | "stopped";
  readonly componentLoop?: ComponentLoopService;
  readonly scriptRevisionAgent?: ScriptRevisionAgent;
} = {}): Server =>
  createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://relay-worker.local");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          service: "relay-worker",
          status: "ready",
          componentBuilds:
            componentBuildStatus?.() ??
            (componentBuildsEnabled ? "running" : "disabled"),
          authoring: authoringStatus?.() ?? "disabled",
          narration: narrationStatus?.() ?? "disabled",
          projectRendering: projectRenderStatus?.() ?? "disabled",
          componentLoop: componentLoop ? "ready" : "disabled",
        });
        return;
      }

      if (authToken && !isAuthorized(request, authToken)) {
        sendJson(response, 401, {
          error: "worker_unauthorized",
          message: "The worker request is unauthorized.",
        });
        return;
      }

      if (url.pathname.startsWith("/component-loop")) {
        await handleComponentLoop(request, response, url, componentLoop);
        return;
      }
      if (url.pathname === "/script-revisions") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        if (!scriptRevisionAgent) {
          sendJson(response, 503, {
            error: "script_revision_unavailable",
            message: "Real Relay script editing is not configured.",
          });
          return;
        }
        const input = scriptRevisionInputSchema.parse(await readJson(request));
        sendJson(response, 200, await scriptRevisionAgent.generate(input));
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/script-revision-models"
      ) {
        sendJson(response, 200, scriptRevisionAgent?.listModels() ?? []);
        return;
      }

      const match = url.pathname.match(
        /^\/draft-renders(?:\/([^/]+)(?:\/(cancel|output))?)?$/,
      );
      if (!match) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      if (!draftRenders) {
        sendJson(response, 503, {
          error: "render_service_unavailable",
          message: "Draft rendering is not configured on this worker.",
        });
        return;
      }

      const [, renderId, action] = match;
      if (request.method === "POST" && !renderId) {
        const snapshot = await draftRenders.create(await readJson(request));
        sendJson(response, 202, snapshot);
        return;
      }
      if (request.method === "GET" && renderId && !action) {
        sendJson(response, 200, draftRenders.get(renderId));
        return;
      }
      if (request.method === "POST" && renderId && action === "cancel") {
        sendJson(response, 200, draftRenders.cancel(renderId));
        return;
      }
      if (request.method === "GET" && renderId && action === "output") {
        const output = await draftRenders.output(renderId);
        response.writeHead(200, {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="relay-draft-${renderId}.mp4"`,
          "content-length": output.sizeBytes,
          "content-type": "video/mp4",
          "x-content-type-options": "nosniff",
        });
        createReadStream(output.path).pipe(response);
        return;
      }

      sendJson(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      if (error instanceof ScriptRevisionAuthenticationError) {
        sendJson(response, 503, {
          error: "script_revision_authentication_required",
          message: error.message,
        });
        return;
      }
      if (error instanceof DraftRenderRequestError) {
        sendJson(response, error.status, {
          error: error.code,
          message: error.message,
        });
        return;
      }
      if (error instanceof ComponentLoopRequestError) {
        sendJson(response, error.status, {
          error: error.code,
          message: error.message,
        });
        return;
      }
      if (error instanceof Error && error.name === "ZodError") {
        sendJson(response, 400, {
          error: "invalid_request",
          message: "The component-loop request is invalid.",
        });
        return;
      }
      console.error(
        `Worker request failed safely: ${(error instanceof Error ? error.message : String(error)).replaceAll(process.cwd(), "[worker]").slice(0, 1_000)}`,
      );
      sendJson(response, 500, {
        error: "worker_error",
        message: "The worker could not process this request.",
      });
    }
  });

function isAuthorized(
  request: IncomingMessage,
  expectedToken: string,
): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return (
    provided.byteLength === expected.byteLength &&
    timingSafeEqual(provided, expected)
  );
}

async function handleComponentLoop(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  service: ComponentLoopService | undefined,
): Promise<void> {
  if (!service) {
    sendJson(response, 503, {
      error: "component_loop_unavailable",
      message: "The component loop is not configured on this worker.",
    });
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/component-loop/requests"
  ) {
    sendJson(response, 202, await service.start(await readJson(request)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/component-loop/library") {
    sendJson(response, 200, await service.library());
    return;
  }
  const libraryComponent = url.pathname.match(
    /^\/component-loop\/library\/([^/]+)$/,
  );
  if (request.method === "GET" && libraryComponent) {
    sendJson(
      response,
      200,
      await service.libraryComponent(decodeURIComponent(libraryComponent[1]!)),
    );
    return;
  }
  const revisionConversation = url.pathname.match(
    /^\/component-loop\/versions\/([^/]+)\/revision-thread$/,
  );
  if (request.method === "POST" && revisionConversation) {
    sendJson(
      response,
      201,
      await service.startRevisionConversation(revisionConversation[1]!),
    );
    return;
  }
  const thread = url.pathname.match(
    /^\/component-loop\/threads\/([^/]+)(?:\/(revisions|messages))?$/,
  );
  if (request.method === "GET" && thread && !thread[2]) {
    sendJson(response, 200, await service.status(thread[1]!));
    return;
  }
  if (request.method === "POST" && thread?.[2] === "revisions") {
    sendJson(
      response,
      202,
      await service.revise(thread[1]!, await readJson(request)),
    );
    return;
  }
  if (request.method === "POST" && thread?.[2] === "messages") {
    sendJson(
      response,
      202,
      await service.send(thread[1]!, await readJson(request)),
    );
    return;
  }
  const candidateArtifact = url.pathname.match(
    /^\/component-loop\/candidates\/([^/]+)\/(source|preview)$/,
  );
  if (request.method === "GET" && candidateArtifact) {
    if (candidateArtifact[2] === "source") {
      sendText(
        response,
        200,
        await service.candidateSource(candidateArtifact[1]!),
        "text/plain; charset=utf-8",
      );
    } else {
      sendText(
        response,
        200,
        await service.candidatePreview(
          candidateArtifact[1]!,
          previewOptions(url),
        ),
        "text/html; charset=utf-8",
      );
    }
    return;
  }
  const versionPreview = url.pathname.match(
    /^\/component-loop\/versions\/([^/]+)\/preview$/,
  );
  if (request.method === "GET" && versionPreview) {
    sendText(
      response,
      200,
      await service.versionPreview(versionPreview[1]!, previewOptions(url)),
      "text/html; charset=utf-8",
    );
    return;
  }
  const candidate = url.pathname.match(
    /^\/component-loop\/candidates\/([^/]+)\/(approve|reject|request-changes)$/,
  );
  if (request.method === "POST" && candidate) {
    if (candidate[2] === "approve") {
      sendJson(response, 200, await service.approve(candidate[1]!));
    } else {
      sendJson(
        response,
        200,
        await service.decide(
          candidate[1]!,
          candidate[2] === "reject" ? "reject" : "requestChanges",
          await readJson(request),
        ),
      );
    }
    return;
  }
  sendJson(response, 405, { error: "method_not_allowed" });
}

function previewOptions(url: URL): {
  fixtureId?: string;
  frame?: number;
  theme?: unknown;
  input?: unknown;
} {
  const fixtureId = url.searchParams.get("fixture") ?? undefined;
  const rawFrame = url.searchParams.get("frame");
  const frame = rawFrame === null ? undefined : Number(rawFrame);
  const rawTheme = url.searchParams.get("theme");
  let theme: unknown;
  if (rawTheme) {
    try {
      theme = JSON.parse(Buffer.from(rawTheme, "base64url").toString("utf8"));
    } catch {
      throw new ComponentLoopRequestError(
        "invalid_preview_theme",
        "Preview theme is invalid.",
        400,
      );
    }
  }
  const rawInput = url.searchParams.get("input");
  let input: unknown;
  if (rawInput) {
    if (rawInput.length > 16_384) {
      throw new ComponentLoopRequestError(
        "invalid_preview_input",
        "Preview input is too large.",
        400,
      );
    }
    try {
      input = JSON.parse(Buffer.from(rawInput, "base64url").toString("utf8"));
    } catch {
      throw new ComponentLoopRequestError(
        "invalid_preview_input",
        "Preview input is invalid.",
        400,
      );
    }
  }
  return {
    ...(fixtureId ? { fixtureId: fixtureId.slice(0, 200) } : {}),
    ...(frame !== undefined && Number.isFinite(frame) ? { frame } : {}),
    ...(theme !== undefined ? { theme } : {}),
    ...(input !== undefined ? { input } : {}),
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      throw new DraftRenderRequestError(
        "request_too_large",
        "Draft render request exceeds the 1 MB limit.",
        413,
      );
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new DraftRenderRequestError(
      "invalid_json",
      "Draft render request must be valid JSON.",
      400,
    );
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
): void {
  response.writeHead(status, {
    "cache-control": "private, no-store",
    "content-security-policy": contentType.startsWith("text/html")
      ? "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:"
      : "sandbox; default-src 'none'",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}
