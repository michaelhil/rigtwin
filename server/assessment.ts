// Rule data is read only on an assessment request. Replay uses the saved rule data and scene.
import { createHash,randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assessmentCommands,evidenceSchema,settingsFields } from "../shared/assessment-commands.ts";
import { check, type Schema } from "../shared/commands/schema.ts";
import { bindScene,EVALUATOR,evaluateFinding,initialSettings,profiles,
  type AssessmentAttachment,type AssessmentReport,type Binding,type Evidence,type ProfileInfo,type Rule,type RunInputs,type SavedRun,type Settings } from "../shared/assessment.ts";
import type { RoomCatalog,RoomScene } from "../shared/room.ts";
import { fields as requireFields,sceneShape } from "./project-package.ts";
import { RoomError,validateInstance,type RoomWire } from "./room-model.ts";

const defaultsPath=resolve(import.meta.dir,"../wiki/85-standards/workstation-screening.md");
const object=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v);
const ensure=(condition:unknown,message:string):void=>{ if (!condition) throw new RoomError("invalid_assessment",message,"Check the assessment source or recover the original attachment."); };
const schemaObject=(properties:Record<string,Schema>,required=Object.keys(properties)):Schema=>({type:"object",properties,required,additionalProperties:false});
const text:Schema={type:"string",pattern:"\\S",maxLength:2048};
const id:Schema={type:"string",pattern:"^[a-z0-9][a-z0-9.-]*$",maxLength:100};
const settingsSchema=schemaObject(settingsFields);
const stringList:Schema={type:"array",items:text,maxItems:8};
const enumOf=(...values:string[]):Schema=>({type:"string",enum:values});
const numeric:Schema={type:"number",minimum:0,maximum:1000};
const fields={id,title:text,edition:text,source:text,clause:text,anchor:id,interpretation:text,applies:enumOf("us-seated-reading","us-exit-access","customer-drawing"),
  measure:enumOf("eye-display","door-opening","observation"),roles:stringList,units:enumOf("m","observation")};
