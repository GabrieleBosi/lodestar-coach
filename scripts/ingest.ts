/**
 * Knowledge ingestion CLI: `npm run ingest`.
 * Reads /knowledge, embeds new/changed chunks, and syncs the chunks table.
 */
import path from "node:path";

import { runIngestion } from "../lib/rag/ingest";
import { createScriptProvider, createScriptSupabaseAdmin } from "./_clients";
import { loadEnv } from "./_env";

async function main() {
  await loadEnv();

  const supabase = createScriptSupabaseAdmin();
  const provider = createScriptProvider();
  const knowledgeDir = path.resolve(process.cwd(), "knowledge");

  const started = Date.now();
  const summary = await runIngestion({
    supabase,
    provider,
    knowledgeDir,
    log: (m) => console.log(m),
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n── Ingestion summary ──");
  console.log(`docs processed:   ${summary.docsProcessed}`);
  console.log(`chunks added:     ${summary.chunksAdded}`);
  console.log(`chunks updated:   ${summary.chunksUpdated}`);
  console.log(`chunks skipped:   ${summary.chunksSkipped}`);
  console.log(`chunks deleted:   ${summary.chunksDeleted}`);
  console.log(`tokens embedded:  ${summary.tokensEmbedded}`);
  console.log(`approx cost:      $${summary.approxCostUsd.toFixed(6)}`);
  console.log(`elapsed:          ${seconds}s`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
