// bun tools/room-component-controls-check.ts — hit-test the actual floor plan and edit its component inspectors.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoomScene } from "../shared/room.ts";
import { Browser, type Page } from "./render.ts";
import { serveRoom } from "./room-serve.ts";

type Point = { x: number; y: number };
const inspector = ".rm-scroll .rm-component-card";
const element = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

async function pointer(page: Page, type: string, at: Point, count = 1) {
  await page.call("Input.dispatchMouseEvent", {
    type,
    ...at,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: count,
  });
}

async function click(page: Page, at: Point, count = 1) {
  await pointer(page, "mousePressed", at, count);
  await pointer(page, "mouseReleased", at, count);
}

async function clickControl(page: Page, selector: string, count = 1) {
  const point = await page
    .waitFor(
      `(() => {
    const e = ${element(selector)}; if (!e) return;
    e.scrollIntoView({block:"nearest"});
    const r=e.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
    if(e.contains(document.elementFromPoint(x,y))) return {x,y};
  })()`,
      "clickable " + selector,
      5000,
    )
    .catch(async (err) => {
      const details = await page.evaluate(`(()=>{const el=${element(selector)};const r=el?.getBoundingClientRect();
      return {element:el?.outerHTML,rect:r?.toJSON(),top:r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,160),menu:document.querySelector('.rm-scope-selector')?.open}})()`);
      throw new Error(String(err) + " " + JSON.stringify(details));
    });
  await click(page, point, count);
}

async function pick(page: Page, station: string, part: string) {
  const selector = `[data-instance="${station}"] [data-member="${part}"]`;
  // The middle of a projected part's bounding box can be empty or occluded by another part.
  const point = await page.evaluate(`(() => {
    for(const e of document.querySelectorAll(${JSON.stringify(selector)})) {
      const r=e.getBoundingClientRect();
      for(let y=Math.ceil(r.top); y<r.bottom; y++) for(let x=Math.ceil(r.left); x<r.right; x++)
        if(e.contains(document.elementFromPoint(x,y))) return {x,y};
    }
  })()`);
  assert(point, `No exposed point on ${station}/${part}`);
  await click(page, point);
  await page.waitFor(
    element(inspector + `[data-instance="${station}"][data-component="${part}"]`),
    `opening ${station}/${part}`,
  );
}

async function pressKey(page: Page, key: string, code: number) {
  await page.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: key,
    windowsVirtualKeyCode: code,
  });
  await page.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: key,
    windowsVirtualKeyCode: code,
  });
}

async function exact(page: Page, joint: string, value: string) {
  const selector = inspector + ` input[type=number][data-joint="${joint}"]`;
  await clickControl(page, selector);
  await page.call("Input.insertText", { text: value });
  await pressKey(page, "Enter", 13);
}

const pad = inspector + " .rm-direction-pad";
async function openPad(page:Page) {
  if(!await page.evaluate(element(pad)+".closest('details').open"))
    await clickControl(page,inspector+" details:has(.rm-direction-pad) > summary");
}
async function thumbDragPoints(page: Page, x: number, y: number) {
  await openPad(page);
  return page.evaluate(`(() => {
    const e=${element(pad)}, thumb=e.firstElementChild;
    e.scrollIntoView({block:"nearest"});
    const r=e.getBoundingClientRect(), t=thumb.getBoundingClientRect();
    return [{x:t.left+t.width/2,y:t.top+t.height/2},{x:r.left+${x}*r.width,y:r.top+${y}*r.height}];
  })()`);
}
async function dragThumb(page: Page) {
  const points = await thumbDragPoints(page, 0.78, 0.27);
  await pointer(page, "mousePressed", points[0]);
  await pointer(page, "mouseMoved", points[1]);
  await pointer(page, "mouseReleased", points[1]);
}

async function thumbPosition(page: Page): Promise<number[]> {
  await openPad(page);
  return page.evaluate(`(() => {
    const e=${element(pad)}, r=e.getBoundingClientRect(), t=e.firstElementChild.getBoundingClientRect();
    return [(t.left+t.width/2-r.left)/r.width,(t.top+t.height/2-r.top)/r.height];
  })()`);
}

type ReadScene = () => Promise<RoomScene>;
const poseSlider = ' input[type=range][data-joint="J_seat_slide"]';
const frames = (page: Page) =>
  page.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");

