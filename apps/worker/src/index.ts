import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DraftRenderService } from "./draft-render-service.js";
import { RemotionDraftRenderExecutor } from "./remotion-draft-renderer.js";
import { createWorkerServer } from "./server.js";
import { IsolatedCandidateExecutor } from "./component-build/executor.js";
import { ComponentBuildLoop } from "./component-build/loop.js";
import { ComponentBuildService } from "./component-build/service.js";
import { ConvexComponentBuildJobStore } from "./component-build/store.js";
import { CandidateWorkspaceManager } from "./component-build/workspace.js";
import { ComponentAuthoringLoop } from "./component-authoring/loop.js";
import { ComponentAuthoringService } from "./component-authoring/service.js";
import { ConvexAuthoringTurnStore } from "./component-authoring/store.js";
import { AuthoringWorkspaceManager } from "./component-authoring/workspace.js";
import { ComponentLoopService } from "./component-loop-service.js";
import { RealPiDialogueAgent } from "./component-dialogue-agent.js";
import { NarrationLoop, OpenAIWhisperAligner } from "./narration-loop.js";
import {
  BrowserProjectRenderExecutor,
  ProjectRenderLoop,
} from "./project-render-loop.js";
import { createScriptRevisionAgentFromEnvironment } from "./script-revision-agent.js";
import { WorkerQueueCoordinator } from "./worker-queue-coordinator.js";

const port = Number.parseInt(process.env.WORKER_PORT ?? "3212", 10);
lowerWorkerPriority();
const executor = new RemotionDraftRenderExecutor();
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
const authoringUrl = process.env.AUTHORING_CONVEX_URL;
const authoringToken = process.env.AUTHORING_WORKER_TOKEN;
const relayPiSessionRoot = path.resolve(
  process.env.AUTHORING_PI_SESSION_ROOT ?? ".relay/relay-agent-sessions",
);
if (authoringEnabled && (!authoringUrl || !authoringToken)) {
  throw new Error(
    "AUTHORING_ENABLED=true requires AUTHORING_CONVEX_URL and AUTHORING_WORKER_TOKEN.",
  );
}
if (
  authoringEnabled &&
  (process.env.AUTHORING_REAL_PI_ENABLED !== "true" ||
    !process.env.AUTHORING_PI_MODEL?.includes("/") ||
    !process.env.AUTHORING_PI_CREDENTIAL_JSON)
)
  throw new Error(
    "Component authoring requires AUTHORING_REAL_PI_ENABLED=true, exact AUTHORING_PI_MODEL=provider/model, and server-only AUTHORING_PI_CREDENTIAL_JSON.",
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
  const agent = new (
    await import("./component-authoring/real-pi-agent.js")
  ).RealPiAuthoringAgent(
    process.env.AUTHORING_PI_MODEL ?? "",
    relayPiSessionRoot,
    process.env.AUTHORING_PI_CREDENTIAL_JSON,
  );
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

const componentLoopEnabled = process.env.COMPONENT_LOOP_ENABLED === "true";
const componentLoopToken = process.env.COMPONENT_LOOP_WORKER_TOKEN;
if (componentLoopEnabled && (!authoringUrl || !componentLoopToken)) {
  throw new Error(
    "COMPONENT_LOOP_ENABLED=true requires AUTHORING_CONVEX_URL and COMPONENT_LOOP_WORKER_TOKEN.",
  );
}
const componentLoop =
  componentLoopEnabled && authoringUrl && componentLoopToken
    ? new ComponentLoopService(
        authoringUrl,
        componentLoopToken,
        process.env.AUTHORING_PI_MODEL,
        new RealPiDialogueAgent(
          process.env.AUTHORING_PI_MODEL ?? "",
          relayPiSessionRoot,
          process.env.AUTHORING_PI_CREDENTIAL_JSON,
        ),
      )
    : undefined;
const scriptRevisionAgent =
  process.env.KIMI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()
    ? createScriptRevisionAgentFromEnvironment()
    : undefined;

const narrationEnabled = process.env.NARRATION_ENABLED === "true";
const narrationUrl = process.env.NARRATION_CONVEX_URL;
const narrationToken = process.env.NARRATION_WORKER_TOKEN;
if (narrationEnabled && (!narrationUrl || !narrationToken)) {
  throw new Error(
    "NARRATION_ENABLED=true requires NARRATION_CONVEX_URL and NARRATION_WORKER_TOKEN.",
  );
}
const narrationOpenAIApiKey =
  process.env.NARRATION_OPENAI_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim();
const narrationAligner = narrationOpenAIApiKey
  ? new OpenAIWhisperAligner(
      narrationOpenAIApiKey,
      process.env.NARRATION_OPENAI_MODEL ?? "whisper-1",
      process.env.NARRATION_OPENAI_BASE_URL,
    )
  : {
      async transcribe(): Promise<never> {
        throw new Error(
          "Real narration alignment requires NARRATION_OPENAI_API_KEY or OPENAI_API_KEY.",
        );
      },
    };
const narrationLoop =
  narrationEnabled && narrationUrl && narrationToken
    ? new NarrationLoop(narrationUrl, narrationToken, narrationAligner)
    : undefined;
narrationLoop?.start();

const projectRenderLoop =
  narrationEnabled && narrationUrl && narrationToken
    ? new ProjectRenderLoop(
        narrationUrl,
        narrationToken,
        new BrowserProjectRenderExecutor(
          process.env.RELAY_COMPONENT_PREVIEW_ORIGIN ??
            `http://127.0.0.1:${port}`,
        ),
      )
    : undefined;
projectRenderLoop?.start();

const queueCoordinators = [
  ...(componentBuildLoop && buildUrl && buildToken
    ? [
        new WorkerQueueCoordinator(
          buildUrl,
          { componentBuildToken: buildToken },
          { componentBuild: () => componentBuildLoop.wake() },
        ),
      ]
    : []),
  ...(authoringLoop && authoringUrl && authoringToken
    ? [
        new WorkerQueueCoordinator(
          authoringUrl,
          { authoringToken },
          { componentAuthoring: () => authoringLoop.wake() },
        ),
      ]
    : []),
  ...(narrationLoop && projectRenderLoop && narrationUrl && narrationToken
    ? [
        new WorkerQueueCoordinator(
          narrationUrl,
          { narrationToken },
          {
            narration: () => narrationLoop.wake(),
            projectRender: () => projectRenderLoop.wake(),
          },
        ),
      ]
    : []),
];
for (const coordinator of queueCoordinators) coordinator.start();

const server = createWorkerServer({
  ...(process.env.RELAY_WORKER_AUTH_TOKEN
    ? { authToken: process.env.RELAY_WORKER_AUTH_TOKEN }
    : {}),
  ...(process.env.RELAY_INSTANCE_ID
    ? { instanceId: process.env.RELAY_INSTANCE_ID }
    : {}),
  draftRenders,
  componentBuildsEnabled,
  componentBuildStatus: () => componentBuildLoop?.status ?? "disabled",
  authoringStatus: () => authoringLoop?.status ?? "disabled",
  narrationStatus: () => narrationLoop?.status ?? "disabled",
  projectRenderStatus: () => projectRenderLoop?.status ?? "disabled",
  ...(componentLoop ? { componentLoop } : {}),
  ...(scriptRevisionAgent ? { scriptRevisionAgent } : {}),
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
  narrationLoop?.stop();
  projectRenderLoop?.stop();
  void Promise.all(queueCoordinators.map((coordinator) => coordinator.stop()))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      server.close((error) => {
        if (error) {
          console.error(error);
          process.exitCode = 1;
        }
      });
    });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
