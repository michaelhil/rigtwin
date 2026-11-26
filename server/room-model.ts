import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { check, Refusal } from "../shared/commands/schema.ts";
import { AIM_LIMBS, type PersonAims } from "../shared/person-aims.ts";
import { limitViolation, type JointValue } from "../shared/pose.ts";
import { doorClearance } from "../shared/room-geometry.ts";
import { operatorFields,type OperatorPatch } from "../shared/room-person.ts";
import { roomCommands } from "../shared/room-commands.ts";
import { ROOM_SCHEMA, roomPoint, type RoomCatalog, type RoomDimensions, type RoomInstance,
  type RoomPerson, type RoomPoint, type RoomRef, type RoomRelease, type RoomScene } from "../shared/room.ts";
import { cleanName } from "./workspaces.ts";

export const ROOM_HISTORY = 200;
export class RoomError extends Error {
  constructor(public code: string, message: string, public hint: string, public candidates?: unknown[]) { super(message); }
  wire() { return { code: this.code, message: this.message, hint: this.hint, ...(this.candidates ? { candidates: this.candidates } : {}) }; }
}
const invalid = (message: string) => new RoomError("invalid_args", message, "Use discover or the command's argument schema.");
type PoseGroup = {instance:string; pose:RoomInstance["pose"]}[];
type Prior = RoomPerson | RoomInstance | RoomDimensions | PoseGroup | null;
interface Change { version: number; command: string; key: string; keys?:string[]; before: Prior; index?: number; undoes?: number }
export interface RoomRecord { scene: RoomScene; history: Change[]; historyStart?: number }
export interface RoomWire { id: string; args?: unknown; expectedVersion?: unknown }
export function newRoom(id: string, name: string, catalog: RoomCatalog, template: "demo" | "empty" = "empty"): RoomRecord {
  const scene: RoomScene = { schema: ROOM_SCHEMA, id, name, version: 0,
    room: { width: 8, depth: 6, height: 2.8, door: { offset: 1, width: 1.2 }, window: { offset: 3, width: 2 } },
    instances: [], person: null };
  if (template === "demo") {
    const station = catalog.releases.find(r => r.kind === "station");
    const display = catalog.releases.find(r => r.variant === "freestanding" && r.version === "1");
    const adjustableWall = catalog.releases.find(r => r.variant === "wall" && r.joints.some(j => j.id === "J_mount_height"));
    const wall = adjustableWall ?? catalog.releases.find(r => r.variant === "wall");
    if (!station || !display || !wall) throw new RoomError("missing_release", "The room demo needs a station, freestanding display and wall display.", "Create an empty room or install the missing releases.");
    scene.room.window = { offset: 0.65, width: 2 };
    const center = scene.room.width / 2;
    // The station monitors sit below the shared wall screen's sightlines from both seats.
    const stationPose: RoomInstance["pose"] = station.joints.some(j => j.id === "J_mon_height") ? { J_mon_height: -0.075 } : {};
    const wallPose: RoomInstance["pose"] = adjustableWall ? { J_mount_height: 0.54 } : {};
    for (const [id, label, release, x, y, yaw, pose] of [
      ["station-a", "Station A", station.id, center - 1.35, 3.6, 90, stationPose],
      ["station-b", "Station B", station.id, center + 1.35, 3.6, 90, stationPose],
      ["display-a", "Freestanding display", display.id, 7.25, 4.2, 23, {}],
      ["wall-display", "Wall display", wall.id, center, scene.room.depth - wall.footprint.max[0], 90, wallPose],
    ] as const) scene.instances.push({ id, label, release, x, y, yaw, pose: { ...pose } });
    if (station.seat && catalog.defaultPerson) scene.person = { host: "station-a", state: structuredClone(catalog.defaultPerson(scene.instances[0])) };
  }
  return { scene, history: [] };
}

function validPose(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every(v => Array.isArray(v) ? v.length === 3 && v.every(Number.isFinite) : Number.isFinite(v));
}

