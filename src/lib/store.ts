"use client";

import { createStore, del, get, set, values } from "idb-keyval";
import type { AutoHighlight, ChatTurn, PaperSummary } from "./types";

/** A rectangle as fractions (0-1) of its page box, so it survives zoom. */
export type Rect = { page: number; x: number; y: number; w: number; h: number };

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export type Note = {
  id: string;
  page: number;
  text: string;
  rects: Rect[];
  color: HighlightColor;
  note: string;
  createdAt: number;
};

export type Paper = {
  id: string;
  name: string;
  size: number;
  addedAt: number;
  openedAt: number;
  numPages?: number;
  lastPage?: number;
  fileId?: string;
  summary?: PaperSummary;
  summaryLang?: string;
  autoHighlights?: (AutoHighlight & { rects: Rect[] })[];
  notes: Note[];
  chat: ChatTurn[];
};

const papers = createStore("lumen", "papers");
const pdfs = createStore("lumen-pdfs", "pdfs");

export async function listPapers(): Promise<Paper[]> {
  const all = await values<Paper>(papers);
  return all.sort((a, b) => b.openedAt - a.openedAt);
}

export const getPaper = (id: string) => get<Paper>(id, papers);
export const savePaper = (paper: Paper) => set(paper.id, paper, papers);
export const getPdf = (id: string) => get<Blob>(id, pdfs);

export async function addPaper(file: File): Promise<Paper> {
  const now = Date.now();
  const paper: Paper = {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.pdf$/i, ""),
    size: file.size,
    addedAt: now,
    openedAt: now,
    notes: [],
    chat: [],
  };
  await set(paper.id, file, pdfs);
  await savePaper(paper);
  return paper;
}

export async function removePaper(id: string) {
  await Promise.all([del(id, papers), del(id, pdfs)]);
}
