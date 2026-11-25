"""Hair under the cap (owner: B9, 2026-11-25): the woman's hair as ONE opaque, sculpted piece made for the work cap.

    import hair_cap
    hp = hair_cap.build(c, e, pre, tone=tone, sex=sex, out=out)   # None for the man (his painted fade stays as it is)
    pre.append(hp.mesh); mats.update(hp.materials); classes.update(hp.classes)
    ... slots["hair"] = [hp.garment]; man["licence"].append(hp.licence)

What it is: a low bun just below the cap's back rim (a full, round mound, the hair wrapped round it), and the hair of the
back, the sides and the temples pulled back into it: a shell of real thickness (to 9 mm where it gathers into the bun)
lying on the scalp from the hairline (nape, round the ear, the temples' front edge) up under the cap. Opaque everywhere;
alpha only in a 4 mm fringe of single strands at the hairline, whose ends scatter so the cut is a finely uneven line. The
skin's own painted hairline (B2's) is left as it is and shows through the fringe.

How it is fitted, per shape target, with the cap:
  * the shell is a regular 9 mm grid on the head (rays from the head's axis), each point bound to the body triangle it lies
    on (barycentric, like a .mhclo with normal offsets), cut along a smooth hairline field; on each target it is rebuilt from
    that target's body, then held inside that target's cap (rays along the normal; under the cap's edges and folded band a
    cone), under the headset cushion and under the glasses arms (a cone under every point of them);
  * the bun is a stiff thing like the cap: on each target it takes the least-squares affine map of the cap's own vertices
    (B2's stiff_fit makes the cap an affine image of the authored cap per body), so bun and cap keep their relation on every
    body and every mix of targets (the map is linear in the target weights);
  * skinning: the skin's own weights under the shell (RR's full weights interpolated: the 8-influence set; RR's 4-influence
    fit in JOINTS_0 / WEIGHTS_0; `_DQS`), the cap's head-only skinning on the bun, next to it and under the cap's rim;
  * the scalp under the opaque part is hidden by a body mask (FORMAT.md 2b), cut 4 mm inside the start of the fringe.

Material: class `hair` (the viewer's recipe, viewer/src/materials.ts: anisotropic highlight, alpha-to-coverage), one draw
call; base colour + alpha 1024 (neutral grey strand shading, the tone's colour is the factor), strand normal map 512,
occlusion-roughness 256 (7.3 MB on the GPU); TANGENT carries the strand direction (the recipe turns the highlight by 90
degrees, so it runs across the strands).

All numbers are in P below, each with its range and where it comes from.  Nothing here downloads anything.
"""
import sys, os, math, json, gzip, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spl
from scipy.spatial import cKDTree
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); LAB = __import__("labpaths").LAB
CACHE = os.path.join(LAB, "B9", "cache")
DEBUG = None              # a dict to receive intermediate fields (tests only)

# Hair colour per skin tone: B2's TONES["hair"] (sRGB), times the woman's factor B2 paints her scalp with (1.45), so the
# piece and the painted hairline under its fringe are one colour.  Kept here as B2's numbers (build_operator.TONES).
TONES = {"light": (44, 33, 27), "medium": (30, 23, 19), "dark": (16, 13, 12)}
PAINT_GAIN = 1.45          # B2: hrgb = 1.45 x TONES[tone]["hair"] for the woman's painted scalp

P = dict(
    # ---- where the hair is (metres, degrees; rest pose, bare-sole frame as B2's build holds it before the lift)
    front_az=(62.0, 84.0),      # the piece fades in between these azimuths from the front (B2's paint: 45-70; range 55-90): the temples stay painted
    scalp_cut=0.62,             # hairline = this iso-line of MPFB's authored scalp region, smoothed (range 0.4-0.6)
    scalp_blur=6,               # smoothing passes on that region (range 2-8; ~8 mm a pass on the back of the head)
    nape_drop=0.004,            # the nape hairline sits this much lower on the mid-line than behind the ears (range 0-15 mm)
    temple_z=(0.030, 0.025, 0.020, 0.018),   # front edge of the temple hair: this far behind the eyes' centre, at 20 and 8 mm below eye height, 6 and 30 mm above (range 18-40 mm)
    behind_ear=0.010,           # behind the ear the hairline is this far above the ear's lowest point (range 5-20 mm)
    sideburn=(-0.012, 0.45),    # lower edge of the hair in front of the ear: the ear's middle height plus this, rising by the second value per metre forward
    ear_clear=(0.0015, 0.0045),  # the piece keeps this far from the ear (B7's ear mask): 0 inside the first, 1 beyond the second
    under_cap=0.016,            # the shell runs this far up under the cap's rim, then ends unseen (range 0.010-0.025)
    # ---- thickness of the shell over the skin (metres)
    t_back=0.0048,              # at the back (range 3-7 mm: pulled-back shoulder-length hair)
    t_side=0.0030,              # behind and above the ear (range 2-4 mm)
    t_front=0.0016,             # at its front edge above the ear (range 1-2 mm)
    t_gather=0.0042,            # extra where the hair gathers into the bun (range 2-6 mm)
    gather_r=0.034,             # ... fading out over this distance from the bun's rim (range 20-50 mm)
    bridge=0.8,                 # share of the skin's hollow that the hair bridges (range 0-1)
    bridge_max=0.006,           # ... at most (metres)
    t_edge=0.0006,              # at the hairline itself (range 0.3-1 mm: above the skin's depth precision at 1.2 m)
    taper=0.013,                # thickness tapers to t_edge over this distance inside the hairline (range 8-20 mm)
    fringe=0.0040,              # width of the strand fringe at the hairline (alpha), metres (range 3-8 mm: a soft hairline)
    rim_slope=0.25,             # below the cap's edges the hair may rise this much per mm away from them (range 0.2-0.6)
    rim_extra=0.0010,           # ... and stays this much further in at them (the cap's folded edge band; range 0.5-2 mm)
    cap_in=0.0015,              # the shell stays this far inside the cap (range 1-2 mm)
    cushion_keep=0.0012,        # under the headset cushion the shell keeps at least this (hidden inside the cushion; range 0.5-2 mm)
    cushion_clear=0.0005,       # ... else it stays this far under the cushion
    glasses_clear=0.0008,       # the glasses arm stays this far above the hair (range 0.5-1.5 mm)
    # ---- the bun (metres; its own frame at the anchor: e1 left, e2 up along the skull, e3 out along the normal)
    bun_gap=0.0070,             # top of the bun below the cap's back rim (range 5-12 mm: the strap stays clear)
    bun_a=0.0315,               # half width (range 26-36 mm)
    bun_b=0.0265,               # half height (range 22-30 mm): a bun of about 63 x 53 mm
    bun_h=0.0255,               # how far it stands out from the skull (range 20-32 mm)
    bun_p=2.5,                  # superellipse exponent of its profile (2: a half ellipsoid; range 2-2.8: fuller sides)
    seat=0.0035,                # its rim sinks this far into the shell (range 2-5 mm)
    bun_steps=(32, 8),          # around x from rim to top (range 32-48, 8-12): 612 triangles
    bun_row_mm=0.08,            # across-strand texel on the bun (range 0.06-0.12: with one texture period per turn, a 25-degree climb)
    twist_turn=1,               # texture periods across the strands per turn round the bun (an integer: seamless)
    field_smooth=4,             # passes over the hair field on the grid before the hairline is taken from it (range 2-8)
    cut_out=0.12,               # the mesh ends where the field is this far below the hairline's level (2-3 mm out; clear there)
    mask_in=0.004,              # the scalp is hidden from this far inside the start of the fringe (range 3-8 mm; it must end under opaque hair)
    grid_mm=9.0,                # the shell's mesh spacing (range 6-10 mm: about 700 triangles at 8)
    hole=0.012,                 # the shell's polar hole under the bun's middle (hidden; range 8-16 mm)
    # ---- skinning
    rigid_y=(-0.020, 0.004),    # head-only skinning above anchor_y + the second value, the body's below anchor_y + the first
    rigid_bun=(0.004, 0.012),   # ... and head-only within this of the bun's outline, fading out over the second value
    # ---- texture
    tex=1024,                   # base colour + alpha (the strands and the fringe are drawn at this size; budget: one draw call, <= 1024)
    tex_normal=512,             # strand normal map (range 512-1024; 512 saves 4.2 MB of GPU memory)
    tex_orm=256,                # occlusion (R) and roughness (G) map
    swirl=0.012,                # the strands turn this share of the way round as they go into the bun (range 0-0.03)
    row_mm=0.25,                # across-strand texel at the hairline (texture rows are laid out along the hairline; range 0.2-0.35)
    alpha_test=0.45,            # the cut of the alpha (the recipe sharpens it to one pixel; strands make the softness)
    normal_k=0.16,              # strength of the strand normal map (on lock heights 0..1 over 4-13 texels; range 0.5-1.5)
    rough_map=0.95,             # roughness map G (the viewer's hair recipe multiplies its 0.42: about 0.22, a defined band; range 0.4-0.8)
    fringe_light=0.45,          # the fringe's hairs are this much lighter at the hairline (range 0.2-0.6)
    fringe_jitter=0.26,         # how far the strand ends scatter round the fringe's middle, as a share of its width (range 0.1-0.35)
    roughness=0.55,
)


