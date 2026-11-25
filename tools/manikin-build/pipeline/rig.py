# Rig module (owner: RR). API documented in pipeline/README.md, section "Rig".
# MPFB2 "default" rig (163 bones, painted weights, CC0) -> the lab's 82-joint game skeleton (Unreal-mannequin names,
# lowercase _l / _r): twist joints with analytically split weights, fingers and eyes mapped, toes merged, face merged
# into the head; degrees of freedom, drivers and the designer's range-of-motion poses in FORMAT.md's form; a reference
# pose evaluator and skinning (linear blend and the masked dual-quaternion blend); the 4-influence least-squares re-fit.
# Frame: metres, glTF (+X the character's left, +Y up, +Z forward). Joint rest frames are world-aligned.
import sys, os, json, math, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
from scipy.spatial.transform import Rotation as Rot
import mh_core as mh

HERE = os.path.dirname(os.path.abspath(__file__))
PACKET = os.path.normpath(os.path.join(__import__("labpaths").LAB, "VD", "review-packet.json"))
SIDES = (("l", "L", 1.0), ("r", "R", -1.0))                     # our suffix, MPFB suffix, sign of the side's x
FINGERS = (("thumb", "finger1", None), ("index", "finger2", "metacarpal1"), ("middle", "finger3", "metacarpal2"),
           ("ring", "finger4", "metacarpal3"), ("pinky", "finger5", "metacarpal4"))
# twist segments: our segment joint, MPFB bones pooled, the joint at the far end, net twist nodes (phi 0, 0.5, 1),
# ramp along the bone (start, end), driver source, signed fractions for the two twist joints
SEGMENTS = (("upperarm", ("upperarm01", "upperarm02"), "lowerarm", ("upperarm_twist_01", "upperarm_twist_02", "upperarm"), (0.15, 0.85), "upperarm", (-1.0, -0.5)),
            ("lowerarm", ("lowerarm01", "lowerarm02"), "hand", ("lowerarm", "lowerarm_twist_01", "lowerarm_twist_02"), (0.15, 0.90), "hand", (0.5, 1.0)),
            ("thigh", ("upperleg01", "upperleg02"), "calf", ("thigh_twist_01", "thigh_twist_02", "thigh"), (0.20, 0.85), "thigh", (-1.0, -0.5)),
            ("calf", ("lowerleg01", "lowerleg02"), "foot", ("calf", "calf_twist_01", "calf_twist_02"), (0.15, 0.90), "foot", (0.4, 0.8)))
SPINE = ("spine_01", "spine_02", "spine_03", "spine_04", "spine_05")
SPINE_SHARE = {"flex": (0.10, 0.25, 0.30, 0.25, 0.10), "lat": (0.10, 0.25, 0.25, 0.25, 0.15), "rot": (0.05, 0.10, 0.15, 0.35, 0.35)}
NECK = ("neck_01", "neck_02", "head")
NECK_SHARE = {"flex": (0.30, 0.30, 0.40), "lat": (0.35, 0.35, 0.30), "rot": (0.25, 0.30, 0.45)}
CLAV_ROLL = (30.0, 0.15)        # shoulder flexion above 30 deg: 15 % goes to the clavicle (rotation about the lateral axis)
CLAV_ELEV = (30.0, 0.10)        # shoulder abduction above 30 deg: 10 % goes to clavicle elevation (18 % in round 2 fed the pads at 170)
# The exposed pose range (the designer's review 1): dof limits are the EXTENDED envelope; end-range poses stay in poses.json,
# marked "envelope": "end", for tests only. Clinical degrees.
ENVELOPE = {"working": {"hip_flexion": (80, 95), "knee_flexion": (85, 110), "elbow_flexion": (60, 110), "shoulder_flexion": (0, 80), "shoulder_abduction": (0, 30)},
            "extended": {"hip_flexion": (-20, 110), "knee_flexion": (0, 110), "elbow_flexion": (0, 135), "shoulder_flexion": (-45, 120), "shoulder_abduction": (0, 90)}}
def envelope_of(clinical, pid=""):
    """"working" | "extended" | "end" for a pose given in the designer's clinical angles."""
    X = ENVELOPE["extended"]; g = lambda k: float(clinical.get(k, 0) or 0)
    if "shoulder_horizontal_adduction" in clinical or g("shoulder_extension") > 45 or any(g(k) > hi for k, (lo, hi) in X.items()): return "end"
    if pid.startswith(("W", "HAND", "SEATED", "A_POSE")) or clinical.get("base_pose") == "SEATED_GRIPS": return "working"
    Wk = ENVELOPE["working"]
    return "working" if all(g(k) <= hi for k, (lo, hi) in Wk.items()) and not any(k.startswith(("spine", "hip_abd", "hip_ext", "hip_int", "ankle")) for k in clinical) else "extended"
NEUTRAL_ABD = 12.0              # "arm at the side" in clinical poses: 12 deg of abduction, so the arm clears the trunk


def _build_names():
    names = ["root", "pelvis", *SPINE, "neck_01", "neck_02", "head", "eye_l", "eye_r"]
    parent = {"root": None, "pelvis": "root", "spine_01": "pelvis", "spine_02": "spine_01", "spine_03": "spine_02", "spine_04": "spine_03",
              "spine_05": "spine_04", "neck_01": "spine_05", "neck_02": "neck_01", "head": "neck_02", "eye_l": "head", "eye_r": "head"}
    for s, _, _ in SIDES:
        arm = [("clavicle", "spine_05"), ("upperarm", "clavicle"), ("upperarm_twist_01", "upperarm"), ("upperarm_twist_02", "upperarm"),
               ("lowerarm", "upperarm"), ("lowerarm_twist_01", "lowerarm"), ("lowerarm_twist_02", "lowerarm"), ("hand", "lowerarm"),
               ("thumb_01", "hand"), ("thumb_02", "thumb_01"), ("thumb_03", "thumb_02")]
        for f, _, _ in FINGERS[1:]:
            arm += [(f + "_metacarpal", "hand"), (f + "_01", f + "_metacarpal"), (f + "_02", f + "_01"), (f + "_03", f + "_02")]
        for n, p in arm:
            names.append(f"{n}_{s}"); parent[f"{n}_{s}"] = p if p.startswith("spine") else f"{p}_{s}"
    for s, _, _ in SIDES:
        leg = [("thigh", "pelvis"), ("thigh_twist_01", "thigh"), ("thigh_twist_02", "thigh"), ("calf", "thigh"), ("calf_twist_01", "calf"),
               ("calf_twist_02", "calf"), ("foot", "calf"), ("ball", "foot")]
        for n, p in leg:
            names.append(f"{n}_{s}"); parent[f"{n}_{s}"] = p if p == "pelvis" else f"{p}_{s}"
    return names, np.array([-1 if parent[n] is None else names.index(parent[n]) for n in names], dtype=np.int64)


BASE_JOINTS, _BASE_PARENT = _build_names()
assert len(BASE_JOINTS) == 82
# Corrective helper joints (round 3), the way game rigs do it: leaf joints that carry only skin, sit ON an existing joint
# and take a fixed fraction of that joint's rotation about one axis through the ordinary `twist` driver.
#   name, parent, pivot joint, driver source, axis key (pack.axes), fraction, weight donors, falloff radius as a fraction
#   of the reference segment (a, b), gain at the seed
HELPERS = (
    ("knee_front", "thigh", "calf", "calf", "knee_{s}.hinge", 0.5, ("thigh", "thigh_twist_01", "thigh_twist_02", "calf", "calf_twist_01", "calf_twist_02"), 0.33, ("calf", "foot"), 0.92),   # round 4 values; round 6: front of the knee only (see _helper_seeds)
    ("glute", "pelvis", "thigh", "thigh", "hip_{s}.flex", 0.45, ("pelvis", "spine_01", "thigh", "thigh_twist_01", "thigh_twist_02"), 0.42, ("thigh", "calf"), 0.85),
    ("hip_belly", "pelvis", "spine_04", "thigh", "hip_{s}.flex", 0.25, ("pelvis", "spine_01", "spine_02", "spine_03"), 0.36, ("thigh", "calf"), 0.9),
    # the groin crease: a band along the line where thigh and trunk weights meet, pulled in toward the hip as it flexes (the pivot
    # sits 60 % down the thigh, so a small rotation is a nearly straight pull), so that belly and thigh dive into a fold
    ("groin", "pelvis", "thigh>calf:0.6", "thigh", "hip_{s}.flex", 0.06, ("pelvis", "spine_01", "spine_02", "thigh", "thigh_twist_01", "thigh_twist_02"), 0.11, ("thigh", "calf"), 0.9),
    # the arm against the trunk (the seated grip posture, abduction about 10): the side of the chest follows the arm's adduction a
    # little and the inner upper arm lags a little, so the two flatten against each other instead of passing through
    # round 6: ON again (0.25, falloff 0.5): with the inner-arm helper off it no longer pushes the arm into the chest at shoulder
    # forward 80, and it takes the side of the chest along with spine_05 when the trunk turns (seated look over the shoulder)
    ("armpit_chest", "spine_05", "upperarm", "upperarm", "shoulder_{s}.abd", 0.25, ("spine_03", "spine_04", "spine_05"), 0.5, ("upperarm", "lowerarm"), 0.9),
    # (a helper must take weight only from its own parent, or it changes the skin at rest: the inner arm sits on the near-shoulder
    # twist joint, so that is the parent; taking it from all three arm joints un-did the twist split and pushed the arm into the chest)
    ("armpit_arm", "upperarm_twist_01", "upperarm", "upperarm", "shoulder_{s}.abd", 0.0, ("upperarm_twist_01",), 0.36, ("upperarm", "lowerarm"), 0.9),
    ("shoulder_front", "clavicle", "upperarm", "upperarm", "shoulder_{s}.flex", 0.40, ("clavicle",), 0.34, ("upperarm", "lowerarm"), 0.8),
    # the top of the thigh under the belly: pressed a few millimetres into the thigh as the hip flexes (the pivot is the knee, so the
    # small rotation is a nearly straight push), so that the belly's lower edge lies clearly ON the thigh: the visible lap line is
    # then the belly's own rounded edge, not two skins crossing at a grazing angle
    ("lap_thigh", "thigh_twist_01", "calf", "thigh", "hip_{s}.flex", 0.0, ("thigh_twist_01",), 0.38, ("thigh", "calf"), 0.9),   # OFF since round 5: no visible gain, doubled the deepest lap overlap
)
HELPERS_ON = True               # False: the helper joints stay in the skeleton but carry no weight and get no driver
# Round 7: the painted thigh/calf blend round the knee is narrow on the outer side and behind the knee, so a seated knee shows a
# vertical crease on the outer side (F05, M50) and a jagged fold where calf and thigh skins cross behind it (M95H). Laplacian
# smoothing of the weights within KNEE_SMOOTH[0] m of each knee joint (body vertices; the kneecap helper's share is kept as it
# is), KNEE_SMOOTH[1] passes of step KNEE_SMOOTH[2]; garments, shoes and hair take the smoothed body weights there (nearest body
# vertex). None switches it off.
KNEE_SMOOTH = (0.14, 40, 0.5)
def _with_helpers():
    names = list(BASE_JOINTS); parent = list(_BASE_PARENT)
    for s, _, _ in SIDES:
        for h in HELPERS:
            names.append(f"{h[0]}_{s}"); par = h[1] if h[1] in ("pelvis",) or h[1].startswith("spine") else f"{h[1]}_{s}"; parent.append(names.index(par))
    return names, np.array(parent, dtype=np.int64)
