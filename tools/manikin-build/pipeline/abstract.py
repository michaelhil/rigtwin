# Abstract style "clay figure" on the shared hm08 body (owner: B7). Specification: VD/ABSTRACT-AND-WARDROBE.md section 1.
#   PY=$MANIKIN_PYTHON ; $PY -I work/avatar-lab/pipeline/abstract.py [--preview] [--no-subdiv] [--out DIR]
# Same vertices, same order, same skeleton and weights as packages/body-clay. The style is
#   v_style(shape) = N( A v(shape) )
# with A a LINEAR operator on the vertex array (membrane fills and masked smoothing: it commutes with the shape morphs, so
# every body shape gets the same neutralised surface) and N a base-only designed offset (shoe last, mouth corners).
# Extra meshes: two sculpted eyeballs (morph `abs_iris` = incised iris ring and pupil), two sole slabs. One material.
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spl
from scipy.spatial import ConvexHull, cKDTree
import mh_core as mh, glb, build_body as bb

LAB = bb.LAB
NAMES = {"m": "abstract-m", "f": "abstract-f"}
P = dict(                                   # style parameters (metres, degrees); class: design choice unless noted
    sole_default=0.0161,                    # used only if the dressed package does not report rest.soleHeight
    sole_ledge=0.0025, sole_rand=0.006,           # rand: how far the sole edge stands up round the last (hides the rounded foot of the last)                      # welt: how far the sole stands out beyond the last
    toe_allowance=0.007, last_margin=0.0025,
    eye_radius=0.0155, eye_inset=0.0009, iris_radius=0.00585, pupil_radius=0.0021, iris_groove=0.0007, iris_dish=0.00045, pupil_depth=0.0017,
    albedo=(0.33, 0.315, 0.29), roughness=0.6,          # linear; about 0.61 / 0.60 / 0.58 in sRGB. Designer: mid-light warm grey, "albedo about 0.55-0.62", roughness about 0.6, not the rig's white (B7/NOTES.md on the reading)
    mouth_corner_lift=0.35,
    lid_lip=0.0025, lid_clear=-0.0002,      # the lids taper onto the ball over this arc (no shelf, no gap); clearance of the margin. Round 4 (VD/REVIEW-05: dark specks
                                            # and a serrated margin): round 3's 4 mm taper to +0.15 mm left a long hair-thin wedge between lid and ball, which the
                                            # ambient occlusion broke into specks and the anti-aliasing into dashes; now a shorter taper ending 0.2 mm inside the ball,
                                            # so the lid meets the ball in a clean intersection line
    nostril_soften=0, nostril_soften_rings=4,   # round 7: Taubin steps round the nostril wings (0 = off)
    lid_standoff=0.0003,                    # round 5: least clearance of lid skin over the ball outside the margin taper (lid_lip)
    lid_standoff_corner=0.004,              # round 6: the stand-off fades out over this length towards each corner (it made a small step at the outer corner)
    navel_target_smooth=6,                  # round 6: plain smoothing steps on the shape targets over the navel patch (a faint dimple on heavy builds)
    nip_blend_rings=3, nip_blend_iters=6, nip_taubin=False, chest_dome_rings=5, chest_dome_bell=0.0, chest_dome_bell_f=0.8, chest_dome_bell_r=0.035, nip_dilate=2,   # round 7: the woman's chest dome rises 0.8 more over each nipple's core (radius 35 mm): the apex read as a small point (B1, F1 F05)   # the nipple patch's blend into the chest (round 6 may widen it: a faint mark at its edge, B1 M50)
    eye_rings=30, eye_segments=64,          # round 4: the sculpted ball, evenly fine where the lids meet it (round 3: 40 segments, 8-degree rings there)
    lip_tuck_up=0.0005, lip_tuck_back=0.0012,   # round 4: the lower lip's rim tucked under the upper lip's edge (base only): one seam line, no slit
    mouth_recess=0.004,                     # round 4: the collapsed mouth bag is set back behind the lip seam (base only), so no pale bar shows between the lips
    leg_below_lip=0.020, leg_below_floor=0.003,   # round 4: where the leg is cut inside B6's mid-cut last (last_cut)
    thinplate_targets=("navel", "groin", "cleft"),   # round 4: fills of the shape targets on these patches are thin plates (rest shape: membrane)
    waist_dome_rings=2, waist_dome_depth_weight=1.0, navel_excl=0.020, dome_secant=2.0,   # round 4: the waist dome (rings beyond the navel patch; its objective is RP's waist tape + weight x waist depth beside the navel); dome_secant: the domes follow a shape target by a central secant over +-this many units
    waist_dome_bell=-0.5, waist_dome_bell_r=0.03,  # round 6: the waist dome is half as high over the navel's core (radius 30 mm): its rise there read as a faint mark with a shadow under it on heavy builds (W4a)
    comp_off_navel=False,                   # round 6 test: no subdivision compensation over the navel patch
    subdivide_body=True, subdiv_comp=0.7,  # subdiv_comp: one Catmull-Clark level shrinks the visible surface (girths 2 to 6 mm smaller); the body's control points
                                            # (not head and hands, which the designer passed as they are) are first set out by this fraction of (v - S_V v)                    # round 4: one Catmull-Clark level on the whole body (round 3: head and hands only; VD/REVIEW-05 C2)
    own_last=False,                         # round 2: the shod foot is B6's last (props.build(which=("last",))); True = round 1's toe box on a slab
    lid_lower=0.0,                         # fraction of the upper lid's full closing angle baked into the rest head (a relaxed opening)
    gaze_down_deg=0.0, gaze_in_deg=0.0,     # the sculpted eyes look slightly down and converge
)
unit = lambda a: a / np.linalg.norm(a)
sstep = lambda t: np.clip(t, 0, 1) ** 2 * (3 - 2 * np.clip(t, 0, 1))


def ray_hits(orig, dirs, tri_pts, tmax=1.0, chunk=256):
    """Nearest hit distance of each ray on the triangles (Moeller-Trumbore), inf if none."""
    a = tri_pts[:, 0]; e1 = tri_pts[:, 1] - a; e2 = tri_pts[:, 2] - a
    out = np.full(len(orig), np.inf)
    for s in range(0, len(orig), chunk):
        o = orig[s:s + chunk, None, :]; d = dirs[s:s + chunk, None, :]
        p = np.cross(d, e2[None]); det = (e1[None] * p).sum(-1)
        ok = np.abs(det) > 1e-14; inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
        t0 = o - a[None]; u = (t0 * p).sum(-1) * inv
        q = np.cross(t0, e1[None]); w = (d * q).sum(-1) * inv; t = (e2[None] * q).sum(-1) * inv
        hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1) & (t > 1e-5) & (t < tmax)
        out[s:s + chunk] = np.where(hit, t, np.inf).min(1)
    return out


