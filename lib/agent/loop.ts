/**
 * Agentic orchestration loop over Gemini function calling.
 *
 * The model picks tools; we validate + execute them (each writes a `traces`
 * row), feed results back, and iterate up to MAX_STEPS. Every model call is
 * traced (real token usage, latency, cost) and wrapped with a timeout + one
 * retry; if the model stays unavailable, the agent degrades to a graceful
 * message instead of throwing, so the user always gets a response.
 */
import { type Content, type FunctionCall, GoogleGenAI } from "@google/genai";

import type { Json } from "../db/types";
import { estimateCostUsd, estimateTokens } from "../llm/cost";
import { geminiClientOptions, readGeminiConfig } from "../llm/gemini";
import type { Citation } from "../rag/prompt";
import { AGENT_TOOLS, type ToolContext } from "./tools";

const MAX_STEPS = 6;
const MODEL_TIMEOUT_MS = 45_000;

const DEGRADED_MESSAGE =
  "I'm having trouble reaching the model right now — this can happen under high load or free-tier rate limits. Please try again in a moment. (This is general information, not medical advice.)";

export interface AgentAction {
  name: string;
  args: unknown;
  ok: boolean;
  summary?: string;
  error?: string;
}

export interface AgentResult {
  finalText: string;
  actions: AgentAction[];
  citations: Citation[];
  tokensIn: number;
  tokensOut: number;
  degraded: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransient(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err);
  return /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|timeout|ETIMEDOUT|ECONNRESET/i.test(s);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("model timeout")), ms)),
  ]);
}

/** functionResponse.response must be a JSON object; wrap non-objects. */
function asResponseObject(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { value: data };
}

async function runTool(
  call: FunctionCall,
  ctx: ToolContext,
): Promise<{ action: AgentAction; response: Record<string, unknown> }> {
  const name = call.name ?? "unknown";
  const args = call.args ?? {};
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  const started = Date.now();

  if (!tool) {
    return {
      action: { name, args, ok: false, error: "unknown tool" },
      response: { error: `Unknown tool: ${name}` },
    };
  }

  try {
    const result = await tool.execute(args, ctx);
    await ctx.supabase.from("traces").insert({
      request_id: ctx.requestId,
      user_id: ctx.userId,
      stage: name,
      payload: { args, summary: result.summary } as unknown as Json,
      latency_ms: Date.now() - started,
    });
    return {
      action: { name, args, ok: true, summary: result.summary },
      response: asResponseObject(result.data),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.supabase.from("traces").insert({
      request_id: ctx.requestId,
      user_id: ctx.userId,
      stage: name,
      payload: { args, error: message } as unknown as Json,
      latency_ms: Date.now() - started,
    });
    return {
      action: { name, args, ok: false, error: message },
      response: { error: message },
    };
  }
}

interface ModelCall {
  functionCalls: FunctionCall[];
  text: string;
  content: Content | undefined;
  tokensIn: number;
  tokensOut: number;
}

async function callModel(
  ai: GoogleGenAI,
  model: string,
  contents: Content[],
  config: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ModelCall> {
  const started = Date.now();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await withTimeout(
        ai.models.generateContent({ model, contents, config }),
        MODEL_TIMEOUT_MS,
      );
      const usage = resp.usageMetadata;
      const tokensIn = usage?.promptTokenCount ?? estimateTokens(JSON.stringify(contents));
      const tokensOut = usage?.candidatesTokenCount ?? estimateTokens(resp.text ?? "");
      await ctx.supabase.from("traces").insert({
        request_id: ctx.requestId,
        user_id: ctx.userId,
        stage: "llm.chat",
        tokens: tokensIn + tokensOut,
        latency_ms: Date.now() - started,
        cost_usd: estimateCostUsd(tokensIn, tokensOut),
        payload: { model, tokens_in: tokensIn, tokens_out: tokensOut, attempt } as unknown as Json,
      });
      return {
        functionCalls: resp.functionCalls ?? [],
        text: resp.text ?? "",
        content: resp.candidates?.[0]?.content,
        tokensIn,
        tokensOut,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < 2 && isTransient(err)) {
        await sleep(1500);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

export async function runAgent(params: {
  ctx: ToolContext;
  system: string;
  history: Content[];
  userMessage: string;
}): Promise<AgentResult> {
  const { ctx, system, history, userMessage } = params;
  const cfg = readGeminiConfig();
  const ai = new GoogleGenAI(geminiClientOptions(cfg));

  const tools = [
    {
      functionDeclarations: AGENT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.parameters,
      })),
    },
  ];

  const contents: Content[] = [...history, { role: "user", parts: [{ text: userMessage }] }];
  const actions: AgentAction[] = [];
  let finalText = "";
  let degraded = false;
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const result = await callModel(
        ai,
        cfg.chatModel,
        contents,
        { systemInstruction: system, tools, temperature: 0.3 },
        ctx,
      );
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;

      if (result.functionCalls.length === 0) {
        finalText = result.text;
        break;
      }

      if (result.content) contents.push(result.content);

      const responseParts = [];
      for (const call of result.functionCalls) {
        const { action, response } = await runTool(call, ctx);
        actions.push(action);
        responseParts.push({ functionResponse: { name: call.name ?? "unknown", response } });
      }
      contents.push({ role: "user", parts: responseParts });
    }

    if (!finalText) {
      const result = await callModel(
        ai,
        cfg.chatModel,
        contents,
        { systemInstruction: system, temperature: 0.3 },
        ctx,
      );
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;
      finalText = result.text || DEGRADED_MESSAGE;
    }
  } catch {
    // Model stayed unavailable — degrade gracefully rather than error out.
    degraded = true;
    finalText = DEGRADED_MESSAGE;
  }

  return { finalText, actions, citations: ctx.citations, tokensIn, tokensOut, degraded };
}
