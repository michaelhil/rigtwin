// Faceted cage: a polyhedral shell given as named corner points and faces (quads / n-gons),
// optionally mirrored across Y = 0, with chamfered edges.
//
// Method: every face is pulled back from its edges by `bevel` (its normal stays the face normal,
// so facets render flat), then each shared edge gets a strip and each corner a small polygon
// stitched between the pulled-back faces. Strips and corners reuse the face vertices, so their
// shading blends from one facet normal to the next: the chamfer reads as a rounded edge that
// catches light, at a cost of two triangles per edge.
import { type Vec3, add, sub, mul, dot, cross, len, norm, deg } from "./math.ts";
import type { Mesh, Part } from "./kit.ts";

export interface CageFace { loop: string[]; material?: string }
export interface CageSpec {
  /** Named corner points in the component frame. */
  points: Record<string, Vec3 | number[]>;
  /** Faces as point-name loops, counter-clockwise seen from outside. */
  faces: (string[] | CageFace)[];
  /** Distance each face is pulled back from a cage edge (metres). 0 = sharp edges. Clamped to 30 % of the cage's shortest edge. */
  bevel?: number;
  /** Mirror across Y = 0. Points with y = 0 stay on the plane and are shared by both halves. */
  mirror?: boolean;
  /** Material for faces that do not name one. */
  material?: string;
  /** Edges whose two faces meet at less than this angle (degrees) are left unbevelled. Default 4. */
  flatAngle?: number;
}

function newell(loop: Vec3[]): Vec3 {
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    n = add(n, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
  }
  return n;
}

function fanOrClip(pts: Vec3[], n: Vec3): number[] {
  if (pts.length === 3) return [0, 1, 2];
  if (pts.length === 4) { // split along the shorter diagonal, unless that would fold a non-convex quad over itself
    const A = [0, 1, 2, 0, 2, 3], B = [0, 1, 3, 1, 2, 3];
    const worst = (t: number[]) => Math.min(dot(cross(sub(pts[t[1]], pts[t[0]]), sub(pts[t[2]], pts[t[0]])), n), dot(cross(sub(pts[t[4]], pts[t[3]]), sub(pts[t[5]], pts[t[3]])), n));
    const wa = worst(A), wb = worst(B);
    if (wa > 1e-14 && wb > 1e-14) return len(sub(pts[0], pts[2])) <= len(sub(pts[1], pts[3])) ? A : B;
    return wa >= wb ? A : B;
  }
  // ear clipping in the face plane
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(ref, n)), v = cross(n, u);
  const P = pts.map((p) => [dot(p, u), dot(p, v)]);
  const idx = P.map((_, i) => i), tris: number[] = [];
  const crs = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      if (crs(P[ia], P[ib], P[ic]) <= 1e-14) continue;
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (crs(P[ia], P[ib], P[j]) >= 0 && crs(P[ib], P[ic], P[j]) >= 0 && crs(P[ic], P[ia], P[j]) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      tris.push(ia, ib, ic); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) { for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]); return tris; }
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

