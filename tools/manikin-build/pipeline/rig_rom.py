# Range-of-motion check (owner: RR). Reads a package (GLB + manifest + poses), poses bodies through the designer's set E
# exactly as FORMAT.md section 3 describes (dofs -> twist drivers -> skinning with the package's 4 influences, and the
# masked dual-quaternion blend when the body carries the mask), and measures joint quality. API: rig.rom_check().
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
import rig as rg
import rig_contact as rc
import glb as glbio

SMALL = ("thumb", "index", "middle", "ring", "pinky", "finger", "metacarpal", "toe", "ball", "eye", "head", "jaw", "tongue", "oris", "levator",
         "special", "oculi", "orbicularis", "temporalis", "risorius")
ALIAS = {"upperarm": "upperarm01", "lowerarm": "lowerarm01", "hand": "wrist", "thigh": "upperleg01", "calf": "lowerleg01", "foot": "foot", "clavicle": "clavicle"}
CRITICAL = ("E02", "E04", "E06", "E11", "E12", "E21", "E24", "E26", "E27", "E33", "E36", "E38")
LIMITS = {"section_area_ratio_min": 0.8, "volume_pct": 3.0, "tip_ratio_min": 0.95, "twist_section_min": 0.92, "new_intersections": 0}


# ------------------------------------------------------------------------------------------------ package reading
def load_package(path, weld=True):
    man_path = path if path.endswith(".json") else next(os.path.join(path, f) for f in sorted(os.listdir(path)) if f.endswith(".avatar.json"))
    man = json.load(open(man_path)); root = os.path.dirname(man_path)
    js, blob = glbio.read_glb(os.path.join(root, man["glb"])); acc = lambda i: np.asarray(glbio.accessor(js, blob, i))
    skin = js["skins"][0]; jn = skin["joints"]; nodes = js["nodes"]; names = [nodes[i]["name"] for i in jn]
    par_node = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []): par_node[c] = i
    node_to_joint = {n: k for k, n in enumerate(jn)}
    parent = np.array([node_to_joint.get(par_node.get(n, -1), -1) for n in jn], dtype=np.int64)
    order = list(np.argsort([_depth(k, parent) for k in range(len(jn))], kind="stable"))        # parents before children
    remap = {old: new for new, old in enumerate(order)}
    names = [names[o] for o in order]; parent = np.array([remap[parent[o]] if parent[o] >= 0 else -1 for o in order], dtype=np.int64)
    J = np.zeros((len(jn), 3)); rotated = False
    for new, old in enumerate(order):
        n = nodes[jn[old]]; t = np.array(n.get("translation", [0, 0, 0]), dtype=np.float64)
        if "rotation" in n and abs(abs(n["rotation"][3]) - 1) > 1e-6: rotated = True
        J[new] = t + (J[parent[new]] if parent[new] >= 0 else 0)
    mesh_node = next(n for n in nodes if "mesh" in n and js["meshes"][n["mesh"]]["name"].startswith("body"))
    mesh = js["meshes"][mesh_node["mesh"]]; prim = mesh["primitives"][0]; a = prim["attributes"]
    P = acc(a["POSITION"]).astype(np.float64); tris = acc(prim["indices"]).astype(np.int64).reshape(-1, 3)
    Jv = np.vectorize(lambda x: remap[x])(acc(a["JOINTS_0"]).astype(np.int64)); Wv = acc(a["WEIGHTS_0"]).astype(np.float64)
    if "normalized" in js["accessors"][a["WEIGHTS_0"]] and Wv.max() > 1.5: Wv = Wv / Wv.max()
    if all(k in a for k in ("_JOINTS8_0", "_JOINTS8_1", "_WEIGHTS8_0", "_WEIGHTS8_1")):          # the viewer skins with the 8-influence set when present
        Jv = np.vectorize(lambda x: remap[x])(np.concatenate([acc(a["_JOINTS8_0"]), acc(a["_JOINTS8_1"])], 1).astype(np.int64))
        Wv = np.concatenate([acc(a["_WEIGHTS8_0"]), acc(a["_WEIGHTS8_1"])], 1).astype(np.float64); Wv = Wv / np.maximum(Wv.sum(1, keepdims=True), 1e-12)
    mask = None
    if "_DQS" in a: mask = acc(a["_DQS"]).astype(np.float64).ravel()
    elif "COLOR_0" in a and (pkg_legacy_color_mask := bool(man.get("build", {}).get("dqs_in_color"))):
        c = acc(a["COLOR_0"]).astype(np.float64); mask = c[:, 0] if c.ndim > 1 else c
        if mask.max() > 1.5: mask = mask / 255.0
    tn = (mesh.get("extras") or {}).get("targetNames") or []
    morphs = {tn[i]: acc(t["POSITION"]).astype(np.float64) for i, t in enumerate(prim.get("targets", [])) if i < len(tn)}
    # weld seam-split vertices (metrics need the closed surface)
    key = np.round(P / 1e-6).astype(np.int64); _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True); inv = inv.ravel()
    if not weld: first = np.arange(len(P)); inv = np.arange(len(P))                 # keep the GLB's own vertex order (reference dumps)
    pk = type("Pkg", (), {})()
    pk.manifest = man; pk.root = root; pk.names = names; pk.parent = parent; pk.joints = J; pk.rotated = rotated
    pk.v = P[first]; pk.tris = inv[tris]; pk.tris = pk.tris[(pk.tris[:, 0] != pk.tris[:, 1]) & (pk.tris[:, 1] != pk.tris[:, 2]) & (pk.tris[:, 0] != pk.tris[:, 2])]
    pk.J = Jv[first]; pk.W = Wv[first]; pk.mask = None if mask is None else mask[first]
    pk.morphs = {k: d[first] for k, d in morphs.items()}
    pk.contact = man.get("contact") if isinstance(man.get("contact"), dict) and man["contact"].get("capsules") else None
    pk.ct = {k: acc(a[k]).astype(np.float64).ravel()[first] for k in a if k.startswith("_CT_")}
    pk.contact_f = bool(pk.contact) and all("from" in c for c in pk.contact["capsules"])           # FORMAT.md 2f form (the viewer's)
    pk.cattr = acc(a["_CONTACT"]).astype(np.float64)[first] if "_CONTACT" in a else None
    if pk.contact and not pk.contact_f and pk.contact.get("rule") != rc.RULE: raise ValueError("rom_check: contact rule %r is not implemented here" % pk.contact.get("rule"))
    if pk.contact_f and any(c.get("flatten") for c in pk.contact["capsules"]): pk.contact_warn = "limb flatten (`flatten` > 0) is not evaluated by rom_check: receivers only"
    # FORMAT v0.4: shape components baked on the CPU from <name>.shape.bin (float32 base[N*3], then int16 targets[K][N*3];
    # delta = int16 / 32767 * targetScale[k]); the mesh finds its source vertex through the attribute `_SRC`
    pk.bake = None; bk = (man.get("shape") or {}).get("bake")
    if bk:
        if isinstance(bk, list):
            mine = [b for b in bk if "meshes" not in b or mesh["name"] in b["meshes"]]
            if len(mine) != 1: raise ValueError("rom_check: %d shape.bake files for the body mesh; this reader handles exactly one" % len(mine))
            bk = mine[0]
        N = int(bk["vertices"]); K = len(bk["targets"]); raw = open(os.path.join(root, bk["file"]), "rb").read()
        if len(raw) != N * 3 * 4 + K * N * 3 * 2: raise ValueError("rom_check: %s has %d bytes, expected float32 base + %d int16 targets for %d vertices" % (bk["file"], len(raw), K, N))
        base = np.frombuffer(raw, "<f4", N * 3).reshape(N, 3).astype(np.float64); d16 = np.frombuffer(raw, "<i2", K * N * 3, N * 12).reshape(K, N, 3)
        if "_SRC" in a: src = np.rint(acc(a["_SRC"]).ravel()).astype(np.int64)
        elif len(P) == N: src = np.arange(N)
        else: raise ValueError("rom_check: baked shape without `_SRC` on a mesh of %d vertices (file has %d)" % (len(P), N))
        if np.abs(base[src] - P).max() > 2e-4: raise ValueError("rom_check: the GLB's body does not match the base of %s through `_SRC` (%.4f m)" % (bk["file"], np.abs(base[src] - P).max()))
        pk.bake = {"names": list(bk["targets"]), "scale": np.asarray(bk["targetScale"], dtype=np.float64) / 32767.0, "d16": d16, "src": src[first]}
    poses = man.get("poses") or []
    if man.get("posesFile") and os.path.exists(os.path.join(root, man["posesFile"])): poses = json.load(open(os.path.join(root, man["posesFile"])))
    pk.poses = poses; pk.dofs = man.get("dofs") or []; pk.drivers = man.get("drivers") or []
    return pk


