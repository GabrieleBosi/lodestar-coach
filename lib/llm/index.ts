/**
 * Lazily-instantiated singleton LLM provider.
 *
 * Import `getLLMProvider()` anywhere in the app; the concrete provider is
 * constructed on first use (so importing this module never requires env vars
 * at build time) and reused afterwards.
 */
import { GeminiProvider, readGeminiConfig } from "./gemini";
import type { LLMProvider } from "./types";

let provider: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (!provider) {
    provider = new GeminiProvider(readGeminiConfig());
  }
  return provider;
}

export type { GenerateOptions, LLMProvider } from "./types";
