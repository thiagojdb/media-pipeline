import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFakeDraftRenderExecutor,
  DraftRenderService,
} from "./draft-render-service.js";
import { RemotionDraftRenderExecutor } from "./remotion-draft-renderer.js";
import { createWorkerServer } from "./server.js";
import { IsolatedCandidateExecutor } from "./component-build/executor.js";
import { ComponentBuildLoop } from "./component-build/loop.js";
import { ComponentBuildService } from "./component-build/service.js";
import { ConvexComponentBuildJobStore } from "./component-build/store.js";
import { CandidateWorkspaceManager } from "./component-build/workspace.js";
import { DeterministicFakeAuthoringAgent } from "./component-authoring/fake-agent.js";
import { ComponentAuthoringLoop } from "./component-authoring/loop.js";
import { ComponentAuthoringService } from "./component-authoring/service.js";
import { ConvexAuthoringTurnStore } from "./component-authoring/store.js";
import { AuthoringWorkspaceManager } from "./component-authoring/workspace.js";

const port = Number.parseInt(process.env.WORKER_PORT ?? "3212", 10);
const useFakeRenderer = process.env.RELAY_RENDER_MODE === "fake";
if (!useFakeRenderer) lowerWorkerPriority();
const executor = useFakeRenderer
  ? createFakeDraftRenderExecutor()
  : new RemotionDraftRenderExecutor();
const draftRenders = new DraftRenderService(
  executor,
  path.resolve(process.env.RELAY_RENDER_OUTPUT_DIR ?? ".relay/draft-renders"),
);

const componentBuildsEnabled = process.env.COMPONENT_BUILD_ENABLED === "true";
const buildUrl = process.env.COMPONENT_BUILD_CONVEX_URL;
const buildToken = process.env.COMPONENT_BUILD_WORKER_TOKEN;
if (componentBuildsEnabled && (!buildUrl || !buildToken)) {
  throw new Error(
    "COMPONENT_BUILD_ENABLED=true requires COMPONENT_BUILD_CONVEX_URL and COMPONENT_BUILD_WORKER_TOKEN.",
  );
}
let componentBuildLoop: ComponentBuildLoop | undefined;
if (componentBuildsEnabled && buildUrl && buildToken) {
  const workerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;
  const store = new ConvexComponentBuildJobStore(buildUrl, buildToken);
  const workspaces = new CandidateWorkspaceManager(
    path.resolve(
      process.env.COMPONENT_BUILD_WORKSPACE_ROOT ??
        ".relay/component-build-workspaces",
    ),
    fileURLToPath(new URL("../scaffold/component-build", import.meta.url)),
  );
  await workspaces.cleanupOrphans();
  const service = new ComponentBuildService(
    store,
    workspaces,
    new IsolatedCandidateExecutor(),
    workerId,
  );
  componentBuildLoop = new ComponentBuildLoop(store, service, workerId);
  componentBuildLoop.start();
}
const authoringEnabled = process.env.AUTHORING_ENABLED === "true";
const authoringMode = process.env.AUTHORING_MODE ?? "fake";
const authoringUrl = process.env.AUTHORING_CONVEX_URL;
const authoringToken = process.env.AUTHORING_WORKER_TOKEN;
if (authoringEnabled && (!authoringUrl || !authoringToken)) {
  throw new Error(
    "AUTHORING_ENABLED=true requires AUTHORING_CONVEX_URL and AUTHORING_WORKER_TOKEN.",
  );
}
if (authoringEnabled && !["fake", "real"].includes(authoringMode))
  throw new Error("AUTHORING_MODE must be fake or real.");
if (
  authoringEnabled &&
  authoringMode === "real" &&
  (process.env.AUTHORING_REAL_PI_ENABLED !== "true" ||
    !process.env.AUTHORING_PI_MODEL?.includes("/") ||
    !process.env.AUTHORING_PI_CREDENTIAL_JSON)
)
  throw new Error(
    "Real authoring requires AUTHORING_REAL_PI_ENABLED=true, exact AUTHORING_PI_MODEL=provider/model, and server-only AUTHORING_PI_CREDENTIAL_JSON.",
  );
let authoringLoop: ComponentAuthoringLoop | undefined;
if (authoringEnabled && authoringUrl && authoringToken) {
  const workerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;
  const store = new ConvexAuthoringTurnStore(authoringUrl, authoringToken);
  const workspaces = new AuthoringWorkspaceManager(
    path.resolve(
      process.env.AUTHORING_WORKSPACE_ROOT ??
        ".relay/component-authoring-workspaces",
    ),
  );
  await workspaces.cleanupOrphans();
  const agent =
    authoringMode === "real"
      ? new (
          await import("./component-authoring/real-pi-agent.js")
        ).RealPiAuthoringAgent(
          process.env.AUTHORING_PI_MODEL ?? "",
          path.resolve(
            process.env.AUTHORING_PI_SESSION_ROOT ??
              ".relay/component-authoring-sessions",
          ),
          process.env.AUTHORING_PI_CREDENTIAL_JSON,
        )
      : new DeterministicFakeAuthoringAgent();
  const service = new ComponentAuthoringService(
    store,
    workspaces,
    agent,
    workerId,
    path.resolve(fileURLToPath(new URL("../../..", import.meta.url))),
  );
  authoringLoop = new ComponentAuthoringLoop(store, service, workerId);
  authoringLoop.start();
}

const server = createWorkerServer({
  draftRenders,
  componentBuildsEnabled,
  componentBuildStatus: () => componentBuildLoop?.status ?? "disabled",
  authoringStatus: () => authoringLoop?.status ?? "disabled",
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Relay worker ready at http://127.0.0.1:${port}/health`);
});

function lowerWorkerPriority(): void {
  try {
    os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch (error) {
    console.warn(
      `Could not lower render-worker priority: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

let shuttingDown = false;

const shutdown = (): void => {
  if (shuttingDown || !server.listening) {
    return;
  }

  shuttingDown = true;
  componentBuildLoop?.stop();
  authoringLoop?.stop();
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
