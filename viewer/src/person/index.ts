// The person in the product viewer: entry of the separately loaded person chunk (main.ts imports this module only after the
// rig is ready). It loads the default person (the dressed operator, median man, light tone) with a visible loading line,
// seats it in the rig through the rig binding (MV-rig's rig-binding.ts), and keeps it posed:
//
//   drawing   the product draws only on change. The person advances its pose in the engine's beforeRender hook. Idle motion
//             (breathing, small shifts, blinks, saccades) runs only while the person is shown in a live view, at most
//             [runtime] idle_fps frames a second; a still view (ui=0, scripts, the render tool) stays still and shows the person
//             at a fixed time, so its pictures are deterministic.
//   the rig   unchanged: the person adds one group to the scene and its own materials; nothing global is patched. With
//             `person=off` the module and the package load but nothing is shown (the pixel comparison in the wiki uses this).
//
// URL parameters: person=0 (no person code at all) | off (loaded, not shown) | <manifest url>; person_style=dressed|clay; person_sex=m|f;
// person_tone=<id>; person_wear=glasses:none,headset:none; person_shape=<preset name>; person_idle=0; person_look=0 (the person's own key,
// crease shading and skin saturation off).
// Script interface: window.viewer.person (state, definition, show, set, place, anchor, pickAt, depthAt, shells, object, still, bench, ready); every
// change is announced as the window event 'rigtwin:person' with the state as its detail.
import * as THREE from "three";
import { S, Q, scene, renderer, invalidate, on, hooks, keyLight, w2m, m2w, viewerApi, $, el, drawNow, DEG, frameSize, currentCamera, refollowEye, type Opts } from "../engine.ts";
import { SCRIPTS } from "./operator.ts";
import { Avatar } from "./avatar.ts";
import { section } from "./params.ts";
import { rigBinding } from "./rig-binding.ts";
import type { RigView, RigBinding } from "./types.ts";

const RT = section("runtime"), GROUND = section("ground"), LOOK = section("look"), SECTION_BINS = section("operator").handle.section_bins;
/** The person's own look in the product's light on ([look]; designer, REVIEW-11): look(false) or person_look=0 shows the materials as before. */
let lookOn = true;
/** The default person: the dressed operator package (MP, assets/manikin/), served under the asset folder; version.json names it
 *  when the release carries it (tools/serve.ts, tools/dist.ts). */
export const DEFAULT_PACKAGE = "asset/manikin/operator-m/operator-m.avatar.json";
const TRANSCODER = "libs/basis/";

let av: Avatar | null = null, shown = false, live = true, idleOn = true, lastUpdate = 0, lastIdle = 0, loadMs = 0, loadError: string | null = null, bindMs = 0;
let updateMs = 0, status: HTMLElement | null = null, readyResolve: (ok: boolean) => void = () => {};
const ready = new Promise<boolean>((r) => { readyResolve = r; });
let restart = 0;

function say(text: string | null, error = false) {
  if (!status) { status = el("div", "note person-status"); status.setAttribute("role", "status"); $("notices").append(status); }
  status.hidden = !text; status.textContent = text ?? ""; status.classList.toggle("amber", error);
}

/** The rig as the binding reads it: node positions and frames in the MODEL frame, joints as posed now. */
const rigView = (): RigView => {
  const at = (id: string) => S.objects.get(id) ?? null;
  return {
    manifest: S.manifest,
    point(id) { const o = at(id); if (!o) return null; S.root.updateMatrixWorld(true); return w2m(o.getWorldPosition(new THREE.Vector3())); },
    frame(id) {
      const o = at(id); if (!o) return null; S.root.updateMatrixWorld(true);
      // the node's own axes are the columns of its world matrix (the GLB root converts model -> world); back into the model frame
      const m = o.matrixWorld, ax = (i: number) => w2m(new THREE.Vector3().setFromMatrixColumn(m, i).normalize());
      return { origin: w2m(o.getWorldPosition(new THREE.Vector3())), x: ax(0), y: ax(1), z: ax(2) };
    },
  };
};
/** Seat the person in the rig: the binding's place, targets and contact planes, then a fresh solve. A placement set with place()
 *  wins (a standing shot off the seat); without the operator layer (a clip, a dof pose) no binding is computed. */
