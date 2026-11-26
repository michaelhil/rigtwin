// The controls around the 3D view: component browsing and adjustments, workspace tools,
// camera presets, Settings and links that reproduce the current view.
import {
  S, $, el, on, DEG, VIEWS, CLASS_COLORS, idColor, canvas, stageEl, persp, controls, currentCamera, w2m,
  members, kindOf, nameOf, ownerOf, partOf, firstPick, visibilityOf, setVisible, showOnly, showAll, select, setHover,
  setView, setMode, setPhotoCamera, setOverlay, zoomTo, goHome, resetJoints, movedJoints, assumedInUse,
  jointsFor, setAdjustment, adjustmentValue, adjustmentRange, viewerApi, type Change,
} from './engine.ts';
import { initPointer } from './interact.ts';
import { adjWords, partName, sayOffset, CLASS_ORDER, CLASS_WORDS, type AdjWord } from '../../shared/words.ts';
import { icons } from './icons.ts';
import { closeTrace } from './trace.ts';
import { initPanels, showInspector, dockButton, dismissInspector, closeComponentBrowser, closeWorkspaceDrawer, inspectorCoverage, returnToViewer, revealInspector, openExtraInspector, closeExtraInspector } from './panels.ts';

const svg = (d: string) => `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
const EYE = svg('<path d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z"/><circle cx="10" cy="10" r="2.5"/>');
const EYE_OFF = svg('<path d="M3.6 6.9C2.4 8.2 1.8 10 1.8 10s3 5.4 8.2 5.4c1 0 2-.2 2.8-.5M7.7 4.9c.7-.2 1.5-.3 2.3-.3 5.2 0 8.2 5.4 8.2 5.4s-.7 1.3-2 2.7"/><path d="M3 3l14 14"/>');
const EYE_HALF = svg('<path d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z" stroke-dasharray="2.4 2.4"/><circle cx="10" cy="10" r="2.5"/>');
const button = (cls: string | null, text: string, onClick: () => void) => { const b = el('button', cls, text) as HTMLButtonElement; b.type = 'button'; b.addEventListener('click', onClick); return b; };
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// --------------------------------------------------------------------------------------------- parts list
interface RowUi { box: HTMLElement; eye: HTMLButtonElement; name: HTMLButtonElement; expand?: HTMLButtonElement; chip?: HTMLElement; kids?: HTMLElement; top: boolean }
const rowUi = new Map<string, RowUi>();
const openRows = new Set<string>();
function toggleVisible(id: string) { setVisible([id], visibilityOf(id) !== 'shown'); }
let fromComponents = false;
function inspectFromList(id: string) {
  fromComponents = true;
  select(id);
  showInspector($('card'), true, true);
  $('card').querySelector<HTMLElement>('h2')?.focus();
}
function buildTree() {
  const tree = $('tree'); tree.textContent = '';
  const eyeButton = (id: string, name: string) => { const b = button('eye', '', () => toggleVisible(id)); b.dataset.name = name; return b; };
  for (const row of S.rows) {
    const group = el('div', 'group'), head = el('div', 'row top'), kids = el('div', 'kids');
    const eye = eyeButton(row.id, row.name), name = button('name', '', () => inspectFromList(row.id));
    name.append(el('span', 'label', row.name));
    const expand = button('expand', '', () => setOpen(row.id, !openRows.has(row.id)));
    expand.append(el('span', 'chev')); kids.id = `tree-${row.id}`;
    expand.setAttribute('aria-controls', kids.id); expand.dataset.name = row.name;
    expand.setAttribute('aria-label', `Expand ${row.name} components`);
    expand.setAttribute('aria-expanded', 'false');
    head.append(eye, name, expand); kids.hidden = true;
    head.addEventListener('mouseenter', () => setHover(row.id)); head.addEventListener('mouseleave', () => setHover(null));
    rowUi.set(row.id, { box: head, eye, name, expand, kids, top: true });
    for (const id of row.parts) {
      const it = S.byId.get(id)!, words = partName(it), r = el('div', 'row kid');
      const e = eyeButton(id, words.full), chip = el('i', 'chip'), n = button('name', '', () => inspectFromList(id));
      n.append(chip, el('span', 'label', words.short));
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
  const r = rowUi.get(rowId); if (!r?.kids || !r.expand) return;
  open ? openRows.add(rowId) : openRows.delete(rowId);
  r.kids.hidden = !open;
  r.expand.setAttribute('aria-expanded', String(open));
  r.expand.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${r.expand.dataset.name} components`);
  r.box.classList.toggle('open', open);
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
// --------------------------------------------------------------------------------------------- the card for the selected part
type Control = { node: HTMLElement; refresh: () => void };
const extraCards = new Map<string, HTMLElement>();
const cardUpdates = new Map<HTMLElement, () => void>();
const unitOfJoint = (id: string) => S.joints.get(id)!.def.unit;
const SLIDER_K = (unit: 'm' | 'rad') => (unit === 'm' ? 1000 : 1 / DEG);       // slider steps: millimetres, or degrees
function sliderControl(w: AdjWord, owner: string, cardId: string): Control {
  const def = S.joints.get(w.joint)!.def, unit = def.unit, k = SLIDER_K(unit) * (w.flip ? -1 : 1), r = adjustmentRange(w.joint, w.comp);
  const box = el('div', 'adj'), top = el('div', 'adj-top'), id = `${cardId}-adj-${w.key.replace(/\W/g, '-')}`;
  const label = el('label', null, w.label) as HTMLLabelElement; label.htmlFor = id;
  const out = el('output'); top.append(label, out);
  const track = el('div', 'track'), rng = el('div', 'rng'), s = el('input') as HTMLInputElement, tick = el('i', 'tick');
  const a = r.lo * k, b = r.hi * k;
  const step = unit === 'm' ? 1 : 0.5, snap = (v: number) => Math.round(v / step) * step;
  s.type = 'range'; s.id = id; s.min = String(snap(Math.min(a, b))); s.max = String(snap(Math.max(a, b))); s.step = String(step);
  s.setAttribute('aria-label', `${owner}: ${w.label.toLowerCase()}, ${w.lo} to ${w.hi}`);
  s.addEventListener('input', () => setAdjustment(w.joint, w.comp, Number(s.value) / k));
  tick.style.setProperty('--at', String((r.neutral * k - Number(s.min)) / (Number(s.max) - Number(s.min))));
  tick.title = 'As photographed';
  rng.append(s, tick); track.append(el('span', 'end', w.lo), rng, el('span', 'end', w.hi)); box.append(top, track);
  const refresh = () => {
    const v = adjustmentValue(w.joint, w.comp), off = sayOffset(w, v, r, unit);
    s.value = String(v * k);
    out.textContent = off === 'as photographed' ? '' : off;
    s.setAttribute('aria-valuetext', off);
  };
  return { node: box, refresh };
}
/** The two-axis joystick pad. The cross marks its photographed position. */
function padControl(wx: AdjWord, wy: AdjWord, owner: string): Control {
  const ux = unitOfJoint(wx.joint), uy = unitOfJoint(wy.joint), rx = adjustmentRange(wx.joint, wx.comp), ry = adjustmentRange(wy.joint, wy.comp);
  const box = el('div', 'adj pad-adj'), top = el('div', 'adj-top'), out = el('output');
  top.append(el('span', 'lbl', wx.padLabel!), out);
  const wrap = el('div', 'pad-wrap'), pad = el('div', 'pad'), thumb = el('i', 'thumb'), home = el('i', 'home');
  const aspect = Math.min(1, Math.max(0.5, (ry.hi - ry.lo) / (rx.hi - rx.lo)));
  pad.style.setProperty('--aspect', String(aspect));
  pad.tabIndex = 0; pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', `${owner}: ${wx.padLabel!.toLowerCase()}`); pad.setAttribute('aria-description', 'Use arrow keys to move along both axes.');
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
  pad.addEventListener('pointerdown', (e) => { if (e.button !== 0 || !e.isPrimary) return; pad.setPointerCapture(e.pointerId); pad.classList.add('live'); setFrom(e); e.preventDefault(); pad.focus(); });
  pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) setFrom(e); });
  const end = (e: PointerEvent) => { pad.classList.remove('live'); if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
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
    out.textContent = [ox, oy].filter((t) => t !== still).join(' · ');
    pad.setAttribute('aria-description', `Use arrow keys to move along both axes. ${out.textContent || still}.`);
  };
  return { node: box, refresh };
}
/** Label the controls directly. Group an arm and display only when both sets of controls are present. */
function adjustBlock(sel: string, owner: string, cardId: string): Control | null {
  const cardJoints = jointsFor(sel);
  const controls: Control[] = [];
  if (!cardJoints.length) return null;
  const words = cardJoints.flatMap((id) => adjWords(S.joints.get(id)!.def)).sort((a, b) => a.order - b.order);
  const byKey = new Map(words.map((w) => [w.key, w]));
  const box = el('section', 'adjust'), fine = el('details', 'fine');
  const held = new Set<string>();
  const mixedScreen = words.some((w) => w.joint === 'J_ts_arm') && words.some((w) => w.joint === 'J_ts_screen');
  let prior = '';
  for (const w of words) {
    if (held.has(w.key)) continue;
    if (mixedScreen && !w.fine && w.section !== prior) { box.append(el('h3', 'motion-group', w.section)); prior = w.section; }
    const pair = w.joint.startsWith('J_joy_') && w.pad && w.pad.map((key) => byKey.get(key));
    const control = pair && pair[0] && pair[1] ? padControl(pair[0], pair[1], owner) : sliderControl(w, owner, cardId);
    if (pair && pair[0] && pair[1]) for (const key of w.pad!) held.add(key);
    controls.push(control);
    (w.fine ? fine : box).append(control.node);
  }
  if (fine.childElementCount) { fine.prepend(el('summary', null, 'Fine adjustments')); box.append(fine); }
  const resetPart = button('photo part-reset', 'As photographed', () => resetJoints(cardJoints));
  resetPart.title = 'Reset this component’s adjustments';
  box.append(resetPart);
  return { node: box, refresh: () => {
    for (const control of controls) control.refresh();
    resetPart.hidden = !movedJoints().some((id) => cardJoints.includes(id));
  } };
}

