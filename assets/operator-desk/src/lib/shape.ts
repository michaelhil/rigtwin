// Helpers shared by the operator desk's group files: plan outlines from proportion lists, slabs given by a side profile.
import type { Ctx } from "../../../../generator/assemble.ts";
import type { Mesh } from "../../../../generator/kit.ts";

export type P2 = [number, number];

/** A solid given by its side profile [x, z] (any winding), `width` wide across Y and centred on y = yc. */
export function profileY(c: Ctx, profile: P2[], width: number, yc = 0, bevel = 0): Mesh {
  const k = c.kit, m = k.rotate(k.extrude(profile, width, { bevel }), [1, 0, 0], Math.PI / 2);   // extrusion axis: local z -> -y
  return k.translate(m, [0, yc + width / 2, 0]);
}

/** A smooth curve through the points (centripetal Catmull-Rom), `steps` straight pieces per interval; control point i is point
 *  i * steps of the result. `before` and `after` continue the curve past its ends (default: straight on). */
export function smooth(pts: P2[], steps: number, before?: P2, after?: P2): P2[] {
  const n = pts.length, P: P2[] = [before ?? [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]], ...pts, after ?? [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]]];
  const gap = (a: P2, b: P2) => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-6), out: P2[] = [];
  for (let i = 1; i < n; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2], t1 = gap(p0, p1), t2 = t1 + gap(p1, p2), t3 = t2 + gap(p2, p3);
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps, mix = (a: P2, b: P2, ta: number, tb: number): P2 => [(a[0] * (tb - t) + b[0] * (t - ta)) / (tb - ta), (a[1] * (tb - t) + b[1] * (t - ta)) / (tb - ta)];
      const a1 = mix(p0, p1, 0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
      out.push(s === 0 ? p1 : mix(mix(a1, a2, 0, t2), mix(a2, a3, t1, t3), t1, t2));
    }
  }
  out.push(pts[n - 1]);
  return out;
}
export const steps = (c: Ctx) => Math.round(c.p("detail.curve_steps"));
/** The left half of the desktop's outline in metres, smooth, from the centre of the front edge round the end to the centre of the rear
 *  edge. Control point i of desk.outline_half is point i * steps(c). */
