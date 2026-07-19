import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { z } from "zod";

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
    private readonly repoRoot: string,
    private readonly authoringMode: "fake" | "real",
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
    const latestVersion = value.failureProbe
      ? undefined
      : await this.#latestApprovedVersion();
    if (latestVersion) {
      const userRequest =
        this.authoringMode === "fake"
          ? `[FAKE_LINE_CHART_REVISION] ${value.prompt}`
          : value.prompt;
      await this.#client.mutation(
        api.componentReview!.enqueueRevision as never,
        {
          workerToken: this.token,
          versionId: latestVersion.id,
          threadId,
          turnId,
          userRequest,
          acceptanceCriteria: [
            "Revise the latest approved animated line chart for this request.",
            "Declare a new semantic version and preserve existing inputs.",
            "Use the supplied channel theme and pass independent validation.",
          ],
          channelThemeJson: JSON.stringify(value.theme),
          assetsMetadataJson: "{}",
          ...this.#budgets(),
        } as never,
      );
      return { channelId, threadId };
    }
    const sourcePath = path.join(
      this.repoRoot,
      "packages/reference-components/src/line-chart.tsx",
    );
    const source = `${(await readFile(sourcePath, "utf8")).trimEnd()}\nexport default lineChart;\n`;
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
          "Implement an animated line chart as a valid Relay video component.",
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

  status(threadId: string): Promise<unknown> {
    return this.#client.query(
      api.componentLoop!.status as never,
      {
        workerToken: this.token,
        channelId,
        threadId: bounded(threadId, "threadId", 200),
      } as never,
    );
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
        versionId: z.string().min(1).max(200),
        prompt: z.string().trim().min(1).max(8_000),
        theme: themeSchema,
      })
      .parse(input);
    const turnId = `revision-${randomUUID()}`;
    const userRequest =
      this.authoringMode === "fake"
        ? `[FAKE_LINE_CHART_REVISION] ${value.prompt}`
        : value.prompt;
    await this.#client.mutation(
      api.componentReview!.enqueueRevision as never,
      {
        workerToken: this.token,
        versionId: value.versionId,
        threadId: bounded(threadId, "threadId", 200),
        turnId,
        userRequest,
        acceptanceCriteria: [
          "Use the channel accent for the primary line.",
          "Keep existing inputs compatible and preserve optional draw animation.",
        ],
        channelThemeJson: JSON.stringify(value.theme),
        assetsMetadataJson: "{}",
        ...this.#budgets(),
      } as never,
    );
    return { turnId };
  }

  #budgets() {
    return {
      maxWallTimeMs: 120_000,
      maxModelTurns: 6,
      maxToolCalls: 20,
      maxTokens: this.authoringMode === "real" ? 60_000 : 12_000,
      maxCostUsd: 1,
    };
  }

  async #latestApprovedVersion(): Promise<{ id: string } | undefined> {
    const versions = (await this.#client.query(
      api.componentReview!.listVersions as never,
      {
        workerToken: this.token,
        channelId,
        componentId: "animated-line-chart",
      } as never,
    )) as Array<{ _id: string }>;
    const latest = versions.at(-1);
    return latest ? { id: String(latest._id) } : undefined;
  }
}

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
