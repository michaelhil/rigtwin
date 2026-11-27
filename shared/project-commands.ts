// The HTTP, CLI and project MCP endpoint use the same contract. The hierarchy is Workspace -> Project -> Scene.
const text = { type: "string" },
  uuid = { type: "string", format: "uuid" };
const folder = {
  type: "string",
  description: "Folder relative to the local projects directory, e.g. Client/Control room.",
};
const mode = { type: "string", enum: ["link", "embed"] };
const template = { enum: ["empty", "demo"], description: "empty (default) or demo, a furnished control room." };
function command(id: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return {
    id: id.includes(".") ? id : "project." + id,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
  };
}
export const projectCommands = [
  command(
    "workspace.create",
    "Create a workspace with a first project and scene. Returns the workspace, project and scene IDs; open the scene at /workspaces/{scene}.",
    { name: text, template },
  ),
  command("workspace.rename", "Rename a workspace.", { workspace: uuid, name: text }, ["workspace", "name"]),
  command("list", "List projects with their workspace and folder.", {}),
  command(
    "open",
    "Open a project by project ID, or the project that holds a scene. Lists its scenes (id, name, revision), named versions and dependencies.",
    { project: uuid, scene: uuid },
  ),
  command(
    "create",
    "Create a project with its first scene in a workspace. Returns the project and the new scene ID. Markdown is the entire project record.",
    { workspace: uuid, name: text, sceneName: text, template, folder, markdown: text },
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
    "Add a scene to this project. Returns the project and the new scene ID; open it at /workspaces/{scene}.",
    { project: uuid, name: text, template },
    ["project"],
  ),
  command("scene.rename", "Rename a scene.", { scene: uuid, name: text }, ["scene", "name"]),
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
    { package: { type: "object" }, workspace: uuid, folder, separateCopy: { type: "boolean" } },
    ["package"],
  ),
];
