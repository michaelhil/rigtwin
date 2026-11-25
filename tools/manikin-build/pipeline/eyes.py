"""Eyes: eyeball geometry, lid joints with spherical-wrap weights, wet line, iris texture, manifest block.  Owner: B5.

    PY=$MANIKIN_PYTHON
    $PY -I pipeline/eyes.py check                 lid numbers (gap, intersection, iris coverage) on the base and three persons
    $PY -I pipeline/eyes.py test shell|recessed   -> B5/packages/eyes-<construction>/  (a bust: head, lashes, brows, cap, glasses)

Frame: the core's (metres, +X the character's left, +Y up, +Z forward). Eye-local frame = the same axes, origin at the
eye centre. Every number is in P with its source; nothing else is hard-coded.
"""
import sys, os, json, math, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
import mh_core as mh, glb

LAB = __import__("labpaths").LAB
P = {
    "iris_d": 0.0117,        # visible iris diameter (designer's specification; textbook HVID 11.7 mm, believed)
    "cornea_r": 0.0078,      # anterior corneal radius of curvature (Gullstrand eye 7.7-7.8 mm, believed)
    "limbus_soft": 0.0004,   # blend of the corneal cap into the sclera
    "recess": 0.0009,        # iris plane behind the limbus plane, "recessed" construction (anterior chamber, flattened for a real-time eye)
    "close_at": 0.12,        # where the lids meet in a blink, as a fraction of the aperture above the lower margin (upper lid does most of the travel; believed)
    "span_upper_deg": 30.0,  # lid skin that stretches in a blink, from the margin up to the orbital crease (about 8 mm on the ball)
    "span_lower_deg": 16.0,
    "reach": 0.004,          # skin further than this from the ball starts to stay with the skull ...
    "reach_end": 0.010,      # ... and is fully still here
    "lift_reach": 0.0030,    # lid points within this of the ball ride over the corneal bulge (run-time lift, eyes.ts)
    "lift_list": 0.0070,     # round 4b: lid points within this of the ball are LISTED for the run-time lift (kept outside the ball for the current body
                             # shape; only those within lift_reach also ride the bulge). With 3 mm, lid skin that a thin shape brings onto the ball was not
                             # listed: on M50_THIN the ball showed through it 1 mm under the iris (the grey "drop")
    "seg": 32,
    "cover_top": 0.0015,     # iris covered by the upper lid at rest (designer: 1-2 mm)
    "cover_bottom": 0.0003,  # lower lid just over the lower limbus (textbook: at the limbus, believed). Round 4: 0.9 tried against the notch under the iris on F05 and
                             # M50_THIN (B5/NOTES.md round 4): no better there, worse on M95H; kept at 0.3
    "clear": 0.00012,        # lid margin above the eye surface
    "clear_max": 0.00040,    # the margin ring is pulled in to this
    "ball_r": 0.014954,      # radius of the eye the hm08 lids were modelled around (its eye helper sphere on the unmorphed mesh; measured). Constant: eyes do not scale with the body (RP)
    "ball_inset": 0.0002,    # ball radius = ball_r - this, on the centre fitted to the lid margin ring
    # round 4, the crossed eyes at their cause: on B1's base heads the lid opening is SHORT AT THE INNER CORNER (measured, B5/probe5-*.json:
    # fissure 24.9 mm woman / 25.2 man, inner corners 40.9 / 46.5 mm apart; adult norms about 28-30 and 31-33 mm, believed, Farkas), so at
    # primary gaze the iris sits 1.0 / 2.1 mm nasal of the corner-to-corner midpoint, where a real pupil sits about 1 mm temporal of it.
    # MakeHuman's own eye modifier `eyes/{l,r}-eye-push2-out` (CC0, MPFB2 data) moves the inner corner toward the nose (+2.1 / 2.3 mm at 1.0,
    # outer corner +0.5 / 0.7, fitted ball centre 0.5 / 0.7 mm nasal): fissure 27.7 / 28.0 mm, iris nasal of the midpoint 0.28 / 1.18 mm.
    # Weight per sex = the one that brings the fissure to the adult norm (woman about 28 mm, man about 29.5; believed, Farkas): woman 1.0 (27.7 mm,
    # iris 0.28 mm nasal of the midpoint, inner corners 35.3 mm apart), man 1.6 (29.7 mm, 0.73 mm, 37.5 mm apart; B5 grid probe, round 4).
    # Applied to the base inside eye_context(), before the ball is fitted, so every builder that calls it (B1, B2, B7) gets the same lids and joints.
    "canthus_push": {"f": 1.0, "m": 1.6},
}
CANTHUS_TARGETS = ("eyes/l-eye-push2-out", "eyes/r-eye-push2-out")
RING_L = np.arange(7747, 7773)      # hm08 lid margin vertices of the left eye (two chains: upper and lower margin); right = mirror
INNER_L = np.arange(7773, 7825)     # the two rings behind the margin (the fold tucked behind the ball)
LID_JOINTS = ("eyelid_upper_l", "eyelid_lower_l", "eyelid_upper_r", "eyelid_lower_r")


def log(*a): print("[eyes]", *a, flush=True)
def _ss(x): x = np.clip(x, 0.0, 1.0); return x * x * (3 - 2 * x)


# ------------------------------------------------------------------------------------------------ the ball
def eye_ring(base, side, which=RING_L):
    return which if side == "l" else base.mirror[which]


def eye_fit(base, v, side):
    """Eye centre and radius from the head mesh. Radius: constant (P.ball_r; real eyes hardly vary and the helper sphere of
    a morphed body is no guide: 18 mm on RP's base man). Centre: the sphere of that radius fitted to the lid margin ring."""
    hel = base.vgroups[f"helper-{side}-eye"]; C = v[hel].mean(0); Rh = P["ball_r"]; ring = eye_ring(base, side)
    for _ in range(15):
        d = v[ring] - C; r = np.linalg.norm(d, axis=1); C = C - np.linalg.lstsq(-d / r[:, None], r - Rh, rcond=None)[0]
    return C, Rh - P["ball_inset"]


def eye_bulge(R, rho):
    """Height of the cornea above the scleral sphere at distance rho from the optical axis."""
    rc = P["cornea_r"]; rl = P["iris_d"] / 2 + P["limbus_soft"]; rho = np.asarray(rho, dtype=np.float64)
    zs = np.sqrt(np.maximum(R * R - rho * rho, 0)); h = math.sqrt(R * R - rl * rl) + np.sqrt(np.maximum(rc * rc - rho * rho, 0)) - math.sqrt(rc * rc - rl * rl) - zs
    e = 0.00006
    return np.where(rho < rc * 0.98, 0.5 * (h + np.sqrt(h * h + e * e)), 0.0)


def eye_surface_table(R, n=91):
    """Radius of the eye surface (sphere + cornea) against the angle from the optical axis, 1 degree steps."""
    rho = np.linspace(0, P["cornea_r"] * 0.97, 400); z = np.sqrt(R * R - rho * rho) + eye_bulge(R, rho)
    ang = np.degrees(np.arctan2(rho, z)); rad = np.hypot(rho, z)
    return np.maximum(np.interp(np.arange(n), ang, rad, right=R), R)


def eye_ball(R, kind="shell"):
    """-> (verts (n,3) eye-local metres, tris). kind 'shell': one closed surface with the corneal bulge (the iris is drawn
    below it by the shader); 'recessed': the iris is a dish behind the limbus plane (a separate cornea shell goes on top)."""
    seg = P["seg"]; rl = P["iris_d"] / 2
    rings = []
    for rho in np.linspace(0, rl + 0.0016, 13)[1:]:
        if kind == "shell": z = math.sqrt(R * R - rho * rho) + float(eye_bulge(R, rho))
        elif rho <= rl: z = math.sqrt(R * R - rl * rl) - P["recess"] * (0.6 + 0.4 * (1 - rho / rl))
        else: z = math.sqrt(R * R - rho * rho)
        rings.append((rho, z))
    t0 = math.asin(rings[-1][0] / R)
    for t in np.linspace(t0, math.radians(142), 11)[1:]: rings.append((R * math.sin(t), R * math.cos(t)))
    z0 = R + float(eye_bulge(R, 0.0)) if kind == "shell" else math.sqrt(R * R - rl * rl) - P["recess"]
    return _lathe(rings, z0, seg)


def eye_cornea(R):
    rings = [(rho, math.sqrt(R * R - rho * rho) + float(eye_bulge(R, rho)) + 0.00004) for rho in np.linspace(0, P["iris_d"] / 2 + 0.0012, 11)[1:]]
    return _lathe(rings, R + float(eye_bulge(R, 0.0)) + 0.00004, P["seg"])


def _lathe(rings, z0, seg):
    ph = np.arange(seg) * 2 * math.pi / seg
    v = [np.array([[0, 0, z0]])] + [np.stack([rho * np.cos(ph), rho * np.sin(ph), np.full(seg, z)], 1) for rho, z in rings]
    t = []
    for j in range(seg): t.append((0, 1 + j, 1 + (j + 1) % seg))
    for k in range(len(rings) - 1):
        a, b = 1 + k * seg, 1 + (k + 1) * seg
        for j in range(seg):
            j1 = (j + 1) % seg; t.append((a + j, b + j, b + j1)); t.append((a + j, b + j1, a + j1))
    return np.concatenate(v), np.array(t, dtype=np.int64)


