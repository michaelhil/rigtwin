import type { PersonState } from "./commands/doc.ts";
import type { Schema } from "./commands/schema.ts";

export type OperatorPatch=Partial<Pick<PersonState,"style"|"sex"|"tone"|"glasses"|"headset"|"body"|"posture">>&{preset?:string};
export interface OperatorOptions {
  presets:string[];postures:string[];tones:{id:string;label:string}[];
  controls:{id:string;label:string;unit:string;min:number;max:number;step:number;default:number}[];
}
const string:Schema={type:"string",pattern:"\\S",maxLength:80};
export const operatorFields:Record<keyof OperatorPatch,Schema>={
  sex:{type:"string",enum:["female","male"]},style:{type:"string",enum:["dressed","clay"]},
  tone:{type:"string",enum:["light","medium","dark"]},glasses:{type:"boolean"},headset:{type:"boolean"},
  body:{type:"object",additionalProperties:{type:"number"},propertyNames:{pattern:"^[a-z_]{1,40}$"}},
  preset:string,posture:string,
};
