// Local, persistent room editor. Its SQLite store is independent of the single-station installation.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createRoomLibrary } from "../server/room-installed.ts";
import { PROJECT_BODY_BYTES } from "../shared/project.ts";
import { loadRoomLibrary } from "../server/room-library.ts";
import { createRoomApi } from "../server/room-api.ts";
import { LOCAL_HOSTS } from "../server/server.ts";
import { runtimeParams } from "./bundle.ts";
import { ROOT } from "./timeline.ts";

export async function serveRoom({ port, dataDir, emptyLibrary = false }: { port: number; dataDir: string; emptyLibrary?: boolean }) {
  mkdirSync(dataDir, { recursive: true });
  const viewRoot = join(ROOT, "viewer");
  const [library, bundle] = await Promise.all([
    emptyLibrary ? createRoomLibrary() : loadRoomLibrary(join(dataDir, "build")),
    Bun.build({ entrypoints: [join(viewRoot, "src", "room-entry.ts")], target: "browser", format: "esm", splitting: true, minify: true,
      naming: { entry: "room-entry.[ext]", chunk: "room-[hash].[ext]" }, plugins: [runtimeParams] }),
  ]);
  if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
  let wikiDirectory: string | undefined;
  const api = createRoomApi({ dataDir, catalog: library.catalog });
  const scripts = new Map(bundle.outputs.map(o => ["/" + basename(o.path), o]));
  const html = Bun.file(join(viewRoot, "room.html"));
  const staticFiles = new Map([
    ["/room.css", join(viewRoot, "room.css")], ["/room-view.css", join(viewRoot, "room-view.css")],
    ["/llms.txt", join(viewRoot, "room-guide.txt")],
    ["/standards/workstation-screening.md", join(ROOT, "wiki", "85-standards", "workstation-screening.md")],
    ...["basis_transcoder.wasm","basis_transcoder.js"].map(f => ["/libs/basis/" + f, join(ROOT, "node_modules", "three", "examples", "jsm", "libs", "basis", f)] as [string,string]),
  ]);
  const mime: Record<string,string> = { ".glb": "model/gltf-binary", ".json": "application/json", ".ktx2": "image/ktx2", ".png": "image/png", ".jpg":"image/jpeg" };
  const server = Bun.serve({ port, development: false, maxRequestBodySize: PROJECT_BODY_BYTES, hostname: "127.0.0.1", idleTimeout: 0,
    async fetch(request) {
      const { pathname, origin } = new URL(request.url);
      if (!LOCAL_HOSTS.test(request.headers.get("host") ?? "") || (request.headers.has("origin") && request.headers.get("origin") !== origin)) return new Response("Local access only", { status: 403 });
      if (pathname.startsWith("/api/") || pathname === "/mcp") return api.fetch(request);
      if (!["GET","HEAD"].includes(request.method)) return new Response(null, { status: 405 });
      if (pathname === "/" || /^\/(?:workspaces|projects)(?:\/[^/]+)?\/?$/.test(pathname)) {
        return new Response(html, { headers: { "Link": '</llms.txt>; rel="help", </api/commands>; rel="service-desc"', "Cache-Control": "no-cache" } });
      }
      if (pathname.startsWith("/wiki/")) {
        const relative = decodeURIComponent(pathname.slice(5)) || "index.html";
        if (!relative.split("/").every(p => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(p))) return new Response("Invalid page", {status:400});
        if (!wikiDirectory) {
          const {buildWiki} = await import("./wiki.ts");
          if (!wikiDirectory) {
            const root = join(ROOT,"work"); mkdirSync(root,{recursive:true});
            const folder = mkdtempSync(join(root,"room-wiki-"));
            try { buildWiki({out:folder}); wikiDirectory = folder; }
            catch (error) { rmSync(folder,{recursive:true,force:true}); throw error; }
          }
        }
        const page = Bun.file(join(wikiDirectory,relative));
        return await page.exists() ? new Response(page) : new Response("Page not found", {status:404});
      }
      const script = scripts.get(pathname), path = staticFiles.get(pathname);
      if (script) return new Response(script, { headers: { "Content-Type":"text/javascript", "Cache-Control":"no-cache" } });
      if (path) return new Response(Bun.file(path));
      const bytes = library.files.get(pathname);
      if (bytes) return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime[extname(pathname)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "public,max-age=31536000,immutable" } });
      return new Response("Not found", { status: 404 });
    },
  });
  return { url: server.url, close() { server.stop(true); api.close(); if (wikiDirectory) rmSync(wikiDirectory,{recursive:true,force:true}); } };
}

if (import.meta.main) {
  const flag = (key: string) => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index+1] : undefined; };
  const dataDir = resolve(flag("--data") ?? join(ROOT, "work", "room-layout"));
  const service = await serveRoom({ port: Number(flag("--port") ?? 4173), dataDir, emptyLibrary: process.argv.includes("--empty-library") });
  console.log("Room editor", service.url.href, "· data", dataDir);
  for (const signal of ["SIGINT","SIGTERM"]) process.once(signal, () => { service.close(); process.exit(0); });
}
