import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/db/supabase";
import type { TablesInsert } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NUMERIC_FIELDS = ["age", "height_cm", "weight_kg"] as const;
const STRING_FIELDS = ["display_name", "goals", "sex", "activity_level", "units"] as const;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, units, goals, sex, age, height_cm, weight_kg, activity_level")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const row: Record<string, unknown> = { id: user.id };
  for (const f of STRING_FIELDS) {
    if (typeof body[f] === "string") row[f] = (body[f] as string).trim() || null;
  }
  for (const f of NUMERIC_FIELDS) {
    const v = body[f];
    if (v === "" || v === null || v === undefined) row[f] = null;
    else if (Number.isFinite(Number(v))) row[f] = Number(v);
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(row as TablesInsert<"profiles">, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
