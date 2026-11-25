// The person on the server (manikin v1, phase 3): the same body and the same seated solve the page draws, without a
// browser, so that person.report and look's eye can be answered by the server alone.
//
//   readPackage(manifest, glb, poses)   one person package (assets/manikin/<id>/): its manifest, and its skeleton read from
//                                       the GLB's JSON chunk (node names, parents, rest translations and rotations; the
//                                       meshes, textures and shape files are never read here)
//   bodyOf(pkg, controls)               the body for control values: the shape model's target weights, the joints moved by
//                                       the shape's joint deltas, the survey measures, the baked person whose fit matches
//                                       (avatar.ts applyShape and matchPerson, the same arithmetic)
//   seat(pkg, body, rig, pose)          the seated operator in the rig at a pose: the rig binding (viewer/src/person/
//                                       rig-binding.ts) and then the still solve the page shows in a still view (index.ts
//                                       setStill and avatar.ts operatorPlugin with the runtime still_time), both eyes in
//                                       the model frame
//   ergonomics(seated, rig, pose)       eye, sight lines, reach and clearances, each number with its unit and source
//
// What the page draws differs from this only by its live idle motion (breathing, weight shifts, the head following the
// gaze over time; a few millimetres) and by the mesh-level contact the browser does (the sink map; not used for numbers).
// Postures other than the operating one are dof poses and clips applied in the browser; the server answers for the
// operating posture only and says so.
import { Operator, defaultTargets, adoptHandPoses, SCRIPTS, STILL_SETTLE, FIT_KEY_TOLERANCE, type Rest, type Controls, type Targets, type V3 } from "../viewer/src/person/operator.ts";
import { rigBinding, rigViewFromNodes, pkgToModel, type FullRigBinding } from "../viewer/src/person/rig-binding.ts";
import { section } from "../viewer/src/person/params.ts";
import rawQueries from "../assets/manikin/params/runtime-queries.toml";
import { stripRuntime } from "./runtime-params.ts";
import { worldFrames, type KNode } from "./kinematics.ts";
import { composeTrs, invertTrs, type JointValue, type Trs } from "./pose.ts";
import { quatRotate, type Quat, type Vec3 } from "./math.ts";
import type { Manifest } from "./manifest.ts";
import type { PersonState } from "./commands/doc.ts";

export const QUERIES = stripRuntime(rawQueries).queries as { sight: { normal_line_down: number; cone_vertical_half: number; cone_horizontal_half: number }; head: { radius_share_of_length: number }; solve: { cache_entries: number } };
const RT = section("runtime"), ANCH = section("anchors");

// ---------------------------------------------------------------------------------------------- the package
export interface PersonPackage {
  id: string; manifest: any;
  /** skin joints in the order three.js lists the bones (the skins' joint lists, first seen first) */
  bones: { names: string[]; parent: number[]; localQ: number[][]; worldP: number[][] };
}
/** The packages the server has (operator-m, operator-f, clay-m, clay-f) and the default person. */
export interface People { packages: Record<string, PersonPackage>; defaultPerson: PersonState }

/** three.js GLTFLoader's node names (PropertyBinding.sanitizeNodeName): whitespace to _, and no [ ] . : / */
const sanitize = (n: string) => n.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
export function readPackage(id: string, manifest: any, glb: Uint8Array, poses?: any[]): PersonPackage {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${id}: not a GLB file`);
  const gl = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + dv.getUint32(12, true))));
  const joints = new Set<number>(), order: number[] = [];
  for (const s of gl.skins ?? []) for (const j of s.joints) if (!joints.has(j)) { joints.add(j); order.push(j); }
  // world translation of every node from the scene's roots (the avatar's rest pose is read the same way, before it is placed)
  const parentOf = new Map<number, number>(), world = new Map<number, Trs>();
  const visit = (i: number, up: Trs) => {
    const n = gl.nodes[i];
    if (n.scale && n.scale.some((x: number) => Math.abs(x - 1) > 1e-9)) throw new Error(`${id}: node ${n.name} is scaled; the server's skeleton reader takes no scale`);
    const q = (n.rotation ?? [0, 0, 0, 1]) as Quat, w = composeTrs(up, { t: (n.translation ?? [0, 0, 0]) as Vec3, q });
    world.set(i, w);
    for (const c of n.children ?? []) { parentOf.set(c, i); visit(c, w); }
  };
  for (const r of gl.scenes[gl.scene ?? 0].nodes) visit(r, { t: [0, 0, 0], q: [0, 0, 0, 1] });
  const index = new Map(order.map((j, k) => [j, k]));
  const bones = {
    names: order.map((j) => sanitize(gl.nodes[j].name)),
    parent: order.map((j) => { const p = parentOf.get(j); return p !== undefined && index.has(p) ? index.get(p)! : -1; }),
    localQ: order.map((j) => [...(gl.nodes[j].rotation ?? [0, 0, 0, 1])]),
    worldP: order.map((j) => [...world.get(j)!.t]),
  };
  const m = structuredClone(manifest);
  if (poses && !m.poses) m.poses = poses;
  m.poses ??= [{ name: "Rest", dofs: {} }];
  return { id, manifest: m, bones };
}

