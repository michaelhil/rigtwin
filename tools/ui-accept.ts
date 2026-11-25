// bun tools/ui-accept.ts [--viewer <dir>] [--origin <url>] [--baseline <url>] [--shots <dir>] [--json <file>] [--only T12,T31]
// Acceptance tests of the viewer page, driven like a person would: headless Chromium, real pointer,
// wheel and key events through the DevTools protocol, a fresh page per test. Combines the checklists
// of the two interaction reviews (work/ux/review-A.md section 5, review-B.md section 7).
//   --viewer    viewer source directory to serve (default: RIGTWIN_VIEWER_DIR or "viewer")
//   --origin    test an already running server instead of starting one
//   --baseline  a second running server with the previous viewer: machine-interface pictures are compared with it
//   --shots     where the screenshots go (default work/renders/ui-accept)
// Exit code 1 when a test fails. Results are printed as a table and written as JSON.
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { ROOT, timeline } from "./timeline.ts";
import { Browser, Page } from "./render.ts";

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
if (opt("--viewer")) process.env.RIGTWIN_VIEWER_DIR = opt("--viewer");
const SHOTS = opt("--shots") ? join(ROOT, opt("--shots")!) : join(ROOT, "work", "renders", "ui-accept");
const ONLY = opt("--only")?.split(",");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SIZES: [number, number][] = [[1440, 900], [1024, 768], [390, 800]];
const JARGON = [/\b[CJSD]_[a-z0-9_]+/, /\btris\b/i, /\btriangles\b/i, /\bfps\b/i, /draw calls/i, /\bprismatic\b/i, /\brevolute\b/i, /\bOrthographic\b/i, /\bWireframe\b/i, /\bJoints\b/, /Reference frames/i, /\bIsolate\b/i,
  /\bpod\b/i, /\broll\b/i, /\bpitch\b/i, /\bpan\b/i, /\bassembly\b/i, /active area/i, /\binvented\b/i, /no parameters/i, /\blocked\b/i, /\bevidence\b/i, /\bsignal\b/i, /\bdatum\b/i, /\bvendor\b/i];

