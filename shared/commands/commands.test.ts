// bun test shared/commands — unit tests of the command layer: validation and the error shape, units of
// pose.set, limits and the assumed rule, the per-joint stale check, undo by version and by group (and
// stale undo), the history cap, the rebuilt-asset rule, scene.find ranking, measure.distance against an
// independent computation, and the view commands.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assetFromFiles, runCommand, findIds, VIEW_NAMES, type WireCommand } from "./core.ts";
import { list, validate } from "./registry.ts";
import { check } from "./schema.ts";
import { newDoc, reconcile, HISTORY_CAP, type Actor, type SceneDoc } from "./doc.ts";
import { matMul, translation, matFromQuat, rotationAxis, type Mat4, type Vec3, type Quat } from "../math.ts";
import type { Manifest, ManifestJoint } from "../manifest.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BUILD = join(ROOT, "assets", "rig-b", "build");
const manifest: Manifest = JSON.parse(readFileSync(join(BUILD, "rig-b.manifest.json"), "utf8"));
const glb = new Uint8Array(readFileSync(join(BUILD, "rig-b.glb")));
const asset = assetFromFiles(manifest, glb);
const DEG = Math.PI / 180;
const agent: Actor = { kind: "agent", id: "a1a1a1a1", label: "Claude Code · a1a1" };
const person: Actor = { kind: "person", id: "b2b2b2b2", label: "Person · b2b2" };

const fresh = () => ({ doc: newDoc(asset), asset });
const run = (s: { doc: SceneDoc }, actor: Actor, w: WireCommand) => runCommand({ doc: s.doc, asset }, actor, w);
const set = (s: { doc: SceneDoc }, actor: Actor, joints: Record<string, number | number[]>, extra: Partial<WireCommand> & { args?: Record<string, unknown> } = {}) =>
  run(s, actor, { id: "pose.set", ...extra, args: { joints, ...(extra.args ?? {}) } });
const joint = (id: string) => manifest.joints.find((j) => j.id === id)!;

describe("validation and the error shape", () => {
  test("bad arguments give {code, message, hint, schema}", () => {
    const r = set(fresh(), agent, { J_mon_height: "low" as any });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("invalid_args");
    expect(r.error.message).toContain("args.joints.J_mon_height");
    expect(r.error.hint.length).toBeGreaterThan(10);
    expect(r.error.schema).toEqual(list().find((c) => c.id === "pose.set")!.args);
    expect("error" in validate("pose.set", { joints: 1 })).toBe(true);
  });
  test("unknown command, unknown argument, missing argument, pattern, enum, integer", () => {
    const s = fresh();
    const codes = [
      run(s, agent, { id: "pose.sett", args: {} }),
      run(s, agent, { id: "pose.set", args: { joints: { J_mon_height: 0 }, speed: 2 } }),
      run(s, agent, { id: "scene.find", args: {} }),
      run(s, agent, { id: "pose.set", args: { joints: { J_mon_height: 0 }, group: "Lower Monitor" } }),
      run(s, agent, { id: "scene.find", args: { text: "x", kind: "people" } }),
      run(s, agent, { id: "history.undo", args: { version: 1.5 } }),
      run(s, agent, { id: "pose.set", args: { joints: { J_ts_arm: [1, 2] } } }),
    ].map((r) => (r.ok ? "ok" : r.error.code));
    expect(codes).toEqual(["unknown_command", "invalid_args", "invalid_args", "invalid_args", "invalid_args", "invalid_args", "invalid_args"]);
    const r = run(s, agent, { id: "pose.sett" });
    expect(!r.ok && r.error.hint).toContain("pose.set");
  });
  test("the validator itself", () => {
    expect(check({ type: "object", additionalProperties: { type: "number" }, propertyNames: { pattern: "^J_" } }, { J_a: 1, X: 2 })).toContain("does not match");
    expect(check({ anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 }] }, [1, 2, 3])).toBeNull();
    expect(check({ type: "integer", minimum: 1 }, 0)).toContain("below the minimum");
    expect(check({ type: "number" }, Number.NaN)).toContain("expected a number");
    expect(check({ type: "string", maxLength: 3 }, "abcd")).toContain("longer than");
  });
  test("every command is listed with a summary, a schema and an example that validates", () => {
    const l = list();
    // the step-1 commands; the intent commands (intent.ts) are listed too once another test file has loaded them, in any order
    // (the person's low-level commands, person.ts, come with intent.ts: shared/commands/person.test.ts lists them)
    expect(l.filter((c) => !c.tool && !c.id.startsWith("person.")).map((c) => c.id)).toEqual(["scene.summary", "scene.find", "pose.set", "history.undo", "measure.distance", "view.set", "view.show", "view.select"]);
    for (const c of l) {
      expect(c.summary.length).toBeGreaterThan(20);
      for (const e of c.examples) expect([c.id, check(c.args, e.args)]).toEqual([c.id, null]);
    }
  });
});

