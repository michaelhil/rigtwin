# One avatar package per sex in the lab viewer's format (work/avatar-lab/FORMAT.md v0.1), from out/space-<sex>.npz:
#   packages/rp-<sex>/rp-<sex>.glb           body, eyes, tongue on Anny's skeleton; K signed shape targets pc00.. (POSITION + NORMAL deltas)
#   packages/rp-<sex>/rp-<sex>.avatar.json   manifest: the `shape` section (controls, linear model, jointDeltas, measures, presets, prior)
#   packages/rp-<sex>/rp-<sex>.shape.json    everything a smarter runtime needs: the 38-dimension map, the conditional model's statistics,
#                                            the tape and caliper definitions, the refinement matrix, the vertex-order map to the MakeHuman base mesh
#   packages/rp-<sex>/rp-<sex>.shape.bin     the same targets as int16 deltas on the unshared 13,718 vertices, for baking on the CPU
# This is a carrier for the SHAPE SPACE. The look (raw Anny surface, flat colours) is below the floor and not for the owner.
# usage: python export.py <sex>
import sys, json, struct
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from rp import *
sex = sys.argv[1]; NAME = f"rp-{sex}{TAG}"; OUT = HERE + f"packages/{NAME}/"; os.makedirs(OUT, exist_ok=True)
Sp = np.load(HERE + OUTD + f"space-{sex}.npz"); ST = json.load(open(HERE + OUTD + f"stats-{sex}.json"))
PC, JPC, b0, W, mu, sd, Cov, A, Jm = (Sp[k] for k in ("PC", "JPC", "b0", "W", "mu", "sd", "Cov", "A", "Jm")); ORDER = [str(x) for x in Sp["order"]]; K = len(PC)
Vb = (Sp["Vm"].reshape(-1) + b0 @ PC).reshape(N, 3); Hb = (Sp["Hm"].reshape(-1) + b0 @ JPC).reshape(len(BL), 3)   # the person with every dimension at the survey mean
# the linear map leaves a constant stature offset (the fit trades stature against other heights): remove it with a uniform scale of the
# base about the floor origin (0.1-0.3 %), so the mean person has the mean stature. Off with RP_BASESCALE=0.
SC = 1.0 - ST["roundtrip_linear"]["stature"]["mean"] / (float(mu[0]) * 1000) if os.environ.get("RP_BASESCALE", "1") == "1" else 1.0
Vb = Vb * SC; Hb = Hb * SC
dV = PC.reshape(K, N, 3); dH = JPC.reshape(K, len(BL), 3)
with torch.no_grad():
    mb = measure(torch.tensor(Vb[None], dtype=FT), torch.tensor(Hb[None], dtype=FT), sex)
m_base = np.array([float(mb[d]) for d in DIMS]); U1 = np.array([1.0 if d == "weightkg" else 1000.0 for d in DIMS])
gl = lambda P: np.stack([P[..., 0], P[..., 2], -P[..., 1]], -1)                 # Anny/Blender (x left, -y forward, z up) -> glTF (x left, y up, z forward)
F = F_ALL
def normals(Vv):
    nn = np.cross(Vv[F[:, 1]] - Vv[F[:, 0]], Vv[F[:, 2]] - Vv[F[:, 0]]); Nn = np.zeros_like(Vv)
    for k in range(3): np.add.at(Nn, F[:, k], nn)
    return Nn / np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-12)
