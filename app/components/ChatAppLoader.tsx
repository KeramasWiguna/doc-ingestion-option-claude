"use client";

import dynamic from "next/dynamic";

// ChatApp reads localStorage synchronously during render (session list,
// cross-session file library) — no server render to produce for it.
const ChatApp = dynamic(() => import("@/app/components/ChatApp"), {
  ssr: false,
});

export default function ChatAppLoader() {
  return <ChatApp />;
}