describe("pose.set units", () => {
  test("degrees for revolute joints and three-angle mounts, metres for prismatic joints (stored SI)", () => {
    for (const j of manifest.joints) {
      const s = fresh();
      const mid = j.lower + 0.3 * (j.upper - j.lower);   // never the neutral value of these joints
      const si = j.type === "ball" ? (j.neutral as number[]).map((n, i) => n + [mid, j.lower * 0.5, j.upper * 0.25][i]) : mid;
      const given = j.type === "ball" ? (si as number[]).map((x) => x / DEG) : j.type === "prismatic" ? (si as number) : (si as number) / DEG;
      const r = set(s, agent, { [j.id]: given }, { args: { allowAssumed: true } });
      expect([j.id, r.ok]).toEqual([j.id, true]);
      const stored = s.doc.pose[j.id];
      if (Array.isArray(si)) for (let i = 0; i < 3; i++) expect(Math.abs((stored as number[])[i] - si[i])).toBeLessThan(1e-12);
      else expect(Math.abs((stored as number) - si)).toBeLessThan(1e-12);
      // the result and the summary speak the same units as the command
      const ch = (r as any).result.changes[0];
      expect(ch.unit).toBe(j.type === "prismatic" ? "m" : "deg");
      const moved = (run(s, agent, { id: "scene.summary" }) as any).result.moved.find((m: any) => m.joint === j.id);
      if (Array.isArray(given)) (given as number[]).forEach((g, i) => expect(Math.abs(moved.value[i] - g)).toBeLessThan(1e-3));
      else expect(Math.abs(moved.value - (given as number))).toBeLessThan(1e-3);
    }
  });
  test("the monitor 3 cm lower is -0.03 m; a tilt of 10 is 10 degrees", () => {
    const s = fresh();
    set(s, agent, { J_mon_height: -0.03, J_mon_tilt: 10 });
    expect(s.doc.pose.J_mon_height).toBe(-0.03);
    expect(s.doc.pose.J_mon_tilt as number).toBeCloseTo(10 * DEG, 12);
  });
});

describe("limits and the assumed rule", () => {
  test("a value at the limit is accepted, beyond it refused with the travel in command units", () => {
    const j = joint("J_mon_height"), s = fresh();
    expect(set(s, agent, { J_mon_height: j.upper }).ok).toBe(true);
    const r = set(s, agent, { J_mon_height: j.upper + 0.001 });
    expect(!r.ok && r.error.code).toBe("out_of_range");
    expect(!r.ok && r.error.message).toContain("-0.095 … 0.06 m");
    const t = joint("J_mon_tilt");
    expect(set(s, agent, { J_mon_tilt: t.upper / DEG }).ok).toBe(true);
    expect(set(s, agent, { J_mon_tilt: t.upper / DEG + 0.5 }).ok).toBe(false);
  });
  test("a three-angle mount: each angle within its travel from neutral", () => {
    const j = joint("J_ts_arm"), n = (j.neutral as number[]).map((x) => x / DEG), up = j.upper / DEG, s = fresh();
    expect(set(s, agent, { J_ts_arm: [n[0] + up, n[1], n[2]] }).ok).toBe(true);
    const r = set(s, agent, { J_ts_arm: [n[0], n[1] + up + 1, n[2]] });
    expect(!r.ok && r.error.code).toBe("out_of_range");
  });
  test("assumed adjustments are refused unless allowAssumed, and then noted", () => {
    const assumed = manifest.joints.filter((j) => j.evidence === "assumed" || j.locked).map((j) => j.id);
    expect(assumed).toContain("J_seat_slide");
    for (const id of assumed) {
      const s = fresh(), j = joint(id), v = j.type === "prismatic" ? (j.lower + j.upper) / 2 : (j.lower + j.upper) / 2 / DEG;
      const r = set(s, agent, { [id]: v });
      expect([id, !r.ok && r.error.code]).toEqual([id, "assumed_joint"]);
      const ok = set(s, agent, { [id]: v }, { args: { allowAssumed: true } });
      expect([id, ok.ok, (ok as any).result.notes?.length]).toEqual([id, true, 1]);
    }
  });
  test("unknown joint, with similar ones in the hint", () => {
    const r = set(fresh(), agent, { J_mon_heigth: 0 });
    expect(!r.ok && r.error.code).toBe("unknown_joint");
  });
});

