import { createHash } from "node:crypto";

import { CandidateWorkspaceManager } from "./workspace.js";
import type {
  CandidateExecutor,
  ComponentBuildJob,
  ComponentBuildJobStore,
} from "./types.js";

export class ComponentBuildService {
  constructor(
    private readonly store: ComponentBuildJobStore,
    private readonly workspaces: CandidateWorkspaceManager,
    private readonly executor: CandidateExecutor,
    private readonly workerId: string,
    private readonly leaseMs = 30_000,
  ) {}

  async runClaimed(job: ComponentBuildJob): Promise<void> {
    const controller = new AbortController();
    let workspace: string | undefined;
    const monitor = setInterval(
      () => {
        void this.monitor(job.id, job.attempt, controller).catch((error) => {
          console.error(
            `Component build ${job.id} heartbeat failed safely: ${safeDiagnostic(error)}`,
          );
          controller.abort();
        });
      },
      Math.max(1_000, Math.floor(this.leaseMs / 3)),
    );
    try {
      const current = await this.store.get(job.id);
      if (current?.cancelRequested) {
        await this.transition(job, {
          state: "canceled",
          code: "build_canceled",
          message: "Component build canceled before validation.",
        });
        return;
      }
      await this.transition(job, {
        state: "validating",
        message: "Preparing isolated candidate validation.",
      });
      workspace = await this.workspaces.create(job);
      const validationFingerprint =
        await this.workspaces.validationFingerprint();
      const execution = await this.executor.execute(
        workspace,
        controller.signal,
      );
      if (execution.status === "succeeded") {
        const latest = await this.store.get(job.id);
        if (!latest || latest.cancelRequested || controller.signal.aborted) {
          await this.transition(job, {
            state: "canceled",
            code: "build_canceled",
            message: "Component build canceled before candidate publication.",
            stdout: execution.stdout,
            stderr: execution.stderr,
          });
          return;
        }
        const candidateRef = `sha256:${createHash("sha256")
          .update(job.sourceHash)
          .update("\0")
          .update(validationFingerprint)
          .digest("hex")}`;
        await this.transition(job, {
          state: "succeeded",
          code: execution.code,
          message: execution.message,
          candidateRef,
          stdout: execution.stdout,
          stderr: execution.stderr,
          validationEvidence: execution.validationEvidence,
        });
      } else if (execution.status === "canceled") {
        await this.transition(job, {
          state: "canceled",
          code: execution.code,
          message: execution.message,
          stdout: execution.stdout,
          stderr: execution.stderr,
          validationEvidence: execution.validationEvidence,
        });
      } else {
        const needsIntervention =
          execution.status === "timed_out" || execution.status === "crashed";
        await this.transition(job, {
          state: needsIntervention ? "needs_intervention" : "failed",
          code: execution.code,
          message: execution.message,
          stdout: execution.stdout,
          stderr: execution.stderr,
          validationEvidence: execution.validationEvidence,
        });
      }
    } catch (error) {
      console.error(
        `Component build ${job.id} failed safely: ${safeDiagnostic(error)}`,
      );
      const latest = await this.store.get(job.id).catch(() => null);
      if (
        latest &&
        !terminal(latest.state) &&
        latest.leaseOwner === this.workerId &&
        latest.attempt === job.attempt &&
        latest.leaseExpiresAt &&
        latest.leaseExpiresAt > Date.now()
      ) {
        await this.transition(job, {
          state: latest.cancelRequested ? "canceled" : "failed",
          code: latest.cancelRequested
            ? "build_canceled"
            : "workspace_or_worker_failure",
          message: latest.cancelRequested
            ? "Component build canceled safely."
            : "Candidate workspace preparation or validation failed safely.",
        }).catch(() => undefined);
      }
    } finally {
      clearInterval(monitor);
      controller.abort();
      if (workspace) await this.workspaces.remove(workspace);
    }
  }

  private transition(
    job: ComponentBuildJob,
    transition: Parameters<ComponentBuildJobStore["transition"]>[3],
  ): Promise<void> {
    return this.store.transition(
      job.id,
      this.workerId,
      job.attempt,
      transition,
    );
  }

  private async monitor(
    jobId: string,
    leaseAttempt: number,
    controller: AbortController,
  ): Promise<void> {
    const job = await this.store.get(jobId);
    if (!job || job.cancelRequested) {
      controller.abort();
      return;
    }
    const extended = await this.store.heartbeat(
      jobId,
      this.workerId,
      leaseAttempt,
      this.leaseMs,
    );
    if (!extended) controller.abort();
  }
}

function safeDiagnostic(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(process.cwd(), "[worker]")
    .slice(0, 1000);
}

function terminal(state: string): boolean {
  return ["failed", "needs_intervention", "succeeded", "canceled"].includes(
    state,
  );
}
