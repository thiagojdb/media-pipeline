import {
  defineVideoComponent,
  type VideoComponentProps,
} from "@relay/component-sdk";
import { z } from "zod";

const seriesSchema = z.object({
  id: z
    .string()
    .min(1, "Series id is required.")
    .regex(/^[a-z][a-z0-9-]*$/, "Series id must use lowercase kebab-case."),
  label: z.string().trim().min(1, "Series label is required.").max(80),
  values: z
    .array(
      z
        .number()
        .finite("Series values must be finite numbers.")
        .min(-1_000_000_000_000, "Series values must be at least -1 trillion.")
        .max(1_000_000_000_000, "Series values must be at most 1 trillion."),
    )
    .max(60, "A series can contain at most 60 values."),
});

export const lineChartInputSchema = z
  .object({
    title: z.string().trim().min(1, "Chart title is required.").max(120),
    labels: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Data labels cannot be empty.")
          .max(40, "Data labels can contain at most 40 characters."),
      )
      .max(60, "A chart can contain at most 60 labels."),
    series: z
      .array(seriesSchema)
      .max(4, "A chart can contain at most 4 visually distinct series."),
    animate: z.boolean().default(true),
    highlightedSeriesId: z.string().optional(),
    highlightedPoint: z
      .object({
        seriesId: z.string().min(1),
        index: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .superRefine((input, context) => {
    if (input.labels.length > 0 && input.series.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: "Provide at least one series when the chart has labels.",
      });
    }
    if (input.labels.length === 0 && input.series.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["series"],
        message:
          "Remove all series for the empty state, or provide labels for the series values.",
      });
    }

    const seenIds = new Set<string>();
    input.series.forEach((series, seriesIndex) => {
      if (seenIds.has(series.id)) {
        context.addIssue({
          code: "custom",
          path: ["series", seriesIndex, "id"],
          message: `Series id "${series.id}" is duplicated; every series id must be unique.`,
        });
      }
      seenIds.add(series.id);
      if (series.values.length !== input.labels.length) {
        context.addIssue({
          code: "custom",
          path: ["series", seriesIndex, "values"],
          message: `Expected ${input.labels.length} values to match the labels, received ${series.values.length}.`,
        });
      }
    });

    if (
      input.highlightedSeriesId !== undefined &&
      !seenIds.has(input.highlightedSeriesId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["highlightedSeriesId"],
        message: `Highlighted series "${input.highlightedSeriesId}" does not match a series id.`,
      });
    }

    if (input.highlightedPoint !== undefined) {
      if (!seenIds.has(input.highlightedPoint.seriesId)) {
        context.addIssue({
          code: "custom",
          path: ["highlightedPoint", "seriesId"],
          message: `Highlighted point series "${input.highlightedPoint.seriesId}" does not match a series id.`,
        });
      }
      if (input.highlightedPoint.index >= input.labels.length) {
        context.addIssue({
          code: "custom",
          path: ["highlightedPoint", "index"],
          message: `Highlighted point index must be between 0 and ${Math.max(0, input.labels.length - 1)}.`,
        });
      }
    }
  });

export type LineChartInput = z.output<typeof lineChartInputSchema>;

const denseLabels = Array.from({ length: 48 }, (_, index) => `W${index + 1}`);
const densePrimaryValues = denseLabels.map(
  (_, index) => 120 + index * 7 + ((index % 6) - 2) * 9,
);
const denseSecondaryValues = denseLabels.map(
  (_, index) => 210 + index * 4 + ((index % 5) - 2) * 11,
);

export const invalidLineChartInputs: readonly {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly expectedPath: readonly string[];
}[] = [
  {
    id: "missing-series",
    name: "Labels require at least one series",
    input: {
      title: "Incomplete data",
      labels: ["Jan", "Feb"],
      series: [],
    },
    expectedPath: ["series"],
  },
  {
    id: "mismatched-values",
    name: "Series length does not match labels",
    input: {
      title: "Incomplete data",
      labels: ["Jan", "Feb", "Mar"],
      series: [{ id: "views", label: "Views", values: [10, 20] }],
    },
    expectedPath: ["series", "0", "values"],
  },
  {
    id: "duplicate-series",
    name: "Duplicate series ids",
    input: {
      title: "Duplicate data",
      labels: ["Jan"],
      series: [
        { id: "views", label: "Views", values: [10] },
        { id: "views", label: "Returning views", values: [4] },
      ],
    },
    expectedPath: ["series", "1", "id"],
  },
  {
    id: "unknown-highlight",
    name: "Highlight references an unknown series",
    input: {
      title: "Unknown highlight",
      labels: ["Jan"],
      series: [{ id: "views", label: "Views", values: [10] }],
      highlightedPoint: { seriesId: "missing", index: 0 },
    },
    expectedPath: ["highlightedPoint", "seriesId"],
  },
  {
    id: "point-out-of-range",
    name: "Highlight references an unknown point",
    input: {
      title: "Unknown point",
      labels: ["Jan"],
      series: [{ id: "views", label: "Views", values: [10] }],
      highlightedPoint: { seriesId: "views", index: 2 },
    },
    expectedPath: ["highlightedPoint", "index"],
  },
];

