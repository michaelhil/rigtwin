// Parameter loader. One record per independent number:
//   [seat.back_top_height]
//   value = 1.40 ; unit = "m" ; range = 0.03 ; class = "measured" ; basis = "user" ; tier = "critical" ; evidence = "..."
// Files are read in the order devices.toml, <group>.toml ..., measured.toml; a later file replaces a
// record of the same key. Units are converted once, here: everything downstream is metres and radians.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const CLASSES = ["measured", "vendor", "photo", "assumed", "invented"] as const;
export const TIERS = ["critical", "layout", "cosmetic"] as const;
export const BASES = ["user", "by_eye", "cross_instance", "symmetry", "convention", "standard_default"] as const;
import type { ParamClass, ParamValue, ParamRecord } from "../shared/manifest.ts";
export type { ParamClass, ParamValue, ParamRecord };

const UNITS: Record<string, { si: string; k: number }> = {
  m: { si: "m", k: 1 }, mm: { si: "m", k: 0.001 }, cm: { si: "m", k: 0.01 }, in: { si: "m", k: 0.0254 },
  rad: { si: "rad", k: 1 }, deg: { si: "rad", k: Math.PI / 180 },
  "1": { si: "1", k: 1 }, ratio: { si: "1", k: 1 }, count: { si: "1", k: 1 },
  K: { si: "K", k: 1 },
};

const isNumeric = (v: unknown): v is ParamValue => typeof v === "number" ? Number.isFinite(v) : Array.isArray(v) && v.length > 0 && v.every(isNumeric);
const convert = (v: ParamValue, k: number): ParamValue => (typeof v === "number" ? v * k : v.map((x) => convert(x, k)));

export class ParamTable {
  records = new Map<string, ParamRecord>();
  warnings: string[] = [];
  /** reader id -> keys read */
  usage = new Map<string, Set<string>>();

  get(key: string, reader?: string): ParamRecord {
    const r = this.records.get(key);
    if (!r) {
      const lev = (a: string, b: string) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
      const near = [...this.records.keys()].map((k) => [lev(k, key), k] as const).sort((x, y) => x[0] - y[0]).slice(0, 4).map((x) => x[1]);
      throw new Error(`unknown parameter '${key}'${reader ? ` (asked for by ${reader})` : ""}. Closest: ${near.join(", ")}`);
    }
    if (reader) { if (!this.usage.has(reader)) this.usage.set(reader, new Set()); this.usage.get(reader)!.add(key); }
    return r;
  }
  num(key: string, reader?: string): number {
    const r = this.get(key, reader);
    if (typeof r.value !== "number") throw new Error(`parameter '${key}' is a list; use arr('${key}')`);
    return r.value;
  }
  arr(key: string, reader?: string): any {
    const r = this.get(key, reader);
    if (typeof r.value === "number") throw new Error(`parameter '${key}' is a single number; use p('${key}')`);
    return r.value;
  }
  has(key: string) { return this.records.has(key); }

  classCounts(keys?: Iterable<string>): Record<string, number> {
    const c: Record<string, number> = {};
    for (const k of keys ?? this.records.keys()) { const r = this.records.get(k)!; c[r.class] = (c[r.class] ?? 0) + 1; }
    return Object.fromEntries(CLASSES.filter((k) => c[k]).map((k) => [k, c[k]]));
  }
  /** The least certain class among the given keys (cosmetic-tier records only count if nothing else is there). */
  weakestClass(keys: Iterable<string>): ParamClass | null {
    const recs = [...keys].map((k) => this.records.get(k)!);
    const pool = recs.some((r) => r.tier !== "cosmetic") ? recs.filter((r) => r.tier !== "cosmetic") : recs;
    let worst = -1;
    for (const r of pool) worst = Math.max(worst, CLASSES.indexOf(r.class));
    return worst < 0 ? null : CLASSES[worst];
  }
}

