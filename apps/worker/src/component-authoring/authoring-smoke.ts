import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DeterministicFakeAuthoringAgent } from "./fake-agent.js";
import { ComponentAuthoringLoop } from "./loop.js";
import { ComponentAuthoringService } from "./service.js";
import { InMemoryAuthoringTurnStore } from "./store.js";
import type { AuthoringTurn } from "./types.js";
import { AuthoringWorkspaceManager } from "./workspace.js";

const root = await mkdtemp(path.join(os.tmpdir(), "relay-authoring-smoke-"));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const baseSource = "export const candidate = true;";
const turn: AuthoringTurn = {
  id: "authoring-smoke-turn",
  channelId: "smoke-channel",
  threadId: "smoke-thread",
  turnId: "smoke-turn-001",
  userRequest: "Create a deterministic component candidate.",
  acceptanceCriteria: ["Use the public SDK.", "Remain deterministic."],
  baseSource,
  baseSourceHash: createHash("sha256").update(baseSource).digest("hex"),
  channelThemeJson: JSON.stringify({ colors: { accent: "#00c2ff" } }),
  assetsMetadataJson: JSON.stringify({ assets: [] }),
  priorSummaries: [],
  state: "queued",
  attempt: 0,
  maxAttempts: 1,
  rootTurnId: "smoke-turn",
  repairAttempt: 0,
  maxRepairAttempts: 2,
  cancelRequested: false,
  maxWallTimeMs: 10_000,
  maxModelTurns: 3,
  maxToolCalls: 8,
  maxTokens: 2_000,
  maxCostUsd: 0.1,
  priorToolCalls: 0,
  priorModelTurns: 0,
  priorInputTokens: 0,
  priorOutputTokens: 0,
  priorCacheReadTokens: 0,
  priorCacheWriteTokens: 0,
  priorCostUsd: 0,
  priorWallTimeMs: 0,
};
try {
  const store = new InMemoryAuthoringTurnStore([turn]);
  const workerId = "authoring-smoke-worker";
  const workspaces = new AuthoringWorkspaceManager(root);
  const service = new ComponentAuthoringService(
    store,
    workspaces,
    new DeterministicFakeAuthoringAgent(),
    workerId,
    repositoryRoot,
  );
  const loop = new ComponentAuthoringLoop(store, service, workerId);
  await loop.tick();
  const result = store.turns.get(turn.id);
  const handoff = store.buildJobs.get(`build:${turn.id}`);
  if (result?.state !== "candidate_submitted" || !handoff)
    throw new Error("Free authoring smoke did not reach MED-133 handoff.");
  if ((await readdir(root)).length !== 0)
    throw new Error("Authoring workspace was not removed.");
  console.log(
    JSON.stringify({
      result: "passed",
      mode: "deterministic-fake",
      providerCalls: 0,
      state: result.state,
      buildJobId: `build:${turn.id}`,
      toolActivity: store.activities.map(({ name }) => name),
      candidateSourceHash: handoff.candidateSourceHash,
      contextHash: handoff.contextHash,
      workspaceCleanup: "passed",
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
