// Helpers for the seat group: a small builder for faceted cages (named corner points, faces as
// loops of names), row interpolation for station tables, and a 2D inward offset for outlines.
import type { Vec3 } from "../../../../generator/math.ts";
import type { Mesh } from "../../../../generator/kit.ts";

export interface Face { loop: string[]; material?: string }

/** Collects named points and faces for kit.cage / kit.cageParts. */
export class CageBuilder {
  points: Record<string, Vec3> = {};
  faces: Face[] = [];

  pt(name: string, p: Vec3 | number[]): string { this.points[name] = [p[0], p[1], p[2]]; return name; }

  /** Add a face; repeated names are dropped, and a face left with fewer than three corners is skipped. */
  face(loop: string[], material?: string): this {
    const l: string[] = [];
    for (const n of loop) if (!l.includes(n)) l.push(n);
    if (l.length >= 3) this.faces.push({ loop: l, material });
    return this;
  }
  quad(a: string, b: string, c: string, d: string, material?: string): this { return this.face([a, b, c, d], material); }

  /** Bands of quads between consecutive rings of names (ring[i][j] to ring[i+1][j]). */
  bands(rings: string[][], material?: string): this {
    for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j + 1 < rings[i].length; j++) this.quad(rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j], material);
    return this;
  }

  private flip(): void { for (const f of this.faces) f.loop.reverse(); }

  /** Turn all faces outward, judged by the signed volume they enclose. Works for the +Y half of a
   *  mirrored solid (the missing faces in the mirror plane contribute nothing) and tolerates small holes. */
  orientByVolume(): this {
    let vol = 0;
    for (const f of this.faces) {
      const P = f.loop.map((n) => this.points[n]);
      for (let k = 1; k + 1 < P.length; k++) {
        const a = P[0], b = P[k], c = P[k + 1];
        vol += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
      }
    }
    if (vol < 0) this.flip();
    return this;
  }

  /** Turn all faces of an open patch so that their summed normal points along `hint`. */
  orientAlong(hint: Vec3): this {
    let s = 0;
    for (const f of this.faces) {
      const P = f.loop.map((n) => this.points[n]);
      for (let i = 0; i < P.length; i++) {
        const p = P[i], q = P[(i + 1) % P.length];
        s += hint[0] * (p[1] - q[1]) * (p[2] + q[2]) + hint[1] * (p[2] - q[2]) * (p[0] + q[0]) + hint[2] * (p[0] - q[0]) * (p[1] + q[1]);
      }
    }
    if (s < 0) this.flip();
    return this;
  }

  /** Shortest edge over all faces: the kit clamps the bevel to 30 % of it. */
  shortestEdge(): { length: number; a: string; b: string } {
    let best = { length: Infinity, a: "", b: "" };
    for (const f of this.faces) for (let i = 0; i < f.loop.length; i++) {
      const a = f.loop[i], b = f.loop[(i + 1) % f.loop.length], p = this.points[a], q = this.points[b];
      const l = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (l < best.length) best = { length: l, a, b };
    }
    return best;
  }

  spec(extra: { bevel?: number; mirror?: boolean; material?: string }) { return { points: this.points, faces: this.faces, ...extra }; }
}

/** Linear interpolation in a table of rows sorted by their first column; clamps outside the range. */
export function interp(rows: number[][], t: number): number[] {
  if (t <= rows[0][0]) return rows[0];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    if (t <= b[0]) { const u = (t - a[0]) / (b[0] - a[0]); return a.map((v, j) => v + (b[j] - v) * u); }
  }
  return rows[rows.length - 1];
}

/** Sorted values with near-duplicates removed. */
export function uniqueSorted(values: number[], eps: number): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > eps) out.push(v);
  return out;
}

/** Inward mitre offset of the right half of a left-right symmetric outline. `half` runs from the
 *  bottom centre (u = 0) round the +u side to the top centre (u = 0), counter-clockwise. */
export function insetHalfOutline(half: [number, number][], d: number): [number, number][] {
  const n = half.length;
  return half.map((v, k) => {
    const prev: [number, number] = k === 0 ? [-half[1][0], half[1][1]] : half[k - 1];
    const next: [number, number] = k === n - 1 ? [-half[n - 2][0], half[n - 2][1]] : half[k + 1];
    const e1 = [v[0] - prev[0], v[1] - prev[1]], e2 = [next[0] - v[0], next[1] - v[1]];
    const l1 = Math.hypot(e1[0], e1[1]), l2 = Math.hypot(e2[0], e2[1]);
    const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2];
    const s = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [v[0] + (n1[0] + n2[0]) * s, v[1] + (n1[1] + n2[1]) * s] as [number, number];
  });
}

/** Drop triangles that collapse to zero area once positions are rounded and stored as 32-bit floats (slivers the
 *  cage leaves where a face has collinear corners). They cover no area, so nothing opens up. */
