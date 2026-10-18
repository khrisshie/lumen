"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Rect } from "./store";

// Quotes from the model never match PDF text byte-for-byte (hyphenation,
// ligatures, spacing), so both sides are reduced to lowercase letters and
// digits, keeping a map from each kept char back to its text item.

type PageText = {
  norm: string;
  map: { item: number; offset: number }[];
  items: TextItem[];
  view: number[];
};

const keep = /[\p{L}\p{N}]/u;

function normalize(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKD").toLowerCase()) if (keep.test(ch)) out += ch;
  return out;
}

async function loadPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageText> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const items = content.items.filter((it): it is TextItem => "str" in it);
  let norm = "";
  const map: PageText["map"] = [];
  items.forEach((item, idx) => {
    [...item.str].forEach((ch, offset) => {
      for (const c of ch.normalize("NFKD").toLowerCase()) {
        if (!keep.test(c)) continue;
        norm += c;
        map.push({ item: idx, offset });
      }
    });
  });
  return { norm, map, items, view: page.view };
}

function findSpan(norm: string, quote: string): [number, number] | null {
  const exact = norm.indexOf(quote);
  if (exact >= 0) return [exact, exact + quote.length];
  if (quote.length < 60) return null;
  const head = quote.slice(0, 30);
  const tail = quote.slice(-30);
  const start = norm.indexOf(head);
  if (start < 0) return null;
  const end = norm.indexOf(tail, start);
  if (end < 0 || end - start > quote.length * 1.5) return null;
  return [start, end + tail.length];
}

function rectsFor(text: PageText, page: number, [start, end]: [number, number]): Rect[] {
  const spans = new Map<number, { from: number; to: number }>();
  for (let i = start; i < end; i++) {
    const { item, offset } = text.map[i];
    const span = spans.get(item);
    if (span) span.to = Math.max(span.to, offset);
    else spans.set(item, { from: offset, to: offset });
  }
  const [x0, y0, x1, y1] = text.view;
  const W = x1 - x0;
  const H = y1 - y0;
  return [...spans].map(([idx, { from, to }]) => {
    const item = text.items[idx];
    const [, , c, d, e, f] = item.transform;
    const size = Math.hypot(c, d) || item.height;
    const len = Math.max(item.str.length, 1);
    const left = e + (item.width * from) / len;
    const width = (item.width * (to + 1 - from)) / len;
    return {
      page,
      x: (left - x0) / W,
      y: 1 - (f + size * 0.85 - y0) / H,
      w: width / W,
      h: (size * 1.1) / H,
    };
  });
}

/** Find a quote in the PDF, starting from the page the model named. */
export async function locateQuote(
  pdf: PDFDocumentProxy,
  quote: string,
  hintPage: number,
  cache: Map<number, Promise<PageText>>,
): Promise<{ page: number; rects: Rect[] } | null> {
  const q = normalize(quote);
  if (q.length < 8) return null;
  const order = [hintPage, hintPage - 1, hintPage + 1];
  for (let p = 1; p <= pdf.numPages; p++) if (!order.includes(p)) order.push(p);

  for (const page of order) {
    if (page < 1 || page > pdf.numPages) continue;
    if (!cache.has(page)) cache.set(page, loadPage(pdf, page));
    const text = await cache.get(page)!;
    const span = findSpan(text.norm, q);
    if (span) return { page, rects: rectsFor(text, page, span) };
  }
  return null;
}
