// The commands of step 1, and the one function that runs a command against the scene document
// (`runCommand`, used by the server and by the tests). Units at this interface are the ones the `pose=`
// link uses: degrees for revolute joints and for each angle of a three-angle mount, metres for
// prismatic joints and for every distance. The document stores SI (doc.ts).
//
//   scene.summary   what is open, what is moved, the recent changes (with version, who, group)
//   scene.find      plain words -> ranked ids with labels (parts, joints, datums)
//   pose.set        set joints (limits from the description file; assumed adjustments only on request)
//   history.undo    revert one entry (by version) or the whole of a request (by group), as a new entry
//   measure.distance  distance between two frames at the current pose (a point estimate)
//   view.set / view.show / view.select  carried out by the browser whose session code they name
//
// Routing values travel at the request level only, never inside `args`: `session` (the browser a view
// command is for), `group` (the request a change belongs to) and `expectedVersion` (the version a change
// is based on). Names of parts and adjustments come from shared/words.ts, as on the page.
//
// The person's commands (person.set, person.pose, person.clear, person.report and the intent tool `person`) are in
// person.ts (manikin v1).
import { register, get, validate, type AssetInfo, type CommandSpec, type RuntimeScope } from "./registry.ts";
import { apply, planUndo, GROUP_PATTERN, HISTORY_CAP, PERSON_KEY, type Actor, type Entry, type JointChange, type SceneDoc } from "./doc.ts";
import { Refusal, type CommandError, type Schema, type TargetRef } from "./schema.ts";
import { nodesFromGlb, worldFrames } from "../kinematics.ts";
import { limitViolation, type JointValue } from "../pose.ts";
import type { Manifest, ManifestJoint } from "../manifest.ts";
import { adjWords, jointName, partName, sayJoint, TOUCHSCREEN_NAMES } from "../words.ts";
import { sayPerson } from "./person-words.ts";

const DEG = Math.PI / 180;
/** Session codes of browser viewers: eight characters without look-alikes (no I, L, O, 0, 1). */
export const SESSION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const SESSION_PATTERN = "^[A-HJKMNP-Z2-9]{8}$";
/** The named views of the viewer (viewer/src/engine.ts, VIEWS); a unit test keeps the two lists equal. */
export const VIEW_NAMES = ["three_quarter", "front", "rear", "left", "right", "top", "front_quarter", "operator"];
const RECENT = 10;

// ------------------------------------------------------------------------------------------- the asset
/** The asset as the commands need it, from its description file and its GLB. */
export function assetFromFiles(manifest: Manifest, glb: Uint8Array): AssetInfo {
  return { name: manifest.asset, sha256: manifest.glb.sha256, manifest, nodes: nodesFromGlb(glb), joints: new Map(manifest.joints.map((j) => [j.id, j])) };
}

/** An adjustment nobody has seen in the photos: its existence and range are assumed (same rule as the viewer). */
export const isAssumed = (j: ManifestJoint) => j.evidence === "assumed" || j.locked;
export const unitOf = (j: ManifestJoint) => (j.type === "prismatic" ? "m" : "deg");
const round = (x: number, unit: string) => (unit === "m" ? Math.round(x * 1e6) / 1e6 : Math.round(x * 1e4) / 1e4);
/** A value as the commands give it (degrees or metres), from SI. */
export function fromSI(j: ManifestJoint, v: JointValue | null): JointValue | null {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map((x) => round(x / DEG, "deg"));
  return j.type === "prismatic" ? round(v, "m") : round(v / DEG, "deg");
}
export const toSI = (j: ManifestJoint, v: JointValue): JointValue => (Array.isArray(v) ? v.map((x) => x * DEG) : j.type === "prismatic" ? v : v * DEG);

/** Abbreviations in ids, for searching (the names themselves come from shared/words.ts). */
const WORDS: Record<string, string> = { mon: "monitor", ts: "touchscreen", joy: "joystick", pod: "armrest", estop: "emergency stop", L: "left", R: "right" };
/** The page's name of a joint, part or datum ("Monitor: height", "Monitor", or the datum's label). */
export function labelOf(asset: AssetInfo, id: string): string {
  const j = asset.joints.get(id);
  if (j) return jointName(j);
  const c = [...asset.manifest.components, ...asset.manifest.surfaces].find((x) => x.id === id);
  if (c) return partName(c).full;
  return asset.manifest.datums.find((x) => x.id === id)?.label ?? id;
}

