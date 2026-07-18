import type { ReactNode } from "react";
import { gt, valid } from "semver";
import { z } from "zod";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export const componentIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const channelThemeSchema = z
  .object({
    colors: z.record(z.string(), z.string()),
    fonts: z.record(z.string(), z.string()),
    spacing: z.record(z.string(), z.number().nonnegative()),
  })
  .readonly();

export type ChannelTheme = z.infer<typeof channelThemeSchema>;

export const assetKindSchema = z.enum([
  "image",
  "video",
  "audio",
  "font",
  "data",
]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const resolvedAssetSchema = z
  .object({
    key: z.string().min(1),
    kind: assetKindSchema,
    src: z.string().min(1),
    contentHash: z.string().min(1),
  })
  .readonly();

export type ResolvedAsset = z.infer<typeof resolvedAssetSchema>;

export interface AssetRequirement {
  readonly key: string;
  readonly kind: AssetKind;
  readonly required: boolean;
  readonly description: string;
}

export interface VideoDimensions {
  readonly width: number;
  readonly height: number;
}

export interface VideoFrameContext {
  /** Zero-based frame supplied by Relay. */
  readonly frame: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly width: number;
  readonly height: number;
  readonly theme: ChannelTheme;
  /** Assets resolved before rendering and indexed by their declared requirement key. */
  readonly assets: Readonly<Record<string, ResolvedAsset>>;
}

export interface VideoComponentProps<Input> extends VideoFrameContext {
  /** Successfully parsed output from the component's Zod schema. */
  readonly input: Readonly<Input>;
}

export type VideoComponentRenderer<Input> = (
  props: VideoComponentProps<Input>,
) => ReactNode;

export interface PreviewCheckpoint {
  readonly label: string;
  readonly frame: number;
}

export interface VideoComponentFixture<Input> {
  readonly id: string;
  readonly name: string;
  readonly input: Input;
  readonly checkpoints: readonly PreviewCheckpoint[];
}

export type RevisionCompatibility =
  | { readonly mode: "initial" }
  | {
      readonly mode: "backward-compatible" | "breaking";
      readonly previousVersion: string;
    };

export interface VideoComponentDefinition<Schema extends z.ZodObject> {
  readonly id: string;
  readonly version: string;
  readonly schema: Schema;
  readonly fps: number;
  /** Primary dimensions used when a host does not make an explicit selection. */
  readonly dimensions: VideoDimensions;
  /** Optional additional dimensions a host may select exactly. Defaults to `dimensions`. */
  readonly supportedDimensions?: readonly VideoDimensions[];
  readonly duration: number | ((input: z.output<Schema>) => number);
  readonly assets: readonly AssetRequirement[];
  readonly fixtures: readonly VideoComponentFixture<z.input<Schema>>[];
  readonly compatibility: RevisionCompatibility;
  readonly component: VideoComponentRenderer<z.output<Schema>>;
}

export type InputControlMetadata = z.core.JSONSchema.BaseSchema;

export interface DefinedVideoComponent<Schema extends z.ZodObject> extends Omit<
  VideoComponentDefinition<Schema>,
  "fixtures" | "supportedDimensions"
> {
  /** Primary plus any other exact dimensions a host may select. */
  readonly supportedDimensions: readonly VideoDimensions[];
  /** JSON Schema generated from `schema` for generic input controls. */
  readonly inputControls: InputControlMetadata;
  /** Fixture inputs after Zod parsing/default application. */
  readonly fixtures: readonly VideoComponentFixture<z.output<Schema>>[];
}

export type ContractIssueCode =
  | "asset_duplicate"
  | "asset_invalid"
  | "checkpoint_duplicate"
  | "checkpoint_invalid"
  | "checkpoint_out_of_range"
  | "checkpoint_required"
  | "compatibility_invalid"
  | "dimension_duplicate"
  | "duration_invalid"
  | "fixture_duplicate"
  | "fixture_invalid"
  | "fixture_required"
  | "input_invalid"
  | "input_not_json"
  | "invalid_dimensions"
  | "invalid_fps"
  | "invalid_id"
  | "invalid_version"
  | "schema_not_controllable";

export interface ContractIssue {
  readonly code: ContractIssueCode;
  readonly path: readonly (number | string)[];
  readonly message: string;
}

export class VideoComponentContractError extends Error {
  readonly issues: readonly ContractIssue[];

  constructor(issues: readonly ContractIssue[]) {
    super(
      issues
        .map((issue) => `${formatPath(issue.path)}: ${issue.message}`)
        .join("\n"),
    );
    this.name = "VideoComponentContractError";
    this.issues = issues;
  }
}

export type ValidationResult<Value> =
  | { readonly success: true; readonly value: Value }
  | { readonly success: false; readonly issues: readonly ContractIssue[] };

export function defineVideoComponent<Schema extends z.ZodObject>(
  definition: VideoComponentDefinition<Schema>,
): DefinedVideoComponent<Schema> {
  const issues: ContractIssue[] = [];

  if (!componentIdPattern.test(definition.id)) {
    issues.push({
      code: "invalid_id",
      path: ["id"],
      message: "Use a lowercase kebab-case component id.",
    });
  }
  if (!isValidSemVer(definition.version)) {
    issues.push({
      code: "invalid_version",
      path: ["version"],
      message: "Use a standards-compliant semantic version such as 1.0.0.",
    });
  }
  if (!Number.isInteger(definition.fps) || definition.fps <= 0) {
    issues.push({
      code: "invalid_fps",
      path: ["fps"],
      message: "FPS must be a positive integer.",
    });
  }
  if (!isValidDimensions(definition.dimensions)) {
    issues.push({
      code: "invalid_dimensions",
      path: ["dimensions"],
      message: "Width and height must be positive integers.",
    });
  }

  const supportedDimensions = definition.supportedDimensions ?? [
    definition.dimensions,
  ];
  if (supportedDimensions.length === 0) {
    issues.push({
      code: "invalid_dimensions",
      path: ["supportedDimensions"],
      message: "Supported dimensions cannot be empty when provided.",
    });
  }
  supportedDimensions.forEach((dimensions, index) => {
    if (!isValidDimensions(dimensions)) {
      issues.push({
        code: "invalid_dimensions",
        path: ["supportedDimensions", index],
        message: "Width and height must be positive integers.",
      });
    }
  });
  checkUniqueDimensions(supportedDimensions, issues);
  if (
    isValidDimensions(definition.dimensions) &&
    !supportedDimensions.some((dimensions) =>
      dimensionsEqual(dimensions, definition.dimensions),
    )
  ) {
    issues.push({
      code: "invalid_dimensions",
      path: ["supportedDimensions"],
      message: "Supported dimensions must include the primary dimensions.",
    });
  }

  definition.assets.forEach((asset, assetIndex) => {
    if (!isNonEmptyString(asset.key)) {
      issues.push({
        code: "asset_invalid",
        path: ["assets", assetIndex, "key"],
        message: "Asset keys must be nonempty.",
      });
    }
    if (!isNonEmptyString(asset.description)) {
      issues.push({
        code: "asset_invalid",
        path: ["assets", assetIndex, "description"],
        message: "Asset descriptions must be nonempty.",
      });
    }
  });
  checkUnique(
    definition.assets.map((asset) => asset.key),
    "assets",
    "asset_duplicate",
    "Asset requirement keys must be unique.",
    issues,
  );

  if (definition.fixtures.length === 0) {
    issues.push({
      code: "fixture_required",
      path: ["fixtures"],
      message: "Define at least one representative fixture.",
    });
  }
  definition.fixtures.forEach((fixture, fixtureIndex) => {
    if (!isNonEmptyString(fixture.id)) {
      issues.push({
        code: "fixture_invalid",
        path: ["fixtures", fixtureIndex, "id"],
        message: "Fixture ids must be nonempty.",
      });
    }
    if (!isNonEmptyString(fixture.name)) {
      issues.push({
        code: "fixture_invalid",
        path: ["fixtures", fixtureIndex, "name"],
        message: "Fixture names must be nonempty.",
      });
    }
    if (fixture.checkpoints.length === 0) {
      issues.push({
        code: "checkpoint_required",
        path: ["fixtures", fixtureIndex, "checkpoints"],
        message: "Define at least one preview checkpoint per fixture.",
      });
    }
    fixture.checkpoints.forEach((checkpoint, checkpointIndex) => {
      if (!isNonEmptyString(checkpoint.label)) {
        issues.push({
          code: "checkpoint_invalid",
          path: [
            "fixtures",
            fixtureIndex,
            "checkpoints",
            checkpointIndex,
            "label",
          ],
          message: "Checkpoint labels must be nonempty.",
        });
      }
    });
    checkUnique(
      fixture.checkpoints.map((checkpoint) => checkpoint.label),
      `fixtures.${fixtureIndex}.checkpoints`,
      "checkpoint_duplicate",
      "Checkpoint labels must be unique within a fixture.",
      issues,
    );
  });
  checkUnique(
    definition.fixtures.map((fixture) => fixture.id),
    "fixtures",
    "fixture_duplicate",
    "Fixture ids must be unique.",
    issues,
  );

  const staticDurationIsValid =
    typeof definition.duration !== "number" ||
    isPositiveInteger(definition.duration);
  if (!staticDurationIsValid) {
    issues.push({
      code: "duration_invalid",
      path: ["duration"],
      message: "Static duration must be a positive integer number of frames.",
    });
  }

  let inputControls: InputControlMetadata = {};
  try {
    inputControls = z.toJSONSchema(definition.schema, { io: "input" });
  } catch (error) {
    issues.push({
      code: "schema_not_controllable",
      path: ["schema"],
      message: `The input schema must be representable as JSON Schema: ${errorMessage(error)}`,
    });
  }

  const fixtures: VideoComponentFixture<z.output<Schema>>[] = [];
  definition.fixtures.forEach((fixture, fixtureIndex) => {
    const parsed = validateVideoComponentInput(
      definition.schema,
      fixture.input,
    );
    if (!parsed.success) {
      issues.push(
        ...parsed.issues.map((issue) => ({
          ...issue,
          path: ["fixtures", fixtureIndex, "input", ...issue.path],
        })),
      );
      return;
    }
    let durationInFrames: number;
    if (typeof definition.duration === "number") {
      if (!staticDurationIsValid) return;
      durationInFrames = definition.duration;
    } else {
      try {
        durationInFrames = definition.duration(parsed.value);
      } catch (error) {
        issues.push({
          code: "duration_invalid",
          path: ["fixtures", fixtureIndex, "input"],
          message: `Duration failed for this fixture: ${errorMessage(error)}`,
        });
        return;
      }
      if (!isPositiveInteger(durationInFrames)) {
        issues.push({
          code: "duration_invalid",
          path: ["fixtures", fixtureIndex, "input"],
          message:
            "Duration must resolve to a positive integer number of frames.",
        });
        return;
      }
    }
    fixture.checkpoints.forEach((checkpoint, checkpointIndex) => {
      if (
        !Number.isInteger(checkpoint.frame) ||
        checkpoint.frame < 0 ||
        checkpoint.frame >= durationInFrames
      ) {
        issues.push({
          code: "checkpoint_out_of_range",
          path: [
            "fixtures",
            fixtureIndex,
            "checkpoints",
            checkpointIndex,
            "frame",
          ],
          message: `Frame must be an integer from 0 through ${durationInFrames - 1}.`,
        });
      }
    });

    fixtures.push({ ...fixture, input: parsed.value });
  });

  if (issues.length > 0) throw new VideoComponentContractError(issues);

  return Object.freeze({
    ...definition,
    dimensions: Object.freeze({ ...definition.dimensions }),
    supportedDimensions: Object.freeze(
      supportedDimensions.map((dimensions) => Object.freeze({ ...dimensions })),
    ),
    fixtures: Object.freeze(fixtures),
    inputControls,
  });
}

export function validateVideoComponentInput<Schema extends z.ZodObject>(
  schema: Schema,
  input: unknown,
): ValidationResult<z.output<Schema>> {
  const result = schema.safeParse(input);
  if (result.success) {
    if (isJsonValue(result.data)) return { success: true, value: result.data };
    return {
      success: false,
      issues: [
        {
          code: "input_not_json",
          path: [],
          message: "Parsed component input must contain only JSON values.",
        },
      ],
    };
  }

  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      code: "input_invalid",
      path: issue.path.map(String),
      message: issue.message,
    })),
  };
}

