import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { projectDraftFramePlan } from "@relay/rendering";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { chromium, type Page } from "playwright";

const api = anyApi.projectDraftRenders!;

type MaterializedSegment =
  | {
      id: string;
      kind: "component";
      componentVersionId: string;
      componentId: string;
      componentVersion: string;
      input: unknown;
      anchor: { startMs: number; endMs: number };
    }
  | {
      id: string;
      kind: "media";
      sourceId: string;
      sourceUrl: string;
      mediaType: string;
      fit: "cover" | "contain";
      anchor: { startMs: number; endMs: number };
    };

type ClaimedProjectRender = {
  _id: string;
  attempt: number;
  rangeStartMs: number;
  rangeEndMs: number;
  width: number;
  height: number;
  fps: number;
  narrationUrl: string;
  composition: {
    segments: MaterializedSegment[];
  };
};

type RenderResult = {
  outputPath: string;
  sizeBytes: number;
  contentHash: string;
  visualFingerprint: string;
};

export interface ProjectRenderExecutor {
  execute(
    job: ClaimedProjectRender,
    hooks: { signal: AbortSignal; onProgress: (progress: number) => void },
  ): Promise<RenderResult>;
}

export class ProjectRenderLoop {
  readonly #client: ConvexHttpClient;
  readonly #workerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;
  #timer: NodeJS.Timeout | undefined;
  #busy = false;
  #status: "running" | "degraded" | "stopped" = "stopped";

  constructor(
    url: string,
    private readonly workerToken: string,
    private readonly executor: ProjectRenderExecutor,
    private readonly leaseMs = 30_000,
    private readonly pollMs = 500,
  ) {
    this.#client = new ConvexHttpClient(url);
  }

  get status() {
    return this.#status;
  }

