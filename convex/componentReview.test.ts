/// <reference types="vite/client" />

import { createHash } from "node:crypto";

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const buildWorkerToken = "component-review-build-token";

beforeEach(() => {
  process.env.COMPONENT_BUILD_WORKER_TOKEN = buildWorkerToken;
});
afterEach(() => {
  delete process.env.COMPONENT_BUILD_WORKER_TOKEN;
});

describe("component review and immutable version lifecycle", () => {
  it("requires an explicit creative decision before creating an immutable version", async () => {
    const t = convexTest(schema, modules);
    const candidateId = await validatedCandidate(t, {
      turnId: "initial",
      source: "export default 'initial-source';",
      version: "1.0.0",
      inputSchemaJson:
        '{"type":"object","properties":{"color":{"type":"string"}}}',
    });

    const reviewable = await t.query(internal.componentReview.getCandidate, {
      candidateId,
    });
    expect(reviewable).toMatchObject({
      componentId: "animated-line-chart",
      declaredVersion: "1.0.0",
      status: "reviewable",
    });
    expect(reviewable?.compatibilityWarning).toBeUndefined();
    await expect(
      t.run(async (ctx) => ctx.db.query("componentVersions").collect()),
    ).resolves.toHaveLength(0);

    const versionId = await t.mutation(internal.componentReview.approve, {
      candidateId,
      note: "Creative review passed.",
    });
    await expect(
      t.mutation(internal.componentReview.approve, {
        candidateId,
        note: "Idempotent retry.",
      }),
    ).resolves.toBe(versionId);
    const version = await t.query(internal.componentReview.getVersion, {
      versionId,
    });
    expect(version).toMatchObject({
      version: "1.0.0",
      sourceSnapshot: "export default 'initial-source';",
      sourceHash: sha("export default 'initial-source';"),
    });
  });

  it("keeps approved history and project pins unchanged across rejected and approved successors", async () => {
    const t = convexTest(schema, modules);
    const firstCandidate = await validatedCandidate(t, {
      turnId: "first",
      source: "export default 'version-one';",
      version: "1.0.0",
      inputSchemaJson:
        '{"type":"object","properties":{"color":{"type":"string"}}}',
    });
    const firstVersion = await t.mutation(internal.componentReview.approve, {
      candidateId: firstCandidate,
    });
    const pinId = await t.mutation(internal.componentReview.pinVersion, {
      channelId: "channel-review",
      projectId: "project-video",
      versionId: firstVersion,
    });

    const revisionCandidate = await validatedCandidate(t, {
      turnId: "revision",
      source: "export default 'version-two';",
      version: "2.0.0",
      inputSchemaJson:
        '{"type":"object","properties":{"color":{"type":"number"},"animate":{"type":"boolean"}}}',
      baseVersionId: firstVersion,
    });
    const revision = await t.query(internal.componentReview.getCandidate, {
      candidateId: revisionCandidate,
    });
    expect(revision?.compatibilityWarning).toContain("input schema changed");
    await expect(
      t.mutation(internal.componentReview.approve, {
        candidateId: revisionCandidate,
      }),
    ).rejects.toThrow("Acknowledge");
    await t.mutation(internal.componentReview.reject, {
      candidateId: revisionCandidate,
      note: "Color must remain a string.",
    });

    const versions = await t.query(internal.componentReview.listVersions, {
      channelId: "channel-review",
      componentId: "animated-line-chart",
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]?._id).toBe(firstVersion);
    const component = await t.run(async (ctx) =>
      ctx.db
        .query("components")
        .withIndex("by_channel_component", (q) =>
          q
            .eq("channelId", "channel-review")
            .eq("componentId", "animated-line-chart"),
        )
        .unique(),
    );
    expect(component?.latestApprovedVersionId).toBe(firstVersion);
    const pin = await t.run(async (ctx) => ctx.db.get(pinId));
    expect(pin?.versionId).toBe(firstVersion);

    const compatibleCandidate = await validatedCandidate(t, {
      turnId: "compatible-revision",
      source: "export default 'version-one-one';",
      version: "1.1.0",
      inputSchemaJson:
        '{"type":"object","properties":{"color":{"type":"string"}}}',
      baseVersionId: firstVersion,
    });
    const successorVersion = await t.mutation(
      internal.componentReview.approve,
      { candidateId: compatibleCandidate },
    );
    const versionsAfterApproval = await t.query(
      internal.componentReview.listVersions,
      {
        channelId: "channel-review",
        componentId: "animated-line-chart",
      },
    );
    expect(versionsAfterApproval.map(({ version }) => version).sort()).toEqual([
      "1.0.0",
      "1.1.0",
    ]);
    const firstStillAvailable = await t.query(
      internal.componentReview.getVersion,
      { versionId: firstVersion },
    );
    expect(firstStillAvailable?.sourceSnapshot).toBe(
      "export default 'version-one';",
    );
    const pinAfterSuccessor = await t.run(async (ctx) => ctx.db.get(pinId));
    expect(pinAfterSuccessor?.versionId).toBe(firstVersion);
    const componentAfterSuccessor = await t.run(async (ctx) =>
      ctx.db
        .query("components")
        .withIndex("by_channel_component", (q) =>
          q
            .eq("channelId", "channel-review")
            .eq("componentId", "animated-line-chart"),
        )
        .unique(),
    );
    expect(componentAfterSuccessor?.latestApprovedVersionId).toBe(
      successorVersion,
    );
  });

  it("starts revision authoring from the exact selected approved source", async () => {
    const t = convexTest(schema, modules);
    const source = "export default 'approved-exact-source';";
    const candidateId = await validatedCandidate(t, {
      turnId: "base",
      source,
      version: "1.0.0",
      inputSchemaJson: '{"type":"object"}',
    });
    const versionId = await t.mutation(internal.componentReview.approve, {
      candidateId,
    });
    const turnId = await t.mutation(internal.componentReview.enqueueRevision, {
      versionId,
      threadId: "revision-thread",
      turnId: "make-red",
      userRequest: "Make the line red and add optional draw animation.",
      acceptanceCriteria: ["Keep existing inputs compatible."],
      channelThemeJson: "{}",
      assetsMetadataJson: "{}",
      maxWallTimeMs: 30_000,
      maxModelTurns: 4,
      maxToolCalls: 10,
      maxTokens: 4_000,
      maxCostUsd: 0.25,
    });
    const turn = await t.run(async (ctx) => ctx.db.get(turnId));
    expect(turn).toMatchObject({
      baseSource: source,
      baseSourceHash: sha(source),
      baseSnapshotId: String(versionId),
      parentCandidateId: String(candidateId),
      state: "queued",
      repairAttempt: 0,
      maxRepairAttempts: 2,
    });
    expect(turn?.priorSummaries[0]).toContain("animated-line-chart@1.0.0");
  });

  it("records changes requested without approving or mutating another version", async () => {
    const t = convexTest(schema, modules);
    const candidateId = await validatedCandidate(t, {
      turnId: "changes",
      source: "export default 'changes';",
      version: "1.0.0",
      inputSchemaJson: '{"type":"object"}',
    });
    await t.mutation(internal.componentReview.requestChanges, {
      candidateId,
      note: "Use the channel accent color.",
    });
    await expect(
      t.query(internal.componentReview.getCandidate, { candidateId }),
    ).resolves.toMatchObject({
      status: "changes_requested",
      decisionNote: "Use the channel accent color.",
    });
    await expect(
      t.run(async (ctx) => ctx.db.query("componentVersions").collect()),
    ).resolves.toHaveLength(0);
  });
});