function validHistoryEntry(entry: Change, version: number): boolean {
  if (!entry || entry.version !== version || typeof entry.key !== "string" || !("before" in entry)) return false;
  if (entry.key === "poses") {
    const {before, keys} = entry;
    return Array.isArray(before) && Array.isArray(keys) && before.length === keys.length &&
      new Set(keys).size === keys.length && before.every((row, n) =>
        row && typeof row.instance === "string" && keys[n] === instanceKey(row.instance) && validPose(row.pose));
  }
  return entry.keys === undefined && (entry.key === "room" || entry.key === "person" || entry.key.startsWith("instance/"));
}

export function parseRoom(text: string): RoomRecord {
  const r: RoomRecord = JSON.parse(text);
  if (r?.scene?.schema !== ROOM_SCHEMA) throw new RoomError("unsupported_format", "Unsupported stored scene format. Expected " + ROOM_SCHEMA + ".", "Open a room created with this installation's room editor.");
  const d = r.scene;
  const malformed = () => new RoomError("invalid_scene", "The stored room or its history is incomplete.", "Recover a complete copy of this scene.");
  if (typeof d.id !== "string" || typeof d.name !== "string" || !d.room?.door || !d.room.window ||
    !Array.isArray(d.instances) || !Number.isSafeInteger(d.version) || d.version < 0 || !Array.isArray(r.history) ||
    (!Number.isSafeInteger(r.historyStart ?? 0) || (r.historyStart ?? 0) < 0 || (r.historyStart ?? 0) > d.version) ||
    r.history.length !== Math.min(d.version - (r.historyStart ?? 0), ROOM_HISTORY) ||
    r.history.some((entry, n) => !validHistoryEntry(entry, d.version - r.history.length + n + 1)))
    throw malformed();
  try { validateRoom(d.room); } catch { throw malformed(); }
  const ids = new Set<string>();
  for (const i of d.instances) {
    if (!i || typeof i.id !== "string" || ids.has(i.id) || typeof i.release !== "string" || typeof i.label !== "string" ||
      ![i.x, i.y, i.yaw].every(Number.isFinite) || !validPose(i.pose))
      throw malformed();
    ids.add(i.id);
  }
  if (d.person !== null && (!d.person || !ids.has(d.person.host) || !d.person.state?.body || typeof d.person.state.posture !== "string")) throw malformed();
  return r;
}

function releaseFor(catalog: RoomCatalog, pin: string) {
  const r = catalog.releases.find(r => r.id === pin);
  if (!r) throw new RoomError("missing_release", "Exact release is not installed: " + pin, "Read the installed pins with discover. Supply the exact pin.");
  return r;
}
const fold = (s: string) => s.toLowerCase().replace(/[-_]+/g, " ").trim();
const instanceKey = (id: string) => "instance/" + id;
function describe(i: RoomInstance) { return { id: i.id, label: i.label, release: i.release }; }
function getInstance(scene: RoomScene, catalog: RoomCatalog, name: string) {
  const exact = scene.instances.find(i => i.id === name);
  if (exact) return exact;
  const q = fold(name);
  let found = scene.instances.filter(i => fold(i.label) === q);
  if (!found.length) found = scene.instances.filter(i => {
    const r = releaseFor(catalog, i.release);
    return [i.id, i.label, r.asset, r.label, r.kind].some(s => fold(s).includes(q));
  });
  if (found.length === 1) return found[0];
  if (found.length > 1) throw new RoomError("ambiguous", "More than one instance matches " + name + ".", "Choose an instance by its exact ID.", found.map(describe));
  throw new RoomError("unknown_instance", "No instance matches " + name + ".", "Use discover to find its scene-local ID.");
}
const floor = { id: "floor", label: "Floor anchor", kind: "datum" as const };
const members = (r: RoomRelease) => [floor, ...r.members.filter(m => m.id !== floor.id)];
function memberOf(r: RoomRelease, name: string, joints = false) {
  const items = joints ? r.joints.map(j => ({ id: j.id, label: j.label ?? j.id })) : members(r);
  const exact = items.find(m => m.id === name);
  if (exact) return exact.id;
  const q = fold(name), hits = items.filter(m => fold(m.label).includes(q) || fold(m.id).includes(q));
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) throw new RoomError("ambiguous", "Several members match " + name + ".", "Choose the exact member ID within this instance.", hits);
  throw new RoomError("unknown_member", "No " + (joints ? "joint" : "member") + " matches " + name + " on " + r.label + ".", "Use discover with instance to list local IDs.");
}

