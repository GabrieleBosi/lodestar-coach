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

---

## 5 · A failed turn is a row, not an absence

**Decision.** A turn that fails to produce an answer persists an assistant
`messages` row marked with `__turn_failed__` in `tool_calls`, and the client
renders it as an error with a retry. On load, a transcript whose last message is
the user's is surfaced the same way. Switching conversations mid-stream does
**not** abort the request.

**Alternatives considered.**

- _Add an `error` column to `messages`._ Rejected for this PR: `role` is
  CHECK-constrained and there is no error column, so the honest options were a
  migration or the jsonb column that already records what happened during the
  turn. A migration would have to be applied before the deploy preview worked,
  coupling review to a manual step.
- _Abort the in-flight fetch when the user switches conversation._ Shipped
  first, then reverted. It disconnects the client mid-turn, and on serverless
  the function can be killed before it persists the assistant row — which
  manufactures exactly the orphaned turn this entry exists to prevent. The turn
  is already paid for, so it is left to finish; a sequence check keeps its
  output out of the conversation the user moved to.

**Evidence.** The catch path previously wrote only a `traces` row, so a failed
generation left a user message with no reply. On reload that is
indistinguishable from an ordinary conversation — a failure that reads as
success. Separately, `runAgent` degrades rather than throwing, so the catch is
rare; the common orphan is the killed function, which no server-side write can
cover. That is why detection is duplicated on load.

**Measured, not inferred.** Counted in the project database after the fix
shipped: **14 of 70 conversations ended with an unanswered question before it
(20%), and 0 of 24 since.** By turn rather than conversation, 15 of 105 (14.3%);
all-time by conversation, 14 of 94 (14.9%). No assistant row has empty content,
so every one of these is a missing row rather than a blank answer.

All 14 predate any failure-row code, so they are killed functions — which makes
the on-load detector the load-bearing half of this fix and the catch-path row the
smaller one. One of them rendered as a perfectly ordinary conversation in the
authenticated app.

The figure sizes the bug; it does not measure production. This is single-user
data dominated by our own testing, and the before/after split is the honest form
of the claim.

An earlier version of this entry said "15 of 86 conversations (17%)". That did
not reproduce, and the reason is worth keeping: **15 was the turn count and 86
was the conversation count** — a ratio built from two different denominators.
It survived review because 17% is a plausible-looking number and nothing in the
sentence revealed that its numerator and denominator counted different things.
That is why the corrected version states both denominators explicitly, and why
a rate quoted here should always name what it is a rate _of_.

**Consequences of not aborting.** A healthy turn now leaves a question with no
answer row for its whole duration, so "no answer row" cannot mean "failed" on
its own. Three things disambiguate it: conversation ids with a turn streaming in
this tab, the age of the trailing question (a turn is bounded by the agent
budget plus prelude, and the platform kills the request around 30s), and
position — only a _trailing_ gap can still be running. A gap that might be live
renders as "Still working on this…" with no retry, and the conversation is
re-read when the turn finishes if the view is back on it.

**Retry does not rewrite history.** The failed row and the original question stay
in the database and a retry appends a new turn, so the transcript reads
question / gap / question / answer. The live view is not filtered to hide that,
because a reload cannot hide it — filtering would make the two disagree. This is
why the gap detector runs at every position rather than only the last.

**What would reverse it.** Moving the turn to a durable queue with its own
status column ([#8](https://github.com/GabrieleBosi/lodestar-coach/issues/8))
would make the row the source of truth from the start, and the transcript
heuristic could go.

---

## 6 · The two chat clients are duplicated, and the demo is the one that gets missed

**Decision.** Record the duplication as a known defect rather than let it keep
producing bugs quietly, and share what can be shared today —
`readTurnStream`, `TURN_FAILED`/`isFailedTurn`, `AnswerBody`, `groupCitedSources`
and `lib/limits.ts` — while the turn lifecycle itself stays duplicated.

**Alternatives considered.**

- _Consolidate `ChatWorkspace` and `DemoChat` into one component now._ Rejected
  for the moment, not on principle: they genuinely differ (auth, persistence,
  a sidebar, conversation URLs, gap detection) and merging them inside a bug-fix
  PR would put a large refactor underneath changes that need to be reviewable
  line by line. It is the right fix; it is not this PR's fix.
- _Accept the duplication and review more carefully._ Rejected by evidence.
  Three separate fixes — the composer bound, trailer-aware failure handling, and
  citation source grouping — were each written once, shipped, reviewed, and
  found later to have landed in the authenticated client only.

**Evidence.** Every instance broke the same way and in the same direction. The
authenticated path is where the work is done, so it is where the fix lands; the
demo is the page a stranger sees first, so it is where the omission costs most.
The composer case is the sharpest: `app/api/demo/chat/route.ts` had enforced a
length bound all along while the field above it had none — the exact asymmetry
that had just been called out and fixed for `/api/chat`, inverted.

Reviewing the _diff_ cannot catch this class of defect, because the diff is
correct in isolation. It was caught by reading the live DOM of the deployed
demo, which is the only view that shows what a visitor actually gets.

**What would reverse it.** Consolidating the two into a shared turn component,
after which this entry describes history rather than a live risk. Until then,
treat "fixed in the chat client" as unfinished until the demo is checked too.

---

## 7 · A green pull request is not a green build

**Decision.** Record that the repository has **no required status checks**, so
GitHub's "All checks have passed" reports on whichever checks happened to run,
not on the checks that are supposed to run. Until branch protection names `build`
and `eval` as required, read the check list rather than the badge.

Those are the **job** names, which is what a required-status-check context
matches — not the workflow names (`CI`, `Eval`). An earlier version of this entry
said `Eval`, which would have sent anyone configuring it looking for a context
that does not exist.

**Evidence.** During a GitHub Actions incident on 2026-08-06, six workflow runs
failed before executing a single step — `Failed to resolve action download info`
/ `Service Unavailable`, and `the job was not acquired by Runner of type hosted`
— and later pushes were not scheduled at all. `main@89472d5` has **zero** runs,
so the merge commit of #11 is unverified by CI. Meanwhile #12 displayed _All
checks have passed_ on the strength of three Netlify checks alone, because the
two workflows that gate correctness never reported.

The failure mode is exactly the one the eval gate was hardened against in #4: an
absent measurement rendering as a passing one. It was fixed there by failing
closed when too few cases are judged. At the repository level the equivalent is
branch protection with required checks — without it, "no result" and "good
result" are the same colour, and the aggregate badge is the thing doing the
laundering.

**What would reverse it.** Configuring branch protection on `main` with `build`
and `eval` required. That is a repository setting rather than a code change, so
it cannot be made in a pull request; until it is set, this entry is the record
that the badge is not load-bearing.
