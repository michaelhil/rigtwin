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

test("scoped discovery reports the posed direction and footprint of just the chosen rig", () => {
  const catalog=library.catalog;
  let record=newRoom("discovery","Room",catalog,"demo");
  function call(id:string,args:object) {
    const reply=roomCommand(record,catalog,{id,args});
    record=reply.record;return reply.result as any;
  }
  const summary=call("discover",{});
  expect(summary.instances[0].placement).toEqual({x:2.65,y:3.6,yaw:90});
  expect(summary.instances[0].footprintRoom).toBeUndefined();
  const query={instance:"station-b",query:"J_seat_slide"};
  const original=call("discover",query).instances[0];
  expect(original.frame).toContain("X forward");
  expect(original.footprintRoom).toHaveLength(4);
  expect(original.joints[0].axis).toEqual([1,0,0]);
  expect(original.joints[0].axisRoom[1]).toBeCloseTo(1,8);
  call("instances.move",{instance:"station-b",yaw:35});
  call("pose.set",{instance:"station-b",member:"J_seat_swivel",value:.17,allowAssumed:true});
  const result=call("discover",query).instances[0], joint=result.joints[0];
  expect(result.footprintRoom).not.toEqual(original.footprintRoom);
  const endpoints={from:{instance:"station-b",member:"floor"},to:{instance:"station-b",member:"D_seat_front"}};
  const before=call("measure.distance",endpoints).to.point;
  call("pose.set",{instance:"station-b",member:"J_seat_slide",value:.02,allowAssumed:true});
  const after=call("measure.distance",endpoints).to.point;
  for(let k=0;k<3;k++) expect((after[k]-before[k])/.02).toBeCloseTo(joint.axisRoom[k],6);
  const edited=call("discover",query);
  expect(edited.instances[0].joints[0].value).toBe(.02);
  expect(edited.version).toBe(record.scene.version);
  expect(call("discover",{instance:"station-b",query:"C_seat_pan"}).instances[0].joints.map((j:any)=>j.id)).toContain("J_seat_slide");
  expect(call("discover",{instance:"station-a",query:"J_seat_slide"}).instances[0].joints[0].value).toBe(0);
});

test("the operator desk is a desk in the library and the demo room: placed clear, measurable from its eye reference, not assessed", async () => {
  const catalog=library.catalog, desk=catalog.releases.find(r=>r.asset==="operator-desk")!;
  expect(desk.kind).toBe("desk");
  expect(desk.seat).toBe(false);
  expect(desk.joints.find(j=>j.id==="J_desk_height")?.label).toBe("Desk: height");
  let record=newRoom("desk","Room",catalog,"demo");
  const call=(id:string,args:object)=>{ const reply=roomCommand(record,catalog,{id,args}); record=reply.record; return reply.result as any; };
  const placed=record.scene.instances.at(-1)!;
  expect(record.scene.instances).toHaveLength(5);
  expect(record.scene.instances[0].id).toBe("station-a");
  expect({id:placed.id,release:placed.release,x:placed.x,y:placed.y,yaw:placed.yaw}).toEqual({id:"desk-a",release:desk.id,x:6.9,y:1.4,yaw:0});
  // inside the room, the doorway fully open, no footprint of another object within half a metre
  const {footprint}=await import("../shared/room-geometry.ts");
  const boxes=record.scene.instances.map(i=>{ const v=footprint(i,catalog.releases.find(r=>r.id===i.release)!).vertices;
    return {id:i.id,min:[Math.min(...v.map(p=>p[0])),Math.min(...v.map(p=>p[1]))],max:[Math.max(...v.map(p=>p[0])),Math.max(...v.map(p=>p[1]))]}; });
  const own=boxes.find(b=>b.id==="desk-a")!, {width,depth}=record.scene.room;
  expect(own.min[0]).toBeGreaterThan(0); expect(own.min[1]).toBeGreaterThan(0); expect(own.max[0]).toBeLessThan(width); expect(own.max[1]).toBeLessThan(depth);
  for (const other of boxes.filter(b=>b.id!=="desk-a")) {
    const gap=Math.hypot(...[0,1].map(k=>Math.max(0,other.min[k]-own.max[k],own.min[k]-other.max[k])));
    expect(gap).toBeGreaterThan(.5);
  }
  const door=call("measure.clearance",{instance:"desk-a"});
  expect(door.opening.metres).toBeCloseTo(record.scene.room.door.width,9);
  expect(door.opening.blockers).toEqual([]);
  expect(door.metres).toBeGreaterThan(4);
  // every screen centre can be measured from the seated eye reference
  const eye={instance:"desk-a",member:"D_eye_seated"};
  for (const member of ["D_small_center_1","D_small_center_2","D_small_center_3","D_big_center_L","D_big_center_R","D_touch_center"]) {
    const metres=call("measure.distance",{from:eye,to:{instance:"desk-a",member}}).metres;
    expect(metres).toBeGreaterThan(.5); expect(metres).toBeLessThan(1.5);
  }
  expect(call("discover",{instance:"desk-a",query:"seated eye"}).instances[0].members.map((m:any)=>m.id)).toContain("D_eye_seated");
  // no operator of its own: nobody sits at it, its assumed height needs the caller's word, and the assessment says so
  expect(()=>call("person.set",{host:"desk-a"})).toThrow("no compatible seated operator");
  expect(()=>call("pose.set",{instance:"desk-a",member:"J_desk_height",value:.01})).toThrow("allowAssumed");
  const {assessmentCommand}=await import("./assessment.ts");
  const run=assessmentCommand(record.scene,catalog,{id:"assessment.run"},{read:()=>null,write(){}}) as any;
  expect(run.report.findings.some((f:any)=>f.binding.includes("desk-a"))).toBe(false);
  expect(run.report.unassessed.some((u:string)=>u.startsWith("Operator desk"))).toBe(true);
});
