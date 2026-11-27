// Command-line client for the same command catalogue and scene writer as the viewer.
// The hierarchy is Workspace -> Project -> Scene; scene commands need --scene.
const words = process.argv.slice(2);
function option(key: string): string | undefined {
  const at = words.indexOf(key);
  if (at < 0) return;
  const [, value] = words.splice(at, 2);
  if (!value || value.startsWith("--")) throw new Error(key + " requires a value");
  return value;
}
const ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
interface Tree { id: string; name: string; projects: { id: string; name: string; scenes: { id: string; name: string }[] }[] }

async function main() {
  const suppliedBase = option("--server") ?? process.env.RIG_URL;
  const scene = option("--scene") ?? option("--workspace") ?? process.env.RIG_SCENE;
  const revision = option("--expected-version");
  const url = scene && /^https?:\/\//.test(scene) ? new URL(scene) : undefined;
  const base = new URL(suppliedBase ?? url?.origin ?? "http://127.0.0.1:4173");
  if (url && url.origin !== base.origin) throw new Error("Scene link and server refer to different installations");
  if (revision !== undefined && !/^\d+$/.test(revision)) throw new Error("Expected a non-negative integer for --expected-version");
  const [command, arg, ...extra] = words;
  if (extra.length) throw new Error("Unexpected arguments: " + extra.join(" "));
  if (!command || command === "--help") {
    console.log([
      "bun run rig list                          the scene command catalogue",
      "bun run rig workspaces                    workspaces with their projects and scenes",
      "bun run rig workspace.create|project.create|project.scene|...  [JSON]   create or rename (project.help lists them)",
      "bun run rig <command> [JSON] --scene <scene name, UUID or link> [--server URL] [--expected-version N]",
    ].join("\n"));
    return;
  }
  const request = async (path: string, body?: object) => {
    const response = await fetch(new URL(path, base), body ? { method: "POST", headers: { "content-type": "application/json", "X-Synergon": "1" }, body: JSON.stringify(body) } : undefined);
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(JSON.stringify(data.error ?? data));
    return data;
  };
  const trees = async (): Promise<Tree[]> => {
    const { workspaces } = await request("/api/workspaces") as { workspaces: { id: string }[] };
    return Promise.all(workspaces.map(w => request("/api/workspaces/" + w.id) as Promise<Tree>));
  };
  if (command.startsWith("project.") || command.startsWith("workspace.") || command.startsWith("scene.")) {
    const { runProjectCli } = await import("./project-cli.ts");
    return runProjectCli(command, arg, request);
  }
  if (command === "list") return request("/api/commands");
  if (command === "workspaces") return trees();
  if (!scene) throw new Error("Choose --scene with a scene link, ID or name ('bun run rig workspaces' lists them).");
  let id = url ? /^\/(?:api\/scenes|workspaces(?:\/room)?)\/([^/]+)(?:\/mcp)?\/?$/.exec(url.pathname)?.[1] : scene;
  if (!id) throw new Error("Expected a Synergon scene link such as /workspaces/<scene id>");
  if (!ID.test(id)) {
    const wanted = id.toLowerCase();
    const matches = (await trees()).flatMap(w => w.projects.flatMap(p => p.scenes.filter(s => s.name.toLowerCase() === wanted)
      .map(s => ({ ...s, where: w.name + " › " + p.name }))));
    if (matches.length !== 1) throw new Error("Expected one scene named " + JSON.stringify(id) + ", found " + matches.length +
      (matches.length ? ": " + matches.map(m => m.where + " › " + m.name + " (" + m.id + ")").join("; ") : "") + ". Choose a scene ID.");
    id = matches[0].id;
  }
  return request("/api/scenes/" + id + "/command", { id: command, args: arg ? JSON.parse(arg) : {}, ...(revision === undefined ? {} : {expectedVersion: Number(revision)}) });
}
try {
  const result = await main();
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
}
export {};
