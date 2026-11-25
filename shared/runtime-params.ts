// Run-time parameter records of the person (assets/manikin/params/runtime*.toml): the same record shape as the rig's
// parameters (value, unit, range, class, basis, tier, evidence), read by the viewer instead of the generator. Units
// are NOT converted: the unit names how the code reads the number (degrees stay degrees, seconds stay seconds).
//
//   validateRuntime(doc, name)   every problem with the records, as messages (an empty list: all records are complete)
//   stripRuntime(doc)            the same tree with each record replaced by its value (what the browser bundle carries)
//
// Used by tools/bundle.ts (the bundle refuses a file with a bad record), by tools/check.ts, and by viewer/src/person/
// params.ts (which strips the full records itself when it runs under `bun test`).
export const RUNTIME_CLASSES = ["measured", "vendor", "photo", "assumed", "invented"] as const;
export const RUNTIME_TIERS = ["critical", "layout", "cosmetic"] as const;
export const RUNTIME_BASES = ["user", "by_eye", "cross_instance", "symmetry", "convention", "standard_default", "literature", "look_dev"] as const;
export const RUNTIME_UNITS = ["m", "mm", "deg", "rad", "s", "ms", "hz", "per_min", "deg_per_s", "m_per_s", "per_s", "1", "ratio", "count", "px", "texel", "linear_rgb", "kg", "frames_per_s"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && "value" in (v as object);
const isNumeric = (v: unknown): boolean => (typeof v === "number" ? Number.isFinite(v) : Array.isArray(v) && v.length > 0 && v.every(isNumeric));

export function validateRuntime(doc: unknown, name: string): string[] {
  const errors: string[] = [];
  const walk = (node: any, prefix: string) => {
    for (const [k, v] of Object.entries(node ?? {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v === null || typeof v !== "object" || Array.isArray(v)) { errors.push(`${name}: '${key}' is a bare value; write it as a record { value, unit, range, class, tier, evidence }`); continue; }
      if (!isRecord(v)) { walk(v, key); continue; }
      const t = v as Record<string, any>;
      const miss = ["value", "unit", "range", "class", "tier", "evidence"].filter((f) => t[f] === undefined || t[f] === "");
      if (miss.length) { errors.push(`${name}: [${key}] missing ${miss.join(", ")}`); continue; }
      if (!isNumeric(t.value)) errors.push(`${name}: [${key}] value must be a finite number or a (nested) list of numbers`);
      if (!(RUNTIME_UNITS as readonly string[]).includes(String(t.unit))) errors.push(`${name}: [${key}] unknown unit '${t.unit}' (use ${RUNTIME_UNITS.join(", ")})`);
      if (!(RUNTIME_CLASSES as readonly string[]).includes(t.class)) errors.push(`${name}: [${key}] class '${t.class}' is not one of ${RUNTIME_CLASSES.join(" | ")}`);
      if (!(RUNTIME_TIERS as readonly string[]).includes(t.tier)) errors.push(`${name}: [${key}] tier '${t.tier}' is not one of ${RUNTIME_TIERS.join(" | ")}`);
      if (!(typeof t.range === "number" && t.range >= 0)) errors.push(`${name}: [${key}] range must be a non-negative number`);
      if (t.class === "assumed" && t.basis === undefined) errors.push(`${name}: [${key}] class "assumed" needs a basis`);
      if (t.basis !== undefined && !(RUNTIME_BASES as readonly string[]).includes(t.basis)) errors.push(`${name}: [${key}] basis '${t.basis}' is not one of ${RUNTIME_BASES.join(" | ")}`);
      const unknown = Object.keys(t).filter((f) => !["value", "unit", "range", "class", "basis", "tier", "evidence"].includes(f));
      if (unknown.length) errors.push(`${name}: [${key}] unknown field(s) ${unknown.join(", ")}`);
    }
  };
  walk(doc, "");
  return errors;
}

/** Each record replaced by its value; anything already stripped passes through. */
export function stripRuntime(node: any): any {
  if (isRecord(node)) return node.value;
  if (node && typeof node === "object" && !Array.isArray(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, stripRuntime(v)]));
  return node;
}

/** Number of records in a tree (for reports). */
export function countRuntime(node: any): number {
  if (isRecord(node)) return 1;
  return node && typeof node === "object" && !Array.isArray(node) ? Object.values(node).reduce((n: number, v) => n + countRuntime(v), 0) : 0;
}
