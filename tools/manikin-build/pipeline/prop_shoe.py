"""Props (owner: B6): a mid-cut safety trainer built on a last (Last, build_shoe), and, from round 4, the abstract style's own
last (CleanLast, build_last: a simplified low work trainer whose collar is the upper's rolled top edge; see the section at
the end of this file and R4).  numpy only; no bpy.

The last is a parametric surface S(t, column): t = 0 at the back of the heel, 1 at the toe tip; 17 columns run from the
lateral feather line (0) up the side (1-5) to the lateral throat edge (6), across the top strip (7-9: tongue / vamp
crown; open where the leg enters), to the medial throat edge (10) and down the medial side to the feather line (16).
It is sized from the body's own foot (length, heel and ball width and their centre lines, instep height) and from the
section of its leg at collar height, so it is re-made for any base body.  Round 3 (the designer's review of the
abstract style): the collar is one smooth line above the ankle bones with a rolled lip (no heel tab, no dip: "no
notches"), the opening is the leg's own section plus ease, the leg ends inside it; toe box and upper are slimmer.
Local frame: x = along the foot from the heel, y = up (0 = the bare sole), u = to the outside of the LEFT foot.
"""
import numpy as np
import prop_geo as g
from prop_geo import Part, unit, smoothstep

NC = 17
UP = np.array([0, 1.0, 0])


def measure_foot(fv, sole_y=0.0):
    """fv: vertices of the left foot (below the ankle).  Returns the frame and the measures."""
    low = fv[fv[:, 1] < sole_y + 0.02]
    c2 = low[:, [0, 2]].mean(0); X2 = low[:, [0, 2]] - c2
    w, E = np.linalg.eigh(X2.T @ X2); f = E[:, -1]; f = f if f[1] > 0 else -f
    F = np.array([f[0], 0, f[1]]); S = np.cross([0, 1.0, 0], F)
    x = fv @ F; u = fv @ S; x0, x1 = x.min(), x.max(); L = x1 - x0; t = (x - x0) / L
    def band(a, b, ymax=0.035):
        m = (t > a) & (t < b) & (fv[:, 1] < sole_y + ymax); return u[m].min(), u[m].max()
    hm, hl = band(0.08, 0.2); best = None
    for a in np.arange(0.58, 0.80, 0.02):
        m_, l_ = band(a, a + 0.04)
        if best is None or l_ - m_ > best[1] - best[0]: best = (m_, l_, a + 0.02)
    tip = u[t > 0.97].mean()
    top = {}
    for a in np.arange(0.40, 0.96, 0.05):
        m = (t > a - 0.03) & (t < a + 0.03); top[round(float(a), 2)] = float(fv[m, 1].max() - sole_y)
    et = np.arange(0.05, 0.99, 0.05); el = []; em = []
    for a in et:
        mk = (np.abs(t - a) < 0.035) & (fv[:, 1] < sole_y + 0.045); el.append(u[mk].max()); em.append(u[mk].min())
    edges = np.array([et, el, em])                                                  # the foot's own lateral and medial edge along its length
    return dict(edges=edges, F=F, S=S, x0=float(x0), length=float(L), heel_w=float(hl - hm), heel_c=float(0.5 * (hl + hm)), ball_w=float(best[1] - best[0]),
                ball_c=float(0.5 * (best[0] + best[1])), ball_t=float(best[2]), tip_u=float(tip), top=top, sole_y=float(sole_y))


def collar_height(m): return 0.118 * m["length"] / 0.262          # above the ankle bones, where the leg is a clean oval


def measure_leg(lv, m):
    """lv: vertices of the left leg in a band round the collar height.  Section of the leg there, in the foot's frame."""
    x = lv @ m["F"] - m["x0"]; u = lv @ m["S"]
    return dict(xc=float(0.5 * (x.min() + x.max())), ax=float(0.5 * (x.max() - x.min())), uc=float(0.5 * (u.min() + u.max())), b=float(0.5 * (u.max() - u.min())), H=collar_height(m))


