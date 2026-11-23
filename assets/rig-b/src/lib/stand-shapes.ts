// Shape helpers shared by the platform, stand and pedals groups (operations the kit does not have).
import type { Kit, Mesh } from "../../../../generator/kit.ts";
import type { Vec2, Vec3 } from "../../../../generator/math.ts";

/** Rounded rectangle with one plan radius (and segment count) per corner, listed (+x, -y), (+x, +y),
 *  (-x, +y), (-x, -y). Counter-clockwise, centred. A radius of 0 gives a sharp corner. */
export function cornerRect(sx: number, sy: number, radii: number[], segments: number[]): Vec2[] {
  const o: Vec2[] = [], sign: Vec2[] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  sign.forEach(([qx, qy], i) => {
    const r = Math.min(radii[i], sx / 2, sy / 2), n = r > 0 ? segments[i] : 0, a0 = (i - 1) * (Math.PI / 2);
    const cx = qx * (sx / 2 - r), cy = qy * (sy / 2 - r);
    for (let s = 0; s <= n; s++) { const a = a0 + (n ? s / n : 0) * (Math.PI / 2); o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  });
  return o;
}

/** Outline drawn in the X–Z plane (first coordinate along X, second up), extruded along Y and centred on y = 0. */
export function slabXZ(k: Kit, outline: Vec2[], width: number, bevel = 0): Mesh {
  // kit.extrude pushes an XY outline up Z; a quarter turn about X maps (x, y, z) to (x, -z, y)
  return k.translate(k.rotate(k.extrude(outline, width, { bevel }), [1, 0, 0], Math.PI / 2), [0, width / 2, 0]);
}

/** Outline drawn in the Y–Z plane (first coordinate along Y, second up), extruded along +X from x = 0. */
export function plateYZ(k: Kit, outline: Vec2[], thickness: number, bevel = 0): Mesh {
  // two quarter turns map (a, b, h) to (h, a, b)
  return k.rotate(k.rotate(k.extrude(outline, thickness, { bevel }), [1, 0, 0], Math.PI / 2), [0, 0, 1], Math.PI / 2);
}

/** Bar with fully rounded ends between two points: stadium in plan, flat top and bottom (arm links). */
export function linkBar(k: Kit, a: Vec3, b: Vec3, width: number, height: number, bevel = 0, segments = 6): Mesh {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], flat = Math.hypot(d[0], d[1]), length = Math.hypot(flat, d[2]);
  const bar = k.translate(k.roundedBox(length + width, width, height, width / 2, { bevel, segments }), [0, 0, -height / 2]);
  return k.place(bar, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [0, -Math.atan2(d[2], flat), Math.atan2(d[1], d[0])]);
}

/** Cylinder between two points (any direction), with chamfered rims. */
export function rod(k: Kit, a: Vec3, b: Vec3, radius: number, opts: { segments?: number; bevel?: number } = {}): Mesh {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(d[0], d[1], d[2]);
  let m = k.cylinder(radius, length, { segments: opts.segments ?? 16, bevel: opts.bevel ?? 0 });
  const flat = Math.hypot(d[0], d[1]);
  if (flat > length * 1e-6) m = k.rotate(m, [-d[1] / flat, d[0] / flat, 0], Math.acos(d[2] / length));
  else if (d[2] < 0) m = k.rotate(m, [1, 0, 0], Math.PI);
  return k.translate(m, a);
}

/** Slab from an outline with quarter-round top and bottom edges of the given radius (steps ≥ 1 strips per edge), z = 0 … thickness. */
export function roundedSlab(k: Kit, outline: Vec2[], thickness: number, radius: number, steps = 2): Mesh {
  const r = Math.min(radius, thickness / 2), rings: Vec3[][] = [];
  const at = (d: number, z: number) => k.offsetOutline(outline, d).map((p) => [p[0], p[1], z] as Vec3);
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * (Math.PI / 2); rings.push(at(r * (1 - Math.sin(a)), r * (1 - Math.cos(a)))); }
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * (Math.PI / 2); rings.push(at(r * (1 - Math.cos(a)), thickness - r * (1 - Math.sin(a)))); }
  return k.loft(rings);
}
