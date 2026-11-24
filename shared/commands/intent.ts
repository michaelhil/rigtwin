// The intent commands (agent interface v2): one call per everyday request, in the words of the request.
//
//   adjust   move adjustments named in plain words: {target: "backrest", to: "upright"}, {target: "monitor height",
//            by: "-3 cm"}, several at once in `changes`; relative changes are worked out here, at the moment the edit is
//            recorded, so the caller reads nothing first and sends no expected version
//   look     one browser's view, what it shows and what is selected, in one call, and on request a picture of it
//   measure  the distance between two points named in plain words
//   undo     "that" (the last change not yet undone), "mine", a request name or a version
//   state    what is moved and the last changes, in a few lines; detail "catalogue" gives every adjustment
//
// They are a layer over the commands of step 1 (core.ts): the same document, history, refusals, guards and undo. Each
// reply carries `text`, a few lines for the reader (the MCP tools return only that), and the same facts as data. An edit
// gets its request name from the server ("backrest-recline-21"), so nobody has to invent one. Assumed adjustments are
// moved and marked in the reply instead of refused: the caller says "assumed adjustment" (the honesty rule), and asks
// first only when it chose one that the owner did not name.
//
// What each adjustment means (what 0 is, which way is +, its everyday names) is in shared/words.ts, next to the words
// the page uses; `catalogue()` turns it into the lines agents read (the MCP server's instructions, `state` with detail
// "catalogue", the Skill's reference and the wiki page, all generated).
import { register, get, type AssetInfo, type CommandSpec, type RunOutput } from "./registry.ts";
import { Refusal, type Schema } from "./schema.ts";
import { planUndo, GROUP_PATTERN, type Actor, type Entry, type JointChange, type SceneDoc } from "./doc.ts";
import { checkId, findIds, idTokens, isAssumed, labelOf, sameSI, tokens, unitOf, VIEW_NAMES } from "./core.ts";
import type { ManifestJoint } from "../manifest.ts";
import type { JointValue } from "../pose.ts";
import { adjWords, jointName, rowName, sayJoint, sayOffset, UNITS, type AdjWord } from "../words.ts";

const DEG = Math.PI / 180;
const r1 = (x: number) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------------------------------- adjustments
/** One number a person can change (a joint, or one angle of a three-angle mount), with its meaning. SI values. */
export interface Adjustment {
  key: string; joint: ManifestJoint; comp: number | null; words: AdjWord;
  /** "Backrest: recline", "Touchscreen display: tilt" */
  name: string;
  unit: "m" | "rad"; lo: number; hi: number; neutral: number;
  /** the word for the positive direction and for the negative one ("reclined" / "upright") */
  plus: string; minus: string;
  assumed: boolean; evidence: string;
  main: Set<string>; phrases: Set<string>; extra: Set<string>;
}
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9:]+/g, " ").trim();
const cache = new WeakMap<AssetInfo, Adjustment[]>();
export function adjustments(asset: AssetInfo): Adjustment[] {
  let out = cache.get(asset);
  if (out) return out;
  out = [];
  for (const j of asset.manifest.joints) {
    for (const w of adjWords(j)) {
      const ball = j.type === "ball", neutral = ball ? (j.neutral as number[])[w.comp!] : (j.neutral as number);
      const name = w.comp === null ? jointName(j) : `${w.section}: ${w.label.toLowerCase()}`;
      const plus = w.flip ? w.lo : w.hi, minus = w.flip ? w.hi : w.lo;
      out.push({
        key: w.key, joint: j, comp: w.comp, words: w, name, unit: j.unit === "m" ? "m" : "rad",
        lo: ball ? neutral + j.lower : j.lower, hi: ball ? neutral + j.upper : j.upper, neutral, plus, minus,
        assumed: isAssumed(j), evidence: j.evidence,
        main: new Set([...tokens(w.section), ...tokens(w.label), ...w.aliases.flatMap(tokens), ...idTokens(j.id)]),
        phrases: new Set([norm(name), norm(`${w.section} ${w.label}`), ...w.aliases.map(norm), j.id.toLowerCase(), w.key.toLowerCase()]),
        extra: new Set([...tokens(w.lo), ...tokens(w.hi), ...tokens(labelOf(asset, j.child))]),
      });
    }
  }
  cache.set(asset, out);
  return out;
}

