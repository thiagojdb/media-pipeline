import { describe, expect, it } from "vitest";

import { buildCandidatePreviewHtml } from "../src/candidate-preview.js";

describe("candidate preview document", () => {
  it("renders new frames from parent messages without reloading the document", async () => {
    const html = await buildCandidatePreviewHtml(
      {
        componentId: "message-driven-preview",
        version: "1.0.0",
        sourceHash: "a".repeat(64),
        sourceSnapshot: source,
      },
      { fixtureId: "default", frame: 12 },
    );

    expect(html).toContain("relay-preview-frame-v1");
    expect(html).toContain("event.source !== window.parent");
    expect(html).toContain("renderFrame(12)");
    expect(html).toContain('window.addEventListener("message"');
  });
});

const source = `import {defineVideoComponent, type VideoComponentProps} from "@relay/component-sdk";
import {z} from "zod";
const schema = z.object({label: z.string()});
type Input = z.output<typeof schema>;
function Preview({input, frame, width, height}: VideoComponentProps<Input>) {
  return <svg viewBox={\`0 0 \${width} \${height}\`}><text>{input.label} frame {frame}</text></svg>;
}
export default defineVideoComponent({
  id: "message-driven-preview",
  version: "1.0.0",
  schema,
  fps: 30,
  dimensions: {width: 1920, height: 1080},
  supportedDimensions: [{width: 960, height: 540}],
  duration: 180,
  assets: [],
  fixtures: [{id: "default", name: "Default", input: {label: "Preview"}, checkpoints: [{label: "start", frame: 0}]}],
  compatibility: {mode: "initial"},
  component: Preview,
});`;
