// Seated operator at run time, ported unchanged in behaviour from the avatar lab (work/avatar-lab/viewer/src/operator.ts,
// owner B4, the version the designer passed in REVIEW-10). No dependencies but the parameter file: plain arrays in,
// joint rotations out. Every number the lab wrote as a literal is a record of assets/manikin/params/runtime-person.toml
// ([operator.*]); what is left in this file is arithmetic (halves, unit vectors, epsilons, array indices).
//
//   pelvis on a seat reference point · spine distribution · analytic two-bone IK with a pole for arms and legs ·
//   head and neck look-at (the eyes lead: gaze goes to eyes.ts) · a grip-pose library as joint angles ·
//   idle life (breathing, weight shifts) · scripted sequences.
//
// Everything is solved in "delta space": D[j] is joint j's world rotation away from the rest pose, in world axes
// (+X the figure's left, +Y up, +Z forward: the package frame), so nothing here depends on how a rig orients its joint
// frames. Only `locals()` converts to the rig's own local rotations. Joint names: the 82-joint skeleton.
//
// Use:   const op = new Operator(rest);            // rest = { names, parent, pos, rot } in the rest pose, metres
//        op.targets = defaultTargets(op);           // the stand-in rig (fallback); rig-binding.ts supplies the real rig's
//        op.solve(hold(), dt);                      // or operate8(t), demo30(t), or your own Controls
//        op.locals()  ->  { q: local rotations per joint, pelvis: local translation }        op.report  ->  contact errors
import { section } from "./params.ts";
import { fixationAngles } from "./aim-eyes.ts";

const O = section("operator");
const HAND = O.hand, HDL = O.handle, WRAP = O.wrap, CLAMP = O.clamp, IK = O.ik, IDLE = O.idle, TRUNK = O.trunk, HEAD = O.head, LEGS = O.legs, ARM = O.arm, FING = O.fingers, TG = O.targets, SI = O.standin, SCR = O.scripts, STILL = O.still, AIM = O.aim;

export type V3 = [number, number, number];
export type Q = [number, number, number, number];
export interface Rest { names: string[]; parent: number[]; pos: number[][]; rot: number[][]; tips?: Record<string, number[]> }
export type GripName = "power" | "relaxed" | "point" | "flat" | "fist";
export type HandGoal = "grip" | "touch" | "armrest";
export type AimPoint = { id: string; point?: V3; inward?: V3 };
type AimedHand = AimPoint & { mode: "point" | "touch" | "rest" };
type AimedFoot = AimPoint & { mode: "on" | "floor" };
export type AimResult = {
  mode: string; target: string; point?: V3; origin?: V3; direction?: V3; status: string;
  angle_deg?: number; distance_mm?: number; reach_share?: number; wrist_deg?: number; on_target?: boolean;
};
export type Obstacle = { id: string; center: V3; half: V3; axes: [V3, V3, V3] };
export interface Targets {
  aims?: { look?: AimPoint; lHand?: AimedHand; rHand?: AimedHand; lFoot?: AimedFoot; rFoot?: AimedFoot; obstacles?: Obstacle[] };
  seat: V3;                                  // seat reference point: where the hip centre goes
  recline: number;                           // trunk lean back from vertical, degrees
  grip: { l: Stick; r: Stick };              // joysticks
  elbow: { l: V3; r: V3 };                   // armrest points the elbows swivel toward (IK poles)
  armrest: { l: V3; r: V3 };                 // where a flat palm rests
  touch: V3; touchNormal: V3;                // touchscreen point and the direction the screen faces
  feet: { l: V3; r: V3 };                    // resting place of each sole's centre under the ankle, on the floor
  pedals: Pedal[]; kneeOut: number;          // pedals; how far the knees fall outward, metres
  hipAbovePan: number;                       // hip centre above the seat pan's top (the pan is drawn from it); raise it for a firmer cushion
  screen: { centre: V3; width: number; height: number; curve?: number };   // curve: how much nearer the screen's side edges are than its centre, metres (a curved monitor's sagitta); without it the stand-in rule [operator.head] screen_curve
  mountClash?: { l: number; r: number };     // how far a grip mount still meets the thigh (m); an ergonomic finding when > 0
  seatFront?: number;                        // z of the pan's front edge (fitted per person; set it to fix the rig's depth)
  seatFit?: { crease_z: number; full_front: number; rule: string };       // where the person's knee crease is (for the conflict report)
}
/** Per-person data measured on the mesh at bake time (the manifest's `motion.persons`). */
export interface BodyFit {
  key?: number[];
  capsules: { joint: string; a: V3; b: V3; ra: number; rb: number }[];        // joint-relative, rest world axes
  arm: { upper: number[]; fore: number[]; hand: number };                       // radii: [near end, far end]
  seat?: { buttock_below_hip_m: number; back_behind_hip_m: number; pelvis_behind_hip_m: number;
    hip_above_pan_m?: number; compress_m?: number; pan_drop_m?: number; depth_m?: number; buttock_popliteal_m?: number; heel_back_m?: number;
    hip_above_pan_compression_m?: number; compress_rule_m?: number; cushion_compress_m?: number };
}
export interface Stick { pivot: V3; length: number; radius: number; profile?: number[][]; hold?: number[]; section?: number[][]; ref?: V3 }   // section: per profile height, the radius by direction round the axis (bins from ref, counter-clockwise about the axis; index.ts gripSection)   // hold: [from, to] along the axis, the handle section a closed hand wraps (the rig's D_grip_axis_*.hold)   // pivot at the base; grip centre `length` up the stick; profile: [t, radius] pairs, t metres along the stick from the grip centre (up positive), the real handle's radius there (the rig binding's); without it a cylinder of `radius`
/** The handle's radius at height t in the direction d (from the axis, any length) round the axis `axis`, from its measured cross-section
 *  (`section`, `ref`); without one, radiusAt. The profile is the largest radius at each height, but the handle is narrower at its front,
 *  where the fingers lie (designer, REVIEW-11: the fingers floated 10 mm above it). */
export function radiusAround(st: Stick | undefined, t: number, d: V3, axis: V3, fallback: number): number {
  const S = st?.section, P = st?.profile; if (!st || !S || !P || !st.ref || S.length !== P.length || !S[0]?.length) return radiusAt(st, t, fallback);
  const e1 = norm(sub(st.ref, mul(axis, dot(st.ref, axis)))), e2 = cross(axis, e1), N = S[0].length;
  let th = Math.atan2(dot(d, e2), dot(d, e1)); if (th < 0) th += 2 * Math.PI;
  const f = (th / (2 * Math.PI)) * N, i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, w = f - Math.floor(f), at = (row: number[]) => row[i0] * (1 - w) + row[i1] * w;
  if (t <= P[0][0]) return at(S[0]);
  for (let k = 1; k < P.length; k++) if (t <= P[k][0]) { const u = (t - P[k - 1][0]) / (P[k][0] - P[k - 1][0] || 1); return at(S[k - 1]) * (1 - u) + at(S[k]) * u; }
  return at(S[S.length - 1]);
}
/** The grip's radius at t metres along its axis from the grip centre (up positive): the profile's, else the stick's radius, else `fallback`. */
export function radiusAt(st: Stick | undefined, t: number, fallback: number): number {
  const P = st?.profile; if (!P || P.length < 2) return st?.radius ?? fallback;
  if (t <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) if (t <= P[i][0]) { const a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0] || 1); }
  return P[P.length - 1][1];
}
export interface Pedal { heel: V3; pitch: number; travel: number }               // heel point on the floor, rest pitch (deg, toes up), press travel (deg)
export interface Controls {
  hand: { l: Partial<Record<HandGoal, number>>; r: Partial<Record<HandGoal, number>> };      // weights; they are normalised
  open: { l: number; r: number };            // 0 closed on the goal's own pose, 1 relaxed (used while travelling)
  stick: { l: [number, number]; r: [number, number] };                           // forward and left deflection, degrees
  pedal: { foot: "l" | "r"; index: number; on: number; press: number };           // on: 0 foot at rest, 1 on the pedal; press 0..1
  gaze: [number, number];                    // where on the screen: -1..1 across (+ = the figure's left) and up
  lean: number;                              // extra trunk lean forward, degrees
  headOverride?: [number, number] | null;    // yaw left and pitch down in degrees, instead of following the gaze
}
export interface ContactPlane { name: string; point: V3; normal: V3; compress_m: number; pan?: PanSolid; limit_m?: number; bulge?: number; radius?: number }
export interface PanSolid { top: number; front: number; rear: number; halfWidth: number; thickness: number; edge: number; kneeRestY: number; hipRestY: number; hipRestX: number }

// ---- small maths ------------------------------------------------------------------------------------------------------
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s], dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]), norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const QI: Q = [0, 0, 0, 1], RAD = Math.PI / 180;
const qmul = (a: Q, b: Q): Q => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q: Q, v: V3): V3 => { const u: V3 = [q[0], q[1], q[2]], t = mul(cross(u, v), 2); return add(add(v, mul(t, q[3])), cross(u, t)); };
const qaxis = (axis: V3, deg: number): Q => { const a = norm(axis), s = Math.sin(deg * RAD / 2); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(deg * RAD / 2)]; };
const qnorm = (q: Q): Q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qangle = (a: Q, b: Q) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) / RAD;
function qslerp(a: Q, b: Q, t: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const s = d < 0 ? -1 : 1; d = Math.min(1, Math.abs(d));
  const th = Math.acos(d), sn = Math.sin(th); const wa = sn < 1e-6 ? 1 - t : Math.sin((1 - t) * th) / sn, wb = (sn < 1e-6 ? t : Math.sin(t * th) / sn) * s;
  return qnorm([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb]);
}
/** Rotation whose columns are the orthonormalised basis (x, y-ish): x is kept, y is made perpendicular to it. */
function qbasis(x: V3, y: V3): Q {
  const X = norm(x), Z = norm(cross(X, y)), Y = cross(Z, X);
  const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2], tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return qnorm([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]); }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return qnorm([s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]); }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return qnorm([(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]); }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2; return qnorm([(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]);
}
/** The rotation that takes the frame (x0, y0) onto the frame (x1, y1). */
const qframes = (x0: V3, y0: V3, x1: V3, y1: V3): Q => qmul(qbasis(x1, y1), qinv(qbasis(x0, y0)));
/** Closest approach of two segments: [parameter on the first, parameter on the second, distance]. */
function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): [number, number, number] {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r); let sN: number, tN: number;
  if (a < 1e-12 && e < 1e-12) { sN = 0; tN = 0; }
  else if (a < 1e-12) { sN = 0; tN = Math.min(1, Math.max(0, f / e)); }
  else { const c = dot(d1, r);
    if (e < 1e-12) { tN = 0; sN = Math.min(1, Math.max(0, -c / a)); }
    else { const b = dot(d1, d2), den = a * e - b * b; sN = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0; tN = (b * sN + f) / e;
      if (tN < 0) { tN = 0; sN = Math.min(1, Math.max(0, -c / a)); } else if (tN > 1) { tN = 1; sN = Math.min(1, Math.max(0, (b - c) / a)); } } }
  return [sN, tN, len(sub(add(p1, mul(d1, sN)), add(p2, mul(d2, tN))))];
}
const smooth = (u: number) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const ramp = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
const v3 = (a: number[]): V3 => [a[0], a[1], a[2]];

// ---- the grip-pose library: knuckle / middle / tip flexion in degrees per finger, thumb base / middle / tip, finger spread -------
const FINGERS = ["index", "middle", "ring", "pinky"] as const;
export type HandPose = { index: number[]; middle: number[]; ring: number[]; pinky: number[]; thumb: number[]; spread: number; dev?: Partial<Record<"index" | "middle" | "ring" | "pinky", number>> };   // dev: a finger turned toward the little finger at its knuckle (deg; wrapGrip on a real handle)
/** A record [[index], [middle], [ring], [pinky], [thumb], [spread]] of runtime-person.toml as a hand pose. */
const pose6 = (r: number[][]): HandPose => ({ index: [...r[0]], middle: [...r[1]], ring: [...r[2]], pinky: [...r[3]], thumb: [...r[4]], spread: r[5][0] });
export const GRIPS: Record<GripName, HandPose> = {
  relaxed: pose6(O.grips.relaxed),   // the designer's HAND_RELAXED
  point: pose6(O.grips.point),       // HAND_POINT
  flat: pose6(O.grips.flat),         // on an armrest or a screen
  fist: pose6(O.grips.fist),         // HAND_FIST
  power: pose6(O.grips.power),       // replaced per body by wrapGrip()
};
const blendPose = (parts: [HandPose, number][]): HandPose => {
  const out: any = { index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], pinky: [0, 0, 0], thumb: [0, 0, 0], spread: 0 }; let W = 0;
  for (const [, w] of parts) W += w;
  for (const [p, w] of parts) { for (const f of [...FINGERS, "thumb"] as const) for (let k = 0; k < 3; k++) out[f][k] += p[f][k] * w / (W || 1); out.spread += p.spread * w / (W || 1); }
  return out;
};
void blendPose;

type PoseQ = Record<string, Q>;                      // per joint (name without the side suffix): rotation relative to the parent, in rest world axes
const OWN = /^(root|pelvis|spine_0\d|neck_0\d|head|eye_[lr]|(clavicle|upperarm|lowerarm|hand|thigh|calf|foot|ball)(_twist_0\d)?_[lr]|(thumb|index|middle|ring|pinky)_(0\d|metacarpal)_[lr])$/;
interface Hand { pointDir: V3; pointFingers: { name: string; joints: V3[] }[]; palmT?: number; palmR?: number; wrap?: { middle_wrap_deg: number; circumference_mm: number; fingertip_to_thumb_mm: number }; f: V3; n: V3; across: V3; axes: Record<string, V3>; gripPoint: V3; tip: V3; palm: V3; power: HandPose; padPoint: V3; lib: Record<GripName, PoseQ>; tipRest?: Record<string, V3>; segR?: Record<string, number[]> }
const SEG_R: Record<string, number[]> = { thumb: HAND.segment_radius[0], index: HAND.segment_radius[1], middle: HAND.segment_radius[2], ring: HAND.segment_radius[3], pinky: HAND.segment_radius[4] };
const CHAINS: string[][] = [["thumb_01", "thumb_02", "thumb_03"], ...FINGERS.map((f) => [`${f}_metacarpal`, `${f}_01`, `${f}_02`, `${f}_03`])];
/** RR's hand poses from the manifest, per pose and side, as joint rotations (filled by adoptHandPoses). */
const ADOPTED: Partial<Record<GripName, { l: PoseQ; r: PoseQ }>> = {};

