// The person in the seat (manikin v1, phase 3): commands that change it, a query that measures it, and one intent tool.
//
//   person.set     style (dressed, clay), sex, skin tone, glasses and headset on or off (the cap is always worn), a percentile
//                  preset (P5 woman, P50 man, P95 man) or any preset of the package, and body controls by their ids
//                  (stature mm, mass kg, the survey's r_* controls in SD); adds the default person when nobody is in the seat
//   person.pose    the posture: operating (the seated operator on the rig's own grips, pedals, seat and screens), relaxed stand,
//                  or a pose of the package's library by id or name
//   person.clear   nobody in the seat
//   person.report  eye point (both eyes), sight lines to both screens with the gaze cone, reach to each grip, clearances
//                  (thighs to the grip mounts, knee crease to the seat front, hips to the armrest pods, head to the frame, feet
//                  to the pedals): numbers with units and their sources, computed on the server (shared/person-model.ts)
//   person         the intent tool (MCP): any of set, posture and clear in one request, with the key numbers in its reply
//
// Same conventions as the pose commands (core.ts): validated arguments, the stale check (the person is one key, PERSON_KEY),
// undo by version and by request (history.undo, undo), the author made by the server, every change to every page on the
// live channel. The whole person is one value in the document (doc.ts PersonState); the page shows it through viewer.person
// (viewer/src/live.ts). Which fields need the browser: none of the numbers; the drawn person (its meshes, textures, idle
// motion and the mesh-level seat contact) is the page's.
import type { AssetInfo, CommandSpec, RunOutput } from "./registry.ts";
import { labelOf, resolvePoint } from "./core.ts";
import { modelAimReport } from "../../viewer/src/person/rig-binding.ts";
import type { PersonAims } from "../person-aims.ts";
import { Refusal, type Schema } from "./schema.ts";
import { PERSON_KEY, samePerson, type PersonState, type SceneDoc } from "./doc.ts";
import { PRESETS, POSTURE_WORDS, OPERATING, RELAXED_STAND, STYLES, SEXES, TONES, sayPerson } from "./person-words.ts";
import { bodyOf, controlValues, seat, ergonomics, QUERIES, type People, type PersonPackage, type Seated } from "../person-model.ts";
import type { JointValue } from "../pose.ts";

const r1 = (x: number) => Math.round(x * 10) / 10;
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// ------------------------------------------------------------------------------------------- packages
/** The package that draws a person: the dressed operator or the clay figure, of the person's sex (clay falls back to the
 *  dressed package's body: the same shape space and skeleton). */
export function packageOf(people: People, p: Pick<PersonState, "style" | "sex">): PersonPackage {
  const s = p.sex === "female" ? "f" : "m", want = `${p.style === "clay" ? "clay" : "operator"}-${s}`;
  const pkg = people.packages[want] ?? people.packages[`operator-${s}`];
  if (!pkg) throw new Refusal("no_person", `the server has no person package for a ${p.sex === "female" ? "woman" : "man"}`, "the release carries assets/manikin/operator-m and operator-f; ask the owner");
  return pkg;
}
/** stature and mass always, every other control only when it is not at its default */
export function compactBody(pkg: PersonPackage, given: Record<string, number>): Record<string, number> {
  const full = controlValues(pkg, given), out: Record<string, number> = {};
  for (const c of pkg.manifest.shape.controls) { const v = Math.round(full[c.id] * 1e4) / 1e4; if (c.id === "stature" || c.id === "mass" || Math.abs(v - (c.default ?? 0)) > 1e-9) out[c.id] = v; }
  return out;
}
const presetOf = (pkg: PersonPackage, name: string) => (pkg.manifest.shape.presets ?? []).find((p: any) => p.name === name);
/** The default person: the dressed operator, P50 man (the package's "Median man" exactly), light tone, glasses and headset on, operating. */
export function defaultPerson(packages: Record<string, PersonPackage>): PersonState | null {
  const pkg = packages["operator-m"]; if (!pkg) return null;
  const pr = presetOf(pkg, PRESETS["P50 man"].preset);
  return { style: "dressed", sex: "male", tone: pkg.manifest.tones?.default ?? "light", glasses: true, headset: true, preset: pr ? "P50 man" : null, body: compactBody(pkg, pr?.values ?? {}), posture: OPERATING };
}
function needPeople(asset: AssetInfo): People {
  if (!asset.people) throw new Refusal("no_person", "this server has no person packages (assets/manikin/), so there is no person to show or measure", "the person comes with the manikin release; ask the owner");
  return asset.people;
}
function needPerson(doc: SceneDoc): PersonState {
  if (!doc.person) throw new Refusal("no_person", "nobody is in the seat", "add a person first: person.set {\"preset\": \"P50 man\"} (or the person tool)");
  return doc.person;
}

