// bun tools/clearance.ts [--asset <id>] [--build <name>] [--min 0.02] [--md <file>] [--json <file>]
//                         [--solve <joint> [--end lower|upper]]   [--gap "<ids>:<ids>" --pose J_x:val,...]
// Clearance sweep. Two passes, each compared with the neutral pose:
//   1. every joint at its lower and at its upper limit, the others neutral: every part that moved against every part that did not;
//   2. corners: every joint at one of its two limits at once (2^n poses, n <= 8): every pair of parts that different joints carry.
// A pair is reported when a pose made it worse than at rest: an overlap that was not there, or a gap under `min` that was wider
// at rest. Parts that touch or sit inside one another by design are the same at rest and are listed for information only.
// A finding counts as hard only when every displaced joint above the two parts is unlocked; with a locked joint it is reported.
// `watch` pairs (the spec's [clearance] watch, id patterns with *) get their smallest gap printed for the neutral pose, each single
// limit that changes it and the worst corner. --gap prints one such gap for a pose given by hand (degrees or metres).
// --solve <joint> finds how far that joint can go from neutral toward one limit before anything is reported, with the other
// UNLOCKED joints at every combination of their limits. A limit found this way is an output of this tool on the model's
// geometry: the check can then never fail on it, and it is not evidence of the object's real range.
//
// WHAT IT CANNOT SEE (printed with every report): poses between the limits; features thinner than the 30 mm sample step;
// overlap of a part whose mesh is open or made of several solids that overlap one another (ray parity); a pair that already
// overlaps at rest unless it gets 3 mm deeper; joints with three angles (skipped); anything outside the asset (floor, room,
// a person, a chair). It is a screen, not a proof.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./timeline.ts";
import { poseFromRest, type Trs } from "../shared/pose.ts";
import { quatRotate, type Vec3, type Quat } from "../shared/math.ts";

const STEP = 0.03, REACH = 0.12, EPS = 1e-4, TOL = 0.003;   // TOL: a change under 3 mm is sampling noise, not a finding
type Tri = [Vec3, Vec3, Vec3];
interface Part { id: string; tris: Tri[]; box: Float64Array; pts: Vec3[]; min: Vec3; max: Vec3; closed: boolean }
export interface PairResult { a: string; b: string; depth: number; gap: number }
export interface Finding { joint: string; end: "lower" | "upper"; value: number; locked: boolean; a: string; b: string; depth: number; gap: number; rest_depth: number; rest_gap: number }

function readGlb(file: string) {
  const buf = readFileSync(file), jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")), bin = buf.subarray(20 + jsonLen + 8);
  const accessor = (i: number): number[] => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type], out = new Array<number>(n);
    for (let k = 0; k < n; k++) out[k] = a.componentType === 5126 ? bin.readFloatLE(off + 4 * k) : a.componentType === 5125 ? bin.readUInt32LE(off + 4 * k) : a.componentType === 5123 ? bin.readUInt16LE(off + 2 * k) : bin.readUInt8(off + k);
    return out;
  };
  return { json, accessor };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Squared distance from a point to a triangle (Ericson, Real-Time Collision Detection 5.1.5). */
