import "server-only";
import { z } from "zod";
import type { AskRequest, AssistMode, PaperSummary } from "./types";
import type { Task } from "./backend/types";

// One frozen system prompt shared by every request type, so the
// system + paper prefix stays identical and is served from the prompt cache.
export const SYSTEM = `You are Lumen, a patient research colleague who helps people read academic papers.
You have the full paper, including its figures, tables and equations. Ground every answer in it.

Guidelines:
- Answer from the paper first. When you add outside background knowledge, say so briefly.
- Cite where things come from with page references like (p. 4) or (Fig. 2, p. 5).
- If the paper does not say something, say that plainly instead of guessing.
- Write math in LaTeX: $inline$ and $$display$$.
- Use Markdown. Be concise: short paragraphs, bullets where they help, no filler or preamble.`;

function assistPrompt(mode: AssistMode, page: number, lang: string, selection = ""): string {
  switch (mode) {
    case "explain":
      return `The reader selected this passage on page ${page}:
"""
${selection}
"""
Explain it so a smart reader outside this subfield can follow: what it says, why it matters to the paper's argument, and any terms, symbols or citations it depends on. Respond in ${lang}.`;
    case "translate":
      return `Translate this passage from page ${page} into ${lang}:
"""
${selection}
"""
Keep technical terms precise (give the original term in parentheses on first use when it helps), and keep math as LaTeX. Output only the translation.`;
    case "figure":
      return `The attached image is a region the reader captured from page ${page} of the paper. Say what it is (figure, table, equation, algorithm), then explain it in the paper's context: what it shows, how to read it (axes, columns, symbols), and what conclusion the paper draws from it. Respond in ${lang}.`;
    case "page-translate":
      return `Translate page ${page} of the paper into ${lang}, in reading order. Keep headings, lists and paragraph breaks as Markdown, equations as LaTeX, and tables as Markdown tables. Replace each figure with its translated caption in italics. Output only the translation.`;
  }
}

/** Turn a browser request into a backend-neutral task. */
export function askTask(body: AskRequest): Task {
  if (body.kind === "assist") {
    return {
      fileId: body.fileId,
      effort: body.mode === "figure" ? "medium" : "low",
      turns: [{ role: "user", content: assistPrompt(body.mode, body.page, body.lang, body.selection) }],
      image: body.mode === "figure" ? body.image : undefined,
    };
  }
  const turns = body.history.map((t) => ({ ...t }));
  turns[turns.length - 1].content += `\n\n(Reply in ${body.lang} unless I write in another language.)`;
  return { fileId: body.fileId, effort: "medium", turns };
}

export const SummarySchema = z.object({
  title: z.string(),
  authors: z.array(z.string()),
  tldr: z.string().describe("Two or three sentences a busy researcher can act on."),
  keywords: z.array(z.string()).describe("5-8 technical keywords."),
  problem: z.string().describe("The gap or question the paper addresses."),
  contributions: z.array(z.string()),
  method: z.string().describe("How they did it, in one paragraph."),
  results: z.array(z.string()).describe("Key findings with numbers and page references."),
  limitations: z.array(z.string()).describe("Stated and evident limitations."),
  discussion_questions: z.array(z.string()).describe("3-4 sharp questions for a reading group."),
}) satisfies z.ZodType<PaperSummary>;

export const summaryTask = (fileId: string, lang: string): Task => ({
  fileId,
  effort: "medium",
  turns: [
    {
      role: "user",
      content: `Write a structured reading summary of this paper. Keep the title and author names as printed; write every other field in ${lang}. Plain text in each field (inline LaTeX allowed).`,
    },
  ],
});

export const HighlightsSchema = z.object({
  highlights: z.array(
    z.object({
      quote: z.string().describe("Exact sentence copied verbatim from the paper text, 8-40 words."),
      page: z.number().int().describe("1-based page number where the quote appears."),
      kind: z.enum(["claim", "method", "result", "limitation"]),
      why: z.string().describe("One short sentence on why this matters."),
    }),
  ),
});

export const highlightsTask = (fileId: string, lang: string): Task => ({
  fileId,
  effort: "low",
  turns: [
    {
      role: "user",
      content: `Pick the 12-20 sentences a careful reader would underline: main claims, key method choices, headline results, and limitations. Spread them across the paper and skip the abstract. Copy each quote character-for-character from the body text (no ellipses, no paraphrase) so it can be located in the PDF. Write "why" in ${lang}.`,
    },
  ],
});
