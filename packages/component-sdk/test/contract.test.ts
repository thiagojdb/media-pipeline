import {
  VideoComponentContractError,
  checkRevisionCompatibility,
  defineVideoComponent,
  resolveVideoComponentDuration,
  validateVideoComponentInput,
} from "@relay/component-sdk";
import { validateComponentSource } from "@relay/component-testkit";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  brandedMedia,
  chessboard,
  lineChart,
  map,
  subtitles,
} from "../examples/components.js";
import {
  defineInvalidCheckpointComponent,
  invalidAmbientSource,
} from "../examples/invalid-components.js";

const minimalDefinition = {
  id: "simple-title",
  version: "1.0.0",
  schema: z.object({ title: z.string(), emphasis: z.boolean().default(false) }),
  fps: 30,
  dimensions: { width: 1920, height: 1080 },
  duration: 90,
  assets: [],
  fixtures: [
    {
      id: "default",
      name: "Default title",
      input: { title: "Relay" },
      checkpoints: [{ label: "visible", frame: 30 }],
    },
  ],
  compatibility: { mode: "initial" as const },
  component: () => null,
};

describe("video component contract", () => {
  it("defines family-neutral chart, map, chess, subtitle, and branded-media examples", () => {
    expect(
      [lineChart, map, chessboard, subtitles, brandedMedia].map(
        (item) => item.id,
      ),
    ).toEqual([
      "line-chart",
      "route-map",
      "chessboard",
      "subtitles",
      "branded-media",
    ]);
    expect(lineChart.inputControls).toMatchObject({ type: "object" });
    expect(brandedMedia.assets.map((asset) => asset.kind)).toEqual([
      "video",
      "image",
    ]);
    expect(
      resolveVideoComponentDuration(chessboard, chessboard.fixtures[0]!.input),
    ).toBe(144);
    expect(
      resolveVideoComponentDuration(subtitles, subtitles.fixtures[0]!.input),
    ).toBe(60);
  });

  it("applies Zod defaults and defaults supported dimensions to the primary dimensions", () => {
    const component = defineVideoComponent(minimalDefinition);
    expect(component.fixtures[0]!.input).toEqual({
      title: "Relay",
      emphasis: false,
    });
    expect(component.supportedDimensions).toEqual([
      { width: 1920, height: 1080 },
    ]);

    expect(
      validateVideoComponentInput(component.schema, { emphasis: true }),
    ).toEqual({
      success: false,
      issues: [
        { code: "input_invalid", path: ["title"], message: expect.any(String) },
      ],
    });
  });

  it("rejects a successful Zod transform that produces a non-JSON value", () => {
    const schema = z.object({
      publishedAt: z
        .string()
        .transform(() => new Date("2026-01-01T00:00:00.000Z")),
    });

    expect(
      validateVideoComponentInput(schema, { publishedAt: "2026-01-01" }),
    ).toEqual({
      success: false,
      issues: [
        {
          code: "input_not_json",
          path: [],
          message: "Parsed component input must contain only JSON values.",
        },
      ],
    });
  });

  it("copies and freezes primary dimensions so caller mutation cannot invalidate the contract", () => {
    const dimensions = { width: 1920, height: 1080 };
    const component = defineVideoComponent({
      ...minimalDefinition,
      dimensions,
      supportedDimensions: [dimensions, { width: 1280, height: 720 }],
    });

    dimensions.width = 640;
    expect(component.dimensions).toEqual({ width: 1920, height: 1080 });
    expect(component.supportedDimensions).toContainEqual(component.dimensions);
    expect(Object.isFrozen(component.dimensions)).toBe(true);
  });

  it("validates declared supported dimensions and requires the primary dimensions", () => {
    const component = defineVideoComponent({
      ...minimalDefinition,
      supportedDimensions: [
        minimalDefinition.dimensions,
        { width: 1280, height: 720 },
      ],
    });
    expect(component.supportedDimensions).toEqual([
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
    ]);

    expect(() =>
      defineVideoComponent({
        ...minimalDefinition,
        supportedDimensions: [
          { width: 1280, height: 720 },
          { width: 1280, height: 720 },
          { width: 0, height: 1080 },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "dimension_duplicate",
            path: ["supportedDimensions", 1],
          }),
          expect.objectContaining({
            code: "invalid_dimensions",
            path: ["supportedDimensions", 2],
          }),
          expect.objectContaining({
            code: "invalid_dimensions",
            path: ["supportedDimensions"],
          }),
        ]),
      }),
    );
  });

  it("requires fixtures and checkpoints and validates static duration independently", () => {
    expect(() =>
      defineVideoComponent({ ...minimalDefinition, duration: 0, fixtures: [] }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "fixture_required",
            path: ["fixtures"],
          }),
          expect.objectContaining({
            code: "duration_invalid",
            path: ["duration"],
          }),
        ]),
      }),
    );

    expect(() =>
      defineVideoComponent({
        ...minimalDefinition,
        fixtures: [{ ...minimalDefinition.fixtures[0]!, checkpoints: [] }],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "checkpoint_required",
            path: ["fixtures", 0, "checkpoints"],
          }),
        ],
      }),
    );
  });

  it("runtime-validates nonempty metadata with actionable paths", () => {
    expect(() =>
      defineVideoComponent({
        ...minimalDefinition,
        assets: [{ key: " ", kind: "image", required: true, description: "" }],
        fixtures: [
          {
            id: "",
            name: " ",
            input: { title: "Relay" },
            checkpoints: [{ label: "", frame: 0 }],
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "asset_invalid",
            path: ["assets", 0, "key"],
          }),
          expect.objectContaining({
            code: "asset_invalid",
            path: ["assets", 0, "description"],
          }),
          expect.objectContaining({
            code: "fixture_invalid",
            path: ["fixtures", 0, "id"],
          }),
          expect.objectContaining({
            code: "fixture_invalid",
            path: ["fixtures", 0, "name"],
          }),
          expect.objectContaining({
            code: "checkpoint_invalid",
            path: ["fixtures", 0, "checkpoints", 0, "label"],
          }),
        ],
      }),
    );
  });

  it("rejects an invalid example deterministically", () => {
    expect(defineInvalidCheckpointComponent).toThrow(
      VideoComponentContractError,
    );

    try {
      defineInvalidCheckpointComponent();
    } catch (error) {
      expect(error).toBeInstanceOf(VideoComponentContractError);
      expect(
        (error as VideoComponentContractError).issues.map(
          (issue) => issue.code,
        ),
      ).toEqual(["invalid_id", "checkpoint_out_of_range"]);
    }
  });

  it("uses standards-compliant SemVer and requires forward version movement", () => {
    for (const version of ["01.0.0", "1.0.0-alpha..1"]) {
      expect(() =>
        defineVideoComponent({ ...minimalDefinition, version }),
      ).toThrowError(
        expect.objectContaining({
          issues: [
            expect.objectContaining({
              code: "invalid_version",
              path: ["version"],
            }),
          ],
        }),
      );
    }

    expect(
      defineVideoComponent({ ...minimalDefinition, version: "1.0.0+build.42" })
        .version,
    ).toBe("1.0.0+build.42");

    const previous = defineVideoComponent({
      ...minimalDefinition,
      version: "1.2.0",
    });
    const equal = defineVideoComponent({
      ...minimalDefinition,
      version: "1.2.0",
      compatibility: { mode: "breaking", previousVersion: "1.2.0" },
    });
    const backward = defineVideoComponent({
      ...minimalDefinition,
      version: "1.1.9",
      compatibility: { mode: "breaking", previousVersion: "1.2.0" },
    });

    for (const successor of [equal, backward]) {
      expect(checkRevisionCompatibility(previous, successor)).toMatchObject({
        success: false,
        issues: [
          expect.objectContaining({
            code: "invalid_version",
            path: ["version"],
          }),
        ],
      });
    }
  });

  it("checks declared backward compatibility against prior fixtures", () => {
    const previous = defineVideoComponent(minimalDefinition);
    const compatible = defineVideoComponent({
      ...minimalDefinition,
      version: "1.1.0",
      schema: minimalDefinition.schema.extend({
        color: z.string().default("red"),
      }),
      compatibility: { mode: "backward-compatible", previousVersion: "1.0.0" },
    });
    const breaking = defineVideoComponent({
      ...minimalDefinition,
      version: "2.0.0",
      schema: z.object({ title: z.string(), requiredColor: z.string() }),
      fixtures: [
        {
          id: "new-default",
          name: "New required input",
          input: { title: "Relay", requiredColor: "red" },
          checkpoints: [{ label: "visible", frame: 30 }],
        },
      ],
      compatibility: { mode: "backward-compatible", previousVersion: "1.0.0" },
    });

    expect(checkRevisionCompatibility(previous, compatible).success).toBe(true);
    expect(checkRevisionCompatibility(previous, breaking)).toMatchObject({
      success: false,
      issues: [{ code: "input_invalid", path: ["fixtures", 0, "input"] }],
    });
  });
});