function dist2(p: Vec3, [a, b, c]: Tri): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q: Vec3;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
      else {
        const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
          }
        }
      }
    }
  }
  const d = sub(p, q); return dot(d, d);
}
const RAY: Vec3 = [0.5377, 0.7071, 0.4583];
/** True when the point is inside the closed mesh (odd number of crossings along a fixed skew ray). */
function inside(p: Vec3, tris: Tri[]): boolean {
  let n = 0;
  for (const [a, b, c] of tris) {
    const e1 = sub(b, a), e2 = sub(c, a), h = cross(RAY, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(p, a), u = dot(s, h) / det; if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(RAY, q) / det; if (v < 0 || u + v > 1) continue;
    if (dot(e2, q) / det > 1e-9) n++;
  }
  return n % 2 === 1;
}
function samples(tris: Tri[]): Vec3[] {
  const out: Vec3[] = [];
  for (const [a, b, c] of tris) {
    const n = Math.max(1, Math.ceil(Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, a)), Math.hypot(...sub(c, b))) / STEP));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const u = i / n, v = j / n; out.push([a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v, a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v]); }
  }
  return out;
}
function part(id: string, tris: Tri[]): Part {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  const box = new Float64Array(tris.length * 6);
  tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { box[6 * i + k] = Math.min(t[0][k], t[1][k], t[2][k]); box[6 * i + 3 + k] = Math.max(t[0][k], t[1][k], t[2][k]); } });
  // closed = every edge is used an even number of times (a screen sheet is open: nothing can be "inside" it)
  const edges = new Map<string, number>(), key = (p: Vec3) => p.map((x) => Math.round(x * 1e5)).join(",");
  for (const t of tris) for (let k = 0; k < 3; k++) { const a = key(t[k]), b = key(t[(k + 1) % 3]), e = a < b ? a + "|" + b : b + "|" + a; edges.set(e, (edges.get(e) ?? 0) + 1); }
  return { id, tris, box, pts: samples(tris), min, max, closed: [...edges.values()].every((n) => n % 2 === 0) };
}
/** Overlap depth and gap of one pair (both directions). Gap is `reach` when the parts are farther apart than that. */
function pair(a: Part, b: Part, reach = REACH): PairResult {
  let depth = 0, gap2 = reach * reach;
  for (let k = 0; k < 3; k++) if (a.min[k] > b.max[k] + reach || b.min[k] > a.max[k] + reach) return { a: a.id, b: b.id, depth: 0, gap: reach };
  for (const [x, y] of [[a, b], [b, a]] as [Part, Part][]) {
    for (const p of x.pts) {
      if (p[0] < y.min[0] - reach || p[0] > y.max[0] + reach || p[1] < y.min[1] - reach || p[1] > y.max[1] + reach || p[2] < y.min[2] - reach || p[2] > y.max[2] + reach) continue;
      let d2 = Math.min(gap2, reach * reach), r = Math.sqrt(d2), near = reach * reach;
      for (let i = 0; i < y.tris.length; i++) {
        const o = 6 * i, bx = y.box;
        if (p[0] < bx[o] - r || p[0] > bx[o + 3] + r || p[1] < bx[o + 1] - r || p[1] > bx[o + 4] + r || p[2] < bx[o + 2] - r || p[2] > bx[o + 5] + r) continue;
        const d = dist2(p, y.tris[i]); if (d < near) near = d; if (d < d2) { d2 = d; r = Math.sqrt(d); }
      }
      const within = y.closed && p[0] > y.min[0] && p[0] < y.max[0] && p[1] > y.min[1] && p[1] < y.max[1] && p[2] > y.min[2] && p[2] < y.max[2] && near > EPS * EPS && inside(p, y.tris);
      if (within) { let dd = REACH * REACH; for (const t of y.tris) { const d = dist2(p, t); if (d < dd) dd = d; } depth = Math.max(depth, Math.sqrt(dd)); } else if (d2 < gap2) gap2 = d2;
    }
  }
  return { a: a.id, b: b.id, depth, gap: depth > 0 ? 0 : Math.sqrt(gap2) };
}

