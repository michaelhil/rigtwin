// The rigtwin server: the command endpoint and the live channel for the scene document ("Playground",
// the pose and its last changes). The same code runs locally (mounted by tools/serve.ts next to the
// viewer, or on its own) and on the host (bundled as server/server.js inside the release, run by
// systemd behind Caddy, which maps /rigtwin/api/* to /api/*).
//
//   GET  /api/health    {ok, revision, format, mode, uptime_s, asset: {name, sha256}}
//   GET  /api/commands  the command catalogue (shared/commands)
//   POST /api/command   {id, args, expectedVersion?, group?, session?}, JSON, header X-Rigtwin: 1
//                       -> {ok: true, server, version, result} | {ok: false, server, version, error: {code, message, hint, schema?}}
//                       (HTTP 200 whenever the command was looked at; 4xx/5xx only for requests that never got that far)
//   GET  /api/live      server-sent events: "session" {code, ...} first, then "snapshot" {doc} or the "applied"
//                       entries after Last-Event-ID (or ?since=<version>); "view" {id, args} only to the stream
//                       whose session code a view command names; a ":hb" comment every 15 s; "end" {reason} as
//                       the last event of a stream the server ends by its byte budget (the page reconnects at once).
//                       ?session=<code> keeps a browser's code across reconnects (when it is free).
//   POST /api/mcp       the same commands for agents over MCP (Streamable HTTP, tools only: adjust, look, measure,
//                       undo, state; server/mcp.ts); no X-Rigtwin header, a JSON content type and no foreign Origin
//   POST /api/follow    {session, actor}: this page follows that caller's views (a look without a code reaches it); actor
//                       null stops; one caller per page
//   GET  /api/trace     ?after=<n>: the last 100 trace records (one per request: who, what, how it ended, how long; server/trace.ts),
//                       also sent live as the event "trace"
//   POST /api/picture   ?reply=<id>&session=<code>, image/jpeg: a browser's answer to `look {picture: true}`, only for a
//                       picture that is being waited for (the id is in the view event), at most 60 kB
//
// Who: identify(req) gives the actor from the declared role (X-Rigtwin-Client: person | agent, otherwise a
// script; the role is only claimed) and an id the server makes: an HMAC, with a secret kept in the data
// folder, of the random id the client sends (X-Rigtwin-Client-Id; one per browser page or CLI run). The
// client's own id is never stored or sent to anyone, so it cannot be read off the live channel and reused.
// Every command reply names the caller's actor (`you`) and, for an edit, the version it recorded
// (`recorded`): a browser knows its own changes by those versions. authorize() allows everything in step 1.
// The only client-written text stored is the group name ([a-z0-9-], 40 characters at most).
//
// Run directly: bun server/server.ts [--port 4173] [--host 127.0.0.1] [--data <dir>] [--asset <dir>]
//   [--mode local|deployed] [--revision <rev>] [--release <link>]; prints {"listening": <port>} when ready.
//   In deployed mode the release is the real path of the folder above this file's folder (Bun gives a
//   script its real path, so /srv/rigtwin/current/server/server.js arrives as .../releases/<name>/server/
//   server.js); the asset is <release>/asset, the revision <release>/version.json. The link watched is
//   --release, or else <root>/current when the release lies in <root>/releases/ (the deploy's layout); the
//   server exits when that link points at another release, and at start when it already does.
//
// Mounting `createApi(...).fetch` in another Bun.serve (tools/serve.ts, a test proxy): set
// `idleTimeout: LIMITS.idleTimeoutS`. Bun's default of 10 s ends a quiet live stream before its first
// heartbeat (15 s); measured on Bun 1.4.0.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, statfsSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { LIMITS, type Limits } from "./limits.ts";
import { assetFromFiles, runCommand, SESSION_ALPHABET, SESSION_PATTERN } from "../shared/commands/core.ts";
import { get, list, type AssetInfo } from "../shared/commands/registry.ts";
import { entriesAfter, newDoc, parseDoc, reconcile, SCENE_FORMAT, type Actor, type SceneDoc } from "../shared/commands/doc.ts";
import type { CommandError } from "../shared/commands/schema.ts";
import { ownWords } from "../shared/commands/intent.ts";     // also registers adjust, look, measure, undo, state
import { instructions as agentInstructions } from "../shared/commands/agent-docs.ts";
import { createMcp } from "./mcp.ts";
import { createTrace, summarize } from "./trace.ts";