V0 = gl(Vb); J0 = gl(Hb); N0 = normals(V0)
assert N0[np.argmax(V0[:, 1])][1] > 0
dVg = gl(dV); dJg = gl(dH); dN = np.stack([normals(V0 + dVg[k]) - N0 for k in range(K)])
TN = [f"pc{k:02d}" for k in range(K)]
# ---- unshare vertices at UV seams; four influences
UV = np.asarray(M.texture_coordinates, dtype=np.float32); FUV = np.asarray(M.face_texture_coordinate_indices, dtype=np.int64)
key = F.ravel() * (len(UV) + 1) + FUV.ravel(); uniq, inv = np.unique(key, return_inverse=True)
SV = (uniq // (len(UV) + 1)).astype(np.int64); SU = (uniq % (len(UV) + 1)).astype(np.int64); SF = inv.reshape(-1, 3)
VW = M.vertex_bone_weights.numpy(); VI = M.vertex_bone_indices.numpy()
top = np.argsort(-VW, axis=1)[:, :4]; W4 = np.take_along_axis(VW, top, 1); I4 = np.take_along_axis(VI, top, 1); W4 = W4 / W4.sum(1, keepdims=True); I4[W4 == 0] = 0
comp = np.where(MAIN, 0, np.where(np.isin(DOM, bones("eye.L")), 1, np.where(np.isin(DOM, bones("eye.R")), 2, 3)))
REG = [("body", "skin_body", [0.62, 0.45, 0.38]), ("eye_L", "eye_ball", [0.9, 0.9, 0.9]), ("eye_R", "eye_ball", [0.9, 0.9, 0.9]), ("tongue", "tongue", [0.6, 0.3, 0.3])]
bufs = []; views = []; accs = []; off = 0
CT = {"f": 5126, "H": 5123, "B": 5121, "I": 5125}
def acc(arr, typ, fmt, target=None, minmax=False):
    global off
    a = np.ascontiguousarray(arr, dtype={"f": np.float32, "H": np.uint16, "B": np.uint8, "I": np.uint32}[fmt]); b = a.tobytes(); pad = (-len(b)) % 4
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(b)}
    if target: v["target"] = target
    views.append(v); bufs.append(b + b"\0" * pad); off += len(b) + pad
    d = {"bufferView": len(views) - 1, "componentType": CT[fmt], "count": int(a.shape[0]), "type": typ}
    if minmax: d["min"] = a.min(0).tolist(); d["max"] = a.max(0).tolist()
    accs.append(d); return len(accs) - 1
PAR = [int(p) if p is not None else -1 for p in M.bone_parents]; JN = [b.replace(".", "_") for b in BL]
nodes = [{"name": JN[i], "translation": [float(x) for x in (J0[i] - (J0[PAR[i]] if PAR[i] >= 0 else 0))]} for i in range(len(BL))]
for i, p in enumerate(PAR):
    if p >= 0: nodes[p].setdefault("children", []).append(i)
roots = [i for i, p in enumerate(PAR) if p < 0]
ibm = np.tile(np.eye(4, dtype=np.float32), (len(BL), 1, 1)); ibm[:, 3, :3] = -J0
skin = {"joints": list(range(len(BL))), "inverseBindMatrices": acc(ibm.reshape(-1, 16), "MAT4", "f"), "skeleton": roots[0]}
materials = []; mat_ix = {}; meshes = []; scene_nodes = list(roots); counts = {}
for rk, (mesh_name, mat_name, col) in enumerate(REG):
    fm = comp[F[:, 0]] == rk
    if not fm.any(): continue
    used, loc = np.unique(SF[fm].ravel(), return_inverse=True); sv = SV[used]
    if mat_name not in mat_ix: mat_ix[mat_name] = len(materials); materials.append({"name": mat_name, "pbrMetallicRoughness": {"baseColorFactor": col + [1.0], "metallicFactor": 0.0, "roughnessFactor": 0.6}})
    uv = UV[SU[used]].copy(); uv[:, 1] = 1 - uv[:, 1]
    prim = {"attributes": {"POSITION": acc(V0[sv], "VEC3", "f", 34962, True), "NORMAL": acc(N0[sv], "VEC3", "f", 34962), "TEXCOORD_0": acc(uv, "VEC2", "f", 34962),
                           "JOINTS_0": acc(I4[sv], "VEC4", "B", 34962), "WEIGHTS_0": acc(W4[sv], "VEC4", "f", 34962)},
            "indices": acc(loc.astype(np.uint32), "SCALAR", "H" if len(used) < 65535 else "I", 34963), "material": mat_ix[mat_name],
            "targets": [{"POSITION": acc(dVg[k][sv], "VEC3", "f", 34962, True), "NORMAL": acc(dN[k][sv], "VEC3", "f", 34962)} for k in range(K)]}
    meshes.append({"name": mesh_name, "primitives": [prim], "weights": [0.0] * K, "extras": {"targetNames": TN}})
    nodes.append({"name": mesh_name, "mesh": len(meshes) - 1, "skin": 0}); scene_nodes.append(len(nodes) - 1)
    counts[mesh_name] = {"vertices": int(len(used)), "triangles": int(fm.sum())}
gltf = {"asset": {"version": "2.0", "generator": "rigtwin avatar-lab RP/export.py (Anny 0.6.2 shape space)"}, "scene": 0, "scenes": [{"nodes": scene_nodes}], "nodes": nodes, "meshes": meshes,
        "skins": [skin], "materials": materials, "accessors": accs, "bufferViews": views}
