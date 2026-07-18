import { createReadStream } from "node:fs";
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

const MAX_REQUEST_BYTES = 1_000_000;

export const createWorkerServer = ({
  draftRenders,
  componentBuildsEnabled = false,
  componentBuildStatus,
}: {
  readonly draftRenders?: DraftRenderService;
  readonly componentBuildsEnabled?: boolean;
  readonly componentBuildStatus?: () =>
    "disabled" | "running" | "degraded" | "stopped";
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
        });
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
      if (error instanceof DraftRenderRequestError) {
        sendJson(response, error.status, {
          error: error.code,
          message: error.message,
        });
        return;
      }
      sendJson(response, 500, {
        error: "worker_error",
        message: "The worker could not process this request.",
      });
    }
  });

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
