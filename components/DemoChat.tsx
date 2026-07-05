"use client";

import Link from "next/link";
import { useRef, useState } from "react";

interface Citation {
  n: number;
  title: string | null;
  sourceUrl: string | null;
  heading: string | null;
}
interface AgentAction {
  name: string;
  ok?: boolean;
  summary?: string;
}
interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  actions?: AgentAction[];
}

const SUGGESTIONS = [
  "How should I structure a deload week?",
  "How much protein should I eat to build muscle?",
  "How's my squat trending, and what should I eat to lean-bulk?",
];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export default function DemoChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { id: newId(), role: "user", content: trimmed }]);
    const assistantId = newId();
    let added = false;

    try {
      const res = await fetch("/api/demo/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId: conversationId.current }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((m) => [
          ...m,
          { id: assistantId, role: "assistant", content: `⚠️ ${err.error}` },
        ]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let metaParsed = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        if (!metaParsed) {
          const nl = buffer.indexOf("\n");
          if (nl !== -1) {
            const meta = JSON.parse(buffer.slice(0, nl)) as {
              conversationId: string;
              sources: Citation[];
              actions?: AgentAction[];
            };
            buffer = buffer.slice(nl + 1);
            metaParsed = true;
            conversationId.current = meta.conversationId;
            setMessages((m) => [
              ...m,
              {
                id: assistantId,
                role: "assistant",
                content: "",
                citations: meta.sources,
                actions: meta.actions,
              },
            ]);
            added = true;
          }
        }
        if (metaParsed && added && buffer) {
          const t = buffer;
          buffer = "";
          setMessages((m) =>
            m.map((x) => (x.id === assistantId ? { ...x, content: x.content + t } : x)),
          );
        }
        if (done) break;
      }
    } catch {
      if (!added)
        setMessages((m) => [
          ...m,
          { id: assistantId, role: "assistant", content: "⚠️ Something went wrong." },
        ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
      );
    }
  }

  const sources = [...messages].reverse().find((m) => m.role === "assistant")?.citations ?? [];

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Lodestar — live demo</h1>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            No signup. Pre-seeded with a demo athlete&apos;s training history.
          </p>
        </div>
        <Link href="/" className="text-sm text-stone-500 underline">
          Home
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-stone-200 dark:border-stone-800">
        <div ref={scrollRef} className="min-h-[50vh] flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="mt-6 text-center">
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Try one of these — answers are grounded in the knowledge base and cited.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"
                }
              >
                {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {m.actions.map((a, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400"
                      >
                        ⚙ {a.summary ?? a.name}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                      : "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                  }`}
                >
                  {m.content || (busy ? "…" : "")}
                </div>
              </div>
            ))
          )}
        </div>

        {sources.length > 0 && (
          <div className="border-t border-stone-200 px-4 py-2 text-xs dark:border-stone-800">
            <span className="font-semibold">Sources: </span>
            {sources.map((s) => (
              <span key={s.n} className="mr-2">
                [{s.n}]{" "}
                {s.sourceUrl ? (
                  <a
                    href={s.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 underline dark:text-emerald-400"
                  >
                    {s.title ?? "source"}
                  </a>
                ) : (
                  (s.title ?? "source")
                )}
              </span>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2 border-t border-stone-200 p-3 dark:border-stone-800"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about training, nutrition, or recovery…"
            disabled={busy}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-stone-500 dark:text-stone-400">
        Lodestar provides general, evidence-based information and is{" "}
        <strong className="font-semibold">NOT medical advice</strong>. The public demo is
        rate-limited and shared.
      </p>
    </div>
  );
}
