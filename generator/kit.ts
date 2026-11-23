// Geometry kit: plain indexed triangle meshes in the project frame (metres, Z up, X forward, Y left).
// Every primitive is centred in x/y and sits on z = 0 unless stated otherwise.
// Shading: normals are computed from a crease angle with area-and-angle weighting, so a single
// chamfer strip between two big faces shades as a rounded edge while the big faces stay flat.
import {
  type Vec2, type Vec3, type Mat4, add, sub, mul, dot, cross, len, norm, deg,
  matMul, translation, rotationAxis, rotationRpy, xformPoint, xformDir, lerp,
} from "./math.ts";
import { cage, cageParts, prism, type CageSpec } from "./cage.ts";

export interface Mesh { positions: number[]; normals: number[]; uvs?: number[]; indices: number[] }
export interface Part { material: string; mesh: Mesh }

const DEFAULT_CREASE = 50; // degrees; above the 45° of a chamfer so chamfers blend into their faces

// ---------------------------------------------------------------------------------------------
// Shading: points + triangles -> mesh with split normals
// ---------------------------------------------------------------------------------------------
export interface ShadeOptions { crease?: number; uvs?: Vec2[]; orient?: boolean }

/** Build a mesh from points and triangle indices. Welds coincident points, drops zero-area
 *  triangles, optionally re-orients a closed shell outward, and computes crease-angle normals. */
export function shade(points: Vec3[], tris: number[], opts: ShadeOptions = {}): Mesh {
  const cosC = Math.cos(deg(opts.crease ?? DEFAULT_CREASE));
  const weld = new Map<string, number>();
  const wid = new Int32Array(points.length);
  let nW = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const k = Math.round(p[0] * 1e6) + "," + Math.round(p[1] * 1e6) + "," + Math.round(p[2] * 1e6);
    let w = weld.get(k);
    if (w === undefined) { w = nW++; weld.set(k, w); }
    wid[i] = w;
  }
  type Tri = { v: [number, number, number]; n: Vec3; w: [number, number, number] };
  const T: Tri[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (wid[a] === wid[b] || wid[b] === wid[c] || wid[a] === wid[c]) continue;
    const pa = points[a], pb = points[b], pc = points[c];
    const e1 = sub(pb, pa), e2 = sub(pc, pa), e3 = sub(pc, pb);
    const cr = cross(e1, e2), area2 = len(cr);
    if (!(area2 > 1e-12)) continue;
    const ang = (u: Vec3, v: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v)))));
    const A = ang(e1, e2), B = ang(mul(e1, -1), e3), C = Math.PI - A - B;
    T.push({ v: [a, b, c], n: mul(cr, 1 / area2), w: [A * area2, B * area2, C * area2] });
  }
  if (opts.orient) {
    const half = new Map<string, number>();
    for (const t of T) for (let k = 0; k < 3; k++) {
      const key = wid[t.v[k]] + ">" + wid[t.v[(k + 1) % 3]];
      half.set(key, (half.get(key) ?? 0) + 1);
    }
    let closed = T.length > 0;
    for (const [key, n] of half) {
      const [a, b] = key.split(">");
      if (n !== 1 || half.get(b + ">" + a) !== 1) { closed = false; break; }
    }
    if (closed) {
      let vol = 0;
      for (const t of T) vol += dot(points[t.v[0]], cross(points[t.v[1]], points[t.v[2]]));
      if (vol < 0) for (const t of T) { t.v = [t.v[0], t.v[2], t.v[1]]; t.w = [t.w[0], t.w[2], t.w[1]]; t.n = mul(t.n, -1); }
    }
  }
  const at: number[][] = Array.from({ length: nW }, () => []);
  T.forEach((t, i) => { for (let k = 0; k < 3; k++) at[wid[t.v[k]]].push(i * 3 + k); });
  const mesh: Mesh = { positions: [], normals: [], indices: [] };
  if (opts.uvs) mesh.uvs = [];
  const out = new Map<string, number>();
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    for (let k = 0; k < 3; k++) {
      const w = wid[t.v[k]];
      let nx = 0, ny = 0, nz = 0;
      for (const ref of at[w]) {
        const o = T[(ref / 3) | 0];
        if (dot(o.n, t.n) >= cosC) { const wt = o.w[ref % 3]; nx += o.n[0] * wt; ny += o.n[1] * wt; nz += o.n[2] * wt; }
      }
      const n = norm([nx, ny, nz]);
      const uv = opts.uvs ? opts.uvs[t.v[k]] : undefined;
      const key = w + "|" + Math.round(n[0] * 1e4) + "," + Math.round(n[1] * 1e4) + "," + Math.round(n[2] * 1e4) + (uv ? "|" + Math.round(uv[0] * 1e5) + "," + Math.round(uv[1] * 1e5) : "");
      let idx = out.get(key);
      if (idx === undefined) {
        idx = mesh.positions.length / 3;
        out.set(key, idx);
        const p = points[t.v[k]];
        mesh.positions.push(p[0], p[1], p[2]);
        mesh.normals.push(n[0], n[1], n[2]);
        if (uv) mesh.uvs!.push(uv[0], uv[1]);
      }
      mesh.indices.push(idx);
    }
  }
  return mesh;
}

