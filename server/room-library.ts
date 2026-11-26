// The local installation publishes exact asset releases. The same bytes supply the viewer, the
// numeric command solver and the digest. A changed dependency produces a different release pin.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "../generator/build.ts";
import { ROOT } from "../tools/timeline.ts";
import { assetFromFiles, labelOf } from "../shared/commands/core.ts";
import { seated } from "../shared/commands/person.ts";
import type { AssetInfo } from "../shared/commands/registry.ts";
import { worldFrames } from "../shared/kinematics.ts";
import type { Manifest } from "../shared/manifest.ts";
import type { RoomCatalog, RoomInstance, RoomPoint, RoomRelease } from "../shared/room.ts";
import { loadPeople } from "./server.ts";

const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const relative = (point: number[], anchor: RoomPoint): RoomPoint => [point[0] - anchor[0], point[1] - anchor[1], point[2] - anchor[2]];
const editions = [
  { asset: "rig-b", version: "1", kind: "station" },
  { asset: "floor-display", version: "1", kind: "display", variant: "freestanding" },
  { asset: "floor-display", version: "2", kind: "display", variant: "freestanding", paramsDir: "releases/2/params" },
  { asset: "wall-display", version: "1", kind: "display", variant: "wall" },
  { asset: "wall-display", version: "2", kind: "display", variant: "wall", paramsDir: "releases/2/params", specDir: "releases/2/spec" },
] as const;

function collect(dir: string, prefix: string, files: Map<string, Buffer>) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const name = prefix + item.name, path = join(dir, item.name);
    if (item.isDirectory()) collect(path, name + "/", files);
    else if (item.isFile()) files.set(name, readFileSync(path));
  }
}

export async function loadRoomLibrary(buildDir: string) {
  const files = new Map<string, Buffer>(), sources = new Map<string, { info: AssetInfo; release: RoomRelease }>();
  const manikin = join(ROOT, "assets", "manikin"), people = loadPeople(manikin);
  if (!people) throw new Error("Missing seated operator package in " + manikin);
  const releases: RoomRelease[] = [];
  for (const edition of editions) {
    const { asset, version, kind } = edition, name = asset + "@" + version;
    const paramsDir = "paramsDir" in edition ? join(ROOT, "assets", asset, edition.paramsDir) : undefined;
    const specDir = "specDir" in edition ? join(ROOT, "assets", asset, edition.specDir) : undefined;
    const built = await build({ asset, paramsDir, specDir, outDir: join(buildDir, name), quiet: true });
    if (!built.ok) throw new Error(name + ": " + built.messages.join("\n"));
    const manifest: Manifest = built.manifest, glb = readFileSync(built.glbPath);
    const payload = new Map([["model.glb", glb], ["manifest.json", readFileSync(built.manifestPath)]]);
    if (kind === "station") collect(manikin, "manikin/", payload);
    const inventory = [...payload].map(([path, bytes]) => ({ path, sha256: hash(bytes) })).sort((a, b) => a.path < b.path ? -1 : 1);
    const digest = hash(JSON.stringify(inventory)), base = "/library/" + digest + "/";
    for (const [path, bytes] of payload) files.set(base + path, bytes);
    files.set(base + "inventory.json", Buffer.from(JSON.stringify(inventory)));
    const info: AssetInfo = { ...assetFromFiles(manifest, glb), people: kind === "station" ? people : null };
    const anchor = manifest.datums.find(n => n.id === "D_floor")?.origin as RoomPoint | undefined;
    if (!anchor) throw new Error(name + " requires a declared floor anchor");
    const { min, max } = manifest.totals.bbox;
    const release: RoomRelease = { id: name + "#" + digest, label: manifest.title, kind, asset, version, digest,
      modelUrl: base + "model.glb", manifestUrl: base + "manifest.json", anchor, seat: kind === "station",
      ...("variant" in edition ? { variant: edition.variant } : {}),
      members: [...manifest.components, ...manifest.surfaces, ...manifest.datums, ...manifest.joints].map(item => ({
        id: item.id, label: kind === "station" ? labelOf(info, item.id) : ("label" in item ? item.label : item.id),
        kind: item.id.startsWith("D_") ? "datum" : item.id.startsWith("J_") ? "joint" : "part" })),
      joints: manifest.joints.map(({ id, type, lower, upper, neutral, locked }) => ({ id, label: labelOf(info,id), type, lower, upper, neutral, locked })),
      footprint: { min: [min[0]-anchor[0], min[1]-anchor[1]], max: [max[0]-anchor[0], max[1]-anchor[1]] },
    };
    releases.push(release);
    sources.set(release.id, { info, release });
  }
  const resolve = (instance: RoomInstance) => {
    const found = sources.get(instance.release);
    if (!found) throw new Error("Install the pinned release " + instance.release);
    return found;
  };
  const catalog: RoomCatalog = { releases, point(instance, member) {
    const { info, release } = resolve(instance), frame = worldFrames(info.nodes, instance.pose)[member];
    if (!frame) throw new Error("Unknown member " + member + " on " + instance.id);
    return relative(frame.t, release.anchor);
  }, defaultPerson(instance) {
    if (!resolve(instance).release.seat) throw new Error("This release has no seat");
    return structuredClone(people.defaultPerson);
  }, eye(instance, state) {
    const { info, release } = resolve(instance);
    return relative(seated(info, state, instance.pose).eyes.mid, release.anchor);
  } };
  return { catalog, files };
}
