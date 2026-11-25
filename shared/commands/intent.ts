// The intent commands (agent interface v2): one call per everyday request, in the words of the request.
//
//   adjust   move adjustments named in plain words: {target: "backrest", to: "upright"}, {target: "monitor height",
//            by: "-3 cm"}, several at once in `changes`; relative changes are worked out here, at the moment the edit is
//            recorded, so the caller reads nothing first and sends no expected version
//   look     one browser's view, what it shows and what is selected, in one call, and on request a picture of it
//   measure  the distance between two points named in plain words
//   undo     "that" (the last change not yet undone), "mine", a request name or a version
//   state    what is moved and the last changes, in a few lines; detail "catalogue" gives every adjustment
//   person   the person in the seat (person.ts, manikin v1): preset, style, body, posture, clear; measure {person} measures it
//
// They are a layer over the commands of step 1 (core.ts): the same document, history, refusals, guards and undo. Each
// reply carries `text`, a few lines for the reader (the MCP text fallback uses it), and the same facts as data. An edit
// gets its request name from the server ("backrest-recline-21"), so nobody has to invent one. Assumed adjustments are
// moved and marked in the reply instead of refused: the caller says "assumed adjustment" (the honesty rule), and asks
// first only when it chose one that the owner did not name.
//
// What each adjustment means (what 0 is, which way is +, its everyday names) is in shared/words.ts, next to the words
// the page uses; `catalogue()` turns it into the lines agents read (`state` with detail
// "catalogue", the Skill's reference and the wiki page, all generated).
import { register, get, list, tools, type AssetInfo, type CommandSpec, type RunOutput } from "./registry.ts";
import { Refusal, type Schema, type TargetRef } from "./schema.ts";
import { planUndo, GROUP_PATTERN, type Actor, type Entry, type JointChange, type SceneDoc } from "./doc.ts";
import { checkId, rankTargets, resolvePoint, pointAlias, targetRefs, idTokens, isAssumed, labelOf, sameSI, tokens, unitOf, VIEW_NAMES } from "./core.ts";
import { toJsonSchema } from "./tools.ts";
import type { ManifestJoint } from "../manifest.ts";
import { worldFrames } from "../kinematics.ts";
import type { JointValue } from "../pose.ts";
import { adjWords, jointName, rowName, sayJoint, sayOffset, UNITS, TOUCHSCREEN_NAMES, type AdjWord } from "../words.ts";
import { personCommands, personEye, personChangeLine, sayPersonOrNobody } from "./person.ts";
import { PRESETS, POSTURE_WORDS, STYLES, SEXES, TONES } from "./person-words.ts";

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
const touchscreenAlias = new RegExp(`\\b(?:${TOUCHSCREEN_NAMES.join("|")})\\b`, "g");
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

const adjustmentRef = (a: Adjustment): TargetRef => ({ kind: "adjustment", id: a.key, label: a.name });
function rankAdjustments(asset: AssetInfo, text: string) {
  const q = norm(text).replace(touchscreenAlias, "touchscreen"), id = text.trim().toLowerCase();
  const words = tokens(q).filter((w) => !STOP.has(w));
  return adjustments(asset).flatMap((a) => {
    if (a.key.toLowerCase() === id || a.joint.id.toLowerCase() === id) return [{ a, score: 100 }];
    if (/^j_[a-z0-9_:]+$/.test(id)) return [];
    const scores = words.map((w) => a.main.has(w) ? 3 : a.extra.has(w) ? 1 : [...a.main].some((t) => w.length >= 4 && t.startsWith(w)) ? 2 : 0);
    const score = scores.reduce<number>((x, y) => x + y, 0);
    if (a.phrases.has(q)) return [{ a, score: score + 6 }];
    return scores.length && scores.every(Boolean) ? [{ a, score: score + 2 }] : [];
  }).sort((x, y) => y.score - x.score);
}

