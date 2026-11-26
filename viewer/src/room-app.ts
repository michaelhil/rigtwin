// Local room editor. The same command endpoint and event stream serve the UI and remote clients.
import { h, link } from './dom.ts';
import { ask } from './dialog.ts';
import { action, brand, displayNumber, field, icon, iconAction, numberForm, section, select, store, stored, wirePanel, type Drafts, type Glyph } from './room-controls.ts';
import { mountRoomView } from './room-view.ts';
import type { RoomInstance, RoomJoint, RoomPoint, RoomRef, RoomRelease, RoomScene } from '../../shared/room.ts';
import { AIM_LIMBS, type PersonAims } from '../../shared/person-aims.ts';

type Workspace = Pick<RoomScene, 'id' | 'name'>;
type Args = Record<string, unknown>;
interface Receipt<T> { ok: boolean; version: number; recorded: number | null; result: T }
interface Distance { metres: number; from: { point: RoomPoint }; to: { point: RoomPoint } }
interface Span { metres: number; edges: [string, string] }
interface Clearance extends Span { opening: Span }
const roomURL = (id: string) => '/workspaces/' + encodeURIComponent(id);
const apiRoot = (id: string) => '/api' + roomURL(id);
const shortRelease = (release: RoomRelease) => release.label + ' · v' + release.version;
const distanceFormat = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false });
const metres = (n: number) => distanceFormat.format(n) + ' m';

class RoomApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(url: string, body?: Args): Promise<T> {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Synergon': '1', 'X-Synergon-Client': 'person' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok === false || json === null) {
    const error = json?.error;
    throw new RoomApiError([error?.message || 'The server could not complete the request.', error?.hint].filter(Boolean).join(' '), response.status);
  }
  return json as T;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function directories() {
  const workspaces: Workspace[] = [], seen = new Set<string>();
  let cursor = '';
  for (;;) {
    const params = new URLSearchParams({ limit: '50' }); if (cursor) params.set('cursor', cursor);
    const page = await request<{ workspaces: Workspace[]; next?: string | null }>('/api/workspaces?' + params);
    workspaces.push(...page.workspaces);
    if (!page.next || seen.has(page.next)) break;
    cursor = page.next; seen.add(cursor);
  }
  return workspaces;
}
async function createRoom() {
  await ask({
    title: 'New workspace', field: { label: 'Workspace name', max: 80, placeholder: 'e.g. Control room' }, confirm: 'Create empty room',
    run: async name => {
      try { const ws = await request<Workspace>('/api/workspaces', { name: name.trim() || 'Untitled room', template: 'empty' }); location.assign(roomURL(ws.id)); return null; }
      catch (error) { return errorText(error); }
    },
  });
}
function directory(workspaces: Workspace[], message = '') {
  document.title = 'Room workspaces · Synergon';
  const list = h('div', 'rm-directory-list');
  for (const ws of workspaces) {
    const row = link('', roomURL(ws.id), 'rm-directory-row'); row.append(icon('room'), h('span', null, ws.name), icon('next')); list.append(row);
  }
  if (!workspaces.length) list.append(h('p', 'rm-help', 'Create a workspace to start with an empty room.'));
  document.body.replaceChildren(h('main', 'rm-directory', brand(), h('div', 'rm-directory-main',
    h('h1', null, 'Room workspaces'), message && h('p', 'rm-error', message),
    action('New workspace', () => void createRoom(), 'plus', 'rm-primary'), list)));
}
export async function startRoomApp() {
  document.body.className = 'room-app'; document.documentElement.classList.remove('page');
  const path = location.pathname.replace(/\/+$/, '');
  let id = '';
  document.body.replaceChildren(h('main', 'rm-loading', brand(), h('p', null, 'Opening workspace…')));
  try {
    id = path.startsWith('/workspaces/') ? decodeURIComponent(path.slice('/workspaces/'.length)) : '';
    if (!id) {
      const all = await directories();
      if (!new URLSearchParams(location.search).has('list')) {
        let recent: string[] = [];
        try { recent = JSON.parse(stored('synergon.roomRecents') || '[]'); } catch { /* corrupt browser storage */ }
        for (const key of Array.isArray(recent) ? recent : []) {
          if (!all.some(ws => ws.id === key)) continue;
          try {
            await request<RoomScene>(apiRoot(key) + '/state');
            location.replace(roomURL(key)); return;
          } catch (error) {
            // A listed workspace can require a release that is no longer installed.
            if (!(error instanceof RoomApiError) || ![404, 422].includes(error.status)) throw error;
          }
        }
      }
      directory(all); return;
    }
    const [scene, { releases }] = await Promise.all([request<RoomScene>(apiRoot(id) + '/state'), request<{ releases: RoomRelease[] }>('/api/catalog')]);
    let recents: unknown = []; try { recents = JSON.parse(stored('synergon.roomRecents') || '[]'); } catch { /* ignore */ }
    store('synergon.roomRecents', JSON.stringify([scene.id, ...(Array.isArray(recents) ? recents.filter(x => typeof x === 'string' && x !== scene.id) : [])].slice(0, 12)));
    editor(scene, releases);
  } catch (error) {
    if (id && error instanceof RoomApiError && error.status === 404) {
      try { directory(await directories(), 'This room could not be found. Choose another workspace or create a room.'); return; } catch { /* show retry */ }
    }
    document.body.replaceChildren(h('main', 'rm-directory', brand(), h('div', 'rm-directory-main', h('h1', null, 'Workspace unavailable'),
      h('p', 'rm-error', errorText(error)), action('Try again', () => location.reload()), link('Browse workspaces', '/workspaces?list=1', 'rm-link'))));
  }
}

