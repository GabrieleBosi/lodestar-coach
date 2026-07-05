/**
 * Agent tools. Each tool has a JSON Schema (for Gemini function declarations), a
 * zod schema (to validate the model's arguments before executing), and an
 * `execute` that runs against the user's session-scoped Supabase client.
 *
 * `search_knowledge` accumulates citations onto the shared ToolContext so the
 * final answer can cite `[n]` consistently.
 */
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/types";
import type { LLMProvider } from "../llm/types";
import type { Citation } from "../rag/prompt";
import { retrieve, type RetrievedChunk } from "../rag/retrieve";
import { computeEnergyTargets, type ActivityLevel, type Sex } from "./energy";

export interface ToolContext {
  supabase: SupabaseClient<Database>;
  provider: LLMProvider;
  userId: string;
  requestId: string;
  /** Accumulated citations (shared across search_knowledge calls). */
  citations: Citation[];
}

/** Register a chunk as a citation, returning its stable 1-based marker. */
function cite(ctx: ToolContext, chunk: RetrievedChunk): number {
  const existing = ctx.citations.find((c) => c.chunkId === chunk.id);
  if (existing) return existing.n;
  const n = ctx.citations.length + 1;
  ctx.citations.push({
    n,
    chunkId: chunk.id,
    title: chunk.title,
    sourceUrl: chunk.sourceUrl,
    heading: chunk.heading,
  });
  return n;
}

export interface ToolResult {
  /** JSON object returned to the model as the functionResponse. */
  data: Record<string, unknown>;
  /** Short human-readable summary for the "actions taken" trace. */
  summary: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodType;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

function daysFromRange(range: string | undefined, fallbackDays: number): number {
  if (!range) return fallbackDays;
  const m = /(\d+)\s*(day|week|month)/i.exec(range);
  if (!m) return fallbackDays;
  const n = Number(m[1]);
  const unit = (m[2] ?? "day").toLowerCase();
  return unit.startsWith("week") ? n * 7 : unit.startsWith("month") ? n * 30 : n;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── search_knowledge ────────────────────────────────────────────────────────
const searchSchema = z.object({ query: z.string().min(1) });

const searchKnowledge: AgentTool = {
  name: "search_knowledge",
  description:
    "Search the evidence-based knowledge base (training, nutrition, recovery) for grounding. Use before giving factual guidance so you can cite sources.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Search query" } },
    required: ["query"],
  },
  schema: searchSchema,
  async execute(args, ctx) {
    const { query } = searchSchema.parse(args);
    const chunks = await retrieve(ctx.supabase, ctx.provider, query, 6);
    const results = chunks.map((c) => ({
      marker: cite(ctx, c),
      title: c.title,
      heading: c.heading,
      source_url: c.sourceUrl,
      content: c.content,
    }));
    return {
      data: { results },
      summary: `search_knowledge("${query}") → ${results.length} chunk(s)`,
    };
  },
};

// ── log_workout ─────────────────────────────────────────────────────────────
const logWorkoutSchema = z.object({
  date: z.string().optional(),
  type: z.string().min(1),
  details: z.string().optional(),
});

const logWorkout: AgentTool = {
  name: "log_workout",
  description: "Record a training session for the user (date, type, and free-text details).",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "ISO date YYYY-MM-DD; defaults to today" },
      type: { type: "string", description: "Session type, e.g. 'lower', 'squat', 'run'" },
      details: { type: "string", description: "Free text, e.g. 'squats 5x5 @ 100kg, felt easy'" },
    },
    required: ["type"],
  },
  schema: logWorkoutSchema,
  async execute(args, ctx) {
    const { date, type, details } = logWorkoutSchema.parse(args);
    const row = {
      user_id: ctx.userId,
      date: date ?? today(),
      type,
      notes: details ?? null,
      payload: { details: details ?? null },
    };
    const { data, error } = await ctx.supabase
      .from("workouts")
      .insert(row)
      .select("id, date")
      .single();
    if (error) throw new Error(error.message);
    return { data: { id: data.id, date: data.date }, summary: `log_workout(${row.date}, ${type})` };
  },
};

// ── log_nutrition ───────────────────────────────────────────────────────────
const logNutritionSchema = z.object({
  date: z.string().optional(),
  items: z.string().optional(),
  notes: z.string().optional(),
});

const logNutrition: AgentTool = {
  name: "log_nutrition",
  description: "Record a nutrition entry for the user (date, items, and/or notes).",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "ISO date YYYY-MM-DD; defaults to today" },
      items: { type: "string", description: "What was eaten" },
      notes: { type: "string", description: "Additional notes" },
    },
  },
  schema: logNutritionSchema,
  async execute(args, ctx) {
    const { date, items, notes } = logNutritionSchema.parse(args);
    const row = {
      user_id: ctx.userId,
      date: date ?? today(),
      notes: notes ?? null,
      payload: { items: items ?? null },
    };
    const { data, error } = await ctx.supabase
      .from("nutrition_logs")
      .insert(row)
      .select("id, date")
      .single();
    if (error) throw new Error(error.message);
    return { data: { id: data.id, date: data.date }, summary: `log_nutrition(${row.date})` };
  },
};

