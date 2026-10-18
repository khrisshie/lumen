"use client";

import { getPdf, savePaper, type Paper } from "./store";
import type { AskRequest, AutoHighlight, PaperSummary, StreamEvent } from "./types";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type AskInput = DistributiveOmit<AskRequest, "fileId">;

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function failure(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  return new ApiError(body.code ?? "http", body.message ?? `Request failed (${res.status})`);
}

const uploads = new Map<string, Promise<string>>();

/** Upload the paper to the Files API once and remember its file id. */
export function ensureFileId(paper: Paper, force = false): Promise<string> {
  if (paper.fileId && !force) return Promise.resolve(paper.fileId);
  let pending = uploads.get(paper.id);
  if (!pending) {
    pending = upload(paper).finally(() => uploads.delete(paper.id));
    uploads.set(paper.id, pending);
  }
  return pending;
}

async function upload(paper: Paper): Promise<string> {
  const blob = await getPdf(paper.id);
  if (!blob) throw new ApiError("missing_pdf", "This paper's PDF is missing from local storage.");
  const form = new FormData();
  form.append("file", new File([blob], `${paper.name}.pdf`, { type: "application/pdf" }));
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) throw await failure(res);
  const { fileId } = (await res.json()) as { fileId: string };
  paper.fileId = fileId;
  await savePaper(paper);
  return fileId;
}

/** Run `call` with the paper's file id, re-uploading once if the server lost it. */
async function withFile<T>(paper: Paper, call: (fileId: string) => Promise<T>): Promise<T> {
  try {
    return await call(await ensureFileId(paper));
  } catch (error) {
    if (error instanceof ApiError && error.code === "file_missing") {
      return call(await ensureFileId(paper, true));
    }
    throw error;
  }
}

export type StreamHandlers = {
  onText: (chunk: string) => void;
  onNotice?: (notice: string) => void;
  signal?: AbortSignal;
};

export function ask(paper: Paper, input: AskInput, handlers: StreamHandlers): Promise<void> {
  return withFile(paper, async (fileId) => {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, fileId }),
      signal: handlers.signal,
    });
    if (!res.ok || !res.body) throw await failure(res);

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let received = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        if (event.t === "text") {
          received = true;
          handlers.onText(event.v);
        } else if (event.t === "notice") {
          handlers.onNotice?.(event.v);
        } else if (event.t === "error") {
          // Only allow the re-upload retry if nothing was streamed yet.
          const code = event.code === "file_missing" && received ? "api" : event.code;
          throw new ApiError(code, event.v);
        }
      }
    }
  });
}

async function postJson<T>(paper: Paper, path: string, extra: object, signal?: AbortSignal): Promise<T> {
  return withFile(paper, async (fileId) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, ...extra }),
      signal,
    });
    if (!res.ok) throw await failure(res);
    return (await res.json()) as T;
  });
}

export const fetchSummary = (paper: Paper, lang: string, signal?: AbortSignal) =>
  postJson<PaperSummary>(paper, "/api/summary", { lang }, signal);

export const fetchHighlights = (paper: Paper, lang: string, signal?: AbortSignal) =>
  postJson<AutoHighlight[]>(paper, "/api/highlights", { lang }, signal);
