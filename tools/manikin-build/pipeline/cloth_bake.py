# Cloth form (owner: B8): bake a finished simulation (cloth.py prep, cloth_sim.py) into fold normal maps and seated
# corrective morph targets, and write a dressed copy of a package. See pipeline/README.md, "Cloth form".
import sys, os, json, struct, io, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy import ndimage
import cloth as C

SIZE = 1024                                        # B2's authored garment maps are 1024: same GPU cost (about 5.6 MB with mips); 2048 showed no gain at 1.5 m (B8 round 1)
LOW_ITERS = {"trousers": 60, "top": 60}            # smoothing passes that split the drape into shape (morph) and folds (normal map)
FOLD_SMOOTH = {"stand": 2, "seat": 10}            # passes on the fold part: takes out simulation noise; the spring-tied seated run buckles in small patches, only its larger creases are kept
MORPH_CAP = 0.035                                  # metres: no corrective moves a vertex farther than this
MAX_TILT_Z = 0.57
GAIN = {"stand": 1.0, "seat": 1.0}


def _tangent_space(T, X_frame, X_det, uv_corner):
    """Per fine-triangle corner the detail normal in the frame the viewer builds from screen derivatives:
    T along +u, B along -v (glTF v runs down the image; the green channel means 'up the image'), N the smooth normal."""
    tri = T.tris; Nf = C.vnormals(X_frame, tri); Nd = C.vnormals(X_det, tri)
    p = X_frame[tri]; e1, e2 = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]; fn = np.cross(e1, e2); A2 = np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-14); fh = fn / A2
    du1, du2 = uv_corner[:, 1] - uv_corner[:, 0], uv_corner[:, 2] - uv_corner[:, 0]
    gu = (du1[:, :1] * np.cross(e2, fh) + du2[:, :1] * np.cross(fh, e1)) / A2; gv = (du1[:, 1:] * np.cross(e2, fh) + du2[:, 1:] * np.cross(fh, e1)) / A2
    out = np.zeros((len(tri), 3, 3))
    for k in range(3):
        n = Nf[tri[:, k]]; t = gu - (gu * n).sum(1, keepdims=True) * n; b = -(gv - (gv * n).sum(1, keepdims=True) * n)
        s = 1.0 / np.maximum(np.maximum(np.linalg.norm(t, axis=1), np.linalg.norm(b, axis=1)), 1e-12)[:, None]; t, b = t * s, b * s
        Mx = np.stack([t, b, n], 2); bad = np.abs(np.linalg.det(Mx)) < 1e-6; Mx[bad] = np.eye(3)
        m = np.linalg.solve(Mx, Nd[tri[:, k]][:, :, None])[:, :, 0]; m[bad] = (0, 0, 1)
        m /= np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9); m[:, 2] = np.maximum(m[:, 2], MAX_TILT_Z)         # no fold wall steeper than about 55 degrees: steeper reads as a black slit
        out[:, k] = m / np.linalg.norm(m, axis=1, keepdims=True)
    return out


def _raster(uv_corner, val, size):
    img = np.full((size, size, 3), np.nan, np.float32); P = uv_corner * size
    for t in range(len(P)):
        (x0, y0), (x1, y1), (x2, y2) = P[t]
        xa = max(int(np.floor(min(x0, x1, x2) - 0.5)), 0); xb = min(int(np.ceil(max(x0, x1, x2) + 0.5)), size - 1)
        ya = max(int(np.floor(min(y0, y1, y2) - 0.5)), 0); yb = min(int(np.ceil(max(y0, y1, y2) + 0.5)), size - 1)
        if xb < xa or yb < ya: continue
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-12: continue
        xs, ys = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
        l0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / den; l1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / den; l2 = 1 - l0 - l1
        m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if m.any():
            sub = img[ya:yb + 1, xa:xb + 1]; sub[m] = (l0[..., None] * val[t, 0] + l1[..., None] * val[t, 1] + l2[..., None] * val[t, 2])[m]
    return img


def _finish(img, pad=24, gain=1.0, under=None):
    nan = np.isnan(img[..., 0]); dist, (iy, ix) = ndimage.distance_transform_edt(nan, return_indices=True)
    out = np.where((nan & (dist > pad))[..., None], np.array([0, 0, 1], np.float32), img[iy, ix])
    out = ndimage.gaussian_filter(out, (0.8, 0.8, 0))
    out[..., :2] *= gain
    if under is not None:                                                              # the garment's own authored map (seams, pockets) stays underneath
        out = np.stack([out[..., 0] + under[..., 0], out[..., 1] + under[..., 1], out[..., 2] * under[..., 2]], -1)
    out /= np.maximum(np.linalg.norm(out, axis=2, keepdims=True), 1e-9)
    return out


def _image_of(pk, material, slot="normalTexture"):
    from PIL import Image
    js = pk.js; m = next(x for x in js["materials"] if x["name"] == material)
    if slot not in m: return None
    im = js["images"][js["textures"][m[slot]["index"]]["source"]]; bv = js["bufferViews"][im["bufferView"]]
    return Image.open(io.BytesIO(pk.blob[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]))


