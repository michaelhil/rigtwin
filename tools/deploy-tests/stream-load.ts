// bun tools/deploy-tests/stream-load.ts [--seconds 60] [--streams 300] [--edits 50] [--limit-mb 150] [--budget-kb 512]
//                                       [--bundle <release>/server/server.js]
// The security review's load (M2), as host check H14 runs it: the built public server (default dist/server/server.js,
// so run `bun run dist` first; it reads the library of its own release) in deployed mode, 300 attempts at a
// live stream that never reads (6 per visitor key, one visitor per /24, through X-Forwarded-For from loopback, as
// Caddy sends them; the server takes 150, server/limits.ts streamsTotal) and 50 full-pose edits a second from 50
// other visitors. Every 5 s it prints the server's resident memory and CPU, how fast health answers, and, where
// /proc/net/sockstat exists (Linux), the kernel's TCP memory against its pressure threshold (/proc/sys/net/ipv4/tcp_mem).
// At the end the streams are read out: each must have been ended by the server (by its byte budget, streamBytesMax,
// or as too slow) and none may have been given much more than the budget.
// Passes when: resident memory stays at or below --limit-mb; health answers 200 within 1 s every time; every stream
// the server took was ended by it; no stream got more than --budget-kb plus one event; TCP memory (when it can be
// read) stays below the pressure threshold. Not part of `bun run check` (it takes a minute); run it before a release
// that changes the server.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2), opt = (n: string, d: number) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const str = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const SECONDS = opt("--seconds", 60), STREAMS = opt("--streams", 300), EDITS = opt("--edits", 50), LIMIT_MB = opt("--limit-mb", 150);
const BUDGET = opt("--budget-kb", 512) * 1024, ONE_EVENT = 16 * 1024;     // a full-pose applied event is about 2 kB; 16 kB is generous
const ROOT = join(import.meta.dir, "..", ".."), data = mkdtempSync(join(tmpdir(), "synergon-load-"));
// the server under test: the release in dist/, or (on the host, host check H14) a release's bundle
const bundle = str("--bundle") ?? join(ROOT, "dist", "server", "server.js");
if (!existsSync(bundle)) { console.error(`no ${bundle}: run bun run dist first, or pass --bundle <release>/server/server.js`); process.exit(2); }
const srv = Bun.spawn([process.execPath, bundle, "--mode", "deployed", "--port", "0", "--data", data, "--revision", "load"], { stdout: "pipe", stderr: "inherit" });
const port: number = JSON.parse(new TextDecoder().decode((await srv.stdout.getReader().read()).value)).listening;
// the scene the load goes to: the furnished scene the server made in the shared workspace of its empty data folder
const api = (path: string) => fetch(`http://127.0.0.1:${port}/api/${path}`).then((r) => r.json()) as Promise<any>;
const shared = (await api("workspaces")).workspaces[0].id;
const WS: string = (await api(`workspaces/${shared}`)).projects.flatMap((p: any) => p.scenes)[0].id;
const rss = () => Number(spawnSync("ps", ["-o", "rss=", "-p", String(srv.pid)], { encoding: "utf8" }).stdout.trim()) / 1024;
const cpu = () => spawnSync("ps", ["-o", "%cpu=", "-p", String(srv.pid)], { encoding: "utf8" }).stdout.trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// the kernel's TCP memory in pages, and its pressure threshold (Linux only; null elsewhere)
const tcpMem = () => { try { const m = /TCP:.*\bmem (\d+)/.exec(readFileSync("/proc/net/sockstat", "utf8")); return m ? Number(m[1]) : null; } catch { return null; } };
const tcpPressure = existsSync("/proc/sys/net/ipv4/tcp_mem") ? Number(readFileSync("/proc/sys/net/ipv4/tcp_mem", "utf8").trim().split(/\s+/)[1]) : null;
const tcpLine = () => { const m = tcpMem(); return m === null ? "TCP memory: not readable here (no /proc/net/sockstat)" : `TCP memory ${m} pages (pressure at ${tcpPressure})`; };
console.log(`server pid ${srv.pid} on ${port}: ${rss().toFixed(0)} MB at start; ${tcpLine()}`);