/** Recompute normals of an existing mesh with a different crease angle (degrees). */
export function recomputeNormals(mesh: Mesh, crease = DEFAULT_CREASE): Mesh {
  const pts: Vec3[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) pts.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
  let uvs: Vec2[] | undefined;
  if (mesh.uvs) { uvs = []; for (let i = 0; i < mesh.uvs.length; i += 2) uvs.push([mesh.uvs[i], mesh.uvs[i + 1]]); }
  return shade(pts, mesh.indices, { crease, uvs });
}

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------
/** Throws with a specific message when a mesh is unusable (NaN, empty, out-of-range, degenerate). */
export function assertMesh(mesh: Mesh, label: string): void {
  const fail = (m: string) => { throw new Error(`${label}: ${m}`); };
  if (!mesh || !Array.isArray(mesh.positions) || !Array.isArray(mesh.indices)) fail("not a mesh (did the function return kit meshes?)");
  const nv = mesh.positions.length / 3;
  if (nv === 0 || mesh.indices.length === 0) fail("empty mesh (0 vertices or 0 triangles)");
  if (mesh.positions.length % 3 || mesh.indices.length % 3) fail("position or index count is not a multiple of 3");
  if (mesh.normals.length !== mesh.positions.length) fail(`normals (${mesh.normals.length}) do not match positions (${mesh.positions.length})`);
  if (mesh.uvs && mesh.uvs.length !== nv * 2) fail(`uvs (${mesh.uvs.length}) do not match vertex count (${nv})`);
  for (let i = 0; i < mesh.positions.length; i++) if (!Number.isFinite(mesh.positions[i])) fail(`non-finite position at vertex ${(i / 3) | 0} (a parameter is probably 0, negative or missing)`);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const l = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    if (!(Math.abs(l - 1) < 1e-3)) fail(`normal of vertex ${i / 3} has length ${l}`);
  }
  if (mesh.uvs) for (const u of mesh.uvs) if (!Number.isFinite(u)) fail("non-finite uv");
  let degenerate = 0, inverted = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    if (!(a >= 0 && a < nv && b >= 0 && b < nv && c >= 0 && c < nv) || !Number.isInteger(a + b + c)) fail(`triangle ${t / 3} has an index out of range`);
    const P = (i: number): Vec3 => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
    const g = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    if (!(len(g) > 1e-12)) { degenerate++; continue; }
    const N = (i: number): Vec3 => [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]];
    if (dot(g, add(N(a), add(N(b), N(c)))) < 0) inverted++;
  }
  if (degenerate) fail(`${degenerate} zero-area triangle(s)`);
  if (inverted) fail(`${inverted} triangle(s) wound against their normals (they would be invisible from outside)`);
  const b = bounds(mesh), ext = sub(b.max, b.min);
  if (ext.filter((e) => e > 1e-5).length < 2) fail(`collapsed to a line or point (extent ${ext.map((e) => e.toFixed(6)).join(" × ")} m)`);
}

export function bounds(mesh: Mesh): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = mesh.positions[i + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  return { min, max };
}
export const triangleCount = (mesh: Mesh) => mesh.indices.length / 3;

