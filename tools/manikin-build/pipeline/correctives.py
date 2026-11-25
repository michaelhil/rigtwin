"""correctives.py (owner: B3): pose-driven corrective morph targets `pc_<joint>_<pose>` for the hm08 body.

Source of the shapes: NVIDIA SOMA-X 0.3.0 pose-corrective model (`downloads/soma-x/assets/correctives_model.pt`,
Apache-2.0), evaluated at our key poses on SOMA's own mesh, then carried onto hm08 through the surface correspondence
SOMA-X ships for Anny (`assets/Anny/SOMA_wrap.obj` = SOMA topology wrapped onto `assets/Anny/base_body.obj`; Anny's
vertices are hm08 vertices, map in `pc_data/anny_to_hm08.npy`). Deltas are rest-pose deltas (applied before skinning).

Each corrective is the difference between SOMA-X's surface at a key pose (its corrective skinned with its own weights
and twist rule, both carried to hm08) and OUR skinned surface there: RR's rig (`rig.py`: 82 joints, twist drivers,
4-influence weights) under the lab viewer's masked dual-quaternion blend (`rig.skin(..., dq_mask)` = `viewer/src/dqs.ts`).

    import correctives as pc
    out = pc.add_correctives(package)      # see pipeline/README.md, section "Correctives"

Run the proof:  $PY -I pipeline/pc_proof.py
"""
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot
import mh_core as mh, pc_geom as g, pc_soma_io as sio

HERE = os.path.dirname(os.path.abspath(__file__))
NBODY = 13380
_cache = {}

# ------------------------------------------------------------------------------------------------ the two skeletons
import rig as rr
SOMA_LIMBS = {"arm": ("LeftArm", "LeftForeArm", "LeftHand"), "leg": ("LeftLeg", "LeftShin", "LeftFoot")}
RR_LIMBS = {"arm": ("upperarm_l", "lowerarm_l", "hand_l"), "leg": ("thigh_l", "calf_l", "foot_l")}
MIRX = np.diag([-1.0, 1, 1])
# our joint -> SOMA public joint that takes its world rotation (parents first); unlisted SOMA joints follow their parent
JMAP = [("pelvis", "Hips"), ("neck_01", "Neck1"), ("neck_02", "Neck2"), ("head", "Head")]
for _s, _S in (("l", "Left"), ("r", "Right")):
    JMAP += [(f"clavicle_{_s}", _S + "Shoulder"), (f"upperarm_{_s}", _S + "Arm"), (f"lowerarm_{_s}", _S + "ForeArm"), (f"hand_{_s}", _S + "Hand"),
             (f"thigh_{_s}", _S + "Leg"), (f"calf_{_s}", _S + "Shin"), (f"foot_{_s}", _S + "Foot")]

def rest_geometry(J):
    """J: dict joint name -> rest position. Limb directions of the left side (the right is the mirror image)."""
    sh, el, wr = (np.asarray(J[b], float) for b in RR_LIMBS["arm"]); hip, kn, an = (np.asarray(J[b], float) for b in RR_LIMBS["leg"])
    u_arm = g.unit(el - sh); f_arm = g.unit(wr - el); u_leg = g.unit(kn - hip); f_leg = g.unit(an - kn)
    return dict(sh=sh, el=el, wr=wr, hip=hip, kn=kn, an=an, u_arm=u_arm, f_arm=f_arm, u_leg=u_leg, f_leg=f_leg, neck=np.asarray(J["neck_02"], float),
                elbow_rest=math.degrees(math.acos(np.clip(u_arm @ f_arm, -1, 1))), knee_rest=math.degrees(math.acos(np.clip(u_leg @ f_leg, -1, 1))))

