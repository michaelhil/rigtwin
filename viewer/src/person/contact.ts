// Contact, the CPU side (ported from the lab's contact.ts, RL rounds 5-9; the shader side is in shaders.ts): flesh rests
// on the seat pan and the backrest instead of passing through them, and capsules (FORMAT.md 2f) push receiver regions
// out of a limb. Each person has its own data texture (rows of planes and capsules, then the two sink maps), referenced by
// the uniform `labContact` of its own materials only. Changes from the lab: one texture per person instead of one shared by
// every material through THREE.ShaderLib; the meshes of the sink pass are the person's own list instead of a registry
// learnt by wrapping SkinnedMesh.prototype.onBeforeRender; only the round-7 method (no r5 / r6 before-and-after switches,
// no plain stool).
import * as THREE from "three";
import { PLANES, SLAB_ROW, SLABS, SLAB_MAX, CAPSULES, ROWS, SINK, TEXW, MAPS, PROFILE_MAX, SINK_VERTEX, SINK_FRAGMENT, patchPersonVertex, type PersonUniforms } from "./shaders.ts";
import { section } from "./params.ts";
import type { ContactPlane } from "./operator.ts";

const K = section("contact"), PL = K.planes, P = K.pan, SK = K.sink, RF = K.roll, CS = K.shader, SL = K.slab;
const SLAB_TEXELS = (TEXW - 4) * 4;      // a shell row's texels 4... (samples, up, the map's box, the profile)

export interface Capsule { a: THREE.Vector3; ra: number; b: THREE.Vector3; rb: number; channel: number; knee: number; self: THREE.Vector3; def?: any }