// ------------------------------------------------------------------------------------------- the seated solve, cached
const solves = new Map<string, Seated>();
/** The seated person for a state at a pose (SI joint values): the server's solve, the same as the page's still. */
export function seated(asset: AssetInfo, p: PersonState, pose: Record<string, JointValue>): Seated {
  const people = needPeople(asset), pkg = packageOf(people, p), values = controlValues(pkg, p.body);
  const aims = p.posture === OPERATING ? p.aims : undefined;
  const key = JSON.stringify([asset.sha256, pkg.id, values, aims, Object.keys(pose).sort().map((k) => [k, pose[k]])]);
  let s = solves.get(key);
  if (s) { solves.delete(key); solves.set(key, s); return s; }
  s = seat(pkg, bodyOf(pkg, values), { manifest: asset.manifest, nodes: asset.nodes }, pose, aims);
  solves.set(key, s);
  while (solves.size > QUERIES.solve.cache_entries) solves.delete(solves.keys().next().value!);
  return s;
}
/** The eye the operator's view uses when a person is shown: the shown person's (or, with `stature_mm`, the same body at that
 *  stature), from the server's solve. null when nobody is in the seat or the person is not in the operating posture. */
export function personEye(asset: AssetInfo, doc: SceneDoc, o: { stature_mm?: number } = {}): { point: number[]; above_cushion_m: number; who: string; direction?: number[] } | null {
  const p = doc.person;
  if (!p || !asset.people || p.posture !== OPERATING) return null;
  let q = p;
  if (o.stature_mm !== undefined) {
    const pkg = packageOf(asset.people, p), c = pkg.manifest.shape.controls.find((x: any) => x.id === "stature");
    if (o.stature_mm < c.min || o.stature_mm > c.max) throw new Refusal("out_of_range", `look eye: a ${p.sex === "female" ? "woman" : "man"} of ${r1(o.stature_mm / 10)} cm is outside the person's stature range, ${c.min / 10} … ${c.max / 10} cm`, `choose a stature inside it, or person.set {"sex": "${p.sex === "female" ? "male" : "female"}"} for the other range`);
    q = { ...p, preset: null, body: { ...p.body, stature: o.stature_mm } };
  }
  const s = seated(asset, q, doc.pose);
  const gaze = modelAimReport(s.op, s.binding.place).look;
  return { direction: s.op.explicitGaze ? gaze?.direction : undefined, point: s.eyes.mid.map((x) => Math.round(x * 1e4) / 1e4), above_cushion_m: (s.binding.report as any).eye.eye_above_cushion_m, who: o.stature_mm !== undefined ? `the shown person's body at a stature of ${r1(o.stature_mm / 10)} cm` : `the person in the seat (${sayPerson(p)})` };
}

// ------------------------------------------------------------------------------------------- schemas
const setProps: Record<string, Schema> = {
  preset: { type: "string", maxLength: 80, description: "\"P5 woman\", \"P50 man\" or \"P95 man\" (the package's stature-percentile presets with the survey's build; sets the sex too), or a preset of the package by its exact name, e.g. \"Tall woman (stature P95)\", or the lab's tall heavy test body \"M95H\" (1869 mm, 115 kg)" },
  sex: { type: "string", enum: [...SEXES], description: "female or male; changed alone, the body becomes that sex's median" },
  style: { type: "string", enum: [...STYLES], description: "dressed (the operator in work clothes) or clay (the bare figure)" },
  tone: { type: "string", enum: [...TONES], description: "skin tone of the dressed person" },
  glasses: { type: "boolean", description: "safety glasses on or off" },
  headset: { type: "boolean", description: "headset on or off" },
  cap: { type: "boolean", description: "the cap is always worn: false is refused" },
  body: { type: "object", additionalProperties: { type: "number" }, propertyNames: { pattern: "^[a-z_]{1,40}$" }, description: "body controls by id: stature (mm), mass (kg), the survey's r_* controls (SD, e.g. r_sittingheight, r_buttockkneelength); the others keep their values" },
};
const postureSchema: Schema = { type: "string", maxLength: 80, description: "operating (seated, hands on the grips, feet on the pedals), relaxed stand, or a pose of the package's library by id or name (\"E37\", \"E37 seated_slump\")" };
const whatSchema: Schema = { type: "string", enum: ["eye", "sight", "reach", "clearance", "aims", "all"], description: "eye: both eyes; sight: both screens (distance, angles, gaze cone); reach: each grip; clearance: thighs, knees, hips, head, feet; aims: gaze and named limb targets; all (default)" };

