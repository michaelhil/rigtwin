// Build the public room release from the built-in asset editions and public screening guide.
// The local room service, its data directory and project stores are never opened by this build.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { loadRoomLibrary } from "../server/room-library.ts";
import { ROOM_SCHEMA } from "../shared/room.ts";
import { runtimeParams } from "./bundle.ts";
import { publicRoomHtml, publicRoomGuide } from "./room-routes.ts";
import { ROOT } from "./timeline.ts";

export async function buildRoomRelease(out: string, stationHtml: string, stationGuide: string) {
  const view = join(ROOT, "viewer");
  const bundle = await Bun.build({
    entrypoints: [join(view, "src", "room-app.ts")], target: "browser", format: "esm", splitting: true, minify: true,
    naming: { entry: "room-entry.[ext]", chunk: "room-[hash].[ext]" }, plugins: [runtimeParams],
  });
  if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
  for (const file of bundle.outputs) writeFileSync(join(out, basename(file.path)), new Uint8Array(await file.arrayBuffer()));
  for (const file of ["release-entry.js", "room.css", "room-view.css"]) copyFileSync(join(view, file), join(out, file));
  // The homepage's own small script and its story pictures.
  const home = await Bun.build({ entrypoints: [join(view, "src", "home.ts")], target: "browser", format: "esm", minify: true, naming: { entry: "home.[ext]" } });
  if (!home.success) throw new Error(home.logs.map(String).join("\n"));
  writeFileSync(join(out, "home.js"), new Uint8Array(await home.outputs[0].arrayBuffer()));
  mkdirSync(join(out, "home"), { recursive: true });
  for (const file of readdirSync(join(view, "home"))) if (file.endsWith(".jpg")) copyFileSync(join(view, "home", file), join(out, "home", file));
  // A tag from the bytes of every page script and stylesheet: a new release gets new addresses, so browsers
  // that cached the previous scripts (they are not marked no-cache) load the new ones.
  const tagged = ["release-entry.js", "room-entry.js", "home.js", "room.css", "room-view.css", "app.js"].filter(f => existsSync(join(out, f)));
  const tag = createHash("sha256").update(tagged.map(f => readFileSync(join(out, f))).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))).digest("hex").slice(0, 12);
  const roomHtml = publicRoomHtml(readFileSync(join(view, "room.html"), "utf8")).replace('src="/room-entry.js"', 'src="/release-entry.js?v=' + tag + '"');
  writeFileSync(join(out, "index.html"), roomHtml);
  writeFileSync(join(out, "llms.txt"), publicRoomGuide(readFileSync(join(view, "room-guide.txt"), "utf8")));
  writeFileSync(join(out, "station.html"), stationHtml.replaceAll('href="/llms.txt"', 'href="/station-guide.txt"'));
  writeFileSync(join(out, "station-guide.txt"), stationGuide);
  const guide = "workstation-screening.md", source = join(ROOT, "wiki", "85-standards", guide);
  for (const folder of ["standards", "server/standards"]) {
    mkdirSync(join(out, folder), { recursive: true });
    copyFileSync(source, join(out, folder, guide));
  }
  const tmp = mkdtempSync(join(tmpdir(), "synergon-room-assets-"));
  try {
    const { catalog, files } = await loadRoomLibrary(tmp);
    const pins = catalog.releases.map(({ id, digest }) => ({ id, digest }));
    const station = catalog.releases.find(r => r.kind === "station");
    if (!station) throw new Error("No built-in station edition for the public release");
    for (const { id } of pins) if (!catalog.transfer?.describe(id).redistributable)
      throw new Error("The public release requires a redistributable edition: " + id);
    const manikin = "/library/" + station.digest + "/manikin/";
    for (const [url, bytes] of files) {
      const dest = join(out, url);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      // Keep the original public station asset URLs backed by the same package bytes.
      if (url.startsWith(manikin)) {
        const old = join(out, "asset", "manikin", url.slice(manikin.length));
        mkdirSync(dirname(old), { recursive: true });
        writeFileSync(old, bytes);
      }
    }
    writeFileSync(join(out, "server", "room-catalog.json"), JSON.stringify(pins));
    return { format: ROOM_SCHEMA, releases: pins };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Exercise writes only on the fresh loopback installation started by tools/dist.ts. */
export async function verifyDisposableRoom(origin: string, room: Awaited<ReturnType<typeof buildRoomRelease>>) {
  if (new URL(origin).hostname !== "127.0.0.1") throw new Error("The writable room smoke test requires a loopback preview");
  const endpoint = origin + "/api/room/", headers = { "x-synergon": "1", "content-type": "application/json", origin, "x-synergon-probe": "1" };
  async function call(path: string, payload?: unknown) {
    const response = await fetch(endpoint + path, { headers, ...(payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) }) });
    if (!response.ok) throw new Error("room smoke: " + path + " HTTP " + response.status + " " + (await response.text()).slice(0, 400));
    return response.json();
  }
  const created = await call("workspaces", { name: "Release check (temporary)", template: "demo" });
  const workspace = "workspaces/" + created.id;
  const apply = (id: string, args = {}) => call(workspace + "/command", { id, args });
  const moved = await apply("room.set", { width: 9 });
  const saved = await call(workspace + "/state");
  if (!moved.ok || saved.version !== 1 || saved.room.width !== 9) throw new Error("public room edit was not persisted");
  const profile = await apply("assessment.profiles");
  if (!profile.ok || !profile.result.profiles?.length || profile.result.profiles.some((p: {id:string}) => p.id === "customer-layout"))
    throw new Error("public room assessment profile directory failed or exposed customer profile");
  const assessment = await apply("assessment.run");
  if (!assessment.ok) throw new Error("public assessment failed: " + JSON.stringify(assessment.error));
  const customer = await apply("assessment.configure", { profile: "customer-layout" });
  if (customer.ok || customer.error?.code !== "local_only") throw new Error("public server accepted a private customer profile");
  const project = await fetch(endpoint + "projects", { headers });
  if (![403, 404].includes(project.status)) throw new Error("local project directory available from public API");
  const commands = await call("commands");
  if (commands.commands.some((c: {id:string})=> c.id.startsWith("project."))) throw new Error("private project commands published");
  const { releases } = await call("catalog");
  if (!room.releases.every(pin => releases.some((r: {id:string}) => r.id === pin.id))) throw new Error("public catalog pin mismatch");
  const catalogFile = await fetch(origin + "/server/room-catalog.json", { headers, redirect: "manual" });
  if (catalogFile.status !== 404) throw new Error("server catalog file is downloadable");
  for (const file of ["standards/workstation-screening.md", "wiki/85-standards/workstation-screening.html"]) {
    if (!(await fetch(origin + "/" + file)).ok) throw new Error("missing screening source " + file);
  }
}