def log(*a): print("[hair_cap]", *a, flush=True)
def ramp(x, a, b): return np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
def sst(x): x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)
def unit(v): v = np.asarray(v, dtype=np.float64); return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


class Piece:
    """What build() returns: mesh (glb.Mesh, unlifted frame, morphs on every target), materials, classes (manifest
    `materials` entries), garment (wardrobe entry for slot `hair`), licence, mask / cover images (body UV0), stats."""
    pass


# ------------------------------------------------------------------------------------------------ small geometry tools
def vertex_normals(v, t):
    n = np.zeros_like(v); f = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    for k in range(3): np.add.at(n, t[:, k], f)
    return unit(n)


def raycast(V, T, O, D, maxd=0.06, chunk=600):
    """Distance along unit D from O to the first triangle of (V, T) within maxd (inf when none)."""
    A = V[T[:, 0]]; E1 = V[T[:, 1]] - A; E2 = V[T[:, 2]] - A; Cc = A + (E1 + E2) / 3
    rad = float(np.max(np.linalg.norm(np.stack([A, V[T[:, 1]], V[T[:, 2]]], 1) - Cc[:, None], axis=2)))
    tree = cKDTree(Cc); out = np.full(len(O), np.inf); steps = max(2, int(np.ceil(maxd / 0.01)) + 1)
    for s in range(0, len(O), chunk):
        o = O[s:s + chunk]; d = D[s:s + chunk]; cand = [set() for _ in range(len(o))]
        for k in np.linspace(0, maxd, steps):
            for i, lst in enumerate(tree.query_ball_point(o + d * k, 0.0055 + rad)): cand[i].update(lst)
        ri = np.concatenate([np.full(len(c), i) for i, c in enumerate(cand)] + [np.zeros(0)]).astype(np.int64)
        ti = np.concatenate([np.fromiter(c, np.int64, len(c)) for c in cand] + [np.zeros(0)]).astype(np.int64)
        if not len(ri): continue
        dv = d[ri]; p = np.cross(dv, E2[ti]); det = (E1[ti] * p).sum(1); ok = np.abs(det) > 1e-14
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0); sv = o[ri] - A[ti]; u = (sv * p).sum(1) * inv
        q = np.cross(sv, E1[ti]); vv = (q * dv).sum(1) * inv; tt = (q * E2[ti]).sum(1) * inv
        hit = ok & (u >= -1e-9) & (vv >= -1e-9) & (u + vv <= 1 + 1e-9) & (tt > 0) & (tt <= maxd)
        best = np.full(len(o), np.inf); np.minimum.at(best, ri, np.where(hit, tt, np.inf)); out[s:s + chunk] = best
    return out


def cotan_laplacian(v, t):
    """Cotangent stiffness L (positive semi-definite) and lumped mass M."""
    n = len(v); I = []; J = []; Wt = []
    for k in range(3):
        a, b, c = t[:, k], t[:, (k + 1) % 3], t[:, (k + 2) % 3]
        u = v[b] - v[a]; w = v[c] - v[a]; cot = (u * w).sum(1) / np.maximum(np.linalg.norm(np.cross(u, w), axis=1), 1e-14)
        I += [b, c]; J += [c, b]; Wt += [0.5 * cot, 0.5 * cot]
    I = np.concatenate(I); J = np.concatenate(J); Wt = np.concatenate(Wt)
    Wm = sp.csr_matrix((Wt, (I, J)), shape=(n, n)); L = sp.diags(np.asarray(Wm.sum(1)).ravel()) - Wm
    area = np.linalg.norm(np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]]), axis=1) / 2
    m = np.zeros(n); [np.add.at(m, t[:, k], area / 3) for k in range(3)]
    return L.tocsr(), sp.diags(m).tocsr()


def heat_distance(v, t, src, tmul=1.0):
    """Geodesic distance from the vertex set `src` (heat method, Crane et al. 2013), metres; smooth iso-lines."""
    L, M = cotan_laplacian(v, t); e = np.concatenate([np.linalg.norm(v[t[:, a]] - v[t[:, b]], axis=1) for a, b in ((0, 1), (1, 2), (2, 0))])
    h = tmul * float(e.mean()) ** 2; d0 = np.zeros(len(v)); d0[src] = 1.0
    u = spl.spsolve((M + h * L).tocsc(), d0)
    p0, p1, p2 = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]; N = np.cross(p1 - p0, p2 - p0); A2 = np.linalg.norm(N, axis=1); Nn = N / np.maximum(A2, 1e-14)[:, None]
    g = (np.cross(Nn, p2 - p1) * u[t[:, 0], None] + np.cross(Nn, p0 - p2) * u[t[:, 1], None] + np.cross(Nn, p1 - p0) * u[t[:, 2], None]) / np.maximum(A2, 1e-14)[:, None]
    X = -unit(g); div = np.zeros(len(v))
    def cot(p, q, r): x = q - p; y = r - p; return (x * y).sum(1) / np.maximum(np.linalg.norm(np.cross(x, y), axis=1), 1e-14)
    for k in range(3):
        a, b, c = t[:, k], t[:, (k + 1) % 3], t[:, (k + 2) % 3]
        cb = cot(v[b], v[c], v[a]); cc = cot(v[c], v[a], v[b])
        np.add.at(div, a, 0.5 * (cc * ((v[b] - v[a]) * X).sum(1) + cb * ((v[c] - v[a]) * X).sum(1)))
    phi = spl.spsolve((L + 1e-9 * M).tocsc(), -div)
    phi = phi - phi[src].mean()
    return phi if phi.mean() >= 0 else -phi


def cut_mesh(v, t, f):
    """Keep the part of a triangle mesh where the per-vertex scalar f >= 0, cut along f = 0 (marching triangles): new
    vertices on the crossing edges at the interpolated position, so the new border follows the smooth iso-line, not the
    triangle edges. -> (v2, t2, O) with O a sparse (n2, n) matrix: v2 = O @ v (and anything per-vertex linear)."""
    n = len(v); f = np.where(f == 0, 1e-9, f); keepv = f >= 0; new = {}; rows = [(i, i, 1.0) for i in range(n)]; T2 = []
    def ev(a, b):
        key = (min(a, b), max(a, b))
        if key not in new:
            w = f[a] / (f[a] - f[b]); k = n + len(new); new[key] = k; rows.append((k, a, 1 - w)); rows.append((k, b, w))
        return new[key]
    for tri in t:
        s_ = keepv[tri]
        if s_.all(): T2.append(list(tri)); continue
        if not s_.any(): continue
        k = int(np.argmax(s_ != (s_.sum() == 2)))
        a, b, c = int(tri[k]), int(tri[(k + 1) % 3]), int(tri[(k + 2) % 3])
        ab = ev(a, b); ac = ev(a, c)
        if s_.sum() == 1: T2.append([a, ab, ac])
        else: T2.append([ab, b, c]); T2.append([ab, c, ac])
    r = np.array(rows); nn = n + len(new)
    O = sp.csr_matrix((r[:, 2], (r[:, 0].astype(int), r[:, 1].astype(int))), shape=(nn, n))
    t2 = np.asarray(T2, dtype=np.int64); used = np.unique(t2); remap = np.full(nn, -1); remap[used] = np.arange(len(used))
    O = O[used]
    return np.asarray(O @ v), remap[t2], O


def largest_component(t, n, min_tris=24):
    """Triangles of the edge-connected pieces with at least min_tris triangles (scraps go; the temple patch, joined to
    the rest only under the cap, stays)."""
    import scipy.sparse.csgraph as cg
    e = np.vstack([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]); A = sp.csr_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    k, lab = cg.connected_components(A, directed=False); cnt = np.bincount(lab[t[:, 0]], minlength=k)
    return t[cnt[lab[t[:, 0]]] >= min_tris]


def boundary_loops(t):
    """Boundary edges grouped into connected chains of vertices: list of vertex index arrays."""
    e = np.vstack([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]); key = np.sort(e, 1)
    u, cnt = np.unique(key, axis=0, return_counts=True); b = u[cnt == 1]
    import scipy.sparse.csgraph as cg
    if not len(b): return []
    n = int(t.max()) + 1; A = sp.csr_matrix((np.ones(len(b)), (b[:, 0], b[:, 1])), shape=(n, n))
    k, lab = cg.connected_components(A, directed=False); vs = np.unique(b)
    return [vs[lab[vs] == i] for i in np.unique(lab[vs])]


