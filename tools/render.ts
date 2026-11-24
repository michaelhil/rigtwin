// bun run render [--set ortho|sheet|ids|groups|matched|focus|ui|selftest|wiki|all] [--only <group or id>[,…]] [--out <dir>]
//                [--workspace <name>] [--pose J_x:val,...] [--cam <name>] [--fit <group or id>[,…]] [--mode ids|class] [--viewer <dir>]
//                [--photos <dir>]
// Drives the real viewer page in headless Chromium (same renderer the user sees) and writes PNGs.
// Output: work/renders/<set>/…  (or work/<workspace>/renders/<set>/…). Anything containing photo pixels
// (matched side-by-side and outline images) goes to private/renders/matched/ instead.
//
// Publishable photo comparisons:  bun run render --set matched --photos wiki/img/photos [--out wiki/img/matched]
//   With --photos the photo layer is the masked copy photo-<n>.jpg from that folder instead of the original
//   (the cameras' pixel coordinates are scaled to its size, and the server refuses every other file under
//   private/). Per solved camera it writes rig-<rig>-photo-<n>-side-by-side.jpg (photo | render),
//   -outline.jpg (model outlines on the photo) and -strip.jpg (photo | render | outlines), each under
//   400 kB; <rig> is the camera's `rig` field in lower case (b, c1, c2).
// Documentation images:  bun run render --set wiki
//   Regenerates every model image the wiki uses into wiki/img/model/ (rig-b-contact-sheet, rig-b-parts-
//   colour-coded, rig-b-group-<group>, rig-b-view-{front-left,rear-right,operators-eye,side} at 1600 px,
//   rig-b-joint-limits) and the masked photo comparisons into wiki/img/matched/. File names are stable,
//   so the pages need no change after the model changes. Always the full model in its neutral pose.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { ROOT, timeline } from "./timeline.ts";
import { startServer, buildDir } from "./serve.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findChrome(): string {
  if (process.env.RIGTWIN_CHROME) return process.env.RIGTWIN_CHROME;
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).sort().reverse() : [];
  for (const d of dirs.filter((x) => x.startsWith("chromium_headless_shell-"))) {
    for (const sub of existsSync(join(cache, d)) ? readdirSync(join(cache, d)) : []) { const p = join(cache, d, sub, "chrome-headless-shell"); if (existsSync(p)) return p; }
  }
  for (const d of dirs.filter((x) => x.startsWith("chromium-"))) {
    for (const sub of readdirSync(join(cache, d))) { const p = join(cache, d, sub, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"); if (existsSync(p)) return p; }
  }
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) if (existsSync(p)) return p;   // Linux, e.g. the CI runner
  throw new Error("no Chromium found (Playwright cache under ~/Library/Caches/ms-playwright, or /usr/bin/google-chrome); set RIGTWIN_CHROME to a Chromium binary");
}