export class Operator {
  names: string[]; parent: number[]; P0: V3[]; Q0: Q[]; ix: Record<string, number> = {};
  D: Q[]; P: V3[]; pelvis: V3 = [0, 0, 0];
  targets!: Targets; hands: { l: Hand; r: Hand };
  idle: { fps: number; frames: number; joints: Record<string, number[][]>; pelvis_sway_m?: number[][] } | null = null; idleGain = 1;
  time = 0; head: [number, number] = [0, 0]; headV: [number, number] = [0, 0]; leanNow = 0; gazePoint: V3 = [0, 0, 0];
  explicitGaze = false;
  aimLean = 0;
  private aimedFeet: Partial<Record<"l" | "r", V3>> = {};
  private handStatus: Partial<Record<"l" | "r", "behind" | "blocked" | "aimed">> = {};
  private aimSearch = new Map<string, { roll: number; swivel: number; retreat: number; pitch: number; yaw: number } | null>();
  report = { handErr: { l: 0, r: 0 }, footErr: { l: 0, r: 0 }, reach: { l: 0, r: 0 }, legReach: { l: 0, r: 0 }, eyeInHead: 0, wrist: 0, armPen: { l: -1, r: -1 } as Record<string, number> };
  gripRadius: number = HAND.grip_radius; wristLimit: number = ARM.wrist_limit; fingerOpen: Record<string, Record<string, number>> = { l: {}, r: {} };     // the clamp's opening per finger joint (degrees)
  fit: BodyFit | null = null; margin: number = ARM.margin; swivel: Record<string, number> = { l: 0, r: 0 }; shift: Record<string, number> = { l: 0, r: 0 };
  elbowPrev: Record<string, V3 | null> = { l: null, r: null }; foreBase: Record<string, number> = { l: 0, r: 0 };     // last frame's elbow; the forearm's overlap with the held grip
  contactPlanes: ContactPlane[] = [];
  clash: { what: string; depth_mm: number }[] = [];        // real overlaps between the rig and this body that placement could not remove
  gripNow: Record<string, { centre: V3; axis: V3; on: boolean }> = {}; touchD: Record<string, Q> = {};
  seatRule?: string; wideArmrest?: boolean; gripBase?: Record<string, Record<string, number>>;

  constructor(rest: Rest) {
    this.names = rest.names; this.parent = rest.parent; this.P0 = rest.pos.map((p) => [p[0], p[1], p[2]] as V3); this.Q0 = rest.rot.map((q) => qnorm([q[0], q[1], q[2], q[3]]));
    rest.names.forEach((n, i) => (this.ix[n] = i)); this.D = rest.names.map(() => QI); this.P = this.P0.map((p) => [...p] as V3);
    this.hands = { l: this.buildHand("l", rest.tips), r: this.buildHand("r", rest.tips) };
  }
  j(n: string) { const i = this.ix[n]; if (i === undefined) throw new Error("operator: the skeleton has no joint named " + n); return i; }
  r0(n: string): V3 { return this.P0[this.j(n)]; }
  dir0(a: string, b: string): V3 { return norm(sub(this.r0(b), this.r0(a))); }
  len0(a: string, b: string) { return len(sub(this.r0(b), this.r0(a))); }

  // ---- hand geometry from the rest pose: palm frame, finger flexion axes, the point of the palm that sits on a grip -----------
  buildHand(s: "l" | "r", tips?: Record<string, number[]>, stick?: Stick): Hand {
    const g = (n: string) => this.r0(`${n}_${s}`), h = g("hand"), Rg = radiusAt(stick, 0, this.gripRadius);
    let n = norm(cross(sub(g("index_01"), h), sub(g("pinky_01"), h)));
    if (dot(n, sub(g("thumb_03"), g("index_metacarpal"))) < 0) n = mul(n, -1);                // palmar side: where the thumb sits
    const f = norm(sub(g("middle_01"), h)), across = norm(sub(g("pinky_01"), g("index_01"))), axes: Record<string, V3> = {};
    for (const fn of FINGERS) for (let k = 1; k <= 3; k++) {
      const a = g(`${fn}_0${k}`), b = k < 3 ? g(`${fn}_0${k + 1}`) : add(g(`${fn}_03`), sub(g(`${fn}_03`), g(`${fn}_02`)));
      axes[`${fn}_0${k}`] = norm(cross(norm(sub(b, a)), n));                                   // positive angle curls toward the palm
    }
    for (let k = 1; k <= 3; k++) {
      const a = g(`thumb_0${k}`), b = k < 3 ? g(`thumb_0${k + 1}`) : add(g("thumb_03"), sub(g("thumb_03"), g("thumb_02")));
      axes[`thumb_0${k}`] = norm(cross(norm(sub(b, a)), add(mul(n, HAND.thumb_close_axis[0]), mul(across, HAND.thumb_close_axis[1]))));   // the thumb closes across the palm
    }
    const tipOf = (fn: string): V3 => (tips?.[`${fn}_tip_${s}`] as V3) ?? add(g(`${fn}_03`), mul(sub(g(`${fn}_03`), g(`${fn}_02`)), HAND.tip_extension));
    const palm = lerp(h, lerp(g("index_01"), g("pinky_01"), HAND.palm_centre[0]), HAND.palm_centre[1]);   // centre of the palm, in the knuckle plane
    const hs = len(sub(g("middle_01"), h)) / HAND.reference_length;                           // hand size against the median man's
    const thick = HAND.palm_pad * hs;                                                          // palm pad over the joint plane
    const hand: Hand = { f, n, across, pointDir: f, pointFingers: [], axes, palm: sub(palm, h), tip: sub(tipOf("index"), h), gripPoint: [0, 0, 0], power: GRIPS.power, padPoint: sub(add(palm, mul(n, thick)), h), lib: {} as any };
    const crease = lerp(h, lerp(g("index_01"), g("pinky_01"), HAND.palm_centre[0]), HAND.grip_crease);   // a held stick lies along the knuckle crease, not the palm's centre
    // On a real handle (a profile from the rig): the palm's centre at the middle of the hold section, but no higher than keeps the index
    // knuckle below its top (the button head clear of the palm), and the palm on the handle's surface: its widest radius under the palm.
    // Without a profile: the lab's 40 mm cylinder, palm centre at the grip centre (tc = 0, radius Rg) - the lab's behaviour exactly.
    let tc = 0, Rpalm = Rg;
    if (stick?.profile) {
      // the palm spans from the little-finger knuckle to the higher of the index knuckle and the thumb's base (the ball of the thumb)
      const tI = Math.max(-dot(sub(g("index_01"), crease), across), -dot(sub(g("thumb_01"), crease), across)), tP = -dot(sub(g("pinky_01"), crease), across), hold = stick.hold;
      if (hold) {
        tc = (hold[0] + hold[1]) / 2;
        // the button head starts where the handle grows wider than at the hold's middle; the palm's skin above the index knuckle stays below it
        const r0 = radiusAt(stick, tc, this.gripRadius); let head = hold[1];
        for (let t = tc; t <= hold[1] + 1e-9; t += HDL.sample_step) if (radiusAt(stick, t, this.gripRadius) > r0 + HDL.head_rise) { head = t; break; }
        tc = Math.min(tc, head - tI - HDL.knuckle_pad * hs);
      }
      Rpalm = 0; for (let t = tc + Math.min(tP, tI); t <= tc + Math.max(tP, tI) + 1e-9; t += HDL.sample_step) Rpalm = Math.max(Rpalm, radiusAt(stick, t, this.gripRadius));
    }
    hand.palmT = tc; hand.palmR = Rpalm;
    hand.gripPoint = sub(add(add(crease, mul(n, thick + Rpalm)), mul(across, tc)), h);         // where the grip centre's axis point is, relative to the wrist (the axis runs along -across in the held hand)
    hand.power = this.wrapGrip(s, hand, tipOf, stick);
    // what the finger clamp needs: each tip's offset from its last joint (rest) and the joint-centre-to-skin radius of each finger
    hand.tipRest = Object.fromEntries([...FINGERS, "thumb"].map((fn) => [fn, sub(fn === "thumb" ? add(g("thumb_03"), mul(sub(g("thumb_03"), g("thumb_02")), HAND.tip_extension)) : tipOf(fn), g(`${fn}_03`))]));
    // each finger segment's capsule radius, measured on the hand mesh, median man's values per unit hand size
    hand.segR = Object.fromEntries(Object.entries(SEG_R).map(([fn, r]) => [fn, r.map((x) => x * hs)]));
    // the library as joint rotations: RR's poses where the manifest has them (opposed thumb, rest-curl offsets), the built-in angles otherwise
    const fromAngles = (p: HandPose): PoseQ => { const o: PoseQ = {}; for (const fn of [...FINGERS, "thumb"] as const) for (let k = 1; k <= 3; k++) { let e = qaxis(axes[`${fn}_0${k}`], p[fn][k - 1]); if (k === 1 && fn !== "thumb") e = qmul(qaxis(n, ((FINGERS.indexOf(fn as any) - 1.5) * p.spread + (p.dev?.[fn as "index"] ?? 0)) * (s === "l" ? -1 : 1)), e); o[`${fn}_0${k}`] = e; } return o; };
    for (const k of Object.keys(GRIPS) as GripName[]) hand.lib[k] = ADOPTED[k]?.[s] ?? fromAngles(k === "power" ? hand.power : GRIPS[k]);
    if (ADOPTED.power) { const wrapped = fromAngles(hand.power), rr = ADOPTED.power[s]; hand.lib.power = { ...rr, ...Object.fromEntries(Object.entries(wrapped).filter(([j]) => !j.startsWith("thumb"))) }; for (const fn of FINGERS) if (hand.power[fn] === GRIPS.power[fn]) for (let k = 1; k <= 3; k++) if (rr[`${fn}_0${k}`]) hand.lib.power[`${fn}_0${k}`] = rr[`${fn}_0${k}`]; }
    // the thumb of the power grip: RR's opposed pose, opened about the stick's own direction until it clears the cylinder by the
    // thumb pad's measured depth inside it (a pad the joints do not show)
    if (ADOPTED.power) {
      const c = add(h, hand.gripPoint), dAx = (p: V3) => { const d = sub(p, c); return len(sub(d, mul(across, dot(d, across)))); }, ch = ["thumb_01", "thumb_02", "thumb_03"];
      const pts = (pre: Q): V3[] => { let Dacc: Q = QI, p = g("thumb_01"); const out: V3[] = []; ch.forEach((jn, i) => { Dacc = qmul(Dacc, i === 0 ? qmul(pre, hand.lib.power[jn] ?? QI) : hand.lib.power[jn] ?? QI); p = add(p, qrot(Dacc, sub(i < 2 ? g(ch[i + 1]) : tipOf("thumb"), g(jn)))); out.push(p); }); return out; };
      const probe = HAND.thumb_open[0], most = HAND.thumb_open[1];
      // a handle wider than the lab's cylinder where the thumb lies (the real lever's profile) opens the thumb by the difference
      // on a real handle: the clearance of each thumb point from the handle's surface at its height (pad radius of its segment); in the lab's
      // cylinder: the distance from the axis, opened by the thumb pad's measured depth (the lab's rule exactly)
      const tr = SEG_R.thumb.map((x) => x * hs), prof = !!stick?.profile;
      const near = (pre: Q) => Math.min(...pts(pre).map((p, i) => dAx(p) - (prof ? radiusAt(stick, -dot(sub(p, c), across), this.gripRadius) + tr[i] : 0)));
      const want = prof ? HDL.thumb_margin : near(QI) + HAND.thumb_clear * hs, sgn = near(qaxis(across, probe)) > near(qaxis(across, -probe)) ? 1 : -1;
      let lo = 0, hi = most; if (near(qaxis(across, sgn * hi)) > want) { for (let it = 0; it < HAND.thumb_iterations; it++) { const mid = (lo + hi) / 2; if (near(qaxis(across, sgn * mid)) < want) lo = mid; else hi = mid; } } else lo = hi;
      hand.lib.power = { ...hand.lib.power, thumb_01: qmul(qaxis(across, sgn * hi), hand.lib.power.thumb_01 ?? QI) };
    }
    // On a real handle, facts of the held hand (no judgement): how far round the axis the middle finger wraps from the palm's contact, the
    // handle's circumference under the palm, and how far the middle fingertip stays from the thumb tip
    if (stick?.profile) {
      const c = add(h, hand.gripPoint), ax = mul(across, -1), radial = (p: V3) => { const d = sub(p, c); return norm(sub(d, mul(ax, dot(d, ax)))); };
      const chainPts = (ch: string[], end: V3) => { let Dacc: Q = QI, p = g(ch[0]); const out: V3[] = [p]; ch.forEach((jn, i) => { Dacc = qmul(Dacc, hand.lib.power[jn] ?? QI); const b = i < ch.length - 1 ? g(ch[i + 1]) : end; p = add(p, qrot(Dacc, sub(b, g(jn)))); out.push(p); }); return out; };
      const mid = chainPts(["middle_metacarpal", "middle_01", "middle_02", "middle_03"], tipOf("middle")).slice(1), th = chainPts(["thumb_01", "thumb_02", "thumb_03"], tipOf("thumb"));
      let deg = Math.acos(Math.max(-1, Math.min(1, dot(mul(n, -1), radial(mid[0]))))) / RAD;
      for (let i = 1; i < mid.length; i++) deg += Math.acos(Math.max(-1, Math.min(1, dot(radial(mid[i - 1]), radial(mid[i]))))) / RAD;
      hand.wrap = { middle_wrap_deg: +deg.toFixed(0), circumference_mm: +(2 * Math.PI * Rpalm * 1000).toFixed(0), fingertip_to_thumb_mm: +(len(sub(mid[mid.length - 1], th[th.length - 1])) * 1000).toFixed(0) };
    }
    // Fingertips and joint centres in the package's authored pointing hand, relative to the wrist.
    for (const name of [...FINGERS, "thumb"]) {
      const chain = CHAINS.find((c) => c.includes(`${name}_01`))!;
      let Dacc: Q = QI, p = sub(g(chain[0]), h);
      const joints: V3[] = [];
      chain.forEach((joint, i) => {
        if (!joint.endsWith("metacarpal")) joints.push(p);
        Dacc = qmul(Dacc, hand.lib.point[joint] ?? QI);
        const next = chain[i + 1], delta = next ? sub(g(next), g(joint)) : hand.tipRest![name];
        p = add(p, qrot(Dacc, delta));
      });
      joints.push(p);
      if (name === "index") { hand.tip = p; hand.pointDir = norm(sub(p, joints[joints.length - 2])); }
      hand.pointFingers.push({ name, joints });
    }
    return hand;
  }
  /** Power grip solved on this hand: each finger joint flexes until the next joint (then the tip) touches the cylinder. */
  wrapGrip(s: "l" | "r", hand: Hand, tipOf: (f: string) => V3, stick?: Stick): HandPose {
    const h = this.r0(`hand_${s}`), c = add(h, hand.gripPoint), a = hand.across, out: any = { spread: 0 }, hs = len(sub(this.r0(`middle_01_${s}`), h)) / HAND.reference_length;
    const pad: Record<string, number> = { index: WRAP.finger_pad[0], middle: WRAP.finger_pad[1], ring: WRAP.finger_pad[2], pinky: WRAP.finger_pad[3] };   // joint centre to finger pad, measured on the skinned hand
    const distAxis = (p: V3) => { const d = sub(p, c); return len(sub(d, mul(a, dot(d, a)))); };
    const lim: number[][] = WRAP.limits;
    // the handle's real cross-section where the finger lies, once the hand has been solved on it (its rotation maps the rest hand onto the stick)
    const Dh = stick?.section && this.gripNow[s] ? this.D[this.j(`hand_${s}`)] : null, axW = this.gripNow[s]?.axis;
    const Rat = (p: V3, t: number) => (Dh && axW ? radiusAround(stick, t, qrot(Dh, sub(p, c)), axW, this.gripRadius) : radiusAt(stick, t, this.gripRadius));
    if (stick?.profile) {
      // On a real handle (MV-core): each finger's three joints solved together so that every joint centre beyond the knuckle and the tip
      // lie on the handle's surface at their own height plus the finger's pad (this person's phalanx lengths and pad radii), never
      // inside it; a joint stops at its limits, and what cannot reach the handle is left short (the wrap report says so).
      for (const fn of FINGERS) {
        const chain = [1, 2, 3].map((k) => this.r0(`${fn}_0${k}_${s}`)).concat([tipOf(fn)]), pd = pad[fn] * hs;
        // A = knuckle, middle and tip flexion, then (A[3]) the finger turned toward the little finger about the palm's normal at its knuckle,
        // as fromAngles composes it: flexed first, then turned
        const place = (A: number[]) => { let pts = chain.map((p) => [...p] as V3); for (let k = 0; k < 3; k++) { const q = qaxis(hand.axes[`${fn}_0${k + 1}`], A[k]); pts = pts.map((p, i) => (i <= k ? p : add(pts[k], qrot(q, sub(p, pts[k]))))); }
          if (A[3]) { const q = qaxis(hand.n, A[3] * (s === "l" ? -1 : 1)); pts = pts.map((p, i) => (i === 0 ? p : add(pts[0], qrot(q, sub(p, pts[0]))))); } return pts; };
        // every point on the surface, never inside; and the nearest one touching (a finger that rests on the handle: REVIEW-11)
        const cost = (A: number[]) => { const pts = place(A); let e = 0, near = Infinity; for (let i = 1; i < pts.length; i++) { const R = Rat(pts[i], -dot(sub(pts[i], c), a)) + pd - (i === 3 ? WRAP.tip_clear : 0), d = distAxis(pts[i]) - R; e += d < 0 ? -d * HDL.inside_weight : d; near = Math.min(near, d); } return e + HDL.contact_weight * Math.max(near, 0); };
        // first a coarse search over the knuckle and the middle joint, the tip joint following at its share of the middle one, so that
        // a finger whose straight start lies by the button head is not held there by the joint-by-joint search (REVIEW-11: the index
        // pointed into the air past the handle on every person); then that search from the best of the grid
        // the index may also turn toward the middle finger (its path otherwise rises into the button head: it lay straight beside it)
        const dv = fn === "index" ? HDL.index_turn : [0, 0];
        let A = [lim[0][0], lim[1][0], lim[2][0], 0], be0 = cost(A);
        for (let d = dv[0]; d <= dv[1] + 1e-9; d += HDL.wrap_grid) for (let x = lim[0][0]; x <= lim[0][1] + 1e-9; x += HDL.wrap_grid) for (let y = lim[1][0]; y <= lim[1][1] + 1e-9; y += HDL.wrap_grid) {
          const B = [x, y, Math.min(lim[2][1], Math.max(lim[2][0], y * HDL.tip_share)), d], e = cost(B); if (e < be0) { be0 = e; A = B; } }
        for (let pass = 0; pass < HDL.wrap_passes; pass++) for (let k = 0; k < 3; k++) {
          let best = A[k], be = Infinity;
          for (let x = lim[k][0]; x <= lim[k][1] + 1e-9; x += HDL.wrap_step[0]) { A[k] = x; const e = cost(A); if (e < be) { be = e; best = x; } }
          for (let x = best - HDL.wrap_step[0]; x <= best + HDL.wrap_step[0] + 1e-9; x += HDL.wrap_step[1]) { A[k] = Math.min(lim[k][1], Math.max(lim[k][0], x)); const e = cost(A); if (e < be) { be = e; best = A[k]; } }
          A[k] = best;
        }
        out[fn] = A.slice(0, 3).map((x) => Math.round(x / WRAP.round) * WRAP.round);
        if (A[3]) (out.dev ??= {})[fn] = A[3];
      }
    } else for (const fn of FINGERS) {
      const chain = [1, 2, 3].map((k) => this.r0(`${fn}_0${k}_${s}`)).concat([tipOf(fn)]), ang = [0, 0, 0]; let pts = chain.map((p) => [...p] as V3), ok = true;
      for (let k = 0; k < 3; k++) {                                                            // the three hinges of a finger are parallel, so one axis serves the chain
        // the handle's radius where the finger lies on it (t along the stick, up = -across in the held hand): a flared lever takes the lower fingers wider
        const ax = hand.axes[`${fn}_0${k + 1}`], Rk = (p: V3) => radiusAt(stick, -dot(sub(p, c), a), this.gripRadius) + pad[fn] * hs - (k === 2 ? WRAP.tip_clear : 0); let lo = 0, hi = lim[k][1];
        const bent = (deg: number) => { const q = qaxis(ax, deg); return pts.map((p, i) => (i <= k ? p : add(pts[k], qrot(q, sub(p, pts[k]))))); };
        const out_ = (deg: number) => { const p = bent(deg)[k + 1]; return distAxis(p) > Rk(p); };
        if (out_(hi)) { lo = hi; ok = ok && k > 0; }                                             // cannot reach the handle: close fully
        else if (distAxis(pts[k + 1]) > Rk(pts[k + 1])) for (let it = 0; it < WRAP.iterations; it++) { const mid = (lo + hi) / 2; if (out_(mid)) lo = mid; else hi = mid; }
        ang[k] = Math.max(lim[k][0], lo); pts = bent(ang[k]);
      }
      out[fn] = ok ? ang.map((x) => Math.round(x / WRAP.round) * WRAP.round) : GRIPS.power[fn];
    }
    out.thumb = GRIPS.power.thumb;                                                             // thumb opposition is not solved: a fixed wrap
    return out as HandPose;
  }

