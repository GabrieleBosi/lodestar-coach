import { randomUUID } from "node:crypto";

import { type Content } from "@google/genai";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/types";
import { extractAndStoreMemories, getPersonalizationContext } from "@/lib/agent/memory";
import { runAgent } from "@/lib/agent/loop";
import { getLLMProvider } from "@/lib/llm";
import { estimateCostUsd } from "@/lib/llm/cost";
import { AGENT_SYSTEM_PROMPT } from "@/lib/rag/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HISTORY_LIMIT = 10;

function chunkText(text: string, size = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { message?: unknown; conversationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  let convoId = conversationId;
  if (!convoId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: message.slice(0, 60) })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    convoId = data.id;
  }

  // Load prior turns as Gemini contents BEFORE inserting the new user message.
  const { data: prior } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", convoId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  const history: Content[] = (prior ?? [])
    .filter((m) => (m.content ?? "").trim().length > 0)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content ?? "" }],
    }));

  const { error: userMsgErr } = await supabase.from("messages").insert({
    conversation_id: convoId,
    role: "user",
    content: message,
  });
  if (userMsgErr) return NextResponse.json({ error: userMsgErr.message }, { status: 500 });

  const provider = getLLMProvider();
  const requestId = randomUUID();

  let personalization = "";
  try {
    personalization = await getPersonalizationContext(
      { supabase, provider, userId: user.id },
      message,
    );
  } catch {
    personalization = "";
  }

  const system = personalization
    ? `${AGENT_SYSTEM_PROMPT}\n\nPERSONALIZATION CONTEXT (about this user):\n${personalization}`
    : AGENT_SYSTEM_PROMPT;

  const started = Date.now();
  let agent;
  try {
    agent = await runAgent({
      ctx: { supabase, provider, userId: user.id, requestId, citations: [] },
      system,
      history,
      userMessage: message,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Agent failed" },
      { status: 500 },
    );
  }

  const meta = {
    conversationId: convoId,
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

      for (const piece of chunkText(agent.finalText)) {
        controller.enqueue(encoder.encode(piece));
        await sleep(8);
      }

      await supabase.from("messages").insert({
        conversation_id: convoId,
        role: "assistant",
        content: agent.finalText,
        citations: agent.citations as unknown as Json,
        tool_calls: agent.actions as unknown as Json,
        tokens_in: agent.tokensIn,
        tokens_out: agent.tokensOut,
        latency_ms: Date.now() - started,
        cost_usd: estimateCostUsd(agent.tokensIn, agent.tokensOut),
      });
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convoId);

      // Best-effort long-term memory extraction (never blocks the answer).
      await extractAndStoreMemories(
        { supabase, provider, userId: user.id },
        message,
        agent.finalText,
      );

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "x-conversation-id": convoId,
    },
  });
}
