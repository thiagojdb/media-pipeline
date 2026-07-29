import { ComponentAuthoringService } from "./service.js";
import type { AuthoringTurnStore } from "./types.js";

export type AuthoringLoopStatus = "running" | "degraded" | "stopped";

export class ComponentAuthoringLoop {
  #active = false;
  #draining = false;
  #wakeRequested = false;
  #retryTimer: NodeJS.Timeout | undefined;
  #status: AuthoringLoopStatus = "stopped";
  constructor(
    private readonly store: AuthoringTurnStore,
    private readonly service: ComponentAuthoringService,
    private readonly workerId: string,
    private readonly leaseMs = 30_000,
  ) {}
  get status(): AuthoringLoopStatus {
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
    if (this.#active) return false;
    this.#active = true;
    try {
      const turn = await this.store.claim(this.workerId, this.leaseMs);
      if (!turn) return false;
      await this.service.runClaimed(turn);
      return true;
    } finally {
      this.#active = false;
    }
  }
  async #drainSafely(): Promise<void> {
    this.#draining = true;
    try {
      do {
        this.#wakeRequested = false;
        while (this.#status !== "stopped" && (await this.tick())) {
          // Drain every queued turn before returning to the subscription.
        }
      } while (this.#status !== "stopped" && this.#wakeRequested);
      if (this.#status !== "stopped") this.#status = "running";
    } catch (error) {
      if (this.#status !== "stopped") this.#status = "degraded";
      console.error(
        `Component-authoring loop degraded safely: ${error instanceof Error ? error.message : String(error)}`,
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
