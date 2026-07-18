import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DraftRenderExecutor } from "../src/draft-render-contract.js";
import {
  createFakeDraftRenderExecutor,
  DraftRenderRequestError,
  DraftRenderService,
} from "../src/draft-render-service.js";

const directories: string[] = [];

async function service(executor = createFakeDraftRenderExecutor(1)) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "relay-render-test-"));
  directories.push(directory);
  return new DraftRenderService(executor, directory);
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("draft render service", () => {
  it("pins settings, reports progress, and exposes output only after success", async () => {
    const renders = await service();
    const created = await renders.create(validRequest());
    expect(created).toMatchObject({
      state: "queued",
      progress: 0,
      component: {
        id: "animated-line-chart",
        version: "1.0.0",
        fixtureId: "channel-growth",
      },
      settings: {
        fps: 30,
        durationInFrames: 120,
        dimensions: { width: 960, height: 540 },
        quality: { codec: "h264", crf: 28, pixelFormat: "yuv420p" },
      },
    });
    await expect(renders.output(created.id)).rejects.toMatchObject({
      code: "output_unavailable",
    });

    const succeeded = await waitForTerminal(renders, created.id);
    expect(succeeded).toMatchObject({
      state: "succeeded",
      progress: 1,
      output: {
        mediaType: "video/mp4",
        sizeBytes: expect.any(Number),
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        visualFingerprint: expect.stringMatching(/^fake:/),
      },
    });
    await expect(renders.output(created.id)).resolves.toMatchObject({
      sizeBytes: expect.any(Number),
    });

    const repeated = await waitForTerminal(
      renders,
      (await renders.create(validRequest())).id,
    );
    expect(repeated.reproducibilityKey).toBe(succeeded.reproducibilityKey);
    expect(repeated.output?.visualFingerprint).toBe(
      succeeded.output?.visualFingerprint,
    );
  });

  it("accepts selectable HD through 4K output resolutions", async () => {
    const renders = await service();
    for (const dimensions of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 3840, height: 2160 },
    ]) {
      const completed = await waitForTerminal(
        renders,
        (await renders.create({ ...validRequest(), dimensions })).id,
      );
      expect(completed.state).toBe("succeeded");
      expect(completed.settings.dimensions).toEqual(dimensions);
    }
  });

  it("rejects unpinned metadata, invalid inputs, and unsupported dimensions", async () => {
    const renders = await service();
    for (const [candidate, code] of [
      [
        { ...validRequest(), version: "1.0.1" },
        "component_version_unavailable",
      ],
      [{ ...validRequest(), fps: 24 }, "fps_mismatch"],
      [{ ...validRequest(), durationInFrames: 119 }, "duration_mismatch"],
      [
        { ...validRequest(), dimensions: { width: 7680, height: 4320 } },
        "dimensions_unsupported",
      ],
      [
        { ...validRequest(), input: { title: "", labels: [], series: [] } },
        "input_invalid",
      ],
    ] as const) {
      await expect(renders.create(candidate)).rejects.toMatchObject({ code });
    }
  });

  it("moves running work to canceled and never publishes partial output", async () => {
    const renders = await service(createFakeDraftRenderExecutor(50));
    const created = await renders.create(validRequest());
    await waitForState(renders, created.id, "running");
    const canceled = renders.cancel(created.id);
    expect(canceled).toMatchObject({
      state: "canceled",
      error: { code: "render_canceled" },
    });
    await expect(renders.output(created.id)).rejects.toMatchObject({
      code: "output_unavailable",
    });
  });

  it("turns output storage and executor failures into actionable terminal states", async () => {
    const parent = await mkdtemp(
      path.join(os.tmpdir(), "relay-render-storage-"),
    );
    directories.push(parent);
    const blockedOutputRoot = path.join(parent, "not-a-directory");
    await writeFile(blockedOutputRoot, "file");
    const blocked = new DraftRenderService(
      createFakeDraftRenderExecutor(1),
      blockedOutputRoot,
    );
    const storageFailure = await waitForTerminal(
      blocked,
      (await blocked.create(validRequest())).id,
    );
    expect(storageFailure).toMatchObject({
      state: "failed",
      error: {
        code: "output_storage_failed",
        message:
          "The worker could not store the draft output. Check worker storage and try again.",
      },
    });

    const failing: DraftRenderExecutor = {
      async execute() {
        throw new Error("FFmpeg exited with code 7.");
      },
    };
    const renders = await service(failing);
    const failed = await waitForTerminal(
      renders,
      (await renders.create(validRequest())).id,
    );
    expect(failed).toMatchObject({
      state: "failed",
      error: {
        code: "render_failed",
        message:
          "The video renderer failed. Retry the draft or review the worker diagnostics.",
      },
    });
    expect(failed.output).toBeUndefined();
  });
});

function validRequest() {
  return {
    componentId: "animated-line-chart",
    version: "1.0.0",
    fixtureId: "channel-growth",
    input: {
      title: "Monthly channel growth",
      labels: ["Jan", "Feb"],
      series: [{ id: "views", label: "Views", values: [10, 20] }],
      animate: true,
    },
    fps: 30,
    durationInFrames: 120,
    dimensions: { width: 960, height: 540 },
    theme: {
      colors: { background: "#07111f" },
      fonts: { heading: "Arial" },
      spacing: { outer: 48 },
    },
    quality: { codec: "h264", crf: 28, pixelFormat: "yuv420p" },
  };
}

async function waitForState(
  renders: DraftRenderService,
  id: string,
  state: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = renders.get(id);
    if (snapshot.state === state) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new DraftRenderRequestError(
    "test_timeout",
    `Did not reach ${state}.`,
    500,
  );
}

async function waitForTerminal(renders: DraftRenderService, id: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const snapshot = renders.get(id);
    if (["succeeded", "failed", "canceled"].includes(snapshot.state)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Draft render did not reach a terminal state.");
}
