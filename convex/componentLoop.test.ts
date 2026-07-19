/// <reference types="vite/client" />

import { createHash } from "node:crypto";

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const workerToken = "component-loop-test-token";
const source = "export default function Candidate() { return null; }";

beforeEach(() => {
  process.env.COMPONENT_LOOP_WORKER_TOKEN = workerToken;
});
afterEach(() => {
  delete process.env.COMPONENT_LOOP_WORKER_TOKEN;
});

describe("creator component loop boundary", () => {
  it("persists streamed dialogue without creating authoring work", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.componentConversation.start, {
      workerToken,
      channelId: "channel-loop",
      threadId: "dialogue-thread",
      userMessageId: "message-user",
      assistantMessageId: "message-assistant",
      content: "Hi, who are you?",
      themeJson: "{}",
    });
    await t.mutation(api.componentConversation.appendDelta, {
      workerToken,
      channelId: "channel-loop",
      threadId: "dialogue-thread",
      messageId: "message-assistant",
      delta: "Hi — I’m Relay.",
      safeStatus: "Preparing a response…",
    });
    await t.mutation(api.componentConversation.complete, {
      workerToken,
      channelId: "channel-loop",
      threadId: "dialogue-thread",
      messageId: "message-assistant",
      inputTokens: 8,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.001,
    });
    const conversation = await t.query(api.componentConversation.get, {
      workerToken,
      channelId: "channel-loop",
      threadId: "dialogue-thread",
    });
    const status = await t.query(api.componentLoop.status, {
      workerToken,
      channelId: "channel-loop",
      threadId: "dialogue-thread",
    });
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[1]).toMatchObject({
      role: "assistant",
      state: "complete",
      content: "Hi — I’m Relay.",
    });
    expect(status.turns).toEqual([]);
    expect(status.builds).toEqual([]);
  });

  it("queues durable work and returns only safe creator status", async () => {
    const t = convexTest(schema, modules);
    const turnId = await t.mutation(api.componentLoop.start, input());
    const status = await t.query(api.componentLoop.status, {
      workerToken,
      channelId: "channel-loop",
      threadId: "thread-loop",
    });
    expect(status.turns).toHaveLength(1);
    expect(status.turns[0]).toMatchObject({ id: turnId, state: "queued" });
    expect(status.turns[0]).not.toHaveProperty("baseSource");
    expect(status.turns[0]).not.toHaveProperty("sessionRef");
    expect(JSON.stringify(status)).not.toContain(source);
  });

  it("rejects unauthenticated access", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.componentLoop.start, {
        ...input(),
        workerToken: "wrong-token",
      }),
    ).rejects.toThrow("authorization failed");
    await expect(
      t.query(api.componentLoop.status, {
        workerToken: "wrong-token",
        channelId: "channel-loop",
        threadId: "thread-loop",
      }),
    ).rejects.toThrow("authorization failed");
  });
});

function input() {
  return {
    workerToken,
    channelId: "channel-loop",
    threadId: "thread-loop",
    turnId: "turn-loop",
    userRequest: "Create an animated line chart.",
    acceptanceCriteria: ["Pass independent validation."],
    baseSource: source,
    baseSourceHash: createHash("sha256").update(source).digest("hex"),
    channelThemeJson: '{"colors":{"accent":"#ef4444"}}',
    assetsMetadataJson: "{}",
    maxWallTimeMs: 30_000,
    maxModelTurns: 4,
    maxToolCalls: 10,
    maxTokens: 4_000,
    maxCostUsd: 0.25,
  };
}