/** One person's contact data: the rows it packs each frame, the texture its materials read, and its sink maps. */
export class Contact {
  rows = new Float32Array(16 * ROWS);
  profile = new Float32Array(4 * PROFILE_MAX); profileCount = 0;      // the real cushion's top over the flat pan (texels 8... of row 0)
  slabs = new Float32Array(SLABS * SLAB_TEXELS);                     // the shells' rows from texel 4 on (shaders.ts labSlab)
  slabMaps: SinkMap[] = [];                                          // the shells packed this frame: their sink maps' frames
  data = new Float32Array(4 * TEXW * (ROWS + MAPS * SINK));
  tex = new THREE.DataTexture(this.data, TEXW, ROWS + MAPS * SINK, THREE.RGBAFormat, THREE.FloatType);
  private sink: Float32Array | null = null; private sig = ""; private at = -1e9; private drawnAt = -1e9; private pending = false; private seq = 0;
  private pose: { key: string; p: number[] } | null = null;
  private rt = new THREE.WebGLRenderTarget(SINK, SINK, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private scene = new THREE.Scene(); private cam = new THREE.OrthographicCamera(); private proxies = new Map<THREE.SkinnedMesh, THREE.SkinnedMesh>(); private mat: THREE.ShaderMaterial | null = null;
  stats = { renders: 0, ms: 0 };
  constructor() { this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter; this.tex.needsUpdate = true; }

  /** Planes (seat pan solid and backrest, in the person's own frame) into the rows, and the sink map rendered when they or the pose changed. */
  packPlanes(planes: ContactPlane[], meshes: THREE.SkinnedMesh[], renderer: THREE.WebGLRenderer, U: PersonUniforms, still = false) {
    const out = this.rows; out.fill(0, 0, PLANES * 16); this.slabs.fill(0); this.slabMaps = [];
    let pan: any = null, back: any = null, flat = 0;
    planes.forEach((p) => {
      if ((p as any).slab) { if (this.slabMaps.length < SLABS) this.packSlab(p as any, SLAB_ROW + this.slabMaps.length); return; }
      const r = flat++; if (r >= SLAB_ROW) return;
      const o = r * 16, n = new THREE.Vector3().fromArray(p.normal).normalize();
      if (p.name === "seat") {
        const g: any = p.pan ?? {}, top = g.top ?? p.point[1], front = g.front ?? p.point[2] + P.half_depth, rear = g.rear ?? front - P.rear;
        if (r === 0) this.packProfile((p as any).profile, n, p.point[0], top, front, g.edge ?? P.edge);
        const kneeY = g.kneeRestY ?? top + P.knee_above_pan, hipY = g.hipRestY ?? kneeY + P.thigh_length;
        out.set([n.x, n.y, n.z, g.edge ?? P.edge, p.point[0], top, front, g.thickness ?? P.thickness, g.halfWidth ?? P.half_width, 2, kneeY, hipY, front - rear, g.hipRestX ?? P.hip_x, 0, 0], o);
        if (r === 0) pan = { n, point: new THREE.Vector3(p.point[0], top, front), hw: g.halfWidth ?? P.half_width, rear: front - rear, R: g.edge ?? P.edge, kneeY, L: Math.max(hipY - kneeY, CS.thigh_min) };
        return;
      }
      out.set([n.x, n.y, n.z, 0, p.point[0], p.point[1], p.point[2], 0, p.limit_m ?? 0, 1, p.bulge ?? PL.bulge, p.radius ?? PL.radius, PL.knee, PL.fade, PL.depth, 0], o);
      if (r === 1 && p.name === "backrest") back = { n, b: new THREE.Vector3().fromArray(p.point) };
    });
    if (pan && back) {      // the backrest's own frame, exactly as the shader builds it: origin on the backrest at the pan's top, up along it, x sideways
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(back.n, -back.n.y).normalize(), sx = new THREE.Vector3().crossVectors(up, back.n).normalize();
      back.up = up; back.sx = sx; back.o = back.b.clone().addScaledVector(up, (pan.point.y - back.b.y) / Math.max(up.y, CS.up_min));
    }
    this.upload();                                                    // the sink pass reads the pan's rows and the profile from the texture
    const r7 = !!pan && this.renderSink(pan, back, meshes, renderer, U, still);
    if (!r7) this.sink = null;
    const k = (PLANES - 1) * 16;
    out.set([P.knee, P.lip_knee[0], P.lip_knee[1], 0, P.lip_thigh[0], P.lip_thigh[1], P.bulge_knee, P.side, P.mask[0], P.mask[1], P.mask_x[0], P.mask_x[1],
      P.normals, P.bulge_max, P.spread, r7 ? P.volume : 0], k);
  }
  /** A hard shell beside the body (rig-binding.ts slab: [along, height, up from, up to] along its forward axis, from its point) into
   *  its row: the profile resampled at even steps (at most SLAB_MAX), and the frame and box of its sink map. */
  private packSlab(p: ContactPlane & { name: string; slab: { forward: number[]; up: number[]; profile: number[][]; edge?: number } }, row: number) {
    const sl = p.slab, n = new THREE.Vector3().fromArray(p.normal).normalize(), f = new THREE.Vector3().fromArray(sl.forward).normalize(), up = new THREE.Vector3().fromArray(sl.up).normalize();
    const src = sl.profile.filter((q) => q.length >= 4 && q.every(Number.isFinite)).sort((a, b) => a[0] - b[0]); if (src.length < 2) return;
    const a0 = src[0][0], a1 = src[src.length - 1][0], N = Math.min(SLAB_MAX, src.length), step = (a1 - a0) / (N - 1);
    const at = (a: number) => { let i = 0; while (i < src.length - 2 && src[i + 1][0] < a) i++; const A = src[i], B = src[i + 1], t = THREE.MathUtils.clamp((a - A[0]) / Math.max(B[0] - A[0], 1e-9), 0, 1); return [1, 2, 3].map((k) => A[k] + (B[k] - A[k]) * t); };
    const o = (row - SLAB_ROW) * SLAB_TEXELS, idx = 2 + (row - SLAB_ROW); let hMax = -Infinity, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) { const q = at(a0 + i * step); this.slabs.set([q[0], q[1], q[2], 0], o + (4 + i) * 4); hMax = Math.max(hMax, q[0]); lo = Math.min(lo, q[1]); hi = Math.max(hi, q[2]); }
    const box = [lo - SL.margin, hi + SL.margin, a0 - SL.margin, a1 + SL.margin];
    this.slabs.set([N, a0, step, 0, up.x, up.y, up.z, 0, ...box], o);
    this.rows.set([n.x, n.y, n.z, sl.edge ?? 0, p.point[0], p.point[1], p.point[2], hMax, 0, 3, idx, 0, f.x, f.y, f.z, 0], row * 16);
    this.slabMaps.push({ idx, name: p.name, o: new THREE.Vector3().fromArray(p.point), n, f, s: up, box, R: 0, slab: row });
  }
  /** The real cushion's centre-line top ([z, y] in the person's frame, from the rig binding) as heights over the pan's flat top by
   *  depth, in the pan's own frame (as the shader builds it). Behind the front edge's rounding only: the flat pan rounds its own nose. */
  private packProfile(profile: number[][] | undefined, n: THREE.Vector3, x0: number, top: number, front: number, R: number) {
    this.profileCount = 0; if (!Array.isArray(profile) || profile.length < 2) return;
    const f = new THREE.Vector3(0, 0, 1).addScaledVector(n, -n.z).normalize(), rel = new THREE.Vector3(), out: [number, number][] = [];
    for (const [z, y] of profile) { rel.set(-x0, y - top, z - front); const w = rel.dot(f); if (w <= -R) out.push([w, rel.dot(n)]); }
    out.sort((a, b) => a[0] - b[0]);
    out.slice(0, PROFILE_MAX).forEach(([w, h], i) => this.profile.set([w, h, 0, 0], i * 4));
    this.profileCount = Math.min(out.length, PROFILE_MAX);
  }
  /** Capsules of this frame (end points in the person's own frame) as rows. A capsule's `lip: [full, none]` is carried along. */
  packCapsules(list: Capsule[]) {
    const out = this.rows; out.fill(0, PLANES * 16);
    list.slice(0, CAPSULES).forEach((c, k) => { const lip = c.def?.lip; const ok = Array.isArray(lip) && lip[1] > lip[0];
      out.set([c.a.x, c.a.y, c.a.z, c.ra, c.b.x, c.b.y, c.b.z, c.rb, c.channel, 1, c.knee, ok ? lip[0] : 0, c.self.x, c.self.y, c.self.z, ok ? lip[1] : 0], (PLANES + k) * 16); });
  }
  /** The rows and the sink maps into the texture (once per frame, after packing). */
  upload() {
    for (let r = 0; r < ROWS; r++) this.data.set(this.rows.subarray(r * 16, r * 16 + 16), r * TEXW * 4);
    this.data[4 * 4] = this.profileCount; this.data.set(this.profile, 8 * 4);
    for (let k = 0; k < SLABS; k++) this.data.set(this.slabs.subarray(k * SLAB_TEXELS, (k + 1) * SLAB_TEXELS), ((SLAB_ROW + k) * TEXW + 4) * 4);
    if (this.sink) this.data.set(this.sink, ROWS * TEXW * 4); else this.data.fill(0, ROWS * TEXW * 4);
    this.tex.needsUpdate = true;
  }
  // ---- the sink map: the person's meshes drawn once more, from below and flat into a 64 x 64 float target over the pan's
  // footprint, with the flatten off: per column the lowest thigh or buttock skin and how deep it lies inside the pan. Read
  // back and put into the texture below the rows. Re-rendered only when the pose, the shape or the worn meshes change.
  private renderSink(pan: any, back: any, meshes: THREE.SkinnedMesh[], renderer: THREE.WebGLRenderer, U: PersonUniforms, still: boolean): boolean {
    const list = meshes.filter((me) => attached(me));
    if (!list.length) return false;
    let sig = pan.point.toArray().map((v: number) => v.toFixed(4)).join() + pan.kneeY.toFixed(4) + (back ? back.o.toArray().map((v: number) => v.toFixed(4)).join() : "")
      + this.slabMaps.map((m) => m.o.toArray().concat(m.box).map((v: number) => v.toFixed(4)).join()).join("|");
    let meshKey = sig + pan.hw.toFixed(4) + pan.rear.toFixed(4) + pan.R.toFixed(4); const pose: number[] = [];
    for (const me of list) { meshKey += "|" + me.id + ":" + me.geometry.id; const b = me.skeleton.bones; for (let i = 0; i < b.length; i += SK.bone_stride) { const e = b[i].matrixWorld.elements; pose.push(e[12], e[13], e[14]); sig += "," + (e[12] + 3 * e[13] + 7 * e[14] + e[0] + e[5]).toFixed(5); }
      const mi = me.morphTargetInfluences; if (mi) { let t = 0; for (let i = 0; i < mi.length; i++) t += mi[i] * (i + 1); sig += "m" + t.toFixed(5); } }
    sig += meshKey;
    if (this.sig === sig && this.sink) return true;
    // while the body moves (a new map soon after the last, no jump), the read-back is asynchronous and at most every min_interval_ms
    const now = performance.now(), last = this.pose, jump = !last || last.key !== meshKey || last.p.length !== pose.length || pose.some((v, i) => Math.abs(v - last.p[i]) > SK.jump);
    // a still view never takes the shortcut: its map is drawn and read back before the picture (MPK: a still showed the last shot's map)
    const moving = !still && !!this.sink && !jump && now - this.at < SK.moving_window_ms && typeof (renderer as any).readRenderTargetPixelsAsync === "function";
    this.at = now;
    if (moving && this.pending) return true;
    if (moving && now - this.drawnAt < SK.min_interval_ms) return true;
    this.drawnAt = now;
    const t0 = performance.now();
    this.mat ??= sinkMaterial(U, true);
    const Um = this.mat.uniforms;
    Um.uMask.value.set(pan.kneeY, pan.L, P.mask[0], P.mask[1]); Um.uMaskX.value.set(P.mask_x[0], P.mask_x[1]);
    this.stage(list, this.mat);
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear, cc = new THREE.Color(), ca = renderer.getClearAlpha(); renderer.getClearColor(cc);
    const shadowAuto = renderer.shadowMap.autoUpdate, shadowNeeds = renderer.shadowMap.needsUpdate;
    const buf = moving ? new Float32Array(MAPS * SINK * SINK * 4) : this.sink ?? new Float32Array(MAPS * SINK * SINK * 4); buf.fill(0);
    const reads: Promise<any>[] = [];
    const n = pan.n as THREE.Vector3, f = new THREE.Vector3(0, 0, 1).addScaledVector(n, -n.z).normalize(), sv = new THREE.Vector3().crossVectors(n, f);
    const maps: SinkMap[] = [{ idx: 0, name: "seat", o: pan.point, n, f, s: sv, box: [-pan.hw, pan.hw, -pan.rear - CS.pan_box[0], CS.pan_box[1]], R: pan.R, slab: 0 }];
    if (back) maps.push({ idx: 1, name: "backrest", o: back.o, n: back.n, f: back.up, s: back.sx, box: [...CS.back_box], R: 0, slab: 0 });
    maps.push(...this.slabMaps);
    renderer.autoClear = false; renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.shadowMap.needsUpdate = false;
    maps.forEach((mp) => {
      const k = mp.idx; setMap(Um, mp);
      renderer.clear(true, true, false); renderer.render(this.scene, this.cam);
      const part = buf.subarray(k * SINK * SINK * 4, (k + 1) * SINK * SINK * 4);
      if (moving) reads.push((renderer as any).readRenderTargetPixelsAsync(this.rt, 0, 0, SINK, SINK, part)); else renderer.readRenderTargetPixels(this.rt, 0, 0, SINK, SINK, part);
    });
    renderer.setRenderTarget(prev); renderer.autoClear = auto; renderer.setClearColor(cc, ca); renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowNeeds;
    const seq = ++this.seq;
    const fields = () => maps.forEach((mp) => rollField(buf.subarray(mp.idx * SINK * SINK * 4, (mp.idx + 1) * SINK * SINK * 4), mp.box));
    if (moving) { this.pending = true; Promise.all(reads).then(() => { if (this.seq !== seq) return; fields(); this.sink = buf; this.sig = sig; this.pose = { key: meshKey, p: pose }; }, () => {}).finally(() => { this.pending = false; }); }
    else { fields(); this.pending = false; this.sink = buf; this.sig = sig; this.pose = { key: meshKey, p: pose }; }
    this.stats.renders++; this.stats.ms += performance.now() - t0;
    return true;
  }
  /** The person's meshes as proxies with one material (same geometry, skeleton and bind matrix as drawn) in the pass's own scene. */
  private stage(list: THREE.SkinnedMesh[], mat: THREE.ShaderMaterial) {
    this.scene.clear();
    for (const me of list) {
      let px = this.proxies.get(me);
      if (!px || px.geometry !== me.geometry || px.skeleton !== me.skeleton) {     // same geometry, skeleton and bind matrix as the drawn mesh
        px = new THREE.SkinnedMesh(me.geometry, mat); px.bind(me.skeleton, me.bindMatrix); px.frustumCulled = false; px.matrixAutoUpdate = false; px.matrixWorldAutoUpdate = false; this.proxies.set(me, px); }
      px.material = mat; px.bindMode = me.bindMode; px.bindMatrix.copy(me.bindMatrix); px.morphTargetInfluences = me.morphTargetInfluences; px.morphTargetDictionary = me.morphTargetDictionary;
      px.matrixWorld.copy(me.matrixWorld); px.bindMatrixInverse.copy(me.bindMatrixInverse);    // mesh-local positions, as in the drawn mesh
      this.scene.add(px);
    }
  }
  /** How deep skin lies inside each shell (the pods' inner sides), before and after the contact, metres: the shells' maps drawn with
   *  the flatten off and then on, over all of the person's skin (no mask). For tests and reports (the CPU skinning has no contact). */
  shellDepths(meshes: THREE.SkinnedMesh[], renderer: THREE.WebGLRenderer, U: PersonUniforms): Record<string, { before: number; after: number; at?: number[] }> {
    const list = meshes.filter((me) => attached(me)), out: Record<string, { before: number; after: number; at?: number[] }> = {};
    if (!list.length || !this.slabMaps.length) return out;
    this.mat ??= sinkMaterial(U, true); this.matOn ??= sinkMaterial(U, false);
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear, cc = new THREE.Color(), ca = renderer.getClearAlpha(); renderer.getClearColor(cc);
    const shadowNeeds = renderer.shadowMap.needsUpdate, buf = new Float32Array(SINK * SINK * 4);
    renderer.autoClear = false; renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.shadowMap.needsUpdate = false;
    for (const mp of this.slabMaps) {
      const r: { before: number; after: number; at?: number[] } = { before: 0, after: 0 };
      for (const [key, mat] of [["before", this.mat], ["after", this.matOn]] as const) {
        const Um = mat.uniforms; Um.uMask.value.set(-100, 1, 0, 1); Um.uMaskX.value.set(100, 101); setMap(Um, mp);
        this.stage(list, mat); renderer.clear(true, true, false); renderer.render(this.scene, this.cam); renderer.readRenderTargetPixels(this.rt, 0, 0, SINK, SINK, buf);
        let at = -1; for (let i = 0; i < SINK * SINK; i++) if (buf[4 * i] > r[key]) { r[key] = buf[4 * i]; at = i; }
        if (key === "after" && at >= 0) r.at = [mp.box[0] + ((at % SINK) + 0.5) * (mp.box[1] - mp.box[0]) / SINK, mp.box[2] + (Math.floor(at / SINK) + 0.5) * (mp.box[3] - mp.box[2]) / SINK];
      }
      out[mp.name] = r;
    }
    renderer.setRenderTarget(prev); renderer.autoClear = auto; renderer.setClearColor(cc, ca); renderer.shadowMap.needsUpdate = shadowNeeds;
    return out;
  }
  private matOn: THREE.ShaderMaterial | null = null;
  dispose() { this.tex.dispose(); this.rt.dispose(); this.mat?.dispose(); this.matOn?.dispose(); }
}
/** One sink map's frame: its index (0 the pan, 1 the backrest, 2... the shells), origin, normal (v), forward (w), side (u), box
 *  [u from, to, w from, to] and front-edge radius; `slab` is the shell's row (0 for the pan and the backrest). */