describe("per-joint stale check", () => {
  test("a change based on an old version is refused only for joints that moved after it", () => {
    const s = fresh();
    expect(set(s, agent, { J_mon_height: -0.03 }, { expectedVersion: 0 }).version).toBe(1);
    // another joint, based on version 0: accepted
    const other = set(s, person, { J_mon_pan: 5 }, { expectedVersion: 0 });
    expect(other.ok && other.version).toBe(2);
    // the same joint, based on version 0: refused, and the refusal says who moved it and when
    const stale = set(s, person, { J_mon_height: -0.05 }, { expectedVersion: 0 });
    expect(!stale.ok && stale.error.code).toBe("stale");
    expect(!stale.ok && stale.error.message).toContain("J_mon_height was changed by Claude Code · a1a1 in version 1");
    expect(!stale.ok && stale.error.hint).toContain("expectedVersion 2");
    expect(s.doc.pose.J_mon_height).toBe(-0.03);
    // a joint named with its current value still takes part in the check
    expect(set(s, person, { J_mon_height: -0.03, J_mon_tilt: 0 }, { expectedVersion: 0 }).ok).toBe(false);
    // based on the current version: accepted
    expect(set(s, person, { J_mon_height: -0.05 }, { expectedVersion: 2 }).ok).toBe(true);
    // routing values are accepted at the request level only, never inside args
    for (const extra of [{ expectedVersion: 1 }, { group: "x" }, { session: "ABCDEFGH" }]) {
      const r = set(s, agent, { J_mon_height: 0 }, { args: extra });
      expect(!r.ok && r.error.code).toBe("invalid_args");
      expect(!r.ok && r.error.message).toContain("unknown argument");
    }
  });
  test("a version from the future is invalid; one older than the kept history is stale", () => {
    const s = fresh();
    set(s, agent, { J_mon_height: -0.01 });
    const r = set(s, agent, { J_mon_pan: 1 }, { expectedVersion: 5 });
    expect(!r.ok && r.error.code).toBe("invalid_args");
    for (let i = 0; i < HISTORY_CAP + 5; i++) set(s, agent, { J_mon_pan: (i % 20) + 1 });
    const old = set(s, person, { J_mon_tilt: 1 }, { expectedVersion: 1 });
    expect(!old.ok && old.error.code).toBe("stale");
    expect(!old.ok && old.error.message).toContain("older than the kept history");
  });
  test("a change that changes nothing records nothing", () => {
    const s = fresh();
    const r = set(s, agent, { J_mon_height: 0 });
    expect(r.ok && r.version).toBe(0);
    expect(r.ok && (r as any).entry).toBeUndefined();
    expect(s.doc.history.length).toBe(0);
  });
});