// ---------------------------------------------------------------------------------------------- the body
export interface Body { values: Record<string, number>; weights: Record<string, number>; rest: Rest; measures: Record<string, number>; fit: any | null; fitId: string | null }
/** Every control of the package: its default, then the given values (clamped to the control's range, as avatar.ts does). */
export function controlValues(pkg: PersonPackage, given: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of pkg.manifest.shape.controls) out[c.id] = Math.min(c.max, Math.max(c.min, Number(given[c.id] ?? c.default ?? 0)));
  return out;
}
const qmul = (a: number[], b: number[]): Quat => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export function bodyOf(pkg: PersonPackage, given: Record<string, number> = {}): Body {
  const sh = pkg.manifest.shape, mo = sh.model, values = controlValues(pkg, given);
  // avatar.ts shapeWeights
  const x = mo.inputs.map((id: string, i: number) => ((values[id] ?? 0) - (mo.centre?.[i] ?? 0)) / (mo.scale?.[i] ?? 1)), weights: Record<string, number> = {};
  for (const [t, d] of Object.entries<any>(mo.targets)) { let w = d.bias ?? 0; for (let i = 0; i < x.length; i++) w += (d.coef[i] ?? 0) * x[i]; weights[t] = Math.min(d.max ?? 3, Math.max(d.min ?? -3, w)); }
  // avatar.ts applyShape: each joint's rest position moved by the shape's joint deltas; the rest rotations stay
  const jd = sh.jointDeltas ?? {}, B = pkg.bones;
  const pos = B.worldP.map((p, k) => { const q = [...p], n = B.names[k]; for (const [t, v] of Object.entries(weights)) { const d = v && jd[t]?.[n]; if (d) { q[0] += v * d[0]; q[1] += v * d[1]; q[2] += v * d[2]; } } return q; });
  const measures: Record<string, number> = {};
  for (const ms of sh.measures ?? []) { let v = ms.base; for (const [t, k] of Object.entries<number>(ms.perTarget ?? {})) v += (weights[t] ?? 0) * k; measures[ms.id] = Math.round(v * 10) / 10; }
  // the operator plug-in's rest: parents first, world positions, rotations as the chain of the bones' own rest rotations
  const names: string[] = [], parent: number[] = [], P: number[][] = [], rot: number[][] = [], seen = new Map<number, number>();
  const visit = (k: number) => {
    if (seen.has(k)) return;
    if (B.parent[k] >= 0) visit(B.parent[k]);
    const p = B.parent[k] >= 0 ? seen.get(B.parent[k])! : -1;
    seen.set(k, names.length); names.push(B.names[k]); parent.push(p); P.push(pos[k]); rot.push(p < 0 ? B.localQ[k] : qmul(rot[p], B.localQ[k]));
  };
  for (let k = 0; k < B.names.length; k++) visit(k);
  // the baked person whose key (rest head and left hand, bare-sole frame) this body matches
  const at = (n: string) => P[names.indexOf(n)], lift = pkg.manifest.rest?.soleHeight ?? 0, hp = at("head"), lp = at("hand_l");
  let fit: any = null, fitId: string | null = null;
  if (hp && lp) {
    const k6 = [hp[0], hp[1] - lift, hp[2], lp[0], lp[1] - lift, lp[2]];
    // the first that matches, as Avatar.matchPerson does (M50's body is within the tolerance of M50_MID's key too)
    for (const [id, f] of Object.entries<any>(pkg.manifest.motion?.persons ?? {})) if (f.key && f.key.every((v: number, i: number) => Math.abs(v - k6[i]) < FIT_KEY_TOLERANCE)) { fit = f; fitId = id; break; }
  }
  return { values, weights, rest: { names, parent, pos: P, rot }, measures, fit, fitId };
}

