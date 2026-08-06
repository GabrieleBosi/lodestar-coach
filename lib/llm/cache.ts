/**
 * An EMBEDDING cache in front of an LLMProvider.
 *
 * Only `embed()` is cached. Embeddings are a pure function of
 * (text, model, dimensions, taskType), so a hit is always correct.
 *
 * `generate()` and `generateStream()` are deliberate pass-throughs. They used to
 * be cached, which was wrong twice over: the key was stamped with the EMBEDDING
 * model (so changing the chat model invalidated nothing and two chat models
 * sharing an embed model collided), and caching user-facing coaching answers is
 * a product decision that was never actually made. See issue #2, P0-8/P0-9.
 *
 * If response caching is wanted later it belongs in the agent loop, keyed over
 * (model, system, history, message) with explicit invalidation when the user's
 * logged data changes — not here, where the key cannot see any of that.
 *
 * The cache is global infrastructure and uses a service-role client.
 */
import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../db/types";
import type { EmbedOptions, GenerateOptions, LLMProvider } from "./types";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hashKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export class EmbeddingCache implements LLMProvider {
  /**
   * Takes only the embedding model. A second model field would have no consumer
   * — generation is a pass-through — and would reintroduce exactly the
   * pick-the-wrong-one bug this class was mis-keyed by (P0-8).
   */
  constructor(
    private readonly base: LLMProvider,
    private readonly cache: SupabaseClient<Database>,
    private readonly embedModel: string,
  ) {}

  private async get(key: string): Promise<{ value: Record<string, unknown>; hits: number } | null> {
    const { data } = await this.cache
      .from("llm_cache")
      .select("value, hits")
      .eq("key", key)
      .maybeSingle();
    return data ? { value: data.value as Record<string, unknown>, hits: data.hits } : null;
  }

  /**
   * Fire-and-forget so hit accounting never adds a round trip to the hot path.
   * Concurrent hits on the same key can lose an increment; this is a usage
   * counter, not an accounting record.
   */
  private bumpHits(key: string, hits: number): void {
    void this.cache
      .from("llm_cache")
      .update({ hits: hits + 1 })
      .eq("key", key)
      .then(undefined, () => {
        /* best effort */
      });
  }

  private async set(key: string, value: Record<string, unknown>): Promise<void> {
    await this.cache
      .from("llm_cache")
      .upsert(
        { key, kind: "embed", model: this.embedModel, value: value as Json },
        { onConflict: "key" },
      );
  }

  /** Pass-through: see the file docstring. */
  generate(prompt: string, opts?: GenerateOptions): Promise<string> {
    return this.base.generate(prompt, opts);
  }

  /** Pass-through: see the file docstring. */
  generateStream(prompt: string, opts?: GenerateOptions): AsyncIterable<string> {
    return this.base.generateStream(prompt, opts);
  }

  async embed(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
    const dims = opts.dimensions ?? 1536;
    const task = opts.taskType ?? "";
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const missing: { i: number; text: string; key: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i] ?? "";
      const key = hashKey(["embed", this.embedModel, dims, task, normalize(text)]);
      const hit = await this.get(key);
      if (hit && Array.isArray(hit.value.values)) {
        results[i] = hit.value.values as number[];
        this.bumpHits(key, hit.hits);
      } else {
        missing.push({ i, text, key });
      }
    }

    if (missing.length > 0) {
      const fresh = await this.base.embed(
        missing.map((m) => m.text),
        opts,
      );
      for (let j = 0; j < missing.length; j++) {
        const m = missing[j]!;
        const vec = fresh[j] ?? [];
        results[m.i] = vec;
        await this.set(m.key, { values: vec });
      }
    }

    return results.map((r) => r ?? []);
  }
}