// ---------------------------------------------------------------------------------------------- driver
class Session {
  x = 0; y = 0; actions = 0; log: string[] = [];
  constructor(public page: Page, public w: number, public h: number) {}
  ev<T = any>(js: string): Promise<T> { return this.page.evaluate(js); }
  state(): Promise<any> { return this.ev("viewer.state()"); }
  async settle(ms = 450) { await sleep(ms); }
  async move(x: number, y: number, steps = 6) {
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= steps; i++) await this.page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x - x0) * i) / steps, y: y0 + ((y - y0) * i) / steps, buttons: 0 });
    this.x = x; this.y = y; await sleep(70);
  }
  async click(x: number, y: number, what = "", count = 1) {
    await this.move(x, y);
    for (let c = 1; c <= count; c++) {
      await this.page.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: c });
      await this.page.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: c });
    }
    this.actions++; this.log.push(`${count === 2 ? "double-click" : "click"} ${what}`); await sleep(140);
  }
  async drag(x0: number, y0: number, x1: number, y1: number, what = "", button: "left" | "right" = "left", steps = 14) {
    await this.move(x0, y0);
    const b = button === "left" ? 1 : 2;
    await this.page.call("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button, buttons: b, clickCount: 1 });
    for (let i = 1; i <= steps; i++) { await this.page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button, buttons: b }); await sleep(12); }
    await this.page.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button, buttons: 0, clickCount: 1 });
    this.x = x1; this.y = y1; this.actions++; this.log.push(`drag ${what}`); await sleep(380);
  }
  async wheel(x: number, y: number, deltaY: number, ticks = 1) {
    await this.move(x, y);
    for (let i = 0; i < ticks; i++) { await this.page.call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY }); await sleep(45); }
    this.actions++; await sleep(420);
  }
  async key(key: string) {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key, vk = key === "Escape" ? 27 : key.toUpperCase().charCodeAt(0);
    await this.page.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk });
    await this.page.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
    this.actions++; await sleep(140);
  }
  /** rectangle of a DOM element given by a JS expression, or null when it is absent or not displayed */
  rect(js: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
    return this.ev(`(() => { const e = ${js}; if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  }
  async clickEl(js: string, what: string) { const r = await this.rect(js); if (!r) throw new Error(`not on screen: ${what}`); await this.click(r.x + r.w / 2, r.y + r.h / 2, what); }
  /** a visible button (or summary / label) by its exact text, optionally inside a container */
  byText(text: string, inside = "document") { return `[...${inside}.querySelectorAll('button, summary, label')].find((b) => b.getClientRects().length && b.textContent.trim() === ${JSON.stringify(text)})`; }
  /** drag a range input's thumb to a value in the slider's own units */
  async slide(js: string, value: number, what: string) {
    const r = await this.rect(js); if (!r) throw new Error(`slider not on screen: ${what}`);
    const i = await this.ev(`(() => { const e = ${js}; return { min: +e.min, max: +e.max, v: +e.value, dis: e.disabled }; })()`);
    const pad = 8, px = (v: number) => r.x + pad + ((v - i.min) / (i.max - i.min)) * (r.w - 2 * pad);
    await this.drag(px(i.v), r.y + r.h / 2, px(value), r.y + r.h / 2, `slider ${what}`);
  }
  /** a card slider by its label text */
  slider(label: string) { return `[...document.querySelectorAll('#card .adj')].find((a) => a.querySelector('label')?.textContent === ${JSON.stringify(label)})?.querySelector('input[type=range]')`; }
  /** viewport pixel in the middle of what is visible of a component (sampled with the page's own picking, inside the part's projected box) */
  async find(id: string, step = 5): Promise<[number, number]> {
    const p = await this.ev<[number, number] | null>(`(() => { const c = document.getElementById('gl').getBoundingClientRect(), pts = []; let sx = 0, sy = 0;
      const m = viewer.manifest(), it = [...m.components, ...m.surfaces].find((x) => x.id === ${JSON.stringify(id)}); let x0 = 0, y0 = 0, x1 = c.width, y1 = c.height;
      if (it && it.bbox) { const xs = [], ys = []; for (const X of [it.bbox.min[0], it.bbox.max[0]]) for (const Y of [it.bbox.min[1], it.bbox.max[1]]) for (const Z of [it.bbox.min[2], it.bbox.max[2]]) { const q = viewer.project([X, Y, Z]); xs.push(q[0]); ys.push(q[1]); }
        x0 = Math.max(0, Math.min(...xs) - 50); x1 = Math.min(c.width, Math.max(...xs) + 50); y0 = Math.max(0, Math.min(...ys) - 50); y1 = Math.min(c.height, Math.max(...ys) + 50); }
      for (let y = y0 + 2; y < y1; y += ${step}) for (let x = x0 + 2; x < x1; x += ${step}) { const h = viewer.pickAt(x, y); if (h && h.id === ${JSON.stringify(id)} && document.elementFromPoint(c.left + x, c.top + y) === document.getElementById('gl')) { sx += x; sy += y; pts.push([x, y]); } }
      if (!pts.length) return null; const mx = sx / pts.length, my = sy / pts.length;
      // nearest the middle first, and not where the person sits in front of the part (a click there is the person's)
      pts.sort((p, q) => Math.hypot(p[0] - mx, p[1] - my) - Math.hypot(q[0] - mx, q[1] - my));
      const best = pts.slice(0, 400).find((q) => !(viewer.personPanel && viewer.personPanel.covers(q[0], q[1]))); if (!best) return null;
      return [c.left + best[0], c.top + best[1]]; })()`);
    if (!p) throw new Error(`${id} is not visible in the 3D view`);
    return p;
  }
  /** a pixel of the 3D view where nothing is drawn */
  async empty(): Promise<[number, number]> {
    return this.ev(`(() => { const c = document.getElementById('gl').getBoundingClientRect(); for (const [fx, fy] of [[0.08, 0.5], [0.5, 0.06], [0.1, 0.12], [0.06, 0.9]]) { const x = c.width * fx, y = c.height * fy; if (!viewer.pickAt(x, y) && !(viewer.person && viewer.person.pickAt && viewer.person.pickAt(x, y)) && document.elementFromPoint(c.left + x, c.top + y) === document.getElementById('gl')) return [c.left + x, c.top + y]; } return null; })()`);
  }
  async shot(name: string) { await sleep(250); const f = join(SHOTS, `${name}.png`); await this.page.screenshot(f); return f; }
  async close() { await this.page.close(); }
}

// ---------------------------------------------------------------------------------------------- run
const INVENTORY = `(() => {
  const vis = (e) => { if (!e.getClientRects().length) return false; const s = getComputedStyle(e); if (s.visibility === 'hidden' || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && r.width > 0; };
  const controls = [...document.querySelectorAll('button, input, select, summary, [role=button], [role=slider]')].filter(vis);
  const text = document.body.innerText.replace(/\\s+/g, ' ').trim();
  const titles = [...document.querySelectorAll('[title]')].filter(vis).map((e) => e.title);
  const c = document.getElementById('gl').getBoundingClientRect();
  const tree = document.getElementById('tree');
  return { controls: controls.length, sliders: controls.filter((e) => e.type === 'range').length, disabled: controls.filter((e) => e.disabled).length,
    small: controls.map((e) => { const r = (e.closest('label') ?? e).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), (e.textContent || e.getAttribute('aria-label') || e.id || e.tagName).trim().slice(0, 30)]; }).filter((r) => r[0] < 24 || r[1] < 24),
    words: text ? text.split(' ').length : 0, text, titles,
    canvas: [Math.round(c.width), Math.round(c.height)], share: (c.width * c.height) / (innerWidth * innerHeight),
    rows: [...document.querySelectorAll('#tree .row')].filter(vis).length, treeScrolls: tree ? tree.scrollHeight > tree.clientHeight + 1 : false,
    cut: [...document.querySelectorAll('#tree .label')].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
    padlock: !!document.querySelector('[aria-label=locked], .locked'), cursor: getComputedStyle(document.getElementById('gl')).cursor };
})()`;

interface Result { id: string; name: string; pass: boolean; value: string; limit: string; warn?: boolean }
const results: Result[] = [];
/** `warn`: passed, but the figure cannot be trusted (a loaded machine); printed as "warn" and kept in the JSON */
const record = (id: string, name: string, pass: boolean, value: unknown, limit = "", warn = false) => { results.push({ id, name, pass, value: String(value), limit, ...(warn ? { warn } : {}) }); console.log(`${warn ? "warn" : pass ? "ok  " : "FAIL"} ${id} ${name}: ${value}${limit ? `   (limit: ${limit})` : ""}`); };

let server: { stop: (force?: boolean) => void; port: number; reset: () => void } | null = null, ORIGIN = opt("--origin") ?? "";
// the shared scene lives in an empty temporary folder, emptied again before every page (each test starts from a fresh Playground)
if (!ORIGIN) { const { startServer } = await import("./serve.ts"); server = await startServer({ port: 0, data: "temp" }); ORIGIN = `http://127.0.0.1:${server!.port}`; }
const BASELINE = opt("--baseline");
mkdirSync(SHOTS, { recursive: true });
const browser = await Browser.launch();
const allErrors: string[] = [];
async function open(w: number, h: number, query = "", origin = ORIGIN): Promise<Session> {
  if (origin === ORIGIN) server?.reset();
  const page = await browser.page("about:blank");
  await page.viewport(w, h);
  await page.call("Page.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  await page.call("Page.navigate", { url: `${origin}/${query}` });
  await page.waitFor("window.viewerReady || window.viewerError", "the viewer");
  const err = await page.evaluate("window.viewerError || null"); if (err) throw new Error(`viewer error: ${err}`);
  await sleep(350);
  // the person arrives after the page is ready (T10b): every test works on the page as people see it, with the person in the seat
  await page.evaluate("window.viewer.person ? viewer.person.ready : null").catch(() => null);
  const s = new Session(page, w, h); s.x = w / 2; s.y = h / 2;
  return s;
}
async function test(id: string, name: string, fn: () => Promise<void>) {
  if (ONLY && !ONLY.includes(id)) return;
  const before = results.length;
  try { await fn(); } catch (e: any) { record(id, name, false, `error: ${e.message}`); }
  if (results.length === before) record(id, name, false, "the test recorded nothing");
}
const close = async (s: Session) => { allErrors.push(...s.page.errors); await s.close(); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** joint definitions of the model under test (the model is rebuilt by others; never assume its numbers) */
const defs = async (s: Session): Promise<Record<string, { neutral: any; lower: number; upper: number }>> => s.ev("Object.fromEntries(viewer.manifest().joints.map((j) => [j.id, { neutral: j.neutral, lower: j.lower, upper: j.upper }]))");
const moved = (a: any, b: any) => dist(a.position, b.position) + dist(a.target, b.target);
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const t0 = performance.now();

// ---- first view ---------------------------------------------------------------------------------------
await test("T01", "controls visible by default (1440×900)", async () => {
  const s = await open(1440, 900), inv = await s.ev(INVENTORY);
  await s.shot("after-01-default-1440");
  record("T01", "controls visible by default (1440×900)", inv.controls <= 20, inv.controls, "≤ 20 (review A), ≤ 25 (review B); was 103");
  record("T02", "words on screen by default", inv.words <= 60, inv.words, "≤ 60; was 396");
  const hits = JARGON.filter((re) => re.test(inv.text)).map(String);
  record("T03", "jargon terms visible by default", hits.length === 0, hits.length ? hits.join(" ") : 0, "0");
  record("T04", "sliders / disabled controls / padlocks by default", inv.sliders === 0 && inv.disabled === 0 && !inv.padlock, `${inv.sliders} / ${inv.disabled} / ${inv.padlock ? 1 : 0}`, "0 / 0 / 0");
  record("T06", "parts-list rows by default; list scrolls", inv.rows <= 8 && !inv.treeScrolls, `${inv.rows} rows; scrolls: ${inv.treeScrolls}`, "≤ 8, no scroll");
  record("T08", "pointer targets smaller than 24×24 px", inv.small.length === 0, inv.small.length ? JSON.stringify(inv.small) : 0, "0; was 65");
  record("T09", "cursor over the 3D view", inv.cursor !== "auto", inv.cursor, "not auto");
  record("T11", "row labels cut off", inv.cut.length === 0, inv.cut.length, "0");
  await close(s);
});
await test("T05", "share of the window given to the 3D view", async () => {
  const out: string[] = []; let ok = true;
  for (const [w, h] of SIZES) {
    const s = await open(w, h), inv = await s.ev(INVENTORY), need = w >= 1440 ? 0.8 : w >= 1000 ? 0.7 : 0.55;
    ok &&= inv.share >= need && (w > 400 || inv.canvas[0] >= 360);
    out.push(`${w}×${h}: ${(inv.share * 100).toFixed(1)} % (canvas ${inv.canvas[0]}×${inv.canvas[1]})`);
    if (w !== 1440) await s.shot(`after-${w === 390 ? "08-narrow-390" : "07-default-1024"}`);
    await close(s);
  }
  record("T05", "share of the window given to the 3D view", ok, out.join("; "), "≥ 80 % at 1440, ≥ 70 % at 1024, ≥ 55 % and ≥ 360 px wide at 390; was 58 / 41 / 0 %");
});
await test("T07", "hint line", async () => {
  const s = await open(1440, 900);
  const before = await s.ev<string>("document.getElementById('hint').getClientRects().length ? document.getElementById('hint').textContent : ''");
  const [ex, ey] = await s.empty(); await s.drag(ex, ey, ex + 60, ey + 20, "empty space"); await sleep(900);
  const after = await s.ev<boolean>("!!document.getElementById('hint').getClientRects().length");
  await close(s);
  const u = await open(1440, 900, "?ui=0"), noUi = await u.ev<boolean>("!!document.getElementById('hint').getClientRects().length"); await close(u);
  record("T07", "hint line", /rotate/.test(before) && /zoom/.test(before) && !after && !noUi, `"${before}"; after one drag: ${after ? "still there" : "gone"}; with ui=0: ${noUi ? "shown" : "absent"}`);
});
await test("T10", "load", async () => {
  const s = await open(1440, 900);
  // the scripts the page loads before it is ready (the person chunk comes after, on its own budget: T10b)
  const m = await s.ev(`(() => { const n = performance.getEntriesByType('navigation')[0], r = performance.getEntriesByType('resource'), at = window.viewerReadyAt ?? Infinity, js = (e) => e.initiatorType === 'script' || /\\.m?js(\\?|$)/.test(e.name), before = r.filter((e) => e.startTime <= at); return { bytes: n.transferSize + before.reduce((a, e) => a + e.transferSize, 0), body: n.decodedBodySize + before.reduce((a, e) => a + e.decodedBodySize, 0), requests: before.length + 1, js: before.filter(js).reduce((a, e) => a + e.decodedBodySize, 0), scripts: before.filter(js).length }; })()`);
  const t = performance.now(); const p = await browser.page("about:blank"); await p.viewport(1440, 900); await p.call("Page.navigate", { url: `${ORIGIN}/` }); await p.waitFor("window.viewerReady", "viewer"); const ready = performance.now() - t; await p.close();
  // Every script the default page loads before it is ready counts, against 800 kB in all (step-1 checkpoint review): the live client is a
  // default feature the owner asked for, so splitting it out would only move bytes the visitor loads anyway. Only modules that load after
  // the page is ready (the person, T10b) are split, each with its own budget. "Ready in at most 1 s" stays.
  record("T10", "load: ready time; download", ready <= 1000 && m.js <= 800e3, `${ready.toFixed(0)} ms navigate-to-ready; ${(m.body / 1e6).toFixed(2)} MB in ${m.requests} requests before ready (${m.scripts} script(s), ${(m.js / 1e3).toFixed(0)} kB)`, "≤ 1 s; every script the page loads before it is ready ≤ 800 kB in all (was 760 kB for viewer.js alone, 687 kB at the reviews); the rest is the model and its description file");
  await close(s);
});
await test("T10b", "the person arrives after the rig, with a loading line", async () => {
  const t = performance.now(); const p = await browser.page("about:blank"); await p.viewport(1440, 900); await p.call("Page.navigate", { url: `${ORIGIN}/` });
  await p.waitFor("window.viewerReady", "viewer"); const ready = performance.now() - t;
  const line = await p.waitFor("(() => { const e = document.querySelector('.person-status'); return e && !e.hidden ? e.textContent : null; })()", "the loading line", 5000).catch(() => "");
  const ok = await p.waitFor("viewer.person ? viewer.person.ready.then((ok) => ok ? 'yes' : 'no') : null", "the person", 30000).catch(() => "timeout"); const shown = performance.now() - t;
  const st = await p.evaluate("viewer.person ? viewer.person.state() : null");
  const m = await p.evaluate(`(() => { const at = window.viewerReadyAt ?? 0, r = performance.getEntriesByType('resource').filter((e) => e.startTime > at), js = (e) => /\\.m?js(\\?|$)/.test(e.name); return { js: r.filter(js).reduce((a, e) => a + e.decodedBodySize, 0), bytes: r.reduce((a, e) => a + e.transferSize, 0), requests: r.length }; })()`);
  const gone = await p.evaluate("(() => { const e = document.querySelector('.person-status'); return !e || e.hidden; })()");
  await p.close();
  record("T10b", "person after the rig: loading line, then shown", ok === "yes" && !!st?.shown && /Loading the person/.test(line) && gone && m.js <= 450e3 && shown - ready <= 6000, `rig ready ${ready.toFixed(0)} ms; "${line}"; person shown ${shown.toFixed(0)} ms after navigating (${(shown - ready).toFixed(0)} ms after ready); ${(m.js / 1e3).toFixed(0)} kB of scripts and ${(m.bytes / 1e6).toFixed(1)} MB in ${m.requests} requests after ready; line gone: ${gone}`, "a visible loading line; the person shown within 6 s of the rig on this machine; the person's scripts ≤ 450 kB (its chunk with the person panel since c85e5e8, 357 kB, and three's KTX2 transcoder, 58 kB; was 400 kB before the panel)");
});

// ---- show and hide ------------------------------------------------------------------------------------
await test("T12", "hide the monitor: click it, Hide", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("S_mon_screen"); await s.click(x, y, "monitor (its picture)");
  const sel = (await s.state()).selected;
  await s.shot("after-02-monitor-selected-1440");
  await s.clickEl(s.byText("Hide", "document.getElementById('card')"), "Hide");
  const st = await s.state(), n = s.actions, gone = st.hidden.includes("C_stand_monitor") && st.hidden.includes("S_mon_screen");
  const left = await s.ev<number>(`(() => { const c = document.getElementById('gl'); let k = 0; for (let y = 4; y < c.clientHeight; y += 8) for (let x = 4; x < c.clientWidth; x += 8) { const h = viewer.pickAt(x, y); if (h && (h.id === 'C_stand_monitor' || h.id === 'S_mon_screen')) k++; } return k; })()`);
  await s.clickEl(s.byText("Show", "document.getElementById('card')"), "Show");
  const back = (await s.state()).hidden.length === 0;
  record("T12", "hide the monitor: click it, Hide", gone && left === 0 && n <= 2 && back && s.actions <= 3, `${n} actions to hide (selected '${sel}'; monitor pixels left: ${left}); ${s.actions} actions to hide and bring back`, "≤ 2 and ≤ 3, no scrolling; was 4 with a trap");
  await close(s);
  const t = await open(1440, 900); const [tx, ty] = await t.find("S_ts_screen", 3); await t.click(tx, ty, "touchscreen"); await t.clickEl(t.byText("Hide", "document.getElementById('card')"), "Hide");
  const h2 = (await t.state()).hidden;
  record("T12b", "hide the touchscreen the same way", h2.includes("C_ts_screen") && h2.includes("S_ts_screen") && t.actions === 2, `${t.actions} actions; hidden: ${h2.join(", ")}`, "2 actions");
  await close(t);
});
await test("T13", "hide a whole group", async () => {
  const s = await open(1440, 900);
  await s.clickEl("document.querySelector('#tree .group:nth-child(5) .row.top .eye')", "eye of the fifth row");
  const st = await s.state(), label = await s.ev<string>("document.querySelector('#tree .group:nth-child(5) .label').textContent");
  const showAll = await s.rect(s.byText("Show all"));
  record("T13", "hide a whole group", s.actions === 1 && st.hidden.length > 0, `${s.actions} click on the eye of "${label}": ${st.hidden.length} items hidden`, "1 click, no scrolling");
  await s.shot("after-05b-group-hidden-strip-1440");
  await s.clickEl(s.byText("Show all"), "Show all");
  record("T14", "\"Show all\" on screen whenever something is hidden", !!showAll && (await s.state()).hidden.length === 0, `visible: ${!!showAll}; one click shows everything again: ${(await s.state()).hidden.length === 0}`);
  for (const sel of await s.ev<string[]>("[...document.querySelectorAll('#tree .row.top .eye')].map((e, i) => i)")) await s.clickEl(`document.querySelectorAll('#tree .row.top .eye')[${sel}]`, "eye");
  const drawn = (await s.state()).render.triangles, sa = await s.rect(s.byText("Show all")), txt = await s.ev<string>("document.getElementById('empty').getClientRects().length ? document.getElementById('empty').textContent : ''");
  record("T14b", "empty stage always offers a way back", !!sa && /hidden/.test(txt), `everything hidden: message "${txt.trim()}", Show all visible: ${!!sa} (triangles drawn: ${drawn})`);
  await close(s);
});
await test("T15", "a click on a screen picks the monitor / touchscreen, never its picture surface", async () => {
  const s = await open(1440, 900); const got: string[] = [];
  for (const id of ["S_mon_screen", "S_ts_screen"]) { const [x, y] = await s.find(id, 3); await s.click(x, y, id); got.push(`${id} → ${(await s.state()).selected} ("${await s.ev("document.querySelector('#card h2').textContent")}")`); await s.key("Escape"); }
  record("T15", "a click on a screen picks the monitor / touchscreen, never its picture surface", !got.some((g) => /→ S_|active area/.test(g)), got.join("; "));
  await close(s);
});
await test("T16", "show only the seat: click it, Show only this", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("C_seat_back_shell"); await s.click(x, y, "seat back");
  await s.clickEl(s.byText("Show only this"), "Show only this");
  const st = await s.state(), m = await s.ev<any>("viewer.manifest()");
  const all = [...m.components, ...m.surfaces].filter((c: any) => c.triangles > 0), shown = all.filter((c: any) => !st.hidden.includes(c.id));
  const seat = all.filter((c: any) => c.group === "seat");
  await s.shot("after-10-show-only-seat-1440");
  record("T16", "show only the seat: click it, Show only this", s.actions === 2 && shown.length === seat.length && shown.every((c: any) => c.group === "seat"), `${s.actions} actions; ${shown.length} of ${seat.length} seat parts shown, ${shown.filter((c: any) => c.group !== "seat").length} others`, "2 actions, all seat parts, nothing else; was 4–6 leaving one mesh");
  await close(s);
});

// ---- selection, keys, camera --------------------------------------------------------------------------
await test("T17", "Esc clears the selection; clicking the selected part again does not", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("C_stand_monitor", 4).catch(() => s.find("S_mon_screen")); await s.click(x, y, "monitor"); await sleep(500); await s.click(x, y, "monitor again");
  const again = (await s.state()).selected; await s.key("Escape"); const esc = (await s.state()).selected;
  await s.click(x, y, "monitor"); const [ex, ey] = await s.empty(); await s.click(ex, ey, "empty space"); const emp = (await s.state()).selected;
  record("T17", "Esc clears the selection; clicking the selected part again does not", again === "C_stand_monitor" && esc === null && emp === null, `after second click: ${again}; after Esc: ${esc}; after a click on empty space: ${emp}`);
  await close(s);
});
await test("T18", "keys H, I, A, F", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("S_mon_screen"); await s.click(x, y, "monitor");
  await s.key("h"); const h = (await s.state()).hidden; await s.key("a"); const a = (await s.state()).hidden;
  await s.key("i"); const i = (await s.state()).hidden; await s.key("a");
  const c0 = (await s.state()).camera; await s.key("f"); await s.settle(700); const c1 = (await s.state()).camera;
  const all = await s.ev<number>("[...viewer.manifest().components, ...viewer.manifest().surfaces].filter((c) => c.triangles > 0).length");
  record("T18", "keys H, I, A, F", h.length === 2 && a.length === 0 && i.length === all - 2 && dist(c0.position, c1.position) > 0.3, `H hides ${h.length} items; A leaves ${a.length} hidden; I leaves ${all - i.length} shown; F moves the camera ${dist(c0.position, c1.position).toFixed(2)} m`);
  await close(s);
});
await test("T19", "double-click a part zooms to it", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("C_joy_lever_R", 3); await s.click(x, y, "right joystick", 2); await s.settle(800);
  const st = await s.state(), box = await s.ev<any>("(() => { const m = viewer.manifest().components; const b = ['C_joy_base_R', 'C_joy_lever_R'].map((id) => m.find((c) => c.id === id).bbox); return [0, 1, 2].map((k) => (Math.min(b[0].min[k], b[1].min[k]) + Math.max(b[0].max[k], b[1].max[k])) / 2); })()");
  await s.shot("after-11-zoomed-to-joystick-1440");
  record("T19", "double-click a part zooms to it", dist(st.camera.target, box) < 0.1 && s.actions === 1, `selected ${st.selected}; camera target ${dist(st.camera.target, box).toFixed(3)} m from the joystick's centre; camera ${dist(st.camera.position, st.camera.target).toFixed(2)} m away`, "< 0.1 m; was not available");
  await close(s);
});
await test("T20", "active view button stays readable under the pointer", async () => {
  const s = await open(1440, 900);
  await s.clickEl(s.byText("More"), "More"); await s.clickEl(s.byText("Front"), "Front");
  const c = await s.ev<string[]>(`(() => { const b = ${s.byText("Front")}, st = getComputedStyle(b); return [st.color, st.backgroundColor, String(b.matches(':hover'))]; })()`);
  record("T20", "active view button stays readable under the pointer", c[0] !== c[1] && c[2] === "true", `text ${c[0]} on ${c[1]} while hovered`);
  await close(s);
});
await test("T22", "rotate fully with three drags; zoom to the right joystick with the wheel alone", async () => {
  const s = await open(1440, 900);
  const az = async () => { const c = (await s.state()).camera; return Math.atan2(c.position[1] - c.target[1], c.position[0] - c.target[0]); };
  const [ex, ey] = await s.empty(); let total = 0, a = await az();
  for (let i = 0; i < 3; i++) { await s.drag(ex, ey, ex + 300, ey, "rotate"); await s.settle(600); const b = await az(); let d = a - b; while (d < -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI; total += Math.abs(d); a = b; }
  await close(s);
  const z = await open(1440, 900);
  const [x, y] = await z.find("C_joy_lever_R", 3);
  const measure = () => z.ev<any>("(() => { const m = viewer.manifest().components, f = viewer.state().frame; const ys = [], xs = []; for (const id of ['C_joy_base_R', 'C_joy_lever_R']) { const b = m.find((c) => c.id === id).bbox; for (const X of [b.min[0], b.max[0]]) for (const Y of [b.min[1], b.max[1]]) for (const Z of [b.min[2], b.max[2]]) { const p = viewer.project([X, Y, Z]); xs.push(p[0]); ys.push(p[1]); } } return { h: (Math.max(...ys) - Math.min(...ys)) / f.h, cx: (Math.max(...xs) + Math.min(...xs)) / 2 / f.w, cy: (Math.max(...ys) + Math.min(...ys)) / 2 / f.h }; })()");
  let g = await measure(), notches = 0; const h0 = g.h;
  while (g.h < 0.3 && notches < 40) { await z.wheel(x, y, -100, 1); notches++; g = await measure(); }
  await z.shot("after-12-wheel-zoom-on-joystick-1440");
  record("T22", "rotate fully with three drags; zoom to the right joystick with the wheel alone", total > 1.9 * Math.PI && notches <= 15 && g.h >= 0.3 && g.cx > 0.05 && g.cx < 0.95 && g.cy > 0.05 && g.cy < 0.95, `3 drags of 300 px turn the view ${(total * 180 / Math.PI).toFixed(0)}°; ${notches} wheel notches with the pointer on the joystick bring it from ${(h0 * 100).toFixed(0)} % to ${(g.h * 100).toFixed(0)} % of the view height, centred at ${(g.cx * 100).toFixed(0)} % / ${(g.cy * 100).toFixed(0)} % of the view, no panning`, "360°; ≤ 15 notches to reach 30 %, joystick inside the view; was 35–40 notches plus a hidden right-drag");
  await close(z);
});
await test("T23", "operator's-eye view: reach it, look around in place", async () => {
  const s = await open(1440, 900);
  await s.clickEl(s.byText("More"), "More"); await s.clickEl("[...document.querySelectorAll('#more button')].find((b) => /Operator/.test(b.textContent))", "Operator's eye");
  const n = s.actions, c0 = (await s.state()).camera; await s.key("Escape");
  await s.shot("after-13-operators-eye-1440");
  const [ex, ey] = [700, 500]; await s.drag(ex, ey, ex + 160, ey, "look around"); await s.settle(600);
  const c1 = (await s.state()).camera;
  record("T23", "operator's-eye view: reach it, look around in place", (await s.state()).view === "operator" && dist(c0.position, c1.position) < 0.02, `${n} clicks (More, Operator's eye); a 160 px drag moves the eye ${(dist(c0.position, c1.position) * 100).toFixed(1)} cm`, "review B asked 1 click, < 2 cm; was 1 click, 26 cm");
  await close(s);
});

// ---- adjusting one component --------------------------------------------------------------------------
await test("T24", "the monitor's card holds only the monitor's adjustments", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("S_mon_screen"); await s.click(x, y, "monitor");
  const inv = await s.ev(INVENTORY), card = await s.ev<any>("(() => { const c = document.getElementById('card'); return { text: c.innerText, sliders: c.querySelectorAll('input[type=range]').length, pads: c.querySelectorAll('.pad').length, labels: [...c.querySelectorAll('.adj label, .adj .lbl')].map((e) => e.textContent), ends: [...c.querySelectorAll('.adj .end')].map((e) => e.textContent) }; })()");
  const hits = JARGON.filter((re) => re.test(card.text)).map(String);
  record("T24", "the monitor's card holds only the monitor's adjustments", card.sliders === 1 && card.pads === 1 && card.labels.includes("Height") && hits.length === 0 && inv.sliders <= 9, `${card.sliders} slider (${card.labels[0]}) + ${card.pads} two-way pad (${card.labels[1]}); ends: ${card.ends.join(" / ")}; jargon in the card: ${hits.length ? hits.join(" ") : 0}; ${inv.controls} controls on the page`, "review A asked 3 sliders; built as 1 slider + 1 pad on the owner's request; was 24 sliders in a global list");
  await close(s);
});
await test("T25", "raise and tilt the monitor", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("S_mon_screen"); await s.click(x, y, "monitor");
  const d = await defs(s), want = Math.round(d.J_mon_height.lower * 600) / 1000;       // 60 % of the way down (in metres); the limits belong to the model
  await s.slide(s.slider("Height"), want * 1000, "Height toward lower");
  const pad = (await s.rect("document.querySelector('#card .pad')"))!;
  await s.drag(pad.x + pad.w / 2, pad.y + pad.h / 2, pad.x + pad.w * 0.5, pad.y + pad.h * 0.8, "pad toward down");
  const j = (await s.state()).joints, note = await s.ev<string>("[...document.querySelectorAll('#card .adj .muted')].map((e) => e.textContent).join(' ')");
  await s.shot("after-03-monitor-adjusted-1440");
  record("T25", `lower the monitor ${(-want * 100).toFixed(1)} cm and tilt it down: click, drag Height, drag the pad`, s.actions === 3 && near(j.J_mon_height, want, 0.004) && j.J_mon_tilt < d.J_mon_tilt.neutral - 0.05 && Math.abs(j.J_mon_pan - d.J_mon_pan.neutral) < 0.02, `${s.actions} actions; height ${(j.J_mon_height * 100).toFixed(1)} cm, tilt ${(j.J_mon_tilt * 57.2958).toFixed(1)}° (down is negative), turn ${(j.J_mon_pan * 57.2958).toFixed(1)}°; card says: "${note}"`, "≤ 3 actions, no scrolling, right direction on the first try; was 7");
  const ap = await s.rect(s.byText("As photographed")); await s.clickEl(s.byText("As photographed"), "As photographed");
  const j2 = (await s.state()).joints;
  record("T26", "\"As photographed\" after an adjustment", !!ap && j2.J_mon_height === d.J_mon_height.neutral && j2.J_mon_tilt === d.J_mon_tilt.neutral, `visible without scrolling: ${!!ap}; one click returns height to ${j2.J_mon_height} m and tilt to ${(j2.J_mon_tilt * 57.2958).toFixed(1)}° (the photographed values)`, "was a hidden double-click per slider");
  await close(s);
});
await test("T27", "one Reset puts everything back", async () => {
  const f = await open(1440, 900); const fresh = await f.state(); await close(f);
  const s = await open(1440, 900);
  await s.clickEl("document.querySelectorAll('#tree .row.top .eye')[2]", "hide a group");
  await s.clickEl(s.byText("More"), "More"); await s.clickEl(s.byText("Left"), "Left"); await s.clickEl(s.byText("How sure are we?"), "colours"); await s.key("Escape");
  await s.ev("viewer.setJoint('J_mon_pan', 0.3), viewer.setJoint('J_joy_R_pitch', 0.2), viewer.setJoint('J_seat_slide', -0.05, { force: true }), viewer.setJoint('J_pod_armrest_L', 0.03)");
  const [x, y] = await s.find("C_seat_back_shell"); await s.click(x, y, "seat");
  await s.clickEl(s.byText("Reset all"), "Reset all"); await s.settle(900);
  const st = await s.state(), strip = (k: any) => JSON.stringify({ ...k, fps: 0, frames_drawn: 0, render: 0 });
  const camOk = dist(st.camera.position, fresh.camera.position) < 1e-6 && dist(st.camera.target, fresh.camera.target) < 1e-6;
  record("T27", "one Reset puts everything back", strip(st) === strip(fresh) || (camOk && strip({ ...st, camera: 0 }) === strip({ ...fresh, camera: 0 })), strip(st) === strip(fresh) ? "state equals a fresh load (view, hidden parts, colours, selection, 4 adjustments)" : `differs: ${Object.keys(st).filter((k) => JSON.stringify(st[k]) !== JSON.stringify(fresh[k]) && !["fps", "frames_drawn", "render"].includes(k)).join(", ")}`, "1 click; was 10 actions, inexact");
  await close(s);
});
await test("T28", "armrest pad back; right joystick forward", async () => {
  const s = await open(1440, 900, "?view=left");
  const [x, y] = await s.find("C_pod_armrest_L", 3); await s.click(x, y, "left armrest pad");
  await s.slide(s.slider("Forward / back"), -40, "toward back");
  const a = (await s.state()).joints.J_pod_armrest_L, n1 = s.actions; await close(s);
  const t = await open(1440, 900);
  const [jx, jy] = await t.find("C_joy_lever_R", 3); await t.click(jx, jy, "right joystick");
  await t.shot("after-04-joystick-selected-1440");
  const g0 = await t.ev<number[]>("viewer.worldPosition('D_grip_R')"), pad = (await t.rect("document.querySelector('#card .pad')"))!;
  await t.drag(pad.x + pad.w / 2, pad.y + pad.h / 2, pad.x + pad.w / 2, pad.y + pad.h * 0.12, "pad toward forward");
  const g1 = await t.ev<number[]>("viewer.worldPosition('D_grip_R')"), j = (await t.state()).joints;
  record("T28", "armrest pad back; right joystick forward", near(a, -0.04, 0.004) && n1 === 2 && t.actions === 2 && g1[0] > g0[0] + 0.005 && Math.abs(j.J_joy_R_roll) < 0.02, `armrest: ${n1} actions, ${(a * 100).toFixed(1)} cm; joystick: ${t.actions} actions, grip point ${((g1[0] - g0[0]) * 100).toFixed(1)} cm forward on the first try, sideways ${(j.J_joy_R_roll * 57.3).toFixed(1)}°`, "≤ 2 actions each; was 1 + reading, and 4");
  await close(t);
});
await test("T29", "how sure are we: plain legend with counts", async () => {
  const s = await open(1440, 900);
  await s.clickEl(s.byText("More"), "More"); await s.clickEl(s.byText("How sure are we?"), "How sure are we?"); const n = s.actions; await s.key("Escape");
  const key = await s.ev<string>("document.getElementById('key').getClientRects().length ? document.getElementById('key').innerText : ''"), hits = JARGON.filter((re) => re.test(key)).map(String);
  await s.shot("after-09-how-sure-1440");
  record("T29", "how sure are we: plain legend with counts", n === 2 && (await s.state()).mode === "class" && /\d+ parts?/.test(key) && hits.length === 0, `${n} clicks; legend: ${key.replace(/\s+/g, " ").slice(0, 150)}…; jargon: ${hits.length ? hits.join(" ") : 0}`, "≤ 2 actions");
  await close(s);
});
await test("T30", "copy link reproduces the view; save picture", async () => {
  const s = await open(1440, 900);
  const [ex, ey] = await s.empty(); await s.drag(ex, ey, ex + 140, ey + 50, "rotate"); await s.settle(600);
  await s.clickEl("document.querySelectorAll('#tree .row.top .eye')[5]", "hide a group");
  await s.ev("viewer.setJoint('J_mon_pan', 0.3), viewer.setJoint('J_seat_slide', -0.05, { force: true }), viewer.setJoint('J_ts_arm', [0.1, 0.5, 0])");
  const [x, y] = await s.find("S_mon_screen"); await s.click(x, y, "monitor");
  const n0 = s.actions; await s.clickEl("document.getElementById('copy-link')", "Copy link"); const clicks = s.actions - n0;
  const a = await s.state(), url = await s.ev<string>("location.href"), toast = await s.ev<string>("document.getElementById('toast').textContent");
  const pic = await s.ev<any>("(() => { const u = viewer.picture(), b = atob(u.slice(22, 22 + 44)); const n = (i) => (b.charCodeAt(i) << 24 | b.charCodeAt(i + 1) << 16 | b.charCodeAt(i + 2) << 8 | b.charCodeAt(i + 3)) >>> 0; const c = document.getElementById('gl'); return { w: n(16), h: n(20), cw: c.width, ch: c.height, kb: Math.round(u.length * 0.75 / 1024) }; })()");
  await close(s);
  const t = await open(1440, 900, url.slice(url.indexOf("?"))), b = await t.state();
  const dirA = a.camera.target.map((v: number, i: number) => v - a.camera.position[i]), dirB = b.camera.target.map((v: number, i: number) => v - b.camera.position[i]);
  const ang = Math.acos(Math.min(1, (dirA[0] * dirB[0] + dirA[1] * dirB[1] + dirA[2] * dirB[2]) / (Math.hypot(...dirA as [number, number, number]) * Math.hypot(...dirB as [number, number, number])))) * 180 / Math.PI;
  const jd = Math.max(...Object.keys(a.joints).map((k) => Math.max(...[a.joints[k]].flat().map((v: number, i: number) => Math.abs(v - [b.joints[k]].flat()[i])))));
  const same = JSON.stringify([...a.hidden].sort()) === JSON.stringify([...b.hidden].sort()) && a.selected === b.selected && a.mode === b.mode;
  await t.shot("after-14-opened-from-copied-link-1440");
  record("T30", "copy link reproduces the view", clicks === 1 && same && dist(a.camera.position, b.camera.position) < 0.01 && ang < 1 && jd < 1e-3, `${clicks} click ("${toast}"); reopened: hidden set and selection ${same ? "equal" : "DIFFER"}, camera ${(dist(a.camera.position, b.camera.position) * 100).toFixed(2)} cm / ${ang.toFixed(2)}° off, largest adjustment difference ${jd.toExponential(1)}; link ${url.length} characters`, "1 click; ≤ 1 cm, ≤ 1°; was impossible");
  record("T30b", "save picture: the 3D view without panels", pic.w === pic.cw && pic.h > pic.ch && pic.h < pic.ch + 80, `${pic.w}×${pic.h} px PNG, ${pic.kb} kB (canvas ${pic.cw}×${pic.ch}; the extra ${pic.h - pic.ch} px band carries the assumed-range sentence)`);
  await close(t);
});