// ---------------------------------------------------------------------------------------------
// Transforms and combination
// ---------------------------------------------------------------------------------------------
/** Apply a rigid transform (rotation + translation). For mirroring use mirrorY, for sizing use scale. */
export function transform(mesh: Mesh, m: Mat4): Mesh {
  const o: Mesh = { positions: new Array(mesh.positions.length), normals: new Array(mesh.normals.length), indices: mesh.indices.slice() };
  if (mesh.uvs) o.uvs = mesh.uvs.slice();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = xformPoint(m, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    const n = norm(xformDir(m, [mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]]));
    o.positions[i] = p[0]; o.positions[i + 1] = p[1]; o.positions[i + 2] = p[2];
    o.normals[i] = n[0]; o.normals[i + 1] = n[1]; o.normals[i + 2] = n[2];
  }
  return o;
}
export const translate = (mesh: Mesh, t: Vec3) => transform(mesh, translation(t));
/** Rotate about an axis through the origin (right-hand rule, radians). */
export const rotate = (mesh: Mesh, axis: Vec3, angle: number) => transform(mesh, rotationAxis(axis, angle));
/** Rotate by fixed-axis roll (X), pitch (Y), yaw (Z), radians. */
export const rotateRpy = (mesh: Mesh, rpy: Vec3) => transform(mesh, rotationRpy(rpy));
/** Place: rotate by rpy, then translate. */
export const place = (mesh: Mesh, pos: Vec3, rpy: Vec3 = [0, 0, 0]) => transform(mesh, matMul(translation(pos), rotationRpy(rpy)));

/** Non-uniform scale about the origin (all factors must be positive). */
export function scale(mesh: Mesh, s: Vec3 | number): Mesh {
  const k: Vec3 = typeof s === "number" ? [s, s, s] : s;
  if (!(k[0] > 0 && k[1] > 0 && k[2] > 0)) throw new Error(`scale: factors must be positive, got ${k}`);
  const o: Mesh = { positions: mesh.positions.slice(), normals: mesh.normals.slice(), indices: mesh.indices.slice() };
  if (mesh.uvs) o.uvs = mesh.uvs.slice();
  for (let i = 0; i < o.positions.length; i += 3) {
    for (let j = 0; j < 3; j++) o.positions[i + j] *= k[j];
    const n = norm([o.normals[i] / k[0], o.normals[i + 1] / k[1], o.normals[i + 2] / k[2]]);
    o.normals[i] = n[0]; o.normals[i + 1] = n[1]; o.normals[i + 2] = n[2];
  }
  return o;
}

/** Mirror across the Y = 0 plane (left <-> right), keeping faces outward. */
export function mirrorY(mesh: Mesh): Mesh {
  const o: Mesh = { positions: mesh.positions.slice(), normals: mesh.normals.slice(), indices: mesh.indices.slice() };
  if (mesh.uvs) o.uvs = mesh.uvs.slice();
  for (let i = 1; i < o.positions.length; i += 3) { o.positions[i] = -o.positions[i]; o.normals[i] = -o.normals[i]; }
  for (let t = 0; t < o.indices.length; t += 3) { const x = o.indices[t + 1]; o.indices[t + 1] = o.indices[t + 2]; o.indices[t + 2] = x; }
  return o;
}

/** Concatenate meshes into one. */
export function merge(...meshes: (Mesh | Mesh[])[]): Mesh {
  const list = meshes.flat();
  const anyUv = list.some((m) => m.uvs);
  const o: Mesh = { positions: [], normals: [], indices: [] };
  if (anyUv) o.uvs = [];
  for (const m of list) {
    const base = o.positions.length / 3;
    for (const v of m.positions) o.positions.push(v);
    for (const v of m.normals) o.normals.push(v);
    if (anyUv) { if (m.uvs) for (const v of m.uvs) o.uvs!.push(v); else for (let i = 0; i < (m.positions.length / 3) * 2; i++) o.uvs!.push(0); }
    for (const v of m.indices) o.indices.push(v + base);
  }
  return o;
}

/** A mesh (or several, merged) with a material name from the palette. */
export const part = (material: string, ...meshes: (Mesh | Mesh[])[]): Part => ({ material, mesh: merge(...meshes) });

/** Merge parts that share a material (order of first appearance is kept). */
export function mergeParts(parts: Part[]): Part[] {
  const by = new Map<string, Mesh[]>();
  for (const p of parts) { if (!by.has(p.material)) by.set(p.material, []); by.get(p.material)!.push(p.mesh); }
  return [...by].map(([material, ms]) => ({ material, mesh: ms.length === 1 ? ms[0] : merge(ms) }));
}
/** Apply a mesh operation to every part. */
export const mapParts = (parts: Part[], f: (m: Mesh) => Mesh): Part[] => parts.map((p) => ({ material: p.material, mesh: f(p.mesh) }));