// ---------------------------------------------------------------------------------------------- the seated person
export interface RigInfo { manifest: Manifest; nodes: KNode[] }
export interface Seated {
  binding: FullRigBinding; op: Operator; body: Body;
  /** model frame, metres */
  eyes: { left: Vec3; right: Vec3; mid: Vec3 }; headCentre: Vec3;
  /** how the pose was found */
  pose: string;
}
const v3 = (a: number[]): V3 => [a[0], a[1], a[2]];
/** The seated operator at the rig's pose (SI joint values): the binding, then the still the page shows. */
export function seat(pkg: PersonPackage, body: Body, rig: RigInfo, pose: Record<string, JointValue>): Seated {
  adoptHandPoses(pkg.manifest);                                    // the package's hand poses (a module-level table of the solver)
  const op = new Operator(body.rest); if (body.fit) op.fit = body.fit;
  // the manifest and the shape weights let the binding derive collision capsules for a body that is not a baked person (body-fit.ts)
  const binding = rigBinding({ op, measures: body.measures, manifest: pkg.manifest, weights: body.weights }, rigViewFromNodes(rig.manifest, rig.nodes, pose));
  // as the operator plug-in does once the binding is there, then a still at the runtime still_time
  op.targets = { ...defaultTargets(op), ...binding.targets } as Targets;
  if (binding.contactPlanes?.length) op.contactPlanes = binding.contactPlanes as any;
  const lean = binding.stickLean, script = SCRIPTS.hold;
  const controls = (t: number): Controls => { const c = script(t); c.stick.l = [c.stick.l[0] + lean.l[0], c.stick.l[1] + lean.l[1]]; c.stick.r = [c.stick.r[0] + lean.r[0], c.stick.r[1] + lean.r[1]]; return c; };
  op.resetRun();
  const t = RT.still_time as number, dt = STILL_SETTLE.step;
  for (let u = Math.max(0, t - STILL_SETTLE.seconds); u < t; u += STILL_SETTLE.step) { op.time = u; op.solve(controls(u), STILL_SETTLE.step); }
  op.time = t - dt; op.solve(controls(t), dt);
  const P = (n: string) => op.P[op.j(n)], M = (p: number[]) => pkgToModel(binding.place, p) as Vec3;
  const l = P("eye_l"), r = P("eye_r"), mid = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
  // avatar.ts anchor("head_centre"): from the eye midpoint, in the head's frame (its turn from rest is the solver's D)
  const hc = ANCH.head_centre as number[], hq = op.D[op.j("head")] as Quat, off = quatRotate(hq, [hc[0], hc[1], hc[2]]);
  return { binding, op, body, eyes: { left: M(l), right: M(r), mid: M(mid) }, headCentre: M([mid[0] + off[0], mid[1] + off[1], mid[2] + off[2]]), pose: `operating: hands on the grips, feet on pedals 1 and 3, back on the backrest (still at t = ${t} s)` };
}

// ---------------------------------------------------------------------------------------------- the numbers
const r4 = (x: number) => Math.round(x * 1e4) / 1e4, r1 = (x: number) => Math.round(x * 10) / 10, mm = (m: number) => Math.round(m * 10000) / 10;
const sub = (a: number[], b: number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], addv = (a: number[], b: number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s], dotv = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lenv = (a: number[]) => Math.hypot(a[0], a[1], a[2]), unit = (a: number[]): Vec3 => scale(a, 1 / (lenv(a) || 1));
const DEG = 180 / Math.PI;

/** The parts the head is measured against (the headrest behind it, the monitor and its stand ahead, the touchscreen beside). */
export const HEAD_PARTS = ["C_seat_headrest", "C_stand_monitor", "C_stand_column_L", "C_stand_column_R", "C_stand_shelf", "C_stand_soundbar", "C_ts_screen", "C_ts_arm"];

