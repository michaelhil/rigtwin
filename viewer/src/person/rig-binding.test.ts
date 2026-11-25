// The rig binding without a browser: the real rig's built GLB and description file (assets/rig-b/build, made by the check's
// build step before these tests run) posed by shared/kinematics.ts, three persons from rig-binding.fixture.json (rest
// skeletons, fits and survey measures of the dressed operator packages), the person's own solver (operator.ts).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Operator, defaultTargets, hold, type Controls, type Targets } from "./operator.ts";
import { section } from "./params.ts";
import { nodesFromGlb } from "../../../shared/kinematics.ts";
import type { Manifest } from "../../../shared/manifest.ts";
import { rigBinding, rigViewFromNodes, pkgToModel, modelToPkg, gripProfile, type FullRigBinding as RigBinding } from "./rig-binding.ts";
import fx from "./rig-binding.fixture.json";

const BUILD = new URL("../../../assets/rig-b/build/", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(BUILD + "rig-b.manifest.json", "utf8")) as Manifest;
const nodes = nodesFromGlb(new Uint8Array(readFileSync(BUILD + "rig-b.glb")));
const PERSONS = (fx as any).persons as Record<string, { rest: any; fit: any; measures: Record<string, number> }>;
const joint = (id: string) => manifest.joints.find((j) => j.id === id)!;
const param = (k: string) => manifest.parameters[k].value as number;

type Values = Record<string, number | number[]>;
function bind(person: string, values: Values = {}, opts: { fit?: boolean } = {}) {
  const p = PERSONS[person], op = new Operator(p.rest); if (opts.fit !== false) op.fit = p.fit;
  const rig = rigViewFromNodes(manifest, nodes, values);
  return { op, rig, b: rigBinding({ op, measures: p.measures }, rig) };
}
/** Solve as the person module does: defaultTargets merged under the binding's targets, the stick lean added, head level. */
function seated(op: Operator, b: RigBinding) {
  op.targets = { ...defaultTargets(op), ...b.targets } as Targets;
  const c: Controls = { ...hold(), headOverride: [0, 0], stick: { l: [...b.stickLean.l], r: [...b.stickLean.r] } };
  op.resetRun(); op.solve(c, 0);
  const e = (n: string) => op.P[op.j(n)], mid = (a: number[], c2: number[]) => a.map((x, i) => (x + c2[i]) / 2);
  return { eye: mid(e("eye_l"), e("eye_r")), hip: mid(e("thigh_l"), e("thigh_r")) };
}
const finite = (v: unknown, path = ""): string[] => {
  if (typeof v === "number") return Number.isFinite(v) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => finite(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => finite(x, `${path}.${k}`));
  return [];
};
const close = (a: number[], b: number[], tol: number) => a.every((x, i) => Math.abs(x - b[i]) <= tol);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const len = (a: number[]) => Math.hypot(...a);
/** The seat cushion's top under a package-frame z, from the binding's own profile (contactPlanes[seat].profile: [z, y]). */
const cushionTop = (b: RigBinding, z: number) => {
  const pr = b.contactPlanes[0].profile!.filter((_, i, a) => i === 0 || a[i][0] > a[i - 1][0]);
  for (let i = 1; i < pr.length; i++) if (z <= pr[i][0]) { const u = (z - pr[i - 1][0]) / (pr[i][0] - pr[i - 1][0]); return pr[i - 1][1] + (pr[i][1] - pr[i - 1][1]) * Math.max(0, u); }
  return pr[pr.length - 1][1];
};
/** Every joint at its two limits (a ball joint: each component at its offset limit). */
const limitPoses = (): [string, Values][] => manifest.joints.flatMap((j) => j.type === "ball"
  ? [[`${j.id} lower`, { [j.id]: (j.neutral as number[]).map((n) => n + j.lower) }], [`${j.id} upper`, { [j.id]: (j.neutral as number[]).map((n) => n + j.upper) }]] as [string, Values][]
  : [[`${j.id} lower`, { [j.id]: j.lower }], [`${j.id} upper`, { [j.id]: j.upper }]] as [string, Values][]);

