// Operator desk, group "wall": the thin kinked rear wall and its open equipment base. BLOCKOUT. Wall frame: x = 0 at the front
// edge of the lower (vertical) part of the side boards, +x to the rear, z from the floor.
import type { GroupModule } from "../../../generator/assemble.ts";
import { type P2, profileY, wallShape, wallSlab } from "./lib/shape.ts";

export const components: GroupModule["components"] = {
  C_wall_frame: (c) => {
    const k = c.kit, w = wallShape(c), xt = w.shift(w.zTop);
    const board: P2[] = [[0, 0], [0, w.zKink], [xt, w.zTop], [xt + w.depth, w.zTop], [w.depth, w.zKink], [w.depth, 0]];
    const y = w.fabric / 2 + w.board / 2, boards = [y, -y].map((yc) => profileY(c, board, w.board, yc, c.p("detail.bevel")));
    // aluminium rails across the fabric width: above the upper field, between the fields, under the lower field
    const rails = [[w.zBlueTop, w.zTop], [w.zGreyTop, w.zKink], [w.zBaseTop, w.zGreyBottom]].map(([a, b]) => wallSlab(c, a, b, -c.p("detail.bevel"), w.panel, w.fabric));
    return [k.part("wood_light", boards), k.part("aluminium", rails)];
  },
  // Fabric toward the rear: two panels side by side with a joint on the centre line. Dark felt toward the operator, in one piece.
  C_wall_upper: (c) => {
    const k = c.kit, w = wallShape(c), seam = c.p("wall.seam"), pw = (w.fabric - seam) / 2;
    return [k.part("fabric_blue", [1, -1].map((s) => wallSlab(c, w.zKink, w.zBlueTop, 0, w.panel / 2, pw, (s * (pw + seam)) / 2))), k.part("felt_charcoal", wallSlab(c, w.zKink, w.zBlueTop, w.panel / 2, w.panel, w.fabric))];
  },
  C_wall_lower: (c) => {
    const k = c.kit, w = wallShape(c), seam = c.p("wall.seam"), pw = (w.fabric - seam) / 2;
    return [k.part("felt_grey", [1, -1].map((s) => wallSlab(c, w.zGreyBottom, w.zGreyTop, 0, w.panel / 2, pw, (s * (pw + seam)) / 2))), k.part("felt_charcoal", wallSlab(c, w.zGreyBottom, w.zGreyTop, w.panel / 2, w.panel, w.fabric))];
  },
  // The open lower part of the wall: a floor plate and a dark front panel (toward the operator) between the side boards, a post
  // between the two bays. Open to the rear. It stands a little in front of the boards (wall.base_depth from the rear face).
  C_wall_base: (c) => {
    const k = c.kit, w = wallShape(c), d = c.p("wall.base_depth"), t = c.p("wall.base_wall"), b = c.p("detail.bevel"), x0 = w.depth - d, xm = w.depth - d / 2;
    const floor = k.translate(k.box(d, w.fabric, t, { bevel: b }), [xm, 0, 0]), front = k.translate(k.box(t, w.fabric, w.zBaseTop - t), [x0 + t / 2, 0, t]);
    const post = k.translate(k.box(2 * t, 2 * t, w.zBaseTop - t, { bevel: b }), [w.depth - t, 0, t]);
    return [k.part("base_grey", floor, front), k.part("aluminium", post)];
  },
  C_wall_equipment: (c) => {
    const k = c.kit, w = wallShape(c), t = c.p("wall.base_wall");
    return k.part("metal_dark", (c.arr("wall.equipment") as number[][]).map(([d, wd, h, y]) => k.translate(k.box(d, wd, h, { bevel: c.p("detail.bevel") }), [w.depth - c.p("wall.base_depth") + t + c.p("detail.bevel") + d / 2, y, t])));   // just behind the front panel
  },
  // on the operator side of the panels, on the centre line, from the shelf up to the canopy's underside
  C_wall_rail: (c) => {
    const k = c.kit, w = wallShape(c), [rd, rw] = c.arr("wall.rail_size") as number[];
    const z0 = w.zBaseTop, z1 = w.zTop - c.p("canopy.band_height") + c.p("canopy.felt_recess");
    return k.part("plastic_black", wallSlab(c, z0, z1, w.panel, w.panel + rd, rw));
  },
};
