// The synergon server: many public workspaces, each one a shared scene document (the pose and its last changes) with its
// history and undo, its live streams, command endpoint and agent (MCP) endpoint. The same code runs locally (mounted by
// tools/serve.ts next to the viewer, or on its own) and on the host (bundled as server/server.js inside the release, run by
// systemd behind Caddy, which maps /api/* to /api/*). The store of workspaces is server/workspaces.ts; the page is the viewer's.
//
//   GET  /api/health    {ok, revision, format, mode, uptime_s, asset: {name, sha256}}
//   GET  /api/commands  the command catalogue (shared/commands)
//
//   GET    /api/workspaces?search=&limit=&cursor=   {workspaces, next, total}, newest first
//   POST   /api/workspaces                          {name?} -> 201 {id, name, created, changed}; 429 rate_limited / 507 full
//   GET    /api/workspaces/<id>                     the record, or 404 no_workspace
//   PATCH  /api/workspaces/<id>                     {name}; every open stream of it gets the event "workspace"
//   DELETE /api/workspaces/<id>                     204; every open stream gets "deleted" and is closed; the folder is set aside
//   Writes (POST, PATCH, DELETE) need the header X-Synergon: 1; POST and PATCH a JSON body of at most 2 kB.
//
// And, for one workspace (<id>, a random UUID; anything else is 404 no_workspace before the disk is touched):
//   POST /api/workspaces/<id>/command   {id, args, expectedVersion?, group?, session?}, JSON, header X-Synergon: 1
//                       -> {ok: true, server, version, result} | {ok: false, server, version, error: {code, message, hint, schema?}}
//                       (HTTP 200 whenever the command was looked at; 4xx/5xx only for requests that never got that far)
//   GET  /api/workspaces/<id>/live      server-sent events: "session" {code, workspace, ...} first, then "snapshot" {doc} or the
//                       "applied" entries after Last-Event-ID (or ?since=<version>); "view" {id, args} only to the stream
//                       whose session code a view command names; "workspace" {record} after a rename and "deleted" {id} (the
//                       last event) after a delete; a ":hb" comment every 15 s; "end" {reason} as the last event of a stream
//                       the server ends by its byte budget (the page reconnects at once).
//                       ?session=<code> keeps a browser's code across reconnects (when it is free).
//   POST /api/workspaces/<id>/mcp       the same commands for agents over MCP (Streamable HTTP, tools only: adjust, look, measure,
//                       undo, state, person; server/mcp.ts); no X-Synergon header, a JSON content type and no foreign Origin
//   POST /api/workspaces/<id>/follow    {session, actor}: this page follows that caller's views (a look without a code reaches it);
//                       actor null stops; one caller per page
//   GET  /api/workspaces/<id>/trace     ?after=<n>: the last 100 trace records (one per request: who, what, how it ended, how long;
//                       server/trace.ts), also sent live as the event "trace"
//   POST /api/workspaces/<id>/picture   ?reply=<id>&session=<code>, image/jpeg: a browser's answer to `look {picture: true}`, only for a
//                       picture that is being waited for (the id is in the view event), at most 60 kB
// The addresses of the single shared scene (/api/live, /api/command, /api/mcp, /api/follow, /api/trace, /api/picture) are gone: 404.
// A local server also takes the word `playground` for <id>: the oldest workspace named "Playground" (so .mcp.json and the command
// line need no id on the laptop). A deployed server never does.
//
// Workspaces are loaded on their first request and written and dropped from memory after workspaceIdleMs without a stream or a
// request (at most workspacesLoaded at once, the least recently used goes first). The secret, the stream limits, the edit and
// query limits and the disk guard are global, not per workspace.
//
// Who: identify(req) gives the actor from the declared role (X-Synergon-Client: person | agent, otherwise a
// script; the role is only claimed) and an id the server makes: an HMAC, with a secret kept in the data
// folder, of the random id the client sends (X-Synergon-Client-Id; one per browser page or CLI run). The
// client's own id is never stored or sent to anyone, so it cannot be read off the live channel and reused.
// Every command reply names the caller's actor (`you`) and, for an edit, the version it recorded
// (`recorded`): a browser knows its own changes by those versions. authorize() allows everything in step 1.
// The only client-written text stored is the group name ([a-z0-9-], 40 characters at most) and a workspace's name.
//
// Run directly: bun server/server.ts [--port 4173] [--host 127.0.0.1] [--data <dir>] [--asset <dir>]
//   [--mode local|deployed] [--revision <rev>] [--release <link>]; prints {"listening": <port>} when ready.
//   In deployed mode the release is the real path of the folder above this file's folder (Bun gives a
//   script its real path, so /srv/synergon/current/server/server.js arrives as .../releases/<name>/server/
//   server.js); the asset is <release>/asset, the revision <release>/version.json. The link watched is
//   --release, or else <root>/current when the release lies in <root>/releases/ (the deploy's layout); the
//   server exits when that link points at another release, and at start when it already does.
//
// Mounting `createApi(...).fetch` in another Bun.serve (tools/serve.ts, a test proxy): set
// `idleTimeout: LIMITS.idleTimeoutS`. Bun's default of 10 s ends a quiet live stream before its first
// heartbeat (15 s); measured on Bun 1.4.0.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, statfsSync, writeSync } from "node:fs";
import { visitorKey, blockKey, RateWindow, LOCAL_HOSTS } from "./http-guards.ts";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { LIMITS, type Limits } from "./limits.ts";
import { assetFromFiles, runCommand, SESSION_ALPHABET, SESSION_PATTERN } from "../shared/commands/core.ts";
import { get, list as list_, type AssetInfo } from "../shared/commands/registry.ts";
import { entriesAfter, newDoc, parseDoc, reconcile, SCENE_FORMAT, type Actor, type SceneDoc } from "../shared/commands/doc.ts";
import type { CommandError } from "../shared/commands/schema.ts";
import { ownWords } from "../shared/commands/intent.ts";     // also registers adjust, look, measure, undo, state and the person's commands
import { defaultPerson } from "../shared/commands/person.ts";
import { readPackage, type People, type PersonPackage } from "../shared/person-model.ts";
import { instructions as agentInstructions } from "../shared/commands/agent-docs.ts";
import { createMcp } from "./mcp.ts";
import { DEFAULT_NAME, NameError, PLAYGROUND, cleanName, isWorkspaceId, openStore, workspaceDir, writeFileAtomic, type Store, type Workspace } from "./workspaces.ts";
import { createTrace, summarize } from "./trace.ts";

export interface ApiOptions {
  dataDir: string; assetDir: string; mode: "local" | "deployed"; revision: string;
  /** deployed: the release folder as started (`/srv/synergon/current`, a link); watched for a new release */
  releaseDir?: string;
  /** the person's packages (assets/manikin/ locally, <release>/asset/manikin/ deployed); default: the first of those two next to
   *  the asset folder that exists. null: no person. */
  personDir?: string | null;
  /** other limits (tests) */
  limits?: Partial<Limits>;
  /** called when `releaseDir` no longer points at the release we started from (default: exit, systemd starts the new one) */
  onReleaseChange?: () => void;
  otherStreams?: () => Iterable<StreamPlace>;
}

