# Builds the clay body packages (FORMAT.md v0.3): the hm08 body (no helper geometry) in RP's measurement-driven shape
# space, on RR's 82-joint rig (4-influence re-fit, `_DQS` mask, dofs, drivers, poses), with a clay material. Owner: B1.
#   PY=$MANIKIN_PYTHON
#   $PY -I work/avatar-lab/pipeline/build_body.py                 # both sexes: packages/body-clay (man), packages/body-clay-f (woman)
#   $PY -I work/avatar-lab/pipeline/build_body.py --sex f [--rig rr|default] [--shape-root DIR] [--shape-tag -v2] [--shapes 32] [--out DIR]
# Other builders: `import build_body as bb; c = bb.context(sex="m")` (see pipeline/README.md, "Core").
import functools, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
import mh_core as mh, glb, core_rp

LAB = __import__("labpaths").LAB
N_SHAPE = 40            # RP's components in the package: all 40 since the viewer bakes shape on the CPU (FORMAT.md v0.4, 2d)
BAKE = True             # True: shape goes into <name>.shape.bin + `shape.bake` + `_SRC`, GPU morphs are the pc_* correctives only.
                        # False (`--no-bake`): shape components are glTF morph targets (keep `--shapes` at 32 or less then)
SHAPE_TAG = "-v2"       # RP's current space: RP/packages/rp-<sex>-v2 (the coordinator, round 4). "" = the first one
HELPERS = True          # RR's pose-driven helper joints (rig.HELPERS_ON): 14 leaf joints on ordinary `twist` drivers, ready since
                        # RR's 19:20 status line. `--helpers off` builds with the joints in the skeleton but unweighted and undriven.
EYES = True             # B5's request (README "Eyes"): the packages keep the four lid joints (children of `head`), `_DQS` = 1 on every
                        # vertex with a lid weight, the eye joints at eyes.eye_fit(), and the lids re-seated on B5's eyeball, by
                        # passing the context through eyes.eye_context() in build(). `context()` itself stays without them
                        # (B2 and B7 call eyes.eye_context(bb.context(sex)) themselves). `--no-eyes` leaves them out.
CORRECTIVES = ("pc_wrist_l_flex70", "pc_wrist_r_flex70")       # B3's pose correctives the designer admitted (round 4 ruling): wrists in flexion only
NAMES = {"m": "body-clay", "f": "body-clay-f"}
SEXNUM = {"m": 1, "f": 0}
# the designer's persons (VD/BENCHMARK.md section 6): stature mm, weight kg, extra controls (standard scores)
PERSONS = {"m": {"M50": (1756, 86, {}), "M95H": (1869, 115, {}), "M50_THIN": (1756, 58.6, {}), "M50_MID": (1756, 77.1, {}), "M50_HEAVY": (1756, 104.8, {})},
           "f": {"F05": (1523, 58, {}), "F50_THIN": (1628, 50.4, {}), "F50_MID": (1628, 66.3, {}), "F50_HEAVY": (1628, 90.1, {}),
                 "F05_LONGARM": (1523, 58, {"r_acromionradialelength": 1.645, "r_radialestylionlength": 1.645})}}


class Ctx:
    pass


