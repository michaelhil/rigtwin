import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoomApi } from "./room-api.ts";
import { loadRoomLibrary } from "./room-library.ts";
import { createRoomLibrary, releaseInventory } from "./room-installed.ts";
import type { ProjectPackage, ProjectDetail } from "../shared/project.ts";

const root = mkdtempSync(join(tmpdir(), "synergon-transfer-"));
let library: Awaited<ReturnType<typeof loadRoomLibrary>>;
let one: string, two: string;
beforeAll(async () => {
  library = await loadRoomLibrary(join(root, "assets"));
  [one, two] = library.catalog.releases.filter((r) => r.asset === "floor-display").map((r) => r.id);
}, 60000);
const applications: ReturnType<typeof createRoomApi>[] = [];
afterAll(() => {
  for (const a of applications) a.close();
  rmSync(root, { recursive: true, force: true });
});
function installation(name: string, lib: ReturnType<typeof createRoomLibrary>, publicMode = false) {
  const dataDir = join(root, name);
  let api = createRoomApi({ dataDir, catalog: lib.catalog, publicMode });
  applications.push(api);
  const post = (path: string, body: unknown) =>
    api.fetch(
      new Request("http://localhost/api/" + path, {
        method: "POST",
        headers: { "x-synergon": "1", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const req = async (path: string, body: unknown) => {
    const res = await post(path, body);
    const r = (await res.json()) as any;
    if (!res.ok || r.ok === false)
      throw Object.assign(new Error(r.error.message), { code: r.error.code, hint: r.error.hint });
    return r;
  };
  return {
    dataDir,
    run: (id: string, args: object = {}) => req("projects/command", { id: "project." + id, args }),
    room: async (ws: string, id: string, args: object = {}) =>
      (await req("workspaces/" + ws + "/command", { id, args })).result,
    fetch: (req: Request) => api.fetch(req),
    get: async (path: string) => (await api.fetch(new Request("http://localhost/api/" + path))).json() as Promise<any>,
    post,
    restart(lib: ReturnType<typeof createRoomLibrary>) {
      api.close();
      applications.splice(applications.indexOf(api), 1);
      api = createRoomApi({ dataDir, catalog: lib.catalog, publicMode });
      applications.push(api);
    },
  };
}
const floor = (instance: string) => ({ instance, member: "floor" });
const metric = { from: floor("left"), to: floor("right") };
const disk = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort();

test("moved and renamed two-scene folder, frozen revisions, comparison, offline restore, independent edits, undo, idempotency and copies", async () => {
  const src = installation("original", library),
    receiver = installation("receiver", createRoomLibrary());
  const record = '# Study\n\nPurpose: independent workstations\n\nArbitrary field = "🟢"\n\nUnstructured notes.\n';
  const project: ProjectDetail = await src.run("create", {
    name: "Study",
    markdown: record,
    folder: "Customer/Phase 1/Study",
    sceneName: "North",
  });
  const projectId = project.id,
    a = project.scenes[0];
  const second: ProjectDetail = await src.run("scene", { project: projectId, name: "South" });
  const b = second.scenes.find((s) => s.id !== a.id)!;
  await src.room(a.workspace, "instances.add", { instance: "left", release: one, x: 0, y: 0 });
  await src.room(a.workspace, "instances.add", { instance: "right", release: one, x: 3, y: 4 });
  await src.room(b.workspace, "instances.add", { instance: "wall", release: two, x: 7 });
  expect((await src.room(a.workspace, "measure.distance", metric)).metres).toBe(5);
  const saved = await src.run("save", { project: projectId, scene: a.id, name: "Surveyed", expectedVersion: 2 });
  const version = saved.versions[0].id;
  await src.room(a.workspace, "instances.move", { instance: "right", x: 0 });
  const later = await src.run("save", { project: projectId, scene: a.id, name: "Adjusted" });
  const other = later.versions.find((v: any) => v.id !== version).id;
  expect((await src.run("compare", { project: projectId, version, other })).changes).toEqual([
    { path: "instances/right/x", before: 3, after: 0 },
  ]);
  await src.run("move", { project: projectId, folder: "Customer/Revised/Operations" });
  await src.run("rename", { project: projectId, name: "Operations" });
  // The ordinary folder can also be moved outside the application. IDs resolve after discovery.
  const folder = join(src.dataDir, "projects", "Customer", "Revised");
  renameSync(join(folder, "Operations"), join(folder, "Control centre"));
  const opened = await src.run("open", { project: projectId });
  expect(opened.folder).toBe("Customer/Revised/Control centre");
  expect(readFileSync(join(folder, "Control centre", "project.md"), "utf8")).toBe(record);
  const pkg: ProjectPackage = await src.run("export", { project: projectId });
  expect(pkg.dependencies.map((d) => d.mode)).toEqual(["embed", "embed"]);
  expect(JSON.stringify(pkg)).not.toContain(a.workspace);
  expect(JSON.stringify(pkg.project)).not.toMatch(/"history"|"actor"|"workspace"/);
  const transfer = await receiver.run("import", { package: pkg });
  const received = transfer.project as ProjectDetail;
  expect(received.id).toBe(projectId);
  expect(received.markdown).toBe(record);
  const destA = received.scenes.find((s) => s.id === a.id)!,
    destB = received.scenes.find((s) => s.id === b.id)!;
  expect(destA.workspace).not.toBe(a.workspace);
  expect(destA.revision).toBe(0);
  expect((await receiver.room(destA.workspace, "state")).undoable).toEqual([]);
  const beforeB = await receiver.room(destB.workspace, "state");
  const same = await receiver.run("import", { package: pkg });
  expect(same.status).toBe("unchanged");
  expect((await receiver.run("export", { project: projectId })).project).toEqual(pkg.project);
  await receiver.run("restore", { project: projectId, version, expectedVersion: 0 });
  expect((await receiver.room(destA.workspace, "measure.distance", metric)).metres).toBe(5);
  await receiver.room(destA.workspace, "instances.move", { instance: "right", x: 0 });
  expect((await receiver.room(destA.workspace, "measure.distance", metric)).metres).toBe(4);
  await receiver.room(destA.workspace, "undo");
  expect((await receiver.room(destA.workspace, "measure.distance", metric)).metres).toBe(5);
  receiver.restart(createRoomLibrary());
  expect((await receiver.room(destA.workspace, "measure.distance", metric)).metres).toBe(5);
  expect(await receiver.room(destB.workspace, "state")).toEqual(beforeB);
  await expect(receiver.run("import", { package: pkg })).rejects.toHaveProperty("code", "project_conflict");
  const copied = await receiver.run("import", { package: pkg, separateCopy: true });
  expect(copied.status).toBe("copied");
  expect((await receiver.run("import", { package: pkg, separateCopy: true })).project.id).toBe(copied.project.id);
  expect(copied.project.id).not.toBe(projectId);
  expect(copied.project.scenes.find((s: any) => s.id === a.id).workspace).not.toBe(destA.workspace);
  expect((await receiver.room(destA.workspace, "measure.distance", metric)).metres).toBe(5);
});

test("linked and mixed packages require the exact local pin, including a release used only by a saved version", async () => {
  const app = installation("linked-source", library),
    p = await app.run("create", { name: "Pins" }),
    ws = p.scenes[0].workspace;
  await app.room(ws, "instances.add", { instance: "screen", release: one });
  await app.run("save", { project: p.id, scene: p.scenes[0].id, name: "First edition" });
  await app.room(ws, "instances.swap", { instance: "screen", release: two });
  const linked: ProjectPackage = await app.run("export", { project: p.id, defaultMode: "link" });
  expect(linked.dependencies).toEqual([one, two].sort().map((pin) => ({ pin, mode: "link" })));
  const destLib = createRoomLibrary();
  destLib.catalog.transfer!.prepare([{ pin: two, files: library.catalog.transfer!.pack(two) }]).commit();
  const dest = installation("linked-target", destLib);
  await expect(dest.run("import", { package: linked })).rejects.toThrow(one);
  expect((await dest.run("list")).projects).toEqual([]);
  const mixed: ProjectPackage = await app.run("export", {
    project: p.id,
    defaultMode: "link",
    modes: { [one]: "embed" },
  });
  expect(mixed.dependencies.find((d) => d.pin === two)).toEqual({ pin: two, mode: "link" });
  expect((await dest.run("import", { package: mixed })).status).toBe("imported");
  const exact = installation("exact-library", library);
  expect((await exact.run("import", { package: linked })).status).toBe("imported");
  expect(disk(join(exact.dataDir, "projects")).some((path) => path.endsWith("embedded.json"))).toBe(false);
});

test("project and workspace handles keep their owner after a folder is replaced during a move", async () => {
  const app = installation("external-move", createRoomLibrary());
  const a = await app.run("create", { name: "First", folder: "A", markdown: "First record" });
  const b = await app.run("create", { name: "Second", folder: "B", markdown: "Second record" });
  const folders = join(app.dataDir, "projects");
  renameSync(join(folders, "A"), join(folders, "Moved"));
  renameSync(join(folders, "B"), join(folders, "A"));
  expect((await app.run("open", { workspace: a.scenes[0].workspace })).folder).toBe("Moved");
  await app.run("rename", { project: a.id, name: "Moved first" });
  expect((await app.run("open", { project: b.id })).markdown).toBe("Second record");
  expect((await app.run("open", { project: a.id })).markdown).toBe("First record");
});

test("an embedded re-import restores a previously linked release for the same workspace across restart", async () => {
  const source = installation("link-recovery-source", library);
  const p = await source.run("create", { name: "Link recovery" });
  await source.room(p.scenes[0].workspace, "instances.add", { instance: "display", release: one });
  await source.room(p.scenes[0].workspace, "instances.add", { instance: "second", release: two });
  const linked = await source.run("export", { project: p.id, modes: { [one]: "link" } });
  const embedded = await source.run("export", { project: p.id, modes: { [two]: "link" } });
  const target = installation("link-recovery-target", library);
  const ws = (await target.run("import", { package: linked })).project.scenes[0].workspace;
  target.restart(createRoomLibrary());
  await expect(target.room(ws, "state")).rejects.toHaveProperty("code", "missing_release");
  const same = await target.run("import", { package: embedded });
  expect(same.status).toBe("updated");
  expect(same.project.scenes[0].workspace).toBe(ws);
  expect((await target.room(ws, "state")).scene.instances[0].release).toBe(one);
  target.restart(createRoomLibrary());
  expect((await target.room(ws, "state")).scene.instances.map((i: { release: string }) => i.release)).toEqual([
    one,
    two,
  ]);
  expect((await target.run("import", { package: embedded })).status).toBe("unchanged");
});

test("refused or interrupted transfers leave catalog and existing files intact; restricted releases can travel as links", async () => {
  const src = installation("adversarial-source", library),
    p = await src.run("create", { name: "Checked" });
  await src.room(p.scenes[0].workspace, "instances.add", { instance: "first", release: one });
  await src.room(p.scenes[0].workspace, "instances.add", { instance: "second", release: two });
  const pkg = (await src.run("export", { project: p.id })) as ProjectPackage;
  const targetLib = createRoomLibrary(),
    target = installation("protected", targetLib);
  const sentinel = await target.run("create", { name: "Untouched", markdown: "Keep this exactly." });
  const before = disk(join(target.dataDir, "projects"));
  const verify = async () => {
    expect(disk(join(target.dataDir, "projects"))).toEqual(before);
    expect((await target.run("open", { project: sentinel.id })).markdown).toBe("Keep this exactly.");
    expect(targetLib.catalog.releases).toHaveLength(0);
  };
  for (const change of [
    (p: any) => (p.dependencies.at(-1).files["model.glb"] = "YQ=="),
    (p: any) => (p.dependencies[0].files["../project.md"] = "WA=="),
    (p: any) => p.dependencies.pop(),
    (p: any) => p.dependencies.push(p.dependencies[0]),
    (p: any) => (p.project.scenes[0].instances[0].pose = { Bad: 1 }),
    (p: any) => (p.project.scenes[0].room.door.width = 3333),
    (p: any) => (p.project.scenes[0].history = []),
    (p: any) => (p.project.scenes[0].id = "../../elsewhere"),
  ]) {
    const bad = structuredClone(pkg);
    change(bad);
    await expect(target.run("import", { package: bad, folder: "New/Nested/Bad" })).rejects.toThrow();
    await verify();
  }
  let sent = false;
  const interrupted = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (!sent) {
        sent = true;
        ctrl.enqueue(new TextEncoder().encode('{"id":"project.import","args":{"package":'));
      } else ctrl.error(new Error("Disconnected"));
    },
  });
  const interruptedResponse = await target.fetch(
    new Request("http://localhost/api/projects/command", {
      method: "POST",
      headers: { "content-type": "application/json", "x-synergon": "1" },
      body: interrupted,
    }),
  );
  expect(((await interruptedResponse.json()) as any).error.code).toBe("interrupted");
  await verify();
  const broken = await target.post("projects/command", {
    id: "project.import",
    args: { package: { project: pkg.project } },
  });
  expect(broken.status).toBe(422);
  await verify();
  const outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(target.dataDir, "projects", "shortcut"));
  await expect(target.run("import", { package: pkg, folder: "shortcut/write" })).rejects.toThrow();
  expect(readdirSync(outside)).toEqual([]);
  const dep = pkg.dependencies[0];
  if (dep.mode !== "embed") throw Error();
  const raw = new Map(
    Object.entries(dep.files)
      .filter(([k]) => k !== "inventory.json")
      .map(([k, v]) => [k, Buffer.from(v, "base64")]),
  );
  const manifest = JSON.parse(raw.get("manifest.json")!.toString());
  manifest.redistributable = false;
  raw.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  const { digest, bytes } = releaseInventory(raw),
    restricted = dep.pin.split("#")[0] + "#" + digest;
  raw.set("inventory.json", bytes);
  const bad = structuredClone(pkg);
  bad.project.scenes[0].instances.find((i) => i.release === dep.pin)!.release = restricted;
  bad.dependencies[0] = {
    pin: restricted,
    mode: "embed",
    files: Object.fromEntries([...raw].map(([k, b]) => [k, b.toString("base64")])),
  };
  await expect(target.run("import", { package: bad })).rejects.toThrow(/restricted/);
  expect(targetLib.catalog.releases).toHaveLength(0);
  targetLib.install(restricted, raw);
  bad.dependencies[0] = { pin: restricted, mode: "link" };
  const accepted = await target.run("import", { package: bad });
  expect(accepted.status).toBe("imported");
  await expect(
    target.run("export", { project: accepted.project.id, modes: { [restricted]: "embed" } }),
  ).rejects.toHaveProperty("code", "restricted_release");
});

