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

---

## 2 · The metadata trailer is the turn-complete signal, not the stream close

**Decision.** `lib/agent/chat.ts` terminates the trailer on both sides —
`CTRL + "META:" + json + CTRL` — and the client treats its arrival as the end of
the turn: the composer unlocks, the sidebar refetches, citations resolve. The
stream's `close` remains only as an idempotent backstop. Server order is
**persist → META → extract → close**.

**Alternatives considered.**

- _Reorder the server so the slow tail runs after the trailer, and leave the
  wire format alone._ Rejected: it fixes nothing. The trailer was unterminated,
  so `buffer.split(CTRL)` left it as the trailing fragment and the client's
  prefix-hold heuristic — `!META.startsWith(buffer.slice(0, 5))`, which is false
  for exactly a buffer beginning `META:` — held it until the post-loop flush
  after `done`. Metadata arrived at close no matter what preceded it.
- _Drop the prefix-hold heuristic entirely once the trailer is terminated._
  Rejected: the trailer is one `send()` but HTTP chunking can still split it,
  and an unguarded flush would print `META:{"sourc` into the answer. The hold
  now applies only to a partial that actually follows a control byte, so
  ordinary text — including text starting with "M" — is never stalled.
- _Move memory extraction after `controller.close()`._ Rejected: the browser
  stops waiting, but the platform doesn't guarantee the work runs. Post-close
  work can be frozen or killed on serverless, which would drop memories with no
  error anywhere. It stays inside the stream, after the trailer.

**Evidence.** A browser replay of the real parser timed `onText` at +1ms and
`onMeta` at +5202ms, with the trailer enqueued server-side at +200ms — a 5s gap
that server-side `send()` timestamps could not see, because they never exercised
the parser. `npm run check:stream` reproduces it deterministically: with a 400ms
gap between trailer and close, the unterminated form delivers META at 529ms
(= close) and the terminated form at 55ms.

**What would reverse it.** A wire format with explicit framing (length prefixes
or newline-delimited JSON) would make both the terminator and the hold
unnecessary, and would be worth adopting if the stream ever carries more than
two frame types.

---

## 3 · The sources panel lists what the answer cites, not what retrieval returned

**Decision.** `citedSources()` filters the trailer's citations to the `[n]`
markers present in the answer text. A grouped marker (`[1, 3]`) counts as both.

**Alternatives considered.**

- _List everything retrieved._ Rejected: retrieval runs on every turn, so a
  refusal ("I don't have enough grounded information on that yet") carries six
  chunks that failed to ground it. Displaying them under "Sources" claims the
  refusal was sourced — the opposite of what it says.
- _Suppress the panel only when the answer matches the refusal string._
  Rejected: it makes the UI depend on prompt wording, and does nothing for a
  grounded answer that cites two of six retrieved chunks.

**Evidence.** A live demo turn retrieved 6 chunks and cited 2; the panel now
shows 2. The first draft of the filter matched only `\[(\d+)\]` and silently
dropped the `[1, 3]` group in the answer's opening sentence — grouped markers
are as common as separate ones, so the regex captures the whole group.

**What would reverse it.** Validating citations at generation time (rejecting or
repairing an answer whose markers don't match retrieved chunks) would make the
displayed set equal to the retrieved set by construction, and this filter would
become dead code rather than a correction.

---

## 4 · Answer tokens are forwarded before the step that produced them is classified

**Decision.** `runAgent` takes a `StreamSink`. Tokens are forwarded as the model
generates them; if that step turns out to call a tool, the server emits a
`RESET` control frame and the client discards the text. `AgentResult.alreadyStreamed`
tells the caller whether the answer still needs sending.

**Alternatives considered.**

- _Buffer each step and forward only once it is known to have made no function
  calls._ Rejected after measuring what it would buy: `finalText` is assigned
  only on the step with zero function calls, and the loop breaks there
  (`lib/agent/loop.ts`). "The step is known clean" is the same instant `runAgent`
  already returns — so this is a no-op, not a conservative version.
- _Keep the unary call and chunk the finished string._ That is the behaviour
  being replaced: time-to-first-token equals the whole turn by construction.

**Evidence.** A local tool-using turn went from 3 frames delivered at 13.2s to
29 frames spanning 9.9-13.2s. Retractions are rare in practice — the tool step
emitted no text at all in the measured runs — which is why forwarding
optimistically and retracting is cheaper than waiting.

The first implementation rebuilt the model `Content` from accumulated text plus
function calls. That dropped `thoughtSignature` from functionCall parts, and
Gemini 3.x rejected the follow-up turn with `400 Function call is missing a
thought_signature in functionCall parts` — every tool-using turn degraded. Parts
are now kept exactly as received, and `thought` parts are never forwarded as
answer text.

**What would reverse it.** A provider whose stream declares tool intent before
emitting text would make retraction unnecessary, and the `RESET` frame could go.
