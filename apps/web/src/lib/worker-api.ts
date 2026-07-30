export const MAX_WORKER_REQUEST_BYTES = 1_000_000;

export function resolveWorkerConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { enabled: false } | { enabled: true; baseUrl: string; authToken?: string } {
  const baseUrl = environment.RELAY_WORKER_URL?.trim();
  if (!baseUrl) return { enabled: false };
  const authToken = environment.RELAY_WORKER_AUTH_TOKEN?.trim();
  return {
    enabled: true,
    baseUrl,
    ...(authToken ? { authToken } : {}),
  };
}

export async function readBoundedRequestBody(
  request: Request,
  maximumBytes = MAX_WORKER_REQUEST_BYTES,
): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new WorkerRequestTooLargeError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new WorkerRequestTooLargeError();
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export class WorkerRequestTooLargeError extends Error {
  constructor() {
    super("Draft render request exceeds the 1 MB limit.");
    this.name = "WorkerRequestTooLargeError";
  }
}

export async function forwardWorkerRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const worker = resolveWorkerConfiguration();
  if (!worker.enabled) {
    return Response.json(
      {
        error: "worker_unavailable",
        message: "Worker-backed features are not enabled in this environment.",
      },
      { status: 503 },
    );
  }
  try {
    const upstream = await fetch(new URL(path, worker.baseUrl), {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(worker.authToken
          ? { authorization: `Bearer ${worker.authToken}` }
          : {}),
        ...init?.headers,
      },
    });
    const headers = new Headers();
    for (const name of [
      "content-disposition",
      "content-length",
      "content-security-policy",
      "content-type",
      "x-content-type-options",
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return Response.json(
      {
        error: "worker_unavailable",
        message: "The render worker is unavailable. Start it and try again.",
      },
      { status: 503 },
    );
  }
}
