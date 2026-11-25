// bun test server — workspaces: the store (server/workspaces.ts) and the API that serves many shared scenes (server/server.ts):
// create, list (order, search, cursor), get, rename and delete with their events, two workspaces kept apart (changes, undo,
// agents), the creation limits, bad ids, loading on demand and dropping when idle, the first start of an empty data folder.
import { test, expect, describe, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApi, type ApiOptions } from "./server.ts";
import { LiveReader, viaPlayground } from "./test-support.ts";
import { cleanName, createWorkspace, isWorkspaceId, NameError, openStore, type Workspace } from "./workspaces.ts";
import { LIMITS } from "./limits.ts";

const ROOT = join(import.meta.dir, "..");
const ASSET = join(ROOT, "assets", "rig-b", "build");
const temps: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "synergon-workspaces-test-")); temps.push(d); return d; };
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function start(o: Partial<ApiOptions> = {}) {
  const dataDir = o.dataDir ?? tempDir();
  const api = createApi({ dataDir, assetDir: ASSET, mode: "local", revision: "test", ...o });
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 40, async fetch(req, s) { return (await viaPlayground(api, req, s.requestIP(req)?.address ?? "")) ?? new Response("not found", { status: 404 }); } });
  const base = `http://127.0.0.1:${srv.port}`;
  const W = { "x-synergon": "1", "content-type": "application/json" };
  const create = (name?: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/workspaces`, { method: "POST", headers: { ...W, ...headers }, body: JSON.stringify(name === undefined ? {} : { name }) });
  const make = async (name?: string, headers: Record<string, string> = {}) => (await (await create(name, headers)).json()) as Workspace;
  const ws = (id: string) => `${base}/api/workspaces/${id}`;
  const command = (id: string, c: { id: string; args?: unknown; group?: string }, headers: Record<string, string> = {}) =>
    fetch(`${ws(id)}/command`, { method: "POST", headers: { ...W, ...headers }, body: JSON.stringify({ args: {}, ...c }) }).then((r) => r.json()) as Promise<any>;
  const live = (id: string, headers: Record<string, string> = {}) => new LiveReader(`${ws(id)}/live`, headers);
  const mcp = async (id: string, method: string, params?: unknown, sid?: string) => {
    const r = await fetch(`${ws(id)}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }) });
    return { sid: r.headers.get("mcp-session-id")!, body: (await r.json()) as any };
  };
  return { base, api, dataDir, W, create, make, ws, command, live, mcp, stop: () => { api.close(); srv.stop(true); } };
}
const deployed = (limits: ApiOptions["limits"] = {}) => start({ mode: "deployed", limits: { diskMinFreeBytes: 0, diskMinFreeFraction: 0, ...limits } });
const lower = { id: "pose.set", args: { joints: { J_mon_height: -0.03 } } };