export function dropSlivers(mesh: Mesh): Mesh {
  const q = (v: number) => Math.fround(Math.round(v * 1e6) / 1e6);   // as the GLB writer stores positions
  const P = (i: number) => [q(mesh.positions[i * 3]), q(mesh.positions[i * 3 + 1]), q(mesh.positions[i * 3 + 2])];
  const tiny = 1e-20, indices: number[] = [];   // squared cross product: areas below about 5e-11 m2
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = P(mesh.indices[t]), b = P(mesh.indices[t + 1]), c = P(mesh.indices[t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (g[0] * g[0] + g[1] * g[1] + g[2] * g[2] > tiny) indices.push(mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]);
  }
  return { ...mesh, indices };
}

export type P2 = [number, number];

/** Round the corners of an open polyline. A vertex with a positive radius becomes an arc of `segs`
 *  segments (segs + 1 points); the radius shrinks where an arc would use more than `maxShare` of an
 *  adjacent edge. The point count depends only on which radii are positive, so sections built from
 *  the same recipe can be lofted. */
export function filletPolyline(pts: P2[], radii: number[], segs: number, maxShare: number): P2[] {
  const out: P2[] = [];
  pts.forEach((v, i) => {
    const r = radii[i] ?? 0;
    if (!(r > 0) || i === 0 || i === pts.length - 1) { out.push(v); return; }
    const a = pts[i - 1], b = pts[i + 1];
    const l1 = Math.hypot(v[0] - a[0], v[1] - a[1]), l2 = Math.hypot(b[0] - v[0], b[1] - v[1]);
    const d1: P2 = [(v[0] - a[0]) / l1, (v[1] - a[1]) / l1], d2: P2 = [(b[0] - v[0]) / l2, (b[1] - v[1]) / l2];
    const turn = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]), half = Math.abs(turn) / 2;
    if (!(l1 > 0) || !(l2 > 0) || !(half > 1e-4)) { for (let k = 0; k <= segs; k++) out.push(v); return; }
    const t = Math.min(r * Math.tan(half), maxShare * l1, maxShare * l2), R = t / Math.tan(half), sg = Math.sign(turn);
    const s: P2 = [v[0] - d1[0] * t, v[1] - d1[1] * t], c: P2 = [s[0] - sg * d1[1] * R, s[1] + sg * d1[0] * R];
    for (let k = 0; k <= segs; k++) {
      const ang = (turn * k) / segs, ca = Math.cos(ang), sa = Math.sin(ang), px = s[0] - c[0], py = s[1] - c[1];
      out.push([c[0] + px * ca - py * sa, c[1] + px * sa + py * ca]);
    }
  });
  return out;
}

/** Smooth (Catmull-Rom) interpolation in a table of rows sorted by their first column; passes through every row. */
export function interpSmooth(rows: number[][], t: number): number[] {
  const n = rows.length;
  if (t <= rows[0][0]) return rows[0];
  if (t >= rows[n - 1][0]) return rows[n - 1];
  let i = 0;
  while (i + 2 < n && t > rows[i + 1][0]) i++;
  const p1 = rows[i], p2 = rows[i + 1], p0 = rows[Math.max(i - 1, 0)], p3 = rows[Math.min(i + 2, n - 1)];
  const h = p2[0] - p1[0], u = (t - p1[0]) / h, u2 = u * u, u3 = u2 * u;
  return p1.map((v, j) => {
    if (j === 0) return t;
    const m1 = i > 0 ? (p2[j] - p0[j]) / (p2[0] - p0[0]) : (p2[j] - v) / h;
    const m2 = i + 2 < n ? (p3[j] - v) / (p3[0] - p1[0]) : (p2[j] - v) / h;
    return (2 * u3 - 3 * u2 + 1) * v + (u3 - 2 * u2 + u) * h * m1 + (3 * u2 - 2 * u3) * p2[j] + (u3 - u2) * h * m2;
  });
}

/** The values with `n - 1` evenly spaced values inserted into every interval. */
export function refine(values: number[], n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < values.length; i++) for (let k = 0; k < n; k++) out.push(values[i] + ((values[i + 1] - values[i]) * k) / n);
  out.push(values[values.length - 1]);
  return out;
}

/** Closed ring from a half section that starts and ends on the mirror plane (y = 0). */
export function fullRing(half: Vec3[]): Vec3[] {
  return [...half, ...half.slice(1, -1).reverse().map((p) => [p[0], -p[1], p[2]] as Vec3)];
}

/** Point on the quadratic Bezier through three sections (pointwise): rounds a kink between stations. */
export function blendSections(a: Vec3[], b: Vec3[], c: Vec3[], t: number): Vec3[] {
  const u = 1 - t;
  return b.map((p, i) => [0, 1, 2].map((k) => u * u * a[i][k] + 2 * u * t * p[k] + t * t * c[i][k]) as Vec3);
}
