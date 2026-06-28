import { redirect } from "next/navigation";

import SignOutButton from "@/components/SignOutButton";
import { createSupabaseServerClient } from "@/lib/db/supabase";

// Auth-gated shell. The coaching chat itself arrives in Session 4.
export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-16">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Lodestar</h1>
        <SignOutButton />
      </header>

      <section className="mt-10 rounded-xl border border-stone-200 bg-white/50 p-6 dark:border-stone-800 dark:bg-white/5">
        <p className="text-sm text-stone-500 dark:text-stone-400">Signed in as</p>
        <p className="mt-1 text-lg font-medium">{user.email}</p>
      </section>

      <p className="mt-10 text-stone-600 dark:text-stone-400">
        You&apos;re in. This is the authenticated shell — your coaching workspace (chat, plans,
        logs) is built in the coming sessions.
      </p>

      <footer className="mt-16 border-t border-stone-200 pt-6 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">
        Lodestar provides general, evidence-based information and is{" "}
        <strong className="font-semibold">NOT medical advice</strong>.
      </footer>
    </main>
  );
}
