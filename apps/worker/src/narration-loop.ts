import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const api = anyApi.projectNarrations!;

type NarrationCue = {
  index: number;
  text: string;
};

type NarrationJob = {
  _id: string;
  attempt: number;
  cancelRequested: boolean;
  sourceUrl: string;
  sourceFileName: string;
  sourceMediaType: string;
  plan: {
    _id: string;
    cues: NarrationCue[];
  };
};

export type TranscribedWord = {
  word: string;
  startMs: number;
  endMs: number;
};

export type TranscriptionResult = {
  provider: string;
  model: string;
  transcript: string;
  words: TranscribedWord[];
};

export interface NarrationAligner {
  transcribe(input: {
    audio: Buffer;
    fileName: string;
    mediaType: string;
    planText: string;
  }): Promise<TranscriptionResult>;
}

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
    private readonly aligner: NarrationAligner,
    private readonly leaseMs = 120_000,
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
          // Drain every queued alignment before waiting again.
        }
      } while (this.#status !== "stopped" && this.#wakeRequested);
      if (this.#status !== "stopped") this.#status = "running";
    } catch (error) {
      if (this.#status !== "stopped") this.#status = "degraded";
      console.error(
        `Narration alignment loop degraded safely: ${safeMessage(error)}`,
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
    const heartbeatTimer = setInterval(
      () => {
        void this.#client
          .mutation(api.heartbeat!, {
            ...lease,
            leaseMs: this.leaseMs,
          })
          .catch((error) => {
            console.error(
              `Narration job ${job._id} heartbeat failed: ${safeMessage(error)}`,
            );
          });
      },
      Math.max(5_000, Math.min(30_000, Math.floor(this.leaseMs / 3))),
    );
    try {
      if (job.cancelRequested) {
        await this.#fail(
          lease,
          "canceled",
          "narration_canceled",
          "Narration alignment canceled.",
        );
        return;
      }
      const response = await fetch(job.sourceUrl);
      if (!response.ok) {
        throw new Error(
          `Narration download failed with status ${response.status}.`,
        );
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length > 100 * 1024 * 1024) {
        throw new Error("Narration upload exceeds the worker limit.");
      }
      const [metadata, transcription] = await Promise.all([
        probeAudio(audio),
        this.aligner.transcribe({
          audio,
          fileName: job.sourceFileName,
          mediaType: job.sourceMediaType,
          planText: job.plan.cues.map((cue) => cue.text).join("\n\n"),
        }),
      ]);
      const aligned = alignTranscriptToPlan(job.plan.cues, transcription.words);
      const current = (await this.#client.query(api.getForWorker!, {
        workerToken: this.workerToken,
        jobId: job._id,
      })) as { cancelRequested?: boolean } | null;
      if (!current || current.cancelRequested) {
        await this.#fail(
          lease,
          "canceled",
          "narration_canceled",
          "Narration alignment canceled.",
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
        transcript: transcription.transcript,
        timingSegments: aligned.cueTimings,
        wordTimings: aligned.wordTimings,
        omittedWordCount: aligned.omittedWordCount,
        insertedWordCount: aligned.insertedWordCount,
        substitutedWordCount: aligned.substitutedWordCount,
        provider: transcription.provider,
        model: transcription.model,
        wallTimeMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.#fail(
        lease,
        "failed",
        "narration_alignment_failed",
        "Narration alignment failed safely and can be retried.",
      ).catch(() => undefined);
      console.error(
        `Narration job ${job._id} failed safely: ${safeMessage(error)}`,
      );
    } finally {
      clearInterval(heartbeatTimer);
    }
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

export class OpenAIWhisperAligner implements NarrationAligner {
  constructor(
    private readonly apiKey: string,
    private readonly model = "whisper-1",
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async transcribe(input: {
    audio: Buffer;
    fileName: string;
    mediaType: string;
    planText: string;
  }): Promise<TranscriptionResult> {
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(input.audio)], input.fileName, {
        type: input.mediaType,
      }),
    );
    form.set("model", this.model);
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      throw new Error(
        `Transcription failed with status ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    const result = (await response.json()) as {
      text?: string;
      words?: Array<{ word?: string; start?: number; end?: number }>;
    };
    const words = (result.words ?? []).map((word) => ({
      word: word.word?.trim() ?? "",
      startMs: Math.round((word.start ?? -1) * 1_000),
      endMs: Math.round((word.end ?? -1) * 1_000),
    }));
    if (
      !result.text?.trim() ||
      !words.length ||
      words.some(
        (word) => !word.word || word.startMs < 0 || word.endMs <= word.startMs,
      )
    ) {
      throw new Error("Transcription returned no valid word timing.");
    }
    return {
      provider: "openai",
      model: this.model,
      transcript: result.text.trim(),
      words,
    };
  }
}

export class DeterministicFakeAligner implements NarrationAligner {
  async transcribe(input: {
    audio: Buffer;
    fileName: string;
    mediaType: string;
    planText: string;
  }): Promise<TranscriptionResult> {
    const metadata = await probeAudio(input.audio);
    const words = tokenize(input.planText).map((word) => word.text);
    const duration = Math.max(1, metadata.durationMs);
    const step = duration / Math.max(1, words.length);
    return {
      provider: "relay-fake-alignment",
      model: "deterministic-word-timing-v1",
      transcript: words.join(" "),
      words: words.map((word, index) => ({
        word,
        startMs: Math.round(index * step),
        endMs: Math.max(
          Math.round(index * step) + 1,
          Math.round((index + 1) * step),
        ),
      })),
    };
  }
}

export function alignTranscriptToPlan(
  cues: NarrationCue[],
  transcriptWords: TranscribedWord[],
) {
  const planWords = cues.flatMap((cue) =>
    tokenize(cue.text).map((word) => ({
      ...word,
      cueIndex: cue.index,
    })),
  );
  let planCursor = 0;
  let omittedWordCount = 0;
  let insertedWordCount = 0;
  let substitutedWordCount = 0;
  const wordTimings = transcriptWords.map((word, index) => {
    const normalized = normalizeWord(word.word);
    const matchIndex = planWords.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex >= planCursor &&
        candidateIndex <= planCursor + 12 &&
        candidate.normalized === normalized,
    );
    if (matchIndex >= 0) {
      omittedWordCount += matchIndex - planCursor;
      const planWord = planWords[matchIndex]!;
      planCursor = matchIndex + 1;
      return {
        index,
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
        cueIndex: planWord.cueIndex,
        planWordIndex: matchIndex,
        match: "exact" as const,
      };
    }
    const expected = planWords[planCursor];
    if (expected) {
      substitutedWordCount += 1;
      planCursor += 1;
      return {
        index,
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
        cueIndex: expected.cueIndex,
        planWordIndex: planCursor - 1,
        match: "substitution" as const,
      };
    }
    insertedWordCount += 1;
    return {
      index,
      word: word.word,
      startMs: word.startMs,
      endMs: word.endMs,
      match: "insertion" as const,
    };
  });
  omittedWordCount += planWords.length - planCursor;
  const cueTimings = cues.flatMap((cue) => {
    const words = wordTimings.filter((word) => word.cueIndex === cue.index);
    const first = words[0];
    const last = words.at(-1);
    return first && last
      ? [
          {
            index: cue.index,
            startMs: first.startMs,
            endMs: last.endMs,
            text: cue.text,
          },
        ]
      : [];
  });
  return {
    wordTimings,
    cueTimings,
    omittedWordCount,
    insertedWordCount,
    substitutedWordCount,
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

function tokenize(text: string) {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)].map(
    (match) => ({
      text: match[0],
      normalized: normalizeWord(match[0]),
    }),
  );
}

function normalizeWord(word: string) {
  return word
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replaceAll(/[^\p{L}\p{N}]/gu, "");
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(process.cwd(), "[worker]")
    .slice(0, 800);
}
