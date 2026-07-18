import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

import type {
  AuthoringActivity,
  AuthoringCompletion,
  AuthoringFailure,
  AuthoringState,
  AuthoringTurn,
  AuthoringTurnStore,
} from "./types.js";

const api = anyApi.componentAuthoring!;

export class ConvexAuthoringTurnStore implements AuthoringTurnStore {
  readonly #client: ConvexHttpClient;
  constructor(
    url: string,
    private readonly token: string,
  ) {
    this.#client = new ConvexHttpClient(url);
  }
  async claim(
    workerId: string,
    leaseMs: number,
  ): Promise<AuthoringTurn | null> {
    const value = await this.#client.mutation(api.claim!, {
      workerToken: this.token,
      workerId,
      leaseMs,
    });
    return value ? fromConvex(value as Record<string, unknown>) : null;
  }
  async get(turnId: string): Promise<AuthoringTurn | null> {
    const value = await this.#client.query(api.getForWorker!, {
      workerToken: this.token,
      turnId,
    });
    return value ? fromConvex(value as Record<string, unknown>) : null;
  }
  heartbeat(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    leaseMs: number,
  ): Promise<boolean> {
    return this.#client.mutation(api.heartbeat!, {
      workerToken: this.token,
      turnId,
      workerId,
      leaseAttempt,
      leaseMs,
    }) as Promise<boolean>;
  }
  async recordActivity(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    activity: AuthoringActivity,
  ): Promise<void> {
    await this.#client.mutation(api.recordActivity!, {
      workerToken: this.token,
      turnId,
      workerId,
      leaseAttempt,
      ...activity,
    });
  }
  async recordUsage(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    usage: import("./types.js").AuthoringUsage,
  ): Promise<void> {
    await this.#client.mutation(api.recordUsage!, {
      workerToken: this.token,
      turnId,
      workerId,
      leaseAttempt,
      ...usage,
    });
  }
  submitCandidate(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    completion: AuthoringCompletion,
  ): Promise<string> {
    return this.#client.mutation(api.submitCandidate!, {
      workerToken: this.token,
      turnId,
      workerId,
      leaseAttempt,
      ...completion,
    }) as Promise<string>;
  }
  async finish(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    failure: AuthoringFailure,
  ): Promise<void> {
    await this.#client.mutation(api.finish!, {
      workerToken: this.token,
      turnId,
      workerId,
      leaseAttempt,
      ...failure,
    });
  }
  recoverExpired(): Promise<number> {
    return this.#client.mutation(api.recoverExpired!, {
      workerToken: this.token,
    }) as Promise<number>;
  }
}

