// Pointer work on the 3D view: pointing (outline + name), clicking (select), double-clicking (zoom to),
// and dragging a selected part along its own adjustment while the camera stays still.
//
// Picking order: the first click on a part picks the thing it belongs to when that thing is what people
// mean (the seat, a joystick, the touchscreen with its arm); a second, unhurried click picks the single
// part. A screen surface always counts as its monitor or touchscreen.
import * as THREE from 'three';
import {
  S, $, canvas, frameEl, stageEl, controls, currentCamera, frameSize, scene, persp,
  pickAt, partOf, firstPick, kindOf, members, nameOf, select, setHover, jointsFor, poseJoint, setAdjustment, adjustmentRange, adjustmentValue,
  zoomTo, goHome, lookZoom, stopGlide, hooks as engineHooks, type JointState,
} from './engine.ts';
import { adjWords } from '../../shared/words.ts';

/** What a click on this part would select right now. */
export function wouldPick(part: string): string {
  const whole = firstPick(part), sel = S.selected;
  if (whole === part || sel === part || sel === whole) return part;
  if (sel && kindOf(sel) === 'part' && firstPick(sel) === whole) return part;   // already working inside this thing
  return whole;
}

// --------------------------------------------------------------------------------------------- dragging a part along its adjustment
interface Dof { j: JointState; id: string; comp: number | null }
/** What a drag on the grabbed point could move: the part's own hinge (one or two turning adjustments nearest to it), and every sliding adjustment that carries it. */
interface DragPlan { mesh: THREE.Mesh; local: THREE.Vector3; hinge: Dof[]; slides: Dof[] }
const get = (d: Dof) => adjustmentValue(d.id, d.comp);
function trial(d: Dof, v: number) { const cur = d.j.value; poseJoint(d.j, d.comp === null ? v : (cur as number[]).map((x, i) => (i === d.comp ? v : x))); d.j.obj.updateMatrixWorld(true); }
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
type Grab = { mesh: THREE.Mesh; local: THREE.Vector3 };
const worldOf = (g: Grab, out: THREE.Vector3) => out.copy(g.local).applyMatrix4(g.mesh.matrixWorld);
function screenOfWorld(p: THREE.Vector3): [number, number] { const { w, h } = frameSize(), q = tmp2.copy(p).project(currentCamera()); return [((q.x + 1) / 2) * w, ((1 - q.y) / 2) * h]; }
const screenOf = (g: Grab) => screenOfWorld(worldOf(g, tmp));
/** How far (pixels) the grabbed point moves on screen per unit of this adjustment, found by trying a small step. */
function sensitivity(g: Grab, d: Dof): [number, number] {
  const v = get(d), r = adjustmentRange(d.id, d.comp), eps = v + 1e-3 <= r.hi ? 1e-3 : -1e-3;
  const a = screenOf(g); trial(d, v + eps); const b = screenOf(g); trial(d, v);
  return [(b[0] - a[0]) / eps, (b[1] - a[1]) / eps];
}
/** Is dragging this adjustment by this point sensible from the current viewpoint? Not when the part would move straight toward
 *  or away from the camera (a hair of pointer travel would then throw it across its range), nor when its whole travel is a few pixels. */
