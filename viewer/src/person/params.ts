// The person's run-time numbers: assets/manikin/params/runtime-person.toml, one record per number (value, unit, range,
// class, tier, evidence). The browser bundle carries only the values (tools/bundle.ts strips the records and refuses a
// file with an incomplete one); under `bun test` the TOML is read as it is and stripped here. A section is a read-only
// view that throws on a name the file does not have, so a typo fails loudly instead of reading `undefined`.
import raw from "../../../assets/manikin/params/runtime-person.toml";
import { stripRuntime } from "../../../shared/runtime-params.ts";

const VALUES = stripRuntime(raw);

function guard(node: any, path: string): any {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  return new Proxy(node, {
    get(t, k) {
      if (typeof k !== "string") return Reflect.get(t, k);
      if (!(k in t)) throw new Error(`runtime-person.toml has no record '${path ? path + "." : ""}${k}'`);
      return guard(t[k], path ? `${path}.${k}` : k);
    },
    set() { throw new Error("runtime parameters are read-only"); },
  });
}
/** One table of runtime-person.toml, e.g. section("operator"). Read its values once, at module level, not in a hot loop. */
export const section = (name: string): any => guard(VALUES[name], name);
/** GLSL `#define`s from a table of numbers: K_<NAME> for a number (float), vecN for a list of N <= 4 numbers. */
export function glslDefines(table: Record<string, number | number[]>, prefix = "K_"): string {
  const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
  return Object.entries(table).map(([k, v]) => {
    const n = `${prefix}${k.toUpperCase()}`;
    if (typeof v === "number") return `#define ${n} ${f(v)}`;
    if (Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every((x) => typeof x === "number")) return `#define ${n} vec${v.length}( ${v.map(f).join(", ")} )`;
    throw new Error(`runtime parameter ${k}: a shader constant must be a number or a list of 2 to 4 numbers`);
  }).join("\n") + "\n";
}
