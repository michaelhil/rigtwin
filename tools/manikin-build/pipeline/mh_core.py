# Core reader for the MakeHuman-family data shipped with MPFB2 2.0.18 (assets CC0): base mesh hm08, UVs, targets,
# rigs with painted weights. Owner: B1. API documented in pipeline/README.md, section "Core".
# Everything returned is in metres in the glTF frame (+X the character's left, +Y up, +Z forward): the OBJ is in that
# frame in decimetres. Vertex arrays are always the full 19,158-row hm08 array (body + helper geometry + joint cubes).
import functools, gzip, json, os
import numpy as np
import scipy.sparse as sp

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(__import__("labpaths").LAB, "downloads", "mpfb2", "extracted", "mpfb", "data"))
SCALE = 0.1          # MakeHuman decimetres -> metres
NV = 19158


class Base:
    pass


@functools.lru_cache(maxsize=None)
def load_base():
    v = []; vt = []; quads = []; quv = []; qg = []; names = []; gi = {}
    cur = -1
    with open(os.path.join(DATA, "3dobjs", "base.obj")) as f:
        for line in f:
            if line.startswith("v "):
                p = line.split(); v.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("vt "):
                p = line.split(); vt.append((float(p[1]), float(p[2])))
            elif line.startswith("g "):
                n = line[2:].strip()
                if n not in gi: gi[n] = len(names); names.append(n)
                cur = gi[n]
            elif line.startswith("f "):
                p = [c.split("/") for c in line.split()[1:]]
                assert len(p) == 4, "hm08 is all quads"
                quads.append([int(c[0]) - 1 for c in p]); quv.append([int(c[1]) - 1 for c in p]); qg.append(cur)
    b = Base()
    b.v = np.array(v, dtype=np.float64) * SCALE
    assert b.v.shape == (NV, 3)
    b.uv = np.array(vt, dtype=np.float64)
    b.quads = np.array(quads, dtype=np.int64); b.quad_uv = np.array(quv, dtype=np.int64)
    b.quad_group = np.array(qg, dtype=np.int64); b.group_names = names
    vg = json.load(open(os.path.join(DATA, "mesh_metadata", "basemesh_vertex_groups.json")))
    b.vgroups = {}
    for name, ranges in vg.items():
        m = np.zeros(NV, dtype=bool)
        for lo, hi in ranges: m[lo:hi + 1] = True
        b.vgroups[name] = m
    mir = np.arange(NV)
    mp = os.path.join(DATA, "mesh_metadata", "hm08.mirror")
    if os.path.exists(mp):
        for line in open(mp):
            p = line.split()
            if len(p) >= 2: mir[int(p[0])] = int(p[1])
    b.mirror = mir
    return b


def body_quads(base, groups=("body",)):
    ids = [i for i, n in enumerate(base.group_names) if n in groups]
    return np.nonzero(np.isin(base.quad_group, ids))[0]


# ------------------------------------------------------------------------------------------------ targets
@functools.lru_cache(maxsize=None)
def list_targets():
    out = {}
    root = os.path.join(DATA, "targets")
    for d, _, files in os.walk(root):
        for fn in files:
            if fn.endswith(".target.gz") or fn.endswith(".target"):
                short = fn.split(".target")[0]
                rel = os.path.relpath(os.path.join(d, fn), root)
                out.setdefault(short, os.path.join(d, fn))            # short name; first found wins
                out[rel.split(".target")[0]] = os.path.join(d, fn)    # "macrodetails/height/…" also works
    return out


@functools.lru_cache(maxsize=4096)
def load_target(name_or_path):
    p = name_or_path if os.path.isabs(name_or_path) else list_targets().get(name_or_path)
    if p is None: raise KeyError("no such target: %s" % name_or_path)
    op = gzip.open if p.endswith(".gz") else open
    idx = []; d = []
    with op(p, "rt") as f:
        for line in f:
            t = line.split()
            if len(t) == 4 and t[0][0].isdigit():
                idx.append(int(t[0])); d.append((float(t[1]), float(t[2]), float(t[3])))
    idx = np.array(idx, dtype=np.int64); d = np.array(d, dtype=np.float64).reshape(-1, 3) * SCALE
    idx.setflags(write=False); d.setflags(write=False)
    return idx, d