/** One joint described for an agent: label, unit, neutral and travel in command units, evidence. */
export function describeJoint(asset: AssetInfo, j: ManifestJoint) {
  const unit = unitOf(j), ball = j.type === "ball", neutral = fromSI(j, j.neutral);
  const lo = ball ? round(j.lower / DEG, "deg") : (fromSI(j, j.lower) as number), hi = ball ? round(j.upper / DEG, "deg") : (fromSI(j, j.upper) as number);
  return {
    id: j.id, label: jointName(j), ...(ball ? { angles: adjWords(j).map((w) => w.label.toLowerCase()) } : {}), type: ball ? "three-angle mount [roll, pitch, yaw]" : j.type, unit, neutral,
    ...(ball ? { each_angle_from_neutral: [lo, hi] } : { min: lo, max: hi }),
    travel: ball ? `each angle ${lo} … ${hi} deg from neutral ${JSON.stringify(neutral)}` : `${lo} … ${hi} ${unit} (neutral ${neutral})`,
    evidence: j.evidence, assumed: isAssumed(j), moves: labelOf(asset, j.child),
  };
}

export function sameSI(a: JointValue, b: JointValue) { return Array.isArray(a) ? (a as number[]).every((x, i) => Math.abs(x - (b as number[])[i]) < 1e-6) : Math.abs(a - (b as number)) < 1e-6; }
export function showChange(asset: AssetInfo, c: JointChange) {
  const j = asset.joints.get(c.joint);
  if (!j) return { joint: c.joint, label: c.joint, before: c.before, after: c.after, unit: "SI (joint no longer in the asset)" };
  return { joint: c.joint, label: jointName(j), before: fromSI(j, c.before), after: fromSI(j, c.after), unit: unitOf(j), ...(c.after !== null ? { said: sayJoint(j, c.after) } : {}) };
}
export const showEntry = (asset: AssetInfo, e: Entry) => ({
  version: e.version, by: e.actor.label, actor_kind: e.actor.kind, ...(e.group ? { group: e.group } : {}), command: e.command, at: e.at,
  ...(e.undoes ? { undoes: e.undoes } : {}), changes: e.changes.map((c) => showChange(asset, c)),
  ...(e.person ? { person: { before: e.person.before ? sayPerson(e.person.before) : "nobody", after: e.person.after ? sayPerson(e.person.after) : "nobody" } } : {}),
});

