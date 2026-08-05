/**
 * Deterministic invariant checks for the memory pipeline (issue #2, P0-2).
 * Run with `npm run eval:memory`; exits non-zero on failure so CI can gate.
 *
 * Gated invariants:
 *   A. Profile-owned facts (weight, height, age, sex, goal, activity, name)
 *      are NEVER written to memories — stating them in chat leaves zero rows.
 *   B. Restating the same non-profile fact does not duplicate it (≤ 1 row).
 *
 * Informational (printed, not gated — depends on embedding similarity of two
 * different sentences): C. an UPDATED fact supersedes the old row.
 *
 * Uses a throwaway auth user via an RLS-scoped signed-in client (match_memories
 * depends on auth.uid(), exactly like production) and cleans up after itself.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { extractAndStoreMemories, isProfileOwnedFact } from "../lib/agent/memory";
import type { Database } from "../lib/db/types";
import { createScriptProvider, createScriptSupabaseAdmin } from "../scripts/_clients";
import { loadEnv } from "../scripts/_env";

async function main() {
  await loadEnv();
  const admin = createScriptSupabaseAdmin();
  const provider = createScriptProvider();
  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.log(`  ❌ ${msg}`);
  };
  const ok = (msg: string) => console.log(`  ✅ ${msg}`);

  // ── Pure filter unit checks (no LLM, fully deterministic) ──
  console.log("── Filter: isProfileOwnedFact");
  const mustFilter = [
    "Weighs 62 kg",
    "Weight is 51 kg",
    "Is 160 cm tall",
    "Height is 160 cm",
    "Is a 25-year-old male",
    "25-year-old male",
    "Goal is a lean bulk",
    "Has a goal of lean bulking",
    "Has an active activity level",
    "Name is Gabriele",
  ];
  const mustKeep = [
    "Back squatted 102.5 kg for 5x5 at RPE 8",
    "Prefers training in the morning",
    "Has a sensitive left knee",
    "Trains in a home gym with dumbbells only",
  ];
  for (const f of mustFilter) {
    if (isProfileOwnedFact(f)) ok(`filters: "${f}"`);
    else fail(`should filter but kept: "${f}"`);
  }
  for (const f of mustKeep) {
    if (!isProfileOwnedFact(f)) ok(`keeps: "${f}"`);
    else fail(`should keep but filtered: "${f}"`);
  }

  // ── Live pipeline checks ──
  const email = `eval-memory+${Date.now()}@lodestar.test`;
  const password = randomUUID();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created?.user) throw error ?? new Error("failed to create eval user");
  const userId = created.user.id;

  const authed: SupabaseClient<Database> = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  await authed.auth.signInWithPassword({ email, password });
  const ctx = { supabase: authed, provider, userId };

  const rows = async () => {
    const { data } = await authed.from("memories").select("content").eq("user_id", userId);
    return (data ?? []).map((r) => r.content);
  };

  try {
    console.log("\n── A. Profile-owned facts never become memories");
    await extractAndStoreMemories(
      ctx,
      "Quick intro: I'm a 25-year-old male, 178 cm tall, I weigh 78 kg, my goal is a lean bulk and my activity level is active.",
      "Great — I've saved that to your profile.",
    );
    const afterA = await rows();
    const leaked = afterA.filter((c) => isProfileOwnedFact(c));
    if (leaked.length === 0) ok(`no profile-owned memories stored (${afterA.length} rows total)`);
    else fail(`leaked profile-owned rows: ${JSON.stringify(leaked)}`);

    console.log("\n── B. Restating a fact does not duplicate it");
    const pr = "My best back squat is 5x5 at 102.5 kg at RPE 8.";
    await extractAndStoreMemories(ctx, pr, "Nice lift — noted.");
    await extractAndStoreMemories(ctx, pr, "Nice lift — noted.");
    const afterB = (await rows()).filter((c) => c.includes("102.5"));
    if (afterB.length <= 1) ok(`squat PR stored ${afterB.length}× after two identical turns`);
    else fail(`duplicated: ${JSON.stringify(afterB)}`);

    console.log("\n── C. (informational) Updated fact supersedes the old row");
    await extractAndStoreMemories(
      ctx,
      "Update: my best back squat is now 5x5 at 105 kg.",
      "Noted.",
    );
    const afterC = (await rows()).filter((c) => /squat/i.test(c));
    console.log(
      `  squat rows now: ${JSON.stringify(afterC)} ${afterC.length === 1 ? "(superseded ✓)" : "(similarity below threshold — kept both; not gated)"}`,
    );
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }

  console.log(failures === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failures} failure(s))`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("memory check failed:", err);
  process.exit(1);
});