export interface ApiOptions {
  dataDir: string; assetDir: string; mode: "local" | "deployed"; revision: string;
  /** deployed: the release folder as started (`/srv/rigtwin/current`, a link); watched for a new release */
  releaseDir?: string;
  /** other limits (tests) */
  limits?: Partial<Limits>;
  /** called when `releaseDir` no longer points at the release we started from (default: exit, systemd starts the new one) */
  onReleaseChange?: () => void;
}

const KIND_LABEL = { person: "Person", agent: "Claude Code", script: "Script" } as const;
/** The actor of a request: declared role and random id, label made by the server. */
export function identify(req: Request, secret: Buffer): Actor {
  const role = req.headers.get("x-rigtwin-client"), kind = role === "person" || role === "agent" ? role : "script";
  const given = req.headers.get("x-rigtwin-client-id"), raw = given && /^[0-9a-f]{8,64}$/.test(given) ? given : randomBytes(16).toString("hex");
  const id = createHmac("sha256", secret).update(raw).digest("hex").slice(0, 12);
  return { kind, id, label: `${KIND_LABEL[kind]} · ${id.slice(0, 4)}` };
}
/** The one place that decides who may run what. Step 1 (open sandbox): everything. */
export function authorize(_actor: Actor, _command: string): CommandError | null { return null; }

const isLoopback = (a: string) => a === "::1" || a.startsWith("127.") || a.startsWith("::ffff:127.");
/** The visitor a request counts against: the address Caddy passes on (only when the request comes from
 *  loopback), IPv6 by its /64 block. */
export function visitorKey(ip: string, forwardedFor: string | null): string {
  let a = ip;
  if (forwardedFor && isLoopback(ip)) a = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean).at(-1) ?? ip;
  a = a.replace(/^\[|\](:\d+)?$/g, "").replace(/%.*$/, "").replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
  if (!a.includes(":")) return a;
  const [head, tail] = a.toLowerCase().split("::"), h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map((x) => parseInt(x || "0", 16).toString(16)).join(":") + "::/64";
}

/** The network block a visitor belongs to: an IPv6 /48 or an IPv4 /24 (security review S7). */
export function blockKey(visitor: string): string {
  if (visitor.endsWith("::/64")) return visitor.split(":").slice(0, 3).join(":") + "::/48";
  const p = visitor.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : visitor;
}

/** At most `n` hits per `ms` for each key (a sliding window). */
class Window {
  private hits = new Map<string, number[]>();
  constructor(private n: number, private ms: number) {}
  hit(key: string, now = Date.now()) {
    let a = this.hits.get(key);
    if (!a) this.hits.set(key, (a = []));
    while (a.length && a[0] <= now - this.ms) a.shift();
    if (a.length >= this.n) return false;
    a.push(now);
    return true;
  }
  /** hits in the window, without adding one */
  count(key: string, now = Date.now()) { return (this.hits.get(key) ?? []).filter((t) => t > now - this.ms).length; }
  sweep(now = Date.now()) { for (const [k, a] of this.hits) if (!a.length || a[a.length - 1] <= now - this.ms) this.hits.delete(k); }
}

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
export const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\]|[a-z0-9.-]+\.localhost)(:\d+)?$/i;