JOINTS, PARENT = _with_helpers()
HELPER_JOINTS = JOINTS[82:]
def _jname(x, s): return x if x in ("root", "pelvis", "head") or x.startswith(("spine", "neck")) else f"{x}_{s}"
JI = {n: i for i, n in enumerate(JOINTS)}; NJ = len(JOINTS)
assert all(PARENT[i] < i for i in range(NJ))


def unit(v):
    v = np.asarray(v, dtype=np.float64); return v / max(np.linalg.norm(v), 1e-20)
def rot(axis, deg):
    return Rot.from_rotvec(unit(axis) * math.radians(deg)).as_matrix()
def signed_angle(a, b, axis):
    """Angle in degrees that turns a onto b about axis (both projected perpendicular to it)."""
    axis = unit(axis); a = a - axis * (a @ axis); b = b - axis * (b @ axis)
    return math.degrees(math.atan2(np.cross(a, b) @ axis, a @ b))
def twist_angle(R, axis):
    """Swing-twist split: the rotation of R about axis, in degrees (-180..180)."""
    q = Rot.from_matrix(R).as_quat()
    if q[3] < 0: q = -q                                                  # one quaternion per rotation: keeps the angle in -180..180
    p = float(np.dot(q[:3], unit(axis)))
    return math.degrees(2 * math.atan2(p, q[3])) if abs(p) + abs(q[3]) > 1e-12 else 0.0


class RigPack:
    pass


def _source_table(mrig):
    """Where each of the 82 joints sits (linear in the MPFB joints) and which MPFB bones' weights it takes directly."""
    B = {b: i for i, b in enumerate(mrig.bones)}
    pos = {}; src = {n: [] for n in BASE_JOINTS}
    pos["pelvis"] = [(0.5, "upperleg01.L", "h"), (0.5, "upperleg01.R", "h")]; src["pelvis"] = ["root", "pelvis.L", "pelvis.R"]
    for ours, theirs in zip(SPINE, ("spine05", "spine04", "spine03", "spine02", "spine01")):
        pos[ours] = [(1.0, theirs, "h")]; src[ours] = [theirs]
    src["spine_04"] += ["breast.L", "breast.R"]
    pos["neck_01"] = [(1.0, "neck01", "h")]; src["neck_01"] = ["neck01"]
    pos["neck_02"] = [(1.0, "neck02", "h")]; src["neck_02"] = ["neck02", "neck03"]
    pos["head"] = [(1.0, "head", "h")]
    for s, S, _ in SIDES:
        pos[f"eye_{s}"] = [(1.0, f"eye.{S}", "h")]; src[f"eye_{s}"] = [f"eye.{S}"]
        pos[f"clavicle_{s}"] = [(1.0, f"clavicle.{S}", "h")]; src[f"clavicle_{s}"] = [f"clavicle.{S}", f"shoulder01.{S}"]
        pos[f"upperarm_{s}"] = [(1.0, f"upperarm01.{S}", "h")]; pos[f"lowerarm_{s}"] = [(1.0, f"lowerarm01.{S}", "h")]
        pos[f"hand_{s}"] = [(1.0, f"wrist.{S}", "h")]; src[f"hand_{s}"] = [f"wrist.{S}"]
        for f, mf, meta in FINGERS:
            if meta: pos[f"{f}_metacarpal_{s}"] = [(1.0, f"{meta}.{S}", "h")]; src[f"{f}_metacarpal_{s}"] = [f"{meta}.{S}"]
            for k in (1, 2, 3): pos[f"{f}_0{k}_{s}"] = [(1.0, f"{mf}-{k}.{S}", "h")]; src[f"{f}_0{k}_{s}"] = [f"{mf}-{k}.{S}"]
        pos[f"thigh_{s}"] = [(1.0, f"upperleg01.{S}", "h")]; pos[f"calf_{s}"] = [(1.0, f"lowerleg01.{S}", "h")]
        pos[f"foot_{s}"] = [(1.0, f"foot.{S}", "h")]; src[f"foot_{s}"] = [f"foot.{S}"]
        toes = [b for b in mrig.bones if b.startswith("toe") and b.endswith("." + S)]
        pos[f"ball_{s}"] = [(0.2, f"toe{k}-1.{S}", "h") for k in range(1, 6)]; src[f"ball_{s}"] = toes
        for seg, _, far, nodes, _, _, _ in SEGMENTS:
            a, b = pos[f"{seg}_{s}"], pos[f"{far}_{s}"]
            tw = [n for n in nodes if "twist" in n]
            for n, t in zip(tw, (1 / 3, 2 / 3)):
                pos[f"{n}_{s}"] = [((1 - t) * c, bn, e) for c, bn, e in a] + [(t * c, bn, e) for c, bn, e in b]
    seg_bones = {f"{m}.{S}" for _, ms, *_ in SEGMENTS for m in ms for _, S, _ in SIDES}
    used = {b for v in src.values() for b in v} | seg_bones
    src["head"] = [b for b in mrig.bones if b not in used]          # head, jaw, face, tongue, eyelids
    assert "head" in src["head"] and not any(b.startswith(("spine", "upper", "lower", "finger")) for b in src["head"]), src["head"]
    return B, pos, src


def convert_rig(mpfb_rig=None, weights=None, verts=None, repose=None):
    """See README. `repose`: optional {joint name: 3x3 world rotation about that joint} applied to the source rest and baked
    (default None: the authored hm08 pose is the rest pose; see RigPack.rest_note)."""
    mrig = mpfb_rig or mh.load_rig("default"); base = mh.load_base()
    verts = base.v if verts is None else np.asarray(verts, dtype=np.float64)
    W163 = (mrig.weights if weights is None else weights).tocsr()
    B, pos, src = _source_table(mrig)
    for n in HELPER_JOINTS: src[n] = []
    rows = []
    for n in JOINTS:
        if n == "root": rows.append(sp.csr_matrix((1, mh.NV))); continue
        if n in HELPER_JOINTS:                                              # a helper sits on its pivot joint
            hb, sd = n.rsplit("_", 1); spec = next(h for h in HELPERS if h[0] == hb)
            if ">" in spec[2]:                                                # "a>b:t": a point t of the way from joint a to joint b
                ab, t = spec[2].split(":"); a_, b_ = ab.split(">"); t = float(t); rows.append(rows[JI[_jname(a_, sd)]] * (1 - t) + rows[JI[_jname(b_, sd)]] * t)
            else: rows.append(rows[JI[_jname(spec[2], sd)]])
            continue
        r = None
        for c, bn, e in pos[n]:
            m = (mrig.Rh if e == "h" else mrig.Rt)[B[bn]] * c; r = m if r is None else r + m
        rows.append(r)
    p = RigPack(); p.names = list(JOINTS); p.parent = PARENT.copy(); p.mrig = mrig; p._B = B; p._src = src
    p.Rj = sp.vstack(rows).tocsr()
    p.floor0 = mh.ground_offset(verts, base)
    D = sp.lil_matrix((len(mrig.bones), NJ))
    for n, bs in src.items():
        for b in bs: D[B[b], JI[n]] = 1.0
    p._D = D.tocsr()
    p.repose = np.tile(np.eye(3), (NJ, 1, 1))
    if repose:
        for n, R in repose.items(): p.repose[JI[n]] = R
    p._identity = not repose
    p.base_src = verts.copy(); p.base_joints_src = p._joints_src(verts)
    p.helpers = None
    if HELPERS_ON: p.helpers = _helper_seeds(p, p.transfer(W163, verts), verts)
    p.W = p.transfer(W163, verts)
    p.rest = p.joints(verts)                                    # A-pose rest joints of the base shape
    h_, t_ = mh.joint_positions(verts, mrig); fr = mh.bone_frames(h_, t_, mrig.roll)
    p._thumb_x = {s: [fr[B[f"finger1-{k}.{S}"]][:, 0].copy() for k in (1, 2, 3)] for s, S, _ in SIDES}
    p.axes, p.offsets = _axes(p.rest, p._thumb_x)
    p.dq_mask = _dq_mask(p.W)
    p.J4 = None; p.W4 = None
    p.rest_note = ("rest = the authored hm08 pose: upper arms %.0f deg below horizontal (abducted %.0f), elbows bent %.0f, knees %.0f"
                   % (90 - p.offsets["shoulder_abd_r"], p.offsets["shoulder_abd_r"], p.offsets["elbow_r"], p.offsets["knee_r"]))
    return p


def _joints_src(self, verts):
    J = self.Rj @ np.asarray(verts, dtype=np.float64); J[0] = (0.0, self.floor0, 0.0); return J
def _world_repose(self):
    G = np.zeros((NJ, 3, 3))
    for j in range(NJ): G[j] = self.repose[j] if PARENT[j] < 0 else G[PARENT[j]] @ self.repose[j]
    return G
def _repose_matrices(self, Jsrc):
    G = self._world_repose(); Jp = Jsrc.copy(); M = np.zeros((NJ, 4, 4)); M[:, 3, 3] = 1
    for j in range(NJ):
        if PARENT[j] >= 0: Jp[j] = Jp[PARENT[j]] + G[PARENT[j]] @ (Jsrc[j] - Jsrc[PARENT[j]])
        M[j, :3, :3] = G[j]; M[j, :3, 3] = Jp[j] - G[j] @ Jsrc[j]
    return M, Jp
def _joints(self, verts):
    J = self._joints_src(verts)
    return J if self._identity else self._repose_matrices(J)[1]
def _bake(self, verts, W=None):
    verts = np.asarray(verts, dtype=np.float64)
    if self._identity: return verts.copy()
    return self.bake_mesh(verts, self.W if W is None else W, verts)
def _bake_mesh(self, mesh_verts, mesh_W, body_verts):
    mesh_verts = np.asarray(mesh_verts, dtype=np.float64)
    if self._identity: return mesh_verts.copy()
    M, _ = self._repose_matrices(self._joints_src(body_verts)); J, Wp = pad(mesh_W)
    return skin(mesh_verts, J, Wp, M)
def _skeleton(self, verts, floor=0.0):
    import glb
    J = self.joints(verts).copy(); J[:, 1] -= floor; J[0] = 0.0
    return glb.Skeleton(names=list(JOINTS), parent=PARENT.copy(), head=J, rot=None)