def key_poses(pack, G):
    """Left-side key poses as dof values of RR's rig (degrees from the rest pose; shares already applied), the driver
    that fades each target in (FORMAT.md forms), and the close-up region. Hinges have two keys (RR measured the need):
    the second is stored as the step from the first, so the drivers are plain ramps. Angles in names are anatomical."""
    e0, k0 = G["elbow_rest"], G["knee_rest"]; P = {}
    def hinge(name, dof, a0, a1, rest, c, r, half, prev=None, limb=None):
        P[name] = dict(dofs={dof: a1 - rest}, driver=dict(type="morph", dof=dof, **{"from": round(a0 - rest, 2), "to": round(a1 - rest, 2)}), c=c, r=r, half=half, prev=prev, limb=limb)
    hinge("elbow_90", "elbow_l.flex", e0, 90, e0, G["el"], 0.11, 0.17, limb="arm"); hinge("elbow_135", "elbow_l.flex", 90, 135, e0, G["el"], 0.11, 0.17, "elbow_90", "arm")
    hinge("knee_90", "knee_l.flex", k0, 90, k0, G["kn"], 0.16, 0.27, limb="leg"); hinge("knee_135", "knee_l.flex", 90, 135, k0, G["kn"], 0.16, 0.27, "knee_90", "leg")
    hinge("hip_90", "hip_l.flex", 0, 90, 0, G["hip"], 0.24, 0.36)
    hinge("wrist_flex70", "wrist_l.flex", 0, 70, 0, G["wr"], 0.08, 0.13); hinge("wrist_ext60", "wrist_l.flex", 0, -60, 0, G["wr"], 0.08, 0.13)
    dl = {d["id"]: d for d in rr.dofs(pack)}
    balls = {}
    for name, clin in (("shoulder_fwd90", {"shoulder_flexion": 90}), ("shoulder_abd90", {"shoulder_abduction": 90}),
                       ("shoulder_fwd170", {"shoulder_flexion": 170}), ("shoulder_abd170", {"shoulder_abduction": 170})):
        dv = {k.replace("_r.", "_l."): v for k, v in rr.clinical_to_dofs(pack, clin).items() if k.startswith(("shoulder_r.", "clavicle_r.")) and abs(v) > 1e-6}
        Rk = np.eye(3)
        for k in ("shoulder_l.flex", "shoulder_l.abd", "shoulder_l.rot"): Rk = Rk @ g.rot(dl[k]["axis"], dv.get(k, 0.0))
        ang = math.degrees(np.linalg.norm(Rot.from_matrix(Rk).as_rotvec()))
        P[name] = dict(dofs=dv, driver=dict(type="morphPose", joint="upperarm_l", pose={k: round(v, 3) for k, v in dv.items() if k.startswith("shoulder_l.")}, radius=round(min(75.0, ang), 1)),
                       c=G["sh"], r=0.20, half=0.30, prev=None, limb=None); balls[name] = Rk
    for a, Ra in balls.items():                                # a ball key must be silent at the rest pose and at the other keys
        others = [math.degrees(np.linalg.norm(Rot.from_matrix(Ra.T @ Rb).as_rotvec())) for b, Rb in balls.items() if b != a]
        P[a]["driver"]["radius"] = round(min([P[a]["driver"]["radius"]] + others), 1)
    for name, ctrl, val, dof in (("neck_flex45", "neck.flex", 45, "head.flex"), ("neck_ext45", "neck.flex", -45, "head.flex"), ("neck_rot70", "neck.rot", -70, "head.rot")):
        shares = (rr.controls(pack) if hasattr(rr, "controls") else []) + rr.drivers(pack)      # RR keeps the share records in controls()
        sh = next(d for d in shares if d.get("type") == "share" and d.get("control") == ctrl)
        dv = {t["dof"]: float(np.interp(val, [m[0] for m in t["map"]], [m[1] for m in t["map"]])) for t in sh["targets"]}
        P[name] = dict(dofs=dv, driver=dict(type="morph", dof=dof, **{"from": 0, "to": round(dv[dof], 2)}), c=G["neck"], r=0.14, half=0.22, prev=None, limb=None, centre=True)
    return P