def _preview(n, path):
    from PIL import Image
    L = np.array([-0.5, 0.6, 0.62]); L /= np.linalg.norm(L); s = np.clip((n * L).sum(2), 0, 1) ** 0.8
    Image.fromarray((s * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(path)


def bake(package, work, work_seat, out, who="M50"):
    """-> <out>/<garment>_fold_<stand|seat>_n.jpg, <out>/<garment>.cloth.npz (morph targets in the GLB's vertex order), previews."""
    from PIL import Image
    os.makedirs(out, exist_ok=True); pk = C.load(package); v0, J0, rest = C.person(pk, who); sd = C.seated_dofs(pk); report = {}
    for g in pk.garments.values():
        f = os.path.join(work, g.name + ".sim.npy"); f2 = os.path.join(work_seat, g.name + ".sim.npy")
        if not (os.path.exists(f) and os.path.exists(f2)): continue
        sims = {"stand": np.load(f, mmap_mode="r"), "seat": np.load(f2, mmap_mode="r")}; P = rest[g.name]; T = C.Topo(g, P); assert sims["seat"].shape[1] == T.ns
        uvc = np.einsum("tkc,tcd->tkd", T.bary, g.uv[g.tris[T.sim_gtri[T.base]]])
        under = _image_of(pk, g.material); un = None
        if under is not None:
            un = np.asarray(under.convert("RGB").resize((SIZE, SIZE), Image.BILINEAR), np.float32) / 127.5 - 1.0
            un /= np.maximum(np.linalg.norm(un, axis=2, keepdims=True), 1e-9)
            if np.abs(un[..., :2]).max() < 0.02: un = None
        res = {}; rep = {}
        for key, frame, dofs in (("stand", C.FR_SETTLE - 1, {}), ("seat", C.FRAMES - 1, sd)):
            M = C.pose(pk, J0, dofs); Xp, A = C.skin_frames(pk, g.name, P, M); Xref = T.refine(Xp[T.first]); d = np.asarray(sims[key][frame], np.float64) - Xref
            dlow = C.smooth(d, T.As, LOW_ITERS[g.kind]); fold = C.smooth(d - dlow, T.As, FOLD_SMOOTH[key]); Xf = Xref + dlow
            ts = _tangent_space(T, Xf, Xf + fold, uvc)
            n = _finish(_raster(uvc, ts, SIZE), gain=GAIN[key], under=un)
            Image.fromarray(np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(out, "%s_fold_%s_n.jpg" % (g.name, key)), quality=90)
            _preview(n, os.path.join(out, "%s_fold_%s_preview.png" % (g.name, key)))
            ang = np.degrees(np.arccos(np.clip(ts[..., 2], -1, 1)))
            rep[key] = {"drape_mm_p50_p95_max": [round(float(x) * 1000, 1) for x in np.percentile(np.linalg.norm(d, axis=1), [50, 95, 100])],
                        "shape_part_mm_p95_max": [round(float(x) * 1000, 1) for x in np.percentile(np.linalg.norm(dlow, axis=1), [95, 100])],
                        "fold_angle_deg_p50_p95_max": [round(float(x), 1) for x in np.percentile(ang, [50, 95, 100])]}
            if key == "seat":
                d0 = dlow[:T.n0]; Ainv = np.linalg.inv(A[T.first][T.simv]); dr = np.einsum("nij,nj->ni", Ainv, d0)
                ln = np.linalg.norm(dr, axis=1, keepdims=True); dr *= np.minimum(1.0, MORPH_CAP / np.maximum(ln, 1e-9)); res["seat_delta"] = T.to_glb(dr)
        # split the seated corrective by cause: which joint's flexion makes it (regions from rest joint heights and skin weights)
        D = res["seat_delta"]; names = pk.names; jy = lambda n: J0[names.index(n)]
        left_is_plus = jy("thigh_l")[0] > 0; x = P[:, 0] if left_is_plus else -P[:, 0]
        sl = np.clip((x + 0.04) / 0.08, 0, 1); sl = sl * sl * (3 - 2 * sl); side = {"l": sl, "r": 1 - sl}
        morphs = {}
        if g.kind == "trousers":
            t = (P[:, 1] - jy("calf_l")[1]) / (jy("thigh_l")[1] - jy("calf_l")[1]); h = np.clip((t - 0.2) / 0.4, 0, 1); h = h * h * (3 - 2 * h)
            part = {"lap": h, "knee": 1 - h}
        else:
            arm = {s: np.zeros(len(P)) for s in "lr"}
            for s in "lr":
                ids = [i for i, n in enumerate(names) if n.endswith("_" + s) and any(k in n for k in ("upperarm", "lowerarm", "hand"))]
                arm[s] = (g.W * np.isin(g.J, ids)).sum(1)
            part = {"waist": 1 - np.clip(arm["l"] + arm["r"], 0, 1), "elbow": None}
        drivers = []
        for suffix, dof, a, b in C.DRIVERS[g.kind]:
            for s in "lr":
                w = (arm[s] if part[suffix] is None else part[suffix] * side[s])
                name = "cloth_%s_%s_%s" % (g.kind, suffix, s); morphs[name] = D * w[:, None]
                drivers.append({"type": "morph", "target": name, "dof": dof % s, "from": a, "to": b, "cloth": True})
        # normals of the morph targets, on the welded surface at the base shape
        n0 = C.vnormals(g.P[T.first], T.tw[T.tri_ok]); mn = {}
        for k, dlt in morphs.items(): mn[k] = (C.vnormals((g.P + dlt)[T.first], T.tw[T.tri_ok]) - n0)[T.inv]
        np.savez(os.path.join(out, g.name + ".cloth.npz"), **{"p_" + k: v.astype(np.float32) for k, v in morphs.items()}, **{"n_" + k: v.astype(np.float32) for k, v in mn.items()})
        rep["morph_mm_max"] = {k: round(float(np.linalg.norm(v, axis=1).max()) * 1000, 1) for k, v in morphs.items()}
        json.dump({"drivers": drivers, "material": g.material}, open(os.path.join(out, g.name + ".cloth.json"), "w"), indent=1)
        report[g.name] = rep; print(g.name, json.dumps(rep))
    json.dump(report, open(os.path.join(out, "bake-report.json"), "w"), indent=1)


# ------------------------------------------------------------------------------------------------ dressing a package
def _append(js, parts, data, target=None):
    off = sum(len(p) for p in parts); pad = (-len(data)) % 4; parts.append(data + b"\0" * pad)
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target: v["target"] = target
    js["bufferViews"].append(v); return len(js["bufferViews"]) - 1


def _write_glb(path, js, parts):
    blob = b"".join(parts); js["buffers"][0]["byteLength"] = len(blob)
    j = json.dumps(js, separators=(",", ":")).encode(); j += b" " * ((-len(j)) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(blob))); f.write(struct.pack("<II", len(j), 0x4E4F534A)); f.write(j)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)