let placeOverride: { origin: number[]; yawDeg: number; on?: "deck" | "floor" } | null = null;
function rebind() {
  if (!av?.ready) return;
  const t0 = performance.now(), opState = av.state("operator");
  let b: RigBinding | null = av.binding;
  if (opState.on && av.mode !== "clip") {
    // the binding gets the body itself too: where it is no baked person, its capsules are derived from its shape weights (body-fit.ts)
    if (!opState._op || opState._key !== av.restKey()) av.update(0);   // the solver of THIS body (rebuilt by the plug-in when the rest key changed): never bind with the previous body's
    if (opState._op) { b = null; try { b = rigBinding({ op: opState._op, measures: av.measures, manifest: av.manifest, controls: av.shape, weights: av.weights }, rigView()); } catch (e) { console.warn("person: the rig binding failed; the stand-in seat is used", e); } }
    av.binding = b;
  }
  const place = placeOverride ?? b?.place ?? fallbackPlace();
  av.holder.position.copy(m2w(place.origin));
  av.holder.rotation.set(0, Math.PI / 2 + place.yawDeg * DEG, 0);
  av.holder.updateMatrixWorld(true);
  // the handles' measured cross-sections into the grip targets (the fingers lie on the real front of the handle: gripSection)
  if (b) for (const [s, S2] of [["l", "L"], ["r", "R"]] as const) { const g: any = (b.targets as any)?.grip?.[s], sec = g?.profile ? gripSection(S2, g.profile) : null; if (sec) { g.section = sec.rows; g.ref = sec.ref; } }
  bindMs = performance.now() - t0;
  dirty(); firstPerson();
}
/** The handle's real cross-section (designer, REVIEW-11: the fingers floated past the handle's front): the rig's profile is the largest
 *  radius round the grip axis at each height, but the handle is 22 to 26 mm deep at its front against 35 at its widest. At each of the
 *  profile's heights, the radius by direction round the axis ([operator.handle] section_bins, from the grip datum's x axis), measured
 *  on the lever's mesh in the D_grip_axis frame; `ref` is that x axis in the person's frame (as the holder stands now). Per rig build. */
const sectionCache = new Map<string, { rows: number[][] }>();
function gripSection(side: "L" | "R", profile: number[][]): { rows: number[][]; ref: number[] } | null {
  const lever = S.objects.get(`C_joy_lever_${side}`), frame = S.objects.get(`D_grip_axis_${side}`); if (!lever || !frame || !av) return null;
  scene.updateMatrixWorld();
  const key = `${S.manifest?.glb?.sha256 ?? ""}:${side}:${profile.length}`;
  let hit = sectionCache.get(key);
  if (!hit) {
    const N = SECTION_BINS, inv = frame.matrixWorld.clone().invert(), tris: THREE.Vector3[] = [];
    lever.traverse((o: any) => { if (!o.isMesh) return; const P = o.geometry.attributes.position, I = o.geometry.index, n = I ? I.count : P.count, m = inv.clone().multiply(o.matrixWorld);
      for (let k = 0; k < n; k++) tris.push(new THREE.Vector3().fromBufferAttribute(P, I ? I.getX(k) : k).applyMatrix4(m)); });
    const rows = profile.map(([t]) => { const r = new Array(N).fill(0);
      for (let k = 0; k < tris.length; k += 3) for (let e = 0; e < 3; e++) { const A = tris[k + e], B = tris[k + ((e + 1) % 3)], ha = A.z - t, hb = B.z - t; if ((ha > 0) === (hb > 0)) continue;
        const u = ha / (ha - hb), x = A.x + (B.x - A.x) * u, y = A.y + (B.y - A.y) * u; let th = Math.atan2(y, x); if (th < 0) th += 2 * Math.PI; const i = Math.round((th / (2 * Math.PI)) * N) % N; r[i] = Math.max(r[i], Math.hypot(x, y)); }
      for (let pass = 0; pass < N && r.some((x) => !x); pass++) { const c = r.slice(); for (let i = 0; i < N; i++) if (!c[i]) r[i] = Math.max(c[(i + N - 1) % N], c[(i + 1) % N]); }
      return r; });
    if (rows.every((r) => r.every((x) => !x))) return null;
    hit = { rows }; sectionCache.set(key, hit);
  }
  const x = new THREE.Vector3().setFromMatrixColumn(frame.matrixWorld, 0).normalize().applyQuaternion(av.holder.getWorldQuaternion(new THREE.Quaternion()).invert());
  return { rows: hit.rows, ref: x.toArray() };
}
/** Without a binding: the package's origin on the deck below the rig's live seat reference point. */
function fallbackPlace() { const p = rigView().point("D_seat_ref_live") ?? [0, 0, 0]; return { origin: [p[0], p[1], 0], yawDeg: 0 }; }

