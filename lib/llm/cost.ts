/**
 * Lightweight token/cost estimation for logging.
 *
 * Token counts use a ~4-chars/token heuristic (the provider abstraction doesn't
 * surface exact usage), and prices are approximate — verify against current
 * Gemini pricing. These feed the messages table's tokens/cost columns for
 * observability, not billing.
 */
const CHARS_PER_TOKEN = 4;

// Approximate gemini-3.5-flash pricing, USD per 1M tokens.
const USD_PER_M_INPUT = 0.3;
const USD_PER_M_OUTPUT = 2.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * USD_PER_M_INPUT + (tokensOut / 1_000_000) * USD_PER_M_OUTPUT;
}
