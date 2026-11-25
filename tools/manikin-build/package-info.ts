// What a packed manikin package holds and costs, read from its files alone (no decoding of meshopt or KTX2 data, no
// npm package): the files a person needs, their bytes and SHA-256, triangles and draw calls of the most an outfit can
// show, and an upper bound of its GPU texture memory. Used by tools/manikin-build/pack.ts (to write PROVENANCE.json)
// and by tools/manikin-check.ts (to verify the committed packages against it and against the budgets).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The JSON chunk and the binary chunk of a GLB. */
export function readGlb(bytes: Uint8Array): { json: any; bin: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB (magic)");
  let o = 12, json: any = null, bin: Uint8Array = new Uint8Array(0);
  while (o < bytes.byteLength) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true), data = bytes.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === 0x004e4942) bin = data;
    o += 8 + len;
  }
  if (!json) throw new Error("GLB without a JSON chunk");
  return { json, bin };
}

/** Width, height, mip levels and kind of a KTX2, PNG or JPEG image. */
export function imageInfo(b: Uint8Array): { kind: "ktx2" | "png" | "jpeg"; width: number; height: number; levels: number; scheme?: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0xab && b[1] === 0x4b && b[2] === 0x54 && b[3] === 0x58 && b[4] === 0x20 && b[5] === 0x32 && b[6] === 0x30) {
    return { kind: "ktx2", width: dv.getUint32(20, true), height: dv.getUint32(24, true), levels: Math.max(1, dv.getUint32(40, true)), scheme: dv.getUint32(44, true) };
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { kind: "png", width: dv.getUint32(16), height: dv.getUint32(20), levels: 1 };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1], len = dv.getUint16(o + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { kind: "jpeg", width: dv.getUint16(o + 7), height: dv.getUint16(o + 5), levels: 1 };
      o += 2 + len;
    }
  }
  throw new Error("unknown image format");
}

/** GPU bytes of one texture, an upper bound: KTX2 at 1 byte per texel (BC7 / ASTC 4x4 after transcoding), PNG and
 *  JPEG at 4 (RGBA8); a full mipmap chain (4/3) for every texture, whether it carries its levels or the GPU makes them. */
export function gpuBytes(info: ReturnType<typeof imageInfo>): number {
  return Math.ceil(info.width * info.height * (info.kind === "ktx2" ? 1 : 4) * 4 / 3);
}

const glob = (p: string, n: string) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "(_\\d+)?$").test(n);

export interface PackageInfo {
  name: string;
  /** every file the person needs before it can be drawn, relative to the package folder (may start with ../) */
  core: { path: string; bytes: number; sha256: string }[];
  coreBytes: number;
  /** the same files as the production server sends them: its Caddy compresses JSON (encode zstd gzip; counted here as gzip
   *  level 6), not GLB, KTX2, PNG or the shape files, which are compressed already */
  transferBytes: number;
  /** per tone other than the default: the files it adds */
  tones: Record<string, { path: string; bytes: number; sha256: string }[]>;
  /** clip files named by the manifest */
  clips: { path: string; bytes: number; sha256: string }[];
  /** per style: the most an outfit can draw (every wardrobe slot filled) */
  styles: Record<string, { triangles: number; drawCalls: number; meshes: string[]; gpuTextureBytes: number }>;
  totals: { triangles: number; primitives: number; joints: number; textures: number; extensionsUsed: string[]; extensionsRequired: string[] };
  missing: string[];
}