def driver_weights(pack, drivers, dof_values):
    """FORMAT.md section 3, step 3 for the corrective drivers: target name -> weight for a pose given as dof values"""
    dl = rr.dofs(pack); out = {}
    def jrot(joint, vals):
        R = np.eye(3)
        for d in dl:
            if d["joint"] == joint and vals.get(d["id"], 0.0): R = R @ g.rot(d["axis"], vals[d["id"]])
        return R
    for d in drivers:
        if d["type"] == "morph": out[d["target"]] = float(np.clip((dof_values.get(d["dof"], 0.0) - d["from"]) / (d["to"] - d["from"]), 0, 1))
        elif d["type"] == "morphPose":
            a = math.degrees(np.linalg.norm(Rot.from_matrix(jrot(d["joint"], dof_values).T @ jrot(d["joint"], d["pose"])).as_rotvec())); out[d["target"]] = max(0.0, 1 - a / d["radius"])
    return out

# ------------------------------------------------------------------------------------------------ SOMA side
def _soma():
    if "soma" in _cache: return _cache["soma"]
    rig = sio.load_rig(); pub = sio.public(); cm = sio.Correctives(); ix = {n: i for i, n in enumerate(rig["names"])}
    names = pub["names"]; par = pub["parents"]; Bw = np.zeros((len(names), 3, 3))
    for j in range(len(names)): Bw[j] = cm.bind[j] if par[j] == j or j == 0 else Bw[par[j]] @ cm.bind[j]
    pos = {n: rig["bind"][ix[n]][:3, 3] for n in names}
    faces = sio.faces_from_counts(rig["fvi"], rig["fvc"]); F = sio.tri_faces(faces)
    vw, fw = sio.load_obj(os.path.join(sio.SOMA, "Anny", "SOMA_wrap.obj")); va, _ = sio.load_obj(os.path.join(sio.SOMA, "Anny", "base_body.obj"))
    assert np.array_equal(sio.tri_faces(fw), F), "SOMA_wrap.obj does not have the template's topology"
    kids = [[] for _ in names]
    for j in range(1, len(names)):
        if par[j] != j: kids[par[j]].append(j)
    _cache["soma"] = dict(names=names, par=par, Bw=Bw, pos=pos, F=F, bind=rig["points"], wrap=vw, anny=va, cm=cm, kids=kids, mirror=pub["mirror"], seg=pub["segments"])
    return _cache["soma"]

def _subtree(S, j):
    out = [j]; k = 0
    while k < len(out): out += S["kids"][out[k]]; k += 1
    return out

def soma_rest_match(G):   # G: rest_geometry()
    """world delta rotation per SOMA public joint that brings SOMA's bind pose (an A-pose) to our rest pose
    (limb directions matched on both sides; trunk and neck are taken as equal)."""
    S = _soma(); n = len(S["names"]); D = np.tile(np.eye(3), (n, 1, 1)); ji = S["names"].index
    for side, mir in (("Left", np.eye(3)), ("Right", MIRX)):
        for limb, (ku, kf) in (("arm", ("u_arm", "f_arm")), ("leg", ("u_leg", "f_leg"))):
            a, b, c = (S["pos"][x.replace("Left", side)] for x in SOMA_LIMBS[limb]); ja, jb = (ji(x.replace("Left", side)) for x in SOMA_LIMBS[limb][:2])
            Du = g.swing(b - a, mir @ G[ku])
            for j in _subtree(S, ja): D[j] = Du @ D[j]
            Df = g.swing(Du @ (c - b), mir @ G[kf])
            for j in _subtree(S, jb): D[j] = Df @ D[j]
    return D

def soma_delta(D):
    """SOMA corrective displacement (cm, SOMA bind frame, 18056 x 3) for world delta rotations D per public joint"""
    S = _soma(); Gw = np.einsum("jik,jkl->jil", D, S["Bw"]); Xl = np.einsum("jki,jkl->jil", Gw[S["par"]], Gw); Xl[0] = Gw[0]
    return S["cm"](Xl)[0]

def _apply(S, D, joint, K):
    D = D.copy()
    for j in _subtree(S, S["names"].index(joint)): D[j] = K @ D[j]
    return D

