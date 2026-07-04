import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/types";
import { estimateCostUsd, estimateTokens } from "@/lib/llm/cost";
import { getLLMProvider } from "@/lib/llm";
import { buildGroundedPrompt } from "@/lib/rag/prompt";
import { retrieve } from "@/lib/rag/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Streamed grounded RAG chat.
// Response body: one JSON meta line (conversationId + sources) terminated by
// "\n", then the assistant's answer streamed as plain text.
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

  // Ensure a conversation (RLS ties it to the current user).
  let convoId = conversationId;
  if (!convoId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: message.slice(0, 60) })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    convoId = data.id;
  }

  // Persist the user turn.
  const { error: userMsgErr } = await supabase.from("messages").insert({
    conversation_id: convoId,
    role: "user",
    content: message,
  });
  if (userMsgErr) {
    return NextResponse.json({ error: userMsgErr.message }, { status: 500 });
  }

  const provider = getLLMProvider();

  let citations;
  let system: string;
  let userPrompt: string;
  try {
    const chunks = await retrieve(supabase, provider, message, 6);
    const grounded = buildGroundedPrompt(message, chunks);
    citations = grounded.citations;
    system = grounded.system;
    userPrompt = grounded.user;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Retrieval failed" },
      { status: 500 },
    );
  }

  const meta = { conversationId: convoId, sources: citations };
  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(meta) + "\n"));

      let answer = "";
      try {
        for await (const piece of provider.generateStream(userPrompt, {
          system,
          temperature: 0.3,
        })) {
          answer += piece;
          controller.enqueue(encoder.encode(piece));
        }
      } catch {
        const note = "\n\n[The response was interrupted. Please try again.]";
        answer += note;
        controller.enqueue(encoder.encode(note));
      }

      // Persist the assistant turn with observability metadata.
      const tokensIn = estimateTokens(`${system}\n${userPrompt}`);
      const tokensOut = estimateTokens(answer);
      await supabase.from("messages").insert({
        conversation_id: convoId,
        role: "assistant",
        content: answer,
        citations: citations as unknown as Json,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        latency_ms: Date.now() - started,
        cost_usd: estimateCostUsd(tokensIn, tokensOut),
      });
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convoId);

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
