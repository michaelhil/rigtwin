// Operator desk, group "canopy". Canopy frame: on the centre line at the top front edge of the wall's side boards, z = 0 at the
// canopy's top; the canopy runs toward -x (over the desk). Underside parts hang from their node (z = 0, the felt) down.
import type { GroupModule } from "../../../generator/assemble.ts";
import { type P2, roundPoly } from "./lib/shape.ts";

export const components: GroupModule["components"] = {
  // Edge, top to bottom: aluminium cap, green light line, wood band. The underside is dark felt, recessed inside the band.
  C_canopy_body: (c) => {
    const k = c.kit, depth = c.p("canopy.depth"), width = c.p("wall.width"), band = c.p("canopy.band_height"), cap = c.p("canopy.cap_height"), glow = c.p("canopy.glow_height");
    const recess = c.p("canopy.felt_recess"), bt = c.p("canopy.band_thickness"), b = c.p("detail.bevel"), lean = c.p("wall.upper_lean");
    // the slab over the desk, and a neck between the side boards back to the wall's felt face
    const back = band * Math.tan(lean), neck = c.p("wall.frame_depth") - c.p("wall.panel_thickness") + back / 2, fabric = c.p("wall.fabric_width");
    const layer = (z0: number, z1: number, grow: number, bevel: number) => [
      k.translate(k.box(depth + back + 2 * grow, width + 2 * grow, z1 - z0, { bevel }), [(back - depth) / 2, 0, z0]),
      k.translate(k.box(neck - back, fabric, z1 - z0), [(neck + back) / 2, 0, z0])];
    const zb = -band, zw = -cap - glow, strip = (sx: number, sy: number, x: number, y: number) => k.translate(k.box(sx, sy, zw - zb, { bevel: b }), [x, y, zb]);
    const wood = [strip(bt, width, -depth + bt / 2, 0), strip(depth + back - bt, bt, (back - depth + bt) / 2, width / 2 - bt / 2), strip(depth + back - bt, bt, (back - depth + bt) / 2, -width / 2 + bt / 2)];
    const felt = k.translate(k.box(depth - bt + neck, fabric, zw - zb - recess), [(neck - depth + bt) / 2, 0, zb + recess]);
    // the top is dark inside the aluminium strip (IMG_1796, IMG_1808); one thin plate, nothing more
    const roof = k.translate(k.box(depth - 2 * bt, width - 2 * bt, b), [-depth / 2, 0, 0]);
    return [k.part("aluminium", layer(-cap, 0, 0, b)), k.part("light_green", layer(zw, -cap, b, 0)), k.part("wood_light", wood), k.part("felt_canopy", felt), k.part("panel_dark", roof)];
  },
  C_canopy_light: (c) => {
    const k = c.kit, [d, l, h] = c.arr("canopy.light_size") as number[];
    // the strip also lights the desk in the viewer: a lit rectangle on its lower face, shining down
    return [k.part("light_white", k.translate(k.box(d, l, h, { bevel: c.p("detail.bevel") }), [0, 0, -h])),
      k.lamp({ kind: "strip", at: [0, 0, -h], dir: [0, 0, -1], length: l, width: d, colour: k.cctColour(c.p("canopy.lamp_cct")), intensity: c.p("canopy.light_intensity") })];
  },
  // Node at the canopy's front edge, on the felt. Each spotlight: a dark rounded-triangle body, a lit ring round its lower face, a
  // round lamp in the middle; one point of the triangle toward the front centre.
  C_canopy_spots: (c) => {
    const k = c.kit, [len, wid, h] = c.arr("canopy.spot_size") as number[], [sx, sy] = c.arr("canopy.spot_xy") as number[], rim = c.p("canopy.spot_rim"), b = c.p("detail.bevel");
    const tri = roundPoly([[-len / 2, 0], [len / 2, -wid / 2], [len / 2, wid / 2]] as P2[], c.p("canopy.spot_corner"), Math.round(c.arr("canopy.spot_segments")[0])), inner = k.offsetOutline(tri, rim), turn = Math.atan2(sy, sx) / 2;
    const dark = [], lit = [];
    for (const side of [1, -1]) {
      const place = (m: ReturnType<typeof k.extrude>) => k.translate(k.rotate(m, [0, 0, 1], side * turn), [sx, side * sy, 0]);
      dark.push(place(k.translate(k.extrude(tri, h - b, { bevelBottom: b }), [0, 0, -h + b])), place(k.translate(k.extrude(inner, b), [0, 0, -h - b / 2])));
      lit.push(place(k.translate(k.extrude(tri, b), [0, 0, -h])), place(k.translate(k.cylinder(c.p("canopy.spot_lens"), b, { segments: Math.round(c.arr("canopy.spot_segments")[1]) }), [0, 0, -h - b])));
    }
    // each spotlight also shines straight down in the viewer, from the face of its lamp
    const lamps = [1, -1].map((side) => k.lamp({ kind: "spot", at: [sx, side * sy, -h - b], dir: [0, 0, -1], angle: c.p("canopy.spot_beam") / 2, penumbra: 0.5,
      colour: k.cctColour(c.p("canopy.lamp_cct")), intensity: c.p("canopy.spot_intensity") }));
    return [k.part("plastic_black", dark), k.part("light_white", lit), ...lamps];
  },
  // a square plate with a round raised grille; vanes are not modelled
  C_canopy_fan: (c) => {
    const k = c.kit, [d, w, h] = c.arr("canopy.fan_size") as number[], [r, proud] = c.arr("canopy.fan_grille") as number[];
    return k.part("plastic_black", k.translate(k.box(d, w, h, { bevel: c.p("detail.bevel") }), [0, 0, -h]), k.translate(k.cylinder(r, proud, { segments: 24, bevel: proud / 2 }), [0, 0, -h - proud]));
  },
  C_canopy_bar: (c) => {
    const k = c.kit, [d, l, h] = c.arr("canopy.bar_size") as number[];
    return k.part("panel_dark", k.translate(k.roundedBox(d, l, h, d / 4, { bevel: c.p("detail.bevel"), segments: 3 }), [0, 0, -h]));
  },
};