# ------------------------------------------------------------------------------------------------ correspondence
def correspondence():
    """hm08 body vertices (in Anny's default rest embedding, as SOMA-X's base_body.obj) -> SOMA_wrap surface.
    Returns dict(A (19158,3) hm08 positions in that embedding, tri, bary, dist, T body triangles, covered mask)."""
    if "corr" in _cache: return _cache["corr"]
    S = _soma(); base = mh.load_base(); h = np.load(os.path.join(__import__("labpaths").LAB, "pipeline", "pc_data", "anny_to_hm08.npy"))
    T = mh.triangulate(base.quads[mh.body_quads(base, ("body",))])
    A = np.full((mh.NV, 3), np.nan); A[h] = S["anny"]; known = ~np.isnan(A[:, 0]); Lap, has = g.laplacian(mh.NV, T)
    fill = np.nonzero(~known[:NBODY])[0]; A[fill] = 0; Af = A[:NBODY + 0].copy()
    for _ in range(200):                                   # the 32 body vertices Anny drops: membrane fill from their neighbours
        Aall = np.where(np.isnan(A), 0, A); A[fill] = (Lap @ Aall)[fill]
    N = g.vnormals(np.where(np.isnan(A), 0, A), T)
    tri, bary, dist, agree = g.surface_map(A[:NBODY], N[:NBODY], S["wrap"], S["F"])
    _cache["corr"] = dict(A=A, tri=tri, bary=bary, dist=dist, agree=agree, T=T, fill=fill, Lap=Lap, has=has)
    return _cache["corr"]

def correspondence_report():
    C = correspondence(); S = _soma(); d = C["dist"] * 1000
    # reverse direction: SOMA wrap vertices onto the hm08 surface
    Nw = g.vnormals(S["wrap"], S["F"]); A = C["A"][:NBODY]; T = C["T"]
    _, _, dr, _ = g.surface_map(S["wrap"], Nw, A, T); dr = dr * 1000
    big = d > 5
    return dict(hm08_to_soma_mm=dict(median=float(np.median(d)), p95=float(np.percentile(d, 95)), p99=float(np.percentile(d, 99)), max=float(d.max()), over_5mm=int(big.sum())),
                soma_to_hm08_mm=dict(median=float(np.median(dr)), p95=float(np.percentile(dr, 95)), p99=float(np.percentile(dr, 99)), max=float(dr.max())),
                normal_agree_fraction=float(C["agree"].mean()), filled_vertices=int(len(C["fill"])))

def transfer(d_soma_cm, rest_v, max_dist=0.012):
    """SOMA bind-frame displacement (cm) -> hm08 rest-pose delta (metres, (19158,3), package rest shape `rest_v`).
    Each step re-expresses the displacement in the local surface frame and local scale of the next embedding."""
    S = _soma(); C = correspondence()
    dw = g.reframe(d_soma_cm, S["bind"], S["wrap"], S["F"])                       # SOMA bind (cm) -> SOMA topology on Anny (m)
    f = S["F"][C["tri"]]; dA = (C["bary"][:, :, None] * dw[f]).sum(1)             # -> hm08 body vertices, Anny embedding
    fade = np.clip((max_dist - C["dist"]) / (0.5 * max_dist), 0, 1); dA *= fade[:, None]   # no surface under the vertex: no delta
    out = np.zeros((mh.NV, 3)); out[:NBODY] = g.reframe(dA, C["A"][:NBODY], rest_v[:NBODY], C["T"])
    return out

def to_helpers(delta, rest_v, reach=0.03):
    """copy body deltas to the helper geometry near the skin (clothes bind to helper vertices), fading with distance"""
    out = delta.copy(); mv = np.nonzero(np.linalg.norm(delta[:NBODY], axis=1) > 1e-5)[0]
    if len(mv) == 0: return out
    d, i = cKDTree(rest_v[mv]).query(rest_v[NBODY:]); w = np.clip(1 - d / reach, 0, 1); out[NBODY:] = delta[mv[i]] * w[:, None]
    return out

