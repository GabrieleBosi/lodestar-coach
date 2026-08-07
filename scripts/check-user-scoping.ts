/**
 * Cross-user isolation guard for the service-role path (`npm run check:scoping`).
 *
 * The public demo runs the whole agent on the SERVICE-ROLE client, where RLS is
 * not enforced. `get_history` filtered on date alone and returned every user's
 * rows, so /demo answered "how's my squat trending?" with a real, signed-in
 * user's 102.5 kg back squat. RLS looked like the control; it was never in the
 * request path at all.
 *
 * So this runs the real tool, through a real service-role client, with two real
 * users — the exact configuration production uses — and asserts the acting
 * user's rows come back and the other user's do not. Both directions matter: a
 * tool that returns nothing would pass a leak test and be just as broken.
 *
 * Temp users are created and deleted rather than reusing the seeded demo user,
 * so a CI run never mutates demo data. Requires SUPABASE_SERVICE_ROLE_KEY.
 */
import { randomUUID } from "node:crypto";

import { resolveDemoConversation } from "../lib/agent/demo";
import { AGENT_TOOLS, type ToolContext } from "../lib/agent/tools";
import { createScriptProvider, createScriptSupabaseAdmin } from "./_clients";
import { loadEnv } from "./_env";

type AdminClient = ReturnType<typeof createScriptSupabaseAdmin>;

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : `\n    ${detail}`}`);
}

function tool(name: string) {
  const t = AGENT_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no such tool: ${name}`);
  return t;
}

async function createUser(admin: AdminClient, tag: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `scoping-${tag}+${Date.now()}-${Math.floor(Math.random() * 1e6)}@lodestar.test`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data?.user) throw error ?? new Error("failed to create test user");
  return data.user.id;
}

const today = new Date().toISOString().slice(0, 10);

async function main() {
  await loadEnv();

  const admin = createScriptSupabaseAdmin();
  const provider = createScriptProvider();

  const actingId = await createUser(admin, "acting");
  const otherId = await createUser(admin, "other");

  // Distinctive enough that a match cannot be coincidence.
  const ACTING_MARK = `scoping-acting-${randomUUID().slice(0, 8)}`;
  const OTHER_MARK = `scoping-other-${randomUUID().slice(0, 8)}`;

  try {
    await admin.from("workouts").insert([
      { user_id: actingId, date: today, type: "squat", notes: `Back squat 5x5 ${ACTING_MARK}` },
      { user_id: otherId, date: today, type: "squat", notes: `Back squat 5x5 ${OTHER_MARK}` },
    ]);
    await admin.from("nutrition_logs").insert([
      { user_id: actingId, date: today, notes: `Oats and whey ${ACTING_MARK}` },
      { user_id: otherId, date: today, notes: `Rice and chicken ${OTHER_MARK}` },
    ]);

    // Exactly what app/api/demo/chat/route.ts builds: service-role client, a
    // fixed acting user, nothing else standing between the tool and the table.
    const ctx: ToolContext = {
      supabase: admin,
      provider,
      userId: actingId,
      requestId: randomUUID(),
      citations: [],
      profileReadOnly: true,
    };

    const getHistory = tool("get_history");

    for (const [label, metric] of [
      ["workouts (keyword filter)", "squat"],
      ["workouts (generic)", "workouts"],
      ["nutrition", "nutrition"],
    ] as [string, string][]) {
      const { data } = await getHistory.execute({ metric, range: "7 days" }, ctx);
      const body = JSON.stringify(data);
      check(
        `${label}: returns the acting user's rows`,
        body.includes(ACTING_MARK),
        body.slice(0, 400),
      );
      check(`${label}: leaks no other user's rows`, !body.includes(OTHER_MARK), body.slice(0, 400));
    }

    // The other half of the same assumption: a conversation id is a claim, and
    // on the service-role client nothing checks it but us.
    const { data: foreign } = await admin
      .from("conversations")
      .insert({ user_id: otherId, title: "scoping: not the demo user's" })
      .select("id")
      .single();
    const { data: own } = await admin
      .from("conversations")
      .insert({ user_id: actingId, title: "scoping: the acting user's" })
      .select("id")
      .single();

    check(
      "demo conversation: another user's id is rejected",
      (await resolveDemoConversation(admin, actingId, foreign!.id)) === null,
    );
    check(
      "demo conversation: an unknown id is rejected",
      (await resolveDemoConversation(admin, actingId, randomUUID())) === null,
    );
    check(
      "demo conversation: the acting user's own id is accepted",
      (await resolveDemoConversation(admin, actingId, own!.id)) === own!.id,
    );
  } finally {
    // profiles/workouts/nutrition/conversations all cascade from auth.users.
    await admin.auth.admin.deleteUser(actingId).catch(() => {});
    await admin.auth.admin.deleteUser(otherId).catch(() => {});
  }

  console.log(
    failures === 0 ? "\nAll scoping checks passed ✅" : `\n${failures} check(s) FAILED ❌`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Scoping check failed:", err);
  process.exit(1);
});
