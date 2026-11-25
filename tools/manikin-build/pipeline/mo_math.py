"""Quaternion helpers for the motion pipeline (owner: B4). Quaternions are (..., 4) arrays in x, y, z, w order."""
import numpy as np

def qnorm(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)

def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(np.asarray(a, float), -1, 0); bx, by, bz, bw = np.moveaxis(np.asarray(b, float), -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)

def qinv(q):
    q = np.asarray(q, float); return q * np.array([-1.0, -1.0, -1.0, 1.0])

def qrot(q, v):
    q = np.asarray(q, float); v = np.asarray(v, float); u = q[..., :3]; w = q[..., 3:4]
    t = 2.0 * np.cross(u, v); return v + w * t + np.cross(u, t)

def qaxis(axis, ang):
    axis = np.asarray(axis, float); ang = np.asarray(ang, float)
    axis = axis / np.maximum(np.linalg.norm(axis, axis=-1, keepdims=True), 1e-12)
    return np.concatenate([axis * np.sin(ang / 2)[..., None], np.cos(ang / 2)[..., None]], -1)

def qarc(a, b):
    """Shortest rotation taking direction a to direction b (broadcasts)."""
    a = np.asarray(a, float); b = np.asarray(b, float)
    a = a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12); b = b / np.maximum(np.linalg.norm(b, axis=-1, keepdims=True), 1e-12)
    a, b = np.broadcast_arrays(a, b)
    c = np.cross(a, b); d = (a * b).sum(-1, keepdims=True)
    q = np.concatenate([c, 1.0 + d], -1)
    bad = (1.0 + d[..., 0]) < 1e-8
    if np.any(bad):                                   # opposite directions: any perpendicular axis
        alt = np.cross(a, np.where(np.abs(a[..., :1]) < 0.9, [1.0, 0, 0], [0, 1.0, 0]))
        q[bad] = np.concatenate([alt, np.zeros_like(d)], -1)[bad]
    return qnorm(q)

def qeuler_xyz(rx, ry, rz):
    """Rotation Rz * Ry * Rx (x applied first), angles in degrees (the ASF/AMC convention for 'XYZ')."""
    r = np.radians
    return qmul(qaxis([0, 0, 1.0], r(rz)), qmul(qaxis([0, 1.0, 0], r(ry)), qaxis([1.0, 0, 0], r(rx))))

def qfix(q, axis=0):
    """Make the sign continuous along `axis`."""
    q = np.array(q, float); q = np.moveaxis(q, axis, 0)
    for i in range(1, len(q)):
        flip = (q[i] * q[i - 1]).sum(-1) < 0; q[i][flip] *= -1
    return np.moveaxis(q, 0, axis)

def qslerp(a, b, t):
    a = np.asarray(a, float); b = np.asarray(b, float); t = np.asarray(t, float)[..., None]
    d = (a * b).sum(-1, keepdims=True); b = np.where(d < 0, -b, b); d = np.abs(d).clip(0, 1)
    th = np.arccos(d); s = np.sin(th); small = s < 1e-6
    wa = np.where(small, 1 - t, np.sin((1 - t) * th) / np.where(small, 1, s)); wb = np.where(small, t, np.sin(t * th) / np.where(small, 1, s))
    return qnorm(wa * a + wb * b)

def qlog(q):
    """Rotation vector (axis * angle, radians), shortest way round."""
    q = np.asarray(q, float); q = np.where(q[..., 3:4] < 0, -q, q)
    n = np.linalg.norm(q[..., :3], axis=-1, keepdims=True); ang = 2 * np.arctan2(n, q[..., 3:4])
    return q[..., :3] * np.where(n < 1e-12, 2.0, ang / np.maximum(n, 1e-12))

def qexp(r):
    r = np.asarray(r, float); ang = np.linalg.norm(r, axis=-1, keepdims=True)
    return np.concatenate([r * np.where(ang < 1e-12, 0.5, np.sin(ang / 2) / np.maximum(ang, 1e-12)), np.cos(ang / 2)], -1)

def qangle(a, b):
    """Angle between two rotations in degrees."""
    d = np.abs((np.asarray(a) * np.asarray(b)).sum(-1)).clip(0, 1); return np.degrees(2 * np.arccos(d))

QI = np.array([0.0, 0.0, 0.0, 1.0])