class Style:
    """Regions and operators on the base topology. Built once from the package rest shape."""
    def __init__(self, c, verbose=True, eye=None):
        self.c = c; base = c.base; v = c.base_v; self.v0 = v; NV = len(v); self.NV = NV
        body = base.vgroups["body"]; self.body = body
        q = c.quads; e = np.concatenate([q[:, [0, 1]], q[:, [1, 2]], q[:, [2, 3]], q[:, [3, 0]]])
        A = sp.coo_matrix((np.ones(len(e) * 2), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(NV, NV)).tocsr()
        A.data[:] = 1.0; self.A = A; deg = np.asarray(A.sum(1)).ravel(); self.deg = np.maximum(deg, 1)
        self.Abar = sp.diags(1 / self.deg) @ A
        r = c.rig; names = r.bones; BI = {b: i for i, b in enumerate(names)}; self.BI = BI
        W = r.weights.tocsr(); dom = np.asarray(W.argmax(1)).ravel(); self.dom = dom
        def family(root):
            out = []
            for i in range(len(names)):
                j = i
                while j >= 0:
                    if j == BI[root]: out.append(i); break
                    j = r.parent[j]
            return out
        head = np.isin(dom, family("head")) & body; self.head = head
        n = mh.smooth_normals(v, c.tris); self.n0 = n
        J, _ = mh.joint_positions(v, r); self.J = J                      # MPFB joints, for landmarks only (the package skeleton is not touched)
        log = print if verbose else (lambda *a: None)
        # ---- cavities of the head: the ray along the vertex normal meets the opposite wall close by
        hv = np.nonzero(head)[0]; ht = c.tris[head[c.tris].all(1)]
        d_n = ray_hits(v[hv] + n[hv] * 1e-4, n[hv], v[ht], tmax=0.08)
        cav = np.full(NV, np.inf); cav[hv] = d_n; self.cav = cav
        tip = hv[np.argmax(v[hv, 2])]; self.nose_tip = v[tip].copy(); ny = v[tip, 1]
        x, y, z = v[:, 0], v[:, 1], v[:, 2]
        eyeL = J[BI["eye.L"]]; fl = sphere_fit(v[base.vgroups["helper-l-eye"]]); fr = sphere_fit(v[base.vgroups["helper-r-eye"]])
        self.eye = {"L": fl[0], "R": fr[0]}; self.eye_r = 0.5 * (fl[1] + fr[1]) - P["eye_inset"]     # the ball the lids were authored on, set in a little
        if eye is not None: self.eye = {"L": np.asarray(eye["l"][0]), "R": np.asarray(eye["r"][0])}; self.eye_r = float(eye["l"][1])   # B5's fitted eye (round 2)
        ez = eyeL[2]; hw = np.abs(x[hv]).max(); hz = J[BI["upperleg01.L"]][2]
        nostril = head & (np.abs(x) < 0.024) & (y > ny - 0.022) & (y < ny + 0.004) & (z > ez - 0.008) & (cav < 0.011)
        # the mouth bag: everything of the head that lies behind the lips, found by flood fill from deep cavity vertices
        box = np.nonzero(head & (np.abs(x) < 0.035) & (y > ny - 0.075) & (y < ny - 0.008) & (z > ez - 0.113))[0]; occ = np.zeros(len(box), int)
        for d in ([0, 0, 1.0], [0, -0.35, 0.94], [0, 0.35, 0.94], [0.3, 0, 0.95], [-0.3, 0, 0.95]):
            d = np.array(d); occ += np.isfinite(ray_hits(v[box] + d * 1e-4, np.repeat(d[None], len(box), 0), v[ht], tmax=0.2))
        mouth = np.zeros(NV, bool); mouth[box[occ >= 2]] = True               # the bag behind the lips: hidden from the front
        self.regions = {}
        self.regions["nostril"] = nostril; self.regions["mouth"] = mouth
        # ---- body detail
        nip = np.zeros(NV, bool); nip[1778:1794] = True; nip[8450:8466] = True
        nip = self.dilate(nip, P.get("nip_dilate_" + str(c.sex), P["nip_dilate"])) & body   # round 7: the woman's patch may cover more of the areola's cone
        # navel: the pit on the front mid line of the belly
        bm = np.nonzero(body & (np.abs(x) < 0.003) & (z > 0.05) & (y > J[BI["spine05"]][1] + 0.06) & (y < J[BI["spine05"]][1] + 0.22))[0]
        o = bm[np.argsort(y[bm])]; zz = z[o]; k = 1 + np.argmin(zz[1:-1] - 0.5 * (zz[:-2] + zz[2:])) if len(o) > 2 else 0
        self.navel = v[o[k]].copy()
        # the navel is a dense little crater in hm08's topology: take the dense vertices near the landmark, their centre, and
        # two rings beyond (a ball round the landmark alone cut the crater in half: the lower half stayed and deepened on heavy builds)
        ed = np.linalg.norm(v[e[:, 0]] - v[e[:, 1]], axis=1); el = np.zeros(NV); np.add.at(el, e[:, 0], ed); np.add.at(el, e[:, 1], ed); el = el / np.maximum(2 * deg, 1)
        nearn = body & (np.linalg.norm(v - self.navel, axis=1) < 0.05); crater = nearn & (el < 0.6 * np.median(el[nearn]))
        if crater.sum() >= 4: self.navel = v[crater].mean(0)
        navel = (self.dilate(crater, 2) | (np.linalg.norm((v - self.navel) * np.array([1, 1, 0.5]), axis=1) < 0.03)) & body & nearn
        navel = self.dilate(navel, 1) & body                               # one ring more: the crater's outer wall, which deepens on heavy builds, must be inside
        hipy = J[BI["upperleg01.L"]][1]; cy = v[np.nonzero(body & (np.abs(x) < 0.004) & (y > hipy - 0.2) & (y < hipy + 0.05))[0], 1].min()
        self.crotch_y = cy
        groin = body & (np.abs(x) < 0.05) & (y > cy + 0.004) & (y < cy + 0.05) & (z > hz + 0.045)     # no tapering strip up the mid line: a membrane across a narrow strip is a groove (it read as a navel on heavy builds)
        groin |= body & (np.abs(x) < 0.016) & (y > cy + 0.006) & (y < cy + 0.04) & (z > hz + 0.012) & (z <= hz + 0.05)   # the front cleft on the women; the crotch point and the inner thighs stay (RP measures sitting height and thigh girth there)
        cleft = body & (np.abs(x) < 0.03) & (y > cy + 0.012) & (y < cy + 0.19) & (z < hz - 0.02)
        self.regions.update(nipple=nip, navel=navel, groin=groin, cleft=cleft)
        # ---- smoothing masks
        ear = head & (np.abs(x) > hw - 0.0215) & (y > eyeL[1] - 0.055) & (y < eyeL[1] + 0.03) & (z < ez - 0.048) & (z > ez - 0.143)
        ear &= (np.abs(x) > hw - 0.013) | (cav < 0.03)
        ear = self.dilate(ear, 1) & head
        de = np.minimum(np.linalg.norm(v - self.eye["L"], axis=1), np.linalg.norm(v - self.eye["R"], axis=1))
        lidrim = head & (de < self.eye_r + 0.0022)
        face = head & (z > ez - 0.068) & (y < eyeL[1] + 0.05) & (y > ny - 0.09) & ~ear
        self.masks = dict(ear=ear, face=face, lidrim=lidrim)
        tipb = [BI[f"finger{f}-3.{s}"] for f in range(1, 6) for s in "LR"]
        self.masks["fingertip"] = body & np.isin(dom, tipb)
        for k_, m in {**self.regions, **self.masks}.items(): log("  region %-10s %5d vertices" % (k_, int(m.sum())))
        self.lus = {}
        for k_ in ("nostril", "mouth", "nipple", "navel", "groin", "cleft"):
            m = self.regions[k_]; I = np.nonzero(m)[0]
            if not len(I): continue
            if k_ == "normalised thin plate (tried on the navel: it follows the crater wall into a pit; not used)":
                # least-squares thin plate with the normalised umbrella operator: a membrane across the navel is a flat spot on
                # a round belly (4 mm under the dome on the heavy builds: it read as a navel again); this one keeps the dome
                Ln = (sp.identity(NV, format="csr") - self.Abar).tocsr(); B2 = (Ln.T @ Ln).tocsr()
                self.lus[k_] = (I, spl.splu(B2[I][:, I].tocsc()), -(B2[I] @ sp.diags((~m).astype(float)))); continue
            if k_ == "thin-plate with the unnormalised operator (tried on the nipples: it leaves a cone; not used)":
                Lf = (sp.diags(self.deg) - A).tocsr(); B2 = (Lf @ Lf).tocsr()
                self.lus[k_] = (I, spl.splu(B2[I][:, I].tocsc()), -(B2[I] @ sp.diags((~m).astype(float)))); continue
            Lii = (sp.diags(self.deg[I]) - A[I][:, I]).tocsc()
            self.lus[k_] = (I, spl.splu(Lii), A[I] @ sp.diags((~m).astype(float)))
        # round 4: the shape targets get a thin-plate (biharmonic) fill on the navel, groin and cleft patches. A membrane obeys the
        # maximum principle (the patch can never move forward faster than its border) while the bare belly grows most at its centre:
        # heavy builds were flattened there by 4 to 7 mm (B7/NOTES.md, round 4). The rest shape keeps the membrane (a thin plate on
        # the positions follows the crater wall into a pit, rounds 2 and 3); skin weights keep it too (fill_rows).
        Ln = (sp.identity(NV, format="csr") - self.Abar).tocsr(); B2t = (Ln.T @ Ln).tocsr(); self.lus_d = dict(self.lus)
        for k_ in P["thinplate_targets"]:
            m = self.regions[k_]; I = np.nonzero(m)[0]
            if len(I): self.lus_d[k_] = (I, spl.splu(B2t[I][:, I].tocsc()), -(B2t[I] @ sp.diags((~m).astype(float))))
        soft = np.zeros(NV)
        for k_ in ("groin", "cleft"): soft = np.maximum(soft, self.falloff(self.regions[k_], 3))
        sx = lambda k: P.get(k + "_" + str(c.sex), P[k])               # round 7: per-sex values ("<name>_f") for the bust
        self.nip_iters, self.nip_taubin, self.chest_rings, self.chest_bell = sx("nip_blend_iters"), sx("nip_taubin"), sx("chest_dome_rings"), sx("chest_dome_bell")
        self.soft_nip = self.falloff(self.regions["nipple"], sx("nip_blend_rings"))
        self.w_navel_t = self.falloff(self.dilate(self.regions["navel"], 1), 3)
        self.soft_groin = self.falloff(self.regions["groin"], 2)
        self.w_mouth = self.falloff(self.regions["mouth"], 0)            # round 4: the bag only (round 3 also pulled the lip rims into the bag: the slit opened, a pale bar)
        # the lip seam: the rims of the bag at the front (upper and lower lip edges), smoothed along themselves only (a 1-D smoothing
        # on the rim's own graph): the line becomes smooth without the lips being drawn apart
        bagv = self.regions["mouth"]; rimv = self.dilate(bagv, 1) & ~bagv & head
        if rimv.any():
            zf = v[rimv, 2].max(); rimv &= (v[:, 2] > zf - 0.012) & (np.abs(y - (ny - 0.03)) < 0.03)
        Rr = np.nonzero(rimv)[0]; Ar = self.A[Rr][:, Rr]; dr = np.asarray(Ar.sum(1)).ravel(); ok = dr >= 1
        self.seam = (Rr[ok], sp.diags(1 / dr[ok]) @ Ar[ok][:, ok] if ok.any() else None)
        # the navel: a quadric fitted to the belly round it (rings 3 to 7), in fixed rest-shape tangent coordinates: linear in the
        # positions, keeps the belly's curve (a membrane was a flat spot with a star of dense vertices), blended in over two rings
        nv = self.regions["navel"]; b2 = self.dilate(nv, 2) & body; ann = self.dilate(nv, 7) & body & ~self.dilate(nv, 2)
        Tn = np.nonzero(b2)[0]; An = np.nonzero(ann)[0]; c0 = v[np.r_[Tn, An]].mean(0); nn = unit(n[np.r_[Tn, An]].mean(0))
        t1 = unit(np.cross([0, 1.0, 0], nn)); t2 = np.cross(nn, t1)
        ph = lambda I_: (lambda u_, w_: np.stack([np.ones(len(I_)), u_, w_, u_ * u_, u_ * w_, w_ * w_], 1))((v[I_] - c0) @ t1, (v[I_] - c0) @ t2)
        self.navel_patch = (Tn, An, ph(Tn) @ np.linalg.pinv(ph(An)), self.falloff(nv, 2)[Tn])
        self.soft_navel = self.falloff(self.dilate(self.regions["navel"], 2), 3)       # heavier bellies carry a wider dimple than the rest shape's
        self.soft_body = soft
        self.w_face = self.falloff(face, 2) * (~self.dilate(lidrim, 0)).astype(float)
        self.w_feat = self.falloff(self.dilate(self.regions["mouth"] | self.regions["nostril"], 2), 2) * (~lidrim).astype(float)
        self.w_ear = self.falloff(ear, 1); self.w_tip = self.falloff(self.masks["fingertip"], 0)
        self.w_nose = self.falloff(self.dilate(self.regions["nostril"], P["nostril_soften_rings"]), 3) * (~self.dilate(lidrim, 1)).astype(float)
        self.last = {}; self.outline = {}; self.v_lin = self.linear(self.v0)
        if P["own_last"]: self._last()
        self._chest()

    def dilate(self, m, k):
        m = m.copy()
        for _ in range(k): m = m | ((self.A @ m.astype(float)) > 0)
        return m

    def falloff(self, m, k):
        """1 inside the mask, falling to 0 over k rings outside it."""
        w = m.astype(float); cur = m.copy()
        for i in range(k):
            nxt = self.dilate(cur, 1); w[nxt & ~cur] = 1 - (i + 1) / (k + 1); cur = nxt
        return w

    def smooth(self, x, w, iters, lam=0.5, mu=-0.53):
        w = w[:, None]
        for _ in range(iters):
            x = x + lam * w * (self.Abar @ x - x)
            if mu: x = x + mu * w * (self.Abar @ x - x)
        return x

    def fill_rows(self, M, regions=("navel", "groin", "cleft", "nipple")):
        """The membrane fills applied to per-vertex data (skin weights, masks): the filled vertices lie on a new surface
        and must move with it. hm08's navel and cleft vertices are weighted unlike the skin round them, so a filled navel
        with its old weights opens again in every pose that bends the spine (seen: E06, E21, the seated sets)."""
        M = sp.lil_matrix(M) if M.ndim == 2 else None
        for k_ in regions:
            if k_ not in self.lus: continue
            I, lu, B = self.lus[k_]; X = lu.solve(np.asarray((B @ M.tocsr()).todense())); X = np.clip(X, 0.0, None); X[X < 1e-6] = 0.0
            X = X / np.maximum(X.sum(1, keepdims=True), 1e-12) if X.shape[1] > 1 else X
            for r_, i in enumerate(I): nz = np.nonzero(X[r_])[0]; M.rows[i] = nz.tolist(); M.data[i] = X[r_, nz].tolist()
        return M.tocsr()

    def linear(self, x, target=False):
        """The linear part A: positions (target False) or shape deltas (target True: thin-plate fills, round 4)."""
        x = np.array(x, dtype=float)
        for k_, (I, lu, B) in (self.lus_d if target else self.lus).items():
            x[I] = lu.solve(B @ x)
        x = self.smooth(x, self.soft_body, 5)                    # doll surfaces: the fill borders blended (Taubin: girths stay)
        x = self.smooth(x, self.soft_groin, 3, 0.5, 0)           # the membrane's upper tip left a 2 mm dimple that read as a navel in raking light: plain membrane steps there
        x = self.smooth(x, self.soft_navel, 4)
        x = self.smooth(x, self.w_mouth, 8, 0.5, 0)              # the collapsed bag's vertices evened
        I_, Ab_ = self.seam
        if Ab_ is not None and len(I_):
            for _ in range(6):                                    # Taubin along the seam: the line evens, it does not shrink
                for lam in (0.5, -0.53): x[I_] = x[I_] + lam * (Ab_ @ x[I_] - x[I_])
        x = self.smooth(x, self.soft_nip, self.nip_iters, 0.5, -0.53 if self.nip_taubin else 0)   # the nipple patch needs membrane steps or its rim shows (costs chest girth: NOTES)
        x = self.smooth(x, self.w_feat, 3, 0.5, 0)               # welded mouth, nostril dimples: blend the fills into the face
        if P["nostril_soften"]: x = self.smooth(x, self.w_nose, P["nostril_soften"])   # round 7: the wing's crease softened (its shadow edge stippled the upper lip, C1 M50)
        x = self.smooth(x, self.w_face, 4)                       # the face one step softer (Taubin: no shrinkage)
        x = self.smooth(x, self.w_ear, 14)                       # ears simplified one step
        x = self.smooth(x, self.w_tip, 8)                        # nails to planes
        if target and P["navel_target_smooth"]: x = self.smooth(x, self.w_navel_t, P["navel_target_smooth"], 0.5, 0)   # round 6
        return x

    # ---- chest girth: the nipples are gone, the tape measure must not notice ------------------------------------------
    def girth(self, v, y, xmax=0.24):
        """Tape measure at height y: hull perimeter of the exact cut of the body's edges with the plane."""
        if not hasattr(self, "_E"):
            q = self.c.quads; self._E = np.unique(np.sort(np.concatenate([q[:, [0, 1]], q[:, [1, 2]], q[:, [2, 3]], q[:, [3, 0]]]), 1), axis=0)
        a, b = v[self._E[:, 0]], v[self._E[:, 1]]; cr = ((a[:, 1] - y) * (b[:, 1] - y) < 0) & (np.abs(a[:, 0]) < xmax)
        t = ((y - a[cr, 1]) / (b[cr, 1] - a[cr, 1]))[:, None]; p = a[cr] + t * (b[cr] - a[cr]); return ConvexHull(p[:, [0, 2]]).area

    def rp_tape(self, v, name, depth=False):
        """RP's own tape (RP/rp.py: fixed points on mesh edges, hull perimeter by Cauchy's formula over 120 directions), on a
        full hm08 array in the package frame: the definition the body's dimensions are stated in."""
        if not hasattr(self, "_rp"):
            sh = self.c.space["shape"]; mk = np.asarray(sh["makehumanVertex"]["index"]); self._rp = {}
            for k_, sl in sh["tape"]["slices"].items(): self._rp[k_] = (mk[np.asarray(sl["a"])], mk[np.asarray(sl["b"])], np.asarray(sl["t"], dtype=float)[:, None])
            ang = np.linspace(0, 2 * math.pi, 121)[:-1]; self._dir = np.stack([np.cos(ang), np.sin(ang)], 1)
        a, b, t = self._rp[name]; q = (v[a] * (1 - t) + v[b] * t)[:, [0, 2]]
        girth = float((q @ self._dir.T).max(0).sum() * (2 * math.pi / len(self._dir)))
        # with depth (round 3: girth + depth of the slice at the navel, so that a dome solved on it split its error between RP's circumference and
        # RP's depth (a navel's rim adds its full height to the depth and little to the tape: neither can be matched alone)
        if not depth: return girth
        # round 4: the depth beside the navel (a caliper bridges it): anterior extreme with the points within navel_excl of the
        # section's mid line left out, posterior extreme unchanged; the same definition as B7/abs_dims.py
        x_, z_ = q[:, 0], q[:, 1]; xm = 0.5 * (x_.max() + x_.min())
        return girth + P["waist_dome_depth_weight"] * float(z_[np.abs(x_ - xm) > P["navel_excl"]].max() - z_.min())

    def _dome(self, key, region, rings, tape, v):
        """A smooth dome over a filled patch, along the surface normal, its height solved so that RP's tape reads what it
        reads on the bare body (rest shape here; per shape target in dome_target)."""
        w = sstep(self.falloff(region, rings)); n = self.smooth(self.n0, self.falloff(region, rings + 1), 8, 0.5, 0)
        if key == "chest" and getattr(self, "chest_bell", 0):   # round 7: lower over each nipple's core, so the bust's apex is round, not a small point
            cen = [self.v0[1778:1794].mean(0), self.v0[8450:8466].mean(0)]; dd = np.minimum(*[np.linalg.norm(self.v0 - c_, axis=1) for c_ in cen])
            w = w * (1 + self.chest_bell * sstep(1 - dd / P["chest_dome_bell_r"]))
        if key == "waist" and P["waist_dome_bell"]:      # round 6: the dome rises a little more over the crater's core, so the filled navel is not a faint dimple on heavy builds
            w = w * (1 + P["waist_dome_bell"] * sstep(1 - np.linalg.norm(self.v0 - self.navel, axis=1) / P["waist_dome_bell_r"]))
        f = w[:, None] * n / np.maximum(np.linalg.norm(n, axis=1), 1e-9)[:, None]; dp = key == "waist"; want = self.rp_tape(self.v0, tape, dp); h = self._solve(v, f, tape, want, depth=dp)
        self.domes[key] = (f, tape, h); return h * f, {"tape": tape, "bare_mm": round(want * 1000, 1), "filled_mm": round(self.rp_tape(v, tape) * 1000, 1), "dome_mm": round(h * 1000, 2), "style_mm": round(self.rp_tape(v + h * f, tape) * 1000, 1)}

    def _solve(self, v, f, tape, want, lo=-0.03, hi=0.05, depth=False):
        for _ in range(26):
            mid = 0.5 * (lo + hi)
            if self.rp_tape(v + mid * f, tape, depth) < want: lo = mid
            else: hi = mid
        return 0.5 * (lo + hi)

    def _chest(self):
        self.domes = {}; v = self.v_lin
        d1, i1 = self._dome("chest", self.regions["nipple"], self.chest_rings, "chest", v); d2, i2 = self._dome("waist", self.regions["navel"], P["waist_dome_rings"], "waist", v + d1)
        self.chest = d1 + d2; self.chest_h = 1.0; self.chest_info = {"chest": i1, "waist": i2}

    def chest_target(self, d_bare, d_lin):
        """The domes' change under a shape target, so that chest and waist tapes follow the bare body's over the shape range.
        Round 4: a central secant over +-dome_secant units of the target (round 3 took the change at +1 unit, which drifted at
        the far ends of the controls, where the component weights reach 3 to 5)."""
        K = P["dome_secant"]; out = np.zeros_like(d_lin); prev = {1: np.zeros_like(d_lin), -1: np.zeros_like(d_lin)}
        for key in ("chest", "waist"):
            f, tape, h0 = self.domes[key]; dp = key == "waist"; hs = {}
            for sg in (1, -1):
                vv = self.v_lin + sg * K * d_lin + prev[sg]
                hs[sg] = self._solve(vv, f, tape, self.rp_tape(self.v0 + sg * K * d_bare, tape, dp), depth=dp); prev[sg] = prev[sg] + hs[sg] * f
            out = out + (hs[1] - hs[-1]) / (2 * K) * f
        return out

    def _chest_round2(self):
        """After the fill the chest is a little flatter where the nipples were. A smooth dome along the surface normal
        (base only) gives the girth at nipple height back: its height is solved so that the tape reads what it read bare."""
        v0, v = self.v0, self.v_lin; y = float(v0[1778:1794, 1].mean()); want = self.girth(v0, y)
        w = sstep(self.falloff(self.regions["nipple"], 8)); n = self.smooth(self.n0, self.falloff(self.regions["nipple"], 9), 8, 0.5, 0)      # broad: a fuller dome, not a point
        n = n / np.maximum(np.linalg.norm(n, axis=1), 1e-9)[:, None]; field = w[:, None] * n
        lo, hi = 0.0, 0.02
        for _ in range(24):
            mid = 0.5 * (lo + hi)
            if self.girth(v + mid * field, y) < want: lo = mid
            else: hi = mid
        self.chest_h = 0.5 * (lo + hi); self.chest = self.chest_h * field
        self.chest_info = {"height_y": round(y, 4), "girth_bare_mm": round(want * 1000, 1), "girth_filled_mm": round(self.girth(v, y) * 1000, 1), "dome_mm": round(self.chest_h * 1000, 2),
                           "girth_style_mm": round(self.girth(v + self.chest, y) * 1000, 1)}

    def chest_target_round2(self, d_bare, d_lin):
        """Round 2's version (hull of the plane cut instead of RP's tape); not used."""
        y = float((self.v0 + d_bare)[1778:1794, 1].mean()); want = self.girth(self.v0 + d_bare, y); vv = self.v_lin + d_lin; f = self.chest / max(self.chest_h, 1e-9)
        lo, hi = -0.01, 0.03
        for _ in range(22):
            mid = 0.5 * (lo + hi)
            if self.girth(vv + mid * f, y) < want: lo = mid
            else: hi = mid
        return (0.5 * (lo + hi) - self.chest_h) * f

    # ---- the shoe last: toes replaced by a toe box, flat sole plane -------------------------------------------------
    def _last(self):
        c = self.c; v = self.v_lin; body = self.body; self.last = {}
        for s, sg in (("L", 1), ("R", -1)):
            fj = self.J[self.BI["foot." + s]]
            foot = body & (v[:, 0] * sg > 0) & (v[:, 1] < fj[1] + 0.015)
            zc = self.J[self.BI["toe1-1." + s]][2] - 0.044                                    # cut behind the ball of the foot
            patch = foot & (v[:, 2] > zc) & (v[:, 1] < 0.075)
            ring = self.dilate(patch, 1) & ~patch
            I = np.nonzero(patch)[0]; Rg = np.nonzero(ring)[0]
            c0 = np.array([v[Rg, 0].mean(), 0.5 * v[Rg, 1].max(), zc - 0.004])
            # hull of the forefoot with a toe allowance and a small margin that fades out towards the cut
            pts = v[np.r_[I, Rg]]; f = sstep((pts[:, 2] - zc - 0.008) / 0.04)[:, None]
            m = P["last_margin"]; aug = [pts]
            for o in ((m, 0, 0), (-m, 0, 0), (0, 0.6 * m, 0), (0, 0, m), (0, 0, P["toe_allowance"])): aug.append(pts + f * np.array(o))
            aug = np.concatenate(aug); aug[:, 1] = np.maximum(aug[:, 1], 0.0)
            hull = ConvexHull(aug); eq = hull.equations                                   # n.x + b <= 0 inside
            def stereo(p):
                d = p - c0; d /= np.linalg.norm(d, axis=1)[:, None]
                return d[:, :2] / (1 + d[:, 2:3])
            uvr = stereo(v[Rg]); loc = {g: i for i, g in enumerate(I)}
            Aii = (sp.diags(self.deg[I]) - self.A[I][:, I]).tocsc(); B = self.A[I][:, Rg]
            uvi = spl.splu(Aii).solve(B @ uvr)
            d = np.stack([2 * uvi[:, 0], 2 * uvi[:, 1], 1 - (uvi ** 2).sum(1)], 1) / (1 + (uvi ** 2).sum(1))[:, None]
            num = -(eq[:, :3] @ c0 + eq[:, 3])
            def hull_t(d):
                den = d @ eq[:, :3].T
                return np.where(den > 1e-9, num[None] / np.where(den > 1e-9, den, 1), np.inf).min(1)
            xx = v.copy(); xx[I] = c0 + d * hull_t(d)[:, None]
            for _ in range(25):                                   # relax on the hull: even quads, no folds
                pnew = xx[I] + 0.5 * ((self.Abar @ xx)[I] - xx[I]); dd = pnew - c0; dd /= np.linalg.norm(dd, axis=1)[:, None]
                xx[I] = c0 + dd * hull_t(dd)[:, None]
            dd = xx[I] - c0; dd /= np.linalg.norm(dd, axis=1)[:, None]; tt = np.linalg.norm(xx - c0, axis=1)
            for _ in range(8): tt[I] = 0.5 * tt[I] + 0.5 * (self.Abar @ tt)[I]      # the hull is a tent over the toes: round it to a toe box
            newp = c0 + dd * tt[I][:, None]
            # the rounding shrinks the box: give it back the hull's length and breadth
            wz = sstep((newp[:, 2] - zc) / 0.03); kz = (aug[:, 2].max() - c0[2]) / (newp[:, 2].max() - c0[2])
            cx = 0.5 * (aug[:, 0].min() + aug[:, 0].max()); kx = (aug[:, 0].max() - aug[:, 0].min()) / (newp[:, 0].max() - newp[:, 0].min())
            newp[:, 2] = c0[2] + (newp[:, 2] - c0[2]) * (1 + (kz - 1) * wz); newp[:, 0] = cx + (newp[:, 0] - cx) * (1 + (kx - 1) * wz)
            newp[:, 1] = np.maximum(newp[:, 1], 0.0); newp[newp[:, 1] < 0.002, 1] = 0.0
            # rear foot: flat sole plane (the arch is filled, as on a last)
            under = foot & ~patch & (v[:, 1] < 0.03) & (self.n0[:, 1] < -0.35)
            self.last[s] = dict(I=I, ring=Rg, newp=newp, under=np.nonzero(under)[0], foot=foot, zc=zc, c0=c0)

    def base(self):
        v = self.v_lin + self.chest
        for s, L in self.last.items():
            v[L["I"]] = L["newp"]; v[L["under"], 1] = 0.0
        # blend the cut: a few membrane steps on the two rings either side of it
        m = np.zeros(self.NV, bool)
        for L in self.last.values(): m[L["ring"]] = True
        w = self.falloff(m, 2); keep_y0 = v[:, 1] <= 1e-9
        pm = np.zeros(self.NV, bool)
        for L in self.last.values(): pm[L["I"]] = True
        v2 = self.smooth(v, w, 4, 0.5, 0)
        v2[:, 1] = np.where(pm | m, np.maximum(v2[:, 1], 0.0), v2[:, 1]); v2[keep_y0 | (pm & (v2[:, 1] < 0.0025)), 1] = 0.0
        # the upper comes down to the sole edge: lower wall pushed out to the outline, minus the welt ledge
        self.outline = {}
        for s_, L in self.last.items():
            low = np.nonzero(L["foot"] & (v2[:, 1] < 0.05))[0]; pts = v2[low][:, [0, 2]]
            hp = pts[v2[low, 1] < 0.03]; hp = hp[ConvexHull(hp).vertices]; ang = np.linspace(0, 2 * math.pi, 64, endpoint=False)
            big = (hp[:, None, :] + (np.stack([np.cos(ang), np.sin(ang)], 1) * P["sole_ledge"])[None]).reshape(-1, 2); hq = ConvexHull(big)
            self.outline[s_] = big[hq.vertices]
            eq = hq.equations; din = -(pts @ eq[:, :2].T + eq[:, 2]); e = din.argmin(1); dmin = din[np.arange(len(low)), e]
            wy = sstep((0.05 - v2[low, 1]) / 0.03); g = sstep((0.026 - dmin) / 0.014)
            push = np.maximum(dmin - P["sole_ledge"], 0) * wy * g
            v2[low, 0] += eq[e, 0] * push; v2[low, 2] += eq[e, 1] * push
            # where the toe box, the filled arch and the pushed wall meet: a few membrane steps, sole kept plane
            mm = np.zeros(self.NV, bool); mm[low] = True; mm &= (np.abs(v2[:, 2] - L["zc"]) < 0.04) & (v2[:, 1] < 0.03)
            on0 = v2[:, 1] <= 1e-9; v3 = self.smooth(v2, self.falloff(mm, 1), 6, 0.5, 0); v3[on0, 1] = 0.0; v3[:, 1] = np.where(L["foot"], np.maximum(v3[:, 1], 0.0), v3[:, 1]); v2 = v3
        # round 4: the collapsed bag set back behind the seam (base only; the bag is hidden behind the welded lips by construction)
        bagw = self.falloff(self.regions["mouth"], 0) * sstep((v2[:, 2] - (v2[self.regions["mouth"], 2].max() - 0.012)) / 0.006) if self.regions["mouth"].any() else 0
        v2[:, 2] = v2[:, 2] - P["mouth_recess"] * bagw
        # round 4: the lower lip's rim is tucked under the upper lip's edge (up by lip_tuck_up above it, back by lip_tuck_back behind it),
        # tapering to nothing at the corners and over two rings of the lower lip, so the lips meet in one line and no slit shows
        I_ = self.seam[0]
        if len(I_) > 6:
            p = v2[I_]; ym = np.array([p[np.abs(p[:, 0] - xi) < 0.003, 1].mean() for xi in p[:, 0]]); upm = p[:, 1] > ym
            U, Lo = I_[upm], I_[~upm]; o = np.argsort(v2[U, 0]); xu, yu, zu = v2[U[o], 0], v2[U[o], 1], v2[U[o], 2]
            xl = v2[Lo, 0]; wc = sstep((np.abs(xu).max() - np.abs(xl)) / 0.006)
            dy = np.maximum(np.interp(xl, xu, yu) + P["lip_tuck_up"] - v2[Lo, 1], 0) * wc; dz = np.minimum(np.interp(xl, xu, zu) - P["lip_tuck_back"] - v2[Lo, 2], 0) * wc
            low = np.zeros(self.NV, bool); low[Lo] = True; ring = self.dilate(low, 2) & self.head & ~self.regions["mouth"]; ring[U] = False
            ring &= v2[:, 1] < np.interp(v2[:, 0], xu, yu) - 1e-4; ring[Lo] = True; J_ = np.nonzero(ring)[0]
            w_ = self.falloff(low, 2)[J_]; near = cKDTree(v2[Lo]).query(v2[J_])[1]
            v2[J_, 1] += dy[near] * w_; v2[J_, 2] += dz[near] * w_
        # mouth corners level (MakeHuman's own authored target)
        try:
            d = mh.target_dense("mouth-angles-up"); v2 = v2 + P["mouth_corner_lift"] * self.linear(d)
        except Exception as e: print("  no mouth-angles-up target:", e)
        return v2

    def delta(self, d):
        """A shape target for the style: the linear part, and on the toe box an affine fit (length and breadth follow,
        toe-by-toe detail does not), sole kept plane."""
        x = self.linear(d, target=True); x = x + self.chest_target(d, x)
        for s, L in self.last.items():
            I = L["I"]; p = self.v_lin[I]; Xh = np.c_[p, np.ones(len(I))]
            M, *_ = np.linalg.lstsq(Xh, x[I], rcond=None)
            x[I] = Xh @ M
        return x


def subdivide_part(c, mask_v):
    """One Catmull-Clark level on the quads that touch mask_v; the rest stays as it is; the quads in between are
    triangulated as fans over their face point and the split edges' points, so there is no T-junction and no crack
    under skinning. Returns S (rows: all Catmull-Clark points; untouched vertices keep their place), tris, uv matrix, tri_uv."""
    NV = len(c.base_v); q = c.quads; nf = len(q)
    S, q2, Suv, quv2 = mh.subdivide(NV, q, c.quad_uv, len(c.base.uv))
    q2 = q2.reshape(nf, 4, 4); quv2 = quv2.reshape(nf, 4, 4)                 # per face, per corner k: [v_k, e(k), face, e(k-1)]
    R = mask_v[q].any(1); ep = q2[:, :, 1]
    split = np.zeros(S.shape[0], bool); split[ep[R].ravel()] = True; es = split[ep]
    trans = ~R & es.any(1); plain = ~R & ~es.any(1)
    t1, u1 = mh.triangulate(q2[R].reshape(-1, 4), quv2[R].reshape(-1, 4)); t2, u2 = mh.triangulate(q[plain], c.quad_uv[plain])
    t3 = []; u3 = []
    for f in np.nonzero(trans)[0]:
        cen = q2[f, 0, 2]; cu = quv2[f, 0, 2]
        for k in range(4):
            k1 = (k + 1) % 4; a, au, b, bu = q2[f, k, 0], quv2[f, k, 0], q2[f, k1, 0], quv2[f, k1, 0]
            if es[f, k]: m, mu = q2[f, k, 1], quv2[f, k, 1]; t3 += [[cen, a, m], [cen, m, b]]; u3 += [[cu, au, mu], [cu, mu, bu]]
            else: t3.append([cen, a, b]); u3.append([cu, au, bu])
    inR = np.zeros(NV, bool); inR[q[R].ravel()] = True
    top = sp.diags(inR.astype(float)) @ S[:NV] + sp.diags((~inR).astype(float)) @ sp.identity(NV, format="csr")
    S2 = sp.vstack([top, S[NV:]]).tocsr()
    tris = np.concatenate([t1, t2, np.array(t3, dtype=t1.dtype).reshape(-1, 3)]); tuv = np.concatenate([u1, u2, np.array(u3, dtype=u1.dtype).reshape(-1, 3)])
    return S2, tris, Suv, tuv, dict(quads_subdivided=int(R.sum()), quads_transition=int(trans.sum()), quads_plain=int(plain.sum()))


def sphere_fit(p):
    A = np.c_[2 * p, np.ones(len(p))]; x, *_ = np.linalg.lstsq(A, (p ** 2).sum(1), rcond=None); cen = x[:3]
    return cen, float(np.sqrt(x[3] + cen @ cen))


def eyeball(centre, side, radius):
    """Front part of a sphere, pole towards +z, fine rings over the iris. Returns v, tris, radial dirs, polar angle."""
    th_i = math.asin(P["iris_radius"] / radius)
    th = np.linspace(0, math.radians(112), P["eye_rings"])                    # round 4: even rings (the iris rings went with the iris)
    seg = P["eye_segments"]; ph = np.arange(seg) * 2 * math.pi / seg
    dirs = [np.array([0, 0, 1.0])]
    for t in th[1:]: dirs += [np.array([math.sin(t) * math.cos(p), math.sin(t) * math.sin(p), math.cos(t)]) for p in ph]
    dirs = np.array(dirs); ang = np.r_[0, np.repeat(th[1:], seg)]
    tris = [[0, 1 + k, 1 + (k + 1) % seg] for k in range(seg)]
    for r in range(len(th) - 2):
        a = 1 + r * seg; b = a + seg
        for k in range(seg):
            k2 = (k + 1) % seg; tris += [[a + k, b + k, b + k2], [a + k, b + k2, a + k2]]
    return centre + radius * dirs, np.array(tris), dirs, ang


def iris_morph(dirs, ang, radius):
    """Incised iris: a shallow dish with a cut ring at its edge and a pupil dimple (a carved portrait bust's eye)."""
    r = radius * np.sin(ang); ri = P["iris_radius"]; rp = P["pupil_radius"]
    dish = P["iris_dish"] * sstep((ri - r) / 0.0007)
    ring = P["iris_groove"] * np.exp(-((r - ri) / 0.00038) ** 2)
    pupil = P["pupil_depth"] * sstep((rp - r) / 0.0012)
    depth = np.where(ang < math.radians(60), dish + ring + pupil, 0.0)
    return -dirs * depth[:, None]


def sole(poly, h, n=96, rand=0.0):
    """A slab under the last: plan outline = the style's sole outline (convex hull of the lower foot, set out by the ledge)."""
    # resample the closed outline evenly
    cl = np.r_[poly, poly[:1]]; seg = np.linalg.norm(np.diff(cl, axis=0), axis=1); s = np.r_[0, np.cumsum(seg)]
    u = np.linspace(0, s[-1], n, endpoint=False); o = np.stack([np.interp(u, s, cl[:, 0]), np.interp(u, s, cl[:, 1])], 1)
    cen = o.mean(0); bev = 0.0015
    def loop(y, inset=0.0):
        q = o + (cen - o) / np.linalg.norm(cen - o, axis=1)[:, None] * inset
        return np.stack([q[:, 0], np.full(n, y), q[:, 1]], 1)
    # groups with their own vertices so that the edges stay crisp: top, bevel, wall, bevel, bottom
    V = []; T = []
    def add_ring_pair(a, b):
        i0 = sum(len(x) for x in V); V.extend([a, b])
        for k in range(n):
            k2 = (k + 1) % n; T.extend([[i0 + k, i0 + n + k, i0 + n + k2], [i0 + k, i0 + n + k2, i0 + k2]])
    def add_cap(a, up):
        i0 = sum(len(x) for x in V); V.extend([a, np.array([[cen[0], a[0, 1], cen[1]]])])
        for k in range(n):
            k2 = (k + 1) % n; T.append([i0 + n, i0 + k2, i0 + k] if up else [i0 + n, i0 + k, i0 + k2])
    H = h + rand
    add_cap(loop(H, bev), True); add_ring_pair(loop(H, bev), loop(H - bev)); add_ring_pair(loop(H - bev), loop(bev))
    add_ring_pair(loop(bev), loop(0, bev)); add_cap(loop(0, bev), False)
    V = np.concatenate(V); T = np.array(T)
    # orientation: make the triangles face outwards (check with the wall)
    a, b, c_ = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]; nrm = np.cross(b - a, c_ - a); cc = (a + b + c_) / 3 - np.array([cen[0], H / 2, cen[1]])
    flip = (nrm * cc).sum(1) < 0; T[flip] = T[flip][:, ::-1]
    return V, T


