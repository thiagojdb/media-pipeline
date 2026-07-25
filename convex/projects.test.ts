/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anyApi } from "convex/server";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const api = anyApi.projects!;
const serverToken = "projects-test-token";

beforeEach(() => {
  process.env.PROJECTS_SERVER_TOKEN = serverToken;
});
afterEach(() => {
  delete process.env.PROJECTS_SERVER_TOKEN;
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
