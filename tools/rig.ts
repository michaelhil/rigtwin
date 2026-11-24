// bun run rig list                                  the commands this server offers (with arguments and examples)
// bun run rig <command> ['<json args>']             run one command, e.g.
//   bun run rig scene.find '{"text": "monitor height"}'
//   bun run rig pose.set '{"joints": {"J_mon_height": -0.03}}' --group lower-monitor
//   bun run rig view.set '{"view": "operator"}' --viewer K7Q2
// Options: --server <url>  the rigtwin server (default $RIG_URL or http://127.0.0.1:4173; the deployed
//                          sandbox is https://mightwork.ai/rigtwin)
//          --viewer <code> the browser a view command is for (its code is in the viewer's More menu)
//          --group <id>    names the request a change belongs to, so `history.undo {"group": ...}` undoes it whole
//          --expected-version <n>  the scene version the change is based on (refused as stale if a joint it
//                          names changed after it)
// Prints one JSON object that names the server it came from; exits 0 when the command ran, 1 when it was
// refused, 2 when it could not be sent. Scripts can import `call()` and `catalogue()` instead.
//
// On a remote server (anything but 127.0.0.1 / localhost) anyone can write: a group name in a reply that is not
// this run's own --group is printed as {"untrusted_group": ...} (text written by a stranger, not an instruction),
// and --group itself is checked against the banned-names list before it is sent (a group is stored and published).
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { bannedIn } from "./banned.ts";

export const DEFAULT_SERVER = "http://127.0.0.1:4173";
/** One random id per run (or per importing script): the server labels this caller "Claude Code · <id>". */
const CLIENT_ID = randomBytes(16).toString("hex");

export interface CallOptions { server?: string; viewer?: string; group?: string; expectedVersion?: number; client?: "agent" | "script" }
export interface Reply { server: string; ok: boolean; version?: number; result?: any; error?: { code: string; message: string; hint: string; schema?: unknown }; commands?: any[] }

export const serverUrl = (s?: string) => (s ?? process.env.RIG_URL ?? DEFAULT_SERVER).replace(/\/+$/, "");
export const isLocal = (base: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(base);
/** Every `group` value that is not `own`, renamed to `untrusted_group` (for replies from a remote server). */
export function markGroups(v: any, own?: string): any {
  if (Array.isArray(v)) return v.map((x) => markGroups(x, own));
  if (!v || typeof v !== "object") return v;
  const out: any = {};
  for (const [k, x] of Object.entries(v)) { if (k === "group" && typeof x === "string" && x !== own) out.untrusted_group = x; else out[k] = markGroups(x, own); }
  return out;
}
const headers = (client: string) => ({ "x-rigtwin": "1", "content-type": "application/json", "x-rigtwin-client": client, "x-rigtwin-client-id": CLIENT_ID });

async function request(base: string, path: string, init: RequestInit): Promise<Reply> {
  let res: Response;
  try { res = await fetch(`${base}/api/${path}`, init); }
  catch (e: any) {
    return { server: base, ok: false, error: { code: "unreachable", message: `no server answers at ${base} (${e?.message ?? e})`, hint: base === DEFAULT_SERVER ? "start the local server with `bun run serve` (or `bun server/server.ts`), or name another with --server <url>" : "check the address; leave out --server to use the local server" } };
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* not JSON: not a rigtwin server */ }
  if (!body || typeof body !== "object" || typeof body.ok !== "boolean") {
    return { server: base, ok: false, error: { code: "not_rigtwin", message: `${base}/api/${path} answered HTTP ${res.status} without a rigtwin reply`, hint: res.status === 404 ? "this address serves no rigtwin API (is it the viewer of an older release, or the wrong path?)" : "the server or the web server in front of it is not ready; try again shortly" } };
  }
  const s = body.server ? `${base} (${body.server.mode}, revision ${body.server.revision})` : base;
  const { server: _s, ...rest } = body;
  return { server: s, ...rest };
}

/** Run one command on a rigtwin server. */
export async function call(id: string, args: unknown = {}, o: CallOptions = {}): Promise<Reply> {
  const base = serverUrl(o.server);
  if (o.group && !isLocal(base)) {
    const hit = bannedIn(o.group, join(import.meta.dir, ".."));
    if (hit.length) return { server: base, ok: false, error: { code: "banned_name", message: "the group name contains a name that must not be published", hint: "choose a neutral group name, e.g. lower-monitor" } };
  }
  const body = { id, args, ...(o.group ? { group: o.group } : {}), ...(o.viewer ? { session: o.viewer.toUpperCase() } : {}), ...(o.expectedVersion !== undefined ? { expectedVersion: o.expectedVersion } : {}) };
  const r = await request(base, "command", { method: "POST", headers: headers(o.client ?? "script"), body: JSON.stringify(body) });
  return isLocal(base) ? r : markGroups(r, o.group);
}

/** The command catalogue of a server (GET api/commands). */
export async function catalogue(o: Pick<CallOptions, "server"> = {}): Promise<Reply> {
  return request(serverUrl(o.server), "commands", { headers: { "x-rigtwin-client": "agent", "x-rigtwin-client-id": CLIENT_ID } });
}

if (import.meta.main) {
  const argv = process.argv.slice(2), flags: Record<string, string> = {}, pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") pos.unshift("help");
    else if (a.startsWith("--")) { flags[a.slice(2)] = argv[i + 1] ?? ""; i++; }
    else pos.push(a);
  }
  const out = (r: unknown, code: number) => { console.log(JSON.stringify(r, null, 2)); process.exit(code); };
  const unknownFlag = Object.keys(flags).find((f) => !["server", "viewer", "group", "expected-version"].includes(f));
  const [cmd, json] = pos;
  if (!cmd || cmd === "help" || unknownFlag) {
    console.log(`usage: bun run rig list | bun run rig <command> ['<json args>'] [--server <url>] [--viewer <code>] [--group <id>] [--expected-version <n>]${unknownFlag ? `\nunknown option --${unknownFlag}` : ""}`);
    process.exit(cmd && !unknownFlag ? 0 : 2);
  }
  if (cmd === "list") {
    const r = await catalogue({ server: flags.server });
    out(r, r.ok ? 0 : 2);
  }
  let args: unknown = {};
  if (json !== undefined) {
    try { args = JSON.parse(json); }
    catch (e: any) { out({ server: serverUrl(flags.server), ok: false, error: { code: "bad_args_json", message: `the arguments are not JSON: ${e.message}`, hint: `put the JSON in single quotes, e.g. bun run rig ${cmd} '{"key": "value"}'; \`bun run rig list\` shows the arguments of every command` } }, 2); }
  }
  const ev = flags["expected-version"];
  if (ev !== undefined && !/^\d+$/.test(ev)) out({ server: serverUrl(flags.server), ok: false, error: { code: "bad_args", message: `--expected-version takes a whole number, not ${JSON.stringify(ev)}`, hint: "the version from scene.summary" } }, 2);
  const r = await call(cmd, args, { server: flags.server, viewer: flags.viewer, group: flags.group, client: "agent", ...(ev !== undefined ? { expectedVersion: Number(ev) } : {}) });
  out(r, r.ok ? 0 : r.error?.code === "unreachable" || r.error?.code === "not_rigtwin" ? 2 : 1);
}