// ------------------------------------------------------------------------------------------- scene.find
type Candidate = TargetRef & { main: Set<string>; extra: Set<string> };
export const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
export const idTokens = (id: string) => tokens(id.replace(/^[CJDS]_/, "").split("_").map((x) => (Object.hasOwn(WORDS, x) ? WORDS[x] : x)).join(" "));
const STOP = new Set(["the", "a", "an", "of", "to", "and", "in", "on", "at", "for", "with", "by", "from", "me", "my", "its", "it", "show", "set", "move", "make", "please", "cm", "mm", "deg", "degrees", "s"]);
/** Everyday words that point at a word of the model's vocabulary. */
const ALSO: Record<string, string[]> = {
  lower: ["height"], raise: ["height"], higher: ["height"], up: ["height"], down: ["height"], turn: ["pan", "swivel"], rotate: ["pan", "swivel"],
  forward: ["slide", "tray"], backward: ["slide", "tray"], lean: ["recline", "tilt"], display: ["monitor", "screen"], screen: ["display", "monitor"],
  operator: ["eye"], view: ["eye"], stick: ["joystick"], chair: ["seat"], foot: ["pedal"], backrest: ["back", "recline"],
};
const indexes = new WeakMap<AssetInfo, Candidate[]>();
function index(asset: AssetInfo): Candidate[] {
  let ix = indexes.get(asset);
  if (ix) return ix;
  const m = asset.manifest, motion: Record<string, string> = { prismatic: "slide move", revolute: "turn angle", ball: "mount angle tilt turn lean" };
  ix = [
    ...m.joints.map((j) => ({ id: j.id, kind: "joint" as const, label: jointName(j), main: new Set([...idTokens(j.id), ...adjWords(j).flatMap((w) => tokens(`${w.section} ${w.label}`))]), extra: new Set([...tokens(labelOf(asset, j.child)), ...tokens(motion[j.type])]) })),
    ...[...m.components, ...m.surfaces].map((c) => ({ id: c.id, kind: "part" as const, label: partName(c).full, main: new Set([...tokens(partName(c).full), ...tokens(c.label.replace(/\([^)]*\)/g, "")), ...idTokens(c.id)]), extra: new Set([...tokens(c.label), ...(c.group ? [c.group] : []), ...c.tags.flatMap(tokens)]) })),
    ...m.datums.map((d) => ({ id: d.id, kind: "datum" as const, label: d.label, main: new Set([...tokens(d.label.replace(/\([^)]*\)/g, "")), ...idTokens(d.id)]), extra: new Set(tokens(d.label)) })),
  ];
  indexes.set(asset, ix);
  return ix;
}
/** Ranked matches for plain words: whole words of the name count most, then related everyday words, then word starts, then details. */
export function rankTargets(asset: AssetInfo, text: string, kinds?: string[], requireAll = false) {
  const q = tokens(text).filter((w) => !STOP.has(w));
  const exact = text.trim().toLowerCase();
  const scored = index(asset).filter((c) => !kinds || kinds.includes(c.kind)).map((c) => {
    if (c.id.toLowerCase() === exact) return { c, score: 100 };
    let score = 0, all = q.length > 0;
    for (const w of q) {
      const s = c.main.has(w) ? 3 : (Object.hasOwn(ALSO, w) ? ALSO[w] : []).some((x) => c.main.has(x)) ? 2 : [...c.main].some((t) => w.length >= 3 && (t.startsWith(w) || (t.length >= 4 && w.startsWith(t)))) ? 2 : c.extra.has(w) ? 1 : 0;
      score += s; if (!s) all = false;
    }
    if (requireAll && !all) return { c, score: 0 };
    // an alias (a second name for the same point) ranks just below the point itself
    return { c, score: score + (all ? 2 : 0) - (score && /\balias of\b/.test(c.label) ? 1 : 0) };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.c.label.length - b.c.label.length);
  return scored.map(({ c, score }) => ({ id: c.id, kind: c.kind, label: c.label, score }));
}
export function findIds(asset: AssetInfo, text: string, kind?: string, limit = 10) {
  return rankTargets(asset, text, kind ? [kind] : undefined).slice(0, limit)
    .map((ref) => ref.kind === "joint" ? { ...ref, joint: describeJoint(asset, asset.joints.get(ref.id)!) } : ref);
}
export function targetRefs(matches: TargetRef[], limit = 6): TargetRef[] {
  return matches.slice(0, limit).map(({ id, kind, label }) => ({ id, kind, label }));
}

// ------------------------------------------------------------------------------------------- schemas
const jointValue: Schema = { anyOf: [{ type: "number", unit: "deg or m" }, { type: "array", items: { type: "number", unit: "deg" }, minItems: 3, maxItems: 3 }] };
const ids: Schema = { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9_]{1,64}$" }, minItems: 1, maxItems: 100 };

function refuseUnknownJoint(asset: AssetInfo, id: string): never {
  const near = findIds(asset, id.replace(/^J_/, "").replaceAll("_", " "), "joint", 3).map((x) => x.id);
  throw new Refusal("unknown_joint", `${id} is not a joint of ${asset.name}`, `${near.length ? `similar joints: ${near.join(", ")}; ` : ""}scene.find {"text": "...", "kind": "joint"} finds joints by plain words`);
}
export function checkId(asset: AssetInfo, id: string, what: string) {
  const known = asset.nodes.some((n) => n.name === id) || asset.manifest.groups.includes(id);
  if (!known) throw new Refusal("unknown_id", `${what} ${JSON.stringify(id)} is not a part, group, joint or datum of ${asset.name}`, `scene.find {"text": "..."} gives ids from plain words`);
}

export function pointAlias(asset: AssetInfo, text: string): string | undefined {
  if (TOUCHSCREEN_NAMES.includes(tokens(text).join(" ")) && asset.manifest.surfaces.some((s) => s.id === "S_ts_screen")) return "S_ts_screen";
}

/** Resolve the same rig vocabulary for measures, cameras and the person. */
export function resolvePoint(asset: AssetInfo, text: string, aim = false): string {
  const q = tokens(text.trim()).join(" ");
  const isAimTarget = (id: string) => /^[CDS]_/.test(id);
  const named = asset.nodes.find((n) => n.name.toLowerCase() === text.trim().toLowerCase())?.name;
  if (named && (aim ? isAimTarget(named) : /^[CDSJ]_/.test(named))) return named;
  const alias = pointAlias(asset, text);
  if (alias) return alias;

  if (/^[CDSJ]_[A-Za-z0-9_]+$/i.test(text.trim())) {
    throw new Refusal("unknown_target", `no eligible point has ID ${JSON.stringify(text)}`, 'Use discover {"query":"...","kind":"datum"} or search for a part.');
  }
  const hits = rankTargets(asset, text, ["part", "datum"], true);
  const exact = hits.filter((h) => tokens(h.label.replace(/\s*\([^)]*\)/g, "")).join(" ") === q);
  const candidates = exact.length ? exact : hits.filter((h) => h.score === hits[0].score);
  if (candidates.length === 1) return candidates[0].id;
  const names = (list: { label: string; id: string }[]) => list.slice(0, 4).map((h) => `"${h.label.replace(/\s*\([^)]*\)/g, "")}" (${h.id})`).join(", ");
  if (candidates.length) throw new Refusal("ambiguous", `${JSON.stringify(text)} could be ${names(candidates)}`, "name it more exactly, or give the ID", undefined, targetRefs(candidates, 4));
  const near = rankTargets(asset, q, ["part", "datum"]);
  const examples = index(asset).filter((h) => h.kind !== "joint");
  throw new Refusal("unknown_target", `no ${aim ? "part or point" : "point"} matches ${JSON.stringify(text)}`,
    `${near.length ? "Possible matches" : "Examples"}: ${names(near.length ? near : examples)}. discover lists names and IDs.`, undefined, targetRefs(near, 4));
}

