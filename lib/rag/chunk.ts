/**
 * Markdown-aware, token-budgeted chunking with overlap.
 *
 * - Sections are split on markdown headings; each chunk carries its heading path.
 * - Within a section, paragraphs are packed up to a token budget, with ~15%
 *   overlap carried into the next chunk so context isn't lost at boundaries.
 * - Token counts use a ~4-chars/token estimate (no tokenizer dependency).
 */
import { createHash } from "node:crypto";

export interface Chunk {
  /** Zero-based position of the chunk within its document. */
  index: number;
  /** Raw chunk text (without the title/heading prefix). */
  content: string;
  /** Heading path, e.g. "Deloads > When to deload". */
  heading: string;
  /** Text actually sent to the embedder (title + heading + content). */
  embedText: string;
  /** Estimated token count of `embedText`. */
  tokenCount: number;
  /** sha256 of the normalized `embedText` — the idempotency key. */
  contentHash: string;
}

export interface ChunkOptions {
  /** Target chunk size in (estimated) tokens. */
  maxTokens?: number;
  /** Fraction of a chunk carried into the next as overlap. */
  overlapRatio?: number;
  /** Document title, prepended to each chunk's embed text for context. */
  title?: string;
}

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface Section {
  headingPath: string[];
  body: string;
}

function splitSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) {
      sections.push({ headingPath: stack.map((s) => s.text), body });
    }
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      const level = (m[1] ?? "").length;
      const text = (m[2] ?? "").trim();
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
        stack.pop();
      }
      stack.push({ level, text });
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** Hard-split an over-long paragraph on whitespace near the budget. */
function hardSplit(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function packParagraphs(body: string, maxChars: number, overlapChars: number): string[] {
  const paras = body
    .split(/\n\s*\n/)
    .flatMap((p) => {
      const t = p.trim();
      if (!t) return [];
      return t.length > maxChars ? hardSplit(t, maxChars) : [t];
    })
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + 2 + p.length > maxChars) {
      chunks.push(cur);
      const tail = cur.slice(Math.max(0, cur.length - overlapChars)).trim();
      cur = tail ? `${tail}\n\n${p}` : p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export function chunkMarkdown(body: string, opts: ChunkOptions = {}): Chunk[] {
  const { maxTokens = 550, overlapRatio = 0.15, title } = opts;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = Math.floor(maxChars * overlapRatio);

  const chunks: Chunk[] = [];
  let index = 0;

  for (const section of splitSections(body)) {
    const heading = section.headingPath.join(" > ");
    for (const piece of packParagraphs(section.body, maxChars, overlapChars)) {
      const embedText = [title, heading, piece].filter(Boolean).join("\n\n");
      chunks.push({
        index: index++,
        content: piece,
        heading,
        embedText,
        tokenCount: estimateTokens(embedText),
        contentHash: sha256(normalize(embedText)),
      });
    }
  }

  return chunks;
}
