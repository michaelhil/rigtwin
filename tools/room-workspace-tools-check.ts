// Exercise the actual local viewer, its two renderers, the Workspace › Project › Scene selector, the first run and the
// project pages with temporary data.
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
const key = (p: Page, key: string, code: number) =>
  p.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code }).then(() =>
    p.call("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code }));
const workspaceList = async () => ((await (await fetch(site + "/api/workspaces")).json()) as any).workspaces as { id: string; name: string }[];
try {
  const workspaces = await workspaceList();
  const tree = (await (await fetch(site + "/api/workspaces/" + workspaces[0].id)).json()) as any;
  const ws = tree.projects[0].scenes[0].id,
    path = "/workspaces/" + ws;
  const page = await browser.page(site + path);
  await page.viewport(1280, 880);
  await wait(page, "document.querySelector('.rw-toolbar')");
  // The panel head: Workspace › Project on the first line, the scene as the heading; the current entries are marked.
  assert.equal(await page.evaluate("document.querySelector('nav[aria-label=Location] .hy-scene .hy-label').textContent"), "Control room");
  assert.equal(await page.evaluate("document.querySelector('.hy-workspace summary').getAttribute('aria-label')"), "Workspace: My workspace");
  assert(await page.evaluate("[...document.querySelectorAll('.hy-sep')].every(s=>s.getAttribute('aria-hidden')==='true')"));
  await page.evaluate("document.querySelector('.hy-workspace summary').focus()");
  await key(page, "ArrowDown", 40);
  await wait(page, "document.querySelector('.hy-workspace').open && document.activeElement?.closest('.hy-workspace .hy-list')");
  assert.equal(await page.evaluate("document.activeElement.getAttribute('aria-current')"), "page");
  await key(page, "Escape", 27);
  await wait(page, "!document.querySelector('.hy-workspace').open && document.activeElement===document.querySelector('.hy-workspace summary')");
  await page.evaluate("document.querySelector('.hy-project summary').click()");
  await wait(page, "document.querySelector('.hy-project .hy-item[aria-current]') && [...document.querySelectorAll('.hy-project a')].some(a=>a.textContent==='Project details…')");
  await page.evaluate("document.querySelector('.hy-scene summary').click()");
  await wait(page, "!document.querySelector('.hy-project').open && document.querySelector('.hy-scene a.hy-item[aria-current]')");
  assert(!(await page.evaluate("document.body.innerText")).match(/Open a workspace|Room workspaces|Untitled room|Full room/));
  await page.evaluate("document.querySelector('.hy-scene summary').click()");
  // A link without a view opens in 3D; the floor plan is one click away.
  assert.equal(await page.evaluate("document.querySelector('.rv-stage').dataset.view"), "3d");
  await click(page, "2D plan");
  await wait(page, "document.querySelector('.rv-stage').dataset.view==='plan'");
  await page.call("Page.setDownloadBehavior", { behavior: "allow", downloadPath: temp });
  await page.evaluate(
    `Object.defineProperty(navigator.clipboard,'writeText',{value:async text=>{window.__copied=text;}})`,
  );
  assert(await page.evaluate(`document.querySelector('.rw-pop').hidden`));
  await click(page, "Settings");
  assert(await page.evaluate(`document.querySelector('.rw-pop').textContent.includes('Agent access')`));
  assert(await page.evaluate(`document.querySelector('.rw-pop').textContent.includes('Scene MCP endpoint') && document.querySelector('.rw-pop input[readonly]').value.endsWith('/api/scenes/${ws}/mcp')`));
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
  const api = site + "/api/scenes/" + ws + "/command";
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
  await click(page, "Return to whole scene");
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
  await click(page, "Return to whole scene");
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
    "!document.querySelector('.rv-stage')?.dataset.focusedAsset && document.querySelector('.rv-stage')?.dataset.view==='3d'",
  );
  assert((await command("undo", {})).ok);
  // "New scene" asks for a name only, prefilled with the next default, and opens the new, empty scene.
  await page.evaluate("document.querySelector('.hy-scene summary').click()");
  await wait(page, "[...document.querySelectorAll('.hy-scene .hy-action')].some(b=>b.textContent==='New scene')");
  await page.evaluate("[...document.querySelectorAll('.hy-scene .hy-action')].find(b=>b.textContent==='New scene').click()");
  // The project already holds one scene, so the next default is "Scene 2".
  await wait(page, "document.querySelector('dialog[open] input')?.value==='Scene 2'");
  await page.evaluate("document.querySelector('dialog[open] input').value='Option B';document.querySelector('dialog[open] form').requestSubmit()");
  await wait(page, `location.pathname!=='${path}' && document.querySelector('.hy-scene .hy-label')?.textContent==='Option B'`);
  const created = (await page.evaluate("location.pathname")).split("/").pop();
  const createdScene = (await (await fetch(site + "/api/scenes/" + created + "/state")).json()) as any;
  assert.equal(createdScene.instances.length, 0, "A scene made from the menu starts empty");

  // The homepage creates nothing on load. "Open demo" opens this browser's demo scene, reset to the furnished default
  // on every click; the demo is never prefilled or remembered. The breadcrumb starts at the last real scene, and Play opens it.
  const projectCount = async () => (((await (await fetch(site + "/api/projects")).json()) as any).projects as unknown[]).length;
  const home = await browser.page(site + "/");
  await wait(home, "document.querySelector('#home-demo')");
  await home.evaluate("localStorage.clear()");
  const known = (await workspaceList()).length, made = await projectCount();
  await home.call("Page.navigate", { url: site + "/workspaces" });
  await wait(home, "document.querySelector('.rm-start-button')?.textContent==='Open demo'");
  await home.call("Page.navigate", { url: site + "/" });
  await wait(home, "document.querySelector('.hy-home') && document.querySelector('#home-demo')");
  await Bun.sleep(300);
  assert.equal(await projectCount(), made, "Loading the homepage or /workspaces created something");
  assert(!(await home.evaluate("document.body.innerText")).match(/Open a workspace|Open viewer|Rooms|Projects\n/));
  assert(await home.evaluate("document.querySelector('.hy-play').hidden && document.querySelector('.hy-workspace .hy-label').textContent==='Workspaces'"));
  await home.evaluate("document.querySelector('#home-demo').click()");
  await wait(home, "/^\\/workspaces\\/[0-9a-f-]{36}$/.test(location.pathname) && document.querySelector('.rv-stage')?.dataset.view==='3d' && document.querySelector('.rv-orbit canvas')");
  await wait(home, "document.querySelector('.rm-notice span')?.textContent==='This demo resets each time you open it from the homepage. Your changes here are not kept.'");
  // The lighting view: the lamp button in the view controls dims the daylight so the scene's lighting shows, and back.
  const lampButton = "document.querySelector('.rw-lighting')";
  await wait(home, `${lampButton} && !${lampButton}.hidden`);
  await home.evaluate(`${lampButton}.click()`);
  await wait(home, `${lampButton}.getAttribute('aria-pressed')==='true' && document.querySelector('.rv-stage').classList.contains('rv-dim')`);
  await home.evaluate(`${lampButton}.click()`);
  await wait(home, `${lampButton}.getAttribute('aria-pressed')==='false' && !document.querySelector('.rv-stage').classList.contains('rv-dim')`);
  // Room envelope › Lighting › Ceiling lights: switching them off is a scene edit, and it turns this viewer's lighting view on.
  await home.evaluate("[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('Ceiling lights')).click()");
  await home.evaluate("[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('Ceiling lights')).parentElement.querySelector('.rm-check input').click()");
  await wait(home, `${lampButton}.getAttribute('aria-pressed')==='true'`);
  const demoScene = (await home.evaluate("location.pathname")).split("/").pop();
  for (let i = 0; i < 50 && (await (await fetch(site + "/api/scenes/" + demoScene + "/state")).json() as any).lighting?.ceiling.on !== false; i++) await Bun.sleep(100);
  assert.equal(((await (await fetch(site + "/api/scenes/" + demoScene + "/state")).json()) as any).lighting?.ceiling.on, false, "Switching the ceiling lights off reaches the scene");
  await home.evaluate(`${lampButton}.click()`);
  // A demo shows only "Demo ▾" above its scene; its workspace menu offers the visitor's own workspaces and "New workspace".
  assert.equal(await home.evaluate("[...document.querySelectorAll('.hy-editor .hy-label')].filter(e=>!e.closest('[hidden]')).map(e=>e.textContent).join(' › ')"), "Demo › Control room");
  await home.evaluate("document.querySelector('.hy-workspace summary').click()");
  await wait(home, "[...document.querySelectorAll('.hy-workspace .hy-item')].some(b=>b.textContent==='My workspace')");
  assert.equal(await home.evaluate("[...document.querySelectorAll('.hy-workspace .hy-action')].map(b=>b.textContent).join('|')"), "New workspace");
  await home.evaluate("document.querySelector('.hy-workspace summary').click()");
  assert.equal((await workspaceList()).length, known, "The demo appeared in the workspace list");
  const demoPath = await home.evaluate("location.pathname"), demoApi = site + demoPath.replace("/workspaces/", "/api/scenes/");
  const removed = (await (await fetch(demoApi + "/command", { method: "POST", headers: { "content-type": "application/json", "x-synergon": "1" },
    body: JSON.stringify({ id: "instances.remove", args: { instance: "display-a" } }) })).json()) as any;
  assert(removed.ok);
  await home.call("Page.navigate", { url: site + "/" });
  await wait(home, "document.querySelector('#home-demo')");
  await Bun.sleep(300);
  assert(await home.evaluate("document.querySelector('.hy-play').hidden"), "The demo was prefilled as the last scene");
  assert(!(await home.evaluate("(localStorage.getItem('synergon.roomRecents')||'')+(localStorage.getItem('synergon.workspaces')||'')")).includes(demoPath.split("/").pop()),
    "The demo was remembered as a recent scene");
  await home.evaluate("document.querySelector('#home-demo').click()");
  await wait(home, `location.pathname==='${demoPath}' && document.querySelector('.rw-toolbar')`);
  const reset = (await (await fetch(demoApi + "/state")).json()) as any;
  assert(reset.instances.some((i: any) => i.id === "display-a") && reset.version > removed.version, "Open demo did not reset the demo scene");
  assert.equal(await projectCount(), made + 1, "Open demo made more than one demo scene");
  // A real scene becomes the last scene: the breadcrumb starts there and Play opens it.
  await home.call("Page.navigate", { url: site + path });
  await wait(home, "document.querySelector('.rw-toolbar')");
  await home.call("Page.navigate", { url: site + "/" });
  await wait(home, "document.querySelector('.hy-scene .hy-label')?.textContent==='Control room' && document.querySelector('.hy-play')?.hidden===false");
  assert.equal(await home.evaluate("[...document.querySelectorAll('.hy-home .hy-label')].map(e=>e.textContent).join(' › ')"), "My workspace › Examples › Control room");
  assert.equal(await home.evaluate("document.querySelector('.hy-play').getAttribute('aria-label')"), "Open Control room");
  // The homepage menus offer "New …" but no "Rename …".
  await home.evaluate("document.querySelector('.hy-scene summary').click()");
  await wait(home, "document.querySelector('.hy-scene a.hy-item')");
  assert(!(await home.evaluate("document.querySelector('.hy-home').textContent")).includes("Rename"));
  await home.evaluate("document.querySelector('.hy-scene summary').click()");
  // Opening the demo again leaves the last real scene in place: the breadcrumb still starts at the person's own work.
  await home.evaluate("document.querySelector('#home-demo').click()");
  await wait(home, `location.pathname==='${demoPath}' && document.querySelector('.rw-toolbar')`);
  await home.call("Page.navigate", { url: site + "/" });
  await wait(home, "document.querySelector('.hy-scene .hy-label')?.textContent==='Control room' && document.querySelector('.hy-play')?.hidden===false");
  assert.equal(await home.evaluate("[...document.querySelectorAll('.hy-home .hy-label')].map(e=>e.textContent).join(' › ')"), "My workspace › Examples › Control room");
  await home.evaluate("document.querySelector('.hy-play').click()");
  await wait(home, `location.pathname==='${path}' && document.querySelector('.rw-toolbar')`);
  await home.call("Page.navigate", { url: site + "/workspaces" });
  await wait(home, `location.pathname==='${path}' && document.querySelector('.rw-toolbar')`);
  // The homepage cascade: choosing another workspace clears the scene; a single project is picked; choosing a scene opens it.
  await home.call("Page.navigate", { url: site + "/" });
  await wait(home, "document.querySelector('.hy-play')?.hidden===false");
  await home.evaluate("document.querySelector('.hy-workspace summary').click()");
  await wait(home, "[...document.querySelectorAll('.hy-workspace .hy-item')].some(b=>b.textContent==='My workspace')");
  assert(!(await home.evaluate("[...document.querySelectorAll('.hy-workspace .hy-item')].some(b=>b.textContent==='Demo')")));
  await home.evaluate("[...document.querySelectorAll('.hy-workspace .hy-item')].find(b=>b.textContent==='My workspace').click()");
  await wait(home, "!document.querySelector('.hy-scene').hidden && document.querySelector('.hy-project .hy-label').textContent==='Examples' && document.activeElement===document.querySelector('.hy-scene summary')");
  await home.evaluate("document.querySelector('.hy-scene summary').click()");
  await wait(home, "[...document.querySelectorAll('.hy-scene a.hy-item')].length===2");
  await home.evaluate("[...document.querySelectorAll('.hy-scene a.hy-item')].find(a=>a.textContent==='Option B').click()");
  await wait(home, `location.pathname==='/workspaces/${created}' && document.querySelector('.rw-toolbar')`);
  await home.call("Page.navigate", { url: site + "/workspaces/00000000-0000-4000-8000-00000000abcd" });
  await wait(home, "document.querySelector('h1')?.textContent==='This scene no longer exists.'");

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
  await projects.call("Page.navigate", { url: site + "/projects?scene=" + ws });
  await wait(projects, "document.querySelector('.pr-shell h1')?.textContent==='Examples' && document.querySelector('.pr-shell').textContent.includes('In My workspace')");
  assert(await projects.evaluate(`[...document.querySelectorAll('.pr-shell a')].some(a=>a.getAttribute('href')==='/workspaces/${ws}')`));
  console.log(
    "Passed the Workspace › Project › Scene selector (keyboard, marks, new scene), Open demo (no creation on load, the same demo scene reset on each click, never prefilled), the prefilled breadcrumb and Play, a missing scene, project creation and version save, asset isolation and sharing, room camera restoration, focused asset removal, operator POV, PNG export, reset/undo, trace and settings.",
  );
} finally {
  await browser.close();
  service.close();
  rmSync(temp, { recursive: true, force: true });
}
