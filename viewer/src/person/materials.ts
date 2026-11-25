// Material recipes of the person, chosen by the manifest's material class or the glTF material's name prefix; ported from
// the lab's materials.ts (RL; the eye shell and the lash cards by B5), the look the designer passed. All are
// MeshPhysicalMaterial with a small per-material shader patch where the lab had one; every material made here also gets
// the person's skinning, contact and shadow patch (shaders.ts personShader), so nothing of it reaches the rig.
// Numbers: runtime-person.toml [materials.*]. Left out of the port: the procedural iris for an eye without the B5 marker
// (every package has B5 eyes; such an eye is a plain clear-coat sphere here), and the mirrored eye light (the lab's
// RectAreaLight in front of the face would light the rig too; the eye's own camera-fixed catch light remains).
import * as THREE from "three";
import { section, glslDefines } from "./params.ts";
import { personShader, type PersonUniforms } from "./shaders.ts";

const M = section("materials"), SK = M.skin, DT = M.detail, EY = M.eye, ES = M.eye_shader, LA = M.lashes, HA = M.hair, CL = M.cloth, LE = M.leather;
type Loader = (url: string) => Promise<THREE.Texture>;

// ---- procedural detail normal maps (until the assets bring their own) --------------------------------
function normalFromHeight(n: number, h: (x: number, y: number) => number, strength: number): THREE.Texture {
  const H = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) H[y * n + x] = h(x / n, y / n);
  const data = new Uint8Array(n * n * 4), at = (x: number, y: number) => H[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    data[i] = (-dx / l * 0.5 + 0.5) * 255; data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; data[i + 2] = (1 / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = DT.anisotropy; t.needsUpdate = true;
  return t;
}
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
/** Tileable cellular height: skin pores and the fine creases between them. */
function cells(nCells: number, seed: number) {
  const r = rng(seed), pts: [number, number][] = []; for (let i = 0; i < nCells; i++) pts.push([r(), r()]);
  return (x: number, y: number) => { let d1 = 9, d2 = 9; for (const [px, py] of pts) { let dx = Math.abs(x - px), dy = Math.abs(y - py); dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy); const d = dx * dx + dy * dy; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return Math.sqrt(d2) - Math.sqrt(d1); };
}
const cache: Record<string, THREE.Texture> = {};
export function detailNormal(kind: "skin" | "weave" | "twill" | "knit" | "leather"): THREE.Texture {
  if (cache[kind]) return cache[kind];
  if (kind === "twill") { const [n, ribs, across, rib, s] = DT.twill; return cache[kind] = normalFromHeight(n, (x, y) => { const d = ((x + y) * ribs) % 1, t = (x * across) % 1; return Math.sin(Math.PI * d) * (rib + (1 - rib) * Math.sin(Math.PI * t)); }, s); }
  if (kind === "knit") { const [n, cols, v, loop, s] = DT.knit; return cache[kind] = normalFromHeight(n, (x, y) => { const u = (x * cols) % 1, w = (y * cols + Math.abs(u - 0.5) * v) % 1; return Math.sin(Math.PI * u) * (loop + (1 - loop) * Math.sin(Math.PI * w)); }, s); }
  if (kind === "skin") { const [n, k, hs, s] = DT.skin, c = cells(k, DT.skin_seed); return cache[kind] = normalFromHeight(n, (x, y) => Math.min(c(x, y) * hs, 1), s); }
  if (kind === "leather") { const [n, k, hs, s] = DT.leather, c = cells(k, DT.leather_seed); return cache[kind] = normalFromHeight(n, (x, y) => Math.min(c(x, y) * hs, 1), s); }
  // plain weave: warp and weft threads crossing
  const [n, threads, top, s] = DT.weave;
  return cache[kind] = normalFromHeight(n, (x, y) => { const u = x * threads, v = y * threads, over = (Math.floor(u) + Math.floor(v)) % 2 === 0; const a = Math.sin(Math.PI * (u % 1)), b = Math.sin(Math.PI * (v % 1)); return over ? a * top + (1 - top) * b : b * top + (1 - top) * a; }, s);
}

export type MatClass = "skin" | "eye" | "cornea" | "hair" | "lashes" | "cloth" | "leather" | "rubber" | "plain";
export function classOf(name: string, manifestClass?: string): MatClass {
  if (manifestClass) return manifestClass as MatClass;
  const n = name.toLowerCase();
  for (const c of ["skin", "cornea", "eye", "hair", "lashes", "brows", "cloth", "leather", "rubber"]) if (n.startsWith(c)) return (c === "brows" ? "lashes" : c) as MatClass;
  return "plain";
}
export const eyeUniforms: Record<string, any> = {};

function copyMaps(dst: THREE.MeshPhysicalMaterial, src: any) {
  for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"]) if (src[k]) (dst as any)[k] = src[k];
  if (src.normalScale) dst.normalScale.copy(src.normalScale);
  dst.color.copy(src.color ?? new THREE.Color(1, 1, 1)); dst.opacity = src.opacity ?? 1; dst.transparent = !!src.transparent; dst.alphaTest = src.alphaTest ?? 0; dst.side = src.side ?? THREE.FrontSide; dst.name = src.name;
  dst.roughness = src.roughness ?? M.copy.roughness; dst.metalness = src.metalness ?? 0;
}
/** A 1 x 1 black texture: "no skin hidden". */
export const NO_MASK = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; return t; })();
/** A 1 x 1 flat tangent-space normal: the detail map until its image has loaded. */
const FLAT_NORMAL = (() => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; return t; })();
/** Gives a patched shader the mesh's first UV set as `vLabUv`, whatever maps the material has. */
function withUv(sh: any) {
  if (sh.vertexShader.includes("vLabUv")) return;
  sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vLabUv;").replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvLabUv = uv;");
  sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vLabUv;");
}
/** Tiling detail normal on top of whatever normal the material already has (folds from the asset, weave from here): its own
 *  UV scale (repeats per unit of UV0) and strength. `opts.detail` names a built-in pattern, `opts.detailNormal` a tiling image. */
