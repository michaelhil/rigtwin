// Identifiers and display names shared by the scene store and the internal station harness.
import { LIMITS } from "./limits.ts";

export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isWorkspaceId = (s: unknown): s is string => typeof s === "string" && s.length === 36 && ID_PATTERN.test(s);
export const isId = isWorkspaceId;

export class NameError extends Error {}
/** Controls (Cc), line and paragraph separators, and the invisible direction marks that could make a name read differently from what it is. */
const INVISIBLE = [0x2028, 0x2029, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => String.fromCodePoint(c)).join("");
const STRIP = new RegExp(`[\\p{Cc}${INVISIBLE}]`, "gu");
/** A name as stored: control characters removed, trimmed, 1 to LIMITS.workspaceNameChars characters (counted as characters, not bytes).
 *  Missing or empty gives `fallback` when one is given, otherwise an error. */
export function cleanName(v: unknown, fallback?: string): string {
  if (v === undefined || v === null) { if (fallback !== undefined) return fallback; throw new NameError("a name is needed"); }
  if (typeof v !== "string") throw new NameError("a name is text");
  const name = v.replace(STRIP, "").trim();
  if (!name) { if (fallback !== undefined) return fallback; throw new NameError("a name needs at least one character"); }
  if (Array.from(name).length > LIMITS.workspaceNameChars) throw new NameError(`a name is at most ${LIMITS.workspaceNameChars} characters`);
  return name;
}