function readFile(table: ParamTable, path: string, name: string, errors: string[]) {
  let doc: any;
  try { doc = Bun.TOML.parse(readFileSync(path, "utf8")); }
  catch (e: any) { errors.push(`${name}: TOML syntax error: ${e.message}`); return; }
  const walk = (node: any, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v === null || typeof v !== "object" || Array.isArray(v)) { errors.push(`${name}: '${key}' is a bare value; write it as a record [${key}] with value, unit, class, tier, evidence`); continue; }
      const t = v as Record<string, any>;
      const subTables = Object.entries(t).filter(([, x]) => x && typeof x === "object" && !Array.isArray(x));
      const fields = Object.entries(t).filter(([, x]) => !(x && typeof x === "object" && !Array.isArray(x)));
      if (fields.length === 0) { walk(t, key); continue; }
      if (subTables.length) errors.push(`${name}: [${key}] mixes record fields with sub-tables (${subTables.map(([n]) => n).join(", ")})`);
      const miss = ["value", "unit", "class", "tier", "evidence"].filter((f) => t[f] === undefined || t[f] === "");
      if (miss.length) { errors.push(`${name}: [${key}] missing ${miss.join(", ")}`); continue; }
      if (!isNumeric(t.value)) { errors.push(`${name}: [${key}] value must be a finite number or a (nested) list of numbers`); continue; }
      const u = UNITS[String(t.unit)];
      if (!u) { errors.push(`${name}: [${key}] unknown unit '${t.unit}' (use ${Object.keys(UNITS).join(", ")})`); continue; }
      if (!CLASSES.includes(t.class)) { errors.push(`${name}: [${key}] class '${t.class}' is not one of ${CLASSES.join(" | ")}`); continue; }
      if (!TIERS.includes(t.tier)) { errors.push(`${name}: [${key}] tier '${t.tier}' is not one of ${TIERS.join(" | ")}`); continue; }
      if (t.range !== undefined && !(typeof t.range === "number" && t.range >= 0)) { errors.push(`${name}: [${key}] range must be a non-negative number`); continue; }
      if (t.basis !== undefined && !BASES.includes(t.basis)) table.warnings.push(`${name}: [${key}] basis '${t.basis}' is not one of ${BASES.join(" | ")}`);
      if (t.class === "assumed" && t.basis === undefined) table.warnings.push(`${name}: [${key}] class "assumed" without a basis`);
      const unknown = Object.keys(t).filter((f) => !["value", "unit", "range", "class", "basis", "tier", "evidence"].includes(f));
      if (unknown.length) table.warnings.push(`${name}: [${key}] unknown field(s) ${unknown.join(", ")}`);
      const prev = table.records.get(key);
      table.records.set(key, {
        key, value: convert(t.value, u.k), unit: u.si, given: t.value, given_unit: String(t.unit),
        ...(t.range !== undefined ? { range: t.range * u.k } : {}),
        class: t.class, ...(t.basis !== undefined ? { basis: t.basis } : {}), tier: t.tier, evidence: String(t.evidence), source: name,
        ...(prev ? { replaces: prev.source } : {}),
      });
    }
  };
  walk(doc, "");
}

/** Load devices.toml, the group files, then measured.toml. Throws one error listing every bad record. */
export function loadParams(dir: string, groups: string[]): ParamTable {
  const table = new ParamTable(), errors: string[] = [];
  const order = ["devices", ...groups, "measured"];
  for (const g of order) {
    const p = join(dir, g + ".toml");
    if (existsSync(p)) readFile(table, p, g + ".toml", errors);
    else if (g !== "measured" && g !== "devices") errors.push(`${g}.toml: file not found in ${dir}`);
  }
  for (const f of readdirSync(dir)) if (f.endsWith(".toml") && !order.includes(f.slice(0, -5))) table.warnings.push(`${f}: not a known group file, ignored`);
  if (errors.length) throw new Error(`parameter files invalid (${errors.length}):\n  ` + errors.join("\n  "));
  return table;
}
