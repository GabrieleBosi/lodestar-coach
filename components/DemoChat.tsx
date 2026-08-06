"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import AnswerBody, { type Citation, groupCitedSources } from "@/components/chat/AnswerBody";
import { isFailedTurn, readTurnStream, TURN_FAILED } from "@/lib/chat-stream";
import { MAX_DEMO_MESSAGE_LEN } from "@/lib/limits";

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
  /** Text arrived but the turn never completed: what is shown is partial. */
  truncated?: boolean;
}

const SUGGESTIONS = [
  "How should I structure a deload week?",
  "How much protein should I eat to build muscle?",
  "How's my squat trending, and what should I eat to lean-bulk?",
];

/** Mirrors the authenticated workspace: say which failure, not just that one happened. */
function describeHttpFailure(status: number): string {
  if (status === 413) return "That question is too long to send.";
  if (status === 429)
    return "The demo is busy right now (it's shared and rate-limited). Try again shortly.";
  if (status >= 500) return "The server had a problem answering. This is usually temporary.";
  return `The request was rejected (${status}).`;
}

function RetryButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-2 rounded-md border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/40"
    >
      Retry
    </button>
  );
}

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
    let metaSeen = false;
    let finished = false;
    // The trailer completes the turn; `finally` is only a backstop for a stream
    // that dies before sending one (issue #2, P0-5).
    const finishTurn = () => {
      if (finished) return;
      finished = true;
      setBusy(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
      );
    };

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
          {
            id: assistantId,
            role: "assistant",
            content: String(err.error ?? describeHttpFailure(res.status)),
            actions: [{ name: TURN_FAILED, ok: false }],
          },
        ]);
        return;
      }
      await readTurnStream(res.body, {
        onStart: (cid) => {
          conversationId.current = cid;
          setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);
          added = true;
        },
        onText: (t) =>
          setMessages((m) =>
            m.map((x) => (x.id === assistantId ? { ...x, content: x.content + t } : x)),
          ),
        // The step that produced this text turned out to call a tool.
        onReset: () =>
          setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, content: "" } : x))),
        onMeta: (meta) => {
          metaSeen = true;
          setMessages((m) =>
            m.map((x) =>
              x.id === assistantId ? { ...x, citations: meta.sources, actions: meta.actions } : x,
            ),
          );
          finishTurn();
        },
      });
    } catch {
      if (!added)
        setMessages((m) => [
          ...m,
          {
            id: assistantId,
            role: "assistant",
            content: "Couldn't reach the server. The question may not have been sent.",
            actions: [{ name: TURN_FAILED, ok: false }],
          },
        ]);
    } finally {
      // A turn is complete only if its trailer arrived. Checked here rather than
      // in `catch` because a stream can end *cleanly* without one — a killed
      // function closes the response with no error to catch — which left an
      // empty bubble looking like an answer while the composer re-enabled as
      // though it had worked (issue #2).
      if (added && !metaSeen) {
        setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, truncated: true } : x)));
      }
      finishTurn();
    }
  }

  /** Re-ask the question that went unanswered. Appends; it doesn't rewrite history. */
  function retryFrom(assistantId: string) {
    const idx = messages.findIndex((m) => m.id === assistantId);
    const prior = idx > 0 ? messages[idx - 1] : undefined;
    if (!prior || prior.role !== "user") return;
    void send(prior.content);
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  // Only what the answer cites — a refusal retrieves chunks too (P0-7).
  const sources = groupCitedSources(lastAssistant?.content ?? "", lastAssistant?.citations);

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
            messages.map((m) => {
              // A turn with no trailer is not an answer, however much text it
              // managed to emit. Empty and incomplete reads as a failure; partial
              // text is kept but labelled. Both offer a retry.
              const failed =
                m.role === "assistant" && (isFailedTurn(m.actions) || (m.truncated && !m.content));
              return (
                <div
                  key={m.id}
                  className={
                    m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"
                  }
                >
                  {m.role === "assistant" && !failed && m.actions && m.actions.length > 0 && (
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
                    className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                      m.role === "user"
                        ? "whitespace-pre-wrap bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                        : failed
                          ? "border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                          : "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                    }`}
                  >
                    {m.role !== "assistant" ? (
                      m.content
                    ) : failed ? (
                      <>
                        <p>
                          {m.content || "This turn didn't finish, so there's no answer to show."}
                        </p>
                        <RetryButton onClick={() => retryFrom(m.id)} disabled={busy} />
                      </>
                    ) : m.content ? (
                      <>
                        <AnswerBody content={m.content} citations={m.citations} />
                        {m.truncated && (
                          <div className="mt-2 border-t border-amber-300 pt-2 text-xs text-amber-800 dark:border-amber-900 dark:text-amber-300">
                            <p>The connection dropped before this answer finished.</p>
                            <RetryButton onClick={() => retryFrom(m.id)} disabled={busy} />
                          </div>
                        )}
                      </>
                    ) : (
                      (busy && "…") || ""
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {sources.length > 0 && (
          <div className="border-t border-stone-200 px-4 py-2 text-xs dark:border-stone-800">
            <span className="font-semibold">Sources: </span>
            {sources.map((g) => (
              <span key={g.key} className="mr-2">
                {g.entries.map((e) => `[${e.n}]`).join("")}{" "}
                {g.sourceUrl ? (
                  <a
                    href={g.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 underline dark:text-emerald-400"
                  >
                    {g.title}
                  </a>
                ) : (
                  g.title
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
          {/*
            Mirrors the authenticated composer. The demo route already enforced
            MAX_DEMO_MESSAGE_LEN server-side while this field had no cap at all —
            the same asymmetry fixed for /api/chat, inverted, on the page a
            stranger sees first.
          */}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            maxLength={MAX_DEMO_MESSAGE_LEN}
            placeholder="Ask about training, nutrition, or recovery…  (Shift+Enter for a new line)"
            disabled={busy}
            className="flex-1 resize-y rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900"
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