interface SinkMap { idx: number; name: string; o: THREE.Vector3; n: THREE.Vector3; f: THREE.Vector3; s: THREE.Vector3; box: number[]; R: number; slab: number }
/** The sink pass's material: the person's vertex stage with the flatten off (the sink map) or on (shellDepths' after). */
function sinkMaterial(U: PersonUniforms, off: boolean): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({ defines: off ? { LAB_SINKPASS: 1 } : {}, side: THREE.DoubleSide,
    uniforms: { ...U, uProfile: { value: 0 }, uSlab: { value: 0 }, uP: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() }, uF: { value: new THREE.Vector3() }, uS: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector4() }, uR: { value: 0 }, uMask: { value: new THREE.Vector4() }, uMaskX: { value: new THREE.Vector2() } },
    vertexShader: SINK_VERTEX, fragmentShader: SINK_FRAGMENT });
  m.onBeforeCompile = (sh) => patchPersonVertex(sh); m.customProgramCacheKey = () => (off ? "person-sink-v2" : "person-sink-on-v2"); return m;
}
function setMap(Um: Record<string, THREE.IUniform>, mp: SinkMap) {
  Um.uProfile.value = mp.idx === 0 ? 1 : 0; Um.uSlab.value = mp.slab; Um.uP.value.copy(mp.o); Um.uN.value.copy(mp.n); Um.uF.value.copy(mp.f); Um.uS.value.copy(mp.s); Um.uBox.value.fromArray(mp.box); Um.uR.value = mp.R;
}
function attached(o: THREE.Object3D) { for (let p: THREE.Object3D | null = o; p; p = p.parent) { if (!p.visible) return false; if ((p as any).isScene) return true; } return false; }
/** The roll field of one sink map (64 x 64 RGBA, .r = sink depth): for every texel the area of tissue that the rim there has to
 *  take back (.g, metres^2 per metre of rim) and the direction toward the sink (.b, .a). Built once per map and smoothed, so
 *  neighbouring skin points get nearly the same roll: direction = gradient of the sink blurred over direction_blur texels; area
 *  = the sink integrated inward along it (the last steps fading); then area and direction blurred over area_blur texels. The sink
 *  itself (.r) is blurred only sink_blur. */
