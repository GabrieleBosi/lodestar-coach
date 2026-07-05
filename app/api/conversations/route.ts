import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/db/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/conversations            -> the user's conversations (newest first)
// GET /api/conversations?id=<uuid>  -> messages for one conversation (oldest first)
// RLS restricts everything to the signed-in user.
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");

  if (id) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, role, content, citations, tool_calls, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ messages: data });
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ conversations: data });
}