/** Build the cage; returns one part per material. */
export function cageParts(spec: CageSpec): Part[] {
  const defaultMat = spec.material ?? "default";
  const bevel = spec.bevel ?? 0;
  const cosFlat = Math.cos(deg(spec.flatAngle ?? 4));
  if (!(bevel >= 0)) throw new Error(`cage: bevel must be >= 0, got ${bevel}`);

  // --- points and faces, mirrored on request
  const names: string[] = [], P: Vec3[] = [], index = new Map<string, number>();
  const addPoint = (name: string, p: Vec3) => { index.set(name, P.length); names.push(name); P.push(p); };
  for (const [name, raw] of Object.entries(spec.points)) {
    if (!Array.isArray(raw) || raw.length !== 3 || raw.some((v) => !Number.isFinite(v))) throw new Error(`cage: point '${name}' is not three finite numbers: ${JSON.stringify(raw)}`);
    const p: Vec3 = [raw[0], raw[1], raw[2]];
    if (spec.mirror && Math.abs(p[1]) < 1e-9) p[1] = 0;
    addPoint(name, p);
  }
  const mirrorName = (n: string) => (P[index.get(n)!][1] === 0 ? n : n + "~");
  if (spec.mirror) for (const name of [...names]) { const p = P[index.get(name)!]; if (p[1] !== 0) addPoint(name + "~", [p[0], -p[1], p[2]]); }
  type F = { loop: number[]; material: string; n: Vec3; label: string };
  const faces: F[] = [];
  const pushFace = (loopNames: string[], material: string, label: string) => {
    const loop: number[] = [];
    for (const nm of loopNames) {
      const i = index.get(nm);
      if (i === undefined) throw new Error(`cage: ${label} uses unknown point '${nm}'. Known: ${names.filter((x) => !x.endsWith("~")).join(", ")}`);
      if (loop[loop.length - 1] !== i) loop.push(i);
    }
    if (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
    if (loop.length < 3) throw new Error(`cage: ${label} has fewer than 3 distinct corners`);
    const nn = newell(loop.map((i) => P[i]));
    if (!(len(nn) > 1e-12)) throw new Error(`cage: ${label} (${loopNames.join(", ")}) has zero area`);
    faces.push({ loop, material, n: norm(nn), label });
  };
  spec.faces.forEach((f, i) => {
    const loop = Array.isArray(f) ? f : f.loop, material = (Array.isArray(f) ? undefined : f.material) ?? defaultMat;
    pushFace(loop, material, `face ${i}`);
    if (spec.mirror) {
      if (loop.every((nm) => index.has(nm) && P[index.get(nm)!][1] === 0)) throw new Error(`cage: face ${i} (${loop.join(", ")}) lies in the mirror plane`);
      pushFace(loop.map(mirrorName).reverse(), material, `mirror of face ${i}`);
    }
  });

  // --- edge map, consistency, orientation
  const edge = new Map<number, { f: number; k: number }>();
  const ek = (a: number, b: number) => a * 65536 + b;
  const buildEdges = () => {
    edge.clear();
    faces.forEach((F, f) => F.loop.forEach((a, k) => {
      const b = F.loop[(k + 1) % F.loop.length], key = ek(a, b), prev = edge.get(key);
      if (prev) throw new Error(`cage: edge ${names[a]} → ${names[b]} is used in the same direction by ${faces[prev.f].label} and ${F.label}: one of them is wound the wrong way, or three faces share the edge`);
      edge.set(key, { f, k });
    }));
  };
  buildEdges();
  let closed = true;
  for (const key of edge.keys()) { const a = Math.floor(key / 65536), b = key % 65536; if (!edge.has(ek(b, a))) { closed = false; break; } }
  if (closed) {
    let vol = 0;
    for (const F of faces) for (let k = 1; k + 1 < F.loop.length; k++) vol += dot(P[F.loop[0]], cross(P[F.loop[k]], P[F.loop[k + 1]]));
    if (vol < 0) { for (const F of faces) { F.loop.reverse(); F.n = mul(F.n, -1); } buildEdges(); }
  }

  // --- pull every face back from its bevelled edges
  const V: Vec3[] = [], N: Vec3[] = [];
  const base: number[] = [];
  const tris = new Map<string, number[]>();
  const emit = (mat: string, a: number, b: number, c: number) => {
    if (len(cross(sub(V[b], V[a]), sub(V[c], V[a]))) <= 1e-12) return;
    if (!tris.has(mat)) tris.set(mat, []);
    tris.get(mat)!.push(a, b, c);
  };
  const bevelled = (F: F, f: number, k: number): boolean => {
    const a = F.loop[k], b = F.loop[(k + 1) % F.loop.length], twin = edge.get(ek(b, a));
    return !!twin && bevel > 0 && dot(faces[twin.f].n, F.n) < cosFlat;
  };
  // one pull-back distance for the whole cage (clamped to 30 % of its shortest edge), so that faces
  // meeting along an unbevelled edge stay edge-to-edge
  let shortest = Infinity;
  for (const F of faces) for (let k = 0; k < F.loop.length; k++) shortest = Math.min(shortest, len(sub(P[F.loop[(k + 1) % F.loop.length]], P[F.loop[k]])));
  const d = Math.min(bevel, 0.3 * shortest);
  faces.forEach((F, f) => {
    const m = F.loop.length;
    const inset = F.loop.map((_, k) => (bevelled(F, f, k) ? d : 0));
    base.push(V.length);
    for (let k = 0; k < m; k++) {
      const v = P[F.loop[k]], pv = P[F.loop[(k + m - 1) % m]], nx = P[F.loop[(k + 1) % m]];
      const t1 = norm(sub(v, pv)), t2 = norm(sub(nx, v));
      const dPrev = inset[(k + m - 1) % m], dNext = inset[k];
      const s = dot(F.n, cross(t1, t2));
      let p: Vec3;
      if (dPrev === 0 && dNext === 0) p = v;
      else if (Math.abs(s) < 1e-6) p = add(v, mul(cross(F.n, t1), Math.max(dPrev, dNext)));
      else p = add(v, add(mul(t1, -dNext / s), mul(t2, dPrev / s)));
      V.push(p); N.push(F.n);
    }
    const loopPts = V.slice(base[f], base[f] + m);
    const t = fanOrClip(loopPts, F.n);
    for (let i = 0; i < t.length; i += 3) emit(F.material, base[f] + t[i], base[f] + t[i + 1], base[f] + t[i + 2]);
  });

  // --- edge strips
  faces.forEach((F, f) => F.loop.forEach((a, k) => {
    const m = F.loop.length, b = F.loop[(k + 1) % m], twin = edge.get(ek(b, a));
    if (!twin || twin.f < f || !bevelled(F, f, k)) return;
    const G = faces[twin.f], j = twin.k;
    const Fa = base[f] + k, Fb = base[f] + ((k + 1) % m), Gb = base[twin.f] + j, Ga = base[twin.f] + ((j + 1) % G.loop.length);
    emit(F.material, Fb, Fa, Ga);
    emit(F.material, Fb, Ga, Gb);
  }));

  // --- corner polygons
  const cornersAt: { f: number; k: number }[][] = P.map(() => []);
  faces.forEach((F, f) => F.loop.forEach((a, k) => cornersAt[a].push({ f, k })));
  const same = (a: number, b: number) => len(sub(V[a], V[b])) < 1e-9;
  cornersAt.forEach((list, v) => {
    const todo = new Set(list.map((c) => c.f * 64 + c.k));
    while (todo.size) {
      const first = [...todo][0];
      let cur = { f: Math.floor(first / 64), k: first % 64 };
      // rewind to a boundary (or once round) so open fans start at their first face
      for (let i = 0; i < list.length; i++) {
        const F = faces[cur.f], m = F.loop.length, prev = F.loop[(cur.k + m - 1) % m];
        const tw = edge.get(ek(v, prev));
        if (!tw || tw.f * 64 + tw.k === first) break;
        cur = { f: tw.f, k: tw.k };
      }
      const order: number[] = [];
      let open = false;
      for (let i = 0; i <= list.length; i++) {
        const key = cur.f * 64 + cur.k;
        if (!todo.has(key)) break;
        todo.delete(key);
        order.push(base[cur.f] + cur.k);
        const F = faces[cur.f], next = F.loop[(cur.k + 1) % F.loop.length];
        const tw = edge.get(ek(next, v));
        if (!tw) { open = true; break; }
        cur = { f: tw.f, k: (tw.k + 1) % faces[tw.f].loop.length };
      }
      order.reverse(); // walk order is clockwise seen from outside
      const ring: number[] = [];
      for (const id of order) if (!ring.length || !same(ring[ring.length - 1], id)) ring.push(id);
      while (ring.length > 1 && same(ring[0], ring[ring.length - 1])) ring.pop();
      if (open && ring.length >= 2) {
        let n: Vec3 = [0, 0, 0];
        for (const id of ring) n = add(n, N[id]);
        if (!ring.some((id) => len(sub(V[id], P[v])) < 1e-9)) { V.push(P[v]); N.push(norm(n)); ring.push(V.length - 1); }
      }
      if (ring.length < 3) continue;
      let n: Vec3 = [0, 0, 0];
      for (const id of ring) n = add(n, N[id]);
      const nn = norm(n), t = fanOrClip(ring.map((id) => V[id]), nn);
      const mat = faces[Math.min(...list.map((c) => c.f))].material;
      for (let i = 0; i < t.length; i += 3) {
        const [a, b, c] = [ring[t[i]], ring[t[i + 1]], ring[t[i + 2]]];
        // slivers left where an unbevelled edge meets a bevelled one can come out folded: face them outward
        if (dot(cross(sub(V[b], V[a]), sub(V[c], V[a])), add(N[a], add(N[b], N[c]))) < 0) emit(mat, a, c, b); else emit(mat, a, b, c);
      }
    }
  });

  // --- split by material
  const parts: Part[] = [];
  for (const [material, idx] of tris) {
    const remap = new Map<number, number>();
    const mesh: Mesh = { positions: [], normals: [], indices: [] };
    for (const i of idx) {
      let j = remap.get(i);
      if (j === undefined) { j = mesh.positions.length / 3; remap.set(i, j); mesh.positions.push(...V[i]); mesh.normals.push(...N[i]); }
      mesh.indices.push(j);
    }
    parts.push({ material, mesh });
  }
  if (!parts.length) throw new Error("cage: no faces produced any triangles");
  return parts;
}

/** Build the cage as a single mesh (materials ignored). */
export function cage(spec: CageSpec): Mesh {
  const parts = cageParts(spec);
  if (parts.length === 1) return parts[0].mesh;
  const o: Mesh = { positions: [], normals: [], indices: [] };
  for (const p of parts) {
    const b = o.positions.length / 3;
    for (const v of p.mesh.positions) o.positions.push(v);
    for (const v of p.mesh.normals) o.normals.push(v);
    for (const i of p.mesh.indices) o.indices.push(i + b);
  }
  return o;
}

/** Faceted solid between two polygons with the same corner count (top above bottom): tapered
 *  trays, wedges, blades, boxes. Chamfered like any cage. */
export function prism(top: Vec3[], bottom: Vec3[], opts: { bevel?: number; flatAngle?: number } = {}): Mesh {
  if (top.length !== bottom.length || top.length < 3) throw new Error(`prism: top and bottom need the same corner count (>= 3), got ${top.length} and ${bottom.length}`);
  const n = top.length, points: Record<string, Vec3> = {}, faces: string[][] = [];
  top.forEach((p, i) => { points["t" + i] = p; });
  bottom.forEach((p, i) => { points["b" + i] = p; });
  faces.push(top.map((_, i) => "t" + i));
  faces.push(bottom.map((_, i) => "b" + (n - 1 - i)));
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push(["b" + i, "b" + j, "t" + j, "t" + i]); }
  return cage({ points, faces, bevel: opts.bevel, flatAngle: opts.flatAngle });
}
