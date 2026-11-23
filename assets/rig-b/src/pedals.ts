// Pedals group: sliding tray, wedge-shaped heel plate, frame with two cross-rails and hinge brackets,
// three hinged pedal arms with studded pads.
import type { Ctx, GroupModule } from "../../../generator/assemble.ts";
import type { Mesh } from "../../../generator/kit.ts";
import type { Vec2 } from "../../../generator/math.ts";
import { plateYZ, slabXZ } from "./lib/stand-shapes.ts";

// Hinge axis in the pedal-set frame (x from the heel lip, height above the deck); the spec's joint frames use the same expressions.
const hinge = (c: Ctx): [number, number] => {
  const [ex, ez] = c.arr("pedals.pad_top_edge"), a = c.p("pedals.arm_angle"), reach = c.p("pedals.arm_reach"), off = c.p("pedals.pad_face_offset");
  return [ex - c.p("pedals.heel_lip_x") - reach * Math.sin(a) + off * Math.cos(a), ez - reach * Math.cos(a) - off * Math.sin(a)];
};

// Frame: hinge axis, Z along the arm toward the pad; the pad faces the operator (-X).
const pedal = (c: Ctx) => {
  const k = c.kit, [w0, w1, t] = c.arr("pedals.arm_plate"), reach = c.p("pedals.arm_reach"), [pw, ph] = c.arr("pedals.pad_size");
  const off = c.p("pedals.pad_face_offset"), b = c.p("pedals.bevel"), [sr, sh] = c.arr("pedals.pad_stud");
  const zc = reach - ph / 2;
  const blade: Vec2[] = [[-w0 / 2, -w0 / 4], [w0 / 2, -w0 / 4], [w0 / 2, w0 / 4], [w1 / 2, reach - ph], [w1 / 2, reach - ph / 4], [-w1 / 2, reach - ph / 4], [-w1 / 2, reach - ph], [-w0 / 2, w0 / 4]];
  const arm = k.translate(plateYZ(k, blade, t, b / 2), [-t, 0, 0]);
  const barrel = k.tubePath([[-t / 2, -w0 / 2, 0], [-t / 2, w0 / 2, 0]], t, { segments: 8 });
  const pad = k.translate(plateYZ(k, k.roundedRectOutline(pw, ph, c.p("pedals.pad_corner_radius"), 4), off - t, b), [-off, 0, zc]);
  const stud = k.rotate(k.cylinder(sr, sh, { segments: 6, radiusTop: sr - sh }), [0, 1, 0], -Math.PI / 2);   // low six-sided frustum
  const studs = (c.arr("pedals.pad_studs") as Vec2[]).map(([u, v]) => k.translate(stud, [-off, (u * pw) / 2, zc + (v * ph) / 2]));
  return [k.part("metal_dark", arm, barrel), k.part("rubber_black", pad, studs)];
};

export const components: GroupModule["components"] = {
  // Frame: on the deck at the operator-side lip of the heel plate, centred on the unit.
  C_pedal_base: (c) => {
    const k = c.kit, w = c.p("pedals.heel_width"), L = c.p("pedals.heel_far_edge_x") - c.p("pedals.heel_lip_x"), b = c.p("pedals.bevel");
    const [tx0, tx1, tw, tt, tf] = c.arr("pedals.tray"), depth = c.p("pedalset.depth"), fw = c.p("pedalset.width"), pitch = c.p("pedalset.pitch");
    const [rt, lo, hi] = c.arr("pedals.frame_rail"), rails = c.arr("pedals.cross_rails") as Vec2[], rr = c.p("pedals.cross_rail_radius");
    const [bl, bw, ct] = c.arr("pedals.bracket"), [hx, hz] = hinge(c);
    const parts: Mesh[] = [];
    // sliding tray with upturned side flanges
    parts.push(k.translate(k.box(tx1 - tx0, tw, tt, { bevel: tt / 4 }), [(tx0 + tx1) / 2, 0, 0]));
    for (const s of [1, -1]) parts.push(k.translate(k.box(tx1 - tx0, tt, tf, { bevel: tt / 4 }), [(tx0 + tx1) / 2, (s * (tw - tt)) / 2, 0]));
    // heel plate: low wedge with a steeper nose
    parts.push(slabXZ(k, (c.arr("pedals.heel_profile") as Vec2[]).map(([u, z]) => [u * L, z + tt] as Vec2), w, b));
    // frame behind the heel plate: floor, side plates that rise to carry the cross-rails, rear beam
    parts.push(k.translate(k.box(depth - L, fw, tt, { bevel: tt / 4 }), [(L + depth) / 2, 0, tt]));
    const side: Vec2[] = [[L, tt], [depth, tt], [depth, tt + lo], [rails[1][0] + 4 * rr, tt + lo], [rails[1][0] + 2 * rr, hi], [rails[0][0] - 2 * rr, hi], [rails[0][0] - 4 * rr, tt + lo], [L, tt + lo]];
    for (const s of [1, -1]) parts.push(k.translate(slabXZ(k, side, rt, b / 2), [0, (s * (fw - rt)) / 2, 0]));
    for (const [x, z] of rails) parts.push(k.tubePath([[x, -fw / 2 + rt, z], [x, fw / 2 - rt, z]], rr, { segments: 10 }));
    parts.push(k.translate(k.box(2 * rt, fw - rt, lo, { bevel: b / 2 }), [depth - rt, 0, tt]));
    // hinge brackets: two cheeks per pedal
    for (const y of [pitch, 0, -pitch]) for (const s of [1, -1])
      parts.push(k.translate(k.box(bl, ct, hz + bl / 2 - tt, { bevel: b / 2 }), [hx, y + (s * (bw - ct)) / 2, tt]));
    return k.part("plastic_black", parts);
  },
  C_pedal_arm_1: pedal,
  C_pedal_arm_2: pedal,
  C_pedal_arm_3: pedal,
};
