"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/db/supabase";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="min-h-9 rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-medium hover:bg-ink/5 disabled:opacity-45"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
