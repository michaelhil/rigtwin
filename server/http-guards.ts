// Request guards shared by the public scene server and the internal station harness: who a visitor is and how often
// they may act.
export const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\]|[a-z0-9.-]+\.localhost)(:\d+)?$/i;
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
export class RateWindow {
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

