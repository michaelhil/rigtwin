// Release A, the reader: a scene that carries `content` (what its flat screens show) or `lighting` opens, undoes,
// exports, imports, compares and replays its assessments, although no command of this release writes `content`.
// Records with `content` are made by hand here, as a later release would write them.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoomCatalog, RoomRelease, RoomScene } from "../shared/room.ts";
import { contentShapeOk, LIVE, type SceneContent } from "../shared/room-content.ts";
import { createRoomApi } from "./room-api.ts";
import { parseRoom, roomCommand, type RoomRecord } from "./room-model.ts";
import { sceneShape } from "./project-package.ts";

function release(asset: string, member: string, station: boolean): RoomRelease {
  const digest = (station ? "a" : "b").repeat(64);
  return { asset, id: asset + "@1#" + digest, label: asset, digest, version: "1", kind: station ? "station" : "display", seat: station,
    anchor: [0, 0, 0], footprint: { min: [-.1, -.1], max: [.1, .1] }, members: [{ id: member, label: "Screen" }], joints: [],
    modelUrl: "/model", manifestUrl: "/manifest" };
}
const station = release("rig-b", "S_mon_screen", true), display = release("floor-display", "S_screen", false);
const catalog: RoomCatalog = {
  releases: [station, display], point: i => i.release === station.id ? [.6, 0, 1] : [0, 0, 1], eye: () => [0, 0, 1],
  defaultPerson: () => ({ style: "clay", sex: "female", tone: "light", glasses: false, headset: false, preset: "Fixture", body: {}, posture: "operating" }),
};
const blockA: SceneContent = {
  sources: { page: { kind: "page", url: "https://example.org/a", label: "Page A" } },
  shows: { display: { S_screen: { source: "page" } } },
};
const blockB: SceneContent = {
  sources: { "process-one": { kind: "app", app: "fixture-app", item: "process-one", label: "Process one", run: { key: "abcdefghij" } } },
  shows: { display: { S_screen: { source: "process-one", view: "dashboard" } } },
};

