"use client";

/**
 * Renders an assistant answer: markdown as markdown (issue #2, D-1) and `[n]`
 * citation markers as resolvable references (P0-6).
 *
 * Shared by the authenticated workspace and the public demo so the two can't
 * drift. Visual design is deliberately minimal here — issue #3 owns the
 * typographic scale; this component owns *parsing*, which a scale can't be
 * applied to until it exists.
 */
import { cloneElement, isValidElement, Fragment, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { citedNumbers, MARKER, numbersIn } from "@/lib/citations";
import { stripLatex } from "@/lib/text/latex";

export interface Citation {
  n: number;
  chunkId?: string;
  title: string | null;
  sourceUrl: string | null;
  heading: string | null;
}

export { citedNumbers };

/**
 * Sources the answer actually cites, in citation order.
 *
 * Retrieval runs on every turn, so a refusal ("I don't have enough grounded
 * information on that yet") still carries the chunks that failed to ground it.
 * Listing those under "Sources" implies the refusal was sourced (P0-7), so the
 * panel shows what the text cites, not what the retriever returned.
 */
export function citedSources(text: string, citations: Citation[] | undefined): Citation[] {
  if (!citations?.length) return [];
  const used = citedNumbers(text);
  return citations.filter((c) => used.has(c.n));
}

export interface SourceGroup {
  key: string;
  title: string;
  sourceUrl: string | null;
  /** Citation numbers pointing at this document, with the section each hit. */
  entries: { n: number; heading: string | null }[];
}

/**
 * Cited sources collapsed to one entry per document.
 *
 * Retrieval returns chunks, and several chunks of one document are still one
 * source — listing them separately made a single file appear as `[1][2][3][4][5]`,
 * which reads like five independent citations supporting the claim (issue #2,
 * P1). Grouping is by URL where there is one, else by title, so two documents
 * that happen to share a title stay distinct.
 */
export function groupCitedSources(text: string, citations: Citation[] | undefined): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const c of citedSources(text, citations)) {
    const title = c.title ?? "Source";
    const key = c.sourceUrl ?? `title:${title}`;
    const group = groups.get(key) ?? { key, title, sourceUrl: c.sourceUrl, entries: [] };
    group.entries.push({ n: c.n, heading: c.heading });
    groups.set(key, group);
  }
  for (const g of groups.values()) g.entries.sort((a, b) => a.n - b.n);
  return [...groups.values()].sort((a, b) => (a.entries[0]?.n ?? 0) - (b.entries[0]?.n ?? 0));
}

/** Elements whose text is not prose and must not be rewritten. */
const OPAQUE = new Set(["code", "pre", "a"]);

function CitationMarker({ n, source }: { n: number; source: Citation | undefined | null }) {
  // `undefined` = the turn hasn't delivered its trailer yet; `null` = it has,
  // and nothing matched. A pending marker must never look resolved.
  if (source === undefined) {
    return (
      <sup
        title="Resolving source…"
        className="mx-0.5 animate-pulse rounded bg-stone-300/60 px-1 text-[10px] text-transparent dark:bg-stone-600/60"
        aria-label={`Citation ${n}, resolving`}
      >
        [{n}]
      </sup>
    );
  }
  if (source === null) {
    return (
      <sup
        title="No matching source was returned for this citation"
        className="mx-0.5 text-[10px] text-stone-400 line-through dark:text-stone-500"
      >
        [{n}]
      </sup>
    );
  }
  const label = source.title ?? "Source";
  const body = (
    <sup className="mx-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
      [{n}]
    </sup>
  );
  return source.sourceUrl ? (
    <a
      href={source.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={source.heading ? `${label} · ${source.heading}` : label}
    >
      {body}
    </a>
  ) : (
    <span title={label}>{body}</span>
  );
}

type Resolve = (n: number) => Citation | undefined | null;

function decorate(node: ReactNode, resolve: Resolve, key: string): ReactNode {
  if (typeof node === "string") {
    // Math first: the markers are resolved against the text the reader sees, and
    // this walk only reaches prose (OPAQUE keeps it out of code, pre and links).
    const text = stripLatex(node);
    if (!text.includes("[")) return text;
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(MARKER)) {
      const at = m.index ?? 0;
      if (at > last) out.push(text.slice(last, at));
      // `[1, 3]` becomes two independently resolvable markers.
      for (const n of numbersIn(m[1] ?? "")) {
        out.push(<CitationMarker key={`${key}-${at}-${n}`} n={n} source={resolve(n)} />);
      }
      last = at + m[0].length;
    }
    if (last === 0) return text;
    if (last < text.length) out.push(text.slice(last));
    return <Fragment key={key}>{out}</Fragment>;
  }
  if (Array.isArray(node)) return node.map((c, i) => decorate(c, resolve, `${key}-${i}`));
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (typeof el.type === "string" && OPAQUE.has(el.type)) return node;
    if (el.props?.children == null) return node;
    return cloneElement(el, undefined, decorate(el.props.children, resolve, key));
  }
  return node;
}

export default function AnswerBody({
  content,
  citations,
}: {
  /** The answer text; may be mid-stream. */
  content: string;
  /** `undefined` until the turn's trailer arrives. */
  citations: Citation[] | undefined;
}) {
  const resolve: Resolve = (n) => {
    if (citations === undefined) return undefined;
    return citations.find((c) => c.n === n) ?? null;
  };

  // Citations appear in prose, so paragraphs, list items and table cells are
  // the containers worth walking; the walk recurses through inline markup.
  // Headings carry no citations but can carry a unit or an inequality, and the
  // same walk is what applies stripLatex.
  const components: Components = {
    p: ({ children }) => <p>{decorate(children, resolve, "p")}</p>,
    li: ({ children }) => <li>{decorate(children, resolve, "li")}</li>,
    td: ({ children }) => <td>{decorate(children, resolve, "td")}</td>,
    th: ({ children }) => <th>{decorate(children, resolve, "th")}</th>,
    h2: ({ children }) => <h2>{decorate(children, resolve, "h2")}</h2>,
    h3: ({ children }) => <h3>{decorate(children, resolve, "h3")}</h3>,
    h4: ({ children }) => <h4>{decorate(children, resolve, "h4")}</h4>,
  };

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
