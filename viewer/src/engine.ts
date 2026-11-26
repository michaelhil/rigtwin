// The 3D side of the rig viewer: renderer, scene, model loading, visibility, joints, cameras, the
// highlight outline, and the programmatic interface (`window.viewer`, also driven by URL parameters).
// It knows nothing about the page's panels; ui.ts and interact.ts listen to `on(...)` and call in.
//
// Model frame (manifest, joints, cameras): metres, Z up, X forward, Y to the operator's left.
// three.js world is Y up; the GLB root node carries the conversion (x, y, z) -> (x, z, -y).
//
// Drawing is on demand: a frame is drawn only after `invalidate()` (something changed) or while the
// camera is still gliding. An idle page draws nothing.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { poseFromRest, limitViolation, type JointValue, type Trs } from '../../shared/pose.ts';
import type { Manifest, ManifestComponent, ManifestJoint, PhotoCamera, Box } from '../../shared/manifest.ts';
import { UNITS, WHOLE_ROWS, partName, rowName } from '../../shared/words.ts';

export type Opts = Record<string, unknown>;
export interface JointState { def: ManifestJoint; obj: THREE.Object3D; rest: Trs; value: JointValue }
export interface PartRow { id: string; name: string; parts: string[] }
export type Change = 'visibility' | 'selection' | 'hover' | 'joints' | 'mode' | 'view' | 'camera' | 'stale';

