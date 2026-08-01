import { describe, expect, it } from "vitest";

import {
  DeterministicTestDialogueAgent,
  relaySkills,
  safePublicUrl,
} from "../src/component-dialogue-agent.js";

describe("component dialogue boundary", () => {
  it("answers a greeting without beginning authoring", async () => {
    const text: string[] = [];
    const result = await new DeterministicTestDialogueAgent().run({
      history: [{ role: "user", content: "Hi, who are you?" }],
      onTextDelta: async (delta) => void text.push(delta),
      onSafeStatus: async () => undefined,
    });
    expect(text.join("")).toContain("I’m Relay");
    expect(result.transitionBrief).toBeUndefined();
    expect(result.inputTokens).toBeLessThan(20);
  });

  it("hands a concrete brief to authoring only after dialogue", async () => {
    const result = await new DeterministicTestDialogueAgent().run({
      history: [
        {
          role: "user",
          content:
            "Create an animated quote card with speaker and quote inputs.",
        },
      ],
      onTextDelta: async () => undefined,
      onSafeStatus: async () => undefined,
    });
    expect(result.transitionBrief).toContain("animated quote card");
  });

  it("answers a status question without starting duplicate authoring", async () => {
    const text: string[] = [];
    const result = await new DeterministicTestDialogueAgent().run({
      history: [{ role: "user", content: "Did you finish?" }],
      workState: '{"implementation":{"state":"candidate_submitted"}}',
      onTextDelta: async (delta) => void text.push(delta),
      onSafeStatus: async () => undefined,
    });

    expect(text.join(" ")).toContain("candidate_submitted");
    expect(result.transitionBrief).toBeUndefined();
  });

  it("discovers focused skills without loading implementation context", () => {
    expect(Object.keys(relaySkills())).toEqual([
      "reference-research",
      "channel-design",
      "component-design",
      "component-implementation",
    ]);
    expect(relaySkills()["component-implementation"]?.instructions).toContain(
      "same durable session",
    );
  });

  it("rejects private-network reference URLs", () => {
    expect(() => safePublicUrl("http://example.com")).toThrow(/HTTPS/);
    expect(() => safePublicUrl("https://127.0.0.1/private")).toThrow(
      /Private network/,
    );
    expect(safePublicUrl("https://www.youtube.com/@Paulogia").hostname).toBe(
      "www.youtube.com",
    );
  });
});
