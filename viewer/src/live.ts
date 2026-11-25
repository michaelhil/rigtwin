// The shared scene on this page (step 1): the server's live channel (api/live) and its commands
// (api/command), spoken by hand so that the page does not carry the command layer (bundle size).
//
// One rule for every pose path. Every control that moves a part (sliders, ↺, double-click, the pads,
// arrow keys, As photographed, the notices, Reset all, dragging in the 3D view) ends in the engine's
// setJoint / resetJoints, which announce 'joints'. A difference between the engine's joints and the
// shared pose is a local preview; it is saved as one pose.set, based on the version the preview started
// from, when no pointer is down and nothing has changed for 300 ms. Changes from the server are put into
// the engine with a flag, so they are never sent back; one for a joint this page is still changing waits
// (the save is then refused as stale, and the page shows the shared pose again and says why). A link
// whose pose differs from the shared one opens as a preview with Apply / Dismiss and is never saved by
// itself. The snapshot on connecting counts as a change from the server.
//
// This page knows its own changes by the versions its requests got back (`recorded`), never by an author
// id: the server makes the ids, and anybody can read them off the live channel. Reconnecting (backoff, wakes,
// resync) is live-connection.ts.
//
// Quiet when the page has no server: it asks for api/health only when version.json names a server, and
// stays local when the health check does not answer.
import { S, $, el, on, hooks, Q, DEG, setJoint, setView, setExplicitCamera, showAll, showOnly, setVisible, select, viewerApi, drawNow, type Opts } from './engine.ts';
import { sayJoint } from '../../shared/words.ts';
import { createConnection } from './live-connection.ts';
import { addTrace, lastSeen, meta, onTraceUndo, setTraceOwner, initTrace, type TraceRec } from './trace.ts';
import { current, workspaceApi, getWorkspace, agentViews as storedViews, setAgentViews as storeViews, mcpAddress, type AgentViews, type Workspace } from './workspace.ts';
import { renamed, showGone } from './workspace-bar.ts';
import type { JointValue } from '../../shared/pose.ts';

type Change = { joint: string; after: JointValue | null };
/** the person in the seat (synergon-scene/1; shared/commands/doc.ts PersonState), null: nobody */
type Person = import("../../shared/commands/doc.ts").PersonState | null;
type Entry = { version: number; actor: { id: string; label: string }; command: string; changes: Change[]; person?: { after: Person }; undoes?: number[] };
type Note = { box: HTMLElement; text: HTMLElement; buttons: HTMLButtonElement[] };

