"""Props (owner: B6): small numpy modelling kit used by prop_model.py inside Blender (no bpy here).

Everything is in the package frame (metres, glTF: +X the character's left, +Y up, +Z forward).  A Part is a quad /
triangle soup with a material zone and a binding group; prop_model.py turns Parts into Blender meshes for bevels,
normals and UVs.
"""
import numpy as np


def unit(v):
    v = np.asarray(v, float); n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.where(n > 1e-12, n, 1)


def smoothstep(x, a=0.0, b=1.0):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ profiles (k,2)
def superellipse(a, b, n=28, p=2.4):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    return np.stack([a * np.sign(c) * np.abs(c) ** (2 / p), b * np.sign(s) * np.abs(s) ** (2 / p)], 1)


def rrect(w, h, r, seg=2):
    """Rounded rectangle, counter-clockwise, centred; `seg` segments per corner."""
    r = min(r, w / 2 - 1e-5, h / 2 - 1e-5); pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = np.radians(a0 + 90 * i / seg); pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
    return np.array(pts)


def circle(r, n=8, phase=0.0):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False) + phase
    return np.stack([r * np.cos(t), r * np.sin(t)], 1)


# ------------------------------------------------------------------------------------------------ curves
def bezier(p0, p1, p2, p3, n=16):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * np.asarray(p0) + 3 * (1 - t) ** 2 * t * np.asarray(p1) + 3 * (1 - t) * t ** 2 * np.asarray(p2) + t ** 3 * np.asarray(p3)


def catmull(points, n_per=6, closed=False):
    P = np.asarray(points, float); out = []
    m = len(P)
    idx = (lambda i: i % m) if closed else (lambda i: min(max(i, 0), m - 1))
    for i in range(m if closed else m - 1):
        p0, p1, p2, p3 = P[idx(i - 1)], P[idx(i)], P[idx(i + 1)], P[idx(i + 2)]
        for k in range(n_per):
            t = k / n_per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    if not closed: out.append(P[-1])
    return np.array(out)


def resample(P, n, closed=False):
    P = np.asarray(P, float)
    Q = np.vstack([P, P[:1]]) if closed else P
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]
    s = np.linspace(0, d[-1], n, endpoint=not closed)
    return np.stack([np.interp(s, d, Q[:, k]) for k in range(Q.shape[1])], 1)


def tangents(P, closed=False):
    if closed: return unit(np.roll(P, -1, 0) - np.roll(P, 1, 0))
    T = np.empty_like(P); T[1:-1] = P[2:] - P[:-2]; T[0] = P[1] - P[0]; T[-1] = P[-1] - P[-2]
    return unit(T)


def frames(P, up, closed=False):
    """Tangent, normal (the `up` hint made perpendicular, may be per point), binormal."""
    T = tangents(P, closed); up = np.broadcast_to(np.asarray(up, float), P.shape)
    N = unit(up - (up * T).sum(1, keepdims=True) * T); B = np.cross(T, N)
    return T, N, B


# ------------------------------------------------------------------------------------------------ parts
class Part:
    def __init__(self, name, v, faces, zone, group="rigid", bevel=None, sharp=35.0, soft=None, attr=None):
        self.name = name; self.v = np.asarray(v, float); self.faces = [tuple(int(i) for i in f) for f in faces]
        self.zone = zone; self.group = group; self.bevel = bevel; self.sharp = sharp
        self.soft = np.zeros(len(self.v)) if soft is None else np.asarray(soft, float)     # 0 rigid .. 1 bound to the surface
        self.attr = attr or {}


def grid_faces(nr, nc, close_c=True, close_r=False, flip=False):
    f = []
    for i in range(nr if close_r else nr - 1):
        for j in range(nc if close_c else nc - 1):
            a = i * nc + j; b = i * nc + (j + 1) % nc; c = ((i + 1) % nr) * nc + (j + 1) % nc; d = ((i + 1) % nr) * nc + j
            f.append((a, d, c, b) if flip else (a, b, c, d))
    return f


def loft(rings, cap_start=False, cap_end=False, close_r=False, flip=False):
    """rings: list of (n,3).  Caps are a centre vertex and a fan.  Returns (v, faces)."""
    n = len(rings[0]); v = [np.asarray(r, float) for r in rings]; nr = len(rings)
    faces = grid_faces(nr, n, True, close_r, flip)
    V = np.vstack(v)
    if cap_start:
        c = len(V); V = np.vstack([V, rings[0].mean(0)])
        faces += [((j + 1) % n, j, c) if not flip else (j, (j + 1) % n, c) for j in range(n)]
    if cap_end:
        c = len(V); V = np.vstack([V, rings[-1].mean(0)]); o = (nr - 1) * n
        faces += [(o + j, o + (j + 1) % n, c) if not flip else (o + (j + 1) % n, o + j, c) for j in range(n)]
    return V, faces


def sweep(P, up, profile, closed=False, caps=True, round_ends=0.0, twist=None):
    """Sweep a closed 2-D profile (k,2) (or callable i -> (k,2)) along P.  Profile x runs along the normal (the `up`
    side), y along the binormal.  round_ends: length of a rounded nose added at both ends (two shrinking rings)."""
    P = np.asarray(P, float); T, N, B = frames(P, up, closed)
    rings = []
    for i in range(len(P)):
        pr = profile(i) if callable(profile) else profile
        n_, b_ = N[i], B[i]
        if twist is not None:
            c, s = np.cos(twist[i]), np.sin(twist[i]); n_, b_ = c * N[i] + s * B[i], -s * N[i] + c * B[i]
        rings.append(P[i] + pr[:, :1] * n_ + pr[:, 1:2] * b_)
    if round_ends > 0 and not closed:
        def nose(ring, c, t, sgn):
            out = []
            for f, d in ((0.86, 0.5), (0.55, 0.85)):
                out.append(c + (ring - c) * f + sgn * t * round_ends * d)
            return out
        a = nose(rings[0], P[0], T[0], -1); b = nose(rings[-1], P[-1], T[-1], 1)
        rings = a[::-1] + rings + b
    return loft(rings, cap_start=caps and not closed, cap_end=caps and not closed, close_r=closed)


def box(c, ax, half):
    """Box with centre c, axes ax (3,3 rows) and half sizes; meant for a bevel modifier."""
    c = np.asarray(c, float); ax = np.asarray(ax, float); h = np.asarray(half, float)
    s = np.array([[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], float)
    v = c + (s * h) @ ax
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, f


def cylinder(c, axis, r, h, n=16, up=None):
    """Closed cylinder for a bevel modifier: centre c, axis direction, radius, height."""
    axis = unit(axis); up = np.array([0, 1.0, 0]) if up is None else np.asarray(up, float)
    if abs(axis @ up) > 0.95: up = np.array([1.0, 0, 0])
    n1 = unit(up - (up @ axis) * axis); n2 = np.cross(axis, n1)
    pr = circle(r, n)
    r0 = np.asarray(c) - axis * h / 2 + pr[:, :1] * n1 + pr[:, 1:2] * n2; r1 = r0 + axis * h
    V = np.vstack([r0, r1]); f = grid_faces(2, n, True)
    f += [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    return V, f
