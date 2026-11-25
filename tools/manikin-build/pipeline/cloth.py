# Cloth form (owner: B8): simulated drape baked onto B2's garments.
#   prep : package -> per garment a simulation input (body and skinned garment as point caches over a stand -> seated move)
#   sim  : Blender (pipeline/cloth_sim.py) runs one cloth simulation per garment over that move
#   bake : simulated surface -> tangent-space fold normal maps (standing, seated) + seated corrective morph targets
#   dress: package -> package with the maps, the morph targets and their drivers (B2's files are read, never changed)
# Everything is computed on the GLB as B2 wrote it (its binding, weights, morph names stay). Documented in pipeline/README.md, "Cloth form".
import sys, os, json, struct, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components, dijkstra

FR_SETTLE, FR_MOVE, FR_REST = 36, 48, 30                      # frames: settle standing, move to the seated pose, settle seated
FRAMES = FR_SETTLE + FR_MOVE + FR_REST
SEATED_POSE = "SEATED_GRIPS"
SOFT_MASS = 0.02                                                # per-vertex mass of the spring-tied (seated) run
FINGERS = ("index", "middle", "ring", "pinky", "thumb")
# per garment kind: which border loops are pinned (reach of full pin, end of fade, metres) and the cloth numbers for Blender
KIND = {
    "trousers": {"levels": 1, "pin": {"top": (0.035, 0.11), "low": (0.012, 0.05)}, "grow": 0.025,
                 "cloth": {"mass": 0.25, "tension": 30, "compression": 30, "shear": 12, "bending": 3.0, "air": 2.0}},
    "top":      {"levels": 2, "pin": {"top": (0.075, 0.13), "side": (0.015, 0.05), "low": None}, "grow": 0.02,
                 "cloth": {"mass": 0.15, "tension": 20, "compression": 20, "shear": 8, "bending": 1.2, "air": 2.0}},
}
# seated corrective morph targets: (suffix, dof, from, to); the region each one owns is found from the skin weights
DRIVERS = {"trousers": [("lap", "hip_%s.flex", 15, 80), ("knee", "knee_%s.flex", 15, 88)],
           "top": [("waist", "hip_%s.flex", 15, 80), ("elbow", "elbow_%s.flex", 5, 49)]}


def kind_of(mesh_name):
    if mesh_name.startswith("shoe_safety"): return "shoe"                     # round 2: the worn shoe joins the collider (not simulated)
    return "trousers" if "trousers" in mesh_name else "top" if "_top_" in mesh_name else None