class Last:
    def __init__(self, m, toe_room=0.011, heel_room=0.004, ease=0.0026, collar_ease=0.0045):
        self.m = m; self.Ls = m["length"] + toe_room + heel_room; self.k = m["length"] / 0.262          # size factor for heights
        self.xh = m["x0"] - heel_room; self.ease = ease; self._ex = {}
        tt = np.array(sorted(m["top"])); hh = np.array([m["top"][a] for a in tt])
        self._top_t = (tt * m["length"] + heel_room) / self.Ls; self._top_h = hh
        lg = m["leg"]; self.H = lg["H"]; self.xc = lg["xc"] + heel_room; self.uc = lg["uc"]
        self.ax_ = lg["ax"] + collar_ease; self.bb = lg["b"] + collar_ease
        self.tb = max((self.xc - self.ax_) / self.Ls, 0.03); self.tf = (self.xc + self.ax_ + 0.003) / self.Ls

    # ---- plan
    def centre(self, t):
        m = self.m; c = m["heel_c"] + (m["ball_c"] - m["heel_c"]) * smoothstep(t, 0.12, 0.70)
        return c + 0.45 * (m["tip_u"] - m["ball_c"]) * smoothstep(t, 0.74, 1.0)

    def half(self, t, side=0):
        m = self.m; t = np.asarray(t, float)
        ah = m["heel_w"] / 2 + self.ease + 0.001; ab = m["ball_w"] / 2 + self.ease
        a = ah + (ab - ah) * smoothstep(t, 0.20, 0.70) - 0.0025 * np.exp(-((t - 0.42) / 0.10) ** 2)
        a = a * (1 - 0.065 * smoothstep(t, 0.70, 0.86))                                # toe box slimmed (the designer: 5 to 8 per cent)
        heel = np.sqrt(np.clip(1 - (1 - np.clip(t / 0.17, 0, 1)) ** 2.2, 0, 1))
        x = np.clip((t - 0.72) / 0.28, 0, 1); toe = np.clip(1 - x ** 2.35, 0, 1) ** (1 / 2.0)
        a = np.maximum(a * heel * toe, 0.0)
        if side == 0: return a
        # Never narrower than the foot plus 2 mm, but as ONE smooth swell per side (seen in the viewer without a body
        # mask: the little-toe side came through; following the foot's edge station by station dented the upper).
        if side not in self._ex:
            e = m["edges"]; tl = (e[0] * m["length"] + (m["x0"] - self.xh)) / self.Ls; c = self.centre(tl)
            foot = (e[1] - c) if side > 0 else (c - e[2]); k = (tl > 0.30) & (tl < 0.93)
            self._ex[side] = float(np.clip((foot + 0.002 - self.half(tl))[k].max(), 0, 0.008))
        return a + self._ex[side] * smoothstep(t, 0.22, 0.50) * smoothstep(t, 0.985, 0.88)

    # ---- heights
    def rim(self, t):
        """The collar line over the opening: one smooth curve, 2 % lower at the sides, 4 % higher at the tongue."""
        s = np.clip((np.asarray(t, float) - self.tb) / (self.tf - self.tb), 0, 1)
        return self.H * (1.0 - 0.02 * np.sin(np.pi * s) + 0.04 * s)

    def crown(self, t):
        t = np.asarray(t, float); k = self.k; tf = self.tf
        foot = np.interp(t, self._top_t, self._top_h) + 0.005
        design = np.interp(t, [tf, tf + 0.07, tf + 0.16, 0.70, 0.86, 0.93, 1.0], [1.04 * self.H + 0.002, 0.90 * self.H, 0.74 * self.H, 0.056 * k, 0.0435 * k, 0.041 * k, 0.041 * k])
        c = np.where((t > tf + 0.03) & (t < 0.90), np.maximum(foot, design), design)
        x = np.clip((t - 0.90) / 0.10, 0, 1); nose = np.clip(1 - x ** 2.4, 0, 1) ** (1 / 2.0)
        return 0.010 * k + (c - 0.010 * k) * nose

    def throat_w(self, t):
        t = np.asarray(t, float); x = t * self.Ls; xb = self.xc - self.ax_; xf = self.xc + self.ax_ + 0.003
        back = self.bb * np.clip(1 - np.clip((self.xc - x) / (self.xc - xb), 0, 1) ** 2.2, 0, 1) ** (1 / 2.2)
        front = self.bb * (1 - 0.38 * np.clip((x - self.xc) / (xf - self.xc), 0, 1) ** 2)
        wf = 0.62 * self.bb; s = self.m["ball_w"] / 0.098
        vamp = np.interp(t, [self.tf, self.tf + 0.10, 0.62, 0.78, 0.90, 1.0], [wf, 0.6 * wf + 0.4 * 0.0155 * s, 0.0145 * s, 0.012 * s, 0.009 * s, 0.0008])
        w = np.where(t < self.tb, 0.0007, np.where(x < self.xc, back, np.where(t <= self.tf, front, vamp)))
        return np.maximum(np.where(t > self.tf, np.minimum(w, 0.72 * self.half(t) + 0.0008), w), 0.0007)

    def throat_c(self, t):
        return self.centre(t) + (self.uc - self.centre(t)) * smoothstep(t, self.tf + 0.14, self.tf)

    def throat_y(self, t):
        t = np.asarray(t, float)
        back = self.H * (0.30 + 0.70 * np.clip(t / self.tb, 0, 1) ** 0.7)                 # the back seam leans forward to the collar
        vamp = self.crown(t) - 0.0025 * smoothstep(t, 1.0, 0.9)
        return np.where(t < self.tb, back, np.where(t <= self.tf, self.rim(t), vamp))

    FEATHER = 0.0025

    def section(self, t, tongue=True):
        """(17,3) local points (x, y, u) of the station at t."""
        a = float(self.half(t)); al = {1: float(self.half(t, 1)), -1: float(self.half(t, -1))}; c = float(self.centre(t)); ct = float(self.throat_c(t)); wt = float(self.throat_w(t)); yt = float(self.throat_y(t)); x = t * self.Ls
        rear = float(smoothstep(t, self.tf + 0.16, self.tf)); p = 1.9 + 1.4 * rear; q = 1.9 - 0.45 * rear
        yf = self.FEATHER; pts = np.zeros((NC, 3)); pts[:, 0] = x
        s = np.linspace(0, 1, 7); bulge = 0.0045 * rear * np.sin(np.pi * s) * (a > 0.01)       # room for the ankle bones
        for sgn, sl in ((1, slice(0, 7)), (-1, slice(16, 9, -1))):
            foot_u = c + sgn * al[sgn]; top_u = ct + sgn * wt
            us = foot_u + (top_u - foot_u) * s ** p + sgn * bulge
            pts[sl, 1] = yf + (yt - yf) * (1 - (1 - s) ** q); pts[sl, 2] = us
        kk = np.array([0.25, 0.5, 0.75]); cr = float(self.crown(t)) if t > self.tf else yt
        rec = 0.0022 * float(smoothstep(t, 0.80, 0.74) * smoothstep(t, self.tf, self.tf + 0.03)) if tongue else 0.0
        pts[7:10, 2] = ct + wt * (1 - 2 * kk); pts[7:10, 1] = yt + (cr - yt) * (1 - (2 * kk - 1) ** 2) - rec
        return pts

    def stations(self, n_open=11, n_mid=13):
        tb, tf = self.tb, self.tf
        op = tb + (tf - tb) * (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n_open)))
        return np.unique(np.round(np.r_[0.0, 0.3 * tb, 0.65 * tb, op, np.linspace(tf, 0.86, n_mid)[1:], 0.90, 0.935, 0.962, 0.982, 0.994], 6))

    def world(self, loc):
        m = self.m; loc = np.asarray(loc, float)
        return (self.xh + loc[..., 0:1]) * m["F"] + (m["sole_y"] + loc[..., 1:2]) * UP + loc[..., 2:3] * m["S"]

    def local_t(self, v): return (np.asarray(v) @ self.m["F"] - self.xh) / self.Ls

    def grid(self, tt, tongue=True):
        return np.array([self.section(float(t), tongue) for t in tt])                 # (nt, 17, 3) local

    def sample(self, t, col, tongue=True):
        """Point and outward normal at fractional column (world)."""
        def P(t_, c_):
            sct = self.section(float(np.clip(t_, 0, 1)), tongue); c_ = float(np.clip(c_, 0, NC - 1)); i = min(int(c_), NC - 2); f = c_ - i
            return self.world((1 - f) * sct[i] + f * sct[i + 1])
        p = P(t, col); dt = P(t + 0.004, col) - P(t - 0.004, col); dc = P(t, col + 0.25) - P(t, col - 0.25)
        n = unit(np.cross(dc, dt)); cen = self.world(np.array([t * self.Ls, 0.02, float(self.centre(t))]))
        if n @ (p - cen) < 0: n = -n
        return p, n

    def outline(self, n_side=22):
        tt = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n_side))                       # denser at heel and toe
        lat = np.stack([tt * self.Ls, np.zeros(n_side), self.centre(tt) + self.half(tt, 1)], 1)
        med = np.stack([tt * self.Ls, np.zeros(n_side), self.centre(tt) - self.half(tt, -1)], 1)
        loop = np.vstack([lat, med[::-1][1:-1]]); tl = np.r_[tt, tt[::-1][1:-1]]
        return loop, tl

    def rim_loop(self, n=30, tongue=True):
        """The edge of the opening as a closed loop (world): lateral side heel to tongue, across the tongue, medial side back."""
        ts = self.tb + (self.tf - self.tb) * (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, 13)))
        pts = [self.sample(t, 6.0, tongue)[0] for t in ts] + [self.sample(self.tf, c, tongue)[0] for c in (7.0, 8.0, 9.0)] + [self.sample(t, 10.0, tongue)[0] for t in ts[::-1]]
        return g.resample(np.array(pts[:-1]), n, closed=True)

    def inside(self): return self.world(np.array([0.45 * self.Ls, 0.03, float(self.centre(0.45))]))


def patch(last, t0, t1, c0, c1, off, zone, name, nt=7, nc=7, t_edge=None, tuck=(True, True, True, True), eps_t=0.006, eps_c=0.22, stitch=True):
    """An overlay panel riding `off` above the last, with its border tucked into the surface.  t_edge: callable col -> (t0, t1).
    Carries `sd` (distance to the nearest tucked edge, metres) and `sl` (length along that edge) for the stitch line."""
    def lin(a, b, n, ta, tb, eps):
        v = list(np.linspace(a, b, n))
        if ta: v = [a] + [a + eps] + v[1:]
        if tb: v = v[:-1] + [b - eps] + [b]
        return np.array(v)
    cs = lin(c0, c1, nc, tuck[2], tuck[3], eps_c); V = []; nrow = None
    for c in cs:
        a, b = (t0, t1) if t_edge is None else t_edge(c)
        ts = lin(a, b, nt, tuck[0], tuck[1], eps_t); nrow = len(ts)
        for i, t in enumerate(ts):
            p, n = last.sample(t, c)
            border = (tuck[0] and i == 0) or (tuck[1] and i == len(ts) - 1) or (tuck[2] and c == cs[0]) or (tuck[3] and c == cs[-1])
            V.append(p + n * (-0.0004 if border else off))
    V = np.array(V); Gd = V.reshape(len(cs), nrow, 3)
    ct = np.concatenate([np.zeros((len(cs), 1)), np.cumsum(np.linalg.norm(np.diff(Gd, axis=1), axis=2), axis=1)], 1)      # along t
    cc = np.concatenate([np.zeros((1, nrow)), np.cumsum(np.linalg.norm(np.diff(Gd, axis=0), axis=2), axis=0)], 0)        # along columns
    cand = []
    if tuck[0]: cand.append((ct, cc))
    if tuck[1]: cand.append((ct[:, -1:] - ct, cc))
    if tuck[2]: cand.append((cc, ct))
    if tuck[3]: cand.append((cc[-1:, :] - cc, ct))
    sd = np.full(Gd.shape[:2], 1.0); sl = np.zeros(Gd.shape[:2])
    for d_, l_ in cand:
        m_ = d_ < sd; sd = np.where(m_, d_, sd); sl = np.where(m_, l_, sl)
    F = g.grid_faces(len(cs), nrow, close_c=False)
    return Part(name, V, F, zone, group="affine", sharp=50, attr=dict(recalc=False, orient=True, sd=sd.ravel() if stitch else None, sl=sl.ravel()))


