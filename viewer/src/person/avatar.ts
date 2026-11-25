// One person in the product viewer: an avatar package (work/avatar-lab/FORMAT.md v0.5, and the product packages of
// assets/manikin/: meshopt geometry, KTX2 textures, meshopt shape files, tones) loaded, shaped, posed and dressed. Ported from
// the lab's `Avatar` class (work/avatar-lab/viewer/src/main.ts), the code whose look the designer passed:
//   loader (GLTFLoader with MeshoptDecoder and KTX2Loader) · CPU shape bake from the measurement controls · joint deltas and
//   inverse bind matrices · dof poses · twist and corrective drivers, sign-safe (a joint quaternion with w < 0 is read as the
//   same rotation) · eight influences per vertex · dual-quaternion skinning by the `_DQS` mask (shaders.ts) · styles (dressed,
//   clay) · wardrobe with per-pixel body masks · tones · the seated-operator layer, the eyes and the cloth pose as plug-ins ·
//   seat and backrest contact (contact.ts).
// Clips (ported 2026-11-25 on the coordinator's decision): loaded on demand, per-body takes preferred (`perBody`, by the baked
// person the body matches), otherwise the base take with its root translation scaled by leg length; sampled at a time (stills)
// or played (live views); the same sign-safe drivers run after them.
// Left out of the port: the debug views (gltf, clay, wire, checker, skeleton, weights), the plain stool, the stand-in props,
// several people at once.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as MAT from "./materials.ts";
import { Contact, closestOnSegments, type Capsule } from "./contact.ts";
import { newPersonUniforms, personDepthMaterial, CAPSULES, type PersonUniforms } from "./shaders.ts";
import { Operator, defaultTargets, standInProps, adoptHandPoses, SCRIPTS, STILL_SETTLE, FIT_KEY_TOLERANCE, type Q, type Controls } from "./operator.ts";
import { eyes } from "./eyes.ts";
import { clothPose } from "./cloth-pose.ts";
import { T3, type Plugin, type FrameContext } from "./plugins.ts";
import type { RigBinding } from "./types.ts";
import { deriveBodyFit, hasModel } from "./body-fit.ts";
import { section } from "./params.ts";

const STYLE = section("materials").style, ANCH = section("anchors"), GROUND = section("ground"), HANDS = section("operator").hand;
interface Dof { id: string; joint: string; axis: number[]; min: number; max: number; label?: string; group?: string }

let ktx2: KTX2Loader | null = null;
/** The loaders, made once per page: three's own decoders (the KTX2 transcoder is served at `transcoder`, the meshopt decoder is in this chunk). */
export function makeLoaders(renderer: THREE.WebGLRenderer, transcoder: string) {
  ktx2 ??= new KTX2Loader().setTranscoderPath(transcoder).detectSupport(renderer);
  const gltf = new GLTFLoader(); gltf.setMeshoptDecoder(MeshoptDecoder); gltf.setKTX2Loader(ktx2);
  return { gltf, ktx2 };
}

/** Eight influences per vertex (lab dqs.ts loadSecondInfluences): a package keeps a complete four-influence set in JOINTS_0 /
 *  WEIGHTS_0 and may add the full eight as a separate whole set in _JOINTS8_0/1, _WEIGHTS8_0/1; then the person is skinned with
 *  that set INSTEAD of set 0. Every other skinned mesh gets a zero second weight set (a missing attribute reads 1 in WebGL). */
const zeroWeights = new Map<number, THREE.BufferAttribute>();
const zeros = (c: number) => { let z = zeroWeights.get(c); if (!z) { z = new THREE.BufferAttribute(new Uint8Array(c * 4), 4, true); zeroWeights.set(c, z); } return z; };
async function secondInfluences(gltf: any, meshes: THREE.SkinnedMesh[]) {
  for (const me of meshes) {
    const g = me.geometry; if (g.userData.set4) continue;
    g.userData.set4 = { skinIndex: g.attributes.skinIndex, skinWeight: g.attributes.skinWeight, skinWeight1: zeros(g.attributes.position.count) };
    const A = g.attributes as any;
    if (A._joints8_0 && A._joints8_1 && A._weights8_0 && A._weights8_1) g.userData.set8 = { skinIndex: A._joints8_0, skinWeight: A._weights8_0, skinIndex1: A._joints8_1, skinWeight1: A._weights8_1 };
    else {
      const a = gltf?.parser.associations.get(me), prim = a && gltf.parser.json.meshes[a.meshes]?.primitives[a.primitives ?? 0], j = prim?.attributes.JOINTS_1, w = prim?.attributes.WEIGHTS_1;
      if (j !== undefined && w !== undefined) {
        const w1: THREE.BufferAttribute = await gltf.parser.getDependency("accessor", w), w0 = (g.attributes.skinWeight as THREE.BufferAttribute).clone();
        for (let i = 0; i < w0.count; i++) { const s1 = w1.getX(i) + w1.getY(i) + w1.getZ(i) + w1.getW(i), k = Math.max(0, 1 - s1); w0.setXYZW(i, w0.getX(i) * k, w0.getY(i) * k, w0.getZ(i) * k, w0.getW(i) * k); }
        g.userData.set8 = { skinIndex: g.attributes.skinIndex, skinWeight: w0, skinIndex1: await gltf.parser.getDependency("accessor", j), skinWeight1: w1 };
      }
    }
    const set = g.userData.set8 ?? g.userData.set4;
    for (const [k, v] of Object.entries(set)) g.setAttribute(k, v as THREE.BufferAttribute);
    if (!set.skinIndex1) g.deleteAttribute("skinIndex1");
  }
}

export class Avatar {
  manifest: any; base = ""; root!: THREE.Object3D; holder = new THREE.Group(); meshes: THREE.SkinnedMesh[] = []; skeletons: THREE.Skeleton[] = []; bones = new Map<string, THREE.Bone>();
  restQ = new Map<string, THREE.Quaternion>(); baseLocalP = new Map<string, THREE.Vector3>(); baseWorldP = new Map<string, THREE.Vector3>(); restWorldQ = new Map<string, THREE.Quaternion>();
  nowWorldP = new Map<string, THREE.Vector3>(); nowLocalP = new Map<string, THREE.Vector3>();
  shape: Record<string, number> = {}; weights: Record<string, number> = {}; measures: Record<string, number> = {};
  dofs: Dof[] = []; dofById = new Map<string, Dof>(); dofValues: Record<string, number> = {}; dofsByJoint = new Map<string, Dof[]>();
  rootBone!: THREE.Bone; legScale = 1; mode: "pose" | "clip" = "pose"; time = 0; seated = false;
  contact = new Contact(); U: PersonUniforms = newPersonUniforms(this.contact.tex);
  plugins: Plugin[] = [operatorPlugin(this), clothPose, eyes]; pluginState = new Map<string, Record<string, any>>();
  binding: RigBinding | null = null; ready = false; bakeMs = 0; swapMs = 0; unknownDrivers: string[] = [];
  private gltfLoader!: GLTFLoader; private texCache = new Map<string, Promise<THREE.Texture>>();
  constructor(private renderer: THREE.WebGLRenderer, private transcoder: string) { this.holder.name = "person"; this.holder.userData.notInIds = true; }