def border_distance(v, t, loop_vertices):
    """Euclidean distance of every vertex to the border edges whose two ends are both in `loop_vertices` (exact 0 on the
    border; on the curved scalp within the 20-60 mm that matter it is the distance along the skin to within 2 %)."""
    e = np.vstack([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]); key = np.sort(e, 1)
    u, cnt = np.unique(key, axis=0, return_counts=True); b = u[cnt == 1]; inl = np.zeros(len(v), bool); inl[loop_vertices] = True
    b = b[inl[b[:, 0]] & inl[b[:, 1]]]; A = v[b[:, 0]]; B = v[b[:, 1]]; AB = B - A; L2 = np.maximum((AB * AB).sum(1), 1e-18)
    out = np.empty(len(v))
    for s0 in range(0, len(v), 256):
        P_ = v[s0:s0 + 256, None, :]; tt = np.clip(((P_ - A[None]) * AB[None]).sum(2) / L2[None], 0, 1)
        out[s0:s0 + 256] = np.linalg.norm(P_ - (A[None] + tt[..., None] * AB[None]), axis=2).min(1)
    return out


def head_grid(B, th, C, y_lo, cap_v, step):
    """A regular grid over the head below the cap's top: rows of rays from the vertical axis through C, `step` apart in height
    and (at the skull's mean radius) round; the outermost body surface each ray meets. -> O (sparse (n, NV): the grid point as
    barycentric weights of its body triangle), points, triangles (quads split, rays that miss leave holes)."""
    r0 = 0.085; naz = int(round(2 * math.pi * r0 / step)); azs = np.linspace(-math.pi, math.pi, naz, endpoint=False)
    y_hi = float(cap_v[:, 1].max()) - 0.03; ys = np.arange(y_lo, y_hi, step); ny = len(ys)
    AZ, YY = np.meshgrid(azs, ys); dirs = np.stack([np.sin(AZ), np.zeros_like(AZ), np.cos(AZ)], -1).reshape(-1, 3)
    org = np.stack([np.full(AZ.shape, C[0]), YY, np.full(AZ.shape, C[2])], -1).reshape(-1, 3) + dirs * 0.25
    A_ = B[th[:, 0]]; E1 = B[th[:, 1]] - A_; E2 = B[th[:, 2]] - A_
    D = -dirs; n = len(org); hit_t = np.full(n, np.inf); hit_k = np.full(n, -1); hit_uv = np.zeros((n, 2))
    for s0 in range(0, n, 64):
        o = org[s0:s0 + 64, None, :]; d = D[s0:s0 + 64, None, :]
        p = np.cross(d, E2[None]); det = (E1[None] * p).sum(-1); ok = np.abs(det) > 1e-14; inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        sv = o - A_[None]; u = (sv * p).sum(-1) * inv; q = np.cross(sv, E1[None]); v = (d * q).sum(-1) * inv; t = (E2[None] * q).sum(-1) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0); t = np.where(hit, t, np.inf); k = t.argmin(1)
        tt = t[np.arange(len(k)), k]; good = np.isfinite(tt)
        hit_t[s0:s0 + 64] = tt; hit_k[s0:s0 + 64] = np.where(good, k, -1)
        hit_uv[s0:s0 + 64] = np.c_[u[np.arange(len(k)), k], v[np.arange(len(k)), k]]
    good = hit_k >= 0; idx = np.full(n, -1); idx[good] = np.arange(good.sum())
    gk = hit_k[good]; uu, vv = hit_uv[good, 0], hit_uv[good, 1]; m = int(good.sum())
    rows = np.repeat(np.arange(m), 3); cols = th[gk].ravel(); w = np.c_[1 - uu - vv, uu, vv].ravel()
    O = sp.csr_matrix((w, (rows, cols)), shape=(m, len(B)))
    T = []
    gid = idx.reshape(ny, naz)
    for i in range(ny - 1):
        for j in range(naz):
            a, b, c_, d_ = gid[i, j], gid[i, (j + 1) % naz], gid[i + 1, (j + 1) % naz], gid[i + 1, j]
            if min(a, b, c_, d_) < 0: continue
            if (i + j) % 2: T += [[a, c_, b], [a, d_, c_]]
            else: T += [[a, d_, b], [b, d_, c_]]
    T = np.asarray(T, dtype=np.int64)
    V = np.asarray(O @ B)
    # outward winding
    f0 = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]); cen = V[T].mean(1); out = cen - np.array([C[0], 0, C[2]]) * np.array([1, 0, 1]) - np.c_[np.zeros(len(cen)), cen[:, 1], np.zeros(len(cen))]
    out[:, 1] = 0; flip = (f0 * out).sum(1) < 0; T[flip] = T[flip][:, [0, 2, 1]]
    return O, V, T


def hairline_distance(v, t, f):
    """Signed distance of every vertex to the iso-line f = 0 inside the triangles (marching triangles): + where f > 0."""
    segs = []
    for tri in t:
        fv = f[tri]; pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if (fv[a] > 0) != (fv[b] > 0):
                w = fv[a] / (fv[a] - fv[b]); pts.append((1 - w) * v[tri[a]] + w * v[tri[b]])
        if len(pts) == 2: segs.append(pts)
    if not segs: return np.full(len(v), 1.0)
    S = np.asarray(segs); A = S[:, 0]; AB = S[:, 1] - A; L2 = np.maximum((AB * AB).sum(1), 1e-18); out = np.empty(len(v))
    for s0 in range(0, len(v), 256):
        P_ = v[s0:s0 + 256, None, :]; tt = np.clip(((P_ - A[None]) * AB[None]).sum(2) / L2[None], 0, 1)
        out[s0:s0 + 256] = np.linalg.norm(P_ - (A[None] + tt[..., None] * AB[None]), axis=2).min(1)
    return np.where(f > 0, out, -out)


def cone_limit(S, N, Q, clear, slope, r0, reach=0.015):
    """Thickness limit of a layer on points S (normals N) under the obstacle points Q: t <= (height of q above S) - clear +
    slope * max(0, tangential distance - r0), for every q within reach (so a triangle between two vertices cannot pass a thin rod)."""
    out = np.full(len(S), np.inf)
    if Q is None or not len(Q): return out
    tree = cKDTree(Q)
    for i, lst in enumerate(tree.query_ball_point(S, reach)):
        if not lst: continue
        dv = Q[lst] - S[i]; h = dv @ N[i]; tn = np.linalg.norm(dv - h[:, None] * N[i], axis=1)
        ok = h > -0.002
        if ok.any(): out[i] = max(0.0, float((h[ok] - clear + slope * np.maximum(tn[ok] - r0, 0)).min()))
    return out


def smooth_field(val, t, n, iters=3):
    """A few Laplacian passes of a per-vertex scalar over the mesh's edges."""
    e = np.vstack([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]); e = np.vstack([e, e[:, ::-1]])
    A = sp.csr_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)); A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel(); x = np.asarray(val, dtype=np.float64).copy()
    for _ in range(iters): x = 0.5 * x + 0.5 * (A @ x) / np.maximum(deg, 1)
    return x


# ------------------------------------------------------------------------------------------------ inputs from the build
def _find(meshes, *prefixes):
    for pre in prefixes:
        for m in meshes:
            if m.name == pre or m.name.startswith(pre): return m
    return None


def _at(m, k):
    """A mesh's vertices on target k ("" = base): its own morph target (GPU or baked deltas)."""
    v = np.asarray(m.v, dtype=np.float64)
    return v if not k else v + np.asarray(m.morphs.get(k, np.zeros_like(v)), dtype=np.float64)


def _ear_mask(B, head, eye_l, eye_r, ez, tris=None):
    """The ear: B7's lateral box behind the eyes (pipeline/abstract.py, Style), with its stricter test (within 13 mm of the
    head's widest point; the 21.5 mm one alone takes in the skin in front of the ear), plus whatever stands out more than
    6 mm from a smoothed head there (the auricle near its root)."""
    x, y, z = B[:, 0], B[:, 1], B[:, 2]
    band = head & (y > eye_l[1] - 0.055) & (y < eye_l[1] + 0.03) & (z < ez - 0.048) & (z > ez - 0.143)
    hw = np.abs(x[band]).max() if band.any() else 0.08
    ear = band & (np.abs(x) > hw - 0.013)
    if tris is not None:
        t = tris[head[tris].all(1)]; n = len(B); e_ = np.vstack([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]); e_ = np.vstack([e_, e_[:, ::-1]])
        A = sp.csr_matrix((np.ones(len(e_)), (e_[:, 0], e_[:, 1])), shape=(n, n)); A.data[:] = 1; dg = np.asarray(A.sum(1)).ravel(); Sm = B.copy()
        for _ in range(40): Sm = np.where((dg > 0)[:, None], 0.5 * Sm + 0.5 * (A @ Sm) / np.maximum(dg, 1)[:, None], Sm)
        prot = ((B - Sm) * vertex_normals(B, tris)).sum(1)
        ear |= band & (prot > 0.008) & (z > ez - 0.095) & (z < ez - 0.055) & (np.abs(x) > hw - 0.016)
    return ear


