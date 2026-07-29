import type { ComponentBuildJobStore } from "./types.js";
import { ComponentBuildService } from "./service.js";

export type ComponentBuildLoopStatus = "running" | "degraded" | "stopped";

export class ComponentBuildLoop {
  #running = false;
  #draining = false;
  #wakeRequested = false;
  #retryTimer: NodeJS.Timeout | undefined;
  #status: ComponentBuildLoopStatus = "stopped";

  constructor(
    private readonly store: ComponentBuildJobStore,
    private readonly service: ComponentBuildService,
    private readonly workerId: string,
    private readonly leaseMs = 30_000,
  ) {}

  get status(): ComponentBuildLoopStatus {
    return this.#status;
  }

  start(): void {
    if (this.#status !== "stopped") return;
    this.#status = "running";
  }

  stop(): void {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#wakeRequested = false;
    this.#status = "stopped";
  }

  wake(): void {
    if (this.#status === "stopped") return;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#wakeRequested = true;
    if (!this.#draining) void this.#drainSafely();
  }

  async tick(): Promise<boolean> {
    if (this.#running) return false;
    this.#running = true;
    try {
      const job = await this.store.claim(this.workerId, this.leaseMs);
      if (!job) return false;
      await this.service.runClaimed(job);
      return true;
    } finally {
      this.#running = false;
    }
  }

  async #drainSafely(): Promise<void> {
    this.#draining = true;
    try {
      do {
        this.#wakeRequested = false;
        while (this.#status !== "stopped" && (await this.tick())) {
          // Drain every queued job before returning to the subscription.
        }
      } while (this.#status !== "stopped" && this.#wakeRequested);
      if (this.#status !== "stopped") this.#status = "running";
    } catch (error) {
      if (this.#status !== "stopped") this.#status = "degraded";
      console.error(
        `Component-build control loop degraded safely: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.#scheduleRetry();
    } finally {
      this.#draining = false;
      if (this.#status !== "stopped" && this.#wakeRequested) this.wake();
    }
  }

  #scheduleRetry(): void {
    if (this.#status === "stopped" || this.#retryTimer) return;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.wake();
    }, 1_000);
  }
}
