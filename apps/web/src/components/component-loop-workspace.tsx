"use client";

import { useEffect, useMemo, useState } from "react";
import { type ChannelTheme } from "@relay/component-sdk";
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
  componentId: string;
  version: string;
  status: string;
  sourceHash: string;
  versionAlreadyApproved: boolean;
  compatibilityWarning?: string;
  fixtures?: Array<{
    id: string;
    name: string;
    checkpoints?: Array<{ frame: number }>;
  }>;
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
  cacheReadTokens: number;
  cacheWriteTokens: number;
  wallTimeMs: number;
  terminalMessage?: string;
  assistantText: string;
  createdAt: number;
};
type ConversationMessage = {
  _id: string;
  messageId: string;
  role: "user" | "assistant";
  state: "streaming" | "complete" | "failed";
  content: string;
  safeStatus?: string;
  transitionBrief?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  createdAt: number;
};
type Version = {
  id: string;
  componentId: string;
  version: string;
  approvedAt: number;
};
type LoopStatus = {
  authoringMode: "fake" | "real";
  model?: string;
  phase: "dialogue" | "authoring" | "review";
  messages: ConversationMessage[];
  turns: Turn[];
  activities: Activity[];
  builds: Build[];
  candidates: Candidate[];
  versions: Version[];
};

const inputClass =
  "w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