function addDetail(opts: any, load: Loader, fallback: "weave" | "leather", scale: number, strength: number): ((sh: any) => void) | null {
  if (opts.detail === "none") return null;
  const u = { labDetail: { value: opts.detailNormal ? FLAT_NORMAL : detailNormal(opts.detail ?? fallback) as THREE.Texture }, labDetailScale: { value: opts.detailScale ?? scale }, labDetailStrength: { value: opts.detailStrength ?? strength } };
  if (opts.detailNormal) void load(opts.detailNormal).then((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = DT.anisotropy; t.needsUpdate = true; u.labDetail.value = t; });
  return (sh: any) => {
    Object.assign(sh.uniforms, u); withUv(sh);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D labDetail; uniform float labDetailScale; uniform float labDetailStrength;")
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
	{
		vec3 labDn = texture2D( labDetail, vLabUv * labDetailScale ).xyz * 2.0 - 1.0; labDn.xy *= labDetailStrength;
		vec3 labQ0 = dFdx( - vViewPosition ), labQ1 = dFdy( - vViewPosition ); vec2 labS0 = dFdx( vLabUv ), labS1 = dFdy( vLabUv );
		vec3 labQ1p = cross( labQ1, normal ), labQ0p = cross( normal, labQ0 );
		vec3 labT = labQ1p * labS0.x + labQ0p * labS1.x, labB = labQ1p * labS0.y + labQ0p * labS1.y;
		float labDet = max( dot( labT, labT ), dot( labB, labB ) ); float labSc = labDet == 0.0 ? 0.0 : inversesqrt( labDet );
		normal = normalize( labT * ( labDn.x * labSc ) + labB * ( labDn.y * labSc ) + normal * labDn.z );
	}`);
  };
}
function tiled(t: THREE.Texture, rep: number) { const c = t.clone(); c.repeat.set(rep, rep); c.needsUpdate = true; return c; }
const maskVertex = (sh: any) => sh.vertexShader.replace("#include <common>", "#include <common>\nuniform sampler2D labMask; uniform float labMaskPush;")
  .replace("vLabUv = uv;", "vLabUv = uv;\n\ttransformed -= normal * ( labMaskPush * texture2D( labMask, uv ).r );");
const maskFragment = (sh: any) => sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D labMask;")
  .replace("#include <map_fragment>", "#include <map_fragment>\n\tdiffuseColor.a *= 1.0 - texture2D( labMask, vLabUv ).r;");

/** A view material (the clay style) for a body mesh that the worn garments cut per pixel: the same mask, the same anti-aliased
 *  cut and the same inward push as the skin recipe (lab round 11). `mask` is the person's shared uniform. */
export function bodyMasked(base: THREE.Material, mask: { value: THREE.Texture }, U: PersonUniforms, push: number = SK.mask_push): THREE.Material {
  const m: any = base.clone(); m.alphaTest = 0.5; m.alphaToCoverage = true; m.transparent = false;
  m.onBeforeCompile = (sh: any) => { sh.uniforms.labMask = mask; sh.uniforms.labMaskPush = { value: push }; withUv(sh); sh.vertexShader = maskVertex(sh); sh.fragmentShader = maskFragment(sh); };
  m.customProgramCacheKey = () => "lab-bodymask-" + base.type;
  return personShader(m, U, "-bodymask");
}
const SKIN_DEFINES = glslDefines({ blend: SK.blend_normals, back_normal: SK.back_scatter_normal, back_power: SK.back_scatter_power, desaturate: section("look").skin_desaturate }, "K_SKIN_");
/** Skin: Lambert replaced by a wrapped, colour-shifted diffuse (red light bleeds furthest past the terminator), computed on a
 *  softer normal for red and green than for blue (the "blended normals" trick), a little back-scatter, a broad base specular
 *  plus a sharp thin coat (the oily layer), sheen as peach fuzz. */
export function skin(src: any, opts: any, load: Loader): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial(); copyMaps(m, src);
  m.roughness = src.roughnessMap ? src.roughness : SK.roughness; m.ior = SK.ior; m.specularIntensity = SK.specular;
  // the thin oily coat, per material from the manifest (a darker tone carries a lower, rougher coat): clearcoat, clearcoatRoughness, clearcoatMap
  m.clearcoat = opts.clearcoat ?? SK.clearcoat; m.clearcoatRoughness = opts.clearcoatRoughness ?? SK.clearcoat_roughness;
  if (src.clearcoatMap) m.clearcoatMap = src.clearcoatMap; if (src.clearcoatRoughnessMap) m.clearcoatRoughnessMap = src.clearcoatRoughnessMap;
  if (opts.clearcoatMap) void load(opts.clearcoatMap).then((t) => { t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.needsUpdate = true; m.clearcoatMap = t; m.needsUpdate = true; });
  m.sheen = SK.sheen[0]; m.sheenRoughness = SK.sheen[1]; m.sheenColor = new THREE.Color().fromArray(SK.sheen_color);
  if (!m.normalMap) { m.normalMap = tiled(detailNormal("skin"), opts.microTiling ?? SK.micro_tiling); const ms = opts.microStrength ?? SK.micro_strength; m.normalScale.set(ms, ms); }
  // the body under cloth: `opts.mask` holds the combined mask of the worn garments (body UV0 space, white = hidden). The skin is cut
  // there with an anti-aliased edge (alpha-to-coverage) and pushed inward a little so it cannot z-fight the cloth.
  const mask = opts.mask as { value: THREE.Texture } | undefined;
  if (mask) { m.alphaTest = 0.5; m.alphaToCoverage = true; m.transparent = false; }
  const skinU = { labScatter: { value: new THREE.Color().fromArray(SK.scatter) }, labSkinStrength: { value: SK.scatter_strength }, labBackScatter: { value: SK.back_scatter } };
  m.onBeforeCompile = (sh) => {
    if (mask) { sh.uniforms.labMask = mask; sh.uniforms.labMaskPush = { value: opts.maskPush ?? SK.mask_push }; withUv(sh); sh.vertexShader = maskVertex(sh); sh.fragmentShader = maskFragment(sh); }
    Object.assign(sh.uniforms, skinU);
    const pars = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      "reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );",
      `float labNL = dot( geometryNormal, directLight.direction ), labNLs = dot( labSmoothNormal, directLight.direction );
	vec3 labW = labScatter * labSkinStrength;
	vec3 labN3 = mix( vec3( labNL ), vec3( labNLs ), K_SKIN_BLEND );
	vec3 labWrap = saturate( ( labN3 + labW ) / ( ( 1.0 + labW ) * ( 1.0 + labW ) ) );
	vec3 labIrr = labWrap * directLight.color;
	vec3 labLT = normalize( directLight.direction + labSmoothNormal * K_SKIN_BACK_NORMAL );
	labIrr += labScatter * directLight.color * pow( saturate( dot( geometryViewDir, - labLT ) ), K_SKIN_BACK_POWER ) * labBackScatter;
	reflectedLight.directDiffuse += labIrr * diffuseBRDF * ( 1.0 - F );`);
    if (pars === THREE.ShaderChunk.lights_physical_pars_fragment) throw new Error("skin shader patch did not apply (three.js chunk changed)");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <lights_physical_pars_fragment>", SKIN_DEFINES + "uniform vec3 labScatter; uniform float labSkinStrength; uniform float labBackScatter; vec3 labSmoothNormal;\n" + pars)
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n\tlabSmoothNormal = nonPerturbedNormal;")
      // less saturation in the skin's colour under the product's tone curve, which pushed its red (designer, REVIEW-11; personLook: shaders.ts)
      .replace("#include <map_fragment>", "#include <map_fragment>\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), K_SKIN_DESATURATE * personLook );");
  };
  m.customProgramCacheKey = () => "lab-skin-sss-look" + (mask ? "-mask" : "");
  return m;
}
/** Eye. B5's eyeball (pipeline/eyes.py marks its eye materials with glTF extras): the shell or the wet line. Without the marker a
 *  plain clear-coat sphere (the lab's procedural iris for such an eye is not ported). */
export function eye(src: any, key: string, opts: any = {}): THREE.MeshPhysicalMaterial {
  const b5 = src.userData?.b5eye;
  if (b5?.kind === "wet") return eyeWet(src);
  if (b5) return eyeShell(src, key, b5, opts);
  const m = new THREE.MeshPhysicalMaterial(); copyMaps(m, src);
  m.roughness = EY.roughness; m.clearcoat = EY.clearcoat[0]; m.clearcoatRoughness = EY.clearcoat_roughness; m.ior = EY.ior; m.color.set(0xffffff);
  return m;
}
const EYE_DEFINES = glslDefines({ limbus_band: ES.limbus_band, refract_guard: ES.refract_guard, iris_edge: ES.iris_edge, iris_tone: ES.iris_tone, iris_darken: ES.iris_darken, limbal_ring: ES.limbal_ring,
  pupil_edge: ES.pupil_edge, wall: ES.wall, wall_band: ES.wall_band, sclera_warm: ES.sclera_warm, sclera_warm_band: ES.sclera_warm_band, sclera_rim: ES.sclera_rim, veins: ES.veins, veins_band: ES.veins_band,
  limbal_shadow: ES.limbal_shadow, cornea_roughness: ES.cornea_roughness, iris_bowl: ES.iris_bowl, sclera_coat_roughness: ES.sclera_coat_roughness, lid_occlusion: ES.lid_occlusion, catch_color: ES.catch_color, ior: EY.ior }, "K_EYE_");
/** B5's eyeball. One closed surface per eye whose vertices carry their eye-local position (COLOR_0), so everything is computed in
 *  the eye's own frame: kind "shell": the surface has the corneal bulge; the iris is drawn on a plane behind it, found by
 *  refracting the view ray at the bulge, so it has depth and parallax; the bulge carries the clear coat = the catch-light.
 *  Iris colour from two manifest colours over one structure texture (R fibres, G pigment, B sclera veins), pupil size and the two
 *  lid planes as uniforms (eyes.ts moves them): the soft shadow under the lids is analytic. */
export function eyeShell(src: any, key: string, x: any, opts: any = {}): THREE.MeshPhysicalMaterial {
  const shell = x.kind === "shell";
  const m = new THREE.MeshPhysicalMaterial({ name: src.name, color: 0xffffff, roughness: EY.roughness, metalness: 0, ior: EY.ior, specularIntensity: EY.specular, clearcoat: shell ? EY.clearcoat[0] : EY.clearcoat[1], clearcoatRoughness: EY.clearcoat_roughness });
  const iris = opts.iris ?? { outer: EY.iris_outer, inner: EY.iris_inner }, ls = EY.lid_shadow, ct = EY.catch_light, cs = EY.catch_size, s0 = EY.shell;
  const old: any = eyeUniforms[key] ?? {}, keep = (o: any, rgb: number[]) => (o ? (o.value.fromArray(rgb), o) : { value: new THREE.Color().fromArray(rgb) });
  const u: any = eyeUniforms[key] = { centre: old.centre ?? { value: new THREE.Vector3() }, fwd: old.fwd ?? { value: new THREE.Vector3(0, 0, 1) }, radius: old.radius ?? { value: 0 },
    labEyeMap: { value: src.map ?? null }, labIrisA: keep(old.labIrisA, iris.outer), labIrisB: keep(old.labIrisB, iris.inner),     // the uniform kept, its colour this material's (the tone's iris: REVIEW-11)
    labPupil: old.labPupil ?? { value: opts.pupil ?? EY.pupil }, labSclera: { value: new THREE.Color().fromArray(opts.sclera ?? EY.sclera) },
    labLid: old.labLid ?? { value: [new THREE.Vector4(), new THREE.Vector4()] },      // upper, lower lid plane (normal, offset), eye-local, units of the radius: set by eyes.ts every frame
    labLidK: { value: new THREE.Vector4(opts.lidShadow ?? ls[0], ls[1], opts.lidShadowLower ?? ls[2], ls[3]) },
    labCatch: { value: new THREE.Vector4(ct[0], ct[1], ct[2], opts.catchLight ?? ct[3]) }, labCatchSize: { value: new THREE.Vector2(Math.cos((opts.catchOuter ?? cs[0]) * Math.PI / 180), Math.cos((opts.catchInner ?? cs[1]) * Math.PI / 180)) },
    labEyeS: { value: new THREE.Vector4(x.limbus ?? s0[0], x.irisPlane ?? s0[1], x.scale ?? s0[2], x.irisUv ?? s0[3]) }, labShell: { value: shell ? 1 : 0 } };
  m.userData.labEye = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 color; uniform vec4 labEyeS; varying vec3 vEyeP; varying vec3 vEyeN; varying vec3 vEyeV; varying mat3 vE2V;")
      .replace("#include <project_vertex>", `#include <project_vertex>
	vEyeP = ( color - 0.5 ) * 2.0 * labEyeS.z; vEyeN = normal;
	mat3 labE = mat3( modelViewMatrix );
	#ifdef USE_SKINNING
		labE = labE * mat3( skinMatrix );
	#endif
	vE2V = labE; vEyeV = ( - mvPosition.xyz ) * labE;`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
${EYE_DEFINES}
varying vec3 vEyeP; varying vec3 vEyeN; varying vec3 vEyeV; varying mat3 vE2V;
uniform sampler2D labEyeMap; uniform vec3 labIrisA; uniform vec3 labIrisB; uniform vec3 labSclera; uniform float labPupil; uniform vec4 labLid[ 2 ]; uniform vec4 labLidK; uniform vec4 labEyeS; uniform float labShell; uniform vec4 labCatch; uniform vec2 labCatchSize;
float labCornea = 0.0; float labOcc = 1.0; vec2 labQ = vec2( 0.0 );`)
      .replace("#include <map_fragment>", `{
		vec3 P = vEyeP; vec3 Vl = normalize( vEyeV ); vec3 Nl = normalize( vEyeN );
		float lim = labEyeS.x; float rho = length( P.xy );
		labCornea = P.z > 0.0 ? 1.0 - smoothstep( lim * K_EYE_LIMBUS_BAND.x, lim * K_EYE_LIMBUS_BAND.y, rho ) : 0.0;
		vec2 q = P.xy;
		if ( labShell > 0.5 && labCornea > 0.0 ) {
			vec3 rd = refract( - Vl, Nl, 1.0 / K_EYE_IOR );
			vec3 Q = P + rd * ( max( P.z - labEyeS.y, 0.0 ) / max( - rd.z, K_EYE_REFRACT_GUARD ) );
			q = mix( P.xy, Q.xy, labCornea );
		}
		labQ = q;
		float r = length( q ) / ( lim * K_EYE_IRIS_EDGE );
		vec3 tI = texture2D( labEyeMap, 0.5 + vec2( q.x, - q.y ) / ( lim * K_EYE_IRIS_EDGE ) * labEyeS.w ).rgb;
		vec3 tS = texture2D( labEyeMap, 0.5 + 0.5 * vec2( P.x, - P.y ) ).rgb;
		vec3 iris = mix( labIrisA, labIrisB, tI.g ) * ( K_EYE_IRIS_TONE.x + K_EYE_IRIS_TONE.y * tI.r );
		iris *= mix( 1.0, K_EYE_IRIS_DARKEN.x, smoothstep( K_EYE_IRIS_DARKEN.y, 1.0, r ) );
		iris *= 1.0 - K_EYE_LIMBAL_RING.x * smoothstep( K_EYE_LIMBAL_RING.y, 1.0, r );                     // limbal ring
		iris = mix( iris, vec3( 0.0 ), smoothstep( labPupil + K_EYE_PUPIL_EDGE.x, labPupil - K_EYE_PUPIL_EDGE.y, r ) );   // pupil
		iris = mix( iris, K_EYE_WALL, smoothstep( K_EYE_WALL_BAND.x, K_EYE_WALL_BAND.y, r ) );          // the wall behind the limbus, seen at grazing angles
		vec3 scl = labSclera;
		scl = mix( scl, labSclera * K_EYE_SCLERA_WARM, K_EYE_SCLERA_WARM_BAND.x * smoothstep( lim * K_EYE_SCLERA_WARM_BAND.y, lim * K_EYE_SCLERA_WARM_BAND.z, rho ) );   // warmer toward the corners and the back
		scl *= mix( 1.0, K_EYE_SCLERA_RIM.x, smoothstep( lim * K_EYE_SCLERA_RIM.y, lim * K_EYE_SCLERA_RIM.z, rho ) );                   // the white is a ball: it darkens toward its rim
		scl = mix( scl, K_EYE_VEINS, tS.b * K_EYE_VEINS_BAND.x * smoothstep( lim * K_EYE_VEINS_BAND.y, lim * K_EYE_VEINS_BAND.z, rho ) );   // veins, fading before the limbus
		scl *= mix( K_EYE_LIMBAL_SHADOW.x, 1.0, smoothstep( lim, lim * K_EYE_LIMBAL_SHADOW.y, rho ) );                                    // limbal shadow on the white
		float dU = dot( labLid[ 0 ].xyz, P ) - labLid[ 0 ].w, dL = dot( labLid[ 1 ].xyz, P ) - labLid[ 1 ].w;
		labOcc = ( 1.0 - labLidK.x * exp( - max( dU, 0.0 ) / labLidK.y ) ) * ( 1.0 - labLidK.z * exp( - max( dL, 0.0 ) / labLidK.w ) );
		diffuseColor.rgb = mix( scl, iris, labCornea ) * labOcc;
	}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, K_EYE_CORNEA_ROUGHNESS, labCornea );")
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
	if ( labCornea > 0.0 && labShell > 0.5 ) normal = normalize( mix( normal, normalize( vE2V * vec3( - labQ, labEyeS.x * K_EYE_IRIS_BOWL ) ), labCornea ) );   // the iris is a shallow bowl: lit from the side opposite the light`)
      .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n\tmaterial.clearcoatRoughness = mix( K_EYE_SCLERA_COAT_ROUGHNESS, material.clearcoatRoughness, labCornea );")
      .replace("#include <opaque_fragment>", `outgoingLight *= mix( 1.0, labOcc, K_EYE_LID_OCCLUSION.x );
	{	// the eye light: one soft round source fixed to the camera (up and to the camera's left), reflected in the tear film. It is not a
		// scene light, so a cap's brim cannot shade it.
		vec3 labRv = reflect( - normalize( vViewPosition ), nonPerturbedNormal );
		float labH = smoothstep( labCatchSize.x, labCatchSize.y, dot( labRv, normalize( labCatch.xyz ) ) );
		outgoingLight += K_EYE_CATCH_COLOR * labH * labCatch.w * mix( K_EYE_LID_OCCLUSION.z, 1.0, labCornea ) * mix( 1.0, labOcc, K_EYE_LID_OCCLUSION.y );
	}
	#include <opaque_fragment>`);
    if (!sh.fragmentShader.includes("labOcc, K_EYE_LID_OCCLUSION.x")) throw new Error("eye shader patch did not apply (three.js chunk changed)");
  };
  m.customProgramCacheKey = () => "lab-eye-b5-" + key;
  return m;
}
/** The tear line on the lower lid (and any other wet glint mesh): nothing but reflections, added over what is behind. */
export function eyeWet(src: any): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ name: src.name, color: 0x000000, roughness: M.wet.roughness[0], metalness: 0, clearcoat: 1, clearcoatRoughness: M.wet.roughness[1], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
}
/** Lash and brow cards (B5): dark, matt, no sheen; alpha blended, premultiplied, depth write off, pulled a little toward the camera
 *  (polygon offset) so a brow card never z-fights the skin. `blend: false` in the manifest's options restores alpha-to-coverage. */
