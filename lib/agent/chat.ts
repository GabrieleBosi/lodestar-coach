/**
 * Shared chat-turn pipeline used by both the authenticated `/api/chat` and the
 * public `/api/demo/chat`: retrieve personalization, run the agent, write a
 * request-level trace, stream the answer, and persist the assistant message.
 */
import { type Content } from "@google/genai";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../db/types";
import { estimateCostUsd } from "../llm/cost";
import type { LLMProvider } from "../llm/types";
import { AGENT_SYSTEM_PROMPT } from "../rag/prompt";
import { TURN_FAILED } from "../chat-stream";
import { runAgent } from "./loop";
import { extractAndStoreMemories, getPersonalizationContext } from "./memory";

function chunkText(text: string, size = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export interface TurnParams {
  supabase: SupabaseClient<Database>;
  provider: LLMProvider;
  userId: string;
  requestId: string;
  conversationId: string;
  message: string;
  history: Content[];
  extractMemory?: boolean;
  /** When true, update_profile refuses writes (the public demo's shared user). */
  profileReadOnly?: boolean;
  /** trace stage for the request-level row (e.g. "chat.request" | "demo.request"). */
  stage?: string;
  /**
   * Milliseconds the route spent before handing off — rate limit, body parse,
   * conversation upsert, history fetch, plus any cold start. Invisible in the
   * per-stage traces, but measured at 3.9-10.9s to first byte, so it is
   * recorded rather than inferred.
   */
  preludeMs?: number;
}

/** Control byte separating keepalives and the trailing metadata from answer text. */
const CTRL = "\u0000";
/** Control frame: discard the answer text forwarded so far this turn. */
const RESET = "RESET";
const KEEPALIVE_MS = 5_000;

export function streamTurn(params: TurnParams): Response {
  const { supabase, provider, userId, requestId, conversationId, message, history } = params;
  const stage = params.stage ?? "chat.request";
  const encoder = new TextEncoder();

  // Everything slow runs INSIDE the stream. Hosting proxies terminate a request
  // that sends no data for too long ("inactivity timeout"), and a tool-using
  // turn takes far longer than that budget — so the first byte goes out
  // immediately and keepalives flow until the answer is ready.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };

      // Frame 1, sent right away: enough for the client to bind the conversation.
      send(JSON.stringify({ conversationId }) + "\n");
      const keepalive = setInterval(() => send(CTRL), KEEPALIVE_MS);

      const started = Date.now();
      let metaSent = false;
      let firstToken = false;
      /** The answer text is whole and delivered; later failures can't retract it. */
      let answerComplete = false;

      const traceFailure = async (kind: string, err: unknown) => {
        try {
          await supabase.from("traces").insert({
            request_id: requestId,
            user_id: userId,
            stage,
            latency_ms: Date.now() - started,
            payload: {
              failure: kind,
              answer_complete: answerComplete,
              error: err instanceof Error ? err.message.slice(0, 300) : String(err),
            } as unknown as Json,
          });
        } catch {
          /* the DB is the thing that failed; there is nowhere left to report it */
        }
      };

      /**
       * The trailer is the turn-complete signal, so it must be *terminated*.
       * Without the closing CTRL the client's `buffer.split(CTRL)` leaves it as
       * the trailing fragment and the prefix-hold heuristic keeps it there until
       * the stream closes — which made sources and chips wait out the whole tail
       * no matter what order this function wrote them (issue #2, P0-5).
       * Guarded by `npm run check:stream`.
       */
      const sendMeta = (payload: { sources: unknown; actions: unknown }) => {
        if (metaSent) return;
        metaSent = true;
        send(CTRL + "META:" + JSON.stringify(payload) + CTRL);
      };

      try {
        let personalization = "";
        try {
          personalization = await getPersonalizationContext(
            { supabase, provider, userId },
            message,
          );
        } catch {
          personalization = "";
        }
        const system = personalization
          ? `${AGENT_SYSTEM_PROMPT}\n\nPERSONALIZATION CONTEXT (about this user):\n${personalization}`
          : AGENT_SYSTEM_PROMPT;

        // Always run the full agent: tool choice belongs to the model, not to a
        // keyword heuristic. A regex fast-path here silently stripped the tools
        // from paraphrased questions about the user's own data (issue #2, P0-1).
        const agent = await runAgent({
          ctx: {
            supabase,
            provider,
            userId,
            requestId,
            citations: [],
            profileReadOnly: params.profileReadOnly,
          },
          system,
          history,
          userMessage: message,
          // Tokens go out as they are generated. A step that turns out to call a
          // tool retracts what it forwarded — the loop discards that text anyway.
          sink: {
            onToken: (t) => {
              if (!firstToken) {
                firstToken = true;
                clearInterval(keepalive);
              }
              send(t);
            },
            onReset: () => send(CTRL + RESET + CTRL),
          },
        });
        const latencyMs = Date.now() - started;
        clearInterval(keepalive);

        // Nothing to send when the client already holds exactly this answer;
        // the degraded and empty-generation paths still need it.
        if (!agent.alreadyStreamed) {
          for (const piece of chunkText(agent.finalText)) send(piece);
        }
        // From here the answer is whole and on screen. Nothing that fails later
        // may retract it.
        answerComplete = true;

        // Order matters: persist -> META -> extract -> close.
        //
        // META tells the client the turn is complete, so it re-enables the
        // composer and refetches the sidebar. Both reads want the rows to exist
        // already, so the writes go first. Memory extraction is a further model
        // call (~11.7s measured) that nothing on screen waits for, so it goes
        // after — but still *inside* the stream: work scheduled after
        // `controller.close()` can be frozen or killed on serverless, which
        // would drop memories silently.
        // Persistence is best-effort and isolated. A transient DB error here
        // must not reach the outer catch, which would retract an answer the
        // user is already reading and replace it with a failure notice.
        try {
          await supabase.from("traces").insert({
            request_id: requestId,
            user_id: userId,
            stage,
            tokens: agent.tokensIn + agent.tokensOut,
            latency_ms: latencyMs,
            cost_usd: estimateCostUsd(agent.tokensIn, agent.tokensOut),
            payload: {
              actions: agent.actions.length,
              degraded: agent.degraded,
              degradedError: agent.degradedError ?? null,
              prelude_ms: params.preludeMs ?? null,
              streamed: agent.alreadyStreamed,
            } as unknown as Json,
          });

          await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: agent.finalText,
            citations: agent.citations as unknown as Json,
            tool_calls: agent.actions as unknown as Json,
            tokens_in: agent.tokensIn,
            tokens_out: agent.tokensOut,
            latency_ms: latencyMs,
            cost_usd: estimateCostUsd(agent.tokensIn, agent.tokensOut),
          });
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId);
        } catch (persistErr) {
          await traceFailure("persist", persistErr);
        }

        sendMeta({
          sources: agent.citations,
          actions: agent.actions.map((a) => ({
            name: a.name,
            ok: a.ok,
            summary: a.summary,
            error: a.error,
          })),
        });

        // Past the point of no return for the user-visible turn: a memory
        // failure must not append an error to an answer already on screen.
        if (params.extractMemory) {
          try {
            await extractAndStoreMemories({ supabase, provider, userId }, message, agent.finalText);
          } catch {
            /* the answer is delivered; losing an extraction is not the user's problem */
          }
        }
      } catch (err) {
        // Only a *partial* answer is retracted. `answerComplete` means the text
        // is whole and on screen, so a later failure gets a trace, not a repaint
        // that blanks correct output.
        if (firstToken && !answerComplete) send(CTRL + RESET + CTRL);
        const notice =
          "Something went wrong while answering. Please try again. " +
          "(This is general information, not medical advice.)";
        if (!answerComplete) send(notice);

        await traceFailure("turn", err);

        // A failed turn must leave a row. Without one, reload shows a user
        // message with no reply and no indication anything went wrong — a
        // failure that reads exactly like success (P0-4). Marked in tool_calls
        // so the client can render it as an error with a retry.
        if (!answerComplete) {
          try {
            await supabase.from("messages").insert({
              conversation_id: conversationId,
              role: "assistant",
              content: notice,
              tool_calls: [
                {
                  name: TURN_FAILED,
                  ok: false,
                  error: err instanceof Error ? err.message.slice(0, 300) : String(err),
                },
              ] as unknown as Json,
              latency_ms: Date.now() - started,
            });
            // Same bump a successful turn does: the sidebar orders by this, and
            // a failed turn that doesn't move it sends the conversation to the
            // bottom of the list exactly when the user wants to find it again.
            await supabase
              .from("conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", conversationId);
          } catch (persistErr) {
            await traceFailure("persist_failed_turn", persistErr);
          }
        }

        // Complete the turn even on the error path, so the composer unlocks on
        // the signal rather than on the close-handler backstop.
        sendMeta({ sources: [], actions: [] });
      } finally {
        clearInterval(keepalive);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "x-conversation-id": conversationId,
    },
  });
}