def _depth(k, parent):
    d = 0
    while parent[k] >= 0: k = parent[k]; d += 1
    return d


def body_of(pk, person):
    """Rest vertices and joints of one person: the manifest's shape model evaluated on a preset of that name."""
    sh = pk.manifest.get("shape") or {}; model = sh.get("model") or {}; ctrl = {c["id"]: c.get("default", 0) for c in sh.get("controls", [])}
    preset = next((p for p in sh.get("presets", []) if p["name"] == person), None)
    if preset is None: return None
    ctrl.update(preset["values"]); inputs = model.get("inputs", []); x = np.array([ctrl.get(i, 0.0) for i in inputs], dtype=np.float64)
    z = (x - np.array(model.get("centre", [0] * len(x)))) / np.array(model.get("scale", [1] * len(x)))
    v = pk.v.copy(); J = pk.joints.copy(); w_out = {}
    for t, rec in (model.get("targets") or {}).items():
        w = float(np.clip(rec.get("bias", 0.0) + np.dot(rec["coef"], z), rec.get("min", -3), rec.get("max", 3)))
        if abs(w) < 1e-9: continue
        w_out[t] = round(w, 4)
        if t in pk.morphs: v += w * pk.morphs[t]
        elif pk.bake and t in pk.bake["names"]:
            k = pk.bake["names"].index(t); v += (w * pk.bake["scale"][k]) * pk.bake["d16"][k][pk.bake["src"]]
        else: raise ValueError("rom_check: shape target %s of the manifest's model is neither a morph target of the body nor in shape.bake: this reader would pose the wrong body" % t)
        for jn, d in (sh.get("jointDeltas", {}).get(t) or {}).items():
            if jn in pk.names: J[pk.names.index(jn)] += w * np.array(d)
    return v, J, {"controls": preset["values"], "morph_weights": w_out}