const KIND_LABEL = { person: "Person", agent: "Claude Code", script: "Script" } as const;
/** The actor of a request: declared role and random id, label made by the server. */
export function identify(req: Request, secret: Buffer): Actor {
  const role = req.headers.get("x-synergon-client"), kind = role === "person" || role === "agent" ? role : "script";
  const given = req.headers.get("x-synergon-client-id"), raw = given && /^[0-9a-f]{8,64}$/.test(given) ? given : randomBytes(16).toString("hex");
  const id = createHmac("sha256", secret).update(raw).digest("hex").slice(0, 12);
  return { kind, id, label: `${KIND_LABEL[kind]} · ${id.slice(0, 4)}` };
}
/** The one place that decides who may run what. Step 1 (open sandbox): everything. */
export function authorize(_actor: Actor, _command: string): CommandError | null { return null; }

/** The body as bytes, or why not: larger than `max`, slower than `ms`, or the client went away. */
async function readBytes(req: Request, max: number, ms: number): Promise<Uint8Array | "too_large" | "too_slow" | "aborted"> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return "too_large";
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader(), parts: Uint8Array[] = [], end = Date.now() + ms;
  let n = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((r) => { timer = setTimeout(() => r("late"), Math.max(0, end - Date.now())); });
      const got = await Promise.race([reader.read(), late]);
      clearTimeout(timer);
      if (got === "late") { reader.cancel().catch(() => {}); return "too_slow"; }
      if (got.done) break;
      n += got.value.byteLength;
      if (n > max) { reader.cancel().catch(() => {}); return "too_large"; }
      parts.push(got.value);
    }
  } catch { return "aborted"; }
  return new Uint8Array(Buffer.concat(parts));
}
/** The body as text (see readBytes). */
async function readBody(req: Request, max: number, ms: number): Promise<string | "too_large" | "too_slow" | "aborted"> {
  const b = await readBytes(req, max, ms);
  return typeof b === "string" ? b : new TextDecoder().decode(b);
}

