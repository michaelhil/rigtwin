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
import { PROJECT_BODY_BYTES } from "../shared/project.ts";
import { projectCommands } from "../shared/project-commands.ts";
import { ProjectError } from "./project-package.ts";
import { ProjectStore } from "./project-store.ts";
import { projectCommand, projectMcp } from "./project-api.ts";
import { roomMcp } from "./room-mcp.ts";

interface RoomApiOptions { dataDir: string; catalog: RoomCatalog; publicMode?: boolean; standardsPath?: string }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string, hint = "") => json({ ok: false, error: { code, message, hint } }, status);
const method = () => fail(405, "method", "Method unavailable for this route.");
const obj = (a: unknown): a is Record<string, unknown> => !!a && typeof a === "object" && !Array.isArray(a);
class RequestError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

async function body(req: Request, limit: number = LIMITS.bodyBytes): Promise<unknown> {
  if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw new RequestError(415, "content_type", "Send an application/json request body.");
  const reader = req.body?.getReader();
  if (!reader) throw new RequestError(400, "json", "Missing JSON body.");
  let length = 0, timedOut = false;
  const pieces: Uint8Array[] = [];
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, LIMITS.bodyTimeoutMs);
  try {
    for (;;) {
      const chunk = await reader.read().catch(() => {
        throw new RequestError(400, "interrupted", "The transfer was interrupted. Retry with the complete request.");
      });
      const { done, value } = chunk;
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

export function createRoomApi({ dataDir, catalog, publicMode = false, standardsPath }: RoomApiOptions) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, "rooms-v1.sqlite"), { create: true });
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");
  db.run("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, doc TEXT NOT NULL)");
  const get = db.query<{ doc: string }, [string]>("SELECT doc FROM rooms WHERE id=?");
  const list = db.query<{ id: string; name: string; version: number }, []>("SELECT id,name,version FROM rooms ORDER BY rowid DESC");
  const insert = db.query("INSERT INTO rooms (id,name,version,doc) VALUES (?,?,?,?)");
  const update = db.query("UPDATE rooms SET version=?, doc=? WHERE id=?");
  db.run("CREATE TABLE IF NOT EXISTS room_assessments (workspace TEXT PRIMARY KEY REFERENCES rooms(id), attachment TEXT NOT NULL)");
  const create = db.transaction((name: string, template: "empty" | "demo") => {
    if (publicMode && (db.query("SELECT count(*) AS n FROM rooms").get() as {n:number}).n >= LIMITS.workspacesMax)
      throw new RequestError(503,"full","The public workspace store is full.");
    const id = randomUUID(), record = newRoom(id, name, catalog, template);
    insert.run(id, name, 0, JSON.stringify(record));
    return { id, name, version: 0 };
  });
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
  const projects = publicMode ? undefined : new ProjectStore(dataDir, catalog, publish);
  const missing = () => new RequestError(404, "no_workspace", "Unknown room workspace.");
  const read = (id: string) => {
    const local = projects?.owns(id) ? projects.read(id) : undefined;
    const row = local ? null : get.get(id);
    if (!row && !local) throw missing();
    const record = local ?? parseRoom(row!.doc);
    for (const instance of record.scene.instances) {
      if (!catalog.releases.some(r => r.id === instance.release))
        throw new RoomError("missing_release", instance.id + " needs the exact release " + instance.release, "Restore this release to the installation before opening the room.");
    }
    return record;
  };
  const change = db.transaction((id: string, wire: RoomWire) => {
    const current = read(id);
    try {
      const { record, result, recorded } = roomCommand(current, catalog, wire, listeners.get(id)?.size ?? 0);
      if (recorded !== null) {
        if (projects?.owns(id)) projects.edit(id, () => record);
        else {
          const doc = JSON.stringify(record);
          if (publicMode && (record.scene.instances.length > 300 || Buffer.byteLength(doc) > 1024 * 1024))
            throw new RoomError("workspace_limit", "The public workspace reached its storage limit.", "Remove objects or continue in a local project.");
          update.run(record.scene.version, doc, id);
        }
      }
      return { scene: record.scene, receipt: { ok: true, version: record.scene.version, recorded, result } };
    } catch (e) {
      if (!(e instanceof RoomError)) throw e;
      return { scene: null, receipt: { ok: false, version: current.scene.version, error: e.wire() } };
    }
  });
  const run = async (id: string, wire: RoomWire) => {
    if (wire.id.startsWith("assessment.")) {
      const { assessmentCommand } = await import("./assessment.ts");
      // Reading, evaluating and saving form a single synchronous transaction after optional module loading.
      return db.transaction(() => {
        const record = read(id), owned = projects?.owns(id);
        const storage = {
          read: () => {
            if (owned) return projects!.readAssessment(id);
            const row = db.query<{attachment:string},[string]>("SELECT attachment FROM room_assessments WHERE workspace=?").get(id);
            return row ? JSON.parse(row.attachment) : undefined;
          },
          write: (attachment: unknown) => {
            if (owned) { projects!.writeAssessment(id, attachment); return; }
            const value = JSON.stringify(attachment);
            if (Buffer.byteLength(value) > 8 * 1024 * 1024) throw new RoomError("assessment_limit","Workspace assessment storage is full.","Export saved results and start another workspace.");
            db.query("INSERT INTO room_assessments(workspace,attachment) VALUES(?,?) ON CONFLICT(workspace) DO UPDATE SET attachment=excluded.attachment").run(id,value);
          },
        };
        try {
          const scene = owned ? { ...record.scene, id:projects!.portableId(id) } : record.scene;
          const result = assessmentCommand(scene,catalog,wire,storage,{ standardsPath,publicMode });
          return {ok:true,version:scene.version,recorded:null,result};
        } catch (e) {
          if (!(e instanceof RoomError)) throw e;
          return { ok:false,version:record.scene.version,error:e.wire() };
        }
      }).immediate();
    }
    const { scene, receipt } = change.immediate(id, wire);
    if (scene && receipt.recorded != null) publish(scene);
    return receipt;
  };

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url), path = url.pathname.replace(/\/$/, "");
    try {
      if (req.headers.has("origin") && req.headers.get("origin") !== url.origin) return fail(403, "origin", "Cross-origin room request refused.");
      if (path === "/api/health") return json({ ok: true, format: ROOM_SCHEMA, mode: publicMode ? "public" : "local" });
      if (path === "/api/catalog") return req.method === "GET" ? json({ releases: catalog.releases }) : method();
      if (path === "/api/commands") return req.method === "GET" ? json({ commands: roomCommands }) : method();
      if (req.method === "POST" && !path.endsWith("/mcp") && req.headers.get("x-synergon") !== "1") return fail(403, "header", "Supply the X-Synergon: 1 header.");
      if (path.startsWith("/api/projects") && projects) {
        if (path === "/api/projects") return req.method === "GET" ? json({projects:projects.list()}) : method();
        if (path === "/api/projects/commands") return req.method === "GET" ? json({commands:projectCommands}) : method();
        if (path === "/api/projects/command" || path === "/api/projects/mcp") {
          if (req.method !== "POST") return method();
          const data = await body(req,PROJECT_BODY_BYTES);
          return path.endsWith("/mcp") ? await projectMcp(projects,data) : json(await projectCommand(projects,data));
        }
      }
      if (path === "/api/workspaces") {
        if (req.method === "GET") {
          const q = (url.searchParams.get("search") ?? "").toLowerCase();
          const all = [...list.all(), ...projects?.listWorkspaces() ?? []].filter(r => r.name.toLowerCase().includes(q));
          const cursor = Math.max(0, Math.floor(Number(url.searchParams.get("cursor")) || 0));
          const limit = Math.max(1, Math.min(LIMITS.workspaceListMax, Number(url.searchParams.get("limit")) || LIMITS.workspaceListDefault));
          return json({ workspaces: all.slice(cursor, cursor + limit), total: all.length, next: cursor + limit < all.length ? String(cursor + limit) : null });
        }
        if (req.method !== "POST") return method();
        const data = await body(req);
        if (!obj(data) || Object.keys(data).some(k => k !== "name" && k !== "template") ||
          (data.template !== undefined && data.template !== "demo" && data.template !== "empty"))
          return fail(400, "invalid_args", "Create a room with name and optional template (empty or demo).");
        return json(create.immediate(cleanName(data.name, "Untitled room"), data.template ?? "empty"), 201);
      }
      const m = /^\/api\/workspaces\/([^/]+)(?:\/(state|command|live|mcp|discover|meta))?$/.exec(path);
      if (!m || !isWorkspaceId(m[1])) throw missing();
      const [, id, action = "state"] = m;
      if (action === "state" || action === "live" || action === "discover" || action === "meta") {
        if (req.method !== "GET") return method();
        const record = read(id);
        const liveConnections = listeners.get(id)?.size ?? 0;
        if (action === "meta") return json({id, name:record.scene.name, version:record.scene.version, liveConnections});
        if (action === "discover") return json(roomCommand(record, catalog, { id: "discover", args: Object.fromEntries(url.searchParams) },liveConnections).result);
        return action === "live" ? live(req, record.scene) : json(record.scene);
      }
      if (req.method !== "POST") return method();
      const data = await body(req);
      if (action === "mcp") { if (!projects?.owns(id) && !get.get(id)) throw missing(); return await roomMcp(data, wire => run(id, wire)); }
      if (!obj(data) || typeof data.id !== "string" || Object.keys(data).some(k => !["id", "args", "expectedVersion"].includes(k)))
        return fail(400, "invalid_command", "Send {id,args,expectedVersion?}.");
      return json(await run(id, { id: data.id, args: data.args, expectedVersion: data.expectedVersion }));
    } catch (e) {
      if (e instanceof ProjectError) return fail(e.status,e.code,e.message,e.hint);
      if (e instanceof RequestError) return fail(e.status, e.code, e.message);
      if (e instanceof NameError) return fail(400, "invalid_name", e.message);
      if (e instanceof RoomError) return json({ ok: false, error: e.wire() }, ["unsupported_format", "invalid_scene", "missing_release"].includes(e.code) ? 422 : 400);
      console.error("room:", e);
      return fail(500, "internal", "The room request could not be completed.");
    }
  }
  return { fetch, close() { for (const stop of ends) stop(); db.close(); } };
}