def _transfer(self, W_src_bones, verts_src, joints_src=None):
    """Weights painted on the MPFB default bones (n, 163) -> the 82 joints (n, 82), twist split by position along the bone."""
    Ws = W_src_bones.tocsc(); v = np.asarray(verts_src, dtype=np.float64); n = v.shape[0]
    Jsrc = self.base_joints_src if joints_src is None else joints_src
    out = (W_src_bones.tocsr() @ self._D).tolil()
    for seg, mbones, far, nodes, (a, b), _, _ in SEGMENTS:
        for s, S, _ in SIDES:
            ws = np.zeros(n)
            for mb in mbones: ws += np.asarray(Ws[:, self._B[f"{mb}.{S}"]].todense()).ravel()
            idx = np.nonzero(ws > 0)[0]
            if not len(idx): continue
            p0 = Jsrc[JI[f"{seg}_{s}"]]; p1 = Jsrc[JI[f"{far}_{s}"]]; d = p1 - p0
            t = (v[idx] - p0) @ d / (d @ d); phi = np.clip((t - a) / (b - a), 0, 1)
            hats = (np.clip(1 - 2 * phi, 0, 1), 1 - np.abs(2 * phi - 1), np.clip(2 * phi - 1, 0, 1))
            for nd, h in zip(nodes, hats):
                col = JI[f"{nd}_{s}"]; out[idx, col] = (ws[idx] * h).reshape(-1, 1)
    out = out.tocsr(); out.eliminate_zeros()
    rs = np.asarray(out.sum(1)).ravel(); rs[rs <= 0] = 1.0
    out = (sp.diags(1.0 / rs) @ out).tocsr()
    if getattr(self, "helpers", None):
        painted = out; out = _helper_weights(out, v, self.helpers)
        if KNEE_SMOOTH:
            if n == mh.NV: out = _smooth_knee(out, v, Jsrc)
            elif getattr(self, "W", None) is not None: out = _knee_from_body(self, out, v, Jsrc)
        # never more than 8 influences: where helpers push a vertex over 8, it keeps its 8 largest weights (renormalised below).
        # Round 4 kept the painted weights there instead; on 9 vertices of the groin and lower belly that dropped the helpers'
        # share, and the heavy woman's seated lap went 23.5 -> 28.0 mm deep (round 6)
        over = np.nonzero(np.diff(out.indptr) > 8)[0]
        if len(over):
            out = out.tolil()
            for i in over:
                r, dd = list(out.rows[i]), list(out.data[i]); o = sorted(np.argsort(dd)[::-1][:8]); out.rows[i] = [r[j] for j in o]; out.data[i] = [dd[j] for j in o]
            out = out.tocsr()
        rs = np.asarray(out.sum(1)).ravel(); rs[rs <= 0] = 1.0; out = (sp.diags(1.0 / rs) @ out).tocsr()
    return out
RigPack._joints_src = _joints_src; RigPack._world_repose = _world_repose; RigPack._repose_matrices = _repose_matrices
RigPack.joints = _joints; RigPack.bake = _bake; RigPack.bake_mesh = _bake_mesh; RigPack.skeleton = _skeleton; RigPack.transfer = _transfer


def _helper_seeds(pack, W, verts):
    """Where each helper's skin is: a seed point on the body surface (found on the given vertices) and a falloff radius."""
    J = pack.base_joints_src; A, _ = _axes(pack.rest if hasattr(pack, "rest") else pack._joints_src(verts)); body = mh.load_base().vgroups["body"]; out = []
    Y = np.array([0, 1.0, 0]); Z = np.array([0, 0, 1.0])
    for s, _, sg in SIDES:
        for name, par, piv, src, axk, frac, donors, rf, (ra, rb), gain in HELPERS:
            if not frac: continue                                              # fraction 0 = switched off: the joint stays, with no weight and no driver
            K = J[JI[_jname(piv if name not in ("hip_belly", "groin", "lap_thigh") else "thigh", s)]]; L = np.linalg.norm(J[JI[f"{rb}_{s}"]] - J[JI[f"{ra}_{s}"]]); d = verts - K
            dn = [JI[_jname(x, s)] for x in donors]
            wd = np.asarray(W[:, dn].sum(1)).ravel(); cand = body & (wd > 0.3)
            if name == "knee_front":        # the kneecap: the most anterior skin within 4 cm of the joint's height
                cand &= (np.abs(d[:, 1]) < 0.04) & (np.linalg.norm(d[:, [0, 2]], axis=1) < 0.12); score = d @ Z
            elif name == "glute":           # the lower buttock: the most posterior skin 2-10 cm below the hip joint, on this side
                cand &= (d[:, 1] < -0.02) & (d[:, 1] > -0.10) & (sg * verts[:, 0] > 0.02); score = -(d @ Z)
            elif name == "hip_belly":       # the lower belly above the groin, on this side
                cand &= (d[:, 1] > 0.0) & (d[:, 1] < 0.09) & (sg * verts[:, 0] > 0.02) & (sg * d[:, 0] < 0.06); score = d @ Z
            elif name == "lap_thigh":       # the top front of the thigh, 4-14 cm below the hip joint
                cand &= (d[:, 1] < -0.04) & (d[:, 1] > -0.14) & (np.abs(d[:, 0]) < 0.09); score = d @ Z
            elif name == "armpit_chest":    # the side of the chest under the armpit: the most lateral trunk skin 7-20 cm below the shoulder joint
                cand &= (d[:, 1] < -0.07) & (d[:, 1] > -0.20) & (np.abs(d[:, 2]) < 0.09); score = sg * d[:, 0]
            elif name == "armpit_arm":      # the inner upper arm, 5-16 cm down the arm from the shoulder joint: the skin nearest the trunk
                u = unit(J[JI[f"lowerarm_{s}"]] - K); al = d @ u; inward = unit(np.array([-sg * u[1], sg * u[0], 0.0]) * -1.0)      # perpendicular to the arm in the frontal plane, toward the trunk
                cand &= (al > 0.05) & (al < 0.16) & (np.linalg.norm(d - np.outer(al, u), axis=1) < 0.09); score = d @ inward
            elif name == "groin":           # the crease line itself: front skin where thigh and trunk weights are balanced
                th = np.asarray(W[:, [JI[f"{x}_{s}"] for x in ("thigh", "thigh_twist_01", "thigh_twist_02")]].sum(1)).ravel()
                tr = np.asarray(W[:, [JI[x] for x in ("pelvis", "spine_01", "spine_02")]].sum(1)).ravel()
                idx = np.nonzero(body & (th > 0.3) & (th < 0.7) & (tr > 0.25) & (d[:, 2] > 0.045) & (sg * verts[:, 0] > 0.015) & (sg * d[:, 0] < 0.0))[0]   # front only, medial of the hip joint: never the flank
                if len(idx) >= 8: out.append({"joint": JI[f"{name}_{s}"], "seed": verts[idx].copy(), "radius": rf * L, "donors": dn, "gain": gain, "name": f"{name}_{s}"})
                continue
            else:                           # the front of the shoulder: the most anterior skin within 7 cm of the joint
                cand &= (np.linalg.norm(d, axis=1) < 0.09); score = d @ Z
            idx = np.nonzero(cand)[0]
            if len(idx) < 8: continue
            top = idx[np.argsort(-score[idx])[:max(6, len(idx) // 20)]]
            out.append({"joint": JI[f"{name}_{s}"], "seed": verts[top].mean(0), "radius": rf * L, "donors": dn, "gain": gain, "name": f"{name}_{s}"})
            # round 6: the kneecap helper takes nothing behind the knee (its share fades out between 2 cm in front of and 2 cm behind
            # the joint centre): the back of the knee stays as painted, so the calf and thigh no longer press into each other there
            # deeper than in round 3 (median man, hip 95 knee 110: 17.5 -> 14.7 mm)
            if name == "knee_front": out[-1]["front"] = K.copy()
    return out


def _helper_weights(W, v, helpers):
    """Move a smooth share of the donors' weight onto each helper joint: share = gain * smoothstep(1 - distance to the
    seed / radius), taken from the weights as painted (helpers that share a donor split it, never more than all of it).
    With the helpers at rest the skin moves exactly as before; rows keep their sum."""
    W0 = sp.csc_matrix(W); n = W0.shape[0]; shares = []; total = {}
    for h in helpers:
        if np.ndim(h["seed"]) == 2:                                           # a band: distance to the nearest point of a seed line
            from scipy.spatial import cKDTree
            dist = cKDTree(h["seed"]).query(v)[0]
        else: dist = np.linalg.norm(v - h["seed"], axis=1)
        if "front" in h:                                                      # front of the joint only (knee_front)
            f = np.clip(((v - h["front"])[:, 2] + 0.02) / 0.04, 0, 1); f = f * f * (3 - 2 * f); dist = np.where(f > 0, dist / np.maximum(f, 1e-3), 1e3)
        t = np.clip(1 - dist / h["radius"], 0, 1); g = h["gain"] * t * t * (3 - 2 * t); shares.append(g)
        for dj in h["donors"]: total[dj] = total.get(dj, 0) + g
    out = W0.tolil()
    for dj, tot in total.items():
        col = np.asarray(W0[:, dj].todense()).ravel(); idx = np.nonzero((tot > 1e-4) & (col > 0))[0]
        if len(idx): out[idx, dj] = (col[idx] * (1 - np.minimum(tot[idx], 1.0))).reshape(-1, 1)
    for h, g in zip(helpers, shares):
        take = np.zeros(n)
        for dj in h["donors"]: take += np.asarray(W0[:, dj].todense()).ravel() * g / np.maximum(total[dj], 1.0)
        idx = np.nonzero(take > 1e-5)[0]
        if len(idx): out[idx, h["joint"]] = take[idx].reshape(-1, 1)
    out = out.tocsr(); out.eliminate_zeros(); return out


def _knee_mask(verts, J):
    r = KNEE_SMOOTH[0]; sel = np.zeros(len(verts))
    for s, _, _ in SIDES:
        t = np.clip(1 - np.linalg.norm(verts - J[JI[f"calf_{s}"]], axis=1) / r, 0, 1); sel = np.maximum(sel, t * t * (3 - 2 * t))
    return sel


def _smooth_knee(W, verts, J):
    """Round 7: Laplacian smoothing of the body's weights round the knees (see KNEE_SMOOTH); the kneecap helper keeps its share,
    the other joints share what is left; rows sum to 1. At rest nothing moves (weights only)."""
    base = mh.load_base(); q = np.asarray(base.quads); body = base.vgroups["body"]; q = q[body[q].all(1)]
    t = np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]]]); e = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]); n = W.shape[0]
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)).tocsr(); A = ((A + A.T) > 0).astype(float)
    deg = np.asarray(A.sum(1)).ravel(); deg[deg == 0] = 1; P = sp.diags(1 / deg) @ A
    sel = _knee_mask(verts, J) * body; rows = np.nonzero(sel > 0)[0]
    if not len(rows): return W
    # work on the rows inside the region and their neighbours only
    ring = np.unique(np.concatenate([rows, P[rows].indices])); Wd = np.asarray(W.tocsr()[ring].todense(), dtype=np.float64); W0 = Wd.copy()
    Pr = P[ring][:, ring]; lam = (KNEE_SMOOTH[2] * sel[ring])[:, None]
    for _ in range(KNEE_SMOOTH[1]): Wd = Wd + lam * (Pr @ Wd - Wd)
    kc = [JI[f"knee_front_{s}"] for s, _, _ in SIDES]; kv = W0[:, kc]; Wd[:, kc] = 0; rs = Wd.sum(1, keepdims=True); ok = rs[:, 0] > 1e-9
    Wd[ok] *= (1 - kv[ok].sum(1, keepdims=True)) / rs[ok]; Wd[:, kc] = kv
    Wd[Wd < 1e-4] = 0; rs = Wd.sum(1, keepdims=True); bad = rs[:, 0] <= 1e-9; Wd[bad] = W0[bad]; Wd /= Wd.sum(1, keepdims=True)
    out = W.tolil(); keep = sel[ring] > 0
    for i, r in zip(ring[keep], Wd[keep]):
        nz = np.nonzero(r)[0]; out.rows[i] = list(nz); out.data[i] = list(r[nz])
    return out.tocsr()