const STOP = new Set(["the", "a", "an", "of", "to", "and", "in", "on", "at", "for", "with", "by", "me", "my", "its", "it", "set", "move", "make", "please", "put", "bit", "little", "s"]);
/** "a person's" value of an adjustment as the page says it: "3 cm lower", "upright", "as photographed" */
const say = (a: Adjustment, v: number) => sayOffset(a.words, v, { lo: a.lo, hi: a.hi, neutral: a.neutral }, a.unit);
/** the value in numbers: "−3 cm", "12°" (a length from as photographed, an angle as the joint gives it) */
function num(a: Adjustment, v: number) {
  const x = a.unit === "m" ? r1(v * 100) : r1(v / DEG);
  return `${x < 0 ? "−" : ""}${Math.abs(x)}${a.unit === "m" ? " cm" : "°"}`;
}
/** The travel in everyday units: "−9.5 … +6 cm", "0 … 35°" */
const travel = (a: Adjustment) => `${num(a, a.lo).replace(/^(\d)/, a.lo > 0 ? "+$1" : "$1")} … ${a.hi > 0 ? "+" : ""}${num(a, a.hi)}`.replace("+−", "−");
const value = (a: Adjustment, pose: Record<string, JointValue>) => { const v = pose[a.joint.id] ?? a.joint.neutral; return Array.isArray(v) ? v[a.comp!] : v; };

/** The adjustment meant by plain words or an id; refuses `ambiguous` (with the candidates) when two are about as likely. */
export function resolveAdjustment(asset: AssetInfo, text: string): Adjustment {
  const all = adjustments(asset), q = norm(text), t = text.trim().toLowerCase();
  const exact = all.filter((a) => a.key.toLowerCase() === t || (a.comp === null && a.joint.id.toLowerCase() === t));
  if (exact.length === 1) return exact[0];
  if (all.some((a) => a.comp !== null && a.joint.id.toLowerCase() === t)) {
    throw new Refusal("ambiguous", `${text} is a three-angle mount: name one of its angles`, `one of: ${all.filter((a) => a.joint.id.toLowerCase() === t).map((a) => `"${a.name}" (${a.key})`).join(", ")}`);
  }
  const words = tokens(text).filter((w) => !STOP.has(w));
  const scored = all.map((a) => {
    let s = 0, every = words.length > 0;
    for (const w of words) { const p = a.main.has(w) ? 3 : a.extra.has(w) ? 1 : [...a.main].some((t) => w.length >= 4 && t.startsWith(w)) ? 2 : 0; s += p; if (!p) every = false; }
    return { a, s: s + (every ? 2 : 0) + (a.phrases.has(q) ? 4 : 0) };
  }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  if (!scored.length) throw new Refusal("unknown_target", `nothing adjustable matches ${JSON.stringify(text)}`, `name it as in the list (state {"detail": "catalogue"}), e.g. "monitor height", "backrest", "left armrest", "seat height"`);
  const [best, next] = scored;
  if (next && best.s - next.s < 2) {
    const near = scored.filter((x) => x.s >= best.s - 1).slice(0, 6).map((x) => `"${x.a.name}"`);
    throw new Refusal("ambiguous", `${JSON.stringify(text)} could be ${near.join(" or ")}`, "ask the owner which one is meant, or name it more exactly");
  }
  return best.a;
}

const NEUTRAL = new Set(["as photographed", "photographed", "neutral", "original", "default", "reset", "start", "home"]);
const MAX = new Set(["max", "maximum", "most", "highest", "full", "fully"]), MIN = new Set(["min", "minimum", "least", "lowest"]);
const AMOUNT = /^([+-]?\d+(?:[.,]\d+)?|[+-]?[.,]\d+)\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?|°|º|deg|degs|degrees?|rad|radians?)?(?![a-z])\s*(.*)$/;
/** A value given as a number (metres or degrees, as pose.set takes them) or as words: "-3 cm", "5°", "2 cm higher",
 *  and for `to` also "as photographed", "upright", "max". Returns SI; `relative` = an amount to add. */
