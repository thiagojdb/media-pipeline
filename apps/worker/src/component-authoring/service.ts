import { createHash } from "node:crypto";

import { buildAuthoringContext } from "./context.js";
import { RelayAuthoringTools } from "./tools.js";
import type {
  AgentRunResult,
  AuthoringAgent,
  AuthoringFailure,
  AuthoringTurn,
  AuthoringTurnStore,
  AuthoringUsage,
} from "./types.js";
import { AuthoringWorkspaceManager } from "./workspace.js";

export class ComponentAuthoringService {
  constructor(
    private readonly store: AuthoringTurnStore,
    private readonly workspaces: AuthoringWorkspaceManager,
    private readonly agent: AuthoringAgent,
    private readonly workerId: string,
    private readonly repositoryRoot: string,
    private readonly leaseMs = 30_000,
  ) {}

  async runClaimed(turn: AuthoringTurn): Promise<void> {
    const controller = new AbortController();
    const started = Date.now();
    let workspace:
      Awaited<ReturnType<AuthoringWorkspaceManager["create"]>> | undefined;
    let tools: RelayAuthoringTools | undefined;
    const timeout = setTimeout(
      () => controller.abort(),
      remainingWallTime(turn),
    );
    const monitor = setInterval(
      () =>
        void this.monitor(turn, controller).catch((error) => {
          console.error(`Authoring heartbeat failed safely: ${safe(error)}`);
          controller.abort();
        }),
      Math.max(1_000, Math.floor(this.leaseMs / 3)),
    );
    let lastResult: AgentRunResult | undefined;
    try {
      const current = await this.store.get(turn.id);
      if (!current || current.cancelRequested) {
        await this.finish(
          turn,
          failure(
            "canceled",
            "authoring_canceled",
            "Authoring canceled before execution.",
            turn,
            started,
          ),
        );
        return;
      }
      const context = await buildAuthoringContext(turn, this.repositoryRoot);
      workspace = await this.workspaces.create(context.json, turn.baseSource);
      tools = new RelayAuthoringTools(
        turn,
        workspace,
        controller.signal,
        (activity) =>
          this.store.recordActivity(
            turn.id,
            this.workerId,
            turn.attempt,
            activity,
          ),
      );
      lastResult = await this.agent.run({
        turn,
        workspace,
        tools,
        signal: controller.signal,
        onUsage: (usage) =>
          this.store.recordUsage(turn.id, this.workerId, turn.attempt, usage),
        onTextDelta: (delta) =>
          this.store.appendAssistantText(
            turn.id,
            this.workerId,
            turn.attempt,
            delta,
          ),
      });
      const finalUsage = usageFrom(lastResult, turn, started, tools.toolCalls);
      await this.store.recordUsage(
        turn.id,
        this.workerId,
        turn.attempt,
        finalUsage,
      );
      lastResult = { ...lastResult, ...finalUsage };
      const latest = await this.store.get(turn.id);
      if (latest?.cancelRequested || lastResult.status === "canceled") {
        await this.finish(turn, {
          ...toFailure(
            lastResult,
            "canceled",
            "authoring_canceled",
            "Authoring canceled safely.",
          ),
          wallTimeMs: cumulativeWallTime(turn, started),
        });
        return;
      }
      if (lastResult.status !== "candidate_ready") {
        await this.finish(turn, {
          ...toFailure(
            lastResult,
            lastResult.code === "authoring_interrupted"
              ? "needs_intervention"
              : "failed",
            lastResult.code,
            lastResult.message,
          ),
          wallTimeMs: cumulativeWallTime(turn, started),
        });
        return;
      }
      if (!tools.declaredReady)
        throw new Error("Agent stopped without declare_candidate_ready.");
      const candidateSource = await workspace.readCandidate();
      const candidateSourceHash = sha256(candidateSource);
      await this.store.submitCandidate(turn.id, this.workerId, turn.attempt, {
        candidateSource,
        candidateSourceHash,
        contextHash: context.hash,
        sessionRef: lastResult.sessionRef,
        assistantSummary: lastResult.assistantSummary,
        ...finalUsage,
      });
    } catch (error) {
      console.error(`Authoring turn ${turn.id} failed safely: ${safe(error)}`);
      const latest = await this.store.get(turn.id).catch(() => null);
      if (
        latest &&
        latest.state === "running" &&
        latest.leaseOwner === this.workerId &&
        latest.attempt === turn.attempt &&
        latest.leaseExpiresAt &&
        latest.leaseExpiresAt > Date.now()
      ) {
        const interrupted =
          controller.signal.aborted && !latest.cancelRequested;
        const base: AgentRunResult = lastResult ?? {
          status: "failed",
          code: interrupted ? "authoring_interrupted" : "authoring_failed",
          message: interrupted
            ? "Authoring was interrupted and can be resumed."
            : "Authoring failed safely.",
          assistantSummary: interrupted
            ? "The provider stopped responding; the conversation and working version were preserved."
            : "Authoring failed before candidate submission.",
          ...priorUsage(
            turn,
            cumulativeWallTime(turn, started),
            tools?.toolCalls,
          ),
        };
        const usage = usageFrom(base, turn, started, tools?.toolCalls);
        await this.store
          .recordUsage(turn.id, this.workerId, turn.attempt, usage)
          .catch(() => undefined);
        await this.finish(turn, {
          ...toFailure(
            { ...base, ...usage },
            latest.cancelRequested
              ? "canceled"
              : interrupted
                ? "needs_intervention"
                : "failed",
            latest.cancelRequested
              ? "authoring_canceled"
              : interrupted
                ? "authoring_interrupted"
                : "authoring_failed",
            latest.cancelRequested
              ? "Authoring canceled safely."
              : interrupted
                ? "The provider stopped responding. Resume from the preserved conversation."
                : "Authoring failed safely before validation handoff.",
          ),
          wallTimeMs: cumulativeWallTime(turn, started),
        }).catch(() => undefined);
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(monitor);
      controller.abort();
      if (workspace) await workspace.remove();
    }
  }

  private finish(turn: AuthoringTurn, result: AuthoringFailure): Promise<void> {
    return this.store.finish(turn.id, this.workerId, turn.attempt, result);
  }
  private async monitor(
    turn: AuthoringTurn,
    controller: AbortController,
  ): Promise<void> {
    const latest = await this.store.get(turn.id);
    if (!latest || latest.cancelRequested) {
      controller.abort();
      return;
    }
    const live = await this.store.heartbeat(
      turn.id,
      this.workerId,
      turn.attempt,
      this.leaseMs,
    );
    if (!live) controller.abort();
  }
}

function failure(
  state: AuthoringFailure["state"],
  code: string,
  message: string,
  turn: AuthoringTurn,
  started: number,
): AuthoringFailure {
  return {
    state,
    code,
    message,
    assistantSummary: message,
    ...priorUsage(turn, cumulativeWallTime(turn, started)),
  };
}
function toFailure(
  result: AgentRunResult,
  state: AuthoringFailure["state"],
  code: string,
  message: string,
): AuthoringFailure {
  return {
    state,
    code,
    message,
    assistantSummary: result.assistantSummary,
    sessionRef: result.sessionRef,
    toolCalls: result.toolCalls,
    modelTurns: result.modelTurns,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
    costUsd: result.costUsd,
    wallTimeMs: result.wallTimeMs,
  };
}
function priorUsage(
  turn: AuthoringTurn,
  wallTimeMs = turn.priorWallTimeMs,
  toolCalls = turn.priorToolCalls,
): AuthoringUsage {
  return {
    toolCalls: toolCalls ?? turn.priorToolCalls,
    modelTurns: turn.priorModelTurns,
    inputTokens: turn.priorInputTokens,
    outputTokens: turn.priorOutputTokens,
    cacheReadTokens: turn.priorCacheReadTokens,
    cacheWriteTokens: turn.priorCacheWriteTokens,
    costUsd: turn.priorCostUsd,
    wallTimeMs,
  };
}
function usageFrom(
  result: AgentRunResult,
  turn: AuthoringTurn,
  started: number,
  toolCalls = result.toolCalls,
): AuthoringUsage {
  return {
    toolCalls: Math.max(toolCalls, turn.priorToolCalls),
    modelTurns: Math.max(result.modelTurns, turn.priorModelTurns),
    inputTokens: Math.max(result.inputTokens, turn.priorInputTokens),
    outputTokens: Math.max(result.outputTokens, turn.priorOutputTokens),
    cacheReadTokens: Math.max(
      result.cacheReadTokens,
      turn.priorCacheReadTokens,
    ),
    cacheWriteTokens: Math.max(
      result.cacheWriteTokens,
      turn.priorCacheWriteTokens,
    ),
    costUsd: Math.max(result.costUsd, turn.priorCostUsd),
    wallTimeMs: cumulativeWallTime(turn, started),
  };
}
function remainingWallTime(turn: AuthoringTurn): number {
  return turn.maxWallTimeMs;
}
function cumulativeWallTime(turn: AuthoringTurn, started: number): number {
  return turn.priorWallTimeMs + (Date.now() - started);
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(process.cwd(), "[worker]")
    .slice(0, 1_000);
}
