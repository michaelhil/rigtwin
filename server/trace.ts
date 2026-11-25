// The trace of the shared scene: one record per request (an agent's MCP tool call, a command from the command line or
// a script, a page's own save), sent to every open page as the live-channel event "trace" and kept in memory (the last
// 100; GET api/workspaces/<id>/trace; one trace per workspace). It is what the viewer's activity line and its trace list show: who asked for what, in the
// server's own words, how it ended, how long the server took, and how long the caller took since its previous request
// (for an agent: its own thinking between two tool calls).
//
// Never stored on disk. On the public sandbox a record carries no text a caller wrote: the summary is made from the
// model's vocabulary, the arguments are shown as the server understood them (ids, numbers, view names, request names the
// server made, and text made only of the model's own vocabulary: "backrest", "upright", "-3 cm") with any other text
// replaced by ‹text›, and a refusal by its code and hint only.
import type { Actor, Entry } from "../shared/commands/doc.ts";

export interface TraceRecord {
  n: number;
  /** when the request arrived (ISO) */
  at: string;
  by: string; kind: Actor["kind"]; actor: string;
  /** "mcp": a tool call over MCP; "http": POST api/workspaces/<id>/command (the command line, scripts, the page) */
  via: "mcp" | "http";
  command: string;
  ok: boolean; code?: string;
  /** what happened, in the server's words: "Backrest: recline 25° reclined → upright" */
  summary: string;
  /** server time from the request's arrival to its reply */
  ms: number;
  /** time since this caller's previous reply: for an agent, its own time between two calls */
  after_ms?: number;
  version?: number; request?: string;
  picture?: { bytes: number; wait_ms: number; page_ms?: number } | null;
  /** the request and the reply as the caller sent and saw them (masked on the public sandbox) */
  detail: { args: unknown; session?: string; reply: string };
  /** records not sent since the previous one (the public sandbox sends at most a few a second) */
  dropped?: number;
}

const ID = /^[CDSJ]_[A-Za-z0-9_]{1,60}(:[0-2])?$/, SERVER_NAME = /^[a-z0-9][a-z0-9-]{0,39}-\d+$/;
const WORDS = new Set(["three_quarter", "front", "rear", "left", "right", "top", "front_quarter", "operator", "stand", "seat", "pods", "pedals", "platform", "catalogue", "history", "last", "mine",
  // the person's (shared/commands/person.ts): presets, styles, sexes, tones, postures, what measure {person} measures
  "P5 woman", "P50 man", "P95 man", "dressed", "clay", "female", "male", "light", "medium", "dark", "operating", "relaxed stand", "RELAXED_STAND", "eye", "sight", "reach", "clearance", "all"]);
/** Arguments without any text a caller wrote: ids, numbers, booleans, view and group names and server-made request names stay. */
export function mask(v: unknown, allow: (s: string) => boolean = () => false, depth = 0): unknown {
  if (depth > 6) return "…";
  if (typeof v === "string") return ID.test(v) || WORDS.has(v) || SERVER_NAME.test(v) || allow(v) ? v : "‹text›";
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => mask(x, allow, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v).slice(0, 40)) out[ID.test(k) || /^[a-z_]{1,20}$/i.test(k) ? k : "‹key›"] = mask(x, allow, depth + 1);
    return out;
  }
  return v;
}