/** A screen seen from an eye: distance, angles and the gaze cone check (model frame: x forward, y left, z up). */
function sightLine(eye: Vec3, f: Trs, screen: { id: string; label: string; width: number; height: number; radius?: number }) {
  const S = QUERIES.sight, x = quatRotate(f.q, [1, 0, 0]), y = quatRotate(f.q, [0, 1, 0]), z = quatRotate(f.q, [0, 0, 1]), toViewer = scale(x, -1);
  // the active area's centre and the middles of its four edges; a curved screen's side edges come toward the viewer
  const half = screen.width / 2, a = screen.radius ? half / screen.radius : 0, side = screen.radius ? screen.radius * Math.sin(a) : half, bow = screen.radius ? screen.radius * (1 - Math.cos(a)) : 0;
  const c = f.t, pts: Record<string, Vec3> = {
    centre: c, top_edge: addv(c, scale(z, screen.height / 2)), bottom_edge: addv(c, scale(z, -screen.height / 2)),
    left_edge: addv(addv(c, scale(y, side)), scale(toViewer, bow)), right_edge: addv(addv(c, scale(y, -side)), scale(toViewer, bow)),
  };
  const angles = (p: Vec3) => { const d = sub(p, eye), h = Math.hypot(d[0], d[1]); return { down_deg: r1(Math.atan2(-d[2], h) * DEG), side_deg: r1(Math.atan2(d[1], d[0]) * DEG) }; };
  const lo = S.normal_line_down - S.cone_vertical_half, hi = S.normal_line_down + S.cone_vertical_half;
  const inCone = (g: { down_deg: number; side_deg: number }) => g.down_deg >= lo && g.down_deg <= hi && Math.abs(g.side_deg) <= S.cone_horizontal_half;
  const toC = sub(c, eye), dist = lenv(toC), g = Object.fromEntries(Object.entries(pts).map(([k, p]) => [k, angles(p)])) as Record<string, { down_deg: number; side_deg: number }>;
  const outside = Object.entries(g).filter(([, v]) => !inCone(v)).map(([k]) => k);
  return {
    screen: screen.id, label: screen.label,
    distance_m: r4(dist), centre_below_eye_deg: g.centre.down_deg, centre_left_of_ahead_deg: g.centre.side_deg,
    off_normal_deg: r1(Math.acos(Math.max(-1, Math.min(1, dotv(unit(scale(toC, -1)), toViewer)))) * DEG),
    top_edge_above_eye_mm: mm(pts.top_edge[2] - eye[2]),
    edges: g,
    gaze_cone: { from_down_deg: lo, to_down_deg: hi, side_half_deg: S.cone_horizontal_half, centre_inside: inCone(g.centre), whole_area_inside: outside.length === 0, outside },
    source: `${screen.id} (posed frame) and the active area's size (${screen.radius ? "monitor.active_arc, monitor.active_height, monitor.radius" : "touchscreen.active_width, touchscreen.active_height"}); the eye from the solved pose; the cone from runtime-queries.toml [queries.sight]`,
  };
}

