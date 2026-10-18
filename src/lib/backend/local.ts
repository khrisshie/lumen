import "server-only";
import spawn from "cross-spawn";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BackendError } from "./types";

// Shared by the local CLI backends (Claude Code and Codex): where papers live
// on disk and how a CLI is run. cross-spawn also handles Windows .cmd shims.

export const DATA = process.env.LUMEN_DATA_DIR ?? path.join(os.homedir(), ".lumen");
export const PAPERS = path.join(DATA, "papers");

export function pdfPath(fileId: string): string {
  const hash = /^local_([a-f0-9]{64})$/.exec(fileId)?.[1];
  if (!hash) throw new BackendError(410, "file_missing", "Unknown paper id.");
  return path.join(PAPERS, `${hash}.pdf`);
}

/** Save the PDF under its content hash; the hash is the paper's id. */
export async function savePdf(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileId = `local_${createHash("sha256").update(bytes).digest("hex")}`;
  await mkdir(PAPERS, { recursive: true });
  await writeFile(pdfPath(fileId), bytes);
  return fileId;
}

type RunOptions = {
  input: string;
  signal: AbortSignal;
  /** Called for every JSON line on stdout. */
  onEvent: (event: Record<string, unknown>) => void;
  /** Shown when the binary isn't installed. */
  missing: string;
};

/** Run a CLI that prints JSON lines. Resolves with its exit code and any non-JSON output. */
export function runJsonl(bin: string, args: string[], { input, signal, onEvent, missing }: RunOptions) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(bin, args, { cwd: DATA, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const kill = () => child.kill("SIGTERM");
    signal.addEventListener("abort", kill, { once: true });

    let output = "";
    let buffer = "";
    const line = (text: string) => {
      if (!text.trim()) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(text);
      } catch {
        output += text + "\n"; // plain-text errors land on stdout too
        return;
      }
      onEvent(event);
    };
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(line);
    });
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      signal.removeEventListener("abort", kill);
      reject(error.code === "ENOENT" ? new BackendError(500, "cli_missing", missing) : error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", kill);
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      line(buffer);
      resolve({ code, output });
    });
    child.stdin!.on("error", () => {}); // the CLI may exit before reading all input
    child.stdin!.end(input);
  });
}

const installed = new Map<string, Promise<boolean>>();

/** Whether `bin --version` runs. Cached for the life of the server. */
export function isInstalled(bin: string): Promise<boolean> {
  let pending = installed.get(bin);
  if (!pending) {
    pending = new Promise((resolve) => {
      const child = spawn(bin, ["--version"], { stdio: "ignore", windowsHide: true, timeout: 15_000 });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
    installed.set(bin, pending);
  }
  return pending;
}

/** The last non-empty line of CLI output, for error messages. */
export const lastLine = (output: string, fallback: string) =>
  (output.trim().split("\n").filter(Boolean).at(-1) ?? fallback).slice(0, 500);