/** The person changed (shape, wear, binding, style, a still's time): the next frame poses it again and redraws the shadow map. */
let changed = true;
/** In the operator's view with a person seated: the camera on the person's own eyes (engine hooks.operatorEye) and the head-worn
 *  meshes (cap, glasses, headset, hair, eyes, lashes) not drawn; MPK found the camera 39 to 77 mm inside the person's head. */
function firstPerson() {
  if (!av?.ready) return;
  const fp = S.view === "operator" && !S.photo && shown && av.seated && !!av.state("operator").on;
  if (fp !== av.firstPerson) { av.firstPerson = fp; av.applyView(); dirty(); }
  av.U.personNear.value = fp ? RT.first_person_near : 0;                 // the own face is not drawn from the own eyes (shaders.ts personNear)
  if (S.view === "operator") { if (fp) poseNow(); refollowEye(); }
}
/** Pose the person now for its current binding (the operator layer re-targets on the next update after a new binding), so that what
 *  is read off it at once (the eye for the operator's view) is this body on this seat, not the last frame's. */
function poseNow() {
  if (!av?.ready) return;
  setStill(!(live && idleOn)); av.update(0); if (av.state("operator")._bound !== av.binding) av.update(0); frameNo++; changed = true;
}
function dirty() { changed = true; if (!shown) return; S.shadowDirty = true; invalidate(); }      // a hidden person changes nothing on screen: no frame
/** Before every drawn frame: advance the person (live) or hold it at its still time, then let the shadow map follow it. */
function beforeRender() {
  if (!av?.ready || !shown) return;
  const now = performance.now(), U = av.U, cam = keyLight.shadow.camera;
  U.personShadowHalf.value = (cam.right - cam.left) / 2; U.personShadowRange.value = cam.far - cam.near;
  U.personKey.value.copy(keyLight.color).multiplyScalar(keyLight.intensity * LOOK.key_share); U.personLook.value = lookOn ? 1 : 0;   // the person's own key (shaders.ts)
  const dt = live && idleOn ? Math.min((now - (lastUpdate || now)) / 1000, RT.max_dt) : 0;
  lastUpdate = now;
  if (dt === 0 && !changed) { updateMs = 0; return; }              // a still view whose person has not changed: nothing to do, the shadow map stays
  changed = false;
  setStill(!(live && idleOn));
  av.update(dt); frameNo++;
  S.shadowDirty = true;
  updateMs = performance.now() - now;
}
/** The time a still shows (set({ time })); null: [runtime] still_time for the solver and the clip, eye_still_time for the eyes. */
let stillAt: number | null = null;
function setStill(still: boolean) {
  if (!av) return;
  const op = av.state("operator"), ey = av.state("eyes");
  if (still) { op.time = stillAt ?? RT.still_time; ey.time = stillAt ?? RT.eye_still_time; ey.restart = restart; ey.seed = RT.eye_seed; if (av.action) av.clipTime = stillAt ?? RT.still_time; }
  else { op.time = undefined; ey.time = undefined; if (av.action) av.clipTime = null; }
}
/** The idle ticker: while the person is shown in a live view, ask for a frame at most idle_fps times a second. */
function idle(now: number) {
  requestAnimationFrame(idle);
  if (!shown || !live || !idleOn || !av?.ready || document.hidden) return;
  if (now - lastIdle >= 1000 / RT.idle_fps - 1) { lastIdle = now; invalidate(); }
}

