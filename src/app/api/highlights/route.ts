import { backend, errorJson } from "@/lib/backend";
import { HighlightsSchema, highlightsTask } from "@/lib/prompts";

export async function POST(request: Request) {
  const { fileId, lang } = (await request.json()) as { fileId: string; lang: string };
  try {
    const { highlights } = await (await backend()).structured(highlightsTask(fileId, lang), HighlightsSchema, request.signal);
    return Response.json(highlights);
  } catch (error) {
    return errorJson(error);
  }
}
