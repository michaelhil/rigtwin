// Bundles the TypeScript viewer (viewer/src/main.ts + shared/ + three from node_modules) into one
// browser module. Used in memory by the dev server and the render driver (rebuilt automatically when a
// source file changed) and written to disk by `bun run dist`. Takes about a tenth of a second.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./timeline.ts";

/** Viewer source directory, relative to the repository root: "viewer" unless RIGTWIN_VIEWER_DIR (or `--viewer <dir>` of serve / render) names another one. */
export const viewerDir = () => join(ROOT, process.env.RIGTWIN_VIEWER_DIR || "viewer");
const watch = () => { const VIEWER = viewerDir(); return [join(VIEWER, "src"), join(ROOT, "shared"), join(VIEWER, "index.html"), join(VIEWER, "viewer.css")]; };

function newest(path: string): number {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((f) => newest(join(path, f))));
}
/** Latest modification time of anything the bundle depends on. */
export const viewerSourceTime = () => Math.max(...watch().map(newest));

export interface ViewerBundle { files: Record<string, { body: string; type: string }>; seconds: number; builtFrom: number }

/** Build the static viewer: index.html, viewer.css, viewer.js. Throws with the bundler's messages on error. */
export async function bundleViewer(): Promise<ViewerBundle> {
  const t0 = performance.now(), builtFrom = viewerSourceTime(), VIEWER = viewerDir();
  const res = await Bun.build({ entrypoints: [join(VIEWER, "src", "main.ts")], target: "browser", format: "esm", minify: true, sourcemap: "none" });
  if (!res.success) throw new Error("viewer bundle failed:\n" + res.logs.map((l) => String(l)).join("\n"));
  const js = await res.outputs[0].text();
  return {
    files: {
      "index.html": { body: readFileSync(join(VIEWER, "index.html"), "utf8"), type: "text/html; charset=utf-8" },
      "viewer.css": { body: readFileSync(join(VIEWER, "viewer.css"), "utf8"), type: "text/css; charset=utf-8" },
      "viewer.js": { body: js, type: "text/javascript; charset=utf-8" },
    },
    seconds: (performance.now() - t0) / 1000, builtFrom,
  };
}
