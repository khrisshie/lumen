"use client";

import { Copy, Languages, MessageSquarePlus, Sparkles, StickyNote } from "lucide-react";
import type { HighlightColor } from "@/lib/store";
import { NOTE_COLORS, type Selection } from "./PdfView";

type Props = {
  selection: Selection;
  onExplain: () => void;
  onTranslate: () => void;
  onAsk: () => void;
  onHighlight: (color: HighlightColor) => void;
  /** Highlight the selection and write a note on it. */
  onNote: () => void;
};

const MENU_W = 430;

export function SelectionMenu({ selection, onExplain, onTranslate, onAsk, onHighlight, onNote }: Props) {
  const { x, y, bottom } = selection.anchor;
  const above = y > 70;
  const left = Math.min(Math.max(8, x - MENU_W / 2), window.innerWidth - MENU_W - 8);

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      onMouseDown={(e) => e.preventDefault()}
      style={{ left, top: above ? y - 52 : bottom + 10, width: MENU_W }}
      className="fixed z-50 flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-lg shadow-black/10"
    >
      <MenuButton onClick={onExplain} primary>
        <Sparkles size={15} /> Explain
      </MenuButton>
      <MenuButton onClick={onTranslate}>
        <Languages size={15} /> Translate
      </MenuButton>
      <MenuButton onClick={onAsk}>
        <MessageSquarePlus size={15} /> Ask
      </MenuButton>
      <MenuButton onClick={onNote}>
        <StickyNote size={15} /> Note
      </MenuButton>
      <span className="mx-1 h-5 w-px bg-line" />
      {(Object.keys(NOTE_COLORS) as HighlightColor[]).map((c) => (
        <button
          key={c}
          aria-label={`Highlight ${c}`}
          onClick={() => onHighlight(c)}
          className="grid size-7 place-items-center rounded-md hover:bg-sunken"
        >
          <span className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: NOTE_COLORS[c].replace(/[\d.]+\)$/, "0.9)") }} />
        </button>
      ))}
      <button
        aria-label="Copy"
        onClick={() => navigator.clipboard.writeText(selection.text)}
        className="grid size-7 place-items-center rounded-md text-ink-2 hover:bg-sunken"
      >
        <Copy size={14} />
      </button>
    </div>
  );
}

function MenuButton({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium ${
        primary ? "bg-accent text-white hover:bg-accent-ink" : "text-ink hover:bg-sunken"
      }`}
    >
      {children}
    </button>
  );
}
