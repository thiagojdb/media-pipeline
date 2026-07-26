import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserProjectRenderExecutor } from "../src/project-render-loop.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project render executor", () => {
  it("renders preview-aligned checkpoints and synchronized narration streams", async () => {
    const temporaryParent = path.join(
      os.homedir(),
      ".cache",
      "ai-tmp",
      "relay-project-render-tests",
    );
    await mkdir(temporaryParent, { recursive: true });
    const root = await mkdtemp(path.join(temporaryParent, "case-"));
    roots.push(root);
    const wav = silentWav(1_000);
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/narration.wav") {
        response.writeHead(200, { "content-type": "audio/wav" });
        response.end(wav);
        return;
      }
      const initialFrame = Number(url.searchParams.get("frame") ?? 0);
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><style>html,body{margin:0;width:100%;height:100%}</style><body><script>
        const render = (frame) => {
          document.body.style.background = 'rgb(' + (40 + frame * 50) + ', 80, 120)';
          document.body.dataset.frame = String(frame);
        };
        render(${initialFrame});
        addEventListener('message', (event) => {
          if (event.data?.type === 'relay-preview-frame-v1') render(event.data.frame);
        });
      </script></body>`);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port.");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const executor = new BrowserProjectRenderExecutor(origin, root);
      const result = await executor.execute(
        {
          _id: "render-1",
          attempt: 1,
          rangeStartMs: 0,
          rangeEndMs: 300,
          width: 160,
          height: 90,
          fps: 10,
          narrationUrl: `${origin}/narration.wav`,
          composition: {
            segments: [
              {
                id: "visual",
                kind: "component",
                componentVersionId: "component-version",
                componentId: "checkpoint-card",
                componentVersion: "1.0.0",
                input: { title: "Checkpoint" },
                anchor: { startMs: 0, endMs: 300 },
              },
            ],
          },
        },
        {
          signal: new AbortController().signal,
          onProgress: () => undefined,
        },
      );
      const probe = JSON.parse(
        (
          await execute("ffprobe", [
            "-v",
            "error",
            "-show_streams",
            "-of",
            "json",
            result.outputPath,
          ])
        ).stdout,
      ) as { streams: Array<{ codec_type: string }> };
      expect(probe.streams.map((stream) => stream.codec_type).sort()).toEqual([
        "audio",
        "video",
      ]);

      const first = path.join(root, "first.png");
      const last = path.join(root, "last.png");
      await extractFrame(result.outputPath, 0, first);
      await extractFrame(result.outputPath, 2, last);
      expectColor(centerPixel(await readFile(first)), [40, 80, 120]);
      expectColor(centerPixel(await readFile(last)), [140, 80, 120]);
      expect(result.visualFingerprint).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);
});

async function extractFrame(input: string, frame: number, output: string) {
  await execute("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-vf",
    `select=eq(n\\,${frame})`,
    "-frames:v",
    "1",
    "-y",
    output,
  ]);
}

function centerPixel(bytes: Buffer): [number, number, number] {
  const png = PNG.sync.read(bytes);
  const offset =
    (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

function expectColor(
  received: [number, number, number],
  expected: [number, number, number],
) {
  for (const [index, channel] of received.entries()) {
    expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(15);
  }
}

function silentWav(durationMs: number): Buffer {
  const sampleRate = 8_000;
  const samples = Math.ceil((durationMs / 1_000) * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
