// Command-line client for the same command catalogue and scene writer as the room viewer.
const words = process.argv.slice(2);
function option(key: string): string | undefined {
  const at = words.indexOf(key);
  if (at < 0) return;
  const [, value] = words.splice(at, 2);
  if (!value || value.startsWith("--")) throw new Error(key + " requires a value");
  return value;
}

async function main() {
  const suppliedBase = option("--server") ?? process.env.RIG_URL;
  const workspace = option("--workspace") ?? process.env.RIG_WORKSPACE;
  const revision = option("--expected-version");
  const url = workspace && /^https?:\/\//.test(workspace) ? new URL(workspace) : undefined;
  const base = new URL(suppliedBase ?? url?.origin ?? "http://127.0.0.1:4173");
  if (url && url.origin !== base.origin) throw new Error("Workspace link and server refer to different installations");
  if (revision !== undefined && !/^\d+$/.test(revision)) throw new Error("Expected a non-negative integer for --expected-version");
  const request = async (path: string, body?: object) => {
    const response = await fetch(new URL(path, base), body ? { method: "POST", headers: { "content-type": "application/json", "X-Synergon": "1" }, body: JSON.stringify(body) } : undefined);
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(JSON.stringify(data.error ?? data));
    return data;
  };
  const [command, arg, ...extra] = words;
  if (extra.length) throw new Error("Unexpected arguments: " + extra.join(" "));
  if (!command || command === "--help") {
    console.log('bun run rig list | workspaces [search] | <command> [JSON arguments] --workspace <name, UUID or link> [--server URL] [--expected-version N]');
    return;
  }
  if (command === "list") return request("/api/commands");
  if (command === "workspaces") return request("/api/workspaces?search=" + encodeURIComponent(arg ?? ""));
  if (!workspace) throw new Error("Choose --workspace using 'workspaces' or a workspace link.");
  let id = url ? /^\/(?:api\/)?workspaces\/([^/]+)(?:\/mcp)?\/?$/.exec(url.pathname)?.[1] : workspace;
  if (!id) throw new Error("Expected a Synergon workspace link");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) {
    let cursor: string | null = null;
    const matches: {id:string; name:string}[] = [];
    do {
      const page = await request("/api/workspaces?" + new URLSearchParams({search:id, ...(cursor ? {cursor} : {})}));
      matches.push(...page.workspaces.filter((row: {name:string}) => row.name.toLowerCase() === id!.toLowerCase()));
      cursor = page.next;
    } while (cursor);
    if (matches.length !== 1) throw new Error("Expected one workspace named " + JSON.stringify(id) + ", found " + matches.length + ". Choose a workspace ID.");
    id = matches[0].id;
  }
  return request("/api/workspaces/" + id + "/command", { id: command, args: arg ? JSON.parse(arg) : {}, ...(revision === undefined ? {} : {expectedVersion: Number(revision)}) });
}
try {
  const result = await main();
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
}
export {};
