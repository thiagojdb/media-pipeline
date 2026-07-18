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

const buildUrl = process.env.COMPONENT_BUILD_CONVEX_URL;
const buildToken = process.env.COMPONENT_BUILD_WORKER_TOKEN;
if (Boolean(buildUrl) !== Boolean(buildToken)) {
  throw new Error(
    "COMPONENT_BUILD_CONVEX_URL and COMPONENT_BUILD_WORKER_TOKEN must be configured together.",
  );
}
const componentBuildsEnabled = Boolean(buildUrl && buildToken);
let componentBuildLoop: ComponentBuildLoop | undefined;
if (buildUrl && buildToken) {
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
const server = createWorkerServer({
  draftRenders,
  componentBuildsEnabled,
  componentBuildStatus: () => componentBuildLoop?.status ?? "disabled",
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
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