  /** A side file of the package, relative to its manifest: KTX2 through the KTX2 loader, PNG or JPEG through the image loader. */
  load = (path: string): Promise<THREE.Texture> => {
    const url = new URL(path, new URL(this.base, location.href)).href;
    let p = this.texCache.get(url);
    if (!p) { p = /\.ktx2(\?|$)/i.test(url) ? makeLoaders(this.renderer, this.transcoder).ktx2.loadAsync(url) : new THREE.TextureLoader().loadAsync(url); this.texCache.set(url, p); }
    return p;
  };
  async loadPackage(url: string) {
    this.base = url.slice(0, url.lastIndexOf("/") + 1);
    const r = await fetch(url); if (!r.ok) throw new Error(`the person's package answered ${r.status} (${url})`);
    this.manifest = await r.json();
    const m = this.manifest;
    this.gltfLoader = makeLoaders(this.renderer, this.transcoder).gltf;
    await MeshoptDecoder.ready;
    const gltf = await this.gltfLoader.loadAsync(this.base + m.glb);
    // the rest pose is captured in the package's own frame (the holder is placed in the rig only afterwards)
    this.root = gltf.scene; this.root.updateMatrixWorld(true);
    this.root.traverse((o: any) => {
      if (o.isMesh) { o.castShadow = !(o.material?.transparent || o.material?.transmission > 0 || /^(cornea|lens)/i.test(o.material?.name ?? "") || /^(eyeball|eye_wetline|clay_eyeball|lashes)/i.test(o.name ?? ""));      // clear shells and the eyeballs cast no shadow; the alpha-blended lash cards neither (a solid quad in the map)
        o.receiveShadow = true; o.frustumCulled = false; }
      if (o.isSkinnedMesh) { this.meshes.push(o); if (!this.skeletons.includes(o.skeleton)) this.skeletons.push(o.skeleton); }
    });
    for (const s of this.skeletons) for (const b of s.bones) this.bones.set(b.name, b);
    await secondInfluences(gltf, this.meshes);
    this.buildContactMasks();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const [n, b] of this.bones) {
      b.matrixWorld.decompose(p, q, sc);
      this.restQ.set(n, b.quaternion.clone()); this.baseLocalP.set(n, b.position.clone()); this.baseWorldP.set(n, p.clone()); this.restWorldQ.set(n, q.clone());
      this.nowWorldP.set(n, p.clone()); this.nowLocalP.set(n, b.position.clone());
    }
    this.rootBone = [...this.bones.values()].find((b) => !(b.parent as any)?.isBone)!;
    this.holder.add(this.root);
    for (const me of this.meshes) me.customDepthMaterial = personDepthMaterial(this.U);
    for (const c of m.shape.controls) this.shape[c.id] = c.default ?? 0;
    await this.loadBakes();
    this.dofs = m.dofs ?? [];
    for (const d of this.dofs) { this.dofById.set(d.id, d); this.dofValues[d.id] = 0; if (!this.dofsByJoint.has(d.joint)) this.dofsByJoint.set(d.joint, []); this.dofsByJoint.get(d.joint)!.push(d); }
    const unknown = [...new Set((m.drivers ?? []).map((d: any) => d.type).filter((t: string) => !["twist", "morph", "morphPose"].includes(t)))];
    if (unknown.length) { this.unknownDrivers = unknown as string[]; console.warn(`package ${m.name}: driver type(s) not implemented and ignored: ${unknown.join(", ")}`); }
    if (m.posesFile && !m.poses) { const pr = await fetch(this.base + m.posesFile); if (pr.ok) m.poses = await pr.json(); }
    m.poses ??= [{ name: "Rest", dofs: {} }];
    this.applyShape();
    // styles and wardrobe; a package without them still gets "dressed" and "clay"
    m.styles ??= { dressed: { label: "Dressed" }, clay: { label: "Clay figure", wardrobe: false, show: this.meshes.filter((me) => me.userData.cls === "skin").map((me) => me.name), material: { color: STYLE.color, roughness: STYLE.roughness } } };
    for (const slot of this.slots) this.worn[slot.id] = { garment: slot.default ?? (slot.allowNone ? null : slot.garments[0]?.id ?? null), colourway: null };
    this.style = m.defaultStyle ?? Object.keys(m.styles)[0];
    this.tone = m.tones?.default ?? "";
    this.buildMaterials();
    if (m.tones?.list?.some((x: any) => x.id === this.tone)) await this.setTone(this.tone);     // the default tone's glTF factors and materials
    await this.refreshWardrobe();
    for (const pl of this.plugins) await pl.init?.(this.context(pl, 0));
    this.ready = true;
  }
  // ---- contact capsules (FORMAT.md 2f): end points from the posed joints, in this person's own frame; radii from the manifest
  capsulesNow(): Capsule[] {
    const C = this.manifest.contact; if (!C?.capsules?.length) return [];
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert(), P = (j: string) => { const b = this.bones.get(j); return b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv) : null; };
    const K = section("contact").capsules;
    const rad = (r: any, c: any, k: number) => { let v = typeof r === "number" ? r : (this.measures[r.measure] ?? 0) / 1000 * (r.factor ?? 1) + (r.add ?? 0); if (typeof r !== "number" && this.measures[r.measure] === undefined) v = r.fallback ?? K.radius_fallback;
      for (const [t, d] of Object.entries<number[]>(c.radiusPerTarget ?? {})) v += (this.weights[t] ?? 0) * d[k]; return v; };
    const made = new Map<string, Capsule & { def: any }>();
    for (const c of C.capsules.slice(0, CAPSULES)) {
      const f = P(c.from), t = P(c.to); if (!f || !t) continue; const sp = c.span ?? [0, 1];
      made.set(c.id, { def: c, a: f.clone().lerp(t, sp[0]), b: f.clone().lerp(t, sp[1]), ra: rad(c.radius[0], c, 0) + (c.skin ?? 0), rb: rad(c.radius[1], c, 1) + (c.skin ?? 0), channel: c.receivers === "x" ? 0 : c.receivers === "y" ? 1 : 2, knee: c.knee ?? K.knee, self: new THREE.Vector3() });
    }
    for (const c of made.values()) { const o = c.def.against && made.get(c.def.against); if (!o) continue;
      const [s, t] = closestOnSegments(c.a, c.b, o.a, o.b), pc = c.a.clone().lerp(c.b, s), po = o.a.clone().lerp(o.b, t), v = po.sub(pc), dist = v.length();
      const overlap = THREE.MathUtils.lerp(c.ra, c.rb, s) + THREE.MathUtils.lerp(o.ra, o.rb, t) - dist;
      if (overlap > 0 && dist > 1e-5) c.self.copy(v).multiplyScalar(Math.min(overlap, K.flatten_max) * (c.def.flatten ?? K.flatten) / dist); }
    return [...made.values()];
  }
  /** Until the meshes carry `_CONTACT`: the masks from skin weights, as the manifest's `contact.masksFromWeights` says. */
  buildContactMasks() {
    const M = this.manifest.contact?.masksFromWeights; if (!M) return;
    for (const me of this.meshes) { const g = me.geometry; if (g.getAttribute("_contact") && !g.userData.contactFromWeights) continue;
      const set = g.userData.set8 ?? g.userData.set4 ?? { skinIndex: g.attributes.skinIndex, skinWeight: g.attributes.skinWeight }, n = g.attributes.position.count, out = new Float32Array(n * 4);
      const table = ["x", "y", "z"].map((ch) => me.skeleton.bones.map((b) => M[ch]?.[b.name] ?? 0));
      for (const [ji, wi] of [[set.skinIndex, set.skinWeight], [set.skinIndex1, set.skinWeight1]]) { if (!ji || !wi) continue;
        for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const w = wi.getComponent(i, k); if (!w) continue; const j = ji.getComponent(i, k); for (let c = 0; c < 3; c++) out[i * 4 + c] += w * table[c][j]; } }
      for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i]);
      g.setAttribute("_contact", new THREE.BufferAttribute(out, 4)); g.userData.contactFromWeights = true; }
  }
  context(p: Plugin, dt: number): FrameContext {
    let st = this.pluginState.get(p.name); if (!st) { st = { ...(p.state ?? {}) }; this.pluginState.set(p.name, st); }
    return { THREE: T3, dt, manifest: this.manifest, bones: this.bones, rootBone: this.rootBone, root: this.root, restQ: this.restQ, restWorldP: this.nowWorldP, restWorldP0: this.baseWorldP, dofValues: this.dofValues, mode: this.mode, clip: this.clipName, time: this.action ? this.action.time : this.time, legScale: this.legScale,
      seated: this.seated, anchor: (n: string) => this.anchor(n), load: this.load, state: st };
  }
  state(name: string) { return this.context(this.plugins.find((p) => p.name === name)!, 0).state; }
  // ---- shape baked on the CPU (FORMAT.md 2d): positions and normals of the listed meshes are rewritten when a control moves.
  // Files: the lab's raw layout (float32 base[N*3], then int16 targets[K][N*3]) or MP's meshopt encoding of the same numbers.
  private bakes: { N: number; names: string[]; scales: number[]; base: Float32Array; deltas: Int16Array; work: Float32Array; nrm: Float32Array; meshes: { me: THREE.SkinnedMesh; src: ArrayLike<number> | null }[] }[] = [];
  meshNamed(n: string) { return this.meshes.filter((me) => me.name === n || me.name.replace(/_\d+$/, "") === n); }
  async loadBakes() {
    for (const b of [this.manifest.shape.bake ?? []].flat()) {
      const r = await fetch(this.base + b.file); if (!r.ok) throw new Error(`shape file ${b.file} answered ${r.status}`);
      const buf = await r.arrayBuffer(), N = b.vertices, K = b.targets.length;
      let base: Float32Array, deltas: Int16Array;
      if (b.encoding === "meshopt") {
        const D: any = MeshoptDecoder, src = (v: any) => new Uint8Array(buf, v.byteOffset, v.byteLength);
        const B = new Uint8Array(N * 12); D.decodeGltfBuffer(B, N, 12, src(b.base), "ATTRIBUTES"); base = new Float32Array(B.buffer).slice();
        const T = new Uint8Array(K * N * 8); D.decodeGltfBuffer(T, K * N, 8, src(b.deltas), "ATTRIBUTES"); const t4 = new Int16Array(T.buffer);
        deltas = new Int16Array(K * N * 3); for (let i = 0, j = 0; i < K * N; i++, j += 4) { deltas[i * 3] = t4[j]; deltas[i * 3 + 1] = t4[j + 1]; deltas[i * 3 + 2] = t4[j + 2]; }
      } else {
        if (buf.byteLength < N * 12 + K * N * 6) throw new Error(`${b.file}: too short for ${N} vertices and ${K} targets`);
        base = new Float32Array(buf, 0, N * 3).slice(); deltas = new Int16Array(buf.slice(N * 12, N * 12 + K * N * 6));
      }
      if (b.frame === "blender") {            // +x left, -y forward, +z up  ->  +x left, +y up, +z forward
        for (let i = 0; i < N * 3; i += 3) { const y = base[i + 1]; base[i + 1] = base[i + 2]; base[i + 2] = -y; }
        for (let i = 0; i < K * N * 3; i += 3) { const y = deltas[i + 1]; deltas[i + 1] = deltas[i + 2]; deltas[i + 2] = -y === 32768 ? 32767 : -y; }
      }
      const o = b.offset ?? [0, 0, 0]; for (let i = 0; i < N * 3; i += 3) { base[i] += o[0]; base[i + 1] += o[1]; base[i + 2] += o[2]; }
      const meshes = (b.meshes ?? ["body"]).flatMap((n: string) => this.meshNamed(n)).map((me: THREE.SkinnedMesh) => { const a = me.geometry.getAttribute("_src"); if (!a && me.geometry.attributes.position.count !== N) throw new Error(`mesh ${me.name}: no _SRC attribute and its vertex count is not ${N}`); return { me, src: a ? (a.array as ArrayLike<number>) : null }; });
      for (const { me, src } of meshes) { const c = me.geometry.attributes.position.count, bb = new Float32Array(c * 3); for (let v = 0; v < c; v++) { const s = (src ? src[v] : v) * 3; bb[v * 3] = base[s]; bb[v * 3 + 1] = base[s + 1]; bb[v * 3 + 2] = base[s + 2]; } me.geometry.userData.bakeBase = bb; }   // rest positions of the base shape (eyes.ts finds its lid vertices by them)
      this.bakes.push({ N, names: b.targets, scales: b.targetScale ?? b.targets.map(() => 1), base, deltas, work: new Float32Array(N * 3), nrm: new Float32Array(N * 3), meshes });
    }
  }
  applyBakes(w: Record<string, number>) {
    const t0 = performance.now();
    for (const b of this.bakes) {
      const P = b.work, n3 = b.N * 3; P.set(b.base);
      b.names.forEach((name, k) => { const f = (w[name] ?? 0) * b.scales[k] / 32767; if (!f) return; const d = b.deltas, off = k * n3; for (let i = 0; i < n3; i++) P[i] += f * d[off + i]; });
      for (const { me, src } of b.meshes) {
        const g = me.geometry, pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute, pa = pos.array as Float32Array, na = nor.array as Float32Array, idx = g.index!.array, S = (v: number) => (src ? src[v] : v) * 3, Nn = b.nrm;
        for (let v = 0; v < pos.count; v++) { const s = S(v); pa[v * 3] = P[s]; pa[v * 3 + 1] = P[s + 1]; pa[v * 3 + 2] = P[s + 2]; }
        // normals on the source topology (area-weighted), so vertices split at UV seams share one normal
        Nn.fill(0);
        for (let f = 0; f < idx.length; f += 3) { const a = S(idx[f]), bb = S(idx[f + 1]), c = S(idx[f + 2]);
          const ux = P[bb] - P[a], uy = P[bb + 1] - P[a + 1], uz = P[bb + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          Nn[a] += nx; Nn[a + 1] += ny; Nn[a + 2] += nz; Nn[bb] += nx; Nn[bb + 1] += ny; Nn[bb + 2] += nz; Nn[c] += nx; Nn[c + 1] += ny; Nn[c + 2] += nz; }
        for (let v = 0; v < pos.count; v++) { const s = S(v), l = Math.hypot(Nn[s], Nn[s + 1], Nn[s + 2]) || 1; na[v * 3] = Nn[s] / l; na[v * 3 + 1] = Nn[s + 1] / l; na[v * 3 + 2] = Nn[s + 2] / l; }
        pos.needsUpdate = true; nor.needsUpdate = true;
        g.userData.bake = { version: (g.userData.bake?.version ?? 0) + 1, position: pa.slice() };     // for the eye module's lid lift
      }
    }
    this.bakeMs = performance.now() - t0;
  }
  // ---- styles, wardrobe, tones
  worn: Record<string, { garment: string | null; colourway: string | null }> = {}; style = ""; tone = ""; styleMat: THREE.MeshPhysicalMaterial | null = null;
  maskU = { value: MAT.NO_MASK as THREE.Texture }; private maskKey = ""; private sideLoaded = new Set<string>();
  get slots(): any[] { return this.manifest.wardrobe?.slots ?? []; }
  get hasMasks() { return this.slots.some((s) => s.garments.some((g: any) => g.bodyMask)); }
  /** `sel`: { slot: garmentId | null | "none" | { garment, colourway } }, or the id of one of the manifest's outfits. */
  async wear(sel: any) {
    if (typeof sel === "string") sel = (this.manifest.wardrobe?.outfits ?? []).find((o: any) => o.id === sel)?.wear ?? {};
    for (const [slot, v] of Object.entries<any>(sel)) {
      const def = this.slots.find((s) => s.id === slot); if (!def) throw new Error(`no wardrobe slot '${slot}' (${this.slots.map((s) => s.id).join(", ")})`);
      const next = v === null || typeof v === "string" ? { garment: v === "none" ? null : v, colourway: null } : { garment: v.garment ?? null, colourway: v.colourway ?? null };
      if (next.garment === null && !def.allowNone) throw new Error(`the ${def.label ?? slot} cannot be taken off`);
      this.worn[slot] = next;
    }
    await this.refreshWardrobe();
  }
  async setStyle(id: string) { if (!this.manifest.styles[id]) throw new Error(`no style '${id}' (${Object.keys(this.manifest.styles).join(", ")})`); this.style = id; await this.refreshWardrobe(); }
  /** Tones (MP's block): `tones.list[i].textures` maps "<glTF material>.<slot>" to a KTX2 file; `materials` replaces the manifest's entries
   *  of those materials. The default tone keeps the GLB's own textures. */
  async setTone(id: string) {
    const T = this.manifest.tones; if (!T) { if (id) throw new Error("this package has no tones"); return; }
    const t = T.list.find((x: any) => x.id === id); if (!t) throw new Error(`no tone '${id}' (${T.list.map((x: any) => x.id).join(", ")})`);
    const SLOT: Record<string, string> = { baseColor: "map", baseColorTexture: "map", normal: "normalMap", normalTexture: "normalMap", metallicRoughness: "roughnessMap", metallicRoughnessTexture: "roughnessMap", occlusion: "aoMap", occlusionTexture: "aoMap", emissive: "emissiveMap", emissiveTexture: "emissiveMap" };
    const mats = new Set<string>();
    for (const me of this.meshes) { const src: any = me.userData.src; if (!src) continue; src.userData.toneOrig ??= Object.fromEntries(Object.values(SLOT).map((k) => [k, src[k]]).concat([["metalnessMap", src.metalnessMap]])); src.userData.toneFactors ??= { color: src.color?.clone(), opacity: src.opacity, roughness: src.roughness, metalness: src.metalness, emissive: src.emissive?.clone() }; }
    for (const me of this.meshes) { const src: any = me.userData.src; if (!src) continue; for (const [k, v] of Object.entries(src.userData.toneOrig)) src[k] = v;
      const f = src.userData.toneFactors; if (f.color) src.color.copy(f.color); src.opacity = f.opacity; src.roughness = f.roughness; src.metalness = f.metalness; if (f.emissive) src.emissive.copy(f.emissive); }
    // glTF factors that differ by tone (MP: given for every tone, the default included): baseColorFactor (linear RGBA), roughnessFactor, metallicFactor, emissiveFactor
    for (const [mat, g] of Object.entries<any>(t.gltfMaterials ?? {})) for (const me of this.meshes) { const src: any = me.userData.src; if (src?.name !== mat) continue;
      if (g.baseColorFactor) { src.color.setRGB(g.baseColorFactor[0], g.baseColorFactor[1], g.baseColorFactor[2], THREE.LinearSRGBColorSpace); src.opacity = g.baseColorFactor[3] ?? 1; }
      if (g.roughnessFactor !== undefined) src.roughness = g.roughnessFactor; if (g.metallicFactor !== undefined) src.metalness = g.metallicFactor;
      if (g.emissiveFactor && src.emissive) src.emissive.setRGB(g.emissiveFactor[0], g.emissiveFactor[1], g.emissiveFactor[2], THREE.LinearSRGBColorSpace);
      mats.add(mat); }
    for (const [key, file] of Object.entries<string>(t.textures ?? {})) {
      const [mat, slot] = [key.slice(0, key.lastIndexOf(".")), key.slice(key.lastIndexOf(".") + 1)], tex = await this.load(file), prop = SLOT[slot];
      if (!prop) throw new Error(`tone ${id}: unknown texture slot '${slot}'`);
      tex.flipY = false; tex.colorSpace = prop === "map" || prop === "emissiveMap" ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex.needsUpdate = true;
      for (const me of this.meshes) { const src: any = me.userData.src; if (src?.name !== mat) continue; src[prop] = tex; if (prop === "roughnessMap") { src.metalnessMap = tex; if (src.userData.toneOrig.aoMap) src.aoMap = tex; } mats.add(mat); }   // ORM: roughness and metalness, and occlusion where the default tone has an occlusion map (not on the skin: the lab drew it without)
    }
    this.toneMaterials = t.materials ?? {};
    for (const k of Object.keys(this.toneMaterials)) mats.add(k);
    this.tone = id;
    this.buildMaterials(this.meshes.filter((me) => mats.has(me.userData.src?.name)).length ? undefined : []);
    await this.refreshWardrobe();
  }
  private toneMaterials: Record<string, any> = {};
  async refreshWardrobe() {
    const t0 = performance.now(), st = this.manifest.styles[this.style] ?? {}, dressed = st.wardrobe !== false;
    const hidden = new Set<THREE.Object3D>(), masks: string[] = [], glob = (p: string, n: string) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "(_\\d+)?$").test(n);
    for (const slot of this.slots) for (const g of slot.garments) {
      const w = this.worn[slot.id], on = dressed && w?.garment === g.id;
      if (on && g.source && !this.sideLoaded.has(g.source)) await this.loadSide(g.source);
      if (!on) for (const n of g.meshes ?? []) for (const me of this.meshNamed(n)) hidden.add(me);
    }
    for (const slot of this.slots) for (const g of slot.garments) {
      const w = this.worn[slot.id]; if (!(dressed && w?.garment === g.id)) continue;
      for (const n of g.hides ?? []) for (const me of this.meshNamed(n)) hidden.add(me);
      if (g.bodyMask && st.bodyMask !== false) masks.push(g.bodyMask);
      const cw = (g.colourways ?? []).find((c: any) => c.id === w.colourway) ?? g.colourways?.[0];
      if (cw) for (const [mat, p] of Object.entries<any>(cw.materials ?? {})) for (const me of this.meshes) if ((me.userData.src as any)?.name === mat) {
        const L = me.userData.look as THREE.MeshPhysicalMaterial;
        if (p.color) { L.color.setRGB(p.color[0], p.color[1], p.color[2]); if (me.userData.cls === "cloth") { const CL = section("materials").cloth; L.sheenColor.copy(L.color).lerp(new THREE.Color(1, 1, 1), CL.sheen_tint[0]).multiplyScalar(CL.sheen_tint[1]); } }
        for (const k of ["roughness", "metalness", "sheen", "clearcoat"]) if (p[k] !== undefined) (L as any)[k] = p[k];
      }
    }
    for (const pat of st.hide ?? []) for (const me of this.meshes) if (glob(pat, me.name)) hidden.add(me);
    if (st.show) for (const me of this.meshes) if (!st.show.some((p: string) => glob(p, me.name))) hidden.add(me);
    for (const me of this.meshes) me.userData.hidden = hidden.has(me);
    this.styleMat = st.material ? MAT.styleMaterial(st.material, this.U) : null;
    const key = masks.join("|");
    if (key !== this.maskKey) { this.maskKey = key; if (this.maskU.value !== MAT.NO_MASK) this.maskU.value.dispose(); this.maskU.value = await this.combineMasks(masks); }
    this.applyView();
    this.swapMs = performance.now() - t0;
  }
  /** Images of body masks, combined (lighter wins) into one texture in the body's UV space. */
  private async combineMasks(paths: string[]): Promise<THREE.Texture> {
    if (!paths.length) return MAT.NO_MASK;
    const imgs = await Promise.all(paths.map((p) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("mask not found: " + p)); i.src = this.base + p; })));
    const n = Math.min(STYLE.mask_size, Math.max(...imgs.map((i) => i.naturalWidth))), c = document.createElement("canvas"); c.width = c.height = n;
    const x = c.getContext("2d")!; x.fillStyle = "#000"; x.fillRect(0, 0, n, n); x.globalCompositeOperation = "lighten";
    for (const i of imgs) x.drawImage(i, 0, 0, n, n);
    const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.anisotropy = STYLE.mask_anisotropy; t.needsUpdate = true;
    return t;
  }
  /** A garment kept in its own small GLB (same joint names): loaded on first use and bound to this person's skeleton. */
  async loadSide(source: string) {
    const g: any = await this.gltfLoader.loadAsync(this.base + source), main = this.skeletons[0], index = new Map(main.bones.map((b, i) => [b.name, i])), add: THREE.SkinnedMesh[] = [];
    g.scene.updateMatrixWorld(true); g.scene.traverse((o: any) => { if (o.isSkinnedMesh) add.push(o); });
    for (const me of add) {
      const map = me.skeleton.bones.map((b) => index.get(b.name) ?? 0), si = me.geometry.attributes.skinIndex as THREE.BufferAttribute;
      await secondInfluences(g, [me]);
      if (!map.every((v, i) => v === i)) for (const si2 of new Set<THREE.BufferAttribute>([si, me.geometry.userData.set8?.skinIndex, me.geometry.userData.set8?.skinIndex1])) if (si2) { for (let i = 0; i < si2.count; i++) for (let k = 0; k < 4; k++) si2.setComponent(i, k, map[si2.getComponent(i, k)]); si2.needsUpdate = true; }
      this.root.add(me); me.bind(main, me.bindMatrix); me.castShadow = true; me.receiveShadow = true; me.frustumCulled = false; me.customDepthMaterial = personDepthMaterial(this.U); this.meshes.push(me);
    }
    this.sideLoaded.add(source);
    this.buildMaterials(add); this.applyShape(); this.buildContactMasks();
  }
  buildMaterials(only?: THREE.SkinnedMesh[]) {
    const mm = { ...(this.manifest.materials ?? {}), ...this.toneMaterials }, masked = this.hasMasks;
    for (const me of only ?? this.meshes) {
      const src: any = me.userData.src ?? (me.userData.src = me.material);
      const cls = MAT.classOf(src.name ?? "", mm[src.name]?.class);
      me.userData.cls = cls; me.userData.key = me.name;
      me.userData.look = MAT.build(cls, src, me.userData.key, { ...(mm[src.name] ?? {}), mask: cls === "skin" && masked ? this.maskU : undefined }, this.U, this.load);
      me.userData.cut = {};
    }
    if (!only) this.maskKey = "\u0000";      // look materials are new: colourways must be applied again
    this.applyView();
  }
  /** A copy of the style material that respects a garment's per-pixel cut (the alpha of its base-colour texture). */
  private cut(me: THREE.SkinnedMesh, base: THREE.Material): THREE.Material {
    const src: any = me.userData.src; if (!(src?.alphaTest > 0 && src.map)) return base;
    return (me.userData.cut[base.uuid] ??= (() => { const m: any = base.clone(); m.map = src.map; m.alphaTest = 0.5; m.alphaToCoverage = true; m.side = src.side;
      const prev = base.onBeforeCompile; m.onBeforeCompile = (sh: any, r: any) => { sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#ifdef USE_MAP\n\tdiffuseColor.a *= texture2D( map, vMapUv ).a;\n#endif"); prev.call(m, sh, r); };
      const prevKey = base.customProgramCacheKey.bind(base); m.customProgramCacheKey = () => prevKey() + "-cut"; return m; })());
  }
  /** Materials and visibility for the current style and wardrobe. */
  /** The camera sits on this person's own eyes (the operator's view): what is worn on the head and the eyes themselves are not drawn
   *  (the face lies inside the camera's near plane); everything else, hands, arms and knees, is seen as the operator sees it. */
  firstPerson = false;
  static HEAD_WORN = /^(garment_cap|cap|hat|helmet|glasses|prop_headset|headset|hair|lashes|brows|eyeball|eye_wetline|cornea)/i;
  applyView() {
    for (const me of this.meshes) {
      if (!me.userData.look) continue;
      me.material = this.styleMat ? this.cut(me, this.styleMat) : me.userData.look;
      me.visible = !me.userData.hidden && !(this.firstPerson && Avatar.HEAD_WORN.test(me.name));
    }
  }
  // ---- shape
  shapeWeights(): Record<string, number> {
    const mo = this.manifest.shape.model, out: Record<string, number> = {};
    const x = mo.inputs.map((id: string, i: number) => ((this.shape[id] ?? 0) - (mo.centre?.[i] ?? 0)) / (mo.scale?.[i] ?? 1));
    for (const [t, d] of Object.entries<any>(mo.targets)) { let w = d.bias ?? 0; for (let i = 0; i < x.length; i++) w += (d.coef[i] ?? 0) * x[i]; out[t] = Math.min(d.max ?? 3, Math.max(d.min ?? -3, w)); }
    return out;
  }
  /** Control values or a preset name; unknown controls are refused. */
  setShape(values: Record<string, number> | string) {
    const sh = this.manifest.shape;
    const v = typeof values === "string" ? sh.presets?.find((p: any) => p.name === values)?.values : values;
    if (!v) throw new Error(`no shape preset '${values}'`);
    if (typeof values === "string") for (const c of sh.controls) this.shape[c.id] = c.default ?? 0;
    for (const [k, x] of Object.entries(v)) { const c = sh.controls.find((cc: any) => cc.id === k); if (!c) throw new Error(`no body control '${k}'`); this.shape[k] = Math.min(c.max, Math.max(c.min, Number(x))); }
    this.applyShape();
  }
  applyShape() {
    const w = this.weights = this.shapeWeights(), sh = this.manifest.shape;
    for (const me of this.meshes) if (me.morphTargetDictionary) for (const [t, v] of Object.entries(w)) { const i = me.morphTargetDictionary[t]; if (i !== undefined) me.morphTargetInfluences![i] = v; }
    if (this.bakes.length) this.applyBakes(w);
    // the skeleton follows: new rest position of every joint, its local translation and its inverse bind matrix
    const jd = sh.jointDeltas ?? {};
    for (const [n, b0] of this.baseWorldP) {
      const pos = this.nowWorldP.get(n)!.copy(b0);
      for (const [t, v] of Object.entries(w)) { const d = v && jd[t]?.[n]; if (d) pos.x += v * d[0], pos.y += v * d[1], pos.z += v * d[2]; }
    }
    const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), iq = new THREE.Quaternion();
    for (const [n, b] of this.bones) {
      const par = (b.parent as any)?.isBone ? b.parent!.name : null;
      const lp = this.nowLocalP.get(n)!;
      if (par) lp.copy(this.nowWorldP.get(n)!).sub(this.nowWorldP.get(par)!).applyQuaternion(iq.copy(this.restWorldQ.get(par)!).invert());
      else lp.copy(this.baseLocalP.get(n)!).add(this.nowWorldP.get(n)!).sub(this.baseWorldP.get(n)!);
      b.position.copy(lp);
    }
    for (const s of this.skeletons) s.bones.forEach((b, i) => s.boneInverses[i].copy(m4.compose(this.nowWorldP.get(b.name)!, this.restWorldQ.get(b.name)!, one)).invert());
    const pel = this.manifest.anchors?.pelvis ?? this.rootBone.name;
    this.legScale = this.nowWorldP.get(pel)!.y / Math.max(this.baseWorldP.get(pel)!.y, 1e-6);
    for (const ms of sh.measures ?? []) { let v = ms.base; for (const [t, k] of Object.entries<number>(ms.perTarget ?? {})) v += (w[t] ?? 0) * k; this.measures[ms.id] = Math.round(v * 10) / 10; }
    this.person = this.matchPerson();
  }
  /** The current body's rest key (head and left hand rest positions): the seated-operator solver is built for one key. */
  restKey(): string { const h = this.nowWorldP.get("head"), l = this.nowWorldP.get("hand_l"); return h && l ? [...h.toArray(), ...l.toArray()].map((x) => x.toFixed(4)).join() : ""; }
  /** The baked person (manifest motion.persons) this body is, by its rest head and hand positions; "" for any other body. */
  person = "";
  matchPerson(): string {
    const hp = this.nowWorldP.get("head"), lp = this.nowWorldP.get("hand_l"); if (!hp || !lp) return "";
    const lift = this.manifest?.rest?.soleHeight ?? 0, k6 = [hp.x, hp.y - lift, hp.z, lp.x, lp.y - lift, lp.z];     // the fit's key is in the bare-sole frame
    for (const [id, f] of Object.entries<any>(this.manifest?.motion?.persons ?? {})) if (f.key && f.key.every((v: number, i: number) => Math.abs(v - k6[i]) < FIT_KEY_TOLERANCE)) return id;
    return "";
  }
  // ---- pose
  resetPose() { for (const [n, b] of this.bones) { b.quaternion.copy(this.restQ.get(n)!); b.position.copy(this.nowLocalP.get(n)!); } }
  applyPose() {
    const q = new THREE.Quaternion(), ax = new THREE.Vector3();
    this.resetPose();
    for (const [j, ds] of this.dofsByJoint) {
      const b = this.bones.get(j); if (!b) continue;
      for (const d of ds) { const v = this.dofValues[d.id] ?? 0; if (v) b.quaternion.multiply(q.setFromAxisAngle(ax.fromArray(d.axis).normalize(), THREE.MathUtils.degToRad(v))); }
    }
    // keep the lower foot on the floor (a pose has no root translation of its own)
    this.ground();
  }
  /** The pose as it can be carried to another package of the same skeleton: dof values and the operator layer's state. */
  poseState() { const op = this.state("operator"); return { dofs: { ...this.dofValues }, operator: !!op.on, script: op.script as string, clip: this.clipName || null, clipTime: this.clipTime }; }
  /** A named pose of the package (its pose list) or dof values in degrees; the operator layer is switched off for it. */
  setPose(nameOrDofs: string | Record<string, number>) {
    const dofs = typeof nameOrDofs === "string" ? this.manifest.poses.find((p: any) => p.name === nameOrDofs || p.id === nameOrDofs)?.dofs : nameOrDofs;
    if (!dofs) throw new Error(`no pose '${nameOrDofs}'`);
    for (const d of this.dofs) this.dofValues[d.id] = dofs[d.id] ?? 0;
    this.state("operator").on = false; this.mixer?.stopAllAction(); this.action = null; this.clipName = ""; this.mode = "pose"; this.seated = false;
  }
  // ---- clips (lab main.ts setClip / update)
  mixer: THREE.AnimationMixer | null = null; clips = new Map<string, THREE.AnimationClip>(); action: THREE.AnimationAction | null = null; clipName = ""; clipBaked = false; clipTime: number | null = null;
  private clipToken = 0;
  /** Play a clip of the manifest (null: back to the pose). A take baked for this very body is preferred; the operator layer is
   *  switched off while a clip plays. `time` fixes the clip's time (a still); without it the clip runs with the person's clock. */
  async setClip(name: string | null, time: number | null = null) {
    const token = ++this.clipToken;
    this.mixer?.stopAllAction(); this.action = null; this.clipName = name ?? ""; this.clipTime = time;
    if (!name) { this.mode = "pose"; return true; }
    const c = (this.manifest.clips ?? []).find((k: any) => k.name === name); if (!c) throw new Error(`no clip '${name}' (${(this.manifest.clips ?? []).map((k: any) => k.name).join(", ")})`);
    const own = c.perBody?.[this.person], key = own ? name + "@" + this.person : name;
    if (!this.clips.has(key)) {
      const source = own ?? c.source; if (!source || source === "glb") throw new Error("no file for clip " + name);
      const g = await this.gltfLoader.loadAsync(new URL(source, new URL(this.base, location.href)).href); const clip = g.animations[0]; clip.name = key; this.clips.set(key, clip);
      if (token !== this.clipToken) return false;
    }
    this.mixer ??= new THREE.AnimationMixer(this.root);
    this.clipBaked = !!own; this.state("operator").on = false; this.seated = !!c.seated;
    this.resetPose();
    this.action = this.mixer.clipAction(this.clips.get(key)!); this.action.setLoop(c.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); this.action.clampWhenFinished = true; this.action.reset().play(); this.mode = "clip";
    return true;
  }
  private poseFromClip(dt: number) {
    // every frame from the rest pose; the mixer's accumulators marked stale so every track is written (lab round 8: a held clip
    // never wrote its tracks back after the reset, and offsets piled up)
    this.resetPose();
    for (const pm of (this.mixer as any)._bindings ?? []) { const sz = pm.valueSize; if (pm.buffer && sz) pm.buffer.fill(NaN, sz, 3 * sz); }
    if (this.clipTime !== null) { this.action!.time = Math.min(this.clipTime, this.action!.getClip().duration); this.mixer!.update(0); } else this.mixer!.update(dt);
    // translation tracks were authored on the base body: carry the offset from rest over, scaled by leg length
    if (!this.clipBaked) for (const tr of this.action!.getClip().tracks) if (tr.name.endsWith(".position")) {
      const n = tr.name.slice(0, -9), b = this.bones.get(n); if (!b) continue;
      b.position.sub(this.baseLocalP.get(n)!).multiplyScalar(this.legScale).add(this.nowLocalP.get(n)!);
    }
    if (!this.seated) this.ground();
  }
  /** A standing body on its soles. First the lower foot joint at its rest height above the package's floor (the rest pose stands on
   *  its shoe soles, rest.soleHeight; MPK found the takes' shoes 8 mm under the floor without it); then, in update() after the
   *  drivers, the lowest skinned sole point on the floor (groundSoles): a foot turned or rolled from rest dips its sole's edge below
   *  what the joint says (MPK's full-01 packet: A_POSE 6 to 9 mm under the floor, the clay last and the trainer alike). */
  ground() {
    const a = this.manifest.anchors ?? {}, feet = [a.foot_L, a.foot_R].filter((n: string) => this.bones.has(n)); if (!feet.length) return;
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert(), v = new THREE.Vector3(); let d = Infinity;
    for (const f of feet) d = Math.min(d, v.setFromMatrixPosition(this.bones.get(f)!.matrixWorld).applyMatrix4(inv).y - this.nowWorldP.get(f)!.y);
    if (Number.isFinite(d)) this.rootBone.position.y -= d;
    this.groundPending = true;
  }
  private groundPending = false;
  private soleCache = new Map<THREE.SkinnedMesh, { key: string; idx: Int32Array }>();
  /** The vertices a mesh can stand on: those that move with a foot (weight on the foot joints and below at least foot_weight) and
   *  lie within sole_band of the mesh's lowest such vertex at rest. Per body shape and mesh. */
  soleVertices(me: THREE.SkinnedMesh): Int32Array {
    const key = this.restKey() + ":" + me.geometry.id, hit = this.soleCache.get(me); if (hit?.key === key) return hit.idx;
    const a = this.manifest.anchors ?? {}, roots = new Set([a.foot_L, a.foot_R].filter(Boolean)), foot = new Set<number>();
    me.skeleton.bones.forEach((b, i) => { for (let o: THREE.Object3D | null = b; o && (o as any).isBone; o = o.parent) if (roots.has(o.name)) { foot.add(i); break; } });
    const g = me.geometry, A = g.attributes as any, pos = g.attributes.position, sets = [[A.skinIndex, A.skinWeight], [A.skinIndex1, A.skinWeight1]].filter(([i, w]) => i && w);
    const B = me.bindMatrix.elements, cand: number[] = [], ys: number[] = []; let low = Infinity;
    if (foot.size && A.skinIndex) for (let v = 0; v < pos.count; v++) {
      let w = 0; for (const [ji, wi] of sets) for (let c = 0; c < 4; c++) if (foot.has(ji.getComponent(v, c))) w += wi.getComponent(v, c);
      if (w < GROUND.foot_weight) continue;
      const y = B[1] * pos.getX(v) + B[5] * pos.getY(v) + B[9] * pos.getZ(v) + B[13]; cand.push(v); ys.push(y); low = Math.min(low, y);
    }
    const idx = Int32Array.from(cand.filter((_, k) => ys[k] <= low + GROUND.sole_band));
    this.soleCache.set(me, { key, idx }); return idx;
  }
  /** The lowest sole point of the visible meshes, skinned as drawn, in the package frame (y up from its floor); Infinity without feet. */
  soleLow(): number {
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert().elements; let low = Infinity;
    for (const me of this.meshes) {
      if (!me.visible) continue; const idx = this.soleVertices(me); if (!idx.length) continue;
      const P = this.skinnedPositions(me, idx);
      for (let k = 0; k < idx.length; k++) { const y = inv[1] * P[3 * k] + inv[5] * P[3 * k + 1] + inv[9] * P[3 * k + 2] + inv[13]; if (y < low) low = y; }
    }
    return low;
  }
  private groundSoles() { const low = this.soleLow(); if (Number.isFinite(low)) { this.rootBone.position.y -= low; this.root.updateMatrixWorld(true); } }
  // ---- per frame
  update(dt: number) {
    this.time += dt;
    if (this.mode === "clip" && this.action) this.poseFromClip(dt);
    else if (this.plugins.some((p) => p.ownsPose?.(this.context(p, dt)))) this.resetPose(); else this.applyPose();
    for (const p of this.plugins) p.frame(this.context(p, dt));
    for (const b of this.bones.values()) b.quaternion.normalize();        // the skinning shader assumes rigid joints
    this.drive();
    if (this.groundPending) { this.groundPending = false; this.groundSoles(); }     // standing: the sole as drawn on the floor (after the drivers)
    this.holder.updateMatrixWorld(true);
    const op: any = this.state("operator"), planes = op.on && !op.report?.error ? op.contactPlanes ?? [] : [];
    this.contact.packPlanes(planes, this.meshes.filter((me) => me.visible), this.renderer, this.U, dt === 0); this.contact.packCapsules(this.capsulesNow()); this.contact.upload();
    for (const p of this.plugins) p.late?.(this.context(p, dt));
  }
  /** Twist and corrective drivers. Sign-safe: q and -q are the same rotation; the operator layer writes joint quaternions with w < 0,
   *  and without the w >= 0 step the swing-twist split read a twist near 360 degrees (the lab's round-6 fault: knee helpers 136
   *  degrees the wrong way, twist joints flipping 180 degrees). */
  drive() {
    const q = new THREE.Quaternion(), rel = new THREE.Quaternion(), ax = new THREE.Vector3(), cw: Record<string, number> = {};
    for (const d of this.manifest.drivers ?? []) {
      if (d.type === "twist") {
        const s = this.bones.get(d.source); if (!s) continue;
        rel.copy(this.restQ.get(d.source)!).invert().multiply(s.quaternion);
        if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
        ax.fromArray(d.axis).normalize();
        const ang = 2 * Math.atan2(rel.x * ax.x + rel.y * ax.y + rel.z * ax.z, rel.w);
        let taken = 0;
        for (const t of d.targets) { const b = this.bones.get(t.joint); if (!b || !t.fraction) continue; b.quaternion.copy(this.restQ.get(t.joint)!).multiply(q.setFromAxisAngle(ax, ang * t.fraction)); taken += t.fraction; }
        if (d.inChain && taken) s.quaternion.copy(this.restQ.get(d.source)!).multiply(q.setFromAxisAngle(ax, -ang * taken)).multiply(rel);
      } else if (d.type === "morph") {
        const dd = this.dofById.get(d.dof), b = dd && this.bones.get(dd.joint); if (!dd || !b) continue;
        rel.copy(this.restQ.get(dd.joint)!).invert().multiply(b.quaternion); if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w); ax.fromArray(dd.axis).normalize();
        let v = THREE.MathUtils.radToDeg(2 * Math.atan2(rel.x * ax.x + rel.y * ax.y + rel.z * ax.z, rel.w)); if (v > 180) v -= 360; if (v < -180) v += 360;
        cw[d.target] = Math.max(cw[d.target] ?? 0, THREE.MathUtils.clamp((v - d.from) / (d.to - d.from), 0, 1));
      } else if (d.type === "morphPose") {
        const b = this.bones.get(d.joint); if (!b) continue;
        q.copy(this.restQ.get(d.joint)!);
        for (const dd of this.dofsByJoint.get(d.joint) ?? []) { const v = d.pose[dd.id]; if (v) q.multiply(rel.setFromAxisAngle(ax.fromArray(dd.axis).normalize(), THREE.MathUtils.degToRad(v))); }
        cw[d.target] = Math.max(cw[d.target] ?? 0, 1 - THREE.MathUtils.radToDeg(q.angleTo(b.quaternion)) / d.radius, 0);
      }
    }
    for (const [t, v] of Object.entries(cw)) for (const me of this.meshes) { const i = me.morphTargetDictionary?.[t]; if (i !== undefined) me.morphTargetInfluences![i] = v; }
  }
  /** World positions of one mesh's vertices as the person's vertex shader computes them (shaders.ts): relative morph targets, the
   *  eight influences, linear blend mixed with dual-quaternion skinning by `_DQS`; the seat contact's few millimetres are left out.
   *  For picking (three's own raycast skins with four influences only: 190 mm off on operator-m) and for the checks. */
  skinnedPositions(me: THREE.SkinnedMesh, idx?: ArrayLike<number>): Float32Array {      // idx: only these vertices, packed in that order
    const g = me.geometry, pos = g.attributes.position, n = idx ? idx.length : pos.count, out = new Float32Array(n * 3), A = g.attributes as any;
    const morphs = g.morphAttributes.position ?? [], infl = me.morphTargetInfluences ?? [], rel = g.morphTargetsRelative;
    me.skeleton.update(); const BM = me.skeleton.boneMatrices!, nb = me.skeleton.bones.length;
    // per bone: the matrix (column major, as three keeps it) and its unit quaternion and translation
    const Qr = new Float64Array(nb * 4), Tr = new Float64Array(nb * 3), q = new THREE.Quaternion(), m = new THREE.Matrix4();
    for (let i = 0; i < nb; i++) { m.fromArray(BM, i * 16); q.setFromRotationMatrix(m); Qr.set([q.x, q.y, q.z, q.w], i * 4); Tr.set([BM[i * 16 + 12], BM[i * 16 + 13], BM[i * 16 + 14]], i * 3); }
    const sets: [THREE.BufferAttribute, THREE.BufferAttribute][] = [[A.skinIndex, A.skinWeight]]; if (A.skinIndex1 && A.skinWeight1) sets.push([A.skinIndex1, A.skinWeight1]);
    const dqs = A._dqs as THREE.BufferAttribute | undefined, B = me.bindMatrix.elements, Bi = new THREE.Matrix4().copy(me.matrixWorld).multiply(me.bindMatrixInverse).elements;
    const p = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      const v = idx ? idx[k] : k; let x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      for (let k = 0; k < morphs.length; k++) { const w = infl[k]; if (!w) continue; const M = morphs[k]; if (rel) { x += w * M.getX(v); y += w * M.getY(v); z += w * M.getZ(v); } else { x += w * (M.getX(v) - pos.getX(v)); y += w * (M.getY(v) - pos.getY(v)); z += w * (M.getZ(v) - pos.getZ(v)); } }
      const sx = B[0] * x + B[4] * y + B[8] * z + B[12], sy = B[1] * x + B[5] * y + B[9] * z + B[13], sz = B[2] * x + B[6] * y + B[10] * z + B[14];
      let lx = 0, ly = 0, lz = 0; const mix = dqs ? Math.min(1, Math.max(0, dqs.getX(v))) : 0;
      let r0 = 0, r1 = 0, r2 = 0, r3 = 0, d0 = 0, d1 = 0, d2 = 0, d3 = 0; const first = A.skinIndex.getComponent(v, 0);   // the shader's reference: the first slot's bone, whatever its weight
      for (const [ji, wi] of sets) for (let c = 0; c < 4; c++) {
        const w = wi.getComponent(v, c); if (!w) continue; const j = ji.getComponent(v, c), o = j * 16;
        lx += w * (BM[o] * sx + BM[o + 4] * sy + BM[o + 8] * sz + BM[o + 12]); ly += w * (BM[o + 1] * sx + BM[o + 5] * sy + BM[o + 9] * sz + BM[o + 13]); lz += w * (BM[o + 2] * sx + BM[o + 6] * sy + BM[o + 10] * sz + BM[o + 14]);
        if (mix > 0.001) {
          let qx = Qr[j * 4], qy = Qr[j * 4 + 1], qz = Qr[j * 4 + 2], qw = Qr[j * 4 + 3];
          { const f = first * 4; if (qx * Qr[f] + qy * Qr[f + 1] + qz * Qr[f + 2] + qw * Qr[f + 3] < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; } }
          const tx = Tr[j * 3], ty = Tr[j * 3 + 1], tz = Tr[j * 3 + 2];
          // dual part 0.5 * (t * q.w + t x q.xyz, -t . q.xyz)
          const ex = 0.5 * (tx * qw + (ty * qz - tz * qy)), ey = 0.5 * (ty * qw + (tz * qx - tx * qz)), ez = 0.5 * (tz * qw + (tx * qy - ty * qx)), ew = -0.5 * (tx * qx + ty * qy + tz * qz);
          r0 += w * qx; r1 += w * qy; r2 += w * qz; r3 += w * qw; d0 += w * ex; d1 += w * ey; d2 += w * ez; d3 += w * ew;
        }
      }
      p[0] = lx; p[1] = ly; p[2] = lz;
      if (mix > 0.001) {
        const L = Math.hypot(r0, r1, r2, r3) || 1e-6; r0 /= L; r1 /= L; r2 /= L; r3 /= L; d0 /= L; d1 /= L; d2 /= L; d3 /= L;
        // rotate (sx, sy, sz) by (r0..r3): v + 2 q x (q x v + w v)
        const cx = r1 * sz - r2 * sy + r3 * sx, cy = r2 * sx - r0 * sz + r3 * sy, cz = r0 * sy - r1 * sx + r3 * sz;
        const rx = sx + 2 * (r1 * cz - r2 * cy), ry = sy + 2 * (r2 * cx - r0 * cz), rz = sz + 2 * (r0 * cy - r1 * cx);
        // + 2 (w d.xyz - d.w q.xyz + q.xyz x d.xyz)
        const px = rx + 2 * (r3 * d0 - d3 * r0 + (r1 * d2 - r2 * d1)), py = ry + 2 * (r3 * d1 - d3 * r1 + (r2 * d0 - r0 * d2)), pz = rz + 2 * (r3 * d2 - d3 * r2 + (r0 * d1 - r1 * d0));
        p[0] = lx + (px - lx) * mix; p[1] = ly + (py - ly) * mix; p[2] = lz + (pz - lz) * mix;
      }
      out[k * 3] = Bi[0] * p[0] + Bi[4] * p[1] + Bi[8] * p[2] + Bi[12]; out[k * 3 + 1] = Bi[1] * p[0] + Bi[5] * p[1] + Bi[9] * p[2] + Bi[13]; out[k * 3 + 2] = Bi[2] * p[0] + Bi[6] * p[1] + Bi[10] * p[2] + Bi[14];
    }
    return out;
  }
  bounds(): THREE.Box3 { const b = new THREE.Box3(), v = new THREE.Vector3(); for (const bn of this.bones.values()) b.expandByPoint(v.setFromMatrixPosition(bn.matrixWorld)); return b.expandByScalar(ANCH.bounds_pad); }
  anchor(name: string): THREE.Vector3 | null {
    const a = this.manifest.anchors ?? {}, pos = (n: string) => (this.bones.has(n) ? new THREE.Vector3().setFromMatrixPosition(this.bones.get(n)!.matrixWorld) : null);
    const eyesMid = () => { const l = pos(a.eye_L), r = pos(a.eye_R); return l && r ? l.add(r).multiplyScalar(0.5) : pos(a.head); };
    if (name === "eyes" || name === "eye_midpoint") return eyesMid();
    if (name === "head_centre") { if (a.head_centre) return pos(a.head_centre); const e = eyesMid(), b = this.bones.get(a.head); return e && e.add(new THREE.Vector3().fromArray(ANCH.head_centre).applyQuaternion(b ? b.getWorldQuaternion(new THREE.Quaternion()).multiply(this.restWorldQ.get(a.head)!.clone().invert()) : new THREE.Quaternion())); }
    if (name === "body_centre") { const pel = pos(a.pelvis ?? this.rootBone.name)!, stature = this.measures.stature ? this.measures.stature / 1000 : (this.manifest.rest?.stature ?? 1) * this.legScale; return new THREE.Vector3(pel.x, ANCH.body_centre * stature, pel.z); }
    if (name === "feet") { const l = pos(a.foot_L), r = pos(a.foot_R); return l && r ? l.add(r).multiplyScalar(0.5) : null; }
    if (name === "hands") { const l = pos(a.hand_L), r = pos(a.hand_R); return l && r ? l.add(r).multiplyScalar(0.5) : null; }
    const hc = /^hand_centre_([LR])$/.exec(name);
    if (hc) {      // the middle of the palm (camera framing; MPK): the operator's palm centre, from the wrist toward the knuckle line, in the knuckle plane
      const S = hc[1], s = S.toLowerCase(), w = pos(a[`joint:wrist_${S}`] ?? `hand_${s}`), i = pos(`index_01_${s}`), p = pos(`pinky_01_${s}`);
      return w && i && p ? w.lerp(i.lerp(p, HANDS.palm_centre[0]), HANDS.palm_centre[1]) : pos(a[`hand_${S}`]);
    }
    return pos(a[name] ?? name.replace(/^joint:/, ""));
  }
  dispose() { this.holder.removeFromParent(); this.contact.dispose(); this.root.traverse((o: any) => { if (o.isMesh) { o.geometry.dispose(); } }); }
}

