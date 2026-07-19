import { createHash, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { z } from "zod";

import { buildCandidatePreviewHtml } from "./candidate-preview.js";

const api = anyApi as Record<string, Record<string, unknown>>;
const channelId = "relay-local-channel";
const themeSchema = z.object({
  colors: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  fonts: z.object({ heading: z.string().trim().min(1).max(100) }),
  spacing: z.object({}).optional().default({}),
});

export class ComponentLoopRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class ComponentLoopService {
  readonly #client: ConvexHttpClient;

  constructor(
    url: string,
    private readonly token: string,
    private readonly authoringMode: "fake" | "real",
    private readonly modelSpec?: string,
  ) {
    this.#client = new ConvexHttpClient(url);
  }

  async start(
    input: unknown,
  ): Promise<{ channelId: string; threadId: string }> {
    const value = z
      .object({
        prompt: z.string().trim().min(1).max(8_000),
        theme: themeSchema,
        failureProbe: z.boolean().optional().default(false),
      })
      .parse(input);
    const threadId = `loop-${randomUUID()}`;
    const turnId = `turn-${randomUUID()}`;
    const source = starterComponentSource;
    const userRequest =
      this.authoringMode === "fake"
        ? `${value.failureProbe ? "[FAKE_TOKEN_LIMIT] " : "[FAKE_LINE_CHART_INITIAL] "}${value.prompt}`
        : value.prompt;
    await this.#client.mutation(
      api.componentLoop!.start as never,
      {
        workerToken: this.token,
        channelId,
        threadId,
        turnId,
        userRequest,
        acceptanceCriteria: [
          "Implement the creator's requested reusable video component, rather than preserving unrelated starter behavior.",
          "Declare a descriptive kebab-case component id at semantic version 1.0.0.",
          "Provide representative validated fixtures and meaningful checkpoint frames.",
          "Use the supplied channel theme and pass independent validation.",
        ],
        baseSource: source,
        baseSourceHash: sha(source),
        channelThemeJson: JSON.stringify(value.theme),
        assetsMetadataJson: "{}",
        ...this.#budgets(),
      } as never,
    );
    return { channelId, threadId };
  }

  async status(threadId: string): Promise<unknown> {
    const status = (await this.#client.query(
      api.componentLoop!.status as never,
      {
        workerToken: this.token,
        channelId,
        threadId: bounded(threadId, "threadId", 200),
      } as never,
    )) as Record<string, unknown>;
    return {
      ...status,
      authoringMode: this.authoringMode,
      model: this.authoringMode === "real" ? this.modelSpec : undefined,
    };
  }

  async approve(candidateId: string): Promise<{ versionId: string }> {
    const versionId = await this.#client.mutation(
      api.componentReview!.approve as never,
      {
        workerToken: this.token,
        candidateId: bounded(candidateId, "candidateId", 200),
        note: "Approved in the creator component loop.",
        acknowledgeCompatibilityWarning: true,
      } as never,
    );
    return { versionId: String(versionId) };
  }

  async decide(
    candidateId: string,
    decision: "reject" | "requestChanges",
    input: unknown,
  ): Promise<{ ok: true }> {
    const { note } = z
      .object({ note: z.string().trim().min(1).max(2_000) })
      .parse(input);
    await this.#client.mutation(
      api.componentReview![decision] as never,
      {
        workerToken: this.token,
        candidateId: bounded(candidateId, "candidateId", 200),
        note,
      } as never,
    );
    return { ok: true };
  }

  async revise(threadId: string, input: unknown): Promise<{ turnId: string }> {
    const value = z
      .object({
        versionId: z.string().min(1).max(200).optional(),
        candidateId: z.string().min(1).max(200).optional(),
        prompt: z.string().trim().min(1).max(8_000),
        theme: themeSchema,
      })
      .refine((item) => Boolean(item.versionId) !== Boolean(item.candidateId), {
        message: "Select exactly one working candidate or approved version.",
      })
      .parse(input);
    const turnId = `revision-${randomUUID()}`;
    const userRequest =
      this.authoringMode === "fake"
        ? `[FAKE_LINE_CHART_REVISION] ${value.prompt}`
        : value.prompt;
    await this.#client.mutation(
      api.componentReview![
        value.candidateId ? "enqueueCandidateRevision" : "enqueueRevision"
      ] as never,
      {
        workerToken: this.token,
        ...(value.candidateId
          ? { candidateId: value.candidateId }
          : { versionId: value.versionId }),
        threadId: bounded(threadId, "threadId", 200),
        turnId,
        userRequest,
        acceptanceCriteria: [
          "Implement the creator's requested change in the exact selected component source.",
          "Declare a new semantic version and preserve existing inputs unless the request explicitly requires a breaking change.",
          "Keep representative fixtures and pass independent validation.",
        ],
        channelThemeJson: JSON.stringify(value.theme),
        assetsMetadataJson: "{}",
        ...this.#budgets(),
      } as never,
    );
    return { turnId };
  }

  async candidateSource(candidateId: string): Promise<string> {
    const artifact = await this.#candidateArtifact(candidateId);
    return artifact.sourceSnapshot;
  }

  async candidatePreview(
    candidateId: string,
    options: { fixtureId?: string; frame?: number; theme?: unknown },
  ): Promise<string> {
    const artifact = await this.#candidateArtifact(candidateId);
    return buildCandidatePreviewHtml(artifact, options);
  }

  async versionPreview(
    versionId: string,
    options: { fixtureId?: string; frame?: number; theme?: unknown },
  ): Promise<string> {
    const artifact = (await this.#client.query(
      api.componentReview!.getVersion as never,
      {
        workerToken: this.token,
        versionId: bounded(versionId, "versionId", 200),
      } as never,
    )) as {
      componentId: string;
      version: string;
      sourceHash: string;
      sourceSnapshot: string;
    } | null;
    if (!artifact)
      throw new ComponentLoopRequestError(
        "version_not_found",
        "Approved version was not found.",
        404,
      );
    return buildCandidatePreviewHtml(artifact, options);
  }

  #budgets() {
    return {
      maxWallTimeMs: 120_000,
      maxModelTurns: 6,
      maxToolCalls: this.authoringMode === "real" ? 16 : 20,
      maxTokens: this.authoringMode === "real" ? 100_000 : 12_000,
      maxCostUsd: 1,
    };
  }

  async #candidateArtifact(candidateId: string): Promise<{
    componentId: string;
    version: string;
    sourceHash: string;
    sourceSnapshot: string;
  }> {
    const artifact = (await this.#client.query(
      api.componentReview!.getCandidateArtifact as never,
      {
        workerToken: this.token,
        candidateId: bounded(candidateId, "candidateId", 200),
      } as never,
    )) as {
      componentId: string;
      version: string;
      sourceHash: string;
      sourceSnapshot: string;
    } | null;
    if (!artifact)
      throw new ComponentLoopRequestError(
        "candidate_not_found",
        "Validated candidate was not found.",
        404,
      );
    return artifact;
  }
}

