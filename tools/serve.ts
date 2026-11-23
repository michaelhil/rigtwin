// bun run serve [--port 4173] [--workspace <name>] [--viewer <dir>]
// Static server for the viewer, laid out exactly like the deployed dist/:
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
import { join, normalize, extname } from "node:path";
import { existsSync, statSync, readFileSync } from "node:fs";
import { ROOT } from "./timeline.ts";
import { bundleViewer, viewerSourceTime, type ViewerBundle } from "./bundle.ts";
import { currentVersion } from "./version.ts";

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

export async function startServer(opts: { port?: number; workspace?: string; asset?: string; photos?: string; requests?: string[] } = {}) {
  let bundle: ViewerBundle = await bundleViewer();
  const mounts: [string, string][] = [
    ["/asset/", buildDir(opts.workspace, opts.asset)],
    ...(opts.photos ? [["/_photos/", opts.photos] as [string, string]] : [["/private/", join(ROOT, "private")] as [string, string]]),
    ["/work/", join(ROOT, "work")],
    ["/wiki/", join(ROOT, "dist", "wiki")],
    ["/_tools/", join(ROOT, "tools", "pages")],
  ];
  const masked = opts.photos && existsSync(join(ROOT, "private", "evidence", "cameras.json")) ? JSON.stringify(maskedCameras(opts.photos).json) : null;
  return Bun.serve({
    port: opts.port ?? 4173,
    hostname: "127.0.0.1",
    async fetch(req) {
      let path = decodeURIComponent(new URL(req.url).pathname);
      opts.requests?.push(path);
      if (path.endsWith("/")) path += "index.html";
      if (path === "/version.json") return Response.json(currentVersion({ buildDir: buildDir(opts.workspace, opts.asset), asset: opts.asset, label: "working copy" }), { headers: { "cache-control": "no-store" } });
      if (opts.photos && path === CAMERAS) return masked ? new Response(masked, { headers: { "content-type": "application/json", "cache-control": "no-store" } }) : new Response("not found", { status: 404 });
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
}

if (import.meta.main) {
  const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  if (opt("--viewer")) process.env.RIGTWIN_VIEWER_DIR = opt("--viewer");   // viewer source directory (default "viewer")
  const server = await startServer({ port: Number(opt("--port") ?? 4173), workspace: opt("--workspace") ?? process.env.RIGTWIN_WORKSPACE });
  console.log(`viewer: http://127.0.0.1:${server.port}/   (asset from ${buildDir(opt("--workspace") ?? process.env.RIGTWIN_WORKSPACE)})`);
}
