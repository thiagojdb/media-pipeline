import {
  channelThemeSchema,
  componentIdPattern,
  type ChannelTheme,
  type VideoDimensions,
} from "@relay/component-sdk";
import { z } from "zod";

export const draftRenderQualitySchema = z
  .object({
    codec: z.literal("h264"),
    crf: z.number().int().min(18).max(35),
    pixelFormat: z.literal("yuv420p"),
  })
  .strict();

export const draftRenderRequestSchema = z
  .object({
    componentId: z.string().regex(componentIdPattern),
    version: z.string().min(1),
    fixtureId: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    fps: z.number().int().positive(),
    durationInFrames: z.number().int().positive(),
    dimensions: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    theme: channelThemeSchema,
    quality: draftRenderQualitySchema,
  })
  .strict();

export type DraftRenderRequest = z.infer<typeof draftRenderRequestSchema>;

export interface PinnedDraftRenderRequest extends DraftRenderRequest {
  readonly input: Readonly<Record<string, unknown>>;
  readonly theme: ChannelTheme;
  readonly dimensions: VideoDimensions;
}

export type DraftRenderState =
  "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface DraftRenderSnapshot {
  readonly id: string;
  readonly state: DraftRenderState;
  readonly progress: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly component: {
    readonly id: string;
    readonly version: string;
    readonly fixtureId: string;
  };
  readonly settings: {
    readonly fps: number;
    readonly durationInFrames: number;
    readonly dimensions: VideoDimensions;
    readonly quality: DraftRenderRequest["quality"];
  };
  readonly reproducibilityKey: string;
  readonly output?: {
    readonly href: string;
    readonly mediaType: "video/mp4";
    readonly sizeBytes: number;
    readonly contentHash: string;
    readonly visualFingerprint: string;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface DraftRenderExecutionResult {
  readonly outputPath: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly visualFingerprint: string;
}

export interface DraftRenderExecutionHooks {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: number) => void;
}

export interface DraftRenderExecutor {
  execute(
    request: PinnedDraftRenderRequest,
    outputPath: string,
    hooks: DraftRenderExecutionHooks,
  ): Promise<DraftRenderExecutionResult>;
}
