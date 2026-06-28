/**
 * Gemini implementation of `LLMProvider`, built on the Google Gen AI SDK
 * ("@google/genai").
 *
 * Verify model IDs against current Gemini docs — the 2.5 series is deprecating
 * ~June 2026; 3.x flash/pro are current. Model IDs and embedding dimensions are
 * read from the environment so they can change without a code release.
 */
import { GoogleGenAI } from "@google/genai";

import type { GenerateOptions, LLMProvider } from "./types";

/** Defaults applied when the corresponding env var is unset. */
export const DEFAULTS = {
  chatModel: "gemini-3.5-flash",
  embedModel: "gemini-embedding-2",
  embedDim: 1536,
} as const;

export interface GeminiConfig {
  apiKey: string;
  chatModel: string;
  embedModel: string;
  embedDim: number;
}

/** Read Gemini configuration from the environment. Throws if no API key. */
export function readGeminiConfig(): GeminiConfig {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const embedDim = Number(process.env.EMBED_DIM ?? DEFAULTS.embedDim);

  return {
    apiKey,
    chatModel: process.env.GEMINI_CHAT_MODEL ?? DEFAULTS.chatModel,
    embedModel: process.env.GEMINI_EMBED_MODEL ?? DEFAULTS.embedModel,
    embedDim: Number.isFinite(embedDim) ? embedDim : DEFAULTS.embedDim,
  };
}

export class GeminiProvider implements LLMProvider {
  private readonly client: GoogleGenAI;
  private readonly config: GeminiConfig;

  constructor(config: GeminiConfig) {
    this.config = config;
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.config.chatModel,
      contents: prompt,
      config: {
        systemInstruction: opts.system,
        temperature: opts.temperature,
        maxOutputTokens: opts.maxOutputTokens,
      },
    });
    return response.text ?? "";
  }

  async *generateStream(prompt: string, opts: GenerateOptions = {}): AsyncIterable<string> {
    const stream = await this.client.models.generateContentStream({
      model: this.config.chatModel,
      contents: prompt,
      config: {
        systemInstruction: opts.system,
        temperature: opts.temperature,
        maxOutputTokens: opts.maxOutputTokens,
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        yield text;
      }
    }
  }

  async embed(texts: string[], opts: { dimensions?: number } = {}): Promise<number[][]> {
    const response = await this.client.models.embedContent({
      model: this.config.embedModel,
      contents: texts,
      config: { outputDimensionality: opts.dimensions ?? this.config.embedDim },
    });

    return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
  }
}