def _knee_from_body(pack, W, verts, J):
    """Round 7: a garment, shoe or hair vertex round the knees takes the (smoothed) weights of its nearest body vertex, blended
    in by the same mask, so cloth follows the smoothed skin."""
    from scipy.spatial import cKDTree
    sel = _knee_mask(verts, J); rows = np.nonzero(sel > 0)[0]
    if not len(rows): return W
    body = np.nonzero(mh.load_base().vgroups["body"])[0]; nb = body[cKDTree(pack.base_src[body]).query(verts[rows])[1]]
    Wb = np.asarray(pack.W.tocsr()[nb].todense()); Wl = np.asarray(W.tocsr()[rows].todense()); s_ = sel[rows][:, None]
    Wm = (1 - s_) * Wl + s_ * Wb; Wm[Wm < 1e-4] = 0; Wm /= Wm.sum(1, keepdims=True); out = W.tolil()
    for i, r in zip(rows, Wm):
        nz = np.nonzero(r)[0]; out.rows[i] = list(nz); out.data[i] = list(r[nz])
    return out.tocsr()


def _dq_mask(W):
    """1 where a vertex belongs to a limb (distal of clavicle and pelvis), 0 on trunk, neck and head, soft in between."""
    core = [JI[n] for n in ("root", "pelvis", *SPINE, "neck_01", "neck_02", "head", "eye_l", "eye_r", "clavicle_l", "clavicle_r")]
    core += [JI[n] for n in HELPER_JOINTS if PARENT[JI[n]] in core]
    limb = 1.0 - np.asarray(W[:, core].sum(1)).ravel()
    return np.clip(2.0 * limb, 0, 1).astype(np.float32)


# ------------------------------------------------------------------------------------------------ axes, dofs, drivers
def _axes(J, thumb_x=None):
    """Named rest-pose axes (world frame) and the rest pose's offsets from clinical neutral, per side."""
    A = {}; O = {}; X = np.array([1.0, 0, 0]); P = lambda n: J[JI[n]]
    for s, _, sg in SIDES:
        u = unit(P(f"lowerarm_{s}") - P(f"upperarm_{s}")); f = unit(P(f"hand_{s}") - P(f"lowerarm_{s}"))
        A[f"upperarm_{s}.bone"] = u; A[f"lowerarm_{s}.bone"] = f
        h = unit(np.cross(u, f)); A[f"elbow_{s}.hinge"] = h
        O[f"elbow_{s}"] = math.degrees(math.acos(np.clip(u @ f, -1, 1)))
        O[f"shoulder_abd_{s}"] = math.degrees(math.atan2(sg * u[0], -u[1]))
        O[f"shoulder_flex_{s}"] = math.degrees(math.asin(np.clip(u[2], -1, 1)))
        A[f"shoulder_{s}.flex"] = -X; A[f"shoulder_{s}.abd"] = np.array([0, 0, sg]); A[f"shoulder_{s}.rot"] = -sg * u
        # humeral rotation of the rest pose: with the arm brought to the side, how far the elbow hinge is from the lateral axis
        Rdown = rot(A[f"shoulder_{s}.abd"], -O[f"shoulder_abd_{s}"])
        O[f"shoulder_rot_{s}"] = -signed_angle(Rdown @ h, -X, Rdown @ A[f"shoulder_{s}.rot"])
        A[f"clavicle_{s}.elev"] = np.array([0, 0, sg]); A[f"clavicle_{s}.roll"] = -X; A[f"clavicle_{s}.protract"] = np.array([0, -sg, 0])
        dh = unit(P(f"middle_01_{s}") - P(f"hand_{s}")); er = P(f"index_01_{s}") - P(f"pinky_01_{s}"); er = unit(er - dh * (er @ dh))
        palmar = sg * np.cross(dh, er); A[f"hand_{s}.dir"] = dh; A[f"hand_{s}.radial"] = er; A[f"hand_{s}.palmar"] = palmar
        A[f"forearm_{s}.pron"] = sg * f
        O[f"forearm_pron_{s}"] = signed_angle(sg * h, palmar, sg * f)
        A[f"wrist_{s}.flex"] = unit(np.cross(dh, palmar)); A[f"wrist_{s}.dev"] = unit(np.cross(dh, -er))
        for fn, _, meta in FINGERS:
            chain = ([f"{fn}_metacarpal_{s}"] if meta else [f"hand_{s}"]) + [f"{fn}_0{k}_{s}" for k in (1, 2, 3)]
            pts = [P(c) for c in chain]; dirs = [unit(pts[i + 1] - pts[i]) for i in range(3)]; dirs.append(dirs[-1])
            toward = palmar if fn != "thumb" else unit(palmar - er)             # fallback: the thumb closes across the palm
            for k in (1, 2, 3):
                d = dirs[k]; ax = unit(np.cross(d, toward - d * (toward @ d)))
                if fn == "thumb" and thumb_x is not None:                           # the artist's flexion axis: the MPFB bone's local X
                    ax = thumb_x[s][k - 1]; ax = unit(ax - d * (ax @ d))            # (it sweeps the thumb across the palm; same sense both sides)
                    if ax @ unit(np.cross(d, toward - d * (toward @ d))) < 0: ax = -ax
                A[f"{fn}_0{k}_{s}.flex"] = ax
                O[f"{fn}_0{k}_{s}"] = signed_angle(dirs[k - 1], dirs[k], A[f"{fn}_0{k}_{s}.flex"]) if fn != "thumb" or k > 1 else 0.0
            A[f"{fn}_01_{s}.spread"] = unit(np.cross(dirs[1], er - dirs[1] * (er @ dirs[1]))) if fn != "thumb" else unit(np.cross(dirs[1], palmar - dirs[1] * (palmar @ dirs[1])))
            if fn == "thumb": A[f"thumb_01_{s}.twist"] = sg * dirs[1]               # + = pronation: the pad turns to face the fingers
            A[f"{fn}_01_{s}.dir"] = dirs[1]
        for fn in ("index", "ring", "pinky"):                                       # how far each finger fans away from the middle finger at rest
            O[f"{fn}_fan_{s}"] = signed_angle(A[f"middle_01_{s}.dir"], A[f"{fn}_01_{s}.dir"], A[f"{fn}_01_{s}.spread"])
        ut = unit(P(f"calf_{s}") - P(f"thigh_{s}")); fs = unit(P(f"foot_{s}") - P(f"calf_{s}")); m = unit(ut + fs)
        A[f"thigh_{s}.bone"] = ut; A[f"calf_{s}.bone"] = fs
        kx = unit(X - m * (X @ m)); A[f"knee_{s}.hinge"] = kx; O[f"knee_{s}"] = signed_angle(ut, fs, kx)
        O[f"hip_abd_{s}"] = math.degrees(math.atan2(sg * ut[0], -ut[1])); O[f"hip_flex_{s}"] = math.degrees(math.atan2(ut[2], -ut[1]))
        A[f"hip_{s}.flex"] = -X; A[f"hip_{s}.abd"] = np.array([0, 0, sg]); A[f"hip_{s}.rot"] = -sg * ut
        A[f"ankle_{s}.dorsi"] = -unit(X - fs * (X @ fs)); A[f"ankle_{s}.inv"] = np.array([0, 0, -sg]); A[f"ankle_{s}.rot"] = -sg * fs
        A[f"toes_{s}.ext"] = -X
        leg = np.linalg.norm(P(f"calf_{s}") - P(f"thigh_{s}")) + np.linalg.norm(P(f"foot_{s}") - P(f"calf_{s}"))
        O[f"hip_abd_heels020_{s}"] = math.degrees(math.asin(np.clip((0.10 - sg * P(f"thigh_{s}")[0]) / leg, -1, 1)))
    A["trunk.flex"] = X; A["trunk.lat"] = np.array([0, 0, 1.0]); A["trunk.rot"] = np.array([0, -1.0, 0])
    return A, O


