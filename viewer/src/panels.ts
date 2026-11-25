// One card can dock in the workspace panel. Additional cards float independently over the view.
import { S, $, canvas, stageEl, layout } from './engine.ts';
import { icons } from './icons.ts';

const narrow = matchMedia('(max-width: 899px)');
const rail = $('parts'), split = $<HTMLButtonElement>('rail-resize'), reopen = $<HTMLButtonElement>('open-parts');
const browser = $<HTMLDetailsElement>('components'), summary = $('components-toggle');
const dock = $('inspection'), floatingLayer = $('floating-panels'), notices = $('notices');
const body = document.body;
const RAIL_MIN = 200, RAIL_MAX = 344, RAIL_SNAP = 105, RAIL_STEP = 16;
let collapsed = false, drawer = false, expandedWidth = 244;
let active: HTMLElement | null = null;
const floating = new Set<HTMLElement>();
const wired = new WeakSet<HTMLElement>();
const fitCards = new ResizeObserver(() => {
  if (body.classList.contains('no-ui')) return;
  floatingLayer.style.setProperty('--notices-height', `${notices.offsetHeight}px`);
  for (const panel of floating) if (!panel.hidden && panel.style.left) place(panel, panel.offsetLeft, panel.offsetTop);
});
let resize: { id: number; start: number; width: number; value: number } | null = null;

function setWidth(width: number) {
  const clamped = Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width)));
  body.style.setProperty('--panel-w', `${clamped}px`);
  split.setAttribute('aria-valuenow', String(clamped));
  split.setAttribute('aria-valuetext', `${clamped} pixels`);
  return clamped;
}
function refreshRail() {
  const open = narrow.matches ? drawer : !collapsed;
  body.classList.toggle('rail-collapsed', collapsed);
  body.classList.toggle('parts-open', narrow.matches && drawer);
  rail.inert = !open;
  $('scrim').hidden = !narrow.matches || !drawer;
  reopen.innerHTML = open ? icons.collapse : icons.reopen;
  const label = `${open ? 'Close' : 'Open'} workspace panel`;
  reopen.setAttribute('aria-label', label);
  reopen.title = label;
  reopen.setAttribute('aria-expanded', String(open));
}
function setRail(open: boolean, moveFocus = false) {
  const previousWidth = stageEl.clientWidth;
  if (narrow.matches) drawer = open;
  else collapsed = !open;
  if (!open) {
    const settings = $('more');
    if (!settings.hidden) $('more-btn').click();
  }
  refreshRail();
  if (stageEl.clientWidth !== previousWidth) layout();
  if (moveFocus) {
    if (!open) reopen.focus();
    else if (narrow.matches) (rail.querySelector<HTMLElement>('.ws-name') ?? $('copy-link')).focus();
    else split.focus();
  }
}

function syncInspector() {
  dock.hidden = !active || floating.has(active) || browser.open;
}

export function revealInspector() {
  if (!active) return;
  if (!floating.has(active)) {
    closeComponentBrowser();
    if (rail.inert && !S.applying && !body.classList.contains('no-ui')) floatCard(active);
  }
}

function place(panel: HTMLElement, x: number, y: number) {
  panel.style.left = `${Math.round(Math.max(4, Math.min(x, stageEl.clientWidth - panel.offsetWidth - 4)))}px`;
  panel.style.top = `${Math.round(Math.max(4, Math.min(y, stageEl.clientHeight - panel.offsetHeight - 4)))}px`;
}

function bringForward(panel: HTMLElement) {
  if (!floating.delete(panel)) return;
  floating.add(panel);
  let order = 0;
  for (const card of floating) card.style.zIndex = String(++order);
}

function wireCard(panel: HTMLElement) {
  if (wired.has(panel)) return;
  wired.add(panel);
  panel.addEventListener('focusin', () => bringForward(panel));
  panel.addEventListener('pointerdown', (event) => {
    if (!floating.has(panel) || !event.isPrimary || event.button !== 0) return;
    bringForward(panel);
    const target = event.target as Element;
    if (!target.closest('header') || target.closest('button')) return;
    const { clientX: x, clientY: y, pointerId } = event;
    const left = panel.offsetLeft, top = panel.offsetTop;
    panel.setPointerCapture(pointerId);
    panel.addEventListener('pointermove', move);
    panel.addEventListener('lostpointercapture', end, { once: true });
    event.preventDefault();

    function move(next: PointerEvent) {
      if (next.pointerId === pointerId) place(panel, left + next.clientX - x, top + next.clientY - y);
    }
    function end() {
      panel.removeEventListener('pointermove', move);
    }
  });
  panel.addEventListener('keydown', (event) => {
    if (!floating.has(panel) || !event.altKey || !(event.target as Element).closest('header')) return;
    const dx = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
    const dy = event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    place(panel, panel.offsetLeft + dx, panel.offsetTop + dy);
  });
}

function labelDock(panel: HTMLElement) {
  const button = panel.querySelector<HTMLButtonElement>('.dock-toggle');
  if (!button) return;
  const out = floating.has(panel), label = out ? 'Dock controls' : 'Pop out controls';
  button.innerHTML = out ? icons.dock : icons.popOut;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.hidden = panel !== active;
}

