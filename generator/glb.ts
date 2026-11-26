// Deterministic GLB writer: node hierarchy with names, TRS and extras; one mesh per node with one
// primitive per material; PBR materials from the palette; generated emissive textures for screens.
// No timestamps, no random ids: the same input gives the same bytes.
import type { Vec3, Quat } from "./math.ts";
import type { Part } from "./kit.ts";
import { type Material, srgbToLinear } from "./materials.ts";
import type { Texture } from "./textures.ts";

export interface OutNode {
  name: string;
  translation: Vec3;
  rotation: Quat;
  extras: Record<string, unknown>;
  parts?: Part[];
  children: OutNode[];
}
export interface GlbStats { bytes: number; nodes: number; meshes: number; primitives: number; triangles: number; vertices: number; materials: number; textures: number }

const r6 = (v: number) => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
const r7 = (v: number) => { const x = Math.round(v * 1e7) / 1e7; return x === 0 ? 0 : x; };

/** Texture coordinates for a mesh that has none: each triangle is projected along the axis its face points along most (a box
 *  projection in the component's frame), `tile` metres per repeat. Grain direction: on each face the texture's u runs along the
 *  longer of the part's two extents in that face's plane (a board's grain runs along its length). Vertices are split where
 *  neighbours project differently. */
export function boxUv(mesh: Part["mesh"], tile: number): Part["mesh"] {
  const P = mesh.positions, out = { positions: [] as number[], normals: [] as number[], uvs: [] as number[], indices: [] as number[] }, seen = new Map<number, number>();
  const ext = [0, 1, 2].map((k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < P.length; i += 3) { if (P[i] < lo) lo = P[i]; if (P[i] > hi) hi = P[i]; } return hi - lo; });
  // per projection axis: [coordinate that carries u, coordinate that carries v]
  const plane = [[1, 2], [0, 2], [0, 1]].map(([a, b]) => (ext[a] >= ext[b] ? [a, b] : [b, a]));
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]], e1 = [0, 1, 2].map((k) => P[3 * b + k] - P[3 * a + k]), e2 = [0, 1, 2].map((k) => P[3 * c + k] - P[3 * a + k]);
    const n = [Math.abs(e1[1] * e2[2] - e1[2] * e2[1]), Math.abs(e1[2] * e2[0] - e1[0] * e2[2]), Math.abs(e1[0] * e2[1] - e1[1] * e2[0])], axis = n[2] >= n[0] && n[2] >= n[1] ? 2 : n[0] >= n[1] ? 0 : 1;
    for (const v of [a, b, c]) {
      const key = v * 3 + axis;
      if (!seen.has(key)) {
        seen.set(key, out.positions.length / 3);
        const [x, y, z] = [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
        out.positions.push(x, y, z); out.normals.push(mesh.normals[3 * v], mesh.normals[3 * v + 1], mesh.normals[3 * v + 2]);
        const q = [x, y, z]; out.uvs.push(q[plane[axis][0]] / tile, q[plane[axis][1]] / tile);
      }
      out.indices.push(seen.get(key)!);
    }
  }
  return out;
}

