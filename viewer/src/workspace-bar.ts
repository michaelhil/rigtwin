// The workspace's name in the viewer's top bar, and its menu: Copy workspace link, Rename, New workspace, the recent ones,
// All workspaces, Delete. Also what happens when someone else renames this workspace (the `workspace` event: the name changes at
// once) or deletes it (the `deleted` event: a plain notice with a way out). Plain DOM; the questions are dialog.ts.
import { h, link, button, focusFirst } from './dom.ts';
import { ask } from './dialog.ts';
import {
  addressOf, cleanName, createWorkspace, current, deleteWorkspace, forget, NAME_MAX, recent, remember, rename, renameWorkspace, shareAddress, type Workspace,
} from './workspace.ts';

let bar: HTMLElement, trigger: HTMLButtonElement, titleEl: HTMLElement, menu: HTMLElement, gone = false, toastTimer = 0;

function toast(msg: string) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { t.hidden = true; }, 2200);
}
async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = h('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

function setName(name: string) {
  current.name = name; titleEl.textContent = name; trigger.title = `Workspace: ${name}`;
  trigger.setAttribute('aria-label', `Workspace ${name}. Open the workspace menu`);
  document.title = `${name} · Synergon`;
}
const isOpen = () => !menu.hidden;
function setMenu(open: boolean, focusTrigger = false) {
  if (open === isOpen()) return;
  if (open) fill();
  menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); trigger.classList.toggle('on', open);
  if (open) (menu.querySelector('button, a') as HTMLElement | null)?.focus();
  else if (focusTrigger) trigger.focus();
}

// ---------------------------------------------------------------------------------------------- what the menu does
async function doRename() {
  const id = current.id!;
  await ask({
    title: 'Rename workspace', field: { label: 'Name', value: current.name, max: NAME_MAX }, confirm: 'Save name',
    run: async (v) => {
      const name = cleanName(v);
      if (!name) return `Give it a name of 1 to ${NAME_MAX} characters.`;
      if (name === current.name) return null;
      const r = await renameWorkspace(id, name);
      if (r.status === 404) { showGone(); return null; }
      if (!r.ok || !r.data) return `The name was not changed. ${r.message}`;
      renamed(r.data); return null;
    },
  });
}
async function doNew() {
  await ask({
    title: 'New workspace', body: 'It starts as a fresh copy of the rig and the person. This one stays as it is.', field: { label: 'Name (optional)', placeholder: 'Untitled workspace', max: NAME_MAX }, confirm: 'Create workspace',
    run: async (v) => {
      const r = await createWorkspace(cleanName(v));
      if (!r.ok || !r.data) return `No workspace was created. ${r.message}`;
      remember(r.data); location.assign(addressOf(r.data.id)); return null;
    },
  });
}
async function doDelete() {
  const id = current.id!, name = current.name;
  await ask({
    title: `Delete “${name}”?`, body: 'It will be gone for everyone who has its link. This cannot be undone from here.', confirm: 'Delete workspace', danger: true,
    run: async () => {
      const r = await deleteWorkspace(id);
      if (!r.ok && r.status !== 404) return `It was not deleted. ${r.message}`;
      forget(id); location.assign('/'); return null;
    },
  });
}

function fill() {
  const id = current.id!;
  menu.textContent = '';
  const item = (label: string, f: () => void, cls?: string) => { const b = button(label, () => { if (label.startsWith('Copy')) return f(); setMenu(false); f(); }, cls ? `mi ${cls}` : 'mi'); menu.append(b); return b; };
  item('Copy workspace link', async () => { const ok = await copy(shareAddress(id)); setMenu(false); toast(ok ? 'Workspace link copied. Anyone with it can see and change this workspace.' : 'Could not copy the link. It is in the address bar.'); });
  item('Rename…', () => void doRename());
  item('New workspace…', () => void doNew());
  const others = recent().filter((r) => r.id !== id).slice(0, 4);
  if (others.length) {
    menu.append(h('h3', null, 'Recent'));
    for (const r of others) { const a = link(r.name, addressOf(r.id), 'mi'); a.title = r.name; menu.append(a); }
  }
  menu.append(link('All workspaces', '/', 'mi'), h('hr'));
  item('Delete workspace…', () => void doDelete(), 'bad');
}

// ---------------------------------------------------------------------------------------------- what others do
/** The server's record of this workspace changed (a rename by anyone): show it, and keep this browser's list in step. */
export function renamed(w: Workspace) { if (w.id !== current.id || !bar) return; setName(w.name); rename(w); }

/** This workspace was deleted (the stream said so, or the server no longer knows it): a plain notice over the page, with a way out. */
export function showGone() {
  if (gone || !current.id) return;
  gone = true; setMenu(false); forget(current.id);
  document.getElementById('stage')?.setAttribute('inert', ''); document.getElementById('parts')?.setAttribute('inert', '');
  document.querySelectorAll('dialog[open]').forEach((d) => (d as HTMLDialogElement).close());
  const back = link('Back to workspaces', '/', 'btn primary');
  const box = h('div', 'gone', h('div', 'gone-card', h('h2', null, 'This workspace was deleted'), h('p', null, `“${current.name}” is gone for everyone who had its link. What you see here is no longer shared and nothing you change is saved.`), h('p', 'pg-actions', back)));
  box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-labelledby', 'gone-title'); box.querySelector('h2')!.id = 'gone-title';
  document.body.append(box); focusFirst(back);
}
export const isGone = () => gone;

// ---------------------------------------------------------------------------------------------- the bar
export function initWorkspaceBar() {
  if (!current.id) return;                               // a page without a server has no workspace
  const stage = document.getElementById('stage')!;
  titleEl = h('span', 'ws-title'); trigger = h('button', 'ws-name'); trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', 'ws-menu');
  trigger.append(titleEl, h('i', 'ws-chev'));
  menu = h('div', 'ws-menu pop'); menu.id = 'ws-menu'; menu.hidden = true; menu.setAttribute('aria-label', 'Workspace menu');
  bar = h('div', 'ws-bar ui', trigger, menu); bar.id = 'ws-bar';
  stage.append(bar);
  setName(current.name);
  trigger.addEventListener('click', (e) => { e.stopPropagation(); setMenu(!isOpen()); });
  document.addEventListener('pointerdown', (e) => { if (isOpen() && !bar.contains(e.target as Node)) setMenu(false); });
  bar.addEventListener('focusout', (e) => { const to = (e as FocusEvent).relatedTarget as Node | null; if (isOpen() && to && !bar.contains(to)) setMenu(false); });
  // before the page's own keys (Escape would also clear the selection) and the person panel's
  window.addEventListener('keydown', (e) => {
    if (!isOpen() || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setMenu(false, true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll<HTMLElement>('button, a')], i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); e.preventDefault();
    }
  }, true);
}
