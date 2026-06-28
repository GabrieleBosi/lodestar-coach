import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/db/supabase";

// Magic-link / PKCE callback: exchanges the `code` for a session cookie, then
// redirects to `next` (defaults to /app).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
