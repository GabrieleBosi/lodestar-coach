import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { isAdminEmail } from "@/lib/auth/admin";
import { computeMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createSupabaseAdminClient();
  const days = 14;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: traces, error } = await admin
    .from("traces")
    .select("stage, latency_ms, tokens, cost_usd, created_at, payload")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(computeMetrics(traces ?? [], days));
}
