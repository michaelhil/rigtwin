// bun test server — integration test of the rigtwin server over real HTTP, with two (or more) clients
// reading the live channel: a change by one appears on the other's stream; a stale change is refused
// with a reason; undo by group; a dropped stream resumes with Last-Event-ID; a server restart (a real
// process, killed) with two clients reconnecting and catching up from doc.json; a view command reaches
// only the addressed session; the deployed-mode guards (body size, streams, edit rate, disk) and none
// locally; the release watch, in process and with the bundled server in the deploy's folder layout.
import { test, expect, describe, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, symlinkSync, renameSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync, type Subprocess } from "bun";
import { createApi, visitorKey, type ApiOptions } from "./server.ts";
import { call } from "../tools/rig.ts";

const ROOT = join(import.meta.dir, "..");
const ASSET = join(ROOT, "assets", "rig-b", "build");
const temps: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "rigtwin-server-test-")); temps.push(d); return d; };
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

/** An in-process server on a free port. */
function start(o: Partial<ApiOptions> = {}) {
  const api = createApi({ dataDir: o.dataDir ?? tempDir(), assetDir: ASSET, mode: "local", revision: "test", ...o });
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 40, async fetch(req, s) { return (await api.fetch(req, s.requestIP(req)?.address ?? "")) ?? new Response("not found", { status: 404 }); } });
  const base = `http://127.0.0.1:${srv.port}`;
  return { base, api, stop: () => { api.close(); srv.stop(true); } };
}