const sse = (name: string, data: unknown, id?: number) => `${id !== undefined ? `id: ${id}\n` : ""}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The person's packages in a folder (operator-m, operator-f, clay-m, clay-f, whichever are there), read once per process and
 *  folder while their manifests stay the same (tests start many servers). null when none can be read. */
const peopleRead = new Map<string, { stamp: string; people: People | null }>();
export function loadPeople(dir: string): People | null {
  const ids = ["operator-m", "operator-f", "clay-m", "clay-f"], file = (id: string) => join(dir, id, `${id}.avatar.json`);
  const stamp = ids.map((id) => { try { const st = statSync(file(id)); return `${st.mtimeMs}:${st.size}`; } catch { return "-"; } }).join();
  const had = peopleRead.get(dir);
  if (had?.stamp === stamp) return had.people;
  const packages: Record<string, PersonPackage> = {};
  for (const id of ids) {
    if (!existsSync(file(id))) continue;
    try {
      const d = join(dir, id), m = JSON.parse(readFileSync(file(id), "utf8")), poses = m.posesFile && existsSync(join(d, m.posesFile)) ? JSON.parse(readFileSync(join(d, m.posesFile), "utf8")) : undefined;
      packages[id] = readPackage(id, m, new Uint8Array(readFileSync(join(d, m.glb))), poses);
    } catch (e: any) { console.error(`person package ${id} not read: ${e.message}`); }
  }
  const dp = defaultPerson(packages), people = dp ? { packages, defaultPerson: dp } : null;
  peopleRead.set(dir, { stamp, people });
  return people;
}


/** One open live stream (of one workspace). */
export interface StreamPlace { visitor: string; block: string }
interface Stream { code: string; visitor: string; block: string; send(chunk: Uint8Array): void; close(why?: "slow" | "spent"): void }
type Pending = { ws: string; codes: string[]; exclusive: boolean; visitor: string; done(b: Uint8Array | null, pageMs?: number): void };
type Reply = { status: number; body: Record<string, any> };
type Note = { picture?: { bytes: number; wait_ms: number; page_ms?: number } | null; entry?: any };
const mime = (req: Request) => (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
/** The addresses of the one shared scene before workspaces: they answer 404 with a hint. */
const OLD_ADDRESSES = new Set(["/api/live", "/api/command", "/api/mcp", "/api/follow", "/api/trace", "/api/picture"]);
/** A local server takes this word for the Playground, so that .mcp.json and the command line need no id on the laptop. */
export const LOCAL_ALIAS = "playground";

export function createApi(opts: ApiOptions) {
  const L: Limits = { ...LIMITS, ...opts.limits }, deployed = opts.mode === "deployed", started = Date.now(), enc = new TextEncoder();
  mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
  // the secret behind the author ids: made at the first start, kept in the data folder (never in a release)
  const secretFile = join(opts.dataDir, "secret");
  if (!existsSync(secretFile)) { const fd = openSync(secretFile, "wx", 0o600); writeSync(fd, randomBytes(32).toString("hex")); closeSync(fd); }
  const secret = Buffer.from(readFileSync(secretFile, "utf8").trim(), "hex");
  if (secret.length < 32) throw new Error(`${secretFile} is not a 32-byte secret`);

  // ---- the person's packages: their manifests and the skeletons in their GLBs' JSON chunks (read once; the meshes and
  // textures are the page's). Without them the person's commands answer no_person and the document has nobody in the seat.
  const personDir = opts.personDir !== undefined ? opts.personDir : [join(opts.assetDir, "manikin"), resolve(opts.assetDir, "..", "..", "manikin")].find((d) => existsSync(join(d, "operator-m")) || existsSync(join(d, "operator-f"))) ?? null;
  const people = personDir ? loadPeople(personDir) : null;

  // ---- the asset (re-read when its description file changes; locally a rebuild may happen while we run)
  let asset: AssetInfo, assetStamp = "";
  function loadAsset(): boolean {
    const name = readdirSync(opts.assetDir).find((f) => f.endsWith(".manifest.json"));
    if (!name) throw new Error(`no *.manifest.json in ${opts.assetDir}`);
    const file = join(opts.assetDir, name), st = statSync(file), stamp = `${file}:${st.mtimeMs}:${st.size}`;
    if (stamp === assetStamp) return false;
    const manifest = JSON.parse(readFileSync(file, "utf8")), glb = new Uint8Array(readFileSync(join(opts.assetDir, manifest.glb.file)));
    if (createHash("sha256").update(glb).digest("hex") !== manifest.glb.sha256) throw new Error("the GLB does not match its description file (a build is being written?)");
    asset = { ...assetFromFiles(manifest, glb), people };
    assetStamp = stamp;
    return true;
  }
  loadAsset();

  // ---- the workspaces: the index and the folders (server/workspaces.ts). On a data folder with none, the Playground is made:
  // from the scene a server before workspaces left in <data>/playground/doc.json when it can be read, else an empty one.
  const store = openStore(opts.dataDir);
  if (store.count() === 0) {
    let old: SceneDoc | undefined;
    try { const f = join(opts.dataDir, "playground", "doc.json"); if (existsSync(f)) old = parseDoc(JSON.parse(readFileSync(f, "utf8"))); } catch { old = undefined; }
    store.create(PLAYGROUND, old);
  }

  // ---- deployed guards (PLAN-v7 D1), global: the same for every workspace
  const edits = new RateWindow(L.editsPerMinutePerVisitor, 60_000), editsAll = new RateWindow(L.editsPerSecondTotal, 1_000), queries = new RateWindow(L.queriesPerMinutePerVisitor, 60_000);
  const editsBlock = new RateWindow(L.editsPerSecondPerBlock, 1_000), unknownSessions = new RateWindow(L.unknownSessionsPerMinutePerVisitor, 60_000);
  const createsVisitor = new RateWindow(L.workspacesPerHourPerVisitor, 3_600_000), createsBlock = new RateWindow(L.workspacesPerHourPerBlock, 3_600_000), createsDay = new RateWindow(L.workspacesPerDayTotal, 86_400_000);
  /** questions put to every page, per caller (consent) */
  const asks = new RateWindow(L.asksPerMinutePerCaller, 60_000);
  const sweeper = setInterval(() => { for (const w of [edits, editsAll, queries, editsBlock, unknownSessions, asks, createsVisitor, createsBlock, createsDay]) w.sweep(); }, 60_000);
  function diskLow() {
    try { const s = statfsSync(opts.dataDir), free = s.bavail * s.bsize, total = s.blocks * s.bsize; return free < L.diskMinFreeBytes || free / total < L.diskMinFreeFraction; }
    catch { return false; }
  }

  // ---- live streams: every open one of every workspace counts against the same limits
  const allStreams = new Set<Stream>();
  /** deployed: streams ended by their byte budget, whose connection may still hold their last bytes in socket buffers; each keeps
   *  its place in the stream limits until its connection is gone (Bun ends a stalled one after idleTimeoutS) or streamDrainMs */
  const draining = new Set<{ visitor: string; block: string }>();
  /** pictures being waited for (look {picture: true}), by the reply id sent with the view event */
  const pending = new Map<string, Pending>();

  const server = () => ({ mode: opts.mode, revision: opts.revision });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  /** an error that belongs to no scene document (the workspaces' own API) */
  const err = (status: number, code: string, message: string, hint: string) => json({ ok: false, server: server(), error: { code, message, hint } }, status);
  const noWorkspace = () => err(404, "no_workspace", "there is no workspace with this address", "open the list of workspaces and pick one, or make a new one");

  /** One workspace in memory: its document, history, streams, trace, followers and agent endpoint. */
  function openScene(first: Workspace) {
    let w = first;
    const dir = workspaceDir(opts.dataDir, w.id), docFile = join(dir, "doc.json");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // a new workspace has the default person in the seat (when the person's packages are here); stored documents of an
    // earlier format are converted once by the cutover script (shared/commands/scene-upgrade.ts), not here
    let doc: SceneDoc = newDoc(asset, people?.defaultPerson ?? null), fromDisk = false;
    if (existsSync(docFile)) {
      try { doc = parseDoc(JSON.parse(readFileSync(docFile, "utf8"))); fromDisk = true; }
      catch (e: any) { const aside = `${docFile}.unreadable-${Date.now()}`; renameSync(docFile, aside); console.error(`doc.json of workspace ${w.id} could not be read (${e.message}); kept as ${aside}, starting an empty scene`); }
    }
    let gone = false, edited = false, saveTimer: ReturnType<typeof setTimeout> | undefined, lastSave = 0, snap: Uint8Array | null = null;
    /** doc.json, written atomically: a temporary file, flushed to disk, renamed over the old one. */
    function write() {
      clearTimeout(saveTimer); saveTimer = undefined; lastSave = Date.now();
      if (gone) return;
      writeFileAtomic(docFile, JSON.stringify(doc));
      if (edited) { edited = false; store.touch(w.id); }
    }
    /** Write now, or (when the last write is younger than saveEveryMs) once that time is up. */
    function save() {
      snap = null; edited = true;
      if (saveTimer) return;
      const wait = lastSave + L.saveEveryMs - Date.now();
      if (wait <= 0) { try { write(); } catch (e: any) { console.error(`doc.json not written: ${e.message}`); } }
      else saveTimer = setTimeout(() => { try { write(); } catch (e: any) { console.error(`doc.json not written: ${e.message}`); } }, wait);
    }
    /** the snapshot event of the current document, serialised once per change (security review S8) */
    const snapshotBytes = () => (snap ??= enc.encode(sse("snapshot", { doc }, doc.version)));
    const reconciled = reconcile(doc, asset);
    if (!fromDisk || reconciled) write();

    const streams = new Map<string, Stream>();
    const broadcast = (chunk: string | Uint8Array) => { const b = typeof chunk === "string" ? enc.encode(chunk) : chunk; for (const s of streams.values()) s.send(b); };
    const newCode = () => { for (;;) { const b = randomBytes(8), c = [...b].map((x) => SESSION_ALPHABET[x % SESSION_ALPHABET.length]).join(""); if (!streams.has(c)) return c; } };
    /** pages that follow a caller's views (POST follow): caller id -> session codes. A look without a code goes to them. */
    const followers = new Map<string, Set<string>>();
    // ---- the trace: one record per request, to every open page of this workspace (server/trace.ts)
    const trace = createTrace({ publicMode: deployed, send: (rec) => broadcast(sse("trace", rec)), allow: (s) => ownWords(asset, s) });

    const fail = (status: number, code: string, message: string, hint: string) => json({ ok: false, server: server(), version: doc.version, error: { code, message, hint } }, status);
    const reply = (status: number, code: string, message: string, hint: string): Reply => ({ status, body: { ok: false, server: server(), version: doc.version, error: { code, message, hint } } });

    function live(req: Request, url: URL, visitor: string): Response {
      if (deployed) {
        const places = [...allStreams, ...draining, ...(opts.otherStreams?.() ?? [])];
        if (places.length >= L.streamsTotal) return fail(503, "too_many_streams", `the server has its maximum of ${L.streamsTotal} live connections`, "try again later");
        if (places.filter((s) => s.visitor === visitor).length >= L.streamsPerVisitor) return fail(429, "too_many_streams", `at most ${L.streamsPerVisitor} live connections per visitor`, "close another tab of the viewer");
        if (places.filter((s) => s.block === blockKey(visitor)).length >= L.streamsPerBlock) return fail(429, "too_many_streams", `at most ${L.streamsPerBlock} live connections per network block`, "try again later");
      }
      const want = url.searchParams.get("session"), code = want && new RegExp(SESSION_PATTERN).test(want) && !streams.has(want) ? want : newCode();
      const lastRaw = req.headers.get("last-event-id") ?? url.searchParams.get("since"), last = lastRaw !== null && /^\d{1,15}$/.test(lastRaw) ? Number(lastRaw) : null;
      let ctrl!: ReadableStreamDefaultController<Uint8Array>, closed = false, sent = 0;
      const stream: Stream = {
        code, visitor, block: blockKey(visitor),
        // a stream whose reader has fallen 1 MB behind is ended at once, its queue dropped; deployed, a stream is also ended (after
        // its last bytes) once it has been given streamBytesMax bytes in all, read or not, which bounds what the kernel's socket
        // buffers can hold for it (host check H14). Either way the browser reconnects with since=<version> and catches up.
        send(chunk) {
          if (closed) return;
          try { ctrl.enqueue(chunk); sent += chunk.byteLength; if ((ctrl.desiredSize ?? 0) < 0) stream.close("slow"); else if (deployed && sent >= L.streamBytesMax) stream.close("spent"); }
          catch { stream.close(); }
        },
        close(why) {
          if (closed) return; closed = true; if (streams.get(code) === stream) streams.delete(code); allStreams.delete(stream);
          if (why === "spent") {
            const place = { visitor, block: stream.block }, free = () => { clearTimeout(t); draining.delete(place); }, t = setTimeout(free, L.streamDrainMs);
            (t as any).unref?.(); draining.add(place); req.signal?.addEventListener("abort", free, { once: true });
            try { ctrl.enqueue(enc.encode(sse("end", { reason: "budget" }))); } catch { /* closed */ }      // the page reconnects at once
          }
          try { if (why === "slow") ctrl.error(new Error("the client does not read its live stream")); else ctrl.close(); } catch { /* already closed */ }
        },
      };
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          ctrl = c;
          const later = last !== null && doc.version - last <= L.snapshotBehind ? entriesAfter(doc, last) : null;
          const first = [enc.encode([`retry: ${L.retryMs}\n\n`, sse("session", { code, mode: opts.mode, revision: opts.revision, format: SCENE_FORMAT, workspace: w }), ...(later ?? []).map((e) => sse("applied", e, e.version))].join("")), ...(later ? [] : [snapshotBytes()])];
          for (const b of first) { c.enqueue(b); sent += b.byteLength; }
          if (deployed && sent >= L.streamBytesMax) stream.close("spent");
        },
        cancel() { stream.close(); },
      }, { highWaterMark: L.streamQueueBytes, size: (chunk) => chunk?.byteLength ?? 0 });
      if (!closed) { streams.set(code, stream); allStreams.add(stream); }              // (a first chunk larger than the byte budget has ended it already)
      req.signal?.addEventListener("abort", () => stream.close());
      return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
    }

    async function command(req: Request, visitor: string): Promise<Response> {
      if (req.headers.get("x-synergon") !== "1") return fail(400, "bad_request", "a command needs the header X-Synergon: 1", "send the header X-Synergon: 1 (bun run rig does)");
      if (mime(req) !== "application/json") return fail(415, "bad_request", "a command is sent as JSON", "send Content-Type: application/json");
      const text = await readBody(req, deployed ? L.bodyBytes : Number.POSITIVE_INFINITY, L.bodyTimeoutMs);
      if (text === "too_large") return fail(413, "too_large", `a command is at most ${L.bodyBytes / 1024} kB`, "send a smaller command");
      if (text === "too_slow") return fail(408, "too_slow", `the command did not arrive within ${L.bodyTimeoutMs / 1000} s`, "send it again");
      if (text === "aborted") return fail(400, "bad_request", "the request was broken off", "send it again");
      let wire: unknown;
      try { wire = JSON.parse(text); } catch { return fail(400, "bad_json", "the body is not valid JSON", "send {\"id\": \"<command>\", \"args\": {...}}"); }
      if (!isObject(wire)) return fail(400, "bad_json", "the body is not a JSON object", "send {\"id\": \"<command>\", \"args\": {...}}");
      const r = await exec(identify(req, secret), visitor, wire);
      return json(r.body, r.status);
    }

    async function withRequest<T>(go: () => Promise<T>): Promise<T> {
      sc.busy++;
      try { return await go(); }
      finally { sc.busy--; sc.lastUsed = performance.now(); }
    }

    // ---- one command for an actor: the HTTP endpoint and the MCP tools both come here
    /** One request, timed and traced. */
    async function exec(you: Actor, visitor: string, wire: Record<string, unknown>, via: "mcp" | "http" = "http"): Promise<Reply> {
      const at = Date.now(), t0 = performance.now(), note: Note = {};
      if (gone) return reply(404, "not_found", "this workspace no longer exists", "Choose an existing workspace.");
      const r = await run(you, visitor, wire, note, via);
      try {
        trace.record({ at, ms: performance.now() - t0, you, via, command: String(wire.id ?? "?").slice(0, 40), args: wire.args,
          ok: r.body.ok === true, result: r.body.result, error: r.body.error, entry: note.entry, picture: note.picture });
      } catch (e: any) { console.error("trace:", e?.message ?? e); }
      return r;
    }
    async function run(you: Actor, visitor: string, wire: Record<string, unknown>, note: Note, via: "mcp" | "http"): Promise<Reply> {
      const kind = get(String(wire.id))?.kind ?? "query";
      if (deployed) {
        if (kind === "query" ? via === "http" && !queries.hit(visitor) : !edits.hit(visitor)) return reply(429, "rate_limited", kind === "query" ? `at most ${L.queriesPerMinutePerVisitor} queries a minute per visitor` : `at most ${L.editsPerMinutePerVisitor} changes a minute per visitor`, "wait a minute and send fewer commands");
        if (kind !== "query" && !editsBlock.hit(blockKey(visitor))) return reply(429, "rate_limited", `at most ${L.editsPerSecondPerBlock} changes a second per network block`, "try again in a moment");
        if (kind !== "query" && !editsAll.hit("all")) return reply(429, "rate_limited", `the server takes at most ${L.editsPerSecondTotal} changes a second`, "try again in a moment");
        if (kind === "view" && wire.session !== undefined && unknownSessions.count(visitor) >= L.unknownSessionsPerMinutePerVisitor) return reply(429, "rate_limited", `too many unknown session codes (${L.unknownSessionsPerMinutePerVisitor} a minute)`, "Copy the browser code in Settings → Agent access and try it again in a minute.");
        if (kind === "edit" && diskLow()) return reply(507, "disk_full", "the server's disk is nearly full, so changes are refused", "tell the owner of the server");
      }
      const denied = authorize(you, String(wire.id));
      if (denied) return { status: 200, body: { ok: false, server: server(), version: doc.version, you, error: denied } };
      const followed = [...(followers.get(you.id) ?? [])].flatMap((code) => {
        const stream = streams.get(code);
        return stream ? [stream] : [];
      });
      const scope = {
        workspace: { id: w.id, name: w.name },
        viewers: { liveConnections: streams.size, followingThisCaller: followed.length, unpairedRoute: deployed ? "consent" as const : "local" as const },
      };
      const out = runCommand({ doc, asset, scope }, you, wire as any);
      let result: any = out.ok ? out.result : undefined;
      if (out.ok && out.view) {
        const v = out.view, one = v.session ? streams.get(v.session) : undefined;
        const route = v.session ? "paired" : !deployed ? "local" : followed.length ? "followers" : "approval";
        const targets = route === "paired" ? (one ? [one] : []) : route === "followers" ? followed : [...streams.values()];
        if (!targets.length) {
          if (v.session) {
            unknownSessions.hit(visitor);
            return reply(200, "unknown_session", "The paired browser is no longer connected to this workspace.",
              "Open the same workspace and copy a fresh browser code in Settings → Agent access.");
          }
          return deployed
            ? reply(200, "needs_viewer", "There is no live connection in this workspace.", "Ask the owner to open the workspace, then send look again.")
            : reply(200, "no_viewer", "There is no live connection in this workspace.", "Open the workspace in the local viewer.");
        }
        const asking = route === "approval";
        if (asking && !asks.hit(you.id)) return reply(429, "rate_limited", "This caller reached its browser approval request limit.",
          "Wait a minute or use the browser code in Settings → Agent access.");
        let wait: Promise<{ b: Uint8Array; pageMs?: number } | null> | null = null, replyId: string | undefined;
        const waitStart = performance.now(), timeoutMs = asking ? L.pictureAskWaitMs : L.pictureWaitMs;
        if (v.args.picture) {
          const codes = targets.map((stream) => stream.code);
          const mine = [...pending.values()].filter((p) => p.visitor === visitor).length, ofPage = [...pending.values()].filter((p) => p.ws === w.id && p.exclusive && !asking && p.codes.some((c) => codes.includes(c))).length;
          if (pending.size >= L.picturesPending || (deployed && (mine >= L.picturesPerVisitor || ofPage >= 1))) return reply(429, "rate_limited", `at most ${L.picturesPerVisitor} pictures per visitor and one per browser are waited for at once`, "wait for the picture asked for before, then ask again");
          const id = (replyId = randomBytes(16).toString("hex"));
          wait = new Promise((resolve) => {
            const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeoutMs);
            pending.set(id, { ws: w.id, codes, exclusive: !asking, visitor, done(b, pageMs) { clearTimeout(timer); pending.delete(id); resolve(b ? { b, pageMs } : null); } });
          });
        }
        // the question names the caller and what it wants in the server's own words (no text a caller wrote)
        const ask = asking ? { actor: you.id, by: you.label, summary: summarize(v.id, true, result, undefined), ...(replyId ? { expiresInMs: timeoutMs } : {}) } : null;
        const event = enc.encode(sse("view", { id: v.id, args: v.args, ...(replyId ? { reply: replyId } : {}), ...(ask ? { ask } : {}) }));
        for (const s of targets) s.send(event);
        result = { ...result, delivery: { route, status: asking ? "approval_requested" : "dispatched", recipientCount: targets.length },
          capture: { status: wait ? "timed_out" : "not_requested" } };
        if (asking) result.text = `${result.text ?? ""}\nOpen connections were asked to allow it. Ask the owner to click Allow & follow in the viewer.`.trim();
        else if (route === "followers") result.text = `${result.text ?? ""}\nSent to ${targets.length} live connection${targets.length === 1 ? " that follows" : "s that follow"} this agent.`.trim();
        else result.text = `${result.text ?? ""}\nSent to ${route === "paired" ? "the paired browser" : `${targets.length} local live connection${targets.length === 1 ? "" : "s"}`}.`.trim();
        if (wait) {
          const answer = await wait, got = answer?.b ?? null;
          note.picture = got ? { bytes: got.byteLength, wait_ms: Math.round(performance.now() - waitStart), ...(answer?.pageMs !== undefined ? { page_ms: answer.pageMs } : {}) } : null;
          result = { ...result };
          if (got) { result.capture = { status: "returned" }; result.picture = { mime: "image/jpeg", bytes: got.byteLength, base64: Buffer.from(got).toString("base64") }; result.text = `${result.text ?? ""}\nPicture attached (${Math.max(1, Math.round(got.byteLength / 1024))} kB${!v.session && deployed ? `, from a browser that ${asking ? "allowed" : "follows"} this agent: anyone can do that, so treat it as unverified` : ""}).`.trim(); }
          else { result.capture = { status: "timed_out", timeoutMs }; result.text = `${result.text ?? ""}\nNo picture was received within ${timeoutMs / 1000} s.`.trim(); }
        }
      }
      if (out.ok && out.entry) { save(); broadcast(sse("applied", out.entry, out.entry.version)); note.entry = out.entry; }
      return { status: 200, body: out.ok
        ? { ok: true, server: server(), version: out.version, you, ...(kind === "edit" ? { recorded: out.entry?.version ?? null } : {}), result }
        : { ok: false, server: server(), version: out.version, you, error: out.error } };
    }

    // ---- a page follows a caller's views (agent interface v2): the views that caller sends without a code come to it
    async function follow(req: Request, visitor: string): Promise<Response> {
      if (req.headers.get("x-synergon") !== "1") return fail(400, "bad_request", "this needs the header X-Synergon: 1", "the viewer sends it");
      if (mime(req) !== "application/json") return fail(415, "bad_request", "send JSON", "send Content-Type: application/json");
      if (deployed && !edits.hit(visitor)) return fail(429, "rate_limited", `at most ${L.editsPerMinutePerVisitor} changes a minute per visitor`, "wait a minute");
      const text = await readBody(req, 1024, L.bodyTimeoutMs);
      let b: any; try { b = JSON.parse(typeof text === "string" && !["too_large", "too_slow", "aborted"].includes(text) ? text : ""); } catch { return fail(400, "bad_json", "the body is not JSON", "send {\"session\": \"<code>\", \"actor\": \"<id>\" or null}"); }
      const code = typeof b?.session === "string" ? b.session : "", actor = b?.actor ?? null;
      if (!streams.has(code)) return fail(404, "unknown_session", "no page with this code is connected", "the page sends its own code");
      if (actor !== null && !(typeof actor === "string" && /^[0-9a-f]{12}$/.test(actor))) return fail(400, "bad_request", "actor is a caller's id from the trace, or null to stop", "click Follow on the activity line");
      for (const [a, set] of followers) { set.delete(code); if (!set.size) followers.delete(a); }      // one caller per page
      if (actor) {
        let set = followers.get(actor);
        if (!set) { if (followers.size >= L.streamsTotal) followers.delete(followers.keys().next().value!); followers.set(actor, (set = new Set())); }
        if (set.size >= 10) set.delete(set.values().next().value!);
        set.add(code);
      }
      return json({ ok: true, server: server(), following: actor });
    }

    // ---- a browser's picture for a look that waits for it
    async function picture(req: Request, url: URL): Promise<Response> {
      if (req.headers.get("x-synergon") !== "1") return fail(400, "bad_request", "a picture needs the header X-Synergon: 1", "the viewer sends it");
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("image/jpeg")) return fail(415, "bad_request", "a picture is sent as image/jpeg", "send Content-Type: image/jpeg");
      const id = url.searchParams.get("reply") ?? "", p = /^[0-9a-f]{32}$/.test(id) ? pending.get(id) : undefined;
      if (!p || p.ws !== w.id) return fail(404, "not_asked", "no picture is being waited for with this id", "a picture is sent only in answer to a look command, within a few seconds");
      if (!p.codes.includes(url.searchParams.get("session") ?? "")) return fail(403, "wrong_session", "this picture was asked of another browser", "only the page with that code answers");
      const b = await readBytes(req, L.pictureBytes, L.bodyTimeoutMs);
      if (typeof b === "string") return fail(b === "too_large" ? 413 : 400, b === "too_large" ? "too_large" : "bad_request", b === "too_large" ? `a picture is at most ${L.pictureBytes / 1024} kB` : "the picture did not arrive", "send a smaller JPEG");
      if (b.byteLength < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return fail(400, "bad_picture", "the body is not a JPEG", "send the picture as image/jpeg");
      if (pending.get(id) !== p) return fail(404, "not_asked", "this picture was answered or expired", "Ask for a new picture if needed.");
      const pageMs = Number(req.headers.get("x-synergon-ms") ?? NaN);
      p.done(b, Number.isFinite(pageMs) && pageMs >= 0 && pageMs < 60_000 ? Math.round(pageMs) : undefined);
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }

    // ---- MCP (agent interface v2): the same tools, bound to this workspace by the address
    const mcp = createMcp({
      exec: async (you, wire, visitor) => (await exec(you, visitor, wire as any, "mcp")).body as any,
      onConnect: (you) => trace.record({ at: Date.now(), ms: 0, you, via: "mcp", command: "connect", args: {}, ok: true, result: { text: "connected over MCP" } }),
      secret, instructions: () => agentInstructions(opts.mode), revision: opts.revision, maxSessions: L.mcpSessions,
    });
    /** an Origin a page of this server would send: exactly https://mightwork.ai deployed, exactly http://<Host> locally */
    const ownOrigin = (origin: string, req: Request) => (deployed ? origin === "https://mightwork.ai" : origin === `http://${req.headers.get("host") ?? ""}`);
    async function mcpPost(req: Request, visitor: string): Promise<Response> {
      const origin = req.headers.get("origin");
      if (origin && !ownOrigin(origin, req)) return fail(403, "bad_origin", "the MCP endpoint answers only to MCP clients, not to other web pages", "connect from an MCP client such as Claude Code");
      if (mime(req) !== "application/json") return fail(415, "bad_request", "an MCP request is sent as JSON", "send Content-Type: application/json");
      if (deployed && !queries.hit(visitor)) return fail(429, "rate_limited", `at most ${L.queriesPerMinutePerVisitor} requests a minute per visitor`, "wait a minute");
      const text = await readBody(req, deployed ? L.bodyBytes : Number.POSITIVE_INFINITY, L.bodyTimeoutMs);
      if (text === "too_large" || text === "too_slow" || text === "aborted") return fail(text === "too_large" ? 413 : 400, text, "the request could not be read", "send it again, smaller");
      let body: unknown;
      try { body = JSON.parse(text); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error: the body is not JSON" } }, { status: 400 }); }
      if (gone) return fail(404, "not_found", "this workspace no longer exists", "Choose an existing workspace.");
      return await mcp.handle(req, body, visitor);
    }

    /** Retry dirty writes, including a write whose timer has already fired and failed. */
    function flush(): boolean {
      if (!edited) return true;
      try { write(); return true; }
      catch (e: any) { console.error(`doc.json not written: ${e.message}`); return !edited; }
    }
    const sc = {
      id: w.id, busy: 0, lastUsed: performance.now(),
      record: () => w, streams, live, command, follow, picture, mcpPost, withRequest, mcpEnd: (sid: string | null) => mcp.end(sid), flush,
      traces: (after: number) => trace.recent(after), version: () => doc.version, fail,
      /** the asset was rebuilt (local): bring the pose into line and tell the pages */
      onAsset() { const e = reconcile(doc, asset); save(); if (e) broadcast(sse("applied", e, e.version)); },
      /** an empty scene again, sent to every open stream as a snapshot (tools only: not reachable over HTTP) */
      reset() { doc = newDoc(asset, people?.defaultPerson ?? null); write(); snap = null; broadcast(snapshotBytes()); },
      renamed(next: Workspace) { w = next; broadcast(sse("workspace", next)); },
      /** deleted: nothing more is written, every stream is told and closed, every picture waited for is given up */
      deleted() {
        gone = true; clearTimeout(saveTimer); saveTimer = undefined;
        broadcast(sse("deleted", { id: w.id }));
        for (const s of [...streams.values()]) s.close();
        for (const p of [...pending.values()]) if (p.ws === w.id) p.done(null);
      },
      /** leaves memory: what is pending is written, the streams (there are none when idle) are closed */
      dispose() { gone = true; for (const s of [...streams.values()]) s.close(); },
    };
    return sc;
  }
  type Scene = ReturnType<typeof openScene>;

  // ---- the workspaces in memory: loaded on the first request, dropped after workspaceIdleMs without a stream or a request, at most workspacesLoaded
  const scenes = new Map<string, Scene>();
  function refreshAsset() {
    if (deployed) return;                       // a release never changes under a running server
    try { if (loadAsset()) for (const s of scenes.values()) s.onAsset(); }
    catch { /* mid-build: keep the asset we have and look again next time */ }
  }
  const idle = (s: Scene) => s.streams.size === 0 && s.busy === 0;
  function drop(s: Scene, closing = false): boolean {
    if (!s.flush() && !closing) return false;
    scenes.delete(s.id); s.dispose(); return true;
  }
  /** The workspace in memory (loaded now when it is not), "busy" when none can make room, null when there is no such workspace. */
  function scene(id: string): Scene | "busy" | null {
    refreshAsset();
    const had = scenes.get(id);
    if (had) { had.lastUsed = performance.now(); return had; }
    const w = store.get(id);
    if (!w) return null;
    if (scenes.size >= L.workspacesLoaded) {
      const dropped = [...scenes.values()].filter(idle).sort((a, b) => a.lastUsed - b.lastUsed).some((s) => drop(s));
      if (!dropped) return "busy";
    }
    const s = openScene(w);
    scenes.set(id, s);
    return s;
  }
  const idleSweeper = setInterval(() => { const now = performance.now(); for (const s of [...scenes.values()]) if (idle(s) && now - s.lastUsed >= L.workspaceIdleMs) drop(s); }, L.workspaceSweepMs);

  // ---- the workspaces' own API
  const nameBody = async (req: Request): Promise<{ name?: unknown } | Response> => {
    if (req.headers.get("x-synergon") !== "1") return err(400, "bad_request", "this needs the header X-Synergon: 1", "the viewer sends it");
    if (mime(req) !== "application/json") return err(415, "bad_request", "send JSON", "send Content-Type: application/json");
    const text = await readBody(req, L.workspaceBodyBytes, L.bodyTimeoutMs);
    if (text === "too_large") return err(413, "too_large", `this request is at most ${L.workspaceBodyBytes / 1024} kB`, "send a shorter name");
    if (text === "too_slow") return err(408, "too_slow", `the request did not arrive within ${L.bodyTimeoutMs / 1000} s`, "send it again");
    if (text === "aborted") return err(400, "bad_request", "the request was broken off", "send it again");
    let b: unknown; try { b = JSON.parse(text); } catch { return err(400, "bad_json", "the body is not valid JSON", "send {\"name\": \"<a name>\"}"); }
    return isObject(b) ? b : err(400, "bad_json", "the body is not a JSON object", "send {\"name\": \"<a name>\"}");
  };
  const badName = (e: unknown) => (e instanceof NameError ? err(400, "bad_name", e.message, `a name is 1 to ${L.workspaceNameChars} characters of text`) : null);

  function list(url: URL): Response {
    const limit = url.searchParams.get("limit"), n = limit === null ? undefined : Number(limit);
    if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= L.workspaceListMax)) return err(400, "bad_request", `limit is a whole number from 1 to ${L.workspaceListMax}`, "leave it out for the default");
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && !/^[A-Za-z0-9_-]{1,32}$/.test(cursor)) return err(400, "bad_request", "cursor is the value of next from the last answer", "leave it out to start at the newest");
    return json(store.list({ search: url.searchParams.get("search") ?? "", limit: n ?? L.workspaceListDefault, cursor }));
  }
  async function create(req: Request, visitor: string): Promise<Response> {
    const b = await nameBody(req);
    if (b instanceof Response) return b;
    let name: string;
    try { name = cleanName(b.name, DEFAULT_NAME); } catch (e) { return badName(e) ?? err(400, "bad_name", "this name cannot be used", "send another"); }
    if (deployed) {
      const block = blockKey(visitor);
      if (createsVisitor.count(visitor) >= L.workspacesPerHourPerVisitor) return err(429, "rate_limited", `at most ${L.workspacesPerHourPerVisitor} new workspaces an hour per visitor`, "open one of the workspaces that exist, or try again in an hour");
      if (createsBlock.count(block) >= L.workspacesPerHourPerBlock) return err(429, "rate_limited", `at most ${L.workspacesPerHourPerBlock} new workspaces an hour per network block`, "try again in an hour");
      if (createsDay.count("all") >= L.workspacesPerDayTotal) return err(429, "rate_limited", `the server takes at most ${L.workspacesPerDayTotal} new workspaces a day`, "try again tomorrow, or open one that exists");
      if (store.count() >= L.workspacesMax) return err(507, "full", `the server holds its maximum of ${L.workspacesMax} workspaces`, "open one that exists; tell the owner of the server");
      if (diskLow()) return err(507, "full", "the server's disk is nearly full, so no new workspace is made", "tell the owner of the server");
      createsVisitor.hit(visitor); createsBlock.hit(block); createsDay.hit("all");
    }
    const made = store.create(name);
    return json(made, 201);
  }
  async function rename(req: Request, id: string, visitor: string): Promise<Response> {
    const b = await nameBody(req);
    if (b instanceof Response) return b;
    if (deployed && !edits.hit(visitor)) return err(429, "rate_limited", `at most ${L.editsPerMinutePerVisitor} changes a minute per visitor`, "wait a minute");
    let w: Workspace | null;
    try { w = store.rename(id, cleanName(b.name)); } catch (e) { return badName(e) ?? err(400, "bad_name", "this name cannot be used", "send another"); }
    if (!w) return noWorkspace();
    scenes.get(id)?.renamed(w);
    return json(w);
  }
  function remove(req: Request, id: string, visitor: string): Response {
    if (req.headers.get("x-synergon") !== "1") return err(400, "bad_request", "this needs the header X-Synergon: 1", "the viewer sends it");
    if (deployed && !edits.hit(visitor)) return err(429, "rate_limited", `at most ${L.editsPerMinutePerVisitor} changes a minute per visitor`, "wait a minute");
    const s = scenes.get(id);
    s?.flush();                                             // the last state goes with the folder
    if (!store.remove(id)) return noWorkspace();
    if (s) { scenes.delete(id); s.deleted(); }
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }

  /** every address under /api/workspaces/<id> */
  async function workspace(req: Request, url: URL, visitor: string, rest: string[]): Promise<Response> {
    let id = rest[0] ?? "";
    if (!deployed && id === LOCAL_ALIAS) id = store.byName(PLAYGROUND)?.id ?? id;
    if (!isWorkspaceId(id)) return noWorkspace();            // before any path is built from it
    const sub = rest.slice(1).join("/"), m = req.method, isGet = m === "GET" || m === "HEAD";
    const wrong = (use: string) => err(405, "bad_method", `${m} is not used for ${url.pathname}`, `use ${use}`);
    if (sub === "") {
      if (isGet) { const w = store.get(id); return w ? json(w) : noWorkspace(); }
      if (m === "PATCH") return await rename(req, id, visitor);
      if (m === "DELETE") return remove(req, id, visitor);
      return wrong("GET, PATCH or DELETE");
    }
    const routes: Record<string, string> = { live: "GET", command: "POST", follow: "POST", picture: "POST", trace: "GET", mcp: "POST, DELETE" };
    if (!(sub in routes)) return err(404, "not_found", `no ${url.pathname} here`, "a workspace has /live, /command, /mcp, /follow, /trace and /picture");
    if (sub !== "mcp" ? !routes[sub].split(", ").includes(m) && !(sub === "live" && isGet) : !["POST", "DELETE"].includes(m)) {
      return sub === "mcp" ? new Response(null, { status: 405, headers: { allow: "POST, DELETE" } }) : wrong(routes[sub]);
    }
    if (sub === "picture" && deployed && !queries.hit(visitor)) return err(429, "rate_limited", `at most ${L.queriesPerMinutePerVisitor} requests a minute per visitor`, "wait a minute");
    const s = scene(id);
    if (!s) return noWorkspace();
    if (s === "busy") return err(503, "busy", "the server is holding as many workspaces as it can", "try again in a moment");
    switch (sub) {
      case "live": return s.live(req, url, visitor);
      case "command": return await s.withRequest(() => s.command(req, visitor));
      case "follow": return await s.follow(req, visitor);
      case "picture": return await s.picture(req, url);
      case "trace": return json({ ok: true, server: server(), traces: s.traces(Math.max(0, Number(url.searchParams.get("after")) || 0)) });
      default:                                               // mcp
        if (m === "DELETE") { s.mcpEnd(req.headers.get("mcp-session-id")); return new Response(null, { status: 204 }); }
        return await s.withRequest(() => s.mcpPost(req, visitor));
    }
  }

  // ---- release watch (deployed): exit when `current` no longer points at our release
  let release: string | null = null;
  if (deployed && opts.releaseDir) try { release = realpathSync(opts.releaseDir); } catch { release = null; }
  const watch = release ? setInterval(() => {
    let now: string;
    try { now = realpathSync(opts.releaseDir!); } catch { return; }
    if (now === release) return;
    clearInterval(watch!);
    console.log(JSON.stringify({ release_changed: { from: release, to: now } }));
    (opts.onReleaseChange ?? (() => { close(); process.exit(0); }))();
  }, L.releaseWatchMs) : null;

  const heartbeat = setInterval(() => { const b = enc.encode(":hb\n\n"); for (const s of allStreams) s.send(b); }, L.heartbeatMs);
  /** An empty scene again in every workspace, sent to every open stream as a snapshot (tools only: not reachable over HTTP). */
  function reset() {
    for (let cursor: string | null = null; ; ) {
      const page = store.list({ limit: L.workspaceListMax, cursor });
      for (const w of page.workspaces) { const s = scene(w.id); if (s && s !== "busy") s.reset(); }
      if (!page.next) break;
      cursor = page.next;
    }
  }
  function close() {
    clearInterval(heartbeat); clearInterval(sweeper); clearInterval(idleSweeper); if (watch) clearInterval(watch);
    for (const p of [...pending.values()]) p.done(null);
    for (const s of [...scenes.values()]) drop(s, true);
    for (const s of [...allStreams]) s.close();
    allStreams.clear();
    try { store.close(); } catch { /* closed */ }
  }

  async function fetch(req: Request, ip: string): Promise<Response | undefined> {
    const url = new URL(req.url), path = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    if (!url.pathname.startsWith("/api/")) return undefined;
    try {
      // locally, only pages of this machine may talk to the API (no DNS rebinding from a web page)
      if (!deployed && !LOCAL_HOSTS.test(req.headers.get("host") ?? "")) return err(403, "bad_host", "the local server answers only to 127.0.0.1 and localhost", "open the viewer at http://127.0.0.1:<port>/");
      const visitor = visitorKey(ip, req.headers.get("x-forwarded-for"));
      const isGet = req.method === "GET" || req.method === "HEAD";
      if (isGet && deployed && !queries.hit(visitor)) return err(429, "rate_limited", `at most ${L.queriesPerMinutePerVisitor} requests a minute per visitor`, "wait a minute");
      if (path === "/api/health") {
        if (!isGet) return err(405, "bad_method", `${req.method} is not used for ${path}`, "use GET");
        return json({ ok: true, revision: opts.revision, format: SCENE_FORMAT, mode: opts.mode, uptime_s: Math.round((Date.now() - started) / 1000), asset: { name: asset.name, sha256: asset.sha256 } });
      }
      if (path === "/api/commands") {
        if (!isGet) return err(405, "bad_method", `${req.method} is not used for ${path}`, "use GET");
        return json({ ok: true, server: server(), commands: list_() });
      }
      if (path === "/api/workspaces") {
        if (isGet) return list(url);
        if (req.method === "POST") return await create(req, visitor);
        return err(405, "bad_method", `${req.method} is not used for ${path}`, "use GET or POST");
      }
      if (path.startsWith("/api/workspaces/")) return await workspace(req, url, visitor, path.slice("/api/workspaces/".length).split("/"));
      if (OLD_ADDRESSES.has(path)) return err(404, "not_found", `${path} is gone: there is no single shared scene any more`, `use /api/workspaces/<id>${path.slice(4)} (the workspace's id is the last part of its address, /workspaces/<id>)`);
      return err(404, "not_found", `no ${path} here`, "the API has /api/health, /api/commands, /api/workspaces and /api/workspaces/<id>/(live, command, mcp, follow, trace, picture)");
    } catch (e: any) {
      console.error(`error on ${req.method} ${path}:`, e?.stack ?? e);
      return json({ ok: false, error: { code: "internal", message: "internal error", hint: "try again; if it keeps failing, tell the owner of the server" } }, 500);
    }
  }

  return {
    fetch, close, reset,
    streamPlaces: (): StreamPlace[] => [...allStreams, ...draining],
    /** the Playground (the oldest workspace of that name): for tools and tests */
    playground: () => store.byName(PLAYGROUND),
    list: (o?: Parameters<Store["list"]>[0]) => store.list(o),
    /** ids of the workspaces in memory */
    loaded: () => [...scenes.keys()],
  };
}

