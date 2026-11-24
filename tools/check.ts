// bun run check [--fast] [--workspace <name>]
// Runs every check of the build brief (section 10) and exits non-zero if one fails.
// --fast skips the checks that need the headless browser (projection self-test, frame rate, the live viewer).
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { ROOT, timeline } from "./timeline.ts";
import { build } from "../generator/build.ts";
import { loadSpec, NAME_PATTERN } from "../generator/assemble.ts";
import { poseFromRest, type JointValue, type Trs } from "../shared/pose.ts";
import { matFromQuat } from "../shared/math.ts";
import type { Manifest } from "../shared/manifest.ts";

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const fast = args.includes("--fast"), workspace = opt("--workspace") ?? process.env.RIGTWIN_WORKSPACE, asset = "rig-b";
const BUDGET = { triangles: 150000, bytes: 4_000_000, primitives: 80, fps: 55 };
const t0 = performance.now();
let failures = 0, warnings = 0;
const report = (ok: boolean | "warn", name: string, summary: string, details: string[] = []) => {
  if (ok === false) failures++; if (ok === "warn") warnings++;
  console.log(`${ok === true ? "ok  " : ok === "warn" ? "warn" : "FAIL"} ${name}: ${summary}`);
  for (const d of details.slice(0, 15)) console.log("       " + d);
  if (details.length > 15) console.log(`       … and ${details.length - 15} more`);
};
const glob = (pattern: string) => new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");

// ---- 1. type check ---------------------------------------------------------------------------------
{
  const r = spawnSync(join(ROOT, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", ROOT], { encoding: "utf8" });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, "types", r.status === 0 ? "tsc --noEmit clean (generator, shared, server, viewer, tools, asset sources)" : `${lines.filter((l) => l.includes("error TS")).length} type error(s)`, r.status === 0 ? [] : lines);
}

{
  const r = spawnSync("bun", ["test", join(ROOT, "generator")], { encoding: "utf8", cwd: ROOT });
  const out = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, "kit tests", r.status === 0 ? (out.find((l) => /\bpass\b/.test(l)) ?? "").trim() + " (known-answer tests of the geometry kit, expressions and pose function)" : "bun test generator failed", r.status === 0 ? [] : out.filter((l) => /fail|error|expect/i.test(l)));
}

// command layer and server (step 1 of the platform): unit tests, then the integration test over real HTTP
for (const [name, dir, what] of [
  ["commands", "shared/commands", "validation, units, limits, per-joint stale check, undo, history cap, rebuilt asset, scene.find, measure.distance"],
  ["server", "server", "two live clients over HTTP, stale refusal, undo by group, resume, restart, view routing, deployed guards, author ids, Host check"],
  ["live client", "viewer/src", "reconnect rules: backoff, one resync, wakes, no reconnect after disconnect (Leitbild's cases)"],
] as const) {
  const r = spawnSync("bun", ["test", join(ROOT, dir)], { encoding: "utf8", cwd: ROOT });
  const out = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, name, r.status === 0 ? `${(out.find((l) => /^\s*\d+ pass\b/.test(l)) ?? "").trim()} (${what})` : `bun test ${dir} failed`, r.status === 0 ? [] : out.filter((l) => /\(fail\)|error|expect/i.test(l)));
}

// the server must never show error pages with code to visitors (R3b F4; security review S10)
{
  const src = readFileSync(join(ROOT, "server", "server.ts"), "utf8"), serve = src.slice(src.indexOf("Bun.serve({"), src.indexOf("Bun.serve({") + 600);
  const ok = serve.includes("development: false") && !/development:\s*true/.test(src);
  report(ok, "server options", ok ? "server/server.ts passes development: false to Bun.serve" : "server/server.ts must pass development: false to Bun.serve (no error pages with code)");
}
// the setup script's harness (deploy/setup-server.sh against a stand-in host; about 9 s, no root, no network)
{
  const r = spawnSync("bash", [join(ROOT, "tools", "deploy-tests", "setup-server.test.sh")], { encoding: "utf8", cwd: ROOT });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, "setup script", (lines.find((l) => /^setup-server.sh test: \d+ passed/.test(l)) ?? "no summary").replace(/ \(logs in .*\)$/, "") + " (check, apply, undo, probe, restore after a hang-up or a closed output)", r.status === 0 ? [] : lines.filter((l) => l.includes("FAIL")));
}