def _volume(v, tris):
    a, b, c = v[tris[:, 0]], v[tris[:, 1]], v[tris[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


@functools.lru_cache(maxsize=None)
def context(sex="m", rig="rr", shape_root=None, shape_tag=SHAPE_TAG, n_shape=N_SHAPE):
    """Everything other builders share with the body: rest shape, shape targets, skeleton, weights, masks.
    sex "m" | "f" (RP's space is per sex); rig "rr" (RR's 82 joints, pipeline/rig.py) | "default" (MPFB2's 163 bones as
    painted); shape_root / shape_tag: where RP's packages are (default RP/packages/rp-<sex>; tag "-v2" = rp-<sex>-v2)."""
    base = mh.load_base(); c = Ctx(); c.base = base; c.sex = sex; c.rig_name = rig
    S = core_rp.load_space(sex, shape_root, shape_tag); c.space = S
    c.base_v = S["base"].copy(); c.floor = 0.0; c.offset = np.zeros(3)
    c.all_targets = {n: S["targets"][k] for k, n in enumerate(S["names"])}                # RP's 40, for CPU baking and checks
    c.targets = {n: S["targets"][k] for k, n in enumerate(S["names"][:n_shape])}           # the package's GPU morphs
    q = mh.body_quads(base, ("body",))
    c.quads = base.quads[q]; c.quad_uv = base.quad_uv[q]
    c.tris, c.tri_uv = mh.triangulate(c.quads, c.quad_uv)
    r = mh.load_rig("default"); c.rig = r
    if rig == "rr":
        import rig as rr
        if hasattr(rr, "HELPERS_ON"): rr.HELPERS_ON = bool(HELPERS)
        c.helpers = bool(HELPERS) and hasattr(rr, "HELPERS_ON")
        R = rr.for_body(c.base_v, c.targets, r); c.rr = R; c.pack = R["pack"]
        c.skeleton = R["skeleton"]; c.W = R["W"]; c.J4 = R["J4"]; c.W4 = R["W4"]; c.dqs = np.asarray(R["dqs"], dtype=np.float32)
        c.joint_targets = R["joint_targets"]
        c.J8, c.W8, c.skin8 = eight_influences(c)
        c.correctives, c.corrective_drivers, c.corrective_info = pose_correctives(c)
    else:
        heads, _ = mh.joint_positions(c.base_v, r)
        c.skeleton = glb.Skeleton([b.replace(".", "_") for b in r.bones], r.parent.copy(), heads, None)
        c.W = r.weights; c.J4, c.W4 = mh.prune_weights(r.weights, 4); c.dqs = None; c.rr = None; c.pack = None; c.J8, c.W8 = mh.prune_weights(r.weights, 8); c.skin8 = None
        c.joint_targets = {t: r.Rh @ d for t, d in c.targets.items()}
        c.correctives = {}; c.corrective_drivers = []; c.corrective_info = {}
    return c


def pose_correctives(c, names=None):
    """B3's pose-driven corrective morphs for this body (pipeline/correctives.py), cut to the admitted ones (CORRECTIVES).
    They are rest-pose deltas on the full 19,158 array, solved against this package's 4-influence masked dual-quaternion
    skinning: rebuilt whenever the body or the rig is. Returns (morphs, drivers, info); empty if B3's module fails."""
    names = CORRECTIVES if names is None else names
    if not names: return {}, [], {}
    try:
        import correctives as pc
        out = pc.add_correctives({"base_v": c.base_v, "pack": c.pack})
    except Exception as e:                                               # B3's module needs SOMA-X data and torch: the body must still build
        return {}, [], {"error": "%s: %s" % (type(e).__name__, e)}
    keep = [n for n in out["correctives"] if n in names]
    return ({n: out["correctives"][n] for n in keep}, [d for d in out["corrective_drivers"] if d["target"] in keep],
            {"kept": keep, "offered": list(out["correctives"]), "targets": {n: out["corrective_info"]["targets"].get(n) for n in keep}, "skinning": out["corrective_info"].get("skinning"), "source": out["corrective_info"].get("source")})


# The second skin set (coordinator's decision, round 3: 8 influences). `JOINTS_0` / `WEIGHTS_0` stay RR's 4-influence
# least-squares fit, complete on their own (sum 1), for any loader that reads one set. The 8-influence set is written
# whole and separately, under custom names, because (a) three's GLTFLoader drops `JOINTS_1` / `WEIGHTS_1` but keeps
# attributes that start with an underscore, and (b) glTF's `_1` set means "four more on top of set 0", which cannot be
# true while set 0 is a re-fitted, self-sufficient set. All eight, heaviest first, sum 1:
#   `_JOINTS8_0` (VEC4 uint8) + `_WEIGHTS8_0` (VEC4 float) = influences 1-4, `_JOINTS8_1` + `_WEIGHTS8_1` = influences 5-8.
SKIN8 = ("_JOINTS8_0", "_WEIGHTS8_0", "_JOINTS8_1", "_WEIGHTS8_1")


def eight(W, k=8):
    """Sparse (n,B) full weights -> (J (n,k) int, W (n,k) float32), heaviest first, renormalised; zero weights carry joint 0."""
    import rig as rr
    J, Wp = rr.pad(W, max(k, int(np.diff(W.tocsr().indptr).max())))
    o = np.argsort(-Wp, axis=1)[:, :k]; J = np.take_along_axis(J, o, 1); Wp = np.take_along_axis(Wp, o, 1)
    s = Wp.sum(1, keepdims=True); Wp = np.where(s > 0, Wp / np.where(s > 0, s, 1), 0); Wp[s[:, 0] <= 0, 0] = 1.0; J[Wp <= 0] = 0
    return J.astype(np.int64), Wp.astype(np.float32)


def eight_influences(c):
    """The body's 8-influence set from RR's full weights, and its error (and the 4-influence fit's) against the full
    weights over the designer's range-of-motion poses, linear blend, on body vertices."""
    import rig as rr
    J8, W8 = eight(c.W); body = c.base.vgroups["body"]; cnt = np.diff(c.W.tocsr().indptr); refit8 = None
    if cnt.max() > 8 and hasattr(rr, "_fit4"):
        # a few vertices have nine influences once the helper joints are on: plain truncation leaves millimetres there, so
        # those rows take RR's least-squares fit to eight (the same routine as the 4-influence fit, k = 8)
        try:
            Jf8, Wf8 = rr._fit4(c.pack, np.asarray(c.base_v, dtype=np.float64), c.W, rr.refit_poses(c.pack), 8)[:2]
            rows = np.nonzero(cnt > 8)[0]; o = np.argsort(-np.asarray(Wf8)[rows], axis=1)
            J8[rows] = np.take_along_axis(np.asarray(Jf8)[rows], o, 1); W8[rows] = np.take_along_axis(np.asarray(Wf8, dtype=np.float32)[rows], o, 1); J8[W8 <= 0] = 0
            refit8 = int(len(rows))
        except Exception as e_: refit8 = "failed: %s" % e_
    Jf, Wf = rr.pad(c.W); Jr = c.pack.joints(c.base_v); e8 = np.zeros(mh.NV); e4 = np.zeros(mh.NV); n = 0
    for p in c.rr["poses"]:
        if not str(p.get("id", "")).startswith("E"): continue
        M = rr.pose_matrices(c.pack, Jr, p["dofs"]); full = rr.skin(c.base_v, Jf, Wf, M); n += 1
        e8 = np.maximum(e8, np.linalg.norm(rr.skin(c.base_v, J8, W8.astype(np.float64), M) - full, axis=1))
        e4 = np.maximum(e4, np.linalg.norm(rr.skin(c.base_v, c.J4, c.W4.astype(np.float64), M) - full, axis=1))
    st = {"attributes": list(SKIN8), "semantics": "self-contained 8-influence set, heaviest first, sum 1; JOINTS_0 / WEIGHTS_0 are the separate 4-influence fit",
          "max_influences_full_body": int(cnt[body].max()), "body_vertices_over_4": int((cnt[body] > 4).sum()), "body_vertices_over_8": int((cnt[body] > 8).sum()), "rows_refitted_to_8": refit8, "poses": n,
          "error_8_vs_full_max_mm": round(float(e8[body].max() * 1000), 4), "error_4fit_vs_full_max_mm": round(float(e4[body].max() * 1000), 2),
          "error_4fit_vs_full_vertices_over_1mm": int((e4[body] > 1e-3).sum())}
    return J8, W8, st


SKIN8_MODE = "separate"     # "separate": as described above (default; nothing that reads JOINTS_0 changes).
                            # "gltf": glTF's own meaning, which viewer/src/dqs.ts reads today: JOINTS_0 / WEIGHTS_0 = the heaviest
                            # four of the eight (NOT summing to 1 alone), JOINTS_1 / WEIGHTS_1 = the other four; a loader that
                            # ignores the second set then gets plain truncation, not RR's fit. `--skin8 gltf` on the command line.


def body_mesh(c, hide=None, name="body", material="clay_body", morphs=None):
    """The body as a glb.Mesh on the package skeleton (4-influence weights, `_DQS`, shape morphs).
    hide: optional bool (19158,) per vertex, or bool (len(c.tris),) per triangle: a triangle is left out when all three of
    its vertices are hidden (or when its own flag is set). Vertex order and UVs are untouched, so masks, weights and
    morphs computed on the full array stay valid; unused vertices are dropped by the writer."""
    tris, tri_uv = c.tris, c.tri_uv
    if hide is not None:
        hide = np.asarray(hide, dtype=bool)
        drop = hide if len(hide) == len(tris) else hide[tris].all(1)
        tris, tri_uv = tris[~drop], tri_uv[~drop]
    if morphs is None: morphs = dict(c.correctives) if BAKE else {**c.targets, **c.correctives}
    src = {"_SRC": np.arange(mh.NV, dtype=np.float32)}           # source vertex = hm08 index; the shape file holds the body's 13,380 in that order
    if SKIN8_MODE == "gltf" and c.J8 is not None:
        a = {**(skin_attrs(c.dqs) or {}), **src}; a["JOINTS_1"] = np.asarray(c.J8[:, 4:8], dtype=np.int64); a["WEIGHTS_1"] = np.asarray(c.W8[:, 4:8], dtype=np.float32)
        return glb.Mesh(name, c.base_v, tris, material, uv=c.base.uv, tri_uv=tri_uv, joints=c.J8[:, :4], weights=c.W8[:, :4], morphs=dict(morphs), attrs=a)
    return glb.Mesh(name, c.base_v, tris, material, uv=c.base.uv, tri_uv=tri_uv, joints=c.J4, weights=c.W4,
                    morphs=dict(morphs), attrs={**(skin_attrs(c.dqs, c.J8, c.W8) or {}), **src})


def write_shape_bin(path, base, targets):
    """RP's synergon-shape/0.1 layout, which the viewer's CPU bake reads (FORMAT.md v0.4, 2d): float32 base[N*3], then
    int16 targets[K][N*3] with delta = int16 / 32767 * targetScale[k]. base (N,3) and targets {name: (N,3)} in the
    package frame, metres. Returns the manifest's `shape.bake` block without "meshes" and the largest rounding error."""
    names = list(targets); base = np.ascontiguousarray(base, dtype="<f4"); scales = []; err = 0.0
    with open(path, "wb") as f:
        f.write(base.tobytes())
        for n in names:
            d = np.asarray(targets[n], dtype=np.float64); sc = float(np.abs(d).max()) or 1.0
            q = np.round(d / sc * 32767).astype("<i2"); f.write(q.tobytes()); scales.append(sc)
            err = max(err, float(np.abs(q.astype(np.float64) / 32767 * sc - d).max()))
    return {"file": os.path.basename(path), "vertices": int(len(base)), "targets": names, "targetScale": [round(x, 9) for x in scales], "frame": "package", "offset": [0, 0, 0]}, err


def read_shape_bin(path, block):
    """What the viewer reads back: (base (N,3), {name: (N,3)})."""
    N = block["vertices"]; raw = open(path, "rb").read(); base = np.frombuffer(raw, dtype="<f4", count=N * 3).reshape(N, 3).astype(np.float64)
    q = np.frombuffer(raw, dtype="<i2", count=len(block["targets"]) * N * 3, offset=N * 12).reshape(len(block["targets"]), N, 3).astype(np.float64) / 32767
    return base, {n: q[k] * block["targetScale"][k] for k, n in enumerate(block["targets"])}


def skin_attrs(dqs=None, J8=None, W8=None):
    """The custom skinning attributes of a mesh on the package skeleton: `_DQS` and the 8-influence set (see SKIN8).
    For a garment: dqs and (J8, W8) = bb.eight(W82) from its own weights on the 82 joints."""
    a = {}
    if dqs is not None: a["_DQS"] = np.asarray(dqs, dtype=np.float32)
    if J8 is not None:
        a[SKIN8[0]] = np.asarray(J8[:, :4], dtype=np.int64); a[SKIN8[1]] = np.asarray(W8[:, :4], dtype=np.float32)
        a[SKIN8[2]] = np.asarray(J8[:, 4:8], dtype=np.int64); a[SKIN8[3]] = np.asarray(W8[:, 4:8], dtype=np.float32)
    return a or None


# ------------------------------------------------------------------------------------------------ shape model (RP's)
def shape_model(c):
    """RP's controls, linear model, read-back measures, restricted to the package's morphs. Returns the same tuple as
    round 1: (controls, model, measures, person, mesh, weights, info). person(sex, stature_mm, mass_kg=None, **extra)
    -> (control values, achieved); `sex` (1 man, 0 woman) is only compared with the context's sex."""
    sh = c.space["manifest"]["shape"]; keep = set(c.targets)
    controls = sh["controls"]; mo = sh["model"]
    model = {"inputs": mo["inputs"], "centre": mo["centre"], "scale": mo["scale"], "targets": {t: d for t, d in mo["targets"].items() if t in keep}}
    measures = [{**m, "perTarget": {t: v for t, v in m.get("perTarget", {}).items() if t in keep}} for m in sh.get("measures", [])]
    full = mo["targets"]; body = c.base.vgroups["body"]
    def weights(vals, all_components=False):
        x = [((vals.get(i, controls[k]["default"]) - mo["centre"][k]) / mo["scale"][k]) for k, i in enumerate(mo["inputs"])]
        return {t: min(d.get("max", 3), max(d.get("min", -3), d.get("bias", 0) + sum(a * b for a, b in zip(d["coef"], x)))) for t, d in (full if all_components else model["targets"]).items()}
    def mesh(vals, all_components=False):
        w = weights(vals, all_components); T = c.all_targets if all_components else c.targets; v = c.base_v.copy()
        for t, k in w.items():
            if k: v = v + k * T[t]
        return v
    def person(sex, stature_mm, mass_kg=None, **extra):
        vals = {"stature": float(stature_mm), **extra}
        if mass_kg is not None: vals["mass"] = float(mass_kg)
        v = mesh(vals); ach = {"stature_mm_rest_pose": round(float((v[body, 1].max() - v[body, 1].min()) * 1000), 1),
                               "enclosed_volume_l": round(_volume(v, c.tris) * 1000, 1), "max_vertex_move_from_dropped_components_mm": round(float(np.linalg.norm((mesh(vals, True) - v)[body], axis=1).max() * 1000), 1)}
        if sex is not None and int(sex) != SEXNUM[c.sex]: ach["sex_mismatch"] = True
        return vals, ach
    info = {"sex": c.sex, "source": c.space["paths"]["tag"], "components": len(c.all_targets), "kept": len(c.targets)}
    return controls, model, measures, person, mesh, weights, info


def dropped_report(c):
    """What leaving RP's components beyond the GPU budget out costs, on RP's 256 fitted people."""
    z = np.load(c.space["paths"]["transfer"], allow_pickle=True); C = z["C"]; k = len(c.targets); body = c.base.vgroups["body"]
    if C.shape[1] <= k: return {"dropped": 0}
    T = np.stack([c.all_targets[n] for n in list(c.all_targets)[k:]])[:, body]
    d = np.linalg.norm(np.einsum("nk,kvi->nvi", C[:, k:], T), axis=2)
    J = np.array(c.space["shape"]["readback"]["J"]); dims = c.space["shape"]["dims"]; dm = C[:, k:] @ J[k:]          # metres (kg for weight)
    rms = np.sqrt((dm ** 2).mean(0)); worst = np.argsort(-rms / np.array(c.space["shape"]["map"]["sd"]))[:4]
    return {"dropped": int(C.shape[1] - k), "names": list(c.all_targets)[k:], "vertex_move_mm": {"rms": round(float(np.sqrt((d ** 2).mean()) * 1000), 2), "p99": round(float(np.percentile(d, 99) * 1000), 2), "max": round(float(d.max() * 1000), 1)},
            "readback_change_rms_largest": {dims[i]: (round(float(rms[i]), 2) if dims[i] == "weightkg" else round(float(rms[i] * 1000), 2)) for i in worst}, "units": "mm (weightkg: kg), linear read-back, RMS over RP's 256 fitted people"}


# ------------------------------------------------------------------------------------------------ the packet block
def packet_block(c, out):
    """The manifest's `packet` block. Range-of-motion poses come from poses.json by id (viewer/packet.ts reads them since
    round 4), so no clinical-angle map is written; persons of the other sex come from the other package."""
    R = c.rr; P = {p["id"]: p for p in R["poses"]}; import rig as rr
    neutral = rr.clinical_to_dofs(c.pack, {"both_sides": True, "hand": "HAND_RELAXED"})
    other = NAMES["f" if c.sex == "m" else "m"]
    old = os.path.join(out, "packet-shots.json")
    if os.path.exists(old): os.remove(old)                              # round 2-3 workaround, no longer needed
    return {"neutral": {}, "poses": {"A_POSE": {"dofs": P["A_POSE"]["dofs"]}, "RELAXED_STAND": {"dofs": neutral}, "SEATED_GRIPS": {"dofs": P["SEATED_GRIPS"]["dofs"], "seat": True}, "HAND_POSE_ARM": {"dofs": P["HAND_POSE_ARM"]["dofs"]}},
            "angles": {}, "clips": {}, "seat": {"pelvisAbovePan": 0.085, "pelvisFromRearEdge": 0.13},
            "otherPackages": ["../%s/%s.avatar.json" % (other, other)],
            "missing": ["grips and armrests", "packet.hands / packet.palm (hand shots are shown as rigged)"]}


def merge_motion(man, out):
    """B4's motion block (clips/manifest-block.json beside the package: `clips`, `packet.clips`, `motion`), if there is one.
    Run by every build, and on its own by `build_body.py --merge-motion` (after B4 bakes, no rebuild needed). The block
    replaces what was merged before; its SHA-1 is recorded so `motion_stale()` can tell when the manifest lags the file."""
    f = os.path.join(out, "clips", "manifest-block.json")
    if not os.path.exists(f): return None
    import hashlib, time
    raw = open(f, "rb").read(); b = json.loads(raw)
    if b.get("clips"): man["clips"] = b["clips"]
    if b.get("packet", {}).get("clips"): man["packet"]["clips"] = b["packet"]["clips"]
    for k, v in b.get("packet", {}).items():
        if k == "poses": man["packet"].setdefault("poses", {}).update(v)           # B4 round 6 (README Motion): the block's poses replace B1's (RELAXED_STAND); applied by RR, B1 not running
        elif k != "clips": man["packet"].setdefault(k, v)
    if "motion" in b: man["motion"] = b["motion"]
    for k, v in b.items():                                               # anything else B4 adds at the top level travels too
        if k not in ("clips", "packet", "motion", "note"): man[k] = v
    return {"file": "clips/manifest-block.json", "sha1": hashlib.sha1(raw).hexdigest(), "written": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(f))),
            "merged": time.strftime("%Y-%m-%d %H:%M:%S"), "clips": [c_["name"] for c_ in b.get("clips", [])], "motion_persons": sorted((b.get("motion") or {}).get("persons", {})) if isinstance((b.get("motion") or {}).get("persons"), dict) else None, "note": b.get("note")}


