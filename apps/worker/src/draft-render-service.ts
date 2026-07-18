import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  resolveVideoComponentDuration,
  validateVideoComponentInput,
} from "@relay/component-sdk";
import { lineChart } from "@relay/reference-components";

import {
  draftRenderRequestSchema,
  type DraftRenderExecutionResult,
  type DraftRenderExecutor,
  type DraftRenderSnapshot,
  type PinnedDraftRenderRequest,
} from "./draft-render-contract.js";

const MAX_DRAFT_PIXELS = 1280 * 720;

type InternalJob = {
  snapshot: DraftRenderSnapshot;
  readonly request: PinnedDraftRenderRequest;
  readonly outputPath: string;
  readonly controller: AbortController;
};

export class DraftRenderRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DraftRenderRequestError";
  }
}

export class DraftRenderService {
  readonly #jobs = new Map<string, InternalJob>();

  constructor(
    private readonly executor: DraftRenderExecutor,
    private readonly outputRoot: string,
  ) {}

  async create(candidate: unknown): Promise<DraftRenderSnapshot> {
    const request = validateAndPinRequest(candidate);
    const id = randomUUID();
    const outputPath = path.join(this.outputRoot, `${id}.mp4`);
    const createdAt = new Date().toISOString();
    const snapshot: DraftRenderSnapshot = {
      id,
      state: "queued",
      progress: 0,
      createdAt,
      component: {
        id: request.componentId,
        version: request.version,
        fixtureId: request.fixtureId,
      },
      settings: {
        fps: request.fps,
        durationInFrames: request.durationInFrames,
        dimensions: request.dimensions,
        quality: request.quality,
      },
      reproducibilityKey: hashJson(request),
    };
    const job: InternalJob = {
      snapshot,
      request,
      outputPath,
      controller: new AbortController(),
    };
    this.#jobs.set(id, job);
    queueMicrotask(() => void this.#run(job));
    return snapshot;
  }

  get(id: string): DraftRenderSnapshot {
    return this.#requireJob(id).snapshot;
  }

  cancel(id: string): DraftRenderSnapshot {
    const job = this.#requireJob(id);
    if (job.snapshot.state === "queued" || job.snapshot.state === "running") {
      job.controller.abort();
      job.snapshot = {
        ...job.snapshot,
        state: "canceled",
        finishedAt: new Date().toISOString(),
        error: {
          code: "render_canceled",
          message: "Draft render canceled by the creator.",
        },
      };
      void removeOutput(job.outputPath);
    }
    return job.snapshot;
  }

  async output(id: string): Promise<{ path: string; sizeBytes: number }> {
    const job = this.#requireJob(id);
    if (job.snapshot.state !== "succeeded" || !job.snapshot.output) {
      throw new DraftRenderRequestError(
        "output_unavailable",
        `Draft render ${id} has no successful output.`,
        409,
      );
    }
    const details = await stat(job.outputPath).catch(() => null);
    if (!details?.isFile() || details.size !== job.snapshot.output.sizeBytes) {
      throw new DraftRenderRequestError(
        "output_missing",
        "The draft render completed, but its stored output is unavailable.",
        410,
      );
    }
    return { path: job.outputPath, sizeBytes: details.size };
  }

  async #run(job: InternalJob): Promise<void> {
    if (job.controller.signal.aborted || job.snapshot.state !== "queued")
      return;
    job.snapshot = {
      ...job.snapshot,
      state: "running",
      startedAt: new Date().toISOString(),
      progress: 0,
    };

    try {
      await mkdir(this.outputRoot, { recursive: true });
      const result = await this.executor.execute(job.request, job.outputPath, {
        signal: job.controller.signal,
        onProgress: (progress) => {
          if (job.snapshot.state !== "running") return;
          job.snapshot = {
            ...job.snapshot,
            progress: clampProgress(progress),
          };
        },
      });
      if (job.controller.signal.aborted || job.snapshot.state !== "running") {
        await removeOutput(job.outputPath);
        return;
      }
      if (path.resolve(result.outputPath) !== path.resolve(job.outputPath)) {
        throw new Error("Render executor returned an unexpected output path.");
      }
      const outputDetails = await stat(job.outputPath);
      if (!outputDetails.isFile() || outputDetails.size !== result.sizeBytes) {
        throw new Error(
          "Render executor output size does not match the stored MP4.",
        );
      }
      job.snapshot = {
        ...job.snapshot,
        state: "succeeded",
        progress: 1,
        finishedAt: new Date().toISOString(),
        output: {
          href: `/draft-renders/${job.snapshot.id}/output`,
          mediaType: "video/mp4",
          sizeBytes: result.sizeBytes,
          contentHash: result.contentHash,
          visualFingerprint: result.visualFingerprint,
        },
      };
    } catch (error) {
      await removeOutput(job.outputPath);
      if (job.controller.signal.aborted || job.snapshot.state === "canceled") {
        if (job.snapshot.state !== "canceled") {
          job.snapshot = {
            ...job.snapshot,
            state: "canceled",
            finishedAt: new Date().toISOString(),
            error: {
              code: "render_canceled",
              message: "Draft render canceled by the creator.",
            },
          };
        }
        return;
      }
      const failure = creatorSafeFailure(error);
      console.error(
        `Draft render ${job.snapshot.id} failed [${failure.code}]: ${workerDiagnosticMessage(error)}`,
      );
      job.snapshot = {
        ...job.snapshot,
        state: "failed",
        finishedAt: new Date().toISOString(),
        error: failure,
      };
    }
  }

