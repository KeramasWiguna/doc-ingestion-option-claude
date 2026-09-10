import type { NextRequest } from "next/server";
import { anthropic } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }

  const metadata = await anthropic.files.upload({ file });

  return Response.json({
    id: metadata.id,
    filename: metadata.filename,
    mimeType: metadata.mime_type,
    sizeBytes: metadata.size_bytes,
    kind: metadata.mime_type.startsWith("image/") ? "image" : "file",
  });
}
