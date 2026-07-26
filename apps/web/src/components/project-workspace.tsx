"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  CircleStop,
  Clapperboard,
  ExternalLink,
  FileText,
  FolderKanban,
  Globe2,
  Link2,
  LoaderCircle,
  PencilLine,
  Plus,
  Save,
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
          <SourceWorkspace
            editable={data.project.status === "active"}
            projectId={projectId}
          />
        </>
      ) : null}
    </ProjectShell>
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
        .then(setData)
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
