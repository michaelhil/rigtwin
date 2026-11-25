"""MakeHuman clothes / proxy binding (.mhclo) for the avatar lab.  Owner: B2.

Everything a dressed character needs from the body: fit an asset to ANY body shape, give it the body's
morph target names (deltas by difference), transfer the painted skin weights, mask the body under it,
add thickness at open borders, and measure penetration.

Units and frame are the core's: metres, glTF frame, the full hm08 vertex array (19,158 rows).
The OBJ files of the packs are in decimetres in the same frame, so v_m = v_obj * 0.1.

The binding, as MakeHuman defines it (read in the files and in MPFB's loader):
  line with 9 numbers:  v1 v2 v3  w1 w2 w3  ox oy oz
      p = w1*B[v1] + w2*B[v2] + w3*B[v3] + (ox*sx, oy*sy, oz*sz)
      s? = |B[a].? - B[b].?| / value      from the header line "?_scale a b value" (value in decimetres)
  line with 1 number:   v            p = B[v]              (exact copy of a body vertex)
The offset is in WORLD axes, so it is only right in the pose the asset was authored in (MakeHuman's
rest pose).  The package rest pose is an A-pose, so `Asset.frames()` turns each offset by the rotation
that the bound triangle underwent between the authoring pose and the package rest pose.
"""
from __future__ import annotations
import os, re
import numpy as np
import scipy.sparse as sp
from scipy.spatial import cKDTree

NV = 19158


# ----------------------------------------------------------------------------------------------- parsing
def read_obj(path):
    """-> v (n,3) metres, faces list[list[int]], uv (m,2), face_uv list[list[int]] (same shape as faces)."""
    v, uv, faces, fuv = [], [], [], []
    with open(path, errors="replace") as f:
        for line in f:
            if line.startswith("v "):
                p = line.split(); v.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("vt "):
                p = line.split(); uv.append((float(p[1]), float(p[2])))
            elif line.startswith("f "):
                a, b = [], []
                for tok in line.split()[1:]:
                    q = tok.split("/")
                    a.append(int(q[0]) - 1)
                    b.append(int(q[1]) - 1 if len(q) > 1 and q[1] else 0)
                faces.append(a); fuv.append(b)
    return np.array(v) * 0.1, faces, np.array(uv) if uv else np.zeros((1, 2)), fuv


def _expand_ranges(tokens):
    out, i = [], 0
    while i < len(tokens):
        if i + 2 < len(tokens) and tokens[i + 1] == "-":
            out.extend(range(int(tokens[i]), int(tokens[i + 2]) + 1)); i += 3
        else:
            out.append(int(tokens[i])); i += 1
    return out


