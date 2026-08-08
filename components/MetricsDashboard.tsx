"use client";

import { useEffect, useState } from "react";

interface Metrics {
  days: number;
  totals: { requests: number; tokens: number; costUsd: number };
  latency: { p50: number; p95: number };
  byDay: { date: string; requests: number; tokens: number; costUsd: number }[];
  tools: { stage: string; count: number }[];
  retrieval: { searches: number; hits: number; hitRate: number };
}

/**
 * Locale-independent formatting.
 *
 * `toLocaleString()` uses the *viewer's* locale, so 63705 tokens rendered as
 * "63.705" next to a "$0.0292" cost — the same page reading as both European
 * and US number formatting, where "63.705" looks like a decimal (issue #2, P1).
 * Costs were also inconsistent between the summary (4 dp) and the table (5 dp).
 */
const formatCount = (n: number) => n.toLocaleString("en-US");
const formatUsd = (n: number) => `$${n.toFixed(4)}`;

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
      <div className="text-xs uppercase tracking-wider text-stone-500 dark:text-stone-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-stone-500">{sub}</div> : null}
    </div>
  );
}

function BarChart({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{label}</h3>
      {data.length === 0 ? (
        <p className="text-xs text-stone-500">No data yet.</p>
      ) : (
        // A three-column grid, not a flex row. The row used to be
        // `w-20 shrink-0` for the label with no overflow handling, so a name
        // longer than 80px — `compute_energy_targets` is 22 characters — spilled
        // out of its box and rendered underneath the bar and the value, leaving
        // neither readable. The bar's percentage also resolved against the whole
        // row rather than the space left over, so it competed with the label and
        // the value for width. Measured on the real chart (408px wide at a
        // 1536px viewport, production tool counts): the longest bar asked for
        // the full 408px and flexbox shrank it back to the 292.6px actually
        // left, so every bar over-reported by a constant 408/292.6 = 1.39x —
        // search_knowledge is 34.5% of the max and rendered at 48.1% of the
        // longest bar, get_history 21.8% at 30.5%, compute_energy_targets 4.4%
        // at 6.1%.
        //
        // Grid columns cannot overlap, the label column truncates rather than
        // spilling, and the bar sits inside a track that owns exactly the
        // remaining space, so `value / max` is the fraction of that track.
        //
        // The value column is `minmax(3.5rem,auto)` rather than `auto` because
        // each row is its own grid: an auto column sized to each row's own digit
        // count, so the 1fr tracks differed by up to 13px between rows and bars
        // drifted by up to 1pp against each other. 3.5rem clears the widest
        // realistic value (`146,549` at text-xs tabular-nums) and falls back to
        // auto beyond it. Measured after: every track 192px, spread 0.00px.
        <ul className="space-y-1">
          {data.map((d) => (
            <li
              key={d.label}
              className="grid grid-cols-[minmax(0,9rem)_1fr_minmax(3.5rem,auto)] items-center gap-2 text-xs"
            >
              <span className="truncate text-stone-500" title={d.label}>
                {d.label}
              </span>
              <span
                className="h-4 w-full"
                role="img"
                aria-label={`${d.label}: ${formatCount(d.value)}`}
              >
                <span
                  className="block h-full rounded bg-emerald-500/80"
                  style={{ width: `${(d.value / max) * 100}%`, minWidth: d.value ? "2px" : "0" }}
                />
              </span>
              <span className="text-right tabular-nums text-stone-600 dark:text-stone-300">
                {formatCount(d.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MetricsDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/metrics")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        return (await res.json()) as Metrics;
      })
      .then(setMetrics)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "failed"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Metrics</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {/*
              A <code> element, not backticks: JSX text is not markdown, so the
              backticks rendered literally on the page. Sized to inherit rather
              than the browser default monospace scale, so it reads as part of
              the sentence.
            */}
            Live usage from the <code className="font-mono text-[0.95em]">traces</code> table (last{" "}
            {metrics?.days ?? 14} days).
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : metrics ? (
        <div className="space-y-8">
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label="Requests" value={String(metrics.totals.requests)} />
            <Card label="Tokens" value={formatCount(metrics.totals.tokens)} />
            <Card label="Est. cost" value={formatUsd(metrics.totals.costUsd)} />
            <Card
              label="Latency"
              value={`${(metrics.latency.p50 / 1000).toFixed(1)}s`}
              sub={`p95 ${(metrics.latency.p95 / 1000).toFixed(1)}s`}
            />
          </section>

          <section className="grid gap-8 sm:grid-cols-2">
            <BarChart
              label="Requests per day"
              data={metrics.byDay.map((d) => ({ label: d.date.slice(5), value: d.requests }))}
            />
            <BarChart
              label="Tokens per day"
              data={metrics.byDay.map((d) => ({ label: d.date.slice(5), value: d.tokens }))}
            />
            <BarChart
              label="Tool usage"
              data={metrics.tools.map((t) => ({ label: t.stage, value: t.count }))}
            />
            <div>
              <h3 className="mb-2 text-sm font-semibold">Retrieval hit-rate</h3>
              <div className="text-3xl font-bold">
                {(metrics.retrieval.hitRate * 100).toFixed(0)}%
              </div>
              <p className="text-xs text-stone-500">
                {metrics.retrieval.hits}/{metrics.retrieval.searches} knowledge searches returned
                context
              </p>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Cost per day</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500">
                  <th className="py-1">Date</th>
                  <th>Requests</th>
                  <th>Tokens</th>
                  <th>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {metrics.byDay.map((d) => (
                  <tr key={d.date} className="border-t border-stone-200 dark:border-stone-800">
                    <td className="py-1">{d.date}</td>
                    <td className="tabular-nums">{d.requests}</td>
                    <td className="tabular-nums">{formatCount(d.tokens)}</td>
                    <td className="tabular-nums">{formatUsd(d.costUsd)}</td>
                  </tr>
                ))}
                {metrics.byDay.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-stone-500">
                      No requests recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </main>
  );
}
