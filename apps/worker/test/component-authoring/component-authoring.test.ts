import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, rm, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAssistantMessageEventStream,
  type Model,
  type Usage,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { buildAuthoringContext } from "../../src/component-authoring/context.js";
import { DeterministicFakeAuthoringAgent } from "../../src/component-authoring/fake-agent.js";
import { ComponentAuthoringLoop } from "../../src/component-authoring/loop.js";
import {
  assertRealPiActivation,
  InMemoryPiCredentialStore,
  installPiProviderBudget,
  parsePiCredentialJson,
  PiProviderBudget,
  piModelRuntimeOptions,
  REAL_PI_EXCLUDED_TOOLS,
  REAL_PI_TOOL_ALLOWLIST,
  sessionManagerFor,
} from "../../src/component-authoring/real-pi-agent.js";
import { ComponentAuthoringService } from "../../src/component-authoring/service.js";
import { InMemoryAuthoringTurnStore } from "../../src/component-authoring/store.js";
import { RelayAuthoringTools } from "../../src/component-authoring/tools.js";
import type {
  AuthoringAgent,
  AuthoringTurn,
} from "../../src/component-authoring/types.js";
import { AuthoringWorkspaceManager } from "../../src/component-authoring/workspace.js";

const roots: string[] = [];
const repositoryRoot = path.resolve(".");