async function validatedCandidate(
  t: ReturnType<typeof convexTest>,
  options: {
    turnId: string;
    source: string;
    version: string;
    inputSchemaJson: string;
    baseVersionId?: Id<"componentVersions">;
  },
): Promise<Id<"componentCandidates">> {
  const jobId = await t.mutation(internal.componentBuildJobs.enqueue, {
    channelId: "channel-review",
    threadId: "thread-review",
    turnId: options.turnId,
    sourceSnapshot: options.source,
    sourceHash: sha(options.source),
    baseSnapshotId: options.baseVersionId
      ? String(options.baseVersionId)
      : undefined,
    maxAttempts: 1,
  });
  const claimed = await t.mutation(api.componentBuildJobs.claim, {
    workerToken: buildWorkerToken,
    workerId: "build-worker",
    leaseMs: 5_000,
  });
  if (!claimed || claimed._id !== jobId)
    throw new Error("Build was not claimed.");
  await t.mutation(api.componentBuildJobs.transition, {
    workerToken: buildWorkerToken,
    jobId,
    workerId: "build-worker",
    leaseAttempt: 1,
    nextState: "validating",
    message: "Validating candidate.",
  });
  const inputSchemaFingerprint = sha(options.inputSchemaJson);
  const validationEvidenceJson = JSON.stringify({
    schemaVersion: 1,
    checks: [
      {
        code: "preview_runtime",
        status: "passed",
        message: "All frames passed.",
      },
    ],
    fixtureCount: 1,
    checkpointCount: 2,
    renderedFrameCount: 120,
    renderFingerprint: "a".repeat(64),
    component: {
      id: "animated-line-chart",
      version: options.version,
      inputSchemaJson: options.inputSchemaJson,
      inputSchemaFingerprint,
      compatibility: options.baseVersionId
        ? { mode: "backward-compatible", previousVersion: "1.0.0" }
        : { mode: "initial" },
      dimensions: [{ width: 1280, height: 720 }],
      fixtures: [
        {
          id: "default",
          name: "Default",
          checkpoints: [
            { label: "start", frame: 0 },
            { label: "end", frame: 119 },
          ],
        },
      ],
    },
  });
  await t.mutation(api.componentBuildJobs.transition, {
    workerToken: buildWorkerToken,
    jobId,
    workerId: "build-worker",
    leaseAttempt: 1,
    nextState: "succeeded",
    code: "validated",
    message: "Candidate validation passed.",
    candidateRef: `sha256:${sha(`${options.turnId}:${options.source}`)}`,
    validationEvidenceJson,
  });
  const job = await t.query(internal.componentBuildJobs.getSafeStatus, {
    jobId,
  });
  if (!job?.candidateId)
    throw new Error("Reviewable candidate was not created.");
  return job.candidateId;
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