export function createApi(opts: ApiOptions) {
  const L: Limits = { ...LIMITS, ...opts.limits }, deployed = opts.mode === "deployed", started = Date.now(), enc = new TextEncoder();
  const docFile = join(opts.dataDir, "playground", "doc.json");
  mkdirSync(dirname(docFile), { recursive: true, mode: 0o700 });
  // the secret behind the author ids: made at the first start, kept in the data folder (never in a release)
  const secretFile = join(opts.dataDir, "secret");
  if (!existsSync(secretFile)) { const fd = openSync(secretFile, "wx", 0o600); writeSync(fd, randomBytes(32).toString("hex")); closeSync(fd); }
  const secret = Buffer.from(readFileSync(secretFile, "utf8").trim(), "hex");
  if (secret.length < 32) throw new Error(`${secretFile} is not a 32-byte secret`);

  // ---- the asset (re-read when its description file changes; locally a rebuild may happen while we run)
  let asset: AssetInfo, assetStamp = "";
  function loadAsset(): boolean {
    const name = readdirSync(opts.assetDir).find((f) => f.endsWith(".manifest.json"));
    if (!name) throw new Error(`no *.manifest.json in ${opts.assetDir}`);
    const file = join(opts.assetDir, name), st = statSync(file), stamp = `${file}:${st.mtimeMs}:${st.size}`;
    if (stamp === assetStamp) return false;
    const manifest = JSON.parse(readFileSync(file, "utf8")), glb = new Uint8Array(readFileSync(join(opts.assetDir, manifest.glb.file)));
    if (createHash("sha256").update(glb).digest("hex") !== manifest.glb.sha256) throw new Error("the GLB does not match its description file (a build is being written?)");
    asset = assetFromFiles(manifest, glb);
    assetStamp = stamp;
    return true;
  }
  loadAsset();

  // ---- the document
  let doc: SceneDoc = newDoc(asset!);
  if (existsSync(docFile)) {
    try { doc = parseDoc(JSON.parse(readFileSync(docFile, "utf8"))); }
    catch (e: any) { const aside = `${docFile}.unreadable-${Date.now()}`; renameSync(docFile, aside); console.error(`doc.json could not be read (${e.message}); kept as ${aside}, starting an empty Playground`); }
  }
  /** doc.json, written atomically: a temporary file, flushed to disk, renamed over the old one. */
  function write() {
    clearTimeout(saveTimer); saveTimer = undefined; lastSave = Date.now();
    const tmp = `${docFile}.${process.pid}.tmp`, fd = openSync(tmp, "w", 0o600);
    try { writeSync(fd, JSON.stringify(doc)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, docFile);
  }
  /** Write now, or (when the last write is younger than saveEveryMs) once that time is up. */
  let saveTimer: ReturnType<typeof setTimeout> | undefined, lastSave = 0;
  function save() {
    snap = null;
    if (saveTimer) return;
    const wait = lastSave + L.saveEveryMs - Date.now();
    if (wait <= 0) { try { write(); } catch (e: any) { console.error(`doc.json not written: ${e.message}`); } }
    else saveTimer = setTimeout(() => { try { write(); } catch (e: any) { console.error(`doc.json not written: ${e.message}`); } }, wait);
  }
  /** the snapshot event of the current document, serialised once per change (security review S8) */
  let snap: Uint8Array | null = null;
  const snapshotBytes = () => (snap ??= enc.encode(sse("snapshot", { doc }, doc.version)));
  reconcile(doc, asset!);
  write();

  // ---- live streams
  interface Stream { code: string; visitor: string; block: string; send(chunk: Uint8Array): void; close(why?: "slow" | "spent"): void }
  const streams = new Map<string, Stream>();
  /** deployed: streams ended by their byte budget, whose connection may still hold their last bytes in socket buffers; each keeps
   *  its place in the stream limits until its connection is gone (Bun ends a stalled one after idleTimeoutS) or streamDrainMs */
  const draining = new Set<{ visitor: string; block: string }>();
  const broadcast = (chunk: string | Uint8Array) => { const b = typeof chunk === "string" ? enc.encode(chunk) : chunk; for (const s of streams.values()) s.send(b); };
  const newCode = () => { for (;;) { const b = randomBytes(8), c = [...b].map((x) => SESSION_ALPHABET[x % SESSION_ALPHABET.length]).join(""); if (!streams.has(c)) return c; } };

  function refreshAsset() {
    if (deployed) return;                       // a release never changes under a running server
    try {
      if (!loadAsset()) return;
      const e = reconcile(doc, asset);
      save();
      if (e) broadcast(sse("applied", e, e.version));
    } catch { /* mid-build: keep the asset we have and look again next time */ }
  }

  const server = () => ({ mode: opts.mode, revision: opts.revision });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const fail = (status: number, code: string, message: string, hint: string) => json({ ok: false, server: server(), version: doc.version, error: { code, message, hint } }, status);

  // ---- deployed guards (PLAN-v7 D1)
  const edits = new Window(L.editsPerMinutePerVisitor, 60_000), editsAll = new Window(L.editsPerSecondTotal, 1_000), queries = new Window(L.queriesPerMinutePerVisitor, 60_000);
  const editsBlock = new Window(L.editsPerSecondPerBlock, 1_000), unknownSessions = new Window(L.unknownSessionsPerMinutePerVisitor, 60_000);
  const sweeper = setInterval(() => { for (const w of [edits, editsAll, queries, editsBlock, unknownSessions, asks]) w.sweep(); }, 60_000);
  function diskLow() {
    try { const s = statfsSync(opts.dataDir), free = s.bavail * s.bsize, total = s.blocks * s.bsize; return free < L.diskMinFreeBytes || free / total < L.diskMinFreeFraction; }
    catch { return false; }
  }

  function live(req: Request, url: URL, visitor: string): Response {
    if (deployed) {
      const places = [...streams.values(), ...draining];
      if (places.length >= L.streamsTotal) return fail(503, "too_many_streams", `the server has its maximum of ${L.streamsTotal} live connections`, "try again later");
      if (places.filter((s) => s.visitor === visitor).length >= L.streamsPerVisitor) return fail(429, "too_many_streams", `at most ${L.streamsPerVisitor} live connections per visitor`, "close another tab of the viewer");
      if (places.filter((s) => s.block === blockKey(visitor)).length >= L.streamsPerBlock) return fail(429, "too_many_streams", `at most ${L.streamsPerBlock} live connections per network block`, "try again later");
    }
    refreshAsset();
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
        if (closed) return; closed = true; if (streams.get(code) === stream) streams.delete(code);
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
        const first = [enc.encode([`retry: ${L.retryMs}\n\n`, sse("session", { code, mode: opts.mode, revision: opts.revision, format: SCENE_FORMAT }), ...(later ?? []).map((e) => sse("applied", e, e.version))].join("")), ...(later ? [] : [snapshotBytes()])];
        for (const b of first) { c.enqueue(b); sent += b.byteLength; }
        if (deployed && sent >= L.streamBytesMax) stream.close("spent");
      },
      cancel() { stream.close(); },
    }, { highWaterMark: L.streamQueueBytes, size: (chunk) => chunk?.byteLength ?? 0 });
    if (!closed) streams.set(code, stream);              // (a first chunk larger than the byte budget has ended it already)
    req.signal?.addEventListener("abort", () => stream.close());
    return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  }

  async function command(req: Request, visitor: string): Promise<Response> {
    if (req.headers.get("x-rigtwin") !== "1") return fail(400, "bad_request", "a command needs the header X-Rigtwin: 1", "send the header X-Rigtwin: 1 (bun run rig does)");
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

  // ---- one command for an actor: the HTTP endpoint and the MCP tools both come here
  type Reply = { status: number; body: Record<string, any> };
  const reply = (status: number, code: string, message: string, hint: string): Reply => ({ status, body: { ok: false, server: server(), version: doc.version, error: { code, message, hint } } });
  /** pictures being waited for (look {picture: true}), by the reply id sent with the view event */
  const pending = new Map<string, { codes: string[] | null; visitor: string; done(b: Uint8Array | null, pageMs?: number): void }>();
  /** pages that follow a caller's views (POST api/follow): caller id -> session codes. A look without a code goes to them. */
  const followers = new Map<string, Set<string>>();
  /** questions put to every page, per caller (consent) */
  const asks = new Window(L.asksPerMinutePerCaller, 60_000);
  // ---- the trace: one record per request, to every open page (server/trace.ts)
  const trace = createTrace({ publicMode: deployed, send: (rec) => broadcast(sse("trace", rec)), allow: (s) => ownWords(asset, s) });
  /** One request, timed and traced. */
  async function exec(you: Actor, visitor: string, wire: Record<string, unknown>, via: "mcp" | "http" = "http"): Promise<Reply> {
    const at = Date.now(), t0 = performance.now(), note: { picture?: { bytes: number; wait_ms: number; page_ms?: number } | null; entry?: any } = {};
    const r = await run(you, visitor, wire, note);
    try {
      trace.record({ at, ms: performance.now() - t0, you, via, command: String(wire.id ?? "?").slice(0, 40), args: wire.args, session: typeof wire.session === "string" ? wire.session : undefined,
        ok: r.body.ok === true, result: r.body.result, error: r.body.error, entry: note.entry, picture: note.picture });
    } catch (e: any) { console.error("trace:", e?.message ?? e); }
    return r;
  }
  async function run(you: Actor, visitor: string, wire: Record<string, unknown>, note: { picture?: { bytes: number; wait_ms: number; page_ms?: number } | null; entry?: any }): Promise<Reply> {
    const kind = get(String(wire.id))?.kind ?? "query";
    if (deployed) {
      if (kind === "query" ? !queries.hit(visitor) : !edits.hit(visitor)) return reply(429, "rate_limited", kind === "query" ? `at most ${L.queriesPerMinutePerVisitor} queries a minute per visitor` : `at most ${L.editsPerMinutePerVisitor} changes a minute per visitor`, "wait a minute and send fewer commands");
      if (kind !== "query" && !editsBlock.hit(blockKey(visitor))) return reply(429, "rate_limited", `at most ${L.editsPerSecondPerBlock} changes a second per network block`, "try again in a moment");
      if (kind !== "query" && !editsAll.hit("all")) return reply(429, "rate_limited", `the server takes at most ${L.editsPerSecondTotal} changes a second`, "try again in a moment");
      if (kind === "view" && unknownSessions.count(visitor) >= L.unknownSessionsPerMinutePerVisitor) return reply(429, "rate_limited", `too many unknown session codes (${L.unknownSessionsPerMinutePerVisitor} a minute)`, "ask for the code shown in the browser's More menu");
      if (kind === "edit" && diskLow()) return reply(507, "disk_full", "the server's disk is nearly full, so changes are refused", "tell the owner of the server");
    }
    refreshAsset();
    const denied = authorize(you, String(wire.id));
    if (denied) return { status: 200, body: { ok: false, server: server(), version: doc.version, you, error: denied } };
    const out = runCommand({ doc, asset }, you, wire as any);
    let result: any = out.ok ? out.result : undefined;
    if (out.ok && out.view) {
      const v = out.view, one = v.session ? streams.get(v.session) : undefined;
      // a code names one page; without one (only commands that allow it): the pages that follow this caller, and on a
      // local server every open page
      const followed = v.session ? [] : [...(followers.get(you.id) ?? [])].map((c) => streams.get(c)).filter((s): s is Stream => !!s);
      // no code and no follower on the public sandbox: every open page is asked (the page shows the view only when its owner
      // allows it, or allowed agents always), at most a few times a minute per caller
      const asking = !v.session && !followed.length && deployed && streams.size > 0 && asks.hit(you.id);
      const targets = v.session ? (one ? [one] : []) : followed.length && deployed ? followed : deployed ? (asking ? [...streams.values()] : []) : [...streams.values()];
      if (!targets.length) {
        if (v.session) {
          unknownSessions.hit(visitor);
          return { status: 200, body: { ok: false, server: server(), version: doc.version, you, error: { code: "unknown_session", message: `no viewer with session code ${v.session} is connected to this server`, hint: "the code is shown in the viewer's More menu; it changes when the page is reloaded" } } };
        }
        const error = deployed
          ? { code: "needs_viewer", message: `${v.id} on the public sandbox needs the code of the browser it is for, or a browser that follows this agent`, hint: "ask the owner to open the viewer (it then asks them to allow your views) or to click Follow on the activity line, then send look again; or ask for the code shown under More, \"Shared scene\", and pass it as viewer" }
          : { code: "no_viewer", message: "no viewer page is open on this server", hint: "ask the owner to open the viewer (bun run serve, then http://127.0.0.1:4173/)" };
        return { status: 200, body: { ok: false, server: server(), version: doc.version, you, error } };
      }
      let wait: Promise<{ b: Uint8Array; pageMs?: number } | null> | null = null, replyId: string | undefined;
      const waitStart = performance.now();
      if (v.args.picture) {
        const codes = v.session ? [v.session] : followed.length && deployed ? followed.map((s) => s.code) : null;
        const mine = [...pending.values()].filter((p) => p.visitor === visitor).length, ofPage = [...pending.values()].filter((p) => p.codes !== null && codes !== null && p.codes.some((c) => codes.includes(c))).length;
        if (pending.size >= L.picturesPending || (deployed && (mine >= L.picturesPerVisitor || ofPage >= 1))) return reply(429, "rate_limited", `at most ${L.picturesPerVisitor} pictures per visitor and one per browser are waited for at once`, "wait for the picture asked for before, then ask again");
        const id = (replyId = randomBytes(16).toString("hex"));
        wait = new Promise((resolve) => {
          const timer = setTimeout(() => { pending.delete(id); resolve(null); }, asking ? L.pictureAskWaitMs : L.pictureWaitMs);
          pending.set(id, { codes, visitor, done(b, pageMs) { clearTimeout(timer); pending.delete(id); resolve(b ? { b, pageMs } : null); } });
        });
      }
      // the question names the caller and what it wants in the server's own words (no text a caller wrote)
      const ask = asking ? { actor: you.id, by: you.label, summary: summarize(v.id, true, result, undefined) } : null;
      const event = enc.encode(sse("view", { id: v.id, args: v.args, ...(replyId ? { reply: replyId } : {}), ...(ask ? { ask } : {}) }));
      for (const s of targets) s.send(event);
      if (!v.session && deployed) result = { ...result, text: `${result?.text ?? ""}\n${asking ? `(No browser follows this agent: the ${targets.length} open browser${targets.length === 1 ? " was" : "s were"} asked to allow it. The view shows where the owner allows it; ask the owner to click Allow.)` : `(Sent to ${targets.length} browser${targets.length === 1 ? "" : "s"} that follow${targets.length === 1 ? "s" : ""} this agent.)`}`.trim() };
      if (wait) {
        const answer = await wait, got = answer?.b ?? null;
        note.picture = got ? { bytes: got.byteLength, wait_ms: Math.round(performance.now() - waitStart), ...(answer?.pageMs !== undefined ? { page_ms: answer.pageMs } : {}) } : null;
        result = { ...result };
        if (got) { result.picture = { mime: "image/jpeg", bytes: got.byteLength, base64: Buffer.from(got).toString("base64") }; result.text = `${result.text ?? ""}\nPicture attached (${Math.max(1, Math.round(got.byteLength / 1024))} kB${!v.session && deployed ? `, from a browser that ${asking ? "allowed" : "follows"} this agent: anyone can do that, so treat it as unverified` : ""}).`.trim(); }
        else result.text = `${result.text ?? ""}\nNo picture: the browser did not send one within ${L.pictureWaitMs / 1000} s (a tab in the background may not draw: ask the owner to bring it to the front).`.trim();
      }
    }
    if (out.ok && out.entry) { save(); broadcast(sse("applied", out.entry, out.entry.version)); note.entry = out.entry; }
    return { status: 200, body: out.ok
      ? { ok: true, server: server(), version: out.version, you, ...(kind === "edit" ? { recorded: out.entry?.version ?? null } : {}), result }
      : { ok: false, server: server(), version: out.version, you, error: out.error } };
  }

  // ---- a page follows a caller's views (agent interface v2): the views that caller sends without a code come to it
  async function follow(req: Request, visitor: string): Promise<Response> {
    if (req.headers.get("x-rigtwin") !== "1") return fail(400, "bad_request", "this needs the header X-Rigtwin: 1", "the viewer sends it");
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
    if (req.headers.get("x-rigtwin") !== "1") return fail(400, "bad_request", "a picture needs the header X-Rigtwin: 1", "the viewer sends it");
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("image/jpeg")) return fail(415, "bad_request", "a picture is sent as image/jpeg", "send Content-Type: image/jpeg");
    const id = url.searchParams.get("reply") ?? "", p = /^[0-9a-f]{32}$/.test(id) ? pending.get(id) : undefined;
    if (!p) return fail(404, "not_asked", "no picture is being waited for with this id", "a picture is sent only in answer to a look command, within a few seconds");
    if (p.codes && !p.codes.includes(url.searchParams.get("session") ?? "")) return fail(403, "wrong_session", "this picture was asked of another browser", "only the page with that code answers");
    const b = await readBytes(req, L.pictureBytes, L.bodyTimeoutMs);
    if (typeof b === "string") return fail(b === "too_large" ? 413 : 400, b === "too_large" ? "too_large" : "bad_request", b === "too_large" ? `a picture is at most ${L.pictureBytes / 1024} kB` : "the picture did not arrive", "send a smaller JPEG");
    if (b.byteLength < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return fail(400, "bad_picture", "the body is not a JPEG", "send the picture as image/jpeg");
    const pageMs = Number(req.headers.get("x-rigtwin-ms"));
    p.done(b, Number.isFinite(pageMs) && pageMs >= 0 && pageMs < 60_000 ? Math.round(pageMs) : undefined);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }

  // ---- MCP (agent interface v2)
  const mcp = createMcp({
    exec: async (you, wire, visitor) => (await exec(you, visitor, wire as any, "mcp")).body as any,
    onConnect: (you) => trace.record({ at: Date.now(), ms: 0, you, via: "mcp", command: "connect", args: {}, ok: true, result: { text: "connected over MCP" } }),
    secret, instructions: () => agentInstructions(asset, opts.mode), revision: opts.revision, maxSessions: L.mcpSessions,
  });
  /** an Origin a page of this server would send: exactly https://mightwork.ai deployed, exactly http://<Host> locally */
  const ownOrigin = (origin: string, req: Request) => (deployed ? origin === "https://mightwork.ai" : origin === `http://${req.headers.get("host") ?? ""}`);
  const mime = (req: Request) => (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  async function mcpPost(req: Request, visitor: string): Promise<Response> {
    const origin = req.headers.get("origin");
    if (origin && !ownOrigin(origin, req)) return fail(403, "bad_origin", "the MCP endpoint answers only to MCP clients, not to other web pages", "connect from an MCP client such as Claude Code");
    if (mime(req) !== "application/json") return fail(415, "bad_request", "an MCP request is sent as JSON", "send Content-Type: application/json");
    if (deployed && !queries.hit(visitor)) return fail(429, "rate_limited", `at most ${L.queriesPerMinutePerVisitor} requests a minute per visitor`, "wait a minute");
    const text = await readBody(req, deployed ? L.bodyBytes : Number.POSITIVE_INFINITY, L.bodyTimeoutMs);
    if (text === "too_large" || text === "too_slow" || text === "aborted") return fail(text === "too_large" ? 413 : 400, text, "the request could not be read", "send it again, smaller");
    let body: unknown;
    try { body = JSON.parse(text); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error: the body is not JSON" } }, { status: 400 }); }
    return mcp.handle(req, body, visitor);
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

  const heartbeat = setInterval(() => broadcast(":hb\n\n"), L.heartbeatMs);
  /** An empty Playground again, sent to every open stream as a snapshot (tools only: not reachable over HTTP). */
  function reset() {
    doc = newDoc(asset);
    write(); snap = null;
    broadcast(snapshotBytes());
  }
  function close() {
    if (saveTimer) { try { write(); } catch (e: any) { console.error(`doc.json not written: ${e.message}`); } }
    clearInterval(heartbeat); clearInterval(sweeper); if (watch) clearInterval(watch);
    for (const s of [...streams.values()]) s.close();
    streams.clear();
  }

  async function fetch(req: Request, ip: string): Promise<Response | undefined> {
    const url = new URL(req.url), path = url.pathname;
    if (!path.startsWith("/api/")) return undefined;
    try {
      // locally, only pages of this machine may talk to the API (no DNS rebinding from a web page)
      if (!deployed && !LOCAL_HOSTS.test(req.headers.get("host") ?? "")) return fail(403, "bad_host", "the local server answers only to 127.0.0.1 and localhost", "open the viewer at http://127.0.0.1:<port>/");
      const visitor = visitorKey(ip, req.headers.get("x-forwarded-for"));
      const isGet = req.method === "GET" || req.method === "HEAD";
      if (path !== "/api/command" && isGet && deployed && !queries.hit(visitor)) return fail(429, "rate_limited", `at most ${L.queriesPerMinutePerVisitor} requests a minute per visitor`, "wait a minute");
      switch (path) {
        case "/api/health":
          if (!isGet) break;
          return json({ ok: true, revision: opts.revision, format: SCENE_FORMAT, mode: opts.mode, uptime_s: Math.round((Date.now() - started) / 1000), asset: { name: asset.name, sha256: asset.sha256 } });
        case "/api/commands":
          if (!isGet) break;
          return json({ ok: true, server: server(), version: doc.version, commands: list() });
        case "/api/live":
          if (req.method !== "GET") break;
          return live(req, url, visitor);
        case "/api/command":
          if (req.method !== "POST") break;
          return await command(req, visitor);
        case "/api/mcp":
          if (req.method === "POST") return await mcpPost(req, visitor);
          if (req.method === "DELETE") { mcp.end(req.headers.get("mcp-session-id")); return new Response(null, { status: 204 }); }
          return new Response(null, { status: 405, headers: { allow: "POST, DELETE" } });      // no server-initiated stream
        case "/api/follow":
          if (req.method !== "POST") break;
          return await follow(req, visitor);
        case "/api/trace":
          if (!isGet) break;
          return json({ ok: true, server: server(), traces: trace.recent(Math.max(0, Number(url.searchParams.get("after")) || 0)) });
        case "/api/picture":
          if (req.method !== "POST") break;
          if (deployed && !queries.hit(visitor)) return fail(429, "rate_limited", `at most ${L.queriesPerMinutePerVisitor} requests a minute per visitor`, "wait a minute");
          return await picture(req, url);
        default:
          return fail(404, "not_found", `no ${path} here`, "the API has /api/health, /api/commands, /api/command (POST), /api/live, /api/trace, /api/mcp (POST) and /api/picture (POST)");
      }
      return fail(405, "bad_method", `${req.method} is not used for ${path}`, path === "/api/command" || path === "/api/picture" ? "use POST" : "use GET");
    } catch (e: any) {
      console.error(`error on ${req.method} ${path}:`, e?.stack ?? e);
      return json({ ok: false, error: { code: "internal", message: "internal error", hint: "try again; if it keeps failing, tell the owner of the server" } }, 500);
    }
  }

  return { fetch, close, reset };
}

// ---------------------------------------------------------------------------------------------- run directly
if (import.meta.main) {
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
  const dataDir = opt("--data") ? resolve(opt("--data")!) : mode === "local" ? join(dirname(release), "rigtwin-projects") : null;
  if (!dataDir) { console.error("--data <dir> is required in deployed mode"); process.exit(2); }
  const api = createApi({ dataDir, assetDir, mode, revision, ...(mode === "deployed" ? { releaseDir } : {}) });
  const srv = Bun.serve({
    port: Number(opt("--port") ?? 4173), hostname: opt("--host") ?? "127.0.0.1", development: false, idleTimeout: LIMITS.idleTimeoutS, maxRequestBodySize: LIMITS.bodyBytes,
    async fetch(req, s) { return (await api.fetch(req, s.requestIP(req)?.address ?? "")) ?? new Response("not found", { status: 404 }); },
    error(e) { console.error(e); return new Response("internal error", { status: 500 }); },
  });
  console.log(JSON.stringify({ listening: srv.port }));
  const stop = () => { api.close(); srv.stop(true); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