export function parseAmount(a: Adjustment, given: number | string, mode: "to" | "by"): { si: number; relative: boolean } {
  const angular = a.unit === "rad";
  if (typeof given === "number") return { si: angular ? given * DEG : given, relative: mode === "by" };
  const s = norm(given.replace(/−/g, "-")).replace(/(\d) (\d)/g, "$1$2"), raw = given.trim().toLowerCase().replace(/−/g, "-").replace(/,/g, ".");
  if (mode === "to") {
    if (NEUTRAL.has(s)) return { si: a.neutral, relative: false };
    const w = s.split(" "), plus = norm(a.plus), minus = norm(a.minus);
    const end = (x: string) => x === plus || x.endsWith(` ${plus}`) || (w.some((t) => MAX.has(t)) && !x.includes(minus)) ? "hi" : x === minus || x.endsWith(` ${minus}`) || w.some((t) => MIN.has(t)) ? "lo" : null;
    if (!/\d/.test(s)) {
      const e = end(s);
      if (e) return { si: e === "hi" ? a.hi : a.lo, relative: false };
      throw new Refusal("invalid_args", `${a.name}: ${JSON.stringify(given)} is not a value or a named position`, `use a number, "as photographed", "${a.minus}", "${a.plus}", "min" or "max"`);
    }
  }
  const m = raw.match(AMOUNT);
  if (!m) throw new Refusal("invalid_args", `${a.name}: ${JSON.stringify(given)} is not an amount`, angular ? `e.g. "5°", "-10 deg" or "5° ${a.plus}"` : `e.g. "-3 cm", "30 mm" or "2 cm ${a.plus}"`);
  let x = Number(m[1].replace(",", "."));
  const u = m[2] ?? "", rest = norm(m[3] ?? "");
  const length = /^(mm|milli|cm|centi|m$|met)/.test(u), angle = /^(°|º|deg|rad)/.test(u);
  if (angular && length) throw new Refusal("invalid_args", `${a.name} is an angle; ${JSON.stringify(given)} is a length`, `give degrees, e.g. "5°"`);
  if (!angular && angle) throw new Refusal("invalid_args", `${a.name} is a length; ${JSON.stringify(given)} is an angle`, `give a length, e.g. "3 cm"`);
  if (u.startsWith("mm") || u.startsWith("milli")) x /= 1000; else if (u.startsWith("cm") || u.startsWith("centi")) x /= 100;
  let si = angular && !u.startsWith("rad") ? x * DEG : x;      // lengths in metres, angles in degrees unless "rad"
  // a direction word: "2 cm higher", "5° down"; with `to` it is an offset from as photographed ("3 cm lower")
  const plus = norm(a.plus), minus = norm(a.minus), dir = rest && (rest === plus || rest.includes(plus) || rest === "more") ? 1 : rest && (rest === minus || rest.includes(minus) || rest === "less") ? -1 : 0;
  if (rest && !dir) throw new Refusal("invalid_args", `${a.name}: ${JSON.stringify(rest)} is not a direction of this adjustment`, `its directions are "${a.minus}" and "${a.plus}"`);
  if (dir) si = Math.abs(si) * dir;
  if (mode === "by") return { si, relative: true };
  return dir ? { si: a.neutral + si, relative: false } : { si, relative: false };
}

// ------------------------------------------------------------------------------------------- the vocabulary
const vocabCache = new WeakMap<AssetInfo, Set<string>>();
/** Every word of the model's own vocabulary (adjustment names and their other names, directions, named positions, views,
 *  groups, parts and reference points, units). The public trace shows a caller's text only when it is made of these. */
export function vocabulary(asset: AssetInfo): Set<string> {
  let v = vocabCache.get(asset);
  if (v) return v;
  v = new Set(["cm", "mm", "m", "deg", "degree", "degrees", "rad", "by", "to", "the", "a", "of", "s"]);
  const add = (t: string) => { for (const w of tokens(t)) v!.add(w); };
  for (const a of adjustments(asset)) { for (const w of [...a.main, ...a.extra]) v.add(w); add(`${a.name} ${a.plus} ${a.minus} ${a.words.zero}`); }
  for (const w of [...NEUTRAL, ...MAX, ...MIN, ...Object.keys(VIEW_WORDS), ...Object.keys(GROUP_WORDS), ...UNITS.map((u) => u.name), ...VIEW_NAMES]) add(w);
  for (const c of [...asset.manifest.components, ...asset.manifest.surfaces]) add(labelOf(asset, c.id));
  for (const d of asset.manifest.datums) add(d.label);
  vocabCache.set(asset, v);
  return v;
}
/** true when every word of `s` is a number or a word of the vocabulary */
export function ownWords(asset: AssetInfo, s: string): boolean {
  if (s.length > 80) return false;
  const v = vocabulary(asset), words = s.toLowerCase().replace(/−/g, "-").split(/[^a-z0-9.+-]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => /^[+-]?\d*([.,]\d+)?$/.test(w) || v.has(w));
}