// ---- assumed adjustments: the seat ---------------------------------------------------------------------
await test("T31", "slide the seat back 5 cm and recline it to 20°", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("C_seat_back_shell"); await s.click(x, y, "seat (its backrest)");
  const card = await s.ev<any>("(() => { const c = document.getElementById('card'); return { name: c.querySelector('h2').textContent, tags: c.querySelectorAll('.adj .tag').length, sliders: c.querySelectorAll('input[type=range]').length, text: c.innerText, labels: [...c.querySelectorAll('.adj label')].map((e) => e.textContent), disabled: c.querySelectorAll(':disabled').length }; })()");
  await s.shot("after-05-seat-selected-1440");
  await s.slide(s.slider("Forward / back"), -50, "Forward / back to 5 cm back");
  const two = s.actions, j1 = (await s.state()).joints;
  await s.slide(s.slider("Recline"), 20, "Recline to 20°");
  const j = (await s.state()).joints;
  await s.shot("after-06-seat-moved-assumed-notice-1440");
  record("T31", "slide the seat back 5 cm and recline it to 20°", two === 2 && j1.J_seat_slide !== 0 && s.actions === 3 && near(j.J_seat_slide, -0.05, 0.005) && near(j.J_seat_recline, 20 * Math.PI / 180, Math.PI / 180), `${two} actions to slide (${(j1.J_seat_slide * 100).toFixed(1)} cm), ${s.actions} in all; slide ${(j.J_seat_slide * 100).toFixed(1)} cm, recline ${(j.J_seat_recline * 57.2958).toFixed(1)}°`, "≤ 2 and ≤ 3 actions; ±0.5 cm, ±1°; was impossible");
  record("T33", "the seat's card: five working sliders, each tagged, with the caution", card.name === "Seat" && card.sliders === 5 && card.tags === 5 && card.disabled === 0 && /not confirmed on the real rig/.test(card.text), `"${card.name}": ${card.sliders} sliders (${card.labels.join(", ")}), ${card.tags} tagged "assumed range", ${card.disabled} disabled; caution sentence present: ${/not confirmed on the real rig/.test(card.text)}`);
  // the notice stays on the picture
  const notice = () => s.ev<string>("(() => { const n = document.querySelector('#notices .amber'); return n && n.getClientRects().length ? n.innerText : ''; })()");
  const n1 = await notice(); await s.key("Escape"); const n2 = await notice();
  const [mx, my] = await s.find("S_mon_screen"); await s.click(mx, my, "monitor"); const n3 = await notice();
  await s.ev("viewer.setJoint('J_mon_pan', 0.2)");
  const inStage = await s.ev<boolean>("document.getElementById('stage').contains(document.querySelector('#notices .amber'))");
  await s.clickEl(s.byText("Back to as photographed", "document.querySelector('#notices .amber')"), "Back to as photographed");
  const j3 = (await s.state()).joints, n4 = await notice(), grey = await s.ev<string>("[...document.querySelectorAll('#notices .note:not(.amber)')].filter((n) => n.getClientRects().length).map((n) => n.innerText).join(' | ')");
  const ok34 = [n1, n2, n3].every((t) => /assumed range/.test(t) && /not confirmed on the real rig/.test(t)) && inStage;
  record("T34", "amber notice stays on the picture while the seat is moved", ok34, `"${n1.replace(/\s+/g, " ")}"; after Esc: ${n2 ? "still there" : "GONE"}; with the monitor selected: ${n3 ? "still there" : "GONE"}; inside the picture area: ${inStage}`);
  const d = await defs(s);
  record("T35", "\"Back to as photographed\" on the notice returns the assumed adjustments only", j3.J_seat_slide === d.J_seat_slide.neutral && j3.J_seat_recline === d.J_seat_recline.neutral && j3.J_mon_pan === 0.2 && n4 === "" && !/assumed/.test(grey) && /Monitor moved/.test(grey), `seat slide ${j3.J_seat_slide}, recline ${(j3.J_seat_recline * 57.2958).toFixed(1)}° (photographed ${(d.J_seat_recline.neutral * 57.2958).toFixed(1)}°), monitor turn kept at ${j3.J_mon_pan}; amber notice gone; remaining strip: "${grey.replace(/\s+/g, " ")}"`);
  await close(s);
});
await test("T32", "no disabled slider and no padlock in any state", async () => {
  const s = await open(1440, 900); const out: string[] = []; let bad = 0, maxSliders = 0;
  for (const id of await s.ev<string[]>("[...viewer.rows().map((r) => r.id), ...viewer.rows().flatMap((r) => r.parts), 'joystick_L', 'joystick_R', 'touchscreen']")) {
    await s.ev(`viewer.select(${JSON.stringify(id)})`);
    const c = await s.ev<any>("(() => { const c = document.getElementById('card'); return { dis: c.querySelectorAll(':disabled').length, lock: c.querySelectorAll('[aria-label=locked], .locked').length + (/🔒/.test(c.innerText) ? 1 : 0), sliders: c.querySelectorAll('input[type=range]').length, pads: c.querySelectorAll('.pad').length }; })()");
    bad += c.dis + c.lock; maxSliders = Math.max(maxSliders, c.sliders); if (c.sliders + c.pads) out.push(`${id}: ${c.sliders}s+${c.pads}p`);
  }
  record("T32", "no disabled control and no padlock in any card (every row, unit and part selected in turn)", bad === 0 && maxSliders <= 9, `${bad} disabled or padlocked; most sliders in one card: ${maxSliders}; cards with adjustments: ${out.length}`, "0; ≤ 9 sliders; was 6 dead sliders");
  await close(s);
});
await test("T36", "the seat's sliders stop at the limits of the description file", async () => {
  const s = await open(1440, 900); await s.clickEl("[...document.querySelectorAll('#tree .row.top .name')].find((b) => b.querySelector('.label').textContent === 'Seat')", "Seat in the list");
  const got: number[] = [], d = await defs(s), mid = async (label: string) => { const r = (await s.rect(s.slider(label)))!, i = await s.ev<any>(`(() => { const e = ${s.slider(label)}; return (e.value - e.min) / (e.max - e.min); })()`); return { r, x: r.x + 8 + i * (r.w - 16), y: r.y + r.h / 2 }; };
  let m = await mid("Forward / back"); await s.drag(m.x, m.y, m.r.x - 80, m.y, "slide past the back end"); got.push((await s.state()).joints.J_seat_slide);
  m = await mid("Forward / back"); await s.drag(m.x, m.y, m.r.x + m.r.w + 80, m.y, "slide past the forward end"); got.push((await s.state()).joints.J_seat_slide);
  m = await mid("Recline"); await s.drag(m.x, m.y, m.r.x + m.r.w + 80, m.y, "recline past the end"); got.push((await s.state()).joints.J_seat_recline);
  m = await mid("Recline"); await s.drag(m.x, m.y, m.r.x - 80, m.y, "recline past upright"); got.push((await s.state()).joints.J_seat_recline);
  const L = d.J_seat_slide, R = d.J_seat_recline;
  record("T36", "the seat's sliders stop at the limits of the description file", got[0] === L.lower && got[1] === L.upper && got[2] === R.upper && got[3] === R.lower, `slide ${got[0]} … ${got[1]} m; recline ${got[3]} … ${got[2]} rad`, `exactly ${L.lower} … ${L.upper} m; ${R.lower} … ${R.upper} rad`);
  await close(s);
});
await test("T37", "for scripts nothing moved: lock, pose=, description file", async () => {
  const s = await open(1440, 900, "?pose=J_seat_slide:-0.05");
  const thrown = await s.ev<string>("(() => { try { viewer.setJoint('J_seat_slide', 0.05); return ''; } catch (e) { return e.message; } })()");
  const st = await s.state(), locked = await s.ev<any[]>("viewer.manifest().joints.filter((j) => j.locked).map((j) => [j.id, j.evidence])");
  const notice = await s.ev<string>("(() => { const n = document.querySelector('#notices .amber'); return n && n.getClientRects().length ? n.innerText : ''; })()");
  const pic = await s.ev<any>("(() => { const u = viewer.picture(), b = atob(u.slice(22, 66)); const n = (i) => (b.charCodeAt(i) << 24 | b.charCodeAt(i + 1) << 16 | b.charCodeAt(i + 2) << 8 | b.charCodeAt(i + 3)) >>> 0; return n(20) - document.getElementById('gl').height; })()");
  record("T37", "for scripts nothing moved: lock, pose=, description file", /locked/.test(thrown) && st.joints.J_seat_slide === -0.05 && locked.length === 6 && locked.every((l) => l[1] === "assumed") && st.assumed_in_use.join() === "J_seat_slide" && /not confirmed/.test(notice) && pic > 0, `setJoint without force: "${thrown}"; pose= moved the seat to ${st.joints.J_seat_slide}; ${locked.length} joints still locked + assumed in the description file; state().assumed_in_use = [${st.assumed_in_use}]; a pose from the address shows the notice: ${!!notice}; saved picture carries the sentence (${pic} px band)`);
  await close(s);
});