test("project MCP discovers and edits the same folder, while a public installation never opens the customer directory", async () => {
  const local = installation("mcp", createRoomLibrary());
  const mcp = async (method: string, params = {}) =>
    (await local.post("projects/mcp", { jsonrpc: "2.0", method, params, id: 1 })).json() as Promise<any>;
  expect((await mcp("tools/list")).result.tools.map((x: any) => x.name)).toContain("project_restore");
  const built = await mcp("tools/call", { name: "project_create", arguments: { name: "Agent room" } });
  const p = built.result.structuredContent.result;
  expect((await local.run("open", { workspace: p.scenes[0].workspace })).id).toBe(p.id);
  const publicData = join(root, "public");
  mkdirSync(publicData);
  symlinkSync(join(local.dataDir, "projects"), join(publicData, "projects"));
  const publicApi = installation("public", createRoomLibrary(), true);
  expect((await publicApi.get("projects")).error.code).toBe("no_workspace");
  expect((await publicApi.get("workspaces")).workspaces.some((s: any) => s.id === p.scenes[0].workspace)).toBe(false);
  expect((await publicApi.get("commands")).commands.map((s: any) => s.id)).not.toContain("project.list");
});

test("offline copy replays a saved operator assessment and preserves its independent geometry after those assets leave the scene", async () => {
  const source = installation("assessed-before", library);
  const p = await source.run("create", { name: "Assessed study" });
  const added = await source.run("scene", { project: p.id, name: "Operator layout", template: "demo" });
  const scene = added.scenes.find((s: any) => s.name === "Operator layout");
  await source.room(scene.workspace, "assessment.configure", {
    profile: "customer-layout",
    jurisdiction: "us-general-industry",
    task: "seated-display-reading",
    exitAccess: "yes",
    customer: { minimum: 1.1, reference: "Field survey 4" },
  });
  const result = await source.room(scene.workspace, "assessment.run", { saveName: "Before relocation" });
  const before = await source.room(scene.workspace, "person.measure", {
    to: { instance: "wall-display", member: "D_screen_center" },
  });
  await source.run("save", { project: p.id, scene: scene.id, name: "Seated operator" });
  await source.room(scene.workspace, "person.set", { host: null });
  for (const instance of ["station-a", "station-b", "display-a", "wall-display"])
    await source.room(scene.workspace, "instances.remove", { instance });
  const pkg = await source.run("export", { project: p.id });
  const receiver = installation("assessed-after", createRoomLibrary());
  const received = (await receiver.run("import", { package: pkg })).project;
  const ws = received.scenes.find((s: any) => s.id === scene.id).workspace;
  const replay = await receiver.room(ws, "assessment.replay", { id: result.saved.id });
  expect(replay.report).toEqual(result.report);
  await receiver.run("restore", { project: received.id, version: received.versions[0].id, expectedVersion: 0 });
  expect(
    (await receiver.room(ws, "person.measure", { to: { instance: "wall-display", member: "D_screen_center" } })).metres,
  ).toBeCloseTo(before.metres, 10);
}, 60000);