export function ComponentLoopWorkspace() {
  const [draft, setDraft] = useState("");
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
    if (!threadId) {
      await start(prompt);
    } else {
      setDraft("");
      await act("/api/component-loop/threads/" + threadId + "/messages", {
        prompt,
        theme,
      });
    }
  };

  const canSend = Boolean(draft.trim()) && !busy && !working;

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
                ? status?.phase === "dialogue"
                  ? "Ready to chat"
                  : "Ready for review"
                : "Ready"}
            {status && (
              <span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-[10px]">
                {status.authoringMode === "real"
                  ? status.model?.split("/").at(-1)
                  : "deterministic fake"}
              </span>
            )}
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
                    ? "Relay is responding…"
                    : status?.versions.length
                      ? "Talk through the next revision…"
                      : "Talk with Relay about what you want to build…"
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
        Start with an idea—or just say hello. Relay will talk it through and
        only begin implementation when the brief is clear.
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
  const timeline = [
    ...(status.messages ?? []).map((message) => ({
      kind: "message" as const,
      createdAt: message.createdAt,
      message,
    })),
    ...status.turns.map((turn) => ({
      kind: "turn" as const,
      createdAt: turn.createdAt,
      turn,
    })),
  ].sort((left, right) => left.createdAt - right.createdAt);
  return (
    <div className="space-y-9">
      {timeline.map((item) => {
        if (item.kind === "message")
          return <ChatMessage key={item.message._id} message={item.message} />;
        const turn = item.turn;
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
            <AgentMessage
              activities={activities}
              busy={busy}
              candidate={candidate}
              onApprove={onApprove}
              onRequestChanges={onRequestChanges}
              theme={theme}
              turn={turn}
              working={working}
              superseded={
                Boolean(candidate) &&
                status.candidates.at(-1)?.id !== candidate?.id
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function ChatMessage({ message }: { message: ConversationMessage }) {
  if (message.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-slate-900 px-4 py-3 text-sm leading-6 text-white">
          {message.content}
        </div>
      </div>
    );
  const tokens =
    (message.inputTokens ?? 0) +
    (message.outputTokens ?? 0) +
    (message.cacheReadTokens ?? 0) +
    (message.cacheWriteTokens ?? 0);
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-slate-100">
        <Sparkles className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <strong className="text-sm">Relay</strong>
          <span className="text-xs text-slate-400">
            {message.state === "streaming" ? "responding…" : "conversation"}
          </span>
        </div>
        <div className="mt-2 text-sm leading-6 whitespace-pre-wrap text-slate-700">
          {message.content || <span className="animate-pulse">●</span>}
          {message.state === "streaming" && message.content && (
            <span className="ml-0.5 animate-pulse">▋</span>
          )}
        </div>
        {message.safeStatus && (
          <details className="mt-3 rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <summary className="cursor-pointer">Activity</summary>
            <p className="mt-2">{message.safeStatus}</p>
          </details>
        )}
        {message.transitionBrief && (
          <p className="mt-3 flex items-center gap-2 text-xs font-medium text-indigo-700">
            <Wrench className="size-3.5" /> Component implementation started
          </p>
        )}
        {tokens > 0 && (
          <p className="mt-2 text-[11px] text-slate-400">
            Dialogue · {tokens} provider tokens
          </p>
        )}
      </div>
    </div>
  );
}

function AgentMessage({
  turn,
  activities,
  candidate,
  working,
  busy,
  theme,
  onApprove,
  onRequestChanges,
  superseded,
}: {
  turn: Turn;
  activities: Activity[];
  candidate: Candidate | undefined;
  working: boolean;
  busy: boolean;
  theme: ChannelTheme;
  onApprove: (id: string) => void;
  onRequestChanges: (id: string) => void;
  superseded: boolean;
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
              : failed
                ? "needs attention"
                : candidate?.status === "approved"
                  ? "version approved"
                  : candidate
                    ? "ready for review"
                    : "finished"}
          </span>
        </div>
        <div className="mt-2 text-sm leading-6 whitespace-pre-wrap text-slate-700">
          {working
            ? turn.assistantText || (
                <AgentLoading label="Implementing and validating your component…" />
              )
            : failed
              ? (turn.terminalMessage ?? "This run needs your attention.")
              : candidate
                ? turn.assistantText ||
                  "I finished the component and validation passed. Inspect the preview and decide what happens next."
                : (turn.terminalMessage ?? "Implementation finished.")}
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
            onApprove={onApprove}
            onRequestChanges={onRequestChanges}
            superseded={superseded}
            theme={theme}
          />
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-400">
          <span>{turn.modelTurns} model turn</span>
          <span>{turn.toolCalls} tools</span>
          <span>
            {turn.inputTokens +
              turn.outputTokens +
              turn.cacheReadTokens +
              turn.cacheWriteTokens}{" "}
            provider tokens
          </span>
          <span>{turn.wallTimeMs} ms</span>
          {turn.repairAttempt > 0 && <span>repair {turn.repairAttempt}</span>}
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  theme,
  busy,
  onApprove,
  onRequestChanges,
  superseded,
}: {
  candidate: Candidate;
  theme: ChannelTheme;
  busy: boolean;
  onApprove: (id: string) => void;
  onRequestChanges: (id: string) => void;
  superseded: boolean;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm font-semibold">
            {componentName(candidate.componentId)}{" "}
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

      <InlinePreview candidate={candidate} theme={theme} />

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
        <SourceInspector candidate={candidate} />
        {candidate.status === "reviewable" &&
          !candidate.versionAlreadyApproved &&
          !superseded && (
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
        {superseded && (
          <p className="mt-4 text-xs text-slate-500">
            Preserved for comparison. A validated successor is the active review
            target.
          </p>
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
  theme,
}: {
  candidate: Candidate;
  theme: ChannelTheme;
}) {
  const fixtures = candidate.fixtures ?? [];
  const [fixtureId, setFixtureId] = useState(fixtures[0]?.id ?? "");
  const fixture = fixtures.find((item) => item.id === fixtureId) ?? fixtures[0];
  const maximumFrame = Math.max(
    179,
    ...(fixture?.checkpoints?.map((item) => item.frame) ?? [0]),
  );
  const [frame, setFrame] = useState(Math.min(45, maximumFrame));
  const [playing, setPlaying] = useState(false);
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
      1000 / 30,
    );
    return () => window.clearInterval(timer);
  }, [maximumFrame, playing]);
  const query = new URLSearchParams({
    fixture: fixture?.id ?? "",
    frame: String(frame),
    theme: browserBase64Url(JSON.stringify(theme)),
  });
  return (
    <div className="bg-slate-950">
      <iframe
        className="aspect-video w-full border-0"
        key={`${candidate.id}:${fixture?.id}:${frame}:${JSON.stringify(theme)}`}
        sandbox="allow-scripts"
        src={`/api/component-loop/candidates/${candidate.id}/preview?${query}`}
        title={`Exact preview of ${candidate.componentId} ${candidate.version}`}
      />
      <div className="flex items-center gap-3 border-t border-white/10 px-3 py-2 text-[11px] text-slate-300">
        <button
          aria-label={playing ? "Pause preview" : "Play preview"}
          className="rounded border border-white/15 px-2 py-1"
          onClick={() => setPlaying((value) => !value)}
          type="button"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <select
          aria-label="Preview fixture"
          className="max-w-48 rounded border border-white/15 bg-white/10 px-2 py-1"
          onChange={(event) => {
            setFixtureId(event.target.value);
            setFrame(0);
          }}
          value={fixture?.id ?? ""}
        >
          {fixtures.map((item) => (
            <option className="text-slate-950" key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Preview frame"
          className="min-w-24 flex-1 accent-white"
          max={maximumFrame}
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

function SourceInspector({ candidate }: { candidate: Candidate }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const load = async () => {
    if (source || error) return;
    try {
      const response = await fetch(
        `/api/component-loop/candidates/${candidate.id}/source`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Generated source is unavailable.");
      setSource(await response.text());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return (
    <div className="mt-3">
      <button
        className="text-xs font-medium text-slate-600"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load();
        }}
        type="button"
      >
        Inspect generated source · {candidate.sourceHash?.slice(0, 12)}
      </button>
      {open && (
        <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-[11px] leading-5 text-slate-200">
          {error ?? source ?? "Loading exact validated source…"}
        </pre>
      )}
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
              <a
                className="font-mono text-xs underline-offset-4 hover:underline"
                href={`/api/component-loop/versions/${version.id}/preview`}
                target="_blank"
              >
                {version.componentId}@v{version.version}
              </a>
              <span className="text-[10px] text-slate-400">
                {index === 0 ? "latest · open" : "saved · open"}
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
    (status.messages ?? []).some((message) => message.state === "streaming") ||
    status.turns.some((turn) => ["queued", "running"].includes(turn.state)) ||
    status.builds.some((build) =>
      ["queued", "running", "validating"].includes(build.state),
    )
  );
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

function componentName(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
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

function browserBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
