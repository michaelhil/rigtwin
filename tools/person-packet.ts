// bun tools/person-packet.ts [--quick] [--only <shot ids, set letters or passes>] [--persons F05,M50,...] [--styles dressed,clay]
//                            [--tones light,medium,dark] [--run <name>] [--out <folder>] [--shots <review-packet.json>]
//                            [--scale 0.5] [--self-test] [--no-metrics] [--no-bench] [--list]
//
// The designer's review packet of the person (manikin), rendered in the PRODUCT viewer: the real rig, the product's own lighting
// (engine.ts: room environment, key and fill, its tone curve and exposure; no lab studio presets), the person seated by the
// rig binding on the real seat, grips and pedals, or standing beside the rig. Same shot ids, persons, azimuths, camera
// distances and lenses as the designer's list (work/avatar-lab/VD/review-packet.json) wherever they make sense in the rig;
// what cannot be rendered in the product is listed in manifest.json ("skipped") with the reason, never faked.
//
//   seated shots   (pose SEATED_GRIPS, clip OPERATE, the seated line-up): the operator layer on the rig binding, as the product
//                  shows the person; the azimuth is measured around the seated figure, which faces the rig's +X (seat swivel 0).
//                  The camera keeps the designer's distance and lens even where a rig part stands between it and the person: the
//                  part hiding the shot's target is named in the caption ("hidden by ...") and in manifest.json.
//   standing shots (A_POSE, RELAXED_STAND, HAND_POSE_ARM and the standing range-of-motion poses): the person stands on the
//                  room floor beside the rig (place() puts the soles on D_floor), far enough out that nothing can touch it, rig behind the
//                  figure. The camera stays on one side of the rig and the FIGURE turns (the lab's turntable): `az` is the
//                  camera's azimuth around the figure as in the shot list, the light falls the same way for every azimuth.
//   camera fit     a seated designer shot whose subject (its body-part target, or TOOL.subjectOf) the real rig hides is refitted:
//                  the cheapest change within 30 degrees and 40 cm that shows the subject, else the designer's camera with the rig
//                  parts in front of it hidden; both cameras and the reason are in manifest.json ("camera_fit") and the caption.
//                  Hand and wrist shots aim at the palm's centre (anchor hand_centre_L / _R) when the package has it, and every
//                  look-at point is kept inside the engine's orbit-target box (1.5 m round the rig), on the same line of sight.
//   product views  P1 the viewer's default view (Overview), P2 the operator's eye view onto the screens, P3 front, P4 left:
//                  exactly the views the page's buttons give, with the person seated.
//   passes         dressed (default tone), clay (the clay figure package), tones (medium and dark on a few shots).
//                  The lab's "clay" view mode (every surface grey) does not exist in the product: those shots are rendered in
//                  the clay style. "wire" and "checker" are not product modes and are skipped.
//
// Output (default <main checkout>/work/manikin-v1-packets/<run>/): shots/*.png, sheets/*.png (the lab's sheet style: 4 x 3 tiles,
// tile 800 px high, captions outside the picture), manifest.json, metrics.json (penetration of the person into the rig, the
// hands on the grips, the feet on the pedals, the eye against the survey, the binding's findings, frame time per shot set),
// KNOWN-ISSUES.md (what was skipped) and, with --self-test, self-test/ (three shots rendered alone on a fresh page and twice
// inside the run; the pictures must be identical).
//
// How the tool reaches the person and the rig: only through the page's own interface. viewer.person: set (pose, clip, script,
// time), place, anchor, avatar().skinnedPositions (the vertices as the person's shader skins them), still, state, bench;
// viewer.person.object().parent is the scene (the rig's meshes for the penetration metrics, the key light for the standing side);
// viewer.manifest() the rig's part boxes. No product code is changed and nothing is reached through the DevTools protocol.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, extname } from "node:path";
import { loadavg, cpus } from "node:os";
import { ROOT } from "./timeline.ts";
import { startServer } from "./serve.ts";
import { bundleViewer } from "./bundle.ts";
import { createHash } from "node:crypto";
import { Browser, type Page } from "./render.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2), flag = (n: string) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; }, has = (n: string) => args.includes("--" + n);

// ---- the tool's own settings (presentation of the packet, not numbers of the person or the rig) -----------------------------
const TOOL = {
  /** the persons of the manikin v1 review (the designer's list has more; --persons adds them when a package has the preset) */
  persons: ["F05", "M50", "M95H", "M50_HEAVY", "F50_HEAVY", "M50_THIN", "F50_THIN"],
  /** a standing person keeps this much room (metres, around its feet) to the rig's outline: arms in A-pose clear every part */
  standClearance: 0.75,
  /** standing shots: the camera's side of the rig is the key light's azimuth plus this (degrees). The lab's studio key sat 40
   *  degrees to the figure's right of the camera (review-packet.json lighting.studio.key az -40); here the light is the
   *  product's, fixed in the room, so the camera is put where the product's key falls the same way. */
  keyToCameraDeg: 40,
  /** a target counts as hidden when a rig surface lies this far (metres) or more in front of it on the line of sight */
  hiddenMargin: 0.03,
  /** a caption warns ("!") when less than this share of the person's outline is visible past the rig */
  visibleWarn: 0.6,
  /** the operator's eye view warns ("!") when the person's own body within 150 mm of the camera covers more than this share of it */
  ownBodyWarn: 0.02,
  /** penetration deeper than this (mm) is counted as a fault in the metrics' summary (the designer's body limit is 5, hands 3) */
  faultMm: 3,
  /** engine.ts keeps the orbit target within this many metres of the rig (world x and z); the look-at point is kept inside it */
  orbitBox: 1.5,
  /** camera fit of seated designer shots whose subject the real rig hides: refit below trigger, accept at accept (shares of the
   *  subject's visible surface), search within maxDeg of azimuth and elevation and maxMove metres nearer, at most maxTries cameras */
  fit: { trigger: 0.75, accept: 0.85, maxDeg: 30, maxMove: 0.4, maxTries: 60, radiusOfFrame: 0.3, radiusMin: 0.06,
    /** the parts the person rests on or holds: never hidden, and where they lie on the body (within contactDepth of its surface) they
     *  are what a contact shot shows, not an obstruction; further in front they hide the subject like any other part */
    contactParts: "^C_(seat_(pan|back_cushion)|joy_lever_[LR]|pedal_arm_.*|pod_armrest_[LR])$", contactDepth: 0.05 },
  /** what a designer shot is meant to show when that is not its camera target (I5: "through the reach" of the left hand) */
  subjectOf: { I5: ["hand_L"] } as Record<string, string[]>,
  /** frames of viewer.person.bench per shot set */
  benchFrames: 30,
};
const QUICK_EXTRAS = "the designer's early-gate list, plus G3 as a seated series (F05, M50, M95H), F9 (M50), the product views (M50, F05); clay pass: A2, C1, F1, F2, G3; tones: C1 and F1 (M50) in medium and dark";

// ---- where things are ----------------------------------------------------------------------------------------------------
function mainCheckout(): string {
  const r = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT });
  const d = r.stdout.toString().trim();
  return r.exitCode === 0 && d ? dirname(d) : ROOT;
}
const MAIN = mainCheckout();
const listFile = resolve(flag("shots") ?? [join(ROOT, "work/avatar-lab/VD/review-packet.json"), join(MAIN, "work/avatar-lab/VD/review-packet.json")].find(existsSync) ?? "review-packet.json");
if (!existsSync(listFile)) { console.error(`error: no shot list (looked for work/avatar-lab/VD/review-packet.json here and in ${MAIN}); give --shots <file>`); process.exit(1); }
const L = JSON.parse(readFileSync(listFile, "utf8"));
// the designer's own corrections to this list (the JSON addendum in VD/ABSTRACT-AND-WARDROBE.md); a shot marked "revised" keeps its camera
const addFile = join(dirname(listFile), "ABSTRACT-AND-WARDROBE.md"); let addendum: any = null;
if (!flag("shots") && existsSync(addFile)) { const m = readFileSync(addFile, "utf8").match(/```json\n([\s\S]*?)```/); if (m) try { addendum = JSON.parse(m[1]); } catch { /* not used */ } }
const corrections: string[] = [];
for (const [id, c] of Object.entries<any>(addendum?.corrections_to_packet_1 ?? {})) { const s = L.shots.find((x: any) => x.id === id); if (s && !s.revised) { Object.assign(s, c); corrections.push(id); } }

const quick = has("quick"), scale = Number(flag("scale") ?? 1), doMetrics = !has("no-metrics"), doBench = !has("no-bench");
const only = flag("only")?.split(",").map((x) => x.trim()).filter(Boolean), personFilter = flag("persons")?.split(",");
const styles = (flag("styles") ?? "dressed,clay").split(","), tonesWanted = flag("tones")?.split(",");
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const runName = flag("run") ?? `${quick ? "quick" : "full"}-${stamp}`;
const outBase = resolve(flag("out") ?? join(MAIN, "work", "manikin-v1-packets"));
const out = join(outBase, runName);
if (/(^|[\\/])\.\.?([\\/]|$)/.test(runName) || /[^A-Za-z0-9_.-]/.test(runName)) { console.error("error: --run takes a plain folder name"); process.exit(1); }
if (!has("list")) { mkdirSync(join(out, "shots"), { recursive: true }); mkdirSync(join(out, "sheets"), { recursive: true }); }
const PERSONS = [...TOOL.persons, ...(personFilter ?? []).filter((p) => !TOOL.persons.includes(p))];
const wantPerson = (p: string) => PERSONS.includes(p) && (!personFilter || personFilter.includes(p));

// ---- packages --------------------------------------------------------------------------------------------------------------
const PKG_DIR = join(ROOT, "assets", "manikin");
interface Pkg { key: string; style: string; sex: string; url: string; manifest: any; explicit: Record<string, any>; presets: Set<string> }
const pkgs = new Map<string, Pkg>();
function pkgFor(style: string, sex: string): Pkg | null {
  const key = `${style === "clay" ? "clay" : "operator"}-${sex}`;
  if (pkgs.has(key)) return pkgs.get(key)!;
  const file = join(PKG_DIR, key, `${key}.avatar.json`); if (!existsSync(file)) return null;
  const manifest = JSON.parse(readFileSync(file, "utf8")), pf = join(PKG_DIR, key, manifest.posesFile ?? "poses.json");
  const list: any[] = manifest.poses ?? (existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : []);
  const p: Pkg = { key, style, sex, url: `asset/manikin/${key}/${key}.avatar.json`, manifest, explicit: Object.fromEntries(list.flatMap((x) => [[x.id ?? x.name, x], [x.name, x]])), presets: new Set((manifest.shape?.presets ?? []).map((x: any) => x.name)) };
  pkgs.set(key, p); return p;
}
const sexOf = (person: string) => (person.startsWith("F") ? "f" : "m");

// ---- the shot list, expanded -------------------------------------------------------------------------------------------------
type Kind = "seated" | "standing" | "product";
interface Img {
  id: string; set: string; pass: string; sheet: string; person: string; pkg: Pkg; style: string; tone: string | null; kind: Kind;
  pose: string; dofs?: Record<string, number>; named?: string; clip?: string; script?: string; time?: number; view?: string;
  az: number; el: number; camName: string; dist: number; fov: number; target: any; offset?: number[]; handView?: string;
  res: number[]; file: string; label: string; labLighting: string; notes: string[];
}
const images: Img[] = [], skipped: string[] = [], skip = (s: string) => { if (!skipped.includes(s)) skipped.push(s); };
const fileOf = (id: string, person: string, az: string | number, style: string, tone: string | null) => `shots/${id}__${person}__az${az}__${style}${tone ? "__" + tone : ""}.png`;
const derived: Record<string, string> = {};
/** Clinical angles (right limb) -> the package's dof values, from the package's own single-angle poses (poses.json entries whose
 *  `clinical` names exactly one angle, e.g. E24 = neck_rotation_right 70): dof per degree = the pose's dof / the angle. */