afterEach(async () => {
  delete process.env.AUTHORING_REAL_PI_ENABLED;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("constrained component authoring", () => {
  it("runs the free fake-agent flow through Relay tools and atomically queues validation", async () => {
    const { store, loop, root } = await harness(
      turn("create", "Create a chart"),
    );
    await expect(loop.tick()).resolves.toBe(true);
    expect(store.turns.get("create")).toMatchObject({
      state: "candidate_submitted",
      sessionRef: "fake:thread-opaque",
    });
    expect(store.activities.map(({ name }) => name)).toEqual([
      "read_authoring_context",
      "replace_candidate_source",
      "check_candidate",
      "declare_candidate_ready",
    ]);
    expect(store.buildJobs.get("build:create")).toMatchObject({
      assistantSummary: expect.stringContaining("exact base source"),
      candidateSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await readdir(root)).toEqual([]);
  });

  it("creates deterministic context and binds exact revision lineage", async () => {
    const revision = turn("revision", "Make the line red", {
      parentCandidateId: "candidate-v1",
      baseSnapshotId: "snapshot-v1",
      priorSummaries: ["Created the original chart."],
    });
    const first = await buildAuthoringContext(revision, repositoryRoot);
    const second = await buildAuthoringContext(revision, repositoryRoot);
    expect(second.hash).toBe(first.hash);
    expect(first.pack.turn).toMatchObject({
      parentCandidateId: "candidate-v1",
      baseSnapshotId: "snapshot-v1",
    });
    expect(first.pack.priorSummaries).toEqual(["Created the original chart."]);
    expect(first.pack.references).toHaveProperty("component-sdk/README.md");
    expect(first.pack.references).toHaveProperty(
      "reference-components/src/line-chart.tsx",
    );
  });

  it.each([
    ["[FAKE_FAILURE]", "failed"],
    ["[FAKE_CANCEL]", "canceled"],
    ["[FAKE_TOKEN_LIMIT]", "needs_intervention"],
    ["[FAKE_TURN_LIMIT]", "needs_intervention"],
    ["[FAKE_COST_LIMIT]", "needs_intervention"],
    ["[FAKE_TOOL_LIMIT]", "needs_intervention"],
    ["[FAKE_TIMEOUT]", "needs_intervention"],
  ] as const)("handles bounded fixture %s as %s", async (marker, expected) => {
    const configured = turn(`fixture-${expected}-${marker}`, marker, {
      maxWallTimeMs: marker === "[FAKE_TIMEOUT]" ? 20 : 5_000,
      maxToolCalls: marker === "[FAKE_TOOL_LIMIT]" ? 2 : 8,
    });
    const { store, loop, root } = await harness(configured);
    await loop.tick();
    expect(store.turns.get(configured.id)?.state).toBe(expected);
    if (marker === "[FAKE_TOOL_LIMIT]") {
      expect(store.turns.get(configured.id)?.priorToolCalls).toBe(2);
      expect(store.activities.at(-1)).toMatchObject({
        status: "blocked_budget",
        outputSummary: "Authoring tool-call budget exhausted.",
      });
    }
    expect(store.buildJobs.size).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects malformed TypeScript before candidate declaration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-syntax-test-"));
    roots.push(root);
    const workspace = await new AuthoringWorkspaceManager(root).create(
      "{}",
      "export const safe = true;",
    );
    const tools = new RelayAuthoringTools(
      turn("syntax", "request"),
      workspace,
      new AbortController().signal,
      async () => undefined,
    );
    await tools.replaceCandidate("export const = ;");
    await expect(tools.checkCandidate()).rejects.toThrow();
    expect(tools.declaredReady).toBe(false);
    await workspace.remove();
  });

  it("does not start detached work after the wall-time signal", async () => {
    let providerCallStarted = false;
    const delayed: AuthoringAgent = {
      async run({ turn: claimed, signal }) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        if (!signal.aborted) providerCallStarted = true;
        return {
          status: "budget_exhausted",
          code: "wall_time_exhausted",
          message: "Stopped before provider call.",
          assistantSummary: "No provider call started.",
          toolCalls: claimed.priorToolCalls,
          modelTurns: claimed.priorModelTurns,
          inputTokens: claimed.priorInputTokens,
          outputTokens: claimed.priorOutputTokens,
          cacheReadTokens: claimed.priorCacheReadTokens,
          cacheWriteTokens: claimed.priorCacheWriteTokens,
          costUsd: claimed.priorCostUsd,
          wallTimeMs: claimed.maxWallTimeMs,
        };
      },
    };
    const configured = turn("early-timeout", "request", { maxWallTimeMs: 20 });
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-timeout-test-"));
    roots.push(root);
    const store = new InMemoryAuthoringTurnStore([configured]);
    const workerId = "timeout-worker";
    const service = new ComponentAuthoringService(
      store,
      new AuthoringWorkspaceManager(root),
      delayed,
      workerId,
      repositoryRoot,
    );
    const loop = new ComponentAuthoringLoop(
      store,
      service,
      workerId,
      5_000,
      10,
    );
    await loop.tick();
    expect(providerCallStarted).toBe(false);
    expect(store.turns.get(configured.id)?.state).toBe("needs_intervention");
  });

  it("carries durable usage across recovered attempts", async () => {
    const store = new InMemoryAuthoringTurnStore([
      turn("usage", "request", { maxAttempts: 2 }),
    ]);
    const first = await store.claim("worker", 5_000);
    await store.recordUsage("usage", "worker", first!.attempt, {
      toolCalls: 2,
      modelTurns: 1,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      costUsd: 0.05,
      wallTimeMs: 500,
    });
    store.turns.set("usage", {
      ...store.turns.get("usage")!,
      leaseExpiresAt: 1,
    });
    await store.recoverExpired(Date.now());
    const second = await store.claim("worker", 5_000);
    expect(second).toMatchObject({
      attempt: 2,
      priorToolCalls: 2,
      priorModelTurns: 1,
      priorInputTokens: 100,
      priorOutputTokens: 50,
      priorCostUsd: 0.05,
      priorWallTimeMs: 500,
    });
  });

  it("rejects base tampering and credential-like context", async () => {
    const tampered = turn("tampered", "request", {
      baseSourceHash: "0".repeat(64),
    });
    await expect(
      buildAuthoringContext(tampered, repositoryRoot),
    ).rejects.toThrow("base source hash");
    const credential = turn("credential", "request", {
      assetsMetadataJson: JSON.stringify({
        api_token: "must-not-enter-context",
      }),
    });
    await expect(
      buildAuthoringContext(credential, repositoryRoot),
    ).rejects.toThrow("credential-like field");
    const signedUrl = turn("signed-url", "request", {
      assetsMetadataJson: JSON.stringify({
        url: "https://assets.test/a?token=secret",
      }),
    });
    await expect(
      buildAuthoringContext(signedUrl, repositoryRoot),
    ).rejects.toThrow("credential-like value");
    const leakingRequest = turn(
      "leaking-request",
      "Please use sk-testsecret12345678 in the candidate.",
    );
    await expect(
      buildAuthoringContext(leakingRequest, repositoryRoot),
    ).rejects.toThrow("user request contains a credential-like value");
    const leakingSummary = turn("leaking-summary", "request", {
      priorSummaries: ["Previous attempt included token=abcdef."],
    });
    await expect(
      buildAuthoringContext(leakingSummary, repositoryRoot),
    ).rejects.toThrow("priorSummaries[0] contains a credential-like value");
  });

  it("keeps context read-only and rejects workspace symlink replacement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relay-workspace-test-"));
    roots.push(root);
    const manager = new AuthoringWorkspaceManager(root);
    const workspace = await manager.create("{}", "export const safe = true;");
    expect((await lstat(workspace.contextPath)).mode & 0o777).toBe(0o400);
    await unlink(workspace.candidatePath);
    await symlink("/etc/passwd", workspace.candidatePath);
    await expect(workspace.readCandidate()).rejects.toThrow("regular file");
    await expect(workspace.replaceCandidate("safe")).rejects.toThrow(
      "regular file",
    );
    await workspace.remove();
  });

  it("fences stale attempts and never publishes a canceled turn", async () => {
    const store = new InMemoryAuthoringTurnStore([
      turn("fenced", "request", { maxAttempts: 2 }),
    ]);
    const first = await store.claim("same-worker", 5_000);
    store.turns.set("fenced", {
      ...store.turns.get("fenced")!,
      leaseExpiresAt: 1,
    });
    await store.recoverExpired(Date.now());
    const second = await store.claim("same-worker", 5_000);
    expect(first?.attempt).toBe(1);
    expect(second?.attempt).toBe(2);
    await expect(
      store.heartbeat("fenced", "same-worker", first!.attempt, 5_000),
    ).resolves.toBe(false);
    store.turns.set("fenced", {
      ...store.turns.get("fenced")!,
      cancelRequested: true,
    });
    await expect(
      store.submitCandidate("fenced", "same-worker", second!.attempt, {
        candidateSource: "source",
        candidateSourceHash: sha("source"),
        contextHash: "1".repeat(64),
        assistantSummary: "summary",
        toolCalls: 1,
        modelTurns: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        wallTimeMs: 1,
      }),
    ).rejects.toThrow("Canceled or stale");
  });

  it("exposes only Relay-owned tools to real Pi", () => {
    expect(REAL_PI_TOOL_ALLOWLIST).toEqual([
      "read_authoring_context",
      "replace_candidate_source",
      "check_candidate",
      "declare_candidate_ready",
    ]);
    expect(REAL_PI_EXCLUDED_TOOLS).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
    ]);
  });

  it("falls back to a fresh Pi session when a stored session ref is invalid or unavailable", async () => {
    const create = async (cwd: string, sessionRoot: string) => ({
      mode: "create",
      cwd,
      sessionRoot,
    });
    const manager = {
      listAll: async () => [{ id: "valid-session", path: "/tmp/pi-session" }],
      open: async () => {
        throw new Error("stale session");
      },
      create,
    } as unknown as Parameters<typeof sessionManagerFor>[0];

    await expect(
      sessionManagerFor(manager, "/workspace", "/sessions", "pi:not/valid"),
    ).resolves.toEqual({
      mode: "create",
      cwd: "/workspace",
      sessionRoot: "/sessions",
    });
    await expect(
      sessionManagerFor(
        manager,
        "/workspace",
        "/sessions",
        "pi:missing-session",
      ),
    ).resolves.toEqual({
      mode: "create",
      cwd: "/workspace",
      sessionRoot: "/sessions",
    });
    await expect(
      sessionManagerFor(manager, "/workspace", "/sessions", "pi:valid-session"),
    ).resolves.toEqual({
      mode: "create",
      cwd: "/workspace",
      sessionRoot: "/sessions",
    });
  });

  it("guards createAgentSession's real streamSimple path across continuations", async () => {
    const configured = turn("provider-budget", "request", {
      maxModelTurns: 3,
      maxTokens: 1_000,
      maxCostUsd: 0.2,
      priorInputTokens: 100,
    });
    const budget = new PiProviderBudget(configured, 800);
    const harness = await budgetedPiSession(budget, [
      messageUsage(300, 100, 0.05),
      messageUsage(400, 100, 0.05),
    ]);
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant")
        budget.recordResponse(event.message.usage);
    });

    try {
      await harness.session.prompt("first request", {
        expandPromptTemplates: false,
      });
      await harness.session.prompt("continuation", {
        expandPromptTemplates: false,
      });
      expect(harness.providerCalls()).toBe(2);
      expect(harness.observedCaps).toEqual([800, 500]);
      expect(budget.usage).toMatchObject({
        modelTurns: 2,
        inputTokens: 800,
        outputTokens: 200,
        costUsd: 0.1,
      });

      await harness.session.prompt("blocked continuation", {
        expandPromptTemplates: false,
      });
      expect(harness.providerCalls()).toBe(2);
    } finally {
      unsubscribe();
      harness.session.dispose();
    }
  });

  it.each([
    {
      name: "turn",
      overrides: { maxModelTurns: 1 },
      usage: messageUsage(10, 10, 0.01),
    },
    {
      name: "token",
      overrides: { maxTokens: 100 },
      usage: messageUsage(50, 50, 0.01),
    },
    {
      name: "cost",
      overrides: { maxCostUsd: 0.05 },
      usage: messageUsage(10, 10, 0.05),
    },
  ])(
    "prevents another createAgentSession provider request after $name exhaustion",
    async ({ name, overrides, usage }) => {
      const configured = turn(`provider-${name}`, "request", overrides);
      const budget = new PiProviderBudget(configured, 800);
      const harness = await budgetedPiSession(budget, [usage]);
      const unsubscribe = harness.session.subscribe((event) => {
        if (event.type === "message_end" && event.message.role === "assistant")
          budget.recordResponse(event.message.usage);
      });

      try {
        await harness.session.prompt("first request", {
          expandPromptTemplates: false,
        });
        await harness.session.prompt("blocked continuation", {
          expandPromptTemplates: false,
        });
        expect(harness.providerCalls()).toBe(1);
      } finally {
        unsubscribe();
        harness.session.dispose();
      }
    },
  );

  it("uses only explicitly injected in-memory Pi credentials", async () => {
    const credential = parsePiCredentialJson(
      JSON.stringify({ type: "api_key", key: "server-only-test-key" }),
    );
    const store = new InMemoryPiCredentialStore("provider-test", credential);
    const options = piModelRuntimeOptions(store);

    expect(options).toEqual({
      credentials: store,
      modelsPath: null,
      allowModelNetwork: false,
    });
    expect(options).not.toHaveProperty("authPath");
    await expect(store.read("provider-test")).resolves.toEqual(credential);
    await expect(store.read("another-provider")).resolves.toBeUndefined();
    expect(() => parsePiCredentialJson(undefined)).toThrow(
      "server-only AUTHORING_PI_CREDENTIAL_JSON",
    );
    expect(() =>
      parsePiCredentialJson(
        JSON.stringify({
          type: "oauth",
          access: "access-test",
          refresh: "refresh-test",
          expires: Date.now() + 60_000,
        }),
      ),
    ).not.toThrow();
  });

  it("serializes credential deletion after an in-flight OAuth refresh", async () => {
    const initial = parsePiCredentialJson(
      JSON.stringify({
        type: "oauth",
        access: "initial-access",
        refresh: "initial-refresh",
        expires: 1,
      }),
    );
    const refreshed = parsePiCredentialJson(
      JSON.stringify({
        type: "oauth",
        access: "refreshed-access",
        refresh: "refreshed-refresh",
        expires: 2,
      }),
    );
    const store = new InMemoryPiCredentialStore("provider-test", initial);
    let releaseRefresh!: () => void;
    const refreshBlocked = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });

    const refresh = store.modify("provider-test", async (current) => {
      expect(current).toEqual(initial);
      refreshStarted();
      await refreshBlocked;
      return refreshed;
    });
    await started;
    const deletion = store.delete("provider-test");
    releaseRefresh();

    await Promise.all([refresh, deletion]);
    await expect(store.read("provider-test")).resolves.toBeUndefined();
    await expect(store.list()).resolves.toEqual([]);
  });

  it("fails closed before ModelRuntime without explicit paid activation", () => {
    expect(() =>
      assertRealPiActivation(
        {
          maxWallTimeMs: 30_000,
          maxModelTurns: 2,
          maxToolCalls: 6,
          maxTokens: 2_000,
          maxCostUsd: 0.2,
        },
        "anthropic/claude-test",
      ),
    ).toThrow("refusing to initialize ModelRuntime");
  });
});