// ---- direct manipulation ------------------------------------------------------------------------------
await test("T38", "drag the selected monitor down in the picture", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("S_mon_screen"); await s.click(x, y, "monitor"); await s.move(x + 2, y + 2); await sleep(150);
  const cur = await s.ev<string>("document.getElementById('gl').style.cursor"), tip = await s.ev<string>("document.getElementById('tip').hidden ? '' : document.getElementById('tip').textContent"), hint = await s.ev<string>("document.querySelector('#card .drag-hint')?.textContent ?? ''");
  const d = await defs(s); await s.settle(500); const [gx, gy] = await s.find("S_mon_screen"); const cA = (await s.state()).camera; await s.drag(gx, gy, gx + 2, gy + 16, "monitor downward");
  const st = await s.state(), out = await s.ev<string>("document.querySelector('#card .adj output').textContent");
  const [lx, ly] = await s.find("S_mon_screen"); await s.drag(lx, ly, lx, ly + 600, "monitor far down"); const low = (await s.state()).joints.J_mon_height;
  await s.shot("after-15-monitor-dragged-to-its-lower-stop-1440");
  const [ux, uy] = await s.find("S_mon_screen"); await s.drag(ux, uy, ux, uy - 700, "monitor far up"); const high = (await s.state()).joints.J_mon_height;
  record("T38", "drag the selected monitor down in the picture", st.joints.J_mon_height < -0.01 && st.joints.J_mon_height > d.J_mon_height.lower && st.joints.J_mon_tilt === d.J_mon_tilt.neutral && st.joints.J_mon_pan === d.J_mon_pan.neutral && moved(cA, st.camera) < 1e-9 && low === d.J_mon_height.lower && high === d.J_mon_height.upper && cur === "move" && /drag the part/.test(hint), `16 px drag: height ${(st.joints.J_mon_height * 100).toFixed(1)} cm (card shows "${out}"), tilt and turn untouched, camera moved ${moved(cA, st.camera).toFixed(6)} m; dragged past the ends: ${low} … ${high} m; cursor over the selected monitor "${cur}", pointer label "${tip}", card hint "${hint}"`, `limits ${d.J_mon_height.lower} … ${d.J_mon_height.upper} m`);
  await close(s);
});
await test("T39", "drag the selected seat back; drag its backrest; drag the armrest pad", async () => {
  const s = await open(1440, 900, "?view=left"), d = await defs(s);     // seen from the operator's left: forward is to the left of the picture
  const [x0, y0] = await s.find("C_seat_pan", 3), cBefore = (await s.state()).camera; await s.click(x0, y0, "seat cushion"); await s.settle(700);
  const slid = moved(cBefore, (await s.state()).camera) / 2, [x, y] = await s.find("C_seat_pan", 3);      // the view slides sideways once so the seat is not under the card
  const c0 = (await s.state()).camera, p0 = await s.ev<number[]>("viewer.project(viewer.worldPosition('D_seat_ref_live'))");
  await s.drag(x, y, x + 25, y + 2, "seat toward its back");
  const a = await s.state(), p1 = await s.ev<number[]>("viewer.project(viewer.worldPosition('D_seat_ref_live'))");
  const [bx, by] = await s.find("C_seat_headrest", 3); await s.drag(bx, by, bx + 45, by + 8, "headrest backward");
  const b = await s.state();
  await s.shot("after-16-seat-dragged-left-view-1440");
  record("T39", "drag the selected seat back, then its headrest", a.joints.J_seat_slide < -0.01 && a.joints.J_seat_slide > d.J_seat_slide.lower && a.joints.J_seat_height === d.J_seat_height.neutral && near(p1[0] - p0[0], 25, 2) && b.joints.J_seat_recline > d.J_seat_recline.neutral + 0.05 && b.joints.J_seat_slide === a.joints.J_seat_slide && moved(c0, b.camera) < 1e-9, `on selecting it the view slid ${slid.toFixed(2)} m sideways to bring the seat out from under the card; cushion dragged 25 px: slide ${(a.joints.J_seat_slide * 100).toFixed(1)} cm (the seat moved ${(p1[0] - p0[0]).toFixed(1)} px on screen), height unchanged; headrest dragged 45 px: recline ${(b.joints.J_seat_recline * 57.2958).toFixed(1)}° (photographed ${(d.J_seat_recline.neutral * 57.2958).toFixed(1)}°), slide unchanged; camera moved ${moved(c0, b.camera).toFixed(6)} m`);
  await close(s);
  const t = await open(1440, 900, "?view=left");
  const [px, py] = await t.find("C_pod_armrest_L", 3); await t.click(px, py, "left armrest pad"); await t.drag(px, py, px - 12, py, "pad forward");
  const j = (await t.state()).joints.J_pod_armrest_L; await t.drag(px - 12, py, px - 400, py, "pad far forward"); const end = (await t.state()).joints.J_pod_armrest_L;
  const dd = await defs(t);
  record("T41", "drag the selected armrest pad", j > 0.01 && j < dd.J_pod_armrest_L.upper && end === dd.J_pod_armrest_L.upper, `12 px: ${(j * 100).toFixed(1)} cm forward; dragged past the end: ${end} m`, `limit ${dd.J_pod_armrest_L.upper} m`);
  await close(t);
});
await test("T40", "drag a joystick grip to deflect it", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("C_joy_lever_R", 3); await s.click(x, y, "right joystick", 2); await s.settle(800);            // double-click: select and zoom to it
  const grip = () => s.ev<number[]>("(() => { const c = document.getElementById('gl').getBoundingClientRect(), p = viewer.project(viewer.worldPosition('D_grip_R')); return [c.left + p[0], c.top + p[1]]; })()");
  const top = await grip(), c0 = (await s.state()).camera;
  const h = await s.ev<any>(`viewer.pickAt(${top[0]} - document.getElementById('gl').getBoundingClientRect().left, ${top[1]} - document.getElementById('gl').getBoundingClientRect().top)`);
  await s.drag(top[0], top[1], top[0] + 14, top[1] - 5, "grip");
  const st = await s.state(), pr = await grip(), mv = [pr[0] - top[0], pr[1] - top[1]], cos = (mv[0] * 14 + mv[1] * -5) / (Math.hypot(mv[0], mv[1]) * Math.hypot(14, 5)), share = Math.hypot(mv[0], mv[1]) / Math.hypot(14, 5);
  await s.shot("after-17-joystick-dragged-1440");
  await s.drag(pr[0], pr[1], pr[0] + 500, pr[1] - 300, "grip far"); const far = (await s.state()).joints;
  const lim = (await defs(s)).J_joy_R_roll.upper, hit = Math.max(Math.abs(far.J_joy_R_roll), Math.abs(far.J_joy_R_pitch));
  const inside = Math.abs(st.joints.J_joy_R_roll) < lim && Math.abs(st.joints.J_joy_R_pitch) < lim && Math.abs(st.joints.J_joy_R_roll) + Math.abs(st.joints.J_joy_R_pitch) > 0.05;
  record("T40", "drag a joystick grip to deflect it", h?.id === "C_joy_lever_R" && inside && cos > 0.9 && share > 0.3 && share <= 1.05 && moved(c0, st.camera) < 1e-9 && hit <= lim + 1e-9 && hit > lim - 1e-6, `zoomed to the joystick, grip dragged 15 px: sideways ${(st.joints.J_joy_R_roll * 57.3).toFixed(1)}°, forward ${(st.joints.J_joy_R_pitch * 57.3).toFixed(1)}°; the grip reference point moved ${Math.hypot(mv[0], mv[1]).toFixed(0)} px in the pointer's direction (cos ${cos.toFixed(3)}; it sits lower on the lever than the grabbed point); camera moved ${moved(c0, st.camera).toFixed(6)} m; dragged far: ${(far.J_joy_R_roll * 57.3).toFixed(1)}° / ${(far.J_joy_R_pitch * 57.3).toFixed(1)}°`, `stops at ±${(lim * 57.3).toFixed(0)}°`);
  await close(s);
});
await test("T42", "dragging an unselected part or empty space still rotates the view", async () => {
  const s = await open(1440, 900);
  const [x, y] = await s.find("S_mon_screen"); const c0 = (await s.state()).camera;
  await s.drag(x, y, x + 80, y + 30, "unselected monitor"); await s.settle(500); const a = await s.state();
  const [sx, sy] = await s.find("S_mon_screen"); await s.click(sx, sy, "monitor");
  const [qx, qy] = await s.find("C_seat_back_shell"); await s.drag(qx, qy, qx + 80, qy, "seat while the monitor is selected"); await s.settle(500); const b = await s.state();
  const fresh = await s.ev<string>("JSON.stringify(Object.fromEntries(viewer.manifest().joints.map((j) => [j.id, j.neutral])))"), moved = JSON.stringify(b.joints) !== fresh;
  record("T42", "dragging an unselected part or empty space still rotates the view", dist(c0.position, a.camera.position) > 0.2 && dist(a.camera.position, b.camera.position) > 0.2 && !moved && a.selected === null, `drag on the unselected monitor moved the camera ${dist(c0.position, a.camera.position).toFixed(2)} m and selected nothing; drag on the seat with the monitor selected moved it ${dist(a.camera.position, b.camera.position).toFixed(2)} m; no adjustment changed`);
  await close(s);
});

