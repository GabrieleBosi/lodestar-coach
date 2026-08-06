/**
 * Re-runnable check for unanswered-turn detection (`npm run check:gaps`).
 *
 * Guards issue #2 P0-4. A turn whose function was killed leaves a question with
 * no answer row, and nothing server-side can write one after the fact — so the
 * client has to notice. Production had 15 such conversations out of 86, one of
 * which rendered as an ordinary conversation with no indication anything was
 * missing. The failure mode this protects against is a gap that reads as
 * success, so the checks below assert what gets *marked*, not just that
 * something was inserted.
 *
 * Pure function, no network, no credentials, no model quota.
 */
import {
  FAILED_TEXT,
  IN_FLIGHT_GRACE_MS,
  msUntilGapSettles,
  PENDING_TEXT,
  type TranscriptMessage,
  withGapMarkers,
} from "../lib/turn-gaps";

const NOW = Date.parse("2026-08-06T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const user = (id: string, at = ago(0)): TranscriptMessage => ({
  id,
  role: "user",
  content: `q-${id}`,
  createdAt: at,
});
const bot = (id: string): TranscriptMessage => ({
  id,
  role: "assistant",
  content: `a-${id}`,
  createdAt: ago(0),
});

/** Compact shape: "u" user, "a" answer, "P" pending gap, "F" failed gap. */
function shape(rows: TranscriptMessage[]): string {
  return rows
    .map((r) =>
      r.gap === "pending" ? "P" : r.gap === "failed" ? "F" : r.role === "user" ? "u" : "a",
    )
    .join("");
}

let failures = 0;
function check(label: string, got: string, want: string) {
  const ok = got === want;
  console.log(`  ${ok ? "✅" : "❌"} ${label} — ${got}${ok ? "" : ` (expected ${want})`}`);
  if (!ok) failures++;
}

console.log("── settled transcripts");
check(
  "a complete turn is untouched",
  shape(withGapMarkers([user("1"), bot("2")], false, NOW)),
  "ua",
);
check("an empty transcript is untouched", shape(withGapMarkers([], false, NOW)), "");

console.log("── the production case: a stale trailing question");
check(
  "older than the grace window is a FAILED gap, not silence",
  shape(
    withGapMarkers(
      [user("1", ago(6 * 60 * 60 * 1000)), bot("2"), user("3", ago(3_600_000))],
      false,
      NOW,
    ),
  ),
  "uauF",
);

console.log("── a turn that is still running must not be marked failed");
check("streaming in this tab", shape(withGapMarkers([user("1", ago(1000))], true, NOW)), "uP");
check(
  "recent enough to be streaming in another tab",
  shape(withGapMarkers([user("1", ago(IN_FLIGHT_GRACE_MS - 5_000))], false, NOW)),
  "uP",
);
check(
  "just past the grace window flips to failed",
  shape(withGapMarkers([user("1", ago(IN_FLIGHT_GRACE_MS + 5_000))], false, NOW)),
  "uF",
);
check(
  "a client-side row with no timestamp is only pending while streaming here",
  shape(withGapMarkers([{ id: "1", role: "user", content: "q" }], false, NOW)),
  "uF",
);

console.log("── retry consistency (live transcript vs reload)");
// A retry appends; it does not rewrite history. Both views must agree.
const afterRetry = [user("1", ago(3_600_000)), user("2", ago(3_599_000)), bot("3")];
check(
  "the abandoned question keeps its gap when a later turn answers",
  shape(withGapMarkers(afterRetry, false, NOW)),
  "uFua",
);
check(
  "a mid-transcript gap is never pending, however recent",
  shape(withGapMarkers([user("1", ago(1000)), user("2", ago(500)), bot("3")], true, NOW)),
  "uFua",
);
check(
  "two abandoned questions in a row are both marked",
  shape(withGapMarkers([user("1", ago(3_600_000)), user("2", ago(3_599_000))], false, NOW)),
  "uFuF",
);

console.log("── marker content");
const marked = withGapMarkers([user("1", ago(3_600_000))], false, NOW);
check("failed marker carries the failed text", marked[1]?.content ?? "", FAILED_TEXT);
const pendingMarked = withGapMarkers([user("1", ago(1000))], true, NOW);
check("pending marker carries the pending text", pendingMarked[1]?.content ?? "", PENDING_TEXT);
check("marker ids derive from the question", marked[1]?.id ?? "", "1:gap");

console.log("── a pending gap settles itself in a tab that owns no turn");
const num = (label: string, got: number | null, want: number | null) => {
  const ok = got === want;
  console.log(`  ${ok ? "✅" : "❌"} ${label} — ${got}${ok ? "" : ` (expected ${want})`}`);
  if (!ok) failures++;
};
num(
  "a settled transcript schedules nothing",
  msUntilGapSettles(withGapMarkers([user("1", ago(0)), bot("2")], false, NOW), NOW),
  null,
);
num(
  "a failed gap schedules nothing — it is already terminal",
  msUntilGapSettles(withGapMarkers([user("1", ago(3_600_000))], false, NOW), NOW),
  null,
);
num(
  "a pending gap schedules the remainder of the grace window",
  msUntilGapSettles(withGapMarkers([user("1", ago(20_000))], false, NOW), NOW),
  IN_FLIGHT_GRACE_MS - 20_000,
);
// The re-read must not be able to schedule another. Past the boundary the
// classification is terminal, so this converges after exactly one re-read.
const settled = withGapMarkers([user("1", ago(20_000))], false, NOW + IN_FLIGHT_GRACE_MS);
check("re-classifying past the boundary yields a settled gap", shape(settled), "uF");
num("…and schedules nothing further", msUntilGapSettles(settled, NOW + IN_FLIGHT_GRACE_MS), null);

console.log(failures === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failures})`);
if (failures > 0) process.exit(1);
