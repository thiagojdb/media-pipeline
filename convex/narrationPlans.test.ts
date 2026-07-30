import { describe, expect, it } from "vitest";

import { extractNarrationCues } from "./narrationPlans";

describe("narration plan extraction", () => {
  it("keeps spoken copy and excludes production directions", () => {
    const script = `# Election night

**Estimated runtime:** 8 minutes

**[VISUAL: A map fills the screen.]**

**NARRATOR:**

The result arrived before midnight.

**ON SCREEN: Final count**

The margin was **smaller** than expected.

FADE OUT`;

    expect(extractNarrationCues(script)).toEqual([
      {
        index: 0,
        sourceStart: script.indexOf("The result"),
        sourceEnd:
          script.indexOf("The result") +
          "The result arrived before midnight.".length,
        text: "The result arrived before midnight.",
      },
      {
        index: 1,
        sourceStart: script.indexOf("The margin"),
        sourceEnd:
          script.indexOf("The margin") +
          "The margin was **smaller** than expected.".length,
        text: "The margin was smaller than expected.",
      },
    ]);
  });

  it("removes an inline narrator label and Markdown list markers", () => {
    const script = `**VOICEOVER:** First claim, with a [source](https://example.com).

- Second claim
- Third claim`;

    expect(extractNarrationCues(script).map((cue) => cue.text)).toEqual([
      "First claim, with a source.",
      "Second claim Third claim",
    ]);
  });
});
