# RP common: the Anny shape basis as plain tensors, the ANSUR II rows, and the measurement definitions ("virtual caliper
# and tape") on the standing rest mesh. Everything a measurement uses is either a fixed vertex, a fixed set of vertices
# (an extreme is taken over it), a fixed point on a fixed mesh edge (a tape path made by slicing the reference body once)
# or a joint centre. So a definition is topology data, the procedure is topology-agnostic, and the same spec runs in JS.
# Frame (Anny, same as Blender/MPFB2): +X the body's left, -Y forward, +Z up; metres.
# Run with work/review-manikin/env/venv/bin/python -I
import csv, json, math, os, sys
import numpy as np, torch, anny
from anny.models import phenotype as PH
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import labpaths
HERE = os.path.join(labpaths.LAB, "RP") + "/"          # the lab's RP folder: fit results and packages
ROOT = os.path.abspath(os.path.join(labpaths.LAB, "..", "..")) + "/"   # the checkout holding private/ (the survey files)
OUTD = os.environ.get("RP_OUT", "out") + "/"; TAG = os.environ.get("RP_TAG", "")
torch.manual_seed(0); np.random.seed(0)
FT = torch.float32
M = anny.Anny(local_changes="all", topology="anny", rig="anny")
N = M.template_vertices.shape[0]
BL = list(M.bone_labels); BI = {b: i for i, b in enumerate(BL)}
KP = M.phenotype_blendshape_projection.shape[1]
LAB = list(M.local_change_labels)
assert M.blendshapes.shape[0] == KP + 2 * len(LAB)
F_ALL = M.faces.numpy()
_A = sp.coo_matrix((np.ones(len(F_ALL) * 3), (F_ALL.ravel(), np.roll(F_ALL, 1, 1).ravel())), shape=(N, N))
_nc, _lab = connected_components(_A, directed=False)
MAIN = _lab == np.argmax(np.bincount(_lab))                  # the skin (closed); the rest: tongue and two eyeballs
F_MAIN = F_ALL[MAIN[F_ALL[:, 0]]]
DOM = M.vertex_bone_indices.gather(1, M.vertex_bone_weights.argmax(1, keepdim=True))[:, 0].numpy()
def bones(*pre): return np.array([i for i, b in enumerate(BL) if any(b.startswith(p) for p in pre)])
def dmask(*pre): return np.isin(DOM, bones(*pre)) & MAIN

# share of each vertex that follows the arm (the upper arm bone and everything below it), for lowering landmarks to arms hanging
_PAR = [int(p) if p is not None else -1 for p in M.bone_parents]
def _subtree(root):
    out = {BI[root]}
    for i in range(len(BL)):
        p = _PAR[i]
        while p >= 0:
            if p == BI[root]: out.add(i); break
            p = _PAR[p]
    return sorted(out)
def _armw(s):
    sub = torch.zeros(len(BL), dtype=M.vertex_bone_weights.dtype); sub[_subtree(f"upperarm01.{s}")] = 1
    return (M.vertex_bone_weights * sub[M.vertex_bone_indices]).sum(1).numpy()
ARMW = {"L": _armw("L"), "R": _armw("R")}
ACR_V2 = os.environ.get("RP_ACROMION", "v1") == "v2"

# ------------------------------------------------------------------ parameters of the fit (Anny's own space)
FACE_WORDS = ("cheek", "chin", "ear", "eye", "forehead", "mouth", "nose", "nipple", "bulge", "valgus", "head-age", "head-angle",
              "head-fat", "neck-double", "pregnant", "-trans-", "navel", "breast-point", "fingers-distance")
# v2 (RP_LOCALS=v2): fewer local targets. Dropped: the ones stacked around the waist and the upper chest (wrinkles and
# ledges in the first run), exact duplicates, per-axis arm scalings and targets no measurement sees.
LOCALS_V2 = os.environ.get("RP_LOCALS", "v1") == "v2"
DROP_V2 = ("hip-waist-up", "measure-waisttohip-dist", "measure-napetowaist-dist", "measure-frontchest-dist", "measure-underbust-circ", "breast-dist", "breast-volume-vert",
           "pelvis-tone", "upperlegs-height", "lowerlegs-height", "torso-scale-vert", "neck-scale-vert", "measure-neck-height", "neck-back-scale-depth", "head-back-scale-depth", "hand-fingers-diameter", "upperarm-scale-", "lowerarm-scale-")
