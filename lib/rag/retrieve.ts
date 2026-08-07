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

/**
 * Cosine similarity a dense-only match must clear to count as coverage.
 *
 * `match_chunks` returns its top-k unconditionally — it has no notion of "no
 * good answer" — so a question the corpus says nothing about still came back
 * with six confident-looking chunks. The agent registered all six as citations
 * and answered from the model's own training data, with markers pointing at
 * unrelated documents. A floor is what turns "the nearest six things" into
 * "the six things that are actually about this".
 *
 * 0.75 was measured, not guessed, against the live corpus (11 ingested
 * documents, 50 chunks) using the query embeddings already in `llm_cache`:
 *
 *   in-corpus  deload 0.868 · sleep 0.848 · protein 0.842 · progressive
 *              overload 0.832 · foam rolling 0.816 · static stretching 0.813 ·
 *              lean-bulk calorie/protein targets 0.771
 *   off-corpus beta-alanine 0.726 · creatine+dose 0.695 · creatine 0.677 ·
 *              creatine (short) 0.617
 *
 * The two populations separate cleanly between 0.726 and 0.771; 0.75 sits in
 * that gap. Re-measure it when the corpus or the embedding model changes —
 * `RETRIEVAL_MIN_SIMILARITY` overrides it without a release in the meantime.
 */
export const DEFAULT_MIN_SIMILARITY = 0.75;

/** Read the similarity floor, ignoring an unset/garbage/out-of-range override. */
export function readSimilarityFloor(
  // Next's ProcessEnv declares only the keys it knows about and has no index
  // signature, so it is read through a plain record — which is also what lets
  // the CI check pass literal environments without faking NODE_ENV.
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): number {
  const raw = env.RETRIEVAL_MIN_SIMILARITY?.trim();
  if (!raw) return DEFAULT_MIN_SIMILARITY;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_MIN_SIMILARITY;
}

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

/**
 * Does this result set actually ground the query?
 *
 * Covered means at least one returned chunk earned its place: either the
 * lexical search matched it (`match_chunks_keyword` ANDs every query term, so a
 * hit is strong evidence the corpus discusses the subject), or the vector
 * search placed it above the similarity floor. Nearest-neighbour rank on its
 * own is not evidence — every query has a nearest neighbour.
 *
 * Deliberately evaluated on the SLICE that will be returned, not on the wider
 * candidate pool: coverage has to be a property of the chunks the model is
 * handed, or a covering chunk that fell outside the top-k would vouch for six
 * chunks that don't cover anything.
 */
export function hasGroundedCoverage(chunks: RetrievedChunk[], floor: number): boolean {
  return chunks.some((c) => c.keywordRank != null || (c.similarity ?? 0) >= floor);
}

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

  const top = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, k);

  // Uncovered queries return NOTHING rather than the nearest six strangers.
  // Withholding the chunks is what makes the grounding rule enforceable: the
  // caller never registers a citation, so there is no marker for the model to
  // attach to an answer it made up. A prompt instruction alone cannot do that —
  // the model was already told to answer only from context, and still cited
  // "Hydration for Training" for a beta-alanine protocol.
  return hasGroundedCoverage(top, readSimilarityFloor()) ? top : [];
}
