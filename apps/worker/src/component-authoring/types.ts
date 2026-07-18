export type AuthoringState =
  | "queued"
  | "running"
  | "candidate_submitted"
  | "failed"
  | "needs_intervention"
  | "canceled";

export interface AuthoringTurn {
  readonly id: string;
  readonly channelId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly userRequest: string;
  readonly acceptanceCriteria: readonly string[];
  readonly baseSource: string;
  readonly baseSourceHash: string;
  readonly parentCandidateId?: string | undefined;
  readonly baseSnapshotId?: string | undefined;
  readonly channelThemeJson: string;
  readonly assetsMetadataJson: string;
  readonly priorSummaries: readonly string[];
  readonly state: AuthoringState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly cancelRequested: boolean;
  readonly leaseOwner?: string | undefined;
  readonly leaseExpiresAt?: number | undefined;
  readonly maxWallTimeMs: number;
  readonly maxModelTurns: number;
  readonly maxToolCalls: number;
  readonly maxTokens: number;
  readonly maxCostUsd: number;
  readonly sessionRef?: string | undefined;
  readonly priorToolCalls: number;
  readonly priorModelTurns: number;
  readonly priorInputTokens: number;
  readonly priorOutputTokens: number;
  readonly priorCacheReadTokens: number;
  readonly priorCacheWriteTokens: number;
  readonly priorCostUsd: number;
  readonly priorWallTimeMs: number;
}

export interface AuthoringUsage {
  readonly toolCalls: number;
  readonly modelTurns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly wallTimeMs: number;
}

export interface AuthoringActivity {
  readonly sequence: number;
  readonly name: string;
  readonly status: string;
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly durationMs: number;
}

export interface AuthoringCompletion extends AuthoringUsage {
  readonly candidateSource: string;
  readonly candidateSourceHash: string;
  readonly contextHash: string;
  readonly sessionRef?: string | undefined;
  readonly assistantSummary: string;
}

export interface AuthoringFailure extends AuthoringUsage {
  readonly state: "failed" | "needs_intervention" | "canceled";
  readonly code: string;
  readonly message: string;
  readonly assistantSummary?: string | undefined;
  readonly sessionRef?: string | undefined;
}

export interface AuthoringTurnStore {
  claim(workerId: string, leaseMs: number): Promise<AuthoringTurn | null>;
  get(turnId: string): Promise<AuthoringTurn | null>;
  heartbeat(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    leaseMs: number,
  ): Promise<boolean>;
  recordActivity(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    activity: AuthoringActivity,
  ): Promise<void>;
  recordUsage(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    usage: AuthoringUsage,
  ): Promise<void>;
  submitCandidate(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    completion: AuthoringCompletion,
  ): Promise<string>;
  finish(
    turnId: string,
    workerId: string,
    leaseAttempt: number,
    failure: AuthoringFailure,
  ): Promise<void>;
  recoverExpired(now?: number): Promise<number>;
}

export interface AuthoringContextPack {
  readonly schemaVersion: 1;
  readonly turn: {
    readonly channelId: string;
    readonly threadId: string;
    readonly turnId: string;
    readonly userRequest: string;
    readonly acceptanceCriteria: readonly string[];
    readonly parentCandidateId?: string | undefined;
    readonly baseSnapshotId?: string | undefined;
  };
  readonly exactBase: {
    readonly source: string;
    readonly sha256: string;
  };
  readonly channel: {
    readonly theme: unknown;
    readonly assets: unknown;
  };
  readonly priorSummaries: readonly string[];
  readonly policy: {
    readonly allowedDependencies: readonly string[];
    readonly availableTools: readonly string[];
    readonly forbiddenCapabilities: readonly string[];
  };
  readonly references: Readonly<Record<string, string>>;
  readonly referenceHashes: Readonly<Record<string, string>>;
}

export interface AgentRunResult extends AuthoringUsage {
  readonly status:
    "candidate_ready" | "failed" | "budget_exhausted" | "canceled";
  readonly assistantSummary: string;
  readonly sessionRef?: string | undefined;
  readonly code: string;
  readonly message: string;
}

export interface AuthoringAgent {
  run(options: {
    readonly turn: AuthoringTurn;
    readonly workspace: AuthoringWorkspace;
    readonly tools: AuthoringTools;
    readonly signal: AbortSignal;
    readonly onUsage: (usage: AuthoringUsage) => Promise<void>;
  }): Promise<AgentRunResult>;
}

export interface AuthoringWorkspace {
  readonly root: string;
  readonly contextPath: string;
  readonly candidatePath: string;
  readContext(): Promise<string>;
  readCandidate(): Promise<string>;
  replaceCandidate(source: string): Promise<void>;
  remove(): Promise<void>;
}

export interface AuthoringTools {
  readonly declaredReady: boolean;
  readonly toolCalls: number;
  readonly budgetExceeded: boolean;
  readContext(): Promise<string>;
  replaceCandidate(source: string): Promise<string>;
  checkCandidate(): Promise<string>;
  declareReady(summary: string): Promise<string>;
}