/** `person=off` in the address: this page never shows the person, whatever the shared scene or a script asks (the rig-only checks and the
 *  pixel comparison rely on it). */
let suppressed = false;
async function show(on: boolean) {
  const was = !!av?.holder.visible; shown = on && !!av?.ready && !suppressed;
  if (av) { if (shown && !av.holder.parent) scene.add(av.holder); av.holder.visible = shown; }
  if (was !== shown) { changed = true; S.shadowDirty = true; invalidate(); firstPerson(); await new Promise((r) => requestAnimationFrame(r)); }   // only a change of visibility redraws
  changedSignal(); return state();
}

/** The package of a style and sex (assets/manikin/ layout: operator-m / operator-f dressed, clay-m / clay-f the clay figure), relative to the current manifest. */
const PACKAGE_OF_STYLE: Record<string, string> = { dressed: "operator", clay: "clay" };
const sexOf = (a: Avatar) => (/-f$/.test(a.manifest.name ?? "") ? "f" : "m");
const styleKind = (a: Avatar) => (/^clay/.test(a.manifest.name ?? "") ? "clay" : "dressed");
function packageFor(style: string, sex: string): string {
  const kind = PACKAGE_OF_STYLE[style]; if (!kind || !av) throw new Error(`no style '${style}' (${Object.keys(PACKAGE_OF_STYLE).join(", ")})`);
  if (sex !== "m" && sex !== "f") throw new Error(`sex is 'm' or 'f', not '${sex}'`);
  const name = `${kind}-${sex}`;
  return new URL(`../${name}/${name}.avatar.json`, new URL(av.base, location.href)).href;
}
/** What the person wears and its tone, kept across package swaps (the clay figure has neither; the next dressed package gets them back). */
const prefs: { tone: string | null; worn: Record<string, any> } = { tone: null, worn: {} };
function remember(a: Avatar) { if (a.manifest.tones) prefs.tone = a.tone; for (const [k, v] of Object.entries(a.worn)) prefs.worn[k] = { ...v }; }
async function restorePrefs(a: Avatar) {
  if (prefs.tone && a.manifest.tones?.list?.some((t: any) => t.id === prefs.tone) && a.tone !== prefs.tone) await a.setTone(prefs.tone);
  const w = Object.fromEntries(Object.entries(prefs.worn).filter(([k, v]) => a.slots.some((sl) => sl.id === k && (v.garment === null ? sl.allowNone : sl.garments.some((g: any) => g.id === v.garment)))));
  if (Object.keys(w).length) await a.wear(w);
}
/** Another package in place of the current one (the clay figure and back, the other sex). The pose carries over; the body controls
 *  too unless `keepShape` is false (another sex: the new package's defaults, or the shape given in the same call). */
