import { doorClearance } from "./room-geometry.ts";
import { roomPoint, type RoomCatalog, type RoomPoint, type RoomRef, type RoomScene } from "./room.ts";

export const EVALUATOR = "synergon-screening/1";
export const WIKI = "/wiki/85-standards/workstation-screening.html";
export const profiles = [
  {id:"us-workstation", title:"US workstation", purpose:"Screen a US general-industry workplace with seated display reading and designated exit access.", citation:WIKI},
  {id:"customer-layout", title:"Customer layout", purpose:"Apply an agreed project drawing requirement alongside applicable US checks.", citation:WIKI+"#customer-doorway-requirement"},
] as const;
export interface Settings {
  profile:"us-workstation"|"customer-layout"; jurisdiction:"us-general-industry"|"other"|"unknown";
  task:"seated-display-reading"|"other"|"unknown"; exitAccess:"yes"|"no"|"unknown";
  customer:{minimum:number;reference:string}|null;
}
export const initialSettings:Settings = {profile:"us-workstation",jurisdiction:"unknown",task:"unknown",exitAccess:"unknown",customer:null};
export interface Rule {
  id:string;title:string;edition:string;source:string;clause:string;anchor:string;interpretation:string;
  applies:"us-seated-reading"|"us-exit-access"|"customer-drawing";
  measure:"eye-display"|"door-opening"|"observation";roles:string[];units:"m"|"observation";
  minimum?:number;maximum?:number;limitFrom?:"customer.minimum";
}
export interface Binding {id:string; measure:Rule["measure"]; roles:Record<string,RoomRef>}
export interface Evidence {binding:string;basis:"independent"|"standard-default"|"unbounded";radius:number|null;source:string}
export type Status = "within limit"|"outside limit"|"open"|"excluded"|"manual";
export interface Finding {
  criterion:string; title:string; binding:string; status:Status; reason:string; citation:string;
  source:string; clause:string; edition:string; interpretation:string; roles:Record<string,RoomRef>;
  nominal:number|null; interval:[number,number]|null; limits:{minimum?:number;maximum?:number};
  points:[RoomPoint,RoomPoint]|null; edges:string[]; uncertainty:string; observation?:string;
}
export interface RunInputs {
  scene:RoomScene; settings:Settings; rules:Rule[];bindings:Binding[];evidence:Evidence[];observation:string;
}
export interface AssessmentReport {
  evaluator:string;sceneId:string;revision:number;profile:string;population:string|null;posture:string|null;
  geometryPins:string[];rulePin:string;bindingPin:string;inputsPin:string;findings:Finding[];unassessed:string[];
}
export interface SavedRun {id:string;name:string;savedAt:string;inputs:RunInputs;report:AssessmentReport;digest:string}
export interface AssessmentAttachment {schema:"synergon-assessment/1";settings:Settings;runs:SavedRun[]}
export interface ProfileInfo {
  profiles:ReadonlyArray<{id:string;title:string;purpose:string;citation:string}>;
  settings:Settings;settingsPin:string;rules:Rule[];saved:Array<{id:string;name:string;revision:number}>;
}

const displayMembers:Record<string,string> = {"rig-b":"S_mon_screen","floor-display":"D_screen_center","wall-display":"D_screen_center"};
export function bindScene(scene:RoomScene,catalog:RoomCatalog):Binding[] {
  const eye = scene.person ? {instance:scene.person.host,member:"eye"} : null;
  const bindings:Binding[] = [];
  for (const instance of scene.instances) {
    const release = catalog.releases.find(r=>r.id===instance.release);
    if (!release || !Object.hasOwn(displayMembers,release.asset)) continue;
    const roles:Record<string,RoomRef> = {displayCentre:{instance:instance.id,member:displayMembers[release.asset]}};
    if (eye) roles.eye=eye;
    bindings.push({id:"reading/"+instance.id,measure:"eye-display",roles});
  }
  if (!bindings.length) bindings.push({id:"reading/unbound",measure:"eye-display",roles:eye?{eye}:{}});
  bindings.push({id:"door/threshold",measure:"door-opening",roles:{threshold:{instance:"room",member:"door.threshold"}}});
  bindings.push({id:"observation/glare",measure:"observation",roles:{}});
  return bindings;
}

/** Both bounds are inclusive. An interval straddling a limit stays open. */
export function compareInterval([lo,hi]:[number,number],{minimum=-Infinity,maximum=Infinity}:{minimum?:number;maximum?:number}):Status {
  if (lo>=minimum && hi<=maximum) return "within limit";
  if (hi<minimum || lo>maximum) return "outside limit";
  return "open";
}

function applicability(rule:Rule,settings:Settings):[Status,string]|null {
  if (rule.applies==="customer-drawing") return settings.customer ? null : ["open","Supply the customer's agreed drawing minimum and source reference."];
  const facts = [
    [settings.jurisdiction,"us-general-industry","US general-industry jurisdiction"],
    rule.applies==="us-seated-reading" ? [settings.task,"seated-display-reading","seated display-reading task"] : [settings.exitAccess,"yes","exit-access designation"],
  ];
  const excluded = facts.find(([value,required])=>value!=="unknown" && value!==required);
  if (excluded) return ["excluded","Outside this criterion's scope: "+excluded[2]+"."];
  const unknown = facts.filter(([value])=>value==="unknown").map(([, ,label])=>label);
  return unknown.length ? ["open","Confirm "+unknown.join(" and ")+"."] : null;
}

