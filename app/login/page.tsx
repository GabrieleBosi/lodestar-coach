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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Sign in to Lodestar</h1>
      <p className="mt-2 text-stone-600 dark:text-stone-400">
        Enter your email and we&apos;ll send you a magic link — no password needed.
      </p>

      {status === "sent" ? (
        <div className="mt-8 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          Check <strong>{email}</strong> for a sign-in link.
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
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="mt-2 rounded-lg bg-stone-900 px-4 py-2 font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {status === "error" && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      )}

      <p className="mt-8 text-xs text-stone-500 dark:text-stone-500">
        Lodestar provides general, evidence-based information and is NOT medical advice.
      </p>
    </main>
  );
}
