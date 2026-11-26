import { projectCommands } from "../shared/project-commands.ts";
import { fields, invalid, object, ProjectError } from "./project-package.ts";
import type { ProjectStore } from "./project-store.ts";

export async function projectCommand(store: ProjectStore, wire: unknown) {
  fields(wire, ["id", "args"], ["id"]);
  const command = projectCommands.find((s) => s.id === wire.id);
  if (!command) throw invalid("Unknown project command. Read /api/projects/commands.");
  const args = wire.args ?? {};
  fields(args, Object.keys(command.inputSchema.properties), command.inputSchema.required);
  try {
    return await store.run(command.id, args);
  } catch (e) {
    if (e instanceof Error && e.name === "RangeError") throw invalid("Invalid or excessively nested project content.");
    throw e;
  }
}
export async function projectMcp(store: ProjectStore, message: unknown): Promise<Response> {
  const m = object(message) ? message : {};
  const json = (result: unknown) => Response.json({ jsonrpc: "2.0", id: m.id ?? null, result });
  const reject = (code: number, message: string) =>
    Response.json({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return reject(-32600, "Expected a JSON-RPC 2.0 request.");
  if (m.id === undefined) return new Response(null, { status: 202 });
  if (m.method === "initialize") {
    const supported = ["2025-11-25", "2025-06-18", "2025-03-26"],
      wanted = object(m.params) ? String(m.params.protocolVersion) : "";
    return json({
      protocolVersion: supported.includes(wanted) ? wanted : supported[0],
      capabilities: { tools: {} },
      serverInfo: { name: "synergon-projects", version: "1" },
      instructions:
        "List and open a local project. Its scene entries contain workspace IDs for the room MCP endpoint. Project folders and criteria stay on this installation.",
    });
  }
  if (m.method === "ping") return json({});
  if (m.method === "tools/list")
    return json({
      tools: projectCommands.map(({ id, description, inputSchema }) => ({
        name: id.replace(".", "_"),
        description,
        inputSchema,
      })),
    });
  if (m.method !== "tools/call") return reject(-32601, "Unknown JSON-RPC method.");
  const params = object(m.params) ? m.params : {},
    spec = projectCommands.find((c) => c.id.replace(".", "_") === params.name);
  if (!spec) return reject(-32602, "Unknown project tool.");
  try {
    const result = await projectCommand(store, { id: spec.id, args: params.arguments ?? {} });
    return json({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: { result },
      isError: false,
    });
  } catch (e) {
    const error = {
      code: e instanceof ProjectError ? e.code : "invalid_project",
      message: e instanceof Error ? e.message : String(e),
      hint: e instanceof ProjectError ? e.hint : "Verify the project inputs.",
    };
    return json({
      content: [{ type: "text", text: error.message + " " + error.hint }],
      structuredContent: { error },
      isError: true,
    });
  }
}
