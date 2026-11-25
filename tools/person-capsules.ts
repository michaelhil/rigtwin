// bun tools/person-capsules.ts [--lab <avatar-lab packages dir>] [--samples 320] [--check]
//
// The body's collision capsules for ANY shape (owner: MV-rig). The lab measured capsules on the mesh of each baked person
// (work/avatar-lab/pipeline/motion.py cmd_fit with mo_bodies.proxies: trunk sections every 50 mm as horizontal stadium
// capsules on the spine joints, tapered thigh capsules, arm radii); a slider body or a preset that is not a baked person had
// none. This tool runs the same measurement, ported, on the full clay body of each sex (the lab's uncompressed body-clay
// packages: the same shape model, joint deltas and fits as assets/manikin/{clay,operator}-{m,f}, checked below) for a few
// hundred shapes across the controls' ranges, and fits each measured number as a linear function of the 40 shape-target
// weights, as the joint deltas are. The result, viewer/src/person/body-capsules.json, lets viewer/src/person/body-fit.ts
// give capsules for any body from its weights alone (browser and server, no mesh). --check only re-measures and compares.
//
// Mac-only like the rest of the manikin build: it reads the lab's packages under work/ (not committed); its output is.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readPackage, bodyOf } from "../shared/person-model.ts";
import { MODEL_STATIONS as ST } from "../viewer/src/person/body-fit.ts";

const args = process.argv.slice(2), opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LAB = opt("--lab", join(import.meta.dir, "..", "..", "rigtwin", "work", "avatar-lab", "packages"));
const SAMPLES = Number(opt("--samples", "320")), OUT = join(import.meta.dir, "..", "viewer", "src", "person", "body-capsules.json");
const PRODUCT = join(import.meta.dir, "..", "assets", "manikin");

// ---- small helpers --------------------------------------------------------------------------------------------------------
type V = number[];
const pct = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q / 100, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };   // numpy's linear percentile
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ---- one package: rows (shape-file vertices) with their dominant joint -----------------------------------------------------
function loadLab(id: string) {
  const dir = join(LAB, id), manifest = JSON.parse(readFileSync(join(dir, `${id}.avatar.json`), "utf8")), glb = new Uint8Array(readFileSync(join(dir, `${id}.glb`)));
  const pkg = readPackage(id, manifest, glb);
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength), jl = dv.getUint32(12, true), gl = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl))), bin = 20 + jl + 8;
  const view = (ai: number) => { const a = gl.accessors[ai], bv = gl.bufferViews[a.bufferView], o = glb.byteOffset + bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), n = a.count * ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as any)[a.type];
    return a.componentType === 5126 ? new Float32Array(glb.buffer, o, n) : a.componentType === 5121 ? new Uint8Array(glb.buffer, o, n) : new Uint16Array(glb.buffer, o, n); };
  const node = gl.nodes.find((n: any) => n.name === "body" && n.mesh !== undefined), pr = gl.meshes[node.mesh].primitives[0], skin = gl.skins[node.skin];
  const J = view(pr.attributes.JOINTS_0), W = view(pr.attributes.WEIGHTS_0), SRC = view(pr.attributes._SRC);
  const bake = [manifest.shape.bake].flat()[0], N = bake.vertices, K = bake.targets.length, raw = readFileSync(join(dir, bake.file));
  if (bake.encoding) throw new Error(`${id}: expected the lab's raw shape file`);
  const base = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + N * 12)), deltas = new Int16Array(raw.buffer.slice(raw.byteOffset + N * 12, raw.byteOffset + N * 12 + K * N * 6));
  // the lab measured the body MESH's vertices (motion.py load_package_mesh: rows repeated at UV seams via _SRC, each with its own
  // dominant joint), so the same vertex set is used here: mesh vertex v sits at shape row SRC[v]
  const jointName = skin.joints.map((j: number) => gl.nodes[j].name as string), dom: string[] = [], src: number[] = [];
  for (let v = 0; v < SRC.length; v++) { let best = 0; for (let k = 1; k < 4; k++) if (W[v * 4 + k] > W[v * 4 + best]) best = k; dom.push(jointName[J[v * 4 + best]]); src.push(Math.round(SRC[v])); }
  const scales = bake.targetScale ?? bake.targets.map(() => 1);
  return { id, manifest, pkg, N, K, targets: bake.targets as string[], base, deltas, scales, dom, src };
}
type Lab = ReturnType<typeof loadLab>;
function positions(L: Lab, w: Record<string, number>) {
  const R = Float32Array.from(L.base), n3 = L.N * 3, P = new Float32Array(L.src.length * 3);
  L.targets.forEach((t, k) => { const f = (w[t] ?? 0) * L.scales[k] / 32767; if (f) for (let i = 0; i < n3; i++) R[i] += f * L.deltas[k * n3 + i]; });
  L.src.forEach((r, v) => { P[v * 3] = R[r * 3]; P[v * 3 + 1] = R[r * 3 + 1]; P[v * 3 + 2] = R[r * 3 + 2]; });
  return P;
}

