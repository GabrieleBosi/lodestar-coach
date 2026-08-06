/**
 * Detection of turns that have a question but no answer.
 *
 * The server persists a row for a turn it *knows* failed, but it cannot persist
 * one for a turn that was never allowed to finish: a killed serverless function
 * leaves no catch to run. Measured in production, 15 of 86 conversations end
 * with an unanswered question (17%), all predating any failure-row code — and
 * one of them rendered as a perfectly ordinary conversation. So the gap is
 * detected from the transcript rather than trusted to exist as a row (#2, P0-4).
 *
 * Pure and separate from the component so it can be checked directly
 * (`npm run check:gaps`).
 */

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Server timestamp; absent on optimistic client-side rows. */
  createdAt?: string;
  /** Set on synthesized placeholders. Never persisted. */
  gap?: "pending" | "failed";
}

/**
 * How long a trailing unanswered question is treated as a turn still running
 * rather than a lost one. A turn is bounded by the agent budget (22s) plus the
 * route prelude, and the platform kills the request around 30s, so anything
 * older than this is not coming back.
 */
export const IN_FLIGHT_GRACE_MS = 60_000;

export const PENDING_TEXT = "Still working on this…";
export const FAILED_TEXT = "This turn didn't finish, so there's no reply saved for it.";

/**
 * Insert a placeholder wherever a question has no reply.
 *
 * Any user message not followed by an assistant message is a gap — not only the
 * last one. Restricting it to the last would leave a retried turn reading as two
 * consecutive questions, because a retry appends a new turn rather than
 * rewriting history; checking every position is what keeps the live transcript
 * and a reload showing the same thing.
 *
 * Only a *trailing* gap can still be running. A mid-transcript one is settled by
 * definition: something came after it.
 *
 * @param streamingHere this tab is currently streaming a turn for this conversation
 * @param now injectable clock, for checks
 */
export function withGapMarkers<T extends TranscriptMessage>(
  messages: T[],
  streamingHere: boolean,
  now: number = Date.now(),
): (T | TranscriptMessage)[] {
  const out: (T | TranscriptMessage)[] = [];
  messages.forEach((m, i) => {
    out.push(m);
    if (m.role !== "user") return;
    if (messages[i + 1]?.role === "assistant") return;

    const trailing = i === messages.length - 1;
    const age = m.createdAt ? now - new Date(m.createdAt).getTime() : Infinity;
    // Streaming in this tab, or recent enough to be streaming in another one.
    const pending = trailing && (streamingHere || age < IN_FLIGHT_GRACE_MS);
    out.push({
      id: `${m.id}:gap`,
      role: "assistant",
      gap: pending ? "pending" : "failed",
      content: pending ? PENDING_TEXT : FAILED_TEXT,
    });
  });
  return out;
}
