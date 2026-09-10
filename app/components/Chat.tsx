"use client";

import { useRef, useState } from "react";
import type {
  Attachment,
  AttachmentMode,
  ChatMessage,
  ChatSession,
  LibraryFile,
} from "@/lib/types";

type PendingAttachment = Attachment & { uploading: boolean };

type ChatProps = {
  session: ChatSession;
  library: LibraryFile[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  onFileUploaded: (file: LibraryFile) => void;
};

const MODE_LABEL: Record<AttachmentMode, string> = {
  "files-api": "Claude Files API",
  "self-hosted": "Self-hosted URL",
  base64: "Inline base64",
};

// Claude's inline-base64 content blocks only accept these exact MIME
// types (image/jpeg|png|gif|webp, application/pdf) — there's no base64
// slot for plain text. files-api/self-hosted attach by fileId/url instead,
// which aren't restricted this way, so text/plain stays available there.
const BASE64_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];
const MODE_ACCEPT: Record<AttachmentMode, string> = {
  "files-api": "image/*,application/pdf,text/plain",
  "self-hosted": "image/*,application/pdf,text/plain",
  base64: BASE64_MIME_TYPES.join(","),
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // dataURL looks like "data:<mime>;base64,<data>" — we only want the payload
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadForMode(
  mode: AttachmentMode,
  file: File,
): Promise<Omit<Attachment, "mode">> {
  const kind: Attachment["kind"] = file.type.startsWith("image/")
    ? "image"
    : "file";

  if (mode === "base64") {
    const data = await fileToBase64(file);
    return {
      kind,
      name: file.name,
      sizeBytes: file.size,
      data,
      mimeType: file.type || "application/octet-stream",
    };
  }

  const endpoint = mode === "files-api" ? "/api/files" : "/api/upload";
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(endpoint, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();

  return mode === "files-api"
    ? {
        kind: data.kind,
        name: file.name,
        sizeBytes: data.sizeBytes,
        fileId: data.id,
        mimeType: data.mimeType,
      }
    : {
        kind: data.kind,
        name: file.name,
        sizeBytes: data.sizeBytes,
        url: data.url,
        mimeType: data.mimeType,
      };
}

export default function Chat({
  session,
  library,
  onMessagesChange,
  onFileUploaded,
}: ChatProps) {
  const messages = session.messages;
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (session.mode === "base64" && !BASE64_MIME_TYPES.includes(file.type)) {
      alert(
        "Inline base64 only supports JPEG/PNG/GIF/WebP images and PDF — Claude has no base64 slot for plain text.",
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const placeholder: PendingAttachment = {
      mode: session.mode,
      fileId: "",
      kind: file.type.startsWith("image/") ? "image" : "file",
      name: file.name,
      sizeBytes: file.size,
      uploading: true,
    };
    setAttachments((prev) => [...prev, placeholder]);

    try {
      const uploaded = await uploadForMode(session.mode, file);
      const attachment: Attachment = { mode: session.mode, ...uploaded };

      setAttachments((prev) =>
        prev.map((a) => (a === placeholder ? { ...attachment, uploading: false } : a)),
      );
      onFileUploaded({
        ...attachment,
        sessionId: session.id,
        sessionTitle: session.title,
        uploadedAt: Date.now(),
      });
    } catch (err) {
      setAttachments((prev) => prev.filter((a) => a !== placeholder));
      alert(`Attach failed: ${(err as Error).message}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function attachFromLibrary(f: LibraryFile) {
    const key = f.fileId ?? f.url ?? f.data;
    if (attachments.some((a) => (a.fileId ?? a.url ?? a.data) === key)) return;
    setAttachments((prev) => [...prev, { ...f, uploading: false }]);
    setShowLibrary(false);
  }

  function removeAttachment(target: PendingAttachment) {
    setAttachments((prev) => prev.filter((a) => a !== target));
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming) return;
    if (attachments.some((a) => a.uploading)) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      attachments: attachments.map(
        ({ mode, kind, name, sizeBytes, fileId, url, data, mimeType }) => ({
          mode,
          kind,
          name,
          sizeBytes,
          fileId,
          url,
          data,
          mimeType,
        }),
      ),
    };
    const nextMessages = [...messages, userMessage];
    onMessagesChange(nextMessages);
    setInput("");
    setAttachments([]);
    setIsStreaming(true);

    const withPlaceholder = [
      ...nextMessages,
      { role: "assistant" as const, content: "" },
    ];
    onMessagesChange(withPlaceholder);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let buffer = "";
      let usage: ChatMessage["usage"];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            const event = JSON.parse(line) as
              | { type: "token"; text: string }
              | { type: "usage"; usage: { inputTokens: number; outputTokens: number } }
              | { type: "error"; message: string };
            if (event.type === "token") acc += event.text;
            else if (event.type === "usage") usage = event.usage;
            else if (event.type === "error") acc += `\n[error] ${event.message}`;
          }
          onMessagesChange([
            ...nextMessages,
            { role: "assistant", content: acc },
          ]);
        }
      }
      onMessagesChange([
        ...nextMessages,
        { role: "assistant", content: acc, usage },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }

  const modeLibrary = library.filter((f) => f.mode === session.mode);
  const otherSessionFiles = modeLibrary.filter((f) => f.sessionId !== session.id);
  const ownSessionFiles = modeLibrary.filter((f) => f.sessionId === session.id);

  return (
    <div className="flex w-full max-w-3xl flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-black/[.08] pb-2 pt-4 dark:border-white/[.145]">
        <span className="rounded-full border border-black/[.08] px-2.5 py-1 text-xs font-medium text-zinc-500 dark:border-white/[.145] dark:text-zinc-400">
          {MODE_LABEL[session.mode]}
        </span>
        {session.mode === "self-hosted" && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Claude fetches this URL itself — needs a public HTTPS URL, a
            plain <code>localhost</code> dev server will 400
          </span>
        )}
        {session.mode === "base64" && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Images and PDF only — Claude&apos;s inline-base64 format has no
            plain-text slot
          </span>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.length === 0 && (
          <p className="pt-10 text-center text-sm text-zinc-400">
            {modeLibrary.length > 0
              ? "New session, empty history. Try the 📁 button — files attached in other sessions using this same mode are still there."
              : "Say hello, or attach a file to get started."}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                m.role === "user"
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-black/[.04] text-black dark:bg-white/[.08] dark:text-zinc-50"
              }`}
            >
              {m.attachments?.map((a) => {
                const key = a.fileId ?? a.url ?? a.name;
                const fromOther = otherSessionFiles.find(
                  (f) => (f.fileId ?? f.url ?? f.name) === key,
                );
                return (
                  <div key={key} className="mb-1 text-xs opacity-70">
                    📎 {a.name}
                    {fromOther && (
                      <span className="ml-1 italic">
                        (attached in “{fromOther.sessionTitle}”)
                      </span>
                    )}
                  </div>
                );
              })}
              {m.content || (isStreaming && i === messages.length - 1 ? "…" : "")}
              {m.usage && (
                <div className="mt-1 text-[11px] opacity-60">
                  {m.usage.inputTokens} in / {m.usage.outputTokens} out tokens
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showLibrary && (
        <div className="mb-2 max-h-48 overflow-y-auto rounded-xl border border-black/[.08] p-2 text-xs dark:border-white/[.145]">
          {modeLibrary.length === 0 ? (
            <p className="p-2 text-zinc-400">
              No files attached yet in any {MODE_LABEL[session.mode]} session.
            </p>
          ) : (
            <>
              {ownSessionFiles.length > 0 && (
                <div className="mb-1">
                  <p className="px-2 py-1 font-medium text-zinc-500">
                    This session
                  </p>
                  {ownSessionFiles.map((f) => (
                    <LibraryRow
                      key={f.fileId ?? f.url ?? f.name}
                      file={f}
                      onClick={attachFromLibrary}
                    />
                  ))}
                </div>
              )}
              {otherSessionFiles.length > 0 && (
                <div>
                  <p className="px-2 py-1 font-medium text-zinc-500">
                    From other {MODE_LABEL[session.mode]} sessions
                  </p>
                  {otherSessionFiles.map((f) => (
                    <LibraryRow
                      key={f.fileId ?? f.url ?? f.name}
                      file={f}
                      onClick={attachFromLibrary}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {attachments.map((a) => (
            <div
              key={a.fileId || a.url || a.name}
              className="flex items-center gap-2 rounded-full border border-black/[.08] px-3 py-1 text-xs dark:border-white/[.145]"
            >
              <span>{a.uploading ? `Attaching ${a.name}…` : a.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a)}
                className="text-zinc-500 hover:text-black dark:hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="flex items-end gap-2 border-t border-black/[.08] pb-8 pt-4 dark:border-white/[.145]"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={MODE_ACCEPT[session.mode]}
          onChange={handleFileChange}
          className="hidden"
          id="file-upload"
        />
        <label
          htmlFor="file-upload"
          title="Attach a new file"
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-black/[.08] text-lg dark:border-white/[.145]"
        >
          +
        </label>
        <button
          type="button"
          title="Attach a file already used in this mode (any session)"
          onClick={() => setShowLibrary((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[.08] text-lg dark:border-white/[.145]"
        >
          📁
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          rows={1}
          placeholder="Message Claude…"
          className="flex-1 resize-none rounded-2xl border border-black/[.08] bg-transparent px-4 py-2 text-sm outline-none dark:border-white/[.145]"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="h-10 shrink-0 rounded-full bg-foreground px-5 text-sm font-medium text-background disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function LibraryRow({
  file,
  onClick,
}: {
  file: LibraryFile;
  onClick: (f: LibraryFile) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(file)}
      className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-black/[.04] dark:hover:bg-white/[.08]"
    >
      <span>
        {file.kind === "image" ? "🖼️" : "📄"} {file.name}
      </span>
      <span className="text-zinc-400">{file.fileId ?? file.url ?? "inline"}</span>
    </button>
  );
}