export const CANNOT_SEE = "poses between the limits; features thinner than the 30 mm sample step; overlap of open or multi-solid meshes; pairs already overlapping at rest unless 3 mm deeper; three-angle joints; anything outside the asset (floor, room, a person)";
export interface CornerFinding { pose: Record<string, number>; a: string; b: string; depth: number; gap: number; rest_depth: number; rest_gap: number; locked: boolean }
export interface WatchRow { sets: [string, string]; pose: string; gap: number; a: string; b: string }
const glob = (pattern: string) => new RegExp("^(" + pattern.split(",").map((x) => x.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")).join("|") + ")$");

/** The model's parts at any pose, with what is needed to compare two poses. */
export function scene(buildDir: string, asset: string) {
  const manifest = JSON.parse(readFileSync(join(buildDir, `${asset}.manifest.json`), "utf8")), { json, accessor } = readGlb(join(buildDir, `${asset}.glb`));
  const local = new Map<number, Tri[]>();
  for (const [i, n] of json.nodes.entries()) if (n.mesh !== undefined && /^[CS]_/.test(n.name)) {
    const tris: Tri[] = [];
    for (const prim of json.meshes[n.mesh].primitives) {
      const pos = accessor(prim.attributes.POSITION), idx = accessor(prim.indices), v = (k: number): Vec3 => [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]];
      for (let t = 0; t < idx.length; t += 3) tris.push([v(idx[t]), v(idx[t + 1]), v(idx[t + 2])]);
    }
    local.set(i, tris);
  }
  const root = json.scenes[json.scene ?? 0].nodes[0] as number, joints = (manifest.joints as any[]).filter((j) => typeof j.neutral === "number");
  const jointOf = new Map<string, any>(joints.map((j) => [j.node, j])), cache = new Map<string, Part>(), pairs = new Map<string, PairResult>();
  const qmul = (a: Quat, b: Quat): Quat => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  /** part id -> { part, key: the displaced joints above it with their values } for a pose (joint id -> value); parts are cached by key */
  const world = (pose: Record<string, number>) => {
    const out = new Map<string, { part: Part; key: string; above: string[] }>();
    const walk = (i: number, T: Trs, above: string[]) => {
      const n = json.nodes[i], j = jointOf.get(n.name);
      let own: Trs = { t: (n.translation ?? [0, 0, 0]) as Vec3, q: (n.rotation ?? [0, 0, 0, 1]) as Quat }, up = above;
      if (j && pose[j.id] !== undefined && Math.abs(pose[j.id] - j.neutral) > 1e-9) { own = poseFromRest(j.rest, j, pose[j.id]); up = [...above, j.id]; }
      const r = quatRotate(T.q, own.t), W: Trs = i === root ? { t: [0, 0, 0], q: [0, 0, 0, 1] } : { t: [T.t[0] + r[0], T.t[1] + r[1], T.t[2] + r[2]], q: qmul(T.q, own.q) };
      const tris = local.get(i);
      if (tris) {
        const key = n.name + "@" + up.map((id) => `${id}=${pose[id]}`).join(",");
        if (!cache.has(key)) cache.set(key, part(n.name, tris.map((t) => t.map((p) => { const q = quatRotate(W.q, p); return [W.t[0] + q[0], W.t[1] + q[1], W.t[2] + q[2]] as Vec3; }) as Tri)));
        out.set(n.name, { part: cache.get(key)!, key, above: up });
      }
      for (const c of n.children ?? []) walk(c, W, up);
    };
    walk(root, { t: [0, 0, 0], q: [0, 0, 0, 1] }, []);
    return out;
  };
  const rest = world({});
  const measure = (x: { part: Part; key: string }, y: { part: Part; key: string }, reach = REACH) => { const k = `${x.key}|${y.key}|${reach}`; if (!pairs.has(k)) pairs.set(k, pair(x.part, y.part, reach)); return pairs.get(k)!; };
  return { manifest, joints, world, rest, measure };
}

