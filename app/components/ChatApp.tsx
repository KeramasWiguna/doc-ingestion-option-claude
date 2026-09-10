"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Chat from "@/app/components/Chat";
import type { AttachmentMode, ChatMessage, ChatSession, LibraryFile } from "@/lib/types";

const STORAGE_KEY = "claude-file-api-demo-v2";

type PersistedState = {
  sessions: ChatSession[];
  library: LibraryFile[];
  activeId: string;
};

const MODES: { mode: AttachmentMode; label: string }[] = [
  { mode: "files-api", label: "Files API" },
  { mode: "self-hosted", label: "Self-hosted URL" },
  { mode: "base64", label: "Inline base64" },
];

const MODE_BADGE: Record<AttachmentMode, string> = {
  "files-api": "📁 Files API",
  "self-hosted": "🔗 Self-hosted",
  base64: "🧬 Base64",
};

function newSession(mode: AttachmentMode, n: number): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: `${MODES.find((m) => m.mode === mode)!.label} ${n}`,
    mode,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

// Base64-mode attachments embed raw file bytes straight into message
// content — fine to hold in memory for the live tab, but a few of those
// will blow past localStorage's ~5-10MB quota. Strip the bytes (and drop
// base64 library entries outright, since a reused "handle" IS the bytes)
// before persisting; the in-memory state for the current tab is untouched.
function forStorage(state: PersistedState): PersistedState {
  return {
    ...state,
    library: state.library.filter((f) => f.mode !== "base64"),
    sessions: state.sessions.map((s) => ({
      ...s,
      messages: s.messages.map((m) => ({
        ...m,
        attachments: m.attachments?.map((a) =>
          a.mode === "base64" ? { ...a, data: undefined } : a,
        ),
      })),
    })),
  };
}

// Only ever runs client-side — this component is loaded via
// `next/dynamic(..., { ssr: false })` in ChatAppLoader.tsx, so there's no
// server render to hydrate against and no window-undefined case to guard.
function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PersistedState) : null;
    if (parsed?.sessions?.length) {
      return {
        // older localStorage shape predates `updatedAt` — backfill from
        // createdAt so the sidebar has something to show
        sessions: parsed.sessions.map((s) => ({
          ...s,
          updatedAt: s.updatedAt ?? s.createdAt,
        })),
        library: parsed.library ?? [],
        activeId: parsed.activeId ?? parsed.sessions[0].id,
      };
    }
  } catch {
    // corrupt/old localStorage shape — fall through to a fresh session
  }
  const first = newSession("files-api", 1);
  return { sessions: [first], library: [], activeId: first.id };
}

export default function ChatApp() {
  const [state, setState] = useState<PersistedState>(loadInitialState);
  const { sessions, library, activeId } = state;

  // Persist on every change. Writing to an external system from an effect
  // (no setState here) is exactly what effects are for.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(forStorage(state)));
    } catch {
      // quota exceeded (e.g. a large base64 turn before it was pruned) —
      // the live tab keeps working, it just won't survive a reload
    }
  }, [state]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  function updateMessages(sessionId: string, messages: ChatMessage[]) {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, messages, updatedAt: Date.now() };
      }),
    }));
  }

  function addSession(mode: AttachmentMode) {
    setState((prev) => {
      const countForMode = prev.sessions.filter((s) => s.mode === mode).length;
      const s = newSession(mode, countForMode + 1);
      return { ...prev, sessions: [...prev.sessions, s], activeId: s.id };
    });
  }

  function removeSession(id: string) {
    setState((prev) => {
      const next = prev.sessions.filter((s) => s.id !== id);
      if (next.length === 0) {
        const s = newSession("files-api", 1);
        return { ...prev, sessions: [s], activeId: s.id };
      }
      return {
        ...prev,
        sessions: next,
        activeId: id === prev.activeId ? next[0].id : prev.activeId,
      };
    });
  }

  function setActiveId(id: string) {
    setState((prev) => ({ ...prev, activeId: id }));
  }

  function addLibraryFile(file: LibraryFile) {
    setState((prev) => ({ ...prev, library: [...prev.library, file] }));
  }

  return (
    <div className="flex h-full w-full max-w-5xl flex-1">
      <aside className="flex w-60 shrink-0 flex-col border-r border-black/[.08] py-6 pr-4 dark:border-white/[.145]">
        <p className="mb-2 text-xs font-medium text-zinc-500">New session</p>
        <div className="mb-4 flex flex-col gap-1.5">
          {MODES.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => addSession(mode)}
              className="rounded-full border border-black/[.08] px-3 py-1.5 text-left text-sm font-medium hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.08]"
            >
              + {label}
            </button>
          ))}
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                s.id === activeId
                  ? "bg-black/[.06] font-medium dark:bg-white/[.1]"
                  : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                className="flex-1 truncate text-left"
              >
                <span className="block truncate">{s.title}</span>
                <span className="block text-[11px] font-normal text-zinc-400">
                  {MODE_BADGE[s.mode]} · {formatRelativeTime(s.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeSession(s.id)}
                className="ml-2 hidden text-zinc-400 hover:text-black group-hover:block dark:hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <Link
          href="/benchmark"
          className="mt-4 rounded-full border border-black/[.08] px-3 py-1.5 text-center text-sm font-medium hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.08]"
        >
          📊 Benchmark
        </Link>
        <p className="pt-3 text-xs text-zinc-400">
          {library.length} file{library.length === 1 ? "" : "s"} attached
          across all sessions.
        </p>
      </aside>

      <div className="flex flex-1 flex-col items-center px-4">
        <Chat
          key={active.id}
          session={active}
          library={library}
          onMessagesChange={(messages) => updateMessages(active.id, messages)}
          onFileUploaded={addLibraryFile}
        />
      </div>
    </div>
  );
}
