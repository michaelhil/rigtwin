// The scene document: the pose of the open asset, the person in the seat (synergon-scene/1, manikin v1) and the last
// changes. One document ("Playground") per server. Values are SI (metres, radians; a three-angle mount is [roll,
// pitch, yaw]); the commands (core.ts) take and give degrees and metres. Pure: no files, no clock
// other than the entry time, no network. The server stores it as doc.json; the viewer reads the same
// shape from the live channel without importing this file.
//
// Rules:
// - apply(): an edit is refused as stale when any joint it names was changed by an entry after the
//   version the edit was based on (`expectedVersion`). Edits of other joints in between do not matter.
// - planUndo({version}): reverts that entry as a new entry; refused as stale if any of its joints
//   changed since (which includes an entry that already undid it). A later change that was itself undone does not count
//   (the change and its undo cancel), so changes can be undone one after another, newest first.
// - planUndo({group}): reverts the net effect of every entry of the group (and of undos of its entries)
//   as one new entry: each joint goes back to its value before the group first changed it. Refused as
//   stale if an entry outside the group changed one of those joints after the group first did.
// - reconcile(): when the asset was rebuilt, joints that no longer exist are dropped and values outside
//   the new limits are clamped, recorded as one entry by the actor `system`.
// - The person (synergon-scene/1): `person` is the whole person as one value (null: nobody in the seat). An entry that changes
//   it carries `person: {before, after}`; for the stale check and for undo the person is one key, "person", like a joint.
// - parseDoc() reads only the current format. Documents of an earlier format are converted once, outside the server, with
//   upgradeDoc() (shared/commands/scene-upgrade.ts).
import { limitViolation, type JointKinematics, type JointValue } from "../pose.ts";
import { AIM_LIMBS, type PersonAims } from "../person-aims.ts";
import { Refusal } from "./schema.ts";

export const SCENE_FORMAT = "synergon-scene/1";
/** The person's key in the stale check and in undo (no joint has this name: joint ids start with J_). */
export const PERSON_KEY = "person";
/** Entries kept in the document's history (step-1 design: the last 200 changes). */
export const HISTORY_CAP = 200;

export type Actor = { kind: "person" | "agent" | "script" | "system"; id: string; label: string };
/** `after: null` only in a system entry: the joint no longer exists in the rebuilt asset and was dropped. */
export type JointChange = { joint: string; before: JointValue | null; after: JointValue | null };
/** The person in the seat, as the commands set it (shared/commands/person.ts) and the page shows it (viewer.person):
 *  body = the package's control values (stature mm, mass kg, the r_* controls in SD), stature and mass always, any other
 *  control only when it is not at its default (0 SD); posture = "operating" or a pose of the package's library by name. */
export interface PersonState {
  style: "dressed" | "clay"; sex: "female" | "male"; tone: string; glasses: boolean; headset: boolean;
  preset: string | null; body: Record<string, number>; posture: string;
  /** Seated overrides; absent fields keep their operating defaults. */
  aims?: PersonAims;
}
export type PersonChange = { before: PersonState | null; after: PersonState | null };
export type Entry = { version: number; actor: Actor; group?: string; command: string; changes: JointChange[]; person?: PersonChange; at: string; undoes?: number[] };
export interface SceneDoc {
  schema: typeof SCENE_FORMAT;
  version: number;
  asset: { name: string; sha256: string };
  /** joints that have been set, by joint id; a joint not listed is at its neutral value */
  pose: Record<string, JointValue>;
  /** the person in the seat; null: nobody */
  person: PersonState | null;
  history: Entry[];
}

export const SYSTEM: Actor = { kind: "system", id: "system", label: "System" };
export const GROUP_PATTERN = "^[a-z0-9][a-z0-9-]{0,39}$";

export function newDoc(asset: { name: string; sha256: string }, person: PersonState | null = null): SceneDoc {
  return { schema: SCENE_FORMAT, version: 0, asset: { name: asset.name, sha256: asset.sha256 }, pose: {}, person: person ? structuredClone(person) : null, history: [] };
}