  start() {
    if (this.#timer) return;
    this.#status = "running";
    this.#timer = setInterval(() => this.#tickSafely(), this.pollMs);
    this.#tickSafely();
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#status = "stopped";
  }

  async tick(): Promise<boolean> {
    if (this.#busy) return false;
    this.#busy = true;
    try {
      await this.#client.mutation(api.recoverExpired!, {
        workerToken: this.workerToken,
      });
      const job = (await this.#client.mutation(api.claim!, {
        workerToken: this.workerToken,
        workerId: this.#workerId,
        leaseMs: this.leaseMs,
      })) as ClaimedProjectRender | null;
      if (!job) return false;
      await this.#run(job);
      return true;
    } finally {
      this.#busy = false;
    }
  }

  #tickSafely() {
    void this.tick()
      .then(() => {
        if (this.#status !== "stopped") this.#status = "running";
      })
      .catch((error) => {
        if (this.#status !== "stopped") this.#status = "degraded";
        console.error(`Project render loop degraded safely: ${message(error)}`);
      });
  }

  async #run(job: ClaimedProjectRender) {
    const startedAt = Date.now();
    const controller = new AbortController();
    let progress = 0;
    const lease = {
      workerToken: this.workerToken,
      jobId: job._id,
      workerId: this.#workerId,
      leaseAttempt: job.attempt,
    };
    const heartbeat = async () => {
      const state = (await this.#client.mutation(api.heartbeat!, {
        ...lease,
        leaseMs: this.leaseMs,
        progress,
      })) as { owned: boolean; cancelRequested: boolean };
      if (!state.owned || state.cancelRequested) controller.abort();
    };
    const timer = setInterval(
      () => {
        void heartbeat().catch(() => controller.abort());
      },
      Math.min(1_000, Math.max(250, Math.floor(this.leaseMs / 3))),
    );
    let outputPath: string | undefined;
    try {
      const result = await this.executor.execute(job, {
        signal: controller.signal,
        onProgress: (value) => {
          progress = Math.min(0.99, Math.max(progress, value));
        },
      });
      outputPath = result.outputPath;
      await heartbeat();
      if (controller.signal.aborted) throw new RenderCanceledError();
      const bytes = await readFile(result.outputPath);
      const uploadUrl = (await this.#client.mutation(
        api.createUploadUrl!,
        lease,
      )) as string;
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: { "content-type": "video/mp4" },
        body: new Uint8Array(bytes),
      });
      if (!upload.ok) {
        throw new Error(`MP4 upload failed with status ${upload.status}.`);
      }
      const body = (await upload.json()) as { storageId?: string };
      if (!body.storageId)
        throw new Error("MP4 upload returned no storage id.");
      await this.#client.mutation(api.complete!, {
        ...lease,
        storageId: body.storageId,
        sizeBytes: result.sizeBytes,
        contentHash: result.contentHash,
        visualFingerprint: result.visualFingerprint,
        wallTimeMs: Date.now() - startedAt,
      });
    } catch (error) {
      const canceled =
        controller.signal.aborted || error instanceof RenderCanceledError;
      await this.#client
        .mutation(api.fail!, {
          ...lease,
          state: canceled ? "canceled" : "failed",
          code: canceled ? "render_canceled" : "render_failed",
          message: canceled
            ? "Draft render canceled by the creator."
            : "Draft rendering failed safely and can be retried.",
        })
        .catch(() => undefined);
      if (!canceled) {
        console.error(`Project render ${job._id} failed: ${message(error)}`);
      }
    } finally {
      clearInterval(timer);
      if (outputPath) {
        await rm(path.dirname(outputPath), {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    }
  }
}

export class BrowserProjectRenderExecutor implements ProjectRenderExecutor {
  constructor(
    private readonly previewOrigin: string,
    private readonly temporaryRoot = path.join(
      os.homedir(),
      ".cache",
      "ai-tmp",
      "relay-project-renders",
    ),
  ) {}

  async execute(
    job: ClaimedProjectRender,
    hooks: { signal: AbortSignal; onProgress: (progress: number) => void },
  ): Promise<RenderResult> {
    await mkdir(this.temporaryRoot, { recursive: true });
    const workspace = await mkdtemp(
      path.join(this.temporaryRoot, "project-render-"),
    );
    const outputPath = path.join(workspace, "draft.mp4");
    const audioPath = path.join(workspace, "narration");
    const plan = projectDraftFramePlan(job.composition.segments, job.fps, {
      startMs: job.rangeStartMs,
      endMs: job.rangeEndMs,
    });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: job.width, height: job.height },
    });
    const fingerprint = createHash("sha256");
    let activeSegmentId = "";
    try {
      for (
        let outputFrame = 0;
        outputFrame < plan.durationInFrames;
        outputFrame++
      ) {
        throwIfAborted(hooks.signal);
        const frame = plan.frame(outputFrame);
        const segment = frame.segment as MaterializedSegment | undefined;
        if (segment?.id !== activeSegmentId) {
          activeSegmentId = segment?.id ?? "";
          await openSegment(
            page,
            segment,
            frame.segmentFrame ?? 0,
            this.previewOrigin,
          );
        } else if (segment?.kind === "component") {
          await page.evaluate((componentFrame) => {
            const browser = globalThis as unknown as {
              postMessage: (message: unknown, targetOrigin: string) => void;
            };
            browser.postMessage(
              { type: "relay-preview-frame-v1", frame: componentFrame },
              "*",
            );
          }, frame.segmentFrame ?? 0);
          await page.evaluate(() => {
            const browser = globalThis as unknown as {
              requestAnimationFrame: (callback: () => void) => number;
            };
            return new Promise<void>((resolve) =>
              browser.requestAnimationFrame(() => resolve()),
            );
          });
        }
        const framePath = path.join(
          workspace,
          `frame-${String(outputFrame).padStart(6, "0")}.png`,
        );
        await page.screenshot({ path: framePath, type: "png" });
        if (
          outputFrame === 0 ||
          outputFrame === Math.floor(plan.durationInFrames / 2) ||
          outputFrame === plan.durationInFrames - 1
        ) {
          fingerprint.update(String(frame.compositionFrame));
          fingerprint.update(await readFile(framePath));
        }
        hooks.onProgress(((outputFrame + 1) / plan.durationInFrames) * 0.75);
      }
      throwIfAborted(hooks.signal);
      const narration = await fetch(job.narrationUrl);
      if (!narration.ok) {
        throw new Error(`Narration download failed with ${narration.status}.`);
      }
      await writeFile(audioPath, Buffer.from(await narration.arrayBuffer()));
      hooks.onProgress(0.8);
      await encodeMp4(job, workspace, audioPath, outputPath, hooks.signal);
      hooks.onProgress(0.98);
      const bytes = await readFile(outputPath);
      return {
        outputPath,
        sizeBytes: bytes.byteLength,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        visualFingerprint: fingerprint.digest("hex"),
      };
    } catch (error) {
      await rm(workspace, { recursive: true, force: true });
      throw error;
    } finally {
      await browser.close();
    }
  }
}