function clinical(pkg: Pkg, angles: Record<string, number>, base: Record<string, number>): Record<string, number> | null {
  const outD = { ...base };
  for (const [k, v] of Object.entries(angles)) {
    let per: Record<string, number> | null = null;
    for (const x of Object.values<any>(pkg.explicit)) {
      const cl = x.clinical ?? {}, nums = Object.entries(cl).filter(([kk, vv]) => typeof vv === "number" && kk !== "base_pose");
      if (nums.length !== 1 || nums[0][0] !== k || x.seated || cl.base_pose) continue;
      const ang = nums[0][1] as number; per = {};
      for (const [dof, dv] of Object.entries<number>(x.dofs ?? {})) if (!/^(thumb|index|middle|ring|pinky)_/.test(dof) && dv) per[dof] = dv / ang;
      derived[`${pkg.key}: ${k}`] = `from the package's pose ${x.id ?? x.name} (${k} ${ang})`; break;
    }
    if (!per) { skip(`clinical angle ${k} in ${pkg.key} (no single-angle pose of the package gives it)`); return null; }
    for (const [dof, f] of Object.entries(per)) outD[dof] = (outD[dof] ?? 0) + f * v;
  }
  return outD;
}
/** dof values of a standing pose of the package (its packet block, then its pose list) */
function standingDofs(pkg: Pkg, name: string): Record<string, number> | null {
  const p = pkg.manifest.packet?.poses?.[name]?.dofs ?? pkg.explicit[name]?.dofs;
  if (!p) { skip(`pose ${name} (not in ${pkg.key})`); return null; }
  if (pkg.manifest.packet?.poses?.[name]?.clip) derived[`${pkg.key}: ${name}`] = "with a head turn added: the package's dof values of that clip frame plus the turn (a clip frame takes no dof offsets)";
  return { ...p };
}
// the designer's early-gate list ("A1 (M50; az 0, 45, 90, 180)", "E-crit poses for M50, first view, beauty and clay", ...)
interface QuickRule { persons?: string[]; men?: boolean; az?: number[]; handViews?: string[]; all?: boolean }
const Q = new Map<string, QuickRule>();
for (const str of quick ? L.quick_packet?.shots ?? [] : []) {
  const id = str.match(/^\S+/)![0], r: QuickRule = {};
  if (id === "E-crit") r.persons = Object.keys(L.persons).filter((p) => new RegExp(`\\b${p}\\b`).test(str));
  for (const part of (str.match(/\(([^)]*)\)/)?.[1] ?? "").split(";").map((x: string) => x.trim()).filter(Boolean)) {
    if (/^az /.test(part)) r.az = part.slice(3).split(",").map(Number);
    else for (const t of part.split(",").map((x: string) => x.trim())) { if (L.persons[t]) (r.persons ??= []).push(t); else if (t === "men") r.men = true; else if (/^(dorsal|palmar|radial)$/.test(t)) (r.handViews ??= []).push(t); }
  }
  Q.set(id, r);
}
Q.set("G3", { persons: ["F05", "M50", "M95H"] }); Q.set("F9", { persons: ["M50"] });
const QUICK_CLAY: Record<string, QuickRule> = { A2: { persons: ["M50"], az: [45] }, C1: { persons: ["M50"], az: [35] }, F1: { persons: ["M50"] }, F2: { persons: ["M50"] }, G3: { persons: ["F05", "M50", "M95H"] } };
const QUICK_TONES: Record<string, QuickRule> = { C1: { persons: ["M50"], az: [35] }, F1: { persons: ["M50"] } };
const FULL_TONES: Record<string, QuickRule> = { A1: { az: [0], all: true }, C1: { az: [35], all: true }, F1: { all: true } };          // every review person, in each tone
const onlyOk = (id: string, set: string, pass: string) => !only || only.some((x) => x === id || x === set || x === pass || (x === "E" && id.startsWith("E")));
const ruleFor = (pass: string, id: string): QuickRule | null | undefined => pass === "tones" ? (quick ? QUICK_TONES : FULL_TONES)[id] ?? null : pass === "clay" && quick ? QUICK_CLAY[id] ?? null : quick ? (Q.has(id) ? Q.get(id)! : null) : undefined;
function personsOf(list: string[], rule: QuickRule | undefined, shot: string): string[] {
  const out: string[] = [];
  for (const p of list) {
    if (rule?.persons && !rule.persons.includes(p)) continue;
    if (rule?.men && !p.startsWith("M")) continue;
    if (!wantPerson(p)) { if (!personFilter) skip(`person ${p} in ${shot} (not one of the manikin v1 review persons; --persons ${p} adds it)`); continue; }
    out.push(p);
  }
  return out;
}

