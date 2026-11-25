"""pc_geom: numeric helpers for correctives.py (owner: B3). Forward kinematics, both skinning methods and the
deformation metrics are RR's (RR/spike.py), made mesh-agnostic; the frame transfer and the surface map are B3's."""
import math
import numpy as np
import scipy.sparse as sp
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot

def unit(v): v = np.asarray(v, float); return v / np.linalg.norm(v)
def rot(axis, deg): return Rot.from_rotvec(unit(axis) * math.radians(deg)).as_matrix()
def swing(a, b):
    """minimal rotation taking direction a to direction b"""
    a = unit(a); b = unit(b); ax = np.cross(a, b); s = np.linalg.norm(ax); c = float(a @ b)
    return np.eye(3) if s < 1e-9 else Rot.from_rotvec(ax / s * math.atan2(s, c)).as_matrix()
def swing_twist(R, a):
    """R = S @ T with T the rotation about the unit axis a"""
    q = Rot.from_matrix(R).as_quat(); p = np.dot(q[:3], a) * a; tw = np.array([*p, q[3]]); tw /= np.linalg.norm(tw)
    T = Rot.from_quat(tw).as_matrix(); return R @ T.T, T
def about(R, c):
    T = np.eye(4); T[:3, :3] = R; T[:3, 3] = c - R @ c; return T

# ---- skinning (RR/spike.py)
def fk(names, parent, heads, deltas):
    """deltas: bone name -> 3x3 world rotation about its rest head; returns (B,4,4) skinning matrices"""
    M = np.zeros((len(names), 4, 4))
    for b, n in enumerate(names):
        D = about(deltas[n], heads[b]) if n in deltas else np.eye(4)
        M[b] = D if parent[b] < 0 else M[parent[b]] @ D
    return M
def lbs(V, W, M):
    Mv = (W @ M[:, :3, :].reshape(len(M), 12)).reshape(-1, 3, 4)
    return np.einsum("vij,vj->vi", Mv[:, :, :3], V) + Mv[:, :, 3], Mv
def _qmul(a, b):
    w1, x1, y1, z1 = a[..., 0], a[..., 1], a[..., 2], a[..., 3]; w2, x2, y2, z2 = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([w1*w2-x1*x2-y1*y2-z1*z2, w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2], -1)
def dqs(V, W, M, want_rot=False):
    W = sp.csr_matrix(W)
    q = Rot.from_matrix(M[:, :3, :3]).as_quat()[:, [3, 0, 1, 2]]
    t = np.concatenate([np.zeros((len(M), 1)), M[:, :3, 3]], 1); qd = 0.5 * _qmul(t, q)
    piv = np.asarray(W.argmax(1)).ravel(); S = np.sign(q @ q.T); S[S == 0] = 1
    C = W.tocoo(); Ws = sp.csr_matrix((C.data * S[piv[C.row], C.col], (C.row, C.col)), shape=W.shape)
    bq = Ws @ q; bd = Ws @ qd; n = np.maximum(np.linalg.norm(bq, axis=1, keepdims=True), 1e-12); bq /= n; bd /= n
    R = Rot.from_quat(bq[:, [1, 2, 3, 0]]).as_matrix()
    tt = 2 * _qmul(bd, bq * np.array([1, -1, -1, -1]))[:, 1:]
    out = np.einsum("vij,vj->vi", R, V) + tt
    return (out, R) if want_rot else out

# ---- mesh
def vnormals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); N = np.zeros_like(V)
    for k in range(3): np.add.at(N, F[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
def edges(F):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]], F[:, [1, 0]], F[:, [2, 1]], F[:, [0, 2]]]); return np.unique(e, axis=0)
def local_maps(V1, V2, F):
    """per-vertex similarity (rotation R, scale s) taking the 1-ring of embedding V1 to the same 1-ring in V2
    (same topology): polar part of the edge covariance, normals added so the fit is never rank-deficient."""
    E = edges(F); e1 = V1[E[:, 1]] - V1[E[:, 0]]; e2 = V2[E[:, 1]] - V2[E[:, 0]]; n = len(V1)
    C = np.zeros((n, 3, 3)); np.add.at(C, E[:, 0], e2[:, :, None] * e1[:, None, :])
    l1 = np.zeros(n); l2 = np.zeros(n); np.add.at(l1, E[:, 0], (e1 ** 2).sum(1)); np.add.at(l2, E[:, 0], (e2 ** 2).sum(1))
    deg = np.maximum(np.bincount(E[:, 0], minlength=n), 1)
    N1 = vnormals(V1, F); N2 = vnormals(V2, F); C += (np.sqrt(l1 * l2) / deg)[:, None, None] * N2[:, :, None] * N1[:, None, :]
    U, S, Vt = np.linalg.svd(C + 1e-30 * np.eye(3)); d = np.sign(np.linalg.det(U @ Vt)); U[:, :, 2] *= d[:, None]
    return U @ Vt, np.sqrt(np.maximum(l2, 1e-30) / np.maximum(l1, 1e-30))
