// bun test shared/commands — unit tests of the intent commands (agent interface v2, intent.ts): plain-word targets and
// their ambiguity rule, amounts with units and directions, relative changes worked out at apply time, the server-made
// request name, assumed adjustments moved and marked, undo of "last", "mine", a request and a version, the compact
// state, measure by words, look, the catalogue and the generated instructions.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assetFromFiles, runCommand, type WireCommand } from "./core.ts";
import { adjustments, catalogue, parseAmount, resolveAdjustment } from "./intent.ts";
import { instructions, INSTRUCTIONS_MAX } from "./agent-docs.ts";
import { newDoc, type Actor, type SceneDoc } from "./doc.ts";
import { adjWords } from "../words.ts";

const BUILD = join(import.meta.dir, "..", "..", "assets", "rig-b", "build");
const asset = assetFromFiles(JSON.parse(readFileSync(join(BUILD, "rig-b.manifest.json"), "utf8")), new Uint8Array(readFileSync(join(BUILD, "rig-b.glb"))));
const DEG = Math.PI / 180;
const agent: Actor = { kind: "agent", id: "a1a1a1a1", label: "Claude Code · a1a1" };
const person: Actor = { kind: "person", id: "b2b2b2b2", label: "Person · b2b2" };
const fresh = () => ({ doc: newDoc(asset) as SceneDoc, asset });
const run = (s: { doc: SceneDoc }, actor: Actor, w: WireCommand) => runCommand({ doc: s.doc, asset }, actor, w) as any;
const key = (t: string) => resolveAdjustment(asset, t).key;
const refusal = (f: () => unknown) => { try { f(); } catch (e: any) { return e.code; } return null; };

describe("targets in plain words", () => {
  test("everyday names find one adjustment", () => {
    expect(key("backrest")).toBe("J_seat_recline");
    expect(key("seat back")).toBe("J_seat_recline");
    expect(key("monitor height")).toBe("J_mon_height");
    expect(key("lower the monitor")).toBe("J_mon_height");
    expect(key("seat height")).toBe("J_seat_height");
    expect(key("left armrest")).toBe("J_pod_armrest_L");
    expect(key("touchscreen tilt")).toBe("J_ts_screen:1");
    expect(key("right pedal")).toBe("J_pedal_3");
    expect(key("J_seat_recline")).toBe("J_seat_recline");
    expect(key("J_ts_screen:2")).toBe("J_ts_screen:2");
  });
  test("two about equally likely: refused as ambiguous, with the candidates", () => {
    for (const t of ["monitor", "armrest", "seat", "pedal", "J_ts_screen"]) expect(refusal(() => resolveAdjustment(asset, t))).toBe("ambiguous");
    try { resolveAdjustment(asset, "armrest"); } catch (e: any) { expect(e.message).toContain("Left armrest pad"); expect(e.message).toContain("Right armrest pad"); }
  });
  test("nothing adjustable: unknown_target", () => expect(refusal(() => resolveAdjustment(asset, "coffee machine"))).toBe("unknown_target"));
  test("every joint has its words, and every adjustment says what 0 means", () => {
    for (const j of asset.manifest.joints) for (const w of adjWords(j)) { expect(w.section).not.toBe("Other"); expect(w.zero.length).toBeGreaterThan(3); expect(w.aliases.length).toBeGreaterThan(0); }
    expect(catalogue(asset).length).toBe(adjustments(asset).length);
  });
});

describe("amounts", () => {
  const recline = resolveAdjustment(asset, "backrest"), height = resolveAdjustment(asset, "monitor height");
  test("units, signs and direction words", () => {
    expect(parseAmount(height, "-3 cm", "by")).toEqual({ si: -0.03, relative: true });
    expect(parseAmount(height, "30 mm", "by").si).toBeCloseTo(0.03, 9);
    expect(parseAmount(height, "2 cm lower", "by").si).toBeCloseTo(-0.02, 9);
    expect(parseAmount(height, "2 cm higher", "by").si).toBeCloseTo(0.02, 9);
    expect(parseAmount(height, 0.01, "by")).toEqual({ si: 0.01, relative: true });
    expect(parseAmount(recline, "5°", "by").si).toBeCloseTo(5 * DEG, 9);
    expect(parseAmount(recline, "5 degrees upright", "by").si).toBeCloseTo(-5 * DEG, 9);
    expect(parseAmount(recline, 20, "to").si).toBeCloseTo(20 * DEG, 9);
  });
  test("named positions with to", () => {
    expect(parseAmount(recline, "upright", "to").si).toBe(recline.lo);
    expect(parseAmount(recline, "fully reclined", "to").si).toBe(recline.hi);
    expect(parseAmount(recline, "as photographed", "to").si).toBe(recline.neutral);
    expect(parseAmount(height, "max", "to").si).toBe(height.hi);
    expect(parseAmount(height, "lowest", "to").si).toBe(height.lo);
    expect(parseAmount(height, "3 cm lower", "to").si).toBeCloseTo(-0.03, 9);
  });
  test("a length for an angle, an unknown direction, nonsense: refused", () => {
    expect(refusal(() => parseAmount(recline, "3 cm", "by"))).toBe("invalid_args");
    expect(refusal(() => parseAmount(height, "5°", "by"))).toBe("invalid_args");
    expect(refusal(() => parseAmount(height, "2 cm sideways", "by"))).toBe("invalid_args");
    expect(refusal(() => parseAmount(height, "somewhere", "to"))).toBe("invalid_args");
  });
});