class Asset:
    """One .mhclo / .proxy asset with its mesh."""

    def __init__(self, mhclo_path):
        self.path = mhclo_path
        self.dir = os.path.dirname(mhclo_path)
        self.name = os.path.splitext(os.path.basename(mhclo_path))[0]
        self.scale = {}                      # axis -> (a, b, value_dm)
        self.material_file = None
        self.z_depth = 50
        idx, w, off = [], [], []
        delete = []
        obj_file = None
        mode = "head"
        with open(mhclo_path, errors="replace") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                p = line.split()
                k = p[0]
                if not re.match(r"^-?\d+$", k):
                    if k == "verts": mode = "verts"
                    elif k == "delete_verts": mode = "delete"
                    elif k == "obj_file": obj_file = line.split(None, 1)[1]
                    elif k in ("x_scale", "y_scale", "z_scale"): self.scale[k[0]] = (int(p[1]), int(p[2]), float(p[3]))
                    elif k == "material": self.material_file = line.split(None, 1)[1]
                    elif k == "z_depth": self.z_depth = int(p[1])
                    elif k == "name": self.title = line.split(None, 1)[1]
                    continue
                if mode == "verts":
                    if len(p) == 1:
                        i = int(p[0]); idx.append((i, i, i)); w.append((1.0, 0.0, 0.0)); off.append((0.0, 0.0, 0.0))
                    elif len(p) >= 9:
                        idx.append((int(p[0]), int(p[1]), int(p[2]))); w.append((float(p[3]), float(p[4]), float(p[5])))
                        off.append((float(p[6]), float(p[7]), float(p[8])))
                elif mode == "delete":
                    delete.extend(_expand_ranges(p))
        self.idx = np.array(idx, dtype=np.int64); self.w = np.array(w); self.off = np.array(off)
        self.delete = np.zeros(NV, bool)
        if delete: self.delete[np.array([d for d in delete if d < NV], dtype=np.int64)] = True
        self.v_obj, self.faces, self.uv, self.face_uv = read_obj(os.path.join(self.dir, obj_file))
        if len(self.v_obj) != len(self.idx):
            raise ValueError(f"{self.name}: {len(self.v_obj)} obj vertices but {len(self.idx)} bindings")
        self.n = len(self.idx)
        self.R = None                         # per-vertex rotation authoring pose -> package rest (set by frames())
        self.textures = self._textures()

    def _textures(self):
        out = {}
        mf = os.path.join(self.dir, self.material_file) if self.material_file else None
        if mf and os.path.exists(mf):
            for line in open(mf, errors="replace"):
                m = re.match(r"\s*(\w+)Texture\s+(.+)$", line)
                if m: out[m.group(1)] = os.path.normpath(os.path.join(os.path.dirname(mf), m.group(2).strip()))
        return out

    # ------------------------------------------------------------------------------------------- fitting
    def _scales(self, B):
        s = np.ones(3)
        for ax, k in (("x", 0), ("y", 1), ("z", 2)):
            if ax in self.scale:
                a, b, val = self.scale[ax]
                s[k] = abs(B[a, k] - B[b, k]) * 10.0 / val        # B in metres, value in decimetres
        return s

    def fit_authoring(self, B):
        """MakeHuman's own formula; right only when B is in the authoring (MakeHuman rest) pose."""
        p = (B[self.idx] * self.w[:, :, None]).sum(1)
        return p + self.off * self._scales(B) * 0.1

    def frames(self, B_author, B_rest):
        """Record how each bound triangle turned from the authoring pose to the package rest pose, and the
        scale references of the authoring pose (pose changes must not change the scales; shape changes do,
        by the ratio measured on the rest-pose body against the rest-pose base)."""
        self.R = _tri_rotation(B_author[self.idx], B_rest[self.idx])
        self._s_author = self._scales(B_author)
        self._s_rest = self._scales(B_rest)
        return self

    def fit(self, B):
        """Asset vertices for body B (19158,3) given in the package rest pose (any shape)."""
        if self.R is None:
            return self.fit_authoring(B)
        p = (B[self.idx] * self.w[:, :, None]).sum(1)
        s = self._s_author * (self._scales(B) / self._s_rest)
        return p + np.einsum("nij,nj->ni", self.R, self.off * s * 0.1)

    def morphs(self, base_v, targets: dict, post=None):
        """name -> (n,3) delta, the same names as the body's targets. `post(g, B)` may finish the fit
        (clearance push, rims); it is applied to the base and to every target, deltas by difference."""
        g0 = self.fit(base_v)
        if post: g0 = post(g0, base_v)
        out = {}
        for name, d in targets.items():
            B = base_v + d
            g = self.fit(B)
            if post: g = post(g, B)
            out[name] = g - g0
        return g0, out

    def weights(self, W):
        """Skin weights from the bound body vertices (barycentric weights clipped to >= 0 and renormalised).
        W: sparse (19158,B). -> sparse csr (n,B)."""
        w = np.clip(self.w, 0.0, None); w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
        rows = np.repeat(np.arange(self.n), 3)
        T = sp.csr_matrix((w.ravel(), (rows, self.idx.ravel())), shape=(self.n, W.shape[0]))
        return (T @ W).tocsr()

    def tris(self):
        t, tu = [], []
        for f, fu in zip(self.faces, self.face_uv):
            for k in range(1, len(f) - 1):
                t.append((f[0], f[k], f[k + 1])); tu.append((fu[0], fu[k], fu[k + 1]))
        return np.array(t, dtype=np.int64), np.array(tu, dtype=np.int64)


