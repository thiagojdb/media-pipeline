import { describe, expect, it } from "vitest";

import { DeterministicFakeDialogueAgent } from "../src/component-dialogue-agent.js";

describe("component dialogue boundary", () => {
  it("answers a greeting without beginning authoring", async () => {
    const text: string[] = [];
    const result = await new DeterministicFakeDialogueAgent().run({
      history: [{ role: "user", content: "Hi, who are you?" }],
      onTextDelta: async (delta) => void text.push(delta),
      onSafeStatus: async () => undefined,
    });
    expect(text.join("")).toContain("I’m Relay");
    expect(result.transitionBrief).toBeUndefined();
    expect(result.inputTokens).toBeLessThan(20);
  });

  it("hands a concrete brief to authoring only after dialogue", async () => {
    const result = await new DeterministicFakeDialogueAgent().run({
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
});
