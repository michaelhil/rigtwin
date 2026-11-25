// The manikin's checks (part of `bun run check`; also `bun tools/manikin-check.ts` alone). The packages under
// assets/manikin/ are committed binaries built on a Mac from the avatar lab (tools/manikin-build/), so they are not
// rebuilt here and are exempt from the determinism check: every file is verified against the SHA-256 in its package's
// PROVENANCE.json instead. Checked:
//   packaging   assets/manikin/params/packaging.toml: complete parameter records (generator/params.ts)
//   files       each package's files exist, match PROVENANCE.json, nothing unlisted; every file the manifests name exists
//   budgets     download (as sent), tone, clips, triangles, draw calls, GPU texture memory against packaging.toml
//   glTF        Khronos validator: no error or warning beyond those PROVENANCE.json accepts (inherited from the lab)
//   licences    every package and source carries a licence; CREDITS.md credits every CC-BY author and the CMU terms
//   names       banned names in every file under assets/manikin/ and tools/manikin-build/, file names and binaries included
//   symlinks    none under assets/manikin/ or tools/manikin-build/ (the lab's body-clay/body-clay loop must not come along)
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, normalize, relative } from "node:path";
import { loadParams } from "../generator/params.ts";
import { packageInfo, sha256 } from "./manikin-build/package-info.ts";

export interface Result { ok: boolean | "warn"; name: string; summary: string; details: string[] }

const BINARY = /\.(glb|bin|ktx2|png|jpe?g|webp)$/i, TEXT = /\.(json|md|toml|ts|py|txt)$/i;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) { if (f === "node_modules" || f === ".DS_Store") continue; const p = join(dir, f), st = lstatSync(p); out.push(p); if (st.isDirectory() && !st.isSymbolicLink()) walk(p, out); }   // the build tools' own installed packages are not ours
  return out;
}

