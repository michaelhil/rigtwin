// Local, persistent room editor. Its SQLite store is independent of the single-station installation.
import { mkdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { loadRoomLibrary } from "../server/room-library.ts";
import { createRoomApi } from "../server/room-api.ts";
import { LOCAL_HOSTS } from "../server/server.ts";
import { runtimeParams } from "./bundle.ts";
import { ROOT } from "./timeline.ts";

export async function serveRoom({ port, dataDir }: { port: number; dataDir: string }) {
  mkdirSync(dataDir, { recursive: true });
  const viewRoot = join(ROOT, "viewer");
  const [library, bundle] = await Promise.all([
    loadRoomLibrary(join(dataDir, "build")),
    Bun.build({ entrypoints: [join(viewRoot, "src", "room-entry.ts")], target: "browser", format: "esm", splitting: true, minify: true,
      naming: { entry: "room-entry.[ext]", chunk: "room-[hash].[ext]" }, plugins: [runtimeParams] }),
  ]);
  if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
  const api = createRoomApi({ dataDir, catalog: library.catalog });
  const scripts = new Map(bundle.outputs.map(o => ["/" + basename(o.path), o]));
  const html = Bun.file(join(viewRoot, "room.html"));
  const staticFiles = new Map([
    ["/room.css", join(viewRoot, "room.css")], ["/room-view.css", join(viewRoot, "room-view.css")],
    ["/llms.txt", join(viewRoot, "room-guide.txt")],
    ...["basis_transcoder.wasm","basis_transcoder.js"].map(f => ["/libs/basis/" + f, join(ROOT, "node_modules", "three", "examples", "jsm", "libs", "basis", f)] as [string,string]),
  ]);
  const mime: Record<string,string> = { ".glb": "model/gltf-binary", ".json": "application/json", ".ktx2": "image/ktx2", ".png": "image/png", ".jpg":"image/jpeg" };
  const server = Bun.serve({ port, development: false, hostname: "127.0.0.1", idleTimeout: 0,
    async fetch(request) {
      const { pathname, origin } = new URL(request.url);
      if (!LOCAL_HOSTS.test(request.headers.get("host") ?? "") || (request.headers.has("origin") && request.headers.get("origin") !== origin)) return new Response("Local access only", { status: 403 });
      if (pathname.startsWith("/api/") || pathname === "/mcp") return api.fetch(request);
      if (!["GET","HEAD"].includes(request.method)) return new Response(null, { status: 405 });
      if (pathname === "/" || /^\/workspaces\/?(?:[^/]+\/?)?$/.test(pathname)) {
        return new Response(html, { headers: { "Link": '</llms.txt>; rel="help", </api/commands>; rel="service-desc"', "Cache-Control": "no-cache" } });
      }
      const script = scripts.get(pathname), path = staticFiles.get(pathname);
      if (script) return new Response(script, { headers: { "Content-Type":"text/javascript", "Cache-Control":"no-cache" } });
      if (path) return new Response(Bun.file(path));
      const bytes = library.files.get(pathname);
      if (bytes) return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime[extname(pathname)] ?? "application/octet-stream", "Cache-Control": "public,max-age=31536000,immutable" } });
      return new Response("Not found", { status: 404 });
    },
  });
  return { url: server.url, close() { server.stop(true); api.close(); } };
}

if (import.meta.main) {
  const flag = (key: string) => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index+1] : undefined; };
  const dataDir = resolve(flag("--data") ?? join(ROOT, "work", "room-layout"));
  const service = await serveRoom({ port: Number(flag("--port") ?? 4173), dataDir });
  console.log("Room editor", service.url.href, "· data", dataDir);
  for (const signal of ["SIGINT","SIGTERM"]) process.once(signal, () => { service.close(); process.exit(0); });
}