function draggable(g: Grab, d: Dof): boolean {
  const v = get(d), r = adjustmentRange(d.id, d.comp), eps = v + 1e-3 <= r.hi ? 1e-3 : -1e-3;
  const p0 = worldOf(g, new THREE.Vector3()), a = screenOfWorld(p0);
  trial(d, v + eps); const p1 = worldOf(g, new THREE.Vector3()), b = screenOfWorld(p1); trial(d, v);
  const metres = p0.distanceTo(p1) / Math.abs(eps), pixels = Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.abs(eps);
  if (metres < 1e-6) return false;
  const cam = currentCamera(), side = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), c = screenOfWorld(p0.clone().addScaledVector(side, 0.01));
  const pxPerMetre = Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.01;
  return pixels / (metres * pxPerMetre) >= 0.3 && pixels * (r.hi - r.lo) >= 12;
}
/** The adjustment(s) a drag on this mesh would move, or null when the part does not move (or the view makes the drag too twitchy). */
function planDrag(hit: { id: string; mesh: THREE.Mesh; world: THREE.Vector3 }): DragPlan | null {
  if (!S.selected || S.photo || !members(S.selected).includes(hit.id)) return null;
  const allowed = new Set(jointsFor(S.selected));
  // joints that carry the grabbed mesh, nearest first
  const chain: JointState[] = [];
  for (let o: THREE.Object3D | null = hit.mesh; o; o = o.parent) { const id = o.userData?.id as string | undefined; if (id && allowed.has(id)) chain.push(S.joints.get(id)!); }
  if (!chain.length) return null;
  scene.updateMatrixWorld();
  const base = { mesh: hit.mesh, local: hit.mesh.worldToLocal(hit.world.clone()) };
  const dofsOf = (j: JointState): Dof[] => adjWords(j.def).filter((w) => !w.fine).map((w) => ({ j, id: j.def.id, comp: w.comp }));
  const groups: JointState[][] = [];
  for (const j of chain) { const g = groups.find((x) => x[0].def.child === j.def.child); if (g) g.push(j); else groups.push([j]); }
  const slides = chain.filter((j) => j.def.type === 'prismatic').flatMap(dofsOf).filter((d) => draggable(base, d));
  // the part's own hinge: the nearest group of joints, when that group only turns (a backrest, a pedal, a joystick, a monitor head)
  let hinge: Dof[] = [];
  for (const g of groups) {
    if (g.some((j) => j.def.type === 'prismatic')) break;
    hinge = g.flatMap(dofsOf).filter((d) => draggable(base, d)).slice(0, 2);
    if (hinge.length) break;
  }
  return hinge.length || slides.length ? { ...base, hinge, slides } : null;
}
/** Which of the plan's adjustments a drag that started out along (dx, dy) means. The part goes where it is pulled: a slide that
 *  runs along the pull wins over a two-way hinge (pull the monitor down: it goes down; pull its edge sideways: it turns); a
 *  one-way hinge that runs along the pull wins over a slide (pull the headrest back: the backrest reclines, the seat stays). */
function choose(plan: DragPlan, dx: number, dy: number): Dof[] {
  const along = (d: Dof) => { const v = sensitivity(plan, d), n = Math.hypot(...v) * Math.hypot(dx, dy); return n > 0 ? Math.abs(dx * v[0] + dy * v[1]) / n : 0; };
  let slide: Dof | null = null, best = -1;
  for (const d of plan.slides) { const c = along(d); if (c > best) { best = c; slide = d; } }
  if (!plan.hinge.length) return slide ? [slide] : [];
  if (!slide) return plan.hinge;
  if (plan.hinge.length === 2) return best >= 0.8 ? [slide] : plan.hinge;
  const c = along(plan.hinge[0]);
  return c >= 0.8 || c >= best ? plan.hinge : [slide];
}
/** Move the plan's adjustments so the grabbed point follows the pointer as far as the limits allow. A few Newton steps on the
 *  screen position; an adjustment that has reached its stop and is asked for more is left there and the others take up the rest. */
function follow(plan: DragPlan, dofs: Dof[], x: number, y: number) {
  const vals = dofs.map(get), stuck = dofs.map(() => false), ranges = dofs.map((d) => adjustmentRange(d.id, d.comp));
  for (let it = 0; it < 4; it++) {
    const p = screenOf(plan), ex = x - p[0], ey = y - p[1];
    if (Math.hypot(ex, ey) < 0.3) break;
    const free = dofs.map((_, k) => k).filter((k) => !stuck[k]);
    if (!free.length) break;
    const s = dofs.map((d) => sensitivity(plan, d)), dv = dofs.map(() => 0);
    const one = (k: number) => { const n = s[k][0] * s[k][0] + s[k][1] * s[k][1]; return n > 1 ? (ex * s[k][0] + ey * s[k][1]) / n : 0; };
    if (free.length === 2) {
      const det = s[0][0] * s[1][1] - s[1][0] * s[0][1];
      if (Math.abs(det) > 0.05 * Math.hypot(...s[0]) * Math.hypot(...s[1])) { dv[0] = (ex * s[1][1] - s[1][0] * ey) / det; dv[1] = (s[0][0] * ey - ex * s[0][1]) / det; }
      else { dv[0] = one(0) / 2; dv[1] = one(1) / 2; }
    } else dv[free[0]] = one(free[0]);
    for (const k of free) {
      const r = ranges[k], span = r.hi - r.lo, want = vals[k] + Math.max(-span / 2, Math.min(span / 2, dv[k]));
      vals[k] = Math.min(r.hi, Math.max(r.lo, want));
      if (want !== vals[k]) stuck[k] = true;
      trial(dofs[k], vals[k]);
    }
  }
  dofs.forEach((d, k) => setAdjustment(d.id, d.comp, vals[k]));   // announces the change: card, notices, shadows, redraw
}
/** Words for the card: what dragging the selected thing does, or '' when nothing can be dragged. */
export function dragHint(): string {
  if (!S.selected) return '';
  return jointsFor(S.selected).length ? 'or drag the part in the picture' : '';
}