const TONES_OF = (pkg: Pkg) => (pkg.manifest.tones?.list ?? []).map((t: any) => t.id) as string[];
function add(pass: string, s: any, person: string, o: Partial<Img> & { kind: Kind; pose: string; az: number; el: number; camName: string; target: any; res: number[]; tone?: string | null; sub?: string }) {
  const style = pass === "clay" ? "clay" : "dressed", pkg = pkgFor(style, sexOf(person));
  if (!pkg) { skip(`${style} package for ${person}`); return; }
  if (!pkg.presets.has(person)) { skip(`person ${person} (no shape preset in ${pkg.key})`); return; }
  const cam = L.cameras[o.camName]; if (!cam) { skip(`shot ${s.id}: camera ${o.camName} unknown`); return; }
  const id = `${s.id}${o.sub ? "-" + o.sub : ""}`, tone = pass === "tones" ? "@tone" : o.tone ?? null, set = s.set ?? s.id[0];
  const file = fileOf(id, person, o.handView ?? o.az, style, tone);
  if (images.some((x) => x.file === file)) return;
  const sheet = tone ? "tones" : `${style}-${set}`;
  const im: Img = { ...(o as any), id, set, pass, sheet, person, pkg, style, tone, dist: cam.distance, fov: cam.fov_v_deg, res: o.res.map((x) => Math.round(x * scale)), file, labLighting: s.lighting ?? "", notes: [...(o.notes ?? [])],
    label: `${id} · ${person} · ${o.pose} · ${o.handView ?? (o.kind === "product" ? o.view : "az " + o.az)} · ${style}${tone ? " " + tone : ""}${o.kind === "seated" ? " · in the seat" : o.kind === "standing" ? " · beside the rig" : ""}` };
  images.push(im);
}
function expandShot(pass: string, s: any) {
  const set = s.set ?? s.id[0];
  const romPick = !!s.poses_from && !!only?.some((x) => (L.rom_poses ?? []).some((r: any) => r.id === x));   // --only E16 picks one range-of-motion pose
  if (!onlyOk(s.id, set, pass) && !romPick) return;
  const rule = ruleFor(pass, s.id); if (rule === null) return;
  const modes: string[] = s.modes ?? L.rom_defaults?.modes_first_view ?? ["beauty"];
  const inPass = (m: string) => (pass === "clay" ? m === "beauty" || m === "clay" : m === "beauty");
  for (const m of modes) if (m === "wire" || m === "checker") skip(`shot ${s.id}, mode ${m} (not a mode of the product viewer)`);
  if (pass !== "clay" && !modes.includes("beauty") && modes.includes("clay")) skip(`shot ${s.id} in the dressed pass (the lab's grey clay mode does not exist in the product: rendered in the clay pass)`);
  if (s.poses_from) {                                                              // range of motion
    const D = L[s.defaults], ids: string[] | null = s.poses_from === "rom_critical_12" ? L.rom_critical_12 : null;
    for (const r of L.rom_poses) {
      if (ids && !ids.includes(r.id)) continue;
      if (romPick && !onlyOk(s.id, set, pass) && !only!.includes(r.id)) continue;
      if (r.base_pose && /SEATED/.test(r.base_pose)) { skip(`range-of-motion pose ${r.id} ${r.name} (a dof pose on the lab's plain seat; the product seats a person only through the operator layer)`); continue; }
      const views: number[] = s.views === "first" || quick ? [r.views[0]] : r.views;
      for (const person of personsOf(rule?.persons?.length ? rule.persons : s.persons, undefined, s.id)) views.forEach((az, vi) => {
        const ms: string[] = vi === 0 ? D.modes_first_view : D.modes_other_views;
        if (!ms.some(inPass)) return;
        const style = pass === "clay" ? "clay" : "dressed", pkg = pkgFor(style, sexOf(person)); if (!pkg) return;
        const dofs = pkg.explicit[r.id]?.dofs; if (!dofs) { skip(`pose ${r.id} (not in ${pkg.key})`); return; }
        add(pass, { id: r.id, set: "E", lighting: D.lighting }, person, { kind: "standing", pose: r.name, dofs, az, el: r.el ?? D.el, camName: r.camera ?? D.camera, target: r.target, res: D.resolution });
      });
    }
    return;
  }
  if (!modes.some(inPass)) return;
  if (s.clip && s.clip !== "OPERATE") {                                           // a standing clip (the walk): frames of the package's clip, beside the rig
    for (const person of personsOf(s.persons, rule, s.id)) {
      const style = pass === "clay" ? "clay" : "dressed", pkg = pkgFor(style, sexOf(person)), c = pkg?.manifest.packet?.clips?.[s.clip];
      if (!pkg || !c?.clip || !(pkg.manifest.clips ?? []).some((x: any) => x.name === c.clip)) { skip(`shot ${s.id}: ${s.what} (${pkg?.key ?? style} has no clip for ${s.clip})`); continue; }
      const f = s.frames, dur = c.duration ?? 4, times: number[] = f.times_s ?? (f.fps ? Array.from({ length: f.count }, (_, k) => f.start_s + k / f.fps) : Array.from({ length: f.count }, (_, k) => (k * dur) / f.count));
      times.forEach((t, k) => add(pass, s, person, { kind: "standing", sub: "t" + String(k).padStart(2, "0"), pose: `${c.clip} t=${t.toFixed(2)} s`, clip: c.clip, time: +(t % dur).toFixed(4), az: s.az[0], el: s.el ?? 0, camName: s.camera, target: s.target, res: s.resolution, notes: s.target_follows_root ? ["the figure is kept on its spot (the walk's root travel taken out), the camera follows"] : [] }));
    }
    return;
  }
  if (s.clip) {
    const f = s.frames, times: number[] = f.times_s ?? (f.fps ? Array.from({ length: f.count }, (_, k) => f.start_s + k / f.fps) : Array.from({ length: f.count }, (_, k) => (k * 8) / f.count));
    for (const person of personsOf(s.persons, rule, s.id)) times.forEach((t, k) => add(pass, s, person, { kind: "seated", sub: "t" + String(k).padStart(2, "0"), pose: `operate8 t=${t.toFixed(2)} s`, script: "operate8", time: t, az: s.az[0], el: s.el ?? 0, camName: s.camera, target: s.target, res: s.resolution }));
    return;
  }
  if (s.hand || s.hands || s.hand_views) {                                         // hands, standing
    if (s.prop) { skip(`shot ${s.id}: ${s.what} (the product has no stand-in cylinder; the hands on the real grips are F5, F6)`); return; }
    const views: string[] = (rule?.handViews ?? s.hand_views ?? ["dorsal"]).filter((v: string) => (s.hand_views ?? ["dorsal"]).includes(v));
    for (const hp of s.hands ?? [s.hand]) for (const person of personsOf(s.persons, rule, s.id)) {
      const style = pass === "clay" ? "clay" : "dressed", pkg = pkgFor(style, sexOf(person)); if (!pkg) continue;
      const base = standingDofs(pkg, s.pose), hand = pkg.explicit[hp]?.dofs; if (!base) continue;
      if (!hand) { skip(`hand pose ${hp} (not in ${pkg.key})`); continue; }
      for (const view of views) add(pass, s, person, { kind: "standing", sub: s.hands ? hp : undefined, pose: `${s.pose} + ${hp}`, dofs: { ...base, ...hand }, az: 0, el: 0, handView: view, camName: s.camera, target: s.target, res: s.resolution });
    }
    return;
  }
  if (!s.pose || !s.az) { skip(`shot ${s.id}: ${s.what} (shot type not rendered by this tool)`); return; }
  const azs: number[] = rule?.az ? s.az.filter((a: number) => rule.az!.includes(a)) : s.az;
  const seated = /SEATED/.test(s.pose);
  let persons: string[] = s.persons ?? [];
  if (s.group) {                                                                    // a line-up: one person at a time (the product shows one person)
    persons = s.group.map((g: any) => g.person);
    skip(`shot ${s.id}: ${s.what} as a line-up (the product shows one person at a time: rendered as a series, same camera, one person each)`);
  }
  for (const person of personsOf(rule?.all ? PERSONS : persons, rule, s.id)) {
    const style = pass === "clay" ? "clay" : "dressed", pkg = pkgFor(style, sexOf(person)); if (!pkg) continue;
    let dofs: Record<string, number> | undefined, named: string | undefined, time: number | undefined;
    const pk = pkg.manifest.packet?.poses?.[s.pose];
    if (!seated && pk?.clip && !s.pose_override) { named = s.pose; time = pk.time ?? 0; }       // a clip frame (RELAXED_STAND = idle-stand at 1.0 s): the product resolves the name
    else if (!seated) { const b = standingDofs(pkg, s.pose); if (!b) continue; dofs = b; if (s.pose_override) { const c = clinical(pkg, s.pose_override, b); if (!c) continue; dofs = c; } }
    const target = s.group && !seated ? "body_centre" : s.target;
    for (const az of azs) add(pass, s, person, { kind: seated ? "seated" : "standing", pose: s.pose + (s.pose_override ? " + " + Object.entries(s.pose_override).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") : ""), dofs, named, time, script: seated ? "hold" : undefined,
      az, el: s.el ?? 0, camName: s.camera, target, offset: s.target_offset, res: s.resolution, notes: s.group ? ["series: one person of the line-up"] : [] });
  }
}
const PRODUCT_VIEWS: [string, string, string][] = [["P1", "three_quarter", "the viewer's default view (Overview)"], ["P2", "operator", "the operator's eye view onto the screens"], ["P3", "front", "Front"], ["P4", "left", "Left"]];
function productViews(pass: string) {
  if (pass === "tones") return;
  for (const [id, view, what] of PRODUCT_VIEWS) {
    if (!onlyOk(id, "P", pass)) continue;
    const list = quick ? (pass === "clay" ? [] : ["M50", "F05"]) : PERSONS;
    for (const person of list.filter(wantPerson)) add(pass, { id, set: "P", lighting: "product" }, person, { kind: "product", pose: "seated, " + what, view, script: "hold", az: 0, el: 0, camName: "seated", target: null, res: [1600, 1000] });
  }
}
for (const pass of ["dressed", "clay", "tones"]) {
  if (pass !== "tones" && !styles.includes(pass)) continue;
  if (pass === "tones" && !styles.includes("dressed")) continue;
  const before = images.length;
  for (const s of L.shots) expandShot(pass, s);
  productViews(pass);
  if (pass === "tones") {                                                          // the tones pass: each image once per non-default tone
    const made = images.splice(before);
    for (const im of made) for (const t of TONES_OF(im.pkg).filter((x) => x !== im.pkg.manifest.tones?.default && (!tonesWanted || tonesWanted.includes(x)))) {
      const file = fileOf(im.id, im.person, im.handView ?? im.az, im.style, t);
      images.push({ ...im, tone: t, sheet: "tones", file, label: im.label.replace("@tone", t), notes: [...im.notes] });
    }
  }
}
if (!images.length && !(only?.length === 1 && only[0] === "none")) { console.error("nothing to render (check --only / --persons / --styles)"); process.exit(1); }
if (has("list")) {                                                                 // a dry run: what would be rendered, and what not
  const by = new Map<string, number>(); for (const im of images) by.set(im.sheet, (by.get(im.sheet) ?? 0) + 1);
  console.log(`${images.length} image(s): ${[...by].map(([k, n]) => `${k} ${n}`).join(", ")}\nskipped:\n  ${skipped.join("\n  ")}`);
  process.exit(0);
}

// ---- the page side: a small helper installed in every viewer page --------------------------------------------------------------
const PAGE_HELPER = String.raw`(() => {
  const P = viewer.person, av = () => P.avatar(), holder = () => P.object(), scene = () => holder().parent;
  const V3 = holder().position.constructor, Q4 = holder().quaternion.constructor, M4 = holder().matrixWorld.constructor;
  const ITEMS = [...viewer.manifest().components, ...viewer.manifest().surfaces], CONTACT = new RegExp(${JSON.stringify(TOOL.fit.contactParts)});
  const D = Math.PI / 180, m2w = (p) => new V3(p[0], p[2], -p[1]), w2m = (v) => [v.x, -v.z, v.y];
  const r4 = (x) => Math.round(x * 1e4) / 1e4, mm = (x) => Math.round(x * 10000) / 10;
  async function redraw() { P.still(true); await viewer.frame(); }
  function place(origin, yawDeg) { return P.place(origin ? { origin, yawDeg } : null); }
  function anchorW(name) {
    const a = av(); a.holder.updateMatrixWorld(true);
    { const m = P.anchor(name); if (m) return m2w(m); }
    if (name === "seated_centre") { const pel = a.anchor("pelvis"), b = a.bounds(); return new V3(pel.x, b.max.y / 2, pel.z); }
    return a.anchor(name);
  }
  const rootQ = () => av().root.getWorldQuaternion(new Q4());
  function handView(side, view) {          // where the back of the hand, the palm or the thumb side faces (package frame)
    const s = side.toLowerCase(), A = (n) => anchorW(n + "_" + s), h = A("hand"), i = A("index_01"), k = A("pinky_01"), t = A("thumb_01");
    if (!h || !i || !k || !t) return null;
    const n = new V3().crossVectors(i.clone().sub(h), k.clone().sub(h)).normalize(); if (n.dot(t.clone().sub(h)) < 0) n.negate();
    const v = view === "radial" ? i.clone().sub(k).normalize() : n.clone().multiplyScalar(view === "dorsal" ? -1 : 1);
    v.applyQuaternion(rootQ().invert());
    return { az: Math.atan2(v.x, v.z) / D, el: Math.asin(Math.max(-1, Math.min(1, v.y))) / D };
  }
  /** hand and wrist shots aim at the palm's centre when the package names one (anchor hand_centre_L / _R) */
  const HAND_CENTRE = { hand_R: "hand_centre_R", hand_L: "hand_centre_L", "joint:wrist_R": "hand_centre_R", "joint:wrist_L": "hand_centre_L" };
  const handCentre = (name) => { const n = HAND_CENTRE[name]; const m = n ? P.anchor(n) : null; return m ? { name: n, at: m2w(m) } : null; };
  /** engine.ts clamps the orbit target to ${TOOL.orbitBox} m in world x and z (model x and y) round the rig; a look-at point outside is
   *  moved and the view swings away from the target. The look-at point is therefore put on the same line of sight, inside the box. */
  const ORBIT_BOX = ${TOOL.orbitBox} - 0.05;
  function camera(o) {                     // the designer's camera convention in the person's frame -> the viewer's camera (model frame)
    const q = rootQ(); let found = true, T, aimed = Array.isArray(o.target) ? "point" : o.target;
    if (Array.isArray(o.target)) T = av().root.localToWorld(new V3(o.target[0], o.target[1], o.target[2]));
    else { const hc = handCentre(o.target); if (hc) { T = hc.at; aimed = hc.name; } else { T = anchorW(o.target); if (!T) { found = false; T = anchorW(o.seated ? "seated_centre" : "body_centre"); } } }
    if (o.offset) T.add(new V3(o.offset[0], o.offset[1], o.offset[2]).applyQuaternion(q));
    const dir = new V3(Math.sin(o.az * D) * Math.cos(o.el * D), Math.sin(o.el * D), Math.cos(o.az * D) * Math.cos(o.el * D)).applyQuaternion(q);
    const C = T.clone().addScaledVector(dir, o.dist);
    let A = T.clone(); const inBox = (v) => Math.abs(v.x) <= ORBIT_BOX && Math.abs(v.z) <= ORBIT_BOX;
    if (!inBox(A)) { const d = T.clone().sub(C); search: for (let k = 1; k <= 500; k++) for (const f of [1 + k * 0.01, 1 - k * 0.01]) { if (f <= 0.05) continue; const v = C.clone().addScaledVector(d, f); if (inBox(v)) { A = v; break search; } } }
    return { camera: [...w2m(C), ...w2m(A), o.fov].map((x) => +x.toFixed(5)), target_found: found, aimed_at: aimed, target_point: w2m(T).map(r4), look_at_moved_m: r4(A.distanceTo(T)) };
  }
  const ANCH = ["eye_midpoint", "head_centre", "hand_L", "hand_R", "pelvis", "feet"];
  /** What the rig hides of the person, from the camera: the person's vertices (read back) projected into cells of the picture, the
   *  nearest one per cell is the person's visible surface there; a sample of cells is picked against the rig (the person is not in
   *  the pick list), and a cell is hidden when a rig surface lies in front of the person's. Named points use their cell. */
  /** the person's vertices of this shot's pose, read back once (newPose() at the start of every shot) */
  let vertsCache = null; const verts = () => (vertsCache ??= personVertices());
  function newPose() { vertsCache = null; }
  /** the person's visible surface per cell of the picture, from the current camera */
  function cellsNow() {
    const st = viewer.state(), cam = st.camera.position, tg = st.camera.target, w = st.frame.w, h = st.frame.h;
    const fwd = [tg[0] - cam[0], tg[1] - cam[1], tg[2] - cam[2]], fl = Math.hypot(...fwd); for (let k = 0; k < 3; k++) fwd[k] /= fl;
    const CS = Math.max(6, Math.round(Math.min(w, h) / 80)), cells = new Map(), dist = (p) => Math.hypot(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]);
    for (const m of verts()) for (let v = 0; v < m.P.length / 3; v += 2) {
      const p = [m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]], q = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
      if (q[0] * fwd[0] + q[1] * fwd[1] + q[2] * fwd[2] < 0.05) continue;
      const [x, y] = viewer.project(p); if (!(x >= 0 && y >= 0 && x < w && y < h)) continue;
      const k = Math.floor(x / CS) + "," + Math.floor(y / CS), d = Math.hypot(...q), c = cells.get(k);
      if (!c || d < c.d) cells.set(k, { d, x, y, p, region: regionOf(m.names[m.dom[v]]) });
    }
    return { st, cam, w, h, CS, cells, dist };
  }
  /** How much of what the shot is meant to show (the person's surface within R of the subject points) the rig leaves visible */
  function subjectSight(subjects, R, maxCells = 160) {
    const { cells, dist } = cellsNow(), pts = subjects.map((n) => { const hc = handCentre(n); const v = hc ? hc.at : anchorW(n); return v ? w2m(v) : null; }).filter(Boolean);
    const near = [...cells.values()].filter((c) => pts.some((q) => Math.hypot(c.p[0] - q[0], c.p[1] - q[1], c.p[2] - q[2]) <= R));
    const stride = Math.max(1, near.length / maxCells), by = {}; let sampled = 0, hidden = 0;
    for (let i = 0; i < near.length; i += stride) { const c = near[Math.floor(i)], hit = viewer.pickAt(c.x, c.y); sampled++;
      const gap = hit ? c.d - dist(hit.point) : -1;                   // how far the rig surface lies in front of the person's
      if (hit && gap > ${TOOL.hiddenMargin} && !(CONTACT.test(hit.id) && gap < ${TOOL.fit.contactDepth})) { hidden++; by[hit.id] = (by[hit.id] ?? 0) + 1; } }
    const share = Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, Math.round((n / Math.max(1, sampled)) * 1000) / 1000]));
    return { cells: near.length, sampled, visible_share: sampled ? Math.round((1 - hidden / sampled) * 1000) / 1000 : null, hidden_by: share };
  }
  /** The camera nearest the designer's that shows the shot's subject past the rig: the designer's own when enough of the subject is
   *  visible (o.trigger); else the cheapest change of azimuth, elevation and distance (within o.maxDeg, o.maxMove metres) that shows
   *  o.accept of it; else the designer's camera with the rig parts in front of the subject hidden. */
  async function subjectAt(o) { const c = camera(o); await viewer.apply({ ui: "0", camera: c.camera.join(",") }); return subjectSight(o.subjects, o.R).visible_share; }
  async function fitCamera(o) {
    const at = async (daz, del, dk, hide = []) => {
      const c = camera({ ...o, az: o.az + daz, el: o.el + del, dist: o.dist * dk });
      await viewer.apply({ ui: "0", camera: c.camera.join(","), ...(hide.length ? { hide: hide.join(",") } : {}) });
      const s = subjectSight(o.subjects, o.R), cam = viewer.state().camera.position;
      const inside = ITEMS.filter((it) => it.bbox && it.triangles > 0 && !hide.includes(it.id) && [0, 1, 2].every((k) => cam[k] > it.bbox.min[k] && cam[k] < it.bbox.max[k])).map((it) => it.id);
      return { daz, del, dk, camera: c.camera, visible: s.visible_share, hidden_by: s.hidden_by, inside, hide };
    };
    const good = (r, need) => r.visible !== null && r.visible >= need && !r.inside.length;
    const base = await at(0, 0, 1);
    if (good(base, o.trigger)) return { changed: false, designer: base, used: base, tried: 1 };
    const steps = (max, s) => { const out = [0]; for (let v = s; v <= max; v += s) out.push(v, -v); return out; };
    const cands = [];
    for (const daz of steps(o.maxDeg, 5)) for (const del of steps(o.maxDeg, 5)) for (const dk of [1, 0.9, 0.8, 0.7, 0.6]) {
      if ((!daz && !del && dk === 1) || o.dist * (1 - dk) > o.maxMove + 1e-9 || o.el + del > 85 || o.el + del < -30) continue;
      cands.push({ daz, del, dk, cost: Math.abs(daz) / 5 + Math.abs(del) / 5 + (o.dist * (1 - dk)) / 0.1 });
    }
    cands.sort((a, b) => a.cost - b.cost);
    let best = null, tried = 1;
    for (const c of cands.slice(0, o.maxTries)) { const r = await at(c.daz, c.del, c.dk); tried++;
      if (!r.inside.length && (!best || (r.visible ?? -1) > (best.visible ?? -1))) best = r;
      if (good(r, o.accept)) { best = r; break; } }
    const moved = best && (best.visible ?? 0) > (base.visible ?? 0) ? best : null;
    if (moved && good(moved, o.trigger)) return { changed: true, how: "moved", designer: base, used: moved, tried };
    // hide what stands in front of the subject, layer by layer (behind a hidden part there may be another), at most three rounds
    let hide = [], used = base;
    for (let round = 0; round < 3 && !good(used, o.accept); round++) {
      const more = [...Object.entries(used.hidden_by).filter(([, v]) => v >= 0.03).map(([k]) => k), ...used.inside].filter((k) => !CONTACT.test(k) && !hide.includes(k));
      if (!more.length) break;
      hide = [...hide, ...more]; used = await at(0, 0, 1, hide); tried++;
    }
    // the better of the two; a moved camera wins a near tie, because it leaves the rig whole
    if (moved && (!hide.length || (moved.visible ?? 0) >= (used.visible ?? 0) - 0.05)) return { changed: true, how: "moved", designer: base, used: moved, tried };
    if (!hide.length || (used.visible ?? 0) <= (base.visible ?? 0)) return { changed: false, kept: true, designer: base, used: base, tried };
    return { changed: true, how: "hidden", designer: base, used, tried };
  }
  function sight(targetModel, maxCells = 320) {
    const { st, cam, w, h, CS, cells, dist } = cellsNow();
    const pick = (x, y) => { const hit = viewer.pickAt(x, y); return hit ? { id: hit.id, d: dist(hit.point) } : null; };
    const allCells = Math.ceil(w / CS) * Math.ceil(h / CS), nearCells = [...cells.values()].filter((c) => c.d < 0.15).length;
    const all = [...cells.values()], stride = Math.max(1, all.length / maxCells), by = {}, regions = {};
    let sampled = 0, hidden = 0;
    for (let i = 0; i < all.length; i += stride) {
      const c = all[Math.floor(i)], hit = pick(c.x, c.y); sampled++;
      if (hit && hit.d < c.d - ${TOOL.hiddenMargin}) { hidden++; by[hit.id] = (by[hit.id] ?? 0) + 1; regions[c.region] = (regions[c.region] ?? 0) + 1; }
    }
    const share = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, Math.round((n / Math.max(1, sampled)) * 1000) / 1000]));
    const points = {}, pts = Object.fromEntries(ANCH.map((n) => { const v = anchorW(n); return [n, v ? w2m(v) : null]; }));
    if (targetModel) pts.target = targetModel;
    for (const [n, p] of Object.entries(pts)) {
      if (!p) continue;
      const [x, y] = viewer.project(p);
      if (!(x >= 0 && y >= 0 && x < w && y < h)) { points[n] = { in_frame: false }; continue; }
      const c = cells.get(Math.floor(x / CS) + "," + Math.floor(y / CS)), d = c ? c.d : dist(p), hit = pick(x, y);
      points[n] = hit && hit.d < d - ${TOOL.hiddenMargin} ? { in_frame: true, hidden_by: hit.id, in_front_m: r4(d - hit.d) } : { in_frame: true };
    }
    const inside = ITEMS.filter((c) => c.bbox && c.triangles > 0 && [0, 1, 2].every((k) => cam[k] > c.bbox.min[k] && cam[k] < c.bbox.max[k])).map((c) => c.id);
    const eye = anchorW("eye_midpoint"), e = eye ? w2m(eye) : null;
    return { person_cells: all.length, own_body_within_150mm_share: Math.round((nearCells / allCells) * 1000) / 1000, sampled, visible_share: sampled ? Math.round((1 - hidden / sampled) * 1000) / 1000 : null, hidden_by: share(by), hidden_regions: share(regions),
      points, camera_inside: inside, camera_to_person_eye_mm: e ? mm(Math.hypot(e[0] - cam[0], e[1] - cam[1], e[2] - cam[2])) : null, camera: st.camera };
  }
  // ---- the person's vertices as its shader skins them (Avatar.skinnedPositions: shape, morphs, eight influences, the dual-quaternion
  // mask; not the seat-contact flatten), model frame, with each vertex's heaviest joint for the body region
  function personVertices() {
    const a = av(), out = []; a.holder.updateMatrixWorld(true);
    for (const me of a.meshes) {
      if (!me.visible || me.userData.hidden) continue;
      const cls = me.userData.cls ?? "plain"; if (/^(eye|cornea|lashes|lens|glass)/.test(cls) || /glass|lens|eye|lash|cornea/i.test(me.material?.name ?? "")) continue;
      const g = me.geometry, W = a.skinnedPositions(me), n = g.attributes.position.count, si = [g.attributes.skinIndex, g.attributes.skinIndex1], sw = [g.attributes.skinWeight, g.attributes.skinWeight1];
      const P3 = new Float32Array(n * 3), dom = new Int16Array(n);
      for (let v = 0; v < n; v++) {
        P3[v * 3] = W[v * 3]; P3[v * 3 + 1] = -W[v * 3 + 2]; P3[v * 3 + 2] = W[v * 3 + 1];
        let best = -1, bw = 0; for (let k = 0; k < 2; k++) { const I = si[k], Wt = sw[k]; if (!I || !Wt) continue; for (let c = 0; c < 4; c++) { const w = Wt.getComponent(v, c); if (w > bw) { bw = w; best = I.getComponent(v, c); } } }
        dom[v] = best;
      }
      out.push({ name: me.name, cls, P: P3, dom, names: me.skeleton.bones.map((b) => b.name) });
    }
    return out;
  }
  const regionOf = (n) => { if (!n) return "other"; const s = /_l$/.test(n) ? "_l" : /_r$/.test(n) ? "_r" : "";
    return /^(hand|thumb|index|middle|ring|pinky)/.test(n) ? "hand" + s : /^(foot|ball|toe)/.test(n) ? "foot" + s : /^calf/.test(n) ? "shin" + s : /^thigh/.test(n) ? "thigh" + s
      : /^pelvis/.test(n) ? "pelvis" : /^(spine|clavicle)/.test(n) ? "trunk" : /^(upperarm|lowerarm)/.test(n) ? "arm" + s : /^(neck|head)/.test(n) ? "head" : "other:" + n; };
  // ---- the rig's triangles, model frame, per component, with a 3D grid for nearest-surface queries and a 2D grid for the inside test
  let rigCache = null; const CELL = 0.04;
  function rig() {
    if (rigCache) return rigCache;
    const by = new Map(), v = new V3();
    const meshes = []; scene().updateMatrixWorld(true);
    scene().traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && o.userData?.comp) meshes.push(o); });
    for (const m of meshes) {
      const comp = m.userData.comp; if (!m.geometry?.attributes?.position) continue;
      const g = m.geometry, pos = g.attributes.position, idx = g.index ? g.index.array : null, cnt = idx ? idx.length : pos.count;
      const e = by.get(comp) ?? { comp, T: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let i = 0; i < cnt; i++) { v.fromBufferAttribute(pos, idx ? idx[i] : i).applyMatrix4(m.matrixWorld); const q = [v.x, -v.z, v.y]; e.T.push(q); for (let k = 0; k < 3; k++) { e.min[k] = Math.min(e.min[k], q[k]); e.max[k] = Math.max(e.max[k], q[k]); } }
      by.set(comp, e);
    }
    for (const e of by.values()) {
      const nT = e.T.length / 3; e.n = nT; e.grid = new Map(); e.grid2 = new Map();
      const key = (a, b, c) => a + "," + b + "," + c, edges = new Map(), wk = (p) => p.map((x) => Math.round(x * 1e4)).join(",");
      for (let t = 0; t < nT; t++) {
        const A = e.T[3 * t], B = e.T[3 * t + 1], C = e.T[3 * t + 2], lo = [0, 1, 2].map((k) => Math.min(A[k], B[k], C[k])), hi = [0, 1, 2].map((k) => Math.max(A[k], B[k], C[k]));
        for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++) for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++) {
          const k2 = x + "," + y; (e.grid2.get(k2) ?? e.grid2.set(k2, []).get(k2)).push(t);
          for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) { const k3 = key(x, y, z); (e.grid.get(k3) ?? e.grid.set(k3, []).get(k3)).push(t); }
        }
        for (const [p, q] of [[A, B], [B, C], [C, A]]) { const a = wk(p), b = wk(q), k = a < b ? a + "|" + b : b + "|" + a; edges.set(k, (edges.get(k) ?? 0) + 1); }
      }
      let open = 0; for (const c of edges.values()) if (c !== 2) open++;
      e.closed = open === 0; e.openEdges = open;
    }
    return (rigCache = [...by.values()]);
  }
  function closest(p, A, B, C) {           // closest point on triangle ABC to p (Ericson), and the face normal
    const sub = (u, w) => [u[0] - w[0], u[1] - w[1], u[2] - w[2]], dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
    const ab = sub(B, A), ac = sub(C, A), ap = sub(p, A), d1 = dot(ab, ap), d2 = dot(ac, ap);
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const at = (u, w) => [A[0] + ab[0] * u + ac[0] * w, A[1] + ab[1] * u + ac[1] * w, A[2] + ab[2] * u + ac[2] * w];
    let c;
    if (d1 <= 0 && d2 <= 0) c = A; else {
      const bp = sub(p, B), d3 = dot(ab, bp), d4 = dot(ac, bp);
      if (d3 >= 0 && d4 <= d3) c = B; else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) c = at(d1 / (d1 - d3), 0); else {
          const cp = sub(p, C), d5 = dot(ab, cp), d6 = dot(ac, cp);
          if (d6 >= 0 && d5 <= d6) c = C; else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) c = at(0, d2 / (d2 - d6)); else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); c = [B[0] + (C[0] - B[0]) * w, B[1] + (C[1] - B[1]) * w, B[2] + (C[2] - B[2]) * w]; }
              else { const den = 1 / (va + vb + vc); c = at(vb * den, vc * den); }
            }
          }
        }
      }
    }
    const d = sub(p, c); return { d2: dot(d, d), dir: d, n };
  }
  function nearest(e, p) {                 // nearest surface of a component within one grid cell around p: distance and the outward sign
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL), seen = new Set();
    let best = Infinity, sgn = 1, bestAlign = -1;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      for (const t of e.grid.get(x + "," + y + "," + z) ?? []) { if (seen.has(t)) continue; seen.add(t);
        const r = closest(p, e.T[3 * t], e.T[3 * t + 1], e.T[3 * t + 2]), nl = Math.hypot(r.n[0], r.n[1], r.n[2]) || 1, dl = Math.sqrt(r.d2) || 1e-9;
        const align = Math.abs((r.dir[0] * r.n[0] + r.dir[1] * r.n[1] + r.dir[2] * r.n[2]) / nl / dl);
        if (r.d2 < best - 1e-12 || (Math.abs(r.d2 - best) <= 1e-12 && align > bestAlign)) { best = r.d2; bestAlign = align; sgn = r.dir[0] * r.n[0] + r.dir[1] * r.n[1] + r.dir[2] * r.n[2] >= 0 ? 1 : -1; }
      }
    }
    return { d: Math.sqrt(best), sgn };
  }
  function insideParity(e, p) {            // a vertical ray up from p: an odd number of crossings is inside (closed parts only)
    let n = 0; const cand = e.grid2.get(Math.floor(p[0] / CELL) + "," + Math.floor(p[1] / CELL)) ?? [];
    for (const t of cand) {
      const A = e.T[3 * t], B = e.T[3 * t + 1], C = e.T[3 * t + 2];
      const d = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]); if (Math.abs(d) < 1e-14) continue;
      const u = ((p[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (p[1] - A[1])) / d, w = ((B[0] - A[0]) * (p[1] - A[1]) - (p[0] - A[0]) * (B[1] - A[1])) / d;
      if (u < 0 || w < 0 || u + w > 1) continue;
      if (A[2] + u * (B[2] - A[2]) + w * (C[2] - A[2]) > p[2]) n++;
    }
    return n % 2 === 1;
  }
  /** The person against every rig part: per part and body region, how deep vertices lie inside and the nearest gap outside. */
  function penetration() {
    const t0 = performance.now(), parts = rig(), verts = personVertices(), res = {}, PAD = CELL;
    let lowest = Infinity, lowestRegion = "", top = -Infinity, nv = 0;
    for (const m of verts) for (let v = 0; v < m.P.length / 3; v++) {
      const p = [m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]], reg = regionOf(m.names[m.dom[v]]); nv++;
      if (p[2] < lowest) { lowest = p[2]; lowestRegion = reg + " (" + m.name + ")"; } if (p[2] > top) top = p[2];
      for (const e of parts) {
        if (p[0] < e.min[0] - PAD || p[0] > e.max[0] + PAD || p[1] < e.min[1] - PAD || p[1] > e.max[1] + PAD || p[2] < e.min[2] - PAD || p[2] > e.max[2] + PAD) continue;
        const nr = nearest(e, p), inBox = p[0] >= e.min[0] && p[0] <= e.max[0] && p[1] >= e.min[1] && p[1] <= e.max[1] && p[2] >= e.min[2] && p[2] <= e.max[2];
        const inside = inBox && (e.closed ? insideParity(e, p) : nr.d < CELL && nr.sgn < 0);
        if (!inside && !(nr.d < CELL)) continue;
        const r = (res[e.comp] ??= { closed: e.closed, open_edges: e.openEdges, inside: 0, deepest_mm: 0, deepest_region: null, nearest_gap_mm: null, nearest_region: null, regions: {} });
        const rr = (r.regions[reg] ??= { inside: 0, over_fault: 0, deepest_mm: 0, nearest_gap_mm: null });
        if (inside) { const depth = nr.d < CELL ? nr.d * 1000 : 1000 * CELL; r.inside++; rr.inside++; if (depth > ${TOOL.faultMm}) rr.over_fault = (rr.over_fault ?? 0) + 1;
          const dp = (r.deepest_points ??= []); if (dp.length < 5 || depth > dp[dp.length - 1].depth_mm) { dp.push({ depth_mm: Math.round(depth * 10) / 10, region: reg, mesh: m.name, at_model_m: p.map(r4) }); dp.sort((x, y) => y.depth_mm - x.depth_mm); if (dp.length > 5) dp.pop(); }
          if (depth > r.deepest_mm) { r.deepest_mm = depth; r.deepest_region = reg; } if (depth > rr.deepest_mm) rr.deepest_mm = depth; }
        else { const g = nr.d * 1000; if (r.nearest_gap_mm === null || g < r.nearest_gap_mm) { r.nearest_gap_mm = g; r.nearest_region = reg; } if (rr.nearest_gap_mm === null || g < rr.nearest_gap_mm) rr.nearest_gap_mm = g; }
      }
    }
    const rd = (x) => (x === null ? null : Math.round(x * 10) / 10);
    for (const r of Object.values(res)) { r.deepest_mm = rd(r.deepest_mm); r.nearest_gap_mm = rd(r.nearest_gap_mm); for (const g of Object.values(r.regions)) { g.deepest_mm = rd(g.deepest_mm); g.nearest_gap_mm = rd(g.nearest_gap_mm); } }
    return { vertices: nv, meshes: verts.map((m) => m.name + " (" + m.cls + ")"), lowest_point_z_mm: mm(lowest), lowest_region: lowestRegion, top_z_mm: mm(top), parts: res, ms: Math.round(performance.now() - t0) };
  }
  return { place, anchorW, newPose, fitCamera, subjectAt, handView, camera, sight, redraw, penetration, rig, w2m, m2w,
    anchorModel: (n) => { const v = anchorW(n); return v ? w2m(v).map(r4) : null; },
    keyAzimuth: () => { let k = null; scene().traverse((o) => { if (!k && o.isDirectionalLight && o.castShadow) k = o; }); if (!k) return null; const p = w2m(k.position), t = w2m(k.target.position); return Math.atan2(p[1] - t[1], p[0] - t[0]) / D; } };
})()`;

// ---- server, browser, pages ------------------------------------------------------------------------------------------------
const tStart = performance.now();
const served: string[] = [];
// no shared scene (data: false): the live channel would otherwise put the scene's own person (the default man) into every page
const server = await startServer({ port: 0, data: false, requests: served });
// one build of the viewer for the whole packet: the dev server rebuilds the bundle whenever a source is newer (others edit
// viewer/src while a packet renders), so the bundle is made once here and served in front of it; everything else goes through
let frozen: Awaited<ReturnType<typeof bundleViewer>>;
try { frozen = await bundleViewer(); } catch (e: any) { console.error("error: the viewer does not bundle: " + e.message); server.stop(true); process.exit(1); }
const bundleHash = createHash("sha256").update(Object.keys(frozen.files).sort().map((k) => k + "\n" + frozen.files[k].body).join("\n")).digest("hex");
const front = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  const u = new URL(req.url); let path = decodeURIComponent(u.pathname); if (path.endsWith("/")) path += "index.html";
  const own = frozen.files[path.slice(1)];
  if (own) return new Response(path === "/index.html" ? own.body.replace("</head>", '<meta name="synergon-dev" content="1">\n</head>') : own.body, { headers: { "content-type": own.type, "cache-control": "no-store" } });
  const r = await fetch(`http://127.0.0.1:${server.port}${u.pathname}${u.search}`, { method: req.method, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer() });
  const h = new Headers(r.headers); h.delete("content-encoding"); h.delete("content-length");          // fetch has already decoded the body
  return new Response(r.body, { status: r.status, headers: h });
} });
const origin = `http://127.0.0.1:${front.port}`;
const browser = await Browser.launch();
interface PkgPage { page: Page; pkg: Pkg; cur: { person: string | null; tone: string | null }; loadMs: number; probe: Record<string, boolean>; version: any; timeApi: boolean }
const pages = new Map<string, PkgPage>();
async function openPage(pkg: Pkg, fresh = false): Promise<PkgPage> {
  if (!fresh && pages.has(pkg.key)) return pages.get(pkg.key)!;
  const t0 = performance.now();
  const page = await browser.page(`${origin}/?ui=0&person=${encodeURIComponent(pkg.url)}`);
  await page.viewport(1600, 1000);
  await page.waitFor("window.viewerReady || window.viewerError", "the viewer");
  const err = await page.evaluate("window.viewerError || null"); if (err) throw new Error(`viewer failed (${pkg.key}): ${err}`);
  const ok = await page.waitFor("viewer.person ? viewer.person.ready.then((x) => x ? 'ok' : 'failed') : null", `the person (${pkg.key})`, 90000);
  if (ok !== "ok") throw new Error(`the person did not load (${pkg.key}): ${JSON.stringify(await page.evaluate("viewer.person.state()"))}`);
  const probe = await page.evaluate("(() => { const P = viewer.person; return { place: typeof P.place === 'function', anchor: typeof P.anchor === 'function', avatar: typeof P.avatar === 'function', object: typeof P.object === 'function', skinned: typeof P.avatar?.()?.skinnedPositions === 'function', time: 'stillTime' in P.state(), manifest: typeof viewer.manifest === 'function' }; })()");
  const missing = Object.entries(probe).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`the page's person interface lacks ${missing.join(", ")} (this tool needs the person module of c85e5e8 or later)`);
  await page.evaluate(`window.pp = ${PAGE_HELPER}; true`);
  const version = await page.evaluate("fetch('version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)");
  const pp: PkgPage = { page, pkg, cur: { person: null, tone: null }, loadMs: Math.round(performance.now() - t0), probe, version, timeApi: true };
  if (!fresh) pages.set(pkg.key, pp);
  return pp;
}