/** Choose an unoccupied starting position inside the room when space permits. Placement remains editable. */
function initialPlacement(scene: RoomScene, asset: RoomRelease, releases: Map<string, RoomRelease>) {
  const { width, depth } = scene.room;
  const bounds = (item: RoomInstance) => {
    const footprint = releases.get(item.release)?.footprint;
    if (!footprint) return [item.x, item.y, item.x, item.y];
    const angle = item.yaw * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const corners = [footprint.min[0], footprint.max[0]].flatMap(x => [footprint.min[1], footprint.max[1]].map(y => [item.x + x * cos - y * sin, item.y + x * sin + y * cos]));
    return [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))];
  };
  const boxes = scene.instances.map(bounds), { min, max } = asset.footprint;
  for (const fy of [.55, .3, .75, .15, .9]) for (const fx of [.35, .65, .5, .18, .82]) {
    const x = Number((width * fx).toFixed(2)), y = Number((depth * fy).toFixed(2));
    const west = x + min[0], east = x + max[0], south = y + min[1], north = y + max[1];
    if (west < 0 || east > width || south < 0 || north > depth) continue;
    if (boxes.every(([w, s, e, n]) => east + .15 < w || west - .15 > e || north + .15 < s || south - .15 > n)) return { x, y };
  }
  return { x: width / 2, y: depth / 2 };
}

