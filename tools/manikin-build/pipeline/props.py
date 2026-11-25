"""Props (owner: B6): binds the modelled props (packages/props/src/*.npz, from prop_model.py) to a package.

    PY=$MANIKIN_PYTHON
    $PY -I pipeline/props.py packages/operator-m            -> packages/props/operator-m-props.glb (+ props.json, maps/)

or, inside build_operator.py, before write_glb (meshes = the list of glb.Mesh being written):

    import props
    extra, mats, info = props.build(meshes, skeleton.names)     # glb.Mesh list, materials, {"soleHeight_m": ...}
    meshes += extra; materials.update(mats)

Every prop follows the body through the reference meshes' own morph targets (whatever their names are):
  surface   each vertex rides on the nearest triangle of its reference mesh (barycentric point + offset in the
            triangle's frame, in metres, so thickness never scales): belt -> trousers, collar -> body + top,
            sole and toe cap -> shoe.  Skin weights are the reference's, interpolated.
  buckle    rigid: moves with the mean of its surface binding.
  rigid     the headset: skinned to `head` only.  Cups translate with the skull round each ear, the band's top with
            the cap, the band flexes between them (anchor weights from the model); cushion faces ride on the head.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy.spatial import cKDTree
import glb, prop_io

LAB = __import__("labpaths").LAB
SRC = os.path.join(LAB, "packages/props/src")
REFS = {"headset": (("body",), ("garment_cap", "cap")), "belt": (("garment_trousers",),), "collar": (("body",), ("garment_top", "garment_shirt")),
        "shoes": (("body",),), "last": (("body",),)}
MESH_NAME = {"headset": "prop_headset", "belt": "prop_belt", "collar": "garment_collar", "shoes": "shoe_safety_trainer", "last": "shoe_last"}


def _find(meshes, prefixes):
    for pre in prefixes:
        for m in meshes:
            if m.name.startswith(pre) and not m.name.startswith("prop_"): return m
    return None


def _dense_weights(m, nb):
    W = m.weights
    if W is None: return None
    if hasattr(W, "toarray"): return np.asarray(W.toarray(), np.float32)
    W = np.asarray(W)
    if W.shape[1] == nb and m.joints is None: return W.astype(np.float32)
    D = np.zeros((len(W), nb), np.float32); J = np.asarray(m.joints)
    for k in range(W.shape[1]): np.add.at(D, (np.arange(len(W)), J[:, k]), W[:, k])
    return D


SKIN8 = ("_JOINTS8_0", "_WEIGHTS8_0", "_JOINTS8_1", "_WEIGHTS8_1")          # build_body.SKIN8: the body's eight-influence set


def _dense8(m, nb):
    """The reference's eight-influence weights as a dense (n, nb) matrix, from its custom attributes; None when it has none."""
    a = getattr(m, "attrs", None) or {}
    if all(k in a for k in SKIN8): J = np.c_[np.asarray(a[SKIN8[0]]), np.asarray(a[SKIN8[2]])]; W = np.c_[np.asarray(a[SKIN8[1]]), np.asarray(a[SKIN8[3]])]
    elif "JOINTS_1" in a and getattr(m, "joints", None) is not None: J = np.c_[np.asarray(m.joints), np.asarray(a["JOINTS_1"])]; W = np.c_[np.asarray(m.weights), np.asarray(a["WEIGHTS_1"])]
    else: return None
    D = np.zeros((len(W), nb), np.float32)
    for k in range(J.shape[1]): np.add.at(D, (np.arange(len(W)), J[:, k].astype(np.int64)), W[:, k])
    return D


def _top8(W, k=8):
    o = np.argsort(-W, axis=1)[:, :k]; Wk = np.take_along_axis(W, o, 1).astype(np.float64); s = Wk.sum(1, keepdims=True)
    Wk = np.where(s > 0, Wk / np.maximum(s, 1e-12), 0.0); Wk[s[:, 0] <= 0, 0] = 1.0; o = np.where(Wk > 0, o, 0)
    return o.astype(np.int64), Wk.astype(np.float32)


