import { describe, expect, it, vi } from "vitest";

import { RetryableAsyncValue } from "../src/remotion-draft-renderer.js";

describe("Remotion draft renderer", () => {
  it("shares a successful bundle but retries after a transient bundle failure", async () => {
    const cache = new RetryableAsyncValue<string>();
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary bundler failure"))
      .mockResolvedValue("serve-url");

    await expect(cache.get(factory)).rejects.toThrow(
      "temporary bundler failure",
    );
    await expect(cache.get(factory)).resolves.toBe("serve-url");
    await expect(cache.get(factory)).resolves.toBe("serve-url");
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