def mirror_delta(delta, mirror):
    return delta[mirror] * np.array([-1.0, 1, 1])

# ------------------------------------------------------------------------------------------------ SOMA's own skinning on hm08
def soma_weights():
    """SOMA's painted weights carried to the hm08 body vertices through the surface map: (13380, 110) sparse"""
    if "Wh" in _cache: return _cache["Wh"]
    S = _soma(); C = correspondence(); rig = sio.load_rig(); f = S["F"][C["tri"]]
    Bm = sp.coo_matrix((C["bary"].ravel(), (np.repeat(np.arange(NBODY), 3), f.ravel())), shape=(NBODY, len(S["bind"]))).tocsr()
    j = json.load(open(os.path.join(sio.SOMA, "SOMA_procedural_transforms.json"))); ent = {}
    for e in j["parameter_matrices"]["rotation"]["entries"]: ent.setdefault(e["row"], []).append((e["column"], e["value"]))
    _cache["Wh"] = dict(W=(Bm @ rig["W"]).tocsr(), names=rig["names"], parent=rig["parent"], segments=j["segments"], entries=ent)
    return _cache["Wh"]

def _twist_angle(K, u):
    q = Rot.from_matrix(K).as_quat(); return 2 * math.atan2(float(np.dot(q[:3], u)), float(q[3]))

def soma_pose(pack, J, M, D0):
    """our skinning matrices M (82,4,4) -> (SOMA world delta rotations per public joint for the corrective model,
    SOMA skinning matrices (110,4,4) incl. its procedural twist joints, in our frame)."""
    S = _soma(); Wd = soma_weights(); ix = pack.names.index; D = D0.copy(); names = Wd["names"]; par = Wd["parent"]; n = len(names)
    own = {sj: M[ix(oj)] for oj, sj in JMAP}; rest = {sj: J[ix(oj)] for oj, sj in JMAP}
    for oj, sj in JMAP:
        for k in _subtree(S, S["names"].index(sj)): D[k] = M[ix(oj)][:3, :3] @ D0[k]
    Ms = np.zeros((n, 4, 4)); done = np.zeros(n, bool); special = {}
    for seg in Wd["segments"]:
        s, e = seg["start_joint"], seg["end_joint"]; p = seg.get("parent_joint") or names[par[names.index(s)]]
        u = g.unit(rest[e] - rest[s]); Rs = own[s][:3, :3]; tw = {e: _twist_angle(Rs.T @ own[e][:3, :3], u)}
        if seg.get("reverse") and p in own: tw[s] = _twist_angle(own[p][:3, :3].T @ Rs, u)
        for t in seg["twist_joints"]:
            ang = sum(v * tw.get(c, 0.0) for c, v in Wd["entries"].get(t, []))
            special[t] = own[s] @ g.about(g.rot(u, math.degrees(ang)), rest[s])
    def get(k):
        if not done[k]:
            nm = names[k]; Ms[k] = special[nm] if nm in special else own[nm] if nm in own else (np.eye(4) if par[k] < 0 else get(par[k])); done[k] = True
        return Ms[k]
    for k in range(n): get(k)
    return D, Ms

def unskin(L, r, eps=1e-3):
    """rest-pose delta d with L d = r per vertex (damped where the blend has collapsed the matrix)"""
    A = np.einsum("vki,vkj->vij", L, L) + eps * np.eye(3); return np.linalg.solve(A, np.einsum("vki,vk->vi", L, r)[..., None])[..., 0]

# ------------------------------------------------------------------------------------------------ candidate 2: contact + volume
CONTACT = {  # key pose -> (distal joint whose subtree is the far segment, proximal direction, distal direction, lateral limit in m)
    "elbow_90": ("lowerarm_l", "u_arm", "f_arm", None), "elbow_135": ("lowerarm_l", "u_arm", "f_arm", None),
    "knee_90": ("calf_l", "u_leg", "f_leg", None), "knee_135": ("calf_l", "u_leg", "f_leg", None), "hip_90": ("thigh_l", None, "u_leg", 0.11)}