  /** Analytic finger-against-grip clamp. For each finger and the thumb, its three segments (joint to joint, last joint to tip)
   *  are capsules of the finger's joint-to-skin radius; where one enters this side's grip cylinder by more than it does in the
   *  held grip (recorded while gripping) plus an allowance, the finger opens (extends) just enough, distal joints first. The
   *  opening follows its target at a limited rate while opening and while closing again, so it does not pop. */
  clampFingers(s: string, H: Hand, centre: V3, axis: V3, dt: number, gripping: boolean) {
    if (!H.tipRest || !H.segR) return;
    const st0 = this.targets?.grip?.[s as "l" | "r"], half = HAND.grip_half_length, Rg = (v: number) => radiusAt(st0, (2 * v - 1) * half, this.gripRadius);   // v: 0 at the segment's lower end, 1 at its upper
    const D = this.D, A0 = sub(centre, mul(axis, HAND.grip_half_length)), A1 = add(centre, mul(axis, HAND.grip_half_length)), hj = this.j(`hand_${s}`), st = this.fingerOpen[s];
    const ph = this.P[hj];
    for (const chain of CHAINS) {
      const fn = chain[chain.length - 1].split("_")[0], joints = chain.filter((b) => !b.endsWith("metacarpal")), r = H.segR[fn];
      const ids = chain.map((b) => this.j(`${b}_${s}`)), local = ids.map((j) => qmul(qinv(D[this.parent[j]]), D[j]));
      const pose = (open: number[]) => {               // world deltas and points of the chain with the given openings (degrees, per non-metacarpal joint)
        let Dp: Q = D[hj], p: V3 = ph; const Ds: Q[] = [], ps: V3[] = [];
        chain.forEach((b, i) => {
          const j = ids[i], par = this.parent[j]; p = add(p, qrot(Dp, sub(this.P0[j], this.P0[par])));
          const k = joints.indexOf(b); let e = local[i]; if (k >= 0 && open[k]) e = qmul(e, qaxis(H.axes[b], -open[k])); Dp = qmul(Dp, e); Ds.push(Dp); ps.push(p);
        });
        const n = chain.length; ps.push(add(ps[n - 1], qrot(Ds[n - 1], H.tipRest![fn]))); return { Ds, ps };
      };
      const pens = (open: number[]) => { const { ps } = pose(open), off = chain.length - joints.length, out: number[] = [];
        for (let k = 0; k < joints.length; k++) { const a = ps[off + k], b = ps[off + k + 1], [, v, d] = segSeg(a, b, A0, A1); out.push(Rg(v) + r[k] - d); }
        return out; };
      const target = [0, 0, 0], base = (this.gripBase ??= { l: {}, r: {} })[s];
      if (gripping) { pens(target).forEach((x, k) => (base[`${fn}${k}`] = Math.max(base[`${fn}${k}`] ?? -1, x))); }
      const allow = (k: number) => Math.max(CLAMP.allow_min, (base[`${fn}${k}`] ?? 0) + CLAMP.allow_extra);
      for (let it = 0; it < CLAMP.iterations && !gripping; it++) {
        const pe = pens(target); let k = -1; for (let q = pe.length - 1; q >= 0; q--) if (pe[q] > allow(q)) { k = q; break; }
        if (k < 0) break;
        let j = k; while (j >= 0 && target[j] >= CLAMP.open_max) j--; if (j < 0) break; target[j] = Math.min(CLAMP.open_max, target[j] + CLAMP.open_step);
      }
      const fresh = joints.every((b) => st[b] === undefined), cur = joints.map((b) => st[b] ?? 0), up = dt > 0 ? CLAMP.rate[0] * dt : fresh ? Infinity : 0, down = dt > 0 ? CLAMP.rate[1] * dt : fresh ? Infinity : 0;   // a re-solve of the same frame (dt 0) holds
      const now = cur.map((c, k) => (target[k] > c ? Math.min(target[k], c + up) : Math.max(target[k], c - down)));
      joints.forEach((b, k) => (st[b] = now[k]));
      if (now.some((x) => x > CLAMP.apply_min)) { const { Ds } = pose(now); ids.forEach((j, i) => (D[j] = Ds[i])); }
    }
  }

