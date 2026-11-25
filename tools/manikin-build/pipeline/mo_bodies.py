"""Stand-in bodies for the motion work (owner: B4): the 82-joint skeleton of RR/REPORT.md section 5 placed on the
MakeHuman base mesh for three people, with collision proxies measured from the mesh. Used until B1's body package and
RR's pipeline/rig.py exist; motion.py reads the JSON this writes (B4/standin/<person>.json) or a real package.

    $PY -I pipeline/mo_bodies.py            # writes B4/standin/{F05,M50,M95H}.json and a skinned stand-in GLB each
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np

LAB = __import__("labpaths").LAB
OUT = os.path.join(LAB, "B4", "standin")

# ---- the skeleton specification (RR/REPORT.md section 5): 82 joints, parents before children -----------------------
FINGERS = ["thumb", "index", "middle", "ring", "pinky"]

def spec():
    J = [("root", None), ("pelvis", "root")]
    prev = "pelvis"
    for i in range(1, 6): J.append((f"spine_0{i}", prev)); prev = f"spine_0{i}"
    J += [("neck_01", "spine_05"), ("neck_02", "neck_01"), ("head", "neck_02"), ("eye_l", "head"), ("eye_r", "head")]
    for s in "lr":
        J += [(f"clavicle_{s}", "spine_05"), (f"upperarm_{s}", f"clavicle_{s}"),
              (f"upperarm_twist_01_{s}", f"upperarm_{s}"), (f"upperarm_twist_02_{s}", f"upperarm_{s}"),
              (f"lowerarm_{s}", f"upperarm_{s}"), (f"lowerarm_twist_01_{s}", f"lowerarm_{s}"), (f"lowerarm_twist_02_{s}", f"lowerarm_{s}"),
              (f"hand_{s}", f"lowerarm_{s}")]
        for f in FINGERS:
            if f == "thumb": p = f"hand_{s}"
            else: J.append((f"{f}_metacarpal_{s}", f"hand_{s}")); p = f"{f}_metacarpal_{s}"
            for k in (1, 2, 3): J.append((f"{f}_0{k}_{s}", p)); p = f"{f}_0{k}_{s}"
        J += [(f"thigh_{s}", "pelvis"), (f"thigh_twist_01_{s}", f"thigh_{s}"), (f"thigh_twist_02_{s}", f"thigh_{s}"),
              (f"calf_{s}", f"thigh_{s}"), (f"calf_twist_01_{s}", f"calf_{s}"), (f"calf_twist_02_{s}", f"calf_{s}"),
              (f"foot_{s}", f"calf_{s}"), (f"ball_{s}", f"foot_{s}")]
    names = [n for n, _ in J]; assert len(names) == 82 and len(set(names)) == 82
    parent = [-1 if p is None else names.index(p) for _, p in J]
    return names, parent

def proxies(v, body, dom, ni, pos):
    """Collision proxies measured on a body mesh in its rest pose: torso ellipse sections riding on the spine joints, limb
    radii, foot extents, a head sphere. v (n,3) vertices, body (n,) bool mask of skin vertices, dom (n,) index of each
    vertex's dominant joint, ni name -> joint index, pos name -> rest joint position."""
    torso_j = ["pelvis"] + [f"spine_0{i}" for i in range(1, 6)]
    tmask = body & np.isin(dom, [ni[n] for n in torso_j])
    y0 = min(pos["thigh_l"][1], pos["thigh_r"][1]) - 0.06; y1 = pos["neck_01"][1]
    slices = []
    for yc in np.arange(y0, y1 + 1e-9, 0.025):
        m = tmask & (np.abs(v[:, 1] - yc) < 0.02)
        if m.sum() < 12: continue
        x = v[m, 0]; z = v[m, 2]; zlo, zhi = np.percentile(z, [1, 99])
        slices.append([float(yc), float((zlo + zhi) / 2), float(np.percentile(np.abs(x), 98)), float((zhi - zlo) / 2)])
    torso = []
    for k, jn in enumerate(torso_j):                      # each slice rides on the joint whose segment holds its height
        ya = -1e9 if k == 0 else pos[jn][1]; yb = 1e9 if k == len(torso_j) - 1 else pos[torso_j[k + 1]][1]
        sl = [s for s in slices if ya - 0.03 <= s[0] <= yb + 0.03]
        if sl: torso.append({"joint": jn, "slices": [[s[0] - pos[jn][1], s[1] - pos[jn][2], s[2], s[3]] for s in sl]})   # y, centre z relative to the joint; half width x; half depth z
    def radii(a, b, joints, ts):
        A, B = pos[a], pos[b]; ax = (B - A) / np.linalg.norm(B - A); L = np.linalg.norm(B - A)
        joints = list(joints) + [f"{j[:-2]}_twist_0{k}{j[-2:]}" for j in joints for k in (1, 2) if f"{j[:-2]}_twist_0{k}{j[-2:]}" in ni]
        m = body & np.isin(dom, [ni[n] for n in joints]); d = v[m] - A; t = d @ ax / L; r = np.linalg.norm(d - np.outer(d @ ax, ax), axis=1); out = []
        for tc in ts:
            k = np.abs(t - tc) < 0.08
            out.append(float(np.percentile(r[k], 90)) if k.sum() >= 6 else None)
        known = [x for x in out if x is not None] or [0.04]
        return [x if x is not None else float(np.mean(known)) for x in out]
    limbs = {}
    for s in "lr":
        limbs[f"thigh_{s}"] = radii(f"thigh_{s}", f"calf_{s}", [f"thigh_{s}", "pelvis"], [0.25, 0.6, 0.95])
        limbs[f"calf_{s}"] = radii(f"calf_{s}", f"foot_{s}", [f"calf_{s}"], [0.1, 0.5, 0.9])
        limbs[f"upperarm_{s}"] = radii(f"upperarm_{s}", f"lowerarm_{s}", [f"upperarm_{s}", f"upperarm_twist_02_{s}"], [0.3, 0.6, 0.95])
        limbs[f"lowerarm_{s}"] = radii(f"lowerarm_{s}", f"hand_{s}", [f"lowerarm_{s}", f"lowerarm_twist_02_{s}"], [0.1, 0.5, 0.92])
        hm = body & np.isin(dom, [ni[f"hand_{s}"]] + [ni[f"{f}_metacarpal_{s}"] for f in FINGERS[1:]])
        hv = v[hm] - pos[f"hand_{s}"]; a = pos[f"index_01_{s}"] - pos[f"hand_{s}"]; b = pos[f"pinky_01_{s}"] - pos[f"hand_{s}"]
        n = np.cross(a, b); n /= np.linalg.norm(n); th = hv @ n
        limbs[f"hand_{s}"] = [float((np.percentile(th, 97) - np.percentile(th, 3)) / 2)]     # half thickness of the palm
        fm = body & np.isin(dom, [ni[f"foot_{s}"], ni[f"ball_{s}"]])
        limbs[f"foot_{s}"] = {"heel_back": float(pos[f"foot_{s}"][2] - v[fm, 2].min()), "toe_front": float(v[fm, 2].max() - pos[f"foot_{s}"][2]),
                             "half_width": float((v[fm, 0].max() - v[fm, 0].min()) / 2)}
    hmask = body & (dom == ni["head"])
    head = {"centre": (v[hmask].mean(0) - pos["head"]).tolist(), "radius": float(np.percentile(np.linalg.norm(v[hmask] - v[hmask].mean(0), axis=1), 90))}
    return {"torso": torso, "limbs": limbs, "head": head}

