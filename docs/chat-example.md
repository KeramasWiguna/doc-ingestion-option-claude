# Chat example — architecture

Minimal AI chat app: Claude (via LangGraph) + Claude Files API for attachments.

## Pieces

```
app/api/chat/route.ts          POST — runs the graph, streams text back
app/api/files/route.ts         POST — uploads a file to Claude's Files API
app/components/ChatAppLoader.tsx  next/dynamic(ssr:false) wrapper (see below)
app/components/ChatApp.tsx     sessions + cross-session file library, localStorage
app/components/Chat.tsx        client UI for one session (messages, input, attach)
lib/anthropic.ts                Anthropic SDK client + model id
lib/graph.ts                     LangGraph StateGraph (the "agent")
lib/types.ts                      ChatMessage / ChatSession / LibraryFile types
```

## Request flow

1. User types a message, optionally attaches a file first.
2. Attach → `POST /api/files` (multipart) → `anthropic.files.upload({ file })` →
   returns `{ id, filename, mimeType, kind }`. The file now lives on
   Anthropic's servers; the client only holds the `file_id`.
3. Send → `POST /api/chat` with the full message history (`ChatMessage[]`,
   each with optional `attachments: {fileId, kind, name}[]`).
4. `route.ts` converts that into LangChain `BaseMessage[]`. A user message
   with attachments becomes:
   ```ts
   new HumanMessage({
     content: [
       { type: "image", fileId } | { type: "file", fileId },
       { type: "text", text },
     ],
   })
   ```
   `@langchain/anthropic` maps `{type:"file", fileId}` → Anthropic
   `document` block with `source:{type:"file", file_id}`, and
   `{type:"image", fileId}` → an `image` block with the same file-id
   source (see `node_modules/@langchain/anthropic/dist/utils/message_inputs.js`,
   `_isAnthropicImageBlockParam`/file branch — that's the source of truth,
   not this doc, if `@langchain/anthropic` changes shape).
5. `chatGraph.stream(..., { streamMode: "messages" })` yields
   `[AIMessageChunk, metadata]` tuples per token. The route filters to
   `chunk.getType() === "ai"`, pulls text out of `chunk.content`, and
   enqueues it onto a `ReadableStream` — so the response body is plain
   incremental text, not SSE/JSON.
6. `Chat.tsx` reads the response body with `res.body.getReader()` and
   appends each chunk to the last (assistant) message in state.

## The graph (`lib/graph.ts`)

```
START → agent ─(no tool call)→ END
          │
          └─(tool call)→ tools → agent
```

One real node (`agent`, a `ChatAnthropic` call) and one `ToolNode`.
`toolsCondition` (from `@langchain/langgraph/prebuilt`) inspects the last
message for `tool_calls` and routes to `"tools"` or `END`.

**`get_weather` is a placeholder tool**, not a product requirement — it
exists so the graph has something to route on. If you don't need tool
calling, delete `get_weather`/`ToolNode`/the conditional edge and just
`addEdge("agent", END)`; the file-attachment path doesn't depend on it.

Model id lives in `lib/anthropic.ts` (`CLAUDE_MODEL`, currently
`claude-sonnet-5`). Change there, not in `graph.ts`.

## Sessions and cross-session file references (`ChatApp.tsx`)

The app supports multiple chat sessions (sidebar, "+ New session"). This
exists to make one thing visible: **a `file_id` from Claude's Files API
is not scoped to a conversation.** It lives on Anthropic's servers,
independent of any session concept the app layers on top.

- `ChatApp` holds `sessions: ChatSession[]` (each with its own isolated
  `messages`) and one flat `library: LibraryFile[]` — every file ever
  uploaded from *any* session, tagged with which session uploaded it.
  Both are persisted to `localStorage` (browser-only, per-tab; not a
  substitute for a real backend/database — swap in a `BaseCheckpointSaver`
  + a real store if you need this to survive across devices or users).
- In `Chat.tsx`, the 📁 button opens the *entire* library, not just the
  active session's uploads. Picking a file uploaded in "Session 1" while
  composing in "Session 2" attaches that same `file_id` to a brand-new,
  otherwise-unrelated message history.
- The message bubble then shows `(uploaded in "Session 1")` next to the
  attachment if it wasn't uploaded in the session you're viewing — that
  label is purely cosmetic bookkeeping the app added; nothing about the
  Files API call itself changes based on which session is "attaching" it.

**Proof this actually works** (done outside the UI, straight against the
routes, to rule out any client-side sleight of hand):

```bash
# "Session A": upload a file, get its id
curl -s -X POST localhost:3000/api/files -F "file=@secret.txt"
# → {"id":"file_01VW6PjFStWXvJCEHGPpDbjs", ...}

# "Session B": a brand-new /api/chat call with NO shared history,
# referencing that same file_id
curl -s -N -X POST localhost:3000/api/chat -H "Content-Type: application/json" -d '{
  "messages": [{
    "role": "user",
    "content": "What is the secret code word in the attached file?",
    "attachments": [{"fileId":"file_01VW6PjFStWXvJCEHGPpDbjs","kind":"file","name":"secret.txt"}]
  }]
}'
# → BANANA-42
```

Two independent HTTP requests, no shared state between them except the
`file_id` string — Claude reads the file correctly. That's the whole
proof: the id is a handle to server-side storage, not a session-bound
reference.

## Setup

```
cp .env.local.example .env.local
# set ANTHROPIC_API_KEY=sk-ant-...
pnpm dev
```

**Known sharp edge:** `ChatAnthropic`'s constructor throws synchronously
if `ANTHROPIC_API_KEY` isn't resolvable at all (env var, `apiKey` field,
or a gateway config) — see `@langchain/anthropic`'s
`chat_models.js` (`if (!this.anthropicApiKey && !fields?.createClient) throw ...`).
Since `lib/graph.ts` builds the model at module load time, a missing key
crashes the whole `/api/chat` route with a raw 500 on the *first* request
after the dev server (re)starts, not a graceful in-chat error message.
The `/api/files` route fails the same way but later — inside the request,
when `anthropic.files.upload` actually calls out — so it returns your
try/catch-free 500 too (there is no try/catch there currently; add one if
you want a JSON error body instead of a bare 500).

## Extending

- **Persisting conversations**: currently stateless — the client resends
  full history every request, and attachments on assistant turns aren't
  round-tripped (only `content` string is kept, see
  `toLangChainMessages` in `app/api/chat/route.ts`). Add a
  `BaseCheckpointSaver` to `chatGraph` compile step for real persistence.
- **More tools**: add to the `tools` array in `lib/graph.ts`; `ToolNode`
  and `toolsCondition` handle dispatch automatically.
- **Multiple attachments per message**: the UI already supports an array;
  only one `<input type="file">` selection is queued at a time client-side
  (re-open the picker to add more before sending).
- **Why `ChatAppLoader.tsx` exists**: `ChatApp` reads `localStorage`
  synchronously to build its initial state (session list, file library).
  That can't be server-rendered, so `ChatAppLoader` loads it via
  `next/dynamic(..., { ssr: false })` — which only works from a Client
  Component, hence the separate loader instead of putting `ssr: false`
  directly in `page.tsx` (a Server Component). If you add more
  localStorage-dependent state, put it in `ChatApp`, not in a component
  rendered outside that boundary, or you'll hit hydration mismatches.
