import "server-only";
import { apiBackend } from "./api";
import { CLAUDE_BIN, cliBackend } from "./cli";
import { CODEX_BIN, codexBackend } from "./codex";
import { isInstalled } from "./local";
import { BackendError, type Backend } from "./types";

/**
 * LUMEN_BACKEND=api|claude|codex picks explicitly ("cli" is an alias for claude).
 * Otherwise: the Claude API when a key is configured, then whichever of the
 * Claude Code and Codex CLIs is installed, in that order.
 */
export async function backend(): Promise<Backend> {
  const choice = process.env.LUMEN_BACKEND;
  if (choice === "api") return apiBackend;
  if (choice === "claude" || choice === "cli") return cliBackend;
  if (choice === "codex") return codexBackend;
  if (process.env.ANTHROPIC_API_KEY) return apiBackend;
  if (await isInstalled(CLAUDE_BIN)) return cliBackend;
  if (await isInstalled(CODEX_BIN)) return codexBackend;
  throw new BackendError(
    500,
    "cli_missing",
    "Lumen needs Claude Code or Codex. Install one, log in, then restart Lumen.",
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
