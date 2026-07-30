import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const componentBuildToken = "build-queue-token";
const authoringToken = "authoring-queue-token";
const narrationToken = "narration-queue-token";

beforeEach(() => {
  process.env.COMPONENT_BUILD_WORKER_TOKEN = componentBuildToken;
  process.env.AUTHORING_WORKER_TOKEN = authoringToken;
  process.env.NARRATION_WORKER_TOKEN = narrationToken;
});

afterEach(() => {
  delete process.env.COMPONENT_BUILD_WORKER_TOKEN;
  delete process.env.AUTHORING_WORKER_TOKEN;
  delete process.env.NARRATION_WORKER_TOKEN;
});

describe("worker queue availability", () => {
  it("reports only real queued work across every worker boundary", async () => {
    const t = convexTest(schema, modules);
    const args = { componentBuildToken, authoringToken, narrationToken };

    await expect(t.query(api.workerQueues.availability, args)).resolves.toEqual(
      {
        componentBuild: false,
        componentAuthoring: false,
        narration: false,
        projectRender: false,
      },
    );

    await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        identitySubject: "queue-test-user",
        name: "Queue Test",
        createdAt: now,
        updatedAt: now,
      });
      const channelId = await ctx.db.insert("channels", {
        slug: "queue-test",
        name: "Queue Test",
        createdAt: now,
        updatedAt: now,
      });
      const membershipId = await ctx.db.insert("channelMemberships", {
        channelId,
        userId,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      });
      const projectId = await ctx.db.insert("projects", {
        channelId,
        creatorMembershipId: membershipId,
        name: "Queue Test",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1])], { type: "audio/wav" }),
      );
      const narrationVersionId = await ctx.db.insert("narrationVersions", {
        channelId,
        projectId,
        createdByMembershipId: membershipId,
        version: 1,
        provenance: "upload",
        storageId,
        mediaType: "audio/wav",
        durationMs: 1_000,
        alignmentState: "approved",
        wordTimings: [
          {
            index: 0,
            word: "Opening",
            startMs: 0,
            endMs: 500,
            match: "exact",
          },
        ],
        timingSegments: [],
        createdAt: now,
      });
      const compositionVersionId = await ctx.db.insert("compositionVersions", {
        channelId,
        projectId,
        narrationVersionId,
        createdByMembershipId: membershipId,
        version: 1,
        schemaVersion: 1,
        provenance: "manual",
        compositionJson: "{}",
        createdAt: now,
      });

      await ctx.db.insert("componentBuildJobs", {
        channelId: String(channelId),
        threadId: "thread",
        turnId: "build-turn",
        sourceSnapshot: "export const candidate = true;",
        sourceHash: "a".repeat(64),
        state: "queued",
        attempt: 0,
        maxAttempts: 2,
        cancelRequested: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("authoringTurns", {
        channelId: String(channelId),
        threadId: "thread",
        turnId: "authoring-turn",
        userRequest: "Create a component",
        acceptanceCriteria: [],
        baseSource: "export const candidate = true;",
        baseSourceHash: "a".repeat(64),
        channelThemeJson: "{}",
        assetsMetadataJson: "{}",
        priorSummaries: [],
        state: "queued",
        attempt: 0,
        maxAttempts: 1,
        cancelRequested: false,
        maxWallTimeMs: 5_000,
        maxModelTurns: 1,
        maxToolCalls: 1,
        maxTokens: 100,
        maxCostUsd: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("narrationJobs", {
        channelId,
        projectId,
        createdByMembershipId: membershipId,
        provider: "test",
        model: "test",
        state: "queued",
        attempt: 0,
        maxAttempts: 2,
        cancelRequested: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("projectRenderJobs", {
        channelId,
        projectId,
        compositionVersionId,
        narrationVersionId,
        createdByMembershipId: membershipId,
        rangeKind: "full",
        rangeStartMs: 0,
        rangeEndMs: 1_000,
        width: 640,
        height: 360,
        fps: 30,
        state: "queued",
        progress: 0,
        attempt: 0,
        maxAttempts: 2,
        cancelRequested: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(t.query(api.workerQueues.availability, args)).resolves.toEqual(
      {
        componentBuild: true,
        componentAuthoring: true,
        narration: true,
        projectRender: true,
      },
    );
    await expect(
      t.query(api.workerQueues.availability, {
        componentBuildToken: "wrong-token",
      }),
    ).rejects.toThrow("Unauthorized component build worker");
  });
});