// ---- 2. parameters, spec, build (a failure here stops the run) -------------------------------------
let manifest: Manifest, glbPath: string, sha: string;
const spec = loadSpec(join(ROOT, "assets", asset, "spec"));
try {
  const res = await build({ asset, workspace, quiet: true });
  if (!res.ok) { report(false, "build", "component errors", res.messages); process.exit(1); }
  manifest = res.manifest; glbPath = res.glbPath; sha = res.sha256;
  const cc = manifest.parameter_class_counts;
  report(true, "parameters", `${Object.keys(manifest.parameters).length} complete records (${Object.entries(cc).map(([k, n]) => `${k} ${n}`).join(", ")})`);
  const warn = res.messages.filter((m) => m.startsWith("warning: ") && !m.includes(" missing: "));
  if (warn.length) report("warn", "parameters", `${warn.length} warning(s)`, warn.map((w) => w.slice(9)));
  if (manifest.parameters_unused.length) report("warn", "parameters", `${manifest.parameters_unused.length} record(s) read by nothing`, [manifest.parameters_unused.join(", ")]);
  report(true, "build", `${res.seconds.toFixed(2)} s`);
} catch (e: any) { report(false, "parameters / build", String(e.message).split("\n")[0], String(e.message).split("\n").slice(1)); process.exit(1); }

// ---- 3. determinism: a second build in a separate process must give the same bytes -------------------
{
  const dir = mkdtempSync(join(tmpdir(), "rigtwin-check-"));
  const r = spawnSync("bun", [join(ROOT, "generator", "build.ts"), "--asset", asset, "--out", dir, "--quiet", "--no-timeline"], { encoding: "utf8" });
  const sha2 = r.status === 0 ? createHash("sha256").update(readFileSync(join(dir, `${asset}.glb`))).digest("hex") : "";
  const m2 = r.status === 0 ? readFileSync(join(dir, `${asset}.manifest.json`), "utf8") : "", m1 = readFileSync(join(glbPath, "..", `${asset}.manifest.json`), "utf8");
  rmSync(dir, { recursive: true, force: true });
  report(sha2 === sha && m1 === m2, "determinism", sha2 === sha && m1 === m2 ? `two builds, same SHA-256 ${sha.slice(0, 16)}… and identical manifest` : r.status !== 0 ? "second build failed" : sha2 !== sha ? `GLB differs: ${sha.slice(0, 16)}… vs ${sha2.slice(0, 16)}…` : "manifest differs between builds", r.status !== 0 ? [r.stderr] : []);
}

// ---- 4. independent reader -------------------------------------------------------------------------
const testPoses: Record<string, JointValue[]> = {};
for (const j of manifest.joints) {
  const mid = (a: number, b: number, t: number) => a + (b - a) * t;
  testPoses[j.id] = j.type === "ball"
    ? [j.neutral, (j.neutral as number[]).map((n, i) => n + [j.upper, j.lower, j.upper * 0.5][i]), (j.neutral as number[]).map((n, i) => n + [j.lower * 0.3, j.upper * 0.7, j.lower][i])]
    : [j.lower, j.upper, j.neutral, mid(j.lower, j.upper, 0.37), mid(j.lower, j.upper, 0.81)];
}
const posesFile = join(tmpdir(), `rigtwin-poses-${process.pid}.json`);
writeFileSync(posesFile, JSON.stringify(testPoses));
const py = spawnSync("python3", ["-I", join(ROOT, "tools", "glb_inspect.py"), glbPath, "--poses", posesFile], { encoding: "utf8", maxBuffer: 1 << 28 });
rmSync(posesFile, { force: true });
if (py.status !== 0) { report(false, "independent reader", "tools/glb_inspect.py could not read the GLB", [py.stderr.trim()]); process.exit(1); }
const glb = JSON.parse(py.stdout) as { bytes: number; root: string; root_rotation: number[]; totals: Record<string, number>; counts: Record<string, number>; nodes: { name: string; parent: string | null; extras: any; origin: number[]; mesh?: any }[]; joints: { name: string; joint: any; moved: string[]; rest: number[][]; posed?: { value: JointValue; matrix: number[][] }[] }[] };
const node = new Map(glb.nodes.map((n) => [n.name, n]));
report(true, "independent reader", `${glb.counts.nodes} nodes, ${glb.counts.meshes} meshes, ${glb.totals.triangles} triangles re-read by tools/glb_inspect.py (Python, no shared code)`);