function measureDoor(scene:RoomScene,catalog:RoomCatalog) {
  const first = scene.instances[0];
  if (first) {
    const {opening} = doorClearance(scene,first,catalog.releases);
    return {nominal:opening.metres,points:opening.points.map(([x,y])=>[x,y,0]) as [RoomPoint,RoomPoint],edges:opening.edges};
  }
  const {offset,width} = scene.room.door;
  return {nominal:width,points:[[offset,0,0],[offset+width,0,0]] as [RoomPoint,RoomPoint],edges:["door/west-jamb","door/east-jamb"]};
}
function measureDisplay(scene:RoomScene,catalog:RoomCatalog,roles:Binding["roles"]) {
  const host = scene.instances.find(i=>i.id===roles.eye?.instance), target = scene.instances.find(i=>i.id===roles.displayCentre?.instance);
  if (!host || !scene.person || scene.person.host!==host.id || roles.eye.member!=="eye" || !catalog.eye) return "Bind the eye of a seated operator.";
  if (scene.person.state.posture!=="operating") return "The eye solver supports the operating posture for this measurement.";
  const release = catalog.releases.find(r=>r.id===target?.release);
  if (!target || !release || displayMembers[release.asset]!==roles.displayCentre.member || !release.members.some(m=>m.id===roles.displayCentre.member)) return "Bind the active centre of a supported display surface.";
  const eye = roomPoint(host,catalog.eye(host,scene.person.state)), display = roomPoint(target,catalog.point(target,roles.displayCentre.member));
  if (![...eye,...display].every(Number.isFinite)) return "The geometry solver could not locate both roles.";
  return {nominal:Math.hypot(eye[0]-display[0],eye[1]-display[1],eye[2]-display[2]),points:[eye,display] as [RoomPoint,RoomPoint],edges:[]};
}

export function evaluateFinding(rule:Rule,binding:Binding,inputs:RunInputs,catalog:RoomCatalog):Finding {
  const {settings,scene}=inputs, local=rule.applies==="customer-drawing", customer=local ? settings.customer : null;
  const limits:Finding["limits"]={};
  if (customer) limits.minimum=customer.minimum;
  else if (rule.minimum!==undefined) limits.minimum=rule.minimum;
  if (rule.maximum!==undefined) limits.maximum=rule.maximum;
  const finding:Finding={criterion:rule.id,title:rule.title,binding:binding.id,status:"open",reason:"",
    citation:WIKI+"#"+rule.anchor,source:rule.source,clause:customer?.reference??rule.clause,edition:rule.edition,interpretation:rule.interpretation,
    roles:binding.roles,nominal:null,interval:null,limits,points:null,edges:[],uncertainty:""};
  const scope=applicability(rule,settings);
  if (scope) { [finding.status,finding.reason]=scope; return finding; }
  if (rule.measure==="observation") {
    finding.status="manual"; finding.reason=rule.interpretation;
    if (inputs.observation) finding.observation=inputs.observation;
    return finding;
  }
  const missing=rule.roles.filter(role=>!Object.hasOwn(binding.roles,role));
  if (missing.length) { finding.reason="Missing role: "+missing.join(", ")+"."; return finding; }
  if (rule.measure==="door-opening" && (binding.roles.threshold.instance!=="room" || binding.roles.threshold.member!=="door.threshold")) {
    finding.reason="Bind the threshold of this room."; return finding;
  }
  const geometry=rule.measure==="door-opening" ? measureDoor(scene,catalog) : measureDisplay(scene,catalog,binding.roles);
  if (typeof geometry==="string") { finding.reason=geometry; return finding; }
  Object.assign(finding,geometry);
  // The customer's requirement explicitly describes the mathematical drawing. Public checks require
  // independent bounds on the physical observation, including omitted geometry and model error.
  const evidence=inputs.evidence.find(e=>e.binding===binding.id);
  const radius=local ? 0 : evidence?.basis==="independent" ? evidence.radius : null;
  finding.uncertainty=local ? "Exact in the pinned drawing; projected footprints." :
    evidence ? evidence.source+" ("+evidence.basis+")" : "Total physical measurement error is unbounded.";
  if (radius==null) {
    finding.reason=evidence?.basis==="standard-default" ? "A standard-derived default cannot independently verify the criterion." :
      "Supply an independent bound covering the geometry, pose and site conditions used by this measurement.";
    return finding;
  }
  finding.interval=[Math.max(0,geometry.nominal-radius),geometry.nominal+radius];
  finding.status=compareInterval(finding.interval,limits);
  finding.reason=finding.status==="open" ? "The uncertainty interval crosses a criterion limit." :
    finding.status==="within limit" ? "The entire interval is inside the criterion limits." : "The entire interval lies outside the criterion limits.";
  return finding;
}