def target_dense(name_or_path):
    idx, d = load_target(name_or_path)
    out = np.zeros((NV, 3)); out[idx] = d
    return out


def apply_targets(verts, weights):
    v = np.array(verts, dtype=np.float64, copy=True)
    for name, w in weights.items():
        if w == 0: continue
        idx, d = load_target(name)
        if len(idx): v[idx] += w * d
    return v


@functools.lru_cache(maxsize=None)
def _macro():
    return json.load(open(os.path.join(DATA, "targets", "macrodetails", "macro.json")))


def _components(var, value, mpfb_exact=False):
    """MPFB's interpolation between the named ends of each part of a macro variable. MPFB's outer bounds are -0.01 and
    1.01, so a slider at 1.0 is 99 % of the end target; unless mpfb_exact, the bounds are clamped to 0..1 so 0 and 1
    give the pure ends."""
    for part in _macro()["macrotargets"][var]["parts"]:
        lo, hi = part["lowest"], part["highest"]
        if not mpfb_exact: lo, hi = max(lo, 0.0), min(hi, 1.0)
        if lo <= value <= hi:
            t = (value - lo) / (hi - lo)
            return [(n, w) for n, w in ((part["low"], 1 - t), (part["high"], t)) if n and w > 0]
    return []


_PREFIX = {"racegenderage": "macrodetails/", "genderagemuscleweight": "macrodetails/universal-",
           "genderagemuscleweightproportions": "macrodetails/proportions/", "genderagemuscleweightheight": "macrodetails/height/",
           "genderagemuscleweightcupsizefirmness": "breast/"}


def macro_weights(gender=0.5, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5, cupsize=0.5, firmness=0.5,
                  race=(1 / 3, 1 / 3, 1 / 3), mpfb_exact=False):
    """MakeHuman's macro interpolation: {target path (relative, no extension): weight}. gender 0 woman, 1 man."""
    vals = dict(gender=gender, age=age, muscle=muscle, weight=weight, height=height, proportions=proportions,
                cupsize=cupsize, firmness=firmness)
    comp = {k: _components(k, float(np.clip(v, 0.0, 1.0)), mpfb_exact) for k, v in vals.items()}
    comp["race"] = [(n, w) for n, w in zip(("african", "asian", "caucasian"), race) if w > 0]
    known = list_targets(); out = {}
    for combo, vars_ in _macro()["combinations"].items():
        partial = [("", 1.0)]
        for var in vars_:
            partial = [(n + ("-" if n else "") + cn, w * cw) for n, w in partial for cn, cw in comp[var]]
        for n, w in partial:
            key = _PREFIX[combo] + n
            if w > 1e-9 and key in known: out[key] = out.get(key, 0.0) + w
    return out


def phenotype(base_v=None, **macro):
    return apply_targets(load_base().v if base_v is None else base_v, macro_weights(**macro))


# ------------------------------------------------------------------------------------------------ rigs
class Rig:
    pass


def _spec_row(spec, cubes):
    s = spec["strategy"]
    if s == "CUBE":
        ix = np.nonzero(cubes[spec["cube_name"]])[0]
    elif s == "VERTEX":
        ix = np.array([spec["vertex_index"]])
    elif s == "MEAN":
        ix = np.array(spec["vertex_indices"])
    else:
        raise ValueError("unknown joint strategy " + s)
    return ix, np.full(len(ix), 1.0 / len(ix))


