import { defineVideoComponent } from "@relay/component-sdk";
import { z } from "zod";

const base = {
  version: "1.0.0",
  fps: 30,
  dimensions: { width: 1920, height: 1080 },
  assets: [],
  compatibility: { mode: "initial" as const },
  component: () => null,
};

export const lineChart = defineVideoComponent({
  ...base,
  id: "line-chart",
  schema: z.object({
    title: z.string().describe("Chart title"),
    series: z
      .array(z.object({ label: z.string(), values: z.array(z.number()) }))
      .min(1),
    lineColor: z.string().default("#ef4444"),
    animate: z.boolean().default(true),
  }),
  duration: 180,
  fixtures: [
    {
      id: "growth",
      name: "Growth over time",
      input: {
        title: "Subscribers",
        series: [{ label: "2026", values: [10, 18, 31, 48] }],
      },
      checkpoints: [
        { label: "start", frame: 0 },
        { label: "mid-draw", frame: 90 },
        { label: "complete", frame: 179 },
      ],
    },
  ],
});

export const map = defineVideoComponent({
  ...base,
  id: "route-map",
  schema: z.object({
    geoJson: z
      .record(z.string(), z.unknown())
      .describe("GeoJSON feature collection"),
    highlightedRegionIds: z.array(z.string()),
    camera: z.object({
      longitude: z.number(),
      latitude: z.number(),
      zoom: z.number().positive(),
    }),
  }),
  duration: 150,
  fixtures: [
    {
      id: "single-region",
      name: "Highlighted region",
      input: {
        geoJson: { type: "FeatureCollection", features: [] },
        highlightedRegionIds: ["north"],
        camera: { longitude: 0, latitude: 20, zoom: 2 },
      },
      checkpoints: [{ label: "settled", frame: 149 }],
    },
  ],
});

export const chessboard = defineVideoComponent({
  ...base,
  id: "chessboard",
  schema: z.object({
    pgn: z.string().min(1),
    orientation: z.enum(["white", "black"]),
    moveFrames: z.number().int().positive().default(24),
  }),
  duration: (input) =>
    Math.max(1, input.pgn.split(/\s+/).length * input.moveFrames),
  fixtures: [
    {
      id: "opening",
      name: "Short opening",
      input: { pgn: "1. e4 e5 2. Nf3 Nc6", orientation: "white" },
      checkpoints: [{ label: "first-move", frame: 24 }],
    },
  ],
});

export const subtitles = defineVideoComponent({
  ...base,
  id: "subtitles",
  schema: z.object({
    cues: z.array(
      z.object({
        text: z.string(),
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
      }),
    ),
    position: z.enum(["top", "center", "bottom"]).default("bottom"),
  }),
  duration: (input) => Math.max(1, ...input.cues.map((cue) => cue.endFrame)),
  fixtures: [
    {
      id: "two-cues",
      name: "Two subtitle cues",
      input: {
        cues: [
          { text: "First", startFrame: 0, endFrame: 30 },
          { text: "Second", startFrame: 30, endFrame: 60 },
        ],
      },
      checkpoints: [{ label: "second-cue", frame: 30 }],
    },
  ],
});

export const brandedMedia = defineVideoComponent({
  ...base,
  id: "branded-media",
  schema: z.object({
    headline: z.string(),
    mediaFit: z.enum(["contain", "cover"]).default("cover"),
  }),
  assets: [
    {
      key: "source",
      kind: "video",
      required: true,
      description: "Source footage",
    },
    { key: "logo", kind: "image", required: true, description: "Channel logo" },
  ],
  duration: 240,
  fixtures: [
    {
      id: "headline",
      name: "Branded source footage",
      input: { headline: "A sourced story" },
      checkpoints: [{ label: "title-visible", frame: 45 }],
    },
  ],
});
