// Workspace › Project › Scene: one selector for the homepage bar and the editor's panel head. A level appears once its
// parent is chosen, a workspace with a single project picks it, and choosing a scene opens it. Each list ends with
// "New …" (a name only; menus create empty scenes) and "Rename …". No import from the engine: the homepage uses it.
import { h, link } from './dom.ts';
import { ask } from './dialog.ts';
import { icon } from './room-controls.ts';
import { API, publicSite, sceneURL } from './room-paths.ts';

export interface Named { id: string; name: string }
export interface Tree extends Named { projects: (Named & { scenes: Named[] })[] }
export interface Place { workspace: Named; project: Named; scene: Named }
type Level = 'workspace' | 'project' | 'scene';

// Browser storage: the scenes this browser opened (newest first) and, for the public list, the workspaces it made or opened.
const RECENTS = 'synergon.roomRecents', KNOWN = 'synergon.workspaces';
function ids(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
  catch { return []; }
}
function keep(key: string, list: string[], max: number) { try { localStorage.setItem(key, JSON.stringify(list.slice(0, max))); } catch { /* storage blocked */ } }
export const rememberScene = (id: string) => keep(RECENTS, [id, ...ids(RECENTS).filter(x => x !== id)], 12);
export const forgetScene = (id: string) => keep(RECENTS, ids(RECENTS).filter(x => x !== id), 12);
export const rememberWorkspace = (id: string) => keep(KNOWN, [id, ...ids(KNOWN).filter(x => x !== id)], 20);
const forgetWorkspace = (id: string) => keep(KNOWN, ids(KNOWN).filter(x => x !== id), 20);
/** True once: the public note has not been shown in this browser yet (and is now marked as shown). */
export function firstNote() {
  try { if (localStorage.getItem('synergon.sceneNote')) return false; localStorage.setItem('synergon.sceneNote', 'shown'); return true; }
  catch { return false; }
}

export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Synergon': '1' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const json = await r.json().catch(() => null);
  if (!r.ok || json === null || json?.ok === false)
    throw new ApiError([json?.error?.message || 'The server could not complete the request.', json?.error?.hint].filter(Boolean).join(' '), r.status);
  return json as T;
}
const command = <T>(id: string, args: Record<string, unknown>) => api<T>(API + '/projects/command', { id, args });
const problem = (e: unknown) => e instanceof Error ? e.message : String(e);
const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 400);

/** The newest scene this browser opened that still exists, or null. */
export async function lastScene(): Promise<string | null> {
  for (const id of ids(RECENTS)) {
    try { await api(API + '/scenes/' + encodeURIComponent(id) + '/meta'); return id; }
    catch (e) { if (gone(e)) forgetScene(id); else if (!(e instanceof ApiError && e.status === 422)) throw e; }
  }
  return null;
}
/** A new workspace with its first project and scene (furnished for a first visit, empty from the menus). */
export async function createWorkspace(template: 'empty' | 'demo', name?: string) {
  const made = await command<{ workspace: string; project: string; scene: string }>('workspace.create', { ...(name ? { name } : {}), template });
  rememberWorkspace(made.workspace);
  return made;
}
/** The first item gets its own name; after that the count plus one ("Scene 3" beside two others), skipping names in use. */
function nextName(first: string, stem: string, used: string[]) {
  if (!used.length) return first;
  for (let i = used.length + 1; ; i++) if (!used.includes(stem + ' ' + i)) return stem + ' ' + i;
}
const WORDS: Record<Level, { many: string; one: string; first: string; stem: string }> = {
  workspace: { many: 'Workspaces', one: 'Workspace', first: 'My workspace', stem: 'Workspace' },
  project: { many: 'Projects', one: 'Project', first: 'My project', stem: 'Project' },
  scene: { many: 'Scenes', one: 'Scene', first: 'Scene 1', stem: 'Scene' },
};

