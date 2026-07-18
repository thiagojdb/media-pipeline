/// <reference types="vite/client" />

import { createHash } from "node:crypto";

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const workerToken = "authoring-test-worker-token";

beforeEach(() => {
  process.env.AUTHORING_WORKER_TOKEN = workerToken;
});

afterEach(() => {
  delete process.env.AUTHORING_WORKER_TOKEN;
});

describe("Convex component authoring lifecycle", () => {
  it("enqueues idempotently and rejects conflicting turn reuse", async () => {
    const t = convexTest(schema, modules);
    const args = enqueueArgs();
    const first = await t.mutation(internal.componentAuthoring.enqueue, args);
    const second = await t.mutation(internal.componentAuthoring.enqueue, args);
    expect(second).toBe(first);

    await expect(
      t.mutation(internal.componentAuthoring.enqueue, {
        ...args,
        userRequest: "A conflicting request for the same durable turn.",
      }),
    ).rejects.toThrow("different inputs");
    await expect(
      t.run(async (ctx) => ctx.db.query("authoringTurns").collect()),
    ).resolves.toHaveLength(1);
  });

  it("fences attempts, enforces monotonic activity and usage, and stops after one expired attempt", async () => {
    const t = convexTest(schema, modules);
    const turnId = await t.mutation(
      internal.componentAuthoring.enqueue,
      enqueueArgs(),
    );
    const claimed = await t.mutation(api.componentAuthoring.claim, {
      workerToken,
      workerId: "worker-a",
      leaseMs: 5_000,
    });
    expect(claimed).toMatchObject({ attempt: 1, state: "running" });

    await t.mutation(api.componentAuthoring.recordActivity, {
      workerToken,
      turnId,
      workerId: "worker-a",
      leaseAttempt: 1,
      sequence: 1,
      name: "read_authoring_context",
      status: "succeeded",
      inputSummary: "{}",
      outputSummary: "read",
      durationMs: 1,
    });
    await expect(
      t.mutation(api.componentAuthoring.recordActivity, {
        workerToken,
        turnId,
        workerId: "worker-a",
        leaseAttempt: 1,
        sequence: 1,
        name: "duplicate",
        status: "succeeded",
        inputSummary: "{}",
        outputSummary: "duplicate",
        durationMs: 1,
      }),
    ).rejects.toThrow("increase monotonically");

    const firstUsage = usage({ toolCalls: 1, inputTokens: 100 });
    await t.mutation(api.componentAuthoring.recordUsage, {
      workerToken,
      turnId,
      workerId: "worker-a",
      leaseAttempt: 1,
      ...firstUsage,
    });
    await expect(
      t.mutation(api.componentAuthoring.recordUsage, {
        workerToken,
        turnId,
        workerId: "worker-a",
        leaseAttempt: 1,
        ...firstUsage,
        inputTokens: 99,
      }),
    ).rejects.toThrow("inputTokens cannot decrease");

    await t.run(async (ctx) => {
      await ctx.db.patch(turnId, { leaseExpiresAt: 1 });
    });
    await expect(
      t.mutation(api.componentAuthoring.heartbeat, {
        workerToken,
        turnId,
        workerId: "worker-a",
        leaseAttempt: 1,
        leaseMs: 5_000,
      }),
    ).resolves.toBe(false);
    await expect(
      t.mutation(api.componentAuthoring.recoverExpired, { workerToken }),
    ).resolves.toBe(1);
    const recovered = await t.query(internal.componentAuthoring.getSafeTurn, {
      turnId,
    });
    expect(recovered).toMatchObject({
      state: "needs_intervention",
      attempt: 1,
      terminalCode: "lease_expired",
    });
    await expect(
      t.mutation(api.componentAuthoring.claim, {
        workerToken,
        workerId: "worker-b",
        leaseMs: 5_000,
      }),
    ).resolves.toBeNull();
  });

  it("lets cancellation win over submit and creates exactly one MED-133 handoff", async () => {
    const canceled = convexTest(schema, modules);
    const canceledId = await canceled.mutation(
      internal.componentAuthoring.enqueue,
      enqueueArgs({ turnId: "cancel-turn" }),
    );
    await canceled.mutation(api.componentAuthoring.claim, {
      workerToken,
      workerId: "worker-a",
      leaseMs: 5_000,
    });
    await canceled.mutation(internal.componentAuthoring.requestCancel, {
      turnId: canceledId,
    });
    await expect(
      submit(canceled, canceledId, "worker-a", "cancel-source"),
    ).rejects.toThrow("Canceled turn cannot submit");
    await expect(
      canceled.run(async (ctx) => ctx.db.query("componentBuildJobs").collect()),
    ).resolves.toHaveLength(0);

    const submitted = convexTest(schema, modules);
    const submittedId = await submitted.mutation(
      internal.componentAuthoring.enqueue,
      enqueueArgs({ turnId: "submit-turn" }),
    );
    await submitted.mutation(api.componentAuthoring.claim, {
      workerToken,
      workerId: "worker-b",
      leaseMs: 5_000,
    });
    const firstJob = await submit(
      submitted,
      submittedId,
      "worker-b",
      "candidate-source",
    );
    const secondJob = await submit(
      submitted,
      submittedId,
      "worker-b",
      "candidate-source",
    );
    expect(secondJob).toBe(firstJob);
    await expect(
      submitted.run(async (ctx) =>
        ctx.db.query("componentBuildJobs").collect(),
      ),
    ).resolves.toHaveLength(1);
    await expect(
      submitted.run(async (ctx) =>
        ctx.db.query("componentBuildEvents").collect(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: "enqueued_from_authoring" }),
    ]);
  });
});

function enqueueArgs(overrides: Record<string, unknown> = {}) {
  const baseSource = "export const candidate = true;";
  return {
    channelId: "channel-test",
    threadId: "thread-test",
    turnId: "turn-test",
    userRequest: "Create a deterministic chart candidate.",
    acceptanceCriteria: ["Use only the public component SDK."],
    baseSource,
    baseSourceHash: sha(baseSource),
    channelThemeJson: "{}",
    assetsMetadataJson: "{}",
    priorSummaries: [],
    maxAttempts: 1,
    maxWallTimeMs: 30_000,
    maxModelTurns: 4,
    maxToolCalls: 10,
    maxTokens: 4_000,
    maxCostUsd: 0.25,
    ...overrides,
  };
}

function usage(overrides: Record<string, number> = {}) {
  return {
    toolCalls: 4,
    modelTurns: 1,
    inputTokens: 200,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.05,
    wallTimeMs: 500,
    ...overrides,
  };
}

async function submit(
  t: ReturnType<typeof convexTest>,
  turnId: Id<"authoringTurns">,
  workerId: string,
  source: string,
) {
  return t.mutation(api.componentAuthoring.submitCandidate, {
    workerToken,
    turnId,
    workerId,
    leaseAttempt: 1,
    candidateSource: source,
    candidateSourceHash: sha(source),
    contextHash: "1".repeat(64),
    sessionRef: "pi:test-session",
    assistantSummary: "Candidate ready for validation.",
    ...usage(),
  });
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