// ---- narrow window ------------------------------------------------------------------------------------
await test("T52", "phone-width window: model first, parts as a drawer, card as a sheet", async () => {
  const s = await open(390, 800);
  const inv = await s.ev(INVENTORY), hidden = await s.ev<boolean>("document.getElementById('parts').getBoundingClientRect().right <= 0");
  await s.clickEl(s.byText("Parts"), "Parts"); await sleep(350); await s.shot("after-08b-narrow-parts-drawer-390");
  const open1 = await s.ev<boolean>("document.getElementById('parts').getBoundingClientRect().left >= 0");
  await s.clickEl("[...document.querySelectorAll('#tree .row.top .name')].find((b) => b.querySelector('.label').textContent === 'Monitor stand')", "Monitor stand");
  await s.clickEl("[...document.querySelectorAll('#tree .row.kid .name')].find((b) => b.querySelector('.label').textContent === 'Monitor')", "Monitor"); await sleep(350);
  const card = (await s.rect("document.getElementById('card')"))!, closed = await s.ev<boolean>("document.getElementById('parts').getBoundingClientRect().right <= 0");
  const overflow = await s.ev<number>("document.documentElement.scrollWidth - innerWidth");
  await s.slide(s.slider("Height"), -100, "Height");
  await s.shot("after-08c-narrow-monitor-sheet-390");
  const j = (await s.state()).joints.J_mon_height, tb = await s.ev<number[]>("[...document.querySelectorAll('#toolbar button')].filter((b) => b.getClientRects().length).map((b) => Math.round(b.getBoundingClientRect().right))");
  record("T52", "phone-width window: model first, parts as a drawer, card as a sheet", hidden && open1 && closed && card.h <= 800 * 0.47 && card.y + card.h <= 800 && overflow <= 0 && near(j, -0.1, 0.01) && Math.max(...tb) <= 390, `list folded away: ${hidden}; opens with "Parts": ${open1}; closes on choosing a part: ${closed}; card is a bottom sheet ${Math.round(card.h)} px tall (${(card.h / 8).toFixed(0)} % of the height); sideways overflow ${overflow} px; toolbar ends at ${Math.max(...tb)} px; slider works (${(j * 100).toFixed(1)} cm); ${inv.controls} controls by default`);
  await close(s);
  for (const [w, h, name] of [[1024, 768, "after-07b-seat-moved-1024"], [390, 800, "after-08d-narrow-assumed-notice-390"]] as [number, number, string][]) {
    const t = await open(w, h, "?pose=J_seat_slide:-0.06,J_seat_recline:22&sel=seat");
    const n = await t.rect("document.querySelector('#notices .amber')"), c = (await t.rect("document.getElementById('gl')"))!;
    await t.shot(name);
    record(`T34-${w}`, `amber notice visible over the 3D view at ${w}×${h}`, !!n && n.x >= c.x && n.x + n.w <= c.x + c.w + 1 && n.y >= 0, n ? `at ${Math.round(n.x)},${Math.round(n.y)} size ${Math.round(n.w)}×${Math.round(n.h)}` : "absent");
    await close(t);
  }
});

