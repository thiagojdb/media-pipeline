import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  bundleProgress,
  resolveRemotionEntryPoint,
  RetryableAsyncValue,
} from "../src/remotion-draft-renderer.js";

describe("Remotion draft renderer", () => {
  it("maps bundler percentages into the initial progress segment", () => {
    expect(bundleProgress(-1)).toBe(0);
    expect(bundleProgress(50)).toBeCloseTo(0.075);
    expect(bundleProgress(100)).toBe(0.15);
    expect(bundleProgress(200)).toBe(0.15);
  });

  it("resolves the TypeScript entry in development and built entry in production", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "relay-entry-test-"),
    );
    const moduleUrl = pathToFileURL(path.join(directory, "renderer.js")).href;
    const builtEntry = path.join(directory, "remotion-entry.js");
    const sourceEntry = path.join(directory, "remotion-entry.tsx");
    try {
      await writeFile(builtEntry, "export {};");
      expect(resolveRemotionEntryPoint(moduleUrl)).toBe(builtEntry);
      await writeFile(sourceEntry, "export {};");
      expect(resolveRemotionEntryPoint(moduleUrl)).toBe(sourceEntry);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

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