# ------------------------------------------------------------------------------------------------ geometry
def closed_volume_setup(tris, nv):
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]]); key = np.minimum(e[:, 0], e[:, 1]) * nv + np.maximum(e[:, 0], e[:, 1])
    uk, cnt = np.unique(key, return_counts=True); be = e[np.isin(key, uk[cnt == 1])]
    if not len(be): return be, np.zeros(0, dtype=np.int64), 0
    g = sp.coo_matrix((np.ones(len(be)), (be[:, 0], be[:, 1])), shape=(nv, nv)); nc, lab = connected_components(g, directed=False)
    return be, lab[be[:, 0]], len(np.unique(lab[be[:, 0]]))
def volume(v, tris, caps):
    vol = np.einsum("ij,ij->i", v[tris[:, 0]], np.cross(v[tris[:, 1]], v[tris[:, 2]])).sum() / 6
    be, lab, _ = caps
    for l in np.unique(lab):
        m = lab == l; c = v[np.unique(be[m])].mean(0)
        vol += np.einsum("ij,ij->i", v[be[m, 1]], np.cross(v[be[m, 0]], c[None])).sum() / 6      # cap fan, wound against the open edge
    return float(vol)


def plane_loops(v, tris, c0, n, radius):
    """Cross-sections of the surface with the plane through c0 (normal n), only triangles within `radius` of c0.
    Returns [(area, centroid, open)] per connected loop."""
    cen = v[tris].mean(1); T = tris[np.linalg.norm(cen - c0, axis=1) < radius]
    d = (v - c0) @ n; D = d[T]; s = D > 0; cross = s.any(1) & ~s.all(1); T = T[cross]; D = D[cross]
    if not len(T): return []
    Pt = v[T]; fn = np.cross(Pt[:, 1] - Pt[:, 0], Pt[:, 2] - Pt[:, 0]); nv = len(v)
    pts = []; keys = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        hit = (D[:, a] > 0) != (D[:, b] > 0); t = np.where(hit, D[:, a] / np.where(hit, D[:, a] - D[:, b], 1), 0)
        pts.append((hit, Pt[:, a] + t[:, None] * (Pt[:, b] - Pt[:, a]))); keys.append(np.minimum(T[:, a], T[:, b]) * nv + np.maximum(T[:, a], T[:, b]))
    h0, h1, h2 = pts[0][0], pts[1][0], pts[2][0]
    p1 = np.where(h0[:, None], pts[0][1], pts[1][1]); k1 = np.where(h0, keys[0], keys[1])
    p2 = np.where((h0 & h1)[:, None], pts[1][1], pts[2][1]); k2 = np.where(h0 & h1, keys[1], keys[2])
    flip = ((p2 - p1) * np.cross(fn, n)).sum(1) < 0; a_ = np.where(flip[:, None], p2, p1); b_ = np.where(flip[:, None], p1, p2)
    uk, inv = np.unique(np.concatenate([k1, k2]), return_inverse=True); i1, i2 = inv[:len(k1)], inv[len(k1):]
    g = sp.coo_matrix((np.ones(len(i1)), (i1, i2)), shape=(len(uk), len(uk))); nc, lab = connected_components(g, directed=False)
    deg = np.bincount(np.concatenate([i1, i2]), minlength=len(uk)); out = []
    for l in range(nc):
        m = lab[i1] == l; c = 0.5 * (a_[m] + b_[m]).mean(0)
        area = abs(float((np.cross(a_[m] - c, b_[m] - c) @ n).sum() / 2))
        out.append((area, c, bool((deg[lab == l] != 2).any())))
    return out
def section_at(v, tris, c0, n, radius):
    """Area of the limb's own cross-section at c0: the largest closed loop whose centroid lies within radius/3 of c0
    (None if there is none, e.g. the cut runs out of the radius)."""
    loops = [l for l in plane_loops(v, tris, c0, rg.unit(n), radius) if not l[2] and l[0] > 5e-4 and np.linalg.norm(l[1] - c0) < radius / 3]
    if not loops: return None
    return max(loops, key=lambda l: l[0])[0]


def ray_far(v, tris, c, d, radius):
    cen = v[tris].mean(1); T = tris[np.linalg.norm(cen - c, axis=1) < radius]
    if not len(T): return None
    a = v[T[:, 0]]; e1 = v[T[:, 1]] - a; e2 = v[T[:, 2]] - a; h = np.cross(d, e2); det = (e1 * h).sum(1); ok = np.abs(det) > 1e-14; inv = 1 / np.where(ok, det, 1)
    s = c - a; u = (s * h).sum(1) * inv; q = np.cross(s, e1); w = (q @ d) * inv; t = (e2 * q).sum(1) * inv; hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1) & (t > 0)
    return float(t[hit].min()) if hit.any() else None


def _seg_tri(p, q, a, b, c):
    d = q - p; e1 = b - a; e2 = c - a; h = np.cross(d, e2); det = (e1 * h).sum(1); ok = np.abs(det) > 1e-14; inv = 1 / np.where(ok, det, 1)
    s = p - a; u = (s * h).sum(1) * inv; qq = np.cross(s, e1); w = (d * qq).sum(1) * inv; t = (e2 * qq).sum(1) * inv
    return ok & (u >= 0) & (w >= 0) & (u + w <= 1) & (t > 0) & (t < 1)
