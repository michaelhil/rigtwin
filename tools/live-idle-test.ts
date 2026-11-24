// bun tools/live-idle-test.ts --url <base> [--minutes 10] [--joint J_mon_tilt]
//
// Does the live channel survive a long quiet spell on a real route (the laptop, or https://mightwork.ai/rigtwin
// through Caddy)? Opens <base>/api/live, keeps it open for the given minutes while counting the heartbeat comments,
// then makes one small, harmless change (pose.set of one joint by 1 degree or 5 mm, in its own group) and undoes it
// (history.undo of that group), and checks that both arrive on the same, still open stream. Exits 0 when all of that
// holds; otherwise non-zero with the reason. Prints the elapsed time and the number of heartbeats as it goes.
// It talks only to <base> (commands through tools/rig.ts call()). The scene is left as it was found: the change is
// undone at once; if the undo is refused, the script says how to undo it by hand.
import { randomBytes } from "node:crypto";
import { call } from "./rig.ts";
import { LIMITS } from "../server/limits.ts";

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const usage = (m?: string): never => { if (m) console.error(`live-idle-test: ${m}`); console.error("usage: bun tools/live-idle-test.ts --url <base, e.g. https://mightwork.ai/rigtwin or http://127.0.0.1:4173> [--minutes 10] [--joint J_mon_tilt]"); process.exit(2); };
for (let i = 0; i < args.length; i += 2) if (!["--url", "--minutes", "--joint"].includes(args[i]) || args[i + 1] === undefined) usage(`unknown or incomplete option ${args[i]}`);
const base = (opt("--url") ?? usage("--url is required")).replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+/.test(base)) usage("--url must start with http:// or https://");
const minutes = Number(opt("--minutes") ?? 10), joint = opt("--joint") ?? "J_mon_tilt";
if (!(minutes > 0)) usage("--minutes must be a positive number");

const t0 = Date.now(), heartbeatMs = LIMITS.heartbeatMs;
const clock = (ms = Date.now() - t0) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const say = (m: string) => console.log(`[${clock()}] ${m}`);
function fail(reason: string): never { console.error(`[${clock()}] FAILED: ${reason}`); console.error(`elapsed ${clock()}, heartbeats ${beats.length}`); process.exit(1); }

// ------------------------------------------------------------------------------------------------ the live stream
type Event = { name: string; id: string | null; data: any; at: number };
const events: Event[] = [], beats: number[] = [];
let lastActivity = Date.now(), largestGap = 0, closed: string | null = null;
const waiters: { test: (e: Event) => boolean; resolve: (e: Event) => void }[] = [];
const note = () => { const now = Date.now(); largestGap = Math.max(largestGap, now - lastActivity); lastActivity = now; };

async function readStream(res: Response) {
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { closed = "the server or a proxy closed the stream"; return; }
      buf += dec.decode(value, { stream: true });
      const blocks = buf.split(/\r?\n\r?\n/);
      buf = blocks.pop()!;
      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        if (lines.some((l) => l.startsWith(":"))) { note(); beats.push(Date.now()); }
        const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        note();
        let parsed: any = data; try { parsed = JSON.parse(data); } catch { /* keep the text */ }
        const e: Event = { name: lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message", id: lines.find((l) => l.startsWith("id:"))?.slice(3).trim() ?? null, data: parsed, at: Date.now() };
        events.push(e);
        for (const w of [...waiters]) if (w.test(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
      }
    }
  } catch (e: any) { closed = `the stream broke: ${e?.message ?? e}`; }
}
function waitFor(test: (e: Event) => boolean, ms: number, what: string): Promise<Event> {
  const seen = events.find(test);
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve, reject) => {
    const w = { test, resolve: (e: Event) => { clearTimeout(timer); resolve(e); } };
    const timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`${what} did not arrive on the stream within ${ms / 1000} s`)); }, ms);
    waiters.push(w);
  });
}

// ------------------------------------------------------------------------------------------------ 1. health and stream
const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(15000) }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).catch((e) => fail(`${base}/api/health: ${e.message}`));
if (!health?.ok) fail(`${base}/api/health did not answer ok: true`);
say(`${base}: rigtwin server ${health.revision} (${health.mode}, ${health.format}), up ${health.uptime_s} s`);
const live = await fetch(`${base}/api/live`, { headers: { accept: "text/event-stream" } }).catch((e) => fail(`${base}/api/live: ${e.message}`));
if (!live.ok || !(live.headers.get("content-type") ?? "").includes("text/event-stream")) fail(`${base}/api/live answered HTTP ${live.status} (${live.headers.get("content-type") ?? "no content-type"}), not an event stream`);
const reading = readStream(live);
const snapshot = await waitFor((e) => e.name === "snapshot", 15000, "the first snapshot").catch((e) => fail(e.message));
const session = events.find((e) => e.name === "session")?.data?.code ?? "?";
say(`stream open (session ${session}), scene version ${snapshot.data?.doc?.version}; now idle for ${minutes} minute(s), heartbeat expected every ${heartbeatMs / 1000} s`);

