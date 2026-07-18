import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { lineChart } from "@relay/reference-components";

import type {
  DraftRenderExecutionHooks,
  DraftRenderExecutionResult,
  DraftRenderExecutor,
  PinnedDraftRenderRequest,
} from "./draft-render-contract.js";

const COMPOSITION_ID = "relay-component-draft";

export class RemotionDraftRenderExecutor implements DraftRenderExecutor {
  readonly #bundleCache = new RetryableAsyncValue<string>();

  async execute(
    request: PinnedDraftRenderRequest,
    outputPath: string,
    hooks: DraftRenderExecutionHooks,
  ): Promise<DraftRenderExecutionResult> {
    hooks.onProgress(0.01);
    const serveUrl = await this.#bundle((progress) =>
      hooks.onProgress(bundleProgress(progress)),
    );
    throwIfAborted(hooks.signal);

    const inputProps = { ...request };
    const composition = await selectComposition({
      id: COMPOSITION_ID,
      inputProps,
      logLevel: "warn",
      serveUrl,
    });
    assertCompositionMatchesRequest(composition, request);
    throwIfAborted(hooks.signal);

    await mkdir(path.dirname(outputPath), { recursive: true });
    const cancellation = makeCancelSignal();
    const cancel = () => cancellation.cancel();
    hooks.signal.addEventListener("abort", cancel, { once: true });
    try {
      await renderMedia({
        ...safeRenderResourcePolicy(),
        cancelSignal: cancellation.cancelSignal,
        codec: request.quality.codec,
        composition,
        crf: request.quality.crf,
        inputProps,
        logLevel: "warn",
        outputLocation: outputPath,
        overwrite: true,
        pixelFormat: request.quality.pixelFormat,
        serveUrl,
        onProgress: ({ progress }) => hooks.onProgress(0.15 + progress * 0.72),
      });

      throwIfAborted(hooks.signal);
      const visualFingerprint = await renderCheckpointFingerprint({
        cancelSignal: cancellation.cancelSignal,
        composition,
        fixtureId: request.fixtureId,
        inputProps,
        onProgress: hooks.onProgress,
        outputPath,
        serveUrl,
      });
      const content = await readFile(outputPath);
      return {
        outputPath,
        sizeBytes: content.byteLength,
        contentHash: createHash("sha256").update(content).digest("hex"),
        visualFingerprint,
      };
    } finally {
      hooks.signal.removeEventListener("abort", cancel);
    }
  }

  async renderProofStill(
    request: PinnedDraftRenderRequest,
    frame: number,
    outputPath: string,
  ): Promise<void> {
    const serveUrl = await this.#bundle(() => undefined);
    const inputProps = { ...request };
    const composition = await selectComposition({
      id: COMPOSITION_ID,
      inputProps,
      logLevel: "warn",
      serveUrl,
    });
    assertCompositionMatchesRequest(composition, request);
    await renderStill({
      composition,
      frame,
      imageFormat: "png",
      inputProps,
      logLevel: "warn",
      output: outputPath,
      overwrite: true,
      serveUrl,
    });
  }

  #bundle(onProgress: (progress: number) => void): Promise<string> {
    return this.#bundleCache.get(() =>
      bundle({
        entryPoint: resolveRemotionEntryPoint(import.meta.url),
        onProgress,
      }),
    );
  }
}

export function safeRenderResourcePolicy(): {
  readonly concurrency: 1;
  readonly disallowParallelEncoding: true;
  readonly offthreadVideoThreads: 1;
  readonly x264Preset: "veryfast";
} {
  return {
    concurrency: 1,
    disallowParallelEncoding: true,
    offthreadVideoThreads: 1,
    x264Preset: "veryfast",
  };
}

export function bundleProgress(percentage: number): number {
  return Math.min(0.15, Math.max(0, percentage / 100) * 0.15);
}

export function resolveRemotionEntryPoint(moduleUrl: string): string {
  const sourceEntry = fileURLToPath(new URL("./remotion-entry.tsx", moduleUrl));
  if (existsSync(sourceEntry)) return sourceEntry;

  const builtEntry = fileURLToPath(new URL("./remotion-entry.js", moduleUrl));
  if (existsSync(builtEntry)) return builtEntry;

  throw new Error("The Remotion draft entry point is unavailable.");
}

export class RetryableAsyncValue<Value> {
  #pending: Promise<Value> | undefined;

  get(factory: () => Promise<Value>): Promise<Value> {
    if (this.#pending) return this.#pending;
    const pending = factory();
    this.#pending = pending;
    void pending.catch(() => {
      if (this.#pending === pending) this.#pending = undefined;
    });
    return pending;
  }
}

async function renderCheckpointFingerprint({
  cancelSignal,
  composition,
  fixtureId,
  inputProps,
  onProgress,
  outputPath,
  serveUrl,
}: {
  readonly cancelSignal: ReturnType<typeof makeCancelSignal>["cancelSignal"];
  readonly composition: Awaited<ReturnType<typeof selectComposition>>;
  readonly fixtureId: string;
  readonly inputProps: Record<string, unknown>;
  readonly onProgress: (progress: number) => void;
  readonly outputPath: string;
  readonly serveUrl: string;
}): Promise<string> {
  const fixture = lineChart.fixtures.find(({ id }) => id === fixtureId);
  if (!fixture) throw new Error(`Pinned fixture ${fixtureId} is unavailable.`);
  const frames = [...new Set(fixture.checkpoints.map(({ frame }) => frame))];
  const directory = `${outputPath}.checkpoints`;
  await mkdir(directory, { recursive: true });
  const fingerprint = createHash("sha256");
  try {
    for (const [index, frame] of frames.entries()) {
      const stillPath = path.join(directory, `${frame}.png`);
      await renderStill({
        cancelSignal,
        composition,
        frame,
        imageFormat: "png",
        inputProps,
        logLevel: "warn",
        output: stillPath,
        overwrite: true,
        serveUrl,
      });
      fingerprint.update(String(frame));
      fingerprint.update(await readFile(stillPath));
      onProgress(0.87 + ((index + 1) / frames.length) * 0.12);
    }
    return fingerprint.digest("hex");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function assertCompositionMatchesRequest(
  composition: Awaited<ReturnType<typeof selectComposition>>,
  request: {
    readonly fps: number;
    readonly durationInFrames: number;
    readonly dimensions: { readonly width: number; readonly height: number };
  },
): void {
  if (
    composition.fps !== request.fps ||
    composition.durationInFrames !== request.durationInFrames ||
    composition.width !== request.dimensions.width ||
    composition.height !== request.dimensions.height
  ) {
    throw new Error(
      "Resolved Remotion composition metadata does not match the pinned render request.",
    );
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Render canceled.");
}