async function switchPackage(url: string, label: string, keepShape = true) {
  const old = av!, next = new Avatar(renderer, TRANSCODER);
  remember(old);
  say(`Loading the ${label}…`);
  try { await next.loadPackage(url); } catch (e) { say(`The ${label} could not be loaded: ${e instanceof Error ? e.message : e}`, true); throw e; }
  if (keepShape) next.setShape(Object.fromEntries(Object.entries(old.shape).filter(([k]) => next.manifest.shape.controls.some((c: any) => c.id === k))));
  const pose = old.poseState(), op = next.state("operator");                          // same skeleton, dofs and control ids (MP): the pose carries over
  if (pose.clip) await next.setClip(pose.clip, pose.clipTime);
  else if (!pose.operator) next.setPose(Object.fromEntries(Object.entries(pose.dofs).filter(([k]) => next.dofById.has(k))));
  else { op.on = true; op.script = pose.script; }
  await restorePrefs(next);
  old.dispose(); av = next; scene.add(av.holder); av.holder.visible = shown;
  rebind(); say(null); changedSignal();
}
type PersonSet = { style?: string; sex?: "m" | "f" | "male" | "female"; tone?: string; wear?: any; shape?: Record<string, number> | string; pose?: string | Record<string, number> | null; script?: string; clip?: string | null; time?: number | null };
async function set(o: PersonSet) {
  if (!av?.ready) throw new Error("the person is not loaded");
  if (o.sex) o = { ...o, sex: o.sex === "female" ? "f" : o.sex === "male" ? "m" : o.sex };
  const style = o.style ?? styleKind(av), sex = (o.sex ?? sexOf(av)) as string;
  if (o.sex && o.sex !== sexOf(av)) await switchPackage(packageFor(style, sex), sex === "f" ? "woman" : "man", false);
  else if (o.style && !av.manifest.styles?.[o.style]) await switchPackage(packageFor(o.style, sex), o.style === "clay" ? "clay figure" : "person");
  else if (o.style) await av.setStyle(o.style);
  if (o.tone !== undefined) await av.setTone(o.tone);
  if (o.wear) await av.wear(o.wear);
  if (av.manifest.tones || av.slots.length) remember(av);
  if (o.shape) av.setShape(o.shape);
  if (o.time !== undefined) stillAt = o.time;
  if (o.clip !== undefined) await av.setClip(o.clip, o.time ?? null);
  // a posture of the designer's list given as a clip frame (RELAXED_STAND = clip "idle-stand" at 1.0 s), or a pose of the package's library by id or name
  const pk = typeof o.pose === "string" ? av.manifest.packet?.poses?.[o.pose] : null;
  if (pk?.clip) { await av.setClip(pk.clip, o.time ?? pk.time ?? null); if (o.time === undefined && pk.time !== undefined) stillAt = pk.time; }
  else if (pk?.dofs && !pk.seat) av.setPose(pk.dofs);
  else if (o.pose && !(pk?.seat)) av.setPose(o.pose);
  else if (pk?.seat) { await av.setClip(null); av.state("operator").on = true; }
  if (o.pose === null || o.script) { await av.setClip(null); const op = av.state("operator"); op.on = true; if (o.script) op.script = o.script; }
  restart++; rebind();
  changedSignal();
  return state();
}
/** After every change, whoever made it (a person on the page, another browser through the live channel, an agent, a URL parameter). */
function changedSignal() { window.dispatchEvent(new CustomEvent("rigtwin:person", { detail: state() })); }
function state() {
  if (!av?.ready || !av.manifest) return { loaded: false, loading: !!av && !loadError, shown: false, error: loadError };   // before a package exists (the panel asks early)
  const op = av.state("operator"), ey = av.state("eyes");
  return {
    loaded: av.ready, shown, suppressed, error: loadError, package: av.manifest?.name ?? null, sex: sexOf(av), style: styleKind(av), tone: av.tone, worn: { ...av.worn }, shape: { ...av.shape }, measures: { ...av.measures },
    still: !(live && idleOn), stillTime: stillAt, look: lookOn, seated: av.seated, person: av.person || null, pose: av.mode === "clip" ? { clip: av.clipName, time: av.action?.time ?? null } : op.on ? { script: op.script } : { dofs: true },
    report: op.report ?? null, eyes: ey.report ? { mode: ey.report.mode, blink: ey.report.blink } : null,
    binding: av.binding ? { place: av.binding.place, report: av.binding.report ?? null } : null, placed: placeOverride,
    timing: { load_ms: Math.round(loadMs), bind_ms: +bindMs.toFixed(1), bake_ms: +av.bakeMs.toFixed(1), swap_ms: +av.swapMs.toFixed(1), sink_renders: av.contact.stats.renders },
    meshes: av.meshes.filter((m) => m.visible).length,
  };
}
/** What the person panel needs from the manifest, without fetching it again. */
function definition() {
  if (!av?.ready || !av.manifest) return null;
  const m = av.manifest, sh = m.shape;
  return {
    package: m.name, sex: sexOf(av), styles: Object.keys(PACKAGE_OF_STYLE), style: styleKind(av),
    controls: sh.controls.map((c: any) => ({ id: c.id, label: c.label, unit: c.unit ?? null, min: c.min, max: c.max, step: c.step ?? null, group: c.group ?? null, default: c.default ?? null })),
    presets: (sh.presets ?? []).map((p: any) => ({ name: p.name, values: p.values })),
    tones: (m.tones?.list ?? []).map((t: any) => ({ id: t.id, label: t.label })), defaultTone: m.tones?.default ?? null,
    slots: av.slots.map((sl) => ({ id: sl.id, label: sl.label ?? sl.id, allowNone: !!sl.allowNone, default: sl.default ?? null, garments: sl.garments.map((g: any) => ({ id: g.id, label: g.label ?? g.id })) })),
    clips: (m.clips ?? []).map((c: any) => ({ name: c.name, loop: !!c.loop, seated: !!c.seated })), poses: (m.poses ?? []).map((p: any) => p.id ?? p.name), scripts: Object.keys(SCRIPTS),
    licence: m.licence ?? [],
  };
}
/** Place the person off the seat (rig MODEL frame, metres; yaw about model Z, 0 = facing +X), or null: back on the seat binding. */
/** How deep the drawn skin lies inside each hard shell of the rig binding (the pods' inner sides), before and after the contact (mm),
 *  measured on the GPU as drawn: Avatar.skinnedPositions has no contact. null without a person; {} without shells. */
