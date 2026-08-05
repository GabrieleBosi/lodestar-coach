"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import SignOutButton from "@/components/SignOutButton";
import { readTurnStream } from "@/lib/chat-stream";

interface Citation {
  n: number;
  chunkId?: string;
  title: string | null;
  sourceUrl: string | null;
  heading: string | null;
}

interface AgentAction {
  name: string;
  ok?: boolean;
  summary?: string;
  error?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  actions?: AgentAction[];
}

interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export default function ChatWorkspace({ userEmail }: { userEmail: string }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) {
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations ?? []);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function updateMessage(id: string, updater: (m: ChatMessage) => ChatMessage) {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }

  async function loadConversation(id: string) {
    setConversationId(id);
    const res = await fetch(`/api/conversations?id=${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: {
        id: string;
        role: string;
        content: string | null;
        citations: unknown;
        tool_calls: unknown;
      }[];
    };
    setMessages(
      data.messages.map((m) => ({
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content ?? "",
        citations: Array.isArray(m.citations) ? (m.citations as Citation[]) : undefined,
        actions: Array.isArray(m.tool_calls) ? (m.tool_calls as AgentAction[]) : undefined,
      })),
    );
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setInput("");
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setStreaming(true);
    setMessages((prev) => [...prev, { id: newId(), role: "user", content: text }]);

    const assistantId = newId();
    let assistantAdded = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: `⚠️ ${err.error ?? "Request failed"}` },
        ]);
        return;
      }

      await readTurnStream(res.body, {
        onStart: (cid) => {
          setConversationId(cid);
          setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
          assistantAdded = true;
        },
        onText: (t) => updateMessage(assistantId, (m) => ({ ...m, content: m.content + t })),
        onMeta: (meta) =>
          updateMessage(assistantId, (m) => ({
            ...m,
            citations: meta.sources,
            actions: meta.actions,
          })),
      });
    } catch {
      if (!assistantAdded) {
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: "⚠️ Something went wrong." },
        ]);
      }
    } finally {
      setStreaming(false);
      void refreshConversations();
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const sources = lastAssistant?.citations ?? [];

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col px-4 py-4">
      <header className="flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Lodestar</h1>
          <p className="text-xs text-stone-500 dark:text-stone-400">{userEmail}</p>
        </div>
        <nav className="flex flex-wrap items-center justify-end gap-1.5">
          <Link
            href="/profile"
            className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Profile
          </Link>
          <Link
            href="/memories"
            className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Memory
          </Link>
          <SignOutButton />
        </nav>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 py-4 md:grid-cols-[200px_1fr_260px]">
        {/* Conversation history */}
        <aside className="hidden min-h-0 flex-col md:flex">
          <button
            type="button"
            onClick={startNewChat}
            className="mb-3 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            + New chat
          </button>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => loadConversation(c.id)}
                className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800 ${
                  c.id === conversationId ? "bg-stone-100 font-medium dark:bg-stone-800" : ""
                }`}
                title={c.title ?? "Untitled"}
              >
                {c.title ?? "Untitled"}
              </button>
            ))}
          </div>
        </aside>

        {/* Transcript + composer */}
        <section className="flex min-h-0 flex-col rounded-xl border border-stone-200 dark:border-stone-800">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="mt-10 text-center text-sm text-stone-500 dark:text-stone-400">
                Ask about training, nutrition, or recovery — answers are grounded in the knowledge
                base and cited.
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}
              >
                {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {m.actions.map((a, i) => (
                      <span
                        key={i}
                        title={a.error ?? a.summary ?? a.name}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          a.ok === false
                            ? "border-red-300 text-red-600 dark:border-red-900 dark:text-red-400"
                            : "border-stone-300 text-stone-500 dark:border-stone-700 dark:text-stone-400"
                        }`}
                      >
                        {a.ok === false ? "⚠ " : "⚙ "}
                        {a.summary ?? a.name}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "self-end bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                      : "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                  }`}
                >
                  {m.content || (streaming ? "…" : "")}
                </div>
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex gap-2 border-t border-stone-200 p-3 dark:border-stone-800"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="How should I structure a deload week?"
              disabled={streaming}
              className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              {streaming ? "…" : "Send"}
            </button>
          </form>
        </section>

        {/* Sources panel */}
        <aside className="hidden min-h-0 flex-col rounded-xl border border-stone-200 p-3 md:flex dark:border-stone-800">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Sources
          </h2>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {sources.length === 0 ? (
              <p className="text-xs text-stone-400">Citations for the latest answer appear here.</p>
            ) : (
              sources.map((s) => (
                <div key={s.n} className="text-xs">
                  <span className="font-semibold">[{s.n}]</span> {s.title ?? "Source"}
                  {s.heading ? <span className="text-stone-500"> · {s.heading}</span> : null}
                  {s.sourceUrl ? (
                    <a
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-emerald-700 underline dark:text-emerald-400"
                    >
                      {s.sourceUrl}
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <footer className="border-t border-stone-200 pt-3 text-center text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
        Lodestar provides general, evidence-based information and is{" "}
        <strong className="font-semibold">NOT medical advice</strong>. Consult a qualified
        professional for individual circumstances.
      </footer>
    </div>
  );
}
