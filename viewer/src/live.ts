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
import { S, $, el, on, hooks, Q, DEG, setJoint, setView, showAll, showOnly, setVisible, select, viewerApi, drawNow, type Opts } from './engine.ts';
import { sayJoint } from '../../shared/words.ts';
import { createConnection } from './live-connection.ts';
import { addTrace, lastSeen, meta, onTraceUndo, setTraceOwner, toggleTrace, type TraceRec } from './trace.ts';
import type { JointValue } from '../../shared/pose.ts';

type Change = { joint: string; after: JointValue | null };
type Entry = { version: number; actor: { id: string; label: string }; command: string; changes: Change[]; undoes?: number[] };
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
const say = (e: Entry) => `${e.actor.label}${e.undoes ? ' undid a change' : ''} — ${[...new Set(e.changes.map(said))].join('; ')}`;
function note(buttons: [string, () => void][]): Note {
  const box = el('div', 'note live'), text = el('span');
  const bs = buttons.map(([t, f]) => { const b = el('button', null, t) as HTMLButtonElement; b.type = 'button'; b.addEventListener('click', f); return b; });
  box.append(text, ...bs); box.hidden = true; $('notices').append(box);
  return { box, text, buttons: bs };
}
/** The activity line: a change by someone else (with Undo of that entry), or why this page's change was not saved. */
function tell(text: string, undo = 0, line = '') { activity.text.textContent = text; metaEl.textContent = line; undoOf = undo; activity.buttons[0].hidden = !undo; activity.box.hidden = false; }
/** The activity line for a request by someone else, from its trace record: what happened, and when, how and how long. */
const ownTrace = (r: TraceRec) => (myActor !== '' && r.actor === myActor) || (r.version !== undefined && mine.has(r.version));
function tellTrace(r: TraceRec) {
  if (ownTrace(r) || (r.kind === 'person' && r.version === undefined)) return;
  const undid = r.ok && (r.command === 'history.undo' || r.command === 'undo') ? ' undid a change' : '';
  tell(`${r.by}${undid} — ${r.summary}`, r.ok && r.version !== undefined ? r.version : 0, meta(r));
}
function onTrace(r: TraceRec) { addTrace(r); if (out) laterTraces.push(r); else tellTrace(r); }
function setPreview(on: boolean) { preview = on; linkNote.box.hidden = !on; }