def _rim(cap_v, cap_t, C):
    """The cap's head rim (the boundary loop round the head): (azimuth sorted, height)."""
    import mh_wardrobe as wd
    _, tw = wd.weld(cap_v, cap_t); best = None
    for l in wd.boundary_loops(tw, len(cap_v)):
        l = np.asarray(l)
        if len(l) < 12: continue
        az = np.arctan2(cap_v[l, 0] - C[0], cap_v[l, 2] - C[2]); cover = len(np.unique(np.round(az / (2 * math.pi) * 36)))
        if best is None or cover > best[0] or (cover == best[0] and cap_v[l, 1].mean() < cap_v[best[1], 1].mean()): best = (cover, l)
    l = best[1]; az = np.arctan2(cap_v[l, 0] - C[0], cap_v[l, 2] - C[2]); o = np.argsort(az)
    return az[o], cap_v[l, 1][o], l[o]


# ------------------------------------------------------------------------------------------------ texture layout
# x: the shell's strands in 0 .. SX (fringe at the right end), a transparent guard, the bun's tile BX0 .. BX0 + BPER
# (periodic in x, so the bun's seam is invisible); y: strands side by side, periodic over the whole texture.
SX = 0.46; BX0 = 0.52; BPER = 472.0 / 1024.0; FR0 = 0.86          # FR0: start of the fringe in the shell's own x (0..1)


# ------------------------------------------------------------------------------------------------ the bun
def bun_dome():
    """The bun in its own frame (x left, y up, z out from the head): a full, round mound (a superellipsoid, fuller at the
    sides than a half ellipsoid), its surface a little uneven, the hair wrapped round it: texture x runs round the bun (one
    period of the bun tile per turn), y up its side with one texture period per turn, so the strands climb in a gentle
    spiral (about 25 degrees) and every seam steps y by an integer. -> v, tris, uv, tri_uv."""
    na, ne = P["bun_steps"]; a, b, H, pe, seat = P["bun_a"], P["bun_b"], P["bun_h"], P["bun_p"], P["seat"]
    def surf(ph, et):
        be = et * math.pi / 2; rs = np.cos(be) ** (2 / pe); zs = np.sin(be) ** (2 / pe)
        wob = 1 + 0.035 * np.sin(3 * ph + 0.6) * np.sin(math.pi * et) + 0.025 * np.sin(5 * ph + 1.9) * np.sin(math.pi * et)
        return np.stack([a * rs * np.cos(ph) * wob, b * rs * np.sin(ph) * wob, -seat + (H + seat) * zs * (1 + 0.02 * np.sin(2 * ph))], -1)
    ph = 2 * math.pi * np.arange(na) / na; et = np.arange(ne) / ne
    PH, ET = np.meshgrid(ph, et); v = np.vstack([surf(PH, ET).reshape(-1, 3), surf(np.zeros(1), np.ones(1))])
    mer = float(np.linalg.norm(np.diff(surf(np.zeros(64), np.linspace(0, 1, 64)), axis=0), axis=1).sum())
    c_ = mer / (P["bun_row_mm"] * 1e-3) / P["tex"]
    uv = [[BX0 + BPER * j / na, c_ * et[i] + P["twist_turn"] * j / na] for i in range(ne) for j in range(na + 1)]
    uv.append([BX0 + 0.5 * BPER, c_ + 0.5 * P["twist_turn"]]); uv = np.array(uv)
    vi = lambda i, j: i * na + (j % na); ui = lambda i, j: i * (na + 1) + j; ap = len(v) - 1; apu = len(uv) - 1
    T = []; TU = []
    for i in range(ne - 1):
        for j in range(na):
            T += [[vi(i, j), vi(i, j + 1), vi(i + 1, j + 1)], [vi(i, j), vi(i + 1, j + 1), vi(i + 1, j)]]
            TU += [[ui(i, j), ui(i, j + 1), ui(i + 1, j + 1)], [ui(i, j), ui(i + 1, j + 1), ui(i + 1, j)]]
    for j in range(na): T.append([vi(ne - 1, j), vi(ne - 1, j + 1), ap]); TU.append([ui(ne - 1, j), ui(ne - 1, j + 1), apu])
    T = np.asarray(T, dtype=np.int64); TU = np.asarray(TU, dtype=np.int64)
    f0 = np.cross(v[T[:, 1]] - v[T[:, 0]], v[T[:, 2]] - v[T[:, 0]]); cen = v[T].mean(1)
    flip = (f0 * (cen - np.array([0, 0, -seat - 0.01]))).sum(1) < 0
    T[flip] = T[flip][:, [0, 2, 1]]; TU[flip] = TU[flip][:, [0, 2, 1]]
    return v, T, uv, TU


def uv_tangents(V, T, UV, TUV, N):
    """Per-vertex tangent along texture x (the strands) and the glTF handedness w (bitangent cross(N, T) * w toward texture v
    increasing in OBJ convention, i.e. image up)."""
    tu = np.zeros_like(V); tv = np.zeros_like(V)
    p0, p1, p2 = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]; q0, q1, q2 = UV[TUV[:, 0]], UV[TUV[:, 1]], UV[TUV[:, 2]]
    e1, e2 = p1 - p0, p2 - p0; d1, d2 = q1 - q0, q2 - q0; det = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
    ok = np.abs(det) > 1e-14; r = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)[:, None]
    Tu = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) * r; Tv = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) * r
    A = np.linalg.norm(np.cross(e1, e2), axis=1)[:, None]
    Tu = unit(Tu) * A; Tv = unit(Tv) * A
    for k in range(3): np.add.at(tu, T[:, k], Tu); np.add.at(tv, T[:, k], Tv)
    t = unit(tu - (tu * N).sum(1)[:, None] * N); w = np.sign((np.cross(N, t) * tv).sum(1)); w[w == 0] = 1
    return t, w


# ------------------------------------------------------------------------------------------------ textures
def _strands(rng, W, Hh, per_x=None, n_clumps=80):
    """Strands along x over a W x Hh block, periodic in y (and in x with period per_x). Combed hair: fine strands and fibre
    groups (most of the relief), many narrow locks that blend into each other (no stripes), broad soft zones of tone.
    -> height, lightness, occlusion."""
    x = np.arange(W, dtype=np.float64)[None, :]; y = np.arange(Hh, dtype=np.float64)[:, None]; Px = per_x or 4 * W
    warp = np.zeros((Hh, W))
    for fx, fy, amp in ((1, 2, 1.0), (2, 5, 0.6), (4, 11, 0.3)):
        for _ in range(2):
            kx = rng.integers(1, fx + 1) if per_x else rng.uniform(0.5, fx); ky = rng.integers(0, fy + 1)
            warp += amp / 2 * np.sin(2 * np.pi * (kx * x / Px + ky * y / Hh + rng.random()))
    yy = (y + warp) % Hh
    def band(k_lo, k_hi, warped=True):
        k = np.arange(k_lo, k_hi); ph = rng.uniform(0, 2 * np.pi, len(k)); am = rng.normal(0, 1, len(k))
        g = (am[None, :] * np.cos(2 * np.pi * np.outer(np.arange(Hh) / Hh, k) + ph[None, :])).sum(1); g /= g.std()
        if not warped: return np.broadcast_to(g[:, None], (Hh, W))
        i0 = np.floor(yy).astype(int); t = yy - i0; return g[i0 % Hh] * (1 - t) + g[(i0 + 1) % Hh] * t
    strands = band(330, 512); fibres = band(120, 330); broad = band(3, 14, warped=False)
    Hc = np.zeros((Hh, W))
    for _ in range(n_clumps):
        yc = rng.uniform(0, Hh); w = rng.uniform(1.5, 4.5); L0 = rng.uniform(0.3, 1.0) * (per_x or W)
        x0 = rng.uniform(-0.3, 1.0) * (per_x or W); amp = rng.uniform(0.0, 2.0); lam = (Px / rng.integers(1, 4)) if per_x else rng.uniform(0.3, 1.0) * W
        xs_ = np.arange(W, dtype=np.float64); u = ((xs_ - x0) % Px if per_x else (xs_ - x0)) / L0
        on = (u > 0) & (u < 1)
        if not on.any(): continue
        prof = np.sin(np.pi * np.clip(u, 0, 1)) ** 0.5 * on
        ycl = yc + amp * np.sin(2 * np.pi * xs_ / lam + rng.random() * 6.28)
        d = ((y - ycl[None, :] + Hh / 2) % Hh) - Hh / 2
        Hc += rng.uniform(0.5, 1.0) * prof[None, :] * np.exp(-(d / w) ** 2)
    Hc = (Hc - Hc.mean()) / max(Hc.std(), 1e-6)
    H = 0.35 * Hc + 0.40 * fibres + 0.25 * strands
    occ = np.clip(0.90 + 0.05 * Hc + 0.03 * fibres, 0.75, 1.0)
    L = (1 + 0.045 * broad) * (1 + 0.025 * Hc + 0.025 * fibres + 0.04 * strands)
    return H, L, occ


