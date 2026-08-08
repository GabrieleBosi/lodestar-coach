"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AnswerBody, { type Citation, groupCitedSources } from "@/components/chat/AnswerBody";
import { isFailedTurn, readTurnStream, TURN_FAILED } from "@/lib/chat-stream";
import { MAX_MESSAGE_LEN } from "@/lib/limits";
import { msUntilGapSettles, withGapMarkers } from "@/lib/turn-gaps";

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
  /** Synthesized placeholder for a turn with no assistant row — not persisted. */
  gap?: "pending" | "failed";
  /** Text arrived but the turn never completed: what is shown is partial. */
  truncated?: boolean;
  /** Server timestamp; only present on loaded rows. */
  createdAt?: string;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

/**
 * What actually went wrong, when the server didn't say.
 *
 * Every failure used to read "⚠ Something went wrong." — a rate limit, an
 * expired session and a 500 were indistinguishable, so the user couldn't tell
 * whether waiting, signing in again, or retrying was the right move (issue #2,
 * P1). The server's own message wins when there is one; this is the fallback.
 */
function describeHttpFailure(status: number): string {
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 413) return "That question is too long to send.";
  if (status === 429) return "You're sending messages too quickly. Wait a moment and retry.";
  if (status >= 500) return "The server had a problem answering. This is usually temporary.";
  return `The request was rejected (${status}).`;
}

