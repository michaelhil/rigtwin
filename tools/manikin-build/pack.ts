// bun tools/manikin-build/pack.ts [--only operator-m,operator-f,clay-m,clay-f] [--no-clips] [--lab <dir>] [--toktx <file>]
//
// Packs the avatar lab's passed manikin packages into the product packages under assets/manikin/ (Mac only: it needs
// KTX-Software's toktx; see README.md). Every number it uses is a record in assets/manikin/params/packaging.toml.
//
//   lab operator-<sex> (+ -medium, -dark)  ->  operator-<sex>/   one GLB, the three skin tones as texture sets (tones/)
//   lab abstract-<sex>                     ->  clay-<sex>/       the clay figure the designer passed (REVIEW-08)
//   lab body-clay(-f)/clips/<person>/*.glb ->  clips/<sex>/<person>/*.glb   shared by both styles
//   lab fabric weave normal maps           ->  shared/maps/                 shared by both sexes
//
// Geometry: EXT_meshopt_compression with every attribute in its lab data type, values rounded onto power-of-two grids
// first; opaque triangles in vertex-cache order (vertex order kept). Shape files: deltas on an absolute step, rows in
// mesh order (_SRC renumbered to match), meshopt-encoded. Textures: KTX2 (KHR_texture_basisu). Clips: meshopt with the
// quaternion filter and a finer exponential filter for translations. Writes <package>/PROVENANCE.json and checks the
// budgets at the end (the same reading as `bun run check`).
//
// Paths: the lab defaults to work/avatar-lab and toktx to work/tools/ktx/bin/toktx under the repository root; set
// MANIKIN_LAB / MANIKIN_TOKTX (or --lab / --toktx) when they live elsewhere (a worktree reads the main checkout's work/).
import { Document, NodeIO, Primitive, PropertyType, type Accessor, type Texture } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { loadParams } from "../../generator/params.ts";
import { packageInfo, readGlb, sha256 } from "./package-info.ts";

const ROOT = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const LAB = resolve(opt("--lab") ?? process.env.MANIKIN_LAB ?? join(ROOT, "work", "avatar-lab"));
const TOKTX = resolve(opt("--toktx") ?? process.env.MANIKIN_TOKTX ?? join(ROOT, "work", "tools", "ktx", "bin", "toktx"));
const OUT = join(ROOT, "assets", "manikin"), CACHE = join(ROOT, "work", "manikin-pack", "cache");
const PKG = join(LAB, "packages");

const P = loadParams(join(OUT, "params"), ["packaging"]);
const num = (k: string) => P.num(k, "pack");

/** The packages, from which lab packages. Tones: the first is the default and its textures stay in the GLB. */
export const PACKAGES: Record<string, { lab: string; sex: "m" | "f"; kind: "dressed" | "clay"; tones?: { id: string; label: string; lab: string }[] }> = {
  "operator-m": { lab: "operator-m", sex: "m", kind: "dressed", tones: [{ id: "light", label: "Light", lab: "operator-m" }, { id: "medium", label: "Medium", lab: "operator-m-medium" }, { id: "dark", label: "Dark", lab: "operator-m-dark" }] },
  "operator-f": { lab: "operator-f", sex: "f", kind: "dressed", tones: [{ id: "light", label: "Light", lab: "operator-f" }, { id: "medium", label: "Medium", lab: "operator-f-medium" }, { id: "dark", label: "Dark", lab: "operator-f-dark" }] },
  "clay-m": { lab: "abstract-m", sex: "m", kind: "clay" },
  "clay-f": { lab: "abstract-f", sex: "f", kind: "clay" },
};
/** The lab's dressed packages carry a copy of the clay style without the subdivided head and hands; the product's clay
 *  figure is the designer-passed clay-<sex> package, so the copy is left out (it would cost the first person 2 MB). */
const CLAY_COPY = { meshes: ["body_clay", "clay_eyeball_l", "clay_eyeball_r", "shoe_last"], material: "clay_figure", style: "clay" };
/** Side normal maps that both sexes share byte for byte go to shared/maps/. */
const SHARED_MAPS = ["maps/fabric_denim_n.jpg", "maps/fabric_linen_n.jpg"];

/** Which encoder a texture takes, by "<glTF material>.<slot>" (first match wins). Colour data is sRGB, the rest linear. */
type Codec = "etc1s" | "uastc";
const TEXTURE_ROLES: { match: RegExp; codec: Codec; srgb: boolean; why: string }[] = [
  { match: /^lashes_soft\.baseColor$/, codec: "uastc", srgb: true, why: "alpha-tested lash and brow cards: ETC1S alpha blurs the card edges" },
  { match: /\.baseColor$/, codec: "etc1s", srgb: true, why: "colour maps, the iris (about 10 pixels wide at 1.2 m) and the women's sculpted bun (alpha-masked; ETC1S keeps alpha in its own slice) included" },
  { match: /^prop_.*\.(metallicRoughness|occlusion)$/, codec: "uastc", srgb: false, why: "the props' occlusion-roughness-metal maps carry metal zones (headset rails and screws, eyelets): ETC1S shares one colour per block between the channels and turned the grey rails bright metal (look comparison, C1, 2026-11-25)" },
  { match: /\.(metallicRoughness|occlusion)$/, codec: "etc1s", srgb: false, why: "occlusion-roughness maps without metal (skin, hair): no difference visible at 1:1 in the head shots" },
  { match: /\.normal$/, codec: "uastc", srgb: false, why: "the garments' and props' own normal maps (folds, seams, buttons): ETC1S blocks would show as facets" },
  { match: /^side\.posed$/, codec: "etc1s", srgb: false, why: "the seated trousers' posed fold map, blended in by hip and knee flexion: ETC1S, checked in the seated key shot F1 for three bodies (0.55 MB at UASTC would put the dressed woman over 10 MB)" },
  { match: /^side\.detail$/, codec: "etc1s", srgb: false, why: "the tiling weave detail maps: 3-4 texels per pixel at working distance, so the mipmaps the eye sees average the blocks out" },
];
const roleOf = (key: string) => { const r = TEXTURE_ROLES.find((x) => x.match.test(key)); if (!r) throw new Error(`no texture role for ${key}`); return r; };