function shells(): Record<string, { before_mm: number; after_mm: number; deepest_after?: { up_mm: number; along_mm: number } }> | null {
  if (!av?.ready) return null;
  const d = av.contact.shellDepths(av.meshes.filter((m) => m.visible), renderer, av.U), mm = (x: number) => +(x * 1000).toFixed(2);
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { before_mm: mm(v.before), after_mm: mm(v.after), ...(v.at ? { deepest_after: { up_mm: mm(v.at[0]), along_mm: mm(v.at[1]) } } : {}) }]));
}
/** What a person standing at a point of the model frame stands on: the deck top over the platform (C_platform's footprint), the room
 *  floor (D_floor, as posed now) anywhere else. MPK: figures placed beside the rig stood at the deck's height, afloat beside it. */
function floorAt(x: number, y: number): { z: number; on: "deck" | "floor" } {
  const bb = S.manifest?.components?.find((c: any) => c.id === "C_platform")?.bbox, g = GROUND.place_snap;
  if (bb && x >= bb.min[0] - g && x <= bb.max[0] + g && y >= bb.min[1] - g && y <= bb.max[1] + g) return { z: bb.max[2], on: "deck" };
  const f = rigView().point("D_floor");
  return { z: f ? f[2] : bb ? bb.min[2] : 0, on: "floor" };
}
/** Stand the person at origin [x, y] (model frame; a z given is replaced by the surface there: the deck top over the platform, the
 *  floor elsewhere) turned by yawDeg, or back to the rig binding's seat with null. state().placed says where the soles went. */
function place(p: { origin: number[]; yawDeg?: number } | null) {
  if (p) { const f = floorAt(p.origin[0], p.origin[1]); placeOverride = { origin: [p.origin[0], p.origin[1], f.z], yawDeg: p.yawDeg ?? 0, on: f.on }; } else placeOverride = null;
  rebind(); changedSignal(); return state();
}
/** A named point of the person in the rig MODEL frame (eye_midpoint, head_centre, hand_L, hand_R, pelvis, feet, a joint name, ...). */
function anchor(name: string) { if (!av?.ready) return null; av.holder.updateMatrixWorld(true); const p = av.anchor(name); return p ? w2m(p) : null; }
/** The nearest point of the person under a pixel of the 3D view ({ distance, point } in metres, model frame), or null. Picked on the
 *  vertices as the person's shader skins them (Avatar.skinnedPositions: eight influences and the dual-quaternion mask), not with three's
 *  raycast, which skins with four influences only and was up to 190 mm off on operator-m (MPK). */