def dress(package, baked, out, which="stand", morphs="1", gltf_only=None):
    """Copy of `package` under `out` whose shirt and trousers carry the fold normal map `which` (stand | seat) and, unless
    morphs == "0", the seated corrective morph targets with their drivers. The other set's map is written to maps/ and named
    in the manifest (materials.<cloth>.poseNormal) for the viewer's pose-blended slot."""
    import glb as glbio
    man_name = next(f for f in sorted(os.listdir(package)) if f.endswith(".avatar.json")); man = json.load(open(os.path.join(package, man_name)))
    os.makedirs(os.path.join(out, "maps"), exist_ok=True)
    for f in os.listdir(package):
        s, d = os.path.join(package, f), os.path.join(out, f)
        if f in (man_name, man["glb"]) or f.startswith("."): continue
        if os.path.isdir(s):
            if f == "maps":
                for q in os.listdir(s): shutil.copy2(os.path.join(s, q), os.path.join(d, q))
            elif not os.path.lexists(d): os.symlink(os.path.relpath(s, out), d)          # side GLBs are not changed: linked, not copied
        else: shutil.copy2(s, d)
    js, blob = glbio.read_glb(os.path.join(package, man["glb"])); parts = [bytes(blob) + b"\0" * ((-len(blob)) % 4)]; stats = {}
    for m in js["meshes"]:
        cj = os.path.join(baked, m["name"] + ".cloth.json")
        if not os.path.exists(cj): continue
        info = json.load(open(cj)); p = m["primitives"][0]; mat = js["materials"][p["material"]]
        img = open(os.path.join(baked, "%s_fold_%s_n.jpg" % (m["name"], which)), "rb").read()
        js["images"].append({"name": "%s_fold_%s_n.jpg" % (m["name"], which), "mimeType": "image/jpeg", "bufferView": _append(js, parts, img)})
        js["textures"].append({"source": len(js["images"]) - 1, "sampler": 0}); mat["normalTexture"] = {"index": len(js["textures"]) - 1}
        stats[m["name"]] = {"normal_bytes": len(img)}
        for k in ("stand", "seat"): shutil.copy2(os.path.join(baked, "%s_fold_%s_n.jpg" % (m["name"], k)), os.path.join(out, "maps", "%s_fold_%s_n.jpg" % (m["name"], k)))
        mm = man["materials"].setdefault(info["material"], {"class": "cloth"})
        mm["poseNormal"] = {"rest": "maps/%s_fold_stand_n.jpg" % m["name"], "posed": "maps/%s_fold_seat_n.jpg" % m["name"],
                            "weight": {"max": [{"dof": "hip_l.flex", "from": 15, "to": 80}, {"dof": "hip_r.flex", "from": 15, "to": 80}]},
                            "note": "proposal for the viewer (B8): normal = mix(rest, posed, weight); this build has the '%s' map in the GLB" % which}
        if morphs != "0":
            z = np.load(os.path.join(baked, m["name"] + ".cloth.npz")); tn = m.setdefault("extras", {}).setdefault("targetNames", []); has_n = bool(p.get("targets")) and "NORMAL" in p["targets"][0]
            for d in info["drivers"]:
                k = d["target"]; dp = np.ascontiguousarray(z["p_" + k], np.float32); t = {}
                js["accessors"].append({"bufferView": _append(js, parts, dp.tobytes()), "componentType": 5126, "count": len(dp), "type": "VEC3", "min": dp.min(0).tolist(), "max": dp.max(0).tolist()})
                t["POSITION"] = len(js["accessors"]) - 1
                if has_n or not p.get("targets"):
                    dn = np.ascontiguousarray(z["n_" + k], np.float32)
                    js["accessors"].append({"bufferView": _append(js, parts, dn.tobytes()), "componentType": 5126, "count": len(dn), "type": "VEC3"}); t["NORMAL"] = len(js["accessors"]) - 1
                p.setdefault("targets", []).append(t); tn.append(k)
                if "weights" in m: m["weights"].append(0.0)
                man["drivers"].append({q: v for q, v in d.items() if q != "cloth"})
            stats[m["name"]]["morph_targets"] = [d["target"] for d in info["drivers"]]
    _write_glb(os.path.join(out, man["glb"]), js, parts)
    man.setdefault("build", {})["cloth"] = {"by": "B8 pipeline/cloth.py", "normal": which, "morphs": morphs != "0", "garments": stats}
    json.dump(man, open(os.path.join(out, man_name), "w"))
    print("dressed", out, json.dumps(stats), "validate:", glbio.validate(os.path.join(out, man["glb"])))


# ------------------------------------------------------------------------------------------------ round 2: seated trousers
# The seated drape (cloth.prep_seat, cloth_sim.py) is read as a HEIGHT FIELD over the skinned seated garment: along each skinned
# vertex's normal, where does the simulated surface lie? The simulated cloth rode 150-200 mm up the shin; matching by vertex
# identity would move the folds and the hem with it (and open the body mask at the ankle). Matching in space keeps every fold
# where the simulation made it and leaves the lower leg, where no simulated cloth lies over the skinned one, as it is.
SEAT2_BAKE = {"cap": 0.07,                      # metres: no part of the height field moves the cloth farther than this
              "lat": (0.004, 0.012),            # trust a hit fully within 4 mm of a simulated vertex, not at all beyond 12 mm
              "fill": 8,                        # passes of normalised smoothing that close small holes in the height field
              "edge": 16,                       # passes that widen the edge of the covered region (no step where the cover ends)
              "fine": 3,                        # passes on the fine part (the normal map): the run crumples in 5-10 mm patches
              "fine_cap": 0.008,                # metres: a fold of the normal map is at most this deep (the run has spikes at the pockets)
              "hem": (0.06, 0.16),              # along the cloth from the hems: untouched up to 60 mm, the full field from 160 mm
              "sim_hem": 0.05,                  # the run's own lowest 50 mm of cloth (its free hem, ridden up the shin) is never matched
              "glb_smooth": 6,                  # smoothing passes on the finished rest-space deltas, over the GLB mesh
              "normals": 8,                     # smoothing passes on the skinned seated normals (the direction of the height field)
              "under_seat": (0.75, 0.95),       # fade the field out where the seated skinned normal points straight down onto the seat (y component)
              "clear": 0.004,                   # metres of cloth-to-skin clearance the shape part keeps (behind the knee it folded into the leg)
              "slope": 0.35,                    # the shape part never steps faster than 0.35 m per m (about 19 degrees) between neighbours
              "morph": 16,                      # smoothing passes: what the GLB mesh (about 11 mm edges) can carry goes to the morphs (10 left a notch behind the knee)
              "under": "w7_m_trousers_work_normal.jpg"}   # B2's authored map (seams, pockets) under the seated folds (B2/cache)


def _smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def _height(X, N, S, Ns, lat=(0.004, 0.012), reach=0.08, allowed=None):
    """Per point X (normal N): signed distance t along N to the simulated surface S (normals Ns) and a confidence 0..1.
    `allowed`: the simulated vertices that may be hit (not the run's own free hem, which rode up the shin)."""
    from scipy.spatial import cKDTree
    keep = np.arange(len(S)) if allowed is None else np.where(allowed)[0]; S, Ns = S[keep], Ns[keep]
    k = 24; dist, idx = cKDTree(S).query(X, k=k, distance_upper_bound=reach + 0.01); ok = np.isfinite(dist); idx = np.where(ok, idx, 0)
    O = S[idx] - X[:, None]; nn = (N[:, None] * Ns[idx]).sum(2)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = (O * Ns[idx]).sum(2) / nn
    hit = X[:, None] + t[..., None] * N[:, None]; la = np.linalg.norm(hit - S[idx], axis=2)
    good = ok & np.isfinite(t) & (np.abs(t) < reach) & (nn > 0.3)                # the same side of the cloth only
    score = np.where(good, la + 0.15 * np.abs(t), np.inf); j = np.argmin(score, 1); r = np.arange(len(X))
    valid = np.isfinite(score[r, j]); h = np.where(valid, t[r, j], 0.0); conf = np.where(valid, 1 - _smoothstep(la[r, j], *lat), 0.0)
    return h, conf