/** Resolve the exact write target, refusing incomplete matches and close alternatives. */
export function resolveAdjustment(asset: AssetInfo, text: string): Adjustment {
  const scored = rankAdjustments(asset, text), [best, next] = scored;
  if (!best) throw new Refusal("unknown_target", `nothing adjustable matches ${JSON.stringify(text)}`, 'Use discover {"query":"...","kind":"adjustment"}, e.g. "monitor height" or "backrest".');
  if (next && best.score - next.score < 2) {
    const near = scored.filter(({ score }) => score >= best.score - 1).slice(0, 6).map(({ a }) => adjustmentRef(a));
    throw new Refusal("ambiguous", `${JSON.stringify(text)} could be ${near.map((a) => `"${a.label}" (${a.id})`).join(" or ")}`, "ask which one is meant or give its ID", undefined, near);
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
  // the person's words (person.ts): presets, styles, sexes, tones, postures, the report's parts, the packages' preset and pose names
  for (const w of [...Object.keys(PRESETS), ...Object.keys(POSTURE_WORDS), ...STYLES, ...SEXES, ...TONES, "person", "woman", "man", "glasses", "headset", "cap", "eye", "sight", "reach", "clearance", "all", "clear", "body", "stature", "mass", "aims", "point", "touch", "grip", "rest", "pedal", "floor"]) add(w);
  for (const pkg of Object.values(asset.people?.packages ?? {})) {
    for (const pr of pkg.manifest.shape?.presets ?? []) add(pr.name);
    for (const po of pkg.manifest.poses ?? []) add(`${po.id ?? ""} ${po.name ?? ""}`.replace(/_/g, " "));
    for (const c of pkg.manifest.shape?.controls ?? []) add(c.id.replace(/_/g, " "));
  }
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
  if (e.person) parts.push(`person: ${sayPersonOrNobody(e.person.after)}`);
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
const xyz: Schema = { type: "array", items: { type: "number", unit: "m" }, minItems: 3, maxItems: 3 };
const where: Schema = { anyOf: [
  { ...xyz, description: "a point in the model frame, metres: x forward (toward the main monitor), y to the operator's left, z up, origin at the centre of the deck's top" },
  { type: "string", maxLength: 80, description: "a reference point, screen or part by name (a part means its middle): \"median eye\", \"monitor screen\", \"seat\", \"right pedal\"" },
  { type: "object", required: ["point"], properties: { point: { type: "string", maxLength: 80 }, offset: { ...xyz, description: "metres added in the model frame (x forward, y left, z up)" } }, description: "a named point moved by an offset" },
] };
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
  if (asset.manifest.groups.includes(text) || asset.manifest.components.some((c) => c.id === text) || asset.manifest.surfaces.some((c) => c.id === text)) return text;
  if (Object.hasOwn(GROUP_WORDS, q)) return GROUP_WORDS[q];
  const unit = UNITS.find((u) => norm(u.name) === q);
  if (unit) return unit.parts[0];
  if (/^[CDSJ]_[A-Za-z0-9_]+$/i.test(text.trim())) throw new Refusal("unknown_target", `no part has ID ${JSON.stringify(text)}`, "Search for the part with discover.");
  const hits = rankTargets(asset, text, ["part"], true);
  const same = hits.filter((h) => norm(h.label.replace(/\s*\([^)]*\)/g, "")) === q);
  const candidates = same.length ? same : hits.filter((h) => h.score === hits[0].score);
  if (candidates.length === 1) return candidates[0].id;
  if (!candidates.length) throw new Refusal("unknown_target", `no part matches ${JSON.stringify(text)}`, 'Use discover {"query":"...","kind":"part"} or give a group ID.');
  throw new Refusal("ambiguous", `${JSON.stringify(text)} could be ${candidates.slice(0, 6).map((h) => `"${h.label}" (${h.id})`).join(" or ")}`, "ask which one is meant or give its ID", undefined, targetRefs(candidates));
}

const DISCOVERY_LIMIT = 10;
type DiscoveryKind = TargetRef["kind"] | "operation";
const wireNames = (spec: Pick<CommandSpec, "id" | "kind" | "tool">) =>
  ({ id: spec.id, kind: "operation" as const, effect: spec.kind, ...(spec.tool ? { tool: spec.tool } : {}) });