function rollField(m: Float32Array, box: number[]) {
  const N = SINK, du = (box[1] - box[0]) / N, dw = (box[3] - box[2]) / N, S = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) S[i] = m[4 * i];
  const blur = (src: Float32Array, sigma: number) => { const r = Math.ceil(2.5 * sigma), w: number[] = []; let ws = 0; for (let k = -r; k <= r; k++) { const v = Math.exp(-(k * k) / (2 * sigma * sigma)); w.push(v); ws += v; }
    const tmp = new Float32Array(N * N), dst = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let a = 0; for (let k = -r; k <= r; k++) { const xx = Math.min(N - 1, Math.max(0, x + k)); a += src[y * N + xx] * w[k + r]; } tmp[y * N + x] = a / ws; }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let a = 0; for (let k = -r; k <= r; k++) { const yy = Math.min(N - 1, Math.max(0, y + k)); a += tmp[yy * N + x] * w[k + r]; } dst[y * N + x] = a / ws; }
    return dst; };
  const at = (F: Float32Array, u: number, w: number) => { const tx = (u - box[0]) / du - 0.5, ty = (w - box[2]) / dw - 0.5; if (tx < 0 || ty < 0 || tx > N - 1 || ty > N - 1) return 0;
    const ix = Math.floor(tx), iy = Math.floor(ty), jx = Math.min(ix + 1, N - 1), jy = Math.min(iy + 1, N - 1), fx = tx - ix, fy = ty - iy;
    return (F[iy * N + ix] * (1 - fx) + F[iy * N + jx] * fx) * (1 - fy) + (F[jy * N + ix] * (1 - fx) + F[jy * N + jx] * fx) * fy; };
  const S5 = blur(S, RF.direction_blur), A = new Float32Array(N * N), DX = new Float32Array(N * N), DY = new Float32Array(N * N);
  const steps = RF.steps, full = steps - RF.fade_steps;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, gx = (S5[y * N + Math.min(N - 1, x + 1)] - S5[y * N + Math.max(0, x - 1)]) / (2 * du), gy = (S5[Math.min(N - 1, y + 1) * N + x] - S5[Math.max(0, y - 1) * N + x]) / (2 * dw), gl = Math.hypot(gx, gy);
    if (gl < 1e-4) continue;
    const dx = gx / gl, dy = gy / gl, u = box[0] + (x + 0.5) * du, w = box[2] + (y + 0.5) * dw; let a = 0;
    for (let k = 0; k < steps; k++) { const s = RF.start + RF.step * k; a += at(S, u + dx * s, w + dy * s) * RF.step * (k < full ? 1 : (steps - k) / RF.fade_steps); }
    A[i] = a; DX[i] = dx; DY[i] = dy;
  }
  const Ab = blur(A, RF.area_blur), Xb = blur(DX, RF.area_blur), Yb = blur(DY, RF.area_blur), S08 = blur(S, RF.sink_blur);
  for (let i = 0; i < N * N; i++) { const l = Math.hypot(Xb[i], Yb[i]); m[4 * i] = S08[i]; m[4 * i + 1] = Ab[i]; m[4 * i + 2] = l > 1e-6 ? Xb[i] / l : 0; m[4 * i + 3] = l > 1e-6 ? Yb[i] / l : 0; }
}
/** Closest points of two segments (p1-q1, p2-q2): parameters s, t in 0..1. */
export function closestOnSegments(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): [number, number] {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2), a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  if (a < 1e-10 && e < 1e-10) return [0, 0];
  if (a < 1e-10) return [0, THREE.MathUtils.clamp(f / e, 0, 1)];
  const c = d1.dot(r); if (e < 1e-10) return [THREE.MathUtils.clamp(-c / a, 0, 1), 0];
  const b = d1.dot(d2), den = a * e - b * b; let s = den > 1e-10 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
  return [s, t];
}