export function topHalf(c: Ctx): P2[] {
  const d = c.p("desk.depth_centre"), w = c.p("desk.half_width"), pts = (c.arr("desk.outline_half") as P2[]).map(([a, b]): P2 => [a * d, b * w]), n = pts.length;
  return smooth(pts, steps(c), [pts[1][0], -pts[1][1]], [pts[n - 2][0], -pts[n - 2][1]]);
}
export function seamLeft(c: Ctx): P2[] {
  const d = c.p("desk.depth_centre"), w = c.p("desk.half_width");
  return smooth((c.arr("desk.inlay_seam") as P2[]).map(([a, b]): P2 => [a * d, b * w]), steps(c));
}
/** Arc length along a line of points, at each point. */
export function lengths(line: P2[]): number[] { const s = [0]; for (let i = 1; i < line.length; i++) s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])); return s; }
/** Unit normal to the right of the direction of travel at each point of a line. */
export function rightNormals(line: P2[]): P2[] {
  return line.map((_, i) => { const a = line[Math.max(i - 1, 0)], b = line[Math.min(i + 1, line.length - 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; });
}
/** A polygon with its corners rounded to `radius`, `segments` pieces per corner (counter-clockwise in, counter-clockwise out). */
export function roundPoly(pts: P2[], radius: number, segments: number): P2[] {
  const out: P2[] = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], ua: P2 = [a[0] - p[0], a[1] - p[1]], ub: P2 = [b[0] - p[0], b[1] - p[1]], la = Math.hypot(...ua), lb = Math.hypot(...ub);
    const half = Math.acos((ua[0] * ub[0] + ua[1] * ub[1]) / (la * lb)) / 2, cut = Math.min(radius / Math.tan(half), la / 2, lb / 2), r = cut * Math.tan(half);
    const p1: P2 = [p[0] + (ua[0] / la) * cut, p[1] + (ua[1] / la) * cut], p2: P2 = [p[0] + (ub[0] / lb) * cut, p[1] + (ub[1] / lb) * cut];
    const bis: P2 = [ua[0] / la + ub[0] / lb, ua[1] / la + ub[1] / lb], lbis = Math.hypot(...bis), centre: P2 = [p[0] + (bis[0] / lbis) * (r / Math.sin(half)), p[1] + (bis[1] / lbis) * (r / Math.sin(half))];
    const a1 = Math.atan2(p1[1] - centre[1], p1[0] - centre[0]); let sweep = Math.atan2(p2[1] - centre[1], p2[0] - centre[0]) - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
    for (let s = 0; s <= segments; s++) out.push([centre[0] + r * Math.cos(a1 + (sweep * s) / segments), centre[1] + r * Math.sin(a1 + (sweep * s) / segments)]);
  }
  return out;
}
export const mirror = (pts: P2[]): P2[] => pts.map(([x, y]) => [x, -y]);
/** Index of the outline point that a seam end sits on. */
export function indexOf(outline: P2[], p: P2): number {
  const i = outline.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9);
  if (i < 0) throw new Error("desk.inlay_seam must start and end on points of desk.outline_half");
  return i;
}
/** Closed polygon of a band `thickness` wide along an open line of points, on the side the next point lies to the left of (sign +1) or right of (-1). */
export function strip(line: P2[], thickness: number, side: number): P2[] {
  const inner: P2[] = line.map((p, i) => {
    const a = line[Math.max(i - 1, 0)], b = line[Math.min(i + 1, line.length - 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty);
    return [p[0] - (side * ty * thickness) / l, p[1] + (side * tx * thickness) / l];
  });
  return [...line, ...inner.reverse()];
}

/** Side profile of the rear wall in its own frame (x = 0 at the front edge of the lower part, +x to the rear, z from the floor). */
export function wallShape(c: Ctx) {
  const lean = c.p("wall.upper_lean"), zTop = c.p("wall.height"), rail = c.p("wall.profile"), blue = c.p("wall.blue_length"), grey = c.p("wall.grey_height");
  const zKink = zTop - (rail + blue) * Math.cos(lean), depth = c.p("wall.frame_depth"), panel = c.p("wall.panel_thickness");
  /** forward shift of the leaning upper part at height z */
  const shift = (z: number) => (z > zKink ? -(z - zKink) * Math.tan(lean) : 0);
  const zGreyTop = zKink - rail, zGreyBottom = zGreyTop - grey, zBaseTop = zGreyBottom - rail, zBlueTop = zTop - rail * Math.cos(lean);
  return { lean, zTop, zKink, zGreyTop, zGreyBottom, zBaseTop, zBlueTop, depth, panel, rail, shift,
    /** rear face of the fabric panels at height z, and their front face */
    rear: (z: number) => depth + shift(z), front: (z: number) => depth - panel + shift(z),
    fabric: c.p("wall.fabric_width"), board: (c.p("wall.width") - c.p("wall.fabric_width")) / 2 };
}
/** A slab of the wall between two heights, from `x0` to `x1` in front of the rear face (0 = rear face), across `width`. */
export function wallSlab(c: Ctx, zA: number, zB: number, x0: number, x1: number, width: number, yc = 0): Mesh {
  const w = wallShape(c), cuts = [zA, ...(zA < w.zKink && zB > w.zKink ? [w.zKink] : []), zB];
  const profile: P2[] = [...cuts.map((z): P2 => [w.rear(z) - x1, z]), ...cuts.slice().reverse().map((z): P2 => [w.rear(z) - x0, z])];
  return profileY(c, profile, width, yc);
}