// ---- the person panel (viewer/src/person-panel.ts) --------------------------------------------------------
/** a pixel of the 3D view on the person, in front of the rig (its head first), in viewport coordinates */
async function personPixel(s: Session): Promise<[number, number]> {
  const p = await s.ev<[number, number] | null>(`(() => { const c = document.getElementById('gl').getBoundingClientRect(), gl = document.getElementById('gl');
    const ok = (x, y) => viewer.personPanel.covers(x, y) && document.elementFromPoint(c.left + x, c.top + y) === gl;
    for (const a of ['head_centre', 'pelvis', 'hand_R']) { const m = viewer.person.anchor(a); if (!m) continue; const [x, y] = viewer.project(m); for (const [dx, dy] of [[0, 0], [0, -8], [8, 0], [-8, 0], [0, 8], [0, 16]]) if (ok(x + dx, y + dy)) return [c.left + x + dx, c.top + y + dy]; }
    for (let y = 40; y < c.height; y += 24) for (let x = 40; x < c.width; x += 24) if (ok(x, y)) return [c.left + x, c.top + y]; return null; })()`);
  if (!p) throw new Error("the person is not visible in the 3D view");
  return p;
}
/** wait until the person (and the panel's queue) satisfies a condition on st = viewer.person.state(), ps = viewer.personPanel.state() */
const untilPerson = (s: Session, cond: string, what: string, ms = 20000) => s.page.waitFor(`(() => { const st = viewer.person.state(), ps = viewer.personPanel.state(); return ps.busy === 0 && (${cond}) ? 'yes' : null; })()`, what, ms);
const seg = (text: string) => `[...document.querySelectorAll('#person .seg label')].find((l) => l.getClientRects().length && l.querySelector('.seg-t').textContent === ${JSON.stringify(text)})`;
const personBtn = (text: string) => `[...document.querySelectorAll('#person button')].find((b) => b.getClientRects().length && b.textContent.trim() === ${JSON.stringify(text)})`;
const personSlider = (label: string) => `[...document.querySelectorAll('#person .adj')].find((a) => a.querySelector('label')?.textContent === ${JSON.stringify(label)})?.querySelector('input[type=range]')`;
const visibleIn = (s: Session, id: string) => s.ev<boolean>(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e || !e.getClientRects().length) return false; const r = e.getBoundingClientRect(), c = document.getElementById('gl').getBoundingClientRect(), t = document.elementFromPoint(r.left + 6, r.top + r.height / 2); return r.left >= c.left && r.right <= c.right + 1 && r.bottom <= c.bottom + 1 && r.top >= c.top && !!t && e.contains(t); })()`);

await test("T60", "click the person: its panel opens; a click on the rig works as before", async () => {
  const s = await open(1440, 900, "?sel=seat");
  const [x, y] = await personPixel(s); await s.click(x, y, "the person"); await s.settle(300);
  const ps = await s.ev<any>("viewer.personPanel.state()"), sel = (await s.state()).selected, card = await s.rect("document.getElementById('card')"), panel = await s.rect("document.getElementById('person')");
  const row = await s.ev<boolean>("document.querySelector('.person-row').classList.contains('sel')"), where = await s.ev<string>("document.querySelector('#person .where').textContent");
  await s.shot("after-60-person-panel-dressed-1440");
  record("T60", "a click on the person selects it and opens its panel (the part card closes)", ps.open && !sel && !card && !!panel && row && /Median man \(P50\)/.test(where), `panel open: ${ps.open}; part selected: ${sel ?? "none"}; card: ${card ? "open" : "closed"}; parts-list row marked: ${row}; "${where}"; one pick of the person ${ps.pick_ms} ms`);
  const [mx, my] = await s.find("S_mon_screen"); await s.click(mx, my, "the monitor"); await s.settle(300);
  const sel2 = (await s.state()).selected, ps2 = await s.ev<any>("viewer.personPanel.state()"), card2 = await s.rect("document.getElementById('card')");
  const [ex, ey] = await s.empty(); await s.click(ex, ey, "empty space"); await s.settle(200); const sel3 = (await s.state()).selected;
  record("T61", "with the person's panel open, the rig picks as before", sel2 === "C_stand_monitor" && !ps2.open && !!card2 && sel3 === null, `click on the monitor: selected ${sel2}, part card ${card2 ? "open" : "closed"}, person panel ${ps2.open ? "open" : "closed"}; click on empty space: selection ${sel3 ?? "none"}`);
  await close(s);
});
await test("T62", "change the style: clay figure and back; tone and glasses kept; the credits line follows", async () => {
  const s = await open(1440, 900);
  const credit0 = await visibleIn(s, "person-credit");
  const [x, y] = await personPixel(s); await s.click(x, y, "the person"); await s.settle(300);
  await s.clickEl(seg("Medium"), "Skin tone: Medium"); await untilPerson(s, "st.tone === 'medium'", "medium tone");
  await s.clickEl("document.getElementById('p-glasses')?.closest('label')", "Glasses off"); await untilPerson(s, "!st.worn.glasses.garment", "glasses off");
  await s.clickEl(seg("Clay figure"), "Style: Clay figure"); await untilPerson(s, "st.style === 'clay'", "the clay figure");
  await s.settle(500);
  const credit1 = await visibleIn(s, "person-credit"), clayRows = await s.ev<number>("[...document.querySelectorAll('#person .p-choice')].filter((r) => r.getClientRects().length).length");
  await s.shot("after-62-person-panel-clay-1440");
  await s.clickEl(seg("Dressed operator"), "Style: Dressed operator"); await untilPerson(s, "st.style === 'dressed'", "the dressed operator");
  await s.settle(300);
  const st = await s.ev<any>("viewer.person.state()"), credit2 = await visibleIn(s, "person-credit");
  record("T62", "style: clay figure and back; tone and glasses kept; credits line only while dressed", credit0 && !credit1 && credit2 && st.tone === "medium" && !st.worn.glasses.garment && !!st.worn.headset.garment && clayRows === 3, `credits line on the view: dressed ${credit0}, clay ${credit1}, dressed again ${credit2}; back from clay: tone ${st.tone}, glasses ${st.worn.glasses.garment ?? "off"}, headset ${st.worn.headset.garment ?? "off"}; rows shown for the clay figure: ${clayRows} (no tone, no wearing)`);
  await close(s);
});
await test("T63", "preset Tall man P95, a stature drag, Undo twice", async () => {
  const s = await open(1440, 900);
  const [x, y] = await personPixel(s); await s.click(x, y, "the person"); await s.settle(300);
  const tall = await s.ev<number>("viewer.person.definition().presets.find((p) => p.name === 'Tall man (stature P95)').values.stature");
  await s.clickEl(seg("Tall man"), "Preset: Tall man P95"); await untilPerson(s, `Math.abs(st.shape.stature - ${tall}) < 0.5 && ps.undo === 1`, "the tall man");
  const where1 = await s.ev<string>("document.querySelector('#person .where').textContent"), out1 = await s.ev<string>(`${personSlider("Stature")}.closest('.adj').querySelector('output').textContent`);
  await s.slide(personSlider("Stature"), 1800, "Stature"); await untilPerson(s, "ps.undo === 2", "the drag recorded", 8000);
  const st2 = await s.ev<any>("viewer.person.state()"), where2 = await s.ev<string>("document.querySelector('#person .where').textContent"), back = await s.ev<string>(`(${personBtn("Back to tall man")})?.textContent ?? ''`);
  await s.shot("after-63-person-panel-tall-dragged-1440");
  await s.clickEl(personBtn("Undo"), "Undo"); await untilPerson(s, `ps.undo === 1 && Math.abs(st.shape.stature - ${tall}) < 0.5`, "the drag undone");
  const where3 = await s.ev<string>("document.querySelector('#person .where').textContent");
  await s.clickEl(personBtn("Undo"), "Undo"); await untilPerson(s, "ps.undo === 0", "the preset undone");
  const st4 = await s.ev<any>("viewer.person.state()"), where4 = await s.ev<string>("document.querySelector('#person .where').textContent"), dis = await s.ev<boolean>(`${personBtn("Undo")}.disabled`);
  const median = await s.ev<number>("viewer.person.definition().controls.find((c) => c.id === 'stature').default");
  record("T63", "preset, a slider drag as one change, Undo one change at a time", /Tall man \(P95\)/.test(where1) && /187\.0 cm/.test(out1) && Math.abs(st2.shape.stature - 1800) <= 6 && /Changed from tall man/.test(where2) && !!back && /Tall man \(P95\)/.test(where3) && /Median man \(P50\)/.test(where4) && Math.abs(st4.shape.stature - median) < 0.5 && dis,
    `Tall man: "${where1}", stature ${out1}; after one drag: ${(st2.shape.stature / 10).toFixed(1)} cm, "${where2}", "${back}" offered; Undo: "${where3}"; Undo: "${where4}" (${(st4.shape.stature / 10).toFixed(1)} cm), Undo then ${dis ? "unavailable" : "still offered"}; changes recorded ${(await s.ev<any>("viewer.personPanel.state()")).shared ? "in the shared scene" : "on this page"}`);
  await close(s);
});
await test("T64", "credits: on the view while dressed, and in full under More", async () => {
  const s = await open(1440, 900);
  const line = await s.ev<string>("document.getElementById('person-credit').textContent"), shown = await visibleIn(s, "person-credit");
  await s.clickEl(s.byText("More"), "More"); await s.clickEl(s.byText("Credits", "document.getElementById('more')"), "Credits"); await s.settle(300);
  const text = await s.ev<string>("document.getElementById('credits')?.innerText ?? ''"), box = await s.rect("document.getElementById('credits')");
  await s.shot("after-64-credits-1440");
  await s.key("Escape"); await s.settle(200);
  const gone = !(await s.rect("document.getElementById('credits')"));
  const need = ["Elvaerwyn", "Mindfront", "CC BY 4.0", "mocap.cs.cmu.edu", "CC0-1.0", "Apache-2.0"], missing = need.filter((w) => !text.includes(w));
  record("T64", "credits: a line on the view while the dressed operator is shown; the full credits under More", shown && /Elvaerwyn/.test(line) && /Mindfront/.test(line) && /CC BY 4\.0/.test(line) && !!box && missing.length === 0 && gone, `on the view: ${shown} ("${line}"); More, Credits: ${box ? `${Math.round(box.w)}×${Math.round(box.h)} px` : "absent"}, ${missing.length ? `missing ${missing.join(", ")}` : "names the garments' authors, CC BY 4.0, the motion capture source and the open licences"}; Esc closes it: ${gone}`);
  await close(s);
});
await test("T65", "keyboard and screen reader: the Person row, labels, focus order, Esc", async () => {
  const s = await open(1440, 900);
  const press = async (key: string, code: string, vk: number) => { await s.page.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, ...(key === "Enter" ? { text: "\r" } : {}) }); await s.page.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk }); await sleep(120); };
  await s.ev("document.querySelector('.person-row .name').focus()"); await press("Enter", "Enter", 13); await s.settle(300);
  const opened = await s.ev<any>("({ open: viewer.personPanel.state().open, focus: document.activeElement?.id, expanded: document.querySelector('.person-row .name').getAttribute('aria-expanded') })");
  // every control in the panel has a name a screen reader can say
  const unnamed = await s.ev<string[]>(`[...document.querySelectorAll('#person button, #person input, #person summary, #person [role=radiogroup]')].filter((e) => e.getClientRects().length || e.type === 'radio').filter((e) => {
    const lab = e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent) || (e.labels && e.labels[0]?.textContent) || e.textContent; return !(lab && lab.trim()); }).map((e) => e.outerHTML.slice(0, 60))`);
  const order: string[] = [];
  for (let i = 0; i < 9; i++) { await press("Tab", "Tab", 9); order.push(await s.ev<string>("(() => { const e = document.activeElement; if (!e) return '?'; if (!document.getElementById('person').contains(e)) return 'outside'; return e.labels?.[0]?.textContent?.trim() || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 24) || e.tagName; })()")); }
  await press("Escape", "Escape", 27); await s.settle(200);
  const after = await s.ev<any>("({ open: viewer.personPanel.state().open, focus: document.activeElement?.closest('.person-row') ? 'Person row' : document.activeElement?.tagName })");
  const want = ["Close", "Hide"], inside = !order.includes("outside");
  record("T65", "keyboard: Enter on the Person row opens the panel; every control is named; Tab stays in order; Esc closes and returns", opened.open && opened.focus === "person-title" && opened.expanded === "true" && unnamed.length === 0 && order[0] === want[0] && order[1] === want[1] && inside && order.includes("Stature") && !after.open && after.focus === "Person row",
    `Enter on the row: panel ${opened.open ? "open" : "closed"}, focus on ${opened.focus}, aria-expanded ${opened.expanded}; unnamed controls: ${unnamed.length ? unnamed.join(" | ") : 0}; Tab order: ${order.join(" → ")}; Esc: panel ${after.open ? "open" : "closed"}, focus back on the ${after.focus}`);
  await close(s);
});
await test("T66", "phone-width window: the person's panel as a bottom sheet, the credits line above it", async () => {
  const s = await open(390, 800);
  const credit0 = await visibleIn(s, "person-credit");
  await s.clickEl(s.byText("Parts"), "Parts"); await sleep(350);
  await s.clickEl("document.querySelector('.person-row .name')", "Person"); await sleep(450);
  const panel = (await s.rect("document.getElementById('person')"))!, drawer = await s.ev<boolean>("document.getElementById('parts').getBoundingClientRect().right <= 0");
  const credit = await s.rect("document.getElementById('person-credit')"), creditSeen = await visibleIn(s, "person-credit"), overflow = await s.ev<number>("document.documentElement.scrollWidth - innerWidth");
  const frame = (await s.rect("document.getElementById('frame')"))!;
  await s.shot("after-66-person-panel-narrow-390");
  await s.ev(`${seg("Clay figure")}.scrollIntoView({ block: 'nearest' })`); await sleep(200);
  await s.clickEl(seg("Clay figure"), "Style: Clay figure"); await untilPerson(s, "st.style === 'clay'", "the clay figure"); await s.settle(400);
  await s.shot("after-66b-person-panel-narrow-clay-390");
  record("T66", "phone width: the person's panel is a bottom sheet; the 3D view and the credits line end above it", !!panel && panel.y + panel.h <= 800.5 && panel.h <= 800 * 0.47 && drawer && credit0 && creditSeen && !!credit && credit.y + credit.h <= panel.y + 1 && frame.y + frame.h <= panel.y + 1 && overflow <= 0,
    `sheet ${Math.round(panel.h)} px tall (${(panel.h / 8).toFixed(0)} % of the height), parts drawer closed: ${drawer}; credits line before ${credit0}, with the sheet ${creditSeen} (ends ${credit ? Math.round(panel.y - credit.y - credit.h) : "?"} px above it); 3D view ends ${Math.round(panel.y - frame.y - frame.h)} px above the sheet; sideways overflow ${overflow} px`);
  await close(s);
});
await test("T67", "the person's package fails: a plain error, the rig unaffected", async () => {
  const s = await open(1440, 900, "?person=asset/manikin/nobody/nobody.avatar.json");
  const ok = await s.ev<boolean>("viewer.person.ready"), tag = await s.ev<string>("document.querySelector('.person-row .count').textContent");
  await s.clickEl("document.querySelector('.person-row .name')", "Person"); await s.settle(300);
  const text = await s.ev<string>("document.getElementById('person').innerText"), note = await s.ev<string>("document.querySelector('.person-status')?.textContent ?? ''");
  const [mx, my] = await s.find("S_mon_screen"); await s.click(mx, my, "the monitor"); await s.settle(300);
  const sel = (await s.state()).selected;
  await s.shot("after-67-person-failed-1440");
  record("T67", "a person package that fails to load: said plainly, the rig works", !ok && tag === "not loaded" && /could not be/.test(text) && /could not be shown/.test(note) && sel === "C_stand_monitor", `ready: ${ok}; row: "${tag}"; panel: "${text.replace(/\s+/g, " ").slice(0, 110)}"; notice: "${note.slice(0, 80)}"; the monitor still selectable: ${sel === "C_stand_monitor"}`);
  await s.close();                                   // its 404 and the person module's error are expected: not counted in T50
});

// ---- speed --------------------------------------------------------------------------------------------
await test("T44", "an idle page draws nothing", async () => {
  // the rig alone, with the person module loaded but no person shown (person=off): the person's own idle motion is T44b
  const s = await open(1440, 900, "?person=off"); await s.settle(800);
  await s.page.call("Performance.enable");
  const metric = async () => { const m = (await s.page.call("Performance.getMetrics")).metrics as { name: string; value: number }[]; return Object.fromEntries(m.map((x) => [x.name, x.value])); };
  const f0 = (await s.state()).frames_drawn, m0 = await metric(); await sleep(2000); const f1 = (await s.state()).frames_drawn, m1 = await metric();
  const cpu = ((m1.TaskDuration - m0.TaskDuration) / 2) * 100;
  const [x, y] = await s.find("C_seat_back_shell"); await s.move(x + 20, y + 5); await sleep(200); const f2 = (await s.state()).frames_drawn;
  // does pointing at a part redraw the shadow map? (a frame with a shadow pass draws the casters twice)
  const still = (await s.state()).render.calls, [mx, my] = await s.find("S_mon_screen");
  const fa = (await s.state()).frames_drawn; await s.move(mx, my); await sleep(150); await s.move(x, y); await sleep(150); await s.move(mx + 4, my + 4); await sleep(200);
  const hoverState = await s.state(), hover = hoverState.render.calls, hoverFrames = hoverState.frames_drawn - fa;
  await s.ev("viewer.setJoint('J_mon_pan', 0.1)"); await sleep(200); const withShadow = (await s.state()).render.calls;
  record("T44", "an idle page draws nothing", f1 === f0 && f2 > f1 && cpu < 2, `${f1 - f0} frames drawn in 2 s without input (main thread busy ${cpu.toFixed(2)} %); ${f2 - f1} frames after the pointer moved onto a part`, "0 frames; was 120 frames and 7–8 % busy");
  record("T45", "pointing at parts does not redraw shadows", hoverFrames >= 2 && hover <= still + 2 && withShadow > still * 1.5, `draw calls in a frame: ${still} at rest, ${hover} while pointing from part to part (${hoverFrames} frames drawn), ${withShadow} when a part really moved (shadow pass)`, "pointing = at rest; was doubled on every hover change");
  await close(s);
});
/** The person is loaded and the shared scene's own person has been applied to it (live.ts does that once it is connected, and would
 *  otherwise overwrite a set() made before), so a test's own changes stay. */
const PERSON_SETTLED = "viewer.person.ready.then(() => new Promise((res) => { const t0 = performance.now(); const go = () => { const l = viewer.live?.(); if (!l || l.person !== undefined || performance.now() - t0 > 4000) setTimeout(() => res(1), 300); else setTimeout(go, 50); }; go(); }))";
await test("T10c", "the person is seated for its own body after a change of body", async () => {
  // A person changed on the page must sit as that body seated afresh: the rig binding has to use the new body's solver (a stale solver
  // put a P5 woman 31 mm low and a P95 man 37 mm high, found by MC's eye comparison on 2026-11-25). Each body is set, then set again
  // (the second binding is made with a solver that is certainly this body's); the eye point must not move between the two.
  const BODIES: [string, string][] = [["f", "Small woman (stature P5)"], ["m", "Median man"], ["m", "Tall man (stature P95)"], ["m", "Small man (stature P5)"]];
  const s = await open(1200, 900, "?ui=0"); await s.ev(PERSON_SETTLED);
  const rows: string[] = []; let worst = 0;
  for (const [sex, shape] of BODIES) {
    const one = `viewer.person.set({ sex: '${sex}', shape: ${JSON.stringify(shape)} }).then(() => viewer.frame()).then(() => viewer.person.anchor('eye_midpoint'))`;
    const a = await s.ev<number[]>(one), b = await s.ev<number[]>(one), e = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 1000;
    worst = Math.max(worst, e); rows.push(`${shape}: ${e.toFixed(2)} mm (eye at ${(a[2] * 1000).toFixed(0)} mm)`);
  }
  await close(s);
  record("T10c", "person: seated for its own body right after a change (eye point)", worst <= 1, rows.join("; "), "≤ 1 mm between the first binding after a change of body and a second one");
});
await test("T10d", "the operator's view with a person seated looks from the person's own eyes, unobstructed", async () => {
  const s = await open(1200, 900, "?ui=0&view=operator"); await s.ev(PERSON_SETTLED); await s.ev("viewer.frame()");
  const look = async () => s.ev<any>(`(() => { const st = viewer.state(), e = viewer.person.anchor('eye_midpoint'), c = st.camera.position, p = viewer.person.pickAt(600, 450, 0.05); return { d: Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]) * 1000, hit: p ? p.distance : null, mesh: p ? p.mesh : null }; })()`);
  const a = await look();
  await s.ev("viewer.person.set({ shape: 'Tall man (stature P95)' })"); await s.ev("viewer.frame()"); const b = await look();
  await s.ev("viewer.apply({ ui: '0', view: 'three_quarter' })"); const shownAgain = await s.ev<number>("viewer.person.avatar().meshes.filter((m) => m.visible && /^(garment_cap|glasses|prop_headset)/.test(m.name)).length");
  await close(s);
  const clear = (x: any) => x.hit === null || x.hit > 0.25;
  record("T10d", "person: operator's view from the person's eyes, nothing of the head in front", a.d <= 1 && b.d <= 1 && clear(a) && clear(b) && shownAgain >= 3, `camera ${a.d.toFixed(2)} mm from the median man's eyes, ${b.d.toFixed(2)} mm after he became the P95 man; first thing of the person on the line of sight beyond the near plane: ${a.hit === null ? "none" : `${(a.hit * 100).toFixed(0)} cm (${a.mesh})`} / ${b.hit === null ? "none" : `${(b.hit * 100).toFixed(0)} cm (${b.mesh})`}; cap, glasses and headset back in the overview: ${shownAgain}`, "≤ 1 mm; nothing of the person within 25 cm on the line of sight (MPK: the camera was 39 mm inside the head)");
});
await test("T10e", "a still of the seated person repeats exactly right after a change of body", async () => {
  const s = await open(1200, 900, "?ui=0"); await s.ev(PERSON_SETTLED);
  const rows: string[] = []; let ok = true;
  for (const shape of ["Short and heavy (stature P5, weight P95)", "Tall and thin (stature P95, weight P5)", "Median man"]) {
    await s.ev(`viewer.person.set({ shape: ${JSON.stringify(shape)} })`); await s.ev("viewer.frame()"); const a = await s.ev<string>("viewer.picture()");
    await s.ev("viewer.person.still(true)"); await s.ev("viewer.frame()"); const b = await s.ev<string>("viewer.picture()");
    ok &&= a === b; rows.push(`${shape}: ${a === b ? "same" : "differs"}`);
  }
  await close(s);
  record("T10e", "person: the first still after a change = the same still again (seat sink map drawn for this shot)", ok, rows.join("; "), "identical pictures (MPK: a still showed the previous shot's sink map)");
});
await test("T10f", "a standing person does not stare at the rig's screen", async () => {
  const s = await open(1200, 900, "?ui=0"); await s.ev(PERSON_SETTLED);
  const seated = await s.ev<any>("viewer.person.avatar().state('eyes').target");
  await s.ev("viewer.person.place({ origin: [0.9, 0.9, 0], yawDeg: 180 })"); await s.ev("viewer.person.set({ pose: 'RELAXED_STAND' })"); await s.ev("viewer.frame()");
  const st = await s.ev<any>("(() => { const e = viewer.person.avatar().state('eyes'); return { target: e.target, mode: e.report?.mode }; })()");
  await close(s);
  record("T10f", "person: the seated gaze point is cleared when the person stands", Array.isArray(seated) && st.target === null && st.mode === "portrait", `seated: gaze point ${Array.isArray(seated) ? "on the screen" : "none"}; standing (relaxed stand, placed off the seat): gaze point ${st.target === null ? "none" : "kept"}, eye mode ${st.mode}`, "none, portrait (MPK: every standing face stared toward the rig)");
});
await test("T10g", "a pick on the person lands on its skin as drawn (eight influences, dual quaternions)", async () => {
  // the pick's distance against the depth the person's own shaders draw at the same pixel, over a grid of pixels on the person
  const s = await open(1200, 900, "?ui=0"); await s.ev(PERSON_SETTLED); await s.ev("viewer.apply({ ui: '0', camera: '0.2,0.9,1.25,-0.45,0,0.85,40' })"); await s.ev("viewer.frame()");
  const r = await s.ev<any>(`(() => { const rows = []; for (let y = 120; y < 860; y += 40) for (let x = 120; x < 1100; x += 40) { const p = viewer.person.pickAt(x + 0.5, y + 0.5), d = viewer.person.depthAt(x, y); if (p && d) rows.push(Math.abs(p.distance - d)); } rows.sort((a, b) => a - b); return { n: rows.length, median: rows[Math.floor(rows.length / 2)] ?? null, p90: rows[Math.floor(rows.length * 0.9)] ?? null }; })()`);
  await close(s);
  record("T10g", "person: picks on the skin as drawn", r.n >= 50 && r.median * 1000 <= 2 && r.p90 * 1000 <= 10, `${r.n} pixels on the person: pick distance against the drawn depth, median ${(r.median * 1000).toFixed(2)} mm, 90th percentile ${(r.p90 * 1000).toFixed(2)} mm`, "median ≤ 2 mm, 90 % within 10 mm (silhouette pixels differ by nature); three's own four-influence pick was up to 190 mm off");
});
await test("T10h", "a standing person placed off the seat stands on its soles, on the floor beside the rig and on the deck over it", async () => {
  const s = await open(1200, 900, "?ui=0"); await s.ev(PERSON_SETTLED);
  // the lowest point of every visible mesh as the person's shader skins it (MPK's packet measure), against the floor it was placed on
  const LOW = "(() => { const av = viewer.person.avatar(); let m = Infinity, at = ''; for (const me of av.meshes.filter((x) => x.visible)) { const P = av.skinnedPositions(me); for (let i = 1; i < P.length; i += 3) if (P[i] < m) { m = P[i]; at = me.name; } } return { m, at, placed: viewer.person.state().placed }; })()";
  const floorZ = await s.ev<number>("viewer.manifest().datums.find((d) => d.id === 'D_floor').origin[2]");
  const rows: string[] = []; let worst = 0, surfaces = true;
  for (const style of ["dressed", "clay"]) {
    await s.ev(`viewer.person.set({ style: '${style}' }).then(() => true)`);
    const spots: [number[], string, number][] = [[[0.9, 0.9, 0], "floor", floorZ], [[0.55, -0.6, 0], "deck", 0]];
    for (const [at, on, z] of spots) for (const pose of on === "deck" ? ["A_POSE"] : ["A_POSE", "RELAXED_STAND", "clip idle-stand"]) {
      await s.ev(`viewer.person.place({ origin: ${JSON.stringify(at)}, yawDeg: 180 })`);
      const set = pose === "A_POSE" ? "{ clip: null, pose: viewer.person.avatar().manifest.packet?.poses?.A_POSE?.dofs ?? 'A_POSE' }" : pose.startsWith("clip") ? "{ clip: 'idle-stand', time: 2.0 }" : `{ clip: null, pose: '${pose}' }`;
      await s.ev(`viewer.person.set(${set}).then(() => true)`); await s.ev("viewer.frame()");
      const r = await s.ev<any>(LOW), off = (r.m - z) * 1000;
      surfaces &&= r.placed?.on === on && Math.abs(r.placed.origin[2] - z) < 1e-6;
      worst = Math.max(worst, Math.abs(off)); rows.push(`${style} ${pose} on the ${r.placed?.on} (z ${(r.placed?.origin?.[2] * 1000).toFixed(0)} mm): lowest ${off.toFixed(1)} mm (${r.at})`);
    }
  }
  await close(s);
  record("T10h", "person: standing on its soles on the floor it stands on", worst <= 1 && surfaces, rows.join("; "), "the lowest point of every visible mesh within 1 mm of the floor under the spot: D_floor beside the platform, the deck top over it (MPK full-01: A_POSE 6 to 9 mm under, beside the rig at the deck's height)");
});
await test("T10j", "seated thighs press against the pods' inner sides instead of passing through them", async () => {
  const s = await open(1200, 900, "?ui=0"); await s.ev(PERSON_SETTLED);
  const rows: string[] = []; let worst = 0, pressed = true;
  for (const [label, shape] of [["median man", "Median man"], ["M50_HEAVY", "M50_HEAVY"], ["M95H", "M95H"]]) {
    await s.ev(`viewer.person.set({ shape: '${shape}', pose: null, script: 'hold', time: null }).then(() => true)`); await s.ev("viewer.frame()");
    const d = await s.ev<any>("viewer.person.shells()");
    for (const [pod, v] of Object.entries<any>(d ?? {})) { worst = Math.max(worst, v.after_mm); if (v.before_mm > 3 && !(v.after_mm < v.before_mm)) pressed = false; if (v.before_mm > 0 || v.after_mm > 0) rows.push(`${label} ${pod}: ${v.before_mm} mm inside before the contact, ${v.after_mm} mm after`); }
    if (!d || !Object.keys(d).length) { pressed = false; rows.push(`${label}: no pod surfaces in the rig binding`); }
  }
  await close(s);
  record("T10j", "person: the pods' inner sides hold the thighs", worst <= 3 && pressed, rows.join("; ") || "no skin inside a pod before or after", "the drawn skin at most 3 mm inside a pod's face (MPK full-01: M50_HEAVY 8.7 mm, M95H 7 mm; the seat's roll of displaced tissue also put the median man's thighs 9 mm into them)");
});
await test("T10i", "the seated hands hold the real levers without sinking into them", async () => {
  const s = await open(1200, 900, "?ui=0"); await s.ev(PERSON_SETTLED);
  const BODIES: [string, string, string][] = [["P5 woman", "f", "Small woman (stature P5)"], ["P50 man", "m", "Median man"], ["P95 man", "m", "Tall man (stature P95)"]], rows: string[] = []; let worstAll = -1, profAll = true;
  for (const [label, sex, shape] of BODIES) {
  await s.ev(`viewer.person.set({ sex: '${sex}', shape: ${JSON.stringify(shape)} })`); await s.ev("viewer.frame()");
  const r = await s.ev<any>(`(() => { const av = viewer.person.avatar(), T = av.state('operator')._op.targets, body = av.meshes.find((m) => m.name === 'body'), P = av.skinnedPositions(body), out = {};
    for (const k of ['l', 'r']) { const st = T.grip[k], hb = av.bones.get('hand_' + k).matrixWorld.elements, g = av.state('operator')._op.gripNow[k], ax = g.axis, c = g.centre;
      const inv = new av.root.matrixWorld.constructor().copy(av.root.matrixWorld).invert().elements; let worst = -1, n = 0;
      for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; if (Math.hypot(x - hb[12], y - hb[13], z - hb[14]) > 0.13) continue;
        const lx = inv[0] * x + inv[4] * y + inv[8] * z + inv[12], ly = inv[1] * x + inv[5] * y + inv[9] * z + inv[13], lz = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
        const rx = lx - c[0], ry = ly - c[1], rz = lz - c[2], t = rx * ax[0] + ry * ax[1] + rz * ax[2]; if (Math.abs(t) > 0.06) continue; const prof = st.profile, R = prof ? (() => { if (t <= prof[0][0]) return prof[0][1]; for (let j = 1; j < prof.length; j++) if (t <= prof[j][0]) return Math.min(prof[j - 1][1], prof[j][1]); return prof[prof.length - 1][1]; })() : st.radius;   /* the smaller of the two samples around t: a step in the handle (the bellows' top) is not read as a cone */
        const d = Math.hypot(rx - t * ax[0], ry - t * ax[1], rz - t * ax[2]); worst = Math.max(worst, R - d); n++; }
      out[k] = { worst_mm: +(worst * 1000).toFixed(1), n, profile: !!st.profile }; }
    return out; })()`);
  const grip = await s.ev<any>("viewer.person.state().report?.grip");
  worstAll = Math.max(worstAll, r.l.worst_mm, r.r.worst_mm); profAll &&= r.l.profile && r.r.profile; rows.push(`${label}: left ${r.l.worst_mm} mm, right ${r.r.worst_mm} mm; held hand: middle finger wraps ${grip?.r?.middle_wrap_deg ?? '?'}° round a handle of ${grip?.r?.circumference_mm ?? '?'} mm circumference, middle fingertip ${grip?.r?.fingertip_to_thumb_mm ?? '?'} mm from the thumb tip; hand breadth ${grip?.hand_breadth_mm ?? '?'} mm, length ${grip?.hand_length_mm ?? '?'} mm`);
  }
  await close(s);
  record("T10i", "person: hand skin into the levers (against the handles' radius profile)", profAll && worstAll <= 3, `deepest hand skin inside the handle: ${rows.join("; ")} (${profAll ? "the real handles' radius profile" : "no profile from the rig binding yet: a cylinder of the handle's reference radius"})`, "≤ 3 mm against the real handles' profile (MPK: 8–11 mm into the lever where it flares below the palm); needs targets.grip.profile from the rig binding");
});
await test("T44b", "the person idles only in a live view, at a capped rate", async () => {
  const s = await open(1440, 900); await s.ev("viewer.person.ready"); await s.settle(800);
  const rate = await s.ev<number>("(async () => { const f0 = viewer.state().frames_drawn; await new Promise((r) => setTimeout(r, 2000)); return (viewer.state().frames_drawn - f0) / 2; })()");
  await s.ev("viewer.apply({ ui: '0' })"); await s.settle(600);
  const still = await s.ev<number>("(async () => { const f0 = viewer.state().frames_drawn; await new Promise((r) => setTimeout(r, 2000)); return viewer.state().frames_drawn - f0; })()");
  const a = await s.ev<string>("viewer.picture()"); await sleep(1500); await s.ev("viewer.frame()"); const b = await s.ev<string>("(viewer.apply({ ui: '0' }), viewer.picture())");
  const same = a === b, st = await s.ev<any>("viewer.person.state()");
  await close(s);
  record("T44b", "person: idle motion live only, capped; a still view stays still", rate > 5 && rate <= 31 && still === 0 && same && st.shown, `${rate.toFixed(1)} frames a second while the person idles in a live view; ${still} frames in 2 s in a still view (ui=0); two pictures of the still view 1.5 s apart ${same ? "identical" : "differ"}`, "live: at most 30 a second ([runtime] idle_fps); still: 0 frames and the same picture");
});
await test("T46", "frame rate while something changes every frame", async () => {
  // the rig's own frame rate: the person is loaded but not shown (its frame cost is check C-86 of bun run check, its idle rate T44b)
  const s = await open(1440, 900, "?person=off");
  const b = await s.ev<any>("viewer.benchmark(120)");
  const sel = await s.ev<any>("(async () => { viewer.select('seat'); const t0 = performance.now(); for (let i = 0; i < 120; i++) { viewer.setJoint('J_mon_pan', 0.3 * Math.sin(i / 10)); await new Promise((r) => requestAnimationFrame(r)); } const dt = performance.now() - t0; viewer.resetJoints(); viewer.select(null); return 120000 / dt; })()");
  record("T46", "frame rate while something changes every frame (1440×900 window)", b.fps >= 55 && sel >= 55, `${b.fps.toFixed(0)} fps redrawing the still view (${b.triangles.toLocaleString("en")} triangles, ${b.calls} draw calls); ${sel.toFixed(0)} fps with a selection outline, a joint moving and shadows redrawn every frame`, "≥ 55 fps (display rate 60)");
  await close(s);
});
await test("T46p", "frame rate with the default person shown", async () => {
  // the same measurement with the person in the seat, at the designer's size; never skipped. A loaded machine makes the figure
  // meaningless, so below the limit it is a warning there and a failure only on a quiet machine (load average below the core count).
  const cores = cpus().length, load0 = loadavg()[0];
  const s = await open(1600, 1000);
  const shown = await s.ev<boolean>("!!(viewer.person && viewer.person.state().shown)");
  const b = await s.ev<any>("viewer.benchmark(120)");
  const sel = await s.ev<any>("(async () => { viewer.select('seat'); const t0 = performance.now(); for (let i = 0; i < 120; i++) { viewer.setJoint('J_mon_pan', 0.3 * Math.sin(i / 10)); await new Promise((r) => requestAnimationFrame(r)); } const dt = performance.now() - t0; viewer.resetJoints(); viewer.select(null); return 120000 / dt; })()");
  const load = Math.max(load0, loadavg()[0]), loaded = load >= cores, fast = b.fps >= 55 && sel >= 55;
  record("T46p", "frame rate with the default person shown (1600×1000 window)", shown && (fast || loaded), `${b.fps.toFixed(0)} fps redrawing the view with the person (${b.triangles.toLocaleString("en")} triangles, ${b.calls} draw calls); ${sel.toFixed(0)} fps with a selection outline, a joint moving and shadows redrawn every frame; person shown: ${shown}; load average ${load.toFixed(1)} on ${cores} cores${loaded && !fast ? " — the machine is loaded: not the real frame rate" : ""}`, "≥ 55 fps (display rate 60; the designer's target is 60 at 1600 × 1000 on the M2); a warning below it on a loaded machine", loaded && !fast);
  await close(s);
});

