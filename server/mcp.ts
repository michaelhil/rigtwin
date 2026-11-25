// The MCP endpoint of a workspace of the synergon server (agent interface v2): POST /api/workspaces/<id>/mcp, Model Context
// Protocol over Streamable HTTP, tools only. One endpoint (and one createMcp) per workspace: the address names the scene the tools
// work in. The same tools on the laptop (http://127.0.0.1:4173/api/workspaces/playground/mcp) and on the host
// (https://synergon.mightwork.ai/api/workspaces/<id>/mcp): adjust, look, measure, undo, state, person (shared/commands/intent.ts). Their schemas and
// descriptions come from the command registry, the server's instructions (shown to the model at session start, at most
// 4,096 characters in Claude Code) from the catalogue of adjustments, so nothing about them is written by hand.
//
// Kept small on purpose: JSON-RPC requests answered with one JSON body (no server-initiated stream: GET is 405), the
// methods initialize, ping, tools/list and tools/call; notifications are accepted with 202. A tool call goes through the
// same path as POST /api/workspaces/<id>/command (guards, refusals, history, live channel). The caller is "Claude Code · <id>", with the id
// made from the MCP session (Mcp-Session-Id, made here at initialize) the same way as for any other client: a keyed hash.
// The session also remembers the last viewer code `look` was given, so an agent names a browser once.
//
// Requests with an Origin header that is not this server's own are refused (DNS rebinding and other web pages; MCP
// clients send none), and a JSON content type is required, which a cross-site page cannot send without a preflight that
// this server never answers.
import { createHmac, randomBytes } from "node:crypto";
import type { Actor } from "../shared/commands/doc.ts";
import { tools as toolSpecs } from "../shared/commands/registry.ts";
import { toolList } from "../shared/commands/tools.ts";
import { SESSION_PATTERN } from "../shared/commands/core.ts";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SESSION_RE = /^[0-9a-f]{32}$/;

export interface ToolReply { ok: boolean; result?: any; error?: { code: string; message: string; hint: string } }
export interface McpOptions {
  /** run one command the way POST /api/workspaces/<id>/command does (guards included) */
  exec(you: Actor, wire: { id: string; args: unknown; session?: string }, visitor: string): Promise<ToolReply>;
  secret: Buffer;
  instructions(): string;
  revision: string;
  maxSessions: number;
  /** a client has connected (initialize): for the trace */
  onConnect?(you: Actor): void;
}

export function createMcp(o: McpOptions) {
  const sessions = new Map<string, { viewer?: string; last: number }>();
  const actor = (sid: string): Actor => { const id = createHmac("sha256", o.secret).update(`mcp:${sid}`).digest("hex").slice(0, 12); return { kind: "agent", id, label: `Claude Code · ${id.slice(0, 4)}` }; };
  function session(sid: string) {
    let s = sessions.get(sid);
    if (!s) {
      if (sessions.size >= o.maxSessions) { const oldest = [...sessions].sort((a, b) => a[1].last - b[1].last)[0]; if (oldest) sessions.delete(oldest[0]); }
      sessions.set(sid, (s = { last: Date.now() }));
    }
    s.last = Date.now();
    return s;
  }
  const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  async function call(sid: string, name: string, args: Record<string, unknown>, visitor: string) {
    const spec = toolSpecs().find((s) => s.tool === name);
    if (!spec) return { content: [{ type: "text", text: `There is no tool ${JSON.stringify(name)}; the tools are ${toolSpecs().map((s) => s.tool).join(", ")}.` }], isError: true };
    const s = session(sid), a = { ...args };
    let viewer: string | undefined;
    if (spec.id === "look") {
      if (typeof a.viewer === "string" && a.viewer.trim()) {
        viewer = a.viewer.trim().toUpperCase();
        if (!new RegExp(SESSION_PATTERN).test(viewer)) return { content: [{ type: "text", text: "Refused (invalid_args): viewer is not a browser's code\nWhat to do: the code is the eight characters under More, \"Shared scene\", in the viewer" }], isError: true };
        s.viewer = viewer;                                       // kept only once it looks like a code
      } else viewer = s.viewer;
      delete a.viewer;
    }
    const r = await o.exec(actor(sid), { id: spec.id, args: a, ...(viewer ? { session: viewer } : {}) }, visitor);
    if (!r.ok) return { content: [{ type: "text", text: `Refused (${r.error?.code}): ${r.error?.message}\nWhat to do: ${r.error?.hint}` }], isError: true };
    const res = r.result ?? {}, content: any[] = [{ type: "text", text: typeof res.text === "string" ? res.text : JSON.stringify(res) }];
    if (res.picture?.base64) content.push({ type: "image", data: res.picture.base64, mimeType: res.picture.mime });
    return { content };
  }

  async function one(sid: string, m: any, visitor: string): Promise<object | null> {
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string") return rpcError(m?.id, -32600, "not a JSON-RPC 2.0 request");
    const notification = m.id === undefined;
    if (notification) return null;                                                     // initialized, cancelled, ...: nothing to say
    switch (m.method) {
      case "initialize": {
        const want = m.params?.protocolVersion;
        o.onConnect?.(actor(sid));
        return rpc(m.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(want) ? want : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "synergon", title: "synergon shared scene", version: o.revision },
          instructions: o.instructions(),
        });
      }
      case "ping": return rpc(m.id, {});
      case "tools/list": return rpc(m.id, { tools: toolList() });
      case "tools/call": {
        const name = m.params?.name, args = m.params?.arguments ?? {};
        if (typeof name !== "string" || !args || typeof args !== "object" || Array.isArray(args)) return rpcError(m.id, -32602, "tools/call needs a tool name and an arguments object");
        return rpc(m.id, await call(sid, name, args, visitor));
      }
      case "resources/list": return rpc(m.id, { resources: [] });
      case "prompts/list": return rpc(m.id, { prompts: [] });
      default: return rpcError(m.id, -32601, `method ${m.method} is not offered (tools only)`);
    }
  }

  /** One POST .../mcp, its body already read and parsed: one JSON-RPC message. Batches (dropped from MCP in 2025-06-18) are
   *  refused, so that one request is one rate-limited unit of work (security review of agent interface v2, finding 1). */
  async function handle(req: Request, body: unknown, visitor: string): Promise<Response> {
    const given = req.headers.get("mcp-session-id");
    const isInit = (body as any)?.method === "initialize";
    const sid = isInit || !given || !SESSION_RE.test(given) ? randomBytes(16).toString("hex") : given;
    const headers: Record<string, string> = { "cache-control": "no-store", "mcp-session-id": sid };
    if (Array.isArray(body)) return Response.json(rpcError(null, -32600, "batches are not accepted: send one JSON-RPC message per request"), { status: 400, headers });
    let out: object | null;
    try { out = await one(sid, body, visitor); }
    catch (e: any) { console.error("mcp:", e?.stack ?? e); out = rpcError((body as any)?.id, -32603, "internal error"); }
    if (!out) return new Response(null, { status: 202, headers });
    return Response.json(out, { headers });
  }
  const end = (sid: string | null) => { if (sid) sessions.delete(sid); };
  return { handle, end, sessions };
}
