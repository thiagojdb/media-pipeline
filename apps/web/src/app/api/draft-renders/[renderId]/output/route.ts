import { forwardWorkerRequest } from "@/lib/worker-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ renderId: string }> },
) {
  const { renderId } = await params;
  return forwardWorkerRequest(
    `/draft-renders/${encodeURIComponent(renderId)}/output`,
  );
}