// ---- 5. names --------------------------------------------------------------------------------------
{
  const bad = glb.nodes.filter((n) => !NAME_PATTERN.test(n.name ?? "")).map((n) => `${n.name}: does not match ${NAME_PATTERN.source}`);
  const seen = new Set<string>(), dup = glb.nodes.filter((n) => (seen.has(n.name) ? true : (seen.add(n.name), false))).map((n) => `${n.name}: used twice`);
  const noId = glb.nodes.filter((n) => n.extras?.id !== n.name).map((n) => `${n.name}: extras.id is '${n.extras?.id}'`);
  report(!bad.length && !dup.length && !noId.length, "names", bad.length + dup.length + noId.length ? "invalid node names" : `${glb.nodes.length} node names valid, unique, equal to extras.id`, [...bad, ...dup, ...noId]);
}

// ---- 6. coverage -----------------------------------------------------------------------------------
{
  const omitted = new Map(manifest.omitted.map((o) => [o.id, o.reason])), problems: string[] = [];
  let withMesh = 0, total = 0;
  for (const [id, n] of Object.entries(spec.nodes)) {
    total++;
    const g = node.get(id);
    if (!g) { problems.push(`${id} missing: in tree, not in GLB`); continue; }
    const expectedParent = n.joints?.length ? n.joints[n.joints.length - 1] : n.parent ?? null;
    if (g.parent !== expectedParent) problems.push(`${id}: parent in GLB is ${g.parent}, spec says ${expectedParent}`);
    if (id.startsWith("D_") || n.assembly) continue;
    if (g.mesh?.triangles > 0) { withMesh++; if (omitted.has(id)) problems.push(`${id}: has a mesh but is also listed as omitted`); }
    else if (omitted.has(id)) { if (!omitted.get(id)!.trim()) problems.push(`${id}: omitted without a reason`); }
    else problems.push(`${id} missing: in tree, not in GLB, not in omitted`);
  }
  for (const j of Object.keys(spec.joints)) if (!node.get(j)?.extras?.joint) problems.push(`${j} missing: joint in spec, no joint node in GLB`);
  for (const n of glb.nodes) if (!spec.nodes[n.name] && !spec.joints[n.name]) problems.push(`${n.name}: in GLB, not in the spec`);
  report(!problems.length, "coverage", problems.length ? `${problems.length} problem(s)` : `${total} tree nodes and ${Object.keys(spec.joints).length} joints present; ${withMesh} components with geometry; ${omitted.size} omitted with a reason`, problems);
}

// ---- 7. left / right -------------------------------------------------------------------------------
{
  const single = new Set(spec.symmetry?.single ?? []), free = new Set(spec.symmetry?.free ?? []), problems: string[] = [];
  const ids = [...Object.keys(spec.nodes), ...Object.keys(spec.joints)];
  let pairs = 0;
  for (const id of ids) {
    const m = /_(L|R)(?=_|$)/.exec(id);
    if (!m) continue;
    const other = id.slice(0, m.index) + (m[1] === "L" ? "_R" : "_L") + id.slice(m.index + 2);
    if (!ids.includes(other)) { if (!single.has(id)) problems.push(`${id}: no counterpart ${other} in the spec (list it under [symmetry] single if intended)`); continue; }
    if (m[1] !== "L") continue;
    pairs++;
    const a = node.get(id), b = node.get(other);
    if (!a || !b) { problems.push(`${!a ? id : other} missing from the GLB while its counterpart exists`); continue; }
    if (!!a.mesh?.triangles !== !!b.mesh?.triangles) problems.push(`${id} / ${other}: only one of the pair has geometry`);
    if (!free.has(id) && Math.hypot(a.origin[0] - b.origin[0], a.origin[1] + b.origin[1], a.origin[2] - b.origin[2]) > 1e-5) problems.push(`${id} at (${a.origin}) and ${other} at (${b.origin}) are not mirror images`);
    if (!free.has(id) && a.mesh && b.mesh) {
      const d = Math.max(...[0, 1, 2].map((k) => (k === 1 ? Math.max(Math.abs(a.mesh.model_min[1] + b.mesh.model_max[1]), Math.abs(a.mesh.model_max[1] + b.mesh.model_min[1])) : 0)));
      if (d > 0.002 && Math.abs(a.mesh.model_max[1] - a.mesh.model_min[1] - (b.mesh.model_max[1] - b.mesh.model_min[1])) > 0.002) problems.push(`${id} / ${other}: widths differ (${(a.mesh.model_max[1] - a.mesh.model_min[1]).toFixed(4)} vs ${(b.mesh.model_max[1] - b.mesh.model_min[1]).toFixed(4)} m)`);
      else if (d > 0.002) problems.push(`${id} / ${other}: geometry is not mirrored across Y = 0 (bounds differ by ${d.toFixed(4)} m; mirror the left mesh with kit.mirrorY)`);
    }
  }
  report(!problems.length, "left/right", problems.length ? `${problems.length} problem(s)` : `${pairs} pairs present and mirrored; ${single.size} declared single-sided`, problems);
}