type Ev = { event: string; id?: string; data: any };
/** A live-channel reader: parses the server-sent events of GET api/live into `events`. */
class Live {
  events: Ev[] = []; lastId: string | null = null; code: string | null = null; status = 0; error: any = null; ended = false;
  private ctl = new AbortController();
  ready: Promise<void>;
  constructor(public base: string, o: { lastId?: string | null; session?: string; since?: number; xff?: string } = {}) {
    let opened!: () => void;
    this.ready = new Promise((r) => (opened = r));
    this.run(o, opened);
  }
  private async run(o: { lastId?: string | null; session?: string; since?: number; xff?: string }, opened: () => void) {
    const headers: Record<string, string> = {};
    if (o.lastId) headers["last-event-id"] = o.lastId;
    if (o.xff) headers["x-forwarded-for"] = o.xff;
    try {
      const q = new URLSearchParams({ ...(o.session ? { session: o.session } : {}), ...(o.since !== undefined ? { since: String(o.since) } : {}) }).toString();
      const res = await fetch(`${this.base}/api/live${q ? `?${q}` : ""}`, { headers, signal: this.ctl.signal });
      this.status = res.status;
      if (!res.ok) { this.error = await res.json(); opened(); this.ended = true; return; }
      const reader = res.body!.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) { this.block(buf.slice(0, i)); buf = buf.slice(i + 2); if (this.code) opened(); }
      }
    } catch { /* aborted or dropped */ }
    this.ended = true; opened();
  }
  private block(b: string) {
    let event = "message", id: string | undefined;
    const data: string[] = [];
    for (const line of b.split("\n")) {
      if (line.startsWith(":")) { this.events.push({ event: "comment", data: line.slice(1) }); continue; }
      const k = line.slice(0, line.indexOf(":")), v = line.slice(line.indexOf(":") + 1).replace(/^ /, "");
      if (k === "event") event = v; else if (k === "id") id = v; else if (k === "data") data.push(v);
    }
    if (!data.length) return;
    const d = JSON.parse(data.join("\n"));
    if (id !== undefined) this.lastId = id;
    if (event === "session") this.code = d.code;
    this.events.push({ event, id, data: d });
  }
  of = (event: string) => this.events.filter((e) => e.event === event);
  async waitFor(pred: (e: Ev) => boolean, ms = 3000): Promise<Ev> {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await Bun.sleep(10)) { const e = this.events.find(pred); if (e) return e; }
    throw new Error(`timed out; events so far: ${JSON.stringify(this.events.map((e) => e.event))}`);
  }
  close() { this.ctl.abort(); }
}
const applied = (version: number) => (e: Ev) => e.event === "applied" && e.data.version === version;
const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/command`, { method: "POST", headers: { "x-rigtwin": "1", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("two clients on one server", () => {
  test("health, catalogue and the first events", async () => {
    const s = start();
    const h = await (await fetch(`${s.base}/api/health`)).json();
    expect(h).toMatchObject({ ok: true, revision: "test", format: "rigtwin-scene/1", mode: "local", asset: { name: "rig-b" } });
    expect(typeof h.uptime_s).toBe("number");
    const c = await (await fetch(`${s.base}/api/commands`)).json();
    expect(c.commands.map((x: any) => x.id)).toContain("pose.set");
    const a = new Live(s.base);
    await a.ready;
    expect(a.events[0].event).toBe("session");
    expect(a.code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(a.events[1]).toMatchObject({ event: "snapshot", id: "0" });
    expect(a.events[1].data.doc.schema).toBe("rigtwin-scene/1");
    expect((await fetch(`${s.base}/api/nothing`)).status).toBe(404);
    expect(await s.api.fetch(new Request(`${s.base}/index.html`), "127.0.0.1")).toBeUndefined();
    a.close(); s.stop();
  });

  test("a change by one appears on the other's stream; a stale change is refused with a reason; undo by group", async () => {
    const s = start(), a = new Live(s.base), b = new Live(s.base);
    await Promise.all([a.ready, b.ready]);
    // the agent lowers the monitor (as a request named lower-monitor)
    const r1 = await call("pose.set", { joints: { J_mon_height: -0.03 } }, { server: s.base, group: "lower-monitor", client: "agent" });
    expect(r1.ok).toBe(true);
    expect(r1.server).toContain("(local, revision test)");
    const ea = await a.waitFor(applied(1)), eb = await b.waitFor(applied(1));
    expect(ea.data).toEqual(eb.data);
    expect(ea.data).toMatchObject({ version: 1, group: "lower-monitor", command: "pose.set", actor: { kind: "agent" }, changes: [{ joint: "J_mon_height", before: 0, after: -0.03 }] });
    expect(ea.data.actor.label).toMatch(/^Claude Code · [0-9a-f]{4}$/);
    expect(ea.id).toBe("1");
    // a person in browser B had version 0 and moves the same joint: refused, with the reason
    const stale = await (await post(s.base, { id: "pose.set", args: { joints: { J_mon_height: -0.05 } }, expectedVersion: 0 }, { "x-rigtwin-client": "person", "x-rigtwin-client-id": "b0b0b0b0" })).json();
    expect(stale.ok).toBe(false);
    expect(stale.error.code).toBe("stale");
    expect(stale.error.message).toContain("J_mon_height was changed by Claude Code");
    expect(stale.server).toEqual({ mode: "local", revision: "test" });
    // the same person moves another joint, based on version 0: accepted, and seen by A with the person's label
    const ok = await (await post(s.base, { id: "pose.set", args: { joints: { J_mon_pan: 5 } }, expectedVersion: 0 }, { "x-rigtwin-client": "person", "x-rigtwin-client-id": "b0b0b0b0" })).json();
    expect(ok).toMatchObject({ ok: true, version: 2, recorded: 2, you: { kind: "person" } });
    expect((await a.waitFor(applied(2))).data.actor).toEqual(ok.you);
    // a second change in the same request, then undo the request as a whole
    expect((await call("pose.set", { joints: { J_mon_tilt: 0 } }, { server: s.base, group: "lower-monitor", client: "agent" })).version).toBe(3);
    const u = await call("history.undo", { group: "lower-monitor" }, { server: s.base, client: "agent" });
    expect(u).toMatchObject({ ok: true, version: 4, result: { undid: [1, 3] } });
    const ub = await b.waitFor(applied(4));
    expect(ub.data.undoes).toEqual([1, 3]);
    const sum = await call("scene.summary", {}, { server: s.base });
    expect(sum.result.moved.map((m: any) => m.joint)).toEqual(["J_mon_pan"]);
    // stale undo: someone moved a joint of the request afterwards
    await call("pose.set", { joints: { J_mon_height: -0.02 } }, { server: s.base, group: "again", client: "agent" });
    await post(s.base, { id: "pose.set", args: { joints: { J_mon_height: -0.04 } } }, { "x-rigtwin-client": "person" });
    const su = await call("history.undo", { group: "again" }, { server: s.base, client: "agent" });
    expect(su.ok).toBe(false);
    expect(su.error!.code).toBe("stale");
    // doc.json holds the same as the streams
    a.close(); b.close(); s.stop();
  });

  test("a dropped stream resumes with Last-Event-ID (and keeps its session code); far behind gets a snapshot", async () => {
    const s = start({ limits: { snapshotBehind: 5 } }), a = new Live(s.base);
    await a.ready;
    await call("pose.set", { joints: { J_mon_height: -0.01 } }, { server: s.base });
    await a.waitFor(applied(1));
    const last = a.lastId, code = a.code!;
    a.close();
    await Bun.sleep(30);
    await call("pose.set", { joints: { J_mon_height: -0.02 } }, { server: s.base });
    await call("pose.set", { joints: { J_mon_pan: 3 } }, { server: s.base });
    const a2 = new Live(s.base, { lastId: last, session: code });
    await a2.waitFor(applied(3));
    expect(a2.code).toBe(code);
    expect(a2.of("snapshot")).toEqual([]);
    expect(a2.of("applied").map((e) => e.data.version)).toEqual([2, 3]);
    // the same with ?since= (a reconnect made by a new EventSource, which cannot set Last-Event-ID)
    const a2b = new Live(s.base, { since: Number(last) });
    await a2b.waitFor(applied(3));
    expect(a2b.of("applied").map((e) => e.data.version)).toEqual([2, 3]);
    a2b.close();
    // up to date: nothing is sent again
    const a3 = new Live(s.base, { lastId: "3" });
    await a3.ready; await Bun.sleep(50);
    expect(a3.events.filter((e) => e.event !== "session" && e.event !== "comment")).toEqual([]);
    // more than `snapshotBehind` entries behind, or from the future: a fresh snapshot
    for (let i = 0; i < 6; i++) await call("pose.set", { joints: { J_mon_pan: i + 4 } }, { server: s.base });
    const far = new Live(s.base, { lastId: "1" }), future = new Live(s.base, { lastId: "99" });
    expect((await far.waitFor((e) => e.event === "snapshot")).id).toBe("9");
    expect((await future.waitFor((e) => e.event === "snapshot")).data.doc.version).toBe(9);
    expect(far.of("applied")).toEqual([]);
    for (const l of [a2, a3, far, future]) l.close();
    s.stop();
  });

  test("a view command reaches only the addressed session", async () => {
    const s = start(), a = new Live(s.base), b = new Live(s.base);
    await Promise.all([a.ready, b.ready]);
    const r = await call("view.set", { view: "operator" }, { server: s.base, viewer: a.code!.toLowerCase(), client: "agent" });
    expect(r.ok).toBe(true);
    expect((await a.waitFor((e) => e.event === "view")).data).toEqual({ id: "view.set", args: { view: "operator" } });
    await call("view.show", { only: ["stand"] }, { server: s.base, viewer: a.code! });
    await a.waitFor((e) => e.event === "view" && e.data.id === "view.show");
    await Bun.sleep(50);
    expect(b.of("view")).toEqual([]);
    const none = await call("view.set", { view: "top" }, { server: s.base, viewer: "ZZZZZZZZ" });
    expect(none.error!.code).toBe("unknown_session");
    expect(r.version).toBe(0);                                   // view commands change nothing in the document
    a.close(); b.close(); s.stop();
  });

  test("heartbeats arrive", async () => {
    const s = start({ limits: { heartbeatMs: 40 } }), a = new Live(s.base);
    await a.ready;
    await a.waitFor((e) => e.event === "comment" && e.data === "hb", 1000);
    a.close(); s.stop();
  });
});

describe("restart", () => {
  test("a server restart with two clients open loses nothing; both catch up from doc.json", async () => {
    const dataDir = tempDir();
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") }), port = probe.port;
    probe.stop(true);
    const base = `http://127.0.0.1:${port}`;
    const launch = async (): Promise<Subprocess<"ignore", "pipe", "pipe">> => {
      const p = spawn(["bun", join(ROOT, "server", "server.ts"), "--port", String(port), "--data", dataDir, "--asset", ASSET, "--mode", "local", "--revision", "restart-test"], { stdout: "pipe", stderr: "pipe" });
      const reader = p.stdout.getReader(), { value } = await reader.read();
      reader.releaseLock();
      expect(JSON.parse(new TextDecoder().decode(value))).toEqual({ listening: port });
      return p;
    };
    let p = await launch();
    const a = new Live(base), b = new Live(base);
    await Promise.all([a.ready, b.ready]);
    await call("pose.set", { joints: { J_mon_height: -0.03 } }, { server: base, group: "lower-monitor", client: "agent" });
    await call("pose.set", { joints: { J_mon_tilt: 0 } }, { server: base, client: "agent" });
    await Promise.all([a.waitFor(applied(2)), b.waitFor(applied(2))]);
    const lastA = a.lastId, lastB = b.lastId, codeA = a.code!, codeB = b.code!;
    // the process is stopped as systemd or a release switch stops it (pending writes are flushed)
    p.kill("SIGTERM"); await p.exited;
    for (let t = 0; t < 100 && !(a.ended && b.ended); t++) await Bun.sleep(20);
    expect(a.ended && b.ended).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, "playground", "doc.json"), "utf8")).version).toBe(2);
    p = await launch();
    // a change arrives before the browsers are back
    await call("pose.set", { joints: { J_mon_pan: 8 } }, { server: base, client: "agent" });
    const a2 = new Live(base, { lastId: lastA, session: codeA }), b2 = new Live(base, { lastId: lastB, session: codeB });
    await Promise.all([a2.waitFor(applied(3)), b2.waitFor(applied(3))]);
    expect([a2.code, b2.code]).toEqual([codeA, codeB]);
    expect(a2.of("snapshot")).toEqual([]);
    expect(a2.of("applied").map((e) => e.data.version)).toEqual([3]);
    // and the request made before the restart can still be undone as a whole
    const u = await call("history.undo", { group: "lower-monitor" }, { server: base, client: "agent" });
    expect(u).toMatchObject({ ok: true, version: 4, server: `${base} (local, revision restart-test)` });
    await Promise.all([a2.waitFor(applied(4)), b2.waitFor(applied(4))]);
    // doc.json is complete JSON and no temporary file is left
    expect(readdirSync(join(dataDir, "playground"))).toEqual(["doc.json"]);
    // a crash (no warning) after the write interval loses nothing either
    await Bun.sleep(400); p.kill(9); await p.exited;
    expect(JSON.parse(readFileSync(join(dataDir, "playground", "doc.json"), "utf8")).version).toBe(4);
    a2.close(); b2.close();
  }, 20000);
});

