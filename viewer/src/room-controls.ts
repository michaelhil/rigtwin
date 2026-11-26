// Small controls shared by the room editor and its workspace directory.
import { h } from './dom.ts';

const paths = {
  logo: 'M3 6.5 12 2l9 4.5-9 4.6z M3 11.3l9 4.6 9-4.6 M3 16.2l9 4.6 9-4.6',
  room: 'M3 3h18v18h-7m-5 0H3V3m6 18v-5a5 5 0 0 1 5 5',
  station: 'M3 4h12v8H3z M9 12v4m-5 0h10m4-7v6h3v4h-7v-4h4m-2 4v2m4-2v2',
  display: 'M2.5 4.5h19v12h-19z M12 16.5v4m-5 0h10',
  layers: 'm3 8 9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5',
  measure: 'm3 15 12-12 6 6L9 21z M12 6l3 3m-6 0 2 2m-5 1 3 3',
  pop: 'M13 3h8v8m0-8L10 14M9 5H4v15h15v-5',
  plus: 'M12 5v14 M5 12h14', chevron: 'm7 10 5 5 5-5', next: 'm9 6 6 6-6 6',
  collapse: 'M3 4h18v16H3z M9 4v16m8-11-3 3 3 3', expand: 'M3 4h18v16H3z M9 4v16m4-11 3 3-3 3',
  undo: 'M9 4 3 10l6 6 M4 10h10a6 6 0 0 1 6 6v3',
  plan: 'M3 3h18v18h-8m-5 0H3V3m8 0v7h10', fit: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
  cube: 'm12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5m-9 5v10',
  remove: 'M4 7h16m-13 0 1 14h8l1-14m-8 0V3h6v4', close: 'm6 6 12 12M18 6 6 18',
  folder: 'M3 6h6l2 2h10v12H3z', axis: 'M6 4v14h14m-17-11 3-3 3 3m8 8 3 3-3 3',
  turn: 'M7 8a6 6 0 1 1-1 7M3 8h5V3', person: 'M12 3a3 3 0 1 0 .1 0M5 20v-3c0-5 14-5 14 0v3',
  cursor: 'm6 3 13 10-7 1-3 6z', check: 'm4 12 5 5L20 6', door: 'M3 21h18m-15 0V3h12v18m-10 0V6l7 2v13m-3-7h.2',
} as const;
export type Glyph = keyof typeof paths;
export function icon(name: Glyph) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), p = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'rm-icon'); svg.setAttribute('aria-hidden', 'true');
  p.setAttribute('d', paths[name]); svg.append(p); return svg;
}
export function action(label: string, run: () => void, glyph?: Glyph, cls = '') {
  const el = h('button', 'rm-button ' + cls, glyph && icon(glyph), h('span', null, label));
  el.type = 'button'; el.addEventListener('click', run); return el;
}
export function iconAction(label: string, run: () => void, glyph: Glyph) {
  const el = action(label, run, glyph, 'rm-icon-action'); el.title = label; return el;
}
export function brand() {
  const el = h('a', 'rm-brand', icon('logo'), 'Synergon'); el.href = '/'; el.setAttribute('aria-label', 'Synergon home'); return el;
}
export type Choice = { value: string; label: string };
export function select(label: string, choices: Choice[], selected?: string) {
  const el = h('select'); el.setAttribute('aria-label', label);
  for (const { value, label: text } of choices) el.add(new Option(text, value, false, value === selected));
  return el;
}
export function field(label: string, input: HTMLElement) { return h('label', 'rm-field', h('span', 'rm-field-label', label), input); }
export const displayNumber = (n: number, precision = 3) => Number(n.toFixed(precision)).toString();
export function section(title: string, ...content: (Node | string)[]) {
  return h('section', 'rm-section', h('h2', 'rm-section-title', title), ...content);
}
export function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
export function store(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* session still works */ } }

/** Pointer and keyboard resizing use the same collapse threshold. Narrow viewports start with the drawing visible. */
export function wirePanel(shell: HTMLElement, panel: HTMLElement, grip: HTMLElement, reopen: HTMLButtonElement, collapse: HTMLButtonElement) {
  const small = matchMedia('(max-width: 700px)');
  const min = 252, max = 460, key = 'synergon.roomPanelWidth';
  const saved = Number(stored(key)); let width = saved >= min && saved <= max ? saved : 302;
  let collapsed = small.matches || stored('synergon.roomPanelClosed') === 'yes';
  const setWidth = (w: number) => {
    width = Math.min(max, Math.max(min, Math.round(w)));
    shell.style.setProperty('--rm-panel-width', width + 'px'); grip.setAttribute('aria-valuenow', String(width));
  };
  function show(open: boolean) {
    collapsed = !open; shell.classList.toggle('rm-panel-closed', collapsed); panel.inert = collapsed;
    reopen.setAttribute('aria-expanded', String(open)); grip.tabIndex = open ? 0 : -1;
    if (!small.matches) store('synergon.roomPanelClosed', collapsed ? 'yes' : 'no');
  }
  setWidth(width); show(!collapsed);
  reopen.addEventListener('click', () => { show(true); collapse.focus(); });
  collapse.addEventListener('click', () => { show(false); reopen.focus(); });
  const backdrop = h('button', 'rm-backdrop'); backdrop.type = 'button'; backdrop.setAttribute('aria-label', 'Close workspace panel');
  backdrop.tabIndex = -1; backdrop.onclick = () => show(false); shell.append(backdrop);
  small.addEventListener('change', () => show(!small.matches && stored('synergon.roomPanelClosed') !== 'yes'));
  grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'vertical'); grip.setAttribute('aria-label', 'Workspace panel width');
  grip.setAttribute('aria-valuemin', String(min)); grip.setAttribute('aria-valuemax', String(max));
  grip.title = 'Drag to resize. Click to collapse.';
  let drag: { id: number; x: number; width: number; distance: number } | null = null;
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, width, distance: 0 }; grip.setPointerCapture(e.pointerId); e.preventDefault();
  });
  grip.addEventListener('pointermove', e => {
    if (drag?.id !== e.pointerId) return;
    const delta = e.clientX - drag.x; drag.distance = Math.max(drag.distance, Math.abs(delta));
    if (drag.distance > 3) {
      const proposed = drag.width + delta; shell.classList.toggle('rm-snap', proposed < min / 2);
      setWidth(proposed);
    }
  });
  grip.addEventListener('pointerup', e => {
    if (drag?.id !== e.pointerId) return;
    const snap = shell.classList.contains('rm-snap') || drag.distance < 4;
    if (snap) { setWidth(drag.width); show(false); reopen.focus(); } else store(key, String(width));
    drag = null; shell.classList.remove('rm-snap');
  });
  grip.addEventListener('pointercancel', () => { if (drag) setWidth(drag.width); drag = null; shell.classList.remove('rm-snap'); });
  grip.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + (e.key === 'ArrowLeft' ? -16 : 16)); store(key, String(width)); }
    if (e.key === 'Enter' || e.key === 'Home') { e.preventDefault(); show(false); reopen.focus(); }
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape' && small.matches) { show(false); reopen.focus(); } });
}
