import { readFileSync } from "node:fs";

import {
  resolveVideoComponentDuration,
  validateVideoComponentInput,
  type ChannelTheme,
} from "@relay/component-sdk";
import { validateComponentSource } from "@relay/component-testkit";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  invalidLineChartInputs,
  lineChart,
  lineChartInputSchema,
  type LineChartInput,
} from "../src/index.js";

const theme: ChannelTheme = {
  colors: {
    background: "#07111f",
    foreground: "#f4f7fb",
    muted: "#91a3ba",
    grid: "#24364d",
    accent: "#ffb000",
    chartPrimary: "#00c2ff",
    chartSecondary: "#d76cff",
  },
  fonts: { heading: "Relay Display", body: "Relay Sans" },
  spacing: { outer: 72 },
};

function fixture(id: string) {
  const result = lineChart.fixtures.find((item) => item.id === id);
  if (!result) throw new Error(`Missing fixture ${id}.`);
  return result;
}

function render(id: string, frame: number): string {
  return renderInput(fixture(id).input, frame);
}

function renderInput(input: LineChartInput, frame: number): string {
  const durationInFrames = resolveVideoComponentDuration(lineChart, input);
  return renderToStaticMarkup(
    lineChart.component({
      input,
      frame,
      fps: lineChart.fps,
      durationInFrames,
      width: lineChart.dimensions.width,
      height: lineChart.dimensions.height,
      theme,
      assets: {},
    }),
  );
}

