// The body's collision capsules for any shape (owner: MV-rig), browser and server alike, from the shape weights alone.
//
// The lab measured capsules on the mesh of each baked person only (motion.persons[*]: trunk sections as horizontal stadium
// capsules riding on the spine joints, two tapered capsules per thigh, arm radii). A preset or a slider body that is not a
// baked person had none, so its clearances could not be evaluated. tools/person-capsules.ts runs the lab's measurement on
// the full clay body for a few hundred shapes and fits every measured number linearly in the 40 shape-target weights (as the
// joint deltas are); body-capsules.json holds the coefficients. Here they become capsules for the current body:
//
//   deriveBodyFit(sex, weights, at)   -> { capsules, arm, heel_back_m, extra }
//     capsules: the same kind as a baked fit (trunk sections on pelvis / spine_01..05, thighs), joint-relative, rest world
//               axes, metres: the solver (operator.ts) may use them as op.fit for a body that is not a baked person
//     extra:    shin (knee included), upper-arm and forearm capsules, for clearance reports only (the solver tests the arms
//               against every fit capsule, so the arms' own capsules must not be among them)
//   weightsOf(manifest, controls)      the shape model's target weights for control values (avatar.ts shapeWeights)
//
// Stations and windows: assets/manikin/params/runtime-rig.toml [rig_binding.capsules] (the lab's own definitions).
import rawRig from "../../../assets/manikin/params/runtime-rig.toml";
import { stripRuntime } from "../../../shared/runtime-params.ts";
import MODELS from "./body-capsules.json";
import type { BodyFit, V3 } from "./operator.ts";

const CAPS = stripRuntime(rawRig).rig_binding.capsules;
export const MODEL_STATIONS = {
  torso_below_hip: CAPS.torso_below_hip as number, slice_step: CAPS.slice_step as number, slice_half_height: CAPS.slice_half_height as number, radius_window: CAPS.radius_window as number,
  slice_min_points: CAPS.slice_min_points as number, thigh: CAPS.thigh as number[], calf: CAPS.calf as number[], upperarm: CAPS.upperarm as number[], lowerarm: CAPS.lowerarm as number[], sample_sd: CAPS.sample_sd as number, sample_bmi: CAPS.sample_bmi as number[],
} as const;
const TORSO = ["pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05"];

export type Capsule = { joint: string; a: V3; b: V3; ra: number; rb: number };
export interface DerivedFit { capsules: Capsule[]; extra: Capsule[]; arm: BodyFit["arm"]; heel_back_m: number; source: "derived" }
interface Model { fractions: number[]; targets: string[]; outputs: string[]; coef: number[][] }

export function weightsOf(manifest: any, controls: Record<string, number>): Record<string, number> {
  const sh = manifest.shape, mo = sh.model, values: Record<string, number> = {};
  for (const c of sh.controls ?? []) values[c.id] = Math.min(c.max, Math.max(c.min, Number(controls[c.id] ?? c.default ?? 0)));
  const x = mo.inputs.map((id: string, i: number) => ((values[id] ?? 0) - (mo.centre?.[i] ?? 0)) / (mo.scale?.[i] ?? 1)), w: Record<string, number> = {};
  for (const [t, d] of Object.entries<any>(mo.targets)) { let v = d.bias ?? 0; for (let i = 0; i < x.length; i++) v += (d.coef[i] ?? 0) * x[i]; w[t] = Math.min(d.max ?? 3, Math.max(d.min ?? -3, v)); }
  return w;
}
/** Is there a capsule model for this package's body? (by its sex: "m" or "f") */
export const hasModel = (sex: string) => !!(MODELS as any).models?.[sex];

/** Capsules for the body with these shape weights; `at(joint)` gives its rest joint positions (package frame) for that shape. */
export function deriveBodyFit(sex: string, weights: Record<string, number>, at: (joint: string) => number[]): DerivedFit {
  const M = (MODELS as any).models?.[sex] as Model | undefined;
  if (!M) throw new Error(`body fit: no capsule model for a body of sex '${sex}' (viewer/src/person/body-capsules.json)`);
  const w = [1, ...M.targets.map((t) => weights[t] ?? 0)], val: Record<string, number> = {};
  M.outputs.forEach((n, j) => { let s = 0; const c = M.coef[j]; for (let i = 0; i < c.length; i++) s += c[i] * w[i]; val[n] = s; });
  const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a: number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
  // trunk: sections at fixed shares of hip-to-neck, each riding on the spine joint whose segment holds its height
  const y0 = Math.min(at("thigh_l")[1], at("thigh_r")[1]) - MODEL_STATIONS.torso_below_hip, y1 = at("neck_01")[1], capsules: Capsule[] = [];
  for (let k = 0; k < M.fractions.length; k++) {
    const y = y0 + (y1 - y0) * M.fractions[k], cz = val[`torso_${k}.cz`], hx = val[`torso_${k}.hx`], hz = val[`torso_${k}.hz`];
    let jn = TORSO[0]; for (let i = 1; i < TORSO.length; i++) if (y >= at(TORSO[i])[1]) jn = TORSO[i];
    const j = at(jn), ry = y - j[1], rz = cz - j[2];
    capsules.push(hx >= hz ? { joint: jn, a: [-(hx - hz), ry, rz], b: [hx - hz, ry, rz], ra: hz, rb: hz } : { joint: jn, a: [0, ry, rz - (hz - hx)], b: [0, ry, rz + (hz - hx)], ra: hx, rb: hx });
  }
  const limb = (a: string, b: string, span: number[], r: number[], out: Capsule[]) => {
    const d = sub(at(b), at(a));
    for (let i = 0; i + 1 < span.length; i++) out.push({ joint: a, a: mul(d, span[i]), b: mul(d, span[i + 1]), ra: r[i], rb: r[i + 1] });
  };
  const extra: Capsule[] = [], rs = (p: string, n: number) => Array.from({ length: n }, (_, i) => val[`${p}.${i}`]);
  for (const s of ["l", "r"]) {
    limb(`thigh_${s}`, `calf_${s}`, CAPS.thigh_span, rs(`thigh_${s}`, 3), capsules);
    limb(`calf_${s}`, `foot_${s}`, CAPS.calf_span, rs(`calf_${s}`, 3), extra);
    const ua = rs(`upperarm_${s}`, 3), fa = rs(`lowerarm_${s}`, 3);
    limb(`upperarm_${s}`, `lowerarm_${s}`, [MODEL_STATIONS.upperarm[0], MODEL_STATIONS.upperarm[2]], [ua[0], ua[2]], extra);
    limb(`lowerarm_${s}`, `hand_${s}`, CAPS.lowerarm_span, [fa[0], fa[2]], extra);
  }
  const [hs, hmin] = CAPS.hand_scale as number[];
  return {
    capsules, extra, source: "derived",
    arm: { upper: [val["upperarm_l.1"], val["upperarm_l.2"]], fore: [val["lowerarm_l.0"], val["lowerarm_l.2"]], hand: Math.max(val["hand_l.half_thickness"] * hs, hmin) },
    heel_back_m: val["foot_l.heel_back"],
  };
}