export function resolveVideoComponentDuration<Schema extends z.ZodObject>(
  component: DefinedVideoComponent<Schema>,
  input: z.output<Schema>,
): number {
  let duration: number;
  try {
    duration = resolveDuration(component.duration, input);
  } catch (error) {
    throw new VideoComponentContractError([
      {
        code: "duration_invalid",
        path: ["duration"],
        message: `Duration calculation failed: ${errorMessage(error)}`,
      },
    ]);
  }
  if (!isPositiveInteger(duration)) {
    throw new VideoComponentContractError([
      {
        code: "duration_invalid",
        path: ["duration"],
        message:
          "Duration must resolve to a positive integer number of frames.",
      },
    ]);
  }
  return duration;
}

export function checkRevisionCompatibility<Schema extends z.ZodObject>(
  previous: DefinedVideoComponent<z.ZodObject>,
  next: DefinedVideoComponent<Schema>,
): ValidationResult<DefinedVideoComponent<Schema>> {
  const issues: ContractIssue[] = [];
  if (previous.id !== next.id) {
    issues.push({
      code: "invalid_id",
      path: ["id"],
      message: "A revision must retain its component id.",
    });
  }
  if (!gt(next.version, previous.version)) {
    issues.push({
      code: "invalid_version",
      path: ["version"],
      message: `A revision version must be greater than ${previous.version}.`,
    });
  }
  if (next.compatibility.mode === "initial") {
    issues.push({
      code: "compatibility_invalid",
      path: ["compatibility", "mode"],
      message:
        "A revision must declare whether it is backward-compatible or breaking.",
    });
  } else if (next.compatibility.previousVersion !== previous.version) {
    issues.push({
      code: "invalid_version",
      path: ["compatibility", "previousVersion"],
      message: `Expected previous version ${previous.version}.`,
    });
  }
  if (next.compatibility.mode === "backward-compatible") {
    previous.fixtures.forEach((fixture, index) => {
      const result = validateVideoComponentInput(next.schema, fixture.input);
      if (!result.success) {
        issues.push({
          code: "input_invalid",
          path: ["fixtures", index, "input"],
          message:
            "A backward-compatible revision must accept every prior fixture input.",
        });
      }
    });
  }
  return issues.length === 0
    ? { success: true, value: next }
    : { success: false, issues };
}

