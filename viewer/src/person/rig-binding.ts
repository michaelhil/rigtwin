// Rig binding (owner: MV-rig): the real rig's own points become the seated operator's targets, the contact surfaces and the
// ergonomic findings, for one person at the rig's current pose. Called by the person module after the person loads, after
// every shape change and after every rig joint change; the caller merges `targets` over defaultTargets(op) and re-solves.
//
// Pure in what it reads and returns: the person (its Operator, built for the current shape, with op.fit set when the body
// matches a baked person, and its survey measures in mm) and the rig (its description file and the posed frames of its
// D_ / S_ / C_ nodes). It runs the person's own solver a few times on the given Operator (with dt = 0, the idle layer off)
// to find where the body ends up, then puts the Operator's run state back (resetRun) and restores its idle layer.
//
// Frames. The rig's model frame: metres, Z up, X forward (operator -> main display), Y to the operator's left. The person's
// package frame: +Y up, +Z the way the figure faces, +X the figure's left, soles on y = 0. place = { origin, yawDeg }:
//     model = origin + Rz(yaw) · (pkg.z, pkg.x, pkg.y)              (pkgToModel; modelToPkg is the inverse)
// origin: on the deck top (the model z of D_origin) below the live seat reference D_seat_ref_live; yaw: the seat's swivel.
// Seat tilt and backrest recline are not in `place`: they go into targets.recline, the seat point and the contact normals.
//
// Survey-true seat (the lab's rule of round 6b, coordinator's decision "seated dimensions first"): the hip sits so that, with
// the trunk at the backrest's neutral recline (read from the rig, D_backrest_ref at neutral), the eye is the person's survey
// sitting eye height (measures.eyeheightsitting, a hard seat) less the cushion's compression (the rig's
// seat.eye_cushion_compression) above the unloaded cushion top under the hip, and the back lies on the backrest plane as the
// solver's allowances say (runtime-person.toml operator.targets: back_clear, pelvis_press, back_behind_hip). Any other recline
// turns the trunk about the hip, so the eye goes where the trunk takes it; height, slide and swivel carry it unchanged.
//
// Numbers: the rig's sizes come from the rig's parameter records (through the description file) and its points; the body's
// allowances from runtime-person.toml [operator.targets]; the binding's own few numbers from runtime-rig.toml [rig_binding].
import rawRig from "../../../assets/manikin/params/runtime-rig.toml";
import { stripRuntime } from "../../../shared/runtime-params.ts";
import type { Trs } from "../../../shared/pose.ts";
import { quatRotate } from "../../../shared/math.ts";
import type { PersonAims } from "../../../shared/person-aims.ts";
import type { Manifest } from "../../../shared/manifest.ts";
import { worldFrames, type KNode } from "../../../shared/kinematics.ts";
import { section } from "./params.ts";
import { defaultTargets, hold, op_heelBack, type Targets, type Controls, type V3, type ContactPlane, type PanSolid, type Pedal, type Stick, type AimPoint, type AimResult, type Obstacle, type Operator } from "./operator.ts";
import type { PersonView, RigView, RigBinding } from "./types.ts";
import { deriveBodyFit, weightsOf, hasModel, type Capsule } from "./body-fit.ts";

// ---- parameters --------------------------------------------------------------------------------------------------------
function guard(node: any, path: string): any {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  return new Proxy(node, { get(t, k) { if (typeof k !== "string") return Reflect.get(t, k); if (!(k in t)) throw new Error(`runtime-rig.toml has no record '${path}.${k}'`); return guard(t[k], `${path}.${k}`); } });
}
const RB = guard(stripRuntime(rawRig).rig_binding, "rig_binding");
const SEAT = RB.seat, ARM = RB.armrest, PED = RB.pedal, FIND = RB.findings;
const TG = section("operator").targets, AIM = section("operator").aim;

// ---- interfaces (the person module's side is viewer/src/person/types.ts) ---------------------------------------------------
/** A node's frame in the rig model frame: origin and unit axes (as posed now). */
export type RigFrame = { origin: number[]; x: number[]; y: number[]; z: number[] };
export interface Place { origin: V3; yawDeg: number }
/** A contact surface in the package frame. "seat" carries the cushion as `pan` and its centre-line `profile` [z, y];
 *  "backrest" is a plane; "pod_L" / "pod_R" are the armrest pods' inner sides as a `slab`: the face at `point` with its
 *  `normal` toward the body, `forward` and `up` along it, and `profile` [along, height, up from, up to] (metres in that frame,
 *  from the rig's build: D_pod_inner_* surface): at each place along the pod, how far the shell stands out toward the body
 *  and over which height; `box` is the same as one block; `edge` the shell's edge radius. Hard plastic: compress_m 0. */
export type SeatContact = ContactPlane & { name: string; pan?: PanSolid; profile?: number[][];
  slab?: { forward: V3; up: V3; profile: number[][]; band: number[]; edge: number; box: { along: number[]; up: number[]; height: number } } };
/** What rigBinding returns: types.ts's RigBinding with every optional part filled in. */
export interface FullRigBinding extends RigBinding {
  place: Place;
  /** operator.ts Targets in the package frame, to merge over defaultTargets(op). */
  targets: Partial<Targets>;
  /** seat (with the cushion as a solid for the contact flatten, and its centre-line profile [z, y]) and backrest, package frame. */
  contactPlanes: SeatContact[];
  /** The real lever's lean (forward, sideways; degrees, the sense of Controls.stick), joystick joints included: added to the
   *  scripted deflection before each solve, or the closed hand stands off the real handle. */
  stickLean: { l: [number, number]; r: [number, number] };
  report: RigReport;
}
export type RigReport = {
  person: { survey_eye_m: number | null; cushion_compression_m: number; hip_above_cushion_m: number; rule: string; fit: boolean; fit_source: string; back_behind_hip_m: number };
  seat: Record<string, unknown>;
  clearance: Record<string, unknown>;
  reach: Record<string, unknown>;
  eye: Record<string, unknown>;
  pedals: Record<string, unknown>[];
  contact: Record<string, unknown>;
  notes: string[];
};

