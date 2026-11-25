// Manage (`/workspaces/manage`): every workspace with a tick box, select all, and one delete with one confirmation that gives
// the count. The list is paged like the landing's ("Show more"); "select all" ticks what is shown. No import from the engine.
import { h, button, link, ago, plural } from './dom.ts';
import { workspaceList } from './browse.ts';
import { ask } from './dialog.ts';
import { addressOf, deleteWorkspace, forget, type Workspace } from './workspace.ts';

export function manage(root: HTMLElement) {
  document.title = 'Manage workspaces · Synergon';
  const main = h('main', 'pg');
  const chosen = new Map<string, Workspace>();
  const summary = h('span', 'muted'), result = h('p', 'result'); result.setAttribute('role', 'status'); result.hidden = true;
  const all = h('input'); all.type = 'checkbox'; all.id = 'select-all';
  const allLabel = h('label', 'check', all, h('span', null, 'Select all shown'));
  const del = button('Delete selected', () => void remove(), 'danger'); del.disabled = true;
  const bar = h('div', 'mg-bar', allLabel, h('div', 'mg-act', summary, del));

  const boxes = new Map<string, HTMLInputElement>();
  const list = workspaceList({
    limit: 25,
    emptyText: 'There are no workspaces. Nothing to manage.',
    row: (w) => {
      const box = h('input'); box.type = 'checkbox'; box.checked = chosen.has(w.id); boxes.set(w.id, box);
      box.setAttribute('aria-label', `Select ${w.name}`);
      box.addEventListener('change', () => { if (box.checked) chosen.set(w.id, w); else chosen.delete(w.id); refresh(); });
      const open = link(w.name, addressOf(w.id), 'wrow-name');
      return h('div', 'wrow mg-row', box, open, h('span', 'wrow-when', `created ${ago(w.created)}`));
    },
    onChange: () => refresh(),
  });
  function refresh() {
    const shown = list.items(), n = chosen.size, every = shown.length > 0 && shown.every((w) => chosen.has(w.id));
    all.checked = every; all.indeterminate = !every && shown.some((w) => chosen.has(w.id)); all.disabled = shown.length === 0;
    summary.textContent = n ? `${n} selected` : shown.length ? 'Tick the workspaces to delete.' : '';
    del.disabled = n === 0; del.textContent = n ? `Delete ${n === 1 ? '1 workspace' : `${n} workspaces`}` : 'Delete selected';
  }
  all.addEventListener('change', () => { for (const w of list.items()) { if (all.checked) chosen.set(w.id, w); else chosen.delete(w.id); const b = boxes.get(w.id); if (b) b.checked = all.checked; } refresh(); });

  async function remove() {
    const picked = [...chosen.values()];
    if (!picked.length) return;
    const names = picked.slice(0, 3).map((w) => `“${w.name}”`).join(', ') + (picked.length > 3 ? ` and ${picked.length - 3} more` : '');
    let gone = 0, problem = '';
    const finished = await ask({
      title: picked.length === 1 ? `Delete “${picked[0].name}”?` : `Delete ${picked.length} workspaces?`,
      body: `${picked.length === 1 ? 'It' : 'They'} will be gone for everyone who has ${picked.length === 1 ? 'its' : 'their'} link. This cannot be undone from here. ${picked.length === 1 ? '' : `Deleting: ${names}.`}`.trim(),
      confirm: picked.length === 1 ? 'Delete workspace' : `Delete ${picked.length} workspaces`, danger: true,
      run: async () => {
        for (const w of picked) {
          if (!chosen.has(w.id)) continue;
          const r = await deleteWorkspace(w.id);
          if (r.ok || r.status === 404) { gone++; chosen.delete(w.id); forget(w.id); }   // already gone counts as gone
          else { problem = r.message; break; }
        }
        return problem ? `${gone ? `${plural(gone, 'workspace')} deleted, then it stopped. ` : 'Nothing was deleted. '}${problem}` : null;
      },
    });
    if (gone) { result.textContent = `${plural(gone, 'workspace')} deleted.`; result.hidden = false; }
    if (finished || gone) { await list.reload(); refresh(); }
  }

  main.append(
    h('header', 'pg-head', h('h1', null, 'Manage workspaces'), h('p', 'lede', 'Anyone with a workspace’s link can delete it, so this page lists them all. A deleted workspace is gone for everyone.')),
    h('section', 'card', bar, result, list.root),
    h('footer', 'pg-foot', link('← Back to workspaces', '/')),
  );
  root.textContent = ''; root.append(main);
  refresh();
}