describe("deterministic component source policy", () => {
  it("accepts frame-derived source and ignores forbidden words in comments and strings", () => {
    expect(
      validateComponentSource({
        "component.ts": [
          "// Date.now(), fetch(), Math.random(), and process.env are forbidden.",
          "const documentation = 'window.innerWidth and useCurrentFrame()';",
          "const input = {innerWidth: 640}; const configuredWidth = input.innerWidth;",
          "export const opacity = ({frame, durationInFrames}) => frame / durationInFrames;",
        ].join("\n"),
      }),
    ).toEqual({ success: true });
  });

  it("allows only the declared single-file component dependencies", () => {
    expect(
      validateComponentSource({
        "valid.tsx": [
          'import React from "react";',
          'import {z} from "zod";',
          'import {defineVideoComponent} from "@relay/component-sdk";',
        ].join("\n"),
      }),
    ).toEqual({ success: true });

    const result = validateComponentSource({
      "invalid.ts": [
        'import secret from "/etc/passwd";',
        'export {value} from "../../host-file";',
        'const lazy = import("node:fs");',
        "const loaded = require(variable);",
      ].join("\n"),
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected dependency-policy failures.");
    expect(result.issues.map(({ code, line }) => ({ code, line }))).toEqual([
      { code: "undeclared_dependency", line: 1 },
      { code: "undeclared_dependency", line: 2 },
      { code: "undeclared_dependency", line: 3 },
      { code: "undeclared_dependency", line: 4 },
    ]);
  });

  it("rejects renderer imports, nested globals, and assignment aliases", () => {
    const result = validateComponentSource({
      "bypasses.ts": [
        'import {useCurrentFrame as currentFrame} from "remotion";',
        'import * as Remotion from "remotion";',
        "currentFrame();",
        "Remotion.useVideoConfig();",
        "globalThis.Date.now();",
        "window.Math.random();",
        "globalThis.fetch('/nested');",
        "let request; request = fetch; request('/assigned');",
        'const lazy = import("remotion");',
      ].join("\n"),
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected source-policy failures.");
    expect(result.issues.map(({ code, line }) => ({ code, line }))).toEqual([
      { code: "hidden_renderer_api", line: 1 },
      { code: "hidden_renderer_api", line: 2 },
      { code: "wall_clock", line: 5 },
      { code: "ambient_randomness", line: 6 },
      { code: "ambient_network", line: 7 },
      { code: "ambient_network", line: 8 },
      { code: "hidden_renderer_api", line: 9 },
    ]);
  });

  it("rejects nested namespace aliases, destructuring assignments, and alternate Remotion loads", () => {
    const result = validateComponentSource({
      "alternate-bypasses.ts": [
        "const root = globalThis;",
        "root.Date.now();",
        "const {Math: Numbers} = globalThis;",
        "Numbers.random();",
        "let random;",
        "({random} = Math); random();",
        'export {useCurrentFrame as frame} from "remotion";',
        'import Remotion = require("remotion");',
        "const lazy = import(`remotion`);",
      ].join("\n"),
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected source-policy failures.");
    expect(result.issues.map(({ code, line }) => ({ code, line }))).toEqual([
      { code: "wall_clock", line: 2 },
      { code: "ambient_randomness", line: 4 },
      { code: "ambient_randomness", line: 6 },
      { code: "hidden_renderer_api", line: 7 },
      { code: "hidden_renderer_api", line: 8 },
      { code: "hidden_renderer_api", line: 9 },
    ]);
  });

  it("returns stable evidence for direct, aliased, and destructured ambient APIs", () => {
    const result = validateComponentSource(invalidAmbientSource);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected source-policy failures.");

    expect(
      result.issues.map(({ code, file, line }) => ({ code, file, line })),
    ).toEqual([
      { code: "wall_clock", file: "invalid.ts", line: 1 },
      { code: "wall_clock", file: "invalid.ts", line: 2 },
      { code: "wall_clock", file: "invalid.ts", line: 3 },
      { code: "ambient_environment", file: "invalid.ts", line: 4 },
      { code: "browser_dimensions", file: "invalid.ts", line: 5 },
      { code: "ambient_network", file: "invalid.ts", line: 6 },
      { code: "ambient_network", file: "invalid.ts", line: 7 },
      { code: "ambient_network", file: "invalid.ts", line: 8 },
      { code: "ambient_randomness", file: "invalid.ts", line: 9 },
      { code: "ambient_randomness", file: "invalid.ts", line: 10 },
      { code: "ambient_randomness", file: "invalid.ts", line: 11 },
      { code: "hidden_renderer_api", file: "invalid.ts", line: 12 },
      { code: "browser_dimensions", file: "invalid.ts", line: 13 },
      { code: "browser_dimensions", file: "invalid.ts", line: 14 },
      { code: "ambient_network", file: "invalid.ts", line: 15 },
    ]);
    expect(result.issues.every((issue) => issue.message.length > 0)).toBe(true);
  });
});
