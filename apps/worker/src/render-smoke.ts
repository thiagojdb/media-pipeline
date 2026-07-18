import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getVideoMetadata } from "@remotion/renderer";
import { lineChart } from "@relay/reference-components";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";

import type { PinnedDraftRenderRequest } from "./draft-render-contract.js";
import { RemotionDraftRenderExecutor } from "./remotion-draft-renderer.js";

const fixture = lineChart.fixtures.find(({ id }) => id === "channel-growth")!;
const request: PinnedDraftRenderRequest = {
  componentId: lineChart.id,
  version: lineChart.version,
  fixtureId: fixture.id,
  input: fixture.input,
  fps: lineChart.fps,
  durationInFrames: 120,
  dimensions: { width: 960, height: 540 },
  theme: {
    colors: {
      background: "#07111f",
      foreground: "#f4f7fb",
      muted: "#91a3ba",
      grid: "#24364d",
      accent: "#ffb000",
      chartPrimary: "#00c2ff",
      chartSecondary: "#d76cff",
    },
    fonts: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
    spacing: { outer: 72 },
  },
  quality: { codec: "h264", crf: 28, pixelFormat: "yuv420p" },
};

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), "relay-render-smoke-"));
let webServer: ChildProcess | undefined;
try {
  const executor = new RemotionDraftRenderExecutor();
  const first = await render(executor, path.join(directory, "first.mp4"));
  const second = await render(executor, path.join(directory, "second.mp4"));
  assert.equal(
    first.visualFingerprint,
    second.visualFingerprint,
    "Identical inputs must produce identical checkpoint visuals.",
  );

  const firstMetadata = await assertPlayableMp4(first.outputPath);
  const secondMetadata = await assertPlayableMp4(second.outputPath);
  assert.deepEqual(secondMetadata, firstMetadata);

  const frames = fixture.checkpoints.map(({ frame }) => frame);
  const remotionStills = new Map<number, string>();
  for (const frame of frames) {
    const output = path.join(directory, `remotion-${frame}.png`);
    await executor.renderProofStill(request, frame, output);
    remotionStills.set(frame, output);
  }

  webServer = startPreviewServer();
  await waitForServer("http://127.0.0.1:3110", webServer);
  const browserComparisons = await capturePreviewComparisons(
    frames,
    remotionStills,
  );
  const encodedComparisons = frames.map((frame) => {
    const encoded = path.join(directory, `encoded-${frame}.png`);
    extractEncodedFrame(first.outputPath, frame, encoded);
    return comparePngs(remotionStills.get(frame)!, encoded, {
      label: `encoded MP4 frame ${frame}`,
      maximumMismatchRatio: 0.03,
      threshold: 0.2,
    });
  });

  console.log(
    JSON.stringify({
      component: `${request.componentId}@${request.version}`,
      dimensions: request.dimensions,
      durationInFrames: request.durationInFrames,
      fps: request.fps,
      firstSizeBytes: first.sizeBytes,
      secondSizeBytes: second.sizeBytes,
      visualFingerprint: first.visualFingerprint,
      browserComparisons,
      encodedComparisons,
      videoMetadata: firstMetadata,
      result: "passed",
    }),
  );
} finally {
  if (webServer && webServer.exitCode === null) webServer.kill("SIGTERM");
  await rm(directory, { force: true, recursive: true });
}

async function render(
  executor: RemotionDraftRenderExecutor,
  outputPath: string,
) {
  return executor.execute(request, outputPath, {
    signal: new AbortController().signal,
    onProgress: () => undefined,
  });
}

async function assertPlayableMp4(outputPath: string) {
  const content = await readFile(outputPath);
  assert.ok(content.byteLength > 1_000, "Draft MP4 must not be empty.");
  assert.equal(content.subarray(4, 8).toString("ascii"), "ftyp");
  const metadata = await getVideoMetadata(outputPath, { logLevel: "warn" });
  const proof = {
    codec: metadata.codec,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    canPlayInVideoTag: metadata.canPlayInVideoTag,
  };
  assert.deepEqual(proof, {
    codec: "h264",
    width: 960,
    height: 540,
    fps: 30,
    canPlayInVideoTag: true,
  });
  return proof;
}