export class InMemoryAuthoringTurnStore implements AuthoringTurnStore {
  readonly turns = new Map<string, AuthoringTurn>();
  readonly activities: AuthoringActivity[] = [];
  readonly buildJobs = new Map<string, AuthoringCompletion>();
  constructor(turns: readonly AuthoringTurn[] = []) {
    turns.forEach((turn) => this.turns.set(turn.id, { ...turn }));
  }
  async claim(
    workerId: string,
    leaseMs: number,
  ): Promise<AuthoringTurn | null> {
    const queued = [...this.turns.values()].find(
      (turn) => turn.state === "queued",
    );
    if (!queued) return null;
    const claimed: AuthoringTurn = {
      ...queued,
      state: "running",
      attempt: queued.attempt + 1,
      leaseOwner: workerId,
      leaseExpiresAt: Date.now() + leaseMs,
    };
    this.turns.set(queued.id, claimed);
    return claimed;
  }
  async get(turnId: string): Promise<AuthoringTurn | null> {
    return this.turns.get(turnId) ?? null;
  }
  async heartbeat(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    leaseMs: number,
  ): Promise<boolean> {
    const turn = this.live(turnId, workerId, leaseAttempt);
    if (!turn) return false;
    this.turns.set(turnId, { ...turn, leaseExpiresAt: Date.now() + leaseMs });
    return true;
  }
  async recordActivity(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    activity: AuthoringActivity,
  ): Promise<void> {
    const turn = this.live(turnId, workerId, leaseAttempt);
    if (!turn) throw new Error("Authoring lease expired.");
    this.activities.push(activity);
    this.turns.set(turnId, {
      ...turn,
      priorToolCalls: Math.max(turn.priorToolCalls, activity.sequence),
    });
  }
  async recordUsage(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    usage: import("./types.js").AuthoringUsage,
  ): Promise<void> {
    const turn = this.live(turnId, workerId, leaseAttempt);
    if (!turn) throw new Error("Authoring lease expired.");
    const previousUsage = {
      toolCalls: turn.priorToolCalls,
      modelTurns: turn.priorModelTurns,
      inputTokens: turn.priorInputTokens,
      outputTokens: turn.priorOutputTokens,
      cacheReadTokens: turn.priorCacheReadTokens,
      cacheWriteTokens: turn.priorCacheWriteTokens,
      costUsd: turn.priorCostUsd,
      wallTimeMs: turn.priorWallTimeMs,
    };
    for (const name of Object.keys(previousUsage) as Array<
      keyof typeof previousUsage
    >) {
      if (usage[name] < previousUsage[name])
        throw new Error("Authoring usage cannot decrease.");
    }
    this.turns.set(turnId, {
      ...turn,
      priorToolCalls: usage.toolCalls,
      priorModelTurns: usage.modelTurns,
      priorInputTokens: usage.inputTokens,
      priorOutputTokens: usage.outputTokens,
      priorCacheReadTokens: usage.cacheReadTokens,
      priorCacheWriteTokens: usage.cacheWriteTokens,
      priorCostUsd: usage.costUsd,
      priorWallTimeMs: usage.wallTimeMs,
    });
  }
  async submitCandidate(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    completion: AuthoringCompletion,
  ): Promise<string> {
    const turn = this.live(turnId, workerId, leaseAttempt);
    if (!turn || turn.cancelRequested)
      throw new Error("Canceled or stale turn cannot submit.");
    const buildJobId = `build:${turn.id}`;
    if (this.buildJobs.has(buildJobId)) return buildJobId;
    this.buildJobs.set(buildJobId, completion);
    this.turns.set(turnId, {
      ...turn,
      state: "candidate_submitted",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      sessionRef: completion.sessionRef,
    });
    return buildJobId;
  }
  async finish(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    failure: AuthoringFailure,
  ): Promise<void> {
    const turn = this.live(turnId, workerId, leaseAttempt);
    if (!turn) throw new Error("Authoring lease expired.");
    this.turns.set(turnId, {
      ...turn,
      state: failure.state,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      sessionRef: failure.sessionRef,
    });
  }
  async recoverExpired(now = Date.now()): Promise<number> {
    let count = 0;
    for (const [id, turn] of this.turns) {
      if (
        turn.state !== "running" ||
        !turn.leaseExpiresAt ||
        turn.leaseExpiresAt > now
      )
        continue;
      const state: AuthoringState = turn.cancelRequested
        ? "canceled"
        : turn.attempt < turn.maxAttempts
          ? "queued"
          : "needs_intervention";
      this.turns.set(id, {
        ...turn,
        state,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      });
      count += 1;
    }
    return count;
  }
  private live(
    turnId: string,
    workerId: string,
    attempt: number,
  ): AuthoringTurn | null {
    const turn = this.turns.get(turnId);
    if (
      !turn ||
      turn.state !== "running" ||
      turn.leaseOwner !== workerId ||
      turn.attempt !== attempt ||
      !turn.leaseExpiresAt ||
      turn.leaseExpiresAt <= Date.now()
    )
      return null;
    return turn;
  }
}

function fromConvex(value: Record<string, unknown>): AuthoringTurn {
  return {
    id: String(value._id),
    channelId: String(value.channelId),
    threadId: String(value.threadId),
    turnId: String(value.turnId),
    userRequest: String(value.userRequest),
    acceptanceCriteria: value.acceptanceCriteria as string[],
    baseSource: String(value.baseSource),
    baseSourceHash: String(value.baseSourceHash),
    parentCandidateId: optional(value.parentCandidateId),
    baseSnapshotId: optional(value.baseSnapshotId),
    channelThemeJson: String(value.channelThemeJson),
    assetsMetadataJson: String(value.assetsMetadataJson),
    priorSummaries: value.priorSummaries as string[],
    state: value.state as AuthoringState,
    attempt: Number(value.attempt),
    maxAttempts: Number(value.maxAttempts),
    cancelRequested: Boolean(value.cancelRequested),
    leaseOwner: optional(value.leaseOwner),
    leaseExpiresAt:
      value.leaseExpiresAt === undefined
        ? undefined
        : Number(value.leaseExpiresAt),
    maxWallTimeMs: Number(value.maxWallTimeMs),
    maxModelTurns: Number(value.maxModelTurns),
    maxToolCalls: Number(value.maxToolCalls),
    maxTokens: Number(value.maxTokens),
    maxCostUsd: Number(value.maxCostUsd),
    sessionRef: optional(value.sessionRef),
    priorToolCalls: Number(value.toolCalls ?? 0),
    priorModelTurns: Number(value.modelTurns ?? 0),
    priorInputTokens: Number(value.inputTokens ?? 0),
    priorOutputTokens: Number(value.outputTokens ?? 0),
    priorCacheReadTokens: Number(value.cacheReadTokens ?? 0),
    priorCacheWriteTokens: Number(value.cacheWriteTokens ?? 0),
    priorCostUsd: Number(value.costUsd ?? 0),
    priorWallTimeMs: Number(value.wallTimeMs ?? 0),
  };
}
function optional(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}
