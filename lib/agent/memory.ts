/**
 * Long-term memory: extract durable user facts from a conversation turn, embed
 * and store them; and retrieve relevant memories + profile to personalize
 * answers.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/types";
import type { LLMProvider } from "../llm/types";

const EMBED_DIM = 1536;
const MEMORY_MATCH_COUNT = 5;

interface MemoryContext {
  supabase: SupabaseClient<Database>;
  provider: LLMProvider;
  userId: string;
}

/** Build a personalization block from the user's profile + relevant memories. */
export async function getPersonalizationContext(
  ctx: MemoryContext,
  query: string,
): Promise<string> {
  const [{ data: profile }, memoriesText] = await Promise.all([
    ctx.supabase
      .from("profiles")
      .select("display_name, units, goals, height_cm, weight_kg, age, sex, activity_level")
      .eq("id", ctx.userId)
      .maybeSingle(),
    retrieveMemories(ctx, query),
  ]);

  const lines: string[] = [];

  if (profile) {
    const facts: string[] = [];
    if (profile.display_name) facts.push(`name: ${profile.display_name}`);
    if (profile.goals) facts.push(`goals: ${profile.goals}`);
    if (profile.sex) facts.push(`sex: ${profile.sex}`);
    if (profile.age != null) facts.push(`age: ${profile.age}`);
    if (profile.height_cm != null) facts.push(`height: ${profile.height_cm} cm`);
    if (profile.weight_kg != null) facts.push(`weight: ${profile.weight_kg} kg`);
    if (profile.activity_level) facts.push(`activity: ${profile.activity_level}`);
    if (profile.units) facts.push(`units: ${profile.units}`);
    if (facts.length) lines.push(`Profile — ${facts.join("; ")}.`);
  }

  if (memoriesText) lines.push(`Remembered about this user:\n${memoriesText}`);

  return lines.join("\n");
}

async function retrieveMemories(ctx: MemoryContext, query: string): Promise<string> {
  try {
    const [embedding] = await ctx.provider.embed([query], {
      dimensions: EMBED_DIM,
      taskType: "RETRIEVAL_QUERY",
    });
    const { data, error } = await ctx.supabase.rpc("match_memories", {
      query_embedding: JSON.stringify(embedding),
      match_count: MEMORY_MATCH_COUNT,
    });
    if (error || !data) return "";
    return data.map((m) => `- ${m.content}`).join("\n");
  } catch {
    return "";
  }
}

function parseFactArray(text: string): string[] {
  const match = /\[[\s\S]*\]/.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 240)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Facts that live in the `profiles` table (weight, height, age, sex, goal,
 * activity level, name) must NEVER be stored as memories: the profile is the
 * authoritative, user-editable source and is always injected into the prompt,
 * so a mirrored memory row can only drift and contradict it (issue #2, P0-2).
 * The extraction prompt says so too, but prompts aren't reliable — this filter
 * is the backstop.
 */
const PROFILE_OWNED_PATTERNS: RegExp[] = [
  /\b(weighs?|weight\s+is|body\s?weight)\b/i,
  /\b(height|\d+\s*cm\s+tall)\b/i,
  /\b(\d+[\s-]?years?[\s-]?old|age\s+is|aged\s+\d+)\b/i,
  /\b(is\s+)?(male|female)\b/i,
  /\b(goal\s+(is|of)|goals?:)\b/i,
  /\blean[\s-]?bulk/i,
  /\b(cutting|bulking|maintaining)\s+(phase|goal)\b/i,
  /\bactivity\s+level\b/i,
  /\b(name\s+is|is\s+named|called)\b/i,
];

export function isProfileOwnedFact(fact: string): boolean {
  return PROFILE_OWNED_PATTERNS.some((re) => re.test(fact));
}

/** Cosine similarity above which two memories are considered the same fact. */
const DEDUPE_SIMILARITY = 0.9;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Extract durable facts/preferences from an exchange and store new ones.
 *
 * Profile-owned facts are excluded entirely (see PROFILE_OWNED_PATTERNS — the
 * agent's update_profile tool captures those into the profile instead). Each
 * surviving fact is deduped by embedding similarity: if an existing memory is
 * ≥ DEDUPE_SIMILARITY it is SUPERSEDED (old row deleted, new row inserted) so a
 * restated fact stays single-row and an updated fact keeps only the newest
 * value. Best-effort: failures are swallowed so they never break the response.
 */
export async function extractAndStoreMemories(
  ctx: MemoryContext,
  userMessage: string,
  assistantAnswer: string,
): Promise<number> {
  try {
    const prompt = `From the exchange below, extract durable facts or stable preferences about the USER that are worth remembering across future sessions (e.g., dietary preferences/restrictions, injuries, equipment, personal records, schedule). Do NOT extract weight, height, age, sex, activity level, training goal, or name — those are stored in the user's profile, not in memory. Ignore transient chit-chat and anything about the assistant. Return ONLY a JSON array of short first-person-free strings (e.g., "Prefers training in the morning"). Return [] if nothing durable.

User: ${userMessage}
Assistant: ${assistantAnswer}`;

    const raw = await ctx.provider.generate(prompt, { temperature: 0 });
    const facts = parseFactArray(raw).filter((f) => !isProfileOwnedFact(f));
    if (facts.length === 0) return 0;

    const embeddings = await ctx.provider.embed(facts, {
      dimensions: EMBED_DIM,
      taskType: "RETRIEVAL_DOCUMENT",
    });

    let stored = 0;
    const batchKept: { content: string; embedding: number[] }[] = [];

    for (let i = 0; i < facts.length; i++) {
      const content = facts[i]!;
      const embedding = embeddings[i] ?? [];
      if (embedding.length === 0) continue;

      // In-batch dedupe: the extractor sometimes restates one fact twice.
      if (batchKept.some((k) => cosine(k.embedding, embedding) >= DEDUPE_SIMILARITY)) continue;

      // Supersede any existing near-duplicate: newest value wins, one row per fact.
      const { data: similar } = await ctx.supabase.rpc("match_memories", {
        query_embedding: JSON.stringify(embedding),
        match_count: 3,
      });
      const toSupersede = (similar ?? []).filter((m) => m.similarity >= DEDUPE_SIMILARITY);
      if (toSupersede.length > 0) {
        await ctx.supabase
          .from("memories")
          .delete()
          .in(
            "id",
            toSupersede.map((m) => m.id),
          );
      }

      const { error } = await ctx.supabase.from("memories").insert({
        user_id: ctx.userId,
        content,
        embedding: JSON.stringify(embedding),
        kind: "fact",
        salience: 0.5,
      });
      if (!error) {
        stored++;
        batchKept.push({ content, embedding });
      }
    }

    return stored;
  } catch {
    return 0;
  }
}