function validAims(aims: PersonState["aims"]): boolean {
  if (aims === undefined) return true;
  const target = (id: unknown) => typeof id === "string" && /^[CDS]_[A-Za-z0-9_]+$/.test(id);
  if (!aims || typeof aims !== "object" || Array.isArray(aims) || (aims.look !== undefined && !target(aims.look))) return false;
  return AIM_LIMBS.every((key) => {
    const aim = aims[key];
    if (aim === undefined) return true;
    if (!aim || typeof aim !== "object") return false;
    if (key.endsWith("_hand")) return aim.mode === "rest" || ((aim.mode === "point" || aim.mode === "touch") && target(aim.target));
    return aim.mode === "floor" || (aim.mode === "on" && target(aim.target));
  });
}

/** A document read from disk or the wire, checked for shape; throws with a reason. */
export function parseDoc(raw: unknown): SceneDoc {
  const d = raw as SceneDoc;
  if (!d || d.schema !== SCENE_FORMAT) throw new Error(`not a ${SCENE_FORMAT} document`);
  if (!Number.isInteger(d.version) || d.version < 0 || !d.asset?.name || !d.pose || typeof d.pose !== "object" || !Array.isArray(d.history)) throw new Error("the document is incomplete");
  if (d.person === undefined || (d.person !== null && (typeof d.person !== "object" || typeof d.person.sex !== "string" || !d.person.body || typeof d.person.posture !== "string" || !validAims(d.person.aims)))) throw new Error("the document's person is malformed");
  for (const [i, e] of d.history.entries()) if (!Number.isInteger(e.version) || e.version > d.version || (i > 0 && e.version <= d.history[i - 1].version)) throw new Error("the history is out of order");
  if (d.history.some((e) => !validAims(e.person?.before?.aims) || !validAims(e.person?.after?.aims))) throw new Error("the history's person targets are malformed");
  return d;
}

const touches = (e: Entry, joint: string) => (joint === PERSON_KEY ? !!e.person : e.changes.some((c) => c.joint === joint));
/** two persons (or nobody) the same: every field equal */
export function samePerson(a: PersonState | null, b: PersonState | null): boolean {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a.body).sort(), kb = Object.keys(b.body).sort();
  return a.style === b.style && a.sex === b.sex && a.tone === b.tone && a.glasses === b.glasses && a.headset === b.headset && a.preset === b.preset && a.posture === b.posture
    && a.aims?.look === b.aims?.look
    && AIM_LIMBS.every((key) => {
      const x = a.aims?.[key], y = b.aims?.[key];
      return x?.mode === y?.mode && (x && "target" in x ? x.target : undefined) === (y && "target" in y ? y.target : undefined);
    })
    && ka.length === kb.length && ka.every((k, i) => k === kb[i] && Math.abs(a.body[k] - b.body[k]) < 1e-9);
}
const keyName = (k: string) => (k === PERSON_KEY ? "the person" : k);
const sameValue = (a: JointValue | null, b: JointValue | null) =>
  a === null || b === null ? a === b : Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-12) : !Array.isArray(b) && Math.abs(a - b) < 1e-12;

/** The entries after `version`, or null when the kept history no longer reaches back that far. */
export function entriesAfter(doc: SceneDoc, version: number): Entry[] | null {
  if (version > doc.version || version < 0) return null;
  if (version === doc.version) return [];
  const first = doc.history[0];
  if (!first || first.version > version + 1) return null;
  return doc.history.filter((e) => e.version > version);
}

export interface EditRequest {
  actor: Actor; command: string; group?: string;
  /** every joint the edit names, including those it leaves at their value (they take part in the stale check) */
  joints: string[];
  /** the changes, `before` being the current value */
  changes: JointChange[];
  /** a change of the person (`before` = doc.person); the edit must then name PERSON_KEY in `joints` */
  person?: PersonChange;
  expectedVersion?: number;
  undoes?: number[];
  at?: string;
}