// ---- 8. geometry -----------------------------------------------------------------------------------
{
  const problems: string[] = [];
  for (const n of glb.nodes) if (n.mesh) {
    const m = n.mesh;
    if (m.non_finite) problems.push(`${n.name}: ${m.non_finite} non-finite value(s)`);
    if (m.degenerate) problems.push(`${n.name}: ${m.degenerate} zero-area triangle(s)`);
    if (m.bad_normals) problems.push(`${n.name}: ${m.bad_normals} normal(s) not unit length`);
    if (m.index_out_of_range) problems.push(`${n.name}: ${m.index_out_of_range} triangle(s) index past the vertex count`);
    if (!m.triangles) problems.push(`${n.name}: mesh with no triangles`);
    if (n.extras?.kind === "surface" && m.has_uv.some((u: boolean) => !u)) problems.push(`${n.name}: surface without UVs`);
  }
  const c = (a: number, b: number) => (a === b ? null : `${a} vs ${b}`);
  for (const [what, d] of [["triangles", c(glb.totals.triangles, manifest.totals.triangles)], ["bytes", c(glb.bytes, manifest.glb.bytes)], ["primitives", c(glb.totals.primitives, manifest.totals.primitives)]] as const) if (d) problems.push(`manifest and GLB disagree on ${what}: ${d}`);
  const q = glb.root_rotation ?? [0, 0, 0, 1];
  if (Math.abs(q[0] + Math.SQRT1_2) > 1e-5 || Math.abs(q[3] - Math.SQRT1_2) > 1e-5) problems.push(`root rotation is ${q}; expected the Z-up to Y-up conversion (-0.7071, 0, 0, 0.7071)`);
  report(!problems.length, "geometry", problems.length ? `${problems.length} problem(s)` : `all ${glb.counts.meshes} meshes finite, no zero-area triangles, unit normals; manifest matches the GLB`, problems);
}

// ---- 9. glTF validator -----------------------------------------------------------------------------
{
  const validator = createRequire(import.meta.url)("gltf-validator");
  const rep = await validator.validateBytes(new Uint8Array(readFileSync(glbPath)), { maxIssues: 200 });
  const msgs = rep.issues.messages.filter((m: any) => m.severity <= 1).map((m: any) => `${m.code} ${m.pointer ?? ""}: ${m.message}`);
  report(rep.issues.numErrors === 0 && rep.issues.numWarnings === 0, "glTF validator", `${rep.issues.numErrors} errors, ${rep.issues.numWarnings} warnings, ${rep.issues.numInfos} infos, ${rep.issues.numHints} hints`, msgs);
}

// ---- 10. expected motion ---------------------------------------------------------------------------
{
  const problems: string[] = [], movable = glb.nodes.filter((n) => /^[CDS]_/.test(n.name)).map((n) => n.name);
  for (const j of glb.joints) {
    const pats = (spec.motion[j.name] ?? []).map(glob), want = new Set(movable.filter((n) => pats.some((p) => p.test(n)))), got = new Set(j.moved.filter((n) => /^[CDS]_/.test(n)));
    const extra = [...got].filter((n) => !want.has(n)), lacking = [...want].filter((n) => !got.has(n));
    if (extra.length) problems.push(`${j.name}: moves ${extra.join(", ")} which the motion table does not list`);
    if (lacking.length) problems.push(`${j.name}: should move ${lacking.join(", ")} but does not`);
    for (const p of spec.motion[j.name] ?? []) if (!movable.some((n) => glob(p).test(n))) problems.push(`${j.name}: motion entry '${p}' matches no node`);
  }
  report(!problems.length, "expected motion", problems.length ? `${problems.length} problem(s)` : `${glb.joints.length} joints posed by the independent reader; each moves exactly the nodes in the motion table`, problems);
}