export function writeGlb(root: OutNode, palette: Record<string, Material>, textures: Record<string, Texture>, assetExtras: Record<string, unknown>, swatches: Record<string, Uint8Array> = {}): { bytes: Uint8Array; stats: GlbStats } {
  const chunks: Uint8Array[] = [];
  let binLength = 0;
  const bufferViews: any[] = [], accessors: any[] = [];
  const pushView = (data: Uint8Array, target?: number): number => {
    const pad = (4 - (binLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); binLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: data.byteLength, ...(target ? { target } : {}) });
    chunks.push(data); binLength += data.byteLength;
    return bufferViews.length - 1;
  };
  const f32 = (arr: number[], round: (v: number) => number) => { const a = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) a[i] = round(arr[i]); return a; };
  const bytesOf = (a: Float32Array | Uint16Array | Uint32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

  // materials actually used, in palette order
  const used = new Set<string>();
  const visit = (n: OutNode, f: (n: OutNode) => void) => { f(n); n.children.forEach((c) => visit(c, f)); };
  visit(root, (n) => n.parts?.forEach((p) => used.add(p.material)));
  const matNames = Object.keys(palette).filter((m) => used.has(m));
  const texNames = [...new Set(matNames.map((m) => palette[m].emissiveTexture).filter((t): t is NonNullable<typeof t> => !!t))];
  // optional surface textures (an asset's swatches): only those that were handed in
  const swatchOf = (name: string) => { const t = palette[name]?.texture; return t && swatches[t.file] ? t : undefined; };
  const swatchNames = [...new Set(matNames.map((m) => swatchOf(m)?.file).filter((f): f is string => !!f))];
  const usesClearcoat = matNames.some((m) => palette[m].clearcoat);
  const materials = matNames.map((name) => {
    const m = palette[name];
    const out: any = { name, pbrMetallicRoughness: { baseColorFactor: [...m.color.map((c) => r6(srgbToLinear(c))), 1], metallicFactor: m.metallic, roughnessFactor: m.roughness } };
    if (m.emissiveTexture) { out.emissiveTexture = { index: texNames.indexOf(m.emissiveTexture) }; out.emissiveFactor = [1, 1, 1]; }
    if (m.clearcoat) out.extensions = { KHR_materials_clearcoat: { clearcoatFactor: m.clearcoat, clearcoatRoughnessFactor: m.clearcoatRoughness ?? 0 } };
    if (m.emissive) out.emissiveFactor = m.emissive.map((c) => r6(srgbToLinear(c)));
    const sw = swatchOf(name);
    if (sw) {   // colour = factor x swatch; the swatch's mean is `gain`, so the factor is the flat colour divided by it
      out.pbrMetallicRoughness.baseColorFactor = [...m.color.map((c) => r6(Math.min(1, srgbToLinear(c) / sw.gain))), 1];
      out.pbrMetallicRoughness.baseColorTexture = { index: texNames.length + swatchNames.indexOf(sw.file) };
      out.extras = { optional_texture: true, texture_gain: sw.gain };
    }
    return out;
  });

  const nodes: any[] = [], meshes: any[] = [];
  const stats: GlbStats = { bytes: 0, nodes: 0, meshes: 0, primitives: 0, triangles: 0, vertices: 0, materials: materials.length, textures: texNames.length };
  const emitNode = (n: OutNode): number => {
    const idx = nodes.length;
    const j: any = { name: n.name };
    nodes.push(j);
    const t = n.translation.map(r6), q = n.rotation.map(r7);
    if (t.some((v) => v !== 0)) j.translation = t;
    if (!(q[0] === 0 && q[1] === 0 && q[2] === 0)) j.rotation = q;
    if (n.parts?.length) {
      const primitives = n.parts.map((part) => {
        const sw = swatchOf(part.material), p = sw && !part.mesh.uvs ? { material: part.material, mesh: boxUv(part.mesh, sw.tile) } : part;
        const nv = p.mesh.positions.length / 3;
        const pos = f32(p.mesh.positions, r6), nor = f32(p.mesh.normals, r6);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < min[k]) min[k] = pos[i]; if (pos[i] > max[k]) max[k] = pos[i]; }
        const attributes: any = {};
        accessors.push({ bufferView: pushView(bytesOf(pos), 34962), componentType: 5126, count: nv, type: "VEC3", min, max });
        attributes.POSITION = accessors.length - 1;
        accessors.push({ bufferView: pushView(bytesOf(nor), 34962), componentType: 5126, count: nv, type: "VEC3" });
        attributes.NORMAL = accessors.length - 1;
        if (p.mesh.uvs) {
          accessors.push({ bufferView: pushView(bytesOf(f32(p.mesh.uvs, r6)), 34962), componentType: 5126, count: nv, type: "VEC2" });
          attributes.TEXCOORD_0 = accessors.length - 1;
        }
        const idxArr = nv <= 65535 ? Uint16Array.from(p.mesh.indices) : Uint32Array.from(p.mesh.indices);
        accessors.push({ bufferView: pushView(bytesOf(idxArr), 34963), componentType: nv <= 65535 ? 5123 : 5125, count: idxArr.length, type: "SCALAR" });
        stats.primitives++; stats.triangles += idxArr.length / 3; stats.vertices += nv;
        return { attributes, indices: accessors.length - 1, material: matNames.indexOf(p.material), mode: 4 };
      });
      j.mesh = meshes.length;
      meshes.push({ name: n.name + "__mesh", primitives });
    }
    if (Object.keys(n.extras).length) j.extras = n.extras;
    if (n.children.length) j.children = n.children.map(emitNode);
    return idx;
  };
  emitNode(root);

  const images = texNames.map((t) => ({ name: t, mimeType: "image/png", bufferView: pushView(textures[t].png) }));
  const json: any = {
    asset: { version: "2.0", generator: "synergon generator", extras: assetExtras },
    scene: 0,
    scenes: [{ name: "scene", nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  if (images.length) {
    json.images = images;
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    json.textures = texNames.map((t, i) => ({ name: t, sampler: 0, source: i }));
  }
  if (swatchNames.length) {   // repeating sampler, after the screens' clamped one
    json.images = [...(json.images ?? []), ...swatchNames.map((f) => ({ name: f.replace(/\.(png|jpe?g)$/, ""), mimeType: /\.jpe?g$/.test(f) ? "image/jpeg" : "image/png", bufferView: pushView(swatches[f]) }))];
    json.samplers = [...(json.samplers ?? []), { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    json.textures = [...(json.textures ?? []), ...swatchNames.map((f, i) => ({ name: f.replace(/\.(png|jpe?g)$/, ""), sampler: json.samplers.length - 1, source: texNames.length + i }))];
    json.buffers[0].byteLength = binLength; stats.textures += swatchNames.length;
  }
  if (usesClearcoat) json.extensionsUsed = ["KHR_materials_clearcoat"];

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jp = (4 - (jsonBytes.byteLength % 4)) % 4, bp = (4 - (binLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.byteLength + jp + 8 + binLength + bp;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength + jp, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonBytes.byteLength + jp);
  let o = 20 + jsonBytes.byteLength + jp;
  dv.setUint32(o, binLength + bp, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  json.buffers[0].byteLength = binLength; // (already set; kept explicit)
  stats.bytes = total; stats.nodes = nodes.length; stats.meshes = meshes.length;
  return { bytes: out, stats };
}