// ── get_history ─────────────────────────────────────────────────────────────
const getHistorySchema = z.object({
  metric: z.string().min(1),
  range: z.string().optional(),
});

const getHistory: AgentTool = {
  name: "get_history",
  description:
    "Fetch the user's recent logged workouts or nutrition to spot trends (e.g., squat top-set over 8 weeks). Returns a compact time series.",
  parameters: {
    type: "object",
    properties: {
      metric: {
        type: "string",
        description:
          "What to look at, e.g. 'squat', 'workouts', or 'nutrition'. Keyword filters workout type/notes.",
      },
      range: { type: "string", description: "Look-back window, e.g. '8 weeks' or '30 days'" },
    },
    required: ["metric"],
  },
  schema: getHistorySchema,
  async execute(args, ctx) {
    const { metric, range } = getHistorySchema.parse(args);
    const since = isoDaysAgo(daysFromRange(range, 56));
    const isNutrition = /nutrition|diet|food|calorie|macro/i.test(metric);

    if (isNutrition) {
      const { data, error } = await ctx.supabase
        .from("nutrition_logs")
        .select("date, notes, payload")
        .gte("date", since)
        .order("date", { ascending: true });
      if (error) throw new Error(error.message);
      return {
        data: { metric, since, entries: data },
        summary: `get_history(nutrition, since ${since}) → ${data.length}`,
      };
    }

    let q = ctx.supabase
      .from("workouts")
      .select("date, type, notes, payload")
      .gte("date", since)
      .order("date", { ascending: true });
    const generic = /^(workouts?|training|sessions?|all)$/i.test(metric.trim());
    if (!generic) q = q.or(`type.ilike.%${metric}%,notes.ilike.%${metric}%`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return {
      data: { metric, since, entries: data },
      summary: `get_history(${metric}, since ${since}) → ${data.length}`,
    };
  },
};

// ── compute_energy_targets ──────────────────────────────────────────────────
const computeSchema = z.object({
  goal: z.string().min(1),
  weight_kg: z.number().positive().optional(),
  height_cm: z.number().positive().optional(),
  age: z.number().positive().optional(),
  sex: z.enum(["male", "female"]).optional(),
  activity_level: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).optional(),
  target_calories: z.number().positive().optional(),
});

const computeEnergyTargetsTool: AgentTool = {
  name: "compute_energy_targets",
  description:
    "Compute evidence-based calorie and macro targets for a goal (Mifflin–St Jeor + activity). Uses the user's profile for any missing biometrics. Enforces safety floors and flags unsafe requests.",
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string", description: "e.g. 'lean-bulk', 'cut', 'maintain'" },
      weight_kg: { type: "number" },
      height_cm: { type: "number" },
      age: { type: "number" },
      sex: { type: "string", enum: ["male", "female"] },
      activity_level: {
        type: "string",
        enum: ["sedentary", "light", "moderate", "active", "very_active"],
      },
      target_calories: {
        type: "number",
        description: "Optional explicit calorie target the user asked for (will be safety-checked)",
      },
    },
    required: ["goal"],
  },
  schema: computeSchema,
  async execute(args, ctx) {
    const a = computeSchema.parse(args);

    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("weight_kg, height_cm, age, sex, activity_level")
      .eq("id", ctx.userId)
      .maybeSingle();

    const weightKg = a.weight_kg ?? profile?.weight_kg ?? undefined;
    const heightCm = a.height_cm ?? profile?.height_cm ?? undefined;
    const age = a.age ?? profile?.age ?? undefined;
    const sex = (a.sex ?? profile?.sex) as Sex | undefined;
    const activityLevel = (a.activity_level ?? profile?.activity_level) as
      ActivityLevel | undefined;

    const missing: string[] = [];
    if (weightKg == null) missing.push("weight_kg");
    if (heightCm == null) missing.push("height_cm");
    if (age == null) missing.push("age");
    if (sex == null) missing.push("sex");
    if (activityLevel == null) missing.push("activity_level");

    if (missing.length > 0) {
      return {
        data: {
          needs: missing,
          message: `Need the following to compute targets: ${missing.join(", ")}. Ask the user or update their profile.`,
        },
        summary: `compute_energy_targets → needs ${missing.join(",")}`,
      };
    }

    const targets = computeEnergyTargets({
      weightKg: weightKg as number,
      heightCm: heightCm as number,
      age: age as number,
      sex: sex as Sex,
      activityLevel: activityLevel as ActivityLevel,
      goal: a.goal,
      targetCalories: a.target_calories,
    });

    return {
      data: { ...targets },
      summary: `compute_energy_targets(${a.goal}) → ${targets.targetCalories} kcal${targets.safe ? "" : " (clamped, unsafe request)"}`,
    };
  },
};

export const AGENT_TOOLS: AgentTool[] = [
  searchKnowledge,
  logWorkout,
  logNutrition,
  getHistory,
  computeEnergyTargetsTool,
];
