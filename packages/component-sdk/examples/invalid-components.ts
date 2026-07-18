import { defineVideoComponent } from "@relay/component-sdk";
import { z } from "zod";

/** An intentionally invalid candidate used to prove actionable contract errors. */
export function defineInvalidCheckpointComponent() {
  return defineVideoComponent({
    id: "Not Valid",
    version: "1.0.0",
    schema: z.object({ title: z.string() }),
    fps: 30,
    dimensions: { width: 1920, height: 1080 },
    duration: 30,
    assets: [],
    fixtures: [
      {
        id: "bad",
        name: "Invalid checkpoint",
        input: { title: "Bad" },
        checkpoints: [{ label: "outside", frame: 30 }],
      },
    ],
    compatibility: { mode: "initial" },
    component: () => null,
  });
}

export const invalidAmbientSource = {
  "invalid.ts": [
    "const timestamp = Date();",
    "const started = Date.now();",
    "const elapsed = performance.now();",
    "const secret = process.env.API_KEY;",
    "const viewportWidth = window.innerWidth;",
    "fetch('/direct');",
    "const load = fetch; load('/aliased');",
    "const {fetch: get} = globalThis; get('/destructured');",
    "const jitter = Math.random();",
    "const {random} = Math; random();",
    "crypto.getRandomValues(new Uint8Array(1));",
    "const frame = useCurrentFrame();",
    "const viewport = document.documentElement.clientWidth;",
    "const viewportHeight = innerHeight;",
    "const Socket = WebSocket; new Socket('wss://invalid');",
  ].join("\n"),
};
