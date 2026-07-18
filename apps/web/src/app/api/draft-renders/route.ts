import {
  forwardWorkerRequest,
  readBoundedRequestBody,
  WorkerRequestTooLargeError,
} from "@/lib/worker-api";

export async function POST(request: Request) {
  try {
    return forwardWorkerRequest("/draft-renders", {
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
