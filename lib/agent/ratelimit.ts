import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/types";

/**
 * Simple trace-based rate limiter: counts prior request traces of a given stage
 * within a rolling window. Pass a userId for per-user limits, or omit it for a
 * global cap (used by the public demo).
 */
export async function isRateLimited(
  supabase: SupabaseClient<Database>,
  opts: { stage: string; windowSeconds: number; max: number; userId?: string },
): Promise<boolean> {
  const since = new Date(Date.now() - opts.windowSeconds * 1000).toISOString();
  let query = supabase
    .from("traces")
    .select("id", { count: "exact", head: true })
    .eq("stage", opts.stage)
    .gte("created_at", since);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { count } = await query;
  return (count ?? 0) >= opts.max;
}
