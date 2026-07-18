import { createHash } from "node:crypto";

import { buildAuthoringContext } from "./context.js";
import { AuthoringBudgetExceededError, RelayAuthoringTools } from "./tools.js";
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
      if (remainingWallTime(turn) <= 0)
        throw new AuthoringBudgetExceededError("Wall-time budget exhausted.");
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
      });
      const finalUsage = usageFrom(lastResult, turn, started, tools.toolCalls);
      await this.store.recordUsage(
        turn.id,
        this.workerId,
        turn.attempt,
        finalUsage,
      );
      lastResult = { ...lastResult, ...finalUsage };
      const usageIssue = usageViolation(turn, lastResult);
      if (usageIssue || tools.budgetExceeded) {
        await this.finish(turn, {
          ...toFailure(
            lastResult,
            "needs_intervention",
            "authoring_budget_exhausted",
            usageIssue ?? "Tool-call budget exhausted.",
          ),
          wallTimeMs: cumulativeWallTime(turn, started),
        });
        return;
      }
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
            lastResult.status === "budget_exhausted"
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
        const budgetExceeded =
          error instanceof AuthoringBudgetExceededError ||
          tools?.budgetExceeded ||
          (controller.signal.aborted && !latest.cancelRequested);
        const base: AgentRunResult = lastResult ?? {
          status: budgetExceeded ? "budget_exhausted" : "failed",
          code: budgetExceeded
            ? "authoring_budget_exhausted"
            : "authoring_failed",
          message: budgetExceeded
            ? "Authoring exhausted a configured budget."
            : "Authoring failed safely.",
          assistantSummary: budgetExceeded
            ? "Authoring stopped at a configured budget boundary."
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
              : budgetExceeded
                ? "needs_intervention"
                : "failed",
            latest.cancelRequested
              ? "authoring_canceled"
              : budgetExceeded
                ? "authoring_budget_exhausted"
                : "authoring_failed",
            latest.cancelRequested
              ? "Authoring canceled safely."
              : budgetExceeded
                ? "Authoring stopped at a configured budget boundary."
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

function usageViolation(
  turn: AuthoringTurn,
  result: AgentRunResult,
): string | null {
  if (result.toolCalls > turn.maxToolCalls) return "Tool-call budget exceeded.";
  if (result.modelTurns > turn.maxModelTurns)
    return "Model-turn budget exceeded.";
  if (
    result.inputTokens +
      result.outputTokens +
      result.cacheReadTokens +
      result.cacheWriteTokens >
    turn.maxTokens
  )
    return "Token budget exceeded.";
  if (result.costUsd > turn.maxCostUsd) return "Cost budget exceeded.";
  if (result.wallTimeMs > turn.maxWallTimeMs)
    return "Wall-time budget exceeded.";
  return null;
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
  return Math.max(0, turn.maxWallTimeMs - turn.priorWallTimeMs);
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