  // ---- forward kinematics in delta space ---------------------------------------------------------------------------------------
  fk(from = 0) {
    const pv = this.ix["pelvis"];
    for (let j = from; j < this.names.length; j++) {
      const p = this.parent[j];
      if (j === pv) this.P[j] = [...this.pelvis]; else if (p < 0) this.P[j] = [...this.P0[j]];
      else this.P[j] = add(this.P[p], qrot(this.D[p], sub(this.P0[j], this.P0[p])));
    }
  }
  follow(prefixes: string[] = []) { for (let j = 0; j < this.names.length; j++) { const p = this.parent[j]; if (p >= 0 && (!prefixes.length || prefixes.some((x) => this.names[j].startsWith(x)))) this.D[j] = this.D[p]; } }
  /** Two-bone IK: joints a -> b -> c, c goes to `goal`, b bends toward `pole`. Returns how far the goal was out of reach. */
  twoBone(a: string, b: string, c: string, goal: V3, pole: V3): number {
    const ia = this.j(a), ib = this.j(b), ic = this.j(c), A = this.P[ia], l1 = this.len0(a, b), l2 = this.len0(b, c);
    const d = sub(goal, A), dist = len(d) || 1e-9, n = mul(d, 1 / dist), dc = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-4), (l1 + l2) * IK.reach_max);
    const x = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc), hgt = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
    let ph = sub(pole, A); ph = sub(ph, mul(n, dot(ph, n))); ph = len(ph) < 1e-6 ? norm(cross(n, [1, 0, 0])) : norm(ph);
    const mid = add(add(A, mul(n, x)), mul(ph, hgt)), end = add(A, mul(n, dc));
    // hinge-true: the rest pose's bend plane goes onto the solved bend plane (the rest pose keeps elbows and knees a little bent)
    const d1 = this.dir0(a, b), d2 = this.dir0(b, c); let n0 = cross(d1, d2); n0 = len(n0) < IK.straight ? norm(cross(d1, cross([0, 0, a.startsWith("thigh") ? 1 : -1], d1))) : norm(n0);
    const e1 = norm(sub(mid, A)), e2 = norm(sub(end, mid)); let n1 = cross(e1, e2); n1 = len(n1) < 1e-5 ? norm(cross(e1, ph)) : norm(n1);
    // no sign flip: n0 = d1 x d2 and n1 = e1 x e2 already describe the same bend sense. Only a straight solved limb (n1 undefined
    // above) takes its sense from the pole.
    if (len(cross(e1, e2)) < 1e-5 && dot(cross(e1, ph), n1) * dot(cross(d1, sub(d2, mul(d1, dot(d1, d2)))), n0) < 0) n1 = mul(n1, -1);
    this.D[ia] = qframes(d1, n0, e1, n1); this.D[ib] = qframes(d2, n0, e2, n1);
    this.P[ib] = mid; this.P[ic] = end;
    return Math.max(0, dist - dc);
  }

  /** Deepest overlap (metres; negative = clearance) of the forearm (and the hand, if its rotation is given) with the body's capsules. */
  armPen(s: string, elbow: V3, wrist: V3, Dh: Q | null): number {
    const f = this.fit; if (!f) return -1; let worst = -1;
    // forearm radii are the mesh's 90th-percentile radial extent (elbow bulk included): a share of that is what lies toward the
    // body. The upper arm is not tested: it rests on the trunk by nature.
    const k = ARM.forearm_share, mine: [V3, V3, number, number][] = [[elbow, wrist, f.arm.fore[0] * k, f.arm.fore[1] * k]];
    if (Dh) mine.push([wrist, add(wrist, qrot(Dh, sub(this.r0(`middle_01_${s}`), this.r0(`hand_${s}`)))), f.arm.hand, f.arm.hand]);
    for (const c of f.capsules) {
      const j = this.ix[c.joint]; if (j === undefined) continue; const a = add(this.P[j], qrot(this.D[j], c.a)), b = add(this.P[j], qrot(this.D[j], c.b));
      for (const [p, q, r0, r1] of mine) { const [u, v, d] = segSeg(p, q, a, b); worst = Math.max(worst, r0 + (r1 - r0) * u + c.ra + (c.rb - c.ra) * v - d); }
    }
    return worst;
  }

  /** Deepest overlap (metres; negative = clearance) of a capsule p-q of radius r with the body's capsules. */
  capsulePen(p: V3, q: V3, r: number): number {
    let worst = -1; if (!this.fit) return worst;
    for (const c of this.fit.capsules) { const j = this.ix[c.joint]; if (j === undefined) continue; const a = add(this.P[j], qrot(this.D[j], c.a)), b = add(this.P[j], qrot(this.D[j], c.b)); const [, v, d] = segSeg(p, q, a, b); worst = Math.max(worst, r + c.ra + (c.rb - c.ra) * v - d); }
    return worst;
  }

  /** A rigid rig box against a limb capsule. Expanding the box is conservative at its edges. */
  private hitsRig(a: V3, b: V3, radius: number): boolean {
    const d = sub(b, a);
    for (const box of this.targets.aims?.obstacles ?? []) {
      let lo = 0, hi = 1;
      const start = sub(a, box.center);
      for (const k of [0, 1, 2] as const) {
        const x = dot(start, box.axes[k]), dx = dot(d, box.axes[k]), extent = box.half[k] + radius;
        if (Math.abs(dx) < 1e-9) { if (Math.abs(x) >= extent) { hi = -1; break; } continue; }
        const m = (-extent - x) / dx, n = (extent - x) / dx;
        lo = Math.max(lo, Math.min(m, n)); hi = Math.min(hi, Math.max(m, n));
        if (lo >= hi) break;
      }
      if (lo < hi) return true;
    }
    return false;
  }

  /** Search from the requested fingertip back toward the shoulder, keeping the finger on its pointing line. */
  private aimHand(s: "l" | "r", aim: AimedHand, reachMax: number): Q | null {
    const H = this.hands[s], target = aim.point!, ua = `upperarm_${s}`, la = `lowerarm_${s}`, hand = `hand_${s}`;
    const ia = this.j(ua), ie = this.j(la), iw = this.j(hand), cl = this.j(`clavicle_${s}`), sh = this.P[ia], w0 = this.P[iw], e0 = this.P[ie];
    if (target[2] <= sh[2]) { this.handStatus[s] = "behind"; return null; }
    if (this.aimSearch.get(s) === null) { this.handStatus[s] = "blocked"; return null; }
    const cl0 = this.D[cl], ray = norm(sub(target, sh)), toward = aim.inward ? norm(add(aim.inward, ray)) : ray;
    const clavicle = this.P[cl], clAxis = cross(sub(sh, clavicle), sub(target, clavicle));
    const distance = len(sub(target, sh));
    const over = distance - len(H.tip) - reachMax * ARM.clavicle_from;
    if (over > 0 && len(clAxis) > 1e-6) {
      this.D[cl] = qmul(qaxis(clAxis, Math.min(ARM.clavicle_max, over * ARM.clavicle_gain)), cl0);
      this.fk(cl);
    }
    const A = this.P[ia];
    const upper = this.D[ia], lower = this.D[ie], handRest = this.r0(hand);
    const naturalPole = add(A, [s === "l" ? ARM.pole_offset[0] : -ARM.pole_offset[0], ARM.pole_offset[1], ARM.pole_offset[2]]);
    const restFore = this.dir0(la, hand), handSize = this.len0(hand, `middle_01_${s}`) / HAND.reference_length;
    const palms = ["index", "middle", "pinky"].map((f) => sub(this.r0(`${f}_01_${s}`), handRest));
    const fore = (this.fit?.arm.fore[1] ?? ARM.forearm_radius_default) * AIM.forearm_end_share;
    const preferred = aim.mode === "touch" ? toward : ray;
    const attempt = ({ roll, swivel, retreat, pitch, yaw }: { roll: number; swivel: number; retreat: number; pitch: number; yaw: number }): Q | null => {
      // Tip direction is the posed distal phalanx, and its line goes from the actual tip to the target.
      const axis = qrot(qmul(qaxis([0, 1, 0], yaw), qaxis([1, 0, 0], pitch)), preferred);
      const dh = qmul(qaxis(axis, roll), qframes(H.pointDir, H.n, axis, v3(ARM.touch_palm)));
      const off = qrot(dh, H.tip), end = sub(target, off), d = sub(end, A), along = dot(d, axis);
      const across = sub(d, mul(axis, along)), available = Math.sqrt(Math.max(0, reachMax * reachMax - dot(across, across)));
      const back = Math.max(aim.mode === "point" ? AIM.point_standoff : 0, along - available) + retreat * AIM.backoff;
      const desired = sub(end, mul(axis, back));
      this.twoBone(ua, la, hand, desired, naturalPole);
      const axisArm = norm(sub(this.P[iw], A)), elbow = add(A, qrot(qaxis(axisArm, swivel), sub(this.P[ie], A)));
      this.twoBone(ua, la, hand, desired, elbow);
      const w = this.P[iw], e = this.P[ie], to = sub(target, add(w, off));
      if (aim.mode === "point" && (dot(axis, to) <= 0 || Math.atan2(len(cross(axis, to)), dot(axis, to)) > AIM.point_tolerance * RAD)) return null;
      const restHandAxis = qrot(dh, restFore), foreAxis = norm(sub(w, e));
      if (dot(restHandAxis, foreAxis) < Math.cos(this.wristLimit * RAD)) return null;
      if (this.armPen(s, e, w, dh) > this.margin) return null;
      if (this.hitsRig(e, w, fore) || palms.some((p) => this.hitsRig(w, add(w, qrot(dh, p)), ARM.palm_radius * handSize))) return null;
      for (const finger of H.pointFingers) {
        const joints = finger.joints.map((p) => add(w, qrot(dh, p)));
        for (let i = 0; i < joints.length - 1; i++) {
          const a = joints[i], b = joints[i + 1], r = H.segR![finger.name][i];
          if (i < joints.length - 2) {
            if (this.hitsRig(a, b, r)) return null;
          } else {
            // The reported tip is the end of the skin, not the centre of the last capsule cap.
            const d = norm(sub(b, a)), face = finger.name === "index" && aim.inward;
            const extent = face ? r / Math.max(AIM.finger_contact_cos, dot(d, face)) : r;
            const cap = sub(b, mul(d, Math.min(len(sub(b, a)), extent + 1e-9)));
            if (this.hitsRig(a, cap, r) || this.hitsRig(cap, b, -1e-9)) return null;
          }
        }
      }
      return dh;
    };
    const last = this.aimSearch.get(s);
    if (last) {
      const dh = attempt(last);
      if (dh) { this.handStatus[s] = "aimed"; return dh; }
    }
    for (let retreat = 0; retreat <= AIM.backoff_steps; retreat++) {
      for (const [pitch, yaw] of AIM.approach_angles as number[][]) for (const roll of AIM.hand_rolls as number[]) for (const swivel of AIM.elbow_angles as number[]) {
        const candidate = { roll, swivel, retreat, pitch, yaw }, dh = attempt(candidate);
        if (dh) { this.aimSearch.set(s, candidate); this.handStatus[s] = "aimed"; return dh; }
      }
    }
    this.D[cl] = cl0; this.fk(cl);
    this.P[iw] = w0; this.P[ie] = e0; this.D[ia] = upper; this.D[ie] = lower;
    this.aimSearch.set(s, null);
    this.handStatus[s] = "blocked";
    return null;
  }

  /** Measure the pose after FK, including the point pose's actual index joints. All coordinates here are package-frame metres. */
  aimReport() {
    const aims = this.targets.aims, results: Record<string, AimResult> = {};
    if (!aims) return results;
    const at = (name: string) => this.P[this.j(name)];
    const gaze = aims.look;
    if (gaze) {
      results.look = { mode: "look", target: gaze.id, point: gaze.point, status: "missing" };
      if (gaze.point) {
        const axes = (["eye_l", "eye_r"] as const).map((name) => qrot(qmul(this.D[this.j(name)], this.Q0[this.j(name)]), [0, 0, 1]));
        const eyes = [at("eye_l"), at("eye_r")], origin = mul(add(eyes[0], eyes[1]), 0.5);
        const angle = (a: V3, b: V3) => Math.atan2(len(cross(a, b)), dot(a, b)) / RAD;
        const error = Math.max(...axes.map((axis, i) => angle(axis, sub(gaze.point!, eyes[i]))));
        results.look = { ...results.look, origin, direction: norm(add(axes[0], axes[1])), angle_deg: error, on_target: this.explicitGaze && error <= AIM.gaze_tolerance,
          status: !this.explicitGaze ? "behind" : error <= AIM.gaze_tolerance ? "aimed" : "limited" };
      }
    }
    for (const [s, side] of [["l", "left"], ["r", "right"]] as const) {
      const h = aims[`${s}Hand`], f = aims[`${s}Foot`];
      if (h) {
        const hand = this.hands[s], index = this.j(`index_03_${s}`), shoulder = at(`upperarm_${s}`), wrist = this.j(`hand_${s}`);
        const fingertip = add(this.P[index], qrot(this.D[index], hand.tipRest!.index));
        const direction = norm(sub(fingertip, this.P[index])), arm = this.len0(`upperarm_${s}`, `lowerarm_${s}`) + this.len0(`lowerarm_${s}`, `hand_${s}`) + len(hand.tip);
        const actual = h.mode === "rest" ? add(this.P[wrist], qrot(this.D[wrist], hand.padPoint)) : fingertip;
        const distance = h.point ? len(sub(h.point, actual)) : undefined;
        const to = h.point ? sub(h.point, fingertip) : undefined, solved = this.handStatus[s];
        results[`${side}_hand`] = { mode: h.mode, target: h.id, point: h.point, origin: actual, direction,
          wrist_deg: Math.acos(Math.max(-1, Math.min(1, dot(qrot(this.D[wrist], this.dir0(`lowerarm_${s}`, `hand_${s}`)), norm(sub(this.P[wrist], at(`lowerarm_${s}`))))))) / RAD,
          ...(distance === undefined ? {} : { distance_mm: distance * 1000, reach_share: len(sub(h.point!, shoulder)) / arm }),
          ...(h.mode !== "rest" && to && len(to) > AIM.touch_tolerance ? { angle_deg: Math.atan2(len(cross(direction, to)), dot(direction, to)) / RAD } : {}),
          status: !h.point ? "missing" : solved === "behind" || solved === "blocked" ? solved : h.mode === "point" ? "aimed" : distance! <= AIM.touch_tolerance ? "contact" : "short" };
      }
      if (f) {
        const fi = this.j(`foot_${s}`), offset = this.aimedFeet[s], origin = offset ? add(this.P[fi], qrot(this.D[fi], offset)) : this.P[fi];
        const distance = f.point ? len(sub(f.point, origin)) : undefined;
        results[`${side}_foot`] = { mode: f.mode, target: f.id, point: f.point, origin, ...(distance === undefined ? {} : { distance_mm: distance * 1000 }),
          status: distance === undefined ? "missing" : !offset ? "behind" : distance <= AIM.touch_tolerance ? "contact" : "short" };
      }
    }
    return results;
  }

  // ---- the solve -----------------------------------------------------------------------------------------------------------------
  solve(c: Controls, dt: number, still = false) {
    const T = this.targets, t = (this.time += dt), D = this.D;
    for (let j = 0; j < D.length; j++) D[j] = QI;
    // idle life: breathing, slow weight shifts, plus the captured seated layer if one was loaded
    const breath = Math.sin(t * 2 * Math.PI * IDLE.breath_hz), shift = Math.sin(t * 2 * Math.PI * IDLE.shift_hz[0]) + IDLE.shift_second * Math.sin(t * 2 * Math.PI * IDLE.shift_hz[1] + IDLE.shift_phase);
    const idleAt = (n: string): V3 => {
      if (!this.idle || !this.idle.joints[n]) return [0, 0, 0];
      const f = (t * this.idle.fps) % this.idle.frames, i = Math.floor(f), u = f - i, a = this.idle.joints[n][i], b = this.idle.joints[n][(i + 1) % this.idle.frames];
      return [(a[0] + (b[0] - a[0]) * u) * this.idleGain, (a[1] + (b[1] - a[1]) * u) * this.idleGain, (a[2] + (b[2] - a[2]) * u) * this.idleGain];
    };
    const rv = (v: V3): Q => { const a = len(v); return a < 1e-9 ? QI : qaxis(v, a / RAD); };
    // 1. pelvis on the seat reference point, rolled back with the backrest
    this.leanNow += (c.lean - this.leanNow) * Math.min(1, dt * TRUNK.lean_rate);
    const hipC = mul(add(this.r0("thigh_l"), this.r0("thigh_r")), 0.5), pvOff = sub(hipC, this.r0("pelvis"));
    D[this.j("pelvis")] = qmul(qaxis([0, 0, 1], TRUNK.pelvis_shift_deg * shift), qaxis([1, 0, 0], -T.recline + TRUNK.pelvis_lean_share * this.leanNow));
    this.pelvis = sub(add(T.seat, [TRUNK.pelvis_shift_m * shift, 0, 0]), qrot(D[this.j("pelvis")], pvOff));
    this.aimLean = 0;
    // 2. spine: lean and breathing shared over the five joints; clavicles ride the breath
    const share: number[] = TRUNK.spine_share, chest: number[] = TRUNK.spine_breath_share;
    const spine = () => {
      for (let k = 1; k <= 5; k++) {
        const n = `spine_0${k}`, flex = (TRUNK.spine_lean_gain * this.leanNow + this.aimLean) * share[k - 1] - TRUNK.breath_deg * breath * chest[k - 1];
        D[this.j(n)] = qmul(D[this.parent[this.j(n)]], qmul(rv(idleAt(n)), qmul(qaxis([0, 0, 1], -TRUNK.pelvis_shift_deg * shift * share[k - 1]), qaxis([1, 0, 0], flex))));
      }
      for (const s of ["l", "r"] as const) D[this.j(`clavicle_${s}`)] = qmul(D[this.j("spine_05")], qmul(rv(idleAt(`clavicle_${s}`)), qaxis([0, 0, 1], (s === "l" ? 1 : -1) * TRUNK.clavicle_breath_deg * breath)));
      this.follow(["neck", "head", "eye"]); this.fk();
    };
    spine();
    for (const s of ["l", "r"] as const) {
      const aim = T.aims?.[`${s}Hand`], p = aim?.point, shoulder = this.P[this.j(`upperarm_${s}`)];
      if (aim?.mode !== "touch" || !p || p[2] <= shoulder[2]) continue;
      const arm = this.len0(`upperarm_${s}`, `lowerarm_${s}`) + this.len0(`lowerarm_${s}`, `hand_${s}`) + len(this.hands[s].tip);
      const short = len(sub(p, shoulder)) - arm * AIM.touch_lean_from;
      if (short <= 0) continue;
      const height = shoulder[1] - T.seat[1], fore = norm(sub(p, shoulder))[2];
      this.aimLean = Math.max(this.aimLean, Math.min(AIM.lean_max, Math.atan2(short, height * fore) / RAD));
    }
    if (this.aimLean) spine();
    // 3. head and neck look-at: the eyes go first (eyes.ts gets the same point), the head follows what the eyes cannot hold
    const sc = T.screen; this.gazePoint = [sc.centre[0] + c.gaze[0] * sc.width / 2, sc.centre[1] + c.gaze[1] * sc.height / 2, sc.centre[2] - (sc.curve ?? HEAD.screen_curve * sc.width) * c.gaze[0] * c.gaze[0]];
    const eyeMid = this.ix["eye_l"] !== undefined ? mul(add(this.P[this.j("eye_l")], this.P[this.j("eye_r")]), 0.5) : add(this.P[this.j("head")], v3(HEAD.eye_fallback_offset));
    const namedGaze = T.aims?.look?.point;
    this.explicitGaze = !!namedGaze && namedGaze[2] > eyeMid[2];
    if (this.explicitGaze) this.gazePoint = namedGaze!;
    const local = qrot(qinv(D[this.j("spine_05")]), sub(this.gazePoint, eyeMid));
    const yaw = Math.atan2(local[0], local[2]) / RAD, pitch = -Math.atan2(local[1], Math.hypot(local[0], local[2])) / RAD, comfort = HEAD.comfort_deg;
    const want = (a: number) => Math.sign(a) * Math.max(0, Math.abs(a) - comfort) + HEAD.inside_share * Math.max(-comfort, Math.min(comfort, a));
    const limits = section("eyes").head_follow;
    const clamped = (a: number, limit: number) => Math.max(-limit, Math.min(limit, a));
    const goal: [number, number] = this.explicitGaze ? [clamped(want(yaw), limits[3]), clamped(want(pitch) * HEAD.pitch_gain, limits[4])] : c.headOverride ? [c.headOverride[0], c.headOverride[1]] : [want(yaw), want(pitch) * HEAD.pitch_gain];
    for (let k = 0; k < 2; k++) {                                                             // critically damped: the head trails the eyes
      if (this.explicitGaze && (still || dt === 0)) { this.head[k] = goal[k]; this.headV[k] = 0; continue; }
      const w = HEAD.omega, acc = w * w * (goal[k] - this.head[k]) - 2 * w * this.headV[k];
      this.headV[k] += acc * dt; this.head[k] += this.headV[k] * dt;
    }
    const neck: [string, number][] = [["neck_01", HEAD.neck_share[0]], ["neck_02", HEAD.neck_share[1]], ["head", HEAD.neck_share[2]]];
    for (const [n, w] of neck) D[this.j(n)] = qmul(D[this.parent[this.j(n)]], qmul(rv(idleAt(n)), qmul(qaxis([0, 1, 0], this.head[0] * w), qaxis([1, 0, 0], this.head[1] * w))));
    this.fk();
    if (this.ix["eye_l"] !== undefined) for (const s of ["l", "r"]) {                         // fallback eye aim (eyes.ts overrides the eye joints afterwards)
      const e = this.j(`eye_${s}`), hd = D[this.j("head")], to = norm(qrot(qinv(hd), sub(this.gazePoint, this.P[e])));
      if (this.explicitGaze) {
        const rest: Q = this.Q0[e], eye = qmul(hd, rest);
        const [ey, ep] = fixationAngles(qrot(qinv(eye), sub(this.gazePoint, this.P[e])));
        D[e] = qmul(qmul(eye, qmul(qaxis([0, 1, 0], ey), qaxis([1, 0, 0], -ep))), qinv(rest));
        continue;
      }
      const ang = Math.acos(Math.max(-1, Math.min(1, to[2]))) / RAD, lim = Math.min(ang, HEAD.eye_fallback_limit), ax = cross([0, 0, 1], to);
      D[e] = qmul(hd, len(ax) < 1e-6 ? QI : qaxis(ax, lim)); if (s === "l") this.report.eyeInHead = ang;
    }
    // 4. legs: feet on the floor or on a pedal, knees forward and a little out
    for (const s of ["l", "r"] as const) {
      const sg = s === "l" ? 1 : -1, ft = this.j(`foot_${s}`), ankleH = this.r0(`foot_${s}`)[1];
      // each foot rests with its sole on its home pedal's face (left: pedal 0, right: pedal 1), heel on the floor at the pedal's
      // hinge line; pressing turns foot and pedal together about that line; another pedal is reached by lifting the foot across.
      // The foot turns about the back edge of its heel (a shoe's heel included), so a pitched foot keeps its sole out of the floor.
      const hb = op_heelBack(this, s), home = s === "l" ? 0 : 1, heelOff: V3 = [0, -ankleH, -hb], ballOff = sub(this.r0(`ball_${s}`), this.r0(`foot_${s}`));
      const onPedal = (i: number, press: number) => { const pd = T.pedals[i] ?? T.pedals[0], Dp = qaxis([1, 0, 0], -(pd.pitch - pd.travel * press)); return { P: sub(pd.heel, qrot(Dp, heelOff)), D: Dp, contact: add(pd.heel, qrot(Dp, sub(ballOff, heelOff))) }; };
      const act = c.pedal.foot === s, b0 = onPedal(home, act && c.pedal.index === home ? c.pedal.press : 0);
      let goalP = b0.P, Df: Q = b0.D, contact: V3 | null = b0.contact;
      if (act && c.pedal.index !== home && c.pedal.on > 0) {
        const u = smooth(c.pedal.on), o = onPedal(c.pedal.index, c.pedal.on >= 1 ? c.pedal.press : 0);
        goalP = add(lerp(b0.P, o.P, u), [0, LEGS.pedal_lift * 4 * u * (1 - u), 0]); Df = qslerp(b0.D, o.D, u); contact = c.pedal.on >= 1 ? o.contact : null;
      }
      const aim = T.aims?.[`${s}Foot`], hip = this.P[this.j(`thigh_${s}`)];
      if (aim?.point && (aim.mode === "floor" || aim.point[2] > hip[2])) {
        const sole: V3 = [ballOff[0], -ankleH, ballOff[2]];
        goalP = sub(aim.point, sole); Df = QI; contact = aim.point;
        this.aimedFeet[s] = sole;
      } else delete this.aimedFeet[s];
      const knee = add(lerp(hip, goalP, 0.5), [sg * T.kneeOut * LEGS.knee_pole[0], LEGS.knee_pole[1], LEGS.knee_pole[2]]);
      this.report.legReach[s] = this.twoBone(`thigh_${s}`, `calf_${s}`, `foot_${s}`, goalP, knee);
      D[ft] = Df; D[this.j(`ball_${s}`)] = Df;
      const ball = add(this.P[ft], qrot(Df, this.aimedFeet[s] ?? ballOff));
      const wantBall = contact ?? ball;
      this.report.footErr[s] = len(sub(ball, wantBall));
    }
    // 5. arms: blend the hand goals, then two-bone IK with the elbow toward the armrest
    for (const s of ["l", "r"] as const) {
      const aim = T.aims?.[`${s}Hand`], reachAim = aim?.mode === "point" || aim?.mode === "touch" ? aim : undefined;
      const sg = s === "l" ? 1 : -1, H = this.hands[s], w = aim ? aim.mode === "rest" ? { armrest: 1 } : { grip: 1 } : c.hand[s], wg = w.grip ?? 0, wt = w.touch ?? 0, wa = w.armrest ?? 0, W = wg + wt + wa || 1;
      // (a) joystick: the stick tilts about its pivot; the palm stays wrapped on it, so the wrist and forearm follow
      const st = T.grip[s], tilt = qmul(qaxis([1, 0, 0], c.stick[s][0]), qaxis([0, 0, 1], c.stick[s][1])), axis = qrot(tilt, [0, 1, 0]);
      const centre = add(st.pivot, mul(axis, st.length));
      const kd = ARM.knuckle_dir, fwd = norm(qrot(tilt, [sg * kd[0], kd[1], kd[2]]));          // knuckles point forward, a little up and inward
      const Dg = qframes(H.across, H.f, mul(axis, -1), fwd), Pg = sub(centre, qrot(Dg, H.gripPoint));
      // (b) touchscreen: index tip on the point, finger along the screen's inward normal, palm down
      const into = norm(mul(T.touchNormal, -1)), tipDir = norm(H.tip), Dt = qframes(tipDir, H.n, norm(add(into, v3(ARM.touch_finger_tilt))), v3(ARM.touch_palm));
      const Pt = sub(T.touch, qrot(Dt, H.tip));
      // (c) armrest: palm flat on the pad, fingers forward
      const ad = ARM.armrest_finger_dir, Da = qframes(H.f, H.n, norm([sg * ad[0], ad[1], ad[2]]), [0, -1, 0]), Pa = sub(T.armrest[s], qrot(Da, H.padPoint));
      const mix = 4 * (wg * wt + wg * wa + wt * wa) / (W * W);                                 // 0 on a goal, 1 half-way between two
      const SL = ARM.slide;
      const blend = (Dt2: Q, Pt2: V3): [V3, Q] => {
        if (wa === 0 && wg > 0 && wt > 0) {
          // grip <-> touchscreen: the closed hand first slides up along the stick, off its top, and only then travels and turns;
          // pulling it straight back had dragged the wrapped fingers through the grip
          const ss = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); }, u = wt / (wg + wt), e = ss(SL.travel[0], SL.travel[1], u), lift = SL.lift * ss(SL.up[0], SL.up[1], u) * (1 - ss(SL.down[0], SL.down[1], u));      // up, over (held up), down
          return [add(add(mul(Pg, 1 - e), mul(Pt2, e)), mul(axis, lift)), qslerp(Dg, Dt2, ss(SL.turn[0], SL.turn[1], u))];     // the turn spread wider (joint change)
        }
        let P: V3 = [0, 0, 0]; for (const [p, x] of [[Pg, wg], [Pt2, wt], [Pa, wa]] as [V3, number][]) P = add(P, mul(p, x / W));
        P = add(P, mul(v3(ARM.travel_clear), mix));                                            // lift off and clear on the way
        let Dh2 = Dg; if (wt > 0) Dh2 = qslerp(Dh2, Dt2, wt / (wg + wt || 1)); if (wa > 0) Dh2 = qslerp(Dh2, Da, wa / W);
        return [P, Dh2];
      };
      let [P, Dh] = blend(Dt, Pt);
      // whenever the hand is not holding the grip, the palm and the forearm keep out of it. The palm is three capsules, wrist to
      // the index, middle and little-finger knuckles; the forearm is its last stretch toward last frame's elbow. The hand is pushed
      // off the grip's axis until they clear its radius by a little more than the held grip itself has them; toward the
      // touchscreen the fingertip keeps its point: that share of the correction turns the hand about the fingertip instead.
      const pA0 = sub(centre, mul(axis, HAND.grip_half_length)), pA1 = add(centre, mul(axis, HAND.grip_half_length)), h0 = this.r0(`hand_${s}`), palmR = ARM.palm_radius * len(sub(this.r0(`middle_01_${s}`), h0)) / HAND.reference_length;
      const foreR = (this.fit?.arm?.fore?.[1] ?? ARM.forearm_radius_default) * ARM.forearm_share, el = this.elbowPrev[s];
      const contact = (P_: V3, D_: Q, palmOnly: boolean, pb: number): [number, V3, V3] => { let worst = -1, dir: V3 = qrot(D_, H.n), at: V3 = P_;
        const test = (a: V3, b: V3, r: number, base: number) => { const [u, v, d] = segSeg(a, b, pA0, pA1), need = radiusAt(st, (2 * v - 1) * HAND.grip_half_length, this.gripRadius) + r + ARM.grip_clear - d - base;
          if (need > worst) { worst = need; at = add(a, mul(sub(b, a), u)); const on = add(pA0, mul(sub(pA1, pA0), v)); if (d > 1e-6) dir = mul(sub(at, on), 1 / d); } };
        for (const fn of ["index", "middle", "pinky"]) test(P_, add(P_, qrot(D_, sub(this.r0(`${fn}_01_${s}`), h0))), palmR, pb);
        if (!palmOnly && el && len(sub(el, P_)) > ARM.elbow_min_distance) test(P_, add(P_, mul(norm(sub(el, P_)), ARM.forearm_test_length)), foreR, this.foreBase[s] * (1 - away));
        return [worst, dir, at]; };
      const away = (() => { const k = Math.min(1, Math.max(0, (1 - wg / W - ARM.away[0]) / ARM.away[1])); return k * k * (3 - 2 * k); })();   // 0 on the stick, 1 off it
      const palmBase = Math.max(0, contact(Pg, Dg, true, 0)[0]) * (1 - away);                  // what the held grip itself has (accepted contact)
      const held = ARM.held;
      const palmClear = (P_: V3, D_: Q): [V3, Q] => {
        if (!(wg < W * held)) return [P_, D_];
        const f = wt / (wg + wt + 1e-9); let out = P_, Dq = D_;
        for (let it = 0; it < ARM.clear_iterations; it++) { const [push, dir, at] = contact(out, Dq, false, palmBase); if (push <= ARM.clear_done) break;
          if (f > 0) { const tip = add(out, qrot(Dq, H.tip)), arm = sub(at, tip), w = cross(arm, mul(dir, push * f)), a = len(w) / Math.max(dot(arm, arm), 1e-6);
            if (a > 1e-6) { Dq = qmul(qaxis(norm(w), Math.min(ARM.clear_turn_max, a / RAD)), Dq); out = sub(tip, qrot(Dq, H.tip)); } }
          out = add(out, mul(dir, push * (1 - f))); }
        return [out, Dq];
      };
      [P, Dh] = palmClear(P, Dh);
      const reachMax = (this.len0(`upperarm_${s}`, `lowerarm_${s}`) + this.len0(`lowerarm_${s}`, `hand_${s}`)) * ARM.reach_max;
      // the shoulder girdle helps a long reach: the clavicle swings toward the goal before the arm runs out
      const sh = this.P[this.j(`upperarm_${s}`)], over = len(sub(P, sh)) - reachMax * ARM.clavicle_from;
      if (over > 0) {
        const cl = this.j(`clavicle_${s}`), toGoal = norm(sub(P, this.P[cl])), cur = norm(sub(sh, this.P[cl])), ax = cross(cur, toGoal);
        if (len(ax) > 1e-6) { D[cl] = qmul(qaxis(ax, Math.min(ARM.clavicle_max, over * ARM.clavicle_gain)), D[cl]); this.fk(cl); }
      }
      const po = ARM.pole_offset, pole = lerp(T.elbow[s], add(this.P[this.j(`upperarm_${s}`)], [sg * po[0], po[1], po[2]]), ARM.pole_mix[0] * mix + ARM.pole_mix[1] * wt / W);
      this.report.reach[s] = this.twoBone(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, P, pole);
      // a comfortable wrist at the screen: the finger keeps its point, the hand swings no more than wristLimit off the forearm
      if (wt > ARM.touch_from) for (let it = 0; it < ARM.wrist_iterations; it++) {
        const la = D[this.j(`lowerarm_${s}`)], a0 = this.dir0(`lowerarm_${s}`, `hand_${s}`), rel = qmul(qinv(la), Dt), pr = rel[0] * a0[0] + rel[1] * a0[1] + rel[2] * a0[2];
        const twist = qnorm([a0[0] * pr, a0[1] * pr, a0[2] * pr, rel[3]]); let swing = qmul(rel, qinv(twist)); const ang = qangle(swing, QI);
        if (ang > this.wristLimit) swing = qslerp(QI, swing, this.wristLimit / ang);
        const DtL = qmul(la, qmul(swing, twist)), PtL = sub(T.touch, qrot(DtL, H.tip)); [P, Dh] = blend(DtL, PtL); [P, Dh] = palmClear(P, Dh);
        this.report.reach[s] = this.twoBone(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, P, pole); this.report.wrist = Math.min(ang, this.wristLimit);
        if (wt / W > held) { this.touchD[s] = DtL; }
      }
      // collision-aware elbow: swivel about the shoulder-wrist line to the nearest angle that keeps forearm and hand clear of this
      // body's capsules by the margin; if none does, a hand that is not locked on a grip moves outward by what is left
      if (this.fit) {
        const ua = `upperarm_${s}`, la = `lowerarm_${s}`, hd = `hand_${s}`, A = this.P[this.j(ua)];
        const at = (deg: number, goal: V3): [number, V3] => { const ax = norm(sub(goal, A)), m = add(A, qrot(qaxis(ax, deg), sub(this.P[this.j(la)], A))); return [this.armPen(s, m, goal, Dh), m]; };
        this.twoBone(ua, la, hd, P, pole);
        const sw = ARM.swivel, out = at(sw.probe, P)[1][0] * sg > at(-sw.probe, P)[1][0] * sg ? 1 : -1, prev = this.swivel[s]; let bestA = 0, bestP = Infinity, found = false;
        const cand: number[] = []; for (let k = sw.range[0]; k <= sw.range[1]; k += sw.step) cand.push(k); cand.sort((x, y) => Math.abs(x) - Math.abs(y) || y - x);   // the least swivel wins; outward before inward
        for (const k of cand) { const pen = at(out * k, P)[0]; if (pen <= -(this.margin + sw.extra_clear)) { bestA = k; found = true; break; } if (pen < bestP) { bestP = pen; bestA = k; } }
        const step = dt > 0 ? sw.rate * dt : Infinity, th = prev + Math.max(-step, Math.min(step, bestA - prev)); this.swivel[s] = th;
        let need = 0; if (!found && wg / W < held) need = Math.min(sw.shift_max, bestP + this.margin);
        const sh2 = dt > 0 ? sw.shift_rate * dt : Infinity; this.shift[s] += Math.max(-sh2, Math.min(sh2, need - this.shift[s]));
        if (this.shift[s] > 1e-5) P = add(P, [sg * this.shift[s], 0, 0]);
        this.twoBone(ua, la, hd, P, pole); const [, m] = at(out * th, P);
        this.report.reach[s] = this.twoBone(ua, la, hd, P, m); this.report.armPen[s] = this.armPen(s, this.P[this.j(la)], this.P[this.j(hd)], Dh);
      }
      delete this.handStatus[s];
      let aimed = false;
      if (reachAim?.point) {
        const solved = this.aimHand(s, reachAim, reachMax);
        if (solved) { Dh = solved; aimed = true; }
      }
      const hj = this.j(`hand_${s}`); D[hj] = Dh;
      { const elb = this.P[this.j(`lowerarm_${s}`)], wr = this.P[hj]; this.elbowPrev[s] = [...elb] as V3;
        if (wg / W > held) { const [, v, d] = segSeg(wr, add(wr, mul(norm(sub(elb, wr)), ARM.forearm_test_length)), pA0, pA1); this.foreBase[s] = Math.max(this.foreBase[s], radiusAt(st, (2 * v - 1) * HAND.grip_half_length, this.gripRadius) + foreR + ARM.grip_clear - d); } }
      const gripNow = add(this.P[hj], qrot(Dh, H.gripPoint)), tipNow = add(this.P[hj], qrot(Dh, H.tip)), padNow = add(this.P[hj], qrot(Dh, H.padPoint));
      this.report.handErr[s] = wg / W > held ? len(sub(gripNow, centre)) : wt / W > held ? len(sub(tipNow, T.touch)) : wa / W > held ? len(sub(padNow, T.armrest[s])) : 0;
      this.gripNow[s] = { centre, axis, on: !aimed && wg / W > held };
      // forearm twist joints take the hand's twist about the forearm, by their place along it
      const la = this.j(`lowerarm_${s}`), a0 = this.dir0(`lowerarm_${s}`, `hand_${s}`), rel = qmul(qinv(D[la]), Dh), sgn = rel[3] < 0 ? -1 : 1;
      const tw = 2 * Math.atan2(sgn * (rel[0] * a0[0] + rel[1] * a0[1] + rel[2] * a0[2]), sgn * rel[3]) / RAD;
      for (const k of [1, 2]) { const n = `lowerarm_twist_0${k}_${s}`; if (this.ix[n] !== undefined) D[this.ix[n]] = qmul(D[la], qaxis(a0, tw * this.len0(`lowerarm_${s}`, n) / this.len0(`lowerarm_${s}`, `hand_${s}`))); }
      for (const seg of ["upperarm"]) for (const k of [1, 2]) { const n = `${seg}_twist_0${k}_${s}`; if (this.ix[n] !== undefined) D[this.ix[n]] = D[this.j(`${seg}_${s}`)]; }
      // fingers: the goal's own pose, opened toward the relaxed hand while travelling, with a little life when not gripping
      const life = (aim ? 0 : FING.life_deg) * Math.sin(t * FING.life_rate + sg) * (1 - wg / W);
      // between grip and touchscreen the fingers take the pointing shape only as the hand leaves the stick (the same phase as the
      // hand's travel above): while the fist slides up or down the stick it keeps the grip's shape
      let fg = wg, ft = wt; if (wa === 0 && wg > 0 && wt > 0) { const u = wt / (wg + wt), k = Math.min(1, Math.max(0, (u - SL.travel[0]) / (SL.travel[1] - SL.travel[0]))), e = k * k * (3 - 2 * k); fg = (wg + wt) * (1 - e); ft = (wg + wt) * e; }
      const parts: [PoseQ, number][] = aimed ? [[H.lib.point, 1]] : [[H.lib.power, fg * (1 - c.open[s])], [H.lib.point, ft * (1 - c.open[s])], [H.lib.flat, wa * (1 - c.open[s])], [H.lib.relaxed, W * c.open[s] + 1e-6]];
      for (const chain of CHAINS) {
        let Dp = Dh;
        for (const base of chain) {
          const jn = this.ix[`${base}_${s}`]; if (jn === undefined) continue;
          let e: Q = [0, 0, 0, 0], ref: Q | null = null;
          for (const [p, w] of parts) { const q = p[base] ?? QI; ref ??= q; const sn = q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0 ? -w : w; e = [e[0] + q[0] * sn, e[1] + q[1] * sn, e[2] + q[2] * sn, e[3] + q[3] * sn]; }
          e = qnorm(e); if (H.axes[base] && !base.endsWith("03")) e = qmul(e, qaxis(H.axes[base], (base.startsWith("thumb") ? FING.thumb_share : 1) * life * (1 + FING.vary * Math.sin(t * FING.vary_rate + chain.length + base.length))));
          Dp = qmul(Dp, e); D[jn] = Dp;
        }
      }
      if (!aimed) this.clampFingers(s, H, centre, axis, dt, wg / W > held);
    }
    for (const s of ["l", "r"]) for (const seg of ["thigh", "calf"]) for (const k of [1, 2]) { const n = `${seg}_twist_0${k}_${s}`; if (this.ix[n] !== undefined) D[this.ix[n]] = D[this.j(`${seg}_${s}`)]; }
    for (let j = 0; j < this.names.length; j++) if (!OWN.test(this.names[j]) && this.parent[j] >= 0) D[j] = D[this.parent[j]];     // helper joints beyond the 82 ride on their parent (the rig's drivers pose them afterwards)
    this.fk();
  }
  /** The pose in the rig's own terms: local rotation per joint and the pelvis' local translation. */
  locals(): { q: Q[]; pelvis: V3 } {
    const q: Q[] = []; for (let j = 0; j < this.names.length; j++) { const p = this.parent[j]; q.push(p < 0 ? qmul(this.D[j], this.Q0[j]) : qnorm(qmul(qinv(this.Q0[p]), qmul(qmul(qinv(this.D[p]), this.D[j]), this.Q0[j])))); }
    const pv = this.j("pelvis"), pp = this.parent[pv];
    return { q, pelvis: pp < 0 ? [...this.pelvis] : qrot(qinv(qmul(this.D[pp], this.Q0[pp])), sub(this.pelvis, this.P[pp])) };
  }
  /** The hands fitted to the targets' grips (their radius and the real handle's profile): the wrap and the grip point. Without a
   *  profile or a radius of their own the grips are the lab's 40 mm cylinder and nothing changes. */
  /** The hands fitted to the grips of the targets; true when a hand was fitted anew. Fitted again only when the grip's place or shape
   *  changed (or `again`: once more on the measured cross-section, the hand's orientation on it now solved): a rebinding for a joint
   *  elsewhere in the rig (the monitor panned) costs nothing here (a fit takes about 15 ms). */
  private gripSig: Record<string, string> = {};
  fitGrips(tips?: Record<string, number[]>, again = false): boolean {
    let fitted = false;
    for (const s of ["l", "r"] as const) {
      const g = this.targets?.grip?.[s]; if (!(g?.profile || (g && g.radius !== this.gripRadius))) continue;
      const f = (v: number[] | undefined, k = 4) => (v ?? []).map((x) => x.toFixed(k)).join(",");
      const sig = [f(g.pivot), g.length.toFixed(4), g.radius, g.profile?.length ?? 0, f(g.hold), g.section ? f(g.ref, 3) + ":" + g.section.length : "", tips ? JSON.stringify(tips) : ""].join("|");
      if (!again && this.gripSig[s] === sig && this.hands[s]) continue;
      this.gripSig[s] = sig; this.hands[s] = this.buildHand(s, tips, g); fitted = true;
    }
    return fitted;
  }
  /** Run state back to the start (a new rig, a new body, a still): what defaultTargets resets, in one place. */
  resetRun() { this.aimSearch.clear(); this.time = 0; this.head = [0, 0]; this.headV = [0, 0]; this.leanNow = 0; this.swivel = { l: 0, r: 0 }; this.shift = { l: 0, r: 0 }; this.elbowPrev = { l: null, r: null }; this.foreBase = { l: 0, r: 0 }; }
}

