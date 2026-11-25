"""Direction 1, "The Operator": the shared body with the head kit and a WARDROBE of swappable garments.  Owner: B2.

    PY=$MANIKIN_PYTHON
    $PY -I pipeline/build_operator.py m                 -> packages/operator-m/  (default outfit + garments/*.glb + maps/mask_*.png)
    $PY -I pipeline/build_operator.py f [light|medium|dark]
    $PY -I pipeline/build_operator.py m --check         also penetration.json over every top x trousers x shoes
    $PY -I pipeline/build_operator.py m --outfit top=shirt_open,trousers=jeans --name probe-b --out B2/cache/probe-b

Body, shape targets, skeleton and weights come from B1's build_body.context().  Every garment is fitted with
mh_wardrobe on the base and on each shape target (deltas by difference), layered by rule (shoes, trousers over
shoes, top over trousers, cap), finished with real edge geometry, and comes with its own body-hide mask.
"""
import sys, os, json, math, time, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
from PIL import Image
import copy, shutil
import mh_core as mh, glb, build_body as bb, rig as rr, eyes
import mh_wardrobe as wd, materials as mt

LAB = mt.LAB; E = mt.PACKS; S = mt.SYS
SETBACK = 0.030       # the skin continues this far inside every opening (VD: 30 mm or more)
MASK_RANGE = 0.016    # mask value 0.5 +- 0.5 over +- this distance around the setback line
EASE = 0.007          # cloth clears the skin by this much at openings
BAKE = os.environ.get("B2_NO_BAKE") is None        # B2_BAKE=1: the body's shape baked on the CPU from <name>.shape.bin (FORMAT.md 2d). Default OFF: with the bake
                                                # B5's lids sit half closed in the viewer (A/B in B2/NOTES.md round 3); the body then carries the 40 shape morphs itself
NECK_SETBACK = 0.030  # under the collar band the skin continues this far below the band's top edge
B8_TROUSERS_FOLD = os.path.join(__import__("labpaths").LAB, "B8", "baked", "candidate", "garment_trousers_work_fold_stand_n.jpg")   # B8 round 1
SOLE_BAND = 0.0165
KNEE_BODY = True      # round 6: round the knees the trousers take the bound body vertices' skinning
CHECK_PERSONS = ("M50", "M95H", "F05", "M50_HEAVY", "F50_HEAVY")   # round 6: the heavy builds too (the waistband stub was on F50_HEAVY)
LENS_ALPHA = 0.03    # round 11: black at 3 % (round 6: white at 1.5 %, which veiled a dark face)
B8_FADE = (0.12, 0.22) # round 6: B8's fold map is flat up to 120 mm above the hem and whole from 220 mm (at 60/140 scuffs stayed)
WAIST_EXTRA = 0.004
CAP_RIM_RULE = os.environ.get("B2_CAP_RIM") is not None
HAIR_OFF_SKIN = 0.004 # round 8: hair at least this far off the skin (the front strands lay on the cheek)
CAP_HAIR_IN = 0.006   # round 7: hair under the cap is drawn this far inside its surface (4 mm left a few specks through it)
TAIL_MAX = 0.025      # round 10: at most this much lift (the heavy builds' larger drop crumpled under the belly)
TAIL_BAND = 0.20      # round 10: the lift fades out over this height above the hem (round 9: 90 mm, saw teeth)
HEM_LINE_PASSES = 4   # round 10: Laplacian passes along the shirt's hem loop after the lift
TAIL_LIFT = float(os.environ.get("B2_TAIL_LIFT", 0.7))   # round 8: the front shirttail raised by this share of its drop below the sides
HEM_TUCK = float(os.environ.get("B2_HEM_TUCK", 0.0))    # round 10: off (with the lift it crumpled the heavy builds' front under the belly)      # round 7: near its hem the shirt is drawn to within this of the nearest trouser point (0 = off)
CUFF_EXTRA = float(os.environ.get("B2_CUFF_EXTRA", 0.004))    # round 7: extra ease over the skin at the cuffs
TOP_PIECE_MIN = 50    # round 11: small pieces of a top with fewer vertices go (the buttonhole patches and thread crosses; the button discs stay)
BUTTON_LIFT = 0.0012  # round 11: the button discs sit this far off the cloth under them, and ride on it rigidly
CUFF_SMOOTH = int(os.environ.get("B2_CUFF_SMOOTH", 12)); CUFF_SMOOTH_R = 0.05; CUFF_LOOP_PASSES = 4   # round 11: the cuff-end tab
CUFF_PIECE_R = 0.045  # round 7: small pieces this close to a cuff loop are left out
HEM_LIE = 0.0         # round 6: near its hem the shirt would lie this far over the trousers at most; 0 = off (tried at 11 mm: the
                      # front tail stands off where the trousers recede at the crotch, out of the clearance's reach; it did not move)   # round 6: the shirt clears the trousers by LAYER + this
RELAX_Z = tuple(float(x) for x in os.environ.get("B2_RELAX_Z", "0.20,0.34").split(","))   # round 7 (round 6: 0.10,0.22)
HEM_RELAX = 24        # round 6: Taubin passes on the trouser leg above the shoe (to 100-220 mm above it)    # height of the pack boot's sole band above its bottom
TRAINER_MAP = 1024    # round 11 (REVIEW-07 item 6: "the trainer maps at 1024 first"): B6's 2048 trainer maps resized (it is at most 0.3 m wide on screen at 1.5 m)
CAP_TILT = 2.0        # degrees the cap is turned back about its rear rim (brim a finger above the brows)
LAYER = 0.005         # cloth clears the layer under it by this much (was 0.003 until round 3)
HEAD_KIT = {
    "brows": (S + "/eyebrows/eyebrow001/eyebrow001.mhclo", "CC0-1.0", "MakeHuman team", "eyebrow001 (its texture painted into the skin albedo; no card mesh)"),
    "hair": (S + "/hair/short04/short04.mhclo", "CC0-1.0", "MakeHuman team", "short04 (used only as the painted hairline's shape)"),
}
MHC = "http://www.makehumancommunity.org"
# id -> spec. Order = layer order (inner first). `over`: slots whose every option this garment must stay outside of.
GARMENTS = {
    "trousers.work": dict(label="Work trousers", src=E + "/pants02_ccby/clothes/mindfront_male_trousers_2/mindfront_male_trousers_2.mhclo", licence="CC-BY-4.0", author="Mindfront", title="Male trousers 2", url=MHC,
                          klass="cloth", size=1024, colours={"charcoal": (58, 60, 66), "navy": (44, 52, 74), "stone": (150, 142, 128)}, over=["shoes"], rim=dict(min_loop=30), fabric="denim"),
    "top.shirt": dict(label="Work shirt, buttoned, worn out", src=E + "/shirts02_ccby/clothes/elvs_male_shirt_untucked_bd1/elvs_male_shirt_untucked_bd1.mhclo", licence="CC-BY-4.0", author="Elvaerwyn", title="Male shirt untucked BD1", url=MHC,
                      klass="cloth", size=1024, worn="out", colours={"slate": (72, 92, 118), "petrol": (56, 92, 100), "graphite": (74, 76, 80), "sand": (176, 160, 132)}, over=["trousers"], rim=dict(min_loop=24), seams=False, fabric="linen", form=True, pockets=True, subdiv=True),
    "cap.work_cap": dict(label="Work cap", src=E + "/hats01_cc0/clothes/toigo_maga_hat/toigo_maga_hat.mhclo", licence="CC0-1.0 (mesh only; its slogan texture is not used)", author="toigo", title="Cap (mesh)", url=MHC,
                         klass="cloth", size=512, colours={"graphite": (62, 64, 68), "slate": (58, 72, 84), "sand": (168, 154, 128)}, mask=False, plain_tex=True, fabric="denim", stiff=True),   # round 6: twill, not the jersey scan (its crumple read as wrinkles on the crown)
    "glasses.safety_clear": dict(label="Clear glasses", src=E + "/glasses01_cc0/clothes/spamrakuen_sagerfrogs_glasses_03/spamrakuen_sagerfrogs_glasses_03.mhclo", licence="CC0-1.0", author="spamrakuen", title="Sagerfrog's glasses 03", url=MHC,
                                 klass="plain", mask=False, colours={"graphite": (60, 62, 66)}),
}
DEFAULT = {"shoes": "safety_trainer", "trousers": "work", "top": "shirt", "cap": "work_cap", "glasses": "safety_clear"}
OPTIONAL = ("glasses", "headset")      # the cap is NOT optional (VD/REVIEW-04, HF16: no bare head until real hair exists)
# ONE outfit in colourways (VD/REVIEW-04): shirt, work trousers, B6's safety trainer, cap; headset and glasses on or off.
_ALL = {"top": "shirt", "trousers": "work", "shoes": "safety_trainer", "cap": "work_cap"}
OUTFITS = [
    dict(id="operator", label="Operator, slate: headset, glasses", pick={**_ALL, "glasses": "safety_clear", "headset": "operator_headset"}, colours={"top": "slate", "trousers": "charcoal", "cap": "graphite"}),
    dict(id="operator_petrol", label="Operator, petrol: headset", pick={**_ALL, "headset": "operator_headset"}, colours={"top": "petrol", "trousers": "charcoal", "cap": "slate"}),
    dict(id="operator_dark", label="Operator, all dark: headset, glasses", pick={**_ALL, "glasses": "safety_clear", "headset": "operator_headset"}, colours={"top": "graphite", "trousers": "navy", "cap": "graphite"}),
    dict(id="operator_sand", label="Operator, sand and stone: glasses", pick={**_ALL, "glasses": "safety_clear"}, colours={"top": "sand", "trousers": "stone", "cap": "sand"}),
]
# round 11 (REVIEW-07 item 5): per-tone skin finish. blotch_px: the band (sigma, texels of 2048) of colour patches evened out on the head;
# chroma / luma: how much of that band goes; rough_*: roughness added overall and the floors on the lower face and the lips
# clearcoat / clearcoatRoughness (round 12, RL's per-package field on materials.skin_body; light keeps the viewer's 0.22 / 0.28): the
# skin's thin oily coat, which read as a wet film on the dark tone's lips and chin
TONE_SKIN = {"dark": dict(blotch_px=(5.0, 140.0), chroma=0.90, luma=0.50, rough_add=0.08, rough_face=0.80, rough_lips=0.68, clearcoat=0.08, clearcoatRoughness=0.5),
             "medium": dict(blotch_px=(5.0, 80.0), chroma=0.35, luma=0.15, rough_add=0.04, rough_face=0.72, rough_lips=0.64, clearcoat=0.15, clearcoatRoughness=0.39)}
TONES = {"light": dict(hair=(44, 33, 27), brow=(58, 44, 36)), "medium": dict(hair=(30, 23, 19), brow=(40, 30, 25)), "dark": dict(hair=(16, 13, 12), brow=(20, 16, 14))}
BROW_F = "eyebrows/eyebrow007/eyebrow007.mhclo"      # thinner than eyebrow001 (the man's); CC0, MakeHuman system assets
HUG = 0.003           # under the worn-out shirt the trousers lie this close to the skin (waistband, pockets and loops never reach the shirt)


def log(*a): print("[operator]", *a, flush=True)
def slot_of(gid): return gid.split(".")[0]
def mesh_name(gid): return ("shoe_" if slot_of(gid) == "shoes" else "garment_") + gid.replace(".", "_")
def mat_name(gid): return GARMENTS[gid]["klass"].replace("plain", "frame") + "_" + gid.replace(".", "_")


def compact(t):
    used = np.unique(t); remap = np.full(used.max() + 1, -1, dtype=np.int64); remap[used] = np.arange(len(used))
    return used, remap[t]