// ---- 11. pose conformance: shared TypeScript definition vs the independent Python one ----------------
{
  const problems: string[] = []; let n = 0, worst = 0;
  for (const j of glb.joints) {
    const mj = manifest.joints.find((x) => x.id === j.name)!;
    const rest: Trs = { t: mj.rest.t as Trs["t"], q: mj.rest.q as Trs["q"] };
    for (const p of j.posed ?? []) {
      const { t, q } = poseFromRest(rest, mj, p.value), R = matFromQuat(q);
      const mine = [[R[0], R[1], R[2], t[0]], [R[4], R[5], R[6], t[1]], [R[8], R[9], R[10], t[2]]];
      let d = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(mine[r][c] - p.matrix[r][c]));
      worst = Math.max(worst, d); n++;
      if (d > 2e-6) problems.push(`${j.name} at ${JSON.stringify(p.value)}: transforms differ by ${d.toExponential(2)}`);
    }
  }
  report(!problems.length && n > 0, "pose conformance", problems.length ? `${problems.length} of ${n} test poses disagree` : `${n} test poses: shared/pose.ts (generator + viewer) and tools/glb_inspect.py agree (max difference ${worst.toExponential(1)})`, problems);
}

// ---- 12. performance budget ------------------------------------------------------------------------
{
  const t = manifest.totals, problems: string[] = [];
  if (t.triangles > BUDGET.triangles) problems.push(`${t.triangles} triangles > ${BUDGET.triangles}`);
  if (manifest.glb.bytes > BUDGET.bytes) problems.push(`${manifest.glb.bytes} bytes > ${BUDGET.bytes}`);
  if (t.primitives > BUDGET.primitives) problems.push(`${t.primitives} draw primitives > ${BUDGET.primitives} (merge parts per component and material)`);
  const top = [...manifest.components, ...manifest.surfaces].sort((a, b) => b.triangles - a.triangles).slice(0, 3).map((c) => `${c.id} ${c.triangles}`).join(", ");
  report(!problems.length, "budget", `${t.triangles} / ${BUDGET.triangles} triangles, ${t.primitives} / ${BUDGET.primitives} draw primitives, ${(manifest.glb.bytes / 1e6).toFixed(2)} / ${BUDGET.bytes / 1e6} MB; heaviest: ${top}`, problems);
}

// ---- 13. banned words ------------------------------------------------------------------------------
{
  // The words are stored encoded so that this file does not contain them. More can be added, one per
  // line, in private/banned-words.txt.
  const { NEVER: anywhere, VENDORS: vendors, ALLOWED, extraWords } = await import("./banned.ts");   // rig maker, customer: never; device makers: only in parameter evidence
  const extra = extraWords(ROOT);
  const skip = new Set(["private", "work", "node_modules", ".git", ".venv", ".claude"]);
  const hits: string[] = []; let files = 0;
  const allowed = ALLOWED;
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (skip.has(f)) continue;
      const p = join(dir, f), rel = relative(ROOT, p), st = statSync(p);
      // Binary files (images, the model, fonts) are scanned for the never-allowed words only: short
      // device-maker words such as a three-letter one turn up by chance in compressed bytes (a false
      // positive found on two wiki images on 2026-11-23). Text files get the full scan.
      const binary = /\.(jpe?g|png|webp|gif|glb|bin|woff2?|ico|pdf)$/i.test(f);
      const scan = (text: string, where: string, isBinary = false) => {
        const low = text.toLowerCase().split(allowed).join("");
        for (const w of [...anywhere, ...extra]) if (low.includes(w)) hits.push(`${where}: contains banned word #${[...anywhere, ...extra].indexOf(w) + 1}`);
        if (isBinary) return;
        const evidenceOk = /^assets\/[^/]+\/params\/.*\.toml$/.test(rel) || rel.endsWith(".manifest.json");
        if (!evidenceOk) for (const w of vendors) if (new RegExp(`\\b${w}\\b`).test(low)) hits.push(`${where}: device maker name #${vendors.indexOf(w) + 1} outside a parameter evidence field`);
      };
      scan(f, `${rel} (file name)`);
      if (st.isDirectory()) walk(p);
      else if (st.size < 30_000_000) { files++; scan(readFileSync(p).toString("latin1"), rel, binary); }
    }
  };
  walk(ROOT);
  report(!hits.length, "banned words", hits.length ? `${hits.length} hit(s)` : `${files} files outside private/ and work/ scanned, none found`, hits);
}