const targetSchema: Schema = { type: "string", maxLength: 80, description: "A named part's centre or a reference point, by plain words or ID. Named points follow rig adjustments. Examples: touchscreen (also little monitor or small screen), soundbar, D_pedal_face_2." };
const targetAction = (key: string, description: string): Schema =>
  ({ type: "object", required: [key], additionalProperties: false, properties: { [key]: targetSchema }, description });
const handSchema: Schema = { anyOf: [
  { type: "string", enum: ["grip", "rest"], description: "grip the hand's own joystick (the default), or rest on its armrest" },
  targetAction("point", "Extend the index finger toward a target. The reply reports how far short it is."),
  targetAction("touch", "Try to touch the target with the index finger. The reply reports any gap."),
] };
const footSchema: Schema = { anyOf: [
  { type: "string", enum: ["pedal", "floor"], description: "the foot's own pedal (the default), or flat on the floor under the rig, including its deck" },
  targetAction("on", "Place the sole under the ball of the foot at a named point."),
] };
const aimProps = { look_at: targetSchema, left_hand: handSchema, right_hand: handSchema, left_foot: footSchema, right_foot: footSchema };
type PoseArgs = {
  posture?: string; look_at?: string;
  left_hand?: "grip" | "rest" | { point: string } | { touch: string };
  right_hand?: PoseArgs["left_hand"];
  left_foot?: "pedal" | "floor" | { on: string };
  right_foot?: PoseArgs["left_foot"];
};
const hasAims = (a: PoseArgs) => Object.keys(aimProps).some((key) => a[key as keyof PoseArgs] !== undefined);

function applyPose(asset: AssetInfo, people: People, p: PersonState, a: PoseArgs) {
  if (a.posture !== undefined) p.posture = resolvePosture(people, p, a.posture);
  if (a.posture !== undefined || hasAims(a)) delete p.aims;
  if (!hasAims(a)) return;
  if (p.posture !== OPERATING) throw new Refusal("invalid_args", "Named targets need the operating posture.", 'Include {"posture": "operating"} with the targets to sit down.');
  const aims: PersonAims = {}, resolve = (text: string) => resolvePoint(asset, text, true);
  if (a.look_at !== undefined) aims.look = resolve(a.look_at);
  for (const side of ["left", "right"] as const) {
    const h = a[`${side}_hand`], f = a[`${side}_foot`];
    if (h === "rest") aims[`${side}_hand`] = { mode: "rest" };
    else if (h && typeof h === "object") aims[`${side}_hand`] = "point" in h ? { mode: "point", target: resolve(h.point) } : { mode: "touch", target: resolve(h.touch) };
    if (f === "floor") aims[`${side}_foot`] = { mode: "floor" };
    else if (f && typeof f === "object") aims[`${side}_foot`] = { mode: "on", target: resolve(f.on) };
  }
  if (Object.keys(aims).length) p.aims = aims;
}