export const lineChart = defineVideoComponent({
  id: "animated-line-chart",
  version: "1.0.0",
  schema: lineChartInputSchema,
  fps: 30,
  dimensions: { width: 1920, height: 1080 },
  supportedDimensions: [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 960, height: 540 },
  ],
  duration: 120,
  assets: [],
  fixtures: [
    {
      id: "channel-growth",
      name: "Channel growth with a highlighted milestone",
      input: {
        title: "Monthly channel growth",
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        series: [
          {
            id: "subscribers",
            label: "Subscribers",
            values: [120, 180, 265, 390, 540, 760],
          },
          {
            id: "returning-viewers",
            label: "Returning viewers",
            values: [90, 150, 210, 280, 410, 590],
          },
        ],
        highlightedSeriesId: "subscribers",
        highlightedPoint: { seriesId: "subscribers", index: 4 },
      },
      checkpoints: [
        { label: "before-draw", frame: 0 },
        { label: "half-drawn", frame: 45 },
        { label: "settled-highlight", frame: 119 },
      ],
    },
    {
      id: "empty",
      name: "Intentional no-data state",
      input: { title: "No observations yet", labels: [], series: [] },
      checkpoints: [{ label: "empty-state", frame: 0 }],
    },
    {
      id: "dense",
      name: "Forty-eight observations across two series",
      input: {
        title: "Weekly audience trend",
        labels: denseLabels,
        series: [
          {
            id: "new-viewers",
            label: "New viewers",
            values: densePrimaryValues,
          },
          {
            id: "returning-viewers",
            label: "Returning viewers",
            values: denseSecondaryValues,
          },
        ],
        animate: false,
      },
      checkpoints: [
        { label: "dense-start", frame: 0 },
        { label: "dense-end", frame: 119 },
      ],
    },
  ],
  compatibility: { mode: "initial" },
  component: AnimatedLineChart,
});

