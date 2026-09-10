import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage } from "@langchain/core/messages";
import type { NextRequest } from "next/server";
import { chatGraph } from "@/lib/graph";
import type { Attachment, ChatMessage } from "@/lib/types";

function toContentPart(a: Attachment) {
  const kind = a.kind; // "image" | "file" — matches the LangChain content-part type name
  switch (a.mode) {
    case "files-api":
      return { type: kind, fileId: a.fileId };
    case "self-hosted":
      return { type: kind, url: a.url };
    case "base64":
      return { type: kind, data: a.data, mimeType: a.mimeType };
  }
}

function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant") return new AIMessage(m.content);

    if (m.attachments?.length) {
      return new HumanMessage({
        content: [
          ...m.attachments.map(toContentPart),
          { type: "text" as const, text: m.content },
        ],
      });
    }

    return new HumanMessage(m.content);
  });
}

function extractText(content: AIMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block,
    )
    .map((block) => block.text)
    .join("");
}

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as { messages: ChatMessage[] };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      // Usage arrives in pieces across streamed chunks (an estimate on the
      // opening chunk, the real totals on the closing one) — the largest
      // value seen for each field is the final one, see docs/chat-example.md.
      const usage = { inputTokens: 0, outputTokens: 0 };

      try {
        const eventStream = await chatGraph.stream(
          { messages: toLangChainMessages(messages) },
          { streamMode: "messages" },
        );

        for await (const [chunk] of eventStream) {
          if (chunk.getType() !== "ai") continue;
          const aiChunk = chunk as AIMessageChunk;

          const text = extractText(aiChunk.content);
          if (text) send({ type: "token", text });

          const um = aiChunk.usage_metadata;
          if (um) {
            usage.inputTokens = Math.max(usage.inputTokens, um.input_tokens);
            usage.outputTokens = Math.max(usage.outputTokens, um.output_tokens);
          }
        }

        send({ type: "usage", usage });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