/** The distance (metres, along the pixel's ray) to the person as its own shaders draw it, at one pixel of the 3D view, or null: the
 *  person's depth materials (shaders.ts) rendered for that pixel alone. For the check that picks land on the drawn skin. */
function depthAt(x: number, y: number): number | null {
  if (!av?.ready || !shown) return null;
  const cam = currentCamera() as THREE.PerspectiveCamera, { w, h } = frameSize(), rt = new THREE.WebGLRenderTarget(1, 1), saved = av.meshes.map((m) => m.material), layers = cam.layers.mask;
  // the shadow pass leaves its own face side (back faces) and cut on the depth materials: draw them here as the look materials are drawn
  const sides = av.meshes.map((m) => m.customDepthMaterial!.side), L = 31;
  for (const m of av.meshes) { const dm = m.customDepthMaterial!, look = m.material as THREE.Material; dm.side = look.side; m.layers.enable(L); m.material = dm; }
  cam.setViewOffset(w, h, Math.floor(x), Math.floor(y), 1, 1); cam.layers.set(L);
  const prev = renderer.getRenderTarget(), cc = new THREE.Color(), ca = renderer.getClearAlpha(); renderer.getClearColor(cc);
  renderer.setRenderTarget(rt); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.shadowMap.needsUpdate = false; renderer.render(scene, cam);
  const px = new Uint8Array(4); renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px); renderer.setRenderTarget(prev); renderer.setClearColor(cc, ca); rt.dispose();
  cam.clearViewOffset(); cam.layers.mask = layers; av.meshes.forEach((m, i) => { m.material = saved[i]; m.customDepthMaterial!.side = sides[i]; m.layers.disable(L); });
  const k = 255 / 256, d = (px[0] / 255) * k + (px[1] / 255) * k / 256 + (px[2] / 255) * k / 65536 + (px[3] / 255) / 16777216;      // three r187's RGBA depth packing, red most significant (unpackRGBAToDepth)
  if (d >= 0.99999) return null;
  const n = cam.near, f = cam.far, viewZ = (2 * n * f) / (f + n - (d * 2 - 1) * (f - n));
  const dir = new THREE.Vector3((x / w) * 2 - 1, -(y / h) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize(), fwd = cam.getWorldDirection(new THREE.Vector3());
  return viewZ / dir.dot(fwd);
}
const ray = new THREE.Raycaster();
let proxies: { key: number; list: THREE.Mesh[] } | null = null, frameNo = 0;
function pickAt(x: number, y: number, near = 0) {
  if (!av?.ready || !shown) return null;
  const { w, h } = frameSize(); scene.updateMatrixWorld();
  if (!proxies || proxies.key !== frameNo) {                       // skinned once per drawn frame, on demand
    proxies = { key: frameNo, list: av.meshes.filter((m) => m.visible).map((m) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(av!.skinnedPositions(m), 3)); g.setIndex(m.geometry.index); const px = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); px.name = m.name; return px; }) };
  }
  ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), currentCamera()); ray.near = Math.max(near, av.U.personNear.value); ray.far = Infinity;   // what is not drawn is not picked
  const hit = ray.intersectObjects(proxies.list.filter((p) => av!.meshes.find((m) => m.name === p.name)?.visible), false)[0];
  return hit ? { distance: hit.distance, point: w2m(hit.point), mesh: hit.object.name } : null;
}
/** Milliseconds per frame (CPU and GPU: each frame is finished with a one-pixel read) over n frames of the current view, with the
 *  person advancing by 1/idle_fps each frame (`idle`) or still, its shadow redrawn each frame as in the idle view. */
