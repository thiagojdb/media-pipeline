import { ComponentAuthoringService } from "./service.js";
import type { AuthoringTurnStore } from "./types.js";

export type AuthoringLoopStatus = "running" | "degraded" | "stopped";

export class ComponentAuthoringLoop {
  #timer: NodeJS.Timeout | undefined;
  #active = false;
  #status: AuthoringLoopStatus = "stopped";
  constructor(
    private readonly store: AuthoringTurnStore,
    private readonly service: ComponentAuthoringService,
    private readonly workerId: string,
    private readonly leaseMs = 30_000,
    private readonly pollMs = 1_000,
  ) {}
  get status(): AuthoringLoopStatus {
    return this.#status;
  }
  start(): void {
    if (this.#timer) return;
    this.#status = "running";
    this.#timer = setInterval(() => this.#runSafely(), this.pollMs);
    this.#runSafely();
  }
  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#status = "stopped";
  }
  async tick(): Promise<boolean> {
    if (this.#active) return false;
    this.#active = true;
    try {
      await this.store.recoverExpired();
      const turn = await this.store.claim(this.workerId, this.leaseMs);
      if (!turn) return false;
      await this.service.runClaimed(turn);
      return true;
    } finally {
      this.#active = false;
    }
  }
  #runSafely(): void {
    void this.tick()
      .then(() => {
        if (this.#status !== "stopped") this.#status = "running";
      })
      .catch((error) => {
        if (this.#status !== "stopped") this.#status = "degraded";
        console.error(
          `Component-authoring loop degraded safely: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