const discovery: CommandSpec<{ query?: string; kind?: DiscoveryKind }> = {
  id: "discover", kind: "query", tool: "discover",
  summary: "Find the connected workspace, rig, live routing counts, and available tools, or search for exact IDs to use in commands. Use kind to focus a search. An exact operation ID returns its argument schema.",
  args: { type: "object", additionalProperties: false, properties: {
    query: { type: "string", maxLength: 160, description: "Target words or exact ID. Omit for the workspace overview." },
    kind: { type: "string", enum: ["adjustment", "part", "datum", "joint", "group", "operation"], description: "Focus on one class of match." },
  } },
  examples: [
    { args: {}, note: "workspace and tools" },
    { args: { query: "seat", kind: "adjustment" }, note: "find seat controls" },
    { args: { query: "person.pose", kind: "operation" }, note: "get one HTTP command schema" },
  ],
  run({ doc, asset, scope }, a) {
    const query = a.query?.trim();
    if (!query) {
      if (a.kind) throw new Refusal("invalid_args", "discover: kind needs a query", 'Try {"query":"monitor","kind":"adjustment"}.');
      const toolsHere = tools().map(wireNames);
      return { result: {
        workspace: scope?.workspace ?? null,
        asset: { name: asset.name, title: asset.manifest.title, glbSha256: asset.sha256 },
        person: { supported: !!asset.people, present: doc.person !== null },
        viewers: scope?.viewers ?? null,
        tools: toolsHere,
        workspaceIndex: "/api/workspaces",
      } };
    }

    const op = get(query);
    if (op && (!a.kind || a.kind === "operation")) {
      return { result: { query, matches: [{ ...wireNames(op), description: op.summary, args: toJsonSchema(op.args), examples: op.examples }], more: false } };
    }

    const refs: { score: number; match: object }[] = [];
    if (!a.kind || a.kind === "adjustment") {
      for (const { a: adj, score } of rankAdjustments(asset, query)) {
        const scale = adj.unit === "m" ? 1 : 1 / DEG;
        refs.push({ score, match: { ...adjustmentRef(adj), unit: adj.unit === "m" ? "m" : "deg",
          min: adj.lo * scale, max: adj.hi * scale, value: value(adj, doc.pose) * scale, evidence: adj.evidence, assumed: adj.assumed } });
      }
    }
    if (!a.kind || ["part", "datum", "joint"].includes(a.kind)) {
      const alias = pointAlias(asset, query);
      for (const hit of rankTargets(asset, alias ?? query, a.kind ? [a.kind] : ["part", "datum"], true)) {
        refs.push({ score: hit.score, match: { id: hit.id, kind: hit.kind, label: hit.label } });
      }
    }
    if (!a.kind || a.kind === "group") {
      const group = Object.hasOwn(GROUP_WORDS, norm(query)) ? GROUP_WORDS[norm(query)] : norm(query);
      if (asset.manifest.groups.includes(group)) refs.push({ score: 7, match: { id: group, kind: "group", label: rowName(group, group) } });
    }
    if (a.kind === "operation") {
      const terms = tokens(query);
      for (const spec of list()) {
        const words = new Set(tokens(`${spec.id} ${spec.summary}`));
        if (terms.length && terms.every((word) => words.has(word))) refs.push({ score: 1, match: wireNames(spec) });
      }
    }
    refs.sort((a, b) => b.score - a.score);
    return { result: { query, matches: refs.slice(0, DISCOVERY_LIMIT).map(({ match }) => match), more: refs.length > DISCOVERY_LIMIT } };
  },
};