// ---------------------------------------------------------------------------------------------
// 2D outlines (counter-clockwise, in the XY plane)
// ---------------------------------------------------------------------------------------------
export const rectOutline = (sx: number, sy: number): Vec2[] => [[-sx / 2, -sy / 2], [sx / 2, -sy / 2], [sx / 2, sy / 2], [-sx / 2, sy / 2]];

export function roundedRectOutline(sx: number, sy: number, radius: number, segments = 6): Vec2[] {
  const r = Math.min(radius, sx / 2, sy / 2);
  if (!(r > 0)) return rectOutline(sx, sy);
  const o: Vec2[] = [];
  const corners: [number, number, number][] = [[sx / 2 - r, -sy / 2 + r, -Math.PI / 2], [sx / 2 - r, sy / 2 - r, 0], [-sx / 2 + r, sy / 2 - r, Math.PI / 2], [-sx / 2 + r, -sy / 2 + r, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= segments; i++) {
    const a = a0 + (i / segments) * (Math.PI / 2);
    o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return o;
}
/** Obround (stadium): overall length along X, overall width along Y. */
export const obroundOutline = (length: number, width: number, segments = 8): Vec2[] => roundedRectOutline(length, width, Math.min(length, width) / 2, segments);
export const ellipseOutline = (rx: number, ry: number, segments = 24): Vec2[] => Array.from({ length: segments }, (_, i) => [rx * Math.cos((i / segments) * 2 * Math.PI), ry * Math.sin((i / segments) * 2 * Math.PI)] as Vec2);
export const circleOutline = (r: number, segments = 24): Vec2[] => ellipseOutline(r, r, segments);

export function outlineArea(o: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < o.length; i++) { const p = o[i], q = o[(i + 1) % o.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Offset a closed outline inward by d (negative d grows it). Mitred corners. */
export function offsetOutline(o: Vec2[], d: number): Vec2[] {
  const sgn = outlineArea(o) >= 0 ? 1 : -1, n = o.length, out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = o[(i + n - 1) % n], c = o[i], q = o[(i + 1) % n];
    let t1: Vec2 = [c[0] - p[0], c[1] - p[1]], t2: Vec2 = [q[0] - c[0], q[1] - c[1]];
    const l1 = Math.hypot(t1[0], t1[1]) || 1, l2 = Math.hypot(t2[0], t2[1]) || 1;
    t1 = [t1[0] / l1, t1[1] / l1]; t2 = [t2[0] / l2, t2[1] / l2];
    const n1: Vec2 = [-t1[1] * sgn, t1[0] * sgn], n2: Vec2 = [-t2[1] * sgn, t2[0] * sgn]; // inward normals
    let bx = n1[0] + n2[0], by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) { out.push([c[0] + n1[0] * d, c[1] + n1[1] * d]); continue; }
    bx /= bl; by /= bl;
    const cosHalf = Math.max(0.3, bx * n1[0] + by * n1[1]); // limit the mitre on very sharp corners
    out.push([c[0] + (bx * d) / cosHalf, c[1] + (by * d) / cosHalf]);
  }
  return out;
}

/** Ear-clipping triangulation of a simple polygon. Triangles keep the polygon's own winding. */
export function earclip(poly: Vec2[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  const sgn = outlineArea(poly) >= 0 ? 1 : -1;
  const idx = poly.map((_, i) => i), tris: number[] = [];
  const crs = (a: Vec2, b: Vec2, c: Vec2) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sgn;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (crs(a, b, c) <= 1e-14) continue;
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = poly[j];
        if (crs(a, b, p) >= -1e-14 && crs(b, c, p) >= -1e-14 && crs(c, a, p) >= -1e-14) { inside = true; break; }
      }
      if (inside) continue;
      tris.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) { // degenerate remainder: fan it so the surface stays closed
      for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
      return tris;
    }
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

/** Triangulate a 3D polygon (roughly planar) by projecting on its mean plane. Keeps the winding. */
export function triangulate3(ring: Vec3[]): number[] {
  if (ring.length === 3) return [0, 1, 2];
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    n = add(n, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
  }
  n = norm(n);
  if (len(n) === 0) return [];
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(ref, n)), v = cross(n, u);
  return earclip(ring.map((p) => [dot(p, u), dot(p, v)] as Vec2));
}

// ---------------------------------------------------------------------------------------------
// Loft, extrude, revolve, sweeps
// ---------------------------------------------------------------------------------------------
export interface LoftOptions { capStart?: boolean; capEnd?: boolean; crease?: number }

/** Skin a surface through rings of 3D points (all rings the same point count, same sense of
 *  rotation). With both caps the shell is closed and is oriented outward automatically. */
export function loft(rings: Vec3[][], opts: LoftOptions = {}): Mesh {
  const n = rings[0]?.length ?? 0;
  if (rings.length < 2 || n < 3) throw new Error(`loft: need at least 2 rings of 3 points, got ${rings.length} ring(s) of ${n}`);
  for (const r of rings) if (r.length !== n) throw new Error(`loft: rings differ in point count (${r.length} vs ${n})`);
  const pts = rings.flat(), tris: number[] = [];
  for (let r = 0; r + 1 < rings.length; r++) for (let i = 0; i < n; i++) {
    const a = r * n + i, b = r * n + ((i + 1) % n), c = (r + 1) * n + ((i + 1) % n), d = (r + 1) * n + i;
    tris.push(a, b, c, a, c, d);
  }
  if (opts.capStart ?? true) { const t = triangulate3(rings[0]); for (let i = 0; i < t.length; i += 3) tris.push(t[i], t[i + 2], t[i + 1]); }
  if (opts.capEnd ?? true) { const base = (rings.length - 1) * n; for (const i of triangulate3(rings[rings.length - 1])) tris.push(base + i); }
  return shade(pts, tris, { crease: opts.crease, orient: true });
}

/** Place a 2D outline in space: outline x/y map to local X/Y, scaled, rotated by rpy, moved to origin. */
export function ring(outline: Vec2[], origin: Vec3, opts: { scale?: number | Vec2; rpy?: Vec3 } = {}): Vec3[] {
  const s: Vec2 = typeof opts.scale === "number" ? [opts.scale, opts.scale] : opts.scale ?? [1, 1];
  const m = matMul(translation(origin), rotationRpy(opts.rpy ?? [0, 0, 0]));
  return outline.map((p) => xformPoint(m, [p[0] * s[0], p[1] * s[1], 0]));
}

export interface ExtrudeOptions { bevel?: number; bevelTop?: number; bevelBottom?: number; crease?: number }

/** Extrude a 2D outline from z = 0 to z = height, with chamfered top and bottom edges. */
export function extrude(outline: Vec2[], height: number, opts: ExtrudeOptions = {}): Mesh {
  if (!(height > 0)) throw new Error(`extrude: height must be positive, got ${height}`);
  const o = outlineArea(outline) >= 0 ? outline : outline.slice().reverse();
  const bt = Math.min(opts.bevelTop ?? opts.bevel ?? 0, height / 2), bb = Math.min(opts.bevelBottom ?? opts.bevel ?? 0, height / 2);
  const rings: Vec3[][] = [];
  if (bb > 0) rings.push(offsetOutline(o, bb).map((p) => [p[0], p[1], 0] as Vec3));
  rings.push(o.map((p) => [p[0], p[1], bb] as Vec3));
  rings.push(o.map((p) => [p[0], p[1], height - bt] as Vec3));
  if (bt > 0) rings.push(offsetOutline(o, bt).map((p) => [p[0], p[1], height] as Vec3));
  return loft(rings, { crease: opts.crease });
}

/** Box centred in x/y, sitting on z = 0, flat faces, chamfered edges. */
export function box(sx: number, sy: number, sz: number, opts: { bevel?: number } = {}): Mesh {
  if (!(sx > 0 && sy > 0 && sz > 0)) throw new Error(`box: sizes must be positive, got ${sx} × ${sy} × ${sz}`);
  const x = sx / 2, y = sy / 2;
  return prism([[-x, -y, sz], [x, -y, sz], [x, y, sz], [-x, y, sz]], [[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0]], { bevel: Math.min(opts.bevel ?? 0, sx / 4, sy / 4, sz / 4) });
}

/** Box with rounded vertical edges (plan radius) and chamfered top/bottom edges. */
export function roundedBox(sx: number, sy: number, sz: number, radius: number, opts: ExtrudeOptions & { segments?: number } = {}): Mesh {
  return extrude(roundedRectOutline(sx, sy, radius, opts.segments ?? 6), sz, opts);
}

export interface RevolveOptions { segments?: number; crease?: number }

/** Lathe: revolve a profile of [radius, z] points about the Z axis. List the profile bottom-to-top
 *  along the outside. A profile that starts and ends on the axis (radius 0) gives a closed solid. */
export function revolve(profile: Vec2[], opts: RevolveOptions = {}): Mesh {
  const seg = opts.segments ?? 24, m = profile.length;
  if (m < 2) throw new Error("revolve: profile needs at least 2 points");
  for (const p of profile) if (!(p[0] >= 0)) throw new Error(`revolve: negative or invalid radius ${p[0]} in profile`);
  const pts: Vec3[] = [], tris: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    for (const p of profile) pts.push([p[0] * c, p[0] * s, p[1]]);
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j + 1 < m; j++) {
    const a = i * m + j, b = ((i + 1) % seg) * m + j, c = ((i + 1) % seg) * m + j + 1, d = i * m + j + 1;
    tris.push(a, b, c, a, c, d);
  }
  return shade(pts, tris, { crease: opts.crease, orient: true });
}