function AnimatedLineChart({
  input,
  frame,
  durationInFrames,
  width,
  height,
  theme,
}: VideoComponentProps<LineChartInput>) {
  const background = theme.colors.background ?? "#0b1020";
  const foreground = theme.colors.foreground ?? "#f8fafc";
  const muted = theme.colors.muted ?? "#94a3b8";
  const grid = theme.colors.grid ?? "#334155";
  const accent = theme.colors.accent ?? "#f59e0b";
  const headingFont = theme.fonts.heading ?? "sans-serif";
  const bodyFont = theme.fonts.body ?? headingFont;
  const outerSpacing = clamp(
    theme.spacing.outer ?? 64,
    24,
    Math.min(width, height) * 0.15,
  );
  const titleSize = Math.max(28, height * 0.052);

  if (input.labels.length === 0) {
    return (
      <svg
        aria-label={`${input.title}: no data available`}
        data-empty="true"
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <rect fill={background} height={height} width={width} />
        <text
          fill={foreground}
          fontFamily={headingFont}
          fontSize={titleSize}
          fontWeight={700}
          x={outerSpacing}
          y={outerSpacing + titleSize}
        >
          {truncateText(input.title, 64)}
        </text>
        <text
          fill={muted}
          fontFamily={bodyFont}
          fontSize={Math.max(22, height * 0.035)}
          textAnchor="middle"
          x={width / 2}
          y={height / 2}
        >
          No data available
        </text>
      </svg>
    );
  }

  const chartLeft = outerSpacing + width * 0.06;
  const chartRight = width - outerSpacing;
  const chartTop = outerSpacing + titleSize * 1.8;
  const chartBottom = height - outerSpacing * 1.45;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;
  const values = input.series.flatMap((series) => series.values);
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const range = rawMaximum - rawMinimum;
  const padding =
    range === 0 ? Math.max(1, Math.abs(rawMaximum) * 0.1) : range * 0.1;
  const minimum = rawMinimum - padding;
  const maximum = rawMaximum + padding;
  const drawEndFrame = Math.max(1, Math.round(durationInFrames * 0.75));
  const drawProgress = input.animate ? clamp(frame / drawEndFrame, 0, 1) : 1;
  const labelStride = Math.max(1, Math.ceil(input.labels.length / 8));

  return (
    <svg
      aria-label={input.title}
      data-draw-progress={drawProgress.toFixed(3)}
      data-empty="false"
      height={height}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <rect fill={background} height={height} width={width} />
      <text
        fill={foreground}
        fontFamily={headingFont}
        fontSize={titleSize}
        fontWeight={700}
        x={outerSpacing}
        y={outerSpacing + titleSize}
      >
        {truncateText(input.title, 64)}
      </text>

      {Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const y = chartBottom - ratio * chartHeight;
        const value = minimum + ratio * (maximum - minimum);
        return (
          <g key={`grid-${index}`}>
            <line
              opacity={0.7}
              stroke={grid}
              strokeWidth={1}
              x1={chartLeft}
              x2={chartRight}
              y1={y}
              y2={y}
            />
            <text
              fill={muted}
              fontFamily={bodyFont}
              fontSize={Math.max(15, height * 0.021)}
              textAnchor="end"
              x={chartLeft - 18}
              y={y + 7}
            >
              {formatAxisValue(value)}
            </text>
          </g>
        );
      })}

      {input.labels.map((label, index) => {
        if (index % labelStride !== 0 && index !== input.labels.length - 1)
          return null;
        return (
          <text
            fill={muted}
            fontFamily={bodyFont}
            fontSize={Math.max(15, height * 0.021)}
            key={`label-${index}`}
            textAnchor="middle"
            x={pointX(index, input.labels.length, chartLeft, chartWidth)}
            y={chartBottom + 40}
          >
            {truncateText(label, 14)}
          </text>
        );
      })}

      {input.series.map((series, seriesIndex) => {
        const isHighlighted = input.highlightedSeriesId === series.id;
        const color = seriesColor(seriesIndex, theme.colors);
        const path = series.values
          .map((value, index) => {
            const x = pointX(
              index,
              series.values.length,
              chartLeft,
              chartWidth,
            );
            const y =
              chartBottom -
              ((value - minimum) / (maximum - minimum)) * chartHeight;
            return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" ");
        const highlightedPoint =
          input.highlightedPoint?.seriesId === series.id
            ? input.highlightedPoint
            : undefined;
        const pointVisible =
          highlightedPoint !== undefined &&
          drawProgress >=
            (series.values.length <= 1
              ? 0
              : highlightedPoint.index / (series.values.length - 1));

        return (
          <g
            data-highlighted-series={isHighlighted ? "true" : "false"}
            data-series-id={series.id}
            key={series.id}
          >
            {series.values.length === 1 ? (
              <circle
                cx={pointX(0, 1, chartLeft, chartWidth)}
                cy={
                  chartBottom -
                  ((series.values[0]! - minimum) / (maximum - minimum)) *
                    chartHeight
                }
                fill={color}
                opacity={drawProgress}
                r={isHighlighted ? 8 : 6}
              />
            ) : (
              <path
                d={path}
                fill="none"
                opacity={input.highlightedSeriesId && !isHighlighted ? 0.38 : 1}
                pathLength={1}
                stroke={color}
                strokeDasharray={1}
                strokeDashoffset={1 - drawProgress}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={isHighlighted ? 8 : 5}
              />
            )}
            {pointVisible && highlightedPoint ? (
              <circle
                aria-label={`${series.label}, ${input.labels[highlightedPoint.index]}: ${series.values[highlightedPoint.index]}`}
                cx={pointX(
                  highlightedPoint.index,
                  series.values.length,
                  chartLeft,
                  chartWidth,
                )}
                cy={
                  chartBottom -
                  ((series.values[highlightedPoint.index]! - minimum) /
                    (maximum - minimum)) *
                    chartHeight
                }
                data-highlighted-point="true"
                fill={background}
                r={12}
                stroke={accent}
                strokeWidth={7}
              />
            ) : null}
            <g
              transform={`translate(${chartLeft + seriesIndex * 250} ${height - outerSpacing * 0.45})`}
            >
              <line
                stroke={color}
                strokeWidth={6}
                x1={0}
                x2={34}
                y1={0}
                y2={0}
              />
              <text
                fill={isHighlighted ? foreground : muted}
                fontFamily={bodyFont}
                fontSize={Math.max(15, height * 0.021)}
                fontWeight={isHighlighted ? 700 : 500}
                x={48}
                y={7}
              >
                {truncateText(series.label, 22)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function pointX(
  index: number,
  pointCount: number,
  left: number,
  width: number,
): number {
  return pointCount <= 1
    ? left + width / 2
    : left + (index / (pointCount - 1)) * width;
}

function seriesColor(
  index: number,
  colors: Readonly<Record<string, string>>,
): string {
  const palette = [
    colors.chartPrimary ?? colors.primary ?? "#38bdf8",
    colors.chartSecondary ?? colors.secondary ?? "#a78bfa",
    colors.chartTertiary ?? colors.accent ?? "#f59e0b",
    colors.chartQuaternary ?? "#34d399",
  ];
  return palette[index % palette.length]!;
}

function truncateText(value: string, maximumCharacters: number): string {
  return value.length <= maximumCharacters
    ? value
    : `${value.slice(0, maximumCharacters - 1)}…`;
}

function formatAxisValue(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (magnitude >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (magnitude >= 10) return value.toFixed(0);
  return value.toFixed(1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