def eye_meshes(c, construction="shell", material="eye_ball", cornea_material="cornea_shell", W=None, names=None):
    """Eyeball meshes for the package (FORMAT.md names eyeball_l/r, cornea_l/r), rigid on the eye joints, with every shape
    morph of the body (centre moves, radius scales). COLOR_0 carries the eye-local position: 0.5 + 0.5 * p / (1.25 R)."""
    names = names or c.skeleton.names; nb = (W.shape[1] if W is not None else len(names)); out = []
    for side in ("l", "r"):
        C, R = c.eye[side]; j = _joint(names, "eye_" + side)
        fits = {k: c.eye_targets[k][side] for k in c.targets}
        for kind in (("ball", "cornea") if construction == "recessed" else ("ball",)):
            lv, t = eye_cornea(R) if kind == "cornea" else eye_ball(R, construction)
            Wm = sp.csr_matrix((np.ones(len(lv)), (np.arange(len(lv)), np.full(len(lv), j))), shape=(len(lv), nb))
            morphs = {k: np.tile(Ck - C, (len(lv), 1)) for k, (Ck, Rk) in fits.items()}       # rigid: the eye moves with its joint and never scales
            n = lv / np.linalg.norm(lv, axis=1, keepdims=True) if kind == "ball" and construction == "recessed" else None
            out.append(glb.Mesh(("eyeball_" if kind == "ball" else "cornea_") + side, C + lv, t, material if kind == "ball" else cornea_material,
                                weights=Wm, morphs=morphs, color=0.5 + 0.5 * lv / (1.25 * R), normals=None))
    return out


def _joint(names, n):
    for cand in (n, n[:-1] + n[-1].upper()):
        if cand in names: return names.index(cand)
    raise KeyError(n)


# ------------------------------------------------------------------------------------------------ the lids
class Lids:
    pass


def eye_lids(base, v, side, CR=None):
    """Lid analysis for one eye on any full hm08 vertex array: the hinge axis through the eye centre parallel to the line
    between the corners, the two margins as angle-about-the-hinge curves, and per-vertex weights for an upper and a lower
    lid joint such that a rotation of the joint about the hinge slides every lid point over the ball (a spherical wrap:
    the radius from the eye centre is kept exactly) and the full rotation lands the upper margin on the meeting line."""
    L = Lids(); sgn = 1.0 if side == "l" else -1.0
    C, R = CR if CR is not None else eye_fit(base, v, side); L.C, L.R, L.side = C, R, side
    body = base.vgroups["body"]; p = v - C; r = np.linalg.norm(p, axis=1); near = (r < 0.04) & (v[:, 0] * sgn > 0)
    inner = body & near & (r < R - 0.0006); inner[eye_ring(base, side, INNER_L)] = True
    mi = eye_ring(base, side); inner[mi] = False; med = mi[np.argmin(p[mi, 0] * sgn)]; lat = mi[np.argmax(p[mi, 0] * sgn)]
    a = (p[lat] - p[med]) * sgn; a /= np.linalg.norm(a)
    f = np.array([0, 0, 1.0]); f = f - (f @ a) * a; f /= np.linalg.norm(f); u = np.cross(f, a)
    s = p @ a; psi = np.arctan2(p @ u, p @ f)
    ends = sorted([(s[med], psi[med]), (s[lat], psi[lat])]); line = lambda x: np.interp(x, [ends[0][0], ends[1][0]], [ends[0][1], ends[1][1]])
    up = [i for i in mi if psi[i] > line(s[i]) + 1e-4 and i not in (med, lat)]; lo = [i for i in mi if psi[i] < line(s[i]) - 1e-4 and i not in (med, lat)]
    def curve(ix):
        ix = sorted(list(ix) + [med, lat], key=lambda i: s[i]); return (lambda x: np.interp(x, s[ix], psi[ix])), ix
    fu, up_o = curve(up); fl, lo_o = curve(lo)
    pu, pl = fu(s), fl(s); pc = pl + P["close_at"] * (pu - pl); pm = 0.5 * (pu + pl)
    g = [k for k in base.vgroups if k.startswith(f"helper-{side}-eyelashes")]
    lash = sorted(g, key=lambda k: psi[base.vgroups[k]].mean())             # [lower, upper]
    lash_lo, lash_up = base.vgroups[lash[0]], base.vgroups[lash[-1]]
    frad = 1 - _ss((r - R - P["reach"]) / (P["reach_end"] - P["reach"]))
    is_up = (body & near & (psi > pm) & (r < R + P["reach_end"])) | lash_up
    is_lo = (body & near & (psi <= pm) & (r < R + P["reach_end"])) | lash_lo
    fa_u = np.where(inner | lash_up | (psi <= pu), 1.0, 1 - _ss((psi - pu) / math.radians(P["span_upper_deg"])))
    fa_l = np.where(inner | lash_lo | (psi >= pl), 1.0, 1 - _ss((pl - psi) / math.radians(P["span_lower_deg"])))
    du = (pu - pc) * fa_u * np.where(lash_up, 1.0, frad) * is_up
    dl = (pc - pl) * fa_l * np.where(lash_lo, 1.0, frad) * is_lo
    L.theta_u, L.theta_l = float(du.max()), float(dl.max())
    L.wu, L.wl = du / L.theta_u, dl / L.theta_l
    L.a, L.f, L.u, L.s, L.psi, L.r = a, f, u, s, psi, r
    L.margin_u, L.margin_l, L.med, L.lat, L.inner = np.array(up_o), np.array(lo_o), med, lat, inner
    L.pu, L.pl, L.pc, L.fu, L.fl = pu, pl, pc, fu, fl
    L.apex_u = up_o[int(np.argmax([psi[i] - line(s[i]) for i in up_o]))]; L.apex_l = lo_o[int(np.argmin([psi[i] - line(s[i]) for i in lo_o]))]
    return L


def _rot_about(a, ang):
    """Rotation matrices (n,3,3) about unit axis a by per-row angles."""
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]]); ang = np.asarray(ang)[:, None, None]
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * (K @ K)


def eye_lid_pose(L, v, upper=0.0, lower=0.0, mode="dqs"):
    """Lid vertices for joint angles (radians, positive = toward closing for both lids). 'dqs': the dual-quaternion blend
    of head and lid joint (a rotation about the hinge by 2 atan(w sin(t/2) / (1 - w + w cos(t/2)))); 'lbs': linear blend."""
    p = v - L.C; out = v.copy()
    for w, th in ((L.wu, upper), (L.wl, -lower)):
        m = w > 0
        if not m.any() or th == 0: continue
        if mode == "dqs":
            ang = 2 * np.arctan2(w[m] * math.sin(th / 2), 1 - w[m] + w[m] * math.cos(th / 2))
            out[m] = L.C + np.einsum("nij,nj->ni", _rot_about(L.a, ang), p[m])
        else:
            full = np.einsum("nij,nj->ni", _rot_about(L.a, np.full(m.sum(), th)), p[m])
            out[m] = L.C + (1 - w[m, None]) * p[m] + w[m, None] * full
    return out


