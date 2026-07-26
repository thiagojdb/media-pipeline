/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anyApi } from "convex/server";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const api = anyApi.projects!;
const narrationApi = anyApi.projectNarrations!;
const serverToken = "projects-test-token";
const narrationWorkerToken = "narration-test-token";

beforeEach(() => {
  process.env.PROJECTS_SERVER_TOKEN = serverToken;
  process.env.NARRATION_WORKER_TOKEN = narrationWorkerToken;
});
afterEach(() => {
  delete process.env.PROJECTS_SERVER_TOKEN;
  delete process.env.NARRATION_WORKER_TOKEN;
});

describe("membership-backed channel projects", () => {
  it("creates, lists, renames, and archives without deleting history", async () => {
    const t = convexTest(schema, modules);
    const workspace = await bootstrap(t, "creator");
    const projectId = await t.mutation(api.create, {
      ...access(workspace.channel.id, "creator"),
      name: "  Election night explainer  ",
      description: "  A source-led results video.  ",
    });

    await expect(
      t.query(api.list, access(workspace.channel.id, "creator")),
    ).resolves.toEqual([
      expect.objectContaining({
        _id: projectId,
        channelId: workspace.channel.id,
        creatorMembershipId: workspace.membership.id,
        name: "Election night explainer",
        description: "A source-led results video.",
        status: "active",
      }),
    ]);

    await t.mutation(api.rename, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      name: "Election results explained",
      description: "",
    });
    await t.mutation(api.archive, {
      ...access(workspace.channel.id, "creator"),
      projectId,
    });
    const archived = await t.query(api.get, {
      ...access(workspace.channel.id, "creator"),
      projectId,
    });
    expect(archived).toMatchObject({
      name: "Election results explained",
      status: "archived",
    });
    expect(archived.archivedAt).toEqual(expect.any(Number));
    await expect(
      t.mutation(api.rename, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        name: "Cannot edit this",
      }),
    ).rejects.toThrow("read-only");
  });

  it("rejects invalid input and every non-member read or mutation", async () => {
    const t = convexTest(schema, modules);
    const workspace = await bootstrap(t, "creator");
    const projectId = await t.mutation(api.create, {
      ...access(workspace.channel.id, "creator"),
      name: "Project one",
    });
    await bootstrap(t, "outsider", "outsider-studio");

    await expect(
      t.mutation(api.create, {
        ...access(workspace.channel.id, "creator"),
        name: "   ",
      }),
    ).rejects.toThrow("name is required");
    await expect(
      t.query(api.list, access(workspace.channel.id, "outsider")),
    ).rejects.toThrow("membership is required");
    await expect(
      t.query(api.get, {
        ...access(workspace.channel.id, "outsider"),
        projectId,
      }),
    ).rejects.toThrow("membership is required");
    await expect(
      t.mutation(api.archive, {
        ...access(workspace.channel.id, "outsider"),
        projectId,
      }),
    ).rejects.toThrow("membership is required");
    await expect(
      t.query(api.list, {
        ...access(workspace.channel.id, "creator"),
        serverToken: "wrong-token",
      }),
    ).rejects.toThrow("authorization failed");
  });

  it("preserves canonical URL and validated file sources with ownership metadata", async () => {
    const t = convexTest(schema, modules);
    const workspace = await bootstrap(t, "creator");
    const projectId = await t.mutation(api.create, {
      ...access(workspace.channel.id, "creator"),
      name: "Source-backed story",
    });
    const urlSourceId = await t.mutation(api.addUrlSource, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      title: "National results",
      url: "https://example.com/results?region=north#latest",
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["source evidence"], { type: "text/plain" })),
    );
    const fileSourceId = await t.mutation(api.addFileSource, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      title: "Interview transcript",
      fileName: "interview.txt",
      mediaType: "text/plain",
      storageId,
    });

    const sources = await t.query(api.listSources, {
      ...access(workspace.channel.id, "creator"),
      projectId,
    });
    expect(sources).toHaveLength(2);
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: urlSourceId,
          channelId: workspace.channel.id,
          projectId,
          addedByMembershipId: workspace.membership.id,
          kind: "url",
          normalizedUrl: "https://example.com/results?region=north",
          mediaType: "text/html",
          byteSize: 0,
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          hashKind: "reference_sha256",
        }),
        expect.objectContaining({
          _id: fileSourceId,
          storageId,
          kind: "file",
          fileName: "interview.txt",
          mediaType: "text/plain",
          byteSize: 15,
          contentHash: expect.any(String),
          hashKind: "file_sha256",
          downloadUrl: expect.any(String),
        }),
      ]),
    );

    await t.mutation(api.removeSource, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      sourceId: fileSourceId,
    });
    await expect(
      t.query(api.listSources, {
        ...access(workspace.channel.id, "creator"),
        projectId,
      }),
    ).resolves.toEqual([expect.objectContaining({ _id: urlSourceId })]);
    const removed = await t.run((ctx) => ctx.db.get(fileSourceId));
    expect(removed).toMatchObject({ status: "removed" });
    await expect(
      t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).resolves.not.toBeNull();
  });

  it("creates immutable monotonic script versions and resolves exact history", async () => {
    const t = convexTest(schema, modules);
    const workspace = await bootstrap(t, "creator");
    const projectId = await t.mutation(api.create, {
      ...access(workspace.channel.id, "creator"),
      name: "Versioned script",
    });
    const firstContent = "Opening line.\n\nFirst explanation.";
    const first = await t.mutation(api.saveScriptVersion, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      content: firstContent,
      provenance: "import",
    });
    const second = await t.mutation(api.saveScriptVersion, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      content: "Revised opening.\n\nFirst explanation.",
      provenance: "manual",
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    await expect(
      t.query(api.getScriptVersion, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        version: 1,
      }),
    ).resolves.toMatchObject({
      _id: first.scriptVersionId,
      version: 1,
      content: firstContent,
      provenance: "import",
      createdByMembershipId: workspace.membership.id,
    });
    await expect(
      t.query(api.listScriptVersions, {
        ...access(workspace.channel.id, "creator"),
        projectId,
      }),
    ).resolves.toMatchObject({
      current: {
        _id: second.scriptVersionId,
        version: 2,
        content: "Revised opening.\n\nFirst explanation.",
      },
      versions: [
        { version: 2, provenance: "manual" },
        { version: 1, provenance: "import" },
      ],
      maximumCharacters: 100_000,
    });
    const stored = await t.run((ctx) =>
      ctx.db
        .query("scriptVersions")
        .withIndex("by_project_version", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(stored.map((version) => version.content)).toEqual([
      firstContent,
      "Revised opening.\n\nFirst explanation.",
    ]);
  });

  it("rejects empty, oversized, archived, missing, and non-member script access", async () => {
    const t = convexTest(schema, modules);
    const workspace = await bootstrap(t, "creator");
    const projectId = await t.mutation(api.create, {
      ...access(workspace.channel.id, "creator"),
      name: "Protected script",
    });
    await bootstrap(t, "outsider", "outsider-studio");

    await expect(
      t.mutation(api.saveScriptVersion, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        content: " \n ",
        provenance: "manual",
      }),
    ).rejects.toThrow("Script content is required");
    await expect(
      t.mutation(api.saveScriptVersion, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        content: "x".repeat(100_001),
        provenance: "manual",
      }),
    ).rejects.toThrow("at most 100,000 characters");
    await expect(
      t.query(api.listScriptVersions, {
        ...access(workspace.channel.id, "outsider"),
        projectId,
      }),
    ).rejects.toThrow("membership is required");
    await expect(
      t.query(api.getScriptVersion, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        version: 1,
      }),
    ).rejects.toThrow("Script version was not found");

    await t.mutation(api.archive, {
      ...access(workspace.channel.id, "creator"),
      projectId,
    });
    await expect(
      t.mutation(api.saveScriptVersion, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        content: "Cannot save",
        provenance: "manual",
      }),
    ).rejects.toThrow("read-only");
  });

  it("runs durable generated narration through timing, playback storage, telemetry, and cancellation", async () => {
    const t = convexTest(schema, modules);
    const workspace = await bootstrap(t, "creator");
    const projectId = await t.mutation(api.create, {
      ...access(workspace.channel.id, "creator"),
      name: "Narrated project",
    });
    const script = await t.mutation(api.saveScriptVersion, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      content: "Opening line. The evidence follows.",
      provenance: "manual",
    });
    const { jobId } = await t.mutation(narrationApi.enqueue, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      scriptVersionId: script.scriptVersionId,
    });
    await expect(
      t.query(narrationApi.list, {
        ...access(workspace.channel.id, "creator"),
        projectId,
      }),
    ).resolves.toMatchObject({
      versions: [],
      jobs: [{ _id: jobId, state: "queued", attempt: 0 }],
    });

    const claim = await t.mutation(narrationApi.claim, {
      workerToken: narrationWorkerToken,
      workerId: "narration-worker",
      leaseMs: 30_000,
    });
    expect(claim).toMatchObject({
      _id: jobId,
      state: "running",
      attempt: 1,
      scriptContent: "Opening line. The evidence follows.",
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([`RIFF${"0".repeat(124)}`], { type: "audio/wav" }),
      ),
    );
    const completed = await t.mutation(narrationApi.complete, {
      workerToken: narrationWorkerToken,
      workerId: "narration-worker",
      leaseAttempt: 1,
      jobId,
      storageId,
      durationMs: 2_000,
      timingSegments: [
        { index: 0, startMs: 0, endMs: 900, text: "Opening line." },
        {
          index: 1,
          startMs: 900,
          endMs: 2_000,
          text: "The evidence follows.",
        },
      ],
      usageCharacters: 35,
      estimatedCostUsd: 0,
      wallTimeMs: 12,
    });
    expect(completed.version).toBe(1);
    await expect(
      t.query(narrationApi.list, {
        ...access(workspace.channel.id, "creator"),
        projectId,
      }),
    ).resolves.toMatchObject({
      versions: [
        {
          version: 1,
          scriptVersionId: script.scriptVersionId,
          provider: "relay-fake-tts",
          model: "deterministic-wave-v1",
          durationMs: 2_000,
          usageCharacters: 35,
          estimatedCostUsd: 0,
          audioUrl: expect.any(String),
        },
      ],
      jobs: [{ _id: jobId, state: "succeeded" }],
    });

    const canceled = await t.mutation(narrationApi.enqueue, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      scriptVersionId: script.scriptVersionId,
    });
    await t.mutation(narrationApi.claim, {
      workerToken: narrationWorkerToken,
      workerId: "narration-worker",
      leaseMs: 30_000,
    });
    await t.mutation(narrationApi.requestCancel, {
      ...access(workspace.channel.id, "creator"),
      projectId,
      jobId: canceled.jobId,
    });
    await t.mutation(narrationApi.fail, {
      workerToken: narrationWorkerToken,
      workerId: "narration-worker",
      leaseAttempt: 1,
      jobId: canceled.jobId,
      state: "failed",
      code: "provider_failed",
      message: "Provider failed.",
    });
    const canceledRecord = await t.run((ctx) => ctx.db.get(canceled.jobId));
    expect(canceledRecord).toMatchObject({
      state: "canceled",
      terminalCode: "provider_failed",
      cancelRequested: true,
    });
  });

  it("probes uploaded narration as immutable replacement versions", async () => {
    const t = convexTest(schema, modules);
    const workspace = await bootstrap(t, "creator");
    const projectId = await t.mutation(api.create, {
      ...access(workspace.channel.id, "creator"),
      name: "Uploaded voiceover",
    });

    for (const [index, fileName] of [
      "first.wav",
      "replacement.wav",
    ].entries()) {
      const storageId = await t.run((ctx) =>
        ctx.storage.store(
          new Blob([`RIFF${String(index).repeat(124)}`], {
            type: "audio/wav",
          }),
        ),
      );
      const queued = await t.mutation(narrationApi.enqueueUpload, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        storageId,
        fileName,
        mediaType: "audio/wav",
      });
      const claim = await t.mutation(narrationApi.claim, {
        workerToken: narrationWorkerToken,
        workerId: "probe-worker",
        leaseMs: 30_000,
      });
      expect(claim).toMatchObject({
        _id: queued.jobId,
        kind: "upload",
        sourceStorageId: storageId,
        sourceUrl: expect.any(String),
      });
      await t.mutation(narrationApi.completeUpload, {
        workerToken: narrationWorkerToken,
        workerId: "probe-worker",
        leaseAttempt: 1,
        jobId: queued.jobId,
        durationMs: 2_000 + index * 500,
        mediaType: "audio/wav",
        audioCodec: "pcm_s16le",
        sampleRate: 16_000,
        channels: 1,
        wallTimeMs: 8,
      });
    }

    const result = await t.query(narrationApi.list, {
      ...access(workspace.channel.id, "creator"),
      projectId,
    });
    expect(result.versions).toMatchObject([
      {
        version: 2,
        provenance: "upload",
        fileName: "replacement.wav",
        durationMs: 2_500,
        audioCodec: "pcm_s16le",
        sampleRate: 16_000,
        channels: 1,
        audioUrl: expect.any(String),
      },
      {
        version: 1,
        provenance: "upload",
        fileName: "first.wav",
        durationMs: 2_000,
        audioUrl: expect.any(String),
      },
    ]);
    expect(result.versions[0]?._id).not.toBe(result.versions[1]?._id);
  });

  it("rejects unsafe URLs, invalid files, oversized uploads, and non-member access", async () => {
    const t = convexTest(schema, modules);
    const workspace = await bootstrap(t, "creator");
    const projectId = await t.mutation(api.create, {
      ...access(workspace.channel.id, "creator"),
      name: "Protected sources",
    });
    await bootstrap(t, "outsider", "outsider-studio");

    await expect(
      t.mutation(api.addUrlSource, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        title: "Unsafe URL",
        url: "https://example.com/private?access_token=secret",
      }),
    ).rejects.toThrow("secret parameters");
    await expect(
      t.mutation(api.createSourceUploadUrl, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        fileName: "too-large.pdf",
        mediaType: "application/pdf",
        byteSize: 25 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow("25 MB limit");
    const invalidStorageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob(["not allowed"], { type: "application/x-msdownload" }),
      ),
    );
    await expect(
      t.mutation(api.addFileSource, {
        ...access(workspace.channel.id, "creator"),
        projectId,
        title: "Executable",
        fileName: "unsafe.exe",
        mediaType: "application/x-msdownload",
        storageId: invalidStorageId,
      }),
    ).rejects.toThrow("not allowed");
    await expect(
      t.run((ctx) => ctx.db.query("projectSources").collect()),
    ).resolves.toEqual([]);
    await expect(
      t.query(api.listSources, {
        ...access(workspace.channel.id, "outsider"),
        projectId,
      }),
    ).rejects.toThrow("membership is required");
    await expect(
      t.mutation(api.addUrlSource, {
        ...access(workspace.channel.id, "outsider"),
        projectId,
        title: "No access",
        url: "https://example.com",
      }),
    ).rejects.toThrow("membership is required");
  });
});

function access(channelId: string, identitySubject: string) {
  return { serverToken, channelId, identitySubject };
}

async function bootstrap(
  t: ReturnType<typeof convexTest>,
  identitySubject: string,
  channelSlug = "relay-studio",
) {
  return t.mutation(api.bootstrapDevelopmentWorkspace, {
    serverToken,
    identitySubject,
    userName: identitySubject === "creator" ? "Thiago" : "Outsider",
    channelSlug,
    channelName: channelSlug === "relay-studio" ? "Relay Studio" : "Other",
  });
}