// ---- a stand-in rig sized to the body: the fallback when no rig binding supplies the real rig's points -------------------------
export function defaultTargets(op: Operator): Targets {
  const ankleH = op.r0("foot_l")[1], thigh = op.len0("thigh_l", "calf_l"), calf = op.len0("calf_l", "foot_l"), hipW = op.r0("thigh_l")[0];
  const thighK = thigh / TG.reference_thigh;
  let hipAbovePan = TG.hip_above_pan * thighK;   // at a lower value the unskinned-corrective buttock sits inside the pan; this leaves the cushion to take the rest
  // seat contact from the body's own tissue (when the bake measured it): the cushion takes a share of the soft tissue under the hip
  // joint (what hangs below the joint, less the bone at the median thigh length), within limits
  const bone = TG.bone_below_hip * thighK, below = op.fit?.seat?.buttock_below_hip_m; let press = below ? Math.min(TG.press_limits[1], Math.max(TG.press_limits[0], TG.press_share * (below - bone))) : 0;
  if (below) hipAbovePan = below - press;
  // when the fit carries it, the seat of the motion bake: pan at the person's survey popliteal height (pan_drop_m below the joint
  // estimate), hip so the deepest buttock or thigh skin sits compress_m into the pan. Seat rule: "survey" (default) = seated eye height
  // on the person's survey value less the cushion's own compression; "compression" = tissue into the pan
  const S6: any = op.fit?.seat, rule = op.seatRule === "compression" ? "compression" : "survey";
  if (S6?.hip_above_pan_m !== undefined) {
    hipAbovePan = rule === "compression" && S6.hip_above_pan_compression_m !== undefined ? S6.hip_above_pan_compression_m : S6.hip_above_pan_m;
    press = rule === "compression" ? S6.compress_rule_m ?? S6.compress_m ?? press : S6.compress_m ?? press;
  }
  const pan = calf + ankleH - TG.pan_below_knee - (S6?.pan_drop_m ?? 0), seat: V3 = [0, pan + hipAbovePan, 0];      // pan at popliteal height; hip centre above it
  const fs = TG.feet_from_hip;
  const T: Targets = {
    seat, recline: TG.recline, kneeOut: TG.knee_out, hipAbovePan, grip: { l: { pivot: [0, 0, 0], length: TG.stick_length, radius: HAND.grip_radius }, r: { pivot: [0, 0, 0], length: TG.stick_length, radius: HAND.grip_radius } },
    elbow: { l: [0, 0, 0], r: [0, 0, 0] }, armrest: { l: [0, 0, 0], r: [0, 0, 0] }, touch: [0, 0, 0], touchNormal: norm(v3(TG.touch_normal)),
    feet: { l: [hipW + TG.foot_out, 0, thigh * fs[0] + calf * fs[1]], r: [-hipW - TG.foot_out, 0, thigh * fs[0] + calf * fs[1]] }, pedals: [],
    screen: { centre: [0, 0, 0], width: TG.screen_size[0], height: TG.screen_size[1] },
  };
  op.targets = T;
  const fz = T.feet.l[2], hz = fz - op_heelBack(op, "l");                                   // the pedal hinge under the heel's back edge, ankle where it was
  T.pedals = [{ heel: [T.feet.l[0], 0, hz], pitch: TG.pedal_pitch, travel: TG.pedal_travel }, { heel: [T.feet.r[0] + TG.pedal_offsets[0], 0, hz], pitch: TG.pedal_pitch, travel: TG.pedal_travel }, { heel: [T.feet.r[0] + TG.pedal_offsets[1], 0, hz], pitch: TG.pedal_pitch, travel: TG.pedal_travel }];   // home pedals under the feet, a third outboard on the right
  const z: Controls = { hand: { l: { armrest: 1 }, r: { armrest: 1 } }, open: { l: 0, r: 0 }, stick: { l: [0, 0], r: [0, 0] }, pedal: { foot: "r", index: 0, on: 0, press: 0 }, gaze: [0, 0], lean: 0, headOverride: [0, 0] };
  op.solve(z, 0);                                                                              // seat the trunk to find the shoulders
  for (const s of ["l", "r"] as const) {
    const sg = s === "l" ? 1 : -1, sh = op.P[op.j(`upperarm_${s}`)], ua = op.len0(`upperarm_${s}`, `lowerarm_${s}`), fa = op.len0(`lowerarm_${s}`, `hand_${s}`);
    const ue = TG.upper_arm, el = add(sh, mul(norm([sg * Math.sin(ue[1] * RAD), -Math.cos(ue[0] * RAD), Math.sin(ue[0] * RAD)]), ua));     // the designer's SEATED_GRIPS: flexed, abducted
    const fd = TG.forearm_dir, wrist = add(el, mul(norm([sg * fd[0], fd[1], fd[2]]), fa));     // forearm level, toeing in a little
    // an armrest set wide enough for this body: the elbow goes out only as far as the forearm needs to lie clear (margin, no extra)
    // and the wrist stays, so the forearm toes in
    const wide = !!op.wideArmrest, w0: V3 = [...wrist], AW = TG.armrest_widen;
    for (let k = 0; k < AW.iterations && op.fit && op.armPen(s, el, wrist, null) > -(op.margin + (wide ? AW.wide_clear : AW.clear)); k++) {
      el[0] += sg * (wide ? AW.wide_step : AW.step);
      if (wide) wrist[0] += sg * AW.wide_step; else { const d = norm(sub(w0, el)); wrist[0] = el[0] + d[0] * fa; wrist[1] = el[1] + d[1] * fa; wrist[2] = el[2] + d[2] * fa; }
    }
    const eo = TG.elbow_pole_offset; T.elbow[s] = add(el, [sg * eo[0], eo[1], eo[2]]);
    const po = TG.palm_ahead, gc = add(wrist, [sg * po[0], po[1], po[2] * (fa / TG.reference_forearm)]);   // the palm's place ahead of the wrist
    T.grip[s].pivot = sub(gc, [0, T.grip[s].length, 0]);
    // the grip and the closed hand clear the thighs over the stick's whole travel, with room to spare; a short woman's thighs
    // rise toward her knees and the tilted grip reached into them
    const GC = TG.grip_clear;
    for (let k = 0; k < GC.iterations && op.fit; k++) {
      let worst = -1; const tv = GC.travel, dg = GC.travel_diagonal;
      for (const d of [[0, 0], [tv, 0], [-tv, 0], [0, tv], [0, -tv], [dg, dg], [-dg, -dg], [dg, -dg], [-dg, dg]]) {
        const ax = qrot(qmul(qaxis([1, 0, 0], d[0]), qaxis([0, 0, 1], d[1])), [0, 1, 0]), cc = add(T.grip[s].pivot, mul(ax, T.grip[s].length));
        worst = Math.max(worst, op.capsulePen(add(cc, mul(ax, -GC.capsule[0])), add(cc, mul(ax, GC.capsule[1])), T.grip[s].radius + GC.hand_radius));
      }
      if (worst < -GC.spare) break; T.grip[s].pivot[1] += GC.step;
    }
    // the stick stands on a mount (a housing under the pivot, bracketed to the armrest) that clears this person's thigh: the pivot
    // comes up and the stick shortens (to a minimum length). What cannot clear is an ergonomic finding: reported, not hidden.
    { const MC = TG.mount, gcen = add(T.grip[s].pivot, [0, T.grip[s].length, 0]); let L = T.grip[s].length;
      const mountPen = (L_: number) => { const pv = sub(gcen, [0, L_, 0]); return op.capsulePen(sub(pv, [0, MC.housing_height, 0]), pv, MC.housing_radius); };
      while (op.fit && L > MC.stick_min && mountPen(L) > -MC.clear) L -= MC.step;
      T.grip[s].pivot = sub(gcen, [0, L, 0]); T.grip[s].length = L;
      (T.mountClash ??= { l: 0, r: 0 })[s] = op.fit ? Math.max(0, mountPen(L)) : 0; }
    const ar = TG.armrest; T.armrest[s] = add(el, mul(norm([sg * ar.dir[0], ar.dir[1], ar.dir[2]]), fa * ar.reach[0] + ar.reach[1])); T.armrest[s][1] = el[1] - ar.below_elbow;
  }
  const lsh = op.P[op.j("upperarm_l")]; T.touch = add(lsh, v3(TG.touch_from_shoulder));       // the designer's OPERATE: ahead of and below the left shoulder
  const eye = op.ix["eye_l"] !== undefined ? mul(add(op.P[op.j("eye_l")], op.P[op.j("eye_r")]), 0.5) : add(op.P[op.j("head")], v3(HEAD.eye_fallback_offset));
  T.screen.centre = [0, eye[1] - TG.screen_from_eye[0], eye[2] + TG.screen_from_eye[1]];
  // the planes the body is seated against, for whoever flattens flesh on them (the rig's helper joints, the viewer's contact flatten)
  const rr = T.recline * RAD, nb: V3 = [0, Math.sin(rr), Math.cos(rr)], st = op.fit?.seat, backPress = TG.back_press, pelvisPress = TG.pelvis_press;
  // the upper back only touches; the pelvis still takes more
  const dBack = st ? Math.max(st.back_behind_hip_m + TG.back_clear, st.pelvis_behind_hip_m - pelvisPress) : TG.back_behind_hip;
  op.contactPlanes = [{ name: "seat", point: [0, pan, TG.pan_point_z], normal: [0, 1, 0], compress_m: press }, { name: "backrest", point: add(seat, mul(nb, -dBack)), normal: nb, compress_m: backPress }];
  // seat depth: the pan's front edge a set distance short of the person's own knee crease (the seated knee joint less the thigh's
  // radius there, from the fit's capsules), never deeper than the rig's full depth. A fixed T.seatFront is kept and its conflict
  // with the crease is reported (standInProps -> op.clash -> state.report.clash).
  const thighCaps = (op.fit?.capsules ?? []).filter((k) => k.joint === "thigh_l"), rKnee = thighCaps.length ? thighCaps[thighCaps.length - 1].rb : TG.knee_radius_default;
  const crease = Math.min(op.P[op.j("calf_l")][2], op.P[op.j("calf_r")][2]) - rKnee;
  T.seatFront = Math.min(TG.seat_full_front, crease - TG.seat_short_of_crease); T.seatFit = { crease_z: crease, full_front: TG.seat_full_front, rule: "front edge = knee crease less the runtime parameter operator.targets.seat_short_of_crease, at most operator.targets.seat_full_front ahead of the hip centre" };
  op.resetRun();
  return T;
}
/** Back edge of the heel behind the ankle joint, metres: the fit's measured heel plus a shoe's heel, else a share of the
 *  ankle-to-ball length plus the shoe's heel. */
