import { mkdir } from "node:fs/promises";

import type {
  Credential,
  CredentialInfo,
  CredentialStore,
  Usage,
} from "@earendil-works/pi-ai";
import type {
  CreateModelRuntimeOptions,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

import { AuthoringBudgetExceededError } from "./tools.js";
import type { AuthoringAgent, AgentRunResult, AuthoringTurn } from "./types.js";

export const REAL_PI_TOOL_ALLOWLIST = [
  "read_authoring_context",
  "replace_candidate_source",
  "check_candidate",
  "declare_candidate_ready",
] as const;
export const REAL_PI_EXCLUDED_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export class RealPiAuthoringAgent implements AuthoringAgent {
  constructor(
    private readonly modelSpec: string,
    private readonly sessionRoot: string,
    private readonly credentialJson: string | undefined,
  ) {}

  async run({
    turn,
    workspace,
    tools,
    signal,
    onUsage,
  }: Parameters<AuthoringAgent["run"]>[0]): Promise<AgentRunResult> {
    assertRealPiActivation(turn, this.modelSpec);
    throwIfAborted(signal);
    if (
      turn.priorModelTurns >= turn.maxModelTurns ||
      totalTokens(turn) >= turn.maxTokens ||
      turn.priorCostUsd >= turn.maxCostUsd ||
      turn.priorWallTimeMs >= turn.maxWallTimeMs
    )
      return exhaustedBeforeProvider(turn);
    const started = Date.now();
    await mkdir(this.sessionRoot, { recursive: true, mode: 0o700 });
    const pi = await import("@earendil-works/pi-coding-agent");
    throwIfAborted(signal);
    const { Type } = await import("typebox");
    const slash = this.modelSpec.indexOf("/");
    if (slash < 1)
      throw new Error("AUTHORING_PI_MODEL must be provider/model.");
    const provider = this.modelSpec.slice(0, slash);
    const modelId = this.modelSpec.slice(slash + 1);
    const credentials = new InMemoryPiCredentialStore(
      provider,
      parsePiCredentialJson(this.credentialJson),
    );
    const modelRuntime = await pi.ModelRuntime.create(
      piModelRuntimeOptions(credentials),
    );
    const resolvedModel = modelRuntime.getModel(provider, modelId);
    if (!resolvedModel)
      throw new Error(`Configured Pi model ${this.modelSpec} is unavailable.`);
    const model = { ...resolvedModel };
    const budget = new PiProviderBudget(turn, resolvedModel.maxTokens);
    installPiProviderBudget(modelRuntime, budget);

    const settings = pi.SettingsManager.inMemory({
      defaultProvider: provider,
      defaultModel: modelId,
      defaultThinkingLevel: "medium",
    });
    const loader = new pi.DefaultResourceLoader({
      cwd: workspace.root,
      agentDir: this.sessionRoot,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: authoringSystemPrompt(),
    });
    await loader.reload();
    const sessionManager = await sessionManagerFor(
      pi.SessionManager,
      workspace.root,
      this.sessionRoot,
      turn.sessionRef,
    );
    const customTools = [
      pi.defineTool({
        name: "read_authoring_context",
        label: "Read authoring context",
        description: "Read the complete Relay-owned context pack.",
        parameters: Type.Object({}),
        execute: async () => textResult(await tools.readContext()),
      }),
      pi.defineTool({
        name: "replace_candidate_source",
        label: "Replace candidate source",
        description: "Replace candidate-source.tsx with complete source.",
        parameters: Type.Object({ source: Type.String() }),
        execute: async (_id, params) =>
          textResult(await tools.replaceCandidate(params.source)),
      }),
      pi.defineTool({
        name: "check_candidate",
        label: "Check candidate",
        description:
          "Check syntax and source policy without executing candidate code.",
        parameters: Type.Object({}),
        execute: async () => textResult(await tools.checkCandidate()),
      }),
      pi.defineTool({
        name: "declare_candidate_ready",
        label: "Declare candidate ready",
        description:
          "Declare a checked candidate ready for independent validation, not approval.",
        parameters: Type.Object({ summary: Type.String() }),
        execute: async (_id, params) =>
          textResult(await tools.declareReady(params.summary)),
      }),
    ];
    throwIfAborted(signal);
    const { session } = await pi.createAgentSession({
      cwd: workspace.root,
      agentDir: this.sessionRoot,
      modelRuntime,
      model,
      thinkingLevel: "medium",
      tools: [...REAL_PI_TOOL_ALLOWLIST],
      noTools: "builtin",
      excludeTools: [...REAL_PI_EXCLUDED_TOOLS],
      customTools,
      resourceLoader: loader,
      sessionManager,
      settingsManager: settings,
    });

    let budgetExceeded = false;
    let usageWrites = Promise.resolve();
    const persistUsage = () => {
      const usage = {
        toolCalls: tools.toolCalls,
        ...budget.usage,
        wallTimeMs: turn.priorWallTimeMs + (Date.now() - started),
      };
      usageWrites = usageWrites
        .then(() => onUsage(usage))
        .catch(() => {
          budgetExceeded = true;
          void session.abort();
        });
    };
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        budget.recordResponse(event.message.usage);
        persistUsage();
        if (budget.exhausted) {
          budgetExceeded = true;
          void session.abort();
        }
      }
    });
    const abort = () => void session.abort();
    signal.addEventListener("abort", abort, { once: true });
    const initialMessageCount = session.messages.length;
    const currentResult = (): AgentRunResult => {
      const hadCurrentAssistantText = Boolean(
        assistantText(session.messages.slice(initialMessageCount)).trim(),
      );
      const summary = tools.declaredReady
        ? "Pi authored and declared a candidate ready for independent validation."
        : hadCurrentAssistantText
          ? "Pi returned without declaring a candidate ready."
          : "Pi authoring ended without a current-turn assistant response.";
      return {
        status: signal.aborted
          ? "canceled"
          : budgetExceeded || tools.budgetExceeded
            ? "budget_exhausted"
            : tools.declaredReady
              ? "candidate_ready"
              : "failed",
        code: signal.aborted
          ? "authoring_canceled"
          : budgetExceeded || tools.budgetExceeded
            ? "pi_budget_exhausted"
            : tools.declaredReady
              ? "candidate_ready"
              : "candidate_not_declared_ready",
        message: tools.declaredReady
          ? "Pi declared a candidate ready for independent validation."
          : "Pi stopped without a valid candidate declaration.",
        assistantSummary: summary,
        sessionRef: `pi:${session.sessionId}`,
        toolCalls: tools.toolCalls,
        ...budget.usage,
        wallTimeMs: turn.priorWallTimeMs + (Date.now() - started),
      };
    };
    try {
      throwIfAborted(signal);
      await session.prompt(
        "Read the Relay authoring context, implement the requested candidate using only Relay tools, check it, and call declare_candidate_ready. Your completion message has no validation or approval authority.",
        { expandPromptTemplates: false },
      );
      await usageWrites;
      return currentResult();
    } catch (error) {
      await usageWrites;
      if (!signal.aborted && (budgetExceeded || tools.budgetExceeded))
        return currentResult();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
      await usageWrites;
      session.dispose();
    }
  }
}

