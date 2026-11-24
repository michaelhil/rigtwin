// bun run serve [--port 4173] [--workspace <name>] [--viewer <dir>] [--data <dir> | --no-api]
// Static server for the viewer, laid out exactly like the deployed dist/, with the rigtwin server
// (server/server.ts, local mode) mounted on the same port under /api/: the shared Playground is kept in
// <data>/playground/doc.json, by default ../rigtwin-projects/ next to the repository. `bun run rig` talks
// to it. render and ui-accept start it with an empty temporary data folder (data: "temp"), so no pose of
// the Playground reaches a published picture. The served files:
//   /            the bundled viewer (index.html, viewer.css, viewer.js), rebuilt in memory whenever
//                a file under viewer/ or shared/ has changed; no manual bundling step
//   /asset/      assets/rig-b/build/   (or work/<workspace>/build/)
//   /wiki/       dist/wiki/ if `bun run wiki build` has been run (so the viewer's Documentation link works locally)
//   /version.json  what dist/version.json would say for the working copy
// plus, for local work only (never deployed): /private/ (photo cameras, photos) and /work/ (renders).
//
// With `photos: <dir>` (render --photos, render --set wiki) the photo layer comes from the masked,
// publishable copies in that folder (photo-<n>.jpg for camera IMG_<n>): the camera file is answered with
// the image path replaced and the pixel coordinates scaled to the masked image's size, and every request
// for a file under private/ other than the camera file is refused, so no unmasked pixel can reach a render.
import { join, normalize, extname, resolve } from "node:path";
import { existsSync, statSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ROOT } from "./timeline.ts";
import { bundleViewer, viewerSourceTime, type ViewerBundle } from "./bundle.ts";
import { currentVersion, sourceRevision } from "./version.ts";
import { createApi, LOCAL_HOSTS } from "../server/server.ts";
import { LIMITS } from "../server/limits.ts";
import { SCENE_FORMAT } from "../shared/commands/doc.ts";

const CAMERAS = "/private/evidence/cameras.json";

/** Width and height of a JPEG or PNG file, read from its header. */
export function imageSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  throw new Error(`cannot read the size of ${file}`);
}

