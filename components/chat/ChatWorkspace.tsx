"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import AnswerBody, { type Citation, citedSources } from "@/components/chat/AnswerBody";
import SignOutButton from "@/components/SignOutButton";
import { readTurnStream } from "@/lib/chat-stream";

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
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Which view the transcript belongs to. Every async write checks it before
  // applying, so a turn or a load that resolves after the user has moved on is
  // dropped instead of landing in someone else's conversation (issue #2, P0-3).
  const viewSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  /** Switch what the transcript is showing; invalidates anything in flight. */
  const beginView = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setStreaming(false);
    return ++viewSeq.current;
  }, []);

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

  const loadConversation = useCallback(
    async (id: string) => {
      const seq = beginView();
      setConversationId(id);
      setMessages([]);
      setLoadError(null);

      // A conversation row can outlive its messages, or be gone entirely — a
      // stale sidebar entry, a deleted row. Failing silently here left the last
      // conversation's transcript on screen under the new title (P0-4).
      try {
        const res = await fetch(`/api/conversations?id=${id}`);
        if (seq !== viewSeq.current) return;
        if (!res.ok) {
          setLoadError({
            id,
            message:
              res.status === 404
                ? "This conversation no longer exists."
                : `Couldn't load this conversation (${res.status}).`,
          });
          return;
        }
        const data = (await res.json()) as {
          messages: {
            id: string;
            role: string;
            content: string | null;
            citations: unknown;
            tool_calls: unknown;
          }[];
        };
        if (seq !== viewSeq.current) return;
        setMessages(
          (data.messages ?? []).map((m) => ({
            id: m.id,
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content ?? "",
            citations: Array.isArray(m.citations) ? (m.citations as Citation[]) : undefined,
            actions: Array.isArray(m.tool_calls) ? (m.tool_calls as AgentAction[]) : undefined,
          })),
        );
      } catch {
        if (seq === viewSeq.current) {
          setLoadError({ id, message: "Couldn't reach the server." });
        }
      }
    },
    [beginView],
  );

  function startNewChat() {
    beginView();
    setConversationId(null);
    setMessages([]);
    setLoadError(null);
    setInput("");
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setLoadError(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { id: newId(), role: "user", content: text }]);

    // This turn belongs to the view that started it. If the user switches
    // conversations mid-stream, `seq` goes stale and every write below is
    // dropped rather than appended to whatever is on screen now (P0-3).
    const seq = viewSeq.current;
    const current = () => seq === viewSeq.current;
    const controller = new AbortController();
    inFlight.current = controller;

    const assistantId = newId();
    let assistantAdded = false;
    let finished = false;
    const finishTurn = () => {
      if (finished) return;
      finished = true;
      if (inFlight.current === controller) inFlight.current = null;
      if (!current()) return;
      setStreaming(false);
      void refreshConversations();
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        if (!current()) return;
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: `⚠️ ${err.error ?? "Request failed"}` },
        ]);
        return;
      }

      await readTurnStream(res.body, {
        onStart: (cid) => {
          if (!current()) return;
          setConversationId(cid);
          setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
          assistantAdded = true;
        },
        onText: (t) => {
          if (current()) updateMessage(assistantId, (m) => ({ ...m, content: m.content + t }));
        },
        // The trailer means the turn is complete: the answer and its sources are
        // final and both rows are written. Everything after it on the wire is
        // bookkeeping the user is not waiting for, so release the UI here rather
        // than at close — that wait was the full memory-extraction tail (P0-5).
        onMeta: (meta) => {
          if (current()) {
            updateMessage(assistantId, (m) => ({
              ...m,
              citations: meta.sources,
              actions: meta.actions,
            }));
          }
          finishTurn();
        },
      });
    } catch {
      if (current() && !assistantAdded) {
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: "⚠️ Something went wrong." },
        ]);
      }
    } finally {
      // Idempotent backstop: a turn that dies before its trailer (network drop,
      // a throw before `sendMeta`) must still hand the composer back.
      finishTurn();
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  // Only what the answer cites — a refusal retrieves chunks too (P0-7).
  const sources = citedSources(lastAssistant?.content ?? "", lastAssistant?.citations);

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
            {loadError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <p className="text-amber-900 dark:text-amber-200">{loadError.message}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void loadConversation(loadError.id)}
                    className="rounded-md border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={startNewChat}
                    className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                  >
                    Start a new chat
                  </button>
                </div>
              </div>
            )}
            {messages.length === 0 && !loadError && (
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
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "self-end whitespace-pre-wrap bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                      : "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                  }`}
                >
                  {m.role === "assistant" ? (
                    m.content ? (
                      <AnswerBody content={m.content} citations={m.citations} />
                    ) : (
                      (streaming && "…") || ""
                    )
                  ) : (
                    m.content
                  )}
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