def contact_target(sk, G, name, p, M, iters=10, gap=0.0012, start=None, spread=24, cap=0.045):
    """Offline contact-aware, volume-preserving target for a flexed joint, started from OUR skinned pose (so the bony
    side keeps its shape): skin meets skin on the plane bisecting the two segments; the correction is diffused over the
    surface as a displacement (never the surface itself, so nothing shrinks); the displaced volume comes back as a
    bulge of the free skin next to the fold until the body has its rest volume."""
    pack = sk.pack; T = correspondence()["T"]; C = correspondence(); Lap = C["Lap"][:NBODY][:, :NBODY]; ix = pack.names.index
    dj, ku, kf, lat = CONTACT[name]; j = ix(dj); c = sk.J[j]; R = M[j][:3, :3]
    sub = [k for k in range(len(pack.names)) if k == j or _is_under(pack.parent, k, j)]
    Wd = sp.coo_matrix((sk.W4.ravel(), (np.repeat(np.arange(NBODY), sk.W4.shape[1]), sk.J4.ravel())), shape=(NBODY, len(pack.names))).tocsr()
    distal = np.asarray(Wd[:, sub].sum(1)).ravel() > 0.5
    u = np.array([0, -1.0, 0]) if ku is None else G[ku]; f2 = R @ G[kf]; nrm = g.unit(f2 + u); bis = g.unit(f2 - u)
    P0 = sk.skin(M) if start is None else start; soft = np.clip((p["r"] * 1.5 - np.linalg.norm(sk.V - c, axis=1)) / (p["r"] * 0.5), 0, 1)
    if lat: soft = soft * np.clip((lat * 1.6 - np.abs(sk.V[:, 0] - c[0])) / (lat * 0.6), 0, 1) * (sk.V[:, 0] * c[0] > 0)
    D = np.zeros_like(P0); hit = np.zeros(NBODY, bool)
    def clamp(X):
        sgn = (X - c) @ nrm; inner = ((X - c) @ bis > 0) & (soft > 0)
        md = inner & distal & (sgn < gap); mp = inner & ~distal & (sgn > -gap); corr = np.zeros_like(X)
        corr[md] = (gap - sgn[md])[:, None] * nrm; corr[mp] = (-gap - sgn[mp])[:, None] * nrm
        return corr * soft[:, None], md | mp
    for _ in range(iters):
        corr, m = clamp(P0 + D); D += corr; hit |= m
        for _ in range(2): D += 0.5 * ((Lap @ D) - D) * soft[:, None]
    corr, m = clamp(P0 + D); D += corr; hit |= m; X = P0 + D
    w = hit.astype(float)
    for _ in range(spread): w = 0.5 * w + 0.5 * (Lap @ w)
    w = w * soft * (~hit); w /= max(w.max(), 1e-9); N = g.vnormals(X, T); vol0 = g.total_volume(sk.V, T)
    f = lambda a: g.total_volume(X + a * w[:, None] * N, T) - vol0; lo, hi = 0.0, cap
    if f(lo) < 0:
        if f(hi) < 0: lo = hi
        else:
            for _ in range(12):
                md_ = 0.5 * (lo + hi); lo, hi = (md_, hi) if f(md_) < 0 else (lo, md_)
        X = X + lo * w[:, None] * N; corr, _ = clamp(X); X = X + corr
    return X, dict(contact_vertices=int(hit.sum()), bulge_mm=round(lo * 1000, 1))

def _is_under(parent, k, j):
    while k >= 0:
        k = parent[k]
        if k == j: return True
    return False