function problem(r: RoomRelease, id: string, value: JointValue): string | null {
  const j = r.joints.find(j => j.id === id);
  if (!j) return "missing joint";
  if (j.locked && !j.assumed) return "locked joint";
  if (j.type === "ball" ? !Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite) : !Number.isFinite(value))
    return "expected " + (j.type === "ball" ? "three finite angles" : "a finite number");
  return limitViolation({ ...j, axis: null }, value);
}
export function validateInstance(scene: RoomScene, catalog: RoomCatalog, i: RoomInstance) {
  const r = releaseFor(catalog, i.release);
  const problems = Object.entries(i.pose).map(([k, v]) => {
    const why = problem(r, k, v);
    return why ? k + " (" + why + ")" : null;
  }).filter(Boolean);
  const occupied = scene.person?.host === i.id;
  if (occupied && !r.seat) problems.push("occupied seat on " + i.id);
  if (occupied && scene.person?.state.aims) {
    const a = scene.person.state.aims;
    const targets = [a.look, ...AIM_LIMBS.map(limb => {
      const aim = a[limb];
      return aim && "target" in aim ? aim.target : undefined;
    })];
    for (const t of targets) if (t && !r.members.some(m => m.id === t)) problems.push("person aim at " + t);
  }
  if (problems.length) throw new RoomError("incompatible", problems.join(", "), "Clear the listed pose values with pose.set value null, or clear/rebind the seated person or their named aims with person.set.");
}
function validateRoom(r: RoomDimensions) {
  if ([r.width, r.depth, r.height].some(n => !(n > 0) || !Number.isFinite(n))) throw invalid("Room dimensions must be positive and finite.");
  for (const key of ["door", "window"] as const) {
    const o = r[key];
    if (!(Number.isFinite(o.width) && Number.isFinite(o.offset) && o.width > 0 && o.offset >= 0 && o.offset + o.width <= r.width)) throw invalid("The " + key + " must fit within the wall width.");
  }
}
function located(scene: RoomScene, c: RoomCatalog, ref: RoomRef) {
  const i = getInstance(scene, c, ref.instance), r = releaseFor(c, i.release), member = memberOf(r, ref.member);
  const local: RoomPoint = member === "floor" ? [0, 0, 0] : c.point(i, member);
  return { instance: i.id, member, point: roomPoint(i, local) };
}
type Located = ReturnType<typeof located>;
function distance(from: Located, to: Located) {
  return { from, to, metres: Math.hypot(...from.point.map((n, k) => to.point[k] - n)) };
}
function discover(scene: RoomScene, c: RoomCatalog, args: { query?: string; instance?: string }) {
  const q = fold(args.query ?? ""), matches = (...names: string[]) => names.some(s => fold(s).includes(q));
  const items = args.instance ? [getInstance(scene, c, args.instance)] : scene.instances;
  const instances = items.flatMap(i => {
    const r = releaseFor(c, i.release);
    const selectedMembers = members(r).filter(m => matches(m.id, m.label)).map(m => ({ ...m, instance: i.id }));
    if (!args.instance && q && !matches(i.id, i.label, r.asset, r.label, r.kind) && !selectedMembers.length) return [];
    return [{ ...describe(i), kind: r.kind, ...(args.instance || q ? { members: selectedMembers, joints: r.joints.filter(j => matches(j.id, j.label ?? "")) } : {}) }];
  });
  return { instances, releases: c.releases.filter(r => !q || matches(r.id, r.asset, r.label, r.kind)).map(({ id, asset, label, version, kind, variant }) => ({ id, asset, label, version, kind, variant })), commands: roomCommands.map(s => s.id) };
}

