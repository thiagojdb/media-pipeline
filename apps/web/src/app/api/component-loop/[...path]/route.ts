import {
  forwardWorkerRequest,
  readBoundedRequestBody,
  WorkerRequestTooLargeError,
} from "@/lib/worker-api";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(_request: Request, context: RouteContext) {
  const { path } = await context.params;
  return forwardWorkerRequest(`/component-loop/${path.join("/")}`);
}

export async function POST(request: Request, context: RouteContext) {
  const { path } = await context.params;
  try {
    return forwardWorkerRequest(`/component-loop/${path.join("/")}`, {
      method: "POST",
      body: await readBoundedRequestBody(request),
    });
  } catch (error) {
    if (error instanceof WorkerRequestTooLargeError) {
      return Response.json(
        { error: "request_too_large", message: error.message },
        { status: 413 },
      );
    }
    throw error;
  }
}