def _slope_limit(f, T, X, slope=0.35, iters=60):
    """Relax a scalar field on the sheet where it is steeper than `slope` (metres per metre) toward any neighbour: a corrective
    that steps faster than that reads as a notch (round 2: the edge of the covered region below the knee was a 53-degree wall)."""
    e = np.vstack([T.tris[:, [0, 1]], T.tris[:, [1, 2]], T.tris[:, [2, 0]]]); L = np.maximum(np.linalg.norm(X[e[:, 0]] - X[e[:, 1]], axis=1), 1e-6)
    deg = np.maximum(np.asarray(T.As.sum(1)).ravel(), 1.0); f = f.copy()
    for _ in range(iters):
        s = np.abs(f[e[:, 0]] - f[e[:, 1]]) / L; steep = np.zeros(len(f), bool); steep[e[s > slope, 0]] = True; steep[e[s > slope, 1]] = True
        if not steep.any(): break
        avg = (T.As @ f) / deg; f[steep] = 0.5 * f[steep] + 0.5 * avg[steep]
    return f


def _loop_dist(T, X, classes):
    from scipy.sparse.csgraph import dijkstra
    import scipy.sparse as sp
    e = np.vstack([T.tris[:, [0, 1]], T.tris[:, [1, 2]], T.tris[:, [2, 0]]]); L = np.linalg.norm(X[e[:, 0]] - X[e[:, 1]], axis=1)
    G = sp.coo_matrix((L, (e[:, 0], e[:, 1])), shape=(T.ns, T.ns)).tocsr(); G = G.maximum(G.T)
    src = np.concatenate([T.sid[l] for l, (cls, _, _) in zip(T.loops, T.loop_class) if cls in classes] or [np.zeros(0, np.int64)]); src = src[src >= 0]
    return dijkstra(G, directed=False, indices=src, min_only=True) if len(src) else np.full(T.ns, np.inf)


def bake_seat2(package, work, out, who="M50", garment="garment_trousers_work"):
    """-> <out>/<garment>_fold_seat_n.jpg (seated fold map, SIZE), <garment>.cloth.npz / .cloth.json (seated correctives and their
    drivers, GLB vertex order of `package`), previews, bake-report.json."""
    from PIL import Image
    os.makedirs(out, exist_ok=True); pk = C.load(package); v0, J0, rest = C.person(pk, who); sd = C.seated_dofs(pk); g = pk.garments[garment]
    cfg = json.load(open(os.path.join(work, garment + ".json"))); assert cfg.get("method") == "seat2", "not a seat2 run"
    P = rest[g.name]; T = C.Topo(g, P); pin = T.pins(P[T.first], g.kind, C.SEAT2["pin"])
    sim = np.load(os.path.join(work, garment + ".sim.npy"), mmap_mode="r"); assert sim.shape[1] == T.ns
    M = C.pose(pk, J0, sd); Xp, A = C.skin_frames(pk, g.name, P, M); X = T.refine(Xp[T.first]); S = np.asarray(sim[-1], np.float64)
    B = SEAT2_BAKE; N = C.smooth(C.vnormals(X, T.tris), T.As, B["normals"]); N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)   # behind the knee the
    Ns = C.vnormals(S, T.tris)                                                    # skinned sheet crumples: its raw normals flip from vertex to vertex
    d_hem = np.nan_to_num(_loop_dist(T, X, ("low",)), posinf=1.0)                # along the cloth from the hems (the same for the run: same sheet)
    h, conf = _height(X, N, S, Ns, B["lat"], B["cap"] + 0.01, allowed=d_hem > B["sim_hem"])
    sm = lambda a, n: C.smooth(a[:, None], T.As, n)[:, 0]                       # C.smooth works on (n, k) arrays
    cs = sm(conf, B["fill"]); hs = sm(h * conf, B["fill"]) / np.maximum(cs, 1e-3); hs = np.where(cs > 1e-3, hs, 0.0)
    keep = _smoothstep(d_hem, *B["hem"]) * (1 - pin)
    keep = keep * (1 - _smoothstep(-N[:, 1], *B["under_seat"]))                  # cloth that faces down onto the seat is the viewer's contact flatten's (contact.ts), not ours
    cw = _smoothstep(sm(conf, B["edge"]), 0.25, 0.85)                           # a wide, soft edge where the simulated cloth stops covering the skinned
    Hm = sm(np.clip(hs * cw * keep, -B["cap"], B["cap"]), B["morph"])           # the shape: what the GLB mesh carries (morph targets)
    from scipy.spatial import cKDTree                                             # the cloth never moves into the body: inward by at most its clearance
    clear = cKDTree(C.skin(pk, "body", v0, M)).query(X)[0]; Hm = np.maximum(Hm, -np.maximum(clear - B["clear"], 0.0))
    Hm = _slope_limit(Hm, T, X, B["slope"])                                       # no notch where the field steps
    cf = _smoothstep(sm(conf, B["edge"]), 0.6, 0.95)                            # the folds only where the cover is sure
    Hf = sm(np.clip(hs - sm(hs, B["morph"]), -B["fine_cap"], B["fine_cap"]), B["fine"]) * cf * keep   # the folds: high-pass of the filled field, no spikes, no crumple noise
    H = Hm + Hf
    # morph targets: the smooth part at the GLB vertices, taken back to the rest pose through each vertex's skinning
    d0 = (Hm[:, None] * N)[:T.n0]; Ainv = np.linalg.inv(A[T.first][T.simv]); D = T.to_glb(np.einsum("nij,nj->ni", Ainv, d0))
    Dw = C.smooth(D[T.first], T.A, B["glb_smooth"]); D = Dw[T.inv]               # on the GLB mesh itself: at the crotch and behind the knee the direction turned between neighbours
    names = pk.names; jy = lambda n: J0[names.index(n)]; left_is_plus = jy("thigh_l")[0] > 0; x = P[:, 0] if left_is_plus else -P[:, 0]
    sl = _smoothstep(x, -0.04, 0.04); side = {"l": sl, "r": 1 - sl}
    t = (P[:, 1] - jy("calf_l")[1]) / (jy("thigh_l")[1] - jy("calf_l")[1]); hh = _smoothstep(t, 0.2, 0.6); part = {"lap": hh, "knee": 1 - hh}
    morphs, drivers = {}, []
    for suffix, dof, a, b in C.DRIVERS["trousers"]:
        for s in "lr":
            name = "cloth_trousers_%s_%s" % (suffix, s); morphs[name] = D * (part[suffix] * side[s])[:, None]
            drivers.append({"type": "morph", "target": name, "dof": dof % s, "from": a, "to": b, "cloth": True})
    n0 = C.vnormals(g.P[T.first], T.tw[T.tri_ok]); mn = {k: (C.vnormals((g.P + v)[T.first], T.tw[T.tri_ok]) - n0)[T.inv] for k, v in morphs.items()}
    np.savez(os.path.join(out, g.name + ".cloth.npz"), **{"p_" + k: v.astype(np.float32) for k, v in morphs.items()}, **{"n_" + k: v.astype(np.float32) for k, v in mn.items()})
    import hashlib
    json.dump({"drivers": drivers, "material": g.material, "method": "seat2", "person": who, "package": os.path.abspath(package), "vertices": len(g.P),
               "positions_sha1": hashlib.sha1(np.ascontiguousarray(g.P, np.float32).tobytes()).hexdigest()}, open(os.path.join(out, g.name + ".cloth.json"), "w"), indent=1)
    # seated fold map: the rest of the height field, in the frame of the corrected render surface; B2's authored map underneath
    uvc = np.einsum("tkc,tcd->tkd", T.bary, g.uv[g.tris[T.sim_gtri[T.base]]]); Xf = X + Hm[:, None] * N; Xd = X + H[:, None] * N
    ts = _tangent_space(T, Xf, Xd, uvc); un = None; up = os.path.join(__import__("labpaths").LAB, "B2", "cache", B["under"])
    if os.path.exists(up):
        un = np.asarray(Image.open(up).convert("RGB").resize((SIZE, SIZE), Image.BILINEAR), np.float32) / 127.5 - 1.0; un /= np.maximum(np.linalg.norm(un, axis=2, keepdims=True), 1e-9)
    n = _finish(_raster(uvc, ts, SIZE), under=un)
    Image.fromarray(np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(out, "%s_fold_seat_n.jpg" % g.name), quality=90)
    _preview(n, os.path.join(out, "%s_fold_seat_preview.png" % g.name))
    ang = np.degrees(np.arccos(np.clip(ts[..., 2], -1, 1)))
    rep = {"method": "seat2", "person": who, "height_mm_p5_p50_p95": [round(float(q) * 1000, 1) for q in np.percentile(H, [5, 50, 95])],
           "covered_fraction": round(float((cw > 0.5).mean()), 3), "morph_mm_max": {k: round(float(np.linalg.norm(v, axis=1).max()) * 1000, 1) for k, v in morphs.items()},
           "fold_angle_deg_p50_p95_max": [round(float(q), 1) for q in np.percentile(ang, [50, 95, 100])], "under": B["under"] if un is not None else None}
    json.dump({g.name: rep}, open(os.path.join(out, "bake-report.json"), "w"), indent=1); print(g.name, json.dumps(rep))
    np.save(os.path.join(out, g.name + ".height.npy"), np.stack([H, Hm, cw], 1).astype(np.float32))