// ------------------------------------------------------------------------------------------- the catalogue
/** One line per adjustment, for agents: name, travel, what 0 is, the directions, the evidence, other names. */
export function catalogue(asset: AssetInfo, compact = false): string[] {
  if (compact) return adjustments(asset).map((a) => {
    const at = a.unit === "m" ? travel(a) : a.comp !== null ? `photographed ±${num(a, a.joint.upper)}` : `${travel(a)}, photographed ${num(a, a.neutral)}`;
    const zero = a.comp === null && a.words.zero && a.words.zero !== "as photographed" ? `, 0 = ${a.words.zero.replace(/, as photographed$/, "")}` : "";
    return `- ${a.name} [${a.key}]: ${at.replace(/ cm … /, " … ")}${zero}; +${a.plus} −${a.minus}${a.assumed ? "; ASSUMED" : ""}`;
  });
  return adjustments(asset).map((a) => {
    const zero = a.words.zero || "?", at = a.unit === "m" ? `${travel(a)} from as photographed` : a.comp !== null ? `as photographed ±${num(a, a.joint.upper)}` : `${travel(a)}, as photographed ${num(a, a.neutral)}`;
    const meaning = a.comp !== null ? "" : `; 0 = ${zero}`;
    const also = a.words.aliases.filter((x) => norm(x) !== norm(a.name)).slice(0, 3).map((x) => `"${x}"`).join(", ");
    return `- ${a.name} [${a.key}]: ${at}${meaning}; + = ${a.plus}, − = ${a.minus}; ${a.assumed ? "ASSUMED (not seen in the photos)" : a.evidence}${also ? `; also ${also}` : ""}`;
  });
}

// ------------------------------------------------------------------------------------------- helpers for replies
function movedLines(asset: AssetInfo, pose: Record<string, JointValue>, except: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const a of adjustments(asset)) {
    if (except.has(a.joint.id)) continue;
    const v = value(a, pose);
    if (Math.abs(v - a.neutral) > (a.unit === "m" ? 0.0005 : 0.0044)) out.push(`${a.name} ${say(a, v)}${a.assumed ? " (assumed)" : ""}`);
  }
  return out;
}
/** "Backrest: recline 25° reclined → upright" for each adjustment a change moves */
function changeLines(asset: AssetInfo, changes: JointChange[]): string[] {
  const out: string[] = [];
  for (const c of changes) for (const a of adjustments(asset)) {
    if (a.joint.id !== c.joint || c.before === null || c.after === null) continue;
    const b = Array.isArray(c.before) ? c.before[a.comp!] : c.before, n = Array.isArray(c.after) ? c.after[a.comp!] : c.after;
    if (Math.abs(b - n) > 1e-9) out.push(`${a.name} ${say(a, b)} → ${say(a, n)}`);
  }
  return out;
}
const ago = (at: string) => { const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000); return s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
function entryWords(asset: AssetInfo, e: Entry): string {
  const parts = e.changes.map((c) => { const j = asset.joints.get(c.joint); return j && c.after !== null ? sayJoint(j, c.after as number) : c.joint; });
  // only request names the server made are shown: a name a caller chose is text from a stranger on the public sandbox
  const named = e.group && /-\d+$/.test(e.group) ? ` [${e.group}]` : e.group ? " [a request named by its caller]" : "";
  return `v${e.version} ${e.actor.label}${e.undoes ? ` undid v${e.undoes.join(", v")}` : ""}${named} — ${[...new Set(parts)].join("; ")}`;
}
/** the newest entry by someone else that changed one of `joints` in the last 15 minutes */
function recentOther(doc: SceneDoc, actor: Actor, joints: string[]): Entry | undefined {
  return [...doc.history].reverse().find((e) => e.actor.id !== actor.id && Date.now() - Date.parse(e.at) < 15 * 60_000 && e.changes.some((c) => joints.includes(c.joint)));
}