// ---- small maths -------------------------------------------------------------------------------------------------------
type N3 = number[];
const add = (a: N3, b: N3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a: N3, b: N3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: N3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s], dot = (a: N3, b: N3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: N3, b: N3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: N3) => Math.hypot(a[0], a[1], a[2]), norm = (a: N3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mid = (a: N3, b: N3): V3 => mul(add(a, b), 0.5);
const RAD = Math.PI / 180, clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const qrot = (q: number[], v: N3): V3 => { const u = [q[0], q[1], q[2]], t = mul(cross(u, v), 2); return add(add(v, mul(t, q[3])), cross(u, t)); };
/** Rodrigues: v turned about the unit axis k by `a` radians. */
const turn = (v: N3, k: N3, a: number): V3 => add(add(mul(v, Math.cos(a)), mul(cross(k, v), Math.sin(a))), mul(k, dot(k, v) * (1 - Math.cos(a))));
const mm = (m: number) => Math.round(m * 10000) / 10;               // metres -> millimetres, 0.1 mm
const r4 = (v: N3) => v.map((x) => Math.round(x * 1e4) / 1e4);
const deg1 = (r: number) => Math.round(r / RAD * 10) / 10;

// ---- frames ------------------------------------------------------------------------------------------------------------
export function modelToPkg(place: Place, p: N3): V3 {
  const y = place.yawDeg * RAD, c = Math.cos(y), s = Math.sin(y), d = sub(p, place.origin);
  return [-s * d[0] + c * d[1], d[2], c * d[0] + s * d[1]];
}
export function dirModelToPkg(place: Place, v: N3): V3 {
  const y = place.yawDeg * RAD, c = Math.cos(y), s = Math.sin(y);
  return [-s * v[0] + c * v[1], v[2], c * v[0] + s * v[1]];
}
export function pkgToModel(place: Place, p: N3): V3 {
  const y = place.yawDeg * RAD, c = Math.cos(y), s = Math.sin(y);
  return [place.origin[0] + c * p[2] - s * p[0], place.origin[1] + s * p[2] + c * p[0], place.origin[2] + p[1]];
}
/** Shared report geometry in the rig's model frame, suitable for browser and server comparisons. */
export function modelAimReport(op: Operator, place: Place): Record<string, AimResult> {
  return Object.fromEntries(Object.entries(op.aimReport()).map(([key, aim]) => {
    const origin = aim.origin && pkgToModel(place, aim.origin);
    return [key, {
      ...aim, point: aim.point && pkgToModel(place, aim.point), origin,
      direction: aim.direction && sub(pkgToModel(place, aim.direction), place.origin),
    }];
  }));
}

/** A RigView over world frames (shared/kinematics.ts worldFrames), for tests and for callers without a three.js scene. */
export function rigViewFromFrames(manifest: Manifest, frames: Record<string, Trs>, neutral = frames): RigView {
  const frame = (f: Trs | undefined): RigFrame | null => f ? { origin: [...f.t], x: quatRotate(f.q, [1, 0, 0]), y: quatRotate(f.q, [0, 1, 0]), z: quatRotate(f.q, [0, 0, 1]) } : null;
  return { manifest, frame: (id) => frame(frames[id]), neutralFrame: (id) => frame(neutral[id]), point: (id) => frames[id]?.t ?? null };
}
/** The same from the GLB's node tree and joint values (radians or metres; unnamed joints at neutral). */
export const rigViewFromNodes = (manifest: Manifest, nodes: KNode[], values: Record<string, number | number[]> = {}) => rigViewFromFrames(manifest, worldFrames(nodes, values), worldFrames(nodes));

/** Carry a point in the photographed model frame with a part, including its rotation. */
function carryPoint(p: N3, rest: RigFrame, now: RigFrame): V3 {
  const d = sub(p, rest.origin);
  return add(now.origin, add(add(mul(now.x, dot(d, rest.x)), mul(now.y, dot(d, rest.y))), mul(now.z, dot(d, rest.z))));
}

/** Named surfaces and datums are points. A component is the centre of its box or of the posed parts it contains. */
export function rigAimPoint(rig: RigView, id: string): RigFrame | null {
  const frame = rig.frame(id);
  if (!frame || !id.startsWith("C_")) return frame;
  const parts = rig.manifest.components, part = parts.find((x) => x.id === id);
  const extent = (c: NonNullable<typeof part>): V3[] => {
    if (!c.bbox) return parts.filter((x) => x.parent === c.id).flatMap(extent);
    const rest = rig.neutralFrame(c.id), now = rig.frame(c.id), { min, max } = c.bbox;
    if (!rest || !now) return [];
    return [min[0], max[0]].flatMap((x) => [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => carryPoint([x, y, z], rest, now))));
  };
  if (!part) return frame;
  const bounds = extent(part);
  if (!bounds.length) return frame;
  return { ...frame, origin: [0, 1, 2].map((k) => (Math.min(...bounds.map((p) => p[k])) + Math.max(...bounds.map((p) => p[k]))) / 2) };
}

// ---- the binding ---------------------------------------------------------------------------------------------------------
/** What the binding reads of the person: its solver and survey measures; for a body that is not a baked person also the
 *  package manifest with either the control values or the shape weights, from which its capsules are derived. */
export type BindingPerson = Pick<PersonView, "op" | "measures"> & Partial<Pick<PersonView, "manifest" | "controls">> & { weights?: Record<string, number> };

/** The lever's radius along its handle axis, as the rig's build wrote it on D_grip_axis_L / _R (generator: a datum's
 *  `profile`, the lever's own mesh cut across the axis): [t, radius] pairs, t in metres from the grip centre, up positive;
 *  and `hold`, the handle section a closed hand wraps, [from, to] along the same axis. */
export function gripProfile(manifest: RigView["manifest"], side: "L" | "R" = "L"): { profile: number[][]; hold: number[] | null } {
  const d = manifest.datums.find((x) => x.id === `D_grip_axis_${side}`);
  if (!d?.profile?.length) throw new Error(`rig binding: the description file has no grip profile on D_grip_axis_${side} (rebuild the rig: bun run build)`);
  return { profile: d.profile, hold: d.hold ?? null };
}

