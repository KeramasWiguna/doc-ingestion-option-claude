# Claude Files API

Reference for the Files API used in `lib/anthropic.ts` / `app/api/files/route.ts`.
Facts below are pulled straight from the installed SDK types
(`node_modules/@anthropic-ai/sdk/resources/files.d.ts`) — check that file
if a field looks wrong, it's the source of truth, not this doc.

## What it is

Upload a file once, get back a `file_id`, reference that id from any
number of later `messages.create()` calls instead of re-sending base64
bytes every time. No beta header needed (`client.files.*`, not
`client.beta.files.*` — the beta namespace is an older, breaking-different
shape).

## Endpoints (`client.files.*`)

| Method | Call | Notes |
|---|---|---|
| Upload | `client.files.upload({ file })` | `file` is anything `Uploadable` — a web `File`/`Blob` works directly (that's what `app/api/files/route.ts` passes from `formData.get("file")`). |
| List | `client.files.list()` | Auto-paginates. Optional `ids` filter (max 100). |
| Get metadata | `client.files.retrieveMetadata(fileId)` | No content, just the record below. |
| Download | `client.files.download(fileId)` | Returns a `Response`; `.blob()` for bytes. Only works if `downloadable` is true. |
| Delete | `client.files.delete(fileId)` | Permanent. |

### Upload params

- `file` (required)
- `expires_in_seconds` — optional, **3600 to 7,776,000** (1 hour to 90
  days). Omit for no expiry.
- `workspace_id` — only needed if your credential spans multiple
  workspaces.

### What you get back (`FileMetadata`)

```ts
{
  id: string;
  created_at: string;      // RFC 3339
  filename: string;
  mime_type: string;
  size_bytes: number;
  type: "file";
  downloadable?: boolean;
  expires_at?: string | null;
}
```

## Referencing an uploaded file in a message

Content-block `type` must match the file's MIME type:

```ts
// PDF / text document
{ type: "document", source: { type: "file", file_id: "file_..." } }

// image
{ type: "image", source: { type: "file", file_id: "file_..." } }
```

In this project you don't write that shape by hand — `@langchain/anthropic`
builds it from `{ type: "file", fileId }` / `{ type: "image", fileId }`
LangChain content parts (see `docs/chat-example.md`).

## What it's for

- Multi-turn chat with the same document/image without re-uploading or
  re-paying upload-side tokens per turn.
- Large files you don't want inlined as base64 in every request body.
- Files produced by the **code execution** tool (sandbox writes a file →
  you get a `file_id` back → download it, or feed it into a later turn).
- Sharing one uploaded file across multiple independent conversations.

## Limits / gotchas

- Files can expire (`expires_at`) — a stale `file_id` in a saved
  conversation will eventually 404. This app doesn't persist history, so
  it isn't hit, but a real app storing `file_id`s long-term needs to
  handle "file no longer exists."
- `downloadable` isn't always true — don't assume every uploaded file
  can be read back via `.download()`.
- Deleting is permanent; there's no soft-delete/undo.

---

## Tracing what actually happened: LangSmith and its blind spot

**Why LangSmith isn't showing you the full response:** LangSmith traces
*LangChain's* representation of the call — the `BaseMessage`/
`AIMessageChunk` objects going in and out of `ChatAnthropic.invoke()` —
not the raw Anthropic HTTP request/response body. `@langchain/anthropic`
normalizes provider-specific blocks (file references, `cache_control`,
some tool-use metadata) into its own shape before LangSmith ever sees it,
and streaming chunks get merged/summarized in the trace UI. So anything
that lives only in the raw Anthropic response — exact `document`/`image`
source blocks as sent, `usage.cache_read_input_tokens`, the literal
`stop_reason`/`stop_details` object shape, etc. — is either translated,
dropped, or buried in a nested `additional_kwargs` field rather than
shown plainly.

Ways to see the ground truth instead:

1. **`ANTHROPIC_LOG=debug`** — set this env var (or pass
   `logLevel: "debug"` to the `Anthropic` client, or via
   `ChatAnthropic({ clientOptions: { logLevel: "debug" } })` since
   `clientOptions` passes straight through to the underlying SDK client).
   Prints the full outgoing request and incoming response — headers,
   body, everything — to stderr. This is the actual wire traffic, not a
   framework's interpretation of it. Best tool for "what did the file
   block actually look like."

2. **Bypass LangChain for a one-off check** — call
   `anthropic.messages.create(...)` directly (the client already in
   `lib/anthropic.ts`) with the same file_id and log `response` as JSON.
   Confirms whether an issue is in the Anthropic response or in
   LangChain's mapping of it.

3. **Anthropic Console → Files** — lists every file you've uploaded
   (id, filename, mime type, size, expiry) independent of any
   conversation. Good for confirming an upload actually landed and isn't
   expired, when a trace makes you doubt it.

4. **`client.files.list()` / `retrieveMetadata(id)`** — same data as #3,
   scriptable. Useful for a debug route or a one-off Node script when you
   want to check file state without opening the Console.

5. **LangSmith, but check the right tab** — a run's "Raw" or metadata
   panel (not the default input/output view) sometimes surfaces
   `additional_kwargs`/`response_metadata` with more of the original
   payload than the summarized view. Worth checking before assuming
   LangSmith has nothing — it has more than it shows by default, just not
   the literal HTTP body.

Practical default: reach for #1 (`ANTHROPIC_LOG=debug`) first when you
need to know exactly what Claude received or returned — it's the only
option here that isn't going through an abstraction layer that can
reshape the data.
