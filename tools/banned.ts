// The names that must never appear in the repository or leave it (CLAUDE.md): the rig maker's and the customer's,
// stored encoded so that this file does not contain them, plus one per line in private/banned-words.txt when that
// file is on this machine. Used by `bun run check` (every file) and by `bun run rig` (a group name sent to a
// remote server).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dec = (s: string) => Buffer.from(s, "base64").toString("utf8");
/** never, in any spelling */
export const NEVER = ["aGl2ZQ==", "ZmVpcmluZw=="].map(dec);
/** device makers: only in parameter evidence */
export const VENDORS = ["ZmFuYXRlYw==", "c2Ftc3VuZw==", "bG9naXRlY2g=", "ZWxv"].map(dec);
/** a word that contains a NEVER word harmlessly */
export const ALLOWED = dec("YXJjaGl2ZQ==");
export function extraWords(root: string): string[] {
  const f = join(root, "private", "banned-words.txt");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")) : [];
}
/** the banned words found in a text (lower-cased; the allowed word removed first) */
export function bannedIn(text: string, root: string): string[] {
  const low = text.toLowerCase().split(ALLOWED).join("");
  return [...NEVER, ...extraWords(root), ...VENDORS].filter((w) => (VENDORS.includes(w) ? new RegExp(`\\b${w}\\b`).test(low.replaceAll("-", " ")) : low.includes(w)));
}