/** Record an edit as a new entry. Returns null (nothing recorded) when no value changes; throws a Refusal when stale. */
export function apply(doc: SceneDoc, req: EditRequest): Entry | null {
  const ev = req.expectedVersion;
  if (ev !== undefined && ev !== doc.version) {
    if (!Number.isInteger(ev) || ev < 0 || ev > doc.version) throw new Refusal("invalid_args", `expectedVersion ${ev} is not a version of this document (it is at version ${doc.version})`, "send the version you last read (scene.summary or the live channel), or leave expectedVersion out");
    const later = entriesAfter(doc, ev);
    if (!later) throw new Refusal("stale", `this change is based on version ${ev}, older than the kept history (it starts at version ${doc.history[0]?.version ?? doc.version})`, `read the current values (scene.summary) and send the change again with expectedVersion ${doc.version}`);
    const moved: string[] = [];
    for (const j of req.joints) {
      const e = [...later].reverse().find((x) => touches(x, j));
      if (e) moved.push(`${keyName(j)} was changed by ${e.actor.label} in version ${e.version}`);
    }
    if (moved.length) throw new Refusal("stale", `${moved.join("; ")}, after version ${ev} that this change was based on`, `look at the new value(s) (scene.summary); to change them anyway, send the change again with expectedVersion ${doc.version}`);
  }
  const changes = req.changes.filter((c) => !sameValue(c.before, c.after));
  const person = req.person && !samePerson(req.person.before, req.person.after) ? structuredClone(req.person) : undefined;
  if (!changes.length && !person) return null;
  const entry: Entry = {
    version: doc.version + 1, actor: req.actor, ...(req.group ? { group: req.group } : {}), command: req.command,
    changes, ...(person ? { person } : {}), at: req.at ?? new Date().toISOString(), ...(req.undoes?.length ? { undoes: req.undoes } : {}),
  };
  for (const c of changes) { if (c.after === null) delete doc.pose[c.joint]; else doc.pose[c.joint] = c.after; }
  if (person) doc.person = structuredClone(person.after);
  doc.version = entry.version;
  doc.history.push(entry);
  if (doc.history.length > HISTORY_CAP) doc.history.splice(0, doc.history.length - HISTORY_CAP);
  return entry;
}

export type UndoTarget = { version: number } | { group: string };

/** The entries after version `after` (other than `skip`) that changed `key` and still count: a change that a later entry
 *  undid, and that undo, cancel each other, so undoing one change after another (an undo stack) is not refused as stale.
 *  An undo of `after` itself, or of anything at or before it, always counts. */
function inEffect(doc: SceneDoc, key: string, after: number, skip: Set<number> = new Set()): Entry[] {
  const later = doc.history.filter((x) => x.version > after && !skip.has(x.version)), undone = new Set(later.flatMap((x) => x.undoes ?? []));
  return later.filter((x) => touches(x, key) && !undone.has(x.version) && !(x.undoes?.length && x.undoes.every((u) => u > after && !skip.has(u))));
}

