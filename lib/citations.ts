/**
 * Citation markers in answer text.
 *
 * Lives outside the renderer so the eval harness and the CI checks can assert
 * on markers without importing a `"use client"` React component (and with it
 * react-markdown) into a Node script.
 */

/**
 * A citation marker. The model groups references — `[1, 3]` is as common as
 * `[1][3]` — so the group is captured whole and split, rather than assuming one
 * number per bracket. Matching only `[n]` silently drops every grouped source.
 */
export const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

export function numbersIn(group: string): number[] {
  return group
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}

/** The citation numbers the answer text actually references. */
export function citedNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(MARKER)) for (const n of numbersIn(m[1] ?? "")) out.add(n);
  return out;
}