// ------------------------------------------------------------------------------------------- building a new state
type SetArgs = { preset?: string; sex?: "female" | "male"; style?: "dressed" | "clay"; tone?: string; glasses?: boolean; headset?: boolean; cap?: boolean; body?: Record<string, number> };
function applySet(people: People, cur: PersonState | null, a: SetArgs): { next: PersonState; notes: string[] } {
  if (a.cap === false) throw new Refusal("not_optional", "the cap cannot be taken off: it is part of the operator's outfit", "glasses and headset can be taken off: {\"glasses\": false} or {\"headset\": false}");
  const notes: string[] = [];
  let p: PersonState = structuredClone(cur ?? defaultPerson(people.packages)!);
  if (!cur) notes.push("Nobody was in the seat: the default person was added first.");
  if (a.style) p.style = a.style;
  if (a.tone) p.tone = a.tone;
  if (a.glasses !== undefined) p.glasses = a.glasses;
  if (a.headset !== undefined) p.headset = a.headset;
  if (a.preset !== undefined) {
    const named = PRESETS[a.preset] ?? Object.entries(PRESETS).find(([k]) => norm(k) === norm(a.preset!))?.[1];
    let sex = named?.sex ?? a.sex ?? p.sex, pkg = packageOf(people, { ...p, sex }), pr = presetOf(pkg, named?.preset ?? a.preset);
    if (!pr && !named && !a.sex) { const other = sex === "male" ? "female" : "male", pk2 = packageOf(people, { ...p, sex: other }), pr2 = presetOf(pk2, a.preset); if (pr2) { sex = other; pkg = pk2; pr = pr2; } }
    if (!pr) throw new Refusal("unknown_preset", `${JSON.stringify(a.preset)} is not a preset`, `"P5 woman", "P50 man", "P95 man", or one of the package's: ${(pkg.manifest.shape.presets ?? []).map((x: any) => `"${x.name}"`).slice(0, 14).join(", ")}`);
    if (named && a.sex && a.sex !== named.sex) throw new Refusal("invalid_args", `${a.preset} is a ${named.sex === "female" ? "woman" : "man"}; sex ${a.sex} contradicts it`, "leave sex out with a percentile preset");
    p.sex = sex; p.body = compactBody(pkg, pr.values); p.preset = named ? Object.keys(PRESETS).find((k) => PRESETS[k] === named)! : pr.name;
    if (named) notes.push(`${p.preset}: ${named.means}, the package's preset "${named.preset}".`);
  } else if (a.sex && a.sex !== p.sex) {
    p.sex = a.sex; p.preset = null; p.body = compactBody(packageOf(people, p), {});
    notes.push(`The body is now the ${a.sex === "female" ? "median woman" : "median man"} of the package.`);
  }
  if (a.body) {
    const pkg = packageOf(people, p), C = pkg.manifest.shape.controls;
    for (const [k, v] of Object.entries(a.body)) {
      const c = C.find((x: any) => x.id === k);
      if (!c) throw new Refusal("unknown_control", `${k} is not a body control of this person`, `controls: stature (mm), mass (kg), ${C.filter((x: any) => x.id.startsWith("r_")).slice(0, 8).map((x: any) => x.id).join(", ")}, … (SD); person.set {"body": {"stature": 1700}}`);
      if (v < c.min || v > c.max) throw new Refusal("out_of_range", `${k} ${v} ${c.unit ?? ""} is outside its range, ${c.min} … ${c.max} ${c.unit ?? ""} (${p.sex === "female" ? "women" : "men"} of this package)`.replace(/ +\(/, " ("), "choose a value inside the range; stature is in millimetres (170 cm = 1700)");
    }
    p.body = compactBody(pkg, { ...controlValues(pkg, p.body), ...a.body }); p.preset = null;
  }
  if (p.style === "clay" && (a.tone || a.glasses !== undefined || a.headset !== undefined)) notes.push("The clay figure shows no skin tone, glasses or headset; they are kept for the dressed person.");
  return { next: p, notes };
}
/** "operating", "RELAXED_STAND" or the name of a pose of the package's library */
function resolvePosture(people: People, p: PersonState, text: string): string {
  const w = norm(text);
  if (Object.hasOwn(POSTURE_WORDS, w)) return POSTURE_WORDS[w];
  if (text === RELAXED_STAND || text === OPERATING) return text;
  const poses: any[] = packageOf(people, p).manifest.poses ?? [];
  const hit = poses.find((x) => x.id === text || x.name === text) ?? poses.find((x) => norm(x.id ?? "") === w || norm(x.name ?? "") === w);
  if (!hit) throw new Refusal("unknown_posture", `${JSON.stringify(text)} is not a posture of this person`, `operating, relaxed stand, or a pose of the library: ${poses.filter((x) => /^[WE]\d/.test(x.id ?? "")).slice(0, 10).map((x) => x.id).join(", ")}, … (by id or name)`);
  return hit.name;
}
const changeOut = (before: PersonState | null, after: PersonState | null): Pick<RunOutput<any>, "person" | "joints"> => ({ person: { before, after }, joints: [PERSON_KEY] });
const said = (p: PersonState | null) => (p ? sayPerson(p) : "nobody in the seat");

// ------------------------------------------------------------------------------------------- the numbers in words
type Report = ReturnType<typeof ergonomics>;
function reportFor(asset: AssetInfo, doc: SceneDoc, p: PersonState) {
  const s = seated(asset, p, doc.pose), r = ergonomics(s, { manifest: asset.manifest, nodes: asset.nodes }, doc.pose);
  const where = {
    ...(p.aims ? { aim_source: "Posed component box centres or named rig points. Gaze uses the solved eye axes and an angular tolerance. Hand reach is shoulder-to-target distance divided by upper arm, forearm and wrist-to-index-tip length. Hand and foot contact uses the solved fingertip, palm or sole and a distance tolerance. Tolerances are in runtime-person.toml [operator.aim]." } : {}),
    computed_by: "the server (shared/person-model.ts): the person's own solver and the rig binding, the code the page runs; no browser is needed",
    pose: s.pose, posture_shown: p.posture === OPERATING ? "operating" : p.posture,
    ...(p.posture !== OPERATING ? { note: `the person is shown in ${p.posture === RELAXED_STAND ? "the relaxed stand" : `the pose ${p.posture}`}; these numbers are for the operating posture (other postures are poses the browser applies; the server does not measure them)` } : {}),
    browser_only: "the drawn person: meshes, skin tones, idle motion (a few millimetres of breathing and weight shift in a live view) and the mesh-level seat contact",
    body: { package: packageOf(asset.people!, p).id, baked_person: s.body.fitId, ...Object.fromEntries(["stature", "mass"].map((k) => [k, p.body[k]])), units: "stature mm, mass kg" },
    at_version: doc.version, frame: "model frame, metres: x forward (toward the main monitor), y to the operator's left, z up, origin at the centre of the deck's top",
  };
  return { r, where };
}
function aimLines(asset: AssetInfo, aims: Report["aims"]): string[] {
  return Object.entries(aims).map(([key, a]) => {
    const limb = key === "look" ? "Gaze" : key[0].toUpperCase() + key.slice(1).replace("_", " ");
    const name = a.mode === "floor" ? (a.target === "D_origin" ? "the deck" : "the floor") : labelOf(asset, a.target).replace(/\s*\([^)]*\)/g, "");
    if (a.status === "missing") return `${limb}: ${name} is missing from this rig.`;
    if (a.status === "behind") return `${limb}: ${name} is behind the seated person.`;
    if (a.mode === "look") return `Gaze: ${a.on_target ? "the line of sight passes through" : "the line of sight misses"} ${name} (${r1(a.angle_deg!)}° off).`;
    const gap = `${Math.round(a.distance_mm!)} mm`, share = a.reach_share === undefined ? "" : ` (${Math.round(a.reach_share * 100)}% of arm length)`;
    if (a.status === "blocked") return `${limb}: no clear pose toward ${name}; fingertip ${gap} away${share}.`;
    if (a.mode === "point") return `${limb} points at ${name}; fingertip ${gap} short${share}.`;
    const action = a.mode === "rest" ? "rests on" : a.mode === "floor" || a.mode === "on" ? "is flat on" : "touches";
    return a.status === "contact" ? `${limb} ${action} ${name} (${gap} from the target)${share}.` : `${limb} falls ${gap} short of ${name}${share}.`;
  });
}

