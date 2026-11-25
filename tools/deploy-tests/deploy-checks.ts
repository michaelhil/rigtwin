// Local test of the live-site checks of tools/deploy.ts (builder D, step 1): verifySite() against local stand-ins
// for the production site, built from dist/ (run `bun run dist` first). No SSH, no network beyond 127.0.0.1.
//   bun tools/deploy-tests/deploy-checks.ts
import { readFileSync, readdirSync, statSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { verifySite, routeProbe, FIRST_ROLLOUT } from "../deploy.ts";
import { serveFolder } from "../dist.ts";

const dist = join(import.meta.dir, "..", "..", "dist");
const version = JSON.parse(readFileSync(join(dist, "version.json"), "utf8"));
if (!version.server) throw new Error("dist/version.json has no server entry: run bun run dist with server/server.ts present");
const glbBuf = readFileSync(join(dist, "asset", `${version.model.asset}.glb`));
const glb = { path: `asset/${version.model.asset}.glb`, bytes: glbBuf.length, sha256: createHash("sha256").update(glbBuf).digest("hex") };
const wikiPages = ["README.html"];
let pass = 0, fail = 0;
const expect = (what: string, cond: boolean, detail = "") => { cond ? pass++ : fail++; console.log(`  ${cond ? "ok  " : "FAIL"} ${what}${!cond && detail ? `: ${detail}` : ""}`); };

/** A stand-in Synergon server: answers /api/health with `status` and `revision()`, lists one workspace and streams its snapshot
 *  (what the checks of the live site ask besides the health). `workspaces` false: no list (404), as the server of a release before them. */
const WS = "6f1c2a3e-5b7d-4c9a-8e0f-1a2b3c4d5e6f";
function fakeApi(status: () => number, revision: () => string, workspaces = true) {
  return Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/api/health") return Response.json({ ok: true, revision: revision(), format: "synergon-scene/1", mode: "deployed" }, { status: status() });
    if (!workspaces) return new Response("not found", { status: 404 });
    if (p === "/api/workspaces") return Response.json({ workspaces: [{ id: WS, name: "Playground", created: "2026-11-25T00:00:00.000Z", changed: "2026-11-25T00:00:00.000Z" }], next: null, total: 1 });
    if (p === `/api/workspaces/${WS}/live`) return new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); c.enqueue(e.encode(`retry: 2000\n\nevent: session\ndata: {"code":"ABCDEFGH"}\n\nid: 0\nevent: snapshot\ndata: {"doc":{}}\n\n`)); } }), { headers: { "content-type": "text/event-stream" } });
    return new Response("not found", { status: 404 });
  } });
}
async function run(name: string, site: { origin: string }, v: any) {
  const cfg = { host: "unused", remoteRoot: "/srv/synergon", publicUrl: `${site.origin}/`, keepReleases: 5 };
  const t = performance.now(), checks = await verifySite(cfg, { version: v, glb, wikiPages });
  const secs = (performance.now() - t) / 1000;
  console.log(`${name} (${secs.toFixed(1)} s)`);
  return { checks, secs, failed: checks.filter((c) => !c.ok && c.required), get: (s: string) => checks.find((c) => c.what.startsWith(s)) };
}
const noServer = (() => { const { server, ...v } = version; return v; })();
// the same release as it was before the server: a folder of links to dist/ with a version.json without the server entry
const oldDist = mkdtempSync(join(tmpdir(), "deploy-checks-"));
for (const f of readdirSync(dist)) if (f !== "version.json") symlinkSync(join(dist, f), join(oldDist, f));
writeFileSync(join(oldDist, "version.json"), JSON.stringify(noServer, null, 1) + "\n");

