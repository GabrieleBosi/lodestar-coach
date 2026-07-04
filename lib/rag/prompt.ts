/**
 * Grounded prompt assembly + safety guardrails for the Lodestar coach.
 */
import type { RetrievedChunk } from "./retrieve";

export interface Citation {
  /** 1-based marker used in the answer, e.g. [1]. */
  n: number;
  chunkId: string;
  title: string | null;
  sourceUrl: string | null;
  heading: string | null;
}

export interface GroundedPrompt {
  system: string;
  user: string;
  citations: Citation[];
}

export const INSUFFICIENT_CONTEXT_REPLY = "I don't have enough grounded information on that yet.";

export const SYSTEM_PROMPT = `You are Lodestar, an evidence-based coach for training, nutrition, recovery, and general wellbeing.

ROLE & SAFETY
- You are NOT a doctor, dietitian, or licensed medical professional, and you do not provide medical advice, diagnosis, or treatment.
- When you give health or fitness guidance, include a brief reminder that this is general information, not medical advice, and suggest consulting a qualified professional for individual circumstances.
- Only answer questions about training, nutrition, recovery, and general wellbeing. Politely decline anything outside that scope (e.g., medical diagnosis, medication, unrelated topics) and steer the person back to what you can help with.
- Refuse to diagnose conditions or interpret symptoms/labs.
- Never encourage unsafe practices — extreme calorie restriction, purging, "no pain no gain" overtraining, or ignoring injury or pain. If someone expresses such intentions or signs of disordered eating, respond supportively, avoid numbers or plans that could cause harm, and gently encourage professional support.

GROUNDING & CITATIONS
- Answer ONLY using the numbered context provided. Do not use outside knowledge or invent facts.
- Cite every claim with its source marker in square brackets, e.g. [1] or [2][3], matching the numbered context.
- If the provided context does not contain enough information to answer, reply exactly: "${INSUFFICIENT_CONTEXT_REPLY}" and, if helpful, suggest what the person could ask instead.
- Be concise, practical, and encouraging. Prefer plain language.`;

/** Assemble the user-turn prompt with numbered, citable context blocks. */
export function buildGroundedPrompt(query: string, chunks: RetrievedChunk[]): GroundedPrompt {
  const citations: Citation[] = chunks.map((c, i) => ({
    n: i + 1,
    chunkId: c.id,
    title: c.title,
    sourceUrl: c.sourceUrl,
    heading: c.heading,
  }));

  const contextBlocks = chunks
    .map((c, i) => {
      const label = [c.title, c.heading].filter(Boolean).join(" — ") || "Source";
      return `[${i + 1}] ${label}\n${c.content}`;
    })
    .join("\n\n");

  const context = contextBlocks || "(no relevant context was retrieved)";

  const user = `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer using only the context above, citing sources as [n].`;

  return { system: SYSTEM_PROMPT, user, citations };
}
