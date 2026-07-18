import { forwardWorkerRequest } from "@/lib/worker-api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ renderId: string }> },
) {
  const { renderId } = await params;
  return forwardWorkerRequest(
    `/draft-renders/${encodeURIComponent(renderId)}/cancel`,
    { method: "POST" },
  );
}
