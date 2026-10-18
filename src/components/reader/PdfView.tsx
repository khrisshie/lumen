"use client";

import { Suspense, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StickyNote } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { HighlightColor, Note, Rect } from "@/lib/store";
import type { HighlightKind } from "@/lib/types";

// Must be set in the same module that renders react-pdf components.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export const NOTE_COLORS: Record<HighlightColor, string> = {
  yellow: "rgba(250, 204, 21, 0.38)",
  green: "rgba(74, 222, 128, 0.35)",
  blue: "rgba(96, 165, 250, 0.35)",
  pink: "rgba(244, 114, 182, 0.35)",
};

export const KIND_COLORS: Record<HighlightKind, string> = {
  claim: "#7c5cff",
  method: "#2f80ed",
  result: "#16a34a",
  limitation: "#ea7a12",
};

export type AutoMark = { id: string; kind: HighlightKind; why: string; rects: Rect[] };

export type Selection = {
  text: string;
  page: number;
  rects: Rect[];
  anchor: { x: number; y: number; bottom: number };
};

export type PdfViewHandle = {
  goTo: (page: number, yFraction?: number) => void;
};

type Props = {
  file: Blob;
  zoom: number;
  notes: Note[];
  autoMarks: AutoMark[];
  captureMode: boolean;
  flashId: string | null;
  onLoad: (pdf: PDFDocumentProxy) => void;
  onPageChange: (page: number) => void;
  onSelection: (selection: Selection | null) => void;
  onCapture: (page: number, region: Omit<Rect, "page">) => void;
  /** A click (not a text selection) landed on one of the user's highlights. */
  onNoteClick: (id: string, anchor: { x: number; y: number }) => void;
};

const GUTTER = 48;