/** Eye, sight lines, reach and clearances, each with its unit and where it comes from. */
export function ergonomics(s: Seated, rig: RigInfo, pose: Record<string, JointValue>) {
  const R = s.binding.report as any, m = rig.manifest, P = (k: string) => m.parameters[k]?.value as number;
  const w = worldFrames(rig.nodes, pose), rest = worldFrames(rig.nodes, {}), M = s.body.measures;
  const eye = {
    left_m: s.eyes.left.map(r4), right_m: s.eyes.right.map(r4), midpoint_m: s.eyes.mid.map(r4),
    above_deck_m: r4(s.eyes.mid[2] - (w.D_origin?.t[2] ?? 0)),
    above_cushion_m: R.eye.eye_above_cushion_m, survey_sitting_eye_height_m: M.eyeheightsitting / 1000, cushion_compression_m: R.person.cushion_compression_m,
    vs_rig_eye_points_mm: R.eye.vs_rig_eye_points_mm,
    source: "eyes: the solved pose (shared/person-model.ts seat: the rig binding, then the still the page shows); height rule: the survey sitting eye height (shape measure eyeheightsitting) less the cushion's compression (rig record seat.eye_cushion_compression), at the backrest's neutral recline",
  };
  const sight = {
    main_monitor: sightLine(s.eyes.mid, w.S_mon_screen, { id: "S_mon_screen", label: "main monitor", width: P("monitor.active_arc"), height: P("monitor.active_height"), radius: P("monitor.radius") }),
    touchscreen: sightLine(s.eyes.mid, w.S_ts_screen, { id: "S_ts_screen", label: "touchscreen", width: P("touchscreen.active_width"), height: P("touchscreen.active_height") }),
  };
  const reachOf = (side: "left" | "right") => {
    const g = R.reach[side];
    return { grip: g.grip, shoulder_to_grip_m: g.shoulder_to_grip_m, arm_length_m: g.arm_length_m, share_of_arm: g.share_of_arm, out_of_reach_mm: g.out_of_reach_mm, hand_error_mm: g.hand_error_mm, forearm_skin_above_pad_mm: g.forearm_skin_above_pad_mm,
      source: `shoulder: the solved pose; grip: ${g.grip} (posed); arm length: the body's upper arm, forearm and hand to its grip point (survey acromionradialelength ${M.acromionradialelength} mm, radialestylionlength ${M.radialestylionlength} mm)` };
  };
  const reach = { left_grip: reachOf("left"), right_grip: reachOf("right") };
  // the head as a sphere against the boxes of the parts around it, each box carried by its own part's node
  const rHead = QUERIES.head.radius_share_of_length * (M.headlength / 1000);
  const head: Record<string, { clearance_mm: number }> = {};
  let nearest = { part: "", clearance_mm: Infinity };
  for (const id of HEAD_PARTS) {
    const c = m.components.find((x) => x.id === id); if (!c?.bbox || !w[id] || !rest[id]) continue;
    const p = composeTrs(rest[id], invertTrs(w[id])), q = addv(quatRotate(p.q, s.headCentre), p.t);          // the head centre in the part's photographed frame
    const d = [0, 1, 2].map((k) => Math.max(c.bbox!.min[k] - q[k], 0, q[k] - c.bbox!.max[k])), cl = mm(Math.hypot(d[0], d[1], d[2]) - rHead);
    head[id] = { clearance_mm: cl }; if (cl < nearest.clearance_mm) nearest = { part: id, clearance_mm: cl };
  }
  const seat = R.seat, cl = R.clearance;
  const clearance = {
    evaluated: cl.evaluated !== false, body_capsules: typeof cl.capsules === "string" ? cl.capsules : s.body.fitId ? `the collision capsules of the baked person ${s.body.fitId}` : null,
    thigh_to_grip_mounts_mm: cl.evaluated === false ? null : { left: { joystick_base: cl.left.joystick_base, joystick_lever: cl.left.joystick_lever }, right: { joystick_base: cl.right.joystick_base, joystick_lever: cl.right.joystick_lever },
      source: "the body's collision capsules (a baked person's fit, or derived from the shape weights: body_capsules) against the rig parts C_joy_base_* and C_joy_lever_*, posed; positive = a gap, negative = an overlap" },
    knee_crease_to_seat_front_mm: { solved_body: seat.crease_minus_front_mm, survey_estimate: seat.survey.crease_estimate_minus_front_edge_mm, knee_front_ahead_of_front_edge: seat.survey.knee_front_minus_front_edge_mm, seat_depth_m: seat.depth_m,
      source: "D_seat_front and D_backrest_ref (posed); the crease from the solved knee joint less the thigh's radius there; the survey estimate is 0.81 × buttock-knee length (shape measure buttockkneelength, runtime-rig.toml findings.buttock_popliteal_share) from the backrest surface; positive = the crease is behind the front edge" },
    hips_to_armrest_pods_mm: { left: cl.evaluated === false ? null : cl.left.pod_shell, right: cl.evaluated === false ? null : cl.right.pod_shell, survey_hip_room_each_side: seat.survey.hip_room_each_side_mm, pod_gap_m: seat.survey.pod_gap_m, hip_breadth_m: seat.survey.hip_breadth_m,
      source: "capsules against the boxes of C_pod_shell_* (posed); the survey cross-check is half of (the gap between the pods' inner faces less the shape measure hipbreadthsitting)" },
    head_to_frame_mm: { nearest, parts: head, head_radius_m: r4(rHead),
      source: `the head as a sphere about the person's head centre (runtime-person.toml anchors.head_centre from the solved eyes), radius ${QUERIES.head.radius_share_of_length} × the shape measure headlength (${M.headlength} mm; runtime-queries.toml head.radius_share_of_length), against each part's box, posed; the cap, its brim, the glasses and the headset are not counted` },
    feet_to_pedals: { legs_short_of_pedals_mm: seat.leg_short_of_pedal_mm, foot_on_pedal_error_mm: seat.foot_on_pedal_error_mm, pedals: R.pedals,
      source: "the solved legs' reach to the heel on D_heel_rest and the ball on D_pedal_face_1 (left foot) and _3 (right foot), posed; survey poplitealheight, footlength" },
  };
  return { eye, sight, reach, clearance, notes: R.notes as string[] };
}