def eye_lid_report(base, v, label="", src=None):
    """The numbers the brief asks for: gap, intersection, iris coverage, closure; for dual-quaternion and linear skinning
    and for MakeHuman's own linear closure target."""
    rep = {}
    for side in ("l",):
        L = eye_lids(base, v, side, eye_fit(base, src if src is not None else v, side)); R = L.R; surf = eye_surface_table(R)
        mu, ml = L.margin_u[1:-1], L.margin_l[1:-1]
        yu = (v[L.apex_u] - L.C) @ L.u; yl = (v[L.apex_l] - L.C) @ L.u
        rep["radius_mm"] = R * 1000; rep["hinge_axis"] = L.a.round(4).tolist()
        rep["aperture_mm"] = (yu - yl) * 1000; rep["width_mm"] = abs(L.s[L.lat] - L.s[L.med]) * 1000
        rep["iris_covered_top_mm"] = (P["iris_d"] / 2 - yu) * 1000; rep["iris_covered_bottom_mm"] = (P["iris_d"] / 2 + yl) * 1000
        rep["margin_gap_rest_mm"] = [float((L.r[np.r_[mu, ml]] - R).min() * 1000), float((L.r[np.r_[mu, ml]] - R).max() * 1000)]
        rep["close_deg"] = [math.degrees(L.theta_u), math.degrees(L.theta_l)]
        lid = ((L.wu > 0) | (L.wl > 0)) & ~L.inner & base.vgroups["body"]
        ang0 = np.degrees(np.arccos(np.clip((v[lid] - L.C)[:, 2] / L.r[lid], -1, 1)))
        rep["cornea_through_lid_rest_mm"] = float(np.maximum(np.interp(ang0, np.arange(len(surf)), surf, right=R) - L.r[lid], 0).max() * 1000)
        for mode in ("dqs", "lbs"):
            worst = 0.0; worst_c = 0.0
            for cfrac in np.linspace(0, 1, 21):
                vv = eye_lid_pose(L, v, cfrac * L.theta_u, cfrac * L.theta_l, mode); rr = np.linalg.norm(vv - L.C, axis=1)
                worst = max(worst, float((L.r[lid] - rr[lid]).max()))
                angc = np.degrees(np.arccos(np.clip((vv[lid] - L.C)[:, 2] / rr[lid], -1, 1)))
                worst_c = max(worst_c, float(np.maximum(np.interp(angc, np.arange(len(surf)), surf, right=R) - rr[lid], 0).max()))
            vv = eye_lid_pose(L, v, L.theta_u, L.theta_l, mode); pp = vv - L.C
            psi_u = np.arctan2(pp[mu] @ L.u, pp[mu] @ L.f); psi_l = np.arctan2(pp[ml] @ L.u, pp[ml] @ L.f)
            seam_u = (psi_u - L.pc[mu]) * R; seam_l = (psi_l - L.pc[ml]) * R
            rep[mode] = {"sink_into_ball_max_mm": worst * 1000, "cornea_through_lid_blink_mm_without_lift": worst_c * 1000,
                         "closed_seam_error_mm": [float(seam_u.min() * 1000), float(seam_u.max() * 1000), float(seam_l.min() * 1000), float(seam_l.max() * 1000)]}
        # MakeHuman's closure target, linear
        try:
            idx, dl = mh.load_target("expression/units/caucasian/eye-left-closure"); body = base.vgroups["body"]; idx_b = idx[body[idx]]; dlb = dl[body[idx]]
            worst = -1; gap = 0
            for cfrac in np.linspace(0, 1, 21):
                rr = np.linalg.norm(v[idx_b] + cfrac * dlb - L.C, axis=1); close = L.r[idx_b] < R + 0.001
                worst = max(worst, float((R - rr).max())); gap = max(gap, float((rr[close] - L.r[idx_b][close]).max()))
            vv = v.copy(); vv[idx] += dl; pp = vv - L.C
            seam = (np.arctan2(pp[mu] @ L.u, pp[mu] @ L.f) - np.arctan2(pp[ml] @ L.u, pp[ml] @ L.f).mean()) * R
            rep["makehuman_closure_target"] = {"sink_into_ball_max_mm": worst * 1000, "margin_lifts_off_ball_max_mm": gap * 1000, "upper_margin_above_lower_when_closed_mm": [float(seam.min() * 1000), float(seam.max() * 1000)], "moves": "upper and lower together, one target, no gaze following"}
        except Exception as ex: rep["makehuman_closure_target"] = str(ex)
    if label: log(label, json.dumps(rep, default=lambda x: round(float(x), 3)))
    return rep


def eye_lid_fit(base, v, CR=None):
    """The lids of both eyes re-seated on the ball, for any full vertex array: (1) opened or closed about the hinge until
    the upper margin covers P.cover_top of the iris and the lower P.cover_bottom; (2) the margin ring brought to
    P.clear..P.clear_max above the scleral sphere and every lid point within reach pushed outside it; (3) the corneal
    bulge (straight gaze) added under the lid, fading with distance from the ball. eyes.ts moves (3) with the gaze."""
    out = v.copy(); body = base.vgroups["body"]
    for side in ("l", "r"):
        L = eye_lids(base, out, side, CR[side] if CR else eye_fit(base, v, side)); R = L.R; ri = P["iris_d"] / 2; rm = R + 0.0003
        tu = float(L.fu(0.0)) - math.asin((ri - P["cover_top"]) / rm); tl = -math.asin((ri - P["cover_bottom"]) / rm) - float(L.fl(0.0))
        w0u = (float(L.fu(0.0)) - (float(L.fl(0.0)) + P["close_at"] * (float(L.fu(0.0)) - float(L.fl(0.0))))) / L.theta_u
        w0l = P["close_at"] * (float(L.fu(0.0)) - float(L.fl(0.0))) / L.theta_l
        out = eye_lid_pose(L, out, tu / max(w0u, 0.3), tl / max(w0l, 0.3))
        p = out - L.C; r = np.linalg.norm(p, axis=1); sel = np.where(((L.wu > 0.02) | (L.wl > 0.02)) & ~L.inner & body & (r < R + P["lift_reach"]))[0]
        ring = np.zeros(len(v), bool); ring[eye_ring(base, side)] = True
        r1 = np.maximum(r[sel], R + P["clear"]); r1 = np.where(ring[sel], np.minimum(r1, R + P["clear_max"]), r1)
        k = 1 - _ss((r1 - R - 0.0010) / (P["lift_reach"] - 0.0010))
        ang = np.degrees(np.arccos(np.clip(p[sel, 2] / r[sel], -1, 1))); h = np.interp(ang, np.arange(91), eye_surface_table(R) - R, right=0.0)
        out[sel] = L.C + p[sel] / r[sel, None] * (r1 + k * h)[:, None]
    return out


class EyeContext:
    """What a package builder uses instead of build_body's context when the head has these eyes:
    base_v and targets with the lids re-seated (eye_lid_fit on the base and on every target), skeleton with the eye joints
    on the fitted centres plus four lid joints, W with the lid weights, joint_targets, dqs mask, lids."""
    pass


def eye_canthus(n=None, sex="m"):
    """The inner-corner correction (P.canthus_push[sex] x MakeHuman's push2-out on both eyes) as a full-mesh vertex delta. Env B5_CANTHUS
    overrides the weight (probes only)."""
    w = float(os.environ.get("B5_CANTHUS", P["canthus_push"].get(sex, P["canthus_push"]["m"])))
    d = sum(mh.target_dense(t) for t in CANTHUS_TARGETS)
    return w * d if n is None else w * d[:n]


def eye_context(c):
    e = EyeContext(); e.base = c.base; e.tris, e.tri_uv = c.tris, c.tri_uv; e.src = c
    names = list(c.skeleton.names)
    v0 = c.base_v + eye_canthus(len(c.base_v), getattr(c, "sex", "m")); e.canthus = v0 - c.base_v      # round 4: the inner corners first (see P.canthus_push)
    e.eye = {sd: eye_fit(c.base, v0, sd) for sd in ("l", "r")}                           # centre: fitted on the source base mesh (with its inner corners); radius constant
    # under a shape target the eye moves rigidly with its joint (the body's jointDeltas), and the lids are re-seated on it there
    e.eye_targets = {k: {sd: (e.eye[sd][0] + np.asarray(c.joint_targets[k][_joint(names, "eye_" + sd)]), e.eye[sd][1]) for sd in ("l", "r")} for k in c.targets}
    e.base_v = eye_lid_fit(c.base, v0, e.eye)
    e.targets = {k: eye_lid_fit(c.base, v0 + d, e.eye_targets[k]) - e.base_v for k, d in c.targets.items()}
    e.skeleton, e.joint_targets = c.skeleton, c.joint_targets
    e.W = c.W if getattr(c, "J4", None) is None else sp.csr_matrix((np.asarray(c.W4, dtype=np.float64).ravel(), (np.repeat(np.arange(len(c.J4)), 4), np.asarray(c.J4).ravel())), shape=c.W.shape)
    e.dqs0 = getattr(c, "dqs", None)
    e.W_src = sp.hstack([e.W, sp.csr_matrix((e.W.shape[0], 4))]).tocsr()      # the body's own weights on the extended skeleton: for everything that is NOT a lid or a lash
    rig = eye_rig(e); e.rig = rig; e.skeleton, e.W, e.joint_targets, e.dqs, e.lids = rig["skeleton"], rig["W"], rig["joint_targets"], rig["dqs"], rig["lids"]
    return e


def eye_rig(c):
    """Adds the four lid joints to the body's skeleton and weights.
    -> dict(skeleton, W (19158, B+4) csr, joint_targets, dqs (19158,) mask, lids {side: Lids}).
    Lid vertices lose their old face-bone weights (static bones, the same as the head) and get head + lid joints."""
    base = c.base; names = list(c.skeleton.names); B = len(names); ih = _joint(names, "head")
    head = np.asarray(c.skeleton.head); parent = np.asarray(c.skeleton.parent)
    W = sp.hstack([sp.csr_matrix(c.W), sp.csr_matrix((c.W.shape[0], 4))]).tolil(); dqs = np.zeros(c.W.shape[0]); lids = {}; We = sp.csc_matrix(c.W)
    new_head = []; jt = {k: [] for k in c.joint_targets}; moved = {}
    for si, side in enumerate(("l", "r")):
        L = eye_lids(base, c.base_v, side, c.eye[side]); lids[side] = L; ie = _joint(names, "eye_" + side)
        for vi in np.where((L.wu > 0) | (L.wl > 0))[0]:
            W.rows[vi] = []; W.data[vi] = []
            rest = 1.0 - L.wu[vi] - L.wl[vi]
            if rest > 1e-6: W[vi, ih] = rest
            if L.wu[vi] > 0: W[vi, B + 2 * si] = L.wu[vi]
            if L.wl[vi] > 0: W[vi, B + 2 * si + 1] = L.wl[vi]
            dqs[vi] = 1.0
        body_eye = np.where(base.vgroups["body"] & (np.asarray(We[:, ie].todense()).ravel() > 0) & (dqs == 0))[0]
        for vi in body_eye:                                               # socket skin must not turn with the eyeball
            w = W[vi, ie]; W[vi, ie] = 0; W[vi, ih] = W[vi, ih] + w
        head = head.copy(); head[ie] = L.C; moved[ie] = {k: c.eye_targets[k][side][0] - L.C for k in c.targets}
        for _ in range(2):
            new_head.append(L.C)
            for k in jt: jt[k].append(moved[ie][k])
    JT = {}
    for k, v in jt.items():
        b = np.array(c.joint_targets[k], dtype=np.float64).copy()
        for ie, m in moved.items(): b[ie] = m[k]
        JT[k] = np.concatenate([b, np.array(v)])
    skel = glb.Skeleton(names + list(LID_JOINTS), np.concatenate([parent, np.full(4, ih)]), np.concatenate([head, np.array(new_head)]), None)
    if getattr(c, "dqs0", None) is not None: dqs = np.maximum(dqs, np.asarray(c.dqs0, dtype=np.float64))
    return {"skeleton": skel, "W": W.tocsr(), "joint_targets": JT, "dqs": dqs, "lids": lids}


