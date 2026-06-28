import StatusBadge from "@/components/StatusBadge";

const pillars = [
  {
    title: "Grounded RAG",
    body: "Answers cite the evidence they stand on — retrieved from a curated knowledge base, not improvised.",
  },
  {
    title: "Agentic tools",
    body: "Real tools for planning, logging and computation — the coach can act, not just talk.",
  },
  {
    title: "Evaluated & safe",
    body: "Responses are measured for quality and held to clear safety boundaries.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-16 sm:py-24">
      <header className="flex-1">
        <div className="mb-6">
          <StatusBadge />
        </div>

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Lodestar</h1>

        <p className="mt-4 max-w-2xl text-lg text-stone-600 dark:text-stone-300">
          An evidence-grounded AI coach for training, nutrition &amp; recovery — cited
          answers, real tools, measured quality.
        </p>

        <section className="mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            How it works
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {pillars.map((pillar) => (
              <div
                key={pillar.title}
                className="rounded-xl border border-stone-200 bg-white/50 p-4 dark:border-stone-800 dark:bg-white/5"
              >
                <h3 className="font-semibold">{pillar.title}</h3>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  {pillar.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </header>

      <footer className="mt-16 border-t border-stone-200 pt-6 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">
        <p>
          Lodestar provides general, evidence-based information and is{" "}
          <strong className="font-semibold">NOT medical advice</strong>.
        </p>
      </footer>
    </main>
  );
}
