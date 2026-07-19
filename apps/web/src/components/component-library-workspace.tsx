"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  GitBranch,
  LoaderCircle,
  MessageSquareText,
  Play,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";

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
      fixtures: Array<{ id: string; name?: string }>;
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
    <LibraryShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
            Channel library
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Reusable components
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Approved component versions live here. Open one to inspect its
            history, return to its original conversation, or begin a fresh
            revision chat.
          </p>
        </div>
        <Button asChild>
          <a href="/component-loop">
            Build a component <ArrowRight />
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
    </LibraryShell>
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
      window.location.assign(`/component-loop?thread=${result.threadId}`);
    } catch (cause) {
      setError(errorMessage(cause));
      setStarting(false);
    }
  };

  return (
    <LibraryShell>
      <a
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950"
        href="/components"
      >
        <ArrowLeft className="size-4" /> Component library
      </a>

      {error ? <LibraryError message={error} /> : null}
      {!detail && !error ? <LibraryLoading label="Opening component…" /> : null}
      {detail && selected ? (
        <>
          <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-slate-500 uppercase">
                Approved channel component
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
                  <a href={`/component-loop?thread=${selected.originThreadId}`}>
                    <MessageSquareText /> Open original conversation
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
                    Exact immutable approved preview
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  <ShieldCheck className="size-3.5" /> Approved
                </span>
              </div>
              <VersionPreview
                componentId={detail.componentId}
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
    </LibraryShell>
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

function LibraryShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f7f7f8]">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <a className="flex items-center gap-3" href="/components">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white">
              <Boxes className="size-4" />
            </div>
            <div>
              <strong className="block text-sm">Relay channel studio</strong>
              <span className="text-xs text-slate-500">Component library</span>
            </div>
          </a>
          <Button asChild size="sm" variant="outline">
            <a href="/component-loop">Open Relay chat</a>
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">{children}</div>
    </main>
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
