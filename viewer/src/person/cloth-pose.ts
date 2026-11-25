// Cloth form (ported from the lab's cloth-pose.ts, owner B8): a garment's fold normal map fades from its standing map to a seated
// map as the hip and knee bend; and the manifest's `clothCorrectives` morph targets are set from the joint angles. Inert for a
// package without those records. Changes from the lab: the posed map is loaded through the person's loader (PNG, JPEG or KTX2)
// instead of finding the package's folder among the page's resource timings.
//
// Manifest, on a material of class cloth that has a normal map in the GLB:
//   "poseNormal": { "posed": "maps/garment_trousers_work_fold_seat_n.jpg",           // the seated map, same UV0 as the GLB's map
//                   "weight": { "l": [morph targets...], "r": [...] },                 // whose current weights give the fade (the larger one per side)
//                   "side": 0.03 }
// The left weight applies where the vertex's REST x > 0 (the figure's left is +x), the right where x < 0, blended over +-`side`.
import { section } from "./params.ts";
import type { Plugin, FrameContext } from "./plugins.ts";

const CP = section("cloth_pose"), ANISO: number = section("materials").detail.anisotropy;
type Rec = { posed: string; weight?: { l?: string[]; r?: string[] }; side?: number };
const loaded = new WeakMap<object, Map<string, any>>();           // manifest -> posed map path -> texture

function records(ctx: FrameContext): [string, Rec][] {
  return Object.entries<any>(ctx.manifest?.materials ?? {}).filter(([, v]) => v?.poseNormal?.posed).map(([k, v]) => [k, v.poseNormal as Rec]);
}
function patch(m: any, st: any) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = function (this: any, sh: any, r: any) {
    if (prev) prev.call(this, sh, r);           // first, as in the lab: the detail normal (materials.ts) stays on top of the faded fold normal
    Object.assign(sh.uniforms, st.u);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vLabRestX;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvLabRestX = position.x;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D labPoseN; uniform vec2 labPoseW; uniform float labPoseSide; varying float vLabRestX;")
      .replace("#include <normal_fragment_maps>", `#if defined( USE_NORMALMAP_TANGENTSPACE )
	{
		float labPw = clamp( mix( labPoseW.y, labPoseW.x, smoothstep( - labPoseSide, labPoseSide, vLabRestX ) ), 0.0, 1.0 );
		vec3 mapN = mix( texture2D( normalMap, vNormalMapUv ).xyz, texture2D( labPoseN, vNormalMapUv ).xyz, labPw ) * 2.0 - 1.0;
		mapN.xy *= normalScale;
		normal = normalize( tbn * mapN );
	}
#else
	#include <normal_fragment_maps>
#endif`);
    if (!sh.fragmentShader.includes("labPoseN, vNormalMapUv")) console.warn("cloth-pose: normal map patch did not apply (three.js chunk changed)");
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "+b8-pose-normal";
  m.userData.b8pose = st; m.needsUpdate = true;
}

