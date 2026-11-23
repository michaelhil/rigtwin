// THE definition of how a joint value becomes a node transform. The generator (when it writes the
// GLB at the neutral pose) and the viewer (when it poses joints) both import this file, so there is
// one convention. The independent checker (tools/glb_inspect.py) has its own implementation and
// `bun run check` compares the two on a set of test poses.
//
//   joint node transform = mount · motion(value)
//
//   mount          pose(pos, rpy) of the joint frame in its parent, from the spec
//   motion(value)  revolute:  rotation about `axis` by value (radians, right-hand rule)
//                  prismatic: translation along `axis` by value (metres)
//                  ball:      rotation Rz(yaw) · Ry(pitch) · Rx(roll) with value = [roll, pitch, yaw] (radians)
//   `axis` is a unit vector expressed in the joint frame.
//
// The GLB stores the node at value = neutral ("rest"). To pose a loaded GLB:
//   transform(value) = rest · motion(neutral)^-1 · motion(value)
// Limits: lower <= value <= upper; for a ball joint each of roll/pitch/yaw may deviate from its
// neutral by lower..upper.
import { type Vec3, type Quat, quatFromAxisAngle, quatFromRpy, quatMul, quatConj, quatRotate, norm } from "./math.ts";

export type JointType = "revolute" | "prismatic" | "ball";
export type JointValue = number | number[];
export interface JointKinematics { type: JointType; axis: number[] | null; lower: number; upper: number; neutral: JointValue }
/** A rigid transform: translation then rotation (unit quaternion x, y, z, w). */
export interface Trs { t: Vec3; q: Quat }

export const IDENTITY: Trs = { t: [0, 0, 0], q: [0, 0, 0, 1] };

/** a · b : apply b first, then a. */
export function composeTrs(a: Trs, b: Trs): Trs {
  const r = quatRotate(a.q, b.t);
  return { t: [a.t[0] + r[0], a.t[1] + r[1], a.t[2] + r[2]], q: quatMul(a.q, b.q) };
}
export function invertTrs(a: Trs): Trs {
  const q = quatConj(a.q), r = quatRotate(q, a.t);
  return { t: [-r[0], -r[1], -r[2]], q };
}
export const trsFromPose = (pos: Vec3, rpy: Vec3): Trs => ({ t: [pos[0], pos[1], pos[2]], q: quatFromRpy(rpy) });

/** The motion a joint contributes at a value (see the header). */
export function jointMotion(j: Pick<JointKinematics, "type" | "axis">, value: JointValue): Trs {
  if (j.type === "ball") {
    if (!Array.isArray(value) || value.length !== 3) throw new Error("a ball joint value is [roll, pitch, yaw]");
    return { t: [0, 0, 0], q: quatFromRpy(value as Vec3) };
  }
  if (typeof value !== "number" || !j.axis) throw new Error(`a ${j.type} joint needs a numeric value and an axis`);
  const a = norm(j.axis as Vec3);
  if (j.type === "revolute") return { t: [0, 0, 0], q: quatFromAxisAngle(a, value) };
  return { t: [a[0] * value, a[1] * value, a[2] * value], q: [0, 0, 0, 1] };
}

/** Joint node transform from its mount frame: mount · motion(value). Used when the GLB is written. */
export const jointTransform = (mount: Trs, j: Pick<JointKinematics, "type" | "axis">, value: JointValue): Trs => composeTrs(mount, jointMotion(j, value));

/** Joint node transform from the stored rest transform (at neutral). Used when a loaded GLB is posed. */
export function poseFromRest(rest: Trs, j: JointKinematics, value: JointValue): Trs {
  return composeTrs(composeTrs(rest, invertTrs(jointMotion(j, j.neutral))), jointMotion(j, value));
}

/** null when the value is inside the limits, otherwise a message. The description file writes limits
 *  rounded to 6 decimals (15° = 0.2617994 rad is written 0.261799), so a value exactly at a stated limit
 *  may lie up to 5e-7 beyond the written one; the tolerance of 1e-6 (rad or m) accepts it. */
export function limitViolation(j: JointKinematics, value: JointValue): string | null {
  const eps = 1e-6;
  if (j.type === "ball") {
    const v = value as number[], n = j.neutral as number[];
    for (let i = 0; i < 3; i++) if (!(v[i] - n[i] >= j.lower - eps && v[i] - n[i] <= j.upper + eps)) return `component ${i} is ${v[i] - n[i]} from neutral, outside [${j.lower}, ${j.upper}]`;
    return null;
  }
  const v = value as number;
  return v >= j.lower - eps && v <= j.upper + eps ? null : `${v} is outside [${j.lower}, ${j.upper}]`;
}
