// Shared by the server tests: a deployed server takes no `playground` alias, so the tests that run in deployed mode and name the
// Playground by that word get its real id put in (only in the test's own Bun.serve; the server itself is untouched).
export function viaPlayground(api: { fetch(req: Request, ip: string): Promise<Response | undefined>; playground(): { id: string } | null }, req: Request, ip: string) {
  const url = new URL(req.url), alias = "/api/workspaces/playground";
  if (url.pathname === alias || url.pathname.startsWith(alias + "/")) {
    const id = api.playground()?.id;
    if (id) { url.pathname = `/api/workspaces/${id}${url.pathname.slice(alias.length)}`; req = new Request(url, req); }
  }
  return api.fetch(req, ip);
}

export type Ev = { event: string; id?: string; data: any };
/** A live-channel reader: parses the server-sent events of one workspace's live stream (`url` is its .../live address). */
export class LiveReader {
  events: Ev[] = []; code: string | null = null; status = 0; ended = false; error: any = null;
  private ctl = new AbortController();
  ready: Promise<void>;
  constructor(public url: string, headers: Record<string, string> = {}) {
    let opened!: () => void;
    this.ready = new Promise((r) => (opened = r));
    (async () => {
      try {
        const res = await fetch(url, { headers, signal: this.ctl.signal });
        this.status = res.status;
        if (!res.ok) { this.error = await res.json(); opened(); this.ended = true; return; }
        const reader = res.body!.getReader(), dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) { this.block(buf.slice(0, i)); buf = buf.slice(i + 2); if (this.code) opened(); }
        }
      } catch { /* aborted or dropped */ }
      this.ended = true; opened();
    })();
  }
  private block(b: string) {
    let event = "message", id: string | undefined;
    const data: string[] = [];
    for (const line of b.split("\n")) {
      if (line.startsWith(":")) continue;
      const k = line.slice(0, line.indexOf(":")), v = line.slice(line.indexOf(":") + 1).replace(/^ /, "");
      if (k === "event") event = v; else if (k === "id") id = v; else if (k === "data") data.push(v);
    }
    if (!data.length) return;
    const d = JSON.parse(data.join("\n"));
    if (event === "session") this.code = d.code;
    this.events.push({ event, id, data: d });
  }
  of = (event: string) => this.events.filter((e) => e.event === event);
  async waitFor(pred: (e: Ev) => boolean, ms = 3000): Promise<Ev> {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await Bun.sleep(10)) { const e = this.events.find(pred); if (e) return e; }
    throw new Error(`timed out; events so far: ${JSON.stringify(this.events.map((e) => e.event))}`);
  }
  async waitEnded(ms = 3000) { for (const t0 = Date.now(); Date.now() - t0 < ms && !this.ended; await Bun.sleep(10)); return this.ended; }
  close() { this.ctl.abort(); }
}