export const Q = new URLSearchParams(location.search);
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const el = (tag: string, cls?: string | null, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
/** Every address is counted from the site root: the page lives at /workspaces/<id>, where a relative one would not find the model. */
const fromRoot = (p: string) => (/^([a-z][a-z0-9+.-]*:|\/)/i.test(p) ? p : `/${p}`).replace(/\/+$/, '');
const ASSET_DIR = fromRoot(Q.get('asset') ?? 'asset'), ASSET = Q.get('name') ?? 'rig-b';
/** Extension points, so the engine need not know the modules that use them (live.ts, the shared scene):
 *  beforeApply and onApply run when `apply` starts and finishes resetting the page (with the URL options). */
export const hooks = {
  beforeApply: [] as ((o: Opts) => void)[],
  onApply: [] as ((o: Opts) => void)[],
  /** runs at the start of every drawn frame (the person module advances its pose here, person/index.ts) */
  beforeRender: [] as (() => void)[],
  /** a click on the 3D view, asked before the rig is picked (`rig`: distance to the rig there, or Infinity): true takes it (person-panel.ts) */
  click: [] as ((x: number, y: number, rig: number, additional: boolean) => boolean)[],
  /** the operator's eye when a person sits in the seat (person/index.ts): model frame, or null for the rig's own eye point */
  operatorGaze: [] as (() => number[] | null)[],
  operatorEye: [] as (() => number[] | null)[],
};
const CAMERAS_URL = ASSET === 'rig-b' ? '/private/evidence/cameras.json' : `/private/evidence/${ASSET}/cameras.json`;   // each further asset keeps its own solved cameras
export const DEG = Math.PI / 180;
export const m2w = (p: number[]) => new THREE.Vector3(p[0], p[2], -p[1]);          // model frame -> three world
export const w2m = (v: THREE.Vector3): number[] => [v.x, -v.z, v.y];
const STAGE_BOX: Box = { min: [-1.0, -1.0, -0.3], max: [1.0, 1.0, 1.6] }; // fixed framing for orthographic views (model frame)
export const CLASS_COLORS: Record<string, string> = { measured: '#2e9e5b', vendor: '#2f7fd1', photo: '#e0a526', assumed: '#d9603b', invented: '#9a55c4', none: '#8a8f98' };
const CLASS_TEXT: Record<string, string> = { measured: 'measured on the rig', vendor: 'vendor data', photo: 'estimated from photos', assumed: 'assumed', invented: 'invented (modelling device)' };
export const VIEWS: Record<string, { label: string; hint: string; dir?: number[]; up?: number[]; special?: boolean; listed?: boolean }> = {
  three_quarter: { label: 'Overview', hint: 'From behind the operator’s left shoulder', dir: [-0.74, -0.6, 0.44], listed: true },
  front: { label: 'Front', hint: 'From the monitor end, looking at the operator', dir: [1, 0, 0], listed: true },
  rear: { label: 'Back', hint: 'From behind the seat', dir: [-1, 0, 0], listed: true },
  left: { label: 'Left', hint: 'From the operator’s left', dir: [0, 1, 0], listed: true },
  right: { label: 'Right', hint: 'From the operator’s right', dir: [0, -1, 0], listed: true },
  top: { label: 'Top', hint: 'From above, forward is up', dir: [0, 0, 1], up: [1, 0, 0], listed: true },
  front_quarter: { label: 'Front corner', hint: 'From the front left corner', dir: [0.72, 0.62, 0.4] },
  operator: { label: 'Operator’s eye', hint: 'What the operator sees; drag to look around, scroll to zoom', special: true, listed: true },
};

// --------------------------------------------------------------------------------------------- change notices
const listeners: ((c: Change) => void)[] = [];
export const on = (fn: (c: Change) => void) => { listeners.push(fn); };
const emit = (c: Change) => { for (const f of listeners) f(c); };

// --------------------------------------------------------------------------------------------- renderer and scene
let gesture = 0;                                                                                                           // a pointer or wheel gesture on the view is in progress (or still gliding out)
let scheduled = false, needsRender = true, drawn = 0, fps = 0, lastDraw = 0, avgDt = 0;                                   // drawing on demand (see the end of the file)
let anim: { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number; ms: number } | null = null;   // camera glide in progress
export const canvas = $<HTMLCanvasElement>('gl'), frameEl = $('frame'), stageEl = $('stage');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
// Lighting. Fully lit white parts should land around 200-225 of 255 (not clipped), white facets turned away from the key light
// clearly darker so the form of the shells reads, and the blacks should keep their differences. One directional key from
// behind the operator's right shoulder, a weak cool fill from the opposite side, and a dimmed studio environment for the
// reflections. `look=previous` in the address restores the earlier, brighter setting (for comparing renders across versions);
// `look=exposure:0.9,env:0.5,key:2,fill:0.3` tries other numbers.
// The tone curve: straight (what the lights give is what is shown) up to 0.6, then a soft shoulder so highlights on the
// gloss white roll off instead of clipping. Unlike the stock "neutral" curve it takes nothing away near black, which is
// what made leather, deck and matte plastic sink into one another.
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', `vec3 CustomToneMapping( vec3 color ) {
  const float start = 0.6, desaturation = 0.15;
  color *= toneMappingExposure;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < start ) return color;
  float d = 1.0 - start, newPeak = 1.0 - d * d / ( peak + d - start );
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
  return mix( color, vec3( newPeak ), g );
}`);
const TONES = [THREE.NeutralToneMapping, THREE.AgXToneMapping, THREE.ACESFilmicToneMapping, THREE.CustomToneMapping];
const LOOKS: Record<string, { exposure: number; env: number; key: number; fill: number; tone: number; kx: number; ky: number; kz: number }> = {
  now: { exposure: 0.78, env: 0.6, key: 2.0, fill: 0.3, tone: 3, kx: -2.4, ky: -1.8, kz: 3.0 },
  previous: { exposure: 1.0, env: 1.0, key: 2.6, fill: 0.5, tone: 0, kx: -1.6, ky: -2.2, kz: 3.6 },
};
const LOOK = { ...LOOKS.now };
{ const q = Q.get('look'); if (q && LOOKS[q]) Object.assign(LOOK, LOOKS[q]); else if (q) for (const part of q.split(',')) { const [k, v] = part.split(':'); if (k in LOOK && isFinite(Number(v))) (LOOK as Record<string, number>)[k] = Number(v); } }
renderer.toneMapping = TONES[LOOK.tone] ?? THREE.NeutralToneMapping;
renderer.toneMappingExposure = LOOK.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
export const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = LOOK.env;
const key = new THREE.DirectionalLight(0xffffff, LOOK.key);
key.position.copy(m2w([LOOK.kx, LOOK.ky, LOOK.kz]));        // model frame: behind the operator, to the right, above
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -1.9, right: 1.9, top: 1.9, bottom: -1.9, near: 0.5, far: 9 });
key.shadow.bias = -0.0003; key.shadow.normalBias = 0.012; key.shadow.radius = 4;
scene.add(key, key.target);
/** the key light (its shadow camera sizes the person's own soft-shadow filter, person/shaders.ts) */
export const keyLight = key;
const fill = new THREE.DirectionalLight(0xdfe8ff, LOOK.fill);
fill.position.copy(m2w([2.5, 2.0, 1.6]));
scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.3 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);

export const persp = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 60);
const photoCam = new THREE.PerspectiveCamera(50, 1, 0.05, 60);
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = persp;
export const currentCamera = () => camera;
export const controls = new OrbitControls(persp, canvas);
const LIMITS = { minDistance: 0.25, maxDistance: 9, minPolar: 0, maxPolar: Math.PI * 0.56, rotateSpeed: 1 };
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.minDistance = LIMITS.minDistance; controls.maxDistance = LIMITS.maxDistance; controls.maxPolarAngle = LIMITS.maxPolar;
controls.minZoom = 0.4; controls.maxZoom = 12;
controls.zoomToCursor = true; controls.zoomSpeed = 3;      // toward the pointer, about three times the stock step per wheel notch
controls.addEventListener('start', () => {
  if (camera.up.y !== 1) { camera.up.set(0, 1, 0); }
  if (S.view === 'operator' && !S.look) enterLook();
  gesture = 1;
});
controls.addEventListener('end', () => { gesture = 2; invalidate(); });      // a wheel step ends before the camera has moved: the next update still counts as the person's
controls.addEventListener('change', () => {
  const t = controls.target; t.x = THREE.MathUtils.clamp(t.x, -1.5, 1.5); t.y = THREE.MathUtils.clamp(t.y, -0.4, 2); t.z = THREE.MathUtils.clamp(t.z, -1.5, 1.5);
  if (gesture && !anim && !S.userMoved) { S.userMoved = true; emit('view'); }     // the person moved the camera: it is no longer "the front view"
  invalidate(); emit('camera');
});

// --------------------------------------------------------------------------------------------- state
export const S = {
  manifest: null as unknown as Manifest, root: null as unknown as THREE.Object3D,
  objects: new Map<string, THREE.Object3D>(), meshes: [] as THREE.Mesh[], items: [] as ManifestComponent[], byId: new Map<string, ManifestComponent>(), children: new Map<string, string[]>(),
  joints: new Map<string, JointState>(), hidden: new Set<string>(), mode: 'normal', wire: false, frames: false, hover: null as string | null, selected: null as string | null,
  cameras: null as Record<string, PhotoCamera> | null, photo: null as (PhotoCamera & { name: string }) | null, overlay: 'none', orthoHalf: 1, view: 'three_quarter' as string | null, aspect: null as number | null, hud: false, legend: false,
  shadowDirty: true, outlineDirty: false, helperList: null as THREE.Object3D[] | null,
  /** the operator's view at another sitting eye height (metres above the seat), or null for the median eye point */
  eyeHeight: null as number | null,
  /** the operator's view from a given eye point (look with a person in the seat: the server's solved eye), kept in the median
   *  eye point's own frame so that it rides with the seat as the eye points do; null: eyeHeight or the median eye point */
  eyeLocal: null as number[] | null,
  eyeTracksPerson: false,
  eyeDirection: null as number[] | null,
  /** the person has moved the camera since the last named view was set */
  userMoved: false,
  /** what the current named view was framed on (fit=), if anything */
  fit: null as string[] | null,
  /** operator's-eye view in look-around mode (head turns in place) */
  look: false,
  rows: [] as PartRow[], rowOf: new Map<string, string>(), unitOf: new Map<string, string>(), units: new Map<string, { id: string; name: string; parts: string[] }>(),
  /** true while apply() is setting a requested state: nothing may then move the camera on its own */
  applying: false,
  maskOn: false, info: { triangles: 0, calls: 0 }, dev: false, stale: false,
};
// A component node can itself be the mesh and carry child components, so hiding must not use
// Object3D.visible (that would hide the children too): hidden meshes get an invisible material instead.
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
export const shown = (m: THREE.Mesh) => m.material !== HIDDEN;
export const idColor = new Map<string, THREE.Color>();
const matCache = new Map<string, THREE.Material>();
export const status = (msg: string | null, error = false) => { const s = $('status'); s.hidden = !msg; s.textContent = msg ?? ''; s.classList.toggle('error', !!error); };

// --------------------------------------------------------------------------------------------- load
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Manifest and GLB that belong together. Another build may replace the files between the two requests,
 *  so the GLB's checksum is compared with the manifest's and both are fetched again on a mismatch. */
async function fetchAsset(base: string): Promise<{ manifest: Manifest; glb: ArrayBuffer }> {
  let last = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 150 * attempt));
    const mres = await fetch(`${base}.manifest.json`, { cache: 'no-store' });
    if (!mres.ok) throw new Error(`Cannot load ${base}.manifest.json (${mres.status}). Run "bun run build" and open the viewer through "bun run serve".`);
    let manifest: Manifest;
    try { manifest = await mres.json(); } catch { last = 'the description file was incomplete'; continue; }   // caught mid-write
    const gres = await fetch(`${base}.glb?v=${manifest.glb.sha256.slice(0, 12)}`, { cache: 'no-store' });
    if (!gres.ok) { last = `the model file answered ${gres.status}`; continue; }
    const glb = await gres.arrayBuffer();
    if (globalThis.crypto?.subtle) {
      const sum = hex(await crypto.subtle.digest('SHA-256', glb));
      if (sum !== manifest.glb.sha256) { last = 'the model was being rebuilt'; continue; }
    }
    return { manifest, glb };
  }
  throw new Error(`Cannot load the model: ${last}. Reload the page in a moment.`);
}
export async function load() {
  const base = `${ASSET_DIR}/${ASSET}`;
  const { manifest, glb } = await fetchAsset(base);
  S.manifest = manifest;
  const gltf = await new GLTFLoader().parseAsync(glb, `${ASSET_DIR}/`);
  S.root = gltf.scene;
  scene.add(S.root);
  S.root.updateMatrixWorld(true);
  S.root.traverse((o) => { if (o.userData?.id) S.objects.set(o.userData.id, o); });

  // items = everything that can be shown or hidden: components and surfaces
  const all: ManifestComponent[] = [];
  for (const c of manifest.components) { all.push(c); for (const s of manifest.surfaces) if (s.parent === c.id) all.push(s); }
  let colorIndex = 0;
  for (const it of all) {
    S.byId.set(it.id, it);
    const par = it.parent ?? '';
    if (!S.children.has(par)) S.children.set(par, []);
    S.children.get(par)!.push(it.id);
    if (it.triangles > 0) { idColor.set(it.id, new THREE.Color().setHSL((colorIndex * 0.618034) % 1, 0.62, [0.5, 0.62, 0.4][colorIndex % 3])); colorIndex++; }
  }
  S.items = all;
  S.root.traverse((obj) => {
    const o = obj as THREE.Mesh;
    if (!o.isMesh) return;
    let p: THREE.Object3D | null = o;
    while (p && !(p.userData?.kind === 'component' || p.userData?.kind === 'surface')) p = p.parent;
    o.userData.comp = p?.userData.id; o.userData.orig = o.material;
    const surface = p?.userData.kind === 'surface';
    o.castShadow = !surface; o.receiveShadow = !surface;
    S.meshes.push(o);
  });
  for (const j of manifest.joints) {
    const o = S.objects.get(j.id);
    if (o) S.joints.set(j.id, { def: j, obj: o, rest: { t: o.position.toArray(), q: o.quaternion.toArray() as [number, number, number, number] }, value: j.neutral });
  }
  const floor = manifest.datums.find((d) => d.id === 'D_floor');
  ground.position.y = floor ? floor.origin[2] - 0.0005 : manifest.totals.bbox.min[2];
  S.dev = !!document.querySelector('meta[name=synergon-dev]');
  if (S.dev) { // local dev server only; never requested by a deployed copy
    try { const r = await fetch(CAMERAS_URL, { cache: 'no-store' }); if (r.ok) S.cameras = (await r.json()).cameras ?? null; } catch { /* photo cameras are optional */ }
    // other people rebuild the model while this page is open: say so when the window is looked at again
    const check = async () => {
      if (document.hidden || S.stale) return;
      try { const r = await fetch(`${base}.manifest.json`, { cache: 'no-store' }); const m = await r.json(); if (m?.glb?.sha256 && m.glb.sha256 !== manifest.glb.sha256) { S.stale = true; emit('stale'); } } catch { /* mid-write; the next look will tell */ }
    };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
  }
  buildRows();
  document.title = `${manifest.title} viewer`;
}

// --------------------------------------------------------------------------------------------- parts: rows, units, what a click picks
const hasMesh = (id: string) => (S.byId.get(id)?.triangles ?? 0) > 0;
/** ids covered by a tree row: itself if it has a mesh, plus (for assemblies and groups) its descendants in the same group */
function covered(id: string): string[] {
  if (S.manifest.groups.includes(id)) return S.items.filter((i) => i.group === id && i.triangles > 0).map((i) => i.id);
  const it = S.byId.get(id);
  if (!it) return [];
  const out: string[] = [];
  const walk = (x: string) => {
    const xi = S.byId.get(x)!;
    if (xi.triangles > 0) out.push(x);
    for (const c of S.children.get(x) ?? []) if (S.byId.get(c)!.group === it.group || S.byId.get(c)!.kind === 'surface') walk(c);
  };
  if (it.assembly) walk(id); else { out.push(id); for (const c of S.children.get(id) ?? []) if (S.byId.get(c)!.kind === 'surface') out.push(c); }
  return out.filter(hasMesh);
}
const memberCache = new Map<string, string[]>();
/** Everything with a shape that an id stands for: a group, an assembly, a unit (joystick, touchscreen) or one part with its screen surface. */
export function members(id: string): string[] {
  let m = memberCache.get(id);
  if (!m) { const u = S.units.get(id); m = u ? [...new Set(u.parts.flatMap(covered))] : covered(id); memberCache.set(id, m); }
  return m;
}
export const known = (id: string) => S.byId.has(id) || S.manifest.groups.includes(id) || S.units.has(id);
function expand(list: string[]): string[] { return [...new Set(list.flatMap((x) => { const c = members(x); if (!c.length && !known(x)) throw new Error(`unknown component or group '${x}'`); return c; }))]; }
/** The six-or-so rows of the parts list: one per group; a group made only of two or more assemblies gives one row per assembly. */
function buildRows() {
  const m = S.manifest;
  for (const g of m.groups) {
    const comps = m.components.filter((c) => c.group === g), inGroup = new Set(comps.map((c) => c.id));
    const tops = comps.filter((c) => !c.parent || !inGroup.has(c.parent));
    const ids = tops.length >= 2 && tops.every((t) => t.assembly) ? tops.map((t) => t.id) : [g];
    for (const id of ids) {
      const parts = covered(id).filter((x) => S.byId.get(x)!.kind === 'component');
      if (!parts.length) continue;
      const top = id === g ? (tops.length === 1 ? tops[0].label : g) : S.byId.get(id)!.label;
      S.rows.push({ id, name: rowName(id, top), parts });
      for (const p of parts) S.rowOf.set(p, id);
    }
  }
  for (const u of UNITS) if (u.parts.every(hasMesh)) { S.units.set(u.id, u); for (const p of u.parts) S.unitOf.set(p, u.id); }
}
/** A screen surface belongs to its monitor or touchscreen: nobody hides only the picture. */
export const partOf = (id: string) => { const it = S.byId.get(id); return it?.kind === 'surface' && it.parent ? it.parent : id; };
/** What a first click on a part picks: its unit (joystick, touchscreen), its whole row (seat, platform, pedals) or the part itself. */
export function firstPick(part: string): string {
  const u = S.unitOf.get(part); if (u) return u;
  const r = S.rowOf.get(part); return r && WHOLE_ROWS.includes(r) ? r : part;
}
export type SelKind = 'row' | 'unit' | 'part';
export const kindOf = (id: string): SelKind => (S.rows.some((r) => r.id === id) ? 'row' : S.units.has(id) ? 'unit' : 'part');
export function nameOf(id: string): string {
  const row = S.rows.find((r) => r.id === id); if (row) return row.name;
  const u = S.units.get(id); if (u) return u.name;
  const it = S.byId.get(id); return it ? partName(it).full : id;
}
/** The thing an id belongs to, one level up (part -> unit -> row), or null for a row. */
export function ownerOf(id: string): string | null {
  const k = kindOf(id);
  if (k === 'row') return null;
  if (k === 'unit') return S.rowOf.get(S.units.get(id)!.parts[0]) ?? null;
  return S.unitOf.get(id) ?? S.rowOf.get(id) ?? null;
}

// --------------------------------------------------------------------------------------------- materials, visibility
function variant(mat: THREE.Material, kind: string, make: () => THREE.Material): THREE.Material {
  const k = mat.uuid + kind;
  if (!matCache.has(k)) matCache.set(k, make());
  return matCache.get(k)!;
}
function flat(kind: string, id: string, color: THREE.ColorRepresentation): THREE.Material {
  const k = kind + id;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 }));
  return matCache.get(k)!;
}
/** Materials follow the colour mode, wireframe and visibility only. Hover and selection are drawn as an
 *  outline on top (drawHighlight), so pointing at parts never touches materials or shadows. */
function applyMaterials() {
  for (const m of S.meshes) {
    const id: string = m.userData.comp, it = S.byId.get(id);
    let mat: THREE.Material = m.userData.orig;
    // 'plain': the model without its optional texture layer (materials the GLB marks optional_texture lose their map and get their flat colour)
    if (S.mode === 'plain' && mat.userData?.optional_texture) { const o = mat as THREE.MeshStandardMaterial; mat = variant(o, 'plain', () => { const c = o.clone(); c.map = null; c.color.multiplyScalar(Number(o.userData.texture_gain ?? 1)); return c; }); }
    if (S.mode === 'ids') mat = flat('id', id, idColor.get(id) ?? new THREE.Color('#888'));
    else if (S.mode === 'class') { const c = it?.class ?? S.byId.get(it?.parent ?? '')?.class ?? 'none'; mat = flat('class', c, CLASS_COLORS[c]); }
    const lit = mat as THREE.MeshStandardMaterial;
    if (S.wire) mat = variant(lit, 'wire', () => { const c = lit.clone(); c.wireframe = true; return c; });
    m.material = S.hidden.has(id) ? HIDDEN : mat;
  }
  S.shadowDirty = true; S.outlineDirty = true;
  updateMask(); refreshLegend(); invalidate();
}
export function setVisible(list: string[], on: boolean) { for (const id of expand(list)) on ? S.hidden.delete(id) : S.hidden.add(id); applyMaterials(); emit('visibility'); }
export function showOnly(list: string[]) { const keep = new Set(expand(list)); S.hidden = new Set(S.items.filter((i) => i.triangles > 0 && !keep.has(i.id)).map((i) => i.id)); applyMaterials(); emit('visibility'); }
export function showAll() { S.hidden.clear(); applyMaterials(); emit('visibility'); }
export function hideAll() { S.hidden = new Set(S.items.filter((i) => i.triangles > 0).map((i) => i.id)); applyMaterials(); emit('visibility'); }
/** 'shown' | 'hidden' | 'mixed' for a row, unit or part */
export function visibilityOf(id: string): 'shown' | 'hidden' | 'mixed' {
  const ids = members(id), off = ids.filter((x) => S.hidden.has(x)).length;
  return off === 0 ? 'shown' : off === ids.length ? 'hidden' : 'mixed';
}

// --------------------------------------------------------------------------------------------- hover and selection
export function setHover(id: string | null) { if (S.hover === id) return; S.hover = id; updateMask(); invalidate(); emit('hover'); }
/** Select a row, unit or part by id; null clears. */
export function select(id: string | null) {
  if (id !== null && !known(id)) throw new Error(`unknown component or group '${id}'`);
  if (S.selected === id) return;
  S.selected = id; updateMask(); invalidate(); emit('selection');
}

// --------------------------------------------------------------------------------------------- joints
/** Pose one joint. Values are SI (radians, metres); ball joints take [roll, pitch, yaw]. Uses shared/pose.ts. */
export function setJoint(id: string, value: JointValue, opts: { force?: boolean } = {}) {
  const j = S.joints.get(id);
  if (!j) throw new Error(`unknown joint '${id}'`);
  if (j.def.locked && !opts.force) throw new Error(`joint '${id}' is locked (assumed; fixed at neutral)`);
  const bad = limitViolation(j.def, value);
  if (bad) throw new Error(`joint '${id}': ${bad}`);
  poseJoint(j, value);
  S.shadowDirty = true; S.outlineDirty = true; followEye();
  invalidate(); emit('joints');
}
/** The median eye point and the centre of the main screen as they are now, in the model frame. The eye points hang under
 *  the seat frame, so the seat's height, slide, swivel and tilt move them (the backrest's recline does not: they are
 *  placed for the photographed recline); the screen moves with the monitor. Before 2026-11-24 the operator's view used
 *  the eye point as photographed, so a moved seat left the camera where it was. */
function eyeAndScreenNow(): { e: number[]; t: number[] } {
  S.root.updateMatrixWorld(true);
  const at = (id: string) => { const o = S.objects.get(id); return o ? w2m(o.getWorldPosition(new THREE.Vector3())) : null; };
  let e = at('D_eye_median') ?? at('D_eye_provisional') ?? S.manifest.datums.find((d) => d.id === 'D_eye_median')?.origin ?? [-0.6, 0, 1.2];
  // another sitting eye height: the eye points of the three sizes lie on one line (the torso line), so a height between
  // or beyond them is found along it, from the description file's eye heights (seat.eye_height_median, _large)
  const hm = S.manifest.parameters['seat.eye_height_median']?.value, hl = S.manifest.parameters['seat.eye_height_large']?.value, large = at('D_eye_large');
  const median = S.objects.get('D_eye_median');
  const personEye = hooks.operatorEye.map((f) => f()).find((x) => x) ?? null;
  if (personEye && S.eyeTracksPerson) e = personEye;
  else if (S.eyeLocal && median) e = w2m(median.localToWorld(new THREE.Vector3().fromArray(S.eyeLocal)));     // a given eye point (look with a person)
  else if (personEye && S.eyeHeight === null) e = personEye;                                                                       // the eye of the person in the seat, as this page draws it
  else if (S.eyeHeight !== null && typeof hm === 'number' && typeof hl === 'number' && hl !== hm && large) {
    const k = (S.eyeHeight - hm) / (hl - hm); e = e.map((x, i) => x + k * (large[i] - x));
  }
  const t = at('S_mon_screen') ?? S.manifest.surfaces.find((s) => s.id === 'S_mon_screen')?.origin ?? [e[0] + 1, 0, e[2]];
  return { e, t };
}
/** where the operator's-view camera last put the eye (three world), so that it can ride with it */
let lastEye: THREE.Vector3 | null = null;
/** In the operator's view the camera rides with the eye point: a seat change moves it, and the line of sight stays. */
/** The operator's view rides with the eye point (exported for the person module: the eye moves when a person is seated or reshaped). */
export function refollowEye() { followEye(); invalidate(); }
function followEye() {
  if (S.view !== 'operator' || !lastEye || camera !== persp || S.photo) return;
  const now = m2w(eyeAndScreenNow().e), d = now.clone().sub(lastEye);
  const direction = !S.userMoved && !S.look ? operatorDirection() : null;
  if (!direction && d.lengthSq() < 1e-12) return;
  persp.position.add(d); controls.target.add(d); lastEye = now;
  if (direction) controls.target.copy(now).addScaledVector(m2w(direction).normalize(), LIMITS.minDistance * 1.2);
  controls.update();
}
/** Move a joint node without any notice or redraw (used for trial moves while a part is dragged). */
export function poseJoint(j: JointState, value: JointValue) {
  const { t, q } = poseFromRest(j.rest, j.def, value);
  j.obj.position.fromArray(t); j.obj.quaternion.fromArray(q);
  j.value = value;
}
export function resetJoints(only?: string[]) {
  for (const [id, j] of S.joints) { if (only && !only.includes(id)) continue; j.obj.position.fromArray(j.rest.t); j.obj.quaternion.fromArray(j.rest.q); j.value = j.def.neutral; }
  S.shadowDirty = true; S.outlineDirty = true; followEye(); invalidate(); emit('joints');
}
const same = (a: JointValue, b: JointValue) => (Array.isArray(a) ? a.every((x, i) => Math.abs(x - (b as number[])[i]) < 1e-6) : Math.abs(a - (b as number)) < 1e-6);
/** joints that are away from their as-photographed value */
export const movedJoints = () => [...S.joints].filter(([, j]) => !same(j.value, j.def.neutral)).map(([id]) => id);
/** An adjustment nobody has seen in the photos: its existence and range are assumed. */
export const isAssumed = (d: ManifestJoint) => d.evidence === 'assumed' || d.locked;
export const assumedInUse = () => movedJoints().filter((id) => isAssumed(S.joints.get(id)!.def));
/** One number of a joint (the joint itself, or angle `comp` of a three-angle mount), clamped to its limits. Works for assumed joints too. */
export function setAdjustment(joint: string, comp: number | null, v: number) {
  const j = S.joints.get(joint); if (!j) return;
  const d = j.def;
  if (comp === null) setJoint(joint, Math.min(d.upper, Math.max(d.lower, v)), { force: true });
  else { const n = (d.neutral as number[])[comp], a = (j.value as number[]).slice(); a[comp] = Math.min(n + d.upper, Math.max(n + d.lower, v)); setJoint(joint, a, { force: true }); }
}
export const adjustmentValue = (joint: string, comp: number | null) => { const v = S.joints.get(joint)!.value; return comp === null ? (v as number) : (v as number[])[comp]; };
export function adjustmentRange(joint: string, comp: number | null) {
  const d = S.joints.get(joint)!.def, n = comp === null ? (d.neutral as number) : (d.neutral as number[])[comp];
  return comp === null ? { lo: d.lower, hi: d.upper, neutral: n } : { lo: n + d.lower, hi: n + d.upper, neutral: n };
}
/** Joints that move a selection. A row or assembly: every joint inside it. A part: the joints that carry it, nearest first, inside its own group. */
export function jointsFor(id: string): string[] {
  const k = kindOf(id), out: string[] = [];
  const add = (comp: string) => { for (const [jid, j] of S.joints) if (j.def.child === comp && !out.includes(jid)) out.push(jid); };
  const forPart = (part: string) => { const g = S.byId.get(part)?.group; for (let p: string | null = part; p && S.byId.get(p)?.group === g; p = S.byId.get(p)?.parent ?? null) add(p); };
  if (k === 'unit') for (const p of S.units.get(id)!.parts) forPart(p);
  else if (k === 'row' || S.byId.get(id)?.assembly) {
    const inside = new Set<string>();
    if (S.manifest.groups.includes(id)) for (const c of S.manifest.components) { if (c.group === id) inside.add(c.id); }
    else { const g = S.byId.get(id)!.group; const walk = (x: string) => { inside.add(x); for (const c of S.children.get(x) ?? []) if (S.byId.get(c)!.group === g) walk(c); }; walk(id); }
    for (const [jid, j] of S.joints) if (inside.has(j.def.child)) out.push(jid);
  } else forPart(id);
  return out;
}

// --------------------------------------------------------------------------------------------- cameras and views
export function frameSize() { return { w: frameEl.clientWidth || 1, h: frameEl.clientHeight || 1 }; }
export function layout() {
  const sw = stageEl.clientWidth, sh = stageEl.clientHeight;
  if (S.aspect) { const w = Math.min(sw, sh * S.aspect); frameEl.style.width = `${Math.round(w)}px`; frameEl.style.height = `${Math.round(w / S.aspect)}px`; }
  else { frameEl.style.width = '100%'; frameEl.style.height = '100%'; }
  const { w, h } = frameSize();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  persp.aspect = w / h; persp.updateProjectionMatrix();
  ortho.left = -S.orthoHalf * (w / h); ortho.right = S.orthoHalf * (w / h); ortho.top = S.orthoHalf; ortho.bottom = -S.orthoHalf; ortho.updateProjectionMatrix();
  const ov = $<HTMLCanvasElement>('overlay'); ov.width = w; ov.height = h;
  S.outlineDirty = true; invalidate();
}
function boxCorners(b: Box) { const c: THREE.Vector3[] = []; for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) c.push(m2w([x, y, z])); return c; }
function useCamera(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
  camera = cam; (controls as { object: THREE.Camera }).object = cam === photoCam ? persp : cam; controls.enabled = cam !== photoCam;
}
function leavePhoto() { if (S.photo) { S.photo = null; S.aspect = null; setOverlay('none'); layout(); } }
/** Operator's eye, look-around mode: the head turns in place (the orbit point sits a centimetre in front of the eye) and the wheel changes the field of view instead of flying forward. */
function enterLook() {
  S.look = true;
  const d = controls.target.clone().sub(persp.position).normalize();
  controls.target.copy(persp.position).addScaledVector(d, 0.01);
  controls.minDistance = controls.maxDistance = 0.01; controls.enablePan = false; controls.enableZoom = false;
  controls.rotateSpeed = -0.3; controls.minPolarAngle = Math.PI * 0.2; controls.maxPolarAngle = Math.PI * 0.8;
  controls.update();
}
function leaveLook() {
  if (!S.look) return;
  S.look = false;
  controls.minDistance = LIMITS.minDistance; controls.maxDistance = LIMITS.maxDistance; controls.enablePan = true; controls.enableZoom = true;
  controls.rotateSpeed = LIMITS.rotateSpeed; controls.minPolarAngle = LIMITS.minPolar; controls.maxPolarAngle = LIMITS.maxPolar;
}
/** In look-around mode: narrow or widen the field of view (the eye stays where it is). */
export function lookZoom(factor: number) { persp.fov = THREE.MathUtils.clamp(persp.fov * factor, 20, 95); persp.updateProjectionMatrix(); invalidate(); emit('camera'); }
function operatorDirection() {
  if (!S.eyeTracksPerson) return S.eyeDirection;
  if (hooks.operatorEye.some((f) => f())) return hooks.operatorGaze.map((f) => f()).find((x) => x) ?? null;
  return S.eyeDirection;
}

export function setView(name: string, opts: { ortho?: boolean; fit?: string[] | null; eye?: number | null; eyePoint?: number[] | null; eyeDirection?: number[] | null; followPerson?: boolean } = {}) {
  const v = VIEWS[name];
  if (!v) throw new Error(`unknown view '${name}' (${Object.keys(VIEWS).join(', ')})`);
  leavePhoto(); leaveLook(); anim = null; gesture = 0;
  S.view = name; S.userMoved = false; S.fit = opts.fit ?? null;
  const wantOrtho = opts.ortho ?? (camera === ortho);
  const { w, h } = frameSize();
  if (v.special) { // operator's eye, where the eye point and the screen are now (they move with the seat and the monitor)
    S.eyeHeight = opts.eye ?? null; S.eyeLocal = null;
    S.eyeTracksPerson = opts.followPerson ?? (opts.eye == null && opts.eyePoint == null);
    S.eyeDirection = opts.eyeDirection ?? null;
    const median = S.objects.get('D_eye_median');
    if (opts.eyePoint?.length === 3 && median) { S.root.updateMatrixWorld(true); S.eyeLocal = median.worldToLocal(m2w(opts.eyePoint)).toArray(); }
    const { e, t } = eyeAndScreenNow();
    lastEye = m2w(e);
    // the camera sits exactly on the eye point; the orbit point lies ahead of it on the line of sight, beyond the orbit control's minimum distance (which would otherwise push the camera back)
    const eyeW = m2w(e), direction = operatorDirection();
    const aim = direction ? m2w(direction).normalize() : m2w([e[0] + (t[0] - e[0]) * 0.2, 0, e[2] + (t[2] - e[2]) * 0.2 - 0.03]).sub(eyeW).normalize();
    useCamera(persp); persp.fov = 78; persp.up.set(0, 1, 0); persp.position.copy(eyeW); controls.target.copy(eyeW).addScaledVector(aim, LIMITS.minDistance * 1.2);
    persp.updateProjectionMatrix(); controls.update(); invalidate(); emit('view'); return;
  }
  let box = wantOrtho ? S.manifest.stage ?? STAGE_BOX : S.manifest.totals.bbox;
  if (opts.fit) {
    const bs = expand(opts.fit).map((id) => S.byId.get(id)!.bbox).filter((b): b is Box => !!b);
    if (bs.length) box = { min: [0, 1, 2].map((k) => Math.min(...bs.map((b) => b.min[k]))), max: [0, 1, 2].map((k) => Math.max(...bs.map((b) => b.max[k]))) };
  }
  const corners = boxCorners(box);
  const target = new THREE.Vector3(); corners.forEach((c) => target.add(c)); target.multiplyScalar(1 / corners.length);
  const dir = m2w(v.dir!).normalize(), up = v.up ? m2w(v.up) : new THREE.Vector3(0, 1, 0);
  const fwd = dir.clone().negate(), right = new THREE.Vector3().crossVectors(fwd, up).normalize(), upv = new THREE.Vector3().crossVectors(right, fwd);
  let hw = 0, hh = 0, radius = 0;
  for (const c of corners) { const d = c.clone().sub(target); hw = Math.max(hw, Math.abs(d.dot(right))); hh = Math.max(hh, Math.abs(d.dot(upv))); radius = Math.max(radius, d.length()); }
  if (wantOrtho) {
    useCamera(ortho); ortho.zoom = 1; ortho.up.copy(up);
    S.orthoHalf = Math.max(hh, hw / (w / h)) * 1.04;
    ortho.position.copy(target).addScaledVector(dir, 12);
    layout();
  } else {
    useCamera(persp); persp.fov = 35; persp.up.copy(up);
    const half = Math.min(persp.fov * DEG, 2 * Math.atan(Math.tan((persp.fov * DEG) / 2) * (w / h))) / 2;
    persp.position.copy(target).addScaledVector(dir, (radius * (opts.fit ? 1.0 : 0.93)) / Math.sin(half));
    persp.updateProjectionMatrix();
  }
  controls.target.copy(target); controls.update(); invalidate(); emit('view');
}
export function setExplicitCamera(a: number[]) {
  leavePhoto(); leaveLook(); anim = null; gesture = 0; useCamera(persp);
  persp.fov = a[6] ?? 35; persp.up.set(0, 1, 0); persp.position.copy(m2w(a.slice(0, 3))); controls.target.copy(m2w(a.slice(3, 6)));
  persp.updateProjectionMatrix(); controls.update(); S.view = null; S.userMoved = false; invalidate(); emit('view');
}
/** Where the listed parts are right now (joints as posed), in three world space. */
export function liveBox(ids: string[]): THREE.Box3 {
  scene.updateMatrixWorld();
  const set = new Set(ids), box = new THREE.Box3(), tmp = new THREE.Box3();
  for (const m of S.meshes) if (set.has(m.userData.comp)) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); box.union(tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld)); }
  return box;
}
function flyTo(pos: THREE.Vector3, target: THREE.Vector3, ms = 320) {
  anim = { p0: persp.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms };
  invalidate();
}
/** Glide the camera so the given rows / units / parts fill the view (the whole rig when the list is empty). `freeWidth` is the share of the view's width not covered by a panel. */
export function zoomTo(ids: string[], freeWidth = 1) {
  const parts = ids.length ? expand(ids) : S.items.filter((i) => i.triangles > 0).map((i) => i.id);
  const box = liveBox(parts);
  if (box.isEmpty()) return;
  if (camera !== persp || S.look || S.view === 'operator') setView('three_quarter', { ortho: false });
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.03);
  const dir = persp.position.clone().sub(controls.target).normalize(), { w, h } = frameSize();
  const vHalf = (persp.fov * DEG) / 2, hHalf = Math.atan(Math.tan(vHalf) * (w / h) * THREE.MathUtils.clamp(freeWidth, 0.4, 1));
  const dist = THREE.MathUtils.clamp((r * 1.2) / Math.sin(Math.min(vHalf, hHalf)), LIMITS.minDistance * 1.5, LIMITS.maxDistance);
  S.view = null; S.userMoved = true;
  flyTo(c.clone().addScaledVector(dir, dist), c);
  emit('view');
}
/** If the listed parts sit under a panel that covers the right `covered` pixels of the view, slide the camera sideways (no turn,
 *  no zoom) until they are in the middle of the free part. Does nothing when they are already clear of the panel. */
export function clearOfPanel(ids: string[], covered: number) {
  if (camera !== persp || S.look || S.view === 'operator' || S.photo || anim) return;
  const box = liveBox(expand(ids)); if (box.isEmpty()) return;
  const { w, h } = frameSize(), c = box.getCenter(new THREE.Vector3()), free = w - covered;
  let x0 = Infinity, x1 = -Infinity;
  for (const px of [box.min.x, box.max.x]) for (const py of [box.min.y, box.max.y]) for (const pz of [box.min.z, box.max.z]) {
    const q = new THREE.Vector3(px, py, pz).project(persp); if (q.z > 1) return;        // partly behind the camera: leave the view alone
    const x = ((q.x + 1) / 2) * w; x0 = Math.min(x0, x); x1 = Math.max(x1, x);
  }
  if (x1 <= free || x0 > w) return;
  const shift = x1 - x0 <= free - 48 ? x1 - (free - 24) : (x0 + x1) / 2 - free / 2;     // just clear of the panel if it fits, else centred in the free part
  const depth = c.clone().sub(persp.position).dot(persp.getWorldDirection(new THREE.Vector3()));
  const metres = shift * ((2 * depth * Math.tan((persp.fov * DEG) / 2)) / h);
  const side = new THREE.Vector3().setFromMatrixColumn(persp.matrixWorld, 0).multiplyScalar(metres);
  S.userMoved = true;
  flyTo(persp.position.clone().add(side), controls.target.clone().add(side), 260);
  emit('view');
}
/** Move the camera toward or away from what it looks at by a factor (used when the 3D view changes height, so the picture keeps its size). */
export function rescaleView(k: number) {
  if (camera !== persp || S.look || S.view === 'operator' || S.photo || !isFinite(k) || k <= 0) return;
  const d = persp.position.clone().sub(controls.target), len = THREE.MathUtils.clamp(d.length() * k, LIMITS.minDistance, LIMITS.maxDistance);
  persp.position.copy(controls.target).add(d.setLength(len)); controls.update(); invalidate();
}
/** Glide back to the starting view. */
export function goHome() {
  if (camera !== persp || S.look || S.view === 'operator' || persp.up.y !== 1) { setView('three_quarter', { ortho: false }); return; }
  const p = persp.position.clone(), t = controls.target.clone();
  setView('three_quarter', { ortho: false });
  const p1 = persp.position.clone(), t1 = controls.target.clone();
  persp.position.copy(p); controls.target.copy(t); controls.update();
  flyTo(p1, t1);
}
/** Projection and pose from OpenCV-style intrinsics/extrinsics: x_cam = R · X_model + t, pixels of the upright image. */
function configurePhotoCamera(cam: THREE.PerspectiveCamera, c: PhotoCamera, near = 0.05, far = 60) {
  const { width: W, height: H, fx, fy, cx, cy, R, t } = c;
  const P = new THREE.Matrix4().set(
    (2 * fx) / W, 0, 1 - (2 * cx) / W, 0,
    0, (2 * fy) / H, (2 * cy) / H - 1, 0,
    0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near),
    0, 0, -1, 0);
  cam.projectionMatrix.copy(P); cam.projectionMatrixInverse.copy(P).invert();
  const C = [0, 1, 2].map((i) => -(R[0][i] * t[0] + R[1][i] * t[1] + R[2][i] * t[2]));   // camera centre in the model frame: -R^T t
  const X = m2w(R[0]), Y = m2w(R[1]).negate(), Z = m2w(R[2]).negate();                     // three camera axes in world
  cam.matrixAutoUpdate = false;
  cam.matrix.makeBasis(X, Y, Z).setPosition(m2w(C));
  cam.matrix.decompose(cam.position, cam.quaternion, cam.scale);
  cam.updateMatrixWorld(true);
}
/** Pixel (in the photo's own pixel grid) where a model-frame point lands. Plain arithmetic, no three.js. */
function projectNumeric(c: PhotoCamera, X: number[]) {
  const x = [0, 1, 2].map((i) => c.R[i][0] * X[0] + c.R[i][1] * X[1] + c.R[i][2] * X[2] + c.t[i]);
  return { u: (c.fx * x[0]) / x[2] + c.cx, v: (c.fy * x[1]) / x[2] + c.cy, depth: x[2] };
}
export async function setPhotoCamera(name: string, overlay?: string) {
  const c = S.cameras?.[name];
  if (!c) throw new Error(S.cameras ? `no camera '${name}' in ${CAMERAS_URL} (${Object.keys(S.cameras).join(', ')})` : `${CAMERAS_URL} is not available`);
  leaveLook(); anim = null;
  S.photo = { name, ...c }; S.aspect = c.width / c.height; S.view = null; S.userMoved = false;
  configurePhotoCamera(photoCam, c);
  useCamera(photoCam); layout();
  const img = $<HTMLImageElement>('photo');
  if (c.image && img.dataset.name !== name) {
    img.dataset.name = name;
    img.src = new URL(c.image, location.origin + "/").href; // Camera records name files from the site root.
    try { await img.decode(); } catch { /* shown as missing */ }
  }
  setOverlay(overlay ?? S.overlay);
}
export function setOverlay(mode: string) {
  if (!['none', 'photo', 'blend', 'outline'].includes(mode)) throw new Error(`unknown overlay '${mode}'`);
  S.overlay = S.photo ? mode : 'none';
  $('photo').hidden = S.overlay === 'none';
  canvas.style.opacity = S.overlay === 'blend' ? '0.5' : S.overlay === 'outline' ? '0' : '1';
  $('overlay').hidden = S.overlay !== 'outline';
  ground.visible = S.overlay === 'none';
  S.outlineDirty = true; S.shadowDirty = true; invalidate(); emit('view');
}

// --------------------------------------------------------------------------------------------- id buffer, outlines, self-test
const idMats = new Map<number, THREE.Material>();
function renderIds(cam: THREE.Camera, w: number, h: number) {
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
  const index = new Map<string, number>(); let n = 0;
  const saved = S.meshes.map((m) => m.material);
  for (const m of S.meshes) {
    const id = m.userData.comp;
    if (!index.has(id)) index.set(id, ++n);
    const i = index.get(id)!;
    if (!idMats.has(i)) { const mat = new THREE.MeshBasicMaterial({ toneMapped: false }); mat.color.setRGB((i & 255) / 255, ((i >> 8) & 255) / 255, 0, THREE.LinearSRGBColorSpace); idMats.set(i, mat); }
    if (shown(m)) m.material = idMats.get(i)!;
  }
  const g = ground.visible; ground.visible = false;
  const helperVis = (S.helperList ?? []).map((x) => x.visible); for (const x of S.helperList ?? []) x.visible = false;
  const others = scene.children.filter((o) => o.userData.notInIds && o.visible); for (const o of others) o.visible = false;   // the person (person/index.ts) has no id colour
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  renderer.setRenderTarget(null); rt.dispose();
  S.meshes.forEach((m, k) => { m.material = saved[k]; });
  ground.visible = g; (S.helperList ?? []).forEach((x, k) => { x.visible = helperVis[k]; }); for (const o of others) o.visible = true;
  return { px, ids: [...index.keys()] };
}
function drawOutlines() {
  const ov = $<HTMLCanvasElement>('overlay'), w = ov.width, h = ov.height, ctx = ov.getContext('2d')!;
  const { px, ids } = renderIds(camera, w, h);
  const img = ctx.createImageData(w, h), out = img.data;
  const at = (x: number, y: number) => { const o = ((h - 1 - y) * w + x) * 4; return px[o] | (px[o + 1] << 8); };
  const cols = ids.map((id) => { const c = idColor.get(id) ?? new THREE.Color('#fff'); const s = c.clone().convertLinearToSRGB(); return [s.r * 255, s.g * 255, s.b * 255]; });
  const put = (x: number, y: number, c: number[]) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = at(x, y), b = at(x + 1, y), c = at(x, y + 1);
    if (a === b && a === c) continue;
    const col = cols[(a || b || c) - 1];
    put(x, y, col); put(x + 1, y, col); put(x, y + 1, col); put(x + 1, y + 1, col);
  }
  ctx.putImageData(img, 0, 0);
  S.outlineDirty = false;
}
/** Known-answer check of the photo-camera path: marker spheres at known model points are rendered with the
 *  configured camera and their pixel centroids compared with plain pinhole arithmetic. */
function selfTest() {
  const look = (eye: number[], tgt: number[]) => { // synthetic OpenCV extrinsics looking from eye to tgt, model frame, Z up
    const z = new THREE.Vector3(...tgt).sub(new THREE.Vector3(...eye)).normalize(), x = new THREE.Vector3().crossVectors(z, new THREE.Vector3(0, 0, 1)).normalize(), y = new THREE.Vector3().crossVectors(z, x);
    const R = [x.toArray(), y.toArray(), z.toArray()];
    return { R, t: R.map((r) => -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2])) };
  };
  const cams: Record<string, PhotoCamera> = { synthetic_portrait: { width: 1500, height: 2000, fx: 1480, fy: 1510, cx: 772, cy: 963, ...look([-1.9, -1.4, 1.7], [0.1, 0.05, 0.6]) }, synthetic_landscape: { width: 2000, height: 1500, fx: 2100, fy: 2100, cx: 1000, cy: 750, ...look([2.4, 1.1, 1.1], [0, 0, 0.5]) } };
  for (const [k, c] of Object.entries(S.cameras ?? {})) cams[k] = c;
  const pts = [[0.75, 0.75, 0], [-0.75, 0.75, 0], [0.75, -0.75, 0], [-0.75, -0.75, 0], [0, 0, 0], [0.5, 0, 1.15], [-0.5, 0.3, 0.6], [0.2, -0.3, 0.48]];
  const sc = new THREE.Scene(), geo = new THREE.SphereGeometry(0.012, 16, 12), cam = new THREE.PerspectiveCamera();
  pts.forEach((p, i) => { const mat = new THREE.MeshBasicMaterial({ toneMapped: false }); mat.color.setRGB((40 + i * 25) / 255, 0, 0, THREE.LinearSRGBColorSpace); const m = new THREE.Mesh(geo, mat); m.position.copy(m2w(p)); sc.add(m); });
  const results: Record<string, unknown>[] = []; let worst = 0;
  for (const [name, c] of Object.entries(cams)) {
    const scale = 1000 / Math.max(c.width, c.height), w = Math.round(c.width * scale), h = Math.round(c.height * scale);
    configurePhotoCamera(cam, c);
    const rt = new THREE.WebGLRenderTarget(w, h);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam);
    const px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); renderer.setRenderTarget(null); rt.dispose();
    const acc = pts.map(() => [0, 0, 0]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (px[o + 3] && px[o] >= 40) { const i = Math.round((px[o] - 40) / 25); if (acc[i]) { acc[i][0] += x + 0.5; acc[i][1] += h - (y + 0.5); acc[i][2]++; } } }
    pts.forEach((p, i) => {
      const e = projectNumeric(c, p), eu = e.u * scale, evv = e.v * scale, inside = e.depth > 0 && eu > 8 && evv > 8 && eu < w - 8 && evv < h - 8;
      if (!inside) { results.push({ camera: name, point: p, skipped: 'outside the image' }); return; }
      if (!acc[i][2]) { results.push({ camera: name, point: p, expected: [eu, evv], error: 'marker not found in the render' }); worst = Infinity; return; }
      const ru = acc[i][0] / acc[i][2], rv = acc[i][1] / acc[i][2], err = Math.hypot(ru - eu, rv - evv);
      worst = Math.max(worst, err);
      results.push({ camera: name, point: p, expected: [+eu.toFixed(2), +evv.toFixed(2)], rendered: [+ru.toFixed(2), +rv.toFixed(2)], error_px: +err.toFixed(3), image: [w, h] });
    });
  }
  invalidate();
  const checked = results.filter((r) => r.error_px !== undefined).length;
  return { pass: worst < 1.0 && checked >= 8, worst_px: worst, checked, tolerance_px: 1.0, cameras: Object.keys(cams), results };
}

// --------------------------------------------------------------------------------------------- highlight: outline of the hovered and the selected parts
// The selected and the hovered meshes are drawn once more, flat, into a mask: red = selected (seen
// through everything), blue = selected and actually visible, green = pointed at. A full-screen pass
// then paints a line where the mask ends: strong round what is visible of the selection, faint where
// it continues behind other parts. Materials stay untouched, so real colours remain visible, screens
// are marked too, and pointing at parts never re-renders shadows.
const maskRT = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, samples: 4 });
const maskMat = (r: number, g: number, b: number, depthTest: boolean) => { const m = new THREE.MeshBasicMaterial({ toneMapped: false, depthTest, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }); m.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace); return m; };
const MASK_SEL = maskMat(1, 0, 0, false), MASK_SEL_SEEN = maskMat(0, 0, 1, true), MASK_HOV = maskMat(0, 1, 0, false);
const MASK_DEPTH = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
const L_SEL = 1, L_HOV = 2, L_SHOWN = 3, L_EXTRA = 4;
let extra: THREE.Object3D | null = null;            // another object outlined, faintly, as selected (outlineExtra)
const edgeMat = new THREE.ShaderMaterial({
  uniforms: { mask: { value: maskRT.texture }, px: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D mask; uniform vec2 px; varying vec2 vUv;
    void main() {
      vec3 c = min(texture2D(mask, vUv).rgb, 1.0), near = vec3(0.0);
      for (int i = 0; i < 12; i++) { float a = 6.2831853 * float(i) / 12.0; float r = i - (i / 2) * 2 == 0 ? 2.4 : 1.2; near = max(near, min(texture2D(mask, vUv + vec2(cos(a), sin(a)) * px * r).rgb, 1.0)); }
      vec3 edge = near * (1.0 - c);
      float sel = max(max(edge.b * 0.95, edge.r * 0.38), c.b * 0.05), hov = edge.g * 0.9 * (1.0 - max(c.r, edge.r));
      vec3 col = sel >= hov ? vec3(0.07, 0.42, 0.88) : vec3(1.0, 1.0, 1.0);
      gl_FragColor = vec4(col, max(sel, hov));
    }`,
  transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
});
const edgeScene = new THREE.Scene(), edgeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
{ const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), edgeMat); quad.frustumCulled = false; edgeScene.add(quad); }
function updateMask() {
  const sel = new Set(S.selected ? members(S.selected) : []), hov = new Set(S.hover && S.hover !== S.selected ? members(S.hover) : []);
  let any = false;
  const put = (m: THREE.Mesh, layer: number, on: boolean) => { on ? m.layers.enable(layer) : m.layers.disable(layer); };
  for (const m of S.meshes) {
    const id = m.userData.comp, vis = shown(m), a = vis && sel.has(id), b = vis && hov.has(id);
    put(m, L_SEL, a); put(m, L_HOV, b); put(m, L_SHOWN, vis);
    any ||= a || b;
  }
  extra?.traverse((m) => { if ((m as THREE.Mesh).isMesh && m.visible) { m.layers.enable(L_EXTRA); any = true; } });
  S.maskOn = any;
}
/** Outline another object as selected, with the faint line (the person, person-panel.ts), or none. */
export function outlineExtra(o: THREE.Object3D | null) { extra?.traverse((m) => m.layers.disable(L_EXTRA)); extra = o; updateMask(); invalidate(); }
const bufSize = new THREE.Vector2();
function drawHighlight() {
  if (!S.maskOn) return;
  renderer.getDrawingBufferSize(bufSize);
  if (maskRT.width !== bufSize.x || maskRT.height !== bufSize.y) maskRT.setSize(bufSize.x, bufSize.y);
  const layers = camera.layers.mask, auto = renderer.autoClear;
  const pass = (layer: number, mat: THREE.Material) => { camera.layers.set(layer); scene.overrideMaterial = mat; renderer.render(scene, camera); };
  renderer.setRenderTarget(maskRT); renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.autoClear = false;
  if (S.selected) { pass(L_SHOWN, MASK_DEPTH); pass(L_SEL, MASK_SEL_SEEN); pass(L_SEL, MASK_SEL); }
  if (extra) pass(L_EXTRA, MASK_SEL);
  pass(L_HOV, MASK_HOV);
  scene.overrideMaterial = null; camera.layers.mask = layers;
  renderer.setRenderTarget(null);
  edgeMat.uniforms.px.value.set(renderer.getPixelRatio() / bufSize.x, renderer.getPixelRatio() / bufSize.y);
  renderer.render(edgeScene, edgeCam);
  renderer.autoClear = auto;
}

