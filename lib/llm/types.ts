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

/**
 * Embedding task type — lets the model optimise vectors for their use.
 * Use RETRIEVAL_DOCUMENT when embedding stored content and RETRIEVAL_QUERY
 * when embedding a search query.
 */
export type EmbedTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION"
  | "CODE_RETRIEVAL_QUERY";

export interface EmbedOptions {
  /** Output dimensionality (must match the target vector column). */
  dimensions?: number;
  /** Optimises the embedding for a particular downstream task. */
  taskType?: EmbedTaskType;
}

export interface LLMProvider {
  /** Single-shot text generation. */
  generate(prompt: string, opts?: GenerateOptions): Promise<string>;
  /** Streaming generation; yields text chunks as they arrive. */
  generateStream(prompt: string, opts?: GenerateOptions): AsyncIterable<string>;
  /** Embed one or more texts into vectors. */
  embed(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
}
