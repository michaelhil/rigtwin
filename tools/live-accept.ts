// bun tools/live-accept.ts — the shared scene in real browsers: two (and a third) headless Chromium pages on one
// local server (tools/serve.ts with an empty temporary Playground), driven with real pointer input.
//   1. a slider move in A appears in B, with B's activity line naming A (A shows none)
//   2. `bun run rig pose.set` appears in both, with the activity line
//   3. Undo on B's activity line undoes it in both
//   4. a stale edit (A holds a slider while Claude Code moves the same joint) is refused, the reason shown, A rolled back
//   5. a link with pose= shows Apply, saves nothing by itself, Dismiss returns to the shared pose, Apply saves it
//   6. a view command reaches only the browser whose code it names
//   7. a stranger who copies B's author id from the live channel cannot make B ignore the change (M3)
//   8. reconnecting (Leitbild's cases, see viewer/src/live-connection.ts): the server stops, the pages wait with
//      backoff, the server comes back, a change made meanwhile arrives, exactly one resync per page; the browser
//      coming back online (or the tab becoming visible) tries at once instead of waiting for the backoff
//   9. without a server the page works as before: no request under api/, nothing logged
// Exit code 1 when a step fails. Takes about 25 s.
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ROOT } from "./timeline.ts";
import { Browser, type Page } from "./render.ts";
import { startServer } from "./serve.ts";
import { sleep, DEG, until, joint, live, rig, heightSlider, press, release, clickText } from "./live-helpers.ts";

