// Eye movement (ported from the lab's eyes.ts, owner B5): saccades, eye-head hand-over, vergence, fixational movement,
// blinks, lids following the gaze, the corneal bulge travelling under the lids, and the lid-shadow planes of the eye
// shader. Numbers: runtime-person.toml [eyes]. Runs in `late` (after the operator layer and the drivers, so the head pose
// it reads is this frame's). Changes from the lab: no global (`globalThis.synergonEyes`): the person module hands the
// operator layer's gaze point in through `state.target`; no lil-gui panel.
// A package without an "eyes" block (the clay style's sculpted eyes) is left alone.
import { fixationAngles } from "./aim-eyes.ts";
import { section } from "./params.ts";
import type { Plugin, FrameContext } from "./plugins.ts";

const E0 = section("eyes"), MAT = section("materials").eye;
export type EyeMode = "portrait" | "screen" | "idle";
const MODES: EyeMode[] = ["portrait", "screen", "idle"];
const byMode = (a: number[]): Record<string, number> => Object.fromEntries(MODES.map((m, i) => [m, a[i]]));
export const eyeParams = {
  saccDurBase: E0.sacc_dur_base as number, saccDurPerDeg: E0.sacc_dur_per_deg as number, saccShape: E0.sacc_shape as number, mainSeqVmax: E0.main_seq_vmax as number, mainSeqC: E0.main_seq_c as number,
  refractory: E0.refractory as number, pursuitTau: E0.pursuit_tau as number, pursuitMax: E0.pursuit_max as number,
  limYaw: E0.lim_yaw as number, limUp: E0.lim_up as number, limDown: E0.lim_down as number, restLidUpper: { l: E0.rest_lid_upper[0], r: E0.rest_lid_upper[1] } as Record<string, number>, kappa: E0.kappa as number,
  vergenceTau: E0.vergence_tau as number, driftSigma: E0.drift_sigma as number, driftTau: E0.drift_tau as number, microRate: E0.micro_rate as number, microAmp: E0.micro_amp as number,
  fixMean: byMode(E0.fix_mean), scanYaw: byMode(E0.scan_yaw), scanPitch: byMode(E0.scan_pitch),
  portraitYaw: E0.portrait[0] as number, portraitPitch: E0.portrait[1] as number, portraitDist: E0.portrait[2] as number, screenDist: E0.screen[0] as number, screenPitch: E0.screen[1] as number,
  blinkRate: byMode(E0.blink_rate), blinkMinGap: E0.blink_min_gap as number, blinkClose: E0.blink_phases[0] as number, blinkHold: E0.blink_phases[1] as number, blinkOpen: E0.blink_phases[2] as number,
  blinkPartial: E0.blink_partial[0] as number, blinkPartialDepth: E0.blink_partial[1] as number, blinkGazeFrom: E0.blink_gaze[0] as number, blinkGazeFull: E0.blink_gaze[1] as number, blinkGazeMax: E0.blink_gaze[2] as number,
  blinkRollDown: E0.blink_roll[0] as number, blinkRollNasal: E0.blink_roll[1] as number,
  lidUpUp: E0.lid_upper[0] as number, lidUpDown: E0.lid_upper[1] as number, lidLowUp: E0.lid_lower[0] as number, lidLowDown: E0.lid_lower[1] as number,
  lidClear: E0.lid_clear[0] as number, lidClearMax: E0.lid_clear[1] as number, lidSagCornea: E0.lid_sag_cornea as number, lidUpMaxOpen: E0.lid_up_max_open as number, lidOverClose: E0.lid_over_close as number,
  pupil: MAT.pupil as number, pupilNear: E0.pupil_near as number,
  headDead: E0.head_follow[0] as number, headInside: E0.head_follow[1] as number, headOmega: E0.head_follow[2] as number, headMaxYaw: E0.head_follow[3] as number, headMaxPitch: E0.head_follow[4] as number,
};
const D2R = Math.PI / 180;