// --------------------------------------------------------------------------------------------- agent overlays: legend, reference frames, triad and scale bar
function refreshLegend() {
  const lg = $('legend'); lg.hidden = !(S.legend && S.mode !== 'normal'); lg.textContent = '';
  if (lg.hidden) return;
  if (S.mode === 'ids') for (const it of S.items) { if (!hasMesh(it.id) || S.hidden.has(it.id)) continue; const s = el('span'); const i = el('i'); i.style.background = '#' + idColor.get(it.id)!.getHexString(); s.append(i, document.createTextNode(it.id)); lg.append(s); }
  else for (const [c, col] of Object.entries(CLASS_COLORS)) { const s = el('span'); const i = el('i'); i.style.background = col; s.append(i, document.createTextNode(c === 'none' ? 'no parameters' : CLASS_TEXT[c])); lg.append(s); }
}
export function setMode(mode: string) {
  if (!['normal', 'plain', 'ids', 'class'].includes(mode)) throw new Error(`unknown mode '${mode}'`);
  S.mode = mode;
  document.body.classList.toggle('mode-ids', S.mode === 'ids');
  document.body.classList.toggle('mode-class', S.mode === 'class');
  applyMaterials(); emit('mode');
}
function setFrames(on: boolean) {
  S.frames = on;
  if (on && !S.helperList) {
    S.helperList = [];
    const add = (parent: THREE.Object3D, obj: THREE.Object3D) => { obj.traverse((o) => { const m = (o as THREE.Line).material as THREE.Material | undefined; if (m) { m.depthTest = false; m.transparent = true; } o.renderOrder = 10; }); parent.add(obj); S.helperList!.push(obj); };
    for (const d of S.manifest.datums) { const o = S.objects.get(d.id); if (o) add(o, new THREE.AxesHelper(d.id === 'D_origin' ? 0.3 : 0.1)); }
    for (const [, j] of S.joints) if (j.def.axis) { const a = new THREE.Vector3(...j.def.axis); add(j.obj, new THREE.ArrowHelper(a, a.clone().multiplyScalar(-0.06), 0.12, j.def.locked ? 0x9aa0a8 : 0xffb000, 0.03, 0.015)); }
  }
  for (const h of S.helperList ?? []) h.visible = on;
  invalidate();
}
function drawHud() {
  const hud = $('hud'), { w, h } = frameSize();
  if (!S.hud) { if (hud.childNodes.length) hud.textContent = ''; return; }
  hud.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const q = camera.quaternion.clone().invert();
  const ax = ([['X', [1, 0, 0], '#d33'], ['Y', [0, 1, 0], '#2a2'], ['Z', [0, 0, 1], '#26d']] as [string, number[], string][]).map(([n, v, c]) => ({ n, c, v: m2w(v).applyQuaternion(q) })).sort((a, b) => a.v.z - b.v.z);
  const ox = 46, oy = h - 46, L = 30;
  let svg = `<circle cx="${ox}" cy="${oy}" r="40" fill="rgba(255,255,255,.6)"/>`;
  for (const a of ax) { const x = ox + a.v.x * L, y = oy - a.v.y * L; svg += `<line x1="${ox}" y1="${oy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${a.c}" stroke-width="2.5" stroke-linecap="round"/><text x="${(ox + a.v.x * (L + 7)).toFixed(1)}" y="${(oy - a.v.y * (L + 7) + 4).toFixed(1)}" font-size="11" font-weight="700" text-anchor="middle" fill="${a.c}">${a.n}</text>`; }
  if (camera === ortho) {
    const ppm = (h / (2 * S.orthoHalf)) * ortho.zoom, len = 0.5 * ppm, x0 = 100, y0 = h - 22;
    svg += `<rect x="${x0 - 6}" y="${y0 - 18}" width="${len + 12}" height="26" rx="3" fill="rgba(255,255,255,.6)"/><path d="M${x0} ${y0 - 5}V${y0}H${x0 + len}V${y0 - 5}M${x0 + len / 2} ${y0 - 3}V${y0}" fill="none" stroke="#111" stroke-width="1.5"/><text x="${x0 + len / 2}" y="${y0 - 7}" font-size="11" text-anchor="middle" fill="#111">0.5 m</text>`;
  }
  hud.innerHTML = svg;
}

