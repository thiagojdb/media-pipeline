import type { ComponentBuildJobStore } from "./types.js";
import { ComponentBuildService } from "./service.js";

export type ComponentBuildLoopStatus = "running" | "degraded" | "stopped";

export class ComponentBuildLoop {
  #timer: NodeJS.Timeout | undefined;
  #running = false;
  #status: ComponentBuildLoopStatus = "stopped";

  constructor(
    private readonly store: ComponentBuildJobStore,
    private readonly service: ComponentBuildService,
    private readonly workerId: string,
    private readonly leaseMs = 30_000,
    private readonly pollMs = 1_000,
  ) {}

  get status(): ComponentBuildLoopStatus {
    return this.#status;
  }

  start(): void {
    if (this.#timer) return;
    this.#status = "running";
    this.#timer = setInterval(() => this.#runTickSafely(), this.pollMs);
    this.#runTickSafely();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#status = "stopped";
  }

  async tick(): Promise<boolean> {
    if (this.#running) return false;
    this.#running = true;
    try {
      await this.store.recoverExpired();
      const job = await this.store.claim(this.workerId, this.leaseMs);
      if (!job) return false;
      await this.service.runClaimed(job);
      return true;
    } finally {
      this.#running = false;
    }
  }

  #runTickSafely(): void {
    void this.tick()
      .then(() => {
        if (this.#status !== "stopped") this.#status = "running";
      })
      .catch((error) => {
        if (this.#status !== "stopped") this.#status = "degraded";
        console.error(
          `Component-build control loop degraded safely: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