// ---------------------------------------------------------------------------------------------------------------------
// small helpers
const grid = (a: Float32Array, bits: number) => { const s = 2 ** bits; for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i] * s) / s; };
/** Rounds each group of n weights to multiples of 2^-bits with the largest-remainder rule, keeping the group's rounded sum. */
function roundWeights(a: Float32Array, n: number, bits: number) {
  const s = 2 ** bits, k = new Array<number>(n), fr = new Array<[number, number]>(n);
  for (let v = 0; v < a.length / n; v++) {
    let sum = 0, ks = 0;
    for (let j = 0; j < n; j++) { const x = a[v * n + j] * s; sum += x; k[j] = Math.floor(x); ks += k[j]; fr[j] = [x - k[j], j]; }
    let rem = Math.round(sum) - ks;
    fr.sort((x, y) => y[0] - x[0]);
    for (let r = 0; r < n && rem > 0; r++, rem--) k[fr[r][1]]++;
    for (let j = 0; j < n; j++) a[v * n + j] = k[j] / s;
  }
}
const run = (cmd: string, argv: string[]) => { const r = spawnSync(cmd, argv, { encoding: "utf8" }); if (r.status !== 0) throw new Error(`${basename(cmd)} ${argv.join(" ")} failed:\n${r.stderr || r.stdout}`); return r.stdout; };
const toktxVersion = () => run(TOKTX, ["--version"]).trim();
const writeJson = (f: string, v: unknown) => writeFileSync(f, JSON.stringify(v, null, 1) + "\n");
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");

// ---------------------------------------------------------------------------------------------------------------------
// textures: toktx with a cache keyed by the input bytes and the exact options
function ktx2(image: Uint8Array, mime: string, codec: Codec, srgb: boolean): Uint8Array {
  const settings = codec === "etc1s"
    ? ["--encode", "etc1s", "--clevel", String(num("texture.etc1s_level")), "--qlevel", String(num("texture.etc1s_quality"))]
    : ["--encode", "uastc", "--uastc_quality", String(num("texture.uastc_quality")), "--uastc_rdo_l", String(num("texture.uastc_rdo_lambda")), "--zcmp", String(num("texture.zstd_level"))];
  // mipmaps with a box filter, as WebGL's generateMipmap made them for the lab's JPEG and PNG textures (toktx's default
  // lanczos4 rings around thin features: the headset's metal rails read differently in the 1.2 m head shot)
  const opts = ["--t2", ...settings, "--genmipmap", "--filter", "box", "--assign_oetf", srgb ? "srgb" : "linear"];
  const key = sha256(new Uint8Array(Buffer.concat([Buffer.from(image), Buffer.from(opts.join(" ") + toktxVersionCached)]))).slice(0, 32);
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, key + ".ktx2");
  if (!existsSync(out)) {
    const inp = join(CACHE, key + (mime === "image/png" ? ".png" : ".jpg"));
    writeFileSync(inp, image);
    run(TOKTX, [...opts, "--threads", "8", out, inp]);
    rmSync(inp);
  }
  return new Uint8Array(readFileSync(out));
}
let toktxVersionCached = "";

/** Every texture of a document with the "<material>.<slot>" keys that use it. */
function textureUses(doc: Document): Map<Texture, string[]> {
  const uses = new Map<Texture, string[]>();
  for (const m of doc.getRoot().listMaterials()) {
    if (m.listExtensions().length) throw new Error(`material ${m.getName()} uses extensions ${m.listExtensions().map((e) => e.extensionName)}: not handled`);
    for (const [slot, t] of [["baseColor", m.getBaseColorTexture()], ["normal", m.getNormalTexture()], ["metallicRoughness", m.getMetallicRoughnessTexture()], ["occlusion", m.getOcclusionTexture()], ["emissive", m.getEmissiveTexture()]] as const)
      if (t) uses.set(t, [...(uses.get(t) ?? []), `${m.getName()}.${slot}`]);
  }
  return uses;
}
function encodeTexture(t: Texture, keys: string[]) {
  const roles = [...new Set(keys.map((k) => { const r = roleOf(k); return `${r.codec}:${r.srgb}`; }))];
  if (roles.length > 1) throw new Error(`texture ${t.getName()} is used with different roles: ${keys.join(", ")}`);
  const r = roleOf(keys[0]);
  t.setImage(ktx2(t.getImage()!, t.getMimeType(), r.codec, r.srgb) as Uint8Array<ArrayBuffer>).setMimeType("image/ktx2");
  t.setName(t.getName().replace(/\.(png|jpe?g)$/i, "") + ".ktx2"); t.setURI("");
  return { name: t.getName(), codec: r.codec, keys };
}

// ---------------------------------------------------------------------------------------------------------------------
// shape files
interface Bake { file: string; vertices: number; targets: string[]; targetScale: number[]; frame?: string; offset?: number[]; meshes: string[]; [k: string]: unknown }
/** Row order for a shape file: the order in which a vertex-cache-optimised walk over the listed meshes' triangles first
 *  meets each row; rows no triangle uses keep their order at the end. Returns order[new] = old and rank[old] = new. */