describe("reference animated line chart", () => {
  it("defines typed controls, supported dimensions, and representative fixtures through the SDK", () => {
    expect(lineChart.id).toBe("animated-line-chart");
    expect(lineChart.supportedDimensions).toEqual([
      { width: 3840, height: 2160 },
      { width: 2560, height: 1440 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 960, height: 540 },
    ]);
    expect(lineChart.inputControls).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string" },
        labels: { type: "array" },
        series: { type: "array" },
        animate: { type: "boolean", default: true },
      },
    });
    expect(lineChart.fixtures.map(({ id }) => id)).toEqual([
      "channel-growth",
      "empty",
      "dense",
    ]);
    expect(fixture("empty").input).toMatchObject({ labels: [], series: [] });
    expect(fixture("dense").input.labels).toHaveLength(48);
    expect(fixture("dense").input.series[0]?.values).toHaveLength(48);
  });

  it("declares meaningful checkpoint frames for animation and edge states", () => {
    expect(fixture("channel-growth").checkpoints).toEqual([
      { label: "before-draw", frame: 0 },
      { label: "half-drawn", frame: 45 },
      { label: "settled-highlight", frame: 119 },
    ]);
    expect(fixture("empty").checkpoints).toEqual([
      { label: "empty-state", frame: 0 },
    ]);
    expect(fixture("dense").checkpoints).toEqual([
      { label: "dense-start", frame: 0 },
      { label: "dense-end", frame: 119 },
    ]);
  });

  it("uses only supplied theme colors, typography, dimensions, and frame context", () => {
    const output = render("channel-growth", 45);
    expect(output).toContain('width="1920"');
    expect(output).toContain('height="1080"');
    expect(output).toContain('fill="#07111f"');
    expect(output).toContain('stroke="#00c2ff"');
    expect(output).toContain('font-family="Relay Display"');
    expect(output).toContain('font-family="Relay Sans"');
    expect(output).toContain('data-draw-progress="0.500"');
  });

  it("draws animated lines as a deterministic function of frame", () => {
    const start = render("channel-growth", 0);
    const middle = render("channel-growth", 45);
    const complete = render("channel-growth", 119);

    expect(start).toContain('data-draw-progress="0.000"');
    expect(start).toContain('stroke-dashoffset="1"');
    expect(start).not.toContain('data-highlighted-point="true"');
    expect(middle).toContain('data-draw-progress="0.500"');
    expect(middle).toContain('stroke-dashoffset="0.5"');
    expect(complete).toContain('data-draw-progress="1.000"');
    expect(complete).toContain('stroke-dashoffset="0"');
    expect(complete).toContain('data-highlighted-point="true"');

    expect(render("channel-growth", 45)).toBe(middle);
    expect(render("channel-growth", 119)).toBe(complete);
  });

  it("renders highlighted series and point states explicitly", () => {
    const output = render("channel-growth", 119);
    expect(output).toContain('data-series-id="subscribers"');
    expect(output).toContain('data-highlighted-series="true"');
    expect(output).toContain('data-series-id="returning-viewers"');
    expect(output).toContain('data-highlighted-series="false"');
    expect(output).toContain('aria-label="Subscribers, May: 540"');
    expect(output).toContain('stroke="#ffb000"');
  });

  it("renders the valid empty state intentionally", () => {
    const output = render("empty", 0);
    expect(output).toContain('data-empty="true"');
    expect(output).toContain("No data available");
    expect(output).not.toContain("<path");
  });

  it("renders dense data without non-finite geometry and remains static when animation is disabled", () => {
    const start = render("dense", 0);
    const end = render("dense", 119);
    expect(start).toContain('data-draw-progress="1.000"');
    expect(start.match(/<path/g)).toHaveLength(2);
    expect(start).not.toMatch(/(?:NaN|Infinity)/);
    expect(end).toBe(start);
  });

  it("renders single-point and maximum-series inputs within declared bounds", () => {
    const singlePoint = lineChartInputSchema.parse({
      title: "Single observation",
      labels: ["January"],
      series: [{ id: "views", label: "Views", values: [42] }],
      animate: false,
    });
    const maximumSeries = lineChartInputSchema.parse({
      title:
        "A deliberately long title that remains accessible while its visible SVG text is shortened to fit the composition safely",
      labels: ["January category requiring truncation"],
      series: Array.from({ length: 4 }, (_, index) => ({
        id: `series-${index + 1}`,
        label: `A deliberately long legend label for series ${index + 1}`,
        values: [index + 1],
      })),
      animate: false,
    });

    const pointOutput = renderInput(singlePoint, 119);
    const maximumOutput = renderInput(maximumSeries, 119);
    expect(pointOutput).toContain("<circle");
    expect(pointOutput).not.toMatch(/(?:NaN|Infinity)/);
    expect(maximumOutput.match(/data-series-id=/g)).toHaveLength(4);
    expect(maximumOutput).toContain("…");
    expect(maximumOutput).not.toMatch(/(?:NaN|Infinity)/);
  });

  it("rejects unsafe numeric magnitudes and series counts beyond the visual layout", () => {
    const extreme = validateVideoComponentInput(lineChartInputSchema, {
      title: "Unsafe range",
      labels: ["Low", "High"],
      series: [
        {
          id: "values",
          label: "Values",
          values: [-Number.MAX_VALUE, Number.MAX_VALUE],
        },
      ],
    });
    const tooManySeries = validateVideoComponentInput(lineChartInputSchema, {
      title: "Too many series",
      labels: ["One"],
      series: Array.from({ length: 5 }, (_, index) => ({
        id: `series-${index + 1}`,
        label: `Series ${index + 1}`,
        values: [index],
      })),
    });

    expect(extreme.success).toBe(false);
    expect(tooManySeries.success).toBe(false);
    if (extreme.success || tooManySeries.success)
      throw new Error("Expected bounded chart inputs to fail.");
    expect(extreme.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["series", "0", "values", "0"] }),
        expect.objectContaining({ path: ["series", "0", "values", "1"] }),
      ]),
    );
    expect(tooManySeries.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["series"], code: "input_invalid" }),
      ]),
    );
  });

  it("rejects each invalid-input example with an actionable public-contract path", () => {
    for (const example of invalidLineChartInputs) {
      const result = validateVideoComponentInput(
        lineChartInputSchema,
        example.input,
      );
      expect(result.success, example.name).toBe(false);
      if (result.success) throw new Error(`Expected ${example.id} to fail.`);
      expect(result.issues, example.name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "input_invalid",
            path: example.expectedPath,
            message: expect.stringMatching(/\S/),
          }),
        ]),
      );
    }
  });

  it("passes the deterministic component source policy", () => {
    const source = readFileSync(
      new URL("../src/line-chart.tsx", import.meta.url),
      "utf8",
    );
    expect(validateComponentSource({ "line-chart.tsx": source })).toEqual({
      success: true,
    });
  });
});