describe("undo", () => {
  test("by version: a new entry that puts the values back; refused when stale; redo by undoing the undo", () => {
    const s = fresh();
    set(s, agent, { J_mon_height: -0.03, J_mon_tilt: 10 });                 // v1
    set(s, person, { J_mon_pan: 5 });                                       // v2
    const u = run(s, person, { id: "history.undo", args: { version: 1 } }); // v3
    expect(u.ok && u.version).toBe(3);
    expect(s.doc.pose.J_mon_height).toBe(0);
    expect(s.doc.pose.J_mon_tilt).toBe(joint("J_mon_tilt").neutral);
    expect(s.doc.pose.J_mon_pan).toBe(5 * DEG);
    expect(s.doc.history.at(-1)!.undoes).toEqual([1]);
    const again = run(s, person, { id: "history.undo", args: { version: 1 } });
    expect(!again.ok && again.error.code).toBe("stale");
    expect(!again.ok && again.error.message).toContain("already undone by version 3");
    const redo = run(s, agent, { id: "history.undo", args: { version: 3 } });
    expect(redo.ok).toBe(true);
    expect(s.doc.pose.J_mon_height).toBe(-0.03);
    // stale: the joint was changed again after the entry
    set(s, person, { J_mon_height: -0.05 });
    const st = run(s, agent, { id: "history.undo", args: { version: 4 } });
    expect(!st.ok && st.error.code).toBe("stale");
    expect(!st.ok && st.error.message).toContain("changed again by Person · b2b2");
    const unknown = run(s, agent, { id: "history.undo", args: { version: 99 } });
    expect(!unknown.ok && unknown.error.code).toBe("unknown_version");
    const both = run(s, agent, { id: "history.undo", args: { version: 1, group: "x" } });
    expect(!both.ok && both.error.code).toBe("invalid_args");
  });
  test("by group: the whole request, other joints untouched; stale when someone else moved one of its joints", () => {
    const s = fresh();
    set(s, agent, { J_mon_height: -0.02 }, { group: "lower-monitor" });     // v1
    set(s, person, { J_seat_recline: 20 }, { args: { allowAssumed: true } }); // v2 (another joint)
    set(s, agent, { J_mon_height: -0.03, J_mon_tilt: 0 }, { group: "lower-monitor" }); // v3
    const u = run(s, person, { id: "history.undo", args: { group: "lower-monitor" } });
    expect(u.ok && u.version).toBe(4);
    expect(s.doc.pose.J_mon_height).toBe(0);
    expect(s.doc.pose.J_mon_tilt).toBe(joint("J_mon_tilt").neutral);
    expect(s.doc.pose.J_seat_recline as number).toBeCloseTo(20 * DEG, 12);
    expect(s.doc.history.at(-1)!.undoes).toEqual([1, 3]);
    const twice = run(s, person, { id: "history.undo", args: { group: "lower-monitor" } });
    expect(!twice.ok && twice.error.code).toBe("nothing_to_undo");
    // redo (undo of the undo) and undo the group again
    expect(run(s, agent, { id: "history.undo", args: { version: 4 } }).ok).toBe(true);
    expect(s.doc.pose.J_mon_height).toBe(-0.03);
    expect(run(s, agent, { id: "history.undo", args: { group: "lower-monitor" } }).ok).toBe(true);
    expect(s.doc.pose.J_mon_height).toBe(0);
    // stale: someone else moved a joint of the group afterwards
    set(s, agent, { J_mon_pan: 10 }, { group: "turn-monitor" });
    set(s, person, { J_mon_pan: 12 });
    const st = run(s, agent, { id: "history.undo", args: { group: "turn-monitor" } });
    expect(!st.ok && st.error.code).toBe("stale");
    expect(!st.ok && st.error.message).toContain("J_mon_pan was changed by Person · b2b2");
    const unk = run(s, agent, { id: "history.undo", args: { group: "no-such-group" } });
    expect(!unk.ok && unk.error.code).toBe("unknown_group");
  });
  test("by group, with an undo inside the request: the net effect is reverted", () => {
    const s = fresh();
    set(s, agent, { J_mon_height: -0.02 }, { group: "g1" });                      // v1
    run(s, agent, { id: "history.undo", args: { version: 1 }, group: "g1" });    // v2, tagged
    set(s, agent, { J_mon_height: -0.04 }, { group: "g1" });                      // v3
    run(s, agent, { id: "history.undo", args: { version: 3 } });                 // v4, untagged undo of a g1 entry
    const r = run(s, agent, { id: "history.undo", args: { group: "g1" } });
    expect(!r.ok && r.error.code).toBe("nothing_to_undo");
    set(s, agent, { J_mon_height: -0.01 }, { group: "g1" });                      // v5
    expect(run(s, agent, { id: "history.undo", args: { group: "g1" } }).ok).toBe(true);
    expect(s.doc.pose.J_mon_height).toBe(0);
  });
  test("the wire group tags the undo entry; it is not the group undone", () => {
    const s = fresh();
    set(s, agent, { J_mon_height: -0.02 }, { group: "a" });
    run(s, agent, { id: "history.undo", args: { group: "a" }, group: "b" });
    expect(s.doc.history.at(-1)!.group).toBe("b");
  });
});

test("history keeps the last 200 entries; older versions cannot be undone", () => {
  const s = fresh();
  for (let i = 0; i < HISTORY_CAP + 5; i++) set(s, agent, { J_mon_pan: (i % 2 ? 1 : -1) * (1 + (i % 7)) });
  expect(s.doc.version).toBe(HISTORY_CAP + 5);
  expect(s.doc.history.length).toBe(HISTORY_CAP);
  expect(s.doc.history[0].version).toBe(6);
  const r = run(s, agent, { id: "history.undo", args: { version: 3 } });
  expect(!r.ok && r.error.code).toBe("unknown_version");
  expect(!r.ok && r.error.message).toContain("no longer in the history");
  expect((run(s, agent, { id: "scene.summary" }) as any).result.recent.length).toBe(10);
});