def intersecting_pairs(v, T, ids, chunk=256):
    """Intersecting, non-adjacent triangle pairs among triangles T (rows of vertex ids); returns (keys, depth_mm estimate)."""
    P = v[T]; lo = P.min(1); hi = P.max(1); I = []; Jx = []
    o = np.argsort(lo[:, 0]); lo_s = lo[o]; hi_s = hi[o]
    for s in range(0, len(T), chunk):
        e = min(s + chunk, len(T)); hmax = hi_s[s:e, 0].max(); stop = np.searchsorted(lo_s[:, 0], hmax, side="right")
        if stop <= s + 1: continue
        ov = ((lo_s[s:e, None] <= hi_s[None, s:stop]) & (hi_s[s:e, None] >= lo_s[None, s:stop])).all(2); i, j = np.nonzero(ov); i += s; j += s; k = i < j
        I.append(o[i[k]]); Jx.append(o[j[k]])
    if not I: return np.zeros(0, dtype=np.int64), np.zeros(0)
    I = np.concatenate(I); Jx = np.concatenate(Jx)
    share = (T[I][:, :, None] == T[Jx][:, None, :]).any((1, 2)); I = I[~share]; Jx = Jx[~share]
    hit = np.zeros(len(I), bool)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        hit |= _seg_tri(P[I, a], P[I, b], P[Jx, 0], P[Jx, 1], P[Jx, 2]); hit |= _seg_tri(P[Jx, a], P[Jx, b], P[I, 0], P[I, 1], P[I, 2])
    I = I[hit]; Jx = Jx[hit]
    def depth(A, Bt):                                                                   # how far A's corners sit behind B's plane
        n = np.cross(P[Bt, 1] - P[Bt, 0], P[Bt, 2] - P[Bt, 0]); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-20)
        return np.clip(-np.einsum("pki,pi->pk", P[A] - P[Bt, :1], n), 0, None).max(1)
    dep = np.minimum(depth(I, Jx), depth(Jx, I)) * 1000 if len(I) else np.zeros(0)
    gi = np.minimum(ids[I], ids[Jx]); gj = np.maximum(ids[I], ids[Jx])
    return gi * (int(ids.max()) + 1) + gj, dep


# ------------------------------------------------------------------------------------------------ one pose
def _jn(pk, base, side):
    """Joint index by our name or the MPFB alias (interim packages)."""
    for cand in (f"{base}_{side}", f"{ALIAS.get(base, base)}_{side.upper()}"):
        if cand in pk.names: return pk.names.index(cand)
    return None


def corrective_offsets(pk, R):
    """FORMAT.md `morph` and `morphPose` drivers, as the viewer evaluates them: the weight of each pose-corrective morph from
    the joints' local rotations R, and the summed rest-space offset (morphs apply before skinning). Unknown driver types raise."""
    dof = {d["id"]: d for d in pk.dofs}; ix = {n: i for i, n in enumerate(pk.names)}; cw = {}
    for d in pk.drivers:
        t = d.get("type")
        if t == "twist": continue
        if t == "morph":
            dd = dof.get(d["dof"])
            if dd is None or dd["joint"] not in ix: continue
            v = rg.twist_angle(R[ix[dd["joint"]]], dd["axis"]); cw[d["target"]] = max(cw.get(d["target"], 0.0), float(np.clip((v - d["from"]) / (d["to"] - d["from"]), 0, 1)))
        elif t == "morphPose":
            if d["joint"] not in ix: continue
            Q = np.eye(3)
            for dd in pk.dofs:
                if dd["joint"] == d["joint"] and d["pose"].get(dd["id"]): Q = Q @ rg.rot(dd["axis"], d["pose"][dd["id"]])
            ang = math.degrees(math.acos(np.clip((np.trace(Q.T @ R[ix[d["joint"]]]) - 1) / 2, -1, 1))); cw[d["target"]] = max(cw.get(d["target"], 0.0), 1 - ang / d["radius"], 0.0)
        else: raise ValueError("rom_check: driver type %r is not implemented in this evaluator" % t)
    off = None
    for t, w in cw.items():
        if w > 0 and t in pk.morphs: off = w * pk.morphs[t] if off is None else off + w * pk.morphs[t]
    return off, {k: round(v, 3) for k, v in cw.items() if v > 0}