def eye_wet(c, rig, material="eye_wet"):
    """The tear line: a three-row fillet between the lower lid margin and the ball, both eyes in one mesh. Follows the
    lower lid joint and the shape morphs through the margin vertex each column is built on."""
    V = []; T = []; src = []
    for side in ("l", "r"):
        L = rig["lids"][side]; ix = [i for i in L.margin_l]; off = len(V)
        for i in ix:
            s = L.s[i]; ps = L.psi[i]
            for dpsi, rad in ((math.radians(5.0), L.R + 0.00003), (math.radians(1.3), L.R + 0.00012), (math.radians(-0.6), L.r[i] + 0.00008)):
                rr = max(rad, abs(s) + 1e-5); ra = math.sqrt(rr * rr - s * s); a2 = ps + dpsi
                V.append(L.C + L.a * s + ra * (math.cos(a2) * L.f + math.sin(a2) * L.u)); src.append(i)
        for k in range(len(ix) - 1):
            for row in range(2):
                A0, A1, B0, B1 = off + 3 * k + row, off + 3 * (k + 1) + row, off + 3 * k + row + 1, off + 3 * (k + 1) + row + 1
                T += [(B0, B1, A1), (B0, A1, A0)]
    V = np.array(V); src = np.array(src)
    return glb.Mesh("eye_wetline", V, np.array(T), material, weights=rig["W"][src], morphs={k: d[src] for k, d in c.targets.items()}, attrs={"_DQS": np.ones(len(V))}), src


LASH = {  # lash card lengths in metres (real upper lashes 8-12 mm, lower 6-8; kept a little short: designer), lash-line strength, and the
    # manifest's alpha test. Round 4: alpha test 0 = the texture's alpha IS the coverage (viewer `lashes` recipe: alpha-to-coverage over 4x MSAA,
    # and with alphaTest 0 three.js drops its alpha cut-off). Any cut-off above 0 turns every soft edge of this atlas into a hard one: that was the
    # "hard painted stroke" of the brows and the hard dark lash line (three's ALPHA_TO_COVERAGE path is smoothstep(alphaTest, +fwidth)).
    "f": dict(up=0.0085, low=0.0032, alpha_test=0.0, line=1.0), "m": dict(up=0.0068, low=0.0026, alpha_test=0.0, line=1.0)}      # round 5: line 1.0 (review 07: "no dark line at the margin")
BROW_ASSET = "eyebrows/eyebrow001/eyebrow001.mhclo"       # round 3 (kept for old callers; NOT read any more: see BROWS)
BROWS = {  # round 4: MakeHuman system assets (CC0), card mesh (same 124-vertex topology in all twelve) and painted hairs. Woman: eyebrow010 (soft,
    # feathered, tapered arch); man: eyebrow012 (full, natural, hair direction). Replaces 001 (a solid painted shape) and B2's 007 for her (a thin line).
    "f": "eyebrows/eyebrow010/eyebrow010.mhclo", "m": "eyebrows/eyebrow012/eyebrow012.mhclo"}
BROW_LOOK = {  # brow colour (sRGB, a little lighter and warmer than the light-tone hair of build_operator.TONES: hair 44/33/27, brow 58/44/36),
    # coverage at the inner head / body / tail, overall coverage (the rest of the softness is the pack's own feathered hairs)
    "f": dict(rgb=(60, 45, 36), head=0.50, tail=0.78, gain=1.0, dense=3.0), "m": dict(rgb=(56, 43, 35), head=0.55, tail=0.80, gain=1.0, dense=2.6)}


def eye_rest_expression(base_v, sex="m"):
    """The rest face (review 04: "grim mouth"; level corners, lips closed and relaxed, a trace of attention, not symmetric), from
    MakeHuman's expression units at small weights, as a delta on a full vertex array. No eye units: the lids are joints."""
    T = mh.list_targets(); U = "expression/units/caucasian/"
    w = {"mouth-corner-puller": 0.16, "mouth-elevation": 0.06, "mouth-compression": 0.04, "eyebrows-left-inner-up": 0.07, "eyebrows-right-inner-up": 0.05, "eyebrows-left-up": 0.05, "eyebrows-right-up": 0.03}
    d = np.zeros_like(base_v)
    for k, x in w.items():
        t = mh.target_dense(U + k if (U + k) in T else k)
        if "left" not in k and "right" not in k: t = t * (1.0 + 0.2 * np.tanh(base_v[:, 0] / 0.02))[:, None]      # the left side a fifth stronger
        d += x * t
    return d