function rowOrder(doc: Document, b: Bake): { order: Uint32Array; rank: Uint32Array } {
  const N = b.vertices, tris: number[] = [];
  for (const name of b.meshes) for (const p of meshPrims(doc, name)) {
    const src = p.getAttribute("_SRC")?.getArray(), idx = p.getIndices()!.getArray()!;
    if (!src) throw new Error(`${name}: no _SRC`);
    for (let i = 0; i < idx.length; i++) tris.push(src[idx[i]]);
  }
  const ind = new Uint32Array(tris), [remap, unique] = MeshoptEncoder.reorderMesh(ind, true, false);
  const rank = new Uint32Array(N), order = new Uint32Array(N);
  let next = unique;
  for (let i = 0; i < N; i++) { rank[i] = i < remap.length && remap[i] !== 0xffffffff ? remap[i] : next++; order[rank[i]] = i; }
  if (next !== N) throw new Error(`${b.file}: row order lost rows (${next} of ${N})`);
  return { order, rank };
}
/** The lab's shape file (float32 base[N*3], int16 targets[K][N*3]) re-quantised and meshopt-encoded. */
function packShape(src: Uint8Array, b: Bake, order: Uint32Array): { bytes: Uint8Array; block: Bake; base: Float32Array; raw: Uint8Array } {
  const N = b.vertices, K = b.targets.length;
  if (src.byteLength < N * 12 + K * N * 6) throw new Error(`${b.file}: too short`);
  const base0 = new Float32Array(src.buffer.slice(src.byteOffset, src.byteOffset + N * 12));
  const d0 = new Int16Array(src.buffer.slice(src.byteOffset + N * 12, src.byteOffset + N * 12 + K * N * 6));
  const step = num(b.meshes.includes("body") ? "shape.delta_step" : "shape.wear_delta_step"), base = new Float32Array(N * 3), q = new Int16Array(K * N * 4), raw = new Int16Array(K * N * 3);
  for (let v = 0; v < N; v++) for (let c = 0; c < 3; c++) base[v * 3 + c] = base0[order[v] * 3 + c];
  grid(base, num("shape.base_grid_bits"));
  let worst = 0;
  for (let k = 0; k < K; k++) {
    const f = b.targetScale[k] / 32767;
    for (let v = 0; v < N; v++) for (let c = 0; c < 3; c++) {
      const x = d0[(k * N + order[v]) * 3 + c] * f, y = Math.round(x / step);
      if (Math.abs(y) > 32767) throw new Error(`${b.file}: target ${b.targets[k]} delta ${x} m does not fit int16 at step ${step} m`);
      q[(k * N + v) * 4 + c] = y; raw[(k * N + v) * 3 + c] = y; worst = Math.max(worst, Math.abs(y * step - x));
    }
  }
  const be = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(base.buffer), N, 12, "ATTRIBUTES", 1);
  const de = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(q.buffer), K * N, 8, "ATTRIBUTES", 1);
  const off = Math.ceil(be.byteLength / 4) * 4, bytes = new Uint8Array(off + de.byteLength);
  bytes.set(be, 0); bytes.set(de, off);
  // the lab's uncompressed layout of the same numbers (staged for the lab viewer's look comparison only)
  const rawBytes = new Uint8Array(N * 12 + K * N * 6); rawBytes.set(new Uint8Array(base.buffer), 0); rawBytes.set(new Uint8Array(raw.buffer), N * 12);
  const block: Bake = {
    ...b, targetScale: b.targets.map(() => step * 32767),
    encoding: "meshopt",
    base: { byteOffset: 0, byteLength: be.byteLength, count: N, stride: 12, layout: "float32 x, y, z per row" },
    deltas: { byteOffset: off, byteLength: de.byteLength, count: K * N, stride: 8, layout: "int16 x, y, z, 0 per row, target after target; delta = int16 / 32767 * targetScale[k]" },
    quantisation: { step_m: step, worst_m: Number(worst.toExponential(3)), rows: "in mesh order; _SRC renumbered to match" },
  };
  return { bytes, block, base, raw: rawBytes };
}

// ---------------------------------------------------------------------------------------------------------------------
// GLB
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const meshPrims = (doc: Document, name: string) => doc.getRoot().listNodes().filter((n) => n.getMesh() && (n.getName() === name || n.getMesh()!.getName() === name)).flatMap((n) => n.getMesh()!.listPrimitives());
const floats = (a: Accessor | null) => (a && a.getArray() instanceof Float32Array ? (a.getArray() as Float32Array) : null);

/** Rounds every float attribute onto its grid (see packaging.toml), in place; returns what was done per mesh. */
export function roundAttributes(doc: Document, baked: Set<string>) {
  const report: string[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const isBaked = baked.has(node.getName()) || baked.has(mesh.getName());
    for (const p of mesh.listPrimitives()) {
      for (const s of p.listSemantics()) {
        const a = floats(p.getAttribute(s)); if (!a) continue;
        if (s === "POSITION") grid(a, num("geometry.position_grid_bits"));
        else if (s === "NORMAL") grid(a, num(isBaked ? "geometry.baked_normal_grid_bits" : "geometry.normal_grid_bits"));
        else if (s === "TANGENT") grid(a, num("geometry.normal_grid_bits"));
        else if (s.startsWith("TEXCOORD_")) grid(a, num("geometry.uv_grid_bits"));
        else if (s.startsWith("COLOR_")) grid(a, num("geometry.color_grid_bits"));
        else if (s === "WEIGHTS_0") roundWeights(a, 4, num("geometry.weight4_grid_bits"));
        else if (s === "_DQS") grid(a, num("geometry.dqs_grid_bits"));
        else if (s === "_SRC" || s.startsWith("_WEIGHTS8_")) { /* integers / done below */ }
        else report.push(`${node.getName()}: float attribute ${s} kept unrounded`);
      }
      const w0 = floats(p.getAttribute("_WEIGHTS8_0")), w1 = floats(p.getAttribute("_WEIGHTS8_1"));
      if (w0 && w1) {
        const n = w0.length / 4, all = new Float32Array(n * 8);
        for (let v = 0; v < n; v++) for (let j = 0; j < 4; j++) { all[v * 8 + j] = w0[v * 4 + j]; all[v * 8 + 4 + j] = w1[v * 4 + j]; }
        roundWeights(all, 8, num("geometry.weight_grid_bits"));
        for (let v = 0; v < n; v++) for (let j = 0; j < 4; j++) { w0[v * 4 + j] = all[v * 8 + j]; w1[v * 4 + j] = all[v * 8 + 4 + j]; }
      }
      for (const t of p.listTargets()) for (const s of t.listSemantics()) {
        const a = floats(t.getAttribute(s)); if (!a) continue;
        grid(a, num(s === "POSITION" ? "geometry.morph_position_grid_bits" : "geometry.morph_normal_grid_bits"));
      }
    }
  }
  return report;
}
/** Every primitive: vertices in fetch order (opaque ones also with triangles in vertex-cache order; blended ones keep their
 *  triangle order, which their blending depends on). Vertices no triangle uses keep their relative order at the end. Every
 *  attribute and morph target moves with its vertex; returns rank[old] = new per mesh name, for the manifest's vertex indices. */
