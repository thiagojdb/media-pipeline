import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ComponentAuthoringLoop } from "./loop.js";
import {
  RealPiAuthoringAgent,
  assertRealPiActivation,
} from "./real-pi-agent.js";
import { ComponentAuthoringService } from "./service.js";
import { InMemoryAuthoringTurnStore } from "./store.js";
import type { AuthoringTurn } from "./types.js";
import { AuthoringWorkspaceManager } from "./workspace.js";

if (process.env.AUTHORING_PI_SMOKE_CONFIRM !== "spend-model-tokens")
  throw new Error(
    "Refusing paid Pi smoke. Set AUTHORING_PI_SMOKE_CONFIRM=spend-model-tokens explicitly.",
  );
const model = process.env.AUTHORING_PI_MODEL ?? "";
const maxWallTimeMs = numberEnv("AUTHORING_PI_SMOKE_MAX_WALL_MS", 60_000);
const maxTokens = numberEnv("AUTHORING_PI_SMOKE_MAX_TOKENS", 4_000);
const maxCostUsd = numberEnv("AUTHORING_PI_SMOKE_MAX_COST_USD", 0.25);
const baseSource = "export const candidate = true;";
const turn: AuthoringTurn = {
  id: "paid-pi-smoke",
  channelId: "pi-smoke-channel",
  threadId: "pi-smoke-thread",
  turnId: `pi-smoke-${Date.now()}`,
  userRequest:
    "Preserve this deterministic candidate and add a concise Relay authoring comment.",
  acceptanceCriteria: ["Call every required readiness tool."],
  baseSource,
  baseSourceHash: createHash("sha256").update(baseSource).digest("hex"),
  channelThemeJson: "{}",
  assetsMetadataJson: "{}",
  priorSummaries: [],
  state: "queued",
  attempt: 0,
  maxAttempts: 1,
  cancelRequested: false,
  maxWallTimeMs,
  maxModelTurns: 4,
  maxToolCalls: 10,
  maxTokens,
  maxCostUsd,
  priorToolCalls: 0,
  priorModelTurns: 0,
  priorInputTokens: 0,
  priorOutputTokens: 0,
  priorCacheReadTokens: 0,
  priorCacheWriteTokens: 0,
  priorCostUsd: 0,
  priorWallTimeMs: 0,
};
assertRealPiActivation(turn, model);

const root = await mkdtemp(path.join(os.tmpdir(), "relay-pi-smoke-"));
const sessions = await mkdtemp(path.join(os.tmpdir(), "relay-pi-sessions-"));
try {
  const store = new InMemoryAuthoringTurnStore([turn]);
  const workerId = "paid-pi-smoke-worker";
  const service = new ComponentAuthoringService(
    store,
    new AuthoringWorkspaceManager(root),
    new RealPiAuthoringAgent(
      model,
      sessions,
      process.env.AUTHORING_PI_CREDENTIAL_JSON,
    ),
    workerId,
    fileURLToPath(new URL("../../../..", import.meta.url)),
  );
  await new ComponentAuthoringLoop(store, service, workerId).tick();
  const completed = store.turns.get(turn.id);
  if (completed?.state !== "candidate_submitted")
    throw new Error(`Paid Pi smoke ended in ${completed?.state ?? "missing"}.`);
  console.log(
    JSON.stringify({
      result: "passed",
      mode: "real-pi-explicit",
      model,
      state: completed.state,
      activities: store.activities.length,
      maxTokens,
      maxCostUsd,
      maxWallTimeMs,
    }),
  );
} finally {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(sessions, { recursive: true, force: true }),
  ]);
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive number.`);
  return value;
}