  #requireJob(id: string): InternalJob {
    const job = this.#jobs.get(id);
    if (!job) {
      throw new DraftRenderRequestError(
        "render_not_found",
        `Draft render ${id} was not found in this worker process.`,
        404,
      );
    }
    return job;
  }
}

export function validateAndPinRequest(
  candidate: unknown,
): PinnedDraftRenderRequest {
  const parsed = draftRenderRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue?.path.length ? issue.path.join(".") : "request";
    throw new DraftRenderRequestError(
      "request_invalid",
      `${location}: ${issue?.message ?? "Draft render request is invalid."}`,
      400,
    );
  }
  const request = parsed.data;
  if (
    request.componentId !== lineChart.id ||
    request.version !== lineChart.version
  ) {
    throw new DraftRenderRequestError(
      "component_version_unavailable",
      `Trusted component ${request.componentId}@${request.version} is not available to the worker.`,
      404,
    );
  }
  if (!lineChart.fixtures.some((fixture) => fixture.id === request.fixtureId)) {
    throw new DraftRenderRequestError(
      "fixture_unavailable",
      `Fixture ${request.fixtureId} does not belong to ${lineChart.id}@${lineChart.version}.`,
      400,
    );
  }
  const input = validateVideoComponentInput(lineChart.schema, request.input);
  if (!input.success) {
    const issue = input.issues[0];
    throw new DraftRenderRequestError(
      "input_invalid",
      `${issue?.path.join(".") || "input"}: ${issue?.message ?? "Component input is invalid."}`,
      400,
    );
  }
  const durationInFrames = resolveVideoComponentDuration(
    lineChart,
    input.value,
  );
  if (request.fps !== lineChart.fps) {
    throw new DraftRenderRequestError(
      "fps_mismatch",
      `Requested ${request.fps} fps does not match pinned component fps ${lineChart.fps}.`,
      400,
    );
  }
  if (request.durationInFrames !== durationInFrames) {
    throw new DraftRenderRequestError(
      "duration_mismatch",
      `Requested duration ${request.durationInFrames} does not match validated duration ${durationInFrames}.`,
      400,
    );
  }
  const dimensionsSupported = lineChart.supportedDimensions.some(
    ({ width, height }) =>
      width === request.dimensions.width &&
      height === request.dimensions.height,
  );
  if (!dimensionsSupported) {
    throw new DraftRenderRequestError(
      "dimensions_unsupported",
      `Dimensions ${request.dimensions.width}x${request.dimensions.height} are not supported by the pinned component.`,
      400,
    );
  }
  if (request.dimensions.width * request.dimensions.height > MAX_DRAFT_PIXELS) {
    throw new DraftRenderRequestError(
      "draft_dimensions_too_large",
      "Draft renders are limited to 1280x720 pixels.",
      400,
    );
  }
  return {
    ...request,
    input: input.value,
  } as PinnedDraftRenderRequest;
}

export function createFakeDraftRenderExecutor(
  delayMilliseconds = 25,
): DraftRenderExecutor {
  return {
    async execute(request, outputPath, hooks) {
      for (const progress of [0.2, 0.6, 1]) {
        await abortableDelay(delayMilliseconds, hooks.signal);
        hooks.onProgress(progress);
      }
      const bytes = Buffer.from(
        `fake-mp4:${hashJson(request)}:${request.durationInFrames}`,
      );
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);
      return resultForBytes(outputPath, bytes, `fake:${hashJson(request)}`);
    },
  };
}

async function resultForBytes(
  outputPath: string,
  bytes?: Buffer,
  visualFingerprint?: string,
): Promise<DraftRenderExecutionResult> {
  const content = bytes ?? (await readFile(outputPath));
  return {
    outputPath,
    sizeBytes: content.byteLength,
    contentHash: createHash("sha256").update(content).digest("hex"),
    visualFingerprint:
      visualFingerprint ?? createHash("sha256").update(content).digest("hex"),
  };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function removeOutput(outputPath: string): Promise<void> {
  await rm(outputPath, { force: true }).catch(() => undefined);
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(0.999, Math.max(0, progress)) : 0;
}

function creatorSafeFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : undefined;
  if (code && /^(?:EACCES|EDQUOT|EEXIST|ENOSPC|ENOTDIR|EROFS)$/.test(code)) {
    return {
      code: "output_storage_failed",
      message:
        "The worker could not store the draft output. Check worker storage and try again.",
    };
  }
  return {
    code: "render_failed",
    message:
      "The video renderer failed. Retry the draft or review the worker diagnostics.",
  };
}

function workerDiagnosticMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(process.cwd(), "[worker]")
    .replaceAll(os.homedir(), "[home]")
    .replace(
      /\b(api[-_]?key|authorization|password|secret|token)\b\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .slice(0, 2000);
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Render canceled."));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Render canceled."));
      },
      { once: true },
    );
  });
}