def dress2(package, baked, out, shirt=None):
    """Round 2: a copy of `package` whose trousers keep the GLB's standing map (B2's) and get the seated correctives with their drivers
    and the seated map as `materials.<cloth>.poseNormal` (faded in by viewer/src/cloth-pose.ts). `shirt`: a folder with a shirt map
    `garment_top_shirt_fold_stand_n.jpg` that replaces the shirt's normal texture."""
    import glb as glbio
    man_name = next(f for f in sorted(os.listdir(package)) if f.endswith(".avatar.json")); man = json.load(open(os.path.join(package, man_name)))
    if os.path.exists(out): shutil.rmtree(out)
    shutil.copytree(package, out, ignore=shutil.ignore_patterns(man_name, man["glb"]))
    js, blob = glbio.read_glb(os.path.join(package, man["glb"])); parts = [bytes(blob) + b"\0" * ((-len(blob)) % 4)]; stats = {}
    for m in js["meshes"]:
        p = m["primitives"][0]; mat = js["materials"][p["material"]]
        cj = os.path.join(baked, m["name"] + ".cloth.json")
        if os.path.exists(cj):
            info = json.load(open(cj)); z = np.load(os.path.join(baked, m["name"] + ".cloth.npz"))
            if info.get("positions_sha1"):                                        # the correctives are in the GLB vertex order they were baked on
                import hashlib
                pos = np.asarray(glbio.accessor(js, blob, p["attributes"]["POSITION"]), np.float32)
                if hashlib.sha1(np.ascontiguousarray(pos).tobytes()).hexdigest() != info["positions_sha1"]:
                    raise SystemExit("dress2: %s in %s is not the mesh the correctives were baked on (vertex order or fit changed): prep_seat the new "
                                     "package, transfer the finished run, bake_seat2 again (pipeline/README.md, Cloth form)" % (m["name"], package))
            seat = "%s_fold_seat_n.jpg" % m["name"]; shutil.copy2(os.path.join(baked, seat), os.path.join(out, "maps", seat))
            mm = man["materials"].setdefault(info["material"], {"class": "cloth"})
            mm["poseNormal"] = {"posed": "maps/" + seat, "weight": {s: [d["target"] for d in info["drivers"] if d["target"].endswith("_" + s)] for s in "lr"}, "side": 0.03}
            tn = m.setdefault("extras", {}).setdefault("targetNames", [])
            for d in info["drivers"]:
                k = d["target"]; dp = np.ascontiguousarray(z["p_" + k], np.float32); dn = np.ascontiguousarray(z["n_" + k], np.float32)
                js["accessors"].append({"bufferView": _append(js, parts, dp.tobytes()), "componentType": 5126, "count": len(dp), "type": "VEC3", "min": dp.min(0).tolist(), "max": dp.max(0).tolist()})
                ia = len(js["accessors"]) - 1
                js["accessors"].append({"bufferView": _append(js, parts, dn.tobytes()), "componentType": 5126, "count": len(dn), "type": "VEC3"})
                p.setdefault("targets", []).append({"POSITION": ia, "NORMAL": len(js["accessors"]) - 1}); tn.append(k)
                if "weights" in m: m["weights"].append(0.0)
                man["drivers"].append({q: v for q, v in d.items() if q != "cloth"})
            stats[m["name"]] = {"morph_targets": [d["target"] for d in info["drivers"]], "posed_map": seat}
        if shirt and m["name"] == "garment_top_shirt":
            img = open(os.path.join(shirt, "garment_top_shirt_fold_stand_n.jpg"), "rb").read()
            js["images"].append({"name": "garment_top_shirt_fold_stand_n.jpg", "mimeType": "image/jpeg", "bufferView": _append(js, parts, img)})
            js["textures"].append({"source": len(js["images"]) - 1, "sampler": 0}); mat["normalTexture"] = {"index": len(js["textures"]) - 1}
            stats[m["name"]] = {"normal_bytes": len(img)}
    _write_glb(os.path.join(out, man["glb"]), js, parts)
    man.setdefault("build", {})["cloth"] = {"by": "B8 pipeline/cloth_bake.py dress2 (round 2)", "garments": stats}
    json.dump(man, open(os.path.join(out, man_name), "w"))
    print("dressed", out, json.dumps(stats), "validate:", glbio.validate(os.path.join(out, man["glb"])))