def dofs(pack):
    """FORMAT.md "dofs". Within a joint the order listed is the order applied (first = outermost)."""
    A = pack.axes; O = pack.offsets; out = []
    def add(i, joint, axis, lo, hi, label, group): out.append({"id": i, "joint": joint, "axis": [round(float(x), 6) for x in axis], "min": round(lo, 1), "max": round(hi, 1), "label": label, "group": group})
    for j, lab in (("pelvis", "Pelvis"), *[(n, n.replace("_", " ").title()) for n in SPINE], *[(n, n.replace("_", " ").title()) for n in NECK]):
        lim = {"pelvis": (30, 20, 30)}.get(j, (30, 20, 25) if j.startswith("spine") else (35, 25, 40))
        add(f"{j}.flex", j, A["trunk.flex"], -lim[0], lim[0], lab + " flexion", "Trunk" if j in ("pelvis", *SPINE) else "Neck")
        add(f"{j}.lat", j, A["trunk.lat"], -lim[1], lim[1], lab + " side bend right", "Trunk" if j in ("pelvis", *SPINE) else "Neck")
        add(f"{j}.rot", j, A["trunk.rot"], -lim[2], lim[2], lab + " rotation right", "Trunk" if j in ("pelvis", *SPINE) else "Neck")
    for s, _, sg in SIDES:
        Sd = "L" if s == "l" else "R"; g = "Arm " + Sd
        add(f"clavicle_{s}.elev", f"clavicle_{s}", A[f"clavicle_{s}.elev"], -10, 40, f"Clavicle {Sd} elevation", g)
        add(f"clavicle_{s}.roll", f"clavicle_{s}", A[f"clavicle_{s}.roll"], -10, 30, f"Clavicle {Sd} upward roll", g)
        add(f"clavicle_{s}.protract", f"clavicle_{s}", A[f"clavicle_{s}.protract"], -20, 25, f"Clavicle {Sd} protraction", g)
        a0 = O[f"shoulder_abd_{s}"]; e0 = O[f"elbow_{s}"]
        add(f"shoulder_{s}.flex", f"upperarm_{s}", A[f"shoulder_{s}.flex"], -45, ENVELOPE["extended"]["shoulder_flexion"][1], f"Shoulder {Sd} flexion", g)
        add(f"shoulder_{s}.abd", f"upperarm_{s}", A[f"shoulder_{s}.abd"], -a0 - 20, ENVELOPE["extended"]["shoulder_abduction"][1] - a0, f"Shoulder {Sd} abduction (0 = rest, {a0:.0f} deg)", g)
        add(f"shoulder_{s}.rot", f"upperarm_{s}", A[f"shoulder_{s}.rot"], -100, 100, f"Shoulder {Sd} external rotation", g)
        add(f"elbow_{s}.flex", f"lowerarm_{s}", A[f"elbow_{s}.hinge"], -e0, ENVELOPE["extended"]["elbow_flexion"][1] - e0, f"Elbow {Sd} flexion (0 = rest, {e0:.0f} deg)", g)
        add(f"forearm_{s}.pron", f"hand_{s}", A[f"forearm_{s}.pron"], -100, 100, f"Forearm {Sd} pronation", g)
        add(f"wrist_{s}.flex", f"hand_{s}", A[f"wrist_{s}.flex"], -75, 80, f"Wrist {Sd} flexion", g)
        add(f"wrist_{s}.dev", f"hand_{s}", A[f"wrist_{s}.dev"], -25, 40, f"Wrist {Sd} ulnar deviation", g)
        g = "Hand " + Sd
        for fn, _, meta in FINGERS:
            if fn == "thumb":                                                        # thumb base: abduction outermost, then flexion, then pronation
                add(f"thumb_01_{s}.spread", f"thumb_01_{s}", A[f"thumb_01_{s}.spread"], -20, 70, f"Thumb {Sd} palmar abduction", g)
                add(f"thumb_01_{s}.flex", f"thumb_01_{s}", A[f"thumb_01_{s}.flex"], -40, 60, f"Thumb {Sd} base flexion (across the palm)", g)
                add(f"thumb_01_{s}.twist", f"thumb_01_{s}", A[f"thumb_01_{s}.twist"], -30, 70, f"Thumb {Sd} pronation (opposition)", g)
            else:
                add(f"{fn}_01_{s}.flex", f"{fn}_01_{s}", A[f"{fn}_01_{s}.flex"], -30, 100, f"{fn.title()} {Sd} base flexion", g)
                add(f"{fn}_01_{s}.spread", f"{fn}_01_{s}", A[f"{fn}_01_{s}.spread"], -30, 30, f"{fn.title()} {Sd} spread toward the thumb", g)
            for k in (2, 3): add(f"{fn}_0{k}_{s}.flex", f"{fn}_0{k}_{s}", A[f"{fn}_0{k}_{s}.flex"], -20, 110, f"{fn.title()} {Sd} joint {k} flexion", g)
    for s, _, sg in SIDES:
        Sd = "L" if s == "l" else "R"; g = "Leg " + Sd; k0 = O[f"knee_{s}"]
        add(f"hip_{s}.flex", f"thigh_{s}", A[f"hip_{s}.flex"], -20, ENVELOPE["extended"]["hip_flexion"][1], f"Hip {Sd} flexion", g)
        add(f"hip_{s}.abd", f"thigh_{s}", A[f"hip_{s}.abd"], -30, 50, f"Hip {Sd} abduction (0 = rest, {O[f'hip_abd_{s}']:.0f} deg)", g)
        add(f"hip_{s}.rot", f"thigh_{s}", A[f"hip_{s}.rot"], -45, 45, f"Hip {Sd} external rotation", g)
        add(f"knee_{s}.flex", f"calf_{s}", A[f"knee_{s}.hinge"], -k0, ENVELOPE["extended"]["knee_flexion"][1] - k0, f"Knee {Sd} flexion (0 = rest, {k0:.0f} deg)", g)
        add(f"ankle_{s}.dorsi", f"foot_{s}", A[f"ankle_{s}.dorsi"], -50, 30, f"Ankle {Sd} dorsiflexion", g)
        add(f"ankle_{s}.inv", f"foot_{s}", A[f"ankle_{s}.inv"], -20, 30, f"Ankle {Sd} inversion", g)
        add(f"ankle_{s}.rot", f"foot_{s}", A[f"ankle_{s}.rot"], -30, 30, f"Foot {Sd} outward rotation", g)
        add(f"toes_{s}.ext", f"ball_{s}", A[f"toes_{s}.ext"], -30, 60, f"Toes {Sd} extension", g)
    return out


def drivers(pack):
    """FORMAT.md "drivers": one `twist` record per limb segment and side (leaf twist joints; a negative fraction
    counter-rotates the twist joint so the skin near the parent joint does not twist with the limb)."""
    out = [d for d in _all_drivers(pack) if d["type"] == "twist"]
    if getattr(pack, "helpers", None):
        live = {h["name"] for h in pack.helpers}; frac = getattr(pack, "helper_fraction", {})
        for s, _, _ in SIDES:
            groups = {}
            for name, par, piv, src, axk, f, *_ in HELPERS:
                if f"{name}_{s}" in live: groups.setdefault((f"{src}_{s}", axk.format(s=s)), []).append({"joint": f"{name}_{s}", "fraction": round(float(frac.get(name, f)), 4)})
            for (src, axk), tg in groups.items():
                out.append({"type": "twist", "source": src, "axis": [round(float(x), 6) for x in pack.axes[axk]], "targets": tg, "helper": True})
    return out


def controls(pack):
    """Optional manifest section "controls" (not in FORMAT.md v0.2; for RL to adopt): one slider that writes several dofs
    through piecewise-linear maps: spine and neck distribution, shoulder flexion / abduction with the clavicle's share."""
    return [d for d in _all_drivers(pack) if d["type"] == "share"]


def _all_drivers(pack):
    A = pack.axes; out = []
    for seg, _, far, nodes, _, source, fr in SEGMENTS:
        for s, _, _ in SIDES:
            tw = [n for n in nodes if "twist" in n]
            out.append({"type": "twist", "source": f"{source}_{s}", "axis": [round(float(x), 6) for x in A[f"{seg}_{s}.bone"]],
                        "targets": [{"joint": f"{n}_{s}", "fraction": f} for n, f in zip(tw, fr)]})
    for kind, lab, lim in (("flex", "flexion", (-30, 75)), ("lat", "side bend right", (-35, 35)), ("rot", "rotation right", (-45, 45))):
        out.append({"type": "share", "control": f"spine.{kind}", "label": "Spine " + lab, "min": lim[0], "max": lim[1], "group": "Trunk",
                    "targets": [{"dof": f"{j}.{kind}", "map": [[lim[0], round(lim[0] * f, 3)], [lim[1], round(lim[1] * f, 3)]]} for j, f in zip(SPINE, SPINE_SHARE[kind])]})
    for kind, lab, lim in (("flex", "flexion", (-55, 50)), ("lat", "side bend right", (-40, 40)), ("rot", "rotation right", (-80, 80))):
        out.append({"type": "share", "control": f"neck.{kind}", "label": "Neck " + lab, "min": lim[0], "max": lim[1], "group": "Neck",
                    "targets": [{"dof": f"{j}.{kind}", "map": [[lim[0], round(lim[0] * f, 3)], [lim[1], round(lim[1] * f, 3)]]} for j, f in zip(NECK, NECK_SHARE[kind])]})
    for s, _, _ in SIDES:
        Sd = "L" if s == "l" else "R"; a0 = pack.offsets[f"shoulder_abd_{s}"]
        t0, k = CLAV_ROLL
        out.append({"type": "share", "control": f"shoulder_{s}.reach", "label": f"Shoulder {Sd} flexion with clavicle", "min": -60, "max": 180, "group": "Arm " + Sd,
                    "targets": [{"dof": f"clavicle_{s}.roll", "map": [[-60, 0], [t0, 0], [180, round((180 - t0) * k, 3)]]},
                                {"dof": f"shoulder_{s}.flex", "map": [[-60, -60], [t0, t0], [180, round(180 - (180 - t0) * k, 3)]]}]})
        t0, k = CLAV_ELEV
        out.append({"type": "share", "control": f"shoulder_{s}.raise", "label": f"Shoulder {Sd} abduction with clavicle (clinical, 0 = arm at the side)", "min": 0, "max": 180, "group": "Arm " + Sd,
                    "targets": [{"dof": f"clavicle_{s}.elev", "map": [[0, 0], [t0, 0], [180, round((180 - t0) * k, 3)]]},
                                {"dof": f"shoulder_{s}.abd", "map": [[0, round(-a0, 3)], [t0, round(t0 - a0, 3)], [180, round(180 - (180 - t0) * k - a0, 3)]]}]})
    return out


# ------------------------------------------------------------------------------------------------ clinical angles -> dofs
HAND_POSES = {  # fingers: knuckle / middle / tip flexion (index, middle, ring, pinky); thumb: (palmar abduction, base flexion across the palm,
                # pronation, middle joint, tip joint); spread: degrees between neighbouring fingers
    "HAND_RELAXED": {"fingers": [(25, 30, 15), (32, 37, 18), (38, 43, 22), (45, 50, 25)], "thumb": (22, 15, 15, 12, 12), "spread": 5},
    "HAND_FLAT": {"fingers": [(0, 0, 0)] * 4, "thumb": (0, 20, 0, 5, 5), "spread": 3},
    "HAND_FIST": {"fingers": [(90, 100, 70)] * 4, "thumb": (40, 30, 40, 40, 45), "spread": 2},
    "HAND_SPREAD": {"fingers": [(0, 0, 0)] * 4, "thumb": (15, -30, 0, 0, 0), "spread": 20},
    "HAND_GRIP40": {"fingers": [(55, 75, 45), (58, 78, 45), (62, 80, 48), (68, 82, 50)], "thumb": (50, 15, 45, 25, 35), "spread": 4},
    "HAND_POINT": {"fingers": [(0, 0, 0), (80, 90, 60), (80, 90, 60), (80, 90, 60)], "thumb": (40, 35, 35, 35, 35), "spread": 3},
}
BASE_POSES = {
    "A_POSE": {"shoulder_abduction": 40, "elbow_flexion": 5, "heels_020": True, "both_sides": True, "hand": "HAND_RELAXED"},
    "SEATED_GRIPS": {"hip_flexion": 80, "knee_flexion": 95, "shoulder_flexion": 15, "shoulder_abduction": 10, "elbow_flexion": 95, "neck_flexion": 10, "both_sides": True, "hand": "HAND_GRIP40"},
    "HAND_POSE_ARM": {"shoulder_flexion": 45, "elbow_flexion": 60, "hand": "HAND_RELAXED"},
}