// ------------------------------------------------------------------------------------------------ 2. idle
const idleMs = minutes * 60000, idleStart = Date.now();
while (Date.now() - idleStart < idleMs) {
  await Bun.sleep(Math.min(60000, idleMs - (Date.now() - idleStart)));
  if (closed) fail(`${closed} after ${clock()} of idling (${beats.length} heartbeats)`);
  say(`idle ${clock(Date.now() - idleStart)}, heartbeats ${beats.length}`);
}
note();
const expected = Math.floor(idleMs / heartbeatMs) - 1;
if (beats.length < expected) fail(`only ${beats.length} heartbeats in ${clock(idleMs)} of idling; expected at least ${expected} (one every ${heartbeatMs / 1000} s)`);
if (largestGap > 2 * heartbeatMs) fail(`the stream was silent for ${(largestGap / 1000).toFixed(1)} s at one point; heartbeats should come every ${heartbeatMs / 1000} s`);

// ------------------------------------------------------------------------------------------------ 3. one change and its undo
const group = `idle-test-${randomBytes(3).toString("hex")}`, server = { server: base };
const found = await call("scene.find", { text: joint, kind: "joint" }, server);
const j = found.ok ? found.result.matches.find((m: any) => m.id === joint)?.joint : null;
if (!j) fail(`no joint ${joint} on this server (${found.error?.message ?? "scene.find found no exact match"}); name one with --joint`);
if (j.assumed) fail(`${joint} is an assumed adjustment; name a joint seen in the photos with --joint`);
if (j.type !== "revolute" && j.type !== "prismatic") fail(`${joint} is a ${j.type}; name a turning or sliding joint with --joint`);
// based on the version just read; if someone else moves the same joint in between (refused as stale), read again (three tries)
let now = 0, target = 0, set: Awaited<ReturnType<typeof call>> = { server: base, ok: false };
for (let attempt = 1; attempt <= 3; attempt++) {
  const summary = await call("scene.summary", {}, server);
  if (!summary.ok) fail(`scene.summary: ${summary.error?.message}`);
  now = summary.result.moved.find((m: any) => m.joint === joint)?.value ?? j.neutral;
  const step = j.unit === "m" ? 0.005 : 1;
  target = Math.round((now + step <= j.max ? now + step : now - step) * 1e6) / 1e6;
  set = await call("pose.set", { joints: { [joint]: target } }, { ...server, group, expectedVersion: summary.result.version });
  if (set.ok || set.error?.code !== "stale") break;
  say(`pose.set refused as stale (someone else changed ${joint}); reading the scene again`);
}
if (!set.ok) fail(`pose.set ${joint} ${target} ${j.unit} was refused: ${set.error?.code}: ${set.error?.message}`);
const tSet = Date.now();
const undoHint = `bun run rig history.undo '{"group": "${group}"}' --server ${base}`;
const setSeen = await waitFor((e) => e.name === "applied" && e.data?.version === set.version, 10000, `the change (version ${set.version})`).catch((e) => { console.error(`(the change stays until undone: ${undoHint})`); return fail(e.message); });
say(`pose.set ${joint} ${now} → ${target} ${j.unit} (version ${set.version}, group ${group}) arrived on the stream after ${((setSeen.at - tSet) / 1000).toFixed(2)} s`);
const undo = await call("history.undo", { group }, server);
if (!undo.ok) fail(`history.undo of ${group} was refused: ${undo.error?.code}: ${undo.error?.message}; undo it by hand: ${undoHint}`);
const tUndo = Date.now();
const undoSeen = await waitFor((e) => e.name === "applied" && e.data?.version === undo.version, 10000, `the undo (version ${undo.version})`).catch((e) => fail(e.message));
if (!(undoSeen.data?.undoes ?? []).includes(set.version)) fail(`the entry of version ${undo.version} does not say it undoes version ${set.version}`);
say(`history.undo ${group} (version ${undo.version}) arrived on the stream after ${((undoSeen.at - tUndo) / 1000).toFixed(2)} s; ${joint} is back at ${now} ${j.unit}`);
if (closed) fail(closed);

console.log(`ok: elapsed ${clock()}, heartbeats ${beats.length} (largest silence ${(largestGap / 1000).toFixed(1)} s), the change and its undo both arrived on the stream that stayed open throughout`);
reading.catch(() => {});
process.exit(0);