function rng(seed: number) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** The model: world-space gaze direction (azimuth, elevation, degrees) and distance, blink phase, all from a seed. No three.js. */
export class EyeModel {
  p = eyeParams; mode: EyeMode = "portrait"; t = 0; seed = 1; private r = rng(1);
  az = 0; el = 0; invDist = 1;                       // where the gaze is now (world frame: azimuth about +Y from +Z toward +X, elevation up)
  private sacc: { t0: number; dur: number; az0: number; el0: number; az1: number; el1: number } | null = null; private lastSaccEnd = -1;
  private offAz = 0; private offEl = 0; private nextScan = 0; private nextMicro = 0; private mAz = 0; private mEl = 0;
  dAz = 0; dEl = 0; lastBaseAz = NaN; private lastBaseEl = NaN;
  blink = 0; private bl: { t0: number; depth: number } | null = null; private nextBlink = 1;
  headYaw = 0; headPitch = 0; private hvY = 0; private hvP = 0;     // stand-in head follower state, deg
  lastSaccade = { amp: 0, dur: 0, peak: 0 };
  constructor(seed = 1) { this.reset(seed); }
  reset(seed = this.seed) {
    this.seed = seed; this.r = rng(seed * 2654435761); this.t = 0; this.sacc = null; this.lastSaccEnd = -1; this.offAz = this.offEl = this.mAz = this.mEl = this.dAz = this.dEl = 0;
    this.lastBaseAz = NaN; this.blink = 0; this.bl = null; this.nextScan = 0.25 + this.exp(this.p.fixMean[this.mode]); this.nextMicro = 0.3 + this.r(); this.nextBlink = 0.8 + this.exp(60 / this.p.blinkRate[this.mode]);
    this.headYaw = this.headPitch = this.hvY = this.hvP = 0;
  }
  private exp(mean: number) { return -Math.log(1 - this.r() * 0.999) * mean; }
  private gauss() { return Math.sqrt(-2 * Math.log(1 - this.r() * 0.999999)) * Math.cos(2 * Math.PI * this.r()); }
  static profile(x: number, shape: number) { const s = x * x * (3 - 2 * x), j = x * x * x * (10 - 15 * x + 6 * x * x); return s + (j - s) * shape; }
  saccadeDuration(amp: number) { return this.p.saccDurBase + this.p.saccDurPerDeg * amp; }
  startBlink(depth = 1) { if (!this.bl) this.bl = { t0: this.t, depth }; }
  /** One step. base = where the task wants the gaze (world azimuth, elevation in degrees, distance in metres). */
  step(dt: number, baseAz: number, baseEl: number, dist: number) {
    const p = this.p; this.t += dt;
    // voluntary small gaze shifts around the task target, and microsaccades
    let trigger = false;
    if (this.t >= this.nextScan) { this.offAz = this.gauss() * p.scanYaw[this.mode] * 0.5; this.offEl = this.gauss() * p.scanPitch[this.mode] * 0.5; this.nextScan = this.t + 0.25 + this.exp(p.fixMean[this.mode]); trigger = true; }
    if (this.t >= this.nextMicro) { const a = this.r() * 2 * Math.PI, m = p.microAmp * (0.5 + this.r()); this.mAz = Math.cos(a) * m; this.mEl = Math.sin(a) * m * 0.6; this.nextMicro = this.t + this.exp(1 / p.microRate); trigger = true; }
    const jump = Number.isNaN(this.lastBaseAz) ? 0 : Math.hypot(baseAz - this.lastBaseAz, baseEl - this.lastBaseEl);
    if (Number.isNaN(this.lastBaseAz)) { this.az = baseAz; this.el = baseEl; this.invDist = 1 / dist; }
    this.lastBaseAz = baseAz; this.lastBaseEl = baseEl;
    const wantAz = baseAz + this.offAz + this.mAz, wantEl = baseEl + this.offEl + this.mEl;
    if (this.sacc) {
      const s = this.sacc, x = Math.min(1, (this.t - s.t0) / s.dur), f = EyeModel.profile(x, p.saccShape);
      this.az = s.az0 + (s.az1 - s.az0) * f; this.el = s.el0 + (s.el1 - s.el0) * f;
      if (x >= 1) { this.sacc = null; this.lastSaccEnd = this.t; }
    } else {
      const err = Math.hypot(wantAz - this.az, wantEl - this.el);
      if ((trigger || jump > 1 || err > p.pursuitMax) && err > 0.04 && this.t - this.lastSaccEnd >= (err > p.pursuitMax ? 0 : p.refractory) * (trigger && err < 1 ? 0 : 1)) {
        const dur = this.saccadeDuration(err); this.sacc = { t0: this.t, dur, az0: this.az, el0: this.el, az1: wantAz, el1: wantEl };
        this.lastSaccade = { amp: err, dur, peak: err / dur * (1.5 + 0.375 * p.saccShape) };
        if (err > p.blinkGazeFrom && this.r() < Math.min(p.blinkGazeMax, (err - p.blinkGazeFrom) / (p.blinkGazeFull - p.blinkGazeFrom) * p.blinkGazeMax)) this.startBlink(1);
      } else { const k = 1 - Math.exp(-dt / p.pursuitTau); this.az += (wantAz - this.az) * k; this.el += (wantEl - this.el) * k; }
    }
    // fixational drift (an Ornstein-Uhlenbeck walk), vergence
    const kd = Math.exp(-dt / p.driftTau), sd = p.driftSigma * Math.sqrt(1 - kd * kd); this.dAz = this.dAz * kd + this.gauss() * sd; this.dEl = this.dEl * kd + this.gauss() * sd;
    this.invDist += (1 / Math.max(dist, 0.1) - this.invDist) * (1 - Math.exp(-dt / p.vergenceTau));
    // blinks
    if (this.t >= this.nextBlink && !this.bl) this.startBlink(this.r() < p.blinkPartial ? p.blinkPartialDepth : 1);
    if (this.bl) {
      const x = this.t - this.bl.t0, c = p.blinkClose, h = p.blinkHold, o = p.blinkOpen; let b: number;
      if (x < c) { const u = x / c; b = u * u * (3 - 2 * u); } else if (x < c + h) b = 1; else if (x < c + h + o) { const u = 1 - (x - c - h) / o; b = u * u * (3 - 2 * u) * u; /* slow tail */ } else { b = 0; }
      this.blink = b * this.bl.depth;
      if (x >= c + h + o) { this.bl = null; this.blink = 0; this.nextBlink = this.t + p.blinkMinGap + this.exp(Math.max(E0.blink_least_wait, 60 / p.blinkRate[this.mode] - p.blinkMinGap - c - h - o)); }
    }
  }
  /** Stand-in head follower: the head takes the part of the gaze angle beyond headDead plus headInside of the part inside, critically damped. */
  stepHead(dt: number, gazeAzTorso: number, gazeElTorso: number) {
    const p = this.p, part = (g: number, max: number) => { const inn = Math.max(-p.headDead, Math.min(p.headDead, g)); return Math.max(-max, Math.min(max, p.headInside * inn + (g - inn))); };
    const ty = part(gazeAzTorso, p.headMaxYaw), tp = part(gazeElTorso, p.headMaxPitch), w = p.headOmega;
    this.hvY += (w * w * (ty - this.headYaw) - 2 * w * this.hvY) * dt; this.headYaw += this.hvY * dt;
    this.hvP += (w * w * (tp - this.headPitch) - 2 * w * this.hvP) * dt; this.headPitch += this.hvP * dt;
  }
}
// The lab's model constants that are part of the method (scan/micro start delays, the 0.04 deg threshold, the shape of the
// velocity profile, the gaussian's guard) stay in the class above as in the lab: they define the model, they are not tuned.