/** Reads a package folder (`<dir>/<name>.avatar.json`) the way the viewer loads it. */
export function packageInfo(dir: string, name: string): PackageInfo {
  const missing: string[] = [];
  const file = (rel: string) => {
    const p = normalize(join(dir, rel));
    if (!existsSync(p)) { missing.push(rel); return { path: rel, bytes: 0, sha256: "", data: new Uint8Array(0) }; }
    const data = new Uint8Array(readFileSync(p));
    return { path: rel, bytes: data.byteLength, sha256: sha256(data), data };
  };
  const manifestFile = file(`${name}.avatar.json`), m = JSON.parse(new TextDecoder().decode(manifestFile.data));
  const glbFile = file(m.glb), { json, bin } = readGlb(glbFile.data);
  const strip = ({ data: _d, ...rest }: { path: string; bytes: number; sha256: string; data: Uint8Array }) => rest;
  const core = [manifestFile, glbFile];
  for (const b of [m.shape?.bake ?? []].flat()) core.push(file(b.file));
  if (m.posesFile) core.push(file(m.posesFile));
  // side maps: garment masks and covers, detail and posed normal maps of the materials
  const side = new Set<string>();
  for (const slot of m.wardrobe?.slots ?? []) for (const g of slot.garments) for (const k of ["bodyMask", "cover"]) if (g[k]) side.add(g[k]);
  for (const mat of Object.values<any>(m.materials ?? {})) { if (mat?.detailNormal) side.add(mat.detailNormal); if (mat?.poseNormal?.posed) side.add(mat.poseNormal.posed); for (const v of Object.values<any>(mat?.maps ?? {})) side.add(v); }
  const sideFiles = [...side].map(file);
  core.push(...sideFiles);
  const tones: PackageInfo["tones"] = {};
  for (const t of m.tones?.list ?? []) if (t.id !== m.tones.default) tones[t.id] = Object.values<string>(t.textures ?? {}).map((p) => strip(file(p)));
  const clipPaths = new Set<string>();
  for (const c of m.clips ?? []) { if (c.source && c.source !== "glb") clipPaths.add(c.source); for (const p of Object.values<string>(c.perBody ?? {})) clipPaths.add(p); }
  const clips = [...clipPaths].map((p) => strip(file(p)));

  // geometry and textures of the GLB, per style
  const nodesWithMesh = (json.nodes ?? []).filter((n: any) => n.mesh !== undefined);
  const meshTris = (mi: number) => (json.meshes[mi].primitives as any[]).reduce((s, p) => s + (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3, 0);
  const images: { info: ReturnType<typeof imageInfo> }[] = (json.images ?? []).map((im: any) => { const bv = json.bufferViews[im.bufferView]; return { info: imageInfo(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)) }; });
  const textureImage = (ti: number) => { const t = json.textures[ti]; return t.extensions?.KHR_texture_basisu?.source ?? t.source; };
  const materialImages = (mi: number | undefined) => { if (mi === undefined) return []; const mt = json.materials[mi], out: number[] = []; const add = (x: any) => { if (x?.index !== undefined) out.push(textureImage(x.index)); }; add(mt.pbrMetallicRoughness?.baseColorTexture); add(mt.pbrMetallicRoughness?.metallicRoughnessTexture); add(mt.normalTexture); add(mt.occlusionTexture); add(mt.emissiveTexture); for (const e of Object.values<any>(mt.extensions ?? {})) for (const v of Object.values<any>(e)) add(v); return out; };
  const sideGpu = sideFiles.filter((f) => f.data.byteLength && !/\/(mask|cover)_[^/]*$/.test(f.path)).reduce((s, f) => s + gpuBytes(imageInfo(f.data)), 0);
  const maskSize = Math.max(0, ...sideFiles.filter((f) => f.data.byteLength && /\/(mask|cover)_[^/]*$/.test(f.path)).map((f) => imageInfo(f.data).width));
  const styles: PackageInfo["styles"] = {};
  for (const [sid, st] of Object.entries<any>(m.styles ?? { default: {} })) {
    const shown = nodesWithMesh.filter((n: any) => { const nm = n.name ?? json.meshes[n.mesh].name ?? ""; if ((st.hide ?? []).some((p: string) => glob(p, nm))) return false; if (st.show && !st.show.some((p: string) => glob(p, nm))) return false; return true; });
    const imgs = new Set<number>();
    for (const n of shown) for (const p of json.meshes[n.mesh].primitives) for (const i of materialImages(p.material)) imgs.add(i);
    const masks = st.wardrobe === false || st.bodyMask === false ? 0 : maskSize ? 2 * gpuBytes({ kind: "png", width: maskSize, height: maskSize, levels: 1 }) : 0;
    styles[sid] = {
      triangles: shown.reduce((s: number, n: any) => s + meshTris(n.mesh), 0),
      drawCalls: shown.reduce((s: number, n: any) => s + json.meshes[n.mesh].primitives.length, 0),
      meshes: shown.map((n: any) => n.name),
      gpuTextureBytes: [...imgs].reduce((s, i) => s + gpuBytes(images[i].info), 0) + (st.wardrobe === false ? 0 : sideGpu) + masks,
    };
  }
  const coreOut = core.map(strip);
  return {
    name, core: coreOut, coreBytes: coreOut.reduce((s, f) => s + f.bytes, 0), transferBytes: core.reduce((s, f) => s + (f.path.endsWith(".json") ? Bun.gzipSync(f.data, { level: 6 }).byteLength : f.bytes), 0), tones, clips, styles,
    totals: { triangles: (json.meshes ?? []).reduce((s: number, _m: any, i: number) => s + meshTris(i), 0), primitives: (json.meshes ?? []).reduce((s: number, x: any) => s + x.primitives.length, 0), joints: json.skins?.[0]?.joints?.length ?? 0, textures: (json.textures ?? []).length, extensionsUsed: json.extensionsUsed ?? [], extensionsRequired: json.extensionsRequired ?? [] },
    missing,
  };
}