def lid_rotations(e, frac):
    """B5's lid joints, upper lids turned by `frac` of their full closing angle (dual-quaternion blend, as the viewer skins
    them): per side (vertex indices, rotation matrices about the hinge through the eye centre, centre). A rotation about
    the eye centre keeps every lid point at its distance from the ball."""
    import eyes
    out = []
    for sd in ("l", "r"):
        L = e.lids[sd]; m = np.nonzero(L.wu > 0)[0]; t = frac * L.theta_u; w = L.wu[m]
        ang = 2 * np.arctan2(w * math.sin(t / 2), 1 - w + w * math.cos(t / 2)); out.append((m, eyes._rot_about(L.a, ang), np.asarray(L.C), math.degrees(t)))
    return out


def lid_lip(st, e, v):
    """The lids meet the ball over a small rounded lip: within `lid_lip` of arc from each margin the lid's distance from the
    ball tapers to the clearance, so there is no shelf to catch the light and no gap (base only; targets keep it, below)."""
    q = st.c.quads; E = np.concatenate([q[:, [0, 1]], q[:, [1, 2]], q[:, [2, 3]], q[:, [3, 0]]]); le = np.linalg.norm(v[E[:, 0]] - v[E[:, 1]], axis=1)
    Lmax = np.zeros(len(v)); np.maximum.at(Lmax, E[:, 0], le); np.maximum.at(Lmax, E[:, 1], le)
    for sd in ("l", "r"):
        L = e.lids[sd]; C = np.asarray(L.C); R = st.eye_r; p = v - C; r = np.linalg.norm(p, axis=1)
        arc = R * np.minimum(np.abs(L.psi - L.pu), np.abs(L.psi - L.pl)); between = (L.psi < L.pu) & (L.psi > L.pl)
        # round 5 (B5's longer inner corners, eyes/l-eye-push2-out): lid skin near the ball is first held off it by the sag of
        # its longest edge after subdivision (L^2 / (4 R), at least lid_standoff), so the subdivided lid cannot dip into the
        # ball below the margin (a V-shaped notch under the man's lower lids, packet-final C3); then the margin is tapered in
        smin, smax = min(L.s[L.med], L.s[L.lat]), max(L.s[L.med], L.s[L.lat])
        so = np.maximum(P["lid_standoff"], Lmax ** 2 / (4 * R)) * sstep(np.minimum(L.s - smin, smax - L.s) / P["lid_standoff_corner"])   # round 6: none at the corners
        ms = st.body & ~between & (r > R - 0.0002) & (r < R + so) & (L.s > min(L.s[L.med], L.s[L.lat]) - 0.003) & (L.s < max(L.s[L.med], L.s[L.lat]) + 0.003)
        v[ms] = C + p[ms] * ((R + so[ms]) / r[ms])[:, None]; p = v - C; r = np.linalg.norm(p, axis=1)
        m = st.body & (r > R - 0.0002) & (r < R + 0.008) & (L.s > min(L.s[L.med], L.s[L.lat]) - 0.003) & (L.s < max(L.s[L.med], L.s[L.lat]) + 0.003) & (arc < P["lid_lip"]) & ~between
        m |= st.body & between & (r < R + 0.004) & (r > R - 0.0002)                    # anything of the lid inside the opening sits on the ball
        k = np.where(between, 0.0, sstep(arc / P["lid_lip"])); rn = R + P["lid_clear"] + np.maximum(r - R - P["lid_clear"], 0) * k
        v[m] = C + p[m] * (np.minimum(r, rn)[m] / r[m])[:, None]
    return v


