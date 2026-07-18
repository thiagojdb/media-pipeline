# `@relay/component-sdk`

This is the complete public contract supplied to a Relay component-authoring Pi session. A video component is a pure React renderer driven by validated input and an explicit frame context. It is compatible with Remotion, but it does not read timing or renderer state through hidden hooks.

## Minimal definition

```ts
import { defineVideoComponent } from "@relay/component-sdk";
import { z } from "zod";

export default defineVideoComponent({
  id: "line-chart",
  version: "1.0.0",
  schema: z.object({
    title: z.string().describe("Chart title"),
    values: z.array(z.number()).min(2),
    color: z.string().default("#ef4444"),
  }),
  fps: 30,
  dimensions: { width: 1920, height: 1080 },
  supportedDimensions: [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ],
  duration: 180,
  assets: [],
  fixtures: [
    {
      id: "growth",
      name: "Growth",
      input: { title: "Subscribers", values: [10, 18, 31] },
      checkpoints: [
        { label: "start", frame: 0 },
        { label: "complete", frame: 179 },
      ],
    },
  ],
  compatibility: { mode: "initial" },
  component: ({
    input,
    frame,
    fps,
    durationInFrames,
    width,
    height,
    theme,
    assets,
  }) => {
    // Return React content. Animation is a pure function of these props.
    return null;
  },
});
```

`duration` may instead be a pure function of the parsed input and must return a positive integer frame count. Zod defaults and other parsing behavior are applied before the renderer receives `input`. The SDK generates `inputControls` as JSON Schema from the Zod schema; descriptions, defaults, enums, ranges, and nested object/array shapes become generic control metadata. Schemas that cannot be represented as JSON Schema are rejected.

## Family-neutral data

The contract has no chart, map, chess, subtitle, or branded-media mode. Those families differ only in their Zod inputs and declared assets:

- charts use arrays of series and values;
- maps use JSON geographic data, region ids, and camera values;
- chessboards use PGN/FEN and display options;
- subtitles use frame-addressed cue arrays;
- branded media declares image/video assets and layout inputs.

The repository includes mechanically tested definitions for all five families; this README is self-contained in the published package.

## Frame, theme, and assets

The renderer receives a zero-based `frame`, `fps`, exact `durationInFrames`, and exact pixel dimensions. `dimensions` remains the primary/default size. Components may additionally declare `supportedDimensions`; when omitted, it defaults to an array containing only the primary dimensions. Declared values must be unique positive-integer sizes and must include the primary size. Preview and final render hosts must supply the same selected values. Channel theme values are explicit color, font-family, and spacing token maps.

Components declare asset requirements by stable key and kind. Relay resolves those requirements before rendering and supplies `assets[key]` with a source and content hash. Component inputs and fixture outputs must be JSON values. Secrets are never component inputs or assets.

## Determinism rules

A component must be a pure function of parsed `input` plus its supplied props.

- Do not read wall-clock time (`Date.now`, `new Date`, or `performance.now`).
- Do not use unseeded/ambient randomness (`Math.random` or crypto randomness).
- Do not fetch or open network connections. Use declared, resolved assets.
- Do not call Remotion timing/configuration hooks such as `useCurrentFrame` or `useVideoConfig`; use the supplied frame context.
- Do not read `process.env`, secrets, browser dimensions, or mutable global state.

`@relay/component-testkit` reports deterministic source-policy violations with file, line, code, and remediation. That check is validation evidence, not a sandbox; the worker remains responsible for dependency, process, filesystem, and network isolation.

## Fixtures and failures

Every fixture has stable input and named checkpoint frames. Checkpoints must fall within the duration resolved for that fixture. `defineVideoComponent` rejects malformed identity/version/timing, duplicate ids or asset keys, invalid fixture input, non-JSON parsed input, unsupported control schemas, and invalid checkpoints.

Failures are `VideoComponentContractError` instances with stable `issues` entries:

```ts
{code: "checkpoint_out_of_range", path: ["fixtures", 0, "checkpoints", 0, "frame"], message: "..."}
```

Use `validateVideoComponentInput` for a non-throwing result when validating project-specific input.

## Revisions and compatibility

Approved component versions are immutable and projects pin an exact version. A successor keeps the same `id`, uses a new semantic `version`, and declares either:

- `backward-compatible` with the exact prior version;
- `breaking` with the exact prior version.

`checkRevisionCompatibility` verifies identity/version linkage and proves a backward-compatible claim against every prior fixture. Fixtures are representative evidence, not an exhaustive schema proof, so authors must mark a revision breaking whenever existing valid project inputs may stop working. A breaking revision does not mutate or invalidate prior pinned versions.
