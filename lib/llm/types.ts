/**
 * Provider-agnostic LLM abstraction.
 *
 * Everything in the app depends on `LLMProvider`, never on a concrete vendor
 * SDK, so the underlying model can be swapped (Gemini today, anything later)
 * without touching call sites.
 */

export interface GenerateOptions {
  /** System / developer instruction that steers the model. */
  system?: string;
  /** Sampling temperature (0 = deterministic). */
  temperature?: number;
  /** Hard cap on generated tokens. */
  maxOutputTokens?: number;
}

export interface LLMProvider {
  /** Single-shot text generation. */
  generate(prompt: string, opts?: GenerateOptions): Promise<string>;
  /** Streaming generation; yields text chunks as they arrive. */
  generateStream(prompt: string, opts?: GenerateOptions): AsyncIterable<string>;
  /** Embed one or more texts into vectors. */
  embed(texts: string[], opts?: { dimensions?: number }): Promise<number[][]>;
}