def _upper(L, Z, tongue, zone_lace=None):
    tt = L.stations(); G = L.world(L.grid(tt, tongue)); nt = len(tt); F = []; zone = []
    for i in range(nt - 1):
        tm = 0.5 * (tt[i] + tt[i + 1])
        for j in range(NC - 1):
            strip = 6 <= j < 10
            if strip and L.tb - 1e-6 < tm < L.tf: continue                           # the opening
            F.append((i * NC + j, i * NC + j + 1, (i + 1) * NC + j + 1, (i + 1) * NC + j))
            zone.append(zone_lace if (zone_lace is not None and strip and L.tf < tm < 0.775) else Z)
    V = G.reshape(-1, 3); tipi = len(V); V = np.vstack([V, L.world(np.array([L.Ls + 0.0006, 0.006 * L.k, float(L.centre(1.0))]))])
    o = (nt - 1) * NC
    for j in range(NC - 1): F.append((o + j, o + j + 1, tipi)); zone.append(Z)
    return V, F, zone


def _collar(L, Z_lip, Z_in, radius, tongue, name):
    """Rolled lip on the edge of the opening, a funnel going down inside it and a floor: the leg ends inside the collar."""
    rim = L.rim_loop(30, tongue); cen = rim.mean(0); out = unit((rim - cen) * [1, 0, 1])
    lip_c = rim - out * (radius * 0.35) + UP * (radius * 0.15)
    lv, lf = g.sweep(lip_c, UP, g.circle(radius, 6, phase=np.pi / 6), closed=True)
    parts = [Part(name + "_lip", lv, lf, Z_lip, group="affine", sharp=180)]
    r1 = rim - out * (radius * 0.9) - UP * 0.002; r2 = cen + (rim - cen) * [0.84, 1, 0.84] - UP * 0.010; r3 = cen + (rim - cen) * [0.80, 1, 0.80] - UP * 0.024
    fv = np.vstack([r1, r2, r3, (r3.mean(0))[None]]); n = len(rim); ff = g.grid_faces(3, n, close_c=True) + [(2 * n + j, 2 * n + (j + 1) % n, 3 * n) for j in range(n)]
    parts.append(Part(name + "_funnel", fv, ff, Z_in, group="affine", sharp=180, attr=dict(recalc=False, orient_up=True)))
    return parts


def _sole(L, sole, Zmid, Zout, n_side=22, plain=False):
    m = L.m; loop, tl = L.outline(n_side); NO = len(loop)
    lw = L.world(loop); cen = lw.mean(0); tang = unit(np.roll(lw, -1, 0) - np.roll(lw, 1, 0)); nrm = unit(np.cross(tang, UP))
    nrm *= np.sign(((lw - cen) * nrm).sum(1))[:, None]
    medial = np.r_[np.zeros(n_side), np.ones(NO - n_side)]; ground = -sole
    spring = 0.011 * smoothstep(tl, 0.72, 1.0) ** 1.6 + 0.004 * smoothstep(tl, 0.10, 0.0) ** 1.5
    def ring(off, y, sp=1.0, lg=0.0):
        p = lw + nrm * (np.asarray(off) + lug * lg)[:, None]; p[:, 1] = m["sole_y"] + np.asarray(y) + spring * sp
        return p
    if plain:
        lug = np.zeros(NO)
        rows = [ring(-0.006, 0.006, 0.2), ring(0.0012, 0.0074, 0.2), ring(0.0034, 0.0050, 0.3), ring(0.0040, ground + 0.004, 1.0), ring(0.0020, ground, 1.0), ring(-0.010, ground + 0.0006, 1.0)]
        sv, sf = g.loft(rows, cap_start=True, cap_end=True)
        return Part("sole", sv, sf, Zmid, group="affine", sharp=42)
    wall = 0.007 + 0.011 * smoothstep(tl, 0.45, 0.02) + 0.012 * smoothstep(tl, 0.80, 1.0)          # how far the midsole climbs the upper
    split = ground + 0.40 * sole + 0.004 * smoothstep(tl, 0.5, 0.0)                              # wedge: the midsole is deeper at the heel
    arch = np.exp(-((tl - 0.43) / 0.085) ** 2)
    lug = np.where((np.arange(NO) % 2 == 0) & (arch < 0.6), 0.0018, 0.0)
    rows = [ring(-0.006, wall - 0.001, 0.2), ring(0.0012, wall + 0.0004, 0.2), ring(0.0032, wall - 0.0022, 0.25), ring(0.0050, 0.001, 0.5),
            ring(0.0052, split + 0.0030, 0.9), ring(0.0044, split + 0.0010, 0.95), ring(0.0030, split + 0.0002, 1.0), ring(0.0030, split - 0.0012, 1.0),
            ring(0.0052 - 0.003 * arch * medial, split - 0.0024, 1.0, 1), ring(0.0052 - 0.003 * arch * medial, ground + 0.0032 + 0.003 * arch, 1.0, 1),
            ring(0.0026 - 0.003 * arch * medial, ground + 0.004 * arch, 1.0, 1), ring(-0.010, ground + 0.0008 + 0.005 * arch, 1.0)]
    sv, sf = g.loft(rows, cap_start=True, cap_end=True); zs = []
    for i in range(len(rows) - 1): zs += [Zmid if i < 6 else Zout] * NO
    zs += [Zmid] * NO + [Zout] * NO
    return Part("sole", sv, sf, zs, group="affine", sharp=42)


def _leg_follow(L, parts):
    """soft = how much a vertex rides on the leg surface instead of the foot's affine map: the collar follows the leg's
    girth and the shin's angle, so the ankle never comes through its edge; everything below stays with the foot."""
    for p in parts:
        if p.group != "affine": continue
        y = p.v[:, 1] - L.m["sole_y"]; t = L.local_t(p.v)
        p.soft = smoothstep(y, 0.55 * L.H, 0.90 * L.H) * smoothstep(t, L.tf + 0.05, L.tf - 0.04)
        if isinstance(p.attr.get("orient"), bool) and p.attr["orient"]: p.attr["orient"] = L.inside()


def build_shoe(m, sole, Z):
    """Parts of the LEFT safety trainer (world frame).  sole: sole height in metres (bare sole to the ground)."""
    L = Last(m); parts = []
    V, F, zone = _upper(L, Z["shoe_upper"], True, Z["shoe_lace"])
    parts.append(Part("upper", V, F, zone, group="affine", sharp=62, attr=dict(recalc=False, orient=True)))
    parts.append(_sole(L, sole, Z["shoe_midsole"], Z["shoe_outsole"]))
    # ---- overlays: toe cap, heel counter, eyestays (each with a stitch line inside its edge)
    def toe_edge(c): s = abs(c - 8) / 8.0; return (0.805 - 0.045 * s ** 1.5, 0.9935)
    parts.append(patch(L, 0, 1, 0.0, 16.0, 0.0017, Z["shoe_cap"], "toecap", nt=8, nc=15, t_edge=toe_edge, tuck=(True, False, False, False)))
    te = L.tb + 0.20
    parts.append(patch(L, 0, 1, 0.0, 4.4, 0.0016, Z["shoe_cap"], "counter_lat", nt=7, nc=6, t_edge=lambda c: (0.012, te - 0.012 * c), tuck=(False, True, False, True)))
    parts.append(patch(L, 0, 1, 11.6, 16.0, 0.0016, Z["shoe_cap"], "counter_med", nt=7, nc=6, t_edge=lambda c: (0.012, te - 0.012 * (16 - c)), tuck=(False, True, True, False)))
    e0 = L.tf - 0.10
    parts.append(patch(L, e0, 0.80, 4.6, 6.05, 0.0015, Z["shoe_upper"], "eyestay_lat", nt=9, nc=3, tuck=(True, True, True, False)))
    parts.append(patch(L, e0, 0.80, 9.95, 11.4, 0.0015, Z["shoe_upper"], "eyestay_med", nt=9, nc=3, tuck=(True, True, False, True)))
    # ---- lacing: bars across the tongue ending in eyelets on the eyestays
    for i, t in enumerate(np.linspace(L.tf + 0.015, 0.765, 6)):
        pts = []
        for c in (5.5, 6.3, 7.2, 8.0, 8.8, 9.7, 10.5):
            p, n = L.sample(t, c); pts.append(p + n * (0.0027 if 6 < c < 10 else 0.0020))
        lv, lf = g.sweep(np.array(pts), UP, g.rrect(0.0024, 0.0044, 0.001, 1), caps=True)
        parts.append(Part("lace%d" % i, lv, lf, Z["shoe_lace"], group="affine", sharp=60))
        for c in (5.42, 10.58):
            p, n = L.sample(t, c); ev, ef = g.cylinder(p + n * 0.0019, n, 0.0031, 0.0012, 6)
            parts.append(Part("eyelet%d_%d" % (i, c > 8), ev, ef, Z["shoe_eyelet"], group="affine", sharp=50))
    parts += _collar(L, Z["shoe_lining"], Z["shoe_lining"], 0.0062, True, "collar")
    _leg_follow(L, parts)
    return parts, L