export async function manikinChecks(root: string): Promise<Result[]> {
  const results: Result[] = [], add = (ok: Result["ok"], name: string, summary: string, details: string[] = []) => results.push({ ok, name, summary, details });
  const base = join(root, "assets", "manikin");
  if (!existsSync(base)) { add(true, "manikin", "no assets/manikin/ (nothing to check)"); return results; }

  // packaging parameters
  let P: ReturnType<typeof loadParams> | null = null;
  try {
    P = loadParams(join(base, "params"), ["packaging"]);
    const warn = P.warnings.filter((w) => !/^runtime[\w-]*\.toml: not a known group file/.test(w));
    add(warn.length ? "warn" : true, "manikin packaging", `${P.records.size} records in assets/manikin/params/packaging.toml, all complete`, warn);
  } catch (e: any) { add(false, "manikin packaging", "packaging.toml invalid", String(e.message).split("\n")); return results; }
  const lim = (k: string) => P!.num(k);

  // symlinks
  const all = [...walk(base), ...walk(join(root, "tools", "manikin-build"))];
  const links = all.filter((p) => lstatSync(p).isSymbolicLink()).map((p) => relative(root, p));
  add(!links.length, "manikin symlinks", links.length ? `${links.length} symbolic link(s)` : `${all.length} paths under assets/manikin/ and tools/manikin-build/, no symbolic link`, links);

  // banned names: every file, binaries included (the never-allowed names in every byte; device makers in text only)
  {
    const { NEVER, VENDORS, ALLOWED, extraWords } = await import("./banned.ts");
    const words = [...NEVER, ...extraWords(root)], hits: string[] = [];
    let n = 0, bytes = 0;
    for (const p of all) {
      const rel = relative(root, p), name = rel.split("/").pop()!.toLowerCase().split(ALLOWED).join("");
      for (const w of [...words, ...VENDORS]) if (VENDORS.includes(w) ? new RegExp(`\\b${w}\\b`).test(name.replaceAll(/[-_.]/g, " ")) : name.includes(w)) hits.push(`${rel}: file name contains banned word #${[...words, ...VENDORS].indexOf(w) + 1}`);
      if (lstatSync(p).isDirectory()) continue;
      const data = readFileSync(p); n++; bytes += data.byteLength;
      const low = data.toString("latin1").toLowerCase().split(ALLOWED).join("");
      for (const w of words) if (low.includes(w)) hits.push(`${rel}: contains banned word #${words.indexOf(w) + 1}`);
      if (TEXT.test(p) && !BINARY.test(p)) for (const w of VENDORS) if (new RegExp(`\\b${w}\\b`).test(low)) hits.push(`${rel}: device maker name #${VENDORS.indexOf(w) + 1}`);
    }
    add(!hits.length, "manikin names", hits.length ? `${hits.length} hit(s)` : `${n} files (${(bytes / 1e6).toFixed(1)} MB, binaries included) scanned, no banned name`, hits);
  }

  // packages
  const packages = readdirSync(base).filter((d) => existsSync(join(base, d, `${d}.avatar.json`))).sort();
  const credits = existsSync(join(base, "CREDITS.md")) ? readFileSync(join(base, "CREDITS.md"), "utf8") : "";
  const validator = createRequire(import.meta.url)("gltf-validator");
  const referencedShared = new Set<string>(), fileProblems: string[] = [], budgetProblems: string[] = [], licenceProblems: string[] = [], gltfProblems: string[] = [], summary: string[] = [];
  for (const name of packages) {
    const dir = join(base, name), provFile = join(dir, "PROVENANCE.json");
    if (!existsSync(provFile)) { fileProblems.push(`${name}: no PROVENANCE.json`); continue; }
    const prov = JSON.parse(readFileSync(provFile, "utf8")), m = JSON.parse(readFileSync(join(dir, `${name}.avatar.json`), "utf8"));
    // files and checksums
    for (const [rel, f] of Object.entries<any>(prov.files ?? {})) {
      const p = normalize(join(dir, rel));
      if (!existsSync(p)) { fileProblems.push(`${name}/${rel}: listed in PROVENANCE.json, missing`); continue; }
      const data = new Uint8Array(readFileSync(p));
      if (data.byteLength !== f.bytes || sha256(data) !== f.sha256) fileProblems.push(`${name}/${rel}: differs from PROVENANCE.json (${data.byteLength} bytes, SHA-256 ${sha256(data).slice(0, 12)}…; recorded ${f.bytes}, ${String(f.sha256).slice(0, 12)}…)`);
      if (rel.startsWith("../shared/")) referencedShared.add(normalize(join(dir, rel)));
    }
    for (const p of walk(dir)) { const rel = relative(dir, p); if (!lstatSync(p).isDirectory() && rel !== "PROVENANCE.json" && !prov.files?.[rel]) fileProblems.push(`${name}/${rel}: not listed in PROVENANCE.json`); }
    const info = packageInfo(dir, name);
    for (const f of info.missing) fileProblems.push(`${name}: the manifest names ${f}, which does not exist`);
    // budgets
    const isDefault = name === "operator-m", limit = lim(isDefault ? "budget.default_person_bytes" : "budget.person_bytes");
    if (info.transferBytes > limit) budgetProblems.push(`${name}: ${info.transferBytes} bytes to download > ${limit}`);
    for (const [t, files] of Object.entries(info.tones)) { const b = files.reduce((s, f) => s + f.bytes, 0); if (b > lim("budget.tone_bytes")) budgetProblems.push(`${name} tone ${t}: ${b} bytes > ${lim("budget.tone_bytes")}`); }
    for (const [s, st] of Object.entries(info.styles)) {
      if (st.triangles > lim("budget.triangles_per_outfit")) budgetProblems.push(`${name} ${s}: ${st.triangles} triangles > ${lim("budget.triangles_per_outfit")}`);
      if (st.drawCalls > lim("budget.draw_calls_per_outfit")) budgetProblems.push(`${name} ${s}: ${st.drawCalls} draw calls > ${lim("budget.draw_calls_per_outfit")}`);
      if (st.gpuTextureBytes > lim("budget.gpu_texture_bytes")) budgetProblems.push(`${name} ${s}: ${st.gpuTextureBytes} GPU texture bytes > ${lim("budget.gpu_texture_bytes")}`);
    }
    const unexpected = info.totals.extensionsRequired.filter((e) => !["EXT_meshopt_compression", "KHR_texture_basisu"].includes(e));
    if (unexpected.length) gltfProblems.push(`${name}: requires ${unexpected.join(", ")}`);
    const st = Object.entries(info.styles).map(([s, x]) => `${s} ${x.triangles} tris, ${x.drawCalls} calls, ${(x.gpuTextureBytes / 1e6).toFixed(0)} MB GPU`).join("; ");
    summary.push(`${name} ${(info.transferBytes / 1e6).toFixed(2)} MB (${st})`);
    // glTF validator
    const rep = await validator.validateBytes(new Uint8Array(readFileSync(join(dir, m.glb))), { maxIssues: 500 });
    const issues = [...new Set<string>(rep.issues.messages.filter((x: any) => x.severity <= 1 && x.code !== "IMAGE_UNRECOGNIZED_FORMAT" && !(x.code === "VALUE_NOT_IN_LIST" && /^\/images\/\d+\/mimeType$/.test(x.pointer ?? ""))).map((x: any) => `${x.code} ${x.pointer ?? ""}`))];
    const accepted = new Set<string>(prov.validator?.accepted ?? []);
    for (const i of issues) if (!accepted.has(i)) gltfProblems.push(`${name}: ${i}`);
    // licences and credits
    if (!Array.isArray(m.licence) || !m.licence.length) licenceProblems.push(`${name}: the manifest has no licence block`);
    for (const s of [...(m.licence ?? []), ...(prov.sources ?? [])]) if (!s.licence) licenceProblems.push(`${name}: source '${s.what}' without a licence`);
    for (const s of [...(m.licence ?? []), ...(prov.sources ?? [])]) if (/CC-BY/i.test(s.licence ?? "") && !(credits.includes(s.author) && credits.includes(s.title))) licenceProblems.push(`${name}: CC-BY source '${s.title}' by ${s.author} is not credited in assets/manikin/CREDITS.md`);
    if (info.clips.length && !/mocap\.cs\.cmu\.edu/.test(credits)) licenceProblems.push(`${name}: plays CMU motion capture, and CREDITS.md does not carry its terms and credit line`);
    for (const c of info.clips) if (!c.bytes) fileProblems.push(`${name}: clip ${c.path} missing`);
  }
  // clips: per sex, checksums and budget
  for (const sex of existsSync(join(base, "clips")) ? readdirSync(join(base, "clips")).filter((d) => lstatSync(join(base, "clips", d)).isDirectory()) : []) {
    const dir = join(base, "clips", sex), provFile = join(dir, "PROVENANCE.json");
    if (!existsSync(provFile)) { fileProblems.push(`clips/${sex}: no PROVENANCE.json`); continue; }
    const prov = JSON.parse(readFileSync(provFile, "utf8")); let bytes = 0;
    for (const [rel, f] of Object.entries<any>(prov.files ?? {})) {
      const p = join(base, rel); if (!existsSync(p)) { fileProblems.push(`${rel}: listed, missing`); continue; }
      const data = new Uint8Array(readFileSync(p)); bytes += data.byteLength;
      if (sha256(data) !== f.sha256) fileProblems.push(`${rel}: differs from clips/${sex}/PROVENANCE.json`);
    }
    for (const p of walk(dir)) { const rel = relative(base, p); if (!lstatSync(p).isDirectory() && !p.endsWith("PROVENANCE.json") && !prov.files?.[rel]) fileProblems.push(`${rel}: not listed in clips/${sex}/PROVENANCE.json`); }
    if (bytes > lim("budget.clips_bytes_per_sex")) budgetProblems.push(`clips/${sex}: ${bytes} bytes > ${lim("budget.clips_bytes_per_sex")}`);
    if (!(prov.sources ?? []).every((s: any) => s.licence)) licenceProblems.push(`clips/${sex}: a source without a licence`);
    summary.push(`clips/${sex} ${(bytes / 1e6).toFixed(2)} MB`);
  }
  for (const p of walk(join(base, "shared"))) if (!lstatSync(p).isDirectory() && !referencedShared.has(normalize(p))) fileProblems.push(`${relative(base, p)}: in shared/, used and checksummed by no package`);
  if (!credits) licenceProblems.push("assets/manikin/CREDITS.md missing");

  add(!fileProblems.length, "manikin files", fileProblems.length ? `${fileProblems.length} problem(s)` : `${packages.length} packages and the clips match their PROVENANCE.json checksums (committed binaries: verified, not rebuilt; the build needs the lab and a Mac)`, fileProblems);
  add(!budgetProblems.length, "manikin budgets", budgetProblems.length ? `${budgetProblems.length} over budget` : summary.join("; "), budgetProblems);
  add(!gltfProblems.length, "manikin glTF", gltfProblems.length ? `${gltfProblems.length} problem(s)` : `${packages.length} GLBs: Khronos validator finds nothing beyond the issues inherited from the lab; extensions EXT_meshopt_compression, KHR_texture_basisu`, gltfProblems);
  add(!licenceProblems.length, "manikin licences", licenceProblems.length ? `${licenceProblems.length} problem(s)` : `every package and source has a licence; CREDITS.md credits the CC-BY garments and the CMU terms`, licenceProblems);
  return results;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  let failed = 0;
  for (const r of await manikinChecks(root)) {
    if (r.ok === false) failed++;
    console.log(`${r.ok === true ? "ok  " : r.ok === "warn" ? "warn" : "FAIL"} ${r.name}: ${r.summary}`);
    for (const d of r.details.slice(0, 15)) console.log("       " + d);
  }
  process.exit(failed ? 1 : 0);
}
