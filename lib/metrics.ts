/** Trace aggregation for the metrics dashboard (shared by the API + tests). */
export interface TraceRow {
  stage: string | null;
  latency_ms: number | null;
  tokens: number | null;
  cost_usd: number | null;
  created_at: string | null;
  payload: unknown;
}

export interface Metrics {
  days: number;
  generatedAt: string;
  totals: { requests: number; tokens: number; costUsd: number };
  latency: { p50: number; p95: number };
  byDay: { date: string; requests: number; tokens: number; costUsd: number }[];
  tools: { stage: string; count: number }[];
  retrieval: { searches: number; hits: number; hitRate: number };
}

const REQUEST_STAGES = new Set(["chat.request", "demo.request"]);
const TOOL_STAGES = [
  "search_knowledge",
  "log_workout",
  "log_nutrition",
  "get_history",
  "compute_energy_targets",
  "llm.chat",
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export function computeMetrics(rows: TraceRow[], days: number): Metrics {
  const byDay = new Map<string, { requests: number; tokens: number; costUsd: number }>();
  const requestLatencies: number[] = [];
  const toolCounts = new Map<string, number>();
  let totalRequests = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let searches = 0;
  let searchHits = 0;

  for (const r of rows) {
    const stage = r.stage ?? "";
    if (REQUEST_STAGES.has(stage)) {
      const day = (r.created_at ?? "").slice(0, 10);
      const bucket = byDay.get(day) ?? { requests: 0, tokens: 0, costUsd: 0 };
      bucket.requests += 1;
      bucket.tokens += r.tokens ?? 0;
      bucket.costUsd += Number(r.cost_usd ?? 0);
      byDay.set(day, bucket);
      totalRequests += 1;
      totalTokens += r.tokens ?? 0;
      totalCost += Number(r.cost_usd ?? 0);
      if (typeof r.latency_ms === "number") requestLatencies.push(r.latency_ms);
    }
    if (TOOL_STAGES.includes(stage)) {
      toolCounts.set(stage, (toolCounts.get(stage) ?? 0) + 1);
    }
    if (stage === "search_knowledge") {
      searches += 1;
      const summary = (r.payload as { summary?: string } | null)?.summary ?? "";
      const m = /→\s*(\d+)\s*chunk/.exec(summary);
      if (m && Number(m[1]) > 0) searchHits += 1;
    }
  }

  requestLatencies.sort((a, b) => a - b);

  return {
    days,
    generatedAt: new Date().toISOString(),
    totals: {
      requests: totalRequests,
      tokens: totalTokens,
      costUsd: Math.round(totalCost * 1e6) / 1e6,
    },
    latency: { p50: percentile(requestLatencies, 50), p95: percentile(requestLatencies, 95) },
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        requests: v.requests,
        tokens: v.tokens,
        costUsd: Math.round(v.costUsd * 1e6) / 1e6,
      })),
    tools: TOOL_STAGES.map((stage) => ({ stage, count: toolCounts.get(stage) ?? 0 })).filter(
      (t) => t.count > 0,
    ),
    retrieval: {
      searches,
      hits: searchHits,
      hitRate: searches ? Math.round((searchHits / searches) * 100) / 100 : 0,
    },
  };
}
