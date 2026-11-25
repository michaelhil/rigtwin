// bun test server — the MCP endpoint (agent interface v2) over real HTTP: initialize with instructions and a session id,
// the six tools with plain JSON Schemas (person since manikin v1), a tool call that changes the scene and appears on the live channel, refusals as
// tool errors, look to every local page or to the one whose code it was given (remembered for the session), a picture
// sent back by a page, the picture endpoint's checks, foreign origins refused, and the deployed guards for tool calls.
import { test, expect, describe, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApi, type ApiOptions } from "./server.ts";
import { viaPlayground } from "./test-support.ts";

const ASSET = join(import.meta.dir, "..", "assets", "rig-b", "build");
const temps: string[] = [];
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
function start(o: Partial<ApiOptions> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "synergon-mcp-test-")); temps.push(dataDir);
  const api = createApi({ dataDir, assetDir: ASSET, mode: "local", revision: "test", ...o });
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 40, async fetch(req, s) { return (await viaPlayground(api, req, s.requestIP(req)?.address ?? "")) ?? new Response("not found", { status: 404 }); } });
  return { base: `http://127.0.0.1:${srv.port}`, stop: () => { api.close(); srv.stop(true); } };
}
let n = 0;
async function rpc(base: string, method: string, params?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/workspaces/playground/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, ...(params ? { params } : {}) }) });
  return { status: res.status, session: res.headers.get("mcp-session-id"), body: res.status === 202 ? null : await res.json() as any };
}
const call = (base: string, name: string, args: unknown, session?: string) => rpc(base, "tools/call", { name, arguments: args }, session ? { "mcp-session-id": session } : {});
const text = (r: any) => r.body.result.content[0].text as string;

/** a page on the live channel: its code, and the view events it gets; `answer` sends a picture for every reply id */
function page(base: string, o: { answer?: Uint8Array<ArrayBuffer> } = {}) {
  const ctl = new AbortController(), views: any[] = [];
  let code = "";
  const ready = (async () => {
    const res = await fetch(`${base}/api/workspaces/playground/live`, { signal: ctl.signal }), reader = res.body!.getReader(), dec = new TextDecoder();
    let buf = "", opened = false;
    return new Promise<void>((resolve) => {
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
              const b = buf.slice(0, i); buf = buf.slice(i + 2);
              const ev = b.match(/^event: (.*)$/m)?.[1], data = b.match(/^data: (.*)$/m)?.[1];
              if (!ev || !data) continue;
              const d = JSON.parse(data);
              if (ev === "session") { code = d.code; if (!opened) { opened = true; resolve(); } }
              if (ev === "view") {
                views.push(d);
                if (d.reply && o.answer) fetch(`${base}/api/workspaces/playground/picture?reply=${d.reply}&session=${code}`, { method: "POST", headers: { "x-synergon": "1", "content-type": "image/jpeg" }, body: o.answer });
              }
            }
          }
        } catch { /* closed */ }
      })();
    });
  })();
  return { ready, views, code: () => code, close: () => ctl.abort() };
}
const JPEG: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

