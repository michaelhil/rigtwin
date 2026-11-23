// Appends one JSON line per meaningful step to work/timeline.jsonl (see the build brief, section 8).
// The agent name comes from the environment variable RIGTWIN_AGENT.
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function timeline(event: string, seconds: number | null, note = ""): void {
  try {
    const dir = join(ROOT, "work");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = { ts: new Date().toISOString(), agent: process.env.RIGTWIN_AGENT ?? "unnamed", event, seconds: seconds === null ? null : Math.round(seconds * 1000) / 1000, note };
    appendFileSync(join(dir, "timeline.jsonl"), JSON.stringify(line) + "\n");
  } catch { /* the timeline must never break a build */ }
}
