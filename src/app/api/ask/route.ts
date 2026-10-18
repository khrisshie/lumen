import { BackendError, backend } from "@/lib/backend";
import { askTask } from "@/lib/prompts";
import type { AskRequest, StreamEvent } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as AskRequest;
  if (!body?.fileId) {
    return Response.json({ code: "bad_request", message: "fileId is required." }, { status: 400 });
  }
  if (body.kind === "chat" && body.history.at(-1)?.role !== "user") {
    return Response.json({ code: "bad_request", message: "Chat history must end with a user turn." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await (await backend()).stream(askTask(body), send, request.signal);
        send({ t: "done" });
      } catch (error) {
        if (!request.signal.aborted) {
          const e = error instanceof BackendError ? error : new BackendError(500, "internal", String(error));
          send({ t: "error", code: e.code, v: e.message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
