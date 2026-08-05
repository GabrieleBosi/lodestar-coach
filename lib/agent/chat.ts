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
}

/** Control byte separating keepalives and the trailing metadata from answer text. */
const CTRL = "\u0000";
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
        });
        const latencyMs = Date.now() - started;
        clearInterval(keepalive);

        for (const piece of chunkText(agent.finalText)) send(piece);

        // Trailing metadata: sources/actions are only known once the agent is done.
        send(
          CTRL +
            "META:" +
            JSON.stringify({
              sources: agent.citations,
              actions: agent.actions.map((a) => ({
                name: a.name,
                ok: a.ok,
                summary: a.summary,
                error: a.error,
              })),
            }),
        );

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

        if (params.extractMemory) {
          await extractAndStoreMemories({ supabase, provider, userId }, message, agent.finalText);
        }
      } catch (err) {
        send(
          "\n\nSomething went wrong while answering. Please try again. " +
            "(This is general information, not medical advice.)",
        );
        await supabase.from("traces").insert({
          request_id: requestId,
          user_id: userId,
          stage,
          latency_ms: Date.now() - started,
          payload: {
            error: err instanceof Error ? err.message.slice(0, 300) : String(err),
          } as unknown as Json,
        });
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