export function op_heelBack(op: Operator, s: string): number {
  const hb = op.fit?.seat?.heel_back_m, ball = Math.abs(op.r0(`ball_${s}`)[2] - op.r0(`foot_${s}`)[2]);
  return (hb ?? TG.heel_share * ball) + TG.shoe_heel;
}
/** Boxes and cylinders for the stand-in rig: { kind, at, size (box: x, y, z; cylinder: radius, height), axis? }. Not drawn in the
 *  product (the real rig is there); kept because it also hands the seat pan's solid to the contact flatten (seatPlane.pan) and
 *  reports clashes, when no rig binding supplies them. */
export function standInProps(op: Operator, c?: Controls) {
  const T = op.targets, out: any[] = [], pan = T.seat[1] - T.hipAbovePan; op.clash = [];
  const bp = op.contactPlanes.find((k) => k.name === "backrest"), up: V3 = [0, Math.cos(T.recline * RAD), -Math.sin(T.recline * RAD)];
  const BR = SI.backrest, bAt: V3 = bp ? add(add(bp.point, mul(bp.normal, -BR.size[2] / 2)), mul(up, BR.size[1] / 2 - (bp.point[1] - pan) / Math.max(up[1], 0.5))) : [0, pan + BR.size[1] / 2, -TG.back_behind_hip];
  // the seat pan: a cushion of a set thickness and width, its front edge a bull-nose; the contact flatten (contact.ts) uses exactly
  // this solid, handed over on the seat plane as `pan`, with the rest knee and hip heights its thigh mask is measured from
  const seatPlane = op.contactPlanes.find((k) => k.name === "seat");
  {
    const PS = SI.pan, R = PS.edge, TH = PS.thickness, hw = PS.half_width, front = T.seatFront ?? TG.seat_full_front, backZ = bp ? bp.point[2] - (bp.normal[1] * (pan - bp.point[1])) / bp.normal[2] : -PS.back_default, rear = Math.min(backZ - PS.rear_under_back, front - PS.min_depth), ln = front - R - rear;
    out.push({ kind: "box", role: "seat", name: "seat pan", at: [0, pan - TH / 2, rear + ln / 2], size: [2 * hw, TH, ln] },
      { kind: "cylinder", role: "seat", name: "seat pan front edge", at: [0, pan - R, front - R], size: [R, 2 * hw], axis: [1, 0, 0] });
    if (seatPlane) seatPlane.pan = { top: pan, front, rear, halfWidth: hw, thickness: TH, edge: R,
      kneeRestY: (op.r0("calf_l")[1] + op.r0("calf_r")[1]) / 2, hipRestY: (op.r0("thigh_l")[1] + op.r0("thigh_r")[1]) / 2, hipRestX: (Math.abs(op.r0("thigh_l")[0]) + Math.abs(op.r0("thigh_r")[0])) / 2 };
  }
  out.push({ kind: "box", role: "seat", name: "backrest", at: bAt, size: [...BR.size], tilt: -T.recline });
  if (T.seatFit) { const beyond = ((T.seatFront ?? TG.seat_full_front) - T.seatFit.crease_z) * 1000;      // a depth that reaches the knee crease is reported, not hidden
    if (beyond > 0) op.clash.push({ what: "seat front edge beyond the knee crease (seat too deep for this person)", depth_mm: +beyond.toFixed(1) }); }
  const footLen = op_heelBack(op, "l") + (op.r0("ball_l")[2] - op.r0("foot_l")[2]) * SI.foot_length[0] + SI.foot_length[1];
  for (const s of ["l", "r"] as const) {
    const sg = s === "l" ? 1 : -1, st = T.grip[s], d = c ? c.stick[s] : [0, 0], axis = qrot(qmul(qaxis([1, 0, 0], d[0]), qaxis([0, 0, 1], d[1])), [0, 1, 0]);
    out.push({ kind: "cylinder", role: "grip", name: "grip " + s, at: add(st.pivot, mul(axis, st.length)), size: [st.radius, SI.grip_height], axis }, { kind: "cylinder", role: "grip", name: "stick " + s, shadow: false, at: add(st.pivot, mul(axis, st.length * SI.stick[0])), size: [SI.stick[2], st.length * SI.stick[1]], axis });
    // the armrest pad lies under the forearm; its body-side edge is kept clear of this body's trunk and thigh capsules: first by
    // sliding the pad outward, then by narrowing it. What is left is a real clash and is reported.
    const AP = SI.armrest; let w = AP.width, cx = T.elbow[s][0]; const y = T.armrest[s][1] - AP.below, z0 = T.elbow[s][2] - AP.behind_elbow, z1 = z0 + AP.length;
    const edgePen = () => { let worst = -1; if (!op.fit) return worst; for (const yy of [y - AP.probe, y + AP.probe]) worst = Math.max(worst, op.capsulePen([cx - sg * w / 2, yy, z0], [cx - sg * w / 2, yy, z1], 0)); return worst; };
    for (let k = 0; k < AP.iterations && edgePen() > -AP.clear; k++) cx += sg * AP.slide_step;
    for (let k = 0; k < AP.iterations && edgePen() > -AP.clear; k++) { w -= AP.narrow_step; cx += sg * AP.narrow_step / 2; }
    const left = op.fit ? edgePen() : NaN, pad: any = { kind: "box", role: "armrest", name: "armrest " + s, at: [cx, y, (z0 + z1) / 2], size: [w, AP.thickness, AP.length] };
    if (left > AP.report_from) { pad.clash = true; pad.clash_mm = +(left * 1000).toFixed(1); op.clash.push({ what: "armrest " + s + " against the body", depth_mm: pad.clash_mm }); }
    out.push(pad);
    // the pad stands on a post down to the seat pan, under the pad's outer half, a little behind its middle
    const PO = SI.post, top = y - AP.thickness / 2, pz = z0 + PO.from_back, ph = Math.max(PO.min_height, top - pan), px = cx + sg * (w / 2 - PO.inset);
    out.push({ kind: "box", role: "armrest", name: "armrest post " + s, at: [px, pan + ph / 2, pz], size: [PO.size[0], ph, PO.size[1]] });
    // the grip's mount: a housing under the stick's pivot and an L-shaped bracket to the front end of the armrest
    { const MB = SI.mount, pv = st.pivot, by = pv[1] - MB.bracket_below, zf = z1 - MB.bracket_back, mc = T.mountClash?.[s] ?? 0;
      const mount: any = { kind: "box", role: "grip", name: "grip mount " + s, at: [pv[0], pv[1] - MB.housing[1] / 2, pv[2]], size: [...MB.housing] };
      if (mc > AP.report_from) { mount.clash = true; mount.clash_mm = +(mc * 1000).toFixed(1); op.clash.push({ what: "grip " + s + " mount meets the thigh (ergonomic finding: a fixed stick here does not clear this person)", depth_mm: mount.clash_mm }); }
      out.push(mount,
        { kind: "box", role: "grip", name: "grip bracket " + s + " (across)", at: [(pv[0] + cx) / 2, by, pv[2]], size: [Math.abs(cx - pv[0]) + MB.bracket[0], MB.bracket[0], MB.bracket[1]] },
        { kind: "box", role: "grip", name: "grip bracket " + s + " (along)", at: [cx, (by + y) / 2, (pv[2] + zf) / 2], size: [MB.bracket[1], Math.abs(y - by) + MB.bracket[0], Math.abs(zf - pv[2]) + MB.bracket[0]] }); }
  }
  T.pedals.forEach((p, i) => { const press = c && c.pedal.index === i && (c.pedal.on >= 1 || i === (c.pedal.foot === "l" ? 0 : 1)) ? c.pedal.press : 0, pit = p.pitch - p.travel * press; out.push({ kind: "box", role: "pedal", name: "pedal " + i, at: add(p.heel, qrot(qaxis([1, 0, 0], -pit), [0, -SI.pedal[2], footLen / 2])), size: [SI.pedal[0], SI.pedal[1], footLen], pitch: -pit }); });
  out.push({ kind: "box", role: "touchscreen", name: "touchscreen", shadow: false, at: add(T.touch, mul(T.touchNormal, -SI.touch_inset)), size: [...SI.touch], normal: T.touchNormal });
  const sc = T.screen, yb = sc.centre[1] - sc.height / 2, bar = SI.screen_bar;
  out.push({ kind: "box", role: "screen", name: "screen lower edge", shadow: false, at: [sc.centre[0], yb, sc.centre[2]], size: [sc.width, bar[0], bar[0]] });
  for (const sx of [1, -1]) out.push({ kind: "box", role: "screen", name: "screen corner " + (sx > 0 ? "l" : "r"), shadow: false, at: [sc.centre[0] + sx * sc.width / 2, yb + bar[1] / 2, sc.centre[2]], size: [bar[0], bar[1], bar[0]] });
  return out;
}