function floatCard(panel: HTMLElement) {
  if (!floating.has(panel)) {
    panel.classList.add('floating-controls');
    floatingLayer.append(panel);
    wireCard(panel);
    const others = [...floating].filter((item) => !item.hidden);
    const left = panel.offsetLeft, top = panel.offsetTop, width = panel.offsetWidth;
    if (others.length && width) {
      const max = stageEl.clientWidth - width - 8;
      let x = left;
      while (x <= max && others.some((other) => Math.abs(other.offsetLeft - x) < width)) x += width + 12;
      const step = Math.min(others.length * 38, 152);
      place(panel, x <= max ? x : left + step, x <= max ? top : top + step);
    }
    floating.add(panel);
    fitCards.observe(panel);
  }
  panel.querySelector('header')?.setAttribute('title', 'Drag to move');
  bringForward(panel);
  labelDock(panel);
  syncInspector();
}

function unfloat(panel: HTMLElement) {
  if (!floating.delete(panel)) return;
  fitCards.unobserve(panel);
  panel.classList.remove('floating-controls');
  panel.querySelector('header')?.removeAttribute('title');
  panel.style.removeProperty('left');
  panel.style.removeProperty('top');
  panel.style.removeProperty('z-index');
}

function dockCard(panel: HTMLElement) {
  unfloat(panel);
  if (panel.parentElement !== dock) dock.append(panel);
  labelDock(panel);
  syncInspector();
}

export function dockButton(panel: HTMLElement) {
  const button = document.createElement('button');
  button.className = 'icon-button dock-toggle'; button.type = 'button';
  button.addEventListener('click', () => {
    if (active !== panel) return;
    if (floating.has(panel)) {
      closeComponentBrowser();
      dockCard(panel);
      if (rail.inert) setRail(true);
    } else {
      floatCard(panel);
      if (narrow.matches) closeWorkspaceDrawer();
    }
    button.focus();
  });
  return button;
}

export function showInspector(panel: HTMLElement, open: boolean, fromList = false) {
  if (open) {
    active = panel;
    closeComponentBrowser();
    if (fromList || (!rail.inert && !floating.has(panel))) dockCard(panel);
    else if (!S.applying && !body.classList.contains('no-ui')) floatCard(panel);
    labelDock(panel);
  } else {
    if (active === panel) active = null;
    dockCard(panel);
  }
  syncInspector();
}

export function openExtraInspector(panel: HTMLElement) {
  if (active === panel) active = null;
  floatCard(panel);
  panel.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}
export function closeExtraInspector(panel: HTMLElement) {
  unfloat(panel);
  panel.remove();
}
export function inspectorCoverage() {
  if (body.classList.contains('no-ui')) return 0;
  const first = [...floating].filter((panel) => !panel.hidden && panel.offsetLeft < 48);
  return Math.max(0, ...first.map((panel) => panel.offsetLeft + panel.offsetWidth));
}
export function closeWorkspaceDrawer() {
  if (narrow.matches && drawer) { setRail(false, true); return true; }
  return false;
}
export function closeComponentBrowser() {
  if (!browser.open) return false;
  browser.open = false;
  syncInspector();
  return true;
}
export function dismissInspector() {
  if (closeComponentBrowser()) { returnToViewer(true); return true; }
  const panel = active?.contains(document.activeElement) ? active : [...floating].at(-1) ?? active;
  const close = panel?.querySelector<HTMLButtonElement>('.x');
  if (!close) return false;
  close.click();
  return true;
}

export function initPanels() {
  split.innerHTML = icons.grip;
  split.setAttribute('aria-valuemin', String(RAIL_MIN)); split.setAttribute('aria-valuemax', String(RAIL_MAX));
  setWidth(expandedWidth); refreshRail();
  fitCards.observe(stageEl);
  fitCards.observe(notices);
  reopen.addEventListener('click', () => setRail(narrow.matches ? !drawer : true, true));
  $('scrim').addEventListener('click', () => setRail(false, true));
  split.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    resize = { id: event.pointerId, start: event.clientX, width: expandedWidth, value: expandedWidth };
    split.setPointerCapture(event.pointerId);
    body.classList.add('rail-resizing');
  });
  split.addEventListener('pointermove', (event) => {
    if (resize?.id !== event.pointerId) return;
    resize.value = resize.width + event.clientX - resize.start;
    body.classList.toggle('rail-snap', resize.value <= RAIL_SNAP);
    setWidth(resize.value);
  });
  function finishResize(event: PointerEvent) {
    if (resize?.id !== event.pointerId) return;
    const { value, width } = resize;
    resize = null;
    body.classList.remove('rail-resizing', 'rail-snap');
    if (event.type === 'pointercancel') { setWidth(width); return; }
    if (value <= RAIL_SNAP || Math.abs(value - width) < 3) { setWidth(width); setRail(false, true); }
    else expandedWidth = setWidth(value);
  }
  split.addEventListener('pointerup', finishResize);
  split.addEventListener('pointercancel', finishResize);
  split.addEventListener('keydown', (event) => {
    const delta = event.key === 'ArrowLeft' ? -RAIL_STEP : event.key === 'ArrowRight' ? RAIL_STEP : 0;
    if (delta) {
      if (expandedWidth === RAIL_MIN && delta < 0) setRail(false, true);
      else expandedWidth = setWidth(expandedWidth + delta);
    } else if (event.key === 'Enter' || event.key === ' ') setRail(false, true);
    else return;
    event.preventDefault();
  });

  summary.insertAdjacentHTML('afterbegin', icons.components);
  browser.addEventListener('toggle', () => {
    syncInspector();
  });
  narrow.addEventListener('change', () => {
    drawer = false;
    refreshRail();
    syncInspector();
  });
}

export function returnToViewer(fromComponents = false) {
  if (!rail.inert && (fromComponents || narrow.matches)) summary.focus();
  else canvas.focus();
}
