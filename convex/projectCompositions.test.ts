/// <reference types="vite/client" />

import { createHash } from "node:crypto";

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anyApi } from "convex/server";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const projectsApi = anyApi.projects!;
const compositionsApi = anyApi.projectCompositions!;
const serverToken = "projects-test-token";

beforeEach(() => {
  process.env.PROJECTS_SERVER_TOKEN = serverToken;
});
afterEach(() => {
  delete process.env.PROJECTS_SERVER_TOKEN;
});

describe("structured project composition versions", () => {
  it("publishes immutable versions and keeps one render-ready current record", async () => {
    const fixture = await setup();
    const first = await fixture.t.mutation(compositionsApi.save, {
      ...fixture.access,
      projectId: fixture.projectId,
      provenance: "manual",
      composition: fixture.composition("Original title"),
    });
    const second = await fixture.t.mutation(compositionsApi.save, {
      ...fixture.access,
      projectId: fixture.projectId,
      provenance: "agent",
      composition: fixture.composition("Agent revision"),
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    const listed = await fixture.t.query(compositionsApi.list, {
      ...fixture.access,
      projectId: fixture.projectId,
    });
    expect(listed).toMatchObject({
      current: {
        _id: second.compositionVersionId,
        version: 2,
        schemaVersion: 1,
        provenance: "agent",
        narrationVersionId: fixture.narrationVersionId,
      },
      versions: [
        { version: 2, segmentCount: 2 },
        { version: 1, segmentCount: 2 },
      ],
    });
    const historical = await fixture.t.query(compositionsApi.getByVersion, {
      ...fixture.access,
      projectId: fixture.projectId,
      version: 1,
    });
    expect(historical.composition).toEqual(
      fixture.composition("Original title"),
    );
    expect(JSON.parse(listed.current!.compositionJson)).toEqual(
      fixture.composition("Agent revision"),
    );
  });

  it("rejects unapproved versions, invalid inputs, bad anchors, and timing outside narration", async () => {
    const fixture = await setup();
    const valid = fixture.composition("Valid");

    await expect(
      fixture.t.mutation(compositionsApi.save, {
        ...fixture.access,
        projectId: fixture.projectId,
        provenance: "manual",
        composition: {
          ...valid,
          segments: [
            {
              ...valid.segments[0],
              componentVersionId: fixture.candidateId,
            },
          ],
        },
      }),
    ).rejects.toThrow("approved channel component version");

    await expect(
      fixture.t.mutation(compositionsApi.save, {
        ...fixture.access,
        projectId: fixture.projectId,
        provenance: "manual",
        composition: {
          ...valid,
          segments: [
            {
              ...valid.segments[0],
              input: { score: -1 },
            },
          ],
        },
      }),
    ).rejects.toThrow("$.title is required");

    await expect(
      fixture.t.mutation(compositionsApi.save, {
        ...fixture.access,
        projectId: fixture.projectId,
        provenance: "manual",
        composition: {
          ...valid,
          segments: [
            {
              ...valid.segments[0],
              anchor: {
                kind: "beat",
                beatId: fixture.beatId,
                startMs: 0,
                endMs: 900,
              },
            },
          ],
        },
      }),
    ).rejects.toThrow("timing must match");

    await expect(
      fixture.t.mutation(compositionsApi.save, {
        ...fixture.access,
        projectId: fixture.projectId,
        provenance: "manual",
        composition: {
          ...valid,
          segments: [
            {
              ...valid.segments[1],
              anchor: { kind: "time", startMs: 2_500, endMs: 3_500 },
            },
          ],
        },
      }),
    ).rejects.toThrow("exceeds the narration duration");

    await expect(
      fixture.t.run((ctx) => ctx.db.query("compositionVersions").collect()),
    ).resolves.toEqual([]);
  });
});

async function setup() {
  const t = convexTest(schema, modules);
  const workspace = await t.mutation(
    projectsApi.bootstrapDevelopmentWorkspace,
    {
      serverToken,
      identitySubject: "creator",
      userName: "Thiago",
      channelSlug: "relay-studio",
      channelName: "Relay Studio",
    },
  );
  const access = {
    serverToken,
    identitySubject: "creator",
    channelId: workspace.channel.id,
  };
  const projectId = await t.mutation(projectsApi.create, {
    ...access,
    name: "Composed story",
  });
  const records = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["image"], { type: "image/png" }),
    );
    const narrationStorageId = await ctx.storage.store(
      new Blob([`RIFF${"0".repeat(124)}`], { type: "audio/wav" }),
    );
    const narrationVersionId = await ctx.db.insert("narrationVersions", {
      channelId: workspace.channel.id,
      projectId,
      createdByMembershipId: workspace.membership.id,
      version: 1,
      provenance: "upload",
      storageId: narrationStorageId,
      mediaType: "audio/wav",
      durationMs: 3_000,
      timingSegments: [],
      createdAt: 10,
    });
    const beatId = await ctx.db.insert("beats", {
      channelId: workspace.channel.id,
      projectId,
      narrationVersionId,
      createdByMembershipId: workspace.membership.id,
      order: 0,
      startMs: 0,
      endMs: 1_000,
      title: "Hook",
      createdAt: 20,
      updatedAt: 20,
    });
    const sourceId = await ctx.db.insert("projectSources", {
      channelId: workspace.channel.id,
      projectId,
      addedByMembershipId: workspace.membership.id,
      kind: "file",
      status: "active",
      title: "Results map",
      storageId,
      fileName: "map.png",
      mediaType: "image/png",
      byteSize: 5,
      contentHash: sha("image"),
      hashKind: "file_sha256",
      createdAt: 30,
      updatedAt: 30,
    });
    const buildJobId = await ctx.db.insert("componentBuildJobs", {
      channelId: workspace.channel.id,
      threadId: "composition-fixture",
      turnId: "turn-1",
      sourceSnapshot: "export default null",
      sourceHash: sha("component"),
      state: "succeeded",
      attempt: 1,
      maxAttempts: 2,
      cancelRequested: false,
      createdAt: 40,
      updatedAt: 40,
    });
    const inputSchemaJson = JSON.stringify({
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        score: { type: "number", minimum: 0 },
      },
      required: ["title", "score"],
      additionalProperties: false,
    });
    const candidateId = await ctx.db.insert("componentCandidates", {
      channelId: workspace.channel.id,
      componentId: "result-card",
      declaredVersion: "1.0.0",
      buildJobId,
      sourceHash: sha("component"),
      candidateRef: "candidate://result-card",
      validationEvidenceJson: "{}",
      inputSchemaJson,
      inputSchemaFingerprint: sha(inputSchemaJson),
      compatibilityJson: '{"mode":"initial"}',
      fixturesJson: "[]",
      dimensionsJson: '[{"width":1920,"height":1080}]',
      status: "approved",
      createdAt: 40,
      updatedAt: 40,
    });
    const componentVersionId = await ctx.db.insert("componentVersions", {
      channelId: workspace.channel.id,
      componentId: "result-card",
      version: "1.0.0",
      candidateId,
      buildJobId,
      sourceHash: sha("component"),
      candidateRef: "candidate://result-card",
      validationEvidenceJson: "{}",
      inputSchemaJson,
      inputSchemaFingerprint: sha(inputSchemaJson),
      fixturesJson: "[]",
      dimensionsJson: '[{"width":1920,"height":1080}]',
      approvedAt: 50,
    });
    await ctx.db.patch(projectId, {
      currentNarrationVersionId: narrationVersionId,
      currentNarrationVersionNumber: 1,
    });
    return {
      narrationVersionId,
      beatId,
      sourceId,
      candidateId,
      componentVersionId,
    };
  });

  return {
    t,
    access,
    projectId,
    ...records,
    composition: (title: string) => ({
      schemaVersion: 1 as const,
      narrationVersionId: records.narrationVersionId,
      fps: 30,
      width: 1_920,
      height: 1_080,
      segments: [
        {
          id: "hook-card",
          kind: "component" as const,
          componentVersionId: records.componentVersionId,
          input: { title, score: 72 },
          anchor: {
            kind: "beat" as const,
            beatId: records.beatId,
            startMs: 0,
            endMs: 1_000,
          },
        },
        {
          id: "results-map",
          kind: "media" as const,
          sourceId: records.sourceId,
          fit: "cover" as const,
          anchor: {
            kind: "time" as const,
            startMs: 1_200,
            endMs: 3_000,
          },
        },
      ],
    }),
  };
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