def motion_stale(out, name):
    """True when clips/manifest-block.json differs from the one merged into the manifest (or was never merged)."""
    import hashlib
    f = os.path.join(out, "clips", "manifest-block.json"); mf = os.path.join(out, name + ".avatar.json")
    if not os.path.exists(f) or not os.path.exists(mf): return False
    return hashlib.sha1(open(f, "rb").read()).hexdigest() != ((json.load(open(mf)).get("build") or {}).get("motion_block") or {}).get("sha1")


def remerge_motion(sex, out=None):
    """Merge B4's block into an existing manifest without rebuilding anything else."""
    name = NAMES[sex]; out = out or os.path.join(LAB, "packages", name); mf = os.path.join(out, name + ".avatar.json")
    man = json.load(open(mf)); info = merge_motion(man, out); man.setdefault("build", {})["motion_block"] = info
    json.dump(man, open(mf, "w"), indent=1); print(name, "motion block:", json.dumps(info)[:400]); return info


def with_eyes(c):
    """A copy of the context as B5's eyes.eye_context() makes it, in the fields body_mesh() and build() read: skeleton
    + 4 lid joints, eye joints on the fitted centres, lids re-seated in the base and in every target, lid weights,
    `_DQS` = 1 on the lids. The 4-influence set is B5's; in the 8-influence set the rows B5 changed repeat the 4-set."""
    import copy, eyes
    e = eyes.eye_context(c); d = copy.copy(c); nb = len(c.skeleton.names)
    d.base_v = e.base_v; d.targets = dict(e.targets); d.all_targets = d.targets; d.skeleton = e.skeleton; d.joint_targets = e.joint_targets
    d.W = e.W; d.dqs = np.asarray(e.dqs, dtype=np.float32); d.J4, d.W4 = mh.prune_weights(e.W, 4)
    W0 = sp.csr_matrix((np.asarray(c.W4, dtype=np.float64).ravel(), (np.repeat(np.arange(len(c.J4)), 4), np.asarray(c.J4).ravel())), shape=c.W.shape)
    changed = np.asarray(np.abs(e.W[:, :nb] - W0).sum(1)).ravel() + np.asarray(e.W[:, nb:].sum(1)).ravel() > 1e-6
    d.J8 = c.J8.copy(); d.W8 = c.W8.copy()
    d.J8[changed] = 0; d.W8[changed] = 0; d.J8[changed, :4] = d.J4[changed]; d.W8[changed, :4] = d.W4[changed]
    moved = np.linalg.norm(e.base_v - c.base_v, axis=1) > 1e-7
    d.eyes_info = {"lid_joints": list(e.skeleton.names[nb:]), "joints": len(e.skeleton.names), "vertices_reseated": int(moved.sum()), "reseat_max_mm": round(float(np.linalg.norm(e.base_v - c.base_v, axis=1).max() * 1000), 2),
                   "rows_with_changed_weights": int(changed.sum()), "target_change_max_mm": round(float(max(np.linalg.norm(e.targets[k] - c.targets[k], axis=1).max() for k in c.targets) * 1000), 3),
                   "eye_joint_moved_mm": [round(float(np.linalg.norm(e.skeleton.head[e.skeleton.names.index(n)] - c.skeleton.head[c.skeleton.names.index(n)]) * 1000), 2) for n in ("eye_l", "eye_r")]}
    d.lid_moved = moved
    return d


