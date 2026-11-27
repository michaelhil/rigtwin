// A deployed-mode restart using two disposable release folders and one data folder. The first release seeds the
// shared workspace; the second omits the edition that the seated operator's host is pinned to from its catalog and
// disk, as a later release that dropped it would. The scene, its pin, the archived bytes and the operator's eyes
// must survive, and the live-site checks of tools/deploy.ts must pass against the first release.
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFolder, type startBuiltServer } from "../dist.ts";
import { verifySite } from "../deploy.ts";
import type { RoomRelease } from "../../shared/room.ts";

export async function verifyRoomRestart(out: string, start: typeof startBuiltServer) {
  const tmp = mkdtempSync(join(tmpdir(), "room-release-restart-"));
  const data = join(tmp, "data"), next = join(tmp, "next");
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const settings = {data, mode:"deployed" as const};
    server = await start(out, settings);
    const version = JSON.parse(readFileSync(join(out, "version.json"), "utf8"));
    const proxy = serveFolder(out, "/", {api:server.origin});
    try {
      const checks = await verifySite({host:"loopback",publicUrl:proxy.origin + "/",remoteRoot:"/unused",keepReleases:5}, {
        version, glb:{path:"asset/" + version.model.asset + ".glb",bytes:version.model.bytes,sha256:version.model.sha256},wikiPages:["README.html"],
      });
      const failed = checks.filter(c=>c.required && !c.ok);
      if (failed.length) throw new Error(failed.map(c=>c.what + ": " + c.detail).join("; "));
    } finally {proxy.server.stop(true);}
    const read = async (path: string) => (await fetch(server!.origin + path)).json();
    const shared = (await read("/api/workspaces")).workspaces[0];
    const tree = await read("/api/workspaces/" + shared.id);
    const id: string = tree.projects.flatMap((p: {scenes:{id:string}[]}) => p.scenes)[0].id;
    const scene = await read("/api/scenes/" + id + "/state");
    const hosts: RoomRelease[] = (await read("/api/catalog")).releases;
    const pin = hosts.find(r => r.id === scene.instances.find((i: {id:string}) => i.id === scene.person.host).release)!;
    const eye = async () => {
      const result = await (await fetch(server!.origin + "/api/scenes/" + id + "/command", {
        method: "POST", headers: { "x-synergon":"1", "content-type":"application/json" },
        body: JSON.stringify({ id: "person.measure", args: { to: { instance:"wall-display", member:"floor" } } }),
      })).json();
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result.result.metres;
    };
    const before = await eye(), bytes = await (await fetch(server.origin + pin.modelUrl)).arrayBuffer();
    if (!pin.modelUrl.startsWith("/api/library/") || !Number.isFinite(before)) throw new Error("release lacks immutable public URLs or solved eyes");
    await server.stop(); server = undefined;
    // No server file or GLB is modified. The next release sees only the newly shipped catalog.
    mkdirSync(join(next, "server"), {recursive:true}); mkdirSync(join(next, "library"));
    for (const entry of readdirSync(out)) if (!["server", "library", "version.json"].includes(entry)) symlinkSync(join(out, entry), join(next, entry));
    const revision = version.revision + "-restart-check";
    writeFileSync(join(next, "version.json"), JSON.stringify({...version, revision}));
    copyFileSync(join(out, "server", "server.js"), join(next, "server", "server.js"));
    symlinkSync(join(out, "server", "standards"), join(next, "server", "standards"));
    const keep = hosts.filter(r=>r.id!==pin.id);
    writeFileSync(join(next, "server", "room-catalog.json"), JSON.stringify(keep.map(({id,digest})=>({id,digest}))));
    for (const r of keep) symlinkSync(join(out, "library", r.digest), join(next, "library", r.digest));
    server = await start(next, settings);
    if ((await read("/api/health")).revision !== revision) throw new Error("second server did not load the replacement release");
    const fresh = await read("/api/scenes/" + id + "/state"), again = await read("/api/workspaces/" + shared.id);
    const url = (await read("/api/catalog")).releases.find((r:RoomRelease)=>r.id===pin.id)?.modelUrl;
    if (url !== pin.modelUrl || JSON.stringify(fresh) !== JSON.stringify(scene) || JSON.stringify(again) !== JSON.stringify(tree) || before !== await eye())
      throw new Error("the shared workspace, its scene, the pinned release or the operator's eyes changed across restart");
    const response = await fetch(server.origin + url);
    if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(Buffer.from(bytes))) throw new Error("archived public asset did not retain its bytes");
  } finally { await server?.stop(); rmSync(tmp, {recursive:true, force:true}); }
}