WORKING_POSES = (   # the seated working envelope (the designer's review 1): single joints and the seated figure
    ("W01", "hip_85_knee_95", None, {"hip_flexion": 85, "knee_flexion": 95}),
    ("W02", "hip_95_knee_110", None, {"hip_flexion": 95, "knee_flexion": 110}),
    ("W03", "knee_90", None, {"knee_flexion": 90}),
    ("W04", "knee_110", None, {"knee_flexion": 110}),
    ("W05", "elbow_100", None, {"shoulder_flexion": 20, "shoulder_abduction": 10, "elbow_flexion": 100}),
    ("W06", "shoulder_forward_45", None, {"shoulder_flexion": 45, "shoulder_abduction": 10, "elbow_flexion": 60}),
    ("W07", "shoulder_forward_80", None, {"shoulder_flexion": 80, "shoulder_abduction": 10, "elbow_flexion": 30}),
    ("W08", "seated_reach_both", "SEATED_GRIPS", {"shoulder_flexion": 70, "elbow_flexion": 40, "both_sides": True}),
    ("W09", "seated_lean_15", "SEATED_GRIPS", {"spine_flexion": 15}),
    ("W10", "grip_arm_adducted_10_elbow_95", None, {"shoulder_flexion": 15, "shoulder_abduction": 10, "elbow_flexion": 95, "both_sides": True}),
)


def hand_dofs(pack, name, s):
    O = pack.offsets; hp = HAND_POSES[name]; d = {}
    for (fn, _, _), ang, mult in zip(FINGERS[1:], hp["fingers"], (1, 0, -1, -2)):
        for k in (1, 2, 3): d[f"{fn}_0{k}_{s}.flex"] = ang[k - 1] - O[f"{fn}_0{k}_{s}"]
        if fn != "middle": d[f"{fn}_01_{s}.spread"] = hp["spread"] * mult - O[f"{fn}_fan_{s}"]      # angle to the middle finger, not to the fanned rest
    t = hp["thumb"]
    d[f"thumb_01_{s}.spread"] = t[0]; d[f"thumb_01_{s}.flex"] = t[1]; d[f"thumb_01_{s}.twist"] = t[2]
    d[f"thumb_02_{s}.flex"] = t[3] - O[f"thumb_02_{s}"]; d[f"thumb_03_{s}.flex"] = t[4] - O[f"thumb_03_{s}"]
    return d


def solve_ball(R_want, axes, starts):
    """Angles (degrees) so that rot(axes[0], a) @ rot(axes[1], b) @ rot(axes[2], c) = R_want (least squares, best of the starts)."""
    from scipy.optimize import least_squares
    f = lambda x: (rot(axes[0], x[0]) @ rot(axes[1], x[1]) @ rot(axes[2], x[2]) - R_want).ravel()
    best = min((least_squares(f, np.array(st, dtype=np.float64)) for st in starts), key=lambda r: r.cost)
    return [float((v + 180) % 360 - 180) for v in best.x]


def clinical_to_dofs(pack, angles, base=None, info=None):
    """Clinical joint angles (the designer's vocabulary, from neutral standing; single-sided = the RIGHT limb) -> dof values.
    Shares (clavicle, spine, neck) are applied here, so the result is explicit on every joint."""
    O = pack.offsets; d = {}
    layers = ([BASE_POSES[base]] if base else []) + [angles]
    for li, a in enumerate(layers):
        sides = ("l", "r") if a.get("both_sides") else ("r",)
        g = lambda k: float(a.get(k, 0.0))
        for s in sides:
            arm_keys = ("shoulder_flexion", "shoulder_extension", "shoulder_abduction", "shoulder_horizontal_adduction", "shoulder_external_rotation", "shoulder_internal_rotation")
            if any(k in a for k in arm_keys):
                F = g("shoulder_flexion") - g("shoulder_extension")
                Aab = a.get("shoulder_abduction", NEUTRAL_ABD)
                if "shoulder_horizontal_adduction" in a: Aab = 90.0 - g("shoulder_horizontal_adduction")
                roll = CLAV_ROLL[1] * max(0.0, F - CLAV_ROLL[0]); elev = CLAV_ELEV[1] * max(0.0, Aab - CLAV_ELEV[0]) if abs(F) < 1 else 0.0
                d[f"clavicle_{s}.roll"] = roll; d[f"clavicle_{s}.elev"] = elev
                d[f"shoulder_{s}.flex"] = F - roll; d[f"shoulder_{s}.abd"] = Aab - elev - O[f"shoulder_abd_{s}"]
                d[f"shoulder_{s}.rot"] = g("shoulder_external_rotation") - g("shoulder_internal_rotation") - O[f"shoulder_rot_{s}"]
                if "shoulder_horizontal_adduction" in a:
                    Ax = pack.axes; sg = 1.0 if s == "l" else -1.0
                    hang = rot(Ax[f"shoulder_{s}.abd"], -O[f"shoulder_abd_{s}"]) @ rot(Ax[f"shoulder_{s}.rot"], -O[f"shoulder_rot_{s}"])
                    want = rot([0, -sg, 0], g("shoulder_horizontal_adduction")) @ rot(Ax[f"shoulder_{s}.abd"], 90) @ hang
                    x = solve_ball(rot(Ax[f"clavicle_{s}.roll"], roll).T @ want, [Ax[f"shoulder_{s}.flex"], Ax[f"shoulder_{s}.abd"], Ax[f"shoulder_{s}.rot"]],
                                   [(F - roll, Aab - O[f"shoulder_abd_{s}"], sg * 90), (F - roll, Aab - O[f"shoulder_abd_{s}"], -sg * 90), (F - roll, Aab - O[f"shoulder_abd_{s}"], 0)])
                    d[f"shoulder_{s}.flex"], d[f"shoulder_{s}.abd"] = x[0], x[1]
                    d[f"shoulder_{s}.rot"] = x[2] + g("shoulder_external_rotation") - g("shoulder_internal_rotation")
                if "elbow_flexion" not in a: d[f"elbow_{s}.flex"] = 5.0 - O[f"elbow_{s}"]
                d.setdefault(f"forearm_{s}.pron", -O[f"forearm_pron_{s}"])
            if "clavicle_elevation" in a: d[f"clavicle_{s}.elev"] = d.get(f"clavicle_{s}.elev", 0.0) + g("clavicle_elevation")
            if "elbow_flexion" in a: d[f"elbow_{s}.flex"] = g("elbow_flexion") - O[f"elbow_{s}"]
            if "forearm_pronation" in a or "forearm_supination" in a: d[f"forearm_{s}.pron"] = g("forearm_pronation") - g("forearm_supination") - O[f"forearm_pron_{s}"]
            if "wrist_flexion" in a or "wrist_extension" in a: d[f"wrist_{s}.flex"] = g("wrist_flexion") - g("wrist_extension")
            if "wrist_ulnar_deviation" in a or "wrist_radial_deviation" in a: d[f"wrist_{s}.dev"] = g("wrist_ulnar_deviation") - g("wrist_radial_deviation")
            if "hip_flexion" in a or "hip_extension" in a: d[f"hip_{s}.flex"] = g("hip_flexion") - g("hip_extension")
            if "hip_abduction" in a: d[f"hip_{s}.abd"] = g("hip_abduction") - O[f"hip_abd_{s}"]
            if a.get("heels_020"): d[f"hip_{s}.abd"] = O[f"hip_abd_heels020_{s}"] - O[f"hip_abd_{s}"]
            if "hip_external_rotation" in a or "hip_internal_rotation" in a: d[f"hip_{s}.rot"] = g("hip_external_rotation") - g("hip_internal_rotation")
            if "knee_flexion" in a: d[f"knee_{s}.flex"] = g("knee_flexion") - O[f"knee_{s}"]
            if "ankle_dorsiflexion" in a or "ankle_plantarflexion" in a: d[f"ankle_{s}.dorsi"] = g("ankle_dorsiflexion") - g("ankle_plantarflexion")
            if "hand" in a: d.update(hand_dofs(pack, a["hand"], s))
        for grp, joints, share, keys in (("spine", SPINE, SPINE_SHARE, ("spine_flexion", "spine_extension", "spine_lateral_bend_right", "spine_rotation_right")),
                                         ("neck", NECK, NECK_SHARE, ("neck_flexion", "neck_extension", "neck_lateral_bend_right", "neck_rotation_right"))):
            tot = {"flex": g(keys[0]) - g(keys[1]), "lat": g(keys[2]), "rot": g(keys[3])}
            for kind, v in tot.items():
                if any(k in a for k in keys) and (v or li == 0):
                    for j, f in zip(joints, share[kind]): d[f"{j}.{kind}"] = d.get(f"{j}.{kind}", 0.0) * 0 + v * f
    seated = base == "SEATED_GRIPS"
    planted = seated or any(l.get("both_sides") and ("hip_flexion" in l or "knee_flexion" in l) for l in layers)
    if planted:
        if seated: d["pelvis.flex"] = d.get("pelvis.flex", 0.0) - 10.0                 # the plain seat's backrest is reclined 10 deg
        key = "ankle_%s.dorsi" if seated else None
        for _ in range(3):                                                              # keep the soles level
            M = pose_matrices(pack, pack.rest, d)
            for s in ("l", "r"):
                tilt = twist_angle(M[JI[f"foot_{s}"], :3, :3], [1, 0, 0])
                if seated: d[f"ankle_{s}.dorsi"] = d.get(f"ankle_{s}.dorsi", 0.0) + tilt
            if not seated:
                d["pelvis.flex"] = d.get("pelvis.flex", 0.0) - 0.5 * sum(twist_angle(M[JI[f"foot_{s}"], :3, :3], [1, 0, 0]) for s in ("l", "r"))
        if not seated:                                                                  # round 8: soles flat sideways too (the
            for _ in range(2):                                                          # deep squat rolled each foot 9.7 deg onto its
                M = pose_matrices(pack, pack.rest, d)                                   # edge: toes and shoe 6-10 mm through the floor)
                for s in ("l", "r"):
                    az = float(next(x["axis"] for x in _cached(pack, "_dofs", dofs) if x["id"] == f"ankle_{s}.inv")[2])
                    d[f"ankle_{s}.inv"] = d.get(f"ankle_{s}.inv", 0.0) - twist_angle(M[JI[f"foot_{s}"], :3, :3], [0, 0, 1]) / az
        M, Jp = pose_matrices(pack, pack.rest, d, return_joints=True)
        feet = [JI["foot_l"], JI["foot_r"]]
        if info is not None: info["rootOffset"] = [round(float(x), 4) for x in (pack.rest[feet].mean(0) - Jp[feet].mean(0))]; info["grounded"] = True
    elif not seated and any(k in angles for k in ("ankle_dorsiflexion", "ankle_plantarflexion")) and not any(k in angles for k in ("hip_flexion", "knee_flexion", "both_sides")):
        # round 8: a standing ankle pose (E34, E35) lifts that foot clear of the floor, as a person shows the movement: hip and knee
        # flex (hip half the knee) until the foot's lowest skin point is FOOT_CLEAR above the floor; the other foot stays planted
        _lift_foot(pack, d, "r", info)
    return {k: round(float(v), 3) for k, v in d.items() if abs(v) > 1e-9}


