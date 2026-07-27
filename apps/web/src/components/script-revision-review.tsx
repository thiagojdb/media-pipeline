"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Extension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { diffLines } from "diff";
import { CheckCheck, RotateCcw, Sparkles, X, XCircle } from "lucide-react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { Button } from "@/components/ui/button";

type Decision = "accepted" | "rejected" | "pending";
type FinalDecision = Exclude<Decision, "pending">;
type ReviewSegment =
  | { kind: "unchanged"; value: string }
  | {
      kind: "change";
      index: number;
      original: string;
      revised: string;
      originalFrom: number;
      originalTo: number;
    };

const revisionReviewPluginKey = new PluginKey<Record<number, FinalDecision>>(
  "scriptRevisionReview",
);

export function ScriptRevisionReview({
  documentMarkdown,
  instruction,
  original,
  rationale,
  revised,
  scope,
  selectionFrom,
  selectionTo,
  onApply,
  onClose,
  onReject,
}: {
  documentMarkdown: string;
  instruction: string;
  original: string;
  rationale: string;
  revised: string;
  scope: "selection" | "document";
  selectionFrom: number;
  selectionTo: number;
  onApply: (replacementMarkdown: string) => void;
  onClose: () => void;
  onReject: () => void;
}) {
  const segments = useMemo(
    () => revisionSegments(original, revised),
    [original, revised],
  );
  const changes = useMemo(
    () =>
      segments.filter(
        (segment): segment is Extract<ReviewSegment, { kind: "change" }> =>
          segment.kind === "change",
      ),
    [segments],
  );
  const [decisions, setDecisions] = useState<Record<number, FinalDecision>>({});

  const acceptedCount = Object.values(decisions).filter(
    (decision) => decision === "accepted",
  ).length;
  const rejectedCount = Object.values(decisions).filter(
    (decision) => decision === "rejected",
  ).length;
  const pendingCount = changes.length - Object.keys(decisions).length;

  const replacementFor = useCallback(
    (nextDecisions: Record<number, FinalDecision>) =>
      segments
        .map((segment) =>
          segment.kind === "unchanged"
            ? segment.value
            : nextDecisions[segment.index] === "accepted"
              ? segment.revised
              : segment.original,
        )
        .join(""),
    [segments],
  );

  const finish = useCallback(
    (nextDecisions: Record<number, FinalDecision>) => {
      const nextAcceptedCount = Object.values(nextDecisions).filter(
        (decision) => decision === "accepted",
      ).length;
      if (nextAcceptedCount === 0) {
        onReject();
        return;
      }
      onApply(replacementFor(nextDecisions));
    },
    [onApply, onReject, replacementFor],
  );

  const decide = useCallback(
    (index: number, decision: FinalDecision) => {
      const nextDecisions = { ...decisions, [index]: decision };
      if (Object.keys(nextDecisions).length === changes.length) {
        finish(nextDecisions);
        return;
      }
      setDecisions(nextDecisions);
    },
    [changes.length, decisions, finish],
  );

  const decideRemaining = (decision: FinalDecision) => {
    const nextDecisions = { ...decisions };
    for (const change of changes) {
      if (!nextDecisions[change.index]) {
        nextDecisions[change.index] = decision;
      }
    }
    finish(nextDecisions);
  };

  const reviewExtension = useMemo(
    () =>
      revisionReviewExtension({
        changes,
        original,
        scope,
        selectionFrom,
        selectionTo,
      }),
    [changes, original, scope, selectionFrom, selectionTo],
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          autolink: true,
          defaultProtocol: "https",
          openOnClick: true,
        },
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: false },
      }),
      reviewExtension,
    ],
    content: documentMarkdown,
    contentType: "markdown",
    editorProps: {
      attributes: {
        "aria-label": "Script with proposed changes",
        class:
          "tiptap min-h-full px-5 py-6 outline-none sm:px-10 lg:px-[clamp(2.5rem,6vw,6rem)]",
        role: "document",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(revisionReviewPluginKey, { decisions }),
    );
  }, [decisions, editor]);

  useEffect(() => {
    if (!editor) return;
    const handleDecision = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as {
        index?: unknown;
        decision?: unknown;
      };
      if (
        typeof detail.index === "number" &&
        (detail.decision === "accepted" || detail.decision === "rejected")
      ) {
        decide(detail.index, detail.decision);
      }
    };
    editor.view.dom.addEventListener("revision-decision", handleDecision);
    return () =>
      editor.view.dom.removeEventListener("revision-decision", handleDecision);
  }, [decide, editor]);

  useEffect(() => {
    if (!editor) return;
    const frame = window.requestAnimationFrame(() => {
      editor.view.dom
        .querySelector<HTMLElement>("[data-revision-hunk]")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="z-20 border-b border-[#e5e8e6] bg-[#fbfcfa]/95 px-3 py-2 backdrop-blur sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-[12rem] flex-1">
            <div className="flex items-center gap-2">
              <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-[#355ce8] uppercase">
                <Sparkles className="size-3.5" />
                {pendingCount} {pendingCount === 1 ? "change" : "changes"} left
                {acceptedCount ? ` · ${acceptedCount} accepted` : ""}
                {rejectedCount ? ` · ${rejectedCount} rejected` : ""}
              </p>
              <span className="text-xs font-semibold text-[#20262a]">
                {instruction}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[#68747d]">
              {rationale}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {Object.keys(decisions).length ? (
              <Button
                className="h-8 rounded-lg px-2.5 text-xs font-semibold text-[#59656c] transition-[background-color,color,transform] active:translate-y-px"
                onClick={() => setDecisions({})}
                size="sm"
                type="button"
                variant="ghost"
              >
                <RotateCcw />
                Undo choices
              </Button>
            ) : null}
            <Button
              className="h-8 rounded-lg border-[#d8dddf] bg-white px-2.5 text-xs font-semibold text-[#343c41] shadow-[0_1px_2px_rgba(24,34,39,0.08)] transition-[background-color,border-color,box-shadow,transform] hover:border-[#b8c1c5] hover:bg-[#f7f8f6] hover:text-[#20262a] active:translate-y-px"
              onClick={() => decideRemaining("rejected")}
              size="sm"
              type="button"
              variant="outline"
            >
              <XCircle />
              Reject remaining
            </Button>
            <Button
              className="h-8 rounded-lg border border-[#2d53d3] bg-[#355ce8] px-3 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(35,73,196,0.3),inset_0_1px_rgba(255,255,255,0.18)] transition-[background-color,border-color,box-shadow,transform] hover:border-[#2749bc] hover:bg-[#2f55d6] hover:shadow-[0_3px_8px_rgba(35,73,196,0.24)] active:translate-y-px"
              onClick={() => decideRemaining("accepted")}
              size="sm"
              type="button"
            >
              <CheckCheck />
              Accept remaining
            </Button>
            <button
              aria-label="Close review"
              className="flex size-8 items-center justify-center rounded-lg border border-transparent text-[#68747d] transition-[background-color,border-color,color,transform] hover:border-[#dfe4e6] hover:bg-white hover:text-[#20262a] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#355ce8] active:translate-y-px"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {editor ? (
        <EditorContent
          className="script-editor script-revision-document min-h-0 flex-1 overflow-y-auto bg-white"
          editor={editor}
        />
      ) : (
        <div className="min-h-0 flex-1 animate-pulse bg-[#fbfcfa]" />
      )}
    </div>
  );
}

function revisionReviewExtension({
  changes,
  original,
  scope,
  selectionFrom,
  selectionTo,
}: {
  changes: Array<Extract<ReviewSegment, { kind: "change" }>>;
  original: string;
  scope: "selection" | "document";
  selectionFrom: number;
  selectionTo: number;
}) {
  return Extension.create({
    name: "scriptRevisionReview",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: revisionReviewPluginKey,
          state: {
            init: () => ({}),
            apply(transaction, currentDecisions) {
              const update = transaction.getMeta(revisionReviewPluginKey) as
                { decisions?: Record<number, FinalDecision> } | undefined;
              return update?.decisions ?? currentDecisions;
            },
          },
          props: {
            decorations(state) {
              const documentEnd = state.doc.content.size;
              const from =
                scope === "selection"
                  ? Math.max(0, Math.min(selectionFrom, documentEnd))
                  : 0;
              const to =
                scope === "selection"
                  ? Math.max(from, Math.min(selectionTo, documentEnd))
                  : documentEnd;
              const sourceText = state.doc.textBetween(from, to, "\n\n");
              const reviewSource =
                sourceText === original ? original : sourceText;
              const decorations: Decoration[] = [];

              for (const change of changes) {
                const originalFrom = Math.min(
                  change.originalFrom,
                  reviewSource.length,
                );
                const originalTo = Math.min(
                  change.originalTo,
                  reviewSource.length,
                );
                const start = documentPositionForTextOffset(
                  state.doc,
                  from,
                  to,
                  originalFrom,
                );
                const end = documentPositionForTextOffset(
                  state.doc,
                  from,
                  to,
                  originalTo,
                );
                const decision =
                  revisionReviewPluginKey.getState(state)?.[change.index] ??
                  "pending";

                if (end > start) {
                  decorations.push(
                    Decoration.inline(start, end, {
                      class: `revision-original revision-original-${decision}`,
                      "data-revision-hunk": String(change.index),
                    }),
                  );
                }
                decorations.push(
                  Decoration.widget(
                    end,
                    () =>
                      revisionWidget({
                        change,
                        decision,
                      }),
                    {
                      key: `revision-${change.index}-${decision}`,
                      side: 1,
                      stopEvent: (event) =>
                        event.target instanceof HTMLElement &&
                        Boolean(event.target.closest("button")),
                    },
                  ),
                );
              }

              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
}

function revisionWidget({
  change,
  decision,
}: {
  change: Extract<ReviewSegment, { kind: "change" }>;
  decision: Decision;
}) {
  const widget = document.createElement("span");
  widget.className = `revision-widget revision-widget-${decision}`;
  widget.dataset.revisionHunk = String(change.index);

  if (change.revised && decision !== "rejected") {
    const replacement = document.createElement("span");
    replacement.className = "revision-replacement";
    replacement.textContent = change.revised;
    widget.append(replacement);
  }

  const actions = document.createElement("span");
  actions.className = "revision-actions";
  actions.append(
    revisionAction({
      active: decision === "rejected",
      index: change.index,
      label: "Reject this change",
      type: "reject",
    }),
    revisionAction({
      active: decision === "accepted",
      index: change.index,
      label: "Accept this change",
      type: "accept",
    }),
  );
  widget.append(actions);
  return widget;
}

function revisionAction({
  active,
  index,
  label,
  type,
}: {
  active: boolean;
  index: number;
  label: string;
  type: "accept" | "reject";
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `revision-action revision-action-${type}${active ? " is-active" : ""}`;
  button.ariaLabel = label;
  button.ariaPressed = String(active);
  button.innerHTML =
    type === "accept"
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.dispatchEvent(
      new CustomEvent("revision-decision", {
        bubbles: true,
        detail: {
          decision: type === "accept" ? "accepted" : "rejected",
          index,
        },
      }),
    );
  });
  return button;
}

function documentPositionForTextOffset(
  doc: Parameters<typeof DecorationSet.create>[0],
  from: number,
  to: number,
  offset: number,
) {
  if (offset <= 0) return from;
  let low = from;
  let high = to;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const length = doc.textBetween(from, middle, "\n\n").length;
    if (length < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function revisionSegments(original: string, revised: string): ReviewSegment[] {
  const changes = diffLines(original, revised);
  const segments: ReviewSegment[] = [];
  let originalChange = "";
  let revisedChange = "";
  let changeIndex = 0;
  let originalOffset = 0;

  const flushChange = () => {
    if (!originalChange && !revisedChange) return;
    segments.push({
      kind: "change",
      index: changeIndex,
      original: originalChange,
      revised: revisedChange,
      originalFrom: originalOffset,
      originalTo: originalOffset + originalChange.length,
    });
    originalOffset += originalChange.length;
    changeIndex += 1;
    originalChange = "";
    revisedChange = "";
  };

  for (const change of changes) {
    if (change.added) {
      revisedChange += change.value;
    } else if (change.removed) {
      originalChange += change.value;
    } else {
      flushChange();
      segments.push({ kind: "unchanged", value: change.value });
      originalOffset += change.value.length;
    }
  }
  flushChange();
  return segments;
}
