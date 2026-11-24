// bun test viewer/src — the live channel's reconnect rules, with a fake EventSource and a fake clock.
// The cases are Leitbild's (apps/world/tests/realtime-reconnect.test.ts), adapted to server-sent events:
// Leitbild's "ready" is our `session` event, its WebSocket close is our EventSource error, its role set is
// the version and session code the page puts into the URL of each attempt.
import { test, expect, describe } from "bun:test";
import { createConnection, reconnectDelayMs, STALE_HIDDEN_MS, type Env } from "./live-connection.ts";

class FakeES {
  static made: FakeES[] = [];
  readyState = 0; onerror: ((e: unknown) => void) | null = null; closedByPage = false;
  private ls = new Map<string, ((m: { data: string }) => void)[]>();
  constructor(readonly url: string) { FakeES.made.push(this); }
  addEventListener(n: string, f: (m: { data: string }) => void) { this.ls.set(n, [...(this.ls.get(n) ?? []), f]); }
  close() { this.readyState = 2; this.closedByPage = true; }
  emit(n: string, data: unknown = {}) { this.readyState = 1; for (const f of this.ls.get(n) ?? []) f({ data: JSON.stringify(data) }); }
  /** the server went, the network dropped, or a locked tab's connection was closed */
  drop() { this.readyState = 0; this.onerror?.({}); }
}
function world() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; f: () => void }>();
  const target = () => { const ls = new Map<string, Set<() => void>>(); return { addEventListener: (n: string, f: () => void) => { ls.set(n, (ls.get(n) ?? new Set()).add(f)); }, removeEventListener: (n: string, f: () => void) => { ls.get(n)?.delete(f); }, fire: (n: string) => { for (const f of [...(ls.get(n) ?? [])]) f(); } }; };
  const win = target(), doc = Object.assign(target(), { visibilityState: "visible" });
  const env: Env = {
    EventSource: FakeES as any, window: win, document: doc, now: () => now,
    setTimeout: (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; },
    clearTimeout: (t) => { timers.delete(t as number); },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].f();
    }
    now = end;
  };
  return { env, win, doc, advance };
}
function setup() {
  FakeES.made = [];
  const w = world(), seen: string[] = [];
  let version = 0;
  const conn = createConnection({
    url: () => `api/live?session=ABCDEFGH${version ? `&since=${version}` : ""}`,
    event: (name, data, resync) => { if (name === "session") seen.push(resync ? "ready, resync" : "ready"); if (name === "applied") version = data.version; if (name === "snapshot") version = data.doc.version; },
    closed: (r) => seen.push(`closed, attempt ${r.attempt} in ${r.inMs} ms`),
  }, w.env);
  conn.connect();
  return { ...w, seen, conn, latest: () => FakeES.made.at(-1)!, setVersion: (v: number) => { version = v; } };
}

describe("the live channel reconnects after a close the page did not ask for", () => {
  test("close, reconnecting with backoff, ready, and that ready is one resync", () => {
    const { seen, advance, latest } = setup();
    latest().emit("session"); latest().emit("snapshot", { doc: { version: 3 } });
    latest().drop();
    expect(seen).toEqual(["ready", "closed, attempt 1 in 1000 ms"]);
    expect(FakeES.made[0].closedByPage).toBe(true);                 // the browser must not retry on its own as well
    advance(999); expect(FakeES.made.length).toBe(1);
    advance(1); expect(FakeES.made.length).toBe(2);
    expect(latest().url).toBe("api/live?session=ABCDEFGH&since=3");   // resumes from the version the page has
    // the attempt fails too: the next one waits twice as long
    latest().drop();
    advance(1999); expect(FakeES.made.length).toBe(2);
    advance(1);
    latest().emit("session"); latest().emit("applied", { version: 4 }); latest().emit("session");
    expect(seen.slice(2)).toEqual(["closed, attempt 2 in 2000 ms", "ready, resync", "ready"]);
    // a ready ends the backoff: the next close starts again at the first attempt
    latest().drop();
    expect(seen.at(-1)).toBe("closed, attempt 1 in 1000 ms");
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
  test("disconnect() never reconnects, also when it ends a reconnect under way", () => {
    let s = setup();
    s.latest().emit("session");
    s.conn.disconnect(); s.latest().drop(); s.advance(60_000);
    expect(FakeES.made.length).toBe(1); expect(s.seen).toEqual(["ready"]);
    s = setup();
    s.latest().drop(); s.conn.disconnect();
    s.doc.visibilityState = "visible"; s.doc.fire("visibilitychange"); s.win.fire("online"); s.advance(60_000);
    expect(FakeES.made.length).toBe(1); expect(s.seen).toEqual(["closed, attempt 1 in 1000 ms"]);
  });
  test("the page becoming visible again, or the network coming back, tries at once", () => {
    const s = setup();
    s.latest().drop(); s.advance(500);
    s.doc.visibilityState = "hidden"; s.doc.fire("visibilitychange");
    expect(FakeES.made.length).toBe(1);
    s.doc.visibilityState = "visible"; s.doc.fire("visibilitychange");
    expect(FakeES.made.length).toBe(2);
    // an attempt under way is not doubled; a failed one waits for the next wake or its backoff
    s.win.fire("online"); expect(FakeES.made.length).toBe(2);
    s.latest().drop(); s.win.fire("online"); expect(FakeES.made.length).toBe(3);
    // connected again: a wake changes nothing, and the backoff timer of the failed attempt is gone
    s.latest().emit("session"); s.doc.fire("visibilitychange"); s.win.fire("online"); s.advance(60_000);
    expect(FakeES.made.length).toBe(3);
  });
  test("a page hidden for a long time reconnects on becoming visible, even if its stream looks open", () => {
    const s = setup();
    s.latest().emit("session"); s.setVersion(7);
    s.doc.visibilityState = "hidden"; s.doc.fire("visibilitychange");
    s.advance(STALE_HIDDEN_MS - 1000); s.doc.visibilityState = "visible"; s.doc.fire("visibilitychange");
    expect(FakeES.made.length).toBe(1);                                // a short absence: the stream is trusted
    s.doc.visibilityState = "hidden"; s.doc.fire("visibilitychange");
    s.advance(STALE_HIDDEN_MS + 1000); s.doc.visibilityState = "visible"; s.doc.fire("visibilitychange");
    expect(FakeES.made.length).toBe(2);
    expect(FakeES.made[0].closedByPage).toBe(true);
    expect(s.latest().url).toBe("api/live?session=ABCDEFGH&since=7");
    s.latest().emit("session"); expect(s.seen.at(-1)).toBe("ready, resync");
  });
  test("each attempt carries what the page adopted last (session code, version)", () => {
    const s = setup();
    s.latest().emit("session"); s.setVersion(12); s.latest().drop(); s.advance(1000);
    expect(FakeES.made.map((e) => new URL(e.url, "http://x/").searchParams.get("since"))).toEqual([null, "12"]);
  });
});