function fillCard(card: HTMLElement, sel: string, closeCard: () => void, extra = false) {
  card.textContent = '';
  const kind = kindOf(sel), name = nameOf(sel), owner = ownerOf(sel);
  const head = el('header'), h = el('h2', null, name), tools = el('div', 'inspector-tools');
  h.tabIndex = -1;
  card.setAttribute('aria-label', `${name} controls`);
  const close = button('icon-button x', '', closeCard);
  close.innerHTML = icons.close;
  close.setAttribute('aria-label', 'Close controls'); close.title = 'Close controls (Esc)';
  if (!extra) tools.append(dockButton(card));
  tools.append(close); head.append(h, tools); card.append(head);
  const adjust = adjustBlock(sel, name, card.id);
  if (adjust) {
    card.append(adjust.node);
    cardUpdates.set(card, adjust.refresh);
    adjust.refresh();
    return;
  }
  const parent = owner && jointsFor(owner).length ? owner : null;
  const child = !parent && kind === 'part' ? (S.children.get(sel) ?? []).map(firstPick).find((id) => S.byId.has(id) && jointsFor(id).length) : null;
  const target = parent ?? child;
  if (target) card.append(button('link related', `Adjust ${nameOf(target)}`, () => {
    if (extra) openExtraCard(target);
    else { select(target); card.querySelector<HTMLElement>('h2')?.focus(); }
  }));
}