test("rebuilt asset: vanished joints dropped, values clamped to new limits, one system entry", () => {
  const s = fresh();
  set(s, agent, { J_mon_height: -0.09, J_mon_pan: 20, J_ts_arm: (joint("J_ts_arm").neutral as number[]).map((x) => x / DEG + 25) });
  const joints = new Map<string, ManifestJoint>(manifest.joints.map((j) => [j.id, { ...j }]));
  joints.delete("J_mon_pan");
  joints.get("J_mon_height")!.lower = -0.05;
  joints.get("J_ts_arm")!.upper = 20 * DEG;
  const e = reconcile(s.doc, { name: "rig-b", sha256: "f".repeat(64), joints });
  expect(e!.actor.kind).toBe("system");
  expect(e!.command).toBe("asset.rebuilt");
  const by = Object.fromEntries(e!.changes.map((c) => [c.joint, c]));
  expect(by.J_mon_pan.after).toBeNull();
  expect(by.J_mon_height.after).toBe(-0.05);
  (by.J_ts_arm.after as number[]).forEach((x, i) => expect(x - (joint("J_ts_arm").neutral as number[])[i]).toBeCloseTo(20 * DEG, 9));
  expect("J_mon_pan" in s.doc.pose).toBe(false);
  expect(s.doc.asset.sha256).toBe("f".repeat(64));
  expect(reconcile(s.doc, { name: "rig-b", sha256: "f".repeat(64), joints })).toBeNull();
  // the same asset again: nothing to do
  const t = fresh();
  expect(reconcile(t.doc, { name: asset.name, sha256: asset.sha256, joints: asset.joints })).toBeNull();
});

describe("scene.find", () => {
  const top = (text: string, kind?: string) => findIds(asset, text, kind)[0]?.id;
  test("ranking", () => {
    expect(top("monitor height")).toBe("J_mon_height");
    expect(top("lower the monitor")).toBe("J_mon_height");
    expect(top("eye small")).toBe("D_eye_small");
    expect(top("emergency stop", "datum")).toBe("D_estop");
    expect(top("emergency stop", "part")).toBe("C_pod_estop_R");
    expect(top("seat forward")).toBe("J_seat_slide");
    expect(top("backrest recline")).toBe("J_seat_recline");
    expect(top("monitor screen")).toBe("S_mon_screen");
    expect(top("J_mon_tilt")).toBe("J_mon_tilt");
    expect(top("pedal 2", "joint")).toBe("J_pedal_2");
    expect(findIds(asset, "monitor", "joint").map((x) => x.id).sort()).toEqual(["J_mon_height", "J_mon_pan", "J_mon_tilt"]);
    expect(findIds(asset, "zebra")).toEqual([]);
  });
  test("joints are named as on the page (shared/words.ts)", () => {
    const m = findIds(asset, "monitor height")[0] as any;
    expect(m.label).toBe("Monitor: height");
    const s = fresh(), r = set(s, agent, { J_mon_height: -0.03 }) as any;
    expect(r.result.changes[0]).toMatchObject({ label: "Monitor: height", said: "Monitor: height 3 cm lower" });
    expect((findIds(asset, "touchscreen arm")[0] as any).joint.angles).toEqual(["lean sideways", "lean", "twist"]);
  });
  test("a joint match describes the joint in command units", () => {
    const m = findIds(asset, "monitor height")[0] as any;
    expect(m.joint).toMatchObject({ unit: "m", min: -0.095, max: 0.06, neutral: 0, assumed: false });
    const t = findIds(asset, "monitor tilt")[0] as any;
    expect(t.joint.unit).toBe("deg");
    expect(t.joint.max).toBeCloseTo(15, 3);
  });
});