// ---------------------------------------------------------------------------------------------------------- plug-in
interface Inst { model: EyeModel; sides: any[]; lift: any[]; headJoints: { bone: any; w: number }[]; lastTime: number | undefined; seed: number; mode: string; out: any; [k: string]: any }
const instances = new WeakMap<object, Inst | null>();

function setup(ctx: FrameContext): Inst | null {
  const E = ctx.manifest?.eyes, T = ctx.THREE; if (!E?.sides) return null;
  const sole = ctx.manifest?.rest?.soleHeight ?? 0, tol = E0.match_tolerance;                     // a package lifted onto its shoe soles after the block was written
  const meshes: any[] = []; ctx.root.traverse((o: any) => { if (o.isSkinnedMesh) meshes.push(o); });
  const sides: any[] = [];
  for (const key of ["l", "r"]) {
    const s = E.sides[key], bone = s && ctx.bones.get(s.joint); if (!bone) continue;
    const v = (a: number[]) => new T.Vector3(a[0], a[1], a[2]);
    sides.push({ key, sign: key === "l" ? 1 : -1, bone, mesh: meshes.find((m) => m.name === s.mesh) ?? null, R: s.radius, C: v(s.centre), hinge: v(s.hinge).normalize(),
      up: s.upper && ctx.bones.get(s.upper.joint) ? { bone: ctx.bones.get(s.upper.joint), close: s.upper.closeDeg * D2R } : null,
      low: s.lower && ctx.bones.get(s.lower.joint) ? { bone: ctx.bones.get(s.lower.joint), close: s.lower.closeDeg * D2R } : null,
      med: v(s.canthusMedial), lat: v(s.canthusLateral), apexU: v(s.apexUpper), apexL: v(s.apexLower), yaw: 0, pitch: 0, thU: 0, thL: 0 });
  }
  if (!sides.length) return null;
  // the lash and brow cards are alpha-blended: the shadow map would draw each card as a solid quad, so they cast none (avatar.ts)
  const lift: any[] = [];
  for (const g of E.lift ?? []) {
    const me = meshes.find((m) => m.name === g.mesh), side = sides.find((s) => s.key === g.side); if (!me || !side) continue;
    const pos = me.geometry.attributes.position, n = pos.count, items: any[] = [];
    let dy = 0;                                                         // find the vertical offset between the block and this GLB once
    for (const cand of [0, sole]) { const r0 = g.verts[0]; let hit = false; for (let i = 0; i < n && !hit; i++) hit = Math.abs(pos.getX(i) - r0[0]) < tol && Math.abs(pos.getY(i) - r0[1] - cand) < tol && Math.abs(pos.getZ(i) - r0[2]) < tol; if (hit) { dy = cand; break; } }
    const C = side.C.clone(); C.y += dy;
    // the lid vertices by rest position: with a baked shape the GLB's positions are rewritten, so match against the bake's base
    const base: Float32Array | null = me.geometry.userData.bakeBase ?? null, X = (i: number) => (base ? base[i * 3] : pos.getX(i)), Y = (i: number) => (base ? base[i * 3 + 1] : pos.getY(i)), Z = (i: number) => (base ? base[i * 3 + 2] : pos.getZ(i));
    for (const row of g.verts) {
      const ix: number[] = [], y = row[1] + dy;
      for (let i = 0; i < n; i++) if (Math.abs(X(i) - row[0]) < tol && Math.abs(Y(i) - y) < tol && Math.abs(Z(i) - row[2]) < tol) ix.push(i);
      if (!ix.length) continue;
      const p0 = new T.Vector3(row[0], y, row[2]), d0 = p0.clone().sub(C).normalize();
      items.push({ ix, p0, d0, wu: row[3], wl: row[4], k: row[5], pm: p0.clone(), dm: d0.clone(), rm: p0.distanceTo(C), ring: p0.distanceTo(C) - side.R < E0.ring_margin, L2: 0 });
    }
    // the longest mesh edge at each listed vertex (rest positions), for the chord sag
    const of = new Map<number, any>(); for (const it of items) for (const i of it.ix) of.set(i, it);
    const idx = me.geometry.index?.array; if (idx) for (let f = 0; f < idx.length; f += 3) for (let e = 0; e < 3; e++) {
      const a = idx[f + e], b = idx[f + (e + 1) % 3], ia = of.get(a), ib = of.get(b); if (!ia && !ib) continue;
      const dx = X(a) - X(b), dy2 = Y(a) - Y(b), dz = Z(a) - Z(b), L2 = dx * dx + dy2 * dy2 + dz * dz;
      if (ia && L2 > ia.L2) ia.L2 = L2; if (ib && L2 > ib.L2) ib.L2 = L2;
    }
    // how the eye centre moves with each shape morph of this mesh (the manifest's jointDeltas of the eye joint)
    const jd: any[] = [], dict = me.morphTargetDictionary ?? {}, JD = ctx.manifest?.shape?.jointDeltas ?? {};
    for (const [name, i] of Object.entries(dict)) jd[i as number] = JD[name]?.[E.sides[g.side].joint] ?? null;
    lift.push({ me, side, items, C, jd, key: "" });
  }
  const names = [...ctx.bones.keys()].filter((n: string) => /^neck[_0-9]*\d$/i.test(n)).sort(), hj: { bone: any; w: number }[] = [];
  const hb = ctx.bones.get(ctx.manifest.anchors?.head ?? "head") ?? ctx.bones.get("head");
  if (hb) { for (const n of names) hj.push({ bone: ctx.bones.get(n), w: E0.head_share[0] / Math.max(1, names.length) }); hj.push({ bone: hb, w: names.length ? E0.head_share[1] : 1 }); }
  return { model: new EyeModel(1), sides, lift, headJoints: hj, lastTime: undefined, seed: 1, mode: "", out: {} };
}

