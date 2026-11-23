// Tiny arithmetic over parameter keys, used by the declarative spec for mount frames and limits.
//   "seat.pedestal_height + seat.carrier_height"   "-pods.joy_spacing / 2"   "pods.button_xy_L[2][0]"
// Operators + - * / and parentheses; functions sin cos tan asin acos atan atan2 sqrt abs min max; constant pi.
// Values are SI (metres, radians) because the loader has already converted them.
type Lookup = (key: string) => any;
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max,
};

export function evalExpr(src: string | number, lookup: Lookup, where = ""): number {
  if (typeof src === "number") return src;
  const s = String(src);
  let i = 0;
  const fail = (m: string): never => { throw new Error(`expression "${s}"${where ? ` (${where})` : ""}: ${m}`); };
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = () => { ws(); return s[i]; };
  const eat = (c: string) => { if (peek() !== c) fail(`expected '${c}' at ${i}`); i++; };
  function primary(): number {
    const c = peek();
    if (c === undefined) return fail("unexpected end");
    if (c === "(") { i++; const v = sum(); eat(")"); return v; }
    if (c === "-") { i++; return -primary(); }
    if (c === "+") { i++; return primary(); }
    const num = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    const id = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*/.exec(s.slice(i));
    if (!id) return fail(`unexpected '${c}' at ${i}`);
    i += id[0].length;
    const name = id[0];
    if (peek() === "(") {
      const f = FUNCS[name] ?? fail(`unknown function '${name}'`);
      i++;
      const args: number[] = [];
      if (peek() !== ")") { args.push(sum()); while (peek() === ",") { i++; args.push(sum()); } }
      eat(")");
      return f(...args);
    }
    if (name === "pi") return Math.PI;
    let v = lookup(name);
    while (peek() === "[") { i++; const k = sum(); eat("]"); if (!Array.isArray(v) || v[k] === undefined) fail(`index [${k}] out of range for '${name}'`); v = v[k]; }
    if (typeof v !== "number") fail(`'${name}' is a list; index it like ${name}[0]`);
    return v;
  }
  function product(): number {
    let v = primary();
    for (;;) { const c = peek(); if (c === "*") { i++; v *= primary(); } else if (c === "/") { i++; v /= primary(); } else return v; }
  }
  function sum(): number {
    let v = product();
    for (;;) { const c = peek(); if (c === "+") { i++; v += product(); } else if (c === "-") { i++; v -= product(); } else return v; }
  }
  const v = sum();
  if (peek() !== undefined) fail(`unexpected '${s[i]}' at ${i}`);
  if (!Number.isFinite(v)) fail(`result is ${v}`);
  return v;
}