describe("the MCP endpoint", () => {
  test("security review fixes: no batches, no 500 for prototype names, exact content type, own origin only, codes checked", async () => {
    const s = start();
    const batch = await fetch(`${s.base}/api/workspaces/playground/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]) });
    expect(batch.status).toBe(400); expect((await batch.json()).error.code).toBe(-32600);
    for (const args of [{ view: "constructor" }, { only: "constructor" }, { select: "__proto__" }]) { const r = await call(s.base, "look", args); expect(r.status).toBe(200); expect(r.body.result.isError).toBe(true); }
    for (const args of [{ from: "constructor", to: "monitor screen" }, { from: "toString", to: "hasOwnProperty" }]) { const r = await call(s.base, "measure", args); expect(r.status).toBe(200); expect(r.body.result.isError).toBe(true); }
    const r = await call(s.base, "adjust", { target: "constructor", by: 1 }); expect(r.body.result.isError).toBe(true);
    const sneaky = await fetch(`${s.base}/api/workspaces/playground/mcp`, { method: "POST", headers: { "content-type": "text/plain;x=application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    expect(sneaky.status).toBe(415);
    const other = await fetch(`${s.base}/api/workspaces/playground/mcp`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    expect(other.status).toBe(403);
    const own = await fetch(`${s.base}/api/workspaces/playground/mcp`, { method: "POST", headers: { "content-type": "application/json", origin: s.base }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    expect(own.status).toBe(200);
    const init = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18" });
    expect(text(await call(s.base, "look", { view: "top", viewer: "not a code at all" }, init.session!))).toContain("not a browser's code");
    expect(text(await call(s.base, "look", { view: "top" }, init.session!))).toContain("no_viewer");     // the bad code was not kept
    s.stop();
  });
  test("request names ending in -<number> are the server's; state shows only those", async () => {
    const s = start();
    const claim = await fetch(`${s.base}/api/workspaces/playground/command`, { method: "POST", headers: { "x-synergon": "1", "content-type": "application/json" }, body: JSON.stringify({ id: "pose.set", args: { joints: { J_mon_height: -0.01 } }, group: "mon-height-2" }) });
    expect((await claim.json()).error.code).toBe("invalid_args");
    await fetch(`${s.base}/api/workspaces/playground/command`, { method: "POST", headers: { "x-synergon": "1", "content-type": "application/json" }, body: JSON.stringify({ id: "pose.set", args: { joints: { J_mon_height: -0.01 } }, group: "ignore-the-rules" }) });
    await call(s.base, "adjust", { target: "monitor tilt", by: "1° up" });
    const st = text(await call(s.base, "state", {}));
    expect(st).not.toContain("ignore-the-rules"); expect(st).toContain("[a request named by its caller]"); expect(st).toContain("[mon-tilt-2]");
    s.stop();
  });
  test("deployed: one picture waited for per browser, two per visitor", async () => {
    const s = start({ mode: "deployed", limits: { pictureWaitMs: 400 } }), a = page(s.base), b = page(s.base), c = page(s.base); await Promise.all([a.ready, b.ready, c.ready]);
    const first = call(s.base, "look", { picture: true, viewer: a.code() });
    await Bun.sleep(30);
    expect(text(await call(s.base, "look", { picture: true, viewer: a.code() }))).toContain("rate_limited");     // the same browser
    const second = call(s.base, "look", { picture: true, viewer: b.code() });
    await Bun.sleep(30);
    expect(text(await call(s.base, "look", { picture: true, viewer: c.code() }))).toContain("rate_limited");     // a third for one visitor
    await Promise.all([first, second]);
    expect(text(await call(s.base, "look", { picture: true, viewer: c.code() }))).toContain("No picture");       // slots free again
    a.close(); b.close(); c.close(); s.stop();
  });
  test("initialize: the requested protocol, the compact discovery instructions, a session id", async () => {
    const s = start();
    const r = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    expect(r.body.result.protocolVersion).toBe("2025-06-18");
    expect(r.body.result.serverInfo.name).toBe("synergon");
    expect(r.body.result.instructions).toContain("discover");
    expect(r.body.result.instructions.length).toBeLessThanOrEqual(1600);
    expect(r.session).toMatch(/^[0-9a-f]{32}$/);
    expect((await rpc(s.base, "initialize", { protocolVersion: "1999-01-01" })).body.result.protocolVersion).toBe("2025-11-25");
    const note = await fetch(`${s.base}/api/workspaces/playground/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(note.status).toBe(202);
    expect((await rpc(s.base, "nothing/here")).body.error.code).toBe(-32601);
    s.stop();
  });
  test("tools/list: seven tools with plain JSON Schema and accurate effect hints", async () => {
    const s = start(), tools = (await rpc(s.base, "tools/list")).body.result.tools;
    expect(tools.map((t: any) => t.name).sort()).toEqual(["adjust", "discover", "look", "measure", "person", "state", "undo"]);
    for (const t of tools) { expect(t.inputSchema.type).toBe("object"); expect(JSON.stringify(t.inputSchema)).not.toContain('"unit"'); }
    const look = tools.find((t: any) => t.name === "look");
    expect(look.inputSchema.properties.viewer).toBeDefined();
    expect(look.annotations.readOnlyHint).toBe(false);
    s.stop();
  });
  test("discovery and refusals carry bounded replayable data, with a text fallback for legacy clients", async () => {
    const s = start(), p = page(s.base);
    try {
      await p.ready;
      const sid = (await rpc(s.base, "initialize", { protocolVersion: "2025-11-25" })).session!;
      const structured = async (name: string, args: unknown) => (await call(s.base, name, args, sid)).body.result.structuredContent;
      const overview = await structured("discover", {});
      expect(overview).toMatchObject({ ok: true, version: 0, result: {
        workspace: { name: "Playground" }, viewers: { liveConnections: 1, followingThisCaller: 0 },
      } });
      expect(JSON.stringify(overview)).not.toContain(p.code());
      const tilt = await structured("discover", { query: "touchscreen tilt", kind: "adjustment" });
      expect(tilt.result.matches[0]).toMatchObject({ id: "J_ts_screen:1", kind: "adjustment", unit: "deg" });
      expect(await structured("adjust", { target: tilt.result.matches[0].id, by: 1 })).toMatchObject({ ok: true, version: 1, recorded: 1 });
      const surface = await structured("discover", { query: "little monitor", kind: "part" });
      expect(surface.result.matches[0].id).toBe("S_ts_screen");
      expect((await structured("discover", { query: "monitor font height", kind: "adjustment" })).result.matches).toEqual([]);
      expect(await structured("adjust", { target: "monitor font height", to: "3 cm" })).toMatchObject({ ok: false, version: 1, error: { code: "unknown_target" } });
      expect(await structured("adjust", { target: "armrest", by: "1 cm" })).toMatchObject({ ok: false, error: { code: "ambiguous", candidates: [expect.objectContaining({ kind: "adjustment" }), expect.any(Object)] } });
      expect(await structured("adjust", { target: tilt.result.matches[0].id, by: 1, expectedVersion: 0 })).toMatchObject({ ok: false, error: { code: "stale" } });
      const legacy = (await rpc(s.base, "initialize", { protocolVersion: "2025-03-26" })).session!;
      const fallback = await call(s.base, "discover", {}, legacy);
      expect(fallback.body.result.structuredContent).toBeUndefined();
      expect(JSON.parse(text(fallback)).workspace.name).toBe("Playground");
    } finally { p.close(); s.stop(); }
  });
  test("MCP consumes just one query quota unit per POST", async () => {
    const s = start({ mode: "deployed", limits: { queriesPerMinutePerVisitor: 2 } });
    try {
      expect((await call(s.base, "discover", {})).body.result.structuredContent.ok).toBe(true);
      expect((await call(s.base, "state", {})).body.result.structuredContent.ok).toBe(true);
      expect((await call(s.base, "state", {})).status).toBe(429);
    } finally { s.stop(); }
  });
  test("a tool call changes the scene, is labelled Agent, and reaches the pages", async () => {
    const s = start(), p = page(s.base); await p.ready;
    const init = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18" });
    const r = await call(s.base, "adjust", { target: "backrest", to: "upright" }, init.session!);
    expect(r.body.result.isError).toBeUndefined();
    expect(text(r)).toContain("Backrest: recline as photographed → upright");
    const st = await call(s.base, "state", {}, init.session!);
    expect(text(st)).toMatch(/v1 Agent · [0-9a-f]{4} \[seat-recline-1\]/);
    const bad = await call(s.base, "adjust", { target: "armrest", by: "1 cm" });
    expect(bad.body.result.isError).toBe(true);
    expect(text(bad)).toContain("Refused (ambiguous)");
    expect((await call(s.base, "nope", {})).body.result.isError).toBe(true);
    p.close(); s.stop();
  });
  test("look: locally to every page; a picture comes back as an image", async () => {
    const s = start();
    expect(text(await call(s.base, "look", { view: "operator" }))).toContain("no_viewer");
    const a = page(s.base, { answer: JPEG }), b = page(s.base); await Promise.all([a.ready, b.ready]);
    const r = await call(s.base, "look", { view: "front", picture: true });
    expect(r.body.result.content[1]).toEqual({ type: "image", data: Buffer.from(JPEG).toString("base64"), mimeType: "image/jpeg" });
    expect(r.body.result.structuredContent.result).toMatchObject({
      delivery: { route: "local", status: "dispatched", recipientCount: 2 },
      capture: { status: "returned" }, picture: { mime: "image/jpeg", bytes: JPEG.length },
    });
    expect(JSON.stringify(r.body.result.structuredContent)).not.toContain("base64");
    expect(a.views[0]).toMatchObject({ id: "look", args: { view: "front", picture: true } });
    expect(b.views.length).toBe(1);
    a.close(); b.close(); s.stop();
  });
  test("look with a code goes to that page only, and the code is remembered for the session", async () => {
    const s = start({ mode: "deployed" }), a = page(s.base), b = page(s.base); await Promise.all([a.ready, b.ready]);
    const init = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18" }), sid = init.session!;
    expect(text(await call(s.base, "look", { view: "top" }, sid))).toContain("asked to allow it");          // no code: every page is asked
    expect(text(await call(s.base, "look", { view: "top", viewer: a.code().toLowerCase() }, sid))).toContain("Requested the top view");
    expect(text(await call(s.base, "look", { view: "left" }, sid))).toContain("Requested the left view");
    await Bun.sleep(50);
    expect(a.views.filter((v) => !v.ask).map((v) => v.args.view)).toEqual(["top", "left"]);
    expect(b.views.filter((v) => !v.ask).length).toBe(0);
    a.close(); b.close(); s.stop();
  });
  test("a mistaken pairing does not replace a working pair or reroute to other viewers", async () => {
    const s = start({ mode: "deployed" }), a = page(s.base), b = page(s.base);
    try {
      await Promise.all([a.ready, b.ready]);
      const sid = (await rpc(s.base, "initialize", { protocolVersion: "2025-11-25" })).session!;
      expect((await call(s.base, "look", { view: "top", viewer: a.code() }, sid)).body.result.isError).toBeUndefined();
      const wrong = await call(s.base, "look", { view: "left", viewer: "ZZZZZZZZ" }, sid);
      expect(wrong.body.result.structuredContent.error.code).toBe("unknown_session");
      expect(JSON.stringify(wrong.body)).not.toContain("ZZZZZZZZ");
      expect((await call(s.base, "look", { view: "right" }, sid)).body.result.structuredContent.result.delivery.route).toBe("paired");
      expect(b.views).toHaveLength(0);
      expect((await call(s.base, "look", { view: "left", viewer: null }, sid)).body.result.structuredContent.result.delivery.status).toBe("approval_requested");
    } finally { a.close(); b.close(); s.stop(); }
  });
  test("person: one tool call seats a person and reaches the pages; measure {person} and look's eye need no browser", async () => {
    const s = start(), p = page(s.base); await p.ready;
    const sid = (await rpc(s.base, "initialize", { protocolVersion: "2025-06-18" })).session!;
    const r = await call(s.base, "person", { preset: "P95 man" }, sid);
    expect(r.body.result.isError).toBeUndefined();
    expect(text(r)).toContain("→ P95 man"); expect(text(r)).toMatch(/request person-p95-man-1/); expect(text(r)).toContain("Hips to the armrest pods");
    const m = await call(s.base, "measure", { person: "sight" }, sid);
    expect(text(m)).toContain("Main monitor:"); expect(text(m)).toContain("gaze cone");
    const lk = await call(s.base, "look", { view: "operator" }, sid);
    expect(text(lk)).toContain("from the eye of the person in the seat");
    await Bun.sleep(30);
    expect(p.views.at(-1).args.eye_point).toHaveLength(3);
    const bad = await call(s.base, "person", { cap: false }, sid);
    expect(bad.body.result.isError).toBe(true); expect(text(bad)).toContain("not_optional");
    expect(text(await call(s.base, "undo", {}, sid))).toContain("Person: P95 man");
    p.close(); s.stop();
  });
  test("follow: a page that follows an agent gets its views and may answer its pictures; stop ends it", async () => {
    // personDir null: nobody in the seat, so a stature gives the eye by the assumed ratio (the fallback; the person's eye is tested below)
    const s = start({ mode: "deployed", personDir: null, limits: { pictureWaitMs: 1500, diskMinFreeFraction: 0, diskMinFreeBytes: 0 } }), a = page(s.base, { answer: JPEG }), b = page(s.base); await Promise.all([a.ready, b.ready]);
    const init = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18" }), sid = init.session!;
    expect(text(await call(s.base, "look", { view: "top" }, sid))).toContain("asked to allow it");
    const traces = (await (await fetch(`${s.base}/api/workspaces/playground/trace`)).json() as any).traces, actor = traces.at(-1).actor;
    const follow = (session: string, who: string | null) => fetch(`${s.base}/api/workspaces/playground/follow`, { method: "POST", headers: { "x-synergon": "1", "content-type": "application/json" }, body: JSON.stringify({ session, actor: who }) });
    expect((await follow("ZZZZZZZZ", actor)).status).toBe(404);
    expect((await follow(a.code(), "not an id")).status).toBe(400);
    expect((await follow(a.code(), actor)).status).toBe(200);
    const r = await call(s.base, "look", { eye: { stature_cm: 180 }, picture: true }, sid);
    expect(text(r)).toContain("follows this agent");
    expect(r.body.result.content[1]?.type).toBe("image");
    await Bun.sleep(30);
    expect(a.views.at(-1)).toMatchObject({ id: "look", args: { view: "operator", eye: 0.819, picture: true } });
    expect(a.views.at(-1).ask).toBeUndefined();
    expect(b.views.filter((v) => !v.ask).length).toBe(0);                                                   // only the question
    expect((await follow(a.code(), null)).status).toBe(200);
    expect(text(await call(s.base, "look", { view: "top" }, sid))).toContain("asked to allow it");
    a.close(); b.close(); s.stop();
  });
  test("consent: with no code and no follower every page gets the question, in the server's words; a few a minute per agent", async () => {
    const s = start({ mode: "deployed", personDir: null, limits: { asksPerMinutePerCaller: 2, pictureAskWaitMs: 1500, diskMinFreeFraction: 0, diskMinFreeBytes: 0 } });
    const init = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18" }), sid = init.session!;
    expect(text(await call(s.base, "look", { view: "top" }, sid))).toContain("needs_viewer");               // no page open: nobody to ask
    const a = page(s.base, { answer: JPEG }), b = page(s.base); await Promise.all([a.ready, b.ready]);
    const r = await call(s.base, "look", { eye: { stature_cm: 180 }, picture: true }, sid);
    expect(text(r)).toContain("asked to allow it");
    expect(r.body.result.content[1]?.type).toBe("image");                                                  // the page that allowed answered
    expect(text(r)).toContain("allowed this agent");
    await Bun.sleep(30);
    for (const p of [a, b]) expect(p.views[0]).toMatchObject({ id: "look", args: { view: "operator", eye: 0.819 }, ask: { by: expect.stringMatching(/^Agent · /), summary: expect.stringContaining("person 180 cm tall") } });
    expect(text(await call(s.base, "look", { view: "top" }, sid))).toContain("asked to allow it");
    expect(text(await call(s.base, "look", { view: "left" }, sid))).toContain("rate_limited");               // the third question in a minute
    a.close(); b.close(); s.stop();
  });
  test("no picture within the wait: the reply says so", async () => {
    const s = start({ limits: { pictureWaitMs: 200 } }), p = page(s.base); await p.ready;
    const r = await call(s.base, "look", { picture: true });
    expect(text(r)).toContain("No picture");
    expect(r.body.result.content.length).toBe(1);
    p.close(); s.stop();
  });
  test("a read and an edit complete while an approval picture is pending", async () => {
    const s = start({ mode: "deployed", limits: { pictureWaitMs: 30, pictureAskWaitMs: 550, diskMinFreeFraction: 0, diskMinFreeBytes: 0 } }), p = page(s.base);
    try {
      await p.ready;
      let settled = false;
      const waiting = call(s.base, "look", { view: "top", picture: true }).then((r) => { settled = true; return r; });
      for (let i = 0; i < 50 && !p.views.length; i++) await Bun.sleep(5);
      expect(p.views[0].ask.expiresInMs).toBe(550);
      expect((await call(s.base, "measure", { from: "D_eye_median", to: "S_mon_screen" })).body.result.structuredContent.ok).toBe(true);
      expect((await call(s.base, "adjust", { target: "monitor height", by: "-1 cm" })).body.result.structuredContent.recorded).toBe(1);
      expect(settled).toBe(false);
      const r = await waiting;
      expect(r.body.result.structuredContent).toMatchObject({ version: 0, result: {
        delivery: { route: "approval", status: "approval_requested" },
        capture: { status: "timed_out", timeoutMs: 550 },
      } });
    } finally { p.close(); s.stop(); }
  });
  test("the picture endpoint takes only an awaited JPEG from the asked page", async () => {
    const s = start({ limits: { pictureWaitMs: 1500 } }), p = page(s.base); await p.ready;
    const post = (q: string, body: BodyInit, type = "image/jpeg") => fetch(`${s.base}/api/workspaces/playground/picture?${q}`, { method: "POST", headers: { "x-synergon": "1", "content-type": type }, body });
    expect((await post("reply=" + "0".repeat(32), JPEG)).status).toBe(404);
    const waiting = call(s.base, "look", { picture: true, viewer: p.code() });
    for (let i = 0; i < 100 && !p.views.length; i++) await Bun.sleep(10);
    const id = p.views[0].reply;
    expect((await post(`reply=${id}&session=AAAAAAAA`, JPEG)).status).toBe(403);
    expect((await post(`reply=${id}&session=${p.code()}`, "not a jpeg")).status).toBe(400);
    expect((await post(`reply=${id}&session=${p.code()}`, new Uint8Array(70 * 1024).fill(0xff))).status).toBe(413);
    expect((await post(`reply=${id}&session=${p.code()}`, JPEG, "text/plain")).status).toBe(415);
    expect((await post(`reply=${id}&session=${p.code()}`, JPEG)).status).toBe(204);
    expect((await waiting).body.result.content[1].type).toBe("image");
    expect((await post(`reply=${id}&session=${p.code()}`, JPEG)).status).toBe(404);          // answered once
    p.close(); s.stop();
  });
  test("other web pages are refused; GET is 405; tool calls count against the deployed edit limits", async () => {
    const s = start({ mode: "deployed", limits: { editsPerMinutePerVisitor: 2 } });
    const foreign = await fetch(`${s.base}/api/workspaces/playground/mcp`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.org" }, body: "{}" });
    expect(foreign.status).toBe(403);
    expect((await fetch(`${s.base}/api/workspaces/playground/mcp`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await fetch(`${s.base}/api/workspaces/playground/mcp`)).status).toBe(405);
    await call(s.base, "adjust", { target: "monitor height", by: "-1 cm" });
    await call(s.base, "adjust", { target: "monitor height", by: "-1 cm" });
    const third = await call(s.base, "adjust", { target: "monitor height", by: "-1 cm" });
    expect(text(third)).toContain("rate_limited");
    s.stop();
  });
});
