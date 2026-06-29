/**
 * Tiny .env loader for CLI scripts (no dependency). Loads .env.local then .env,
 * without overwriting variables already present in the environment.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

let loaded = false;

export async function loadEnv(): Promise<void> {
  if (loaded) return;
  loaded = true;

  for (const name of [".env.local", ".env"]) {
    let text: string;
    try {
      text = await fs.readFile(path.resolve(process.cwd(), name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || !m[1]) continue;
      const key = m[1];
      const value = (m[2] ?? "").replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
