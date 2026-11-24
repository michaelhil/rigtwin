// The live channel's connection: one EventSource at a time, reconnected by this page (not by the browser's
// own retry, which gives up after an error answer and cannot be told to back off or to resume elsewhere).
// No engine import, so it can be tested with a fake EventSource and a fake clock (live-connection.test.ts).
// The cases follow Leitbild's realtime reconnect test (apps/world/tests/realtime-reconnect.test.ts):
//   - a close the page did not ask for reconnects by itself, after 1 s, then 2, 4, 8, 16 and at most 30 s;
//     the first event of a stream (`session`) ends the backoff;
//   - the first event after a reconnect is reported once as a resync (the server then sends the snapshot or the
//     entries after Last-Event-ID / since=; the page applies whichever comes, once);
//   - disconnect() never reconnects, also when it ends a reconnect under way or a wake comes later;
//   - the page becoming visible again, or the browser coming back online, tries at once (an attempt under way
//     is not doubled); a page that was hidden for a long time reconnects on becoming visible even if its stream
//     still looks open (a locked device's connection can be dead without an error);
//   - every attempt asks for the url() of that moment (the version and session code the page last adopted).
// Ours, not Leitbild's: the server ends a stream that has been given its byte budget with an `end` event; the page
// then reconnects at once, without counting an attempt (unless the stream lasted under a second: then the backoff).
export const reconnectDelayMs = (attempt: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
/** a page hidden longer than this reconnects when it becomes visible, whatever its stream says */
export const STALE_HIDDEN_MS = 30_000;

interface ES { readyState: number; onerror: ((e: any) => void) | null; addEventListener(name: string, f: (m: any) => void): void; close(): void }
export interface Env {
  EventSource: new (url: string) => ES;
  window: { addEventListener(name: string, f: () => void): void; removeEventListener(name: string, f: () => void): void };
  document: { visibilityState: string; addEventListener(name: string, f: () => void): void; removeEventListener(name: string, f: () => void): void };
  setTimeout(f: () => void, ms: number): unknown; clearTimeout(t: unknown): void; now(): number;
}
export interface Handlers {
  /** the URL of the next attempt (it carries the version and session code the page has now) */
  url(): string;
  /** an event of the stream; `resync` is true for the first event after a reconnect */
  event(name: string, data: any, resync: boolean): void;
  /** the stream closed without being asked to; `attempt` and `inMs` say when the next try is */
  closed?(retry: { attempt: number; inMs: number }): void;
}

export function createConnection(h: Handlers, env: Env) {
  let es: ES | null = null, ready = false, attempt = 0, timer: unknown = null, stopped = false, everReady = false, hiddenSince = 0;
  const NAMES = ['session', 'snapshot', 'applied', 'view', 'trace'];
  function open() {
    if (stopped) return;
    if (timer !== null) { env.clearTimeout(timer); timer = null; }
    const me = new env.EventSource(h.url()), resumed = everReady, openedAt = env.now();
    es = me; ready = false;
    let first = true;
    me.addEventListener('end', () => {
      if (es !== me) return;
      if (env.now() - openedAt < 1000) { drop(); return; }
      try { me.close(); } catch { /* closed */ } es = null; ready = false; open();
    });
    for (const name of NAMES) me.addEventListener(name, (m) => {
      if (es !== me) return;
      if (name === 'session') { ready = true; everReady = true; attempt = 0; }
      h.event(name, JSON.parse(m.data), first && resumed);
      first = false;
    });
    me.onerror = () => { if (es === me) drop(); };
  }
  /** the stream ended or could not be opened: close it (the browser must not retry on its own) and wait */
  function drop() {
    if (es) { try { es.close(); } catch { /* closed */ } es = null; }
    ready = false;
    if (stopped || timer !== null) return;
    attempt++;
    const inMs = reconnectDelayMs(attempt);
    h.closed?.({ attempt, inMs });
    timer = env.setTimeout(() => { timer = null; open(); }, inMs);
  }
  /** a wake: try at once when no stream is open and none is being opened */
  function wake() { if (!stopped && !es) open(); }
  const onVisible = () => {
    if (env.document.visibilityState !== 'visible') { hiddenSince = env.now(); return; }
    const long = hiddenSince && env.now() - hiddenSince > STALE_HIDDEN_MS;
    hiddenSince = 0;
    if (long && es && ready) { try { es.close(); } catch { /* closed */ } es = null; ready = false; open(); }
    else wake();
  };
  const onOnline = () => wake();
  return {
    connect() { stopped = false; env.document.addEventListener('visibilitychange', onVisible); env.window.addEventListener('online', onOnline); open(); },
    /** ends the channel for good: nothing reconnects after this */
    disconnect() {
      stopped = true;
      if (timer !== null) { env.clearTimeout(timer); timer = null; }
      if (es) { try { es.close(); } catch { /* closed */ } es = null; }
      env.document.removeEventListener('visibilitychange', onVisible); env.window.removeEventListener('online', onOnline);
    },
    state: () => ({ connected: ready, attempt, waiting: timer !== null, stopped }),
  };
}