let failures = 0;
const check = (ok: boolean, what: string, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`); };

const t0 = performance.now();
const dataDir = mkdtempSync(join(tmpdir(), "rigtwin-live-accept-"));
let server = await startServer({ port: 0, data: dataDir });
const origin = server.url;
const browser = await Browser.launch();
const open = async (query = "", at = origin) => {
  const p = await browser.page("about:blank");
  await p.viewport(1440, 900);
  await p.call("Page.navigate", { url: `${at}/${query}` });
  await p.waitFor("window.viewerReady || window.viewerError", "the viewer");
  return p;
};
const pages: Page[] = [];
try {
  const A = await open(), B = await open();
  pages.push(A, B);
  const la = await until<any>(A, "viewer.live() && viewer.live().version >= 0 && viewer.live()"), lb = await until<any>(B, "viewer.live() && viewer.live().version >= 0 && viewer.live()");
  check(!!la && !!lb && la.code !== lb.code, "both pages connect to the shared scene, each with its own code", `${la?.code} and ${lb?.code}`);

  // 1. a slider move in A appears in B
  await A.evaluate("viewer.select('C_stand_monitor')"); await sleep(200);
  let s = await heightSlider(A);
  await press(A, s.at(s.v), s.at(-40), s.y); await release(A, s.at(-40), s.y);
  const a1 = await until<number>(A, "Math.abs(viewer.state().joints.J_mon_height + 0.04) < 0.0015 && viewer.state().joints.J_mon_height");
  const b1 = await until<number>(B, `Math.abs(viewer.state().joints.J_mon_height - (${a1})) < 1e-9 && viewer.state().joints.J_mon_height`);
  const actB = (await live(B))?.activity ?? "", actA = (await live(A))?.activity;
  check(a1 !== null && b1 !== null, "a slider move in A appears in B", `A ${a1} m, B ${b1} m`);
  check(/^Person · [0-9a-f]{4} — Monitor: height 4 cm lower$/.test(actB) && actA === null, "B's activity line says who changed what; A shows none for its own change", `B: "${actB}"; A: ${JSON.stringify(actA)}`);

  // 2. bun run rig pose.set appears in both, with the activity line
  const r2 = await rig(origin, "pose.set", '{"joints":{"J_mon_tilt":-5}}', "--group", "tilt-down");
  const a2 = await until<number>(A, `Math.abs(viewer.state().joints.J_mon_tilt + 5 * ${DEG}) < 1e-9 && viewer.state().joints.J_mon_tilt`), b2 = await until<number>(B, `Math.abs(viewer.state().joints.J_mon_tilt + 5 * ${DEG}) < 1e-9 && viewer.state().joints.J_mon_tilt`);
  const [act2a, act2b] = [(await live(A))?.activity ?? "", (await live(B))?.activity ?? ""];
  check(r2.ok && a2 !== null && b2 !== null && /^Claude Code · [0-9a-f]{4} — Monitor: tilt/.test(act2a) && act2a === act2b, "`bun run rig pose.set` appears in both pages with the activity line", `"${act2b}"`);

  // 3. Undo on B's activity line undoes it in both
  await clickText(B, "Undo");
  const neutralTilt = await B.evaluate("viewer.manifest().joints.find((j) => j.id === 'J_mon_tilt').neutral");
  const a3 = await until<boolean>(A, `Math.abs(viewer.state().joints.J_mon_tilt - ${neutralTilt}) < 1e-9`), b3 = await until<boolean>(B, `Math.abs(viewer.state().joints.J_mon_tilt - ${neutralTilt}) < 1e-9`);
  const act3 = (await live(A))?.activity ?? "", sum3 = await rig(origin, "scene.summary");
  check(!!a3 && !!b3 && /undid a change/.test(act3) && sum3.result.recent[0].undoes?.length === 1, "Undo on B's activity line undoes it in both pages", `A now says "${act3}"`);

  // 4. a stale edit: A holds the slider, Claude Code moves the same joint, A lets go
  s = await heightSlider(A);
  const v0 = (await live(A))!.version;
  await press(A, s.at(s.v), s.at(-20), s.y);
  const r4 = await rig(origin, "pose.set", '{"joints":{"J_mon_height":-0.08}}');
  await until(A, `viewer.live().version > ${v0}`);
  const held = await joint(A, "J_mon_height");
  await release(A, s.at(-20), s.y);
  const why = await until<string>(A, "(viewer.live().activity || '').startsWith('Not saved') && viewer.live().activity");
  const a4 = await until<boolean>(A, "Math.abs(viewer.state().joints.J_mon_height + 0.08) < 1e-9"), b4 = await joint(B, "J_mon_height");
  check(r4.ok && Math.abs(held + 0.02) < 0.0015 && !!why && /Claude Code/.test(why) && !!a4 && Math.abs(b4 + 0.08) < 1e-9, "a stale edit is refused, the reason shown, and A shows the shared value again", `while held A showed ${held.toFixed(3)} m; then "${why}"; A ${a4 ? "-0.08" : "?"} m, B ${b4} m`);

  // 5. a link with pose= is a preview with Apply; nothing is saved by itself
  const C = await open("?pose=J_mon_height:-0.05"); pages.push(C);
  const lc = await until<any>(C, "viewer.live() && viewer.live().version >= 0 && viewer.live()");
  await sleep(900);
  const shown = await joint(C, "J_mon_height"), sharedNow = (await rig(origin, "scene.summary")).result.moved.find((m: any) => m.joint === "J_mon_height")?.value;
  const bar = await C.evaluate("[...document.querySelectorAll('#notices .note')].some((n) => !n.hidden && /other adjustments/.test(n.textContent) && [...n.querySelectorAll('button')].some((b) => b.textContent === 'Apply'))");
  check(!!lc?.preview && bar && shown === -0.05 && sharedNow === -0.08, "a link with pose= shows Apply and saves nothing by itself", `C shows ${shown} m with the Apply bar; the shared value stays ${sharedNow} m`);
  await clickText(C, "Dismiss");
  const dismissed = await until<boolean>(C, "Math.abs(viewer.state().joints.J_mon_height + 0.08) < 1e-9 && !viewer.live().preview");
  const D = await open("?pose=J_mon_height:-0.05"); pages.push(D);
  await until(D, "viewer.live() && viewer.live().preview");
  await clickText(D, "Apply");
  const applied = await until<boolean>(B, "Math.abs(viewer.state().joints.J_mon_height + 0.05) < 1e-9");
  check(!!dismissed && !!applied, "Dismiss returns to the shared pose; Apply saves the link's pose for everyone", `dismissed: ${!!dismissed}; applied and seen in B: ${!!applied}`);

  // 6. a view command reaches only the addressed browser
  const codeA = (await live(A))!.code, r6 = await rig(origin, "view.set", '{"view":"operator"}', "--viewer", codeA);
  const va = await until<string>(A, "viewer.state().view === 'operator' && 'operator'"), vb = await B.evaluate("viewer.state().view");
  check(r6.ok && va === "operator" && vb !== "operator", "a view command reaches only the browser whose code it names", `A: ${va}, B: ${vb}`);

  const errs = [...new Set(pages.flatMap((p) => p.errors))];
  check(errs.length === 0, "nothing logged in the pages (errors, warnings, failed requests)", errs.join(" | ") || "0");

  // 7. a forged author id (M3): copy B's id from the live channel and send a change under it
  // B's public id, as anyone can read it on the live channel: the author of B's Undo (step 3)
  const snap = await (async () => {
    const res = await fetch(`${origin}/api/live`, { headers: { host: "127.0.0.1" } }), rd = res.body!.getReader(), dec = new TextDecoder();
    let buf = "";
    while (!buf.includes("event: snapshot")) buf += dec.decode((await rd.read()).value);
    while (!/event: snapshot\ndata: .*\n\n/.test(buf)) buf += dec.decode((await rd.read()).value);
    rd.cancel();
    return JSON.parse(/event: snapshot\ndata: (.*)\n\n/.exec(buf)![1]).doc;
  })();
  const idOfB = snap.history.find((e: any) => e.command === "history.undo" && e.actor.kind === "person")?.actor.id;
  const vB = (await live(B))!.version;
  const forged = await (await fetch(`${origin}/api/command`, { method: "POST", headers: { "x-rigtwin": "1", "content-type": "application/json", "x-rigtwin-client": "person", "x-rigtwin-client-id": idOfB, host: "127.0.0.1" }, body: JSON.stringify({ id: "pose.set", args: { joints: { J_mon_pan: 7 } } }) })).json();
  const seenInB = await until<boolean>(B, `viewer.live().version > ${vB} && Math.abs(viewer.state().joints.J_mon_pan - 7 * ${DEG}) < 1e-9`);
  check(!!idOfB && forged.ok && !!seenInB && forged.you.id !== idOfB && /Person/.test((await live(B))!.activity ?? ""), "a change sent under B's public id is applied by B and shown as someone else's (ids are made by the server)", `B's id ${idOfB}; the forger was stored as ${forged.you.id}; B shows the change: ${!!seenInB}, activity "${(await live(B))!.activity}"`);

  // 8. the server stops and comes back: backoff, catch-up, exactly one resync per page
  const r0 = [(await live(A))!.resyncs, (await live(B))!.resyncs];
  const port = server.port;
  server.stop();
  const down = await until<boolean>(A, "viewer.live().connected === false && viewer.live().waiting === true", 5000);
  await sleep(1200);
  server = await startServer({ port, data: dataDir });
  const r8 = await rig(origin, "pose.set", '{"joints":{"J_mon_height":-0.06}}');
  const back = await until<boolean>(A, "viewer.live().connected && Math.abs(viewer.state().joints.J_mon_height + 0.06) < 1e-9", 15000);
  const backB = await until<boolean>(B, "viewer.live().connected && Math.abs(viewer.state().joints.J_mon_height + 0.06) < 1e-9", 15000);
  await sleep(300);
  const r1 = [(await live(A))!.resyncs, (await live(B))!.resyncs];
  check(!!down && r8.ok && !!back && !!backB && r1[0] - r0[0] === 1 && r1[1] - r0[1] === 1, "after a server restart both pages reconnect by themselves, catch up, and resync exactly once", `waited with backoff: ${!!down}; caught up: A ${!!back}, B ${!!backB}; resyncs A +${r1[0] - r0[0]}, B +${r1[1] - r0[1]}`);
  // the browser coming back online tries at once, not after the backoff
  server.stop();
  await until(A, "viewer.live().attempt >= 3", 15000);            // now waiting 4 s or more before the next try
  server = await startServer({ port, data: dataDir });
  const t1 = Date.now();
  await A.evaluate("window.dispatchEvent(new Event('online'))");
  const quick = await until<boolean>(A, "viewer.live().connected", 3000);
  check(!!quick && Date.now() - t1 < 2500, "the browser coming back online reconnects at once", `connected ${Date.now() - t1} ms after 'online' (the backoff would have waited 4 s or more)`);
} catch (e: any) { check(false, "live acceptance", e.message); }
for (const p of pages) await p.close();
server.stop(); rmSync(dataDir, { recursive: true, force: true });

// 9. no server: the page works as today
{
  const requests: string[] = [], plain = await startServer({ port: 0, data: false, requests });
  try {
    const p = await open("", plain.url);
    await p.evaluate("viewer.select('C_stand_monitor')"); await sleep(200);
    const s = await heightSlider(p);
    await press(p, s.at(s.v), s.at(-30), s.y); await release(p, s.at(-30), s.y); await sleep(500);
    const v = await joint(p, "J_mon_height"), l = await p.evaluate("viewer.live()");
    check(l === null && Math.abs(v + 0.03) < 0.0015 && !requests.some((r) => r.startsWith("/api/")) && p.errors.length === 0, "without a server the page works as before", `live: ${JSON.stringify(l)}; slider moved the monitor to ${v.toFixed(3)} m; requests under api/: ${requests.filter((r) => r.startsWith("/api/")).length}; logged: ${p.errors.length}`);
    await p.close();
  } catch (e: any) { check(false, "without a server", e.message); }
  plain.stop();
}
await browser.close();
console.log(`${failures ? "LIVE ACCEPTANCE FAILED" : "live acceptance passed"}: ${failures} failure(s), ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
