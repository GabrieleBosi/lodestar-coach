/**
 * Retrieval smoke test: `npm run query -- "your question"`.
 * Embeds the query (RETRIEVAL_QUERY @1536) and prints the top match_chunks hits.
 *
 * Uses the service-role client so it bypasses RLS for the smoke test
 * (match_chunks is SECURITY INVOKER; in the app it runs as the signed-in user).
 */
import { createScriptProvider, createScriptSupabaseAdmin } from "./_clients";
import { loadEnv } from "./_env";

const TOP_K = 5;

async function main() {
  await loadEnv();

  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run query -- "how should I structure a deload week?"');
    process.exit(1);
  }

  const supabase = createScriptSupabaseAdmin();
  const provider = createScriptProvider();

  const [queryEmbedding] = await provider.embed([question], {
    dimensions: 1536,
    taskType: "RETRIEVAL_QUERY",
  });

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: TOP_K,
    filter: {},
  });
  if (error) throw error;

  console.log(`\nQuery: ${question}`);
  console.log(`Top ${TOP_K} results:\n`);

  if (!data || data.length === 0) {
    console.log("(no results — has `npm run ingest` been run?)");
    return;
  }

  data.forEach((row, i) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const title = (meta.title as string) ?? "(untitled)";
    const snippet = row.content.replace(/\s+/g, " ").slice(0, 180);
    console.log(`${i + 1}. [${row.similarity.toFixed(4)}] ${title}`);
    if (row.heading) console.log(`   heading: ${row.heading}`);
    if (row.source_url) console.log(`   source:  ${row.source_url}`);
    console.log(`   "${snippet}…"\n`);
  });
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