def styled_target(st, e, lids, t, d):
    """A shape target for the style. Lid vertices: the lid turns about the eye centre, which moves with the eye joint, so
    delta' = dC + R (delta - dC); and the part of (delta - dC) along the ray from the eye centre is taken out in proportion to
    the lid weight, so the lids stay on the ball (which never scales) at every head size."""
    x = st.delta(d); names = list(e.skeleton.names)
    for (m_, R_, C_, deg), sd in zip(lids, ("l", "r")):
        dC = np.asarray(e.joint_targets[t][names.index("eye_" + sd)]); x[m_] = dC + np.einsum("nij,nj->ni", R_, x[m_] - dC)
        L = e.lids[sd]; r0 = np.linalg.norm(st.v_style - C_, axis=1)
        w = np.maximum(np.clip(np.maximum(L.wu, L.wl), 0, 1), np.where(st.head, sstep((st.eye_r + 0.008 - r0) / 0.0055), 0.0)); I = np.nonzero(w > 0)[0]   # corners too: they carry no lid weight
        rh = st.v_style[I] - C_; rh /= np.linalg.norm(rh, axis=1)[:, None]; rel = x[I] - dC
        x[I] = dC + rel - (w[I] * (rel * rh).sum(1))[:, None] * rh
    return x


def last_cut(sex):
    """Height above the bare sole (rest shape) under which the body's triangles are left out: below the floor of the last's
    funnel by `leg_below_floor` and at least `leg_below_lip` under the lip (B6's `last.meta.npz: collar_height`)."""
    import props
    src = np.load(os.path.join(props.SRC, "operator-" + sex, "last.npz")); meta = np.load(os.path.join(props.SRC, "operator-" + sex, "last.meta.npz"))
    V, T = src["v"], src["tris"]; key = np.round(V / 1e-6).astype(np.int64); _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    Tw = inv.ravel()[T]; n = len(first); Adj = sp.coo_matrix((np.ones(Tw.size), (Tw.ravel(), np.roll(Tw, 1, 1).ravel())), shape=(n, n))
    from scipy.sparse.csgraph import connected_components
    _, lab = connected_components(Adj, directed=False); Vw = V[first]; floor = np.inf
    for cmp in np.unique(lab):
        tt = Tw[lab[Tw[:, 0]] == cmp]; e = np.sort(np.concatenate([tt[:, [0, 1]], tt[:, [1, 2]], tt[:, [2, 0]]]), 1); u, cnt = np.unique(e, axis=0, return_counts=True)
        b = u[cnt == 1]
        if len(b) and Vw[b.ravel(), 1].min() > 0.05: floor = min(floor, float(Vw[np.unique(tt), 1].min()))      # the funnel: open, its only edge up at the lip
    lip = float(meta["collar_height"]); cut = min(lip - P["leg_below_lip"], floor - P["leg_below_floor"])
    return cut, {"lip_mm": round(lip * 1000, 1), "funnel_floor_lowest_mm": round(floor * 1000, 1) if np.isfinite(floor) else None, "leg_cut_mm": round(cut * 1000, 1), "leg_cut_below_lip_mm": round((lip - cut) * 1000, 1)}