/** Short, absolute-enough stamp so two rows with the same title are tellable apart. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

// `isAdmin` gates the Metrics link in the mobile drawer (handoff §6); the shell
// owns the desktop tab row.
export default function ChatWorkspace({ isAdmin = false }: { isAdmin?: boolean }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Which view the transcript belongs to. Every async write checks it before
  // applying, so a turn or a load that resolves after the user has moved on is
  // dropped instead of landing in someone else's conversation (issue #2, P0-3).
  //
  // Deliberately *not* an AbortController. Aborting the fetch disconnects the
  // client mid-turn, and on serverless the function can be killed before it
  // persists the assistant row — manufacturing exactly the orphaned turn P0-4
  // describes. The turn is already paid for, so it is left to finish and write;
  // the sequence check is what keeps its output out of the wrong conversation.
  const viewSeq = useRef(0);
  /** Conversation currently on screen, readable from stale closures. */
  const viewConvId = useRef<string | null>(null);
  /**
   * Turns this tab is streaming, counted per conversation.
   *
   * A count rather than a set: `beginView` clears `streaming`, so switching away
   * and back lets a second turn start in a conversation whose first is still
   * running. With a set, whichever finished first released the id for both, and
   * the survivor's question read as settled. It degraded safely — a fresh
   * question is inside the grace window either way — but only by luck.
   */
  const inFlight = useRef(new Map<string, number>());

  const retainInFlight = useCallback((id: string) => {
    inFlight.current.set(id, (inFlight.current.get(id) ?? 0) + 1);
  }, []);

  const releaseInFlight = useCallback((id: string) => {
    const next = (inFlight.current.get(id) ?? 1) - 1;
    if (next > 0) inFlight.current.set(id, next);
    else inFlight.current.delete(id);
  }, []);

  /** Pending re-read for a gap this tab can't be told about. */
  const gapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(gapTimer.current), []);

  const showConversation = useCallback((id: string | null) => {
    viewConvId.current = id;
    setConversationId(id);
  }, []);

  /** Switch what the transcript is showing; invalidates anything in flight. */
  const beginView = useCallback(() => {
    clearTimeout(gapTimer.current);
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
      showConversation(id);
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
            created_at: string;
            citations: unknown;
            tool_calls: unknown;
          }[];
        };
        if (seq !== viewSeq.current) return;
        const loaded: ChatMessage[] = (data.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content ?? "",
          createdAt: m.created_at,
          citations: Array.isArray(m.citations) ? (m.citations as Citation[]) : undefined,
          actions: Array.isArray(m.tool_calls) ? (m.tool_calls as AgentAction[]) : undefined,
        }));
        const owned = (inFlight.current.get(id) ?? 0) > 0;
        const withGaps = withGapMarkers(loaded, owned);
        setMessages(withGaps);

        // The tab that owns the turn re-reads from `finishTurn`. Any other tab
        // has no completion signal, so it schedules one re-read for the moment
        // the gap must have settled.
        clearTimeout(gapTimer.current);
        if (!owned) {
          const settlesIn = msUntilGapSettles(withGaps);
          if (settlesIn !== null) {
            gapTimer.current = setTimeout(() => {
              if (seq === viewSeq.current) void loadConversation(id);
            }, settlesIn + 1_000);
          }
        }
      } catch {
        if (seq === viewSeq.current) {
          setLoadError({ id, message: "Couldn't reach the server." });
        }
      }
    },
    [beginView, showConversation],
  );

  const startNewChat = useCallback(() => {
    beginView();
    showConversation(null);
    setMessages([]);
    setLoadError(null);
    setInput("");
  }, [beginView, showConversation]);

  /**
   * Selecting a conversation puts it in the URL.
   *
   * Every chat used to live at `/app`, so nothing was linkable and Back did
   * nothing (issue #2, P1). History is driven directly rather than through the
   * router: this is a client-side view change, and a router navigation would
   * re-run the server component to show state the client already holds.
   */
  const selectConversation = useCallback(
    (id: string) => {
      window.history.pushState(null, "", `/app?c=${id}`);
      void loadConversation(id);
    },
    [loadConversation],
  );

  const openNewChat = useCallback(() => {
    window.history.pushState(null, "", "/app");
    startNewChat();
  }, [startNewChat]);

  // Deep link on first paint, and Back/Forward between conversations.
  useEffect(() => {
    const apply = () => {
      const id = new URLSearchParams(window.location.search).get("c");
      if (id) void loadConversation(id);
      else startNewChat();
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, [loadConversation, startNewChat]);

  async function deleteConversation(id: string) {
    const res = await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      setLoadError({ id, message: "Couldn't delete this conversation." });
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (viewConvId.current === id) openNewChat();
  }

  async function send() {
    const text = input.trim();
    // Guard before clearing: correctness of the input's contents shouldn't rest
    // on the composer's disabled attribute.
    if (!text || streaming) return;
    setInput("");
    await sendMessage(text);
  }

  /**
   * Re-send the question that went unanswered.
   *
   * Nothing is removed. The failed assistant row and the original question stay
   * in the database, so filtering them out of the live transcript would make it
   * disagree with what a reload shows. A retry is a new turn, and both views
   * render it that way: question, gap, question, answer.
   */
  function retryFrom(gapId: string) {
    const idx = messages.findIndex((m) => m.id === gapId);
    const prior = idx > 0 ? messages[idx - 1] : undefined;
    if (!prior || prior.role !== "user") return;
    void sendMessage(prior.content);
  }

  async function sendMessage(text: string) {
    if (!text || streaming) return;

    setLoadError(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { id: newId(), role: "user", content: text }]);

    // This turn belongs to the view that started it. If the user switches
    // conversations mid-stream, `seq` goes stale and every write below is
    // dropped rather than appended to whatever is on screen now (P0-3).
    const seq = viewSeq.current;
    const current = () => seq === viewSeq.current;
    // Known up front for an existing conversation; for a new one it arrives
    // with the opening frame.
    let turnConvId = conversationId;
    if (turnConvId) retainInFlight(turnConvId);

    const assistantId = newId();
    let assistantAdded = false;
    let metaSeen = false;
    let finished = false;
    const finishTurn = () => {
      if (finished) return;
      finished = true;
      if (turnConvId) releaseInFlight(turnConvId);
      void refreshConversations();
      if (current()) {
        setStreaming(false);
        return;
      }
      // The user switched away and came back while this ran. Its output was
      // dropped as stale, but the row is written now, so re-read it rather than
      // leave the gap marker sitting over a turn that succeeded.
      if (turnConvId && turnConvId === viewConvId.current) void loadConversation(turnConvId);
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: null }));
        if (!current()) return;
        // Marked like every other failure. An unmarked bubble was a third
        // failure shape: grey, no retry, and invisible to `isFailedTurn`.
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: String(err.error ?? describeHttpFailure(res.status)),
            actions: [{ name: TURN_FAILED, ok: false, error: `HTTP ${res.status}` }],
          },
        ]);
        return;
      }

      await readTurnStream(res.body, {
        onStart: (cid) => {
          // Tracked even when the view has moved on: `finishTurn` needs to know
          // which conversation to release and possibly re-read.
          // A new conversation's id only arrives here, so the retain that
          // `sendMessage` could not do up front happens now.
          if (turnConvId !== cid) {
            if (turnConvId) releaseInFlight(turnConvId);
            turnConvId = cid;
            retainInFlight(cid);
          }
          if (!current()) return;
          showConversation(cid);
          // A conversation created by sending becomes linkable immediately,
          // without adding a history entry the user didn't navigate to.
          if (new URLSearchParams(window.location.search).get("c") !== cid) {
            window.history.replaceState(null, "", `/app?c=${cid}`);
          }
          setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
          assistantAdded = true;
        },
        onText: (t) => {
          if (current()) updateMessage(assistantId, (m) => ({ ...m, content: m.content + t }));
        },
        // The step that produced this text turned out to call a tool, so the
        // text was never part of the answer.
        onReset: () => {
          if (current()) updateMessage(assistantId, (m) => ({ ...m, content: "" }));
        },
        // The trailer means the turn is complete: the answer and its sources are
        // final and both rows are written. Everything after it on the wire is
        // bookkeeping the user is not waiting for, so release the UI here rather
        // than at close — that wait was the full memory-extraction tail (P0-5).
        onMeta: (meta) => {
          metaSeen = true;
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
      if (current()) {
        if (!assistantAdded) {
          setMessages((prev) => [
            ...prev,
            {
              id: assistantId,
              role: "assistant",
              content:
                typeof navigator !== "undefined" && navigator.onLine === false
                  ? "You appear to be offline. The question wasn't sent."
                  : "Couldn't reach the server. The question may not have been sent.",
              actions: [{ name: TURN_FAILED, ok: false, error: "network" }],
            },
          ]);
        }
      }
    } finally {
      // A turn is complete only if its trailer arrived. Checked here rather than
      // in `catch`, because a stream can end *cleanly* without one — a killed
      // function closes the response with no error to catch — and that case
      // left the bubble looking finished until a reload revealed the gap.
      if (current() && assistantAdded && !metaSeen) {
        updateMessage(assistantId, (m) => ({ ...m, truncated: true }));
      }
      // Idempotent backstop: a turn that dies before its trailer must still
      // hand the composer back.
      finishTurn();
    }
  }

  const needle = filter.trim().toLowerCase();
  const visibleConversations = needle
    ? conversations.filter((c) => (c.title ?? "").toLowerCase().includes(needle))
    : conversations;

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  // Only what the answer cites — a refusal retrieves chunks too (P0-7).
  const sources = groupCitedSources(lastAssistant?.content ?? "", lastAssistant?.citations);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 py-4 md:grid-cols-[200px_1fr_260px]">
        {/* Conversation history */}
        <aside className="hidden min-h-0 flex-col md:flex">
          <button
            type="button"
            onClick={openNewChat}
            className="mb-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            + New chat
          </button>
          {/*
            The title is the first question truncated, so asking the same thing
            twice produces two identical rows. Search and a timestamp are what
            make them tellable apart; grouping by date belongs to the design
            pass (issue #2, P1).
          */}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="mb-2 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900"
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {visibleConversations.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-stone-400">
                {conversations.length === 0 ? "No chats yet." : "No chats match that search."}
              </p>
            )}
            {visibleConversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md pr-1 hover:bg-stone-100 dark:hover:bg-stone-800 ${
                  c.id === conversationId ? "bg-stone-100 dark:bg-stone-800" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectConversation(c.id)}
                  className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
                  title={c.title ?? "Untitled"}
                >
                  <span
                    className={`block truncate ${c.id === conversationId ? "font-medium" : ""}`}
                  >
                    {c.title ?? "Untitled"}
                  </span>
                  <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                    {formatWhen(c.updated_at)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteConversation(c.id)}
                  aria-label={`Delete conversation: ${c.title ?? "Untitled"}`}
                  title="Delete"
                  className="rounded px-1 text-xs text-stone-400 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
                >
                  ✕
                </button>
              </div>
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
                    onClick={openNewChat}
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
            {messages.map((m) => {
              // Two ways a turn can lack an answer: the server persisted a row
              // saying so, or no row exists at all and the gap was detected on
              // load. Neither may render as an answer (P0-4). A gap that could
              // still be running gets no retry — a second turn would cost
              // another generation and duplicate the question.
              const pending = m.gap === "pending";
              const failed =
                m.role === "assistant" &&
                (m.gap === "failed" || isFailedTurn(m.actions) || (m.truncated && !m.content));
              return (
                <div
                  key={m.id}
                  className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}
                >
                  {m.role === "assistant" &&
                    !failed &&
                    !pending &&
                    m.actions &&
                    m.actions.length > 0 && (
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
                        : failed
                          ? "border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                          : pending
                            ? "border border-stone-300 bg-transparent text-stone-500 dark:border-stone-700 dark:text-stone-400"
                            : "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                    }`}
                  >
                    {m.role !== "assistant" ? (
                      m.content
                    ) : pending ? (
                      <p className="animate-pulse">{m.content}</p>
                    ) : failed ? (
                      <>
                        <p>{m.content || "This turn didn't produce an answer."}</p>
                        <button
                          type="button"
                          onClick={() => retryFrom(m.id)}
                          disabled={streaming}
                          className="mt-2 rounded-md border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/40"
                        >
                          Retry
                        </button>
                      </>
                    ) : m.content ? (
                      <>
                        <AnswerBody content={m.content} citations={m.citations} />
                        {m.truncated && (
                          <div className="mt-2 border-t border-amber-300 pt-2 text-xs text-amber-800 dark:border-amber-900 dark:text-amber-300">
                            <p>The connection dropped before this answer finished.</p>
                            <button
                              type="button"
                              onClick={() => retryFrom(m.id)}
                              disabled={streaming}
                              className="mt-1 rounded-md border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/40"
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      (streaming && "…") || ""
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex gap-2 border-t border-stone-200 p-3 dark:border-stone-800"
          >
            {/*
              A textarea, not an input: a coaching question routinely runs to
              several lines, and a single-line field made anything long unusable
              to review before sending. Enter still sends, Shift+Enter is the
              newline. `maxLength` mirrors the server's own limit rather than
              letting the request fail after the fact. Auto-grow is left to the
              design pass.
            */}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={MAX_MESSAGE_LEN}
              placeholder="How should I structure a deload week?  (Shift+Enter for a new line)"
              disabled={streaming}
              className="flex-1 resize-y rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900"
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
              sources.map((g) => (
                <div key={g.key} className="text-xs">
                  <span className="font-semibold">{g.entries.map((e) => `[${e.n}]`).join("")}</span>{" "}
                  {g.title}
                  {g.entries.some((e) => e.heading) && (
                    <ul className="mt-0.5 ml-3 list-disc text-stone-500 dark:text-stone-400">
                      {g.entries
                        .filter((e) => e.heading)
                        .map((e) => (
                          <li key={e.n}>
                            [{e.n}] {e.heading}
                          </li>
                        ))}
                    </ul>
                  )}
                  {g.sourceUrl ? (
                    <a
                      href={g.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-emerald-700 underline dark:text-emerald-400"
                    >
                      {g.sourceUrl}
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
