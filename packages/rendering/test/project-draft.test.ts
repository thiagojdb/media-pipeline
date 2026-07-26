import { describe, expect, it } from "vitest";

import { projectDraftFramePlan } from "../src/index.js";

describe("project draft frame plan", () => {
  const segments = [
    { id: "hook", anchor: { startMs: 0, endMs: 1_000 } },
    { id: "explanation", anchor: { startMs: 1_000, endMs: 2_000 } },
  ];

  it("keeps full-output frames aligned with preview composition frames", () => {
    const plan = projectDraftFramePlan(segments, 30, {
      startMs: 0,
      endMs: 2_000,
    });
    expect(plan.durationInFrames).toBe(60);
    expect(plan.frame(0)).toMatchObject({
      compositionTimeMs: 0,
      compositionFrame: 0,
      segment: { id: "hook" },
      segmentFrame: 0,
    });
    expect(plan.frame(30)).toMatchObject({
      compositionTimeMs: 1_000,
      compositionFrame: 30,
      segment: { id: "explanation" },
      segmentFrame: 0,
    });
  });

  it("preserves component-local timing when rendering a selected range", () => {
    const plan = projectDraftFramePlan(segments, 30, {
      startMs: 1_200,
      endMs: 1_800,
    });
    expect(plan.durationInFrames).toBe(18);
    expect(plan.frame(0)).toMatchObject({
      compositionTimeMs: 1_200,
      compositionFrame: 36,
      segment: { id: "explanation" },
      segmentFrame: 6,
    });
  });

  it("rejects invalid ranges and output frames", () => {
    expect(() =>
      projectDraftFramePlan(segments, 30, { startMs: 1_000, endMs: 1_000 }),
    ).toThrow("valid millisecond bounds");
    const plan = projectDraftFramePlan(segments, 30, {
      startMs: 0,
      endMs: 100,
    });
    expect(() => plan.frame(plan.durationInFrames)).toThrow(
      "outside the selected range",
    );
  });
});