// `clothCorrectives` = { targets: [ { target, dof, from, to, when: "seated" | "standing" | "always", girth?: true } ], girth: { probe: [vertex
//   indices, [count of the left leg's]], median, heavy, clamp: [lo, hi] } }. These morph targets have NO manifest driver: this plug-in sets them
// in `frame` (after the pose and the operator layer, BEFORE the drivers and the seat contact pass). weight = ramp of the dof's angle (read from
// the joint's actual rotation), times 0 or 1 by `when` against the seated flag, times, for `girth` targets, (g - median) / (heavy - median)
// clamped, where g is the mean distance of each trouser leg's probe vertices from that leg's centre on the CURRENT rest shape.
function girthOf(o: any, probe: any): number {
  const pos = o.geometry?.attributes?.position; if (!pos) return NaN;
  const key = pos.version + ":" + pos.count; if (o.userData.b8girthKey === key) return o.userData.b8girth;
  const idx: number[] = probe[0], n0: number = probe[1][0]; let tot = 0;
  for (const sel of [idx.slice(0, n0), idx.slice(n0)]) {
    let cx = 0, cz = 0; for (const i of sel) { cx += pos.getX(i); cz += pos.getZ(i); } cx /= sel.length; cz /= sel.length;
    let d = 0; for (const i of sel) d += Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz); tot += d / sel.length;
  }
  o.userData.b8girthKey = key; o.userData.b8girth = tot / 2; return tot / 2;
}
function dofAngle(ctx: FrameContext, dofId: string): number {
  const dd = (ctx.manifest?.dofs ?? []).find((x: any) => x.id === dofId), b = dd && ctx.bones.get(dd.joint), r0 = dd && ctx.restQ.get(dd.joint); if (!b || !r0) return 0;
  const rel = r0.clone().invert().multiply(b.quaternion); if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
  const ax = new ctx.THREE.Vector3().fromArray(dd.axis).normalize();
  let v = ctx.THREE.MathUtils.radToDeg(2 * Math.atan2(rel.x * ax.x + rel.y * ax.y + rel.z * ax.z, rel.w)); if (v > 180) v -= 360; if (v < -180) v += 360; return v;
}
function correctives(ctx: FrameContext) {
  const cc = ctx.manifest?.clothCorrectives; if (!cc?.targets?.length) return;
  ctx.root.traverse((o: any) => {
    const d = o.isSkinnedMesh ? o.morphTargetDictionary : null; if (!d || !cc.targets.some((t: any) => t.target in d)) return;
    const inf = o.morphTargetInfluences, G = cc.girth;
    const gf = G ? (() => { const g = girthOf(o, G.probe); return Number.isFinite(g) ? Math.min(G.clamp?.[1] ?? 1, Math.max(G.clamp?.[0] ?? 0, (g - G.median) / (G.heavy - G.median))) : 0; })() : 1;
    o.userData.b8girthFactor = gf;
    for (const t of cc.targets) {
      const i = d[t.target]; if (i === undefined) continue;
      const on = t.when === "seated" ? ctx.seated : t.when === "standing" ? !ctx.seated : true;
      inf[i] = on ? Math.min(1, Math.max(0, (dofAngle(ctx, t.dof) - t.from) / (t.to - t.from))) * (t.girth ? gf : 1) : 0;
    }
  });
}

export const clothPose: Plugin = {
  name: "clothPose",
  async init(ctx) {
    const recs = records(ctx); if (!recs.length) return;
    const map = loaded.get(ctx.manifest) ?? new Map<string, any>(); loaded.set(ctx.manifest, map);
    for (const [, r] of recs) {
      if (map.has(r.posed)) continue;
      try { const t = await ctx.load(r.posed); t.flipY = false; t.colorSpace = ctx.THREE.NoColorSpace; t.wrapS = t.wrapT = ctx.THREE.RepeatWrapping; t.anisotropy = ANISO; t.needsUpdate = true; map.set(r.posed, t); }
      catch (e) { console.warn("cloth-pose: could not load " + r.posed, e); map.set(r.posed, null); }
    }
  },
  frame(ctx) { correctives(ctx); },
  late(ctx) {
    const recs = records(ctx); if (!recs.length) return;
    const byMat = new Map(recs), map = loaded.get(ctx.manifest); if (!map) return;
    ctx.root.traverse((o: any) => {
      if (!o.isSkinnedMesh) return; const m = o.material, look = o.userData?.look;
      if (!m || Array.isArray(m) || m !== look || !m.normalMap) return;            // only the dressed look material (never a shared clay or style material)
      const r = byMat.get(o.userData?.src?.name ?? m.name); if (!r) return;
      const tex = map.get(r.posed); if (!tex) return;
      let st = o.userData.b8pose;
      if (!st) st = o.userData.b8pose = { u: { labPoseN: { value: tex }, labPoseW: { value: new ctx.THREE.Vector2() }, labPoseSide: { value: r.side ?? CP.side } } };
      if (m.userData.b8pose !== st) patch(m, st);
      const d = o.morphTargetDictionary ?? {}, inf = o.morphTargetInfluences ?? [], w = (names?: string[]) => Math.min(1, Math.max(0, ...(names ?? []).map((n) => (d[n] !== undefined ? inf[d[n]] : 0)), 0));
      st.u.labPoseW.value.set(w(r.weight?.l), w(r.weight?.r));
    });
  },
};