function bulgeAt(E: any, angDeg: number) { const h = E.bulge?.h; if (!h) return 0; const x = angDeg / (E.bulge.stepDeg ?? 1), i = Math.floor(x); return i >= h.length - 1 ? 0 : h[i] + (h[i + 1] - h[i]) * (x - i); }

function late(ctx: FrameContext) {
  const st = ctx.state, T = ctx.THREE; if (st.on === false) return;
  let inst = instances.get(ctx.root); if (inst === undefined) { inst = setup(ctx); instances.set(ctx.root, inst); }
  if (!inst) return;                                                    // no eyeballs in this package or style: do nothing
  const E = ctx.manifest.eyes, m = inst.model, p = m.p, q = new T.Quaternion(), q2 = new T.Quaternion(), v = new T.Vector3(), X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0);
  const mode: EyeMode = st.mode ?? (ctx.seated ? "screen" : "portrait"), seed = st.seed ?? 1;
  if (mode !== inst.mode || seed !== inst.seed) { m.mode = mode; m.reset(seed); inst.mode = mode; inst.seed = seed; inst.lastTime = undefined; }
  // `restart` in the state is a counter; when it changes, the model starts again from its seed (a still always starts from a defined state)
  if ((st.restart ?? 0) !== (inst.restart ?? 0)) { inst.restart = st.restart ?? 0; m.reset(seed); inst.lastTime = undefined; }
  if (st.blinkNow) { st.blinkNow = 0; m.startBlink(1); }
  // head frame: the parent of the eye joints
  const eyeMid = new T.Vector3(); for (const s of inst.sides) eyeMid.add(s.bone.getWorldPosition(v)); eyeMid.multiplyScalar(1 / inst.sides.length);
  const rootQ = ctx.rootBone.parent ? ctx.rootBone.parent.getWorldQuaternion(new T.Quaternion()) : new T.Quaternion();
  const headBone = inst.sides[0]?.bone.parent ?? null, hq = new T.Quaternion();
  const base = (tNow: number) => {
    let target: number[] | null = st.target ?? null;                                                // world point, metres (the operator layer's gaze point)
    if (Array.isArray(st.script)) for (const e of st.script) if (e.t <= tNow + 1e-9) target = e.target;
    if (Array.isArray(st.targetRel)) {                                  // [x, y, z] m from the eye midpoint in the FIGURE's frame
      v.set(st.targetRel[0], st.targetRel[1], st.targetRel[2]).applyQuaternion(rootQ); const d = v.length();
      return [Math.atan2(v.x, v.z) / D2R, Math.asin(v.y / Math.max(d, 1e-6)) / D2R, d];
    }
    if (st.targetRel) target = null;
    if (target) { v.set(target[0], target[1], target[2]).sub(eyeMid); const d = v.length(); return [Math.atan2(v.x, v.z) / D2R, Math.asin(v.y / Math.max(d, 1e-6)) / D2R, d]; }
    v.set(0, 0, 1).applyQuaternion(rootQ); const yaw0 = Math.atan2(v.x, v.z) / D2R;
    if (st.targetRel) return [yaw0 + (st.targetRel.az ?? 0), st.targetRel.el ?? 0, st.targetRel.dist ?? 1];
    if (mode === "portrait" && !st.ownHead && headBone) {               // portrait = ahead of the FACE
      headBone.getWorldQuaternion(hq); v.set(0, 0, 1).applyQuaternion(hq);
      return [Math.atan2(v.x, v.z) / D2R + p.portraitYaw, Math.asin(Math.max(-1, Math.min(1, v.y))) / D2R + p.portraitPitch, p.portraitDist];
    }
    return mode === "screen" ? [yaw0, p.screenPitch, p.screenDist] : mode === "idle" ? [yaw0, E0.idle[0], E0.idle[1]] : [yaw0 + p.portraitYaw, p.portraitPitch, p.portraitDist];
  };
  const head = (yawDeg: number, pitchDeg: number) => {                  // stand-in head follower writes neck and head
    for (const h of inst!.headJoints) { const rq = ctx.restQ.get(h.bone.name) ?? q.identity(); h.bone.quaternion.copy(rq).multiply(q.setFromAxisAngle(Y, yawDeg * h.w * D2R)).multiply(q2.setFromAxisAngle(X, -pitchDeg * h.w * D2R)); }
  };
  let bAz = 0, bEl = 0, bDist = 1;
  const one = (dt: number) => { [bAz, bEl, bDist] = base(m.t + dt); m.step(dt, bAz, bEl, bDist); if (st.ownHead) { v.set(0, 0, 1).applyQuaternion(rootQ); m.stepHead(dt, bAz - Math.atan2(v.x, v.z) / D2R, bEl); } };
  // a still (fixed `time`) is computed once and kept; again when the figure's or the head's orientation or the target changed since
  if (headBone) headBone.getWorldQuaternion(hq); const frameKey = [...rootQ.toArray(), ...hq.toArray()].map((x) => x.toFixed(4)).join(",") + JSON.stringify([st.target ?? null, st.targetRel ?? null, mode]);
  if (typeof st.time === "number" && inst.frameKey !== frameKey) { inst.frameKey = frameKey; inst.lastTime = undefined; }
  if (typeof st.time === "number") { if (inst.lastTime === undefined || st.time < m.t - 1e-9) m.reset(seed); const h = E0.still_step; let guard = 0; const most = Math.ceil(st.time / h) + 2; while (m.t + h <= st.time + 1e-9 && guard++ < most) one(h); inst.lastTime = st.time; }
  else if (ctx.dt > 0) { const n = Math.max(1, Math.ceil(ctx.dt / E0.live_step)); for (let i = 0; i < n; i++) one(ctx.dt / n); }
  else if (Number.isNaN(m.lastBaseAz)) one(1e-4);
  if (st.ownHead) { head(m.headYaw, m.headPitch); ctx.root.updateMatrixWorld(true); eyeMid.set(0, 0, 0); for (const s of inst.sides) eyeMid.add(s.bone.getWorldPosition(v)); eyeMid.multiplyScalar(1 / inst.sides.length); }
  // fixation point in the world
  const az = (m.az + m.dAz) * D2R, el = (m.el + m.dEl) * D2R, dist = 1 / Math.max(m.invDist, 1e-3);
  const F = new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(eyeMid);
  const blink = typeof st.blink === "number" ? st.blink : m.blink;
  const out: any = { mode, t: m.t, blink, target: F.toArray(), eyes: {} };
  // rate limit: a moment begins when time passes; within it every evaluation is limited against the angles it began with, by
  // vmax x the time that passed; before time first passes after a restart nothing is limited (setting up a still is not a movement)
  const restartNow = inst.restart ?? 0, dClip = typeof ctx.time === "number" && inst.limTime !== undefined ? Math.abs(ctx.time - inst.limTime) : 0;
  if (inst.limRestart !== restartNow) { inst.limBudget = Infinity; for (const s of inst.sides) s.refYaw = s.refPitch = s.prevYaw = s.prevPitch = undefined; }
  else if (ctx.dt > 0 || dClip > 1e-6) { inst.limBudget = p.mainSeqVmax * (ctx.dt > 0 ? ctx.dt : Math.min(E0.rate_window, dClip)); for (const s of inst.sides) { s.refYaw = s.prevYaw; s.refPitch = s.prevPitch; } }
  inst.limRestart = restartNow; inst.limTime = typeof ctx.time === "number" ? ctx.time : 0;
  const budget = inst.limBudget ?? Infinity;
  for (const s of inst.sides) {
    const restQ = ctx.restQ.get(s.bone.name) ?? new T.Quaternion(), pq = s.bone.parent.getWorldQuaternion(new T.Quaternion()).multiply(restQ);
    let yaw: number, pitch: number;
    if (st.gaze) { yaw = st.gaze.yaw ?? 0; pitch = st.gaze.pitch ?? 0; }
    else if (st.aim && st.target) {
      v.fromArray(st.target).sub(s.bone.getWorldPosition(new T.Vector3())).applyQuaternion(pq.clone().invert());
      [yaw, pitch] = fixationAngles([v.x, v.y, v.z]);
    } else {
      v.copy(F).sub(s.bone.getWorldPosition(new T.Vector3())).normalize().applyQuaternion(pq.clone().invert());
      yaw = Math.atan2(v.x, v.z) / D2R; pitch = Math.asin(Math.max(-1, Math.min(1, v.y))) / D2R;
      yaw = Math.max(-p.limYaw, Math.min(p.limYaw, yaw)) + s.sign * p.kappa; pitch = Math.max(-p.limDown, Math.min(p.limUp, pitch));
    }
    if (!st.aim) { yaw -= s.sign * p.blinkRollNasal * blink; pitch -= p.blinkRollDown * blink; }
    // the eye stays inside its range and turns no faster than the main sequence allows
    yaw = Math.max(-p.limYaw, Math.min(p.limYaw, yaw)); pitch = Math.max(-p.limDown, Math.min(p.limUp, pitch));
    if (!st.aim && Number.isFinite(budget) && s.refYaw !== undefined) { yaw = s.refYaw + Math.max(-budget, Math.min(budget, yaw - s.refYaw)); pitch = s.refPitch + Math.max(-budget, Math.min(budget, pitch - s.refPitch)); }
    s.prevYaw = yaw; s.prevPitch = pitch;
    s.yaw = yaw; s.pitch = pitch;
    const qe = new T.Quaternion().setFromAxisAngle(Y, yaw * D2R).multiply(q.setFromAxisAngle(X, -pitch * D2R));
    s.bone.quaternion.copy(restQ).multiply(qe); s.bone.updateMatrixWorld(true);
    // lids: follow the vertical gaze, then the blink on top (angles about the hinge, + = closing for the upper lid)
    const followU = (pitch >= 0 ? -Math.min(p.lidUpMaxOpen, p.lidUpUp * pitch) : -p.lidUpDown * pitch) + (st.restLids === false ? 0 : p.restLidUpper[s.key] ?? 0);
    const followL = pitch >= 0 ? p.lidLowUp * pitch : p.lidLowDown * pitch;
    if (s.up) { const full = s.up.close / D2R * p.lidOverClose; s.thU = (followU + blink * (full - followU)) * D2R; s.up.bone.quaternion.copy(ctx.restQ.get(s.up.bone.name) ?? q.identity()).multiply(q.setFromAxisAngle(s.hinge, s.thU)); s.up.bone.updateMatrixWorld(true); }
    if (s.low) { const full = -s.low.close / D2R; const rise = followL + blink * (full - followL); s.thL = rise * D2R; s.low.bone.quaternion.copy(ctx.restQ.get(s.low.bone.name) ?? q.identity()).multiply(q.setFromAxisAngle(s.hinge, -s.thL)); s.low.bone.updateMatrixWorld(true); }
    // the eye shader's lid planes (eye-local, units of the radius) and pupil
    const u = s.mesh?.material?.userData?.labEye ?? s.mesh?.userData?.look?.userData?.labEye;
    if (u?.labLid) {
      const inv = qe.clone().invert(), plane = (apex: any, ang: number, other: any, otherAng: number, out4: any) => {
        const a = apex.clone().applyAxisAngle(s.hinge, ang), o = other.clone().applyAxisAngle(s.hinge, otherAng), n = s.lat.clone().sub(s.med).cross(a.clone().sub(s.med)).normalize();
        if (n.dot(o.clone().sub(s.med)) < 0) n.negate();
        const d = n.dot(s.med) / s.R; n.applyQuaternion(inv); out4.set(n.x, n.y, n.z, d);
      };
      plane(s.apexU, s.thU, s.apexL, -s.thL, u.labLid.value[0]); plane(s.apexL, -s.thL, s.apexU, s.thU, u.labLid.value[1]);
      const preset = st.iris && (E.irisPresets?.[st.iris] ?? null); if (preset && u.labIrisA) { u.labIrisA.value.fromArray(preset.outer); u.labIrisB.value.fromArray(preset.inner); }
      if (u.labPupil) u.labPupil.value = p.pupil - p.pupilNear * Math.min(1, Math.max(0, (m.invDist - 1) / 2));
    }
    out.eyes[s.key] = { yaw, pitch, lidUpper: s.thU / D2R, lidLower: s.thL / D2R };
  }
  // The lid rides on the ball. Each listed lid vertex is taken at its position for the CURRENT body shape, turned by its lid joints,
  // and kept at least lidClear above the eye surface there (sphere + the cornea where it now lies); the margin ring is also held within
  // lidClearMax. So the cornea makes its small bulge travel under the lid, and no body shape can push the ball through a lid.
  for (const g of inst.lift) {
    const s = g.side, me = g.me, pos = me.geometry.attributes.position, infl: number[] = me.morphTargetInfluences ?? [], bk = me.geometry.userData.bake, key = infl.join(",") + (bk ? "#" + bk.version : "");
    if (key !== g.key) {
      g.key = key; const MA = me.geometry.morphAttributes?.position ?? [], Cm = g.C.clone();
      for (let k = 0; k < infl.length; k++) if (infl[k] && g.jd[k]) Cm.addScaledVector(v.set(g.jd[k][0], g.jd[k][1], g.jd[k][2]), infl[k]);
      if (bk) { const j = E.sides[s.key].joint, a = ctx.restWorldP?.get(j), b = ctx.restWorldP0?.get(j); if (a && b) Cm.add(a).sub(b); }      // with a baked shape the eye centre moves with the eye joint
      for (const it of g.items) {
        const i0 = it.ix[0];
        if (bk) (it.pb ??= it.p0.clone()).set(bk.position[i0 * 3], bk.position[i0 * 3 + 1], bk.position[i0 * 3 + 2]); else it.pb = it.p0;
        it.pm.copy(it.pb);
        for (let k = 0; k < infl.length; k++) if (infl[k] && MA[k]) { it.pm.x += infl[k] * MA[k].getX(i0); it.pm.y += infl[k] * MA[k].getY(i0); it.pm.z += infl[k] * MA[k].getZ(i0); }
        it.dm.copy(it.pm).sub(Cm); it.rm = it.dm.length(); it.dm.multiplyScalar(1 / it.rm);
      }
    }
    const y = s.yaw * D2R, pt = s.pitch * D2R, gx = Math.sin(y) * Math.cos(pt), gy = Math.sin(pt), gz = Math.cos(y) * Math.cos(pt);
    for (const it of g.items) {
      const au = it.wu > 0 ? 2 * Math.atan2(it.wu * Math.sin(s.thU / 2), 1 - it.wu + it.wu * Math.cos(s.thU / 2)) : 0, al = it.wl > 0 ? 2 * Math.atan2(it.wl * Math.sin(-s.thL / 2), 1 - it.wl + it.wl * Math.cos(-s.thL / 2)) : 0;
      v.copy(it.dm).applyAxisAngle(s.hinge, au + al);
      const hNow = bulgeAt(E, Math.acos(Math.max(-1, Math.min(1, v.x * gx + v.y * gy + v.z * gz))) / D2R), hRest = bulgeAt(E, Math.acos(Math.max(-1, Math.min(1, it.d0.z))) / D2R);
      const need = s.R + p.lidClear + hNow + it.L2 / (6 * (hNow > 1e-5 ? p.lidSagCornea : s.R)); let r = Math.max(it.rm + it.k * (hNow - hRest), need); if (it.ring) r = Math.min(r, need + p.lidClearMax - p.lidClear);
      const d = r - it.rm;
      const pb = it.pb ?? it.p0; for (const i of it.ix) pos.setXYZ(i, pb.x + it.dm.x * d, pb.y + it.dm.y * d, pb.z + it.dm.z * d);
    }
    pos.needsUpdate = true;
  }
  out.head = { yaw: m.headYaw, pitch: m.headPitch }; out.saccade = m.lastSaccade; inst.out = out; st.report = out;
}

export const eyes: Plugin = {
  name: "eyes",
  state: { on: true, mode: undefined as EyeMode | undefined, seed: 1, time: undefined as number | undefined, target: null as number[] | null, gaze: null as { yaw: number; pitch: number } | null, blink: undefined as number | undefined, ownHead: false, report: null as any },
  frame() { /* everything happens in `late`, after the operator layer and the drivers */ },
  late,
};