export class Page {
  private id = 0; private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  errors: string[] = [];
  constructor(private ws: WebSocket, public targetId: string, private port: number) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.method === "Runtime.exceptionThrown") this.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") this.errors.push(m.params.entry.text + " " + (m.params.entry.url ?? ""));
      if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) this.errors.push(m.params.type + ": " + m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    };
  }
  call(method: string, params: any = {}): Promise<any> { return new Promise((res, rej) => { this.pending.set(++this.id, { res, rej }); this.ws.send(JSON.stringify({ id: this.id, method, params })); }); }
  async evaluate(expression: string): Promise<any> {
    const r = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async viewport(w: number, h: number) { await this.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); }
  /** PNG, or for a .jpg file name a JPEG at the highest quality that stays under `maxBytes` (documentation images). A JPEG that
   *  shows the same picture as the file already there (up to encoder noise, see samePicture) leaves that file untouched, so
   *  re-running a documentation set on an unchanged model changes no committed file. Returns "kept" or "written". */
  async screenshot(file: string, maxBytes = 400_000): Promise<"kept" | "written"> {
    mkdirSync(join(file, ".."), { recursive: true });
    if (!/\.jpe?g$/i.test(file)) { const { data } = await this.call("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(data, "base64")); return "written"; }
    for (let quality = 88; ; quality -= 8) {
      const buf = Buffer.from((await this.call("Page.captureScreenshot", { format: "jpeg", quality })).data, "base64");
      if (buf.length <= maxBytes || quality <= 48) {
        if (existsSync(file) && (await this.samePicture(readFileSync(file), buf))) { Page.kept++; return "kept"; }
        writeFileSync(file, buf); return "written";
      }
    }
  }
  /** Number of documentation images left untouched because the new capture showed the same picture. */
  static kept = 0;
  /** True when two JPEGs decode to the same size and differ in at most 16 blocks of 16 × 16 pixels, by at most 12 levels of
   *  255: what a one-level difference in a handful of anti-aliased pixels (seen in the corner axes of the group sheets: 8 blocks,
   *  up to 5 levels) becomes after JPEG coding. A real change of the model moves edges, which differ by far more than 12 levels. */
  async samePicture(a: Buffer, b: Buffer): Promise<boolean> {
    if (a.equals(b)) return true;
    const url = (x: Buffer) => "data:image/jpeg;base64," + x.toString("base64");
    const r = await this.evaluate(`(async () => {
      const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s; });
      const [A, B] = await Promise.all([load(${JSON.stringify(url(a))}), load(${JSON.stringify(url(b))})]);
      if (A.naturalWidth !== B.naturalWidth || A.naturalHeight !== B.naturalHeight) return { blocks: 1e9, max: 255 };
      const px = (img) => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const da = px(A), db = px(B), w = A.naturalWidth, blocks = new Set(); let max = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        if (d > 0) { max = Math.max(max, d); const k = i / 4; blocks.add(((k / w / 16) | 0) * 100000 + ((k % w) / 16 | 0)); }
      }
      return { blocks: blocks.size, max };
    })()`).catch(() => ({ blocks: 1e9, max: 255 }));
    if (process.env.RIGTWIN_DEBUG_SAME) console.log(`samePicture: ${r.blocks} block(s) differ, by up to ${r.max} levels`);
    return r.blocks <= 16 && r.max <= 12;
  }
  async waitFor(expr: string, what: string, ms = 20000) {
    const t0 = Date.now();
    for (;;) { const v = await this.evaluate(expr).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}. Page errors: ${this.errors.join(" | ") || "none"}`); await sleep(25); }
  }
  async close() { try { await fetch(`http://127.0.0.1:${this.port}/json/close/${this.targetId}`); } catch { /* closing anyway */ } this.ws.close(); }
}

export class Browser {
  private constructor(private child: any, private profile: string, public port: number) {}
  static async launch(): Promise<Browser> {
    const profile = mkdtempSync(join(tmpdir(), "rigtwin-render-"));
    // Graphics: Metal on macOS (the development machine); on Linux (the CI runner, no GPU) WebGL runs on
    // SwiftShader, which Chrome only allows with --enable-unsafe-swiftshader. Extra flags: RIGTWIN_CHROME_FLAGS.
    const gfx = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"];
    const extra = (process.env.RIGTWIN_CHROME_FLAGS ?? "").split(/\s+/).filter(Boolean);
    const child = spawn(findChrome(), ["--headless=new", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1600,1000", "--force-device-scale-factor=1", "--hide-scrollbars", ...gfx, "--disable-background-timer-throttling", "--disable-renderer-backgrounding", ...extra, "about:blank"], { stdio: "ignore" });
    let port = 0;
    // A warm start takes well under a second; a cold start on a fresh CI runner can take several (a 5 s
    // limit failed there once), so wait up to 30 s.
    for (let i = 0; i < 1200 && !port; i++) { try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); } catch { await sleep(25); } }
    if (!port) { child.kill(); throw new Error("Chromium did not open a debugging port within 30 s"); }
    return new Browser(child, profile, port);
  }
  async page(url: string): Promise<Page> {
    const target: any = await (await fetch(`http://127.0.0.1:${this.port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cannot connect to the page")); });
    const page = new Page(ws, target.id, this.port);
    await page.call("Runtime.enable"); await page.call("Log.enable"); await page.call("Page.enable");
    return page;
  }
  async close() { this.child.kill(); await sleep(150); rmSync(this.profile, { recursive: true, force: true }); }
}

/** One viewer session: server + browser + page with the viewer loaded and its UI hidden. */
export async function openViewer(opts: { workspace?: string; photos?: string; requests?: string[] } = {}) {
  // an empty temporary Playground: no pose of the shared scene reaches a picture
  const server = await startServer({ port: 0, workspace: opts.workspace, photos: opts.photos, requests: opts.requests, data: "temp" });
  const origin = `http://127.0.0.1:${server.port}`;
  const browser = await Browser.launch();
  const page = await browser.page(`${origin}/?ui=0`);
  await page.viewport(1200, 900);
  await page.waitFor("window.viewerReady || window.viewerError", "the viewer to load");
  const err = await page.evaluate("window.viewerError || null");
  if (err) { await browser.close(); server.stop(true); throw new Error("viewer failed to load: " + err); }
  const shot = async (o: Record<string, unknown>, file: string, w = 1200, h = 900) => {
    await page.viewport(w, h);
    const st = await page.evaluate(`viewer.apply(${JSON.stringify({ ui: "0", ...o })})`);
    await page.screenshot(file);
    return st;
  };
  const sheet = async (spec: { title: string; sub?: string; cols: number; tileWidth: number; tiles: { src: string; label: string }[]; footer?: string[]; pad?: number }, file: string) => {
    const p = await browser.page(`${origin}/_tools/sheet.html#${encodeURIComponent(JSON.stringify(spec))}`);
    await p.waitFor("window.sheetReady", "the sheet page");
    const [w, h] = await p.evaluate("window.sheetSize");
    await p.viewport(w, h); await sleep(30);
    await p.screenshot(file);
    await p.close();
  };
  /** URL under which the server exposes a file of this repository (work/ or private/ only). */
  const urlOf = (file: string) => "/" + relative(ROOT, file).split("\\").join("/");
  return { page, shot, sheet, urlOf, origin, close: async () => { await browser.close(); server.stop(true); } };
}

/** Beauty views of the documentation set: viewer view, file-name part. The view directions are in viewer/src/engine.ts (VIEWS). */
const BEAUTY: [string, string][] = [["front_quarter", "front-left"], ["three_quarter", "rear-right"], ["operator", "operators-eye"], ["left", "side"]];
/** Joint-limit sheet of the documentation set: one pair of tiles per joint (lower limit, upper limit), both from one fixed
 *  camera that looks along `dir` (model frame, towards the camera) at the neutral-pose box of `fit`, with `margin` room. */
const MOTIONS: { joint: string; label: string; words: [string, string]; only: string; fit: string; dir: number[]; margin: number }[] = [
  { joint: "J_seat_slide", label: "Seat slide", words: ["back", "forward"], only: "seat,platform", fit: "seat", dir: [0, 1, 0.12], margin: 1.12 },
  { joint: "J_seat_recline", label: "Seat recline", words: ["upright", "reclined"], only: "seat,platform", fit: "seat", dir: [0, 1, 0.12], margin: 1.12 },
  { joint: "J_mon_height", label: "Monitor height", words: ["lowest", "highest"], only: "stand,platform", fit: "stand", dir: [0, 1, 0.1], margin: 1.12 },
  { joint: "J_mon_tilt", label: "Monitor tilt", words: ["tipped down", "tipped up"], only: "stand,platform", fit: "stand", dir: [0, 1, 0.1], margin: 1.12 },
  { joint: "J_joy_L_pitch", label: "Left joystick pitch", words: ["back", "forward"], only: "pods", fit: "C_joy_base_L,C_joy_lever_L", dir: [0, 1, 0.3], margin: 1.45 },
  { joint: "J_joy_L_roll", label: "Left joystick roll", words: ["to the left", "to the right"], only: "pods", fit: "C_joy_base_L,C_joy_lever_L", dir: [-1, 0, 0.3], margin: 1.45 },
  { joint: "J_pod_armrest_L", label: "Left armrest pad", words: ["back", "forward"], only: "pods", fit: "C_pod_armrest_L,C_pod_plate_L", dir: [0, 1, 0.3], margin: 1.1 },
  { joint: "J_pedal_2", label: "Middle pedal", words: ["at rest", "pressed"], only: "pedals", fit: "C_pedal_base,C_pedal_arm_2", dir: [0, 1, 0.15], margin: 1.15 },
];

/** Perspective camera [x, y, z, tx, ty, tz, fov] (model frame, the viewer's `camera` option) that shows the neutral-pose boxes of
 *  `fit` (component ids or groups) from direction `dir`, with every box corner inside the picture shrunk by `margin`. */
function cameraOn(manifest: any, fit: string, dir: number[], aspect: number, margin: number, fov = 35): number[] {
  const want = fit.split(","), boxes = [...manifest.components, ...manifest.surfaces].filter((c: any) => c.bbox && (want.includes(c.id) || want.includes(c.group))).map((c: any) => c.bbox);
  if (!boxes.length) throw new Error(`cameraOn: nothing with a box matches '${fit}'`);
  const min = [0, 1, 2].map((k) => Math.min(...boxes.map((b: any) => b.min[k]))), max = [0, 1, 2].map((k) => Math.max(...boxes.map((b: any) => b.max[k])));
  const target = [0, 1, 2].map((k) => (min[k] + max[k]) / 2), len = Math.hypot(...dir), d = dir.map((x) => x / len);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a: number[]) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
  const right = norm(cross(d.map((x) => -x), [0, 0, 1])), up = cross(right, d.map((x) => -x));
  const tv = Math.tan((fov * Math.PI) / 360) / margin, th = tv * aspect;
  let dist = 0;
  for (let i = 0; i < 8; i++) {
    const c = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]].map((x, k) => x - target[k]);
    dist = Math.max(dist, dot(c, d) + Math.abs(dot(c, right)) / th, dot(c, d) + Math.abs(dot(c, up)) / tv);
  }
  return [...target.map((x, k) => x + d[k] * dist), ...target, fov];
}

const ORTHO: [string, string][] = [["front", "Front (from the display side)"], ["rear", "Rear"], ["left", "Left (operator's left)"], ["right", "Right"], ["top", "Top (forward is up)"]];

if (import.meta.main) {
  const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const workspace = opt("--workspace") ?? process.env.RIGTWIN_WORKSPACE;
  if (opt("--viewer")) process.env.RIGTWIN_VIEWER_DIR = opt("--viewer");   // viewer source directory (default "viewer")
  const sets = (opt("--set") ?? "sheet").split(",").flatMap((s) => (s === "all" ? ["ortho", "sheet", "ids", "groups", "matched"] : [s]));
  const only = opt("--only"), pose = opt("--pose"), asset = "rig-b";
  // masked photo copies: given with --photos, and always for the documentation set
  const photos = opt("--photos") ? resolve(ROOT, opt("--photos")!) : sets.includes("wiki") ? join(ROOT, "wiki", "img", "photos") : undefined;
  if (photos && !existsSync(photos)) { console.error(`error: no folder ${photos} (masked photo copies photo-<n>.jpg are expected there)`); process.exit(1); }
  const served: string[] = [];
  const outBase = opt("--out") ?? (workspace ? join(ROOT, "work", workspace, "renders") : join(ROOT, "work", "renders"));
  const privBase = join(ROOT, "private", "renders", ...(workspace ? [workspace] : []));
  const manifestPath = join(buildDir(workspace), "rig-b.manifest.json");
  if (!existsSync(manifestPath)) { console.error(`error: no build found at ${manifestPath}. Run "bun run build" first.`); process.exit(1); }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const common: Record<string, unknown> = { ...(only ? { only } : {}), ...(pose ? { pose } : {}) };
  const footer = [
    `${manifest.totals.triangles.toLocaleString("en")} triangles · ${manifest.totals.primitives} draw primitives · ${(manifest.glb.bytes / 1e6).toFixed(2)} MB · GLB ${manifest.glb.sha256.slice(0, 12)}${only ? ` · showing only: ${only}` : ""}${pose ? ` · pose: ${pose}` : ""}`,
    manifest.omitted.length ? "!Omitted: " + manifest.omitted.map((o: any) => `${o.id} (${o.reason})`).join("; ") : "Omitted: none",
    ...(manifest.missing.length ? ["!Missing (in tree, no mesh, not declared omitted): " + manifest.missing.join(", ")] : []),
    ...(manifest.build.partial ? [`!PARTIAL BUILD (only ${manifest.build.only.join(", ")}): ${manifest.not_built.length} components not built`] : []),
  ];
  const tStart = performance.now();
  let v: Awaited<ReturnType<typeof openViewer>>;
  try { v = await openViewer({ workspace, photos, requests: served }); } catch (e: any) { console.error("error: " + e.message); process.exit(1); }
  const launch = (performance.now() - tStart) / 1000;
  let failed = false;
  /** Photo comparisons that may be published: the photo layer is the masked copy, never the original. */
  const matchedMasked = async (outDir: string, want?: string[]) => {
    const files: string[] = [], tiles = join(ROOT, "work", "renders", "matched-masked"), from = served.length;
    const cams: string[] = await v.page.evaluate("viewer.cameras()");
    if (!cams.length) { console.log("matched (masked photos): no solved cameras (private/evidence/cameras.json is not on this machine); the existing images are kept"); return files; }
    for (const cam of want ?? cams) {
      if (!cams.includes(cam)) { console.error(`matched: no camera '${cam}' with a masked photo in ${relative(ROOT, photos!)} (have: ${cams.join(", ")})`); failed = true; continue; }
      const info = await v.page.evaluate(`viewer.cameraInfo(${JSON.stringify(cam)})`);
      if (!info.masked || !String(info.image).startsWith("_photos/")) throw new Error(`camera ${cam} is not using a masked photo (image ${info.image}); nothing written`);
      // named after the rig in the photo (camera field `rig`: B, C1, C2), not after the model
      const n = /(\d+)/.exec(cam)![1], stem = `rig-${String(info.rig ?? "B").toLowerCase()}-photo-${n}`, w = info.width, h = info.height, o = { ...(pose ? { pose } : {}), cam };
      const render = join(tiles, `${stem}-render.png`); await v.shot({ ...o, overlay: "none" }, render, w, h);
      const outlineTile = join(tiles, `${stem}-outline.png`); await v.shot({ ...o, overlay: "outline" }, outlineTile, w, h);
      const outline = join(outDir, `${stem}-outline.jpg`); await v.page.screenshot(outline); files.push(outline);
      const photo = { src: "/" + info.image, label: `Photo ${n}${info.rig && info.rig !== "B" ? ` (Rig ${info.rig}, another unit of the same design)` : ""}, masked` };
      const side = join(outDir, `${stem}-side-by-side.jpg`);
      await v.sheet({ title: "", cols: 2, tileWidth: 700, tiles: [photo, { src: v.urlOf(render), label: "Model from the solved camera" }] }, side); files.push(side);
      const strip = join(outDir, `${stem}-strip.jpg`);
      await v.sheet({ title: "", cols: 3, tileWidth: 560, tiles: [photo, { src: v.urlOf(render), label: "Model from the solved camera" }, { src: v.urlOf(outlineTile), label: "Model outlines on the photo" }] }, strip); files.push(strip);
    }
    // every request the pages made: only the viewer, the model, the sheet page, model-only tiles and the masked photos
    const allowed = /^\/(index\.html|viewer\.(js|css)|version\.json|favicon\.ico|private\/evidence\/cameras\.json|asset\/[^/]+|_tools\/[^/]+|_photos\/photo-\d+\.jpg|work\/renders\/(matched-masked|wiki)\/.+)$/;
    const odd = [...new Set(served.slice(from).filter((p) => !allowed.test(p.endsWith("/") ? p + "index.html" : p)))];
    if (odd.length) throw new Error(`the pages asked for ${odd.length} unexpected file(s) (${odd.join(", ")}); a photo comparison may only read the masked copies, so nothing written may be trusted`);
    const used = served.slice(from).filter((p) => p.startsWith("/_photos/"));
    console.log(`matched (masked photos): photo layer from ${relative(ROOT, photos!)} (${new Set(used).size} masked files read, 0 originals; the server has no route to private/ except the re-scaled camera file)`);
    return files;
  };
  try {
    for (const set of sets) {
      const t0 = performance.now(), out = join(outBase, set), files: string[] = [];
      if (set === "ortho") {
        for (const [view, label] of ORTHO) { const f = join(out, `${view}.png`); await v.shot({ ...common, view, proj: "ortho", hud: "1", caption: label }, f, 1200, 1140); files.push(f); }
      } else if (set === "sheet") {
        const tiles: { src: string; label: string }[] = [];
        for (const [view, label] of ORTHO) { const f = join(out, "tiles", `${view}.png`); await v.shot({ ...common, view, proj: "ortho", hud: "1" }, f, 800, 760); tiles.push({ src: v.urlOf(f), label }); }
        const f = join(out, "tiles", "three_quarter.png"); await v.shot({ ...common, view: "three_quarter", hud: "1", ...(only ? { fit: only } : {}) }, f, 800, 760); tiles.push({ src: v.urlOf(f), label: "Three-quarter (perspective)" });
        const file = join(out, "sheet.png");
        await v.sheet({ title: `${manifest.title}: contact sheet`, sub: "Orthographic views share one fixed frame; scale bar 0.5 m; axes X forward, Y operator's left, Z up.", cols: 3, tileWidth: 800, tiles, footer }, file);
        files.push(file);
      } else if (set === "ids") {
        const tiles: { src: string; label: string }[] = [];
        for (const [view, label, proj] of [["three_quarter", "Rear three-quarter", "persp"], ["front_quarter", "Front three-quarter", "persp"], ["top", "Top", "ortho"]]) {
          const f = join(out, `${view}.png`); await v.shot({ ...common, view, proj, mode: "ids", legend: "1", hud: "1", caption: label }, f, 1500, 1000); files.push(f); tiles.push({ src: v.urlOf(f), label });
        }
      } else if (set === "groups") {
        for (const g of only ? only.split(",") : manifest.groups) {
          const tiles: { src: string; label: string }[] = [];
          for (const [view, label] of [["three_quarter", "rear three-quarter"], ["front_quarter", "front three-quarter"], ["left", "left"]]) {
            const f = join(out, "tiles", `${g}_${view}.png`); await v.shot({ ...(pose ? { pose } : {}), view, only: g, fit: g, hud: "1" }, f, 800, 700); tiles.push({ src: v.urlOf(f), label: `${g}: ${label}` });
          }
          const file = join(out, `${g}.png`);
          const comps = [...manifest.components, ...manifest.surfaces].filter((c: any) => c.group === g && c.triangles > 0);
          await v.sheet({ title: `${manifest.title}: group "${g}" isolated`, sub: `${comps.length} components, ${comps.reduce((n: number, c: any) => n + c.triangles, 0).toLocaleString("en")} triangles`, cols: 3, tileWidth: 800, tiles, footer: [comps.map((c: any) => c.id).join(", ")] }, file);
          files.push(file);
        }
      } else if (set === "matched" && photos) {
        files.push(...(await matchedMasked(opt("--out") ? resolve(ROOT, opt("--out")!) : join(ROOT, "wiki", "img", "matched"), opt("--cam")?.split(","))));
      } else if (set === "wiki") {
        // every model image the wiki uses, under stable names; always the whole model in its neutral pose
        if (manifest.build.partial) { console.error("wiki: the current build is partial; run a full 'bun run build' first"); failed = true; continue; }
        const img = opt("--out") ? resolve(ROOT, opt("--out")!) : join(ROOT, "wiki", "img"), model = join(img, "model"), tiles = join(ROOT, "work", "renders", "wiki", "tiles");
        const sheetTiles: { src: string; label: string }[] = [];
        for (const [view, label] of ORTHO) { const f = join(tiles, `${view}.png`); await v.shot({ view, proj: "ortho", hud: "1" }, f, 800, 760); sheetTiles.push({ src: v.urlOf(f), label }); }
        { const f = join(tiles, "three_quarter.png"); await v.shot({ view: "three_quarter", hud: "1" }, f, 800, 760); sheetTiles.push({ src: v.urlOf(f), label: "Three-quarter (perspective)" }); }
        let file = join(model, `${asset}-contact-sheet.jpg`);
        await v.sheet({ title: `${manifest.title}: contact sheet`, sub: "Orthographic views share one fixed frame; scale bar 0.5 m; axes X forward, Y operator's left, Z up.", cols: 3, tileWidth: 600, tiles: sheetTiles, footer }, file); files.push(file);
        file = join(model, `${asset}-parts-colour-coded.jpg`); await v.shot({ view: "three_quarter", mode: "ids", legend: "1", hud: "1" }, file, 1600, 1000); files.push(file);
        for (const g of manifest.groups) {
          const gt: { src: string; label: string }[] = [];
          for (const [view, label] of [["three_quarter", "rear three-quarter"], ["front_quarter", "front three-quarter"], ["left", "left"]]) { const f = join(tiles, `${g}_${view}.png`); await v.shot({ view, only: g, fit: g, hud: "1" }, f, 800, 700); gt.push({ src: v.urlOf(f), label: `${g}: ${label}` }); }
          const comps = [...manifest.components, ...manifest.surfaces].filter((c: any) => c.group === g && c.triangles > 0);
          file = join(model, `${asset}-group-${g}.jpg`);
          await v.sheet({ title: `${manifest.title}: group "${g}" on its own`, sub: `${comps.length} components, ${comps.reduce((k: number, c: any) => k + c.triangles, 0).toLocaleString("en")} triangles`, cols: 3, tileWidth: 600, tiles: gt, footer: [comps.map((c: any) => c.id).join(", ")] }, file); files.push(file);
        }
        // four beauty views, 1600 px wide, no annotations
        for (const [view, name] of BEAUTY) { file = join(model, `${asset}-view-${name}.jpg`); await v.shot({ view }, file, 1600, 1000); files.push(file); }
        // the moving parts at both ends of their travel, each pair seen from the same fixed camera
        const jt: { src: string; label: string }[] = [], joints = new Map<string, any>(manifest.joints.map((j: any) => [j.id, j]));
        for (const m of MOTIONS) {
          const j = joints.get(m.joint);
          if (!j) { console.error(`wiki: joint ${m.joint} is not in the manifest; joint sheet tile left out`); failed = true; continue; }
          for (const end of ["lower", "upper"] as const) {
            const value = j[end], shown = j.type === "prismatic" ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value * 1000))} mm` : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round((value * 180) / Math.PI))}°`;
            const f = join(tiles, `joint_${m.joint}_${end}.png`);
            await v.shot({ camera: cameraOn(manifest, m.fit, m.dir, 640 / 520, m.margin).map((x) => +x.toFixed(5)).join(","), only: m.only, pose: `${m.joint}:${j.type === "prismatic" ? value : (value * 180) / Math.PI}` }, f, 640, 520);
            jt.push({ src: v.urlOf(f), label: `${m.label} ${shown} (${m.words[end === "lower" ? 0 : 1]})` });
          }
        }
        file = join(model, `${asset}-joint-limits.jpg`);
        await v.sheet({ title: `${manifest.title}: moving parts at their limits`, sub: "Each pair: the same camera, the joint at its lower and at its upper limit, everything else in the neutral pose. Locked adjustments (seat) are shown unlocked.", cols: 4, tileWidth: 400, tiles: jt, footer: [footer[0]] }, file); files.push(file);
        files.push(...(await matchedMasked(join(img, "matched"))));
        // anything else in the two folders was not written by this run: name it (it may be stale after a rename)
        for (const dir of [model, join(img, "matched")]) for (const f of existsSync(dir) ? readdirSync(dir) : []) if (!f.startsWith(".") && !files.includes(join(dir, f))) console.log(`note: ${relative(ROOT, join(dir, f))} was not written by this run (stale?)`);
      } else if (set === "matched") {
        const cams: string[] = await v.page.evaluate("viewer.cameras()");
        const want = opt("--cam") ? opt("--cam")!.split(",") : cams;
        if (!cams.length) console.log("matched: private/evidence/cameras.json is not there yet; nothing rendered");
        for (const cam of want) {
          if (!cams.includes(cam)) { console.error(`matched: no camera '${cam}' (have: ${cams.join(", ")})`); failed = true; continue; }
          const info = await v.page.evaluate(`viewer.cameraInfo(${JSON.stringify(cam)})`);
          const h = 1200, w = Math.round((h * info.width) / info.height);
          const render = join(out, `${cam}_render.png`), priv = join(privBase, "matched");
          await v.shot({ ...common, cam, overlay: "none" }, render, w, h); files.push(render);
          const ids = join(out, `${cam}_ids.png`); await v.shot({ ...common, cam, overlay: "none", mode: "ids" }, ids, w, h); files.push(ids);
          const outline = join(priv, `${cam}_outline.png`); await v.shot({ ...common, cam, overlay: "outline" }, outline, w, h); files.push(outline);
          const blend = join(priv, "tiles", `${cam}_blend.png`); await v.shot({ ...common, cam, overlay: "blend" }, blend, w, h);
          const side = join(priv, `${cam}_side.png`);
          await v.sheet({ title: `${manifest.title} against ${cam}${info.rig && info.rig !== "B" ? ` (photo shows Rig ${info.rig}, another instance: compare shapes, not layout)` : ""}`, sub: "Photo · render from the solved camera · component outlines on the photo · 50 % blend", cols: 4, tileWidth: Math.round(w * 0.75), tiles: [{ src: "/" + info.image, label: "photo" }, { src: v.urlOf(render), label: "render" }, { src: v.urlOf(outline), label: "outlines" }, { src: v.urlOf(blend), label: "blend" }], footer }, side);
          files.push(side);
        }
      } else if (set === "focus") {
        // close-ups: --fit <ids or groups> frames the views on those parts; add --only to hide everything else
        const fit = opt("--fit") ?? only;
        if (!fit) { console.error("focus: give --fit <component or group>[,…] (and optionally --only to isolate)"); failed = true; continue; }
        const tiles: { src: string; label: string }[] = [], name = fit.replace(/[^A-Za-z0-9_,-]/g, "").replaceAll(",", "+");
        for (const [view, label] of [["three_quarter", "rear three-quarter"], ["front_quarter", "front three-quarter"], ["left", "left"], ["right", "right"], ["top", "top"], ["front", "front"]]) {
          const f = join(out, "tiles", `${name}_${view}.png`); await v.shot({ ...common, view, fit, hud: "1", mode: opt("--mode") ?? "normal" }, f, 800, 700); tiles.push({ src: v.urlOf(f), label });
        }
        const file = join(out, `${name}.png`);
        await v.sheet({ title: `${manifest.title}: ${fit}`, sub: only ? `showing only ${only}` : "in context", cols: 3, tileWidth: 800, tiles, footer }, file);
        files.push(file);
      } else if (set === "ui") {
        // the page as a person sees it, panels included
        for (const [name, o] of [["default", {}], ["by_component", { mode: "ids" }], ["by_data_source", { mode: "class" }]] as [string, Record<string, unknown>][]) { const f = join(out, `${name}.png`); await v.shot({ ...common, ...o, ui: "1" }, f, 1600, 1000); files.push(f); }
      } else if (set === "selftest") {
        const r = await v.page.evaluate("viewer.selfTest()");
        console.log(`selftest: ${r.pass ? "PASS" : "FAIL"}: ${r.checked} points over ${r.cameras.length} camera(s), worst error ${Number(r.worst_px).toFixed(3)} px (tolerance ${r.tolerance_px} px)`);
        mkdirSync(out, { recursive: true }); writeFileSync(join(out, "selftest.json"), JSON.stringify(r, null, 1));
        if (!r.pass) failed = true;
      } else { console.error(`unknown set '${set}' (ortho, sheet, ids, groups, matched, focus, ui, selftest, wiki, all)`); failed = true; continue; }
      const sec = (performance.now() - t0) / 1000, kept = Page.kept; Page.kept = 0;
      const folders = [...new Set(files.map((f) => relative(ROOT, join(f, ".."))))];
      console.log(`${set}: ${files.length} image(s) in ${sec.toFixed(2)} s${files.length ? " → " + (files.length > 1 ? folders.map((d) => `${d}/ (${files.filter((f) => relative(ROOT, join(f, "..")) === d).length})`).join(", ") : relative(ROOT, files[0])) : ""}${kept ? `; ${kept} showed the same picture as before and were left untouched` : ""}`);
      timeline(`render ${set}`, sec, `${files.length} images${kept ? ` (${kept} unchanged)` : ""}${only ? `, only ${only}` : ""}${workspace ? `, workspace ${workspace}` : ""}`);
    }
    if (v.page.errors.length) { console.error("page errors:\n  " + [...new Set(v.page.errors)].join("\n  ")); }
  } catch (e: any) {
    console.error("error: " + e.message); failed = true;
  } finally { await v.close(); }
  const total = (performance.now() - tStart) / 1000;
  console.log(`render total ${total.toFixed(2)} s (browser start and viewer load ${launch.toFixed(2)} s)`);
  timeline("render total", total, `sets ${sets.join(",")}; launch ${launch.toFixed(2)} s`);
  process.exit(failed ? 1 : 0);
}
