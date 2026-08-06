# Decision log

Non-obvious calls, with the reasoning that produced them and the evidence that
would reverse them. One entry per decision, newest last.

Format: **decision** · alternatives considered · evidence · what would reverse it.

---

## 1 · Generation is not cached; embeddings are

**Decision.** `lib/llm/cache.ts` caches `embed()` only. `generate()` and
`generateStream()` are pass-throughs, and the class is named `EmbeddingCache` so
the name cannot outlive the behaviour.

**Alternatives considered.**

- _Fix the key and keep caching generations._ Rejected: it treats a product
  question ("should two users asking the same thing get the same answer?") as a
  performance question, and answers it by accident.
- _Cache generations only for the demo user._ Rejected: the demo is the one
  place where identical questions are likely, but it is also the place a
  recruiter forms an impression, and serving a replayed answer to a rephrased
  question is the worst version of that.

**Evidence.** The cache was keyed and stamped with the _embedding_ model
(issue #2, P0-8), so changing the chat model invalidated nothing. Production held
16 `generate | gemini-embedding-2` rows and zero keyed by a generation model.
Reading them rather than inferring: 11 were prose coaching answers, 5 were memory
fact arrays — user-facing answers served under a wrong-model key. Separately, the
agent loop makes zero `provider.*` calls, so the only remaining caller after
PR #4 was memory extraction.

Embeddings are the opposite case: a pure function of
`(text, model, dimensions, taskType)`, so a hit is always correct. Measured on
the preview, a repeated question hits about **half** the available embeddings —
each turn embeds twice, and the agent rephrases its own `search_knowledge` query
between runs, so only the memory-recall embedding repeats verbatim.

**What would reverse it.** Wanting response caching for a specific, bounded case
— most plausibly the demo's seeded questions. That belongs in the agent loop,
keyed over `(model, system, history, message)` with explicit invalidation when
the user's logged data changes, not in a provider wrapper whose key cannot see
any of that. Reversing it also requires deciding, out loud, that a cached
coaching answer is acceptable.
