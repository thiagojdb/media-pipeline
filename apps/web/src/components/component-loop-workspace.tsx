"use client";

import { useEffect, useMemo, useState } from "react";
import {
  resolveVideoComponentDuration,
  type ChannelTheme,
} from "@relay/component-sdk";
import { lineChart, lineChartRevision } from "@relay/reference-components";
import { VideoComponentFrame } from "@relay/rendering";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  LoaderCircle,
  MessageSquareText,
  Palette,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type Activity = {
  turnId: string;
  sequence: number;
  name: string;
  outputSummary: string;
};
type Build = {
  turnId: string;
  state: string;
  candidateId?: string;
};
type Candidate = {
  id: string;
  version: string;
  status: string;
  versionAlreadyApproved: boolean;
  compatibilityWarning?: string;
  validationEvidence: {
    checks?: Array<{ code: string; status: string; message: string }>;
  };
};
type Turn = {
  id: string;
  turnId: string;
  userRequest: string;
  state: string;
  repairAttempt: number;
  modelTurns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  wallTimeMs: number;
  terminalMessage?: string;
};
type Version = { id: string; version: string; approvedAt: number };
type LoopStatus = {
  turns: Turn[];
  activities: Activity[];
  builds: Build[];
  candidates: Candidate[];
  versions: Version[];
};

const inputClass =
  "w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

export function ComponentLoopWorkspace() {
  const [draft, setDraft] = useState(
    "Create an animated line chart for monthly channel growth with clear fixture states.",
  );
  const [accent, setAccent] = useState("#ef4444");
  const [background, setBackground] = useState("#07111f");
  const [font, setFont] = useState("Arial, sans-serif");
  const [threadId, setThreadId] = useState<string>();
  const [status, setStatus] = useState<LoopStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const theme = useMemo<ChannelTheme>(
    () => ({
      colors: {
        accent,
        background,
        foreground: "#f4f7fb",
        muted: "#91a3ba",
        grid: "#24364d",
      },
      fonts: { heading: font, body: font },
      spacing: { outer: 72 },
    }),
    [accent, background, font],
  );

  useEffect(() => {
    if (!threadId) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await request<LoopStatus>(
          "/api/component-loop/threads/" + threadId,
        );
        if (stopped) return;
        setStatus(next);
        if (hasActiveWork(next)) timer = window.setTimeout(poll, 500);
      } catch (cause) {
        if (!stopped) setError(errorMessage(cause));
      }
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [threadId]);

  const working = Boolean(threadId && (!status || hasActiveWork(status)));

  const start = async (prompt: string, failureProbe = false) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await request<{ threadId: string }>(
        "/api/component-loop/requests",
        {
          method: "POST",
          body: JSON.stringify({ prompt, theme, failureProbe }),
        },
      );
      setThreadId(result.threadId);
      setStatus(undefined);
      setDraft("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const act = async (url: string, body: unknown) => {
    setBusy(true);
    setError(undefined);
    try {
      await request(url, { method: "POST", body: JSON.stringify(body) });
      if (threadId) {
        let next = await request<LoopStatus>(
          "/api/component-loop/threads/" + threadId,
        );
        setStatus(next);
        while (hasActiveWork(next)) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          next = await request<LoopStatus>(
            "/api/component-loop/threads/" + threadId,
          );
          setStatus(next);
        }
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt) return;
    const latest = status?.versions.at(-1);
    if (!threadId) {
      await start(prompt);
    } else if (latest) {
      setDraft("");
      await act("/api/component-loop/threads/" + threadId + "/revisions", {
        versionId: latest.id,
        prompt,
        theme,
      });
    }
  };

  const canSend =
    Boolean(draft.trim()) &&
    !busy &&
    !working &&
    (!threadId || Boolean(status?.versions.length));

  return (
    <main className="min-h-screen bg-[#f7f7f8]">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h1 className="font-semibold">Relay component builder</h1>
              <p className="text-xs text-slate-500">
                Create, validate, preview, and revise in one conversation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span
              className={
                "size-2 rounded-full " +
                (working ? "animate-pulse bg-amber-500" : "bg-emerald-500")
              }
            />
            {working
              ? "Agent working"
              : threadId
                ? "Ready for review"
                : "Ready"}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
        <section className="flex min-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex-1 px-5 py-7 sm:px-8">
            {!threadId ? (
              <EmptyConversation />
            ) : status ? (
              <Conversation
                busy={busy}
                onApprove={(id) =>
                  void act(
                    "/api/component-loop/candidates/" + id + "/approve",
                    {},
                  )
                }
                onRequestChanges={(id) =>
                  void act(
                    "/api/component-loop/candidates/" + id + "/request-changes",
                    { note: "Please revise this candidate." },
                  )
                }
                status={status}
                theme={theme}
              />
            ) : (
              <AgentLoading label="Opening a component workspace…" />
            )}

            {error && (
              <div
                className="mt-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <strong className="block">Relay needs your attention</strong>
                  {error}
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 border-t bg-white/95 p-4 backdrop-blur sm:p-5">
            <div className="rounded-2xl border bg-white p-2 shadow-sm focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100">
              <textarea
                aria-label="Message Relay"
                className="min-h-20 w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
                disabled={working}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && canSend) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  working
                    ? "Relay is implementing your request…"
                    : status?.versions.length
                      ? "Ask Relay for the next revision…"
                      : "Describe the component you want to build…"
                }
                value={draft}
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <span className="text-xs text-slate-400">
                  Enter to send · Shift+Enter for a new line
                </span>
                <Button
                  aria-label="Send message"
                  className="rounded-xl"
                  disabled={!canSend}
                  onClick={() => void send()}
                  size="icon"
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : <Send />}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <ChannelContext
            accent={accent}
            background={background}
            font={font}
            onAccent={setAccent}
            onBackground={setBackground}
            onFont={setFont}
          />
          <VersionHistory versions={status?.versions ?? []} />
          <details className="rounded-xl border bg-white p-4 text-sm shadow-sm">
            <summary className="cursor-pointer list-none font-medium text-slate-600">
              Developer recovery test
            </summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Runs the deterministic budget-exhaustion path without model cost.
            </p>
            <Button
              className="mt-3 w-full"
              disabled={busy || working}
              onClick={() =>
                void start(draft.trim() || "Exercise recovery.", true)
              }
              size="sm"
              variant="outline"
            >
              Exercise budget limit
            </Button>
          </details>
        </aside>
      </div>
    </main>
  );
}

