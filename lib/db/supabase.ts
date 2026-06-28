/**
 * Supabase clients for Next.js, built on "@supabase/ssr".
 *
 * - `createSupabaseBrowserClient()` — for Client Components.
 * - `createSupabaseServerClient()` — for Server Components, Route Handlers and
 *   Server Actions; reads/writes the auth cookies via next/headers.
 *
 * Both use the public anon key. The service-role key lives in `./admin` and must
 * never be imported here (this module is reachable from the browser bundle).
 *
 * Note: the spec named these env vars SUPABASE_URL / SUPABASE_ANON_KEY, but
 * Next.js only exposes NEXT_PUBLIC_-prefixed vars to the browser, which the
 * browser client requires — hence NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY.
 */
import { createBrowserClient, createServerClient } from "@supabase/ssr";

import type { Database } from "./types";

function getPublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return { url, anonKey };
}

export function createSupabaseBrowserClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}

export async function createSupabaseServerClient() {
  // Imported lazily so this module stays safe to import from Client Components.
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll was called from a Server Component, where cookies are
          // read-only. The middleware refreshes the session cookies instead,
          // so this is safe to ignore.
        }
      },
    },
  });
}
