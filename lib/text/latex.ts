/**
 * Renders the LaTeX the model occasionally emits as plain Unicode.
 *
 * Answers arrived containing `($\text{H}^+$)` and `($\le 1.6\text{ g}$)`
 * verbatim: the chat renderer is react-markdown + remark-gfm, which has no math
 * handling, so the source passed straight through to the reader. The system
 * prompt now asks for plain text, but a prompt rule is a request, not a
 * guarantee — this is the backstop that makes the rule hold.
 *
 * Deliberately NOT remark-math + rehype-katex: that pulls in KaTeX and its
 * stylesheet to typeset expressions that are, in practice, a unit and an
 * inequality sign. The mapping below covers what a coaching answer actually
 * contains and adds no dependency.
 */

/** LaTeX command names → the character they should render as. */
const COMMANDS: Record<string, string> = {
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  sim: "~",
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  mp: "∓",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  infty: "∞",
  degree: "°",
  circ: "°",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  mu: "μ",
  sum: "Σ",
  // Layout commands that carry no meaning once typesetting is gone.
  left: "",
  right: "",
  displaystyle: "",
  quad: " ",
  qquad: " ",
};

/** `\,` `\;` `\:` `\!` and an escaped space: thin spaces and escaped literals. */
const ESCAPES: Record<string, string> = { ",": " ", ";": " ", ":": " ", "!": "", " ": " " };

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "−": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
};

const SUBSCRIPTS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "−": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
};

/** Wrappers whose braces exist only for typesetting: keep the contents. */
const TRANSPARENT_SOURCE =
  "\\\\(?:text|textrm|textbf|textit|mathrm|mathbf|mathit|operatorname)\\{([^{}]*)\\}";
const TRANSPARENT = new RegExp(TRANSPARENT_SOURCE, "g");
/** Separate instance for detection: `.test()` on a /g regex is stateful. */
const HAS_BARE_LATEX = new RegExp(`${TRANSPARENT_SOURCE}|\\\\frac\\{`);

function script(body: string, table: Record<string, string>, prefix: string): string {
  const mapped = [...body].map((ch) => table[ch]);
  // All-or-nothing: a half-converted exponent reads worse than the raw source.
  return mapped.every((c) => c !== undefined) ? mapped.join("") : `${prefix}${body}`;
}

/** Convert the LaTeX inside one math span to plain text. */
function convert(input: string): string {
  let s = input;

  // Nested wrappers are rare but cheap to handle: peel until stable.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(TRANSPARENT, "$1");
    if (next === s) break;
    s = next;
  }

  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2");
  s = s.replace(/\\([a-zA-Z]+)/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name]! : name,
  );
  s = s.replace(/\\([,;:! ])/g, (m, ch: string) => ESCAPES[ch] ?? "");
  s = s.replace(/\\([%$&#_{}])/g, "$1");

  s = s.replace(/\^\{([^{}]*)\}/g, (m, body: string) => script(body, SUPERSCRIPTS, "^"));
  s = s.replace(/\^(\S)/g, (m, ch: string) => script(ch, SUPERSCRIPTS, "^"));
  s = s.replace(/_\{([^{}]*)\}/g, (m, body: string) => script(body, SUBSCRIPTS, "_"));
  s = s.replace(/_(\w)/g, (m, ch: string) => script(ch, SUBSCRIPTS, "_"));

  // Braces that survived were grouping, not content.
  s = s.replace(/[{}]/g, "");
  return s.replace(/[ \t]{2,}/g, " ").trim();
}

/** Content that is worth treating as math rather than as prose or currency. */
function looksLikeMath(body: string): boolean {
  return body.length > 0 && body.length <= 200 && !body.includes("\n") && /[\\^_]/.test(body);
}

/**
 * Delimiter forms, longest first.
 *
 * `$…$` requires a backslash, `^` or `_` inside (see looksLikeMath) so a price
 * range like "$40 to $60" is never swallowed as an expression. `\(…\)` and
 * `\[…\]` are unambiguous and pass the same check only for consistency.
 */
const SPANS: [RegExp, boolean][] = [
  [/\$\$([\s\S]*?)\$\$/g, true],
  [/\\\[([\s\S]*?)\\\]/g, false],
  [/\\\(([\s\S]*?)\\\)/g, false],
  [/\$([^$\n]*?)\$/g, true],
];

/**
 * Replace math spans in `text` with a plain-text rendering.
 *
 * Applied to prose text nodes only — never to code, pre or link text, which the
 * renderer treats as opaque.
 */
export function stripLatex(text: string): string {
  if (!/[$\\]/.test(text)) return text;

  let out = text;
  for (const [re, needsMathSignal] of SPANS) {
    out = out.replace(re, (whole, body: string) =>
      !needsMathSignal || looksLikeMath(body) ? convert(body) : whole,
    );
  }

  // Bare `\text{…}` / `\frac{…}{…}` outside any delimiter: unambiguous LaTeX
  // that no ordinary sentence produces. Only those two forms are rewritten
  // here — running the full command sweep over undelimited prose would eat the
  // backslash out of any ordinary text that happens to contain one.
  if (HAS_BARE_LATEX.test(out)) {
    for (let i = 0; i < 4; i++) {
      const next = out.replace(TRANSPARENT, "$1");
      if (next === out) break;
      out = next;
    }
    out = out.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2");
  }

  return out;
}