export { visitorKey, blockKey, RateWindow, LOCAL_HOSTS } from "./http-guards.ts";
// ---------------------------------------------------------------------------------------------- run directly
type AdditionalApi = {
  fetch(req: Request, ip: string, stationStreams: () => StreamPlace[]): Promise<Response | undefined>;
  streamPlaces(): Iterable<StreamPlace>;
  close(): void;
};

/** Start from the same release link and service arguments for both the station and room runtime. */
export function startServer(additional?: (options: { release: string; dataDir: string; mode: "deployed" | "local"; revision: string }) => AdditionalApi) {
  const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const mode = opt("--mode") ?? "local";
  if (mode !== "local" && mode !== "deployed") { console.error(`--mode is local or deployed, not ${mode}`); process.exit(2); }
  const release = realpathSync(dirname(dirname(resolve(process.argv[1]))));   // the folder above ours (real path)
  const byLayout = basename(dirname(release)) === "releases" ? join(dirname(dirname(release)), "current") : null;
  const releaseDir = opt("--release") ? resolve(opt("--release")!) : byLayout && existsSync(byLayout) ? byLayout : release;
  if (mode === "deployed" && realpathSync(releaseDir) !== release) { console.log(JSON.stringify({ release_changed: { from: release, to: realpathSync(releaseDir) } })); process.exit(0); }
  const assetDir = opt("--asset") ? resolve(opt("--asset")!) : mode === "deployed" || existsSync(join(release, "asset")) ? join(release, "asset") : join(release, "assets", "rig-b", "build");
  let revision = opt("--revision") ?? "working copy";
  if (!opt("--revision") && existsSync(join(release, "version.json"))) try { revision = JSON.parse(readFileSync(join(release, "version.json"), "utf8")).revision ?? revision; } catch { /* keep the default */ }
  const dataDir = opt("--data") ? resolve(opt("--data")!) : mode === "local" ? join(dirname(release), "synergon-projects") : null;
  if (!dataDir) { console.error("--data <dir> is required in deployed mode"); process.exit(2); }
  const extra = additional?.({ release, dataDir, mode, revision });
  const api = createApi({ dataDir, assetDir, mode, revision, otherStreams: extra?.streamPlaces, ...(mode === "deployed" ? { releaseDir, onReleaseChange: () => stop() } : {}) });
  const srv = Bun.serve({
    port: Number(opt("--port") ?? 4173), hostname: opt("--host") ?? "127.0.0.1", development: false, idleTimeout: LIMITS.idleTimeoutS, maxRequestBodySize: LIMITS.bodyBytes,
    async fetch(req, s) {
      const ip = s.requestIP(req)?.address ?? "";
      return await extra?.fetch(req, ip, api.streamPlaces) ?? await api.fetch(req, ip) ?? new Response("not found", { status: 404 });
    },
    error(e) { console.error(e); return new Response("internal error", { status: 500 }); },
  });
  console.log(JSON.stringify({ listening: srv.port }));
  function stop() { extra?.close(); api.close(); srv.stop(true); process.exit(0); }
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}

if (import.meta.main) startServer();
