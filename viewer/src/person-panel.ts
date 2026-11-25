// The person panel (manikin v1, phase 4): who sits in the rig and how they look, in the page's own style. It is loaded with the
// person chunk after the page is ready (main.ts imports this module, which starts person/index.ts), so the first download
// does not grow.
//
//   the panel   Who (three survey presets and sex), Body (stature, weight, and the survey's other measures under "More
//               measurements"), Look (dressed operator or clay figure, skin tone, glasses and headset), with Undo and "Back to
//               <preset>". It opens from a click on the person in the 3D view or from its row at the end of the parts list; it
//               and the part card take turns in the same place (a bottom sheet on a narrow window).
//   changes     everything goes through one adapter (`commit`): the change is shown here at once (viewer.person.set), and when
//               the page is connected to a server that knows the person commands it is recorded there as person.set, in the
//               arguments MC fixed, so other browsers and agents see it; Undo is then history.undo of this page's group. Without
//               such a server (or when it answers unknown_command) the page keeps its own undo list. One slider drag is one change.
//   updates     the panel reads viewer.person.state() again after its own changes and on MV-core's `synergon:person` signal, so
//               a change from another browser, an agent or a link shows here the same way.
//   credits     the CC BY garments are credited on the 3D view whenever the dressed operator is shown, in saved pictures, and in
//               full under More, Credits (assets/manikin/CREDITS.md, bundled into this chunk).
//   picking     a click on the person selects it (outlined like a selected part) and opens the panel; a click on the rig works
//               as before (interact.ts asks hooks.click first).
import * as THREE from 'three';
import { S, $, el, on, hooks, scene, canvas, currentCamera, frameSize, layout, rescaleView, stageEl, select, setHover, outlineExtra, pickAt, drawNow, viewerApi } from './engine.ts';
import { pictureCredits } from './ui.ts';
import { initPerson } from './person/index.ts';
import CREDITS from '../../assets/manikin/CREDITS.md' with { type: 'text' };

// --------------------------------------------------------------------------------------------- words
type Sex = 'female' | 'male';
type Style = 'dressed' | 'clay';
/** what the person is now, in the words of the person.set command (MC): body in the package's ids and units */
interface Spec { sex: Sex; style: Style; tone: string; glasses: boolean; headset: boolean; body: Record<string, number> }
type SetArgs = { preset?: string; sex?: Sex; style?: Style; tone?: string; glasses?: boolean; headset?: boolean; body?: Record<string, number> };
interface Control { id: string; label: string; unit: string; min: number; max: number; step: number; default: number; group: string }
interface Def { controls: Control[]; presets: { name: string; values: Record<string, number> }[]; tones: { id: string; label: string }[]; slots: { id: string; default?: string; allowNone?: boolean }[] }

/** The three survey people of the plan, as person.set names them, and the package preset each one is. The median of the other sex
 *  is where a change of sex alone puts the body. */
const PRESETS = [
  { id: 'P5 woman', label: 'Short woman', pct: 'P5', sex: 'female', pkg: 'Small woman (stature P5)' },
  { id: 'P50 man', label: 'Median man', pct: 'P50', sex: 'male', pkg: 'Median man' },
  { id: 'P95 man', label: 'Tall man', pct: 'P95', sex: 'male', pkg: 'Tall man (stature P95)' },
] as const;
const MEDIANS = [
  { id: 'Median woman', label: 'Median woman', pct: 'P50', sex: 'female', pkg: 'Median woman' },
  { id: 'Median man', label: 'Median man', pct: 'P50', sex: 'male', pkg: 'Median man' },
] as const;
type Preset = (typeof PRESETS)[number] | (typeof MEDIANS)[number];
const STYLES: [Style, string][] = [['dressed', 'Dressed operator'], ['clay', 'Clay figure']];
const SEXES: [Sex, string][] = [['female', 'Woman'], ['male', 'Man']];
const LOADING: Record<Style, string> = { dressed: 'the dressed operator', clay: 'the clay figure' };
/** Short names of the survey's measures (ANSUR II), and the words at the two ends of their sliders. */
const L = ['shorter', 'longer'], B = ['narrower', 'wider'], G = ['slimmer', 'fuller'], H = ['lower', 'higher'], D = ['shallower', 'deeper'];
const MEASURE: Record<string, [string, string[]]> = {
  r_waistcircumference: ['Waist for this size', ['lean', 'soft']], r_sittingheight: ['Trunk length', ['long legs', 'long trunk']],
  r_acromionradialelength: ['Upper arm length', L], r_radialestylionlength: ['Forearm length', L], r_biacromialbreadth: ['Shoulder breadth (bones)', B],
  r_hipbreadthsitting: ['Hip breadth, seated', B], r_chestcircumference: ['Chest girth', G], r_buttockkneelength: ['Thigh length', L],
  r_kneeheightsitting: ['Lower leg length', L], r_bicepscircumferenceflexed: ['Upper arm girth', G], r_thighcircumference: ['Thigh girth', G],
  r_calfcircumference: ['Calf girth', G], r_neckcircumference: ['Neck girth', G], r_eyeheightsitting: ['Eye height, seated', H],
  r_acromialheight: ['Shoulder height', H], r_handlength: ['Hand length', L], r_buttockdepth: ['Buttock depth', D], r_poplitealheight: ['Under-knee height', H],
  r_lateralmalleolusheight: ['Ankle height', H], r_footlength: ['Foot length', L], r_balloffootlength: ['Heel to ball of foot', L], r_chestdepth: ['Chest depth', D],
  r_bideltoidbreadth: ['Shoulder breadth (outer)', B], r_chestbreadth: ['Chest breadth', B], r_waistbreadth: ['Waist breadth', B], r_waistdepth: ['Waist depth', D],
  r_buttockcircumference: ['Hip girth', G], r_headlength: ['Head length', L], r_headbreadth: ['Head breadth', B], r_tragiontopofhead: ['Ear to top of head', H],
  r_forearmcircumferenceflexed: ['Forearm girth', G], r_wristcircumference: ['Wrist girth', G], r_handbreadth: ['Hand breadth', B],
  r_lowerthighcircumference: ['Thigh girth above the knee', G], r_anklecircumference: ['Ankle girth', G], r_footbreadthhorizontal: ['Foot breadth', B],
};
const MAIN: Record<string, string> = { stature: 'Stature', mass: 'Weight' };
/** MP's credits line for the dressed style (assets/manikin/CREDITS.md); the licence is linked. */
const CLOTHING = ['Clothing: work shirt by Elvaerwyn and work trousers by Mindfront (MakeHuman community, ', 'CC BY 4.0', ', adapted).'];
const LICENCE = 'https://creativecommons.org/licenses/by/4.0/';
/** MP's credits line for the motion (CREDITS.md, the CMU Graphics Lab terms) */
const MOTION = ['Motion from the CMU Graphics Lab Motion Capture Database (', 'http://mocap.cs.cmu.edu/'];

