/**
 * Shared chat-turn pipeline used by both the authenticated `/api/chat` and the
 * public `/api/demo/chat`: retrieve personalization, run the agent, write a
 * request-level trace, stream the answer, and persist the assistant message.
 */
import { type Content } from "@google/genai";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../db/types";
import { estimateCostUsd, estimateTokens } from "../llm/cost";
import type { LLMProvider } from "../llm/types";
import { AGENT_SYSTEM_PROMPT, buildGroundedPrompt } from "../rag/prompt";
import { retrieve } from "../rag/retrieve";
import { runAgent, type AgentResult } from "./loop";
import { extractAndStoreMemories, getPersonalizationContext } from "./memory";

/**
 * Requests that need a tool (writing a log, reading history, computing targets).
 * Everything else is plain grounded Q&A and can skip the tool-selection round
 * trip, which roughly halves the turn: attaching tools costs ~20s per model call
 * on the current Gemini flash models, and two sequential calls exceed the
 * ~30s hosting request budget.
 */
const ACTION_INTENT =
  /\b(log|logged|logging|record|track|ate|eaten|did|history|trend|trending|progress|since|last week|calorie|calories|macro|macros|tdee|maintenance|deficit|surplus|bulk|cut|how much should i eat)\b/i;

function needsTools(message: string): boolean {
  return ACTION_INTENT.test(message);
}

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
  /** trace stage for the request-level row (e.g. "chat.request" | "demo.request"). */
  stage?: string;
}

/** Control byte separating keepalives and the trailing metadata from answer text. */
const CTRL = "\u0000";
const KEEPALIVE_MS = 5_000;

/**
 * Single-call grounded answer: retrieve, inject the numbered context, generate.
 * Produces the same `AgentResult` shape as the agent loop (including a synthetic
 * `search_knowledge` action) so the UI and persistence are unchanged.
 */
async function groundedAnswer(args: {
  supabase: SupabaseClient<Database>;
  provider: LLMProvider;
  userId: string;
  requestId: string;
  system: string;
  message: string;
}): Promise<AgentResult> {
  const { supabase, provider, userId, requestId, system, message } = args;

  const retrievalStarted = Date.now();
  const chunks = await retrieve(supabase, provider, message, 6);
  const grounded = buildGroundedPrompt(message, chunks);
  await supabase.from("traces").insert({
    request_id: requestId,
    user_id: userId,
    stage: "search_knowledge",
    latency_ms: Date.now() - retrievalStarted,
    payload: {
      summary: `search_knowledge("${message.slice(0, 60)}") → ${chunks.length} chunk(s)`,
    } as unknown as Json,
  });

  const genStarted = Date.now();
  let finalText = "";
  let degraded = false;
  let degradedError: string | undefined;
  try {
    finalText = await provider.generate(grounded.user, {
      system: `${system}\n\n${grounded.system}`,
      temperature: 0.3,
      maxOutputTokens: 700,
    });
  } catch (err) {
    degraded = true;
    degradedError = err instanceof Error ? err.message.slice(0, 300) : String(err);
    finalText =
      "I'm having trouble reaching the model right now. Please try again in a moment. " +
      "(This is general information, not medical advice.)";
  }

  const tokensIn = estimateTokens(system + grounded.user);
  const tokensOut = estimateTokens(finalText);
  await supabase.from("traces").insert({
    request_id: requestId,
    user_id: userId,
    stage: "llm.chat",
    tokens: tokensIn + tokensOut,
    latency_ms: Date.now() - genStarted,
    cost_usd: estimateCostUsd(tokensIn, tokensOut),
    payload: { mode: "grounded" } as unknown as Json,
  });

  return {
    finalText,
    actions: [
      {
        name: "search_knowledge",
        args: { query: message },
        ok: true,
        summary: `search_knowledge → ${chunks.length} chunk(s)`,
      },
    ],
    citations: grounded.citations,
    tokensIn,
    tokensOut,
    degraded,
    degradedError,
  };
}

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

        const agent = needsTools(message)
          ? await runAgent({
              ctx: { supabase, provider, userId, requestId, citations: [] },
              system,
              history,
              userMessage: message,
            })
          : await groundedAnswer({ supabase, provider, userId, requestId, system, message });
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
