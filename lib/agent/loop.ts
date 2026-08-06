/**
 * Agentic orchestration loop over Gemini function calling.
 *
 * The model picks tools; we validate + execute them (each writes a `traces`
 * row), feed results back, and iterate up to MAX_STEPS. Every model call is
 * traced (real token usage, latency, cost) and wrapped with a timeout + one
 * retry; if the model stays unavailable, the agent degrades to a graceful
 * message instead of throwing, so the user always gets a response.
 */
import { type Content, type FunctionCall, GoogleGenAI, type Part } from "@google/genai";

import type { Json } from "../db/types";
import { estimateCostUsd, estimateTokens } from "../llm/cost";
import { geminiClientOptions, readGeminiConfig } from "../llm/gemini";
import type { Citation } from "../rag/prompt";
import { AGENT_TOOLS, type ToolContext } from "./tools";

const MAX_STEPS = 6;
// Must stay well under the hosting request budget (~30s) so our own timeout and
// degradation actually fire instead of the platform killing the whole function.
const MODEL_TIMEOUT_MS = 12_000;
// Overall budget for the agent; once exceeded we stop calling tools and answer.
const TURN_BUDGET_MS = 22_000;
// Bounded answers keep generation time (and cost) predictable. Must stay well
// above the ~430-500 internal "thinking" tokens Gemini 3.x charges against this
// budget, or the visible answer is truncated (finishReason=MAX_TOKENS).
const MAX_OUTPUT_TOKENS = 2000;

// Note: `thinkingConfig` was measured to make no difference on gemini-3.5-flash
// and is rejected outright (400) by the -lite variants, so it is not sent.
const THINKING_OFF = {} as const;

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
  /** True when the caller's sink already forwarded exactly `finalText`. */
  alreadyStreamed: boolean;
  actions: AgentAction[];
  citations: Citation[];
  tokensIn: number;
  tokensOut: number;
  degraded: boolean;
  degradedError?: string;
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

/**
 * Where a step's tokens go while it is still being generated.
 *
 * A step is only known to be the final answer once its stream ends without a
 * function call, so tokens are forwarded optimistically and retracted if the
 * step turns out to call a tool. That text is discarded either way — the loop
 * only ever keeps the text of the step that stops calling tools — so a retract
 * costs nothing but a repaint.
 */
export interface StreamSink {
  onToken: (text: string) => void;
  /** Discard everything forwarded for this turn so far. */
  onReset: () => void;
}

async function callModel(
  ai: GoogleGenAI,
  model: string,
  contents: Content[],
  config: Record<string, unknown>,
  ctx: ToolContext,
  sink?: StreamSink,
): Promise<ModelCall> {
  const started = Date.now();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let forwarded = false;
    try {
      // The whole step is raced against the timeout, exactly as the unary call
      // was: streaming doesn't make a hung model any less hung.
      const consume = (async () => {
        const stream = await ai.models.generateContentStream({ model, contents, config });
        const calls: FunctionCall[] = [];
        // Parts are kept exactly as received. Rebuilding them from accumulated
        // text and calls drops `thoughtSignature` off functionCall parts, and
        // Gemini 3.x rejects the follow-up turn with
        // "Function call is missing a thought_signature in functionCall parts".
        const parts: Part[] = [];
        let text = "";
        let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

        for await (const chunk of stream) {
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            parts.push(part);
            if (part.functionCall) calls.push(part.functionCall);
            // Thinking parts are not answer text and must never be forwarded.
            if (part.thought || !part.text) continue;
            text += part.text;
            // Stop forwarding the moment this step reveals itself as a tool step.
            if (sink && calls.length === 0) {
              sink.onToken(part.text);
              forwarded = true;
            }
          }
          if (chunk.usageMetadata) usage = chunk.usageMetadata;
        }
        return { calls, parts, text, usage };
      })();

      const { calls, parts, text, usage } = await withTimeout(consume, MODEL_TIMEOUT_MS);

      if (calls.length > 0 && forwarded) sink?.onReset();

      const tokensIn = usage?.promptTokenCount ?? estimateTokens(JSON.stringify(contents));
      const tokensOut = usage?.candidatesTokenCount ?? estimateTokens(text);
      await ctx.supabase.from("traces").insert({
        request_id: ctx.requestId,
        user_id: ctx.userId,
        stage: "llm.chat",
        tokens: tokensIn + tokensOut,
        latency_ms: Date.now() - started,
        cost_usd: estimateCostUsd(tokensIn, tokensOut),
        payload: {
          model,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          attempt,
          streamed: forwarded,
        } as unknown as Json,
      });
      return {
        functionCalls: calls,
        text,
        content: parts.length ? { role: "model", parts } : undefined,
        tokensIn,
        tokensOut,
      };
    } catch (err) {
      lastErr = err;
      // A retry regenerates from scratch, so anything already on screen from
      // the failed attempt has to go.
      if (forwarded) sink?.onReset();
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
  /** When supplied, answer tokens are forwarded as they are generated. */
  sink?: StreamSink;
}): Promise<AgentResult> {
  const { ctx, system, history, userMessage } = params;
  const cfg = readGeminiConfig();
  const ai = new GoogleGenAI(geminiClientOptions(cfg));

  // A capability the caller can't use is withheld, not refused: exposing
  // update_profile to the read-only demo user produced a refusal the model then
  // retried on later, unrelated turns. Absent tools can't be retried.
  const available = AGENT_TOOLS.filter(
    (t) => !(ctx.profileReadOnly && t.name === "update_profile"),
  );
  const tools = [
    {
      functionDeclarations: available.map((t) => ({
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
  let degradedError: string | undefined;
  let tokensIn = 0;
  let tokensOut = 0;

  // Mirror of what the client currently has, so the caller can be told whether
  // the answer still needs sending.
  let forwarded = "";
  const sink: StreamSink | undefined = params.sink && {
    onToken: (t) => {
      forwarded += t;
      params.sink?.onToken(t);
    },
    onReset: () => {
      forwarded = "";
      params.sink?.onReset();
    },
  };

  const turnStarted = Date.now();
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // Out of budget: stop offering tools so the next call must answer.
      const outOfBudget = Date.now() - turnStarted > TURN_BUDGET_MS;
      const result = await callModel(
        ai,
        cfg.chatModel,
        contents,
        {
          systemInstruction: system,
          temperature: 0.3,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...(outOfBudget ? {} : { tools }),
          ...THINKING_OFF,
        },
        ctx,
        sink,
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
        {
          systemInstruction: system,
          temperature: 0.3,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...THINKING_OFF,
        },
        ctx,
        sink,
      );
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;
      finalText = result.text || DEGRADED_MESSAGE;
    }
  } catch (err) {
    // Model stayed unavailable — degrade gracefully rather than error out.
    degraded = true;
    degradedError = err instanceof Error ? err.message : String(err);
    finalText = DEGRADED_MESSAGE;
  }

  // The client has the answer already only if what it holds is exactly the
  // answer. A degraded message, an empty generation, or a retracted step all
  // land here with a mismatch, and the caller sends the text itself.
  let alreadyStreamed = false;
  if (sink) {
    if (finalText && forwarded === finalText) alreadyStreamed = true;
    else if (forwarded) sink.onReset();
  }

  return {
    finalText,
    alreadyStreamed,
    actions,
    citations: ctx.citations,
    tokensIn,
    tokensOut,
    degraded,
    degradedError,
  };
}