const svg = (d: string) => `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
const EYE = svg('<path d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z"/><circle cx="10" cy="10" r="2.5"/>');
const EYE_OFF = svg('<path d="M3.6 6.9C2.4 8.2 1.8 10 1.8 10s3 5.4 8.2 5.4c1 0 2-.2 2.8-.5M7.7 4.9c.7-.2 1.5-.3 2.3-.3 5.2 0 8.2 5.4 8.2 5.4s-.7 1.3-2 2.7"/><path d="M3 3l14 14"/>');
const button = (cls: string | null, text: string, fn: () => void) => { const b = el('button', cls, text) as HTMLButtonElement; b.type = 'button'; b.addEventListener('click', fn); return b; };
const narrow = () => window.innerWidth < 900;
const person = () => viewerApi.person as any;
/** viewer.person.state(), or null while the person module cannot say yet (its package still loading) */
function stateNow(): any { try { return person()?.state?.() ?? null; } catch { return null; } }

// --------------------------------------------------------------------------------------------- the person's package: its controls
/** The controls, presets, tones and wardrobe of the package shown now (MV-core's definition(), read from the loaded manifest). */
function defNow(): Def | null {
  const d = person()?.definition?.(); if (!d) return null;
  return { controls: d.controls ?? [], presets: d.presets ?? [], tones: d.tones ?? [], slots: d.slots ?? [] };
}
let def: Def | null = null, defPkg = '', dressedSlots: Def['slots'] = [];
const presetOf = (id: string): Preset | undefined => [...PRESETS, ...MEDIANS].find((p) => p.id === id || p.pkg === id);

// --------------------------------------------------------------------------------------------- what the person is now
/** The dressed options, kept while the clay figure is shown (it has no tones and no wardrobe), so switching back restores them. */
let kept = { tone: '', glasses: true, headset: true };
function current(): Spec | null {
  const st = stateNow(); if (!st?.loaded) return null;
  const sx = String(st.sex ?? (/-f$/.test(st.package ?? '') ? 'f' : 'm')), sex: Sex = sx[0] === 'f' ? 'female' : 'male', style: Style = st.style === 'clay' ? 'clay' : 'dressed';
  if (style === 'dressed') kept = { tone: st.tone || kept.tone, glasses: !!st.worn?.glasses?.garment, headset: !!st.worn?.headset?.garment };
  return { sex, style, ...kept, body: { ...st.shape } };
}
/** The preset the body is at now (the three presets, then the median of its sex), or null when it was changed by hand. */
function presetNow(s: Spec): Preset | null {
  if (!def) return null;
  for (const p of [...PRESETS, ...MEDIANS]) {
    if (p.sex !== s.sex) continue;
    const v = def.presets.find((q) => q.name === p.pkg)?.values; if (!v) continue;
    if (def.controls.every((c) => Math.abs((s.body[c.id] ?? c.default) - (v[c.id] ?? c.default)) <= c.step / 2)) return p;
  }
  return null;
}
/** The preset "Back to" returns to: the one the body is at, or the last one chosen or seen, or the median of its sex. */
let base: Preset | null = null;
function baseFor(s: Spec): Preset { const p = presetNow(s); if (p) base = p; if (!base || base.sex !== s.sex) base = MEDIANS.find((m) => m.sex === s.sex)!; return base; }
function valueIn(p: Preset, id: string): number { const c = def?.controls.find((x) => x.id === id); return def?.presets.find((q) => q.name === p.pkg)?.values[id] ?? c?.default ?? 0; }

// --------------------------------------------------------------------------------------------- the adapter: here at once, and in the shared scene
/** person.set arguments as viewer.person.set (MV-core) takes them; a change of sex or style swaps the package, after which the
 *  dressed options and the body are given again so nothing is lost on the way. */
function localArgs(a: SetArgs, now: Spec): Record<string, unknown> {
  const o: Record<string, unknown> = {}, p = a.preset ? presetOf(a.preset) : undefined;
  const sex = p?.sex ?? a.sex ?? now.sex, style = a.style ?? now.style, swap = sex !== now.sex || style !== now.style;
  if (sex !== now.sex) o.sex = sex[0];
  if (style !== now.style) o.style = style;
  if (a.tone !== undefined) kept.tone = a.tone;
  if (a.glasses !== undefined) kept.glasses = a.glasses;
  if (a.headset !== undefined) kept.headset = a.headset;
  if (style === 'dressed') {
    if (a.tone !== undefined || (swap && kept.tone)) o.tone = kept.tone;
    if (a.glasses !== undefined || a.headset !== undefined || swap) {
      const slot = (id: string, on: boolean) => (on ? dressedSlots.find((s) => s.id === id)?.default ?? null : null);
      if (dressedSlots.length) o.wear = { glasses: slot('glasses', kept.glasses), headset: slot('headset', kept.headset) };
    }
  }
  if (p) o.shape = p.pkg;                                         // a package preset puts every other control back first
  else if (a.body) o.shape = a.body;
  else if (sex !== now.sex) o.shape = MEDIANS.find((m) => m.sex === sex)!.pkg;
  return o;
}
let chain: Promise<unknown> = Promise.resolve(), busy = 0, mine = 0;
/** Changes to the person, one after the other (a package swap takes a moment; nothing may overtake it). */
function queue<T>(f: () => Promise<T>): Promise<T> { const p = chain.then(f); chain = p.catch(() => undefined); return p; }
async function applyLocal(a: SetArgs) {
  const now = current(); if (!now) throw new Error('the person is not loaded');
  const o = localArgs(a, now); if (!Object.keys(o).length) return;
  const swapTo = (o.style as Style | undefined) ?? (o.sex ? now.style : null);
  busy++; mine++; if (swapTo) say(`Loading ${LOADING[swapTo]}…`); refreshBusy();
  try { await person().set(o); if (swapTo) say(null); }
  finally { busy--; mine--; refreshBusy(); await loadDef(); }
}
/** A whole person as person.set arguments (tone and wearing only for the dressed operator, as the command takes them). */
const fullArgs = (s: Spec): SetArgs => ({ sex: s.sex, style: s.style, ...(s.style === 'dressed' ? { tone: s.tone, glasses: s.glasses, headset: s.headset } : {}), body: s.body });
const applyFull = (s: Spec) => applyLocal(fullArgs(s));

/** The shared scene: null until the first answer, then whether this page's server records person changes. */
let shared: boolean | null = null, lastShared: Spec | null = null;
const random = () => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
const ME = random() + random();
async function post(body: object): Promise<any> {
  const send = (viewerApi as any).command;                       // live.ts's own sender (same author, its versions known as this page's)
  if (typeof send === 'function') return send(body);
  try { return await (await fetch('api/command', { method: 'POST', headers: { 'x-synergon': '1', 'content-type': 'application/json', 'x-synergon-client': 'person', 'x-synergon-client-id': ME }, body: JSON.stringify(body) })).json(); } catch { return null; }
}
/** Record a change in the shared scene. {ok} when it is recorded or when the page has no shared person (then it is this page's only).
 *  One at a time, and based on the page's own last change as well as on the version it started from: the page's previous change may
 *  not have come back over the live channel yet, and the stale check would otherwise refuse the next one as if someone else had
 *  changed the person. A change by someone else after the version the change started from is still refused. */
let sending: Promise<unknown> = Promise.resolve(), ownVersion = -1;
async function record(args: SetArgs, group: string, expected?: number): Promise<{ ok: boolean; error?: string }> {
  if (shared === false || !viewerApi.live()) return { ok: true };
  let release = () => {}; const prev = sending; sending = new Promise<void>((r) => { release = r; });
  await prev;
  try {
    const base = Math.max(expected ?? -1, ownVersion);
    const r = await post({ id: 'person.set', args, group, ...(base >= 0 ? { expectedVersion: base } : {}) });
    if (r?.ok) { shared = true; if (typeof r.version === 'number') ownVersion = Math.max(ownVersion, r.version); return { ok: true }; }
    if (!r || r.error?.code === 'unknown_command') { shared = false; return { ok: true }; }
    return { ok: false, error: r.error?.code === 'stale' ? 'someone else changed the person first' : r.error?.message ?? 'the server did not answer' };
  } finally { release(); }
}
interface Done { group: string; before: Spec; shared: boolean }
const undoList: Done[] = [];
interface Gesture { group: string; before: Spec; version?: number; args: SetArgs; timer: number }
let gesture: Gesture | null = null;
const liveVersion = (): number | undefined => { const v = (viewerApi.live() as any)?.version; return typeof v === 'number' ? v : undefined; };
/** One change: shown here, then recorded; refused, the person goes back to the shared state (or to where it was). */
async function commit(args: SetArgs, g?: Gesture) {
  const before = g?.before ?? current(); if (!before) return;
  const group = g?.group ?? `person-${random()}`, version = g ? g.version : liveVersion();
  try { await queue(() => applyLocal(args)); }
  catch (e) { say(`${loadingWhat(args)} could not be loaded: ${e instanceof Error ? e.message : e}`, true); refresh(); return; }
  const r = await record(args, group, version);
  if (!r.ok) { say(`Not saved: ${r.error}. The person is shown as it is for everyone.`, true); await queue(() => applyFull(lastShared ?? before)).catch(() => undefined); refresh(); return; }
  undoList.push({ group, before, shared: shared === true }); lastShared = current();
  refresh();
}
const loadingWhat = (a: SetArgs) => (a.style ? LOADING[a.style][0].toUpperCase() + LOADING[a.style].slice(1) : a.sex || a.preset ? 'The person' : 'The change');
async function undo() {
  const d = undoList.pop(); if (!d) return;
  if (d.shared) {
    // a change and its own undo cancel in the scene (shared/commands/doc.ts), so Undo after Undo works newest first; a refusal now means
    // someone else changed the person since
    await sending;
    const r = await post({ id: 'history.undo', args: { group: d.group } });
    if (r?.ok && typeof r.version === 'number') ownVersion = Math.max(ownVersion, r.version);
    if (!r?.ok) { undoList.push(d); say(`Not undone: ${r?.error?.code === 'stale' ? 'someone else changed the person since' : r?.error?.message ?? 'the server did not answer'}.`, true); refresh(); return; }
  }
  try { await queue(() => applyFull(d.before)); } catch (e) { say(`Not undone: ${e instanceof Error ? e.message : e}`, true); }
  lastShared = current(); refresh();
}
/** A slider while it moves: the person follows at once (one change in flight at a time), and the change is recorded when the slider
 *  is let go (or, for keys, after a short pause), as one change that one Undo takes back. */
let pending: Record<string, number> | null = null, previewing = false;
function slideTo(id: string, v: number) {
  if (gesture && !(id in (gesture.args.body ?? {}))) endGesture();
  if (!gesture) { const before = current(); if (!before) return; gesture = { group: `person-${random()}`, before, version: liveVersion(), args: { body: {} }, timer: 0 }; }
  gesture.args.body![id] = v; clearTimeout(gesture.timer);
  pending = { ...(pending ?? {}), [id]: v };
  if (!previewing) void (async () => { previewing = true; while (pending) { const b = pending; pending = null; await queue(() => applyLocal({ body: b })).catch(() => undefined); refreshBody(); } previewing = false; })();
}
function slideDone() { if (gesture) { clearTimeout(gesture.timer); gesture.timer = window.setTimeout(endGesture, 350); } }
function endGesture() { const g = gesture; if (!g) return; gesture = null; clearTimeout(g.timer); void commit(g.args, g); }

// --------------------------------------------------------------------------------------------- the panel
let panel: HTMLElement, statusEl: HTMLElement, whereEl: HTMLElement, undoBtn: HTMLButtonElement, hideBtn: HTMLButtonElement, bodyBox: HTMLElement, lookBox: HTMLElement;
let toneRow: HTMLElement, wearRow: HTMLElement, backBtn: HTMLButtonElement, opener: HTMLElement | null = null;
const radios: Record<string, { set: (v: string | null) => void; node: HTMLElement }> = {};
const checks: Record<string, HTMLInputElement> = {};
interface Slider { c: Control; input: HTMLInputElement; out: HTMLOutputElement; back: HTMLButtonElement; tick: HTMLElement }
let sliders: Slider[] = [];

/** A row of choices (native radio buttons, drawn as one segmented control). */
function choices(name: string, label: string, opts: [string, string, string?][], pick: (v: string) => void, wide = false) {
  const row = el('div', wide ? 'p-choice wide' : 'p-choice'), lab = el('span', 'p-lbl', label), seg = el('div', 'seg');
  lab.id = `p-${name}-lbl`; seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-labelledby', lab.id);
  for (const [value, text, sub] of opts) {
    const l = el('label'), r = el('input') as HTMLInputElement, s = el('span', 'seg-t', text);
    r.type = 'radio'; r.name = `p-${name}`; r.value = value;
    r.addEventListener('change', () => { if (r.checked) pick(value); });
    if (sub) { r.setAttribute('aria-label', `${text}, ${sub}`); l.append(r, s, el('small', null, sub)); } else l.append(r, s);
    seg.append(l);
  }
  row.append(lab, seg);
  radios[name] = { node: row, set: (v) => { for (const r of seg.querySelectorAll('input')) (r as HTMLInputElement).checked = (r as HTMLInputElement).value === v; } };
  return row;
}
function check(id: string, label: string, pick: (on: boolean) => void) {
  const l = el('label', 'check'), r = el('input') as HTMLInputElement; r.type = 'checkbox'; r.id = `p-${id}`;
  r.addEventListener('change', () => pick(r.checked)); l.append(r, document.createTextNode(label)); checks[id] = r; return l;
}
const fmt = (c: Control, v: number) => (c.unit === 'mm' ? `${(v / 10).toFixed(1)} cm` : c.unit === 'kg' ? `${v.toFixed(1)} kg` : Math.abs(v) < c.step / 2 ? 'typical' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} SD`);
const endWord = (c: Control, hi: boolean) => (c.unit === 'mm' ? `${Math.round(c[hi ? 'max' : 'min'] / 10)} cm` : c.unit === 'kg' ? `${Math.round(c[hi ? 'max' : 'min'])} kg` : MEASURE[c.id]?.[1][hi ? 1 : 0] ?? (hi ? 'more' : 'less'));
const nameOf = (c: Control) => MAIN[c.id] ?? MEASURE[c.id]?.[0] ?? c.label.replace(/\s*\(SD.*$/, '');
function slider(c: Control): HTMLElement {
  const box = el('div', 'adj'), top = el('div', 'adj-top'), id = `p-${c.id}`;
  const label = el('label', null, nameOf(c)) as HTMLLabelElement; label.htmlFor = id;
  if (c.id.startsWith('r_')) label.title = `Survey measure (ANSUR II): ${c.id.slice(2)}`;
  const out = el('output') as HTMLOutputElement, back = button('back', '↺', () => { const s = current(); if (s) void commit({ body: { [c.id]: valueIn(baseFor(s), c.id) } }); });
  back.title = 'Back to the preset’s value';
  top.append(label, out, back);
  const track = el('div', 'track'), rng = el('div', 'rng'), s = el('input') as HTMLInputElement, tick = el('i', 'tick');
  s.type = 'range'; s.id = id; s.min = String(c.min); s.max = String(c.max); s.step = String(c.step);
  s.addEventListener('input', () => slideTo(c.id, Number(s.value)));
  s.addEventListener('change', slideDone);
  tick.title = 'the preset’s value';
  rng.append(s, tick); track.append(el('span', 'end', endWord(c, false)), rng, el('span', 'end', endWord(c, true))); box.append(top, track);
  sliders.push({ c, input: s, out, back, tick });
  return box;
}
/** The body block for the current package (its controls and their ranges depend on the sex). */
function buildBody() {
  bodyBox.textContent = ''; sliders = [];
  const head = el('div', 'adj-head');
  backBtn = button('photo', 'Back to the preset', () => { const s = current(); if (s) void commit({ preset: baseFor(s).id }); });
  head.append(el('h3', null, 'Body'), backBtn); bodyBox.append(head);
  if (!def) { bodyBox.append(el('p', 'muted', 'Loading the body measurements…')); return; }
  for (const c of def.controls.filter((x) => x.group === 'Main' || MAIN[x.id])) bodyBox.append(slider(c));
  const more = el('details', 'fine p-more') as HTMLDetailsElement; more.append(el('summary', null, 'More measurements'));
  more.append(el('p', 'muted', 'Each one moves a measure away from what is typical for this stature and weight, in standard deviations (SD) of the ANSUR II survey. The figure after it is the measure that results.'));
  const groups = [...new Set(def.controls.filter((c) => c.group !== 'Main' && !MAIN[c.id]).map((c) => c.group))];
  // built when first opened: 36 sliders the page need not lay out until someone asks for them
  more.addEventListener('toggle', () => {
    if (!more.open || more.dataset.built) return; more.dataset.built = '1';
    for (const g of groups) {
      const sec = el('div', 'sec'); sec.append(el('h4', null, g === 'Fine measurements' ? 'Finer measures' : g));
      for (const c of def!.controls.filter((x) => x.group === g)) sec.append(slider(c));
      more.append(sec);
    }
    refreshBody();
  });
  bodyBox.append(more);
}
function buildPanel() {
  panel = el('aside', 'ui'); panel.id = 'person'; panel.hidden = true; panel.setAttribute('aria-labelledby', 'person-title');
  const head = el('header'), h = el('h2', null, 'Person'), x = button('x', '×', () => closePanel(true));
  h.id = 'person-title'; h.tabIndex = -1; x.setAttribute('aria-label', 'Close'); x.title = 'Close (Esc)';
  head.append(h, x);
  whereEl = el('p', 'where'); statusEl = el('p', 'p-status'); statusEl.setAttribute('role', 'status'); statusEl.hidden = true;
  const acts = el('div', 'acts');
  hideBtn = button(null, 'Hide', () => void toggleShown()); hideBtn.title = 'Hide or show the person (this browser only)';
  undoBtn = button(null, 'Undo', () => void undo()); undoBtn.title = 'Take back your last change to the person';
  acts.append(hideBtn, undoBtn);
  const who = el('section', 'p-sec');
  who.append(el('h3', null, 'Who'), choices('preset', 'Preset', PRESETS.map((p) => [p.id, p.label, p.pct]), (v) => void commit({ preset: v }), true),
    choices('sex', 'Sex', SEXES, (v) => void commit({ sex: v as Sex })));
  bodyBox = el('section', 'adjust p-body');
  lookBox = el('section', 'p-sec');
  toneRow = el('div'); wearRow = el('div', 'p-choice');
  const wear = el('div', 'p-wear'); wear.append(check('glasses', 'Glasses', (on) => void commit({ glasses: on })), check('headset', 'Headset', (on) => void commit({ headset: on })));
  const wl = el('span', 'p-lbl', 'Wearing'); wearRow.append(wl, wear);
  lookBox.append(el('h3', null, 'Look'), choices('style', 'Style', STYLES, (v) => void commit({ style: v as Style })), toneRow, wearRow);
  panel.append(head, whereEl, statusEl, acts, who, bodyBox, lookBox);
  $('stage').append(panel);
  buildBody();
}
function buildTone() {
  toneRow.textContent = '';
  const tones = def?.tones?.length ? def.tones : [];
  if (tones.length) toneRow.append(choices('tone', 'Skin tone', tones.map((t) => [t.id, t.label]), (v) => void commit({ tone: v })));
}
/** The credits line: MP's words, the licence linked. */
function credit(cls: string): HTMLElement {
  const p = el('p', cls), a = el('a', null, CLOTHING[1]) as HTMLAnchorElement;
  a.href = LICENCE; a.target = '_blank'; a.rel = 'noopener';
  p.append(document.createTextNode(CLOTHING[0]), a, document.createTextNode(CLOTHING[2]));
  return p;
}

// --------------------------------------------------------------------------------------------- showing the state
function say(text: string | null, error = false) { if (!statusEl) return; statusEl.hidden = !text; statusEl.textContent = text ?? ''; statusEl.classList.toggle('amber', error); }
function refreshBusy() { if (panel) panel.setAttribute('aria-busy', String(busy > 0)); }
/** After the package changed (another sex or style): its controls, ranges and tones. */
async function loadDef() {
  const st = stateNow(); if (!st?.loaded || !st.package || (st.package === defPkg && def)) return;
  const d = defNow(); if (!d) return;
  def = d; defPkg = st.package; if (d.slots.length) dressedSlots = d.slots;
  if (panel) { buildBody(); buildTone(); }
  refresh();
}
function refreshBody() {
  const s = current(); if (!s || !def) return;
  const p = baseFor(s), st = stateNow() ?? {}, at = presetNow(s);
  for (const k of sliders) {
    const v = s.body[k.c.id] ?? k.c.default, home = valueIn(p, k.c.id), m = st.measures?.[k.c.id.replace(/^r_/, '')];
    if (!(gesture && k.c.id in (gesture.args.body ?? {}))) k.input.value = String(v);      // not under the pointer while it is dragged
    const txt = fmt(k.c, v) + (k.c.id.startsWith('r_') && typeof m === 'number' ? ` · ${Math.round(m)} mm` : '');
    k.out.textContent = txt; k.input.setAttribute('aria-valuetext', txt);
    k.back.classList.toggle('idle', Math.abs(v - home) <= k.c.step / 2); k.back.setAttribute('aria-label', `${nameOf(k.c)}: back to ${p.label}`);
    k.tick.style.setProperty('--at', String((home - k.c.min) / (k.c.max - k.c.min)));
  }
  if (backBtn) { backBtn.textContent = `Back to ${p.label.toLowerCase()}`; backBtn.hidden = !!at; backBtn.title = `Put the body back to the ${p.label.toLowerCase()} (${p.pct})`; }
}
function refresh() {
  updateRow(); updateCredit();
  if (!panel) return;
  const st = stateNow(); if (!st) return;                         // the person module cannot say just now: keep what is shown
  const s = current();
  if (!st.loaded || !s) {
    whereEl.textContent = st?.error ? 'The person could not be loaded.' : 'Loading the person…';
    if (st?.error) say(`The person could not be shown: ${st.error}`, true);
    for (const n of panel.querySelectorAll('.acts, .p-sec, .p-body')) (n as HTMLElement).hidden = true;
    return;
  }
  for (const n of panel.querySelectorAll('.acts, .p-sec, .p-body')) (n as HTMLElement).hidden = false;
  const at = presetNow(s), b = baseFor(s);
  whereEl.textContent = `${at ? `${at.label} (${at.pct})` : `Changed from ${b.label.toLowerCase()} (${b.pct})`} · ${STYLES.find((x) => x[0] === s.style)![1]}`;
  radios.preset?.set(at && PRESETS.some((p) => p.id === at.id) ? at.id : null);
  radios.sex?.set(s.sex); radios.style?.set(s.style); radios.tone?.set(s.tone);
  toneRow.hidden = s.style !== 'dressed' || !toneRow.childElementCount; wearRow.hidden = s.style !== 'dressed';
  if (checks.glasses) { checks.glasses.checked = s.glasses; checks.headset.checked = s.headset; }
  undoBtn.disabled = !undoList.length || busy > 0;
  hideBtn.textContent = st.shown ? 'Hide' : 'Show';
  refreshBody();
  fitSheet();
}

// --------------------------------------------------------------------------------------------- the row in the parts list, the credit on the view
let row: { box: HTMLElement; eye: HTMLButtonElement; name: HTMLButtonElement; tag: HTMLElement } | null = null;
function buildRow() {
  const group = el('div', 'group person-group'), box = el('div', 'row top person-row');
  const eye = button('eye', '', () => void toggleShown()), name = button('name', '', () => (panel.hidden ? openPanel(name) : closePanel(true)));
  const tag = el('span', 'count');
  name.append(el('span', 'label', 'Person'), tag); name.setAttribute('aria-controls', 'person'); name.setAttribute('aria-expanded', 'false');
  box.append(eye, name); group.append(box); $('tree').append(group);
  row = { box, eye, name, tag };
}
function updateRow() {
  if (!row) return;
  const st = stateNow(), shown = !!st?.shown;
  row.eye.innerHTML = shown ? EYE : EYE_OFF; row.eye.setAttribute('aria-pressed', String(shown));
  row.eye.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} the person`); row.eye.title = shown ? 'Hide' : 'Show';
  row.box.classList.toggle('off', !!st?.loaded && !shown); row.box.classList.toggle('sel', !!panel && !panel.hidden);
  row.tag.textContent = st?.error ? 'not loaded' : !st?.loaded ? 'loading' : '';
  row.name.setAttribute('aria-expanded', String(!!panel && !panel.hidden));
}
let viewCredit: HTMLElement;
function updateCredit() {
  const st = stateNow(), on = !!st?.loaded && !!st.shown && st.style !== 'clay';
  viewCredit.hidden = !on; document.body.classList.toggle('has-credit', on);
}
async function toggleShown() { const st = stateNow(); if (!st?.loaded) return; await person().show(!st.shown); if (panel && !panel.hidden) outline(true); refresh(); }

// --------------------------------------------------------------------------------------------- open, close, select
function openPanel(from: HTMLElement | null = null) {
  if (!panel) return;
  if (S.selected) select(null);                                  // the part card closes: one panel at a time
  opener = from; panel.hidden = false; document.body.classList.add('has-person');
  if (narrow()) { document.body.classList.remove('parts-open'); $('scrim').hidden = true; $('open-parts').setAttribute('aria-expanded', 'false'); }
  outline(true); refresh();
  if (from) ($('person-title') as HTMLElement).focus();
}
function closePanel(restoreFocus = false) {
  if (!panel || panel.hidden) return;
  if (gesture) endGesture();
  panel.hidden = true; document.body.classList.remove('has-person'); outline(false); fitSheet(); refresh();
  if (restoreFocus && opener?.isConnected) opener.focus();
  opener = null;
}
const holder = (): THREE.Object3D | null => person()?.object?.() ?? scene.getObjectByName('person') ?? null;
function outline(on: boolean) { const g = holder(); outlineExtra(on && g && stateNow()?.shown ? g : null); }
/** On a narrow window the panel is a bottom sheet and the 3D view ends where it begins (as for the part card, ui.ts). */
let sheet = 0;
function fitSheet() {
  const h = panel && !panel.hidden && narrow() && !document.body.classList.contains('no-ui') ? panel.offsetHeight : 0;
  if (h === sheet) return;
  const h0 = frameSize().h; sheet = h; stageEl.style.setProperty('--sheet', `${h}px`); layout(); rescaleView(frameSize().h / h0);
}
/** Distance from the camera to the person under a pixel of the 3D view (Infinity when there is none), on the posed meshes. */
let pickMs = 0, stale = false;
function personAt(x: number, y: number): number {
  const g = holder(); if (!g || !stateNow()?.shown) return Infinity;
  const t0 = performance.now();
  // After a change (viewer.person.set) the skeleton stays in its rest pose, standing, until the next drawn frame solves the seated
  // pose again (20 to 40 ms); a pick in that gap finds a standing person. Draw that frame first.
  if (stale) drawNow();
  const hit = person().pickAt?.(x, y) ?? null;
  pickMs = performance.now() - t0;
  return hit ? hit.distance : Infinity;
}
/** interact.ts asks before it picks the rig: a click on the person (nearer than the rig there) is the person's. */
const rigAt = (x: number, y: number) => pickAt(x, y)?.world.distanceTo(currentCamera().position) ?? Infinity;
function onClick(x: number, y: number, rig: number): boolean {
  if (personAt(x, y) < rig) { openPanel(); return true; }
  closePanel();
  return false;
}

/** Pointing at the person: once the pointer rests (a pick of the posed person costs a few milliseconds, too much for every move),
 *  the tip names the person instead of the rig part behind it. */
let rest = 0;
function onPoint(e: PointerEvent) {
  clearTimeout(rest);
  if (e.buttons || e.pointerType === 'touch' || canvas.style.cursor === 'move') return;
  const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  rest = window.setTimeout(() => {
    if (canvas.style.cursor === 'move' || personAt(x, y) >= rigAt(x, y)) return;
    const tip = $('tip'), st = stageEl.getBoundingClientRect();
    setHover(null); canvas.style.cursor = 'pointer';
    tip.textContent = 'Person · adjustable'; tip.hidden = false;
    tip.style.left = `${Math.max(4, Math.min(e.clientX - st.left + 14, st.width - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(4, Math.min(e.clientY - st.top + 16, st.height - tip.offsetHeight - 4))}px`;
  }, 120);
}

// --------------------------------------------------------------------------------------------- More: Credits
/** CREDITS.md as a page: headings, paragraphs, quotes, and each table row as a short list (the tables are too wide for a panel). */
function creditsPage(md: string): DocumentFragment {
  const f = document.createDocumentFragment(), lines = md.split('\n');
  const inline = (s: string): Node[] => {
    const out: Node[] = []; let last = 0;
    for (const m of s.matchAll(/<(https?:\/\/[^>\s]+)>|`([^`]+)`|\*\*([^*]+)\*\*/g)) {
      if (m.index! > last) out.push(document.createTextNode(s.slice(last, m.index)));
      if (m[1]) { const a = el('a', null, m[1].replace(/^https?:\/\//, '').replace(/\/$/, '')) as HTMLAnchorElement; a.href = m[1]; a.target = '_blank'; a.rel = 'noopener'; out.push(a); }
      else if (m[2]) out.push(el('code', null, m[2])); else out.push(el('b', null, m[3]));
      last = m.index! + m[0].length;
    }
    if (last < s.length) out.push(document.createTextNode(s.slice(last)));
    return out;
  };
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^# /.test(l)) { i++; while (i < lines.length && !/^## /.test(lines[i])) i++; continue; }   // the title and the note on the repository's layout: the dialog has its own
    if (/^#{2,} /.test(l)) { f.append(el('h4', null, l.replace(/^#+ /, ''))); i++; continue; }
    if (l.startsWith('|')) {
      const head = cells(l); i += 2;
      while (i < lines.length && lines[i].startsWith('|')) {
        const c = cells(lines[i++]), item = el('div', 'cr-item'), dl = el('dl');
        item.append(el('b', null, c[0]));
        head.slice(1).forEach((hd, k) => { if (!c[k + 1]) return; const dd = el('dd'); dd.append(...inline(c[k + 1])); dl.append(el('dt', null, hd), dd); });
        item.append(dl); f.append(item);
      }
      continue;
    }
    const quote = l.startsWith('>'), buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('|') && !/^#/.test(lines[i]) && lines[i].startsWith('>') === quote) buf.push(lines[i++].replace(/^>\s?/, '').trim());
    const p = el(quote ? 'blockquote' : 'p'); p.append(...inline(buf.join(' '))); f.append(p);
  }
  return f;
}
let creditsBox: HTMLElement | null = null, creditsFrom: HTMLElement | null = null;
function openCredits(from: HTMLElement | null) {
  if (!creditsBox) {
    creditsBox = el('div', 'ui credits'); creditsBox.id = 'credits'; creditsBox.setAttribute('role', 'dialog'); creditsBox.setAttribute('aria-labelledby', 'credits-title');
    const head = el('div', 'tr-head'), h = el('h3', null, 'Credits'), x = button('x', '×', closeCredits);
    h.id = 'credits-title'; x.setAttribute('aria-label', 'Close'); x.title = 'Close (Esc)';
    head.append(h, x);
    const body = el('div', 'cr-body');
    const lead = el('div', 'cr-lead'); lead.append(el('p', null, 'The person in this viewer is built from open assets. Wherever the dressed operator is shown, its clothing is credited, and its movements come from motion capture:'));
    const motion = el('p', 'cr-line'), cmu = el('a', null, 'mocap.cs.cmu.edu') as HTMLAnchorElement; cmu.href = MOTION[1]; cmu.target = '_blank'; cmu.rel = 'noopener';
    motion.append(document.createTextNode(MOTION[0]), cmu, document.createTextNode(').'));
    lead.append(credit('cr-line'), motion);
    body.append(lead, creditsPage(CREDITS));
    creditsBox.append(head, body); $('stage').append(creditsBox);
  }
  creditsFrom = from; creditsBox.hidden = false;
  const more = $('more'); more.hidden = true; $('more-btn').setAttribute('aria-expanded', 'false'); $('more-btn').classList.remove('on');
  (creditsBox.querySelector('.x') as HTMLElement).focus();
}
function closeCredits() { if (!creditsBox || creditsBox.hidden) return; creditsBox.hidden = true; if (creditsFrom?.isConnected) creditsFrom.focus(); else ($('more-btn') as HTMLElement).focus(); }
function addCreditsToMore() {
  const about = $('more').querySelector('.about'); if (!about) return;
  const b = button('link cr-open', 'Credits', () => openCredits($('more-btn'))); b.title = 'Who made the person’s body, clothing and motion, and under which licences';
  const doc = about.querySelector('a'); (doc ?? about).after(document.createTextNode(' · '), b);
}

// --------------------------------------------------------------------------------------------- start
export async function initPersonPanel() {
  const started = initPerson();
  // viewer.person exists as soon as the person module knows this release has a person (before the package has loaded)
  let settled = false; void started.finally(() => { settled = true; });
  while (!viewerApi.person && !settled) await new Promise((r) => setTimeout(r, 30));
  if (!viewerApi.person) return;                                 // no person in this release: no row, no panel
  viewCredit = credit('ui person-credit'); viewCredit.id = 'person-credit'; viewCredit.hidden = true; $('frame').append(viewCredit);
  buildRow(); buildPanel(); addCreditsToMore(); refresh();
  hooks.click.push(onClick);
  hooks.beforeRender.push(() => { stale = false; });            // after the person module's own hook, which poses the person
  canvas.addEventListener('pointermove', onPoint); canvas.addEventListener('pointerleave', () => clearTimeout(rest)); canvas.addEventListener('pointerdown', () => clearTimeout(rest));
  pictureCredits.push(() => (viewCredit.hidden ? null : CLOTHING.join('')));
  on((c) => { if (c === 'selection' && S.selected) closePanel(); });
  addEventListener('synergon:person', () => { stale = true; if (!mine) { lastShared = current(); void loadDef(); } refresh(); if (panel && !panel.hidden) outline(true); });
  addEventListener('resize', fitSheet);
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (creditsBox && !creditsBox.hidden) { closeCredits(); e.stopImmediatePropagation(); return; }
    if (panel.hidden || !$('more').hidden || document.body.classList.contains('parts-open')) return;
    closePanel(true);
  }, true);
  (viewerApi as any).personPanel = { open: () => openPanel(), close: () => closePanel(), credits: () => openCredits(null), covers: (x: number, y: number) => personAt(x, y) < rigAt(x, y), state: () => ({ open: !panel.hidden, shared, undo: undoList.length, busy, pick_ms: +pickMs.toFixed(2), credit: !viewCredit.hidden, spec: current() }) };
  const ok = await person().ready;
  if (ok) { lastShared = current(); await loadDef(); }
  refresh();
}
