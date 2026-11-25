// Capsules for any body (body-fit.ts) and the rig binding's clearances with them: the derived capsules against the lab's baked
// ones for its ten baked persons, and the package's own presets and a slider body seated in the real rig. Reads the committed
// person packages (assets/manikin/operator-m, operator-f: manifests and the GLBs' skeletons) and the built rig.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Operator } from "./operator.ts";
import { deriveBodyFit, weightsOf } from "./body-fit.ts";
import { rigBinding, rigViewFromNodes } from "./rig-binding.ts";
import { readPackage, bodyOf } from "../../../shared/person-model.ts";
import { nodesFromGlb } from "../../../shared/kinematics.ts";

const root = new URL("../../../", import.meta.url).pathname;
const pkgOf = (id: string) => { const man = JSON.parse(readFileSync(`${root}assets/manikin/${id}/${id}.avatar.json`, "utf8")); return readPackage(id, man, new Uint8Array(readFileSync(`${root}assets/manikin/${id}/${id}.glb`))); };
const PKG = { m: pkgOf("operator-m"), f: pkgOf("operator-f") };
const rigManifest = JSON.parse(readFileSync(`${root}assets/rig-b/build/rig-b.manifest.json`, "utf8")), rigNodes = nodesFromGlb(new Uint8Array(readFileSync(`${root}assets/rig-b/build/rig-b.glb`)));

/** A trunk capsule as a section: height, centre depth, half width, half depth (package frame). */
const section = (c: any, at: (n: string) => number[]) => { const j = at(c.joint), y = j[1] + c.a[1], cz = j[2] + (c.a[2] + c.b[2]) / 2;
  return c.a[0] !== 0 || c.b[0] !== 0 ? [y, cz, Math.abs(c.a[0]) + c.ra, c.ra] : [y, cz, c.ra, Math.abs(c.b[2] - c.a[2]) / 2 + c.ra]; };

describe("body capsules for any body", () => {
  test("for the baked persons the derived capsules agree with the baked ones", () => {
    const worst = { thigh: 0, arm: 0, heel: 0, trunk_lower: 0, trunk_upper: 0 }, all: number[] = [];
    for (const sex of ["m", "f"] as const) for (const [id, values] of Object.entries<any>(PKG[sex].manifest.packet.persons)) {
      const body = bodyOf(PKG[sex], values), fit = PKG[sex].manifest.motion.persons[id], ix = new Map(body.rest.names.map((n, i) => [n, i])), at = (n: string) => body.rest.pos[ix.get(n)!];
      const d = deriveBodyFit(sex, body.weights, at);
      for (const s of ["l", "r"]) {
        const bt = fit.capsules.filter((c: any) => c.joint === `thigh_${s}`), dt = d.capsules.filter((c) => c.joint === `thigh_${s}`);
        for (const [x, y] of [[bt[0].ra, dt[0].ra], [bt[0].rb, dt[0].rb], [bt[1].rb, dt[1].rb]]) worst.thigh = Math.max(worst.thigh, Math.abs(x - y));
      }
      for (const [x, y] of [[fit.arm.upper[0], d.arm.upper[0]], [fit.arm.upper[1], d.arm.upper[1]], [fit.arm.fore[0], d.arm.fore[0]], [fit.arm.fore[1], d.arm.fore[1]], [fit.arm.hand, d.arm.hand]]) worst.arm = Math.max(worst.arm, Math.abs(x - y));
      worst.heel = Math.max(worst.heel, Math.abs(fit.seat.heel_back_m - d.heel_back_m));
      // trunk: each baked section against the derived ones at its height (sections thinner than 30 mm are the lab's sparse slices)
      const mine = d.capsules.filter((c) => !c.joint.startsWith("thigh")).map((c) => section(c, at)).sort((a, b) => a[0] - b[0]);
      const hip = at("thigh_l")[1], neck = at("neck_01")[1];
      for (const c of fit.capsules.filter((c: any) => !c.joint.startsWith("thigh") && c.ra >= 0.03)) {
        const b = section(c, at), i = mine.findIndex((x) => x[0] >= b[0]); if (i <= 0) continue;
        const u = (b[0] - mine[i - 1][0]) / (mine[i][0] - mine[i - 1][0]), m = mine[i].map((v, k) => mine[i - 1][k] + (v - mine[i - 1][k]) * u), e = Math.max(...[1, 2, 3].map((k) => Math.abs(m[k] - b[k])));
        all.push(e);
        if (b[0] < hip + 0.55 * (neck - hip)) worst.trunk_lower = Math.max(worst.trunk_lower, e); else worst.trunk_upper = Math.max(worst.trunk_upper, e);
      }
    }
    all.sort((a, b) => a - b);
    // thighs within 5 mm, arms within 3.1 mm, heel within 0.1 mm (ten persons, measured 2026-11-25); trunk sections: half within
    // 3.7 mm, but up to 15 mm at the belly's depth and 18 mm at the shoulders' width, where the packages' helper joints (belly,
    // armpit), added after the lab's bake, hold skin that the bake counted as trunk
    expect(worst.thigh).toBeLessThan(0.0055); expect(worst.arm).toBeLessThan(0.0035); expect(worst.heel).toBeLessThan(0.0005);
    expect(all[Math.floor(all.length / 2)]).toBeLessThan(0.004); expect(worst.trunk_lower).toBeLessThan(0.016); expect(worst.trunk_upper).toBeLessThan(0.019);
  });

  test("the presets and a slider body are seated with their clearances evaluated", () => {
    const presets: [string, "m" | "f", Record<string, number>][] = [
      ...(["Small woman (stature P5)"] as const).map((n) => [n, "f", PKG.f.manifest.shape.presets.find((p: any) => p.name === n).values] as [string, "f", Record<string, number>]),
      ...(["Median man", "Tall man (stature P95)"] as const).map((n) => [n, "m", PKG.m.manifest.shape.presets.find((p: any) => p.name === n).values] as [string, "m", Record<string, number>]),
      ["slider body", "m", { stature: 1700, mass: 118, r_waistcircumference: 1.2 }],
    ];
    const rig = rigViewFromNodes(rigManifest, rigNodes);
    for (const [name, sex, values] of presets) {
      const body = bodyOf(PKG[sex], values), op = new Operator(body.rest); if (body.fit) op.fit = body.fit;
      const b = rigBinding({ op, measures: body.measures, manifest: PKG[sex].manifest, controls: body.values }, rig), r = b.report as any;
      expect({ name, fit: r.person.fit, evaluated: r.clearance.evaluated }).toEqual({ name, fit: true, evaluated: undefined });
      for (const side of ["left", "right"]) for (const part of ["pod_shell", "joystick_base", "joystick_lever", "armrest_pad", "forearm_to_armrest_pad"])
        expect({ name, side, part, ok: Number.isFinite(r.clearance[side][part]?.clearance_mm) }).toEqual({ name, side, part, ok: true });
      if (name === "Tall man (stature P95)" || name === "slider body") expect(r.person.fit_source).toBe("derived");
      expect(Number.isFinite(r.seat.crease_minus_front_mm)).toBe(true);
      // the same weights either way: given as controls or as weights
      const w = rigBinding({ op, measures: body.measures, manifest: PKG[sex].manifest, weights: weightsOf(PKG[sex].manifest, body.values) }, rig);
      expect(w.report.clearance).toEqual(b.report.clearance);
    }
  });
});
