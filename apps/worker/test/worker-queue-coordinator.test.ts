import { describe, expect, it, vi } from "vitest";

import {
  WorkerQueueCoordinator,
  type WorkerQueueAvailability,
} from "../src/worker-queue-coordinator.js";

describe("worker queue coordinator", () => {
  it("stays mutation-free while idle and wakes only available queues", async () => {
    const client = new FakeQueueClient();
    const componentBuild = vi.fn();
    const narration = vi.fn();
    const coordinator = new WorkerQueueCoordinator(
      "https://example.convex.cloud",
      {
        componentBuildToken: "build-token",
        narrationToken: "narration-token",
      },
      { componentBuild, narration },
      client,
    );

    coordinator.start();
    expect(client.subscriptionCount).toBe(1);
    expect(componentBuild).not.toHaveBeenCalled();
    expect(narration).not.toHaveBeenCalled();

    client.publish({
      componentBuild: false,
      componentAuthoring: false,
      narration: true,
      projectRender: false,
    });
    expect(componentBuild).not.toHaveBeenCalled();
    expect(narration).toHaveBeenCalledOnce();

    await coordinator.stop();
    expect(client.unsubscribed).toBe(true);
    expect(client.closed).toBe(true);

    client.publish({
      componentBuild: true,
      componentAuthoring: true,
      narration: true,
      projectRender: true,
    });
    expect(componentBuild).not.toHaveBeenCalled();
    expect(narration).toHaveBeenCalledOnce();
  });
});

class FakeQueueClient {
  subscriptionCount = 0;
  unsubscribed = false;
  closed = false;
  #callback: ((availability: WorkerQueueAvailability) => void) | undefined;

  onUpdate(
    _query: unknown,
    _args: unknown,
    callback: (availability: WorkerQueueAvailability) => void,
  ): () => void {
    this.subscriptionCount += 1;
    this.#callback = callback;
    return () => {
      this.unsubscribed = true;
      this.#callback = undefined;
    };
  }

  publish(availability: WorkerQueueAvailability): void {
    this.#callback?.(availability);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