// ---- standing spot: the camera's side of the rig is fixed (the key light's azimuth + keyToCameraDeg); the person stands out from
// the rig's outline on that side by standClearance, so the rig is behind the figure in every standing shot
const rigManifest = JSON.parse(readFileSync(join(ROOT, "assets", "rig-b", "build", "rig-b.manifest.json"), "utf8"));
const RB = rigManifest.totals.bbox;
let standU = 0, standSpot: number[] = [0, 0, 0];
function computeStand(keyAz: number) {
  standU = keyAz + TOOL.keyToCameraDeg;
  const c = [(RB.min[0] + RB.max[0]) / 2, (RB.min[1] + RB.max[1]) / 2], u = [Math.cos((standU * Math.PI) / 180), Math.sin((standU * Math.PI) / 180)];
  const dist = (p: number[]) => Math.hypot(Math.max(RB.min[0] - p[0], 0, p[0] - RB.max[0]), Math.max(RB.min[1] - p[1], 0, p[1] - RB.max[1]));
  let s = 0; while (dist([c[0] + u[0] * s, c[1] + u[1] * s]) < TOOL.standClearance) s += 0.005;
  standSpot = [+(c[0] + u[0] * s).toFixed(4), +(c[1] + u[1] * s).toFixed(4), 0];
}

