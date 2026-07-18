import { describe, expect, it } from "vitest";

import {
  checkpointFrame,
  clampFrame,
  fitStageScale,
  formatIssuePath,
  jsonSyntaxIssue,
  playbackFrameAtElapsedTime,
  playbackStartFrame,
  stepFrame,
} from "./preview-model";

describe("preview frame model", () => {
  it("clamps arbitrary seeks to exact zero-based frame bounds", () => {
    expect(clampFrame(45, 120)).toBe(45);
    expect(clampFrame(-8, 120)).toBe(0);
    expect(clampFrame(999, 120)).toBe(119);
    expect(clampFrame(4.6, 120)).toBe(5);
  });

  it("steps exactly one frame and stops at composition bounds", () => {
    expect(stepFrame(45, -1, 120)).toBe(44);
    expect(stepFrame(45, 1, 120)).toBe(46);
    expect(stepFrame(0, -1, 120)).toBe(0);
    expect(stepFrame(119, 1, 120)).toBe(119);
  });

  it("derives playback from elapsed time, stops on the final frame, and restarts from zero", () => {
    expect(playbackFrameAtElapsedTime(0, 0, 30, 120)).toEqual({
      frame: 0,
      complete: false,
    });
    expect(playbackFrameAtElapsedTime(0, 999, 30, 120)).toEqual({
      frame: 29,
      complete: false,
    });
    expect(playbackFrameAtElapsedTime(110, 10_000, 30, 120)).toEqual({
      frame: 119,
      complete: true,
    });
    expect(playbackStartFrame(45, 120)).toBe(45);
    expect(playbackStartFrame(119, 120)).toBe(0);
  });

  it("clamps fixture checkpoints after an input-derived duration change", () => {
    expect(checkpointFrame(119, 60)).toBe(59);
    expect(checkpointFrame(0, 60)).toBe(0);
  });

  it("fits arbitrary stage aspect ratios inside arbitrary viewports", () => {
    expect(
      fitStageScale(
        { width: 1080, height: 1920 },
        { width: 1000, height: 500 },
      ),
    ).toBeCloseTo(500 / 1920);
    expect(
      fitStageScale({ width: 1000, height: 1000 }, { width: 400, height: 900 }),
    ).toBe(0.4);
    expect(
      fitStageScale({ width: 1920, height: 1080 }, { width: 0, height: 900 }),
    ).toBe(0);
  });

  it("formats nested public validation paths for creators", () => {
    expect(formatIssuePath(["series", "0", "values", 2])).toBe(
      "series[0].values[2]",
    );
    expect(formatIssuePath([])).toBe("input");
    expect(
      jsonSyntaxIssue("labels", new Error("Unexpected token")).message,
    ).toContain("Enter valid JSON");
  });
});