def bake_check(c, out, name, block, qerr):
    """The shape file as the viewer reads it, for the package's persons: against this build's float targets, and against
    RP's own Anny-space file on the vertices they share (so RP's tape numbers hold for the baked body); plus the
    manifest's linear read-back of each person."""
    base, T = read_shape_bin(os.path.join(out, name + ".shape.bin"), block)
    controls, model, measures, person, mesh_of, weights_of, info = shape_model(c)
    idx, ab, at, _ = core_rp.anny_space(c.sex, None, c.space["paths"]["tag"].split("rp-" + core_rp.SEXNAME[c.sex])[1]); nb = len(base)
    shared = idx < nb; rows = {}
    if getattr(c, "lid_moved", None) is not None: shared = shared & ~c.lid_moved[np.minimum(idx, len(c.lid_moved) - 1)]      # B5's lid vertices differ from RP's by design
    for key, (st, kg, extra) in PERSONS[c.sex].items():
        vals, _ = person(SEXNUM[c.sex], st, kg, **extra); w = weights_of(vals)
        v = base + sum(w[t] * T[t] for t in block["targets"]); ref = mesh_of(vals)[:nb]
        rp = ab + np.einsum("k,kvi->vi", np.array([w["pc%02d" % k] for k in range(len(at))]), at)
        rb = {m["id"]: round(m["base"] + sum(w.get(t, 0) * k for t, k in m.get("perTarget", {}).items()), 1) for m in measures}
        rows[key] = {"file_vs_build_max_mm": round(float(np.linalg.norm(v - ref, axis=1).max() * 1000), 4),
                     "file_vs_RP_anny_space_max_mm": round(float(np.linalg.norm(v[idx[shared]] - rp[shared], axis=1).max() * 1000), 4),
                     "readback": {k: rb[k] for k in list(rb)[:6]}, "asked": {"stature_mm": st, "mass_kg": kg}}
    return {"file": block["file"], "bytes": os.path.getsize(os.path.join(out, name + ".shape.bin")), "vertices": block["vertices"], "components": len(block["targets"]), "int16_rounding_max_mm": round(qerr * 1000, 5), "persons": rows}


