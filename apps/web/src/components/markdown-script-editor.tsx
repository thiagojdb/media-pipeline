"use client";

import {
  type FormEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowUp,
  Bold,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  PencilLine,
  Quote,
  Redo2,
  Save,
  Undo2,
  X,
} from "lucide-react";

import { ScriptRevisionReview } from "@/components/script-revision-review";

export type ScriptSelection = {
  from: number;
  to: number;
  text: string;
};

export type MarkdownScriptEditorHandle = {
  applyRevision: (input: {
    baseDraft: string;
    scope: "selection" | "document";
    from: number;
    to: number;
    selectedText: string;
    replacementMarkdown: string;
  }) => string | undefined;
  jumpToHeading: (label: string) => void;
};

export const MarkdownScriptEditor = forwardRef<
  MarkdownScriptEditorHandle,
  {
    asking: boolean;
    editable: boolean;
    dirty: boolean;
    maximumCharacters: number;
    onAskRelay: (
      selection: ScriptSelection | null,
      instruction: string,
    ) => Promise<boolean>;
    onActiveHeadingChange?: (heading: string) => void;
    onChange: (markdown: string) => void;
    onRevisionModelChange: (modelSpec: string) => void;
    onSave: () => void;
    revisionModels: Array<{
      provider: string;
      model: string;
      label: string;
      default: boolean;
    }>;
    revisionModelSpec: string;
    revisionReview?:
      | {
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
        }
      | undefined;
    saving: boolean;
    value: string;
    wordCount: number;
  }
