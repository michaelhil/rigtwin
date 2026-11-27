// Helpers for driving viewer pages of the shared scene in headless Chromium with real pointer input, used by
// tools/live-accept.ts (a local server).
import { join } from "node:path";
import { ROOT } from "./timeline.ts";
import type { Page } from "./render.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const DEG = Math.PI / 180;
export async function until<T>(page: Page, expr: string, ms = 4000): Promise<T | null> {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(40)) { const v = await page.evaluate(expr).catch(() => null); if (v) return v as T; }
  return null;
}
export const joint = (p: Page, id: string) => p.evaluate(`viewer.state().joints.${id}`) as Promise<number>;
export const live = (p: Page) => p.evaluate("viewer.live()") as Promise<{ code: string; version: number; preview: boolean; unsaved: string[]; activity: string | null; resyncs: number; connected: boolean; attempt: number } | null>;
/** The real command line, as Claude Code runs it (in its own process: the server answers it from this one). */
export async function rig(origin: string, ...args: string[]) {
  // env given explicitly: Bun.spawn does not pass on a variable set in process.env after the start (RIG_WORKSPACE is set
  // that way by the checks, and a remote server has no default workspace)
  const p = Bun.spawn(["bun", join(ROOT, "tools", "rig.ts"), ...args, "--server", origin], { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const out = await new Response(p.stdout).text(); await p.exited;
  return JSON.parse(out);
}
export const mouse = (p: Page, type: string, x: number, y: number, buttons: number) => p.call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
/** The Height slider of the selected monitor: page coordinates of a slider value (millimetres). */
export async function heightSlider(p: Page) {
  const s = await p.evaluate(`(() => { const i = [...document.querySelectorAll('#card .adj')].find((a) => a.querySelector('label')?.textContent === 'Height')?.querySelector('input[type=range]'); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width, min: +i.min, max: +i.max, v: +i.value }; })()`);
  if (!s) throw new Error("no Height slider on the card");
  return { at: (mm: number) => s.x + 8 + ((mm - s.min) / (s.max - s.min)) * (s.w - 16), y: s.y, v: s.v as number, min: s.min as number, max: s.max as number };
}
export async function press(p: Page, x0: number, x1: number, y: number) {
  await mouse(p, "mouseMoved", x0, y, 0); await mouse(p, "mousePressed", x0, y, 1);
  for (let i = 1; i <= 12; i++) { await mouse(p, "mouseMoved", x0 + ((x1 - x0) * i) / 12, y, 1); await sleep(12); }
}
export const release = (p: Page, x: number, y: number) => mouse(p, "mouseReleased", x, y, 0);
export async function clickText(p: Page, text: string) {
  const r = await p.evaluate(`(() => { const b = [...document.querySelectorAll('#trace .trace-activity button, #notices button')].find((b) => b.getClientRects().length && b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  if (!r) throw new Error(`no visible button '${text}'`);
  await mouse(p, "mouseMoved", r[0], r[1], 0); await mouse(p, "mousePressed", r[0], r[1], 1); await mouse(p, "mouseReleased", r[0], r[1], 0);
}
