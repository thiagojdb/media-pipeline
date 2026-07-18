import { createHash } from "node:crypto";

import type { AuthoringAgent, AgentRunResult } from "./types.js";

export class DeterministicFakeAuthoringAgent implements AuthoringAgent {
  async run({
    turn,
    workspace,
    tools,
    signal,
  }: Parameters<AuthoringAgent["run"]>[0]): Promise<AgentRunResult> {
    const started = Date.now();
    const usage = () => ({
      toolCalls: tools.toolCalls,
      modelTurns: turn.userRequest.includes("[FAKE_TURN_LIMIT]")
        ? turn.maxModelTurns + 1
        : turn.priorModelTurns + 1,
      inputTokens: turn.userRequest.includes("[FAKE_TOKEN_LIMIT]")
        ? turn.maxTokens
        : turn.priorInputTokens + Math.min(20, Math.floor(turn.maxTokens / 2)),
      outputTokens: turn.userRequest.includes("[FAKE_TOKEN_LIMIT]")
        ? turn.priorOutputTokens + 1
        : turn.priorOutputTokens + 10,
      cacheReadTokens: turn.priorCacheReadTokens,
      cacheWriteTokens: turn.priorCacheWriteTokens,
      costUsd: turn.userRequest.includes("[FAKE_COST_LIMIT]")
        ? turn.maxCostUsd + 0.01
        : turn.priorCostUsd,
      wallTimeMs: turn.priorWallTimeMs + (Date.now() - started),
    });
    if (turn.userRequest.includes("[FAKE_TIMEOUT]")) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, turn.maxWallTimeMs + 1_000);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      return {
        status: "budget_exhausted",
        code: "wall_time_exhausted",
        message: "Fake authoring wall-time budget exhausted.",
        assistantSummary: "Timed out deterministically.",
        sessionRef: `fake:${turn.threadId}`,
        ...usage(),
      };
    }
    if (signal.aborted || turn.userRequest.includes("[FAKE_CANCEL]")) {
      return {
        status: "canceled",
        code: "authoring_canceled",
        message: "Fake authoring canceled.",
        assistantSummary: "Canceled deterministically.",
        sessionRef: `fake:${turn.threadId}`,
        ...usage(),
      };
    }
    if (turn.userRequest.includes("[FAKE_FAILURE]")) {
      return {
        status: "failed",
        code: "fake_agent_failure",
        message: "Deterministic fake-agent failure.",
        assistantSummary: "Failed deterministically.",
        sessionRef: `fake:${turn.threadId}`,
        ...usage(),
      };
    }

    await tools.readContext();
    if (turn.userRequest.includes("[FAKE_TOOL_LIMIT]")) {
      for (let index = 0; index <= turn.maxToolCalls; index += 1)
        await tools.readContext();
    }
    const base = await workspace.readCandidate();
    const requestHash = createHash("sha256")
      .update(turn.userRequest)
      .digest("hex")
      .slice(0, 12);
    await tools.replaceCandidate(
      `${base.trimEnd()}\n// Relay deterministic authoring turn ${requestHash}\n`,
    );
    await tools.checkCandidate();
    await tools.declareReady(
      "Deterministic candidate prepared for validation.",
    );
    return {
      status: "candidate_ready",
      code: "candidate_ready",
      message: "Candidate declared ready for independent validation.",
      assistantSummary:
        "Deterministic candidate prepared from the exact base source.",
      sessionRef: `fake:${turn.threadId}`,
      ...usage(),
    };
  }
}