// ---- one image ------------------------------------------------------------------------------------------------------------
interface Shot { file: string; ms: number; camera: number[] | null; sight: any; place: any; found: boolean; az: number; el: number; state?: any; fit?: any; aim?: any }
/** What a seated designer shot is meant to show, for the camera fit: its own subject (TOOL.subjectOf), or its target when that is a
 *  part of the body; null for the views of the whole person (seated_centre, body_centre, a point), which keep the designer's camera. */
function subjectsOf(im: Img): string[] | null {
  const base = im.id.replace(/-t\d+$/, "");
  if (TOOL.subjectOf[base]) return TOOL.subjectOf[base];
  if (typeof im.target !== "string" || /^(seated_centre|body_centre)$/.test(im.target)) return null;
  return im.target === "hands" ? ["hand_L", "hand_R"] : [im.target];
}
/** one fit per shot, person and style: the frames of a strip keep one camera */
const fits = new Map<string, any>();
function fitNotes(im: Img, f: any): string[] {
  if (f?.kept) return [`designer's camera kept: no clearer view within ${TOOL.fit.maxDeg}° (${f.subjects.join(" + ")} ${Math.round((f.designer.visible ?? 0) * 100)} % visible${Object.keys(f.designer.hidden_by).length ? `, behind ${Object.keys(f.designer.hidden_by).join(", ")}` : ""})`];
  if (!f?.changed) return [];
  const d = f.designer, u = f.used, pc = (x: number | null) => `${Math.round((x ?? 0) * 100)} %`, sg = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x);
  const why = `designer's camera: ${f.subjects.join(" + ")} ${pc(d.visible)} visible${Object.keys(d.hidden_by).length ? `, behind ${Object.keys(d.hidden_by)[0]}` : ""}${d.inside.length ? `, camera inside ${d.inside[0]}` : ""}`;
  if (f.how === "moved") {
    const parts = [u.daz ? `${sg(u.daz)}° az` : "", u.del ? `${sg(u.del)}° el` : "", u.dk < 1 ? `${Math.round(im.dist * (1 - u.dk) * 100)} cm nearer` : ""].filter(Boolean).join(", ");
    return [`camera moved ${parts} (${why}; now ${pc(u.visible)})`];
  }
  // what still covers the subject after the hiding: the parts the body rests on, which the shot is meant to show
  const rest = Object.entries(u.hidden_by ?? {}).filter(([, v]) => (v as number) >= 0.03).map(([k]) => k);
  const restNote = rest.length && u.visible < TOOL.fit.accept ? `; the rest is behind ${rest.join(", ")}, ${rest.every((k) => new RegExp(TOOL.fit.contactParts).test(k)) ? "which the body rests on and the shot shows" : "left in place"}` : "";
  return [`${u.hide.join(", ")} hidden for this shot (${why}; no clear view within ${TOOL.fit.maxDeg}°; now ${pc(u.visible)}${restNote})`];
}
async function shoot(pp: PkgPage, im: Img, file: string): Promise<Shot> {
  const t0 = performance.now(), p = pp.page;
  await p.viewport(im.res[0], im.res[1]);
  // the whole state of the shot, every time (body, tone, posture, still time): a shot does not depend on the one before
  const set: any = { shape: im.person };
  const tone = im.style === "dressed" ? im.tone ?? im.pkg.manifest.tones?.default ?? null : null;
  if (tone !== null) set.tone = tone;
  // every shot says its whole posture and its still time, so nothing carries over from the shot before
  if (im.kind !== "standing") Object.assign(set, { pose: null, script: im.script ?? "hold" });
  else if (im.clip) Object.assign(set, { clip: im.clip });
  else if (im.named) Object.assign(set, { pose: im.named });
  else Object.assign(set, { clip: null, pose: im.dofs });
  set.time = im.time ?? null;
  await p.evaluate(`viewer.person.set(${JSON.stringify(set)}).then(() => true)`);
  const holds = await p.evaluate("viewer.person.state().package");
  if (holds !== im.pkg.manifest.name) throw new Error(`the page of ${im.pkg.key} shows ${holds}: something else changed the person`);
  pp.cur.person = im.person; if (tone !== null) pp.cur.tone = tone;
  if (im.kind !== "standing") await p.evaluate(`(pp.place(null), true)`);
  let camera: number[] | null = null, found = true, az = im.az, el = im.el, place: any = null;
  let fit: any = null, aim: any = null;
  if (im.kind === "product") {
    await p.evaluate(`viewer.apply(${JSON.stringify({ ui: "0", view: im.view })}).then(() => pp.redraw()).then(() => (pp.newPose(), true))`);
    place = "seated by the rig binding";
  } else {
    await p.evaluate(`viewer.apply({ ui: "0" }).then(() => true)`);
    if (im.kind === "standing") {
      // the figure turns: its yaw puts the camera on the stand side at the shot's azimuth (or at the hand's own view direction)
      const hv = im.handView ? await p.evaluate(`pp.handView("R", ${JSON.stringify(im.handView)})`) : null;
      if (im.handView && !hv) im.notes.push("no palm frame: side view instead");
      if (hv) { az = +hv.az.toFixed(2); el = +hv.el.toFixed(2); }
      const yaw = +(standU - az).toFixed(3);
      let at = standSpot;
      await p.evaluate(`(async () => { pp.place(${JSON.stringify(at)}, ${yaw}); await pp.redraw(); return true; })()`);
      if (im.clip) {                                // a walk: the root's travel taken out, so the figure stays on its spot
        const pel = await p.evaluate(`pp.anchorModel("pelvis")`);
        if (pel) { at = [+(2 * standSpot[0] - pel[0]).toFixed(4), +(2 * standSpot[1] - pel[1]).toFixed(4), 0]; await p.evaluate(`(async () => { pp.place(${JSON.stringify(at)}, ${yaw}); await pp.redraw(); return true; })()`); }
      }
      place = { origin: at, yaw_deg: yaw };
    } else place = "seated by the rig binding";
    await p.evaluate(`(pp.newPose(), true)`);                     // this shot's pose and placement are final: read its vertices afresh
    const copt = { target: im.target, offset: im.offset, az, el, dist: im.dist, fov: im.fov, seated: im.kind === "seated" };
    let c = await p.evaluate(`pp.camera(${JSON.stringify(copt)})`), hide: string[] = [];
    found = c.target_found;
    if (!found) im.notes.push(`target '${im.target}' is not an anchor of the package: framed on the body's centre`);
    const subjects = im.kind === "seated" ? subjectsOf(im) : null;
    if (subjects) {                                                  // the real rig may hide what the designer's camera is meant to show
      const base = im.id.replace(/-t\d+$/, ""), key = `${base}|${im.person}|${im.az}|${im.el}`;   // one fit for both styles and every tone, so the pairs compare
      fit = fits.get(key);
      if (!fit) {
        const frameH = 2 * im.dist * Math.tan((im.fov * Math.PI) / 360), R = +Math.max(TOOL.fit.radiusMin, TOOL.fit.radiusOfFrame * frameH).toFixed(3);
        // a strip keeps one camera: it is fitted on the frame where the rig hides most of the subject
        const sibs = im.time === undefined ? [] : images.filter((x) => x.pkg === im.pkg && x.person === im.person && x.style === im.style && x.az === im.az && x.el === im.el && x.time !== undefined && x.id.replace(/-t\d+$/, "") === base);
        let on = im;
        if (sibs.length > 1) {
          let worst = Infinity;
          for (const sb of sibs) {
            await p.evaluate(`viewer.person.set({ time: ${sb.time} }).then(() => viewer.apply({ ui: "0" })).then(() => (pp.newPose(), true))`);
            const v = await p.evaluate(`pp.subjectAt(${JSON.stringify({ ...copt, subjects, R })})`);
            if ((v ?? 1) < worst) { worst = v ?? 1; on = sb; }
          }
          await p.evaluate(`viewer.person.set({ time: ${on.time} }).then(() => viewer.apply({ ui: "0" })).then(() => (pp.newPose(), true))`);
        }
        fit = await p.evaluate(`pp.fitCamera(${JSON.stringify({ ...copt, subjects, R, ...TOOL.fit })})`);
        fit.subjects = subjects; fit.radius_m = R; fit.fitted_on = on.file; fits.set(key, fit);
        if (on !== im) await p.evaluate(`viewer.person.set({ time: ${im.time} }).then(() => viewer.apply({ ui: "0" })).then(() => (pp.newPose(), true))`);
      }
      if (fit.changed) { c = await p.evaluate(`pp.camera(${JSON.stringify({ ...copt, az: az + fit.used.daz, el: el + fit.used.del, dist: im.dist * fit.used.dk })})`); hide = fit.used.hide; }
    }
    camera = c.camera; aim = { aimed_at: c.aimed_at, target_point: c.target_point, look_at_moved_m: c.look_at_moved_m };
    await p.evaluate(`viewer.apply(${JSON.stringify({ ui: "0", camera: camera!.join(","), ...(hide.length ? { hide: hide.join(",") } : {}) })}).then(() => true)`);
    if (im.kind === "standing") await p.evaluate(`(async () => { pp.place(${JSON.stringify(place.origin)}, ${place.yaw_deg}); await pp.redraw(); return true; })()`);
    else await p.evaluate(`pp.redraw().then(() => true)`);
  }
  const sight = await p.evaluate(`pp.sight(${camera ? JSON.stringify(camera.slice(3, 6)) : "null"})`);
  // where the eyes aim: with the operator layer off (standing, a clip) the eye module should not keep the seated gaze point
  sight.eyes = await p.evaluate(`(() => { const a = viewer.person.avatar(), e = a.state("eyes"); return { target_world: e.target ?? null, mode: e.report?.mode ?? null, operator_on: !!a.state("operator").on }; })()`);
  await p.screenshot(file);
  return { file, ms: Math.round(performance.now() - t0), camera, sight, place, found, az, el, fit, aim };
}
function sightNotes(im: Img, s: any): string[] {
  const n: string[] = [], t = s?.points?.target;
  if (s?.person_cells === 0) n.push("!the person is not in the picture");
  else if (s?.visible_share !== null && s?.visible_share !== undefined && s.visible_share < TOOL.visibleWarn) {
    const top = Object.entries<number>(s.hidden_by ?? {}).slice(0, 2).map(([k, v]) => `${k} ${Math.round(v * 100)} %`).join(", ");
    n.push(`!${Math.round(s.visible_share * 100)} % of the person visible (hidden by ${top})`);
  }
  if (s?.eyes && !s.eyes.operator_on && s.eyes.target_world) n.push("!eyes still aimed at the seated gaze point (the eye target is kept when the person stands)");
  if (t && t.in_frame === false) n.push("!target out of frame");
  if (t?.hidden_by) n.push(`target behind ${t.hidden_by}`);
  if (s?.camera_inside?.length) n.push(`!camera inside ${s.camera_inside.join(", ")}`);
  if (im.kind === "product" && im.view === "operator") {
    if (s?.own_body_within_150mm_share > TOOL.ownBodyWarn) n.push(`!the person's own head or face covers ${Math.round(s.own_body_within_150mm_share * 100)} % of the eye view (within 150 mm of the camera)`);
    if (s?.camera_to_person_eye_mm !== null) n.push(`camera ${s.camera_to_person_eye_mm} mm from the person's eye midpoint`);
  }
  return n;
}