FOOT_CLEAR = 0.025              # round 8: how far a lifted foot's lowest skin point stays above the floor (a shoe adds a few mm)


def _lift_foot(pack, d, s, info=None):
    W = pack.W.tocsr(); col = [JI[f"foot_{s}"], JI[f"ball_{s}"]] + [JI[n] for n in JOINTS if n.startswith(("toes", "foot", "ball")) and n.endswith(f"_{s}") and n in JI]
    v0 = pack.base_src; body = mh.load_base().vgroups["body"]; floor = v0[body, 1].min()
    sel = np.nonzero(body & (np.asarray(W[:, sorted(set(col))].sum(1)).ravel() > 0.3))[0]; J, Wp = pad(W[sel])
    for k in np.arange(0.0, 90.1, 2.5):
        if k:
            d[f"knee_{s}.flex"] = k - pack.offsets[f"knee_{s}"]; d[f"hip_{s}.flex"] = 0.5 * k
        V = skin(v0[sel], J, Wp, pose_matrices(pack, pack.rest, d))
        if V[:, 1].min() - floor >= FOOT_CLEAR: break
    if info is not None and k: info["lifted"] = {"side": s, "knee_flexion": float(k), "hip_flexion": float(0.5 * k), "clearance_m": round(float(V[:, 1].min() - floor), 4)}


def poses(pack, packet=PACKET):
    """FORMAT.md "poses": A_POSE, SEATED_GRIPS, HAND_POSE_ARM and the designer's set E, as explicit dof values."""
    pk = json.load(open(packet)); out = []
    for name in ("A_POSE", "SEATED_GRIPS", "HAND_POSE_ARM"):
        info = {}; dd = clinical_to_dofs(pack, {}, base=name, info=info)
        out.append({"name": name, "id": name, "dofs": dd, "clinical": BASE_POSES[name], "seated": name == "SEATED_GRIPS", "envelope": "working", **info})
    for name in HAND_POSES:
        out.append({"name": name, "id": name, "dofs": {**clinical_to_dofs(pack, {}, base="HAND_POSE_ARM"), **hand_dofs(pack, name, "r")}, "clinical": {"base_pose": "HAND_POSE_ARM", "hand": name}, "envelope": "working"})
    for wid, wname, base, ang in WORKING_POSES:
        info = {}; out.append({"name": f"{wid} {wname}", "id": wid, "dofs": clinical_to_dofs(pack, ang, base=base, info=info), "clinical": {**({"base_pose": base} if base else {}), **ang},
                               "seated": base == "SEATED_GRIPS", "envelope": "working", **info})
    for r in pk["rom_poses"]:
        ang = dict(r["angles"]); base = r.get("base_pose"); info = {}
        rec = {"name": f'{r["id"]} {r["name"]}', "id": r["id"], "dofs": clinical_to_dofs(pack, ang, base=base, info=info), "clinical": {**({"base_pose": base} if base else {}), **ang},
               "target": r.get("target"), "views": r.get("views"), "camera": r.get("camera", pk["rom_defaults"]["camera"]), "seated": base == "SEATED_GRIPS", "envelope": envelope_of({**({"base_pose": base} if base else {}), **ang}, r["id"]), **info}
        if "el" in r: rec["el"] = r["el"]
        out.append(rec)
    return out


def write_poses(pack, path, packet=PACKET):
    ps = poses(pack, packet); json.dump(ps, open(path, "w"), indent=1); return ps


# ------------------------------------------------------------------------------------------------ pose evaluation, skinning
def fk(names, parent, joints_rest, dof_list, driver_list, dof_values, apply_drivers=True, root_offset=None):
    """FORMAT.md section 3 as a reference, for ANY skeleton with world-aligned rest frames: dof values (degrees) -> local
    joint rotations (dofs of one joint multiplied in the order listed) -> `twist` drivers -> world. Returns
    (M (B,4,4) skinning matrices rest -> posed, posed joint positions (B,3), local rotations (B,3,3))."""
    ix = {n: i for i, n in enumerate(names)}; B = len(names)
    R = np.tile(np.eye(3), (B, 1, 1))
    for d in dof_list:
        v = dof_values.get(d["id"], 0.0)
        if v: R[ix[d["joint"]]] = R[ix[d["joint"]]] @ rot(d["axis"], v)
    if apply_drivers:
        for dr in driver_list:
            if dr.get("type") != "twist" or dr.get("source") not in ix: continue
            ang = twist_angle(R[ix[dr["source"]]], dr["axis"])
            for t in dr["targets"]:
                if dr.get("inChain"): R[ix[t["joint"]]] = R[ix[t["joint"]]] @ rot(dr["axis"], t["fraction"] * ang)
                else: R[ix[t["joint"]]] = rot(dr["axis"], t["fraction"] * ang)
    J0 = np.asarray(joints_rest, dtype=np.float64); G = np.zeros((B, 3, 3)); Jp = J0.copy(); M = np.zeros((B, 4, 4)); M[:, 3, 3] = 1
    for j in range(B):
        p = parent[j]
        if p < 0:
            G[j] = R[j]
            if root_offset is not None: Jp[j] = J0[j] + np.asarray(root_offset, dtype=np.float64)
        else: G[j] = G[p] @ R[j]; Jp[j] = Jp[p] + G[p] @ (J0[j] - J0[p])
        M[j, :3, :3] = G[j]; M[j, :3, 3] = Jp[j] - G[j] @ J0[j]
    return M, Jp, R


def pose_matrices(pack, joints_rest, dof_values, apply_drivers=True, return_joints=False, root_offset=None):
    """dof values -> skinning matrices (82,4,4) on this pack's skeleton (see fk)."""
    M, Jp, _ = fk(JOINTS, PARENT, joints_rest, _cached(pack, "_dofs", dofs), _cached(pack, "_drivers", drivers), dof_values, apply_drivers, root_offset)
    return (M, Jp) if return_joints else M


def _cached(pack, key, fn):
    if not hasattr(pack, key): setattr(pack, key, fn(pack))
    return getattr(pack, key)


def pad(W, K=None):
    """Sparse (n,B) weights -> padded (J int (n,K), W float (n,K)), K = most influences on any vertex."""
    W = W.tocsr(); n = W.shape[0]; cnt = np.diff(W.indptr); K = int(cnt.max()) if K is None else K
    J = np.zeros((n, K), dtype=np.int64); Wp = np.zeros((n, K))
    col = np.arange(W.nnz) - np.repeat(W.indptr[:-1], cnt); row = np.repeat(np.arange(n), cnt)
    J[row, col] = W.indices; Wp[row, col] = W.data
    return J, Wp


def _qmul(a, b):
    w1, x1, y1, z1 = a[..., 0], a[..., 1], a[..., 2], a[..., 3]; w2, x2, y2, z2 = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([w1*w2-x1*x2-y1*y2-z1*z2, w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2], -1)


def skin(verts, J, W, M, dq_mask=None):
    """Linear blend skinning with padded influences (J, W from pad() or the 4-influence fit). With dq_mask (n,) in 0..1:
    out = (1 - mask) * linear + mask * dual quaternion, the blend the lab viewer's shader does."""
    v = np.asarray(verts, dtype=np.float64); W = np.asarray(W, dtype=np.float64)
    Mv = np.einsum("nk,nkij->nij", W, M[J][:, :, :3, :])
    lin = np.einsum("nij,nj->ni", Mv[:, :, :3], v) + Mv[:, :, 3]
    if dq_mask is None: return lin
    q = Rot.from_matrix(M[:, :3, :3]).as_quat()[:, [3, 0, 1, 2]]
    t = np.concatenate([np.zeros((len(M), 1)), M[:, :3, 3]], 1); qd = 0.5 * _qmul(t, q)
    qv = q[J]; s = np.sign(np.einsum("nkc,nc->nk", qv, qv[:, 0])); s[s == 0] = 1; Ws = W * s
    bq = np.einsum("nk,nkc->nc", Ws, qv); bd = np.einsum("nk,nkc->nc", Ws, qd[J]); nrm = np.maximum(np.linalg.norm(bq, axis=1, keepdims=True), 1e-12); bq /= nrm; bd /= nrm
    Rv = Rot.from_quat(bq[:, [1, 2, 3, 0]]).as_matrix(); tt = 2 * _qmul(bd, bq * np.array([1, -1, -1, -1]))[:, 1:]
    dq = np.einsum("nij,nj->ni", Rv, v) + tt
    m = np.asarray(dq_mask, dtype=np.float64)[:, None]
    return lin * (1 - m) + dq * m


# ------------------------------------------------------------------------------------------------ 4-influence re-fit
def refit_poses(pack):
    """The pose set the weights are fitted on: the designer's set E plus single-joint extremes of every large dof."""
    out = [p["dofs"] for p in poses(pack) if p["id"].startswith("E") or p["id"] in ("A_POSE", "SEATED_GRIPS")]
    pack._n_setE = len(out)
    for d in _cached(pack, "_dofs", dofs):
        if d["group"].startswith("Hand"):
            if d["id"].endswith(".flex"): out.append({d["id"]: d["max"] * 0.8})
            continue
        for v in (d["min"], d["max"]):
            if abs(v) >= 15: out.append({d["id"]: v * 0.85})
    return out


def refit(pack, verts=None, k=4, pose_list=None, verbose=False):
    """Fill pack.J4 / pack.W4: for every vertex with more than k influences, the k joints and weights (sum 1, >= 0) that best
    reproduce the full-influence linear-blend position over the pose set (exhaustive over the k-subsets of its influences)."""
    v = pack.bake(pack.base_src if verts is None else verts)
    pl = pose_list if pose_list is not None else refit_poses(pack)
    J4, W4, fit_err, trunc_err = _fit4(pack, v, pack.W, pl, k); n = len(v); cnt = np.diff(pack.W.tocsr().indptr); Ms = pack._Ms
    pack.J4 = J4; pack.W4 = W4.astype(np.float32); pack.fit_err = fit_err; pack.trunc_err = trunc_err
    body = mh.load_base().vgroups["body"]; many = cnt > k
    return _refit_stats(pack, v, pl, k, body, many, cnt, fit_err, trunc_err, J4, W4, Ms)


