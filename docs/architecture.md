# Lodestar — architecture

A deeper look at how Lodestar is built. For the overview, see the
[README](../README.md).

## Data model (Supabase / Postgres + pgvector)

Ten tables under Row-Level Security, all with uuid PKs and `created_at`/`updated_at`:

- `profiles` (1:1 with `auth.users`), `workouts`, `nutrition_logs`, `conversations`,
  `messages`, `memories`, `traces`, `eval_runs`, plus the RAG tables `documents` and
  `chunks` (`embedding vector(1536)`, `content_hash` unique) and an `llm_cache` table.
- **RLS:** users can read/write only their own rows; `documents`/`chunks` are readable by
  any authenticated user but writable only by the service role; `eval_runs` and `llm_cache`
  are service-role only. The service-role key is `import "server-only"` so it can never be
  bundled for the client.
- **Indexes:** HNSW (`vector_cosine_ops`) on `chunks.embedding` and `memories.embedding`;
  a GIN full-text index on `chunks.content`; B-tree indexes on foreign keys and
  `(user_id, date)`.

## Ingestion & retrieval strategy

**Ingestion** (`lib/rag/ingest.ts`, `npm run ingest`):

1. Read `knowledge/*.md`, parse YAML frontmatter, upsert a `documents` row per file.
2. **Markdown-aware chunking** — split on headings (carry the heading path into metadata),
   pack paragraphs to a ~550-token budget with ~15% overlap (≈4 chars/token estimate).
3. `content_hash = sha256(normalized text)` per chunk for **idempotency**: unchanged chunks
   are skipped, changed ones re-embedded, and chunks removed from a doc are deleted.
4. Embed new/changed chunks with `gemini-embedding-2` @1536 dims
   (`taskType: RETRIEVAL_DOCUMENT`) in batches with retry/backoff.

**Retrieval** (`lib/rag/retrieve.ts`) is **hybrid**:

- **Dense**: embed the query (`RETRIEVAL_QUERY` @1536), call the `match_chunks` SQL function
  (cosine distance via pgvector).
- **Lexical**: `match_chunks_keyword` using `websearch_to_tsquery` + `ts_rank`.
- **Fusion**: the two rankings are merged with **Reciprocal Rank Fusion** (RRF, k=60), which
  combines rankings without normalizing cosine-similarity vs. `ts_rank` scales. Returns the
  top-k chunks with source metadata (title, url, heading).

Both SQL functions are `SECURITY INVOKER`, so RLS applies (chunks are readable by
authenticated users).

## Grounded prompt

`lib/rag/prompt.ts` assembles numbered, citable context blocks and instructs the model to
answer **only** from the provided context, cite each claim `[n]`, and reply
_"I don't have enough grounded information on that yet"_ when context is insufficient. The
agent variant (`AGENT_SYSTEM_PROMPT`) adds tool-use and safety guidance.

## Agent loop (Gemini function calling)

`lib/agent/loop.ts` runs a manual multi-step loop:

1. `generateContent` with `tools` (function declarations built from each tool's JSON schema)
   and the system instruction.
2. If the response has `functionCalls`, each is **zod-validated**, executed against the
   user's RLS-scoped Supabase client, and its result fed back as a `functionResponse` turn.
   Tool errors are returned to the model (not thrown) so it can recover or explain.
3. Loop up to `MAX_STEPS` (6); when the model stops calling tools, its text is the answer.

**Tools** (`lib/agent/tools.ts`): `search_knowledge` (hybrid retrieval + citation
accumulation), `log_workout`, `log_nutrition`, `get_history` (time-series over the user's
own logs), `compute_energy_targets`.

**Streaming**: the request pipeline (`lib/agent/chat.ts`) sends a first JSON meta line
(`conversationId`, `sources`, `actions`) then streams the answer; the UI renders the
"actions taken" trace and a sources panel.

## Long-term memory

`lib/agent/memory.ts`: after each turn, the model extracts durable facts/preferences as a
JSON array; new ones are embedded (@1536) and stored in `memories`. Before answering,
`match_memories` (RLS-scoped to the user) plus the profile are injected as personalization
context — so a preference stated in one session is recalled in the next.

## Safety model

- **System prompt**: Lodestar is an evidence-based coach, **not** a medical professional. It
  adds a "not medical advice" reminder to health guidance, refuses diagnosis and
  out-of-scope requests, and responds supportively (no harmful specifics) to unsafe intent
  (crash diets, purging, training through injury).
- **Guardrails in code**: `compute_energy_targets` (`lib/agent/energy.ts`) clamps deficits to
  ≤ 25% and surpluses to ≤ 20% of TDEE, and never returns intake below BMR or a conservative
  absolute floor (1500 kcal male / 1200 female) — returning explicit warnings and a
  `safe: false` flag when a request is clamped. These hold regardless of model behavior.
- **Categories** the eval verifies: in-scope (grounded + cited), out-of-scope (decline +
  redirect), unsafe (refuse supportively), insufficient-context (say so, don't hallucinate).

## Evaluation methodology

`evals/run.ts` (`npm run eval`):

- **Dataset** (`evals/dataset.jsonl`) — 30 golden cases across the four categories, each with
  expected sources, an ideal answer, and a `must_refuse` flag.
- **Retrieval metrics** — hit@k (a correct source in the top-k?) and MRR (reciprocal rank of
  the first correct source).
- **Generation metrics** — each grounded answer is scored 0–1 by an **LLM-as-judge**
  (`gemini-3.1-pro` when available; falls back to the best accessible model and records which)
  on faithfulness, answer relevance, citation correctness, and safety, using a strict rubric
  with `responseMimeType: application/json`.
- **Outputs** — `evals/report.{md,html,json}`, plus the aggregate persisted to `eval_runs`
  with the commit SHA. The runner is resilient: cases it can't judge (e.g., rate limits) are
  marked `n/j` and excluded from aggregates, and a report is always written.
- **CI gate** — `.github/workflows/eval.yml` runs on PRs, comments a score table (this PR vs
  `evals/baseline.json`), and fails the check if faithfulness or safety fall below
  `evals/thresholds.json` (0.85 / 1.0).

## Cost & observability

- **Tracing** — every model call, tool call, retrieval, and request writes a `traces` row
  (stage, real token usage from `usageMetadata`, latency, cost, `request_id`).
- **Metrics** — `lib/metrics.ts` aggregates traces into requests/day, p50/p95 latency,
  tokens & cost/day, tool-usage breakdown, and retrieval hit-rate, served to the admin
  `/app/metrics` dashboard (`ADMIN_EMAILS`).
- **Embedding cache** — `EmbeddingCache` (`lib/llm/cache.ts`) keys **embeddings** by a
  sha256 of `(text, model, dimensions, taskType)` in `llm_cache`. Generation is deliberately
  **not** cached (see below). No TTL and no eviction: rows live forever, which is fine at
  this size but is not a managed cache.
  Measured on the deploy preview, a repeated question hits **about half** the available
  embeddings: each turn embeds twice — the verbatim user message for memory recall, and a
  `search_knowledge` query the model composes itself. The first hits on a repeat; the second
  usually misses, because the agent rephrases its own search ("…growth hormone protein
  synthesis" vs "…hypertrophy protein synthesis"). That missing half is structural and can't
  improve without stabilising query generation.
- **Why generation isn't cached** — see [decision 1](decisions.md#1--generation-is-not-cached-embeddings-are).
- **Rate limiting & degradation** — model calls are wrapped with a timeout + one retry and
  degrade to a friendly message if Gemini stays unavailable. The limiter
  (`lib/agent/ratelimit.ts`) is a **byproduct of tracing**: it counts `traces` rows for a
  stage and window, so if a trace insert fails it **fails open**, and it is check-then-act
  with no lock, so concurrent requests can both observe `count < max` and both proceed. The
  demo cap (40 per 600s) is **global — not per-IP and not per-session** — a deliberate cost
  ceiling on the public demo, not per-visitor fairness: one visitor can exhaust it for
  everyone.

### Deployment note (Gemini on Netlify)

Netlify's AI Gateway transparently proxies `@google/genai` and lacks the embedding model,
which breaks retrieval in production. Setting `GEMINI_BASE_URL=https://generativelanguage.googleapis.com`
pins the direct Google endpoint (via `httpOptions.baseUrl`), restoring full feature support.
A production key with adequate quota (or a paid tier) is recommended, since the free tier's
per-day caps otherwise trigger graceful degradation.