def _tri_frame(P):
    """P (n,3,3) triangle corners -> orthonormal frames (n,3,3) (columns e1, e2, n). Degenerate -> identity."""
    e1 = P[:, 1] - P[:, 0]; e2 = P[:, 2] - P[:, 0]
    n = np.cross(e1, e2)
    l1 = np.linalg.norm(e1, axis=1); ln = np.linalg.norm(n, axis=1)
    ok = (l1 > 1e-9) & (ln > 1e-12)
    e1 = e1 / np.maximum(l1, 1e-12)[:, None]; n = n / np.maximum(ln, 1e-12)[:, None]
    b = np.cross(n, e1)
    F = np.stack([e1, b, n], axis=2)
    F[~ok] = np.eye(3)
    return F, ok


def _tri_rotation(Pa, Pb):
    Fa, oka = _tri_frame(Pa); Fb, okb = _tri_frame(Pb)
    R = np.einsum("nij,nkj->nik", Fb, Fa)
    R[~(oka & okb)] = np.eye(3)
    return R


# ----------------------------------------------------------------------------------------------- topology helpers
def boundary_loops(tris, n):
    """Open border edges as ordered vertex loops (list of int arrays)."""
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    key = np.minimum(e[:, 0], e[:, 1]) * n + np.maximum(e[:, 0], e[:, 1])
    uniq, cnt = np.unique(key, return_counts=True)
    border = set(uniq[cnt == 1].tolist())
    nxt = {}
    for a, b in e:
        if min(a, b) * n + max(a, b) in border: nxt.setdefault(int(a), []).append(int(b))
    loops, seen = [], set()
    for start in list(nxt):
        if start in seen: continue
        loop, cur = [start], start; seen.add(start)
        while True:
            cand = [b for b in nxt.get(cur, []) if b not in seen]
            if not cand: break
            cur = cand[0]; seen.add(cur); loop.append(cur)
        if len(loop) >= 3: loops.append(np.array(loop))
    return loops


def weld(v, tris, tol=1e-5):
    """Merge coincident vertices (many pack meshes are split along UV seams). -> vmap (n,) old->welded, tris_w."""
    tree = cKDTree(v)
    pairs = tree.query_pairs(tol, output_type="ndarray")
    parent = np.arange(len(v))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for a, b in pairs:
        ra, rb = find(a), find(b)
        if ra != rb: parent[max(ra, rb)] = min(ra, rb)
    root = np.array([find(i) for i in range(len(v))])
    return root, root[tris]


def components(tris, n):
    """Connected components over triangles -> label per vertex (unused vertices get -1)."""
    g = sp.coo_matrix((np.ones(len(tris) * 2), (np.r_[tris[:, 0], tris[:, 1]], np.r_[tris[:, 1], tris[:, 2]])), shape=(n, n))
    k, lab = sp.csgraph.connected_components(g, directed=False)
    used = np.zeros(n, bool); used[tris.ravel()] = True
    lab = lab.copy(); lab[~used] = -1
    return lab


