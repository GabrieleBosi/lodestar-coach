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
      className="mt-2 min-h-9 rounded-lg border border-warn/55 px-3.5 text-[13px] font-medium text-warn hover:bg-warn/10 disabled:opacity-45"
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
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-ground px-4 py-6 text-ink">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="font-medium tracking-tight">Lodestar</h1>
          <p className="font-mono text-[11px] text-ink-faint">
            live demo · no signup · pre-seeded athlete history
          </p>
        </div>
        <Link
          href="/"
          className="font-mono text-[12.5px] text-ink-muted no-underline hover:text-accent-ink"
        >
          Home
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line-faint">
        <div ref={scrollRef} className="min-h-[50vh] flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="mt-6 text-center">
              <p className="text-sm text-ink-muted">
                Try one of these — answers are grounded in the knowledge base and cited.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="min-h-11 rounded-full border border-line px-4 text-[13px] hover:border-accent hover:bg-accent-wash"
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
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {m.actions.map((a, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-[5px] border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-muted"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                          {a.summary ?? a.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.role === "user" ? (
                    <div className="max-w-[75%] whitespace-pre-wrap rounded-[10px] bg-bubble px-3.5 py-2 text-sm text-ink">
                      {m.content}
                    </div>
                  ) : failed ? (
                    <div className="max-w-[85%] rounded-[10px] border border-warn/40 bg-warn-wash px-4 py-3 text-sm text-warn-ink shadow-[inset_2px_0_0_var(--warn)]">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-warn">
                        Turn failed
                      </div>
                      <p>{m.content || "This turn didn't finish, so there's no answer to show."}</p>
                      <RetryButton onClick={() => retryFrom(m.id)} disabled={busy} />
                    </div>
                  ) : m.content ? (
                    <div className="w-full text-sm leading-[1.65] text-ink/85">
                      <AnswerBody content={m.content} citations={m.citations} />
                      {m.truncated && (
                        <div className="mt-3 border-t border-warn/40 pt-2 text-xs text-warn-ink">
                          <p>The connection dropped before this answer finished.</p>
                          <RetryButton onClick={() => retryFrom(m.id)} disabled={busy} />
                        </div>
                      )}
                      <div className="rule-fade mt-4" />
                    </div>
                  ) : (
                    (busy && <span className="text-ink-faint">…</span>) || ""
                  )}
                </div>
              );
            })
          )}
        </div>

        {sources.length > 0 && (
          <div className="border-t border-line-faint px-4 py-2.5 text-xs">
            <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Sources
            </span>
            {sources.map((g) => (
              <span key={g.key} className="mr-3">
                <span className="font-mono text-[10px] text-accent-ink">
                  {g.entries.map((e) => `[${e.n}]`).join("")}
                </span>{" "}
                {g.sourceUrl ? (
                  <a
                    href={g.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-ink underline"
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
          className="border-t border-line-faint p-3"
        >
          {/*
            Mirrors the authenticated composer. The demo route already enforced
            MAX_DEMO_MESSAGE_LEN server-side while this field had no cap at all —
            the same asymmetry fixed for /api/chat, inverted, on the page a
            stranger sees first.
          */}
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              maxLength={MAX_DEMO_MESSAGE_LEN}
              placeholder="Ask about training, nutrition, or recovery…"
              disabled={busy}
              className="max-h-40 min-h-11 flex-1 resize-none rounded-[10px] border border-line bg-surface px-3.5 py-[11px] text-sm outline-none focus:border-accent disabled:opacity-45"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="min-h-11 rounded-[10px] border border-accent px-[18px] text-sm font-medium text-accent hover:bg-accent-wash disabled:opacity-45"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-ink-faint">
            <span>Enter sends · Shift+Enter for a new line</span>
            <span>{input.length.toLocaleString("en-US")} / 500</span>
          </div>
        </form>
      </div>

      <p className="mt-4 text-center font-mono text-[10.5px] text-ink-faint">
        Lodestar provides general, evidence-based information and is{" "}
        <strong className="font-medium text-warn">NOT medical advice</strong>. The public demo is
        rate-limited and shared.
      </p>
    </div>
  );
}
