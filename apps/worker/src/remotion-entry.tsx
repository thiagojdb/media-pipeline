import React from "react";
import {
  lineChart,
  lineChartRevision,
  type LineChartInput,
} from "@relay/reference-components";
import { RemotionVideoComponentFrame } from "@relay/rendering";
import { Composition, registerRoot } from "remotion";
import type { z } from "zod";

import type { PinnedDraftRenderRequest } from "./draft-render-contract.js";

type DraftCompositionProps = PinnedDraftRenderRequest & Record<string, unknown>;

const fixture = lineChart.fixtures[0]!;
const defaultProps: DraftCompositionProps = {
  componentId: lineChart.id,
  version: lineChart.version,
  fixtureId: fixture.id,
  input: fixture.input,
  fps: lineChart.fps,
  durationInFrames: 120,
  dimensions: { width: 960, height: 540 },
  theme: {
    colors: {},
    fonts: {},
    spacing: {},
  },
  quality: { codec: "h264", crf: 28, pixelFormat: "yuv420p" },
};

function DraftComponent(props: DraftCompositionProps) {
  const definition = [lineChart, lineChartRevision].find(
    (item) => item.id === props.componentId && item.version === props.version,
  );
  if (!definition) {
    throw new Error(
      `Pinned component ${props.componentId}@${props.version} is unavailable in this render bundle.`,
    );
  }
  return (
    <RemotionVideoComponentFrame
      assets={{}}
      definition={definition}
      dimensions={props.dimensions}
      durationInFrames={props.durationInFrames}
      input={props.input as LineChartInput}
      theme={props.theme}
    />
  );
}

function RemotionRoot() {
  return (
    <Composition<z.ZodObject, DraftCompositionProps>
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
        height: props.dimensions.height,
        props,
        width: props.dimensions.width,
      })}
      component={DraftComponent}
      defaultProps={defaultProps}
      durationInFrames={defaultProps.durationInFrames}
      fps={defaultProps.fps}
      height={defaultProps.dimensions.height}
      id="relay-component-draft"
      width={defaultProps.dimensions.width}
    />
  );
}

registerRoot(RemotionRoot);
