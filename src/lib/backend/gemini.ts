import "server-only";
import { randomUUID } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SYSTEM } from "../prompts";
import { DATA, lastLine, pdfPath, runJsonl, savePdf } from "./local";
import { BackendError, type Backend, type Task } from "./types";

// Gemini backend: runs Google Antigravity's CLI (`agy -p`) with your Google login
// (e.g. a Google AI Pro plan). The older Gemini CLI no longer accepts personal accounts.
//
// Each request is a fresh run that opens the PDF with Antigravity's view_file tool,
// which reads it natively, figures included. The default permission mode lets it
// read files but denies commands and edits in headless runs.

export const AGY_BIN = process.env.AGY_BIN ?? "agy";
const MODEL = process.env.LUMEN_GEMINI_MODEL; // unset = your Antigravity default model
const TMP = path.join(DATA, "tmp");

function prompt(task: Task, pdf: string, image?: string): string {
  const turns = task.turns.map((t, i) =>
    task.turns.length === 1
      ? t.content
      : `${t.role === "user" ? "Reader" : "Lumen"}${i === task.turns.length - 1 ? " (new message)" : ""}:\n${t.content}`,
  );
  return `${SYSTEM}

First open the paper with view_file: ${pdf}
${image ? `Then open the image the reader captured with view_file: ${image}\n` : ""}Only read: don't run commands, edit files or browse the web. In your answer, don't mention files, paths or tools.

${task.turns.length > 1 ? "Our conversation about the paper so far:\n\n" : ""}${turns.join("\n\n")}`;
}

type StepUpdate = { step_index?: number; step_type?: string; state?: string; text_delta?: string };
type Result = { status?: string; response?: string; error?: unknown };

/** Run `agy -p` once; `onText` gets the answer as it streams. Resolves with the final response. */
async function run(task: Task, signal: AbortSignal, suffix = "", onText?: (text: string) => void): Promise<string> {
  const pdf = pdfPath(task.fileId);
  try {
    await access(pdf);
  } catch {
    throw new BackendError(410, "file_missing", "The paper is no longer on the server.");
  }
  const files: string[] = [];
  try {
    let image: string | undefined;
    if (task.image) {
      await mkdir(TMP, { recursive: true });
      image = path.join(TMP, `${randomUUID()}.png`);
      await writeFile(image, Buffer.from(task.image.replace(/^data:image\/png;base64,/, ""), "base64"));
      files.push(image);
    }
    const args = [
      "-p", prompt(task, pdf, image) + suffix,
      "--output-format", "stream-json",
      "--effort", task.effort,
      ...(MODEL ? ["--model", MODEL] : []),
    ];

    let result: Result | undefined;
    let step: number | undefined;
    const { code, output } = await runJsonl(AGY_BIN, args, {
      input: "",
      signal,
      missing: `Couldn't find the Antigravity CLI ("${AGY_BIN}"). Install Antigravity or set AGY_BIN.`,
      onEvent(event) {
        if (event.event === "result") result = event.result as Result;
        const update = event.step_update as StepUpdate | undefined;
        if (event.event !== "step_update" || update?.step_type !== "agent_response" || !update.text_delta) return;
        // Text from a later step (e.g. after reading the PDF) starts a new paragraph.
        if (step !== undefined && update.step_index !== step) onText?.("\n\n");
        step = update.step_index;
        onText?.(update.text_delta);
      },
    });
    if (result?.status !== "SUCCESS") throw failure(output || JSON.stringify(result?.error ?? ""), code);
    return result.response ?? "";
  } finally {
    await Promise.all(files.map((f) => rm(f, { force: true })));
  }
}

function failure(output: string, code: number | null): BackendError {
  if (/sign in|log ?in|unauthenticated|401|oauth/i.test(output)) {
    return new BackendError(401, "auth", "Antigravity isn't signed in. Run `agy` in a terminal and sign in.");
  }
  if (/quota|rate limit|429|resource.?exhausted/i.test(output)) {
    return new BackendError(429, "rate_limit", lastLine(output, "Antigravity hit a usage limit."));
  }
  return new BackendError(502, "cli", lastLine(output, `Antigravity exited with code ${code}.`));
}

/** The JSON object in a reply that may wrap it in prose or a code fence. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const candidate of [text.trim(), fenced?.trim(), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }
  return undefined;
}

export const geminiBackend: Backend = {
  async upload(file) {
    return savePdf(file);
  },

  async stream(task, send, signal) {
    await run(task, signal, "", (text) => send({ t: "text", v: text }));
  },

  async structured<T>(task: Task, schema: z.ZodType<T>, signal: AbortSignal) {
    // Antigravity's --json-schema is unreliable in headless runs, so ask for JSON and validate it.
    const jsonSchema = z.toJSONSchema(schema);
    delete jsonSchema.$schema;
    const suffix = `\n\nReply with only one JSON object that matches this JSON Schema: no Markdown fence, no other text.\n${JSON.stringify(jsonSchema)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = schema.safeParse(extractJson(await run(task, signal, suffix)));
      if (parsed.success) return parsed.data;
    }
    throw new BackendError(422, "no_output", "Gemini returned an unexpected result.");
  },
};
