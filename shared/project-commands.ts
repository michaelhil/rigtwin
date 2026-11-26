// The HTTP, CLI and local project MCP endpoint use the same contract.
const text = { type: "string" },
  uuid = { type: "string", format: "uuid" };
const folder = {
  type: "string",
  description: "Folder relative to the local projects directory, e.g. Client/Control room.",
};
const mode = { type: "string", enum: ["link", "embed"] };
function command(id: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return {
    id: "project." + id,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
  };
}
export const projectCommands = [
  command("list", "List local projects and their folders.", {}),
  command(
    "open",
    "Open the project by stable project ID or its local workspace ID. Lists scene/workspace IDs, revisions and dependencies.",
    { project: uuid, workspace: uuid },
  ),
  command(
    "create",
    "Create a local project and its first empty scene. Markdown is the entire project record.",
    { name: text, folder, markdown: text, sceneName: text },
    ["name"],
  ),
  command("move", "Move the project folder and its subprojects. IDs remain stable.", { project: uuid, folder }, [
    "project",
    "folder",
  ]),
  command("rename", "Change the project title.", { project: uuid, name: text }, ["project", "name"]),
  command(
    "record",
    "Replace project.md. Read the open project's full markdown before editing it.",
    { project: uuid, markdown: text, previous: text },
    ["project", "markdown", "previous"],
  ),
  command(
    "scene",
    "Add a named scene to this project. Open its workspace link to edit or measure.",
    { project: uuid, name: text, template: { enum: ["empty", "demo"] } },
    ["project", "name"],
  ),
  command(
    "save",
    "Freeze the chosen scene at its current revision under a version name.",
    { project: uuid, scene: uuid, name: text, expectedVersion: { type: "integer", minimum: 0 } },
    ["project", "scene", "name"],
  ),
  command(
    "restore",
    "Replace the live scene from a named version. A restore begins a new undo interval.",
    { project: uuid, version: uuid, expectedVersion: { type: "integer", minimum: 0 } },
    ["project", "version", "expectedVersion"],
  ),
  command(
    "compare",
    "Compare a named version with the current scene or another version of that scene.",
    { project: uuid, version: uuid, other: uuid },
    ["project", "version"],
  ),
  command(
    "export",
    "Export a portable package. Set defaultMode and optional modes keyed by exact release pin. Restricted releases must link.",
    { project: uuid, defaultMode: mode, modes: { type: "object", additionalProperties: mode } },
    ["project"],
  ),
  command(
    "import",
    "Validate a complete package and import it atomically. Choose separateCopy for a divergent project. Existing identical content is reused.",
    { package: { type: "object" }, folder, separateCopy: { type: "boolean" } },
    ["package"],
  ),
];
