"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type Candidate = {
  id: string;
  version: string;
  status: string;
  compatibilityWarning?: string;
  validationEvidence: {
    checks?: Array<{ code: string; status: string; message: string }>;
  };
};
type Version = { id: string; version: string; approvedAt: number };
type LoopStatus = {
  turns: Array<{
    id: string;
    state: string;
    repairAttempt: number;
    attempt: number;
    modelTurns: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    wallTimeMs: number;
    terminalMessage?: string;
  }>;
  candidates: Candidate[];
  versions: Version[];
};

const inputClass =
  "w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export function ComponentLoopWorkspace() {
  const [prompt, setPrompt] = useState(
    "Create an animated line chart for monthly channel growth with clear fixture states.",
  );
  const [revisionPrompt, setRevisionPrompt] = useState(
    "Make the primary line red and keep draw animation optional.",
  );
  const [accent, setAccent] = useState("#ef4444");
  const [background, setBackground] = useState("#07111f");
  const [font, setFont] = useState("Arial, sans-serif");
  const [threadId, setThreadId] = useState<string>();
  const [status, setStatus] = useState<LoopStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const theme = useMemo(
    () => ({
      colors: { accent, background },
      fonts: { heading: font },
      spacing: {},
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
          `/api/component-loop/threads/${threadId}`,
        );
        if (!stopped) setStatus(next);
      } catch (cause) {
        if (!stopped) setError(message(cause));
      }
      if (!stopped) timer = window.setTimeout(poll, 500);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [threadId]);

  const start = async (failureProbe = false) => {
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
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const approve = async (candidateId: string) => {
    await action(`/api/component-loop/candidates/${candidateId}/approve`, {});
  };
  const revise = async (versionId: string) => {
    if (!threadId) return;
    await action(`/api/component-loop/threads/${threadId}/revisions`, {
      versionId,
      prompt: revisionPrompt,
      theme,
    });
  };
  const action = async (url: string, body: unknown) => {
    setBusy(true);
    setError(undefined);
    try {
      await request(url, { method: "POST", body: JSON.stringify(body) });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
        Relay component loop
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">
            Create, validate, review, revise.
          </h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">
            A durable creator workflow. Generated source stays behind the worker
            boundary.
          </p>
        </div>
        {threadId && (
          <code
            className="bg-muted rounded px-3 py-2 text-xs"
            data-testid="thread-id"
          >
            {threadId}
          </code>
        )}
      </div>

      <section className="mt-8 grid gap-6 rounded-xl border bg-white p-6 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-4">
          <h2 className="font-semibold">Channel style</h2>
          <label className="block text-sm">
            Accent color
            <input
              aria-label="Accent color"
              className={`${inputClass} mt-1 h-11`}
              type="color"
              value={accent}
              onChange={(event) => setAccent(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Background color
            <input
              aria-label="Background color"
              className={`${inputClass} mt-1 h-11`}
              type="color"
              value={background}
              onChange={(event) => setBackground(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Heading font
            <input
              className={`${inputClass} mt-1`}
              value={font}
              onChange={(event) => setFont(event.target.value)}
            />
          </label>
        </div>
        <div>
          <label className="text-sm font-semibold">
            Component request
            <textarea
              className={`${inputClass} mt-2 min-h-28`}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void start()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              Build line chart
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void start(true)}
            >
              Exercise budget limit
            </Button>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            The budget probe is deterministic in local fake mode and shows a
            recoverable terminal path.
          </p>
        </div>
      </section>

      {error && (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </div>
      )}

      {status && (
        <>
          <section className="mt-8">
            <h2 className="text-xl font-semibold">Implementation activity</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {status.turns.map((turn) => (
                <article
                  className="rounded-lg border bg-white p-4"
                  key={turn.id}
                >
                  <div className="flex items-center justify-between">
                    <strong>{turn.state}</strong>
                    <span className="text-muted-foreground text-xs">
                      attempt {turn.attempt} · repair {turn.repairAttempt}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {turn.modelTurns} model turns · {turn.toolCalls} tools ·{" "}
                    {turn.inputTokens + turn.outputTokens} tokens ·{" "}
                    {turn.wallTimeMs} ms
                  </p>
                  {turn.terminalMessage && (
                    <p className="mt-2 text-sm">{turn.terminalMessage}</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-xl font-semibold">Review candidates</h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              {status.candidates.map((candidate) => (
                <article
                  className="rounded-lg border bg-white p-5"
                  key={candidate.id}
                >
                  <div className="flex items-center justify-between">
                    <strong>animated-line-chart@{candidate.version}</strong>
                    <span className="bg-muted rounded-full px-2 py-1 text-xs">
                      {candidate.status}
                    </span>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm">
                    {candidate.validationEvidence.checks?.map((check) => (
                      <li className="flex gap-2" key={check.code}>
                        <Check className="mt-0.5 size-4 text-green-600" />
                        {check.message}
                      </li>
                    ))}
                  </ul>
                  {candidate.compatibilityWarning && (
                    <p className="mt-3 text-sm text-amber-700">
                      {candidate.compatibilityWarning}
                    </p>
                  )}
                  {candidate.status === "reviewable" && (
                    <div className="mt-4 flex gap-2">
                      <Button
                        disabled={busy}
                        onClick={() => void approve(candidate.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        disabled={busy}
                        variant="outline"
                        onClick={() =>
                          void action(
                            `/api/component-loop/candidates/${candidate.id}/request-changes`,
                            { note: "Please refine this candidate." },
                          )
                        }
                      >
                        Request changes
                      </Button>
                    </div>
                  )}
                </article>
              ))}
              {status.candidates.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  Waiting for independent validation…
                </p>
              )}
            </div>
          </section>

          <section className="mt-8 rounded-xl border bg-white p-6">
            <h2 className="text-xl font-semibold">Approved versions</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {status.versions.map((version) => (
                <article className="rounded-lg border p-4" key={version.id}>
                  <strong>animated-line-chart@{version.version}</strong>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild variant="outline">
                      <a
                        href={`/components/animated-line-chart/versions/${version.version}/preview`}
                        target="_blank"
                      >
                        Preview & render <ArrowUpRight />
                      </a>
                    </Button>
                    {version.version === "1.0.0" && (
                      <Button
                        disabled={busy}
                        onClick={() => void revise(version.id)}
                      >
                        <RotateCcw />
                        Start revision
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {status.versions.some(({ version }) => version === "1.0.0") && (
              <label className="mt-6 block text-sm font-semibold">
                Revision request
                <textarea
                  className={`${inputClass} mt-2 min-h-24`}
                  value={revisionPrompt}
                  onChange={(event) => setRevisionPrompt(event.target.value)}
                />
              </label>
            )}
          </section>
        </>
      )}
    </main>
  );
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

function message(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "The component-loop request failed.";
}