/** The sweep. `limit` overrides a joint's limit at the end `end` (used by the solver); `only` restricts pass 1 to one joint. */
export function clearance(buildDir: string, asset: string, opts: { min?: number; limit?: Record<string, number>; only?: string; end?: "lower" | "upper"; corners?: string[] | false; watch?: [string, string][] } = {}) {
  const sc = scene(buildDir, asset), { manifest, joints, world, rest, measure } = sc, min = opts.min ?? 0.02, ids = [...rest.keys()];
  const lim = (j: any, end: "lower" | "upper") => (opts.end === end && opts.limit?.[j.id] !== undefined ? opts.limit[j.id] : j[end]) as number;
  const worse = (now: PairResult, was: PairResult) => now.depth > Math.max(was.depth, 1e-3) + TOL || (now.depth <= 1e-3 && now.gap < min && now.gap < was.gap - TOL);
  const findings: Finding[] = [], atRest = new Map<string, PairResult>();
  // pass 1: one joint at a time
  for (const j of joints) {
    if (opts.only && opts.only !== j.id) continue;
    for (const end of ["lower", "upper"] as const) {
      if (opts.end && opts.end !== end) continue;
      const value = lim(j, end); if (Math.abs(value - j.neutral) < 1e-9) continue;
      const posed = world({ [j.id]: value });
      for (const a of ids) if (posed.get(a)!.above.length) for (const b of ids) if (!posed.get(b)!.above.length) {
        const now = measure(posed.get(a)!, rest.get(b)!);
        const was = measure(rest.get(a)!, rest.get(b)!); if (was.depth > 1e-3 || was.gap < min) atRest.set(a + "|" + b, was);
        if ((now.depth > 1e-3 || now.gap < min) && worse(now, was)) findings.push({ joint: j.id, end, value, locked: !!j.locked, a, b, depth: now.depth, gap: now.gap, rest_depth: was.depth, rest_gap: was.gap });
      }
    }
  }
  // pass 2: corners (every listed joint at one of its limits)
  const cornerJoints = opts.corners === false ? [] : joints.filter((j) => (opts.corners ? opts.corners.includes(j.id) : true)), corners: CornerFinding[] = [], worst = new Map<string, CornerFinding>();
  const poses: Record<string, number>[] = [];
  if (cornerJoints.length >= 2 && cornerJoints.length <= 8) for (let m = 0; m < 1 << cornerJoints.length; m++) poses.push(Object.fromEntries(cornerJoints.map((j, k) => [j.id, lim(j, m & (1 << k) ? "upper" : "lower")])));
  for (const pose of poses) {
    const posed = world(pose);
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const A = posed.get(ids[x])!, B = posed.get(ids[y])!, moved = [...new Set([...A.above, ...B.above])];
      if (moved.length < 2 || A.above.join() === B.above.join()) continue;   // one joint: pass 1; same carrier: rigid to one another
      const now = measure(A, B); if (now.depth <= 1e-3 && now.gap >= min) continue;
      const was = measure(rest.get(ids[x])!, rest.get(ids[y])!); if (!worse(now, was)) continue;
      const f: CornerFinding = { pose: Object.fromEntries(moved.map((id) => [id, pose[id]])), a: ids[x], b: ids[y], depth: now.depth, gap: now.gap, rest_depth: was.depth, rest_gap: was.gap, locked: moved.some((id) => joints.find((j) => j.id === id)!.locked) };
      const k = f.a + "|" + f.b + "|" + (f.locked ? "L" : "U"), old = worst.get(k);
      if (!old || f.depth > old.depth || (f.depth <= 1e-3 && old.depth <= 1e-3 && f.gap < old.gap)) worst.set(k, f);
    }
  }
  corners.push(...worst.values());
  // watched pairs: smallest gap at rest, at each single limit and at the worst corner
  const watch: WatchRow[] = [], show = (pose: Record<string, number>) => Object.entries(pose).map(([id, v]) => { const j = joints.find((q) => q.id === id)!; return `${id} ${j.type === "revolute" ? ((v * 180) / Math.PI).toFixed(1) + " deg" : v.toFixed(3) + " m"}`; }).join(", ") || "neutral";
  for (const sets of opts.watch ?? []) {
    const A = ids.filter((id) => glob(sets[0]).test(id)), B = ids.filter((id) => glob(sets[1]).test(id));
    const gapAt = (pose: Record<string, number>) => { const posed = world(pose); let best: PairResult = { a: "", b: "", depth: 0, gap: Infinity }; for (const a of A) for (const b of B) { const r = measure(posed.get(a)!, posed.get(b)!, 0.5); const g = r.depth > 1e-3 ? -r.depth : r.gap; if (g < (best.depth > 1e-3 ? -best.depth : best.gap)) best = r; } return best; };
    const row = (pose: Record<string, number>, note = "") => { const r = gapAt(pose); watch.push({ sets, pose: show(pose) + note, gap: r.depth > 1e-3 ? -r.depth : r.gap, a: r.a, b: r.b }); return r.depth > 1e-3 ? -r.depth : r.gap; };
    const g0 = row({});
    for (const j of joints) for (const end of ["lower", "upper"] as const) { const v = lim(j, end); if (Math.abs(v - j.neutral) < 1e-9) continue; const r = gapAt({ [j.id]: v }), g = r.depth > 1e-3 ? -r.depth : r.gap; if (Math.abs(g - g0) > TOL) watch.push({ sets, pose: show({ [j.id]: v }), gap: g, a: r.a, b: r.b }); }
    let worstPose: Record<string, number> | null = null, wg = Infinity;
    for (const pose of poses) { const r = gapAt(pose), g = r.depth > 1e-3 ? -r.depth : r.gap; if (g < wg) { wg = g; worstPose = pose; } }
    if (worstPose) row(worstPose, " (the worst of all corners)");
  }
  return { asset, sha256: manifest.glb.sha256 as string, min, findings, corners, watch, atRest: [...atRest.values()], joints: manifest.joints as any[], cornerPoses: poses.length, gapAt: (a: string, b: string, pose: Record<string, number>) => { const posed = world(pose), A = ids.filter((id) => glob(a).test(id)), B = ids.filter((id) => glob(b).test(id)); let best = Infinity, who = ""; for (const x of A) for (const y of B) { const r = measure(posed.get(x)!, posed.get(y)!, 0.5), g = r.depth > 1e-3 ? -r.depth : r.gap; if (g < best) { best = g; who = `${x} / ${y}`; } } return { gap: best, pair: who }; } };
}