def local_groups(sex):
    words = FACE_WORDS + (("breast", "bust", "underbust") if sex == "male" else ()) + (DROP_V2 if LOCALS_V2 else ())
    g = {}
    for i, l in enumerate(LAB):
        if any(w in l for w in words): continue
        g.setdefault(l[2:] if l.startswith(("l-", "r-")) else l, []).append(i)
    return g
class Basis:
    """Rest vertices and joint heads as template + coefficients · basis, for one sex's parameter set."""
    def __init__(self, sex):
        self.sex = sex; self.groups = local_groups(sex); self.keys = list(self.groups); G = len(self.keys)
        bs = M.blendshapes; jb = M.bone_heads_blendshapes
        pos = torch.stack([sum(bs[KP + 2 * i] for i in self.groups[k]) for k in self.keys])
        neg = torch.stack([sum(bs[KP + 2 * i + 1] for i in self.groups[k]) for k in self.keys])
        self.BV = torch.cat([bs[:KP], pos, neg]).reshape(KP + 2 * G, -1).to(FT)
        jpos = torch.stack([sum(jb[KP + 2 * i] for i in self.groups[k]) for k in self.keys])
        jneg = torch.stack([sum(jb[KP + 2 * i + 1] for i in self.groups[k]) for k in self.keys])
        self.BJ = torch.cat([jb[:KP], jpos, jneg]).reshape(KP + 2 * G, -1).to(FT)
        self.V0 = M.template_vertices.reshape(-1).to(FT); self.J0 = M.template_bone_heads.reshape(-1).to(FT)
        self.G = G
        # roughness of the offsets the local changes add: uniform graph Laplacian of the skin, applied to each local basis shape
        e = np.unique(np.sort(np.concatenate([F_MAIN[:, [0, 1]], F_MAIN[:, [1, 2]], F_MAIN[:, [2, 0]]]), 1), axis=0)
        A_ = sp.coo_matrix((np.ones(2 * len(e)), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(N, N)).tocsr(); deg = np.maximum(np.asarray(A_.sum(1)).ravel(), 1)
        Lp = sp.identity(N, format="csr") - sp.diags(1 / deg) @ A_
        Bl = torch.cat([pos, neg]).numpy()                                        # (2G, N, 3)
        self.BLap = torch.tensor(np.stack([(Lp @ Bl[:, :, a].T).T for a in range(3)], -1).reshape(2 * G, -1), dtype=FT)
        self.fatmus = torch.tensor([1.0 if ("fat" in k or "muscle" in k or "tone" in k) else 0.0 for k in self.keys])
    def phen(self, praw):
        """praw (B,4) free -> Anny's six phenotypes (B,6): gender fixed, age fixed at 'young' (the 25-year anchor)."""
        s = torch.sigmoid(praw)
        B = praw.shape[0]; one = torch.ones(B, dtype=praw.dtype)
        gender = one * (0.0 if self.sex == "male" else 1.0)          # Anny: 0 = male, 1 = female (PHENOTYPE_VARIATIONS)
        lo, hi = -0.15, 1.15
        cols = {"gender": gender, "age": one * (2 / 3), "muscle": lo + (hi - lo) * s[:, 0], "weight": lo + (hi - lo) * s[:, 1],
                "height": lo + (hi - lo) * s[:, 2], "proportions": s[:, 3]}
        return torch.stack([cols[k] for k in M.phenotype_labels], 1)
    def coefs(self, praw, lraw):
        ph = self.phen(praw).double()
        wi = PH.phenotype_blendshape_weights(ph, M.phenotype_labels, M.anchors, M.stacked_phenotype_blend_shapes_mask, extrapolate=True)
        wi = (wi @ M.phenotype_blendshape_projection).to(FT)
        l = 1.3 * torch.tanh(lraw)
        return torch.cat([wi, l * (l >= 0).to(l.dtype), -l * (l <= 0).to(l.dtype)], 1)   # gradient 1 at zero on both sides, as Anny does
    def body(self, c):
        B = c.shape[0]
        return (self.V0 + c @ self.BV).reshape(B, N, 3), (self.J0 + c @ self.BJ).reshape(B, len(BL), 3)

# ------------------------------------------------------------------ the survey
META = ("gender", "date", "installation", "component", "branch", "primarymos", "subjectsbirthlocation", "ethnicity", "writingpreference")
def ansur(sex):
    """All numeric columns as a dict of arrays, in metres (weight in kg)."""
    rows = list(csv.reader(open(f"{ROOT}private/ansur2/ANSUR_II_{sex.upper()}_Public.csv", encoding="latin1")))
    head = [h.strip().lower() for h in rows[0]]
    D = {}
    for i, h in enumerate(head):
        if h in META: continue
        x = np.array([float(r[i]) for r in rows[1:]])
        D[h] = x / 10 if h == "weightkg" else (x if h in ("subjectid", "age", "heightin", "weightlbs", "subjectnumericrace", "dodrace") else x / 1000)
    return D

# the project's 39 dimensions (shared/body.ts DIMS) minus thumbtipreach (a reach in a posture, not a body dimension the
# standing mesh has), plus five standing dimensions that pin what the seated ones are derived from.
DIMS = ["stature", "sittingheight", "eyeheightsitting", "acromialheight", "biacromialbreadth", "acromionradialelength", "radialestylionlength",
        "handlength", "buttockkneelength", "buttockdepth", "poplitealheight", "kneeheightsitting", "lateralmalleolusheight", "footlength",
        "balloffootlength", "hipbreadthsitting", "chestdepth", "bideltoidbreadth", "chestbreadth", "chestcircumference", "waistbreadth",
        "waistdepth", "waistcircumference", "buttockcircumference", "neckcircumference", "headlength", "headbreadth", "tragiontopofhead",
        "bicepscircumferenceflexed", "forearmcircumferenceflexed", "wristcircumference", "handbreadth", "thighcircumference",
        "lowerthighcircumference", "calfcircumference", "anklecircumference", "footbreadthhorizontal", "weightkg"]
EXTRA = ["crotchheight", "lateralfemoralepicondyleheight", "hipbreadth", "waistheightomphalion", "chestheight"]
ALL = DIMS + EXTRA
W_EXTRA = 0.3
# constants that are not mesh geometry (each is a documented assumption or a survey statistic; see REPORT.md)
SIT_OFFSET = {"male": 0.0080, "female": 0.0104}       # survey mean of sittingheight - (stature - crotchheight)
HIPSIT = {"male": (-0.021958, 1.161), "female": (0.002295, 1.121)}   # survey regression hipbreadthsitting ~ hipbreadth
FLEX_BICEPS = {"male": 1.085, "female": 1.05}         # flexed / relaxed upper-arm girth (assumed, anthropometry norms from memory)
FLEX_FOREARM = {"male": 1.03, "female": 1.03}         # clenched-fist forearm / relaxed (assumed)
LUNG_GAS = {"male": (0.0030, 1.756), "female": (0.0024, 1.629)}  # litres of gas in the scanned-surface volume at mean stature (assumed), scales with stature^3

# ------------------------------------------------------------------ the reference body the tape paths are cut on
def reference():
    b = Basis("male"); pr = torch.zeros(1, 4)
    ph = torch.tensor([[0.5 if k != "age" else 2 / 3 for k in M.phenotype_labels]], dtype=torch.float64)
    wi = (PH.phenotype_blendshape_weights(ph, M.phenotype_labels, M.anchors, M.stacked_phenotype_blend_shapes_mask, extrapolate=True) @ M.phenotype_blendshape_projection).to(FT)
    c = torch.cat([wi, torch.zeros(1, 2 * b.G)], 1); V, H = b.body(c)
    return V[0].numpy().astype(np.float64), H[0].numpy().astype(np.float64)
R, HR = reference()
J = lambda b: HR[BI[b]]
_edges = np.unique(np.sort(np.concatenate([F_MAIN[:, [0, 1]], F_MAIN[:, [1, 2]], F_MAIN[:, [2, 0]]]), 1), axis=0)

def slice_plane(p0, n, sel=None, near=None, rmax=None):
    """Cut the reference skin with the plane (p0, n): the fixed edge points (a, b, t) of the loop nearest to `near`."""
    n = np.asarray(n, float) / np.linalg.norm(n); d = (R - p0) @ n
    ok = np.ones(N, bool) if sel is None else sel
    if rmax is not None: ok = ok & (np.linalg.norm((R - p0) - np.outer(d, n), axis=1) < rmax)
    a, b = _edges[:, 0], _edges[:, 1]
    m = ok[a] & ok[b] & ((d[a] > 0) != (d[b] > 0))
    a, b = a[m], b[m]; t = d[a] / (d[a] - d[b]); P = R[a] + t[:, None] * (R[b] - R[a])
    # connect crossing edges that share a face
    key = {(int(x), int(y)): i for i, (x, y) in enumerate(zip(a, b))}
    rr, cc = [], []
    for f in F_MAIN:
        e = [key.get((min(f[i], f[j]), max(f[i], f[j]))) for i, j in ((0, 1), (1, 2), (2, 0))]
        e = [x for x in e if x is not None]
        if len(e) == 2: rr.append(e[0]); cc.append(e[1])
    nc, lab = connected_components(sp.coo_matrix((np.ones(len(rr)), (rr, cc)), shape=(len(a), len(a))), directed=False)
    q = p0 if near is None else near
    best = lab[np.argmin(np.linalg.norm(P - q, axis=1))] if near is not None else min(range(nc), key=lambda c: np.linalg.norm(P[lab == c].mean(0) - q))
    k = lab == best
    return {"a": a[k].astype(np.int64), "b": b[k].astype(np.int64), "t": t[k]}

def build_spec():
    S = {"slices": {}, "verts": {}, "sets": {}}
    L = lambda v: v[:, 0] > 0.004
    TORSOLEG = dmask("spine", "root", "clavicle", "pelvis", "shoulder", "neck", "upperleg", "breast")
    zmin, zmax = R[MAIN, 2].min(), R[MAIN, 2].max()
    def blend_vertex(label, side=True):
        d = M.blendshapes[KP + 2 * LAB.index(label)].norm(dim=1).numpy().copy(); d[~MAIN] = 0
        if side: d[R[:, 0] <= 0] = 0
        return int(d.argmax())
    def pick(sel, score):
        idx = np.where(sel)[0]; return int(idx[np.argmax(score(R[idx]))])
    V = S["verts"]; T = S["sets"]; SL = S["slices"]
    # ---- landmarks
    V["nipple"] = blend_vertex("nipple-size-incr"); V["navel"] = blend_vertex("stomach-navel-out", side=False)
    if ACR_V2:   # the lateral end of the shoulder girdle above the shoulder joint: the outermost top vertex that follows the arm by less than half
        for s_, sg in (("L", 1.0), ("R", -1.0)):
            jt = J(f"upperarm01.{s_}"); thr = float(os.environ.get("RP_ACR_W", "0.65"))
            sel = MAIN & (R[:, 0] * sg > 0.004) & (ARMW[s_] < thr) & (R[:, 2] > jt[2] + 0.025) & (np.abs(R[:, 1] - jt[1]) < 0.03)
            V["acromion" + s_] = pick(sel, lambda q: np.abs(q[:, 0]) + 0.3 * q[:, 2])
    else:
        V["acromionL"] = pick(dmask("shoulder01.L", "clavicle.L", "upperarm01.L") & L(R), lambda q: q[:, 2] + 0.6 * np.abs(q[:, 0]))
        V["acromionR"] = pick(dmask("shoulder01.R", "clavicle.R", "upperarm01.R") & (R[:, 0] < -0.004), lambda q: q[:, 2] + 0.6 * np.abs(q[:, 0]))
    hip, knee, ank = J("upperleg01.L"), J("lowerleg01.L"), J("foot.L")
    crotch_set = np.where(dmask("root", "pelvis", "spine05", "upperleg") & (np.abs(R[:, 0]) < 0.012) & (R[:, 2] < hip[2]))[0]
    T["crotch"] = crotch_set; zc = R[crotch_set, 2].min()
    V["buttock"] = pick(dmask("root", "pelvis", "spine05", "upperleg") & L(R) & (R[:, 2] > zc) & (R[:, 2] < hip[2] + 0.10), lambda q: q[:, 1])
    T["hips"] = np.where(dmask("root", "pelvis", "spine05", "spine04", "upperleg") & (R[:, 2] > zc + 0.01) & (R[:, 2] < hip[2] + 0.10))[0]
    T["buttocks"] = np.where(dmask("root", "pelvis", "spine05", "upperleg") & (R[:, 2] > zc - 0.02) & (R[:, 2] < hip[2] + 0.10) & (R[:, 1] > hip[1]))[0]
    foot = dmask("foot.L", "toe") & L(R); T["foot"] = np.where(foot)[0]
    T["top"] = np.where(dmask("head") & (R[:, 2] > zmax - 0.05))[0]
    V["malleolus"] = pick(dmask("lowerleg", "foot.L") & L(R) & (np.abs(R[:, 2] - ank[2]) < 0.012), lambda q: q[:, 0])
    ear = (M.blendshapes[KP + 2 * LAB.index("l-ear-scale-incr")].norm(dim=1).numpy() > 1e-4) & MAIN
    ear_any = ear | ((M.blendshapes[KP + 2 * LAB.index("r-ear-scale-incr")].norm(dim=1).numpy() > 1e-4) & MAIN)
    ez = R[ear, 2]; mid = ear & (R[:, 2] > ez.min() + 0.3 * np.ptp(ez)) & (R[:, 2] < ez.min() + 0.5 * np.ptp(ez))
    V["tragion"] = pick(mid, lambda q: -q[:, 1])
    eye = J("eye.L")
    T["skull"] = np.where(dmask("head") & ~ear_any & (R[:, 2] > eye[2] + 0.015))[0]
    T["deltoids"] = np.where(dmask("shoulder01", "upperarm01", "clavicle") & (R[:, 2] > J("upperarm01.L")[2] - 0.10))[0]
    T["mid3"] = np.where(dmask("finger3-3.L"))[0]
    mcp = np.stack([J(f"finger{k}-1.L") for k in (2, 3, 4, 5)])
    T["meta"] = np.where(MAIN & L(R) & (np.linalg.norm(R[:, None] - mcp[None], axis=2).min(1) < 0.017))[0]
    T["patella"] = np.where(dmask("upperleg", "lowerleg") & L(R) & (np.abs(R[:, 2] - knee[2]) < 0.035) & (R[:, 1] < knee[1]))[0]
    # ---- tape paths: horizontal on the trunk, across the limb axis on the limbs
    ctr = lambda z: np.array([0.0, R[TORSOLEG & (np.abs(R[:, 2] - z) < 0.01), 1].mean(), z])
    up = np.array([0, 0, 1.0])
    for name, v in (("chest", "nipple"), ("waist", "navel"), ("buttock", "buttock")):
        z = R[V[v], 2]; SL[name] = slice_plane(ctr(z), up, sel=TORSOLEG)
    zb = R[V["buttock"], 2]
    for i, dz in enumerate((-0.03, -0.015, 0.0, 0.015, 0.03)): SL[f"buttock{i}"] = slice_plane(ctr(zb + dz), up, sel=TORSOLEG)
    na, nb = J("neck01"), J("head"); SL["neck"] = slice_plane(na + 0.42 * (nb - na), nb - na, sel=MAIN, rmax=0.11)
    def limb(prefix, A, B, ts, sel, rmax=0.16):
        for i, t in enumerate(ts): SL[f"{prefix}{i}"] = slice_plane(A + t * (B - A), B - A, sel=sel, near=None, rmax=rmax)
        return len(ts)
    left = MAIN & L(R)
    S["counts"] = {
        "deltoid": limb("deltoid", J("upperarm01.L"), J("lowerarm01.L"), (0.12, 0.2, 0.28, 0.36), left & dmask("shoulder01.L", "upperarm", "clavicle.L"), 0.11),
        "biceps": limb("biceps", J("upperarm01.L"), J("lowerarm01.L"), (0.4, 0.5, 0.6), left, 0.10),
        "forearm": limb("forearm", J("lowerarm01.L"), J("wrist.L"), (0.15, 0.2, 0.25, 0.3), left, 0.09),
        "wrist": limb("wrist", J("lowerarm01.L"), J("wrist.L"), (0.90, 0.95), left, 0.07),
        "calf": limb("calf", knee, ank, (0.25, 0.3, 0.35, 0.4), left, 0.13),
        "ankle": limb("ankle", knee, ank, (0.80, 0.84, 0.88), left, 0.09),
        "lowerthigh": limb("lowerthigh", hip, knee, (0.86,), left, 0.14),
    }
    # the thigh at the gluteal furrow: across the thigh axis, 25 mm below the crotch point
    tcr = (zc - 0.025 - hip[2]) / (knee[2] - hip[2])
    SL["thigh0"] = slice_plane(hip + tcr * (knee - hip), knee - hip, sel=left & dmask("upperleg", "pelvis", "root"), rmax=0.2)
    return S
SPEC = build_spec()
FM = torch.tensor(F_MAIN)
_ANG = torch.linspace(0, 2 * math.pi, 121)[:-1]; _DIR = torch.stack([torch.cos(_ANG), torch.sin(_ANG)], 1)   # 120 directions

def tape(Q2):
    """Length of a taut tape around the points Q2 (B, K, 2): the convex-hull perimeter by Cauchy's formula
    (mean width × π), 120 directions; differentiable and the same six lines in JS."""
    return (Q2 @ _DIR.T).max(1)[0].sum(1) * (2 * math.pi / len(_ANG))
def spts(V, name):
    s = SPEC["slices"][name]; t = torch.tensor(s["t"], dtype=V.dtype)[None, :, None]
    return V[:, s["a"]] * (1 - t) + V[:, s["b"]] * t
def unit(v): return v / v.norm(dim=-1, keepdim=True)
def across(P, A, B):
    """Coordinates of points P (B,K,3) in the plane across the axis A->B (B,3)."""
    u = unit(B - A); ref = torch.tensor([0.0, 1.0, 0.0], dtype=P.dtype).expand_as(u)
    e1 = unit(torch.linalg.cross(u, ref)); e2 = torch.linalg.cross(u, e1)
    d = P - A[:, None]; return torch.stack([(d * e1[:, None]).sum(-1), (d * e2[:, None]).sum(-1)], -1)

def measure(V, H, sex):
    """All dimensions (ALL, metres; weight kg) of a batch of standing rest bodies V (B,N,3) with joint heads H (B,104,3)."""
    Sv, St = SPEC["verts"], SPEC["sets"]; m = {}
    j = lambda b: H[:, BI[b]]
    hip, knee, ank = j("upperleg01.L"), j("lowerleg01.L"), j("foot.L")
    foot = V[:, St["foot"]]; sole = foot[..., 2].min(1)[0]
    # heights are taken with the legs straightened under the hips (the rest pose stands with the feet apart)
    leg = (knee - hip).norm(dim=1) + (ank - knee).norm(dim=1) + (ank[:, 2] - sole)
    ht = lambda z: z - hip[:, 2] + leg
    top = V[:, St["top"], 2].max(1)[0]
    crotch = V[:, St["crotch"], 2].min(1)[0]
    m["stature"] = ht(top)
    m["crotchheight"] = ht(crotch)
    m["sittingheight"] = top - crotch + SIT_OFFSET[sex]
    m["eyeheightsitting"] = m["sittingheight"] - (top - j("eye.L")[:, 2])
    acL, acR = V[:, Sv["acromionL"]], V[:, Sv["acromionR"]]
    sh, el, wr = j("upperarm01.L"), j("lowerarm01.L"), j("wrist.L")
    el_arm = el
    if ACR_V2:
        # arms hanging, as the survey measures: turn each arm about its shoulder joint, in the frontal plane, until the upper arm points down,
        # and move the landmark by its skinning share of that turn (linear blend skinning of one joint)
        def lowered(q, p, e, sg, w):
            d = e - p; th = -torch.atan2(d[:, 0] * sg, -d[:, 2]) * sg; c_, s_ = torch.cos(th), torch.sin(th); r = q - p
            rot = torch.stack([c_ * r[:, 0] - s_ * r[:, 2], r[:, 1], s_ * r[:, 0] + c_ * r[:, 2]], 1) + p
            return q + w * (rot - q)
        shR_, elR_ = j("upperarm01.R"), j("lowerarm01.R")
        acL = lowered(acL, sh, el, 1.0, float(ARMW["L"][Sv["acromionL"]])); acR = lowered(acR, shR_, elR_, -1.0, float(ARMW["R"][Sv["acromionR"]]))
        el_arm = lowered(el, sh, el, 1.0, 1.0)
    m["acromialheight"] = ht(acL[:, 2]); m["biacromialbreadth"] = (acL - acR).norm(dim=1)
    m["acromionradialelength"] = ((el_arm - acL) * unit(el_arm - sh)).sum(1)
    m["radialestylionlength"] = (wr - el).norm(dim=1)
    hax = unit(j("finger3-1.L") - wr)
    m["handlength"] = ((V[:, St["mid3"]] - wr[:, None]) * hax[:, None]).sum(-1).max(1)[0]
    bax = unit(j("finger5-1.L") - j("finger2-1.L")); mh = (V[:, St["meta"]] * bax[:, None]).sum(-1)
    m["handbreadth"] = mh.max(1)[0] - mh.min(1)[0]
    fa = j("toe2-1.L") - ank; fa = unit(torch.cat([fa[:, :2], torch.zeros_like(fa[:, :1])], 1)); fp = torch.stack([-fa[:, 1], fa[:, 0], fa[:, 2]], 1)
    along = (foot * fa[:, None]).sum(-1); side = (foot * fp[:, None]).sum(-1)
    m["footlength"] = along.max(1)[0] - along.min(1)[0]; m["footbreadthhorizontal"] = side.max(1)[0] - side.min(1)[0]
    m["balloffootlength"] = (j("toe1-1.L") * fa).sum(1) - along.min(1)[0]
    m["lateralmalleolusheight"] = V[:, Sv["malleolus"], 2] - sole
    kneeh = (ank - knee).norm(dim=1) + (ank[:, 2] - sole)
    m["lateralfemoralepicondyleheight"] = kneeh
    # trunk
    ch = spts(V, "chest")[..., :2]; m["chestcircumference"] = tape(ch)
    m["chestbreadth"] = ch[..., 0].max(1)[0] - ch[..., 0].min(1)[0]; m["chestdepth"] = ch[..., 1].max(1)[0] - ch[..., 1].min(1)[0]
    m["chestheight"] = ht(V[:, Sv["nipple"], 2])
    ws = spts(V, "waist")[..., :2]; m["waistcircumference"] = tape(ws)
    m["waistbreadth"] = ws[..., 0].max(1)[0] - ws[..., 0].min(1)[0]; m["waistdepth"] = ws[..., 1].max(1)[0] - ws[..., 1].min(1)[0]
    m["waistheightomphalion"] = ht(V[:, Sv["navel"], 2])
    if os.environ.get("RP_BUTTOCK", "v1") == "v2":
        bl = [spts(V, f"buttock{i}")[..., :2] for i in range(5)]
        m["buttockcircumference"] = torch.stack([tape(q) for q in bl], 1).max(1)[0]
        m["buttockdepth"] = torch.stack([q[..., 1].max(1)[0] - q[..., 1].min(1)[0] for q in bl], 1).max(1)[0]
    else:
        bs = spts(V, "buttock")[..., :2]; m["buttockcircumference"] = tape(bs); m["buttockdepth"] = bs[..., 1].max(1)[0] - bs[..., 1].min(1)[0]
    # widest point of the hips, with the spread of the legs in the rest stance taken out below the hip joints
    hp = V[:, St["hips"]]; splay = (knee[:, 0] - hip[:, 0]) / (hip[:, 2] - knee[:, 2])
    m["hipbreadth"] = 2 * (hp[..., 0].abs() - torch.relu(hip[:, None, 2] - hp[..., 2]) * splay[:, None]).max(1)[0]
    a, b = HIPSIT[sex]; m["hipbreadthsitting"] = a + b * m["hipbreadth"]
    # arms hang in the survey; the rest pose holds them out, so: the distance between the shoulder joints plus twice the
    # reach of the deltoid surface from the arm axis, on the outer side, across the arm
    shR = j("upperarm01.R")
    dr = torch.stack([across(spts(V, f"deltoid{i}"), sh, el)[..., 0].max(1)[0] for i in range(SPEC["counts"]["deltoid"])], 1).max(1)[0]
    m["bideltoidbreadth"] = (sh[:, 0] - shR[:, 0]) + 2 * dr
    m["neckcircumference"] = tape(across(spts(V, "neck"), j("neck01"), j("head")))
    sk = V[:, St["skull"]]; m["headlength"] = sk[..., 1].max(1)[0] - sk[..., 1].min(1)[0]; m["headbreadth"] = sk[..., 0].max(1)[0] - sk[..., 0].min(1)[0]
    m["tragiontopofhead"] = top - V[:, Sv["tragion"], 2]
    # limbs
    girths = lambda pre, A, B: torch.stack([tape(across(spts(V, f"{pre}{i}"), A, B)) for i in range(SPEC["counts"][pre])], 1)
    m["bicepscircumferenceflexed"] = FLEX_BICEPS[sex] * girths("biceps", sh, el).max(1)[0]
    m["forearmcircumferenceflexed"] = FLEX_FOREARM[sex] * girths("forearm", el, wr).max(1)[0]
    m["wristcircumference"] = girths("wrist", el, wr).min(1)[0]
    m["calfcircumference"] = girths("calf", knee, ank).max(1)[0]
    m["anklecircumference"] = girths("ankle", knee, ank).min(1)[0]
    lt = across(spts(V, "lowerthigh0"), hip, knee); m["lowerthighcircumference"] = tape(lt)
    m["thighcircumference"] = tape(across(spts(V, "thigh0"), hip, knee))
    # seated dimensions by rigid composition of the standing body (thigh horizontal, shank vertical)
    kd = across(knee[:, None], hip, knee)[:, 0]                       # the knee centre in the lower-thigh plane (e2 points backward)
    m["kneeheightsitting"] = kneeh + (kd[:, 1] - lt[..., 1].min(1)[0])
    m["poplitealheight"] = kneeh - (lt[..., 1].max(1)[0] - kd[:, 1])
    femur = (knee - hip).norm(dim=1)
    m["buttockkneelength"] = femur + (V[:, St["buttocks"], 1].max(1)[0] - hip[:, 1]) + (knee[:, 1] - V[:, St["patella"], 1].min(1)[0])
    # weight: skin volume minus lung gas, times the body density the US Navy circumference equations give for this body
    vol = (torch.linalg.cross(V[:, FM[:, 0]], V[:, FM[:, 1]], dim=-1) * V[:, FM[:, 2]]).sum((1, 2)).abs() / 6
    g0, s0 = LUNG_GAS[sex]; gas = g0 * (m["stature"] / s0) ** 3
    cm = lambda x: torch.clamp(x * 100, min=5.0)
    if sex == "male": rho = 1.0324 - 0.19077 * torch.log10(cm(m["waistcircumference"] - m["neckcircumference"])) + 0.15456 * torch.log10(cm(m["stature"]))
    else: rho = 1.29579 - 0.35004 * torch.log10(cm(m["waistcircumference"] + m["buttockcircumference"] - m["neckcircumference"])) + 0.22100 * torch.log10(cm(m["stature"]))
    m["weightkg"] = (vol - gas) * rho * 1000
    m["_volume"] = vol; m["_density"] = rho * 1000
    return m

if __name__ == "__main__":
    for sex in ("male", "female"):
        b = Basis(sex); D = ansur(sex)
        V, H = b.body(b.coefs(torch.zeros(1, 4), torch.zeros(1, b.G)))
        m = measure(V, H, sex)
        print(sex, "locals", b.G, "| neutral body vs survey mean (mm / kg)")
        for d in ALL: print(f"   {d:32s} {float(m[d]) * (1 if d == 'weightkg' else 1000):8.1f}  {D[d].mean() * (1 if d == 'weightkg' else 1000):8.1f}")
        print("   volume L", float(m["_volume"]) * 1000, "density", float(m["_density"]))
    print({k: len(v["a"]) for k, v in SPEC["slices"].items()}); print({k: len(v) for k, v in SPEC["sets"].items()}, SPEC["verts"])
