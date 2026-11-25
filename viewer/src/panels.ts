// The workspace panel holds one set of component controls. Desktop users can move those controls over the view.
import { S, $, canvas, stageEl, layout } from './engine.ts';
import { icons } from './icons.ts';

const narrow = matchMedia('(max-width: 899px)');
const rail = $('parts'), split = $<HTMLButtonElement>('rail-resize'), reopen = $<HTMLButtonElement>('open-parts');
const browser = $<HTMLDetailsElement>('components'), summary = $('components-toggle');
const dock = $('inspection');
const body = document.body;
const RAIL_MIN = 200, RAIL_MAX = 344, RAIL_SNAP = 105, RAIL_STEP = 16;
let collapsed = false, drawer = false, expandedWidth = 244;
let active: HTMLElement | null = null, floating = false;
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
  dock.hidden = !active || floating || browser.open;
}

export function revealInspector() {
  if (!active || floating) return;
  closeComponentBrowser();
  if (!rail.inert || S.applying || body.classList.contains('no-ui')) return;
  setRail(true);
  if (narrow.matches) active.querySelector<HTMLElement>('h2')?.focus();
}

function mount(panel: HTMLElement) {
  const parent = floating && !narrow.matches ? stageEl : dock;
  if (panel.parentElement !== parent) parent.append(panel);
  const button = panel.querySelector<HTMLButtonElement>('.dock-toggle');
  if (button) labelDock(button);
}
function labelDock(button: HTMLButtonElement) {
  const label = floating ? 'Dock controls' : 'Pop out controls';
  button.innerHTML = floating ? icons.dock : icons.popOut;
  button.title = label; button.setAttribute('aria-label', label);
}
export function dockButton() {
  const button = document.createElement('button');
  button.className = 'icon-button dock-toggle'; button.type = 'button';
  labelDock(button);
  button.addEventListener('click', () => {
    if (!active || narrow.matches) return;
    floating = !floating;
    mount(active); syncInspector();
    if (!floating) revealInspector();
    button.focus();
  });
  return button;
}

export function showInspector(panel: HTMLElement, open: boolean) {
  if (!open) {
    if (active !== panel) return;
    floating = false;
    mount(panel);
    active = null;
  } else {
    if (active !== panel) {
      if (active && floating) { floating = false; mount(active); }
      active = panel;
    }
    browser.open = false;
    mount(panel);
  }
  syncInspector();
  if (open) revealInspector();
}
export function inspectorCoverage() {
  return floating && active && !body.classList.contains('no-ui') ? active.offsetWidth + (collapsed ? 34 : 12) : 0;
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
  const close = active?.querySelector<HTMLButtonElement>('.x');
  if (!close) return false;
  close.click();
  return true;
}

export function initPanels() {
  split.innerHTML = icons.grip;
  split.setAttribute('aria-valuemin', String(RAIL_MIN)); split.setAttribute('aria-valuemax', String(RAIL_MAX));
  setWidth(expandedWidth); refreshRail();
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
    if (browser.open && active && floating) { floating = false; mount(active); }
    syncInspector();
  });
  narrow.addEventListener('change', () => {
    drawer = false;
    if (active && floating && narrow.matches) { floating = false; mount(active); }
    refreshRail();
    syncInspector();
  });
}

export function returnToViewer(fromComponents = false) {
  if (!rail.inert && (fromComponents || narrow.matches)) summary.focus();
  else canvas.focus();
}