def build_last_r3(m, sole, Z):
    """Round 3's last (kept for reference; HF15 "a galosh or a slipper"): the trainer's mid-cut upper closed over, a lip tube on its rim."""
    L = Last(m); V, F, zone = _upper(L, Z["last"], False)
    parts = [Part("last_upper", V, F, zone, group="affine", sharp=62, attr=dict(recalc=False, orient=True)), _sole(L, sole, Z["last"], Z["last"], 18, plain=True)]
    parts += _collar(L, Z["last"], Z["last"], 0.0050, False, "last_collar")
    _leg_follow(L, parts)
    return parts, L


# ================================================================================================ round 4: the abstract style's last
# REVIEW-05 item 4 / HF15 twice ("a galosh or a slipper"): round 3's last was the trainer's mid-cut upper closed over, with a
# separate lip tube on its rim (a cord ring with a step down to the leg), a flat slab sole, a collapsed strip down the back seam
# (the dark slit on the heel counter) and its collar in the ankle's skin-weight blend (the buckle at -45). Round 4 is its own
# form, a simplified low work trainer, built ray by ray round the ankle joint (local frame of the foot: x along the foot from
# the bare heel, y up from the bare sole, u to the outside of the LEFT foot; rays at angle th: (cos th, sin th) in (x, u)):
#   plan     the footprint of the foot (convex hull of its vertices below 45 mm, toes stretched by the toe room) set out by
#            3.5 mm: the toe box follows the foot and is never narrower than the foot plus 2 mm
#   upper    along each ray the outer surface is the foot's own surface (toe room included, toe clefts filled) plus a clearance
#            (5 mm low down, 2.6 mm under the collar), held out to the plan outline up to 16 mm above the sole's edge, smoothed
#            and made to rise inward only: no lacing, no seam, no tongue
#   collar   the top edge of the upper itself: it hugs the leg 2.6 mm off the skin, rolls over (about 2 mm radius) and goes
#            1.3 mm into the leg, then a lining 9 mm deep and a floor. Low at the sides (under the ankle bones, where the skin
#            still follows the foot: foot weight 0.9 and more), higher at the heel and at the front of the ankle; it lies on the
#            skin all round (no stand-off at the Achilles)
#   sole     one band: a crisp top ledge 2.5 mm proud of the upper, a rounded foot; taller at the heel than at the forefoot (the
#            drop), toe spring 13 mm at the tip, a heel bevel; flat on the ground from the heel to the ball, 28 mm under the bare sole
#   counter  a heel counter, an overlay 1.3 mm proud with a tucked edge, from inside the sole round the heel
R4 = dict(
    hull_y=0.045, ease_out=0.0035, toe_room=0.009, toe_from=0.62, toe_round=2.6,  # plan; the toe's plan is at least a superellipse over the ball width
    c_low=0.0055, c_top=0.0026, c_back=0.0012, c_min=0.0026, c_fade=(0.004, 0.028), cleft_mm=0.0,           # clearance of the outer surface over the skin (toe clefts: the dome covers the toes)
    c_vamp=0.0045, c_toe=0.0080, p_instep=2.2, p_toe=2.5, nose_pow=0.8,         # the vamp dome: clearance on the instep / over the toes, cross-section exponent there
    wall_instep=0.006, wall_toe=0.012, c_side=0.0024,                           # the dome's roof springs from a wall this high above the sole's edge; side clearance (normal)
    vamp_fade=(0.008, 0.026), vamp_k=0.003, vamp_in=0.030,                                     # the dome fades out from 26 to 8 mm under the collar; its join to the walls
    base_y=0.014, base_y_toe=0.014, base_y_nose=0.014, nose_deg=(6.0, 16.0),   # the plan outline holds the wall up to base_y above the sole's edge (toe box sides, nose)
    smax_k=0.005, blur_th=0.0, blur_th_side=5.0, blur_y=3.0, blur_mono=2.5, hull_below=0.010,                                     # no blur across rays: r(theta) is steep at the toe's corners, a blur there inflates the wall
    h_back=0.95, h_side=0.655, h_front=1.08, p_front=3.0, p_back=2.0,         # collar edge on the skin, as fractions of the ankle joint's height above the bare sole
    inset=0.0013, roll_drop=0.0019, lining=0.009,                             # collar: depth into the leg, start of the roll under the edge, lining depth
    sole_top_heel=0.005, sole_top_fore=-0.003, drop_at=(0.25, 0.65),           # sole's top edge above the bare sole: heel, forefoot (the visible drop)
    spring=0.018, spring_from=0.60, spring_pow=1.5, heel_bevel=0.004, ledge=0.0025,   # toe spring at the tip; heel bevel; how far the sole stands out of the upper
    counter_off=0.0012, counter_bevel=0.0035, counter_sink=0.002, counter_top=0.64, counter_fade=(40.0, 100.0),          # heel counter: proud by, top edge (fraction of the wall at the back), sweeps down (degrees from the back)
    bump_off=0.0012, bump_h=0.016, bump_fade=(18.0, 62.0),                     # toe bumper: proud by, height above the sole at the tip, fades out (degrees from the toe)
    n_ray=64, n_out=21, n_roll=5, n_lin=2, ring_h=0.4, ring_smooth=1.0, taubin=4)                         # mesh: rays, rings on the outer surface (spaced 60 % by arc, 40 % by height), roll, lining


def _cr2(a, b): return a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]


def _hull2(P):
    """Convex hull of 2-D points, counter-clockwise (monotone chain)."""
    P = np.unique(np.round(np.asarray(P, float), 7), axis=0); P = P[np.lexsort((P[:, 1], P[:, 0]))]
    def half(pts):
        h = []
        for p in pts:
            while len(h) >= 2 and _cr2(h[-1] - h[-2], p - h[-2]) <= 0: h.pop()
            h.append(p)
        return h
    lo, up = half(P), half(P[::-1])
    return np.array(lo[:-1] + up[:-1])


def _slice(T, y):
    """(k,2,2) segments in (x, u) where the local triangles T (K,3,3; x, y, u) cross the plane at height y."""
    d = T[:, :, 1] - y; pos = d >= 0; m = pos.any(1) & ~pos.all(1)
    if not m.any(): return np.zeros((0, 2, 2))
    Tm, dm, pm = T[m], d[m], pos[m]; P = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        c = pm[:, a] != pm[:, b]; t = dm[:, a] / np.where(c, dm[:, a] - dm[:, b], 1.0)
        P.append(np.where(c[:, None], Tm[:, a] + t[:, None] * (Tm[:, b] - Tm[:, a]), np.nan))
    P = np.stack(P, 1); o = np.argsort(np.isnan(P[:, :, 0]), axis=1, kind="stable")[:, :2]
    return np.take_along_axis(P, o[:, :, None], 1)[:, :, [0, 2]]


