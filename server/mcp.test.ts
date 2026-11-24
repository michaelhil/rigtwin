// bun test server — the MCP endpoint (agent interface v2) over real HTTP: initialize with instructions and a session id,
// the five tools with plain JSON Schemas, a tool call that changes the scene and appears on the live channel, refusals as
// tool errors, look to every local page or to the one whose code it was given (remembered for the session), a picture
// sent back by a page, the picture endpoint's checks, foreign origins refused, and the deployed guards for tool calls.
import { test, expect, describe, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApi, type ApiOptions } from "./server.ts";

const ASSET = join(import.meta.dir, "..", "assets", "rig-b", "build");
const temps: string[] = [];
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
function start(o: Partial<ApiOptions> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "rigtwin-mcp-test-")); temps.push(dataDir);
  const api = createApi({ dataDir, assetDir: ASSET, mode: "local", revision: "test", ...o });
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 40, async fetch(req, s) { return (await api.fetch(req, s.requestIP(req)?.address ?? "")) ?? new Response("not found", { status: 404 }); } });
  return { base: `http://127.0.0.1:${srv.port}`, stop: () => { api.close(); srv.stop(true); } };
}
let n = 0;
async function rpc(base: string, method: string, params?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, ...(params ? { params } : {}) }) });
  return { status: res.status, session: res.headers.get("mcp-session-id"), body: res.status === 202 ? null : await res.json() as any };
}
const call = (base: string, name: string, args: unknown, session?: string) => rpc(base, "tools/call", { name, arguments: args }, session ? { "mcp-session-id": session } : {});
const text = (r: any) => r.body.result.content[0].text as string;

/** a page on the live channel: its code, and the view events it gets; `answer` sends a picture for every reply id */
function page(base: string, o: { answer?: Uint8Array<ArrayBuffer> } = {}) {
  const ctl = new AbortController(), views: any[] = [];
  let code = "";
  const ready = (async () => {
    const res = await fetch(`${base}/api/live`, { signal: ctl.signal }), reader = res.body!.getReader(), dec = new TextDecoder();
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
                if (d.reply && o.answer) fetch(`${base}/api/picture?reply=${d.reply}&session=${code}`, { method: "POST", headers: { "x-rigtwin": "1", "content-type": "image/jpeg" }, body: o.answer });
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
  test("initialize: the requested protocol, the instructions with every adjustment, a session id", async () => {
    const s = start();
    const r = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    expect(r.body.result.protocolVersion).toBe("2025-06-18");
    expect(r.body.result.serverInfo.name).toBe("rigtwin");
    expect(r.body.result.instructions).toContain("[J_seat_recline]");
    expect(r.body.result.instructions.length).toBeLessThanOrEqual(4096);
    expect(r.session).toMatch(/^[0-9a-f]{32}$/);
    expect((await rpc(s.base, "initialize", { protocolVersion: "1999-01-01" })).body.result.protocolVersion).toBe("2025-11-25");
    const note = await fetch(`${s.base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(note.status).toBe(202);
    expect((await rpc(s.base, "nothing/here")).body.error.code).toBe(-32601);
    s.stop();
  });
  test("tools/list: five tools, always loaded, plain JSON Schema", async () => {
    const s = start(), tools = (await rpc(s.base, "tools/list")).body.result.tools;
    expect(tools.map((t: any) => t.name).sort()).toEqual(["adjust", "look", "measure", "state", "undo"]);
    for (const t of tools) { expect(t._meta["anthropic/alwaysLoad"]).toBe(true); expect(t.inputSchema.type).toBe("object"); expect(JSON.stringify(t.inputSchema)).not.toContain('"unit"'); }
    expect(tools.find((t: any) => t.name === "look").inputSchema.properties.viewer).toBeDefined();
    s.stop();
  });
  test("a tool call changes the scene, is labelled Claude Code, and reaches the pages", async () => {
    const s = start(), p = page(s.base); await p.ready;
    const init = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18" });
    const r = await call(s.base, "adjust", { target: "backrest", to: "upright" }, init.session!);
    expect(r.body.result.isError).toBeUndefined();
    expect(text(r)).toContain("Backrest: recline as photographed → upright");
    const st = await call(s.base, "state", {}, init.session!);
    expect(text(st)).toMatch(/v1 Claude Code · [0-9a-f]{4} \[seat-recline-1\]/);
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
    expect(a.views[0]).toMatchObject({ id: "look", args: { view: "front", picture: true } });
    expect(b.views.length).toBe(1);
    a.close(); b.close(); s.stop();
  });
  test("look with a code goes to that page only, and the code is remembered for the session", async () => {
    const s = start({ mode: "deployed" }), a = page(s.base), b = page(s.base); await Promise.all([a.ready, b.ready]);
    const init = await rpc(s.base, "initialize", { protocolVersion: "2025-06-18" }), sid = init.session!;
    expect(text(await call(s.base, "look", { view: "top" }, sid))).toContain("needs_viewer");
    expect(text(await call(s.base, "look", { view: "top", viewer: a.code().toLowerCase() }, sid))).toContain("Showing the top view");
    expect(text(await call(s.base, "look", { view: "left" }, sid))).toContain("Showing the left view");
    await Bun.sleep(50);
    expect(a.views.map((v) => v.args.view)).toEqual(["top", "left"]);
    expect(b.views.length).toBe(0);
    a.close(); b.close(); s.stop();
  });
  test("no picture within the wait: the reply says so", async () => {
    const s = start({ limits: { pictureWaitMs: 200 } }), p = page(s.base); await p.ready;
    const r = await call(s.base, "look", { picture: true });
    expect(text(r)).toContain("No picture");
    expect(r.body.result.content.length).toBe(1);
    p.close(); s.stop();
  });
  test("the picture endpoint takes only an awaited JPEG from the asked page", async () => {
    const s = start({ limits: { pictureWaitMs: 1500 } }), p = page(s.base); await p.ready;
    const post = (q: string, body: BodyInit, type = "image/jpeg") => fetch(`${s.base}/api/picture?${q}`, { method: "POST", headers: { "x-rigtwin": "1", "content-type": type }, body });
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
    const foreign = await fetch(`${s.base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.org" }, body: "{}" });
    expect(foreign.status).toBe(403);
    expect((await fetch(`${s.base}/api/mcp`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await fetch(`${s.base}/api/mcp`)).status).toBe(405);
    await call(s.base, "adjust", { target: "monitor height", by: "-1 cm" });
    await call(s.base, "adjust", { target: "monitor height", by: "-1 cm" });
    const third = await call(s.base, "adjust", { target: "monitor height", by: "-1 cm" });
    expect(text(third)).toContain("rate_limited");
    s.stop();
  });
});