def reframe(D, V1, V2, F):
    """deltas D authored on embedding V1 -> the same shape change expressed on embedding V2"""
    R, s = local_maps(V1, V2, F); return s[:, None] * np.einsum("vij,vj->vi", R, D)
def laplacian(n, F):
    E = edges(F); A = sp.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n)).tocsr()
    deg = np.asarray(A.sum(1)).ravel(); return sp.diags(1 / np.maximum(deg, 1)) @ A, deg > 0
def smooth_field(X, Lap, has, it=2, lam=0.5):
    X = X.copy()
    for _ in range(it): X[has] += lam * ((Lap @ X)[has] - X[has])
    return X

def closest_bary(p, a, b, c):
    """barycentric coordinates of the closest point on triangle abc to p (Ericson), any broadcastable shapes"""
    ab = b - a; ac = c - a; ap = p - a; d1 = (ab * ap).sum(-1); d2 = (ac * ap).sum(-1)
    bp = p - b; d3 = (ab * bp).sum(-1); d4 = (ac * bp).sum(-1); cp = p - c; d5 = (ab * cp).sum(-1); d6 = (ac * cp).sum(-1)
    vc = d1 * d4 - d3 * d2; vb = d5 * d2 - d1 * d6; va = d3 * d6 - d5 * d4
    nz = lambda x: np.where(np.abs(x) < 1e-30, 1e-30, x)
    den = 1 / nz(va + vb + vc); v = vb * den; w = vc * den
    t = (d4 - d3) / nz((d4 - d3) + (d5 - d6)); m = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0); v = np.where(m, 1 - t, v); w = np.where(m, t, w)
    t = d2 / nz(d2 - d6); m = (vb <= 0) & (d2 >= 0) & (d6 <= 0); v = np.where(m, 0, v); w = np.where(m, t, w)
    m = (d6 >= 0) & (d5 <= d6); v = np.where(m, 0, v); w = np.where(m, 1, w)
    t = d1 / nz(d1 - d3); m = (vc <= 0) & (d1 >= 0) & (d3 <= 0); v = np.where(m, t, v); w = np.where(m, 0, w)
    m = (d3 >= 0) & (d4 <= d3); v = np.where(m, 1, v); w = np.where(m, 0, w)
    m = (d1 <= 0) & (d2 <= 0); v = np.where(m, 0, v); w = np.where(m, 0, w)
    return np.stack([1 - v - w, v, w], -1)
def surface_map(P, NP, V, F, k=8, max_tris=48, ndot=0.2):
    """for each point P (with normal NP): triangle of (V,F), barycentric weights, distance; closest point among the
    triangles around the k nearest vertices whose normal agrees with NP (so the two sides of a skin fold never swap)."""
    n = len(V); order = np.argsort(F.ravel(), kind="stable"); vt = (np.arange(F.size) // 3)[order]; start = np.searchsorted(F.ravel()[order], np.arange(n + 1))
    FN = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); FN /= np.maximum(np.linalg.norm(FN, axis=1, keepdims=True), 1e-30)
    _, nn = cKDTree(V).query(P, k=k); tri = np.zeros(len(P), np.int64); bary = np.zeros((len(P), 3)); dist = np.full(len(P), np.inf); agree = np.zeros(len(P), bool)
    for s in range(0, len(P), 2000):
        sl = slice(s, min(s + 2000, len(P))); cand = np.full((sl.stop - s, max_tris), -1, np.int64)
        for i, row in enumerate(nn[sl]):
            t = np.unique(np.concatenate([vt[start[v]:start[v + 1]] for v in row]))[:max_tris]; cand[i, :len(t)] = t
        ok = cand >= 0; cc = np.where(ok, cand, 0); p = P[sl][:, None, :]
        a, b, c = V[F[cc, 0]], V[F[cc, 1]], V[F[cc, 2]]; bc = closest_bary(p, a, b, c)
        q = bc[..., :1] * a + bc[..., 1:2] * b + bc[..., 2:] * c; d = np.linalg.norm(q - p, axis=-1)
        good = ok & ((FN[cc] * NP[sl][:, None, :]).sum(-1) > ndot)
        d1 = np.where(good, d, np.inf); has = good.any(1); d2 = np.where(has[:, None], d1, np.where(ok, d, np.inf)); j = d2.argmin(1); r = np.arange(len(j))
        tri[sl] = cc[r, j]; bary[sl] = bc[r, j]; dist[sl] = d2[r, j]; agree[sl] = has
    return tri, bary, dist, agree