blob = b"".join(bufs); gltf["buffers"] = [{"byteLength": len(blob)}]
js = json.dumps(gltf, separators=(",", ":")).encode(); js += b" " * ((-len(js)) % 4)
with open(OUT + NAME + ".glb", "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))); f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js); f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)
glb_bytes = os.path.getsize(OUT + NAME + ".glb")

# ---- the manifest's linear model: controls -> target weights
o = [DIMS.index(d) for d in ORDER]
Ad = np.zeros((len(DIMS), len(DIMS))); Ad[o] = A                              # x - mu (DIMS order) = Ad · controls (ORDER order, SI units)
CW = (Ad / sd[:, None]).T @ W                                                  # (38 controls, K): weight_k = sum_i ctl_i · CW[i, k]
D = ansur(sex)
LABEL = {"waistcircumference": "Build: waist for this stature and weight (− lean/muscular … + soft)", "sittingheight": "Trunk length for this size (− long legs … + long trunk)",
         "acromionradialelength": "Upper arm length", "radialestylionlength": "Forearm length", "biacromialbreadth": "Shoulder breadth (skeletal)", "hipbreadthsitting": "Hip breadth",
         "chestcircumference": "Chest girth", "buttockkneelength": "Thigh length (buttock to knee)", "kneeheightsitting": "Lower leg length (knee height)", "bicepscircumferenceflexed": "Upper arm girth",
         "thighcircumference": "Thigh girth", "calfcircumference": "Calf girth", "neckcircumference": "Neck girth"}
GROUP = lambda i: "Main" if i < 2 else "Build and proportions" if i < 15 else "Fine measurements"
controls = [{"id": "stature", "label": "Stature", "unit": "mm", "min": round(float(D["stature"].min() * 1000) - 60), "max": round(float(D["stature"].max() * 1000) + 60), "default": round(float(mu[0] * 1000), 1), "step": 1, "group": "Main"},
            {"id": "mass", "label": "Weight", "unit": "kg", "min": round(float(D["weightkg"].min()) - 5), "max": round(float(D["weightkg"].max()) + 10), "default": round(float(mu[DIMS.index("weightkg")]), 1), "step": 0.5, "group": "Main"}]
for i, d in enumerate(ORDER[2:], 2):
    controls.append({"id": "r_" + d, "label": LABEL.get(d, d) + (" (SD, given the controls above)" if i >= 3 else " (SD)"), "unit": "SD", "min": -3.5, "max": 3.5, "default": 0, "step": 0.05, "group": GROUP(i)})
ids = [c["id"] for c in controls]
centre = [controls[0]["default"], controls[1]["default"]] + [0] * (len(ids) - 2); scale = [1000, 1] + [1] * (len(ids) - 2)
r5 = lambda a: [round(float(x), 5) for x in a]
targets = {TN[k]: {"coef": r5(CW[:, k]), "min": -8, "max": 8} for k in range(K)}
joint_deltas = {TN[k]: {JN[j]: r5(dJg[k, j]) for j in range(len(BL))} for k in range(K)}
NICE = lambda d: d
measures = [{"id": d, "label": d, "unit": "kg" if d == "weightkg" else "mm", "base": round(float(m_base[i] * U1[i]), 2), "perTarget": {TN[k]: round(float(Jm[k, i] * U1[i]), 3) for k in range(K)}} for i, d in enumerate(DIMS)]
Ainv = np.linalg.inv(A)
def predict(given):
    a = [DIMS.index(k) for k in given]; bb = [i for i in range(len(DIMS)) if i not in a]; x = mu.copy(); va = np.array([given[k] for k in given]); x[a] = va
    if a: x[bb] = mu[bb] + Cov[np.ix_(bb, a)] @ np.linalg.solve(Cov[np.ix_(a, a)], va - mu[a])
    return x
def csd(d, given):
    a = [DIMS.index(k) for k in given]; i = DIMS.index(d); return float(np.sqrt(Cov[i, i] - Cov[i, a] @ np.linalg.solve(Cov[np.ix_(a, a)], Cov[a, i])))
def preset(name, given):
    x = predict(given); u = Ainv @ (x[o] - mu[o]); vals = {"stature": round(float(x[0] * 1000), 1), "mass": round(float(x[DIMS.index("weightkg")]), 1)}
    for i in range(2, len(ids)):
        if abs(u[i]) > 0.02: vals[ids[i]] = round(float(u[i]), 3)
    return {"name": name, "values": vals}
pc = lambda d, p: float(np.percentile(D[d], p)); who = "man" if sex == "male" else "woman"
g50 = {"stature": pc("stature", 50), "weightkg": pc("weightkg", 50)}; g5 = {"stature": pc("stature", 5)}
arm = {**g5, "acromionradialelength": predict(g5)[DIMS.index("acromionradialelength")] + 2 * csd("acromionradialelength", g5)}
arm["radialestylionlength"] = predict(arm)[DIMS.index("radialestylionlength")] + 2 * csd("radialestylionlength", arm)
presets = [preset(f"Median {who}", {}), preset(f"Small {who} (stature P5)", g5), preset(f"Tall {who} (stature P95)", {"stature": pc("stature", 95)}),
           preset("Short and heavy (stature P5, weight P95)", {"stature": pc("stature", 5), "weightkg": pc("weightkg", 95)}),
           preset("Tall and thin (stature P95, weight P5)", {"stature": pc("stature", 95), "weightkg": pc("weightkg", 5)}),
           preset("Median size, lean and muscular (waist −2 SD)", {**g50, "waistcircumference": predict(g50)[DIMS.index("waistcircumference")] - 2 * csd("waistcircumference", g50)}),
           preset("Median size, soft (waist +2 SD)", {**g50, "waistcircumference": predict(g50)[DIMS.index("waistcircumference")] + 2 * csd("waistcircumference", g50)}),
           preset("Short with long arms (stature P5, arm segments +2 SD)", arm),
           preset("Heavy (weight P99 at median stature)", {"stature": pc("stature", 50), "weightkg": pc("weightkg", 99)})]
VDP = json.load(open(HERE + "../VD/review-packet.json"))["persons"]
def person(p):
    g = {"stature": p["stature_mm"] / 1000, "weightkg": p["mass_kg"]}
    if "arm length" in p.get("note", ""):                       # arm length (acromion to fingertip) at this sex's 95th percentile, spread over the three segments
        segs = ["acromionradialelength", "radialestylionlength", "handlength"]; want = float(np.percentile(sum(D[d_] for d_ in segs), 95)); x0 = predict(g)
        sds = np.array([csd(d_, g) for d_ in segs]); t = (want - sum(x0[DIMS.index(d_)] for d_ in segs)) / sds.sum()
        for d_, s_ in zip(segs, sds): g[d_] = float(x0[DIMS.index(d_)] + t * s_)
    return preset("", g)["values"]
persons = {k: person(p) for k, p in VDP.items() if p["sex"] == sex}
manifest = {
    "format": "rigtwin-avatar/0.1", "name": NAME, "glb": NAME + ".glb",
    "note": "RP shape-space carrier: the surface is raw Anny in flat colours, BELOW the visual floor, not for the owner. It exists to prove sex-specific, measurement-driven shape on a shared topology.",
    "licence": [{"what": "mesh, skeleton, weights, shape targets", "source": "Anny 0.6.2 (NAVER LABS), MakeHuman-derived data; targets fitted by RP to ANSUR II", "licence": "Apache-2.0 (code), CC0-1.0 (data)", "verified": "2026-11-24 (github.com/naver/anny, read today)"}],
    "rest": {"pose": "A", "stature": round(float(m_base[0]), 4), "eyeHeight": round(float(J0[BI["eye.L"], 1]), 4)},
    "shape": {"sex": sex, "controls": controls,
              "model": {"inputs": ids, "centre": centre, "scale": scale, "targets": targets},
              "prior": {"inputs": ids, "bySex": {("1" if sex == "male" else "0"): {"mean": centre, "cov": "identity for the SD controls; stature and mass: " + json.dumps([[round(float(Cov[0, 0] * 1e6), 1), round(float(Cov[0, 37] * 1e3), 2)], [round(float(Cov[37, 0] * 1e3), 2), round(float(Cov[37, 37]), 2)]])}}},
              "jointDeltas": joint_deltas, "measures": measures, "presets": presets, "persons": persons,
              "full": NAME + ".shape.json"},
    "packet": {"persons": persons},
    "anchors": {"head": "head", "eye_L": "eye_L", "eye_R": "eye_R", "hand_L": "wrist_L", "hand_R": "wrist_R", "pelvis": "root"},
}
json.dump(manifest, open(OUT + NAME + ".avatar.json", "w"), separators=(",", ":"))
# ---- the CPU-bake route and the full map
q = np.abs(dV).reshape(K, -1).max(1); i16 = np.round(dV / q[:, None, None] * 32767).astype("<i2")
open(OUT + NAME + ".shape.bin", "wb").write(np.ascontiguousarray(Vb, dtype="<f4").tobytes() + i16.tobytes())
ser = lambda s: {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in s.items()}
full = {"format": "rigtwin-shape/0.1", "sex": sex, "frame": "Anny/Blender: +x the body's left, -y forward, +z up, metres; soles on z = 0, hip joints centred on x = y = 0",
        "vertices": N, "targets": K, "dims": DIMS, "baseScale": SC, "extremes": {"stature": [round(pc("stature", 1) * 1000), round(pc("stature", 99) * 1000)], "mass": [round(pc("weightkg", 1), 1), round(pc("weightkg", 99), 1)]}, "persons": persons, "units": "metres; weightkg in kg",
        "bin": {"file": NAME + ".shape.bin", "layout": "float32 base[N*3], then int16 targets[K][N*3]; delta = int16 / 32767 * targetScale[k]", "targetScale": q.tolist()},
        "map": {"doc": "coef[k] = sum_d ((x[d] - mean[d]) / sd[d]) * W[d][k]; vertices = base + sum_k coef[k] * target[k]; joints = jointBase + sum_k coef[k] * jointTargets[k]",
                "mean": mu.tolist(), "sd": sd.tolist(), "W": W.tolist()},
        "conditional": {"doc": "given dims a: x_b = mean_b + Cov_ba Cov_aa^-1 (x_a - mean_a) (shared/body.ts predictBody)", "cov": Cov.tolist()},
        "controls": {"order": ORDER, "A": A.tolist(), "doc": "x[order] - mean[order] = A · [stature - mean (m), weight - mean (kg), u3 … u38]"},
        "readback": {"doc": "linear: measured ≈ base + coef · J; exact: run the tape below on the mesh", "base": m_base.tolist(), "J": Jm.tolist()},
        "refine": {"doc": "coef += ((target - measured) / sd * sqrt(w)) · G^T, once or twice", "G": Sp["G"].tolist(), "w": [{"stature": 4.0, "weightkg": 4.0, "sittingheight": 2.0}.get(d, 1.0) for d in DIMS]},
        "joints": {"names": JN, "parents": PAR, "base": Hb.tolist(), "targets": dH.tolist()},
        "tape": {"doc": "see RP/rp.py measure(): slices are fixed points a·(1-t)+b·t on mesh edges; sets are vertex lists an extreme is taken over; verts are landmarks",
                 "slices": {k: ser(v) for k, v in SPEC["slices"].items()}, "sets": ser(SPEC["sets"]), "verts": SPEC["verts"], "counts": SPEC["counts"],
                 "constants": {"SIT_OFFSET": SIT_OFFSET[sex], "HIPSIT": HIPSIT[sex], "FLEX_BICEPS": FLEX_BICEPS[sex], "FLEX_FOREARM": FLEX_FOREARM[sex], "LUNG_GAS": LUNG_GAS[sex]}},
        "howToApplyToMPFB2": [
            "Vertex order: the N = 13,718 vertices are a subset of the MakeHuman hm08 base mesh in the same order; makehumanVertex.index[i] is the hm08 index of vertex i (identical to Anny's base_mesh_vertex_indices and to B1/anny_to_hm08.npy). Body 0..13379 without 1778..1793 and 8450..8465 (32 vertices Anny drops), tongue 13380..13605, eyeballs 14598..14741.",
            "Not covered: those 32 body vertices and every helper vertex (joint cubes, clothes helpers, eyelashes, teeth, hair). Exact way to get them: transfer-<sex>.npz holds, for each fitted person p, `target_weights[p]` over `target_names` (MakeHuman target files: 'universal:male-young-maxmuscle-averageweight' is macrodetails/universal-male-young-maxmuscle-averageweight, 'height:' and 'proportions:' and 'breast:' and the race files likewise; 'local_change:<name>' is the target file <name>), and this space's coefficients `C[p]`. body_p = hm08 base + sum_t target_weights[p][t] * target_t (apply_targets with these weights, NOT macro_weights(): Anny's phenotype scales differ from MakeHuman's sliders, e.g. Anny gender 0 = male, and its height and proportions blend the two end targets linearly). Then subtract `shift[p]` (Anny/Blender axes: x, -y forward, z up), fullTargets = least_squares(C, bodies - mean(bodies)), fullBase = (mean(bodies) + b0 . fullTargets) * base_scale (a uniform scale about the floor origin that removes the map's constant stature offset; `base_scale` is in the transfer file; targets are not scaled). On Anny's own vertices this reproduces the fitted bodies (export.py prints the check).",
            "Units: metres (MakeHuman target files are decimetres; MPFB2 objects are metres at scale 0.1).",
            "Axes: +x the body's left, -y forward, +z up (Blender and MPFB2, Anny). MakeHuman files are y up, z forward: (x, y, z)_file = (x, z, -y)_here. The GLB is glTF: (x, z, -y)_here as well.",
            "Origin: every body here stands with its soles on z = 0 and the midpoint of the hip joints on x = y = 0; `shift` in the transfer file is what was subtracted from Anny's frame per person. Use the base of the .shape.bin as the basis shape, not MPFB2's default.",
            "Skeleton: joints here are Anny's 104 bone heads. For another rig (MPFB2 default, 163 bones) take joint deltas from that rig's own vertex regressors applied to the full targets; they are linear, so jointDelta[k] = regressor . fullTargets[k].",
            "Controls, statistics and the measurement map do not depend on the mesh; only tape (vertex and edge ids, Anny order) does: re-index with makehumanVertex.index."],
        "makehumanVertex": {"doc": "index of each of the N vertices in the MakeHuman hm08 base mesh (19,158 vertices with helpers), same order", "index": M.base_mesh_vertex_indices.numpy().tolist()}}
json.dump(full, open(OUT + NAME + ".shape.json", "w"), separators=(",", ":"))
Fz = np.load(HERE + OUTD + f"fit-{sex}.npz")
V_ = Fz["V"].astype(np.float64); H_ = Fz["H"].astype(np.float64); sole_ = V_[:, SPEC["sets"]["foot"], 2].min(1); mid_ = (H_[:, BI["upperleg01.L"]] + H_[:, BI["upperleg01.R"]]) / 2
keys_ = [str(k) for k in Fz["keys"]]; grp = local_groups(sex); loc_full = np.zeros((len(V_), len(LAB)))
for j, k in enumerate(keys_):
    for i in grp[k]: loc_full[:, i] = Fz["local"][:, j]
Mo = anny.Anny(local_changes="all", topology="anny", rig="anny", phenotype_blendshapes="original")
ph_ = torch.tensor(Fz["phen"], dtype=torch.float64)
wp_ = PH.phenotype_blendshape_weights(ph_, Mo.phenotype_labels, Mo.anchors, Mo.stacked_phenotype_blend_shapes_mask, extrapolate=True).numpy()
wl_ = np.zeros((len(V_), 2 * len(LAB))); wl_[:, 0::2] = np.maximum(loc_full, 0); wl_[:, 1::2] = np.maximum(-loc_full, 0)
tw_ = np.concatenate([wp_, wl_], 1); tnames = [str(l) for l in Mo.blendshape_labels]; assert tw_.shape[1] == len(tnames)
used = np.abs(tw_).max(0) > 1e-9
recon = Mo.template_vertices.numpy()[None] + np.einsum("pt,tnk->pnk", tw_[:8][:, used], Mo.blendshapes.numpy()[used])
print("transfer check: bodies rebuilt from the MakeHuman target weights vs the fitted bodies, max difference (mm):", float(np.abs(recon - V_[:8]).max() * 1000), "| targets with non-zero weight:", int(used.sum()))
np.savez(OUT + f"transfer-{sex}.npz", base_scale=SC, target_names=np.array(tnames)[used], target_weights=tw_[:, used], phenotype_labels=np.array(M.phenotype_labels), phenotypes=Fz["phen"], local_labels=np.array(LAB), locals=loc_full, C=Sp["C"], b0=b0,
         shift=np.stack([mid_[:, 0], mid_[:, 1], sole_], 1), note=np.array("locals: value v > 0 applies the '-incr' (or named) MakeHuman target with weight v, v < 0 its opposite ('-decr', '-down', '-in', ...) with weight -v, as Anny does"))
print(NAME, "GLB bytes", glb_bytes, counts, "targets", K, "| manifest", os.path.getsize(OUT + NAME + ".avatar.json"), "| shape.json", os.path.getsize(OUT + NAME + ".shape.json"), "| shape.bin", os.path.getsize(OUT + NAME + ".shape.bin"))
json.dump({"glb_bytes": glb_bytes, "meshes": counts, "targets": K, "manifest_bytes": os.path.getsize(OUT + NAME + ".avatar.json"), "shape_json_bytes": os.path.getsize(OUT + NAME + ".shape.json"), "shape_bin_bytes": os.path.getsize(OUT + NAME + ".shape.bin")}, open(HERE + OUTD + f"package-{sex}.json", "w"))