@functools.lru_cache(maxsize=None)
def load_rig(name="default"):
    base = load_base()
    rj = json.load(open(os.path.join(DATA, "rigs", "standard", "rig.%s.json" % name)))
    wname = {"default_no_toes": "default"}.get(name, name)
    wj = json.load(open(os.path.join(DATA, "rigs", "standard", "weights.%s.json" % wname)))["weights"]
    # parents before children
    order = []; seen = set()
    def visit(b):
        if b in seen: return
        p = rj[b].get("parent") or ""
        if p: visit(p)
        seen.add(b); order.append(b)
    for b in rj: visit(b)
    r = Rig(); r.name = name; r.bones = order
    ix = {b: i for i, b in enumerate(order)}
    r.parent = np.array([ix[rj[b]["parent"]] if rj[b].get("parent") else -1 for b in order], dtype=np.int64)
    r.roll = np.array([rj[b].get("roll", 0.0) for b in order], dtype=np.float64)
    r.head_spec = [rj[b]["head"] for b in order]; r.tail_spec = [rj[b]["tail"] for b in order]
    B = len(order)
    def regressor(specs):
        rows = []; cols = []; vals = []
        for i, s in enumerate(specs):
            c, w = _spec_row(s, base.vgroups)
            rows += [i] * len(c); cols += list(c); vals += list(w)
        return sp.csr_matrix((vals, (rows, cols)), shape=(B, NV))
    r.Rh = regressor(r.head_spec); r.Rt = regressor(r.tail_spec)
    rows = []; cols = []; vals = []
    for b, pairs in wj.items():
        if b not in ix: continue          # weights for a bone the rig variant does not have (toes): dropped, rows renormalised below
        a = np.array(pairs, dtype=np.float64).reshape(-1, 2)
        rows += list(a[:, 0].astype(np.int64)); cols += [ix[b]] * len(a); vals += list(a[:, 1])
    W = sp.csr_matrix((vals, (rows, cols)), shape=(NV, B)); W.sum_duplicates()
    r.weights = W
    return r


def joint_positions(verts, rig):
    v = np.asarray(verts, dtype=np.float64)
    return rig.Rh @ v, rig.Rt @ v


def bone_frames(heads, tails, roll):
    """Blender's rest bone matrices (columns: x, y along the bone, z) expressed in the glTF frame."""
    out = np.zeros((len(heads), 3, 3))
    to_bl = lambda p: np.stack([p[..., 0], -p[..., 2], p[..., 1]], -1)       # glTF -> Blender (x, -z, y)
    to_gl = lambda p: np.stack([p[..., 0], p[..., 2], -p[..., 1]], -1)
    for i in range(len(heads)):
        y = to_bl(tails[i] - heads[i]); n = np.linalg.norm(y)
        y = y / n if n > 1e-12 else np.array([0, 1.0, 0])
        # Blender's vec_roll_to_mat3 (shortest rotation taking +Y to the bone direction, then roll about it)
        x_, y_, z_ = y
        if 1 + y_ < 1e-6:
            M = np.array([[-1, 0, 0], [0, -1, 0], [0, 0, 1.0]])
        else:
            M = np.array([[1 - x_ * x_ / (1 + y_), -x_, -x_ * z_ / (1 + y_)],
                          [x_, y_, z_],
                          [-x_ * z_ / (1 + y_), -z_, 1 - z_ * z_ / (1 + y_)]]).T
        c, s = np.cos(roll[i]), np.sin(roll[i]); K = np.array([[0, -y[2], y[1]], [y[2], 0, -y[0]], [-y[1], y[0], 0]])
        R = np.eye(3) + s * K + (1 - c) * (K @ K)
        Mb = R @ M
        out[i] = to_gl(Mb.T).T
    return out


def ground_offset(verts, base=None):
    base = base or load_base()
    return float(np.asarray(verts)[base.vgroups["body"], 1].min())