// streams that never read, held by a separate Python process (it reads the response head and then nothing until it is
// told to read everything out at the end). Each reader's receive buffer is 4 kB, as a slow client's closed window would be.
const holder = Bun.spawn(["python3", "-I", "-c", `
import socket, sys, time, select
socks, refused = [], 0
for i in range(${STREAMS}):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    s.connect(("127.0.0.1", ${port}))
    v = "10.%d.%d.1" % ((i // 6) % 250, i // 6)
    s.sendall(("GET /api/scenes/${WS}/live HTTP/1.1\\r\\nHost: mightwork.ai\\r\\nX-Forwarded-For: %s\\r\\n\\r\\n" % v).encode())
    head = s.recv(64)
    if not head.startswith(b"HTTP/1.1 200"): refused += 1; s.close()
    else: socks.append(s)
print(refused, flush=True)
sys.stdin.readline()                       # the load is over: read every stream out
ended, sizes = 0, []
for s in socks:
    s.setblocking(False)
    got, tail, done, quiet = 0, b"", False, time.time()
    while not done and time.time() - quiet < 3:
        r, _, _ = select.select([s], [], [], 0.2)
        if not r: continue
        try: d = s.recv(1 << 16)
        except OSError: done = True; break
        if not d: done = True; break
        got += len(d); tail = (tail + d)[-16:]; quiet = time.time()
        if tail.endswith(b"\\r\\n0\\r\\n\\r\\n"): done = True
    ended += done; sizes.append(got); s.close()
print("ended %d of %d; largest %d bytes" % (ended, len(socks), max(sizes) if sizes else 0), flush=True)
`], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
const lines = holder.stdout.getReader(), dec = new TextDecoder();
const refused = Number(dec.decode((await lines.read()).value).trim()), taken = STREAMS - refused;
await sleep(1500);
console.log(`${STREAMS} streams asked for, ${taken} taken, ${refused} refused; ${rss().toFixed(0)} MB`);

// full-pose edits: every movable joint of the scene's station in one pose.apply, spread over 50 visitors (each well under 60 a minute)
const scene = await api(`scenes/${WS}/state`), releases: any[] = (await api("catalog")).releases;
const host = scene.instances.find((i: any) => releases.find((r) => r.id === i.release)?.kind === "station");
const movable = releases.find((r) => r.id === host.release).joints.filter((j: any) => j.type !== "ball" && !j.locked);
let sent = 0, ok = 0, peak = 0, k = 0, peakTcp = 0, slowHealth = 0;
const refusals: Record<string, number> = {};
const t0 = Date.now();
const tick = setInterval(async () => {
  for (let e = 0; e < EDITS / 10; e++) {
    k++; sent++;
    const values = Object.fromEntries(movable.map((j: any) => { const f = (k % 7) / 7; return [j.id, j.lower + f * (j.upper - j.lower)]; }));
    fetch(`http://127.0.0.1:${port}/api/scenes/${WS}/command`, { method: "POST", headers: { "x-synergon": "1", "content-type": "application/json", "x-forwarded-for": `172.${16 + (k % 50)}.${k % 50}.9` }, body: JSON.stringify({ id: "pose.apply", args: { instance: host.id, values, allowAssumed: true } }) })
      .then((r) => r.json()).then((r) => { if (r.ok) ok++; else refusals[r.error?.code] = (refusals[r.error?.code] ?? 0) + 1; }).catch(() => {});
  }
}, 100);
for (let s = 5; s <= SECONDS; s += 5) {
  await sleep(5000);
  const mb = rss(); peak = Math.max(peak, mb); peakTcp = Math.max(peakTcp, tcpMem() ?? 0);
  const h0 = Date.now(), h = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.status).catch((e) => String(e.name)), hMs = Date.now() - h0;
  if (h !== 200 || hMs > 1000) slowHealth++;
  console.log(`   health: ${h} in ${hMs} ms; server cpu ${cpu()} %; in flight: ${sent - ok - Object.values(refusals).reduce((a, b) => a + b, 0)}; ${tcpLine()}`);
  console.log(`${s} s: ${mb.toFixed(0)} MB resident; ${sent} edits sent, ${ok} accepted${Object.keys(refusals).length ? ` (refused: ${JSON.stringify(refusals)})` : ""}`);
}
clearInterval(tick);
await sleep(500);
holder.stdin.write("read\n"); holder.stdin.flush();
let tailText = "";
for (const t1 = Date.now(); !/ended \d+ of \d+/.test(tailText) && Date.now() - t1 < 120_000; ) { const { value, done } = await lines.read(); if (done) break; tailText += dec.decode(value); }
const em = /ended (\d+) of (\d+); largest (\d+) bytes/.exec(tailText), ended = em ? Number(em[1]) : 0, largest = em ? Number(em[3]) : Infinity;
const tcpOk = tcpPressure === null || peakTcp < tcpPressure;
console.log(`peak ${peak.toFixed(0)} MB (limit ${LIMIT_MB} MB) after ${((Date.now() - t0) / 1000).toFixed(0)} s; health slow or failing ${slowHealth} time(s); ` +
  `${ended} of ${taken} streams ended by the server (byte budget or too slow); largest stream ${largest.toLocaleString("en")} bytes (budget ${BUDGET.toLocaleString("en")} + one event); ` +
  (tcpPressure === null ? "TCP memory not measured" : `peak TCP memory ${peakTcp} pages (pressure at ${tcpPressure})`));
holder.kill();
srv.kill(); await srv.exited; rmSync(data, { recursive: true, force: true });
const pass = peak <= LIMIT_MB && slowHealth === 0 && taken > 0 && ended === taken && largest <= BUDGET + ONE_EVENT && tcpOk;
console.log(pass ? "stream load: passed" : "stream load: FAILED");
process.exit(pass ? 0 : 1);