function removeExtraCard(id: string, card: HTMLElement) {
  extraCards.delete(id);
  cardUpdates.delete(card);
  closeExtraInspector(card);
}

function openExtraCard(id: string) {
  if (S.selected === id) {
    revealInspector();
    $('card').querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    return;
  }
  let card = extraCards.get(id);
  if (!card) {
    const node = el('aside', 'ui component-card');
    node.id = `controls-${id}`;
    extraCards.set(id, node);
    fillCard(node, id, () => { removeExtraCard(id, node); returnToViewer(); }, true);
    card = node;
  }
  openExtraInspector(card);
}

function renderCard() {
  const card = $('card'), sel = S.selected;
  card.hidden = !sel; cardUpdates.delete(card);
  if (!sel) { card.textContent = ''; showInspector(card, false); fromComponents = false; return; }
  const extra = extraCards.get(sel);
  if (extra) removeExtraCard(sel, extra);
  fillCard(card, sel, () => {
    const origin = fromComponents;
    select(null);
    returnToViewer(origin);
  });
  showInspector(card, true);
}
function refreshCard() {
  for (const refresh of cardUpdates.values()) refresh();
}
function freeWidth() {
  const w = stageEl.clientWidth;
  return Math.max(0.45, (w - 2 * inspectorCoverage()) / w);
}

