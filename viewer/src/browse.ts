// The list of every workspace, newest first, as the landing and Manage show it: a search box once there are 7 or more (the server
// does the searching), "Show more" for the next page, and plain words for loading, nothing found and a server that does not answer.
// The page that uses it decides how a row looks. No import from the engine.
import { h, button } from './dom.ts';
import { listWorkspaces, type Workspace } from './workspace.ts';

export const SEARCH_FROM = 7;

export interface WorkspaceList {
  root: HTMLElement;
  /** what is loaded now, newest first */
  items(): Workspace[];
  /** the number of workspaces on the server for the current search */
  total(): number;
  /** ask again from the start (after a delete, say) */
  reload(): Promise<void>;
}

export function workspaceList(o: { limit: number; row: (w: Workspace) => HTMLElement; onChange?: (list: WorkspaceList) => void; emptyText?: string }): WorkspaceList {
  const root = h('div', 'wl'), list = h('ul', 'wl-list'), status = h('p', 'wl-status'), more = h('div', 'wl-more');
  const input = h('input'); input.type = 'search'; input.placeholder = 'Search by name'; input.autocomplete = 'off'; input.maxLength = 80;
  const label = h('label', 'wl-search', h('span', 'sr', 'Search workspaces'), input);
  label.hidden = true; status.setAttribute('aria-live', 'polite');
  root.append(label, list, status, more);
  let items: Workspace[] = [], total = 0, next: string | null = null, query = '', loaded = false, failed = '', busy = false, token = 0, wide = false, timer = 0;
  const self: WorkspaceList = { root, items: () => items, total: () => total, reload: () => load(false) };

  function paint(from = 0) {
    if (from === 0) list.textContent = '';
    for (const w of items.slice(from)) { const li = h('li', null, o.row(w)); list.append(li); }
    label.hidden = !wide;
    status.textContent = ''; more.textContent = '';
    if (busy && !items.length) status.textContent = 'Loading workspaces…';
    else if (failed) { status.append(failed + ' ', button('Try again', () => void load(false), 'link')); }
    else if (loaded && !items.length) status.textContent = query ? `No workspace has “${query}” in its name.` : o.emptyText ?? 'There are no workspaces yet.';
    if (next && !failed) {
      const b = button(busy ? 'Loading…' : 'Show more', () => void load(true)); b.disabled = busy;
      more.append(b, h('span', 'wl-count', `Showing ${items.length} of ${total}`));
    } else if (loaded && items.length && total > SEARCH_FROM) more.append(h('span', 'wl-count', `${items.length} of ${total}`));
  }
  async function load(append: boolean) {
    const mine = ++token; busy = true; failed = '';
    if (!append) { items = []; next = null; list.textContent = ''; }
    paint(append ? items.length : 0);
    const r = await listWorkspaces({ search: query, limit: o.limit, cursor: append ? next : null });
    if (mine !== token) return;                                          // a newer search has started: this answer is old
    busy = false;
    if (!r.ok || !r.data) { failed = r.status === 0 ? 'The server did not answer.' : 'The workspaces could not be loaded.'; paint(append ? items.length : 0); return; }
    const from = append ? items.length : 0;
    items = append ? [...items, ...r.data.workspaces] : r.data.workspaces; next = r.data.next; total = r.data.total; loaded = true;
    if (!query && total >= SEARCH_FROM) wide = true;                     // the box stays while someone is typing in it, even when the search finds fewer
    else if (!query) wide = false;
    paint(from); o.onChange?.(self);
  }
  input.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { const q = input.value.trim(); if (q !== query) { query = q; void load(false); } }, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { input.value = ''; query = ''; void load(false); e.stopPropagation(); } });
  void load(false);
  return self;
}
