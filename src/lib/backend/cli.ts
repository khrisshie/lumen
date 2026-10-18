import "server-only";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SYSTEM } from "../prompts";
import { DATA, lastLine, pdfPath, runJsonl, savePdf } from "./local";
import { BackendError, type Backend, type Task } from "./types";

// Claude Code backend: runs `claude -p` with your Claude Code login, no API key needed.
//
// Each paper is read once into a "primed" session. Every request then resumes
// that session with --fork-session, so the paper is already in context (and in
// the prompt cache) and the primed session itself never changes.

const SESSIONS = path.join(DATA, "sessions.json");
const SYSTEM_FILE = path.join(DATA, "system-prompt.md");
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const MODEL = process.env.LUMEN_MODEL; // unset = your Claude Code default model

// The system prompt goes in a file: multi-line arguments don't survive Windows .cmd shims.
let systemFile: Promise<void> | undefined;
const writeSystemFile = () =>
  (systemFile ??= mkdir(DATA, { recursive: true }).then(() => writeFile(SYSTEM_FILE, SYSTEM)));

function baseArgs(effort: Task["effort"]): string[] {
  return [
    "-p",
    "--system-prompt-file", SYSTEM_FILE,
    "--tools", "Read",
    "--effort", effort,
    // Keep the session lean: no user plugins, hooks or MCP servers.
    "--setting-sources", "project",
    "--settings", JSON.stringify({ disableAllHooks: true }),
    "--strict-mcp-config",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    ...(MODEL ? ["--model", MODEL] : []),
  ];
}

const forkArgs = (session: string) => ["--resume", session, "--fork-session", "--no-session-persistence"];

/** The user message, as a stream-json input line. Chat history is folded into one turn. */
function inputLine(task: Task): string {
  const last = task.turns[task.turns.length - 1];
  let text = last.content;
  if (task.turns.length > 1) {
    const transcript = task.turns
      .slice(0, -1)
      .map((t) => `${t.role === "user" ? "Reader" : "Lumen"}:\n${t.content}`)
      .join("\n\n");
    text = `Our conversation about the paper so far:\n\n${transcript}\n\nReader's new message:\n${last.content}`;
  }
  const content: object[] = [];
  if (task.image) {
    const data = task.image.replace(/^data:image\/png;base64,/, "");
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data } });
  }
  content.push({ type: "text", text });
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

type ResultEvent = { type: "result"; subtype: string; is_error: boolean; result?: string; structured_output?: unknown };

/** Run `claude -p`, feeding each stream-json event to `onLine`; resolves with the final result event. */
async function run(args: string[], input: string, signal: AbortSignal, onLine?: (event: Record<string, unknown>) => void) {
  await writeSystemFile();
  let result: ResultEvent | undefined;
  const { code, output } = await runJsonl(CLAUDE_BIN, args, {
    input,
    signal,
    missing: `Couldn't find the Claude Code CLI ("${CLAUDE_BIN}"). Install Claude Code or set CLAUDE_BIN.`,
    onEvent(event) {
      if (event.type === "result") result = event as ResultEvent;
      onLine?.(event);
    },
  });
  if (!result || result.is_error || result.subtype !== "success") {
    throw failure(result?.result || output || `Claude Code exited with code ${code}.`);
  }
  return result;
}

function failure(output: string): BackendError {
  if (output.includes("No conversation found")) {
    return new BackendError(409, "session_missing", "The paper's session is gone.");
  }
  if (/not logged in|\/login|invalid api key|authentication/i.test(output)) {
    return new BackendError(401, "auth", "Claude Code isn't logged in. Run `claude` in a terminal and use /login.");
  }
  return new BackendError(502, "cli", lastLine(output, "Claude Code exited with an error."));
}

/* -------------------------------- Sessions -------------------------------- */

let sessionsWrite = Promise.resolve();

async function loadSessions(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(SESSIONS, "utf8"));
  } catch {
    return {};
  }
}

function saveSession(fileId: string, session: string) {
  sessionsWrite = sessionsWrite.then(async () => {
    const all = await loadSessions();
    all[fileId] = session;
    await writeFile(SESSIONS, JSON.stringify(all, null, 2));
  });
  return sessionsWrite;
}

const priming = new Map<string, Promise<string>>();

/** The session that has read this paper, creating it if needed. */
async function sessionFor(fileId: string, refresh = false): Promise<string> {
  if (!refresh) {
    const known = (await loadSessions())[fileId];
    if (known) return known;
  }
  let pending = priming.get(fileId);
  if (!pending) {
    pending = prime(fileId).finally(() => priming.delete(fileId));
    priming.set(fileId, pending);
  }
  return pending;
}

async function prime(fileId: string): Promise<string> {
  const file = pdfPath(fileId);
  try {
    await access(file);
  } catch {
    throw new BackendError(410, "file_missing", "The paper is no longer on the server.");
  }
  const session = randomUUID();
  const rel = `./${path.relative(DATA, file).split(path.sep).join("/")}`;
  const task: Task = {
    fileId,
    effort: "low",
    turns: [
      {
        role: "user",
        content: `Read the research paper at ${rel} in full: every page, including figures, tables and equations. If one Read call can't return the whole PDF, read consecutive page ranges until you've covered all of it. Questions about the paper will follow. When you're done, reply only: READY`,
      },
    ],
  };
  await run([...baseArgs("low"), "--session-id", session], inputLine(task), new AbortController().signal);
  await saveSession(fileId, session);
  return session;
}

/** Run against the paper's session, re-reading the paper once if the session vanished. */
async function withSession<T>(fileId: string, call: (session: string) => Promise<T>, canRetry: () => boolean): Promise<T> {
  try {
    return await call(await sessionFor(fileId));
  } catch (error) {
    if (error instanceof BackendError && error.code === "session_missing" && canRetry()) {
      return call(await sessionFor(fileId, true));
    }
    throw error;
  }
}

/* --------------------------------- Backend -------------------------------- */

export const cliBackend: Backend = {
  async upload(file) {
    const fileId = await savePdf(file);
    // Start reading the paper now so the first question is fast.
    sessionFor(fileId).catch(() => {});
    return fileId;
  },

  async stream(task, send, signal) {
    let sent = false;
    await withSession(
      task.fileId,
      async (session) => {
        let messageHasText = false;
        const args = [...baseArgs(task.effort), ...forkArgs(session), "--include-partial-messages"];
        await run(args, inputLine(task), signal, (line) => {
          if (line.type !== "stream_event") return;
          const event = line.event as { type: string; delta?: { type: string; text?: string } };
          if (event.type === "message_start" && messageHasText) {
            // Text from a later turn (e.g. after a tool call) starts a new paragraph.
            send({ t: "text", v: "\n\n" });
            messageHasText = false;
          }
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            sent = messageHasText = true;
            send({ t: "text", v: event.delta.text });
          }
        });
      },
      () => !sent,
    );
  },

  async structured<T>(task: Task, schema: z.ZodType<T>, signal: AbortSignal) {
    return withSession(
      task.fileId,
      async (session) => {
        // The CLI's validator doesn't know zod's draft-2020-12 meta-schema URI; the schema body is fine.
        const jsonSchema = z.toJSONSchema(schema);
        delete jsonSchema.$schema;
        const args = [...baseArgs(task.effort), ...forkArgs(session), "--json-schema", JSON.stringify(jsonSchema)];
        const result = await run(args, inputLine(task), signal);
        const parsed = schema.safeParse(result.structured_output);
        if (!parsed.success) throw new BackendError(422, "no_output", "Claude returned an unexpected result.");
        return parsed.data;
      },
      () => true,
    );
  },
};
