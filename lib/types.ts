/**
 * The three ways this app can get file bytes in front of Claude. Each
 * `ChatSession` is pinned to one mode so the benchmark page can compare
 * them apples-to-apples.
 *
 * - "files-api": upload once to Claude's Files API, reference by `fileId`
 *   on every later turn.
 * - "self-hosted": upload to this app's own `/api/upload`, reference by
 *   `url` — Claude fetches the bytes itself. Only works when this app is
 *   reachable from Anthropic's servers (deployed/tunneled); a `localhost`
 *   URL will 400 at request time.
 * - "base64": no upload at all, the file is read client-side and its raw
 *   base64 bytes are embedded directly in every request.
 */
export type AttachmentMode = "files-api" | "self-hosted" | "base64";

export type Attachment = {
  mode: AttachmentMode;
  kind: "image" | "file";
  name: string;
  sizeBytes: number;
  fileId?: string; // files-api
  url?: string; // self-hosted
  data?: string; // base64 (base64 mode) — raw, no data: prefix
  mimeType?: string; // required for base64, kept for self-hosted too
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  /** Usage for this turn's model call. Only ever set on assistant messages. */
  usage?: TokenUsage;
};

export type ChatSession = {
  id: string;
  title: string;
  mode: AttachmentMode;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

/**
 * A file that has been uploaded/attached once. `sessionId` / `sessionTitle`
 * only record *where the app's UI attached it from* — for files-api and
 * self-hosted modes the underlying handle (file_id / URL) is valid from any
 * session, in any later request, same as the base library concept this app
 * started with. Base64 "handles" are just the raw bytes, so reusing one
 * from the library re-embeds those same bytes rather than pointing at any
 * server-side storage.
 */
export type LibraryFile = Attachment & {
  sessionId: string;
  sessionTitle: string;
  uploadedAt: number;
};