describe("adjust", () => {
  test("one call: resolved, relative to the current value, recorded with a server-made request name, replied in words", () => {
    const s = fresh();
    expect(run(s, agent, { id: "adjust", args: { target: "monitor height", by: "-3 cm" } }).ok).toBe(true);
    const r = run(s, agent, { id: "adjust", args: { target: "monitor height", by: "-2 cm" } });
    expect(r.ok).toBe(true);
    expect(s.doc.pose.J_mon_height).toBeCloseTo(-0.05, 9);
    expect(r.result.request).toBe("mon-height-2");
    expect(s.doc.history.at(-1)!.group).toBe("mon-height-2");
    expect(r.result.text).toContain("Monitor: height 3 cm lower → 5 cm lower");
    expect(r.result.text).toContain('undo {"what": "mon-height-2"}');
  });
  test("an assumed adjustment is moved and marked; a change by someone else is named", () => {
    const s = fresh();
    run(s, person, { id: "pose.set", args: { joints: { J_seat_recline: 25 }, allowAssumed: true } });
    const r = run(s, agent, { id: "adjust", args: { target: "backrest", to: "upright" } });
    expect(r.ok).toBe(true);
    expect(s.doc.pose.J_seat_recline).toBe(0);
    expect(r.result.text).toContain("Backrest: recline 25° reclined → upright (25° → 0°)");
    expect(r.result.text).toContain("assumed adjustment");
    expect(r.result.text).toContain("replaces a change by Person · b2b2");
  });
  test("several adjustments are one request; out of range and twice the same are refused", () => {
    const s = fresh();
    const r = run(s, agent, { id: "adjust", args: { changes: [{ target: "seat height", to: "highest" }, { target: "monitor tilt", by: "-2°" }] } });
    expect(r.ok).toBe(true);
    expect(s.doc.history.length).toBe(1);
    expect(s.doc.history[0].changes.map((c) => c.joint).sort()).toEqual(["J_mon_tilt", "J_seat_height"]);
    expect(run(s, agent, { id: "adjust", args: { target: "seat height", by: "10 cm" } }).error.code).toBe("out_of_range");
    expect(run(s, agent, { id: "adjust", args: { changes: [{ target: "backrest", to: 5 }, { target: "seat back", to: 6 }] } }).error.code).toBe("invalid_args");
    expect(run(s, agent, { id: "adjust", args: { target: "backrest" } }).error.code).toBe("invalid_args");
  });
  test("one angle of a three-angle mount moves alone", () => {
    const s = fresh(), before = [...(asset.joints.get("J_ts_screen")!.neutral as number[])];
    expect(run(s, agent, { id: "adjust", args: { target: "touchscreen tilt", by: "5° up" } }).ok).toBe(true);
    const v = s.doc.pose.J_ts_screen as number[];
    expect(v[0]).toBeCloseTo(before[0], 9); expect(v[1]).toBeCloseTo(before[1] + 5 * DEG, 9); expect(v[2]).toBeCloseTo(before[2], 9);
  });
  test("nothing changed: nothing recorded, and said so", () => {
    const s = fresh(), r = run(s, agent, { id: "adjust", args: { target: "monitor height", to: "as photographed" } });
    expect(r.ok).toBe(true); expect(s.doc.history.length).toBe(0); expect(r.result.text).toContain("Nothing changed");
  });
});

