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
