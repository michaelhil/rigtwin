// bun tools/manikin-build/compare.ts [--runs dressed,tones,clay] [--skip-render]
//
// The look comparison of the packed manikin against the lab's packages, in the lab's own packet renderer (Mac only;
// the lab is the project's working folder). The lab viewer reads only work/ and the lab's formats, so the packed
// packages are staged under work/manikin-compare/staged/ in the lab layout, from the committed files:
//   GLB as committed (meshopt geometry, KTX2 textures: the lab viewer has both decoders); shape files decoded back to
//   the lab's int16 layout with the packed numbers (work/manikin-pack/stage-data/, written by pack.ts); side normal maps
//   transcoded from the committed KTX2 to PNG by `ktx extract`; a tone as a GLB with that tone's KTX2 textures swapped in.
// Then the designer's key shots (C1 head 1.2 m, B1 2.5 m, F1 seated hero, F5 hand on grip 0.7 m) are rendered from the
// lab package and from the staged copy with the same command, and every picture pair is compared pixel by pixel.
// Writes work/manikin-compare/report.json and difference images (x8) beside the shots.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const LAB = resolve(process.env.MANIKIN_LAB ?? join(ROOT, "work", "avatar-lab"));
const KTX = resolve(process.env.MANIKIN_KTX ?? join(dirname(process.env.MANIKIN_TOKTX ?? join(ROOT, "work", "tools", "ktx", "bin", "toktx")), "ktx"));
const LAB_ROOT = resolve(LAB, "..", "..");                 // the checkout whose work/ holds the lab (the lab server's root)
const WORK = join(LAB_ROOT, "work", "manikin-compare"), STAGED = join(WORK, "staged"), OUTS = join(WORK, "out");
const ASSETS = join(ROOT, "assets", "manikin"), STAGE_DATA = join(ROOT, "work", "manikin-pack", "stage-data");

const RUNS: Record<string, { lab: string; packed: string; only: string; persons: string }[]> = {
  dressed: [{ lab: "operator-m", packed: "operator-m", only: "C1,B1,F1,F5", persons: "M50,F05,M95H" }],
  tones: [{ lab: "operator-m-dark", packed: "operator-m-dark", only: "C1", persons: "M50" }, { lab: "operator-f-medium", packed: "operator-f-medium", only: "C1", persons: "F05" }],
  clay: [{ lab: "abstract-m", packed: "clay-m", only: "C1,B1,F1,F5", persons: "M50,M95H" }, { lab: "abstract-f", packed: "clay-f", only: "C1,B1,F1,F5", persons: "F05" }],
};

const run = (cmd: string, argv: string[], cwd?: string) => { const r = spawnSync(cmd, argv, { encoding: "utf8", cwd, maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(`${basename(cmd)} ${argv.join(" ")} failed:\n${(r.stderr || r.stdout).slice(-3000)}`); return r.stdout; };

/** A packed package in the lab's layout, under STAGED/<as>. `tone`: stage that tone of a dressed package instead of the default. */
async function stage(name: string, as = name, tone?: string) {
  const src = join(ASSETS, name), dst = join(STAGED, as), m = JSON.parse(readFileSync(join(src, `${name}.avatar.json`), "utf8"));
  rmSync(dst, { recursive: true, force: true }); mkdirSync(join(dst, "maps"), { recursive: true });
  // shape files: the packed numbers in the lab's layout
  for (const b of [m.shape.bake].flat()) { cpSync(join(STAGE_DATA, `${name}--${b.file}`), join(dst, b.file)); for (const k of ["encoding", "base", "deltas", "quantisation"]) delete b[k]; }
  // side maps: masks as they are, KTX2 transcoded to PNG
  const side = (p: string) => {
    if (p.endsWith(".png")) { cpSync(join(src, p), join(dst, p)); return p; }
    const png = `maps/${basename(p).replace(/\.ktx2$/, ".png")}`;
    run(KTX, ["extract", "--transcode", "rgba8", join(src, p), join(dst, png)]);
    return png;
  };
  for (const slot of m.wardrobe?.slots ?? []) for (const g of slot.garments) for (const k of ["bodyMask", "cover"]) if (g[k]) g[k] = side(g[k]);
  for (const mat of Object.values<any>(m.materials ?? {})) { if (mat?.detailNormal) mat.detailNormal = side(mat.detailNormal); if (mat?.poseNormal?.posed) mat.poseNormal.posed = side(mat.poseNormal.posed); }
  if (m.posesFile) cpSync(join(src, m.posesFile), join(dst, m.posesFile));
  // clips: the committed (meshopt) files, at the same relative place
  const sex = name.endsWith("-f") ? "f" : "m";
  if (!existsSync(join(STAGED, "clips", sex))) cpSync(join(ASSETS, "clips", sex), join(STAGED, "clips", sex), { recursive: true });
  // the GLB as committed, or with a tone's textures swapped in
  const glbOut = join(dst, `${as}.glb`);
  if (!tone) cpSync(join(src, m.glb), glbOut);
  else {
    const t = m.tones.list.find((x: any) => x.id === tone); if (!t) throw new Error(`${name}: no tone ${tone}`);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
    const doc = await io.read(join(src, m.glb));
    for (const [key, file] of Object.entries<string>(t.textures)) {
      const [mat, slot] = key.split("."), mt = doc.getRoot().listMaterials().find((x) => x.getName() === mat)!;
      const tex = slot === "baseColor" ? mt.getBaseColorTexture() : slot === "normal" ? mt.getNormalTexture() : mt.getMetallicRoughnessTexture();
      tex!.setImage(new Uint8Array(readFileSync(join(src, file))));
    }
    for (const [mat, f] of Object.entries<any>(t.gltfMaterials ?? {})) { const mt = doc.getRoot().listMaterials().find((x) => x.getName() === mat)!; if (f.baseColorFactor) mt.setBaseColorFactor(f.baseColorFactor); if (f.roughnessFactor !== undefined) mt.setRoughnessFactor(f.roughnessFactor); if (f.metallicFactor !== undefined) mt.setMetallicFactor(f.metallicFactor); }
    for (const [k, v] of Object.entries<any>(t.materials ?? {})) m.materials[k] = v;
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    writeFileSync(glbOut, await io.writeBinary(doc));
  }
  m.glb = `${as}.glb`; m.name = as;
  writeFileSync(join(dst, `${as}.avatar.json`), JSON.stringify(m));
  return join(dst, `${as}.avatar.json`);
}

function packet(manifest: string, out: string, only: string, persons: string) {
  rmSync(out, { recursive: true, force: true });
  const t0 = performance.now();
  run("bun", [join(LAB, "viewer", "packet.ts"), manifest, "--out", out, "--only", only, "--persons", persons, "--no-bench", "--no-skin-test"], LAB_ROOT);
  return (performance.now() - t0) / 1000;
}

async function diff(a: string, b: string, out: string) {
  const A = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true }), B = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) throw new Error(`${a}: sizes differ`);
  const n = A.info.width * A.info.height, d = new Uint8Array(n), hist = new Uint32Array(256), heat = Buffer.alloc(n * 3);
  let sum = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    let m = 0; for (let c = 0; c < 3; c++) { const x = Math.abs(A.data[i * 3 + c] - B.data[i * 3 + c]); m = Math.max(m, x); sum += x; sq += x * x; }
    d[i] = m; hist[m]++; const h = Math.min(255, m * 8); heat[i * 3] = h; heat[i * 3 + 1] = h; heat[i * 3 + 2] = h;
  }
  const pct = (q: number) => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= q * n) return v; } return 255; };
  const over = (t: number) => { let c = 0; for (let v = t + 1; v < 256; v++) c += hist[v]; return c; };
  await sharp(heat, { raw: { width: A.info.width, height: A.info.height, channels: 3 } }).png().toFile(out);
  const mse = sq / (n * 3);
  return { pixels: n, identical: hist[0] === n, mean_abs: Number((sum / (n * 3)).toFixed(3)), psnr_db: mse ? Number((10 * Math.log10(255 * 255 / mse)).toFixed(1)) : null, p99: pct(0.99), p999: pct(0.999), max: pct(1), over8: over(8), over16: over(16), over32: over(32) };
}