describe("deployed-mode guards", () => {
  const deployed = (limits: ApiOptions["limits"] = {}) => start({ mode: "deployed", limits: { diskMinFreeBytes: 0, diskMinFreeFraction: 0, ...limits } });
  test("body too large", async () => {
    const s = deployed(), big = JSON.stringify({ id: "scene.summary", args: {}, pad: "x".repeat(65 * 1024) });
    const r = await post(s.base, big);
    expect(r.status).toBe(413);
    expect((await r.json()).error.code).toBe("too_large");
    s.stop();
    const l = start();                                      // locally there is no limit (the command is looked at)
    const rl = await post(l.base, big);
    expect(rl.status).toBe(200);
    l.stop();
  });
  test("a stream is ended after its byte budget; the client resumes with since= and gets only what it missed; the place drains", async () => {
    const s = deployed({ streamBytesMax: 6000, streamsTotal: 3, streamDrainMs: 300, editsPerSecondTotal: 1000, editsPerSecondPerBlock: 1000 });
    const a = new Live(s.base, { xff: "203.0.113.7" });
    await a.ready;
    expect(a.of("snapshot").length).toBe(1);
    // edits until the stream has been given its 6000 bytes: then it ends by itself, after its last event
    let v = 0;
    for (let i = 1; i <= 40 && !a.ended; i++) { v = (await (await post(s.base, { id: "pose.set", args: { joints: { J_mon_pan: (i % 10) + 1, J_mon_tilt: -(i % 10) / 4 } } }, { "x-forwarded-for": "198.51.100.1" })).json()).version; await Bun.sleep(5); }
    for (const t0 = Date.now(); !a.ended && Date.now() - t0 < 2000; ) await Bun.sleep(10);
    expect(a.ended).toBe(true);
    expect(a.events.at(-1)).toMatchObject({ event: "end", data: { reason: "budget" } });   // the page reconnects at once on this
    const bytes = a.events.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    expect(bytes).toBeGreaterThan(4000);
    expect(bytes).toBeLessThan(6000 + 2000);                                   // the budget plus at most the last event
    // two more changes while the page is away; it comes back as live.ts does (same code, since=<last version seen>)
    for (const i of [41, 42]) v = (await (await post(s.base, { id: "pose.set", args: { joints: { J_mon_pan: (i % 10) + 1 } } }, { "x-forwarded-for": "198.51.100.1" })).json()).version;
    const seenTo = Number(a.lastId), back = new Live(s.base, { xff: "203.0.113.7", session: a.code!, since: seenTo });
    await back.ready;
    await back.waitFor(applied(v));
    expect(back.status).toBe(200);
    expect(back.code).toBe(a.code);                                            // the session code is kept: view commands still reach the page
    expect(back.of("snapshot").length).toBe(0);                                // a small catch-up: entries only, no snapshot
    expect(back.of("applied").map((e) => e.data.version)).toEqual(Array.from({ length: v - seenTo }, (_, i) => seenTo + 1 + i));
    // the ended stream's place still counts until its connection is gone (here: streamDrainMs): a, back, b fill the three places
    const b = new Live(s.base, { xff: "198.51.100.9" });
    await b.ready;
    const c = new Live(s.base, { xff: "192.0.2.1" });
    await c.ready;
    expect([b.status, c.status]).toEqual([200, 503]);
    await Bun.sleep(400);
    const c2 = new Live(s.base, { xff: "192.0.2.1" });
    await c2.ready;
    expect(c2.status).toBe(200);
    for (const l of [a, back, b, c2]) l.close();
    s.stop();
    // locally there is no budget
    const l = start({ limits: { streamBytesMax: 1000 } }), x = new Live(l.base);
    await x.ready;
    for (let i = 1; i <= 10; i++) await post(l.base, { id: "pose.set", args: { joints: { J_mon_pan: i } } });
    await x.waitFor(applied(10));
    expect(x.ended).toBe(false);
    x.close(); l.stop();
  });
  test("too many streams, per visitor and in all", async () => {
    const s = deployed({ streamsTotal: 9 });
    const mine = Array.from({ length: 6 }, () => new Live(s.base, { xff: "203.0.113.7" }));
    await Promise.all(mine.map((l) => l.ready));
    const seventh = new Live(s.base, { xff: "203.0.113.7" });
    await seventh.ready;
    expect(seventh.status).toBe(429);
    expect(seventh.error.error.code).toBe("too_many_streams");
    // another visitor (an IPv6 /64 block) still gets in, up to the total
    const other = [new Live(s.base, { xff: "2001:db8:1:2::5" }), new Live(s.base, { xff: "2001:db8:1:2:aaaa::9" }), new Live(s.base, { xff: "2001:db8:1:3::1" })];
    await Promise.all(other.map((l) => l.ready));
    expect(other.map((l) => l.status)).toEqual([200, 200, 200]);
    const tenth = new Live(s.base, { xff: "198.51.100.1" });
    await tenth.ready;
    expect(tenth.status).toBe(503);
    // a closed stream frees its place
    mine[0].close(); await Bun.sleep(50);
    const again = new Live(s.base, { xff: "203.0.113.7" });
    await again.ready;
    expect(again.status).toBe(200);
    for (const l of [...mine, ...other, again]) l.close();
    s.stop();
    // none locally
    const l = start(), many = Array.from({ length: 8 }, () => new Live(l.base));
    await Promise.all(many.map((x) => x.ready));
    expect(many.every((x) => x.status === 200)).toBe(true);
    for (const x of many) x.close();
    l.stop();
  });
  test("edit rate per visitor and in all; disk nearly full", async () => {
    const s = deployed({ editsPerMinutePerVisitor: 3, editsPerSecondTotal: 5 });
    const edit = (ip: string, v: number) => post(s.base, { id: "pose.set", args: { joints: { J_mon_pan: v } } }, { "x-forwarded-for": ip });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await edit("203.0.113.7", i + 1)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    expect((await (await edit("203.0.113.7", 9)).json()).error.code).toBe("rate_limited");
    // queries are counted apart
    expect((await post(s.base, { id: "scene.summary" }, { "x-forwarded-for": "203.0.113.7" })).status).toBe(200);
    // another visitor may edit, until the server-wide limit per second
    expect((await edit("198.51.100.1", 1)).status).toBe(200);
    expect((await edit("198.51.100.2", 2)).status).toBe(200);
    expect((await edit("198.51.100.3", 3)).status).toBe(429);
    s.stop();
    const full = deployed({ diskMinFreeBytes: Number.MAX_SAFE_INTEGER });
    const r = await post(full.base, { id: "pose.set", args: { joints: { J_mon_pan: 1 } } });
    expect(r.status).toBe(507);
    expect((await post(full.base, { id: "scene.summary" })).status).toBe(200);
    full.stop();
  });
  test("visitor key: the forwarded address only from loopback, IPv6 by /64", () => {
    expect(visitorKey("127.0.0.1", "203.0.113.7")).toBe("203.0.113.7");
    expect(visitorKey("127.0.0.1", "10.0.0.1, 203.0.113.7")).toBe("203.0.113.7");
    expect(visitorKey("192.0.2.4", "203.0.113.7")).toBe("192.0.2.4");
    expect(visitorKey("::1", "2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(visitorKey("::1", "2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorKey("::ffff:127.0.0.1", "::ffff:198.51.100.9")).toBe("198.51.100.9");
  });
});

describe("requests that never reach a command", () => {
  test("header, content type, JSON, method, host", async () => {
    const s = start();
    expect((await fetch(`${s.base}/api/command`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
    expect((await fetch(`${s.base}/api/command`, { method: "POST", headers: { "x-rigtwin": "1", "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    const bad = await post(s.base, "{not json");
    expect([bad.status, (await bad.json()).error.code]).toEqual([400, "bad_json"]);
    expect((await fetch(`${s.base}/api/command`)).status).toBe(405);
    expect((await fetch(`${s.base}/api/health`, { headers: { host: "rebound.example:4173" } })).status).toBe(403);
    // a refused command is HTTP 200 with ok: false (a browser does not log it as a failed request)
    const refused = await post(s.base, { id: "pose.set", args: { joints: { J_nothing: 1 } } });
    expect([refused.status, (await refused.json()).error.code]).toEqual([200, "unknown_joint"]);
    s.stop();
  });
});

test("release watch: the deployed server notices when `current` points at another release", async () => {
  const root = tempDir();
  mkdirSync(join(root, "releases", "a"), { recursive: true }); mkdirSync(join(root, "releases", "b"), { recursive: true });
  symlinkSync(join(root, "releases", "a"), join(root, "current"));
  let changed = 0;
  const s = start({ mode: "deployed", releaseDir: join(root, "current"), onReleaseChange: () => { changed++; }, limits: { releaseWatchMs: 20 } });
  await Bun.sleep(80);
  expect(changed).toBe(0);
  symlinkSync(join(root, "releases", "b"), join(root, "next")); renameSync(join(root, "next"), join(root, "current"));   // the deploy's atomic switch
  for (let t = 0; t < 50 && !changed; t++) await Bun.sleep(20);
  expect(changed).toBe(1);
  s.stop();
});

test("release switch, for real: the bundled server run through `current` exits when `current` moves, and starts on the new release", async () => {
  const root = tempDir(), rel = (n: string) => join(root, "releases", n);
  for (const n of ["r1", "r2"]) {
    mkdirSync(join(rel(n), "server"), { recursive: true });
    cpSync(ASSET, join(rel(n), "asset"), { recursive: true });
    writeFileSync(join(rel(n), "version.json"), JSON.stringify({ revision: `${n}rev` }));
  }
  const b = spawnSync(["bun", "build", join(ROOT, "server", "server.ts"), "--target", "bun", "--outfile", join(rel("r1"), "server", "server.js")]);
  expect(b.exitCode).toBe(0);
  cpSync(join(rel("r1"), "server", "server.js"), join(rel("r2"), "server", "server.js"));
  symlinkSync(rel("r1"), join(root, "current"));
  const run = async () => {
    const p = spawn(["bun", join(root, "current", "server", "server.js"), "--mode", "deployed", "--port", "0", "--data", join(root, "data")], { stdout: "pipe", stderr: "pipe" });
    const reader = p.stdout.getReader(), port = JSON.parse(new TextDecoder().decode((await reader.read()).value)).listening;
    reader.releaseLock();
    return { p, health: async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).json() };
  };
  const first = await run();
  expect((await first.health()).revision).toBe("r1rev");
  symlinkSync(rel("r2"), join(root, "current.tmp")); renameSync(join(root, "current.tmp"), join(root, "current"));
  const code = await Promise.race([first.p.exited, Bun.sleep(5000).then(() => "still running")]);
  expect(code).toBe(0);
  const second = await run();
  expect((await second.health()).revision).toBe("r2rev");
  second.p.kill(); await second.p.exited;
}, 20000);

describe("security review fixes", () => {
  test("M3: author ids are made by the server; a forged id gets another one", async () => {
    const s = start(), a = new Live(s.base);
    await a.ready;
    const first = await (await post(s.base, { id: "pose.set", args: { joints: { J_mon_pan: 2 } } }, { "x-rigtwin-client": "person", "x-rigtwin-client-id": "1111aaaa2222bbbb" })).json();
    const e1 = await a.waitFor(applied(1));
    expect(e1.data.actor.id).toBe(first.you.id);
    expect(JSON.stringify(a.events)).not.toContain("1111aaaa2222bbbb");          // the client's own id is never sent out
    // a stranger copies the id it can read on the live channel, and claims to be the same person
    const forged = await (await post(s.base, { id: "pose.set", args: { joints: { J_mon_pan: 3 } } }, { "x-rigtwin-client": "person", "x-rigtwin-client-id": e1.data.actor.id })).json();
    const e2 = await a.waitFor(applied(2));
    expect(e2.data.actor.id).not.toBe(e1.data.actor.id);
    expect(forged.you.id).toBe(e2.data.actor.id);
    // the same client keeps its id across requests; the server's secret is in the data folder, not in the reply
    const again = await (await post(s.base, { id: "scene.summary" }, { "x-rigtwin-client": "person", "x-rigtwin-client-id": "1111aaaa2222bbbb" })).json();
    expect(again.you.id).toBe(first.you.id);
    a.close(); s.stop();
  });
  test("S3: eight-character codes; a visitor gets five wrong codes a minute", async () => {
    const s = start({ mode: "deployed", limits: { diskMinFreeBytes: 0, diskMinFreeFraction: 0 } });
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post(s.base, { id: "view.set", args: { view: "top" }, session: `ZZZZZZZ${"23456789"[i]}` }, { "x-forwarded-for": "203.0.113.9" })).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await post(s.base, { id: "view.set", args: { view: "top" }, session: "ZZZZZZZZ" }, { "x-forwarded-for": "198.51.100.4" })).status).toBe(200);
    s.stop();
  });
  test("S7: one network block (/48, /24) gets at most 30 streams and 10 edits a second", async () => {
    const s = start({ mode: "deployed", limits: { diskMinFreeBytes: 0, diskMinFreeFraction: 0, streamsPerBlock: 4, editsPerSecondPerBlock: 3 } });
    const block = [0, 1, 2, 3, 4].map((i) => new Live(s.base, { xff: `2001:db8:5:${i}::1` }));     // five /64s of one /48
    await Promise.all(block.map((l) => l.ready));
    expect(block.map((l) => l.status)).toEqual([200, 200, 200, 200, 429]);
    const edits = [];
    for (let i = 0; i < 4; i++) edits.push((await post(s.base, { id: "pose.set", args: { joints: { J_mon_pan: i + 1 } } }, { "x-forwarded-for": `198.51.100.${i + 10}` })).status);
    expect(edits).toEqual([200, 200, 200, 429]);
    for (const l of block) l.close();
    s.stop();
  });
  test("S2: a body that does not arrive in time is refused", async () => {
    const s = start({ limits: { bodyTimeoutMs: 300 } });
    const port = Number(new URL(s.base).port);
    const status = await new Promise<string>((resolve) => {
      const c = Bun.connect({ hostname: "127.0.0.1", port, socket: {
        open(sock) { sock.write("POST /api/command HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Rigtwin: 1\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"id\":"); },
        data(_sock, d) { resolve(new TextDecoder().decode(d).split("\r\n")[0]); },
        close() { resolve("closed"); }, error() { resolve("error"); },
      } });
      void c;
    });
    expect(status).toBe("HTTP/1.1 408 Request Timeout");
    s.stop();
  });
  test("checkpoint: the local viewer server answers only to its own host names, on every path", async () => {
    const { startServer } = await import("../tools/serve.ts");
    const v = await startServer({ port: 0, data: "temp" });
    const at = (path: string, host: string) => fetch(v.url + path, { headers: { host } }).then((r) => r.status);
    expect(await at("/private/evidence/cameras.json", "rebound.example")).toBe(403);
    expect(await at("/work/", "rebound.example:4173")).toBe(403);
    expect(await at("/api/health", "rebound.example")).toBe(403);
    expect(await at("/", "127.0.0.1")).toBe(200);
    expect(await at("/api/health", "localhost:4173")).toBe(200);
    v.stop();
  });
});