export function report(r: ReturnType<typeof clearance>): string {
  const mm = (x: number) => `${Math.round(x * 1000)} mm`, state = (depth: number, gap: number) => (depth > 1e-3 ? `overlap ${mm(depth)}` : gap >= REACH ? `gap over ${mm(REACH)}` : `gap ${mm(gap)}`);
  const unit = (id: string, v: number) => { const j = r.joints.find((q) => q.id === id); return j?.type === "revolute" ? `${((v * 180) / Math.PI).toFixed(1)} deg` : `${v.toFixed(3)} m`; };
  const L = [`# ${r.asset}: clearance at the joint limits`, "", `Build ${r.sha256.slice(0, 12)}. Pass 1: each joint at its lower and at its upper limit, the others neutral. Pass 2: ${r.cornerPoses} corner poses (every joint at one of its limits). Smallest gap wanted ${mm(r.min)}; sampled every ${mm(STEP)}.`, "", `**What this cannot see:** ${CANNOT_SEE}. A limit that was set from this tool's own solver cannot fail here and is not evidence of the object's range.`, ""];
  L.push(r.findings.length ? `## Pass 1, made worse by one joint (${r.findings.length})` : "## Pass 1, made worse by one joint: nothing", "");
  if (r.findings.length) { L.push("| Joint | At | Moving part | Fixed part | At the limit | At rest |", "|---|---|---|---|---|---|"); for (const f of r.findings) L.push(`| ${f.joint}${f.locked ? " (locked)" : ""} | ${f.end} ${unit(f.joint, f.value)} | ${f.a} | ${f.b} | ${state(f.depth, f.gap)} | ${state(f.rest_depth, f.rest_gap)} |`); L.push(""); }
  L.push(r.corners.length ? `## Pass 2, made worse by joints in combination (${r.corners.length} pairs, each at its worst corner)` : "## Pass 2, made worse by joints in combination: nothing", "");
  if (r.corners.length) { L.push("| Part | Part | At the corner | At rest | Joints displaced | Involves a locked joint |", "|---|---|---|---|---|---|"); for (const f of r.corners) L.push(`| ${f.a} | ${f.b} | ${state(f.depth, f.gap)} | ${state(f.rest_depth, f.rest_gap)} | ${Object.entries(f.pose).map(([id, v]) => `${id} ${unit(id, v)}`).join(", ")} | ${f.locked ? "yes" : "no"} |`); L.push(""); }
  if (r.watch.length) { L.push("## Watched pairs: smallest gap", "", "| Between | And | Pose | Smallest gap | Closest parts |", "|---|---|---|---|---|"); for (const w of r.watch) L.push(`| ${w.sets[0]} | ${w.sets[1]} | ${w.pose} | ${w.gap < 0 ? `OVERLAP ${mm(-w.gap)}` : w.gap >= 0.5 ? "over 500 mm" : mm(w.gap)} | ${w.a} / ${w.b} |`); L.push(""); }
  L.push(`## Near or inside one another at rest, among the pairs pass 1 looked at (${r.atRest.length}; by design unless listed above)`, "");
  for (const p of r.atRest) L.push(`- ${p.a} / ${p.b}: ${p.depth > 1e-3 ? `one inside the other by up to ${mm(p.depth)}` : `gap ${mm(p.gap)}`}`);
  return L.join("\n") + "\n";
}

