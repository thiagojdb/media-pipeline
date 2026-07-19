import {
  defineVideoComponent,
  type DefinedVideoComponent,
} from "@relay/component-sdk";
import { lineChart, lineChartRevision } from "@relay/reference-components";
import { z } from "zod";

const runtimeFailureProof = defineVideoComponent({
  id: "runtime-failure-proof",
  version: "1.0.0",
  schema: z.object({
    title: z.string().trim().min(1, "Title is required.").max(120),
  }),
  fps: 30,
  dimensions: { width: 1920, height: 1080 },
  duration: 30,
  assets: [],
  fixtures: [
    {
      id: "failure-after-start",
      name: "Failure after the first frame",
      input: { title: "Runtime containment proof" },
      checkpoints: [{ label: "safe-start", frame: 0 }],
    },
  ],
  compatibility: { mode: "initial" },
  component: ({ frame, input, width, height }) => {
    if (frame > 0) {
      console.warn("Component diagnostic before intentional runtime failure.");
      throw new Error("Intentional component runtime failure.");
    }
    return (
      <svg
        aria-label={input.title}
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <rect fill="#111827" height={height} width={width} />
        <text fill="white" fontSize="64" x="96" y="160">
          {input.title}
        </text>
      </svg>
    );
  },
});

/**
 * Closed allowlist of trusted definitions compiled into the application.
 * MED-129 never loads source or falls back across unknown ids or versions.
 */
const trustedBundledComponents = [
  lineChart,
  lineChartRevision,
  runtimeFailureProof,
] as const;

export function hasPreviewComponent(id: string, version: string): boolean {
  return trustedBundledComponents.some(
    (component) => component.id === id && component.version === version,
  );
}

export function getPreviewComponent(
  id: string,
  version: string,
): DefinedVideoComponent<z.ZodObject> | undefined {
  return trustedBundledComponents.find(
    (component) => component.id === id && component.version === version,
  ) as unknown as DefinedVideoComponent<z.ZodObject> | undefined;
}
