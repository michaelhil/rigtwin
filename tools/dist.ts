// bun run dist [--out dist] [--no-verify] [--strict-wiki]
// Build the self-contained public room and station site for the existing Caddy root.
// The release contains both browser shells, the station model, immutable library editions,
// the wiki and the public screening source. server/server.js runs both APIs from separate
// data stores. Caddy refuses the server/ tree. The local proxy below mirrors these routes.
// Unless --no-verify is given, exercise the installed bundle in Chromium and test release
// replacement with disposable workspace data. Private project stores are outside this build.
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync, readFileSync, mkdtempSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { ROOT, timeline } from "./timeline.ts";
import { bundleViewer } from "./bundle.ts";
import { buildWiki, lintWiki } from "./wiki.ts";
import { buildRoomRelease, verifyDisposableRoom } from "./room-dist.ts";
import { currentVersion } from "./version.ts";
import { personEntry } from "./serve.ts";

const TYPES: Record<string, string> = { ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp", ".wasm": "application/wasm", ".ktx2": "image/ktx2", ".bin": "application/octet-stream" };

/** Static file server for `dir` under the path `base`, behaving like the production web server (deploy/synergon.caddy): index.html for a folder, a
 *  redirect when the folder's slash is missing, 404 otherwise; the viewer page (index.html) for `<base>workspaces/*`; 404 for the server's folder `server/`; and, given `api` (the origin of a running Synergon
 *  server), `<base>api/*` forwarded to it as `/api/*`, the answer streamed as it arrives. Every answer is logged; requests carrying the header
 *  `x-synergon-probe` (deliberate checks) are marked as probes. */
export function serveFolder(dir: string, base = "/", opts: { api?: string; idleTimeout?: number } = {}) {
  const log: { path: string; status: number; probe: boolean }[] = [];
  // with a server behind it, a quiet live stream must outlast the heartbeat: the server's own idle timeout (server/limits.ts), not Bun's 10 s
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", ...(opts.idleTimeout !== undefined ? { idleTimeout: opts.idleTimeout } : {}), async fetch(req, srv) {
    const url = new URL(req.url), path = decodeURIComponent(url.pathname), probe = req.headers.has("x-synergon-probe");
    const answer = (status: number, body: BodyInit | null, headers: Record<string, string> = {}) => { log.push({ path, status, probe }); return new Response(body, { status, headers }); };
    if (path + "/" === base) return answer(301, null, { location: base });
    if (!path.startsWith(base)) return answer(404, "outside the sub-path");
    const rest = path.slice(base.length);
    if (rest === "server" || rest.startsWith("server/")) return answer(404, "not found");
    if (rest.startsWith("api/")) {
      if (!opts.api) return answer(404, "no Synergon server");
      const headers = new Headers(req.headers);
      for (const h of ["host", "connection", "accept-encoding", "content-length"]) headers.delete(h);
      headers.set("host", url.host);
      headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
      headers.set("x-forwarded-for", srv.requestIP(req)?.address ?? "127.0.0.1");
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
      const up = await fetch(opts.api + url.pathname.slice(base.length - 1) + url.search, { method: req.method, headers, body, redirect: "manual", signal: req.signal }).catch(() => null);
      if (!up) return answer(502, "the Synergon server did not answer");
      const out = new Headers(up.headers);
      for (const h of ["content-encoding", "content-length", "connection", "transfer-encoding"]) out.delete(h);
      log.push({ path, status: up.status, probe });
      return new Response(up.body, { status: up.status, headers: out });
    }
    let file = normalize(join(dir, rest.startsWith("workspaces/") ? "index.html" : path.slice(base.length)));   // a workspace's address is a page of the viewer
    if (file !== dir && !file.startsWith(dir + sep)) return answer(404, "not found");
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith("/")) return answer(301, null, { location: path + "/" });
      file = join(file, "index.html");
    }
    if (!existsSync(file)) return answer(404, "not found");
    return answer(200, Bun.file(file), { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
  } });
  return { server, log, origin: `http://127.0.0.1:${server.port}`, base };
}

