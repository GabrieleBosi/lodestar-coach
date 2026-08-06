import { randomUUID } from "node:crypto";

import { type Content } from "@google/genai";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { streamTurn } from "@/lib/agent/chat";
import { isRateLimited } from "@/lib/agent/ratelimit";
import { getLLMProvider } from "@/lib/llm";
import { EmbeddingCache } from "@/lib/llm/cache";
import { readGeminiConfig } from "@/lib/llm/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HISTORY_LIMIT = 10;
const RATE_LIMIT_PER_MIN = Number(process.env.CHAT_RATE_LIMIT_PER_MIN ?? 20);

export async function POST(request: Request) {
  const routeStarted = Date.now();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    await isRateLimited(supabase, {
      stage: "chat.request",
      windowSeconds: 60,
      max: RATE_LIMIT_PER_MIN,
      userId: user.id,
    })
  ) {
    return NextResponse.json(
      { error: "You're sending messages too quickly. Please wait a moment and try again." },
      { status: 429 },
    );
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

  // Wrap the provider with the shared EMBEDDING cache. Generation is not cached
  // — see lib/llm/cache.ts and issue #2 (P0-8/P0-9).
  const cfg = readGeminiConfig();
  const provider = new EmbeddingCache(
    getLLMProvider(),
    createSupabaseAdminClient(),
    cfg.embedModel,
  );

  return streamTurn({
    preludeMs: Date.now() - routeStarted,
    supabase,
    provider,
    userId: user.id,
    requestId: randomUUID(),
    conversationId: convoId,
    message,
    history,
    extractMemory: true,
    stage: "chat.request",
  });
}
