// Operator desk, group "desk": desktop, shelf, legs, lifting columns, end screens, panel and block under the top.
// Every number comes from params/*.toml.
import type { Ctx, GroupModule } from "../../../generator/assemble.ts";
import type { Part, Mesh } from "../../../generator/kit.ts";
import { type P2, topHalf, seamLeft, mirror, strip, steps, smooth, lengths, rightNormals, profileY } from "./lib/shape.ts";

const sided = (c: Ctx, parts: Part[]): Part[] => (c.side === "R" ? c.kit.mapParts(parts, c.kit.mirrorY) : parts);
type V3 = [number, number, number];

/** Height of the fixed leg: it ends under the shelf. */
const legHeight = (c: Ctx) => c.p("desk.height") - c.p("desk.shelf_drop") - c.p("desk.shelf_thickness") - c.p("leg.top_gap");

/** Fixed leg: a pale blade between a bowed dark front edge and a bowed dark rear edge. Node origin: front edge on the floor,
 *  centre of its thickness; +x to the rear. */
function leg(c: Ctx): Part[] {
  const k = c.kit, d = c.p("leg.depth"), t = c.p("leg.thickness"), band = c.p("leg.band_depth"), b = c.p("detail.bevel"), h = legHeight(c), n = Math.max(steps(c) - 1, 1);
  const curve = (key: string, x0: number) => smooth((c.arr(key) as P2[]).map(([u, s]): P2 => [x0 + s * d, u * h]), n);
  const front = curve("leg.front_curve", 0), rear = curve("leg.rear_curve", d), shift = (line: P2[], dx: number) => line.map(([x, z]): P2 => [x + dx, z]);
  const edge = (a: P2[], bb: P2[]) => profileY(c, [...a, ...bb.slice().reverse()], t, 0, 2 * b);
  const blade = profileY(c, [...shift(front, band - b), ...shift(rear, -band + b).reverse()], t - 4 * b, 0);
  return [k.part("edge_anthracite", edge(front, shift(front, band)), edge(shift(rear, -band), rear)), k.part("laminate_grey", blade)];
}
/** Assumed lifting column: inside the leg at the photographed height, fixed to the underside of the shelf. */
function column(c: Ctx): Part {
  const k = c.kit, [cx, cd, ct] = c.arr("leg.column") as number[], top = legHeight(c) + c.p("leg.top_gap"), low = c.p("leg.top_gap");
  return k.part("metal_dark", k.translate(k.box(cd, ct, top - low, { bevel: c.p("detail.bevel") }), [cx - c.p("leg.front_x"), 0, low]));
}
/** End screen: one upholstered panel that follows the end of the top from the wing's front corner round the rear corner of the
 *  ear; both lower corners are quarter circles. Hangs from the node (z = 0) down; fabric outside, felt inside. */
function wing(c: Ctx): Part[] {
  const k = c.kit, n = steps(c), [from, to] = c.arr("wing.outline_span") as number[], line = topHalf(c).slice(from * n, to * n + 1), s = lengths(line), nr = rightNormals(line);
  const t = c.p("wing.thickness"), lining = c.p("wing.lining"), inset = c.p("wing.inset"), soft = c.p("detail.bevel_soft"), R = c.p("wing.corner_radius");
  const H = c.p("desk.height") - c.p("wing.top_gap") - c.p("wing.clearance"), total = s[s.length - 1];
  const bottom = (i: number) => { const e = Math.min(s[i], total - s[i]); return -H + (e < R ? R - Math.sqrt(R * R - (R - e) * (R - e)) : 0); };
  const at = (i: number, r: number, z: number): V3 => [line[i][0] + nr[i][0] * r, line[i][1] + nr[i][1] * r, z];
  /** a band from depth r0 to r1 behind the outline, with softened long edges on its outer side when `soft` is given */
  const shell = (r0: number, r1: number, ch: number, top: number, lift: number): Mesh => k.loft(line.map((_, i) => {
    const zb = bottom(i) + lift, zt = top;
    return ch > 0 ? [at(i, r0, zb + ch), at(i, r0, zt - ch), at(i, r0 + ch, zt), at(i, r1, zt), at(i, r1, zb), at(i, r0 + ch, zb)] : [at(i, r0, zb), at(i, r0, zt), at(i, r1, zt), at(i, r1, zb)];
  }), { capStart: true, capEnd: true, crease: c.p("detail.smooth_crease") });
  return sided(c, [k.part("fabric_navy", shell(inset, inset + t - lining, soft, 0, 0)), k.part("felt_slate", shell(inset + t - lining, inset + t, 0, -soft, soft))]);
}

