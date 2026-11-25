// Fetches the scanned fabric sets the Operator's garments are re-materialled with, from Poly Haven (CC0), into
// work/avatar-lab/downloads/polyhaven/fabrics/ and appends one row per file to work/avatar-lab/downloads/MANIFEST.md.
//
//   bun work/avatar-lab/pipeline/kit_fetch_fabrics.ts --list     what would be fetched: URL, bytes, MD5 (reads the API only)
//   bun work/avatar-lab/pipeline/kit_fetch_fabrics.ts            fetch at 1k (default)        [--2k for 2k]
//
// NOT RUN BY B2: downloads go through the coordinator. Style of viewer/fetch-polyhaven.ts, with one difference that is
// deliberate: the URL, size and MD5 of every file are read from Poly Haven's own API (api.polyhaven.com/files/<asset>) when
// the script runs, shown by --list, and each download is checked against them before it is kept. I did not hard-code
// hashes, because I could only read the API through a summarising fetch tool and will not hand over 15 transcribed MD5 sums
// as verified. The asset names below were read from api.polyhaven.com/assets?t=textures&c=fabric on 2026-11-24.
// Only hosts dl.polyhaven.org / dl.polyhaven.com are accepted; the files are images (JPEG), never executed; the run stops
// if the total would pass 150 MB. Licence: "All assets on Poly Haven are CC0" (polyhaven.com/license), believed; check the
// page when running this. Poly Haven lists no rubber material (category "rubber" is empty today): the sole stays generated.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const LAB = resolve(import.meta.dir, ".."), RES = process.argv.includes("--2k") ? "2k" : "1k", LIST = process.argv.includes("--list");
const SETS: [string, string][] = [
  ["stretch_poplin", "shirt: fine plain-weave shirting"],
  ["denim_fabric_04", "work trousers: twill"],
  ["rough_linen", "second top / softshell stand-in: coarse plain weave"],
  ["jersey_melange", "cap: knit"],
  ["brown_leather", "boot upper: leather grain"],
];
const MAPS = ["Diffuse", "nor_gl", "Rough"];          // albedo (used only for its yarn detail), OpenGL normal, roughness
const LIMIT = 150e6, UA = { "user-agent": "avatar-lab-fetch" };
const dir = join(LAB, "downloads/polyhaven/fabrics"); const plan: { name: string; url: string; size: number; md5: string; why: string }[] = [];
for (const [id, why] of SETS) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA }); if (!res.ok) throw new Error(`${id}: API HTTP ${res.status}`);
  const files: any = await res.json();
  for (const map of MAPS) {
    const f = files?.[map]?.[RES]?.jpg; if (!f?.url || !f.size || !f.md5) throw new Error(`${id}: the API lists no ${map} ${RES} jpg`);
    const host = new URL(f.url).host; if (host !== "dl.polyhaven.org" && host !== "dl.polyhaven.com") throw new Error(`${id}: unexpected host ${host}`);
    plan.push({ name: f.url.split("/").pop(), url: f.url, size: f.size, md5: f.md5, why: `${why} (${map})` });
  }
}
const total = plan.reduce((a, p) => a + p.size, 0);
for (const p of plan) console.log(`${p.name}\t${p.size}\t${p.md5}\t${p.url}`);
console.log(`${plan.length} files, ${(total / 1e6).toFixed(1)} MB at ${RES}`);
if (total > LIMIT) throw new Error("over 150 MB: not fetched");
if (LIST) process.exit(0);
mkdirSync(dir, { recursive: true });
for (const p of plan) {
  const file = join(dir, p.name); if (existsSync(file)) { console.log("already there: " + p.name); continue; }
  const res = await fetch(p.url, { headers: UA }); if (!res.ok) throw new Error(`${p.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== p.size || createHash("md5").update(buf).digest("hex") !== p.md5) throw new Error(`${p.name}: size or MD5 differs from what Poly Haven's API listed; not kept`);
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw new Error(`${p.name}: not a JPEG; not kept`);
  writeFileSync(file, buf);
  appendFileSync(join(LAB, "downloads/MANIFEST.md"), `| ${new Date().toISOString().slice(0, 10)} | B2 (script run by the coordinator) | downloads/polyhaven/fabrics/${p.name} | ${p.url} | ${p.size} | ${createHash("sha256").update(buf).digest("hex")} | CC0 ("All assets on Poly Haven are CC0", polyhaven.com/license) | ${p.why} |\n`);
  console.log("fetched " + p.name);
}