const starterComponentSource = `import {defineVideoComponent, type VideoComponentProps} from "@relay/component-sdk";
import {z} from "zod";

const inputSchema = z.object({message: z.string().min(1).max(160)});
type Input = z.output<typeof inputSchema>;

function Starter({input, width, height, theme}: VideoComponentProps<Input>) {
  return <svg role="img" aria-label={input.message} viewBox={\`0 0 \${width} \${height}\`} width={width} height={height}>
    <rect width={width} height={height} fill={theme.colors.background ?? "#07111f"} />
    <text x={width / 2} y={height / 2} textAnchor="middle" fill={theme.colors.foreground ?? "#f8fafc"} fontSize={64}>
      {input.message}
    </text>
  </svg>;
}

export default defineVideoComponent({
  id: "starter-component",
  version: "1.0.0",
  schema: inputSchema,
  fps: 30,
  dimensions: {width: 1920, height: 1080},
  supportedDimensions: [{width: 1920, height: 1080}, {width: 960, height: 540}],
  duration: 120,
  assets: [],
  fixtures: [{id: "default", name: "Default", input: {message: "Replace this starter"}, checkpoints: [{label: "start", frame: 0}, {label: "end", frame: 119}]}],
  compatibility: {mode: "initial"},
  component: Starter,
});
`;

function bounded(value: string, name: string, maximum: number): string {
  if (!value || value.length > maximum)
    throw new ComponentLoopRequestError(
      "invalid_request",
      `${name} is invalid.`,
      400,
    );
  return value;
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
