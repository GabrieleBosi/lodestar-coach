import Link from "next/link";

import StatusBadge from "@/components/StatusBadge";

const highlights = [
  {
    kicker: "01 · Grounded",
    title: "Grounded & cited",
    body: "Every factual answer is retrieved from a curated knowledge base and cited [n] — no improvised claims.",
  },
  {
    kicker: "02 · Agentic",
    title: "Agentic tools",
    body: "It logs your workouts, reads your history, and computes safe energy targets — not just chat.",
  },
  {
    kicker: "03 · Measured",
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

/** Static resolved-marker rendering for the specimen (matches AnswerBody's resolved state). */
function Cite({ n }: { n: number }) {
  return (
    <sup className="mx-0.5 align-super font-mono text-[10px] font-medium leading-none text-accent-ink">
      [{n}]
    </sup>
  );
}

/** Baseline figures — real numbers from evals/baseline.json @ 6422a13. */
const stats = [
  { value: "1.00", label: "faithfulness" },
  { value: "1.00", label: "safety" },
  { value: "0.97", label: "retrieval MRR" },
  { value: "36", label: "eval cases" },
];

export default function Home() {
  return (
    <main className="bg-ground text-ink">
      {/* Nav */}
      <nav className="mx-auto flex h-16 max-w-5xl items-center gap-5 px-6">
        <span className="mr-auto flex items-baseline gap-4">
          <span className="font-medium tracking-tight">Lodestar</span>
          <span className="hidden sm:inline">
            <StatusBadge />
          </span>
        </span>
        <a
          href="https://github.com/GabrieleBosi/lodestar-coach"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[12.5px] text-ink-muted no-underline hover:text-accent-ink"
        >
          GitHub
        </a>
        <Link
          href="/login"
          className="font-mono text-[12.5px] text-ink-muted no-underline hover:text-accent-ink"
        >
          Sign in
        </Link>
        <Link
          href="/demo"
          className="hidden min-h-11 items-center rounded-lg border border-accent px-4 text-sm font-medium text-accent no-underline hover:bg-accent-wash sm:flex"
        >
          Try the demo →
        </Link>
      </nav>

      {/* Hero: copy + live specimen */}
      <section className="mx-auto grid max-w-5xl gap-10 px-6 py-14 sm:py-20 lg:grid-cols-[1fr_420px] lg:items-center">
        <div>
          <h1 className="text-[44px] font-medium leading-[1.05] tracking-tight sm:text-[62px]">
            Lodestar
          </h1>
          <p className="mt-4 max-w-xl text-lg text-ink-muted sm:text-xl">
            An evidence-grounded AI coach for training, nutrition &amp; recovery — cited answers,
            real tools, measured quality.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/demo"
              className="flex min-h-11 items-center rounded-lg border border-accent px-5 font-medium text-accent no-underline hover:bg-accent-wash"
            >
              Try the demo →
            </Link>
            <Link
              href="/login"
              className="flex min-h-11 items-center rounded-lg border border-line px-5 font-medium no-underline hover:bg-ink/5"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-3 text-sm text-ink-faint">
            The demo needs no signup — it&apos;s pre-seeded with a demo athlete&apos;s history.
          </p>
        </div>

        {/*
          The specimen is eval case `in-03` VERBATIM from evals/baseline.json —
          a real question, the answer the deployed pipeline produced, the source
          it actually cited. If the baseline is re-judged and this answer
          changes, update the excerpt; the caption names its provenance so a
          reader can check. Never replace with invented copy (repo rule:
          nothing presented as the product may be fabricated).
        */}
        <figure className="relative overflow-hidden rounded-xl border border-line-faint bg-surface p-5 shadow-[var(--shadow-pop)]">
          <div className="mb-3 flex justify-end">
            <span className="max-w-[85%] rounded-[10px] bg-bubble px-3.5 py-2 text-sm">
              How should I structure a deload week?
            </span>
          </div>
          <div className="space-y-2 text-sm leading-[1.65] text-ink/85">
            <p>
              A deload week typically lasts about one week and reduces training stress while keeping
              movement patterns sharp <Cite n={1} />.
            </p>
            <p>You can structure a deload week using one of three common approaches:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong className="font-semibold">Reduce volume:</strong> Cut your working sets
                roughly by half while keeping the load moderate <Cite n={1} />.
              </li>
              <li>
                <strong className="font-semibold">Reduce intensity:</strong> Keep your normal set
                count, but drop the load to about 60–70% of normal <Cite n={1} />.
              </li>
              <li>
                <strong className="font-semibold">Reduce both modestly:</strong> Apply a gentler
                trim to both your sets and your load <Cite n={1} />.
              </li>
            </ul>
          </div>
          {/* fade-out crop */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-[52px] h-16"
            style={{ background: "linear-gradient(to bottom, transparent, var(--surface))" }}
            aria-hidden="true"
          />
          <div className="relative mt-3 border-t border-line-faint pt-2.5">
            <div className="font-mono text-[10.5px] text-accent-ink">
              [1] Periodization and Deloads · en.wikipedia.org
            </div>
            <figcaption className="mt-1 font-mono text-[10px] text-ink-faint">
              Verbatim from evals/baseline.json · in-03
            </figcaption>
          </div>
        </figure>
      </section>

      {/* Highlights */}
      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-14 sm:grid-cols-3">
        {highlights.map((h) => (
          <div key={h.title} className="rounded-xl border border-line-faint p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent-ink">
              {h.kicker}
            </div>
            <h2 className="mt-2 font-medium">{h.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{h.body}</p>
          </div>
        ))}
      </section>

      {/* Stat band — real baseline figures, provenance in the caption */}
      <section className="bg-section text-[#e9e9ed]">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="font-mono text-[34px] font-medium leading-none tabular-nums">
                  {s.value}
                </div>
                <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#e9e9ed]/60">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 font-mono text-[10.5px] text-[#e9e9ed]/60">
            Baseline eval @ 6422a13 · gates faithfulness ≥ 0.85, safety = 1.0 · full methodology in
            the repo
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-14">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          How it works
        </h2>
        <div className="mt-5">
          {howItWorks.map((s, i) => (
            <div
              key={s.name}
              className={`grid gap-2 py-5 sm:grid-cols-[64px_200px_1fr] sm:gap-6 ${
                i > 0 ? "border-t border-line-faint" : ""
              }`}
            >
              <div className="font-mono text-[13px] text-accent-ink">0{s.step}</div>
              <h3 className="font-medium">{s.name}</h3>
              <p className="text-sm text-ink-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Close CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-14 text-center">
        <Link
          href="/demo"
          className="inline-flex min-h-11 items-center rounded-lg border border-accent px-6 font-medium text-accent no-underline hover:bg-accent-wash"
        >
          Try the demo →
        </Link>
      </section>

      <footer className="border-t border-line-faint">
        <p className="mx-auto max-w-5xl px-6 py-6 text-center font-mono text-[10.5px] text-ink-faint">
          Lodestar provides general, evidence-based information and is{" "}
          <strong className="font-medium text-warn">NOT medical advice</strong>. Consult a qualified
          professional for your individual circumstances.
        </p>
      </footer>
    </main>
  );
}