/** The solved photo cameras, re-pointed at the masked copies in `dir` and scaled to their pixel size. Cameras without a masked copy are left out. */
export function maskedCameras(dir: string): { json: any; used: string[]; skipped: string[] } {
  const src = JSON.parse(readFileSync(join(ROOT, "private", "evidence", "cameras.json"), "utf8")), cameras: Record<string, any> = {}, used: string[] = [], skipped: string[] = [];
  for (const [name, c] of Object.entries<any>(src.cameras ?? {})) {
    const n = /(\d+)/.exec(name)?.[1], file = join(dir, `photo-${n}.jpg`);
    if (!n || !existsSync(file)) { skipped.push(name); continue; }
    const { width, height } = imageSize(file), sx = width / c.width, sy = height / c.height;
    if (Math.abs(sx - sy) / sx > 0.005) throw new Error(`${file} is ${width} × ${height}, the camera ${name} was solved on ${c.width} × ${c.height}: the masked copy does not have the same framing`);
    cameras[name] = { ...c, image: `_photos/photo-${n}.jpg`, width, height, fx: c.fx * sx, fy: c.fy * sy, cx: c.cx * sx, cy: c.cy * sy, masked: true };
    used.push(name);
  }
  return { json: { ...src, cameras }, used, skipped };
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

export function buildDir(workspace?: string, asset = "rig-b") { return workspace ? join(ROOT, "work", workspace, "build") : join(ROOT, "assets", asset, "build"); }

/** Where the Playground of `bun run serve` lives: <data>/playground/doc.json. */
export const DEFAULT_DATA = join(ROOT, "..", "rigtwin-projects");

/** The viewer and (unless `data` is false) the rigtwin server on one port. `data: "temp"` gives the server an empty
 *  temporary data folder, removed by stop(); `reset()` empties the Playground again (tools only). */
export async function startServer(opts: { port?: number; workspace?: string; asset?: string; photos?: string; requests?: string[]; data?: string | false } = {}) {
  let bundle: ViewerBundle = await bundleViewer();
  const temp = opts.data === "temp" ? mkdtempSync(join(tmpdir(), "rigtwin-scene-")) : null;
  const api = opts.data === false ? null : createApi({ dataDir: temp ?? opts.data ?? DEFAULT_DATA, assetDir: buildDir(opts.workspace, opts.asset), mode: "local", revision: sourceRevision().revision });
  const mounts: [string, string][] = [
    ["/asset/", buildDir(opts.workspace, opts.asset)],
    ...(opts.photos ? [["/_photos/", opts.photos] as [string, string]] : [["/private/", join(ROOT, "private")] as [string, string]]),
    ["/work/", join(ROOT, "work")],
    ["/wiki/", join(ROOT, "dist", "wiki")],
    ["/_tools/", join(ROOT, "tools", "pages")],
  ];
  const masked = opts.photos && existsSync(join(ROOT, "private", "evidence", "cameras.json")) ? JSON.stringify(maskedCameras(opts.photos).json) : null;
  const server = Bun.serve({
    port: opts.port ?? 4173,
    hostname: "127.0.0.1",
    idleTimeout: LIMITS.idleTimeoutS,          // above the live channel's heartbeat (Bun's default of 10 s would end a quiet stream)
    async fetch(req, srv) {
      // only pages of this machine, for every path: a web page that rebinds its name to 127.0.0.1 must get
      // neither the API nor the unmasked photos under /private/ nor /work/ (R3b F12)
      if (!LOCAL_HOSTS.test(req.headers.get("host") ?? "")) return new Response("this server answers only to 127.0.0.1 and localhost", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
      const answer = api && (await api.fetch(req, srv.requestIP(req)?.address ?? ""));
      if (answer) return answer;
      let path = decodeURIComponent(new URL(req.url).pathname);
      opts.requests?.push(path);
      if (path.endsWith("/")) path += "index.html";
      // the viewer looks for the live channel only when version.json says there is a server (no failed request otherwise)
      if (path === "/version.json") return Response.json({ ...currentVersion({ buildDir: buildDir(opts.workspace, opts.asset), asset: opts.asset, label: "working copy" }), ...(api ? { server: { format: SCENE_FORMAT } } : {}) }, { headers: { "cache-control": "no-store" } });
      if (opts.photos && path === CAMERAS) return masked ? new Response(masked, { headers: { "content-type": "application/json", "cache-control": "no-store" } }) : new Response("not found", { status: 404 });
      // On a machine without the private camera file (a CI runner, a fresh clone) answer with an empty set
      // instead of a 404, which the viewer would log as a console error and the check would count.
      if (path === CAMERAS && !existsSync(join(ROOT, "private", "evidence", "cameras.json"))) return Response.json({ cameras: {}, note: "no private camera file on this machine" }, { headers: { "cache-control": "no-store" } });
      if (path === "/index.html" && viewerSourceTime() > bundle.builtFrom) {
        try { bundle = await bundleViewer(); console.log(`viewer rebundled in ${bundle.seconds.toFixed(2)} s`); }
        catch (e: any) { return new Response(String(e.message), { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }); }
      }
      const own = bundle.files[path.slice(1)];
      // the dev marker lets the viewer look for private/evidence/cameras.json; the deployed page never asks for it
      if (own && path === "/index.html") return new Response(own.body.replace("</head>", '<meta name="rigtwin-dev" content="1">\n</head>'), { headers: { "content-type": own.type, "cache-control": "no-store" } });
      if (own) return new Response(own.body, { headers: { "content-type": own.type, "cache-control": "no-store" } });
      for (const [prefix, dir] of mounts) {
        if (!path.startsWith(prefix)) continue;
        const file = normalize(join(dir, path.slice(prefix.length)));
        if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) break;
        return new Response(Bun.file(file), { headers: { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    port: server.port as number, url: `http://127.0.0.1:${server.port}`, api,
    reset: () => api?.reset(),
    stop(force = true) { api?.close(); server.stop(force); if (temp) rmSync(temp, { recursive: true, force: true }); },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  if (opt("--viewer")) process.env.RIGTWIN_VIEWER_DIR = opt("--viewer");   // viewer source directory (default "viewer")
  const data = args.includes("--no-api") ? false : opt("--data") ? resolve(opt("--data")!) : DEFAULT_DATA;
  const server = await startServer({ port: Number(opt("--port") ?? 4173), workspace: opt("--workspace") ?? process.env.RIGTWIN_WORKSPACE, data });
  console.log(`viewer: http://127.0.0.1:${server.port}/   (asset from ${buildDir(opt("--workspace") ?? process.env.RIGTWIN_WORKSPACE)})`);
  console.log(data === false ? "no shared scene (--no-api)" : `shared scene: ${join(data, "playground", "doc.json")}; bun run rig talks to it`);
}