SHIRT_CENTRE = (0.035, 0.07)    # metres from the centre line: no simulated folds within 35 mm, all from 70 mm (the shirt's placket and the
                                #   centre back are stiff, interfaced strips in a real shirt; free, the run buckled them into a glossy ridge)


def bake_stand(package, work, out, who="M50", garment="garment_top_shirt", frame=None, mask=None):
    """Round 2: the standing fold map of one garment from a standing run (cloth.py prep ... --frames=40), SIZE, B2's authored map
    underneath -> <out>/<garment>_fold_stand_n.jpg, preview, report. `mask`: per sim vertex 0..1, where the folds are kept
    (default for the shirt: none in the band SHIRT_CENTRE either side of the centre line, front and back)."""
    from PIL import Image
    os.makedirs(out, exist_ok=True); pk = C.load(package); v0, J0, rest = C.person(pk, who); g = pk.garments[garment]
    P = rest[g.name]; T = C.Topo(g, P); sim = np.load(os.path.join(work, garment + ".sim.npy"), mmap_mode="r"); assert sim.shape[1] == T.ns
    f = C.FR_SETTLE - 1 if frame is None else int(frame); M = C.pose(pk, J0, {}); Xp, _ = C.skin_frames(pk, g.name, P, M); X = T.refine(Xp[T.first])
    d = np.asarray(sim[f], np.float64) - X; dlow = C.smooth(d, T.As, LOW_ITERS[g.kind]); fold = C.smooth(d - dlow, T.As, FOLD_SMOOTH["stand"])
    if mask is None and g.kind == "top":
        x = np.abs(T.refine(P[T.first])[:, 0]); mask = _smoothstep(x, *SHIRT_CENTRE)
    if mask is not None: fold = fold * mask[:, None]
    Xf = X + dlow; uvc = np.einsum("tkc,tcd->tkd", T.bary, g.uv[g.tris[T.sim_gtri[T.base]]]); ts = _tangent_space(T, Xf, Xf + fold, uvc)
    under = _image_of(pk, g.material); un = None
    if under is not None:
        un = np.asarray(under.convert("RGB").resize((SIZE, SIZE), Image.BILINEAR), np.float32) / 127.5 - 1.0; un /= np.maximum(np.linalg.norm(un, axis=2, keepdims=True), 1e-9)
    n = _finish(_raster(uvc, ts, SIZE), under=un)
    Image.fromarray(np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(out, "%s_fold_stand_n.jpg" % g.name), quality=90)
    _preview(n, os.path.join(out, "%s_fold_stand_preview.png" % g.name)); ang = np.degrees(np.arccos(np.clip(ts[..., 2], -1, 1)))
    rep = {"method": "stand", "person": who, "frame": f, "drape_mm_p50_p95": [round(float(q) * 1000, 1) for q in np.percentile(np.linalg.norm(d, axis=1), [50, 95])],
           "fold_mm_p95": round(float(np.percentile(np.linalg.norm(fold, axis=1), 95)) * 1000, 1), "fold_angle_deg_p50_p95_max": [round(float(q), 1) for q in np.percentile(ang, [50, 95, 100])]}
    json.dump({g.name: rep}, open(os.path.join(out, "bake-report-%s.json" % g.name), "w"), indent=1); print(g.name, json.dumps(rep))
    return T, X, d, fold


# ------------------------------------------------------------------------------------------------ round 3 (REVIEW-09 items 4 and 5)
# Extra correctives on top of round 2's four (which stay exactly as they are at the operator pose):
#  - cloth_trousers_raise1_<s> (hip 15 -> 90) and cloth_trousers_raise2_<s> (hip 90 -> 120): a standing hip flexion (W6-E26, E27),
#    from a standing drape of the right leg (cloth.prep_raise), mirrored to the left; zeroed by viewer/src/cloth-pose.ts when seated;
#  - cloth_trousers_heavy_<s> (hip 15 -> 80): the heavy build's seated drape minus the median's, scaled by the plug-in by how much fuller
#    the current thigh is than the median's (0 at the median, 1 at the heavy preset); applied only when seated.
R3 = {"raise_thigh": (0.05, 0.35),            # the raise targets own the thigh from just above the knee (fraction of the knee-to-hip height)
      "hug_under": (0.3, 0.6),                 # cloth whose posed normal points down by more than this (y component) is taken toward the skin
      "hug_clear": 0.010}                      # metres: the down-facing cloth under a raised thigh keeps this clearance (no bag)


def _ramp(x, a, b): return float(np.clip((x - a) / (b - a), 0, 1))


def _r2_weights(dofs):
    w = {}
    for s in "lr":
        w["cloth_trousers_lap_" + s] = _ramp(dofs.get("hip_%s.flex" % s, 0), 15, 80); w["cloth_trousers_knee_" + s] = _ramp(dofs.get("knee_%s.flex" % s, 0), 15, 88)
    return w