describe("the first start", () => {
  test("an empty data folder gets the workspace Playground, once", async () => {
    const dataDir = tempDir();
    const a = start({ dataDir });
    const list = await (await fetch(`${a.base}/api/workspaces`)).json();
    expect(list).toMatchObject({ next: null, total: 1, workspaces: [{ name: "Playground" }] });
    const id = list.workspaces[0].id;
    expect(isWorkspaceId(id)).toBe(true);
    expect(a.api.playground()?.id).toBe(id);
    a.stop();
    const b = start({ dataDir });                              // a second start adds nothing
    expect((await (await fetch(`${b.base}/api/workspaces`)).json()).workspaces.map((w: Workspace) => w.id)).toEqual([id]);
    b.stop();
  });

  test("a scene left by a server before workspaces becomes the Playground; one that cannot be read does not", async () => {
    const dataDir = tempDir(), keep = start();
    await keep.command((await keep.api.playground())!.id, lower);
    const pid = keep.api.playground()!.id;
    keep.stop();                                                // stopping writes what is pending
    const doc = JSON.parse(readFileSync(join(keep.dataDir, "workspaces", pid, "doc.json"), "utf8"));
    mkdirSync(join(dataDir, "playground"), { recursive: true });
    writeFileSync(join(dataDir, "playground", "doc.json"), JSON.stringify(doc));
    const s = start({ dataDir }), r = await s.command("playground", { id: "scene.summary" });
    expect(r.version).toBe(1);
    s.stop();
    const bad = tempDir();
    mkdirSync(join(bad, "playground"), { recursive: true }); writeFileSync(join(bad, "playground", "doc.json"), "{not json");
    const t = start({ dataDir: bad });
    expect((await t.command("playground", { id: "scene.summary" })).version).toBe(0);
    t.stop();
  });

  test("createWorkspace places a document in a data folder (the cutover script's way)", async () => {
    const dataDir = tempDir(), src = start();
    await src.command("playground", lower); await src.command("playground", { id: "pose.set", args: { joints: { J_mon_tilt: 0 } } });
    const pid = src.api.playground()!.id;
    src.stop();
    const doc = JSON.parse(readFileSync(join(src.dataDir, "workspaces", pid, "doc.json"), "utf8"));
    const w = createWorkspace(dataDir, { name: "Playground", doc });
    expect(existsSync(join(dataDir, "workspaces", w.id, "doc.json"))).toBe(true);
    const s = start({ dataDir });
    expect(s.api.list().total).toBe(1);                         // the server made no second Playground
    const r = await s.command(w.id, { id: "scene.summary" });
    expect(r.version).toBe(2);
    s.stop();
  });
});

