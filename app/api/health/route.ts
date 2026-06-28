import { NextResponse } from "next/server";

import { DEFAULTS } from "@/lib/llm/gemini";

// Report-only health endpoint: it intentionally does NOT call the model, so it
// stays cheap and fast and works without a live API key.
export const dynamic = "force-dynamic";

export function GET() {
  const embedDim = Number(process.env.EMBED_DIM ?? DEFAULTS.embedDim);

  return NextResponse.json({
    ok: true,
    chatModel: process.env.GEMINI_CHAT_MODEL ?? DEFAULTS.chatModel,
    embedModel: process.env.GEMINI_EMBED_MODEL ?? DEFAULTS.embedModel,
    embedDim: Number.isFinite(embedDim) ? embedDim : DEFAULTS.embedDim,
    time: new Date().toISOString(),
  });
}