export interface CylinderOptions { segments?: number; bevel?: number; radiusTop?: number; crease?: number }

/** Cylinder or cone frustum on z = 0 .. height, axis Z, chamfered rims. */
export function cylinder(radius: number, height: number, opts: CylinderOptions = {}): Mesh {
  const rt = opts.radiusTop ?? radius, b = Math.min(opts.bevel ?? 0, height / 2, radius / 2, rt > 0 ? rt / 2 : Infinity);
  if (!(radius > 0 && height > 0 && rt >= 0)) throw new Error(`cylinder: radius and height must be positive, got r=${radius} h=${height} rTop=${rt}`);
  const prof: Vec2[] = [[0, 0]];
  if (b > 0) prof.push([radius - b, 0], [radius, b]); else prof.push([radius, 0]);
  if (rt > 0) { if (b > 0) prof.push([rt, height - b], [rt - b, height]); else prof.push([rt, height]); }
  prof.push([0, height]);
  return revolve(prof, { segments: opts.segments ?? 24, crease: opts.crease });
}
export const cone = (radius: number, height: number, opts: CylinderOptions = {}) => cylinder(radius, height, { radiusTop: 0, ...opts });

/** Sphere centred on the origin (the one primitive that does not sit on z = 0). */
export function sphere(radius: number, opts: { segments?: number } = {}): Mesh {
  if (!(radius > 0)) throw new Error(`sphere: radius must be positive, got ${radius}`);
  const seg = opts.segments ?? 16, rows = Math.max(4, seg >> 1), prof: Vec2[] = [];
  for (let i = 0; i <= rows; i++) { const a = -Math.PI / 2 + (i / rows) * Math.PI; prof.push([i === 0 || i === rows ? 0 : radius * Math.cos(a), radius * Math.sin(a)]); }
  return revolve(prof, { segments: seg, crease: 80 });
}