PERSONS = {   # VD/review-packet.json "persons"; the MakeHuman macro values are a stand-in guess (RP owns the real map)
    "F05":  dict(sex=0.0, stature=1.523, weight=0.50, muscle=0.5),
    "M50":  dict(sex=1.0, stature=1.756, weight=0.62, muscle=0.5),
    "M95H": dict(sex=1.0, stature=1.869, weight=0.95, muscle=0.45),
}

def build(person):
    import mh_core as mh
    base = mh.load_base(); rig = mh.load_rig("default"); P = PERSONS[person]
    body = base.vgroups["body"]
    def shape(h): return mh.phenotype(gender=P["sex"], weight=P["weight"], muscle=P["muscle"], height=h)
    lo, hi = 0.0, 1.0
    for _ in range(18):                                   # stature by bisection on MakeHuman's height macro
        mid = (lo + hi) / 2; v = shape(mid); st = v[body, 1].max() - v[body, 1].min()
        if st < P["stature"]: lo = mid
        else: hi = mid
    v = shape((lo + hi) / 2); stature = float(v[body, 1].max() - v[body, 1].min())
    v = v * (P["stature"] / stature)                      # the macro range may not reach: finish with a uniform scale
    v[:, 1] -= v[body, 1].min()
    heads, tails = mh.joint_positions(v, rig); bi = {n: i for i, n in enumerate(rig.bones)}
    H = lambda n: heads[bi[n]]
    names, parent = spec(); pos = {}
    pos["root"] = np.zeros(3); pos["pelvis"] = H("root")
    for i in range(1, 6): pos[f"spine_0{i}"] = H(f"spine0{6 - i}")
    pos["neck_01"] = H("neck01"); pos["neck_02"] = H("neck02"); pos["head"] = H("head")
    for s, S in (("l", ".L"), ("r", ".R")):
        pos[f"eye_{s}"] = H("eye" + S); pos[f"clavicle_{s}"] = H("clavicle" + S); pos[f"upperarm_{s}"] = H("upperarm01" + S)
        pos[f"lowerarm_{s}"] = H("lowerarm01" + S); pos[f"hand_{s}"] = H("wrist" + S)
        for k in (1, 2, 3): pos[f"thumb_0{k}_{s}"] = H(f"finger1-{k}{S}")
        for fi, f in enumerate(FINGERS[1:], start=2):
            pos[f"{f}_metacarpal_{s}"] = H(f"metacarpal{fi - 1}{S}")
            for k in (1, 2, 3): pos[f"{f}_0{k}_{s}"] = H(f"finger{fi}-{k}{S}")
        pos[f"thigh_{s}"] = H("upperleg01" + S); pos[f"calf_{s}"] = H("lowerleg01" + S); pos[f"foot_{s}"] = H("foot" + S)
        pos[f"ball_{s}"] = np.mean([H(f"toe{k}-1{S}") for k in (1, 2, 3, 4, 5)], 0)
        for seg, a, b in (("upperarm", "upperarm", "lowerarm"), ("lowerarm", "lowerarm", "hand"), ("thigh", "thigh", "calf"), ("calf", "calf", "foot")):
            for k in (1, 2): pos[f"{seg}_twist_0{k}_{s}"] = pos[f"{a}_{s}"] + (pos[f"{b}_{s}"] - pos[f"{a}_{s}"]) * k / 3
    # finger tips (not joints): the tails of the last phalanges, for grip checks
    tips = {f"{f}_tip_{s}": tails[bi[f"finger{fi}-3{S}"]].tolist() for s, S in (("l", ".L"), ("r", ".R")) for fi, f in enumerate(FINGERS, start=1)}
    Ppos = np.array([pos[n] for n in names])

    # ---- which stand-in joint each MakeHuman bone's vertices follow (rigid map, good enough for a stand-in) ----------
    def owner(b):
        S = "_l" if b.endswith(".L") else "_r" if b.endswith(".R") else ""; c = b[:-2] if S else b
        m = {"root": "pelvis", "pelvis": "pelvis", "breast": "spine_04", "neck01": "neck_01", "neck02": "neck_02", "neck03": "neck_02",
             "clavicle": "clavicle", "shoulder01": "clavicle", "upperarm01": "upperarm", "upperarm02": "upperarm_twist_02",
             "lowerarm01": "lowerarm", "lowerarm02": "lowerarm_twist_02", "wrist": "hand", "upperleg01": "thigh", "upperleg02": "thigh",
             "lowerleg01": "calf", "lowerleg02": "calf", "foot": "foot", "eye": "eye"}
        if c.startswith("spine0"): return f"spine_0{6 - int(c[-1])}"
        if c.startswith("toe"): return "ball" + S
        if c.startswith("metacarpal"): return f"{FINGERS[int(c[-1])]}_metacarpal{S}"
        if c.startswith("finger"): return f"{FINGERS[int(c[6]) - 1]}_0{c[-1]}{S}"
        if c in m: return m[c] + (S if m[c] not in ("pelvis", "spine_04", "neck_01", "neck_02") else "")
        return "head"
    own = np.array([names.index(owner(b)) for b in rig.bones])
    W = rig.weights.tocsr()
    dom = own[np.asarray(W.argmax(axis=1)).ravel()]       # dominant stand-in joint per vertex
    ni = {n: i for i, n in enumerate(names)}
    prox = proxies(v, body, dom, ni, pos)
    out = {"person": person, "source": "stand-in: MakeHuman hm08 base mesh, macro " + json.dumps(P), "stature": P["stature"],
           "names": names, "parent": parent, "pos": Ppos.round(6).tolist(), "rot": [[0, 0, 0, 1]] * 82, "tips": tips,
           "proxy": prox}
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, person + ".json"), "w"))
    # ---- a skinned stand-in GLB (clay) so motion can be looked at before the real body exists ----------------------
    try:
        import glb, scipy.sparse as sp
        M = sp.csr_matrix((np.ones(len(own)), (np.arange(len(own)), own)), shape=(len(own), 82))
        Wj = (W @ M).tocsr()
        q = base.quads[mh.body_quads(base, ("body",))]; tris = mh.triangulate(q)
        used = np.unique(tris); remap = -np.ones(len(v), int); remap[used] = np.arange(len(used))
        mesh = glb.Mesh(name="body", v=v[used], tris=remap[tris], material="clay", weights=Wj[used], morph_normals=False)
        sk = glb.Skeleton(names=names, parent=np.array(parent), head=Ppos)
        mats = {"clay": {"pbrMetallicRoughness": {"baseColorFactor": [0.62, 0.6, 0.57, 1], "metallicFactor": 0, "roughnessFactor": 0.75}}}
        st = glb.write_glb(os.path.join(OUT, person + ".glb"), [mesh], sk, mats)
        print(person, "stand-in GLB", st.get("bytes"), "bytes")
    except Exception as e:
        print(person, "stand-in GLB not written:", repr(e))
    return out

if __name__ == "__main__":
    for p in (sys.argv[1:] or list(PERSONS)):
        o = build(p); P = np.array(o["pos"]); n = o["names"]; g = lambda a: P[n.index(a)]
        print(p, "stature", o["stature"], "hip h %.3f" % g("thigh_l")[1], "leg %.3f" % (np.linalg.norm(g("calf_l") - g("thigh_l")) + np.linalg.norm(g("foot_l") - g("calf_l"))),
              "arm %.3f" % (np.linalg.norm(g("lowerarm_l") - g("upperarm_l")) + np.linalg.norm(g("hand_l") - g("lowerarm_l"))),
              "waist half w/d", [round(x, 3) for x in o["proxy"]["torso"][1]["slices"][0][2:]], "thigh r", [round(x, 3) for x in o["proxy"]["limbs"]["thigh_l"]])