// ---- exposure -----------------------------------------------------------------------------------------
await test("T53", "exposure: whites not clipped, form readable, blacks apart", async () => {
  const out: string[] = []; let ok = true;
  for (const view of ["three_quarter", "rear"]) {
    const s = await open(1440, 900, `?ui=0&view=${view}`);
    const r = await s.ev<any>(`(() => { const gl = document.getElementById('gl'), c = document.createElement('canvas'); c.width = gl.clientWidth; c.height = gl.clientHeight; const g = c.getContext('2d'); g.drawImage(gl, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data, by = {};
      for (let y = 2; y < c.height; y += 4) for (let x = 2; x < c.width; x += 4) { const h = viewer.pickAt(x, y); if (!h || !h.material) continue; const o = (y * c.width + x) * 4; (by[h.material] ||= []).push((d[o] + d[o + 1] + d[o + 2]) / 3); }
      const out = {}; for (const [m, v] of Object.entries(by)) { v.sort((a, b) => a - b); const q = (f) => Math.round(v[Math.min(v.length - 1, Math.floor(f * v.length))]); out[m] = { p5: q(0.05), p50: q(0.5), p75: q(0.75), p95: q(0.95), clipped: v.filter((x) => x >= 250).length / v.length }; }
      return out; })()`);
    const w = r.shell_white, darks = ["leather_black", "plastic_black", "deck_dark"].filter((m) => r[m]);
    ok &&= !!w && w.p95 <= 235 && w.p75 >= 185 && w.clipped < 0.005 && w.p5 <= w.p75 - 35 && darks.every((m) => r[m].p50 >= 22 && r[m].p50 <= 110);
    out.push(`${view}: white lit ${w?.p75}–${w?.p95}, median ${w?.p50}, shaded ${w?.p5}, clipped ${((w?.clipped ?? 0) * 100).toFixed(1)} %; ${darks.map((m) => `${m.replace("_", " ")} ${r[m].p50}`).join(", ")}`);
    await close(s);
  }
  record("T53", "exposure: whites not clipped, form readable, blacks apart (mean of R, G, B per material, 0–255)", ok, out.join(" | "), "lit white about 200–225 (was 244–249), shaded white at least 35 lower, no clipping, blacks 22–110");
});

