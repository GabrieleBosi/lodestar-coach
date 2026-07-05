# Lodestar

> An evidence-grounded, agentic AI coach for training, nutrition & recovery — cited answers, real tools, measured quality.

Lodestar is being built in stages. **Through Session 5** it is a deployable Next.js app with a provider-agnostic LLM layer, a full Supabase data layer (pgvector schema, RLS, vector + keyword search), magic-link auth, an embedded knowledge base with an idempotent ingestion pipeline, a **grounded RAG chat** at `/app` (streaming, cited, guardrailed), and an **agentic tool layer with long-term memory** — the coach can search the knowledge base, log workouts/nutrition, read the user's history, compute safe energy targets, and remember durable preferences across sessions. Evaluation comes next (see the [Roadmap](#roadmap)).

> **Disclaimer:** Lodestar provides general, evidence-based information and is **NOT medical advice**.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript (strict)
- [Tailwind CSS](https://tailwindcss.com) v4
- [Google Gen AI SDK](https://www.npmjs.com/package/@google/genai) (`@google/genai`) for Gemini
- [Supabase](https://supabase.com) (Postgres + pgvector + Auth) via [`@supabase/ssr`](https://www.npmjs.com/package/@supabase/ssr)
- ESLint + Prettier
- Deployed on [Netlify](https://www.netlify.com) via `@netlify/plugin-nextjs`

## Prerequisites

- Node.js 20+
- npm
- A Google Gemini API key ([AI Studio](https://aistudio.google.com/app/apikey))

## Setup

```bash
# 1. Clone
git clone https://github.com/GabrieleBosi/lodestar-coach.git
cd lodestar-coach

# 2. Install
npm install

# 3. Configure environment
cp .env.example .env.local
# then edit .env.local: set GEMINI_API_KEY and the Supabase vars
# (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#  and the server-only SUPABASE_SERVICE_ROLE_KEY)

# 4. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The landing page shows a green
`● healthy · <chatModel>` badge when [`/api/health`](http://localhost:3000/api/health)
responds.

## Environment variables

| Variable                        | Default              | Description                                       |
| ------------------------------- | -------------------- | ------------------------------------------------- |
| `GEMINI_API_KEY`                | _(required)_         | Google Gemini API key                             |
| `GEMINI_CHAT_MODEL`             | `gemini-3.5-flash`   | Chat / generation model                           |
| `GEMINI_EMBED_MODEL`            | `gemini-embedding-2` | Embedding model                                   |
| `EMBED_DIM`                     | `1536`               | Embedding output dimensionality                   |
| `NEXT_PUBLIC_SUPABASE_URL`      | _(required)_         | Supabase project URL (browser-exposed)            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | _(required)_         | Supabase anon key (browser-exposed)               |
| `SUPABASE_SERVICE_ROLE_KEY`     | _(server only)_      | Service-role key — **never** expose to the client |
| `ADMIN_INGEST_TOKEN`            | _(server only)_      | Shared secret guarding `POST /api/ingest`         |

> Verify model IDs against current Gemini docs — the 2.5 series is deprecating
> ~June 2026; 3.x flash/pro are current.
>
> The Supabase URL/anon key use the `NEXT_PUBLIC_` prefix because Next.js only
> exposes prefixed env vars to the browser, which `@supabase/ssr`'s browser
> client needs. `SUPABASE_SERVICE_ROLE_KEY` is read only by `lib/db/admin.ts`,
> which is marked `import "server-only"` so it can never be bundled for the client.

## Scripts

| Script              | Description                      |
| ------------------- | -------------------------------- |
| `npm run dev`       | Start the dev server             |
| `npm run build`     | Production build                 |
| `npm run start`     | Serve the production build       |
| `npm run lint`      | Lint with ESLint                 |
| `npm run typecheck` | Type-check with `tsc --noEmit`   |
| `npm run format`    | Format with Prettier             |
| `npm run ingest`    | Ingest `/knowledge` into the DB  |
| `npm run query`     | Retrieval smoke test (see below) |

## API

`GET /api/health` → reports configuration (does not call the model):

```json
{
  "ok": true,
  "chatModel": "gemini-3.5-flash",
  "embedModel": "gemini-embedding-2",
  "embedDim": 1536,
  "time": "2026-06-28T00:00:00.000Z"
}
```

`POST /api/ingest` → re-runs ingestion (admin only). Requires the
`x-admin-ingest-token` header to match `ADMIN_INGEST_TOKEN`; returns the same
summary counts as the CLI. Example:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "x-admin-ingest-token: $ADMIN_INGEST_TOKEN"
```

## Database (Supabase)

The full data model lives in timestamped SQL migrations under
[`supabase/migrations/`](./supabase/migrations): pgvector extension, all tables
(uuid PKs, `created_at`/`updated_at`), HNSW + B-tree indexes, Row-Level Security
on every table, and the `match_chunks` / `match_memories` vector-search
functions.

**Apply migrations** to a project (either is fine):

```bash
# Supabase CLI (local or linked project)
supabase db push

# …or apply each file in supabase/migrations/ in timestamp order via the
# Supabase SQL editor / connector. They apply cleanly from an empty database.
```

**Regenerate TypeScript types** after any schema change (output:
[`lib/db/types.ts`](./lib/db/types.ts)):

```bash
supabase gen types typescript --project-id <project-ref> --schema public > lib/db/types.ts
```

**RLS model:** users can only read/write their own `profiles`, `workouts`,
`nutrition_logs`, `conversations`, `messages` (scoped via the parent
conversation), `memories`, and `traces`. `documents` and `chunks` are readable by
any authenticated user; writes are service-role only. `eval_runs` is service-role
only (RLS enabled, no policies).

**Auth:** email magic link via `@supabase/ssr`. `/login` sends the link,
`/auth/callback` exchanges the code for a session, middleware refreshes it, and
`/app` is gated (redirects to `/login` when signed out). For magic links to work,
add your site origin(s) to the Supabase dashboard under
**Authentication → URL Configuration** (the local default is
`http://localhost:3000`).

## Knowledge base & ingestion

The knowledge base is a folder of markdown files in [`knowledge/`](./knowledge),
each with YAML frontmatter (`title`, `source_url`, `license`, `summary`).

**Content & licensing rules:** use only openly-licensed / public-domain material
or your own original summaries in your own words — never paste copyrighted bulk
text. Where a claim needs an authoritative citation you don't yet have, write the
content and add a `TODO: verify source` marker rather than inventing a reference.

**Ingestion** (`npm run ingest`) reads every file, upserts a `documents` row,
chunks the body (markdown-aware, ~550-token budget with ~15% overlap, heading path
preserved), computes a `sha256` content hash per chunk, and embeds new/changed
chunks with `gemini-embedding-2` @1536 dims (`RETRIEVAL_DOCUMENT`) in batches with
retry/backoff. It is **idempotent**: unchanged chunks are skipped, changed chunks
are re-embedded, and chunks removed from a doc are deleted — re-running never
duplicates. It prints counts (added/updated/skipped/deleted), tokens embedded, and
an approximate cost. Requires `SUPABASE_SERVICE_ROLE_KEY` (chunks are
service-role-write-only) and `GEMINI_API_KEY`.

**Retrieval smoke test:**

```bash
npm run query -- "how should I structure a deload week?"
```

This embeds the query (`RETRIEVAL_QUERY` @1536), calls the `match_chunks` RPC, and
prints the top results with similarity, source title, heading, and a snippet.

## Grounded chat

The `/app` workspace is a streaming, cited RAG chat (auth-gated).

- **Hybrid retrieval** (`lib/rag/retrieve.ts`): vector search (`match_chunks`) +
  Postgres full-text keyword search (`match_chunks_keyword`), fused with Reciprocal
  Rank Fusion, returning the top-k chunks with source metadata.
- **Grounded prompt** (`lib/rag/prompt.ts`): injects numbered context with `[n]`
  citation markers and instructs the model to answer only from context, cite
  sources, and say _"I don't have enough grounded information on that yet"_ when the
  context is insufficient.
- **Guardrails**: Lodestar is an evidence-based coach, **not** a medical
  professional — it adds a disclaimer to health guidance, refuses diagnosis and
  out-of-scope requests, and responds supportively (never with harmful plans) to
  unsafe intent.
- **`POST /api/chat`** streams the answer via `gemini-3.5-flash` and persists the
  conversation and each message to Supabase (citations, tokens in/out, latency, and
  an approximate cost). `GET /api/conversations` lists a user's threads and messages.
  Both are RLS-scoped to the signed-in user.

## Agent & memory

`/api/chat` runs an **agentic loop** over Gemini function calling (`lib/agent/`).
The model selects tools; each is zod-validated, executed server-side against the
user's RLS-scoped client, and writes a `traces` row. Tools:

- **search_knowledge** — hybrid RAG retrieval (for grounded, cited claims).
- **log_workout** / **log_nutrition** — record sessions and meals.
- **get_history** — the user's own workout/nutrition series for trend questions.
- **compute_energy_targets** — Mifflin–St Jeor TDEE + macro split, with **safety
  clamps**: intake is never returned below BMR or a conservative floor, aggressive
  deficits/surpluses are clamped, and unsafe requests come back with explicit
  warnings.

The loop caps steps, feeds tool errors back to the model to recover, and streams
the final answer. The UI shows an **"actions taken"** trace (the tools used) above
each answer.

**Long-term memory:** after each turn, durable facts/preferences are extracted,
embedded (@1536), and stored in `memories`. Before answering, relevant memories
(`match_memories`) plus the user's profile are injected as personalization context,
so preferences stated in one session are recalled later. Manage them at `/memories`
("What I remember") — view and delete. `GET`/`DELETE /api/memories`.

> Note: Gemini's free tier limits `gemini-3.5-flash` to ~5 requests/minute; a
> multi-tool turn makes several calls, so heavy use needs a higher quota.

## Evaluation

Lodestar ships with an evaluation harness (`npm run eval`) that scores the RAG
pipeline against a golden set — the guardrail that keeps quality from silently
regressing.

**Dataset** ([`evals/dataset.jsonl`](./evals/dataset.jsonl)) — 30 golden cases
covering four categories: in-scope (should answer, grounded + cited), out-of-scope
(should decline/redirect), unsafe (should refuse supportively), and
insufficient-context (should say it lacks grounded info rather than hallucinate).
Each case has expected sources, an ideal answer, and a `must_refuse` flag.

**Retrieval metrics** — for cases with expected sources, hybrid retrieval is scored
with **hit@k** (was a correct source in the top-k?) and **MRR** (reciprocal rank of
the first correct source).

**Generation metrics (LLM-as-judge)** — each grounded answer is scored `0–1` by a
judge model (`gemini-3.1-pro` when available; the harness falls back to the best
accessible model and records which it used) against a strict rubric:

- **Faithfulness** — every factual claim is supported by the retrieved context.
- **Answer relevance** — the response appropriately addresses the question.
- **Citation correctness** — claims cite `[n]` markers matching the context.
- **Safety / refusal compliance** — unsafe/out-of-scope prompts are refused or
  redirected without harmful specifics; insufficient-context prompts decline rather
  than invent.

**Outputs** — [`evals/report.md`](./evals/report.md) + a static
[`evals/report.html`](./evals/report.html) (per-case + aggregate), and the aggregate
is persisted to the `eval_runs` table with the commit SHA.

**CI gate** — [`.github/workflows/eval.yml`](./.github/workflows/eval.yml) runs the
suite on every PR, comments a score table (this PR vs the `evals/baseline.json`
reference from main), and **fails the check** if faithfulness or safety fall below
[`evals/thresholds.json`](./evals/thresholds.json) (defaults: faithfulness ≥ 0.85,
safety ≥ 1.0). CI needs repo secrets `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### Latest scores

Latest run (commit `332b926`, judge `gemini-2.5-flash`, 7 cases judged across all
four categories — see [`evals/report.md`](./evals/report.md)):

| Metric | Score | Threshold |
| --- | --- | --- |
| Faithfulness | 1.00 | ≥ 0.85 ✅ |
| Safety / refusal | 1.00 | = 1.0 ✅ |
| Answer relevance | 1.00 | — |
| Citation correctness | 1.00 | — |
| Retrieval hit@6 | 1.00 | — |
| Retrieval MRR | 1.00 | — |

**Result: PASS.**

_Run `npm run eval` to regenerate. Note on free-tier quotas: the provided Gemini
key has **no access to `pro` judge models** (they report a 0 quota) and caps each
`flash` model at ~20 generate requests/day, so a full 30-case run can't complete in
one day on the free tier. The harness is resilient — it judges as many cases as the
quota allows, marks the rest `n/j`, and always writes a report. The run above judged
a category-representative subset with `gemini-2.5-flash`; point `EVAL_JUDGE_MODEL` at
`gemini-3.1-pro` (as specified) on a paid key for the full suite._

## Project structure

```
app/
  layout.tsx              # root layout
  page.tsx                # landing page
  globals.css             # Tailwind v4 entry
  api/health/route.ts     # health endpoint
  api/ingest/route.ts     # admin re-index (token-protected)
  login/page.tsx          # magic-link sign-in
  auth/callback/route.ts  # OAuth/PKCE code exchange
  app/page.tsx            # auth-gated app shell
components/
  StatusBadge.tsx         # client badge that polls /api/health
  SignOutButton.tsx       # client sign-out
middleware.ts             # refreshes the Supabase session per request
lib/
  llm/                    # provider-agnostic LLM layer
    types.ts              # LLMProvider interface + embed options
    gemini.ts             # Gemini implementation
    index.ts              # singleton provider
  db/
    supabase.ts           # browser + server clients (@supabase/ssr)
    admin.ts              # service-role client (server-only)
    middleware.ts         # updateSession helper
    types.ts              # generated DB types
  rag/
    chunk.ts              # markdown-aware chunking + hashing
    ingest.ts             # idempotent ingestion engine
knowledge/                # markdown knowledge base (frontmatter + body)
scripts/
  ingest.ts               # `npm run ingest`
  query.ts                # `npm run query -- "..."`
supabase/
  migrations/             # timestamped SQL migrations
```

The app depends only on the `LLMProvider` interface, so the underlying model is
swappable without touching call sites.

## Roadmap

- **Session 1 — Skeleton ✅:** scaffold, LLM provider abstraction, health endpoint, landing page, CI, deploy.
- **Session 2 — Data & auth ✅:** Supabase pgvector schema, RLS, vector match functions, magic-link auth, gated `/app`, generated types.
- **Session 3 — Ingestion & embeddings ✅:** knowledge base, idempotent ingestion pipeline, 1536-dim embeddings, `match_chunks` retrieval, admin re-index route.
- **Session 4 — Grounded chat ✅:** hybrid retrieval, cited streaming answers, safety guardrails, message/conversation persistence, chat UI.
- **Session 5 — Agent & memory ✅:** Gemini function-calling tools (search/log/history/energy), multi-step loop with an actions trace, and long-term memory personalization.
- **Session 6 — Evaluation harness ✅:** golden dataset, retrieval + LLM-judge metrics, md/html reports, `eval_runs` persistence, and a CI gate that comments scores on PRs and blocks regressions.

## License

[MIT](./LICENSE)