// ---- scripted sequences ---------------------------------------------------------------------------------------------------------
/** Both hands on the grips, feet on their home pedals, looking at the screen's centre: the product's seated default. */
export const hold = (): Controls => ({ hand: { l: { grip: 1 }, r: { grip: 1 } }, open: { l: 0, r: 0 }, stick: { l: [0, 0], r: [0, 0] }, pedal: { foot: "r", index: 1, on: 0, press: 0 }, gaze: [0, 0], lean: 0, headOverride: null });
const pulse = (t: number, p: number[]) => ramp(t, p[0], p[1]) * (1 - ramp(t, p[2], p[3]));
const RT = SCR.reach_touch;
function reachTouch(c: Controls, t: number, t0: number, taps = 1) {     // left hand: off the grip, to the screen, tap, back
  const extra = RT.per_tap * (taps - 1), out = ramp(t, t0, t0 + RT.out), back = ramp(t, t0 + RT.back[0] + extra, t0 + RT.back[1] + extra), w = out * (1 - back);
  // the fist stays closed while it slides up and off the stick and is closed again before it slides back down
  const outD = Math.min(1, Math.max(0, (out - RT.slide) / (1 - RT.slide))), backD = Math.min(1, Math.max(0, back / (1 - RT.slide)));
  c.hand.l = { grip: 1 - w, touch: w }; c.open.l = RT.open * Math.sin(Math.PI * outD) * (out < 1 ? 1 : 0) + RT.open * Math.sin(Math.PI * backD) * (back > 0 && back < 1 ? 1 : 0);
}
const O8 = SCR.operate8;
/** The designer's OPERATE clip (VD/review-packet.json "clips"). */
export function operate8(t: number): Controls {
  const c = hold(), L = O8.period, tt = ((t % L) + L) % L, A = O8.stick_amplitude;
  c.stick.r = [A * pulse(tt, O8.forward) - A * pulse(tt, O8.back), A * pulse(tt, O8.left) - A * pulse(tt, O8.right)];
  reachTouch(c, tt, O8.touch_at);
  const hd = pulse(tt, O8.head_pulse); c.headOverride = hd > 0 ? [O8.head[0] * hd, O8.head[1] * hd] : null; c.gaze = [O8.gaze[0] * hd, O8.gaze[1] * hd];
  const mv = pulse(tt, O8.move_pulse), m0 = O8.move_pulse[0], ms = O8.move_sticks; c.lean = O8.lean * mv;
  c.stick.r = tt > m0 ? [ms[0] * Math.sin((tt - m0) * Math.PI) * mv, ms[1] * Math.sin((tt - m0) * ms[2]) * mv] : c.stick.r;
  c.stick.l = [ms[3] * Math.sin((tt - m0) * Math.PI * ms[4]) * mv, ms[5] * mv * Math.cos((tt - m0) * ms[6])].map((x) => (tt > m0 ? x : 0)) as [number, number];
  return c;
}
const D30 = SCR.demo30;
/** The owner's proof: hands to the joysticks, deflect both, touchscreen and back, a pedal press, a look across the screen. */
export function demo30(t: number): Controls {
  const c = hold(), tt = Math.max(0, Math.min(D30.duration, t));
  const on = ramp(tt, D30.on[0], D30.on[1]), off = ramp(tt, D30.off[0], D30.off[1]), g = on * (1 - off);                   // armrests -> grips ... -> armrests
  c.hand.r = { grip: g, armrest: 1 - g }; c.hand.l = { grip: g, armrest: 1 - g };
  const travel = Math.max(Math.sin(Math.PI * on) * (on < 1 ? 1 : 0), Math.sin(Math.PI * off) * (off > 0 && off < 1 ? 1 : 0)); c.open = { l: D30.open * travel, r: D30.open * travel };
  const d = pulse(tt, D30.sticks_pulse), ph = (tt - D30.sticks_pulse[0]) * D30.phase_rate, sr = D30.stick_r, sl = D30.stick_l, rr = ramp(tt, D30.second_axis[0], D30.second_axis[1]);   // both sticks, then circles
  c.stick.r = [sr[0] * Math.sin(ph) * d, sr[1] * Math.sin(ph * sr[2]) * d * rr]; c.stick.l = [sl[0] * Math.cos(ph * sl[2]) * d * rr, sl[1] * Math.sin(ph * sl[3]) * d];
  if (tt > D30.touch_window[0] && tt < D30.touch_window[1]) { reachTouch(c, tt, D30.touch_at, D30.touch_taps); const gp = pulse(tt, D30.touch_gaze_pulse); c.gaze = [D30.touch_gaze[0] * gp, D30.touch_gaze[1] * gp]; }
  const pd = pulse(tt, D30.pedal_pulse), pp = D30.press; c.pedal = { foot: "r", index: D30.pedal_index, on: pd >= D30.pedal_on ? 1 : pd, press: pulse(tt, D30.press_pulse) * pp[0] + pp[1] * pulse(tt, D30.tap_pulse) };
  if (tt >= D30.look_pulse[0] && tt < D30.look_pulse[3]) { const u = (tt - D30.look_pulse[0]) / (D30.look_pulse[3] - D30.look_pulse[0]), lp = pulse(tt, D30.look_pulse); c.gaze = [Math.sin(u * 2 * Math.PI) * D30.look[0] * lp, D30.look[1] * Math.sin(u * 4 * Math.PI) * lp]; }
  c.lean = D30.lean * pulse(tt, D30.lean_pulse);
  return c;
}
export const SCRIPTS: Record<string, (t: number) => Controls> = { hold: () => hold(), operate8, demo30 };