# ------------------------------------------------------------------------------------------------ package reading
def load(package):
    import rig_rom as rr, glb as glbio
    pk = rr.load_package(package, weld=False)
    js, blob = glbio.read_glb(os.path.join(pk.root, pk.manifest["glb"])); acc = lambda i: np.asarray(glbio.accessor(js, blob, i))
    names0 = [js["nodes"][i]["name"] for i in js["skins"][0]["joints"]]; remap = np.array([pk.names.index(n) for n in names0])
    pk.js, pk.blob, pk.garments = js, blob, {}
    for mi, m in enumerate(js["meshes"]):
        if kind_of(m["name"]) is None: continue
        p = m["primitives"][0]; a = p["attributes"]; tn = (m.get("extras") or {}).get("targetNames") or []
        eight = all(k in a for k in ("_JOINTS8_0", "_JOINTS8_1", "_WEIGHTS8_0", "_WEIGHTS8_1"))   # round 3: the viewer skins with the 8-influence set when present
        Jr = np.concatenate([acc(a["_JOINTS8_0"]), acc(a["_JOINTS8_1"])], 1) if eight else acc(a["JOINTS_0"])
        W = (np.concatenate([acc(a["_WEIGHTS8_0"]), acc(a["_WEIGHTS8_1"])], 1) if eight else acc(a["WEIGHTS_0"])).astype(np.float64); W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
        g = type("Garment", (), {})(); g.name = m["name"]; g.kind = kind_of(m["name"]); g.mesh_index = mi
        g.P = acc(a["POSITION"]).astype(np.float64); g.uv = acc(a["TEXCOORD_0"]).astype(np.float64)
        g.tris = acc(p["indices"]).astype(np.int64).reshape(-1, 3); g.J = remap[np.rint(Jr).astype(np.int64)]; g.W = W
        g.dqs = acc(a["_DQS"]).astype(np.float64).ravel() if "_DQS" in a else None
        g.morphs = {tn[i]: acc(t["POSITION"]).astype(np.float64) for i, t in enumerate(p.get("targets", [])) if i < len(tn)}
        g.material = js["materials"][p["material"]]["name"]; g.bake = None
        bk = (pk.manifest.get("shape") or {}).get("bake"); bk = [b for b in (bk if isinstance(bk, list) else [bk] if bk else []) if g.name in (b.get("meshes") or [])]
        if bk and "_SRC" in a:                                           # FORMAT v0.4: the garment's shape targets live in a .shape.bin, found through _SRC
            b = bk[0]; N = int(b["vertices"]); K = len(b["targets"]); raw = np.memmap(os.path.join(pk.root, b["file"]), mode="r")
            src = np.rint(acc(a["_SRC"]).ravel()).astype(np.int64); d16 = np.frombuffer(raw, "<i2", K * N * 3, N * 12).reshape(K, N, 3)
            g.bake = {"names": list(b["targets"]), "scale": np.asarray(b["targetScale"], np.float64) / 32767.0, "d": d16[:, src].astype(np.float32)}
        pk.garments[g.name] = g
    return pk


def person(pk, name):
    """Rest body, rest joints and rest garments of a packet person."""
    import rig_rom as rr
    v, J, info = rr.body_of(pk, name); w = info.get("morph_weights") or {}
    rest = {}
    for g in pk.garments.values():
        P = g.P.copy()
        for t, x in w.items():
            if t in g.morphs: P += x * g.morphs[t]
            elif g.bake and t in g.bake["names"]: k = g.bake["names"].index(t); P += (x * g.bake["scale"][k]) * g.bake["d"][k]
        rest[g.name] = P
    return v, J, rest


def seated_dofs(pk):
    p = next(q for q in pk.poses if q.get("id") == SEATED_POSE)
    return {k: v for k, v in p["dofs"].items() if not any(f in k for f in FINGERS)}


def pose(pk, J0, dofs):
    import rig as rg
    M, Jp, R = rg.fk(pk.names, pk.parent, J0, pk.dofs, pk.drivers, dofs, True)
    return M


def skin(pk, mesh, v, M):
    import rig as rg
    if mesh == "body": return rg.skin(v, pk.J, pk.W, M, pk.mask)
    g = pk.garments[mesh]; return rg.skin(v, g.J, g.W, M, g.dqs)


def skin_frames(pk, mesh, v, M):
    """Per vertex the 3x3 linear part of rest -> posed (skinning is affine in the vertex for fixed weights)."""
    p0 = skin(pk, mesh, v, M); A = np.zeros((len(v), 3, 3))
    for k in range(3):
        e = np.zeros(3); e[k] = 1.0
        A[:, :, k] = skin(pk, mesh, v + e, M) - p0
    return p0, A