// ---- machine interface: same pictures as the previous viewer ---------------------------------------------
await test("T49", "URL interface: same pictures and state as the previous viewer", async () => {
  if (!BASELINE) { record("T49", "URL interface: same pictures and state as the previous viewer", true, "skipped (no --baseline server given)"); return; }
  const probe0 = await open(600, 400, "?ui=0"), jd = await defs(probe0); await close(probe0);
  const cases: Record<string, unknown>[] = [{ view: "front", proj: "ortho", hud: "1" }, { only: "seat", fit: "seat" }, { hide: "pods" }, { pose: `J_mon_height:${(jd.J_mon_height.lower * 0.8).toFixed(3)},J_mon_tilt:${((jd.J_mon_tilt.upper * 0.7) * 57.2958).toFixed(1)},J_seat_slide:${(jd.J_seat_slide.upper * 0.5).toFixed(3)},J_ts_arm:${jd.J_ts_arm.neutral.map((v: number, i: number) => ((v + jd.J_ts_arm.upper * [0.3, 0.5, 0][i]) * 57.2958).toFixed(1)).join("/")}` }, { mode: "ids", legend: "1" }, { mode: "class" }, { frames: "1" }, { wire: "1" },
    { view: "operator" }, { view: "top", proj: "ortho", caption: "Top" }, { camera: "-2.2,-1.6,1.5,0,0,0.6,40" }, { view: "front_quarter", fit: "C_joy_lever_L", only: "pods", mode: "ids" }, { view: "left", hud: "1" }];
  const probe = await open(600, 400, "?ui=0"), cams: string[] = await probe.ev("viewer.cameras()"); await close(probe);
  if (cams.length) cases.push({ cam: cams[0], overlay: "none" }, { cam: cams[0], overlay: "outline" });
  // the lighting was changed on purpose after the redesign (whites were overexposed); look=previous restores the earlier lighting so that framing and content can still be compared pixel by pixel
  const a = await open(1200, 900, "?ui=0", BASELINE), b = await open(1200, 900, "?ui=0&look=previous"), cmp = await browser.page("about:blank");
  const rows: string[] = []; let worst = 0, stateDiffs = 0, operatorNote = "";
  for (const c of cases) {
    const sa = await a.ev<any>(`viewer.apply(${JSON.stringify({ ui: "0", ...c })})`), pa = (await a.page.call("Page.captureScreenshot", { format: "png" })).data;
    const sb = await b.ev<any>(`viewer.apply(${JSON.stringify({ ui: "0", ...c })})`), pb = (await b.page.call("Page.captureScreenshot", { format: "png" })).data;
    const d = await cmp.evaluate(`(async () => { const load = async (b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
      const A = await load(${JSON.stringify(pa)}), B = await load(${JSON.stringify(pb)}); let sum = 0, big = 0, max = 0; for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); sum += d; if (d > 8) big++; if (d > max) max = d; } return { mean: sum / (A.length / 4), big: big / (A.length / 4), max, same: A.length === B.length }; })()`);
    // equal apart from the keys this version added and from the last digits of the camera numbers
    const round = (v: any): any => (typeof v === "number" ? +v.toFixed(9) : Array.isArray(v) ? v.map(round) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);
    const pick = (s: any) => { const o = { ...s }; for (const k of ["fps", "frames_drawn", "selected", "assumed_in_use"]) delete o[k]; return JSON.stringify(round(o)); };
    let eq = pick(sa) === pick(sb);
    if (c.view === "operator") { // deliberate change: the camera now sits exactly on the eye point (it used to be pushed 5 cm back by the orbit control's minimum distance)
      const da = sa.camera.target.map((v: number, i: number) => v - sa.camera.position[i]), db = sb.camera.target.map((v: number, i: number) => v - sb.camera.position[i]);
      const ang = Math.acos(Math.min(1, (da[0] * db[0] + da[1] * db[1] + da[2] * db[2]) / (Math.hypot(da[0], da[1], da[2]) * Math.hypot(db[0], db[1], db[2])))) * 180 / Math.PI;
      rows.push(`view=operator (deliberately changed): camera ${(dist(sa.camera.position, sb.camera.position) * 100).toFixed(1)} cm further forward, now exactly on the eye point; line of sight differs by ${ang.toFixed(3)}°; ${(d.big * 100).toFixed(1)} % of pixels differ`);
      operatorNote = `view=operator deliberately differs (camera ${(dist(sa.camera.position, sb.camera.position) * 100).toFixed(1)} cm forward, on the eye point; same line of sight to ${ang.toFixed(3)}°)`;
      if (ang > 0.01) stateDiffs++;
      continue;
    }
    if (!eq) stateDiffs++;
    worst = Math.max(worst, d.big);
    rows.push(`${Object.entries(c).map(([k, v]) => `${k}=${v}`).join("&")}: mean difference ${d.mean.toFixed(3)} of 255, ${(d.big * 100).toFixed(3)} % of pixels differ by more than 8, state ${eq ? "equal" : "DIFFERS: " + Object.keys(sa).filter((k) => JSON.stringify(sa[k]) !== JSON.stringify(sb[k]) && k !== "fps").join(",")}`);
  }
  await cmp.close(); await close(a); await close(b);
  writeFileSync(join(SHOTS, "machine-interface-comparison.txt"), rows.join("\n") + "\n");
  record("T49", "URL interface: same pictures and state as the previous viewer", worst < 0.002 && stateDiffs === 0, `${cases.length - 1} parameter sets at 1200×900 with ui=0: at most ${(worst * 100).toFixed(3)} % of pixels differ by more than 8/255; viewer.state() equal in ${cases.length - 1 - stateDiffs} of ${cases.length - 1}; ${operatorNote} (details in machine-interface-comparison.txt)`, "with look=previous (the earlier lighting): pictures equal up to antialiasing noise; state equal apart from the added keys");
});
await test("T50", "page errors and warnings during the whole run", async () => {
  const errs = [...new Set(allErrors)];
  record("T50", "page errors and warnings during the whole run", errs.length === 0, errs.length ? errs.join(" | ") : 0, "0");
});

await browser.close(); server?.stop(true);
const failed = results.filter((r) => !r.pass), seconds = (performance.now() - t0) / 1000;
const out = opt("--json") ? join(ROOT, opt("--json")!) : join(SHOTS, "ui-accept.json");
writeFileSync(out, JSON.stringify({ origin: ORIGIN, viewer: process.env.RIGTWIN_VIEWER_DIR || "viewer", seconds, results }, null, 1));
console.log(`${failed.length ? "UI ACCEPTANCE FAILED" : "ui acceptance passed"}: ${results.length - failed.length} of ${results.length} checks, ${seconds.toFixed(1)} s → ${out}`);
timeline(failed.length ? "ui-accept failed" : "ui-accept", seconds, `${results.length - failed.length}/${results.length} checks passed, viewer ${process.env.RIGTWIN_VIEWER_DIR || "viewer"}`);
process.exit(failed.length ? 1 : 0);
