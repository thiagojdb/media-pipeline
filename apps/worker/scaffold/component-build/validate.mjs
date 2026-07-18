import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import definition from "./candidate-source.tsx";

const checks = [];
let fixtureCount = 0;
let checkpointCount = 0;
let renderedFrameCount = 0;
let renderFingerprint;

try {
  if (!definition || typeof definition !== "object")
    throw new Error(
      "Candidate must default-export defineVideoComponent(...). ",
    );
  if (typeof definition.component !== "function")
    throw new Error(
      "Default export is not a Relay video component definition.",
    );
  checks.push(
    pass(
      "component_contract",
      `${definition.id}@${definition.version} loaded through the public SDK contract.`,
    ),
  );

  fixtureCount = definition.fixtures.length;
  checkpointCount = definition.fixtures.reduce(
    (total, fixture) => total + fixture.checkpoints.length,
    0,
  );
  checks.push(
    pass(
      "fixture_inputs",
      `${fixtureCount} validated fixture inputs are available.`,
    ),
  );

  const hash = createHash("sha256");
  for (const fixture of definition.fixtures) {
    const duration =
      typeof definition.duration === "function"
        ? definition.duration(fixture.input)
        : definition.duration;
    const dimensions = [...definition.supportedDimensions].sort(
      (left, right) => left.width * left.height - right.width * right.height,
    )[0];
    const assets = Object.fromEntries(
      definition.assets.map((asset) => [
        asset.key,
        {
          key: asset.key,
          kind: asset.kind,
          src: "data:application/octet-stream;base64,",
          contentHash: "validation-placeholder",
        },
      ]),
    );
    const props = (frame) => ({
      input: fixture.input,
      frame,
      fps: definition.fps,
      durationInFrames: duration,
      width: dimensions.width,
      height: dimensions.height,
      theme: { colors: {}, fonts: {}, spacing: {} },
      assets,
    });
    for (const checkpoint of fixture.checkpoints) {
      const first = renderToStaticMarkup(
        createElement(definition.component, props(checkpoint.frame)),
      );
      const second = renderToStaticMarkup(
        createElement(definition.component, props(checkpoint.frame)),
      );
      if (first !== second)
        throw new Error(
          `${fixture.id}/${checkpoint.label} rendered nondeterministically.`,
        );
    }
    for (let frame = 0; frame < duration; frame += 1) {
      const markup = renderToStaticMarkup(
        createElement(definition.component, props(frame)),
      );
      hash
        .update(fixture.id)
        .update("\0")
        .update(String(frame))
        .update("\0")
        .update(markup);
      renderedFrameCount += 1;
    }
  }
  checks.push(
    pass(
      "checkpoint_runtime",
      `${checkpointCount} checkpoint frames rendered twice with identical output.`,
    ),
  );
  renderFingerprint = hash.digest("hex");
  checks.push(
    pass(
      "preview_runtime",
      `${renderedFrameCount} low-resolution preview frames rendered without runtime errors.`,
    ),
  );
  emit(0);
} catch (error) {
  const message = safeMessage(error);
  const code = checks.some(({ code }) => code === "component_contract")
    ? checks.some(({ code }) => code === "fixture_inputs")
      ? "preview_runtime"
      : "fixture_inputs"
    : "component_contract";
  checks.push({ code, status: "failed", message, details: [message] });
  emit(2);
}

function pass(code, message) {
  return { code, status: "passed", message };
}
function emit(exitCode) {
  const evidence = {
    schemaVersion: 1,
    checks,
    fixtureCount,
    checkpointCount,
    renderedFrameCount,
    ...(renderFingerprint ? { renderFingerprint } : {}),
  };
  console.log(`RELAY_VALIDATION_EVIDENCE=${JSON.stringify(evidence)}`);
  process.exit(exitCode);
}
function safeMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll("/workspace", "[candidate]")
    .slice(0, 1000);
}
