"use client";

import {
  ArrowUp,
  Copy,
  Crop,
  Download,
  Highlighter,
  Languages,
  MessageSquarePlus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import type { Note, Paper } from "@/lib/store";
import type { AssistMode, ChatTurn, HighlightKind } from "@/lib/types";
import { KIND_COLORS, NOTE_COLORS } from "./PdfView";

export type AssistCard = {
  id: string;
  mode: AssistMode;
  page: number;
  selection?: string;
  image?: string;
  text: string;
  status: "streaming" | "done" | "error";
  notice?: string;
};

export type Tab = "assist" | "summary" | "chat" | "notes";

const MODE_LABEL: Record<AssistMode, string> = {
  explain: "Explanation",
  translate: "Translation",
  figure: "Figure explanation",
  "page-translate": "Page translation",
};

const MODE_ICON: Record<AssistMode, typeof Sparkles> = {
  explain: Sparkles,
  translate: Languages,
  figure: Crop,
  "page-translate": Languages,
};

export function Tabs({ tab, onTab, counts }: { tab: Tab; onTab: (t: Tab) => void; counts: Partial<Record<Tab, number>> }) {
  const tabs: [Tab, string][] = [
    ["assist", "Assist"],
    ["summary", "Summary"],
    ["chat", "Chat"],
    ["notes", "Notes"],
  ];
  return (
    <div role="tablist" className="flex gap-1 border-b border-line px-3">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm font-medium transition ${
            tab === id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
          }`}
        >
          {label}
          {!!counts[id] && <span className="rounded-full bg-sunken px-1.5 text-[11px] text-ink-2">{counts[id]}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- Assist --------------------------------- */

export function AssistTab({
  cards,
  page,
  onClose,
  onFollowUp,
  onTranslatePage,
  onCapture,
}: {
  cards: AssistCard[];
  page: number;
  onClose: (id: string) => void;
  onFollowUp: (card: AssistCard) => void;
  onTranslatePage: () => void;
  onCapture: () => void;
}) {
  if (cards.length === 0) {
    return (
      <div className="space-y-5 p-5 text-sm text-ink-2">
        <p className="font-serif text-lg text-ink">Ask about anything on the page.</p>
        <ul className="space-y-3">
          <li className="flex gap-3">
            <Sparkles size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>
              <b className="font-medium text-ink">Select text</b> to explain or translate it. Lumen reads the whole paper, so
              symbols and citations are explained in context.
            </span>
          </li>
          <li className="flex gap-3">
            <Crop size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>
              <b className="font-medium text-ink">Capture a figure</b> or table by dragging a box over it.
            </span>
          </li>
          <li className="flex gap-3">
            <Languages size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>
              <b className="font-medium text-ink">Translate a whole page</b> into your language.
            </span>
          </li>
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={onCapture} className="btn-secondary">
            <Crop size={15} /> Capture figure
          </button>
          <button onClick={onTranslatePage} className="btn-secondary">
            <Languages size={15} /> Translate page {page}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {cards.map((card) => {
        const Icon = MODE_ICON[card.mode];
        return (
          <article key={card.id} className="rounded-xl border border-line bg-surface">
            <header className="flex items-center gap-2 px-4 pt-3 text-xs font-medium text-ink-3">
              <Icon size={14} className="text-accent" />
              {MODE_LABEL[card.mode]}
              <span className="rounded bg-sunken px-1.5 py-0.5">p. {card.page}</span>
              <button aria-label="Dismiss" onClick={() => onClose(card.id)} className="ml-auto rounded p-1 hover:bg-sunken">
                <X size={14} />
              </button>
            </header>
            {card.selection && (
              <blockquote className="mx-4 mt-2 line-clamp-3 border-l-2 border-accent/40 pl-3 font-serif text-sm text-ink-2 italic">
                {card.selection}
              </blockquote>
            )}
            {card.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.image} alt="Captured region" className="mx-4 mt-2 max-h-40 rounded border border-line object-contain" />
            )}
            <div className="px-4 py-3">
              {card.status === "error" ? (
                <p className="text-sm text-danger">{card.text}</p>
              ) : (
                <Markdown text={card.text} streaming={card.status === "streaming"} />
              )}
              {card.notice && <p className="mt-2 text-xs text-ink-3">{card.notice}</p>}
            </div>
            {card.status === "done" && (
              <footer className="flex gap-1 border-t border-line px-2 py-1.5">
                <button onClick={() => onFollowUp(card)} className="btn-ghost">
                  <MessageSquarePlus size={14} /> Follow up in chat
                </button>
                <button onClick={() => navigator.clipboard.writeText(card.text)} className="btn-ghost">
                  <Copy size={14} /> Copy
                </button>
              </footer>
            )}
          </article>
        );
      })}
    </div>
  );
}

/* --------------------------------- Summary --------------------------------- */

export function SummaryTab({
  paper,
  lang,
  state,
  onGenerate,
  onAsk,
}: {
  paper: Paper;
  lang: string;
  state: { loading: boolean; error?: string };
  onGenerate: () => void;
  onAsk: (question: string) => void;
}) {
  const s = paper.summary;
  if (state.loading) {
    return (
      <div className="space-y-3 p-5">
        <p className="text-sm text-ink-3">Reading the paper and writing a summary…</p>
        {[80, 95, 60, 90, 70].map((w, i) => (
          <div key={i} className="shimmer h-4 rounded" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!s) {
    return (
      <div className="p-5">
        <p className="font-serif text-lg">Get the shape of the paper first.</p>
        <p className="mt-1 text-sm text-ink-2">The problem, contributions, method, results, limitations, and questions worth discussing.</p>
        <button onClick={onGenerate} className="btn-primary mt-4">
          <Sparkles size={15} /> Summarize paper
        </button>
        {state.error && <p className="mt-3 text-sm text-danger">{state.error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5">
      <div>
        <h2 className="font-serif text-xl leading-snug font-semibold">{s.title}</h2>
        {s.authors.length > 0 && <p className="mt-1 text-sm text-ink-3">{s.authors.join(", ")}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.keywords.map((k) => (
            <span key={k} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent-ink">
              {k}
            </span>
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-accent-soft/60 p-4">
        <p className="mb-1 text-xs font-semibold tracking-wide text-accent-ink uppercase">TL;DR</p>
        <Markdown text={s.tldr} />
      </div>
      <Section title="Problem">
        <Markdown text={s.problem} />
      </Section>
      <Section title="Contributions">
        <Markdown text={s.contributions.map((c) => `- ${c}`).join("\n")} />
      </Section>
      <Section title="Method">
        <Markdown text={s.method} />
      </Section>
      <Section title="Results">
        <Markdown text={s.results.map((c) => `- ${c}`).join("\n")} />
      </Section>
      <Section title="Limitations">
        <Markdown text={s.limitations.map((c) => `- ${c}`).join("\n")} />
      </Section>
      <Section title="Discuss">
        <div className="space-y-2">
          {s.discussion_questions.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              className="block w-full rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-accent/50 hover:bg-accent-soft/40"
            >
              {q}
            </button>
          ))}
        </div>
      </Section>
      <button onClick={onGenerate} className="btn-ghost text-ink-3">
        <RotateCcw size={14} /> Regenerate{paper.summaryLang !== lang ? ` in ${lang.split(" (")[0]}` : ""}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}

/* ----------------------------------- Chat ---------------------------------- */

const STARTERS = [
  "What problem does this paper solve, and why is it hard?",
  "Walk me through the method step by step.",
  "What are the weakest points of this paper?",
  "How does this differ from the prior work it cites?",
];

export function ChatTab({
  chat,
  streaming,
  quote,
  notice,
  onClearQuote,
  onSend,
  onStop,
  onClear,
}: {
  chat: ChatTurn[];
  streaming: boolean;
  quote: string | null;
  notice?: string;
  onClearQuote: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [chat]);

  useEffect(() => {
    if (quote) box.current?.focus();
  }, [quote]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {chat.length === 0 && (
          <div className="space-y-2">
            <p className="font-serif text-lg">Discuss the paper.</p>
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm hover:border-accent/50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {chat.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="ml-8 rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap text-white">
              {turn.content}
            </div>
          ) : (
            <div key={i} className="mr-2">
              <Markdown text={turn.content} streaming={streaming && i === chat.length - 1} />
            </div>
          ),
        )}
        {notice && <p className="text-xs text-ink-3">{notice}</p>}
        <div ref={end} />
      </div>

      <div className="border-t border-line p-3">
        {quote && (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-xs text-ink-2">
            <span className="line-clamp-2 flex-1 font-serif italic">“{quote}”</span>
            <button aria-label="Remove quote" onClick={onClearQuote} className="rounded p-0.5 hover:bg-line">
              <X size={13} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface p-1.5 focus-within:border-accent/60">
          <textarea
            ref={box}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={quote ? "Ask about this passage…" : "Ask anything about the paper…"}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none [field-sizing:content]"
          />
          {streaming ? (
            <button aria-label="Stop" onClick={onStop} className="grid size-8 place-items-center rounded-lg bg-ink text-white">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              aria-label="Send"
              onClick={submit}
              disabled={!draft.trim()}
              className="grid size-8 place-items-center rounded-lg bg-accent text-white disabled:opacity-40"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {chat.length > 0 && !streaming && (
          <button onClick={onClear} className="btn-ghost mt-1 text-ink-3">
            <Trash2 size={13} /> Clear chat
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Notes ---------------------------------- */

const KIND_LABEL: Record<HighlightKind, string> = {
  claim: "Claim",
  method: "Method",
  result: "Result",
  limitation: "Limitation",
};

export function NotesTab({
  paper,
  showAuto,
  autoState,
  onToggleAuto,
  onGenerateAuto,
  onJump,
  onUpdateNote,
  onDeleteNote,
  onExport,
}: {
  paper: Paper;
  showAuto: boolean;
  autoState: { loading: boolean; error?: string; missed?: number };
  onToggleAuto: () => void;
  onGenerateAuto: () => void;
  onJump: (id: string, page: number, y: number) => void;
  onUpdateNote: (id: string, note: string) => void;
  onDeleteNote: (id: string) => void;
  onExport: () => void;
}) {
  const auto = paper.autoHighlights;
  const notes = [...paper.notes].sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y);

  return (
    <div className="space-y-6 p-4">
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center gap-2">
          <Highlighter size={16} className="text-accent" />
          <h3 className="font-medium">Auto highlight</h3>
          {auto && (
            <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
              Show
              <input type="checkbox" checked={showAuto} onChange={onToggleAuto} className="accent-[var(--accent)]" />
            </label>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-2">
          {(Object.keys(KIND_COLORS) as HighlightKind[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded" style={{ background: KIND_COLORS[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
        {!auto && (
          <>
            <p className="mt-3 text-sm text-ink-2">Underline the sentences that carry the paper: claims, method choices, results and limitations.</p>
            <button onClick={onGenerateAuto} disabled={autoState.loading} className="btn-primary mt-3">
              <Sparkles size={15} /> {autoState.loading ? "Finding key sentences…" : "Highlight key points"}
            </button>
          </>
        )}
        {autoState.error && <p className="mt-2 text-sm text-danger">{autoState.error}</p>}
        {auto && (
          <ul className="mt-3 space-y-1">
            {auto.map((h, i) => (
              <li key={i}>
                <button
                  onClick={() => h.rects[0] && onJump(`auto-${i}`, h.page, h.rects[0].y)}
                  disabled={!h.rects[0]}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-sunken disabled:opacity-60"
                >
                  <span className="flex items-center gap-2 text-[11px] font-medium text-ink-3">
                    <span className="h-[3px] w-3 rounded" style={{ background: KIND_COLORS[h.kind] }} />
                    {KIND_LABEL[h.kind]} · p. {h.page}
                    {!h.rects[0] && " · not located"}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block font-serif text-sm">{h.quote}</span>
                  <span className="mt-0.5 block text-xs text-ink-2">{h.why}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center">
          <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Your highlights</h3>
          {(notes.length > 0 || auto) && (
            <button onClick={onExport} className="btn-ghost ml-auto">
              <Download size={14} /> Export Markdown
            </button>
          )}
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-ink-2">Select text in the paper and pick a color to highlight it, or click <b className="font-medium text-ink">Note</b> to write a note on it. Click a highlight to edit or remove it; ⌘Z undoes.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <NoteItem key={`${n.id}:${n.note}`} note={n} onJump={onJump} onUpdate={onUpdateNote} onDelete={onDeleteNote} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NoteItem({
  note,
  onJump,
  onUpdate,
  onDelete,
}: {
  note: Note;
  onJump: (id: string, page: number, y: number) => void;
  onUpdate: (id: string, note: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState(note.note);
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <button onClick={() => onJump(note.id, note.page, note.rects[0].y)} className="block w-full text-left">
        <span className="text-[11px] font-medium text-ink-3">p. {note.page}</span>
        <span
          className="mt-1 line-clamp-4 block rounded px-1 font-serif text-sm"
          style={{ background: NOTE_COLORS[note.color] }}
        >
          {note.text}
        </span>
      </button>
      <div className="mt-2 flex items-start gap-1">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== note.note && onUpdate(note.id, draft)}
          placeholder="Add a note…"
          rows={1}
          className="flex-1 resize-none rounded-md bg-transparent px-1 py-1 text-sm outline-none [field-sizing:content] focus:bg-sunken"
        />
        <button aria-label="Delete highlight" onClick={() => onDelete(note.id)} className="rounded p-1.5 text-ink-3 hover:bg-sunken hover:text-danger">
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
