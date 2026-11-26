// Local room workspaces use their own file. An edit and its bounded undo history commit in one transaction.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { roomCommands } from "../shared/room-commands.ts";
import { ROOM_SCHEMA, type RoomCatalog, type RoomScene } from "../shared/room.ts";
import { LIMITS } from "./limits.ts";
import { NameError, cleanName, isWorkspaceId } from "./workspaces.ts";
import { RoomError, newRoom, parseRoom, roomCommand, type RoomWire } from "./room-model.ts";
import { roomMcp } from "./room-mcp.ts";

interface RoomApiOptions { dataDir: string; catalog: RoomCatalog }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string, hint = "") => json({ ok: false, error: { code, message, hint } }, status);
const method = () => fail(405, "method", "Method unavailable for this route.");
const obj = (a: unknown): a is Record<string, unknown> => !!a && typeof a === "object" && !Array.isArray(a);
class RequestError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

async function body(req: Request): Promise<unknown> {
  if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw new RequestError(415, "content_type", "Send an application/json request body.");
  const limit = LIMITS.bodyBytes, reader = req.body?.getReader();
  if (!reader) throw new RequestError(400, "json", "Missing JSON body.");
  let length = 0, timedOut = false;
  const pieces: Uint8Array[] = [];
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, LIMITS.bodyTimeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) throw new RequestError(408, "timeout", "The request body took too long.");
      if (done) break;
      length += value.length;
      if (length > limit) { void reader.cancel().catch(() => {}); throw new RequestError(413, "too_large", "The request body exceeds " + limit + " bytes."); }
      pieces.push(value);
    }
    try { return JSON.parse(Buffer.concat(pieces).toString("utf8")); }
    catch { throw new RequestError(400, "json", "Malformed JSON body."); }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export function createRoomApi({ dataDir, catalog }: RoomApiOptions) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, "rooms-v1.sqlite"), { create: true });
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");
  db.run("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, doc TEXT NOT NULL)");
  const get = db.query<{ doc: string }, [string]>("SELECT doc FROM rooms WHERE id=?");
  const list = db.query<{ id: string; name: string; version: number }, []>("SELECT id,name,version FROM rooms ORDER BY rowid DESC");
  const insert = db.query("INSERT INTO rooms (id,name,version,doc) VALUES (?,?,?,?)");
  const update = db.query("UPDATE rooms SET version=?, doc=? WHERE id=?");
  const create = (name: string, template: "empty" | "demo") => {
    const id = randomUUID(), record = newRoom(id, name, catalog, template);
    insert.run(id, name, 0, JSON.stringify(record));
    return { id, name, version: 0 };
  };
  db.transaction(() => {
    if (!db.query("SELECT 1 FROM rooms LIMIT 1").get()) {
      const demo = catalog.releases.some(r => r.kind === "station") && catalog.releases.some(r => r.variant === "wall") &&
        catalog.releases.some(r => r.variant === "freestanding" && r.version === "1");
      create("Control room", demo ? "demo" : "empty");
    }
  }).immediate();

  const listeners = new Map<string, Set<(event: Uint8Array) => void>>();
  const encoder = new TextEncoder();
  const event = (scene: RoomScene) => encoder.encode("id: " + scene.version + "\nevent: snapshot\ndata: " + JSON.stringify(scene) + "\n\n");
  const ends = new Set<() => void>();
  function live(req: Request, room: RoomScene) {
    let stop: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let group = listeners.get(room.id);
        if (!group) listeners.set(room.id, group = new Set());
        const send = (bytes: Uint8Array) => {
          if ((controller.desiredSize ?? 0) <= 0) { stop(); return; }
          controller.enqueue(bytes);
        };
        group.add(send);
        controller.enqueue(event(room));
        const hb = setInterval(() => {
          if ((controller.desiredSize ?? 0) <= 0) { stop(); return; }
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }, LIMITS.heartbeatMs);
        stop = () => {
          clearInterval(hb);
          group.delete(send); if (!group.size) listeners.delete(room.id);
          ends.delete(stop); req.signal.removeEventListener("abort", stop);
          try { controller.close(); } catch { /* Reader already cancelled. */ }
        };
        ends.add(stop); req.signal.addEventListener("abort", stop, { once: true });
        if (req.signal.aborted) stop();
      },
      cancel() { stop(); },
    }, new ByteLengthQueuingStrategy({ highWaterMark: LIMITS.streamQueueBytes }));
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
  }
  function publish(s: RoomScene) {
    const group = listeners.get(s.id);
    if (!group?.size) return;
    const e = event(s);
    for (const send of group) send(e);
  }
  const missing = () => new RequestError(404, "no_workspace", "Unknown room workspace.");
  const read = (id: string) => {
    const row = get.get(id);
    if (!row) throw missing();
    const record = parseRoom(row.doc);
    for (const instance of record.scene.instances) {
      if (!catalog.releases.some(r => r.id === instance.release))
        throw new RoomError("missing_release", instance.id + " needs the exact release " + instance.release, "Restore this release to the installation before opening the room.");
    }
    return record;
  };
  const change = db.transaction((id: string, wire: RoomWire) => {
    const current = read(id);
    try {
      const { record, result, recorded } = roomCommand(current, catalog, wire);
      if (recorded !== null) update.run(record.scene.version, JSON.stringify(record), id);
      return { scene: record.scene, receipt: { ok: true, version: record.scene.version, recorded, result } };
    } catch (e) {
      if (!(e instanceof RoomError)) throw e;
      return { scene: null, receipt: { ok: false, version: current.scene.version, error: e.wire() } };
    }
  });
  const run = (id: string, wire: RoomWire) => {
    const { scene, receipt } = change.immediate(id, wire);
    if (scene && receipt.recorded != null) publish(scene);
    return receipt;
  };

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url), path = url.pathname.replace(/\/$/, "");
    try {
      if (req.headers.has("origin") && req.headers.get("origin") !== url.origin) return fail(403, "origin", "Cross-origin room request refused.");
      if (path === "/api/health") return json({ ok: true, format: ROOM_SCHEMA, mode: "local" });
      if (path === "/api/catalog") return req.method === "GET" ? json({ releases: catalog.releases }) : method();
      if (path === "/api/commands") return req.method === "GET" ? json({ commands: roomCommands }) : method();
      if (req.method === "POST" && !path.endsWith("/mcp") && req.headers.get("x-synergon") !== "1") return fail(403, "header", "Supply the X-Synergon: 1 header.");
      if (path === "/api/workspaces") {
        if (req.method === "GET") {
          const q = (url.searchParams.get("search") ?? "").toLowerCase();
          const all = list.all().filter(r => r.name.toLowerCase().includes(q));
          const cursor = Math.max(0, Math.floor(Number(url.searchParams.get("cursor")) || 0));
          const limit = Math.max(1, Math.min(LIMITS.workspaceListMax, Number(url.searchParams.get("limit")) || LIMITS.workspaceListDefault));
          return json({ workspaces: all.slice(cursor, cursor + limit), total: all.length, next: cursor + limit < all.length ? String(cursor + limit) : null });
        }
        if (req.method !== "POST") return method();
        const data = await body(req);
        if (!obj(data) || Object.keys(data).some(k => k !== "name" && k !== "template") ||
          (data.template !== undefined && data.template !== "demo" && data.template !== "empty"))
          return fail(400, "invalid_args", "Create a room with name and optional template (empty or demo).");
        return json(create(cleanName(data.name, "Untitled room"), data.template ?? "empty"), 201);
      }
      const m = /^\/api\/workspaces\/([^/]+)(?:\/(state|command|live|mcp|discover))?$/.exec(path);
      if (!m || !isWorkspaceId(m[1])) throw missing();
      const [, id, action = "state"] = m;
      if (action === "state" || action === "live" || action === "discover") {
        if (req.method !== "GET") return method();
        const record = read(id);
        if (action === "discover") return json(roomCommand(record, catalog, { id: "discover", args: Object.fromEntries(url.searchParams) }).result);
        return action === "live" ? live(req, record.scene) : json(record.scene);
      }
      if (req.method !== "POST") return method();
      const data = await body(req);
      if (action === "mcp") { if (!get.get(id)) throw missing(); return roomMcp(data, wire => run(id, wire)); }
      if (!obj(data) || typeof data.id !== "string" || Object.keys(data).some(k => !["id", "args", "expectedVersion"].includes(k)))
        return fail(400, "invalid_command", "Send {id,args,expectedVersion?}.");
      return json(run(id, { id: data.id, args: data.args, expectedVersion: data.expectedVersion }));
    } catch (e) {
      if (e instanceof RequestError) return fail(e.status, e.code, e.message);
      if (e instanceof NameError) return fail(400, "invalid_name", e.message);
      if (e instanceof RoomError) return json({ ok: false, error: e.wire() }, ["unsupported_format", "invalid_scene", "missing_release"].includes(e.code) ? 422 : 400);
      console.error("room:", e);
      return fail(500, "internal", "The room request could not be completed.");
    }
  }
  return { fetch, close() { for (const stop of ends) stop(); db.close(); } };
}