async function harness(initial: AuthoringTurn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-authoring-test-"));
  roots.push(root);
  const store = new InMemoryAuthoringTurnStore([initial]);
  const workerId = "authoring-test-worker";
  const service = new ComponentAuthoringService(
    store,
    new AuthoringWorkspaceManager(root),
    new DeterministicFakeAuthoringAgent(),
    workerId,
    repositoryRoot,
    5_000,
  );
  return {
    store,
    root,
    loop: new ComponentAuthoringLoop(store, service, workerId, 5_000, 10),
  };
}

function turn(
  id: string,
  userRequest: string,
  overrides: Partial<AuthoringTurn> = {},
): AuthoringTurn {
  const baseSource = "export const candidate = true;";
  return {
    id,
    channelId: "channel-opaque",
    threadId: "thread-opaque",
    turnId: id,
    userRequest,
    acceptanceCriteria: ["Candidate remains deterministic."],
    baseSource,
    baseSourceHash: sha(baseSource),
    channelThemeJson: JSON.stringify({ colors: { accent: "#ff0000" } }),
    assetsMetadataJson: JSON.stringify({ assets: [] }),
    priorSummaries: [],
    state: "queued",
    attempt: 0,
    maxAttempts: 1,
    rootTurnId: id,
    repairAttempt: 0,
    maxRepairAttempts: 2,
    cancelRequested: false,
    maxWallTimeMs: 5_000,
    maxModelTurns: 3,
    maxToolCalls: 8,
    maxTokens: 2_000,
    maxCostUsd: 0.2,
    priorToolCalls: 0,
    priorModelTurns: 0,
    priorInputTokens: 0,
    priorOutputTokens: 0,
    priorCacheReadTokens: 0,
    priorCacheWriteTokens: 0,
    priorCostUsd: 0,
    priorWallTimeMs: 0,
    ...overrides,
  };
}
async function budgetedPiSession(
  budget: PiProviderBudget,
  responses: readonly Usage[],
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-pi-budget-test-"));
  roots.push(root);
  const model: Model<"openai-responses"> = {
    id: "budget-test-model",
    name: "Budget test model",
    api: "openai-responses",
    provider: "budget-test-provider",
    baseUrl: "http://invalid.local",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10_000,
    maxTokens: 800,
  };
  const observedCaps: number[] = [];
  let providerCalls = 0;
  const runtime = {
    hasConfiguredAuth: () => true,
    stream: () => {
      throw new Error("createAgentSession unexpectedly used stream");
    },
    streamSimple: (requestModel: Model<"openai-responses">) => {
      const usage = responses[providerCalls];
      if (!usage) throw new Error("Unexpected unbudgeted provider request.");
      providerCalls += 1;
      observedCaps.push(requestModel.maxTokens);
      const stream = createAssistantMessageEventStream();
      const message = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: `response ${providerCalls}` }],
        api: requestModel.api,
        provider: requestModel.provider,
        model: requestModel.id,
        usage,
        stopReason: "stop" as const,
        timestamp: Date.now(),
      };
      queueMicrotask(() =>
        stream.push({ type: "done", reason: "stop", message }),
      );
      return stream;
    },
  } as unknown as ModelRuntime;
  installPiProviderBudget(runtime, budget);

  const settings = SettingsManager.inMemory({
    defaultProvider: model.provider,
    defaultModel: model.id,
  });
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "Budget-bound test session.",
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime: runtime,
    model,
    thinkingLevel: "off",
    tools: [],
    noTools: "all",
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    settingsManager: settings,
  });
  return {
    session,
    observedCaps,
    providerCalls: () => providerCalls,
  };
}

function messageUsage(input: number, output: number, cost: number): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: {
      input: cost,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: cost,
    },
  };
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