function resolveDuration<Input>(
  duration: number | ((input: Input) => number),
  input: Input,
): number {
  return typeof duration === "function" ? duration(input) : duration;
}

function checkUnique(
  values: readonly string[],
  pathPrefix: string,
  code: "asset_duplicate" | "checkpoint_duplicate" | "fixture_duplicate",
  message: string,
  issues: ContractIssue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value))
      issues.push({ code, path: [...pathPrefix.split("."), index], message });
    seen.add(value);
  });
}

function checkUniqueDimensions(
  dimensions: readonly VideoDimensions[],
  issues: ContractIssue[],
): void {
  const seen = new Set<string>();
  dimensions.forEach((item, index) => {
    const key = `${item.width}x${item.height}`;
    if (seen.has(key)) {
      issues.push({
        code: "dimension_duplicate",
        path: ["supportedDimensions", index],
        message: "Supported dimensions must be unique.",
      });
    }
    seen.add(key);
  });
}

function dimensionsEqual(
  left: VideoDimensions,
  right: VideoDimensions,
): boolean {
  return left.width === right.width && left.height === right.height;
}

function isValidDimensions(value: VideoDimensions): boolean {
  return isPositiveInteger(value.width) && isPositiveInteger(value.height);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidSemVer(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d*)\./.test(value) &&
    valid(value) !== null
  );
}

function isJsonValue(
  value: unknown,
  seen = new Set<object>(),
): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value))
    return value.every((item) => isJsonValue(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every((item) => isJsonValue(item, seen));
}

function formatPath(path: readonly (number | string)[]): string {
  return path.length === 0 ? "component" : path.join(".");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