/** Bundles the public service into `<out>/server/server.js` (one file, for Bun). Refuses a bundle that takes code from anywhere but server/ and shared/
 *  (no viewer code, no npm package) or that keeps an import the Bun runtime does not provide itself (bun, bun:*, Node's built-in modules). */
export function buildServer(out: string, entry = "server/room-public.ts"): { file: string; bytes: number; modules: number } {
  const file = join(out, "server", "server.js"), tmp = mkdtempSync(join(tmpdir(), "synergon-dist-")), meta = join(tmp, "meta.json");
  try {
    const r = spawnSync(process.execPath, ["build", entry, "--target=bun", `--outfile=${file}`, `--metafile=${meta}`], { cwd: ROOT, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`bun build ${entry} failed:\n${(r.stderr || r.stdout).trim()}`);
    const inputs: Record<string, { imports: { path: string; original?: string; external?: boolean }[] }> = JSON.parse(readFileSync(meta, "utf8")).inputs;
    // besides server/ and shared/: the person's solver, rig binding and body fit with their numbers (plain TypeScript, TOML and
    // JSON, no three.js at run time), which the person's commands run on the server (shared/person-model.ts)
    const allowed = [/^(server|shared)\//, /^viewer\/src\/person\/((operator|rig-binding|params|body-fit)\.ts|body-capsules\.json)$/, /^assets\/manikin\/params\/runtime[a-z-]*\.toml$/];
    const foreign = Object.keys(inputs).filter((p) => !allowed.some((r) => r.test(p)));
    const builtin = new Set(builtinModules);
    const externals = [...new Set(Object.values(inputs).flatMap((i) => i.imports.filter((x) => x.external).map((x) => x.original ?? x.path)))];
    const strange = externals.filter((p) => !(p === "bun" || p.startsWith("bun:") || p.startsWith("node:") || builtin.has(p)));
    if (foreign.length || strange.length) {
      rmSync(join(out, "server"), { recursive: true, force: true });
      throw new Error(`the server bundle must contain only code from server/ and shared/ and import only what Bun provides;${foreign.length ? ` it takes code from ${foreign.join(", ")}` : ""}${strange.length ? ` it imports ${strange.join(", ")}` : ""}`);
    }
    return { file, bytes: statSync(file).size, modules: Object.keys(inputs).length };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Starts the built server like the host does, but in local mode, on a free port, with an empty temporary data folder and the release's own asset
 *  folder; resolves once it prints its {"listening": port} line. */
export async function startBuiltServer(out: string, options: { data?: string; mode?: "local" | "deployed" } = {}) {
  const free = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }), port = free.port; free.stop(true);
  const data = options.data ?? mkdtempSync(join(tmpdir(), "synergon-dist-data-"));
  const proc = Bun.spawn([process.execPath, join(out, "server", "server.js"), "--mode", options.mode ?? "local", "--port", String(port), "--host", "127.0.0.1", "--data", data, "--asset", join(out, "asset")], { cwd: tmpdir(), stdout: "pipe", stderr: "pipe" });
  let said = "";
  const collect = async (s: ReadableStream<Uint8Array>, onText?: (t: string) => void) => { const d = new TextDecoder(), r = s.getReader(); for (;;) { const { done, value } = await r.read(); if (done) return; const t = d.decode(value, { stream: true }); said += t; onText?.(t); } };
  const stop = async () => {
    proc.kill(); await proc.exited;
    if (!options.data) rmSync(data, { recursive: true, force: true });
  };
  const listening = await new Promise<number>((resolve, reject) => {
    let line = "";
    const timer = setTimeout(() => reject(new Error(`the built server did not report {"listening": port} within 15 s; it printed: ${said.trim().slice(-800) || "nothing"}`)), 15000);
    collect(proc.stdout, (t) => { line += t; for (const l of line.split("\n")) { try { const j = JSON.parse(l); if (typeof j?.listening === "number") { clearTimeout(timer); resolve(j.listening); } } catch { /* not that line */ } } });
    collect(proc.stderr);
    proc.exited.then((code) => { clearTimeout(timer); reject(new Error(`the built server exited (code ${code}) before listening; it printed: ${said.trim().slice(-800) || "nothing"}`)); });
  }).catch(async (e) => { await stop(); throw e; });
  return { origin: `http://127.0.0.1:${listening}`, proc, output: () => said, stop };
}

/** Reads a server-sent-event stream until an event named `name` has arrived or `ms` has passed; returns the names of the events seen and that event's data. */
async function waitEvent(res: Response, name: string, ms: number): Promise<{ seen: string[]; data: string | null }> {
  const reader = res.body!.getReader(), d = new TextDecoder(), until = Date.now() + ms, seen: string[] = [];
  let text = "";
  try {
    while (Date.now() < until) {
      const r = await Promise.race([reader.read(), Bun.sleep(until - Date.now()).then(() => null)]);
      if (!r || r.done) break;
      text += d.decode(r.value, { stream: true });
      const blocks = text.split("\n\n");
      text = blocks.pop()!;
      for (const block of blocks) {
        const lines = block.split("\n"), data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
        if (!data) continue;
        const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message";
        seen.push(event);
        if (event === name) return { seen, data };
      }
    }
    return { seen, data: null };
  } finally { reader.cancel().catch(() => {}); }
}

const listFiles = (dir: string) => { const files: string[] = []; const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } }; if (existsSync(dir)) walk(dir); return files; };
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (import.meta.main) {
  const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const out = join(ROOT, opt("--out") ?? "dist"), asset = "rig-b", buildDir = join(ROOT, "assets", asset, "build");
  const t0 = performance.now();
  if (!existsSync(join(buildDir, `${asset}.glb`))) { console.error('error: no build found. Run "bun run build" first.'); process.exit(1); }
  const manifest = JSON.parse(readFileSync(join(buildDir, `${asset}.manifest.json`), "utf8"));
  if (manifest.build.partial) { console.error(`error: the current build is partial (only ${manifest.build.only.join(", ")}). Run a full "bun run build" first.`); process.exit(1); }
  if (manifest.missing.length) { console.error(`error: components without geometry and not declared omitted: ${manifest.missing.join(", ")}`); process.exit(1); }

  const bundle = await bundleViewer();
  // the server goes into the release once its source exists (server/server.ts); until then the release has no server/ and version.json no server entry
  const hasServer = existsSync(join(ROOT, "server", "server.ts"));
  const sceneFormat: string | null = hasServer ? (await import("../shared/commands/doc.ts")).SCENE_FORMAT : null;
  const version: ReturnType<typeof currentVersion> & { server?: { format: string; room?: Awaited<ReturnType<typeof buildRoomRelease>> }; person?: { package: string } } = { ...currentVersion({ buildDir, asset }), ...(sceneFormat ? { server: { format: sceneFormat } } : {}) };
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "asset"), { recursive: true });
  for (const [name, f] of Object.entries(bundle.files)) writeFileSync(join(out, name), f.body);
  let serverBuild: ReturnType<typeof buildServer> | null = null;
  if (hasServer) {
    try { serverBuild = buildServer(out); } catch (e: any) { console.error(`error: ${e.message}`); process.exit(1); }
    version.server!.room = await buildRoomRelease(out, bundle.files["index.html"].body, bundle.files["llms.txt"].body);
    console.log(`room: bundled browser and ${version.server!.room.releases.length} verified editions`);
    console.log(`server: bundled station and public room APIs into server/server.js (${serverBuild.modules} modules from server/ and shared/, ${serverBuild.bytes.toLocaleString("en")} bytes); version.json server.format ${sceneFormat}`);
  } else console.log("server: server/server.ts does not exist yet; skipped (the release has no server/, version.json no server entry, the verify step no /api/)");
  if (existsSync(join(ROOT, "viewer", "landing-rig.webp"))) copyFileSync(join(ROOT, "viewer", "landing-rig.webp"), join(out, "landing-rig.webp"));   // the landing's picture
  for (const f of [`${asset}.glb`, `${asset}.manifest.json`]) copyFileSync(join(buildDir, f), join(out, "asset", f));
  // The person chunk loads the transcoder after the page is ready.
  const basis = join(ROOT, "node_modules", "three", "examples", "jsm", "libs", "basis");
  mkdirSync(join(out, "libs", "basis"), { recursive: true });
  for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) copyFileSync(join(basis, f), join(out, "libs", "basis", f));
  Object.assign(version, personEntry(join(out, "asset", "manikin")));
  writeFileSync(join(out, "version.json"), JSON.stringify(version, null, 1) + "\n");
  const wiki = buildWiki({ out: join(out, "wiki"), version });

  const files = listFiles(out), size = (list: string[]) => list.reduce((n, f) => n + statSync(f).size, 0);
  const wikiFiles = files.filter((f) => f.startsWith(join(out, "wiki") + sep)), total = size(files);
  console.log(`dist: ${files.length} files, ${(total / 1e6).toFixed(2)} MB → ${out}   (version ${version.short})`);
  for (const f of files.filter((x) => !wikiFiles.includes(x) && !x.startsWith(join(out, "library") + sep))) console.log(`  ${f.slice(out.length + 1).padEnd(32)} ${statSync(f).size.toLocaleString("en")} bytes`);
  console.log(`  ${"wiki/".padEnd(32)} ${size(wikiFiles).toLocaleString("en")} bytes in ${wikiFiles.length} files (${wiki.pages} pages, ${wikiFiles.filter((f) => /\.(png|jpe?g|svg|gif|webp)$/i.test(f)).length} images)`);

  let ok = true;
  const fail = (message: string) => { ok = false; console.error("FAILED: " + message); };
  // The wiki is written by several people at once, so pages that link to pages not written yet are normal while it grows:
  // dist only warns about them (--strict-wiki makes them an error). `bun run deploy` refuses to publish unless
  // `bun run wiki lint` passes (or --allow-lint is given).
  const lint = lintWiki();
  if (wiki.problems.length || lint.errors) {
    const say = args.includes("--strict-wiki") ? fail : (m: string) => console.warn("warning: " + m);
    say(`wiki: ${wiki.problems.length} broken link(s) or image(s) in the site; wiki lint: ${lint.summary}`);
    for (const p of wiki.problems.slice(0, 8)) console.warn("  " + p);
    if (wiki.problems.length > 8) console.warn(`  … and ${wiki.problems.length - 8} more ('bun run wiki lint' lists every finding with its line)`);
  } else console.log(`wiki: every link and image of the site resolves; wiki lint: ${lint.summary}`);

  // nothing from private/ may be in the distribution: no file of dist/ is a byte-for-byte copy of a file under private/
  {
    const bySize = new Map<number, string[]>();
    for (const f of listFiles(join(ROOT, "private"))) { const n = statSync(f).size; bySize.set(n, [...(bySize.get(n) ?? []), f]); }
    const copies = files.filter((f) => (bySize.get(statSync(f).size) ?? []).some((p) => sha(p) === sha(f)));
    if (copies.length) fail(`file(s) identical to a file under private/: ${copies.map((f) => f.slice(out.length + 1)).join(", ")}`);
    else console.log(`private check: no file of the distribution is a copy of a file under private/ (${[...bySize.values()].flat().length} private files compared by size and hash)`);
  }

  if (!args.includes("--no-verify")) {
    let api: Awaited<ReturnType<typeof startBuiltServer>> | null = null, serverSummary = "no server in this release";
    if (serverBuild) {
      try { api = await startBuiltServer(out); } catch (e: any) { fail(`server: ${e.message}`); }
    }
    const idleTimeout = api ? (await import("../server/limits.ts")).LIMITS.idleTimeoutS : undefined;
    const { server, log, origin, base } = serveFolder(out, "/", { api: api?.origin, idleTimeout });
    const errors: string[] = [];
    let wsId = "";
    // the server, through the sub-path as the viewer reaches it: health, the live channel, and its own code not served
    if (api) {
      try {
        if (version.server?.room) await verifyDisposableRoom(origin, version.server.room);
        const probe = { headers: { "x-synergon-probe": "1" } };
        const h = await fetch(`${origin}${base}api/health`, { signal: AbortSignal.timeout(10000) }), health: any = h.ok ? await h.json() : null;
        if (!health?.ok) errors.push(`server: ${base}api/health answered HTTP ${h.status}${health ? " without ok: true" : ""}`);
        else if (health.format !== sceneFormat) errors.push(`server: health reports format ${health.format}, version.json says ${sceneFormat}`);
        else if (health.mode !== "local") errors.push(`server: health reports mode ${health.mode}, expected local`);
        else if (health.revision !== version.revision) errors.push(`server: health reports revision ${health.revision}, version.json says ${version.revision}`);
        const wsList: any = await (await fetch(`${origin}${base}api/workspaces`, { signal: AbortSignal.timeout(10000) })).json().catch(() => null);
        wsId = wsList?.workspaces?.[0]?.id ?? "";
        if (!wsId) errors.push("server: no workspace on a fresh data folder (the Playground should have been made)");
        const live = await fetch(`${origin}${base}api/workspaces/${wsId}/live`, { signal: AbortSignal.timeout(10000) });
        const type = live.headers.get("content-type") ?? "", ev = live.ok && type.includes("text/event-stream") ? await waitEvent(live, "snapshot", 5000) : null;
        if (!live.ok || !type.includes("text/event-stream")) errors.push(`server: ${base}api/workspaces/<id>/live answered HTTP ${live.status} (${type || "no content-type"}), expected an event stream`);
        else if (!ev?.data) errors.push(`server: no snapshot event on ${base}api/workspaces/<id>/live within 5 s (events seen: ${ev?.seen.join(", ") || "none"})`);
        else { try { if (JSON.parse(ev.data)?.doc?.schema !== sceneFormat) errors.push(`server: the snapshot is not a ${sceneFormat} document`); } catch { errors.push("server: the snapshot event carries no JSON"); } }
        for (const p of ["server/server.js", "server/", "server"]) {
          const r = await fetch(`${origin}${base}${p}`, { ...probe, redirect: "manual" }), body = await r.text();
          if (r.status !== 404 || body.includes("listening")) errors.push(`server: ${base}${p} answered HTTP ${r.status}; the server's code must never be served`);
        }
        serverSummary = `server ${health?.revision ?? "?"} (${health?.format ?? "?"}) answered health and streamed ${ev?.seen.join(", ") || "nothing"} through ${base}api/; ${base}server/ refused`;
      } catch (e: any) { errors.push(`server: ${e.message}`); }
    }
    const { Browser } = await import("./render.ts");
    const browser = await Browser.launch();
    try {
      // The room is the default entry. Exercise both editors through the installed proxy routes;
      // all workspaces used here belong to the throwaway data directory.
      if (api && version.server?.room) {
        const land = await browser.page(origin + base);
        await land.waitFor("document.querySelector('a[href^=\"/workspaces/room\"]')", "the public room directory link");
        const about = await land.evaluate(`(async () => {
          const guide = document.querySelector('link[rel=help]')?.href;
          return { guide: guide && await (await fetch(guide)).text(), scripts: performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.js')).reduce((n,e)=>n+e.decodedBodySize,0), canvas:!!document.querySelector('canvas') };
        })()`);
        if (!about.guide?.includes('/api/room/workspaces') || about.scripts > 40_000 || about.canvas) errors.push('room landing must link to the public agent guide and load without the 3D engine');
        errors.push(...land.errors.map(e => "room landing console: " + e));
        await land.close();
        const directory = await browser.page(origin + base + "workspaces/room/?list=1");
        const roomPath = await directory.waitFor("document.querySelector('a[href^=\"/workspaces/room/\"][class*=directory-row]')?.pathname", "a public room in the directory");
        errors.push(...directory.errors.map(e => "room directory console: " + e));
        await directory.close();
        const roomPage = await browser.page(origin + roomPath);
        await roomPage.waitFor("document.querySelector('#room-controls') && document.querySelector('.rv-plan [data-instance]')", "the deployed room editor");
        await roomPage.evaluate("document.querySelector('.rm-mode-option[aria-label=\"3D view\"]').click()");
        await roomPage.waitFor("!!document.querySelector('[data-seated-host]')", "the operator and pinned geometry in the public room", process.env.CI ? 150000 : 60000);
        errors.push(...roomPage.errors.map(e => "room editor console: " + e));
        await roomPage.close();
      }
      // 1. the viewer (in the first workspace when there is a server), its Documentation link and its version line
      const page = await browser.page(`${origin}${base}${api ? `workspaces/${wsId}` : ""}`);
      await page.viewport(1600, 1000);
      await page.waitFor("window.viewerReady || window.viewerError", "the deployed viewer");
      const err = await page.evaluate("window.viewerError || null"), st = await page.evaluate("window.viewerReady ? viewer.state() : null");
      if (err) errors.push("viewer: " + err);
      if (version.person) {   // the person chunk, its package and the transcoder load after the page is ready: wait for them, so their requests are checked too
        const ps = await page.waitFor("viewer.person ? viewer.person.ready.then((ok) => viewer.person.state()) : null", "the person", process.env.CI ? 150000 : 60000)   // software rendering on a CI runner: the person took over a minute there.catch((e: any) => ({ error: e.message }));
        if (!ps?.loaded || !ps?.shown) errors.push(`person: not shown (${ps?.error ?? "unknown"})`);
      }
      if (!(st?.render.triangles > 0)) errors.push("viewer: nothing drawn");
      await page.evaluate("document.getElementById('more-btn').click()");
      const shown = await page.waitFor("(() => { const v = document.querySelector('#more .about .version'); return v && v.textContent ? v.textContent : null; })()", "the version line in Settings", 5000).catch(() => null);
      const docHref = await page.evaluate("document.querySelector('#more .about a')?.href ?? null");
      if (shown !== `Version ${version.short}`) errors.push(`viewer: Settings shows '${shown}', expected 'Version ${version.short}'`);
      if (docHref !== `${origin}${base}wiki/`) errors.push(`viewer: the Documentation link leads to ${docHref}`);
      errors.push(...page.errors.map((e) => "viewer console: " + e));
      await page.close();
      // 2. wiki pages: the index (also without its trailing slash), then a spread of pages
      const has = (re: RegExp) => wiki.pageUrls.filter((u) => re.test(u));
      // the page with the most images (each must load), besides the index, the summary and this deployment page
      const imgCount = (u: string) => (readFileSync(join(out, "wiki", u), "utf8").match(/<img\b/g) ?? []).length;
      const withFigure = [...wiki.pageUrls].sort((a, b) => imgCount(b) - imgCount(a)).find((u) => imgCount(u) > 0);
      const longest = [...wiki.pageUrls].sort((a, b) => statSync(join(out, "wiki", b)).size - statSync(join(out, "wiki", a)).size)[0];
      const sample = [...new Set(["", ...has(/summary\.html$/), ...has(/deployment\.html$/), ...(withFigure ? [withFigure] : []), longest, "README.html", ...wiki.pageUrls.slice(1, 3)])].slice(0, 8);
      let images = 0, clicked = "";
      for (const u of sample) {
        const p = await browser.page(`${origin}${base}wiki${u === "" ? "" : "/" + u}`);   // "" asks for /wiki and must be redirected to /wiki/
        await p.viewport(1280, 900);
        await p.waitFor("document.readyState === 'complete'", `wiki page ${u || "index"}`);
        const r = await p.evaluate(`(async () => {
          const imgs = [...document.images]; imgs.forEach((i) => { i.loading = 'eager'; });
          const loaded = await Promise.all(imgs.map((i) => i.decode().then(() => i.naturalWidth > 0, () => false)));
          const q = document.getElementById('q'); q.value = document.querySelector('#nav h2 + ul a').textContent.split(' ')[0]; q.dispatchEvent(new Event('input'));
          return { title: document.title, h1: document.querySelector('h1')?.textContent ?? '', styled: getComputedStyle(document.querySelector('.tldr')).borderLeftWidth === '4px',
            robots: document.querySelector('meta[name=robots]')?.content ?? '', images: imgs.length, broken: imgs.filter((_, k) => !loaded[k]).map((i) => i.getAttribute('src')),
            hits: document.querySelectorAll('#hits a').length, viewer: document.querySelector('.top .viewer').href, path: location.pathname };
        })()`);
        images += r.images;
        const name = `wiki/${u || "(index, asked for without the trailing slash)"}`;
        if (!r.h1 || !/synergon wiki/i.test(r.title)) errors.push(`${name}: no title`);
        if (!r.styled) errors.push(`${name}: stylesheet not applied`);
        if (!r.robots.includes("noindex")) errors.push(`${name}: no noindex`);
        if (r.broken.length) errors.push(`${name}: image(s) not loaded: ${r.broken.join(", ")}`);
        if (!r.hits) errors.push(`${name}: search found nothing for a word of a page title`);
        if (r.viewer !== `${origin}${base}`) errors.push(`${name}: viewer link leads to ${r.viewer}`);
        if (u === "" && r.path !== `${base}wiki/`) errors.push(`wiki without trailing slash ended at ${r.path}`);
        if (u === sample[1]) {   // follow links like a reader: next page, then a navigation entry, then back to the viewer
          for (const [what, sel] of [["next-page link", ".pager .next"], ["navigation entry", "#nav h2 ~ ul a:not([aria-current])"], ["viewer link", ".top .viewer"]]) {
            const before = await p.evaluate("location.pathname");
            if (!(await p.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`))) continue;
            await p.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
            const after = await p.waitFor(`location.pathname !== ${JSON.stringify(before)} && document.readyState === 'complete' ? location.pathname : null`, `the page behind the ${what}`, 8000).catch(() => null);
            if (!after) { errors.push(`${name}: the ${what} did not lead anywhere`); break; }
            clicked += `${clicked ? ", " : ""}${what} → ${after.replace(base, "") || "viewer"}`;
          }
          if (clicked.endsWith("viewer")) { await p.waitFor("window.viewerReady || window.viewerError || document.querySelector('.room-home main, main.pg')", "the page behind the wiki's link (the landing, or the viewer on a server without workspaces)"); if (await p.evaluate("window.viewerError || null")) errors.push("viewer reached from the wiki failed to load"); }
        }
        errors.push(...p.errors.map((e) => `${name} console: ${e}`));
        await p.close();
      }
      if (api && api.proc.exitCode !== null) errors.push(`server: the built server stopped during the check (code ${api.proc.exitCode}): ${api.output().trim().slice(-800)}`);
      const failed = log.filter((l) => l.status >= 400 && !l.probe), stray = log.filter((l) => !l.path.startsWith(base.slice(0, -1)) || /(^|\/)(private|work)\//.test(l.path));
      for (const l of failed) errors.push(`request failed: ${l.path} (${l.status})`);
      for (const l of stray) errors.push(`stray request: ${l.path}`);
      const good = log.filter((l) => l.status === 200).length;
      console.log(`verify from ${base}: ${errors.length ? "FAILED" : "ok"}: viewer drew ${st?.render.triangles ?? 0} triangles and links to the documentation; ${sample.length} wiki pages loaded (${sample.map((u) => u || "index").join(", ")}) with ${images} images; followed ${clicked || "no links"}; ${serverSummary}; ${good} requests answered, ${failed.length} failed, ${[...new Set(errors)].length} problem(s)`);
      for (const e of [...new Set(errors)]) fail(e);
    } catch (e: any) { fail("verify: " + e.message); }
    await browser.close(); server.stop(true); await api?.stop();
  }
  if (!args.includes("--no-verify") && version.server?.room && ok) {
    try {
      const { verifyRoomRestart } = await import("./deploy-tests/room-restart.ts");
      await verifyRoomRestart(out, startBuiltServer);
      console.log("room restart: public pins, geometry, room and legacy station metadata survived a replacement release");
    } catch (e: any) { fail("room restart: " + e.message); }
  }
  const seconds = (performance.now() - t0) / 1000;
  console.log(`dist ${ok ? "done" : "FAILED"} in ${seconds.toFixed(2)} s`);
  timeline(ok ? "dist" : "dist failed", seconds, `${files.length} files, ${total} bytes (wiki ${size(wikiFiles)} bytes, ${wiki.pages} pages), page bundle ${bundle.files["app.js"].body.length} bytes (app.js) in ${bundle.seconds.toFixed(2)} s, ${serverBuild ? `server bundle ${serverBuild.bytes} bytes` : "no server"}, wiki built in ${wiki.seconds.toFixed(2)} s; wiki ${wiki.problems.length} broken links, lint ${lint.errors} errors`);
  process.exit(ok ? 0 : 1);
}