function editor(first: RoomScene, releases: RoomRelease[]) {
  let scene = first, selected: string | null = null, member = '', tab: 'layout' | 'measure' = 'layout', library = false;
  let mode: 'plan' | '3d' = 'plan', measurementToken = 0, chosenRelease = releases[0]?.id ?? '', newLabel = '';
  let undoable = scene.version > 0, undoToken = 0, addId = '';
  const api = apiRoot(scene.id), byRelease = new Map(releases.map(r => [r.id, r]));
  const drafts: Drafts = new Map(), expanded = new Set<string>(), chosenJoints = new Map<string, string>();
  const from: RoomRef = { instance: '', member: 'floor' }, to: RoomRef = { instance: '', member: 'floor' };
  const current = () => scene.instances.find(i => i.id === selected);
  const pane = h('aside', 'rm-panel'); pane.id = 'room-controls'; pane.setAttribute('aria-label', 'Workspace panel');
  const hide = iconAction('Collapse panel', () => {}, 'collapse'), open = iconAction('Open workspace panel', () => {}, 'expand');
  open.classList.add('rm-reopen'); open.setAttribute('aria-controls', pane.id);
  const resize = h('div', 'rm-grip'), railTop = h('div', 'rm-brand-row', brand(), hide);
  const wsLink = link('', '/workspaces?list=1', 'rm-workspace-link');
  wsLink.title = 'Browse workspaces'; wsLink.append(h('span', null, scene.name), icon('chevron'));
  const title = h('div', 'rm-workspace', h('div', 'rm-kicker', 'Workspace'), wsLink);
  const scroll = h('div', 'rm-scroll'), stage = h('div', 'room-viewport'), live = h('span', 'rm-live', 'Connecting');
  const stageTitle = h('h1', 'rm-stage-title', 'Floor plan'), stageSize = h('p', 'rm-stage-size');
  const viewHelp = h('span', 'rm-view-help');
  const stageHead = h('header', 'rm-stage-head', h('div', null, stageTitle, stageSize));
  const versionText = h('span', 'rm-version');
  const stageFoot = h('footer', 'rm-stage-foot', viewHelp, h('div', 'rm-status', live, versionText));
  const notice = h('div', 'rm-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
  const drawing = h('main', 'rm-drawing', stageHead, stage, stageFoot, notice);
  const tabs = h('div', 'rm-tabs');
  const layoutTab = action('Layout', () => changeTab('layout'), 'layers'), measureTab = action('Measure', () => changeTab('measure'), 'measure');
  tabs.append(layoutTab, measureTab);
  const plan = action('Plan', () => setMode('plan'), 'plan'), three = action('3D', () => setMode('3d'), 'cube');
  const fit = iconAction('Fit room to view', () => view.fit(), 'fit');
  const undo = iconAction('Undo latest change', () => void write('undo', {}), 'undo');
  pane.append(railTop, title, tabs, scroll, h('footer', 'rm-panel-foot', h('div', 'rm-view-switch', plan, three), fit, undo));
  const shell = h('div', 'rm-shell', pane, resize, drawing, open); document.body.replaceChildren(shell);
  wirePanel(shell, pane, resize, open, hide);
  let placementVersion = scene.version;
  const view = mountRoomView(stage, {
    onSelect: (id, part) => { choose(id, part); },
    onPlace: (id, placement) => { void write('instances.move', { instance: id, ...placement }, placementVersion).then(ok => { if (!ok) view.setScene(scene, releases); }); },
    onError: message => tell(message, true),
  });
  stage.addEventListener('pointerdown', () => { placementVersion = scene.version; }, true);
  async function setMode(next: typeof mode) {
    await view.setView(next);
    mode = view.getView(); stageTitle.textContent = mode === 'plan' ? 'Floor plan' : '3D view';
    plan.setAttribute('aria-pressed', String(mode === 'plan')); three.setAttribute('aria-pressed', String(mode === '3d'));
    viewHelp.textContent = mode === 'plan' ? 'Drag to place or pan · Scroll to zoom' : 'Drag to orbit · Scroll to zoom';
  }
  function changeTab(next: typeof tab) { tab = next; library = false; renderPanel(); }
  function choose(id: string | null, part = '') {
    selected = id; member = part;
    if (part) expanded.add(id + '/components');
    if (tab === 'layout') library = false;
    view.select(selected, member || undefined); renderPanel();
  }
  function tell(message: string, error = false) {
    notice.classList.toggle('rm-error', error); notice.setAttribute('role', error ? 'alert' : 'status');
    notice.replaceChildren(h('span', null, message), iconAction('Dismiss message', () => { notice.hidden = true; }, 'close'));
    notice.hidden = false;
  }
  function command<T>(id: string, args: Args, expectedVersion?: number) {
    return request<Receipt<T>>(api + '/command', { id, args, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
  }
  async function write(id: string, args: Args, base = scene.version) {
    try {
      const reply = await command(id, args, base);
      if (reply.version > scene.version) accept(await request<RoomScene>(api + '/state'));
      notice.hidden = true;
      return true;
    } catch (error) { tell(errorText(error), true); return false; }
  }
  function accept(next: RoomScene) {
    if (next.id !== scene.id || next.version <= scene.version) return;
    scene = next;
    if (selected && !current()) { selected = null; member = ''; }
    if (member && current() && !byRelease.get(current()!.release)?.members.some(m => m.id === member)) member = '';
    view.setScene(scene, releases); view.select(selected, member || undefined); renderPanel(); void updateUndo();
  }
  async function updateUndo() {
    const n = ++undoToken, v = scene.version;
    if (!v) { undo.disabled = true; return; }
    try {
      const r = await command<{ undoable: number[] }>('state', {});
      if (n === undoToken && r.version === scene.version) { undoable = r.result.undoable.length > 0; undo.disabled = !undoable; }
    } catch { /* undo remains available if the server is reconnecting */ }
  }
  const stream = new EventSource(api + '/live');
  stream.addEventListener('snapshot', event => {
    try { accept(JSON.parse((event as MessageEvent<string>).data) as RoomScene); }
    catch (error) { tell('Could not read the latest layout. ' + errorText(error), true); }
  });
  stream.onopen = () => { live.textContent = 'Live'; live.classList.add('rm-connected'); };
  stream.onerror = () => { live.textContent = 'Reconnecting'; live.classList.remove('rm-connected'); };
  window.addEventListener('pagehide', event => { if (!event.persisted) { stream.close(); view.dispose(); } });
  window.addEventListener('keydown', e => {
    if (e.defaultPrevented || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (!undo.disabled) undo.click(); }
  });
  function details(key: string, label: string, children: Node[], hint?: string) {
    const box = h('details', 'rm-disclosure', h('summary', null, h('span', null, label), hint && h('small', null, hint), icon('chevron')), h('div', 'rm-disclosure-body', ...children));
    box.open = expanded.has(key);
    box.addEventListener('toggle', () => {
      if (box.isConnected) { if (box.open) expanded.add(key); else expanded.delete(key); }
    });
    return box;
  }
  function renderPanel() {
    const position = scroll.scrollTop, focus = (document.activeElement as HTMLElement | null)?.dataset.focus;
    layoutTab.setAttribute('aria-pressed', String(tab === 'layout')); measureTab.setAttribute('aria-pressed', String(tab === 'measure'));
    undo.disabled = !undoable || !scene.version;
    stageSize.textContent = displayNumber(scene.room.width) + ' × ' + displayNumber(scene.room.depth) + ' m';
    versionText.textContent = 'Revision ' + scene.version; document.title = scene.name + ' · Synergon';
    wsLink.querySelector('span')!.textContent = scene.name;
    view.setMeasurement(null); ++measurementToken;
    if (tab === 'measure') scroll.replaceChildren(measurePanel());
    else if (library) scroll.replaceChildren(libraryPanel());
    else {
      const rows = h('div', 'rm-object-list');
      rows.append(objectRow('room', 'Room envelope', '', selected === null, () => choose(null)));
      for (const item of scene.instances) {
        const asset = byRelease.get(item.release);
        rows.append(objectRow(asset?.kind ?? 'display', item.label, asset?.label ?? '', selected === item.id, () => choose(item.id)));
      }
      const add = action('Add object', () => { addId = ''; library = true; renderPanel(); }, 'plus', 'rm-primary rm-wide');
      const list = section('Scene objects', rows, add);
      const item = current(), release = item && byRelease.get(item.release);
      scroll.replaceChildren(list, ...(item && release ? inspect(item, release) : roomProperties()));
    }
    scroll.scrollTop = position;
    if (focus) [...scroll.querySelectorAll<HTMLElement>('[data-focus]')].find(el => el.dataset.focus === focus)?.focus({ preventScroll: true });
  }
  function objectRow(glyph: Glyph, name: string, info: string, active: boolean, run: () => void) {
    const btn = action(name, run, glyph, 'rm-object-row'); btn.setAttribute('aria-pressed', String(active));
    if (info) { btn.title = info; }
    if (active) btn.append(h('i', 'rm-selected-dot')); return btn;
  }
  function libraryPanel() {
    const panel = h('div', 'rm-section');
    panel.append(h('div', 'rm-section-head', h('h2', 'rm-heading', 'Add object'), iconAction('Close object library', () => { library = false; renderPanel(); }, 'close')));
    if (!releases.length) { panel.append(h('p', 'rm-help', 'No installed releases are available.')); return panel; }
    const picker = h('div', 'rm-library-list');
    for (const r of releases) {
      const row = action(r.label, () => { chosenRelease = r.id; renderPanel(); }, r.kind, 'rm-library-row');
      row.setAttribute('aria-pressed', String(chosenRelease === r.id)); row.querySelector('span')!.append(h('small', null, r.kind === 'station' ? 'Operator station · v' + r.version : 'Display · v' + r.version));
      if (chosenRelease === r.id) row.append(icon('check')); picker.append(row);
    }
    const asset = byRelease.get(chosenRelease)!;
    const base = asset.kind === 'station' ? 'Station' : 'Display';
    let no = 1; while (scene.instances.some(i => i.label === base + ' ' + no)) no++;
    const automaticName = base + ' ' + no;
    const input = h('input'); input.type = 'text'; input.maxLength = 80; input.value = newLabel; input.placeholder = automaticName;
    input.dataset.focus = 'library-label'; input.addEventListener('input', () => { newLabel = input.value; });
    const submit = h('button', 'rm-button rm-primary rm-wide', icon('plus'), 'Add to room'); submit.type = 'submit';
    const form = h('form', 'rm-library-form', field('Instance name', input), submit);
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (submit.disabled) return; submit.disabled = true;
      // Keep this identity across a retry if the first reply was interrupted.
      addId ||= 'item-' + crypto.randomUUID();
      const id = addId, before = scene.version;
      if (scene.instances.some(i => i.id === id) || await write('instances.add', { instance: id, label: newLabel.trim() || automaticName, release: asset.id, ...initialPlacement(scene, asset, byRelease) }, before)) {
        addId = ''; newLabel = ''; library = false; choose(id);
      }
      submit.disabled = false;
    });
    panel.append(picker, form); return panel;
  }
  function roomProperties() {
    const { room, version } = scene;
    const dims = numberForm('dimensions', version, [
      { key: 'width', label: 'Width', value: room.width, unit: 'm' }, { key: 'depth', label: 'Depth', value: room.depth, unit: 'm' },
      { key: 'height', label: 'Height', value: room.height, unit: 'm' },
    ], drafts, (values, base) => write('room.set', values, base), renderPanel);
    const shell = section('Room dimensions', dims);
    for (const [key, name, wall] of [['door', 'Doorway', 'South wall'], ['window', 'Window', 'North wall']] as const) {
      const opening = room[key];
      shell.append(details('room/' + key, name, [
        h('p', 'rm-help', wall + ' · offset from west corner'),
        numberForm('room/' + key, version, [{ key: 'offset', label: 'Offset', unit: 'm', value: opening.offset }, { key: 'width', label: 'Width', unit: 'm', value: opening.width }], drafts, (values, base) => write('room.set', { [key]: values }, base), renderPanel),
      ], metres(opening.width)));
    }
    return [shell];
  }
  function inspect(item: RoomInstance, release: RoomRelease) {
    const prefix = item.id + '/', version = scene.version;
    const placement = numberForm(prefix + 'placement', version, [
      { key: 'x', label: 'X', value: item.x, unit: 'm' }, { key: 'y', label: 'Y', value: item.y, unit: 'm' },
      { key: 'yaw', label: 'Turn', value: item.yaw, unit: '°' },
    ], drafts, (values, base) => write('instances.move', { instance: item.id, ...values }, base), renderPanel);
    const inspector = section('Placement', placement);
    const controls = h('div', 'rm-detail-group');
    const parts = release.members.filter(m => m.id.startsWith('C_'));
    if (parts.length) {
      const pick = select('Selected component', [{ value: '', label: 'Whole object' }, ...parts.map(m => ({ value: m.id, label: m.label }))], member);
      pick.onchange = () => { member = pick.value; view.select(item.id, member || undefined); };
      controls.append(details(prefix + 'components', 'Components', [field('Selected component', pick)], String(parts.length)));
    }
    const joints = release.joints.filter(j => !j.locked);
    if (joints.length) {
      const joint = joints.find(j => j.id === chosenJoints.get(item.id)) ?? joints[0];
      const picker = select('Adjustment', joints.map(j => ({ value: j.id, label: j.label || j.id })), joint.id);
      picker.onchange = () => { chosenJoints.set(item.id, picker.value); expanded.add(prefix + 'joints'); renderPanel(); };
      controls.append(details(prefix + 'joints', 'Adjustments', [field('Joint', picker), jointForm(item, joint)], String(joints.length)));
    }
    if (release.seat) controls.append(operatorControls(item, release));
    const versions = select('Installed release', releases.map(r => ({ value: r.id, label: shortRelease(r) })), release.id);
    const swap = action('Swap release', () => {
      void write('instances.swap', { instance: item.id, release: versions.value }, version).then(ok => { if (!ok) { versions.value = item.release; swap.disabled = true; } });
    }); swap.disabled = true; versions.onchange = () => { swap.disabled = versions.value === item.release; };
    const remove = action('Remove object', () => void write('instances.remove', { instance: item.id }, version), 'remove', 'rm-danger');
    controls.append(details(prefix + 'release', 'Asset release', [field('Installed release', versions), h('div', 'rm-object-actions', swap, remove)], 'v' + release.version));
    const clearance = h('div', 'rm-clearance'); readClearance(item, clearance);
    return [inspector, section('Doorway clearance', clearance), controls];
  }
  function jointForm(item: RoomInstance, joint: RoomJoint) {
    const value = item.pose[joint.id] ?? joint.neutral, angular = joint.type !== 'prismatic';
    const units = angular ? '°' : 'm', scale = angular ? 180 / Math.PI : 1;
    const axes = joint.type === 'ball' ? ['Roll', 'Pitch', 'Yaw'] : [angular ? 'Angle' : 'Position'];
    const values = Array.isArray(value) ? value : [value];
    const offsets = Array.isArray(joint.neutral) ? joint.neutral : [0];
    const form = numberForm(item.id + '/joint/' + joint.id, scene.version, axes.map((label, index) => ({
      label, key: String(index), unit: units, value: values[index] * scale,
      min: (joint.lower + offsets[index]) * scale, max: (joint.upper + offsets[index]) * scale,
    })), drafts, (v, base) => write('pose.set', { instance: item.id, member: joint.id, value: joint.type === 'ball' ? axes.map((_, i) => v[i] / scale) : v[0] / scale }, base), renderPanel);
    const reset = action('Restore neutral position', () => void write('pose.set', { instance: item.id, member: joint.id, value: null }), undefined, 'rm-text-action');
    reset.disabled = !(joint.id in item.pose);
    return h('div', 'rm-joint-controls', form, h('p', 'rm-help', (joint.type === 'ball' ? 'From neutral ' : 'Range ') + displayNumber(joint.lower * scale, 2) + ' to ' + displayNumber(joint.upper * scale, 2) + ' ' + units), reset);
  }
  function operatorControls(item: RoomInstance, release: RoomRelease) {
    const occupied = scene.person?.host === item.id, host = scene.instances.find(i => i.id === scene.person?.host);
    if (!occupied) {
      const btn = action(host ? 'Move operator here' : 'Seat an operator', () => void write('person.set', { host: item.id }), 'person');
      return details(item.id + '/operator', 'Seated operator', host ? [h('p', 'rm-help', 'Currently seated at ' + host.label + '.'), btn] : [btn]);
    }
    const aims = scene.person?.state.aims ?? {};
    const targets = release.members.filter(m => /^[CDS]_/.test(m.id)).map(m => ({ value: m.id, label: m.label }));
    const patch = (key: keyof PersonAims, value: unknown) => write('person.set', { host: item.id, aims: { [key]: value } });
    const gaze = select('Look at', [{ value: '', label: 'Default gaze' }, ...targets], aims.look);
    gaze.onchange = () => { void patch('look', gaze.value || null).then(ok => { if (!ok) renderPanel(); }); };
    const content: Node[] = [field('Look at', gaze)];
    for (const key of AIM_LIMBS) {
      const currentAim = aims[key], target = currentAim && 'target' in currentAim ? currentAim.target : '';
      const label = key.replace('_', ' ').replace(/^./, s => s.toUpperCase()), hand = key.endsWith('hand');
      const picker = select(label, [{ value: '', label: hand ? 'At rest' : 'On floor' }, ...targets], target);
      picker.onchange = () => { void patch(key, picker.value ? { mode: hand ? 'touch' : 'on', target: picker.value } : null).then(ok => { if (!ok) renderPanel(); }); };
      content.push(field(label, picker));
    }
    content.push(action('Unseat operator', () => void write('person.set', { host: null }), undefined, 'rm-quiet'));
    return details(item.id + '/operator', 'Seated operator', content, 'Attached');
  }
  function describeEdge(edge: string) {
    const [id, side] = edge.split('/');
    if (id === 'door') return 'Door ' + (side ?? '').replaceAll('-', ' ');
    const item = scene.instances.find(i => i.id === id);
    return (item?.label ?? id) + ' · ' + (side ?? '').replaceAll('.', ' ').replaceAll('-', ' ');
  }
  function readClearance(item: RoomInstance, target: HTMLElement) {
    const token = measurementToken, version = scene.version;
    target.setAttribute('aria-live', 'polite'); target.textContent = 'Measuring…';
    void command<Clearance>('measure.clearance', { instance: item.id }).then(({ result, version: readVersion }) => {
      if (token !== measurementToken || version !== readVersion) return;
      const stat = (label: string, value: Span) => {
        const reading = h('strong', null, metres(value.metres)); reading.title = value.metres + ' m';
        return h('div', 'rm-reading', h('span', null, label), reading);
      };
      const edge = (label: string, span: Span) => h('p', 'rm-edges', h('b', null, label), span.edges.map(describeEdge).join(' ↔ '));
      target.replaceChildren(stat('Door approach', result), stat('Clear opening', result.opening), details('clearance/edges', 'Bounding edges', [edge('Door approach', result), edge('Clear opening', result.opening)]));
    }).catch(error => { if (token === measurementToken) target.textContent = errorText(error); });
  }
  function measurePanel() {
    const panel = h('div', 'rm-section', h('h2', 'rm-heading', 'Point to point'));
    if (!scene.instances.length) {
      panel.append(h('p', 'rm-help', 'Add an object to measure its points and doorway clearance.'), action('Add object', () => { tab = 'layout'; addId = ''; library = true; renderPanel(); }, 'plus', 'rm-primary'));
      return panel;
    }
    const first = current() ?? scene.instances[0], second = scene.instances.find(i => i.id !== first.id) ?? first;
    const resolve = (ref: RoomRef, fallback: RoomInstance, allowEye: boolean) => {
      const item = scene.instances.find(i => i.id === ref.instance) ?? fallback;
      const release = byRelease.get(item.release);
      const points = (release?.members ?? []).filter(m => m.id !== 'floor').map(m => ({ value: m.id, label: m.label }));
      const choices = [{ value: 'floor', label: 'Floor anchor' }, ...points];
      if (allowEye && scene.person?.host === item.id) choices.splice(1, 0, { value: '@eye', label: 'Seated eye' });
      ref.instance = item.id; if (!choices.some(p => p.value === ref.member)) ref.member = 'floor';
      return choices;
    };
    const endpoint = (ref: RoomRef, label: string, fallback: RoomInstance, eye: boolean) => {
      const choices = resolve(ref, fallback, eye);
      const instance = select(label + ' object', scene.instances.map(i => ({ value: i.id, label: i.label })), ref.instance);
      const point = select(label + ' point', choices, ref.member);
      instance.onchange = () => { ref.instance = instance.value; ref.member = 'floor'; renderPanel(); };
      point.onchange = () => { ref.member = point.value; renderPanel(); };
      return h('fieldset', 'rm-endpoint', h('legend', null, label), field('Object', instance), field('Point', point));
    };
    const a = endpoint(from, 'From', first, true), b = endpoint(to, 'To', second, false);
    const output = h('div', 'rm-distance', h('span', null, 'Spatial distance'), h('output', null, 'Measuring…'));
    panel.append(a, b, output);
    const token = measurementToken, version = scene.version, eye = from.member === '@eye';
    void command<Distance>(eye ? 'person.measure' : 'measure.distance', eye ? { to } : { from, to }).then(reply => {
      if (token !== measurementToken || reply.version !== version) return;
      const { result } = reply;
      const value = output.querySelector('output')!; value.textContent = metres(result.metres); value.title = result.metres + ' m';
      view.setMeasurement({ points: [result.from.point, result.to.point], label: metres(result.metres) });
    }).catch(error => { if (token === measurementToken) output.querySelector('output')!.textContent = errorText(error); });
    return panel;
  }
  view.setScene(scene, releases); setMode('plan'); renderPanel(); void updateUndo();
}