def vertex_normals(v, tris):
    fn = np.cross(v[tris[:, 1]] - v[tris[:, 0]], v[tris[:, 2]] - v[tris[:, 0]])
    n = np.zeros_like(v)
    for k in range(3): np.add.at(n, tris[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def _loop_smooth(a, passes=2):
    for _ in range(passes):
        a = 0.25 * np.roll(a, 1, 0) + 0.5 * a + 0.25 * np.roll(a, -1, 0)
    return a


class Rim:
    """Real edge geometry at open borders (collar, cuffs, hems, waist): each border loop is turned inward
    through the cloth thickness and then run back along the inside in several rings, so the eye sees a cloth
    edge with darkness behind it, never a paper cut or a skin cut line.
    rings: ((depth along the inverse normal, lap along the inside), ...) in metres.
    Normal and inward direction are smoothed along the loop, so a ragged border does not pleat the lip.
    The new vertices are recomputed from the fitted garment on every fit, so they follow every morph; skin
    weights are their border parents'."""

    def __init__(self, v, tris, tri_uv, rings=((0.0025, 0.0), (0.003, 0.010), (0.0035, 0.022)), min_loop=12, keep=None, lap_scale=None):
        n = len(v)
        root, tw = weld(v, tris)
        loops = [l for l in boundary_loops(tw, n) if len(l) >= min_loop]
        if keep is not None: loops = [l for l in loops if keep(v[l])]
        nb = [[] for _ in range(n)]
        for a, b, c in tw:
            nb[a] += [b, c]; nb[b] += [a, c]; nb[c] += [a, b]
        uvi = np.zeros(n, dtype=np.int64); uvi[tw.ravel()] = tri_uv.ravel()
        self.rings, self.n0, self.root, self.tw = rings, n, root, tw
        self.loops, self.inner, new_tris, new_uv, parent = [], [], [], [], []
        self.lap_k = [float(lap_scale(v[l])) if lap_scale else 1.0 for l in loops]      # per loop: a shorter lip where something else fills the opening
        base = n; K = len(rings)
        for loop in loops:
            L = len(loop); on = set(loop.tolist())
            self.loops.append(loop)
            self.inner.append([np.array([b for b in nb[a] if b not in on] or [a]) for a in loop])
            ring = [loop] + [base + k * L + np.arange(L) for k in range(K)]
            for k in range(K):
                r0, r1 = ring[k], ring[k + 1]
                for i in range(L):
                    j = (i + 1) % L
                    new_tris += [(r0[j], r0[i], r1[i]), (r0[j], r1[i], r1[j])]
                    ua, ub = uvi[loop[i]], uvi[loop[j]]
                    new_uv += [(ub, ua, ua), (ub, ua, ub)]
            parent += loop.tolist() * K
            base += K * L
        self.parent = np.array(parent, dtype=np.int64)
        self.count = len(self.parent)
        self.new_tris = np.array(new_tris, dtype=np.int64).reshape(-1, 3)
        self.new_tri_uv = np.array(new_uv, dtype=np.int64).reshape(-1, 3)
        self.border = np.concatenate(self.loops) if self.loops else np.zeros(0, dtype=np.int64)

    def tris(self, tris, tri_uv):
        if not self.count: return tris, tri_uv
        return np.vstack([tris, self.new_tris]), np.vstack([tri_uv, self.new_tri_uv])

    def apply(self, g):
        if not self.count: return g
        nrm = vertex_normals(g, self.tw)
        out = [g]
        for loop, inner, lk in zip(self.loops, self.inner, self.lap_k):
            p = g[loop]; n = _loop_smooth(nrm[loop]); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
            t = np.array([g[c].mean(0) for c in inner]) - p
            t -= n * (t * n).sum(1, keepdims=True)
            t = _loop_smooth(t / np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9), 3)
            t -= n * (t * n).sum(1, keepdims=True); t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
            for k, (depth, lap) in enumerate(self.rings):
                out.append(_loop_smooth(p - n * depth + t * lap * lk, 1 if k == 0 else 3))      # the lip is an even band, whatever the border does
        return np.vstack(out)

    def weights(self, Wg):
        if not self.count: return Wg
        return sp.vstack([Wg, Wg[self.parent]]).tocsr()


# ----------------------------------------------------------------------------------------------- penetration
class Surface:
    """A triangle surface for signed-distance queries (nearest vertex + its normal plane, refined on the
    triangles around the nearest vertices). Good to about a millimetre near the surface, which is where
    it is used."""

    def __init__(self, v, tris):
        self.v, self.tris = v, tris
        used = np.unique(tris)
        self.used = used
        self.tree = cKDTree(v[used])
        self.n = vertex_normals(v, tris)
        self.vt = [[] for _ in range(len(v))]
        for t, (a, b, c) in enumerate(tris):
            self.vt[a].append(t); self.vt[b].append(t); self.vt[c].append(t)

    def signed(self, p, k=3, maxd=0.05):
        """-> signed distance (n,) (positive outside), nearest point (n,3). Points farther than maxd get +maxd."""
        d, i = self.tree.query(p, k=k, distance_upper_bound=maxd)
        out = np.full(len(p), maxd); near = np.zeros_like(p)
        v, tris = self.v, self.tris
        for q in range(len(p)):
            if not np.isfinite(d[q, 0]): continue
            ts = set()
            for j in i[q]:
                if j < len(self.used): ts.update(self.vt[self.used[j]])
            ts = np.fromiter(ts, dtype=np.int64)
            c = _closest_on_tris(p[q], v[tris[ts, 0]], v[tris[ts, 1]], v[tris[ts, 2]])
            dd = np.linalg.norm(c - p[q], axis=1); m = dd.argmin()
            a, b, cc = tris[ts[m]]
            fn = np.cross(v[b] - v[a], v[cc] - v[a]); fn /= max(np.linalg.norm(fn), 1e-12)
            # sign from the smooth normal at the closest point's nearest vertex (stable at creases)
            nv = self.n[self.used[i[q, 0]]]
            s = np.dot(p[q] - c[m], nv if dd[m] > 1e-6 else fn)
            out[q] = dd[m] if s >= 0 else -dd[m]; near[q] = c[m]
        return out, near


def _closest_on_tris(p, a, b, c):
    """Closest points on triangles (Ericson). p (3,), a,b,c (m,3) -> (m,3)."""
    ab, ac, ap = b - a, c - a, p - a
    d1 = (ab * ap).sum(1); d2 = (ac * ap).sum(1)
    bp = p - b; d3 = (ab * bp).sum(1); d4 = (ac * bp).sum(1)
    cp = p - c; d5 = (ab * cp).sum(1); d6 = (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4; vb = d5 * d2 - d1 * d6; vc = d1 * d4 - d3 * d2
    den = np.where(np.abs(va + vb + vc) < 1e-20, 1e-20, va + vb + vc)
    v = vb / den; w = vc / den
    out = a + ab * v[:, None] + ac * w[:, None]
    m = (d1 <= 0) & (d2 <= 0); out[m] = a[m]
    m2 = (d3 >= 0) & (d4 <= d3); out[m2] = b[m2]
    m3 = (d6 >= 0) & (d5 <= d6); out[m3] = c[m3]
    e = (vc <= 0) & (d1 >= 0) & (d3 <= 0) & ~(m | m2 | m3)
    t = d1 / np.where(np.abs(d1 - d3) < 1e-20, 1e-20, d1 - d3); out[e] = (a + ab * t[:, None])[e]
    e2 = (vb <= 0) & (d2 >= 0) & (d6 <= 0) & ~(m | m2 | m3 | e)
    t = d2 / np.where(np.abs(d2 - d6) < 1e-20, 1e-20, d2 - d6); out[e2] = (a + ac * t[:, None])[e2]
    e3 = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0) & ~(m | m2 | m3 | e | e2)
    den2 = (d4 - d3) + (d5 - d6); t = (d4 - d3) / np.where(np.abs(den2) < 1e-20, 1e-20, den2)
    out[e3] = (b + (c - b) * t[:, None])[e3]
    return out


def penetration(inner: Surface, outer_v, clearance=0.0):
    """How far the points of an outer layer sit inside an inner surface. -> dict(count, worst_mm, p95_mm, depth (n,))"""
    d, _ = inner.signed(outer_v)
    depth = np.clip(clearance - d, 0, None)
    bad = depth > 1e-6
    return {"count": int(bad.sum()), "of": int(len(outer_v)), "worst_mm": float(depth.max() * 1000) if len(depth) else 0.0,
            "p95_mm": float(np.percentile(depth[bad], 95) * 1000) if bad.any() else 0.0, "depth": depth}


def push_out(inner: Surface, g, clearance, iters=2, cap=0.03):
    """Move the points of g that are closer than `clearance` to (or inside) the inner surface out along the
    inner surface's direction, by at most `cap`."""
    g = g.copy()
    for _ in range(iters):
        d, near = inner.signed(g)
        bad = d < clearance
        if not bad.any(): break
        dirn = g[bad] - near[bad]
        sgn = np.where(d[bad] >= 0, 1.0, -1.0)[:, None]
        ln = np.linalg.norm(dirn, axis=1, keepdims=True)
        dirn = np.where(ln > 1e-7, dirn / np.maximum(ln, 1e-12) * sgn, 0.0)
        g[bad] += dirn * np.minimum(clearance - d[bad], cap)[:, None]
    return g


def body_mask_faces(quads_or_tris, delete):
    """Faces to KEEP: those with no deleted vertex (MakeHuman hides a face when any of its vertices is deleted)."""
    return ~delete[quads_or_tris].any(1)


# ----------------------------------------------------------------------------------------------- edges and layers
def smooth_field(val, tris, iters=3, keep_max=True):
    """Laplacian smoothing of a per-vertex scalar over a mesh; with keep_max the result never drops below the input
    (a displacement that must be reached stays reached, its surroundings follow gently)."""
    n = len(val)
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e) * 2), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    A.data[:] = 1.0
    deg = np.maximum(np.asarray(A.sum(1)).ravel(), 1)
    out = val.copy()
    for _ in range(iters):
        sm = 0.5 * out + 0.5 * (A @ out) / deg
        out = np.maximum(sm, val) if keep_max else sm
    return out