function EmptyConversation() {
  return (
    <div className="mx-auto flex min-h-[420px] max-w-xl flex-col items-center justify-center text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-slate-100">
        <MessageSquareText className="size-5" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">
        What should Relay build?
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
        Describe a reusable video component. Relay will show implementation,
        independent validation, and a reviewable preview here.
      </p>
    </div>
  );
}

function Conversation({
  status,
  busy,
  theme,
  onApprove,
  onRequestChanges,
}: {
  status: LoopStatus;
  busy: boolean;
  theme: ChannelTheme;
  onApprove: (id: string) => void;
  onRequestChanges: (id: string) => void;
}) {
  return (
    <div className="space-y-9">
      {status.turns.map((turn) => {
        const activities = status.activities.filter(
          (item) => item.turnId === turn.id,
        );
        const build = status.builds.find((item) => item.turnId === turn.turnId);
        const candidate = build?.candidateId
          ? status.candidates.find((item) => item.id === build.candidateId)
          : undefined;
        const working =
          ["queued", "running"].includes(turn.state) ||
          Boolean(
            build && ["queued", "running", "validating"].includes(build.state),
          );
        return (
          <div className="space-y-5" key={turn.id}>
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-slate-900 px-4 py-3 text-sm leading-6 text-white">
                {creatorText(turn.userRequest)}
              </div>
            </div>
            <AgentMessage
              activities={activities}
              busy={busy}
              candidate={candidate}
              deterministicFake={turn.userRequest.includes("[FAKE_")}
              onApprove={onApprove}
              onRequestChanges={onRequestChanges}
              theme={theme}
              turn={turn}
              working={working}
            />
          </div>
        );
      })}
    </div>
  );
}