/** The selector. `here` is the open scene in the editor; the homepage starts with nothing chosen. */
export function hierarchy(o: { place: 'home' | 'editor'; here?: Place; renamed?: (scene: Named) => void }) {
  const editor = o.place === 'editor', here = o.here;
  let ws: Named | null = here ? { ...here.workspace } : null, project: Named | null = here ? { ...here.project } : null;
  let workspaces: Named[] | null = null, local = false;
  const trees = new Map<string, Tree>();
  void publicSite().then(p => { local = !p; });

  const menus = (['workspace', 'project', 'scene'] as Level[]).map(level => {
    const label = h('span', 'hy-label'), summary = h('summary', 'hy-trigger', label, icon('chevron'));
    const list = h('div', 'hy-list'), details = h('details', 'hy-menu hy-' + level, summary, list);
    details.addEventListener('toggle', () => { if (details.open) { for (const x of menus) if (x.details !== details) x.details.open = false; void fill(m); } });
    const m = { level, label, summary, list, details, ready: Promise.resolve() };
    return m;
  });
  const [wsMenu, projectMenu, sceneMenu] = menus;
  const sep = () => { const s = h('span', 'hy-sep', '›'); s.setAttribute('aria-hidden', 'true'); return s; };
  const toProject = sep(), toScene = sep();
  const nav = h('nav', 'hy hy-' + o.place);
  nav.setAttribute('aria-label', 'Location');
  if (editor) nav.append(h('div', 'hy-parents', wsMenu.details, toProject, projectMenu.details), sceneMenu.details);
  else nav.append(wsMenu.details, toProject, projectMenu.details, toScene, sceneMenu.details);

  const chosen = (level: Level): Named | null => level === 'workspace' ? ws : level === 'project' ? project : here && project?.id === here.project.id ? here.scene : null;
  function update() {
    for (const m of menus) {
      const item = chosen(m.level), w = WORDS[m.level];
      m.label.textContent = item?.name ?? w.many;
      m.summary.setAttribute('aria-label', item ? w.one + ': ' + item.name : 'Choose a ' + w.one.toLowerCase());
      m.summary.title = item ? w.one + ': ' + item.name : '';
    }
    projectMenu.details.hidden = toProject.hidden = !ws;
    sceneMenu.details.hidden = toScene.hidden = !editor && !project;
  }
  async function tree(id: string, fresh = false) {
    if (!fresh && trees.has(id)) return trees.get(id)!;
    const t = await api<Tree>(API + '/workspaces/' + encodeURIComponent(id));
    trees.set(id, t); return t;
  }
  async function loadWorkspaces() {
    const listed = (await api<{ workspaces: Named[] }>(API + '/workspaces')).workspaces;
    if (!(await publicSite())) return listed;
    // The public site lists the shared workspace only; add the ones this browser made or opened.
    const extra = ids(KNOWN).filter(id => !listed.some(w => w.id === id));
    const found = await Promise.all(extra.map(id => tree(id, true).catch(e => { if (gone(e)) forgetWorkspace(id); return null; })));
    return [...listed, ...found.filter((t): t is Tree => !!t).map(t => ({ id: t.id, name: t.name }))];
  }
  function note(text: string) { return h('p', 'hy-note', text); }
  function item(m: typeof menus[number], entry: Named) {
    const current = chosen(m.level)?.id === entry.id;
    const el = m.level === 'scene' ? link('', sceneURL(entry.id), 'hy-item') : h('button', 'hy-item');
    if (el instanceof HTMLButtonElement) { el.type = 'button'; el.onclick = () => choose(m.level, entry); }
    else if (current && editor) el.onclick = e => { e.preventDefault(); close(m, true); };
    el.append(h('span', null, entry.name));
    if (current) { el.setAttribute('aria-current', 'page'); el.append(icon('check')); }
    return el;
  }
  function act(label: string, run: () => void, plus = false) {
    const b = h('button', 'hy-item hy-action', plus ? icon('plus') : null, h('span', null, label));
    b.type = 'button'; b.onclick = run; return b;
  }
  function render(m: typeof menus[number], entries: Named[] | null, error?: string) {
    const w = WORDS[m.level], picked = chosen(m.level), orphan = m.level === 'scene' && !project;
    const actions: HTMLElement[] = orphan ? [] : [act('New ' + w.one.toLowerCase(), () => void create(m), true)];
    if (picked) actions.push(act('Rename ' + w.one.toLowerCase() + '…', () => rename(m, picked)));
    if (m.level === 'project' && project && local) actions.push(link('Project details…', '/projects/' + encodeURIComponent(project.id), 'hy-item hy-action'));
    const body = error ? [note(error)] : !entries ? [note('Loading…')]
      : entries.length ? entries.map(e => item(m, e)) : [note(orphan ? 'Choose a project first.' : 'None yet.')];
    m.list.replaceChildren(h('div', 'hy-entries', ...body), ...(actions.length ? [h('div', 'hy-divider'), ...actions] : []));
  }
  const entries = (m: typeof menus[number]): Named[] | null => m.level === 'workspace' ? workspaces
    : !ws || !trees.has(ws.id) ? null : m.level === 'project' ? trees.get(ws.id)!.projects
    : project ? trees.get(ws.id)!.projects.find(p => p.id === project!.id)?.scenes ?? [] : [];
  function fill(m: typeof menus[number]) {
    render(m, entries(m));
    m.ready = (async () => {
      try {
        if (m.level === 'workspace') workspaces = await loadWorkspaces();
        else if (ws) await tree(ws.id, true);
        if (m.details.open) {
          const focused = m.list.contains(document.activeElement) ? [...m.list.querySelectorAll('a,button')].indexOf(document.activeElement!) : -1;
          render(m, entries(m));
          if (focused >= 0) (m.list.querySelectorAll<HTMLElement>('a,button')[focused] ?? m.summary).focus();
        }
      } catch (e) { if (m.details.open) render(m, null, WORDS[m.level].many + ' could not be loaded. ' + problem(e)); }
    })();
    return m.ready;
  }
  function close(m?: typeof menus[number], focus = false) {
    for (const x of menus) x.details.open = false;
    if (m && focus) m.summary.focus();
  }
  async function choose(level: Level, entry: Named) {
    close();
    if (level === 'workspace') {
      ws = { ...entry }; project = null;
      if (here && entry.id === here.workspace.id) project = { ...here.project };
      update();
      try {
        const t = await tree(entry.id, true);
        if (!project && t.projects.length === 1) project = { id: t.projects[0].id, name: t.projects[0].name };
      } catch { /* the project menu reports it */ }
      update();
      (project ? sceneMenu : projectMenu).summary.focus();
    } else { project = { ...entry }; update(); sceneMenu.summary.focus(); }
  }
  async function create(m: typeof menus[number]) {
    close(m, true);
    const w = WORDS[m.level];
    // The next default name needs the current list; a quick click can come before it has loaded.
    if (m.level === 'workspace' && !workspaces) workspaces = await loadWorkspaces().catch(() => null);
    else if (m.level !== 'workspace' && ws && !trees.has(ws.id)) await tree(ws.id).catch(() => null);
    const used = m.level === 'workspace' ? (workspaces ?? []).map(x => x.name) : (entries(m) ?? []).map(x => x.name);
    void ask({
      title: 'New ' + w.one.toLowerCase(), field: { label: 'Name', value: nextName(w.first, w.stem, used), max: 80 }, confirm: 'Create',
      run: async value => {
        const name = value.trim(), args = name ? { name } : {};
        try {
          const scene = m.level === 'workspace' ? (await createWorkspace('empty', name || undefined)).scene
            : m.level === 'project' ? (await command<{ scene: string }>('project.create', { workspace: ws!.id, ...args, template: 'empty' })).scene
            : (await command<{ scene: string }>('project.scene', { project: project!.id, ...args, template: 'empty' })).scene;
          location.assign(sceneURL(scene));
          return null;
        } catch (e) { return problem(e); }
      },
    });
  }
  function rename(m: typeof menus[number], target: Named) {
    close(m, true);
    const w = WORDS[m.level];
    void ask({
      title: 'Rename ' + w.one.toLowerCase(), field: { label: 'Name', value: target.name, max: 80 }, confirm: 'Rename',
      run: async value => {
        const name = value.trim();
        if (!name) return 'Enter a name.';
        try { await command(m.level + '.rename', { [m.level]: target.id, name }); }
        catch (e) { return problem(e); }
        for (const x of [ws, project, here?.workspace, here?.project, here?.scene]) if (x?.id === target.id) x.name = name;
        workspaces = null; trees.clear(); update();
        if (m.level === 'scene') o.renamed?.({ id: target.id, name });
        return null;
      },
    });
  }
  // Keyboard: Enter or Space opens (the summary does), arrows move, Home and End jump, Escape closes and returns focus.
  nav.addEventListener('keydown', e => {
    const m = menus.find(x => x.details.contains(e.target as Node));
    if (!m) return;
    if (e.key === 'Escape' && m.details.open) { e.preventDefault(); e.stopPropagation(); close(m, true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || (!m.details.open && (e.key === 'Home' || e.key === 'End'))) return;
    e.preventDefault();
    const move = () => {
      const items = [...m.list.querySelectorAll<HTMLElement>('a,button')], at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : at < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
        : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    if (m.details.open) move();
    else { m.details.addEventListener('toggle', () => void m.ready.then(move), { once: true }); m.details.open = true; }
  });
  // Leaving the editor's selector with a parent chosen but no scene opened goes back to where the person is.
  const revert = () => {
    if (!here || (ws?.id === here.workspace.id && project?.id === here.project.id)) return;
    ws = { ...here.workspace }; project = { ...here.project }; update();
  };
  document.addEventListener('pointerdown', e => {
    if (nav.contains(e.target as Node) || document.querySelector('dialog[open]')) return;
    close(); if (editor) revert();
  });
  nav.addEventListener('focusout', e => {
    const to = e.relatedTarget as Node | null;
    if (!to || nav.contains(to) || document.querySelector('dialog[open]')) return;
    close(); if (editor) revert();
  });
  update();
  return {
    node: nav,
    /** The open scene's name changed (a live snapshot). */
    scene(name: string) { if (here && here.scene.name !== name) { here.scene.name = name; update(); } },
  };
}