/** The changes that revert an entry or a group, checked for staleness against the current document. */
export function planUndo(doc: SceneDoc, target: UndoTarget): { changes: JointChange[]; undoes: number[]; person?: PersonChange } {
  const now = (j: string) => doc.pose[j] ?? null;
  if ("version" in target) {
    const v = target.version, e = doc.history.find((x) => x.version === v);
    if (!e) throw v > doc.version || v < 1
      ? new Refusal("unknown_version", `there is no version ${v} (the document is at version ${doc.version})`, "scene.summary lists the recent changes with their versions")
      : new Refusal("unknown_version", `version ${v} is no longer in the history (the last ${HISTORY_CAP} changes are kept, from version ${doc.history[0]?.version ?? doc.version})`, "set the values again with pose.set instead");
    for (const key of [...e.changes.map((c) => c.joint), ...(e.person ? [PERSON_KEY] : [])]) {
      const later = inEffect(doc, key, v)[0];
      if (later) throw new Refusal("stale", later.undoes?.includes(v) ? `version ${v} was already undone by version ${later.version}` : `${keyName(key)} was changed again by ${later.actor.label} in version ${later.version}, after version ${v}`, later.undoes?.includes(v) ? `to restore it, undo version ${later.version}` : `undo the later change first, or set the value you want with ${key === PERSON_KEY ? "person.set" : "pose.set"}`);
    }
    return { changes: e.changes.map((c) => ({ joint: c.joint, before: now(c.joint), after: c.before })), undoes: [v], ...(e.person ? { person: { before: doc.person, after: e.person.before } } : {}) };
  }
  const g = target.group, members = new Set<number>();
  for (const e of doc.history) if (e.group === g || (e.undoes?.length && e.undoes.every((u) => members.has(u)))) members.add(e.version);
  if (!members.size) throw new Refusal("unknown_group", `no change in the kept history has the group '${g}'`, "scene.summary lists the recent changes with their groups");
  const first = new Map<string, { version: number; before: JointValue | null }>();
  let firstPerson: { version: number; before: PersonState | null } | undefined;
  for (const e of doc.history) if (members.has(e.version)) {
    for (const c of e.changes) if (!first.has(c.joint)) first.set(c.joint, { version: e.version, before: c.before });
    if (e.person && !firstPerson) firstPerson = { version: e.version, before: e.person.before };
  }
  for (const [j, f] of [...first, ...(firstPerson ? [[PERSON_KEY, firstPerson] as const] : [])]) {
    const other = inEffect(doc, j, f.version, members)[0];
    if (other) throw new Refusal("stale", `${keyName(j)} was changed by ${other.actor.label} in version ${other.version}, after the group '${g}' changed it`, `undo that change first, or set the value you want with ${j === PERSON_KEY ? "person.set" : "pose.set"}`);
  }
  const changes = [...first].map(([joint, f]) => ({ joint, before: now(joint), after: f.before })).filter((c) => !sameValue(c.before, c.after));
  const person = firstPerson && !samePerson(doc.person, firstPerson.before) ? { before: doc.person, after: firstPerson.before } : undefined;
  if (!changes.length && !person) throw new Refusal("nothing_to_undo", `the changes of group '${g}' are already undone: everything it changed is back at its earlier value`, "nothing to do");
  return { changes, undoes: [...members], ...(person ? { person } : {}) };
}

/** Revert an entry or a group as a new entry (planUndo + apply). */
export function undo(doc: SceneDoc, target: UndoTarget, meta: { actor: Actor; group?: string; at?: string }): Entry {
  const { changes, undoes, person } = planUndo(doc, target);
  return apply(doc, { actor: meta.actor, command: "history.undo", group: meta.group, joints: [...changes.map((c) => c.joint), ...(person ? [PERSON_KEY] : [])], changes, person, undoes, at: meta.at })!;
}

/** Bring the document in line with a (possibly rebuilt) asset; returns the system entry, or null when nothing changed. */
export function reconcile(doc: SceneDoc, asset: { name: string; sha256: string; joints: Map<string, JointKinematics> }): Entry | null {
  if (doc.asset.name === asset.name && doc.asset.sha256 === asset.sha256) return null;
  doc.asset = { name: asset.name, sha256: asset.sha256 };
  const changes: JointChange[] = [];
  for (const [id, v] of Object.entries(doc.pose)) {
    const j = asset.joints.get(id);
    if (!j) { changes.push({ joint: id, before: v, after: null }); continue; }
    const ball = j.type === "ball";
    if (ball !== Array.isArray(v) || (ball && (v as number[]).length !== 3)) { changes.push({ joint: id, before: v, after: j.neutral }); continue; }
    if (!limitViolation(j, v)) continue;
    const clamped = ball
      ? (v as number[]).map((x, i) => Math.min((j.neutral as number[])[i] + j.upper, Math.max((j.neutral as number[])[i] + j.lower, x)))
      : Math.min(j.upper, Math.max(j.lower, v as number));
    changes.push({ joint: id, before: v, after: clamped });
  }
  return apply(doc, { actor: SYSTEM, command: "asset.rebuilt", joints: [], changes });
}
