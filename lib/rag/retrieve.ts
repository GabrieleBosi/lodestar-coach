/**
 * Hybrid retrieval: dense vector search (match_chunks) + lexical full-text
 * search (match_chunks_keyword), fused with Reciprocal Rank Fusion (RRF).
 *
 * RRF combines rankings without needing to normalise the two very different
 * score scales (cosine similarity vs. ts_rank): each result contributes
 * 1 / (K + rank) from every list it appears in.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/types";
import type { LLMProvider } from "../llm/types";

const RRF_K = 60;
const EMBED_DIM = 1536;

export interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  heading: string | null;
  title: string | null;
  sourceUrl: string | null;
  /** Cosine similarity from the vector search, if it appeared there. */
  similarity?: number;
  /** ts_rank from the keyword search, if it appeared there. */
  keywordRank?: number;
  /** Fused RRF score used for the final ordering. */
  score: number;
}

type Candidate = RetrievedChunk;

function titleFromMetadata(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "title" in metadata) {
    const t = (metadata as Record<string, unknown>).title;
    if (typeof t === "string") return t;
  }
  return null;
}

export async function retrieve(
  supabase: SupabaseClient<Database>,
  provider: LLMProvider,
  query: string,
  k = 6,
): Promise<RetrievedChunk[]> {
  const perList = Math.max(k * 2, k);

  const [queryEmbedding] = await provider.embed([query], {
    dimensions: EMBED_DIM,
    taskType: "RETRIEVAL_QUERY",
  });

  const [vectorRes, keywordRes] = await Promise.all([
    supabase.rpc("match_chunks", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: perList,
      filter: {},
    }),
    supabase.rpc("match_chunks_keyword", {
      query_text: query,
      match_count: perList,
    }),
  ]);

  if (vectorRes.error) throw vectorRes.error;
  if (keywordRes.error) throw keywordRes.error;

  const merged = new Map<string, Candidate>();

  const ensure = (row: {
    id: string;
    document_id: string;
    content: string;
    heading: string | null;
    metadata: unknown;
    source_url: string | null;
  }): Candidate => {
    let c = merged.get(row.id);
    if (!c) {
      c = {
        id: row.id,
        documentId: row.document_id,
        content: row.content,
        heading: row.heading,
        title: titleFromMetadata(row.metadata),
        sourceUrl: row.source_url,
        score: 0,
      };
      merged.set(row.id, c);
    }
    return c;
  };

  (vectorRes.data ?? []).forEach((row, rank) => {
    const c = ensure(row);
    c.similarity = row.similarity;
    c.score += 1 / (RRF_K + rank + 1);
  });

  (keywordRes.data ?? []).forEach((row, rank) => {
    const c = ensure(row);
    c.keywordRank = row.rank;
    c.score += 1 / (RRF_K + rank + 1);
  });

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, k);
}