export const PdfView = forwardRef<PdfViewHandle, Props>(function PdfView(
  { file, zoom, notes, autoMarks, captureMode, flashId, onLoad, onPageChange, onSelection, onCapture, onNoteClick },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const [aspects, setAspects] = useState<number[]>([]);
  const [containerWidth, setContainerWidth] = useState(800);
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]));

  const pageWidth = Math.round(Math.min(containerWidth - GUTTER, 880) * zoom);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Debounced: dragging the panel edge resizes this every frame, and each change re-renders the pages.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => setContainerWidth(entry.contentRect.width), 100);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  const handleLoad = useCallback(
    async (pdf: PDFDocumentProxy) => {
      const sizes = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, i) => {
          const page = await pdf.getPage(i + 1);
          const [x0, y0, x1, y1] = page.view;
          return (y1 - y0) / (x1 - x0);
        }),
      );
      setAspects(sizes);
      onLoad(pdf);
    },
    [onLoad],
  );

  // Render only pages near the viewport; track the most visible one as "current".
  useEffect(() => {
    const root = scroller.current;
    if (!root || aspects.length === 0) return;
    const ratios = new Map<number, number>();
    const near = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root, rootMargin: "1200px 0px" },
    );
    const current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
        let best = 1;
        let bestRatio = -1;
        for (const [n, r] of ratios) if (r > bestRatio) [best, bestRatio] = [n, r];
        onPageChange(best);
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of slots.current.values()) {
      near.observe(el);
      current.observe(el);
    }
    return () => {
      near.disconnect();
      current.disconnect();
    };
  }, [aspects.length, onPageChange]);

  useImperativeHandle(ref, () => ({
    goTo(page, yFraction = 0) {
      const el = slots.current.get(page);
      const root = scroller.current;
      if (!el || !root) return;
      const top = el.offsetTop + yFraction * el.offsetHeight - (yFraction ? 120 : 16);
      root.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    },
  }));

  /** The highlight under a point, if any; the newest wins where highlights overlap. */
  const noteAt = useCallback(
    (x: number, y: number) => {
      for (const note of [...notes].reverse()) {
        for (const r of note.rects) {
          const box = slots.current.get(r.page)?.getBoundingClientRect();
          if (!box) continue;
          const left = box.left + r.x * box.width;
          const top = box.top + r.y * box.height;
          if (x >= left && x <= left + r.w * box.width && y >= top && y <= top + r.h * box.height) {
            return { note, bottom: top + r.h * box.height };
          }
        }
      }
      return null;
    },
    [notes],
  );

  // Text selection → page-relative rects for highlights + an anchor for the menu.
  // A plain click on a highlight opens it instead, so selecting text over highlights still works.
  const readSelection = useCallback((click: { x: number; y: number }) => {
    const sel = window.getSelection();
    const root = scroller.current;
    const text = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, " ").trim() : "";
    if (text.length < 2) {
      onSelection(null);
      const hit = noteAt(click.x, click.y);
      if (hit) onNoteClick(hit.note.id, { x: click.x, y: hit.bottom });
      return;
    }
    if (!sel || !root || !root.contains(sel.anchorNode)) return onSelection(null);
    const range = sel.getRangeAt(0);
    const pages = [...slots.current.entries()].map(([n, el]) => ({ n, box: el.getBoundingClientRect() }));
    const rects: Rect[] = [];
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = pages.find(({ box }) => cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom);
      if (!hit) continue;
      rects.push({
        page: hit.n,
        x: (r.left - hit.box.left) / hit.box.width,
        y: (r.top - hit.box.top) / hit.box.height,
        w: r.width / hit.box.width,
        h: r.height / hit.box.height,
      });
    }
    if (rects.length === 0) return onSelection(null);
    const box = range.getBoundingClientRect();
    onSelection({ text, page: rects[0].page, rects, anchor: { x: box.left + box.width / 2, y: box.top, bottom: box.bottom } });
  }, [onSelection, onNoteClick, noteAt]);

  const marksByPage = useMemo(() => {
    const byPage = new Map<number, { notes: { note: Note; rect: Rect }[]; auto: { mark: AutoMark; rect: Rect }[] }>();
    const bucket = (p: number) => {
      if (!byPage.has(p)) byPage.set(p, { notes: [], auto: [] });
      return byPage.get(p)!;
    };
    for (const note of notes) for (const rect of note.rects) bucket(rect.page).notes.push({ note, rect });
    for (const mark of autoMarks) for (const rect of mark.rects) bucket(rect.page).auto.push({ mark, rect });
    return byPage;
  }, [notes, autoMarks]);

  return (
    <div
      ref={scroller}
      onMouseUp={(e) => {
        if (captureMode) return;
        const click = { x: e.clientX, y: e.clientY };
        setTimeout(() => readSelection(click), 0);
      }}
      onScroll={() => onSelection(null)}
      className="relative h-full overflow-auto bg-sunken"
    >
      <Suspense
        fallback={
          <div className="flex justify-center py-6">
            <PageSkeleton width={pageWidth} />
          </div>
        }
      >
        <Document
          file={file}
          onLoadSuccess={handleLoad}
          onItemClick={({ pageNumber }) => {
            const el = slots.current.get(pageNumber);
            if (el) scroller.current?.scrollTo({ top: el.offsetTop - 16, behavior: "instant" });
          }}
          loading={<PageSkeleton width={pageWidth} />}
          error={<p className="p-10 text-center text-danger">This PDF could not be opened.</p>}
          className="flex flex-col items-center gap-4 py-6"
        >
          {aspects.map((aspect, i) => {
            const n = i + 1;
            const height = Math.round(pageWidth * aspect);
            const marks = marksByPage.get(n);
            return (
              <div
                key={n}
                data-page={n}
                ref={(el) => {
                  if (el) slots.current.set(n, el);
                  else slots.current.delete(n);
                }}
                style={{ width: pageWidth, height }}
                className="relative shrink-0 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.06)]"
              >
                {visible.has(n) && (
                  // react-pdf suspends while a page loads; keep that local to the page.
                  <Suspense fallback={null}>
                    <Page pageNumber={n} width={pageWidth} loading={null} className="absolute! inset-0" />
                  </Suspense>
                )}
                {marks && (
                  <div className="pointer-events-none absolute inset-0 z-[3]">
                    {marks.notes.map(({ note, rect }, j) => (
                      <div
                        key={`${note.id}-${j}`}
                        className={`absolute rounded-[2px] mix-blend-multiply transition ${flashId === note.id ? "ring-2 ring-accent" : ""}`}
                        style={{ ...place(rect), background: NOTE_COLORS[note.color] }}
                      />
                    ))}
                    {marks.notes
                      .filter(({ note, rect }) => note.note.trim() && rect === note.rects.findLast((r) => r.page === n))
                      .map(({ note, rect }) => (
                        // A marker after the last line of a highlight that has a note.
                        <button
                          key={`${note.id}-marker`}
                          aria-label="Open note"
                          title={note.note}
                          onClick={(e) => {
                            const box = e.currentTarget.getBoundingClientRect();
                            onNoteClick(note.id, { x: box.left + box.width / 2, y: box.bottom });
                          }}
                          onMouseUp={(e) => e.stopPropagation()}
                          className="pointer-events-auto absolute grid size-5 -translate-y-1/2 place-items-center rounded-full bg-accent text-white shadow-sm ring-2 ring-white hover:scale-110"
                          style={{ left: `calc(${(rect.x + rect.w) * 100}% + 4px)`, top: `${(rect.y + rect.h / 2) * 100}%` }}
                        >
                          <StickyNote size={11} strokeWidth={2.5} />
                        </button>
                      ))}
                    {marks.auto.map(({ mark, rect }, j) => (
                      <div
                        key={`${mark.id}-${j}`}
                        title={mark.why}
                        className={`pointer-events-auto absolute ${flashId === mark.id ? "bg-accent/15" : ""}`}
                        style={{
                          left: `${rect.x * 100}%`,
                          top: `${(rect.y + rect.h) * 100 - 0.25}%`,
                          width: `${rect.w * 100}%`,
                          height: 3,
                          background: KIND_COLORS[mark.kind],
                          opacity: 0.75,
                          borderRadius: 2,
                        }}
                      />
                    ))}
                  </div>
                )}
                {captureMode && <CaptureLayer onCapture={(region) => onCapture(n, region)} />}
                <span className="absolute -bottom-5 right-0 text-[11px] text-ink-3">{n}</span>
              </div>
            );
          })}
        </Document>
      </Suspense>
    </div>
  );
});

function place(r: Rect) {
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` };
}

function PageSkeleton({ width }: { width: number }) {
  return <div className="shimmer rounded" style={{ width, height: width * 1.3 }} />;
}

/** Drag a rectangle over a page to capture a figure or table. */
function CaptureLayer({ onCapture }: { onCapture: (region: Omit<Rect, "page">) => void }) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const point = (e: React.PointerEvent) => {
    const box = layer.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  };

  const region = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <div
      ref={layer}
      className="absolute inset-0 z-10 cursor-crosshair bg-accent/[0.04]"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const { x, y } = point(e);
        setDrag({ x0: x, y0: y, x1: x, y1: y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const { x, y } = point(e);
        setDrag({ ...drag, x1: x, y1: y });
      }}
      onPointerUp={() => {
        if (region && region.w > 0.03 && region.h > 0.02) onCapture(region);
        setDrag(null);
      }}
    >
      {region && (
        <div
          className="absolute border-2 border-accent bg-accent/10"
          style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
        />
      )}
    </div>
  );
}
