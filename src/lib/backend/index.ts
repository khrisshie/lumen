import "server-only";
import { apiBackend } from "./api";
import { CLAUDE_BIN, cliBackend } from "./cli";
import { CODEX_BIN, codexBackend } from "./codex";
import { AGY_BIN, geminiBackend } from "./gemini";
import { isInstalled } from "./local";
import { BackendError, type Backend } from "./types";

/**
 * LUMEN_BACKEND=api|claude|codex|gemini picks explicitly ("cli" is an alias for claude).
 * Otherwise: the Claude API when a key is configured, then the first installed of
 * Claude Code, Codex and Antigravity (Gemini).
 */
export async function backend(): Promise<Backend> {
  const choice = process.env.LUMEN_BACKEND;
  if (choice === "api") return apiBackend;
  if (choice === "claude" || choice === "cli") return cliBackend;
  if (choice === "codex") return codexBackend;
  if (choice === "gemini" || choice === "antigravity") return geminiBackend;
  if (process.env.ANTHROPIC_API_KEY) return apiBackend;
  if (await isInstalled(CLAUDE_BIN)) return cliBackend;
  if (await isInstalled(CODEX_BIN)) return codexBackend;
  if (await isInstalled(AGY_BIN)) return geminiBackend;
  throw new BackendError(
    500,
    "cli_missing",
    "Lumen needs Claude Code, Codex or Antigravity (Gemini). Install one, sign in, then restart Lumen.",
  );
}

export function errorJson(error: unknown) {
  const e =
    error instanceof BackendError
      ? error
      : new BackendError(500, "internal", error instanceof Error ? error.message : "Unknown error");
  return Response.json({ code: e.code, message: e.message }, { status: e.status });
}

export { BackendError };