def clearance(g, tris, inner_v, inner_tris, reach=0.035, facing=0.2, lateral_max=0.02):
    """Clearance of an outer layer's vertices above an inner surface, measured only against inner points that face
    the same way as the cloth (an arm never counts against the flank, one leg never against the other).
    -> has (n,) bool, c (n,) metres (negative = the inner surface is outside the cloth there), ng (n,3) cloth normals"""
    root, tw = weld(g, tris)
    ng = vertex_normals(g, tw)[root]
    used = np.unique(inner_tris); tree = cKDTree(inner_v[used]); ni = vertex_normals(inner_v, inner_tris)
    d, i = tree.query(g, k=8, distance_upper_bound=reach)
    ok = np.isfinite(d); j = used[np.where(ok, i, 0)]
    rel = g[:, None, :] - inner_v[j]; nin = ni[j]
    same = (nin * ng[:, None, :]).sum(2) > facing
    along = (rel * nin).sum(2)
    lat = np.linalg.norm(rel - nin * along[..., None], axis=2)
    valid = ok & same & (lat < lateral_max)
    best = np.where(valid, lat, np.inf).argmin(1); r = np.arange(len(g))
    return valid[r, best], along[r, best], ng, (root, tw)


def clear_outside(g, tris, inner_v, inner_tris, clear, zone=None, reach=0.035, facing=0.2, iters=4, cap=0.03):
    """Keep an outer layer `g` at least `clear` outside an inner surface (skin at an opening, a boot shaft under a
    hem, trousers under a shirt), structurally: the missing clearance (see `clearance`) is spread smoothly over
    the cloth and the cloth moves along its OWN smooth normal, so no vertex is ever thrown to the wrong side and
    no edge is crumpled. zone: optional per-vertex weight 0..1 (1 at an opening, 0 a few cm inside)."""
    has, c, ng, (root, tw) = clearance(g, tris, inner_v, inner_tris, reach, facing)
    part = np.zeros(len(g), bool); part[np.unique(tris)] = True
    need = np.where(has & part, np.clip(clear - c, 0, cap), 0.0)
    if zone is not None: need = need * zone
    if need.any(): need = smooth_field(need[root] if False else need, tw, iters)
    return g + ng * need[:, None], {"moved": int((need > 1e-5).sum()), "max_mm": float(need.max() * 1000)}