// ---- the measurement (mo_bodies.proxies and motion.py cmd_fit, ported) ------------------------------------------------------
const TORSO = ["pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05"];
// the side of the chest at armpit height belongs to the packages' armpit helper joints, which the lab's bake predates: it is
// trunk skin all the same (without it the sections there come out 10 mm narrower than the baked ones). The other helpers
// (belly, buttock, groin) are left out: with them the lowest sections fit the shapes badly (up to 80 mm).
const HELPERS = ["armpit_chest_l", "armpit_chest_r"];
const TRUNK = [...TORSO, ...HELPERS];
/** Every measured number of one body, in the fixed order of `names(K)`. */
function measure(L: Lab, P: Float32Array, at: (n: string) => V, K: number) {
  const out: number[] = [], N = L.src.length, dom = L.dom, y0 = Math.min(at("thigh_l")[1], at("thigh_r")[1]) - ST.torso_below_hip, y1 = at("neck_01")[1];
  for (let k = 0; k < K; k++) {
    const yc = y0 + (y1 - y0) * k / (K - 1), xs: number[] = [], zs: number[] = [];
    for (let v = 0; v < N; v++) if (TRUNK.includes(dom[v]) && Math.abs(P[v * 3 + 1] - yc) < ST.slice_half_height) { xs.push(Math.abs(P[v * 3])); zs.push(P[v * 3 + 2]); }
    if (zs.length < ST.slice_min_points) { out.push(NaN, NaN, NaN); continue; }
    const zlo = pct(zs, 1), zhi = pct(zs, 99);
    out.push((zlo + zhi) / 2, pct(xs, 98), (zhi - zlo) / 2);
  }
  const radii = (a: string, b: string, joints: string[], ts: readonly number[], q: number) => {
    const A = at(a), B = at(b), L_ = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), ax = [(B[0] - A[0]) / L_, (B[1] - A[1]) / L_, (B[2] - A[2]) / L_];
    const set = new Set(joints.flatMap((j) => [j, `${j.slice(0, -2)}_twist_01${j.slice(-2)}`, `${j.slice(0, -2)}_twist_02${j.slice(-2)}`])), T: number[] = [], R: number[] = [];
    for (let v = 0; v < N; v++) if (set.has(dom[v])) { const d = [P[v * 3] - A[0], P[v * 3 + 1] - A[1], P[v * 3 + 2] - A[2]], s = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]; T.push(s / L_); R.push(Math.hypot(d[0] - s * ax[0], d[1] - s * ax[1], d[2] - s * ax[2])); }
    return ts.map((tc) => { const r = R.filter((_, i) => Math.abs(T[i] - tc) < ST.radius_window); return r.length >= 6 ? pct(r, q) : NaN; });
  };
  for (const s of ["l", "r"]) {
    out.push(...radii(`thigh_${s}`, `calf_${s}`, [`thigh_${s}`, "pelvis"], ST.thigh, 90));
    out.push(...radii(`calf_${s}`, `foot_${s}`, [`calf_${s}`], ST.calf, 90));
    out.push(...radii(`upperarm_${s}`, `lowerarm_${s}`, [`upperarm_${s}`, `upperarm_twist_02_${s}`], ST.upperarm, 90));
    out.push(...radii(`lowerarm_${s}`, `hand_${s}`, [`lowerarm_${s}`, `lowerarm_twist_02_${s}`], ST.lowerarm, 90));
    const h = at(`hand_${s}`), ia = at(`index_01_${s}`), pa = at(`pinky_01_${s}`), a = [ia[0] - h[0], ia[1] - h[1], ia[2] - h[2]], b = [pa[0] - h[0], pa[1] - h[1], pa[2] - h[2]];
    let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; const nl = Math.hypot(n[0], n[1], n[2]); n = n.map((x) => x / nl);
    const hand = new Set([`hand_${s}`, ...["index", "middle", "ring", "pinky"].map((f) => `${f}_metacarpal_${s}`)]), th: number[] = [];
    const foot = new Set([`foot_${s}`, `ball_${s}`]), fz: number[] = [];
    for (let v = 0; v < N; v++) { if (hand.has(dom[v])) th.push((P[v * 3] - h[0]) * n[0] + (P[v * 3 + 1] - h[1]) * n[1] + (P[v * 3 + 2] - h[2]) * n[2]); if (foot.has(dom[v])) fz.push(P[v * 3 + 2]); }
    out.push((pct(th, 97) - pct(th, 3)) / 2, at(`foot_${s}`)[2] - Math.min(...fz));
  }
  return out;
}
const names = (K: number) => [...Array.from({ length: K }, (_, k) => [`torso_${k}.cz`, `torso_${k}.hx`, `torso_${k}.hz`]).flat(),
  ...["l", "r"].flatMap((s) => [...ST.thigh.map((_, i) => `thigh_${s}.${i}`), ...ST.calf.map((_, i) => `calf_${s}.${i}`), ...ST.upperarm.map((_, i) => `upperarm_${s}.${i}`), ...ST.lowerarm.map((_, i) => `lowerarm_${s}.${i}`), `hand_${s}.half_thickness`, `foot_${s}.heel_back`])];

