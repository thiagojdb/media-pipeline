import { defineVideoComponent, type ChannelTheme } from "@relay/component-sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const remotionHost = vi.hoisted(() => ({
  frame: 23,
  config: {
    fps: 24,
    width: 1280,
    height: 720,
    durationInFrames: 48,
  },
}));

vi.mock("remotion", () => ({
  useCurrentFrame: () => remotionHost.frame,
  useVideoConfig: () => remotionHost.config,
}));

import {
  RemotionVideoComponentFrame,
  VideoComponentFrame,
} from "../src/index.js";

const definition = defineVideoComponent({
  id: "frame-proof",
  version: "1.0.0",
  schema: z.object({
    label: z.string(),
    duration: z.number().int().positive(),
  }),
  fps: 24,
  dimensions: { width: 1280, height: 720 },
  supportedDimensions: [
    { width: 1280, height: 720 },
    { width: 600, height: 600 },
  ],
  duration: (input) => input.duration,
  assets: [],
  fixtures: [
    {
      id: "proof",
      name: "Frame proof",
      input: { label: "Exact", duration: 48 },
      checkpoints: [{ label: "middle", frame: 23 }],
    },
  ],
  compatibility: { mode: "initial" },
  component: ({ input, frame, fps, durationInFrames, width, height }) => (
    <div data-root="arbitrary-react-root">
      {`${input.label}:${frame}:${fps}:${durationInFrames}:${width}x${height}`}
    </div>
  ),
});

const theme: ChannelTheme = { colors: {}, fonts: {}, spacing: {} };
const input = definition.fixtures[0]!.input;

function ordinaryFrame() {
  return (
    <VideoComponentFrame
      assets={{}}
      definition={definition}
      dimensions={{ width: 1280, height: 720 }}
      durationInFrames={48}
      frame={23}
      input={input}
      theme={theme}
    />
  );
}

function remotionFrame(durationInFrames = 48) {
  return (
    <RemotionVideoComponentFrame
      assets={{}}
      definition={definition}
      dimensions={{ width: 1280, height: 720 }}
      durationInFrames={durationInFrames}
      input={input}
      theme={theme}
    />
  );
}

describe("shared video component frame adapter", () => {
  beforeEach(() => {
    remotionHost.frame = 23;
    remotionHost.config = {
      fps: 24,
      width: 1280,
      height: 720,
      durationInFrames: 48,
    };
  });

  it("passes exact frame semantics to arbitrary React roots", () => {
    expect(renderToStaticMarkup(ordinaryFrame())).toBe(
      '<div data-root="arbitrary-react-root">Exact:23:24:48:1280x720</div>',
    );
  });

  it("exercises the Remotion host with the same semantics as the ordinary host", () => {
    expect(renderToStaticMarkup(remotionFrame())).toBe(
      renderToStaticMarkup(ordinaryFrame()),
    );
  });

  it("independently rejects caller duration mismatches after input validation", () => {
    remotionHost.config.durationInFrames = 47;
    expect(() => renderToStaticMarkup(remotionFrame(47))).toThrow(
      "Caller duration 47 does not match the validated frame-proof@1.0.0 duration 48.",
    );
  });

  it("rejects unsupported dimensions and mismatched Remotion configuration", () => {
    expect(() =>
      renderToStaticMarkup(
        <VideoComponentFrame
          assets={{}}
          definition={definition}
          dimensions={{ width: 720, height: 1280 }}
          durationInFrames={48}
          frame={23}
          input={input}
          theme={theme}
        />,
      ),
    ).toThrow("Dimensions 720x1280 are not supported");

    remotionHost.config.width = 600;
    expect(() => renderToStaticMarkup(remotionFrame())).toThrow(
      "Remotion composition config does not match frame-proof@1.0.0.",
    );
  });
});