type AimPatch = { [K in keyof PersonAims]?: PersonAims[K] | null };
function editAims(person: RoomPerson, patch: AimPatch, release: RoomRelease) {
  const aims = person.state.aims ?? {};
  const target = (name: string) => {
    const id = memberOf(release, name);
    if (id === "floor" || release.joints.some(j => j.id === id)) throw invalid("A person aim needs a part or datum on the host.");
    return id;
  };
  if (patch.look === null) delete aims.look;
  else if (patch.look !== undefined) aims.look = target(patch.look);
  for (const k of AIM_LIMBS) {
    const aim = patch[k];
    if (aim === undefined) continue;
    if (aim === null) delete aims[k];
    else Object.assign(aims, { [k]: "target" in aim ? { ...aim, target: target(aim.target) } : aim });
  }
  if (Object.keys(aims).length) person.state.aims = aims;
  else delete person.state.aims;
}

function undoable(record: RoomRecord) {
  const claimed = new Set<string>(), undone = new Set<number>(), available: Change[] = [];
  for (const e of [...record.history].reverse()) {
    if (e.undoes !== undefined) { undone.add(e.undoes); continue; }
    if (undone.has(e.version)) continue;
    const keys=e.keys ?? [e.key];
    if (!keys.some(k=>claimed.has(k))) available.push(e);
    keys.forEach(k=>claimed.add(k));
  }
  return available;
}
function guard(record: RoomRecord, expected: unknown, keys: string[]) {
  if (expected === undefined) return;
  if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0 || expected > record.scene.version) throw invalid("expectedVersion must be a known non-negative scene version.");
  if (expected < record.scene.version - record.history.length || record.history.some(e => e.version > expected && (e.keys ?? [e.key]).some(k=>keys.includes(k))))
    throw new RoomError("stale", "The selected object changed since version " + expected + ", or that version is outside retained history.", "Read state and repeat the intended change at its current version.");
}

type Args = {
  allowAssumed?: boolean; instance: string; member: string; x?: number; y?: number; yaw?: number; label?: string; release: string;
  values:Record<string,JointValue|null>; pose?: Record<string, JointValue>; value: JointValue | null; host: string | null; aims?: AimPatch;
  version?: number; from: RoomRef; to: RoomRef; query?: string;
} & Partial<RoomDimensions>;