/** The seated-operator layer as a plug-in (lab operator.ts seatedOperator.frame): builds the solver for the current body shape,
 *  matches the body to a baked person's fit, sets the targets (the rig binding's over the stand-in's), solves the script at the
 *  person's time, and writes the joints. A still (`state.time` set) settles the last few seconds at a fixed step, as the lab does. */
function operatorPlugin(av: Avatar): Plugin {
  return {
    name: "operator",
    state: { on: true, script: "hold", time: undefined as number | undefined, report: null as any },
    ownsPose: (ctx) => !!ctx.state.on && av.mode !== "clip",
    frame(ctx) {
      const st = ctx.state;
      if (!st.on || av.mode === "clip") { if (!st.on) { st._op = null; } if (av.mode !== "clip") av.seated = false; av.state("eyes").target = null; return; }   // no seated gaze point when not operating (MPK: standing faces stared at the screen)
      const bones = ctx.bones; if (!bones.has("pelvis") || !bones.has("upperarm_l") || !bones.has("lowerarm_twist_01_l")) { st.report = { error: "this package is not on the 82-joint skeleton: the operator layer is off" }; return; }
      const key = av.restKey();
      if (!st._op || st._key !== key || st._bound !== av.binding) {
        if (!st._op || st._key !== key) {
          const names: string[] = [], parent: number[] = [], pos: number[][] = [], rot: number[][] = [], order: THREE.Bone[] = [];
          const visit = (b: any) => { if (!bones.has(b.name) || names.includes(b.name)) return; if (b.parent && bones.has(b.parent.name)) visit(b.parent); order.push(b); names.push(b.name); };
          for (const b of bones.values()) visit(b);
          for (const b of order) {
            const p = b.parent && bones.has(b.parent.name) ? names.indexOf(b.parent.name) : -1, rq = ctx.restQ.get(b.name)!, q: Q = [rq.x, rq.y, rq.z, rq.w];
            parent.push(p); rot.push(p < 0 ? q : qmul(rot[p] as Q, q)); const w = ctx.restWorldP.get(b.name)!; pos.push([w.x, w.y, w.z]);
          }
          adoptHandPoses(ctx.manifest);
          st._op = new Operator({ names, parent, pos, rot }); st._order = order;
          st.person = av.person; if (st.person) st._op.fit = ctx.manifest.motion.persons[st.person];   // the baked person this body is (Avatar.matchPerson)
          else { const sex = ctx.manifest?.shape?.sex, op0: Operator = st._op;                              // any other body: capsules derived from its shape weights (MV-rig's body-fit.ts), the arms' own left out
            if (sex && hasModel(sex)) { const d = deriveBodyFit(sex, av.weights, (n) => op0.r0(n)); op0.fit = { capsules: d.capsules, arm: d.arm, source: "derived" } as any; } }
          st._key = key; st._t = 0; st.needsBinding = true;
        }
        const op: Operator = st._op;
        op.targets = defaultTargets(op);
        const b = av.binding;
        if (b) { Object.assign(op.targets, b.targets); if (b.contactPlanes?.length) op.contactPlanes = b.contactPlanes; }
        op.fitGrips();                                                 // the hands wrap the real handles (their radius and profile, when the binding gives them)
        if (!b?.contactPlanes?.length) standInProps(op);              // the stand-in pan's solid onto the seat plane (no rig binding)
        op.resetRun(); st._bound = b; st._t = 0;
      }
      av.seated = true;
      const op: Operator = st._op, lean = av.binding?.stickLean, script = SCRIPTS[st.script] ?? SCRIPTS.hold;
      const controls = (t: number): Controls => { const c = script(t); if (lean) { c.stick.l = [c.stick.l[0] + lean.l[0], c.stick.l[1] + lean.l[1]]; c.stick.r = [c.stick.r[0] + lean.r[0], c.stick.r[1] + lean.r[1]]; } return c; };
      const t = st.time ?? (st._t += ctx.dt), dt = st.time !== undefined ? STILL_SETTLE.step : ctx.dt;
      if (st.time !== undefined) { op.resetRun(); for (let u = Math.max(0, t - STILL_SETTLE.seconds); u < t; u += STILL_SETTLE.step) { op.time = u; op.solve(controls(u), STILL_SETTLE.step); } op.time = t - dt; }
      const c = controls(t);
      op.solve(c, dt); const L = op.locals();
      (st._order as THREE.Bone[]).forEach((bn, j) => bn.quaternion.set(L.q[j][0], L.q[j][1], L.q[j][2], L.q[j][3]));
      bones.get("pelvis")!.position.set(L.pelvis[0], L.pelvis[1], L.pelvis[2]);
      st.controls = c; st.contactPlanes = op.contactPlanes;
      const gw = (k: "l" | "r") => op.hands[k].wrap ?? null, M = av.measures;
      st.report = { ...op.report, grip: { l: gw("l"), r: gw("r"), hand_breadth_mm: M.handbreadth ?? null, hand_length_mm: M.handlength ?? null }, person: st.person || null, collision: op.fit ? "capsules of person " + st.person : "not evaluated: this body is not one of the baked persons", clash: op.clash, binding: av.binding?.report ?? null };
      // the eyes lead, the head above follows: the gaze point (package frame) as a world point for eyes.ts
      av.root.updateMatrixWorld(true);
      const gp = new THREE.Vector3(op.gazePoint[0], op.gazePoint[1], op.gazePoint[2]).applyMatrix4(av.root.matrixWorld);
      av.state("eyes").target = gp.toArray();
    },
  };
}
const qmul = (a: Q, b: Q): Q => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