def _far(o, D, seg):
    """Farthest hit of the 2-D rays o + t D (t > 0) on the segments; nan where none."""
    if len(seg) == 0: return np.full(len(D), np.nan)
    a = seg[:, 0] - o; e = seg[:, 1] - seg[:, 0]
    cde = D[:, None, 0] * e[None, :, 1] - D[:, None, 1] * e[None, :, 0]; ok = np.abs(cde) > 1e-14; cde = np.where(ok, cde, 1.0)
    t = (a[None, :, 0] * e[None, :, 1] - a[None, :, 1] * e[None, :, 0]) / cde
    s = (a[None, :, 0] * D[:, None, 1] - a[None, :, 1] * D[:, None, 0]) / cde
    r = np.where(ok & (t > 0) & (s >= 0) & (s <= 1), t, -1.0).max(1)
    return np.where(r > 0, r, np.nan)


def _blur(A, s, axis, wrap):
    if s <= 0: return A
    k = int(np.ceil(3 * s)); x = np.arange(-k, k + 1); w = np.exp(-0.5 * (x / s) ** 2); w /= w.sum()
    A = np.moveaxis(A, axis, 0); n = A.shape[0]; idx = np.arange(n)[:, None] + x[None]
    idx = idx % n if wrap else np.clip(idx, 0, n - 1)
    return np.moveaxis(sum(wj * A[idx[:, j]] for j, wj in enumerate(w)), 0, axis)