// ---------------------------------------------------------------------------------------------- commands
async function send(body: object): Promise<any> {
  out++;
  let r: any = null;
  try { r = await (await fetch('api/command', { method: 'POST', headers: { 'x-rigtwin': '1', 'content-type': 'application/json', 'x-rigtwin-client': 'person', 'x-rigtwin-client-id': ME }, body: JSON.stringify(body) })).json(); } catch { /* r stays null */ }
  if (typeof r?.recorded === 'number') mine.add(r.recorded);
  if (typeof r?.you?.id === 'string' && !myActor) { myActor = r.you.id; setTraceOwner(myActor); }
  if (--out === 0) { for (const e of later.splice(0)) if (!mine.has(e.version)) tell(say(e), e.version); for (const t of laterTraces.splice(0)) tellTrace(t); }
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

// ---------------------------------------------------------------------------------------------- the live channel
function snapshot(doc: { version: number; pose: Record<string, JointValue>; history: Entry[] }) {
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
  version = e.version; seen.push(e); if (seen.length > 50) seen.shift();
  const own = mine.has(e.version);
  // this page's own saves are on screen already; everything else (others' changes, this page's Undo) is put in
  if (!preview && !(own && e.command === 'pose.set')) for (const c of e.changes) {
    const j = S.joints.get(c.joint);
    if (!j) continue;
    if (differs(j.value, old[c.joint] ?? j.def.neutral)) base = Math.min(base ?? Infinity, e.version - 1);   // being changed here: it waits
    else if (differs(j.value, shared(c.joint))) put(c.joint, shared(c.joint));
  }
  if (!own) { if (out) later.push(e); else tell(say(e), e.version); }      // while a request is out, it may turn out to be ours
  if (again && version >= awaiting) { again = false; schedule(); }
}
/** A view command addressed to this page's session code (or, on a local server, to every page). `look` does what the three
 *  view commands do in one go, and with a reply id sends a picture of the result back (agent interface v2). */
function view(d: { id: string; args: any; reply?: string }) {
  const a = d.args;
  try {
    if (d.id === 'view.set') setView(a.view, { ortho: false });
    if (d.id === 'view.show') { if (a.all) showAll(); if (a.only) showOnly(a.only); if (a.hide) setVisible(a.hide, false); }
    if (d.id === 'view.select') select(a.id);
    if (d.id === 'look') {
      if (a.all) showAll(); if (a.only) showOnly(a.only); if (a.hide) setVisible(a.hide, false);
      if (a.view) setView(a.view, { ortho: false });
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
    await fetch(`api/picture?reply=${reply}&session=${code}`, { method: 'POST', headers: { 'x-rigtwin': '1', 'content-type': 'image/jpeg', 'x-rigtwin-ms': String(Math.round(performance.now() - t0)) }, body: b });
  } catch { /* the agent hears "no picture" when its wait ends */ }
}
const conn = createConnection({
  url: () => `api/live?session=${code}${version >= 0 ? `&since=${version}` : ''}`,
  event(name, d, resync) {
    if (resync) resyncs++;
    if (name === 'session') { code = d.code; $('live-code').textContent = code; void backfill(); }
    else if (name === 'trace') onTrace(d);
    else if (name === 'snapshot') snapshot(d.doc);
    else if (name === 'applied') applied(d);
    else if (name === 'view') view(d);
  },
}, { EventSource, window, document, setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (t) => window.clearTimeout(t as number), now: () => Date.now() });

/** Requests the page missed while it was not connected (the server keeps the last 100). */
async function backfill() {
  try { const t = await (await fetch(`api/trace?after=${lastSeen()}`, { cache: 'no-store' })).json(); for (const r of t?.traces ?? []) addTrace(r); } catch { /* an older server: no trace */ }
}
export async function initLive() {
  linked = Q.has('pose');
  try {
    const v = await (await fetch('version.json', { cache: 'no-store' })).json();
    if (!v?.server) return;
    const h = await fetch('api/health', { cache: 'no-store' });
    if (!h.ok || (await h.json()).format !== 'rigtwin-scene/1') return;
  } catch { return; }
  linkNote = note([['Apply', () => { setPreview(false); save(); }], ['Dismiss', () => { setPreview(false); showShared(); }]]);
  linkNote.text.textContent = 'This link shows other adjustments than the shared scene.';
  activity = note([['Undo', undo], ['Trace', () => toggleTrace()], ['×', () => { activity.box.hidden = true; }]]);
  activity.buttons[1].title = 'Every request to the shared scene: who, what, how long';
  activity.buttons[2].setAttribute('aria-label', 'Close');
  metaEl = el('span', 'note-meta'); activity.text.after(metaEl);
  onTraceUndo(async (v) => { const r = await send({ id: 'history.undo', args: { version: v } }); if (!r?.ok) tell(`Not undone: ${r?.error?.code === 'stale' ? 'it was changed again since' : r?.error?.message ?? 'the server did not answer'}.`); });
  const traceBtn = el('button', 'trace-open', 'Show the requests (trace)') as HTMLButtonElement; traceBtn.type = 'button';
  traceBtn.addEventListener('click', () => toggleTrace(true));
  $('live-more').querySelector('.live-code')!.after(traceBtn);
  const box = $('live-more'), more = $('more');
  more.insertBefore(box, more.querySelector('.about')); box.hidden = false; $('live-code').textContent = code;
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
  viewerApi.live = () => ({ code, version, preview, unsaved: local(), activity: activity.box.hidden ? null : activity.text.textContent, resyncs, ...conn.state() });
  conn.connect();
}