export function reorderVertices(doc: Document): Map<string, Uint32Array> {
  const ranks = new Map<string, Uint32Array>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh || ranks.has(mesh.getName())) continue;
    const prims = mesh.listPrimitives(); if (prims.length !== 1) throw new Error(`${mesh.getName()}: ${prims.length} primitives; one is expected`);
    const p = prims[0], acc = p.getIndices()!, idx = acc.getArray()!, n = p.getAttribute("POSITION")!.getCount(), u = new Uint32Array(idx);
    if (p.getMode() !== Primitive.Mode.TRIANGLES) throw new Error(`${mesh.getName()}: not triangles`);
    const blend = p.getMaterial()?.getAlphaMode() === "BLEND", [remap, unique] = MeshoptEncoder.reorderMesh(u, !blend, false);
    const rank = new Uint32Array(n); let next = unique;
    for (let v = 0; v < n; v++) rank[v] = v < remap.length && remap[v] !== 0xffffffff ? remap[v] : next++;
    if (next !== n) throw new Error(`${mesh.getName()}: vertex order lost vertices`);
    const permute = (a: Accessor) => {
      if (a.listParents().filter((x) => x.propertyType !== PropertyType.ROOT).length > 1) throw new Error(`${mesh.getName()}: an accessor is shared; not handled`);
      const src = a.getArray()!, el = a.getElementSize(), out = new (src.constructor as any)(src.length);
      for (let v = 0; v < n; v++) for (let c = 0; c < el; c++) out[rank[v] * el + c] = src[v * el + c];
      a.setArray(out);
    };
    for (const sem of p.listSemantics()) permute(p.getAttribute(sem)!);
    for (const t of p.listTargets()) for (const sem of t.listSemantics()) permute(t.getAttribute(sem)!);
    const out = new (idx.constructor as any)(idx.length); for (let i = 0; i < u.length; i++) out[i] = u[i]; acc.setArray(out);
    ranks.set(mesh.getName(), rank);
  }
  return ranks;
}
/** The manifest's lists of mesh vertex indices, renumbered; any other long list of integers stops the packing (it might
 *  be one, and would silently point at the wrong vertices). */
