/**
 * Knowledge ingestion engine (dependency-injected).
 *
 * Reads markdown from a knowledge directory, upserts a `documents` row per file,
 * chunks the body, and idempotently syncs the `chunks` table: new/changed chunks
 * are embedded and upserted; chunks that no longer exist are deleted. Re-running
 * with no edits is a no-op (everything skipped).
 *
 * The Supabase client and LLM provider are passed in so this module never imports
 * the service-role key directly — callers wire that up (the CLI script builds a
 * service-role client; the API route uses the server-only admin client).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../db/types";
import type { LLMProvider } from "../llm/types";
import { chunkMarkdown, type Chunk } from "./chunk";

/** Approximate Gemini embedding price — verify against current pricing. */
const APPROX_USD_PER_MILLION_TOKENS = 0.15;
const EMBED_DIM = 1536;
const EMBED_BATCH_SIZE = 32;
const MAX_EMBED_ATTEMPTS = 5;

export interface Frontmatter {
  title: string;
  source_url: string;
  license: string;
  summary: string;
}

export interface IngestSummary {
  docsProcessed: number;
  chunksAdded: number;
  chunksUpdated: number;
  chunksSkipped: number;
  chunksDeleted: number;
  tokensEmbedded: number;
  approxCostUsd: number;
}

type Logger = (message: string) => void;

export interface IngestOptions {
  supabase: SupabaseClient<Database>;
  provider: LLMProvider;
  knowledgeDir: string;
  log?: Logger;
}

/** Minimal YAML frontmatter parser for our controlled `key: "value"` docs. */
export function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(raw);
  const data: Record<string, string> = {};
  let body = raw;

  if (match) {
    body = match[2] ?? "";
    for (const line of (match[1] ?? "").split(/\r?\n/)) {
      const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
      if (!kv || !kv[1]) continue;
      data[kv[1]] = (kv[2] ?? "").trim().replace(/^["']|["']$/g, "");
    }
  }

  return {
    data: {
      title: data.title ?? "",
      source_url: data.source_url ?? "",
      license: data.license ?? "",
      summary: data.summary ?? "",
    },
    body: body.trim(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedWithRetry(
  provider: LLMProvider,
  texts: string[],
  log: Logger,
): Promise<number[][]> {
  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt++) {
    try {
      return await provider.embed(texts, {
        dimensions: EMBED_DIM,
        taskType: "RETRIEVAL_DOCUMENT",
      });
    } catch (err) {
      if (attempt === MAX_EMBED_ATTEMPTS) throw err;
      const backoff = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      log(`  embed attempt ${attempt} failed (${String(err)}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw new Error("unreachable");
}

async function upsertDocument(
  supabase: SupabaseClient<Database>,
  fm: Frontmatter,
): Promise<string> {
  const naturalKey = fm.source_url || fm.title;
  const column = fm.source_url ? "source_url" : "source_title";

  const { data: existing, error: selErr } = await supabase
    .from("documents")
    .select("id")
    .eq(column, naturalKey)
    .maybeSingle();
  if (selErr) throw selErr;

  const row = {
    source_title: fm.title,
    source_url: fm.source_url || null,
    license: fm.license || null,
    summary: fm.summary || null,
  };

  if (existing) {
    const { error } = await supabase.from("documents").update(row).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from("documents")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return inserted.id;
}

export async function runIngestion(opts: IngestOptions): Promise<IngestSummary> {
  const { supabase, provider, knowledgeDir } = opts;
  const log: Logger = opts.log ?? (() => {});

  const summary: IngestSummary = {
    docsProcessed: 0,
    chunksAdded: 0,
    chunksUpdated: 0,
    chunksSkipped: 0,
    chunksDeleted: 0,
    tokensEmbedded: 0,
    approxCostUsd: 0,
  };

  const files = (await fs.readdir(knowledgeDir)).filter((f) => f.endsWith(".md")).sort();
  log(`Found ${files.length} markdown file(s) in ${knowledgeDir}`);

  for (const file of files) {
    const raw = await fs.readFile(path.join(knowledgeDir, file), "utf8");
    const { data: fm, body } = parseFrontmatter(raw);
    const title = fm.title || file.replace(/\.md$/, "");

    const docId = await upsertDocument(supabase, fm);
    const newChunks = chunkMarkdown(body, { title });

    // Existing chunks for this document, keyed by their stored chunk_index.
    const { data: existingRows, error: exErr } = await supabase
      .from("chunks")
      .select("id, content_hash, metadata")
      .eq("document_id", docId);
    if (exErr) throw exErr;

    const existingByIndex = new Map<number, { id: string; hash: string | null }>();
    for (const r of existingRows ?? []) {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const idx = typeof meta.chunk_index === "number" ? meta.chunk_index : -1;
      existingByIndex.set(idx, { id: r.id, hash: r.content_hash });
    }

    const toEmbed: Chunk[] = [];
    const toDeleteIds: string[] = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const chunk of newChunks) {
      const existing = existingByIndex.get(chunk.index);
      if (existing && existing.hash === chunk.contentHash) {
        skipped++;
      } else if (existing) {
        updated++;
        toDeleteIds.push(existing.id);
        toEmbed.push(chunk);
      } else {
        added++;
        toEmbed.push(chunk);
      }
    }

    // Existing chunks beyond the new chunk count are orphans → delete.
    for (const [idx, row] of existingByIndex) {
      if (idx < 0 || idx >= newChunks.length) toDeleteIds.push(row.id);
    }

    // Embed + upsert new/changed chunks in batches.
    for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await embedWithRetry(
        provider,
        batch.map((c) => c.embedText),
        log,
      );

      const rows = batch.map((c, j) => {
        const vec = vectors[j] ?? [];
        if (vec.length !== EMBED_DIM) {
          throw new Error(
            `Embedding dim mismatch for "${title}" chunk ${c.index}: got ${vec.length}, expected ${EMBED_DIM}`,
          );
        }
        summary.tokensEmbedded += c.tokenCount;
        const metadata: Json = {
          title,
          source_url: fm.source_url,
          license: fm.license,
          heading: c.heading,
          chunk_index: c.index,
        };
        return {
          document_id: docId,
          content: c.content,
          heading: c.heading || null,
          token_count: c.tokenCount,
          metadata,
          embedding: JSON.stringify(vec),
          content_hash: c.contentHash,
        };
      });

      const { error } = await supabase
        .from("chunks")
        .upsert(rows, { onConflict: "content_hash" });
      if (error) throw error;
    }

    if (toDeleteIds.length) {
      const { error } = await supabase.from("chunks").delete().in("id", toDeleteIds);
      if (error) throw error;
    }

    summary.docsProcessed++;
    summary.chunksAdded += added;
    summary.chunksUpdated += updated;
    summary.chunksSkipped += skipped;
    summary.chunksDeleted += toDeleteIds.length;

    log(
      `• ${file}: +${added} added, ~${updated} updated, =${skipped} skipped, -${toDeleteIds.length} deleted`,
    );
  }

  summary.approxCostUsd =
    (summary.tokensEmbedded / 1_000_000) * APPROX_USD_PER_MILLION_TOKENS;

  return summary;
}
