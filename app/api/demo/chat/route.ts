import { randomUUID } from "node:crypto";

import { type Content } from "@google/genai";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/db/admin";
import { streamTurn } from "@/lib/agent/chat";
import { isRateLimited } from "@/lib/agent/ratelimit";
import { getLLMProvider } from "@/lib/llm";
import { EmbeddingCache } from "@/lib/llm/cache";
import { readGeminiConfig } from "@/lib/llm/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Public, no-signup demo. Runs as a shared, pre-seeded demo user via the
// service-role client, with a GLOBAL rate limit to bound cost/abuse.
const DEMO_USER_ID = process.env.DEMO_USER_ID ?? "d3f00000-0000-4000-8000-00000000d3f0";
const DEMO_RATE_LIMIT = Number(process.env.DEMO_RATE_LIMIT ?? 40);
const MAX_MESSAGE_LEN = 500;
const HISTORY_LIMIT = 8;

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();

  if (
    await isRateLimited(supabase, {
      stage: "demo.request",
      windowSeconds: 600,
      max: DEMO_RATE_LIMIT,
    })
  ) {
    return NextResponse.json(
      {
        error:
          "The public demo is busy right now (rate-limited). Please try again in a few minutes, or sign in for full access.",
      },
      { status: 429 },
    );
  }

  let body: { message?: unknown; conversationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message =
    typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  let convoId = conversationId;
  if (!convoId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: DEMO_USER_ID, title: `demo: ${message.slice(0, 40)}` })
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

  await supabase
    .from("messages")
    .insert({ conversation_id: convoId, role: "user", content: message });

  const cfg = readGeminiConfig();
  const provider = new EmbeddingCache(getLLMProvider(), supabase, cfg.embedModel);

  return streamTurn({
    supabase,
    provider,
    userId: DEMO_USER_ID,
    requestId: randomUUID(),
    conversationId: convoId,
    message,
    history,
    extractMemory: false,
    profileReadOnly: true,
    stage: "demo.request",
  });
}
