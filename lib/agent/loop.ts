/**
 * Agentic orchestration loop over Gemini function calling.
 *
 * The model picks tools; we validate + execute them (each writes a `traces`
 * row), feed results back, and iterate up to MAX_STEPS. When the model stops
 * requesting tools, its text is the grounded final answer. Tool errors are fed
 * back to the model rather than thrown, so it can recover or explain.
 */
import { type Content, type FunctionCall, GoogleGenAI } from "@google/genai";

import type { Json } from "../db/types";
import { estimateTokens } from "../llm/cost";
import { readGeminiConfig } from "../llm/gemini";
import type { Citation } from "../rag/prompt";
import { AGENT_TOOLS, type ToolContext } from "./tools";

const MAX_STEPS = 6;

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

export async function runAgent(params: {
  ctx: ToolContext;
  system: string;
  history: Content[];
  userMessage: string;
}): Promise<AgentResult> {
  const { ctx, system, history, userMessage } = params;
  const cfg = readGeminiConfig();
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });

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

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await ai.models.generateContent({
      model: cfg.chatModel,
      contents,
      config: { systemInstruction: system, tools, temperature: 0.3 },
    });

    const calls = resp.functionCalls ?? [];
    if (calls.length === 0) {
      finalText = resp.text ?? "";
      break;
    }

    const modelContent = resp.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    const responseParts = [];
    for (const call of calls) {
      const { action, response } = await runTool(call, ctx);
      actions.push(action);
      responseParts.push({ functionResponse: { name: call.name ?? "unknown", response } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  if (!finalText) {
    // Ran out of steps — force a final answer without tools.
    const resp = await ai.models.generateContent({
      model: cfg.chatModel,
      contents,
      config: { systemInstruction: system, temperature: 0.3 },
    });
    finalText = resp.text ?? "I wasn't able to complete that in the available steps.";
  }

  return {
    finalText,
    actions,
    citations: ctx.citations,
    tokensIn: estimateTokens(system + userMessage + JSON.stringify(actions)),
    tokensOut: estimateTokens(finalText),
  };
}