export class InMemoryPiCredentialStore implements CredentialStore {
  private credential: Credential | undefined;
  private modification = Promise.resolve();

  constructor(
    private readonly provider: string,
    credential: Credential,
  ) {
    this.credential = structuredClone(credential);
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return providerId === this.provider && this.credential
      ? structuredClone(this.credential)
      : undefined;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return this.credential
      ? [{ providerId: this.provider, type: this.credential.type }]
      : [];
  }

  async delete(providerId: string): Promise<void> {
    const operation = this.modification.then(() => {
      if (providerId === this.provider) this.credential = undefined;
    });
    this.modification = operation.catch(() => undefined);
    await operation;
  }

  async modify(
    providerId: string,
    update: (
      current: Credential | undefined,
    ) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    let result: Credential | undefined;
    const operation = this.modification.then(async () => {
      if (providerId !== this.provider) return;
      const next = await update(
        this.credential ? structuredClone(this.credential) : undefined,
      );
      if (next) this.credential = structuredClone(next);
      result = structuredClone(this.credential);
    });
    this.modification = operation.catch(() => undefined);
    await operation;
    return result;
  }
}

export function parsePiCredentialJson(value: string | undefined): Credential {
  if (!value)
    throw new Error(
      "Real Pi requires server-only AUTHORING_PI_CREDENTIAL_JSON.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("AUTHORING_PI_CREDENTIAL_JSON must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("AUTHORING_PI_CREDENTIAL_JSON is not a credential.");
  const credential = parsed as Record<string, unknown>;
  if (credential.type === "api_key") {
    if (typeof credential.key !== "string" || credential.key.length === 0)
      throw new Error("Pi API-key credential requires a non-empty key.");
    if (
      credential.env !== undefined &&
      (!credential.env ||
        typeof credential.env !== "object" ||
        Array.isArray(credential.env) ||
        Object.values(credential.env).some((item) => typeof item !== "string"))
    )
      throw new Error("Pi API-key credential env values must be strings.");
    return structuredClone(parsed as Credential);
  }
  if (credential.type === "oauth") {
    if (
      typeof credential.access !== "string" ||
      typeof credential.refresh !== "string" ||
      typeof credential.expires !== "number" ||
      !Number.isFinite(credential.expires)
    )
      throw new Error("Pi OAuth credential is incomplete.");
    return structuredClone(parsed as Credential);
  }
  throw new Error("Pi credential type must be api_key or oauth.");
}

export function piModelRuntimeOptions(
  credentials: CredentialStore,
): CreateModelRuntimeOptions {
  return {
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
  };
}

interface PiBudgetUsage {
  readonly modelTurns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
}

export class PiProviderBudget {
  private modelTurns: number;
  private inputTokens: number;
  private outputTokens: number;
  private cacheReadTokens: number;
  private cacheWriteTokens: number;
  private costUsd: number;

  constructor(
    private readonly turn: Pick<
      AuthoringTurn,
      | "maxModelTurns"
      | "maxTokens"
      | "maxCostUsd"
      | "priorModelTurns"
      | "priorInputTokens"
      | "priorOutputTokens"
      | "priorCacheReadTokens"
      | "priorCacheWriteTokens"
      | "priorCostUsd"
    >,
    private readonly modelTokenCeiling: number,
  ) {
    this.modelTurns = turn.priorModelTurns;
    this.inputTokens = turn.priorInputTokens;
    this.outputTokens = turn.priorOutputTokens;
    this.cacheReadTokens = turn.priorCacheReadTokens;
    this.cacheWriteTokens = turn.priorCacheWriteTokens;
    this.costUsd = turn.priorCostUsd;
  }

  get usage(): PiBudgetUsage {
    return {
      modelTurns: this.modelTurns,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      costUsd: this.costUsd,
    };
  }

  get exhausted(): boolean {
    return (
      this.modelTurns >= this.turn.maxModelTurns ||
      this.totalTokens >= this.turn.maxTokens ||
      this.costUsd >= this.turn.maxCostUsd
    );
  }

  beforeProviderRequest(model: { maxTokens: number }): void {
    const remainingTokens = this.turn.maxTokens - this.totalTokens;
    if (this.exhausted || remainingTokens <= 0)
      throw new AuthoringBudgetExceededError(
        "Durable Pi provider budget exhausted before request.",
      );
    model.maxTokens = Math.max(
      1,
      Math.min(this.modelTokenCeiling, remainingTokens),
    );
  }

  recordResponse(usage: Usage): void {
    this.modelTurns += 1;
    this.inputTokens += usage.input;
    this.outputTokens += usage.output;
    this.cacheReadTokens += usage.cacheRead;
    this.cacheWriteTokens += usage.cacheWrite;
    this.costUsd += usage.cost.total;
  }

  private get totalTokens(): number {
    return (
      this.inputTokens +
      this.outputTokens +
      this.cacheReadTokens +
      this.cacheWriteTokens
    );
  }
}

export function installPiProviderBudget(
  runtime: ModelRuntime,
  budget: PiProviderBudget,
): void {
  const streamSimple = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = ((model, context, options) => {
    budget.beforeProviderRequest(model);
    return streamSimple(model, context, options);
  }) as ModelRuntime["streamSimple"];
}

export function assertRealPiActivation(
  turn: Pick<
    Parameters<AuthoringAgent["run"]>[0]["turn"],
    | "maxWallTimeMs"
    | "maxModelTurns"
    | "maxToolCalls"
    | "maxTokens"
    | "maxCostUsd"
  >,
  modelSpec: string,
): void {
  if (process.env.AUTHORING_REAL_PI_ENABLED !== "true")
    throw new Error(
      "Real Pi is disabled; refusing to initialize ModelRuntime.",
    );
  if (!modelSpec || !modelSpec.includes("/"))
    throw new Error("An exact AUTHORING_PI_MODEL=provider/model is required.");
  if (
    turn.maxWallTimeMs > 120_000 ||
    turn.maxModelTurns > 6 ||
    turn.maxToolCalls > 16 ||
    turn.maxTokens > 60_000 ||
    turn.maxCostUsd > 1
  )
    throw new Error("Real Pi smoke budgets exceed the reviewed ceiling.");
}

export async function sessionManagerFor(
  SessionManager: (typeof import("@earendil-works/pi-coding-agent"))["SessionManager"],
  cwd: string,
  sessionRoot: string,
  sessionRef: string | undefined,
) {
  if (!sessionRef?.startsWith("pi:"))
    return SessionManager.create(cwd, sessionRoot);
  const id = sessionRef.slice(3);
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(id))
    return SessionManager.create(cwd, sessionRoot);
  try {
    const sessions = await SessionManager.listAll(sessionRoot);
    const match = sessions.find((session) => session.id === id);
    if (!match) return SessionManager.create(cwd, sessionRoot);
    return await SessionManager.open(match.path, sessionRoot, cwd);
  } catch {
    return SessionManager.create(cwd, sessionRoot);
  }
}
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
function assistantText(messages: readonly unknown[]): string {
  const text: string[] = [];
  for (const message of messages as Array<{
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>) {
    if (message.role !== "assistant" || !Array.isArray(message.content))
      continue;
    for (const content of message.content)
      if (content.type === "text" && content.text) text.push(content.text);
  }
  return text.join("\n");
}
function totalTokens(
  turn: Parameters<AuthoringAgent["run"]>[0]["turn"],
): number {
  return (
    turn.priorInputTokens +
    turn.priorOutputTokens +
    turn.priorCacheReadTokens +
    turn.priorCacheWriteTokens
  );
}
function exhaustedBeforeProvider(
  turn: Parameters<AuthoringAgent["run"]>[0]["turn"],
): AgentRunResult {
  return {
    status: "budget_exhausted",
    code: "pi_budget_exhausted",
    message:
      "The durable authoring budget was exhausted before a provider call.",
    assistantSummary: "No provider call was started.",
    sessionRef: turn.sessionRef,
    toolCalls: turn.priorToolCalls,
    modelTurns: turn.priorModelTurns,
    inputTokens: turn.priorInputTokens,
    outputTokens: turn.priorOutputTokens,
    cacheReadTokens: turn.priorCacheReadTokens,
    cacheWriteTokens: turn.priorCacheWriteTokens,
    costUsd: turn.priorCostUsd,
    wallTimeMs: turn.priorWallTimeMs,
  };
}
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new Error("Authoring aborted before provider call.");
}
function authoringSystemPrompt(): string {
  return [
    "You author one Relay video component candidate.",
    "Only use the four Relay-owned tools supplied to you.",
    "Do not request shell, filesystem, network, environment, extensions, skills, templates, themes, or context files.",
    "Read the context first. Replace the complete candidate source, check it, then explicitly declare it ready.",
    "A declaration only queues independent validation. It never approves or promotes a version.",
  ].join("\n");
}
