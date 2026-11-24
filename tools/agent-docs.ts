// bun tools/agent-docs.ts [--check]
// Writes what agents read about the shared scene, generated from the command registry and the catalogue of adjustments
// (shared/commands/agent-docs.ts): .claude/skills/operating-rigtwin/reference.md and wiki/80-reference/agent-interface.md.
// --check writes nothing and exits 1 when a file is out of date (bun run check runs it).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./timeline.ts";
import { assetFromFiles } from "../shared/commands/core.ts";
import "../shared/commands/intent.ts";
import { reference, wikiPage } from "../shared/commands/agent-docs.ts";

const BUILD = join(ROOT, "assets", "rig-b", "build");
const asset = assetFromFiles(JSON.parse(readFileSync(join(BUILD, "rig-b.manifest.json"), "utf8")), new Uint8Array(readFileSync(join(BUILD, "rig-b.glb"))));
const files: [string, (old: string | null) => string][] = [
  [join(ROOT, ".claude", "skills", "operating-rigtwin", "reference.md"), () => reference(asset)],
  // the page keeps its date unless its content changes
  [join(ROOT, "wiki", "80-reference", "agent-interface.md"), (old) => {
    const page = wikiPage(asset, new Date().toISOString().slice(0, 10)), strip = (x: string) => x.replace(/^updated: \S+$/m, "");
    return old !== null && strip(old) === strip(page) ? old : page;
  }],
];
const check = process.argv.includes("--check");
const stale: string[] = [];
for (const [file, make] of files) {
  const old = existsSync(file) ? readFileSync(file, "utf8") : null, now = make(old);
  if (old === now) continue;
  stale.push(file.slice(ROOT.length + 1));
  if (!check) writeFileSync(file, now);
}
if (check) { console.log(stale.length ? `out of date: ${stale.join(", ")} (run bun tools/agent-docs.ts)` : "agent docs up to date"); process.exit(stale.length ? 1 : 0); }
console.log(stale.length ? `wrote ${stale.join(", ")}` : "agent docs already up to date");