def _fit4(pack, v, W, pl, k=4):
    Jr = pack.rest
    Ms = np.stack([pose_matrices(pack, Jr, d) for d in pl]); pack._Ms = Ms   # (P,82,4,4)
    Jf, Wf = pad(W); n, K = Jf.shape; cnt = (Wf > 0).sum(1)
    order = np.argsort(-Wf, axis=1); Jf = np.take_along_axis(Jf, order, 1); Wf = np.take_along_axis(Wf, order, 1)
    J4 = Jf[:, :k].copy(); W4 = Wf[:, :k].copy(); W4 /= np.maximum(W4.sum(1, keepdims=True), 1e-20)
    trunc_err = np.zeros(n); fit_err = np.zeros(n); sq = 0.0; cntsq = 0
    vh = np.concatenate([v, np.ones((n, 1))], 1)
    for m in range(k + 1, K + 1):
        idx = np.nonzero(cnt == m)[0]
        if not len(idx): continue
        X = np.einsum("pvcij,vj->pvci", Ms[:, Jf[idx, :m]][..., :3, :], vh[idx])        # (P, v, m, 3): each candidate joint's own position
        T = np.einsum("pvci,vc->pvi", X, Wf[idx, :m])                                    # full-influence target
        G = np.einsum("pvai,pvbi->vab", X, X); gT = np.einsum("pvai,pvi->va", X, T)
        tr = np.einsum("pvci,vc->pvi", X[:, :, :k], W4[idx]); trunc_err[idx] = np.linalg.norm(tr - T, axis=2).max(0)
        best = np.full(len(idx), np.inf); bestJ = J4[idx].copy(); bestW = W4[idx].copy()
        for S in itertools.combinations(range(m), k):
            S = list(S); N = G[:, S][:, :, S] + 1e-10 * np.eye(k)
            KKT = np.zeros((len(idx), k + 1, k + 1)); KKT[:, :k, :k] = N; KKT[:, :k, k] = 1; KKT[:, k, :k] = 1
            rhs = np.concatenate([gT[:, S], np.ones((len(idx), 1))], 1)
            w = np.linalg.solve(KKT, rhs[..., None])[:, :k, 0]
            w = np.clip(w, 0, None); w /= np.maximum(w.sum(1, keepdims=True), 1e-20)
            e = np.linalg.norm(np.einsum("pvci,vc->pvi", X[:, :, S], w) - T, axis=2).max(0)
            better = e < best
            best[better] = e[better]; bestW[better] = w[better]; bestJ[better] = Jf[idx][:, S][better]
        keep = trunc_err[idx] <= best                                                   # never worse than plain truncation
        bestW[keep] = W4[idx][keep]; bestJ[keep] = J4[idx][keep]; best[keep] = trunc_err[idx][keep]
        J4[idx] = bestJ; W4[idx] = bestW; fit_err[idx] = best
    J4[W4 <= 0] = 0
    return J4, W4, fit_err, trunc_err


def _refit_stats(pack, v, pl, k, body, many, cnt, fit_err, trunc_err, J4, W4, Ms):
    n = len(v)
    st = {"poses": len(pl), "vertices_over_%d" % k: int((many & body).sum()), "max_influences_full": int(cnt.max()),
          "max_mm": round(float(fit_err[body].max() * 1000), 2), "p99_mm": round(float(np.percentile(fit_err[body & many], 99) * 1000), 2) if (body & many).any() else 0.0,
          "mean_mm": round(float(fit_err[body & many].mean() * 1000), 3) if (body & many).any() else 0.0,
          "vertices_over_1mm": int((fit_err[body] > 1e-3).sum()),
          "truncation_max_mm": round(float(trunc_err[body].max() * 1000), 2), "truncation_vertices_over_1mm": int((trunc_err[body] > 1e-3).sum())}
    E = [i for i, d in enumerate(pl) if i < getattr(pack, "_n_setE", 0)]
    if E:
        J8, W8 = pad(pack.W); e4 = np.zeros(n)
        for i in E: e4 = np.maximum(e4, np.linalg.norm(skin(v, J4, W4, Ms[i]) - skin(v, J8, W8, Ms[i]), axis=1))
        st["setE_max_mm"] = round(float(e4[body].max() * 1000), 2); st["setE_vertices_over_1mm"] = int((e4[body] > 1e-3).sum())
    pack.refit_stats = st
    return st


def dqs_mask(W82):
    """The `_DQS` value per vertex from weights on the 82 joints (body, garment, shoe: the same rule, so layers agree)."""
    return _dq_mask(W82.tocsr() if sp.issparse(W82) else sp.csr_matrix(W82))


def write_dqs(glb_path, masks):
    """Add FORMAT.md v0.2's `_DQS` vertex attribute (SCALAR float, 0 = linear blend, 1 = dual quaternion) to meshes of a
    written GLB. masks: {mesh name: (verts (n,3) as given to glb.Mesh.v, mask (n,))}; each output vertex takes the mask of
    the nearest given vertex (the writer only splits seams, so that is its own source vertex). Returns {mesh: vertex count}."""
    import struct
    from scipy.spatial import cKDTree
    raw = open(glb_path, "rb").read(); jl = struct.unpack_from("<I", raw, 12)[0]; js = json.loads(raw[20:20 + jl]); bo = 20 + jl
    bl = struct.unpack_from("<I", raw, bo)[0]; blob = bytearray(raw[bo + 8:bo + 8 + bl]); done = {}
    def read(i):
        a = js["accessors"][i]; bv = js["bufferViews"][a["bufferView"]]; off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(bytes(blob[off:off + a["count"] * 12]), dtype=np.float32).reshape(-1, 3)
    for mesh in js["meshes"]:
        if mesh["name"] not in masks: continue
        v, m = masks[mesh["name"]]; tree = cKDTree(np.asarray(v, dtype=np.float32))
        for prim in mesh["primitives"]:
            P = read(prim["attributes"]["POSITION"]); dist, idx = tree.query(P)
            assert dist.max() < 1e-4, "write_dqs: %s vertices do not match the given vertices (%.4f m)" % (mesh["name"], dist.max())
            data = np.asarray(m, dtype=np.float32)[idx].tobytes()
            while len(blob) % 4: blob.append(0)
            js["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": 34962}); blob.extend(data)
            js["accessors"].append({"bufferView": len(js["bufferViews"]) - 1, "componentType": 5126, "count": len(P), "type": "SCALAR"})
            prim["attributes"]["_DQS"] = len(js["accessors"]) - 1; done[mesh["name"]] = done.get(mesh["name"], 0) + len(P)
    while len(blob) % 4: blob.append(0)
    js["buffers"][0]["byteLength"] = len(blob); jb = json.dumps(js, separators=(",", ":")).encode(); jb += b" " * ((-len(jb)) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob)) + struct.pack("<II", len(jb), 0x4E4F534A) + jb + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    open(glb_path, "wb").write(out)
    return done


def anchors():
    """FORMAT.md "anchors" and the designer's packet targets, as joint names of this skeleton."""
    return {"head": "head", "eye_L": "eye_l", "eye_R": "eye_r", "hand_L": "middle_metacarpal_l", "hand_R": "middle_metacarpal_r", "pelvis": "pelvis",
            "foot_L": "foot_l", "foot_R": "foot_r", "neck_base": "neck_01", "joint:shoulder_R": "upperarm_r", "joint:shoulder_L": "upperarm_l",
            "joint:elbow_R": "lowerarm_r", "joint:elbow_L": "lowerarm_l", "joint:wrist_R": "hand_r", "joint:wrist_L": "hand_l",
            "joint:knee_R": "calf_r", "joint:knee_L": "calf_l", "joint:ankle_R": "foot_r", "joint:ankle_L": "foot_l"}


def manifest_sections(pack, packet=PACKET):
    """Everything of the manifest this module owns: {"dofs", "drivers", "poses", "anchors", "rest_note"}."""
    return {"dofs": dofs(pack), "drivers": drivers(pack), "controls": controls(pack), "poses": poses(pack, packet), "anchors": anchors(), "rest_note": pack.rest_note,
            "envelopes": {**ENVELOPE, "note": "clinical degrees; dof min/max are the extended envelope; poses carry `envelope`: working | extended | end (end = test only, not for display)"}}


def for_body(base_v, targets=None, mpfb_rig=None, packet=PACKET):
    """Everything build_body.py --rig rr needs, in one call. base_v: the package's grounded rest vertices (19158,3);
    targets: {name: dense delta (19158,3)}. Returns a dict: pack, skeleton (glb.Skeleton), W (sparse, full influences),
    J4 / W4 (the 4-influence fit, full 19,158 rows), dqs (19158,), joint_targets {name: (82,3)}, refit (stats),
    dofs, drivers, controls, poses, anchors, rest_note."""
    pack = convert_rig(mpfb_rig or mh.load_rig("default"), None, base_v); st = refit(pack); J0 = pack.joints(base_v)
    out = {"pack": pack, "skeleton": pack.skeleton(base_v), "W": pack.W, "J4": pack.J4, "W4": pack.W4, "dqs": pack.dq_mask, "refit": st,
           "joint_targets": {t: pack.joints(base_v + d) - J0 for t, d in (targets or {}).items()}}
    out.update(manifest_sections(pack, packet)); return out


def for_layer(pack, W_default_bones, verts, k=4):
    """A garment, shoe or hair mesh that follows the body: its weights on the MPFB default bones (n,163; e.g. the
    barycentric transfer of mh.Rig.weights) and its rest vertices -> (J4 (n,4), W4 (n,4), dqs (n,), W82 sparse)."""
    W82 = pack.transfer(W_default_bones, verts); J4, W4, _, _ = _fit4(pack, np.asarray(verts, dtype=np.float64), W82, refit_poses(pack), k)
    return J4, W4.astype(np.float32), dqs_mask(W82), W82


def person_joints(package, person):
    """Rest joint positions of one packet person from a built package: {joint name: [x, y, z]} (metres, package frame).
    Evaluates the manifest's shape model on the preset of that name and adds its jointDeltas; also returns nothing else:
    for the vertices use rig_rom.body_of(rig_rom.load_package(package), person)."""
    import rig_rom
    pk = rig_rom.load_package(package); b = rig_rom.body_of(pk, person)
    if b is None: raise KeyError("no shape preset named %s in %s" % (person, package))
    return {n: [round(float(x), 5) for x in b[1][i]] for i, n in enumerate(pk.names)}


def rom_check(package, out_dir=None, persons=("M50", "F05", "M95H", "M50_THIN", "M50_HEAVY"), **kw):
    import rig_rom
    return rig_rom.rom_check(package, out_dir=out_dir, persons=persons, **kw)


if __name__ == "__main__":
    p = convert_rig()
    print(p.rest_note)
    print("offsets", {k: round(v, 1) for k, v in p.offsets.items() if k.endswith("_r") and not k[0] in "timrp"})
    cnt = np.diff(p.W.indptr); body = mh.load_base().vgroups["body"]
    print("influences on 82 joints (body):", np.bincount(cnt[body]))
    print("refit", json.dumps(refit(p)))
