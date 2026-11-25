// Bundles the TypeScript viewer (viewer/src/main.ts + shared/ + three from node_modules) into one
// browser module. Used in memory by the dev server and the render driver (rebuilt automatically when a
// source file changed) and written to disk by `bun run dist`. Takes about a tenth of a second.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { BunPlugin } from "bun";
import { validateRuntime, stripRuntime } from "../shared/runtime-params.ts";
import { ROOT } from "./timeline.ts";

/** Viewer source directory, relative to the repository root: "viewer" unless SYNERGON_VIEWER_DIR (or `--viewer <dir>` of serve / render) names another one. */
export const viewerDir = () => join(ROOT, process.env.SYNERGON_VIEWER_DIR || "viewer");
const watch = () => { const VIEWER = viewerDir(); return [join(VIEWER, "src"), join(ROOT, "shared"), join(VIEWER, "index.html"), join(VIEWER, "viewer.css"), ...(existsSync(join(ROOT, "assets", "manikin", "params")) ? [join(ROOT, "assets", "manikin", "params")] : [])]; };

function newest(path: string): number {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((f) => newest(join(path, f))));
}
/** Latest modification time of anything the bundle depends on. */
export const viewerSourceTime = () => Math.max(...watch().map(newest));

export interface ViewerBundle { files: Record<string, { body: string; type: string }>; seconds: number; builtFrom: number }

/** Build the static viewer: index.html, viewer.css, viewer.js. Throws with the bundler's messages on error. */
/** The person's run-time numbers (assets/manikin/params/runtime*.toml) enter the bundle as their values only; a file with an
 *  incomplete record stops the bundle (shared/runtime-params.ts). Other TOML files are left to Bun. */
const runtimeParams: BunPlugin = { name: "runtime-params", setup(b) {
  b.onLoad({ filter: /[\\/]assets[\\/]manikin[\\/]params[\\/]runtime[^\\/]*\.toml$/ }, async (args) => {
    const name = basename(args.path), doc = Bun.TOML.parse(await Bun.file(args.path).text()), errors = validateRuntime(doc, name);
    if (errors.length) throw new Error(`${name}: ${errors.length} incomplete record(s):\n  ${errors.slice(0, 20).join("\n  ")}`);
    return { contents: "export default " + JSON.stringify(stripRuntime(doc)) + ";", loader: "js" };
  });
} };

/** Build the static viewer: index.html, viewer.css, viewer.js (the page's entry), and the chunks it imports: the code the page
 *  shares with the person chunk, and the person chunk itself (viewer/src/person/, loaded only after the page is ready).
 *  Throws with the bundler's messages on error. */
export async function bundleViewer(): Promise<ViewerBundle> {
  const t0 = performance.now(), builtFrom = viewerSourceTime(), VIEWER = viewerDir();
  const res = await Bun.build({ entrypoints: [join(VIEWER, "src", "main.ts")], target: "browser", format: "esm", minify: true, sourcemap: "none", splitting: true,
    naming: { entry: "viewer.[ext]", chunk: "chunk-[hash].[ext]" }, plugins: [runtimeParams] });
  if (!res.success) throw new Error("viewer bundle failed:\n" + res.logs.map((l) => String(l)).join("\n"));
  const files: ViewerBundle["files"] = {
    "index.html": { body: readFileSync(join(VIEWER, "index.html"), "utf8"), type: "text/html; charset=utf-8" },
    "viewer.css": { body: readFileSync(join(VIEWER, "viewer.css"), "utf8"), type: "text/css; charset=utf-8" },
  };
  for (const o of res.outputs) files[basename(o.path)] = { body: await o.text(), type: "text/javascript; charset=utf-8" };
  if (!files["viewer.js"]) throw new Error("viewer bundle: no viewer.js among the outputs");
  return { files, seconds: (performance.now() - t0) / 1000, builtFrom };
}
/** Which of the bundle's scripts the page loads before it is ready (the entry and what it imports statically), and which only
 *  later (the person chunk and what only it imports). */
export function scriptParts(b: ViewerBundle): { initial: string[]; later: string[] } {
  const js = Object.keys(b.files).filter((f) => f.endsWith(".js")), imports = (f: string) => [...b.files[f].body.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)].map((m) => m[1]);
  const initial = new Set<string>(["viewer.js"]); let grew = true;
  while (grew) { grew = false; for (const f of [...initial]) for (const g of imports(f)) if (!initial.has(g) && b.files[g]) { initial.add(g); grew = true; } }
  return { initial: [...initial], later: js.filter((f) => !initial.has(f)) };
}