// --------------------------------------------------------------------------------------------- notices on the picture
/** The thing a joint belongs to, in the words of the parts list ("Seat", "Monitor", "Left joystick"). */
function thingOfJoint(id: string): string {
  const child = S.joints.get(id)!.def.child, first = S.byId.get(child)?.triangles ? child : members(child)[0] ?? child;
  return nameOf(firstPick(partOf(first)));
}
let staleNote: HTMLElement, resetAdjustments: HTMLButtonElement, showComponents: HTMLButtonElement, recoveryNote: HTMLElement;
function buildNotices() {
  staleNote = el('div', 'note', 'The model has been rebuilt.');
  staleNote.append(button(null, 'Reload', () => location.reload()));
  $('notices').append(staleNote);
  const recovery = $('scene-recovery'), actions = el('div', 'recovery-actions');
  recoveryNote = el('p', 'recovery-note');
  resetAdjustments = button(null, 'Reset adjustments', () => resetJoints());
  showComponents = button(null, 'Show all components', showAll);
  actions.append(resetAdjustments, showComponents); recovery.append(recoveryNote, actions);
}
function assumedSentence(): string {
  const things = [...new Set(assumedInUse().map(thingOfJoint))];
  return things.length ? `${list(things)} moved within ${assumedInUse().length > 1 ? 'assumed ranges' : 'an assumed range'} — not confirmed on the real rig.` : '';
}
function refreshNotices() {
  const moved = movedJoints().length > 0, assumed = assumedInUse().length > 0;
  const parts = S.items.filter((i) => i.kind === 'component' && i.triangles > 0), off = parts.filter((i) => S.hidden.has(i.id)).length;
  $('scene-recovery').hidden = !moved && off === 0;
  resetAdjustments.hidden = !moved;
  showComponents.hidden = off === 0;
  recoveryNote.textContent = assumed ? 'Includes estimated adjustments' : '';
  recoveryNote.hidden = !assumed;
  $('empty').hidden = off < parts.length || parts.length === 0;
  staleNote.hidden = !S.stale;
}