def prune_weights(W, k=4):
    """Top-k influences per vertex, renormalised. Returns (joints int (n,k), weights float32 (n,k)); empty rows -> joint 0, weight 1."""
    if sp.issparse(W):
        W = W.tocsr(); n = W.shape[0]
        J = np.zeros((n, k), dtype=np.int64); Wt = np.zeros((n, k), dtype=np.float64)
        ptr = W.indptr
        for i in range(n):
            a, b = ptr[i], ptr[i + 1]
            if b == a: continue
            d = W.data[a:b]; c = W.indices[a:b]
            o = np.argsort(-d)[:k]
            J[i, :len(o)] = c[o]; Wt[i, :len(o)] = d[o]
    else:
        W = np.asarray(W); o = np.argsort(-W, axis=1)[:, :k]
        J = o.astype(np.int64); Wt = np.take_along_axis(W, o, 1).astype(np.float64)
    Wt[Wt < 0] = 0
    s = Wt.sum(1, keepdims=True); empty = s[:, 0] <= 1e-12
    Wt = Wt / np.where(s > 1e-12, s, 1.0)
    Wt[empty] = 0; Wt[empty, 0] = 1.0; J[empty] = 0
    J[Wt == 0] = 0
    return J, Wt.astype(np.float32)


# ------------------------------------------------------------------------------------------------ geometry
def triangulate(quads, quad_uv=None):
    q = np.asarray(quads)
    t = np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]]], 1).reshape(-1, 3)
    if quad_uv is None: return t
    u = np.asarray(quad_uv)
    return t, np.concatenate([u[:, [0, 1, 2]], u[:, [0, 2, 3]]], 1).reshape(-1, 3)


