import { backend, errorJson } from "@/lib/backend";

const MAX_BYTES = 32 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return Response.json({ code: "bad_request", message: "Expected a PDF in the 'file' field." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ code: "too_large", message: "PDFs up to 32 MB are supported." }, { status: 413 });
  }
  try {
    return Response.json({ fileId: await (await backend()).upload(file) });
  } catch (error) {
    return errorJson(error);
  }
}