export const components: GroupModule["components"] = {
  // Node origin: centre of the front edge, on the surface. Wood centre: full thickness, rounded edge. Wings: a dark body whose
  // soft top bevel is the dark rim, under a grey surface layer.
  C_desk_top: (c) => {
    const k = c.kit, n = steps(c), half = topHalf(c), seam = seamLeft(c), [g0, g1] = c.arr("desk.grey_span") as number[], i0 = g0 * n, i1 = g1 * n;
    if (Math.hypot(half[i0][0] - seam[0][0], half[i0][1] - seam[0][1]) > 1e-6 || Math.hypot(half[i1][0] - seam[seam.length - 1][0], half[i1][1] - seam[seam.length - 1][1]) > 1e-6) throw new Error("desk.inlay_seam must start and end on the points of desk.outline_half named by desk.grey_span");
    const t = c.p("desk.top_thickness"), layer = c.p("desk.surface_layer"), inset = c.p("desk.surface_inset"), b = c.p("detail.bevel"), soft = c.p("detail.bevel_soft");
    const mid = seam.slice(1, -1), inlayL: P2[] = [...half.slice(0, i0 + 1), ...mid, ...half.slice(i1)];
    const inlay: P2[] = [...inlayL, ...mirror(inlayL).reverse().slice(1, -1)];
    const wingL: P2[] = [...half.slice(i0, i1 + 1), ...mid.slice().reverse()];
    // the grey layer ends at the inner end of the body's top bevel along the outer edge; along the seam it meets the wood
    const full: P2[] = [...half, ...mirror(half).reverse().slice(1, -1)], fullIn = k.offsetOutline(full, inset) as P2[];
    const layerL: P2[] = [...fullIn.slice(i0, i1 + 1), ...mid.slice().reverse()];
    const body = k.translate(k.extrude(wingL, t - layer, { bevelTop: inset, bevelBottom: b }), [0, 0, -t]), top = k.translate(k.extrude(layerL, layer), [0, 0, -layer]);
    const [gx, gy] = c.arr("desk.grommet_xy") as number[], g = k.translate(k.cylinder(c.p("desk.grommet_diameter") / 2, layer, { segments: 20 }), [gx, gy, 0]);
    return [k.part("wood_light", k.translate(k.extrude(inlay, t, { bevelTop: soft, bevelBottom: b }), [0, 0, -t])),
      k.part("edge_anthracite", body, k.mirrorY(body), g, k.mirrorY(g)), k.part("laminate_grey", top, k.mirrorY(top))];
  },
  // Node origin: under the front-edge centre, on the shelf's top surface.
  C_desk_shelf: (c) => {
    const k = c.kit, n = steps(c), half = topHalf(c), [from, to] = c.arr("desk.shelf_span") as number[], front = half.slice(from * n, to * n + 1).filter((_, i) => i % n === 0);   // the control points are enough under the top
    const rx = c.p("desk.shelf_rear_x"), rw = c.p("desk.shelf_rear_half_width"), t = c.p("desk.shelf_thickness");
    // the front line is pushed under the top so that no slot opens between top and shelf
    const under = strip(front, c.p("desk.shelf_underlap"), 1).slice(front.length).reverse() as P2[];
    const left: P2[] = [...under, [rx, 0], [rx, rw]], poly: P2[] = [...left, ...mirror(left).reverse().slice(1)];
    return k.part("shelf_slate", k.translate(k.extrude(poly, t, { bevelTop: c.p("detail.bevel_soft"), bevelBottom: c.p("detail.bevel") }), [0, 0, -t]));
  },
  // Node origin: front face of the panel, centre, at the underside of the shelf. The panel hangs down; the tray sits behind it.
  C_desk_tray: (c) => {
    const k = c.kit, [pt, pw] = c.arr("panel.size") as number[], [td, th] = c.arr("panel.tray") as number[], b = c.p("detail.bevel");
    const h = c.p("desk.height") - c.p("desk.shelf_drop") - c.p("desk.shelf_thickness") - c.p("panel.bottom_z");
    return k.part("panel_dark", k.translate(k.box(pt, pw, h, { bevel: b }), [pt / 2, 0, -h]), k.translate(k.box(td, pw - 2 * pt, th, { bevel: b }), [pt + td / 2, 0, -th]));
  },
  C_desk_handset: (c) => {
    const k = c.kit, [d, w, h] = c.arr("handset.size") as number[];
    return k.part("wood_light", k.translate(k.roundedBox(d, w, h, c.p("detail.bevel_soft"), { bevel: c.p("detail.bevel"), segments: 3 }), [0, 0, -h]));
  },
  C_leg_L: leg, C_leg_R: leg,
  C_leg_column_L: column, C_leg_column_R: column,
  C_wing_L: wing, C_wing_R: wing,
};