function startPreviewServer(): ChildProcess {
  return spawn(
    process.execPath,
    [
      path.join(projectRoot, "node_modules/next/dist/bin/next"),
      "start",
      path.join(projectRoot, "apps/web"),
      "--hostname",
      "127.0.0.1",
      "--port",
      "3110",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, RELAY_WORKER_URL: "http://127.0.0.1:1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(
        `Preview server exited with code ${server.exitCode}; port 3110 may already be in use.`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (server.exitCode !== null) {
          throw new Error(
            `Preview server exited with code ${server.exitCode}; refusing to reuse another process on port 3110.`,
          );
        }
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("refusing")) {
        throw error;
      }
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Preview server did not become ready at ${url}.`);
}

async function capturePreviewComparisons(
  frames: readonly number[],
  remotionStills: ReadonlyMap<number, string>,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 1600, height: 1000 },
    });
    await page.goto(
      "http://127.0.0.1:3110/components/animated-line-chart/versions/1.0.0/preview",
    );
    await page.locator("#dimensions").selectOption("960x540");
    const stage = page.getByTestId("preview-stage");
    await stage.waitFor();
    await page.waitForFunction(
      "document.querySelector('[data-testid=preview-stage]')?.getAttribute('data-width') === '960'",
    );
    const comparisons = [];
    for (const frame of frames) {
      await page.locator("#frame-scrubber").fill(String(frame));
      await page
        .getByTestId("frame-output")
        .filter({ hasText: `Frame ${frame} /` })
        .waitFor();
      await stage.evaluate((element) => {
        const target = element as unknown as {
          readonly style: {
            setProperty(name: string, value: string, priority: string): void;
          };
        };
        target.style.setProperty(
          "transform",
          "translate(-50%, -50%) scale(1)",
          "important",
        );
      });
      const preview = path.join(directory, `preview-${frame}.png`);
      await stage.screenshot({ animations: "disabled", path: preview });
      comparisons.push(
        comparePngs(remotionStills.get(frame)!, preview, {
          label: `browser preview frame ${frame}`,
          maximumMismatchRatio: 0.002,
          threshold: 0.1,
        }),
      );
    }
    return comparisons;
  } finally {
    await browser.close();
  }
}

function extractEncodedFrame(
  videoPath: string,
  frame: number,
  outputPath: string,
): void {
  const result = spawnSync(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-y",
      "-i",
      videoPath,
      "-vf",
      `select=eq(n\\,${frame})`,
      "-frames:v",
      "1",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Could not decode MP4 frame ${frame}: ${result.stderr}`);
  }
}

function comparePngs(
  expectedPath: string,
  actualPath: string,
  options: {
    readonly label: string;
    readonly maximumMismatchRatio: number;
    readonly threshold: number;
  },
) {
  const expected = PNG.sync.read(readFileSync(expectedPath));
  const actual = PNG.sync.read(readFileSync(actualPath));
  assert.equal(
    actual.width,
    expected.width,
    `${options.label} width mismatch.`,
  );
  assert.equal(
    actual.height,
    expected.height,
    `${options.label} height mismatch.`,
  );
  const mismatchedPixels = pixelmatch(
    expected.data,
    actual.data,
    undefined,
    expected.width,
    expected.height,
    { threshold: options.threshold },
  );
  const mismatchRatio = mismatchedPixels / (expected.width * expected.height);
  assert.ok(
    mismatchRatio <= options.maximumMismatchRatio,
    `${options.label} mismatch ${mismatchRatio} exceeded ${options.maximumMismatchRatio}.`,
  );
  return { frame: Number(options.label.match(/\d+$/)?.[0]), mismatchRatio };
}
