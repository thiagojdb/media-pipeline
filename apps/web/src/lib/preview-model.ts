import type { ContractIssue, VideoDimensions } from "@relay/component-sdk";

export function clampFrame(frame: number, durationInFrames: number): number {
  if (!Number.isFinite(frame) || durationInFrames <= 0) return 0;
  return Math.min(durationInFrames - 1, Math.max(0, Math.round(frame)));
}

export function stepFrame(
  frame: number,
  direction: -1 | 1,
  durationInFrames: number,
): number {
  return clampFrame(frame + direction, durationInFrames);
}

export function playbackStartFrame(
  frame: number,
  durationInFrames: number,
): number {
  const clamped = clampFrame(frame, durationInFrames);
  return clamped >= durationInFrames - 1 ? 0 : clamped;
}

export function playbackFrameAtElapsedTime(
  startFrame: number,
  elapsedMilliseconds: number,
  fps: number,
  durationInFrames: number,
): { readonly frame: number; readonly complete: boolean } {
  const elapsedFrames =
    Number.isFinite(elapsedMilliseconds) && elapsedMilliseconds > 0 && fps > 0
      ? Math.floor((elapsedMilliseconds * fps) / 1000)
      : 0;
  const frame = clampFrame(startFrame + elapsedFrames, durationInFrames);
  return { frame, complete: frame >= durationInFrames - 1 };
}

export function checkpointFrame(
  frame: number,
  durationInFrames: number,
): number {
  return clampFrame(frame, durationInFrames);
}

export function fitStageScale(
  stage: VideoDimensions,
  viewport: VideoDimensions,
): number {
  if (
    stage.width <= 0 ||
    stage.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return 0;
  }
  return Math.min(viewport.width / stage.width, viewport.height / stage.height);
}

export function formatIssuePath(path: readonly (number | string)[]): string {
  if (path.length === 0) return "input";
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number" || /^\d+$/.test(segment)) {
      return `${result}[${segment}]`;
    }
    return result.length === 0 ? String(segment) : `${result}.${segment}`;
  }, "");
}

export function jsonSyntaxIssue(path: string, error: unknown): ContractIssue {
  return {
    code: "input_invalid",
    path: [path],
    message: `Enter valid JSON. ${error instanceof Error ? error.message : String(error)}`,
  };
}
