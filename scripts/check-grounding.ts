/**
 * Guards the retrieval coverage floor and the LaTeX mapper (`npm run check:grounding`).
 *
 * Both are pure functions with no I/O, so unlike the eval this runs in CI on
 * every PR with no credentials and no model quota — which matters, because the
 * bug these fix (citations pointing at unrelated documents) shipped green past
 * an eval that reported citation correctness 1.0.
 *
 * The similarity fixtures are real measurements against the live corpus, taken
 * from the query embeddings in `llm_cache`; see lib/rag/retrieve.ts.
 */
import {
  DEFAULT_MIN_SIMILARITY,
  hasGroundedCoverage,
  readSimilarityFloor,
  type RetrievedChunk,
} from "../lib/rag/retrieve";
import { citedNumbers } from "../lib/citations";
import { stripLatex } from "../lib/text/latex";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "✓" : "✗"} ${label}` +
      (ok
        ? ""
        : `\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`),
  );
}

/** A result set of dense-only hits at the given similarities. */
function dense(...similarities: number[]): RetrievedChunk[] {
  return similarities.map((similarity, i) => ({
    id: `c${i}`,
    documentId: "d",
    content: "",
    heading: null,
    title: null,
    sourceUrl: null,
    similarity,
    score: 1 / (i + 1),
  }));
}

// ── coverage ────────────────────────────────────────────────────────────────
const floor = DEFAULT_MIN_SIMILARITY;

// Measured top-6 dense similarities for questions the corpus DOES answer.
for (const [label, sims] of [
  ["deload week", [0.8683, 0.7728, 0.7323]],
  ["sleep and recovery", [0.8481, 0.7873, 0.7744]],
  ["protein intake", [0.8416, 0.8017, 0.7523]],
  ["progressive overload", [0.8324, 0.8054, 0.6975]],
  ["static stretching", [0.8133, 0.737, 0.7108]],
  ["lean-bulk calorie/protein targets", [0.7709, 0.7249, 0.7094]],
] as [string, number[]][]) {
  check(`covered: ${label}`, hasGroundedCoverage(dense(...sims), floor), true);
}

// Measured top-6 for supplement questions the corpus says NOTHING about. These
// are the exact queries that produced fabricated ISSN-position-stand protocols
// citing "Hydration for Training".
for (const [label, sims] of [
  ["beta-alanine dosing", [0.7255, 0.7018, 0.6906]],
  ["creatine monohydrate + dose", [0.6946, 0.6881, 0.6748]],
  ["creatine safety", [0.6767, 0.673, 0.6643]],
  ["creatine (short answer)", [0.6166, 0.6112, 0.6037]],
] as [string, number[]][]) {
  check(`uncovered: ${label}`, hasGroundedCoverage(dense(...sims), floor), false);
}

check("uncovered: empty result set", hasGroundedCoverage([], floor), false);

// A lexical hit is coverage on its own: match_chunks_keyword ANDs every query
// term, so matching at all means the corpus discusses the subject.
const lexicalOnly = dense(0.61);
lexicalOnly[0]!.keywordRank = 0.0607;
check("covered: lexical hit below the dense floor", hasGroundedCoverage(lexicalOnly, floor), true);

// A chunk with no similarity at all (keyword list only, no dense entry) must
// not be read as similarity 0 clearing the floor.
check("uncovered: no similarity, no keyword rank", hasGroundedCoverage(dense(), floor), false);

// ── floor configuration ─────────────────────────────────────────────────────
check("floor: default", readSimilarityFloor({}), DEFAULT_MIN_SIMILARITY);
check(
  "floor: empty string falls back",
  readSimilarityFloor({ RETRIEVAL_MIN_SIMILARITY: "" }),
  DEFAULT_MIN_SIMILARITY,
);
check(
  "floor: garbage falls back",
  readSimilarityFloor({ RETRIEVAL_MIN_SIMILARITY: "high" }),
  DEFAULT_MIN_SIMILARITY,
);
check(
  "floor: out of range falls back",
  readSimilarityFloor({ RETRIEVAL_MIN_SIMILARITY: "7.5" }),
  DEFAULT_MIN_SIMILARITY,
);
check("floor: override applies", readSimilarityFloor({ RETRIEVAL_MIN_SIMILARITY: "0.8" }), 0.8);
check(
  "floor: 0 disables the dense floor",
  readSimilarityFloor({ RETRIEVAL_MIN_SIMILARITY: "0" }),
  0,
);

// ── LaTeX mapper ────────────────────────────────────────────────────────────
// The two forms observed reaching the reader in production.
check(
  "latex: \\text with superscript",
  stripLatex("Buffers ($\\text{H}^+$) during hard sets."),
  "Buffers (H⁺) during hard sets.",
);
check(
  "latex: inequality with units",
  stripLatex("Aim for ($\\le 1.6\\text{ g}$) per kg."),
  "Aim for (≤ 1.6 g) per kg.",
);

check("latex: display math", stripLatex("$$\\frac{kcal}{day} \\times 1.2$$"), "kcal/day × 1.2");
check(
  "latex: paren delimiters",
  stripLatex("about \\(2.2\\,\\text{g/kg}\\) daily"),
  "about 2.2 g/kg daily",
);
check("latex: bracket delimiters", stripLatex("\\[RPE \\geq 7\\]"), "RPE ≥ 7");
check("latex: subscript", stripLatex("$\\text{VO}_{2}\\text{max}$"), "VO₂max");
check(
  "latex: bare \\text outside delimiters",
  stripLatex("roughly \\text{1.6 g/kg} of protein"),
  "roughly 1.6 g/kg of protein",
);

// Things that must survive untouched.
check(
  "latex: plain prose is identity",
  stripLatex("Aim for 1.6 g/kg of protein daily."),
  "Aim for 1.6 g/kg of protein daily.",
);
check(
  "latex: currency is not math",
  stripLatex("Between $40 and $60 a month."),
  "Between $40 and $60 a month.",
);
check(
  "latex: citation markers survive",
  stripLatex("Protein at $\\ge 1.6\\text{ g/kg}$ [1][2]."),
  "Protein at ≥ 1.6 g/kg [1][2].",
);
check(
  "latex: windows path keeps its backslash",
  stripLatex("See C:\\notes for details."),
  "See C:\\notes for details.",
);
check("latex: repeated calls are stable", stripLatex(stripLatex("$\\text{H}^+$")), "H⁺");

// ── citation markers ────────────────────────────────────────────────────────
check(
  "markers: grouped",
  [...citedNumbers("Protein matters [1, 3] and so does sleep [2].")],
  [1, 3, 2],
);
check("markers: none", [...citedNumbers("I don't have grounded information on that yet.")], []);

console.log(
  failures === 0 ? "\nAll grounding checks passed ✅" : `\n${failures} check(s) FAILED ❌`,
);
if (failures > 0) process.exit(1);