>(function MarkdownScriptEditor(
  {
    asking,
    editable,
    dirty,
    maximumCharacters,
    onAskRelay,
    onActiveHeadingChange,
    onChange,
    onRevisionModelChange,
    onSave,
    revisionModels,
    revisionModelSpec,
    revisionReview,
    saving,
    value,
    wordCount,
  },
  ref,
) {
  const [, renderSelection] = useState(0);
  const [editInstruction, setEditInstruction] = useState("");
  const [editSelection, setEditSelection] = useState<ScriptSelection | null>();
  const editor = useEditor({
    immediatelyRender: false,
    editable: editable && !revisionReview,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          autolink: true,
          defaultProtocol: "https",
          openOnClick: !editable,
        },
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: false },
      }),
    ],
    content: value || "",
    contentType: "markdown",
    editorProps: {
      attributes: {
        "aria-label": "Script text",
        class:
          "tiptap min-h-full px-5 py-6 outline-none sm:px-10 lg:px-[clamp(2.5rem,6vw,6rem)]",
        role: "textbox",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      if (!activeEditor.isFocused) return;
      const markdown = activeEditor.getMarkdown();
      if (markdown.length <= maximumCharacters) onChange(markdown);
    },
    onSelectionUpdate: () => renderSelection((version) => version + 1),
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable && !revisionReview);
  }, [editable, editor, revisionReview]);

  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      applyRevision: (input) => {
        if (!editor || value !== input.baseDraft) return undefined;
        if (input.scope === "document") {
          editor.commands.setContent(input.replacementMarkdown, {
            contentType: "markdown",
            emitUpdate: true,
          });
          editor.commands.focus("start");
          onChange(editor.getMarkdown());
          return editor.getMarkdown();
        }
        const currentText = editor.state.doc.textBetween(
          input.from,
          input.to,
          "\n\n",
        );
        if (currentText !== input.selectedText) return undefined;
        if (isPlainInlineRevision(input.replacementMarkdown)) {
          editor.view.dispatch(
            editor.state.tr.insertText(
              input.replacementMarkdown,
              input.from,
              input.to,
            ),
          );
          editor.commands.focus(input.from + input.replacementMarkdown.length);
        } else {
          editor
            .chain()
            .focus()
            .insertContentAt(
              { from: input.from, to: input.to },
              input.replacementMarkdown,
              { contentType: "markdown", updateSelection: true },
            )
            .run();
        }
        onChange(editor.getMarkdown());
        return editor.getMarkdown();
      },
      jumpToHeading: (label) => {
        if (!editor) return;
        let position: number | undefined;
        editor.state.doc.descendants((node, pos) => {
          if (
            position === undefined &&
            node.isTextblock &&
            node.textContent.trim() === label.trim()
          ) {
            position = pos + 1;
            return false;
          }
          return true;
        });
        if (position === undefined) return;
        const heading = Array.from(
          editor.view.dom.querySelectorAll<HTMLElement>("p, h1, h2, h3"),
        ).find((element) => element.textContent?.trim() === label.trim());
        editor.commands.setTextSelection(position);
        if (!heading) return;
        const scrollContainer = heading.closest<HTMLElement>(".script-editor");
        if (!scrollContainer) return;
        const scrollTop =
          scrollContainer.scrollTop +
          heading.getBoundingClientRect().top -
          scrollContainer.getBoundingClientRect().top -
          24;
        animateScriptScroll(scrollContainer, Math.max(0, scrollTop));
      },
    }),
    [editor, onChange, value],
  );

  if (!editor) {
    return (
      <div
        aria-label="Opening rich text editor"
        className="min-h-[36rem] animate-pulse bg-[#fbfcfa]"
      />
    );
  }

  const selection = currentSelection(editor);
  const startEdit = (target: ScriptSelection | null) => {
    setEditInstruction("");
    setEditSelection(target);
  };
  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editInstruction.trim() || asking) return;
    const completed = await onAskRelay(
      editSelection ?? null,
      editInstruction.trim(),
    );
    if (!completed) return;
    setEditInstruction("");
    setEditSelection(undefined);
  };
  const editLink = () => {
    const existing = String(editor.getAttributes("link").href ?? "");
    const url = window.prompt("Link URL", existing || "https://");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        aria-label="Script formatting"
        className="flex min-h-10 flex-wrap items-center gap-0.5 border-b border-[#e5e8e6] bg-[#fbfcfa] px-3 py-1 sm:px-5"
        role="toolbar"
      >
        <ToolbarButton
          active={editor.isActive("bold")}
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-[#dfe4e6]" />
        <ToolbarButton
          active={editor.isActive("heading", { level: 1 })}
          label="Heading 1"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          <Heading1 />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          label="Heading 2"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("bulletList")}
          label="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          label="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("blockquote")}
          label="Block quote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("link")}
          label="Link"
          onClick={editLink}
        >
          <Link2 />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-[#dfe4e6]" />
        <ToolbarButton
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 />
        </ToolbarButton>
        {revisionModels.length ? (
          <>
            <span className="mx-1 h-5 w-px bg-[#dfe4e6]" />
            <label className="sr-only" htmlFor="script-revision-model">
              Relay model
            </label>
            <select
              className="h-8 max-w-40 rounded-lg border border-[#d8dddf] bg-white px-2.5 text-[11px] font-medium text-[#4e5960] shadow-[0_1px_2px_rgba(24,34,39,0.06)] transition-[border-color,box-shadow] outline-none focus:border-[#8ca2ff] focus:ring-2 focus:ring-[#355ce8]/12 sm:max-w-52"
              id="script-revision-model"
              onChange={(event) => onRevisionModelChange(event.target.value)}
              title="Relay editing provider and model"
              value={revisionModelSpec}
            >
              {revisionModels.map((model) => (
                <option
                  key={`${model.provider}/${model.model}`}
                  value={`${model.provider}/${model.model}`}
                >
                  {model.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <p className="ml-auto hidden truncate font-mono text-[9px] text-[#7b858c] uppercase min-[1400px]:block">
          <span>{wordCount.toLocaleString()} words</span>
          <span aria-hidden="true"> · </span>
          <span>~{Math.max(1, Math.ceil(wordCount / 145))} min</span>
          <span aria-hidden="true"> · </span>
          <span>
            {value.length.toLocaleString()} /{" "}
            {maximumCharacters.toLocaleString()} chars
          </span>
        </p>
        {dirty ? (
          <span className="hidden items-center gap-1.5 font-mono text-[9px] font-medium text-[#b53d2b] uppercase sm:inline-flex">
            <span className="size-1.5 rounded-full bg-[#f45d48]" />
            Unsaved changes
          </span>
        ) : null}
        <button
          aria-label="Save"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#2d53d3] bg-[#355ce8] px-3 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(35,73,196,0.3),inset_0_1px_rgba(255,255,255,0.18)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-[#2749bc] hover:bg-[#2f55d6] hover:shadow-[0_3px_8px_rgba(35,73,196,0.24),inset_0_1px_rgba(255,255,255,0.18)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#355ce8] active:translate-y-px active:shadow-[0_1px_2px_rgba(35,73,196,0.2)] disabled:pointer-events-none disabled:border-[#aebcf2] disabled:bg-[#aebcf2] disabled:shadow-none"
          disabled={saving || !value.trim() || !dirty}
          onClick={onSave}
          type="button"
        >
          {saving ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          <span className="hidden sm:inline">Save</span>
        </button>
        {editSelection === null ? (
          <form
            className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:flex-initial"
            onSubmit={submitEdit}
          >
            <label className="sr-only" htmlFor="script-edit-instruction">
              Describe the edit
            </label>
            <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-[#aebdf8] bg-white pl-3 shadow-[0_1px_2px_rgba(24,34,39,0.08)] transition-[border-color,box-shadow] focus-within:border-[#7893f3] focus-within:ring-2 focus-within:ring-[#355ce8]/12 sm:w-72">
              <PencilLine className="mr-2 size-3.5 shrink-0 text-[#355ce8]" />
              <input
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-xs text-[#20262a] outline-none placeholder:text-[#9aa2a6]"
                id="script-edit-instruction"
                maxLength={4_000}
                disabled={asking}
                onChange={(event) => setEditInstruction(event.target.value)}
                placeholder="Describe changes"
                value={editInstruction}
              />
              <button
                aria-label="Submit edit"
                className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md bg-[#355ce8] text-white shadow-[0_1px_2px_rgba(35,73,196,0.28)] transition-[background-color,transform] hover:bg-[#294cc8] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#355ce8] active:translate-y-px disabled:pointer-events-none disabled:bg-[#c7d0ed] disabled:shadow-none"
                disabled={!editInstruction.trim() || asking}
                type="submit"
              >
                {asking ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-3.5" />
                )}
              </button>
            </div>
            <button
              aria-label="Cancel edit"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#68747d] transition-colors hover:border-[#dfe4e6] hover:bg-white hover:text-[#20262a] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#355ce8]"
              onClick={() => setEditSelection(undefined)}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </form>
        ) : (
          <button
            aria-label="Ask for changes"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d8dddf] bg-white px-3 text-xs font-semibold text-[#343c41] shadow-[0_1px_2px_rgba(24,34,39,0.08)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-[#b8c1c5] hover:bg-[#f7f8f6] hover:shadow-[0_2px_5px_rgba(24,34,39,0.1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#355ce8] active:translate-y-px active:bg-[#eef1ef] disabled:pointer-events-none disabled:opacity-45"
            disabled={asking}
            onClick={() => startEdit(null)}
            type="button"
          >
            <PencilLine className="size-3.5" />
            Ask for changes
          </button>
        )}
      </div>

      {editable && !revisionReview ? (
        <BubbleMenu
          className="flex items-center gap-0.5 rounded-xl border border-[#dfe4e6] bg-white p-1.5 shadow-[0_12px_34px_rgba(24,34,39,0.18)]"
          editor={editor}
          shouldShow={({ editor: activeEditor }) =>
            !activeEditor.state.selection.empty
          }
        >
          {editSelection ? (
            <form
              className="flex h-9 w-[min(22rem,calc(100vw-2rem))] items-center pl-2"
              onSubmit={submitEdit}
            >
              <label className="sr-only" htmlFor="selection-edit-instruction">
                Describe changes
              </label>
              <input
                autoFocus
                className="min-w-0 flex-1 bg-transparent px-1 text-sm text-[#20262a] outline-none placeholder:text-[#8d969b]"
                id="selection-edit-instruction"
                maxLength={4_000}
                disabled={asking}
                onChange={(event) => setEditInstruction(event.target.value)}
                placeholder="Describe changes"
                value={editInstruction}
              />
              <button
                aria-label="Submit changes"
                className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[#2d53d3] bg-[#355ce8] text-white shadow-[0_1px_2px_rgba(35,73,196,0.28)] transition-[background-color,transform] hover:bg-[#294cc8] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#355ce8] active:translate-y-px disabled:pointer-events-none disabled:border-[#c7ccd0] disabled:bg-[#c7ccd0] disabled:shadow-none"
                disabled={!editInstruction.trim() || asking}
                type="submit"
              >
                {asking ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-3.5" />
                )}
              </button>
              <button
                aria-label="Cancel changes"
                className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#68747d] transition-colors hover:border-[#dfe4e6] hover:bg-[#f7f8f5] hover:text-[#20262a] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#355ce8]"
                onClick={() => setEditSelection(undefined)}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </form>
          ) : (
            <>
              <button
                aria-label="Ask for changes to selection"
                className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#171b1f] bg-[#171b1f] px-3 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(24,34,39,0.22)] transition-[background-color,box-shadow,transform] hover:bg-[#2b3237] hover:shadow-[0_3px_8px_rgba(24,34,39,0.18)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#355ce8] active:translate-y-px disabled:pointer-events-none disabled:opacity-45"
                disabled={asking}
                onClick={() => startEdit(selection)}
                type="button"
              >
                <PencilLine className="size-3.5" />
                Ask for changes
              </button>
              <ToolbarButton
                active={editor.isActive("bold")}
                label="Bold selection"
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <Bold />
              </ToolbarButton>
              <ToolbarButton
                active={editor.isActive("italic")}
                label="Italic selection"
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <Italic />
              </ToolbarButton>
              <ToolbarButton label="Link selection" onClick={editLink}>
                <Link2 />
              </ToolbarButton>
            </>
          )}
        </BubbleMenu>
      ) : null}

      <EditorContent
        className={
          revisionReview
            ? "hidden"
            : "script-editor flex-1 overflow-y-auto bg-white"
        }
        editor={editor}
        onScroll={(event) => {
          const element = event.currentTarget;
          const activationLine = element.getBoundingClientRect().top + 32;
          const headings = Array.from(
            editor.view.dom.querySelectorAll<HTMLElement>("p, h1, h2, h3"),
          ).filter((candidate) =>
            /^(COLD OPEN|INTRO(?:DUCTION)?|ACT\b|PART\b|CHAPTER\b|SECTION\b|CONCLUSION|OUTRO|EPILOGUE)/i.test(
              candidate.textContent?.trim() ?? "",
            ),
          );
          const activeHeading =
            headings.findLast(
              (candidate) =>
                candidate.getBoundingClientRect().top <= activationLine,
            ) ?? headings[0];
          if (activeHeading?.textContent) {
            onActiveHeadingChange?.(activeHeading.textContent.trim());
          }
        }}
      />
      {revisionReview ? (
        <ScriptRevisionReview documentMarkdown={value} {...revisionReview} />
      ) : null}
    </div>
  );
});

function currentSelection(editor: NonNullable<ReturnType<typeof useEditor>>) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  return {
    from,
    to,
    text: editor.state.doc.textBetween(from, to, "\n\n"),
  };
}

function isPlainInlineRevision(markdown: string) {
  return (
    !markdown.includes("\n") &&
    !/(^#{1,6}\s|^>\s|^[-+*]\s|^\d+\.\s|[*_`[\]~])/.test(markdown)
  );
}

const scriptScrollAnimations = new WeakMap<HTMLElement, number>();
const scriptScrollDurationMs = 450;

function animateScriptScroll(element: HTMLElement, target: number) {
  const previousAnimation = scriptScrollAnimations.get(element);
  if (previousAnimation !== undefined) {
    window.cancelAnimationFrame(previousAnimation);
  }

  const start = element.scrollTop;
  const distance = target - start;
  if (
    Math.abs(distance) < 1 ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    element.scrollTop = target;
    scriptScrollAnimations.delete(element);
    return;
  }

  let startedAt: number | undefined;
  const step = (now: number) => {
    startedAt ??= now;
    const progress = Math.min(1, (now - startedAt) / scriptScrollDurationMs);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    element.scrollTop = start + distance * easedProgress;

    if (progress < 1) {
      scriptScrollAnimations.set(element, window.requestAnimationFrame(step));
      return;
    }
    element.scrollTop = target;
    scriptScrollAnimations.delete(element);
  };

  scriptScrollAnimations.set(element, window.requestAnimationFrame(step));
}

function ToolbarButton({
  active = false,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex size-8 items-center justify-center rounded-lg border transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#355ce8] active:translate-y-px [&_svg]:size-3.5 ${
        active
          ? "border-[#c9d4ff] bg-[#e9eeff] text-[#294cc8] shadow-[inset_0_0_0_1px_rgba(53,92,232,0.04)]"
          : "border-transparent text-[#68747d] hover:border-[#dfe4e6] hover:bg-white hover:text-[#171b1f] hover:shadow-[0_1px_2px_rgba(24,34,39,0.08)]"
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
