export type ComponentBuildState =
  | "queued"
  | "running"
  | "validating"
  | "failed"
  | "needs_intervention"
  | "succeeded"
  | "canceled";

export interface ComponentBuildJob {
  readonly id: string;
  readonly channelId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly parentCandidateId?: string | undefined;
  readonly baseSnapshotId?: string | undefined;
  readonly sourceSnapshot: string;
  readonly sourceHash: string;
  readonly state: ComponentBuildState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly cancelRequested: boolean;
  readonly leaseOwner?: string | undefined;
  readonly leaseExpiresAt?: number | undefined;
  readonly candidateRef?: string | undefined;
  readonly boundedStdout?: string | undefined;
  readonly boundedStderr?: string | undefined;
}

export interface BuildTransition {
  readonly state:
    "validating" | "failed" | "needs_intervention" | "succeeded" | "canceled";
  readonly code?: string | undefined;
  readonly message: string;
  readonly candidateRef?: string | undefined;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
}

export interface ComponentBuildJobStore {
  claim(workerId: string, leaseMs: number): Promise<ComponentBuildJob | null>;
  get(jobId: string): Promise<ComponentBuildJob | null>;
  heartbeat(
    jobId: string,
    workerId: string,
    leaseAttempt: number,
    leaseMs: number,
  ): Promise<boolean>;
  transition(
    jobId: string,
    workerId: string,
    leaseAttempt: number,
    transition: BuildTransition,
  ): Promise<void>;
  recoverExpired(now?: number): Promise<number>;
}

export interface CandidateExecutionResult {
  readonly status:
    "succeeded" | "failed" | "timed_out" | "crashed" | "canceled";
  readonly code: string;
  readonly message: string;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CandidateExecutor {
  execute(
    workspace: string,
    signal: AbortSignal,
  ): Promise<CandidateExecutionResult>;
}
