import { createHash, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { z } from "zod";

import { buildCandidatePreviewHtml } from "./candidate-preview.js";
import type { ComponentDialogueAgent } from "./component-dialogue-agent.js";

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
  readonly #activeDialogue = new Set<string>();

  constructor(
    url: string,
    private readonly token: string,
    private readonly authoringMode: "fake" | "real",
    private readonly modelSpec?: string,
    private readonly dialogueAgent?: ComponentDialogueAgent,
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
    const userMessageId = `message-${randomUUID()}`;
    const assistantMessageId = `message-${randomUUID()}`;
    await this.#client.mutation(
      api.componentConversation!.start as never,
      {
        workerToken: this.token,
        channelId,
        threadId,
        userMessageId,
        assistantMessageId,
        content: value.prompt,
        themeJson: JSON.stringify(value.theme),
      } as never,
    );
    if (value.failureProbe) {
      await this.#completeDialogueWithoutModel(
        threadId,
        assistantMessageId,
        "Starting the deterministic recovery probe.",
        `[FAKE_TOKEN_LIMIT] ${value.prompt}`,
      );
      await this.#beginInitial(
        threadId,
        `[FAKE_TOKEN_LIMIT] ${value.prompt}`,
        value.theme,
      );
    } else {
      this.#launchDialogue(threadId, assistantMessageId, value.theme);
    }
    return { channelId, threadId };
  }

  async send(threadId: string, input: unknown): Promise<{ messageId: string }> {
    const value = z
      .object({
        prompt: z.string().trim().min(1).max(8_000),
        theme: themeSchema,
      })
      .parse(input);
    const userMessageId = `message-${randomUUID()}`;
    const assistantMessageId = `message-${randomUUID()}`;
    await this.#client.mutation(
      api.componentConversation!.addTurn as never,
      {
        workerToken: this.token,
        channelId,
        threadId: bounded(threadId, "threadId", 200),
        userMessageId,
        assistantMessageId,
        content: value.prompt,
        themeJson: JSON.stringify(value.theme),
      } as never,
    );
    this.#launchDialogue(threadId, assistantMessageId, value.theme);
    return { messageId: assistantMessageId };
  }

  async status(threadId: string): Promise<unknown> {
    const [status, conversation] = (await Promise.all([
      this.#client.query(
        api.componentLoop!.status as never,
        {
          workerToken: this.token,
          channelId,
          threadId: bounded(threadId, "threadId", 200),
        } as never,
      ),
      this.#client.query(
        api.componentConversation!.get as never,
        {
          workerToken: this.token,
          channelId,
          threadId: bounded(threadId, "threadId", 200),
        } as never,
      ),
    ])) as [
      Record<string, unknown>,
      { thread: { phase: string }; messages: unknown[] } | null,
    ];
    return {
      ...status,
      phase: conversation?.thread.phase ?? "dialogue",
      messages: conversation?.messages ?? [],
      authoringMode: this.authoringMode,
      model: this.authoringMode === "real" ? this.modelSpec : undefined,
    };
  }

  #launchDialogue(
    threadId: string,
    assistantMessageId: string,
    theme: z.infer<typeof themeSchema>,
  ) {
    if (this.#activeDialogue.has(threadId)) return;
    this.#activeDialogue.add(threadId);
    void this.#processDialogue(threadId, assistantMessageId, theme)
      .catch(async (error) => {
        await this.#client
          .mutation(
            api.componentConversation!.fail as never,
            {
              workerToken: this.token,
              channelId,
              threadId,
              messageId: assistantMessageId,
              message:
                error instanceof Error
                  ? error.message
                  : "Dialogue failed safely.",
            } as never,
          )
          .catch(() => undefined);
      })
      .finally(() => this.#activeDialogue.delete(threadId));
  }

  async #processDialogue(
    threadId: string,
    assistantMessageId: string,
    theme: z.infer<typeof themeSchema>,
  ) {
    if (!this.dialogueAgent)
      throw new Error("Component dialogue is not configured.");
    const conversation = (await this.#client.query(
      api.componentConversation!.get as never,
      { workerToken: this.token, channelId, threadId } as never,
    )) as { messages: Array<{ role: "user" | "assistant"; content: string }> };
    const result = await this.dialogueAgent.run({
      history: conversation.messages
        .filter((message) => message.content)
        .map(({ role, content }) => ({ role, content })),
      onTextDelta: async (delta) => {
        await this.#client.mutation(
          api.componentConversation!.appendDelta as never,
          {
            workerToken: this.token,
            channelId,
            threadId,
            messageId: assistantMessageId,
            delta,
          } as never,
        );
      },
      onSafeStatus: async (safeStatus) => {
        await this.#client.mutation(
          api.componentConversation!.appendDelta as never,
          {
            workerToken: this.token,
            channelId,
            threadId,
            messageId: assistantMessageId,
            delta: "",
            safeStatus,
          } as never,
        );
      },
    });
    await this.#client.mutation(
      api.componentConversation!.complete as never,
      {
        workerToken: this.token,
        channelId,
        threadId,
        messageId: assistantMessageId,
        transitionBrief: result.transitionBrief,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheWriteTokens: result.cacheWriteTokens,
        costUsd: result.costUsd,
      } as never,
    );
    if (result.transitionBrief)
      await this.#beginImplementation(threadId, result.transitionBrief, theme);
  }

  async #completeDialogueWithoutModel(
    threadId: string,
    messageId: string,
    content: string,
    transitionBrief: string,
  ) {
    await this.#client.mutation(
      api.componentConversation!.appendDelta as never,
      {
        workerToken: this.token,
        channelId,
        threadId,
        messageId,
        delta: content,
      } as never,
    );
    await this.#client.mutation(
      api.componentConversation!.complete as never,
      {
        workerToken: this.token,
        channelId,
        threadId,
        messageId,
        transitionBrief,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      } as never,
    );
  }

  async #beginImplementation(
    threadId: string,
    brief: string,
    theme: z.infer<typeof themeSchema>,
  ) {
    const status = (await this.#client.query(
      api.componentLoop!.status as never,
      {
        workerToken: this.token,
        channelId,
        threadId,
      } as never,
    )) as {
      candidates: Array<{ id: string; status: string }>;
      versions: Array<{ id: string }>;
    };
    const candidate = status.candidates
      .filter((item) =>
        ["reviewable", "changes_requested"].includes(item.status),
      )
      .at(-1);
    const version = status.versions.at(-1);
    if (candidate || version) {
      await this.revise(threadId, {
        ...(candidate
          ? { candidateId: candidate.id }
          : { versionId: version!.id }),
        prompt: brief,
        theme,
      });
      return;
    }
    await this.#beginInitial(threadId, brief, theme);
  }

  async #beginInitial(
    threadId: string,
    brief: string,
    theme: z.infer<typeof themeSchema>,
  ) {
    const turnId = `turn-${randomUUID()}`;
    const source = starterComponentSource;
    const userRequest =
      this.authoringMode === "fake" && !brief.startsWith("[FAKE_")
        ? `[FAKE_LINE_CHART_INITIAL] ${brief}`
        : brief;
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
        channelThemeJson: JSON.stringify(theme),
        assetsMetadataJson: "{}",
        ...this.#budgets(),
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