function remapVertexIndices(m: any, ranks: Map<string, Uint32Array>, log: string[]) {
  const cc = m.clothCorrectives;
  if (cc?.girth?.probe) { const r = ranks.get(cc.mesh); if (!r) throw new Error(`clothCorrectives.mesh ${cc.mesh} not found`); cc.girth.probe[0] = cc.girth.probe[0].map((i: number) => r[i]); log.push(`clothCorrectives.girth.probe: ${cc.girth.probe[0].length} vertex indices of ${cc.mesh} renumbered`); }
  const known = new Set(["clothCorrectives.girth.probe[0]", "shape.model.scale", "shape.model.centre"]), odd: string[] = [];
  const walk = (x: any, path: string) => {
    if (Array.isArray(x)) { if (x.length > 20 && x.every((v) => Number.isInteger(v)) && !known.has(path)) odd.push(path); x.forEach((v, i) => walk(v, `${path}[${i}]`)); }
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(m, "");
  if (odd.length) throw new Error(`integer lists in the manifest that may be vertex indices: ${odd.slice(0, 5).join(", ")}`);
}
async function writeGlb(doc: Document) {
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  if (doc.getRoot().listTextures().length) doc.createExtension(KHRTextureBasisu).setRequired(true);
  doc.getRoot().getAsset().generator = `synergon manikin pack (glTF-Transform 4.5.1, meshoptimizer 1.1.1, ${toktxVersionCached})`;
  const enc = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  return enc.writeBinary(doc);
}

// ---------------------------------------------------------------------------------------------------------------------
// clips: meshopt with filters; translations re-encoded with a finer exponential filter than glTF-Transform's 12 bits
async function packClip(src: string): Promise<{ bytes: Uint8Array; rotErr: number; transErr: number }> {
  const doc = await io.read(src), accessors = doc.getRoot().listAccessors();
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  doc.getRoot().getAsset().generator = "synergon manikin pack (glTF-Transform 4.5.1, meshoptimizer 1.1.1)";
  const enc = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const first = await enc.writeBinary(doc), { json, bin } = readGlb(first);
  if (json.accessors.length !== accessors.length) throw new Error(`${src}: accessor count changed on write`);
  const bits = num("clips.translation_bits"), views = json.bufferViews as any[];
  const parts: Uint8Array[] = []; let cursor = 0;
  const put = (data: Uint8Array) => { const at = cursor; parts.push(data); cursor += data.byteLength; const pad = (4 - (data.byteLength % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); cursor += pad; } return at; };
  views.forEach((bv, vi) => {
    const ext = bv.extensions?.EXT_meshopt_compression;
    if (!ext) { if (bv.buffer === 0) { bv.byteOffset = put(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)); } return; }
    let data = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    if (ext.filter === "EXPONENTIAL") {
      const members = json.accessors.map((a: any, i: number) => [a, i]).filter(([a]: any) => a.bufferView === vi).sort((x: any, y: any) => (x[0].byteOffset ?? 0) - (y[0].byteOffset ?? 0));
      const chunks: Uint8Array[] = []; let count = 0;
      for (const [a, i] of members) {
        const arr = accessors[i].getArray() as Float32Array, el = accessors[i].getElementSize();
        if (!(arr instanceof Float32Array) || a.count !== accessors[i].getCount()) throw new Error(`${src}: accessor ${i} does not match its source`);
        chunks.push(MeshoptEncoder.encodeFilterExp(arr, a.count, el * 4, bits)); count += a.count;
      }
      const stride = ext.byteStride, flat = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0)); let o = 0; for (const c of chunks) { flat.set(c, o); o += c.byteLength; }
      if (flat.byteLength !== count * stride) throw new Error(`${src}: exponential view ${vi} has an unexpected stride`);
      data = MeshoptEncoder.encodeGltfBuffer(flat, count, stride, "ATTRIBUTES");
      ext.byteLength = data.byteLength;
    }
    ext.byteOffset = put(data);
  });
  const newBin = new Uint8Array(cursor); { let o = 0; for (const p of parts) { newBin.set(p, o); o += p.byteLength; } }
  json.buffers[0].byteLength = newBin.byteLength;
  const bytes = glbFrom(json, newBin);
  // read back and compare with the source clip
  const dec = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const back = await dec.readBinary(bytes), a0 = doc.getRoot().listAnimations(), a1 = back.getRoot().listAnimations();
  let rotErr = 0, transErr = 0;
  a0.forEach((an, ai) => an.listChannels().forEach((ch, ci) => {
    const x = ch.getSampler()!.getOutput()!, y = a1[ai].listChannels()[ci].getSampler()!.getOutput()!, xa = x.getArray()!, el: number[] = [], n = x.getElementSize();
    for (let k = 0; k < x.getCount(); k++) {
      y.getElement(k, el);
      let d = 0, dn = 0; for (let c = 0; c < n; c++) { d = Math.max(d, Math.abs(el[c] - xa[k * n + c])); dn = Math.max(dn, Math.abs(el[c] + xa[k * n + c])); }
      if (ch.getTargetPath() === "rotation") rotErr = Math.max(rotErr, Math.min(d, dn)); else transErr = Math.max(transErr, d);
    }
  }));
  return { bytes, rotErr, transErr };
}
function glbFrom(json: any, bin: Uint8Array): Uint8Array {
  let js = new TextEncoder().encode(JSON.stringify(json)); const jp = (4 - (js.byteLength % 4)) % 4;
  if (jp) { const t = new Uint8Array(js.byteLength + jp); t.set(js); t.fill(0x20, js.byteLength); js = t; }
  const bp = (4 - (bin.byteLength % 4)) % 4, total = 12 + 8 + js.byteLength + 8 + bin.byteLength + bp, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.byteLength, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  const b0 = 20 + js.byteLength; dv.setUint32(b0, bin.byteLength + bp, true); dv.setUint32(b0 + 4, 0x004e4942, true); out.set(bin, b0 + 8);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// one package
const clipPath = (sex: string, p: string) => { const m = /clips\/([^/]+)\/([^/]+\.glb)$/.exec(p); if (!m) throw new Error(`unexpected clip path ${p}`); return `../clips/${sex}/${m[1]}/${m[2]}`; };
const STAGE: Record<string, any> = {};   // lab-format copies for the look comparison (tools/manikin-build/compare.ts)

async function packPackage(name: string, clipSources: Map<string, string>) {
  const def = PACKAGES[name], labDir = join(PKG, def.lab), m = JSON.parse(readFileSync(join(labDir, `${def.lab}.avatar.json`), "utf8"));
  const out = join(OUT, name); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const doc = await io.read(join(labDir, m.glb)), log: string[] = [];
  const stage: any = (STAGE[name] = { shapes: {}, maps: {} });

  // 1. the dressed packages lose the lab's copy of the clay style
  if (def.kind === "dressed") {
    for (const n of doc.getRoot().listNodes()) if (n.getMesh() && CLAY_COPY.meshes.includes(n.getName())) { const mesh = n.getMesh()!; n.dispose(); for (const pr of mesh.listPrimitives()) { for (const t of pr.listTargets()) t.dispose(); pr.dispose(); } mesh.dispose(); }
    delete m.styles[CLAY_COPY.style];
    for (const st of Object.values<any>(m.styles)) { if (st.hide) st.hide = st.hide.filter((p: string) => !CLAY_COPY.meshes.some((x) => new RegExp("^" + p.replace(/\*/g, ".*") + "$").test(x))); if (st.hide && !st.hide.length) delete st.hide; }
    if (m.defaultStyle === CLAY_COPY.style) m.defaultStyle = "dressed";
    m.shape.bake = [m.shape.bake].flat().filter((b: Bake) => !b.meshes.some((x) => CLAY_COPY.meshes.includes(x)));
    if (typeof m.materials_note === "string" && m.materials_note.includes(CLAY_COPY.material)) delete m.materials_note;
    delete m.materials?.[CLAY_COPY.material];
    log.push(`left out the lab's copy of the clay style (${CLAY_COPY.meshes.join(", ")}); the clay figure is clay-${def.sex}`);
  }
  await doc.transform(prune({ propertyTypes: [PropertyType.MESH, PropertyType.ACCESSOR, PropertyType.MATERIAL, PropertyType.TEXTURE], keepAttributes: true, keepIndices: true, keepLeaves: true, keepSolidTextures: true, keepExtras: true }));

  // 2. vertices in fetch order (the manifest's vertex indices follow), then the shape files: rows in mesh order, quantised,
  //    encoded; _SRC renumbered; baked meshes' positions = the file's base exactly
  const ranks = reorderVertices(doc); remapVertexIndices(m, ranks, log);
  log.push(`vertices of ${ranks.size} meshes in fetch order (opaque triangles in vertex-cache order)`);
  const baked = new Set<string>(), bakes: Bake[] = [];
  for (const b0 of [m.shape.bake ?? []].flat() as Bake[]) {
    b0.meshes.forEach((x) => baked.add(x));
    const src = new Uint8Array(readFileSync(join(labDir, b0.file)));
    const { order, rank } = rowOrder(doc, b0), { bytes, block, base, raw } = packShape(src, b0, order);
    const file = b0.file.replace(def.lab, name); block.file = file;
    writeFileSync(join(out, file), bytes); stage.shapes[file] = raw; bakes.push(block);
    const off = b0.offset ?? [0, 0, 0];
    let moved = 0;
    for (const mn of b0.meshes) for (const p of meshPrims(doc, mn)) {
      const s = p.getAttribute("_SRC")!.getArray() as Float32Array, pos = p.getAttribute("POSITION")!.getArray() as Float32Array;
      if (!(s instanceof Float32Array)) throw new Error(`${mn}: _SRC is not float32`);
      for (let v = 0; v < s.length; v++) {
        const r = rank[s[v]]; s[v] = r;
        for (let c = 0; c < 3; c++) { const x = base[r * 3 + c] + off[c]; moved = Math.max(moved, Math.abs(x - pos[v * 3 + c])); pos[v * 3 + c] = x; }
      }
    }
    if (moved > 2e-5) throw new Error(`${b0.file}: the GLB's positions differ from the shape file's base by ${moved} m; they must be equal (FORMAT.md 2d)`);
    log.push(`${file}: ${src.byteLength} -> ${bytes.byteLength} bytes; worst delta rounding ${(block.quantisation as any).worst_m} m per unit weight; GLB positions within ${moved.toExponential(1)} m of the base`);
  }
  m.shape.bake = bakes.length === 1 && def.kind === "clay" ? bakes[0] : bakes;

  // 3. attributes, triangle order
  log.push(...roundAttributes(doc, baked));

  // 4. textures, and the tones as texture sets
  const uses = textureUses(doc), encoded: any[] = [];
  const toneImages = new Map<string, { t: Texture; keys: string[] }>();
  for (const [t, keys] of uses) for (const k of keys) toneImages.set(k, { t, keys });
  if (def.tones) {
    const list: any[] = [];
    for (const tone of def.tones) {
      const entry: any = { id: tone.id, label: tone.label, textures: {}, materials: {}, gltfMaterials: {} };
      const tm = JSON.parse(readFileSync(join(PKG, tone.lab, `${tone.lab}.avatar.json`), "utf8"));
      for (const k of Object.keys(tm.materials ?? {})) if (JSON.stringify(tm.materials[k]) !== JSON.stringify(m.materials[k]) || ["skin_body", "eye_ball"].includes(k)) entry.materials[k] = tm.materials[k];
      if (tone.lab !== def.lab) {
        const td = await io.read(join(PKG, tone.lab, tm.glb));
        for (const [t, keys] of textureUses(td)) {
          const mine = toneImages.get(keys[0]); if (!mine) throw new Error(`${tone.lab}: texture for ${keys[0]} has no counterpart`);
          if (sha256(t.getImage()!) === sha256(mine.t.getImage()!)) continue;
          const r = roleOf(keys[0]), file = `tones/${tone.id}/${keys[0].replace(".", "_")}.ktx2`;
          mkdirSync(join(out, "tones", tone.id), { recursive: true });
          writeFileSync(join(out, file), ktx2(t.getImage()!, t.getMimeType(), r.codec, r.srgb));
          for (const k of keys) entry.textures[k] = file;
        }
        for (const mt of td.getRoot().listMaterials()) {
          const mine = doc.getRoot().listMaterials().find((x) => x.getName() === mt.getName()); if (!mine) continue;
          const diff: any = {};
          if (JSON.stringify(mt.getBaseColorFactor()) !== JSON.stringify(mine.getBaseColorFactor())) diff.baseColorFactor = mt.getBaseColorFactor();
          if (mt.getRoughnessFactor() !== mine.getRoughnessFactor()) diff.roughnessFactor = mt.getRoughnessFactor();
          if (mt.getMetallicFactor() !== mine.getMetallicFactor()) diff.metallicFactor = mt.getMetallicFactor();
          if (JSON.stringify(mt.getEmissiveFactor()) !== JSON.stringify(mine.getEmissiveFactor())) diff.emissiveFactor = mt.getEmissiveFactor();
          if (Object.keys(diff).length) entry.gltfMaterials[mt.getName()] = diff;
        }
        entry.licence = tm.licence.filter((l: any) => !m.licence.some((x: any) => JSON.stringify(x) === JSON.stringify(l)));
      }
      list.push(entry);
    }
    // the default tone names the GLB's own values, so a viewer can switch back without keeping a copy
    for (const e of list.slice(1)) for (const g of Object.keys(e.gltfMaterials)) {
      const mine = doc.getRoot().listMaterials().find((x) => x.getName() === g)!, d: any = {};
      for (const k of Object.keys(e.gltfMaterials[g])) d[k] = (mine as any)["get" + k[0].toUpperCase() + k.slice(1)]();
      list[0].gltfMaterials[g] = { ...(list[0].gltfMaterials[g] ?? {}), ...d };
    }
    m.tones = {
      default: def.tones[0].id, list,
      note: "One geometry, three skin tones. textures: '<glTF material>.<slot>' -> a KTX2 file replacing that texture (none for the default tone: the GLB's own). materials: the complete manifest entries of those materials for the tone (replace, do not merge). gltfMaterials: glTF factors that differ between tones, for every tone including the default.",
    };
  }
  for (const [t, keys] of uses) encoded.push(encodeTexture(t, keys));

  // 5. side maps: masks and covers stay PNG (the viewer combines them on a canvas); normal maps become KTX2
  if (existsSync(join(labDir, "maps"))) mkdirSync(join(out, "maps"), { recursive: true });
  const rewrite = (p: string): string => {
    if (!p.startsWith("maps/")) return p;
    if (/^maps\/(mask|cover)_.*\.png$/.test(p)) { copyFileSync(join(labDir, p), join(out, p)); return p; }
    const shared = SHARED_MAPS.includes(p), dest = shared ? `../shared/maps/${basename(p).replace(/\.\w+$/, ".ktx2")}` : p.replace(/\.\w+$/, ".ktx2");
    const img = new Uint8Array(readFileSync(join(labDir, p))), r = roleOf(shared ? "side.detail" : "side.posed");
    const target = join(out, dest); mkdirSync(dirname(target), { recursive: true });
    if (shared && sharedSources.has(dest)) {
      if (sharedSources.get(dest) !== sha256(img)) throw new Error(`${dest}: the two sexes' copies differ; it cannot be shared`);
    } else { writeFileSync(target, ktx2(img, /\.png$/i.test(p) ? "image/png" : "image/jpeg", r.codec, r.srgb)); sharedSources.set(dest, sha256(img)); }
    stage.maps[dest] = p;
    return dest;
  };
  for (const slot of m.wardrobe?.slots ?? []) for (const g of slot.garments) for (const k of ["bodyMask", "cover"]) if (g[k]) g[k] = rewrite(g[k]);
  for (const mat of Object.values<any>(m.materials ?? {})) { if (mat?.detailNormal) mat.detailNormal = rewrite(mat.detailNormal); if (mat?.poseNormal?.posed) mat.poseNormal.posed = rewrite(mat.poseNormal.posed); }
  for (const t of m.tones?.list ?? []) for (const mat of Object.values<any>(t.materials ?? {})) { if (mat?.detailNormal) mat.detailNormal = rewrite(mat.detailNormal); }

  // 6. clips, poses, manifest
  for (const c of m.clips ?? []) {
    if (c.source && c.source !== "glb") { const d = clipPath(def.sex, c.source); clipSources.set(d, resolve(labDir, c.source)); c.source = d; }
    for (const [k, p] of Object.entries<string>(c.perBody ?? {})) { const d = clipPath(def.sex, p); clipSources.set(d, resolve(labDir, p)); c.perBody[k] = d; }
  }
  if (m.posesFile) copyFileSync(join(labDir, m.posesFile), join(out, m.posesFile));
  if (m.packet?.otherPackages) m.packet.otherPackages = m.packet.otherPackages.map((p: string) => p.replace(/abstract-([mf])/g, "clay-$1"));
  m.name = name; m.glb = `${name}.glb`;
  m.provenance = "PROVENANCE.json";
  m.packaging = { by: "tools/manikin-build/pack.ts", from: `the avatar lab's package ${def.lab}`, geometry: "EXT_meshopt_compression (no filters; lab data types kept)", textures: "KHR_texture_basisu (KTX2: ETC1S colour, UASTC normal and ORM)", shape: "meshopt-encoded shape files (shape.bake[].encoding)", clips: "EXT_meshopt_compression with quaternion and exponential filters", log };
  const glb = await writeGlb(doc);
  writeFileSync(join(out, m.glb), glb);
  writeFileSync(join(out, `${name}.avatar.json`), JSON.stringify(m) + "\n");   // compact: it is the largest text file of a person
  stage.textures = encoded;
  return { name, def, labDir, m, log };
}
const sharedSources = new Map<string, string>();

// ---------------------------------------------------------------------------------------------------------------------
// the Khronos glTF validator: its errors and warnings, less the ones that only say it cannot read meshopt or KTX2
export async function validatorIssues(bytes: Uint8Array): Promise<string[]> {
  const v = createRequire(import.meta.url)("gltf-validator"), rep = await v.validateBytes(bytes, { maxIssues: 500 });
  return [...new Set<string>(rep.issues.messages.filter((m: any) => m.severity <= 1 && m.code !== "IMAGE_UNRECOGNIZED_FORMAT" && !(m.code === "VALUE_NOT_IN_LIST" && /^\/images\/\d+\/mimeType$/.test(m.pointer ?? ""))).map((m: any) => `${m.code} ${m.pointer ?? ""}`))].sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// provenance and budgets
function labFiles(lab: string, tones: string[] | undefined) {
  const out: Record<string, { bytes: number; sha256: string }> = {};
  for (const pk of tones ?? [lab]) {
    const dir = join(PKG, pk), walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f), st = statSync(p, { throwIfNoEntry: false }); if (!st || f.startsWith(".")) continue; if (st.isDirectory()) { if (!["clips", "src"].includes(f)) walk(p); } else out[`packages/${relative(PKG, p)}`] = { bytes: st.size, sha256: sha256(new Uint8Array(readFileSync(p))) }; } };
    walk(dir);
  }
  return out;
}
function revision() { const r = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; }
function budgets(info: ReturnType<typeof packageInfo>, isDefault: boolean) {
  const lim = { bytes: num(isDefault ? "budget.default_person_bytes" : "budget.person_bytes"), tone: num("budget.tone_bytes"), tris: num("budget.triangles_per_outfit"), calls: num("budget.draw_calls_per_outfit"), gpu: num("budget.gpu_texture_bytes") };
  const problems: string[] = [];
  if (info.transferBytes > lim.bytes) problems.push(`download ${info.transferBytes} > ${lim.bytes} bytes (as sent; ${info.coreBytes} on disk)`);
  for (const [t, files] of Object.entries(info.tones)) { const b = files.reduce((s, f) => s + f.bytes, 0); if (b > lim.tone) problems.push(`tone ${t}: ${b} > ${lim.tone} bytes`); }
  for (const [s, st] of Object.entries(info.styles)) {
    if (st.triangles > lim.tris) problems.push(`style ${s}: ${st.triangles} > ${lim.tris} triangles`);
    if (st.drawCalls > lim.calls) problems.push(`style ${s}: ${st.drawCalls} > ${lim.calls} draw calls`);
    if (st.gpuTextureBytes > lim.gpu) problems.push(`style ${s}: ${st.gpuTextureBytes} > ${lim.gpu} GPU texture bytes`);
  }
  if (info.missing.length) problems.push(`missing files: ${info.missing.join(", ")}`);
  return { limits: lim, problems };
}

