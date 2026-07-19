import { mkdir } from "node:fs/promises";

import type { Usage } from "@earendil-works/pi-ai";

import {
  InMemoryPiCredentialStore,
  parsePiCredentialJson,
  PiProviderBudget,
  piModelRuntimeOptions,
  installPiProviderBudget,
} from "./component-authoring/real-pi-agent.js";

export type DialogueMessage = {
  role: "user" | "assistant";
  content: string;
};
export type DialogueUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};
export type DialogueResult = DialogueUsage & {
  transitionBrief?: string;
};
export interface ComponentDialogueAgent {
  run(options: {
    history: readonly DialogueMessage[];
    onTextDelta: (delta: string) => Promise<void>;
    onSafeStatus: (status: string) => Promise<void>;
  }): Promise<DialogueResult>;
}

export class DeterministicFakeDialogueAgent implements ComponentDialogueAgent {
  async run({
    history,
    onTextDelta,
    onSafeStatus,
  }: Parameters<ComponentDialogueAgent["run"]>[0]) {
    const request = history.at(-1)?.content ?? "";
    const concrete =
      /\b(create|build|implement|make)\b/i.test(request) &&
      /\b(animated|chart|card|map|component|visual|lower third|subtitle)\b/i.test(
        request,
      );
    const answer = concrete
      ? "I have enough detail to begin. I’m starting the component implementation now."
      : /\b(hi|hello|who are you|how are you)\b/i.test(request)
        ? "Hi — I’m Relay, your component-building partner. We can talk through the visual, inputs, and animation first, and I’ll only start implementation when the brief is clear."
        : "Tell me what the component should communicate, what inputs it needs, and how you want it to move. I’ll ask questions until the implementation brief is clear.";
    await onSafeStatus("Formulating a response…");
    for (const word of answer.split(/(?<=\s)/)) {
      await onTextDelta(word);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return {
      ...(concrete ? { transitionBrief: request } : {}),
      inputTokens: Math.ceil(request.length / 4),
      outputTokens: Math.ceil(answer.length / 4),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };
  }
}

export class RealPiDialogueAgent implements ComponentDialogueAgent {
  constructor(
    private readonly modelSpec: string,
    private readonly sessionRoot: string,
    private readonly credentialJson: string | undefined,
  ) {}

  async run({
    history,
    onTextDelta,
    onSafeStatus,
  }: Parameters<ComponentDialogueAgent["run"]>[0]): Promise<DialogueResult> {
    if (process.env.AUTHORING_REAL_PI_ENABLED !== "true")
      throw new Error("Real Pi dialogue is disabled.");
    await mkdir(this.sessionRoot, { recursive: true, mode: 0o700 });
    const pi = await import("@earendil-works/pi-coding-agent");
    const { Type } = await import("typebox");
    const slash = this.modelSpec.indexOf("/");
    if (slash < 1) throw new Error("Dialogue model must be provider/model.");
    const provider = this.modelSpec.slice(0, slash);
    const modelId = this.modelSpec.slice(slash + 1);
    const credentials = new InMemoryPiCredentialStore(
      provider,
      parsePiCredentialJson(this.credentialJson),
    );
    const runtime = await pi.ModelRuntime.create(
      piModelRuntimeOptions(credentials),
    );
    const resolved = runtime.getModel(provider, modelId);
    if (!resolved)
      throw new Error(
        `Configured dialogue model ${this.modelSpec} is unavailable.`,
      );
    const model = { ...resolved };
    const budget = new PiProviderBudget(
      {
        maxModelTurns: 2,
        maxTokens: 8_000,
        maxCostUsd: 0.15,
        priorModelTurns: 0,
        priorInputTokens: 0,
        priorOutputTokens: 0,
        priorCacheReadTokens: 0,
        priorCacheWriteTokens: 0,
        priorCostUsd: 0,
      },
      Math.min(resolved.maxTokens, 4_000),
    );
    installPiProviderBudget(runtime, budget);
    const settings = pi.SettingsManager.inMemory({
      defaultProvider: provider,
      defaultModel: modelId,
      defaultThinkingLevel: "low",
    });
    const loader = new pi.DefaultResourceLoader({
      cwd: this.sessionRoot,
      agentDir: this.sessionRoot,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: dialogueSystemPrompt(),
    });
    await loader.reload();
    let transitionBrief: string | undefined;
    const begin = pi.defineTool({
      name: "begin_component_implementation",
      label: "Begin component implementation",
      description:
        "Hand an actionable component brief to Relay's isolated authoring worker. Call only after the creator's intent is sufficiently clear.",
      parameters: Type.Object({
        brief: Type.String({ minLength: 10, maxLength: 8_000 }),
      }),
      execute: async (_id, params) => {
        transitionBrief = params.brief.trim();
        await onSafeStatus("Starting component implementation…");
        return {
          content: [
            {
              type: "text" as const,
              text: "Relay accepted the brief and queued isolated component authoring.",
            },
          ],
          details: {},
        };
      },
    });
    const { session } = await pi.createAgentSession({
      cwd: this.sessionRoot,
      agentDir: this.sessionRoot,
      modelRuntime: runtime,
      model,
      thinkingLevel: "low",
      tools: ["begin_component_implementation"],
      noTools: "builtin",
      customTools: [begin],
      resourceLoader: loader,
      sessionManager: pi.SessionManager.inMemory(this.sessionRoot),
      settingsManager: settings,
    });
    let writes = Promise.resolve();
    const enqueue = (operation: () => Promise<void>) => {
      writes = writes.then(operation);
    };
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta" && update.delta && !transitionBrief)
          enqueue(() => onTextDelta(update.delta));
        if (update.type === "thinking_start")
          enqueue(() => onSafeStatus("Thinking through your request…"));
        if (update.type === "thinking_end")
          enqueue(() => onSafeStatus("Preparing a response…"));
      }
      if (event.type === "message_end" && event.message.role === "assistant")
        budget.recordResponse(event.message.usage as Usage);
    });
    try {
      const transcript = history
        .slice(-20)
        .map(
          (message) =>
            `${message.role === "user" ? "Creator" : "Relay"}: ${message.content}`,
        )
        .join("\n\n");
      await session.prompt(
        `Continue this Relay conversation. Respond to the final creator message.\n\n${transcript}`,
        { expandPromptTemplates: false },
      );
      await writes;
      return {
        ...budget.usage,
        ...(transitionBrief ? { transitionBrief } : {}),
      };
    } finally {
      unsubscribe();
      await writes;
      session.dispose();
    }
  }
}

function dialogueSystemPrompt(): string {
  return [
    "You are Relay, a collaborative specialist for designing reusable programmatic video components.",
    "This is a lightweight conversation. You do not have component source, SDK documentation, filesystem, shell, network, or implementation tools.",
    "Answer greetings and product questions normally. Never start a component for a greeting or unrelated conversation.",
    "Discuss the creator's goal and ask concise clarifying questions when the visual, data inputs, states, or animation are ambiguous.",
    "Do not repeatedly ask for details that are already clear. Make reasonable creative suggestions.",
    "When the conversation contains an actionable component brief, first tell the creator that you have enough information and are starting implementation, then call begin_component_implementation with a self-contained brief.",
    "The handoff queues isolated implementation and independent validation; never claim a component is already built or approved.",
    "Keep ordinary responses concise and natural.",
  ].join("\n");
}