class CleanLast:
    """The round-4 last on one (left) foot.  m: measure_foot(...) plus m['ankle'] (the foot joint, world); skin: (K,3,3) world
    triangles of the left lower leg and foot (the whole body, feet included)."""
    NTH = 360

    def __init__(self, m, skin, P=None):
        self.P = P = dict(R4, **(P or {})); self.m = m; F, S = m["F"], m["S"]; L = m["length"]
        T = np.stack([skin @ F - m["x0"], skin[..., 1] - m["sole_y"], skin @ S], -1)
        self.T = T; a = np.asarray(m["ankle"], float); self.O = np.array([a @ F - m["x0"], a @ S]); self.Ah = float(a[1] - m["sole_y"])
        # ---- plan: the footprint hull set out by ease_out
        V = T.reshape(-1, 3); low = V[V[:, 1] < P["hull_y"]]; pl = low[:, [0, 2]]
        xb = m["x0"] * 0 + m["ball_t"] * L; band = pl[np.abs(pl[:, 0] - xb) < 0.01]; ucb, hwb = 0.5 * (band[:, 1].max() + band[:, 1].min()), 0.5 * np.ptp(band[:, 1])
        xt = pl[:, 0].max(); sg = np.linspace(-1, 1, 41); q = P["toe_round"]
        toe = np.stack([xb + (xt - xb) * np.clip(1 - np.abs(sg) ** q, 0, 1) ** (1 / q), ucb + 0.97 * hwb * sg], 1)            # a round toe box over the toes
        loop = g.resample(_hull2(np.vstack([pl, toe])), 480, closed=True); tg = np.roll(loop, -1, 0) - np.roll(loop, 1, 0)
        nrm = np.stack([tg[:, 1], -tg[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        if (nrm * (loop - loop.mean(0))).sum() < 0: nrm = -nrm
        out = loop + P["ease_out"] * nrm; self.x_foot_tip = float(loop[:, 0].max())
        out[:, 0] += P["toe_room"] * smoothstep(out[:, 0] / L, P["toe_from"], 1.0)                 # toe room: the outline (not the foot) carried forward
        for _ in range(6): out = 0.5 * out + 0.25 * (np.roll(out, 1, 0) + np.roll(out, -1, 0))
        self.outline = out; self.x_back, self.x_tip = float(out[:, 0].min()), float(out[:, 0].max()); self.Ls = self.x_tip - self.x_back
        self.h_b, self.h_s, self.h_f = P["h_back"] * self.Ah, P["h_side"] * self.Ah, P["h_front"] * self.Ah
        # ---- the skin along every ray at every height (1 mm), the plan outline along every ray
        n = self.NTH; th = np.linspace(-np.pi, np.pi, n, endpoint=False); D = np.stack([np.cos(th), np.sin(th)], 1); self.th = th
        ys = np.arange(-0.008, max(self.h_f, self.h_b) + 0.006, 0.001); self.ys = ys
        Rs = np.full((len(ys), n), np.nan)
        for i, y in enumerate(ys):
            if y >= 0.002: Rs[i] = _far(self.O, D, _slice(T, y))
        for i in range(len(ys) - 2, -1, -1): Rs[i] = np.where(np.isnan(Rs[i]), Rs[i + 1], Rs[i])
        for i in range(1, len(ys)): Rs[i] = np.where(np.isnan(Rs[i]), Rs[i - 1], Rs[i])
        self.Rs = Rs; dth = 2 * np.pi / n; Rd = Rs.copy()
        for k in range(1, 12):                                                                 # fill the clefts between the toes (5 mm of arc)
            inwin = (k * dth * Rs) < P["cleft_mm"] / 1000
            Rd = np.where(inwin, np.maximum(Rd, np.maximum(np.roll(Rs, k, 1), np.roll(Rs, -k, 1))), Rd)
        self.r_o = _far(self.O, D, np.stack([out, np.roll(out, -1, 0)], 1))
        xo = self.O[0] + self.r_o * D[:, 0]; ysf = self.sole_top(xo); hc = self.collar_h(th); Y = ys[:, None]
        ct = P["c_top"] + P["c_back"] * np.clip(-np.cos(th), 0, 1) ** 2                        # a little more padding at the heel collar (the skin folds over it at -45)
        c = ct[None] + (P["c_low"] - ct[None]) * smoothstep(hc[None] - Y, *P["c_fade"])
        smax = lambda a_, b_, k_: 0.5 * (a_ + b_ + np.sqrt((a_ - b_) ** 2 + k_ * k_))
        by = P["base_y"] + (P["base_y_toe"] - P["base_y"]) * smoothstep((xo - self.x_back) / self.Ls, 0.55, 0.75)        # the outline holds the toe box higher (over the toes' sides)
        by = by + (P["base_y_nose"] - by) * smoothstep(np.abs(th), np.radians(P["nose_deg"][1]), np.radians(P["nose_deg"][0]))   # but low at the nose, so it can round
        foot = Rd + c; base = self.r_o[None] * (1 - smoothstep(Y - ysf[None], by[None] - 0.004, by[None] + 0.010))
        W_ = _blur(_blur(smax(foot, base, P["smax_k"]), P["blur_th"], 1, True), P["blur_y"], 0, False)          # the walls: foot + clearance, plan outline low down
        gth = np.abs(np.gradient(W_, axis=1) / (2 * np.pi / n)) / np.maximum(W_, 1e-3)            # |dr/dth| / r: 0 where a ray meets the wall squarely
        wb = _blur(smoothstep(gth, 0.9, 0.3), 6.0, 1, True)                                         # (the switch itself smoothed: no kink where it changes)
        W_ = W_ + wb * (_blur(W_, P["blur_th_side"], 1, True) - W_)                                   # blur across rays only there (not at the toe's corners)
        sk = np.sqrt(1 + np.minimum((np.gradient(Rs, axis=1) / (2 * np.pi / n) / np.maximum(Rs, 1e-3)) ** 2 + (np.gradient(Rs, axis=0) / 0.001) ** 2, 5.0))   # radial / normal distance on a wall oblique to the ray (in plan and in height)
        self.obl = sk; W_ = np.maximum(W_, Rs + 0.0024 * sk); W_ = _blur(W_, 0.6, 0, False)
        self.Rv = self._vamp(D); lam = smoothstep(hc[None] - Y, P["vamp_fade"][0], P["vamp_fade"][1])          # the vamp dome, faded out under the collar
        F_ = np.where(self.Rv > 0, W_ + lam * self.Rv_w * (smax(W_, self.Rv, P["vamp_k"]) - W_), W_)
        F_ = np.maximum(F_, Rs + P["c_min"] * sk)                                                # never closer than 2 mm (normal) to the bare foot, after the mesh's chords and ring smoothing
        ya = hc - P["roll_drop"]
        for j in range(n):                                                                      # rise inward only
            top = int(np.searchsorted(ys, ya[j])) + 1; F_[:top, j] = np.maximum.accumulate(F_[:top, j][::-1])[::-1]
        wd = np.clip(np.where(self.Rv > 0, lam * self.Rv_w, 0.0) * 4, 0, 1)                           # (not on the vamp dome: there r(y) is steep and a blur in y would move it)
        for j in range(n):                                                                      # round 5: heel and side walls bow outward (convex in height), no S between
            yb_ = ysf[j] - 0.004; yt_ = ya[j] - P["hull_below"]                                 # the heel bone's bulge and the hollow under the ankle bone
            k = np.nonzero((ys >= yb_) & (ys <= yt_))[0]
            if len(k) < 4 or wd[k].max() > 0.05: continue
            hp = _hull2(np.stack([ys[k], F_[k, j]], 1)); hp = hp[np.argsort(hp[:, 0])]
            top = [hp[0]]
            for q in hp[1:]:                                                                    # the upper chain of the hull (largest r)
                while len(top) >= 2 and _cr2(top[-1] - top[-2], q - top[-2]) >= 0: top.pop()
                top.append(q)
            top = np.array(top); env = np.interp(ys[k], top[:, 0], top[:, 1])
            F_[k, j] = np.maximum(F_[k, j], env)
        F_ = np.maximum(F_ + (1 - wd) * (_blur(F_, P["blur_mono"], 0, False) - F_), Rs + P["c_min"] * sk)   # round 5: no crease where the inward rise fills a hollow (the S-jog on the inner heel)
        self.F = F_
        # ---- rays: spaced by the mean of the outline's and the collar's arc length
        po = self.O + self.r_o[:, None] * D; pc = self.O + self.at(Rs, th, hc)[:, None] * D
        w = np.linalg.norm(np.roll(po, -1, 0) - po, axis=1) / self.Ls + np.linalg.norm(np.roll(pc, -1, 0) - pc, axis=1) / (np.pi * 0.07)
        cum = np.r_[0, np.cumsum(w)]; cum /= cum[-1]; N = P["n_ray"]
        self.rays = np.interp((np.arange(N) + 0.5) / N, cum, np.r_[th, th[0] + 2 * np.pi])

    def _vamp(self, D):
        """The vamp and toe box: a designed dome over the plan outline, height ys(x) + H(x) (1 - s^p)^(1/p), s = |u - uc(x)| / hw(x)
        (uc, hw: the outline's centre and half width at x; p from 2.2 on the instep, round, to 3.4 at the toe box, square-shouldered).
        H(x) is the least height that keeps every foot vertex at the station under the dome by the vamp clearance (7.5 mm over the
        toes, 4.5 mm on the instep, the collar's 2.6 mm at the throat), then made smooth and never dipping towards the ankle; past the
        toes it comes down in a quarter ellipse to the outline's tip (the rounded nose).  Returned as the farthest radius along every
        ray at every height (-1: none)."""
        P = self.P; V = self.T.reshape(-1, 3); on = self.outline; nb = np.roll(on, -1, 0)
        xcf = self.O[0] + float(self.at(self.Rs, 0.0, self.h_f)); self.x_throat = xcf
        def span(x):
            c = (on[:, 0] - x) * (nb[:, 0] - x) <= 0; dx = nb[c, 0] - on[c, 0]; t = (x - on[c, 0]) / np.where(np.abs(dx) > 1e-12, dx, 1.0); u = on[c, 1] + t * (nb[c, 1] - on[c, 1])
            return (float(u.min()), float(u.max())) if len(u) >= 2 else (np.nan, np.nan)
        xs = np.arange(xcf + 0.004, self.x_tip - 0.0006, 0.0025); f = (xs - self.x_back) / self.Ls
        cv = P["c_top"] + (P["c_vamp"] + (P["c_toe"] - P["c_vamp"]) * smoothstep(f, 0.62, 0.85) - P["c_top"]) * smoothstep(xs, xcf - 0.004, xcf + 0.035)
        pw = P["p_instep"] + (P["p_toe"] - P["p_instep"]) * smoothstep(f, 0.50, 0.80)
        lh = np.array([span(x) for x in xs]); ok = ~np.isnan(lh[:, 0]); xs, f, cv, pw, lh = xs[ok], f[ok], cv[ok], pw[ok], lh[ok]
        uc = lh.mean(1); hw = 0.5 * (lh[:, 1] - lh[:, 0]); bw = P["wall_instep"] + (P["wall_toe"] - P["wall_instep"]) * smoothstep(f, 0.50, 0.80)
        ysx = self.sole_top(xs) + bw; H = np.full(len(xs), np.nan)                               # the roof springs from the top of a wall bw high
        for i, x in enumerate(xs):
            if x > self.x_foot_tip - 0.001: break
            b = V[(np.abs(V[:, 0] - x) < 0.004) & (V[:, 1] > ysx[i] - 0.002)]
            if len(b) == 0: continue
            s_ = np.abs(b[:, 2] - uc[i]) / hw[i]; k = s_ < 0.985; ce = cv[i] * (1 - s_[k] ** 2) + P["c_side"] * s_[k] ** 2   # clearance: on top cv, at the sides c_side
            if not k.any(): continue
            gk = (1 - s_[k] ** pw[i]) ** (1 / pw[i]); Hi = max(((b[k, 1] - ysx[i] + ce) / gk).max(), 0.004)
            for _ in range(2):                                                                   # on the roof's steep sides a vertical gap is a smaller normal gap
                slope = Hi / hw[i] * s_[k] ** (pw[i] - 1) * np.maximum(1 - s_[k] ** pw[i], 1e-3) ** (1 / pw[i] - 1)
                Hi = max(((b[k, 1] - ysx[i] + ce * np.sqrt(1 + np.minimum(slope, 3.0) ** 2)) / gk).max(), 0.004)
            H[i] = Hi
        il = int(np.nonzero(~np.isnan(H))[0].max()); idx = np.arange(len(xs)); good = ~np.isnan(H[:il + 1])
        H[:il + 1] = np.interp(idx[:il + 1], idx[:il + 1][good], H[:il + 1][good])
        a = ysx + H; a[:il + 1] = np.maximum.accumulate(a[:il + 1][::-1])[::-1]                    # the crown never dips towards the ankle
        a[il + 1:] = a[il]                                                                       # (provisional, for the smoothing; the nose follows)
        need = a.copy()
        for _ in range(60): a[:il + 1] = np.maximum(_blur(a, 3.0, 0, False)[:il + 1], need[:il + 1])   # a tent over the foot's bumps
        a[:il + 1] = _blur(a, 2.0, 0, False)[:il + 1]; a[:il + 1] += max(float((need[:il + 1] - a[:il + 1]).max()), 0.0)
        e = np.clip((xs - xs[il]) / (xs[-1] + 0.0006 - xs[il]), 0, 1); Hn = a[il] - ysx[il]
        a = np.where(idx > il, ysx + Hn * np.sqrt(np.clip(1 - e ** 2, 0, 1)) ** P["nose_pow"], a)            # the nose
        H = a - ysx; self.vamp = dict(x=xs, a=a, uc=uc, hw=hw, p=pw)
        rr = np.arange(0.0, 0.27, 0.001); out = np.full((len(self.ys), len(D)), -1.0); wx = np.zeros_like(out)
        for j, d in enumerate(D):
            px = self.O[0] + rr * d[0]; pu = self.O[1] + rr * d[1]; inr = (px >= xs[0]) & (px <= xs[-1])
            s_ = np.abs(pu - np.interp(px, xs, uc)) / np.maximum(np.interp(px, xs, hw), 1e-4); p_ = np.interp(px, xs, pw)
            Th = np.where(inr & (s_ < 1), np.interp(px, xs, ysx) + np.interp(px, xs, H) * np.clip(1 - s_ ** p_, 0, 1) ** (1 / p_), -1.0)
            above = Th[None] >= self.ys[:, None]; last = np.where(above, np.arange(len(rr))[None], -1).max(1)
            k = np.clip(last, 0, len(rr) - 2); t0, t1 = Th[k], Th[k + 1]; fr = np.clip((t0 - self.ys) / np.where(t0 - t1 > 1e-9, t0 - t1, 1), 0, 1)
            rt = rr[k] + fr * (rr[k + 1] - rr[k]); out[:, j] = np.where(last >= 0, rt, -1.0)
            wx[:, j] = smoothstep(self.O[0] + rt * d[0], xs[0], xs[0] + P["vamp_in"])
        self.Rv_w = np.where(out > 0, wx, 0.0)
        return out

    # ---- design functions
    def collar_h(self, th):
        c = np.cos(th); P = self.P
        return self.h_s + (self.h_f - self.h_s) * np.clip(c, 0, 1) ** P["p_front"] + (self.h_b - self.h_s) * np.clip(-c, 0, 1) ** P["p_back"]

    def spring(self, x): return self.P["spring"] * smoothstep((np.asarray(x) - self.x_back) / self.Ls, self.P["spring_from"], 1.0) ** self.P["spring_pow"]

    def sole_top(self, x):
        P = self.P; f = (np.asarray(x) - self.x_back) / self.Ls
        return P["sole_top_heel"] + (P["sole_top_fore"] - P["sole_top_heel"]) * smoothstep(f, *P["drop_at"]) + 0.75 * self.spring(x)

    def ground(self, x, sole):
        f = (np.asarray(x) - self.x_back) / self.Ls
        return -sole + self.spring(x) + self.P["heel_bevel"] * smoothstep(f, 0.07, 0.0) ** 1.5

    # ---- field look-ups (theta wraps, y clamps)
    def at(self, A, th, y):
        n = self.NTH; f = np.mod(np.asarray(th, float) + np.pi, 2 * np.pi) / (2 * np.pi / n); j0 = np.floor(f).astype(int) % n; j1 = (j0 + 1) % n; a = f - np.floor(f)
        g_ = (np.asarray(y, float) - self.ys[0]) / 0.001; i0 = np.clip(np.floor(g_).astype(int), 0, len(self.ys) - 2); b = np.clip(g_ - i0, 0, 1)
        return (1 - a) * ((1 - b) * A[i0, j0] + b * A[i0 + 1, j0]) + a * ((1 - b) * A[i0, j1] + b * A[i0 + 1, j1])

    def r_out(self, th):
        n = self.NTH; f = np.mod(np.asarray(th, float) + np.pi, 2 * np.pi) / (2 * np.pi / n); j0 = np.floor(f).astype(int) % n; a = f - np.floor(f)
        return (1 - a) * self.r_o[j0] + a * self.r_o[(j0 + 1) % n]

    def loc(self, th, r, y):
        th, r, y = np.broadcast_arrays(np.asarray(th, float), np.asarray(r, float), np.asarray(y, float))
        return np.stack([self.O[0] + r * np.cos(th), y, self.O[1] + r * np.sin(th)], -1)

    def world(self, loc):
        m = self.m; loc = np.asarray(loc, float)
        return (m["x0"] + loc[..., 0:1]) * m["F"] + (m["sole_y"] + loc[..., 1:2]) * UP + loc[..., 2:3] * m["S"]

    def inside(self): return self.world(self.loc(0.0, 0.0, 0.03))

    # ---- one ray
    def profile(self, t):
        """Outer surface along ray t, fine: (r, y), from inside the sole to where the roll starts, and the collar's skin point."""
        P = self.P; hc = float(self.collar_h(t)); ya = hc - P["roll_drop"]; xo = self.O[0] + self.r_out(t) * np.cos(t); yb = float(self.sole_top(xo)) - 0.003
        y = np.linspace(yb, ya, max(int((ya - yb) / 0.0004), 12)); r = self.at(self.F, np.full_like(y, t), y)
        return r, y, hc

    def ray_points(self, t):
        """(points (M,2) as (r, y), role per point, soft per point) along ray t: outer surface, roll, lining."""
        P = self.P; r, y, hc = self.profile(t); p = np.stack([r, y], 1)
        dl = np.linalg.norm(np.diff(p, axis=0), axis=1); arc = np.r_[0, np.cumsum(dl)]
        cum = (1 - P["ring_h"]) * arc / arc[-1] + P["ring_h"] * (y - y[0]) / (y[-1] - y[0])                       # rings: arc length and height, both smooth from ray to ray
        s = np.interp(np.linspace(0, 1, P["n_out"]), cum, np.arange(len(p)))
        i0 = np.clip(np.floor(s).astype(int), 0, len(p) - 2); f = (s - i0)[:, None]; outer = (1 - f) * p[i0] + f * p[i0 + 1]
        below = arc[-1] - ((1 - f[:, 0]) * arc[i0] + f[:, 0] * arc[i0 + 1])
        rc = float(self.at(self.Rs, t, hc)); ri = rc - P["inset"]; ra, ya = outer[-1]; w = max(ra - ri, 0.0015)
        roll = g.bezier([ra, ya], [ra + 0.05 * w, ya + 1.1 * w], [ri + 0.1 * w, hc + 1.1 * w], [ri, hc], P["n_roll"] + 1)[1:]
        lin = [(float(self.at(self.Rs, t, hc - P["lining"] * k / P["n_lin"])) - P["inset"] - 0.0006 * k, hc - P["lining"] * k / P["n_lin"]) for k in range(1, P["n_lin"] + 1)]
        pts = np.vstack([outer, roll, np.array(lin)])
        role = np.r_[np.ones(len(outer)), np.full(len(roll), 2.0), np.full(len(lin), 3.0)]
        soft = np.r_[smoothstep(below, 0.026, 0.005), np.ones(len(roll) + len(lin))]
        return pts, role, soft

    # ---- parts
    def upper(self, Z):
        R = [self.ray_points(t) for t in self.rays]; M = len(R[0][0]); N = len(self.rays)
        G = np.stack([self.loc(t, rp[0][:, 0], rp[0][:, 1]) for t, rp in zip(self.rays, R)], 1)          # (M, N, 3) local
        k0 = self.P["n_out"] - 5; G[k0:] = _blur(G[k0:], self.P["ring_smooth"], 1, True)              # the collar's rings smoothed along themselves (positions): one smooth edge, no scallops
        for _ in range(self.P["taubin"]):                                                              # the walls' rings: Taubin smoothing in plan (does not shrink the heel)
            for lam_ in (0.5, -0.53):
                Q = G[1:k0][:, :, [0, 2]]; G[1:k0][:, :, [0, 2]] = Q + lam_ * (0.5 * (np.roll(Q, 1, 1) + np.roll(Q, -1, 1)) - Q)
                                                                                                      # (not the walls: smoothing shrank the tight heel by up to 2.7 mm)
        role = np.stack([rp[1] for rp in R], 1).ravel(); soft = np.stack([rp[2] for rp in R], 1).ravel()
        V = G.reshape(-1, 3); fl = G[-1].mean(0); fl[[0, 2]] = [self.O[0], self.O[1]]
        V = np.vstack([V, fl]); F = g.grid_faces(M, N, close_c=True) + [((M - 1) * N + j, (M - 1) * N + (j + 1) % N, M * N) for j in range(N)]
        role = np.r_[role, 4.0]; soft = np.r_[soft, 1.0]; self.rings = G
        return Part("last_upper", self.world(V), F, Z, group="affine", sharp=180, soft=soft, attr=dict(recalc=False, orient=self.inside(), role=role))

    def sole(self, sole, Z):
        P = self.P; N = len(self.rays); T_ = self.rays; xo = self.O[0] + self.r_out(T_) * np.cos(T_); ys = self.sole_top(xo)
        rw = np.array([float(self.at(self.F, t, y)) for t, y in zip(T_, ys)])                       # the upper's wall at the sole's top edge
        rs = rw + P["ledge"]; mid = 0.5 * (ys + self.ground(xo, sole))
        def ring(dr, y=None, lam=None):
            r = rs + dr if lam is None else lam * (rs - 0.0032); p = self.loc(T_, r, 0.0); yy = y if y is not None else self.ground(p[:, 0], sole)
            p[:, 1] = yy(p[:, 0]) if callable(yy) else yy; return p
        g0 = lambda x: self.ground(x, sole)
        rows = [ring(-(P["ledge"] + 0.006), ys - 0.0006), ring(-(P["ledge"] + 0.0012), ys), ring(-0.0007, ys), ring(-0.0001, ys - 0.00035), ring(0.0, ys - 0.0012),
                ring(0.0005, mid), ring(0.0003, lambda x: g0(x) + 0.0042), ring(-0.0005, lambda x: g0(x) + 0.0015), ring(-0.0018, lambda x: g0(x) + 0.0002),
                ring(-0.0032, g0)] + [ring(0, g0, lam) for lam in (0.7, 0.35)]
        V = np.vstack(rows); M = len(rows); top = rows[0].mean(0); bot = self.loc(0.0, 0.0, float(self.ground(self.O[0], sole)))
        V = np.vstack([V, top, bot]); F = g.grid_faces(M, N, close_c=True)
        F += [((j + 1) % N, j, M * N) for j in range(N)] + [((M - 1) * N + j, (M - 1) * N + (j + 1) % N, M * N + 1) for j in range(N)]
        return Part("last_sole", self.world(V), F, Z, group="affine", sharp=50, attr=dict(recalc=False, orient=self.world(self.loc(0.0, 0.0, -sole / 2)), role=np.zeros(len(V))))

    def _overlay(self, T_, ye, name, Z, off, bev=0.0011):
        """An overlay panel on the upper along the rays T_ (in order), from inside the sole up to the heights ye, `off` proud, its top
        edge and both ends tucked 0.4 mm under the upper's surface."""
        cols = []; softs = []; nr = 8; no = self.P["n_out"]; R_ = np.mod(self.rays, 2 * np.pi); o_ = np.argsort(R_); R_ = R_[o_]
        def column(th, y_):                                                  # the upper's own mesh (rings smoothed), between its two columns round th
            a = np.mod(th, 2 * np.pi); i = int(np.searchsorted(R_, a)) % len(R_); j0, j1 = o_[i - 1], o_[i]
            a0, a1 = R_[i - 1], R_[i] + (2 * np.pi if i == 0 else 0.0); w = float(np.clip((a + (2 * np.pi if a < a0 else 0) - a0) / max(a1 - a0, 1e-9), 0, 1))
            c = [np.stack([np.interp(y_, self.rings[:no, j, 1], self.rings[:no, j, k]) for k in range(3)], 1) for j in (j0, j1)]
            return (1 - w) * c[0] + w * c[1], (1 - w) * self.rings[no - 1, j0, 1] + w * self.rings[no - 1, j1, 1]
        for th, e_ in zip(T_, ye):
            y0 = float(self.rings[0, :, 1].min()); yy = np.r_[np.linspace(y0, e_ - bev, nr - 3), e_ - 0.55 * bev, e_ - 0.22 * bev, e_]
            cc, ytop = column(th, yy); cols.append(cc); softs.append(smoothstep(ytop - yy, 0.026, 0.005))
        nc = len(cols); G = np.stack(cols, 0)
        dT = np.gradient(G, axis=0); dY = np.gradient(G, axis=1); nn = unit(np.cross(dY, dT)); rad = G - np.array([self.O[0], 0, self.O[1]])[None, None]; rad[..., 1] = 0
        nn = np.where(((nn * rad).sum(-1) < 0)[..., None], -nn, nn)
        o = np.full((nc, nr), off); o[:, -3] = 0.6 * off; o[:, -2] = 0.2 * off; o[:, -1] = -0.0004; o[0, :] = -0.0004; o[-1, :] = -0.0004; o[1, :] *= 0.5; o[-2, :] *= 0.5
        V = (G + nn * o[..., None]).reshape(-1, 3)
        return Part(name, self.world(V), g.grid_faces(nc, nr, close_c=False), Z, group="affine", sharp=50, soft=np.stack(softs, 0).ravel(),
                    attr=dict(recalc=False, orient=self.inside(), role=np.full(len(V), 5.0)))

    def _ys_ray(self, th): return float(self.sole_top(self.O[0] + self.r_out(th) * np.cos(th)))

    def counter(self, Z):
        """Heel counter: round the heel, its top edge at counter_top of the wall at the back, sweeping down to the sole at the sides."""
        P = self.P; pe = P["counter_fade"][1] - 2.0; T_ = np.pi + np.radians(np.linspace(-pe, pe, 2 * int(pe / 5.0) + 1))      # even angles round the heel
        # round 5: one smooth sweep (raised cosine) from the top at the back to the sole at the ends, no plateau and no curvature
        # jump (the S-jog on the inner heel was the old plateau meeting the sweep); the edge itself smoothed along the heel
        ph = np.clip(np.degrees(np.abs(T_ - np.pi)) / P["counter_fade"][1], 0, 1); ysb = np.array([self._ys_ray(th) for th in T_])
        hb = P["counter_top"] * (float(self.profile(np.pi)[1][-1]) - float(self._ys_ray(np.pi)))
        ye = _blur(ysb - P["counter_sink"] + (hb + P["counter_sink"]) * (0.5 * (1 + np.cos(np.pi * ph))) ** 1.3, 1.5, 0, False)   # its ends run down under the sole's ledge
        return self._overlay(T_, ye, "last_counter", Z, P["counter_off"], P["counter_bevel"])          # round 5: a soft bevelled edge (a crisp 1.6 mm step showed as an S where it crossed the heel's outline)

    def bumper(self, Z):
        """Toe bumper: round the toe, bump_h above the sole at the tip, down to nothing at bump_fade degrees."""
        P = self.P; pe = P["bump_fade"][1] - 2.0; T_ = np.radians(np.linspace(-pe, pe, 2 * int(pe / 3.0) + 1))            # even angles round the toe
        hk = P["bump_h"] * self.m["length"] / 0.265 * (1 - smoothstep(np.degrees(np.abs(T_)), *P["bump_fade"])) + 0.0015
        return self._overlay(T_, [self._ys_ray(th) + h for th, h in zip(T_, hk)], "last_bumper", Z, P["bump_off"])

    def report(self, fv):
        """Clearances of the bare foot (world vertices, not stretched) inside the outer surface, radially along the rays (sides,
        heel and toe box; the vamp's own clearance is vertical and is checked on the mesh)."""
        F, S = self.m["F"], self.m["S"]; x = fv @ F - self.m["x0"]; y = fv[:, 1] - self.m["sole_y"]; u = fv @ S
        th = np.arctan2(u - self.O[1], x - self.O[0]); r = np.hypot(x - self.O[0], u - self.O[1]); ya = self.collar_h(th) - self.P["roll_drop"]
        k = (y < ya - 0.004) & (y > 0.003); cl = self.at(self.F, th[k], y[k]) - r[k]; i = int(np.argmin(cl))
        hs = self.collar_h(self.rays)
        return dict(foot_clearance_radial_min_mm=round(float(cl.min() * 1000), 2), at_xyu_mm=[round(float(v * 1000), 1) for v in (x[k][i], y[k][i], u[k][i])],
                    under_2mm=int((cl < 0.002).sum()), checked=int(k.sum()),
                    collar_mm=dict(back=round(self.h_b * 1000, 1), side=round(self.h_s * 1000, 1), front=round(self.h_f * 1000, 1), lowest=round(float(hs.min()) * 1000, 1)),
                    ankle_joint_mm=round(self.Ah * 1000, 1), last_length_mm=round(self.Ls * 1000, 1))


def build_last(m, sole, Z, skin=None, fv=None, P=None):
    """The round-4 last for the abstract style (CleanLast): upper with its own collar, sole, heel counter; one zone."""
    L = CleanLast(m, skin, P); z = Z["last"]
    parts = [L.upper(z), L.sole(sole, z), L.counter(z), L.bumper(z)]
    lo = np.array([L.collar_h(t) for t in L.rays]); L.H = float(lo.min())                           # the lowest collar edge (B7's leg cut is 20 mm under it)
    lip = L.rings[L.P["n_out"] + L.P["n_roll"] - 1]; L.tb = float((lip[:, 0].min() - L.x_back) / L.Ls); L.tf = float((lip[:, 0].max() - L.x_back) / L.Ls); L.bb = float(0.5 * np.ptp(lip[:, 2]))
    L.meta = dict(r4=np.array(1), collar_back=L.h_b, collar_side=L.h_s, collar_front=L.h_f, floor_lowest=float(L.rings[-1][:, 1].min()),
                  last_x_back=L.x_back, ankle_centre=L.O, n_ray=len(L.rays))
    L.info = L.report(fv) if fv is not None else {}
    return parts, L
