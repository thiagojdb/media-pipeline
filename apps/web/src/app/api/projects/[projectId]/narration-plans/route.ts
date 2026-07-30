import { z } from "zod";

import {
  approveProjectNarrationPlan,
  createProjectNarrationPlan,
  listProjectNarrationPlans,
  updateProjectNarrationPlan,
} from "@/lib/project-api";
import { publicProjectError } from "@/lib/project-errors";

type RouteContext = { params: Promise<{ projectId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    scriptVersionId: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("update"),
    planVersionId: z.string().min(1).max(200),
    cues: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          sourceStart: z.number().int().nonnegative(),
          sourceEnd: z.number().int().positive(),
          text: z.string().trim().min(1).max(4_000),
        }),
      )
      .min(1)
      .max(500),
  }),
  z.object({
    action: z.literal("approve"),
    planVersionId: z.string().min(1).max(200),
  }),
]);

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    return Response.json(await listProjectNarrationPlans(projectId));
  } catch (error) {
    return planError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_narration_plan_action",
          message:
            parsed.error.issues[0]?.message ??
            "Narration plan action is invalid.",
        },
        { status: 400 },
      );
    }
    switch (parsed.data.action) {
      case "create":
        return Response.json(
          await createProjectNarrationPlan(
            projectId,
            parsed.data.scriptVersionId,
          ),
          { status: 201 },
        );
      case "update":
        return Response.json(
          await updateProjectNarrationPlan(
            projectId,
            parsed.data.planVersionId,
            parsed.data.cues,
          ),
        );
      case "approve":
        return Response.json(
          await approveProjectNarrationPlan(
            projectId,
            parsed.data.planVersionId,
          ),
        );
    }
  } catch (error) {
    return planError(error);
  }
}

function planError(error: unknown) {
  const message = publicProjectError(
    error,
    "The narration plan request failed. Try again.",
  );
  return Response.json(
    { error: "narration_plan_request_failed", message },
    { status: message.includes("not found") ? 404 : 500 },
  );
}