// ---- 14. numbers in source (advisory) ----------------------------------------------------------------
{
  const notes: string[] = [];
  const srcDir = join(ROOT, "assets", asset, "src");
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith(".ts"))) {
    readFileSync(join(srcDir, f), "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
      for (const m of code.matchAll(/(?<![\w.$])(\d+\.\d+|\d{3,})(?![\w.])/g)) if (m[1] !== "0.5") notes.push(`${f}:${i + 1}: literal ${m[1]}`);
    });
  }
  report(notes.length ? "warn" : true, "numbers in source", notes.length ? `${notes.length} numeric literal(s) in component code; dimensions belong in params/*.toml` : "no dimension-like literals in assets/*/src", notes);
}

// ---- 15. browser checks: projection self-test and frame rate ------------------------------------------
if (!fast) {
  try {
    const { openViewer } = await import("./render.ts");
    const v = await openViewer({ workspace });
    const st = await v.page.evaluate("viewer.selfTest()");
    report(st.pass, "projection self-test", `${st.checked} known points over ${st.cameras.length} camera(s): worst ${Number(st.worst_px).toFixed(3)} px (tolerance ${st.tolerance_px} px)`, st.pass ? [] : st.results.filter((r: any) => r.error || r.error_px > 1).map((r: any) => JSON.stringify(r)));
    await v.page.viewport(1600, 1000);
    await v.page.evaluate("viewer.apply({ ui: '0', view: 'three_quarter' })");
    // On a CI runner WebGL runs in software (no GPU): 90 frames took two minutes at 1 fps and say nothing
    // about real viewing performance, so only the draw calls are counted there (one frame).
    const ci = Boolean(process.env.CI);
    const b = await v.page.evaluate(`viewer.benchmark(${ci ? 1 : 90})`);
    if (ci) report(true, "frame rate", `not measured on the CI runner (software rendering, no GPU); ${b.triangles} triangles, ${b.calls} draw calls in the default view`);
    else report(b.fps >= BUDGET.fps ? true : "warn", "frame rate", `${b.fps.toFixed(0)} fps at 1600 × 1000 in headless Chromium (${b.triangles} triangles, ${b.calls} draw calls in the default view)`);
    if (b.calls > BUDGET.primitives + 2) report(false, "draw calls", `${b.calls} draw calls in the default view > ${BUDGET.primitives}`);
    const errs = [...new Set(v.page.errors)];
    if (errs.length) report(false, "viewer console", `${errs.length} error(s) or warning(s)`, errs);
    await v.close();
  } catch (e: any) { report(false, "browser checks", String(e.message)); }
  // the deploy's live-site checks and its rollback, against local stand-ins of the site (need dist/; about 90 s)
  if (existsSync(join(ROOT, "dist", "version.json"))) for (const [name, cmd, summary] of [
    ["deploy checks", ["bun", join(ROOT, "tools", "deploy-tests", "deploy-checks.ts")], /deploy checks test: .*/],
    ["deploy rollback", ["bash", join(ROOT, "tools", "deploy-tests", "rollback.test.sh")], /rollback test: .*/],
  ] as [string, string[], RegExp][]) {
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", cwd: ROOT, timeout: 300_000 });
    const out = r.stdout + r.stderr;
    report(r.status === 0, name, (summary.exec(out)?.[0] ?? "no summary") + " (tools/deploy-tests/, local stand-ins, no SSH)", r.status === 0 ? [] : out.split("\n").filter((l) => l.includes("FAIL")));
  }
  else report("warn", "deploy checks", "skipped: no dist/ (run bun run dist first)");
  // the shared scene in two real browsers (tools/live-accept.ts, about 10 s)
  const r = spawnSync("bun", [join(ROOT, "tools", "live-accept.ts")], { encoding: "utf8", cwd: ROOT, timeout: 180_000 });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, "live viewer", `${lines.filter((l) => l.startsWith("ok ")).length} of ${lines.filter((l) => /^(ok |FAIL)/.test(l)).length} steps (two browsers and the command line on one local server: changes both ways, activity line and its Undo, stale refusal, link preview, view routing, no server)`, r.status === 0 ? [] : lines.filter((l) => l.startsWith("FAIL") || /error/i.test(l)));
}

const seconds = (performance.now() - t0) / 1000;
console.log(`${failures ? "CHECK FAILED" : "all checks passed"}: ${failures} failure(s), ${warnings} warning(s), ${seconds.toFixed(1)} s`);
timeline(failures ? "check failed" : "check", seconds, `${failures} failures, ${warnings} warnings${fast ? ", fast" : ""}${workspace ? `, workspace ${workspace}` : ""}`);
process.exit(failures ? 1 : 0);