// 1. a release without a server entry, today's site (no API route): no health check, server.js not served
{
  const s = serveFolder(oldDist, "/");
  const r = await run("1. release without a server, site without the API route", s, noServer);
  expect("all required checks pass", r.failed.length === 0, r.failed.map((c) => c.what + ": " + c.detail).join("; "));
  expect("no api/health check", !r.get("server: api/health"));
  expect("server/server.js checked", r.get("server code not served")?.ok === true);
  s.server.stop(true);
}
// 2. a release with a server, host not set up yet (no route: api/health 404). Security review M4: the deploy asks before
//    the switch and stops; if it got that far anyway, the 404 after the switch is a failure (the deploy switches back).
{
  const s = serveFolder(oldDist, "/");                     // today's site: no API route, so api/health is a 404
  const p = await routeProbe({ publicUrl: `${s.origin}/` });
  console.log("2. release with a server, host not set up (api/health 404)");
  expect("the probe before the switch says stop", p.ok === false && p.status === 404, p.detail);
  expect("naming the order of the first rollout", p.detail.includes(FIRST_ROLLOUT) && /setup-server\.sh --apply/.test(p.detail), p.detail);
  const r = await run("   ... and after a switch", s, version);
  const h = r.get("server: api/health");
  expect("a 404 after the switch fails at once (and switches back)", h?.ok === false && h.required && /404/.test(h.detail) && r.secs < 10, `${h?.detail}; ${r.secs} s`);
  s.server.stop(true);
  const dead = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }), port = dead.port; dead.stop(true);
  const routed = serveFolder(dist, "/", { api: `http://127.0.0.1:${port}` });       // the route, no service yet: 502
  const q = await routeProbe({ publicUrl: `${routed.origin}/` });
  expect("with the route but no service yet (502) the deploy goes on", q.ok === true && q.status === 502, q.detail);
  routed.server.stop(true);
  const gone = await routeProbe({ publicUrl: `http://127.0.0.1:${port}/` });
  expect("no answer at all: stop (the 404 rule cannot be confirmed)", gone.ok === false && gone.status === null, gone.detail);
}
// 3. route and server, the old server answers for 3 s with the previous revision, then the new one
{
  const t0 = Date.now(), api = fakeApi(() => 200, () => (Date.now() - t0 < 3000 ? "0000000" : version.revision));
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("3. old server first, then the new revision", s, version);
  expect("all required checks pass", r.failed.length === 0, r.failed.map((c) => c.what + ": " + c.detail).join("; "));
  expect("health ok after the switch", /^ok after/.test(r.get("server: api/health")?.detail ?? ""), r.get("server: api/health")?.detail);
  s.server.stop(true); api.stop(true);
}
// 4. route, but the service does not run (502 from the proxy): failure after 20 s
{
  const dead = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }), port = dead.port; dead.stop(true);
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${port}` });
  const r = await run("4. route without a running service (502)", s, version);
  const h = r.get("server: api/health");
  expect("health check fails (so the deploy rolls back)", h?.ok === false && h.required, h?.detail);
  expect("after about 20 s", r.secs >= 19 && r.secs < 30, `${r.secs} s`);
  expect("says 502", /HTTP 502 after 20 s/.test(h?.detail ?? ""), h?.detail);
  s.server.stop(true);
}
// 5. the server keeps reporting another revision: failure
{
  const api = fakeApi(() => 200, () => "fedcba9");
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("5. a server that reports another revision", s, version);
  const h = r.get("server: api/health");
  expect("health check fails, naming the revision", h?.ok === false && /reports revision fedcba9 after 20 s/.test(h.detail), h?.detail);
  s.server.stop(true); api.stop(true);
}
// 6. a web server that hands out server/server.js: failure, also for a release without a server entry
{
  const files = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    const p = decodeURIComponent(new URL(req.url).pathname);
    let f = join(oldDist, p.replace(/^\//, ""));
    try { if (statSync(f).isDirectory()) { if (!p.endsWith("/")) return new Response(null, { status: 301, headers: { location: p + "/" } }); f = join(f, "index.html"); } return new Response(Bun.file(f), { headers: f.endsWith(".html") ? { "content-type": "text/html; charset=utf-8" } : {} }); } catch { return new Response("no", { status: 404 }); }
  } });
  const r = await run("6. web server without the 404 rule for server/", { origin: `http://127.0.0.1:${files.port}` }, noServer);
  const c = r.get("server code not served");
  expect("server.js check fails and is required", c?.ok === false && c.required, c?.detail);
  expect("it is the only failure", r.failed.length === 1, r.failed.map((x) => x.what).join("; "));
  files.stop(true);
}
// 7. a server that answers its health but has no workspaces (a release before them): the deploy must not call it good
{
  const api = fakeApi(() => 200, () => version.revision, false);
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("7. a server without the workspaces' API", s, version);
  const w = r.get("server: api/workspaces");
  expect("the list of workspaces fails and is required", w?.ok === false && w.required && /HTTP 404/.test(w.detail), w?.detail);
  expect("health itself is fine", r.get("server: api/health")?.ok === true);
  s.server.stop(true); api.stop(true);
}
// 8. the workspace check in a good server: the list and one stream, and the removed addresses are not asked
{
  const asked: string[] = [], inner = fakeApi(() => 200, () => version.revision), api = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) { asked.push(new URL(req.url).pathname); return inner.fetch(req); } });
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("8. what the checks ask of the server", s, version);
  expect("the list and the stream are checked and ok", r.get("server: api/workspaces")?.ok === true && r.get("server: a workspace's live stream")?.ok === true, r.checks.map((c) => `${c.what}: ${c.detail}`).join("; "));
  expect("the single-scene addresses are not asked", !asked.some((p) => ["/api/live", "/api/command", "/api/mcp"].includes(p)), asked.join(", "));
  s.server.stop(true); api.stop(true); inner.stop(true);
}
rmSync(oldDist, { recursive: true, force: true });
console.log(`\ndeploy checks test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
