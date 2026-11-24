// A small validator for the argument schemas of the commands (shared/commands/registry.ts). It covers
// only the subset the commands use: object (with required keys and no others), map (string → value),
// number and integer (with unit and range), string (with enum or pattern), boolean, array, and a choice
// between alternatives. The schemas are written in JSON Schema spelling (a map is an object whose
// `additionalProperties` is a schema; `unit` is an extra keyword), so the same objects can later be
// handed to a model as tool schemas without a conversion. Pure TypeScript, no dependency.

export type Schema = { description?: string } & (
  | { type: "object"; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: Schema | false; propertyNames?: { pattern: string } }
  | { type: "number" | "integer"; unit?: string; minimum?: number; maximum?: number }
  | { type: "string"; enum?: string[]; pattern?: string; maxLength?: number }
  | { type: "boolean" }
  | { type: "array"; items: Schema; minItems?: number; maxItems?: number }
  | { anyOf: Schema[] }
);

/** The error shape of every refusal: what went wrong, what to do about it, and (for bad arguments) the schema. */
export interface CommandError { code: string; message: string; hint: string; schema?: Schema }

/** Thrown by a command (or the document) to refuse; turned into `{ok: false, error}` by the caller. */
export class Refusal extends Error {
  constructor(public code: string, message: string, public hint: string, public schema?: Schema) { super(message); }
  toError(): CommandError { return { code: this.code, message: this.message, hint: this.hint, ...(this.schema ? { schema: this.schema } : {}) }; }
}

const show = (v: unknown) => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 60 ? s.slice(0, 57) + "..." : s; };
const what = (s: Schema): string => {
  if ("anyOf" in s) return s.anyOf.map(what).join(" or ");
  if (s.type === "array") return `a list of ${s.minItems !== undefined && s.minItems === s.maxItems ? `${s.minItems} ` : ""}${what(s.items).replace(/^an? /, "")}s`;
  if (s.type === "object") return s.additionalProperties && !s.properties ? "a map" : "an object";
  return s.type === "integer" ? "a whole number" : `a ${s.type}`;
};

/** null when `value` fits `schema`, otherwise the first problem found, as "<path>: <what is wrong>". */
export function check(schema: Schema, value: unknown, path = "args"): string | null {
  if ("anyOf" in schema) {
    const errs = schema.anyOf.map((s) => check(s, value, path));
    return errs.includes(null) ? null : `${path}: expected ${what(schema)}, got ${show(value)}`;
  }
  switch (schema.type) {
    case "boolean": return typeof value === "boolean" ? null : `${path}: expected true or false, got ${show(value)}`;
    case "number": case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${path}: expected ${what(schema)}${schema.unit ? ` (${schema.unit})` : ""}, got ${show(value)}`;
      if (schema.type === "integer" && !Number.isInteger(value)) return `${path}: expected a whole number, got ${value}`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${path}: ${value} is below the minimum ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path}: ${value} is above the maximum ${schema.maximum}`;
      return null;
    }
    case "string": {
      if (typeof value !== "string") return `${path}: expected a string, got ${show(value)}`;
      if (schema.enum && !schema.enum.includes(value)) return `${path}: ${show(value)} is not one of ${schema.enum.join(", ")}`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}: ${show(value)} does not match ${schema.pattern}`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path}: longer than ${schema.maxLength} characters`;
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${path}: expected ${what(schema)}, got ${show(value)}`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}: needs at least ${schema.minItems} item(s), got ${value.length}`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path}: takes at most ${schema.maxItems} item(s), got ${value.length}`;
      for (const [i, v] of value.entries()) { const e = check(schema.items, v, `${path}[${i}]`); if (e) return e; }
      return null;
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return `${path}: expected ${what(schema)}, got ${show(value)}`;
      const o = value as Record<string, unknown>, props = schema.properties ?? {};
      for (const k of schema.required ?? []) if (o[k] === undefined) return `${path}.${k}: required`;
      for (const [k, v] of Object.entries(o)) {
        if (v === undefined) continue;
        if (props[k]) { const e = check(props[k], v, `${path}.${k}`); if (e) return e; continue; }
        if (!schema.additionalProperties) return `${path}.${k}: unknown argument (known: ${Object.keys(props).join(", ") || "none"})`;
        if (schema.propertyNames && !new RegExp(schema.propertyNames.pattern).test(k)) return `${path}: key ${show(k)} does not match ${schema.propertyNames.pattern}`;
        const e = check(schema.additionalProperties, v, `${path}.${k}`); if (e) return e;
      }
      return null;
    }
  }
}
