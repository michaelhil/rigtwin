// The intent commands as tool definitions (name, description, JSON Schema): what the MCP endpoint lists (server/mcp.ts),
// what the generated documentation shows (agent-docs.ts) and what the step-4 agent in the app is given.
import type { Schema } from "./schema.ts";
import { tools as toolSpecs, type CommandSpec } from "./registry.ts";

/** A registry schema as plain JSON Schema for a model: the extra keyword `unit` goes into the description. */
export function toJsonSchema(s: Schema): Record<string, unknown> {
  const o: any = { ...s };
  if (o.unit) { o.description = `${o.description ? `${o.description} ` : ""}(${o.unit})`.trim(); delete o.unit; }
  if (o.properties) o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, toJsonSchema(v as Schema)]));
  if (o.items) o.items = toJsonSchema(o.items);
  if (o.anyOf) o.anyOf = o.anyOf.map(toJsonSchema);
  if (o.additionalProperties && typeof o.additionalProperties === "object") o.additionalProperties = toJsonSchema(o.additionalProperties);
  return o;
}

/** The tool definitions (also what the step-4 agent in the app is given). `look` gets the viewer code as an argument. */
export function toolList() {
  return toolSpecs().map((spec: CommandSpec) => {
    const schema = toJsonSchema(spec.args) as any;
    if (spec.id === "look") schema.properties = { ...schema.properties, viewer: { type: "string", pattern: "^[A-Za-z2-9]{8}$", description: "the browser's code (More → Shared scene); remembered for later calls. Locally it may be left out: then every open page." } };
    const examples = spec.examples.map((e) => `${JSON.stringify(e.args)}: ${e.note}`).join("; ");
    return {
      name: spec.tool!, description: `${spec.summary} Examples: ${examples}`, inputSchema: { type: "object", ...schema },
      annotations: { readOnlyHint: spec.kind !== "edit", destructiveHint: false, idempotentHint: spec.kind !== "edit", openWorldHint: false },
      _meta: { "anthropic/alwaysLoad": true },
    };
  });
}