function lines(r: Report, what: string, asset?: AssetInfo): string[] {
  const out: string[] = [], e = r.eye, m = r.sight.main_monitor, t = r.sight.touchscreen, c = r.clearance;
  const cone = (x: typeof m) => (x.gaze_cone.whole_area_inside ? "the whole active area inside the gaze cone" : x.gaze_cone.centre_inside ? `centre inside the gaze cone, ${x.gaze_cone.outside.join(", ").replace(/_/g, " ")} outside it` : `centre outside the gaze cone (${x.gaze_cone.from_down_deg}–${x.gaze_cone.to_down_deg}° below horizontal, ±${x.gaze_cone.side_half_deg}° sideways)`);
  const sl = (x: typeof m, name: string) => `${name}: ${r1(x.distance_m * 100)} cm from the eye, centre ${Math.abs(x.centre_below_eye_deg)}° ${x.centre_below_eye_deg >= 0 ? "below" : "above"} the eye's horizontal and ${Math.abs(x.centre_left_of_ahead_deg)}° to the ${x.centre_left_of_ahead_deg >= 0 ? "left" : "right"}, ${x.off_normal_deg}° off the screen's normal; top edge ${Math.abs(Math.round(x.top_edge_above_eye_mm))} mm ${x.top_edge_above_eye_mm >= 0 ? "above" : "below"} the eye; ${cone(x)}.`;
  if (what === "eye" || what === "all") out.push(`Eye (midpoint): ${e.midpoint_m.map((x) => x.toFixed(3)).join(", ")} m; ${r1(e.above_cushion_m * 100)} cm above the cushion (survey sitting eye height ${r1(e.survey_sitting_eye_height_m * 100)} cm less ${r1(e.cushion_compression_m * 100)} cm of cushion), ${r1(e.above_deck_m * 100)} cm above the deck.`);
  if (what === "sight" || what === "all") out.push(sl(m, "Main monitor"), sl(t, "Touchscreen"));
  if (what === "reach" || what === "all") out.push(`Reach: left grip at ${Math.round(r.reach.left_grip.share_of_arm * 100)} % of the arm's length (${r1(r.reach.left_grip.shoulder_to_grip_m * 100)} cm from the shoulder), right grip ${Math.round(r.reach.right_grip.share_of_arm * 100)} %; short of the grip: ${[r.reach.left_grip, r.reach.right_grip].map((g) => g.out_of_reach_mm === null ? "hand aimed elsewhere" : `${g.out_of_reach_mm} mm`).join(" / ")} (left / right).`);
  if (what === "clearance" || what === "all") {
    const k = c.knee_crease_to_seat_front_mm, mmTxt = (x: number | null | undefined) => (x === null || x === undefined ? "not evaluated" : `${Math.round(x)} mm`);
    const side = (x: number) => `${Math.abs(Math.round(x))} mm ${x >= 0 ? "behind" : "in front of"}`;
    out.push(`Knee crease ${side(k.solved_body)} the seat's front edge (by the survey estimate ${k.survey_estimate === null ? "not known" : side(k.survey_estimate)}).`);
    if (c.thigh_to_grip_mounts_mm) out.push(`Thighs to the joystick bases ${mmTxt(c.thigh_to_grip_mounts_mm.left.joystick_base?.clearance_mm)} / ${mmTxt(c.thigh_to_grip_mounts_mm.right.joystick_base?.clearance_mm)}, to the levers ${mmTxt(c.thigh_to_grip_mounts_mm.left.joystick_lever?.clearance_mm)} / ${mmTxt(c.thigh_to_grip_mounts_mm.right.joystick_lever?.clearance_mm)} (left / right; negative = overlap).`);
    out.push(`Hips to the armrest pods ${mmTxt((c.hips_to_armrest_pods_mm.left as any)?.clearance_mm)} / ${mmTxt((c.hips_to_armrest_pods_mm.right as any)?.clearance_mm)}${c.evaluated ? "" : " (this body has no collision capsules: not one of the baked persons)"}; survey hip room ${mmTxt(c.hips_to_armrest_pods_mm.survey_hip_room_each_side)} each side.`);
    out.push(`Head to the nearest part (${c.head_to_frame_mm.nearest.part}): ${mmTxt(c.head_to_frame_mm.nearest.clearance_mm)}.`);
    const f = c.feet_to_pedals.legs_short_of_pedals_mm as any;
    if (f.left !== null && f.right !== null) out.push(f.left > 0 || f.right > 0 ? `Feet short of the pedals by ${f.left} / ${f.right} mm (left / right).` : "Both feet reach their pedals.");
    else for (const side of ["left", "right"]) if (f[side] !== null) out.push(f[side] > 0 ? `The ${side} foot falls ${f[side]} mm short of its pedal.` : `The ${side} foot reaches its pedal.`);
  }
  if (asset && (what === "aims" || what === "all")) out.push(...aimLines(asset, r.aims));
  return out;
}
const HOW = "A point estimate at the rig's photo-estimated sizes and the survey's body; no range yet.";

