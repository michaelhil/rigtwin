// The page around the 3D view: the parts list (six-or-so rows with eye buttons), the card for the
// selected part (hide / show only this / zoom to and that part's own adjustments), the notices on
// the picture (hidden parts, moved parts, assumed ranges), the toolbar with More, keys, and the link
// that reproduces the current state.
import {
  S, $, el, on, DEG, VIEWS, CLASS_COLORS, idColor, canvas, stageEl, persp, controls, currentCamera, w2m,
  members, kindOf, nameOf, ownerOf, partOf, firstPick, visibilityOf, setVisible, showOnly, showAll, select, setHover,
  setView, setMode, setPhotoCamera, setOverlay, zoomTo, goHome, clearOfPanel, layout, frameSize, rescaleView, resetJoints, movedJoints, assumedInUse, isAssumed,
  jointsFor, setAdjustment, adjustmentValue, adjustmentRange, viewerApi, type Change,
} from './engine.ts';
import { initPointer, dragHint } from './interact.ts';
import { adjWords, partName, knownAs, sayOffset, sayValue, sayParam, sayKey, CLASS_ORDER, CLASS_WORDS, type AdjWord } from './words.ts';

const NARROW = 900;
const narrow = () => window.innerWidth < NARROW;
const svg = (d: string) => `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
const EYE = svg('<path d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z"/><circle cx="10" cy="10" r="2.5"/>');
const EYE_OFF = svg('<path d="M3.6 6.9C2.4 8.2 1.8 10 1.8 10s3 5.4 8.2 5.4c1 0 2-.2 2.8-.5M7.7 4.9c.7-.2 1.5-.3 2.3-.3 5.2 0 8.2 5.4 8.2 5.4s-.7 1.3-2 2.7"/><path d="M3 3l14 14"/>');
const EYE_HALF = svg('<path d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z" stroke-dasharray="2.4 2.4"/><circle cx="10" cy="10" r="2.5"/>');
const button = (cls: string | null, text: string, onClick: () => void) => { const b = el('button', cls, text) as HTMLButtonElement; b.type = 'button'; b.addEventListener('click', onClick); return b; };
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// --------------------------------------------------------------------------------------------- parts list
interface RowUi { box: HTMLElement; eye: HTMLButtonElement; name: HTMLButtonElement; chip?: HTMLElement; kids?: HTMLElement; top: boolean }
const rowUi = new Map<string, RowUi>();
const openRows = new Set<string>();
function toggleVisible(id: string) { setVisible([id], visibilityOf(id) !== 'shown'); }
function buildTree() {
  const tree = $('tree'); tree.textContent = '';
  const eyeButton = (id: string, name: string) => { const b = button('eye', '', () => toggleVisible(id)); b.dataset.name = name; return b; };
  for (const row of S.rows) {
    const group = el('div', 'group'), head = el('div', 'row top'), kids = el('div', 'kids');
    const eye = eyeButton(row.id, row.name);
    const name = button('name', '', () => { if (S.selected === row.id || !openRows.has(row.id)) setOpen(row.id, !openRows.has(row.id)); select(row.id); });
    const count = el('span', 'count', String(row.parts.length)); count.title = `${row.parts.length} parts`;
    name.append(el('span', 'label', row.name), count, el('span', 'chev'));
    name.setAttribute('aria-expanded', 'false');
    head.append(eye, name); kids.hidden = true;
    head.addEventListener('mouseenter', () => setHover(row.id)); head.addEventListener('mouseleave', () => setHover(null));
    rowUi.set(row.id, { box: head, eye, name, kids, top: true });
    for (const id of row.parts) {
      const it = S.byId.get(id)!, words = partName(it), r = el('div', 'row kid');
      const e = eyeButton(id, words.full), chip = el('i', 'chip');
      const n = button('name', '', () => { select(id); if (narrow()) setDrawer(false); });
      n.append(chip, el('span', 'label', words.short));
      n.title = id;                                                   // the model's own id, for people who work with the files
      n.addEventListener('dblclick', () => zoomTo([id], freeWidth()));
      r.append(e, n);
      r.addEventListener('mouseenter', () => setHover(id)); r.addEventListener('mouseleave', () => setHover(null));
      rowUi.set(id, { box: r, eye: e, name: n, chip, top: false });
      kids.append(r);
    }
    group.append(head, kids); tree.append(group);
  }
}
function setOpen(rowId: string, open: boolean) {
  const r = rowUi.get(rowId); if (!r?.kids) return;
  open ? openRows.add(rowId) : openRows.delete(rowId);
  r.kids.hidden = !open; r.name.setAttribute('aria-expanded', String(open)); r.box.classList.toggle('open', open);
}
/** Eye icons, greyed names and colour chips: after a visibility or colour-mode change. */
function refreshEyes() {
  for (const [id, r] of rowUi) {
    const v = visibilityOf(id), name = r.eye.dataset.name!;
    if (r.eye.dataset.v !== v) {
      r.eye.dataset.v = v; r.eye.innerHTML = v === 'shown' ? EYE : v === 'hidden' ? EYE_OFF : EYE_HALF;
      r.eye.setAttribute('aria-pressed', String(v !== 'hidden'));
      r.eye.setAttribute('aria-label', `${v === 'shown' ? 'Hide' : 'Show'} ${name}`); r.eye.title = v === 'shown' ? 'Hide' : v === 'hidden' ? 'Show' : 'Partly hidden: show all of it';
      r.box.classList.toggle('off', v === 'hidden'); r.box.classList.toggle('mixed', v === 'mixed');
    }
    if (r.chip) r.chip.style.background = S.mode === 'ids' ? (idColor.has(id) ? '#' + idColor.get(id)!.getHexString() : 'transparent') : S.mode === 'class' ? CLASS_COLORS[S.byId.get(id)!.class ?? 'none'] : 'transparent';
  }
}
/** Which rows are marked as selected or pointed at. */
function refreshMarks() {
  const sel = S.selected, selParts = new Set(sel && kindOf(sel) !== 'row' ? members(sel).map(partOf) : []);
  const hovParts = new Set(S.hover && kindOf(S.hover) !== 'row' ? members(S.hover).map(partOf) : []);
  for (const [id, r] of rowUi) {
    r.box.classList.toggle('sel', r.top ? sel === id : selParts.has(id));
    r.box.classList.toggle('hover', r.top ? S.hover === id : hovParts.has(id));
  }
}
function revealSelection() {
  const sel = S.selected; if (!sel || kindOf(sel) === 'row') return;
  const first = members(sel).map(partOf)[0], row = S.rowOf.get(first);
  if (row) setOpen(row, true);
  rowUi.get(first)?.box.scrollIntoView({ block: 'nearest' });
}
function setDrawer(open: boolean) {
  document.body.classList.toggle('parts-open', open); $('scrim').hidden = !open; $('open-parts').setAttribute('aria-expanded', String(open));
}

// --------------------------------------------------------------------------------------------- the card for the selected part
interface Ctl { words: AdjWord[]; refresh: () => void }
let cardCtls: Ctl[] = [], cardJoints: string[] = [];
const unitOfJoint = (id: string) => S.joints.get(id)!.def.unit;
const SLIDER_K = (unit: 'm' | 'rad') => (unit === 'm' ? 1000 : 1 / DEG);       // slider steps: millimetres, or degrees
const assumedTag = () => { const t = el('span', 'tag', 'assumed range'); t.title = 'Assumed range — not confirmed on the real rig'; return t; };
function sliderControl(w: AdjWord, owner: string): { node: HTMLElement; ctl: Ctl } {
  const def = S.joints.get(w.joint)!.def, unit = def.unit, k = SLIDER_K(unit) * (w.flip ? -1 : 1), r = adjustmentRange(w.joint, w.comp);
  const box = el('div', 'adj'), top = el('div', 'adj-top'), id = `adj-${w.key.replace(/\W/g, '-')}`;
  const label = el('label', null, w.label) as HTMLLabelElement; label.htmlFor = id;
  const out = el('output'), back = button('back', '↺', () => setAdjustment(w.joint, w.comp, r.neutral));
  back.title = 'Back to as photographed'; back.setAttribute('aria-label', `${owner}, ${w.label.toLowerCase()}: back to as photographed`);
  top.append(label); if (isAssumed(def)) top.append(assumedTag());
  top.append(out, back);
  const track = el('div', 'track'), rng = el('div', 'rng'), s = el('input') as HTMLInputElement, tick = el('i', 'tick');
  const a = r.lo * k, b = r.hi * k;
  const step = unit === 'm' ? 1 : 0.5, snap = (v: number) => Math.round(v / step) * step;        // ends on whole steps, so the last step is reachable
  s.type = 'range'; s.id = id; s.min = String(snap(Math.min(a, b))); s.max = String(snap(Math.max(a, b))); s.step = String(step);
  s.setAttribute('aria-label', `${owner}: ${w.label.toLowerCase()}, ${w.lo} to ${w.hi}`);
  s.addEventListener('input', () => setAdjustment(w.joint, w.comp, Number(s.value) / k));
  s.addEventListener('dblclick', () => setAdjustment(w.joint, w.comp, r.neutral));
  tick.style.setProperty('--at', String((r.neutral * k - Number(s.min)) / (Number(s.max) - Number(s.min))));
  tick.title = 'as photographed';
  rng.append(s, tick); track.append(el('span', 'end', w.lo), rng, el('span', 'end', w.hi)); box.append(top, track);
  // a travel photographed right at one end: say so, or "higher" looks broken when the part barely moves
  const span = r.hi - r.lo, room = [r.neutral - r.lo, r.hi - r.neutral], tight = room[0] < span * 0.12 ? 0 : room[1] < span * 0.12 ? 1 : -1;
  if (tight >= 0 && Math.abs(r.lo) > 1e-9) box.append(el('p', 'muted', `Photographed almost at the “${(tight === 1) !== w.flip ? w.hi : w.lo}” end: only ${sayValue(room[tight], unit, false)} further that way.`));
  const refresh = () => {
    const v = adjustmentValue(w.joint, w.comp);
    s.value = String(v * k);
    const off = sayOffset(w, v, r, unit);
    out.textContent = off;
    s.setAttribute('aria-valuetext', out.textContent);
    back.classList.toggle('idle', off === 'as photographed');
  };
  return { node: box, ctl: { words: [w], refresh } };
}
/** One pad for two directions (turn + tilt, left-right + forward-back): the dot is the current position, the small cross the as-photographed one. */
function padControl(wx: AdjWord, wy: AdjWord, owner: string): { node: HTMLElement; ctl: Ctl } {
  const ux = unitOfJoint(wx.joint), uy = unitOfJoint(wy.joint), rx = adjustmentRange(wx.joint, wx.comp), ry = adjustmentRange(wy.joint, wy.comp);
  const box = el('div', 'adj pad-adj'), top = el('div', 'adj-top'), out = el('output');
  const reset = () => { setAdjustment(wx.joint, wx.comp, rx.neutral); setAdjustment(wy.joint, wy.comp, ry.neutral); };
  const back = button('back', '↺', reset); back.title = 'Back to as photographed'; back.setAttribute('aria-label', `${owner}, ${wx.padLabel!.toLowerCase()}: back to as photographed`);
  top.append(el('span', 'lbl', wx.padLabel!)); if (isAssumed(S.joints.get(wx.joint)!.def)) top.append(assumedTag());
  top.append(out, back);
  const wrap = el('div', 'pad-wrap'), pad = el('div', 'pad'), thumb = el('i', 'thumb'), home = el('i', 'home');
  const aspect = Math.min(1, Math.max(0.5, (ry.hi - ry.lo) / (rx.hi - rx.lo)));
  pad.style.setProperty('--aspect', String(aspect));
  pad.tabIndex = 0; pad.setAttribute('role', 'slider'); pad.setAttribute('aria-label', `${owner}: ${wx.padLabel!.toLowerCase()}. Arrow keys move it.`);
  pad.append(el('i', 'h-line'), el('i', 'v-line'), home, thumb);
  // fx, fy: 0..1 across the pad, left to right and bottom to top
  const toF = (w: AdjWord, r: { lo: number; hi: number }, v: number) => { const f = (v - r.lo) / (r.hi - r.lo); return w.flip ? 1 - f : f; };
  const fromF = (w: AdjWord, r: { lo: number; hi: number }, f: number) => r.lo + (w.flip ? 1 - f : f) * (r.hi - r.lo);
  const place = (node: HTMLElement, fx: number, fy: number) => { node.style.left = `${fx * 100}%`; node.style.top = `${(1 - fy) * 100}%`; };
  place(home, toF(wx, rx, rx.neutral), toF(wy, ry, ry.neutral));
  const setFrom = (e: PointerEvent) => {
    const b = pad.getBoundingClientRect(), fx = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), fy = Math.min(1, Math.max(0, 1 - (e.clientY - b.top) / b.height));
    // snap to the as-photographed cross when close, so "straight" is easy to hit
    const hx = toF(wx, rx, rx.neutral), hy = toF(wy, ry, ry.neutral), snap = 6 / b.width;
    setAdjustment(wx.joint, wx.comp, fromF(wx, rx, Math.abs(fx - hx) < snap ? hx : fx));
    setAdjustment(wy.joint, wy.comp, fromF(wy, ry, Math.abs(fy - hy) < snap * (b.width / b.height) ? hy : fy));
  };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); pad.classList.add('live'); setFrom(e); e.preventDefault(); pad.focus(); });
  pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) setFrom(e); });
  const end = (e: PointerEvent) => { pad.classList.remove('live'); if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  pad.addEventListener('dblclick', reset);
  pad.addEventListener('keydown', (e) => {
    const step = (u: 'm' | 'rad') => (u === 'm' ? 0.005 : DEG) * (e.shiftKey ? 5 : 1);
    const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0, dy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    if (dx) setAdjustment(wx.joint, wx.comp, adjustmentValue(wx.joint, wx.comp) + dx * step(ux) * (wx.flip ? -1 : 1));
    if (dy) setAdjustment(wy.joint, wy.comp, adjustmentValue(wy.joint, wy.comp) + dy * step(uy) * (wy.flip ? -1 : 1));
  });
  wrap.append(el('span', 'end n', wy.hi), el('span', 'end w', wx.lo), pad, el('span', 'end e', wx.hi), el('span', 'end s', wy.lo));
  box.append(top, wrap);
  const refresh = () => {
    const vx = adjustmentValue(wx.joint, wx.comp), vy = adjustmentValue(wy.joint, wy.comp);
    place(thumb, toF(wx, rx, vx), toF(wy, ry, vy));
    const ox = sayOffset(wx, vx, rx, ux), oy = sayOffset(wy, vy, ry, uy), still = 'as photographed';
    out.textContent = ox === still && oy === still ? still : [ox, oy].filter((t) => t !== still).join(' · ');
    pad.setAttribute('aria-valuetext', out.textContent);
    back.classList.toggle('idle', out.textContent === still);
  };
  return { node: box, ctl: { words: [wx, wy], refresh } };
}
/** The adjust block of the card: the selected thing's own adjustments, grouped under plain headings. */
function adjustBlock(sel: string, owner: string): HTMLElement | null {
  cardJoints = jointsFor(sel); cardCtls = [];
  if (!cardJoints.length) return null;
  const words = cardJoints.flatMap((id) => adjWords(S.joints.get(id)!.def)).sort((a, b) => a.order - b.order);
  const byKey = new Map(words.map((w) => [w.key, w]));
  const box = el('section', 'adjust'), head = el('div', 'adj-head');
  const all = button('photo', 'As photographed', () => resetJoints(cardJoints)); all.title = 'Put this back the way it was photographed';
  head.append(el('h3', null, 'Adjust'), all);
  box.append(head, el('p', 'drag-hint', `Use the controls, ${dragHint()}.`));
  const sections = [...new Set(words.map((w) => w.section))], done = new Set<string>();
  for (const sec of sections) {
    const part = el('div', 'sec'), fine = el('details', 'fine'), mine = words.filter((w) => w.section === sec);
    if (sections.length > 1) part.append(el('h4', null, sec));
    for (const w of mine) {
      if (done.has(w.key)) continue;
      const other = w.pad && byKey.get(w.pad[0] === w.key ? w.pad[1] : w.pad[0]);
      let made: { node: HTMLElement; ctl: Ctl };
      if (w.pad && other) { const wx = byKey.get(w.pad[0])!, wy = byKey.get(w.pad[1])!; made = padControl(wx, wy, sections.length > 1 ? sec : owner); done.add(wx.key); done.add(wy.key); }
      else { made = sliderControl(w, sections.length > 1 ? sec : owner); done.add(w.key); }
      cardCtls.push(made.ctl);
      (w.fine ? fine : part).append(made.node);
    }
    if (fine.childElementCount) { fine.prepend(el('summary', null, 'Fine adjustments')); part.append(fine); }
    box.append(part);
  }
  const defs = cardJoints.map((id) => S.joints.get(id)!.def);
  if (defs.some(isAssumed)) {
    const p = el('p', 'assumed-note');
    p.append(el('strong', null, 'Assumed range — not confirmed on the real rig.'), document.createTextNode(' No photo shows this adjustment, so whether and how far it moves is an estimate.' + (kindOf(sel) === 'row' && sel === 'seat' ? ' The armrests move with the seat.' : '')));
    box.append(p);
  } else if (defs.some((d) => d.evidence === 'inferred')) box.append(el('p', 'muted', 'How far this moves is an estimate.'));
  return box;
}
function detailsBlock(sel: string): HTMLElement {
  const d = el('details', 'details'); d.append(el('summary', null, 'Details'));
  const ids = members(sel), comps = ids.filter((x) => S.byId.get(x)!.kind === 'component');
  const tris = ids.reduce((n, x) => n + S.byId.get(x)!.triangles, 0);
  const dl = el('dl');
  const add = (k: string, v: string) => { dl.append(el('dt', null, k), el('dd', null, v)); };
  add(comps.length === 1 ? 'Model id' : 'Model ids', comps.join(', '));
  if (cardJoints.length) add('Adjustment ids', cardJoints.join(', '));
  add('Mesh', `${tris.toLocaleString('en')} triangles`);
  d.append(dl);
  if (kindOf(sel) === 'part') {
    const it = S.byId.get(sel)!, P = S.manifest.parameters, keys = [...it.params].sort((a, b) => CLASS_ORDER.indexOf(P[a].class) - CLASS_ORDER.indexOf(P[b].class) || a.localeCompare(b));
    if (keys.length) {
      const table = el('table');
      for (const k of keys) {
        const r = P[k], tr = el('tr'), name = el('td'), val = el('td'), tag = el('span', 'cls', CLASS_WORDS[r.class]);
        tag.style.setProperty('--c', CLASS_COLORS[r.class]);
        name.append(el('div', null, sayKey(k)), el('div', 'ev', r.evidence));
        val.append(el('div', null, sayParam(r.given, r.given_unit, r.range)), tag);
        tr.append(name, val); table.append(tr);
      }
      d.append(el('h4', null, 'Sizes this part is built from'), table);
    }
  }
  return d;
}
function classCounts(ids: string[]): Record<string, number> {
  const keys = new Set<string>(), P = S.manifest.parameters, out: Record<string, number> = {};
  for (const id of ids) for (const k of S.byId.get(id)?.params ?? []) keys.add(k);
  for (const k of keys) if (P[k]) out[P[k].class] = (out[P[k].class] ?? 0) + 1;
  return out;
}
let hideBtn: HTMLButtonElement | null = null;
function renderCard() {
  const card = $('card'), sel = S.selected;
  card.hidden = !sel; card.textContent = ''; cardCtls = []; cardJoints = []; hideBtn = null;
  document.body.classList.toggle('has-card', !!sel);
  if (!sel) return;
  const kind = kindOf(sel), name = nameOf(sel), ids = members(sel), comps = ids.filter((x) => S.byId.get(x)!.kind === 'component');
  const head = el('header'), h = el('h2', null, name), x = button('x', '×', () => select(null));
  x.setAttribute('aria-label', 'Close'); x.title = 'Close (Esc)';
  if (kind === 'part') h.title = sel;
  head.append(h, x); card.append(head);
  // what it belongs to
  const where = el('p', 'where'), owner = ownerOf(sel);
  if (owner) { where.append(document.createTextNode('Part of ')); where.append(button('link', nameOf(owner), () => select(owner))); }
  else where.textContent = `${comps.length} parts`;
  if (kind !== 'part' && owner) where.append(document.createTextNode(` · ${comps.length} parts`));
  card.append(where);
  // how its size is known
  const known = knownAs(classCounts(ids));
  if (known) { const p = el('p', 'known'); p.append(el('span', 'k', 'How its size is known: '), document.createTextNode(known + '.')); card.append(p); }
  // actions
  const acts = el('div', 'acts');
  hideBtn = button(null, 'Hide', () => toggleVisible(sel)); hideBtn.title = 'H';
  const only = button(null, 'Show only this', () => showOnly([sel])); only.title = 'I';
  const zoom = button(null, 'Zoom to', () => zoomTo([sel], freeWidth())); zoom.title = 'F, or double-click the part';
  acts.append(hideBtn, only, zoom); card.append(acts);
  if (kind !== 'part') card.append(el('p', 'tipline', 'Click a part of it again to pick just that part.'));
  // adjustments
  const adj = adjustBlock(sel, name);
  if (adj) card.append(adj);
  else {
    const p = el('p', 'muted', 'This does not move by itself.');
    const up = owner && jointsFor(owner).length ? owner : null;
    // a fixed part whose neighbour carries it (monitor arm -> monitor) points there
    const near = !up && kind === 'part' ? (S.children.get(sel) ?? []).map((c) => firstPick(c)).find((c) => S.byId.has(c) && jointsFor(c).length) : null;
    const target = up ?? near;
    if (target) { p.append(document.createTextNode(' Adjust: ')); p.append(button('link', nameOf(target), () => select(target))); }
    card.append(p);
  }
  card.append(detailsBlock(sel));
  refreshCard();
}
/** After the card appeared or went: on a narrow window the 3D view ends where the sheet begins; on a wide one the selected
 *  thing is slid out from under the card if it happens to sit there. */
let lastSheet = -1;
function fitAroundCard(reveal: boolean) {
  const card = $('card'), open = !card.hidden && !document.body.classList.contains('no-ui');
  const sheet = open && narrow() ? card.offsetHeight : 0;
  if (sheet !== lastSheet) { const h0 = frameSize().h; lastSheet = sheet; stageEl.style.setProperty('--sheet', `${sheet}px`); layout(); if (!S.applying) rescaleView(frameSize().h / h0); }
  if (reveal && open && !narrow() && S.selected) clearOfPanel([S.selected], card.offsetWidth + 24);
}
function refreshCard() {
  if (!S.selected) return;
  for (const c of cardCtls) c.refresh();
  if (hideBtn) hideBtn.textContent = visibilityOf(S.selected) === 'hidden' ? 'Show' : 'Hide';
}
/** Share of the view's width a zoom should aim at, so the thing zoomed to is not under the card. */
function freeWidth(): number {
  const card = $('card'), w = stageEl.clientWidth;
  if (card.hidden || narrow() || document.body.classList.contains('no-ui')) return 1;
  return Math.max(0.45, (w - 2 * (card.offsetWidth + 12)) / w);
}

// --------------------------------------------------------------------------------------------- notices on the picture
/** The thing a joint belongs to, in the words of the parts list ("Seat", "Monitor", "Left joystick"). */
function thingOfJoint(id: string): string {
  const child = S.joints.get(id)!.def.child, first = S.byId.get(child)?.triangles ? child : members(child)[0] ?? child;
  return nameOf(firstPick(partOf(first)));
}
let notes: Record<'assumed' | 'moved' | 'hidden' | 'stale', { box: HTMLElement; text: HTMLElement }>;
function buildNotices() {
  const host = $('notices');
  const make = (cls: string, action: string, fn: () => void) => { const box = el('div', `note ${cls}`), text = el('span'); box.append(text, button(null, action, fn)); box.hidden = true; host.append(box); return { box, text }; };
  notes = {
    assumed: make('amber', 'Back to as photographed', () => resetJoints(assumedInUse())),
    moved: make('', 'Back to as photographed', () => resetJoints()),
    hidden: make('', 'Show all', showAll),
    stale: make('', 'Reload', () => location.reload()),
  };
  notes.stale.text.textContent = 'The model has been rebuilt.';
}
/** The sentence that travels with any picture of an assumed pose. */
function assumedSentence(): string {
  const things = [...new Set(assumedInUse().map(thingOfJoint))];
  return things.length ? `${list(things)} moved within ${assumedInUse().length > 1 ? 'assumed ranges' : 'an assumed range'} — not confirmed on the real rig.` : '';
}
function refreshNotices() {
  const assumed = assumedInUse(), moved = movedJoints().filter((id) => !assumed.includes(id));
  notes.assumed.box.hidden = !assumed.length; notes.assumed.text.textContent = assumedSentence();
  notes.moved.box.hidden = !moved.length || assumed.length > 0;
  if (moved.length) notes.moved.text.textContent = `${list([...new Set(moved.map(thingOfJoint))])} moved.`;
  const parts = S.items.filter((i) => i.kind === 'component' && i.triangles > 0), off = parts.filter((i) => S.hidden.has(i.id)).length;
  notes.hidden.box.hidden = off === 0; notes.hidden.text.textContent = `${off} ${off === 1 ? 'part' : 'parts'} hidden`;
  $('empty').hidden = off < parts.length || parts.length === 0;
  notes.stale.box.hidden = !S.stale;
}

// --------------------------------------------------------------------------------------------- More: views, colours, help
const MODES: [string, string][] = [['normal', 'Real materials'], ['ids', 'One colour per part'], ['class', 'How sure are we?']];
function buildMore() {
  const more = $('more');
  const views = el('div', 'views'); views.id = 'views';
  for (const [k, v] of Object.entries(VIEWS)) { if (!v.listed) continue; const b = button(null, v.label, () => setView(k, { ortho: false })); b.dataset.view = k; b.title = v.hint; views.append(b); }
  more.append(el('h3', null, 'Look from'), views);
  const modes = el('div', 'modes');
  for (const [value, label] of MODES) { const l = el('label', 'check'), r = el('input') as HTMLInputElement; r.type = 'radio'; r.name = 'mode'; r.value = value; r.addEventListener('change', () => setMode(value)); l.append(r, document.createTextNode(label)); modes.append(l); }
  more.append(el('h3', null, 'Colours'), modes);
  if (S.cameras && Object.keys(S.cameras).length) { // local dev server only
    const row = el('div', 'photo-row'), cam = el('select') as HTMLSelectElement, mode = el('select') as HTMLSelectElement;
    cam.id = 'photo-cam'; mode.id = 'photo-mode'; cam.title = 'Camera matched to a photo'; mode.title = 'How the photo is shown';
    cam.append(new Option('no photo', '')); for (const k of Object.keys(S.cameras)) cam.append(new Option(k, k));
    for (const [v, t] of [['none', 'model only'], ['photo', 'photo behind'], ['blend', '50 % blend'], ['outline', 'outlines on photo']]) mode.append(new Option(t, v));
    cam.addEventListener('change', () => (cam.value ? setPhotoCamera(cam.value, S.overlay === 'none' ? 'blend' : S.overlay) : setView('three_quarter', { ortho: false })));
    mode.addEventListener('change', () => setOverlay(mode.value));
    row.append(cam, mode); more.append(el('h3', null, 'Compare with a photo (this computer only)'), row);
  }
  const help = el('div', 'help');
  for (const [k, v] of [['Drag', 'rotate'], ['Scroll', 'zoom toward the pointer'], ['Right-drag', 'move the view'], ['Click', 'pick a part; click it again for a single piece'], ['Double-click', 'zoom to a part'], ['H · I · A', 'hide · show only this · show all'], ['F · Esc', 'zoom to · clear the selection']]) { help.append(el('b', null, k), el('span', null, v)); }
  more.append(el('h3', null, 'Mouse and keys'), help);
  // the documentation, and which build this is (version.json is written by `bun run dist`; the dev server answers for the working copy)
  const about = el('p', 'about'), doc = el('a', null, 'Documentation') as HTMLAnchorElement, version = el('span', 'version');
  doc.href = './wiki/'; about.append(doc, version); more.append(about);
  fetch('version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((v) => { if (v?.short) version.textContent = `Version ${v.short}`; }).catch(() => { /* the version line is optional */ });
}
function setMore(open: boolean) { $('more').hidden = !open; $('more-btn').setAttribute('aria-expanded', String(open)); $('more-btn').classList.toggle('on', open); }
function refreshViews() {
  for (const b of $('views').children) b.classList.toggle('on', (b as HTMLElement).dataset.view === S.view && !S.userMoved && !S.photo);
  const cam = document.getElementById('photo-cam') as HTMLSelectElement | null;
  if (cam) { cam.value = S.photo?.name ?? ''; (document.getElementById('photo-mode') as HTMLSelectElement).value = S.overlay; }
}
function refreshMode() {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=mode]')) r.checked = r.value === S.mode;
  const key = $('key'); key.hidden = S.mode !== 'class'; key.textContent = '';
  if (S.mode !== 'class') return;
  const parts = S.items.filter((i) => i.kind === 'component' && i.triangles > 0), n: Record<string, number> = {};
  for (const p of parts) { const c = p.class ?? 'none'; n[c] = (n[c] ?? 0) + 1; }
  key.append(el('h3', null, 'How sure are we?'));
  for (const c of [...CLASS_ORDER, 'none']) { if (!n[c] && c !== 'measured') continue; const s = el('div', 'k'), i = el('i', 'chip'); i.style.background = CLASS_COLORS[c]; s.append(i, el('span', null, CLASS_WORDS[c]), el('b', null, `${n[c] ?? 0} ${n[c] === 1 ? 'part' : 'parts'}`)); key.append(s); }
  key.append(el('p', null, 'Each part takes the colour of its least certain size, so one estimated detail turns a part orange even when its main sizes are measured. Click a part for its full breakdown.'));
}

// --------------------------------------------------------------------------------------------- the link that reproduces this view, and the picture
const MANAGED = ['view', 'camera', 'cam', 'overlay', 'only', 'hide', 'fit', 'pose', 'mode', 'sel'];
const num = (v: number, d: number) => String(+v.toFixed(d));
function compress(ids: Set<string>): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const row of S.rows) { const m = members(row.id); if (m.length && m.every((x) => ids.has(x))) { out.push(row.id); for (const x of m) seen.add(x); } }
  for (const it of S.items) if (ids.has(it.id) && !seen.has(it.id) && !(it.kind === 'surface' && it.parent && ids.has(it.parent))) out.push(it.id);
  return out;
}
function shareUrl(): string {
  const p = new URLSearchParams(location.search);
  for (const k of MANAGED) p.delete(k);
  if (S.photo) { p.set('cam', S.photo.name); if (S.overlay !== 'none') p.set('overlay', S.overlay); }
  else if (S.view && !S.userMoved) {               // still at a named view: say its name (the default view needs no parameter)
    if (S.view !== 'three_quarter' || S.fit || currentCamera() !== persp) p.set('view', S.view);
    if (S.fit) p.set('fit', S.fit.join(','));
  } else {
    const pos = currentCamera().position, d = controls.target.clone().sub(pos), t = S.look ? pos.clone().addScaledVector(d.normalize(), 0.3) : controls.target;
    p.set('camera', [...w2m(pos), ...w2m(t)].map((v) => num(v, 3)).concat(num(persp.fov, 1)).join(','));
  }
  const visible = S.items.filter((i) => i.triangles > 0), hidden = new Set(visible.filter((i) => S.hidden.has(i.id)).map((i) => i.id));
  if (hidden.size && hidden.size * 2 > visible.length) p.set('only', compress(new Set(visible.filter((i) => !hidden.has(i.id)).map((i) => i.id))).join(',') || 'none');
  else if (hidden.size) p.set('hide', compress(hidden).join(','));
  const pose = movedJoints().map((id) => { const j = S.joints.get(id)!, v = j.value; return `${id}:${Array.isArray(v) ? v.map((x) => num(x / DEG, 2)).join('/') : j.def.type === 'prismatic' ? num(v, 4) : num(v / DEG, 2)}`; });
  if (pose.length) p.set('pose', pose.join(','));
  if (S.mode !== 'normal') p.set('mode', S.mode);
  if (S.selected) p.set('sel', S.selected);
  const q = [...p].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%2F/g, '/')}`).join('&');
  return location.origin + location.pathname + (q ? '?' + q : '');
}
let urlTimer = 0;
/** Keep the address bar in step with what is on screen (after a short pause, so dragging does not flood the history API). */
function syncUrl() {
  if (document.body.classList.contains('no-ui')) return;
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => { try { history.replaceState(null, '', shareUrl()); } catch { /* file: pages cannot rewrite the address */ } }, 250);
}
let toastTimer = 0;
function toast(msg: string) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { t.hidden = true; }, 2200); }
async function copyLink() {
  const url = shareUrl();
  try { history.replaceState(null, '', url); } catch { /* see syncUrl */ }
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch {
    const ta = el('textarea') as HTMLTextAreaElement; ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? 'Link copied. It opens exactly this view.' : 'Could not copy. The address bar holds the link.');
}
/** The 3D view as a PNG (backdrop included, no panels). An assumed pose carries its sentence in a band at the bottom. */
function picture(): string {
  const w = canvas.width, h = canvas.height, note = assumedSentence(), band = note ? Math.round(34 * (w / canvas.clientWidth)) : 0;
  const c = document.createElement('canvas'); c.width = w; c.height = h + band;
  const g = c.getContext('2d')!;
  g.save(); g.translate(w * 0.5, h * 0.38); g.scale(w * 0.9, h * 0.8);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1); grad.addColorStop(0, '#d3d7dd'); grad.addColorStop(0.48, '#b4b9c1'); grad.addColorStop(1, '#8e949d');
  g.fillStyle = grad; g.fillRect(-2, -2, 4, 4); g.restore();
  g.drawImage(canvas, 0, 0);
  if (band) {
    g.fillStyle = '#fff3d6'; g.fillRect(0, h, w, band);
    g.fillStyle = '#6b4a00'; g.font = `600 ${Math.round(band * 0.42)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; g.textBaseline = 'middle';
    g.fillText(note, Math.round(band * 0.4), h + band / 2, w - band);
  }
  return c.toDataURL('image/png');
}
function savePicture() {
  const a = el('a') as HTMLAnchorElement; a.href = picture(); a.download = `${S.manifest.asset ?? 'rig'}-view.png`; document.body.append(a); a.click(); a.remove();
  toast('Picture saved to your downloads.');
}
function resetAll() { showAll(); resetJoints(); setMode('normal'); select(null); setMore(false); goHome(); }

// --------------------------------------------------------------------------------------------- start
export function initUi() {
  $('title').textContent = S.manifest.title;
  buildTree(); buildNotices(); buildMore();
  const hint = $('hint');
  hint.textContent = window.matchMedia('(pointer: coarse)').matches ? 'Drag to rotate · pinch to zoom · two fingers to move · tap a part' : 'Drag to rotate · scroll to zoom · right-drag to move · click a part';
  const firstUse = () => { if (!hint.classList.contains('gone')) { hint.classList.add('gone'); window.setTimeout(() => { hint.hidden = true; }, 700); } };
  initPointer({ onFirstUse: firstUse, freeWidth });

  $('reset').addEventListener('click', resetAll);
  $('copy-link').addEventListener('click', copyLink);
  $('save-picture').addEventListener('click', savePicture);
  $('empty-show').addEventListener('click', showAll);
  $('more-btn').addEventListener('click', (e) => { e.stopPropagation(); setMore($('more').hidden); });
  $('open-parts').addEventListener('click', () => setDrawer(!document.body.classList.contains('parts-open')));
  $('scrim').addEventListener('click', () => setDrawer(false));
  document.addEventListener('pointerdown', (e) => { const t = e.target as Node; if (!$('more').hidden && !$('more').contains(t) && !$('more-btn').contains(t)) setMore(false); });

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null, typing = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (t.tagName === 'INPUT' && !['range', 'radio', 'checkbox', 'button'].includes((t as HTMLInputElement).type)));
    if (typing || e.altKey || e.ctrlKey || e.metaKey || document.body.classList.contains('no-ui')) return;
    const k = e.key.toLowerCase(), sel = S.selected;
    if (k === 'escape') { if (!$('more').hidden) setMore(false); else if (document.body.classList.contains('parts-open')) setDrawer(false); else select(null); }
    else if (k === 'a') showAll();
    else if (k === 'f') zoomTo(sel ? [sel] : [], freeWidth());
    else if (k === 'h' && sel) setVisible([sel], false);
    else if (k === 'i' && sel) showOnly([sel]);
    else return;
    e.preventDefault();
  });

  on((c: Change) => {
    if (c === 'selection') { renderCard(); revealSelection(); refreshMarks(); fitAroundCard(!S.applying); }
    else if (c === 'hover') refreshMarks();
    else if (c === 'visibility') { refreshEyes(); refreshNotices(); refreshCard(); }
    else if (c === 'joints') { refreshCard(); refreshNotices(); }
    else if (c === 'mode') { refreshMode(); refreshEyes(); }
    else if (c === 'view') refreshViews();
    else if (c === 'stale') refreshNotices();
    if (c !== 'hover' && c !== 'stale') syncUrl();
  });
  viewerApi.shareUrl = shareUrl; viewerApi.picture = picture;
  window.addEventListener('resize', () => fitAroundCard(false));
  renderCard(); revealSelection(); refreshEyes(); refreshMarks(); refreshNotices(); refreshMode(); refreshViews();
}