async function sliderPoints(page: Page, slider: string) {
  return page.evaluate(`(() => {
    const e=${slider}; e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect();
    const fraction=(e.valueAsNumber-Number(e.min))/(Number(e.max)-Number(e.min));
    const px=f=>({x:r.left+8+(r.width-16)*f,y:r.top+r.height/2});
    return {start:px(fraction),left:px(.15),right:px(.85),original:e.value};
  })()`);
}

async function heldSeatSlider(
  page: Page,
  read: ReadScene,
  card: string,
  geometry: string,
  end: "commit" | "cancel" | "refuse",
) {
  const selector = card + poseSlider,
    before = await read();
  const slider = element(selector);
  await frames(page);
  const image = await page.evaluate(geometry);
  assert(image, "A visible station geometry measurement is required");
  const at = await sliderPoints(page, slider);
  await pointer(page, "mousePressed", at.start);
  await pointer(page, "mouseMoved", at.left);
  await frames(page);
  const left = await page.evaluate(geometry);
  assert(left !== image, "Holding a slider at its first position did not move the rendered seat");
  await pointer(page, "mouseMoved", at.right);
  await frames(page);
  const right = await page.evaluate(geometry);
  assert(right !== left, "The rendered seat did not follow a second motion before pointerup");
  assert.deepEqual(await read(), before, "A held slider changed shared state before release");
  if (end === "cancel") {
    await page.evaluate(`${slider}.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:1}))`);
  } else if (end === "refuse") {
    await page.evaluate(`(() => {
      const native=window.fetch;
      window.fetch=(url,options)=>{
        if(typeof options?.body==="string" && ["pose.set","pose.apply"].includes(JSON.parse(options.body).id)){
          window.fetch=native;
          return Promise.resolve(new Response(JSON.stringify({error:{message:"Rejected test edit"}}),{status:409,headers:{"content-type":"application/json"}}));
        }
        return native(url,options);
      };
    })()`);
  }
  await pointer(page, "mouseReleased", at.right);
  if (end === "commit") {
    await page.waitFor(
      element(".rm-version") + `.textContent==="Revision ${before.version + 1}"`,
      "the one committed slider edit",
    );
    const after = await read();
    assert.equal(after.version, before.version + 1);
    assert.deepEqual(
      after.instances.filter((i) => i.id !== "station-b"),
      before.instances.filter((i) => i.id !== "station-b"),
    );
    assert.notEqual(
      after.instances.find((i) => i.id === "station-b")!.pose.J_seat_slide,
      before.instances.find((i) => i.id === "station-b")!.pose.J_seat_slide,
    );
    await clickControl(page, '[title="Undo latest change"]');
    await page.waitFor(
      element(".rm-version") + `.textContent==="Revision ${before.version + 2}"`,
      "undoing one slider edit",
    );
    assert.deepEqual((await read()).instances, before.instances);
  } else {
    if (end === "refuse")
      await page.waitFor(
        "document.querySelector('.rm-notice')?.textContent.includes('Rejected test edit')",
        "rejected pose",
      );
    assert.deepEqual(await read(), before, "Aborted slider edit wrote a revision");
  }
  await frames(page);
  assert(
    (await page.evaluate(geometry)) === image,
    "The rendered seat failed to return to the authoritative pose",
  );
  assert.equal(await page.evaluate(slider + ".value"), at.original, "The slider lost its authoritative position");
}

async function simultaneousEdits(page: Page, read: ReadScene, endpoint: string, geometry: string) {
  const card = ".rm-floating-card",
    slider = element(card + poseSlider);
  const revision = (n: number) =>
    page.waitFor(element(".rm-version") + `.textContent==="Revision ${n}"`, "revision " + n);
  for (const conflict of [false, true]) {
    const before = await read(),
      at = await sliderPoints(page, slider);
    await pointer(page, "mousePressed", at.start);
    await pointer(page, "mouseMoved", at.right);
    await frames(page);
    const preview = await page.evaluate(geometry),
      held = await page.evaluate(slider + ".valueAsNumber / 1000");
    const remote = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Synergon": "1" },
      body: JSON.stringify({
        id: "pose.set",
        expectedVersion: before.version,
        args: {
          instance: conflict ? "station-b" : "station-a",
          member: "J_seat_slide",
          value: 0.031,
          allowAssumed: true,
        },
      }),
    });
    assert((await remote.json()).ok);
    let v = before.version + 1;
    await revision(v);
    await frames(page);
    if (conflict) {
      assert.equal(
        await page.evaluate(slider + ".valueAsNumber"),
        31,
        "The server's newer value did not replace the stale local input",
      );
      assert(preview !== (await page.evaluate(geometry)), "The conflict left stale geometry on-screen");
    } else {
      assert.equal(
        await page.evaluate(slider + ".valueAsNumber / 1000"),
        held,
        "An unrelated edit reset the held slider",
      );
      assert(preview === (await page.evaluate(geometry)), "An unrelated edit discarded the local preview");
    }
    await pointer(page, "mouseReleased", at.right);
    if (!conflict) {
      await revision(++v);
      const scene = await read();
      assert.equal(scene.instances.find((i) => i.id === "station-a")!.pose.J_seat_slide, 0.031);
      assert.equal(scene.instances.find((i) => i.id === "station-b")!.pose.J_seat_slide, held);
      await clickControl(page, '[title="Undo latest change"]');
      await revision(++v);
    } else assert.equal((await read()).version, v, "Releasing an obsolete slider overwrote the remote edit");
    await clickControl(page, '[title="Undo latest change"]');
    await revision(++v);
    assert.deepEqual((await read()).instances, before.instances);
  }
}

