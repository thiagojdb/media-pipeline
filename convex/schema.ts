import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const buildState = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("validating"),
  v.literal("failed"),
  v.literal("needs_intervention"),
  v.literal("succeeded"),
  v.literal("canceled"),
);

export default defineSchema({
  componentBuildJobs: defineTable({
    channelId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    parentCandidateId: v.optional(v.string()),
    baseSnapshotId: v.optional(v.string()),
    sourceSnapshot: v.string(),
    sourceHash: v.string(),
    state: buildState,
    attempt: v.number(),
    maxAttempts: v.number(),
    cancelRequested: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    terminalCode: v.optional(v.string()),
    terminalMessage: v.optional(v.string()),
    candidateRef: v.optional(v.string()),
    boundedStdout: v.optional(v.string()),
    boundedStderr: v.optional(v.string()),
  })
    .index("by_state_created", ["state", "createdAt"])
    .index("by_state_lease", ["state", "leaseExpiresAt"])
    .index("by_thread_turn", ["threadId", "turnId"])
    .index("by_channel_thread_turn", ["channelId", "threadId", "turnId"])
    .index("by_channel_thread_created", ["channelId", "threadId", "createdAt"]),
  componentBuildEvents: defineTable({
    jobId: v.id("componentBuildJobs"),
    createdAt: v.number(),
    kind: v.string(),
    state: buildState,
    message: v.string(),
  }).index("by_job_created", ["jobId", "createdAt"]),
});
