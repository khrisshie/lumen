"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HighlightColor, Note } from "@/lib/store";
import { NOTE_COLORS } from "./PdfView";

type Props = {
  note: Note;
  anchor: { x: number; y: number };
  /** Put the cursor in the note box (when the highlight was made with "Note"). */
  focusNote: boolean;
  onColor: (color: HighlightColor) => void;
  onNote: (text: string) => void;
  onRemove: () => void;
  onClose: () => void;
};

const W = 320;

/** Edit a highlight in place: color, note, or remove it. */
export function NotePopover({ note, anchor, focusNote, onColor, onNote, onRemove, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(note.note);
  const commit = () => draft !== note.note && onNote(draft);
  // Read the latest values from the outside-click and Escape listeners.
  const latest = useRef({ commit, onClose });
  useEffect(() => {
    latest.current = { commit, onClose };
  });

  useEffect(() => {
    const close = () => {
      latest.current.commit();
      latest.current.onClose();
    };
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // Defer, so the click that opened the popover doesn't close it.
    const t = setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const left = Math.min(Math.max(8, anchor.x - W / 2), window.innerWidth - W - 8);
  const below = anchor.y + 220 < window.innerHeight;

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Highlight"
      style={{ left, width: W, ...(below ? { top: anchor.y + 10 } : { bottom: window.innerHeight - anchor.y + 10 }) }}
      className="fixed z-50 rounded-xl border border-line bg-surface p-2 shadow-lg shadow-black/10"
    >
      <div className="flex items-center gap-0.5">
        {(Object.keys(NOTE_COLORS) as HighlightColor[]).map((c) => (
          <button
            key={c}
            aria-label={`Color ${c}`}
            aria-pressed={note.color === c}
            onClick={() => onColor(c)}
            className={`grid size-7 place-items-center rounded-md hover:bg-sunken ${note.color === c ? "bg-sunken" : ""}`}
          >
            <span
              className={`size-3.5 rounded-full ring-1 ${note.color === c ? "ring-2 ring-ink-2" : "ring-black/10"}`}
              style={{ background: NOTE_COLORS[c].replace(/[\d.]+\)$/, "0.9)") }}
            />
          </button>
        ))}
        <button onClick={onRemove} className="ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 hover:bg-sunken hover:text-danger">
          <Trash2 size={14} /> Remove
        </button>
      </div>
      <textarea
        autoFocus={focusNote}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter saves and closes.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            commit();
            onClose();
          }
        }}
        placeholder="Add a note…"
        rows={2}
        className="mt-1.5 max-h-60 w-full resize-none rounded-lg bg-sunken px-2.5 py-2 text-sm outline-none [field-sizing:content] focus:ring-2 focus:ring-accent/30"
      />
    </div>
  );
}
