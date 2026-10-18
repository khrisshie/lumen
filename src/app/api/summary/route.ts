import { backend, errorJson } from "@/lib/backend";
import { SummarySchema, summaryTask } from "@/lib/prompts";

export async function POST(request: Request) {
  const { fileId, lang } = (await request.json()) as { fileId: string; lang: string };
  try {
    return Response.json(await (await backend()).structured(summaryTask(fileId, lang), SummarySchema, request.signal));
  } catch (error) {
    return errorJson(error);
  }
}