# ------------------------------------------------------------------------------------------------ topology
def vnormals(v, tris):
    fn = np.cross(v[tris[:, 1]] - v[tris[:, 0]], v[tris[:, 2]] - v[tris[:, 0]])
    n = np.zeros_like(v)
    for k in range(3): np.add.at(n, tris[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def adjacency(tris, n):
    e = np.vstack([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)).tocsr(); A = ((A + A.T) > 0).astype(np.float64)
    return A.tocsr()


def smooth(x, A, iters, lam=0.6):
    deg = np.maximum(np.asarray(A.sum(1)).ravel(), 1.0)[:, None]
    for _ in range(iters): x = (1 - lam) * x + lam * (A @ x) / deg
    return x


class Topo:
    """The garment's welded surface split into: the main cloth sheet (simulated), B2's rim rings at the openings and
    loose pieces (buttons, pocket flaps, the collar liner), which ride on the nearest simulated vertex."""

    def __init__(self, g, P, levels=None):
        import mh_wardrobe as wd
        key = np.round(P / 1e-6).astype(np.int64); _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        self.first, self.inv = first, inv.ravel(); nw = len(first); self.nw = nw
        tw = self.inv[g.tris]; ok = (tw[:, 0] != tw[:, 1]) & (tw[:, 1] != tw[:, 2]) & (tw[:, 0] != tw[:, 2]); self.tw = tw; self.tri_ok = ok
        A = adjacency(tw[ok], nw); self.A = A
        nc, lab = connected_components(A, directed=False); cnt = np.bincount(lab[tw[ok][:, 0]], minlength=nc); main = int(np.argmax(cnt))
        Pw = P[first]; in_main = lab == main
        # rim: three rings of exactly the loop's length behind a boundary loop (wd.Rim), found by breadth-first layers
        tm = tw[ok & in_main[tw[:, 0]]]
        loops = [np.asarray(l) for l in wd.boundary_loops(tm, nw)]
        rim = np.zeros(nw, bool); carrier = np.arange(nw); self.loops = []
        for l in loops:
            if len(l) < 5: continue
            layers = [l]; seen = np.zeros(nw, bool); seen[l] = True
            for _ in range(3):
                nxt = np.unique(A[layers[-1]].indices); nxt = nxt[~seen[nxt]]; seen[nxt] = True; layers.append(nxt)
            if all(len(x) == len(l) for x in layers):
                border = layers[3]
                for ring in layers[:3]:
                    rim[ring] = True
                    d = np.linalg.norm(Pw[ring][:, None] - Pw[border][None], axis=2); carrier[ring] = border[np.argmin(d, 1)]
                self.loops.append(border)
            else: self.loops.append(l)                                               # an opening without a rim
        self.rim = rim; self.simv = np.where(in_main & ~rim)[0]
        loose = np.where(~in_main)[0]
        if len(loose):
            from scipy.spatial import cKDTree
            carrier[loose] = self.simv[cKDTree(Pw[self.simv]).query(Pw[loose])[1]]
        self.carrier = carrier
        sid = -np.ones(nw, np.int64); sid[self.simv] = np.arange(len(self.simv)); self.sid = sid
        keep = ok & (sid[tw] >= 0).all(1); self.sim_gtri = np.where(keep)[0]            # GLB triangles that are simulated
        t0 = sid[tw[keep]]; self.n0 = len(self.simv); self.tri0 = t0
        if levels is None: levels = 1 if len(t0) >= 10000 else 2                         # edges of 6 to 8 mm in the simulated sheet
        # subdivision levels: a new vertex per edge, four triangles per triangle; `bary` keeps every fine corner's place in its GLB triangle
        nt = len(t0); tri = t0; n = self.n0; self.levels = []; bary = np.tile(np.eye(3), (nt, 1, 1)); base = np.arange(nt)
        for _ in range(levels):
            e = np.sort(np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), axis=1); ue, einv = np.unique(e, axis=0, return_inverse=True)
            m = n + einv.ravel().reshape(3, len(tri)).T; self.levels.append((tri, ue))
            b01, b12, b20 = 0.5 * (bary[:, 0] + bary[:, 1]), 0.5 * (bary[:, 1] + bary[:, 2]), 0.5 * (bary[:, 2] + bary[:, 0])
            bary = np.concatenate([np.stack([bary[:, 0], b01, b20], 1), np.stack([b01, bary[:, 1], b12], 1), np.stack([b20, b12, bary[:, 2]], 1), np.stack([b01, b12, b20], 1)])
            tri = np.vstack([np.stack([tri[:, 0], m[:, 0], m[:, 2]], 1), np.stack([m[:, 0], tri[:, 1], m[:, 1]], 1),
                             np.stack([m[:, 2], m[:, 1], tri[:, 2]], 1), np.stack([m[:, 0], m[:, 1], m[:, 2]], 1)])
            base = np.tile(base, 4); n += len(ue)
        self.tris = tri; self.ns = n; self.bary = bary; self.base = base; self.As = adjacency(tri, n)

    def refine(self, Xw):
        """Welded garment vertices -> the simulation mesh: originals plus curved edge midpoints (each midpoint is projected onto
        the tangent planes of its two ends and averaged: the sheet is smooth, the original vertices do not move)."""
        X = Xw[self.simv]
        for tri, ue in self.levels:
            N = vnormals(X, tri); a, b = ue[:, 0], ue[:, 1]; m = 0.5 * (X[a] + X[b])
            pa = m - ((m - X[a]) * N[a]).sum(1, keepdims=True) * N[a]; pb = m - ((m - X[b]) * N[b]).sum(1, keepdims=True) * N[b]
            X = np.vstack([X, 0.5 * (pa + pb)])
        return X

    def pins(self, Pw, kind, spec=None):
        spec = spec or KIND[kind]["pin"]; X = self.refine(Pw)
        e = np.vstack([self.tris[:, [0, 1]], self.tris[:, [1, 2]], self.tris[:, [2, 0]]]); L = np.linalg.norm(X[e[:, 0]] - X[e[:, 1]], axis=1)
        G = sp.coo_matrix((L, (e[:, 0], e[:, 1])), shape=(self.ns, self.ns)).tocsr(); G = G.maximum(G.T)
        ymin, ymax = Pw[self.simv][:, 1].min(), Pw[self.simv][:, 1].max(); pin = np.zeros(self.ns); self.loop_class = []
        for l in self.loops:
            c = Pw[l].mean(0); rel = (c[1] - ymin) / (ymax - ymin)
            cls = "top" if rel > 0.8 else "side" if (kind == "top" and abs(c[0]) > 0.25) else "low"
            self.loop_class.append((cls, len(l), [round(float(x), 3) for x in c]))
            if spec.get(cls) is None or (cls != "top" and len(l) < 12): continue
            full, end = spec[cls]; src = self.sid[l]; src = src[src >= 0]
            if not len(src): continue
            d = dijkstra(G, directed=False, indices=src, min_only=True, limit=end)
            w = np.clip((end - d) / (end - full), 0, 1); w = np.where(np.isfinite(d), w * w * (3 - 2 * w), 0.0); pin = np.maximum(pin, w)
        return pin

    def to_glb(self, Dsim0):
        """A per-vertex quantity on the simulated original vertices -> every GLB vertex (rim and loose pieces ride)."""
        Dw = np.zeros((self.nw,) + Dsim0.shape[1:]); Dw[self.simv] = Dsim0; Dw = Dw[self.carrier]
        return Dw[self.inv]


def write_pc2(path, frames):
    frames = np.asarray(frames, np.float32)
    with open(path, "wb") as f:
        f.write(b"POINTCACHE2\0"); f.write(struct.pack("<iiffi", 1, frames.shape[1], 1.0, 1.0, frames.shape[0])); f.write(frames.tobytes())


def ramp(f):
    t = np.clip((f - FR_SETTLE) / FR_MOVE, 0, 1); return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ prep
def prep(package, work, who="M50", only=None, collide_with=None, soft=0.0, skinned_over=False, frames=None):
    """Simulation input per garment under `work`: <garment>.npz (meshes, pins), <garment>.body.pc2, <garment>.goal.pc2,
    <garment>.json. collide_with = {garment: other garment whose finished simulation joins the collider}.
    soft > 0: every vertex is tied to its skinned place by a spring of that pin weight (the seated run: a free sheet is pulled
    through the body where thigh and belly overlap); mass and stiffness are scaled down together so that the spring can carry the cloth."""
    os.makedirs(work, exist_ok=True); pk = load(package); v0, J0, rest = person(pk, who); sd = seated_dofs(pk)
    Ms = [pose(pk, J0, {k: v * ramp(f) for k, v in sd.items()}) for f in range(FRAMES)]
    body = np.stack([skin(pk, "body", v0, M) for M in Ms]); btris = load_body_tris(pk)
    for g in pk.garments.values():
        if (only and g.name not in only) or g.kind not in KIND: continue
        P = rest[g.name]; T = Topo(g, P); pin = T.pins(P[T.first], g.kind); cl = dict(KIND[g.kind]["cloth"]); cl.update(pin_stiffness=1.0, damping=8.0, quality=8)
        if soft > 0:
            pin = np.maximum(pin, soft); k = SOFT_MASS / cl["mass"]
            cl = {"mass": SOFT_MASS, "tension": cl["tension"] * k, "compression": cl["compression"] * k, "shear": cl["shear"] * k, "bending": cl["bending"] * k,
                  "air": cl["air"], "pin_stiffness": 50.0, "damping": 8.0 * k, "quality": 10}
        goal = np.stack([T.refine(skin(pk, g.name, P, M)[T.first]) for M in Ms])
        cv, ct = body, btris
        if skinned_over and g.kind == "top" and "garment_trousers_work" in pk.garments:      # round 2: the trousers as skinned (no run of their own)
            tg = pk.garments["garment_trousers_work"]; tP = rest[tg.name]
            ct = np.vstack([btris, tg.tris + body.shape[1]]); cv = np.concatenate([body, np.stack([skin(pk, tg.name, tP, M) for M in Ms])], 1)
        other = (collide_with or {}).get(g.name)
        if other and os.path.exists(os.path.join(work, other + ".sim.npy")):
            o = np.load(os.path.join(work, other + ".sim.npy")); od = np.load(os.path.join(work, other + ".npz"))
            ct = np.vstack([btris, od["t"] + body.shape[1]]); cv = np.concatenate([body, o], 1)
        write_pc2(os.path.join(work, g.name + ".body.pc2"), cv); write_pc2(os.path.join(work, g.name + ".goal.pc2"), goal)
        np.savez(os.path.join(work, g.name + ".npz"), v=goal[0], t=T.tris, pin=pin, body_v=cv[0], body_t=ct)
        json.dump({"frames": frames or FRAMES, "settle": FR_SETTLE, "kind": g.kind, "grow": KIND[g.kind]["grow"], "cloth": cl, "soft": soft, "person": who,
                   "package": os.path.abspath(package)}, open(os.path.join(work, g.name + ".json"), "w"))
        print(g.name, "glb verts", len(P), "welded", T.nw, "rim", int(T.rim.sum()), "sim originals", T.n0, "sim verts", T.ns, "sim tris", len(T.tris),
              "pinned", int((pin > 0.999).sum()), "loops", T.loop_class)


# ------------------------------------------------------------------------------------------------ round 2: the seated drape
# The round-1 seated runs failed two ways: pinned at waist AND hems, the free sheet was pulled through the lap; tied to the
# skinned garment by springs, it could not move far enough to matter. Round 2 (REVIEW-07 item 2): the waistband is the only pin,
# the hems are free to ride up the shin, the body, the worn shoes and a seat pan are colliders, and the cloth settles for 90 frames.
SEAT2 = {"phases": (30, 60, 20, 70),               # frames: settle standing, move to the seated pose, the pan rises under the thighs, settle
         "pin": {"top": (0.03, 0.08)},             # the waistband only (full pin within 30 mm of the top loop, none beyond 80 mm)
         "cloth": {"mass": 0.25, "tension": 30, "compression": 30, "shear": 12, "bending": 3.0, "air": 2.0,
                   "pin_stiffness": 1.0, "damping": 8.0, "quality": 10, "collision_quality": 4},
         "grow": 0.025,                            # slack, as in the standing run
         "gap": 0.006,                             # the pan top lies this far under the body's lowest seated point: room for the cloth
         "rise": 0.12}                             # the pan comes up from this far below its place


def seat_pan(top, z_rear, z_front, hw=0.28, th=0.08, R=0.04, seg=6):
    """A seat pan: a slab with a rounded front edge (the thigh rolls over it), package frame (+Y up, +Z forward)."""
    prof = [(z_rear, top), (z_front - R, top)]
    for k in range(1, seg + 1):
        a = 0.5 * np.pi * k / seg; prof.append((z_front - R + R * np.sin(a), top - R + R * np.cos(a)))
    prof += [(z_front, top - th), (z_rear, top - th)]
    n = len(prof); v = np.array([(x, y, z) for x in (-hw, hw) for z, y in prof], np.float64); t = []
    for i in range(n):
        j = (i + 1) % n; t += [(i, j, n + j), (i, n + j, n + i)]
    for i in range(1, n - 1): t += [(0, i + 1, i), (n, n + i, n + i + 1)]
    t = np.array(t, np.int64); c = v.mean(0); fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    if ((v[t].mean(1) - c) * fn).sum() < 0: t = t[:, ::-1].copy()            # outward winding
    return v, t


def prep_seat(package, work, who="M50", garment="garment_trousers_work"):
    """Simulation input for the round-2 seated drape of one garment (`SEAT2`); then cloth_sim.py as usual."""
    import rig as rg
    os.makedirs(work, exist_ok=True); pk = load(package); v0, J0, rest = person(pk, who); sd = seated_dofs(pk)
    S, Mv, Pr, Rs = SEAT2["phases"]; N = S + Mv + Pr + Rs
    ramp2 = lambda f: (lambda t: t * t * (3 - 2 * t))(np.clip((f - S) / Mv, 0, 1))
    Ms = [rg.fk(pk.names, pk.parent, J0, pk.dofs, pk.drivers, {k: v * ramp2(f) for k, v in sd.items()}, True)[0] for f in range(N)]
    _, Jp, _ = rg.fk(pk.names, pk.parent, J0, pk.dofs, pk.drivers, sd, True)
    body = np.stack([skin(pk, "body", v0, M) for M in Ms]); B = body[-1]
    ix = lambda n: pk.names.index(n); hip = 0.5 * (Jp[ix("thigh_l")] + Jp[ix("thigh_r")]); thigh = np.linalg.norm(J0[ix("calf_l")] - J0[ix("thigh_l")])
    calfw = sum(pk.W[:, k] * np.isin(pk.J[:, k], [ix("calf_l"), ix("calf_r")]) for k in range(pk.J.shape[1]))
    upper_calf = (calfw > 0.5) & (B[:, 1] > Jp[ix("calf_l")][1] - 0.25)
    z_front = min(hip[2] + 0.38 * thigh / 0.44, float(B[upper_calf, 2].min()) - 0.02); z_rear = hip[2] - 0.20
    under = (B[:, 2] > hip[2] - 0.18) & (B[:, 2] < z_front) & (np.abs(B[:, 0]) < 0.28) & (B[:, 1] < hip[1])
    top = float(B[under, 1].min()) - SEAT2["gap"]; pv, pt = seat_pan(top, z_rear, z_front)
    def pan_at(f):
        if f < S + Mv: return pv + np.array([0, -3.0, 0])                      # parked far below while the legs move
        t = min(1.0, (f - S - Mv) / Pr); t = t * t * (3 - 2 * t); return pv + np.array([0, -SEAT2["rise"] * (1 - t), 0])
    shoes = [g for g in pk.garments.values() if g.kind == "shoe"]
    parts_t = [pk.tris]; off = len(v0)
    for sh in shoes: parts_t.append(sh.tris + off); off += len(sh.P)
    parts_t.append(pt + off); ct = np.vstack(parts_t)
    cv = np.stack([np.vstack([body[f]] + [skin(pk, sh.name, rest[sh.name], Ms[f]) for sh in shoes] + [pan_at(f)]) for f in range(N)])
    g = pk.garments[garment]; P = rest[g.name]; T = Topo(g, P); pin = T.pins(P[T.first], g.kind, SEAT2["pin"])
    goal = np.stack([T.refine(skin(pk, g.name, P, M)[T.first]) for M in Ms])
    write_pc2(os.path.join(work, g.name + ".body.pc2"), cv); write_pc2(os.path.join(work, g.name + ".goal.pc2"), goal)
    np.savez(os.path.join(work, g.name + ".npz"), v=goal[0], t=T.tris, pin=pin, body_v=cv[0], body_t=ct)
    cfg = {"frames": N, "settle": S, "phases": SEAT2["phases"], "kind": g.kind, "grow": SEAT2["grow"], "cloth": SEAT2["cloth"], "soft": 0.0,
           "person": who, "package": os.path.abspath(package), "method": "seat2",
           "pan": {"top": top, "z_rear": z_rear, "z_front": z_front, "half_width": 0.28, "hip": hip.tolist()}, "shoes": [sh.name for sh in shoes]}
    json.dump(cfg, open(os.path.join(work, g.name + ".json"), "w"), indent=1)
    print(g.name, who, "frames", N, "sim verts", T.ns, "pinned", int((pin > 0.999).sum()), "collider verts", cv.shape[1], "pan top %.3f front %.3f rear %.3f" % (top, z_front, z_rear), "loops", T.loop_class)


RAISE = {"keys": [("E26", {"hip_r.flex": 90.0, "knee_r.flex": 83.462}), ("E27", {"hip_r.flex": 120.0, "knee_r.flex": 123.462})],
         "phases": (30, 50, 50, 40, 50)}       # round 3 (REVIEW-09 item 4): settle standing, raise to E26, settle, on to E27, settle (220 frames)


def prep_raise(package, work, who="M50", garment="garment_trousers_work"):
    """Simulation input for a standing hip flexion of the right leg (W6-E26, E27): waistband pinned, hems free, body and shoes collide,
    no seat. Key frames: the last frame of each settle (json "key_frames")."""
    import rig as rg
    os.makedirs(work, exist_ok=True); pk = load(package); v0, J0, rest = person(pk, who)
    (k1, d1), (k2, d2) = RAISE["keys"]; S, M1, R1, M2, R2 = RAISE["phases"]; N = S + M1 + R1 + M2 + R2
    sm = lambda t: t * t * (3 - 2 * t)
    def dofs_at(f):
        t1 = sm(np.clip((f - S) / M1, 0, 1)); t2 = sm(np.clip((f - S - M1 - R1) / M2, 0, 1))
        return {k: (1 - t2) * t1 * d1.get(k, 0) + t2 * d2.get(k, 0) for k in set(d1) | set(d2)}
    Ms = [rg.fk(pk.names, pk.parent, J0, pk.dofs, pk.drivers, dofs_at(f), True)[0] for f in range(N)]
    body = np.stack([skin(pk, "body", v0, M) for M in Ms]); shoes = [g for g in pk.garments.values() if g.kind == "shoe"]
    parts_t = [pk.tris]; off = len(v0)
    for sh in shoes: parts_t.append(sh.tris + off); off += len(sh.P)
    ct = np.vstack(parts_t); cv = np.stack([np.vstack([body[f]] + [skin(pk, sh.name, rest[sh.name], Ms[f]) for sh in shoes]) for f in range(N)])
    g = pk.garments[garment]; P = rest[g.name]; T = Topo(g, P); pin = T.pins(P[T.first], g.kind, SEAT2["pin"])
    goal = np.stack([T.refine(skin(pk, g.name, P, M)[T.first]) for M in Ms])
    write_pc2(os.path.join(work, g.name + ".body.pc2"), cv); write_pc2(os.path.join(work, g.name + ".goal.pc2"), goal)
    np.savez(os.path.join(work, g.name + ".npz"), v=goal[0], t=T.tris, pin=pin, body_v=cv[0], body_t=ct)
    keys = {k1: S + M1 + R1 - 1, k2: N - 1}
    json.dump({"frames": N, "settle": S, "phases": RAISE["phases"], "kind": g.kind, "grow": SEAT2["grow"], "cloth": SEAT2["cloth"], "soft": 0.0, "person": who,
               "package": os.path.abspath(package), "method": "raise", "keys": {k: {"frame": keys[k], "dofs": d} for k, d in RAISE["keys"]}},
              open(os.path.join(work, g.name + ".json"), "w"), indent=1)
    print(g.name, who, "frames", N, "keys", keys, "pinned", int((pin > 0.999).sum()))


def read_pc2(path):
    raw = np.memmap(path, mode="r"); _, n, _, _, k = struct.unpack_from("<iiffi", raw, 12)
    return np.frombuffer(raw, "<f4", k * n * 3, 32).reshape(k, n, 3)


def transfer(old_work, new_work, garment):
    """Re-use a finished simulation after the garment was re-fitted (B2 rebuilt the package): `new_work` holds a fresh prep of
    the same garment; the drape (simulated minus skinned, per frame) is carried over by nearest rest vertex."""
    from scipy.spatial import cKDTree
    Go = read_pc2(os.path.join(old_work, garment + ".goal.pc2")); Gn = read_pc2(os.path.join(new_work, garment + ".goal.pc2")); So = np.load(os.path.join(old_work, garment + ".sim.npy"), mmap_mode="r")
    d, nn = cKDTree(Go[0]).query(Gn[0]); out = np.zeros(Gn.shape, np.float32)
    for f in range(len(Gn)): out[f] = Gn[f] + (np.asarray(So[f]) - Go[f])[nn]
    np.save(os.path.join(new_work, garment + ".sim.npy"), out)
    print("transfer", garment, "nearest rest vertex mm p50 p99 max", [round(float(x) * 1000, 2) for x in np.percentile(d, [50, 99, 100])])


def load_body_tris(pk):
    return pk.tris


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "prep":
        cw = {"garment_top_shirt": "garment_trousers_work"} if "--over" in sys.argv else None
        only = [a for a in sys.argv[4:] if not a.startswith("--")] or None
        soft = float(next((a.split("=")[1] for a in sys.argv if a.startswith("--soft=")), 0))
        who = next((a.split("=")[1] for a in sys.argv if a.startswith("--who=")), "M50")
        nf = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--frames=")), None)        # --frames=40: the standing set only
        prep(sys.argv[2], sys.argv[3], who=who, only=only, collide_with=cw, soft=soft, skinned_over="--over-skinned" in sys.argv, frames=nf)
    elif cmd == "transfer": transfer(*sys.argv[2:5])
    elif cmd == "prep_raise":                                                    # cloth.py prep_raise <package> <work> [--who=M50]
        prep_raise(sys.argv[2], sys.argv[3], who=next((a.split("=")[1] for a in sys.argv if a.startswith("--who=")), "M50"))
    elif cmd == "prep_seat":                                                     # cloth.py prep_seat <package> <work> [--who=M50] [garment]
        who = next((a.split("=")[1] for a in sys.argv if a.startswith("--who=")), "M50")
        rest_args = [a for a in sys.argv[4:] if not a.startswith("--")]
        prep_seat(sys.argv[2], sys.argv[3], who=who, **({"garment": rest_args[0]} if rest_args else {}))
    elif cmd in ("bake", "dress", "proof", "bake_seat2", "dress2", "bake_stand", "bake_raise", "bake_heavy", "dress_extra"):
        import cloth_bake as cb
        getattr(cb, cmd)(*sys.argv[2:])