// --------------------------------------------------------------------------------------------- pointer wiring
export function initPointer(hooks: { onFirstUse: () => void; freeWidth: () => number }) {
  const tip = $('tip');
  let down: { x: number; y: number; id: number } | null = null, lastMove = 0, lastClick = { t: 0, whole: '' };
  let drag: { plan: DragPlan; dofs: Dof[] | null; moved: boolean; wasEnabled: boolean } | null = null;
  const local = (e: { clientX: number; clientY: number }): [number, number] => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const setCursor = (c: string) => { if (canvas.style.cursor !== c) canvas.style.cursor = c; };
  setCursor('grab');

  // capture phase on the parent: runs before the orbit control's own handler on the canvas, so a part drag can switch the orbit off for this gesture
  frameEl.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) return;
    hooks.onFirstUse(); stopGlide();
    const [x, y] = local(e);
    down = { x, y, id: e.pointerId };
    tip.hidden = true;
    if (e.button === 0 && e.isPrimary && !e.shiftKey && !e.ctrlKey && !e.metaKey && S.selected) {
      const hit = pickAt(x, y), plan = hit && planDrag(hit);
      if (plan) {
        drag = { plan, dofs: null, moved: false, wasEnabled: controls.enabled };
        controls.enabled = false;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointers cannot be captured */ }
        setCursor('grabbing'); document.body.classList.add('part-drag');
        return;
      }
    }
    setCursor('grabbing');
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (drag && down && e.pointerId === down.id) {
      const dx = x - down.x, dy = y - down.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (!drag.dofs) drag.dofs = choose(drag.plan, dx, dy);      // decided once, by the direction the drag sets out in
      if (!drag.dofs.length) return;
      follow(drag.plan, drag.dofs, x, y);
      return;
    }
    if (e.buttons || e.pointerType === 'touch' || performance.now() - lastMove < 40) return; lastMove = performance.now();
    const h = pickAt(x, y);
    if (!h) { setHover(null); tip.hidden = true; setCursor('grab'); return; }
    const part = partOf(h.id), target = wouldPick(part);
    const draggable = !!S.selected && members(S.selected).includes(h.id) && !!planDrag(h);
    setHover(draggable ? S.selected : target);
    setCursor(draggable ? 'move' : 'pointer');
    tip.textContent = draggable ? `${nameOf(S.selected!)}: drag to adjust` : nameOf(target) + (jointsFor(target).length ? ' · adjustable' : '');
    tip.hidden = false;
    const s = stageEl.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(4, Math.min(e.clientX - s.left + 14, s.width - tw - 4))}px`;
    tip.style.top = `${Math.max(4, Math.min(e.clientY - s.top + 16, s.height - th - 4))}px`;
  });
  const finish = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return;
    const [x, y] = local(e), still = Math.hypot(x - down.x, y - down.y) < 4, wasDrag = drag?.moved;
    if (drag) { controls.enabled = drag.wasEnabled; drag = null; document.body.classList.remove('part-drag'); try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ } }
    down = null; setCursor('grab');
    if (e.type !== 'pointerup' || !still || wasDrag || e.button !== 0) return;
    const h = pickAt(x, y);
    if (engineHooks.click.some((f) => f(x, y, h ? h.world.distanceTo(currentCamera().position) : Infinity))) return;   // the person took it (person-panel.ts)
    if (!h) { select(null); return; }
    const part = partOf(h.id), whole = firstPick(part), now = performance.now();
    const second = now - lastClick.t < 400 && lastClick.whole === whole;      // second click of a double-click: stay, the double-click zooms
    if (!(second && S.selected === whole)) select(wouldPick(part));
    lastClick = { t: now, whole };
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', () => { if (!down) { setHover(null); tip.hidden = true; } });
  canvas.addEventListener('dblclick', (e) => {
    const [x, y] = local(e), h = pickAt(x, y);
    if (h) { const part = partOf(h.id); zoomTo([S.selected && members(S.selected).includes(h.id) ? S.selected : wouldPick(part)], hooks.freeWidth()); }
    else goHome();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // operator's eye: the wheel narrows or widens the view instead of flying through the monitor
  frameEl.addEventListener('wheel', (e) => {
    hooks.onFirstUse(); stopGlide();
    if (S.view === 'operator' && currentCamera() === persp && !S.photo) { e.preventDefault(); e.stopPropagation(); lookZoom(e.deltaY > 0 ? 1.07 : 1 / 1.07); }
  }, { capture: true, passive: false });
}