/** One finger-pose library, not two: when the package's manifest carries RR's hand poses (written to `poses` as dof values
 *  relative to the rest pose), they replace the numbers above. `flat` and the per-body wrap stay here. */
export function adoptHandPoses(manifest: any): string[] {
  const map: Record<string, GripName> = { HAND_RELAXED: "relaxed", HAND_POINT: "point", HAND_FIST: "fist", HAND_GRIP40: "power", HAND_FLAT: "flat" }, got: string[] = [];
  for (const k of Object.keys(ADOPTED)) delete (ADOPTED as any)[k];
  const dofs: any[] = manifest?.dofs ?? [];
  for (const p of manifest?.poses ?? []) {
    const k = map[p.name]; if (!k || !p.dofs) continue; const out = { l: {} as PoseQ, r: {} as PoseQ };
    for (const s of ["l", "r"] as const) for (const d of dofs) {                               // in the manifest's order: a joint's rotation = R(dof 1) R(dof 2) R(dof 3)
      const m = /^((?:thumb|index|middle|ring|pinky)_(?:0\d|metacarpal))_([lr])$/.exec(d.joint); if (!m || m[2] !== s) continue;
      const v = p.dofs[d.id] ?? p.dofs[d.id.replace(`_${s}.`, "_r.")]; if (!v) continue;
      out[s][m[1]] = qmul(out[s][m[1]] ?? QI, qaxis(d.axis, v));                               // rest frames are world-aligned on this rig
    }
    ADOPTED[k] = out; got.push(p.name);
  }
  return got;
}
/** Rebuild the deterministic still, including explicit fixation on the same frame as the body. */
export function solveStill(op: Operator, controls: (t: number) => Controls, t: number) {
  const dt = STILL_SETTLE.step;
  op.resetRun();
  for (let u = Math.max(0, t - STILL_SETTLE.seconds); u < t; u += dt) {
    op.time = u; op.solve(controls(u), dt, true);
  }
  op.time = t - dt;
  op.solve(controls(t), dt, true);
}

export const STILL_SETTLE = { seconds: STILL.settle_s as number, step: STILL.step_s as number };
/** How close the rest head and hand positions must be to a baked person's key for its fit to be used, metres. */
export const FIT_KEY_TOLERANCE: number = STILL.fit_key_tolerance;
