import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SYSTEM } from "../prompts";
import { DATA, lastLine, pdfPath, runJsonl, savePdf } from "./local";
import { BackendError, type Backend, type Task } from "./types";

// Codex backend: runs `codex exec` with your Codex (ChatGPT) login.
//
// Codex can't read PDFs itself, so the server extracts the paper's text once
// (pdf.js, with page markers) and sends it at the start of every prompt. Each
// request is a fresh, ephemeral run; the identical paper prefix lets OpenAI's
// prompt cache skip re-reading it.

export const CODEX_BIN = process.env.CODEX_BIN ?? "codex";
const MODEL = process.env.LUMEN_CODEX_MODEL; // unset = Codex's default model
const TMP = path.join(DATA, "tmp");

const textPath = (fileId: string) => pdfPath(fileId).replace(/\.pdf$/, ".txt");

const extracting = new Map<string, Promise<string>>();

/** The paper's text with "--- Page N ---" markers, extracted on first use. */
function paperText(fileId: string): Promise<string> {
  let pending = extracting.get(fileId);
  if (!pending) {
    pending = loadText(fileId).finally(() => extracting.delete(fileId));
    extracting.set(fileId, pending);
  }
  return pending;
}

async function loadText(fileId: string): Promise<string> {
  try {
    return await readFile(textPath(fileId), "utf8");
  } catch {
    // Not extracted yet.
  }
  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(pdfPath(fileId)));
  } catch {
    throw new BackendError(410, "file_missing", "The paper is no longer on the server.");
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await loading.promise;
  let text = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    text += `--- Page ${n} ---\n`;
    for (const item of content.items) {
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
    }
    text += "\n\n";
  }
  await loading.destroy();
  await writeFile(textPath(fileId), text);
  return text;
}

/** One prompt: instructions, then the paper (a stable prefix), then the conversation. */
async function prompt(task: Task): Promise<string> {
  const paper = await paperText(task.fileId);
  const turns = task.turns.map((t, i) =>
    task.turns.length === 1 ? t.content : `${t.role === "user" ? "Reader" : "Lumen"}${i === task.turns.length - 1 ? " (new message)" : ""}:\n${t.content}`,
  );
  return `${SYSTEM}

The paper's text follows, extracted from the PDF with page markers. Figures are not included: rely on their captions and the surrounding text, and say so when a question needs the figure itself. Everything you need is here, so don't run commands or open files.

<paper>
${paper}
</paper>

${task.turns.length > 1 ? "Our conversation about the paper so far:\n\n" : ""}${turns.join("\n\n")}`;
}

type Run = { messages: string[] };

/** Run `codex exec` once; `onMessage` gets each finished agent message. */
async function run(task: Task, signal: AbortSignal, extra: string[] = [], onMessage?: (text: string) => void): Promise<Run> {
  const input = await prompt(task);
  await mkdir(TMP, { recursive: true });
  const files: string[] = [];
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    // Ignore the user's config (MCP servers, hooks, profiles); the login is still used.
    "--ignore-user-config",
    "--sandbox", "read-only",
    "-C", DATA,
    "-c", `model_reasoning_effort="${task.effort}"`,
    ...(MODEL ? ["-m", MODEL] : []),
    ...extra,
  ];
  try {
    if (task.image) {
      const image = path.join(TMP, `${randomUUID()}.png`);
      await writeFile(image, Buffer.from(task.image.replace(/^data:image\/png;base64,/, ""), "base64"));
      files.push(image);
      args.push("-i", image);
    }
    const result: Run = { messages: [] };
    let failed: string | undefined;
    const { code, output } = await runJsonl(CODEX_BIN, [...args, "-"], {
      input,
      signal,
      missing: `Couldn't find the Codex CLI ("${CODEX_BIN}"). Install Codex or set CODEX_BIN.`,
      onEvent(event) {
        const item = event.item as { type?: string; text?: string } | undefined;
        if (event.type === "item.completed" && item?.type === "agent_message" && item.text) {
          result.messages.push(item.text);
          onMessage?.(item.text);
        } else if (event.type === "turn.failed") {
          failed = (event.error as { message?: string } | undefined)?.message ?? "Codex failed.";
        } else if (event.type === "error" && typeof event.message === "string") {
          failed = event.message;
        }
      },
    });
    if (failed || code !== 0) throw failure(failed ?? output, code);
    return result;
  } finally {
    await Promise.all(files.map((f) => rm(f, { force: true })));
  }
}

function failure(output: string, code: number | null): BackendError {
  if (/not logged in|login|unauthorized|401|authentication/i.test(output)) {
    return new BackendError(401, "auth", "Codex isn't logged in. Run `codex login` in a terminal.");
  }
  if (/usage limit|rate limit|429/i.test(output)) {
    return new BackendError(429, "rate_limit", lastLine(output, "Codex hit a usage limit."));
  }
  return new BackendError(502, "cli", lastLine(output, `Codex exited with code ${code}.`));
}

/** Make a schema acceptable to OpenAI's strict structured outputs. */
function strictSchema(schema: z.ZodType): object {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object" && obj.properties) {
      obj.additionalProperties = false;
      obj.required = Object.keys(obj.properties);
    }
    // Strict mode rejects the safe-integer bounds zod adds to .int().
    if (obj.type === "integer") {
      delete obj.minimum;
      delete obj.maximum;
    }
    Object.values(obj).forEach((v) => (Array.isArray(v) ? v.forEach(visit) : visit(v)));
  };
  visit(json);
  return json;
}

export const codexBackend: Backend = {
  async upload(file) {
    const fileId = await savePdf(file);
    paperText(fileId).catch(() => {});
    return fileId;
  },

  async stream(task, send, signal) {
    // Codex reports whole messages, not tokens, so each arrives at once.
    let first = true;
    await run(task, signal, [], (text) => {
      send({ t: "text", v: first ? text : `\n\n${text}` });
      first = false;
    });
  },

  async structured<T>(task: Task, schema: z.ZodType<T>, signal: AbortSignal) {
    const schemaFile = path.join(TMP, `${randomUUID()}.json`);
    await mkdir(TMP, { recursive: true });
    await writeFile(schemaFile, JSON.stringify(strictSchema(schema)));
    try {
      const { messages } = await run(task, signal, ["--output-schema", schemaFile]);
      let value: unknown;
      try {
        value = JSON.parse(messages.at(-1) ?? "");
      } catch {
        throw new BackendError(422, "no_output", "Codex returned an unexpected result.");
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw new BackendError(422, "no_output", "Codex returned an unexpected result.");
      return parsed.data;
    } finally {
      await rm(schemaFile, { force: true });
    }
  },
};
