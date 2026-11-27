// Only descriptors shipped by dist can admit an edition to this archive. Each published
// public pin survives release pruning; private project packages never enter this directory.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RoomRelease } from "../shared/room.ts";
import { loadInstalledRoomLibrary } from "./room-installed.ts";

type Pin = Pick<RoomRelease, "id" | "digest">;
const pinFile = (id: string) => createHash("sha256").update(id).digest("hex") + ".json";

export function openPublicRoomLibrary(release: string, data: string) {
  const shipped: Pin[] = JSON.parse(readFileSync(join(release, "server", "room-catalog.json"), "utf8"));
  const archive = join(data, "public-library-v1"), receipts = join(archive, "pins");
  mkdirSync(receipts, { recursive: true, mode: 0o700 });
  for (const pin of shipped) {
    if (!/^[0-9a-f]{64}$/.test(pin.digest) || !pin.id.endsWith("#" + pin.digest)) throw new Error("Malformed public pin");
    const folder = join(archive, pin.digest), receipt = join(receipts, pinFile(pin.id));
    if (existsSync(receipt) && existsSync(folder)) continue;
    const verified = loadInstalledRoomLibrary([pin], join(release, "library"));
    if (!verified.catalog.transfer?.describe(pin.id).redistributable) throw new Error("Restricted public edition " + pin.id);
    const stage = mkdtempSync(join(archive, ".install-"));
    try {
      const staged = join(stage, "files");
      if (!existsSync(folder)) {
        for (const [url, bytes] of verified.files) {
          const path = join(staged, url.slice(("/library/" + pin.digest + "/").length));
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, bytes);
        }
        try { renameSync(staged, folder); }
        catch (e) { if (!existsSync(folder)) throw e; } // Another process published the same edition.
      }
      const stagedReceipt = join(stage, "pin.json");
      writeFileSync(stagedReceipt, JSON.stringify(pin));
      renameSync(stagedReceipt, receipt);
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  // New rooms pick from the current release first. Older rooms continue to resolve by exact pin.
  const pins = new Map(shipped.map(p => [p.id, p]));
  for (const name of readdirSync(receipts)) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const pin: Pin = JSON.parse(readFileSync(join(receipts, name), "utf8"));
    if (pinFile(pin.id) !== name) throw new Error("Invalid public edition receipt");
    pins.set(pin.id, pin);
  }
  const { catalog } = loadInstalledRoomLibrary([...pins.values()], archive, { retainPayload: false });
  for (const item of catalog.releases) if (!shipped.some(p => p.id === item.id)) item.retained = true;
  const files = new Map<string, string>();
  for (const item of catalog.releases) {
    const folder = join(archive, item.digest), url = "/api/library/" + item.digest + "/";
    const inventory = JSON.parse(readFileSync(join(folder, "inventory.json"), "utf8")) as {path: string}[];
    for (const name of ["inventory.json", ...inventory.map(f => f.path)]) files.set(url + name, join(folder, name));
    item.modelUrl = url + "model.glb";
    item.manifestUrl = url + "manifest.json";
  }
  return { catalog, files };
}
