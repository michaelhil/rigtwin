// Exercise the actual local viewer, its two renderers and its project directory with temporary data.
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser, type Page } from "./render.ts";
import { serveRoom } from "./room-serve.ts";

const temp = mkdtempSync(join(tmpdir(), "synergon-room-tools-"));
const service = await serveRoom({ port: 0, dataDir: temp }),
  site = service.url.origin;
const browser = await Browser.launch();
async function wait(page: Page, test: string) {
  for (let n = 0; n < 250; n++) {
    if (await page.evaluate(test)) return;
    await Bun.sleep(80);
  }
  throw new Error(
    "Failed waiting for " +
      test +
      "; " +
      (await page.evaluate("document.body.innerText.slice(-600)")) +
      "; " +
      page.errors.join(" | "),
  );
}
const click = (p: Page, label: string) => p.evaluate(`document.querySelector('[aria-label="${label}"]').click()`);
try {
  const { workspaces } = (await (await fetch(site + "/api/workspaces")).json()) as any;
  const ws = workspaces[0].id,
    path = "/workspaces/" + ws;
  const page = await browser.page(site + path);
  await page.viewport(1280, 880);
  await wait(page, "document.querySelector('.rw-toolbar')");
  await page.evaluate("document.querySelector('.rm-workspace-link').click()");
  assert(
    await page.evaluate(
      "document.querySelector('.rm-workspace-switcher').open && !document.querySelector('.rm-workspace-menu a[href*=list]')",
    ),
  );
  await wait(page, "document.querySelector('.rm-workspace-current')?.textContent.length > 0");
  await page.evaluate("document.querySelector('.rm-workspace-link').click()");
  await page.call("Page.setDownloadBehavior", { behavior: "allow", downloadPath: temp });
  await page.evaluate(
    `Object.defineProperty(navigator.clipboard,'writeText',{value:async text=>{window.__copied=text;}})`,
  );
  assert(await page.evaluate(`document.querySelector('.rw-pop').hidden`));
  await click(page, "Settings");
  assert(await page.evaluate(`document.querySelector('.rw-pop').textContent.includes('Agent access')`));
  await page.evaluate(
    `[...document.querySelectorAll('.rw-check')].find(e=>e.textContent==='Floor grid').querySelector('input').click()`,
  );
  assert(await page.evaluate(`document.querySelector('.rv-stage').classList.contains('rv-no-grid')`));
  const placements = await page.evaluate(
    `[...document.querySelectorAll('.rw-toolbar button')].map(b=>b.getBoundingClientRect().x)`,
  );
  assert(placements.at(-1) > placements[0]);
  await click(page, "Close settings");
  await wait(page, "document.querySelector('.rv-object .rv-part')");
  await click(page, "Save picture");
  await wait(page, `document.body.textContent.includes('Room picture saved.')`);
  let png: string | undefined;
  for (let n = 0; n < 40; n++) {
    png = readdirSync(temp).find((f) => f.endsWith(".png"));
    if (png) break;
    await Bun.sleep(100);
  }
  assert(png);
  assert.equal(readFileSync(join(temp, png)).readUInt32BE(0), 0x89504e47);
  await click(page, "Trace");
  await wait(page, `document.querySelector('.rw-content')?.textContent.includes('No recorded edits')`);
  await click(page, "Close activity");
  async function sharedView() {
    await page.evaluate("window.__copied=''");
    await click(page, "Copy view link");
    await wait(page, "window.__copied?.includes('#view=')");
    const url = await page.evaluate("window.__copied");
    return { url, state: JSON.parse(new URLSearchParams(new URL(url).hash.slice(1)).get("view")!) };
  }
  async function focus(name: string, id: string) {
    await click(page, "View scope");
    await wait(page, `document.querySelector('[aria-label="Focus on ${name}"]')`);
    await click(page, "Focus on " + name);
    await wait(
      page,
      `document.querySelector('.rv-stage').dataset.focusedAsset==='${id}' && document.querySelector('.rv-stage').dataset.view==='3d' && !!document.querySelector('[aria-label="Fit asset to view"]')`,
    );
  }
  const api = site + "/api/workspaces/" + ws + "/command";
  const command = async (id: string, args: object) =>
    (await (
      await fetch(api, {
        method: "POST",
        headers: { "content-type": "application/json", "x-synergon": "1" },
        body: JSON.stringify({ id, args }),
      })
    ).json()) as any;
  const roomPlan = (await sharedView()).state;
  await focus("Freestanding display", "display-a");
  await wait(page, "document.querySelectorAll('.rv-orbit-tag').length===1");
  await click(page, "Settings");
  assert(!(await page.evaluate("document.querySelector('.rw-content').innerText")).includes("Floor grid"));
  const labels = await page.evaluate(
    `(()=>{const box=[...document.querySelectorAll('.rw-check')].find(e=>e.textContent==='Object labels').querySelector('input');if(!box.checked)box.click();return box.checked;})()`,
  );
  assert(labels);
  await click(page, "Close settings");
  assert(await page.evaluate(`document.querySelector('[aria-label="Operator’s eye"]').disabled`));
  const isolated = await sharedView();
  assert.equal(isolated.state.focused, "display-a");
  assert(isolated.state.labels);
  const original = await command("state", {});
  assert.equal(original.version, 0, "Local focus and sharing must preserve the scene revision");
  await click(page, "Save picture");
  for (let n = 0; n < 60 && !readdirSync(temp).includes("Freestanding-display.png"); n++) await Bun.sleep(100);
  assert.equal(readFileSync(join(temp, "Freestanding-display.png")).readUInt32BE(0), 0x89504e47);
  const object = original.result.scene.instances.find((i: { id: string }) => i.id === "display-a");
  const moved = await command("instances.move", { instance: object.id, x: object.x + 2 });
  assert(moved.ok);
  await wait(page, `document.querySelector('.rm-version').textContent.includes('${moved.version}')`);
  const tracked = (await sharedView()).state;
  assert(Math.abs(tracked.orbit.target[0] - isolated.state.orbit.target[0] - 2) < 1e-8);
  const undo = await command("undo", {});
  assert(undo.ok);
  await wait(page, `document.querySelector('.rm-version').textContent.includes('${undo.version}')`);
  const focusedPage = await browser.page(isolated.url);
  await wait(
    focusedPage,
    "document.querySelector('.rv-stage')?.dataset.focusedAsset==='display-a' && document.querySelector('.rv-orbit-tag')?.dataset.instance==='display-a'",
  );
  await click(page, "Return to full room");
  await wait(
    page,
    "document.querySelector('.rv-stage').dataset.view==='plan' && !document.querySelector('.rv-stage').dataset.focusedAsset",
  );
  assert.deepEqual((await sharedView()).state.plan, roomPlan.plan);
  await click(page, "Views");
  await page.evaluate(`[...document.querySelectorAll('.rw-choice')].find(b=>b.textContent.includes('Front')).click()`);
  await wait(
    page,
    "document.querySelector('.rv-stage').dataset.view==='3d' && !!document.querySelector('.rv-orbit canvas')",
  );
  const roomOrbit = (await sharedView()).state;
  await focus("Station A", "station-a");
  await wait(page, "document.querySelector('.rv-stage').dataset.seatedHost==='station-a'");
  assert(!(await page.evaluate(`document.querySelector('[aria-label="Operator’s eye"]').disabled`)));
  const assetOrbit = (await sharedView()).state;
  assert(assetOrbit.orbit.halfWidth < roomOrbit.orbit.halfWidth);
  await click(page, "Return to full room");
  await wait(
    page,
    "!document.querySelector('.rv-stage').dataset.focusedAsset && document.querySelector('.rv-stage').dataset.view==='3d'",
  );
  const resumed = (await sharedView()).state;
  for (const key of ["position", "target"])
    for (const [n, value] of roomOrbit.orbit[key].entries())
      assert(Math.abs(resumed.orbit[key][n] - Number(value)) < 1e-9, "Restored room " + key);
  for (const key of ["halfWidth", "halfHeight", "zoom"]) assert.equal(resumed.orbit[key], roomOrbit.orbit[key]);
  assert.equal(resumed.selected, roomOrbit.selected);
  await click(page, "Operator’s eye");
  await wait(page, `document.querySelector('.rv-orbit').dataset.camera==='operator'`);
  await click(page, "Copy view link");
  await wait(page, `window.__copied?.includes('#view=')`);
  const copied = await page.evaluate("window.__copied");
  const shared = new URL(copied),
    camera = JSON.parse(new URLSearchParams(shared.hash.slice(1)).get("view")!);
  assert(camera.eye);
  assert.equal(camera.mode, "3d");
  const restored = await browser.page(copied);
  await wait(restored, `document.querySelector('.rv-orbit')?.dataset.camera==='operator'`);
  const before = await command("state", {});
  await click(page, "Reset all");
  await page.evaluate(`document.querySelector('dialog button[type="submit"]').click()`);
  await wait(page, `!document.querySelector('dialog')`);
  const after = await command("state", {});
  assert(
    after.version > before.version,
    JSON.stringify({
      before: before.version,
      after: after.version,
      initial: before.result?.scene.instances.map((i: any) => i.pose),
      error: after.error,
      text: await page.evaluate("document.body.innerText.slice(-300)"),
    }),
  );
  assert.equal(after.result.scene.instances.length, before.result.scene.instances.length);
  assert((await command("undo", {})).ok);
  assert((await command("instances.remove", { instance: "display-a" })).ok);
  await wait(
    focusedPage,
    "!document.querySelector('.rv-stage')?.dataset.focusedAsset && document.querySelector('.rv-stage')?.dataset.view==='plan'",
  );
  assert((await command("undo", {})).ok);
  const projects = await browser.page(site + "/projects");
  await wait(projects, "document.querySelector('.pr-shell h1')?.textContent==='Projects'");
  await projects.evaluate(
    `[...document.querySelectorAll('summary')].find(s=>s.textContent==='New project').click();const f=document.querySelector('.pr-shell form');f.querySelector('input').value='Browser project';f.requestSubmit()`,
  );
  await wait(projects, "document.querySelector('.pr-shell h1')?.textContent==='Browser project'");
  await projects.evaluate(
    `[...document.querySelectorAll('summary')].find(s=>s.textContent==='Named versions').click();const v=[...document.querySelectorAll('form')].find(f=>f.textContent.includes('Save named version'));v.querySelector('input').value='Before changes';v.requestSubmit()`,
  );
  await wait(projects, "document.body.textContent.includes('Version saved.')");
  console.log(
    "Passed Chromium project creation and version save, asset isolation and sharing, room camera restoration, focused asset removal, operator POV, PNG export, reset/undo, trace and settings.",
  );
} finally {
  await browser.close();
  service.close();
  rmSync(temp, { recursive: true, force: true });
}