def _height_delta(pk, g, T, P_ref, M, S, v0, pin, under_seat=True, hug=None):
    """The smooth rest-space corrective (GLB order) that takes the garment as rendered (P_ref skinned by M) onto the simulated surface S."""
    B = SEAT2_BAKE; Xp, A = C.skin_frames(pk, g.name, P_ref, M); X = T.refine(Xp[T.first])
    N = C.smooth(C.vnormals(X, T.tris), T.As, B["normals"]); N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9); Ns = C.vnormals(S, T.tris)
    d_hem = np.nan_to_num(_loop_dist(T, X, ("low",)), posinf=1.0)
    h, conf = _height(X, N, S, Ns, B["lat"], B["cap"] + 0.01, allowed=d_hem > B["sim_hem"])
    sm = lambda a, n: C.smooth(a[:, None], T.As, n)[:, 0]
    cs = sm(conf, B["fill"]); hs = sm(h * conf, B["fill"]) / np.maximum(cs, 1e-3); hs = np.where(cs > 1e-3, hs, 0.0)
    keep = _smoothstep(d_hem, *B["hem"]) * (1 - pin)
    if under_seat: keep = keep * (1 - _smoothstep(-N[:, 1], *B["under_seat"]))
    cw = _smoothstep(sm(conf, B["edge"]), 0.25, 0.85)
    from scipy.spatial import cKDTree
    clear = cKDTree(C.skin(pk, "body", v0, M)).query(X)[0]; H0 = hs * cw
    if hug is not None:                                                           # round 3: under a raised thigh the run's cloth still hangs 14-25 mm
        u = _smoothstep(-N[:, 1], *hug["under"]) * (hug["region"] if "region" in hug else 1.0)   # (gravity); the designer asks for no bag: down-facing cloth
        H0 = np.minimum(H0, (1 - u) * H0 + u * -np.maximum(clear - hug["clear"], 0.0))           # is taken to within hug.clear of the skin, never pushed out
    Hm = sm(np.clip(H0 * keep, -B["cap"], B["cap"]), B["morph"])
    Hm = np.maximum(Hm, -np.maximum(clear - B["clear"], 0.0)); Hm = _slope_limit(Hm, T, X, B["slope"])
    d0 = (Hm[:, None] * N)[:T.n0]; Ainv = np.linalg.inv(A[T.first][T.simv]); D = T.to_glb(np.einsum("nij,nj->ni", Ainv, d0))
    return C.smooth(D[T.first], T.A, B["glb_smooth"])[T.inv], Hm, cw


def _mirror(P):
    from scipy.spatial import cKDTree
    d, j = cKDTree(P).query(P * np.array([-1.0, 1, 1])); return j, d


def _targets_out(out, g, morphs, drivers, extra):
    import hashlib
    n0 = None; T = extra.pop("_T"); n0 = C.vnormals(g.P[T.first], T.tw[T.tri_ok])
    mn = {k: (C.vnormals((g.P + v)[T.first], T.tw[T.tri_ok]) - n0)[T.inv] for k, v in morphs.items()}
    tag = extra["tag"]
    np.savez(os.path.join(out, "%s.%s.npz" % (g.name, tag)), **{"p_" + k: v.astype(np.float32) for k, v in morphs.items()}, **{"n_" + k: v.astype(np.float32) for k, v in mn.items()})
    json.dump({"drivers": drivers, "material": g.material, "vertices": len(g.P), "positions_sha1": hashlib.sha1(np.ascontiguousarray(g.P, np.float32).tobytes()).hexdigest(), **extra},
              open(os.path.join(out, "%s.%s.json" % (g.name, tag)), "w"), indent=1)
    print(g.name, tag, json.dumps({k: round(float(np.linalg.norm(v, axis=1).max()) * 1000, 1) for k, v in morphs.items()}))


def bake_raise(package, work, seat, out, who="M50", garment="garment_trousers_work"):
    """-> <out>/<garment>.raise.npz/.json: cloth_trousers_raise1_l/_r, raise2_l/_r from a cloth.prep_raise run; `seat` = round 2's folder."""
    os.makedirs(out, exist_ok=True); pk = C.load(package); v0, J0, rest = C.person(pk, who); g = pk.garments[garment]; P = rest[g.name]; T = C.Topo(g, P)
    pin = T.pins(P[T.first], g.kind, C.SEAT2["pin"]); cfg = json.load(open(os.path.join(work, garment + ".json"))); assert cfg.get("method") == "raise"
    sim = np.load(os.path.join(work, garment + ".sim.npy"), mmap_mode="r"); z2 = np.load(os.path.join(seat, garment + ".cloth.npz"))
    R = {}; names = pk.names; jy = lambda n: J0[names.index(n)]; X0 = T.refine(P[T.first])
    thigh_sim = _smoothstep((X0[:, 1] - jy("calf_r")[1]) / (jy("thigh_r")[1] - jy("calf_r")[1]), *R3["raise_thigh"]) * (1 - _smoothstep(X0[:, 0] if jy("thigh_l")[0] > 0 else -X0[:, 0], -0.04, 0.04))
    for k in ("E26", "E27"):
        kd = cfg["keys"][k]; w = _r2_weights(kd["dofs"]); P_ref = P + sum(w[t] * z2["p_" + t] for t in w)
        R[k], _, _ = _height_delta(pk, g, T, P_ref, C.pose(pk, J0, kd["dofs"]), np.asarray(sim[kd["frame"]], np.float64), v0, pin, under_seat=False,
                                   hug={"under": R3["hug_under"], "clear": R3["hug_clear"], "region": thigh_sim})
    names = pk.names; jy = lambda n: J0[names.index(n)]
    t = (P[:, 1] - jy("calf_r")[1]) / (jy("thigh_r")[1] - jy("calf_r")[1]); thigh = _smoothstep(t, *R3["raise_thigh"])
    right = 1 - _smoothstep(P[:, 0] if jy("thigh_l")[0] > 0 else -P[:, 0], -0.04, 0.04)
    j, md = _mirror(P); flip = np.array([-1.0, 1, 1])
    morphs = {}; drivers = []
    for name, D, (a, b) in (("raise1", R["E26"], (15, 90)), ("raise2", R["E27"] - R["E26"], (90, 120))):
        Dr = D * (thigh * right)[:, None]; morphs["cloth_trousers_%s_r" % name] = Dr; morphs["cloth_trousers_%s_l" % name] = Dr[j] * flip
        for s in "lr": drivers.append({"target": "cloth_trousers_%s_%s" % (name, s), "dof": "hip_%s.flex" % s, "from": a, "to": b, "when": "standing"})
    _targets_out(out, g, morphs, drivers, {"_T": T, "tag": "raise", "method": "raise", "person": who, "package": os.path.abspath(package),
                                           "mirror_mm_p99": round(float(np.percentile(md, 99)) * 1000, 2)})


