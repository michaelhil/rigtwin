// The local installation publishes exact asset releases. The same bytes supply the viewer, the
// numeric command solver and the digest. A changed dependency produces a different release pin.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { build } from "../generator/build.ts";
import { ROOT } from "../tools/timeline.ts";
import { createRoomLibrary, releaseInventory } from "./room-installed.ts";

const editions = [
  { asset: "rig-b", version: "1", kind: "station" },
  { asset: "floor-display", version: "1", kind: "display", variant: "freestanding" },
  { asset: "floor-display", version: "2", kind: "display", variant: "freestanding", paramsDir: "releases/2/params" },
  { asset: "wall-display", version: "1", kind: "display", variant: "wall" },
  { asset: "wall-display", version: "2", kind: "display", variant: "wall", paramsDir: "releases/2/params", specDir: "releases/2/spec" },
  { asset: "operator-desk", version: "1", kind: "desk" },
] as const;

function collect(dir: string, prefix: string, files: Map<string, Buffer>) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const name = prefix + item.name, path = join(dir, item.name);
    if (item.isDirectory()) collect(path, name + "/", files);
    else if (item.isFile()) files.set(name, readFileSync(path));
  }
}

/** Builds the current editions from source and keeps every earlier build in <data>/library-archive, so a scene
 *  pinned to an earlier build still opens after an asset changed. Earlier builds are marked retained. */
export async function loadRoomLibrary(buildDir: string) {
  const library = createRoomLibrary();
  const manikin = join(ROOT, "assets", "manikin");
  const archive = join(dirname(buildDir), "library-archive"), current = new Set<string>();
  mkdirSync(archive, { recursive: true });
  const keep = (id: string, digest: string, payload: Map<string, Buffer>) => {
    if (existsSync(join(archive, digest))) return;
    const stage = mkdtempSync(join(archive, ".stage-"));
    try {
      for (const [file, bytes] of payload) { mkdirSync(dirname(join(stage, file)), { recursive: true }); writeFileSync(join(stage, file), bytes); }
      writeFileSync(join(stage, ".pin"), id);
      renameSync(stage, join(archive, digest));
    } finally { rmSync(stage, { recursive: true, force: true }); }
  };
  // The build left by the previous start may be what saved scenes are pinned to: keep it before rebuilding.
  for (const edition of editions) {
    const { asset, version, kind } = edition, name = asset + "@" + version, dir = join(buildDir, name);
    const glb = join(dir, asset + ".glb"), manifest = join(dir, asset + ".manifest.json");
    if (!existsSync(glb) || !existsSync(manifest)) continue;
    const payload = new Map([["model.glb", readFileSync(glb)], ["manifest.json", readFileSync(manifest)]]);
    if (kind === "station") collect(manikin, "manikin/", payload);
    const { digest } = releaseInventory(payload);
    keep(name + "#" + digest, digest, payload);
  }
  for (const edition of editions) {
    const { asset, version, kind } = edition, name = asset + "@" + version;
    const paramsDir = "paramsDir" in edition ? join(ROOT, "assets", asset, edition.paramsDir) : undefined;
    const specDir = "specDir" in edition ? join(ROOT, "assets", asset, edition.specDir) : undefined;
    const built = await build({ asset, paramsDir, specDir, outDir: join(buildDir, name), quiet: true });
    if (!built.ok) throw new Error(name + ": " + built.messages.join("\n"));
    const payload = new Map([["model.glb", readFileSync(built.glbPath)], ["manifest.json", readFileSync(built.manifestPath)]]);
    if (kind === "station") collect(manikin, "manikin/", payload);
    const { digest } = releaseInventory(payload), id = name + "#" + digest;
    library.install(id, payload);
    current.add(id);
    keep(id, digest, payload);
  }
  for (const digest of readdirSync(archive)) {
    if (!/^[0-9a-f]{64}$/.test(digest) || !existsSync(join(archive, digest, ".pin"))) continue;
    const id = readFileSync(join(archive, digest, ".pin"), "utf8");
    if (current.has(id) || !id.endsWith("#" + digest)) continue;
    const payload = new Map<string, Buffer>();
    collect(join(archive, digest), "", payload);
    payload.delete(".pin");
    library.install(id, payload);
  }
  for (const item of library.catalog.releases) if (!current.has(item.id)) item.retained = true;
  return library;
}
