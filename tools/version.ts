// What is being published: build time, source revision and the model's identity. `bun run dist` writes
// this as dist/version.json; the viewer shows `short` in its More menu, the wiki shows it in its footer,
// and `bun run deploy` compares the live file with the one it just built.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./timeline.ts";

export interface Version {
  name: string;
  /** ISO time (UTC, whole seconds) at which the distribution was assembled */
  built: string;
  /** short source revision, or "uncommitted" when the folder is not a git repository */
  revision: string;
  /** true when the working tree had changes that are not in `revision` */
  dirty: boolean;
  model: { asset: string; sha256: string; triangles: number; bytes: number } | null;
  /** one line for people: date, revision, start of the model hash */
  short: string;
}

const git = (...args: string[]) => { const r = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };

/** Source revision of the working folder. Without a repository: "uncommitted". */
export function sourceRevision(): { revision: string; dirty: boolean; repository: boolean } {
  if (!existsSync(join(ROOT, ".git"))) return { revision: "uncommitted", dirty: false, repository: false };
  const rev = git("rev-parse", "--short", "HEAD");
  if (!rev) return { revision: "uncommitted", dirty: true, repository: true };   // a repository without a first commit
  return { revision: rev, dirty: (git("status", "--porcelain") ?? "") !== "", repository: true };
}

export function currentVersion(opts: { buildDir?: string; asset?: string; built?: Date; label?: string } = {}): Version {
  const asset = opts.asset ?? "rig-b", dir = opts.buildDir ?? join(ROOT, "assets", asset, "build");
  const { revision, dirty } = sourceRevision();
  let model: Version["model"] = null;
  try { const m = JSON.parse(readFileSync(join(dir, `${asset}.manifest.json`), "utf8")); model = { asset, sha256: m.glb.sha256, triangles: m.totals.triangles, bytes: m.glb.bytes }; } catch { /* no build yet */ }
  const built = (opts.built ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z");
  const rev = revision + (dirty ? "+changes" : "");
  const short = [opts.label ?? `${built.slice(0, 10)} ${built.slice(11, 16)} UTC`, rev, ...(model ? [`model ${model.sha256.slice(0, 8)}`] : [])].join(" · ");
  return { name: "rigtwin", built, revision, dirty, model, short };
}