/** The server's words for what a command did (no caller text in it). */
export function summarize(command: string, ok: boolean, result: any, error: { code: string } | undefined): string {
  if (!ok) return `refused: ${error?.code ?? "error"}`;
  const r = result ?? {};
  switch (command) {
    case "adjust": return (r.changes ?? []).map((c: any) => `${c.adjustment} ${c.before} → ${c.after}`).join("; ") || "nothing changed";
    case "undo": return (r.lines ?? []).join("; ") || `v${(r.undid ?? []).join(", v")}`;
    case "state": return "read the scene";
    case "measure": return typeof r.text === "string" ? (r.computed_by ? "measured the person" : r.text.split(". ")[0]) : "measured";
    case "look": return typeof r.text === "string" ? r.text.split("\n")[0].replace(/^Showing /, "showing ").replace(/\.$/, "") : "look";
    case "pose.set": case "history.undo": return [...new Set((r.changes ?? []).map((c: any) => c.said ?? c.label))].join("; ") || "nothing changed";
    case "scene.summary": return "read the scene";
    case "scene.find": return `looked up ${(r.matches ?? []).length} match(es)`;
    case "measure.distance": return r.from ? `${String(r.from.label).replace(/\s*\([^)]*\)/g, "")} → ${String(r.to.label).replace(/\s*\([^)]*\)/g, "")}: ${Math.round(r.distance_m * 1000) / 10} cm` : "measured";
    case "view.set": return `view ${r.view}`;
    case "view.show": return "chose what is shown";
    case "view.select": return `selected ${r.selected}`;
    case "person": return typeof r.before === "string" ? `person: ${r.before} → ${r.after}` : "person";
    case "person.set": case "person.pose": case "person.clear": return typeof r.said === "string" ? `person: ${r.before} → ${r.said}` : command;
    case "person.report": return "measured the person";
    case "connect": return "connected over MCP";
    default: return command;
  }
}

/** The reply as the caller saw it: the text of an intent command, or a short form; a refusal by code and hint. */
function replyText(ok: boolean, result: any, error: { code: string; message?: string; hint?: string } | undefined, publicMode: boolean): string {
  if (!ok) return publicMode ? `Refused (${error?.code}). What to do: ${error?.hint ?? ""}` : `Refused (${error?.code}): ${error?.message ?? ""}\nWhat to do: ${error?.hint ?? ""}`;
  if (typeof result?.text === "string") return result.text;
  const { picture: _p, ...rest } = result ?? {};
  const s = JSON.stringify(rest, null, 1);
  return s.length > 2000 ? s.slice(0, 2000) + " …" : s;
}

export function createTrace(o: { publicMode: boolean; keep?: number; perSecond?: number; send(rec: TraceRecord): void; allow?: (s: string) => boolean }) {
  const keep = o.keep ?? 100, perSecond = o.perSecond ?? (o.publicMode ? 8 : Number.POSITIVE_INFINITY);
  const ring: TraceRecord[] = [], lastReply = new Map<string, number>();
  let n = 0, dropped = 0, windowStart = 0, inWindow = 0;
  function record(x: {
    at: number; ms: number; you: Actor; via: "mcp" | "http"; command: string; args: unknown; session?: string;
    ok: boolean; result?: any; error?: { code: string; message?: string; hint?: string }; entry?: Entry | null;
    picture?: { bytes: number; wait_ms: number; page_ms?: number } | null;
  }): TraceRecord {
    const end = x.at + x.ms, prev = lastReply.get(x.you.id);
    lastReply.set(x.you.id, end);
    if (lastReply.size > 2000) lastReply.delete(lastReply.keys().next().value!);
    const group = x.entry?.group;
    const rec: TraceRecord = {
      n: ++n, at: new Date(x.at).toISOString(), by: x.you.label, kind: x.you.kind, actor: x.you.id, via: x.via, command: x.command,
      ok: x.ok, ...(x.ok ? {} : { code: x.error?.code }), summary: summarize(x.command, x.ok, x.result, x.error), ms: Math.round(x.ms * 10) / 10,
      ...(prev !== undefined ? { after_ms: Math.max(0, Math.round(x.at - prev)) } : {}),
      ...(x.entry ? { version: x.entry.version, ...(group && (!o.publicMode || SERVER_NAME.test(group)) ? { request: group } : {}) } : {}),
      ...(x.picture !== undefined ? { picture: x.picture } : {}),
      detail: { args: o.publicMode ? mask(x.args, o.allow) : x.args, ...(x.session ? { session: o.publicMode ? "‹code›" : x.session } : {}), reply: replyText(x.ok, x.result, x.error, o.publicMode) },
    };
    ring.push(rec); if (ring.length > keep) ring.shift();
    const now = Date.now();
    if (now - windowStart >= 1000) { windowStart = now; inWindow = 0; }
    if (inWindow < perSecond) { inWindow++; o.send(dropped ? { ...rec, dropped } : rec); dropped = 0; }
    else dropped++;
    return rec;
  }
  return { record, recent: (after = 0) => ring.filter((r) => r.n > after) };
}