# ---- metrics (RR/spike.py)
def total_volume(V, F): return float(np.einsum("ij,ij->i", V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])).sum() / 6)
def fan_volume(V, Fs, c): return float(np.einsum("ij,ij->i", V[Fs[:, 0]] - c, np.cross(V[Fs[:, 1]] - c, V[Fs[:, 2]] - c)).sum() / 6)
def _seg_tri(p, q, a, b, c):
    d = q - p; e1 = b - a; e2 = c - a; h = np.cross(d, e2); det = (e1 * h).sum(1); ok = np.abs(det) > 1e-14; inv = 1 / np.where(ok, det, 1)
    s = p - a; u = (s * h).sum(1) * inv; qq = np.cross(s, e1); v = (d * qq).sum(1) * inv; t = (e2 * qq).sum(1) * inv
    return ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0) & (t < 1)
def self_intersections(V, Fs):
    P = V[Fs]; lo = P.min(1); hi = P.max(1); I = []; J = []
    for s in range(0, len(Fs), 400):
        ov = ((lo[s:s + 400, None] <= hi[None]) & (hi[s:s + 400, None] >= lo[None])).all(2); i, j = np.nonzero(ov); i += s; k = i < j; I.append(i[k]); J.append(j[k])
    I = np.concatenate(I); J = np.concatenate(J)
    share = (Fs[I][:, :, None] == Fs[J][:, None, :]).any((1, 2)); I = I[~share]; J = J[~share]
    hit = np.zeros(len(I), bool)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        hit |= _seg_tri(P[I, a], P[I, b], P[J, 0], P[J, 1], P[J, 2]); hit |= _seg_tri(P[J, a], P[J, b], P[I, 0], P[I, 1], P[I, 2])
    bad = np.zeros(len(Fs), bool); bad[I[hit]] = True; bad[J[hit]] = True
    return int(hit.sum()), bad
def ray_far(V, Fs, c, d):
    a = V[Fs[:, 0]]; e1 = V[Fs[:, 1]] - a; e2 = V[Fs[:, 2]] - a; h = np.cross(d, e2); det = (e1 * h).sum(1); ok = np.abs(det) > 1e-14; inv = 1 / np.where(ok, det, 1)
    s = c - a; u = (s * h).sum(1) * inv; q = np.cross(s, e1); v = (q @ d) * inv; t = (e2 * q).sum(1) * inv; hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
    return float(t[hit].max()) if hit.any() else float("nan")
def section_area(V, Fs, c, n):
    d = (V - c) @ n; D = d[Fs]; s = D > 0; cross = s.any(1) & ~s.all(1); Fs = Fs[cross]; D = D[cross]; P = V[Fs]
    fn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); pts = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        hit = (D[:, a] > 0) != (D[:, b] > 0); t = np.where(hit, D[:, a] / np.where(hit, D[:, a] - D[:, b], 1), 0)
        pts.append((hit, P[:, a] + t[:, None] * (P[:, b] - P[:, a])))
    p1 = np.where(pts[0][0][:, None], pts[0][1], pts[1][1]); p2 = np.where(pts[2][0][:, None], pts[2][1], pts[1][1])
    both01 = pts[0][0] & pts[1][0] & ~pts[2][0]; p2 = np.where(both01[:, None], pts[1][1], p2)
    dirn = np.cross(fn, n); flip = ((p2 - p1) * dirn).sum(1) < 0; a_ = np.where(flip[:, None], p2, p1); b_ = np.where(flip[:, None], p1, p2)
    return abs(float((np.cross(a_ - c, b_ - c) @ n).sum() / 2))