class Surface:
    """Several reference meshes as one surface with morphs and weights."""
    def __init__(self, refs, nb):
        V, T, o = [], [], 0; names = []
        for m in refs:
            for n in m.morphs:
                if n not in names: names.append(n)
        self.morphs = {n: [] for n in names}; Ws = []
        for m in refs:
            v = np.asarray(m.v, float); V.append(v); T.append(np.asarray(m.tris) + o); o += len(v)
            for n in names: self.morphs[n].append(np.asarray(m.morphs[n], float) if n in m.morphs else np.zeros_like(v))
            Ws.append(_dense_weights(m, nb))
        self.v = np.vstack(V); self.t = np.vstack(T); self.morphs = {n: np.vstack(a) for n, a in self.morphs.items()}
        self.W = np.vstack(Ws) if all(w is not None for w in Ws) else None
        W8 = [_dense8(m, nb) for m in refs]; dq = [(getattr(m, "attrs", None) or {}).get("_DQS") for m in refs]
        self.W8 = np.vstack(W8) if all(w is not None for w in W8) else None                    # the viewer skins the body with these
        self.dqs = np.concatenate([np.asarray(x, np.float32).ravel() for x in dq]) if all(x is not None for x in dq) else None
        self.tree = cKDTree(self.v[self.t].mean(1))

    @staticmethod
    def frame(P):
        e1 = P[:, 1] - P[:, 0]; n = np.cross(e1, P[:, 2] - P[:, 0])
        e1 /= np.maximum(np.linalg.norm(e1, axis=1, keepdims=True), 1e-12); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        return e1, np.cross(n, e1), n

    def bind(self, p, k=12):
        """Nearest triangle (of k candidates by centroid, by distance to the clamped projection)."""
        _, cand = self.tree.query(p, k=k); best = np.full(len(p), np.inf); tri = np.zeros(len(p), int); bar = np.zeros((len(p), 3))
        for c in range(k):
            P = self.v[self.t[cand[:, c]]]; e1, e2, n = self.frame(P.copy())
            d = p - P[:, 0]; a = P[:, 1] - P[:, 0]; b = P[:, 2] - P[:, 0]
            aa = (a * a).sum(1); ab = (a * b).sum(1); bb = (b * b).sum(1); da = (d * a).sum(1); db = (d * b).sum(1)
            det = np.maximum(aa * bb - ab * ab, 1e-18); u = (bb * da - ab * db) / det; w = (aa * db - ab * da) / det
            B = np.clip(np.stack([1 - u - w, u, w], 1), 0, None); B /= B.sum(1, keepdims=True)
            q = (B[:, :, None] * P).sum(1); dist = np.linalg.norm(p - q, axis=1); m = dist < best
            best[m] = dist[m]; tri[m] = cand[m, c]; bar[m] = B[m]
        P = self.v[self.t[tri]]; e1, e2, n = self.frame(P.copy()); r = p - (bar[:, :, None] * P).sum(1)
        return tri, bar, np.stack([(r * e1).sum(1), (r * e2).sum(1), (r * n).sum(1)], 1), best

    def fit(self, v, tri, bar, off):
        P = v[self.t[tri]]; e1, e2, n = self.frame(P.copy())
        return (bar[:, :, None] * P).sum(1) + off[:, :1] * e1 + off[:, 1:2] * e2 + off[:, 2:3] * n

    def weights(self, tri, bar):
        return (bar[:, :, None] * self.W[self.t[tri]]).sum(1)


def zone_table():
    return json.load(open(os.path.join(LAB, "packages/props/zones.json")))


def _stitch_mask(d, uv, size):
    """Stitch dashes 2.6 mm inside the edge of every overlay panel, from the per-vertex edge distance `sd` and edge
    length `sl` (prop_shoe.patch): rasterised with barycentric interpolation, so it does not depend on the UV islands."""
    if "sd" not in d.files or float(d["sd"].min()) > 0.5: return None
    sd, sl = d["sd"].astype(float), d["sl"].astype(float); out = np.zeros((size, size), np.float32)
    for t in d["tris"][(sd[d["tris"]].min(1) < 0.006)]:
        if sd[t].max() > 0.5: continue
        p = uv[t]; lo = np.floor(p.min(0)).astype(int); hi = np.ceil(p.max(0)).astype(int) + 1
        lo = np.clip(lo, 0, size - 1); hi = np.clip(hi, 1, size)
        if (hi <= lo).any(): continue
        X, Y = np.meshgrid(np.arange(lo[0], hi[0]) + 0.5, np.arange(lo[1], hi[1]) + 0.5)
        v0, v1 = p[1] - p[0], p[2] - p[0]; den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-9: continue
        b1 = ((X - p[0, 0]) * v1[1] - v1[0] * (Y - p[0, 1])) / den; b2 = (v0[0] * (Y - p[0, 1]) - (X - p[0, 0]) * v0[1]) / den; b0 = 1 - b1 - b2
        ins = (b0 >= -0.02) & (b1 >= -0.02) & (b2 >= -0.02)
        D = b0 * sd[t[0]] + b1 * sd[t[1]] + b2 * sd[t[2]]; Ln = b0 * sl[t[0]] + b1 * sl[t[1]] + b2 * sl[t[2]]
        hit = ins & (np.abs(D - 0.0027) < 0.00055) & ((Ln % 0.0036) < 0.0024)
        out[lo[1]:hi[1], lo[0]:hi[0]] = np.maximum(out[lo[1]:hi[1], lo[0]:hi[0]], hit.astype(np.float32))
    return out


