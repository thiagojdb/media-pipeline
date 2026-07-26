import { describe, expect, it } from "vitest";

import { generateDeterministicNarration } from "./narration-loop.js";

describe("deterministic fake narration", () => {
  it("generates playable PCM WAV bytes and stable sentence timing", () => {
    const content = "Opening line. The evidence follows.\n\nThis is the close.";
    const first = generateDeterministicNarration(content);
    const second = generateDeterministicNarration(content);

    expect(first.durationMs).toBeGreaterThan(1_000);
    expect(first.timingSegments).toEqual([
      expect.objectContaining({ index: 0, startMs: 0, text: "Opening line." }),
      expect.objectContaining({ index: 1, text: "The evidence follows." }),
      expect.objectContaining({ index: 2, text: "This is the close." }),
    ]);
    expect(first.timingSegments.at(-1)?.endMs).toBe(first.durationMs);
    expect(first.audio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(first.audio.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(first.audio.readUInt32LE(24)).toBe(16_000);
    expect(first.audio).toEqual(second.audio);
    expect(first.timingSegments).toEqual(second.timingSegments);
  });

  it("bounds very large scripts to a finite artifact and timing set", () => {
    const generated = generateDeterministicNarration(
      Array.from({ length: 1_000 }, (_, index) => `Sentence ${index}.`).join(
        " ",
      ),
    );

    expect(generated.durationMs).toBeLessThanOrEqual(120_000);
    expect(generated.timingSegments.length).toBeLessThanOrEqual(200);
    expect(generated.audio.length).toBeLessThanOrEqual(3_840_044);
  });
});
