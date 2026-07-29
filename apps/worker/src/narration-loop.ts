import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const api = anyApi.projectNarrations!;
const SAMPLE_RATE = 16_000;
const MAX_DURATION_MS = 120_000;

type NarrationJob = {
  _id: string;
  kind?: "generated" | "upload";
  scriptContent?: string;
  sourceUrl?: string;
  sourceMediaType?: string;
  attempt: number;
  cancelRequested: boolean;
};

export type NarrationLoopStatus = "running" | "degraded" | "stopped";

export class NarrationLoop {
  readonly #client: ConvexHttpClient;
  readonly #workerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;
  #busy = false;
  #draining = false;
  #wakeRequested = false;
  #retryTimer: NodeJS.Timeout | undefined;
  #status: NarrationLoopStatus = "stopped";

  constructor(
    url: string,
    private readonly workerToken: string,
    private readonly leaseMs = 30_000,
  ) {
    this.#client = new ConvexHttpClient(url);
  }

  get status(): NarrationLoopStatus {
    return this.#status;
  }

  start(): void {
    if (this.#status !== "stopped") return;
    this.#status = "running";
  }

  stop(): void {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#wakeRequested = false;
    this.#status = "stopped";
  }

  wake(): void {
    if (this.#status === "stopped") return;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#wakeRequested = true;
    if (!this.#draining) void this.#drainSafely();
  }

  async tick(): Promise<boolean> {
    if (this.#busy) return false;
    this.#busy = true;
    try {
      const job = (await this.#client.mutation(api.claim!, {
        workerToken: this.workerToken,
        workerId: this.#workerId,
        leaseMs: this.leaseMs,
      })) as NarrationJob | null;
      if (!job) return false;
      await this.#run(job);
      return true;
    } finally {
      this.#busy = false;
    }
  }

  async #drainSafely(): Promise<void> {
    this.#draining = true;
    try {
      do {
        this.#wakeRequested = false;
        while (this.#status !== "stopped" && (await this.tick())) {
          // Drain every queued narration job before waiting again.
        }
      } while (this.#status !== "stopped" && this.#wakeRequested);
      if (this.#status !== "stopped") this.#status = "running";
    } catch (error) {
      if (this.#status !== "stopped") this.#status = "degraded";
      console.error(
        `Narration control loop degraded safely: ${safeMessage(error)}`,
      );
      this.#scheduleRetry();
    } finally {
      this.#draining = false;
      if (this.#status !== "stopped" && this.#wakeRequested) this.wake();
    }
  }

  #scheduleRetry(): void {
    if (this.#status === "stopped" || this.#retryTimer) return;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.wake();
    }, 1_000);
  }

  async #run(job: NarrationJob): Promise<void> {
    const startedAt = Date.now();
    const lease = {
      workerToken: this.workerToken,
      jobId: job._id,
      workerId: this.#workerId,
      leaseAttempt: job.attempt,
    };
    try {
      if (job.cancelRequested) {
        await this.#fail(
          lease,
          "canceled",
          "narration_canceled",
          "Narration generation canceled.",
        );
        return;
      }
      if (job.kind === "upload") {
        await this.#probeUpload(job, lease, startedAt);
        return;
      }
      if (!job.scriptContent) {
        throw new Error("Generated narration job has no script content.");
      }
      const generated = generateDeterministicNarration(job.scriptContent);
      const current = (await this.#client.query(api.getForWorker!, {
        workerToken: this.workerToken,
        jobId: job._id,
      })) as { cancelRequested?: boolean } | null;
      if (!current || current.cancelRequested) {
        await this.#fail(
          lease,
          "canceled",
          "narration_canceled",
          "Narration generation canceled.",
        );
        return;
      }
      const uploadUrl = (await this.#client.mutation(
        api.createUploadUrl!,
        lease,
      )) as string;
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: new Uint8Array(generated.audio),
      });
      if (!upload.ok)
        throw new Error(`Audio upload failed with status ${upload.status}.`);
      const body = (await upload.json()) as { storageId?: string };
      if (!body.storageId)
        throw new Error("Audio upload returned no storage id.");
      await this.#client.mutation(api.complete!, {
        ...lease,
        storageId: body.storageId,
        durationMs: generated.durationMs,
        timingSegments: generated.timingSegments,
        usageCharacters: job.scriptContent.length,
        estimatedCostUsd: 0,
        wallTimeMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.#fail(
        lease,
        "failed",
        "narration_generation_failed",
        "Narration generation failed safely and can be retried.",
      ).catch(() => undefined);
      console.error(
        `Narration job ${job._id} failed safely: ${safeMessage(error)}`,
      );
    }
  }

  async #probeUpload(
    job: NarrationJob,
    lease: {
      workerToken: string;
      jobId: string;
      workerId: string;
      leaseAttempt: number;
    },
    startedAt: number,
  ): Promise<void> {
    if (!job.sourceUrl || !job.sourceMediaType) {
      throw new Error("Uploaded narration job has no source audio.");
    }
    const response = await fetch(job.sourceUrl);
    if (!response.ok) {
      throw new Error(
        `Narration download failed with status ${response.status}.`,
      );
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length > 100 * 1024 * 1024) {
      throw new Error("Narration upload exceeds the worker probe limit.");
    }
    const metadata = await probeAudio(audio);
    const current = (await this.#client.query(api.getForWorker!, {
      workerToken: this.workerToken,
      jobId: job._id,
    })) as { cancelRequested?: boolean } | null;
    if (!current || current.cancelRequested) {
      await this.#fail(
        lease,
        "canceled",
        "narration_canceled",
        "Narration upload probing canceled.",
      );
      return;
    }
    await this.#client.mutation(api.completeUpload!, {
      ...lease,
      durationMs: metadata.durationMs,
      mediaType: job.sourceMediaType,
      audioCodec: metadata.audioCodec,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
      wallTimeMs: Date.now() - startedAt,
    });
  }

  #fail(
    lease: {
      workerToken: string;
      jobId: string;
      workerId: string;
      leaseAttempt: number;
    },
    state: "failed" | "canceled" | "needs_intervention",
    code: string,
    message: string,
  ) {
    return this.#client.mutation(api.fail!, {
      ...lease,
      state,
      code,
      message,
    });
  }
}