def relaxed_hands(poses):
    """RR's relaxed hand in every pose that says nothing about the fingers (the range-of-motion and envelope poses)."""
    A = next(p for p in poses if p.get("id") == "A_POSE")["dofs"]; fing = {k: v for k, v in A.items() if k.split("_")[0] in ("thumb", "index", "middle", "ring", "pinky")}
    n = 0
    for p in poses:
        d = p.get("dofs")
        if d is None or str(p.get("id", "")).startswith("HAND_"): continue
        for sd in ("_l.", "_r."):
            if not any(k in d for k in fing if sd in k):
                d.update({k: v for k, v in fing.items() if sd in k}); n += 1
    return n, len(fing)


def build(sex="m", out=None, subdiv=True, preview=False):
    import copy, eyes, props
    name = NAMES[sex] if not preview else "abs-preview"
    out = out or os.path.join(LAB, "packages", name); os.makedirs(out, exist_ok=True)
    c = bb.context(sex); e = eyes.eye_context(c); src_name = bb.NAMES[sex]; src_dir = os.path.join(LAB, "packages", src_name)
    # the body with B5's lids (re-seated on the ball, lid joints) is the style's source: same vertex order as the bare body
    c2 = copy.copy(c); c2.base_v = e.base_v; c2.targets = e.targets
    st = Style(c2, eye=e.eye); NV = st.NV; body = st.body; names = list(e.skeleton.names); nb = len(names)
    try: h = float(json.load(open(os.path.join(LAB, "packages", "operator-" + sex, "operator-%s.avatar.json" % sex)))["rest"]["soleHeight"]); src = "packages/operator-%s rest.soleHeight" % sex
    except Exception: h = float(np.load(os.path.join(props.SRC, "operator-" + sex, "shoes.meta.npz"))["sole_height"]); src = "B6's shoe (the dressed package reports none)"
    print("sole height %.1f mm (%s)" % (h * 1000, src)); print("  chest:", st.chest_info)
    lift = np.array([0.0, h, 0.0])
    v = st.base(); lids = lid_rotations(e, P["lid_lower"])
    for m_, R_, C_, deg in lids: v[m_] = C_ + np.einsum("nij,nj->ni", R_, v[m_] - C_)
    v = lid_lip(st, e, v); st.v_style = v
    targets = {} if preview else {t: styled_target(st, e, lids, t, d) for t, d in e.targets.items()}
    moved = np.linalg.norm(v - c.base_v, axis=1)[body]
    print("style offset on the body: max %.1f mm, vertices moved > 0.5 mm: %d of %d; upper lids lowered %.1f deg" % (moved.max() * 1000, int((moved > 5e-4).sum()), int(body.sum()), lids[0][3]))
    # ---- weights on the skeleton with the lid joints: the 4-set (B5's) and the body's 8-set, lid vertices as B5 has them
    W4 = sp.csr_matrix(e.W); dqs = np.asarray(e.dqs, dtype=np.float64)
    W8 = sp.csr_matrix((np.asarray(c.W8, dtype=np.float64).ravel(), (np.repeat(np.arange(NV), 8), np.asarray(c.J8).ravel())), shape=(NV, nb)).tolil()
    lidv = np.unique(np.concatenate([np.nonzero((e.lids[sd].wu > 0) | (e.lids[sd].wl > 0))[0] for sd in ("l", "r")]))
    W8 = W8.tocsr(); keep = np.ones(NV); keep[lidv] = 0; W8 = (sp.diags(keep) @ W8 + sp.diags(1 - keep) @ W4).tocsr()
    # the filled patches take the weights of the skin round them (4-set and 8-set alike); the dual-quaternion mask too
    W4 = st.fill_rows(W4); W8 = st.fill_rows(W8); dqs = np.asarray(st.fill_rows(sp.csr_matrix(dqs[:, None])).todense()).ravel()
    # ---- body mesh: one Catmull-Clark level on head and hands, fanned ring between
    uv = c.base.uv; sub_info = None; r = c.rig
    hand = body & np.isin(st.dom, [i for i, b in enumerate(r.bones) if b.startswith(("wrist", "finger", "metacarpal"))])
    if subdiv:
        fine = body.copy() if P["subdivide_body"] else st.dilate(st.head | hand, 1) & body
        S, tris, Suv, tri_uv, sub_info = subdivide_part(c, fine); uv = Suv @ c.base.uv
    else: S = sp.identity(NV, format="csr"); tris, tri_uv = c.tris, c.tri_uv
    if subdiv and P["subdivide_body"] and P["subdiv_comp"]:
        # round 4: a linear step (it commutes with the shape targets) that gives back what the subdivision takes off the visible
        # surface; weights, the _DQS mask and the measurements on the hm08 array are not touched (B7/abs_subdiv_girth.py)
        SV = S[:NV]; keep_off = st.head | hand | (st.dilate(st.regions["navel"], 2) if P["comp_off_navel"] else np.zeros(NV, bool))
        wk = P["subdiv_comp"] * (1 - st.falloff(keep_off, 2)) * body   # round 6: optionally not on the navel patch
        comp = lambda x: x + wk[:, None] * (x - SV @ x)
    else: comp = lambda x: x
    vb = S @ comp(v) + lift; tb = {t: S @ comp(d) for t, d in targets.items()}; Wb = (S @ W4).tocsr(); dq = S @ dqs
    J8, W8p = bb.eight((S @ W8).tocsr())
    # the foot is inside the last: leave out the triangles under its collar. Round 4 (B6's mid-cut last): the leg runs on down
    # inside the collar and is cut below the funnel's floor (so its open edge lies in the shoe's solid, never in the hollow a
    # look into the collar could reach) and at least `leg_below_lip` under the lip (B6: "no higher than 20 mm below the lip")
    collar, cut_info = last_cut(sex)
    under = (vb[tris, 1] - h).max(1) < collar; tris, tri_uv = tris[~under], tri_uv[~under]
    # regions, for the triangle count
    reg_v = np.zeros(S.shape[0], int); Sb = S.tocsr()
    for code, m_ in ((1, st.head), (2, hand)):
        reg_v[np.asarray((Sb @ m_.astype(float))).ravel() > 0.5] = code
    reg_t = np.where((reg_v[tris] == 1).sum(1) >= 2, "head", np.where((reg_v[tris] == 2).sum(1) >= 2, "hands", "rest of the body"))
    regions = {k: int((reg_t == k).sum()) for k in ("head", "hands", "rest of the body")}
    used = np.unique(tris); srcidx = np.full(S.shape[0], 0.0); srcidx[used] = np.arange(len(used))
    mat = "clay_figure"
    pcs = {n: S @ d for n, d in c.correctives.items()} if not preview else {}
    A_ = {**(bb.skin_attrs(dq, J8, W8p) or {}), "_SRC": srcidx.astype(np.float32)}
    meshes = [glb.Mesh("body", vb, tris, mat, uv=uv, tri_uv=tri_uv, weights=Wb, morphs=pcs, attrs=A_)]
    bake_base = [vb[used]]; bake_t = {t: [d[used]] for t, d in tb.items()}; nrow = len(used)
    # ---- eyeballs: sculpted, same material, rigid on the eye joints, looking slightly down and converged; `abs_iris` cuts the iris
    er = st.eye_r
    for s_ in ("l", "r"):
        j = names.index("eye_" + s_); ev0, et, dirs, ang = eyeball(np.zeros(3), s_, er)
        a, b = math.radians(P["gaze_down_deg"]), math.radians(P["gaze_in_deg"] * (-1 if s_ == "l" else 1))
        Rg = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]]) @ np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
        dirs = dirs @ Rg.T; ev = st.eye[s_.upper()] + er * dirs + lift
        Wm = sp.csr_matrix((np.ones(len(ev)), (np.arange(len(ev)), np.full(len(ev), j))), shape=(len(ev), nb))
        im = iris_morph(dirs, ang, er)
        if preview == "iris": ev = ev + im
        meshes.append(glb.Mesh("eyeball_" + s_, ev, et, mat, uv=None, tri_uv=None, weights=Wm, morphs={},
                               attrs={"_DQS": np.zeros(len(ev), np.float32), "_SRC": (nrow + np.arange(len(ev))).astype(np.float32)}))
        bake_base.append(ev)
        for t in bake_t: bake_t[t].append(np.repeat(np.asarray(e.joint_targets[t][j])[None], len(ev), 0))      # the eye never scales (B5): it moves with its joint
        nrow += len(ev)
    # ---- the shod foot: B6's last, sized on this body, same material; it follows the foot per shape target (GPU morphs: its
    # hard sole edge would be lost in the CPU bake, which recomputes smooth normals)
    ref = bb.body_mesh(c, morphs=dict(c.targets)); ref.v = np.asarray(ref.v) + lift
    extra, pmats, pinfo = props.build([ref], names, which=("last",), lift=h, pkg="operator-" + sex, body=ref)
    last = extra[0]; last.material = mat; meshes.append(last)
    if abs(pinfo["soleHeight_m"] - h) > 1e-6: print("  WARNING: the last's sole (%.1f mm) is not the dressed style's (%.1f mm)" % (pinfo["soleHeight_m"] * 1000, h * 1000))
    al = list(P["albedo"])
    mats = {mat: {"pbrMetallicRoughness": {"baseColorFactor": al + [1.0], "metallicFactor": 0.0, "roughnessFactor": P["roughness"]}}}
    k0 = e.skeleton; skel = glb.Skeleton(list(k0.names), np.asarray(k0.parent).copy(), np.asarray(k0.head) + lift, k0.rot)
    gp = os.path.join(out, name + ".glb")
    stats = glb.write_glb(gp, meshes, skel, mats, generator="synergon avatar-lab pipeline/abstract.py (MPFB2 2.0.18 data, CC0)")
    problems = glb.validate(gp)
    print(name, json.dumps(stats)); print("  validate:", problems or "clean")
    # ---- manifest: the shared body package's own, with the style's additions (same shape model, rig, poses, packet, motion)
    man = json.load(open(os.path.join(src_dir, src_name + ".avatar.json"))); sh = man["shape"]; model = sh["model"]
    poses = json.load(open(os.path.join(src_dir, "poses.json"))); nh, nf = relaxed_hands(poses); json.dump(poses, open(os.path.join(out, "poses.json"), "w"), indent=1)
    if not preview:
        block, qerr = bb.write_shape_bin(os.path.join(out, name + ".shape.bin"), np.concatenate(bake_base), {t: np.concatenate(x) for t, x in bake_t.items()})
        block["meshes"] = ["body", "eyeball_l", "eyeball_r"]; sh["bake"] = block
    else: sh.pop("bake", None)
    r5 = lambda a: [round(float(x), 5) for x in a]
    sh["jointDeltas"] = {t: {names[i]: r5(d[i]) for i in range(nb) if np.abs(d[i]).max() > 5e-6} for t, d in e.joint_targets.items()}
    def relink(o):                                                         # the body's clips stay where they are
        if isinstance(o, dict): return {k: relink(x) for k, x in o.items()}
        if isinstance(o, list): return [relink(x) for x in o]
        return "../%s/%s" % (src_name, o) if isinstance(o, str) and o.startswith("clips/") else o
    man["clips"] = relink(man.get("clips", []))
    if "motion" in man: man["motion"] = relink(man["motion"])
    TINTS = {"F05": [0.36, 0.31, 0.27], "M50": al, "M95H": [0.27, 0.31, 0.35], "M50_THIN": [0.35, 0.34, 0.26], "M50_MID": al, "M50_HEAVY": [0.28, 0.33, 0.31],
             "F50_THIN": [0.35, 0.34, 0.26], "F50_MID": al, "F50_HEAVY": [0.28, 0.33, 0.31], "F05_LONGARM": [0.35, 0.29, 0.31]}
    tri_total = int(sum(m["triangles"] for m in stats["meshes"])); bytri = {m["name"]: m["triangles"] for m in stats["meshes"]}
    man.update({
        "name": name, "glb": name + ".glb", "posesFile": "poses.json",
        "note": "Abstract style 'clay figure' (VD/ABSTRACT-AND-WARDROBE.md section 1) of %s: same vertex order, shape space, joints, weights, dofs and poses; B5's lids (open, tapered onto the ball) and lid joints; blank sculpted eyeballs, gaze level; B6's last with the dressed style's %.0f mm sole; neutralised chest (girth kept), navel, groin and cleft; welded mouth (lower lip tucked under the upper); softened face and ears; nails softened; the whole body subdivided once (round 4); one satin material; shape baked on the CPU." % (src_name, h * 1000),
        "licence": man["licence"] + [{"what": "style operator, eyeballs", "source": "pipeline/abstract.py (this project)", "licence": "the project's own work"}, {"what": "last", "source": "pipeline/props.py, prop_model.py (B6, this project)", "licence": "the project's own work"}],
        "rest": {**man["rest"], "stature": round(float(man["rest"]["stature"]) + h, 4), "eyeHeight": round(float(np.mean([skel.head[names.index("eye_l")][1], skel.head[names.index("eye_r")][1]])), 4), "soleHeight": round(h, 4)},
        "style": {"id": "clay", "of": src_name, "soleHeight": round(h, 4), "soleHeightSource": src,
                  "switch": "same topology and joints as the body package: v_style(shape) = N(A v(shape)); style.npz holds the base offset and the per-target offsets on the 19,158-row hm08 array; joints differ from the bare body by +soleHeight in y and by B5's eye centres and lid joints, as in the dressed package",
                  "material": {"albedo_linear": al, "roughness": P["roughness"]}, "tints_linear": TINTS, "eyes": "blank (the incised iris was vetoed in VD/REVIEW-03 and is no longer built)"},
        "materials": {mat: {"class": "plain"}},
        "styles": {"clay": {"label": "Clay figure", "wardrobe": False, "bodyMask": False}}, "defaultStyle": "clay",
    })
    man["packet"]["hands"] = "A_POSE's fingers (RR's relaxed hand) added to %d hand sides of the poses that did not set them" % nh
    man["packet"].pop("otherPackages", None)
    man["build"] = {"by": "pipeline/abstract.py", "body": man.get("build"), "stats": stats, "validate": problems, "subdivided": sub_info, "eyeRadius_mm": round(st.eye_r * 1000, 2),
                    "params": {k: (list(v_) if isinstance(v_, tuple) else v_) for k, v_ in P.items()}, "chest": st.chest_info, "upperLidLowered_deg": round(lids[0][3], 2),
                    "regions": {k: int(m.sum()) for k, m in {**st.regions, **st.masks}.items()}, "triangles": tri_total, "drawCalls": len(meshes),
                    "trianglesPerRegion": {**regions, "eyeballs": bytri["eyeball_l"] + bytri["eyeball_r"], "last (both feet)": bytri.get(last.name, 0)},
                    "last": pinfo["props"]["last"], "legCut": cut_info, "style_offset_max_mm": round(float(moved.max() * 1000), 1)}
    json.dump(man, open(os.path.join(out, name + ".avatar.json"), "w"), indent=1)
    if not preview:
        np.savez_compressed(os.path.join(out, "style.npz"), base_offset=(v - c.base_v).astype(np.float32), lift=lift,
                            **{"target__" + t: (d - c.targets[t]).astype(np.float32) for t, d in targets.items()})
    print("  triangles %d %s, draw calls %d, glb %.1f MB" % (tri_total, man["build"]["trianglesPerRegion"], len(meshes), os.path.getsize(gp) / 1e6))
    return man


if __name__ == "__main__":
    a = sys.argv[1:]; opt = lambda n, d=None: a[a.index(n) + 1] if n in a else d
    if "--preview" in a:
        build(opt("--sex", "m"), opt("--out") or os.path.join(LAB, "B7", "preview"), subdiv="--subdiv" in a, preview="iris" if "--iris" in a else True)
    else:
        for s in ([opt("--sex")] if "--sex" in a else ["m", "f"]): build(s, opt("--out") if "--sex" in a else None, subdiv="--no-subdiv" not in a)