export function rigBinding(person: BindingPerson, rig: RigView, aims?: PersonAims): FullRigBinding {
  const op = person.op, m = rig.manifest, notes: string[] = [];
  // the body's capsules: the baked person's fit where there is one; otherwise derived from the shape weights (body-fit.ts)
  const weights = person.weights ?? (person.manifest && person.controls ? weightsOf(person.manifest, person.controls) : null), sex = person.manifest?.shape?.sex;
  const derived = weights && sex && hasModel(sex) ? deriveBodyFit(sex, weights, (n) => op.r0(n)) : null;
  const baked = op.fit && (op.fit as any).source !== "derived" ? op.fit : null;
  const fitCaps: Capsule[] = (baked?.capsules as Capsule[] | undefined) ?? derived?.capsules ?? [], fitSource = baked ? "baked" : derived ? "derived" : "none";
  const heelBack = (s: string) => { const hb = baked?.seat?.heel_back_m ?? derived?.heel_back_m; return hb !== undefined ? hb + TG.shoe_heel : op_heelBack(op, s); };
  const P = (k: string): number => { const r = m.parameters[k]; if (!r || typeof r.value !== "number") throw new Error(`rig binding: the rig has no number ${k}`); return r.value; };
  const A = (k: string): any[] => { const r = m.parameters[k]; if (!r || !Array.isArray(r.value)) throw new Error(`rig binding: the rig has no list ${k}`); return r.value as any[]; };
  const F = (id: string): RigFrame => { const f = rig.frame(id); if (!f) throw new Error(`rig binding: the rig has no point ${id} (rebuild the rig: bun run build)`); return f; };
  const datum = (id: string) => { const d = m.datums.find((x) => x.id === id); if (!d) throw new Error(`rig binding: the description file has no ${id}`); return d; };
  const joint = (id: string) => { const j = m.joints.find((x) => x.id === id); if (!j) throw new Error(`rig binding: the rig has no joint ${id}`); return j; };
  /** A neutral model point carried by the body that holds datum `id` (same body, rigidly), to where it is now, and back. */
  const carrier = (id: string) => {
    const d = datum(id), f = F(id), xn = d.x_axis, zn = d.z_axis, yn = cross(zn, xn);
    const toNow = (p: N3): V3 => { const q = sub(p, d.origin), l = [dot(q, xn), dot(q, yn), dot(q, zn)]; return add(f.origin, add(add(mul(f.x, l[0]), mul(f.y, l[1])), mul(f.z, l[2]))); };
    const toNeutral = (p: N3): V3 => { const q = sub(p, f.origin), l = [dot(q, f.x), dot(q, f.y), dot(q, f.z)]; return add(d.origin, add(add(mul(xn, l[0]), mul(yn, l[1])), mul(zn, l[2]))); };
    return { toNow, toNeutral };
  };

  // ---- placement: the package frame on the deck below the seat reference, turned with the seat ----------------------------
  const sref = F("D_seat_ref_live"), deck = rig.point("D_origin")?.[2] ?? 0;
  const place: Place = { origin: [sref.origin[0], sref.origin[1], deck], yawDeg: Math.atan2(sref.x[1], sref.x[0]) / RAD };
  const pk = (p: N3) => modelToPkg(place, p), pkd = (v: N3) => norm(dirModelToPkg(place, v)), md = (p: N3) => pkgToModel(place, p);

  // ---- the cushion's centre-line top (rig params, as seat.ts builds it), posed with the seat, in the package frame ----------
  const lipX = P("seat.cushion_front_lip_x"), back = P("seat.backrest_surface_x_at_cushion"), depth = lipX - back;
  const zF = P("seat.cushion_top_z_front"), zR = P("seat.cushion_top_z_rear"), R = P("seat.cushion_lip_radius"), rows = A("seat.cushion_sections") as number[][];
  const seatBody = carrier("D_seat_ref_live");
  const top: N3[] = rows.map((r) => [lipX - r[0] * depth, 0, zR + r[2] * (zF - zR)]).reverse();       // rear to the crest (row 0)
  const crestX = lipX - rows[0][0] * depth, nRoll = FIND.roll_samples;
  for (let i = 1; i <= nRoll; i++) { const a = (Math.PI / 2) * i / nRoll; top.push([crestX + (lipX - crestX) * Math.sin(a), 0, zF - R * (1 - Math.cos(a))]); }
  const profile = top.map((p) => pk(seatBody.toNow(p)));                                              // [x, y, z] in the package frame
  const crest = profile[rows.length - 1], front = pk(F("D_seat_front").origin);
  const topRun = profile.slice(0, rows.length);                                                       // the top up to the crest (the roll falls away)
  const topAt = (z: number): number => {
    if (z <= topRun[0][2]) return topRun[0][1];
    for (let i = 1; i < topRun.length; i++) if (z <= topRun[i][2]) { const a = topRun[i - 1], b = topRun[i], u = (z - a[2]) / (b[2] - a[2] || 1); return a[1] + (b[1] - a[1]) * u; }
    return topRun[topRun.length - 1][1];
  };

  // ---- backrest: the reference point, its normal toward the person and its line up the back ---------------------------------
  const bk = F("D_backrest_ref"), B = pk(bk.origin), nb = pkd(bk.x), ub = pkd(bk.z);
  const recline = Math.atan2(-ub[2], ub[1]) / RAD;
  const bn = datum("D_backrest_ref"), sn = datum("D_seat_ref_live"), reclineRef = Math.atan2(-dot(bn.z_axis, sn.x_axis), dot(bn.z_axis, sn.z_axis)) / RAD;   // the backrest from the seat's upright, at neutral

  // ---- grips: the handle's axis and centre (D_grip_axis_*), the lever's pivot from D_grip_* and the rig's grip records --------
  const gripPalm = A("pods.grip_palm") as number[], pivotH = P("pods.joy_pivot_height"), gripR = P("pods.grip_radius");
  const grip = {} as { l: Stick; r: Stick }, stickLean = {} as { l: [number, number]; r: [number, number] }, gripCentre: Record<string, V3> = {};
  for (const [s, S, sy] of [["l", "L", 1], ["r", "R", -1]] as const) {
    const ga = F(`D_grip_axis_${S}`), gl = F(`D_grip_${S}`), C = pk(ga.origin), u = pkd(ga.z);
    const local = [gripPalm[0], sy * gripPalm[1], gripPalm[2] - pivotH], pivotModel = sub(gl.origin, add(add(mul(gl.x, local[0]), mul(gl.y, local[1])), mul(gl.z, local[2])));
    const L = len(sub(C, pk(pivotModel)));
    const gp = gripProfile(m, S);
    grip[s] = { pivot: sub(C, mul(u, L)), length: L, radius: gripR, profile: gp.profile, ...(gp.hold ? { hold: gp.hold } : {}) } as Stick;
    stickLean[s] = [Math.atan2(u[2], u[1]) / RAD, Math.asin(clamp(-u[0], -1, 1)) / RAD];
    gripCentre[s] = C;
  }

  // ---- armrests: the palm near the pad's front end, the elbow pole over the pad behind it ------------------------------------
  const padLen = (A("pods.pad_size") as number[])[0], eo = TG.elbow_pole_offset as number[];
  const armrest = {} as { l: V3; r: V3 }, elbow = {} as { l: V3; r: V3 }, padTop: Record<string, { o: V3; x: V3; z: V3 }> = {};
  for (const [s, S, sg] of [["l", "L", 1], ["r", "R", -1]] as const) {
    const a = F(`D_armrest_${S}`), o = pk(a.origin), ax = pkd(a.x), az = pkd(a.z);
    const palm = add(o, mul(ax, padLen / 2 - ARM.palm_inset));
    const fore = op.len0(`lowerarm_${s}`, `hand_${s}`) + len(op.hands[s].palm), above = op.fit?.arm?.fore?.[0] ?? derived?.arm?.fore?.[0] ?? ARM.elbow_above_pad_default;
    armrest[s] = palm;
    elbow[s] = add(add(sub(palm, mul(ax, fore)), mul(az, above)), [sg * eo[0], eo[1], eo[2]]);
    padTop[s] = { o, x: ax, z: az };
  }

  // ---- touchscreen and main screen ------------------------------------------------------------------------------------------
  const ts = F("S_ts_screen"), mon = F("S_mon_screen");
  const touch = pk(ts.origin), touchNormal = pkd(mul(ts.x, -1));
  // curve: how much nearer the active area's side edges are than its centre. The edges lie half the arc from the centre along a
  // circle of the monitor's radius, so at the angle (arc / 2) / radius: sagitta = radius (1 - cos(angle))
  const monR = P("monitor.radius"), arc = P("monitor.active_arc");
  const screen = { centre: pk(mon.origin), width: arc, height: P("monitor.active_height"), curve: monR * (1 - Math.cos(arc / 2 / monR)) };

  // ---- pedals: heel on the heel plate, the sole under the ball on the pad face; travel from the pedal's remaining travel ------
  const hr = F("D_heel_rest"), tt = (A("pedals.tray") as number[])[3], trayFrom = (A("pedals.tray") as number[])[0];
  const plateLen = P("pedals.heel_far_edge_x") - P("pedals.heel_lip_x");
  const prof = (A("pedals.heel_profile") as number[][]).filter((p) => p[1] > 0).sort((a, b) => a[0] - b[0]);
  const plateTop = (u: number) => { for (let i = 1; i < prof.length; i++) if (u <= prof[i][0]) { const a = prof[i - 1], b = prof[i], k = (u - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * k; } return prof[prof.length - 1][1]; };
  const lipTop = tt + plateTop(0), pedalOrigin = sub(hr.origin, mul(hr.z, lipTop));                   // the pedal unit's frame on the deck at the lip
  const support = (xl: number) => (xl >= 0 ? tt + plateTop(Math.min(1, xl / plateLen)) : xl >= trayFrom ? tt : 0);
  const inUnit = (p: N3): V3 => { const q = sub(p, pedalOrigin); return [dot(q, hr.x), dot(q, hr.y), dot(q, hr.z)]; };   // the pedal unit's own frame
  const fromUnit = (l: N3): V3 => add(add(add(pedalOrigin, mul(hr.x, l[0])), mul(hr.y, l[1])), mul(hr.z, l[2]));
  const off = P("pedals.pad_face_offset"), reach = P("pedals.arm_reach"), padH = (A("pedals.pad_size") as number[])[1];
  const order = PED.order as number[], pedals: Pedal[] = [], pedalReport: Record<string, unknown>[] = [];
  order.forEach((n, i) => {
    // solved in the pedal unit's frame (x along the heel plate, z up), so a swivelled seat leaves the feet where the pedals are
    const side = i === 0 ? "l" : "r", f = F(`D_pedal_face_${n}`), Fc = inUnit(add(f.origin, mul(f.z, PED.ball_on_face)));
    const foot = op.r0(`ball_${side}`)[2] - op.r0(`foot_${side}`)[2] + heelBack(side);        // heel's back edge to under the ball, along the sole
    const gap = (xl: number) => Math.hypot(Fc[0] - xl, Fc[2] - support(xl)) - foot;
    let lo = trayFrom, hi = plateLen, note = "";
    if (gap(hi) > 0) { lo = hi; note = `the foot is ${mm(gap(hi))} mm too short to put the ball on the pad's middle with the heel on the plate`; }
    else if (gap(lo) < 0) { hi = lo; note = `the foot is ${mm(-gap(lo))} mm too long: the heel is behind the tray`; }
    else for (let k = 0; k < PED.search_iterations; k++) { const c = (lo + hi) / 2; if (gap(c) > 0) lo = c; else hi = c; }
    const xl = (lo + hi) / 2, Hl: V3 = [xl, Fc[1], support(xl)], pitch = Math.atan2(Fc[2] - Hl[2], Fc[0] - Hl[0]) / RAD;
    // remaining travel: the pad turned about the hinge (the arm frame's y) from where it is now to the joint's upper limit
    const jn = joint(`J_pedal_${n}`), zN = datum(`D_pedal_face_${n}`).z_axis, now = Math.atan2(dot(cross(zN, f.z), f.y), dot(zN, f.z));
    const left = Math.max(0, jn.upper - ((jn.neutral as number) + now)), hinge = sub(f.origin, add(mul(f.x, -off), mul(f.z, reach - padH / 2)));
    const Fp = inUnit(add(hinge, turn(sub(add(f.origin, mul(f.z, PED.ball_on_face)), hinge), f.y, left)));
    const travel = pitch - Math.atan2(Fp[2] - Hl[2], Fp[0] - Hl[0]) / RAD;
    pedals.push({ heel: pk(fromUnit(Hl)), pitch, travel });
    pedalReport.push({ pedal: `D_pedal_face_${n}`, foot: side === "l" ? "left" : "right", heel_on_plate_m: r4([xl])[0], foot_pitch_deg: Math.round(pitch * 10) / 10, press_travel_deg: Math.round(travel * 10) / 10, ...(note ? { note } : {}) });
  });

  // ---- the hip: survey-true height above the cushion, back on the backrest ------------------------------------------------------
  const base = defaultTargets(op), savedIdle = op.idle;
  const T: Targets = { ...base, grip, elbow, armrest, touch, touchNormal, pedals, feet: { l: pedals[0].heel, r: pedals[1].heel }, screen, recline };
  const target = (id: string): AimPoint => {
    const frame = rigAimPoint(rig, id);
    if (!frame) return { id };
    return { id, point: pk(frame.origin), ...(id.startsWith("S_") ? { inward: pkd(frame.x) } : {}) };
  };
  const named: Targets["aims"] = {};
  if (aims) {
    if (aims.look) named.look = target(aims.look);
    for (const [s, side] of [["l", "left"], ["r", "right"]] as const) {
      const hand = aims[`${side}_hand`], foot = aims[`${side}_foot`];
      if (hand) named[`${s}Hand`] = hand.mode === "rest" ? { mode: "rest", id: `D_armrest_${s.toUpperCase()}`, point: armrest[s] } : { mode: hand.mode, ...target(hand.target) };
      if (!foot) continue;
      if (foot.mode === "on") named[`${s}Foot`] = { mode: "on", ...target(foot.target) };
      else {
        const home = inUnit(md(pedals[s === "l" ? 0 : 1].heel));
        const p = fromUnit([Math.min(home[0], trayFrom) - AIM.floor_back, home[1], 0]);
        const platform = m.components.find((c) => c.id === "C_platform")?.bbox;
        const onDeck = platform && p[0] >= platform.min[0] && p[0] <= platform.max[0] && p[1] >= platform.min[1] && p[1] <= platform.max[1];
        p[2] = onDeck ? deck : rig.point("D_floor")?.[2] ?? deck;
        named[`${s}Foot`] = { mode: "floor", id: onDeck ? "D_origin" : "D_floor", point: pk(p) };
      }
    }
    if ([named.lHand, named.rHand].some((h) => h?.mode === "point" || h?.mode === "touch")) {
      named.obstacles = m.components.flatMap((c): Obstacle[] => {
        if (!c.bbox || !c.triangles) return [];
        if (c.id === "C_ts_screen") {
          // The tilted panel's world-aligned box extends in front of the glass. Use its physical face instead.
          const half: V3 = [P("touchscreen.depth") / 2, P("touchscreen.outer_width") / 2, P("touchscreen.outer_height") / 2];
          const mount = F(c.id), mountSize = A("pods.ts_mount_plate") as number[], ball = P("pods.ts_ball_radius");
          const support = Math.max(ball, P("pods.ts_ball_standoff")), radius = Math.max(mountSize[0], ball);
          return [{ id: c.id, center: pk(add(ts.origin, mul(ts.x, half[0]))), axes: [pkd(ts.x), pkd(ts.y), pkd(ts.z)], half },
            { id: c.id, center: pk(add(mount.origin, mul(mount.x, (ball - support) / 2))), axes: [pkd(mount.x), pkd(mount.y), pkd(mount.z)], half: [(ball + support) / 2, radius, radius] }];
        }
        const rest = rig.neutralFrame(c.id), now = rig.frame(c.id);
        if (!rest || !now) return [];
        const centre = mid(c.bbox.min, c.bbox.max);
        const center = pk(carryPoint(centre, rest, now));
        const axes = ([0, 1, 2] as const).map((i) => {
          const v = [...centre]; v[i] += 1;
          return norm(sub(pk(carryPoint(v, rest, now)), center));
        }) as [V3, V3, V3];
        return [{ id: c.id, center, axes, half: mul(sub(c.bbox.max, c.bbox.min), 0.5) }];
      });
    }
  }
  const still: Controls = { ...hold(), headOverride: [0, 0] };
  const leaned: Controls = { ...still, stick: { l: [...stickLean.l], r: [...stickLean.r] } };
  const solveWith = (t: Targets, c: Controls) => { op.targets = t; op.idle = null; op.resetRun(); op.solve(c, 0); };
  const eyeOf = (): V3 => op.ix["eye_l"] !== undefined ? mid(op.P[op.j("eye_l")], op.P[op.j("eye_r")]) : add(op.P[op.j("head")], section("operator").head.eye_fallback_offset as number[]);
  const hipOf = (): V3 => mid(op.P[op.j("thigh_l")], op.P[op.j("thigh_r")]);
  solveWith({ ...T, seat: [0, 1, 0], recline: reclineRef }, still);
  const eyeAboveHipRef = eyeOf()[1] - hipOf()[1];
  const survey = Number.isFinite(person.measures?.eyeheightsitting) ? person.measures.eyeheightsitting / 1000 : null, comp = P("seat.eye_cushion_compression");
  const st = baked?.seat;
  let hipAbove: number, rule: string;
  if (survey !== null) { hipAbove = survey - comp - eyeAboveHipRef; rule = "survey: seated eye = survey sitting eye height less the cushion's compression, at the backrest's neutral recline"; }
  else if (st?.hip_above_pan_m !== undefined) { hipAbove = st.hip_above_pan_m; rule = "lab fit: hip_above_pan_m of the baked person (no survey measure given)"; notes.push("no survey eye height: the seat height is the lab fit's, not survey-true"); }
  else { hipAbove = base.hipAbovePan; rule = "stand-in: the solver's default hip height (no survey measure, no fit)"; notes.push("no survey eye height and no fit: the seat height is a stand-in"); }
  // back behind the hip: the baked person's own measure; for a derived body, the rearmost back capsule (spine_03..05) in the
  // reference posture less the capsules' calibrated excess over the skin (runtime-rig.toml seat.back_capsule_to_skin)
  let backDerived: number | null = null;
  if (!st && derived) { solveWith({ ...T, seat: [0, 1, 0], recline: reclineRef }, still); const hc = hipOf(), rr = reclineRef * RAD, nr: V3 = [0, Math.sin(rr), Math.cos(rr)]; let w = -Infinity;
    for (const c of derived.capsules) if (/^spine_0[345]$/.test(c.joint)) { const j = op.j(c.joint); for (const [e, r] of [[c.a, c.ra], [c.b, c.rb]] as [V3, number][]) w = Math.max(w, -dot(sub(add(op.P[j], qrot(op.D[j], e)), hc), nr) + r); }
    if (Number.isFinite(w)) backDerived = w - SEAT.back_capsule_to_skin; }
  const dBack = st ? Math.max(st.back_behind_hip_m + TG.back_clear, st.pelvis_behind_hip_m - TG.pelvis_press) : backDerived !== null ? backDerived + TG.back_clear : TG.back_behind_hip;
  let hz = B[2] + dBack / (nb[2] || 1), hy = topAt(hz) + hipAbove;
  for (let k = 0; k < SEAT.placement_iterations; k++) { hy = topAt(hz) + hipAbove; hz = B[2] + (dBack - (hy - B[1]) * nb[1] + B[0] * nb[0]) / (nb[2] || 1); }
  hy = topAt(hz) + hipAbove;
  const seat: V3 = [0, hy, hz];

  // ---- contact: the cushion as one slab (exact under the hip and at the front crest) and the backrest plane --------------------
  const under: V3 = [0, topAt(hz), hz], tl = norm([0, crest[1] - under[1], crest[2] - under[2]]), n: V3 = [0, tl[2], -tl[1]];
  const slabTop = under[1] + (front[2] - under[2]) * (tl[1] / (tl[2] || 1));
  let above = 0, below = 0;
  for (const p of topRun) if (p[2] >= under[2] && p[2] <= crest[2]) { const d = under[1] + (p[2] - under[2]) * (tl[1] / (tl[2] || 1)) - p[1]; above = Math.max(above, d); below = Math.min(below, d); }
  const cushionThick = 2 * R + (A("seat.cushion_profile") as number[])[1];
  const pan: PanSolid = { top: slabTop, front: front[2], rear: B[2] - SEAT.pan_rear_under_back, halfWidth: P("seat.pan_width_rear") / 2, thickness: cushionThick, edge: R,
    kneeRestY: (op.r0("calf_l")[1] + op.r0("calf_r")[1]) / 2, hipRestY: (op.r0("thigh_l")[1] + op.r0("thigh_r")[1]) / 2, hipRestX: (Math.abs(op.r0("thigh_l")[0]) + Math.abs(op.r0("thigh_r")[0])) / 2 };
  const sink = st?.compress_m !== undefined && st?.hip_above_pan_m !== undefined ? st.compress_m + (st.hip_above_pan_m - hipAbove) : comp;
  const contactPlanes: SeatContact[] = [
    { name: "seat", point: [under[0], under[1], under[2]], normal: n, compress_m: Math.max(0, sink), pan, profile: profile.map((p) => [p[2], p[1]]) },
    { name: "backrest", point: sub(seat, mul(nb, dot(sub(seat, B), nb))), normal: nb, compress_m: TG.back_press },
  ];
  // the pods' inner sides, where a wide thigh or hip meets them (the clash numbers stay in the report)
  for (const S of ["L", "R"] as const) {
    const f = F(`D_pod_inner_${S}`), d = datum(`D_pod_inner_${S}`);
    if (!d.surface?.length || !d.band) throw new Error(`rig binding: the description file has no surface on D_pod_inner_${S} (rebuild the rig: bun run build)`);
    const pr = d.surface, along = [Math.min(...pr.map((q) => q[0])), Math.max(...pr.map((q) => q[0]))], up = [Math.min(...pr.map((q) => q[2])), Math.max(...pr.map((q) => q[3]))];
    contactPlanes.push({ name: `pod_${S}`, point: pk(f.origin), normal: pkd(f.z), compress_m: 0,
      slab: { forward: pkd(f.x), up: pkd(f.y), profile: pr, band: d.band, edge: d.edge ?? 0, box: { along, up, height: Math.max(...pr.map((q) => q[1])) } } });
  }

  // ---- the seated body on the real rig: hands on the grips, head level ---------------------------------------------------------
  T.seat = seat; T.hipAbovePan = hipAbove;
  if (aims) T.aims = named;
  solveWith(T, leaned);
  const eye = eyeOf(), hip = hipOf(), seatTop = topAt(hip[2]);
  const thighCaps = fitCaps.filter((k) => k.joint === "thigh_l"), rKnee = thighCaps.length ? thighCaps[thighCaps.length - 1].rb : TG.knee_radius_default;
  const crease = Math.min(op.P[op.j("calf_l")][2], op.P[op.j("calf_r")][2]) - rKnee;
  // how far the drawn cushion top stands above the thigh's underside (the solved thigh line less its capsule radius): under the
  // hip, where the seat rule sinks the tissue on purpose, and over the cushion's front rise up to the knee crease (or the crest),
  // where it is pressure the rise adds under the thigh (the contact flatten shows both as compressed tissue)
  const flat = rows.findIndex((r) => r[2] <= 0), riseFrom = flat < 0 ? topRun[0][2] : topRun[rows.length - 1 - flat][2];   // the front-most row at or below the rear height
  const intoThigh = (s: string, z0: number, z1: number) => {
    const h = op.P[op.j(`thigh_${s}`)], k = op.P[op.j(`calf_${s}`)], tc = fitCaps.filter((c) => c.joint === `thigh_${s}`);
    let worst = -Infinity;
    for (let i = 0; i <= FIND.clearance_samples; i++) {
      const z = z0 + (z1 - z0) * i / FIND.clearance_samples, u = clamp((z - h[2]) / ((k[2] - h[2]) || 1), 0, 1);
      const r = tc.length ? tc[0].ra + (tc[tc.length - 1].rb - tc[0].ra) * u : rKnee;
      worst = Math.max(worst, topAt(z) - (h[1] + (k[1] - h[1]) * u - r));
    }
    return worst;
  };
  const hipZ = (op.P[op.j("thigh_l")][2] + op.P[op.j("thigh_r")][2]) / 2, riseEnd = Math.min(crease, crest[2]);
  const sinkUnderHip = Math.max(intoThigh("l", hipZ, hipZ), intoThigh("r", hipZ, hipZ));
  const riseIntoThigh = riseEnd > riseFrom ? Math.max(intoThigh("l", riseFrom, riseEnd), intoThigh("r", riseFrom, riseEnd)) : null;
  const popliteal = Number.isFinite(person.measures?.poplitealheight) ? person.measures.poplitealheight / 1000 : null;
  const bkLen = Number.isFinite(person.measures?.buttockkneelength) ? person.measures.buttockkneelength / 1000 : null;
  const heelY = Math.min(pedals[0].heel[1], pedals[1].heel[1]);
  // the feet on their home pedals: how far the legs fall short (the solver's two-bone reach), and the ball's error
  const legReach = { left: named.lFoot ? null : mm(op.report.legReach.l), right: named.rFoot ? null : mm(op.report.legReach.r) }, footErr = { left: named.lFoot ? null : mm(op.report.footErr.l), right: named.rFoot ? null : mm(op.report.footErr.r) };

  // clearances: the body's thigh and pelvis capsules against the rig parts beside and over them
  // legs and hips: the fit's thigh and lower-trunk capsules, and the derived shin capsules (knee included); forearms separately
  const posed = (list: Capsule[]) => list.map((c) => { const j = op.j(c.joint); return { joint: c.joint, a: add(op.P[j], qrot(op.D[j], c.a)), b: add(op.P[j], qrot(op.D[j], c.b)), ra: c.ra, rb: c.rb }; });
  const caps = posed([...fitCaps.filter((c) => /^(thigh_[lr]|pelvis|spine_01)$/.test(c.joint)), ...(derived?.extra ?? []).filter((c) => /^calf_[lr]$/.test(c.joint))]);
  const foreCaps = posed((derived?.extra ?? []).filter((c) => /^lowerarm_[lr]$/.test(c.joint)));
  const boxOf = (id: string, carrierId: string) => { const c = m.components.find((x) => x.id === id); if (!c?.bbox) throw new Error(`rig binding: ${id} has no box`); return { box: c.bbox, body: carrier(carrierId) }; };
  const clearTo = (b: { box: { min: number[]; max: number[] }; body: ReturnType<typeof carrier> }, list = caps) => {
    let worst = Infinity, who = "";
    for (const c of list) for (let i = 0; i <= FIND.clearance_samples; i++) {
      const u = i / FIND.clearance_samples, p = b.body.toNeutral(md(add(c.a, mul(sub(c.b, c.a), u)))), r = c.ra + (c.rb - c.ra) * u;
      const q = [0, 1, 2].map((k) => Math.max(b.box.min[k] - p[k], 0, p[k] - b.box.max[k])), d = Math.hypot(q[0], q[1], q[2]) - r;
      if (d < worst) { worst = d; who = c.joint; }
    }
    return list.length ? { clearance_mm: mm(worst), nearest: who } : null;
  };
  // the armrest pad exactly, as the box it is in its own frame (D_armrest_*: top centre, x along the pad; pods.pad_size, pad_height)
  const [padL, padW] = A("pods.pad_size") as number[], padHt = P("pods.pad_height");
  const padClear = (S: string, list: typeof caps) => {
    const f = F(`D_armrest_${S}`); let worst = Infinity, who = "";
    for (const c of list) for (let i = 0; i <= FIND.clearance_samples; i++) {
      const u = i / FIND.clearance_samples, q = sub(md(add(c.a, mul(sub(c.b, c.a), u))), f.origin), l = [dot(q, f.x), dot(q, f.y), dot(q, f.z)], r = c.ra + (c.rb - c.ra) * u;
      const lo = [-padL / 2, -padW / 2, -padHt], hi = [padL / 2, padW / 2, 0], e = [0, 1, 2].map((k) => Math.max(lo[k] - l[k], 0, l[k] - hi[k])), d = Math.hypot(e[0], e[1], e[2]) - r;
      if (d < worst) { worst = d; who = c.joint; }
    }
    return list.length ? { clearance_mm: mm(worst), nearest: who } : null;
  };
  const clearance: Record<string, unknown> = {}, mountClash = { l: 0, r: 0 };
  for (const [s, S] of [["l", "L"], ["r", "R"]] as const) {
    const pod = clearTo(boxOf(`C_pod_shell_${S}`, "D_seat_ref_live")), stick = clearTo(boxOf(`C_joy_base_${S}`, "D_seat_ref_live")), lever = clearTo(boxOf(`C_joy_lever_${S}`, `D_grip_${S}`)), pad = padClear(S, caps);
    const sideFore = foreCaps.filter((c) => c.joint === `lowerarm_${s}`);
    clearance[s === "l" ? "left" : "right"] = { pod_shell: pod, joystick_base: stick, joystick_lever: lever, armrest_pad: pad,
      forearm_to_armrest_pad: sideFore.length ? padClear(S, sideFore) : null, forearm_to_joystick_base: sideFore.length ? clearTo(boxOf(`C_joy_base_${S}`, "D_seat_ref_live"), sideFore) : null };
    const worst = Math.min(...[pod, stick, lever].map((x) => (x ? x.clearance_mm : Infinity)));
    mountClash[s] = Number.isFinite(worst) ? Math.max(0, -worst / 1000) : 0;
  }
  clearance.method = "body capsules against the pod shells', joystick bases' and levers' bounding boxes (an upper bound of any overlap: the parts are tilted with the plate) and against the armrest pads as the boxes they are. The joystick bases stand on the plates 12 mm outboard of the pods' inner edges: a thigh reaches a base's box only through the pod's inner side, so a negative joystick_base is the pod clash seen again (the round capsule's top-outer edge at the plate), not a contact of its own";
  clearance.capsules = fitSource === "baked" ? "the baked person's fit (thighs, lower trunk), derived shins and forearms" : fitSource === "derived" ? "derived from the body's shape weights (body-fit.ts): thighs, lower trunk, shins, forearms" : "none";
  if (!caps.length) { clearance.evaluated = false; notes.push("no capsules for this body (not a baked person, and no manifest and controls or weights given): clearances are not evaluated"); }

  // reach to each grip, and how the forearm lies on the pad while gripping
  const reachRep: Record<string, unknown> = {};
  for (const [s, S] of [["l", "L"], ["r", "R"]] as const) {
    const sh = op.P[op.j(`upperarm_${s}`)], el = op.P[op.j(`lowerarm_${s}`)], arm = op.len0(`upperarm_${s}`, `lowerarm_${s}`) + op.len0(`lowerarm_${s}`, `hand_${s}`) + len(op.hands[s].gripPoint);
    const d = len(sub(gripCentre[s], sh)), pt = padTop[s];
    reachRep[s === "l" ? "left" : "right"] = { grip: `D_grip_axis_${S}`, shoulder_to_grip_m: r4([d])[0], arm_length_m: r4([arm])[0], share_of_arm: Math.round((d / arm) * 1000) / 1000,
      out_of_reach_mm: named[`${s}Hand`] ? null : mm(op.report.reach[s]), hand_error_mm: named[`${s}Hand`] ? null : mm(op.report.handErr[s]), elbow_above_pad_mm: mm(dot(sub(el, pt.o), pt.z)),
      forearm_skin_above_pad_mm: mm(dot(sub(el, pt.o), pt.z) - (baked?.arm?.fore?.[0] ?? derived?.arm?.fore?.[0] ?? ARM.elbow_above_pad_default)) };
  }

  // the eye against both screens (model frame)
  const eyeM = md(eye);
  const look = (id: string, f: RigFrame, h: number) => {
    const to = sub(f.origin, eyeM), dist = len(to), horiz = Math.hypot(to[0], to[1]), nrm = mul(f.x, -1), topEdge = add(f.origin, mul(f.z, h / 2));
    return { screen: id, eye_to_centre_m: r4([dist])[0], centre_below_eye_deg: deg1(Math.atan2(-to[2], horiz)), off_axis_deg: deg1(Math.acos(clamp(dot(norm(mul(to, -1)), nrm), -1, 1))),
      top_edge_vs_eye_mm: mm(topEdge[2] - eyeM[2]) };
  };
  const eyeRep: Record<string, unknown> = {
    eye_model_m: r4(eyeM), eye_above_cushion_m: r4([eye[1] - seatTop])[0], survey_less_compression_m: survey === null ? null : r4([survey - comp])[0],
    vs_rig_eye_points_mm: Object.fromEntries(["D_eye_small", "D_eye_median", "D_eye_large"].map((id) => { const p = rig.point(id); return [id, p ? r4(sub(eyeM, p)).map((x) => Math.round(x * 1000)) : null]; })),
    main_monitor: look("S_mon_screen", mon, P("monitor.active_height")), touchscreen: look("S_ts_screen", ts, P("touchscreen.active_height")),
  };

  // ---- the report ---------------------------------------------------------------------------------------------------------------
  // survey cross-checks: the buttock on the backrest's surface, knee front by the survey's buttock-knee length, the crease by a
  // share of it; the gap between the pods' inner faces against the survey's seated hip breadth
  const kneeFrontSurvey = bkLen === null ? null : B[2] + bkLen, creaseSurvey = bkLen === null ? null : B[2] + bkLen * FIND.buttock_popliteal_share;
  const podIn = (S: string, sgn: number) => { const c = m.components.find((x) => x.id === `C_pod_shell_${S}`)!.bbox!; const y = sgn > 0 ? c.min[1] : c.max[1]; return pk(carrier("D_seat_ref_live").toNow([(c.min[0] + c.max[0]) / 2, y, (c.min[2] + c.max[2]) / 2]))[0]; };
  const podGap = podIn("L", 1) - podIn("R", -1), hipBreadth = Number.isFinite(person.measures?.hipbreadthsitting) ? person.measures.hipbreadthsitting / 1000 : null;
  const seatRep = {
    depth_m: r4([front[2] - B[2]])[0], front_edge_z_m: r4([front[2]])[0], knee_crease_z_m: r4([crease])[0],
    crease_minus_front_mm: mm(crease - front[2]), lab_rule_short_of_crease_mm: mm(TG.seat_short_of_crease),
    verdict: crease - front[2] >= TG.seat_short_of_crease ? "front edge short of the knee crease by the lab's margin or more" : crease - front[2] >= 0 ? "front edge short of the knee crease, by less than the lab's margin" : "seat front edge reaches beyond the knee crease with the back on the backrest (seat too deep for this person)",
    survey: { buttock_knee_m: bkLen, knee_front_minus_front_edge_mm: kneeFrontSurvey === null ? null : mm(kneeFrontSurvey - front[2]), crease_estimate_minus_front_edge_mm: creaseSurvey === null ? null : mm(creaseSurvey - front[2]),
      popliteal_m: popliteal, front_crest_above_heel_rest_m: r4([crest[1] - heelY])[0], pod_gap_m: r4([podGap])[0], hip_breadth_m: hipBreadth, hip_room_each_side_mm: hipBreadth === null ? null : mm((podGap - hipBreadth) / 2) },
    cushion_above_thigh_underside_mm: { under_hip: mm(sinkUnderHip), over_front_rise: riseIntoThigh === null ? null : mm(riseIntoThigh) }, leg_short_of_pedal_mm: legReach, foot_on_pedal_error_mm: footErr,
    hip_model_m: r4(md(hip)), recline_deg: Math.round(recline * 10) / 10, recline_reference_deg: Math.round(reclineRef * 10) / 10,
  };
  const report: RigReport = {
    person: { survey_eye_m: survey, cushion_compression_m: comp, hip_above_cushion_m: r4([hipAbove])[0], rule, fit: fitSource !== "none", fit_source: fitSource, back_behind_hip_m: r4([dBack - TG.back_clear])[0] },
    seat: seatRep, clearance, reach: reachRep, eye: eyeRep, pedals: pedalReport.filter((p) => !named[p.foot === "left" ? "lFoot" : "rFoot"]),
    contact: { slab_above_drawn_top_mm: mm(above), slab_below_drawn_top_mm: mm(-below), note: "the contact solid is one flat slab through the cushion top under the hip and the front crest; the drawn top rises toward the front, so between them the slab lies this far above or below it (profile carries the real line)" },
    notes,
  };
  if (!Number.isFinite(seat[1]) || !Number.isFinite(seat[2])) throw new Error("rig binding: the seat placement did not converge");

  const targets: Partial<Targets> = { ...T, seat, recline, hipAbovePan: hipAbove, mountClash, seatFront: front[2], seatFit: { crease_z: crease, full_front: front[2], rule: "the rig's own cushion: its front edge is fixed by the rig (D_seat_front); the crease is the seated knee joint less the thigh's radius there" } };
  op.idle = savedIdle; op.resetRun(); op.targets = { ...base, ...targets } as Targets; op.contactPlanes = contactPlanes as any;
  return { place, targets, contactPlanes, stickLean, report };
}