class Skinner:
    """our deformation, exactly as the lab viewer does it: RR's rig, 4 influences, masked dual-quaternion blend"""
    def __init__(self, pack, verts_src, mode="mask"):
        if getattr(pack, "J4", None) is None: rr.refit(pack)
        self.pack = pack; self.V = pack.bake(verts_src)[:NBODY]; self.J = pack.joints(verts_src); self.J4 = pack.J4[:NBODY]; self.W4 = np.asarray(pack.W4[:NBODY], float)
        m = np.asarray(pack.dq_mask[:NBODY], float); self.mask = {"mask": m, "linear": None, "dual": np.ones_like(m)}[mode]
    def matrices(self, dofs): return rr.pose_matrices(self.pack, self.J, dofs)
    def skin(self, M, V=None): return rr.skin(self.V if V is None else V, self.J4, self.W4, M, self.mask)
    def linear(self, M):
        """per-vertex 3x3 with skin(V + d) = skin(V) + L d (the blend is affine in the rest position)"""
        p0 = self.skin(M); return p0, np.stack([self.skin(M, self.V + np.eye(3)[k]) - p0 for k in range(3)], 2)

# ------------------------------------------------------------------------------------------------ public entry
def _get(p, k, default=None): return p.get(k, default) if isinstance(p, dict) else getattr(p, k, default)

def build(verts_src, pack=None, mode="mask", gain=None, helpers=True, want_targets=False, source=None):
    """All corrective targets for one body. verts_src: (19158,3) hm08 vertices in the source pose (what pack.bake and
    pack.joints take). Returns (morphs, drivers, info): morphs name -> (19158,3) deltas on the baked rest shape.
    Per key pose: (1) SOMA-X's corrective displacement there, minus its value in our rest pose, carried to hm08 as a
    rest-pose delta and scaled by `gain`; (2) target = that delta skinned with SOMA's own weights and twist rule, also
    carried to hm08; (3) corrective = target minus our skinned surface, pulled back through our skinning."""
    base = mh.load_base(); S = _soma(); gain = GAIN if gain is None else gain; source = SOURCE if source is None else source
    if pack is None: pack = rr.convert_rig(mh.load_rig("default"))
    sk = Skinner(pack, verts_src, mode); Jd = {n: sk.J[i] for i, n in enumerate(pack.names)}; G = rest_geometry(Jd); D0 = soma_rest_match(G); d0 = soma_delta(D0)
    P = key_poses(pack, G); V0 = sk.V; rest_full = pack.bake(verts_src); T = correspondence()["T"]; vol0 = g.total_volume(V0, T); Wh = soma_weights()["W"]
    morphs = {}; drivers = []; full = {}; solved = {}; gains = {}
    for name, p in P.items():
        if source.get(name) == "none": continue
        M = sk.matrices(p["dofs"]); D, Ms = soma_pose(pack, sk.J, M, D0); ds = transfer(soma_delta(D) - d0, rest_full)[:NBODY]
        if gain == "volume":                                   # amplitude: the largest gain in [0,1] that adds no body volume
            f = lambda a: g.total_volume(g.lbs(V0 + a * ds, Wh, Ms)[0], T) - vol0; lo, hi = 0.0, 1.0
            if f(1.0) > 0:
                for _ in range(10):
                    md = 0.5 * (lo + hi); lo, hi = (md, hi) if f(md) < 0 else (lo, md)
                gains[name] = round(0.5 * (lo + hi), 3)
            else: gains[name] = 1.0
        else: gains[name] = float(gain.get(name, 1.0))
        ours, L = sk.linear(M); src = source.get(name, "soma")
        if src == "contact": tgt, cinfo = contact_target(sk, G, name, p, M); gains[name] = cinfo
        elif src == "soma+contact":
            tgt, cinfo = contact_target(sk, G, name, p, M, start=g.lbs(V0 + gains[name] * ds, Wh, Ms)[0]); gains[name] = dict(cinfo, soma_gain=gains[name])
        elif src == "none": tgt = ours
        else: tgt = g.lbs(V0 + gains[name] * ds, Wh, Ms)[0]
        d = np.zeros((mh.NV, 3)); d[:NBODY] = unskin(L, tgt - ours); full[name] = d
        if want_targets: solved[name] = dict(target=tgt, soma_lbs=g.lbs(V0, Wh, Ms)[0])
        dL = d - (full[p["prev"]] if p["prev"] else 0)
        if helpers: dL = to_helpers(dL, rest_full)
        joint, pose = name.split("_", 1)
        if p.get("centre") and name != "neck_rot70":
            tn = f"pc_{name}"; morphs[tn] = 0.5 * (dL + mirror_delta(dL, base.mirror)); drivers.append(dict(p["driver"], target=tn)); continue
        for side, dd in (("l", dL), ("r", mirror_delta(dL, base.mirror))):
            tn = f"pc_{joint}_{side}_{pose}"; morphs[tn] = dd; drv = json.loads(json.dumps(p["driver"]).replace("_l", "_" + side)); drv["target"] = tn
            if p.get("centre") and side == "r": drv["to"] = -drv["to"]          # head rotation the other way
            drivers.append(drv)
    info = dict(targets={tn: dict(max_mm=round(float(np.linalg.norm(d[:NBODY], axis=1).max() * 1000), 1), vertices=int((np.linalg.norm(d[:NBODY], axis=1) > 1e-4).sum())) for tn, d in morphs.items()},
                rest=dict(elbow_rest_deg=G["elbow_rest"], knee_rest_deg=G["knee_rest"]), gains=gains, skinning=mode, source={k: source.get(k, "soma") for k in P})
    return morphs, drivers, dict(info, poses=P, G=G, solved=solved, skinner=sk, pack=pack)

