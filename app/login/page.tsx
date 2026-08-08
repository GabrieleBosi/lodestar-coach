"use client";

import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/db/supabase";

type Status = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError("");

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
      },
    });

    if (signInError) {
      setError(signInError.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center bg-ground px-6 py-16 text-ink">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent-ink">Lodestar</p>
      <h1 className="mt-2 text-2xl font-medium tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Enter your email and we&apos;ll send you a magic link — no password needed.
      </p>

      {status === "sent" ? (
        <div className="mt-8 rounded-lg border border-line bg-surface p-4 text-sm shadow-[inset_2px_0_0_var(--ok)]">
          <span className="mr-2 text-ok">✓</span>
          Check <strong className="font-medium">{email}</strong> for a sign-in link.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="min-h-11 rounded-lg border border-line bg-surface px-3.5 text-ink outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="mt-2 min-h-11 rounded-lg border border-accent px-5 font-medium text-accent hover:bg-accent-wash disabled:opacity-45"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {status === "error" && <p className="text-sm text-err">{error}</p>}
        </form>
      )}

      <p className="mt-8 font-mono text-[10.5px] text-ink-faint">
        Lodestar provides general, evidence-based information and is NOT medical advice.
      </p>
    </main>
  );
}
