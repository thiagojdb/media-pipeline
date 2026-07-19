import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

export const start = mutation({
  args: {
    workerToken: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    userMessageId: v.string(),
    assistantMessageId: v.string(),
    content: v.string(),
    themeJson: v.string(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const now = Date.now();
    await ctx.db.insert("componentConversationThreads", {
      channelId: bounded(args.channelId, 200),
      threadId: bounded(args.threadId, 200),
      phase: "dialogue",
      themeJson: bounded(args.themeJson, 64_000),
      createdAt: now,
      updatedAt: now,
    });
    await insertPair(ctx, args, now);
  },
});

export const addTurn = mutation({
  args: {
    workerToken: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    userMessageId: v.string(),
    assistantMessageId: v.string(),
    content: v.string(),
    themeJson: v.string(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const thread = await threadFor(ctx, args.channelId, args.threadId);
    if (!thread) throw new Error("Conversation thread was not found.");
    const active = await ctx.db
      .query("componentConversationMessages")
      .withIndex("by_thread_created", (q) =>
        q.eq("channelId", args.channelId).eq("threadId", args.threadId),
      )
      .filter((q) => q.eq(q.field("state"), "streaming"))
      .first();
    if (active) throw new Error("Relay is already responding.");
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      themeJson: bounded(args.themeJson, 64_000),
      updatedAt: now,
    });
    await insertPair(ctx, args, now);
  },
});

export const appendDelta = mutation({
  args: {
    workerToken: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    delta: v.string(),
    safeStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const message = await messageFor(ctx, args);
    if (!message || message.state !== "streaming") return false;
    const content = `${message.content}${args.delta}`;
    if (content.length > 32_000)
      throw new Error("Dialogue output is too large.");
    await ctx.db.patch(message._id, {
      content,
      ...(args.safeStatus ? { safeStatus: bounded(args.safeStatus, 500) } : {}),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const complete = mutation({
  args: {
    workerToken: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    transitionBrief: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    costUsd: v.number(),
    sessionRef: v.optional(v.string()),
    contextTokens: v.optional(v.number()),
    contextWindow: v.optional(v.number()),
    contextPercent: v.optional(v.number()),
    totalInputTokens: v.number(),
    totalOutputTokens: v.number(),
    totalCacheReadTokens: v.number(),
    totalCacheWriteTokens: v.number(),
    estimatedCostUsd: v.number(),
    compacted: v.boolean(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const message = await messageFor(ctx, args);
    if (!message) throw new Error("Dialogue message was not found.");
    await ctx.db.patch(message._id, {
      state: "complete",
      safeStatus: args.compacted
        ? args.transitionBrief
          ? "Context compacted automatically; component implementation started."
          : "Context compacted automatically; response complete."
        : args.transitionBrief
          ? "Component implementation started in this Relay session."
          : "Response complete.",
      ...(args.transitionBrief
        ? { transitionBrief: bounded(args.transitionBrief, 8_000) }
        : {}),
      inputTokens: nonnegative(args.inputTokens),
      outputTokens: nonnegative(args.outputTokens),
      cacheReadTokens: nonnegative(args.cacheReadTokens),
      cacheWriteTokens: nonnegative(args.cacheWriteTokens),
      costUsd: nonnegative(args.costUsd),
      updatedAt: Date.now(),
    });
    const thread = await threadFor(ctx, args.channelId, args.threadId);
    if (thread)
      await ctx.db.patch(thread._id, {
        ...(args.transitionBrief ? { phase: "authoring" as const } : {}),
        ...(args.sessionRef
          ? { sessionRef: bounded(args.sessionRef, 500) }
          : {}),
        ...(args.contextTokens === undefined
          ? {}
          : { contextTokens: nonnegative(args.contextTokens) }),
        ...(args.contextWindow === undefined
          ? {}
          : { contextWindow: nonnegative(args.contextWindow) }),
        ...(args.contextPercent === undefined
          ? {}
          : { contextPercent: percentage(args.contextPercent) }),
        totalInputTokens: nonnegative(args.totalInputTokens),
        totalOutputTokens: nonnegative(args.totalOutputTokens),
        totalCacheReadTokens: nonnegative(args.totalCacheReadTokens),
        totalCacheWriteTokens: nonnegative(args.totalCacheWriteTokens),
        estimatedCostUsd: nonnegative(args.estimatedCostUsd),
        ...(args.compacted
          ? {
              compactionCount: (thread.compactionCount ?? 0) + 1,
              lastCompactedAt: Date.now(),
            }
          : {}),
        updatedAt: Date.now(),
      });
  },
});

export const fail = mutation({
  args: {
    workerToken: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const item = await messageFor(ctx, args);
    if (item)
      await ctx.db.patch(item._id, {
        state: "failed",
        content: item.content || bounded(args.message, 2_000),
        safeStatus: "Dialogue failed safely.",
        updatedAt: Date.now(),
      });
  },
});

export const get = query({
  args: {
    workerToken: v.string(),
    channelId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    authorize(args.workerToken);
    const thread = await threadFor(ctx, args.channelId, args.threadId);
    if (!thread) return null;
    const messages = await ctx.db
      .query("componentConversationMessages")
      .withIndex("by_thread_created", (q) =>
        q.eq("channelId", args.channelId).eq("threadId", args.threadId),
      )
      .order("asc")
      .take(200);
    return { thread, messages };
  },
});

type TurnArgs = {
  channelId: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  content: string;
};
async function insertPair(ctx: MutationCtx, args: TurnArgs, now: number) {
  const content = bounded(args.content, 8_000);
  await ctx.db.insert("componentConversationMessages", {
    channelId: args.channelId,
    threadId: args.threadId,
    messageId: bounded(args.userMessageId, 200),
    role: "user",
    state: "complete",
    content,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("componentConversationMessages", {
    channelId: args.channelId,
    threadId: args.threadId,
    messageId: bounded(args.assistantMessageId, 200),
    role: "assistant",
    state: "streaming",
    content: "",
    safeStatus: "Thinking through your request…",
    createdAt: now + 1,
    updatedAt: now + 1,
  });
}
async function threadFor(
  ctx: MutationCtx | QueryCtx,
  channelId: string,
  threadId: string,
) {
  return ctx.db
    .query("componentConversationThreads")
    .withIndex("by_channel_thread", (q) =>
      q.eq("channelId", channelId).eq("threadId", threadId),
    )
    .unique();
}
async function messageFor(
  ctx: MutationCtx | QueryCtx,
  args: { channelId: string; threadId: string; messageId: string },
) {
  return ctx.db
    .query("componentConversationMessages")
    .withIndex("by_message", (q) =>
      q
        .eq("channelId", args.channelId)
        .eq("threadId", args.threadId)
        .eq("messageId", args.messageId),
    )
    .unique();
}
function authorize(token: string) {
  const expected = process.env.COMPONENT_LOOP_WORKER_TOKEN;
  if (!expected || token !== expected)
    throw new Error("Component-loop worker authorization failed.");
}
function bounded(value: string, maximum: number) {
  if (!value || value.length > maximum)
    throw new Error("Conversation value is invalid.");
  return value;
}
function nonnegative(value: number) {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("Conversation usage is invalid.");
  return value;
}
function percentage(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100)
    throw new Error("Conversation percentage is invalid.");
  return value;
}
