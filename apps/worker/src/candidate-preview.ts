import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { build } from "esbuild";

const require = createRequire(import.meta.url);

export type PreviewArtifact = {
  readonly sourceSnapshot: string;
  readonly sourceHash: string;
  readonly componentId: string;
  readonly version: string;
};

export async function buildCandidatePreviewHtml(
  artifact: PreviewArtifact,
  options: { fixtureId?: string; frame?: number; theme?: unknown } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-preview-"));
  try {
    await writeFile(path.join(root, "candidate.tsx"), artifact.sourceSnapshot, {
      mode: 0o600,
    });
    const fixtureId = JSON.stringify(options.fixtureId ?? "");
    const frame = Math.max(0, Math.floor(options.frame ?? 0));
    const theme = jsonForScript(options.theme ?? defaultTheme);
    const entry = `
import React from "react";
import {createRoot} from "react-dom/client";
import definition from "./candidate.tsx";
const fixtureId = ${fixtureId};
const fixture = definition.fixtures.find((item) => item.id === fixtureId) ?? definition.fixtures[0];
if (!fixture) throw new Error("Candidate has no preview fixture.");
const durationInFrames = typeof definition.duration === "function" ? definition.duration(fixture.input) : definition.duration;
const dimensions = [...definition.supportedDimensions].sort((a,b) => a.width*a.height-b.width*b.height)[0];
if (!dimensions) throw new Error("Candidate has no supported dimensions.");
const props = {
  input: fixture.input,
  frame: Math.min(${frame}, Math.max(0, durationInFrames - 1)),
  fps: definition.fps,
  durationInFrames,
  width: dimensions.width,
  height: dimensions.height,
  theme: ${theme},
  assets: {},
};
createRoot(document.getElementById("root")).render(React.createElement(definition.component, props));
`;
    const output = await build({
      stdin: {
        contents: entry,
        loader: "tsx",
        resolveDir: root,
        sourcefile: "relay-preview-entry.tsx",
      },
      absWorkingDir: process.cwd(),
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      alias: {
        "@relay/component-sdk": require.resolve("@relay/component-sdk"),
        react: require.resolve("react"),
        "react-dom/client": require.resolve("react-dom/client"),
        "react/jsx-runtime": require.resolve("react/jsx-runtime"),
        zod: require.resolve("zod"),
      },
      write: false,
      logLevel: "silent",
    });
    const script = output.outputFiles[0]?.text;
    if (!script) throw new Error("Candidate preview bundle was empty.");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:"><style>html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#07111f}#root>svg{width:100%;height:100%;display:block}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const defaultTheme = {
  colors: {
    accent: "#ef4444",
    background: "#07111f",
    foreground: "#f4f7fb",
    muted: "#91a3ba",
    grid: "#24364d",
  },
  fonts: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
  spacing: { outer: 72 },
};