// ------------------------------------------------------------------------------------------- commands
const commands: CommandSpec[] = [
  {
    id: "scene.summary", kind: "query",
    summary: "What is open: the asset, the scene version, every moved joint with its value and unit, and the recent changes (version, who, group, what changed).",
    args: { type: "object", properties: {} },
    examples: [{ args: {}, note: "start here, and read it again after a change to verify" }],
    run({ doc, asset, scope }) {
      const moved = [...asset.joints.values()].filter((j) => doc.pose[j.id] !== undefined && !sameSI(doc.pose[j.id], j.neutral)).map((j) => {
        const v = doc.pose[j.id], d = describeJoint(asset, j);
        const off = Array.isArray(v) ? v.map((x, i) => x - (j.neutral as number[])[i]) : (v as number) - (j.neutral as number);
        return { joint: j.id, label: d.label, value: fromSI(j, v), neutral: d.neutral, from_neutral: fromSI(j, off), unit: d.unit, assumed: d.assumed };
      });
      return {
        result: {
          scene: scope?.workspace.name ?? asset.manifest.title, ...(scope ? { workspace: scope.workspace } : {}), version: doc.version,
          asset: { name: asset.name, title: asset.manifest.title, sha256: asset.sha256.slice(0, 12), joints: asset.joints.size },
          units: "lengths in metres; angles in degrees (a three-angle mount is [roll, pitch, yaw]); the same units pose.set takes",
          frame: asset.manifest.conventions.frame,
          moved, note: moved.length ? undefined : "every joint is as photographed (neutral)",
          person: doc.person ? { ...doc.person, said: sayPerson(doc.person) } : null,
          recent: doc.history.slice(-RECENT).reverse().map((e) => showEntry(asset, e)),
          history: { kept: doc.history.length, cap: HISTORY_CAP, from_version: doc.history[0]?.version ?? null },
        },
      };
    },
  },
  {
    id: "scene.find", kind: "query",
    summary: "Find ids by plain words, ranked: parts (C_, S_), joints (J_, with unit, neutral, travel and evidence) and datums (D_, reference points such as eye points and grips).",
    args: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 200, description: "plain words, e.g. 'monitor height' or 'eye small'" }, kind: { type: "string", enum: ["part", "joint", "datum"] } } },
    examples: [{ args: { text: "monitor height" }, note: "the joint that raises and lowers the monitor" }, { args: { text: "eye", kind: "datum" }, note: "the eye points" }],
    run({ asset }, a: { text: string; kind?: string }) {
      const found = findIds(asset, a.text, a.kind);
      return { result: { matches: found, ...(found.length ? {} : { note: "nothing matched; try fewer or other words, or scene.summary" }) } };
    },
  },
  {
    id: "pose.set", kind: "edit",
    summary: "Set one or more joints: degrees for turning joints and for each angle of a three-angle mount ([roll, pitch, yaw], absolute), metres for sliding joints. Values outside the travel are refused; assumed adjustments only with allowAssumed. Recorded as one change. At the request level: group (bun run rig --group) and expectedVersion (--expected-version; refused as stale if one of these joints changed after it).",
    args: {
      type: "object", required: ["joints"],
      properties: {
        joints: { type: "object", additionalProperties: jointValue, propertyNames: { pattern: "^J_[A-Za-z0-9_]{1,60}$" }, description: "joint id -> value (absolute, not an offset)" },
        allowAssumed: { type: "boolean", description: "also move adjustments whose existence and range are assumed (not seen in the photos)" },
      },
    },
    examples: [
      { args: { joints: { J_mon_height: -0.03 } }, note: "monitor 3 cm below its photographed height (metres); send with --group lower-monitor" },
      { args: { joints: { J_mon_tilt: -5, J_mon_pan: 10 } }, note: "tilt and turn in degrees; with --expected-version 12 refused if either changed after version 12" },
      { args: { joints: { J_seat_slide: 0.05 }, allowAssumed: true }, note: "the seat slide is assumed (not seen in the photos)" },
    ],
    run({ doc, asset }, a: { joints: Record<string, JointValue>; allowAssumed?: boolean }) {
      const named = Object.keys(a.joints), changes: JointChange[] = [], notes: string[] = [];
      if (!named.length) throw new Refusal("invalid_args", "pose.set: name at least one joint", "e.g. {\"joints\": {\"J_mon_height\": -0.03}}");
      for (const [id, raw] of Object.entries(a.joints)) {
        const j = asset.joints.get(id);
        if (!j) refuseUnknownJoint(asset, id);
        if ((j.type === "ball") !== Array.isArray(raw)) throw new Refusal("invalid_args", `${id} is a ${j.type === "ball" ? "three-angle mount: give [roll, pitch, yaw] in degrees" : `${j.type} joint: give one number in ${unitOf(j) === "m" ? "metres" : "degrees"}`}`, `scene.find {"text": "${jointName(j)}"} describes the joint`);
        const v = toSI(j, raw), bad = limitViolation(j, v), d = describeJoint(asset, j);
        if (bad) {
          throw new Refusal("out_of_range", `${id} (${d.label}): ${JSON.stringify(raw)} ${d.unit} is outside its travel, ${d.travel}`, `choose a value inside the travel; values are absolute, not offsets${d.unit === "m" ? ", and in metres (3 cm = 0.03)" : ""}`);
        }
        if (isAssumed(j)) {
          if (!a.allowAssumed) throw new Refusal("assumed_joint", `${id} (${d.label}) is an assumed adjustment: nobody has seen it in the photos, so whether it exists and how far it goes are assumptions`, "ask the owner whether to use it; if yes, send the same command with \"allowAssumed\": true and say in your answer that the adjustment is assumed");
          notes.push(`${id} is an assumed adjustment (existence and travel not seen in the photos)`);
        }
        changes.push({ joint: id, before: doc.pose[id] ?? j.neutral, after: v });
      }
      return { result: { changes: changes.map((c) => showChange(asset, c)), ...(notes.length ? { notes } : {}) }, changes, joints: named };
    },
  },
  {
    id: "history.undo", kind: "edit",
    summary: "Undo one change (by version) or every change of a request (by group), as a new change. Refused as stale if a joint it would put back was changed again since.",
    args: { type: "object", properties: { version: { type: "integer", minimum: 1 }, group: { type: "string", pattern: GROUP_PATTERN } } },
    examples: [{ args: { group: "lower-monitor" }, note: "undo the whole request 'lower-monitor'" }, { args: { version: 7 }, note: "undo the change recorded as version 7 (scene.summary lists them)" }],
    run({ doc, asset }, a: { version?: number; group?: string }) {
      if ((a.version === undefined) === (a.group === undefined)) throw new Refusal("invalid_args", "history.undo: give exactly one of version or group", "e.g. {\"group\": \"lower-monitor\"} or {\"version\": 7}");
      const plan = planUndo(doc, a.version !== undefined ? { version: a.version } : { group: a.group! });
      for (const c of plan.changes) {
        const j = asset.joints.get(c.joint);
        if (!j || c.after === null) throw new Refusal("unknown_joint", `${c.joint} is no longer a joint of ${asset.name} (the asset was rebuilt), so this change cannot be put back`, "set the remaining joints with pose.set");
        if (limitViolation(j, c.after)) throw new Refusal("out_of_range", `the earlier value of ${c.joint} is outside its travel in the rebuilt asset`, "set a value inside the travel with pose.set");
      }
      return {
        result: { undid: plan.undoes, changes: plan.changes.map((c) => showChange(asset, c)), ...(plan.person ? { person: { before: plan.person.before ? sayPerson(plan.person.before) : "nobody", after: plan.person.after ? sayPerson(plan.person.after) : "nobody" } } : {}) },
        changes: plan.changes, person: plan.person, joints: [...plan.changes.map((c) => c.joint), ...(plan.person ? [PERSON_KEY] : [])], undoes: plan.undoes,
      };
    },
  },
  {
    id: "measure.distance", kind: "query",
    summary: "Distance in metres between two frames (parts, datums, surfaces, joint frames) at the current pose. A point estimate from the photo-estimated sizes; no range yet.",
    args: { type: "object", required: ["from", "to"], properties: { from: { type: "string", pattern: "^[CDSJ]_[A-Za-z0-9_]{1,60}$" }, to: { type: "string", pattern: "^[CDSJ]_[A-Za-z0-9_]{1,60}$" } } },
    examples: [{ args: { from: "D_eye_median", to: "S_mon_screen" }, note: "eye point of a median adult to the centre of the monitor's screen" }],
    run({ doc, asset }, a: { from: string; to: string }) {
      checkId(asset, a.from, "from"); checkId(asset, a.to, "to");
      const w = worldFrames(asset.nodes, doc.pose), p = w[a.from].t, q = w[a.to].t;
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], r = (x: number) => Math.round(x * 1e4) / 1e4;
      return {
        result: {
          from: { id: a.from, label: labelOf(asset, a.from), at: p.map(r) }, to: { id: a.to, label: labelOf(asset, a.to), at: q.map(r) },
          distance_m: r(Math.hypot(d[0], d[1], d[2])), delta_m: d.map(r), at_version: doc.version, status: "point estimate",
          note: "between the two frame origins (model frame: x forward, y to the operator's left, z up) at the current pose; a part's origin is its mount point, not its centre. The sizes behind it are estimates from photographs and assumptions; no range is computed in step 1.",
        },
      };
    },
  },
  {
    id: "view.set", kind: "view",
    summary: "Show a named view in one browser (session at the request level: bun run rig --viewer <code>): the operator's eye view, or overview, front, back, left, right, top, front corner.",
    args: { type: "object", required: ["view"], properties: { view: { type: "string", enum: VIEW_NAMES } } },
    examples: [{ args: { view: "operator" }, note: "what the operator sees, in the browser named with --viewer K7Q2XM4P" }],
    run(_ctx, a) { return { result: { view: a.view } }; },
  },
  {
    id: "view.show", kind: "view",
    summary: "Choose what one browser shows (--viewer <code>): only some parts or groups, hide some, or all again.",
    args: { type: "object", properties: { only: ids, hide: ids, all: { type: "boolean" } } },
    examples: [{ args: { only: ["stand", "seat"] }, note: "only the monitor stand and the seat" }, { args: { all: true }, note: "everything again" }],
    run({ asset }, a: { only?: string[]; hide?: string[]; all?: boolean }) {
      if (!a.only && !a.hide && !a.all) throw new Refusal("invalid_args", "view.show: give only, hide or all", "e.g. {\"only\": [\"stand\"]} with --viewer <code>");
      for (const id of [...(a.only ?? []), ...(a.hide ?? [])]) checkId(asset, id, "part");
      return { result: { shown: a.all ? "all" : a.only ?? "all but hidden", ...(a.hide ? { hidden: a.hide } : {}) } };
    },
  },
  {
    id: "view.select", kind: "view",
    summary: "Select a part or group in one browser (--viewer <code>), as a click would (its card opens).",
    args: { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^[A-Za-z0-9_]{1,64}$" } } },
    examples: [{ args: { id: "C_stand_monitor" }, note: "select the monitor" }],
    run({ asset }, a: { id: string }) { checkId(asset, a.id, "id"); return { result: { selected: a.id } }; },
  },
];
for (const c of commands) register(c);