// --------------------------------------------------------------------------------------------- Views and Settings
const MODES = [['normal', 'Natural materials'], ['ids', 'Part colours'], ['class', 'Evidence colours']];
let modeSelect: HTMLSelectElement;
function setViewsOpen(open: boolean, focus = false) {
  document.body.classList.toggle('views-open', open);
  $('view-menu').setAttribute('aria-expanded', String(open));
  if (focus) {
    if (open) $('views').querySelector<HTMLButtonElement>('button')?.focus();
    else $('view-menu').focus();
  }
}
function buildViews() {
  const views = $('views');
  for (const [key, view] of Object.entries(VIEWS)) {
    if (!view.listed || view.special) continue;
    const b = button('icon-button', '', () => {
      setView(key, { ortho: false });
      if (document.body.classList.contains('views-open')) setViewsOpen(false, true);
    });
    b.dataset.view = key; b.title = view.label;
    b.setAttribute('aria-label', view.label);
    b.innerHTML = icons[key as keyof typeof icons]; b.append(el('span', 'view-label', view.label));
    views.append(b);
  }
  const operator = $('operator-view');
  operator.innerHTML = icons.operator; operator.dataset.view = 'operator';
  operator.addEventListener('click', () => { setViewsOpen(false); setView('operator', { ortho: false }); });
  $('view-menu').innerHTML = icons.viewMenu;
  $('view-menu').addEventListener('click', () => setViewsOpen(!document.body.classList.contains('views-open'), true));
  $('reset').innerHTML = icons.reset;
}
function settingDisclosure(title: string) {
  const section = el('details', 'settings-section');
  section.append(el('summary', null, title));
  return section;
}
function buildMore() {
  const more = $('more'), head = el('header', 'settings-head');
  const close = button('icon-button x', '', () => setMore(false, true));
  close.innerHTML = icons.close; close.setAttribute('aria-label', 'Close settings');
  head.append(el('h2', null, 'Settings'), close); more.append(head);
  const display = el('section', 'settings-section');
  display.append(el('h3', null, 'Display'));
  const label = el('label', 'setting-row', 'Colours');
  modeSelect = el('select') as HTMLSelectElement; modeSelect.id = 'scene-colours';
  for (const [value, label] of MODES) modeSelect.append(new Option(label, value));
  // an asset with an optional texture layer can be shown without it
  if (Object.values(S.manifest.materials ?? {}).some((m) => (m as { texture?: unknown }).texture)) modeSelect.add(new Option('Plain materials (no photo textures)', 'plain'), 1);
  modeSelect.addEventListener('change', () => setMode(modeSelect.value));
  label.append(modeSelect); display.append(label); more.append(display);
  const agent = settingDisclosure('Agent access'); agent.id = 'settings-agent'; agent.hidden = true; more.append(agent);
  if (S.cameras && Object.keys(S.cameras).length) {
    const section = settingDisclosure('Compare with a photo'), row = el('div', 'photo-row');
    const cam = el('select') as HTMLSelectElement, mode = el('select') as HTMLSelectElement;
    cam.id = 'photo-cam'; mode.id = 'photo-mode';
    cam.setAttribute('aria-label', 'Camera matched to a photo'); mode.setAttribute('aria-label', 'Photo overlay');
    cam.append(new Option('No photo', '')); for (const k of Object.keys(S.cameras)) cam.append(new Option(k, k));
    for (const [v, t] of [['none', 'Model only'], ['photo', 'Photo behind'], ['blend', 'Blend'], ['outline', 'Outlines']]) mode.append(new Option(t, v));
    cam.addEventListener('change', () => (cam.value ? setPhotoCamera(cam.value, S.overlay === 'none' ? 'blend' : S.overlay) : setView('three_quarter', { ortho: false })));
    mode.addEventListener('change', () => setOverlay(mode.value));
    row.append(cam, mode); section.append(row); more.append(section);
  }
  const helpSection = settingDisclosure('Controls and shortcuts'), help = el('dl', 'help');
  for (const [gesture, action] of [['Drag', 'Orbit'], ['Pinch or scroll', 'Zoom'], ['Right-drag', 'Pan'], ['Tap or click', 'Select a component'], ['Shift-click', 'Open another controls card'], ['Double-click', 'Zoom to the component'], ['H · I · A', 'Hide · show only · show all'], ['F · Esc', 'Zoom to · close controls']])
    help.append(el('dt', null, gesture), el('dd', null, action));
  helpSection.append(help); more.append(helpSection);
  const about = el('p', 'about'), doc = el('a', null, 'Documentation') as HTMLAnchorElement, version = el('span', 'version');
  doc.href = '/wiki/'; about.append(doc, version); more.append(about);
  fetch('/version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((v) => {
    if (v?.short) { version.textContent = `Version ${v.short}`; version.title = v.revision; }
  }).catch(() => { /* An older static viewer may have no version file. */ });
}
function setMore(open: boolean, focus = false) {
  $('more').hidden = !open; $('more-btn').setAttribute('aria-expanded', String(open)); $('more-btn').classList.toggle('on', open);
  if (focus) (open ? $('more').querySelector<HTMLElement>('.x') : $('more-btn'))?.focus();
}
function refreshViews() {
  for (const b of document.querySelectorAll<HTMLElement>('#view-controls [data-view]')) {
    const active = b.dataset.view === S.view && (!S.userMoved || S.view === 'operator') && !S.photo;
    b.classList.toggle('on', active); b.setAttribute('aria-pressed', String(active));
  }
  const cam = document.getElementById('photo-cam') as HTMLSelectElement | null;
  if (cam) { cam.value = S.photo?.name ?? ''; (document.getElementById('photo-mode') as HTMLSelectElement).value = S.overlay; }
}
function refreshMode() {
  modeSelect.value = S.mode;
  const key = $('key'); key.hidden = S.mode !== 'class'; key.textContent = '';
  if (S.mode !== 'class') return;
  const parts = S.items.filter((i) => i.kind === 'component' && i.triangles > 0), n: Record<string, number> = {};
  for (const p of parts) { const c = p.class ?? 'none'; n[c] = (n[c] ?? 0) + 1; }
  key.append(el('h3', null, 'Evidence colours'));
  for (const c of [...CLASS_ORDER, 'none']) {
    if (!n[c] && c !== 'measured') continue;
    const row = el('div', 'k'), chip = el('i', 'chip');
    chip.style.background = CLASS_COLORS[c];
    row.append(chip, el('span', null, CLASS_WORDS[c]), el('b', null, `${n[c] ?? 0} ${n[c] === 1 ? 'part' : 'parts'}`));
    key.append(row);
  }
  key.append(el('p', null, 'Each part takes the colour of its least certain size.'));
}

