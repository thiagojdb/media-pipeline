import {
  resolveVideoComponentDuration,
  validateVideoComponentInput,
  VideoComponentContractError,
  type ChannelTheme,
  type DefinedVideoComponent,
  type ResolvedAsset,
  type VideoDimensions,
} from "@relay/component-sdk";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { z } from "zod";

export function compositionFrameAtTime(timeMs: number, fps: number): number {
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    throw new Error("Composition time must be a non-negative finite number.");
  }
  if (!Number.isSafeInteger(fps) || fps <= 0) {
    throw new Error("Composition FPS must be a positive integer.");
  }
  return Math.floor((timeMs * fps) / 1_000 + Number.EPSILON);
}

export function segmentFrameAtTime(
  timeMs: number,
  segmentStartMs: number,
  fps: number,
): number {
  return compositionFrameAtTime(Math.max(0, timeMs - segmentStartMs), fps);
}

export type ProjectTimelineSegment = {
  readonly id: string;
  readonly anchor: { readonly startMs: number; readonly endMs: number };
};

export type ProjectDraftRange = {
  readonly startMs: number;
  readonly endMs: number;
};

export type ProjectDraftFrame = {
  readonly outputFrame: number;
  readonly compositionTimeMs: number;
  readonly compositionFrame: number;
  readonly segment?: ProjectTimelineSegment;
  readonly segmentFrame?: number;
};

/**
 * Pins the exact frame plan shared by project preview and draft output. A
 * selected range only changes the output origin; component-local frames remain
 * anchored to their original composition segment.
 */
export function projectDraftFramePlan(
  segments: readonly ProjectTimelineSegment[],
  fps: number,
  range: ProjectDraftRange,
): {
  readonly durationInFrames: number;
  readonly frame: (outputFrame: number) => ProjectDraftFrame;
} {
  if (
    !Number.isSafeInteger(range.startMs) ||
    !Number.isSafeInteger(range.endMs) ||
    range.startMs < 0 ||
    range.endMs <= range.startMs
  ) {
    throw new Error("Project draft range must have valid millisecond bounds.");
  }
  const durationInFrames = Math.ceil(
    ((range.endMs - range.startMs) * fps) / 1_000,
  );
  compositionFrameAtTime(range.startMs, fps);
  return {
    durationInFrames,
    frame(outputFrame) {
      if (
        !Number.isSafeInteger(outputFrame) ||
        outputFrame < 0 ||
        outputFrame >= durationInFrames
      ) {
        throw new Error("Project draft frame is outside the selected range.");
      }
      const compositionTimeMs = Math.min(
        range.endMs - 1,
        range.startMs + (outputFrame * 1_000) / fps,
      );
      const segment = segments.find(
        ({ anchor }) =>
          anchor.startMs <= compositionTimeMs &&
          compositionTimeMs < anchor.endMs,
      );
      return {
        outputFrame,
        compositionTimeMs,
        compositionFrame: compositionFrameAtTime(compositionTimeMs, fps),
        ...(segment
          ? {
              segment,
              segmentFrame: segmentFrameAtTime(
                compositionTimeMs,
                segment.anchor.startMs,
                fps,
              ),
            }
          : {}),
      };
    },
  };
}

export interface VideoComponentFrameProps<Schema extends z.ZodObject> {
  readonly definition: DefinedVideoComponent<Schema>;
  readonly input: z.output<Schema>;
  readonly frame: number;
  readonly durationInFrames: number;
  readonly dimensions: VideoDimensions;
  readonly theme: ChannelTheme;
  readonly assets: Readonly<Record<string, ResolvedAsset>>;
}

/**
 * The single frame adapter shared by browser previews and Remotion rendering.
 * A host may scale the returned React root, but the component always receives
 * the exact selected pixel dimensions and zero-based frame.
 */
export function VideoComponentFrame<Schema extends z.ZodObject>({
  definition,
  input,
  frame,
  durationInFrames,
  dimensions,
  theme,
  assets,
}: VideoComponentFrameProps<Schema>) {
  assertSupportedDimensions(definition, dimensions);

  return definition.component({
    input,
    frame,
    fps: definition.fps,
    durationInFrames,
    width: dimensions.width,
    height: dimensions.height,
    theme,
    assets,
  });
}

export type RemotionVideoComponentFrameProps<Schema extends z.ZodObject> = Omit<
  VideoComponentFrameProps<Schema>,
  "frame"
>;

/** Remotion host for final rendering; preview uses VideoComponentFrame directly. */
export function RemotionVideoComponentFrame<Schema extends z.ZodObject>(
  props: RemotionVideoComponentFrameProps<Schema>,
) {
  const frame = useCurrentFrame();
  const config = useVideoConfig();
  const { definition, durationInFrames, dimensions } = props;
  const validatedInput = validateVideoComponentInput(
    definition.schema,
    props.input,
  );

  if (!validatedInput.success) {
    throw new VideoComponentContractError(validatedInput.issues);
  }

  const resolvedDuration = resolveVideoComponentDuration(
    definition,
    validatedInput.value,
  );
  if (durationInFrames !== resolvedDuration) {
    throw new Error(
      `Caller duration ${durationInFrames} does not match the validated ${definition.id}@${definition.version} duration ${resolvedDuration}.`,
    );
  }

  assertSupportedDimensions(definition, dimensions);
  if (
    config.fps !== definition.fps ||
    config.width !== dimensions.width ||
    config.height !== dimensions.height ||
    config.durationInFrames !== resolvedDuration
  ) {
    throw new Error(
      `Remotion composition config does not match ${definition.id}@${definition.version}.`,
    );
  }

  return (
    <VideoComponentFrame
      {...props}
      frame={frame}
      input={validatedInput.value}
    />
  );
}

function assertSupportedDimensions<Schema extends z.ZodObject>(
  definition: DefinedVideoComponent<Schema>,
  dimensions: VideoDimensions,
): void {
  if (
    !definition.supportedDimensions.some(
      (supported) =>
        supported.width === dimensions.width &&
        supported.height === dimensions.height,
    )
  ) {
    throw new Error(
      `Dimensions ${dimensions.width}x${dimensions.height} are not supported by ${definition.id}@${definition.version}.`,
    );
  }
}
