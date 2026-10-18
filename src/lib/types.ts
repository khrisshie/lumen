// Shapes shared by the browser and the API routes.

export type AssistMode = "explain" | "translate" | "figure" | "page-translate";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AskRequest = {
  fileId: string;
  lang: string;
} & (
  | { kind: "assist"; mode: AssistMode; page: number; selection?: string; image?: string }
  | { kind: "chat"; history: ChatTurn[] }
);

/** One line of the NDJSON stream returned by /api/ask. */
export type StreamEvent =
  | { t: "text"; v: string }
  | { t: "notice"; v: string }
  | { t: "error"; code: string; v: string }
  | { t: "done" };

export type PaperSummary = {
  title: string;
  authors: string[];
  tldr: string;
  keywords: string[];
  problem: string;
  contributions: string[];
  method: string;
  results: string[];
  limitations: string[];
  discussion_questions: string[];
};

export type HighlightKind = "claim" | "method" | "result" | "limitation";

export type AutoHighlight = {
  quote: string;
  page: number;
  kind: HighlightKind;
  why: string;
};
