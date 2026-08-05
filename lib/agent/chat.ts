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
  /** trace stage for the request-level row (e.g. "chat.request" | "demo.request"). */
  stage?: string;
}

export async function streamTurn(params: TurnParams): Promise<Response> {
  const { supabase, provider, userId, requestId, conversationId, message, history } = params;
  const stage = params.stage ?? "chat.request";

  let personalization = "";
  try {
    personalization = await getPersonalizationContext({ supabase, provider, userId }, message);
  } catch {
    personalization = "";
  }
  const system = personalization
    ? `${AGENT_SYSTEM_PROMPT}\n\nPERSONALIZATION CONTEXT (about this user):\n${personalization}`
    : AGENT_SYSTEM_PROMPT;

  const started = Date.now();
  const agent = await runAgent({
    ctx: { supabase, provider, userId, requestId, citations: [] },
    system,
    history,
    userMessage: message,
  });
  const latencyMs = Date.now() - started;

  // Request-level trace (drives the metrics dashboard).
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

  const meta = {
    conversationId,
    sources: agent.citations,
    actions: agent.actions.map((a) => ({
      name: a.name,
      ok: a.ok,
      summary: a.summary,
      error: a.error,
    })),
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(meta) + "\n"));
      // Emit in chunks (the client renders them progressively) but without an
      // artificial delay — the serverless request budget is ~30s and a long
      // answer would otherwise burn seconds here.
      for (const piece of chunkText(agent.finalText)) {
        controller.enqueue(encoder.encode(piece));
      }

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

      controller.close();
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