// ---- least squares: y = c0 + sum c_t w_t --------------------------------------------------------------------------------------
function solve(A: number[][], b: number[]): number[] {          // normal equations with a tiny ridge, Gaussian elimination with pivoting
  const n = A[0].length, M = Array.from({ length: n }, (_, i) => { const r = new Array(n + 1).fill(0); for (const [k, row] of A.entries()) { for (let j = 0; j < n; j++) r[j] += row[i] * row[j]; r[n] += row[i] * b[k]; } r[i] += 1e-9; return r; });
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; } }
  return M.map((r, i) => r[n] / r[i]);
}

// ---- run ------------------------------------------------------------------------------------------------------------------------
const result: any = { note: "Collision capsules of the manikin for any body shape: each measured number (trunk sections, limb radii, palm thickness, heel) as c[0] + sum c[1 + i] * weight[targets[i]], fitted by tools/person-capsules.ts on the lab's clay bodies. Read by viewer/src/person/body-fit.ts.", stations: ST, models: {} };
const report: string[] = [];
for (const [sex, lab, products] of [["m", "body-clay", ["clay-m", "operator-m"]], ["f", "body-clay-f", ["clay-f", "operator-f"]]] as const) {
  const L = loadLab(lab), sh = L.manifest.shape;
  for (const p of products) { const f = join(PRODUCT, p, `${p}.avatar.json`); if (!existsSync(f)) continue; const m = JSON.parse(readFileSync(f, "utf8"));
    if (JSON.stringify(m.shape.model) !== JSON.stringify(sh.model) || JSON.stringify(m.shape.jointDeltas) !== JSON.stringify(sh.jointDeltas)) throw new Error(`${p}: its shape model differs from ${lab}'s; rebuild the capsules from it`); }
  const bodyAt = (values: Record<string, number>) => { const b = bodyOf(L.pkg, values), ix = new Map(b.rest.names.map((n, i) => [n, i])); return { b, at: (n: string) => b.rest.pos[ix.get(n)!] }; };
  const def = bodyAt({}), K = 1 + Math.round((def.at("neck_01")[1] - (Math.min(def.at("thigh_l")[1], def.at("thigh_r")[1]) - ST.torso_below_hip)) / ST.slice_step);
  const controls = sh.controls as any[], ids = Object.keys(sh.model.targets);
  const shapes: Record<string, number>[] = [{}, ...Object.values<any>(L.manifest.packet?.persons ?? {}), ...(sh.presets ?? []).map((p: any) => p.values)];
  // bodies across the controls: stature over its whole range, weight from a body-mass index between the bounds, the build and
  // proportion controls within the stated standard deviations (a 2 m tall person of 34 kg is not a body anyone sets)
  const [bmiLo, bmiHi] = ST.sample_bmi;
  while (shapes.length < SAMPLES) {
    const v: Record<string, number> = Object.fromEntries(controls.map((c) => [c.id, c.unit === "SD" ? (rnd() * 2 - 1) * ST.sample_sd : c.min + (c.max - c.min) * rnd()]));
    const st = v.stature / 1000, mc = controls.find((c) => c.id === "mass"); if (mc) v.mass = Math.min(mc.max, Math.max(mc.min, (bmiLo + (bmiHi - bmiLo) * rnd()) * st * st));
    shapes.push(v);
  }
  // measure every shape at all K sections; keep the sections that have skin on every shape (the lab dropped a section with
  // fewer than its minimum of points, which happens below the waist, where the helper joints hold the buttock's skin)
  const rawX: number[][] = [], rawY: number[][] = [];
  for (const v of shapes) { const { b, at } = bodyAt(v); rawX.push([1, ...ids.map((t) => b.weights[t])]); rawY.push(measure(L, positions(L, b.weights), at, K)); }
  const all = names(K), keepSlice = Array.from({ length: K }, (_, k) => k < K - 1 && rawY.every((y) => Number.isFinite(y[3 * k])));   // not the one at the neck joint itself (a thin ring of neck skin)
  const cols = all.map((n, j) => j).filter((j) => j >= 3 * K || keepSlice[Math.floor(j / 3)]);
  const X: number[][] = [], Y: number[][] = [];
  rawY.forEach((y, i) => { const r = cols.map((j) => y[j]); if (r.every(Number.isFinite)) { X.push(rawX[i]); Y.push(r); } });
  if (Y.length < rawY.length) report.push(`${sex}: ${rawY.length - Y.length} shapes left out (a limb station without skin)`);
  const fractions = keepSlice.map((k, i) => (k ? i / (K - 1) : -1)).filter((f) => f >= 0);
  const nm = cols.map((j) => all[j]).map((n) => n.replace(/^torso_(\d+)\./, (_, k) => `torso_${fractions.indexOf(Number(k) / (K - 1))}.`)), coef = nm.map((_, j) => solve(X, Y.map((r) => r[j])));
  let worst = 0, worstName = "", rms = 0;
  Y.forEach((y, i) => y.forEach((v, j) => { const e = Math.abs(coef[j].reduce((s, c, k) => s + c * X[i][k], 0) - v); rms += e * e; if (e > worst) { worst = e; worstName = nm[j]; } }));
  rms = Math.sqrt(rms / (Y.length * nm.length));
  if (args.includes("--debug")) { const per = nm.map((n, j) => [n, Math.max(...Y.map((y, i) => Math.abs(coef[j].reduce((s, c, k) => s + c * X[i][k], 0) - y[j])))] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 8); console.log(sex, per.map(([n, e]) => `${n} ${(e * 1000).toFixed(1)}`).join("; ")); }
  if (args.includes("--explain")) for (const [pid, v] of Object.entries<any>(L.manifest.packet?.persons ?? {})) {
    const { b, at } = bodyAt(v), y = measure(L, positions(L, b.weights), at, K), x = [1, ...ids.map((t) => b.weights[t])];
    console.log(pid, cols.map((j, c) => `${nm[c]} ${(y[j] * 1000).toFixed(0)}/${(coef[c].reduce((s, q, k) => s + q * x[k], 0) * 1000).toFixed(0)}`).filter((t) => t.includes("hx") || t.includes("thigh")).join(" "));
  }
  report.push(`${sex}: ${Y.length} shapes, ${nm.length} numbers, ${fractions.length} of ${K} trunk sections kept; fit residual rms ${(rms * 1000).toFixed(2)} mm, worst ${(worst * 1000).toFixed(2)} mm (${worstName})`);
  result.models[sex] = { from: `${lab} (lab), the same body as ${products.join(" and ")}`, fractions: fractions.map((f) => Math.round(f * 1e6) / 1e6), targets: ids, outputs: nm, coef: coef.map((c) => c.map((x) => Math.round(x * 1e6) / 1e6)), residual_rms_m: Math.round(rms * 1e5) / 1e5, residual_worst_m: Math.round(worst * 1e5) / 1e5, shapes: Y.length };
}
console.log(report.join("\n"));
if (!args.includes("--check")) { writeFileSync(OUT, JSON.stringify(result)); console.log(`written ${OUT}`); }
