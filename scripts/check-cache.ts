/**
 * Re-runnable check for the caching layer (`npm run check:cache`).
 *
 * Guards the two bugs from issue #2:
 *   P0-8 — generation was keyed/stamped with the EMBEDDING model, so changing
 *          the chat model invalidated nothing.
 *   P0-9 — the wrapper advertised response caching it did not perform.
 *
 * Asserts the contract `EmbeddingCache` is supposed to have: embeddings cache
 * and count hits; generation always reaches the provider and writes no rows.
 * Uses a stub provider, so it costs no model quota — only a Supabase round trip
 * against a throwaway model name it cleans up afterwards.
 */
import { EmbeddingCache } from "../lib/llm/cache";
import type { LLMProvider } from "../lib/llm/types";
import { createScriptSupabaseAdmin } from "./_clients";
import { loadEnv } from "./_env";

/** Counts calls that reach the provider, so a cache hit is observable. */
class StubProvider implements LLMProvider {
  embedCalls = 0;
  generateCalls = 0;
  async generate(): Promise<string> {
    this.generateCalls++;
    return "stub answer";
  }
  async *generateStream(): AsyncIterable<string> {
    yield "stub";
  }
  async embed(texts: string[]): Promise<number[][]> {
    this.embedCalls += texts.length;
    return texts.map(() => new Array(1536).fill(0.01) as number[]);
  }
}

async function main() {
  await loadEnv();
  const admin = createScriptSupabaseAdmin();
  // Namespaced so this never collides with real cache rows.
  const MODEL = `check-cache-${Date.now()}`;
  const stub = new StubProvider();
  const cache = new EmbeddingCache(stub, admin, MODEL);
  const text = `check-cache probe ${MODEL}`;

  let failures = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`  ${ok ? "✅" : "❌"} ${msg}`);
    if (!ok) failures++;
  };

  try {
    console.log("── embeddings are cached");
    await cache.embed([text], { dimensions: 1536, taskType: "RETRIEVAL_QUERY" });
    const afterMiss = stub.embedCalls;
    await cache.embed([text], { dimensions: 1536, taskType: "RETRIEVAL_QUERY" });
    check(afterMiss === 1, `miss reaches the provider (calls=${afterMiss})`);
    check(stub.embedCalls === 1, `hit does NOT reach the provider (calls=${stub.embedCalls})`);

    console.log("── generation is never cached (P0-9)");
    await cache.generate("identical prompt", { temperature: 0.3 });
    await cache.generate("identical prompt", { temperature: 0.3 });
    check(
      stub.generateCalls === 2,
      `both identical generate calls reach the provider (calls=${stub.generateCalls})`,
    );
    const { count: generateRows } = await admin
      .from("llm_cache")
      .select("*", { count: "exact", head: true })
      .eq("model", MODEL)
      .eq("kind", "generate");
    check(generateRows === 0, `no 'generate' rows written (rows=${generateRows})`);

    console.log("── rows are stamped with the embedding model (P0-8)");
    // bumpHits is fire-and-forget, so give it a moment to land.
    await new Promise((r) => setTimeout(r, 800));
    const { data: row } = await admin
      .from("llm_cache")
      .select("kind, model, hits")
      .eq("model", MODEL)
      .maybeSingle();
    check(row?.kind === "embed", `row kind is 'embed' (got ${row?.kind})`);
    check(row?.model === MODEL, `row stamped with the embed model (got ${row?.model})`);
    check((row?.hits ?? 0) >= 1, `hits incremented on the cache hit (hits=${row?.hits})`);
  } finally {
    await admin.from("llm_cache").delete().eq("model", MODEL);
  }

  console.log(failures === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failures} failure(s))`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("check-cache failed:", err);
  process.exit(1);
});