// ------------------------------------------------------------------------------------------- schemas
const amount: Schema = { anyOf: [{ type: "number", unit: "m or deg" }, { type: "string", maxLength: 60 }] };
const oneChange: Schema = {
  type: "object", required: ["target"],
  properties: {
    target: { type: "string", maxLength: 80, description: "the adjustment in plain words or its id: \"backrest\", \"monitor height\", \"left armrest\", \"J_seat_recline\", \"J_ts_screen:1\"" },
    to: { ...amount, description: "where it goes: a number (metres or degrees, absolute as pose.set takes them), \"0°\", \"-3 cm\", \"3 cm lower\" (from as photographed), \"as photographed\", a direction word for the end of the travel (\"upright\", \"lower\") or \"max\" / \"min\"" },
    by: { ...amount, description: "how much it moves from where it is now: \"-3 cm\", \"+5°\", \"2 cm higher\", or a number (metres or degrees)" },
  },
};
const words: Schema = { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", items: { type: "string", maxLength: 80 }, minItems: 1, maxItems: 40 }] };
const asList = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

// ------------------------------------------------------------------------------------------- commands
type Change = { target: string; to?: number | string; by?: number | string };
type AdjustResult = { text: string; changes: { adjustment: string; key: string; before: string; after: string; before_value: string; after_value: string; assumed: boolean }[]; notes: string[]; also_moved: string[]; version?: number; request?: string };

const VIEW_WORDS: Record<string, string> = {
  operator: "operator", "operators view": "operator", "operator view": "operator", "operators eye": "operator", eye: "operator", "eye view": "operator", driver: "operator", "first person": "operator",
  overview: "three_quarter", "three quarter": "three_quarter", default: "three_quarter", front: "front", back: "rear", rear: "rear", behind: "rear",
  left: "left", "left side": "left", right: "right", "right side": "right", side: "right", top: "top", above: "top", plan: "top",
  "front corner": "front_quarter", "front quarter": "front_quarter",
};
const GROUP_WORDS: Record<string, string> = {
  stand: "stand", "monitor stand": "stand", monitor: "stand", seat: "seat", chair: "seat", armrests: "pods", armrest: "pods", pods: "pods",
  pedals: "pedals", pedal: "pedals", platform: "platform", deck: "platform", floor: "platform",
};
/** a part, group or unit meant by plain words (or an id) */
function resolvePart(asset: AssetInfo, text: string): string {
  const q = norm(text);
  if (asset.manifest.groups.includes(text) || asset.nodes.some((n) => n.name === text)) return text;
  if (Object.hasOwn(GROUP_WORDS, q)) return GROUP_WORDS[q];
  const unit = UNITS.find((u) => norm(u.name) === q);
  if (unit) return unit.parts[0];
  const hit = findIds(asset, text, "part", 3);
  if (!hit.length) throw new Refusal("unknown_target", `no part matches ${JSON.stringify(text)}`, "use a group (stand, seat, pods, pedals, platform) or a part's name, e.g. \"monitor\", \"left joystick\"");
  if (hit[1] && hit[0].score === hit[1].score) throw new Refusal("ambiguous", `${JSON.stringify(text)} could be ${hit.slice(0, 3).map((h) => `"${h.label}"`).join(" or ")}`, "name it more exactly");
  return hit[0].id;
}
/** a point to measure from: a reference point (eye, grip, seat reference), a screen or a part, by plain words or id */
function resolvePoint(asset: AssetInfo, text: string): string {
  if (/^[CDSJ]_[A-Za-z0-9_]{1,60}$/.test(text)) { checkId(asset, text, "point"); return text; }
  const hit = findIds(asset, text, undefined, 4).filter((h) => h.kind !== "joint");
  if (!hit.length) throw new Refusal("unknown_target", `no point matches ${JSON.stringify(text)}`, "e.g. \"median eye\", \"monitor screen\", \"right grip\", \"touchscreen\"");
  if (hit[1] && hit[0].score === hit[1].score) throw new Refusal("ambiguous", `${JSON.stringify(text)} could be ${hit.slice(0, 3).map((h) => `"${h.label}"`).join(" or ")}`, "name it more exactly (for the eye: small, median or large)");
  return hit[0].id;
}

const intent: CommandSpec[] = [
  {
    id: "adjust", kind: "edit", tool: "adjust",
    summary: "Move one or more adjustments, named in plain words, in one request: {target, to} or {target, by}, or several in `changes`. Relative changes are worked out on the server, so read nothing first. Assumed adjustments are moved and marked. The reply is the verification: before → after, the request name for undo, and what else is moved.",
    args: { type: "object", properties: { ...((oneChange as any).properties), changes: { type: "array", items: oneChange, minItems: 1, maxItems: 20, description: "several adjustments as one request" } } },
    examples: [
      { args: { target: "backrest", to: "upright" }, note: "the backrest vertical (0°); an assumed adjustment" },
      { args: { target: "monitor height", by: "-3 cm" }, note: "the monitor 3 cm lower than it is now" },
      { args: { changes: [{ target: "seat height", to: "as photographed" }, { target: "monitor tilt", by: "5° up" }] }, note: "two adjustments as one request" },
    ],
    run({ doc, asset, actor }, a: Change & { changes?: Change[] }): RunOutput<AdjustResult> {
      const list: Change[] = a.changes ?? (a.target !== undefined ? [{ target: a.target, to: a.to, by: a.by }] : []);
      if (!list.length) throw new Refusal("invalid_args", "adjust: name a target", "e.g. {\"target\": \"backrest\", \"to\": \"upright\"} or {\"changes\": [...]}");
      if (a.changes && (a.target !== undefined || a.to !== undefined || a.by !== undefined)) throw new Refusal("invalid_args", "adjust: give either target (with to or by) or changes, not both", "put every adjustment into changes");
      const next: Record<string, JointValue> = {}, seen: Adjustment[] = [], notes: string[] = [];
      for (const c of list) {
        if ((c.to === undefined) === (c.by === undefined)) throw new Refusal("invalid_args", `adjust ${JSON.stringify(c.target)}: give exactly one of to or by`, "to: where it goes; by: how much it moves from where it is now");
        const adj = resolveAdjustment(asset, c.target);
        if (seen.some((x) => x.key === adj.key)) throw new Refusal("invalid_args", `${adj.name} is named twice in one request`, "name each adjustment once");
        const cur = next[adj.joint.id] ?? (doc.pose[adj.joint.id] ?? adj.joint.neutral), now = Array.isArray(cur) ? cur[adj.comp!] : cur;
        const { si, relative } = parseAmount(adj, (c.to ?? c.by)!, c.to !== undefined ? "to" : "by");
        let v = relative ? now + si : si;
        const tol = adj.unit === "m" ? 1e-7 : 1e-6;
        if (v < adj.lo - tol || v > adj.hi + tol) {
          throw new Refusal("out_of_range", `${adj.name}: ${num(adj, v)} is outside its travel, ${travel(adj)}${adj.unit === "m" ? " from as photographed" : ""} (now ${num(adj, now)})`, `to "${adj.plus}" or "${adj.minus}" goes to the end of the travel; ask the owner before using the end instead`);
        }
        v = Math.min(adj.hi, Math.max(adj.lo, v));
        next[adj.joint.id] = Array.isArray(cur) ? cur.map((x, i) => (i === adj.comp ? v : x)) : v;
        seen.push(adj);
        if (adj.assumed) notes.push(`${adj.name} is an assumed adjustment: it was not seen in the photos, so whether it exists and how far it goes are assumptions. Say so in the reply.`);
      }
      const changes: JointChange[] = Object.entries(next).map(([joint, after]) => ({ joint, before: doc.pose[joint] ?? asset.joints.get(joint)!.neutral, after }));
      const other = recentOther(doc, actor, changes.filter((c) => !sameSI(c.before as JointValue, c.after as JointValue)).map((c) => c.joint));
      if (other) notes.push(`This replaces a change by ${other.actor.label} (version ${other.version}, ${ago(other.at)}).`);
      const pose = { ...doc.pose, ...next };
      const rows = seen.map((adj) => {
        const before = value(adj, doc.pose), after = value(adj, pose);
        return { adjustment: adj.name, key: adj.key, before: say(adj, before), after: say(adj, after), before_value: num(adj, before), after_value: num(adj, after), assumed: adj.assumed };
      });
      return { result: { text: "", changes: rows, notes, also_moved: movedLines(asset, pose, new Set(Object.keys(next))) }, changes, joints: Object.keys(next) };
    },
    autoGroup(a: Change & { changes?: Change[] }, out: RunOutput<AdjustResult>) { const n = out.result.changes.length; return out.result.changes[0].key.replace(/^J_/, "").replace(":", "-") + (n > 1 ? `-and-${n - 1}` : ""); },
    finish(r: AdjustResult, done) {
      const lines = r.changes.map((c) => `${c.adjustment} ${c.before} → ${c.after} (${c.before_value} → ${c.after_value})`);
      if (done.recorded === null) lines.push("Nothing changed: every value was already there; nothing recorded.");
      else lines.push(`Version ${done.recorded}, request ${done.group}. Undo: undo {"what": "${done.group}"}.`);
      lines.push(...r.notes);
      lines.push(r.also_moved.length ? `Also moved: ${r.also_moved.join("; ")}.` : "Nothing else is moved from as photographed.");
      return { ...r, text: lines.join("\n"), ...(done.recorded !== null ? { version: done.recorded, request: done.group } : {}) };
    },
  },
  {
    id: "undo", kind: "edit", tool: "undo",
    summary: "Undo a change, as a new change: \"that\" / \"last\" (the newest change not yet undone, by anyone), \"mine\" (the newest of this caller's), a request name (every change of that request) or a version number.",
    args: { type: "object", properties: { what: { anyOf: [{ type: "string", maxLength: 40 }, { type: "integer", minimum: 1 }], description: "\"last\" (default), \"mine\", a request name such as \"backrest-recline-21\", or a version number" } } },
    examples: [{ args: {}, note: "undo the last change" }, { args: { what: "monitor-height-14" }, note: "undo a whole request" }, { args: { what: 12 }, note: "undo version 12" }],
    run({ doc, asset, actor }, a: { what?: string | number }) {
      const w = a.what === undefined ? "last" : typeof a.what === "number" ? a.what : a.what.trim().toLowerCase();
      const undone = new Set(doc.history.flatMap((e) => e.undoes ?? []));
      const open = [...doc.history].reverse().filter((e) => !e.undoes && !undone.has(e.version) && e.actor.kind !== "system");
      let target: { version: number } | { group: string }, about: string;
      if (typeof w === "number" || /^\d+$/.test(w)) { target = { version: Number(w) }; about = `version ${w}`; }
      else if (["last", "that", "it", "this", "previous", "latest"].includes(w)) {
        const e = open[0]; if (!e) throw new Refusal("nothing_to_undo", "there is no change left to undo", "state shows the recent changes");
        target = { version: e.version }; about = entryWords(asset, e);
      } else if (["mine", "my last", "my change", "own"].includes(w)) {
        const e = open.find((x) => x.actor.id === actor.id); if (!e) throw new Refusal("nothing_to_undo", "this caller has no change left to undo", "\"mine\" means changes made in this session; state shows who changed what");
        target = { version: e.version }; about = entryWords(asset, e);
      } else if (new RegExp(GROUP_PATTERN).test(w)) { target = { group: w }; about = /-\d+$/.test(w) ? `request ${w}` : "a request named by its caller"; }
      else throw new Refusal("invalid_args", `undo: ${JSON.stringify(a.what)} is not "last", "mine", a request name or a version`, "e.g. {\"what\": \"last\"}");
      const plan = planUndo(doc, target);
      for (const c of plan.changes) {
        const j = asset.joints.get(c.joint);
        if (!j || c.after === null) throw new Refusal("unknown_joint", `${c.joint} is no longer a joint of ${asset.name} (the asset was rebuilt), so this change cannot be put back`, "set the remaining adjustments with adjust");
      }
      const pose = { ...doc.pose }; for (const c of plan.changes) pose[c.joint] = c.after as JointValue;
      const lines = changeLines(asset, plan.changes);
      return { result: { text: [`Undid ${about}:`, ...lines].join("\n"), undid: plan.undoes, lines, also_moved: movedLines(asset, pose, new Set(plan.changes.map((c) => c.joint))) }, changes: plan.changes, undoes: plan.undoes };
    },
    finish(r: any, done) {
      return { ...r, text: `${r.text}\n${done.recorded === null ? "Nothing changed." : `Version ${done.recorded}.`}\n${r.also_moved.length ? `Still moved: ${r.also_moved.join("; ")}.` : "Everything is as photographed now."}`, version: done.recorded };
    },
  },
  {
    id: "state", kind: "query", tool: "state",
    summary: "The scene in a few lines: what is moved from as photographed and the last changes (who, request). detail \"catalogue\": every adjustment with its travel, what 0 means and its directions; \"history\": the last 20 changes.",
    args: { type: "object", properties: { detail: { type: "string", enum: ["catalogue", "history"] } } },
    examples: [{ args: {}, note: "what is moved, and the last changes" }, { args: { detail: "catalogue" }, note: "every adjustment and what its numbers mean" }],
    run({ doc, asset }, a: { detail?: string }) {
      if (a.detail === "catalogue") return { result: { text: [`${asset.manifest.title ?? asset.name}: every adjustment (lengths from as photographed; angles as the joint gives them)`, ...catalogue(asset)].join("\n") } };
      const moved = movedLines(asset, doc.pose), recent = doc.history.slice(a.detail === "history" ? -20 : -3).reverse();
      return {
        result: {
          text: [
            `${asset.manifest.title ?? asset.name}, scene version ${doc.version}.`,
            moved.length ? `Moved from as photographed: ${moved.join("; ")}.` : "Everything is as photographed.",
            recent.length ? `Last changes:\n${recent.map((e) => `  ${entryWords(asset, e)} (${ago(e.at)})`).join("\n")}` : "No changes yet.",
          ].join("\n"),
          version: doc.version, moved, recent: recent.map((e) => ({ version: e.version, by: e.actor.label, ...(e.group && /-\d+$/.test(e.group) ? { request: e.group } : {}), at: e.at })),
        },
      };
    },
  },
  {
    id: "measure", kind: "query", tool: "measure",
    summary: "The distance between two points named in plain words or ids (\"median eye\" to \"monitor screen\"), at the current pose: a point estimate between frame origins, at the sizes estimated from photographs; no range yet.",
    args: { type: "object", required: ["from", "to"], properties: { from: { type: "string", maxLength: 80, description: "a reference point, screen or part: \"median eye\", \"small eye\", \"right grip\", \"D_eye_median\"" }, to: { type: "string", maxLength: 80, description: "e.g. \"monitor screen\", \"touchscreen\", \"S_mon_screen\"" } } },
    examples: [{ args: { from: "median eye", to: "monitor screen" }, note: "viewing distance of a median adult" }],
    run(ctx, a: { from: string; to: string }) {
      const from = resolvePoint(ctx.asset, a.from), to = resolvePoint(ctx.asset, a.to);
      const r: any = get("measure.distance")!.run!(ctx, { from, to }).result;
      const short = (l: string) => l.replace(/\s*\([^)]*\)/g, "");
      return { result: { text: `${short(r.from.label)} → ${short(r.to.label)}: ${r1(r.distance_m * 100)} cm. A point estimate between the two frame origins, at the sizes estimated from photographs and assumptions; no range yet (scene version ${r.at_version}).`, ...r } };
    },
  },
  {
    id: "look", kind: "view", tool: "look", sessionOptional: true,
    summary: "One browser's view in one call: a named view (operator's eye, overview, front, back, left, right, top, front corner), what it shows (only, hide, all), what is selected, and with picture: true an image of the result. Locally without a viewer code it goes to every open page; on the public sandbox it needs the code shown under More, \"Shared scene\". Changes nothing in the scene.",
    args: { type: "object", properties: { view: { type: "string", maxLength: 40, description: "operator (the operator's eye), overview, front, back, left, right, top, front corner" }, only: { ...words, description: "show only these groups or parts: \"stand\", \"seat\", \"monitor\", \"left joystick\"" }, hide: { ...words, description: "hide these groups or parts" }, all: { type: "boolean", description: "show everything again" }, select: { type: "string", maxLength: 80, description: "select a part or group, as a click would (its card opens)" }, picture: { type: "boolean", description: "return a picture of the browser's view after the change" } } },
    examples: [{ args: { view: "operator", picture: true }, note: "the operator's view, and a picture of it" }, { args: { only: ["stand", "seat"] }, note: "only the monitor stand and the seat" }],
    run({ asset }, a: { view?: string; only?: string | string[]; hide?: string | string[]; all?: boolean; select?: string; picture?: boolean }) {
      const out: Record<string, unknown> = {}, said: string[] = [], nameOf = (x: string) => (asset.manifest.groups.includes(x) ? rowName(x, x) : labelOf(asset, x));
      if (a.view !== undefined) {
        const w = norm(a.view).replace(/^the /, ""), v = VIEW_NAMES.includes(a.view) ? a.view : Object.hasOwn(VIEW_WORDS, w) ? VIEW_WORDS[w] : undefined;
        if (!v) throw new Refusal("invalid_args", `look: ${JSON.stringify(a.view)} is not a view`, `one of: operator, overview, front, back, left, right, top, front corner`);
        out.view = v; said.push(v === "operator" ? "the operator's eye view" : `the ${v.replace("_", " ")} view`);
      }
      if (a.all) { out.all = true; said.push("everything shown"); }
      const only = asList(a.only)?.map((x) => resolvePart(asset, x)), hide = asList(a.hide)?.map((x) => resolvePart(asset, x));
      if (only) { out.only = only; said.push(`only ${only.map(nameOf).join(", ")}`); }
      if (hide) { out.hide = hide; said.push(`hidden: ${hide.map(nameOf).join(", ")}`); }
      if (a.select !== undefined) { const s = resolvePart(asset, a.select); out.select = s; said.push(`${nameOf(s)} selected`); }
      if (a.picture) out.picture = true;
      if (!Object.keys(out).length) throw new Refusal("invalid_args", "look: give a view, only, hide, all, select or picture", "e.g. {\"view\": \"operator\", \"picture\": true}");
      return { result: { text: said.length ? `Showing ${said.join("; ")}.` : "Taking a picture of the view as it is." , ...out }, view: out };
    },
  },
];
for (const c of intent) register(c);