if (import.meta.main) {
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const which = (opt("--runs") ?? "dressed,tones,clay").split(",");
  mkdirSync(WORK, { recursive: true });
  const staged = new Set<string>();   // the other sex's package is staged afresh once per run (it provides the packet's other persons)
  rmSync(join(STAGED, "clips"), { recursive: true, force: true });
  const report: any = { when: new Date().toISOString(), renderer: "work/avatar-lab/viewer/packet.ts (the designer's packet renderer), --no-bench --no-skin-test", runs: [] };
  for (const group of which) for (const r of RUNS[group]) {
    const tone = /-(dark|medium)$/.exec(r.packed)?.[1], base = tone ? r.packed.replace(/-(dark|medium)$/, "") : r.packed;
    if (base.startsWith("operator")) { const other = base.endsWith("-m") ? "operator-f" : "operator-m"; if (!staged.has(other)) { await stage(other); staged.add(other); } }
    const manifest = await stage(base, r.packed, tone);
    const labManifest = join(LAB, "packages", r.lab, `${r.lab}.avatar.json`);
    const outLab = join(OUTS, "lab", r.packed), outPacked = join(OUTS, "packed", r.packed);
    let secs: number[] = [];
    if (!args.includes("--skip-render")) secs = [packet(labManifest, outLab, r.only, r.persons), packet(manifest, outPacked, r.only, r.persons)];
    const shots = readdirSync(join(outLab, "shots")).filter((f) => f.endsWith(".png") && existsSync(join(outPacked, "shots", f))).sort();
    const missing = readdirSync(join(outLab, "shots")).filter((f) => f.endsWith(".png") && !existsSync(join(outPacked, "shots", f)));
    mkdirSync(join(WORK, "diff", r.packed), { recursive: true });
    const rows: any[] = [];
    for (const f of shots) rows.push({ shot: f, ...(await diff(join(outLab, "shots", f), join(outPacked, "shots", f), join(WORK, "diff", r.packed, f))) });
    report.runs.push({ lab: r.lab, packed: r.packed, only: r.only, persons: r.persons, seconds: secs, missing, shots: rows });
    for (const x of rows) console.log(`${r.packed} ${x.shot}: mean ${x.mean_abs}/255, PSNR ${x.psnr_db} dB, 99.9 % under ${x.p999}, max ${x.max}, over 16: ${x.over16} px of ${x.pixels}`);
    if (missing.length) console.log(`  not rendered from the packed copy: ${missing.join(", ")}`);
  }
  writeFileSync(join(WORK, "report.json"), JSON.stringify(report, null, 1) + "\n");
  console.log(`report: ${join(WORK, "report.json")}`);
}
