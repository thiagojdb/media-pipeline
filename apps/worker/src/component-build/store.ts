import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

import type {
  BuildTransition,
  ComponentBuildJob,
  ComponentBuildJobStore,
  ComponentBuildState,
} from "./types.js";

const buildApi = anyApi.componentBuildJobs!;

export class ConvexComponentBuildJobStore implements ComponentBuildJobStore {
  readonly #client: ConvexHttpClient;

  constructor(
    url: string,
    private readonly workerToken: string,
  ) {
    this.#client = new ConvexHttpClient(url);
  }

  async claim(
    workerId: string,
    leaseMs: number,
  ): Promise<ComponentBuildJob | null> {
    const value = await this.#client.mutation(buildApi.claim!, {
      workerToken: this.workerToken,
      workerId,
      leaseMs,
    });
    return value ? fromConvex(value as Record<string, unknown>) : null;
  }

  async get(jobId: string): Promise<ComponentBuildJob | null> {
    const value = await this.#client.query(buildApi.getForWorker!, {
      workerToken: this.workerToken,
      jobId,
    });
    return value ? fromConvex(value as Record<string, unknown>) : null;
  }

  async heartbeat(
    jobId: string,
    workerId: string,
    leaseAttempt: number,
    leaseMs: number,
  ): Promise<boolean> {
    return this.#client.mutation(buildApi.heartbeat!, {
      workerToken: this.workerToken,
      jobId,
      workerId,
      leaseAttempt,
      leaseMs,
    }) as Promise<boolean>;
  }

  async transition(
    jobId: string,
    workerId: string,
    leaseAttempt: number,
    transition: BuildTransition,
  ): Promise<void> {
    await this.#client.mutation(buildApi.transition!, {
      workerToken: this.workerToken,
      jobId,
      workerId,
      leaseAttempt,
      nextState: transition.state,
      code: transition.code,
      message: transition.message,
      candidateRef: transition.candidateRef,
      stdout: transition.stdout,
      stderr: transition.stderr,
      validationEvidenceJson: transition.validationEvidence
        ? JSON.stringify(transition.validationEvidence)
        : undefined,
    });
  }

  async recoverExpired(): Promise<number> {
    return this.#client.mutation(buildApi.recoverExpired!, {
      workerToken: this.workerToken,
    }) as Promise<number>;
  }
}

export class InMemoryComponentBuildJobStore implements ComponentBuildJobStore {
  readonly jobs = new Map<string, ComponentBuildJob>();
  readonly events: {
    readonly jobId: string;
    readonly state: ComponentBuildState;
    readonly message: string;
  }[] = [];

  constructor(jobs: readonly ComponentBuildJob[] = []) {
    for (const job of jobs) this.jobs.set(job.id, { ...job });
  }

  async claim(
    workerId: string,
    leaseMs: number,
  ): Promise<ComponentBuildJob | null> {
    const job = [...this.jobs.values()].find(({ state }) => state === "queued");
    if (!job) return null;
    const claimed: ComponentBuildJob = {
      ...job,
      state: "running",
      attempt: job.attempt + 1,
      leaseOwner: workerId,
      leaseExpiresAt: Date.now() + leaseMs,
    };
    this.jobs.set(job.id, claimed);
    this.events.push({ jobId: job.id, state: "running", message: "claimed" });
    return claimed;
  }

  async get(jobId: string): Promise<ComponentBuildJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async heartbeat(
    jobId: string,
    workerId: string,
    leaseAttempt: number,
    leaseMs: number,
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (
      !job ||
      job.leaseOwner !== workerId ||
      job.attempt !== leaseAttempt ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= Date.now() ||
      terminal(job.state)
    )
      return false;
    this.jobs.set(jobId, { ...job, leaseExpiresAt: Date.now() + leaseMs });
    return true;
  }

  async transition(
    jobId: string,
    workerId: string,
    leaseAttempt: number,
    transition: BuildTransition,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (
      !job ||
      job.leaseOwner !== workerId ||
      job.attempt !== leaseAttempt ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= Date.now()
    )
      throw new Error("Build lease is not owned or has expired.");
    if (job.cancelRequested && transition.state === "succeeded")
      throw new Error("Canceled build cannot succeed.");
    this.jobs.set(jobId, {
      ...job,
      state: transition.state,
      candidateRef: transition.candidateRef,
      boundedStdout: transition.stdout,
      boundedStderr: transition.stderr,
      validationEvidence: transition.validationEvidence,
      leaseOwner: terminal(transition.state) ? undefined : workerId,
      leaseExpiresAt: terminal(transition.state)
        ? undefined
        : job.leaseExpiresAt,
    });
    this.events.push({
      jobId,
      state: transition.state,
      message: transition.message,
    });
  }

  async recoverExpired(now = Date.now()): Promise<number> {
    let count = 0;
    for (const [id, job] of this.jobs) {
      if (
        !job.leaseExpiresAt ||
        job.leaseExpiresAt > now ||
        terminal(job.state)
      )
        continue;
      const state: ComponentBuildState = job.cancelRequested
        ? "canceled"
        : job.attempt < job.maxAttempts
          ? "queued"
          : "needs_intervention";
      this.jobs.set(id, {
        ...job,
        state,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      });
      this.events.push({ jobId: id, state, message: "lease recovered" });
      count += 1;
    }
    return count;
  }
}

function fromConvex(value: Record<string, unknown>): ComponentBuildJob {
  return {
    id: String(value._id),
    channelId: String(value.channelId),
    threadId: String(value.threadId),
    turnId: String(value.turnId),
    parentCandidateId: optionalString(value.parentCandidateId),
    baseSnapshotId: optionalString(value.baseSnapshotId),
    sourceSnapshot: String(value.sourceSnapshot),
    sourceHash: String(value.sourceHash),
    state: value.state as ComponentBuildState,
    attempt: Number(value.attempt),
    maxAttempts: Number(value.maxAttempts),
    cancelRequested: Boolean(value.cancelRequested),
    leaseOwner: optionalString(value.leaseOwner),
    leaseExpiresAt:
      value.leaseExpiresAt === undefined
        ? undefined
        : Number(value.leaseExpiresAt),
    candidateRef: optionalString(value.candidateRef),
    boundedStdout: optionalString(value.boundedStdout),
    boundedStderr: optionalString(value.boundedStderr),
    repairAttempt: Number(value.repairAttempt ?? 0),
    maxRepairAttempts: Number(value.maxRepairAttempts ?? 0),
    validationEvidence: parseEvidence(value.validationEvidenceJson),
    repairTurnId: optionalString(value.repairTurnId),
    candidateId: optionalString(value.candidateId),
  };
}
function parseEvidence(value: unknown) {
  if (typeof value !== "string") return undefined;
  return JSON.parse(value) as import("./types.js").ValidationEvidence;
}
function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}
function terminal(state: ComponentBuildState): boolean {
  return ["failed", "needs_intervention", "succeeded", "canceled"].includes(
    state,
  );
}
