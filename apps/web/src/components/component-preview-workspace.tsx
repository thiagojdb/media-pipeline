"use client";

import React, {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  resolveVideoComponentDuration,
  validateVideoComponentInput,
  VideoComponentContractError,
  type ChannelTheme,
  type ContractIssue,
  type VideoDimensions,
} from "@relay/component-sdk";
import { VideoComponentFrame } from "@relay/rendering";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Pause,
  Play,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPreviewComponent } from "@/lib/preview-components";
import {
  checkpointFrame,
  clampFrame,
  fitStageScale,
  formatIssuePath,
  jsonSyntaxIssue,
  playbackFrameAtElapsedTime,
  playbackStartFrame,
  stepFrame,
} from "@/lib/preview-model";

const previewTheme: ChannelTheme = {
  colors: {
    background: "#07111f",
    foreground: "#f4f7fb",
    muted: "#91a3ba",
    grid: "#24364d",
    accent: "#ffb000",
    chartPrimary: "#00c2ff",
    chartSecondary: "#d76cff",
  },
  fonts: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
  spacing: { outer: 72 },
};

type JsonSchema = {
  readonly type?: string;
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
};

type InputRecord = Record<string, unknown>;

export function ComponentPreviewWorkspace({
  componentId,
  version,
}: {
  readonly componentId: string;
  readonly version: string;
}) {
  const definition = getPreviewComponent(componentId, version);
  if (!definition) {
    return <main className="p-8">Component version unavailable.</main>;
  }
  return <ResolvedPreviewWorkspace definition={definition} />;
}

