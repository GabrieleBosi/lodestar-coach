import Link from "next/link";

import StatusBadge from "@/components/StatusBadge";

const highlights = [
  {
    title: "Grounded & cited",
    body: "Every factual answer is retrieved from a curated knowledge base and cited [n] — no improvised claims.",
  },
  {
    title: "Agentic tools",
    body: "It logs your workouts, reads your history, and computes safe energy targets — not just chat.",
  },
  {
    title: "Evaluated & safe",
    body: "A golden-set eval scores faithfulness, citations, and safety on every change, with guardrails against unsafe advice.",
  },
];

const howItWorks = [
  {
    step: "1",
    name: "Grounded RAG",
    body: "Hybrid vector + keyword search pulls the most relevant evidence, which the model must answer from and cite.",
  },
  {
    step: "2",
    name: "Agent + memory",
    body: "Gemini function-calling picks tools (search, log, history, energy targets) and remembers your preferences across sessions.",
  },
  {
    step: "3",
    name: "Evaluated",
    body: "An LLM-as-judge harness gates quality — faithfulness ≥ 0.85 and safety = 1.0 — so regressions can't ship.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 sm:py-20">
      <div className="mb-6">
        <StatusBadge />
      </div>

      <section className="max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Lodestar</h1>
        <p className="mt-4 text-lg text-stone-600 dark:text-stone-300 sm:text-xl">
          An evidence-grounded AI coach for training, nutrition &amp; recovery — cited answers, real
          tools, measured quality.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/demo"
            className="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500"
          >
            Try the demo →
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-stone-300 px-5 py-2.5 font-medium transition hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Sign in
          </Link>
        </div>
        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
          The demo needs no signup — it&apos;s pre-seeded with a demo athlete&apos;s history.
        </p>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-3">
        {highlights.map((h) => (
          <div
            key={h.title}
            className="rounded-xl border border-stone-200 bg-white/50 p-5 dark:border-stone-800 dark:bg-white/5"
          >
            <h2 className="font-semibold">{h.title}</h2>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{h.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-16">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
          How it works
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {howItWorks.map((s) => (
            <div
              key={s.name}
              className="rounded-xl border border-stone-200 p-5 dark:border-stone-800"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-sm font-bold text-white dark:bg-stone-100 dark:text-stone-900">
                {s.step}
              </div>
              <h3 className="mt-3 font-semibold">{s.name}</h3>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-16 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        Lodestar provides general, evidence-based information and is{" "}
        <strong className="font-semibold">NOT medical advice</strong>. Consult a qualified
        professional for your individual circumstances.
      </footer>
    </main>
  );
}
