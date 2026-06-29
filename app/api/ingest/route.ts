import path from "node:path";

import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/db/admin";
import { getLLMProvider } from "@/lib/llm";
import { runIngestion } from "@/lib/rag/ingest";

// Reads files + uses node:crypto, so force the Node.js runtime (not Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Admin-only re-index endpoint. Requires the ADMIN_INGEST_TOKEN in the
// `x-admin-ingest-token` header; never publicly callable.
export async function POST(request: Request) {
  const expected = process.env.ADMIN_INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Ingestion is not configured (ADMIN_INGEST_TOKEN unset)." },
      { status: 503 },
    );
  }

  const provided = request.headers.get("x-admin-ingest-token");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const provider = getLLMProvider();
    const knowledgeDir = path.join(process.cwd(), "knowledge");
    const summary = await runIngestion({ supabase, provider, knowledgeDir });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Ingestion failed" },
      { status: 500 },
    );
  }
}
