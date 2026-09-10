import { randomUUID } from "node:crypto";
import path from "node:path";
import { put } from "@vercel/blob";
import type { NextRequest } from "next/server";

// Self-hosted counterpart to /api/files: instead of handing the bytes to
// Claude's Files API, they're pushed to Vercel Blob and served back out as
// a public HTTPS URL. Claude is given that URL (`source: { type: "url" }`)
// and fetches the bytes itself at request time — this works even from
// local dev since the blob URL is public regardless of where this app runs.
// Requires BLOB_READ_WRITE_TOKEN in the environment (see .env.local.example).

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }

  const ext = path.extname(file.name);
  const storedName = `${randomUUID()}${ext}`;
  const mimeType = file.type || "application/octet-stream";

  const blob = await put(storedName, file, {
    access: "public",
    contentType: mimeType,
  });

  return Response.json({
    url: blob.url,
    filename: file.name,
    mimeType,
    sizeBytes: file.size,
    kind: mimeType.startsWith("image/") ? "image" : "file",
  });
}
