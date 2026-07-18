import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    exclude: ["tests/browser/**", "**/node_modules/**", "**/dist/**"],
  },
  resolve: {
    alias: {
      "@relay/component-sdk": path.join(
        root,
        "packages/component-sdk/src/index.ts",
      ),
      "@relay/component-testkit": path.join(
        root,
        "packages/component-testkit/src/index.ts",
      ),
    },
  },
});