// ------------------------------------------------------------------------------------------- running
/** A command as it arrives: POST api/command {id, args, expectedVersion?, group?, session?}. */
export interface WireCommand { id: unknown; args?: unknown; expectedVersion?: unknown; group?: unknown; session?: unknown }
export type Outcome =
  | { ok: true; version: number; result: unknown; entry?: Entry; view?: { session: string | null; id: string; args: Record<string, unknown> } }
  | { ok: false; version: number; error: CommandError };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** "backrest-recline" + version 21 -> "backrest-recline-21" (within the group pattern: [a-z0-9-], 40 characters) */
export function autoName(slug: string, version: number): string {
  const tail = `-${version}`, s = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "change";
  return s.slice(0, 40 - tail.length).replace(/-+$/, "") + tail;
}

/** Validate and run one command. Edits change `state.doc` in place and return the new entry; view commands
 *  return what to send to the addressed browser. Refusals come back as `{ok: false, error}`. */
export function runCommand(state: { doc: SceneDoc; asset: AssetInfo; scope?: RuntimeScope }, actor: Actor, wire: WireCommand): Outcome {
  const { doc, asset } = state, refuse = (e: CommandError): Outcome => ({ ok: false, version: doc.version, error: e });
  try {
    const checked = validate(wire.id, wire.args ?? {});
    if ("error" in checked) return refuse(checked.error);
    if (wire.group !== undefined && (typeof wire.group !== "string" || !new RegExp(GROUP_PATTERN).test(wire.group))) return refuse({ code: "invalid_args", message: `group ${JSON.stringify(wire.group)} does not match ${GROUP_PATTERN}`, hint: "lower-case letters, digits and dashes, e.g. lower-monitor" });
    if (wire.expectedVersion !== undefined && !(Number.isInteger(wire.expectedVersion) && (wire.expectedVersion as number) >= 0)) return refuse({ code: "invalid_args", message: "expectedVersion must be a whole number", hint: "the scene version from scene.summary" });
    const { spec } = checked;
    const hasSession = typeof wire.session === "string" && new RegExp(SESSION_PATTERN).test(wire.session);
    if (spec.kind === "view" && !hasSession && (!spec.sessionOptional || wire.session !== undefined)) return refuse({ code: "invalid_args", message: `${spec.id}: a view command needs the session code of its browser at the request level${wire.session === undefined ? "" : ` (expected an eight-character browser code)`}`, hint: "pass --viewer <code> with the browser code under Settings → Agent access" });
    const out = spec.run!({ doc, asset, actor, scope: state.scope }, checked.args);
    if (spec.kind === "query") return { ok: true, version: doc.version, result: out.result };
    if (spec.kind === "view") return { ok: true, version: doc.version, result: out.result, view: { session: hasSession ? (wire.session as string) : null, id: spec.id, args: (out.view ?? checked.args) as Record<string, unknown> } };
    const changes = out.changes ?? [];
    // a request name ending in -<number> is made by the server (intent commands), so nobody can claim one in advance
    if (typeof wire.group === "string" && /-\d+$/.test(wire.group)) return refuse({ code: "invalid_args", message: `group ${JSON.stringify(wire.group)}: names ending in -<number> are made by the server`, hint: "choose a name without a number at the end, e.g. lower-monitor" });
    const group = (wire.group as string | undefined) ?? (spec.autoGroup ? autoName(spec.autoGroup(checked.args, out), doc.version + 1) : undefined);
    const entry = apply(doc, { actor, command: spec.id, group, joints: out.joints ?? [...changes.map((c) => c.joint), ...(out.person ? [PERSON_KEY] : [])], changes, person: out.person, expectedVersion: wire.expectedVersion as number | undefined, undoes: out.undoes });
    let result = isObject(out.result) ? { ...out.result, ...(entry ? {} : { note: "no value changed; nothing recorded" }) } : out.result;
    if (spec.finish) result = spec.finish(result, { recorded: entry?.version ?? null, group: entry ? group : undefined });
    return { ok: true, version: doc.version, result, ...(entry ? { entry } : {}) };
  } catch (e) {
    if (e instanceof Refusal) return refuse(e.toError());
    throw e;
  }
}