def add_correctives(package, pack=None, mode="mask", gain=None, source=None):
    """package: B1's build context (`bb.context()`) or a dict. Reads `base_v` ((19158,3) hm08 vertices of the package's
    base shape in the source pose, as RigPack.bake/joints take them) and the RigPack (`pack` argument, or
    `package.pack` / `package.rigpack`; otherwise rig.convert_rig + rig.refit are run here). Adds and returns:
      correctives         name -> (19158,3) deltas on the baked rest shape, metres (same form as ctx.targets: add them
                          to the body's morphs; garments get theirs as fit(base_v + d) - fit(base_v); at most 24)
      corrective_drivers  FORMAT.md driver records ("morph" on a dof, "morphPose" on upperarm_*): append to `drivers`
      corrective_info     per-target size, the amplitude gains, the skinning they were solved against
    `mode`: "mask" (the viewer's masked dual-quaternion blend, default), "linear", "dual": must match the viewer."""
    pack = pack or _get(package, "pack") or _get(package, "rigpack")
    morphs, drivers, info = build(np.asarray(_get(package, "base_v"), float), pack=pack, mode=mode, gain=gain, source=source)
    assert len(morphs) <= 24, len(morphs)
    out = dict(correctives=morphs, corrective_drivers=drivers, corrective_info={k: info[k] for k in ("targets", "rest", "gains", "skinning", "source")})
    if isinstance(package, dict): package.update(out)
    else:
        for k, v in out.items(): setattr(package, k, v)
    return out

GAIN = "volume"   # amplitude rule: "volume" (largest gain in [0,1] that adds no body volume; SOMA's own amplitude
                  # over-inflates deep flexion, measured in B3/NOTES.md), or a dict key pose -> multiplier ({} = 1)
# key pose -> source of the target shape, chosen per pose from the measured comparison (B3/NOTES.md, section 4):
#   "soma" = SOMA-X corrective on SOMA weights; "contact" = contact_target from our own skinned pose;
#   "soma+contact" = the SOMA target, then the contact pass; "none" = no target (neither source improved the pose)
SOURCE = {"elbow_90": "contact", "elbow_135": "contact", "knee_90": "contact", "knee_135": "contact",
          "wrist_flex70": "soma", "wrist_ext60": "soma", "shoulder_fwd90": "soma",
          "hip_90": "none", "shoulder_abd90": "none", "shoulder_fwd170": "none", "shoulder_abd170": "none",
          "neck_flex45": "none", "neck_ext45": "none", "neck_rot70": "none"}
