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

export function writeGlb(root: OutNode, palette: Record<string, Material>, textures: Record<string, Texture>, assetExtras: Record<string, unknown>): { bytes: Uint8Array; stats: GlbStats } {
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
  const usesClearcoat = matNames.some((m) => palette[m].clearcoat);
  const materials = matNames.map((name) => {
    const m = palette[name];
    const out: any = { name, pbrMetallicRoughness: { baseColorFactor: [...m.color.map((c) => r6(srgbToLinear(c))), 1], metallicFactor: m.metallic, roughnessFactor: m.roughness } };
    if (m.emissiveTexture) { out.emissiveTexture = { index: texNames.indexOf(m.emissiveTexture) }; out.emissiveFactor = [1, 1, 1]; }
    if (m.clearcoat) out.extensions = { KHR_materials_clearcoat: { clearcoatFactor: m.clearcoat, clearcoatRoughnessFactor: m.clearcoatRoughness ?? 0 } };
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
      const primitives = n.parts.map((p) => {
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
    asset: { version: "2.0", generator: "rigtwin generator", extras: assetExtras },
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