def eye_lashes(c, rig, sex="m", material="lashes_soft", brows=True):
    """The hair of the eye region in ONE mesh, one material, one texture (eye_lash_texture): a soft dark lash line on the upper lid
    margin, short fine lash cards on both lids, the caruncle (inner corner), and the brows (the pack's card mesh and painted hairs).
    Lash line and cards stand on lid vertices and take their weights and shape deltas, so they ride the lid joints (`_DQS` = 1);
    brows and caruncle stay with the head. UV (v up): upper lashes 0.75..1, lower 0.75..0.58, lash line 0.50..0.56, brows the
    lower left quarter, caruncle a block lower right."""
    V = []; N = []; UV = []; T = []; src = []; lp = LASH[sex]
    def unit(x): return x / max(np.linalg.norm(x), 1e-12)
    q = c.base.quads; body = c.base.vgroups["body"]; nbr = {}
    for a_, b_ in np.concatenate([q[:, [0, 1]], q[:, [1, 2]], q[:, [2, 3]], q[:, [3, 0]]]): nbr.setdefault(int(a_), set()).add(int(b_)); nbr.setdefault(int(b_), set()).add(int(a_))
    vn = mh.smooth_normals(c.base_v, c.tris)
    def outward(L, i, steps):
        """Walk from a margin vertex over mesh edges away from the eye: the rings of the lid's rim."""
        path = [int(i)]
        for _ in range(steps):
            cur = path[-1]; cand = [j for j in nbr.get(cur, ()) if j not in path and body[j] and not L.inner[j] and L.r[j] > L.r[cur]]
            if not cand: break
            path.append(max(cand, key=lambda j: L.r[j] - 0.5 * abs(L.s[j] - L.s[i])))
        return path
    for side in ("l", "r"):
        L = rig["lids"][side]; sgn = 1.0 if side == "l" else -1.0; lat = L.a * sgn
        for upper, ix, length, reps in ((True, list(L.margin_u), lp["up"], 3.0), (False, list(L.margin_l), lp["low"], 2.0)):
            s_ = L.s[ix] * sgn; tm = (s_ - s_.min()) / (s_.max() - s_.min())                       # 0 = inner corner, 1 = outer
            paths = [outward(L, i, 5) for i in ix]        # (round 6: 5 steps, ring 5 for the lash line's upper fade) measured on hm08: the lid's rim is three rings (about 3 mm) deep; ring 3 is its FRONT edge, ring 4 the lid skin above it
            if upper:                                                                              # the lash line: a band over the lid's rim, darkest on its front edge
                off = len(V); rows = 0
                for k, pth in enumerate(paths):
                    if len(pth) < 5 or not (0.04 < tm[k] < 0.97): continue
                    # round 6 (review 09: "the lash line is darker but still faint at 1.2 m"): the band now reaches one ring further, onto the lid skin
                    # above the rim (ring 4 to 5), which faces the camera; the rim itself faces down and is seen nearly edge-on from the front
                    rr_ = [pth[2], pth[3], pth[4], pth[5] if len(pth) > 5 else pth[4]]
                    for j, v_ in zip(rr_, (0.503, 0.525, 0.547, 0.568)): V.append(c.base_v[j] + vn[j] * 0.00012); N.append(vn[j]); UV.append((tm[k] * 0.98 + 0.01, v_)); src.append(j)   # u = place along the lid (no tiling)
                    rows += 1
                for k in range(rows - 1):
                    for row in range(3):
                        a0, a1, b0, b1 = off + 4 * k + row, off + 4 * (k + 1) + row, off + 4 * k + row + 1, off + 4 * (k + 1) + row + 1
                        T += [(a0, a1, b1), (a0, b1, b0)]
            cols = []; fx = [pth[min(3, len(pth) - 1)] for pth in paths]
            for k in range(len(ix)):
                cols.append((c.base_v[fx[k]] - L.C, tm[k], fx[k], vn[fx[k]]))
                if k + 1 < len(ix):
                    pm = 0.5 * (c.base_v[fx[k]] + c.base_v[fx[k + 1]]) - L.C; pm *= 0.5 * (L.r[fx[k]] + L.r[fx[k + 1]]) / np.linalg.norm(pm)
                    cols.append((pm, 0.5 * (tm[k] + tm[k + 1]), fx[k] if tm[k] > 0.5 else fx[k + 1], unit(vn[fx[k]] + vn[fx[k + 1]])))
            off = len(V); n_cols = 0
            for p, t, i, nrm in cols:
                win = _ss((t - 0.14) / 0.2) * (1 - 0.45 * _ss((t - 0.86) / 0.14)); ln = length * win * (0.72 + 0.28 * math.sin(math.pi * min(1.0, t * 1.15)))
                rad = unit(p); up = -unit(np.cross(L.a, rad)); fan = lat * 0.55 * (t - 0.42); fw = unit(0.35 * rad + 0.65 * np.array([0, 0, 1.0]))
                if upper:      # upper lashes leave the front edge of the margin forward and up (about 25 deg), then curl up (about 60 deg). Round 3's went
                               # forward and DOWN first: from the front the card was a 1 mm sliver on the lash line, so no lash could be seen at 1.2 m
                    root = p + nrm * 0.00015; mid = root + unit(fw + up * 0.45 + fan) * ln * 0.5; tip = mid + unit(fw * 0.6 + up * 1.0 + fan * 1.3) * ln * 0.5
                    vs = (0.752, 0.89, 0.998)
                else:
                    root = p + nrm * 0.00015; mid = root + unit(fw - up * 0.5 + fan) * ln * 0.55; tip = mid + unit(fw * 0.7 - up * 0.8 + fan * 1.3) * ln * 0.45
                    vs = (0.748, 0.65, 0.585)
                for q_, v_ in zip((root, mid, tip), vs): V.append(L.C + q_); N.append(rad); UV.append((t * reps, v_)); src.append(i)
                n_cols += 1
            for k in range(n_cols - 1):
                for row in range(2):
                    a0, a1, b0, b1 = off + 3 * k + row, off + 3 * (k + 1) + row, off + 3 * k + row + 1, off + 3 * (k + 1) + row + 1
                    T += [(a0, a1, b1), (a0, b1, b0)]
        # caruncle: a low dome tucked into the inner corner (review 04: "inner corner too pink": smaller, sunk, desaturated)
        pm = c.base_v[L.med] - L.C; cc = unit(pm + lat * 0.0012) * (L.R - 0.0001); rad = unit(cc); up = -unit(np.cross(L.a, rad)); ax = unit(np.cross(up, rad))
        off = len(V); nu, nv = 12, 5
        for j in range(nv + 1):
            th = (j / nv) * math.pi * 0.5
            for k in range(nu):
                ph = 2 * math.pi * k / nu; d = np.array([math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)])
                V.append(L.C + cc + ax * d[0] * 0.0021 + up * d[1] * 0.0014 + rad * (d[2] * 0.0006 - 0.0002)); N.append(unit(ax * d[0] / 2.1 + up * d[1] / 1.4 + rad * d[2] / 0.4))   # round 4: 4.2 x 2.8 mm: fills the longer inner corner
                UV.append((0.8 + 0.05 * d[0], 0.2 + 0.05 * d[1])); src.append(L.med)
        for j in range(nv):
            for k in range(nu):
                a0, a1, b0, b1 = off + j * nu + k, off + j * nu + (k + 1) % nu, off + (j + 1) * nu + k, off + (j + 1) * nu + (k + 1) % nu
                T += [(a0, b0, b1), (a0, b1, a1)]
    V = np.array(V); src = np.array(src); UV = np.array(UV); T = np.array(T); N = np.array(N)
    W = rig["W"][src]; morphs = {k: d[src] for k, d in c.targets.items()}; dqs = np.ones(len(V)); TUV = T.copy()
    if brows:                                                  # the pack's brow cards, fitted on the SOURCE body (they do not ride the lids)
        import mh_wardrobe as wd, materials as mt
        A = wd.Asset(os.path.join(mt.SYS, BROWS[sex])); S0 = getattr(c, "src", c); bt, btu = A.tris(); v0 = A.fit(S0.base_v)      # round 4: per sex (BROWS); BROW_ASSET is no longer read
        W = sp.vstack([W, A.weights(getattr(c, "W_src", rig["W"]))]).tocsr()
        morphs = {k: np.concatenate([morphs[k], A.fit(S0.base_v + S0.targets[k]) - v0]) for k in morphs}
        T = np.concatenate([T, bt + len(V)]); TUV = np.concatenate([TUV, btu + len(UV)]); UV = np.concatenate([UV, np.asarray(A.uv) * 0.5])
        N = np.concatenate([N, mh.smooth_normals(v0, bt)]); V = np.concatenate([V, v0]); dqs = np.concatenate([dqs, np.zeros(len(v0))])
    return glb.Mesh("lashes", V, T, material, uv=UV, tri_uv=TUV, weights=W, morphs=morphs, normals=N, morph_normals=False, attrs={"_DQS": dqs})


def _brow_tmap(A, size):
    """Place along the brow, 0 at the inner head, 1 at the tail, for every texel of the brow texture (the card's UV layout, image rows
    from the top). From the card's 3D shape on the hm08 base: |x| per brow, normalised per brow; texels outside the cards get -1."""
    import mh_core as mh_
    vb = A.fit(mh_.load_base().v); bt, btu = A.tris(); uv = np.asarray(A.uv, dtype=np.float64); n = size; tmap = np.full((n, n), -1.0)
    ax = np.abs(vb[:, 0]); side = vb[:, 0] > 0; t = np.zeros(len(vb))
    for sd in (True, False):
        m = side == sd
        if m.any(): t[m] = (ax[m] - ax[m].min()) / max(ax[m].max() - ax[m].min(), 1e-9)
    yy, xx = np.mgrid[0:n, 0:n]; px = (xx + 0.5) / n; py = 1.0 - (yy + 0.5) / n                 # texel centre in UV (v up)
    for f, fu in zip(bt, btu):
        P = uv[fu]; tv = t[f]; x0, x1 = max(0, int(P[:, 0].min() * n) - 1), min(n, int(P[:, 0].max() * n) + 2); y0, y1 = max(0, int((1 - P[:, 1].max()) * n) - 1), min(n, int((1 - P[:, 1].min()) * n) + 2)
        if x1 <= x0 or y1 <= y0: continue
        X, Y = px[y0:y1, x0:x1], py[y0:y1, x0:x1]; (ax_, ay_), (bx_, by_), (cx_, cy_) = P; den = (by_ - cy_) * (ax_ - cx_) + (cx_ - bx_) * (ay_ - cy_)
        if abs(den) < 1e-14: continue
        l1 = ((by_ - cy_) * (X - cx_) + (cx_ - bx_) * (Y - cy_)) / den; l2 = ((cy_ - ay_) * (X - cx_) + (ax_ - cx_) * (Y - cy_)) / den; l3 = 1 - l1 - l2
        inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02); sub = tmap[y0:y1, x0:x1]; sub[inside] = (l1 * tv[0] + l2 * tv[1] + l3 * tv[2])[inside]
    return tmap


