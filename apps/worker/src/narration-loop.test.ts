import { describe, expect, it } from "vitest";

import { alignTranscriptToPlan, probeAudio } from "./narration-loop.js";

describe("narration alignment", () => {
  it("maps exact words to cues and retains actual timestamps", () => {
    const result = alignTranscriptToPlan(
      [
        { index: 0, text: "Opening line." },
        { index: 1, text: "The evidence follows." },
      ],
      [
        { word: "Opening", startMs: 100, endMs: 400 },
        { word: "line", startMs: 410, endMs: 700 },
        { word: "The", startMs: 900, endMs: 1_000 },
        { word: "evidence", startMs: 1_010, endMs: 1_400 },
        { word: "follows", startMs: 1_410, endMs: 1_800 },
      ],
    );

    expect(result.wordTimings).toEqual([
      expect.objectContaining({
        word: "Opening",
        startMs: 100,
        endMs: 400,
        cueIndex: 0,
        match: "exact",
      }),
      expect.objectContaining({ word: "line", cueIndex: 0, match: "exact" }),
      expect.objectContaining({ word: "The", cueIndex: 1, match: "exact" }),
      expect.objectContaining({ word: "evidence", cueIndex: 1 }),
      expect.objectContaining({ word: "follows", cueIndex: 1 }),
    ]);
    expect(result.cueTimings).toEqual([
      { index: 0, startMs: 100, endMs: 700, text: "Opening line." },
      {
        index: 1,
        startMs: 900,
        endMs: 1_800,
        text: "The evidence follows.",
      },
    ]);
    expect(result.omittedWordCount).toBe(0);
    expect(result.insertedWordCount).toBe(0);
    expect(result.substitutedWordCount).toBe(0);
  });

  it("surfaces narration deviations for producer review", () => {
    const result = alignTranscriptToPlan(
      [{ index: 0, text: "The planned narration ends here" }],
      [
        { word: "The", startMs: 0, endMs: 100 },
        { word: "actual", startMs: 110, endMs: 250 },
        { word: "narration", startMs: 260, endMs: 500 },
        { word: "adds", startMs: 510, endMs: 650 },
        { word: "words", startMs: 660, endMs: 800 },
      ],
    );

    expect(result.wordTimings.some((word) => word.match !== "exact")).toBe(
      true,
    );
    expect(
      result.omittedWordCount +
        result.insertedWordCount +
        result.substitutedWordCount,
    ).toBeGreaterThan(0);
  });

  it("probes uploaded audio through FFprobe", async () => {
    await expect(probeAudio(silentWav(1_000))).resolves.toEqual({
      durationMs: 1_000,
      audioCodec: "pcm_s16le",
      sampleRate: 16_000,
      channels: 1,
    });
  });
});

function silentWav(durationMs: number) {
  const sampleRate = 16_000;
  const sampleCount = Math.round((durationMs / 1_000) * sampleRate);
  const dataSize = sampleCount * 2;
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataSize, 40);
  return output;
}