describe("create, list, get", () => {
  test("create answers 201 with the record; names are cleaned; a bad request is refused with a reason", async () => {
    const s = start();
    const res = await s.create("  Pilot study 1  ");
    expect(res.status).toBe(201);
    const w = (await res.json()) as Workspace;
    expect(w).toMatchObject({ name: "Pilot study 1" });
    expect(isWorkspaceId(w.id)).toBe(true);
    expect(new Date(w.created).toISOString()).toBe(w.created);
    expect(w.changed).toBe(w.created);
    expect(existsSync(join(s.dataDir, "workspaces", w.id))).toBe(true);
    expect((await s.make()).name).toBe("Untitled workspace");
    expect((await s.make("   ")).name).toBe("Untitled workspace");
    expect((await s.make("a\u0000b\nc‮d")).name).toBe("abcd");            // controls and direction marks are removed
    expect((await s.make("x".repeat(80))).name).toHaveLength(80);
    for (const bad of ["x".repeat(81), 5, ["a"], { a: 1 }]) {
      const r = await s.create(bad as any);
      expect(r.status).toBe(400);
      expect((await r.json()).error.code).toBe("bad_name");
    }
    expect((await fetch(`${s.base}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);          // no X-Synergon
    expect((await fetch(`${s.base}/api/workspaces`, { method: "POST", headers: { "x-synergon": "1", "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await fetch(`${s.base}/api/workspaces`, { method: "POST", headers: s.W, body: "[1]" })).status).toBe(400);
    expect((await fetch(`${s.base}/api/workspaces`, { method: "POST", headers: s.W, body: "{nope" })).status).toBe(400);
    expect((await fetch(`${s.base}/api/workspaces`, { method: "POST", headers: s.W, body: JSON.stringify({ name: "x".repeat(3000) }) })).status).toBe(413);
    expect((await fetch(`${s.base}/api/workspaces`, { method: "PUT", headers: s.W })).status).toBe(405);
    s.stop();
  });

  test("the list is newest first; search is a case-insensitive substring; limit and cursor page through it", async () => {
    const s = start();
    const names = ["Alpha study", "beta Study", "Gamma", "100% done", "a_b", "Ärger"];
    const made: Workspace[] = [];
    for (const n of names) made.push(await s.make(n));
    const get = async (q: string) => (await (await fetch(`${s.base}/api/workspaces${q}`)).json()) as { workspaces: Workspace[]; next: string | null; total: number };
    const all = await get("");
    expect(all.total).toBe(7);                                                   // six and the Playground
    expect(all.workspaces.map((w) => w.name)).toEqual([...names].reverse().concat("Playground"));
    expect((await get("?search=STUDY")).workspaces.map((w) => w.name)).toEqual(["beta Study", "Alpha study"]);
    expect((await get("?search=%25")).workspaces.map((w) => w.name)).toEqual(["100% done"]);   // % and _ are plain characters
    expect((await get("?search=_")).workspaces.map((w) => w.name)).toEqual(["a_b"]);
    expect((await get("?search=ärger")).workspaces.map((w) => w.name)).toEqual(["Ärger"]);
    expect(await get("?search=nothing")).toEqual({ workspaces: [], next: null, total: 0 });
    const p1 = await get("?limit=3");
    expect(p1.workspaces.map((w) => w.name)).toEqual(["Ärger", "a_b", "100% done"]);
    expect(p1.next).toBeTruthy(); expect(p1.total).toBe(7);
    const p2 = await get(`?limit=3&cursor=${p1.next}`);
    expect(p2.workspaces.map((w) => w.name)).toEqual(["Gamma", "beta Study", "Alpha study"]);
    const p3 = await get(`?limit=3&cursor=${p2.next}`);
    expect(p3.workspaces.map((w) => w.name)).toEqual(["Playground"]);
    expect(p3.next).toBeNull();
    const ps = await get("?search=study&limit=1");
    expect(ps.workspaces).toHaveLength(1); expect(ps.total).toBe(2);
    expect((await get(`?search=study&limit=1&cursor=${ps.next}`)).workspaces.map((w) => w.name)).toEqual(["Alpha study"]);
    for (const q of ["?limit=0", "?limit=101", "?limit=x", "?cursor=!!"]) expect((await fetch(`${s.base}/api/workspaces${q}`)).status).toBe(400);
    expect(made.length).toBe(6);
    s.stop();
  });

  test("get answers the record, or 404 no_workspace", async () => {
    const s = start(), w = await s.make("One");
    expect(await (await fetch(s.ws(w.id))).json()).toEqual(w);
    const none = await fetch(s.ws("11111111-2222-4333-8444-555555555555"));
    expect(none.status).toBe(404);
    expect((await none.json()).error.code).toBe("no_workspace");
    s.stop();
  });

  test("the old addresses of the single scene answer 404 with the way to the new ones", async () => {
    const s = start();
    for (const [m, p] of [["GET", "live"], ["POST", "command"], ["POST", "mcp"], ["POST", "follow"], ["GET", "trace"], ["POST", "picture"]]) {
      const r = await fetch(`${s.base}/api/${p}`, { method: m, headers: s.W, ...(m === "POST" ? { body: "{}" } : {}) });
      expect(r.status).toBe(404);
      const e = (await r.json()).error;
      expect(e.code).toBe("not_found");
      expect(e.hint).toContain(`/api/workspaces/<id>/${p}`);
    }
    s.stop();
  });
});

describe("rename and delete", () => {
  test("a rename reaches every open stream of that workspace, and no other", async () => {
    const s = start(), a = await s.make("Before"), other = await s.make("Other");
    const x = s.live(a.id), y = s.live(a.id), z = s.live(other.id);
    await Promise.all([x.ready, y.ready, z.ready]);
    expect(x.events[0].data.workspace).toMatchObject({ id: a.id, name: "Before" });          // the session event names the workspace
    await Bun.sleep(5);
    const r = await fetch(s.ws(a.id), { method: "PATCH", headers: s.W, body: JSON.stringify({ name: "  After  " }) });
    expect(r.status).toBe(200);
    const w = (await r.json()) as Workspace;
    expect(w).toMatchObject({ id: a.id, name: "After", created: a.created });
    expect(w.changed >= a.changed).toBe(true);
    for (const l of [x, y]) expect((await l.waitFor((e) => e.event === "workspace")).data).toEqual(w);
    await Bun.sleep(50);
    expect(z.of("workspace")).toEqual([]);
    expect((await (await fetch(s.ws(a.id))).json()).name).toBe("After");
    // bad renames
    for (const body of [{ name: "" }, { name: "x".repeat(81) }, {}, { name: 4 }]) expect((await fetch(s.ws(a.id), { method: "PATCH", headers: s.W, body: JSON.stringify(body) })).status).toBe(400);
    expect((await fetch(s.ws(a.id), { method: "PATCH", headers: { "content-type": "application/json" }, body: "{\"name\":\"x\"}" })).status).toBe(400);
    expect((await fetch(s.ws("11111111-2222-4333-8444-555555555555"), { method: "PATCH", headers: s.W, body: JSON.stringify({ name: "x" }) })).status).toBe(404);
    [x, y, z].forEach((l) => l.close()); s.stop();
  });

  test("a delete tells and closes every stream, answers 404 afterwards and sets the folder aside", async () => {
    const s = start(), a = await s.make("Doomed"), keep = await s.make("Kept");
    await s.command(a.id, lower);
    const x = s.live(a.id), y = s.live(a.id), k = s.live(keep.id);
    await Promise.all([x.ready, y.ready, k.ready]);
    expect((await fetch(s.ws(a.id), { method: "DELETE" })).status).toBe(400);                  // no X-Synergon
    const r = await fetch(s.ws(a.id), { method: "DELETE", headers: { "x-synergon": "1" } });
    expect(r.status).toBe(204);
    for (const l of [x, y]) { expect((await l.waitFor((e) => e.event === "deleted")).data).toEqual({ id: a.id }); expect(await l.waitEnded()).toBe(true); }
    expect(k.ended).toBe(false);
    for (const sub of ["", "/live", "/trace"]) expect((await fetch(s.ws(a.id) + sub)).status).toBe(404);
    expect((await s.command(a.id, { id: "scene.summary" })).error.code).toBe("no_workspace");
    expect((await fetch(s.ws(a.id), { method: "DELETE", headers: { "x-synergon": "1" } })).status).toBe(404);
    expect((await (await fetch(`${s.base}/api/workspaces`)).json()).workspaces.map((w: Workspace) => w.id)).not.toContain(a.id);
    expect(existsSync(join(s.dataDir, "workspaces", a.id))).toBe(false);
    // the folder is in deleted/, with the scene as it was (the change made just before is in it)
    expect(JSON.parse(readFileSync(join(s.dataDir, "deleted", a.id, "doc.json"), "utf8")).version).toBe(1);
    await Bun.sleep(400);                                                                       // nothing is written back to workspaces/
    expect(existsSync(join(s.dataDir, "workspaces", a.id))).toBe(false);
    expect(s.api.loaded()).not.toContain(a.id);
    // the one kept still works
    expect((await s.command(keep.id, { id: "scene.summary" })).ok).toBe(true);
    [k].forEach((l) => l.close()); s.stop();
  });
});

describe("bringing a deleted workspace back by hand", () => {
  test("moving the folder back and adding its row makes the old link work again, with the scene as it was", async () => {
    const s = start(), a = await s.make("Back again");
    await s.command(a.id, { ...lower, group: "g" });
    expect((await fetch(s.ws(a.id), { method: "DELETE", headers: { "x-synergon": "1" } })).status).toBe(204);
    expect((await fetch(s.ws(a.id))).status).toBe(404);
    renameSync(join(s.dataDir, "deleted", a.id), join(s.dataDir, "workspaces", a.id));
    const db = new Database(join(s.dataDir, "workspaces.sqlite"));                    // what the wiki page says to do, with sqlite3 or bun:sqlite
    db.run("INSERT INTO workspaces (id, name, created, changed) VALUES (?1, ?2, ?3, ?3)", [a.id, "Back again", a.created]);
    db.close();
    expect((await (await fetch(s.ws(a.id))).json()).name).toBe("Back again");
    expect((await s.command(a.id, { id: "scene.summary" })).version).toBe(1);
    expect((await s.command(a.id, { id: "history.undo", args: { group: "g" } })).ok).toBe(true);
    s.stop();
  });
});

describe("workspaces are kept apart", () => {
  test("a change in one never shows in the other; undo works per workspace", async () => {
    const s = start(), a = await s.make("A"), b = await s.make("B");
    const la = s.live(a.id), lb = s.live(b.id);
    await Promise.all([la.ready, lb.ready]);
    const r1 = await s.command(a.id, { ...lower, group: "lower-monitor" });
    expect(r1).toMatchObject({ ok: true, version: 1 });
    await la.waitFor((e) => e.event === "applied" && e.data.version === 1);
    await Bun.sleep(60);
    expect(lb.of("applied")).toEqual([]);
    expect((await s.command(b.id, { id: "scene.summary" })).version).toBe(0);
    expect((await s.command(a.id, { id: "scene.summary" })).version).toBe(1);
    // B gets a change of its own: version 1 there, and an undo in A leaves it alone
    expect(await s.command(b.id, { id: "pose.set", args: { joints: { J_mon_tilt: 0 } }, group: "tilt" })).toMatchObject({ ok: true, version: 1 });
    const undo = await s.command(a.id, { id: "history.undo", args: { group: "lower-monitor" } });
    expect(undo).toMatchObject({ ok: true, version: 2 });
    await la.waitFor((e) => e.event === "applied" && e.data.version === 2);
    expect((await s.command(b.id, { id: "scene.summary" })).version).toBe(1);
    // a group name of A is no group of B
    expect((await s.command(b.id, { id: "history.undo", args: { group: "lower-monitor" } })).ok).toBe(false);
    // each has its own trace
    const ta = (await (await fetch(`${s.ws(a.id)}/trace`)).json()).traces, tb = (await (await fetch(`${s.ws(b.id)}/trace`)).json()).traces;
    expect(ta.length).toBeGreaterThan(0); expect(tb.every((t: any) => t.command !== "history.undo" || !t.ok)).toBe(true);
    expect(ta.some((t: any) => t.command === "history.undo" && t.ok)).toBe(true);
    // documents are in their own folders
    await Bun.sleep(300);
    expect(JSON.parse(readFileSync(join(s.dataDir, "workspaces", b.id, "doc.json"), "utf8")).version).toBe(1);
    [la, lb].forEach((l) => l.close()); s.stop();
  });

  test("a stale check, a view's session code and a picture belong to one workspace", async () => {
    const s = start(), a = await s.make("A"), b = await s.make("B");
    const la = s.live(a.id), lb = s.live(b.id);
    await Promise.all([la.ready, lb.ready]);
    expect((await s.command(b.id, { id: "view.set", args: { view: "top" }, ...({ session: la.code } as any) } as any)).ok).toBeDefined();
    // a code of A's page names no page of B
    const r = await fetch(`${s.ws(b.id)}/command`, { method: "POST", headers: s.W, body: JSON.stringify({ id: "view.set", args: { view: "top" }, session: la.code }) }).then((x) => x.json());
    expect(r.error.code).toBe("unknown_session");
    const ok = await fetch(`${s.ws(a.id)}/command`, { method: "POST", headers: s.W, body: JSON.stringify({ id: "view.set", args: { view: "top" }, session: la.code }) }).then((x) => x.json());
    expect(ok.ok).toBe(true);
    await la.waitFor((e) => e.event === "view");
    await Bun.sleep(30);
    expect(lb.of("view")).toEqual([]);
    [la, lb].forEach((l) => l.close()); s.stop();
  });

  test("each workspace has its own agent endpoint", async () => {
    const s = start(), a = await s.make("A"), b = await s.make("B");
    const init = await s.mcp(a.id, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result.serverInfo.name).toBe("synergon");
    expect(init.body.result.instructions).toContain("/api/workspaces/");
    expect(init.body.result.instructions).not.toContain(a.name + " ");                           // no workspace name reaches the model's instructions
    const call = (id: string, name: string, args: unknown, sid?: string) => s.mcp(id, "tools/call", { name, arguments: args }, sid);
    const said = await call(a.id, "adjust", { target: "monitor height", by: "-3 cm" }, init.sid);
    expect(said.body.result.isError).toBeUndefined();
    const stateA = (await call(a.id, "state", {})).body.result.content[0].text, stateB = (await call(b.id, "state", {})).body.result.content[0].text;
    expect(stateA).not.toBe(stateB);
    expect((await s.command(a.id, { id: "scene.summary" })).version).toBe(1);
    expect((await s.command(b.id, { id: "scene.summary" })).version).toBe(0);
    const undone = await call(a.id, "undo", {});
    expect(undone.body.result.isError).toBeUndefined();
    expect((await s.command(a.id, { id: "scene.summary" })).version).toBe(2);
    expect((await s.command(b.id, { id: "scene.summary" })).version).toBe(0);
    // GET is not offered, DELETE ends the session, an unknown workspace is 404
    expect((await fetch(`${s.ws(a.id)}/mcp`)).status).toBe(405);
    expect((await fetch(`${s.ws(a.id)}/mcp`, { method: "DELETE", headers: { "mcp-session-id": init.sid } })).status).toBe(204);
    expect((await fetch(`${s.ws("11111111-2222-4333-8444-555555555555")}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(404);
    s.stop();
  });
});

describe("limits", () => {
  const xff = (ip: string) => ({ "x-forwarded-for": ip });
  test("creation per visitor, per network block and per day; renames and deletes are edits", async () => {
    const s = deployed({ workspacesPerHourPerVisitor: 2, workspacesPerHourPerBlock: 3, workspacesPerDayTotal: 5 });
    expect((await s.create("1", xff("203.0.113.7"))).status).toBe(201);
    expect((await s.create("2", xff("203.0.113.7"))).status).toBe(201);
    const third = await s.create("3", xff("203.0.113.7"));
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect((await s.create("4", xff("203.0.113.8"))).status).toBe(201);                         // another visitor of the same block: the block's third
    const block = await s.create("5", xff("203.0.113.9"));
    expect(block.status).toBe(429);
    expect((await block.json()).error.message).toContain("network block");
    expect((await s.create("6", xff("198.51.100.1"))).status).toBe(201);
    expect((await s.create("7", xff("198.51.100.2"))).status).toBe(201);
    const day = await s.create("8", xff("192.0.2.1"));                                          // five were made today (the Playground, made at the start, is not counted)
    expect(day.status).toBe(429);
    expect((await day.json()).error.message).toContain("a day");
    s.stop();
  });

  test("the daily total in all", async () => {
    const s = deployed({ workspacesPerDayTotal: 3 });
    for (let i = 0; i < 3; i++) expect((await s.create(`n${i}`, xff(`203.0.${i}.1`))).status).toBe(201);
    const r = await s.create("late", xff("203.0.9.1"));
    expect(r.status).toBe(429);
    expect((await r.json()).error.message).toContain("a day");
    s.stop();
  });

  test("at most workspacesMax in all, and none when the disk is nearly full (507 full)", async () => {
    const s = deployed({ workspacesMax: 3 });                                                   // the Playground and two more
    expect((await s.create("a", xff("203.0.1.1"))).status).toBe(201);
    expect((await s.create("b", xff("203.0.2.1"))).status).toBe(201);
    const r = await s.create("c", xff("203.0.3.1"));
    expect(r.status).toBe(507);
    expect((await r.json()).error.code).toBe("full");
    expect(s.api.list().total).toBe(3);
    s.stop();
    const d = deployed({ diskMinFreeBytes: Number.MAX_SAFE_INTEGER });
    const full = await d.create("x");
    expect(full.status).toBe(507);
    expect((await full.json()).error.code).toBe("full");
    expect((await fetch(`${d.base}/api/workspaces`)).status).toBe(200);                         // reading still works
    d.stop();
  });

  test("a local server has no creation limits", async () => {
    const s = start({ limits: { workspacesPerHourPerVisitor: 1, workspacesMax: 1 } });
    for (let i = 0; i < 3; i++) expect((await s.create(`n${i}`)).status).toBe(201);
    s.stop();
  });

  test("a rename or delete counts against the visitor's edits", async () => {
    const s = deployed({ editsPerMinutePerVisitor: 2 }), w = await s.make("x", xff("203.0.113.5"));
    const patch = (n: string) => fetch(s.ws(w.id), { method: "PATCH", headers: { ...s.W, ...xff("203.0.113.5") }, body: JSON.stringify({ name: n }) });
    expect((await patch("a")).status).toBe(200);
    expect((await patch("b")).status).toBe(200);
    expect((await patch("c")).status).toBe(429);
    expect((await fetch(s.ws(w.id), { method: "DELETE", headers: { "x-synergon": "1", ...xff("203.0.113.5") } })).status).toBe(429);
    expect((await fetch(s.ws(w.id), { method: "DELETE", headers: { "x-synergon": "1", ...xff("203.0.113.6") } })).status).toBe(204);
    s.stop();
  });

  test("every workspace's live streams count against the same limits", async () => {
    const s = deployed({ streamsTotal: 2 }), a = await s.make("A"), b = await s.make("B");
    const x = s.live(a.id, xff("203.0.113.1")), y = s.live(b.id, xff("203.0.113.2"));
    await Promise.all([x.ready, y.ready]);
    const z = s.live(a.id, xff("203.0.113.3")); await z.ready;
    expect(z.status).toBe(503);
    [x, y, z].forEach((l) => l.close()); s.stop();
  });
});

describe("ids", () => {
  test("only a random UUID reaches the disk; everything else is 404 no_workspace", async () => {
    for (const mode of ["local", "deployed"] as const) {
      const s = start({ mode, ...(mode === "deployed" ? { limits: { diskMinFreeBytes: 0, diskMinFreeFraction: 0 } } : {}) }), real = await s.make("Real");
      const before = readdirSync(s.dataDir).sort();
      const bad = [
        "manage", "..", "..%2fsecret", "%2e%2e", "%2e%2e%2fsecret", "....//", "%00", `${real.id}%00`, real.id.toUpperCase(),
        real.id.replace(/-/g, ""), "11111111-2222-1333-8444-555555555555", "11111111-2222-4333-c444-555555555555", "x".repeat(300), "secret", "workspaces.sqlite", "deleted", "playground-2", "Playground",
        ...(mode === "deployed" ? ["playground"] : []),
      ];
      for (const id of bad) {
        for (const [m, sub] of [["GET", ""], ["GET", "/live"], ["POST", "/command"], ["PATCH", ""], ["DELETE", ""], ["POST", "/mcp"], ["GET", "/trace"]] as const) {
          const url = `${s.base}/api/workspaces/${id}${sub}`, init = { method: m, headers: { ...s.W, host: new URL(s.base).host }, ...(m === "POST" || m === "PATCH" ? { body: "{\"name\":\"x\"}" } : {}) };
          const r = (await s.api.fetch(new Request(url, init), "127.0.0.1"))!;                    // not through the test's alias shim: a deployed server has no `playground`
          expect([404, 400, 405].includes(r.status), `${m} ${id}${sub} -> ${r.status}`).toBe(true);
          if (r.status === 404 && /^[A-Za-z0-9-]+$/.test(id)) expect((await r.json()).error.code).toBe("no_workspace");
        }
      }
      expect(readdirSync(s.dataDir).sort()).toEqual(before);                          // nothing was made, moved or opened outside
      expect(existsSync(join(s.dataDir, "deleted"))).toBe(false);
      expect((await fetch(s.ws(real.id))).status).toBe(200);
      s.stop();
    }
  });

  test("the store refuses a path built from anything but an id", () => {
    const dataDir = tempDir(), store = openStore(dataDir);
    expect(store.get("../x")).toBeNull();
    expect(store.remove("../x")).toBe(false);
    expect(store.rename("manage", "x")).toBeNull();
    store.close();
    expect(isWorkspaceId(crypto.randomUUID())).toBe(true);
    expect(isWorkspaceId("MANAGE")).toBe(false);
  });

  test("cleanName", () => {
    expect(cleanName("  a  b ")).toBe("a  b");
    expect(cleanName(undefined, "dflt")).toBe("dflt");
    expect(() => cleanName("")).toThrow(NameError);
    expect(() => cleanName("x".repeat(81))).toThrow(NameError);
    expect(Array.from(cleanName("😀".repeat(80)))).toHaveLength(80);                           // characters, not bytes
  });
});

describe("loading and dropping", () => {
  test("a workspace is loaded by its first request and dropped, written, after it has been idle", async () => {
    const s = start({ limits: { workspaceIdleMs: 150, workspaceSweepMs: 30 } }), a = await s.make("A");
    expect(s.api.loaded()).toEqual([]);                                                         // nothing is in memory until it is asked for
    await s.command(a.id, { ...lower, group: "g" });
    expect(s.api.loaded()).toEqual([a.id]);
    for (let t = 0; t < 100 && s.api.loaded().length; t++) await Bun.sleep(20);
    expect(s.api.loaded()).toEqual([]);                                                         // dropped
    expect(JSON.parse(readFileSync(join(s.dataDir, "workspaces", a.id, "doc.json"), "utf8")).version).toBe(1);
    expect((await s.command(a.id, { id: "scene.summary" })).version).toBe(1);                   // loaded again from disk, history and all
    expect((await s.command(a.id, { id: "history.undo", args: { group: "g" } })).ok).toBe(true);
    expect(s.api.loaded()).toEqual([a.id]);
    s.stop();
  });

  test("a workspace with an open stream stays; it goes once the stream is closed", async () => {
    const s = start({ limits: { workspaceIdleMs: 100, workspaceSweepMs: 25 } }), a = await s.make("A");
    const l = s.live(a.id); await l.ready;
    await Bun.sleep(350);
    expect(s.api.loaded()).toEqual([a.id]);
    l.close();
    for (let t = 0; t < 100 && s.api.loaded().length; t++) await Bun.sleep(20);
    expect(s.api.loaded()).toEqual([]);
    s.stop();
  });

  test("a rename and the last edit show in the list without loading the workspace; an edit moves `changed`", async () => {
    const s = start(), a = await s.make("A");
    await Bun.sleep(5);
    await s.command(a.id, lower);
    await Bun.sleep(300);
    const w = (await (await fetch(s.ws(a.id))).json()) as Workspace;
    expect(w.changed > a.changed).toBe(true);
    s.stop();
  });

  test("at most workspacesLoaded are in memory: the least recently used goes first, and a workspace with a stream is never dropped", async () => {
    const s = start({ limits: { workspacesLoaded: 2 } }), a = await s.make("A"), b = await s.make("B"), c = await s.make("C");
    await s.command(a.id, lower); await s.command(b.id, { id: "scene.summary" });
    await s.command(a.id, { id: "scene.summary" });                                              // b is now the older
    await s.command(c.id, { id: "scene.summary" });
    expect(s.api.loaded().sort()).toEqual([a.id, c.id].sort());
    expect((await s.command(a.id, { id: "scene.summary" })).version).toBe(1);
    const la = s.live(a.id), lc = s.live(c.id); await Promise.all([la.ready, lc.ready]);
    const r = await fetch(`${s.ws(b.id)}/live`);                                                 // no place can be made
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("busy");
    la.close(); lc.close();
    s.stop();
  });

  test("closing the server writes what is pending", async () => {
    const dataDir = tempDir(), s = start({ dataDir, limits: { saveEveryMs: 60_000 } }), a = await s.make("A");
    await s.command(a.id, lower); await s.command(a.id, { id: "pose.set", args: { joints: { J_mon_tilt: 0 } } });
    s.stop();
    expect(JSON.parse(readFileSync(join(dataDir, "workspaces", a.id, "doc.json"), "utf8")).version).toBe(2);
  });
});