def ramp(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ posing (checks only)
def rot_axis(axis, deg):
    a = np.asarray(axis, float); a = a / np.linalg.norm(a); t = math.radians(deg); c, s = math.cos(t), math.sin(t)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + s * K + (1 - c) * K @ K


def pose_matrices(man, names, parent, heads, dofvals):
    rots = {}
    for d in man["dofs"]:
        v = dofvals.get(d["id"], 0.0)
        if v: b = names.index(d["joint"]); rots[b] = rots.get(b, np.eye(3)) @ rot_axis(d["axis"], v)
    B = len(heads); G = np.zeros((B, 4, 4))
    for b in range(B):
        L = np.eye(4)
        if b in rots: R = rots[b]; L[:3, :3] = R; L[:3, 3] = heads[b] - R @ heads[b]
        G[b] = L if parent[b] < 0 else G[parent[b]] @ L
    return G


def lbs(v, W, G):
    A = (W @ G.reshape(len(G), 16)).reshape(-1, 4, 4)
    return np.einsum("nij,nj->ni", A[:, :3, :3], v) + A[:, :3, 3]


def clinical(man, angles, both=False):
    P = man["packet"]; d = dict(P.get("neutral", {}))
    for k, v in angles.items():
        for dof, f in P["angles"][k].items():
            d[dof] = d.get(dof, 0) + f * v
            if both: d[dof.replace("_R.", "_L.")] = d.get(dof.replace("_R.", "_L."), 0) + f * v
    return d


# ---- round 13 (REVIEW-09 item 1: the shirt at 1.5 m: low-poly collar points, a faceted upper chest, the shoulder ball): the shirt is
# refined once where it faces the camera (collar, yoke, chest, shoulders). A refined asset is linear in the original: every per-vertex
# quantity (fit on any body, skin weights, UVs) is S @ (the asset's), so fits per shape target, morphs and weights stay consistent.
SHIRT_REFINE = os.environ.get("B2_NO_REFINE") is None
HAIR_CAP_P = dict(fringe_jitter=0.08, fringe=0.0065)     # round 13: the strand ends scatter less (0.26 -> 0.08) over a wider fringe (4 -> 6.5 mm)
SUBDIV_BELOW_NECK = 0.30     # the refined region: from the neck joint down this far ...
SUBDIV_SIDE = 0.06           # ... out to this far beyond the shoulder joints, and nothing of the forearm (lower-arm weight < 0.1)
SUBDIV_CORNER_DEG = 50.0     # a boundary vertex turning more than this in FRONT of the torso (a collar point) stays a sharp corner


class SubAsset:
    """A garment asset refined once over a region (see subdivide_once): fit, weights and UVs are S @ the asset's."""
    def __init__(self, a, S, Suv, t, tu):
        self.base = a; self.S = S.tocsr(); self.Suv = Suv.tocsr(); self.uv = self.Suv @ np.asarray(a.uv, float); self._t = t; self._tu = tu
        self.n = S.shape[0]; self.textures = a.textures; self.name = a.name; self.path = a.path; self.dir = a.dir
        self.title = getattr(a, "title", a.name); self.v_obj = self.S @ np.asarray(a.v_obj, float)
    def fit(self, B): return self.S @ self.base.fit(B)
    def weights(self, W): return (self.S @ self.base.weights(W)).tocsr()
    def tris(self): return self._t.copy(), self._tu.copy()


def subdivide_once(t, tu, n_v, n_uv, region, corner):
    """One Loop step over the triangles `region` (welded vertex triangles t, UV triangles tu): red refinement inside (closed under
    'two split edges'), a bisection of the neighbours with one split edge. Positions: Loop's rules where a vertex's or edge's whole
    neighbourhood is refined (boundary rule on boundaries, `corner` vertices fixed), linear elsewhere; UVs linear.
    -> S (n_v + e, n_v), Suv (n_uv + e', n_uv), t_new, tu_new."""
    from collections import defaultdict
    m = len(t); region = region.copy()
    ekey = lambda a, b: np.minimum(a, b) * (n_v + 1) + np.maximum(a, b)
    E = np.stack([ekey(t[:, k], t[:, (k + 1) % 3]) for k in range(3)], 1)          # (m,3): edge k joins corners k, k+1
    while True:
        split = np.unique(E[region]) if region.any() else np.zeros(0, np.int64)
        grow = ~region & (np.isin(E, split).sum(1) >= 2)
        if not grow.any(): break
        region |= grow
    split = np.unique(E[region]); is_split = np.isin(E, split); ns = is_split.sum(1)
    inc = defaultdict(list)
    for i in range(m):
        for k in range(3): inc[int(E[i, k])].append((i, k))
    eid = {int(e): n_v + j for j, e in enumerate(split)}
    rows, cols, vals = [], [], []
    def put(r, cs, ws):
        for c_, w_ in zip(cs, ws): rows.append(r); cols.append(c_); vals.append(w_)
    for e in split:                                                   # new edge vertices
        e = int(e); lst = inc[e]; i0, k0 = lst[0]; a, b = int(t[i0, k0]), int(t[i0, (k0 + 1) % 3])
        if len(lst) == 2 and all(region[i] for i, _ in lst):
            cd = [int(t[i, (k + 2) % 3]) for i, k in lst]; put(eid[e], [a, b, cd[0], cd[1]], [0.375, 0.375, 0.125, 0.125])
        else: put(eid[e], [a, b], [0.5, 0.5])
    nbr = defaultdict(set); bnd = defaultdict(list); vtri = defaultdict(list)
    for i in range(m):
        for k in range(3):
            a, b = int(t[i, k]), int(t[i, (k + 1) % 3]); nbr[a].add(b); nbr[b].add(a); vtri[a].append(i)
    for e, lst in inc.items():
        if len(lst) == 1:
            i, k = lst[0]; a, b = int(t[i, k]), int(t[i, (k + 1) % 3]); bnd[a].append(b); bnd[b].append(a)
    for v in range(n_v):                                              # old vertices
        tris_v = vtri.get(v)
        if not tris_v or corner[v] or not all(region[i] for i in tris_v): put(v, [v], [1.0]); continue
        if v in bnd:
            if len(bnd[v]) == 2: put(v, [v] + bnd[v], [0.75, 0.125, 0.125])
            else: put(v, [v], [1.0])
        else:
            nb = sorted(nbr[v]); k_ = len(nb); beta = 3.0 / 16 if k_ == 3 else 3.0 / (8 * k_)
            put(v, [v] + nb, [1 - k_ * beta] + [beta] * k_)
    S = sp.csr_matrix((vals, (rows, cols)), shape=(n_v + len(split), n_v))
    ukey = lambda a, b: np.minimum(a, b) * (n_uv + 1) + np.maximum(a, b)
    U = np.stack([ukey(tu[:, k], tu[:, (k + 1) % 3]) for k in range(3)], 1)
    usplit = np.unique(U[is_split]); uid = {int(e): n_uv + j for j, e in enumerate(usplit)}
    ur, uc, uvv = list(range(n_uv)), list(range(n_uv)), [1.0] * n_uv
    for e in usplit:
        e = int(e); a, b = e // (n_uv + 1), e % (n_uv + 1); ur += [uid[e], uid[e]]; uc += [a, b]; uvv += [0.5, 0.5]
    Suv = sp.csr_matrix((uvv, (ur, uc)), shape=(n_uv + len(usplit), n_uv))
    tn, tun = [], []
    for i in range(m):
        a, b, c_ = (int(x) for x in t[i]); ua, ub, uc_ = (int(x) for x in tu[i])
        if region[i]:
            ab, bc, ca = eid[int(E[i, 0])], eid[int(E[i, 1])], eid[int(E[i, 2])]
            uab, ubc, uca = uid[int(U[i, 0])], uid[int(U[i, 1])], uid[int(U[i, 2])]
            tn += [(a, ab, ca), (ab, b, bc), (ca, bc, c_), (ab, bc, ca)]; tun += [(ua, uab, uca), (uab, ub, ubc), (uca, ubc, uc_), (uab, ubc, uca)]
        elif ns[i] == 1:
            k = int(np.flatnonzero(is_split[i])[0]); vv = [a, b, c_]; uu = [ua, ub, uc_]
            p0, p1, p2 = vv[k], vv[(k + 1) % 3], vv[(k + 2) % 3]; q0, q1, q2 = uu[k], uu[(k + 1) % 3], uu[(k + 2) % 3]
            mid, umid = eid[int(E[i, k])], uid[int(U[i, k])]
            tn += [(p0, mid, p2), (mid, p1, p2)]; tun += [(q0, umid, q2), (umid, q1, q2)]
        else:
            tn.append((a, b, c_)); tun.append((ua, ub, uc_))
    return S, Suv, np.array(tn, np.int64), np.array(tun, np.int64)


def refine_top(g_, c, a, t, tu):
    """The shirt's refinement and its button sites. Small pieces (button discs, buttonholes, threads) go: the buttons are made anew
    (shirt_buttons). -> (SubAsset, t, tu, sites [(triangle (3,), barycentrics (3,), centre offset along the normal)])."""
    from scipy.spatial import cKDTree
    g0 = a.fit(c.base_v); root, tw = wd.weld(g0, t); lab = wd.components(tw, a.n)[root]
    ids, cnt = np.unique(lab[lab >= 0], return_counts=True); main = ids[cnt.argmax()]
    tm = lab[t[:, 0]] == main
    # the button discs (pieces of 60-300 vertices on the placket): where each sits on the main cloth
    sites = []; tmw = tw[tm]; cen = g0[tmw].mean(1); kd = cKDTree(cen); nrm = wd.vertex_normals(g0, tw)
    for k, n_ in zip(ids, cnt):
        if k == main or not (60 <= n_ <= 300): continue
        q = g0[lab == k].mean(0); best = None
        if abs(q[0]) > 0.06: continue                                 # the placket's only (the cuff buttons went in round 7)
        for j in kd.query(q, k=8)[1]:
            P = g0[tmw[j]]; e1, e2 = P[1] - P[0], P[2] - P[0]; nn = np.cross(e1, e2); nn /= np.linalg.norm(nn) + 1e-12
            x = q - P[0] - nn * ((q - P[0]) @ nn); d00, d01, d11 = e1 @ e1, e1 @ e2, e2 @ e2; d20, d21 = x @ e1, x @ e2
            den = d00 * d11 - d01 * d01; bv = (d11 * d20 - d01 * d21) / den; bw = (d00 * d21 - d01 * d20) / den; bc = np.clip([1 - bv - bw, bv, bw], 0, 1); bc /= bc.sum()
            dist = np.linalg.norm(q - (bc @ P))
            if best is None or dist < best[0]: best = (dist, tmw[j], bc)
        sites.append((best[1], best[2]))
    t, tu = t[tm], tu[tm]; tw2 = root[t]
    Wb = a.weights(c.rig.weights); Wb = np.asarray(Wb.todense()) if sp.issparse(Wb) else np.asarray(Wb); bones = list(c.rig.bones)
    low = Wb[:, [i for i, b in enumerate(bones) if b.startswith(("lowerarm", "wrist", "metacarpal", "finger"))]].sum(1)
    jn = list(c.skeleton.names); ny = float(c.skeleton.head[jn.index("neck_01")][1])
    sx = max(abs(float(c.skeleton.head[jn.index(n)][0])) for n in ("upperarm_l", "upperarm_r") if n in jn) if "upperarm_l" in jn else 0.18
    ce = g0[tw2].mean(1)
    region = (ce[:, 1] > ny - SUBDIV_BELOW_NECK) & (low[tw2].max(1) < 0.1) & (np.abs(ce[:, 0]) < sx + SUBDIV_SIDE)
    corner = np.zeros(a.n, bool); zc = 0.5 * (g0[tw2][:, :, 2].max() + g0[tw2][:, :, 2].min())
    for l in wd.boundary_loops(tw2, a.n):
        l = np.asarray(l)
        if len(l) < 5: continue
        P = g0[l]; e0 = P - np.roll(P, 1, 0); e1 = np.roll(P, -1, 0) - P
        cosang = (e0 * e1).sum(1) / (np.linalg.norm(e0, axis=1) * np.linalg.norm(e1, axis=1) + 1e-12)
        corner[l[(cosang < math.cos(math.radians(SUBDIV_CORNER_DEG))) & (P[:, 2] > zc)]] = True
    S, Suv, tn, tun = subdivide_once(tw2, tu, a.n, len(a.uv), region, corner)
    log("shirt refined: %d -> %d triangles (%d in the region), %d button sites, %d collar corners" % (len(t), len(tn), int(region.sum()), len(sites), int(corner.sum())))
    return SubAsset(a, S, Suv, tn, tun), tn, tun, sites


# ---- round 13 (REVIEW-09 item 1): buttons that read as buttons, stitched seams and pockets in the normal map
BUTTON_R = 0.0053           # radius of a shirt button (an 11 mm button)
BUTTON_H = (0.0017, 0.0011) # dome height at the centre and at the rim, above the cloth
BUTTON_STANDOFF = 0.0006    # the disc's underside this far off the cloth
BUTTON_SEG = 12
BUTTON_UV = (0.945, 0.055, 0.032)   # (u, v, radius) of the button's picture in the shirt's UV atlas (an empty strip right of the islands)
SEAM_PX = 1.6               # half width of a seam groove, texels of the 1024 map (about 1.5 mm on the shirt)
ARMHOLE = (0.012, 0.045, 0.30, 0.12)   # the armhole seam: shoulder point (out, up) from the shoulder joint; inward lean per metre down; down to this below the joint
SEAM_STRENGTH = 2.2         # height -> normal slope of the seams, pocket edges and flap (reads at 1.5 m)


def shirt_buttons(c, g, fits, material):
    """Round domed discs on the placket, one per button site of the asset: rigid on the cloth under its centre (a frame from that
    triangle on every shape target), a dome with a rim wall, its top mapped onto the button picture in the atlas (holes, thread)."""
    if not g.button_sites: return None
    seg = BUTTON_SEG; th = 2 * math.pi * np.arange(seg) / seg; cs, sn = np.cos(th), np.sin(th)
    rho = [0.45, 0.8, 1.0]; Hc, He = BUTTON_H; R = BUTTON_R
    loc = [(0.0, 0.0, Hc)]; uvl = [(BUTTON_UV[0], BUTTON_UV[1])]
    for r in rho:
        z = Hc - (Hc - He) * r * r; loc += [(R * r * x, R * r * y, z) for x, y in zip(cs, sn)]; uvl += [(BUTTON_UV[0] + BUTTON_UV[2] * r * x, BUTTON_UV[1] + BUTTON_UV[2] * r * y) for x, y in zip(cs, sn)]
    loc += [(R * x, R * y, 0.0) for x, y in zip(cs, sn)]; uvl += [(BUTTON_UV[0] + BUTTON_UV[2] * 1.15 * x, BUTTON_UV[1] + BUTTON_UV[2] * 1.15 * y) for x, y in zip(cs, sn)]
    loc = np.array(loc); uvl = np.array(uvl); ring = lambda i: 1 + i * seg
    tri = [(0, ring(0) + k, ring(0) + (k + 1) % seg) for k in range(seg)]
    for i in range(len(rho)):                                          # the top bands and, last, the wall down to the cloth
        a0, b0 = ring(i), ring(i + 1)
        if i == len(rho) - 1: b0 = ring(len(rho))
        for k in range(seg):
            k2 = (k + 1) % seg; tri += [(a0 + k, b0 + k, b0 + k2), (a0 + k, b0 + k2, a0 + k2)]
    tri = np.array(tri); nloc = len(loc)
    def place(P, site):
        tr, bc = site; Q = P[tr]; cen = bc @ Q; n = np.cross(Q[1] - Q[0], Q[2] - Q[0]); n /= np.linalg.norm(n) + 1e-12
        if n @ np.array([0.0, 0.0, 1.0]) < 0: n = -n                       # the placket faces +z
        w = np.array([0.0, 1.0, 0.0]) - n * n[1]; w /= np.linalg.norm(w) + 1e-12; u = np.cross(w, n)
        return cen + n * BUTTON_STANDOFF + loc[:, :1] * u + loc[:, 1:2] * w + loc[:, 2:3] * n
    keys = list(fits); base = np.vstack([place(fits[""][g.id], s_) for s_ in g.button_sites])
    morphs = {k: np.vstack([place(fits[k][g.id], s_) for s_ in g.button_sites]) - base for k in keys if k}
    T = np.vstack([tri + j * nloc for j in range(len(g.button_sites))]); UV = np.vstack([uvl] * len(g.button_sites))
    Wa = g.asset.weights(c.rig.weights); Wa = Wa.tocsr() if sp.issparse(Wa) else sp.csr_matrix(Wa)
    rows = [sp.csr_matrix(np.asarray(sum(b_ * Wa[i_].toarray() for i_, b_ in zip(tr_, bc_)))) for tr_, bc_ in g.button_sites]
    Wd = sp.vstack([sp.vstack([r_] * nloc) for r_ in rows]).tocsr()
    m = layer_mesh(c, "buttons", base, T, material, UV, T.copy(), Wd, morphs)
    log("buttons: %d round discs, %d triangles" % (len(g.button_sites), len(T)))
    return m


def shirt_details(tex, g, c, size, out_name):
    """Stitched seams and pocket outlines in the shirt's normal map, and the button picture: placket edges, the back yoke, the armhole
    seams at the shoulder points with a slight fold on the sleeve side, the side and shoulder-top seams (UV island borders), the chest
    pockets' outlines with a flap line; grooves a little darker in the base colour. -> tex with new baseColor and normal paths."""
    from scipy import ndimage
    v0 = g.asset.fit(c.base_v); t, tu, uv = g.t_full, g.tu, g.asset.uv
    Pimg = np.dstack([wd.raster_scalar(uv, tu, t, v0[:, k], size, pad=2) for k in range(3)]); inside = ~np.isnan(Pimg[..., 0]); P = np.nan_to_num(Pimg)
    jn = list(c.skeleton.names); J = lambda n_: np.asarray(c.skeleton.head[jn.index(n_)], float)
    ny = J("neck_01")[1]; zc = float(np.median(v0[np.unique(t), 2])); sx = abs(J("upperarm_l")[0])
    H = np.zeros((size, size), np.float32); G = np.zeros((size, size), np.float32)
    groove = lambda d, w: np.exp(-(d / w) ** 2)
    yy, xx = np.mgrid[0:size, 0:size]; dash = (((xx + yy) // 3) % 2).astype(np.float32) * 0.5 + 0.5
    def seam(dist_m, mm=1.2):                                          # a stitched seam along the zero set of a metric distance field
        gq = groove(dist_m, mm / 1000.0) * inside; H[:] -= gq * 0.6 * dash; G[:] = np.maximum(G, gq * dash)
        ridge = groove(np.abs(dist_m) - 0.0025, 0.0012) * inside; H[:] += ridge * 0.35
    front = P[..., 2] > zc; back = ~front
    # placket edges (a 34 mm band down the centre front, from the collar to the hem)
    pl = front & (P[..., 1] < ny - 0.015)
    seam(np.where(pl, np.abs(np.abs(P[..., 0]) - 0.017), 1.0))
    H[:] += (pl & (np.abs(P[..., 0]) < 0.017)) * 0.15
    # back yoke, 95 mm below the neck joint
    seam(np.where(back & (np.abs(P[..., 0]) < sx + 0.03), np.abs(P[..., 1] - (ny - 0.095)), 1.0))
    # armhole seams at the shoulder points, with a soft fold just onto the sleeve
    # (a set-in sleeve: from the shoulder point straight down and a little in toward the armpit, NOT square to the arm, which drew a
    # raglan line from the shoulder top down into the chest)
    # (the cut is taken through the cloth's positions blurred over ~8 texels: the pack's modelled wrinkles at the shoulder made a plane
    # cut of the raw positions zigzag; the fold's ends fade instead of stopping, which left dark steps at the underarm)
    wm = ndimage.gaussian_filter(inside.astype(np.float32), 8.0)
    Pb = np.dstack([ndimage.gaussian_filter(P[..., k] * inside, 8.0) for k in range(3)]) / np.maximum(wm, 1e-4)[..., None]
    for s_ in ("l", "r"):
        a0 = J("upperarm_" + s_); sg = 1.0 if a0[0] > 0 else -1.0
        sp_ = a0 + np.array([sg * ARMHOLE[0], ARMHOLE[1], 0.0]); n_ = np.array([sg, -ARMHOLE[2], 0.0]); n_ /= np.linalg.norm(n_)
        d_ = (Pb - sp_) @ n_; ra = np.linalg.norm(Pb - a0, axis=2)
        near = (ra < 0.17) & (Pb[..., 1] > a0[1] - ARMHOLE[3]) & inside
        seam(np.where(near, np.abs(d_), 1.0))
        fade = (1 - ramp(ra, 0.12, 0.17)) * ramp(Pb[..., 1], a0[1] - ARMHOLE[3], a0[1] - ARMHOLE[3] + 0.04) * inside
        H[:] += np.exp(-((d_ - 0.012) / 0.007) ** 2) * 0.6 * fade
    # side and shoulder-top seams: the UV island borders
    H[:] += mt.seam_height(uv, tu, size, width=max(1, size // 600), stitch=True, inset=4) * 0.5
    # chest pockets: an outline stitched 2.5 mm in, the edge as a low step, a flap line 28 % down
    if g.spec.get("pockets"):
        vuv = np.zeros((len(v0), 2)); vuv[t.ravel()] = uv[tu.ravel()]
        for lo, hi in POCKET_UV:
            sel = (vuv[:, 0] > lo[0]) & (vuv[:, 0] < hi[0]) & (vuv[:, 1] > lo[1]) & (vuv[:, 1] < hi[1])
            if not sel.any(): continue
            # the outline in metres on the cloth, square to the body (its UV island is turned and sheared against the chest, so
            # a rectangle in UV drew a skewed, jagged pocket); only on the texels of the pocket's own piece of the front
            Q = v0[sel]; x0_, x1_ = Q[:, 0].min() + 0.003, Q[:, 0].max() - 0.003; y0_, y1_ = Q[:, 1].min() + 0.003, Q[:, 1].max() - 0.003
            U0, U1 = vuv[sel].min(0) * size, vuv[sel].max(0) * size
            isl = inside & front & (xx >= U0[0] - 6) & (xx <= U1[0] + 6) & (yy >= (1 - U1[1] / size) * size - 6) & (yy <= (1 - U0[1] / size) * size + 6)
            px, py = P[..., 0], P[..., 1]
            inr = isl & (px >= x0_) & (px <= x1_) & (py >= y0_) & (py <= y1_)
            edge = np.where(inr, np.minimum.reduce([px - x0_, x1_ - px, py - y0_, y1_ - py]), 1.0).astype(np.float32)
            H[:] += ndimage.gaussian_filter(inr.astype(np.float32), 0.8) * 0.45
            st = groove(edge - 0.0028, 0.0011) * inr; H[:] -= st * 0.5 * dash; G[:] = np.maximum(G, st * dash)
            fy = y1_ - 0.28 * (y1_ - y0_); flap = inr & (py > fy)
            fl = groove(np.where(inr, np.abs(py - fy), 1.0).astype(np.float32), 0.0012) * inr; H[:] -= fl * 0.8; G[:] = np.maximum(G, fl)
            H[:] += ndimage.gaussian_filter(flap.astype(np.float32), 0.8) * 0.25
    # the button picture: a dome, a rim groove, four holes, the thread crossing them
    cu, cv, cr = BUTTON_UV; bx, by = cu * size, (1 - cv) * size; br = cr * size
    rr = np.hypot(xx - bx, yy - by) / br; bt = rr < 1.2
    hb = np.where(rr < 1.0, 0.8 * (1 - rr ** 2), 0.0) - groove(np.abs(rr - 0.78), 0.06) * 0.25
    holes = np.zeros_like(rr)
    for ang in (45, 135, 225, 315):
        hx, hy = bx + 0.27 * br * math.cos(math.radians(ang)), by + 0.27 * br * math.sin(math.radians(ang)); holes = np.maximum(holes, groove(np.hypot(xx - hx, yy - hy), 0.09 * br))
    thread = np.maximum(groove(np.abs((xx - bx) - (yy - by)) / math.sqrt(2), 0.06 * br), groove(np.abs((xx - bx) + (yy - by)) / math.sqrt(2), 0.06 * br)) * (rr < 0.4)
    hb = hb - holes * 0.6 + thread * 0.25
    H = np.where(bt, hb, H)
    n = mt._load_normal(tex["normal"], size); n = mt._combine_normals(n, mt.height_to_normal(ndimage.gaussian_filter(H, 0.6), SEAM_STRENGTH))
    base = np.asarray(Image.open(tex["baseColor"]).convert("RGB").resize((size, size), Image.LANCZOS), np.float32)
    shade = 1 - 0.12 * G
    shade = np.where(bt, 1.06 * (1 - 0.55 * holes) * (1 - 0.18 * thread) * (1 - 0.12 * groove(np.abs(rr - 0.78), 0.06)), shade)
    base = base * shade[..., None]
    pb = os.path.join(mt.CACHE, out_name + "_base.jpg"); pn = os.path.join(mt.CACHE, out_name + "_normal.jpg")
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(pb, quality=92); mt._pack_normal(n).save(pn, quality=94)
    log("shirt details: seams, pockets, flap and the button picture painted into", os.path.basename(pn))
    g.details_normal = pn
    return {**tex, "baseColor": pb, "normal": pn}


SHIRT_FOLD_MAX_DEG = 25.0   # round 13: the steepest a fold of B8's standing shirt map may tilt the normal (REVIEW-10 item 1)


def recompose_shirt_map(folder, details, out_dir):
    """B8's standing shirt map with the CURRENT stitched-detail map underneath. The bake composed its folds over the map of its
    snapshot (saved beside it as under_n.jpg) with a whiteout blend, n ~ (f.xy + u.xy, f.z u.z); the fold f is solved back from the
    composite and blended over `details` the same way, so seams, pockets and buttons can change without a new cloth run.
    -> out_dir (holding garment_top_shirt_fold_stand_n.jpg) or None when the folder has no under_n.jpg"""
    fn = "garment_top_shirt_fold_stand_n.jpg"; up = os.path.join(folder, "under_n.jpg")
    if not (os.path.exists(os.path.join(folder, fn)) and os.path.exists(up) and details and os.path.exists(details)): return None
    sz = Image.open(os.path.join(folder, fn)).size[0]
    cm, u, d = (mt._load_normal(p_, sz) for p_ in (os.path.join(folder, fn), up, details))
    A = cm[..., 0] / np.maximum(cm[..., 2], 1e-3); B = cm[..., 1] / np.maximum(cm[..., 2], 1e-3); fz = np.ones_like(A)
    for _ in range(5):
        fx = A * fz * u[..., 2] - u[..., 0]; fy = B * fz * u[..., 2] - u[..., 1]; fz = np.sqrt(np.clip(1 - fx ** 2 - fy ** 2, 0.05, 1))
    # round 13 (REVIEW-10 item 1, "a dark, ragged slit" on F05's shirt front): the run left a 47-degree crease under the woman's bust
    # (B8's map, UV 0.40 / 0.09) and the solve above, where the composite is that steep, ran the fold up to 78 degrees, which drew as a
    # dark slit in every light. The fold is limited to SHIRT_FOLD_MAX_DEG (its p95 is 13 degrees) before it is laid over the details.
    sl = np.sqrt(fx ** 2 + fy ** 2) / np.maximum(fz, 1e-6); k = np.minimum(1.0, math.tan(math.radians(SHIRT_FOLD_MAX_DEG)) / np.maximum(sl, 1e-9))
    fx, fy = fx * k / np.maximum(fz, 1e-6), fy * k / np.maximum(fz, 1e-6); fz = np.ones_like(fx)
    nf = np.dstack([fx, fy, fz]); nf /= np.linalg.norm(nf, axis=2, keepdims=True); fx, fy, fz = nf[..., 0], nf[..., 1], nf[..., 2]
    n = np.dstack([fx + d[..., 0], fy + d[..., 1], fz * d[..., 2]]); n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-9)
    os.makedirs(out_dir, exist_ok=True); mt._pack_normal(n).save(os.path.join(out_dir, fn), quality=90)
    log("shirt map: B8's folds from %s over this build's details (%s)" % (os.path.relpath(folder, LAB), os.path.basename(details)))
    return out_dir


# ------------------------------------------------------------------------------------------------ garments
class Garment:
    def __init__(self, gid, c):
        self.id = gid; self.spec = sp_ = GARMENTS[gid]; self.slot = slot_of(gid)
        if c.sex == "f" and sp_.get("src_f"):                         # a cut of her own where the pack has one
            sp_ = self.spec = {**sp_, "src": sp_["src_f"], "title": sp_.get("title_f", sp_["title"]), "rim": sp_.get("rim_f", sp_.get("rim"))}
        self.asset = a = wd.Asset(sp_["src"])
        t, tu = a.tris(); g = a.fit(c.base_v)
        part = sp_.get("part")
        if part in ("suit_shirt", "suit_trousers"):                 # one welded mesh: the shirt's UV islands lie above the hips
            isl = wd.components(tu, len(a.uv)); ti = isl[tu[:, 0]]
            top_y = c.base_v[c.base.vgroups["body"], 1].max()
            shirt = [i for i in range(isl.max() + 1) if (ti == i).any() and g[np.unique(t[ti == i]), 1].min() > top_y * 0.55]
            sel = np.isin(ti, shirt) if part == "suit_shirt" else ~np.isin(ti, shirt)
            t, tu = t[sel], tu[sel]
        self.button_sites = []
        if sp_.get("subdiv") and SHIRT_REFINE:                       # round 13: refined once where it faces the camera; buttons made anew
            self.asset, t, tu, self.button_sites = refine_top(self, c, a, t, tu); a = self.asset; g = a.fit(c.base_v)
        self.t_full, self.tu = t, tu                                 # triangles in the asset's vertex numbering
        _, tw = wd.weld(g, t)
        loops_ = [np.asarray(l) for l in wd.boundary_loops(tw, a.n) if len(l) >= 12]
        self.border = np.unique(np.concatenate(loops_ or [np.zeros(0, dtype=np.int64)]))
        self.keep_tri = np.ones(len(t), bool)
        self.cuff_border = np.zeros(0, dtype=np.int64); self.cuff_loops = []
        if self.slot == "top" and loops_:
            # round 7: the cuffs (loops far out to the side in the A-pose), and the small pieces sewn at their ends go (the cuff
            # buttons and tabs, bound to the hand by the transfer, stood out as an angular piece at the cuff end in the grip close-up)
            cuffs = [l for l in loops_ if abs(g[l, 0].mean()) > 0.25]
            if cuffs:
                self.cuff_border = np.unique(np.concatenate(cuffs)); cb = g[self.cuff_border]
                from scipy.spatial import cKDTree
                root_, tw2 = wd.weld(g, t); lab_ = wd.components(tw2, a.n)[root_]; ids_, cnt_ = np.unique(lab_[lab_ >= 0], return_counts=True)
                small = [k for k, n_ in zip(ids_, cnt_) if n_ < 300 and cKDTree(cb).query(g[lab_ == k].mean(0))[0] < CUFF_PIECE_R]
                if small: self.keep_tri &= ~np.isin(lab_[t[:, 0]], small)
                # round 11 (REVIEW-07 item 7, "button shards at 0.7 m"): each button of the asset is a round disc (73 vertices) over an
                # elongated buttonhole patch (45) and two thread crosses (15); seated, the flat patches sank into the bent placket and
                # showed as shards. Only the discs stay (they ride rigidly on the cloth, lifted off it: see build)
                tiny = [k for k, n_ in zip(ids_, cnt_) if n_ < TOP_PIECE_MIN]
                # and the disc on the collar stand at the throat: under a heavy neck and chin the skin reaches 22 mm over it (F50_HEAVY)
                Wn_ = c.rig.weights.tocsr() if sp.issparse(c.rig.weights) else sp.csr_matrix(c.rig.weights)
                neckw_ = np.asarray(Wn_[:, [i for i, b_ in enumerate(c.rig.bones) if b_.startswith(("neck", "head"))]].sum(1)).ravel()
                kb_ = cKDTree(c.base_v)
                tiny += [k for k, n_ in zip(ids_, cnt_) if n_ < 300 and k != ids_[cnt_.argmax()] and neckw_[kb_.query(g[lab_ == k].mean(0))[1]] > 0.3]
                if tiny: self.keep_tri &= ~np.isin(lab_[t[:, 0]], tiny)
                self.cuff_loops = cuffs
        self.rim = None; self.sole_k = None; self.hug = None
        self.authored = np.asarray(a.v_obj, dtype=np.float64) if sp_.get("stiff") else None
        self.neck_y = float(c.skeleton.head[list(c.skeleton.names).index("neck_01")][1]) - 0.08 if "neck_01" in c.skeleton.names else 1e9

    def tris_kept(self): return self.t_full[self.keep_tri]


def border_dist(v, tris, pick):
    """Geodesic distance over the welded cloth from the boundary loops `pick(loops, v)` chooses (loops of 12 or more vertices)."""
    from scipy.sparse.csgraph import dijkstra
    root, tw = wd.weld(v, tris); n = len(v)
    loops = [np.asarray(l) for l in wd.boundary_loops(tw, n) if len(l) >= 12]
    src = np.concatenate(pick(loops, v)) if loops else np.zeros(0, np.int64)
    if not len(src): return np.full(len(v), np.inf)
    e = np.r_[tw[:, [0, 1]], tw[:, [1, 2]], tw[:, [2, 0]]]; ln = np.linalg.norm(v[e[:, 0]] - v[e[:, 1]], axis=1)
    Gm = sp.coo_matrix((ln, (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()
    return dijkstra(Gm, directed=False, indices=src, min_only=True)[root]


def b8_hem_faded(g, v, size, out):
    """B8's standing fold map with the hem break faded to flat (round 6: its break baked dark scuffs above the heel and, seated, a
    dark ring above the hem): flat up to B8_FADE[0] above the hem along the cloth, B8's map from B8_FADE[1] up."""
    d = border_dist(v, g.t_full, lambda loops, v_: sorted(loops, key=lambda l: v_[l, 1].mean())[:2])
    f = ramp(np.nan_to_num(d, posinf=1.0), *B8_FADE)
    fi = np.nan_to_num(wd.raster_scalar(g.asset.uv, g.tu, g.t_full, f, size, pad=8), nan=1.0)
    nm = np.asarray(Image.open(B8_TROUSERS_FOLD).convert("RGB").resize((size, size), Image.LANCZOS), dtype=np.float32) / 127.5 - 1.0
    nm = nm * fi[..., None] + np.array([0.0, 0.0, 1.0], np.float32) * (1 - fi[..., None]); nm /= np.linalg.norm(nm, axis=2, keepdims=True)
    p = os.path.join(mt.CACHE, "b8_trousers_fold_stand_hemflat_%s.jpg" % os.path.basename(out))
    Image.fromarray(np.clip((nm + 1.0) * 127.5, 0, 255).astype(np.uint8)).save(p, quality=92)
    return p


def _taubin(v, tris, w, iters=16, lam=0.5, mu=-0.53):
    """Taubin smoothing (no shrinking) of v over the welded mesh, weighted per vertex by w (0 = untouched)."""
    root, tw = wd.weld(v, tris); n = len(v)
    i = np.r_[tw[:, 0], tw[:, 1], tw[:, 2], tw[:, 1], tw[:, 2], tw[:, 0]]; j = np.r_[tw[:, 1], tw[:, 2], tw[:, 0], tw[:, 0], tw[:, 1], tw[:, 2]]
    A = sp.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr(); A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel(); Lm = sp.diags(1.0 / np.maximum(deg, 1)) @ A; ww = (w * (deg > 0))[:, None]
    x = np.asarray(v, dtype=np.float64).copy()
    for k in range(iters): x = x + (lam if k % 2 == 0 else mu) * ww * (Lm @ x - x)
    return x[root]


# ---- round 11 (REVIEW-07 item 3, shirt form): the shirt shrink-wrapped the body (the bust with its apex, the pecs, the belly; the chest
# pockets bent over the breasts like boxes). Hoop tension and drape instead: each horizontal section of the torso cloth becomes its convex
# hull (the circumferential threads span between the bust apexes, over the sternum and the spine) and each vertical profile its concave
# majorant (the cloth hangs from the chest and the bust over the hollows below); radial pushes only, on a (height, angle) grid, smoothed
# so no apex or ridge reads as a point, capped, faded out at sleeves, collar and hem; the chest pockets become flat plates on top.
FORM_DY = 0.008; FORM_NTH = 180          # grid: 8 mm levels, 2 degree columns round a vertical axis through the torso
FORM_HMAX = 0.040                        # at most this far out from the fitted cloth
FORM_EASE = 0.003                        # and this much general ease over the torso
FORM_SMOOTH_SURFACE = os.environ.get("B2_FORM_SMOOTH_PUSH") is None    # round 13: smooth the formed surface, not the push (see shirt_form)
FORM_SMOOTH_MM = 22.0                    # the push field smoothed this much (sigma); max(push, smoothed push): bridges stay, apexes round off
FORM_SHOULDER = (0.07, 0.13)            # round 13: no shirt-form push within 70 mm of a shoulder joint, full from 130 mm
FORM_DOME_MM = float(os.environ.get("B2_FORM_DOME", 60.0))   # no convex peak tighter than a sphere of this radius (mm); 0 = off (round 13: 90 -> 60, over the smooth base)
FORM_DOME_BASE_MM = float(os.environ.get("B2_FORM_DOME_BASE", 25.0))   # round 13: the dome dilates the field above its smooth base (sigma, mm); 0 = old
FORM_BACK = 0.5                          # the vertical drape at the back at this share (a lumbar tent would meet a backrest seated)
FORM_HEM_FADE = (0.0, 0.06)              # the smoothed part of the push fades out toward the hem (the hem must not change)
POCKET_UV = (((0.351, 0.237), (0.415, 0.299)), ((0.480, 0.242), (0.540, 0.303)))   # the chest pockets of the shirt asset, in its UV space
COLLAR_SMOOTH = int(os.environ.get("B2_COLLAR_SMOOTH", 10)); COLLAR_R = (0.03, 0.06); COLLAR_LOOP_PASSES = 3; COLLAR_CORNER_DEG = 50.0   # round 11: the collar
B8_DRESS = os.environ.get("B2_NO_B8_DRESS") is None      # round 11: B8's round-2 seated trousers and shirt map, as a post-process (end of build)
POCKET_RELIEF_F = 0.0   # round 13: the woman's pockets lie over the bust tip; a plate's lower edge there read as a point (clay, raking light): flat, drawn only
POCKET_RELIEF = 0.0015  # round 13: 2 -> 1.5 mm; round 11: the pockets lie this far proud of the formed shirt inside their outline (their box relief removed)
SHIRT_FORM = os.environ.get("B2_NO_FORM") is None


def _ray_poly(H, th):
    """H (m,2) closed polygon (x, z) round the origin -> its outermost radius along each angle th (from +z toward +x); nan where none."""
    d = np.c_[np.sin(th), np.cos(th)]; r = np.full(len(th), np.nan)
    for a, b in zip(H, np.roll(H, -1, 0)):
        e = b - a; den = d[:, 0] * e[1] - d[:, 1] * e[0]
        with np.errstate(divide="ignore", invalid="ignore"):
            s_ = (a[0] * e[1] - a[1] * e[0]) / den; u = (a[0] * d[:, 1] - a[1] * d[:, 0]) / den
        ok = (np.abs(den) > 1e-12) & (s_ > 0) & (u >= -1e-9) & (u <= 1 + 1e-9)
        r = np.where(ok & (np.isnan(r) | (s_ > r)), s_, r)
    return r


def _section_r(v, t, y, th, cx, cz):
    """Outermost radius of the mesh's section at height y along the angles th (nan where the section has none)."""
    d_ = v[:, 1] - y; D = d_[t]; hit = np.flatnonzero((D.min(1) < 0) & (D.max(1) > 0))
    r = np.full(len(th), np.nan)
    if not len(hit): return r
    segs = []
    for k in hit:
        tri = t[k]; dd = D[k]; pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if (dd[a] < 0) != (dd[b] < 0):
                q = dd[a] / (dd[a] - dd[b]); pts.append(v[tri[a]] + q * (v[tri[b]] - v[tri[a]]))
        if len(pts) == 2: segs.append(pts)
    dv = np.c_[np.sin(th), np.cos(th)]
    for p, q in segs:
        a = np.array([p[0] - cx, p[2] - cz]); e = np.array([q[0] - p[0], q[2] - p[2]]); den = dv[:, 0] * e[1] - dv[:, 1] * e[0]
        with np.errstate(divide="ignore", invalid="ignore"):
            s_ = (a[0] * e[1] - a[1] * e[0]) / den; u = (a[0] * dv[:, 1] - a[1] * dv[:, 0]) / den
        ok = (np.abs(den) > 1e-12) & (s_ > 0) & (u >= 0) & (u <= 1)
        r = np.where(ok & (np.isnan(r) | (s_ > r)), s_, r)
    return r


def _majorant(x, y):
    """The smallest concave function >= y over sorted x (upper hull), at x."""
    hull = []
    for i in range(len(x)):
        while len(hull) >= 2 and (y[hull[-1]] - y[hull[-2]]) * (x[i] - x[hull[-2]]) <= (y[i] - y[hull[-2]]) * (x[hull[-1]] - x[hull[-2]]): hull.pop()
        hull.append(i)
    return np.interp(x, x[hull], y[hull])


def _pdilate(R, a, dy, ds):
    """Parabolic dilation of a (height, angle) radius grid: R'(p) = max_q R(q) - |p - q|^2 / (2a), separable (angle wraps); nan = no cloth."""
    F = np.where(np.isnan(R), -np.inf, R); ny, nt = F.shape
    jt = np.arange(nt); dj = np.minimum(np.abs(jt[:, None] - jt[None]), nt - np.abs(jt[:, None] - jt[None])) * ds; Kt = dj ** 2 / (2 * a)
    F = (F[:, None, :] - Kt[None]).max(2)
    iy = np.arange(ny); Ky = ((iy[:, None] - iy[None]) * dy) ** 2 / (2 * a)
    F = (F.T[:, None, :] - Ky[None]).max(2).T
    return np.where(np.isnan(R), np.nan, np.maximum(F, np.where(np.isnan(R), -np.inf, R)))


def shirt_form(v, t, wt, hem_fade=None, axis=None):
    """-> (v moved radially, push per vertex). wt: 0..1 freedom per vertex (0 on sleeves, collar, small pieces). axis: (cx, cz) of the
    vertical axis (the base fit's, so every shape target uses the same one)."""
    from scipy.spatial import ConvexHull
    from scipy import ndimage
    root, tw = wd.weld(v, t); tk = tw[(wt[tw] > 0.5).all(1)]; tor = np.unique(tk)
    if len(tk) < 50: return v, np.zeros(len(v))
    cx, cz = axis if axis is not None else (0.0, float(0.5 * (v[tor, 2].max() + v[tor, 2].min())))
    Y = np.arange(v[tor, 1].min() + 0.002, v[tor, 1].max() - 0.002, FORM_DY); th = np.linspace(-np.pi, np.pi, FORM_NTH, endpoint=False)
    R = np.array([_section_r(v, tk, y, th, cx, cz) for y in Y]); Rc = R.copy(); D = np.zeros_like(R)
    back = np.where(np.abs(th) > math.radians(100), FORM_BACK, 1.0)
    for _ in range(2):
        for i in range(len(Y)):                                       # hoop: the section's convex hull
            ok = ~np.isnan(Rc[i])
            if ok.sum() < 8: continue
            P = np.c_[np.sin(th[ok]) * Rc[i, ok], np.cos(th[ok]) * Rc[i, ok]]
            try: rh = _ray_poly(P[ConvexHull(P).vertices], th)
            except Exception: continue
            add = np.where(ok & ~np.isnan(rh), np.clip(np.nan_to_num(rh) - np.nan_to_num(Rc[i]), 0, None), 0.0); D[i] += add; Rc[i] = Rc[i] + add
        for j in range(FORM_NTH):                                     # drape: the profile's concave majorant
            ok = ~np.isnan(Rc[:, j])
            if ok.sum() < 4: continue
            add = np.clip(_majorant(Y[ok], Rc[ok, j]) - Rc[ok, j], 0, None) * back[j]; D[ok, j] += add; Rc[ok, j] += add
    if FORM_DOME_MM:
        # no point may read: the radius field is dilated by a paraboloid of radius FORM_DOME_MM (the cloth cannot curve more tightly
        # than that over a peak: a nipple or a hull corner at an apex becomes a soft dome; a surface flatter than that is unchanged)
        # round 13 (REVIEW-09: the faceted upper chest, the dark patch at the sternum, the puffy shoulder): the dilation acts on the
        # radius ABOVE a smooth base of the section field, not on the radius itself. In (height, angle) a sloped field (an elliptic
        # section's flank, the rise from the neck to the chest) is lifted by slope^2 * a / 2 although it has no peak: 9 mm over the
        # whole upper chest and 20-24 mm at 20-35 degrees either side of the centre, which made two ridges with a valley between
        ds_ = float(np.nanmedian(R)) * 2 * math.pi / FORM_NTH; M_ = (~np.isnan(Rc)).astype(float)
        sgb = (FORM_DOME_BASE_MM / 1000 / FORM_DY, FORM_DOME_BASE_MM / 1000 / ds_)
        kb = lambda A: ndimage.gaussian_filter(A, sgb, mode=("nearest", "wrap"))
        Bs = kb(np.nan_to_num(Rc) * M_) / np.maximum(kb(M_), 1e-6)
        Rd = Bs + _pdilate(Rc - Bs, FORM_DOME_MM / 1000, FORM_DY, ds_) if FORM_DOME_BASE_MM else _pdilate(Rc, FORM_DOME_MM / 1000, FORM_DY, ds_)
        D = D + np.where(np.isnan(Rc), 0.0, np.nan_to_num(Rd - Rc))
    D = np.clip(np.nan_to_num(D), 0, FORM_HMAX); M = (~np.isnan(R)).astype(float); Dz = D * M
    rmid = float(np.nanmedian(R)); sig = (FORM_SMOOTH_MM / 1000 / FORM_DY, FORM_SMOOTH_MM / 1000 / (rmid * 2 * math.pi / FORM_NTH))
    k_ = lambda A: ndimage.gaussian_filter(A, sig, mode=("nearest", "wrap"))
    if FORM_SMOOTH_SURFACE:
        # round 13 (REVIEW-09: the bust's cups and nub, the dark patch at the sternum): the smoothed FORMED radius, not the smoothed
        # push. A smoothed push moved the apexes out by as much as the bridge between them (the valley was carried along: 10 mm
        # between the busts, 9 mm at the man's sternum); max(formed, smoothed formed) fills hollows and leaves the apexes where they are
        Rf = np.where(M > 0, np.nan_to_num(R) + D, 0.0); Rs = k_(Rf) / np.maximum(k_(M), 1e-6)
        Ds = np.clip(np.where(M > 0, Rs - np.nan_to_num(R), 0.0), 0, FORM_HMAX)
    else:
        Ds = k_(Dz) / np.maximum(k_(M), 1e-6)
    tv = np.arctan2(v[:, 0] - cx, v[:, 2] - cz)
    fi = np.clip((v[:, 1] - Y[0]) / FORM_DY, 0, len(Y) - 1.001); fj = (tv + np.pi) / (2 * np.pi) * FORM_NTH
    i0 = np.floor(fi).astype(int); a = fi - i0; j0 = np.floor(fj).astype(int) % FORM_NTH; b = fj - np.floor(fj); j1 = (j0 + 1) % FORM_NTH
    at = lambda G: (1 - a) * ((1 - b) * G[i0, j0] + b * G[i0, j1]) + a * ((1 - b) * G[i0 + 1, j0] + b * G[i0 + 1, j1])
    inside = (v[:, 1] >= Y[0] - FORM_DY) & (v[:, 1] <= Y[-1] + FORM_DY)
    d0, ds = at(D), at(Ds)
    d = np.maximum(d0, ds * (hem_fade if hem_fade is not None else 1.0))
    d = (np.where(inside, d, 0.0) + FORM_EASE) * wt; d = d[root]
    return v + np.c_[np.sin(tv), np.zeros(len(v)), np.cos(tv)] * d[:, None], d


POCKET_EDGE_SMOOTH = (0.008, 0.016, 12)   # round 13: Taubin over the cloth within 8 mm of a pocket outline (fading out by 16 mm), iterations
POCKET_EDGE_SMOOTH_F = (0.015, 0.030, 24)   # the woman's: wider (her pockets' lower corners lie at the bust tip and pinched there)
POCKET_DROP = os.environ.get("B2_POCKET_FILL") is None   # round 13: the pocket box comes off by its authored height (pocket_heights)


def pocket_heights(a, t, pockets):
    """How far each pocket vertex stands proud of the panel under it in the AUTHORED shirt (its box relief: the biharmonic fill
    through the cloth round the pocket, on the pack's own mesh where the panel under the pocket is smooth). Removing exactly that
    from the fitted cloth keeps the breast's dome under the pocket; a biharmonic fill on the FITTED cloth made a flat plate across
    the bust whose outline bent into points at the bust tip (REVIEW-09: the apex nub) and a dark wall at its inner edge.
    -> [(welded vertex ids, heights m, outline mask, one-in-from-outline mask)]"""
    from scipy.sparse.linalg import spsolve
    A0 = np.asarray(a.v_obj, float); root, tw = wd.weld(A0, t); n = len(A0)           # read_obj gives metres
    i = np.r_[tw[:, 0], tw[:, 1], tw[:, 2], tw[:, 1], tw[:, 2], tw[:, 0]]; j = np.r_[tw[:, 1], tw[:, 2], tw[:, 0], tw[:, 0], tw[:, 1], tw[:, 2]]
    A = sp.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr(); A.data[:] = 1.0; deg = np.asarray(A.sum(1)).ravel()
    L = (sp.diags(deg) - A).tocsr(); L2 = (L @ L).tocsr(); nrm = wd.vertex_normals(A0, tw); out = []
    for sel in pockets:
        I = np.unique(root[sel]); isI = np.zeros(n, bool); isI[I] = True; Bm = np.flatnonzero(~isI & (deg > 0))
        if len(I) < 4: continue
        x = spsolve(L2[I][:, I].tocsc(), -(L2[I][:, Bm] @ A0[Bm]))
        c_ = A0[I].mean(0); nn = nrm[I] * np.sign(((nrm[I] * (A0[I] - c_ + [0, 0, 0.05])).sum(1)) + 1e-9)[:, None]
        h = np.clip(((A0[I] - x) * nn).sum(1), 0, 0.03)
        ring = np.asarray(A[I][:, Bm].sum(1)).ravel() > 0; isR = np.zeros(n, bool); isR[I[ring]] = True
        ring2 = ~ring & (np.asarray(A[I][:, np.flatnonzero(isR)].sum(1)).ravel() > 0)
        out.append((I, h, ring, ring2))
    log("pocket box heights (authored): %s mm" % ", ".join("%.1f/%.1f" % (np.median(h_[~r_]) * 1000, h_.max() * 1000) for _, h_, r_, _ in out))
    return out


def pocket_shift(v, t, ph, amount, plate=False, edge=None):
    """Pocket vertices along the cloth's outward normal: amount -1 takes the authored box height off; plate=True raises the pocket
    by `amount` metres inside its outline (half one ring in), a thin flat-edged plate on the formed shirt."""
    root, tw = wd.weld(v, t); w = v[root].copy(); nrm = wd.vertex_normals(w, tw)
    for I, h, ring, ring2 in ph:
        c_ = w[I].mean(0); nn = nrm[I] * np.sign(((nrm[I] * (w[I] - c_ + [0, 0, 0.05])).sum(1)) + 1e-9)[:, None]
        d = (amount * (~ring) * np.where(ring2, 0.5, 1.0)) if plate else (amount * h)
        w[I] = w[I] + nn * d[:, None]
    w = w[root]
    es = edge if edge is not None else POCKET_EDGE_SMOOTH
    if plate and es:
        # the outline relaxed over a band either side (on the bust the panel falls away under the pocket's lower edge, which left a
        # shelf with a lip at its outer corner): a slope, no step; the pocket's flat middle is untouched
        from scipy.spatial import cKDTree
        rv = np.vstack([w[I[ring]] for I, h, ring, ring2 in ph]); dd = cKDTree(rv).query(w)[0]
        w = _taubin(w, t, 1 - ramp(dd, es[0], es[1]), iters=es[2])
    return w


def pocket_flatten(v, t, pockets, relief):
    """The chest pockets as thin flat plates ON the formed shirt: each pocket's relief (its raised box with walls, which read as a cup
    over the breast) is replaced by the smoothest surface through the cloth round it (biharmonic fill: a dome under it is kept, the
    step is not), then raised by `relief` inside its outline. Returns v."""
    from scipy.sparse.linalg import spsolve
    root, tw = wd.weld(v, t); n = len(v); v = v.copy()
    i = np.r_[tw[:, 0], tw[:, 1], tw[:, 2], tw[:, 1], tw[:, 2], tw[:, 0]]; j = np.r_[tw[:, 1], tw[:, 2], tw[:, 0], tw[:, 0], tw[:, 1], tw[:, 2]]
    A = sp.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr(); A.data[:] = 1.0; deg = np.asarray(A.sum(1)).ravel()
    L = (sp.diags(deg) - A).tocsr(); L2 = (L @ L).tocsr(); nrm = wd.vertex_normals(v, tw)
    for sel in pockets:
        I = np.unique(root[sel]); isI = np.zeros(n, bool); isI[I] = True; Bm = np.flatnonzero(~isI & (deg > 0))
        if len(I) < 4: continue
        x = spsolve(L2[I][:, I].tocsc(), -(L2[I][:, Bm] @ v[Bm]))
        ring = np.asarray(A[I][:, Bm].sum(1)).ravel() > 0                     # the pocket's outline vertices stay on the fill
        c_ = v[I].mean(0); nn = nrm[I] * np.sign(((nrm[I] * (v[I] - c_ + [0, 0, 0.05])).sum(1)) + 1e-9)[:, None]
        v[I] = x + nn * (relief * (~ring))[:, None]
    return v[root]



def form_setup(g, v, t, c):
    """Per top, from its base fit: freedom per vertex (torso cloth of the main piece: not sleeves, collar or small pieces), the hem fade,
    the axis and the pocket vertex sets."""
    Wb = g.asset.weights(c.rig.weights); Wb = np.asarray(Wb.todense()) if sp.issparse(Wb) else np.asarray(Wb)
    bones = list(c.rig.bones); col = lambda keys: Wb[:, [i for i, b in enumerate(bones) if any(k in b for k in keys)]].sum(1)
    arm = col(("upperarm", "lowerarm", "wrist", "metacarpal", "finger", "thumb")); neck = col(("neck", "head", "jaw"))
    root, tw = wd.weld(v, t); lab = wd.components(tw, len(v))[root]; ids, cnt = np.unique(lab[lab >= 0], return_counts=True); main = lab == ids[cnt.argmax()]
    fw = (1 - ramp(arm, 0.10, 0.45)) * (1 - ramp(neck, 0.10, 0.40)) * main
    # round 13 (REVIEW-09: "the cap is a puffy ball with no seam"): no push round the shoulder points (the hoop hull and the dome
    # had inflated the sleeve caps); the sleeve cap keeps the fit's own ease
    jn_ = list(c.skeleton.names)
    for s_ in ("upperarm_l", "upperarm_r"):
        if s_ in jn_: fw = fw * ramp(np.linalg.norm(v - np.asarray(c.skeleton.head[jn_.index(s_)]), axis=1), FORM_SHOULDER[0], FORM_SHOULDER[1])
    loops = [np.asarray(l) for l in wd.boundary_loops(tw, len(v)) if len(l) >= 12]; hl = [l for l in loops if np.ptp(v[l, 0]) > 0.2]
    hf = ramp(border_dist(v, t, lambda L, vv: [min(hl, key=lambda l: v[l, 1].mean())]), *FORM_HEM_FADE) if hl else np.ones(len(v))
    tor = fw > 0.5; ax = (0.0, float(0.5 * (v[tor, 2].max() + v[tor, 2].min())))
    vuv = np.zeros((len(v), 2)); vuv[g.t_full.ravel()] = g.asset.uv[g.tu.ravel()]
    pk = [np.flatnonzero((vuv[:, 0] > lo[0]) & (vuv[:, 0] < hi[0]) & (vuv[:, 1] > lo[1]) & (vuv[:, 1] < hi[1]) & main) for lo, hi in POCKET_UV] if g.spec.get("pockets") else []
    # the collar: its edge loops (the boundary loops on the neck's weights) and the cloth within COLLAR_R of them
    cl = [l for l in loops if main[l].all() and neck[l].mean() > 0.1 and not (len(hl) and l is min(hl, key=lambda l_: v[l_, 1].mean()))]
    cz = np.maximum((1 - ramp(border_dist(v, t, lambda L, vv: cl), COLLAR_R[0], COLLAR_R[1])) if cl else 0.0, ramp(neck, 0.2, 0.4)) * main
    g.collar = (cz, cl)
    log("shirt form %s: %d free vertices, pockets %s, collar loops %s, collar zone %d vertices" % (g.id, int(tor.sum()), [len(x) for x in pk], [len(l) for l in cl], int((cz > 0.5).sum())))
    return fw, hf, ax, pk


COLLAR_SETTLE = None if os.environ.get("B2_NO_SETTLE") else (0.003, 0.035)   # round 13 (REVIEW-09, C1 az 90: the collar's corner at the nape): behind the neck the fall lies this far
                                 # above the yoke under it, fully at its outer edge and fading out this far from it


def collar_settle(v, t, cz, cl, nz, key=""):
    """The collar's fall laid down onto the shirt behind the neck: the fit left it standing 10-25 mm off the yoke, a beak in profile.
    Vertices near the fall's outer edge (the lowest collar loop), behind the neck joint, move along their own normal toward the yoke
    until they are COLLAR_SETTLE[0] above it (never outward, never further than 30 mm)."""
    if not cl: return v
    outer = np.asarray(min(cl, key=lambda l: v[l, 1].mean())); bk = outer[v[outer, 2] < nz]
    if len(bk) < 3: return v
    zone = wd.opening_zone(v, bk, COLLAR_SETTLE[1]) * ramp(nz + 0.01 - v[:, 2], 0.0, 0.02) * (cz > 0.05)
    under = t[(cz[t] < 0.02).all(1)]
    if not len(under): return v
    has, cl_, ng, (root, tw) = wd.clearance(v, t, v, under, reach=0.05, facing=0.3, lateral_max=0.02)
    # one smooth field (where no yoke point was found the neighbours' value is taken; a raw per-vertex need crumpled the fall)
    ok = (has & (zone > 0)).astype(float); raw = np.where(ok > 0, np.clip(cl_ - COLLAR_SETTLE[0], 0, 0.03), 0.0)
    num = wd.smooth_field(raw[root], tw, 10, keep_max=False); den = wd.smooth_field(ok[root], tw, 10, keep_max=False)
    need = np.where(den > 1e-3, num / np.maximum(den, 1e-3), 0.0)[root] * zone
    need = np.minimum(need, wd.smooth_field(need[root], tw, 6, keep_max=False)[root] + 0.001)      # no spikes above the smoothed field
    if key == "": log("collar settled at the nape: %d vertices, most %.1f mm" % (int((need > 1e-4).sum()), need.max() * 1000))
    v = v - ng * need[:, None]
    return _taubin(v, t, np.clip(zone * 1.5, 0, 1), iters=8)


def build_fits(c, G, bodies, inner=None):
    """bodies: dict key -> full body vertices. -> fits[key][gid] = fitted, layered vertices in the asset's numbering."""
    by_slot = {}
    for g in G.values(): by_slot.setdefault(g.slot, []).append(g)
    fits = {}
    for key, B in bodies.items():
        f = {}
        for g in G.values():                                         # layer order = dict order
            v0 = g.asset.fit(B); t = g.tris_kept()
            if g.spec.get("sole_height"):                             # the pack's 16 mm sole made the specified height: the band below the sole line is stretched down
                yb = v0[np.unique(g.t_full), 1].min(); top = yb + SOLE_BAND
                if g.sole_k is None: g.sole_k = (SOLE_BAND + g.spec["sole_height"] + yb) / SOLE_BAND      # yb is negative: the pack sole's own depth below the bare sole
                v0 = v0.copy(); low = v0[:, 1] < top; v0[low, 1] = top - (top - v0[low, 1]) * g.sole_k
            v = v0
            if g.slot == "top":                                      # ease over the skin at collar, cuffs and hem
                v, _ = wd.clear_outside(v, t, B, c.tris, EASE, zone=wd.opening_zone(v, g.border, 0.05))
                if TAIL_LIFT:
                    # round 8: the front shirttail stood off where the trousers recede at the crotch (a "flap" from the side). The front
                    # of the hem is raised toward the side hem's height (a straighter work-shirt hem): by TAIL_LIFT x the drop below the
                    # sides, at the hem, fading to nothing 90 mm above it, only round the front (within 60-90 degrees of it)
                    # round 10: feathered (round 9's per-vertex lift over 90 mm crumpled the front hem into saw teeth): the hem's height
                    # profile is smoothed along the loop before the drop is read, the lift fades smoothly (smoothstep) over TAIL_BAND
                    # and round the front (50-95 degrees), and after lifting the hem line itself gets a few Laplacian passes along the loop
                    if getattr(g, "tail_dy", None) is None:
                        root_, tw_ = wd.weld(v, t); g.hem_root = root_; g.hem_loop = None
                        loops_ = [np.asarray(l) for l in wd.boundary_loops(tw_, len(v)) if len(l) >= 12]
                        hl_ = [l for l in loops_ if np.ptp(v[l, 0]) > 0.2]
                        if hl_:
                            hem_ = min(hl_, key=lambda l: v[l, 1].mean()); g.hem_loop = hem_; cx_, cz_ = v[hem_, 0].mean(), v[hem_, 2].mean()
                            k_ = max(3, len(hem_) // 10); ys_ = np.convolve(np.r_[v[hem_, 1][-k_:], v[hem_, 1], v[hem_, 1][:k_]], np.ones(2 * k_ + 1) / (2 * k_ + 1), "same")[k_:-k_]
                            az_h = np.arctan2(v[hem_, 0] - cx_, v[hem_, 2] - cz_); o_ = np.argsort(az_h)
                            side_ = np.interp([math.pi / 2, -math.pi / 2], az_h[o_], ys_[o_], period=2 * math.pi).mean()
                            az_v = np.arctan2(v[:, 0] - cx_, v[:, 2] - cz_); drop_ = np.clip(side_ - np.interp(az_v, az_h[o_], ys_[o_], period=2 * math.pi), 0, 0.06)
                            sst = lambda x: x * x * (3 - 2 * x)
                            dh_ = border_dist(v, t, lambda loops, v2: [hem_]); front_ = sst(1 - ramp(np.abs(np.degrees(az_v)), 50.0, 95.0))
                            g.tail_dy = np.minimum(TAIL_LIFT * drop_, TAIL_MAX) * front_ * sst(1 - ramp(np.nan_to_num(dh_, posinf=1.0), 0.0, TAIL_BAND))
                        else: g.tail_dy = np.zeros(len(v))
                    v = v.copy(); v[:, 1] += g.tail_dy
                    if g.hem_loop is not None and HEM_LINE_PASSES:
                        P_ = v[g.hem_loop]
                        for _ in range(HEM_LINE_PASSES): P_ = 0.5 * P_ + 0.25 * (np.roll(P_, 1, 0) + np.roll(P_, -1, 0))
                        v[g.hem_loop] = P_; v = v[g.hem_root]
                if len(g.cuff_border) and CUFF_SMOOTH:
                    # round 11 (REVIEW-07 item 7, "a small angular tab at the cuff end"): the cuff's closing overlap stood out as a point; the
                    # cuff zone is relaxed (Taubin, no shrinking) and its edge loop smoothed along itself, then the cuff ease is restored below
                    if getattr(g, "cuff_root", None) is None: g.cuff_root = wd.weld(v, t)[0]
                    v = _taubin(v, t, wd.opening_zone(v, g.cuff_border, CUFF_SMOOTH_R), iters=CUFF_SMOOTH)
                    for l_ in g.cuff_loops:                           # lambda/mu along the loop: no shrinking (a shrunk loop's rim lip went into the wrist)
                        P_ = v[l_]
                        for k_ in range(2 * CUFF_LOOP_PASSES): P_ = P_ + (0.5 if k_ % 2 == 0 else -0.53) * (0.5 * (np.roll(P_, 1, 0) + np.roll(P_, -1, 0)) - P_)
                        v[l_] = P_
                    v = v[g.cuff_root]
                if len(g.cuff_border) and CUFF_EXTRA:                 # round 7: the heavy woman's wrist came 3.4 mm through her left cuff
                    v, _ = wd.clear_outside(v, t, B, c.tris, EASE + CUFF_EXTRA, zone=wd.opening_zone(v, g.cuff_border, 0.06))
                if SHIRT_FORM and g.spec.get("form"):                  # round 11: hoop tension and drape (REVIEW-07 item 3)
                    if getattr(g, "form", None) is None: g.form = form_setup(g, v, t, c)
                    fw_, hf_, ax_, pk_ = g.form
                    if key == "": g.preform = v.copy()                   # the body-hide mask is measured on the fit BEFORE the form (see build)
                    if pk_ and POCKET_DROP:                              # round 13: the pockets' box relief off BEFORE the form (see pocket_heights)
                        if getattr(g, "pocket_h", None) is None: g.pocket_h = pocket_heights(g.asset, t, pk_)
                        v = pocket_shift(v, t, g.pocket_h, -1.0)
                    v, push_ = shirt_form(v, t, fw_, hem_fade=hf_, axis=ax_)
                    if pk_ and POCKET_DROP: v = pocket_shift(v, t, g.pocket_h, POCKET_RELIEF if c.sex == "m" else POCKET_RELIEF_F, plate=True,
                                                             edge=None if c.sex == "m" else POCKET_EDGE_SMOOTH_F)
                    elif pk_ and POCKET_RELIEF is not None: v = pocket_flatten(v, t, pk_, POCKET_RELIEF)
                    if key == "": g.form_push = push_; log("shirt form on the base: push max %.1f mm, torso mean %.1f mm" % (push_.max() * 1000, push_[fw_ > 0.5].mean() * 1000))
                    if key == "" and os.environ.get("B2_DEBUG_FORM"): np.savez(os.environ["B2_DEBUG_FORM"], pre=g.preform, post=v, fw=fw_, push=push_, t=t)
                if SHIRT_FORM and g.spec.get("form") and COLLAR_SMOOTH and getattr(g, "collar", None) is not None:
                    # round 11 (REVIEW-07 item 3, "a smooth collar outline"; the woman's collar "a crumpled flap with pale facets"): the collar
                    # zone relaxed (Taubin), its edge loops smoothed along themselves with their corners (the collar points) kept, then the
                    # ease over the neck restored
                    cz_, cl_ = g.collar; root_c = wd.weld(v, t)[0]
                    v = _taubin(v, t, cz_, iters=COLLAR_SMOOTH)
                    for l_ in cl_:
                        P_ = v[l_]; e1 = np.roll(P_, -1, 0) - P_; e0 = P_ - np.roll(P_, 1, 0)
                        cosang = (e1 * e0).sum(1) / (np.linalg.norm(e1, axis=1) * np.linalg.norm(e0, axis=1) + 1e-12)
                        keep = (cosang < math.cos(math.radians(COLLAR_CORNER_DEG))) & (P_[:, 2] > float(np.median(v[:, 2])))   # round 13: the collar points only (the nape corner is smoothed)
                        for k_ in range(2 * COLLAR_LOOP_PASSES):
                            L_ = 0.5 * (np.roll(P_, 1, 0) + np.roll(P_, -1, 0)) - P_; P_ = P_ + (0.5 if k_ % 2 == 0 else -0.53) * np.where(keep[:, None], 0.0, L_)
                        v[l_] = P_
                    v = v[root_c]
                    if COLLAR_SETTLE: v = collar_settle(v, t, cz_, cl_, float(c.skeleton.head[list(c.skeleton.names).index("neck_01")][2]), key)
                    v, _ = wd.clear_outside(v, t, B, c.tris, EASE, zone=cz_)
            for inner_slot in g.spec.get("over", []):
                for hv, ht in [(f[h.id], h.tris_kept()) for h in by_slot.get(inner_slot, [])] + [(vd[key], ht_) for vd, ht_ in (inner or {}).get(inner_slot, [])]:
                    top = hv[np.unique(ht), 1].max()
                    # round 6: the shirt over the trousers keeps 4 mm more (the heavy woman's waistband came through the shirt's back)
                    v, _ = wd.clear_outside(v, t, hv, ht, LAYER + (WAIST_EXTRA if (g.slot == "top" and inner_slot == "trousers") else 0.0), zone=1 - ramp(v[:, 1], top + 0.005, top + 0.04))
                    if g.slot == "top" and inner_slot == "trousers" and HEM_TUCK:
                        # round 7: the shirt's front tail stood 15-20 mm off where the trousers recede at the crotch (a "flap" from the
                        # side). Within 40-90 mm of the hem the shirt is drawn toward the NEAREST trouser point (no facing test, which
                        # had kept the clearance rule from reaching it) to HEM_TUCK at most, by at most 20 mm, smoothly
                        from scipy.spatial import cKDTree
                        if getattr(g, "hem_w", None) is None:
                            g.hem_w = 1 - ramp(border_dist(v, t, lambda loops, v_: [min([l for l in loops if np.ptp(v_[l, 0]) > 0.2] or loops, key=lambda l: v_[l, 1].mean())]), 0.04, 0.09)
                        hu_ = np.unique(ht); dn_, jn_ = cKDTree(hv[hu_]).query(v); dirn_ = (hv[hu_][jn_] - v) / np.maximum(dn_, 1e-9)[:, None]
                        root_, tw_ = wd.weld(v, t)
                        mv_ = wd.smooth_field(np.clip(dn_ - HEM_TUCK, 0, 0.020) * g.hem_w, tw_, 4, keep_max=False)
                        v = v + dirn_[root_] * mv_[root_][:, None]          # split (UV seam) copies take their weld root's move
                    if g.slot == "top" and inner_slot == "trousers" and HEM_LIE:
                        # round 6: the shirt's front tail stood 15-20 mm off the trousers and showed its inner lip (a "loose flap" from the
                        # side): within 40-90 mm of the hem the shirt comes down to HEM_LIE over the trousers, smoothly
                        if getattr(g, "hem_w", None) is None:
                            g.hem_w = 1 - ramp(border_dist(v, t, lambda loops, v_: [min([l for l in loops if np.ptp(v_[l, 0]) > 0.2] or loops, key=lambda l: v_[l, 1].mean())]), 0.04, 0.09)
                        has_, cl_, ng_, (root_, tw_) = wd.clearance(v, t, hv, ht, reach=0.05)
                        need_ = wd.smooth_field(np.where(has_, np.clip(cl_ - HEM_LIE, 0, 0.03), 0.0) * g.hem_w, tw_, 3, keep_max=False)
                        v = v - ng_ * need_[:, None]
                for vd, ht_ in (inner or {}).get(inner_slot, []):     # a modelled layer (B6's shoe): where the cloth lies on it, the cloth takes ITS shape deltas
                    from scipy.spatial import cKDTree
                    if key == "": dd_, jj_ = cKDTree(vd[""]).query(v); g.ride = ((1 - ramp(dd_, 0.012, 0.045)) * (1 - ramp(v[:, 1], vd[""][:, 1].max() + 0.01, vd[""][:, 1].max() + 0.05)), jj_)
                    else: zz_, jj_ = g.ride; v = v + zz_[:, None] * ((fits[""][g.id] + vd[key][jj_] - vd[""][jj_]) - v)
                    # round 6: the leg above the shoe crumpled into a kink and a lump (the authored hem folds pressed against the shoe and
                    # the ride blend on short legs): relax it (Taubin, no shrinking) from the hem to 50-130 mm above the shoe, then
                    # clear the shoe again
                    ts_ = vd[key][np.unique(ht_), 1].max()
                    v = _taubin(v, t, 1.0 - ramp(v[:, 1], ts_ + RELAX_Z[0], ts_ + RELAX_Z[1]), iters=HEM_RELAX)     # round 7: to 200-340 mm (the inner-shin crease)
                    v, _ = wd.clear_outside(v, t, vd[key], ht_, LAYER, zone=1 - ramp(v[:, 1], ts_ + 0.005, ts_ + 0.04))
            if getattr(g, "hug", None) is not None:                 # trousers under the shirt: down onto the skin (REVIEW-04: pocket pieces came through the shirt)
                has, cl, ng, _ = wd.clearance(v, t, B, c.tris, reach=0.06)
                d_ = -ng * (np.where(has, np.clip(cl - HUG, 0, 0.05), 0.0) * g.hug)[:, None]
                no = ~has & (g.hug > 0)
                if no.any() and has.any():
                    from scipy.spatial import cKDTree
                    hi_ = np.flatnonzero(has); d_[no] = d_[hi_[cKDTree(v[hi_]).query(v[no])[1]]]
                v = v + d_
            if g.spec.get("stiff"): v = stiff_fit(g, v, B, c)
            f[g.id] = wd.follow_main(v0, v, t) if v is not v0 else v
            if g.slot == "top" and SHIRT_FORM and g.spec.get("form"):
                # round 11: the button discs ride on the cloth; where a body's own shape still reaches over one (the top collar button
                # under the heavy woman's chin, 22 mm), the disc is pushed out of the skin
                if getattr(g, "pieces", None) is None:
                    r_, tw_ = wd.weld(v0, t); lb_ = wd.components(tw_, len(v0))[r_]; ids_, cnt_ = np.unique(lb_[lb_ >= 0], return_counts=True)
                    g.pieces = ((lb_ >= 0) & (lb_ != ids_[cnt_.argmax()])).astype(float)
                if g.pieces.any(): f[g.id], _ = wd.clear_outside(f[g.id], t, B, c.tris, EASE, zone=g.pieces)
        fits[key] = f
    return fits


def stiff_fit(g, v, B, c):
    """A cap is a stiff thing: the .mhclo fit carries every bump of the scalp and brow into crown and brim (REVIEW-04:
    "lumpy brim and crown, sits on the brows"). The fitted cap is replaced by the least-squares AFFINE image of the
    authored cap (planes stay planes, the brim stays straight), turned back a little about its rear rim so the brim
    clears the brows, then eased off the scalp where it would cut in."""
    used = np.unique(g.t_full); A0 = g.authored[used]; X = np.c_[A0, np.ones(len(A0))]
    M, *_ = np.linalg.lstsq(X, v[used], rcond=None)
    out = v.copy(); p = X @ M
    k = int(np.argmin(p[:, 2] + 0.3 * p[:, 1])); piv = np.array([0.0, p[k, 1], p[k, 2]])          # rear rim, on the mid-plane
    a = math.radians(CAP_TILT); R = np.array([[1, 0, 0], [0, math.cos(a), math.sin(a)], [0, -math.sin(a), math.cos(a)]])   # front goes up
    out[used] = piv + (p - piv) @ R.T
    out, _ = wd.clear_outside(out, g.tris_kept(), B, c.tris, 0.003, reach=0.03)
    return out


HAIR_F = S + "/hair/ponytail01/ponytail01.mhclo"      # CC0, MakeHuman system assets
# round 7: short CC0 cuts under the cap (neutral ids; sources and authors in CREDITS.md and the manifest)
HAIRS = {"short_a": (S + "/hair/short03/short03.mhclo", "MakeHuman team"), "short_b": (S + "/hair/short02/short02.mhclo", "MakeHuman team"),
         "bob_a": (S + "/hair/bob01/bob01.mhclo", "MakeHuman team"), "bob_b": (E + "/hair01_cc0/hair/toigo_blunt_bob/toigo_blunt_bob.mhclo", "MargaretToigo")}
HAIR_LABEL = {"short_a": "Short cut A", "short_b": "Short cut B", "bob_a": "Bob A", "bob_b": "Bob B", "tucked": "Tucked under the cap (painted hairline)"}
HAIR_PICK = [x for x in os.environ.get("B2_HAIR", "").split(",") if x]     # round 12: no bob any more (B9's hair_cap piece); B2_HAIR=bob_b brings it back for comparison


def tied_hair(c, G, fits):
    """The woman's hair (REVIEW-04: "tied back ... below the cap's opening"): the pack's ponytail, WITHOUT everything the cap
    covers. Seen from the head's centre, a hair vertex whose direction meets the cap's crown is covered; triangles wholly
    covered are left out, and covered vertices of the triangles that stay are drawn in under the cap (4 mm inside its
    surface), on every body. What remains is the hair below the cap's rim and the tail."""
    from scipy.spatial import cKDTree
    a = wd.Asset(HAIR_F); t, tu = a.tris(); cap = G["cap.work_cap"]; cu = np.unique(cap.tris_kept())
    def frame(key):
        cv = fits[key][cap.id][cu]; C = np.array([0.0, cv[:, 1].min() + 0.25 * np.ptp(cv[:, 1]), np.median(cv[:, 2])])
        return cv, C, np.linalg.norm(cv - C, axis=1)
    cv, C, r = frame(""); crown = np.flatnonzero(r < 1.2 * np.median(r))
    hv = a.fit(c.base_v); u = hv - C; d, j = cKDTree((cv[crown] - C) / r[crown, None]).query(u / np.linalg.norm(u, axis=1)[:, None])
    cov = d < 0.07; ci = crown[j]
    # round 6 (REVIEW of round 5: a shard tangle at the cap opening, grey blocks at the temples, a hard edge at the nape): only the
    # TAIL stays. A triangle is kept when none of its vertices is under the cap (no vertex is drawn in any more: that stretched the
    # shards), and only in a connected piece of what is left that hangs away from the head (more than 25 mm off the skin); the
    # shell left at temples and nape goes, and the skin paint (soft, hair-coloured) carries the hair there.
    keep = ~cov[t].any(1)
    _, tw_ = wd.weld(hv, t); lab_ = np.full(len(hv), -1); kt = np.flatnonzero(keep)
    if len(kt):
        sub = wd.components(tw_[kt], len(hv)); lab_ = sub
        dsk, _ = cKDTree(c.base_v[np.flatnonzero(c.base.vgroups["body"])]).query(hv)
        tl_ = sub[tw_[kt, 0]]; far_ = {k for k in set(tl_.tolist()) if dsk[np.unique(tw_[kt][tl_ == k])].max() > 0.025}
        # and the hair at the BACK of the head (behind the ears, more than 115 degrees round from the front, seen from 70 mm behind
        # the eyes), which joins the cap's rim to the tail (without it the tail hung 30-40 mm below the cap; a narrow band of strips
        # alone left scattered scraps); the temples go
        jn_ = list(c.skeleton.names); ec_ = np.mean([c.skeleton.head[jn_.index(n)] for n in ("eye_l", "eye_r") if n in jn_], 0) if "eye_l" in jn_ else np.array([0.0, 0.0, np.median(cv[:, 2]) + 0.08])
        back = np.degrees(np.arctan2(np.abs(hv[:, 0] - ec_[0]), hv[:, 2] - (ec_[2] - 0.07))) > 115.0
        keep[kt] = np.isin(tl_, list(far_)) | back[t[kt]].all(1)
        # no scraps: pieces of fewer than 30 triangles go
        k2 = np.flatnonzero(keep)
        if len(k2):
            lab2 = wd.components(tw_[k2], len(hv)); tl2 = lab2[tw_[k2, 0]]; ids2, cnt2 = np.unique(tl2, return_counts=True)
            keep[k2] = np.isin(tl2, ids2[cnt2 >= 30])
    t, tu = t[keep], tu[keep]; used, tc = compact(t)
    def at(key, Bk):
        h = a.fit(Bk); cvk, Ck, rk = frame(key); uu = h - Ck; rr_ = np.linalg.norm(uu, axis=1); lim = rk[ci] - 0.004
        return h[used]
    v0 = at("", c.base_v); morphs = {k: at(k, c.base_v + d_) - v0 for k, d_ in c.targets.items()}
    log("tied hair: %d of %d triangles kept (the tail; the rest is under the cap or lies on the head)" % (len(tc), len(keep)))
    return a, layer_mesh(c, "hair_tied", v0, tc, "hair_cards", a.uv, tu, a.weights(c.rig.weights)[used], morphs)


def _cap_rim(cap, cvf, C):
    """The cap's head rim (the boundary loop that goes all round the head): (azimuth, height) sorted by azimuth, or (None, None)."""
    t_ = cap.tris_kept(); _, tw = wd.weld(cvf, t_)
    best = None
    for l in wd.boundary_loops(tw, len(cvf)):
        l = np.asarray(l)
        if len(l) < 12: continue
        az = np.arctan2(cvf[l, 0] - C[0], cvf[l, 2] - C[2]); cover = len(np.unique(np.round(az / (2 * math.pi) * 36)))
        if best is None or cover > best[0] or (cover == best[0] and cvf[l, 1].mean() < cvf[best[1], 1].mean()): best = (cover, l)
    if best is None or best[0] < 30: return None, None
    l = best[1]; az = np.arctan2(cvf[l, 0] - C[0], cvf[l, 2] - C[2]); o = np.argsort(az)
    return az[o], cvf[l, 1][o]


def cap_hair(c, G, fits, src, hid, max_draw=0.035):
    """A short cut under the cap (round 7). Seen from the head's centre, a hair vertex whose direction meets the cap's crown is
    under the cap. A triangle stays when at least one vertex is outside; its covered vertices are drawn in to 4 mm under the cap
    ONLY when that moves them less than `max_draw` (round 5's long shards came from far draws); otherwise the triangle goes.
    Pieces of fewer than 30 triangles go."""
    from scipy.spatial import cKDTree
    a = wd.Asset(src); t, tu = a.tris(); cap = G["cap.work_cap"]; cu = np.unique(cap.tris_kept())
    def frame(key):
        cv = fits[key][cap.id][cu]; C = np.array([0.0, cv[:, 1].min() + 0.25 * np.ptp(cv[:, 1]), np.median(cv[:, 2])])
        return cv, C, np.linalg.norm(cv - C, axis=1)
    cv, C, r = frame(""); crown = np.arange(len(cv))      # round 7, second try: the WHOLE cap (crown and brim): hair came through the front panel
    hv = a.fit(c.base_v); u = hv - C; d, j = cKDTree((cv[crown] - C) / r[crown, None]).query(u / np.linalg.norm(u, axis=1)[:, None])
    ci = crown[j]; rr0 = np.linalg.norm(u, axis=1); lim0 = r[ci] - CAP_HAIR_IN
    cov = (d < 0.07) & (rr0 > lim0)                       # at or beyond the cap's surface in its direction (under the brim stays)
    # round 8: slivers came through crown, back and side where the cap's vertices are sparse or open (the strap opening): a hair
    # vertex ABOVE the cap's head rim at its azimuth counts as under the cap too
    rim_az, rim_y = _cap_rim(cap, fits[""][cap.id], C) if CAP_RIM_RULE else (None, None)    # round 8: tried; it crumpled the back and drew hair onto the cap's sides: off
    if rim_az is not None:
        haz = np.arctan2(hv[:, 0] - C[0], hv[:, 2] - C[2]); yr = np.interp(haz, rim_az, rim_y, period=2 * math.pi)
        cov |= (hv[:, 1] > yr - 0.002) & (rr0 > lim0)
    far = cov & ((rr0 - lim0) > max_draw)
    keep = ~far[t].any(1)
    _, tw_ = wd.weld(hv, t); k2 = np.flatnonzero(keep)
    if len(k2):
        lab2 = wd.components(tw_[k2], len(hv)); tl2 = lab2[tw_[k2, 0]]; ids2, cnt2 = np.unique(tl2, return_counts=True); keep[k2] = np.isin(tl2, ids2[cnt2 >= 30])
    t, tu = t[keep], tu[keep]; used, tc = compact(t)
    def at(key, Bk):
        h = a.fit(Bk)
        # round 8: the front strands lay on the cheek (a translucent sheet over it at az 35): hair stays HAIR_OFF_SKIN off the skin,
        # BEFORE the cap's draw-in (pushed after it, hair came out through the cap's sides)
        dd_, jj_ = skin_tree.query(h); nb_ = wd.vertex_normals(Bk, c.tris)[skin_idx[jj_]]; al_ = ((h - Bk[skin_idx[jj_]]) * nb_).sum(1)
        h = h + nb_ * np.where((dd_ < 0.03) & (al_ < HAIR_OFF_SKIN) & front_h, HAIR_OFF_SKIN - al_, 0.0)[:, None]
        cvk, Ck, rk = frame(key); uu = h - Ck; rr_ = np.linalg.norm(uu, axis=1)
        # round 10: the cap test per body (per shape target), not only on the base: on the heavy woman hair came through the cap's
        # side and back where her head and cap differ from the base's
        dk_, jk_ = cKDTree((cvk - Ck) / rk[:, None]).query(uu / np.maximum(rr_, 1e-9)[:, None]); limk = rk[jk_] - CAP_HAIR_IN
        lim = np.where(cov, np.minimum(rk[ci] - CAP_HAIR_IN, limk), limk); covk = cov | (dk_ < 0.07)
        h = Ck + uu * np.where(covk & (rr_ > lim), lim / np.maximum(rr_, 1e-9), 1.0)[:, None]
        return h[used]
    front_h = np.abs(np.degrees(np.arctan2(hv[:, 0] - C[0], hv[:, 2] - C[2]))) < 100.0      # the push only round the face (at the back it crumpled the cards)
    head_ = c.base_v[:, 1] > float(cv[:, 1].min()) - 0.25; skin_idx = np.flatnonzero(head_ & c.base.vgroups["body"].astype(bool)); skin_tree = cKDTree(c.base_v[skin_idx])
    v0 = at("", c.base_v); morphs = {k: at(k, c.base_v + d_) - v0 for k, d_ in c.targets.items()}
    log("hair %s: %d of %d triangles kept, %d vertices drawn in under the cap" % (hid, len(tc), len(keep), int(cov[used].sum())))
    return a, layer_mesh(c, "hair_" + hid, v0, tc, "hair_cards_" + hid, a.uv, tu, a.weights(c.rig.weights)[used], morphs)


def _first_hit(V, T, o, dv):
    """Index of the first triangle a ray o + t dv (t > 0) meets, and the point; (None, None) if none (Moller-Trumbore)."""
    a = V[T[:, 0]]; e1 = V[T[:, 1]] - a; e2 = V[T[:, 2]] - a; p = np.cross(dv, e2); det = (e1 * p).sum(1); ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0); s_ = o - a; u = (s_ * p).sum(1) * inv; q = np.cross(s_, e1); v = (q * dv).sum(1) * inv; t = (q * e2).sum(1) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
    if not hit.any(): return None, None
    k = np.flatnonzero(hit)[np.argmin(t[hit])]; return int(k), o + t[k] * dv


def _shoe_in_front(cloth_v, cloth_t, shoe_v, shoe_t, i, near=0.008):
    """True when, from some outward direction (12 azimuths x 4 elevations the cloth point faces), the first surface on the
    way to cloth vertex i is the shoe and lies within `near` of it: the shoe shows through the cloth at that point."""
    ng = wd.vertex_normals(cloth_v, cloth_t)[i]; V = np.vstack([cloth_v, shoe_v]); T = np.vstack([cloth_t, shoe_t + len(cloth_v)])
    for az in range(-150, 181, 30):
        for el in (0, 20, 40, 60):
            a, e = math.radians(az), math.radians(el); dv = np.array([math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)])
            if ng @ dv < 0.1: continue
            k, x = _first_hit(V, T, cloth_v[i] + dv, -dv)
            if k is not None and k >= len(cloth_t) and np.linalg.norm(x - cloth_v[i]) < near: return True
    return False


def top4(W):
    W = np.asarray(W.todense() if sp.issparse(W) else W, dtype=np.float64); J = np.argsort(-W, 1)[:, :4]; w = np.take_along_axis(W, J, 1)
    w = (w / np.clip(w.sum(1, keepdims=True), 1e-9, None)).astype(np.float32); w[w < 1e-4] = 0; w = w / w.sum(1, keepdims=True)
    return np.where(w > 0, J, 0), w


# ---- round 11 (REVIEW-07 item 6, rig parity): every mesh of the dressed package carries the body's eight-influence set as the body
# package does (build_body.SKIN8: _JOINTS8_0/1, _WEIGHTS8_0/1, heaviest first, sum 1); JOINTS_0 / WEIGHTS_0 stay the 4-influence fit
SKIN8 = bb.SKIN8


def dense_w(J, W, nb):
    J = np.asarray(J, np.int64); W = np.asarray(W, np.float64); D = np.zeros((len(W), nb))
    for k in range(W.shape[1]): np.add.at(D, (np.arange(len(W)), J[:, k]), W[:, k])
    return D


def dense8(m, nb):
    """A mesh's eight-influence weights as a dense (n, nb) matrix; a mesh without them: its own weights (4-set, dense or sparse)."""
    a = m.attrs or {}
    if all(k in a for k in SKIN8): return dense_w(np.c_[a[SKIN8[0]], a[SKIN8[2]]], np.c_[a[SKIN8[1]], a[SKIN8[3]]], nb)
    W = m.weights
    if sp.issparse(W): W = np.asarray(W.todense(), np.float64)
    W = np.asarray(W, np.float64)
    if m.joints is not None: return dense_w(m.joints, W, nb)
    D = np.zeros((len(W), nb)); D[:, :W.shape[1]] = W; return D


def put8(m, D):
    """Set a mesh's eight-influence attributes from dense or sparse full weights (n, nb)."""
    S_ = sp.csr_matrix(D); S_.eliminate_zeros(); J8, W8 = bb.eight(S_)
    m.attrs = {**(m.attrs or {}), **bb.skin_attrs(None, J8, W8)}
    return m


MERGE_COLLAR_INTO_SHOES = os.environ.get("B2_NO_MERGE") is None   # round 11 (REVIEW-07 item 6: 12 draw calls with B9's hair)


def atlas_merge(ma, mb, mat_a, mat_b):
    """Two of B6's plain-class props as ONE mesh and ONE material (one draw call): b's maps stacked under a's, left-aligned and
    edge-padded; UVs remapped (both lie inside 0..1). Both must always be shown together (the trainer and the collar band: shoes and
    top are mandatory slots with one option each). -> (mesh named as a, material dict for a's name)."""
    ia_, ib_ = mat_a.get("_images", {}), mat_b.get("_images", {}); out_imgs = {}; made = {}; sizes = None
    for slot, pa in ia_.items():
        pb = ib_.get(slot)
        if pb is None: raise RuntimeError("atlas_merge: %s has no %s" % (mb.name, slot))
        if (pa, pb) not in made:
            A_ = np.asarray(Image.open(pa).convert("RGB")); B_ = np.asarray(Image.open(pb).convert("RGB")); W_ = max(A_.shape[1], B_.shape[1])
            pad = lambda X: np.pad(X, ((0, 0), (0, W_ - X.shape[1]), (0, 0)), mode="edge")
            q_ = os.path.join(mt.CACHE, "atlas_%s__%s.jpg" % (os.path.splitext(os.path.basename(pa))[0], os.path.splitext(os.path.basename(pb))[0]))
            nrm = "normal" in slot.lower()
            Image.fromarray(np.vstack([pad(A_), pad(B_)])).save(q_, quality=95 if nrm else 90, subsampling=0 if nrm else 2); made[(pa, pb)] = q_
            sz = (A_.shape[1], A_.shape[0], B_.shape[1], B_.shape[0], W_)
            if sizes is not None and sizes != sz: raise RuntimeError("atlas_merge: map sizes differ between slots")
            sizes = sz
        out_imgs[slot] = made[(pa, pb)]
    wa, ha, wb, hb, W_ = sizes; H_ = ha + hb
    ua = np.asarray(ma.uv, float).copy(); ua[:, 0] *= wa / W_; ua[:, 1] = 1 - (1 - ua[:, 1]) * ha / H_
    ub = np.asarray(mb.uv, float).copy(); ub[:, 0] *= wb / W_; ub[:, 1] = ub[:, 1] * hb / H_
    na, nb_ = len(ma.v), len(mb.v); nbj = None
    Wa, Wb = ma.weights, mb.weights
    if sp.issparse(Wa): Wa = np.asarray(Wa.todense())
    if sp.issparse(Wb): Wb = np.asarray(Wb.todense())
    if ma.joints is not None or mb.joints is not None: raise RuntimeError("atlas_merge: expects dense weights (B6's props)")
    keys = list(dict.fromkeys(list(ma.morphs) + list(mb.morphs)))
    morphs = {k: np.vstack([np.asarray(ma.morphs.get(k, np.zeros((na, 3)))), np.asarray(mb.morphs.get(k, np.zeros((nb_, 3))))]) for k in keys}
    aa, ab_ = ma.attrs or {}, mb.attrs or {}; attrs = {}
    for k in dict.fromkeys(list(aa) + list(ab_)):
        xa = np.asarray(aa[k]) if k in aa else None; xb = np.asarray(ab_[k]) if k in ab_ else None
        if xa is None: xa = np.zeros((na,) + xb.shape[1:], xb.dtype)
        if xb is None: xb = np.zeros((nb_,) + xa.shape[1:], xa.dtype)
        attrs[k] = np.concatenate([xa, xb])
    m = glb.Mesh(ma.name, np.vstack([ma.v, mb.v]), np.vstack([ma.tris, np.asarray(mb.tris) + na]), ma.material, uv=np.vstack([ua, ub]),
                 tri_uv=np.vstack([ma.tri_uv, np.asarray(mb.tri_uv) + len(ma.uv)]), weights=np.vstack([Wa, Wb]), morphs=morphs, morph_normals=False,
                 normals=np.vstack([ma.normals, mb.normals]), attrs=attrs)
    mat = {k: v for k, v in mat_a.items() if k != "_images"}; mat["_images"] = out_imgs
    return m, mat


WEIGHT_SMOOTH = float(os.environ.get("B2_WEIGHT_SMOOTH", 0.5))   # round 13: share of each step toward the neighbours' weights (front torso of the shirt)
WEIGHT_SMOOTH_ITERS = 24


def smooth_cloth_weights(m, v, t, alpha, nbj):
    """Laplacian smoothing of a cloth mesh's skin weights (4-set, 8-set and _DQS) where alpha > 0 (0..1 per vertex), over its welded
    triangles; renormalised to sum 1 and refitted to the top 4 / top 8."""
    root, tw = wd.weld(v, t); n = len(v)
    i = np.r_[tw[:, 0], tw[:, 1], tw[:, 2], tw[:, 1], tw[:, 2], tw[:, 0]]; j = np.r_[tw[:, 1], tw[:, 2], tw[:, 0], tw[:, 0], tw[:, 1], tw[:, 2]]
    A = sp.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr(); A.data[:] = 1.0; deg = np.asarray(A.sum(1)).ravel()
    L = sp.diags(1.0 / np.maximum(deg, 1)) @ A; al = (alpha * (deg > 0))[:, None]
    D4 = dense_w(m.joints, m.weights, nbj); D8 = dense8(m, nbj); dq = np.asarray(m.attrs["_DQS"], float)[:, None]
    for _ in range(WEIGHT_SMOOTH_ITERS):
        D4 = D4 + al * (L @ D4 - D4); D8 = D8 + al * (L @ D8 - D8); dq = dq + al * (L @ dq - dq)
    D4, D8, dq = D4[root], D8[root], dq[root]
    J_, W_ = top4(D4); m.joints = J_; m.weights = W_; put8(m, D8 / np.maximum(D8.sum(1, keepdims=True), 1e-9)); m.attrs["_DQS"] = dq.ravel().astype(np.float32)
    log("cloth weights smoothed on %d vertices of %s" % (int((alpha > 0.05).sum()), m.name))


DROP_HIDDEN_BODY = os.environ.get("B2_KEEP_BODY") is None    # round 13: body triangles always deep under the mandatory clothes leave the index buffer


def drop_triangles(path, mesh_name, keep):
    """Rewrite a written GLB with fewer triangles in one mesh's index buffer: `keep` (bool per triangle, in the order the mesh was
    written); every vertex attribute, the vertex order and all other data stay as they are. -> triangles dropped."""
    import struct
    js, blob = glb.read_glb(path)
    me = next(x for x in js["meshes"] if x["name"] == mesh_name); pr = me["primitives"][0]; ai = pr["indices"]; acc = js["accessors"][ai]
    I = np.asarray(glb.accessor(js, blob, ai)).reshape(-1, 3)
    if len(I) != len(keep): raise RuntimeError("drop_triangles: %d triangles written, %d flags" % (len(I), len(keep)))
    dt = np.uint16 if acc["componentType"] == 5123 else np.uint32; new = np.ascontiguousarray(I[keep].astype(dt)).tobytes()
    if sum(1 for a in js["accessors"] if a.get("bufferView") == acc["bufferView"]) != 1: raise RuntimeError("drop_triangles: shared index view")
    out = b""; views = js["bufferViews"]
    for k, bv in enumerate(views):
        data = new if k == acc["bufferView"] else blob[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        out += b"\0" * ((-len(out)) % 4); bv["byteOffset"] = len(out); bv["byteLength"] = len(data); out += data
    out += b"\0" * ((-len(out)) % 4); js["buffers"][0]["byteLength"] = len(out)
    acc["count"] = int(keep.sum()) * 3; acc["byteOffset"] = 0
    if "min" in acc or "max" in acc: acc["min"] = [int(I[keep].min())]; acc["max"] = [int(I[keep].max())]
    j = json.dumps(js, separators=(",", ":")).encode(); j += b" " * ((-len(j)) % 4)
    d = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(j) + 8 + len(out)) + struct.pack("<II", len(j), 0x4E4F534A) + j + struct.pack("<II", len(out), 0x004E4942) + out
    open(path, "wb").write(d)
    return int((~keep).sum())


def finish(g, v):
    """Asset-numbered fitted vertices -> the exported part's vertices (compacted, with its edge geometry)."""
    t = g.tris_kept(); used, tc = compact(t)
    p = v[used]
    if g.spec.get("rim"):
        if g.rim is None:
            # the neck loop of a top gets a 11 mm lip instead of 22: B6's collar fills that opening, and a long lip met the neck
            ny = g.neck_y if g.slot == "top" else 1e9
            g.rim = wd.Rim(p, tc, g.tu[g.keep_tri], keep=lambda q: np.linalg.norm(q.max(0) - q.min(0)) > 0.07, lap_scale=lambda q: 0.12 if q[:, 1].mean() > ny else 1.0, **g.spec["rim"])
        p = g.rim.apply(p)
    return p, used, tc


def merge_meshes(name, meshes, material):
    v = []; tris = []; uv = []; tuv = []; J = []; W = []; D = []; nv = 0; nuv = 0; names = []
    for m in meshes:
        for k in m.morphs:
            if k not in names: names.append(k)
    morphs = {k: [] for k in names}
    for m in meshes:
        v.append(m.v); tris.append(m.tris + nv); uv.append(m.uv); tuv.append(m.tri_uv + nuv); J.append(m.joints); W.append(m.weights); D.append(m.attrs["_DQS"])
        for k in names: morphs[k].append(m.morphs.get(k, np.zeros_like(m.v)))
        nv += len(m.v); nuv += len(m.uv)
    a8 = {k: np.vstack([np.asarray(m.attrs[k]) for m in meshes]) for k in SKIN8} if all(all(k in (m.attrs or {}) for k in SKIN8) for m in meshes) else {}
    return glb.Mesh(name, np.vstack(v), np.vstack(tris), material, uv=np.vstack(uv), tri_uv=np.vstack(tuv), joints=np.vstack(J), weights=np.vstack(W),
                    morphs={k: np.vstack(x) for k, x in morphs.items()}, attrs={"_DQS": np.concatenate(D), **a8})


def collar_liner(c, g, fits, neck, material, shirt_mesh, d_in=0.016, d_out=0.040, band=None):
    """The inside of the collar: a strip of the skin's own topology, from 16 to 40 mm below the collar band's top edge, lifted off
    the skin by 1.5 mm at its upper edge and out to just under the shirt at its lower edge. It is cloth (the shirt's material),
    it closes the gap between neck and shirt, and it lies over the line where the body mask cuts the skin (30 mm), so a camera
    looking down into the collar sees skin, then cloth, never the cut or the inside of the figure. Evaluated per body, so it
    follows every shape target; weights are the skin's."""
    if "d2" not in neck: return None
    d2, z = neck["d2"], neck["z"]
    ok = (z > 0.5) & (d2 >= d_in) & (d2 <= d_out + 0.012)
    if band is not None and os.environ.get("B2_LINER_UNDER_BAND") is None:
        # round 7: no liner where B6's band lies over it (the band hides that skin itself); lowered under the band, the liner showed
        # through its middle on the man and cut its lower edge into a saw-tooth on the woman
        from scipy.spatial import cKDTree
        bn_ = wd.vertex_normals(c.base_v, c.tris); bb_ = np.asarray(band[0], float)
        db_, ib_ = cKDTree(bb_).query(c.base_v, k=8, distance_upper_bound=0.02); okb_ = np.isfinite(db_); rel_ = bb_[np.where(okb_, ib_, 0)] - c.base_v[:, None, :]
        al_ = (rel_ * bn_[:, None, :]).sum(2); la_ = np.linalg.norm(rel_ - bn_[:, None, :] * al_[..., None], axis=2)
        under = (okb_ & (la_ < 0.004) & (al_ > -0.004) & (al_ < 0.006)).any(1)      # tight: at 8 mm / 12 mm the liner was gone below the band too (1 px of skin in the seated test)
        ok &= ~under
    tsel = ok[c.tris].all(1)
    if tsel.sum() < 8: return None
    used, tc = compact(c.tris[tsel]); t_ = np.clip((d2[used] - d_in) / (d_out - d_in), 0, 1); t_ = t_ * t_ * (3 - 2 * t_)
    st = g.tris_kept(); sv = np.unique(st)
    def at(B, gv, bv=None):
        n = wd.vertex_normals(B, c.tris)[used]; p = B[used]
        from scipy.spatial import cKDTree
        dd, ii = cKDTree(gv[sv]).query(p, k=12, distance_upper_bound=0.06)
        rel = gv[sv][np.where(np.isfinite(dd), ii, 0)] - p[:, None, :]; along = (rel * n[:, None, :]).sum(2); lat = np.linalg.norm(rel - n[:, None, :] * along[..., None], axis=2)
        good = np.isfinite(dd) & (along > 0.001) & (lat < 0.02)
        clear = np.where(good, along, np.inf).min(1); clear = np.where(np.isfinite(clear), clear, 0.012)
        w = wd.smooth_field(np.clip(clear - 0.003, 0.0015, 0.030), tc, 4, keep_max=False)
        lift = 0.0015 + (w - 0.0015) * t_
        if bv is not None:
            # round 7: where B6's collar band lies over the liner the liner stays 0.8 mm under it (its upper part cut through the band's
            # lower edge: a serrated line between the teal band and the shirt-coloured liner in C1)
            db, ib = cKDTree(bv).query(p, k=8, distance_upper_bound=0.02); okb = np.isfinite(db); relb = bv[np.where(okb, ib, 0)] - p[:, None, :]
            alb = (relb * n[:, None, :]).sum(2); latb = np.linalg.norm(relb - n[:, None, :] * alb[..., None], axis=2); vb = okb & (latb < 0.006) & (alb > -0.003)
            capb = np.where(vb, alb - 0.0008, np.inf).min(1)
            lift = np.where(np.isfinite(capb), np.clip(np.minimum(lift, capb), 0.0002, None), lift)
            lift = wd.smooth_field(lift, tc, 2, keep_max=False)
        return p + n * lift[:, None]
    bkey = (lambda k: None) if band is None else (lambda k: np.asarray(band[0], float) + (np.asarray(band[1][k], float) if k else 0.0))
    v0 = at(c.base_v, fits[""][g.id], bkey(""))
    morphs = {k: at(c.base_v + d, fits[k][g.id], bkey(k) if (band is None or k in band[1]) else bkey("")) - v0 for k, d in c.targets.items()}
    # real UVs (round 5): with every UV on one point the normal map had no tangent frame and the liner shaded in blocks
    # (REVIEW-04 head list, 7). Unrolled round the neck at the shirt's own texel density, placed on the shirt's back panel.
    sv_ = np.asarray(shirt_mesh.v); stt = np.asarray(shirt_mesh.tris); suv = np.asarray(shirt_mesh.uv); stu = np.asarray(shirt_mesh.tri_uv)
    P3 = sv_[stt]; a3 = np.linalg.norm(np.cross(P3[:, 1] - P3[:, 0], P3[:, 2] - P3[:, 0]), axis=1).sum(); U3 = suv[stu]; e1 = U3[:, 1] - U3[:, 0]; e2 = U3[:, 2] - U3[:, 0]
    dens = math.sqrt(np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum() / max(a3, 1e-9))                 # UV units per metre
    back = np.flatnonzero(np.abs(sv_[:, 0]) < 0.03); bi = back[np.argmin(np.abs(sv_[back, 1] - np.percentile(sv_[:, 1], 60)) + 10 * (sv_[back, 2] - sv_[back, 2].min()))]
    uv0 = suv[stu[np.argwhere(stt == bi)[0][0], np.argwhere(stt == bi)[0][1]]]
    cx = v0[:, [0, 2]].mean(0); th = np.arctan2(v0[:, 0] - cx[0], -(v0[:, 2] - cx[1])); rad = float(np.linalg.norm(v0[:, [0, 2]] - cx, axis=1).mean())    # theta = 0 at the nape, the wrap at the throat
    uvl = uv0 + dens * np.c_[th * rad, v0[:, 1] - v0[:, 1].mean()]; n_ = len(v0)
    uv2 = np.vstack([uvl, uvl + [dens * 2 * math.pi * rad, 0]]); tuv = tc.copy(); wrap = np.ptp(th[tc], axis=1) > math.pi
    tuv[wrap] = np.where(th[tc[wrap]] < 0, tc[wrap] + n_, tc[wrap])
    return layer_mesh(c, "liner", v0, tc, material, uv2, tuv, c.rig.weights[used], morphs)


def layer_mesh(c, name, v0, tris, material, uv, tri_uv, W_default, morphs):
    """A mesh that follows the body on RR's rig: weights painted on the MPFB default bones -> the 82 joints, the 4-influence
    fit and the `_DQS` mask by RR's own rule (rig.for_layer), so cloth and skin deform alike."""
    J4, W4, dqs, W82 = rr.for_layer(c.pack, W_default, v0)
    J4 = np.asarray(J4); W4 = np.asarray(W4, dtype=np.float32)
    if J4.shape[1] < 4:                                               # rigid parts come back with fewer columns
        pad = 4 - J4.shape[1]; J4 = np.hstack([J4, np.zeros((len(J4), pad), J4.dtype)]); W4 = np.hstack([W4, np.zeros((len(W4), pad), np.float32)])
    m = glb.Mesh(name, v0, tris, material, uv=uv, tri_uv=tri_uv, joints=J4, weights=W4, morphs=morphs, attrs={"_DQS": np.asarray(dqs, dtype=np.float32)})
    return put8(m, W82)                                               # round 11: and the eight-influence set from the same full weights


CLAY_EYE = (14, 32)   # round 11 (budget): rings and segments of the clay style's blank eyeballs (B7's 30 x 64 = 3,648 triangles each, for an
                      # incised iris this blank ball does not carry; 14 x 32 = 800, the silhouette is under the lids)


def clay_style(c, e, erig, jnames, sex, base, up, out, name, bview0, W8b=None):
    """B7's clay figure as extra meshes of the dressed package, so RL's `styles` block can swap to it with the same joints,
    pose, shape and sole height: `body_clay` (B7's style operator on the same vertex array; no subdivision here: budget),
    `clay_eyeball_l/r` (B7's blank eyeballs), `shoe_last` (B6's last). Shape on the CPU from <name>.clay.shape.bin."""
    import abstract as ab, props
    c2 = copy.copy(c); c2.base_v = e.base_v; c2.targets = e.targets
    st = ab.Style(c2, eye=e.eye); v = st.base(); lids = ab.lid_rotations(e, ab.P["lid_lower"]); nb = len(jnames); NV = len(v)
    for m_, R_, C_, deg in lids: v[m_] = C_ + np.einsum("nij,nj->ni", R_, v[m_] - C_)
    v = ab.lid_lip(st, e, v); st.v_style = v
    tg = {t: ab.styled_target(st, e, lids, t, d) for t, d in e.targets.items()}
    W4 = st.fill_rows(sp.csr_matrix(erig["W"])); dq = np.asarray(st.fill_rows(sp.csr_matrix(np.asarray(erig["dqs"], dtype=np.float64)[:, None])).todense()).ravel()
    lastsrc = np.load(os.path.join(props.SRC, "operator-" + sex, "last.npz")); collar = float(lastsrc["v"][:, 1].max()) - 0.014
    tris, tri_uv = c.tris, c.tri_uv; under = v[tris, 1].max(1) < collar; tris, tri_uv = tris[~under], tri_uv[~under]
    used = np.unique(tris); src = np.zeros(NV, np.float32); src[used] = np.arange(len(used)); mat = "clay_figure"
    meshes = [glb.Mesh("body_clay", v, tris, mat, uv=base.uv, tri_uv=tri_uv, weights=W4, morphs={}, attrs={"_DQS": dq.astype(np.float32), "_SRC": src})]
    if W8b is not None: put8(meshes[0], st.fill_rows(sp.csr_matrix(W8b)))          # round 11: the body's eight, filled patches as abstract.py
    bbase = [v[used] + up]; bt = {t: [d[used]] for t, d in tg.items()}; nrow = len(used); er = st.eye_r
    for s_ in ("l", "r"):
        j = jnames.index("eye_" + s_); old_ = (ab.P["eye_rings"], ab.P["eye_segments"]); ab.P["eye_rings"], ab.P["eye_segments"] = CLAY_EYE
        try: ev0, et, dirs, ang = ab.eyeball(np.zeros(3), s_, er)
        finally: ab.P["eye_rings"], ab.P["eye_segments"] = old_
        a, b = math.radians(ab.P["gaze_down_deg"]), math.radians(ab.P["gaze_in_deg"] * (-1 if s_ == "l" else 1))
        Rg = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]]) @ np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
        ev = st.eye[s_.upper()] + er * (dirs @ Rg.T)
        Wm = sp.csr_matrix((np.ones(len(ev)), (np.arange(len(ev)), np.full(len(ev), j))), shape=(len(ev), nb))
        meshes.append(put8(glb.Mesh("clay_eyeball_" + s_, ev, et, mat, uv=None, tri_uv=None, weights=Wm, morphs={}, attrs={"_DQS": np.zeros(len(ev), np.float32), "_SRC": (nrow + np.arange(len(ev))).astype(np.float32)}), Wm))
        bbase.append(ev + up)
        for t in bt: bt[t].append(np.repeat(np.asarray(e.joint_targets[t][j])[None], len(ev), 0))
        nrow += len(ev)
    extra, pmats, pinfo = props.build([bview0], jnames, which=("last",), lift=0.0, pkg="operator-" + sex, body=bview0)
    last = extra[0]; last.material = mat; meshes.append(last)
    if not all(k in (last.attrs or {}) for k in SKIN8): put8(last, dense8(last, nb))
    blk, _ = bb.write_shape_bin(os.path.join(out, name + ".clay.shape.bin"), np.concatenate(bbase), {t: np.concatenate(x) for t, x in bt.items()})
    blk["meshes"] = ["body_clay", "clay_eyeball_l", "clay_eyeball_r"]
    al = [float(x) for x in ab.P["albedo"]]; names_ = ["body_clay", "clay_eyeball_*", last.name]
    log("clay style: body_clay %d triangles, last %s, style offset max %.1f mm" % (len(tris), last.name, float(np.linalg.norm(v - e.base_v, axis=1).max() * 1000)))
    return {"meshes": meshes, "bake": blk, "mats": {mat: {"pbrMetallicRoughness": {"baseColorFactor": al + [1.0], "metallicFactor": 0.0, "roughnessFactor": float(ab.P["roughness"])}}},
            "styles": {"dressed": {"label": "Dressed", "hide": names_},
                       "clay": {"label": "Clay figure (B7's style)", "wardrobe": False, "bodyMask": False, "show": names_, "material": {"color": al, "roughness": float(ab.P["roughness"]), "sheen": 0, "clearcoat": 0}}}}


# ------------------------------------------------------------------------------------------------ the build
def relaxed_expression(base_v):
    """A trace of attention on the rest face, from MakeHuman's expression units, baked into the rest shape (so the head is
    not a symmetric statue): inner brows a little up, mouth corners barely engaged, the left side about a third stronger.
    Lid opening is B5's (eyes.eye_lid_fit). Sub-millimetre to about 1 mm; face and its helper vertices only."""
    T = mh.list_targets(); U = "expression/units/caucasian/"
    w = {"eyebrows-left-inner-up": 0.10, "eyebrows-right-inner-up": 0.07, "eyebrows-left-up": 0.04, "eyebrows-right-up": 0.02, "mouth-corner-puller": 0.07, "mouth-elevation": 0.03}
    d = np.zeros_like(base_v)
    for k, x in w.items():
        name = U + k if (U + k) in T else k
        t = mh.target_dense(name)
        if "left" not in k and "right" not in k: t = t * (1.0 + 0.3 * np.tanh(base_v[:, 0] / 0.02))[:, None]      # +X is the left side
        d += x * t
    return d


def build(sex="m", tone="light", out=None, name=None, pick=None, colours=None, check=False, export_garments=True, props_which=None, iris=None):
    t0 = time.time()
    iris = iris or getattr(eyes, "IRIS_BY_TONE", {}).get(tone, "hazel")       # round 11 (eye specialist round 6): the iris preset per skin tone
    name = name or "operator-" + sex
    out = out or os.path.join(LAB, "packages", name); os.makedirs(os.path.join(out, "maps"), exist_ok=True)
    pick = {**DEFAULT, **(pick or {})}; pick = {k: v for k, v in pick.items() if v and v != "none"}
    c0 = bb.context(sex); c = copy.copy(c0); base = c.base
    expr = eyes.eye_rest_expression(c0.base_v, sex); c.base_v = c0.base_v + expr; B0 = c.base_v      # B5 round 3: level, closed, neutral mouth
    # round 9 (B5 round 4): no brow override any more: brows are eyes.BROWS[sex]
    log("relaxed expression: max %.2f mm on %d vertices" % (np.abs(expr).max() * 1000, int((np.abs(expr).max(1) > 1e-5).sum())))
    e = eyes.eye_context(c); erig = e.rig; jnames = list(erig["skeleton"].names)        # B5: lids re-seated on the ball, four lid joints
    # round 11 (REVIEW-07 item 6): the body's eight-influence set (RR's, as in the body package and the clay style); the rows B5's eye
    # context changed (lid vertices on the lid joints) keep B5's weights, as abstract.py does
    nbj = len(jnames); NV_ = len(B0); assert list(jnames[:len(c.skeleton.names)]) == list(c.skeleton.names)
    E4_ = sp.csr_matrix(erig["W"]).astype(np.float64); C4_ = sp.csr_matrix((np.asarray(c.W4, np.float64).ravel(), (np.repeat(np.arange(NV_), c.W4.shape[1]), np.asarray(c.J4).ravel())), shape=(NV_, nbj))
    b5rows = np.asarray(abs(E4_ - C4_).max(1).todense()).ravel() > 1e-4
    W8b = sp.csr_matrix((np.asarray(c.W8, np.float64).ravel(), (np.repeat(np.arange(NV_), 8), np.asarray(c.J8).ravel())), shape=(NV_, nbj))
    W8b = (sp.diags((~b5rows).astype(float)) @ W8b + sp.diags(b5rows.astype(float)) @ E4_).tocsr(); W8b.eliminate_zeros()
    J8b, W8b8 = bb.eight(W8b); body8 = bb.skin_attrs(None, J8b, W8b8)
    log("eight-influence set on the body: %d rows keep B5's eye-context weights" % int(b5rows.sum()))
    body_idx = np.flatnonzero(base.vgroups["body"]); bn = wd.vertex_normals(B0, c.tris)
    G = {gid: Garment(gid, c) for gid in GARMENTS}
    log("garments", {gid: g.asset.n for gid, g in G.items()})

    # ---- the one shoe: B6's safety trainer, built FIRST on the bare body, so every trouser hem is laid over it (round 5)
    trainer = None; shoe_inner = {}; sole_h = 0.0; shoe_mats = {}; shoe_info = None
    # round 11: the props bind on the body's EIGHT-influence weights (B6's props.Surface interpolates the reference's weights; the last
    # reads the _JOINTS8 attributes), so shoes, headset, collar and last skin as the body under them does
    bview0 = glb.Mesh("body", e.base_v, c.tris, "skin_body", uv=base.uv, tri_uv=c.tri_uv, weights=W8b, morphs=dict(e.targets), attrs={"_DQS": np.asarray(erig["dqs"], dtype=np.float32), **body8})
    if props_which and "shoes" in props_which:
        import props
        ex_, shoe_mats, shoe_info = props.build([bview0], jnames, which=("shoes",), lift=0.0, pkg="operator-" + sex, body=bview0)
        trainer = ex_[0]; sole_h = float(shoe_info["soleHeight_m"]); tv_ = np.asarray(trainer.v, float); tt_ = np.asarray(trainer.tris)
        if not all(k in (trainer.attrs or {}) for k in SKIN8): put8(trainer, dense8(trainer, nbj))      # round 11: from the body's eight
        shoe_inner = {"shoes": [({"": tv_, **{k: tv_ + np.asarray(trainer.morphs[k]) for k in c.targets}}, tt_)]}
        log("trainer first: %d vertices, sole %.1f mm, lowest point %.1f mm" % (len(tv_), sole_h * 1000, tv_[:, 1].min() * 1000))
    # ---- where the trousers are under the worn-out shirt (its hem line by azimuth): there they hug the skin
    tops = [g for g in G.values() if g.slot == "top"]
    if tops:
        sv_ = tops[0].asset.fit(B0); _, tw_ = wd.weld(sv_, tops[0].t_full)
        loops = [np.asarray(l) for l in wd.boundary_loops(tw_, tops[0].asset.n) if len(l) >= 12 and np.ptp(sv_[np.asarray(l), 0]) > 0.2]
        if loops:
            hem = min(loops, key=lambda l: sv_[l, 1].mean()); cz = sv_[hem, 2].mean(); ang = np.arctan2(sv_[hem, 0], sv_[hem, 2] - cz); o_ = np.argsort(ang)
            for g in G.values():
                if g.slot == "trousers":
                    tv2 = g.asset.fit(B0); hy = np.interp(np.arctan2(tv2[:, 0], tv2[:, 2] - cz), ang[o_], sv_[hem, 1][o_], period=2 * math.pi)
                    g.hug = ramp(tv2[:, 1], hy + 0.035, hy + 0.075)
                    log("hug zone of %s: %d vertices, shirt hem at %.3f..%.3f m" % (g.id, int((g.hug > 0.5).sum()), sv_[hem, 1].min(), sv_[hem, 1].max()))

    # ---- shoes: the shaft far above the highest trouser hem is always inside a trouser leg: remove it
    hems = [np.percentile(g.asset.fit(B0)[np.unique(g.t_full), 1], 1) for g in G.values() if g.slot == "trousers"]
    for g in G.values():
        if g.slot == "shoes":
            v = g.asset.fit(B0); g.keep_tri = v[g.t_full].mean(1)[:, 1] < max(hems) + 0.04

    # ---- fits on the base and on every shape target
    bodies = {"": B0, **{k: B0 + d for k, d in c.targets.items()}}
    fits = build_fits(c, G, bodies, inner=shoe_inner)
    log("fitted %d garments on %d bodies" % (len(G), len(bodies)), "%.0fs" % (time.time() - t0))
    if trainer is not None:
        for g in G.values():
            if g.slot == "trousers":
                has_, cl_, _, _ = wd.clearance(fits[""][g.id], g.tris_kept(), tv_, tt_); log("base: %s over the trainer: least clearance %.1f mm, %d points inside" % (g.id, cl_[has_].min() * 1000 if has_.any() else float("nan"), int((has_ & (cl_ < 0)).sum())))

    # ---- one mesh per garment, with the body's morph names and transferred weights
    M = {}; verts0 = {}
    for gid, g in G.items():
        p0, used, tc = finish(g, fits[""][gid])
        morphs = {k: finish(g, fits[k][gid])[0] - p0 for k in c.targets}
        W = g.asset.weights(c.rig.weights)[used]; tu = g.tu[g.keep_tri]; t = tc
        if g.rim is not None and g.rim.count: W = g.rim.weights(W); t, tu = g.rim.tris(tc, tu)
        M[gid] = layer_mesh(c, mesh_name(gid), p0, t, mat_name(gid), g.asset.uv, tu, W, morphs)
        if g.slot == "top" and WEIGHT_SMOOTH and getattr(g, "form", None) is not None:
            # round 13 (REVIEW-09: a dark patch at the sternum, a nub at the bust tip): the cloth that spans a hollow or lies over the bust
            # takes skin weights averaged over the cloth round it, so it moves as one sheet instead of with the skin under each vertex
            fwu = np.zeros(len(p0)); fwu[:len(used)] = g.form[0][used]; front_ = p0[:, 2] > float(np.median(p0[:, 2]))
            ny_ = float(c.skeleton.head[list(c.skeleton.names).index("neck_01")][1])       # chest and bust only: the hem keeps the hips' weights
            smooth_cloth_weights(M[gid], p0, t, fwu * front_ * ramp(p0[:, 1], ny_ - 0.45, ny_ - 0.35) * WEIGHT_SMOOTH, nbj)
        if g.slot == "top":
            # round 6: buttons and other small pieces take the skinning of the cloth they sit on (in the grip pose the cuff buttons,
            # weighted from the hand by the transfer, stretched into spikes beside the sleeve)
            from scipy.spatial import cKDTree
            root_, tw_ = wd.weld(p0, t); lab_ = wd.components(tw_, len(p0))[root_]; ids_, cnt_ = np.unique(lab_[lab_ >= 0], return_counts=True)
            if len(ids_) > 1:
                mi_ = np.flatnonzero(lab_ == ids_[cnt_.argmax()]); oi_ = np.flatnonzero((lab_ >= 0) & (lab_ != ids_[cnt_.argmax()]))
                # round 11: each piece rides RIGIDLY on the cloth vertex under its centre (one skinning for the whole disc: a disc whose
                # vertices took the skinning of different cloth vertices sheared into shards when the placket bent), lifted BUTTON_LIFT off it
                kd_ = cKDTree(p0[mi_]); src_ = np.zeros(len(oi_), np.int64); nrm_ = wd.vertex_normals(p0, tw_)[root_]
                for k_ in np.unique(lab_[oi_]):
                    sel_ = lab_[oi_] == k_; ctr_ = p0[oi_[sel_]].mean(0); s_ = mi_[kd_.query(ctr_)[1]]; src_[sel_] = s_
                    n_ = nrm_[s_] if (nrm_[s_] @ (ctr_ - p0[s_])) >= 0 else -nrm_[s_]
                    M[gid].v = np.array(M[gid].v, float); M[gid].v[oi_[sel_]] += BUTTON_LIFT * n_; p0[oi_[sel_]] += BUTTON_LIFT * n_
                M[gid].joints = np.array(M[gid].joints); M[gid].weights = np.array(M[gid].weights); M[gid].attrs["_DQS"] = np.array(M[gid].attrs["_DQS"])
                M[gid].joints[oi_] = M[gid].joints[src_]; M[gid].weights[oi_] = M[gid].weights[src_]; M[gid].attrs["_DQS"][oi_] = M[gid].attrs["_DQS"][src_]
                for k8 in SKIN8: a8_ = np.array(M[gid].attrs[k8]); a8_[oi_] = a8_[src_]; M[gid].attrs[k8] = a8_
                log("%s: %d vertices of %d small pieces take the skinning of the cloth under them" % (gid, len(oi_), len(ids_) - 1))
        if g.slot == "trousers" and KNEE_BODY:
            # round 6: seated, the trousers sank up to 17 mm into the skin at the OUTER side of each knee (a notch beside the short
            # woman's knee: the body hidden by the mask, the inside of the leg seen through): the transferred cloth weights do not
            # bulge with the knee as the skin's do. Round the knee joint the cloth takes the skinning of the body vertices it is
            # bound to (the .mhclo triangle: joints, helpers and the DQS blend of the skin), fading out from 90 to 150 mm.
            nbj_ = int(max(np.max(c.J4), np.max(M[gid].joints))) + 1; nb_ = len(c.J4)
            Wb_ = sp.csr_matrix((np.asarray(c.W4, np.float64).ravel(), (np.repeat(np.arange(nb_), np.asarray(c.J4).shape[1]), np.asarray(c.J4).ravel())), shape=(nb_, nbj_))
            Wc_ = g.asset.weights(Wb_)[used]; Dq_ = g.asset.weights(sp.csr_matrix(np.asarray(c.dqs, np.float64).reshape(-1, 1)))[used]
            if g.rim is not None and g.rim.count: Wc_ = g.rim.weights(Wc_); Dq_ = g.rim.weights(Dq_)
            Wc_ = np.asarray(Wc_.todense()); Dq_ = np.asarray(Dq_.todense()).ravel()
            jn2_ = list(c.skeleton.names); kn_ = [c.skeleton.head[jn2_.index(n)] for n in ("calf_l", "calf_r") if n in jn2_]
            if kn_ and len(Wc_) == len(p0):
                kz_ = 1 - ramp(np.min([np.linalg.norm(p0 - k, axis=1) for k in kn_], 0), 0.09, 0.15)
                Wg_ = np.zeros((len(p0), nbj_)); np.add.at(Wg_, (np.repeat(np.arange(len(p0)), 4), np.asarray(M[gid].joints).ravel()), np.asarray(M[gid].weights, np.float64).ravel())
                J_, W_ = top4((1 - kz_)[:, None] * Wg_ + kz_[:, None] * Wc_); M[gid].joints = J_; M[gid].weights = W_
                # round 11: the eight-influence set the same way, from the body's eight
                Wc8_ = g.asset.weights(W8b)[used]
                if g.rim is not None and g.rim.count: Wc8_ = g.rim.weights(Wc8_)
                Wc8_ = np.asarray(Wc8_.todense()) if sp.issparse(Wc8_) else np.asarray(Wc8_)
                put8(M[gid], (1 - kz_)[:, None] * dense8(M[gid], nbj) + kz_[:, None] * Wc8_)
                M[gid].attrs["_DQS"] = ((1 - kz_) * np.asarray(M[gid].attrs["_DQS"]) + kz_ * Dq_).astype(np.float32)
                log("%s: %d vertices round the knees take the body's skinning" % (gid, int((kz_ > 0.5).sum())))
        if getattr(g, "ride", None) is not None and trainer is not None:
            # the hem lies on the shoe: in that zone the cloth takes the SHOE's skin weights too, so it stays on the shoe when the
            # ankle turns (standing straight, the calf-weighted hem went 11 mm into the mid-cut trainer's tongue)
            from scipy.spatial import cKDTree
            nbj = len(jnames); dd_, jj_ = cKDTree(tv_).query(p0); zz_ = (1 - ramp(dd_, 0.012, 0.045)) * (1 - ramp(p0[:, 1], tv_[:, 1].max() + 0.01, tv_[:, 1].max() + 0.05))
            Wt = trainer.weights; Wt = np.asarray(Wt.todense() if sp.issparse(Wt) else Wt, dtype=np.float64)
            if trainer.joints is not None: Wd_ = np.zeros((len(tv_), nbj)); np.add.at(Wd_, (np.repeat(np.arange(len(tv_)), Wt.shape[1]), np.asarray(trainer.joints).ravel()), Wt.ravel()); Wt = Wd_
            Wg = np.zeros((len(p0), nbj)); np.add.at(Wg, (np.repeat(np.arange(len(p0)), 4), np.asarray(M[gid].joints).ravel()), np.asarray(M[gid].weights, dtype=np.float64).ravel())
            Wn = (1 - zz_)[:, None] * Wg + zz_[:, None] * Wt[jj_][:, :nbj]; J_, W_ = top4(Wn)
            tdq = np.asarray((trainer.attrs or {}).get("_DQS", np.zeros(len(tv_))), dtype=np.float32)
            M[gid].joints = J_; M[gid].weights = W_; M[gid].attrs["_DQS"] = ((1 - zz_) * M[gid].attrs["_DQS"] + zz_ * tdq[jj_]).astype(np.float32)
            put8(M[gid], (1 - zz_)[:, None] * dense8(M[gid], nbj) + zz_[:, None] * dense8(trainer, nbj)[jj_])      # round 11: the eight too
            log("%s: %d vertices ride on the shoe (weights and shape deltas)" % (gid, int((zz_ > 0.5).sum())))
        g.used, g.tris_out, g.morphs, g.p0, g.J4, g.W4, g.dqs = used, t, morphs, p0, M[gid].joints, M[gid].weights, M[gid].attrs["_DQS"]
        g.J8 = np.c_[M[gid].attrs[SKIN8[0]], M[gid].attrs[SKIN8[2]]]; g.W8 = np.c_[M[gid].attrs[SKIN8[1]], M[gid].attrs[SKIN8[3]]]     # round 11: what the viewer skins with
        if g.button_sites and os.environ.get("B2_NO_BUTTONS") is None:  # round 13: the buttons, made anew, in the shirt's own mesh and material
            #   (B2_NO_BUTTONS: a snapshot for the shirt's cloth run, which must not simulate the loose discs)
            btn_ = shirt_buttons(c, g, fits, mat_name(gid))
            if btn_ is not None: M[gid] = merge_meshes(M[gid].name, [M[gid], btn_], M[gid].material)
        verts0[gid] = p0

    hair_mesh = None; hairs = []          # round 7: [(id, mesh, texture png, source)]; the ponytail (tied_hair) is retired
    if sex == "f":
        for hid in HAIR_PICK:
            if hid not in HAIRS: continue
            try:
                ha_, hm_ = cap_hair(c, G, fits, HAIRS[hid][0], hid)
                ht_png = os.path.join(mt.CACHE, "hair_%s_%s_1k.png" % (hid, tone)); hi_ = np.asarray(Image.open(ha_.textures["diffuse"]).convert("RGBA").resize((1024, 1024), Image.LANCZOS), dtype=np.float32)
                lum = hi_[..., :3].mean(2, keepdims=True) / max(float(hi_[..., :3][hi_[..., 3] > 128].mean()), 1.0)      # the pack's strand shading, re-coloured to this tone's hair
                # round 7: the strand shading as a NEUTRAL grey texture and the tone's colour in the material factor: the viewer's hair
                # material derives its sheen from the factor (white factor -> a white sheen: the dark tone's bob read pale grey)
                hi_[..., :3] = np.clip(lum * 127.5, 0, 255)
                # round 8: the cards read as a translucent sheet (soft alpha over their whole length) and their tips as saw teeth (alpha
                # test on a hard edge): alpha pushed to opaque where the strands are, kept as a soft ramp only where it fades (the tips)
                from scipy import ndimage as _nd
                al_ = np.clip((hi_[..., 3] / 255.0 - 0.10) / 0.40, 0, 1); al_ = _nd.gaussian_filter(al_, 0.8); hi_[..., 3] = al_ * 255
                Image.fromarray(np.clip(hi_, 0, 255).astype(np.uint8)).save(ht_png)
                hairs.append((hid, hm_, ht_png, HAIRS[hid]))
            except Exception as ex: log("hair %s FAILED:" % hid, repr(ex))
        hair_mesh = hairs[0][1] if hairs else None

    # ---- body-hide masks: per garment, per pixel, in the body's UV space
    msize = 1024; masks = {}; dist = {}; neck = {}
    Wr_ = c.rig.weights.tocsr() if sp.issparse(c.rig.weights) else sp.csr_matrix(c.rig.weights)
    hand_w = np.asarray(Wr_[:, [i for i, b_ in enumerate(c.rig.bones) if b_.startswith(("metacarpal", "finger", "wrist"))]].sum(1)).ravel()   # hand and wrist
    yneck = float(c.skeleton.head[list(c.skeleton.names).index("neck_01")][1])
    def make_mask(key, p0, tris, collar=None):
        smp = np.vstack([p0, p0[tris].mean(1)])
        # reach 90 mm: cloth hangs well clear of the body at the crotch and under a worn-out hem; with 45 mm the crotch
        # counted as an opening and the mask left skin unhidden between the legs
        # a top's coverage reaches 45 mm only: with 90 the collar "covered" the back of the neck up to the hairline and the
        # mask punched holes there (the red and blue specks at the nape: mouth lining and shirt seen through the skin)
        cov = wd.coverage(B0, bn, body_idx, smp, reach=(0.045 if key.startswith("top.") else 0.09), lateral=0.02)
        d = wd.hide_distance(B0, c.tris, cov, min_island=400); dist[key] = d
        # at the neck the skin continues twice as far (60 mm): B6's collar sits inside the shirt's own, and with 30 mm the
        # cut line of the skin lay above its rim, in sight (seen in C1, E06, E24 of the first round-3 packet)
        sb = SETBACK + (0.030 * ramp(B0[:, 1], yneck - 0.16, yneck - 0.06) if key.startswith("top.") else 0.0)
        h = np.clip(0.5 + (d - sb) / (2 * MASK_RANGE), 0, 1)
        if collar is not None:
            # with B6's collar band in the neck opening, the skin must be cut UNDER that band: 8 mm below its top edge, all
            # round (front and nape). In the neck zone the mask is therefore measured from what shirt AND collar leave bare.
            cv, ct = collar; covc = wd.coverage(B0, bn, body_idx, np.vstack([cv, cv[ct].mean(1)]), reach=0.03, lateral=0.012)
            used_ = np.zeros(len(B0), bool); used_[np.unique(c.tris)] = True
            cx = cv[:, [0, 2]].mean(0); rad = np.linalg.norm(cv[:, [0, 2]] - cx, axis=1).max(); rxz = np.linalg.norm(B0[:, [0, 2]] - cx, axis=1)
            # bare = skin above the band's top edge (neck, head): not under the band, not below it, round the neck axis
            bare = used_ & ~covc & (B0[:, 1] > cv[:, 1].min() + 0.4 * (cv[:, 1].max() - cv[:, 1].min())) & (rxz < rad + 0.10)
            d2 = wd.hide_distance(B0, c.tris, ~bare, min_island=0)          # distance below the band's top edge, along the skin
            z = ramp(B0[:, 1], cv[:, 1].min() - 0.10, cv[:, 1].min() - 0.05) * (1 - ramp(rxz, rad + 0.02, rad + 0.045))   # the neck zone: tight round the band, so the shoulders and upper back keep the shirt's rule (with 50-90 mm unhidden skin came through the shirt at the shoulder with the arm overhead, E02)
            # designer's rule: the skin continues 30 mm below the visible collar edge, all round; the liner (below) covers the cut
            h = (1 - z) * h + z * np.clip(0.5 + (d2 - NECK_SETBACK) / (2 * 0.004), 0, 1)
            sb = sb * (1 - z) + NECK_SETBACK * z; d = (1 - z) * d + z * d2
            neck.update(d2=d2, z=z)
        raw = wd.raster_scalar(base.uv, c.tri_uv, c.tris, h, msize, pad=0)
        img = wd.raster_scalar(base.uv, c.tri_uv, c.tris, h, msize, pad=8)
        # at UV island borders bilinear sampling reaches the neighbouring island's texels: where a hidden island touches a
        # visible one (the seam round the neck base) that punched pin-holes into visible skin. Border texels take the
        # LOWER value of their 5 x 5 neighbourhood, so a seam can only show a little more skin under cloth, never less.
        from scipy import ndimage
        edge = ndimage.binary_dilation(np.isnan(raw), iterations=3) & ~np.isnan(img)
        img = np.nan_to_num(np.where(edge, ndimage.minimum_filter(np.nan_to_num(img, nan=1.0), size=5), img))
        # no pin-holes: one-texel specks and one-texel-wide lines of hidden texels in visible skin showed as dark dots round
        # the neck; a 5 x 5 median removes them and keeps island-sized areas and the cut line
        img = ndimage.median_filter(img, size=5)
        masks[key] = img
        Image.fromarray((masks[key] * 255).astype(np.uint8)).save(os.path.join(out, "maps", "mask_%s.png" % key.replace(".", "_")))
        cv_ = np.clip(0.5 + (d - sb - 0.006) / 0.008, 0, 1)
        if key.startswith("top."):
            # round 11 (REVIEW-07 item 7, "1 px (M50) and 2 px (M95H) of skin seated"): the stray pixels were the back of the hand and the
            # thumb's base just beyond the cuff in the grip (located with B2/kit_skinpix.ts). In the A-pose the cuff lies over the hand's
            # base, so the cover map (the skin test's "meant to be covered" region) reached onto the hand; and a gripping hand bares the
            # wrist as the cuff stays on the forearm. A shirt is not meant to cover hand or wrist: their skin is never in a top's cover
            # region (the mask that hides skin under the cuff is unchanged)
            cv_ = cv_ * (1 - ramp(hand_w, 0.15, 0.4))
        cov_img = wd.raster_scalar(base.uv, c.tri_uv, c.tris, cv_, msize, pad=8)
        Image.fromarray((np.nan_to_num(cov_img) * 255).astype(np.uint8)).save(os.path.join(out, "maps", "cover_%s.png" % key.replace(".", "_")))
        log("mask", key, "covered %d body vertices, hidden %d" % (int(cov.sum()), int((h > 0.5).sum())))
    for gid, g in G.items():
        # round 11: a formed top is measured for its mask on its fit before the form: where hoop and drape lift the cloth 40 mm or more
        # off the skin (under the bust, over the belly) the 45 mm coverage reach read the skin as bare and the mask left it unhidden
        if getattr(g, "preform", None) is not None: g.p0_mask = finish(g, g.preform)[0]
        if g.spec.get("mask") is not False: make_mask(gid, getattr(g, "p0_mask", g.p0), g.tris_out)
    if trainer is not None: make_mask("shoes.safety_trainer", tv_, tt_)
    # faces every option of an always-filled slot hides deeply never show in any outfit: drop them from the body
    deep = np.zeros(len(B0), bool)
    for slot in ("shoes", "trousers", "top"):
        ds = [dist[g.id] for g in G.values() if g.slot == slot and g.id in dist]
        if ds: deep |= np.min(ds, 0) > SETBACK + MASK_RANGE + 0.02

    # ---- head kit
    A = {k: wd.Asset(p[0]) for k, p in HEAD_KIT.items()}
    def kit_part(asset, mname, material, sel=None):
        t, tu = asset.tris()
        if sel is not None: t, tu = t[sel], tu[sel]
        used, tc = compact(t); v0 = asset.fit(B0)[used]
        return layer_mesh(c, mname, v0, tc, material, asset.uv, tu, asset.weights(c.rig.weights)[used], {k: asset.fit(B0 + d)[used] - v0 for k, d in c.targets.items()})
    head = eyes.eye_meshes(e, "shell", W=erig["W"], names=jnames)                     # eyeball_l, eyeball_r (B5)
    wet, _ = eyes.eye_wet(e, erig); head.append(wet)
    L_ = erig["lids"]["l"]; iris_png = os.path.join(mt.CACHE, "eye_iris_struct.png")
    if not os.path.exists(iris_png): eyes.eye_iris_texture(iris_png)
    eye_x = {"b5eye": {"kind": "shell", "limbus": round(eyes.P["iris_d"] / 2 / L_.R, 5), "irisPlane": round((math.sqrt(L_.R ** 2 - (eyes.P["iris_d"] / 2) ** 2) - 0.0012) / L_.R, 5), "scale": 1.25}}
    eye_mats = {"eye_ball": {"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.4}, "extras": eye_x, "_images": {"baseColorTexture": iris_png}},
                "eye_wet": {"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 0.1], "metallicFactor": 0.0, "roughnessFactor": 0.05}, "alphaMode": "BLEND", "doubleSided": True, "extras": {"b5eye": {"kind": "wet"}}}}
    eye_classes = {"eye_ball": {"class": "eye", "iris": eyes.IRIS[iris]}, "eye_wet": {"class": "eye"}}
    # lashes: B5's cards grown from the lid margins (ride the lid joints); brows: painted into the skin (no card mesh)
    head.append(eyes.eye_lashes(e, erig, sex))
    for m_ in head: put8(m_, dense8(m_, nbj))                        # round 11: B5's meshes keep their weights (rigid balls, lid joints), as eight
    lash_tex = os.path.join(mt.CACHE, "eye_hair_%s.png" % sex)              # B5 round 3: new atlas layout (lashes, lash line, brow cards, caruncle): made every build
    eyes.eye_lash_texture(lash_tex, sex=sex, brow_rgb=TONES[tone]["brow"])       # round 9 (B5 round 4): the tone's brow colour
    if os.path.exists(os.path.join(mt.CACHE, "eye_lash_soft.png")): os.remove(os.path.join(mt.CACHE, "eye_lash_soft.png"))
    eye_mats["lashes_soft"] = {"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.7}, "alphaMode": "MASK", "alphaCutoff": 0.1, "doubleSided": True, "_images": {"baseColorTexture": lash_tex}}
    eye_classes["lashes_soft"] = {"class": "lashes", "alphaTest": eyes.LASH[sex]["alpha_test"], "darken": 1.0}
    bro = A["brows"]; bt_, btu_ = bro.tris()
    vuv = np.zeros((len(B0), 2)); vuv[c.tris.ravel()] = base.uv[c.tri_uv.ravel()]                 # a UV per body vertex (the brow area has no seam)
    brow_decal = {"texture": bro.textures["diffuse"], "skin_uv": (vuv[bro.idx] * np.clip(bro.w, 0, None)[:, :, None]).sum(1) / np.clip(bro.w, 0, None).sum(1, keepdims=True),
                  "tris": bt_, "uv": bro.uv, "tri_uv": btu_, "colour": TONES[tone]["brow"], "strength": 0.8}

    # ---- skin: cropped hair painted from the hair asset's footprint; default outfit's mask in alpha
    # the scalp region is MPFB's own (uv_layers/scalp_solid): an authored hairline, blurred into a fade by skin_rgba
    import gzip
    sc = json.load(gzip.open(os.path.join(mh.DATA, "uv_layers", "scalp_solid.json.gz")))
    hcov = np.zeros(len(B0)); hcov[np.unique(base.quads[np.array([int(k) for k in sc])])] = 1.0      # keys are face indices of base.obj
    hsel = (hcov[c.tris] > 0).any(1)
    scalp_img = np.nan_to_num(wd.raster_scalar(base.uv, c.tri_uv[hsel], c.tris[hsel], hcov, msize))
    # round 6: no painted hair on the forehead (with the cap on, the band between brows and brim showed a shaved hairline): the
    # paint fades in from 45 to 70 degrees round the head from the front (seen from 70 mm behind the eyes), so the temples get at
    # most a soft hairline, the sides and nape keep the fade
    jn_ = list(c.skeleton.names); eye_c = np.mean([c.skeleton.head[jn_.index(n)] for n in ("eye_l", "eye_r") if n in jn_], 0) if "eye_l" in jn_ else np.array([0.0, B0[:, 1].max() - 0.12, 0.09])
    az_ = np.degrees(np.arctan2(np.abs(B0[:, 0] - eye_c[0]), B0[:, 2] - (eye_c[2] - 0.07)))
    hair_img = np.nan_to_num(wd.raster_scalar(base.uv, c.tri_uv[hsel], c.tris[hsel], hcov * ramp(az_, 45.0, 70.0), msize))
    worn = [s + "." + o for s, o in pick.items()]
    # the viewer combines the worn garments' masks per pixel (FORMAT.md v0.3), so the skin texture carries no cut of its own
    hrgb = TONES[tone]["hair"] if sex == "m" else tuple(int(min(255, 1.45 * x)) for x in TONES[tone]["hair"])     # the woman's: about the tail's own tone
    skin_png = mt.skin_rgba("skin8_%s_%s" % (sex, tone), sex, tone, hide=None, hair=hair_img, hair_rgb=hrgb, decals=None, scalp=scalp_img, soft=(sex == "f"))      # no brow decal: B5's brow cards
    skin = mt.skin_set(sex, tone)
    # budget (REVIEW-04): no alpha is read from the skin (the viewer cuts by the garments' masks) -> JPEG; roughness zones at 1024
    skin_jpg = skin_png[:-4] + ".jpg"; im_ = np.asarray(Image.open(skin_png).convert("RGB"), dtype=np.float32)
    try:                                                              # colour zones (B5 round 3: with the pebbles gone the face reads waxy): redder lips, nose tip and ears; no light
        import abstract as ab
        from scipy.spatial import cKDTree
        from PIL import ImageFilter
        c2_ = copy.copy(c); c2_.base_v = e.base_v; c2_.targets = e.targets; st_ = ab.Style(c2_, eye=e.eye); bodyv = base.vgroups["body"].astype(bool)
        red = np.zeros(len(B0)); bag = np.asarray(st_.regions["mouth"], bool); nos = np.asarray(st_.regions["nostril"], bool)
        dm, _ = cKDTree(B0[bag]).query(B0); red = np.maximum(red, np.where(bodyv & ~bag, 1.0 - ramp(dm, 0.004, 0.011), 0.0))
        dn = np.linalg.norm(B0 - (B0[nos].mean(0) + [0, 0.004, 0.012]), axis=1); red = np.maximum(red, 0.4 * (1.0 - ramp(dn, 0.010, 0.026)) * bodyv)
        red = np.maximum(red, 0.45 * np.asarray(st_.masks["ear"], float) * bodyv)
        zs = (red[c.tris] > 0).any(1); zi = np.nan_to_num(wd.raster_scalar(base.uv, c.tri_uv[zs], c.tris[zs], red, msize))
        zi = np.asarray(Image.fromarray((np.clip(zi, 0, 1) * 255).astype(np.uint8)).resize(im_.shape[1::-1], Image.BILINEAR).filter(ImageFilter.GaussianBlur(5)), dtype=np.float32) / 255
        im_ = im_ * (1 + zi[..., None] * np.array([0.07, -0.13, -0.10], np.float32)); zone_note = "lips %d, ears %d vertices" % (int((red > 0.9).sum()), int((red == 0.45).sum()))
        log("skin colour zones:", zone_note)
    except Exception as ex: st_ = None; log("skin colour zones FAILED:", repr(ex))
    face_lo = None
    if tone in TONE_SKIN and st_ is not None:
        # round 11 (REVIEW-07 item 5, the dark tone's face: "wet sheen on lips, chin and cheeks, blotchy red patches"): the head's blotches
        # evened out (the pack's mid-scale colour patches pulled toward the colour round them; lips and painted hair keep theirs), and
        # below the matte roughness floor on the lower face (see the ORM); the large-scale shading and the fine grain stay
        try:
            from scipy import ndimage as _nd2
            ts_ = TONE_SKIN[tone]; Hs = im_.shape[0]
            jn2_ = list(c.skeleton.names); ec_ = np.mean([c.skeleton.head[jn2_.index(n)] for n in ("eye_l", "eye_r")], 0)
            # below the eyes only (brows and upper lids untouched; the pale smear in the crease under the eye is evened), lips excluded
            hd = np.asarray(st_.head, float) * (1 - np.asarray(red > 0.5, float)) * (1 - ramp(B0[:, 1], ec_[1] - 0.014, ec_[1] - 0.006))
            hsel = (hd[c.tris] > 0).any(1); hm = np.nan_to_num(wd.raster_scalar(base.uv, c.tri_uv[hsel], c.tris[hsel], hd, msize))
            hm = np.asarray(Image.fromarray((np.clip(hm, 0, 1) * 255).astype(np.uint8)).resize((Hs, Hs), Image.BILINEAR), np.float32) / 255
            hm = _nd2.gaussian_filter(hm, Hs / 400) * (1 - np.clip(np.asarray(Image.fromarray((np.clip(hair_img, 0, 1) * 255).astype(np.uint8)).resize((Hs, Hs), Image.BILINEAR), np.float32) / 255 * 3, 0, 1))
            Y_ = im_ @ np.array([0.299, 0.587, 0.114], np.float32); C_ = im_ - Y_[..., None]
            g1 = lambda A, sgm: np.dstack([_nd2.gaussian_filter(A[..., k], sgm) for k in range(A.shape[2])]) if A.ndim == 3 else _nd2.gaussian_filter(A, sgm)
            s1, s2 = Hs * ts_["blotch_px"][0] / 2048, Hs * ts_["blotch_px"][1] / 2048
            Cb = g1(C_, s1) - g1(C_, s2); Yb = g1(Y_, s1) - g1(Y_, s2)
            im_ = im_ - hm[..., None] * (ts_["chroma"] * Cb + ts_["luma"] * Yb[..., None])
            log("skin %s: head blotches evened (chroma %.0f%%, luma %.0f%%)" % (tone, ts_["chroma"] * 100, ts_["luma"] * 100))
            azf_ = np.degrees(np.arctan2(np.abs(B0[:, 0] - ec_[0]), B0[:, 2] - (ec_[2] - 0.07)))
            face_lo = np.asarray(st_.head, float) * (1 - ramp(azf_, 60.0, 85.0)) * (1 - ramp(B0[:, 1], ec_[1] - 0.02, ec_[1] + 0.01)) * ramp(B0[:, 1], ec_[1] - 0.16, ec_[1] - 0.12)
            face_lo = (face_lo, np.asarray(red > 0.5, float))
        except Exception as ex: log("skin evening FAILED:", repr(ex))
    Image.fromarray(np.clip(im_, 0, 255).astype(np.uint8)).save(skin_jpg, quality=90)
    orm_1k = os.path.join(mt.CACHE, "skin_orm_%s_%s_1k.jpg" % (sex, tone)); orm_ = np.asarray(Image.open(skin["orm"]).convert("RGB").resize((1024, 1024), Image.LANCZOS), dtype=np.float32)
    # round 6: the specular map had the scalp shiny (the bald sculpt's): painted hair and the skin under the brim are matte
    from scipy import ndimage as _nd
    sm_ = np.clip(_nd.gaussian_filter(np.asarray(Image.fromarray((np.clip(scalp_img, 0, 1) * 255).astype(np.uint8)).resize((1024, 1024), Image.BILINEAR), np.float32) / 255, 1024 / 170) * 1.6, 0, 1)
    orm_[..., 1] = np.maximum(orm_[..., 1], 0.85 * 255 * sm_)
    if tone in TONE_SKIN:
        # round 11 (REVIEW-07 item 5): on a dark albedo the same specular reads as a wet film: roughness up overall, and a matte floor over
        # cheeks, chin and upper lip (the lips a little less matte); the sheen of the T-zone keeps its relief, so the terminator stays soft
        ts_ = TONE_SKIN[tone]; orm_[..., 1] = np.clip(orm_[..., 1] + 255 * ts_["rough_add"], 0, 255)
        if face_lo is not None:
            fl_, lp_ = face_lo
            def _img(val):
                sel_ = (val[c.tris] > 0).any(1); im2 = np.nan_to_num(wd.raster_scalar(base.uv, c.tri_uv[sel_], c.tris[sel_], val, msize))
                return _nd.gaussian_filter(np.asarray(Image.fromarray((np.clip(im2, 0, 1) * 255).astype(np.uint8)).resize((1024, 1024), Image.BILINEAR), np.float32) / 255, 4)
            fi_, li_ = _img(fl_), _img(lp_)
            orm_[..., 1] = np.maximum(orm_[..., 1], 255 * (ts_["rough_face"] * fi_ * (1 - li_)))
            orm_[..., 1] = np.where(li_ > 0.05, (1 - li_) * orm_[..., 1] + li_ * np.maximum(orm_[..., 1], 255 * ts_["rough_lips"]), orm_[..., 1])
            log("skin %s: roughness +%.2f, lower face at least %.2f, lips %.2f" % (tone, ts_["rough_add"], ts_["rough_face"], ts_["rough_lips"]))
    Image.fromarray(np.clip(orm_, 0, 255).astype(np.uint8)).save(orm_1k, quality=88)

    # ---- garment textures (neutral, tinted by the colourway) and materials
    mats = {"skin_body": {"pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0},
                          "_images": {"baseColorTexture": skin_jpg, "metallicRoughnessTexture": orm_1k}},
            # round 6: metallic 0 (was 0.3): the lenses reflected the studio as a grey veil (on the dark tone) and a grey plate at grazing view
            "glasses_blend": {"pbrMetallicRoughness": {"baseColorFactor": [1.0, 1.0, 1.0, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.3}, "alphaMode": "BLEND", "doubleSided": True},
            **eye_mats}
    classes = {"skin_body": {"class": "skin", "microTiling": 140, "microStrength": 0.16, **{k: TONE_SKIN[tone][k] for k in ("clearcoat", "clearcoatRoughness") if k in TONE_SKIN.get(tone, {})}},
               "glasses_blend": {"class": "plain"}, **eye_classes}
    for hid, hm_, ht_png, _src in hairs:
        hf_ = [min(1.0, x / 0.2176) for x in mt.lin(tuple(min(255, 1.6 * v) for v in TONES[tone]["hair"]))]      # / linear(0.5): the texture's mean
        mats["hair_cards_" + hid] = {"pbrMetallicRoughness": {"baseColorFactor": hf_ + [1.0], "metallicFactor": 0.0, "roughnessFactor": 0.55}, "alphaMode": "MASK", "alphaCutoff": 0.35, "doubleSided": True, "_images": {"baseColorTexture": ht_png}}
        classes["hair_cards_" + hid] = {"class": "hair", "alphaTest": 0.35}
    colours = {**{s: None for s in pick}, **(colours or {})}
    for gid, g in G.items():
        sp_ = g.spec; mn = mat_name(gid); col = sp_["colours"]; cw = colours.get(g.slot) or next(iter(col))
        if sp_["klass"] == "plain":
            mats[mn] = {"pbrMetallicRoughness": {"baseColorFactor": mt.lin(col[cw]) + [1.0], "metallicFactor": 0.6, "roughnessFactor": 0.35}}; classes[mn] = {"class": "plain"}; continue
        kw = {}
        if sp_.get("sole"):                                          # sole line: a per-pixel height threshold, not a per-triangle class
            vy = fits[""][gid][:, 1]; yb = vy.min()
            f = wd.raster_scalar(g.asset.uv, g.tu, g.t_full, vy - yb, sp_["size"])
            sl = SOLE_BAND * (g.sole_k or 1.0)
            s = ramp(np.nan_to_num(f, nan=1.0), sl, sl + 0.002)         # 0 = sole, 1 = upper
            kw = dict(gain_img=1.0 - 0.76 * s, rough_img=0.92 - 0.1 * s, fold=0.6, keep=0.15, grain=(os.path.join(mt.FABRICS, mt.FABRIC["leather"][0]), 6, 0.5), seams=False)
        tex = mt.neutral_set("w7_%s_" % c.sex + gid.replace(".", "_"), g.asset if not sp_.get("plain_tex") else _plain(g.asset), g.tu, sp_["size"], **({"fold": 0.5, "keep": 0.22, "seams": sp_.get("seams", True), **kw}))
        if sp_.get("subdiv") and SHIRT_REFINE: tex = shirt_details(tex, g, c, sp_["size"], "w13_%s_" % c.sex + gid.replace(".", "_"))
        # budget: the cloth roughness map was a constant: left out (the factor carries it); base and fold normal at the spec's size
        if gid == "trousers.work" and os.path.exists(B8_TROUSERS_FOLD) and os.environ.get("B2_NO_B8") is None:
            # B8's standing fold map (cloth simulation, baked in UV0 with the authored map inside; same slot, size and UVs; coordinator
            # 2026-11-24: the trousers' normal slot only; not the shirt's, not the seated maps or corrective shapes)
            tex = {**tex, "normal": b8_hem_faded(g, fits[""][gid], sp_["size"], out)}; log("trousers normal map: B8's standing fold map, flat over the hem break", os.path.relpath(B8_TROUSERS_FOLD, LAB))
        mats[mn] = {"pbrMetallicRoughness": {"baseColorFactor": mt.colour_factor(col[cw]), "metallicFactor": 0.0, "roughnessFactor": 0.9}, "doubleSided": sp_["klass"] == "cloth",
                    "_images": {"baseColorTexture": tex["baseColor"], "normalTexture": tex["normal"]}}
        classes[mn] = {"class": sp_["klass"]}
        if sp_["klass"] == "cloth" and sp_.get("fabric"):             # the scanned weave as a tiling detail normal (FORMAT.md 2c)
            fn, tile, strength = mt.FABRIC[sp_["fabric"]]; shutil.copy(os.path.join(mt.FABRICS, fn), os.path.join(out, "maps", "fabric_" + sp_["fabric"] + "_n.jpg"))
            nk_ = int(g.keep_tri.sum()); P3 = g.p0[g.tris_out[:nk_]]; a3 = np.linalg.norm(np.cross(P3[:, 1] - P3[:, 0], P3[:, 2] - P3[:, 0]), axis=1).sum()
            U = np.asarray(g.asset.uv)[g.tu[g.keep_tri]]; e1 = U[:, 1] - U[:, 0]; e2 = U[:, 2] - U[:, 0]; au = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum()
            classes[mn].update({"detailNormal": "maps/fabric_%s_n.jpg" % sp_["fabric"], "detailScale": round(float(math.sqrt(a3 / max(au, 1e-9)) / tile), 1), "detailStrength": strength})
    # glasses: frame and lens are two materials
    gl = G["glasses.safety_clear"]; gm = M["glasses.safety_clear"]
    _, gtw = wd.weld(gm.v, gm.tris); glab = wd.components(gtw, len(gm.v)); gtl = glab[gtw[:, 0]]
    lens = np.isin(gtl, [cid for cid in set(gtl.tolist()) if int((glab == cid).sum()) == 112])
    def sub(m, sel, nm, material):
        used, tc = compact(m.tris[sel])
        return glb.Mesh(nm, m.v[used], tc, material, uv=m.uv, tri_uv=m.tri_uv[sel], joints=m.joints[used], weights=m.weights[used], morphs={k: d[used] for k, d in m.morphs.items()}, attrs={"_DQS": m.attrs["_DQS"][used], **{k8: np.asarray(m.attrs[k8])[used] for k8 in SKIN8 if k8 in m.attrs}})
    # frame and lens in ONE draw call: a blended material whose alpha comes from COLOR_0 (frame 1, lens 0.03); tint in COLOR_0 too
    gcol = np.ones((len(gm.v), 4), np.float32); lv_ = np.unique(gm.tris[lens]); fv_ = np.setdiff1d(np.arange(len(gm.v)), lv_)
    # round 11 (REVIEW-07 item 5, "a grey veil on the lower lenses"): the lens was WHITE at 1.5 % opacity: its diffuse added about 0.015
    # (linear) of lit white over the face, a veil on a dark albedo of 0.03 and nothing on a light one. Now black at 3 %: it takes a little
    # light away, and its reflections (times its alpha) are all it adds
    gcol[fv_, :3] = np.array(mt.lin(gl.spec["colours"]["graphite"]), np.float32); gcol[lv_] = (0.0, 0.0, 0.0, LENS_ALPHA)
    gone = glb.Mesh("glasses", gm.v, gm.tris, "glasses_blend", uv=gm.uv, tri_uv=gm.tri_uv, joints=gm.joints, weights=gm.weights, morphs=gm.morphs, attrs=gm.attrs, color=gcol)
    glasses = [gone]

    # ---- sole on the floor
    lift = sole_h; up = np.array([0, lift, 0])
    es = erig["skeleton"]; skel = glb.Skeleton(jnames, np.asarray(es.parent).copy(), np.asarray(es.head) + up, es.rot)
    # the WHOLE body (FORMAT.md 2b: masks hide it per pixel; the abstract style shows it), on B5's eye context
    body = glb.Mesh("body", e.base_v, c.tris, "skin_body", uv=base.uv, tri_uv=c.tri_uv, weights=erig["W"], morphs=({} if BAKE else dict(e.targets)),
                    attrs={"_DQS": np.asarray(erig["dqs"], dtype=np.float32), **body8, **({"_SRC": np.arange(len(B0), dtype=np.float32)} if BAKE else {})})    # shape: baked on the CPU from <name>.shape.bin (FORMAT.md 2d)
    body_morphs = dict(e.targets)
    def lifted(m): m2 = glb.Mesh(**{**m.__dict__}); m2.v = m.v + up; return m2
    pre = [body] + [M[g] for g in worn if g in M and slot_of(g) != "glasses"] + ([trainer] if trainer is not None else []) + [h_[1] for h_ in hairs] + head + (glasses if "glasses" in pick else [])     # bare soles on y = 0
    def diet(mm, cap=None):                                            # budget: B6's prop maps arrive as PNG (the trainer's: 7.7 MB); same pixels as JPEG where there is no alpha
        for m_ in mm.values():
            for k_, p_ in list(m_.get("_images", {}).items()):
                im = Image.open(p_); big = cap is not None and max(im.size) > cap
                if not (p_.lower().endswith(".png") or big): continue
                alpha = im.mode in ("RGBA", "LA") and np.asarray(im.getchannel("A")).min() < 250
                if alpha and not big: continue
                if big: im = im.resize((cap * im.size[0] // max(im.size), cap * im.size[1] // max(im.size)), Image.LANCZOS)
                q_ = os.path.join(mt.CACHE, os.path.splitext(os.path.basename(p_))[0] + ("_%d" % cap if big else "") + (".png" if alpha else ".jpg"))
                if alpha: im.save(q_)
                else: im.convert("RGB").save(q_, quality=95 if "normal" in k_.lower() else 90, subsampling=0 if "normal" in k_.lower() else 2)
                m_["_images"][k_] = q_
        return mm
    mats.update(diet(shoe_mats, cap=TRAINER_MAP)); classes.update({k: {"class": "plain"} for k in shoe_mats})
    prop_info = None; rest_props = [p_ for p_ in (props_which or []) if p_ != "shoes"]
    if rest_props:                                                   # B6's modelled props, bound to these meshes and sized on this package
        import props
        try:
            bview = copy.copy(body); bview.morphs = body_morphs; bview.weights = W8b          # the props bind on the body's shape targets (round 11: and eight influences)
            def w8view(m_):                                            # round 11: every reference mesh binds with its eight
                m2 = copy.copy(m_); m2.weights = sp.csr_matrix(dense8(m_, nbj)); m2.joints = None; return m2
            pre_p = [bview if m_ is body else (w8view(m_) if m_.weights is not None else m_) for m_ in pre]
            extra, pmats, prop_info = props.build(pre_p, skel.names, which=tuple(rest_props), lift=0.0, pkg="operator-" + sex, body=bview)
            for m_ in extra:
                if not all(k in (m_.attrs or {}) for k in SKIN8): put8(m_, dense8(m_, nbj))
            pre.extend(extra)
            if shoe_info: prop_info["props"]["shoes"] = shoe_info["props"]["shoes"]
            mats.update(diet(pmats)); classes.update({k: {"class": "plain"} for k in pmats})
            col_ = next((m_ for m_ in extra if m_.name == "garment_collar"), None)
            if col_ is not None and ("top." + pick["top"]) in masks:       # the worn top's mask again, now cut under the collar band
                gt_ = G["top." + pick["top"]]; make_mask(gt_.id, getattr(gt_, "p0_mask", gt_.p0), gt_.tris_out, collar=(np.asarray(col_.v, float), np.asarray(col_.tris)))
                lin = collar_liner(c, gt_, fits, neck, mat_name(gt_.id), M[gt_.id], band=(np.asarray(col_.v, float), dict(col_.morphs or {})))
                if lin is not None:
                    merged = merge_meshes(M[gt_.id].name, [M[gt_.id], lin], M[gt_.id].material)
                    pre[[m_.name for m_ in pre].index(merged.name)] = merged; M[gt_.id] = merged
                    log("collar liner: %d vertices, %d triangles" % (len(lin.v), len(lin.tris)))
            log("props", [m.name for m in extra], "sole %.1f mm" % (prop_info["soleHeight_m"] * 1000))
        except Exception as ex:
            log("props FAILED:", repr(ex)); prop_info = None
    # round 11: the collar band and the trainer as ONE mesh and material (one draw call fewer: the woman's outfit was 13 with her hair)
    col2_ = next((m_ for m_ in pre if m_.name == "garment_collar"), None); tr2_ = next((m_ for m_ in pre if trainer is not None and m_.name == trainer.name), None)
    if MERGE_COLLAR_INTO_SHOES and col2_ is not None and tr2_ is not None and "prop_collar" in mats and tr2_.material in mats:
        try:
            mm_, mat_ = atlas_merge(tr2_, col2_, mats[tr2_.material], mats["prop_collar"])
            pre[pre.index(tr2_)] = mm_; pre.remove(col2_); mats[tr2_.material] = mat_; mats.pop("prop_collar"); classes.pop("prop_collar", None)
            log("collar band merged into %s: %d + %d vertices, one material, maps %s" % (mm_.name, len(tr2_.v), len(col2_.v), sorted(set(os.path.basename(x) for x in mat_["_images"].values()))))
        except Exception as ex: log("collar merge FAILED (kept as two meshes):", repr(ex))
    hp = None
    if sex == "f":                                     # B9: the woman's hair under the cap (README "Hair under the cap")
        import hair_cap
        hair_cap.P.update(HAIR_CAP_P)                  # round 13 (REVIEW-09 item 6, "the choppy nape fringe tips"): B9's parameters, in their ranges
        hp = hair_cap.build(c, e, pre, tone=tone, sex=sex, out=out)
        pre.append(hp.mesh); mats.update(hp.materials); classes.update(hp.classes)
    # ---- the clay figure in the SAME package (REVIEW-04, W-11: the swap fell back to the bare grey body with toes)
    clay = None
    try: clay = clay_style(c, e, erig, jnames, sex, base, up, out, name, bview0, W8b=W8b)
    except Exception as ex: log("clay style FAILED:", repr(ex))
    if clay: pre.extend(clay["meshes"]); mats.update(clay["mats"]); classes.update({k: {"class": "plain"} for k in clay["mats"]})
    # ---- shape on the CPU for every mesh of mine too (budget: 40 targets x POSITION+NORMAL were 29 of the GLB's 44 MB)
    bakes = []
    # round 11 (budget, REVIEW-07 item 6): B6's props (trainer, headset, collar) go onto the CPU bake too: their explicit normals are the
    # area-weighted normals of their own faces once vertices that share position and normal share a bake row (UV-seam copies), so the
    # viewer's recomputed normals are theirs (measured: under 0.2 degrees); a mesh whose normals are not (the clay style's last) stays on the GPU
    def bake_rows(m):
        n = len(m.v)
        if m.normals is None: return np.arange(n), np.arange(n), 0.0
        key = np.round(np.c_[np.asarray(m.v, float) * 1e5, np.asarray(m.normals, float) * 50]).astype(np.int64)
        _, first, src = np.unique(key, axis=0, return_index=True, return_inverse=True); src = src.ravel()
        P_ = np.asarray(m.v, float)[first]; T_ = src[np.asarray(m.tris)]; fn_ = np.cross(P_[T_[:, 1]] - P_[T_[:, 0]], P_[T_[:, 2]] - P_[T_[:, 0]]); N_ = np.zeros_like(P_)
        for k_ in range(3): np.add.at(N_, T_[:, k_], fn_)
        N_ /= np.linalg.norm(N_, axis=1, keepdims=True) + 1e-20; Na_ = np.asarray(m.normals, float); Na_ = Na_ / (np.linalg.norm(Na_, axis=1, keepdims=True) + 1e-20)
        return src, first, float(np.degrees(np.arccos(np.clip((N_[src] * Na_).sum(1), -1, 1))).max())
    wear = []
    for m in pre:
        if not (BAKE and m is not body and m.morphs and "_SRC" not in (m.attrs or {}) and not m.name.startswith(("eyeball", "eye_", "lashes"))): continue
        src_, first_, worst_ = bake_rows(m)
        if worst_ > 1.0: log("kept on the GPU (own normals are not the faces' normals, %.1f deg): %s" % (worst_, m.name)); continue
        wear.append((m, src_, first_))
    if wear:
        n0 = 0; bs_ = []; bt2 = {t: [] for t in c.targets}
        for m, src_, first_ in wear:
            n = len(first_); bs_.append(np.asarray(m.v, float)[first_] + up)
            for t in bt2: bt2[t].append(np.asarray(m.morphs.get(t, np.zeros((len(m.v), 3))))[first_])
            m.attrs = {**(m.attrs or {}), "_SRC": (n0 + src_).astype(np.float32)}; m.morphs = {}; n0 += n
        blk, _ = bb.write_shape_bin(os.path.join(out, name + ".wear.shape.bin"), np.vstack(bs_), {t: np.vstack(x) for t, x in bt2.items()})
        blk["meshes"] = [m.name for m, _, _ in wear]; bakes.append(blk)
        log("baked on the CPU:", blk["meshes"], "%d rows" % n0)
    if clay: bakes.append(clay["bake"])
    outfit = [lifted(m) for m in pre]
    for m_ in outfit:                                                 # round 11: no mesh without the eight-influence set
        if m_.weights is not None and not all(k in (m_.attrs or {}) for k in SKIN8): put8(m_, dense8(m_, nbj)); log("eight-influence set from its four:", m_.name)
    path = os.path.join(out, name + ".glb")
    stats = glb.write_glb(path, outfit, skel, mats, generator="rigtwin avatar-lab pipeline/build_operator.py (MakeHuman / MPFB2 data; see CREDITS.md)")
    if DROP_HIDDEN_BODY:
        # round 13 (coordinator): the body's triangles whose three corners lie deep under the shirt, trousers and shoes (more than the
        # setback, the mask's ramp and 20 mm inside every option of those always-filled slots) can never be seen in the dressed style:
        # they leave the body's index buffer; its vertices, their order and every attribute stay
        dropped_ = drop_triangles(path, "body", ~deep[c.tris].all(1))
        stats["meshes"] = [{**m_, "triangles": m_["triangles"] - dropped_} if m_.get("name") == "body" else m_ for m_ in stats["meshes"]]
        stats["bytes"] = os.path.getsize(path); log("body: %d hidden triangles left out of %d" % (dropped_, len(c.tris)))
    problems = glb.validate(path)
    log("glb", stats["bytes"], "bytes,", len(outfit), "meshes, validate:", problems or "clean")
    gstats = {}
    shutil.rmtree(os.path.join(out, "garments"), ignore_errors=True)      # no side GLBs any more: the first set is all in the main GLB
    for f_ in glob.glob(os.path.join(out, "maps", "*ankle_boot*")): os.remove(f_)
    for f_ in glob.glob(os.path.join(out, "maps", "fabric_*_n.jpg")):            # round 6: weave maps no garment uses any more (the cap's jersey)
        if os.path.basename(f_)[7:-6] not in {g_.spec.get("fabric") for g_ in G.values() if g_.spec.get("klass") == "cloth"}: os.remove(f_)

    # ---- manifest
    tmp = os.path.join(mt.CACHE, "body-manifest-" + sex)             # B1's manifest of the SAME context, rebuilt every time (never a stale copy)
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()): man = bb.build(tmp, sex)
    # round 9 (B4's motion block, README Motion round 6): clips, packet poses and seat rule from the body package, clip paths relinked
    bb.merge_motion(man, os.path.join(LAB, "packages", bb.NAMES[sex]))
    rl = lambda o: {k: rl(x) for k, x in o.items()} if isinstance(o, dict) else [rl(x) for x in o] if isinstance(o, list) else ("../%s/%s" % (bb.NAMES[sex], o) if isinstance(o, str) and o.startswith("clips/") else o)
    man["clips"] = rl(man.get("clips", []))
    if "motion" in man: man["motion"] = rl(man["motion"])
    if os.path.exists(os.path.join(tmp, "poses.json")): shutil.copy(os.path.join(tmp, "poses.json"), os.path.join(out, "poses.json"))
    man["name"] = name; man["glb"] = name + ".glb"
    man["note"] = "Direction 1 'The Operator' on B1's body (%s; RP's shape space, RR's rig): head kit and a wardrobe of swappable garments, each fitted by .mhclo binding on the base and on every shape target, layered by rule, with real edge geometry and its own per-pixel body-hide mask. Not reviewed." % ("man" if sex == "m" else "woman")
    man["rest"]["soleHeight"] = round(lift, 4)
    if man["rest"].get("eyeHeight"): man["rest"]["eyeHeight"] = round(man["rest"]["eyeHeight"] + lift, 4)
    for k_, d_ in man.get("shape", {}).get("jointDeltas", {}).items():   # the lid joints move with their eye joint under every shape target
        for si, side in enumerate(("l", "r")):
            if "eye_" + side in d_: d_[eyes.LID_JOINTS[2 * si]] = d_["eye_" + side]; d_[eyes.LID_JOINTS[2 * si + 1]] = d_["eye_" + side]
    man["eyes"] = eyes.eye_manifest(e, erig, "shell"); man["eyes"]["irisPresets"] = eyes.IRIS
    # eye_manifest writes rest positions in the bare-sole frame; this package stands on its soles (lifted): move them with it.
    # (Round 3 packages had the eye centres and lid vertices 28 mm too low for the viewer's eye module: lids half closed, gaze down.)
    for sd_ in man["eyes"]["sides"].values(): sd_["centre"][1] = round(sd_["centre"][1] + lift, 6)
    for it_ in man["eyes"].get("lift", []):
        for v_ in it_["verts"]: v_[1] = round(v_[1] + lift, 6)
    # the body's shape file: THIS body (B5's re-seated lids, the rest expression, lifted onto its soles), not the clay body's
    nb_ = int(base.vgroups["body"].sum())
    man["shape"].pop("bake", None)
    if BAKE: bake, qerr = bb.write_shape_bin(os.path.join(out, name + ".shape.bin"), e.base_v[:nb_] + up, {t: np.asarray(d)[:nb_] for t, d in e.targets.items()})
    if BAKE: bake["meshes"] = ["body"]; man["shape"]["bake"] = [bake] + bakes
    other = "operator-f" if sex == "m" else "operator-m"                # the other sex's people come from the other package (line-ups)
    man.setdefault("packet", {})["otherPackages"] = ["../%s/%s.avatar.json" % (other, other)]
    man["packet"]["outfitsExtreme"] = ["operator", "operator_sand"]
    if clay: man["styles"] = clay["styles"]; man["defaultStyle"] = "dressed"; man["materials_note"] = "clay_figure: B7's material (pipeline/abstract.py P)"
    P = man.setdefault("packet", {}).setdefault("poses", {})           # two probe poses for the edge close-ups (B2/edge-shots.json)
    P["B2_ELBOW90"] = {"dofs": rr.clinical_to_dofs(c.pack, {"shoulder_flexion": 30, "elbow_flexion": 90, "both_sides": True, "hand": "HAND_RELAXED"})}
    P["B2_HIP95"] = {"dofs": rr.clinical_to_dofs(c.pack, {"hip_flexion": 95, "knee_flexion": 90, "both_sides": True, "hand": "HAND_RELAXED"})}
    rel = lambda p: os.path.relpath(p, LAB)
    man["licence"] = man.get("licence", []) + [{"what": "head kit: " + k, "title": p[3], "author": p[2], "source": rel(p[0]), "licence": p[1]} for k, p in HEAD_KIT.items()] + [
        {"what": "garment " + gid, "title": s["title"], "author": s["author"], "source": rel(s["src"]), "url": s["url"], "licence": s["licence"],
         "changes": "re-fitted to the body shapes, edges given thickness, texture reduced to a neutral detail map and re-coloured"} for gid, s in ((g_.id, g_.spec) for g_ in G.values())] + [
        {"what": "skin albedo (%s, %s)" % (sex, tone), "source": _skin_src(sex, tone)[0], "licence": "CC0-1.0", "changes": "baked shading reduced; cropped hair painted in"},
        {"what": "skin roughness zones", "source": "skins02_cc0/skins/mindfront_aksel_skin (SPEC)", "licence": "CC0-1.0", "author": "Mindfront"},
        {"what": "eyeballs, tear line, lid joints, iris structure texture", "source": "pipeline/eyes.py (B5), generated", "licence": "own work"}]
    man["materials"] = {k: v for k, v in classes.items() if k in mats}
    slots = {}
    for gid, g in G.items():
        sp_ = g.spec; mn = mat_name(gid)
        o = {"id": gid.split(".")[1], "label": sp_["label"], "meshes": ["glasses"] if g.slot == "glasses" else [mesh_name(gid)],
             "colourways": [{"id": k, "label": k.capitalize(), "srgb": list(v), "materials": {mn: {"color": [round(x, 4) for x in ((mt.lin(v)) if sp_["klass"] == "plain" else mt.colour_factor(v)[:3])]}}} for k, v in sp_["colours"].items()],
             "licence": sp_["licence"], "author": sp_["author"]}
        if gid in masks: o["bodyMask"] = "maps/mask_%s.png" % gid.replace(".", "_"); o["cover"] = "maps/cover_%s.png" % gid.replace(".", "_")
        if sp_.get("worn"): o["worn"] = sp_["worn"]
        if g.slot == "shoes": o["soleHeight"] = round(-float(g.p0[:, 1].min()), 4)
        if gid in gstats: o["stats"] = gstats[gid]
        slots.setdefault(g.slot, []).append(o)
    if prop_info:
        names_ = [m.name for m in pre]
        if "garment_collar" in names_:
            for o in slots.get("top", []):
                if o["id"] == pick["top"]: o["meshes"].append("garment_collar")
        if "prop_headset" in names_:
            slots["headset"] = [{"id": "operator_headset", "label": "Operator headset (B6, modelled)", "meshes": ["prop_headset"], "colourways": [], "licence": "own work", "author": "avatar-lab B6"}]
            pick = {**pick, "headset": "operator_headset"}
        if trainer is not None and "shoes.safety_trainer" in masks:
            slots.setdefault("shoes", []).append({"id": "safety_trainer", "label": "Safety trainer on a last (B6, modelled)", "meshes": [trainer.name],
                                   "bodyMask": "maps/mask_shoes_safety_trainer.png", "cover": "maps/cover_shoes_safety_trainer.png", "colourways": [], "soleHeight": round(prop_info["soleHeight_m"], 4),
                                   "licence": "own work", "author": "avatar-lab B6"})
        man["build_props"] = prop_info["props"]
    if sex == "f" and HAIR_PICK:
        slots["hair"] = [{"id": hid, "label": HAIR_LABEL.get(hid, hid), "meshes": [hm_.name], "colourways": [], "licence": "CC0-1.0", "author": src_[1]} for hid, hm_, _p, src_ in hairs]
        if "tucked" in HAIR_PICK or not hairs: slots["hair"].append({"id": "tucked", "label": HAIR_LABEL["tucked"], "meshes": [], "colourways": [], "licence": "own work", "author": "avatar-lab B2"})
        hdef = HAIR_PICK[0] if any(g_["id"] == HAIR_PICK[0] for g_ in slots["hair"]) else slots["hair"][0]["id"]; pick = {**pick, "hair": hdef}
        for hid, hm_, _p, src_ in hairs: man["licence"].append({"what": "hair (woman): " + hid, "title": os.path.basename(src_[0])[:-6], "author": src_[1], "source": rel(src_[0]), "licence": "CC0-1.0", "changes": "the part under the cap left out; re-coloured"})
    if hp is not None:
        slots["hair"] = [hp.garment]; pick = {**pick, "hair": hp.garment["id"]}; man["licence"].append(hp.licence)
    LABEL = {"hair": "Hair", "shoes": "Shoes", "trousers": "Trousers", "top": "Top", "cap": "Cap", "glasses": "Glasses", "headset": "Headset"}
    man["wardrobe"] = {
        "note": "ONE outfit in colourways (shirt, work trousers, safety trainer, cap; headset and glasses on or off), not a wardrobe of outfits, until a second outfit passes review (VD/REVIEW-04). The cap is not optional: there is no hair yet that passes bare-headed.",
        "slots": [{"id": s_, "label": LABEL.get(s_, s_), "default": pick.get(s_), "allowNone": s_ in OPTIONAL or s_ == "headset" or (s_ == "hair" and len(slots.get("hair", [])) > 1), **({"headDress": True} if s_ == "cap" else {}), "garments": o} for s_, o in slots.items()],
        "outfits": [{"id": of["id"], "label": of["label"], "wear": {s_: (pick.get("hair") if s_ == "hair" else {"garment": of["pick"][s_], "colourway": of["colours"].get(s_)} if s_ in of["pick"] and any(o_["id"] == of["pick"][s_] for o_ in slots[s_]) else None) for s_ in slots}} for of in OUTFITS],
        "bodyMask": {"space": "body UV0; image row 0 = glTF v 0 (the base colour image's orientation)", "size": msize, "white": "hidden",
                     "encoding": "value/255 = 0.5 + (d - setback) / (2 * range); d = distance along the skin from the garment's opening inward; cut at 0.5, sampled bilinearly, so the cut line is smooth and lies `setback` inside every opening",
                     "setback_m": SETBACK, "range_m": MASK_RANGE},
        "layering": {"order": ["skin", "shoes", "trousers", "top", "cap"], "under_the_shirt_m": HUG, "clearance_m": {"cloth over skin at openings": EASE, "layer over layer": LAYER},
                     "rule": "every trousers option clears every shoes option; every top is worn out and clears every trousers option; the fits are the same whatever else is worn"}}
    tris_total = sum(m["triangles"] for m in stats["meshes"])
    man["build"] = {"by": "pipeline/build_operator.py", "stats": stats, "validate": problems, "triangles": tris_total, "drawCalls": len(outfit), "soleHeight_m": round(lift, 4)}
    json.dump(man, open(os.path.join(out, name + ".avatar.json"), "w"), indent=1)
    write_credits(out, name, sex, tone, {g_.id: g_.spec for g_ in G.values()})
    log("package", out, "draw calls", len(outfit), "triangles", tris_total, "bytes", stats["bytes"], "%.0fs" % (time.time() - t0))
    if check:
        G2 = dict(G)
        if trainer is not None:
            import types
            J_, W_ = top4(trainer.weights) if trainer.joints is None else (np.asarray(trainer.joints), np.asarray(trainer.weights, dtype=np.float32))
            G2["shoes.safety_trainer"] = types.SimpleNamespace(id="shoes.safety_trainer", slot="shoes", p0=tv_, morphs={k: shoe_inner["shoes"][0][0][k] - tv_ for k in c.targets},
                                                               J4=J_, W4=W_, dqs=np.asarray((trainer.attrs or {}).get("_DQS", np.zeros(len(tv_))), dtype=np.float32), tris_out=tt_,
                                                               J8=np.c_[trainer.attrs[SKIN8[0]], trainer.attrs[SKIN8[2]]], W8=np.c_[trainer.attrs[SKIN8[1]], trainer.attrs[SKIN8[3]]])
        rep = check_combinations(c, G2, man, dist, sex)
        json.dump(rep, open(os.path.join(out, "penetration.json"), "w"), indent=1)
    if B8_DRESS:
        # round 11 (coordinator; B8's pipeline/README.md "Cloth form", round 2, "For B2: the exact integration"): the trousers get B8's four
        # seated correctives (lap and knee per side, on hip and knee flexion) and the seated fold map with its pose fade (viewer/src/cloth-pose.ts);
        # the shirt's normal texture becomes the standing fold map, re-baked on THIS fit when B2/baked/shirt-<sex>/ holds one (else B8's)
        import cloth_bake as cb
        seat_ = os.path.join(LAB, "B8", "baked", "r2", sex, "seat")
        shirt_ = next((p_ for p_ in (os.path.join(LAB, "B2", "baked", "shirt-" + sex), os.path.join(LAB, "B8", "baked", "r2", sex, "shirt"))
                       if os.path.exists(os.path.join(p_, "garment_top_shirt_fold_stand_n.jpg"))), None)
        sh_g = next((g_ for g_ in G.values() if g_.slot == "top" and getattr(g_, "details_normal", None)), None)
        shirt_re = recompose_shirt_map(shirt_, sh_g.details_normal, out.rstrip("/") + ".shirtmap") if (shirt_ and sh_g) else None
        if shirt_re: shirt_ = shirt_re
        if os.path.isdir(seat_):
            tmp_ = out.rstrip("/") + ".b8"
            try:
                cb.dress2(out, seat_, tmp_, shirt=shirt_); shutil.rmtree(out); os.rename(tmp_, out)
                log("B8 round 2 taken: seated correctives and map from %s, shirt map from %s" % (os.path.relpath(seat_, LAB), os.path.relpath(shirt_, LAB) if shirt_ else "none"))
            except SystemExit as ex:
                shutil.rmtree(tmp_, ignore_errors=True); log("B8 dress FAILED (the package is left as built):", ex)
        if shirt_re: shutil.rmtree(shirt_re, ignore_errors=True)
        # round 13 (coordinator; B8's pipeline/README.md "Cloth form", round 3, "For B2: the exact integration"): standing hip-flexion
        # and heavy-build seated trouser targets, set by viewer/src/cloth-pose.ts
        extra_ = os.path.join(LAB, "B8", "baked", "r3", sex)
        if os.path.isdir(extra_):
            tmp_ = out.rstrip("/") + ".b8x"
            try:
                cb.dress_extra(out, extra_, tmp_); shutil.rmtree(out); os.rename(tmp_, out); log("B8 round 3 taken: raise and heavy correctives")
            except SystemExit as ex:
                shutil.rmtree(tmp_, ignore_errors=True); log("B8 round 3 dress FAILED (the package is left with round 2):", ex)
    return man


def _plain(asset):
    """The asset with no authored textures (cap: its texture is a slogan)."""
    a = object.__new__(wd.Asset); a.__dict__.update(asset.__dict__); a.textures = {}
    return a


def _skin_src(sex, tone):
    """(source path below the packs, author, pack) of this tone's skin albedo."""
    p = mt.SKINS[sex][tone]
    if os.path.isabs(p): return os.path.relpath(p, mt.PACKS), "callharvey3d" if "callharvey3d" in p else "see pack metadata", "MakeHuman community asset pack skins01"
    return "makehuman_system_assets_cc0/skins/" + p, "MakeHuman team", "MakeHuman system assets"


def write_credits(out, name, sex, tone, specs=None):
    L = ["# Credits: " + name, "", "Every third-party asset in this package, with its licence. CC-BY items must stay credited wherever the package is shown.", "",
         "| Part | Title | Author | Source | Licence | Changes |", "|---|---|---|---|---|---|",
         "| Body mesh, UVs, shape targets, rig, weights | MakeHuman hm08 base (MPFB2 2.0.18 data) | MakeHuman team | https://github.com/makehumancommunity/mpfb2 | CC0-1.0 | subset of targets; skeleton and weights as painted |"]
    for k, p in HEAD_KIT.items(): L.append("| Head kit: %s | %s | %s | MakeHuman system assets, %s | %s | re-fitted to the body shapes |" % (k, p[3], p[2], MHC, p[1]))
    for gid, s in (specs or GARMENTS).items(): L.append("| Garment %s | %s | %s | MakeHuman community asset packs, %s | %s | re-fitted to the body shapes; edge thickness added; texture reduced to a neutral detail map and re-coloured |" % (gid, s["title"], s["author"], s["url"], s["licence"]))
    L += ["| Skin albedo (%s, %s) | %s | %s | %s | CC0-1.0 | baked shading reduced; scalp paint replaced by plain skin; hair painted in at temples and nape |" % ((sex, tone, os.path.basename(mt.SKINS[sex][tone])) + _skin_src(sex, tone)[1:]),
          "| Skin roughness zones | Aksel skin (specular map) | Mindfront | MakeHuman community asset pack skins02 | CC0-1.0 | remapped to roughness |"]
    if sex == "f":
        for hid in HAIR_PICK:
            if hid in HAIRS: L.append("| Hair (%s) | %s | %s | MakeHuman assets, %s | CC0-1.0 | the part under the cap left out; re-coloured |" % (hid, os.path.basename(HAIRS[hid][0])[:-6], HAIRS[hid][1], MHC))
    L += ["",
          "CC-BY 4.0: https://creativecommons.org/licenses/by/4.0/ . Licences as recorded in each asset's own file header and pack metadata (RA/pack-asset-licences.tsv, 2026-11-24)."]
    open(os.path.join(out, "CREDITS.md"), "w").write("\n".join(L) + "\n")


# ------------------------------------------------------------------------------------------------ checks
def check_combinations(c, G, man, dist, sex):
    """Every top x trousers x shoes, the packet people of this sex, three poses (RR's reference posing and skinning, 8
    influences (round 11; 4 before) and the `_DQS` blend as the viewer does), morphs combined linearly as the viewer combines them.
    skin_out: facing skin outside the cloth, on skin INSIDE this garment's openings that the outfit's mask leaves visible.
    hem / waist: trousers inside shoes, top inside trousers. hidden_skin_out: the same against skin the mask hides (cannot be
    seen; a record of how far cloth sinks, e.g. in the lap)."""
    controls, model, measures, person, mesh_of, weights_of, info = bb.shape_model(c)
    hand = {"both_sides": True, "hand": "HAND_RELAXED"}
    poses = {"stand": rr.clinical_to_dofs(c.pack, dict(hand)), "elbow90": rr.clinical_to_dofs(c.pack, {"shoulder_flexion": 30, "elbow_flexion": 90, **hand}),
             "ankle_dorsi20": rr.clinical_to_dofs(c.pack, {"ankle_dorsiflexion": 20, **hand}), "ankle_plantar30": rr.clinical_to_dofs(c.pack, {"ankle_plantarflexion": 30, **hand}),   # B6 round 3: the trainer was not checked at the ankle
             "hip95": rr.clinical_to_dofs(c.pack, {"hip_flexion": 95, "knee_flexion": 90, **hand})}
    by = {}
    for g in G.values(): by.setdefault(g.slot, []).append(g)
    rep = {"rows": {}}
    for key in [k for k in bb.PERSONS[sex] if k in CHECK_PERSONS]:
        st, kg, extra = bb.PERSONS[sex][key]
        vals, _ = person(bb.SEXNUM[sex], st, kg, **extra); w = weights_of(vals)
        B = c.base_v + sum(w.get(t, 0) * d for t, d in c.targets.items())
        heads = c.skeleton.head + sum(w.get(t, 0) * c.joint_targets[t] for t in c.targets)
        for pname, dv in poses.items():
            Mx = rr.pose_matrices(c.pack, heads, dv)
            # round 11: eight influences, as the viewer now skins every mesh (body: RR's eight; cloth and shoe: their own)
            Bp = rr.skin(B, c.J8, c.W8, Mx, c.dqs)
            P = {g.id: rr.skin(g.p0 + sum(w.get(t, 0) * d for t, d in g.morphs.items()), getattr(g, "J8", g.J4), getattr(g, "W8", g.W4), Mx, g.dqs) for g in G.values() if g.slot in ("top", "trousers", "shoes")}
            def against(g, inner_v, inner_tris, cloth_only=False):
                if not len(inner_tris): return {"n": 0, "worst_mm": 0.0, "min_clear_mm": None, "seen_n": 0, "seen_worst_mm": 0.0}
                if cloth_only:
                    # round 5 (B2, second pass): at ankle +20 the hem's folds that face the floor were measured against the floor-facing
                    # underside of the trainer's rolled collar lip, 13-25 mm BELOW them, and read as 8-23 mm "inside" the shoe; ray tests
                    # from 10-23 outward directions found no shoe in front of those points. A hem cannot be inside a shoe surface that
                    # faces the floor: those faces are left out of this test.
                    fn = np.cross(inner_v[inner_tris[:, 1]] - inner_v[inner_tris[:, 0]], inner_v[inner_tris[:, 2]] - inner_v[inner_tris[:, 0]])
                    inner_tris = inner_tris[fn[:, 1] / np.clip(np.linalg.norm(fn, axis=1), 1e-12, None) > -0.5]
                has, cl, _, _ = wd.clearance(P[g.id], g.tris_out, inner_v, inner_tris)
                # against a modelled shoe (a thick, two-sided thing) only the cloth's own surface counts: the hem's inner lip faces the leg,
                # as the shoe's collar lining does, and was counted as 10 mm "inside" it
                if cloth_only: has = has & (np.arange(len(has)) < len(g.used))
                bad = has & (cl < 0)
                out_ = {"n": int(bad.sum()), "worst_mm": round(float(-cl[bad].min() * 1000), 1) if bad.any() else 0.0, "min_clear_mm": round(float(cl[has].min() * 1000), 1) if has.any() else None,
                        "where_rest_xyz": [round(float(x), 3) for x in g.p0[bad].mean(0)] if bad.any() else None,
                        "points_rest_xyz": [[round(float(x), 3) for x in q] for q in g.p0[bad][:12]] if bad.any() else []}
                if cloth_only:
                    # the tangent-plane measure is unreliable at the shoe's collar edge (cloth 10-15 mm ABOVE the lip read as inside its
                    # front face). A candidate counts only when, seen from some outward direction, the SHOE is the first surface in
                    # front of it and lies within 8 mm of it (the shoe showing through the cloth there), as in the renders.
                    seen = [i for i in np.flatnonzero(bad) if _shoe_in_front(P[g.id], g.tris_out, inner_v, inner_tris, i)]
                    out_["seen_n"] = len(seen); out_["seen_worst_mm"] = round(float(-cl[seen].min() * 1000), 1) if seen else 0.0
                return out_
            for top in by["top"]:
                for tr in by["trousers"]:
                    for sh in by["shoes"]:
                        row = {}
                        hidden = np.max([dist[g.id] for g in (top, tr, sh)], 0) >= SETBACK
                        th = c.tris[hidden[c.tris].all(1)]
                        for g in (top, tr, sh):
                            tv = c.tris[(~hidden[c.tris]).any(1) & (dist[g.id][c.tris] > 0.002).all(1)]
                            row[g.slot + ".skin_out"] = against(g, Bp, tv); row[g.slot + ".hidden_skin_out"] = against(g, Bp, th)
                        row["trousers_in_shoes"] = against(tr, P[sh.id], sh.tris_out, cloth_only=True); row["top_in_trousers"] = against(top, P[tr.id], tr.tris_out)
                        k = "%s/%s  %s + %s + %s" % (key, pname, top.id, tr.id, sh.id); rep["rows"][k] = row
                        log("%-62s skin_out %.1f  hem %.1f (%s pts seen/geometric)  waist %.1f (%s pts)  hidden-skin %.0f mm" % (k, max(row[s_ + ".skin_out"]["worst_mm"] for s_ in ("top", "trousers", "shoes")),
                            row["trousers_in_shoes"]["seen_worst_mm"], "%d/%d" % (row["trousers_in_shoes"]["seen_n"], row["trousers_in_shoes"]["n"]), row["top_in_trousers"]["worst_mm"], row["top_in_trousers"]["n"], max(row[s_ + ".hidden_skin_out"]["worst_mm"] for s_ in ("top", "trousers", "shoes"))))
    def agg(sel):
        rows = [r for k, r in rep["rows"].items() if sel(k)]
        return {"skin_out_mm": max(max(r[s_ + ".skin_out"]["worst_mm"] for s_ in ("top", "trousers", "shoes")) for r in rows),
                "hem_mm": max(r["trousers_in_shoes"]["seen_worst_mm"] for r in rows), "waist_mm": max(r["top_in_trousers"]["worst_mm"] for r in rows)}
    rep["worst"] = {"standing_and_elbow90": agg(lambda k: "hip95" not in k and "ankle" not in k), "ankle": agg(lambda k: "ankle" in k), "hip95": agg(lambda k: "hip95" in k)}
    # the hem's tangent-plane reading against the shoe, before the ray confirmation (recorded, not used for pass/fail)
    rep["hem_geometric_mm"] = {w: max([r["trousers_in_shoes"]["worst_mm"] for k, r in rep["rows"].items() if f(k)] or [0.0]) for w, f in
                               (("standing_and_elbow90", lambda k: "hip95" not in k and "ankle" not in k), ("ankle", lambda k: "ankle" in k), ("hip95", lambda k: "hip95" in k))}
    rep["hem_note"] = "hem_mm = worst depth of hem points that the shoe shows through (shoe the first surface within 8 mm in front, from some outward direction); hem_geometric_mm = the tangent-plane reading before that confirmation"
    rep["pass_ankle"] = max(rep["worst"]["ankle"].values()) <= 1.0; log("CHECK ankle +20 / -30:", "PASS" if rep["pass_ankle"] else "FAIL", rep["worst"]["ankle"])
    rep["tolerance_mm"] = 1.0
    rep["pass_standing"] = max(rep["worst"]["standing_and_elbow90"].values()) <= 1.0; rep["pass_seated"] = max(rep["worst"]["hip95"].values()) <= 1.0
    log("CHECK standing/elbow90:", "PASS" if rep["pass_standing"] else "FAIL", rep["worst"]["standing_and_elbow90"], "| hip95:", "PASS" if rep["pass_seated"] else "FAIL", rep["worst"]["hip95"])
    return rep


if __name__ == "__main__":
    a = sys.argv[1:]
    sex = a[0] if a and a[0] in ("m", "f") else "m"
    tone = next((x for x in a[1:] if x in ("light", "medium", "dark")), "light")
    opt = lambda n: a[a.index("--" + n) + 1] if "--" + n in a else None
    kv = lambda s: dict(x.split("=") for x in s.split(",")) if s else None
    pw = opt("props").split(",") if opt("props") else (None if "--no-props" in a else ["headset", "collar", "shoes"])
    build(sex, tone, out=opt("out") and os.path.join(LAB, opt("out")), name=opt("name"), pick=kv(opt("outfit")), colours=kv(opt("colours")), check="--check" in a, export_garments="--no-garments" not in a, props_which=pw)
