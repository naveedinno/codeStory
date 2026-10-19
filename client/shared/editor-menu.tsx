import { Check, Code2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { failureMessage, requestJson } from "./api";
import { cn } from "./cn";

export type SourceEditor = "zed" | "vscode";

interface EditorPreferenceResponse {
  ok?: boolean;
  editor: SourceEditor;
  label: string;
}

const EDITOR_DETAIL = "Opens the workspace at the exact source line";

const EDITORS: Array<{ value: SourceEditor; label: string; detail: string }> = [
  { value: "zed", label: "Zed", detail: EDITOR_DETAIL },
  { value: "vscode", label: "VS Code", detail: EDITOR_DETAIL },
];

function EditorGlyph() {
  return (
    <span className="grid h-[18px] w-[18px] place-items-center" aria-hidden="true">
      <Code2 className="h-[18px] w-[18px]" strokeWidth={1.8} />
    </span>
  );
}

export function EditorMenu({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [editor, setEditor] = useState<SourceEditor | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Arrow-open target: set by the toggle key handler, consumed by the open effect.
  const pendingFocus = useRef<number | null>(null);

  const load = useCallback(() => {
    setError("");
    requestJson<EditorPreferenceResponse>("/api/settings/editor", {
      fallback: "Could not load the source editor setting.",
      networkFallback: "Could not reach codeStory settings.",
    })
      .then((data) => setEditor(data.editor))
      .catch((cause: unknown) => setError(failureMessage(cause, "Could not load the source editor setting.")));
  }, []);

  useEffect(load, [load]);

  const close = useCallback((restoreFocus: boolean) => {
    pendingFocus.current = null;
    setOpen((wasOpen) => {
      if (wasOpen && restoreFocus) toggle.current?.focus();
      return false;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (pending !== null) {
      menu.current?.querySelectorAll<HTMLElement>("[data-editor-choice]")?.[pending]?.focus();
      return;
    }
    menu.current?.querySelector<HTMLElement>(editor ? `[data-editor-choice="${editor}"]` : "[data-editor-choice]")?.focus();
  }, [open, editor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  const choose = (next: SourceEditor) => {
    if (busy || next === editor) {
      close(true);
      return;
    }
    setBusy(true);
    setError("");
    setAnnouncement("Saving source editor.");
    requestJson<EditorPreferenceResponse>("/api/settings/editor", {
      method: "PUT",
      body: { editor: next },
      fallback: "Could not save the source editor setting.",
      networkFallback: "Could not reach codeStory settings.",
    })
      .then((data) => {
        setEditor(data.editor);
        setBusy(false);
        setAnnouncement(`Source editor set to ${data.label}.`);
        close(true);
      })
      .catch((cause: unknown) => {
        setBusy(false);
        setAnnouncement("");
        setError(failureMessage(cause, "Could not save the source editor setting."));
      });
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[data-editor-choice]") ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const currentLabel = editor === "zed" ? "Zed" : editor === "vscode" ? "VS Code" : "Editor";
  const accessibleLabel = error ? `Source editor setting unavailable: ${error}` : `Source editor: ${currentLabel}`;

  // Arrow keys on the toggle open the menu at the first/last item, mirroring
  // onMenuKeyDown's wrap direction. Enter/Space fall through to native click.
  const onToggleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const count = menu.current?.querySelectorAll("[data-editor-choice]").length ?? 0;
    if (!count) return;
    pendingFocus.current = event.key === "ArrowDown" ? 0 : count - 1;
    setOpen(true);
  };

  return (
    <div ref={wrap} className={cn("ds-editor-wrap", className)}>
      <button
        ref={toggle}
        type="button"
        className={cn("ds-editor-toggle", compact && "is-compact")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        onClick={() => {
          if (error) load();
          setOpen((value) => !value);
        }}
        onKeyDown={onToggleKeyDown}
      >
        <EditorGlyph />
        <span className="ds-editor-toggle-label">{currentLabel}</span>
      </button>
      <div
        ref={menu}
        className="ds-editor-menu"
        role="menu"
        aria-label="Source editor"
        hidden={!open}
        onKeyDown={onMenuKeyDown}
      >
        <div className="ds-editor-menu-heading">
          <strong>Open source in</strong>
          <span>Used for Command- or Ctrl-click jumps from a diff.</span>
        </div>
        {EDITORS.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="menuitemradio"
            data-editor-choice={choice.value}
            aria-checked={editor === choice.value}
            disabled={busy}
            onClick={() => choose(choice.value)}
          >
            <span className="ds-editor-choice-mark" aria-hidden="true">
              {choice.value === "zed" ? "Z" : "V"}
            </span>
            <span className="ds-editor-choice-copy">
              <strong>{choice.label}</strong>
              <span>{choice.detail}</span>
            </span>
            <Check className="ds-editor-check" strokeWidth={2.2} aria-hidden="true" />
          </button>
        ))}
        {error ? (
          <button type="button" className="ds-editor-retry" onClick={load}>
            {error} Retry
          </button>
        ) : null}
      </div>
      <span className="ds-sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
