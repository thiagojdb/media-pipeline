import os from "node:os";
import path from "node:path";

import {
  createFakeDraftRenderExecutor,
  DraftRenderService,
} from "./draft-render-service.js";
import { RemotionDraftRenderExecutor } from "./remotion-draft-renderer.js";
import { createWorkerServer } from "./server.js";

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
const server = createWorkerServer({ draftRenders });

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
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