GRAIN = {"polymer": 0.55, "polymer_satin": 0.2, "leatherette": 0.9, "rubber": 0.4, "foam": 1.6, "shoe_upper": 0.8, "shoe_cap": 0.5, "shoe_midsole": 0.5,
         "shoe_outsole": 0.8, "shoe_lace": 1.2, "shoe_lining": 1.2, "sock": 1.4, "belt_leather": 0.8, "collar_cloth": 1.0, "trouser_cloth": 1.0, "grille": 1.5}


def atlas(name, d, size=1024, pkg="operator-m", prop=""):
    """One material per prop: zone colour, roughness and metalness painted into the UV atlas; Blender's baked ambient
    occlusion (maps/<pkg>_<prop>_ao.png) in the occlusion channel and lightly in the colour; a fine grain normal map."""
    from PIL import Image, ImageDraw, ImageFilter
    zt = zone_table(); zones = [str(z) for z in d["zones"]]
    col = Image.new("RGB", (size, size), (60, 60, 60)); orm = Image.new("RGB", (size, size), (255, 160, 0)); gr = Image.new("L", (size, size), 0)
    dc, do, dg = ImageDraw.Draw(col), ImageDraw.Draw(orm), ImageDraw.Draw(gr)
    uv = d["uv"] * [size, -size] + [0, size]
    for width in (5, 0):                                    # a fat pass first as padding round the islands (islands are one zone each, 7 px apart)
        for t, z in zip(d["tris"], d["zone"]):
            s_ = zt[zones[z]]; pts = [tuple(uv[i]) for i in t]
            c1 = tuple(s_["rgb"]); c2 = (255, int(round(s_["rough"] * 255)), int(round(s_.get("metal", 0) * 255))); c3 = int(min(255, GRAIN.get(zones[z], 0) * 100))
            if width: dc.line(pts + pts[:1], fill=c1, width=width); do.line(pts + pts[:1], fill=c2, width=width); dg.line(pts + pts[:1], fill=c3, width=width)
            else: dc.polygon(pts, fill=c1); do.polygon(pts, fill=c2); dg.polygon(pts, fill=c3)
    out = os.path.join(LAB, "packages/props/maps"); os.makedirs(out, exist_ok=True)
    ca = np.asarray(col, np.float32); oa = np.asarray(orm, np.float32).copy()
    aop = os.path.join(out, "%s_%s_ao.png" % (pkg, prop))
    if os.path.exists(aop):
        ao = np.asarray(Image.open(aop).convert("L").resize((size, size), Image.BILINEAR), np.float32) / 255
        ao = np.clip(ao, 0, 1) ** 0.9; oa[..., 0] = 255 * ao; ca = ca * (0.62 + 0.38 * ao)[..., None]
    stitch = _stitch_mask(d, uv, size)
    if stitch is not None:
        ca = ca + 26.0 * stitch[..., None]                                             # lighter thread
    rng = np.random.default_rng(7); h = np.asarray(Image.fromarray((rng.random((size, size)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    amp = np.asarray(gr, np.float32) / 100.0
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * amp * 0.16; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * amp * 0.16
    if stitch is not None:
        sh_ = np.asarray(Image.fromarray((stitch * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9)), np.float32) / 255
        gx = gx + (np.roll(sh_, -1, 1) - np.roll(sh_, 1, 1)) * 1.6; gy = gy + (np.roll(sh_, -1, 0) - np.roll(sh_, 1, 0)) * 1.6
    nz = 1 / np.sqrt(gx * gx + gy * gy + 1); nm = np.dstack([(-gx * nz) * 0.5 + 0.5, (gy * nz) * 0.5 + 0.5, nz * 0.5 + 0.5])
    oa[..., 1] = np.clip(oa[..., 1] + (h - 0.5) * 24 * np.minimum(amp, 1), 0, 255)                    # roughness breaks up with the grain
    stem = "%s_%s" % (pkg, name)
    pc, po, pn = (os.path.join(out, stem + x) for x in ("_baseColor.png", "_orm.png", "_normal.png"))
    Image.fromarray(ca.clip(0, 255).astype(np.uint8)).save(pc); Image.fromarray(oa.clip(0, 255).astype(np.uint8)).save(po); Image.fromarray((nm * 255).clip(0, 255).astype(np.uint8)).save(pn)
    return {"pbrMetallicRoughness": {"metallicFactor": 1.0, "roughnessFactor": 1.0},
            "_images": {"baseColorTexture": pc, "metallicRoughnessTexture": po, "occlusionTexture": po, "normalTexture": pn}}


def build_one(prop, meshes, joint_names, lift=0.0, pkg="operator-m", body=None):
    """meshes: glb.Mesh-like reference meshes in the frame the prop was modelled in, shifted up by `lift`."""
    d = np.load(os.path.join(SRC, pkg, prop + ".npz")); meta = np.load(os.path.join(SRC, pkg, prop + ".meta.npz"))
    nb = len(joint_names); v = d["v"].astype(float) + [0, lift, 0]; n = len(v)
    refs = [m for m in ((body if (body is not None and pre[0] == "body") else _find(meshes, pre)) for pre in REFS[prop]) if m is not None]
    if not refs: raise RuntimeError("props: no reference mesh for " + prop)
    S = Surface(refs, nb); grp = [str(g) for g in d["groups"]]; gid = d["grp"]
    morphs = {k: np.zeros((n, 3)) for k in S.morphs}
    W = np.zeros((n, nb), np.float32); report = {}
    af = gid == grp.index("affine")
    surf = np.isin(gid, [grp.index("surface"), grp.index("buckle")]) | (d["soft"] > 0) | af
    if surf.any():
        idx = np.where(surf)[0]; tri, bar, off, dist = S.bind(v[idx])
        report["bind_distance_mm_max"] = round(float(dist.max() * 1000), 1)
        for k, dm in S.morphs.items(): morphs[k][idx] = S.fit(S.v + dm, tri, bar, off) - v[idx]
        on_surface = {k: a.copy() for k, a in morphs.items()}
        if S.W is not None: W[idx] = S.weights(tri, bar)
    if af.any():
        # the shoe keeps its design: per side, the least-squares affine map of the foot under each morph moves it; below the
        # insole the vertical part fades out, so the sole height and the ground plane never change with the body
        box = meta["foot_box"] + [0, lift, 0]; rv = S.v; report["affine_fit_mm_rms"] = {}
        yf = np.clip((v[:, 1] - lift - 0.004) / 0.026, 0, 1); yf = yf * yf * (3 - 2 * yf)
        for sgn in (1, -1):
            lo, hi = box[0] * [sgn, 1, 1], box[1] * [sgn, 1, 1]; lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
            sel = np.all((rv > lo) & (rv < hi), 1); mine = af & (np.sign(v[:, 0]) == sgn)
            X = np.c_[rv[sel] - rv[sel].mean(0), np.ones(sel.sum())]; Xi = np.linalg.pinv(X); Q = np.c_[v[mine] - rv[sel].mean(0), np.ones(mine.sum())]
            worst = 0.0
            for k, dm in S.morphs.items():
                M = Xi @ dm[sel]; dd = Q @ M; dd[:, 1] *= yf[mine]; sf = d["soft"][mine].astype(float)[:, None]
                morphs[k][mine] = (1 - sf) * dd + sf * on_surface[k][mine]             # the collar rides on the leg, the rest on the foot
                worst = max(worst, float(np.sqrt(((X @ M - dm[sel]) ** 2).sum(1).mean())))
            report["affine_fit_mm_rms"]["L" if sgn > 0 else "R"] = round(worst * 1000, 2); report["foot_vertices"] = int(sel.sum())
    bk = gid == grp.index("buckle")
    if bk.any():
        for k in morphs: morphs[k][bk] = morphs[k][bk].mean(0)
        W[bk] = W[bk].mean(0)
    rg = gid == grp.index("rigid")
    if rg.any():
        head = [j.lower() for j in joint_names].index("head")
        body = refs[0]; bv = np.asarray(body.v, float); cc = meta["cup_centre"] + [0, lift, 0]; apex = meta["band_apex"] + [0, lift, 0]
        near_l = np.linalg.norm(bv - cc, axis=1) < 0.06; near_r = np.linalg.norm(bv - cc * [-1, 1, 1], axis=1) < 0.06
        top = refs[-1]; tv = np.asarray(top.v, float); near_t = np.linalg.norm(tv - apex, axis=1) < 0.05
        A = d["anchors"].astype(float); s = d["soft"].astype(float)[:, None]
        for k in morphs:
            dl = np.asarray(body.morphs[k])[near_l].mean(0); dr = np.asarray(body.morphs[k])[near_r].mean(0)
            dt = np.asarray(top.morphs[k])[near_t].mean(0) if k in top.morphs and near_t.any() else 0.5 * (dl + dr)
            rigid = A[:, :1] * dl + A[:, 1:2] * dr + A[:, 2:3] * dt
            morphs[k] = np.where(rg[:, None], (1 - s) * rigid + s * morphs[k], morphs[k])
        W[rg] = 0; W[rg, head] = 1
        report["anchor_vertices"] = [int(near_l.sum()), int(near_r.sum()), int(near_t.sum())]
    attrs = None
    if prop == "last" and surf.all() and S.W8 is not None:
        # round 4: the last is skinned as the viewer skins the body under it (eight influences, the _DQS blend), so its collar,
        # which lies on the leg, moves with the skin in every pose instead of buckling under a linear four-influence blend
        idx = np.where(surf)[0]; W8 = (bar[:, :, None] * S.W8[S.t[tri]]).sum(1); J8, W8 = _top8(W8); W = np.zeros((n, nb), np.float32)
        np.add.at(W, (np.repeat(np.arange(n), 8), J8.ravel()), W8.ravel())
        attrs = {SKIN8[0]: J8[:, :4], SKIN8[1]: W8[:, :4], SKIN8[2]: J8[:, 4:], SKIN8[3]: W8[:, 4:]}
        if S.dqs is not None: attrs["_DQS"] = np.clip((bar * S.dqs[S.t[tri]]).sum(1), 0, 1).astype(np.float32)
        report["skinning"] = "eight influences and _DQS from the body under it"
    name = MESH_NAME[prop]; mat = "prop_" + prop
    mesh = glb.Mesh(name, v, d["tris"].astype(np.int64), mat, uv=d["uv"], tri_uv=d["tris"].astype(np.int64), weights=W, morphs=morphs, normals=d["n"],
                    morph_normals=prop == "collar", attrs=attrs)     # rigid and affine props: no normal deltas (they showed as facets on the hard shell)
    report.update(triangles=int(len(d["tris"])), vertices=int(n), targets=len(morphs))
    return mesh, {mat: atlas(mat, d, 2048 if prop == "shoes" else 1024 if prop == "headset" else 512, pkg, prop)}, report


def build(meshes, joint_names, which=("headset", "collar", "shoes"), lift=0.0, pkg="operator-m", body=None):
    """body: the WHOLE body (feet included) as a glb.Mesh-like with morphs and weights, when `meshes` holds a cut one."""
    out, mats, info = [], {}, {"props": {}}
    for p in which:
        m, mm, rep = build_one(p, meshes, joint_names, lift, pkg, body); out.append(m); mats.update(mm); info["props"][p] = rep
    sm = np.load(os.path.join(SRC, pkg, "shoes.meta.npz")); info["soleHeight_m"] = float(sm["sole_height"])
    info["zones"] = zone_table()
    return out, mats, info


TEST_SUFFIX = "_b6"


def view_package(pkg, info, which):
    """A lab-viewer manifest for looking at the freshly built props on B2's operator WITHOUT copying its GLB: B2's
    manifest, pointing at B2's files, with the props as wardrobe entries from the side GLB.  The side GLB's meshes carry
    the suffix `_b6` and each entry hides B2's built-in copy of the same prop."""
    src = os.path.join(LAB, "packages", pkg); dst = os.path.join(LAB, "packages/props", pkg); os.makedirs(dst, exist_ok=True)
    man = json.load(open(os.path.join(src, pkg + ".avatar.json")))
    def fix(o):
        if isinstance(o, dict): return {k: fix(x) for k, x in o.items()}
        if isinstance(o, list): return [fix(x) for x in o]
        if isinstance(o, str) and o.rsplit(".", 1)[-1] in ("png", "jpg", "webp", "glb", "json", "hdr", "ktx2", "bin") and not o.startswith(("/", "http", "..")): return "../../%s/%s" % (pkg, o)
        return o
    man = fix(man); man["name"] = pkg + "-b6"; side = "../%s-props.glb" % pkg; mine = set(MESH_NAME.values())
    for p in which: man["materials"]["prop_" + p] = {"class": "plain"}
    slots = man["wardrobe"]["slots"]
    for s0 in slots:
        for g0 in s0["garments"]:
            if len(g0.get("meshes", [])) > 1: g0["meshes"] = [x for x in g0["meshes"] if x not in mine]
    def slot(i, label):
        for s_ in slots:
            if s_["id"] == i:
                s_["garments"] = [g_ for g_ in s_["garments"] if not set(g_.get("meshes", [])) & mine]
                return s_
        slots.append({"id": i, "label": label, "default": None, "allowNone": True, "garments": []}); return slots[-1]
    def add(i, label, gid, prop, **extra):
        s_ = slot(i, label); s_["garments"].append({"id": gid, "label": label + " (B6, this build)", "meshes": [MESH_NAME[prop] + TEST_SUFFIX], "source": side, "hides": [MESH_NAME[prop]], **extra}); s_["default"] = gid
    if "shoes" in which:
        boots = [g_ for s_ in slots if s_["id"] == "shoes" for g_ in s_["garments"]]; old = next((g_ for g_ in boots if g_["id"] == "safety_trainer"), boots[0] if boots else {})
        add("shoes", "Shoes", "safety_trainer", "shoes", soleHeight=info["soleHeight_m"])      # no body mask on purpose: any skin seen outside the shoe is a poke-through
    if "headset" in which: add("headset", "Headset", "operator_headset", "headset")
    if "collar" in which: add("collar", "Collar", "mock_neck", "collar")
    for o in man["wardrobe"].get("outfits", []):
        o["wear"].update({k: v for k, v in (("shoes", "safety_trainer"), ("headset", "operator_headset"), ("collar", "mock_neck")) if k in which})
    json.dump(man, open(os.path.join(dst, pkg + "-b6.avatar.json"), "w"), indent=1)
    return os.path.join(dst, pkg + "-b6.avatar.json")


if __name__ == "__main__":
    pkg = os.path.abspath(sys.argv[1]); name = os.path.basename(pkg.rstrip("/")); path = os.path.join(pkg, name + ".glb")
    which = tuple(sys.argv[sys.argv.index("--which") + 1].split(",")) if "--which" in sys.argv else ("headset", "collar", "shoes")
    man = json.load(open(os.path.join(pkg, name + ".avatar.json"))); lift = man["build"]["soleHeight_m"]
    ref, names = prop_io.load_package(path, 0.0); skel = prop_io.load_skeleton(path, 0.0)
    body = ref.get("body")
    if body is None or not body.morphs or body.v[:, 1].min() > lift + 0.02:        # the package's body is cut or has no shape: take the clay body
        bname = "body-clay-f" if name.endswith("-f") else "body-clay"
        body = prop_io.load_package(os.path.join(LAB, "packages", bname, bname + ".glb"), -lift, want=("body",))[0]["body"]
    refs = [m for m in ref.values() if m.name not in set(MESH_NAME.values())]
    meshes, mats, info = build(refs, names, which, lift=lift, pkg=name, body=body)      # in the package's own (lifted) frame
    for m in meshes: m.name += TEST_SUFFIX
    out = os.path.join(LAB, "packages/props", name + "-props.glb")
    stats = glb.write_glb(out, meshes, skel, mats, generator="rigtwin avatar-lab pipeline/props.py (B6; modelled by script, no third-party asset)")
    info["validate"] = glb.validate(out); info["bytes"] = stats["bytes"]; info["package"] = name
    info["note"] = "test side GLB (mesh names end in _b6) in the package's own bind frame (bare soles at y = %.4f)" % lift
    info["viewer"] = os.path.relpath(view_package(name, info, which), LAB)
    json.dump(info, open(os.path.join(LAB, "packages/props", name + "-props.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in info.items() if k != "zones"}, indent=1))