describe("measure.distance", () => {
  // Independent computation: 4x4 matrices from the GLB's own node data (shared/math.ts matrices, not the
  // quaternion composition of shared/pose.ts and shared/kinematics.ts), the joint motion applied as the
  // description file's conventions say: stored transform · motion(value − neutral).
  function worldOrigins(values: Record<string, number>): Record<string, Vec3> {
    const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true), gl = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
    const out: Record<string, Vec3> = {};
    const walk = (i: number, parent: Mat4, root: boolean) => {
      const n = gl.nodes[i], t = (root ? [0, 0, 0] : n.translation ?? [0, 0, 0]) as Vec3, q = (root ? [0, 0, 0, 1] : n.rotation ?? [0, 0, 0, 1]) as Quat;
      let local = matMul(translation(t), matFromQuat(q));
      const j = n.extras?.joint, v = values[n.name];
      if (j && v !== undefined) local = matMul(local, j.type === "prismatic" ? translation(j.axis.map((a: number) => a * (v - j.neutral)) as Vec3) : rotationAxis(j.axis, v - j.neutral));
      const world = matMul(parent, local);
      out[n.name] = [world[3], world[7], world[11]];
      for (const c of n.children ?? []) walk(c, world, false);
    };
    walk(gl.scenes[0].nodes[0], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], true);
    return out;
  }
  test("agrees with an independent computation at a moved pose", () => {
    const s = fresh();
    const pose = { J_mon_height: -0.03, J_mon_tilt: -8, J_mon_pan: 12, J_seat_height: 0.03, J_seat_recline: 25, J_seat_swivel: 10 };
    expect(set(s, agent, pose, { args: { allowAssumed: true } }).ok).toBe(true);
    const si: Record<string, number> = {};
    for (const [k, v] of Object.entries(pose)) si[k] = joint(k).type === "prismatic" ? v : v * DEG;
    const w = worldOrigins(si);
    for (const [from, to] of [["D_eye_median", "S_mon_screen"], ["D_grip_R", "D_estop"], ["C_seat_headrest", "C_stand_monitor"], ["D_floor", "D_eye_small"]]) {
      const r = run(s, agent, { id: "measure.distance", args: { from, to } }) as any;
      const want = Math.hypot(...[0, 1, 2].map((i) => w[to][i] - w[from][i]));
      expect([from, to, r.ok, r.result.status]).toEqual([from, to, true, "point estimate"]);
      expect(Math.abs(r.result.distance_m - want)).toBeLessThan(1e-4);
    }
    // and the pose matters: the floor-to-screen distance is not the neutral one
    const neutral = run(fresh(), agent, { id: "measure.distance", args: { from: "D_floor", to: "S_mon_screen" } }) as any;
    const moved = run(s, agent, { id: "measure.distance", args: { from: "D_floor", to: "S_mon_screen" } }) as any;
    expect(Math.abs(neutral.result.distance_m - moved.result.distance_m)).toBeGreaterThan(0.005);
  });
  test("unknown ids are refused", () => {
    const r = run(fresh(), agent, { id: "measure.distance", args: { from: "D_eye_tall", to: "S_mon_screen" } });
    expect(!r.ok && r.error.code).toBe("unknown_id");
  });
});

describe("view commands", () => {
  test("validated by the server; the wire's session names the browser", () => {
    const s = fresh();
    const code = "K7Q2XM4P";
    const r = run(s, agent, { id: "view.set", args: { view: "operator" }, session: code });
    expect(r.ok && r.view).toEqual({ session: code, id: "view.set", args: { view: "operator" } });
    const none = run(s, agent, { id: "view.set", args: { view: "operator" } });
    expect(!none.ok && none.error.hint).toContain("--viewer");
    expect(run(s, agent, { id: "view.set", args: { view: "sideways" }, session: code }).ok).toBe(false);
    expect(run(s, agent, { id: "view.set", args: { view: "top" }, session: "K7Q2" }).ok).toBe(false);         // four characters: too short now
    expect(run(s, agent, { id: "view.set", args: { view: "top", session: code } }).ok).toBe(false);          // not inside args
    const bad = run(s, agent, { id: "view.show", args: { only: ["C_nothing"] }, session: code });
    expect(!bad.ok && bad.error.code).toBe("unknown_id");
    expect(run(s, agent, { id: "view.show", args: { only: ["stand", "C_seat_pan"] }, session: code }).ok).toBe(true);
    expect(run(s, agent, { id: "view.select", args: { id: "C_stand_monitor" }, session: code }).ok).toBe(true);
    expect(s.doc.version).toBe(0);
  });
  test("the view names are the viewer's", () => {
    const src = readFileSync(join(ROOT, "viewer", "src", "engine.ts"), "utf8");
    const block = src.slice(src.indexOf("export const VIEWS"), src.indexOf("};", src.indexOf("export const VIEWS")));
    const names = [...block.matchAll(/^\s+([a-z_]+): \{ label:/gm)].map((m) => m[1]);
    expect(names).toEqual(VIEW_NAMES);
  });
});
