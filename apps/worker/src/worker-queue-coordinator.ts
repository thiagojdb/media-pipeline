import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

export type WorkerQueueAvailability = {
  readonly componentBuild: boolean;
  readonly componentAuthoring: boolean;
  readonly narration: boolean;
  readonly projectRender: boolean;
};

export type WorkerQueueHandlers = {
  readonly componentBuild?: (() => void) | undefined;
  readonly componentAuthoring?: (() => void) | undefined;
  readonly narration?: (() => void) | undefined;
  readonly projectRender?: (() => void) | undefined;
};

export type WorkerQueueTokens = {
  readonly componentBuildToken?: string | undefined;
  readonly authoringToken?: string | undefined;
  readonly narrationToken?: string | undefined;
};

const availabilityApi: FunctionReference<
  "query",
  "public",
  WorkerQueueTokens,
  WorkerQueueAvailability
> = anyApi.workerQueues!.availability!;

type QueueClient = {
  onUpdate(
    query: typeof availabilityApi,
    args: WorkerQueueTokens,
    callback: (availability: WorkerQueueAvailability) => void,
    onError: (error: Error) => void,
  ): () => void;
  close(): Promise<void>;
};

export class WorkerQueueCoordinator {
  readonly #client: QueueClient;
  #unsubscribe: (() => void) | undefined;
  #stopped = true;

  constructor(
    url: string,
    private readonly tokens: WorkerQueueTokens,
    private readonly handlers: WorkerQueueHandlers,
    client?: QueueClient,
  ) {
    this.#client = client ?? new ConvexClient(url);
  }

  start(): void {
    if (this.#unsubscribe) return;
    this.#stopped = false;
    this.#unsubscribe = this.#client.onUpdate(
      availabilityApi,
      this.tokens,
      (availability) => {
        if (this.#stopped) return;
        for (const queue of queueNames) {
          if (availability[queue]) this.handlers[queue]?.();
        }
      },
      (error) => {
        if (!this.#stopped) {
          console.error(
            `Worker queue subscription degraded safely: ${safeMessage(error)}`,
          );
        }
      },
    );
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    await this.#client.close();
  }
}

const queueNames = [
  "componentBuild",
  "componentAuthoring",
  "narration",
  "projectRender",
] as const;

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