export function lashes(src: any, opts: any = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial(); copyMaps(m, src);
  m.roughness = LA.roughness; m.specularIntensity = LA.specular; m.color.multiplyScalar(opts.darken ?? LA.darken); m.shadowSide = THREE.FrontSide; m.side = THREE.DoubleSide;
  if (opts.blend === false) { m.transparent = false; m.alphaTest = opts.alphaTest ?? LA.alpha_test; m.alphaToCoverage = true; m.depthWrite = true; return m; }
  m.transparent = true; m.premultipliedAlpha = true; m.alphaToCoverage = false; m.depthWrite = false; m.depthTest = true; m.alphaTest = opts.discard ?? LA.discard;
  m.polygonOffset = true; m.polygonOffsetFactor = LA.polygon_offset[0]; m.polygonOffsetUnits = LA.polygon_offset[1];
  return m;
}
export function cornea(src: any, opts: any = {}): THREE.MeshPhysicalMaterial {
  const C = M.cornea, tf = C.thin_film;
  // additive: reflections only (also the recipe for a spectacle lens: no grey veil; `thinFilm` gives the faint coloured reflection of a coated lens)
  if (opts.additive) return new THREE.MeshPhysicalMaterial({ name: src.name, color: 0x000000, roughness: C.roughness[0], metalness: 0, ior: opts.thinFilm ? tf[0] : EY.ior, clearcoat: 1, clearcoatRoughness: C.roughness[0], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    side: src.side ?? THREE.FrontSide, iridescence: opts.thinFilm ?? 0, iridescenceIOR: tf[1], iridescenceThicknessRange: [tf[2], tf[3]], envMapIntensity: opts.thinFilm ? tf[4] : 1 });
  return new THREE.MeshPhysicalMaterial({ name: src.name, roughness: C.roughness[1], metalness: 0, ior: EY.ior, transmission: 1, thickness: C.thickness, transparent: true, opacity: 1, clearcoat: 1, clearcoatRoughness: C.roughness[1] });
}
/** Hair cards: alpha-to-coverage (needs MSAA; no sorting artefacts), two-sided, a stretched anisotropic highlight along the card. */
export function hair(src: any, opts: any = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial(); copyMaps(m, src);
  m.roughness = HA.roughness; m.anisotropy = HA.anisotropy; m.anisotropyRotation = Math.PI / 2; m.specularIntensity = HA.specular; m.sheen = HA.sheen[0]; m.sheenRoughness = HA.sheen[1]; m.sheenColor = m.color.clone().multiplyScalar(HA.sheen[2]);
  const hasAlpha = !!src.map && (src.transparent || src.alphaTest > 0 || opts.alphaTest);
  if (hasAlpha) { m.transparent = false; m.alphaTest = opts.alphaTest ?? HA.alpha_test; m.alphaToCoverage = true; m.side = THREE.DoubleSide; m.depthWrite = true; }
  return m;
}
export function cloth(src: any, opts: any, load: Loader): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial(); copyMaps(m, src);
  m.roughness = src.roughnessMap ? src.roughness : CL.roughness; m.sheen = CL.sheen[0]; m.sheenRoughness = CL.sheen[1]; m.sheenColor = m.color.clone().lerp(new THREE.Color(1, 1, 1), CL.sheen_tint[0]).multiplyScalar(CL.sheen_tint[1]); m.specularIntensity = CL.specular;
  if (m.alphaTest > 0) { m.alphaToCoverage = true; m.transparent = false; }      // a garment cut per pixel (alphaMode MASK): anti-aliased hem
  const detail = addDetail(opts, load, "weave", opts.tiling ?? CL.detail[0], CL.detail[1]);
  if (detail) { m.onBeforeCompile = detail; m.customProgramCacheKey = () => "lab-cloth-detail"; }
  return m;
}
export function leather(src: any, opts: any = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial(); copyMaps(m, src);
  m.roughness = src.roughnessMap ? src.roughness : LE.roughness; m.clearcoat = LE.clearcoat[0]; m.clearcoatRoughness = LE.clearcoat[1]; m.specularIntensity = LE.specular;
  if (!m.normalMap) { m.normalMap = tiled(detailNormal("leather"), opts.tiling ?? LE.detail[0]); m.normalScale.set(LE.detail[1], LE.detail[1]); }
  return m;
}
export function rubber(src: any): THREE.MeshPhysicalMaterial { const m = new THREE.MeshPhysicalMaterial(); copyMaps(m, src); m.roughness = M.rubber.roughness; m.specularIntensity = M.rubber.specular; return m; }