const random = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))];
/** sent with this page's requests; the server stores only a keyed hash of it ("Person · <hash>") */
const ME = random(16).map((b) => b.toString(16).padStart(2, '0')).join('');
/** the session code view commands name; asked for again on every reconnect, so it stays while the page is open */
let code = random(8).map((b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
let pose: Record<string, JointValue> = {}, version = -1, seen: Entry[] = [];
/** versions this page's own requests recorded; changes that arrive while a request is out wait for its answer */
const mine = new Set<number>(), later: Entry[] = [];
let out = 0, resyncs = 0;
/** base: the version the unsaved local change is based on; awaiting: the version of our last save, until the stream has it */
let base: number | null = null, awaiting = 0, timer = 0, busy = false, again = false, down = false, remote = false, applying = false, linked = false, preview = false;
let linkNote: Note, activity: Note, undoOf = 0, metaEl: HTMLElement;
/** this page's own author id, from the replies to its requests (the trace names every caller by its id) */
let myActor = '';
const laterTraces: TraceRec[] = [];
/** the caller whose views this page follows (POST api/follow), and its label; the activity line's latest caller */
let following: { actor: string; by: string } | null = null, lastCaller: { actor: string; by: string } | null = null, followNote: HTMLElement;

const shared = (id: string) => pose[id] ?? S.joints.get(id)!.def.neutral;
const differs = (a: JointValue, b: JointValue) => (Array.isArray(a) ? a.some((x, i) => Math.abs(x - (b as number[])[i]) > 1e-9) : Math.abs(a - (b as number)) > 1e-9);
/** joints whose value on this page is not the shared one */
const local = () => [...S.joints].filter(([id, j]) => differs(j.value, shared(id))).map(([id]) => id);
function put(id: string, v: JointValue) { remote = true; try { setJoint(id, v, { force: true }); } catch { /* not a joint of this model, or outside its travel here */ } remote = false; }
/** Show the shared value of every joint; with `old` (the shared pose before), keep where this page has an unsaved change of its own. */
function showShared(old?: Record<string, JointValue>) {
  for (const [id, j] of S.joints) if (differs(j.value, shared(id)) && !(old && differs(j.value, old[id] ?? j.def.neutral))) put(id, shared(id));
}

// ---------------------------------------------------------------------------------------------- words
function said(c: Change): string {
  const j = S.joints.get(c.joint);
  return j && c.after !== null ? sayJoint(j.def, c.after) : 'a part no longer in the model';
}
const say = (e: Entry) => `${e.actor.label}${e.undoes ? ' undid a change' : ''} — ${[...new Set(e.changes.map(said)), ...(e.person ? [e.person.after ? 'the person in the seat' : 'nobody in the seat'] : [])].join('; ')}`;
function note(buttons: [string, () => void][]): Note {
  const box = el('div', 'note live'), text = el('span');
  const bs = buttons.map(([t, f]) => { const b = el('button', null, t) as HTMLButtonElement; b.type = 'button'; b.addEventListener('click', f); return b; });
  box.append(text, ...bs); box.hidden = true; $('notices').append(box);
  return { box, text, buttons: bs };
}
/** The activity line: a change by someone else (with Undo of that entry), or why this page's change was not saved. */
let traceActivity: HTMLElement;
function tell(text: string, undo = 0, line = '', caller: { actor: string; by: string } | null = null, quiet = false) {
  const parent = quiet ? traceActivity : $('notices');
  if (activity.box.parentElement !== parent) parent.append(activity.box);
  activity.text.textContent = text; metaEl.textContent = line; undoOf = undo; activity.buttons[0].hidden = !undo;
  lastCaller = caller; showFollow(); activity.box.hidden = false;
}
/** the activity line's Follow button and the status under Settings, Agent access */
function showFollow() {
  const b = activity.buttons[1], on = !!lastCaller && following?.actor === lastCaller.actor;
  b.hidden = !lastCaller; b.textContent = on ? 'Following' : 'Follow'; b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'This browser shows the views this agent asks for; click to stop' : 'Show the views this agent asks for in this browser, without giving it a code';
  followNote.hidden = !following; followNote.firstChild!.textContent = following ? `This browser follows the views of ${following.by}. ` : '';
}
async function setFollow(who: { actor: string; by: string } | null) {
  try {
    const r = await (await fetch(workspaceApi('follow'), { method: 'POST', headers: { 'x-synergon': '1', 'content-type': 'application/json' }, body: JSON.stringify({ session: code, actor: who?.actor ?? null }) })).json();
    if (r?.ok) following = who; else if (who) tell(`Not followed: ${r?.error?.message ?? 'the server did not answer'}.`);
  } catch { /* no server */ }
  showFollow();
}
/** The activity line for a request by someone else, from its trace record: what happened, and when, how and how long. */
const ownTrace = (r: TraceRec) => (myActor !== '' && r.actor === myActor) || (r.version !== undefined && mine.has(r.version));
function tellTrace(r: TraceRec) {
  if (ownTrace(r) || (r.kind === 'person' && r.version === undefined)) return;
  if (asked && asked.who.actor === r.actor && r.command === 'look') return;      // the open question already says it
  const undid = r.ok && (r.command === 'history.undo' || r.command === 'undo') ? ' undid a change' : '';
  tell(`${r.by}${undid} — ${r.summary}`, r.ok && r.version !== undefined ? r.version : 0, meta(r), r.kind !== 'person' ? { actor: r.actor, by: r.by } : null, true);
}
function onTrace(r: TraceRec) { addTrace(r); if (out) laterTraces.push(r); else tellTrace(r); }
function setPreview(on: boolean) { preview = on; linkNote.box.hidden = !on; }

// ---------------------------------------------------------------------------------------------- commands
async function send(body: object): Promise<any> {
  out++;
  let r: any = null;
  try { r = await (await fetch(workspaceApi('command'), { method: 'POST', headers: { 'x-synergon': '1', 'content-type': 'application/json', 'x-synergon-client': 'person', 'x-synergon-client-id': ME }, body: JSON.stringify(body) })).json(); } catch { /* r stays null */ }
  if (typeof r?.recorded === 'number') mine.add(r.recorded);
  if (typeof r?.you?.id === 'string' && !myActor) { myActor = r.you.id; setTraceOwner(myActor); }
  if (--out === 0) { for (const e of later.splice(0)) if (!mine.has(e.version)) tell(say(e), e.version, '', null, true); for (const t of laterTraces.splice(0)) tellTrace(t); }
  return r;
}
const schedule = () => { clearTimeout(timer); timer = window.setTimeout(save, 300); };
/** Save the local preview as one pose.set (degrees and metres, as the commands take them). */
async function save() {
  if (version < 0 || preview || applying || down) return;
  if (busy || version < awaiting) { again = true; return; }
  const ids = local();
  if (!ids.length) { base = null; return; }
  const joints: Record<string, JointValue> = {}, from = base ?? version;
  for (const id of ids) { const j = S.joints.get(id)!, v = j.value; joints[id] = Array.isArray(v) ? v.map((x) => x / DEG) : j.def.type === 'prismatic' ? v : v / DEG; }
  busy = true;
  const r = await send({ id: 'pose.set', args: { joints, allowAssumed: true }, expectedVersion: from });
  busy = false;
  if (r?.ok) { awaiting = r.version; if (base === from) base = null; }
  else {
    const first = r?.error?.code === 'stale' && [...seen].reverse().find((x) => x.actor.id !== ME && x.changes.some((c) => ids.includes(c.joint)));
    base = null; showShared();
    tell(`Not saved: ${first ? `${say(first)} came first` : r?.error?.message ?? 'the server did not answer'}. This page shows the shared scene again.`);
  }
  if (again) { again = false; schedule(); }
}
async function undo() {
  activity.box.hidden = true;
  const r = await send({ id: 'history.undo', args: { version: undoOf } });
  if (!r?.ok) tell(`Not undone: ${r?.error?.code === 'stale' ? 'it was changed again since' : r?.error?.message ?? 'the server did not answer'}.`);
}

// ---------------------------------------------------------------------------------------------- the person
// The shared scene's person goes to viewer.person (person/index.ts, loaded after the page is ready), changed fields only. After
// a change of package (sex or style) the package first, then every field, with that package's control defaults and garments
// (viewer.person.definition()). The page's own changes come back the same way (idempotent). person=off: never shown.
let wantPerson: Person | undefined, shownPerson: Person | undefined, personBusy = false;
async function showPerson() {
  const api = viewerApi.person as any;
  if (wantPerson === undefined || personBusy || Q.get('person') === 'off') return;
  if (!api) { if (Q.get('person') === '0') return; window.setTimeout(showPerson, 500); return; }
  personBusy = true;
  try {
    if (!(await api.ready)) return;
    while (wantPerson !== undefined && JSON.stringify(wantPerson) !== JSON.stringify(shownPerson)) {
      const p = wantPerson, o = shownPerson && (shownPerson.sex === p?.sex && shownPerson.style === p?.style) ? shownPerson : null;
      if (p) {
        if (!o) await api.set({ sex: p.sex, style: p.style });
        const d = api.definition(), set: Record<string, unknown> = {}, slot = (id: string) => d?.slots?.find((x: any) => x.id === id)?.default ?? null;
        if (p.style === 'dressed' && (!o || o.tone !== p.tone)) set.tone = p.tone;
        if (p.style === 'dressed' && (!o || o.glasses !== p.glasses || o.headset !== p.headset)) set.wear = { glasses: p.glasses ? slot('glasses') : null, headset: p.headset ? slot('headset') : null };
        if (!o || JSON.stringify(o.body) !== JSON.stringify(p.body)) set.shape = Object.fromEntries((d?.controls ?? []).map((c: any) => [c.id, p.body[c.id] ?? c.default ?? 0]));   // a control left out is at its default
        if (!o || o.posture !== p.posture) set.pose = p.posture === 'operating' ? null : p.posture;
        if (!o || JSON.stringify(o.aims) !== JSON.stringify(p.aims)) set.aims = p.aims ?? null;
        await api.set(set);
      }
      await api.show(!!p);
      shownPerson = p;
    }
  } catch (e) { console.warn('person:', e); } finally { personBusy = false; }
}

// ---------------------------------------------------------------------------------------------- the live channel
function snapshot(doc: { version: number; pose: Record<string, JointValue>; person?: Person; history: Entry[] }) {
  if (doc.person !== undefined) { wantPerson = doc.person; void showPerson(); }
  const old = pose;
  pose = doc.pose; version = doc.version; seen = doc.history.slice(-50); awaiting = 0;
  if (base !== null && base > version) base = version;          // the scene was reset
  if (!preview) showShared(old);
  if (linked) { linked = false; if (local().length) setPreview(true); }
  else schedule();                                              // a change made here while not connected is saved now
}
function applied(e: Entry) {
  if (e.version <= version) return;
  if (e.version > version + 1) { conn.disconnect(); conn.connect(); return; }   // missed one: catch up from the version we have
  const old = { ...pose };
  for (const c of e.changes) { if (c.after === null) delete pose[c.joint]; else pose[c.joint] = c.after; }
  if (e.person) { wantPerson = e.person.after; void showPerson(); }
  version = e.version; seen.push(e); if (seen.length > 50) seen.shift();
  const own = mine.has(e.version);
  // this page's own saves are on screen already; everything else (others' changes, this page's Undo) is put in
  if (!preview && !(own && e.command === 'pose.set')) for (const c of e.changes) {
    const j = S.joints.get(c.joint);
    if (!j) continue;
    if (differs(j.value, old[c.joint] ?? j.def.neutral)) base = Math.min(base ?? Infinity, e.version - 1);   // being changed here: it waits
    else if (differs(j.value, shared(c.joint))) put(c.joint, shared(c.joint));
  }
  if (!own) { if (out) later.push(e); else tell(say(e), e.version, '', null, true); }      // while a request is out, it may turn out to be ours
  if (again && version >= awaiting) { again = false; schedule(); }
}
// ---------------------------------------------------------------------------------------------- consent
// On the public sandbox a view an agent asks for without naming a browser, while no browser follows it, comes to every
// page as a question (`ask`): this page shows it only if its owner allows it. Allow follows that agent (its next views
// come without asking); Always allow is stored in this browser for this workspace (any agent's views then come straight here); No stops
// that agent's questions until the page is reloaded. The setting is also under Settings, Agent access.
// The stored choice belongs to one workspace (workspace.ts keeps `synergon.agentViews` as a table of workspace ids): "always" in one
// workspace says nothing about another.
let agentViews: AgentViews = 'ask';
const declined = new Set<string>();
let consent: Note, consentTimer = 0, asked: { d: ViewEvent; who: { actor: string; by: string } } | null = null, viewsSelect: HTMLSelectElement;
type ViewEvent = { id: string; args: any; reply?: string; ask?: { actor: string; by: string; summary: string } };
function setAgentViews(v: AgentViews) { agentViews = v; if (current.id) storeViews(current.id, v); if (viewsSelect) viewsSelect.value = v; }
function answer(how: 'allow' | 'always' | 'no') {
  consent.box.hidden = true; clearTimeout(consentTimer);
  const a = asked; asked = null;
  if (!a) return;
  if (how === 'no') { declined.add(a.who.actor); return; }
  if (how === 'always') setAgentViews('always');
  void setFollow(a.who); applyView(a.d);
}
/** A view command: for this page by its code (or, on a local server, for every page), or a question (consent above). */
function view(d: ViewEvent) {
  if (!d.ask) { applyView(d); return; }
  const who = { actor: d.ask.actor, by: d.ask.by };
  if (agentViews === 'never' || declined.has(who.actor)) return;
  if (agentViews === 'always') { void setFollow(who); applyView(d); return; }
  asked = { d, who };
  consent.text.textContent = `${who.by} wants to change the view in this browser: ${d.ask.summary}.`;
  consent.box.hidden = false; clearTimeout(consentTimer);
  consentTimer = window.setTimeout(() => { consent.box.hidden = true; asked = null; }, 60_000);
}
/** `look` does what the three view commands do in one go, and with a reply id sends a picture of the result back. */
function applyView(d: ViewEvent) {
  const a = d.args;
  try {
    if (d.id === 'view.set') setView(a.view, { ortho: false });
    if (d.id === 'view.show') { if (a.all) showAll(); if (a.only) showOnly(a.only); if (a.hide) setVisible(a.hide, false); }
    if (d.id === 'view.select') select(a.id);
    if (d.id === 'look') {
      if (a.all) showAll(); if (a.only) showOnly(a.only); if (a.hide) setVisible(a.hide, false);
      if (Array.isArray(a.camera)) setExplicitCamera(a.camera.map(Number));
      else if (a.view) setView(a.view, { ortho: false, eye: typeof a.eye === 'number' ? a.eye : null, eyePoint: Array.isArray(a.eye_point) ? a.eye_point.map(Number) : null, eyeDirection: Array.isArray(a.eye_direction) ? a.eye_direction.map(Number) : null, followPerson: a.follow_person === true ? true : undefined });
      if (a.select) select(a.select);
    }
  } catch { /* an id this model does not have */ }
  if (d.reply) void sendPicture(d.reply);
}
async function sendPicture(reply: string) {
  try {
    const t0 = performance.now();
    drawNow();
    const b = await viewerApi.pictureJpeg(60 * 1024);
    if (!b) return;
    await fetch(`${workspaceApi('picture')}?reply=${reply}&session=${code}`, { method: 'POST', headers: { 'x-synergon': '1', 'content-type': 'image/jpeg', 'x-synergon-ms': String(Math.round(performance.now() - t0)) }, body: b });
  } catch { /* the agent hears "no picture" when its wait ends */ }
}
/** This workspace is deleted: stop the channel for good and say so. */
function gone() { conn.disconnect(); showGone(); }
const conn = createConnection({
  url: () => `${workspaceApi('live')}?session=${code}${version >= 0 ? `&since=${version}` : ''}`,
  event(name, d, resync) {
    if (resync) resyncs++;
    if (name === 'session') { code = d.code; $('live-code').textContent = code; void backfill(); if (following) void setFollow(following); }
    else if (name === 'trace') onTrace(d);
    else if (name === 'snapshot') snapshot(d.doc);
    else if (name === 'applied') applied(d);
    else if (name === 'view') view(d);
    else if (name === 'workspace') renamed((d?.workspace ?? d) as Workspace);     // someone renamed this workspace (or this page did: the same record)
    else if (name === 'deleted') gone();
  },
  // the stream cannot be opened again: a workspace deleted while this page was away answers 404, which is not a reason to keep trying
  closed: () => { void getWorkspace(current.id!).then((r) => { if (r.status === 404) gone(); }); },
}, { EventSource, window, document, setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (t) => window.clearTimeout(t as number), now: () => Date.now() });

/** Requests the page missed while it was not connected (the server keeps the last 100). */
async function backfill() {
  try { const t = await (await fetch(`${workspaceApi('trace')}?after=${lastSeen()}`, { cache: 'no-store' })).json(); for (const r of t?.traces ?? []) addTrace(r); } catch { /* an older server: no trace */ }
}
/** "Connect an agent": the address of this workspace's agent endpoint (MCP), with a button to copy it and the one command Claude Code needs. */
function connectAgent(id: string): HTMLElement {
  const url = mcpAddress(id), box = el('div', 'connect');
  const field = el('input') as HTMLInputElement; field.type = 'text'; field.readOnly = true; field.value = url; field.setAttribute('aria-label', 'Agent address of this workspace');
  field.addEventListener('focus', () => field.select());
  const copy = el('button', null, 'Copy address') as HTMLButtonElement; copy.type = 'button';
  copy.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { field.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } }
    copy.textContent = ok ? 'Copied' : 'Select and copy'; window.setTimeout(() => { copy.textContent = 'Copy address'; }, 1800);
  });
  const how = el('details', 'live-about'), cmd = el('code', null, `claude mcp add --transport http synergon ${url}`);
  how.append(el('summary', null, 'How to connect Claude Code'), el('p', null, 'Run this once in a terminal. The agent then works in this workspace only.'), cmd);
  const row = el('div', 'connect-row'); row.append(field, copy);
  box.append(el('p', 'live-code', 'Anyone with this address can change this workspace.'), row, how);
  return box;
}
export async function initLive() {
  linked = Q.has('pose');
  agentViews = current.id ? storedViews(current.id) : 'ask';
  try {
    const v = await (await fetch('/version.json', { cache: 'no-store' })).json();
    if (!v?.server) return;
    const h = await fetch('/api/health', { cache: 'no-store' });
    if (!h.ok || !/^synergon-scene\/1$/.test((await h.json()).format)) return;
  } catch { return; }
  linkNote = note([['Apply', () => { setPreview(false); save(); }], ['Dismiss', () => { setPreview(false); showShared(); }]]);
  linkNote.text.textContent = 'This link shows other adjustments than the shared scene.';
  consent = note([['Allow', () => answer('allow')], ['Always allow', () => answer('always')], ['No', () => answer('no')]]);
  consent.box.classList.add('amber', 'consent');
  consent.buttons[0].title = 'Show this view and the next ones this agent asks for, in this browser';
  consent.buttons[1].title = 'Show views from any agent in this workspace without asking. Change this under Settings, Agent access.';
  activity = note([['Undo', undo], ['Follow', () => void setFollow(following?.actor === lastCaller?.actor ? null : lastCaller)], ['×', () => { activity.box.hidden = true; }]]);
  activity.buttons[2].setAttribute('aria-label', 'Dismiss activity');
  traceActivity = el('div', 'trace-activity');
  initTrace(traceActivity);
  followNote = el('p', 'live-follow'); followNote.append(document.createTextNode(''));
  const stop = el('button', null, 'Stop') as HTMLButtonElement; stop.type = 'button'; stop.addEventListener('click', () => void setFollow(null));
  followNote.append(stop); followNote.hidden = true;
  metaEl = el('span', 'note-meta'); activity.text.after(metaEl);
  onTraceUndo(async (v) => { const r = await send({ id: 'history.undo', args: { version: v } }); if (!r?.ok) tell(`Not undone: ${r?.error?.code === 'stale' ? 'it was changed again since' : r?.error?.message ?? 'the server did not answer'}.`); });
  const viewsRow = el('label', 'live-views'); viewsRow.append(document.createTextNode('Views an agent asks for: '));
  viewsSelect = el('select') as HTMLSelectElement;
  for (const [v, t] of [['ask', 'ask me first'], ['always', 'always allow'], ['never', 'never']] as const) { const o = el('option', null, t) as HTMLOptionElement; o.value = v; viewsSelect.append(o); }
  viewsSelect.value = agentViews; viewsSelect.addEventListener('change', () => setAgentViews(viewsSelect.value as AgentViews));
  viewsRow.append(viewsSelect);
  const box = $('live-more'), settings = $('settings-agent');
  if (current.id) box.prepend(connectAgent(current.id));
  box.append(viewsRow, followNote);
  settings.append(box); settings.hidden = false; box.hidden = false; $('live-code').textContent = code;
  on((c) => { if (c !== 'joints' || remote || applying || version < 0) return; if (base === null) base = version; if (!preview) schedule(); });
  addEventListener('pointerdown', () => { down = true; }, true);
  for (const t of ['pointerup', 'pointercancel', 'blur']) addEventListener(t, () => { if (down) { down = false; schedule(); } }, true);
  hooks.beforeApply.push(() => { applying = true; setPreview(false); });
  hooks.onApply.push((o: Opts) => {
    if (!applying) return;                     // only a reset by apply() (a link, a script); Reset all is saved like any other change
    applying = false;
    if (version < 0) { linked = !!o.pose; return; }
    if (o.pose) { if (local().length) setPreview(true); } else showShared();
  });
  viewerApi.live = () => ({ code, version, preview, unsaved: local(), activity: activity.box.hidden ? null : activity.text.textContent, resyncs, person: shownPerson ?? null, ...conn.state() });
  viewerApi.command = send;             // the person panel's commands go out as this page's own (person-panel.ts)
  conn.connect();
}
