// The person in plain words, for replies, the history and the trace (no imports but types, so that core.ts, intent.ts and
// person.ts can all use it). Only words of the commands' own vocabulary and numbers: the public trace shows them as they are.
import type { PersonState } from "./doc.ts";

/** The percentile presets of person.set: the package's own presets with their exact values (the coordinator's decision of
 *  2026-11-25), so that the page, the package and the commands agree. A stature percentile with the survey's conditional build,
 *  the usual ergonomic convention. The lab's baked test bodies (F05, M50, M95H: the tall heavy man, 1869 mm, 115 kg) stay
 *  reachable by their preset names for worst cases; they are not these presets. */
export const PRESETS: Record<string, { sex: "female" | "male"; preset: string; means: string }> = {
  "P5 woman": { sex: "female", preset: "Small woman (stature P5)", means: "stature 5th percentile of women (1525 mm) with the survey's build for it (58.3 kg)" },
  "P50 man": { sex: "male", preset: "Median man", means: "median man (1756.2 mm, 85.5 kg)" },
  "P95 man": { sex: "male", preset: "Tall man (stature P95)", means: "stature 95th percentile of men (1870 mm) with the survey's build for it (96.6 kg)" },
};
/** The postures by everyday name: the operating posture is the seated operator's solver on the rig's own grips, pedals,
 *  seat and screens; the relaxed stand is the package's RELAXED_STAND (the idle-stand clip at 1.0 s, sampled by the page). */
export const OPERATING = "operating", RELAXED_STAND = "RELAXED_STAND";
export const POSTURE_WORDS: Record<string, string> = { operating: OPERATING, operate: OPERATING, seated: OPERATING, sitting: OPERATING, "relaxed stand": RELAXED_STAND, stand: RELAXED_STAND, standing: RELAXED_STAND, relaxed_stand: RELAXED_STAND };
export const STYLES = ["dressed", "clay"] as const, SEXES = ["female", "male"] as const, TONES = ["light", "medium", "dark"] as const;

const r1 = (x: number) => Math.round(x * 10) / 10;
/** "P50 man, dressed (light tone, glasses, headset), 175.6 cm, 86 kg, operating" */
export function sayPerson(p: PersonState): string {
  const who = p.preset ?? (p.sex === "female" ? "woman" : "man");
  const wear = p.style === "clay" ? "clay figure" : `dressed (${p.tone} tone${p.glasses ? ", glasses" : ""}${p.headset ? ", headset" : ""})`;
  const size = `${r1((p.body.stature ?? 0) / 10)} cm, ${r1(p.body.mass ?? 0)} kg`;
  const others = Object.keys(p.body).filter((k) => k !== "stature" && k !== "mass").length;
  const posture = p.posture === OPERATING ? "operating" : p.posture === RELAXED_STAND ? "relaxed stand" : `posture ${p.posture}`;
  return `${who}${p.preset && p.sex === "female" && !/woman/i.test(p.preset) ? " (woman)" : ""}, ${wear}, ${size}${others ? `, ${others} other body control${others === 1 ? "" : "s"} set` : ""}, ${posture}`;
}