def smooth_normals(verts, tris):
    v = np.asarray(verts, dtype=np.float64)
    fn = np.cross(v[tris[:, 1]] - v[tris[:, 0]], v[tris[:, 2]] - v[tris[:, 0]])
    n = np.zeros_like(v)
    for k in range(3): np.add.at(n, tris[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-20)


def split_seams(tris, tri_uv):
    """One output vertex per distinct (vertex, uv) pair. Returns vmap, uvmap (per output vertex) and the re-indexed triangles."""
    tris = np.asarray(tris); tri_uv = np.asarray(tri_uv)
    big = int(tri_uv.max()) + 1
    key = tris.ravel() * big + tri_uv.ravel()
    uniq, inv = np.unique(key, return_inverse=True)
    return (uniq // big).astype(np.int64), (uniq % big).astype(np.int64), inv.reshape(-1, 3)


def subdivide(nv, quads, quad_uv=None, n_uv=0):
    """One Catmull-Clark step on a quad mesh (boundaries: edge midpoints, boundary vertices by the 1-6-1 crease rule).
    Returns (S, quads2[, Suv, quad_uv2]): new_verts = S @ verts (S sparse (n2, nv), rows sum to 1), so vertex positions,
    target deltas, skin weights (W2 = S @ W) and anything else linear carry over. UVs are subdivided linearly
    (face centres and edge midpoints, original uv points kept), which keeps seams and islands where they were."""
    q = np.asarray(quads); nf = len(q)
    e = np.stack([q, np.roll(q, -1, 1)], -1).reshape(-1, 2)              # 4 edges per face, face order
    es = np.sort(e, 1); ekey = es[:, 0] * nv + es[:, 1]
    uk, einv, ecount = np.unique(ekey, return_inverse=True, return_counts=True)
    ne = len(uk); ev = np.stack([uk // nv, uk % nv], 1)
    fe = einv.reshape(nf, 4)                                           # edge index of (corner k -> k+1)
    boundary_e = ecount == 1
    # face points
    Fp = sp.csr_matrix((np.full(nf * 4, 0.25), (np.repeat(np.arange(nf), 4), q.ravel())), shape=(nf, nv))
    # edge points
    r = np.repeat(np.arange(ne), 2); Emid = sp.csr_matrix((np.full(ne * 2, 0.5), (r, ev.ravel())), shape=(ne, nv))
    EF = sp.csr_matrix((np.ones(nf * 4), (fe.ravel(), np.repeat(np.arange(nf), 4))), shape=(ne, nf))   # edge-face incidence
    inner = sp.diags((~boundary_e).astype(float)); bnd = sp.diags(boundary_e.astype(float))
    Ep = bnd @ Emid + inner @ (0.5 * Emid + 0.25 * (EF @ Fp))
    # vertex points
    VF = sp.csr_matrix((np.ones(nf * 4), (q.ravel(), np.repeat(np.arange(nf), 4))), shape=(nv, nf))
    VE = sp.csr_matrix((np.ones(ne * 2), (ev.ravel(), r)), shape=(nv, ne))
    nface = np.asarray(VF.sum(1)).ravel(); nedge = np.asarray(VE.sum(1)).ravel()
    vb = np.zeros(nv, dtype=bool); vb[ev[boundary_e].ravel()] = True
    used = nedge > 0
    n = np.maximum(nface, 1)
    I = sp.identity(nv, format="csr")
    Favg = sp.diags(1 / n) @ (VF @ Fp); Ravg = sp.diags(1 / np.maximum(nedge, 1)) @ (VE @ Emid)
    Vin = sp.diags(1 / n) @ Favg + sp.diags(2 / n) @ Ravg + sp.diags((n - 3) / n) @ I
    VEb = sp.csr_matrix((np.ones(int(boundary_e.sum()) * 2), (ev[boundary_e].ravel(), np.repeat(np.nonzero(boundary_e)[0], 2))), shape=(nv, ne))
    Vbd = 0.75 * I + 0.25 * (sp.diags(1 / np.maximum(np.asarray(VEb.sum(1)).ravel(), 1)) @ (VEb @ Emid)) * 1.0
    # 1-6-1: 0.75 v + 0.125 (a + b); VEb@Emid = sum over the 2 boundary edges of (v+other)/2 = v + (a+b)/2 ; /2 -> 0.5 v + 0.25(a+b)
    Vbd = 0.5 * I + 0.5 * (sp.diags(1 / np.maximum(np.asarray(VEb.sum(1)).ravel(), 1)) @ (VEb @ Emid))
    sel_in = sp.diags((used & ~vb).astype(float)); sel_b = sp.diags((used & vb).astype(float)); sel_un = sp.diags((~used).astype(float))
    Vp = sel_in @ Vin + sel_b @ Vbd + sel_un @ I
    S = sp.vstack([Vp, Ep, Fp]).tocsr()
    # new quads: for corner k of face f: [v_k, e(k), face, e(k-1)]
    fidx = nv + ne + np.arange(nf)
    q2 = np.stack([q, nv + fe, np.repeat(fidx[:, None], 4, 1), nv + np.roll(fe, 1, 1)], -1).reshape(-1, 4)
    if quad_uv is None: return S, q2
    u = np.asarray(quad_uv)
    ue = np.stack([u, np.roll(u, -1, 1)], -1).reshape(-1, 2); us = np.sort(ue, 1); ukey = us[:, 0] * n_uv + us[:, 1]
    uuk, uinv = np.unique(ukey, return_inverse=True); nue = len(uuk); uev = np.stack([uuk // n_uv, uuk % n_uv], 1)
    ufe = uinv.reshape(nf, 4)
    UF = sp.csr_matrix((np.full(nf * 4, 0.25), (np.repeat(np.arange(nf), 4), u.ravel())), shape=(nf, n_uv))
    UE = sp.csr_matrix((np.full(nue * 2, 0.5), (np.repeat(np.arange(nue), 2), uev.ravel())), shape=(nue, n_uv))
    Suv = sp.vstack([sp.identity(n_uv, format="csr"), UE, UF]).tocsr()
    ufidx = n_uv + nue + np.arange(nf)
    u2 = np.stack([u, n_uv + ufe, np.repeat(ufidx[:, None], 4, 1), n_uv + np.roll(ufe, 1, 1)], -1).reshape(-1, 4)
    return S, q2, Suv, u2