// ---- pixel comparison (self-test) --------------------------------------------------------------------------------------------
async function comparePng(page: Page, a: Buffer, b: Buffer) {
  if (a.equals(b)) return { identical_bytes: true, different_pixels: 0, pixels_changed_at_all: 0, max_difference: 0 };
  const r = await page.evaluate(`(async () => { const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s; });
    const [A, B] = await Promise.all([load("data:image/png;base64,${a.toString("base64")}"), load("data:image/png;base64,${b.toString("base64")}")]);
    if (A.naturalWidth !== B.naturalWidth || A.naturalHeight !== B.naturalHeight) return { different_pixels: -1, max_difference: 255 };
    const px = (img) => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const da = px(A), db = px(B); let n = 0, any = 0, max = 0; for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])); if (d > 0) any++; if (d > 2) n++; if (d > max) max = d; } return { different_pixels: n, pixels_changed_at_all: any, max_difference: max }; })()`);
  return { identical_bytes: false, ...r };
}

// ---- run ------------------------------------------------------------------------------------------------------------------
let failed = false;
const shots = new Map<string, Shot>(), perSet = new Map<string, { images: number; ms: number[]; bench?: any }>(), metricsByPerson: Record<string, any> = {};
const errorsSeen = new Set<string>();
const order = [...images].sort((a, b) => a.pkg.key.localeCompare(b.pkg.key) || a.person.localeCompare(b.person) || (a.tone ?? "").localeCompare(b.tone ?? ""));
let selfTest: any = null;
try {
  // the stand side needs the product's key light: read it from the first page
  const first = images[0] ? await openPage(images[0].pkg) : await openPage(pkgFor("dressed", "m")!);
  const keyAz = await first.page.evaluate("pp.keyAzimuth()");
  computeStand(keyAz ?? -143.13);
  console.log(`person-packet: ${images.length} image(s) in ${new Set(images.map((i) => i.sheet)).size} sheet set(s); standing spot [${standSpot.join(", ")}] on the side at ${standU.toFixed(1)} deg (key light at ${keyAz?.toFixed(1)} deg); out ${relative(MAIN, out) || out}`);

  if (has("self-test")) {
    const pick = [images.find((i) => i.kind === "seated" && !i.time), images.find((i) => i.kind === "standing" && /head|eye/.test(String(i.target))) ?? images.find((i) => i.kind === "standing"), images.find((i) => i.kind === "product")].filter((x, k, a): x is Img => !!x && a.indexOf(x) === k);
    const dir = join(out, "self-test"); mkdirSync(dir, { recursive: true }); const rows: any[] = [];
    for (const [k, im] of pick.entries()) { const fresh = await openPage(im.pkg, true); await shoot(fresh, im, join(dir, `${k}-alone.png`)); await fresh.page.close(); }
    for (const round of [1, 2]) for (const k of [1, 0, 2].filter((x) => x < pick.length)) { const im = pick[k]; await shoot(await openPage(im.pkg), im, join(dir, `${k}-run${round}.png`)); }
    for (const [k, im] of pick.entries()) for (const round of [1, 2]) {
      const r = await comparePng(first.page, readFileSync(join(dir, `${k}-alone.png`)), readFileSync(join(dir, `${k}-run${round}.png`)));
      rows.push({ shot: im.file, in_run: round, ...r, same: r.different_pixels === 0 });
    }
    selfTest = { what: "each shot rendered alone on a fresh page, then twice on the run's page with the other shots in between; every pixel compared. As the lab's packet self-test: a pixel counts as different when a channel differs by more than 2 of 255; exact byte identity and the largest difference are reported too", pass: rows.every((r) => r.same), identical_bytes: rows.filter((r) => r.identical_bytes).length + " of " + rows.length, rows };
    writeFileSync(join(dir, "self-test.json"), JSON.stringify(selfTest, null, 1));
    console.log(`self-test: ${selfTest.pass ? "PASS" : "FAIL"}: ` + rows.map((r) => `${r.shot.split("/").pop()} run ${r.in_run}: ${r.identical_bytes ? "identical bytes" : `${r.different_pixels} px over 2/255, ${r.pixels_changed_at_all} px changed at all (max ${r.max_difference}/255)`}`).join("; "));
    if (!selfTest.pass) failed = true;
  }

  const t0 = performance.now();
  for (const [i, im] of order.entries()) {
    const pp = await openPage(im.pkg);
    const s = await shoot(pp, im, join(out, im.file));
    shots.set(im.file, s);
    im.notes.push(...fitNotes(im, s.fit), ...sightNotes(im, s.sight));
    const ps = perSet.get(im.sheet) ?? { images: 0, ms: [] }; ps.images++; ps.ms.push(s.ms); perSet.set(im.sheet, ps);
    if (doBench && !ps.bench) { ps.bench = await pp.page.evaluate(`viewer.person.bench(${TOOL.benchFrames}, { idle: false })`); ps.bench.at = im.file; ps.bench.viewport = im.res; }
    // metrics: once per package, person and posture (seated on the binding, standing in A-pose), on the pose of this image
    const posture = im.kind === "standing" ? (/^A_POSE$/.test(im.pose) ? "standing A_POSE" : null) : (im.kind === "seated" && !im.time) || im.kind === "product" ? "seated" : null;
    const mkey = `${im.pkg.key} / ${im.person} / ${posture}`;
    if (doMetrics && posture && !metricsByPerson[mkey]) {
      const pen = await pp.page.evaluate("pp.penetration()");
      const st = await pp.page.evaluate("viewer.person.state()");
      const eye = await pp.page.evaluate("pp.anchorModel('eye_midpoint')");
      const shells = posture === "seated" ? await pp.page.evaluate("viewer.person.shells()") : null;   // the pods' inner sides as drawn (GPU, after the contact)
      metricsByPerson[mkey] = { package: im.pkg.key, person: im.person, posture, from_image: im.file, pen, state: st, eye_model_m: eye, shells };
    }
    if (i % 10 === 9) console.log(`  ${i + 1}/${order.length} images, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    for (const e of pp.page.errors.splice(0)) errorsSeen.add(e.slice(0, 300));
  }
  const renderSec = (performance.now() - t0) / 1000;
  console.log(`rendered ${order.length} image(s) in ${renderSec.toFixed(1)} s`);

  // ---- contact sheets, in the lab's style; the tiles come from a small static server over the packet folder ----------------------
  const SHEET_HTML = readLabSheet();
  const files = Bun.serve({ port: 0, fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === "/sheet.html") return new Response(SHEET_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    const f = resolve(out, "." + path);
    if (!f.startsWith(out + "/") || !existsSync(f) || !statSync(f).isFile() || extname(f) !== ".png") return new Response("not found", { status: 404 });
    return new Response(Bun.file(f), { headers: { "content-type": "image/png" } });
  } });
  const sheets: string[] = [];
  const keys = [...new Set(images.map((i) => i.sheet))];
  for (const key of keys) {
    const tiles = images.filter((i) => i.sheet === key);
    for (let n = 0; n * 12 < tiles.length; n++) {
      const part = tiles.slice(n * 12, n * 12 + 12), style = part[0].style;
      const spec = { title: `${key === "tones" ? "Tones" : `Set ${part[0].set}, ${style}`}: sheet ${n + 1} · in the product viewer, real rig, product light`,
        sub: `${L.version}${corrections.length ? " (designer's corrections: " + corrections.join(", ") + ")" : ""}. Rendered by tools/person-packet.ts in the synergon viewer (WebGL 2, three.js 0.187, the viewer's own lights, tone curve and exposure). Seated: the operator layer on the rig binding. Standing: beside the rig, the figure turned. "!" = a fault the tool found.`,
        cols: 4, tileHeight: Math.round(800 * Math.min(1, scale)),
        tiles: part.map((t) => ({ src: `http://127.0.0.1:${files.port}/${t.file}`, label: [t.label, ...t.notes].join(" · "), w: t.res[0], h: t.res[1] })) };
      const pg = await browser.page(`http://127.0.0.1:${files.port}/sheet.html#${encodeURIComponent(JSON.stringify(spec))}`);
      await pg.waitFor("window.sheetReady", "the sheet"); const [w, h] = await pg.evaluate("window.sheetSize"); await pg.viewport(w, h); await sleep(120);
      const f = join(out, "sheets", `${key}-${String(n + 1).padStart(2, "0")}.png`); await pg.screenshot(f); sheets.push(f); await pg.close();
    }
  }
  files.stop(true);
  console.log(`sheets: ${sheets.length} in ${relative(out, join(out, "sheets"))}/`);

  // ---- manifest.json ---------------------------------------------------------------------------------------------------------
  const anyPage = [...pages.values()][0];
  const gl = anyPage ? await anyPage.page.evaluate(`(() => { const c = document.createElement("canvas").getContext("webgl2"); const d = c && c.getExtension("WEBGL_debug_renderer_info"); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; })()`) : null;
  const git = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT }).stdout.toString().trim(), dirty = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: ROOT }).stdout.toString().trim().split("\n").filter(Boolean).length;
  writeFileSync(join(out, "manifest.json"), JSON.stringify({
    packet: L.version, shot_list: listFile, designer_corrections_applied: corrections, run: runName, rendered: new Date().toISOString(), quick, quick_list: quick ? QUICK_EXTRAS : null,
    source: { worktree: ROOT, commit: git, uncommitted_files: dirty, viewer_bundle: { sha256: bundleHash, sources_as_of: new Date(frozen.builtFrom).toISOString(), files: Object.keys(frozen.files).sort() }, rig: { glb_sha256: rigManifest.glb?.sha256 ?? null, triangles: rigManifest.totals.triangles } },
    packages: Object.fromEntries([...pkgs.values()].map((p) => [p.key, { url: p.url, name: p.manifest.name, version: p.manifest.packaging?.version ?? p.manifest.build?.version ?? null }])),
    persons: PERSONS.filter(wantPerson), styles, tones: tonesWanted ?? "all of each package",
    renderer: { viewer: "the synergon product viewer (viewer/src, bundled by tools/bundle.ts), served by tools/serve.ts, headless Chromium", gl, three: "0.187.0", lighting: "the product's own (engine.ts LOOKS.now: room environment, key and fill directional lights, custom tone curve, exposure); the lab's lighting of each shot is recorded per image", pixel_ratio: 1, ui: "ui=0 (still view: the person posed at its fixed still time, no idle motion)" },
    placement: { seated: "viewer.person on the operator layer, targets from the rig binding (rig-binding.ts): survey-true seat, hands on the real grips (script 'hold' with the grips' lean), feet on the real pedals; rig at its neutral pose", standing: { spot_model_m: standSpot, camera_side_deg: +standU.toFixed(2), clearance_m: TOOL.standClearance, rule: "the person stands on the ground plane out from the rig's outline on the camera's side; the camera keeps the designer's azimuth around the figure by turning the figure (yaw = camera side - az), so the rig is behind the figure and the product's key light falls the same way in every standing shot" }, product_views: Object.fromEntries(PRODUCT_VIEWS.map(([id, view, what]) => [id, `${view}: ${what}`])) },
    camera_convention: "the shot list's: position = target + distance (sin az cos el, sin el, cos az cos el) in the figure's frame (az 0 from the front, 90 from its left); fov = the list's fov_v_deg; recorded per image in the model frame (metres, Z up, X forward, Y the operator's left) as [x, y, z, target x, y, z, fov]",
    probe: anyPage?.probe ?? null, probe_note: "the public calls of viewer.person and viewer this tool needs, checked on each page (place, anchor, avatar, object, skinned positions, set with script and time, pickAt); nothing is reached through the DevTools protocol",
    images: images.map((i) => { const s = shots.get(i.file); return { file: i.file, shot: i.id, set: i.set, sheet: i.sheet, person: i.person, package: i.pkg.key, style: i.style, tone: i.tone ?? (i.style === "dressed" ? i.pkg.manifest.tones?.default ?? null : null), placement: i.kind, pose: i.pose, script: i.script ?? null, time_s: i.time ?? null, view: i.view ?? null,
      az: s?.az ?? i.az, el: s?.el ?? i.el, hand_view: i.handView ?? null, lab_camera: i.camName, distance_m: i.kind === "product" ? null : i.dist, fov_v_deg: i.kind === "product" ? null : i.fov, target: i.target, camera_model: s?.camera ?? null, aim: s?.aim ?? null,
      camera_fit: s?.fit ? (s.fit.changed ? { how: s.fit.how, reason: fitNotes(i, s.fit)[0], subjects: s.fit.subjects, radius_m: s.fit.radius_m, fitted_on: s.fit.fitted_on, tried: s.fit.tried,
        designer: { az: i.az, el: i.el, distance_m: i.dist, camera_model: s.fit.designer.camera, subject_visible: s.fit.designer.visible, hidden_by: s.fit.designer.hidden_by, camera_inside: s.fit.designer.inside },
        used: { az: +(i.az + s.fit.used.daz).toFixed(2), el: +(i.el + s.fit.used.del).toFixed(2), distance_m: +(i.dist * s.fit.used.dk).toFixed(3), camera_model: s.camera, subject_visible: s.fit.used.visible, hidden_parts: s.fit.used.hide, still_hidden_by: s.fit.used.hidden_by } }
        : { how: "designer's camera", subjects: s.fit.subjects, subject_visible: s.fit.designer.visible, fitted_on: s.fit.fitted_on, ...(s.fit.kept ? { reason: fitNotes(i, s.fit)[0], hidden_by: s.fit.designer.hidden_by } : {}) }) : null, lab_lighting: i.labLighting, lighting: "product", resolution: i.res, place: s?.place ?? null, sight: s?.sight ?? null, notes: i.notes, render_ms: s?.ms ?? null }; }),
    skipped, derived_poses: derived, page_messages: [...errorsSeen].filter((e) => !/the rig binding failed/.test(e)), rig_binding_failures_while_standing: [...errorsSeen].filter((e) => /the rig binding failed/.test(e)).length ? "the person module warns that the binding fails while a standing pose is set (expected: the binding seats an operator); the tool places the standing person itself" : null,
  }, null, 1));

  // ---- metrics.json ----------------------------------------------------------------------------------------------------------
  const DESIGNED = /^C_seat_(pan|base|back_cushion)$/;          // the cushion and the shell round it: the designed sink (the contact flatten lifts the skin on screen)
  const per: Record<string, any> = {};
  for (const [key, m] of Object.entries<any>(metricsByPerson)) {
    const parts = m.pen?.parts ?? {}, st = m.state ?? {}, br = st.binding?.report ?? null, rep = st.report ?? {};
    // a pod shell is a contact surface: its depth counts as drawn (viewer.person.shells(), after the contact), not as read back on the CPU
    const podDrawn = (c: string) => { const k = /^C_pod_shell_([LR])$/.exec(c); return k ? m.shells?.[`pod_${k[1]}`] ?? null : null; };
    const faults = Object.entries<any>(parts).filter(([c, r]) => !DESIGNED.test(c) && r.deepest_mm > TOOL.faultMm && !(podDrawn(c) && podDrawn(c).after_mm <= TOOL.faultMm))
      .map(([c, r]) => ({ part: c, deepest_mm: r.deepest_mm, region: r.deepest_region, vertices_inside: r.inside, ...(podDrawn(c) ? { drawn_after_contact_mm: podDrawn(c).after_mm } : {}) }));
    const placed = st.placed ?? null, surfZ = placed?.origin?.[2] != null ? placed.origin[2] * 1000 : null;
    const contact = (re: RegExp, reg: RegExp) => Object.fromEntries(Object.entries<any>(parts).filter(([c]) => re.test(c)).map(([c, r]) => {
      const regs = Object.entries<any>(r.regions).filter(([g]) => reg.test(g)), deep = Math.max(0, ...regs.map(([, g]) => g.deepest_mm ?? 0)), gaps = regs.map(([, g]) => g.nearest_gap_mm).filter((x) => x !== null) as number[];
      return [c, { penetration_mm: deep, nearest_gap_mm: gaps.length ? Math.min(...gaps) : null, vertices_inside: regs.reduce((k, [, g]) => k + g.inside, 0), skin_to_surface_mm: deep > 0 ? -deep : gaps.length ? Math.min(...gaps) : null }];
    }));
    const survey = st.measures?.eyeheightsitting ?? null, comp = br?.person?.cushion_compression_m ?? null;
    per[key] = {
      package: m.package, person: m.person, posture: m.posture, measured_on: m.from_image,
      penetration: { how: "the person's vertices read back on the CPU (shape bake, morphs, eight influences, linear blend skinning: no dual-quaternion twist and no contact flatten) against every rig part's triangles, model frame; inside = odd crossings of a vertical ray (closed parts) or behind the nearest face (open parts); depth = distance to the nearest surface, at most 40 mm",
        faults_over_mm: TOOL.faultMm, faults, designed_contact: Object.fromEntries(Object.entries<any>(parts).filter(([c]) => DESIGNED.test(c)).map(([c, r]) => [c, { sink_before_flatten_mm: r.deepest_mm, region: r.deepest_region, vertices: r.inside, note: "the seat and backrest sink is by design: the contact flatten in the person's shader lays the skin on the cushion on screen" }])),
        lowest_point_z_mm: m.pen?.lowest_point_z_mm, lowest_region: m.pen?.lowest_region, top_z_mm: m.pen?.top_z_mm, vertices: m.pen?.vertices, compute_ms: m.pen?.ms, parts },
      grips: m.posture === "seated" ? { skin_against_levers: contact(/^C_joy_lever_[LR]$/, /^hand_/), solver_hand_error_mm: rep.handErr ? { left: +(rep.handErr.l * 1000).toFixed(1), right: +(rep.handErr.r * 1000).toFixed(1) } : null, binding_reach: br?.reach ?? null, limit_mm: { error: L.limits?.hand_on_grip_error_max_mm, penetration: L.limits?.hand_penetration_max_mm } } : null,
      pedals: m.posture === "seated" ? { shoes_against_pedals: contact(/^C_pedal_(arm_\d|base)$/, /^(foot|shin)/), solver_ball_error_mm: rep.footErr ? { left: +(rep.footErr.l * 1000).toFixed(1), right: +(rep.footErr.r * 1000).toFixed(1) } : null, leg_short_mm: rep.legReach ? { left: +(rep.legReach.l * 1000).toFixed(1), right: +(rep.legReach.r * 1000).toFixed(1) } : null, binding: br?.pedals ?? null } : null,
      eye: m.posture === "seated" ? { survey_sitting_eye_height_mm: survey, cushion_compression_m: comp, survey_less_compression_m: br?.eye?.survey_less_compression_m ?? null, eye_above_cushion_m: br?.eye?.eye_above_cushion_m ?? null,
        difference_mm: br?.eye?.eye_above_cushion_m != null && br?.eye?.survey_less_compression_m != null ? Math.round((br.eye.eye_above_cushion_m - br.eye.survey_less_compression_m) * 10000) / 10 : null,
        eye_as_rendered_model_m: m.eye_model_m, eye_by_binding_model_m: br?.eye?.eye_model_m ?? null, vs_rig_eye_points_mm: br?.eye?.vs_rig_eye_points_mm ?? null, screens: { main: br?.eye?.main_monitor ?? null, touchscreen: br?.eye?.touchscreen ?? null } }
        : { stature_survey_mm: st.measures?.stature ?? null, top_of_figure_mm: m.pen?.top_z_mm, note: "the top includes the cap" },
      soles: m.posture === "seated" ? null : { how: "the lowest drawn point of the person (Avatar.skinnedPositions) against the surface place() stood it on (state().placed.origin[2])", stands_on: placed?.on ?? null, surface_z_mm: surfZ != null ? +surfZ.toFixed(1) : null,
        lowest_point_vs_surface_mm: surfZ != null && m.pen?.lowest_point_z_mm != null ? +(m.pen.lowest_point_z_mm - surfZ).toFixed(1) : null, lowest_region: m.pen?.lowest_region ?? null, top_vs_surface_mm: surfZ != null && m.pen?.top_z_mm != null ? +(m.pen.top_z_mm - surfZ).toFixed(1) : null },
      pods: m.posture === "seated" ? { how: "viewer.person.shells(): how deep the drawn skin lies inside each pod's inner side before and after the contact layer (mm, GPU)", drawn: m.shells ?? null,
        cpu_read_back_mm: Object.fromEntries(Object.entries<any>(parts).filter(([c]) => /^C_pod_shell_[LR]$/.test(c)).map(([c, r]) => [c, { deepest_mm: r.deepest_mm, region: r.deepest_region, note: "before the contact layer" }])) } : null,
      binding_findings: m.posture === "seated" ? br : null, solver_report: m.posture === "seated" ? { clash: rep.clash ?? null, arm_into_body: rep.armPen ?? null, wrist: rep.wrist ?? null, collision: rep.collision ?? null, person_fit: rep.person ?? null } : null,
      timing: st.timing ?? null,
    };
  }
  const L1 = loadavg()[0];
  writeFileSync(join(out, "metrics.json"), JSON.stringify({
    limits: L.limits, per_person: per,
    frame_time_per_shot_set: Object.fromEntries([...perSet].map(([k, v]) => { const ms = [...v.ms].sort((a, b) => a - b); return [k, { images: v.images, render_ms_median: ms[ms.length >> 1], render_ms_max: ms[ms.length - 1], bench: v.bench ?? null }]; })),
    frame_time_how: `bench = viewer.person.bench(${TOOL.benchFrames}, { idle: false }) at the camera of the set's first image and its resolution: each frame drawn and finished with a one-pixel read, median and 90th percentile (ms); render_ms = the whole shot (pose, camera, draw, PNG capture)`,
    machine: { cores: cpus().length, one_minute_load_average: Math.round(L1 * 100) / 100, note: "frame times taken while other work loads the machine are an upper bound" },
    page_load_ms: Object.fromEntries([...pages.values()].map((p) => [p.pkg.key, p.loadMs])),
    self_test: selfTest,
  }, null, 1));
  writeFileSync(join(out, "KNOWN-ISSUES.md"), `# Known issues of this packet (${runName})\n\nWritten by tools/person-packet.ts. Not rendered (see manifest.json, "skipped"):\n\n${skipped.map((s) => "- " + s).join("\n") || "- nothing"}\n\nFaults the tool found in the pictures (also in the captions, marked "!"):\n\n${images.filter((i) => i.notes.some((n) => n.startsWith("!"))).map((i) => `- ${i.file}: ${i.notes.filter((n) => n.startsWith("!")).map((n) => n.slice(1)).join("; ")}`).join("\n") || "- none"}\n`);
} catch (e: any) {
  console.error("error: " + (e?.stack ?? e)); failed = true;
} finally {
  await browser.close(); front.stop(true); server.stop(true);
}
if (errorsSeen.size) console.log("page messages:\n  " + [...errorsSeen].filter((e) => !/the rig binding failed/.test(e)).slice(0, 8).join("\n  "));
console.log(`person-packet ${failed ? "FAILED" : "done"} in ${((performance.now() - tStart) / 1000).toFixed(1)} s → ${out}`);
process.exit(failed ? 1 : 0);