export function createFakeProjectRenderExecutor(
  delayMs = 10,
): ProjectRenderExecutor {
  return {
    async execute(job, hooks) {
      const temporaryRoot = path.join(os.homedir(), ".cache", "ai-tmp");
      await mkdir(temporaryRoot, { recursive: true });
      const root = await mkdtemp(
        path.join(temporaryRoot, "relay-fake-render-"),
      );
      const outputPath = path.join(root, "draft.mp4");
      for (const progress of [0.2, 0.6, 0.98]) {
        await delay(delayMs, hooks.signal);
        hooks.onProgress(progress);
      }
      const bytes = Buffer.from(
        `fake-project-mp4:${job._id}:${job.rangeStartMs}`,
      );
      await writeFile(outputPath, bytes);
      const hash = createHash("sha256").update(bytes).digest("hex");
      return {
        outputPath,
        sizeBytes: bytes.byteLength,
        contentHash: hash,
        visualFingerprint: hash,
      };
    },
  };
}

async function openSegment(
  page: Page,
  segment: MaterializedSegment | undefined,
  frame: number,
  previewOrigin: string,
) {
  if (!segment) {
    await page.setContent(
      "<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:#07111f}</style>",
    );
    return;
  }
  if (segment.kind === "component") {
    const input = Buffer.from(JSON.stringify(segment.input)).toString(
      "base64url",
    );
    const url = `${previewOrigin}/component-loop/versions/${encodeURIComponent(segment.componentVersionId)}/preview?frame=${frame}&input=${input}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    return;
  }
  const fit = segment.fit === "cover" ? "cover" : "contain";
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:#07111f}img{width:100%;height:100%;object-fit:${fit}}</style><img alt="" src="${html(segment.sourceUrl)}">`,
    { waitUntil: "networkidle" },
  );
}

async function encodeMp4(
  job: ClaimedProjectRender,
  workspace: string,
  audioPath: string,
  outputPath: string,
  signal: AbortSignal,
) {
  const durationSeconds = (job.rangeEndMs - job.rangeStartMs) / 1_000;
  const child = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-framerate",
      String(job.fps),
      "-i",
      path.join(workspace, "frame-%06d.png"),
      "-ss",
      (job.rangeStartMs / 1_000).toFixed(6),
      "-i",
      audioPath,
      "-t",
      durationSeconds.toFixed(6),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-shortest",
      "-y",
      outputPath,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const chunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    if (chunks.reduce((sum, item) => sum + item.length, 0) < 16_384)
      chunks.push(chunk);
  });
  const abort = () => child.kill("SIGTERM");
  signal.addEventListener("abort", abort, { once: true });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  signal.removeEventListener("abort", abort);
  if (signal.aborted) throw new RenderCanceledError();
  if (code !== 0) {
    throw new Error(
      `FFmpeg exited with code ${code ?? "unknown"}: ${Buffer.concat(chunks).toString("utf8")}`,
    );
  }
}

class RenderCanceledError extends Error {}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new RenderCanceledError();
}

function html(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new RenderCanceledError());
      },
      { once: true },
    );
  });
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