function ResolvedPreviewWorkspace({
  definition,
}: {
  readonly definition: NonNullable<ReturnType<typeof getPreviewComponent>>;
}) {
  const firstFixture = definition.fixtures[0]!;
  const [fixtureId, setFixtureId] = useState(firstFixture.id);
  const fixture =
    definition.fixtures.find((item) => item.id === fixtureId) ?? firstFixture;
  const initialInput = fixture.input as InputRecord;
  const [draftInput, setDraftInput] = useState<InputRecord>(initialInput);
  const [validInput, setValidInput] = useState<InputRecord>(initialInput);
  const [compoundText, setCompoundText] = useState<Record<string, string>>(() =>
    compoundTextFor(initialInput, definition.inputControls as JsonSchema),
  );
  const [issues, setIssues] = useState<readonly ContractIssue[]>([]);
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(frame);
  const playbackOriginRef = useRef<{
    readonly frame: number;
    readonly timestamp: number;
  } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selectedDimensions, setSelectedDimensions] = useState<VideoDimensions>(
    definition.dimensions,
  );
  const [renderRevision, setRenderRevision] = useState(0);
  const [runtimeFailure, setRuntimeFailure] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly string[]>([]);
  const durationInFrames = resolveVideoComponentDuration(
    definition,
    validInput,
  );
  const controls = definition.inputControls as JsonSchema;

  useEffect(() => {
    if (!playing) return;
    const origin = playbackOriginRef.current ?? {
      frame: frameRef.current,
      timestamp: performance.now(),
    };
    playbackOriginRef.current = origin;
    let animationFrame = 0;

    const update = (timestamp: number) => {
      const next = playbackFrameAtElapsedTime(
        origin.frame,
        timestamp - origin.timestamp,
        definition.fps,
        durationInFrames,
      );
      frameRef.current = next.frame;
      setFrame(next.frame);
      if (next.complete) {
        playbackOriginRef.current = null;
        setPlaying(false);
        return;
      }
      animationFrame = window.requestAnimationFrame(update);
    };

    animationFrame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [definition.fps, durationInFrames, playing]);

  useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...values: unknown[]) => {
      const message = `Warning: ${safeDiagnostic(values)}`;
      window.queueMicrotask(() => appendDiagnostic(setDiagnostics, message));
      originalWarn(...values);
    };
    console.error = (...values: unknown[]) => {
      const message = `Error: ${safeDiagnostic(values)}`;
      window.queueMicrotask(() => appendDiagnostic(setDiagnostics, message));
      originalError(...values);
    };
    return () => {
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  const applyCandidate = (candidate: InputRecord) => {
    setDraftInput(candidate);
    const result = validateVideoComponentInput(definition.schema, candidate);
    if (!result.success) {
      setIssues(result.issues);
      return;
    }
    let nextDuration: number;
    try {
      nextDuration = resolveVideoComponentDuration(definition, result.value);
    } catch (error) {
      setIssues(
        error instanceof VideoComponentContractError
          ? error.issues
          : [
              {
                code: "duration_invalid",
                path: ["duration"],
                message:
                  error instanceof Error
                    ? error.message
                    : "Duration could not be resolved for this input.",
              },
            ],
      );
      return;
    }
    setIssues([]);
    setValidInput(result.value);
    setPlaying(false);
    playbackOriginRef.current = null;
    setFrame((current) => {
      const nextFrame = clampFrame(current, nextDuration);
      frameRef.current = nextFrame;
      return nextFrame;
    });
    setRuntimeFailure(null);
    setDiagnostics([]);
    setRenderRevision((current) => current + 1);
  };

  const changeFixture = (nextFixtureId: string) => {
    const nextFixture = definition.fixtures.find(
      (item) => item.id === nextFixtureId,
    );
    if (!nextFixture) return;
    const nextInput = nextFixture.input as InputRecord;
    setFixtureId(nextFixture.id);
    setDraftInput(nextInput);
    setValidInput(nextInput);
    setCompoundText(
      compoundTextFor(nextInput, definition.inputControls as JsonSchema),
    );
    setIssues([]);
    frameRef.current = 0;
    setFrame(0);
    playbackOriginRef.current = null;
    setPlaying(false);
    setRuntimeFailure(null);
    setDiagnostics([]);
    setRenderRevision((current) => current + 1);
  };

  const changePrimitive = (
    name: string,
    value: string | boolean | number | undefined,
  ) => {
    const candidate = { ...draftInput };
    if (value === undefined) delete candidate[name];
    else candidate[name] = value;
    applyCandidate(candidate);
  };

  const changeCompound = (name: string, value: string) => {
    setCompoundText((current) => ({ ...current, [name]: value }));
    try {
      const parsed = JSON.parse(value) as unknown;
      applyCandidate({ ...draftInput, [name]: parsed });
    } catch (error) {
      setDraftInput({ ...draftInput, [name]: value });
      setIssues([jsonSyntaxIssue(name, error)]);
    }
  };

  const handleRuntimeFailure = (error: Error, componentStack: string) => {
    playbackOriginRef.current = null;
    setPlaying(false);
    setRuntimeFailure(error.message);
    appendDiagnostic(
      setDiagnostics,
      `Runtime: ${error.message}${componentStack ? ` (${componentStack.trim().split("\n")[0]})` : ""}`,
    );
  };

  const recoverRuntimeFailure = () => {
    if (runtimeFailure) setRenderRevision((current) => current + 1);
    setRuntimeFailure(null);
  };

  const renderKey = `${fixture.id}:${renderRevision}:${dimensionKey(selectedDimensions)}`;
  const seconds = durationInFrames / definition.fps;

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] px-4 py-6 sm:px-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            Component preview
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {humanize(definition.id)}
          </h1>
          <p
            className="text-muted-foreground mt-2 font-mono text-sm"
            data-testid="component-identity"
          >
            {definition.id}@{definition.version}
          </p>
        </div>
        <div className="rounded-full border bg-white px-4 py-2 text-sm shadow-sm">
          {selectedDimensions.width} × {selectedDimensions.height} ·{" "}
          {definition.fps} fps · scaled to fit
        </div>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="overflow-hidden rounded-2xl border bg-[#050914] shadow-xl shadow-slate-950/10">
          <div
            className="relative h-[clamp(320px,56vw,820px)] w-full overflow-hidden"
            data-testid="preview-surface"
          >
            <PreviewErrorBoundary
              key={renderKey}
              onError={handleRuntimeFailure}
            >
              <ScaledPreviewStage dimensions={selectedDimensions}>
                <VideoComponentFrame
                  assets={{}}
                  definition={definition}
                  dimensions={selectedDimensions}
                  durationInFrames={durationInFrames}
                  frame={frame}
                  input={validInput}
                  theme={previewTheme}
                />
              </ScaledPreviewStage>
            </PreviewErrorBoundary>
            {runtimeFailure ? (
              <div
                className="absolute inset-0 flex items-center justify-center bg-slate-950/95 p-8 text-center"
                role="alert"
              >
                <div className="max-w-md text-white">
                  <CircleAlert className="mx-auto size-10 text-amber-400" />
                  <h2 className="mt-4 text-xl font-semibold">
                    Component could not render this frame
                  </h2>
                  <p className="mt-2 text-sm text-slate-300">
                    {runtimeFailure}
                  </p>
                  <p className="mt-4 text-xs text-slate-500">
                    The preview workspace is still available. Seek or change the
                    input to try again.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/10 bg-slate-950 px-4 py-4 text-white sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                aria-label={playing ? "Pause preview" : "Play preview"}
                onClick={() => {
                  recoverRuntimeFailure();
                  if (playing) {
                    playbackOriginRef.current = null;
                    setPlaying(false);
                    return;
                  }
                  const startFrame = playbackStartFrame(
                    frame,
                    durationInFrames,
                  );
                  frameRef.current = startFrame;
                  setFrame(startFrame);
                  playbackOriginRef.current = {
                    frame: startFrame,
                    timestamp: performance.now(),
                  };
                  setPlaying(true);
                }}
                size="icon"
                variant="secondary"
              >
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button
                aria-label="Step backward one frame"
                disabled={frame === 0}
                onClick={() => {
                  playbackOriginRef.current = null;
                  setPlaying(false);
                  recoverRuntimeFailure();
                  setFrame((current) => {
                    const nextFrame = stepFrame(current, -1, durationInFrames);
                    frameRef.current = nextFrame;
                    return nextFrame;
                  });
                }}
                size="icon"
                variant="ghost"
              >
                <ChevronLeft />
              </Button>
              <Button
                aria-label="Step forward one frame"
                disabled={frame === durationInFrames - 1}
                onClick={() => {
                  playbackOriginRef.current = null;
                  setPlaying(false);
                  recoverRuntimeFailure();
                  setFrame((current) => {
                    const nextFrame = stepFrame(current, 1, durationInFrames);
                    frameRef.current = nextFrame;
                    return nextFrame;
                  });
                }}
                size="icon"
                variant="ghost"
              >
                <ChevronRight />
              </Button>
              <label className="sr-only" htmlFor="frame-scrubber">
                Current frame
              </label>
              <input
                aria-valuetext={`Frame ${frame} of ${durationInFrames - 1}`}
                className="mx-2 min-w-40 flex-1 accent-cyan-400"
                id="frame-scrubber"
                max={durationInFrames - 1}
                min={0}
                onChange={(event) => {
                  playbackOriginRef.current = null;
                  setPlaying(false);
                  recoverRuntimeFailure();
                  const nextFrame = clampFrame(
                    Number(event.target.value),
                    durationInFrames,
                  );
                  frameRef.current = nextFrame;
                  setFrame(nextFrame);
                }}
                type="range"
                value={frame}
              />
              <output
                className="min-w-28 text-right font-mono text-sm"
                data-testid="frame-output"
              >
                Frame {frame} / {durationInFrames - 1}
              </output>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <span>
                {durationInFrames} frames · {seconds.toFixed(2)} seconds
              </span>
              <div className="flex flex-wrap gap-2">
                {fixture.checkpoints.map((checkpoint) => (
                  <button
                    className="rounded-full border border-white/15 px-3 py-1 hover:bg-white/10"
                    key={checkpoint.label}
                    onClick={() => {
                      playbackOriginRef.current = null;
                      setPlaying(false);
                      recoverRuntimeFailure();
                      const nextFrame = checkpointFrame(
                        checkpoint.frame,
                        durationInFrames,
                      );
                      frameRef.current = nextFrame;
                      setFrame(nextFrame);
                    }}
                    type="button"
                  >
                    {checkpoint.label} ·{" "}
                    {checkpointFrame(checkpoint.frame, durationInFrames)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <label className="text-sm font-semibold" htmlFor="dimensions">
              Dimensions
            </label>
            <select
              className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm"
              id="dimensions"
              onChange={(event) => {
                const dimensions = definition.supportedDimensions.find(
                  (item) => dimensionKey(item) === event.target.value,
                );
                if (dimensions) {
                  recoverRuntimeFailure();
                  setSelectedDimensions(dimensions);
                }
              }}
              value={dimensionKey(selectedDimensions)}
            >
              {definition.supportedDimensions.map((dimensions) => (
                <option
                  key={dimensionKey(dimensions)}
                  value={dimensionKey(dimensions)}
                >
                  {dimensions.width} × {dimensions.height}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground mt-2 text-xs">
              The selected size is passed unchanged to preview and rendering.
            </p>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <label className="text-sm font-semibold" htmlFor="fixture">
              Fixture
            </label>
            <select
              className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm"
              id="fixture"
              onChange={(event) => changeFixture(event.target.value)}
              value={fixture.id}
            >
              {definition.fixtures.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground mt-2 text-xs">
              Fixture id: {fixture.id}
            </p>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="font-semibold">Component inputs</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                Controls come from the public SDK metadata. Valid edits update
                the preview immediately.
              </p>
            </div>
            <div className="space-y-4">
              {Object.entries(controls.properties ?? {}).map(
                ([name, metadata]) => (
                  <InputControl
                    compoundValue={compoundText[name] ?? ""}
                    key={name}
                    metadata={metadata}
                    name={name}
                    onCompoundChange={changeCompound}
                    onPrimitiveChange={changePrimitive}
                    required={controls.required?.includes(name) ?? false}
                    value={draftInput[name]}
                  />
                ),
              )}
            </div>
            {issues.length > 0 ? (
              <div
                className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3"
                role="alert"
              >
                <p className="text-sm font-semibold text-red-900">
                  Input needs attention
                </p>
                <ul className="mt-2 space-y-2 text-sm text-red-800">
                  {issues.map((issue, index) => (
                    <li key={`${formatIssuePath(issue.path)}-${index}`}>
                      <span className="font-mono font-semibold">
                        {formatIssuePath(issue.path)}
                      </span>
                      : {issue.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-red-700">
                  Showing the last valid preview until these edits pass SDK
                  validation.
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-semibold">Component diagnostics</h2>
              {diagnostics.length > 0 ? (
                <button
                  className="text-muted-foreground text-xs underline"
                  onClick={() => setDiagnostics([])}
                  type="button"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {diagnostics.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                No component diagnostics captured.
              </p>
            ) : (
              <ul
                className="mt-3 max-h-40 space-y-2 overflow-auto font-mono text-xs text-amber-900"
                data-testid="diagnostics"
              >
                {diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic}-${index}`}>{diagnostic}</li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function ScaledPreviewStage({
  dimensions,
  children,
}: {
  readonly dimensions: VideoDimensions;
  readonly children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScale = () => {
      setScale(
        fitStageScale(dimensions, {
          width: viewport.clientWidth,
          height: viewport.clientHeight,
        }),
      );
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [dimensions]);

  return (
    <div className="absolute inset-0" ref={viewportRef}>
      <div
        data-height={dimensions.height}
        data-testid="preview-stage"
        data-width={dimensions.width}
        style={{
          height: dimensions.height,
          left: "50%",
          position: "absolute",
          top: "50%",
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
          width: dimensions.width,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function InputControl({
  name,
  metadata,
  required,
  value,
  compoundValue,
  onPrimitiveChange,
  onCompoundChange,
}: {
  readonly name: string;
  readonly metadata: JsonSchema;
  readonly required: boolean;
  readonly value: unknown;
  readonly compoundValue: string;
  readonly onPrimitiveChange: (
    name: string,
    value: string | boolean | number | undefined,
  ) => void;
  readonly onCompoundChange: (name: string, value: string) => void;
}) {
  const label = metadata.title ?? humanize(name);
  const hint = controlHint(metadata, required);
  const enumOptions = metadata.enum?.filter(
    (option): option is string | number | boolean =>
      typeof option === "string" ||
      typeof option === "number" ||
      typeof option === "boolean",
  );

  if (
    enumOptions &&
    enumOptions.length > 0 &&
    enumOptions.length === metadata.enum?.length
  ) {
    const selectedIndex = enumOptions.findIndex((option) =>
      Object.is(option, value),
    );
    return (
      <div>
        <label className="text-sm font-medium" htmlFor={`control-${name}`}>
          {label}
        </label>
        <select
          className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"
          id={`control-${name}`}
          onChange={(event) => {
            const index = Number(event.target.value);
            onPrimitiveChange(
              name,
              Number.isInteger(index) ? enumOptions[index] : undefined,
            );
          }}
          required={required}
          value={selectedIndex < 0 ? "" : String(selectedIndex)}
        >
          {!required ? <option value="">Not set</option> : null}
          {enumOptions.map((option, index) => (
            <option key={`${typeof option}:${String(option)}`} value={index}>
              {String(option)}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </div>
    );
  }

  if (metadata.type === "boolean") {
    return (
      <div>
        <label
          className="flex items-center justify-between gap-4 text-sm"
          htmlFor={`control-${name}`}
        >
          <span className="font-medium">{label}</span>
          <input
            checked={value === true}
            className="size-4 accent-slate-950"
            id={`control-${name}`}
            onChange={(event) => onPrimitiveChange(name, event.target.checked)}
            type="checkbox"
          />
        </label>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </div>
    );
  }

  if (metadata.type === "array" || metadata.type === "object") {
    return (
      <div>
        <label className="text-sm font-medium" htmlFor={`control-${name}`}>
          {label}
        </label>
        <textarea
          className="mt-1.5 min-h-24 w-full rounded-md border bg-white px-3 py-2 font-mono text-xs leading-5"
          id={`control-${name}`}
          onChange={(event) => onCompoundChange(name, event.target.value)}
          spellCheck={false}
          value={compoundValue}
        />
        <p className="text-muted-foreground mt-1 text-xs">{hint} · JSON</p>
      </div>
    );
  }

  const numeric = metadata.type === "number" || metadata.type === "integer";
  return (
    <div>
      <label className="text-sm font-medium" htmlFor={`control-${name}`}>
        {label}
      </label>
      <input
        className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"
        id={`control-${name}`}
        max={metadata.maximum}
        maxLength={metadata.maxLength}
        min={metadata.minimum}
        minLength={metadata.minLength}
        onChange={(event) => {
          const raw = event.target.value;
          if (!required && raw === "") onPrimitiveChange(name, undefined);
          else onPrimitiveChange(name, numeric ? Number(raw) : raw);
        }}
        required={required}
        type={numeric ? "number" : "text"}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
      />
      <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
    </div>
  );
}

class PreviewErrorBoundary extends Component<
  {
    readonly children: ReactNode;
    readonly onError: (error: Error, componentStack: string) => void;
  },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError(error, info.componentStack ?? "");
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function compoundTextFor(
  input: InputRecord,
  controls: JsonSchema,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(controls.properties ?? {})
      .filter(
        ([, metadata]) =>
          metadata.type === "array" || metadata.type === "object",
      )
      .map(([name]) => [
        name,
        JSON.stringify(
          input[name] ??
            (controls.properties?.[name]?.type === "array" ? [] : {}),
          null,
          2,
        ),
      ]),
  );
}

function controlHint(metadata: JsonSchema, required: boolean): string {
  const details = [required ? "Required" : "Optional"];
  if (metadata.description) details.push(metadata.description);
  if (metadata.default !== undefined)
    details.push(`Default: ${String(metadata.default)}`);
  if (metadata.maxItems !== undefined)
    details.push(`Up to ${metadata.maxItems} items`);
  if (metadata.maxLength !== undefined)
    details.push(`Up to ${metadata.maxLength} characters`);
  return details.join(" · ");
}

function dimensionKey(dimensions: VideoDimensions): string {
  return `${dimensions.width}x${dimensions.height}`;
}

function humanize(value: string): string {
  return value
    .replaceAll("-", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function appendDiagnostic(
  setDiagnostics: React.Dispatch<React.SetStateAction<readonly string[]>>,
  message: string,
): void {
  setDiagnostics((current) => {
    if (current.includes(message)) return current;
    return [...current.slice(-19), message];
  });
}

function safeDiagnostic(values: readonly unknown[]): string {
  return values
    .map((value) => {
      if (value instanceof Error) return value.message;
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return "[unserializable diagnostic]";
      }
    })
    .join(" ")
    .slice(0, 1000);
}