def build(out=None, sex="m", rig="rr", shape_root=None, shape_tag=SHAPE_TAG, n_shape=N_SHAPE, hide=None):
    name = NAMES[sex]; out = out or os.path.join(LAB, "packages", name); os.makedirs(out, exist_ok=True)
    c = context(sex, rig, shape_root, shape_tag, n_shape)
    if EYES and c.rr:
        try: c = with_eyes(c)
        except Exception as e_: print("  eyes: NOT applied (%s: %s)" % (type(e_).__name__, e_))
    controls, model, measures, person, mesh_of, weights_of, info = shape_model(c)
    mats = {"clay_body": {"pbrMetallicRoughness": {"baseColorFactor": [0.5, 0.5, 0.5, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.9}}}
    gp = os.path.join(out, name + ".glb")
    stats = glb.write_glb(gp, [body_mesh(c, hide)], c.skeleton, mats, generator="synergon avatar-lab pipeline/build_body.py (MPFB2 2.0.18 data, CC0)")
    problems = glb.validate(gp)
    bake = None; body_ix = np.nonzero(c.base.vgroups["body"])[0]
    assert (body_ix == np.arange(len(body_ix))).all()              # the body is hm08 vertices 0..13379: `_SRC` = hm08 index = file row
    if BAKE:
        bake, qerr = write_shape_bin(os.path.join(out, name + ".shape.bin"), c.base_v[body_ix], {t: d[body_ix] for t, d in c.targets.items()})
        bake["meshes"] = ["body"]; bake_info = bake_check(c, out, name, bake, qerr)
    else:
        bake_info = None
        if os.path.exists(os.path.join(out, name + ".shape.bin")): os.remove(os.path.join(out, name + ".shape.bin"))
    P = {}; achieved = {}
    for key, (st, kg, extra) in PERSONS[sex].items(): P[key], achieved[key] = person(SEXNUM[sex], st, kg, **extra)
    names = c.skeleton.names; r5 = lambda a: [round(float(x), 5) for x in a]; rp = c.space["manifest"]; sh = rp["shape"]
    eyes = [c.skeleton.head[names.index(n)][1] for n in ("eye_l", "eye_r", "eye_L", "eye_R") if n in names]
    body = c.base.vgroups["body"]
    man = {
        "format": "synergon-avatar/0.4", "name": name, "glb": name + ".glb",
        "note": "Clay body (%s) for deformation and shape review: hm08 body without helper geometry; RP's measurement-driven shape space (%s, %d of %d components, baked on the CPU from the shape file); %s; B3's wrist-flexion correctives. No head kit, no clothes, no textures." % (
            "man" if sex == "m" else "woman", info["source"], info["kept"], info["components"],
            "RR's 82-joint rig, 4-influence least-squares weights, `_DQS` mask, a second 8-influence skin set" if rig == "rr" else "MPFB2 `default` rig as painted, truncated to 4 influences, no dofs"),
        "licence": [{"what": "body mesh, UVs, shape targets, rig, weights", "source": "MPFB2 2.0.18 data (MakeHuman hm08)", "licence": "CC0-1.0", "verified": "2026-11-24 by RA (RA/REPORT.md); CC0 header read in base.obj and weights.default.json by B1"},
                    {"what": "shape space (fit to ANSUR II measurements; no survey data in the package)", "source": "RP (work/avatar-lab/RP), on Anny 0.6.2 phenotypes and MakeHuman targets", "licence": "Apache-2.0 (Anny code), CC0-1.0 (targets)", "verified": "see RP/REPORT.md"}],
        "rest": {"pose": "A", "stature": round(float(c.base_v[body, 1].max()), 4), "eyeHeight": round(float(np.mean(eyes)), 4) if eyes else None,
                 "soleHeight": 0.0,          # metres added to y above bare soles (shoes): 0 for the bare clay body. The one place every style reads it (viewer/src/eyes.ts, pipeline/abstract.py)
                 "note": (c.rr["rest_note"] if c.rr else "hm08's own rest pose, not re-posed")},
        "shape": {"sex": sex, "controls": controls, "model": model,
                  "jointDeltas": {t: {names[i]: r5(d[i]) for i in range(len(names)) if np.abs(d[i]).max() > 5e-6} for t, d in c.joint_targets.items()},
                  "measures": measures,
                  "presets": [{"name": k, "values": v} for k, v in P.items()] + [p for p in sh.get("presets", [])],
                  **({"prior": sh["prior"]} if "prior" in sh else {}), **({"bake": bake} if bake else {})},
        "materials": {"clay_body": {"class": "plain"}},
    }
    if c.rr:
        R = c.rr
        man.update({"dofs": R["dofs"], "drivers": list(R["drivers"]) + list(c.corrective_drivers), "posesFile": "poses.json", "clips": [], "anchors": R["anchors"]})
        if R.get("controls"): man["controls"] = R["controls"]
        json.dump(R["poses"], open(os.path.join(out, "poses.json"), "w"), indent=1)
        man["packet"] = packet_block(c, out)
    else:
        man["packet"] = {"poses": {"A_POSE": {"dofs": {}}}, "angles": {}, "clips": {}}
    man["packet"]["persons"] = P; man["packet"]["persons_achieved"] = achieved
    motion = merge_motion(man, out)
    man["build"] = {"sex": sex, "rig": rig, "shape": {"source": os.path.relpath(c.space["paths"]["dir"], LAB), "files_sha1_12": c.space["key"], "transfer_check": c.space["check"], "dropped": dropped_report(c),
                                                     "survey_check": core_rp.survey_check(c.space, sex, keep=len(c.targets))},
                    "refit": (c.rr["refit"] if c.rr else None), "skin8": ({**c.skin8, "mode": SKIN8_MODE} if c.skin8 else None), "correctives": c.corrective_info, "eyes": getattr(c, "eyes_info", None), "shape_bake": bake_info, "motion_block": motion, "helper_joints": ("on" if getattr(c, "helpers", False) else "off (in the skeleton, no weight, no driver)"), "stats": stats, "validate": problems}
    json.dump(man, open(os.path.join(out, name + ".avatar.json"), "w"), indent=1)
    print(name, json.dumps(stats)); print("  validate:", problems or "clean")
    print("  shape:", json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in c.space["check"].items() if "anny" in k}))
    print("  dropped:", json.dumps(man["build"]["shape"]["dropped"]))
    if c.rr: print("  refit:", json.dumps(c.rr["refit"])); print("  skin8:", json.dumps(c.skin8)); print("  rest:", c.rr["rest_note"])
    print("  eyes:", json.dumps(getattr(c, "eyes_info", None)))
    print("  bake:", json.dumps({k: v for k, v in (bake_info or {}).items() if k != "persons"}), {k: (v["file_vs_build_max_mm"], v["file_vs_RP_anny_space_max_mm"]) for k, v in (bake_info or {}).get("persons", {}).items()})
    print("  correctives:", json.dumps(c.corrective_info.get("targets") or c.corrective_info)); print("  motion block:", json.dumps(motion)[:300])
    for k in P: print("  person %-12s %s -> %s" % (k, P[k], achieved[k]))
    return man


if __name__ == "__main__":
    a = sys.argv[1:]; opt = lambda n, d=None: a[a.index(n) + 1] if n in a else d
    if "--skin8" in a: SKIN8_MODE = opt("--skin8")
    if "--helpers" in a: HELPERS = opt("--helpers") == "on"
    if "--no-bake" in a: BAKE = False
    if "--no-eyes" in a: EYES = False
    if "--merge-motion" in a:
        for s in ([opt("--sex")] if "--sex" in a else ["m", "f"]): remerge_motion(s, opt("--out") if "--sex" in a else None)
        sys.exit(0)
    for s in ([opt("--sex")] if "--sex" in a else ["m", "f"]):
        build(opt("--out") if "--sex" in a else None, s, opt("--rig", "rr"), opt("--shape-root"), opt("--shape-tag", SHAPE_TAG), int(opt("--shapes", N_SHAPE)))
