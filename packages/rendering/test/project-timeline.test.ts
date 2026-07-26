import { describe, expect, it } from "vitest";

import { compositionFrameAtTime, segmentFrameAtTime } from "../src/index.js";

describe("shared project frame semantics", () => {
  it("maps preview and render checkpoints to the same zero-based frames", () => {
    expect(compositionFrameAtTime(0, 30)).toBe(0);
    expect(compositionFrameAtTime(899, 30)).toBe(26);
    expect(compositionFrameAtTime(900, 30)).toBe(27);
    expect(compositionFrameAtTime(1_800, 30)).toBe(54);
    expect(segmentFrameAtTime(1_200, 900, 30)).toBe(9);
  });

  it("rejects invalid global timing configuration", () => {
    expect(() => compositionFrameAtTime(-1, 30)).toThrow("non-negative");
    expect(() => compositionFrameAtTime(1_000, 0)).toThrow("positive integer");
  });
});