/** Hollow tube (ring section) on z = 0 .. height. */
export function tube(rOuter: number, rInner: number, height: number, opts: { segments?: number; bevel?: number } = {}): Mesh {
  if (!(rOuter > rInner && rInner > 0 && height > 0)) throw new Error(`tube: need rOuter > rInner > 0 and height > 0, got ${rOuter}, ${rInner}, ${height}`);
  const b = Math.min(opts.bevel ?? 0, (rOuter - rInner) / 3, height / 3);
  const prof: Vec2[] = b > 0
    ? [[rInner + b, 0], [rOuter - b, 0], [rOuter, b], [rOuter, height - b], [rOuter - b, height], [rInner + b, height], [rInner, height - b], [rInner, b], [rInner + b, 0]]
    : [[rInner, 0], [rOuter, 0], [rOuter, height], [rInner, height], [rInner, 0]];
  return revolve(prof, { segments: opts.segments ?? 24 });
}

/** Profile for a rubber bellows: `ribs` convolutions between two radii over a height. Feed to revolve. */
export function bellowsProfile(rBottom: number, rTop: number, height: number, ribs: number, depth: number): Vec2[] {
  const prof: Vec2[] = [[0, 0]];
  const steps = ribs * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, r = lerp(rBottom, rTop, t) - (i % 2 === 1 ? 0 : depth);
    prof.push([Math.max(r, 1e-4), t * height]);
  }
  prof.push([0, height]);
  return prof;
}