describe("undo, state, measure, look", () => {
  test("undo last skips undos and undone changes; mine, a request and a version", () => {
    const s = fresh();
    run(s, agent, { id: "adjust", args: { target: "monitor height", by: "-3 cm" } });       // v1
    run(s, person, { id: "adjust", args: { target: "left armrest", by: "2 cm forward" } });  // v2
    expect(run(s, agent, { id: "undo", args: {} }).result.undid).toEqual([2]);              // v3 undoes v2
    expect(run(s, agent, { id: "undo", args: { what: "last" } }).result.undid).toEqual([1]);// v4 undoes v1
    expect(run(s, agent, { id: "undo", args: {} }).error.code).toBe("nothing_to_undo");
    run(s, person, { id: "adjust", args: { target: "monitor height", by: "-1 cm" } });       // v5
    expect(run(s, agent, { id: "undo", args: { what: "mine" } }).error.code).toBe("nothing_to_undo");
    run(s, agent, { id: "adjust", args: { target: "seat height", by: "1 cm" } });            // v6, request seat-height-6
    expect(run(s, agent, { id: "undo", args: { what: "seat-height-6" } }).result.undid).toEqual([6]);
    expect(run(s, agent, { id: "undo", args: { what: 5 } }).result.undid).toEqual([5]);
    expect(s.doc.pose.J_mon_height ?? 0).toBeCloseTo(0, 9);
  });
  test("state: a few lines, and the catalogue on request", () => {
    const s = fresh();
    run(s, agent, { id: "adjust", args: { target: "backrest", to: "upright" } });
    const r = run(s, agent, { id: "state", args: {} });
    expect(r.result.text).toContain("Backrest: recline upright (assumed)");
    expect(r.result.text.length).toBeLessThan(600);
    expect(run(s, agent, { id: "state", args: { detail: "catalogue" } }).result.text).toContain("0 = backrest vertical");
  });
  test("measure by words equals measure.distance by ids; an eye without a size is ambiguous", () => {
    const s = fresh();
    const a = run(s, agent, { id: "measure", args: { from: "median eye", to: "monitor screen" } }).result;
    const b = run(s, agent, { id: "measure.distance", args: { from: "D_eye_median", to: "S_mon_screen" } }).result;
    expect(a.distance_m).toBe(b.distance_m);
    expect(run(s, agent, { id: "measure", args: { from: "eye", to: "monitor screen" } }).error.code).toBe("ambiguous");
  });
  test("look: words for views and parts; locally it needs no code; nothing to do is refused", () => {
    const s = fresh();
    const r = run(s, agent, { id: "look", args: { view: "operator's view", only: ["monitor stand", "seat"], select: "left joystick", picture: true } });
    expect(r.ok).toBe(true);
    expect(r.view).toEqual({ session: null, id: "look", args: { view: "operator", only: ["stand", "seat"], select: "C_joy_base_L", picture: true } });
    expect(run(s, agent, { id: "look", args: {} }).error.code).toBe("invalid_args");
    expect(run(s, agent, { id: "look", args: { view: "operator" }, session: "nonsense" }).error.code).toBe("invalid_args");
  });
});

describe("look: the camera anywhere", () => {
  test("eye by stature, sitting eye height or person; refused out of range or with camera", () => {
    const s = fresh(), look = (args: any) => run(s, agent, { id: "look", args });
    const r = look({ eye: { stature_cm: 180 } });
    expect(r.view.args).toEqual({ view: "operator", eye: 0.819 });
    expect(r.result.text).toContain("an assumed ratio");
    expect(r.result.text).toContain("5.4 cm above the median eye point");
    expect(look({ eye: { person: "large" } }).view.args.eye).toBe(0.845);
    expect(look({ eye: { sitting_eye_height_cm: 70 } }).view.args.eye).toBe(0.7);
    expect(look({ eye: { stature_cm: 300 } }).error.code).toBe("invalid_args");
    expect(look({ eye: { stature_cm: 180, person: "small" } }).error.code).toBe("invalid_args");
    expect(look({ eye: { stature_cm: 180 }, camera: { at: [1, 0, 1] } }).error.code).toBe("invalid_args");
  });
  test("camera at coordinates or named points with an offset, at the current pose", () => {
    const s = fresh(), look = (args: any) => run(s, agent, { id: "look", args });
    expect(look({ camera: { at: [2, -1.5, 1.6], look_at: [0, 0, 1], fov: 60 } }).view.args.camera).toEqual([2, -1.5, 1.6, 0, 0, 1, 60]);
    const eye = look({ camera: { at: "median eye", look_at: "monitor screen" } }).view.args.camera;
    expect(eye.slice(0, 3)).toEqual([-0.5534, 0, 1.1549]);
    run(s, agent, { id: "adjust", args: { target: "seat forward / back", by: "10 cm forward" } });
    expect(look({ camera: { at: "median eye", look_at: "monitor screen" } }).view.args.camera[0]).toBeCloseTo(-0.4534, 4);   // moved with the seat
    const off = look({ camera: { at: { point: "seat", offset: [-1.2, 0.4, 1] }, look_at: "monitor screen" } });
    expect(off.ok).toBe(true); expect(off.result.text).toContain("Seat + (-1.2, 0.4, 1) m");
    expect(look({ camera: { at: "monitor screen", look_at: "monitor screen" } }).error.code).toBe("invalid_args");
    expect(look({ camera: { at: [50, 0, 0] } }).error.code).toBe("invalid_args");
  });
});

test("the MCP instructions fit Claude Code's limit and carry every adjustment", () => {
  for (const mode of ["local", "deployed"] as const) {
    const t = instructions(asset, mode);
    expect(t.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX);
    for (const a of adjustments(asset)) expect(t).toContain(`[${a.key}]`);
  }
  expect(instructions(asset, "deployed")).toContain("PUBLIC");
});