const dirs: string[] = [], apis: ReturnType<typeof createRoomApi>[] = [];
afterAll(() => { for (const a of apis) a.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function installation() {
  const dataDir = mkdtempSync(join(tmpdir(), "synergon-reader-")); dirs.push(dataDir);
  const api = createRoomApi({ dataDir, catalog }); apis.push(api);
  const post = async (path: string, body: unknown) => (await api.fetch(new Request("http://localhost/api/" + path, {
    method: "POST", headers: { "content-type": "application/json", "x-synergon": "1" }, body: JSON.stringify(body) }))).json() as Promise<any>;
  const ok = async (path: string, body: unknown) => {
    const r = await post(path, body);
    if (r.ok === false) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r;
  };
  const sceneFile = (ws: string) => {
    const hit = readdirSync(join(dataDir, "projects"), { recursive: true }).map(String).find(f => f.endsWith(ws + ".json") && f.includes("scenes"));
    if (!hit) throw new Error("no scene file for " + ws);
    return join(dataDir, "projects", hit);
  };
  return {
    run: (id: string, args: object = {}) => ok("projects/command", { id, args }),
    tryRun: (id: string, args: object = {}) => post("projects/command", { id, args }),
    room: async (ws: string, id: string, args: object = {}) => (await ok("scenes/" + ws + "/command", { id, args })).result,
    tryRoom: (ws: string, id: string, args: object = {}) => post("scenes/" + ws + "/command", { id, args }),
    state: async (ws: string) => (await api.fetch(new Request("http://localhost/api/scenes/" + ws + "/state"))).json() as Promise<RoomScene>,
    /** Writes `content` into the stored scene as Release B would: one `content` history entry, a new revision. */
    writeContent(ws: string, content: unknown) {
      const file = sceneFile(ws), doc = JSON.parse(readFileSync(file, "utf8")), record: RoomRecord = doc.record;
      const version = record.scene.version + 1;
      record.history.push({ version, command: "content.set", key: "content", before: record.scene.content ?? null } as RoomRecord["history"][number]);
      record.scene = { ...record.scene, version, content: content as SceneContent };
      writeFileSync(file, JSON.stringify({ ...doc, sourceRevision: version, record }));
    },
  };
}
async function litScene(at: ReturnType<typeof installation>) {
  const made = await at.run("project.create", { name: "Lit study", sceneName: "Lit layout" });
  const ws = made.scene as string;
  await at.room(ws, "instances.add", { instance: "station", release: station.id, x: 2, y: 2 });
  await at.room(ws, "instances.add", { instance: "display", release: display.id, x: 2.5, y: 2 });
  await at.room(ws, "person.set", { host: "station" });
  await at.room(ws, "lighting.set", { ceiling: { countX: 4 }, lamps: { colour: "#ffcc88" } });
  return { project: made.id as string, ws };
}

test("a record with a content entry and an entry of a newer release: content undoes, the other is never offered", () => {
  const scene: RoomScene = { schema: "synergon-room/1", id: "7a2d3b4f-6c8e-4dab-9f10-2b3c4d5e6f70", name: "Reader", version: 3,
    room: { width: 8, depth: 6, height: 2.8, door: { offset: 1, width: 1.2 }, window: { offset: 3, width: 2 } },
    instances: [{ id: "display", label: "Display", release: display.id, x: 1, y: 1, yaw: 0, pose: {} }], person: null, content: blockB };
  const ghost = { id: "ghost", label: "Ghost", release: display.id, x: 0, y: 0, yaw: 0, pose: {} };
  const record = parseRoom(JSON.stringify({ scene, history: [
    { version: 1, command: "content.set", key: "content", before: null },
    { version: 2, command: "content.set", key: "content", before: blockA },
    { version: 3, command: "future.set", key: "future", before: ghost, index: 0 },
  ] }));
  expect(record.scene.content).toEqual(blockB);
  const state = roomCommand(record, catalog, { id: "state" }).result as { undoable: number[] };
  expect(state.undoable).toEqual([2]);
  // the newer release's entry is refused, by version and never by default; nothing is spliced into the instances
  expect(() => roomCommand(record, catalog, { id: "undo", args: { version: 3 } })).toThrow(expect.objectContaining({ code: "undo_unavailable" }));
  const undone = roomCommand(record, catalog, { id: "undo" });
  expect(undone.result).toEqual({ undone: 2 });
  expect(undone.record.scene.content).toEqual(blockA);
  expect(undone.record.scene.instances).toEqual(scene.instances);
  expect(undone.record.history.at(-1)).toMatchObject({ key: "content", undoes: 2, before: blockB });
  // the next undo is the earlier content edit, as for lighting; the newer release's entry is still not offered
  expect((roomCommand(undone.record, catalog, { id: "state" }).result as { undoable: number[] }).undoable).toEqual([1]);
  expect("content" in roomCommand(undone.record, catalog, { id: "undo" }).record.scene).toBe(false);
  // undoing the first entry (before null) removes the block
  const first = parseRoom(JSON.stringify({ scene: { ...scene, version: 1 }, history: [{ version: 1, command: "content.set", key: "content", before: null }] }));
  const cleared = roomCommand(first, catalog, { id: "undo" }).record.scene;
  expect("content" in cleared).toBe(false);
  expect(cleared.instances).toEqual(scene.instances);
  // the stored record survives another parse, unknown entry included
  expect(parseRoom(JSON.stringify(undone.record)).history.map(e => e.key)).toEqual(["content", "content", "future", "content"]);
  // a content entry whose before is not an object or null is a damaged history
  expect(() => parseRoom(JSON.stringify({ scene: { ...scene, version: 1 }, history: [{ version: 1, command: "x", key: "content", before: [1] }] })))
    .toThrow(expect.objectContaining({ code: "invalid_scene" }));
});

test("a scene with a malformed content block opens, edits and keeps the block; a strict reader refuses it", async () => {
  expect(contentShapeOk(blockA)).toBe(true);
  expect(contentShapeOk(blockB)).toBe(true);
  for (const bad of [null, [], "x", { sources: {} }, { sources: [], shows: {} }, { sources: {}, shows: "all" }]) expect(contentShapeOk(bad)).toBe(false);
  const big = { sources: { page: { kind: "page", url: "https://example.org/", label: "x".repeat(LIVE.maxContentBytes) } }, shows: {} };
  expect(contentShapeOk(big)).toBe(false);
  const cyclic: Record<string, unknown> = { sources: {}, shows: {} }; cyclic.self = cyclic;
  expect(contentShapeOk(cyclic)).toBe(false);
  // unknown keys and kinds are kept
  expect(contentShapeOk({ sources: { s: { kind: "model", what: 1 } }, shows: {}, share: "later" })).toBe(true);

  const at = installation(), { ws } = await litScene(at);
  const malformed = { sources: "not a map", shows: 3 };
  at.writeContent(ws, malformed);
  const opened = await at.state(ws);
  expect(opened.content as unknown).toEqual(malformed);
  expect(opened.lighting?.ceiling.countX).toBe(4);
  await at.room(ws, "instances.move", { instance: "display", x: 3 });
  expect((await at.state(ws)).content as unknown).toEqual(malformed);
  expect((await at.room(ws, "undo")).undone).toBe(opened.version + 1);
  expect((await at.room(ws, "undo")).undone).toBe(opened.version);
  expect("content" in (await at.state(ws))).toBe(false);
  expect(() => sceneShape({ ...opened, content: malformed })).toThrow("Invalid live screen content");
});

test("export, import, named version, assessment save and replay of a scene with lighting and content", async () => {
  const source = installation(), { project, ws } = await litScene(source);
  source.writeContent(ws, blockB);
  await source.room(ws, "assessment.configure", { jurisdiction: "us-general-industry", task: "seated-display-reading", exitAccess: "yes" });
  const assessed = await source.room(ws, "assessment.run", { saveName: "Lit and showing" });
  expect((await source.room(ws, "assessment.replay", { id: assessed.saved.id })).report).toEqual(assessed.report);
  await source.run("project.save", { project, scene: ws, name: "Lit and showing" });
  const pkg = await source.run("project.export", { project });
  const exported = pkg.project.scenes[0];
  expect(exported.lighting.ceiling.countX).toBe(4);
  expect(exported.content).toEqual(blockB);
  expect(pkg.project.versions[0].scene.content).toEqual(blockB);
  expect(pkg.project.assessment.runs[0].inputs.scene.lighting.lamps.colour).toBe("#ffcc88");

  const receiver = installation();
  const imported = await receiver.run("project.import", { package: pkg });
  expect(imported.status).toBe("imported");
  const dest = imported.project.scenes[0].id as string, received = await receiver.state(dest);
  expect(received.lighting).toEqual(exported.lighting);
  expect(received.content).toEqual(blockB);
  expect((await receiver.room(dest, "assessment.replay", { id: assessed.saved.id })).report).toEqual(assessed.report);
  expect((await receiver.run("project.import", { package: pkg })).status).toBe("unchanged");
  // a restored named version brings the block back after an edit removed it from the stored scene
  receiver.writeContent(dest, blockA);
  await receiver.run("project.restore", { project: imported.project.id, version: imported.project.versions[0].id, expectedVersion: 1 });
  expect((await receiver.state(dest)).content).toEqual(blockB);

  // a scene field this release does not know: refused as a newer release's, naming the field
  const newer = structuredClone(pkg);
  newer.project.scenes[0].surfaces = { curved: true };
  const refused = await receiver.tryRun("project.import", { package: newer, separateCopy: true });
  expect(refused.ok).toBe(false);
  expect(refused.error.code).toBe("newer_format");
  expect(refused.error.message).toContain("newer Synergon");
  expect(refused.error.message).toContain("surfaces");
  expect(refused.error.hint).toContain("Update this installation");
  // lighting outside its limits is refused with the reason
  const dim = structuredClone(pkg);
  dim.project.scenes[0].lighting.ceiling.countX = 99;
  const wrong = await receiver.tryRun("project.import", { package: dim, separateCopy: true });
  expect(wrong.error.message).toContain("Invalid scene lighting");
});

test("project.compare reports lighting and content differences", async () => {
  const at = installation(), { project, ws } = await litScene(at);
  at.writeContent(ws, blockA);
  const first = (await at.run("project.save", { project, scene: ws, name: "Before" })).versions[0].id;
  await at.room(ws, "lighting.set", { ceiling: { countX: 2 } });
  at.writeContent(ws, blockB);
  const second = (await at.run("project.save", { project, scene: ws, name: "After" })).versions.find((v: { id: string }) => v.id !== first).id;
  const { changes } = await at.run("project.compare", { project, version: first, other: second });
  expect(changes).toContainEqual({ path: "lighting/ceiling/countX", before: 4, after: 2 });
  expect(changes).toContainEqual({ path: "content/shows/display/S_screen/source", before: "page", after: "process-one" });
  expect(changes).toContainEqual({ path: "content/sources/page", before: blockA.sources.page, after: null });
  expect(changes.every((c: { path: string }) => /^(lighting|content)\//.test(c.path))).toBe(true);
  // against the current scene, with the block gone: one change at content
  at.writeContent(ws, undefined);
  const now = await at.run("project.compare", { project, version: second });
  expect(now.changes).toEqual([{ path: "content", before: blockB, after: null }]);
});