def opening_zone(g, border_idx, width=0.04):
    """1 at an open border, falling smoothly to 0 `width` away from it (Euclidean, on the fitted garment)."""
    if len(border_idx) == 0: return np.zeros(len(g))
    d, _ = cKDTree(g[border_idx]).query(g)
    x = np.clip(1 - d / width, 0, 1)
    return x * x * (3 - 2 * x)


def coverage(body_v, body_normals, body_idx, samples, reach=0.045, lateral=0.016):
    """Which body vertices lie under a garment: a garment sample point exists in front of the vertex (along its
    normal, up to `reach`) within `lateral` of the normal line. -> bool (len(body_v),), False outside body_idx."""
    tree = cKDTree(samples)
    cov = np.zeros(len(body_v), bool)
    lists = tree.query_ball_point(body_v[body_idx], reach)
    for b, li in zip(body_idx, lists):
        if not li: continue
        rel = samples[li] - body_v[b]; al = rel @ body_normals[b]
        lat = np.linalg.norm(rel - np.outer(al, body_normals[b]), axis=1)
        cov[b] = bool(((al > -0.004) & (lat < lateral)).any())
    return cov


def hide_distance(body_v, body_tris, covered, min_island=120):
    """Geodesic distance (metres, along the body surface) of every covered body vertex from the nearest uncovered
    one: 0 at and outside the garment's opening, growing inward. Small uncovered islands under the cloth (holes
    of the coverage test) are treated as covered."""
    n = len(body_v)
    e = np.concatenate([body_tris[:, [0, 1]], body_tris[:, [1, 2]], body_tris[:, [2, 0]]])
    w = np.linalg.norm(body_v[e[:, 0]] - body_v[e[:, 1]], axis=1)
    G = sp.coo_matrix((w, (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()
    used = np.zeros(n, bool); used[np.unique(body_tris)] = True
    unc = used & ~covered
    # drop small uncovered islands
    sub = G[unc][:, unc]; k, lab = sp.csgraph.connected_components(sub, directed=False)
    size = np.bincount(lab, minlength=k); idx = np.flatnonzero(unc)
    unc[idx[size[lab] < min_island]] = False
    src = np.flatnonzero(unc)
    d = sp.csgraph.dijkstra(G, directed=False, indices=src, min_only=True, limit=0.2)
    d[~np.isfinite(d)] = 0.2
    d[~used] = 0.0
    return d


def raster_scalar(uv, tri_uv, tri_v, values, size, pad=8):
    """Per-vertex scalar -> (size,size) float image in UV space, linearly interpolated inside each triangle (so an
    iso-line of the image is a smooth curve that does not follow the triangle edges), then extended `pad` texels
    past the island borders. Texels no triangle reaches are NaN."""
    img = np.full((size, size), np.nan, np.float32)
    P = uv[tri_uv] * np.array([size, size]); P[..., 1] = size - P[..., 1]
    V = values[tri_v]
    for t in range(len(tri_uv)):
        (x0, y0), (x1, y1), (x2, y2) = P[t]
        xa = max(int(np.floor(min(x0, x1, x2) - 0.5)), 0); xb = min(int(np.ceil(max(x0, x1, x2) + 0.5)), size - 1)
        ya = max(int(np.floor(min(y0, y1, y2) - 0.5)), 0); yb = min(int(np.ceil(max(y0, y1, y2) + 0.5)), size - 1)
        if xb < xa or yb < ya: continue
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-12: continue
        xs, ys = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
        l0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / den
        l1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / den
        l2 = 1 - l0 - l1
        m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if m.any():
            sub = img[ya:yb + 1, xa:xb + 1]
            sub[m] = (l0 * V[t, 0] + l1 * V[t, 1] + l2 * V[t, 2])[m]
    if pad:
        from scipy import ndimage
        nan = np.isnan(img)
        dist, (iy, ix) = ndimage.distance_transform_edt(nan, return_indices=True)
        near = img[iy, ix]
        img = np.where(nan & (dist <= pad), near, img)
    return img


# ----------------------------------------------------------------------------------------------- binding new meshes
def bind_mesh(name, v, tris, body_v, body_tris, uv=None, tri_uv=None, mode="nearest", scale=None, hide=None):
    """Bind a NEW mesh (a modelled prop or garment: headset, belt, collar, sole) to the body exactly as a .mhclo
    does, so `fit`, `morphs`, `weights` and everything in build_operator treat it like a pack asset.
      v (n,3): the mesh in the authoring pose of the body it was modelled on (metres, glTF frame), body_v (19158,3)
      that body; tris (t,3); uv (m,2) + tri_uv (t,3) optional.
      mode "nearest": every vertex follows its own nearest body triangle (cloth, straps, anything that should hug).
      mode "rigid":   the whole mesh follows ONE body triangle (nearest to its centroid) and scales with the
                      head/body scale references: hard parts keep their shape (ear cup, buckle, sole).
      scale: {"x": (a, b), "y": (a, b), "z": (a, b)} body vertex pairs whose distance scales the offsets; default
             the MakeHuman head references 5399-11998 (x), 791-881 (y), 962-5320 (z). None values = no scaling.
      hide (19158,) bool: body vertices this part covers completely (optional; the per-pixel mask is preferred).
    -> Asset"""
    a = object.__new__(Asset)
    a.path = None; a.dir = None; a.name = name; a.title = name; a.material_file = None; a.z_depth = 50; a.textures = {}; a.R = None
    used = np.unique(body_tris); tree = cKDTree(body_v[used])
    vt = {}
    for t, tri in enumerate(body_tris):
        for q in tri: vt.setdefault(int(q), []).append(t)
    def closest(p):
        _, i = tree.query(p, k=4)
        ts = np.unique(np.concatenate([vt[int(used[j])] for j in np.atleast_1d(i)]))
        A, B, C = body_v[body_tris[ts, 0]], body_v[body_tris[ts, 1]], body_v[body_tris[ts, 2]]
        c = _closest_on_tris(p, A, B, C); m = np.linalg.norm(c - p, axis=1).argmin()
        T = np.array([B[m] - A[m], C[m] - A[m]]).T
        l, *_ = np.linalg.lstsq(T, c[m] - A[m], rcond=None)
        return body_tris[ts[m]], np.array([1 - l[0] - l[1], l[0], l[1]])
    n = len(v); idx = np.zeros((n, 3), dtype=np.int64); w = np.zeros((n, 3))
    if mode == "rigid":
        tri, bw = closest(v.mean(0)); idx[:] = tri; w[:] = bw
    else:
        for q in range(n): idx[q], w[q] = closest(v[q])
    a.idx, a.w = idx, w
    sc = {"x": (5399, 11998), "y": (791, 881), "z": (962, 5320)} if scale is None else scale
    a.scale = {}
    for ax, k in (("x", 0), ("y", 1), ("z", 2)):
        if sc.get(ax):
            p, q = sc[ax]; a.scale[ax] = (p, q, abs(body_v[p, k] - body_v[q, k]) * 10.0)      # value = today's distance: scale 1 now
    a.off = (v - (body_v[idx] * w[:, :, None]).sum(1)) * 10.0
    a.delete = np.zeros(NV, bool) if hide is None else np.asarray(hide, bool)
    a.v_obj = v.copy(); a.faces = [list(map(int, t)) for t in tris]; a.n = n
    a.uv = uv if uv is not None else np.zeros((1, 2)); a.face_uv = [list(map(int, t)) for t in tri_uv] if tri_uv is not None else [[0, 0, 0]] * len(tris)
    return a


def propagate_to_helpers(base_v, delta, body_n=13380, k=4):
    """Give helper vertices (lash and eye helpers, tights ...) the movement of the skin next to them, for a morph
    that was authored on the skin only (e.g. a lid-closing morph): inverse-distance blend of the k nearest skin
    vertices' deltas. Returns a dense (19158,3) delta; skin rows are unchanged."""
    out = np.array(delta, dtype=np.float64).copy()
    moved = np.flatnonzero(np.abs(out[:body_n]).max(1) > 1e-7)
    if not len(moved): return out
    tree = cKDTree(base_v[:body_n])
    reach = 0.02
    helpers = np.arange(body_n, len(base_v))
    d, i = tree.query(base_v[helpers], k=k, distance_upper_bound=reach)
    ok = np.isfinite(d); w = np.where(ok, 1.0 / np.maximum(d, 1e-4), 0.0); ws = w.sum(1)
    has = ws > 0
    blend = (out[np.where(ok, i, 0)] * w[..., None]).sum(1) / np.maximum(ws, 1e-9)[:, None]
    untouched = np.abs(out[helpers]).max(1) < 1e-7
    out[helpers[has & untouched]] = blend[has & untouched]
    return out


def follow_main(before, after, tris, min_main=0.5):
    """After a smooth correction moved a garment, make its small detached pieces (buttons, pocket flaps, belt loops)
    ride on the main piece: each takes the displacement of the nearest vertex of the largest connected component.
    Without this the main cloth is pushed through the details sewn onto it."""
    root, tw = weld(before, tris); lab = components(tw, len(before))[root]
    ids, cnt = np.unique(lab[lab >= 0], return_counts=True)
    if len(ids) < 2: return after
    main = ids[cnt.argmax()]
    mi = np.flatnonzero(lab == main); oi = np.flatnonzero((lab >= 0) & (lab != main))
    _, j = cKDTree(before[mi]).query(before[oi])
    out = after.copy(); out[oi] = before[oi] + (after[mi[j]] - before[mi[j]])
    return out