// ------------------------------------------------------------------------------------------- commands
export const personCommands: CommandSpec[] = [
  {
    id: "person.set", kind: "edit",
    summary: "Change the person in the seat: preset (P5 woman, P50 man, P95 man, or a preset of the package), sex, style (dressed or clay), tone, glasses and headset on or off (the cap is always worn), body controls by id (stature mm, mass kg, r_* in SD). Adds the default person when nobody is in the seat. Recorded as one change; undo with history.undo.",
    args: { type: "object", properties: setProps },
    examples: [
      { args: { preset: "P5 woman" }, note: "the 5th percentile woman (F05)" },
      { args: { style: "clay" }, note: "the clay figure, same body" },
      { args: { body: { stature: 1700, mass: 70 } }, note: "stature 170 cm, 70 kg (the other controls kept)" },
      { args: { glasses: false, headset: false }, note: "glasses and headset off" },
    ],
    run({ doc, asset }, a: SetArgs) {
      if (!Object.values(a).some((v) => v !== undefined)) throw new Refusal("invalid_args", "person.set: name at least one thing to change", "e.g. {\"preset\": \"P5 woman\"} or {\"glasses\": false}");
      const { next, notes } = applySet(needPeople(asset), doc.person, a);
      return { result: { person: next, said: said(next), before: said(doc.person), notes }, ...changeOut(doc.person, next) };
    },
  },
  {
    id: "person.pose", kind: "edit",
    summary: "The person's posture: operating (seated on the rig's own grips, pedals, seat and screens), relaxed stand, or a pose of the package's library by id or name. In the operating posture one call can set gaze, hands and feet. A posture or aim request resets omitted aims to the operating defaults.",
    args: { type: "object", additionalProperties: false, properties: { posture: postureSchema, ...aimProps } },
    examples: [{ args: { posture: "operating" }, note: "back in the seat, hands on the grips" }, { args: { posture: "relaxed stand" }, note: "standing, arms hanging" }, { args: { posture: "E37" }, note: "the library's seated slump" }, { args: { look_at: "little monitor", right_hand: { point: "touchscreen" } }, note: "look at and point to the touchscreen" }],
    run({ doc, asset }, a: PoseArgs) {
      if (a.posture === undefined && !hasAims(a)) throw new Refusal("invalid_args", "person.pose: give a posture or a target", 'Try {"look_at": "touchscreen"}.');
      const people = needPeople(asset), cur = needPerson(doc), next = structuredClone(cur);
      applyPose(asset, people, next, a);
      const aimed = hasAims(a) ? reportFor(asset, doc, next).r.aims : {};
      return { result: { person: next, said: said(next), before: said(cur), aims: aimed, notes: aimLines(asset, aimed) }, ...changeOut(cur, next) };
    },
  },
  {
    id: "person.clear", kind: "edit",
    summary: "Take the person out of the seat (nobody shown). Recorded as one change; undo brings the person back.",
    args: { type: "object", properties: {} },
    examples: [{ args: {}, note: "nobody in the seat" }],
    run({ doc }) { return { result: { person: null, said: said(null), before: said(doc.person) }, ...changeOut(doc.person, null) }; },
  },
  {
    id: "person.report", kind: "query",
    summary: "What the person in the seat sees and reaches, computed on the server without a browser: eye point (both eyes), sight lines to the main monitor and the touchscreen (distance, angle below the eye, angle off the screen normal, the gaze cone), reach to each grip (share of the arm's length), clearances (thighs to the grip mounts, knee crease to the seat front, hips to the armrest pods, head to the frame, feet to the pedals). Includes gaze alignment to a named target, fingertip distance and reach share. Every number has its unit and source.",
    args: { type: "object", properties: { what: whatSchema } },
    examples: [{ args: {}, note: "everything" }, { args: { what: "sight" }, note: "the two screens from the person's eye" }],
    run({ doc, asset }, a: { what?: string }) {
      needPeople(asset);
      const p = needPerson(doc), what = a.what ?? "all", { r, where } = reportFor(asset, doc, p);
      const pick = what === "all" ? r : { [what]: (r as any)[what] };
      return { result: { text: [`${sayPerson(p)}, scene version ${doc.version}:`, ...lines(r, what, asset), HOW, ...(where.note ? [`Note: ${where.note}.`] : [])].join("\n"), ...pick, ...where, notes: r.notes } };
    },
  },
  {
    id: "person", kind: "edit", tool: "person",
    summary: "The person in the seat, in one request: preset (\"P5 woman\", \"P50 man\", \"P95 man\"), sex, style (dressed or clay), tone, glasses, headset, body controls (stature mm, mass kg, r_* SD), posture (operating, relaxed stand, a library pose), seated gaze, hands and feet, or clear: true for nobody. A posture or aim request resets omitted aims to the operating defaults. The reply is the check: before → after, the request name for undo, and the key numbers (eye, screens, reach, knee and hips). measure {\"person\": ...} gives every number with its source.",
    args: { type: "object", properties: { ...setProps, posture: postureSchema, ...aimProps, clear: { type: "boolean", description: "true: nobody in the seat" } } },
    examples: [
      { args: { preset: "P5 woman" }, note: "the small woman in the seat, with her numbers" },
      { args: { style: "clay", glasses: false }, note: "the clay figure; glasses off for the dressed person" },
      { args: { posture: "relaxed stand" }, note: "standing" },
      { args: { look_at: "little monitor", right_hand: { point: "touchscreen" } }, note: "look at and point to the touchscreen" },
      { args: { clear: true }, note: "nobody in the seat" },
    ],
    run({ doc, asset }, a: SetArgs & PoseArgs & { clear?: boolean }) {
      const people = needPeople(asset), { clear, posture, look_at, left_hand, right_hand, left_foot, right_foot, ...set } = a;
      const aiming = { posture, look_at, left_hand, right_hand, left_foot, right_foot }, hasPose = posture !== undefined || hasAims(aiming);
      const hasSet = Object.values(set).some((v) => v !== undefined);
      if (clear) {
        if (hasSet || hasPose) throw new Refusal("invalid_args", "person: clear takes nothing else", "{\"clear\": true}");
        return { result: { text: "", before: said(doc.person), after: said(null), numbers: [] as string[], notes: [] as string[] }, ...changeOut(doc.person, null) };
      }
      if (!hasSet && !hasPose) throw new Refusal("invalid_args", "person: name something to change", "e.g. {\"preset\": \"P5 woman\"}, {\"posture\": \"relaxed stand\"} or {\"clear\": true}");
      const { next, notes } = hasSet ? applySet(people, doc.person, set) : { next: structuredClone(needPerson(doc)), notes: [] as string[] };
      applyPose(asset, people, next, aiming);
      let numbers: string[] = [], aims: Report["aims"] = {};
      try {
        const after = { ...doc, person: next } as SceneDoc, { r } = reportFor(asset, after, { ...next, posture: OPERATING });
        if (next.posture === OPERATING) {
          aims = r.aims;
          numbers = [...aimLines(asset, aims), ...lines(r, "all").filter((l) => /^(Eye|Main monitor|Reach|Knee|Hips|Feet|Both feet)/.test(l))];
        }
      } catch (e) { if (!(e instanceof Refusal)) numbers = [`(The numbers could not be worked out: ${e instanceof Error ? e.message : e}.)`]; }
      return { result: { text: "", before: said(doc.person), after: said(next), aims, numbers, notes }, ...changeOut(doc.person, next) };
    },
    autoGroup(a: SetArgs & { posture?: string; clear?: boolean }) { return a.clear ? "person-clear" : a.preset ? `person-${a.preset}` : a.posture !== undefined && Object.keys(a).length === 1 ? "person-posture" : "person"; },
    finish(r: any, done) {
      const t = [`Person: ${r.before} → ${r.after}.`];
      t.push(done.recorded === null ? "Nothing changed: it was already so; nothing recorded." : `Version ${done.recorded}, request ${done.group}. Undo: undo {"what": "${done.group}"}.`);
      t.push(...r.notes);
      if (r.numbers.length) t.push(...r.numbers, `${HOW} measure {"person": "all"} gives every number with its source.`);
      return { ...r, text: t.join("\n"), ...(done.recorded !== null ? { version: done.recorded, request: done.group } : {}) };
    },
  },
];

/** The person's lines for the agents' undo and state (intent.ts) */
export function personChangeLine(before: PersonState | null, after: PersonState | null): string | null {
  return samePerson(before, after) ? null : `Person: ${said(before)} → ${said(after)}`;
}
export { said as sayPersonOrNobody, reportFor, lines as reportLines, HOW as REPORT_HOW };