export function generateDeterministicNarration(content: string): {
  audio: Buffer;
  durationMs: number;
  timingSegments: Array<{
    index: number;
    startMs: number;
    endMs: number;
    text: string;
  }>;
} {
  const segments = splitSegments(content);
  const rawDurations = segments.map((text) =>
    Math.max(600, Math.min(4_000, text.split(/\s+/).length * 280)),
  );
  const rawTotal = rawDurations.reduce((sum, value) => sum + value, 0);
  const scale = Math.min(1, MAX_DURATION_MS / rawTotal);
  let cursor = 0;
  const timingSegments = segments.map((text, index) => {
    const duration = Math.max(250, Math.round(rawDurations[index]! * scale));
    const segment = { index, startMs: cursor, endMs: cursor + duration, text };
    cursor += duration;
    return segment;
  });
  const durationMs = cursor;
  return {
    audio: wavTone(durationMs, content),
    durationMs,
    timingSegments,
  };
}

export async function probeAudio(audio: Buffer): Promise<{
  durationMs: number;
  audioCodec: string;
  sampleRate: number;
  channels: number;
}> {
  const root = path.resolve(
    process.env.RELAY_NARRATION_TMPDIR ?? ".relay/narration-probes",
  );
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "probe-"));
  const input = path.join(directory, "narration-audio");
  try {
    await writeFile(input, audio, { flag: "wx" });
    return await probeAudioFile(input);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function probeAudioFile(input: string): Promise<{
  durationMs: number;
  audioCodec: string;
  sampleRate: number;
  channels: number;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_name,sample_rate,channels,duration",
        "-of",
        "json",
        input,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `FFprobe rejected narration audio: ${Buffer.concat(stderr)
              .toString("utf8")
              .slice(0, 400)}`,
          ),
        );
        return;
      }
      try {
        const result = JSON.parse(Buffer.concat(stdout).toString("utf8")) as {
          format?: { duration?: string };
          streams?: Array<{
            codec_name?: string;
            sample_rate?: string;
            channels?: number;
            duration?: string;
          }>;
        };
        const stream = result.streams?.find(
          (candidate) => candidate.codec_name && candidate.sample_rate,
        );
        const durationMs = Math.round(
          Number.parseFloat(result.format?.duration ?? stream?.duration ?? "") *
            1_000,
        );
        const sampleRate = Number.parseInt(stream?.sample_rate ?? "", 10);
        const channels = stream?.channels ?? 0;
        if (
          !Number.isSafeInteger(durationMs) ||
          durationMs < 100 ||
          !stream?.codec_name ||
          !Number.isSafeInteger(sampleRate) ||
          sampleRate < 1 ||
          !Number.isSafeInteger(channels) ||
          channels < 1
        ) {
          throw new Error("FFprobe returned incomplete narration metadata.");
        }
        resolve({
          durationMs,
          audioCodec: stream.codec_name,
          sampleRate,
          channels,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function splitSegments(content: string): string[] {
  const parts = content
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return [content.trim()];
  if (parts.length <= 200) return parts;
  const grouped: string[] = [];
  const size = Math.ceil(parts.length / 200);
  for (let index = 0; index < parts.length; index += size) {
    grouped.push(parts.slice(index, index + size).join(" "));
  }
  return grouped;
}

function wavTone(durationMs: number, seed: string): Buffer {
  const sampleCount = Math.max(
    1,
    Math.round((durationMs / 1_000) * SAMPLE_RATE),
  );
  const dataSize = sampleCount * 2;
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataSize, 40);
  const frequency = 180 + (hashSeed(seed) % 120);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const envelope = Math.min(1, sample / 400, (sampleCount - sample) / 400);
    const value =
      Math.sin((2 * Math.PI * frequency * sample) / SAMPLE_RATE) *
      1_400 *
      Math.max(0, envelope);
    output.writeInt16LE(Math.round(value), 44 + sample * 2);
  }
  return output;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(process.cwd(), "[worker]")
    .slice(0, 800);
}
