import { describe, expect, it } from "vitest";

import { publicProjectError } from "./project-errors";

describe("project API error boundary", () => {
  it("returns known creator-safe errors without backend arguments", () => {
    const message = publicProjectError(
      new Error(
        'Server Error Object: {serverToken: "top-secret"} Archived projects are read-only.',
      ),
      "Fallback",
    );
    expect(message).toBe("Archived projects are read-only.");
    expect(message).not.toContain("top-secret");
  });

  it("replaces unexpected backend failures with a generic message", () => {
    const message = publicProjectError(
      new Error('ArgumentValidationError serverToken: "top-secret"'),
      "The source request failed. Try again.",
    );
    expect(message).toBe("The source request failed. Try again.");
    expect(message).not.toContain("top-secret");
  });
});
