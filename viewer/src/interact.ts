// Pointer work on the 3D view: pointing (outline + name), clicking (select), double-clicking (zoom to),
// and dragging a selected part along its own adjustment while the camera stays still.
//
// Picking order: the first click on a part picks the thing it belongs to when that thing is what people
// mean (the seat, a joystick, the touchscreen with its arm); a second, unhurried click picks the single
// part. A screen surface always counts as its monitor or touchscreen.
import * as THREE from 'three';
import {
  S, $, canvas, frameEl, stageEl, controls, currentCamera, frameSize, scene, persp,
  pickAt, partOf, firstPick, kindOf, members, nameOf, setHover, jointsFor, poseJoint, setAdjustment, adjustmentRange, adjustmentValue,
  zoomTo, goHome, lookZoom, stopGlide, hooks as engineHooks,
} from './engine.ts';
import { projectedGrab, type GrabAxis } from './direct-grab.ts';
import { adjWords } from '../../shared/words.ts';

/** What a click on this part would select right now. */
export function wouldPick(part: string): string {
  const whole = firstPick(part), sel = S.selected;
  if (whole === part || sel === part || sel === whole) return part;
  if (sel && kindOf(sel) === 'part' && firstPick(sel) === whole) return part;   // already working inside this thing
  return whole;
}

// --------------------------------------------------------------------------------------------- dragging a part along its adjustment
interface Dof extends GrabAxis { id:string;comp:number|null }
function planDrag(hit:{id:string;mesh:THREE.Mesh;world:THREE.Vector3}) {
  if (!S.selected || S.photo || !members(S.selected).includes(hit.id)) return null;
  const allowed=new Set(jointsFor(S.selected)),chain=[];
  for (let node:THREE.Object3D|null=hit.mesh;node;node=node.parent) {
    const id=node.userData.id,j=S.joints.get(id);
    if (!j || !allowed.has(id)) continue;
    const axes:Dof[]=adjWords(j.def).filter(w=>!w.fine).map(({comp})=>({
      id,comp,...adjustmentRange(id,comp),value:()=>adjustmentValue(id,comp),
      trial(v:number) {
        poseJoint(j,comp===null ? v : (j.value as number[]).map((n,i)=>i===comp ? v : n));
        j.obj.updateMatrixWorld(true);
      },
    }));
    chain.push({child:j.def.child,slide:j.def.type==='prismatic',axes});
  }
  if (!chain.length) return null;
  scene.updateMatrixWorld();
  const {w,h}=frameSize();
  return projectedGrab(hit.mesh,hit.world,currentCamera(),w,h,chain);
}
type DragPlan=NonNullable<ReturnType<typeof planDrag>>;
// --------------------------------------------------------------------------------------------- pointer wiring
export function initPointer(hooks: { freeWidth: () => number; revealSelection: () => void; openAdditional: (target: string) => void; selectComponent: (target: string | null) => void }) {
  const tip = $('tip');
  let down: { x: number; y: number; id: number } | null = null, lastMove = 0;
  let lastClick: { t: number; x: number; y: number; target: string | null; person: boolean } | null = null;
  let drag: { plan: DragPlan; dofs: Dof[] | null; moved: boolean; wasEnabled: boolean } | null = null;
  const local = (e: { clientX: number; clientY: number }): [number, number] => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const setCursor = (c: string) => { if (canvas.style.cursor !== c) canvas.style.cursor = c; };
  setCursor('grab');

  // capture phase on the parent: runs before the orbit control's own handler on the canvas, so a part drag can switch the orbit off for this gesture
  frameEl.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) return;
    stopGlide();
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
      if (!drag.dofs) drag.dofs = drag.plan.choose(dx, dy);      // decided once, by the direction the drag sets out in
      if (!drag.dofs.length) return;
      drag.plan.follow(drag.dofs, x, y);
      for (const axis of drag.dofs) setAdjustment(axis.id,axis.comp,axis.value());
      return;
    }
    if (e.buttons || e.pointerType === 'touch' || performance.now() - lastMove < 40) return; lastMove = performance.now();
    const h = pickAt(x, y);
    if (!h) { setHover(null); tip.hidden = true; setCursor('grab'); return; }
    const part = partOf(h.id), target = wouldPick(part);
    const draggable = !!S.selected && members(S.selected).includes(h.id) && !!planDrag(h);
    setHover(draggable ? S.selected : target);
    setCursor(draggable ? 'move' : 'pointer');
    tip.textContent = draggable ? `Drag to adjust ${nameOf(S.selected!)}` : nameOf(target);
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
    if (e.type !== 'pointerup' || !still || wasDrag || e.button !== 0) { lastClick = null; return; }
    const now = performance.now();
    if (!e.shiftKey && lastClick && now - lastClick.t < 400 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 5) return;
    const h = pickAt(x, y);
    const person = engineHooks.click.some((f) => f(x, y, h ? h.world.distanceTo(currentCamera().position) : Infinity, e.shiftKey));
    if (e.shiftKey) {
      lastClick = null;
      if (!person && h) hooks.openAdditional(firstPick(partOf(h.id)));
      return;
    }
    const target = !person && h ? wouldPick(partOf(h.id)) : null;
    lastClick = { t: now, x: e.clientX, y: e.clientY, target, person };
    if (!person) {
      if (target && target === S.selected) hooks.revealSelection();
      else hooks.selectComponent(target);
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', () => { if (!down) { setHover(null); tip.hidden = true; } });
  canvas.addEventListener('dblclick', (e) => {
    const click = lastClick; lastClick = null;
    if (!click || click.person || Math.hypot(e.clientX - click.x, e.clientY - click.y) >= 5) return;
    // The first click may open the inspector and reproject the rig before the second.
    if (click.target) zoomTo([click.target], hooks.freeWidth());
    else goHome();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // operator's eye: the wheel narrows or widens the view instead of flying through the monitor
  frameEl.addEventListener('wheel', (e) => {
    stopGlide();
    if (S.view === 'operator' && currentCamera() === persp && !S.photo) { e.preventDefault(); e.stopPropagation(); lookZoom(e.deltaY > 0 ? 1.07 : 1 / 1.07); }
  }, { capture: true, passive: false });
}