// Snapshot only the actual WebGL canvas. Inspector widgets and rendered labels live outside this image.
const canvasStamp = (center: Point, size: number) => `(() => {
  const canvas=document.querySelector(".rv-orbit canvas"), b=canvas.getBoundingClientRect();
  const crop=document.createElement("canvas");crop.width=crop.height=${Math.ceil(size)};
  crop.getContext("2d").drawImage(canvas,(${center.x - size / 2}-b.left)*canvas.width/b.width,(${center.y - size / 2}-b.top)*canvas.height/b.height,
    ${size}*canvas.width/b.width,${size}*canvas.height/b.height,0,0,crop.width,crop.height);
  return crop.toDataURL();
})()`;

async function labelSetting(page: Page, previous: boolean, enable: boolean) {
  await clickControl(page, '[aria-label="Settings"]');
  const locator = `[...document.querySelectorAll('.rw-check')].find(e=>e.textContent==='Object labels')?.querySelector('input')`;
  assert.equal(await page.evaluate(locator + ".checked"), previous);
  if (previous !== enable) {
    const at = await page.evaluate(
      `(() => {const r=(${locator}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,
    );
    await click(page, at);
  }
  await clickControl(page, '[aria-label="Close settings"]');
  assert.equal(
    await page.evaluate("document.querySelector('.rv-stage').classList.contains('rv-no-labels')"),
    !enable,
  );
}

async function copyCamera(page: Page) {
  await page.evaluate(
    `Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>window.__viewLink=text}); window.__viewLink=null`,
  );
  await clickControl(page, '[aria-label="Copy view link"]');
  const url = await page.waitFor("window.__viewLink", "the shareable camera");
  return JSON.parse(new URLSearchParams(new URL(url).hash.slice(1)).get("view")!);
}

async function checkScope(page: Page, browser: Browser, base: string, path: string, read: ReadScene) {
  const before = await read();
  const camera = await copyCamera(page);
  const scope = element(".rv-stage") + ".dataset.focusedAsset",
    back = '[aria-label="Return to full room"]';
  const isolated = async (p: Page) => {
    await p.waitFor(
      scope +
        "==='station-b' && document.querySelectorAll('.rv-orbit-tag').length===1 && document.querySelector('.rv-orbit-tag').dataset.instance==='station-b'",
      "isolated Station B",
      60000,
    );
    await frames(p);
  };
  await clickControl(page, inspector + ' [aria-label="Focus on Station B"]');
  await isolated(page);
  const focused = await copyCamera(page);
  assert.equal(focused.focused, "station-b", "The shared focused view must identify its instance");
  assert(
    await page.evaluate("!document.querySelector('.rv-stage').classList.contains('rv-no-labels')"),
    "Isolating an asset disabled labels",
  );
  const corners = await page.evaluate(`(() => {
    const c=document.querySelector('.rv-orbit canvas'), copy=document.createElement('canvas');
    copy.width=64;copy.height=64; const ctx=copy.getContext('2d');ctx.drawImage(c,0,0,64,64);
    const rgb=(x,y)=>[...ctx.getImageData(x,y,1,1).data].join(',');
    const bg=rgb(0,0);let occupied=0,clearBorder=0;
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      if(rgb(x,y)!==bg) occupied++;
      else if(x===0||x===63||y===0||y===63)clearBorder++;
    }
    return {occupied,clearBorder};
  })()`);
  assert(
    corners.occupied > 40 && corners.clearBorder > 230,
    "The isolated model must be visible against a clear background: " + JSON.stringify(corners),
  );

  // A shared focused camera can also be zoomed out. Probe the positions occupied by the other
  // station and the room floor at the original full-room projection.
  const overview = { ...camera, focused: "station-b" };
  const wide = await browser.page(base + path + "#" + new URLSearchParams({ view: JSON.stringify(overview) }));
  await wide.viewport(1440, 900);
  await isolated(wide);
  const visible = await copyCamera(wide);
  assert.equal(visible.orbit.zoom, camera.orbit.zoom);
  const other = before.instances.find((i) => i.id === "station-a")!,
    station = before.instances.find((i) => i.id === "station-b")!;
  const probe = await wide.evaluate(`(() => {
    const c=document.querySelector('.rv-orbit canvas'), work=document.createElement('canvas');
    work.width=c.width;work.height=c.height;const ctx=work.getContext('2d');ctx.drawImage(c,0,0);
    const b=c.getBoundingClientRect(), scale=b.height/(2*Math.max(${camera.orbit.halfHeight},${camera.orbit.halfWidth}/(b.width/b.height))*1.12)*${camera.orbit.zoom};
    const point=(x,y)=>({x:b.width/2+(x-${camera.orbit.target[0]})*scale,y:b.height/2+(-y-(${camera.orbit.target[2]}))*scale});
    const bg=Array.from(ctx.getImageData(0,0,1,1).data);
    const occupied=(at,r)=>{const size=Math.ceil(2*r);const pixels=ctx.getImageData((at.x-r)*c.width/b.width,(at.y-r)*c.height/b.height,size,size).data;
      let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==bg[0]||pixels[i+1]!==bg[1]||pixels[i+2]!==bg[2])count++;return count;};
    const other=point(${other.x},${other.y}), selected=point(${station.x},${station.y});
    return {other:occupied(other,.72*scale), selected:occupied(selected,.72*scale), floor:occupied(point(1.8,1.2),.2*scale), outside:{x:b.left+other.x,y:b.top+other.y}};
  })()`);
  assert.equal(probe.other, 0, "Station A remains visible in the isolated canvas");
  assert.equal(probe.floor, 0, "The room envelope remains visible in the isolated canvas");
  assert(probe.selected > 50, "The focused station is missing from the canvas");
  await click(wide, probe.outside);
  assert(
    !(await wide.evaluate("document.querySelector('.rm-component-card[data-instance=station-a]')")),
    "An invisible station accepted a pick",
  );
  await wide.close();

  // A separate browser tab opens the full floor plan. Its collapsed navigation must be usable on a phone.
  const mobile = await browser.page(base + path);
  await mobile.viewport(390, 844);
  await mobile.waitFor(
    element('.rm-panel-closed .rv-plan [data-instance="station-a"] .rv-part'),
    "the full room on a phone",
  );
  assert(!(await mobile.evaluate(scope)), "Focus leaked to another viewer");
  assert(
    await mobile.evaluate("document.querySelector('.rv-stage').classList.contains('rv-no-labels')"),
    "Label settings leaked to a second viewer",
  );
  await clickControl(mobile, '[aria-label="View scope"]');
  await clickControl(mobile, '.rm-scope-menu [aria-label="Focus on Station B"]');
  await isolated(mobile);
  assert(await mobile.evaluate("document.querySelector('.rm-shell').classList.contains('rm-panel-closed')"));
  await clickControl(mobile, back);
  await mobile.waitFor(
    element('.rv-stage[data-view="plan"]:not([data-focused-asset]) [data-instance="station-a"] .rv-part'),
    "the restored mobile floor plan",
  );
  await mobile.close();

  assert.equal(await page.evaluate(scope), "station-b", "Another viewer left this viewer’s asset");
  await clickControl(page, back);
  await page.waitFor(
    "!" + scope + " && document.querySelectorAll('.rv-orbit-tag').length===4",
    "the restored 3D room",
  );
  const restored = await copyCamera(page);
  assert.equal(restored.mode, camera.mode);
  assert.equal(restored.selected, camera.selected);
  assert.equal(restored.member, camera.member);
  for (const axis of ["position", "target"])
    camera.orbit[axis].forEach((n: number, i: number) => {
      assert(Math.abs(restored.orbit[axis][i] - n) < 1e-6, "Room camera " + axis + " failed to restore");
    });
  for (const key of ["zoom", "halfWidth", "halfHeight"])
    assert(Math.abs(restored.orbit[key] - camera.orbit[key]) < 1e-6);
  await labelSetting(page, true, false);
  assert.deepEqual(await read(), before, "Inspecting an individual asset altered the shared workspace");
}

// Place a browser camera above the demo so world X/Y project directly onto the canvas.
// Two station labels give the projection scale at the actual viewport dimensions.
async function checkOrbitPicks(browser: Browser, base: string, path: string, scene: RoomScene) {
  const target = [scene.room.width / 2, 0, -scene.room.depth / 2];
  const view = {
    mode: "3d",
    selected: null,
    member: null,
    orbit: {
      target,
      position: [target[0], 15, target[2] + 0.0001],
      zoom: 1,
      halfWidth: scene.room.width / 2,
      halfHeight: scene.room.depth / 2,
    },
  };
  const page = await browser.page(base + path + "#" + new URLSearchParams({ view: JSON.stringify(view) }));
  await page.viewport(1440, 900);
  await page.waitFor(
    element('.rv-stage[data-seated-host="station-a"] .rv-orbit-tag[data-instance="station-b"]'),
    "seating the operator in the 3D view",
    60000,
  );
  await labelSetting(page, false, true);
  const screen = (await page.evaluate(`(() => {
    const host=document.querySelector('.rv-orbit-tags').getBoundingClientRect();
    const anchors=Object.fromEntries([...document.querySelectorAll('.rv-orbit-tag')].map(tag=>[
      tag.dataset.instance, {x:host.left+parseFloat(tag.style.left), y:host.top+parseFloat(tag.style.top)}
    ]));
    return anchors;
  })()`)) as Record<string, Point>;
  const a = scene.instances.find((i) => i.id === "station-a")!,
    b = scene.instances.find((i) => i.id === "station-b")!;
  const scale = (screen[b.id].x - screen[a.id].x) / (b.x - a.x);
  assert(scale > 10 && Math.abs(screen[b.id].y - screen[a.id].y) < 1, "Expected a top camera");
  async function pickDatum(station: typeof a, datum: string, part: string) {
    const isEye = datum === "eye",
      ref = { instance: station.id, member: isEye ? "floor" : datum };
    const response = await fetch(base + "/api" + path + "/command", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Synergon": "1" },
      body: JSON.stringify({
        id: isEye ? "person.measure" : "measure.distance",
        args: isEye ? { to: ref } : { from: ref, to: ref },
      }),
    });
    const receipt = await response.json();
    assert(receipt.ok, JSON.stringify(receipt));
    const [x, y] = receipt.result.from.point;
    const point = {
      x: screen[station.id].x + (x - station.x) * scale,
      y: screen[station.id].y - (y - station.y) * scale,
    };
    // The monitor face is close to edge-on in this view. Rasterization can round its projected center
    // to the neighboring housing, so also try the adjacent pixels on the visible screen.
    const offsets =
      datum === "S_mon_screen"
        ? [
            [0, 0],
            [0, -1],
            [0, 1],
            [1, 0],
            [-1, 0],
            [0, 2],
            [0, -2],
          ]
        : [[0, 0]];
    let hit = "";
    for (const [dx, dy] of offsets) {
      await click(page, { x: point.x + dx, y: point.y + dy });
      hit = await page.evaluate(element(inspector) + "?.dataset.component");
      if (hit === part) break;
    }
    assert.equal(hit, part, `Orbit pick of ${station.id}/${datum} got ${hit}`);
    assert.equal(await page.evaluate(element(inspector) + ".dataset.instance"), station.id);
    return point;
  }
  const read = async (): Promise<RoomScene> => (await fetch(base + "/api" + path + "/state")).json();
  const seat = await pickDatum(b, "C_seat_pan", "C_seat_pan");
  const seatPixels = canvasStamp(seat, Math.ceil(scale * 0.9));
  await heldSeatSlider(page, read, inspector, seatPixels, "commit");
  await heldSeatSlider(page, read, inspector, seatPixels, "refuse");
  const grip = await pickDatum(b, "D_grip_axis_R", "C_joy_lever_R");
  const before = await read(),
    destination = { x: grip.x - 12, y: grip.y + 9 };
  await frames(page);
  const gripPixels = canvasStamp(grip, Math.ceil(scale * 0.45)),
    neutral = await page.evaluate(gripPixels);
  const [thumb, edge] = await thumbDragPoints(page, 0.14, 0.83);
  await pointer(page, "mousePressed", thumb);
  await pointer(page, "mouseMoved", edge);
  await frames(page);
  assert((await page.evaluate(gripPixels)) !== neutral, "The held 2D pad did not move the 3D joystick");
  assert.deepEqual(await read(), before);
  await pressKey(page, "Escape", 27);
  await pointer(page, "mouseReleased", edge);
  await frames(page);
  assert((await page.evaluate(gripPixels)) === neutral, "Cancelling the pad left the 3D joystick displaced");
  assert.deepEqual(await read(), before);
  await pointer(page, "mousePressed", grip);
  await pointer(page, "mouseMoved", destination);
  assert.equal((await read()).version, before.version, "A drag preview wrote a shared revision");
  await pointer(page, "mouseReleased", destination);
  const waitRevision = (v: number) =>
    page.waitFor(element(".rm-version") + `.textContent==="Revision ${v}"`, "3D drag revision " + v);
  await waitRevision(before.version + 1);
  const after = await read();
  assert.deepEqual(
    after.instances.filter((i) => i.id !== b.id),
    before.instances.filter((i) => i.id !== b.id),
  );
  const prior = before.instances.find((i) => i.id === b.id)!.pose,
    changed = after.instances.find((i) => i.id === b.id)!.pose;
  assert(
    Object.keys(changed).some((key) => key.startsWith("J_joy_R_") && changed[key] !== prior[key]),
    "Dragging the selected 3D lever did not move its own joint",
  );
  await clickControl(page, '[title="Undo latest change"]');
  await waitRevision(before.version + 2);
  assert.deepEqual((await read()).instances, before.instances, "3D drag was not one reversible edit");
  await pointer(page, "mousePressed", grip);
  await pointer(page, "mouseMoved", destination);
  await page.evaluate(
    "document.querySelector('.rv-orbit canvas').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))",
  );
  await pointer(page, "mouseReleased", destination);
  assert.equal((await read()).version, before.version + 2, "A cancelled joint drag committed");
  await pickDatum(b, "S_mon_screen", "S_mon_screen");
  assert(await page.evaluate(element(pad)), "The 3D monitor face must open its directional pad");
  await checkScope(page, browser, base, path, read);
  await labelSetting(page, false, true);
  const eyePoint=await pickDatum(a, "eye", "@operator");
  const heightSlider=element(inspector+" input[name=stature]") + "?.closest('.rm-adjust-row').querySelector('input[type=range]')";
  await page.waitFor(heightSlider,"rendered stature control");
  const heightPoints = await sliderPoints(page,heightSlider);
  const bodyPixels = canvasStamp(eyePoint,Math.ceil(scale*.8));
  // Picking the operator schedules a new selection frame. Compare finished renders.
  await frames(page);
  const bodyBefore = await page.evaluate(bodyPixels);
  await pointer(page,"mousePressed",heightPoints.start);
  await pointer(page,"mouseMoved",heightPoints.left);
  const settled = "document.querySelector('.rv-status').hidden";
  await page.waitFor(settled+" && "+bodyPixels+"!=="+JSON.stringify(bodyBefore),"held stature slider to resize the avatar");
  assert.equal((await read()).version,before.version+2,"A body preview should be local");
  await pressKey(page,"Escape",27);
  await pointer(page,"mouseReleased",heightPoints.left);
  await page.waitFor(settled+" && "+bodyPixels+"==="+JSON.stringify(bodyBefore),"Escape to restore the operator");
  assert.equal(await page.evaluate(heightSlider+".value"),heightPoints.original);
  assert.equal((await read()).version,before.version+2,"Cancelling a body preview should leave the saved operator intact");
  // Also cancel during the async rebind, after the old avatar was hidden.
  await page.evaluate(`(() => {
    const status=document.querySelector('.rv-status');
    const observer=new MutationObserver(()=>{
      if(status.hidden)return;
      observer.disconnect();
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true,bubbles:true}));
      status.dataset.cancelTest='interrupted';
    });
    observer.observe(status,{attributes:true,attributeFilter:['hidden']});
  })()`);
  await pointer(page,"mousePressed",heightPoints.start);
  await pointer(page,"mouseMoved",heightPoints.left);
  await page.waitFor("document.querySelector('.rv-status').dataset.cancelTest==='interrupted'","Escape during avatar rebind");
  await pointer(page,"mouseReleased",heightPoints.left);
  await frames(page);
  await page.waitFor(settled+" && "+bodyPixels+"==="+JSON.stringify(bodyBefore),"restore visible operator after interrupted rebind");
  assert.equal((await read()).version,before.version+2);
  const cameraAnchor = element('.rv-orbit-tag[data-instance="station-b"]') + ".style.left";
  const oldAnchor = await page.evaluate(cameraAnchor);
  const background = await page.evaluate(
    "(()=>{const r=document.querySelector('.rv-orbit canvas').getBoundingClientRect();return {x:r.right-40,y:r.top+40}})()",
  );
  await pointer(page, "mousePressed", background);
  await pointer(page, "mouseMoved", { x: background.x - 75, y: background.y + 30 });
  await pointer(page, "mouseReleased", { x: background.x - 75, y: background.y + 30 });
  await page.waitFor(cameraAnchor + "!==" + JSON.stringify(oldAnchor), "background drag to orbit");
  assert.equal((await read()).version, before.version + 2, "Orbit wrote a scene revision");
  await page.close();
}

const temp = mkdtempSync(join(tmpdir(), "synergon-component-check-"));
let service: Awaited<ReturnType<typeof serveRoom>> | undefined, browser: Browser | undefined;
try {
  service = await serveRoom({ port: 0, dataDir: temp });
  const base = service.url.origin,
    port = Number(service.url.port);
  const { workspaces } = (await (await fetch(base + "/api/workspaces")).json()) as {
    workspaces: { id: string; name: string }[];
  };
  const id = workspaces.find((w) => w.name === "Control room")!.id,
    path = "/workspaces/" + id;
  const state = async (): Promise<RoomScene> => (await fetch(base + "/api" + path + "/state")).json();
  browser = await Browser.launch();
  const page = await browser.page(base + path);
  await page.viewport(1440, 900);
  const ready = () => page.waitFor(element('[data-instance="station-b"] .rv-part'), "the station geometry");
  await ready();
  let snapshot = await state();
  const initialA = snapshot.instances.find((i) => i.id === "station-a")!;
  const stationB = () => snapshot.instances.find((i) => i.id === "station-b")!;
  async function nextRevision() {
    const next = snapshot.version + 1;
    await page.waitFor(
      `document.querySelector('.rm-version')?.textContent === 'Revision ${next}'`,
      "revision " + next,
    );
    snapshot = await state();
    assert.equal(snapshot.version, next);
    assert.deepEqual(
      snapshot.instances.find((i) => i.id === "station-a"),
      initialA,
      "An edit to Station B changed Station A",
    );
  }
  await pick(page, "station-b", "C_seat_pan");
  const planSeat = element('[data-instance="station-b"] path[data-member="C_seat_pan"]') + '.getAttribute("d")';
  await clickControl(page, inspector + ' [title="Pop out component controls"]');
  await heldSeatSlider(page, state, ".rm-floating-card", planSeat, "cancel");
  await simultaneousEdits(page, state, base + "/api" + path + "/command", planSeat);
  snapshot = await state();
  await clickControl(page, '.rm-floating-card [title="Dock component controls"]');
  await exact(page, "J_seat_slide", "18");
  await nextRevision();
  assert.equal(stationB().pose.J_seat_slide, 0.018);

  await pick(page, "station-a", "@operator");
  const stature = inspector + " input[name=stature]";
  await page.waitFor(element(stature), "the body editor");
  const original = Number(await page.evaluate(element(stature) + ".value"));
  const step = Number(await page.evaluate(element(stature) + ".max")) - original > 1 ? 1 : -1;
  await clickControl(page, stature);
  await page.call("Input.insertText", { text: String(original + step) });
  await pressKey(page, "Tab", 9);
  await nextRevision();
  assert.equal(snapshot.person?.state.body.stature, original + step);

  await pick(page, "station-b", "C_joy_lever_R");
  await dragThumb(page);
  await nextRevision();
  const joystick = stationB().pose;
  assert(
    Number(joystick.J_joy_R_roll) > 0 && Number(joystick.J_joy_R_pitch) > 0,
    "Dragging the joystick must set both axes",
  );
  const [x, y] = await thumbPosition(page);
  assert(Math.abs(x - 0.78) < 0.03 && Math.abs(y - 0.27) < 0.03, "Joystick thumb did not track the pointer");

  await page.evaluate(element(pad) + ".focus()");
  await pressKey(page, "ArrowLeft", 37);
  await nextRevision();
  assert.equal(
    await page.evaluate("document.activeElement === " + element(pad)),
    true,
    "The pad lost keyboard focus after its first revision",
  );
  const keyedRoll = Number(stationB().pose.J_joy_R_roll);
  assert(keyedRoll < Number(joystick.J_joy_R_roll));
  await pressKey(page, "ArrowUp", 38);
  await nextRevision();
  assert.equal(stationB().pose.J_joy_R_roll, keyedRoll);
  assert(Number(stationB().pose.J_joy_R_pitch) > Number(joystick.J_joy_R_pitch));

  await pick(page, "station-b", "C_stand_monitor");
  await dragThumb(page);
  await nextRevision();
  const { J_mon_pan: pan, J_mon_tilt: tilt } = stationB().pose;
  assert(Number.isFinite(pan) && Number.isFinite(tilt), "Dragging the monitor must set both axes");
  await exact(page, "J_mon_pan", "-5");
  await nextRevision();
  assert(Math.abs(Number(stationB().pose.J_mon_pan) + (5 * Math.PI) / 180) < 1e-8);
  assert.equal(stationB().pose.J_mon_tilt, tilt);
  const [panX, panY] = await thumbPosition(page);
  assert(
    panX < 0.5 && Math.abs(panY - 0.27) < 0.03,
    "Precise pan edit must move only the horizontal thumb position",
  );
  assert(
    await page.evaluate(element(inspector + " details") + ".open"),
    "The direction pad closed after editing pan",
  );
  assert.equal(
    await page.evaluate(
      "document.activeElement === " + element(inspector + " input[type=number][data-joint=J_mon_pan]"),
    ),
    true,
    "The pan input lost keyboard focus after committing its precise value",
  );
  await exact(page, "J_mon_tilt", "8");
  await nextRevision();
  assert(Math.abs(Number(stationB().pose.J_mon_tilt) - (8 * Math.PI) / 180) < 1e-8);
  assert(Math.abs(Number(stationB().pose.J_mon_pan) + (5 * Math.PI) / 180) < 1e-8);
  const [preciseX, preciseY] = await thumbPosition(page);
  assert(
    Math.abs(preciseX - panX) < 0.01 && Math.abs(preciseY - panY) > 0.01,
    "Precise tilt edit must move only the vertical thumb position",
  );

  // Verify that the workspace tools remain clickable when a component occupies the sidebar.
  await clickControl(page, '.rm-panel-tools [aria-label="Settings"]');
  await page.waitFor(element('.rw-pop[aria-label="Settings"]:not([hidden])'), "the settings panel");
  await clickControl(page, '[aria-label="Close settings"]');
  await clickControl(page, '.rm-panel-tools [aria-label="Trace"]');
  await page.waitFor(element('.rw-pop[aria-label="Activity"]:not([hidden])'), "the activity panel");
  await clickControl(page, '[aria-label="Close activity"]');
  await clickControl(page, '[title="Collapse panel"]');
  await clickControl(page, '[title="Open workspace panel"]');
  assert(await page.evaluate(element(inspector) + ".dataset.component === 'C_stand_monitor'"));

  const saved = snapshot;
  service.close();
  service = await serveRoom({ port, dataDir: temp });
  await page.call("Page.reload", { ignoreCache: true });
  await ready();
  assert.deepEqual(await state(), saved, "Room edits changed after service restart");
  await pick(page, "station-b", "C_seat_pan");
  assert.equal(
    await page.evaluate(element(inspector + " input[type=number][data-joint=J_seat_slide]") + ".value"),
    "18",
  );
  await pick(page, "station-b", "C_stand_monitor");
  const restored = await thumbPosition(page);
  assert(
    Math.abs(restored[0] - preciseX) < 0.01 && Math.abs(restored[1] - preciseY) < 0.01,
    "The monitor thumb lost its saved position",
  );
  await pick(page, "station-a", "@operator");
  await page.waitFor(element(stature), "the reloaded operator measurements");
  assert.equal(Number(await page.evaluate(element(stature) + ".value")), original + step);
  await checkOrbitPicks(browser, base, path, saved);
  console.log(
    "Passed floor-plan and 3D picking, held slider and pad previews, cancellation and concurrent edits, desktop and phone asset isolation, camera restoration, label settings, footer access and service-restart persistence.",
  );
} finally {
  await browser?.close();
  service?.close();
  rmSync(temp, { recursive: true, force: true });
}
