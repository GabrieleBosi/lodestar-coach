/**
 * Client factories for CLI scripts.
 *
 * These build a SERVICE-ROLE Supabase client directly (rather than importing
 * `lib/db/admin`, which is marked `import "server-only"` and would throw outside
 * Next.js). The service-role key is read from the environment and used only in
 * this server-side CLI context.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../lib/db/types";
import { GeminiProvider, readGeminiConfig } from "../lib/llm/gemini";
import type { LLMProvider } from "../lib/llm/types";

export function createScriptSupabaseAdmin(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Set SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase dashboard → Settings → API).",
    );
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createScriptProvider(): LLMProvider {
  return new GeminiProvider(readGeminiConfig());
}
