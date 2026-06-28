# Lodestar

> An evidence-grounded, agentic AI coach for training, nutrition & recovery — cited answers, real tools, measured quality.

Lodestar is being built in stages. **This is the Session 1 skeleton**: a clean, deployable Next.js app with a provider-agnostic LLM layer, a health endpoint, and a landing page. Database, chat, RAG, auth, and evaluation come in later sessions (see the [Roadmap](#roadmap)).

> **Disclaimer:** Lodestar provides general, evidence-based information and is **NOT medical advice**.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript (strict)
- [Tailwind CSS](https://tailwindcss.com) v4
- [Google Gen AI SDK](https://www.npmjs.com/package/@google/genai) (`@google/genai`) for Gemini
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
# then edit .env.local and set GEMINI_API_KEY

# 4. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The landing page shows a green
`● healthy · <chatModel>` badge when [`/api/health`](http://localhost:3000/api/health)
responds.

## Environment variables

| Variable             | Default              | Description                          |
| -------------------- | -------------------- | ------------------------------------ |
| `GEMINI_API_KEY`     | _(required)_         | Google Gemini API key                |
| `GEMINI_CHAT_MODEL`  | `gemini-3.5-flash`   | Chat / generation model              |
| `GEMINI_EMBED_MODEL` | `gemini-embedding-2` | Embedding model                      |
| `EMBED_DIM`          | `1536`               | Embedding output dimensionality      |

> Verify model IDs against current Gemini docs — the 2.5 series is deprecating
> ~June 2026; 3.x flash/pro are current. Supabase / database variables arrive in Session 2.

## Scripts

| Script              | Description                              |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Start the dev server                     |
| `npm run build`     | Production build                         |
| `npm run start`     | Serve the production build               |
| `npm run lint`      | Lint with ESLint                         |
| `npm run typecheck` | Type-check with `tsc --noEmit`           |
| `npm run format`    | Format with Prettier                     |

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

## Project structure

```
app/
  layout.tsx            # root layout
  page.tsx              # landing page
  globals.css           # Tailwind v4 entry
  api/health/route.ts   # health endpoint
components/
  StatusBadge.tsx       # client badge that polls /api/health
lib/
  llm/                  # provider-agnostic LLM layer
    types.ts            # LLMProvider interface
    gemini.ts           # Gemini implementation
    index.ts            # singleton provider
  db/                   # (Session 2)
  rag/                  # (Session 4)
```

The app depends only on the `LLMProvider` interface, so the underlying model is
swappable without touching call sites.

## Roadmap

- **Session 1 — Skeleton (this):** scaffold, LLM provider abstraction, health endpoint, landing page, CI, deploy.
- **Session 2 — Data & auth:** database schema, client, and authentication.
- **Session 3 — Chat:** conversational coaching UI and streaming responses.
- **Session 4 — RAG:** evidence ingestion, embeddings, retrieval, and citations.
- **Session 5 — Agent:** tools and agentic workflows.
- **Session 6 — Evaluation & safety:** quality metrics and safety guardrails.

## License

[MIT](./LICENSE)