/** A candidate record is isolated from its source. The store publishes it only after a successful commit. */
export function roomCommand(record: RoomRecord, catalog: RoomCatalog, wire: RoomWire, liveConnections = 0) {
  const spec = roomCommands.find(s => s.id === wire.id);
  if (!spec) throw new RoomError("unknown_command", "Unknown room command " + String(wire.id) + ".", "Use discover to list room commands.");
  const args = wire.args === undefined ? {} : wire.args;
  const err = check(spec.inputSchema, args);
  if (err) throw invalid(err);
  const a = args as Args, scene = record.scene;
  const reply = (result: unknown, next = record) => ({ record: next, result, recorded: next === record ? null : next.scene.version });
  switch (wire.id) {
    case "state": return reply({ scene, undoable: undoable(record).map(e => e.version) });
    case "history.list": return reply({entries:record.history.slice().reverse().map(({version,command,key,undoes})=>({version,command,key,undoes}))});
    case "discover": return reply({ ...discover(scene, catalog, a), liveConnections });
    case "measure.distance": return reply(distance(located(scene, catalog, a.from), located(scene, catalog, a.to)));
    case "measure.clearance": return reply(doorClearance(scene, getInstance(scene, catalog, a.instance), catalog.releases));
    case "person.options": {
      const host=getInstance(scene,catalog,a.host!);
      if(!catalog.operatorOptions || !releaseFor(catalog,host.release).seat) throw invalid("Choose a station with an installed operator package.");
      const prior=scene.person?.host===host.id ? scene.person.state : catalog.defaultPerson?.(host);
      if(!prior) throw invalid("The station has no supported operator.");
      const options=wire.args as Pick<OperatorPatch,"style"|"sex">;
      return reply(catalog.operatorOptions(host,{...prior,style:options.style??prior.style,sex:options.sex??prior.sex}));
    }
    case "person.measure": {
      if (!scene.person || !catalog.eye) throw new RoomError("no_person", "No measurable seated person in this scene.", "Attach a person to a compatible station using person.set.");
      if (scene.person.state.posture!=="operating") throw new RoomError("unsupported_posture","The eye solver requires the operating posture.","Select operating posture before measuring the eye.");
      const host = getInstance(scene, catalog, scene.person.host);
      const from = { instance: host.id, member: "eye", point: roomPoint(host, catalog.eye(host, scene.person.state)) };
      return reply(distance(from, located(scene, catalog, a.to)));
    }
  }

  const draft = structuredClone(scene);
  // One reversible change per command. Instance changes store only their own prior state.
  let key: string, before: Prior, after: Prior, index: number | undefined, undoes: number | undefined;
  let result: unknown, keys:string[] | undefined;
  if (wire.id === "undo") {
    const options = undoable(record), target = a.version === undefined ? options[0] : options.find(e => e.version === a.version);
    if (!target) throw new RoomError("undo_unavailable", "The edit is outside retained history, already undone or superseded on the same object.", "Read state for the list of undoable versions.");
    key = target.key; undoes = target.version; after = structuredClone(target.before);
    keys=target.keys;
    guard(record, wire.expectedVersion, keys ?? [key]);
    if (key === "poses") {
      const saved=after as PoseGroup, replaced:PoseGroup=[];
      for (const ref of saved) {
        const item=getInstance(draft,catalog,ref.instance);
        replaced.push({instance:item.id,pose:item.pose});item.pose=ref.pose;
      }
      before=replaced;
    }
    else if (key === "room") { before = draft.room; draft.room = after as RoomDimensions; }
    else if (key === "person") { before = draft.person; draft.person = after as RoomPerson | null; }
    else {
      const id = key.slice("instance/".length);
      index = draft.instances.findIndex(i => i.id === id); before = draft.instances[index] ?? null;
      if (index >= 0) draft.instances.splice(index, 1);
      if (after) draft.instances.splice(Math.min(target.index ?? draft.instances.length, draft.instances.length), 0, after as RoomInstance);
    }
    if (draft.person && !draft.instances.some(i => i.id === draft.person!.host))
      throw new RoomError("occupied", "Undo would remove the seated person's station.", "Move or unseat the person before undoing this edit.");
    for (const item of draft.instances) validateInstance(draft, catalog, item);
    result = { undone: undoes };
  } else if (wire.id === "scene.reset") {
    const items=a.instance ? [getInstance(draft,catalog,a.instance)] : draft.instances;
    guard(record,wire.expectedVersion,items.map(i=>instanceKey(i.id)));
    const changed=items.filter(i=>Object.keys(i.pose).length);
    key="poses";keys=changed.map(i=>instanceKey(i.id));
    before=changed.map(i=>({instance:i.id,pose:i.pose}));
    after=changed.map(i=>{i.pose={};return {instance:i.id,pose:i.pose};});
    result={reset:changed.map(i=>i.id)};
  } else if (wire.id === "room.set") {
    key = "room"; guard(record, wire.expectedVersion, [key]);
    before = scene.room; after = draft.room = { ...scene.room, ...wire.args as Partial<RoomDimensions> };
    validateRoom(after); result = { room: after };
  } else if (wire.id === "person.set") {
    const host = a.host === null ? null : getInstance(draft, catalog, a.host);
    key = "person"; guard(record, wire.expectedVersion, host ? [key, instanceKey(host.id)] : [key]);
    before = scene.person;
    const supplied=wire.args as OperatorPatch;
    const patch=Object.fromEntries(Object.keys(operatorFields).filter(k=>Object.hasOwn(supplied,k)).map(k=>[k,supplied[k as keyof OperatorPatch]])) as OperatorPatch;
    if (!host) {
      if (a.aims || Object.keys(patch).length) throw invalid("Operator settings require an occupied host.");
      draft.person = null;
    } else {
      const r = releaseFor(catalog, host.release);
      if (!r.seat || !catalog.defaultPerson) throw new RoomError("incompatible", host.label + " has no compatible seated operator.", "Select a station with seat support.");
      const prior = draft.person;
      let state = prior?.state ?? structuredClone(catalog.defaultPerson(host));
      if (Object.keys(patch).length) {
        if (!catalog.configureOperator) throw invalid("This release has no configurable operator package.");
        try {state=catalog.configureOperator(host,state,patch);}
        catch(e) {if(e instanceof Refusal) throw new RoomError(e.code,e.message,e.hint); throw e;}
      }
      if(a.aims && state.posture!=="operating") throw invalid("Gaze and limb targets require the operating posture.");
      // Aim IDs belong to the host. validateInstance requires every retained target on a rebind.
      draft.person = { host: host.id, state };
      if (a.aims) editAims(draft.person, a.aims, r);
      validateInstance(draft, catalog, host);
    }
    after = draft.person; result = { person: after };
  } else if (wire.id === "instances.add") {
    const r = releaseFor(catalog, a.release), id = a.instance ?? randomUUID();
    key = instanceKey(id); guard(record, wire.expectedVersion, [key]);
    if (draft.instances.some(i => i.id === id)) throw new RoomError("duplicate_instance", "The scene already has instance " + id + ".", "Choose an unused instance ID or omit it.");
    if (!a.allowAssumed && Object.keys(a.pose ?? {}).some(id=>r.joints.some(j=>j.id===id && j.locked && j.assumed)))
      throw invalid("Set allowAssumed to use this modeled adjustment.");
    let label: string;
    try { label = cleanName(a.label, r.label); } catch (e) { throw invalid(String(e)); }
    const item: RoomInstance = { id, label, release: r.id, x: a.x ?? 0, y: a.y ?? 0, yaw: a.yaw ?? 0, pose: {} };
    for (const [name, val] of Object.entries(a.pose ?? {})) item.pose[memberOf(r, name, true)] = val;
    validateInstance(draft, catalog, item);
    index = draft.instances.length; draft.instances.push(item); before = null; after = item; result = { instance: item };
  } else {
    const i = getInstance(draft, catalog, a.instance), r = releaseFor(catalog, i.release);
    key = instanceKey(i.id); guard(record, wire.expectedVersion, [key]);
    index = draft.instances.indexOf(i); before = scene.instances[index]; after = i;
    switch (wire.id) {
      case "instances.remove":
        if (draft.person?.host === i.id) throw new RoomError("occupied", i.label + " hosts the seated person.", "Rebind with person.set or remove the person with host null.");
        draft.instances.splice(index, 1); after = null; break;
      case "instances.swap": {
        const replacement = releaseFor(catalog, a.release);
        for (const joint of Object.keys(i.pose)) {
          const old = r.joints.find(j => j.id === joint), next = replacement.joints.find(j => j.id === joint);
          if (old && next && old.type !== next.type) throw new RoomError("incompatible", joint + " changes joint type on the new release.", "Clear this setting with pose.set value null before swapping.");
        }
        i.release = replacement.id; validateInstance(draft, catalog, i); break;
      }
      case "instances.move":
        if (a.x !== undefined) i.x = a.x;
        if (a.y !== undefined) i.y = a.y;
        if (a.yaw !== undefined) i.yaw = a.yaw;
        break;
      case "pose.set":
      case "pose.apply": {
        const changes = wire.id === "pose.set" ? { [a.member]: a.value } : a.values;
        for (const [member, value] of Object.entries(changes)) {
          const id = memberOf(r, member, true);
          if (value === null) { delete i.pose[id]; continue; }
          const joint = r.joints.find(j => j.id === id);
          if (joint?.locked && joint.assumed && !a.allowAssumed) throw invalid("Set allowAssumed to use " + id + ".");
          const why = problem(r, id, value);
          if (why) throw invalid(id + ": " + why);
          i.pose[id] = value;
        }
        break;
      }
      default: throw invalid("Unsupported edit");
    }
    result = { instance: after ?? { id: i.id, removed: true } };
  }
  if (isDeepStrictEqual(before, after)) return reply(result);
  const change: Change = { command: wire.id, version: ++draft.version, key, keys, before, index, undoes };
  return reply(result, { ...record, scene: draft, history: [...record.history, change].slice(-ROOM_HISTORY) });
}