// --------------------------------------------------------------------------------------------- the link that reproduces this view, and the picture
const MANAGED = ['view', 'eye', 'camera', 'cam', 'overlay', 'only', 'hide', 'fit', 'pose', 'mode', 'sel'];
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
    if (S.view === 'operator' && S.eyeHeight !== null) p.set('eye', num(S.eyeHeight, 3));
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
function picture(): string { return pictureCanvas().toDataURL('image/png'); }
/** The same picture as a JPEG of at most `maxBytes` (for an agent's look {picture: true}): smaller and coarser until it fits. */
async function pictureJpeg(maxBytes: number): Promise<Blob | null> {
  const full = pictureCanvas();
  for (const [width, q] of [[1024, 0.72], [800, 0.62], [640, 0.55], [480, 0.5]] as const) {      // 1024 px usually fits in 60 kB
    const k = Math.min(1, width / full.width), c = document.createElement('canvas');
    c.width = Math.round(full.width * k); c.height = Math.round(full.height * k);
    c.getContext('2d')!.drawImage(full, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
    if (b && b.size <= maxBytes) return b;
  }
  return null;
}
/** Lines a picture must carry while what they credit is in it (the dressed person's clothing, person-panel.ts). */
export const pictureCredits: (() => string | null)[] = [];
function pictureCanvas(): HTMLCanvasElement {
  const w = canvas.width, h = canvas.height, note = assumedSentence(), band = note ? Math.round(34 * (w / canvas.clientWidth)) : 0;
  const c = document.createElement('canvas'); c.width = w; c.height = h + band;
  const g = c.getContext('2d')!;
  g.save(); g.translate(w * 0.5, h * 0.38); g.scale(w * 0.9, h * 0.8);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1); grad.addColorStop(0, '#d3d7dd'); grad.addColorStop(0.48, '#b4b9c1'); grad.addColorStop(1, '#8e949d');
  g.fillStyle = grad; g.fillRect(-2, -2, 4, 4); g.restore();
  g.drawImage(canvas, 0, 0);
  const credit = pictureCredits.map((f) => f()).filter(Boolean).join(' '), k = w / canvas.clientWidth;
  if (credit) { g.font = `${Math.round(11 * k)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; g.textBaseline = 'bottom'; g.fillStyle = 'rgba(27,30,35,.72)'; g.fillText(credit, Math.round(8 * k), h - Math.round(6 * k), w - 16 * k); }
  if (band) {
    g.fillStyle = '#fff3d6'; g.fillRect(0, h, w, band);
    g.fillStyle = '#6b4a00'; g.font = `600 ${Math.round(band * 0.42)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; g.textBaseline = 'middle';
    g.fillText(note, Math.round(band * 0.4), h + band / 2, w - band);
  }
  return c;
}
function savePicture() {
  const a = el('a') as HTMLAnchorElement; a.href = picture(); a.download = `${S.manifest.asset ?? 'rig'}-view.png`; document.body.append(a); a.click(); a.remove();
  toast('Picture saved to your downloads.');
}
function resetAll() {
  for (const [id, card] of extraCards) removeExtraCard(id, card);
  closeComponentBrowser();
  dismissInspector();
  select(null); showAll(); resetJoints(); setMode('normal'); setMore(false); setViewsOpen(false); goHome();
}

// --------------------------------------------------------------------------------------------- start
export function initUi() {
  initPanels(); buildTree(); buildNotices(); buildViews(); buildMore();
  initPointer({
    freeWidth, revealSelection: revealInspector, openAdditional: openExtraCard,
    selectComponent: (id) => { fromComponents = false; select(id); },
  });

  $('copy-link').innerHTML = icons.link;
  $('save-picture').innerHTML = icons.picture;
  $('more-btn').innerHTML = icons.settings;
  $('reset').addEventListener('click', resetAll);
  $('copy-link').addEventListener('click', copyLink);
  $('save-picture').addEventListener('click', savePicture);
  $('empty-show').addEventListener('click', showAll);
  $('more-btn').addEventListener('click', () => setMore($('more').hidden, $('more').hidden));
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node;
    if (!$('more').hidden && !$('more').contains(target) && !$('more-btn').contains(target)) setMore(false);
    if (document.body.classList.contains('views-open') && !$('view-controls').contains(target)) setViewsOpen(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || document.body.classList.contains('no-ui') || document.querySelector('dialog[open]') || $('viewer-shell').inert) return;
    const k = e.key.toLowerCase(), sel = S.selected, t = e.target as HTMLElement | null;
    if (k === 'escape') {
      if (!$('more').hidden) setMore(false, true);
      else if (document.body.classList.contains('views-open')) setViewsOpen(false, true);
      else if (!closeWorkspaceDrawer() && !closeTrace() && !dismissInspector()) return;
    } else {
      if (t && (t.matches('textarea,select,input:not([type=range],[type=radio],[type=checkbox])') || t.isContentEditable)) return;
      if (k === 'a') showAll();
      else if (k === 'f') zoomTo(sel ? [sel] : [], freeWidth());
      else if (k === 'h' && sel) setVisible([sel], false);
      else if (k === 'i' && sel) showOnly([sel]);
      else return;
    }
    e.preventDefault();
  });

  on((c: Change) => {
    if (c === 'selection') { renderCard(); refreshMarks(); }
    else if (c === 'hover') refreshMarks();
    else if (c === 'visibility') { refreshEyes(); refreshNotices(); refreshCard(); }
    else if (c === 'joints') { refreshCard(); refreshNotices(); }
    else if (c === 'mode') { refreshMode(); refreshEyes(); }
    else if (c === 'view') refreshViews();
    else if (c === 'stale') refreshNotices();
    if (c !== 'hover' && c !== 'stale') syncUrl();
  });
  viewerApi.shareUrl = shareUrl; viewerApi.picture = picture; viewerApi.pictureJpeg = pictureJpeg;
  renderCard(); refreshEyes(); refreshMarks(); refreshNotices(); refreshMode(); refreshViews();
}
