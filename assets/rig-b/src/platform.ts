// Platform group: white rim slab with a rounded upper edge, deck panels with chamfered edges lying in a
// pocket on a dark base (the joints between them are real grooves), recessed dark plinth, four flush pull handles.
import type { Ctx, GroupModule } from "../../../generator/assemble.ts";
import type { Mesh } from "../../../generator/kit.ts";
import type { Vec2, Vec3 } from "../../../generator/math.ts";

const at = (o: Vec2[], z: number): Vec3[] => o.map((p) => [p[0], p[1], z]);

export const components: GroupModule["components"] = {
  // Origin: centre of the deck top. Deck edges at x = ±length / 2, y = ±width / 2; the rim lies outside them.
  C_platform: (c: Ctx) => {
    const k = c.kit;
    const L = c.p("platform.deck_length_x"), W = c.p("platform.deck_width_y"), rw = c.p("platform.rim_width"), rd = c.p("platform.deck_corner_radius");
    const H = c.p("platform.deck_height"), band = c.p("platform.white_band_height"), er = Math.min(c.p("platform.rim_edge_radius"), rw), b = c.p("platform.edge_bevel");
    const gap = c.p("platform.deck_gap"), pocket = c.p("platform.deck_pocket"), chamfer = c.p("platform.deck_panel_chamfer");
    const outer = k.roundedRectOutline(L + 2 * rw, W + 2 * rw, rd + rw, 10), inner = k.offsetOutline(outer, rw);

    // rim slab: chamfered lower edge, quarter-round upper outer edge, flat top, pocket for the deck
    const rings: Vec3[][] = [at(k.offsetOutline(outer, b), -band), at(outer, -band + b)];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2);
      rings.push(at(k.offsetOutline(outer, er * (1 - Math.cos(a))), -er * (1 - Math.sin(a))));
    }
    rings.push(at(inner, 0), at(inner, -pocket));
    const rim = k.loft(rings);

    // dark base in the pocket; it shows in the joints between the panels
    const base = k.translate(k.extrude(inner, pocket / 2), [0, 0, -pocket]);
    const plinth = k.translate(k.extrude(k.offsetOutline(outer, c.p("platform.plinth_inset")), H - band, { bevel: b }), [0, 0, -H]);

    // deck panels: outlines for the centre strip and the left half (mirrored to the right); a vertex on a
    // deck corner is rounded with the deck corner radius; each panel is drawn in by half the joint width
    const corner = (p: Vec2, prev: Vec2, next: Vec2): Vec2[] => {
      if (Math.abs(Math.abs(p[0]) - L / 2) > gap || Math.abs(Math.abs(p[1]) - W / 2) > gap) return [p];
      const dir = (q: Vec2): Vec2 => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); return [(q[0] - p[0]) / d, (q[1] - p[1]) / d]; };
      const u = dir(prev), v = dir(next), n = 4, pts: Vec2[] = [];
      for (let i = 0; i <= n; i++) {            // quarter circle from the tangent point on the incoming edge to the one on the outgoing edge
        const a = (i / n) * (Math.PI / 2), cu = 1 - Math.sin(a), cv = 1 - Math.cos(a);
        pts.push([p[0] + rd * (u[0] * cu + v[0] * cv), p[1] + rd * (u[1] * cu + v[1] * cv)]);
      }
      return pts;
    };
    const panel = (poly: Vec2[]): Mesh => {
      const ccw = k.outlineArea(poly) >= 0 ? poly : poly.slice().reverse();
      const o = ccw.flatMap((p, i) => corner(p, ccw[(i + ccw.length - 1) % ccw.length], ccw[(i + 1) % ccw.length]));
      return k.translate(k.extrude(k.offsetOutline(o, gap / 2), pocket / 2, { bevelTop: chamfer }), [0, 0, -pocket / 2]);
    };
    const clamp = (p: number[]): Vec2 => [Math.max(-L / 2, Math.min(L / 2, p[0])), Math.max(-W / 2, Math.min(W / 2, p[1]))];
    const panels: Mesh[] = [];
    for (const poly of c.arr("platform.deck_panels_centre") as number[][][]) panels.push(panel(poly.map(clamp)));
    for (const poly of c.arr("platform.deck_panels_side") as number[][][]) for (const m of [1, -1]) panels.push(panel(poly.map((p) => clamp([p[0], p[1] * m]))));
    return [k.part("shell_white", rim), k.part("deck_dark", panels), k.part("plastic_black", plinth, base)];
  },
};

// Flush pull handle: raised frame round a dark pocket with a pull paddle. Long side along X.
// Frame: on the deck at the handle centre.
const fitting = (c: Ctx) => {
  const k = c.kit, [sx, sy] = c.arr("platform.fitting_size"), [lip, h, floor] = c.arr("platform.fitting_lip");
  const [pl, pw, ph, po] = c.arr("platform.fitting_paddle");
  const o = k.roundedRectOutline(sx, sy, 2 * lip, 2), off = (d: number, z: number) => at(k.offsetOutline(o, d), z);   // twelve-sided frame
  const frame = k.loft([off(0, 0), off(h / 2, h), off(lip - h / 2, h), off(lip, floor)]);
  const paddle = k.translate(k.box(pl, pw, ph, { bevel: ph / 3 }), [po, 0, floor]);
  return k.part("plastic_black", frame, paddle);
};
for (const n of [1, 2, 3, 4]) components[`C_platform_fitting_${n}`] = fitting;