def analyse(pk, body, pose, ctx, full=True):
    v0, J0 = body; dv = pose.get("dofs", {})
    M, Jp, R = rg.fk(pk.names, pk.parent, J0, pk.dofs, pk.drivers, dv, True, pose.get("rootOffset"))
    coff, cws = corrective_offsets(pk, R); vr = v0 if coff is None else v0 + coff
    lin = rg.skin(vr, pk.J, pk.W, M); vp = rg.skin(vr, pk.J, pk.W, M, pk.mask) if pk.mask is not None else lin
    pushed = None
    if ctx.get("caps_f") is not None and getattr(pk, "cattr", None) is not None:
        vp, pushed = rc.f_apply(vp, pk.cattr, ctx["caps_f"], pk.names, Jp)
    elif ctx.get("caps") and getattr(pk, "ct", None):
        if "rho" not in ctx: ctx["rho"] = rc.rest_clearance(pk.ct, ctx["caps"], pk.names, J0, v0, ctx.get("knee", rc.KNEE))
        vp, pushed = rc.apply(vp, ctx["rho"], ctx["caps"], pk.names, Jp, M[:, :3, :3], ctx.get("knee", rc.KNEE))
    ang = np.degrees(np.arccos(np.clip((np.trace(R, axis1=1, axis2=2) - 1) / 2, -1, 1)))
    out = {"volume_change_ml": round((volume(vp, pk.tris, ctx["caps_v"]) - ctx["vol0"]) * 1e6, 1)}
    out["volume_change_pct_of_body"] = round(out["volume_change_ml"] / (ctx["vol0"] * 1e6) * 100, 2)
    if pk.mask is not None: out["volume_change_ml_linear_blend"] = round((volume(lin, pk.tris, ctx["caps_v"]) - ctx["vol0"]) * 1e6, 1)
    sections = {}; tips = {}; twists = {}; active = []; region_vol = 0.0
    for s in ("l", "r"):
        for prox, joint, dist, kind, rad in (("upperarm", "lowerarm", "hand", "hinge", 0.16), ("thigh", "calf", "foot", "hinge", 0.24),
                                             ("clavicle", "upperarm", "lowerarm", "ball", 0.20), (None, "thigh", "calf", "ball", 0.30)):
            j = _jn(pk, joint, s); d = _jn(pk, dist, s); p = _jn(pk, prox, s) if prox else None
            if j is None or d is None: continue
            tw_src = d if kind == "hinge" else j
            if ang[j] > 12: active.append(j)
            label = {"lowerarm": "elbow", "calf": "knee", "upperarm": "shoulder", "thigh": "hip"}[joint] + "_" + s
            f0 = rg.unit(J0[d] - J0[j]); f1 = rg.unit(Jp[d] - Jp[j])
            if kind == "hinge" and ang[j] > 12 and p is not None:
                u0 = rg.unit(J0[j] - J0[p]); u1 = rg.unit(Jp[j] - Jp[p])
                a0 = section_at(v0, pk.tris, J0[j], u0 + f0, rad)
                areas = [section_at(vp, pk.tris, Jp[j], (1 - k) * u1 + k * f1, rad) for k in (0.0, 0.25, 0.5, 0.75, 1.0)]
                refs = [section_at(v0, pk.tris, J0[j], (1 - k) * u0 + k * f0, rad) for k in (0.0, 0.25, 0.5, 0.75, 1.0)]
                areas = [a for a in areas if a]; refs = [r for r in refs if r]
                if areas and refs: sections[label] = round(min(areas) / min(refs), 3)        # thinnest cut through the joint, posed / rest
                X = np.array([1.0, 0, 0]); m0 = rg.unit(u0 + f0)
                ax0 = rg.unit(np.cross(u0, f0)) if np.linalg.norm(np.cross(u0, f0)) > 0.3 else rg.unit(X - m0 * (X @ m0))      # nearly straight at rest (knee): the lateral axis
                ax1 = M[p][:3, :3] @ ax0                                                    # the hinge axis is carried by the proximal segment
                if True:
                    o0 = -rg.unit(np.cross(ax0, rg.unit(u0 + f0))); o1 = -rg.unit(np.cross(ax1, rg.unit(u1 + f1)))
                    t0 = ray_far(v0, pk.tris, J0[j], o0, rad); t1 = ray_far(vp, pk.tris, Jp[j], o1, rad)
                    if t0 and t1: tips[label] = round(t1 / t0, 3)
            if kind == "ball" and ang[j] > 20:
                L = np.linalg.norm(J0[d] - J0[j]); a0 = section_at(v0, pk.tris, J0[j] + 0.3 * L * f0, f0, rad); a1 = section_at(vp, pk.tris, Jp[j] + 0.3 * L * f1, f1, rad)
                if a0 and a1: sections[label] = round(a1 / a0, 3)
            # twist along the distal segment of this joint (forearm for the elbow rows, upper arm / thigh for the ball rows)
            seg_a, seg_b = (j, d)
            src = d if kind == "hinge" else j
            twist = abs(rg.twist_angle(R[src], rg.unit(J0[seg_b] - J0[seg_a])))
            if twist > 20:
                L = np.linalg.norm(J0[seg_b] - J0[seg_a]); rr = []
                for t in np.linspace(0.2, 0.85, 8):
                    a0 = section_at(v0, pk.tris, J0[seg_a] + t * L * f0, f0, rad); a1 = section_at(vp, pk.tris, Jp[seg_a] + t * L * f1, f1, rad)
                    if a0 and a1: rr.append(a1 / a0)
                if rr: twists[{"lowerarm": "forearm", "calf": "shank", "upperarm": "upperarm", "thigh": "thigh"}[joint] + "_" + s] = {"twist_deg": round(twist, 0), "min_section_ratio": round(min(rr), 3)}
    for j, n in enumerate(pk.names):
        if ang[j] > 12 and not any(k in n for k in SMALL) and "twist" not in n and j not in active: active.append(j)
    out["section_area_ratio"] = sections; out["section_area_ratio_at_joint"] = min(sections.values()) if sections else None
    out["tip_ratio"] = tips; out["twist"] = twists
    if active:
        cen = vp[pk.tris].mean(1); near = np.zeros(len(pk.tris), bool)
        for j in active: near |= np.linalg.norm(cen - Jp[j], axis=1) < 0.30
        near &= ctx["big"]
        def ar(x): return np.linalg.norm(np.cross(x[pk.tris[near, 1]] - x[pk.tris[near, 0]], x[pk.tris[near, 2]] - x[pk.tris[near, 0]]), axis=1)
        if near.any():
            r = ar(vp) / np.maximum(ar(v0), 1e-12); out["triangle_area_ratio_p1"] = round(float(np.percentile(r, 1)), 2); out["triangle_area_ratio_p99"] = round(float(np.percentile(r, 99)), 2)
        if full:
            sel = np.zeros(len(pk.tris), bool)
            for j in active: sel |= np.linalg.norm(cen - Jp[j], axis=1) < 0.45
            sel &= ctx["big"]; ids = np.nonzero(sel)[0]
            keys, dep = intersecting_pairs(vp, pk.tris[sel], ids)
            rest_keys = ctx["rest_pairs"](len(pk.tris))
            new = ~np.isin(keys // (int(ids.max()) + 1) * len(pk.tris) + keys % (int(ids.max()) + 1), rest_keys) if len(keys) else np.zeros(0, bool)
            out["new_intersecting_pairs"] = int(new.sum()); out["max_self_penetration_mm"] = round(float(dep[new].max()), 1) if new.any() else 0.0
            if new.any():
                m = int(ids.max()) + 1; dom = pk.J[np.arange(len(pk.J)), pk.W.argmax(1)]; from collections import Counter
                nm = lambda t: pk.names[np.bincount(dom[pk.tris[t]]).argmax()].replace("_twist_01", "").replace("_twist_02", "")
                cnt = Counter(tuple(sorted((nm(a), nm(b)))) for a, b in zip(keys[new] // m, keys[new] % m))
                out["intersections_between"] = {" x ".join(k): n for k, n in cnt.most_common(4)}
                kk = int(np.argmax(np.where(new, dep, -1))); out["deepest_between"] = " x ".join(sorted((nm(keys[kk] // m), nm(keys[kk] % m))))
                isarm = lambda n: n.startswith(("upperarm", "lowerarm", "armpit_arm")); istrunk = lambda n: n.startswith(("spine", "clavicle", "pelvis", "armpit_chest", "hip_belly"))
                at = np.array([(isarm(nm(x)) and istrunk(nm(y))) or (isarm(nm(y)) and istrunk(nm(x))) for x, y in zip(keys[new] // m, keys[new] % m)])
                out["arm_in_trunk_mm"] = round(float(dep[new][at].max()), 1) if at.any() else 0.0; out["arm_trunk_pairs"] = int(at.sum())
    out["active_joints"] = [pk.names[j] for j in active]
    if pushed is not None: out["contact_deepest_receiver_mm"] = round(pushed * 1000, 1)
    if cws: out["corrective_weights"] = cws
    return out


def rom_check(package, out_dir=None, persons=("M50", "F05", "M95H", "M50_THIN", "M50_HEAVY"), full_person="M50", pose_ids=None, quiet=False, use_mask=True, tag="", contact=True):
    t0 = time.time(); pk = load_package(package); out_dir = out_dir or pk.root
    if not use_mask: pk.mask = None
    poses = [p for p in pk.poses if str(p.get("id", "")).startswith(("E", "W")) or p.get("id") == "SEATED_GRIPS"] or pk.poses
    if pose_ids: poses = [p for p in poses if p.get("id") in pose_ids]
    big = np.array([not any(k in pk.names[j] for k in SMALL) for j in pk.J[np.arange(len(pk.J)), pk.W.argmax(1)]])
    res = {"package": pk.manifest.get("name"), "skinning": ("%d influences, " % pk.J.shape[1]) + ("masked dual quaternion" if pk.mask is not None else "linear blend"),
           "contact": bool(contact and pk.contact), "limits": LIMITS, "warnings": (["skeleton has rotated rest frames: fk assumes world-aligned"] if pk.rotated else []), "bodies": {}}
    for person in persons:
        b = body_of(pk, person)
        if b is None: res["warnings"].append(f"no shape preset named {person}: skipped"); continue
        v0, J0, info = b; caps = closed_volume_setup(pk.tris, len(pk.v)); tbig = big[pk.tris].all(1)
        cache = {}
        def rest_pairs(nt, v0=v0, tbig=tbig, cache=cache):
            if "k" not in cache:
                ids = np.nonzero(tbig)[0]; keys, _ = intersecting_pairs(v0, pk.tris[tbig], ids); m = int(ids.max()) + 1
                cache["k"] = keys // m * nt + keys % m
            return cache["k"]
        ctx = {"caps": caps, "vol0": volume(v0, pk.tris, caps), "big": tbig, "rest_pairs": rest_pairs}
        ctx["caps_v"] = ctx.pop("caps"); ctx["caps"] = None
        if contact and pk.contact and pk.contact_f: ctx["caps_f"] = rc.f_person(pk.contact, info.get("morph_weights"))
        elif contact and pk.contact: ctx["caps"] = rc.person_capsules(pk.contact, info.get("morph_weights")); ctx["knee"] = pk.contact.get("knee", rc.KNEE)
        rows = {}
        for p in poses:
            pid = p.get("id") or p.get("name")
            if person != full_person and pid not in CRITICAL and not str(pid).startswith(("W", "SEATED")) and any(q.get("id") in CRITICAL for q in poses): continue
            rows[pid] = analyse(pk, (v0, J0), p, ctx); rows[pid]["name"] = p.get("name"); rows[pid]["envelope"] = p.get("envelope", "?")
        res["bodies"][person] = {**info, "volume_l": round(ctx["vol0"] * 1000, 1), "open_boundary_loops_capped": caps[2], "poses": rows}
        if not quiet: print(f"rom_check {person}: {len(rows)} poses, {time.time() - t0:.0f} s", flush=True)
    res["summary"] = summarise(res); res["seconds"] = round(time.time() - t0, 1)
    json.dump(res, open(os.path.join(out_dir, f"rom-check{tag}.json"), "w"), indent=1)
    open(os.path.join(out_dir, f"rom-check{tag}.md"), "w").write(table(res))
    return res


def summarise(res):
    s = {}
    for person, b in res["bodies"].items():
        allrows = list(b["poses"].values()); shown = [r for r in allrows if r.get("envelope") != "end"]
        rows = shown if shown else allrows; sec = [r["section_area_ratio_at_joint"] for r in rows if r.get("section_area_ratio_at_joint")]
        tips = [t for r in rows for t in r.get("tip_ratio", {}).values()]; tw = [t["min_section_ratio"] for r in rows for t in r.get("twist", {}).values()]
        s[person] = {"poses": len(rows), "end_range_poses_left_out": len(allrows) - len(rows), "worst_section_area_ratio": min(sec) if sec else None, "poses_below_section_limit": sum(x < LIMITS["section_area_ratio_min"] for x in sec),
                     "worst_tip_ratio": min(tips) if tips else None, "worst_twist_section": min(tw) if tw else None,
                     "largest_volume_loss_ml": min(r["volume_change_ml"] for r in rows) if b["poses"] else None,
                     "volume_ml": {k: b["poses"][k]["volume_change_ml"] for k in ("E11", "E26", "E33") if k in b["poses"]},
                     "poses_with_new_intersections": sum(1 for r in rows if r.get("new_intersecting_pairs", 0) > 0),
                     "max_self_penetration_mm": max([r.get("max_self_penetration_mm", 0.0) for r in rows] or [0.0])}
    return s


def table(res):
    L = [f"# Range-of-motion check: {res['package']}", "", f"Skinning measured: {res['skinning']}. Limits: section ratio >= {LIMITS['section_area_ratio_min']} (designer), "
         f"tip >= {LIMITS['tip_ratio_min']}, twist section >= {LIMITS['twist_section_min']}, no new self-intersections in the working range (RR).", ""]
    L += ["| Body | Poses | Worst section ratio | Poses below 0.8 | Worst elbow/knee tip | Worst twist section | Volume change, ml: elbow 145 / hip 90 knee 90 / knee 140 | Poses with new intersections | Deepest penetration (mm, estimate) |", "|---|---|---|---|---|---|---|---|---|"]
    for p, s in res["summary"].items():
        L.append(f"| {p} | {s['poses']} | {s['worst_section_area_ratio']} | {s['poses_below_section_limit']} | {s['worst_tip_ratio']} | {s['worst_twist_section']} | {' / '.join(str(s['volume_ml'].get(k, '-')) for k in ('E11', 'E26', 'E33'))} | {s['poses_with_new_intersections']} | {s['max_self_penetration_mm']} |")
    for person, b in res["bodies"].items():
        L += ["", f"## {person} ({b['volume_l']} l)", "", "| Pose | Volume (ml) | Section ratio at joint | Tip | Twist section | New intersecting pairs (between) | Penetration (mm) | Triangle area p1 / p99 |", "|---|---|---|---|---|---|---|---|"]
        for pid, r in b["poses"].items():
            if r.get("envelope") == "end": r = {**r, "name": (r.get("name") or pid) + " (END RANGE, clamped)"}
            sec = ", ".join(f"{k} {v}" for k, v in r["section_area_ratio"].items()) or "-"; tip = ", ".join(f"{k} {v}" for k, v in r["tip_ratio"].items()) or "-"
            tw = ", ".join(f"{k} {v['min_section_ratio']}" for k, v in r["twist"].items()) or "-"
            L.append(f"| {r.get('name') or pid} | {r['volume_change_ml']} | {sec} | {tip} | {tw} | {r.get('new_intersecting_pairs', '-')}{(' (' + ', '.join(f'{k} {n}' for k, n in r['intersections_between'].items()) + ')') if r.get('intersections_between') else ''} | {r.get('max_self_penetration_mm', '-')} | {r.get('triangle_area_ratio_p1', '-')} / {r.get('triangle_area_ratio_p99', '-')} |")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    r = rom_check(sys.argv[1], persons=tuple(sys.argv[2].split(",")) if len(sys.argv) > 2 else ("M50", "F05", "M95H", "M50_THIN", "M50_HEAVY"))
    print(table(r).split("\n## ")[0])


# ------------------------------------------------------------------------------------------------ in-memory check (no GLB)
def pk_from_pack(pack, tris, use8=True, mask=None, dofs=None, drivers=None, poses=None):
    """A package-like object straight from a RigPack and the body triangles (indices into the 19,158-row array), for fast
    iteration: full weights padded to 8 (use8) or the 4-influence fit, the pack's mask, dofs, drivers and poses."""
    used = np.unique(tris); remap = -np.ones(int(tris.max()) + 1, dtype=np.int64); remap[used] = np.arange(len(used))
    pk = type("Pkg", (), {})(); pk.used = used; pk.tris = remap[tris]; pk.names = list(pack.names); pk.parent = pack.parent; pk.rotated = False
    if use8:
        J, W = rg.pad(pack.W); o = np.argsort(-W, axis=1)[:, :8]; J = np.take_along_axis(J, o, 1); W = np.take_along_axis(W, o, 1); W = W / W.sum(1, keepdims=True)
    else: J, W = pack.J4, pack.W4.astype(np.float64)
    pk.J = J[used]; pk.W = W[used]; pk.mask = (pack.dq_mask if mask is None else mask)[used].astype(np.float64)
    pk.dofs = dofs if dofs is not None else rg.dofs(pack); pk.drivers = drivers if drivers is not None else rg.drivers(pack)
    pk.poses = poses if poses is not None else rg.poses(pack); pk.manifest = {"name": "in-memory"}; pk.pack = pack
    pk.ct = {k: v[used].astype(np.float64) for k, v in rc.masks(pack, pack.base_src).items()}; pk.contact = None
    return pk


def check_bodies(pk, bodies, pose_ids=None, full=True, contact=False):
    """bodies: {name: full 19,158-row rest vertices}. Returns {name: {pose id: metrics}} with the same metrics as rom_check."""
    big = np.array([not any(k in pk.names[j] for k in SMALL) for j in pk.J[np.arange(len(pk.J)), pk.W.argmax(1)]]); tbig = big[pk.tris].all(1); out = {}
    for name, verts in bodies.items():
        v0 = np.asarray(verts)[pk.used]; J0 = pk.pack.joints(verts); caps = closed_volume_setup(pk.tris, len(v0)); cache = {}
        def rest_pairs(nt, v0=v0, cache=cache):
            if "k" not in cache:
                ids = np.nonzero(tbig)[0]; keys, _ = intersecting_pairs(v0, pk.tris[tbig], ids); m = int(ids.max()) + 1; cache["k"] = keys // m * nt + keys % m
            return cache["k"]
        ctx = {"caps_v": caps, "vol0": volume(v0, pk.tris, caps), "big": tbig, "rest_pairs": rest_pairs, "caps": None}
        if contact and getattr(pk, "ct", None): ctx["caps"] = rc.fit_capsules(pk.pack, verts)
        out[name] = {p["id"]: analyse(pk, (v0, J0), p, ctx, full=full) for p in pk.poses if (pose_ids is None or p["id"] in pose_ids)}
    return out


def write_reference(package, out_dir, pose_ids, person=None, contact=True):
    """Reference dumps for viewer/rig-check.ts: <out_dir>/<pose id>.f32, float32 x, y, z per vertex in the GLB's vertex order
    (metres), from this module's own evaluator (rig.fk + rig.skin: 8 influences when the package has them, `_DQS` blend,
    twist and helper drivers). Root placement follows the viewer's rule for a pose: the lower foot joint stays at its rest
    height (the pose's own rootOffset is not used). person None = the package's base shape. Returns the files written."""
    pk = load_package(package, weld=False)
    winfo = {}
    if person is None: v0, J0 = pk.v, pk.joints
    else:
        b = body_of(pk, person)
        if b is None: raise KeyError("no shape preset named %s" % person)
        v0, J0, _i = b; winfo = _i.get("morph_weights") or {}
    an = pk.manifest.get("anchors") or {}; feet = [pk.names.index(an[k]) for k in ("foot_L", "foot_R") if an.get(k) in pk.names]
    os.makedirs(out_dir, exist_ok=True); done = []
    for p in pk.poses:
        if p.get("id") not in pose_ids: continue
        M, Jp, R = rg.fk(pk.names, pk.parent, J0, pk.dofs, pk.drivers, p.get("dofs", {}), True)
        off = np.array([0.0, -min(Jp[f][1] - J0[f][1] for f in feet), 0.0]) if feet else np.zeros(3)
        coff, _ = corrective_offsets(pk, R)
        vp = rg.skin(v0 if coff is None else v0 + coff, pk.J, pk.W, M, pk.mask)
        if contact and pk.contact and getattr(pk, "contact_f", False) and pk.cattr is not None:
            vp, _ = rc.f_apply(vp, pk.cattr, rc.f_person(pk.contact, winfo), pk.names, Jp)
        elif contact and pk.contact and pk.ct:
            pc = rc.person_capsules(pk.contact, winfo); kn = pk.contact.get("knee", rc.KNEE)
            vp, _ = rc.apply(vp, rc.rest_clearance(pk.ct, pc, pk.names, J0, v0, kn), pc, pk.names, Jp, M[:, :3, :3], kn)
        vp = vp + off; f = os.path.join(out_dir, p["id"] + ".f32"); vp.astype(np.float32).tofile(f); done.append(f)
    return done
