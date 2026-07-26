"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { compositionFrameAtTime, segmentFrameAtTime } from "@relay/rendering";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Boxes,
  CircleStop,
  Clapperboard,
  ExternalLink,
  FileText,
  FolderKanban,
  Globe2,
  Link2,
  LoaderCircle,
  PencilLine,
  Pause,
  Play,
  Plus,
  Save,
  Scissors,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type Project = {
  _id: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

type Channel = { id: string; slug: string; name: string };

type Source = {
  _id: string;
  kind: "url" | "file";
  title: string;
  normalizedUrl?: string;
  fileName?: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
  createdAt: number;
  downloadUrl?: string;
};

type ScriptVersion = {
  _id: string;
  version: number;
  content: string;
  provenance: "manual" | "import";
  createdAt: number;
};

type ScriptVersionSummary = Omit<ScriptVersion, "content"> & {
  characterCount: number;
  excerpt: string;
};

type NarrationVersion = {
  _id: string;
  scriptVersionId?: string;
  version: number;
  provenance?: "generated" | "upload";
  fileName?: string;
  audioUrl?: string;
  durationMs: number;
  timingSegments: Array<{
    index: number;
    startMs: number;
    endMs: number;
    text: string;
  }>;
  provider?: string;
  model?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  usageCharacters?: number;
  estimatedCostUsd?: number;
  wallTimeMs?: number;
  createdAt: number;
};

type NarrationJob = {
  _id: string;
  scriptVersionId?: string;
  kind?: "generated" | "upload";
  state:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"
    | "needs_intervention";
  cancelRequested: boolean;
  provider: string;
  model: string;
  terminalMessage?: string;
  createdAt: number;
};

type Beat = {
  _id?: string | undefined;
  narrationVersionId: string;
  order: number;
  startMs: number;
  endMs: number;
  title: string;
  summary?: string | undefined;
};

type BeatData = {
  currentNarrationVersionId: string | null;
  narrationVersions: Array<{
    _id: string;
    version: number;
    durationMs: number;
  }>;
  beats: Beat[];
};

type Composition = {
  schemaVersion: 1;
  narrationVersionId: string;
  fps: number;
  width: number;
  height: number;
  segments: CompositionSegment[];
};

type CompositionSegment = {
  id: string;
  kind: "component";
  componentVersionId: string;
  input: unknown;
  anchor:
    | { kind: "time"; startMs: number; endMs: number }
    | {
        kind: "beat";
        beatId: string;
        startMs: number;
        endMs: number;
      };
};

type CompositionData = {
  current: {
    _id: string;
    version: number;
    provenance: "manual" | "agent";
    composition: Composition;
    createdAt: number;
  } | null;
  versions: Array<{
    _id: string;
    version: number;
    provenance: "manual" | "agent";
    segmentCount: number;
    createdAt: number;
  }>;
};

type LibraryItem = {
  componentId: string;
  latestVersion: { id: string; version: string };
};

type JsonInputSchema = {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JsonInputSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
};

type LibraryDetail = {
  componentId: string;
  latestApprovedVersionId: string;
  versions: Array<{
    id: string;
    version: string;
    inputSchemaJson: string;
    fixtures: Array<{ input?: Record<string, unknown> }>;
  }>;
};

export function ProjectListWorkspace() {
  const [data, setData] = useState<{ channel: Channel; projects: Project[] }>();
  const [error, setError] = useState<string>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    void request<{ channel: Channel; projects: Project[] }>("/api/projects")
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(undefined);
    try {
      const result = await request<{ projectId: string }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      window.location.assign(`/projects/${result.projectId}`);
    } catch (cause) {
      setError(errorMessage(cause));
      setCreating(false);
    }
  };

  const active = data?.projects.filter(
    (project) => project.status === "active",
  );
  const archived = data?.projects.filter(
    (project) => project.status === "archived",
  );

  return (
    <ProjectShell channelName={data?.channel.name}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
            Channel productions
          </p>
          <h1 className="mt-2 max-w-2xl text-4xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-5xl">
            Every video starts with a project.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            Keep each production inside its channel from the first source to the
            final cut. Archived work remains available as a record.
          </p>

          {error ? <ProjectError message={error} /> : null}
          {!data && !error ? (
            <ProjectLoading label="Opening projects…" />
          ) : null}

          {active?.length ? (
            <ProjectSection label="In production" projects={active} />
          ) : data ? (
            <section className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12">
              <Clapperboard className="size-7 text-slate-400" />
              <h2 className="mt-4 text-lg font-semibold">No active projects</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Name the production in the project slate to begin.
              </p>
            </section>
          ) : null}

          {archived?.length ? (
            <ProjectSection label="Archive" projects={archived} subdued />
          ) : null}
        </div>

        <form
          className="sticky top-6 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-xl shadow-slate-950/10"
          onSubmit={create}
        >
          <div className="border-b border-white/10 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-white text-slate-950">
                <Plus className="size-4" />
              </div>
              <div>
                <p className="text-xs tracking-[0.16em] text-slate-400 uppercase">
                  Project slate
                </p>
                <h2 className="font-semibold">Start a production</h2>
              </div>
            </div>
          </div>
          <div className="space-y-5 px-6 py-6">
            <label className="block text-sm font-medium" htmlFor="project-name">
              Project name
            </label>
            <input
              autoComplete="off"
              className="mt-[-0.75rem] h-11 w-full rounded-lg border border-white/15 bg-white/8 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/50 focus:ring-2 focus:ring-white/10"
              id="project-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Election night explained"
              required
              value={name}
            />
            <label
              className="block text-sm font-medium"
              htmlFor="project-description"
            >
              Production note <span className="text-slate-500">optional</span>
            </label>
            <textarea
              className="mt-[-0.75rem] min-h-28 w-full resize-y rounded-lg border border-white/15 bg-white/8 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-white/50 focus:ring-2 focus:ring-white/10"
              id="project-description"
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this video trying to explain?"
              value={description}
            />
            <Button
              className="w-full bg-white text-slate-950 hover:bg-slate-200"
              disabled={creating || !name.trim()}
              type="submit"
            >
              {creating ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Create project
            </Button>
          </div>
        </form>
      </div>
    </ProjectShell>
  );
}

export function ProjectDetailWorkspace({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ channel: Channel; project: Project }>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const value = await request<{ channel: Channel; project: Project }>(
      `/api/projects/${projectId}`,
    );
    setData(value);
    setName(value.project.name);
    setDescription(value.project.description ?? "");
  };

  useEffect(() => {
    let active = true;
    void request<{ channel: Channel; project: Project }>(
      `/api/projects/${projectId}`,
    )
      .then((value) => {
        if (!active) return;
        setData(value);
        setName(value.project.name);
        setDescription(value.project.description ?? "");
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const update = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await request(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", name, description }),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await request(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProjectShell channelName={data?.channel.name}>
      <a
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950"
        href="/projects"
      >
        <ArrowLeft className="size-4" /> All projects
      </a>
      {error ? <ProjectError message={error} /> : null}
      {!data && !error ? <ProjectLoading label="Opening project…" /> : null}
      {data ? (
        <>
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div
                className={`h-2 ${
                  data.project.status === "active"
                    ? "bg-blue-600"
                    : "bg-slate-300"
                }`}
              />
              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
                      {data.project.status === "active"
                        ? "In production"
                        : "Archived production"}
                    </p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                      {data.project.name}
                    </h1>
                  </div>
                  <StatusPill status={data.project.status} />
                </div>

                {data.project.status === "active" ? (
                  <form className="mt-10 max-w-2xl space-y-5" onSubmit={update}>
                    <label
                      className="block text-sm font-medium"
                      htmlFor="edit-name"
                    >
                      Project name
                    </label>
                    <input
                      className="mt-[-0.75rem] h-11 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      id="edit-name"
                      maxLength={120}
                      onChange={(event) => setName(event.target.value)}
                      required
                      value={name}
                    />
                    <label
                      className="block text-sm font-medium"
                      htmlFor="edit-description"
                    >
                      Production note
                    </label>
                    <textarea
                      className="mt-[-0.75rem] min-h-32 w-full resize-y rounded-lg border bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      id="edit-description"
                      maxLength={2000}
                      onChange={(event) => setDescription(event.target.value)}
                      value={description}
                    />
                    <Button disabled={saving || !name.trim()} type="submit">
                      {saving ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <PencilLine />
                      )}
                      Save changes
                    </Button>
                  </form>
                ) : (
                  <div className="mt-10 max-w-2xl rounded-xl bg-slate-100 p-5">
                    <p className="text-sm font-medium">
                      This project is read-only.
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {data.project.description ||
                        "No production note was saved."}
                    </p>
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium tracking-[0.16em] text-slate-500 uppercase">
                  Production record
                </p>
                <dl className="mt-4 space-y-4 text-sm">
                  <div>
                    <dt className="text-slate-500">Created</dt>
                    <dd className="mt-1 font-medium">
                      {formatDate(data.project.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Last updated</dt>
                    <dd className="mt-1 font-medium">
                      {formatDate(data.project.updatedAt)}
                    </dd>
                  </div>
                </dl>
              </div>
              {data.project.status === "active" ? (
                <Button
                  className="w-full"
                  disabled={saving}
                  onClick={archive}
                  variant="outline"
                >
                  <Archive /> Archive project
                </Button>
              ) : null}
            </aside>
          </div>
          <ScriptWorkspace
            editable={data.project.status === "active"}
            projectId={projectId}
          />
          <NarrationWorkspace
            editable={data.project.status === "active"}
            projectId={projectId}
          />
          <BeatWorkspace
            editable={data.project.status === "active"}
            projectId={projectId}
          />
          <CompositionWorkspace
            editable={data.project.status === "active"}
            projectId={projectId}
          />
          <ProjectCompositionPreview projectId={projectId} />
          <SourceWorkspace
            editable={data.project.status === "active"}
            projectId={projectId}
          />
        </>
      ) : null}
    </ProjectShell>
  );
}

function ProjectCompositionPreview({ projectId }: { projectId: string }) {
  const [compositionData, setCompositionData] = useState<CompositionData>();
  const [narrations, setNarrations] = useState<NarrationVersion[]>([]);
  const [beatData, setBeatData] = useState<BeatData>();
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string>();
  const audioRef = useRef<HTMLAudioElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    const [compositions, narrationData, beats] = await Promise.all([
      request<CompositionData>(`/api/projects/${projectId}/compositions`),
      request<{ versions: NarrationVersion[] }>(
        `/api/projects/${projectId}/narrations`,
      ),
      request<BeatData>(`/api/projects/${projectId}/beats`),
    ]);
    setCompositionData(compositions);
    setNarrations(narrationData.versions);
    setBeatData(beats);
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(errorMessage(cause)));
    }, 0);
    const onCompositionSaved = () => void load();
    window.addEventListener("relay-composition-saved", onCompositionSaved);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("relay-composition-saved", onCompositionSaved);
    };
  }, [load]);

  useEffect(() => {
    if (!playing) return;
    let frameRequest = 0;
    const update = () => {
      if (audioRef.current) {
        setCurrentMs(audioRef.current.currentTime * 1_000);
      }
      frameRequest = window.requestAnimationFrame(update);
    };
    frameRequest = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frameRequest);
  }, [playing]);

  const composition = compositionData?.current?.composition;
  const narration = narrations.find(
    (version) => version._id === composition?.narrationVersionId,
  );
  const durationMs = narration?.durationMs ?? 0;
  const activeSegment = composition?.segments.find(
    (segment) =>
      currentMs >= segment.anchor.startMs && currentMs < segment.anchor.endMs,
  );
  const relativeFrame =
    composition && activeSegment
      ? segmentFrameAtTime(
          currentMs,
          activeSegment.anchor.startMs,
          composition.fps,
        )
      : 0;

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "relay-preview-frame-v1", frame: relativeFrame },
      "*",
    );
  }, [activeSegment?.id, relativeFrame]);

  const seek = (nextMs: number) => {
    const clamped = Math.max(0, Math.min(nextMs, durationMs));
    if (audioRef.current) audioRef.current.currentTime = clamped / 1_000;
    setCurrentMs(clamped);
  };
  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch (cause) {
        setError(errorMessage(cause));
      }
    } else {
      audio.pause();
    }
  };
  const previewBeats =
    beatData?.beats.filter(
      (beat) => beat.narrationVersionId === composition?.narrationVersionId,
    ) ?? [];
  const previewUrl =
    activeSegment?.kind === "component"
      ? `/api/component-loop/versions/${activeSegment.componentVersionId}/preview?${new URLSearchParams(
          {
            frame: "0",
            input: browserBase64Url(JSON.stringify(activeSegment.input)),
          },
        )}`
      : undefined;

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-sm">
      <div className="border-b border-white/10 px-6 py-5 sm:px-8">
        <p className="text-xs font-medium tracking-[0.18em] text-slate-400 uppercase">
          Synchronized preview
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            Watch the composition on narration time
          </h2>
          {compositionData?.current ? (
            <span className="rounded-full bg-white/10 px-3 py-1.5 font-mono text-xs">
              v{compositionData.current.version} · {composition?.fps} fps
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-6 sm:p-8">
        {error ? (
          <div
            className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {!compositionData ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <LoaderCircle className="size-4 animate-spin" /> Opening preview…
          </div>
        ) : null}
        {composition && narration?.audioUrl ? (
          <>
            <div
              className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-white/10 bg-black"
              data-testid="composition-render-frame"
              style={{
                aspectRatio: `${composition.width}/${composition.height}`,
              }}
            >
              {previewUrl ? (
                <iframe
                  className="size-full border-0"
                  key={activeSegment?.id}
                  onLoad={() =>
                    frameRef.current?.contentWindow?.postMessage(
                      {
                        type: "relay-preview-frame-v1",
                        frame: relativeFrame,
                      },
                      "*",
                    )
                  }
                  ref={frameRef}
                  sandbox="allow-scripts"
                  src={previewUrl}
                  title="Composition rendered frame"
                />
              ) : (
                <div className="size-full bg-black" />
              )}
            </div>
            <audio
              onEnded={() => setPlaying(false)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onTimeUpdate={(event) =>
                setCurrentMs(event.currentTarget.currentTime * 1_000)
              }
              preload="metadata"
              ref={audioRef}
              src={narration.audioUrl}
            >
              <track kind="captions" />
            </audio>
            <div className="mx-auto mt-5 max-w-5xl">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  aria-label={
                    playing ? "Pause composition" : "Play composition"
                  }
                  className="border-white/20 text-white hover:bg-white/10"
                  onClick={() => void togglePlayback()}
                  variant="outline"
                >
                  {playing ? <Pause /> : <Play />}
                  {playing ? "Pause" : "Play"}
                </Button>
                <input
                  aria-label="Composition timeline"
                  className="min-w-48 flex-1 accent-blue-400"
                  max={durationMs}
                  min={0}
                  onChange={(event) => seek(Number(event.target.value))}
                  step={1}
                  type="range"
                  value={Math.min(currentMs, durationMs)}
                />
                <output
                  className="min-w-32 text-right font-mono text-xs text-slate-300"
                  data-testid="composition-frame-output"
                >
                  frame{" "}
                  {compositionFrameAtTime(
                    Math.min(currentMs, durationMs),
                    composition.fps,
                  )}{" "}
                  · {formatTimestamp(currentMs)}
                </output>
              </div>
              <div
                className="mt-4 flex flex-wrap gap-2"
                data-testid="preview-editing-overlays"
              >
                {previewBeats.map((beat) => (
                  <button
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
                    key={beat._id}
                    onClick={() => seek(beat.startMs)}
                    type="button"
                  >
                    {beat.title} · frame{" "}
                    {compositionFrameAtTime(beat.startMs, composition.fps)}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {activeSegment
                  ? `Rendering ${activeSegment.id} at segment frame ${relativeFrame}.`
                  : "No visual segment covers this narration frame."}{" "}
                Timeline markers remain outside the rendered frame.
              </p>
            </div>
          </>
        ) : compositionData?.current ? (
          <p className="text-sm text-slate-400">
            The pinned narration audio is unavailable for preview.
          </p>
        ) : compositionData ? (
          <p className="text-sm text-slate-400">
            Save a composition version to open the synchronized preview.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CompositionWorkspace({
  editable,
  projectId,
}: {
  editable: boolean;
  projectId: string;
}) {
  const [data, setData] = useState<CompositionData>();
  const [beatData, setBeatData] = useState<BeatData>();
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [detail, setDetail] = useState<LibraryDetail>();
  const [componentId, setComponentId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [beatId, setBeatId] = useState("");
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [savedVersion, setSavedVersion] = useState<number>();

  const load = useCallback(async () => {
    const [compositionData, beats, items] = await Promise.all([
      request<CompositionData>(`/api/projects/${projectId}/compositions`),
      request<BeatData>(`/api/projects/${projectId}/beats`),
      request<LibraryItem[]>("/api/component-loop/library"),
    ]);
    setData(compositionData);
    setBeatData(beats);
    setLibrary(items);
    setDraftInputs(
      Object.fromEntries(
        (compositionData.current?.composition.segments ?? []).map((segment) => [
          segment.id,
          JSON.stringify(segment.input, null, 2),
        ]),
      ),
    );
    const nextComponentId = componentId || items[0]?.componentId || "";
    setComponentId(nextComponentId);
    setBeatId(
      (current) =>
        current ||
        beats.beats.find(
          (beat) => beat.narrationVersionId === beats.currentNarrationVersionId,
        )?._id ||
        "",
    );
    if (nextComponentId) {
      const nextDetail = await request<LibraryDetail>(
        `/api/component-loop/library/${encodeURIComponent(nextComponentId)}`,
      );
      setDetail(nextDetail);
      const nextVersionId = versionId || nextDetail.latestApprovedVersionId;
      setVersionId(nextVersionId);
      const selected = nextDetail.versions.find(
        (version) => version.id === nextVersionId,
      );
      setInput(
        selected?.fixtures[0]?.input ?? defaultInput(inputSchema(selected)),
      );
    }
  }, [componentId, projectId, versionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(errorMessage(cause)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const chooseComponent = async (nextComponentId: string) => {
    setComponentId(nextComponentId);
    setError(undefined);
    try {
      const nextDetail = await request<LibraryDetail>(
        `/api/component-loop/library/${encodeURIComponent(nextComponentId)}`,
      );
      setDetail(nextDetail);
      setVersionId(nextDetail.latestApprovedVersionId);
      const version = nextDetail.versions.find(
        (item) => item.id === nextDetail.latestApprovedVersionId,
      );
      setInput(
        version?.fixtures[0]?.input ?? defaultInput(inputSchema(version)),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const chooseVersion = (nextVersionId: string) => {
    setVersionId(nextVersionId);
    const version = detail?.versions.find((item) => item.id === nextVersionId);
    setInput(version?.fixtures[0]?.input ?? defaultInput(inputSchema(version)));
  };

  const persist = async (composition: Composition) => {
    setBusy(true);
    setError(undefined);
    setSavedVersion(undefined);
    try {
      const result = await request<{ version: number }>(
        `/api/projects/${projectId}/compositions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provenance: "manual", composition }),
        },
      );
      setSavedVersion(result.version);
      await load();
      window.dispatchEvent(new Event("relay-composition-saved"));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const insert = async () => {
    const beat = beatData?.beats.find((item) => item._id === beatId);
    const narrationVersionId =
      data?.current?.composition.narrationVersionId ??
      beatData?.currentNarrationVersionId;
    if (!beat || !narrationVersionId || !versionId) return;
    const base =
      data?.current?.composition ??
      ({
        schemaVersion: 1,
        narrationVersionId,
        fps: 30,
        width: 1_920,
        height: 1_080,
        segments: [],
      } satisfies Composition);
    const segment: CompositionSegment = {
      id: `segment-${Date.now()}`,
      kind: "component",
      componentVersionId: versionId,
      input,
      anchor: {
        kind: "beat",
        beatId: beat._id!,
        startMs: beat.startMs,
        endMs: beat.endMs,
      },
    };
    await persist({
      ...base,
      segments: [...base.segments, segment].sort(
        (left, right) => left.anchor.startMs - right.anchor.startMs,
      ),
    });
  };

  const editSegment = async (segmentId: string) => {
    const current = data?.current?.composition;
    if (!current) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftInputs[segmentId] ?? "{}");
    } catch {
      setError("Component input must be valid JSON.");
      return;
    }
    await persist({
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === segmentId ? { ...segment, input: parsed } : segment,
      ),
    });
  };

  const moveToBeat = async (segmentId: string, nextBeatId: string) => {
    const current = data?.current?.composition;
    const beat = beatData?.beats.find((item) => item._id === nextBeatId);
    if (!current || !beat) return;
    await persist({
      ...current,
      segments: current.segments
        .map((segment) =>
          segment.id === segmentId
            ? {
                ...segment,
                anchor: {
                  kind: "beat" as const,
                  beatId: beat._id!,
                  startMs: beat.startMs,
                  endMs: beat.endMs,
                },
              }
            : segment,
        )
        .sort((left, right) => left.anchor.startMs - right.anchor.startMs),
    });
  };

  const removeSegment = async (segmentId: string) => {
    const current = data?.current?.composition;
    if (!current) return;
    await persist({
      ...current,
      segments: current.segments.filter((segment) => segment.id !== segmentId),
    });
  };

  const selectedVersion = detail?.versions.find(
    (version) => version.id === versionId,
  );
  const currentBeats =
    beatData?.beats.filter(
      (beat) =>
        beat.narrationVersionId ===
        (data?.current?.composition.narrationVersionId ??
          beatData.currentNarrationVersionId),
    ) ?? [];

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
        <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
          Project composition
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            Place approved visuals on the story
          </h2>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-600">
            {data?.current
              ? `Current · v${data.current.version}`
              : "No composition yet"}
          </span>
        </div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="p-6 sm:p-8">
          {error ? <ProjectError message={error} /> : null}
          {savedVersion ? (
            <p className="mb-4 text-sm font-medium text-emerald-700">
              Composition version {savedVersion} saved.
            </p>
          ) : null}
          {!data ? <ProjectLoading label="Opening composition…" /> : null}
          {data?.current?.composition.segments.length ? (
            <ol className="space-y-4">
              {data.current.composition.segments.map((segment, index) => (
                <li
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  key={segment.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500 uppercase">
                        Segment {index + 1} ·{" "}
                        {formatTimestamp(segment.anchor.startMs)}–
                        {formatTimestamp(segment.anchor.endMs)}
                      </p>
                      <strong className="mt-1 block text-sm">
                        Approved component ·{" "}
                        {componentVersionLabel(
                          segment.componentVersionId,
                          library,
                          detail,
                        )}
                      </strong>
                    </div>
                    <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs text-blue-800">
                      {segment.anchor.kind === "beat"
                        ? "Beat anchored"
                        : "Time anchored"}
                    </span>
                  </div>
                  <label className="mt-4 block text-xs font-medium text-slate-600">
                    Component inputs
                    <textarea
                      aria-label={`Segment ${index + 1} inputs`}
                      className="mt-1 min-h-28 w-full rounded-lg border bg-white p-3 font-mono text-xs"
                      onChange={(event) =>
                        setDraftInputs((current) => ({
                          ...current,
                          [segment.id]: event.target.value,
                        }))
                      }
                      value={
                        draftInputs[segment.id] ??
                        JSON.stringify(segment.input, null, 2)
                      }
                    />
                  </label>
                  {editable ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        disabled={busy}
                        onClick={() => void editSegment(segment.id)}
                        size="sm"
                        variant="outline"
                      >
                        Save inputs
                      </Button>
                      <label className="text-xs text-slate-600">
                        Move to beat
                        <select
                          aria-label={`Segment ${index + 1} beat`}
                          className="ml-2 h-9 rounded-lg border bg-white px-2 text-sm"
                          disabled={busy}
                          onChange={(event) =>
                            void moveToBeat(segment.id, event.target.value)
                          }
                          value={
                            segment.anchor.kind === "beat"
                              ? segment.anchor.beatId
                              : ""
                          }
                        >
                          <option value="">Select beat</option>
                          {currentBeats.map((beat) => (
                            <option key={beat._id} value={beat._id}>
                              {beat.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        disabled={busy}
                        onClick={() => void removeSegment(segment.id)}
                        size="sm"
                        variant="outline"
                      >
                        <Trash2 /> Remove
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : data ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <Clapperboard className="mx-auto size-6 text-slate-400" />
              <p className="mt-3 text-sm text-slate-500">
                Insert the first approved component at a semantic beat.
              </p>
            </div>
          ) : null}
          {data?.versions.length ? (
            <p className="mt-4 font-mono text-xs text-slate-500">
              {data.versions.length} immutable composition version
              {data.versions.length === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
        <aside className="border-t border-slate-200 bg-slate-950 p-6 text-white lg:border-t-0 lg:border-l">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-400 text-slate-950">
            <Boxes className="size-5" />
          </div>
          <h3 className="mt-4 font-semibold">Insert from channel library</h3>
          {!library.length && data ? (
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Approve a channel component before composing the project.
            </p>
          ) : null}
          {editable && library.length ? (
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-medium text-slate-300">
                Approved component
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm"
                  onChange={(event) => void chooseComponent(event.target.value)}
                  value={componentId}
                >
                  {library.map((item) => (
                    <option
                      className="text-slate-950"
                      key={item.componentId}
                      value={item.componentId}
                    >
                      {item.componentId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-300">
                Exact approved version
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm"
                  onChange={(event) => chooseVersion(event.target.value)}
                  value={versionId}
                >
                  {detail?.versions.map((version) => (
                    <option
                      className="text-slate-950"
                      key={version.id}
                      value={version.id}
                    >
                      {version.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-300">
                Anchor beat
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm"
                  onChange={(event) => setBeatId(event.target.value)}
                  value={beatId}
                >
                  {currentBeats.map((beat) => (
                    <option
                      className="text-slate-950"
                      key={beat._id}
                      value={beat._id}
                    >
                      {beat.title}
                    </option>
                  ))}
                </select>
              </label>
              {selectedVersion ? (
                <SchemaInputForm
                  input={input}
                  onChange={setInput}
                  schema={inputSchema(selectedVersion)}
                />
              ) : null}
              <Button
                className="w-full bg-blue-400 text-slate-950 hover:bg-blue-300"
                disabled={busy || !beatId || !versionId}
                onClick={() => void insert()}
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
                Insert at beat
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function SchemaInputForm({
  input,
  onChange,
  schema,
}: {
  input: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  schema: JsonInputSchema;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-medium text-slate-300">
        Version-specific inputs
      </p>
      {Object.entries(schema.properties ?? {}).map(([key, property]) => {
        const label = property.title ?? key;
        if (property.enum) {
          return (
            <label className="block text-xs text-slate-300" key={key}>
              {label}
              <select
                aria-label={`Component input ${key}`}
                className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-sm"
                onChange={(event) =>
                  onChange({ ...input, [key]: parseEnum(event.target.value) })
                }
                value={JSON.stringify(input[key])}
              >
                {property.enum.map((option) => (
                  <option
                    className="text-slate-950"
                    key={JSON.stringify(option)}
                    value={JSON.stringify(option)}
                  >
                    {String(option)}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (property.type === "boolean") {
          return (
            <label
              className="flex items-center gap-2 text-xs text-slate-300"
              key={key}
            >
              <input
                aria-label={`Component input ${key}`}
                checked={Boolean(input[key])}
                onChange={(event) =>
                  onChange({ ...input, [key]: event.target.checked })
                }
                type="checkbox"
              />
              {label}
            </label>
          );
        }
        const scalar = ["string", "number", "integer"].includes(
          property.type ?? "",
        );
        return (
          <label className="block text-xs text-slate-300" key={key}>
            {label}
            {scalar ? (
              <input
                aria-label={`Component input ${key}`}
                className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-sm"
                onChange={(event) =>
                  onChange({
                    ...input,
                    [key]:
                      property.type === "string"
                        ? event.target.value
                        : Number(event.target.value),
                  })
                }
                type={property.type === "string" ? "text" : "number"}
                value={String(input[key] ?? "")}
              />
            ) : (
              <textarea
                aria-label={`Component input ${key}`}
                className="mt-1 min-h-20 w-full rounded-lg border border-white/15 bg-white/10 p-2 font-mono text-xs"
                onChange={(event) => {
                  try {
                    onChange({
                      ...input,
                      [key]: JSON.parse(event.target.value),
                    });
                  } catch {
                    // Keep the last valid structured value until JSON is valid.
                  }
                }}
                value={JSON.stringify(input[key] ?? null, null, 2)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

function defaultInput(schema: JsonInputSchema): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, property]) => [
      key,
      property.default ??
        property.enum?.[0] ??
        (property.type === "string"
          ? ""
          : property.type === "number" || property.type === "integer"
            ? 0
            : property.type === "boolean"
              ? false
              : property.type === "array"
                ? []
                : {}),
    ]),
  );
}

function inputSchema(
  version?: LibraryDetail["versions"][number],
): JsonInputSchema {
  if (!version) return {};
  try {
    return JSON.parse(version.inputSchemaJson) as JsonInputSchema;
  } catch {
    return {};
  }
}

function parseEnum(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function browserBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function componentVersionLabel(
  versionId: string,
  library: LibraryItem[],
  detail?: LibraryDetail,
): string {
  const version = detail?.versions.find((item) => item.id === versionId);
  if (version && detail) return `${detail.componentId}@${version.version}`;
  const latest = library.find((item) => item.latestVersion.id === versionId);
  return latest
    ? `${latest.componentId}@${latest.latestVersion.version}`
    : versionId.slice(0, 12);
}

function BeatWorkspace({
  editable,
  projectId,
}: {
  editable: boolean;
  projectId: string;
}) {
  const [data, setData] = useState<BeatData>();
  const [narrations, setNarrations] = useState<NarrationVersion[]>([]);
  const [narrationId, setNarrationId] = useState("");
  const [drafts, setDrafts] = useState<Beat[]>([]);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (preferCurrent = false) => {
      const [beatData, narrationData] = await Promise.all([
        request<BeatData>(`/api/projects/${projectId}/beats`),
        request<{ versions: NarrationVersion[] }>(
          `/api/projects/${projectId}/narrations`,
        ),
      ]);
      const selected = preferCurrent
        ? (beatData.currentNarrationVersionId ??
          beatData.narrationVersions[0]?._id ??
          "")
        : narrationId ||
          beatData.currentNarrationVersionId ||
          beatData.narrationVersions[0]?._id ||
          "";
      setData(beatData);
      setNarrations(narrationData.versions);
      setNarrationId(selected);
      setDrafts(
        beatData.beats
          .filter((beat) => beat.narrationVersionId === selected)
          .sort((left, right) => left.order - right.order),
      );
    },
    [narrationId, projectId],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      request<BeatData>(`/api/projects/${projectId}/beats`),
      request<{ versions: NarrationVersion[] }>(
        `/api/projects/${projectId}/narrations`,
      ),
    ])
      .then(([beatData, narrationData]) => {
        if (!active) return;
        const selected =
          beatData.currentNarrationVersionId ??
          beatData.narrationVersions[0]?._id ??
          "";
        setData(beatData);
        setNarrations(narrationData.versions);
        setNarrationId(selected);
        setDrafts(
          beatData.beats
            .filter((beat) => beat.narrationVersionId === selected)
            .sort((left, right) => left.order - right.order),
        );
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    const onNarrationSaved = () => void load(true);
    window.addEventListener("relay-narration-saved", onNarrationSaved);
    return () =>
      window.removeEventListener("relay-narration-saved", onNarrationSaved);
  }, [load]);

  const selectNarration = (nextId: string) => {
    setNarrationId(nextId);
    setDrafts(
      (data?.beats ?? [])
        .filter((beat) => beat.narrationVersionId === nextId)
        .sort((left, right) => left.order - right.order),
    );
    setSaved(false);
  };
  const version = data?.narrationVersions.find(
    (item) => item._id === narrationId,
  );
  const narration = narrations.find((item) => item._id === narrationId);
  const durationMs = version?.durationMs ?? 0;
  const superseded =
    Boolean(narrationId) && narrationId !== data?.currentNarrationVersionId;

  const update = (index: number, change: Partial<Beat>) => {
    setDrafts((current) =>
      current.map((beat, itemIndex) =>
        itemIndex === index ? { ...beat, ...change } : beat,
      ),
    );
    setSaved(false);
  };
  const add = () => {
    const startMs = drafts.at(-1)?.endMs ?? 0;
    if (startMs >= durationMs) {
      setError("The narration has no unassigned time after the final beat.");
      return;
    }
    setDrafts((current) => [
      ...current,
      {
        narrationVersionId: narrationId,
        order: current.length,
        startMs,
        endMs: durationMs,
        title: `Beat ${current.length + 1}`,
      },
    ]);
    setSaved(false);
  };
  const split = (index: number) => {
    setDrafts((current) => {
      const beat = current[index];
      if (!beat || beat.endMs - beat.startMs < 200) return current;
      const splitAt = Math.round((beat.startMs + beat.endMs) / 2);
      return current
        .flatMap((item, itemIndex) =>
          itemIndex === index
            ? [
                { ...item, endMs: splitAt },
                {
                  ...item,
                  _id: undefined,
                  startMs: splitAt,
                  title: `${item.title} — continuation`,
                },
              ]
            : [item],
        )
        .map((item, order) => ({ ...item, order }));
    });
    setSaved(false);
  };
  const mergePrevious = (index: number) => {
    if (index === 0) return;
    setDrafts((current) =>
      current
        .filter((_, itemIndex) => itemIndex !== index)
        .map((beat, order) =>
          order === index - 1
            ? {
                ...beat,
                endMs: current[index]!.endMs,
                summary: [beat.summary, current[index]!.summary]
                  .filter(Boolean)
                  .join(" "),
              }
            : { ...beat, order },
        ),
    );
    setSaved(false);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= drafts.length) return;
    setDrafts((current) => {
      const next = current.map((beat) => ({ ...beat }));
      const left = next[index]!;
      const right = next[target]!;
      [left.title, right.title] = [right.title, left.title];
      [left.summary, right.summary] = [right.summary, left.summary];
      return next;
    });
    setSaved(false);
  };
  const remove = (index: number) => {
    setDrafts((current) =>
      current
        .filter((_, itemIndex) => itemIndex !== index)
        .map((beat, order) => ({ ...beat, order })),
    );
    setSaved(false);
  };
  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await request(`/api/projects/${projectId}/beats`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          narrationVersionId: narrationId,
          beats: drafts.map(({ startMs, endMs, title, summary }) => ({
            startMs,
            endMs,
            title,
            summary,
          })),
        }),
      });
      setSaved(true);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
        <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
          Semantic timeline
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            Shape narration into timed beats
          </h2>
          {version ? (
            <span
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                superseded
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {superseded ? "Superseded narration" : "Current narration"} · v
              {version.version}
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-6 sm:p-8">
        {error ? <ProjectError message={error} /> : null}
        {!data && !error ? <ProjectLoading label="Opening beats…" /> : null}
        {data && !data.narrationVersions.length ? (
          <p className="text-sm text-slate-500">
            Generate or upload narration before creating beats.
          </p>
        ) : null}
        {version ? (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm font-medium">
                Narration version
                <select
                  className="mt-2 block h-10 rounded-lg border bg-white px-3 text-sm"
                  onChange={(event) => selectNarration(event.target.value)}
                  value={narrationId}
                >
                  {data?.narrationVersions.map((item) => (
                    <option key={item._id} value={item._id}>
                      Version {item.version} · {formatDuration(item.durationMs)}
                    </option>
                  ))}
                </select>
              </label>
              {narration?.audioUrl ? (
                <audio
                  aria-label={`Narration version ${version.version}`}
                  className="min-w-64 flex-1"
                  controls
                  preload="metadata"
                  src={narration.audioUrl}
                >
                  <track kind="captions" />
                </audio>
              ) : null}
            </div>
            <div className="relative mt-6 h-3 overflow-hidden rounded-full bg-slate-100">
              {drafts.map((beat, index) => (
                <span
                  className="absolute h-full border-r border-white bg-blue-500"
                  key={beat._id ?? `${beat.startMs}-${index}`}
                  style={{
                    left: `${(beat.startMs / durationMs) * 100}%`,
                    width: `${((beat.endMs - beat.startMs) / durationMs) * 100}%`,
                  }}
                />
              ))}
            </div>
            <ol className="mt-6 space-y-4">
              {drafts.map((beat, index) => (
                <li
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  key={beat._id ?? `${beat.startMs}-${index}`}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                    <label className="text-xs font-medium text-slate-600">
                      Beat title
                      <input
                        aria-label={`Beat ${index + 1} title`}
                        className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-950"
                        maxLength={120}
                        onChange={(event) =>
                          update(index, { title: event.target.value })
                        }
                        value={beat.title}
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Start seconds
                      <input
                        aria-label={`Beat ${index + 1} start seconds`}
                        className="mt-1 h-10 w-full rounded-lg border bg-white px-3 font-mono text-sm"
                        max={durationMs / 1000}
                        min={0}
                        onChange={(event) =>
                          update(index, {
                            startMs: Math.round(
                              Number(event.target.value) * 1000,
                            ),
                          })
                        }
                        step={0.1}
                        type="number"
                        value={beat.startMs / 1000}
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      End seconds
                      <input
                        aria-label={`Beat ${index + 1} end seconds`}
                        className="mt-1 h-10 w-full rounded-lg border bg-white px-3 font-mono text-sm"
                        max={durationMs / 1000}
                        min={0}
                        onChange={(event) =>
                          update(index, {
                            endMs: Math.round(
                              Number(event.target.value) * 1000,
                            ),
                          })
                        }
                        step={0.1}
                        type="number"
                        value={beat.endMs / 1000}
                      />
                    </label>
                  </div>
                  <label className="mt-3 block text-xs font-medium text-slate-600">
                    Editorial summary
                    <input
                      aria-label={`Beat ${index + 1} summary`}
                      className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm"
                      maxLength={1000}
                      onChange={(event) =>
                        update(index, { summary: event.target.value })
                      }
                      placeholder="What should this moment communicate?"
                      value={beat.summary ?? ""}
                    />
                  </label>
                  {editable ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        aria-label={`Move beat ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        size="sm"
                        variant="outline"
                      >
                        <ArrowUp /> Up
                      </Button>
                      <Button
                        aria-label={`Move beat ${index + 1} down`}
                        disabled={index === drafts.length - 1}
                        onClick={() => move(index, 1)}
                        size="sm"
                        variant="outline"
                      >
                        <ArrowDown /> Down
                      </Button>
                      <Button
                        onClick={() => split(index)}
                        size="sm"
                        variant="outline"
                      >
                        <Scissors /> Split
                      </Button>
                      <Button
                        disabled={index === 0}
                        onClick={() => mergePrevious(index)}
                        size="sm"
                        variant="outline"
                      >
                        Merge previous
                      </Button>
                      <Button
                        aria-label={`Delete beat ${index + 1}`}
                        onClick={() => remove(index)}
                        size="sm"
                        variant="outline"
                      >
                        <Trash2 /> Delete
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            {editable ? (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button onClick={add} variant="outline">
                  <Plus /> Add beat
                </Button>
                <Button
                  disabled={busy || !narrationId}
                  onClick={() => void save()}
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : <Save />}
                  Save beat timeline
                </Button>
                {saved ? (
                  <span className="text-sm font-medium text-emerald-700">
                    Beat timeline saved.
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function NarrationWorkspace({
  editable,
  projectId,
}: {
  editable: boolean;
  projectId: string;
}) {
  const [scripts, setScripts] = useState<ScriptVersionSummary[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState("");
  const [data, setData] = useState<{
    versions: NarrationVersion[];
    jobs: NarrationJob[];
  }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [uploadFile, setUploadFile] = useState<File>();

  const refresh = useCallback(async () => {
    const [scriptData, narrationData] = await Promise.all([
      request<{ versions: ScriptVersionSummary[] }>(
        `/api/projects/${projectId}/scripts`,
      ),
      request<{ versions: NarrationVersion[]; jobs: NarrationJob[] }>(
        `/api/projects/${projectId}/narrations`,
      ),
    ]);
    setScripts(scriptData.versions);
    setSelectedScriptId(
      (current) => current || scriptData.versions[0]?._id || "",
    );
    setData(narrationData);
    window.dispatchEvent(new Event("relay-narration-saved"));
  }, [projectId]);

  useEffect(() => {
    const onScriptSaved = () => void refresh();
    window.addEventListener("relay-script-saved", onScriptSaved);
    return () =>
      window.removeEventListener("relay-script-saved", onScriptSaved);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      request<{ versions: ScriptVersionSummary[] }>(
        `/api/projects/${projectId}/scripts`,
      ),
      request<{ versions: NarrationVersion[]; jobs: NarrationJob[] }>(
        `/api/projects/${projectId}/narrations`,
      ),
    ])
      .then(([scriptData, narrationData]) => {
        if (!active) return;
        setScripts(scriptData.versions);
        setSelectedScriptId(scriptData.versions[0]?._id ?? "");
        setData(narrationData);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const activeJob = data?.jobs.find((job) =>
    ["queued", "running"].includes(job.state),
  );
  useEffect(() => {
    if (!activeJob) return;
    const timer = window.setInterval(() => {
      void request<{ versions: NarrationVersion[]; jobs: NarrationJob[] }>(
        `/api/projects/${projectId}/narrations`,
      )
        .then((value) => {
          setData(value);
          window.dispatchEvent(new Event("relay-narration-saved"));
        })
        .catch((cause) => setError(errorMessage(cause)));
    }, 700);
    return () => window.clearInterval(timer);
  }, [activeJob, projectId]);

  const generate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await request(`/api/projects/${projectId}/narrations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          scriptVersionId: selectedScriptId,
        }),
      });
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (jobId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await request(`/api/projects/${projectId}/narrations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", jobId }),
      });
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!uploadFile) return;
    setBusy(true);
    setError(undefined);
    try {
      const mediaType = fileMediaType(uploadFile);
      const prepared = await request<{
        uploadUrl: string;
        maximumBytes: number;
      }>(`/api/projects/${projectId}/narrations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare_upload",
          fileName: uploadFile.name,
          mediaType,
          byteSize: uploadFile.size,
        }),
      });
      const response = await fetch(prepared.uploadUrl, {
        method: "POST",
        headers: { "content-type": mediaType },
        body: uploadFile,
      });
      const uploaded = (await response.json()) as {
        storageId?: string;
        message?: string;
      };
      if (!response.ok || !uploaded.storageId) {
        throw new Error(
          uploaded.message ?? "The narration upload did not complete.",
        );
      }
      await request(`/api/projects/${projectId}/narrations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "finalize_upload",
          storageId: uploaded.storageId,
          fileName: uploadFile.name,
          mediaType,
        }),
      });
      setUploadFile(undefined);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const latest = data?.versions[0];
  const latestJob = data?.jobs[0];

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-sm">
      <div className="grid lg:grid-cols-[21rem_minmax(0,1fr)]">
        <div className="border-b border-white/10 p-6 sm:p-8 lg:border-r lg:border-b-0">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-400 text-slate-950">
            <AudioLines className="size-5" />
          </div>
          <p className="mt-5 text-xs font-medium tracking-[0.18em] text-slate-400 uppercase">
            Generated narration
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Turn a pinned script into timed audio.
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Generation is explicit. Each result keeps the exact script version,
            provider, timing, usage, and cost.
          </p>
          {editable ? (
            <div className="mt-6 space-y-3">
              <label
                className="block text-sm font-medium"
                htmlFor="narration-script"
              >
                Script version
              </label>
              <select
                className="h-11 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm"
                disabled={!scripts.length || Boolean(activeJob)}
                id="narration-script"
                onChange={(event) => setSelectedScriptId(event.target.value)}
                value={selectedScriptId}
              >
                {scripts.map((script) => (
                  <option
                    className="text-slate-950"
                    key={script._id}
                    value={script._id}
                  >
                    Version {script.version} · {script.characterCount} chars
                  </option>
                ))}
              </select>
              <Button
                className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                disabled={busy || Boolean(activeJob) || !selectedScriptId}
                onClick={() => void generate()}
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <AudioLines />
                )}
                Generate timed narration
              </Button>
              <div className="flex items-center gap-3 py-1 text-xs text-slate-500">
                <span className="h-px flex-1 bg-white/10" />
                or upload voiceover
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <label
                className="flex min-h-11 cursor-pointer items-center rounded-lg border border-dashed border-white/20 bg-white/5 px-3 text-sm text-slate-300"
                htmlFor="narration-upload"
              >
                {uploadFile?.name ?? "Choose audio file"}
                <input
                  accept="audio/*,.m4a,.mp3,.ogg,.wav,.webm"
                  aria-label="Narration audio file"
                  className="sr-only"
                  id="narration-upload"
                  onChange={(event) => setUploadFile(event.target.files?.[0])}
                  type="file"
                />
              </label>
              <Button
                className="w-full border-white/20 text-white hover:bg-white/10"
                disabled={busy || Boolean(activeJob) || !uploadFile}
                onClick={() => void upload()}
                variant="outline"
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
                Upload and probe narration
              </Button>
              {activeJob ? (
                <Button
                  className="w-full border-white/20 text-white hover:bg-white/10"
                  disabled={busy || activeJob.cancelRequested}
                  onClick={() => void cancel(activeJob._id)}
                  variant="outline"
                >
                  <CircleStop />
                  {activeJob.cancelRequested
                    ? "Canceling…"
                    : "Cancel generation"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="p-6 sm:p-8">
          {error ? (
            <div
              className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {!data && !error ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <LoaderCircle className="size-4 animate-spin" /> Opening
              narration…
            </div>
          ) : null}
          {latestJob ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
              <div>
                <p className="text-xs text-slate-400 uppercase">Latest job</p>
                <p className="mt-1 text-sm font-medium">
                  {narrationStateLabel(latestJob)}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${narrationStateClass(latestJob.state)}`}
              >
                {latestJob.state.replace("_", " ")}
              </span>
            </div>
          ) : null}
          {latest ? (
            <div className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-400 uppercase">
                    Narration version {latest.version}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold">
                    {formatDuration(latest.durationMs)}
                    {latest.timingSegments.length
                      ? ` with ${latest.timingSegments.length} timing segments`
                      : " · ready for manual beat timing"}
                  </h3>
                </div>
                <p className="font-mono text-xs text-slate-400">
                  {latest.provider}/{latest.model} · $
                  {(latest.estimatedCostUsd ?? 0).toFixed(4)}
                </p>
              </div>
              {latest.provenance === "upload" ? (
                <p className="mt-3 font-mono text-xs text-slate-400">
                  {latest.fileName} · {latest.audioCodec} ·{" "}
                  {latest.sampleRate?.toLocaleString()} Hz · {latest.channels}{" "}
                  channel{latest.channels === 1 ? "" : "s"}
                </p>
              ) : null}
              {latest.audioUrl ? (
                <audio
                  className="mt-5 w-full"
                  controls
                  preload="metadata"
                  src={latest.audioUrl}
                >
                  <track kind="captions" />
                </audio>
              ) : null}
              <ol className="mt-6 grid gap-2">
                {latest.timingSegments.map((segment) => (
                  <li
                    className="grid gap-2 rounded-lg bg-white/6 px-4 py-3 text-sm sm:grid-cols-[6rem_1fr]"
                    key={segment.index}
                  >
                    <span className="font-mono text-xs text-emerald-300">
                      {formatTimestamp(segment.startMs)}–
                      {formatTimestamp(segment.endMs)}
                    </span>
                    <span className="text-slate-200">{segment.text}</span>
                  </li>
                ))}
              </ol>
              {data && data.versions.length > 1 ? (
                <div className="mt-8 border-t border-white/10 pt-5">
                  <h4 className="text-sm font-semibold">Narration history</h4>
                  <ol className="mt-3 grid gap-2 sm:grid-cols-2">
                    {data.versions.map((version, index) => (
                      <li
                        className="rounded-lg border border-white/10 bg-white/5 p-3"
                        key={version._id}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <strong className="text-sm">
                            Version {version.version}
                          </strong>
                          <span
                            className={`text-xs ${
                              index === 0
                                ? "text-emerald-300"
                                : "text-amber-300"
                            }`}
                          >
                            {index === 0 ? "Current" : "Superseded"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          {version.provenance} ·{" "}
                          {formatDuration(version.durationMs)}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          ) : data && !latestJob ? (
            <div className="py-12 text-center">
              <AudioLines className="mx-auto size-7 text-slate-600" />
              <p className="mt-3 text-sm text-slate-400">
                Save a script, then generate the first narration.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ScriptWorkspace({
  editable,
  projectId,
}: {
  editable: boolean;
  projectId: string;
}) {
  const [data, setData] = useState<{
    current: ScriptVersion | null;
    versions: ScriptVersionSummary[];
    maximumCharacters: number;
  }>();
  const [content, setContent] = useState("");
  const [provenance, setProvenance] = useState<"manual" | "import">("manual");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const value = await request<{
      current: ScriptVersion | null;
      versions: ScriptVersionSummary[];
      maximumCharacters: number;
    }>(`/api/projects/${projectId}/scripts`);
    setData(value);
    setContent(value.current?.content ?? "");
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void request<{
      current: ScriptVersion | null;
      versions: ScriptVersionSummary[];
      maximumCharacters: number;
    }>(`/api/projects/${projectId}/scripts`)
      .then((value) => {
        if (!active) return;
        setData(value);
        setContent(value.current?.content ?? "");
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await request(`/api/projects/${projectId}/scripts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, provenance }),
      });
      await refresh();
      window.dispatchEvent(new Event("relay-script-saved"));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
              Project script
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              Versioned narration copy
            </h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-600">
            {data?.current
              ? `Current · v${data.current.version}`
              : "No script yet"}
          </span>
        </div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="p-6 sm:p-8">
          {error ? <ProjectError message={error} /> : null}
          {!data && !error ? <ProjectLoading label="Opening script…" /> : null}
          {data ? (
            editable ? (
              <form onSubmit={save}>
                <label className="block text-sm font-medium" htmlFor="script">
                  Script text
                </label>
                <textarea
                  className="mt-2 min-h-80 w-full resize-y rounded-xl border bg-white px-4 py-4 font-mono text-sm leading-7 outline-none placeholder:font-sans placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  id="script"
                  maxLength={data.maximumCharacters}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Paste or write the narration script here…"
                  value={content}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-xs text-slate-500">
                    {content.length.toLocaleString()} /{" "}
                    {data.maximumCharacters.toLocaleString()} characters
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm text-slate-600">
                      Script provenance
                      <select
                        className="ml-2 h-9 rounded-lg border bg-white px-3 text-sm text-slate-950"
                        onChange={(event) =>
                          setProvenance(
                            event.target.value as "manual" | "import",
                          )
                        }
                        value={provenance}
                      >
                        <option value="manual">Written here</option>
                        <option value="import">Imported</option>
                      </select>
                    </label>
                    <Button disabled={saving || !content.trim()} type="submit">
                      {saving ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Save />
                      )}
                      Save new version
                    </Button>
                  </div>
                </div>
              </form>
            ) : (
              <pre className="min-h-40 rounded-xl bg-slate-50 p-5 font-mono text-sm leading-7 whitespace-pre-wrap text-slate-700">
                {data.current?.content ?? "No script was saved."}
              </pre>
            )
          ) : null}
        </div>
        <aside className="border-t border-slate-200 bg-slate-50 p-6 lg:border-t-0 lg:border-l">
          <h3 className="text-sm font-semibold">Version history</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Every save is immutable and directly addressable.
          </p>
          {data?.versions.length ? (
            <ol className="mt-5 space-y-3">
              {data.versions.map((version) => (
                <li key={version._id}>
                  <a
                    className="group block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-400"
                    href={`/projects/${projectId}/scripts/${version.version}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm">
                        Version {version.version}
                      </strong>
                      <ArrowRight className="size-3.5 text-slate-400 transition group-hover:translate-x-0.5" />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                      {version.excerpt}
                    </p>
                    <p className="mt-3 font-mono text-[10px] text-slate-400 uppercase">
                      {version.provenance} ·{" "}
                      {version.characterCount.toLocaleString()} chars
                    </p>
                  </a>
                </li>
              ))}
            </ol>
          ) : data ? (
            <p className="mt-5 text-sm text-slate-500">No versions saved.</p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

export function ProjectScriptVersionWorkspace({
  projectId,
  version,
}: {
  projectId: string;
  version: number;
}) {
  const [data, setData] = useState<{
    channel: Channel;
    project: Project;
    script: ScriptVersion;
  }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void request<{
      channel: Channel;
      project: Project;
      script: ScriptVersion;
    }>(`/api/projects/${projectId}/scripts/${version}`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [projectId, version]);

  return (
    <ProjectShell channelName={data?.channel.name}>
      <a
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950"
        href={`/projects/${projectId}`}
      >
        <ArrowLeft className="size-4" /> Back to project
      </a>
      {error ? <ProjectError message={error} /> : null}
      {!data && !error ? (
        <ProjectLoading label="Opening script version…" />
      ) : null}
      {data ? (
        <article className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="border-b border-slate-200 px-6 py-6 sm:px-8">
            <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
              {data.project.name} · immutable script
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <h1 className="text-3xl font-semibold tracking-tight">
                Script version {data.script.version}
              </h1>
              <p className="font-mono text-xs text-slate-500">
                {data.script.provenance} · {formatDate(data.script.createdAt)}
              </p>
            </div>
          </header>
          <pre className="px-6 py-8 font-mono text-sm leading-7 whitespace-pre-wrap text-slate-800 sm:px-8">
            {data.script.content}
          </pre>
        </article>
      ) : null}
    </ProjectShell>
  );
}

function SourceWorkspace({
  editable,
  projectId,
}: {
  editable: boolean;
  projectId: string;
}) {
  const [sources, setSources] = useState<Source[]>();
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<"url" | "file">("url");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState<string>();

  const refresh = useCallback(async () => {
    const value = await request<{ sources: Source[] }>(
      `/api/projects/${projectId}/sources`,
    );
    setSources(value.sources);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void request<{ sources: Source[] }>(`/api/projects/${projectId}/sources`)
      .then((value) => {
        if (active) setSources(value.sources);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const addUrl = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("Saving URL…");
    setError(undefined);
    try {
      await sourceAction(projectId, { action: "add_url", title, url });
      setTitle("");
      setUrl("");
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const addFile = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy("Preparing upload…");
    setError(undefined);
    try {
      const mediaType = fileMediaType(file);
      const prepared = await sourceAction<{
        uploadUrl: string;
        maximumBytes: number;
      }>(projectId, {
        action: "prepare_file",
        fileName: file.name,
        mediaType,
        byteSize: file.size,
      });
      setBusy("Uploading file…");
      const upload = await fetch(prepared.uploadUrl, {
        method: "POST",
        headers: { "content-type": mediaType },
        body: file,
      });
      const uploaded = (await upload.json()) as {
        storageId?: string;
        message?: string;
      };
      if (!upload.ok || !uploaded.storageId) {
        throw new Error(
          uploaded.message ?? "The file upload did not complete. Try again.",
        );
      }
      setBusy("Saving source…");
      await sourceAction(projectId, {
        action: "finalize_file",
        title: title || file.name,
        fileName: file.name,
        mediaType,
        storageId: uploaded.storageId,
      });
      setTitle("");
      setFile(undefined);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async (sourceId: string) => {
    if (confirmRemove !== sourceId) {
      setConfirmRemove(sourceId);
      return;
    }
    setBusy("Removing source…");
    setError(undefined);
    try {
      await sourceAction(projectId, { action: "remove", sourceId });
      setConfirmRemove(undefined);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="mt-12 border-t border-slate-300 pt-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
            Evidence ledger
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">
            Project sources
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Preserve the references and files this production relies on. Each
            entry keeps its origin and fingerprint with the project.
          </p>
        </div>
        {sources ? (
          <p className="font-mono text-xs text-slate-500">
            {sources.length} source{sources.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      {error ? <SourceError message={error} /> : null}

      <div
        className={`mt-8 grid gap-8 ${
          editable ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : ""
        }`}
      >
        <div>
          {!sources && !error ? (
            <ProjectLoading label="Opening sources…" />
          ) : null}
          {sources?.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12">
              <Link2 className="size-7 text-slate-400" />
              <h3 className="mt-4 font-semibold">No sources added yet</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Add the first web reference or source file for this production.
              </p>
            </div>
          ) : null}
          {sources?.length ? (
            <div className="space-y-3">
              {sources.map((source) => (
                <SourceCard
                  busy={Boolean(busy)}
                  confirmRemove={confirmRemove === source._id}
                  editable={editable}
                  key={source._id}
                  onRemove={() => void remove(source._id)}
                  source={source}
                />
              ))}
            </div>
          ) : null}
        </div>

        {editable ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-2 border-b bg-slate-50 p-1.5">
              <button
                aria-pressed={mode === "url"}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  mode === "url"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-950"
                }`}
                onClick={() => {
                  setMode("url");
                  setTitle("");
                }}
                type="button"
              >
                <Globe2 className="size-4" /> Web URL
              </button>
              <button
                aria-pressed={mode === "file"}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  mode === "file"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-950"
                }`}
                onClick={() => {
                  setMode("file");
                  setTitle("");
                }}
                type="button"
              >
                <Upload className="size-4" /> File
              </button>
            </div>

            {mode === "url" ? (
              <form className="space-y-5 p-5" onSubmit={addUrl}>
                <SourceComposerHeading
                  detail="Save a public http or https reference."
                  title="Add web source"
                />
                <SourceTextField
                  id="source-url-title"
                  label="Source title"
                  maxLength={200}
                  onChange={setTitle}
                  placeholder="National results dashboard"
                  value={title}
                />
                <SourceTextField
                  id="source-url"
                  label="URL"
                  maxLength={2048}
                  onChange={setUrl}
                  placeholder="https://example.com/report"
                  type="url"
                  value={url}
                />
                <Button
                  className="w-full"
                  disabled={Boolean(busy) || !title.trim() || !url.trim()}
                  type="submit"
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : <Link2 />}
                  {busy ?? "Add web source"}
                </Button>
              </form>
            ) : (
              <form className="space-y-5 p-5" onSubmit={addFile}>
                <SourceComposerHeading
                  detail="PDF, text, data, image, audio, or video up to 25 MB."
                  title="Upload source file"
                />
                <label
                  className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-center hover:border-slate-500"
                  htmlFor="source-file"
                >
                  <Upload className="size-5 text-slate-500" />
                  <span className="mt-2 text-sm font-medium">
                    {file?.name ?? "Choose a source file"}
                  </span>
                  <span className="mt-1 text-xs text-slate-500">
                    {file ? formatBytes(file.size) : "Maximum 25 MB"}
                  </span>
                </label>
                <input
                  accept=".csv,.json,.md,.pdf,.txt,.jpeg,.jpg,.png,.webp,.mp3,.mp4,.wav,.webm"
                  className="sr-only"
                  id="source-file"
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    setFile(selected);
                    setTitle(selected?.name ?? "");
                  }}
                  type="file"
                />
                <SourceTextField
                  id="source-file-title"
                  label="Source title"
                  maxLength={200}
                  onChange={setTitle}
                  placeholder="Interview transcript"
                  value={title}
                />
                <Button
                  className="w-full"
                  disabled={Boolean(busy) || !file || !title.trim()}
                  type="submit"
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Upload />
                  )}
                  {busy ?? "Upload source"}
                </Button>
              </form>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SourceCard({
  busy,
  confirmRemove,
  editable,
  onRemove,
  source,
}: {
  busy: boolean;
  confirmRemove: boolean;
  editable: boolean;
  onRemove: () => void;
  source: Source;
}) {
  const href =
    source.kind === "url" ? source.normalizedUrl : source.downloadUrl;
  return (
    <article className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 pl-7 shadow-sm">
      <div
        className={`absolute inset-y-0 left-0 w-1.5 ${
          source.kind === "url" ? "bg-amber-400" : "bg-blue-600"
        }`}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            {source.kind === "url" ? (
              <Globe2 className="size-3.5" />
            ) : (
              <FileText className="size-3.5" />
            )}
            {source.kind === "url" ? "Web reference" : source.mediaType}
          </div>
          <h3 className="mt-2 truncate font-semibold tracking-tight">
            {source.title}
          </h3>
          <p className="mt-1 truncate text-sm text-slate-500">
            {source.normalizedUrl ?? source.fileName}
          </p>
        </div>
        {href ? (
          <a
            aria-label={`Open ${source.title}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border text-slate-500 hover:bg-slate-50 hover:text-slate-950"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="font-mono text-[10px] text-slate-400">
          {source.kind === "file" ? `${formatBytes(source.byteSize)} · ` : ""}
          {formatDate(source.createdAt)} · {shortHash(source.contentHash)}
        </p>
        {editable ? (
          <button
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition ${
              confirmRemove
                ? "bg-red-600 text-white hover:bg-red-700"
                : "text-slate-500 hover:bg-red-50 hover:text-red-700"
            }`}
            disabled={busy}
            onClick={onRemove}
            type="button"
          >
            <Trash2 className="size-3" />
            {confirmRemove ? "Confirm remove" : "Remove source"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function SourceComposerHeading({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function SourceTextField({
  id,
  label,
  maxLength,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  id: string;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "url";
  value: string;
}) {
  return (
    <label className="block text-sm font-medium" htmlFor={id}>
      {label}
      <input
        className="mt-2 h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        id={id}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        type={type}
        value={value}
      />
    </label>
  );
}

function SourceError({ message }: { message: string }) {
  return (
    <div
      className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      <strong className="block">The source could not be saved</strong>
      {message}
    </div>
  );
}

function ProjectSection({
  label,
  projects,
  subdued = false,
}: {
  label: string;
  projects: Project[];
  subdued?: boolean;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="font-mono text-xs text-slate-500">
          {projects.length}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {projects.map((project) => (
          <a
            className={`group relative overflow-hidden rounded-xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md ${
              subdued ? "opacity-70 hover:opacity-100" : ""
            }`}
            href={`/projects/${project._id}`}
            key={project._id}
          >
            <div
              className={`absolute inset-y-0 left-0 w-1 ${
                project.status === "active" ? "bg-blue-600" : "bg-slate-300"
              }`}
            />
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold tracking-tight">{project.name}</h3>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                  {project.description || "No production note"}
                </p>
              </div>
              <ArrowRight className="mt-0.5 size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-950" />
            </div>
            <p className="mt-5 font-mono text-[11px] text-slate-400">
              Updated {formatDate(project.updatedAt)}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

function ProjectShell({
  children,
  channelName,
}: {
  children: React.ReactNode;
  channelName?: string | undefined;
}) {
  return (
    <main className="min-h-screen bg-[#f6f7f9]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <a className="flex items-center gap-3" href="/projects">
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white">
              <FolderKanban className="size-4" />
            </div>
            <div>
              <strong className="block text-sm">
                {channelName ?? "Relay Studio"}
              </strong>
              <span className="text-xs text-slate-500">Video projects</span>
            </div>
          </a>
          <nav className="flex items-center gap-1 text-sm" aria-label="Channel">
            <a
              className="rounded-lg px-3 py-2 font-medium text-slate-950"
              href="/projects"
            >
              Projects
            </a>
            <a
              className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950"
              href="/components"
            >
              Components
            </a>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-12">
        {children}
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: Project["status"] }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
        status === "active"
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-100 text-slate-600"
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${
          status === "active" ? "bg-blue-600" : "bg-slate-400"
        }`}
      />
      {status === "active" ? "Active" : "Archived"}
    </span>
  );
}

function ProjectLoading({ label }: { label: string }) {
  return (
    <div className="mt-10 flex items-center gap-2 text-sm text-slate-600">
      <LoaderCircle className="size-4 animate-spin" /> {label}
    </div>
  );
}

function ProjectError({ message }: { message: string }) {
  return (
    <div
      className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      <strong className="block">
        The project workspace could not continue
      </strong>
      {message}
    </div>
  );
}

async function request<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
}

function sourceAction<T = unknown>(
  projectId: string,
  body: Record<string, unknown>,
): Promise<T> {
  return request<T>(`/api/projects/${projectId}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function shortHash(value: string): string {
  return `sha256:${value.slice(0, 10)}`;
}

function narrationStateLabel(job: NarrationJob): string {
  if (job.cancelRequested && !["canceled", "failed"].includes(job.state)) {
    return "Cancellation requested";
  }
  return (
    job.terminalMessage ??
    (job.state === "queued"
      ? "Waiting for the narration worker"
      : job.state === "running"
        ? "Generating audio and timing"
        : "Narration job updated")
  );
}

function narrationStateClass(state: NarrationJob["state"]): string {
  if (state === "succeeded") return "bg-emerald-400/15 text-emerald-300";
  if (state === "queued" || state === "running") {
    return "bg-blue-400/15 text-blue-300";
  }
  return "bg-amber-400/15 text-amber-300";
}

function formatDuration(value: number): string {
  const seconds = value / 1_000;
  return seconds < 60
    ? `${seconds.toFixed(1)} seconds`
    : `${Math.floor(seconds / 60)}:${Math.round(seconds % 60)
        .toString()
        .padStart(2, "0")}`;
}

function formatTimestamp(value: number): string {
  const seconds = value / 1_000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60)
    .toFixed(1)
    .padStart(4, "0")}`;
}

function fileMediaType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const fallback: Record<string, string> = {
    csv: "text/csv",
    json: "application/json",
    m4a: "audio/mp4",
    md: "text/markdown",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    txt: "text/plain",
    wav: "audio/wav",
    webm: "audio/webm",
  };
  return extension ? (fallback[extension] ?? "") : "";
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "The request failed.";
}
