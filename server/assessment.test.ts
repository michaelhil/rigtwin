import { expect,test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bindScene,evaluateFinding,initialSettings,type AssessmentAttachment,type Rule,type RunInputs } from "../shared/assessment.ts";
import type { RoomCatalog,RoomRelease,RoomScene } from "../shared/room.ts";
import { assessmentCommand,evaluate,parseAssessmentRules,validateAssessmentAttachment } from "./assessment.ts";
import { newRoom } from "./room-model.ts";

const entry=readFileSync(resolve(import.meta.dir,"../wiki/85-standards/workstation-screening.md"),"utf8");
const rules=parseAssessmentRules(entry),screen=rules.find(r=>r.measure==="eye-display")!;
function asset(asset:string,member:string,station:boolean):RoomRelease {
  const digest=(station?"a":"b").repeat(64);
  return {asset,id:asset+"@1#"+digest,label:asset,digest,version:"1",kind:station?"station":"display",seat:station,
    anchor:[0,0,0],footprint:{min:[-.1,-.1],max:[.1,.1]},members:[{id:member,label:"Screen"}],joints:[],modelUrl:"/model",manifestUrl:"/manifest"};
}
const station=asset("rig-b","S_mon_screen",true), display=asset("floor-display","D_screen_center",false);
const catalog:RoomCatalog={releases:[station,display],point:i=>i.release===station.id?[.6,0,1]:[0,0,1],eye:()=>[0,0,1]};
function fixture() {
  const {scene}=newRoom("22789024-3caa-409a-bccc-ea03966308f7","Test fixture",catalog);
  scene.instances=[{id:"station",label:"Station",release:station.id,x:2,y:2,yaw:0,pose:{}},
    {id:"detached",label:"Detached display",release:display.id,x:2.5,y:2,yaw:0,pose:{}}];
  scene.person={host:"station",state:{sex:"female",style:"clay",tone:"light",glasses:false,headset:false,preset:"Fixture",body:{},posture:"operating"}};
  const settings={...initialSettings,jurisdiction:"us-general-industry",task:"seated-display-reading",exitAccess:"yes"} as const;
  const inputs:RunInputs={scene,settings,rules,bindings:bindScene(scene,catalog),evidence:[],observation:""};
  return inputs;
}
test("independent synthetic 0.50 m minimum and desk-at-ankle counterexample",()=>{
  const inputs=fixture(), mounted=inputs.bindings[0],detached=inputs.bindings[1];
  const synthetic:Rule={...screen,id:"fixture.synthetic",minimum:.5,maximum:undefined};
  inputs.evidence=[{binding:mounted.id,basis:"independent",radius:.01,source:"Synthetic absolute-error fixture"},
    {binding:detached.id,basis:"independent",radius:.02,source:"Synthetic absolute-error fixture"}];
  const one=evaluateFinding(synthetic,mounted,inputs,catalog),two=evaluateFinding(synthetic,detached,inputs,catalog);
  expect(one.status).toBe("within limit");expect(one.nominal).toBeCloseTo(.6,12);expect(one.interval![0]).toBeCloseTo(.59,12);
  expect(two.status).toBe("open");expect(two.nominal).toBe(.5);expect(two.interval).toEqual([.48,.52]);
  expect(parseAssessmentRules.bind(null,entry.replace('measure = "eye-display"','measure = "desk-leg-width"'))).toThrow();
  const ankleBinding={...mounted,roles:{...mounted.roles,displayCentre:{instance:"station",member:"D_ankle"}}};
  expect(evaluateFinding(synthetic,ankleBinding,inputs,catalog).status).toBe("open");
  const door=rules.find(r=>r.id==="osha.exit-access-width")!;
  expect(evaluateFinding(door,{id:"desk-at-ankle",measure:"door-opening",roles:{threshold:{instance:"station",member:"ankle-gap"}}},inputs,catalog).status).toBe("open");
});
test("source checks, excluded tasks, unknowns, unsupported posture, missing roles and observations",()=>{
  const inputs=fixture(),binding=inputs.bindings[0];
  const result=()=>evaluateFinding(screen,binding,inputs,catalog);
  expect(result().nominal).toBeCloseTo(.6);expect(result().status).toBe("open");
  inputs.evidence=[{binding:binding.id,basis:"standard-default",radius:0,source:"Taken from the criterion itself"}];
  expect(result().reason).toContain("cannot independently verify");
  inputs.evidence=[{binding:binding.id,basis:"unbounded",radius:null,source:"Unverified eye offset"}];
  expect(result().status).toBe("open");
  inputs.settings.task="unknown";expect(result().reason).toContain("Confirm");
  inputs.settings.task="other";expect(result().status).toBe("excluded");
  inputs.settings.task="seated-display-reading";inputs.scene.person!.state.posture="RELAXED_STAND";
  expect(result().reason).toContain("operating posture");
  inputs.scene.person!.state.posture="operating";delete binding.roles.eye;expect(result().reason).toContain("Missing role: eye");
  const manual=rules.find(r=>r.measure==="observation")!;inputs.observation="South window reflected at noon.";
  expect(evaluateFinding(manual,inputs.bindings.at(-1)!,inputs,catalog)).toMatchObject({status:"manual",observation:inputs.observation});
  expect(()=>parseAssessmentRules(entry.replace('units = "m"','units = "cm"'))).toThrow();
  expect(()=>parseAssessmentRules(entry.replace('roles = ["eye", "displayCentre"]','roles = ["ankle"]'))).toThrow();
  expect(()=>parseAssessmentRules(entry.replace('## Display viewing distance','## Moved heading'))).toThrow();
});
test("unchanged criterion binds mounted and detached displays and customer edit only changes its own finding",()=>{
  const inputs=fixture();inputs.settings={...inputs.settings,profile:"customer-layout",customer:{minimum:1,reference:"Drawing brief R1"}};
  const a=evaluate(inputs,catalog);
  const screens=a.findings.filter(f=>f.criterion===screen.id);
  expect(screens.map(s=>[s.roles.eye.instance,s.roles.displayCentre.instance,s.roles.displayCentre.member])).toEqual([
    ["station","station","S_mon_screen"],["station","detached","D_screen_center"]]);
  expect(screens[0].source).toBe(screens[1].source);
  const customer=(r:typeof a)=>r.findings.find(f=>f.criterion==="project.doorway-width")!;
  expect(customer(a).status).toBe("within limit");
  inputs.settings.customer={minimum:1.3,reference:"Drawing brief R2"};
  const b=evaluate(inputs,catalog);expect(customer(b).status).toBe("outside limit");expect(customer(b).clause).toBe("Drawing brief R2");
  expect(a.findings.filter(f=>f.criterion!==customer(a).criterion)).toEqual(b.findings.filter(f=>f.criterion!==customer(b).criterion));
  expect(a.rulePin).not.toBe(b.rulePin);
  inputs.scene.instances[1].x=3.5;
  const c=evaluate(inputs,catalog);expect(c.findings[1].nominal).toBe(1.5);
  inputs.scene.instances[1].x=2.5;expect(evaluate(inputs,catalog)).toEqual(b);
});
test("immutable saved assessment replays without current rule file; transfer validates inputs, digest and exact pins",()=>{
  const {scene,settings}=fixture();
  let attachment:AssessmentAttachment|undefined;
  const store={read:()=>attachment,write:(a:AssessmentAttachment)=>{attachment=a;}};
  const command=(s:RoomScene,id:string,args={},options={})=>assessmentCommand(s,catalog,{id,args},store,options) as any;
  const info=command(scene,"assessment.profiles");expect(info.profiles.length).toBe(2);
  command(scene,"assessment.configure",{...settings,expectedSettingsPin:info.settingsPin});
  const saved=command(scene,"assessment.run",{saveName:"Baseline"});
  expect(validateAssessmentAttachment(attachment,[scene.id])).toEqual([display.id,station.id].sort());
  const foreign=structuredClone(attachment!);foreign.runs[0].inputs.scene.instances[0].x=0;
  expect(()=>validateAssessmentAttachment(foreign,[scene.id])).toThrow();
  const altered=structuredClone(scene);altered.instances=[];altered.person=null;altered.version++;
  expect(command(altered,"assessment.replay",{id:saved.saved.id},{standardsPath:"/absent"}).report).toEqual(saved.report);
  expect(()=>assessmentCommand(scene,{...catalog,releases:[display]},{id:"assessment.replay",args:{id:saved.saved.id}},store)).toThrow("exact release");
  expect(()=>command(scene,"assessment.configure",{customer:{minimum:.8,reference:"Internal"}},{publicMode:true})).toThrow("local");
  expect(command(scene,"assessment.profiles",{},{publicMode:true}).profiles.length).toBe(1);
  expect(()=>command(scene,"assessment.run",{},{standardsPath:"/absent"})).toThrow("standards entry");
});
