"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  GitBranch,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { RelayShell } from "@/components/relay-shell";

type LibraryFixture = {
  id: string;
  name?: string;
  input?: Record<string, unknown>;
  checkpoints?: Array<{ label?: string; frame: number }>;
};

type PreviewIssue = { path: string; message: string };

type LibraryVersion = {
  id: string;
  version: string;
  approvedAt: number;
  sourceHash: string;
  fixtureCount: number;
  previewFixtureId?: string;
  previewFrame: number;
  originThreadId?: string;
};

type LibraryItem = {
  id: string;
  componentId: string;
  updatedAt: number;
  versionCount: number;
  latestVersion: LibraryVersion;
};

type LibraryDetail = {
  id: string;
  componentId: string;
  latestApprovedVersionId: string;
  createdAt: number;
  updatedAt: number;
  versions: Array<
    LibraryVersion & {
      fixtures: LibraryFixture[];
      dimensions: unknown;
      previousVersionId?: string;
    }
  >;
};

export function ComponentLibraryWorkspace() {
  const [items, setItems] = useState<LibraryItem[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void request<LibraryItem[]>("/api/component-loop/library")
      .then((value) => {
        if (active) setItems(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <RelayShell active="components">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-[#7b858c] uppercase">
            Components
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-[-0.035em] text-[#171b1f]">
            Channel library
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#68747d]">
            Reusable, approved visual treatments for every production in this
            channel. Each project pins an exact version.
          </p>
        </div>
        <Button asChild className="bg-[#355ce8] text-white hover:bg-[#294cc8]">
          <a href="/components/build">
            New component <ArrowRight />
          </a>
        </Button>
      </div>

      {error ? <LibraryError message={error} /> : null}
      {!items && !error ? (
        <LibraryLoading label="Opening channel library…" />
      ) : null}
      {items?.length === 0 ? (
        <section className="mt-10 rounded-2xl border border-dashed bg-white px-6 py-16 text-center">
          <Boxes className="mx-auto size-7 text-slate-400" />
          <h2 className="mt-4 text-lg font-semibold">
            No approved components yet
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Review and approve a component in Relay before it appears here.
          </p>
        </section>
      ) : null}
      {items?.length ? (
        <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ComponentCard item={item} key={item.id} />
          ))}
        </div>
      ) : null}
    </RelayShell>
  );
}

export function ComponentLibraryDetail({
  componentId,
}: {
  componentId: string;
}) {
  const [detail, setDetail] = useState<LibraryDetail>();
  const [selectedId, setSelectedId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void request<LibraryDetail>(
      `/api/component-loop/library/${encodeURIComponent(componentId)}`,
    )
      .then((value) => {
        if (!active) return;
        const requested = new URL(window.location.href).searchParams.get(
          "version",
        );
        setDetail(value);
        setSelectedId(
          value.versions.some((version) => version.id === requested)
            ? (requested ?? undefined)
            : value.latestApprovedVersionId,
        );
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [componentId]);

  const selected = useMemo(
    () => detail?.versions.find((version) => version.id === selectedId),
    [detail, selectedId],
  );

  const selectVersion = (versionId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("version", versionId);
    window.history.replaceState({}, "", url);
    setSelectedId(versionId);
  };

  const startRevision = async () => {
    if (!selected) return;
    setStarting(true);
    setError(undefined);
    try {
      const result = await request<{ threadId: string }>(
        `/api/component-loop/versions/${selected.id}/revision-thread`,
        { method: "POST" },
      );
      window.location.assign(
        `/components/conversations/${encodeURIComponent(result.threadId)}`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
      setStarting(false);
    }
  };

  return (
    <RelayShell active="components">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-xs text-[#68747d]"
      >
        <a
          className="inline-flex items-center gap-1.5 hover:text-[#171b1f]"
          href="/components"
        >
          <ArrowLeft className="size-3.5" /> Components
        </a>
        <span aria-hidden="true">/</span>
        <span>Library item</span>
      </nav>

      {error ? <LibraryError message={error} /> : null}
      {!detail && !error ? <LibraryLoading label="Opening component…" /> : null}
      {detail && selected ? (
        <>
          <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
                Components · approved
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                {componentName(detail.componentId)}
              </h1>
              <p className="mt-2 font-mono text-xs text-slate-500">
                {detail.componentId} · {detail.versions.length} approved version
                {detail.versions.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.originThreadId ? (
                <Button asChild variant="outline">
                  <a
                    href={`/components/conversations/${encodeURIComponent(
                      selected.originThreadId,
                    )}`}
                  >
                    <MessageSquareText /> Open build conversation
                  </a>
                </Button>
              ) : null}
              <Button disabled={starting} onClick={() => void startRevision()}>
                {starting ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <GitBranch />
                )}
                Start revision chat
              </Button>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h2 className="font-semibold">
                    {componentName(detail.componentId)} v{selected.version}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Interactive preview — the approved source stays immutable
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  <ShieldCheck className="size-3.5" /> Approved
                </span>
              </div>
              <LibraryVersionPlayer
                componentId={detail.componentId}
                key={selected.id}
                version={selected}
              />
              <div className="grid gap-3 border-t px-5 py-4 text-xs text-slate-500 sm:grid-cols-3">
                <span>{formatDate(selected.approvedAt)}</span>
                <span>{selected.fixtureCount} validated fixtures</span>
                <span
                  className="truncate font-mono"
                  title={selected.sourceHash}
                >
                  source {selected.sourceHash.slice(0, 12)}
                </span>
              </div>
            </section>

            <aside className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="font-semibold">Version history</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Select the exact approved version you want to inspect or revise.
              </p>
              <ol className="mt-4 space-y-2">
                {detail.versions.map((version) => (
                  <li key={version.id}>
                    <button
                      aria-pressed={version.id === selected.id}
                      className={
                        "w-full rounded-xl border px-3 py-3 text-left transition " +
                        (version.id === selected.id
                          ? "border-slate-900 bg-slate-950 text-white"
                          : "bg-white hover:border-slate-400")
                      }
                      onClick={() => selectVersion(version.id)}
                      type="button"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">
                          v{version.version}
                        </span>
                        {version.id === detail.latestApprovedVersionId ? (
                          <span className="text-[10px] uppercase opacity-70">
                            Latest
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[11px] opacity-65">
                        {formatDate(version.approvedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </>
      ) : null}
    </RelayShell>
  );
}

function ComponentCard({ item }: { item: LibraryItem }) {
  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <VersionPreview
        componentId={item.componentId}
        version={item.latestVersion}
      />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{componentName(item.componentId)}</h2>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {item.componentId}
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700 uppercase">
            Approved
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>Latest v{item.latestVersion.version}</span>
          <span>
            {item.versionCount} version{item.versionCount === 1 ? "" : "s"}
          </span>
        </div>
        <Button asChild className="mt-5 w-full" variant="outline">
          <a href={`/components/${encodeURIComponent(item.componentId)}`}>
            Open component <ArrowRight />
          </a>
        </Button>
      </div>
    </article>
  );
}

function LibraryVersionPlayer({
  componentId,
  version,
}: {
  componentId: string;
  version: LibraryVersion & { fixtures: LibraryFixture[] };
}) {
  const fixtures = version.fixtures;
  const [fixtureId, setFixtureId] = useState(() =>
    version.previewFixtureId &&
    fixtures.some((fixture) => fixture.id === version.previewFixtureId)
      ? version.previewFixtureId
      : (fixtures[0]?.id ?? ""),
  );
  const fixture = fixtures.find((item) => item.id === fixtureId) ?? fixtures[0];
  const [draftInput, setDraftInput] = useState(() =>
    JSON.stringify(fixture?.input ?? {}, null, 2),
  );
  const [appliedInput, setAppliedInput] = useState<string>();
  const [draftError, setDraftError] = useState<string>();
  const [issues, setIssues] = useState<PreviewIssue[]>([]);
  const [meta, setMeta] = useState<{ durationInFrames: number; fps: number }>();
  const fallbackMax = Math.max(
    179,
    ...(fixture?.checkpoints?.map((item) => item.frame) ?? [0]),
  );
  const maximumFrame = meta
    ? Math.max(0, meta.durationInFrames - 1)
    : fallbackMax;
  const [frame, setFrame] = useState(() =>
    Math.min(version.previewFrame, maximumFrame),
  );
  const [playing, setPlaying] = useState(false);
  const hasStartedPlaybackRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () =>
        setFrame((current) => {
          if (current >= maximumFrame) {
            setPlaying(false);
            return 0;
          }
          return current + 1;
        }),
      1000 / (meta?.fps ?? 30),
    );
    return () => window.clearInterval(timer);
  }, [maximumFrame, meta?.fps, playing]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "relay-preview-frame-v1", frame },
      "*",
    );
  }, [frame]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as
        | {
            type?: string;
            durationInFrames?: number;
            fps?: number;
            issues?: PreviewIssue[];
          }
        | undefined;
      if (
        data?.type === "relay-preview-meta-v1" &&
        typeof data.durationInFrames === "number" &&
        Number.isFinite(data.durationInFrames) &&
        typeof data.fps === "number" &&
        Number.isFinite(data.fps)
      ) {
        setMeta({
          durationInFrames: Math.max(1, Math.floor(data.durationInFrames)),
          fps: data.fps,
        });
        return;
      }
      if (data?.type === "relay-preview-input-error-v1") {
        setIssues(
          (data.issues ?? []).filter(
            (issue) =>
              issue &&
              typeof issue.path === "string" &&
              typeof issue.message === "string",
          ),
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const stopAtFrame = (nextFrame: number) => {
    setPlaying(false);
    setFrame(nextFrame);
  };

  const changeFixture = (nextFixtureId: string) => {
    const nextFixture = fixtures.find((item) => item.id === nextFixtureId);
    if (!nextFixture) return;
    setFixtureId(nextFixture.id);
    setDraftInput(JSON.stringify(nextFixture.input ?? {}, null, 2));
    setAppliedInput(undefined);
    setDraftError(undefined);
    setIssues([]);
    setMeta(undefined);
    hasStartedPlaybackRef.current = false;
    stopAtFrame(0);
  };

  const applyInput = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftInput);
    } catch (error) {
      setDraftError(
        error instanceof Error ? error.message : "The input is not valid JSON.",
      );
      return;
    }
    setDraftError(undefined);
    setIssues([]);
    setMeta(undefined);
    hasStartedPlaybackRef.current = false;
    stopAtFrame(0);
    setAppliedInput(browserBase64Url(JSON.stringify(parsed)));
  };

  const resetInput = () => {
    setDraftInput(JSON.stringify(fixture?.input ?? {}, null, 2));
    setAppliedInput(undefined);
    setDraftError(undefined);
    setIssues([]);
    setMeta(undefined);
    hasStartedPlaybackRef.current = false;
    stopAtFrame(0);
  };

  const query = new URLSearchParams({ frame: "0" });
  if (fixture?.id) query.set("fixture", fixture.id);
  if (appliedInput) query.set("input", appliedInput);

  return (
    <div>
      <div className="bg-slate-950">
        <div className="relative aspect-video overflow-hidden">
          <iframe
            className="size-full border-0"
            key={`${version.id}:${fixture?.id ?? ""}:${appliedInput ?? "fixture"}`}
            onLoad={() =>
              iframeRef.current?.contentWindow?.postMessage(
                { type: "relay-preview-frame-v1", frame },
                "*",
              )
            }
            ref={iframeRef}
            sandbox="allow-scripts"
            src={`/api/component-loop/versions/${version.id}/preview?${query}`}
            title={`Approved preview of ${componentId} ${version.version}`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-4 py-3 text-xs text-slate-300">
          <button
            aria-label={playing ? "Pause preview" : "Play preview"}
            className="inline-flex items-center gap-1.5 rounded border border-white/15 px-2.5 py-1.5 hover:bg-white/10"
            onClick={() => {
              if (playing) {
                setPlaying(false);
                return;
              }
              if (!hasStartedPlaybackRef.current) {
                hasStartedPlaybackRef.current = true;
                setFrame(0);
              }
              setPlaying(true);
            }}
            type="button"
          >
            {playing ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            {playing ? "Pause" : "Play"}
          </button>
          <select
            aria-label="Preview fixture"
            className="max-w-56 rounded border border-white/15 bg-white/10 px-2 py-1.5"
            onChange={(event) => changeFixture(event.target.value)}
            value={fixture?.id ?? ""}
          >
            {fixtures.map((item) => (
              <option className="text-slate-950" key={item.id} value={item.id}>
                {item.name ?? item.id}
              </option>
            ))}
          </select>
          <input
            aria-label="Preview frame"
            className="min-w-24 flex-1 accent-white"
            max={maximumFrame}
            min={0}
            onChange={(event) => {
              hasStartedPlaybackRef.current = true;
              stopAtFrame(Number(event.target.value));
            }}
            type="range"
            value={Math.min(frame, maximumFrame)}
          />
          <output className="font-mono" data-testid="frame-output">
            frame {Math.min(frame, maximumFrame)} / {maximumFrame}
          </output>
        </div>
      </div>

      <div className="border-t px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Component inputs</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Edit the JSON and apply it to this preview. The approved source
              and fixtures never change.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={resetInput}
              size="sm"
              type="button"
              variant="outline"
            >
              Reset to fixture
            </Button>
            <Button onClick={applyInput} size="sm" type="button">
              Apply input
            </Button>
          </div>
        </div>
        <textarea
          aria-label="Component input JSON"
          className="mt-3 h-36 w-full resize-y rounded-md border bg-slate-950 p-3 font-mono text-xs text-slate-100"
          onChange={(event) => setDraftInput(event.target.value)}
          spellCheck={false}
          value={draftInput}
        />
        {draftError ? (
          <p className="mt-2 text-xs text-red-700" role="alert">
            {draftError}
          </p>
        ) : null}
        {issues.length > 0 ? (
          <div
            className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
            role="alert"
          >
            <p className="text-sm font-semibold text-red-900">
              Input does not match the component schema
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-red-800">
              {issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  <span className="font-mono font-semibold">
                    {issue.path || "input"}
                  </span>
                  : {issue.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-red-700">
              The preview shows this overlay until the edits pass the component
              schema.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VersionPreview({
  componentId,
  version,
}: {
  componentId: string;
  version: LibraryVersion;
}) {
  const query = new URLSearchParams({
    frame: String(version.previewFrame),
    ...(version.previewFixtureId ? { fixture: version.previewFixtureId } : {}),
  });
  return (
    <div className="relative aspect-video overflow-hidden bg-slate-950">
      <iframe
        className="size-full border-0"
        sandbox="allow-scripts"
        src={`/api/component-loop/versions/${version.id}/preview?${query}`}
        title={`Approved preview of ${componentId} ${version.version}`}
      />
      <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-slate-950/80 px-2.5 py-1 text-[10px] text-white backdrop-blur">
        <Play className="size-3" /> frame {version.previewFrame}
      </div>
    </div>
  );
}

function LibraryLoading({ label }: { label: string }) {
  return (
    <div className="mt-10 flex items-center gap-2 text-sm text-slate-600">
      <LoaderCircle className="size-4 animate-spin" /> {label}
    </div>
  );
}

function LibraryError({ message }: { message: string }) {
  return (
    <div
      className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      <strong className="block">The component library could not open</strong>
      {message}
    </div>
  );
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
}

function componentName(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "The request failed.";
}

function browserBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