describe("rig binding", () => {
  test("the rig carries the points the person needs", () => {
    for (const id of ["D_seat_ref_live", "D_seat_front", "D_backrest_ref", "D_armrest_L", "D_armrest_R", "D_grip_L", "D_grip_R", "D_grip_axis_L", "D_grip_axis_R", "D_heel_rest", "D_pedal_face_1", "D_pedal_face_2", "D_pedal_face_3", "S_ts_screen", "S_mon_screen"])
      expect(nodes.some((n) => n.name === id)).toBe(true);
    // at neutral the backrest reference is the seat reference, and the seat front is the cushion's foremost point
    const d = (id: string) => manifest.datums.find((x) => x.id === id)!.origin;
    expect(close(d("D_backrest_ref"), d("D_seat_ref_live"), 1e-6)).toBe(true);
    expect(close(d("D_seat_front"), [param("seat.cushion_front_lip_x"), 0, param("seat.cushion_top_z_front") - param("seat.cushion_lip_radius")], 1e-6)).toBe(true);
  });

  test("no NaN for any person, and none at any joint's limit", () => {
    for (const id of Object.keys(PERSONS)) { const { b } = bind(id); expect(finite(b)).toEqual([]); }
    for (const [name, values] of limitPoses()) { const { b } = bind("M50", values); expect({ name, bad: finite(b) }).toEqual({ name, bad: [] }); }
    const { b } = bind("F05", {}, { fit: false });                  // a body that is not a baked person: no capsules, still finite
    expect(finite(b)).toEqual([]); expect(b.report.notes.join(" ")).toContain("not evaluated");
  });

  test("the targets are the rig's own points, in the package frame", () => {
    const { b, rig } = bind("M50");
    const m = (p: number[]) => pkgToModel(b.place, p), at = (id: string) => rig.point(id)!;
    expect(close(m(b.targets.touch!), at("S_ts_screen"), 1e-9)).toBe(true);
    expect(close(m(b.targets.screen!.centre), at("S_mon_screen"), 1e-9)).toBe(true);
    for (const s of ["l", "r"] as const) {
      const g = b.targets.grip![s], c = [0, 1, 2].map((k) => g.pivot[k] + 0); void c;
      // the stick's centre with the lean applied is the handle centre D_grip_axis_*
      const [a, s2] = b.stickLean[s].map((x) => (x * Math.PI) / 180), axis = [-Math.sin(s2), Math.cos(a) * Math.cos(s2), Math.sin(a) * Math.cos(s2)];
      expect(close(m(g.pivot.map((x, k) => x + axis[k] * g.length)), at(`D_grip_axis_${s.toUpperCase()}`), 1e-9)).toBe(true);
      expect(g.radius).toBe(param("pods.grip_radius"));
    }
    expect(b.targets.seatFront).toBeCloseTo(modelToPkg(b.place, at("D_seat_front"))[2], 9);
    // the monitor's curve: the sagitta of its active arc on its radius (edges at half the arc along the circle)
    const R = param("monitor.radius"), arc = param("monitor.active_arc"), half = arc / 2 / R;
    expect(b.targets.screen!.curve!).toBeCloseTo(R - R * Math.cos(half), 12);
    expect(b.targets.screen!.curve!).toBeGreaterThan(0.09); expect(b.targets.screen!.curve!).toBeLessThan(R - Math.sqrt(R * R - (arc / 2) ** 2));   // under the chord rule's 0.102
    expect(close(modelToPkg(b.place, pkgToModel(b.place, [0.1, 0.2, 0.3])), [0.1, 0.2, 0.3], 1e-12)).toBe(true);
  });

  test("targets follow every rig adjustment", () => {
    const n0 = bind("M50").b, M = (b: RigBinding, p: number[]) => pkgToModel(b.place, p);
    const moved = (b: RigBinding) => ({
      hip: M(b, b.targets.seat!), gripL: M(b, b.targets.grip!.l.pivot), gripR: M(b, b.targets.grip!.r.pivot), armL: M(b, b.targets.armrest!.l), armR: M(b, b.targets.armrest!.r),
      touch: M(b, b.targets.touch!), screen: M(b, b.targets.screen!.centre), heel0: M(b, b.targets.pedals![0].heel), heel1: M(b, b.targets.pedals![1].heel), seatPt: M(b, b.contactPlanes[0].point),
    });
    const ref = moved(n0);
    // seat height and slide carry everything on the seat by the same amount; pedals and the monitor stay
    for (const [jid, dir] of [["J_seat_height", [0, 0, 1]], ["J_seat_slide", [1, 0, 0]]] as const) for (const v of [joint(jid).lower, joint(jid).upper]) {
      const now = moved(bind("M50", { [jid]: v }).b), d = dir.map((x) => x * v);
      for (const k of ["hip", "gripL", "gripR", "armL", "armR", "touch", "seatPt"] as const) expect({ jid, k, ok: close(sub(now[k], ref[k]), d, 1e-6) }).toEqual({ jid, k, ok: true });
      for (const k of ["screen", "heel0", "heel1"] as const) expect({ jid, k, ok: close(now[k], ref[k], 1e-9) }).toEqual({ jid, k, ok: true });
    }
    // swivel: the figure turns with the seat; what it holds keeps its distance from the swivel axis
    { const v = joint("J_seat_swivel").upper, b = bind("M50", { J_seat_swivel: v }).b, now = moved(b), axis = manifest.joints.find((j) => j.id === "J_seat_swivel")!.origin;
      expect(b.place.yawDeg).toBeCloseTo((v * 180) / Math.PI, 6);
      const r = (p: number[]) => Math.hypot(p[0] - axis[0], p[1] - axis[1]);
      for (const k of ["hip", "gripL", "gripR", "armL", "touch"] as const) expect(r(now[k])).toBeCloseTo(r(ref[k]), 6);
      expect(close(now.heel0, ref.heel0, 1e-9)).toBe(true); }
    // recline and tilt set the trunk angle; the hip stays on the backrest plane
    for (const [values, want] of [[{ J_seat_recline: joint("J_seat_recline").lower }, 0], [{ J_seat_recline: joint("J_seat_recline").upper }, 35], [{ J_seat_tilt: joint("J_seat_tilt").upper }, 12 - 5], [{ J_seat_tilt: joint("J_seat_tilt").lower }, 12 + 5]] as const) {
      const b = bind("M50", values as Values).b, bp = b.contactPlanes[1], h = b.targets.seat!;
      expect(b.targets.recline!).toBeCloseTo(want, 3);
      expect(Math.abs(len(bp.normal) - 1)).toBeLessThan(1e-9);
      const dBack = sub(h, bp.point).reduce((s, x, i) => s + x * bp.normal[i], 0);
      expect(dBack).toBeCloseTo(sub(n0.targets.seat!, n0.contactPlanes[1].point).reduce((s, x, i) => s + x * n0.contactPlanes[1].normal[i], 0), 6);
    }
    // armrest slide moves its palm target along the pad by the travel; the other side stays
    { const v = joint("J_pod_armrest_L").upper, now = moved(bind("M50", { J_pod_armrest_L: v }).b);
      expect(len(sub(now.armL, ref.armL))).toBeCloseTo(v, 6); expect(close(now.armR, ref.armR, 1e-9)).toBe(true); }
    // joysticks: the lean follows the lever, the other grip stays
    for (const jid of ["J_joy_L_roll", "J_joy_L_pitch"]) for (const v of [joint(jid).lower, joint(jid).upper]) {
      const b = bind("M50", { [jid]: v }).b;
      expect(Math.hypot(b.stickLean.l[0] - n0.stickLean.l[0], b.stickLean.l[1] - n0.stickLean.l[1])).toBeGreaterThan(5);
      expect(b.stickLean.r).toEqual(n0.stickLean.r);
    }
    // pedals: the tray carries the heels; a pedal pressed to its stop has no travel left
    { const v = joint("J_pedal_tray").lower, now = moved(bind("M50", { J_pedal_tray: v }).b);
      expect(close(sub(now.heel0, ref.heel0), [v, 0, 0], 1e-6)).toBe(true); }
    { const b = bind("M50", { J_pedal_1: joint("J_pedal_1").upper }).b;
      expect(b.targets.pedals![0].travel).toBeCloseTo(0, 3); expect(n0.targets.pedals![0].travel).toBeGreaterThan(5);
      expect(b.targets.pedals![0].pitch).toBeLessThan(n0.targets.pedals![0].pitch); }
    // monitor height and the touchscreen mount move what the eyes and the finger aim at
    { const v = joint("J_mon_height").upper, now = moved(bind("M50", { J_mon_height: v }).b);
      expect(len(sub(now.screen, ref.screen))).toBeCloseTo(v, 6); }
    { const j = joint("J_ts_arm"), now = moved(bind("M50", { J_ts_arm: (j.neutral as number[]).map((x) => x + j.upper) }).b);
      expect(len(sub(now.touch, ref.touch))).toBeGreaterThan(0.02); }
  });

  test("the seat is survey-true: seated eye = survey sitting eye height less the cushion's compression", () => {
    const comp = param("seat.eye_cushion_compression");
    const poses: Values[] = [{}, { J_seat_height: joint("J_seat_height").lower }, { J_seat_height: joint("J_seat_height").upper }, { J_seat_slide: joint("J_seat_slide").upper },
      { J_seat_swivel: joint("J_seat_swivel").lower }, { J_pod_armrest_R: joint("J_pod_armrest_R").lower }, { J_joy_R_pitch: joint("J_joy_R_pitch").upper }, { J_pedal_tray: joint("J_pedal_tray").upper }, { J_mon_height: joint("J_mon_height").lower }];
    for (const id of Object.keys(PERSONS)) {
      const want = PERSONS[id].measures.eyeheightsitting / 1000 - comp;
      for (const values of poses) {
        const { op, b } = bind(id, values), { eye, hip } = seated(op, b);
        expect({ id, values, within_1mm: Math.abs(eye[1] - cushionTop(b, hip[2]) - want) < 0.001 }).toEqual({ id, values, within_1mm: true });
        expect(b.report.eye.eye_above_cushion_m).toBeCloseTo(want, 3);
      }
      // another recline turns the trunk about the hip: the hip keeps its height above the cushion, the eye goes where the trunk
      // takes it (lower when lying back; the rest skeleton's trunk leans forward, so the highest eye is near the neutral recline)
      for (const r of [joint("J_seat_recline").lower, joint("J_seat_recline").upper]) {
        const { op, b } = bind(id, { J_seat_recline: r }), { eye, hip } = seated(op, b);
        expect(hip[1] - cushionTop(b, hip[2])).toBeCloseTo(b.report.person.hip_above_cushion_m, 3);
        if (r === joint("J_seat_recline").upper) expect(eye[1] - cushionTop(b, hip[2])).toBeLessThan(want - 0.05);
      }
    }
  });

  test("the binding hands the operator back clean, and contact surfaces are sound", () => {
    const p = PERSONS.F05, op = new Operator(p.rest); op.fit = p.fit; const idle = { fps: 30, frames: 1, joints: {} };
    op.idle = idle; op.time = 7;
    const b = rigBinding({ op, measures: p.measures }, rigViewFromNodes(manifest, nodes));
    expect(op.idle).toBe(idle); expect(op.time).toBe(0); expect(op.head).toEqual([0, 0]);
    const [seat, back] = b.contactPlanes;
    expect(seat.name).toBe("seat"); expect(back.name).toBe("backrest");
    expect(Math.abs(len(seat.normal) - 1)).toBeLessThan(1e-9); expect(seat.normal[1]).toBeGreaterThan(0.9);
    expect(seat.pan!.front).toBeCloseTo(b.targets.seatFront!, 9); expect(seat.pan!.rear).toBeLessThan(seat.pan!.front - 0.4);
    expect(seat.pan!.edge).toBe(param("seat.cushion_lip_radius")); expect(seat.pan!.halfWidth).toBeCloseTo(param("seat.pan_width_rear") / 2, 9);
    expect(back.compress_m).toBe(section("operator").targets.back_press);
    // the pods' inner sides: facing the seat's centre line, on the trays' inner edges, carried with the seat
    for (const [name, sx] of [["pod_L", -1], ["pod_R", 1]] as const) {
      const pod = b.contactPlanes.find((c) => c.name === name)!, s2 = pod.slab!;
      expect(Math.sign(pod.normal[0])).toBe(sx); expect(Math.abs(pod.normal[0])).toBeGreaterThan(0.99); expect(s2.up[1]).toBeGreaterThan(0.98);
      expect(Math.abs(pod.point[0])).toBeCloseTo(param("pods.joy_y") + (manifest.parameters["pods.tray_outline_front"].value as number[][])[0][1], 6);
      expect(s2.profile.length).toBeGreaterThan(20); expect(s2.box.height).toBeCloseTo(0, 3); expect(s2.box.up[1]).toBeLessThanOrEqual(0); expect(s2.box.up[0]).toBeLessThan(-0.05);
      expect(s2.edge).toBe(param("pods.shell_bevel"));
    }
    const up = bind("F05", { J_seat_height: joint("J_seat_height").upper }).b.contactPlanes.find((c) => c.name === "pod_L")!;
    expect(up.point[1] - b.contactPlanes.find((c) => c.name === "pod_L")!.point[1]).toBeCloseTo(joint("J_seat_height").upper, 6);
  });

  test("the findings are reported, not hidden", () => {
    const r = Object.fromEntries(Object.keys(PERSONS).map((id) => [id, bind(id).b.report])) as Record<string, any>;
    for (const id of Object.keys(r)) {
      expect(r[id].seat.depth_m).toBeCloseTo(param("seat.cushion_front_lip_x") - param("seat.backrest_surface_x_at_cushion"), 6);
      expect(r[id].reach.left.out_of_reach_mm).toBe(0); expect(r[id].reach.right.out_of_reach_mm).toBe(0);
      expect(r[id].eye.main_monitor.eye_to_centre_m).toBeGreaterThan(0.6);
    }
    // the short woman: with her back on the backrest the seat front reaches beyond her knee crease, and her feet do not reach
    // the pedals with the seat and the pedal tray as photographed
    expect(r.F05.seat.crease_minus_front_mm).toBeLessThan(0);
    expect(r.F05.seat.leg_short_of_pedal_mm.left).toBeGreaterThan(50);
    expect(r.M95H.seat.crease_minus_front_mm).toBeGreaterThan(0);
    expect(r.M50.seat.leg_short_of_pedal_mm.left).toBe(0);
  });

  test("the grip profile in the description file is the lever's own shape: within 1 mm of its mesh, flare included", () => {
    const glb = new Uint8Array(readFileSync(BUILD + "rig-b.glb")), dv = new DataView(glb.buffer, glb.byteOffset), jl = dv.getUint32(12, true);
    const gl = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl))), bin = glb.byteOffset + 20 + jl + 8;
    const acc = (i: number) => { const a = gl.accessors[i], bv = gl.bufferViews[a.bufferView], o = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      return a.componentType === 5126 ? new Float32Array(glb.buffer, o, a.count * 3) : a.componentType === 5123 ? new Uint16Array(glb.buffer, o, a.count) : new Uint32Array(glb.buffer, o, a.count); };
    const neutral = rigViewFromNodes(manifest, nodes);
    for (const S of ["L", "R"] as const) {
      const { profile: prof, hold } = gripProfile(manifest, S);
      expect(prof[0][0]).toBeLessThanOrEqual(-0.06); expect(prof[prof.length - 1][0]).toBeGreaterThanOrEqual(0.06);
      // the built GLB's lever mesh (every primitive) in the model frame at neutral, cut across D_grip_axis_* there
      const node = gl.nodes.find((n: any) => n.name === `C_joy_lever_${S}`), lever = neutral.frame(`C_joy_lever_${S}`)!, ax = neutral.frame(`D_grip_axis_${S}`)!;
      const world = (p: number[]) => [0, 1, 2].map((k) => lever.origin[k] + lever.x[k] * p[0] + lever.y[k] * p[1] + lever.z[k] * p[2]);
      const local = (q: number[]) => { const d = sub(q, ax.origin), z = d[0] * ax.z[0] + d[1] * ax.z[1] + d[2] * ax.z[2]; return [z, len([d[0] - z * ax.z[0], d[1] - z * ax.z[1], d[2] - z * ax.z[2]])]; };
      const tris: number[][][] = [];
      for (const pr of gl.meshes[node.mesh].primitives) { const P = acc(pr.attributes.POSITION), I = acc(pr.indices); for (let i = 0; i < I.length; i += 3) tris.push([0, 1, 2].map((k) => world([P[I[i + k] * 3], P[I[i + k] * 3 + 1], P[I[i + k] * 3 + 2]]))); }
      let worst = 0;
      for (const [t, r] of prof) {
        let mesh = 0;
        for (const tr of tris) { const q = tr.map(local); for (let e = 0; e < 3; e++) { const A = q[e], B2 = q[(e + 1) % 3]; if ((A[0] - t) * (B2[0] - t) > 0 || A[0] === B2[0]) continue; const f = (t - A[0]) / (B2[0] - A[0]); mesh = Math.max(mesh, local(tr[e].map((v, k) => v + (tr[(e + 1) % 3][k] - v) * f))[1]); } }
        worst = Math.max(worst, Math.abs(mesh - r));
      }
      expect({ S, worst_within_1mm: worst < 0.001 }).toEqual({ S, worst_within_1mm: true });
      // the grip centre sits on the handle a hand wraps (31 to 35 mm), the slim neck (21 mm) below it, the skirt flaring under that
      const at = (t: number) => prof.reduce((b, p) => (Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b))[1];
      expect(at(0)).toBeGreaterThan(0.03); expect(at(-0.04)).toBeLessThan(0.023); expect(at(-0.075)).toBeGreaterThan(0.045);
      expect(hold![0]).toBeLessThan(0); expect(hold![1]).toBeGreaterThan(0);
      // the binding hands each grip its own side's profile
      const { b } = bind("M50");
      expect(b.targets.grip![S === "L" ? "l" : "r"].profile).toEqual(prof);
    }
  });
});
