"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Memory {
  id: string;
  content: string;
  kind: string | null;
  salience: number | null;
  created_at: string;
}

export default function MemoriesView() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/memories");
    if (res.ok) {
      const data = (await res.json()) as { memories: Memory[] };
      setMemories(data.memories ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/memories?id=${id}`, { method: "DELETE" });
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">What the coach remembers</h1>
        <Link
          href="/app"
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          ← Back to chat
        </Link>
      </div>

      <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
        These are durable facts Lodestar has saved to personalize your coaching. Delete anything you
        don&apos;t want remembered.
      </p>

      {loading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : memories.length === 0 ? (
        <p className="text-sm text-stone-500">
          No memories yet. As you chat, Lodestar will remember durable preferences and facts.
        </p>
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => (
            <li
              key={m.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800"
            >
              <span className="text-sm">{m.content}</span>
              <button
                type="button"
                onClick={() => remove(m.id)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