if (import.meta.main) {
  const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const asset = opt("--asset") ?? "rig-b", dir = opt("--build") ? join(ROOT, "work", opt("--build")!, "build") : join(ROOT, "assets", asset, "build"), min = Number(opt("--min") ?? 0.02);
  const all = JSON.parse(readFileSync(join(dir, `${asset}.manifest.json`), "utf8")).joints as any[], spec = Bun.TOML.parse(readFileSync(join(ROOT, "assets", asset, "spec", "rig.toml"), "utf8")) as any;
  if (opt("--gap")) {
    const [a, b] = opt("--gap")!.split(":"), pose: Record<string, number> = {};
    for (const e of (opt("--pose") ?? "").split(",").filter(Boolean)) { const [id, v] = e.split(":"), j = all.find((x) => x.id === id); if (!j) { console.error(`no joint ${id}`); process.exit(1); } pose[id] = j.type === "revolute" ? (Number(v) * Math.PI) / 180 : Number(v); }
    const g = clearance(dir, asset, { min, corners: false, only: "-" }).gapAt(a, b, pose);
    console.log(`${opt("--pose") ?? "neutral"}: ${g.gap < 0 ? `OVERLAP ${Math.round(-g.gap * 1000)} mm` : `smallest gap ${Math.round(g.gap * 1000)} mm`} (${g.pair})`);
  } else if (opt("--solve")) {
    const id = opt("--solve")!, j = all.find((x: any) => x.id === id);
    if (!j) { console.error(`no joint ${id}`); process.exit(1); }
    const end = (opt("--end") ?? "upper") as "lower" | "upper", others = all.filter((x) => typeof x.neutral === "number" && !x.locked && x.id !== id).map((x) => x.id);
    const clean = (v: number) => { const r = clearance(dir, asset, { min, limit: { [id]: v }, only: id, end, corners: false }); if (r.findings.length) return false; if (!others.length) return true;
      // corners: this joint at v, the other unlocked joints at every combination of their limits
      const c = clearance(dir, asset, { min, limit: { [id]: v }, end, only: "-", corners: [id, ...others] }); return !c.corners.some((f) => f.pose[id] !== undefined && Math.abs(f.pose[id] - v) < 1e-9); };
    let ok = j.neutral as number, bad = j[end] as number;
    if (clean(bad)) ok = bad; else for (let k = 0; k < 10; k++) { const mid = (ok + bad) / 2; if (clean(mid)) ok = mid; else bad = mid; }
    const show = (v: number) => (j.type === "revolute" ? `${((v * 180) / Math.PI).toFixed(1)} deg` : `${v.toFixed(3)} m`);
    console.log(`${id}: farthest ${end} value with every gap at least ${Math.round(min * 1000)} mm or no worse than at rest, with ${others.length} other unlocked joint(s) at every combination of their limits: ${show(ok)} (neutral ${show(j.neutral)}, limit tried ${show(j[end])}). An output of this tool on the model's geometry, not evidence of the object's range.`);
  } else {
    const r = clearance(dir, asset, { min, watch: spec.clearance?.watch }), text = report(r);
    if (opt("--md")) writeFileSync(opt("--md")!, text); if (opt("--json")) writeFileSync(opt("--json")!, JSON.stringify({ ...r, gapAt: undefined }, null, 1));
    console.log(text);
    process.exit(r.findings.some((f) => !f.locked) || r.corners.some((f) => !f.locked) ? 1 : 0);
  }
}