/** The lab's contact-sheet page (work/avatar-lab/viewer/sheet.html), or the same layout written out here when the lab is not on this machine. */
function readLabSheet(): string {
  for (const f of [join(ROOT, "work/avatar-lab/viewer/sheet.html"), join(MAIN, "work/avatar-lab/viewer/sheet.html")]) if (existsSync(f)) return readFileSync(f, "utf8");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#1b1c1f;color:#e6e6e6;font:13px/1.35 system-ui,sans-serif}h1{font-size:18px;margin:0;padding:14px 16px 2px;font-weight:600}p{margin:0;padding:0 16px 10px;color:#a8a8a8}#grid{display:grid;gap:10px;padding:0 16px 16px}figure{margin:0;background:#26282c}figure img{display:block;width:100%}figcaption{padding:5px 8px 7px}</style></head><body><h1 id="t"></h1><p id="s"></p><div id="grid"></div><script>
const spec=JSON.parse(decodeURIComponent(location.hash.slice(1)));document.getElementById("t").textContent=spec.title;document.getElementById("s").textContent=spec.sub??"";const grid=document.getElementById("grid");const colW=Math.max(...spec.tiles.map((t)=>Math.round(spec.tileHeight*t.w/t.h)));grid.style.gridTemplateColumns="repeat("+spec.cols+", "+colW+"px)";
Promise.all(spec.tiles.map((t)=>new Promise((res)=>{const f=document.createElement("figure"),i=new Image();i.onload=i.onerror=res;i.src=t.src;i.style.height=spec.tileHeight+"px";i.style.objectFit="contain";const c=document.createElement("figcaption");c.textContent=t.label;f.append(i,c);grid.append(f);}))).then(()=>{window.sheetSize=[spec.cols*colW+(spec.cols-1)*10+32,document.documentElement.scrollHeight];window.sheetReady=true;});</script></body></html>`;
}