def _girth_probe(pk, P, J0):
    """GLB vertices of both trouser legs in a band at mid-thigh, and the mean distance of each leg's band from its own centre (x, z)."""
    names = pk.names; out = []; idx = []
    for s in "lr":
        kn, hp = J0[names.index("calf_" + s)], J0[names.index("thigh_" + s)]; t = (P[:, 1] - kn[1]) / (hp[1] - kn[1])
        sel = np.where((t > 0.45) & (t < 0.65) & (np.sign(P[:, 0]) == np.sign(hp[0])))[0]; idx.append(sel)
    return [np.concatenate(idx).tolist(), [len(idx[0])]]


def _girth(P, probe):
    idx, (n0,) = np.asarray(probe[0]), probe[1]; out = []
    for sel in (idx[:n0], idx[n0:]):
        q = P[sel][:, [0, 2]]; out.append(float(np.linalg.norm(q - q.mean(0), axis=1).mean()))
    return float(np.mean(out))


def bake_heavy(package, work_heavy, seat, out, heavy="M50_HEAVY", median="M50", garment="garment_trousers_work"):
    """-> <out>/<garment>.heavy.npz/.json: cloth_trousers_heavy_l/_r = the heavy build's seated correctives (bake_seat2 of `work_heavy`)
    minus round 2's (the median's), with the girth probe that scales them in the viewer."""
    tmp = os.path.join(out, "heavy-seat"); bake_seat2(package, work_heavy, tmp, heavy, garment)
    pk = C.load(package); g = pk.garments[garment]; zh = np.load(os.path.join(tmp, garment + ".cloth.npz")); zm = np.load(os.path.join(seat, garment + ".cloth.npz"))
    _, J0m, restm = C.person(pk, median); Pm = restm[g.name]; _, _, resth = C.person(pk, heavy); Ph = resth[g.name]
    probe = _girth_probe(pk, Pm, J0m); g0, g1 = _girth(Pm, probe), _girth(Ph, probe)
    girths = {}
    for p in [q["name"] for q in pk.manifest["shape"].get("presets", [])][:8]:
        try: girths[p] = round(_girth(C.person(pk, p)[2][g.name], probe) * 1000, 1)
        except Exception: pass
    morphs = {"cloth_trousers_heavy_%s" % s: sum(zh["p_cloth_trousers_%s_%s" % (k, s)] - zm["p_cloth_trousers_%s_%s" % (k, s)] for k in ("lap", "knee")) for s in "lr"}
    drivers = [{"target": "cloth_trousers_heavy_%s" % s, "dof": "hip_%s.flex" % s, "from": 15, "to": 80, "when": "seated", "girth": True} for s in "lr"]
    T = C.Topo(g, Pm)
    _targets_out(out, g, morphs, drivers, {"_T": T, "tag": "heavy", "method": "heavy", "heavy": heavy, "median": median, "package": os.path.abspath(package),
                                           "girth": {"probe": probe, "median": g0, "heavy": g1, "clamp": [0.0, 1.25]},
                                           "girth_mm_by_preset": girths})


def dress_extra(package, extra, out):
    """Round 3: a copy of `package` (which already has round 2's correctives) with the extra targets in `extra` (raise, heavy) appended,
    their drivers, and the manifest block `clothCorrectives` that viewer/src/cloth-pose.ts reads (seated / standing only, girth scale)."""
    import glb as glbio, hashlib
    man_name = next(f for f in sorted(os.listdir(package)) if f.endswith(".avatar.json")); man = json.load(open(os.path.join(package, man_name)))
    if os.path.exists(out): shutil.rmtree(out)
    shutil.copytree(package, out, ignore=shutil.ignore_patterns(man_name, man["glb"]), symlinks=True)
    js, blob = glbio.read_glb(os.path.join(package, man["glb"])); parts = [bytes(blob) + b"\0" * ((-len(blob)) % 4)]; block = {"mesh": None, "targets": [], "girth": None}
    for m in js["meshes"]:
        p = m["primitives"][0]; files = sorted(f for f in os.listdir(extra) if f.startswith(m["name"] + ".") and f.endswith(".json") and not f.endswith(".cloth.json"))
        for f in files:
            info = json.load(open(os.path.join(extra, f))); z = np.load(os.path.join(extra, f[:-5] + ".npz"))
            pos = np.asarray(glbio.accessor(js, blob, p["attributes"]["POSITION"]), np.float32)
            if hashlib.sha1(np.ascontiguousarray(pos).tobytes()).hexdigest() != info["positions_sha1"]:
                raise SystemExit("dress_extra: %s in %s is not the mesh %s was baked on" % (m["name"], package, f))
            tn = m.setdefault("extras", {}).setdefault("targetNames", []); has = set(tn)
            for d in info["drivers"]:
                k = d["target"]
                if k in has: raise SystemExit("dress_extra: %s already has %s" % (package, k))
                dp = np.ascontiguousarray(z["p_" + k], np.float32); dn = np.ascontiguousarray(z["n_" + k], np.float32)
                js["accessors"].append({"bufferView": _append(js, parts, dp.tobytes()), "componentType": 5126, "count": len(dp), "type": "VEC3", "min": dp.min(0).tolist(), "max": dp.max(0).tolist()}); ia = len(js["accessors"]) - 1
                js["accessors"].append({"bufferView": _append(js, parts, dn.tobytes()), "componentType": 5126, "count": len(dn), "type": "VEC3"})
                p.setdefault("targets", []).append({"POSITION": ia, "NORMAL": len(js["accessors"]) - 1}); tn.append(k)
                if "weights" in m: m["weights"].append(0.0)
                block["targets"].append(d)                                         # weights set by viewer/src/cloth-pose.ts (no manifest driver)
            block["mesh"] = m["name"]
            if info.get("girth"): block["girth"] = info["girth"]
    _write_glb(os.path.join(out, man["glb"]), js, parts); man["clothCorrectives"] = block
    man.setdefault("build", {}).setdefault("cloth", {})["round3"] = {"by": "B8 pipeline/cloth_bake.py dress_extra", "extra": os.path.relpath(extra, __import__("labpaths").LAB)}
    json.dump(man, open(os.path.join(out, man_name), "w"))
    print("dressed", out, json.dumps({"targets": [(t["target"], t["when"]) for t in block["targets"]], "girth": [(block["girth"] or {}).get(k) for k in ("median", "heavy")]}), "validate:", glbio.validate(os.path.join(out, man["glb"])))