if (import.meta.main) {
  const t0 = performance.now();
  if (!existsSync(TOKTX)) { console.error(`toktx not found at ${TOKTX} (set MANIKIN_TOKTX)`); process.exit(1); }
  if (!existsSync(PKG)) { console.error(`lab packages not found at ${PKG} (set MANIKIN_LAB)`); process.exit(1); }
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  toktxVersionCached = toktxVersion();
  const only = opt("--only")?.split(",") ?? Object.keys(PACKAGES);
  const clipSources = new Map<string, string>(), done: Awaited<ReturnType<typeof packPackage>>[] = [];
  for (const name of only) { console.log(`packing ${name} …`); done.push(await packPackage(name, clipSources)); }

  // clips, once per sex (both styles name the same files)
  const clipReport: Record<string, { from: string; bytes: number; sha256: string; source_bytes: number; rotation_error: number; translation_error_m: number }> = {};
  if (!args.includes("--no-clips")) {
    for (const sex of new Set(done.map((d) => d.def.sex))) rmSync(join(OUT, "clips", sex), { recursive: true, force: true });
    for (const [dest, src] of [...clipSources].sort()) {
      const target = resolve(OUT, "operator-m", dest); mkdirSync(dirname(target), { recursive: true });
      const r = await packClip(src); writeFileSync(target, r.bytes);
      clipReport[rel(target).replace(/^assets\/manikin\//, "")] = { from: `packages/${relative(PKG, src)}`, bytes: r.bytes.byteLength, sha256: sha256(r.bytes), source_bytes: statSync(src).size, rotation_error: Number(r.rotErr.toExponential(2)), translation_error_m: Number(r.transErr.toExponential(2)) };
    }
    for (const sex of new Set(done.map((d) => d.def.sex))) {
      const files = Object.entries(clipReport).filter(([p]) => p.startsWith(`clips/${sex}/`));
      writeJson(join(OUT, "clips", sex, "PROVENANCE.json"), {
        what: `motion clips of the ${sex === "m" ? "men" : "women"}, baked per packet person on the lab's rig, shared by operator-${sex} and clay-${sex}`,
        sources: [{ what: "motion capture", source: "CMU Graphics Lab Motion Capture Database, http://mocap.cs.cmu.edu/", licence: "free for research; may be included in commercially sold products, not resold directly, even converted (http://mocap.cs.cmu.edu/, read 2026-11-24)", credit: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.", takes: "subjects 07, 79, 86 and 143: takes 07_01, 79_22, 79_76, 79_85, 86_15, 143_18, 143_21 (as downloaded and named in the lab clip notes)" }, { what: "retargeting, seated-operator layer, baking per body", source: "the avatar lab's motion builder (tools/manikin-build/pipeline/motion.py)", licence: "the project's own work" }],
        built: { lab_commands: [`$PY -I pipeline/motion.py build --package packages/${sex === "m" ? "body-clay" : "body-clay-f"}`, `$PY -I pipeline/motion.py bake --package packages/${sex === "m" ? "body-clay" : "body-clay-f"}`, `$PY -I pipeline/motion.py stand --package packages/${sex === "m" ? "body-clay --also packages/abstract-m" : "body-clay-f --also packages/abstract-f"}`, "$PY -I pipeline/build_body.py --merge-motion"], pack: "bun tools/manikin-build/pack.ts", settings: { "clips.rotation_bits": num("clips.rotation_bits"), "clips.translation_bits": num("clips.translation_bits") } },
        repository_revision: revision(),
        files: Object.fromEntries(files),
        bytes: files.reduce((s, [, f]) => s + f.bytes, 0),
      });
    }
  }

  // provenance per package, and the budgets
  let failed = 0;
  for (const d of done) {
    const info = packageInfo(join(OUT, d.name), d.name), isDefault = d.name === "operator-m", b = budgets(info, isDefault);
    const files: Record<string, { bytes: number; sha256: string }> = {};
    const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (f !== "PROVENANCE.json") files[relative(join(OUT, d.name), p)] = { bytes: statSync(p).size, sha256: sha256(new Uint8Array(readFileSync(p))) }; } };
    walk(join(OUT, d.name));
    for (const f of info.core.filter((x) => x.path.startsWith("../"))) files[f.path] = { bytes: f.bytes, sha256: f.sha256 };
    const tones = d.def.tones?.map((t) => t.lab);
    const vNow = await validatorIssues(new Uint8Array(readFileSync(join(OUT, d.name, `${d.name}.glb`)))), vLab = await validatorIssues(new Uint8Array(readFileSync(join(PKG, d.def.lab, d.m.glb.replace(d.name, d.def.lab)))));
    writeJson(join(OUT, d.name, "PROVENANCE.json"), {
      package: d.name,
      what: d.def.kind === "dressed" ? `the dressed operator (${d.def.sex === "m" ? "man" : "woman"}), three skin tones on one geometry; passed by the visual designer in VD/REVIEW-10 (L4- at 1.5-4 m, L3 head at 1.2 m)` : `the clay figure (${d.def.sex === "m" ? "man" : "woman"}); passed by the visual designer in VD/REVIEW-08 (L3, the mannequin class)`,
      from: { lab: `work/avatar-lab/packages/${d.def.lab}${tones && tones.length > 1 ? ` (tones: ${tones.join(", ")})` : ""}`, lab_built: d.m.build?.by ?? d.m.build?.style?.by ?? null, lab_files: labFiles(d.def.lab, tones), repository_revision: revision(), note: "The lab is the project's working folder (work/, never committed); the SHA-256 of every lab file read identifies the version packed. The lab build code is in tools/manikin-build/pipeline/." },
      sources: [...(d.m.licence ?? []), ...(d.m.tones?.list ?? []).flatMap((t: any) => t.licence ?? []), ...(d.def.kind === "dressed" ? [{ what: "fabric weave detail normal maps (shared/maps/)", source: "Poly Haven: denim_fabric_04, rough_linen (nor_gl, 1k)", licence: "CC0-1.0", verified: "All assets on Poly Haven are CC0 (polyhaven.com/license)" }, { what: "headset, collar band, safety trainer (props)", source: "the avatar lab's prop builder (pipeline/props.py)", licence: "the project's own work" }] : []), { what: "motion clips", source: `../clips/${d.def.sex}/PROVENANCE.json`, licence: "CMU motion capture terms" }],
      credits: "../CREDITS.md",
      built: {
        lab_commands: d.def.kind === "dressed"
          ? ["$PY -I pipeline/build_body.py", `$PY -I pipeline/build_operator.py ${d.def.sex} light`, `$PY -I pipeline/build_operator.py ${d.def.sex} medium --name ${d.def.lab}-medium --out packages/${d.def.lab}-medium`, `$PY -I pipeline/build_operator.py ${d.def.sex} dark --name ${d.def.lab}-dark --out packages/${d.def.lab}-dark`]
          : ["$PY -I pipeline/build_body.py", `$PY -I pipeline/motion.py build --package packages/${d.def.sex === "m" ? "body-clay" : "body-clay-f"}`, `$PY -I pipeline/abstract.py --sex ${d.def.sex}`],
        pack: `bun tools/manikin-build/pack.ts --only ${d.name}`,
        tools: { "@gltf-transform/core": "4.5.1", "@gltf-transform/functions": "4.5.1", "@gltf-transform/extensions": "4.5.1", meshoptimizer: "1.1.1", toktx: toktxVersionCached },
        settings: Object.fromEntries([...P.records.values()].filter((r) => !r.key.startsWith("budget.")).map((r) => [r.key, r.given])),
        textures: STAGE[d.name].textures,
        log: d.log,
      },
      validator: { accepted: vNow, lab: vLab, note: "Khronos glTF validator 2.0.0-dev.3.10 errors and warnings (less 'cannot read meshopt / KTX2'). The lab GLB has the same ones (eyeballs: a base-colour texture the eye recipe maps itself, without TEXCOORD_0; normal maps without tangents, which three.js generates); `bun run check` fails on any other." },
      files,
      budget: { transfer_bytes: info.transferBytes, core_bytes: info.coreBytes, core: info.core, tones: Object.fromEntries(Object.entries(info.tones).map(([k, f]) => [k, f.reduce((s, x) => s + x.bytes, 0)])), styles: info.styles, totals: info.totals, limits: b.limits, problems: b.problems },
    });
    const st = Object.entries(info.styles).map(([s, x]) => `${s}: ${x.triangles} triangles, ${x.drawCalls} draw calls, ${(x.gpuTextureBytes / 1e6).toFixed(1)} MB GPU textures`).join("; ");
    console.log(`${d.name}: ${(info.transferBytes / 1e6).toFixed(2)} MB to download, ${(info.coreBytes / 1e6).toFixed(2)} MB on disk (${info.core.map((f) => `${f.path} ${(f.bytes / 1e6).toFixed(2)}`).join(", ")}); ${st}${Object.keys(info.tones).length ? "; tones " + Object.entries(info.tones).map(([k, f]) => `${k} ${(f.reduce((s, x) => s + x.bytes, 0) / 1e6).toFixed(2)} MB`).join(", ") : ""}`);
    for (const p of b.problems) { console.log(`  OVER BUDGET: ${p}`); failed++; }
  }
  // the stage record for compare.ts (lab-format shape files and side-map sources), kept under work/
  const stageDir = join(ROOT, "work", "manikin-pack", "stage-data"); mkdirSync(stageDir, { recursive: true });
  for (const [name, s] of Object.entries(STAGE)) { for (const [f, raw] of Object.entries<Uint8Array>(s.shapes)) writeFileSync(join(stageDir, `${name}--${f}`), raw); writeJson(join(stageDir, `${name}.json`), { maps: s.maps, shapes: Object.keys(s.shapes), lab: PACKAGES[name].lab }); }
  const clipBytes = Object.values(clipReport).reduce((s, c) => s + c.bytes, 0);
  if (Object.keys(clipReport).length) console.log(`clips: ${Object.keys(clipReport).length} files, ${(clipBytes / 1e6).toFixed(2)} MB; worst rotation error ${Math.max(...Object.values(clipReport).map((c) => c.rotation_error)).toExponential(1)}, translation ${Math.max(...Object.values(clipReport).map((c) => c.translation_error_m)).toExponential(1)} m`);
  console.log(`pack ${failed ? "FAILED (over budget)" : "done"} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(failed ? 1 : 0);
}