/** Sweep a closed section along a circular arc about a vertical axis: a curved panel.
 *  Section points are [depth, z]; depth 0 is the concave front face, which faces -X at the
 *  panel centre; the centre of curvature is at x = -radius; the arc is centred on Y = 0.
 *  `angle` is the total arc angle (arc length / radius). */
export function sweepArc(section: Vec2[], radius: number, angle: number, opts: { segments?: number; crease?: number } = {}): Mesh {
  if (!(radius > 0) || !(angle > 0)) throw new Error(`sweepArc: radius and angle must be positive, got ${radius}, ${angle}`);
  const seg = opts.segments ?? 24, rings: Vec3[][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = -angle / 2 + (i / seg) * angle, c = Math.cos(a), s = Math.sin(a);
    rings.push(section.map(([d, z]) => [-radius + (radius + d) * c, (radius + d) * s, z] as Vec3));
  }
  return loft(rings, { crease: opts.crease });
}

/** Curved sheet matching sweepArc's front face (pushed `lift` toward the viewer), with 0–1 UVs:
 *  u = 0 at the operator's left (+Y), v = 0 at the top. Faces the centre of curvature (-X). */
export function arcSheet(radius: number, arcLength: number, height: number, opts: { segments?: number; lift?: number; z0?: number } = {}): Mesh {
  if (!(radius > 0 && arcLength > 0 && height > 0)) throw new Error(`arcSheet: radius, arc length and height must be positive, got ${radius}, ${arcLength}, ${height}`);
  const seg = opts.segments ?? 24, angle = arcLength / radius, r = radius - (opts.lift ?? 0), z0 = opts.z0 ?? -height / 2;
  const m: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, a = angle / 2 - u * angle, c = Math.cos(a), s = Math.sin(a);
    for (const v of [0, 1]) {
      m.positions.push(-radius + r * c, r * s, z0 + height * (1 - v));
      m.normals.push(-c, -s, 0);
      m.uvs!.push(u, v);
    }
  }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; m.indices.push(a, b, c, c, b, d); }
  return m;
}

/** Flat sheet in the YZ plane facing -X, centred on the origin, with 0–1 UVs (u = 0 at +Y, v = 0 at top). */
export function sheet(width: number, height: number): Mesh {
  if (!(width > 0 && height > 0)) throw new Error(`sheet: width and height must be positive, got ${width}, ${height}`);
  const y = width / 2, z = height / 2;
  return { positions: [0, y, z, 0, y, -z, 0, -y, z, 0, -y, -z], normals: [-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0], uvs: [0, 0, 0, 1, 1, 0, 1, 1], indices: [0, 1, 2, 2, 1, 3] };
}

/** Round tube along a polyline (for arms, links, rails). */
export function tubePath(points: Vec3[], radius: number | number[], opts: { segments?: number; crease?: number } = {}): Mesh {
  if (points.length < 2) throw new Error("tubePath: need at least 2 points");
  const seg = opts.segments ?? 12, rings: Vec3[][] = [];
  const tan = (i: number): Vec3 => norm(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]));
  let t0 = tan(0);
  let u = norm(cross(Math.abs(t0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], t0));
  for (let i = 0; i < points.length; i++) {
    const t = tan(i);
    u = norm(sub(u, mul(t, dot(u, t)))); // parallel transport
    const v = cross(t, u), r = typeof radius === "number" ? radius : radius[i];
    if (!(r > 0)) throw new Error(`tubePath: radius must be positive, got ${r}`);
    rings.push(Array.from({ length: seg }, (_, k) => { const a = (k / seg) * 2 * Math.PI; return add(points[i], add(mul(u, r * Math.cos(a)), mul(v, r * Math.sin(a)))); }));
    t0 = t;
  }
  return loft(rings, { crease: opts.crease });
}

export { cage, cageParts, prism, type CageSpec };
export * as math from "./math.ts";

/** The kit as one object, handed to component functions as `c.kit`. */
export const kit = {
  shade, recomputeNormals, assertMesh, bounds, triangleCount,
  transform, translate, rotate, rotateRpy, place, scale, mirrorY, merge, part, mergeParts, mapParts,
  rectOutline, roundedRectOutline, obroundOutline, ellipseOutline, circleOutline, offsetOutline, outlineArea, earclip, triangulate3,
  loft, ring, extrude, box, roundedBox, revolve, cylinder, cone, sphere, tube, bellowsProfile, sweepArc, arcSheet, sheet, tubePath,
  cage, cageParts, prism,
};
export type Kit = typeof kit;