const intent: CommandSpec[] = [
  discovery,
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
      const pl = plan.person ? personChangeLine(plan.person.before, plan.person.after) : null;
      const lines = [...changeLines(asset, plan.changes), ...(pl ? [pl] : [])];
      return { result: { text: [`Undid ${about}:`, ...lines].join("\n"), undid: plan.undoes, lines, also_moved: movedLines(asset, pose, new Set(plan.changes.map((c) => c.joint))) }, changes: plan.changes, person: plan.person, joints: [...plan.changes.map((c) => c.joint), ...(plan.person ? ["person"] : [])], undoes: plan.undoes };
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
    run({ doc, asset, scope }, a: { detail?: string }) {
      if (a.detail === "catalogue") return { result: { text: [`${asset.manifest.title ?? asset.name}: every adjustment (lengths from as photographed; angles as the joint gives them)`, ...catalogue(asset)].join("\n") } };
      const moved = movedLines(asset, doc.pose), recent = doc.history.slice(a.detail === "history" ? -20 : -3).reverse();
      return {
        result: {
          text: [
            `${asset.manifest.title ?? asset.name}, scene version ${doc.version}.`,
            moved.length ? `Moved from as photographed: ${moved.join("; ")}.` : "Everything is as photographed.",
            ...(asset.people ? [`In the seat: ${sayPersonOrNobody(doc.person)}.`] : []),
            recent.length ? `Last changes:\n${recent.map((e) => `  ${entryWords(asset, e)} (${ago(e.at)})`).join("\n")}` : "No changes yet.",
          ].join("\n"),
          ...(scope ? { workspace: scope.workspace } : {}), version: doc.version, moved, ...(asset.people ? { person: doc.person } : {}), recent: recent.map((e) => ({ version: e.version, by: e.actor.label, ...(e.group && /-\d+$/.test(e.group) ? { request: e.group } : {}), at: e.at })),
        },
      };
    },
  },
  {
    id: "measure", kind: "query", tool: "measure",
    summary: "The distance between two points named in plain words or ids (\"median eye\" to \"monitor screen\"), at the current pose: a point estimate between frame origins, at the sizes estimated from photographs; no range yet. With person instead: what the person in the seat sees and reaches, from its solved pose (eye, sight lines with the gaze cone, reach to the grips, clearances), every number with its unit and source.",
    args: { type: "object", properties: { from: { type: "string", maxLength: 80, description: "a reference point, screen or part: \"median eye\", \"small eye\", \"right grip\", \"D_eye_median\"" }, to: { type: "string", maxLength: 80, description: "e.g. \"monitor screen\", \"touchscreen\", \"S_mon_screen\"" },
      person: { type: "string", enum: ["eye", "sight", "reach", "clearance", "aims", "all"], description: "measure the person in the seat instead: eye (both eyes), sight (both screens: distance, angle below the eye, off the screen normal, gaze cone), reach (each grip, share of the arm's length), clearance (thighs to the grip mounts, knee crease to the seat front, hips to the pods, head to the frame, feet to the pedals), aims (gaze and named limb targets), all" } } },
    examples: [{ args: { from: "median eye", to: "monitor screen" }, note: "viewing distance of a median adult" }, { args: { person: "sight" }, note: "the screens from the eye of the person in the seat" }],
    run(ctx, a: { from?: string; to?: string; person?: string }) {
      if (a.person !== undefined) {
        if (a.from !== undefined || a.to !== undefined) throw new Refusal("invalid_args", "measure: give from and to, or person, not both", "e.g. {\"person\": \"sight\"} or {\"from\": \"median eye\", \"to\": \"monitor screen\"}");
        return get("person.report")!.run!(ctx, { what: a.person });
      }
      if (a.from === undefined || a.to === undefined) throw new Refusal("invalid_args", "measure: give from and to (or person)", "e.g. {\"from\": \"median eye\", \"to\": \"monitor screen\"} or {\"person\": \"all\"}");
      const from = resolvePoint(ctx.asset, a.from), to = resolvePoint(ctx.asset, a.to);
      const r: any = get("measure.distance")!.run!(ctx, { from, to }).result;
      const short = (l: string) => l.replace(/\s*\([^)]*\)/g, "");
      return { result: { text: `${short(r.from.label)} → ${short(r.to.label)}: ${r1(r.distance_m * 100)} cm. A point estimate between the two frame origins, at the sizes estimated from photographs and assumptions; no range yet (scene version ${r.at_version}).`, ...r } };
    },
  },
  {
    id: "look", kind: "view", tool: "look", sessionOptional: true,
    summary: "One browser's view in one call: a named view (operator's eye, overview, front, back, left, right, top, front corner); the operator's view from the eye of a person of a given stature or sitting eye height (eye; with a person in the seat, the operator's view and a stature use its solved eye); the camera anywhere (camera: at and look_at as model-frame metres, or point names with an offset); what it shows (only, hide, all); what is selected; and with picture: true an image of the result. Locally without a viewer code it goes to every open page; on the public sandbox to the browser whose code it names, or to browsers that follow this agent. Changes nothing in the scene.",
    args: { type: "object", properties: { view: { type: "string", maxLength: 40, description: "operator (the operator's eye), overview, front, back, left, right, top, front corner" },
      eye: { type: "object", properties: { stature_cm: { type: "number", unit: "cm", minimum: 100, maximum: 230, description: "standing height of the person in the seat; with a person shown, that person's body at this stature and its solved eye, otherwise an assumed share of stature" }, sitting_eye_height_cm: { type: "number", unit: "cm", minimum: 50, maximum: 110, description: "eye height above the seat surface" }, person: { type: "string", enum: ["small", "median", "large"], description: "the model's three eye points: a small woman (5th percentile), a median adult, a tall man (95th percentile)" } }, description: "the operator's view from the eye of this person (one of the three); it moves with the seat" },
      camera: { type: "object", required: ["at"], properties: { at: where, look_at: where, fov: { type: "number", unit: "deg", minimum: 10, maximum: 120, description: "vertical field of view, default 50" } }, description: "the camera anywhere: where it is and what it looks at (default: the middle of the rig)" }, only: { ...words, description: "show only these groups or parts: \"stand\", \"seat\", \"monitor\", \"left joystick\"" }, hide: { ...words, description: "hide these groups or parts" }, all: { type: "boolean", description: "show everything again" }, select: { type: "string", maxLength: 80, description: "select a part or group, as a click would (its card opens)" }, picture: { type: "boolean", description: "return a picture of the browser's view after the change" } } },
    examples: [
      { args: { view: "operator", picture: true }, note: "the operator's view, and a picture of it" },
      { args: { eye: { stature_cm: 180 }, picture: true }, note: "the operator's view at the eye height of a person 180 cm tall" },
      { args: { camera: { at: { point: "seat", offset: [-1.2, 0.4, 1.0] }, look_at: "monitor screen" } }, note: "a camera 1.2 m behind, 0.4 m left of and 1 m above the seat, looking at the screen" },
      { args: { only: ["stand", "seat"] }, note: "only the monitor stand and the seat" },
    ],
    run({ doc, asset }, a: { view?: string; eye?: { stature_cm?: number; sitting_eye_height_cm?: number; person?: string }; camera?: { at: unknown; look_at?: unknown; fov?: number }; only?: string | string[]; hide?: string | string[]; all?: boolean; select?: string; picture?: boolean }) {
      const out: Record<string, unknown> = {}, said: string[] = [], nameOf = (x: string) => (asset.manifest.groups.includes(x) ? rowName(x, x) : labelOf(asset, x));
      if (a.view !== undefined && a.eye === undefined && a.camera === undefined) {
        const w = norm(a.view).replace(/^the /, ""), v = VIEW_NAMES.includes(a.view) ? a.view : Object.hasOwn(VIEW_WORDS, w) ? VIEW_WORDS[w] : undefined;
        if (!v) throw new Refusal("invalid_args", `look: ${JSON.stringify(a.view)} is not a view`, `one of: operator, overview, front, back, left, right, top, front corner`);
        out.view = v;
        const pe = v === "operator" ? personEye(asset, doc) : null;          // a person in the seat (operating): its own eye
        if (pe) { out.eye_point = pe.point; out.follow_person = true; if (pe.direction) out.eye_direction = pe.direction; said.push(`the operator's eye view from the eye of ${pe.who}`); }
        else said.push(v === "operator" ? `the operator's eye view${doc.person && asset.people ? " (from the rig's median eye point: the person in the seat is not in the operating posture)" : ""}` : `the ${v.replace("_", " ")} view`);
      }
      if (a.eye !== undefined && a.camera !== undefined) throw new Refusal("invalid_args", "look: give eye or camera, not both", "eye puts the camera at a person's eye in the seat; camera puts it anywhere");
      if (a.eye !== undefined) {
        const P = asset.manifest.parameters, val = (k: string) => P[k]?.value as number | undefined, hm = val("seat.eye_height_median");
        const e = a.eye, given = [e.stature_cm, e.sitting_eye_height_cm, e.person].filter((x) => x !== undefined).length;
        if (given !== 1 || hm === undefined) throw new Refusal("invalid_args", "look eye: give exactly one of stature_cm, sitting_eye_height_cm or person", "e.g. {\"eye\": {\"stature_cm\": 180}}");
        let h: number, who: string;
        if (e.person !== undefined) { h = val(`seat.eye_height_${e.person}`)!; who = { small: "a small woman (5th percentile)", median: "a median adult", large: "a tall man (95th percentile)" }[e.person]!; }
        else if (e.sitting_eye_height_cm !== undefined) { h = e.sitting_eye_height_cm / 100; who = `a person with a sitting eye height of ${r1(e.sitting_eye_height_cm)} cm`; }
        else { const ratio = val("seat.eye_height_per_stature")!; h = (e.stature_cm! / 100) * ratio; who = `a person ${r1(e.stature_cm!)} cm tall (sitting eye height about ${r1(h * 100)} cm: ${ratio} of stature, an assumed ratio)`; }
        // with a person in the seat (operating), a stature means that person's body at that stature, its eye from the solve
        const pe = e.stature_cm !== undefined ? personEye(asset, doc, { stature_mm: e.stature_cm * 10 }) : null;
        out.view = "operator";
        if (pe) {
          out.eye_point = pe.point; if (pe.direction) out.eye_direction = pe.direction; out.eye = Math.round(pe.above_cushion_m * 1e4) / 1e4;
          said.push(`the operator's view from the eye of ${pe.who} (its solved pose: ${r1(pe.above_cushion_m * 100)} cm above the cushion, from the person's shape space, not a ratio); it moves with the seat`);
        } else {
          const d = r1((h - hm) * 100);
          out.eye = Math.round(h * 1e4) / 1e4;
          said.push(`the operator's view from the eye of ${who}, ${d === 0 ? "at" : `${Math.abs(d)} cm ${d > 0 ? "above" : "below"}`} the median eye point along the torso line; it moves with the seat`);
        }
      }
      if (a.camera !== undefined) {
        const w = worldFrames(asset.nodes, doc.pose), rest = worldFrames(asset.nodes, {}), round = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
        // a part means its middle (the box around it and everything under it), moved as its frame has moved from the
        // photographed pose; a reference point or a screen is the point itself
        const parts = [...asset.manifest.components, ...asset.manifest.surfaces];
        const middle = (id: string): number[] => {
          const c = parts.find((x) => x.id === id);
          if (!c || id.startsWith("S_")) return w[id].t;
          const under = (x: { id: string; parent: string | null }): boolean => x.id === id || (x.parent !== null && under(parts.find((p) => p.id === x.parent) ?? { id: "", parent: null }));
          const boxes = parts.filter((x) => x.bbox && under(x)).map((x) => x.bbox!);
          if (!boxes.length) return w[id].t;
          const lo = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k]))), hi = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k])));
          return lo.map((x, k) => (x + hi[k]) / 2 + w[id].t[k] - rest[id].t[k]);
        };
        const point = (p: any, what: string): { v: number[]; said: string } => {
          if (Array.isArray(p)) {
            if (p.some((x) => !Number.isFinite(x) || Math.abs(x) > 10)) throw new Refusal("invalid_args", `look camera ${what}: coordinates must be metres within 10 m of the deck`, "x forward, y to the operator's left, z up, origin at the centre of the deck's top");
            return { v: p, said: `(${p.map((x: number) => r1(x * 100) / 100).join(", ")}) m` };
          }
          const name = typeof p === "string" ? p : p?.point, id = resolvePoint(asset, name), base = middle(id), off: number[] = typeof p === "object" && Array.isArray(p.offset) ? p.offset : [0, 0, 0];
          const label = labelOf(asset, id).replace(/\s*\([^)]*\)/g, "");
          return { v: base.map((x, i) => x + (off[i] ?? 0)), said: off.some((x) => x) ? `${label} + (${off.map((x) => r1(x * 100) / 100).join(", ")}) m` : label };
        };
        const at = point(a.camera.at, "at"), bb = asset.manifest.totals.bbox;
        const to = a.camera.look_at !== undefined ? point(a.camera.look_at, "look_at") : { v: bb.min.map((x: number, i: number) => (x + bb.max[i]) / 2), said: "the middle of the rig" };
        if (Math.hypot(...at.v.map((x, i) => x - to.v[i])) < 0.02) throw new Refusal("invalid_args", "look camera: at and look_at are the same point", "look at something else, or move the camera away from it");
        out.camera = [...round(at.v), ...round(to.v), a.camera.fov ?? 50];
        said.push(`the camera at ${at.said}, looking at ${to.said}`);
      }
      if (a.all) { out.all = true; said.push("everything shown"); }
      const only = asList(a.only)?.map((x) => resolvePart(asset, x)), hide = asList(a.hide)?.map((x) => resolvePart(asset, x));
      if (only) { out.only = only; said.push(`only ${only.map(nameOf).join(", ")}`); }
      if (hide) { out.hide = hide; said.push(`hidden: ${hide.map(nameOf).join(", ")}`); }
      if (a.select !== undefined) { const s = resolvePart(asset, a.select); out.select = s; said.push(`${nameOf(s)} selected`); }
      if (a.picture) out.picture = true;
      if (!Object.keys(out).length) throw new Refusal("invalid_args", "look: give a view, only, hide, all, select or picture", "e.g. {\"view\": \"operator\", \"picture\": true}");
      return { result: { text: said.length ? `Requested ${said.join("; ")}.` : "Requested a picture of the current browser view." , ...out }, view: out };
    },
  },
];
for (const c of intent) register(c);
for (const c of personCommands) register(c);