// --------------------------------------------------------------------------------------------- drawing on demand
/** Ask for one frame. Cheap to call any number of times. */
export function invalidate() { needsRender = true; if (!scheduled) { scheduled = true; requestAnimationFrame(tick); } }
let shadowDrawn = false;
function render() {
  for (const f of hooks.beforeRender) f();
  shadowDrawn = S.shadowDirty;
  if (S.shadowDirty) { renderer.shadowMap.needsUpdate = true; S.shadowDirty = false; }
  scene.updateMatrixWorld();
  renderer.render(scene, camera);
  S.info = { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  drawHighlight();
  if (S.overlay === 'outline' && S.outlineDirty) drawOutlines();
  drawHud();
  needsRender = false; drawn++;
}
function tick(now: number) {
  scheduled = false;
  let gliding = false;
  if (anim) {
    const k = Math.min(1, (now - anim.start) / anim.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    persp.position.lerpVectors(anim.p0, anim.p1, e); controls.target.lerpVectors(anim.t0, anim.t1, e);
    if (k >= 1) anim = null; else gliding = true;
    needsRender = true;
  }
  if (controls.enabled) { const moving = controls.update(); if (gesture === 2) gesture = 0; gliding = moving || gliding; }   // damping keeps the camera moving for a few frames after the pointer stops
  if (needsRender) {
    render();
    const dt = now - lastDraw; lastDraw = now;
    if (dt < 100) { avgDt = avgDt ? avgDt * 0.9 + dt * 0.1 : dt; fps = 1000 / avgDt; } else avgDt = 0;
  }
  if (gliding) invalidate();
}
/** Resolves after the pending frame (if any) has been drawn. A frame that also redrew the shadow map is followed by a plain
 *  one, so that state().render reports what a still view costs (as it did when every frame was drawn). */
const nextFrame = () => new Promise<boolean>((r) => requestAnimationFrame(() => requestAnimationFrame(() => { if (needsRender) render(); if (shadowDrawn) render(); r(true); })));
/** Finish any camera glide and draw at once: a picture for an agent (look {picture: true}); works in a background tab,
 *  where no frames run. */
export function drawNow() {
  if (anim) { persp.position.copy(anim.p1); controls.target.copy(anim.t1); anim = null; }
  controls.update(); render(); if (shadowDrawn) render();
}
/** Stop any camera glide at once (the person grabbed the view). */
export const stopGlide = () => { anim = null; };

// --------------------------------------------------------------------------------------------- API (used by the URL parameters and by the headless driver)
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()).filter(Boolean));
function parsePose(v: unknown): Record<string, number | number[]> {
  if (v && typeof v === 'object') return v as Record<string, number | number[]>;
  const out: Record<string, number | number[]> = {};
  for (const part of list(v)) { const [id, val] = part.split(':'); out[id] = val.includes('/') ? val.split('/').map(Number) : Number(val); }
  return out;
}
/** Reset to defaults, then apply a set of options (same keys as the URL parameters). Resolves when drawn. */
export async function apply(o: Opts = {}) {
  for (const f of hooks.beforeApply) f(o);
  S.hud = o.hud === true || o.hud === '1'; S.legend = o.legend === true || o.legend === '1';
  document.body.classList.toggle('no-ui', o.ui === false || o.ui === '0');
  S.hidden.clear(); S.hover = null; S.selected = null; S.wire = o.wire === true || o.wire === '1';
  resetJoints();
  layout();
  if (o.cam) await setPhotoCamera(String(o.cam), String(o.overlay ?? 'none'));
  else if (o.camera) setExplicitCamera(list(o.camera).map(Number));
  else setView(String(o.view ?? 'three_quarter'), { ortho: o.proj === 'ortho', fit: o.fit ? list(o.fit) : null, eye: o.eye !== undefined && Number.isFinite(Number(o.eye)) ? Number(o.eye) : null });
  if (o.pose) for (const [id, v] of Object.entries(parsePose(o.pose))) {
    const d = S.joints.get(id)?.def; if (!d) throw new Error(`unknown joint '${id}'`);
    setJoint(id, Array.isArray(v) ? v.map((x) => x * DEG) : d.type === 'prismatic' ? v : v * DEG, { force: true });
  }
  if (o.only) showOnly(list(o.only));
  if (o.hide) setVisible(list(o.hide), false);
  setFrames(o.frames === true || o.frames === '1');
  setMode(String(o.mode ?? 'normal'));
  if (o.sel && known(String(o.sel))) S.selected = String(o.sel);
  S.applying = true; updateMask(); emit('visibility'); emit('selection'); S.applying = false;
  const cap = $('caption'); cap.hidden = !o.caption; cap.textContent = o.caption ? String(o.caption) : '';
  for (const f of hooks.onApply) f(o);
  invalidate();
  await nextFrame();
  return state();
}
export function state() {
  return {
    view: S.view, eye: S.view === 'operator' ? S.eyeHeight : null, photo: S.photo?.name ?? null, overlay: S.overlay, mode: S.mode, projection: camera === ortho ? 'ortho' : 'persp',
    hidden: [...S.hidden], joints: Object.fromEntries([...S.joints].map(([id, j]) => [id, j.value])),
    frame: frameSize(), render: { triangles: S.info.triangles, calls: S.info.calls }, fps,
    camera: { position: w2m(camera.position), target: w2m(controls.target) },
    selected: S.selected, assumed_in_use: assumedInUse(), frames_drawn: drawn,
  };
}
/** Component (or screen surface) under a pixel of the 3D view, and the point hit (model frame). */
const ray = new THREE.Raycaster();
export function pickAt(x: number, y: number): { id: string; point: number[]; mesh: THREE.Mesh; world: THREE.Vector3 } | null {
  const { w, h } = frameSize();
  scene.updateMatrixWorld();
  ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), camera);
  const hit = ray.intersectObjects(S.meshes.filter(shown), false)[0];
  return hit ? { id: hit.object.userData.comp as string, point: w2m(hit.point), mesh: hit.object as THREE.Mesh, world: hit.point.clone() } : null;
}
export const viewerApi = {
  pickAt: (x: number, y: number) => { const h = pickAt(x, y); return h ? { id: h.id, point: h.point, material: ((h.mesh.userData.orig as THREE.Material | undefined)?.name ?? '') as string } : null; },
  apply, state, setView, setPhotoCamera, setOverlay, setVisible, showOnly, showAll, hideAll, setJoint, resetJoints: () => resetJoints(), setMode, setFrames, select, selfTest, zoomTo,
  frame: nextFrame,
  cameras: () => Object.keys(S.cameras ?? {}),
  cameraInfo: (name: string) => S.cameras?.[name] ?? null,
  manifest: () => S.manifest,
  worldPosition: (id: string) => { const o = S.objects.get(id); if (!o) throw new Error(`unknown node '${id}'`); scene.updateMatrixWorld(); return w2m(o.getWorldPosition(new THREE.Vector3())); },
  project: (p: number[]) => { const v = m2w(p).project(camera), { w, h } = frameSize(); return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h]; },
  /** frames per second measured over n rendered frames with the current view (every frame is forced to draw) */
  benchmark: async (n = 120) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { invalidate(); await new Promise<number>((r) => requestAnimationFrame(r)); } const dt = performance.now() - t0; return { frames: n, fps: (n * 1000) / dt, ...state().render }; },
  /** rows of the parts list, with plain names (for scripts that test the page) */
  rows: () => S.rows.map((r) => ({ ...r })),
  /** filled in by ui.ts: the link that reproduces the current state, and the picture of the 3D view as a PNG data URL */
  shareUrl: () => location.href as string,
  picture: () => canvas.toDataURL('image/png') as string,
  /** filled in by ui.ts: the picture as a JPEG of at most maxBytes, for an agent */
  pictureJpeg: (async (_maxBytes: number) => null) as (maxBytes: number) => Promise<Blob | null>,
  /** filled in by live.ts: the state of the shared scene on this page (null when the page is local only) */
  live: (): Record<string, unknown> | null => null,
  /** filled in by person/index.ts once the person module has loaded (after the page is ready) */
  person: null as Record<string, any> | null,
  /** filled in by live.ts: send a command as this page (its client id; the reply's version counts as the page's own) */
  command: null as ((body: object) => Promise<any>) | null,
};
