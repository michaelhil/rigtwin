// bun tools/live-site-check.ts <url>      e.g. https://mightwork.ai/rigtwin
// The two-browser acceptance of the shared scene on a deployed site (tools/live-accept.ts is the same for a local
// server, with more cases). Two headless Chromium pages on the given address and the real command line:
//   1. a small pose.set from the command line (the monitor's turn, 1°, in a group) appears in both pages, with
//      the activity line naming Claude Code
//   2. Undo on one page's activity line puts it back in both
//   3. a slider move in page A (the monitor's height, 5 mm) appears in B, and history.undo of its version puts it back
//   4. a view command reaches only the page whose session code it names
//   5. nothing is logged in the pages; "Shared scene" under More shows the session code and the sandbox statement
// The site's Playground is public and shared: this script makes four changes in all (two and their two undos) and
// one view command, a handful of queries, and leaves the pose exactly as it found it: it compares the pose before
// and after, and if it stops half-way it puts its two joints back. Exit code 1 when a step fails.
import { Browser, type Page } from "./render.ts";
import { call } from "./rig.ts";
import { sleep, DEG, until, joint, live, rig, heightSlider, press, release, clickText } from "./live-helpers.ts";

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) { console.error("usage: bun tools/live-site-check.ts <url>   (e.g. https://mightwork.ai/rigtwin)"); process.exit(2); }
let failures = 0;
const check = (ok: boolean, what: string, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`); };
const PAN = "J_mon_pan", HEIGHT = "J_mon_height", group = `site-check-${Math.random().toString(16).slice(2, 8)}`;
const t0 = performance.now();
let commands = 0;

/** The shared pose as the server tells it: every moved joint with its value (metres, degrees), and the scene version. */
async function scene() {
  const r = await call("scene.summary", {}, { server: base });
  if (!r.ok) throw new Error(`scene.summary on ${base}: ${r.error?.message ?? "no answer"}`);
  return { version: r.result.version as number, pose: Object.fromEntries(r.result.moved.map((m: any) => [m.joint, m.value])) as Record<string, number | number[]>, recent: r.result.recent as any[], server: r.server };
}
const same = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9) : typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b);
const differing = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k]));

const before = await scene();
console.log(`${before.server}: scene version ${before.version}, ${Object.keys(before.pose).length} joint(s) moved before the check`);
const browser = await Browser.launch();
const pages: Page[] = [];
const open = async () => {
  const p = await browser.page("about:blank");
  await p.viewport(1440, 900);
  await p.call("Page.navigate", { url: `${base}/` });
  await p.waitFor("window.viewerReady || window.viewerError", "the viewer");
  pages.push(p);
  return p;
};
let pan0 = 0, height0 = 0;                    // the two joints this check moves, as it found them (degrees, metres)
try {
  const A = await open(), B = await open();
  const la = await until<any>(A, "viewer.live() && viewer.live().version >= 0 && viewer.live()", 15000), lb = await until<any>(B, "viewer.live() && viewer.live().version >= 0 && viewer.live()", 15000);
  check(!!la && !!lb && la.code !== lb.code, "both pages connect to the shared scene, each with its own code", `${la?.code} and ${lb?.code}`);
  if (!la || !lb) throw new Error("the pages did not connect to the shared scene; nothing was changed");
  const limits = await A.evaluate(`(() => { const j = viewer.manifest().joints.find((j) => j.id === '${PAN}'); return [j.lower, j.upper]; })()`) as number[];
  pan0 = (await joint(A, PAN)) / DEG; height0 = await joint(A, HEIGHT);

  // 5a. the "Shared scene" block under More: this page's code and the statement about the sandbox
  const block = await A.evaluate("(() => { const b = document.getElementById('live-more'); return { inMore: !!b && !b.hidden && !!b.closest('#more'), code: document.getElementById('live-code').textContent, about: b ? b.querySelector('.live-about').textContent.replace(/\\s+/g, ' ').trim() : '' }; })()") as { inMore: boolean; code: string; about: string };
  check(block.inMore && block.code === la.code && /^[A-HJKMNP-Z2-9]{8}$/.test(block.code) && /only the pose of the rig and its last 200 changes/.test(block.about) && /no names/.test(block.about), "More shows \"Shared scene\" with this page's code and the sandbox statement", `code ${block.code}; "${block.about.slice(0, 90)}…"`);

  // 1. the command line turns the monitor by 1° (the other way if that would pass the joint's limit)
  const pan1 = +(pan0 + (pan0 + 1 <= limits[1] / DEG - 0.5 ? 1 : -1)).toFixed(6);
  const r1 = await rig(base, "pose.set", JSON.stringify({ joints: { [PAN]: pan1 } }), "--group", group); commands++;
  const seen = (p: Page, id: string, si: number) => until<boolean>(p, `Math.abs(viewer.state().joints.${id} - (${si})) < 1e-7`, 8000);
  const [a1, b1] = [await seen(A, PAN, pan1 * DEG), await seen(B, PAN, pan1 * DEG)];
  const [act1a, act1b] = [(await live(A))?.activity ?? "", (await live(B))?.activity ?? ""];
  check(r1.ok && !!a1 && !!b1 && /^Claude Code · [0-9a-f]{4} — Monitor: turn/.test(act1a) && act1a === act1b, "a pose.set from the command line appears in both pages, the activity line naming Claude Code", `turn ${pan0}° → ${pan1}°; "${act1b}"`);

  // 2. Undo on B's activity line
  await clickText(B, "Undo"); commands++;
  const [a2, b2] = [await seen(A, PAN, pan0 * DEG), await seen(B, PAN, pan0 * DEG)], act2 = (await live(A))?.activity ?? "";
  check(!!a2 && !!b2 && /undid a change/.test(act2), "Undo on B's activity line puts it back in both pages", `turn ${pan0}° again; A says "${act2}"`);

  // 3. a slider move in A (5 mm), seen in B, undone by history.undo of its version
  await A.evaluate("viewer.select('C_stand_monitor')"); await sleep(300);
  const s = await heightSlider(A), to = s.v - 5 >= s.min + 5 ? s.v - 5 : s.v + 5, v3 = (await live(A))!.version;
  await press(A, s.at(s.v), s.at(to), s.y); await release(A, s.at(to), s.y); commands++;
  const a3 = await until<number>(A, `viewer.live().version > ${v3} && !viewer.live().unsaved.length && Math.abs(viewer.state().joints.${HEIGHT} - (${height0})) > 0.002 && viewer.state().joints.${HEIGHT}`, 8000);
  const b3 = a3 === null ? null : await seen(B, HEIGHT, a3), act3b = (await live(B))?.activity ?? "";
  const mine = (await scene()).recent.find((e) => e.version > v3 && e.command === "pose.set" && e.actor_kind === "person" && e.changes.some((c: any) => c.joint === HEIGHT));
  check(a3 !== null && !!b3 && /^Person · [0-9a-f]{4} — Monitor: height/.test(act3b) && !!mine, "a slider move in A appears in B with its activity line", `height ${(height0 * 1000).toFixed(1)} → ${a3 === null ? "?" : (a3 * 1000).toFixed(1)} mm; B: "${act3b}"; entry ${mine?.version ?? "not found"}`);
  if (mine) {
    const r3 = await rig(base, "history.undo", JSON.stringify({ version: mine.version }), "--group", group); commands++;
    const [a3u, b3u] = [await seen(A, HEIGHT, height0), await seen(B, HEIGHT, height0)];
    check(r3.ok && !!a3u && !!b3u, "history.undo of that version puts it back in both pages", `height ${(height0 * 1000).toFixed(1)} mm again (undid ${JSON.stringify(r3.result?.undid)})`);
  }

  // 4. a view command for A only (the view is each page's own: nothing shared changes)
  const r4 = await rig(base, "view.set", '{"view":"operator"}', "--viewer", la.code); commands++;
  const va = await until<string>(A, "viewer.state().view === 'operator' && 'operator'", 8000), vb = await B.evaluate("viewer.state().view");
  check(r4.ok && va === "operator" && vb !== "operator", "a view command reaches only the page whose code it names", `A: ${va}, B: ${vb}`);

  // 5b. nothing logged
  const errs = [...new Set(pages.flatMap((p) => p.errors))];
  check(errs.length === 0, "nothing logged in the pages (errors, warnings, failed requests)", errs.join(" | ") || "0");
} catch (e: any) {
  check(false, "the check ran to its end", String(e?.message ?? e));
} finally {
  await browser.close();
  // the Playground as it was: the pose before and after; if one of this check's two joints is off, put it back
  let after = await scene();
  const mineOff = differing(before.pose, after.pose).filter((j) => j === PAN || j === HEIGHT);
  if (mineOff.length) {
    const back = Object.fromEntries(mineOff.map((j) => [j, j === PAN ? pan0 : height0]));
    const r = await call("pose.set", { joints: back }, { server: base, group, client: "agent" }); commands++;
    console.log(`put back by hand: ${JSON.stringify(back)} (${r.ok ? "ok" : r.error?.message})`);
    after = await scene();
  }
  const off = differing(before.pose, after.pose);
  // a joint that differs although this check did not touch it was changed by someone else meanwhile: say who, do not fail for it
  const others = off.filter((j) => j !== PAN && j !== HEIGHT);
  check(off.filter((j) => j === PAN || j === HEIGHT).length === 0, "the Playground's pose is as the check found it", `version ${before.version} → ${after.version} (${commands} commands by this check); ${off.length ? `differing: ${off.join(", ")}` : "every joint equal"}${others.length ? ` (changed by others meanwhile: ${others.join(", ")})` : ""}`);
}
console.log(`live site check ${failures ? "FAILED" : "passed"}: ${failures} failure(s), ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
