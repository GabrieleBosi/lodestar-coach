/**
 * A caching wrapper around an LLMProvider. Embeddings and single-shot generations
 * are keyed by a sha256 of the normalized input (+ model) and stored in the
 * shared `llm_cache` table, so repeats don't re-hit the API. Streaming is not
 * cached. The cache is global infrastructure and uses a service-role client.
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

export class CachingProvider implements LLMProvider {
  constructor(
    private readonly base: LLMProvider,
    private readonly cache: SupabaseClient<Database>,
    private readonly model: string,
  ) {}

  private async get(key: string): Promise<Record<string, unknown> | null> {
    const { data } = await this.cache
      .from("llm_cache")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data ? (data.value as Record<string, unknown>) : null;
  }

  private async set(key: string, kind: string, value: Record<string, unknown>): Promise<void> {
    await this.cache
      .from("llm_cache")
      .upsert({ key, kind, model: this.model, value: value as Json }, { onConflict: "key" });
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
    const key = hashKey([
      "generate",
      this.model,
      normalize(prompt),
      normalize(opts.system ?? ""),
      opts.temperature ?? null,
      opts.maxOutputTokens ?? null,
    ]);
    const hit = await this.get(key);
    if (hit && typeof hit.text === "string") return hit.text;

    const text = await this.base.generate(prompt, opts);
    await this.set(key, "generate", { text });
    return text;
  }

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
      const key = hashKey(["embed", this.model, dims, task, normalize(text)]);
      const hit = await this.get(key);
      if (hit && Array.isArray(hit.values)) {
        results[i] = hit.values as number[];
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
        await this.set(m.key, "embed", { values: vec });
      }
    }

    return results.map((r) => r ?? []);
  }
}