function AgentMessage({
  turn,
  activities,
  candidate,
  working,
  busy,
  deterministicFake,
  theme,
  onApprove,
  onRequestChanges,
}: {
  turn: Turn;
  activities: Activity[];
  candidate: Candidate | undefined;
  working: boolean;
  busy: boolean;
  deterministicFake: boolean;
  theme: ChannelTheme;
  onApprove: (id: string) => void;
  onRequestChanges: (id: string) => void;
}) {
  const failed = ["failed", "needs_intervention", "canceled"].includes(
    turn.state,
  );
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-slate-100">
        <Sparkles className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <strong className="text-sm">Relay</strong>
          <span className="text-xs text-slate-400">
            {working
              ? "working now"
              : candidate?.status === "approved"
                ? "version approved"
                : candidate
                  ? "ready for review"
                  : "finished"}
          </span>
        </div>
        <div className="mt-2 text-sm leading-6 text-slate-700">
          {working ? (
            <AgentLoading label="Implementing and validating your component…" />
          ) : failed ? (
            (turn.terminalMessage ?? "This run needs your attention.")
          ) : candidate ? (
            "I finished the component and validation passed. Inspect the preview and decide what happens next."
          ) : (
            (turn.terminalMessage ?? "Implementation finished.")
          )}
        </div>

        {activities.length > 0 && (
          <details className="mt-4 overflow-hidden rounded-xl border bg-slate-50/70">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-medium text-slate-600">
              <span className="flex items-center gap-2">
                <Wrench className="size-3.5" />
                {activities.length} implementation steps
              </span>
              <ChevronDown className="size-3.5" />
            </summary>
            <ol className="space-y-3 border-t px-4 py-3">
              {activities.map((activity) => (
                <li className="flex gap-3 text-xs" key={activity.sequence}>
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                  <div>
                    <strong className="block font-medium text-slate-700">
                      {activityName(activity.name)}
                    </strong>
                    <span className="text-slate-500">
                      {activity.outputSummary}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}

        {candidate && (
          <CandidateCard
            busy={busy}
            candidate={candidate}
            deterministicFake={deterministicFake}
            onApprove={onApprove}
            onRequestChanges={onRequestChanges}
            theme={theme}
          />
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-400">
          <span>{turn.modelTurns} model turn</span>
          <span>{turn.toolCalls} tools</span>
          <span>{turn.inputTokens + turn.outputTokens} tokens</span>
          <span>{turn.wallTimeMs} ms</span>
          {turn.repairAttempt > 0 && <span>repair {turn.repairAttempt}</span>}
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  deterministicFake,
  theme,
  busy,
  onApprove,
  onRequestChanges,
}: {
  candidate: Candidate;
  deterministicFake: boolean;
  theme: ChannelTheme;
  busy: boolean;
  onApprove: (id: string) => void;
  onRequestChanges: (id: string) => void;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm font-semibold">
            Animated line chart{" "}
            <span className="font-mono text-xs text-slate-400">
              v{candidate.version}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Validated candidate</p>
        </div>
        <span
          className={
            "rounded-full px-2.5 py-1 text-[10px] font-medium uppercase " +
            (candidate.status === "approved"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700")
          }
        >
          {candidate.status}
        </span>
      </div>

      <InlinePreview
        candidate={candidate}
        deterministicFake={deterministicFake}
        theme={theme}
      />

      <div className="p-4">
        {candidate.compatibilityWarning && (
          <p className="mb-3 text-xs text-amber-700">
            {candidate.compatibilityWarning}
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-xs font-medium text-slate-600">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-3.5 text-emerald-600" />
              {candidate.validationEvidence.checks?.length ?? 0} validation
              checks passed
            </span>
          </summary>
          <ul className="mt-3 space-y-2 border-l pl-4 text-xs text-slate-500">
            {candidate.validationEvidence.checks?.map((check) => (
              <li key={check.code}>{check.message}</li>
            ))}
          </ul>
        </details>
        {candidate.status === "reviewable" &&
          !candidate.versionAlreadyApproved && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => onApprove(candidate.id)}
                size="sm"
              >
                <Check /> Approve version
              </Button>
              <Button
                disabled={busy}
                onClick={() => onRequestChanges(candidate.id)}
                size="sm"
                variant="outline"
              >
                Request changes
              </Button>
            </div>
          )}
        {candidate.status === "reviewable" &&
          candidate.versionAlreadyApproved && (
            <p className="mt-4 text-xs text-amber-700">
              This version already exists. Ask Relay for a successor.
            </p>
          )}
        {candidate.status === "approved" && (
          <p className="mt-4 flex items-center gap-2 text-xs font-medium text-emerald-700">
            <Check className="size-4" /> Version approved and saved
          </p>
        )}
      </div>
    </div>
  );
}

function InlinePreview({
  candidate,
  deterministicFake,
  theme,
}: {
  candidate: Candidate;
  deterministicFake: boolean;
  theme: ChannelTheme;
}) {
  const definition =
    candidate.version === "1.0.0" ? lineChart : lineChartRevision;
  const [fixtureId, setFixtureId] = useState(definition.fixtures[0]!.id);
  const fixture =
    definition.fixtures.find((item) => item.id === fixtureId) ??
    definition.fixtures[0]!;
  const duration = resolveVideoComponentDuration(definition, fixture.input);
  const [frame, setFrame] = useState(Math.min(45, duration - 1));

  if (!deterministicFake) {
    return (
      <div className="flex aspect-video items-center justify-center bg-slate-950 px-8 text-center text-xs leading-5 text-slate-400">
        The validated source remains behind the worker boundary. Its sandboxed
        interactive preview is preparing.
      </div>
    );
  }
  return (
    <div className="bg-slate-950">
      <div className="aspect-video overflow-hidden [&>svg]:h-full [&>svg]:w-full">
        <VideoComponentFrame
          assets={{}}
          definition={definition}
          dimensions={{ width: 960, height: 540 }}
          durationInFrames={duration}
          frame={frame}
          input={fixture.input}
          theme={theme}
        />
      </div>
      <div className="flex items-center gap-3 border-t border-white/10 px-3 py-2 text-[11px] text-slate-300">
        <select
          aria-label="Preview fixture"
          className="max-w-48 rounded border border-white/15 bg-white/10 px-2 py-1"
          onChange={(event) => {
            setFixtureId(event.target.value);
            setFrame(0);
          }}
          value={fixture.id}
        >
          {definition.fixtures.map((item) => (
            <option className="text-slate-950" key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Preview frame"
          className="min-w-24 flex-1 accent-white"
          max={duration - 1}
          min={0}
          onChange={(event) => setFrame(Number(event.target.value))}
          type="range"
          value={frame}
        />
        <span className="font-mono">frame {frame}</span>
      </div>
    </div>
  );
}

function ChannelContext({
  accent,
  background,
  font,
  onAccent,
  onBackground,
  onFont,
}: {
  accent: string;
  background: string;
  font: string;
  onAccent: (value: string) => void;
  onBackground: (value: string) => void;
  onFont: (value: string) => void;
}) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Palette className="size-4" />
        <h2 className="text-sm font-semibold">Channel context</h2>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Used while authoring and previewing.
      </p>
      <div className="mt-4 space-y-3">
        <ColorInput label="Accent color" value={accent} onChange={onAccent} />
        <ColorInput
          label="Background color"
          value={background}
          onChange={onBackground}
        />
        <label className="block text-xs font-medium text-slate-600">
          Heading font
          <input
            className={inputClass + " mt-1"}
            onChange={(event) => onFont(event.target.value)}
            value={font}
          />
        </label>
      </div>
    </section>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <input
          aria-label={label}
          className="h-9 w-11 rounded-md border bg-white p-1"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={value}
        />
        <code className="text-xs text-slate-400">{value}</code>
      </div>
    </label>
  );
}

function VersionHistory({ versions }: { versions: Version[] }) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Approved versions</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {versions.length}
        </span>
      </div>
      {versions.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Approved versions will remain here as the conversation continues.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {[...versions].reverse().map((version, index) => (
            <li
              className="flex items-center justify-between rounded-lg border px-3 py-2"
              key={version.id}
            >
              <span className="font-mono text-xs">v{version.version}</span>
              <span className="text-[10px] text-slate-400">
                {index === 0 ? "latest" : "saved"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AgentLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <LoaderCircle className="size-4 animate-spin text-slate-400" />
      {label}
    </div>
  );
}

function hasActiveWork(status: LoopStatus): boolean {
  return (
    status.turns.some((turn) => ["queued", "running"].includes(turn.state)) ||
    status.builds.some((build) =>
      ["queued", "running", "validating"].includes(build.state),
    )
  );
}

function creatorText(value: string): string {
  return value.replace(/^\[FAKE_[A-Z_]+\]\s*/, "");
}

function activityName(value: string): string {
  const names: Record<string, string> = {
    read_authoring_context: "Read component and channel context",
    replace_candidate_source: "Implemented the component source",
    check_candidate: "Checked source and dependency policy",
    declare_candidate_ready: "Submitted the candidate for validation",
  };
  return names[value] ?? value.replaceAll("_", " ");
}

async function request<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = (await response.json()) as { message?: string } & T;
  if (!response.ok)
    throw new Error(body.message ?? "The component-loop request failed.");
  return body;
}

function errorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "The component-loop request failed.";
}
