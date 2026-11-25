// Small helpers for the pages that do not need the 3D engine (the landing, Manage, the workspace bar). No import
// from engine.ts: the landing must not pull three.js. Every text goes in with textContent, never as markup.

/** A new element with a class and children (strings become text). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}
/** A button that does not submit a form. */
export function button(label: string, onClick: () => void, cls?: string): HTMLButtonElement {
  const b = h('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b;
}
/** A link to an address of this site. */
export function link(label: string, href: string, cls?: string): HTMLAnchorElement {
  const a = h('a', cls, label); a.href = href; return a;
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", then the date. */
export function ago(when: string | number, now = Date.now()): string {
  const t = typeof when === 'number' ? when : Date.parse(when);
  if (!Number.isFinite(t)) return '';
  const d = Math.max(0, now - t);
  if (d < MIN) return 'just now';
  if (d < HOUR) { const n = Math.floor(d / MIN); return `${n} ${n === 1 ? 'minute' : 'minutes'} ago`; }
  if (d < DAY) { const n = Math.floor(d / HOUR); return `${n} ${n === 1 ? 'hour' : 'hours'} ago`; }
  if (d < 2 * DAY) return 'yesterday';
  if (d < 14 * DAY) return `${Math.floor(d / DAY)} days ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

let byKeyboard = false;
addEventListener('keydown', () => { byKeyboard = true; }, true);
addEventListener('pointerdown', () => { byKeyboard = false; }, true);
/** Move focus to something the page offers first (a notice's button): the focus ring shows only when the keyboard was in use. */
export function focusFirst(e: HTMLElement) { try { e.focus({ focusVisible: byKeyboard } as FocusOptions); } catch { e.focus(); } }
