import type { Schema } from "./commands/schema.ts";

const text: Schema = { type: "string", pattern: "\\S", maxLength: 512 };
const mode = (...values: string[]): Schema => ({ type: "string", enum: values });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
const metres: Schema = { type: "number", minimum: 0, maximum: 1000 };
const nullable = (s: Schema): Schema => ({ anyOf: [s, {type:"null"}] });
export const customerSchema = obj({minimum:metres, reference:text}, ["minimum","reference"]);
export const settingsFields = {
  profile: mode("us-workstation","customer-layout"), jurisdiction: mode("unknown","us-general-industry","other"),
  task: mode("unknown","seated-display-reading","other"), exitAccess: mode("unknown","yes","no"), customer: nullable(customerSchema),
};
export const evidenceSchema = obj({ binding: text, basis: mode("independent","standard-default","unbounded"), radius: nullable(metres), source: text },
  ["binding","basis","radius","source"]);
const tool = (id: string, description: string, inputSchema: Schema) => ({id, description, inputSchema, edit:false});
export const assessmentCommands = [
  tool("assessment.profiles","Read assessment profiles, applicability facts, criterion citations and the project's saved runs for this scene.", obj({})),
  tool("assessment.configure","Set the project's profile and known applicability facts. A local customer requirement needs its approved minimum in metres and a source reference.",obj({...settingsFields, expectedSettingsPin:text})),
  tool("assessment.run","Evaluate the current scene. Optionally save under a name. Evidence covers total error in one bound measurement, in metres, for this revision. Use the binding IDs returned by a preliminary run.",obj({saveName:text, evidence:{type:"array",items:evidenceSchema,maxItems:100}, observation:text})),
  tool("assessment.replay","Recompute a named run by ID from its frozen scene, rules, bindings and evidence using the receiving installation's exact release pins.",obj({id:text},["id"])),
];