def eye_lash_texture(path, size=(1024, 1024), seed=11, sex="m", brow_rgb=None):
    """The eye region's hair atlas (see eye_lashes for the layout), drawn for alpha-to-coverage WITHOUT a cut-off (LASH alpha_test 0): alpha is
    how much of a pixel the hair covers. Upper lashes: tapered strands in clumps of two or three, roots dense, tips sparse; lower lashes fewer and
    fainter; the lash line a soft band, dotted by the roots, fading in from the inner corner (its u runs along the whole lid, no tiling); the
    pack's brow hairs (BROWS[sex]) kept sharp, thinned at the inner head and the tail (BROW_LOOK), tinted; the caruncle's colour lower right.
    brow_rgb: the brow colour (sRGB) if the build has its own per skin tone (build_operator.TONES[tone]["brow"] would do)."""
    from PIL import Image, ImageDraw, ImageFilter
    import materials as mt, mh_wardrobe as wd
    W, H = size; S = 2; rs = np.random.RandomState(seed); al = Image.new("L", (W * S, H * S), 0); d = ImageDraw.Draw(al)
    def strand(x0, y_root, direction, h, w0, a0, a1, lean, bow, tipx=None):
        seg = 12
        for k in range(seg):
            u0, u1 = k / seg, (k + 1) / seg
            f = lambda u: (x0 + lean * u + bow * u * (1 - u) * 2 + ((tipx - x0 - lean) * u * u if tipx is not None else 0.0), y_root + direction * h * u)
            wd_ = max(0.9, w0 * (1 - 0.85 * u0)); a = int(255 * (a0 + (a1 - a0) * u0 ** 0.7))
            for dx in (-W, 0, W):
                (xa, ya), (xb, yb) = f(u0), f(u1); d.line([((xa + dx) * S, ya * S), ((xb + dx) * S, yb * S)], fill=a, width=max(1, int(round(wd_ * S))))
    # upper lashes, rows 0 .. H/4 (roots on the H/4 line); one tile is a third of the lid (about 9 mm): 105 px per mm across, 31 per mm along a lash
    for _ in range(42):
        x0 = rs.rand() * W; h = H * 0.235 * (0.6 + 0.4 * rs.rand()); lean = (rs.rand() - 0.5) * 40 + 8; bow = (rs.rand() - 0.5) * 20; tip = x0 + lean + (rs.rand() - 0.5) * 14
        for _k in range(2 + int(rs.rand() < 0.4)):                                                   # a loose clump: roots apart, tips near each other
            x1 = x0 + (rs.rand() - 0.5) * 22; strand(x1, H * 0.25, -1, h * (0.85 + 0.15 * rs.rand()), 9.0, 1.0, 0.25, lean, bow, 0.5 * (tip + x1 + lean))
    for _ in range(26):                                                                               # single fine lashes between the clumps
        x0 = rs.rand() * W; strand(x0, H * 0.25, -1, H * 0.2 * (0.45 + 0.4 * rs.rand()), 6.5, 0.9, 0.15, (rs.rand() - 0.5) * 40 + 8, (rs.rand() - 0.5) * 16)
    for _ in range(26):                                                                               # lower lashes, rows H/4 .. 0.42 H
        x0 = rs.rand() * W; strand(x0, H * 0.25, +1, H * 0.16 * (0.45 + 0.55 * rs.rand()), 6.0, 0.7, 0.1, (rs.rand() - 0.5) * 40, (rs.rand() - 0.5) * 14)
    al = al.filter(ImageFilter.GaussianBlur(S * 0.6)).resize((W, H), Image.LANCZOS); a = np.asarray(al, dtype=np.float64) / 255
    y = (np.arange(H)[:, None] + 0.5) / H; x = (np.arange(W)[None, :] + 0.5) / W
    a = np.maximum(a, 0.95 * np.exp(-((y - 0.25) / 0.006) ** 2) * (y <= 0.25))                    # dense roots of the upper lashes (round 5: 0.75 -> 0.95)
    a[int(H * 0.43):int(H * 0.505)] = 0
    # the lash line band (v 0.50 .. 0.56, u = place along the lid): soft, darkest on the lid's front edge, dotted by roots, fading in from the
    # inner corner and a little stronger toward the outer third (where the lashes are)
    noise = np.convolve(rs.rand(W * 3), np.ones(5) / 5, "same")[W:2 * W][None, :]; noise = (noise - noise.min()) / (np.ptp(noise) + 1e-9)
    # round 6: full strength over the rim's front edge (ring 3, y 0.475) and the lid skin just above it (ring 4, y 0.453), soft into the rim (ring 2)
    # and up to nothing at ring 5 (y 0.432); in from the inner corner by 18 % of the lid (was 27 %)
    along = _ss((x - 0.04) / 0.14) * (0.9 + 0.1 * _ss((x - 0.5) / 0.4)) * (1 - 0.6 * _ss((x - 0.93) / 0.07))
    band = np.where(y > 0.482, np.exp(-((y - 0.482) / 0.007) ** 2), np.where(y < 0.452, np.exp(-((y - 0.452) / 0.009) ** 2), 1.0)) * (y > 0.43) * (y < 0.505)
    a = np.maximum(a, LASH[sex]["line"] * band * along * (0.85 + 0.15 * noise))
    rgb = np.zeros((H, W, 3)); rgb[:] = (20, 15, 13)                                             # round 5: darker (was 30 / 22 / 19)
    a[H // 2:] = 0
    try:                                                                                          # brows: the pack's painted hairs, lower left quarter
        A = wd.Asset(os.path.join(mt.SYS, BROWS[sex])); look = BROW_LOOK[sex]; n = W // 2
        bt = Image.open(A.textures["diffuse"]).convert("RGBA").resize((n, n), Image.LANCZOS); b = np.asarray(bt, dtype=np.float64); ba = b[:, :, 3] / 255
        ba = np.asarray(Image.fromarray((ba * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.35)), dtype=np.float64) / 255
        tm = _brow_tmap(A, n); dens = np.where(tm < 0, 1.0, look["head"] + (1 - look["head"]) * _ss(tm / 0.32)) * np.where(tm < 0, 1.0, 1 - (1 - look["tail"]) * _ss((tm - 0.8) / 0.2))
        a[H // 2:, :W // 2] = np.clip((1 - (1 - ba) ** look["dense"]) * dens * look["gain"], 0, 1)      # dense: the painted hairs' half-tones filled in (mip-mapping at 1.2 m thins them again)
        lum = b[:, :, :3].mean(2, keepdims=True) / 255; col = np.array(brow_rgb or look["rgb"], dtype=np.float64)
        rgb[H // 2:, :W // 2] = np.clip(col * (0.8 + 0.5 * lum), 0, 255)                         # the painted hairs' own light and dark, around the brow colour
    except Exception as ex: log("brow texture not available:", ex)
    a[int(H * 0.56):, int(W * 0.6):] = 1.0; rgb[int(H * 0.54):, int(W * 0.58):] = (166, 128, 118)   # caruncle: a muted flesh tone
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(np.dstack([rgb, a * 255]).astype(np.uint8), "RGBA").save(path)
    return path


def eye_manifest(c, rig, construction="shell"):
    """The manifest block "eyes" that viewer/src/eyes.ts reads (a proposal for FORMAT.md v0.3)."""
    names = rig["skeleton"].names; out = {"by": "pipeline/eyes.py (B5)", "construction": construction, "irisRadius": P["iris_d"] / 2, "sides": {}, "lift": []}
    for si, side in enumerate(("l", "r")):
        L = rig["lids"][side]; rel = lambda i: [round(float(x), 6) for x in (c.base_v[i] - L.C)]
        out["sides"][side] = {"joint": names[_joint(names, "eye_" + side)], "mesh": "eyeball_" + side, "radius": round(L.R, 6), "centre": [round(float(x), 6) for x in L.C],
                              "hinge": [round(float(x), 5) for x in L.a],
                              "upper": {"joint": LID_JOINTS[2 * si], "closeDeg": round(math.degrees(L.theta_u), 3)},
                              "lower": {"joint": LID_JOINTS[2 * si + 1], "closeDeg": round(-math.degrees(L.theta_l), 3)},
                              "canthusMedial": rel(L.med), "canthusLateral": rel(L.lat), "apexUpper": rel(L.apex_u), "apexLower": rel(L.apex_l)}
        body = c.base.vgroups["body"]; m = np.where(((L.wu > 0.02) | (L.wl > 0.02)) & ~L.inner & body & (L.r < L.R + P["lift_list"]))[0]
        k = 1 - _ss((L.r[m] - L.R - 0.0010) / (P["lift_reach"] - 0.0010))
        out["lift"].append({"mesh": "body", "side": side, "verts": [[round(float(x), 6) for x in c.base_v[i]] + [round(float(L.wu[i]), 4), round(float(L.wl[i]), 4), round(float(kk), 3)] for i, kk in zip(m, k)]})
    L = rig["lids"]["l"]; out["bulge"] = {"stepDeg": 1, "h": [round(float(x), 6) for x in (eye_surface_table(L.R, 46) - L.R)], "note": "cornea height above the scleral sphere against the angle from the optical axis, metres, base size"}
    return out


# ------------------------------------------------------------------------------------------------ textures
def eye_iris_texture(path, size=1024, seed=7):
    """Procedural iris structure and sclera, one RGB PNG in the eyeball's front projection (the ball's silhouette fills the
    image; the iris is the central disc). R: iris fibre brightness, G: pigment (collarette, crypts), B: sclera veins.
    Colour is applied by the shader, so one texture serves every iris colour."""
    from PIL import Image, ImageDraw, ImageFilter
    rs = np.random.RandomState(seed); n = size; _, R = 0, 0.014954
    iris_uv = 1.06 * (P["iris_d"] / 2) / R * 0.5                                  # iris radius in uv (see materials.ts: uv = 0.5 + 0.5 p)
    y, x = np.mgrid[0:n, 0:n]; dx = (x + 0.5) / n - 0.5; dy = (y + 0.5) / n - 0.5
    r = np.hypot(dx, dy) / iris_uv; th = np.arctan2(dy, dx)
    def pnoise(k, sm):                                                            # periodic 1-D noise over the angle
        a = rs.rand(k); f = np.fft.rfft(a); f[int(k * sm):] = 0; a = np.fft.irfft(f, k); a = (a - a.min()) / (np.ptp(a) + 1e-9)
        return lambda t: np.interp((t / (2 * math.pi)) % 1.0 * k, np.arange(k + 1), np.r_[a, a[0]])
    fib = np.zeros_like(r)
    for k, amp, twist in ((90, 0.45, 0.25), (220, 0.35, 0.5), (520, 0.2, 0.9)):
        fib += amp * pnoise(k, 0.5)(th + twist * 0.15 * np.sin(r * 5 + k))
    wob = pnoise(24, 0.4)(th); coll = 0.40 + 0.07 * (wob - 0.5)                    # collarette radius wobbles
    radial = np.interp(r, [0, 0.28, coll.mean(), 0.75, 1.0], [0.35, 0.55, 1.0, 0.8, 0.55])
    red = np.clip(0.25 + 0.75 * fib * radial, 0, 1)
    pig = np.exp(-((r - coll) / 0.07) ** 2) * (0.6 + 0.4 * pnoise(60, 0.5)(th))
    cr = pnoise(36, 0.6)(th + 0.3); pig = np.clip(pig + 0.5 * (cr > 0.72) * np.exp(-((r - 0.6) / 0.12) ** 2), 0, 1)   # crypts / furrows
    vein = Image.new("L", (n, n), 0); d = ImageDraw.Draw(vein)
    for _ in range(46):
        a = rs.rand() * 2 * math.pi; rad = 0.5; pts = []
        if abs(math.sin(a)) > 0.8 and rs.rand() < 0.6: continue                    # fewer at top and bottom (under the lids anyway)
        for _ in range(60):
            pts.append(((0.5 + rad * math.cos(a)) * n, (0.5 + rad * math.sin(a)) * n)); rad -= 0.006 * (0.5 + rs.rand()); a += (rs.rand() - 0.5) * 0.09
            if rad < iris_uv * (1.25 + rs.rand() * 0.9): break
        d.line(pts, fill=int(110 + 120 * rs.rand()), width=1 if rs.rand() < 0.7 else 2)
    vein = np.asarray(vein.filter(ImageFilter.GaussianBlur(1.1)), dtype=np.float64) / 255
    img = np.stack([red, pig, np.clip(vein * 1.6, 0, 1)], 2)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray((img * 255).astype(np.uint8), "RGB").save(path)
    return path


# ------------------------------------------------------------------------------------------------ GLB post-step
def eye_glb_dqs(path, mesh_names):
    """glb.py writes a per-vertex mask only as COLOR_0. The viewer wants `_DQS` (FORMAT.md v0.2): re-point the red channel
    of COLOR_0 as a SCALAR accessor (a strided view of the same bytes) and drop COLOR_0, for the named meshes."""
    raw = open(path, "rb").read(); jl = struct.unpack("<I", raw[12:16])[0]; g = json.loads(raw[20:20 + jl]); rest = raw[20 + jl:]
    for m in g["meshes"]:
        if m["name"] not in mesh_names: continue
        for pr in m["primitives"]:
            ci = pr["attributes"].pop("COLOR_0", None)
            if ci is None: continue
            acc = g["accessors"][ci]; bv = dict(g["bufferViews"][acc["bufferView"]]); bv["byteStride"] = 16 if acc["type"] == "VEC4" else 12
            g["bufferViews"].append(bv); g["accessors"].append({"bufferView": len(g["bufferViews"]) - 1, "componentType": 5126, "count": acc["count"], "type": "SCALAR"})
            pr["attributes"]["_DQS"] = len(g["accessors"]) - 1
    js = json.dumps(g, separators=(",", ":")).encode(); js += b" " * ((-len(js)) % 4)
    out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<I", len(js)) + b"JSON" + js + rest
    open(path, "wb").write(out)


# ------------------------------------------------------------------------------------------------ test package (a bust)
IRIS_BY_TONE = {  # round 5 (review 07: "every tone has the same pale green irises, which stare out of a dark face"): iris preset per skin tone of
    # build_operator.TONES. B2: build(..., iris=eyes.IRIS_BY_TONE[tone]). Brown is the commonest iris colour worldwide, near universal with darker skin (believed)
    "light": "hazel", "medium": "brown", "dark": "deep"}
IRIS = {  # linear-ish sRGB triples: outer stroma, inner ring near the pupil (believed plausible, tuned by eye on the probes)
    "brown": {"outer": [0.34, 0.19, 0.09], "inner": [0.46, 0.27, 0.10]}, "dark": {"outer": [0.17, 0.10, 0.06], "inner": [0.24, 0.14, 0.07]},
    "hazel": {"outer": [0.34, 0.33, 0.16], "inner": [0.50, 0.33, 0.12]}, "green": {"outer": [0.30, 0.42, 0.28], "inner": [0.52, 0.42, 0.18]},
    "blue": {"outer": [0.30, 0.44, 0.58], "inner": [0.55, 0.50, 0.38]}, "grey": {"outer": [0.42, 0.48, 0.52], "inner": [0.55, 0.50, 0.42]},
    "deep": {"outer": [0.085, 0.045, 0.024], "inner": [0.14, 0.075, 0.035]}}   # round 5: a dark brown that stays dark under the studio light ("dark" rendered tan-grey on the dark tone)


def build_test(construction="shell", out=None, sex="m", tone="light", glasses=True, iris="hazel", additive=False, own_lashes=False):
    import build_body as bb, mh_wardrobe as wd, materials as mt
    name = "eyes-" + construction + ("-add" if additive else "") + ("" if glasses else "-bare") + ("" if sex == "m" else "-f"); out = out or os.path.join(LAB, "B5", "packages", name); os.makedirs(out, exist_ok=True)
    c0 = bb.context(sex=sex); base = c0.base
    class _C: pass
    cx = _C(); cx.__dict__.update(c0.__dict__); cx.base_v = c0.base_v + eye_rest_expression(c0.base_v, sex); c0 = cx           # the rest face
    c = eye_context(c0); rig = c.rig
    names = rig["skeleton"].names; yneck = rig["skeleton"].head[names.index("neck_01")][1] - 0.035
    def compact(t): used = np.unique(t); remap = np.full(used.max() + 1, -1, dtype=np.int64); remap[used] = np.arange(len(used)); return used, remap[t]
    keep = (c.base_v[c.tris][:, :, 1] > yneck).all(1); used, bt = compact(c.tris[keep])
    body = glb.Mesh("body", c.base_v[used], bt, "skin_body", uv=base.uv, tri_uv=c.tri_uv[keep], weights=rig["W"][used], morphs={k: d[used] for k, d in c.targets.items()}, attrs={"_DQS": rig["dqs"][used]})
    meshes = [body] + eye_meshes(c, construction, W=rig["W"], names=names)
    wet, _ = eye_wet(c, rig); meshes.append(wet)
    S = mt.SYS; E = mt.PACKS
    A = {"lashes": wd.Asset(S + "/eyelashes/eyelashes02/eyelashes02.mhclo"), "brows": wd.Asset(S + "/eyebrows/eyebrow001/eyebrow001.mhclo"),
         "cap": wd.Asset(E + "/hats01_cc0/clothes/toigo_maga_hat/toigo_maga_hat.mhclo"), "glasses": wd.Asset(E + "/glasses01_cc0/clothes/spamrakuen_sagerfrogs_glasses_03/spamrakuen_sagerfrogs_glasses_03.mhclo")}
    def kit_part(asset, mname, material, sel=None, dq=False):
        t, tu = asset.tris()
        if sel is not None: t, tu = t[sel], tu[sel]
        # only the lashes ride the lids. Caps, glasses and brows are fitted on the SOURCE body with its own weights: a cap's brim corners
        # are bound to the lash helper vertices in the pack and would blink with the eye (seen in the first blink strip).
        src = c if dq else c0; W = c.W if dq else c.W_src
        u, tc = compact(t); v0 = asset.fit(src.base_v)[u]
        return glb.Mesh(mname, v0, tc, material, uv=asset.uv, tri_uv=tu, weights=asset.weights(W)[u], morphs={k: asset.fit(src.base_v + d)[u] - v0 for k, d in src.targets.items()}, attrs={"_DQS": np.ones(len(v0))} if dq else None)
    # lashes: the pack's cards on the lid joints. eye_lashes() (own cards + caruncle) is EXPERIMENTAL and not good enough yet: `--own-lashes`
    meshes += [eye_lashes(c, rig, sex), kit_part(A["cap"], "cap", "cloth_cap")] if not ("--pack-lashes" in sys.argv) else [kit_part(A["lashes"], "lashes", "lashes_cards", dq=True), kit_part(A["brows"], "brows", "brows_cards"), kit_part(A["cap"], "cap", "cloth_cap")]
    if glasses:
        gl = A["glasses"]; gt, _ = gl.tris(); gg = gl.fit(c0.base_v); _, gtw = wd.weld(gg, gt); gtl = wd.components(gtw, gl.n)[gtw[:, 0]]
        lens = np.isin(gtl, [cid for cid in set(gtl.tolist()) if len(np.unique(gt[gtl == cid])) == 112])
        meshes += [kit_part(gl, "glasses_frame", "frame_glasses", ~lens), kit_part(gl, "glasses_lens", "lens_glasses", lens)]
    skin = mt.skin_set(sex, tone); Pal = mt.PALETTE
    tex = eye_iris_texture(os.path.join(LAB, "B5", "cache", "eye_iris_struct.png")) if not os.path.exists(os.path.join(LAB, "B5", "cache", "eye_iris_struct.png")) else os.path.join(LAB, "B5", "cache", "eye_iris_struct.png")
    lash_tex = eye_lash_texture(os.path.join(LAB, "B5", "cache", "eye_lashes_%s.png" % sex), sex=sex)
    cache = os.path.join(LAB, "B2", "cache"); lash_png = os.path.join(cache, "lashes.png"); brow_png = os.path.join(cache, "brows.png")     # B2's recoloured pack textures (read only)
    f = lambda rgb, a=1.0: [round((x / 255) ** 2.2, 4) for x in rgb] + [a]
    L = rig["lids"]["l"]
    eye_x = {"b5eye": {"kind": construction, "limbus": round(P["iris_d"] / 2 / L.R, 5), "irisPlane": round((math.sqrt(L.R ** 2 - (P["iris_d"] / 2) ** 2) - (P["recess"] if construction == "recessed" else 0.0012)) / L.R, 5), "scale": 1.25}}
    mats = {
        "skin_body": {"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0}, "_images": {"baseColorTexture": skin["baseColor"], "metallicRoughnessTexture": skin["orm"]}},
        "eye_ball": {"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.4}, "extras": eye_x, "_images": {"baseColorTexture": tex}},
        "cornea_shell": {"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 0.05], "metallicFactor": 0.0, "roughnessFactor": 0.02}, "alphaMode": "BLEND"},
        "eye_wet": {"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 0.1], "metallicFactor": 0.0, "roughnessFactor": 0.05}, "alphaMode": "BLEND", "doubleSided": True, "extras": {"b5eye": {"kind": "wet"}}},
        "lashes_cards": {"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.6}, "alphaMode": "MASK", "alphaCutoff": 0.2, "doubleSided": True, "_images": {"baseColorTexture": lash_png}},
        "lashes_soft": {"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.7}, "alphaMode": "MASK", "alphaCutoff": 0.1, "doubleSided": True, "_images": {"baseColorTexture": lash_tex}},
        "brows_cards": {"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.7}, "alphaMode": "MASK", "alphaCutoff": 0.15, "doubleSided": True, "_images": {"baseColorTexture": brow_png}},
        "cloth_cap": {"pbrMetallicRoughness": {"baseColorFactor": f(Pal["cap"]), "metallicFactor": 0.0, "roughnessFactor": 0.85}, "doubleSided": True},
        "frame_glasses": {"pbrMetallicRoughness": {"baseColorFactor": f(Pal["frame"]), "metallicFactor": 0.6, "roughnessFactor": 0.35}},
        "lens_glasses": {"pbrMetallicRoughness": {"baseColorFactor": [0.9, 0.95, 1.0, 0.1], "metallicFactor": 0.0, "roughnessFactor": 0.04}, "alphaMode": "BLEND", "doubleSided": True},
    }
    path = os.path.join(out, name + ".glb")
    stats = glb.write_glb(path, meshes, rig["skeleton"], mats, generator="rigtwin avatar-lab pipeline/eyes.py (B5 eye test bust)")
    problems = glb.validate(path)
    bname = "body-clay" + ("" if sex == "m" else "-f"); man = json.load(open(os.path.join(LAB, "packages", bname, bname + ".avatar.json")))
    man.get("shape", {}).pop("bake", None)                      # the body's CPU shape file does not fit a bust: the viewer then uses the morph targets
    man["name"] = name; man["glb"] = name + ".glb"; man["note"] = "B5 eye test bust (head, lashes, brows, cap, glasses on B1's body, interim MPFB rig + four lid joints). A probe, not a package for review."
    for k, d in man.get("shape", {}).get("jointDeltas", {}).items():
        for si, side in enumerate(("l", "r")):
            if "eye_" + side in d: d[LID_JOINTS[2 * si]] = d["eye_" + side]; d[LID_JOINTS[2 * si + 1]] = d["eye_" + side]
    man["materials"] = {"skin_body": {"class": "skin", "microTiling": 140, "microStrength": 0.16}, "eye_ball": {"class": "eye", "iris": IRIS[iris]}, "eye_wet": {"class": "eye"},
                        "cornea_shell": {"class": "cornea", "additive": bool(additive)}, "lashes_soft": {"class": "lashes", "alphaTest": LASH[sex]["alpha_test"], "darken": 1.0}, "lashes_cards": {"class": "lashes", "alphaTest": 0.42 if sex == "m" else 0.3, "darken": 0.85}, "brows_cards": {"class": "hair", "alphaTest": 0.15},
                        "cloth_cap": {"class": "cloth"}, "frame_glasses": {"class": "plain"}, "lens_glasses": {"class": "plain"}}        # the additive thin-film lens recipe was tried here and glares white over the eye (sheet 24): not for use
    man["eyes"] = eye_manifest(c, rig, construction); man["eyes"]["irisPresets"] = IRIS
    man["build"] = {"by": "pipeline/eyes.py", "stats": stats, "validate": problems}
    json.dump(man, open(os.path.join(out, name + ".avatar.json"), "w"), indent=1)
    import shutil
    for extra in ("poses.json", "packet-shots.json"):
        if os.path.exists(os.path.join(LAB, "packages", bname, extra)): shutil.copy(os.path.join(LAB, "packages", bname, extra), out)
    log("package", out, "meshes", [(m["name"], m["triangles"]) for m in stats["meshes"]], "bytes", stats["bytes"], "validate", problems or "clean")
    return man


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "check":
        import build_body as bb
        c = bb.context(sex=a[1] if len(a) > 1 else "m"); out = {"unfitted_base": eye_lid_report(c.base, c.base_v, "unfitted base"), "base": eye_lid_report(c.base, eye_lid_fit(c.base, c.base_v), "fitted base", c.base_v)}; 
        e = eye_context(c); L0 = e.lids["l"]; lidv = ((L0.wu > 0) | (L0.wl > 0)) & ~L0.inner & c.base.vgroups["body"]; mr = np.r_[L0.margin_u[1:-1], L0.margin_l[1:-1]]
        worst = {"margin_gap_mm": [9, -9], "eye_surface_through_lid_mm": 0.0, "iris_covered_top_mm": [9, -9], "iris_covered_bottom_mm": [9, -9], "closed_seam_error_mm": [9, -9]}
        rs = np.random.RandomState(3); combos = [{k: w} for k in e.targets for w in (-2.0, 2.0)] + [{k: float(rs.randn()) for k in e.targets} for _ in range(40)]
        for wts in combos:                                               # each component at +-2 SD, and 40 random people; morphs combined linearly as the viewer does
            v = e.base_v + sum(w * e.targets[k] for k, w in wts.items()); Cl = L0.C + sum(w * (e.eye_targets[k]["l"][0] - L0.C) for k, w in wts.items())
            L = eye_lids(c.base, v, "l", (Cl, L0.R)); L.wu, L.wl = L0.wu, L0.wl
            rr = np.linalg.norm(v - Cl, axis=1); ang = np.degrees(np.arccos(np.clip((v - Cl)[:, 2] / rr, -1, 1))); sf = np.interp(ang, np.arange(91), eye_surface_table(L0.R), right=L0.R)
            yu = (v[L0.apex_u] - Cl) @ L.u; yl = (v[L0.apex_l] - Cl) @ L.u
            vv = eye_lid_pose(L, v, L0.theta_u, L0.theta_l, "dqs"); pp = vv - Cl; mu = L0.margin_u[1:-1]; seam = (np.arctan2(pp[mu] @ L.u, pp[mu] @ L.f) - L.pc[mu]) * L0.R * 1000
            for key, lo, hi in (("margin_gap_mm", (rr[mr] - sf[mr]).min() * 1000, (rr[mr] - sf[mr]).max() * 1000), ("iris_covered_top_mm", (P["iris_d"] / 2 - yu) * 1000, (P["iris_d"] / 2 - yu) * 1000),
                                ("iris_covered_bottom_mm", (P["iris_d"] / 2 + yl) * 1000, (P["iris_d"] / 2 + yl) * 1000), ("closed_seam_error_mm", seam.min(), seam.max())):
                worst[key] = [min(worst[key][0], float(lo)), max(worst[key][1], float(hi))]
            worst["eye_surface_through_lid_mm"] = max(worst["eye_surface_through_lid_mm"], float(np.maximum(sf[lidv] - rr[lidv], 0).max() * 1000))
        out["shape_range"] = {"what": "ranges over every component at +-2 SD and 40 random people (linear morph combination, base weights), sex " + c.sex, **worst}; log("shape range", json.dumps(worst))
        os.makedirs(os.path.join(LAB, "B5"), exist_ok=True); json.dump(out, open(os.path.join(LAB, "B5", "lid-numbers.json"), "w"), indent=1, default=float)
    elif a and a[0] == "test":
        build_test(a[1] if len(a) > 1 else "shell", sex="f" if "--f" in a else "m", glasses="--no-glasses" not in a, additive="--additive" in a, own_lashes="--own-lashes" in a, iris=next((x for x in a if x in IRIS), "hazel"))
    else: print(__doc__)
