// Shape helpers for the pods group. No dimensions live here: every size comes in as an argument.
import type { Kit, Mesh } from "../../../../generator/kit.ts";
import type { Vec2, Vec3 } from "../../../../generator/math.ts";

/** Points of a circular arc from angle a0 to a1 (radians from +x toward +y), both ends included. */
export function arc(centre: Vec2, r: number, a0: number, a1: number, segments: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= segments; i++) { const a = a0 + ((a1 - a0) * i) / segments; out.push([centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)]); }
  return out;
}

/** Superellipse ring |x/a|^n + |y/b|^n = 1, counter-clockwise from +x. n = 2 is an ellipse, larger n is boxier. */
export function superRing(a: number, b: number, n: number, count: number): Vec2[] {
  const e = 2 / n, out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    out.push([a * Math.sign(c) * Math.pow(Math.abs(c), e), b * Math.sign(s) * Math.pow(Math.abs(s), e)]);
  }
  return out;
}

/** Lathe profile of part of a pleated rubber boot on a cone, closed on the axis at both ends.
 *  The whole boot has `count` crests between z0 and z1: the first crest sits on the base at z0 with the
 *  radius rBottom, the last crest has the radius rTop and is followed by a valley at z1. This returns
 *  crests `from` .. `to - 1` (a lower or an upper part of the boot), starting in the valley below crest
 *  `from` (or on the base when from = 0) and ending in the valley above crest `to - 1`.
 *  `tail`, if given, continues the profile from that last valley to a point [radius, z] (a taut inner sleeve). */
export function pleats(rBottom: number, rTop: number, z0: number, z1: number, count: number, depth: number, from: number, to: number, tail?: Vec2): Vec2[] {
  const hp = (z1 - z0) / (count - 1 / 2), crest = (i: number) => rBottom + ((rTop - rBottom) * i) / Math.max(1, count - 1);
  const zc = (i: number) => z0 + i * hp, zStart = from === 0 ? z0 : zc(from) - hp / 2, prof: Vec2[] = [[0, zStart]];
  if (from > 0) prof.push([crest(from) - depth, zStart]);
  for (let i = from; i < to; i++) {
    const R = crest(i);
    if (i > from) prof.push([R - depth, zc(i) - hp / 2]);
    if (i > 0) prof.push([R - depth / 8, zc(i) - hp / 6]);
    prof.push([R, zc(i)], [R - depth / 8, zc(i) + hp / 6]);
  }
  const zEnd = zc(to - 1) + hp / 2;
  prof.push([crest(to - 1) - depth, zEnd]);
  if (tail) prof.push(tail, [0, tail[1]]); else prof.push([0, zEnd]);
  return prof;
}

export interface PillowOptions {
  /** Overall height, base board included. */
  height: number;
  /** Radius of the rounded upper edge. */
  edge: number;
  /** Base board: height and how far it is set in from the upholstery. */
  base: [number, number];
  /** Rise of the top surface toward the middle. */
  crown: number;
  /** Rings in the rounded upper edge. */
  steps?: number;
  /** Optional reshaping of every point (taper and the like). */
  warp?: (p: Vec3) => Vec3;
}

/** Upholstered pad on a base board: plan outline (counter-clockwise) pushed up from z = 0 with a rounded
 *  upper edge and a slightly crowned top. */
export function pillow(k: Kit, outline: Vec2[], o: PillowOptions): Mesh {
  const steps = o.steps ?? 5, [bh, bi] = o.base, top = o.height - o.crown;
  const at = (pts: Vec2[], z: number): Vec3[] => pts.map((p) => [p[0], p[1], z]);
  const board = k.offsetOutline(outline, bi);
  const rings: Vec3[][] = [at(board, 0), at(board, bh), at(outline, bh), at(outline, top - o.edge)];
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    rings.push(at(k.offsetOutline(outline, o.edge * (1 - Math.cos(a))), top - o.edge + o.edge * Math.sin(a)));
  }
  const last = rings[rings.length - 1];
  let cx = 0, cy = 0;
  for (const p of last) { cx += p[0] / last.length; cy += p[1] / last.length; }
  rings.push(last.map((p) => [cx + (p[0] - cx) / 2, cy + (p[1] - cy) / 2, o.height] as Vec3));
  const warp = o.warp;
  return k.loft(warp ? rings.map((r) => r.map(warp)) : rings);
}

/** Closed lathe profile of a low dome: radius r at the foot, height h. */
export function domeProfile(r: number, h: number, steps = 4): Vec2[] {
  const prof: Vec2[] = [[0, 0]];
  for (let i = 0; i < steps; i++) { const a = (i / steps) * (Math.PI / 2); prof.push([r * Math.cos(a), h * Math.sin(a)]); }
  prof.push([0, h]);
  return prof;
}

/** Shear a mesh sideways above a height: y moves by -slope * (z - z0) where z > z0. Normals are recomputed. */
export function leanY(k: Kit, mesh: Mesh, z0: number, slope: number, crease?: number): Mesh {
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) if (positions[i + 2] > z0) positions[i + 1] -= slope * (positions[i + 2] - z0);
  return k.recomputeNormals({ positions, normals: mesh.normals, indices: mesh.indices }, crease);
}
