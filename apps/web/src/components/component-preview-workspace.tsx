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
  Download,
  Film,
  LoaderCircle,
  Pause,
  Play,
  X,
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

const renderResolutionPresets = [
  { label: "720p HD", width: 1280, height: 720 },
  { label: "1080p Full HD", width: 1920, height: 1080 },
  { label: "1440p QHD", width: 2560, height: 1440 },
  { label: "4K UHD", width: 3840, height: 2160 },
] as const;

const renderQualityPresets = [
  {
    id: "master",
    label: "Master graphics",
    crf: 1,
    pixelFormat: "yuv444p",
  },
  { id: "high", label: "High", crf: 10, pixelFormat: "yuv444p" },
  { id: "compatible", label: "Compatible", crf: 18, pixelFormat: "yuv420p" },
  { id: "compact", label: "Compact", crf: 28, pixelFormat: "yuv420p" },
] as const;

type DraftRenderSnapshot = {
  readonly id: string;
  readonly state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  readonly progress: number;
  readonly component: {
    readonly id: string;
    readonly version: string;
    readonly fixtureId: string;
  };
  readonly settings: {
    readonly fps: number;
    readonly durationInFrames: number;
    readonly dimensions: VideoDimensions;
    readonly quality: {
      readonly codec: "h264";
      readonly crf: number;
      readonly pixelFormat: "yuv420p" | "yuv444p";
    };
  };
  readonly reproducibilityKey: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly output?: {
    readonly href: string;
    readonly mediaType: "video/mp4";
    readonly sizeBytes: number;
    readonly contentHash: string;
    readonly visualFingerprint: string;
  };
  readonly error?: { readonly code: string; readonly message: string };
};

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
  const renderResolutionOptions = renderResolutionPresets.filter((preset) =>
    definition.supportedDimensions.some(
      ({ width, height }) => width === preset.width && height === preset.height,
    ),
  );
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
  const [renderDimensions, setRenderDimensions] = useState<
    VideoDimensions | undefined
  >(() => {
    const preset = renderResolutionOptions[0];
    return preset ? { width: preset.width, height: preset.height } : undefined;
  });
  const [renderQualityId, setRenderQualityId] = useState("master");
  const renderQuality =
    renderQualityPresets.find(({ id }) => id === renderQualityId) ??
    renderQualityPresets[0];
  const [renderRevision, setRenderRevision] = useState(0);
  const [runtimeFailure, setRuntimeFailure] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly string[]>([]);
  const [draftRender, setDraftRender] = useState<DraftRenderSnapshot | null>(
    null,
  );
  const [draftRenderError, setDraftRenderError] = useState<string | null>(null);
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
    if (
      !draftRender ||
      (draftRender.state !== "queued" && draftRender.state !== "running")
    ) {
      return;
    }
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/draft-renders/${draftRender.id}`, {
          cache: "no-store",
        });
        const snapshot = await readRenderResponse(response);
        if (disposed) return;
        setDraftRender(snapshot);
        if (snapshot.state === "queued" || snapshot.state === "running") {
          timer = window.setTimeout(poll, 250);
        }
      } catch (error) {
        if (!disposed) {
          setDraftRenderError(
            error instanceof Error ? error.message : "Render status failed.",
          );
        }
      }
    };
    timer = window.setTimeout(poll, 100);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [draftRender]);

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

  const startDraftRender = async () => {
    if (!renderDimensions || issues.length > 0 || runtimeFailure) return;
    setDraftRenderError(null);
    try {
      const response = await fetch("/api/draft-renders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          componentId: definition.id,
          version: definition.version,
          fixtureId: fixture.id,
          input: validInput,
          fps: definition.fps,
          durationInFrames,
          dimensions: renderDimensions,
          theme: previewTheme,
          quality: {
            codec: "h264",
            crf: renderQuality.crf,
            pixelFormat: renderQuality.pixelFormat,
          },
        }),
      });
      setDraftRender(await readRenderResponse(response));
    } catch (error) {
      setDraftRenderError(
        error instanceof Error
          ? error.message
          : "Draft render could not start.",
      );
    }
  };

  const cancelDraftRender = async () => {
    if (!draftRender) return;
    try {
      const response = await fetch(
        `/api/draft-renders/${draftRender.id}/cancel`,
        { method: "POST" },
      );
      setDraftRender(await readRenderResponse(response));
    } catch (error) {
      setDraftRenderError(
        error instanceof Error
          ? error.message
          : "Draft render could not cancel.",
      );
    }
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
            <div className="flex items-start gap-3">
              <Film className="mt-0.5 size-5 text-cyan-700" />
              <div>
                <h2 className="font-semibold">MP4 render</h2>
                <p className="text-muted-foreground mt-1 text-xs">
                  The Node worker renders the exact component version, fixture,
                  validated input, resolution, and frame settings shown here.
                </p>
              </div>
            </div>
            <label
              className="mt-4 block text-xs font-semibold"
              htmlFor="render-resolution"
            >
              Render resolution
            </label>
            <select
              className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm"
              disabled={renderResolutionOptions.length === 0}
              id="render-resolution"
              onChange={(event) => {
                const selected = renderResolutionOptions.find(
                  ({ width, height }) =>
                    dimensionKey({ width, height }) === event.target.value,
                );
                if (selected) {
                  setRenderDimensions({
                    width: selected.width,
                    height: selected.height,
                  });
                }
              }}
              value={renderDimensions ? dimensionKey(renderDimensions) : ""}
            >
              {renderResolutionOptions.map((preset) => (
                <option key={dimensionKey(preset)} value={dimensionKey(preset)}>
                  {preset.label} · {preset.width} × {preset.height}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground mt-2 text-xs">
              Higher resolutions take longer and use more worker memory. Safe
              processing runs one render and one frame worker at a time with
              reduced OS priority.
            </p>

            <label
              className="mt-4 block text-xs font-semibold"
              htmlFor="render-quality"
            >
              Render quality
            </label>
            <select
              className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm"
              id="render-quality"
              onChange={(event) => setRenderQualityId(event.target.value)}
              value={renderQuality.id}
            >
              {renderQualityPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label} · CRF {preset.crf} ·{" "}
                  {preset.pixelFormat === "yuv444p" ? "4:4:4" : "4:2:0"}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground mt-2 text-xs">
              Master graphics is the default and preserves colored edges and
              text with 4:4:4 chroma. Compatible uses 4:2:0 for older playback
              hardware but can show edge noise.
            </p>

            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-slate-50 p-2">
                <dt className="text-muted-foreground">Output</dt>
                <dd className="mt-1 font-mono">
                  {renderDimensions
                    ? `${renderDimensions.width}×${renderDimensions.height}`
                    : "Unavailable"}
                </dd>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <dt className="text-muted-foreground">Quality</dt>
                <dd className="mt-1 font-mono">
                  H.264 · {renderQuality.label} · CRF {renderQuality.crf} ·{" "}
                  {renderQuality.pixelFormat === "yuv444p" ? "4:4:4" : "4:2:0"}
                </dd>
              </div>
            </dl>

            {!draftRender ||
            draftRender.state === "failed" ||
            draftRender.state === "canceled" ||
            draftRender.state === "succeeded" ? (
              <Button
                className="mt-4 w-full"
                disabled={
                  !renderDimensions ||
                  issues.length > 0 ||
                  runtimeFailure !== null
                }
                onClick={() => void startDraftRender()}
              >
                <Film /> Render MP4
              </Button>
            ) : (
              <Button
                className="mt-4 w-full"
                onClick={() => void cancelDraftRender()}
                variant="outline"
              >
                <X /> Cancel render
              </Button>
            )}

            {issues.length > 0 ? (
              <p className="mt-2 text-xs text-amber-700">
                Fix input errors before starting a render.
              </p>
            ) : null}
            {draftRender ? (
              <div className="mt-4" data-testid="draft-render-status">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium capitalize">
                    {draftRender.state === "queued" ||
                    draftRender.state === "running" ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {draftRender.state}
                  </span>
                  <span>{Math.round(draftRender.progress * 100)}%</span>
                </div>
                <div
                  aria-label="Draft render progress"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={Math.round(draftRender.progress * 100)}
                  className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                >
                  <div
                    className="h-full bg-cyan-600 transition-[width]"
                    style={{ width: `${draftRender.progress * 100}%` }}
                  />
                </div>
                <p className="text-muted-foreground mt-2 truncate font-mono text-[10px]">
                  {draftRender.component.id}@{draftRender.component.version} ·{" "}
                  {draftRender.component.fixtureId}
                </p>
                {draftRender.startedAt ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Render time: {renderElapsedMilliseconds(draftRender)} ms
                  </p>
                ) : null}
                {draftRender.state === "succeeded" && draftRender.output ? (
                  <a
                    className="mt-3 flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-medium text-white"
                    download
                    href={`/api/draft-renders/${draftRender.id}/output`}
                  >
                    <Download /> Download MP4
                  </a>
                ) : null}
                {draftRender.error ? (
                  <p className="mt-3 text-sm text-red-700" role="alert">
                    {draftRender.error.message}
                  </p>
                ) : null}
              </div>
            ) : null}
            {draftRenderError ? (
              <p className="mt-3 text-sm text-red-700" role="alert">
                {draftRenderError}
              </p>
            ) : null}
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

function renderElapsedMilliseconds(render: DraftRenderSnapshot): number {
  const started = Date.parse(render.startedAt ?? render.createdAt);
  const finished = render.finishedAt
    ? Date.parse(render.finishedAt)
    : Date.now();
  return Math.max(0, finished - started);
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

async function readRenderResponse(
  response: Response,
): Promise<DraftRenderSnapshot> {
  const body = (await response.json()) as
    DraftRenderSnapshot | { readonly message?: string };
  if (!response.ok) {
    throw new Error(
      "message" in body && body.message
        ? body.message
        : `Render worker request failed with status ${response.status}.`,
    );
  }
  return body as DraftRenderSnapshot;
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
