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
 * Extract durable facts/preferences from an exchange and store new ones.
 * Best-effort: failures are swallowed so they never break the chat response.
 */
export async function extractAndStoreMemories(
  ctx: MemoryContext,
  userMessage: string,
  assistantAnswer: string,
): Promise<number> {
  try {
    const prompt = `From the exchange below, extract durable facts or stable preferences about the USER that are worth remembering across future sessions (e.g., goals, dietary preferences/restrictions, injuries, equipment, personal records, biometrics, schedule). Ignore transient chit-chat and anything about the assistant. Return ONLY a JSON array of short first-person-free strings (e.g., "Prefers training in the morning"). Return [] if nothing durable.

User: ${userMessage}
Assistant: ${assistantAnswer}`;

    const raw = await ctx.provider.generate(prompt, { temperature: 0 });
    const facts = parseFactArray(raw);
    if (facts.length === 0) return 0;

    // Skip facts we already store verbatim.
    const { data: existing } = await ctx.supabase
      .from("memories")
      .select("content")
      .eq("user_id", ctx.userId);
    const known = new Set((existing ?? []).map((r) => r.content.trim().toLowerCase()));
    const fresh = facts.filter((f) => !known.has(f.toLowerCase()));
    if (fresh.length === 0) return 0;

    const embeddings = await ctx.provider.embed(fresh, {
      dimensions: EMBED_DIM,
      taskType: "RETRIEVAL_DOCUMENT",
    });

    const rows = fresh.map((content, i) => ({
      user_id: ctx.userId,
      content,
      embedding: JSON.stringify(embeddings[i] ?? []),
      kind: "fact",
      salience: 0.5,
    }));

    const { error } = await ctx.supabase.from("memories").insert(rows);
    if (error) return 0;
    return rows.length;
  } catch {
    return 0;
  }
}
