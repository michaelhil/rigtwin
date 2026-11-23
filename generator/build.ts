// bun run build [--only <group>[,<group>]] [--workspace <name>] [--asset rig-b] [--out <dir>] [--quiet]
// --workspace (or RIGTWIN_WORKSPACE) writes to work/<name>/build/ so parallel builds do not overwrite each other.
// params + spec + src  ->  assets/<asset>/build/<asset>.glb + <asset>.manifest.json
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadParams, CLASSES } from "./params.ts";
import { loadSpec, assemble, NAME_PATTERN } from "./assemble.ts";
import { writeGlb } from "./glb.ts";
import { PALETTE } from "./materials.ts";
import { screenTextures } from "./textures.ts";
import { ROOT, timeline } from "../tools/timeline.ts";

export interface BuildResult { ok: boolean; glbPath: string; manifestPath: string; sha256: string; seconds: number; manifest: any; messages: string[] }

export async function build(opts: { asset?: string; only?: string[]; outDir?: string; workspace?: string; quiet?: boolean } = {}): Promise<BuildResult> {
  const t0 = performance.now();
  const asset = opts.asset ?? "rig-b", dir = join(ROOT, "assets", asset), outDir = opts.outDir ?? (opts.workspace ? join(ROOT, "work", opts.workspace, "build") : join(dir, "build"));
  const say = (m: string) => { if (!opts.quiet) console.log(m); };
  const messages: string[] = [];
  const spec = loadSpec(join(dir, "spec"));
  const params = loadParams(join(dir, "params"), spec.groups);
  const asm = await assemble(spec, params, { srcDir: join(dir, "src"), only: opts.only });
  if (asm.errors.length) {
    for (const e of asm.errors) console.error("error: " + e);
    return { ok: false, glbPath: "", manifestPath: "", sha256: "", seconds: (performance.now() - t0) / 1000, manifest: null, messages: asm.errors };
  }
  const partial = !!opts.only?.length;
  const { bytes, stats } = writeGlb(asm.root, PALETTE, screenTextures(), {
    asset, schema: "rigtwin-glb/1",
    frame: "children of the root node use: metres, Z up, X forward (operator to main display), Y to the operator's left; origin at the centre of the deck top. The root node rotation converts to glTF Y-up.",
  });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const unused = [...params.records.keys()].filter((k) => ![...params.usage.values()].some((s) => s.has(k)));
  const manifest = {
    schema: "rigtwin-manifest/1",
    asset, title: spec.title,
    conventions: {
      units: "metres, radians",
      frame: "right-handed, Z up, X forward (from the operator toward the main display), Y to the operator's left; origin at the centre of the platform deck's top surface",
      gltf: "glTF is Y-up. The conversion is applied once, as the rotation of the root node: x_gltf = x, y_gltf = z, z_gltf = -y. Every node below the root is in the frame above.",
      names: `${NAME_PATTERN.source} ; C_ component, J_ joint frame, D_ reference frame, S_ functional surface; _L/_R are the operator's left and right`,
      joints: "A joint is a node between a parent and a child component. Its transform is pose(pos, rpy) · motion(value): rotation about `axis` (revolute, radians) or translation along `axis` (prismatic, metres), axis given in the joint frame. The GLB stores the transform at value = neutral; to pose, right-multiply the stored transform by motion(value - neutral). Ball joints: neutral is roll/pitch/yaw; offsets are applied the same way as a roll/pitch/yaw rotation.",
      positions: "bbox and origin fields are in the frame above, at the neutral pose",
      classes: "measured > vendor > photo > assumed > invented. A component's class is the least certain class among the non-cosmetic parameters it reads (mount frame included).",
    },
    build: { partial, only: opts.only ?? null },
    groups: spec.groups,
    components: asm.components,
    surfaces: asm.surfaces,
    joints: asm.joints,
    datums: asm.datums,
    motion: spec.motion,
    omitted: asm.omitted,
    missing: asm.missing,
    not_built: asm.notBuilt,
    materials: Object.fromEntries(Object.entries(PALETTE).map(([k, m]) => [k, { color: m.color.map((c) => Math.round(c * 1000) / 1000), metallic: m.metallic, roughness: m.roughness, note: m.note }])),
    parameters: Object.fromEntries([...params.records].map(([k, r]) => [k, r])),
    parameter_class_counts: params.classCounts(),
    parameters_unused: unused,
    totals: { triangles: stats.triangles, vertices: stats.vertices, primitives: stats.primitives, nodes: stats.nodes, meshes: stats.meshes, materials: stats.materials, textures: stats.textures, bbox: asm.bbox },
    glb: { file: `${asset}.glb`, bytes: stats.bytes, sha256 },
  };
  mkdirSync(outDir, { recursive: true });
  const glbPath = join(outDir, `${asset}.glb`), manifestPath = join(outDir, `${asset}.manifest.json`);
  writeFileSync(glbPath, bytes);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
  const seconds = (performance.now() - t0) / 1000;

  for (const w of params.warnings) messages.push("warning: " + w);
  for (const id of asm.missing) messages.push(`warning: ${id} missing: in tree, no function in src/${spec.nodes[id].group ?? spec.nodes[spec.nodes[id].parent!].group}.ts, not in omitted`);
  if (unused.length) messages.push(`note: ${unused.length} parameter(s) read by nothing: ${unused.slice(0, 12).join(", ")}${unused.length > 12 ? ", …" : ""}`);
  for (const m of messages) say(m);
  const cc = params.classCounts();
  say(`built ${asset}${partial ? ` (PARTIAL: only ${opts.only!.join(", ")}; ${asm.notBuilt.length} component(s) not built)` : ""} in ${seconds.toFixed(2)} s: ` +
    `${stats.triangles} triangles, ${stats.primitives} draw primitives, ${stats.nodes} nodes, ${stats.bytes} bytes (${(stats.bytes / 1e6).toFixed(2)} MB)`);
  say(`parameters: ${params.records.size} (${CLASSES.filter((c) => cc[c]).map((c) => `${c} ${cc[c]}`).join(", ")}); omitted ${asm.omitted.length}; sha256 ${sha256.slice(0, 16)}…`);
  return { ok: true, glbPath, manifestPath, sha256, seconds, manifest, messages };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const only = opt("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
    const res = await build({ asset: opt("--asset"), only, outDir: opt("--out"), workspace: opt("--workspace") ?? process.env.RIGTWIN_WORKSPACE, quiet: args.includes("--quiet") });
    if (!args.includes("--no-timeline")) timeline(res.ok ? "build" : "build failed", res.seconds, res.ok ? `${res.manifest.totals.triangles} tris, ${res.manifest.glb.bytes} bytes${only ? `, only ${only.join(",")}` : ""}` : res.messages.slice(0, 3).join(" | "));
    process.exit(res.ok ? 0 : 1);
  } catch (e: any) {
    console.error("error: " + e.message);
    timeline("build failed", null, String(e.message).slice(0, 300));
    process.exit(1);
  }
}
