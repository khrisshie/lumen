import type { z } from "zod";
import type { ChatTurn, StreamEvent } from "../types";

/** A request about one paper, independent of how Claude is reached. */
export type Task = {
  fileId: string;
  /** Conversation so far; the last turn is the user's. */
  turns: ChatTurn[];
  /** PNG data URL attached to the last user turn. */
  image?: string;
  effort: "low" | "medium";
};

export interface Backend {
  /** Store a PDF and return an id that later tasks can refer to. */
  upload(file: File): Promise<string>;
  stream(task: Task, send: (event: StreamEvent) => void, signal: AbortSignal): Promise<void>;
  structured<T>(task: Task, schema: z.ZodType<T>, signal: AbortSignal): Promise<T>;
}

/** An error with a status and a code the browser can act on (e.g. re-upload on `file_missing`). */
export class BackendError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
