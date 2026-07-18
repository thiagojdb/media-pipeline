import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeDraftRenderExecutor,
  DraftRenderService,
} from "../src/draft-render-service.js";
import { createWorkerServer } from "../src/server.js";

const servers = new Set<ReturnType<typeof createWorkerServer>>();
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  servers.clear();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("worker HTTP boundary", () => {
  it("reports the worker boundary as ready", async () => {
    const server = createWorkerServer().listen(0, "127.0.0.1");
    servers.add(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));

    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "relay-worker",
      status: "ready",
      componentBuilds: "disabled",
      authoring: "disabled",
    });
  });

  it("reports the live component-build control-loop state", async () => {
    let componentBuildState: "running" | "degraded" = "running";
    let authoringState: "running" | "degraded" = "running";
    const server = createWorkerServer({
      componentBuildStatus: () => componentBuildState,
      authoringStatus: () => authoringState,
    }).listen(0, "127.0.0.1");
    servers.add(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    let response = await fetch(`http://127.0.0.1:${port}/health`);
    await expect(response.json()).resolves.toMatchObject({
      componentBuilds: "running",
      authoring: "running",
    });
    componentBuildState = "degraded";
    authoringState = "degraded";
    response = await fetch(`http://127.0.0.1:${port}/health`);
    await expect(response.json()).resolves.toMatchObject({
      componentBuilds: "degraded",
      authoring: "degraded",
    });
  });

  it("creates, observes, and downloads a successful worker render", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "relay-worker-http-"),
    );
    directories.push(directory);
    const draftRenders = new DraftRenderService(
      createFakeDraftRenderExecutor(1),
      directory,
    );
    const server = createWorkerServer({ draftRenders }).listen(0, "127.0.0.1");
    servers.add(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const createResponse = await fetch(`${baseUrl}/draft-renders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        componentId: "animated-line-chart",
        version: "1.0.0",
        fixtureId: "empty",
        input: { title: "No observations", labels: [], series: [] },
        fps: 30,
        durationInFrames: 120,
        dimensions: { width: 960, height: 540 },
        theme: { colors: {}, fonts: {}, spacing: {} },
        quality: { codec: "h264", crf: 28, pixelFormat: "yuv420p" },
      }),
    });
    expect(createResponse.status).toBe(202);
    const created = (await createResponse.json()) as { id: string };

    let state = "queued";
    for (
      let attempt = 0;
      attempt < 100 && state !== "succeeded";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      const statusResponse = await fetch(
        `${baseUrl}/draft-renders/${created.id}`,
      );
      const snapshot = (await statusResponse.json()) as { state: string };
      state = snapshot.state;
    }
    expect(state).toBe("succeeded");

    const outputResponse = await fetch(
      `${baseUrl}/draft-renders/${created.id}/output`,
    );
    expect(outputResponse.status).toBe(200);
    expect(outputResponse.headers.get("content-type")).toBe("video/mp4");
    expect((await outputResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