/** The look material of one mesh: the recipe of its class, then the person's shader patch. A "plain" material is the glTF material
 *  itself, patched (it belongs to the person alone). */
export function build(cls: MatClass, src: any, key: string, opts: any, U: PersonUniforms, load: Loader): THREE.Material {
  let m: THREE.Material;
  switch (cls) {
    case "skin": m = skin(src, opts, load); break; case "eye": m = eye(src, key, opts); break; case "cornea": m = cornea(src, opts); break; case "lashes": m = lashes(src, opts); break;
    case "hair": m = hair(src, opts); break; case "cloth": m = cloth(src, opts, load); break; case "leather": m = leather(src, opts); break; case "rubber": m = rubber(src); break;
    default: m = src;
  }
  return personShader(m, U, "-" + cls);
}
/** One material for every shown mesh of a style (the clay figure): MeshPhysicalMaterial from the style's block. */
export function styleMaterial(st: any, U: PersonUniforms): THREE.MeshPhysicalMaterial {
  const S = M.style;
  return personShader(new THREE.MeshPhysicalMaterial({ color: new THREE.Color().fromArray(st.color ?? S.color), roughness: st.roughness ?? S.roughness, metalness: st.metalness ?? 0, sheen: st.sheen ?? 0, clearcoat: st.clearcoat ?? 0 }), U, "-style");
}