def Ss_fine(rng, Hh, W):
    """Small along-strand variation (rows x columns), zero mean."""
    return np.sin(2 * np.pi * (np.arange(W)[None, :] / rng.uniform(6, 14) + rng.random((Hh, 1))))


def textures(seed=11):
    """1024 textures: base colour (neutral grey strand shading, mean sRGB 128) + alpha, a tangent-space normal map, and a
    512 occlusion-roughness map (R occlusion between the locks, G roughness 0.42 x G in the viewer's recipe: a sharper band).
    Layout: SX, BX0, BPER above. The shell's part darkens where it meets the bun and ends in a fringe of single strands."""
    Sz = P["tex"]; key = hashlib.sha1(json.dumps([Sz, seed, P["normal_k"], SX, BX0, BPER, FR0, P["fringe_jitter"], P["rough_map"], P["tex_normal"], P["tex_orm"], P["fringe_light"], 22]).encode()).hexdigest()[:10]
    os.makedirs(CACHE, exist_ok=True)
    fb, fn, fo = (os.path.join(CACHE, "hair_cap_%s_%s.png" % (k, key)) for k in ("base", "normal", "orm"))
    if all(os.path.exists(f) for f in (fb, fn, fo)): return fb, fn, fo
    rng = np.random.default_rng(seed)
    ws = int(round(SX * Sz)); bx0 = int(round(BX0 * Sz)); bp = int(round(BPER * Sz)); gm = bx0 - 8
    H = np.zeros((Sz, Sz)); L = np.ones((Sz, Sz)); A = np.zeros((Sz, Sz)); O = np.ones((Sz, Sz))
    Hs, Ls, Os = _strands(rng, gm, Sz, n_clumps=700)
    xs = (np.arange(gm) / ws)[None, :]                                      # the shell's own x (0..1 at SX)
    fr = (xs - FR0) / (1 - FR0)
    # the fringe: a falling alpha with each texel row (one strand) ending at its own point round it, so that the one-pixel cut
    # of the viewer's alpha-to-coverage leaves a finely uneven line of hair ends, not a comb of long strokes; a few strays
    nrow = rng.normal(0, 1, Sz); nrow = 0.6 * nrow + 0.4 * np.roll(nrow, 1)
    stray = (rng.random(Sz) < 0.06) * rng.uniform(0.15, 0.35, Sz)
    a_ = 1.0 - np.clip(fr, 0, None) / 0.80 + P["fringe_jitter"] * nrow[:, None] + stray[:, None] + 0.05 * Ss_fine(rng, Sz, gm)
    As = np.where(xs < FR0, 1.0, np.clip(a_, 0, 1)); As[:, ws:] = 0.0
    Os = np.where(fr > 0, Os * (1.0 - 0.35 * np.clip(fr, 0, 1)), Os)       # the fringe: less sheen from the room
    Ls = np.where(fr > 0, Ls * (1.0 + P["fringe_light"] * sst(np.clip(fr, 0, 1))), Ls)   # and finer, lighter hairs: less contrast with the skin
    H[:, :gm] = Hs; L[:, :gm] = Ls; A[:, :gm] = As; O[:, :gm] = Os
    Hb, Lb, Ob = _strands(rng, bp, Sz, per_x=bp, n_clumps=700)
    cols = (np.arange(gm, Sz) - bx0) % bp                                    # the bun's tile fills the guard's right half too:
    H[:, gm:] = Hb[:, cols]; L[:, gm:] = Lb[:, cols]; A[:, gm:] = 1.0; O[:, gm:] = Ob[:, cols]   # MSAA samples past the bun's seam find hair, not the shell's clear guard
    L[:, :ws] = L[:, :ws] / L[:, int(0.2 * ws):int(FR0 * ws)].mean(); L[:, gm:] = L[:, gm:] / L[:, gm:].mean()
    srgb = np.clip(128.0 * L, 0, 255)
    Image.fromarray(np.dstack([srgb, srgb, srgb, A * 255]).astype(np.uint8)[::-1]).save(fb)   # array row r = texture v (OBJ, up): saved bottom-up
    gx = np.gradient(H, axis=1); gy = np.gradient(H, axis=0); k = P["normal_k"]
    nrm = unit(np.dstack([-k * gx, -k * gy, np.ones_like(H)]))
    Image.fromarray(np.clip((nrm[::-1] * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)).resize((P["tex_normal"],) * 2, Image.LANCZOS).save(fn)
    rough = np.clip(P["rough_map"] * (1 + 0.12 * (rng.normal(0, 1, Sz))[:, None]) * (1.15 - 0.15 * O), 0, 1)
    xs_all = (np.arange(Sz) / ws)[None, :]; rough = np.where((xs_all > FR0) & (xs_all < 1.0), np.maximum(rough, 1.0 * sst((xs_all - FR0) / (1 - FR0))), rough)
    orm = np.dstack([O, rough, np.zeros_like(O)])[::-1]
    Image.fromarray((orm * 255).astype(np.uint8)).resize((P["tex_orm"],) * 2, Image.LANCZOS).save(fo)
    log("textures", os.path.basename(fb), os.path.basename(fn), os.path.basename(fo))
    return fb, fn, fo


# ------------------------------------------------------------------------------------------------ the piece
def build(c, e, meshes, tone="light", sex="f", out=None, gid="low_bun", verbose=True):
    """c: bb.context (base, tris, tri_uv, rig.weights, pack); e: eyes.eye_context(c) (base_v, targets, rig W / skeleton);
    meshes: the build's mesh list in the bare-sole frame (finds the cap, glasses, headset by name; each with .morphs on
    every shape target); tone: light / medium / dark. Writes the body mask and cover into out/maps when out is given.
    -> Piece, or None for the man (his painted fade passes review and is left as it is)."""
    if sex != "f": return None
    import glb, rig as rr, build_body as bb, mh_core as mh, mh_wardrobe as wd
    base = c.base; B0 = np.asarray(e.base_v, dtype=np.float64); tnames = list(e.targets); NV = len(B0)
    body = np.asarray(base.vgroups["body"], bool); tris = np.asarray(c.tris)
    sk = e.rig["skeleton"]; jn = list(sk.names); J = np.asarray(sk.head, dtype=np.float64)
    jhead = J[jn.index("head")]; eyl = J[jn.index("eye_l")]; eyr = J[jn.index("eye_r")]; ec = (eyl + eyr) / 2; yneck = J[jn.index("neck_01")][1]
    cap = _find(meshes, "garment_cap"); hs = _find(meshes, "prop_headset"); gl = _find(meshes, "glasses")
    if cap is None: raise ValueError("hair_cap: no cap mesh (garment_cap*) in the mesh list: the piece is made for the cap")
    capt = np.asarray(cap.tris); Cb = np.array([0.0, jhead[1] + 0.04, ec[2] - 0.07])        # B2's head centre for azimuths
    # ---- head region of the body and its fields
    head = body & (B0[:, 1] > yneck - 0.01)
    th = tris[head[tris].all(1)]
    sc = json.load(gzip.open(os.path.join(mh.DATA, "uv_layers", "scalp_solid.json.gz")))
    hcov = np.zeros(NV); hcov[np.unique(base.quads[np.array([int(k) for k in sc])])] = 1.0
    hsoft = smooth_field(hcov, th, NV, P["scalp_blur"])
    az = np.degrees(np.arctan2(np.abs(B0[:, 0] - ec[0]), B0[:, 2] - (ec[2] - 0.07)))
    ear = _ear_mask(B0, head, eyl, eyr, ec[2], tris); d_ear = cKDTree(B0[ear]).query(B0)[0] if ear.any() else np.full(NV, 1.0)
    # the nape: MPFB's authored contour comes to a point on the mid-line; at the back the hairline is a designed curve
    # instead: the height of MPFB's contour (scalp_cut) at 125 degrees, curving down by nape_drop to the mid-line (180)
    back = head & (az > 105) & (B0[:, 1] < jhead[1] + 0.01)
    e_ = np.vstack([th[:, [0, 1]], th[:, [1, 2]], th[:, [2, 0]]]); f0_, f1_ = hsoft[e_[:, 0]] - P["scalp_cut"], hsoft[e_[:, 1]] - P["scalp_cut"]
    cr = (f0_ * f1_ < 0) & back[e_[:, 0]] & back[e_[:, 1]]; w_ = (f0_[cr] / (f0_[cr] - f1_[cr]))[:, None]
    pc = (1 - w_) * B0[e_[cr, 0]] + w_ * B0[e_[cr, 1]]; azc = np.degrees(np.arctan2(np.abs(pc[:, 0] - ec[0]), pc[:, 2] - (ec[2] - 0.07)))
    y125 = float(np.median(pc[np.abs(azc - 125) < 8, 1])) if (np.abs(azc - 125) < 8).any() else float(jhead[1] - 0.05)
    y180 = y125 - P["nape_drop"]
    yh = y180 + (y125 - y180) * np.clip((180 - az) / 55.0, 0, 1) ** 2
    # behind the ear the hairline comes down to the ear's root (MPFB's stops 10-15 mm behind it: an undercut look)
    az_eb = float(np.percentile(az[ear], 95)) if ear.any() else 110.0; y_eb = (float(B0[ear, 1].min()) if ear.any() else y125) + P["behind_ear"]
    yh = np.where(az < 125, y_eb + (y125 - y_eb) * sst((az - az_eb) / (125 - az_eb)), yh)
    hnape = np.clip(P["scalp_cut"] + (B0[:, 1] - yh) / 0.012, 0, 1)
    wb = sst((az - (az_eb - 8.0)) / 10.0)
    hsoft = (1 - wb) * hsoft + wb * hnape
    # the temples: MPFB's hairline runs under the cap's side rim, so from the side the head read shaved. The hair pulled
    # back from the temple is a designed patch in front of the ear (seen from the side: its front edge temple_z behind the
    # eye's front, down to the sideburn's lower edge), joined to the rest under the cap's rim above the ear
    ear_front = float(B0[ear, 2].max()) if ear.any() else ec[2] - 0.05; ear_mid = float(np.median(B0[ear, 1])) if ear.any() else ec[1] - 0.01
    zf = ec[2] - np.interp(B0[:, 1] - ec[1], [-0.020, -0.008, 0.006, 0.030], P["temple_z"])       # front edge, by height
    yl = ear_mid + P["sideburn"][0] + P["sideburn"][1] * np.clip(B0[:, 2] - ear_front, 0, None)     # lower edge of the sideburn
    side = head & (np.abs(B0[:, 0]) > 0.035) & (B0[:, 2] > ear_front - 0.03)
    htemple = np.where(side, np.clip(0.5 + np.minimum((zf - B0[:, 2]) / 0.008, (B0[:, 1] - yl) / 0.008), 0, 1), 0.0)
    htemple = smooth_field(htemple, th, NV, 2)
    hf = np.maximum(hsoft * ramp(az, *P["front_az"]), htemple) * ramp(d_ear, *P["ear_clear"])
    cap0 = np.asarray(cap.v, dtype=np.float64); raz, ry, rloop = _rim(cap0, capt, Cb)
    import mh_wardrobe as wd_
    _, tw_ = wd_.weld(cap0, capt); cap_edges = np.unique(np.concatenate([np.asarray(l) for l in wd_.boundary_loops(tw_, len(cap0)) if len(l) >= 8]))
    cap_edges = np.flatnonzero(cKDTree(cap0[cap_edges]).query(cap0)[0] < 0.008)                     # its edges and the folded band at them
    cap_edges = cap_edges[np.abs(np.degrees(np.arctan2(cap0[cap_edges, 0] - Cb[0], cap0[cap_edges, 2] - Cb[2]))) > 50]
    gl_pts = None if gl is None else np.flatnonzero(np.asarray(gl.v)[:, 2] < ec[2] - 0.01)          # the arms (not the lenses and the front)
    saz = np.arctan2(B0[:, 0] - Cb[0], B0[:, 2] - Cb[2]); yrim = np.interp(saz, raz, ry, period=2 * math.pi)
    depth = B0[:, 1] - yrim
    F = np.minimum(hf - P["scalp_cut"], (P["under_cap"] - depth) / 0.02 * 0.5)
    F[~head] = -1.0
    if DEBUG is not None: DEBUG.update(F=F, hf=hf, htemple=htemple, hsoft=hsoft)
    # ---- the bun's anchor: on the mid-line at the back, so that the bun's top is bun_gap below the cap's back rim
    bv, bt, buv, btuv = bun_dome(); sq = P["bun_b"] / P["bun_a"]
    back = np.abs(np.degrees(np.arctan2(cap0[:, 0] - Cb[0], cap0[:, 2] - Cb[2]))) > 160
    y_rim_back = float(cap0[back, 1].min())
    bn0 = vertex_normals(B0, tris)
    def skin_point(y):
        o = np.array([[0.0, y, -0.5]]); d = raycast(B0, th, o, np.array([[0.0, 0.0, 1.0]]), maxd=0.6)[0]
        p = o[0] + np.array([0, 0, 1.0]) * d
        k = cKDTree(B0[head]).query(p, k=6)[1]; n = unit(bn0[np.flatnonzero(head)[k]].mean(0))
        return p, n
    def frame(n):
        e3 = unit(n); e1 = unit(np.array([1.0, 0, 0]) - e3[0] * e3); e2 = np.cross(e1, e3); return e1, e2, e3
    ya = y_rim_back - 0.035
    for _ in range(4):
        A, nA = skin_point(ya); e1, e2, e3 = frame(nA)
        top = (A + bv @ np.vstack([e1, e2, e3]))[:, 1].max()
        ya += (y_rim_back - P["bun_gap"]) - top
    A, nA = skin_point(ya); e1, e2, e3 = frame(nA); Rb = np.vstack([e1, e2, e3])
    bun0 = A + bv @ Rb
    # ---- cut the head along the hairline, then the hole under the bun (an ellipse a little inside the bun's footprint)
    # ---- the shell's own mesh: a regular grid on the head (rays out from the head's vertical axis, P grid_mm apart round
    # and up), each grid point bound to the body triangle it lands on; then cut along the hairline. The body's own
    # triangles are 8-12 mm on the scalp but very small round the ear root, where the hairline runs (1,300 triangles)
    Og, vg, tg_ = head_grid(B0, th, Cb, yneck, cap0, P["grid_mm"] * 1e-3)
    Fg = smooth_field(np.asarray(Og @ F), tg_, len(vg), P["field_smooth"])          # the hairline: a smooth curve, not the grid's
    Fg = np.minimum(Fg, (np.asarray(Og @ d_ear) - P["ear_clear"][0]) * 40.0)             # and never onto the ear, smoothing or not
    v1, t1, O1c = cut_mesh(vg, tg_, Fg + P["cut_out"]); O1 = (O1c @ Og).tocsr(); F1 = np.asarray(O1c @ Fg)   # the mesh ends a little outside it
    t1 = largest_component(t1, len(v1))
    rh = P["hole"]; rbun = P["bun_a"]
    d1 = v1 - A; G = np.sqrt(((d1 @ e1) ** 2 + ((d1 @ e2) / sq) ** 2)) - rh
    v2, t2, O2 = cut_mesh(v1, t1, G); O = (O2 @ O1).tocsr(); F2 = np.asarray(O2 @ F1)
    t2 = largest_component(t2, len(v2)); used = np.unique(t2); remap = np.full(len(v2), -1); remap[used] = np.arange(len(used))
    t2 = remap[t2]; O = O[used]; F2 = F2[used]; S0 = np.asarray(O @ B0); n = len(S0)
    loops = boundary_loops(t2)
    dA = [float(np.linalg.norm(S0[l] - A, axis=1).mean()) for l in loops]
    hole = loops[int(np.argmin(dA))]; outer = np.unique(np.concatenate([l for i, l in enumerate(loops) if i != int(np.argmin(dA))]))
    if verbose: log("shell: %d vertices, %d triangles, %d border loops (%s vertices)" % (n, len(t2), len(loops), [len(l) for l in loops]))
    db = hairline_distance(S0, t2, F2); rb = border_distance(S0, t2, hole)                  # signed: < 0 outside the hairline
    # ---- polar angle round the bun (texture y) and the strand direction (texture x, TANGENT)
    Cs = jhead + np.array([0.0, 0.03, 0.0]); ah = unit(A - Cs)
    u1 = unit(np.array([1.0, 0, 0]) - ah[0] * ah); u2 = np.cross(ah, u1)                 # u2: up-ish
    if u2[1] < 0: u2 = -u2
    ph = unit(S0 - Cs); theta = np.arctan2(ph @ u1, -(ph @ u2))                          # 0 points down (nape), +-pi up under the cap
    cosA = np.clip(ph @ ah, -1, 1)
    Ns0 = unit(np.asarray(O @ bn0))
    tdir = unit(cosA[:, None] * ph - ah[None, :]); tdir = unit(tdir - (tdir * Ns0).sum(1)[:, None] * Ns0)
    # ---- thickness by design
    azv = np.degrees(np.arctan2(np.abs(S0[:, 0] - ec[0]), S0[:, 2] - (ec[2] - 0.07)))
    tb = np.interp(azv, [70.0, 95.0, 130.0, 180.0], [P["t_front"], P["t_side"], 0.5 * (P["t_side"] + P["t_back"]), P["t_back"]])
    edge = sst(np.maximum(db, 0) / P["taper"]); gat = P["t_gather"] * (1 - sst(rb / P["gather_r"]))
    t_design = P["t_edge"] + (tb - P["t_edge"]) * edge + gat * edge
    # taut hair bridges the hollows of the skin (below the occiput, behind the ear): a membrane over the region (border
    # held, 60 passes) lies outside the skin where the skin is concave; the shell is at least that thick there
    Mv = S0.copy(); e_ = np.vstack([t2[:, [0, 1]], t2[:, [1, 2]], t2[:, [2, 0]]]); e_ = np.vstack([e_, e_[:, ::-1]])
    Ad = sp.csr_matrix((np.ones(len(e_)), (e_[:, 0], e_[:, 1])), shape=(n, n)); Ad.data[:] = 1.0; dg = np.asarray(Ad.sum(1)).ravel()
    fix = np.zeros(n, bool); fix[outer] = True; fix[hole] = True
    for _ in range(60): Mv = np.where(fix[:, None], S0, 0.5 * Mv + 0.5 * (Ad @ Mv) / np.maximum(dg, 1)[:, None])
    dfoot = np.maximum(np.sqrt((((S0 - A) @ e1) / P["bun_a"]) ** 2 + (((S0 - A) @ e2) / P["bun_b"]) ** 2) - 1.0, 0) * P["bun_b"]
    hollow = np.clip(((Mv - S0) * Ns0).sum(1), 0, P["bridge_max"]) * edge * sst(dfoot / 0.010)
    t_design = np.maximum(t_design, P["t_edge"] + P["bridge"] * hollow)
    # ---- texture coordinates (OBJ convention, v up): x along the strands, y across them (repeats round the bun)
    Wf = P["fringe"] + 0.001
    dfoot = np.maximum(np.sqrt((((S0 - A) @ e1) / P["bun_a"]) ** 2 + (((S0 - A) @ e2) / P["bun_b"]) ** 2) - 1.0, 0) * P["bun_b"]
    # x is LINEAR in the distance from the hairline over the fringe (the body's triangles are 8-12 mm: a clamped or ratio
    # mapping put most of a narrow patch into the fringe), then runs down slowly to 0.15 over the next 120 mm
    ux = np.where(db < Wf, np.minimum(1 - (1 - FR0) * db / Wf, 1.06), np.maximum(FR0 - (db - Wf) * (FR0 - 0.15) / 0.12, 0.15))   # > 1 outside: the clear guard
    # texture y: laid out along the hairline (rows of equal width there, P row_mm), N whole repeats round the bun
    ob = outer; thb = theta[ob]; rhb = np.linalg.norm(S0[ob] - A, axis=1); o_ = np.argsort(thb)
    tg = np.linspace(-math.pi, math.pi, 721); rg = np.interp(tg, thb[o_], rhb[o_], period=2 * math.pi)
    for _ in range(40): rg = 0.25 * np.roll(rg, 1) + 0.5 * rg + 0.25 * np.roll(rg, -1)
    cum = np.r_[0, np.cumsum(0.5 * (rg[1:] + rg[:-1]) * np.diff(tg))]; Ltot = cum[-1]
    NR = max(1, int(round(Ltot / (P["tex"] * P["row_mm"] * 1e-3))))
    vy = np.interp(theta, tg, cum / Ltot * NR) + P["swirl"] * NR * np.exp(-dfoot / 0.03)
    ux = ux * SX
    # split the seam at theta = +-pi (texture y jumps by NR)
    tri_uv = t2.copy(); uvs = np.c_[ux, vy]; extra = {}
    for k_, tri in enumerate(t2):
        th3 = theta[tri]
        if th3.max() - th3.min() > math.pi:
            for j in range(3):
                if th3[j] < 0:
                    key = int(tri[j])
                    if key not in extra: extra[key] = len(uvs) + len(extra)
                    tri_uv[k_, j] = extra[key]
    if extra:
        add = np.array([[ux[k], vy[k] + NR] for k in extra]); uvs = np.vstack([uvs, add])
    # ---- per target: the shell on that body, held inside its cap, under its headset cushion and glasses arms
    def body_at(k): return B0 if not k else B0 + np.asarray(e.targets[k], dtype=np.float64)
    def obstacle(m, k):
        return None if m is None else (_at(m, k), np.asarray(m.tris))
    stats = {"cap": 0, "headset": 0, "glasses": 0, "rim": 0}
    def shell_at(k):
        Bk = body_at(k); Sk = np.asarray(O @ Bk); Nk = unit(np.asarray(O @ vertex_normals(Bk, tris)))
        lim = np.full(n, np.inf); orig = Sk + Nk * 1e-4
        for nm, m, clear, keep in (("cap", cap, P["cap_in"], 0.0002), ("headset", hs, P["cushion_clear"], P["cushion_keep"]), ("glasses", gl, P["glasses_clear"], 0.0)):
            ob = obstacle(m, k)
            if ob is None: continue
            near = cKDTree(ob[0]).query(Sk, distance_upper_bound=0.03)[0] < 0.03
            if not near.any(): continue
            g = np.full(n, np.inf); g[near] = raycast(ob[0], ob[1], orig[near], Nk[near], maxd=0.03)
            hit = np.isfinite(g)
            if nm == "headset": l_ = np.where(hit, np.maximum(g - clear, keep), np.inf)
            else: l_ = np.where(hit, np.maximum(g - clear, keep), np.inf)
            if k == "": stats[nm] = int((hit & (l_ < t_design)).sum())
            lim = np.minimum(lim, l_)
        # the cap's rim: just below it the hair may stand out from the skin only as far as the rim does, plus a slope
        # (and every other edge of the cap at the back and sides: the strap's opening) - and the glasses' thin arms, which a
        # ray along the skin's normal from vertices 9 mm apart can miss: a cone under every point of them
        capk = _at(cap, k); rim_l = cone_limit(Sk, Nk, capk[cap_edges], P["cap_in"] + P["rim_extra"], P["rim_slope"], 0.0)
        if gl is not None: lim = np.minimum(lim, cone_limit(Sk, Nk, _at(gl, k)[gl_pts], P["glasses_clear"], 0.5, 0.0015))
        if k == "": stats["rim"] = int((rim_l < t_design).sum())
        lim = np.minimum(lim, rim_l)
        tk = np.minimum(t_design, lim)
        tk = np.minimum(smooth_field(tk, t2, n, 2), lim)
        return Sk + Nk * tk[:, None], tk
    shell0, tk0 = shell_at("")
    # the bun's base follows the shell: each bun vertex is lifted by (shell surface - its rim plane) under it, fading out to
    # nothing at the top, so the rim sinks `seat` below the hair all round and the shell never shows through the bun's flank
    na_, ne_ = P["bun_steps"]; zb = (bun0 - A) @ e3; zs_ = np.clip((zb + P["seat"]) / (P["bun_h"] + P["seat"]), 0, 1)
    rim = np.arange(na_)                                                                  # ring 0 of the bun's grid
    hit = raycast(shell0, t2, bun0[rim] + e3 * (0.06 - zb[rim])[:, None], np.tile(-e3, (na_, 1)), maxd=0.12)
    rl = np.where(np.isfinite(hit), (0.06 - zb[rim]) - hit + zb[rim], np.nan)              # shell surface height over the rim plane
    rl = np.nan_to_num(rl, nan=float(np.nanmedian(rl)) if np.isfinite(rl).any() else 0.0)
    for _ in range(3): rl = 0.25 * np.roll(rl, 1) + 0.5 * rl + 0.25 * np.roll(rl, -1)
    col = np.r_[np.tile(np.arange(na_), ne_), [0]]; lift = np.maximum(rl[col], -0.004) * (1 - sst(zs_ / 0.8)); lift[-1] = 0.0
    bun0 = bun0 + e3[None, :] * lift[:, None]
    # ---- the bun on each target: the cap's own affine map (the cap is an affine image of the authored cap on every body)
    X0 = np.c_[cap0, np.ones(len(cap0))]
    def bun_at(k):
        if not k: return bun0
        Mk, *_ = np.linalg.lstsq(X0, _at(cap, k), rcond=None); return np.c_[bun0, np.ones(len(bun0))] @ Mk
    V0 = np.vstack([shell0, bun0]); nsh = len(shell0)
    morphs = {}; tmin = {}
    for k in tnames:
        sk_, tk_ = shell_at(k); morphs[k] = np.vstack([sk_, bun_at(k)]) - V0; tmin[k] = float(tk_.min())
    # ---- skinning: exactly the skin's own under the shell (RR's full weights, interpolated: the 8-influence set; and RR's
    # 4-influence fit for JOINTS_0 / WEIGHTS_0, so with 4 influences the hair still moves with the 4-influence body), the
    # cap's head-only skinning on the bun, next to it and under the cap's rim (no relative motion against the cap)
    Wb = sp.csr_matrix(e.rig["W"]); nj = Wb.shape[1]; hj = jn.index("head")
    J4b = np.asarray(c.J4); W4b = np.asarray(c.W4, dtype=np.float64)
    W4s = sp.csr_matrix((W4b.ravel(), (np.repeat(np.arange(len(J4b)), J4b.shape[1]), J4b.ravel())), shape=(len(J4b), nj))
    yA = A[1]; beta_y = ramp(S0[:, 1] - yA, *P["rigid_y"])
    dbun = np.sqrt((((S0 - A) @ e1) ** 2 + (((S0 - A) @ e2) / sq) ** 2))
    beta = np.maximum(beta_y, 1 - sst((dbun * P["bun_b"] - P["bun_b"] - P["rigid_bun"][0]) / P["rigid_bun"][1]))
    Hrow = sp.csr_matrix((np.ones(1), ([0], [hj])), shape=(1, nj)); ones = sp.csr_matrix(np.ones((len(bun0), 1)))
    def mix(Wsrc): return sp.vstack([sp.diags(1 - beta) @ (O @ Wsrc) + sp.csr_matrix(beta[:, None]) @ Hrow, ones @ Hrow]).tocsr()
    W8m = mix(Wb); W4m = mix(W4s)
    J8, W8 = bb.eight(W8m); J4, W4 = bb.eight(W4m, k=4)
    dqs = np.r_[(1 - beta) * np.asarray(O @ np.asarray(e.rig["dqs"], dtype=np.float64)).ravel(), np.zeros(len(bun0))]
    attrs = bb.skin_attrs(np.asarray(dqs, dtype=np.float32), J8, W8)
    # ---- the mesh: shell + bun, UVs, strand tangents
    T_all = np.vstack([t2, bt + nsh]); UV = np.vstack([uvs, buv]); TUV = np.vstack([tri_uv, btuv + len(uvs)])
    NRM = vertex_normals(V0, T_all)
    TAN, w = uv_tangents(V0, T_all, UV, TUV, NRM)
    # the shell's strands: the radial direction to the bun (its texture x is constant over much of it, so its UV gives no
    # direction there); the handedness as the UV says (texture y = round the bun)
    ts_ = unit(tdir - (tdir * NRM[:nsh]).sum(1)[:, None] * NRM[:nsh]); TAN[:nsh] = np.where(np.isfinite(ts_).all(1)[:, None], ts_, TAN[:nsh])
    eth = np.zeros((nsh, 3))
    for tri, tu in zip(t2, tri_uv):
        p0, p1, p2 = V0[tri]; (a0, b0), (a1, b1), (a2, b2) = UV[tu]
        G2 = np.array([[a1 - a0, b1 - b0], [a2 - a0, b2 - b0]])
        if abs(np.linalg.det(G2)) < 1e-14: continue
        grad_v = np.linalg.lstsq(np.vstack([p1 - p0, p2 - p0]), np.array([b1 - b0, b2 - b0]), rcond=None)[0]
        for j in range(3): eth[tri[j]] += grad_v
    w[:nsh] = np.where((np.cross(NRM[:nsh], TAN[:nsh]) * eth).sum(1) >= 0, 1.0, -1.0)
    attrs["TANGENT"] = np.c_[TAN, w].astype(np.float32)
    mname = "hair_" + gid; matname = "hair_cap_" + gid
    mesh = glb.Mesh(mname, V0, T_all, matname, uv=UV, tri_uv=TUV, joints=J4, weights=W4, morphs=morphs, attrs=attrs)
    # ---- material and textures
    fb, fn, fo = textures()
    tgt = tuple(min(255.0, PAINT_GAIN * x) for x in TONES[tone])
    lin = lambda v_: (v_ / 255.0) ** 2.2
    mean_lin = (128.0 / 255.0) ** 2.2
    factor = [round(min(1.0, lin(x) / mean_lin), 4) for x in tgt] + [1.0]
    mats = {matname: {"pbrMetallicRoughness": {"baseColorFactor": factor, "metallicFactor": 0.0, "roughnessFactor": P["roughness"]},
                      "alphaMode": "MASK", "alphaCutoff": P["alpha_test"], "doubleSided": True, "_images": {"baseColorTexture": fb, "normalTexture": fn, "metallicRoughnessTexture": fo, "occlusionTexture": fo}}}
    classes = {matname: {"class": "hair", "alphaTest": P["alpha_test"]}}
    # ---- body mask: the scalp under the opaque part (cut 6 mm inside the start of the fringe), and its cover
    hp = Piece(); hp.mesh = mesh; hp.materials = mats; hp.classes = classes
    hval = np.zeros(NV); dbody = np.full(NV, -1.0)
    rowmax = np.asarray(O.argmax(1)).ravel(); wmax = np.asarray(O.max(1).todense()).ravel()
    near_ = head & (cKDTree(S0).query(B0, k=1)[0] < 0.012)
    dk, jk = cKDTree(S0).query(B0[near_], k=3); wk = 1.0 / np.maximum(dk, 1e-4); dbody[near_] = (db[jk] * wk).sum(1) / wk.sum(1)
    inside = dbody >= 0
    hval[inside] = np.clip(0.5 + (dbody[inside] - (Wf + P["mask_in"])) / (2 * 0.003), 0, 1)
    cov = np.zeros(NV); cov[inside] = np.clip(0.5 + (dbody[inside] - (Wf + P["mask_in"] + 0.004)) / 0.008, 0, 1); 
    hp.mask_v, hp.cover_v = hval, cov
    hp.garment = {"id": gid, "label": "Low bun under the cap (B9)", "meshes": [mname], "colourways": [], "licence": "own work", "author": "avatar-lab B9"}
    if out is not None:
        mp, cp = write_masks(c, hval, cov, os.path.join(out, "maps"), gid)
        hp.garment.update(bodyMask="maps/" + os.path.basename(mp), cover="maps/" + os.path.basename(cp))
    hp.licence = {"what": "hair (woman): low bun under the cap", "source": "pipeline/hair_cap.py (B9): modelled on the body and the cap, textures generated", "licence": "own work"}
    hp.stats = {"vertices_source": int(len(V0)), "triangles": int(len(T_all)), "shell_triangles": int(len(t2)), "bun_triangles": int(len(bt)),
                "textures": {"baseColor+alpha": [P["tex"], P["tex"]], "normal": [P["tex_normal"]] * 2, "occlusion-roughness": [P["tex_orm"]] * 2},
                "gpu_texture_MB": round((P["tex"] ** 2 + P["tex_normal"] ** 2 + P["tex_orm"] ** 2) * 4 * 1.33 / 1e6, 2), "draw_calls": 1,
                "anchor": [round(float(x), 4) for x in A], "bun_top_below_rim_mm": round((y_rim_back - bun0[:, 1].max()) * 1000, 1),
                "thickness_mm": {"max": round(float(tk0.max()) * 1000, 2), "median": round(float(np.median(tk0)) * 1000, 2)},
                "limited_by": stats, "colour_factor": factor, "tone": tone}
    hp.debug = dict(NR=NR, Ltot=Ltot, S0=S0, t2=t2, db=db, rb=rb, theta=theta, ux=ux, tk0=tk0, A=A, frame=Rb, O=O, bun0=bun0, beta=beta, outer=outer, hole=hole)
    if verbose: log("piece: %d vertices, %d triangles (shell %d, bun %d); thickness max %.1f mm; limited by %s" % (len(V0), len(T_all), len(t2), len(bt), tk0.max() * 1000, stats))
    return hp


def write_masks(c, hval, cov, maps_dir, gid, size=1024):
    """Body-hide mask and cover in the body's UV0 (B2's convention: 8-bit, image row 0 = glTF v 0, white = hidden), with B2's
    seam treatment (border texels take the lower value of their 5 x 5 neighbourhood; a 5 x 5 median against pin-holes)."""
    import mh_wardrobe as wd
    from scipy import ndimage
    os.makedirs(maps_dir, exist_ok=True); out = []
    for nm, val in (("mask", hval), ("cover", cov)):
        raw = wd.raster_scalar(c.base.uv, c.tri_uv, c.tris, val, size, pad=0)
        img = wd.raster_scalar(c.base.uv, c.tri_uv, c.tris, val, size, pad=8)
        edge = ndimage.binary_dilation(np.isnan(raw), iterations=3) & ~np.isnan(img)
        img = np.nan_to_num(np.where(edge, ndimage.minimum_filter(np.nan_to_num(img, nan=1.0), size=5), img))
        img = ndimage.median_filter(img, size=5)
        p = os.path.join(maps_dir, "%s_hair_%s.png" % (nm, gid)); Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(p); out.append(p)
    return out
