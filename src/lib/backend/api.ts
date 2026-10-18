import "server-only";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { SYSTEM } from "../prompts";
import { BackendError, type Backend, type Task } from "./types";

// Claude API backend: used when ANTHROPIC_API_KEY is set.

const MODEL = "claude-opus-5-5";

// Server-side refusal fallback: if a safety classifier declines, the API
// re-runs the request on a suitable fallback model inside the same call.
const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic());

function messages(task: Task): Anthropic.Beta.BetaMessageParam[] {
  const last = task.turns.length - 1;
  return task.turns.map((turn, i): Anthropic.Beta.BetaMessageParam => {
    if (turn.role === "assistant") return { role: "assistant", content: turn.content };
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    // The paper rides on the first user turn so system + paper is a stable cached prefix.
    if (i === 0) {
      content.push({
        type: "document",
        source: { type: "file", file_id: task.fileId },
        cache_control: { type: "ephemeral", ttl: "1h" },
      });
    }
    if (i === last && task.image) {
      const data = task.image.replace(/^data:image\/png;base64,/, "");
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data } });
    }
    content.push({ type: "text", text: turn.content });
    return { role: "user", content };
  });
}

function toBackendError(error: unknown): BackendError {
  if (error instanceof Anthropic.NotFoundError) {
    return new BackendError(410, "file_missing", "The uploaded paper is no longer available.");
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new BackendError(401, "auth", "Invalid ANTHROPIC_API_KEY on the server.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new BackendError(429, "rate_limit", "Rate limited. Try again in a moment.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new BackendError(400, "bad_request", error.message);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new BackendError(502, "network", "Could not reach the Claude API.");
  }
  if (error instanceof Anthropic.APIError) {
    return new BackendError(error.status ?? 502, "api", error.message);
  }
  return new BackendError(500, "internal", error instanceof Error ? error.message : "Unknown error");
}

export const apiBackend: Backend = {
  async upload(file) {
    try {
      const uploaded = await getClient().files.upload({
        file: await toFile(Buffer.from(await file.arrayBuffer()), file.name, { type: "application/pdf" }),
      });
      return uploaded.id;
    } catch (error) {
      throw toBackendError(error);
    }
  },

  async stream(task, send, signal) {
    try {
      const response = getClient().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          betas: BETAS,
          fallbacks: "default",
          output_config: { effort: task.effort },
          system: SYSTEM,
          messages: messages(task),
        },
        { signal },
      );
      for await (const event of response) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          send({ t: "text", v: event.delta.text });
        }
      }
      const final = await response.finalMessage();
      if (final.stop_reason === "refusal") send({ t: "notice", v: "Claude declined to answer this request." });
      else if (final.stop_reason === "max_tokens") send({ t: "notice", v: "The answer was cut off at the length limit." });
    } catch (error) {
      throw toBackendError(error);
    }
  },

  async structured(task, schema, signal) {
    try {
      const response = await getClient().beta.messages.parse(
        {
          model: MODEL,
          max_tokens: 16000,
          betas: BETAS,
          fallbacks: "default",
          output_config: { effort: task.effort, format: betaZodOutputFormat(schema) },
          system: SYSTEM,
          messages: messages(task),
        },
        { signal },
      );
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        throw new BackendError(422, "no_output", "Claude could not produce this result.");
      }
      return response.parsed_output;
    } catch (error) {
      throw error instanceof BackendError ? error : toBackendError(error);
    }
  },
};
