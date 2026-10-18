"use client";

import { ArrowLeft, Crop, Languages, Minus, PanelRight, Plus } from "lucide-react";
import Link from "next/link";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask, fetchHighlights, fetchSummary } from "@/lib/api";
import { captureRegion } from "@/lib/capture";
import { LANGUAGES, setLanguage, useLanguage } from "@/lib/lang";
import { locateQuote } from "@/lib/locate";
import { getPaper, getPdf, savePaper, type HighlightColor, type Note, type Paper, type Rect } from "@/lib/store";
import type { AssistMode, ChatTurn } from "@/lib/types";
import { NotePopover } from "./NotePopover";
import { AssistTab, ChatTab, NotesTab, SummaryTab, Tabs, type AssistCard, type Tab } from "./Panel";
import { PdfView, type AutoMark, type PdfViewHandle, type Selection } from "./PdfView";
import { SelectionMenu } from "./SelectionMenu";

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

const PANEL_KEY = "lumen.panelWidth";
const PANEL_DEFAULT = 420;
const PANEL_MIN = 320;
/** Keep at least this much room for the PDF. */
const PDF_MIN = 360;

const clampPanel = (w: number) =>
  Math.round(Math.max(PANEL_MIN, Math.min(w, (typeof window === "undefined" ? 1600 : window.innerWidth) - PDF_MIN)));

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function Reader({ id }: { id: string }) {
  const lang = useLanguage();
  const [paper, setPaper] = useState<Paper | null | undefined>(undefined);
  const [file, setFile] = useState<Blob | null>(null);
  const paperRef = useRef<Paper | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const view = useRef<PdfViewHandle>(null);

  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [tab, setTab] = useState<Tab>("assist");
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_KEY));
      return saved ? clampPanel(saved) : PANEL_DEFAULT;
    } catch {
      return PANEL_DEFAULT;
    }
  });
  const resizePanel = useCallback((w: number) => {
    const next = clampPanel(w);
    setPanelWidth(next);
    try {
      localStorage.setItem(PANEL_KEY, String(next));
    } catch {
      // Storage blocked; the width just won't persist.
    }
  }, []);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [captureMode, setCaptureMode] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<{ id: string; anchor: { x: number; y: number }; focusNote: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Undo/redo history of the user's highlights and notes.
  const history = useRef<{ past: Note[][]; future: Note[][] }>({ past: [], future: [] });

  const [cards, setCards] = useState<AssistCard[]>([]);
  const cardAborts = useRef(new Map<string, AbortController>());

  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatQuote, setChatQuote] = useState<string | null>(null);
  const [chatNotice, setChatNotice] = useState<string>();
  const chatAbort = useRef<AbortController | null>(null);
  const [chatStreaming, setChatStreaming] = useState(false);

  const [summaryState, setSummaryState] = useState<{ loading: boolean; error?: string }>({ loading: false });
  const [autoState, setAutoState] = useState<{ loading: boolean; error?: string }>({ loading: false });
  const [showAuto, setShowAuto] = useState(true);

  /** Apply a change to the paper and persist it. */
  const update = useCallback((fn: (p: Paper) => Paper) => {
    if (!paperRef.current) return;
    const next = fn(paperRef.current);
    paperRef.current = next;
    setPaper(next);
    void savePaper(next);
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 2500);
  }, []);

  /** Change the user's highlights, recording the previous state for undo. */
  const changeNotes = useCallback(
    (fn: (notes: Note[]) => Note[]) => {
      const before = paperRef.current?.notes;
      if (!before) return;
      history.current.past.push(before);
      if (history.current.past.length > 100) history.current.past.shift();
      history.current.future = [];
      update((p) => ({ ...p, notes: fn(p.notes) }));
    },
    [update],
  );

  const stepHistory = useCallback(
    (direction: "undo" | "redo") => {
      const current = paperRef.current?.notes;
      const { past, future } = history.current;
      const target = direction === "undo" ? past.pop() : future.pop();
      if (!current || !target) return;
      (direction === "undo" ? future : past).push(current);
      setOpenNote(null);
      update((p) => ({ ...p, notes: target }));
      showToast(direction === "undo" ? "Undone" : "Redone");
    },
    [update, showToast],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, blob] = await Promise.all([getPaper(id), getPdf(id)]);
      if (cancelled) return;
      if (!p || !blob) return setPaper(null);
      const opened = { ...p, openedAt: Date.now() };
      paperRef.current = opened;
      setPaper(opened);
      setChat(opened.chat);
      setFile(blob);
      void savePaper(opened);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Remember the reading position.
  useEffect(() => {
    if (!paperRef.current || paperRef.current.lastPage === page) return;
    const t = setTimeout(() => update((p) => ({ ...p, lastPage: page })), 800);
    return () => clearTimeout(t);
  }, [page, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCaptureMode(false);
        setSelection(null);
      }
      // ⌘Z / ⇧⌘Z (Ctrl on Windows) undo and redo highlight changes, except while typing.
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, select, [contenteditable]");
      if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        stepHistory(e.shiftKey ? "redo" : "undo");
      }
      if (!typing && e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        stepHistory("redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepHistory]);

  const onLoad = useCallback(
    (pdf: PDFDocumentProxy) => {
      pdfRef.current = pdf;
      setNumPages(pdf.numPages);
      const last = paperRef.current?.lastPage;
      if (paperRef.current?.numPages !== pdf.numPages) update((p) => ({ ...p, numPages: pdf.numPages }));
      if (last && last > 1) setTimeout(() => view.current?.goTo(last), 60);
    },
    [update],
  );

  const flash = (flashTarget: string) => {
    setFlashId(flashTarget);
    setTimeout(() => setFlashId((cur) => (cur === flashTarget ? null : cur)), 1800);
  };

  /* ------------------------------ Assist cards ----------------------------- */

  const runAssist = useCallback(
    (mode: AssistMode, onPage: number, extra: { selection?: string; image?: string } = {}) => {
      const p = paperRef.current;
      if (!p) return;
      const card: AssistCard = { id: crypto.randomUUID(), mode, page: onPage, ...extra, text: "", status: "streaming" };
      const patch = (fn: (c: AssistCard) => AssistCard) => setCards((cs) => cs.map((c) => (c.id === card.id ? fn(c) : c)));
      const controller = new AbortController();
      cardAborts.current.set(card.id, controller);
      setCards((cs) => [card, ...cs]);
      setTab("assist");
      setPanelOpen(true);

      ask(
        p,
        { kind: "assist", mode, page: onPage, lang, ...extra },
        {
          signal: controller.signal,
          onText: (t) => patch((c) => ({ ...c, text: c.text + t })),
          onNotice: (n) => patch((c) => ({ ...c, notice: n })),
        },
      )
        .then(() => patch((c) => ({ ...c, status: "done" })))
        .catch((e) => !isAbort(e) && patch((c) => ({ ...c, status: "error", text: errorText(e) })))
        .finally(() => cardAborts.current.delete(card.id));
    },
    [lang],
  );

  const closeCard = (cardId: string) => {
    cardAborts.current.get(cardId)?.abort();
    setCards((cs) => cs.filter((c) => c.id !== cardId));
  };

  const onCapture = useCallback(
    async (onPage: number, region: Omit<Rect, "page">) => {
      setCaptureMode(false);
      if (!pdfRef.current) return;
      const image = await captureRegion(pdfRef.current, onPage, region);
      runAssist("figure", onPage, { image });
    },
    [runAssist],
  );

  /* ---------------------------------- Chat --------------------------------- */

  const sendChat = useCallback(
    async (text: string) => {
      const p = paperRef.current;
      if (!p || chatAbort.current) return;
      const content = chatQuote ? `Regarding this passage from the paper:\n"${chatQuote}"\n\n${text}` : text;
      setChatQuote(null);
      setChatNotice(undefined);
      const history: ChatTurn[] = [...chat, { role: "user", content }];
      let answer = "";
      setChat([...history, { role: "assistant", content: "" }]);
      setTab("chat");
      setPanelOpen(true);

      const controller = new AbortController();
      chatAbort.current = controller;
      setChatStreaming(true);
      try {
        await ask(
          p,
          { kind: "chat", history, lang },
          {
            signal: controller.signal,
            onText: (t) => {
              answer += t;
              setChat([...history, { role: "assistant", content: answer }]);
            },
            onNotice: setChatNotice,
          },
        );
      } catch (e) {
        if (!isAbort(e)) setChatNotice(errorText(e));
      } finally {
        chatAbort.current = null;
        setChatStreaming(false);
        // Keep the transcript valid: a failed turn is dropped rather than left empty.
        const final: ChatTurn[] = answer ? [...history, { role: "assistant", content: answer }] : chat;
        setChat(final);
        update((cur) => ({ ...cur, chat: final }));
      }
    },
    [chat, chatQuote, lang, update],
  );

  /* ------------------------- Summary & auto highlight ----------------------- */

  const generateSummary = async () => {
    const p = paperRef.current;
    if (!p) return;
    setSummaryState({ loading: true });
    try {
      const summary = await fetchSummary(p, lang);
      update((cur) => ({ ...cur, summary, summaryLang: lang }));
      setSummaryState({ loading: false });
    } catch (e) {
      setSummaryState({ loading: false, error: errorText(e) });
    }
  };

  const generateAuto = async () => {
    const p = paperRef.current;
    const pdf = pdfRef.current;
    if (!p || !pdf) return;
    setAutoState({ loading: true });
    try {
      const found = await fetchHighlights(p, lang);
      const cache = new Map();
      const located = await Promise.all(
        found.map(async (h) => {
          const hit = await locateQuote(pdf, h.quote, h.page, cache);
          return { ...h, page: hit?.page ?? h.page, rects: hit?.rects ?? [] };
        }),
      );
      located.sort((a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0));
      update((cur) => ({ ...cur, autoHighlights: located }));
      setShowAuto(true);
      setAutoState({ loading: false });
    } catch (e) {
      setAutoState({ loading: false, error: errorText(e) });
    }
  };

  const autoHighlights = paper?.autoHighlights;
  const autoMarks: AutoMark[] = useMemo(
    () =>
      showAuto && autoHighlights
        ? autoHighlights.map((h, i) => ({ id: `auto-${i}`, kind: h.kind, why: h.why, rects: h.rects }))
        : [],
    [autoHighlights, showAuto],
  );

  /* ---------------------------------- Notes -------------------------------- */

  const addHighlight = (color: HighlightColor, withNote = false) => {
    if (!selection) return;
    const note = {
      id: crypto.randomUUID(),
      page: selection.page,
      text: selection.text,
      rects: selection.rects,
      color,
      note: "",
      createdAt: Date.now(),
    };
    changeNotes((notes) => [...notes, note]);
    window.getSelection()?.removeAllRanges();
    if (withNote) setOpenNote({ id: note.id, anchor: { x: selection.anchor.x, y: selection.anchor.bottom }, focusNote: true });
    setSelection(null);
  };

  const removeNote = (noteId: string) => {
    changeNotes((notes) => notes.filter((n) => n.id !== noteId));
    setOpenNote(null);
    showToast("Highlight removed · ⌘Z to undo");
  };

  const exportNotes = () => {
    const p = paperRef.current;
    if (!p) return;
    const title = p.summary?.title ?? p.name;
    const lines = [`# ${title}`, ""];
    if (p.summary) lines.push("## TL;DR", "", p.summary.tldr, "");
    if (p.notes.length) {
      lines.push("## Highlights", "");
      for (const n of [...p.notes].sort((a, b) => a.page - b.page)) {
        lines.push(`> ${n.text} (p. ${n.page})`, "");
        if (n.note) lines.push(n.note, "");
      }
    }
    if (p.autoHighlights?.length) {
      lines.push("## Key sentences", "");
      for (const h of p.autoHighlights) lines.push(`- **${h.kind}** (p. ${h.page}): ${h.quote}  \n  _${h.why}_`);
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${p.name} - notes.md` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const jump = (target: string, toPage: number, y: number) => {
    view.current?.goTo(toPage, y);
    flash(target);
  };

  /* --------------------------------- Render -------------------------------- */

  if (paper === undefined) return <div className="grid h-screen place-items-center text-ink-3">Opening…</div>;
  if (paper === null) {
    return (
      <div className="grid h-screen place-items-center text-center">
        <div>
          <p className="font-serif text-xl">This paper isn&apos;t in your library.</p>
          <Link href="/" className="btn-primary mt-4">
            Back to library
          </Link>
        </div>
      </div>
    );
  }

  const zoomIndex = ZOOMS.indexOf(zoom);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Link href="/" aria-label="Back to library" className="icon-btn">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium" title={paper.name}>
          {paper.summary?.title ?? paper.name}
        </h1>

        <div className="hidden items-center gap-1 text-sm text-ink-2 sm:flex">
          <PageInput key={page} page={page} numPages={numPages} onGo={(n) => view.current?.goTo(n)} />
          <span className="tabular-nums">/ {numPages || "–"}</span>
        </div>

        <div className="flex items-center rounded-lg border border-line">
          <button aria-label="Zoom out" disabled={zoomIndex <= 0} onClick={() => setZoom(ZOOMS[zoomIndex - 1])} className="icon-btn size-7!">
            <Minus size={15} />
          </button>
          <span className="w-11 text-center text-xs text-ink-2 tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            disabled={zoomIndex >= ZOOMS.length - 1}
            onClick={() => setZoom(ZOOMS[zoomIndex + 1])}
            className="icon-btn size-7!"
          >
            <Plus size={15} />
          </button>
        </div>

        <button
          onClick={() => setCaptureMode((m) => !m)}
          aria-pressed={captureMode}
          title="Capture a figure or table (Esc to cancel)"
          className={`btn-secondary h-8! ${captureMode ? "border-accent! bg-accent-soft text-accent-ink" : ""}`}
        >
          <Crop size={15} /> <span className="hidden md:inline">Figure</span>
        </button>
        <button onClick={() => runAssist("page-translate", page)} title={`Translate page ${page}`} className="btn-secondary h-8!">
          <Languages size={15} /> <span className="hidden md:inline">Translate page</span>
        </button>

        <select
          aria-label="Answer language"
          value={lang}
          onChange={(e) => setLanguage(e.target.value)}
          className="hidden h-8 max-w-40 rounded-lg border border-line bg-surface px-2 text-sm lg:block"
        >
          {LANGUAGES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>

        <button
          aria-label="Toggle assistant panel"
          aria-pressed={panelOpen}
          onClick={() => setPanelOpen((o) => !o)}
          className={`icon-btn ${panelOpen ? "text-accent" : ""}`}
        >
          <PanelRight size={18} />
        </button>
      </header>

      {captureMode && (
        <div className="bg-accent px-4 py-1.5 text-center text-sm text-white">
          Drag a box around a figure, table or equation. Press Esc to cancel.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {file && (
            <PdfView
              ref={view}
              file={file}
              zoom={zoom}
              notes={paper.notes}
              autoMarks={autoMarks}
              captureMode={captureMode}
              flashId={flashId}
              onLoad={onLoad}
              onPageChange={setPage}
              onSelection={setSelection}
              onCapture={onCapture}
              onNoteClick={(noteId, anchor) => setOpenNote({ id: noteId, anchor, focusNote: false })}
            />
          )}
        </div>

        {panelOpen && (
          <aside
            style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
            className="fixed inset-x-0 top-14 bottom-0 z-40 flex flex-col border-l border-line bg-paper md:relative md:inset-auto md:w-(--panel-w) md:shrink-0"
          >
            <ResizeHandle width={panelWidth} onResize={resizePanel} />
            <Tabs
              tab={tab}
              onTab={setTab}
              counts={{ assist: cards.length, notes: paper.notes.length }}
            />
            <div className={`min-h-0 flex-1 ${tab === "chat" ? "" : "overflow-y-auto"}`}>
              {tab === "assist" && (
                <AssistTab
                  cards={cards}
                  page={page}
                  onClose={closeCard}
                  onFollowUp={(c) => {
                    setChatQuote(c.selection ?? `(${c.mode === "figure" ? "figure" : "page"} on p. ${c.page})`);
                    setTab("chat");
                  }}
                  onTranslatePage={() => runAssist("page-translate", page)}
                  onCapture={() => setCaptureMode(true)}
                />
              )}
              {tab === "summary" && (
                <SummaryTab paper={paper} lang={lang} state={summaryState} onGenerate={generateSummary} onAsk={sendChat} />
              )}
              {tab === "chat" && (
                <ChatTab
                  chat={chat}
                  streaming={chatStreaming}
                  quote={chatQuote}
                  notice={chatNotice}
                  onClearQuote={() => setChatQuote(null)}
                  onSend={sendChat}
                  onStop={() => chatAbort.current?.abort()}
                  onClear={() => {
                    setChat([]);
                    update((p) => ({ ...p, chat: [] }));
                  }}
                />
              )}
              {tab === "notes" && (
                <NotesTab
                  paper={paper}
                  showAuto={showAuto}
                  autoState={autoState}
                  onToggleAuto={() => setShowAuto((s) => !s)}
                  onGenerateAuto={generateAuto}
                  onJump={jump}
                  onUpdateNote={(noteId, text) =>
                    changeNotes((notes) => notes.map((n) => (n.id === noteId ? { ...n, note: text } : n)))
                  }
                  onDeleteNote={removeNote}
                  onExport={exportNotes}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {selection && !captureMode && (
        <SelectionMenu
          selection={selection}
          onExplain={() => {
            runAssist("explain", selection.page, { selection: selection.text });
            setSelection(null);
          }}
          onTranslate={() => {
            runAssist("translate", selection.page, { selection: selection.text });
            setSelection(null);
          }}
          onAsk={() => {
            setChatQuote(selection.text);
            setTab("chat");
            setPanelOpen(true);
            setSelection(null);
          }}
          onHighlight={addHighlight}
          onNote={() => addHighlight("yellow", true)}
        />
      )}

      {openNote && paper.notes.some((n) => n.id === openNote.id) && (
        <NotePopover
          key={openNote.id}
          note={paper.notes.find((n) => n.id === openNote.id)!}
          anchor={openNote.anchor}
          focusNote={openNote.focusNote}
          onColor={(color) => changeNotes((notes) => notes.map((n) => (n.id === openNote.id ? { ...n, color } : n)))}
          onNote={(text) => changeNotes((notes) => notes.map((n) => (n.id === openNote.id ? { ...n, note: text } : n)))}
          onRemove={() => removeNote(openNote.id)}
          onClose={() => setOpenNote(null)}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-sm text-paper shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function PageInput({ page, numPages, onGo }: { page: number; numPages: number; onGo: (n: number) => void }) {
  const [draft, setDraft] = useState(String(page));
  const commit = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1 && n <= numPages) onGo(n);
    else setDraft(String(page));
  };
  return (
    <input
      aria-label="Page"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="w-9 rounded-md border border-line bg-paper py-1 text-center tabular-nums"
    />
  );
}

/** Drag the panel's left edge to resize it; double-click resets. Arrow keys work too. */
function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(drag.current.width + drag.current.x - e.clientX);
      }}
      onPointerUp={() => {
        drag.current = null;
        document.body.style.userSelect = "";
      }}
      onDoubleClick={() => onResize(PANEL_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + 40);
        if (e.key === "ArrowRight") onResize(width - 40);
      }}
      className="group absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize md:block"
    >
      <div className="mx-auto h-full w-0.5 transition-colors group-hover:bg-accent/50 group-focus-visible:bg-accent group-active:bg-accent" />
    </div>
  );
}
