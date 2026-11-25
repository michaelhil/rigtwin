// Workspaces on the page: what the landing, Manage, the workspace bar and the live channel share. No import from the
// engine: the landing must not download three.js. The server side is described in work/next/WORKSPACES-CONTRACT.md.
//
//   current    which workspace this page shows (null: a page without a server, the viewer as before)
//   calls      list, get, create, rename, remove: the server's answers turned into { ok, data, code, message }
//   recent     the workspaces opened in this browser (localStorage `synergon.recentWorkspaces`, at most 5, never a cookie)
//   consent    what this browser decided about views an agent asks for, per workspace (localStorage `synergon.agentViews`)
// Every storage access is in try/catch: a private window, blocked site data or a full disk must never stop a page.

export interface Workspace { id: string; name: string; created: string; changed: string }
export interface Reply<T> { ok: boolean; status: number; data: T | null; code: string; message: string }

/** The shape of an id (the server checks the same); anything else in an address is an unknown workspace at once. */
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const NAME_MAX = 80;
export const UNTITLED = 'Untitled workspace';

export const current: { id: string | null; name: string } = { id: null, name: '' };
export const addressOf = (id: string) => `/workspaces/${id}`;
/** A server address of the current workspace, always absolute (`/api/workspaces/<id>/<rest>`): relative ones break under /workspaces/<id>. */
export function workspaceApi(rest: string): string {
  if (!current.id) throw new Error('no workspace on this page');
  return `/api/workspaces/${current.id}/${rest}`;
}
/** The address an agent (MCP) connects to for this workspace. */
export const mcpAddress = (id: string) => `${location.origin}/api/workspaces/${id}/mcp`;
/** The link people share for this workspace. */
export const shareAddress = (id: string) => `${location.origin}${addressOf(id)}`;

// ---------------------------------------------------------------------------------------------- calls
async function call<T>(method: string, url: string, body?: object): Promise<Reply<T>> {
  try {
    const r = await fetch(url, {
      method, cache: 'no-store',
      headers: method === 'GET' ? {} : { 'x-synergon': '1', 'x-synergon-client': 'person', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: any = null;
    if (r.status !== 204) { try { data = await r.json(); } catch { /* no JSON: an error page of a proxy, say */ } }
    const e = data?.error;
    return { ok: r.ok, status: r.status, data: r.ok ? data : null, code: e?.code ?? '', message: e?.hint || e?.message || (r.ok ? '' : r.status === 429 ? 'Too many requests just now. Try again in a minute.' : 'The server could not do that.') };
  } catch { return { ok: false, status: 0, data: null, code: 'offline', message: 'The server did not answer. Check the connection and try again.' }; }
}
export const listWorkspaces = (o: { search?: string; limit?: number; cursor?: string | null } = {}) =>
  call<{ workspaces: Workspace[]; next: string | null; total: number }>('GET', `/api/workspaces?${new URLSearchParams({ ...(o.search ? { search: o.search } : {}), limit: String(o.limit ?? 50), ...(o.cursor ? { cursor: o.cursor } : {}) })}`);
export const getWorkspace = (id: string) => call<Workspace>('GET', `/api/workspaces/${id}`);
export const createWorkspace = (name?: string) => call<Workspace>('POST', '/api/workspaces', name?.trim() ? { name: name.trim() } : {});
export const renameWorkspace = (id: string, name: string) => call<Workspace>('PATCH', `/api/workspaces/${id}`, { name });
export const deleteWorkspace = (id: string) => call<null>('DELETE', `/api/workspaces/${id}`);

/** The name as the server will keep it: trimmed, no control characters, at most 80 characters. */
export const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, NAME_MAX);

// ---------------------------------------------------------------------------------------------- recent in this browser
const RECENT_KEY = 'synergon.recentWorkspaces', RECENT_MAX = 5;
export interface Recent { id: string; name: string; opened: number }
export function recent(): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    // what is in storage is not trusted: only well-formed entries, newest first
    return raw.filter((r) => r && typeof r.id === 'string' && ID.test(r.id) && typeof r.name === 'string' && Number.isFinite(r.opened))
      .map((r) => ({ id: r.id as string, name: cleanName(r.name) || UNTITLED, opened: Number(r.opened) })).sort((a, b) => b.opened - a.opened).slice(0, RECENT_MAX);
  } catch { return []; }
}
function saveRecent(list: Recent[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* private window: the list lives only while the page is open */ } }
/** This workspace was opened (or created) just now. */
export function remember(w: { id: string; name: string }) { saveRecent([{ id: w.id, name: w.name, opened: Date.now() }, ...recent().filter((r) => r.id !== w.id)]); }
/** Keep the list's name for a workspace in step with the server's, without counting it as opened again. */
export function rename(w: { id: string; name: string }) { const l = recent(); if (l.some((r) => r.id === w.id)) saveRecent(l.map((r) => (r.id === w.id ? { ...r, name: w.name } : r))); }
/** A workspace that no longer answers leaves the list, and so does what this browser decided for it. */
export function forget(id: string) { saveRecent(recent().filter((r) => r.id !== id)); setAgentViews(id, 'ask'); }

// ---------------------------------------------------------------------------------------------- consent, per workspace
export type AgentViews = 'ask' | 'always' | 'never';
const VIEWS_KEY = 'synergon.agentViews', VIEWS_MAX = 200;
function viewsMap(): Record<string, AgentViews> {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '{}');
    // an older page stored one plain word for every workspace there was: that is not a choice for this workspace, so it is not read
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => ID.test(k) && (v === 'always' || v === 'never'))) as Record<string, AgentViews>;
  } catch { return {}; }
}
export const agentViews = (id: string): AgentViews => viewsMap()[id] ?? 'ask';
export function setAgentViews(id: string, v: AgentViews) {
  const m = viewsMap();
  if (v === 'ask') delete m[id]; else { delete m[id]; m[id] = v; }
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(Object.fromEntries(Object.entries(m).slice(-VIEWS_MAX)))); } catch { /* private window: for this page only */ }
}
