import { describe, expect, it, vi } from "vitest";

import {
  ConfiguredScriptRevisionAgent,
  createScriptRevisionAgentFromEnvironment,
} from "../src/script-revision-agent.js";

describe("configured script revision providers", () => {
  it("uses Kimi's OpenAI-compatible Chat Completions protocol", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: "k3-256k",
        choices: [
          {
            message: {
              role: "assistant",
              content: "A sharper **opening**.",
            },
          },
        ],
        usage: { prompt_tokens: 31, completion_tokens: 7 },
      }),
    );
    const agent = createScriptRevisionAgentFromEnvironment(
      {
        KIMI_API_KEY: "server-only-test-key",
        SCRIPT_REVISION_PROVIDER: "kimi-code",
        SCRIPT_REVISION_MODEL: "k3-256k",
        SCRIPT_REVISION_KIMI_MODELS: "k3-256k,kimi-for-coding",
      },
      request,
    );

    await expect(
      agent.generate({
        instruction: "Make the opening sharper",
        scope: "selection",
        sourceMarkdown: "A quiet opening.",
        provider: "kimi-code",
        model: "k3-256k",
      }),
    ).resolves.toMatchObject({
      replacementMarkdown: "A sharper **opening**.",
      provider: "kimi-code",
      model: "k3-256k",
      inputTokens: 31,
      outputTokens: 7,
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe("https://api.kimi.com/coding/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer server-only-test-key",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "k3-256k",
      stream: false,
    });
  });

  it("uses strict Structured Outputs with OpenAI Responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: "gpt-5.6",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  replacementMarkdown: "A concise opening.",
                  rationale: "Removed repetition.",
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 22, output_tokens: 9 },
      }),
    );
    const agent = createScriptRevisionAgentFromEnvironment(
      {
        OPENAI_API_KEY: "server-only-test-key",
        SCRIPT_REVISION_PROVIDER: "openai",
        SCRIPT_REVISION_MODEL: "gpt-5.6",
      },
      request,
    );

    await expect(
      agent.generate({
        instruction: "Make this concise",
        scope: "selection",
        sourceMarkdown: "A very long opening.",
      }),
    ).resolves.toMatchObject({
      replacementMarkdown: "A concise opening.",
      rationale: "Removed repetition.",
      provider: "openai",
      model: "gpt-5.6",
    });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gpt-5.6",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "script_revision",
          strict: true,
        },
      },
    });
  });

  it("rejects browser-selected models outside the server allowlist", async () => {
    const agent = new ConfiguredScriptRevisionAgent({
      defaultProvider: "kimi-code",
      defaultModel: "k3-256k",
      models: [
        {
          provider: "kimi-code",
          model: "k3-256k",
          label: "Kimi K3 256K",
          protocol: "openai-chat-completions",
          baseUrl: "https://api.kimi.com/coding/v1",
          apiKey: "server-only-test-key",
        },
      ],
    });

    await expect(
      agent.generate({
        instruction: "Change it",
        scope: "selection",
        sourceMarkdown: "Opening",
        provider: "attacker",
        model: "arbitrary-model",
      }),
    ).rejects.toThrow(
      "The selected script revision provider and model are not configured.",
    );
  });
});
