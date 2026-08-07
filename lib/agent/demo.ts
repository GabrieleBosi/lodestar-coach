import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/types";

/**
 * Resolve a client-supplied conversation id for the public demo.
 *
 * The demo runs on the SERVICE-ROLE client, where RLS does not apply, so a
 * conversation id arriving in the request body is an unverified ownership
 * claim: any UUID would otherwise have loaded a signed-in user's thread into
 * the prompt and appended the demo's turns to it. Returns the id only when the
 * conversation exists and belongs to the demo user, and `null` otherwise so the
 * caller starts a fresh conversation — a stale id in a visitor's localStorage
 * should degrade to a new thread, not to an error.
 */
export async function resolveDemoConversation(
  supabase: SupabaseClient<Database>,
  demoUserId: string,
  requestedId: string | null,
): Promise<string | null> {
  if (!requestedId) return null;
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", requestedId)
    .eq("user_id", demoUserId)
    .maybeSingle();
  return data?.id ?? null;
}
