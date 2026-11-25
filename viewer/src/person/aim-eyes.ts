import { section } from "./params.ts";
import type { V3 } from "./operator.ts";

const EYES = section("eyes");
const RAD = Math.PI / 180;

/** Both the solver and the drawn eyes use the same clamped fixation in each eye's rest frame. */
export function fixationAngles([x, y, z]: V3): [number, number] {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return [
    clamp(Math.atan2(x, z) / RAD, -EYES.lim_yaw, EYES.lim_yaw),
    clamp(Math.atan2(y, Math.hypot(x, z)) / RAD, -EYES.lim_down, EYES.lim_up),
  ];
}
