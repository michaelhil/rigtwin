import { applySet,packageOf,resolvePosture } from "../shared/commands/person.ts";
import { PRESETS } from "../shared/commands/person-words.ts";
import { Refusal } from "../shared/commands/schema.ts";
import type { PersonState } from "../shared/commands/doc.ts";
import type { AssetInfo } from "../shared/commands/registry.ts";
import type { OperatorOptions,OperatorPatch } from "../shared/room-person.ts";

function support(asset:AssetInfo) {
  if(!asset.people)throw new Refusal("incompatible","This release has no supported operator package.","Choose a station with an operator package.");
  return asset.people;
}
export function configureOperator(asset:AssetInfo,prior:PersonState,patch:OperatorPatch):PersonState {
  const people=support(asset);
  const {posture,...appearance}=patch;
  const {next}=applySet(people,prior,appearance);
  next.posture=resolvePosture(people,next,posture??prior.posture);
  if(posture!==undefined) delete next.aims;
  return next;
}
export function operatorOptions(asset:AssetInfo,state:PersonState):OperatorOptions {
  const people=support(asset),m=packageOf(people,state).manifest;
  return {presets:[...new Set<string>([...Object.keys(PRESETS),...m.shape.presets.map((p:{name:string})=>p.name)])],
    postures:[...new Set<string>(["operating","RELAXED_STAND",...(m.poses??[]).map((p:{name:string})=>p.name)])],
    tones:(m.tones?.list??[]).map(({id,label}:{id:string;label:string})=>({id,label})),
    controls:m.shape.controls.map(({id,label,unit,min,max,step,default:d}:OperatorOptions["controls"][number])=>({id,label,unit,min,max,step,default:d}))};
}
