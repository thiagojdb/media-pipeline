import { v } from "convex/values";

import { query } from "./_generated/server";

export const availability = query({
  args: {
    componentBuildToken: v.optional(v.string()),
    authoringToken: v.optional(v.string()),
    narrationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const componentBuild = authorizeOptional(
      args.componentBuildToken,
      process.env.COMPONENT_BUILD_WORKER_TOKEN,
      "component build",
    );
    const componentAuthoring = authorizeOptional(
      args.authoringToken,
      process.env.AUTHORING_WORKER_TOKEN,
      "authoring",
    );
    const narration = authorizeOptional(
      args.narrationToken,
      process.env.NARRATION_WORKER_TOKEN,
      "narration",
    );
    if (!componentBuild && !componentAuthoring && !narration) {
      throw new Error("At least one worker queue token is required.");
    }

    const [componentBuildJob, authoringTurn, narrationJob, projectRenderJob] =
      await Promise.all([
        componentBuild
          ? ctx.db
              .query("componentBuildJobs")
              .withIndex("by_state_created", (q) => q.eq("state", "queued"))
              .first()
          : null,
        componentAuthoring
          ? ctx.db
              .query("authoringTurns")
              .withIndex("by_state_created", (q) => q.eq("state", "queued"))
              .first()
          : null,
        narration
          ? ctx.db
              .query("narrationJobs")
              .withIndex("by_state_created", (q) => q.eq("state", "queued"))
              .first()
          : null,
        narration
          ? ctx.db
              .query("projectRenderJobs")
              .withIndex("by_state_created", (q) => q.eq("state", "queued"))
              .first()
          : null,
      ]);

    return {
      componentBuild: componentBuildJob !== null,
      componentAuthoring: authoringTurn !== null,
      narration: narrationJob !== null,
      projectRender: projectRenderJob !== null,
    };
  },
});

function authorizeOptional(
  provided: string | undefined,
  expected: string | undefined,
  boundary: string,
): boolean {
  if (provided === undefined) return false;
  if (!expected || provided !== expected) {
    throw new Error(`Unauthorized ${boundary} worker.`);
  }
  return true;
}
