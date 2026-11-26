import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "../shared/manifest.ts";
import { loadRoomLibrary } from "./room-library.ts";
import { newRoom, roomCommand } from "./room-model.ts";

const dir = mkdtempSync(join(tmpdir(), "synergon-installed-room-"));
let library: Awaited<ReturnType<typeof loadRoomLibrary>>;
beforeAll(async () => { library = await loadRoomLibrary(dir); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("actual release bytes reproduce all pins, with distinct screen heights and explicit floor anchors", () => {
  for (const release of library.catalog.releases) {
    const inventory = library.files.get(release.modelUrl.replace(/model.glb$/, "inventory.json"))!;
    expect(createHash("sha256").update(inventory).digest("hex")).toBe(release.digest);
    const files = JSON.parse(inventory.toString()) as { path:string; sha256:string }[];
    for (const file of files) {
      const bytes = library.files.get(release.modelUrl.replace(/model.glb$/, file.path))!;
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }
    if (release.seat) expect(files.some(f => f.path.endsWith("operator-m.avatar.json"))).toBe(true);
  }
  const [a,b] = library.catalog.releases.filter(r => r.asset === "floor-display");
  const at = (id:string) => library.catalog.point({id:"device",label:"Screen",release:id,x:0,y:0,yaw:0,pose:{}}, "D_screen_center");
  expect(a.digest).not.toBe(b.digest);
  expect(at(b.id)[2] - at(a.id)[2]).toBeCloseTo(0.1, 6);
  expect(b.footprint.max[1] - a.footprint.max[1]).toBeCloseTo(.145, 6);
});

test("installed station's off-axis grip and seated eye follow one host through 90 degrees", () => {
  const catalog = library.catalog, release = catalog.releases.find(r=>r.seat)!;
  const manifest: Manifest = JSON.parse(library.files.get(release.manifestUrl)!.toString());
  const grip = manifest.datums.find(d=>d.id === "D_grip_R")!.origin;
  const record = newRoom("geometry", "Explicit placement", catalog, "demo");
  const execute = (id:string,args:object) => {
    const reply = roomCommand(record,catalog,{id,args});
    Object.assign(record,reply.record); return reply.result as any;
  };
  const floor = (instance:string) => ({instance,member:"floor"});
  const a = "station-a", b = "station-b", screen = {instance:a,member:"S_mon_screen"};
  execute("instances.move",{instance:a,x:0,y:0,yaw:0});
  execute("instances.move",{instance:b,x:3,y:4,yaw:0});
  expect(execute("measure.distance",{from:floor(a),to:floor(b)}).metres).toBeCloseTo(5,10);
  execute("person.set",{host:a,aims:{look:"S_mon_screen",right_hand:{mode:"touch",target:"D_grip_R"}}});
  const before = execute("person.measure",{to:screen}).metres;
  expect(before).toBeGreaterThan(.1);
  execute("instances.move",{instance:a,x:2,y:3,yaw:90});
  const after = execute("person.measure",{to:screen}).metres;
  expect(after).toBeCloseTo(before,10);
  const p = execute("measure.distance",{from:floor(b),to:{instance:a,member:"D_grip_R"}}).to.point;
  const expected = [2-grip[1]+release.anchor[1],3+grip[0]-release.anchor[0],grip[2]-release.anchor[2]];
  expected.forEach((v,k)=>expect(p[k]).toBeCloseTo(v,5));
  const independentPose = structuredClone(record.scene.instances.find(i=>i.id === b)!.pose);
  execute("pose.set",{instance:a,member:"J_mon_height",value:.045});
  expect(record.scene.instances.find(i=>i.id === b)?.pose).toEqual(independentPose);
});

test("seat and monitor surfaces share the functional controls of their placement",()=>{
  const station=library.catalog.releases.find(r=>r.seat)!;
  const seat=station.members.find(m=>m.id==="C_seat_pan")!;
  expect(seat.controls).toContain("J_seat_slide");
  const monitor=station.members.find(m=>m.controls?.includes("J_mon_pan") && m.id.startsWith("S_"));
  expect(monitor?.controls).toContain("J_mon_tilt");
});