const ruleSchema=schemaObject({...fields,minimum:numeric,maximum:numeric,limitFrom:enumOf("customer.minimum")},Object.keys(fields));
const expectedRoles={ "eye-display":["eye","displayCentre"],"door-opening":["threshold"],observation:[] };
const sortedJson=(value:unknown):string=>JSON.stringify(value,(_key,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const assessmentPin=(value:unknown):string=>createHash("sha256").update(sortedJson(value)).digest("hex");
function same(a:unknown,b:unknown) { return sortedJson(a)===sortedJson(b); }
function validateRule(value:unknown):Rule {
  const err=check(ruleSchema,value);ensure(!err,"Invalid criterion: "+err);
  const rule=value as Rule, manual=rule.measure==="observation", local=rule.applies==="customer-drawing";
  ensure(same(rule.roles,expectedRoles[rule.measure]),"Incorrect roles for "+rule.id);
  ensure(manual === (rule.units==="observation"),"Incorrect measurement units for "+rule.id);
  ensure((rule.applies==="us-seated-reading") === (rule.measure!=="door-opening"),"Criterion and measurement have incompatible applicability.");
  ensure(local ? rule.source==="project:customer-requirement" && rule.limitFrom==="customer.minimum" :
    rule.source.startsWith("https://") && !rule.limitFrom,"Invalid source or limit reference.");
  if (manual || local) ensure(rule.minimum===undefined && rule.maximum===undefined,"Unexpected numeric limit in "+rule.id);
  else ensure((rule.minimum!==undefined || rule.maximum!==undefined) && (rule.minimum??0)<=(rule.maximum??Infinity),"Missing or inverted limits in "+rule.id);
  return rule;
}
export function parseAssessmentRules(markdown:string):Rule[] {
  const rules=[...markdown.matchAll(/^\x60\x60\x60toml\s*\n([\s\S]*?)^\x60\x60\x60[ \t]*$/gm)].map(m=>validateRule(Bun.TOML.parse(m[1])));
  ensure(rules.length>0 && new Set(rules.map(r=>r.id)).size===rules.length,"A standards entry needs uniquely identified criteria.");
  const anchors=new Set([...markdown.matchAll(/^## (.+)$/gm)].map(m=>m[1].toLowerCase().replace(/[^a-z0-9 -]/g,"").replace(/ +/g,"-")));
  ensure(rules.every(r=>anchors.has(r.anchor)),"Each criterion must cite a heading in its own entry.");
  return rules;
}
const sourceRules=(path:string)=>{ try {return parseAssessmentRules(readFileSync(path,"utf8"));} catch(e) {
  if(e instanceof RoomError)throw e;
  throw new RoomError("assessment_unavailable","The installed standards entry could not be read.","Restore the public workstation-screening.md bundled with this installation.");
} };
function rulesFor(rules:Rule[],settings:Settings) {return rules.filter(r=>r.applies!=="customer-drawing"||settings.profile==="customer-layout");}
function geometryPins(scene:RoomScene) {return [...new Set(scene.instances.map(i=>i.release))].sort();}

export function evaluate(inputs:RunInputs,catalog:RoomCatalog):AssessmentReport {
  const {scene,rules,bindings}=inputs;
  for (const pin of geometryPins(scene)) if (!catalog.releases.some(r=>r.id===pin)) {
    throw new RoomError("missing_release","Saved assessment requires exact release "+pin,"Supply the pinned release on this installation.");
  }
  const findings=rules.flatMap(rule=>bindings.filter(b=>b.measure===rule.measure).map(b=>evaluateFinding(rule,b,inputs,catalog)));
  const person=scene.person?.state;
  return {evaluator:EVALUATOR,sceneId:scene.id,revision:scene.version,profile:inputs.settings.profile,
    population:person ? person.preset??"Individual operator, custom body" : null,posture:person?.posture??null,geometryPins:geometryPins(scene),
    rulePin:assessmentPin({rules,customer:inputs.settings.profile==="customer-layout"?inputs.settings.customer:null}),
    bindingPin:assessmentPin(bindings),inputsPin:assessmentPin(inputs),findings,
    unassessed:["Control reach","Seat adjustment","Other operators and postures","Full exit route, occupancy and door operation"]};
}
function validateSettings(settings:Settings) { ensure(!check(settingsSchema,settings),"Malformed project assessment settings."); }
const refSchema=schemaObject({instance:text,member:text});
const bindingSchema=schemaObject({id:text,measure:fields.measure,roles:{type:"object",additionalProperties:refSchema,propertyNames:{pattern:"^(eye|displayCentre|threshold)$"}}});
function validateInput(inputs:RunInputs) {
  ensure(object(inputs) && object(inputs.scene) && Number.isSafeInteger(inputs.scene.version) && inputs.scene.version>=0,"Invalid saved scene revision.");
  try {
    requireFields(inputs,["scene","settings","rules","bindings","evidence","observation"]);
    sceneShape(inputs.scene);
  } catch(e) {ensure(false,"Invalid frozen scene or assessment inputs: "+(e instanceof Error?e.message:String(e)));}
  validateSettings(inputs.settings);
  ensure(Array.isArray(inputs.rules) && inputs.rules.length>0,"Missing saved criteria.");
  inputs.rules.forEach(validateRule);
  ensure(new Set(inputs.rules.map(r=>r.id)).size===inputs.rules.length && same(inputs.rules,rulesFor(inputs.rules,inputs.settings)),"Duplicate or out-of-profile saved criteria.");
  ensure(Array.isArray(inputs.bindings) && inputs.bindings.length>0 && inputs.bindings.every(b=>!check(bindingSchema,b)),"Invalid saved bindings.");
  const bindings=new Set(inputs.bindings.map(b=>b.id));
  ensure(bindings.size===inputs.bindings.length && inputs.rules.every(r=>inputs.bindings.some(b=>b.measure===r.measure)),"Missing or duplicate measurement bindings.");
  validateEvidence(inputs.evidence,inputs.bindings);
  ensure(typeof inputs.observation==="string" && inputs.observation.length<=512,"Invalid manual observation.");
}
function validateEvidence(evidence:Evidence[],bindings:Binding[]) {
  ensure(Array.isArray(evidence) && evidence.length<=100 && evidence.every(e=>!check(evidenceSchema,e)),"Invalid uncertainty evidence.");
  ensure(new Set(evidence.map(e=>e.binding)).size===evidence.length,"Duplicate uncertainty evidence for a measurement.");
  for (const e of evidence) {
    ensure(bindings.some(b=>b.id===e.binding && b.measure!=="observation"),"Unknown measured binding "+e.binding);
    ensure(e.basis==="independent" ? e.radius!==null : true,"Independent evidence needs a total error bound in metres.");
  }
}
function validateRun(run:SavedRun,sceneIds:string[]) {
  ensure(object(run) && typeof run.id==="string" && typeof run.name==="string" && !!run.name.trim() && run.name.length<=512 && Number.isFinite(Date.parse(run.savedAt)),"Invalid saved run.");
  requireFields(run,["id","name","savedAt","inputs","report","digest"]);
  validateInput(run.inputs);
  requireFields(run.report,["evaluator","sceneId","revision","profile","population","posture","geometryPins","rulePin","bindingPin","inputsPin","findings","unassessed"]);
  const {inputs,report,digest,...metadata}=run;
  ensure(sceneIds.includes(inputs.scene.id),"Assessment references an absent scene "+inputs.scene.id);
  ensure(object(report) && Array.isArray(report.findings) && Array.isArray(report.unassessed) && report.evaluator===EVALUATOR &&
    report.revision===inputs.scene.version && report.sceneId===inputs.scene.id && report.profile===inputs.settings.profile,"Unsupported or inconsistent saved assessment report.");
  ensure(same(report.geometryPins,geometryPins(inputs.scene)) && report.inputsPin===assessmentPin(inputs) &&
    report.rulePin===assessmentPin({rules:inputs.rules,customer:inputs.settings.profile==="customer-layout"?inputs.settings.customer:null}) &&
    report.bindingPin===assessmentPin(inputs.bindings),"Saved inputs disagree with their recorded pins.");
  ensure(digest===assessmentPin({...metadata,inputs,report}),"Saved assessment digest mismatch.");
}
export function validateAssessmentAttachment(data:unknown,sceneIds:string[]):string[] {
  ensure(object(data) && data.schema==="synergon-assessment/1","Unsupported project assessment format.");
  requireFields(data,["schema","settings","runs"]);
  const attachment=data as unknown as AssessmentAttachment;
  validateSettings(attachment.settings);
  ensure(Array.isArray(attachment.runs) && new Set(attachment.runs.map(r=>r?.id)).size===attachment.runs.length,"Invalid collection of saved assessments.");
  for (const run of attachment.runs) validateRun(run,sceneIds);
  return [...new Set(attachment.runs.flatMap(r=>r.report.geometryPins))].sort();
}

/** Called after package resolution and before installation publishes any scenes or release files. */
export function verifyAssessmentReplay(data:unknown,catalog:RoomCatalog):void {
  const attachment=data as AssessmentAttachment;
  for(const run of attachment.runs) {
    for(const instance of run.inputs.scene.instances) validateInstance(run.inputs.scene,catalog,instance);
    ensure(same(run.inputs.bindings,bindScene(run.inputs.scene,catalog)),"Saved bindings differ from their pinned geometry.");
    verifyRun(run,catalog);
  }
}
function verifyRun(run:SavedRun,catalog:RoomCatalog) {
  const report=evaluate(run.inputs,catalog);
  if (!same(report,run.report)) throw new RoomError("replay_mismatch","Replay differs from the frozen assessment.","Check the evaluator version and the exact installed geometry.");
  return report;
}

interface Store {read:()=>unknown;write:(data:AssessmentAttachment)=>void}
interface Options {standardsPath?:string;publicMode?:boolean}
type Args=Partial<Settings>&{expectedSettingsPin?:string;saveName?:string;id?:string;evidence?:Evidence[];observation?:string};
export function assessmentCommand(scene:RoomScene,catalog:RoomCatalog,wire:RoomWire,store:Store,options:Options={}) {
  const spec=assessmentCommands.find(c=>c.id===wire.id);
  ensure(spec,"Unknown assessment command.");
  const args=(wire.args===undefined?{}:wire.args) as Args;
  const err=check(spec!.inputSchema,args);
  if (err) throw new RoomError("invalid_args",err,"Use the assessment command schema.");
  if (wire.expectedVersion!==undefined && wire.expectedVersion!==scene.version) throw new RoomError("stale","The layout changed.","Read the new scene and confirm the inputs.");
  const data=structuredClone(store.read()??{schema:"synergon-assessment/1",settings:initialSettings,runs:[]}) as AssessmentAttachment;
  const localOnly=()=>{throw new RoomError("local_only","Customer requirements belong to a local project.","Open the project on a local installation.");};
  if(options.publicMode && (data.settings.customer || data.settings.profile==="customer-layout" || args.profile==="customer-layout" || Object.hasOwn(args,"customer"))) localOnly();
  const publicRules=()=>sourceRules(options.standardsPath??defaultsPath);
  function info():ProfileInfo {
    return {profiles:profiles.filter(p=>!options.publicMode||p.id==="us-workstation"),settings:data.settings,settingsPin:assessmentPin(data.settings),
      rules:rulesFor(publicRules(),data.settings),saved:data.runs.filter(r=>r.inputs.scene.id===scene.id).map(r=>({id:r.id,name:r.name,revision:r.report.revision}))};
  }
  if (wire.id==="assessment.profiles") return info();
  if (wire.id==="assessment.configure") {
    const {expectedSettingsPin,...patch}=args;
    if (expectedSettingsPin && expectedSettingsPin!==assessmentPin(data.settings)) throw new RoomError("stale","Assessment settings changed.","Read assessment.profiles and apply the intended change again.");
    data.settings={...data.settings,...patch};
    validateSettings(data.settings);
    const result=info();store.write(data);return result;
  }
  if (wire.id==="assessment.replay") {
    const run=data.runs.find(r=>r.id===args.id && r.inputs.scene.id===scene.id);
    if (!run) throw new RoomError("unknown_assessment","No saved assessment with that ID in this scene.","Use assessment.profiles to find a saved run.");
    if(options.publicMode && (run.inputs.settings.customer||run.inputs.settings.profile==="customer-layout")) localOnly();
    validateRun(run,[scene.id]);
    const report=verifyRun(run,catalog);
    return {report,saved:{id:run.id,name:run.name},replayed:true};
  }
  const inputs:RunInputs={scene:structuredClone(scene),settings:structuredClone(data.settings),rules:rulesFor(publicRules(),data.settings),
    bindings:bindScene(scene,catalog),evidence:args.evidence??[],observation:args.observation??""};
  validateEvidence(inputs.evidence,inputs.bindings);
  const report=evaluate(inputs,catalog);
  if (!args.saveName) return {report,saved:null,replayed:false};
  const original={id:randomUUID(),name:args.saveName.trim(),savedAt:new Date().toISOString(),inputs,report};
  const saved={...original,digest:assessmentPin(original)};
  data.runs.push(saved);store.write(data);
  return {report,saved:{id:saved.id,name:saved.name},replayed:false};
}