async function bench(n = 60, opts: { idle?: boolean } = {}) {
  const gl = renderer.getContext(), px = new Uint8Array(4), times: number[] = [], cpu: number[] = [];
  const keep = idleOn; idleOn = !!opts.idle;
  for (let i = 0; i < n + 5; i++) {
    const t0 = performance.now();
    if (opts.idle) lastUpdate = t0 - 1000 / RT.idle_fps;
    if (opts.idle) S.shadowDirty = true;
    drawNow(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (i >= 5) { times.push(performance.now() - t0); cpu.push(shown ? updateMs : 0); }
    await new Promise((r) => setTimeout(r, 0));
  }
  idleOn = keep;
  times.sort((a, b) => a - b); cpu.sort((a, b) => a - b);
  return { frames: n, median_ms: +times[Math.floor(n / 2)].toFixed(2), person_update_ms: +cpu[Math.floor(n / 2)].toFixed(2), p90_ms: +times[Math.floor(n * 0.9)].toFixed(2), triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, person_shown: shown };
}

/** The default person's manifest, as the server's version.json names it (only when the package is in the release). */
async function defaultPackage(): Promise<string | null> {
  try { const v = await (await fetch("version.json", { cache: "no-store" })).json(); return typeof v?.person?.package === "string" ? v.person.package : null; } catch { return null; }
}
export async function initPerson() {
  const q = Q.get("person"), hidden = q === "off", url = q && q !== "off" && q !== "1" ? q : await defaultPackage();
  if (!url) return;                                                  // no person in this release (version.json names none)
  idleOn = Q.get("person_idle") !== "0"; lookOn = Q.get("person_look") !== "0"; suppressed = hidden;
  viewerApi.person = { state, definition, show, set, place, anchor, pickAt, depthAt, shells, look: (on: boolean) => { lookOn = !!on; if (av) av.U.personLook.value = lookOn ? 1 : 0; dirty(); changedSignal(); return state(); }, object: () => av?.holder ?? null, bench, ready, avatar: () => av, still: (on: boolean) => { live = !on; restart++; dirty(); changedSignal(); return state(); } };
  hooks.beforeRender.push(beforeRender);
  hooks.onApply.push((o: Opts) => { live = !(o.ui === "0" || o.ui === false || o.still === "1" || o.still === true); restart++; if (av?.ready) dirty(); });
  if (Q.get("ui") === "0") live = false;
  on((c) => { if (c === "joints" && av?.ready) rebind(); if (c === "view") firstPerson(); });
  hooks.operatorEye.push(() => (av?.ready && shown && av.seated && av.state("operator").on ? anchor("eye_midpoint") : null));
  requestAnimationFrame(idle);
  if (!hidden) say("Loading the person…");
  const t0 = performance.now();
  try {
    av = new Avatar(renderer, TRANSCODER);
    await av.loadPackage(url);
    if (Q.get("person_tone")) await av.setTone(Q.get("person_tone")!);
    if (Q.get("person_wear")) await av.wear(Object.fromEntries(Q.get("person_wear")!.split(",").map((kv) => kv.split(":")).map(([k, v]) => [k, v === "none" ? null : v])));
    scene.add(av.holder); av.holder.visible = false;
    rebind();
    if (Q.get("person_style") || Q.get("person_sex") || Q.get("person_shape")) await set({ ...(Q.get("person_style") ? { style: Q.get("person_style")! } : {}), ...(Q.get("person_sex") ? { sex: Q.get("person_sex") as "m" | "f" } : {}), ...(Q.get("person_shape") ? { shape: Q.get("person_shape")! } : {}) });   // one call: the shape after the package of that sex
    loadMs = performance.now() - t0;
    remember(av);
    await show(!hidden);
    say(null);
    readyResolve(true);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
    console.error(e);
    say(`The person could not be shown: ${loadError}`, true);
    readyResolve(false);
  }
}
