"""Motion pipeline (owner: B4): CMU ASF/AMC -> cleaned, retargeted, foot-planted clips on the 82-joint skeleton.

    PY=$MANIKIN_PYTHON
    $PY -I pipeline/motion.py build                      # stand-in bodies -> B4/clips/<person>/<clip>.glb + B4/metrics-retarget.json
    $PY -I pipeline/motion.py build --package packages/body-clay    # the real body -> packages/body-clay/clips/
    $PY -I pipeline/motion.py check --package packages/body-clay    # fails loudly if joint names, parents or rest frames differ

Everything works in "delta space": a joint's pose is its world rotation away from the rest pose (D), expressed in the
world axes (+X left, +Y up, +Z front). A joint's glTF rotation is  inv(Q0[parent]) * inv(D[parent]) * D[j] * Q0[j],  so the
maths never depends on how the rig orients its joint frames; only the exported numbers do (hence the check).
"""
import sys, os, json, hashlib, struct, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from mo_math import qmul, qinv, qrot, qaxis, qarc, qeuler_xyz, qfix, qslerp, qlog, qexp, qangle, qnorm, QI
import mo_bodies

LAB = __import__("labpaths").LAB
CMU = os.path.join(LAB, "downloads", "cmu-mocap")
CREDIT = "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."
SRC_FPS = {"79": 60, "143": 120, "86": 120, "07": 120}
FPS = 30
UP = np.array([0.0, 1.0, 0.0])
CLIPS = {   # output name -> source take and options
    "rom-a":           dict(src="143_21", what="range of motion, actor 143"),
    "rom-b":           dict(src="79_22", what="range of motion, actor 79"),
    "walk":            dict(src="07_01", what="one walk across the floor, root motion kept"),
    "walk-loop":       dict(src="07_01", loop=True, what="one walk cycle closed into a loop; the root joint carries the constant forward velocity"),
    "sit-down-get-up": dict(src="143_18", what="sit down on a stool and get up"),
    "seated-base":     dict(src="86_15", what="walk to a seat, sit, hand motions (the seated base layer)"),
    "move-stand":      dict(src="07_01", loop=True, tile=4.5, swing_clear=0.012, shoe_margin=0.015, level_roll=True, toe_limit=10.0, arm_limit=9.0, what="MOVE_STAND (round 8): an upright walk, CMU 07_01's cleanest cycle (source frames 18-51 at 30 fps, seam closed) walked on for 4.5 cycles (4.95 s, about 7 m); the eight packet frames fall on eight different phases of the step"),
    "idle-stand":      dict(src="(none)", synth=True, what="relaxed stand (round 6: arms hanging, the pose library's HAND_RELAXED, weight on the right leg, pelvis and shoulders answering, head level, arms cleared per body on its mesh) under a slow breathing and sway layer that is zero at t = 1.0 s (RELAXED_STAND is that frame); 8 s loop; the layer is procedural, not captured"),
    "move-stand-86":   dict(src="86_15", window=(0.0, 9.0), yaw_lock=True, swing_clear=0.012, heel_edge=0.015, toe_limit=10.0, trunk_match=True, head_pitch=12.0, what="MOVE_STAND: a slow walk (0.4 to 1.0 m/s) round a loop of about 1.2 m radius, turning through about 380 degrees in 9 s, captured (CMU 86_15, 0.0 to 9.0 s); the actor watched the floor (head 29 degrees down on average): the gaze is raised by a constant so the head's mean pitch is 12 degrees down, every head movement kept"),
}

# ======================================================================================================================
# 1. ASF/AMC reader (plain text; the files are untrusted data and are only ever parsed as numbers and names)
# ======================================================================================================================
class Source:
    """bones: name -> dict(dir (3,), length m, C quaternion of the ASF axis, dof list); parent: name -> name;
    D: name -> (F,4) world rotation away from the ASF zero pose; root: (F,3) m; chan: raw channels (degrees)."""
    def positions(self):
        """Joint positions: head[name] = where the bone starts, end[name] = where it ends, each (F,3)."""
        head, end = {"root": self.root}, {"root": self.root}
        for b in self.order:
            head[b] = end[self.parent[b]]; end[b] = head[b] + qrot(self.D[b], self.bones[b]["dir"] * self.bones[b]["length"])
        return head, end

def read_asf(path):
    bones, parent, order = {}, {}, []; sect = None; cur = None; scale = 1.0; deg = True
    for ln in open(path, errors="replace"):
        t = ln.split()
        if not t or t[0].startswith("#"): continue
        if t[0].startswith(":"): sect = t[0]; continue
        if sect == ":units":
            if t[0] == "length": scale = float(t[1])
            if t[0] == "angle": deg = t[1].lower().startswith("deg")
        elif sect == ":bonedata":
            if t[0] == "begin": cur = {"dof": []}
            elif t[0] == "end": bones[cur["name"]] = cur
            elif t[0] == "name": cur["name"] = t[1]
            elif t[0] == "direction": cur["dir"] = np.array([float(x) for x in t[1:4]])
            elif t[0] == "length": cur["length"] = float(t[1]) / scale * 0.0254
            elif t[0] == "axis": cur["C"] = qeuler_xyz(*[float(x) for x in t[1:4]])
            elif t[0] == "dof": cur["dof"] = t[1:]
        elif sect == ":hierarchy" and t[0] not in ("begin", "end"):
            for c in t[1:]: parent[c] = t[0]; order.append(c)
    assert deg, "ASF in radians: not handled"
    for b in bones.values(): b["dir"] = b["dir"] / max(np.linalg.norm(b["dir"]), 1e-12)
    return bones, parent, order, scale

def read_amc(path):
    frames = {}; n = 0
    for ln in open(path, errors="replace"):
        t = ln.split()
        if not t or t[0].startswith(("#", ":")): continue
        if len(t) == 1 and t[0].isdigit(): n += 1; continue
        if n: frames.setdefault(t[0], []).append([float(x) for x in t[1:]])
    return {k: np.array(v) for k, v in frames.items()}

def load_source(take):
    subj = take.split("_")[0]
    bones, parent, order, scale = read_asf(os.path.join(CMU, subj + ".asf")); ch = read_amc(os.path.join(CMU, take + ".amc"))
    s = Source(); s.bones, s.parent, s.order, s.fps, s.take, s.chan = bones, parent, order, SRC_FPS[subj], take, ch
    F = len(ch["root"]); s.root = ch["root"][:, :3] / scale * 0.0254
    D = {"root": qeuler_xyz(ch["root"][:, 3], ch["root"][:, 4], ch["root"][:, 5])}
    for b in order:
        a = {"rx": np.zeros(F), "ry": np.zeros(F), "rz": np.zeros(F)}
        for k, d in enumerate(bones[b]["dof"]):
            if b in ch: a[d] = ch[b][:, k]
        C = bones[b]["C"]; L = qmul(C, qmul(qeuler_xyz(a["rx"], a["ry"], a["rz"]), qinv(C)))
        D[b] = qmul(D[parent[b]], L)
    s.D = {k: qfix(qnorm(v)) for k, v in D.items()}
    return s

# ======================================================================================================================
# 2. Cleaning and resampling
# ======================================================================================================================
def clean(s, cutoff_hz=7.0):
    """Despike (short median) and low-pass (zero-phase Butterworth) the world rotations and the root path. Contacts are
    not protected here: they are rebuilt afterwards by the foot planting, from the source's own contact timing."""
    from scipy.signal import butter, filtfilt, medfilt
    k = 5 if s.fps >= 100 else 3; b, a = butter(2, cutoff_hz / (s.fps / 2))
    f = lambda x: filtfilt(b, a, np.stack([medfilt(x[:, i], k) for i in range(x.shape[1])], 1), axis=0)
    removed = {}
    for n in list(s.D):
        q = qnorm(f(s.D[n])); removed[n] = float(np.percentile(qangle(q, s.D[n]), 99)); s.D[n] = q
    r = f(s.root); removed["root_mm"] = float(np.percentile(np.linalg.norm(r - s.root, axis=1), 99) * 1000); s.root = r
    s.cleaned = removed
    return s

def resample(s, fps=FPS):
    F = len(s.root); T = (F - 1) / s.fps; t = np.arange(0, T + 1e-9, 1 / fps) * s.fps
    i0 = np.minimum(np.floor(t).astype(int), F - 2); u = t - i0
    s.D = {n: qfix(qslerp(q[i0], q[i0 + 1], u)) for n, q in s.D.items()}
    s.root = s.root[i0] * (1 - u[:, None]) + s.root[i0 + 1] * u[:, None]
    s.chan = {n: c[i0] * (1 - u[:, None]) + c[i0 + 1] * u[:, None] for n, c in s.chan.items() if n != "root"}
    s.fps = fps
    return s

def make_loop(s):
    """Find one walk cycle, close it (the pose difference between its ends is spread over the cycle) and tile it three
    times; the caller plants the feet on the three cycles and keeps the middle one."""
    keys = ["lfemur", "rfemur", "ltibia", "rtibia", "lhumerus", "rhumerus", "lradius", "rradius", "lowerback", "thorax"]
    rel = np.stack([qmul(qinv(s.D["root"]), s.D[k]) for k in keys], 1); F = len(s.root)
    vel = np.gradient(rel, axis=0)
    best = None
    for i in range(3, F - 24):
        for j in range(i + 24, min(F - 3, i + 45)):          # a cycle of 0.8 to 1.5 s
            c = (qangle(rel[i], rel[j]) ** 2).sum() + 400 * ((vel[i] - vel[j]) ** 2).sum() * 3000 + ((s.root[i, 1] - s.root[j, 1]) * 1000) ** 2
            if best is None or c < best[0]: best = (c, i, j)
    _, i, j = best; n = j - i; u = np.arange(n + 1) / n
    D = {}
    for k, q in s.D.items():
        fix = qmul(q[i], qinv(q[j])); D[k] = qmul(qslerp(np.broadcast_to(QI, (n + 1, 4)), np.broadcast_to(fix, (n + 1, 4)), u), q[i:j + 1])
    root = s.root[i:j + 1].copy(); stride = root[-1] - root[0]; root[:, 1] -= u * stride[1]; stride[1] = 0
    side = np.cross(UP, stride / np.linalg.norm(stride))   # take out the sideways sway mismatch too, keep the forward travel
    s.loop = dict(first=i, last=j, frames=n, stride=stride, velocity=stride / (n / s.fps))
    s.D = {k: qfix(np.concatenate([q[:-1], q[:-1], q])) for k, q in D.items()}
    s.root = np.concatenate([root[:-1], root[:-1] + stride, root + 2 * stride])
    s.chan = {k: np.concatenate([c[i:j], c[i:j], c[i:j + 1]]) for k, c in s.chan.items()}
    return s

def contacts(s):
    """Per foot and frame, from the source: 0 none, 1 heel only (heel strike), 2 ball only (heel off), 3 flat."""
    head, end = s.positions(); out = {}
    ank = {x: head[x + "foot"] for x in "lr"}; toe = {x: head[x + "toes"] for x in "lr"}
    a0 = np.percentile(np.concatenate([ank["l"][:, 1], ank["r"][:, 1]]), 3); t0 = np.percentile(np.concatenate([toe["l"][:, 1], toe["r"][:, 1]]), 3)
    def tidy(m):
        m = m.copy(); F = len(m)
        for i in range(1, F - 2):                           # close gaps of up to two frames
            if m[i - 1] and not m[i] and (m[i + 1] or m[i + 2]): m[i] = True
        i = 0
        while i < F:                                        # drop touches shorter than four frames
            if m[i]:
                j = i
                while j < F and m[j]: j += 1
                if j - i < 4: m[i:j] = False
                i = j
            else: i += 1
        return m
    for x in "lr":
        sp = lambda p: np.linalg.norm(np.gradient(p, axis=0), axis=1) * s.fps
        heel = tidy((ank[x][:, 1] < a0 + 0.025) & (sp(ank[x]) < 0.40)); ball = tidy((toe[x][:, 1] < t0 + 0.030) & (sp(toe[x]) < 0.40))
        out[x] = heel.astype(int) + 2 * ball.astype(int)
    s.ankle_floor = float(a0)
    return out

# ======================================================================================================================
# 3. The target body
# ======================================================================================================================
class Body:
    def __init__(self, names, parent, pos, rot, proxy=None, person="", source=""):
        self.names = list(names); self.parent = [int(p) for p in parent]; self.P0 = np.array(pos, float); self.Q0 = qnorm(np.array(rot, float))
        self.proxy = proxy; self.person = person; self.source = source; self.ix = {n: i for i, n in enumerate(self.names)}
    def __getitem__(self, n): return self.ix[n]
    def dir(self, a, b): d = self.P0[self.ix[b]] - self.P0[self.ix[a]]; return d / np.linalg.norm(d)
    def len(self, a, b): return float(np.linalg.norm(self.P0[self.ix[b]] - self.P0[self.ix[a]]))
    def local_rest(self):
        q = np.array([self.Q0[j] if p < 0 else qmul(qinv(self.Q0[p]), self.Q0[j]) for j, p in enumerate(self.parent)])
        t = np.array([self.P0[j] if p < 0 else qrot(qinv(self.Q0[p]), self.P0[j] - self.P0[p]) for j, p in enumerate(self.parent)])
        return t, q
    def signature(self):
        """Names, parents and rest joint frames (rotations to 3 decimals): what a baked clip depends on besides proportions."""
        _, q = self.local_rest(); q = np.where(q[:, 3:4] < 0, -q, q); spec = set(mo_bodies.spec()[0])
        rows = sorted((n, self.names[p] if p >= 0 else "", (np.round(q[j], 3) + 0.0).tolist()) for j, (n, p) in enumerate(zip(self.names, self.parent)) if n in spec)
        return hashlib.sha1(json.dumps(rows).encode()).hexdigest()[:16]             # joint order and extra helper joints do not matter

def load_standin(person):
    p = os.path.join(mo_bodies.OUT, person + ".json")
    if not os.path.exists(p): mo_bodies.build(person)
    d = json.load(open(p)); return Body(d["names"], d["parent"], d["pos"], d["rot"], d["proxy"], person, d["source"])

def read_glb_json(path):
    with open(path, "rb") as f:
        magic, ver, total = struct.unpack("<III", f.read(12)); n, typ = struct.unpack("<II", f.read(8)); js = json.loads(f.read(n))
        blob = b""
        if f.tell() < total: n2, _ = struct.unpack("<II", f.read(8)); blob = f.read(n2)
    return js, blob

def load_package(pkg_dir):
    """The base body of a FORMAT.md package: joint names, parents, rest world positions and rotations from its GLB skin."""
    man = [f for f in os.listdir(pkg_dir) if f.endswith(".avatar.json")]
    if not man: raise FileNotFoundError("no *.avatar.json in " + pkg_dir)
    m = json.load(open(os.path.join(pkg_dir, man[0]))); js, _ = read_glb_json(os.path.join(pkg_dir, m["glb"]))
    nodes = js["nodes"]; par = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []): par[c] = i
    joints = js["skins"][0]["joints"]; order = []; seen = set()
    def visit(i):
        if i in seen: return
        if par.get(i) in joints: visit(par[i])
        seen.add(i); order.append(i)
    for i in joints: visit(i)
    names = [nodes[i]["name"] for i in order]; parent = [order.index(par[i]) if par.get(i) in joints else -1 for i in order]
    P = np.zeros((len(order), 3)); Q = np.zeros((len(order), 4))
    for k, i in enumerate(order):
        t = np.array(nodes[i].get("translation", [0, 0, 0]), float); r = np.array(nodes[i].get("rotation", [0, 0, 0, 1]), float); p = parent[k]
        if p < 0: P[k], Q[k] = t, r
        else: P[k] = P[p] + qrot(Q[p], t); Q[k] = qmul(Q[p], r)
    return Body(names, parent, P, Q, None, m.get("name", ""), "package " + pkg_dir), m

def load_package_mesh(pkg_dir, man):
    """The body mesh of a package: rest vertices, triangles, 4 joints + weights, the dual-quaternion mask, morph deltas."""
    js, blob = read_glb_json(os.path.join(pkg_dir, man["glb"])); CT = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}; NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    def arr(i):
        a = js["accessors"][i]; bv = js["bufferViews"][a["bufferView"]]; n = NC[a["type"]]; dt = np.dtype(CT[a["componentType"]]); st = bv.get("byteStride") or dt.itemsize * n
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        raw = np.frombuffer(blob, np.uint8, st * (a["count"] - 1) + dt.itemsize * n, off)
        return np.lib.stride_tricks.as_strided(raw, (a["count"], dt.itemsize * n), (st, 1)).copy().view(dt).reshape(a["count"], n)
    me = next(m for m in js["meshes"] if m["name"] == "body"); pr = me["primitives"][0]; at = pr["attributes"]
    names = [js["nodes"][i]["name"] for i in js["skins"][0]["joints"]]; tn = (me.get("extras") or {}).get("targetNames", [])
    v = arr(at["POSITION"]).astype(float); morphs = {n: arr(t["POSITION"]).astype(float) for n, t in zip(tn, pr.get("targets", []))}
    bakes = man.get("shape", {}).get("bake"); bakes = [] if not bakes else (bakes if isinstance(bakes, list) else [bakes])
    for bk in bakes:                                          # FORMAT.md 2d (v0.4): the shape space lives in a file and is baked on the CPU
        if "body" not in bk.get("meshes", ["body"]): continue
        N, K = bk["vertices"], len(bk["targets"]); raw = open(os.path.join(pkg_dir, bk["file"]), "rb").read()
        base = np.frombuffer(raw, np.float32, N * 3, 0).reshape(N, 3).astype(float); tg = np.frombuffer(raw, np.int16, K * N * 3, N * 12).reshape(K, N, 3)
        conv = (lambda x: np.stack([x[..., 0], x[..., 2], -x[..., 1]], -1)) if bk.get("frame") == "blender" else (lambda x: x)
        src = np.rint(arr(at["_SRC"])[:, 0]).astype(int) if "_SRC" in at else np.arange(N)
        v = conv(base)[src] + np.array(bk.get("offset", [0, 0, 0]), float)
        for k, n in enumerate(bk["targets"]): morphs[n] = conv(tg[k].astype(float) / 32767.0 * bk["targetScale"][k])[src]
    return dict(v=v, tris=arr(pr["indices"]).reshape(-1, 3).astype(int), J=arr(at["JOINTS_0"]).astype(int), W=arr(at["WEIGHTS_0"]).astype(float),
                dqs=arr(at["_DQS"])[:, 0].astype(float) if "_DQS" in at else None, joint_names=names, morphs=morphs)

def shape_weights(man, values):
    """FORMAT.md: morph weight = clamp(bias + sum coef[i] * (control[i] - centre[i]) / scale[i], min, max)."""
    M = man["shape"]["model"]; ctl = {c["id"]: c.get("default", 0) for c in man["shape"]["controls"]}; ctl.update(values)
    x = np.array([(ctl[i] - c) / sc for i, c, sc in zip(M["inputs"], M.get("centre", [0] * len(M["inputs"])), M.get("scale", [1] * len(M["inputs"])))])
    return {t: float(np.clip(d.get("bias", 0) + np.dot(d["coef"], x), d.get("min", -3), d.get("max", 3))) for t, d in M["targets"].items()}

def package_person(pkg_dir, base, man, mesh, person):
    """A packet person on a real package: rest joints from the manifest's jointDeltas, the mesh from the morph targets,
    collision proxies measured on that mesh."""
    vals = (man.get("packet", {}).get("persons") or {}).get(person)
    if vals is None: raise KeyError(f"{person} is not in the manifest's packet.persons")
    w = shape_weights(man, vals); P = base.P0.copy(); v = mesh["v"].copy()
    for t, wt in w.items():
        for jn, d in man["shape"].get("jointDeltas", {}).get(t, {}).items(): P[base[jn]] += wt * np.array(d)
        if t in mesh["morphs"]: v += wt * mesh["morphs"][t]
    b = Body(base.names, base.parent, P, base.Q0, None, person, f"package {os.path.basename(pkg_dir)} person {person}")
    jmap = np.array([b[n] for n in mesh["joint_names"]]); dom = jmap[mesh["J"][np.arange(len(v)), mesh["W"].argmax(1)]]
    pos = {n: P[i] for n, i in b.ix.items()}
    b.proxy = mo_bodies.proxies(v, np.ones(len(v), bool), dom, b.ix, pos); b.v = v; b.mesh = mesh; b.dom = dom; b.jmap = jmap; b.drivers = man.get("drivers", [])
    # finger tips for grip checks: the far end of each last phalanx's vertices along the finger
    b.tips = {}
    for x in "lr":
        for f in mo_bodies.FINGERS:
            a, c = P[b[f"{f}_02_{x}"]], P[b[f"{f}_03_{x}"]]; d = (c - a) / np.linalg.norm(c - a); m = dom == b[f"{f}_03_{x}"]
            b.tips[f"{f}_tip_{x}"] = (c + d * (float(((v[m] - c) @ d).max()) - 0.004 if m.any() else 0.02)).tolist()
    return b

def drive(body, D):
    """The manifest's twist drivers as the viewer applies them each frame (viewer/src/main.ts drive(); round 6): a target joint's
    rotation relative to its parent becomes R(axis, fraction * twist of the source about the axis); the twist and helper joints
    (thigh / upper-arm / forearm / calf twist, glute, hip_belly, groin, knee_front, shoulder_front) then move the skin as on screen.
    D (J,4) world deltas of one frame -> a new D."""
    rel = np.array([D[j] if p < 0 else qmul(qinv(D[p]), D[j]) for j, p in enumerate(body.parent)])
    for d in body.drivers:
        if d.get("type") != "twist" or d["source"] not in body.ix: continue
        r = rel[body[d["source"]]]; r = r if r[3] >= 0 else -r; ax = np.array(d["axis"], float); ax /= np.linalg.norm(ax)
        ang = 2 * np.arctan2(r[:3] @ ax, r[3])
        for t in d["targets"]:
            if t["joint"] in body.ix and t.get("fraction"): rel[body[t["joint"]]] = qaxis(ax, ang * t["fraction"])
    out = np.zeros_like(D)
    for j, p in enumerate(body.parent): out[j] = rel[j] if p < 0 else qmul(out[p], rel[j])
    return out

def skin(body, D, P, idx=None):
    """Skin the person's mesh for one frame as the lab viewer does: linear blend and dual quaternion, mixed per vertex by
    the _DQS mask, after the manifest's twist drivers (round 6; before, twist and helper joints rode on their parents).
    D (J,4) world deltas, P (J,3) joint positions; idx selects vertices."""
    if getattr(body, "drivers", None): D = drive(body, D)
    me = body.mesh; idx = np.arange(len(body.v)) if idx is None else idx; v = body.v[idx]; J = body.jmap[me["J"][idx]]; W = me["W"][idx]; W = W / W.sum(1, keepdims=True)
    t = P - qrot(D, body.P0)                                           # v' = D v + t per joint
    lbs = np.einsum("nk,nkc->nc", W, qrot(D[J], v[:, None, :]) + t[J])
    if me["dqs"] is None: return lbs
    qr = D[J]; sgn = np.where((qr * qr[:, :1]).sum(-1, keepdims=True) < 0, -1.0, 1.0); qr = qr * sgn
    qd = 0.5 * qmul(np.concatenate([t[J], np.zeros(t[J].shape[:-1] + (1,))], -1), qr)
    br = np.einsum("nk,nkc->nc", W, qr); bd = np.einsum("nk,nkc->nc", W, qd); n = np.linalg.norm(br, axis=1, keepdims=True); br /= n; bd /= n
    tr = 2 * qmul(bd, qinv(br))[:, :3]; dq = qrot(br, v) + tr
    m = np.clip(me["dqs"][idx], 0, 1)[:, None]
    return lbs * (1 - m) + dq * m

def check_skeleton(body, reference_signature=None):
    """Returns a list of problems; empty means the body matches the skeleton specification (and the reference frames)."""
    names, parent = mo_bodies.spec(); bad = []
    miss = [n for n in names if n not in body.ix]; extra = [n for n in body.names if n not in names]
    if miss: bad.append(f"{len(miss)} joints of the specification are missing: {miss[:12]}{' ...' if len(miss) > 12 else ''}")
    check_skeleton.helpers = extra                           # joints beyond the 82 (RR's pose-driven helpers) are fine: no clip animates them
    low = {n.lower(): n for n in body.names}
    case = [f"{low[n]} (want {n})" for n in miss if n in low]
    if case: bad.append("same names in another letter case: " + ", ".join(case[:8]))
    for n, p in zip(names, parent):
        if n in body.ix and p >= 0 and names[p] in body.ix:
            bp = body.parent[body.ix[n]]; anc = bp
            while anc >= 0 and body.names[anc] not in names: anc = body.parent[anc]     # helpers in between are fine
            if anc < 0 or body.names[anc] != names[p]: bad.append(f"parent of {n} is {body.names[bp] if bp >= 0 else None}, specification says {names[p]}")
    if reference_signature and not miss and body.signature() != reference_signature:
        bad.append(f"rest joint frames differ from the ones the clips were baked on (signature {body.signature()} against {reference_signature}): rebuild the clips with `motion.py build`")
    return bad

# ======================================================================================================================
# 4. Retarget
# ======================================================================================================================
MAPPED = ["pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05", "neck_01", "neck_02", "head"] + \
         [f"{n}_{s}" for s in "lr" for n in ("clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot", "ball")]

def fk(body, D, pelvis, root=None):
    """World joint positions (F,J,3) from world deltas D (F,J,4) and the pelvis path (F,3)."""
    F = len(D); P = np.zeros((F, len(body.names), 3)); pv = body["pelvis"]
    for j, p in enumerate(body.parent):
        if j == pv: P[:, j] = pelvis
        elif p < 0: P[:, j] = 0 if root is None else root
        else: P[:, j] = P[:, p] + qrot(D[:, p], body.P0[j] - body.P0[p])
    return P

def followers(body, D, E=None):
    """Joints no source bone drives follow their parent, times a fixed relative delta E[name] (F,4) if given."""
    for j, p in enumerate(body.parent):
        n = body.names[j]
        if n in MAPPED: continue
        D[:, j] = QI if p < 0 else (qmul(D[:, p], E[n]) if E and n in E else D[:, p])
    return D

def hand_axes(body, s):
    """Flexion axes of the finger joints in rest world axes (positive angle curls toward the palm), palm normal, and the
    thumb's opposition axis. Geometry only, so it holds for any joint-frame convention."""
    g = lambda n: body.P0[body[f"{n}_{s}"]]
    n = np.cross(g("index_01") - g("hand"), g("pinky_01") - g("hand")); n /= np.linalg.norm(n)
    if n @ (g("thumb_03") - g("index_metacarpal")) < 0: n = -n            # palmar side: where the thumb sits
    ax = {}
    for f in ("index", "middle", "ring", "pinky"):
        for k in (1, 2, 3):
            a, b = g(f"{f}_0{k}"), (g(f"{f}_0{k + 1}") if k < 3 else g(f"{f}_03") + (g(f"{f}_03") - g(f"{f}_02")))
            d = (b - a) / np.linalg.norm(b - a); c = np.cross(d, n); ax[f"{f}_0{k}_{s}"] = c / np.linalg.norm(c)
    across = g("pinky_01") - g("index_01"); across /= np.linalg.norm(across)
    for k in (1, 2, 3):
        a, b = g(f"thumb_0{k}"), (g(f"thumb_0{k + 1}") if k < 3 else g("thumb_03") + (g("thumb_03") - g("thumb_02")))
        d = (b - a) / np.linalg.norm(b - a); c = np.cross(d, n * 0.6 + across * 0.8); ax[f"thumb_0{k}_{s}"] = c / np.linalg.norm(c)
    return ax, n

RELAXED = {"index": (25, 30, 15), "middle": (32, 37, 18), "ring": (38, 43, 22), "pinky": (45, 50, 25), "thumb": (10, 12, 10)}   # VD HAND_RELAXED

def retarget(body, s):
    """World-space retarget: every mapped target joint takes its source bone's world rotation away from the source rest
    pose, after a fixed offset O that brings the target's A-pose bone onto the source's T-pose bone."""
    F = len(s.root); J = len(body.names); D = np.tile(QI, (F, J, 1)); sd = lambda b: s.bones[b]["dir"]
    def put(n, q, O=None): D[:, body[n]] = q if O is None else qmul(q, np.broadcast_to(O, q.shape))
    put("pelvis", s.D["root"]); put("spine_01", s.D["lowerback"]); put("spine_03", s.D["upperback"]); put("spine_05", s.D["thorax"])
    put("spine_02", qslerp(s.D["lowerback"], s.D["upperback"], np.full(F, 0.5))); put("spine_04", qslerp(s.D["upperback"], s.D["thorax"], np.full(F, 0.5)))
    # the neck: CMU's split of one head rotation over lowerneck / upperneck / head is arbitrary and flips between frames
    # (measured: 150 degrees in one frame in 143_21 while the head itself moves 3); spread thorax -> head instead
    rel = qfix(qmul(qinv(s.D["thorax"]), s.D["head"])); mean = qnorm(rel.mean(0)); info = {}
    if qangle(mean, QI) > 45:         # a head solved upside-down (take 143_21: 175 degrees from the thorax all through): take the clip's mean out
        rel = qmul(rel, qinv(mean)[None]); info["head_offset_removed_deg"] = float(qangle(mean, QI))
    head = qmul(s.D["thorax"], rel)
    put("neck_01", qmul(s.D["thorax"], qslerp(np.broadcast_to(QI, rel.shape), rel, np.full(F, 0.3)))); put("neck_02", qmul(s.D["thorax"], qslerp(np.broadcast_to(QI, rel.shape), rel, np.full(F, 0.65)))); put("head", head)
    for x in "lr":
        put(f"clavicle_{x}", s.D[x + "clavicle"])
        Ou = qarc(body.dir(f"upperarm_{x}", f"lowerarm_{x}"), sd(x + "humerus"))
        Ol = qmul(qarc(qrot(Ou, body.dir(f"lowerarm_{x}", f"hand_{x}")), sd(x + "radius")), Ou)
        Oh = qmul(qarc(qrot(Ol, body.dir(f"hand_{x}", f"middle_01_{x}")), sd(x + "hand")), Ol)
        put(f"upperarm_{x}", s.D[x + "humerus"], Ou); put(f"lowerarm_{x}", s.D[x + "radius"], Ol); put(f"hand_{x}", s.D[x + "hand"], Oh)
        Ot = qarc(body.dir(f"thigh_{x}", f"calf_{x}"), sd(x + "femur"))
        Oc = qmul(qarc(qrot(Ot, body.dir(f"calf_{x}", f"foot_{x}")), sd(x + "tibia")), Ot)
        h = body.dir(f"foot_{x}", f"ball_{x}") * [1, 0, 1]                # the target's own toe-out is taken out:
        Of = qmul(qarc(-UP, sd(x + "femur")), qarc(h, [0, 0, 1.0]))       # flat when the source leg hangs straight down
        put(f"thigh_{x}", s.D[x + "femur"], Ot); put(f"calf_{x}", s.D[x + "tibia"], Oc); put(f"foot_{x}", s.D[x + "foot"], Of); put(f"ball_{x}", s.D[x + "toes"], Of)
        info[x] = dict(arm_offset_deg=float(qangle(Ou, QI)), elbow_straighten_deg=float(qangle(Ol, Ou)), leg_offset_deg=float(qangle(Ot, QI)))
    # pelvis path: the hip centre's travel and its height above the planted ankle scale with leg length
    head, _ = s.positions(); hc = (head["lfemur"] + head["rfemur"]) / 2
    Ls = sum(s.bones[b]["length"] for b in ("lfemur", "ltibia", "rfemur", "rtibia")) / 2
    Lt = (body.len("thigh_l", "calf_l") + body.len("calf_l", "foot_l") + body.len("thigh_r", "calf_r") + body.len("calf_r", "foot_r")) / 2
    k = Lt / Ls; a_src = np.percentile(np.concatenate([head["lfoot"][:, 1], head["rfoot"][:, 1]]), 3)
    a_tgt = (body.P0[body["foot_l"], 1] + body.P0[body["foot_r"], 1]) / 2
    hct = np.stack([hc[:, 0] * k, (hc[:, 1] - a_src) * k + a_tgt, hc[:, 2] * k], 1)
    c = (body.P0[body["thigh_l"]] + body.P0[body["thigh_r"]]) / 2 - body.P0[body["pelvis"]]
    pelvis = hct - qrot(D[:, body["pelvis"]], c)
    info.update(leg_scale=float(k), source_leg_m=float(Ls), target_leg_m=float(Lt))
    return D, pelvis, info

def fingers(body, s):
    """No finger data in CMU: the designer's relaxed hand as joint angles, moved a little by the source's one 'fingers'
    channel so the hands are not frozen. Returns relative deltas E[name] (F,4)."""
    F = len(s.root); E = {}
    for x in "lr":
        ax, _ = hand_axes(body, x); c = s.chan.get(x + "fingers"); c = np.zeros(F) if c is None else c[:, 0]
        wob = np.clip((c - np.median(c)) * 0.6, -12, 25)                     # degrees
        tt = np.arange(F) / FPS; ph = 0.0 if x == "l" else 1.7
        w = qangle(s.D[x + "hand"][1:], s.D[x + "hand"][:-1]) * FPS; w = smooth(np.concatenate([w[:1], w]), 6.0)     # the hand opens a little when it moves fast
        wob = wob + np.clip(w / 40.0, 0, 6) * -1.0
        for f, ang in RELAXED.items():
            for k in (1, 2, 3):
                fi = list(RELAXED).index(f); life = 3.0 * np.sin(tt * 2 * np.pi * (0.13 + 0.031 * fi) + ph + fi) + 1.8 * np.sin(tt * 2 * np.pi * (0.41 + 0.07 * fi) + 2.1 * fi + ph)
                a = ang[k - 1] + (0.5 if f == "thumb" else 1.0) * (wob + life) * (1.0 if k < 3 else 0.4)
                E[f"{f}_0{k}_{x}"] = qaxis(ax[f"{f}_0{k}_{x}"], np.radians(a))
    return E

def two_bone(a, goal, hint, l1, l2):
    """Analytic two-bone IK. a: root joint, goal: end joint, hint: a point on the side the middle joint bends to.
    Returns the middle and end positions (the end is pulled in if the goal is out of reach)."""
    d = goal - a; dist = np.maximum(np.linalg.norm(d, axis=-1, keepdims=True), 1e-9); n = d / dist
    dc = np.clip(dist, abs(l1 - l2) + 1e-4, (l1 + l2) * 0.9995)
    x = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc); h = np.sqrt(np.maximum(l1 * l1 - x * x, 0))
    ph = hint - a; ph = ph - n * (ph * n).sum(-1, keepdims=True); ph = ph / np.maximum(np.linalg.norm(ph, axis=-1, keepdims=True), 1e-9)
    return a + n * x + ph * h, a + n * dc

def straight(a, m, c, full=0.05):
    """1 where the middle joint m lies on the line a-c (a straight limb), falling to 0 once it stands `full` metres off it."""
    u = c - a; u = u / np.maximum(np.linalg.norm(u, axis=-1, keepdims=True), 1e-9); d = m - a; off = np.linalg.norm(d - u * (d * u).sum(-1, keepdims=True), axis=-1)
    return np.clip(1 - off / full, 0, 1)

def apply_two_bone(body, D, P, j1, j2, j3, mid, end):
    """Rotate joints j1 (upper) and j2 (lower) so that j2 sits at `mid` and j3 at `end`; j3 keeps its world rotation."""
    R1 = qarc(P[:, j2] - P[:, j1], mid - P[:, j1]); R2 = qarc(qrot(R1, P[:, j3] - P[:, j2]), end - mid)
    D[:, j1] = qmul(R1, D[:, j1]); D[:, j2] = qmul(R2, qmul(R1, D[:, j2]))

def smooth(x, sigma):
    from scipy.ndimage import gaussian_filter1d
    return gaussian_filter1d(x, sigma, axis=0, mode="nearest")

# ---- feet ------------------------------------------------------------------------------------------------------------
def foot_points(body, x):
    ft, ba = body[f"foot_{x}"], body[f"ball_{x}"]; back = (body.proxy or {}).get("limbs", {}).get(f"foot_{x}", {}).get("heel_back", 0.06)
    return {"ball": body.P0[ba] - body.P0[ft], "heel": np.array([0.0, -body.P0[ft][1], -0.5 * back])}, {"ball": float(body.P0[ba][1]), "heel": 0.0}

def toe_len(body, x):
    return (body.proxy or {}).get("limbs", {}).get(f"foot_{x}", {}).get("toe_front", 0.18) - (body.P0[body[f"ball_{x}"]][2] - body.P0[body[f"foot_{x}"]][2])

def lock_yaw(D, ft, ba, c):
    """A foot on the ground keeps its heading (round 6, for turning walks): through every run of contact frames the foot's
    yaw is held at the run's middle value; between runs the correction eases from one run's to the next's (smoothstep)."""
    f = qrot(D[:, ft], [0, 0, 1.0]); yaw = np.unwrap(np.arctan2(f[:, 0], f[:, 2])); F = len(c); on = c > 0
    runs = []; t = 0
    while t < F:
        if on[t]:
            j = t
            while j < F and on[j]: j += 1
            runs.append((t, j)); t = j
        else: t += 1
    if not runs: return D
    delta = np.full(F, np.nan)
    for i, j in runs: delta[i:j] = yaw[(i + j - 1) // 2] - yaw[i:j]
    t = 0
    while t < F:
        if np.isnan(delta[t]):
            j = t
            while j < F and np.isnan(delta[j]): j += 1
            a = delta[t - 1] if t > 0 else delta[j]; b = delta[j] if j < F else a; u = (np.arange(j - t) + 1) / (j - t + 1); e = u * u * (3 - 2 * u)
            delta[t:j] = (1 - e) * a + e * b; t = j
        else: t += 1
    R = qaxis(np.broadcast_to(UP, (F, 3)), delta); D[:, ft] = qmul(R, D[:, ft]); D[:, ba] = qmul(R, D[:, ba])
    return D

def plant(body, D, pelvis, con, yaw_lock=False, swing_clear=0.0, heel_edge=None, shoe_margin=None, level_roll=False):
    """Re-plant the feet where the source foot is on the ground. A planted foot pivots about a locked point: the heel
    while only the heel is down, the ball from foot-flat to toe-off; flat phases level the sole. The ankle then follows
    by two-bone IK with the knee kept in the retargeted direction, and the pelvis drops where a leg would over-stretch.
    Options (round 6, MOVE_STAND): yaw_lock holds a grounded foot's heading (no swivel about the ball while turning);
    swing_clear (m) lifts a swinging foot whose heel or ball would skim the floor, by up to that much at mid-swing."""
    from scipy.ndimage import maximum_filter1d
    F = len(D); P = fk(body, D, pelvis); goals = {}
    for x in "lr":
        ft = body[f"foot_{x}"]; off, hgt = foot_points(body, x); c = con[x]
        if heel_edge is not None:                           # round 7: a heel strikes on its back edge (a shoe's heel included): that edge is the pivot
            off = dict(off, heel=np.array([0.0, -body.P0[ft][1], -(body.proxy or {}).get("limbs", {}).get(f"foot_{x}", {}).get("heel_back", 0.06) - heel_edge]))
        w = smooth((c == 3).astype(float), 1.5)[:, None][:, 0]
        Df = D[:, ft]; D[:, ft] = qslerp(Df, qmul(qarc(qrot(Df, UP), UP), Df), w); D[:, body[f"ball_{x}"]] = qslerp(D[:, body[f"ball_{x}"]], D[:, ft], w)
        if yaw_lock: D = lock_yaw(D, ft, body[f"ball_{x}"], c)
        if heel_edge is not None or level_roll:             # a foot on the ground does not roll onto its edge (a shoe's sole edge went 4-6 mm into the floor)
            wr = smooth((c > 0).astype(float), 1.5); fw = qrot(D[:, ft], [0, 0, 1.0]); lat = qrot(D[:, ft], [1.0, 0, 0])
            roll = np.arcsin(np.clip((lat * UP).sum(1), -1, 1)); R = qaxis(fw, -roll * wr)
            D[:, ft] = qmul(R, D[:, ft]); D[:, body[f"ball_{x}"]] = qmul(R, D[:, body[f"ball_{x}"]])
        Df = D[:, ft]; A = P[:, ft]; corr = np.full((F, 3), np.nan); kind_prev = None; anchor = None
        for t in range(F):
            kind = "ball" if c[t] >= 2 else "heel" if c[t] == 1 else None
            if kind:
                o = qrot(Df[t], off[kind])
                if kind != kind_prev:
                    carry = corr[t - 1] if (kind_prev and t > 0) else 0.0          # continuous across heel -> ball
                    anchor = A[t] + carry + o; anchor[1] = hgt[kind]
                corr[t] = anchor - o - A[t]
            kind_prev = kind
        # swing: ease from the last planted correction to the next one (or to zero at the clip's ends)
        t = 0
        while t < F:
            if np.isnan(corr[t, 0]):
                j = t
                while j < F and np.isnan(corr[j, 0]): j += 1
                a = corr[t - 1] if t > 0 else (corr[j] if j < F else np.zeros(3)); b = corr[j] if j < F else a
                n = j - t; u = (np.arange(n) + 1) / (n + 1); e = u * u * (3 - 2 * u)
                if n > 24:                                  # long air time: let go, then come in over the last 8 frames
                    wa = np.clip(1 - (np.arange(n) + 1) / 9, 0, 1); wb = np.clip(1 - (n - np.arange(n)) / 9, 0, 1)
                    wa = wa * wa * (3 - 2 * wa); wb = wb * wb * (3 - 2 * wb); corr[t:j] = wa[:, None] * a + wb[:, None] * b
                else: corr[t:j] = (1 - e)[:, None] * a + e[:, None] * b
                t = j
            else: t += 1
        g = A + corr
        bump = np.zeros(F)
        if swing_clear:                                     # a swinging foot clears the floor by up to swing_clear at mid-swing
            t = 0
            while t < F:
                if c[t] == 0:
                    j = t
                    while j < F and c[j] == 0: j += 1
                    bump[t:j] = swing_clear * np.sqrt(np.sin(np.pi * (np.arange(j - t) + 1) / (j - t + 1))); t = j
                else: t += 1
        low = np.minimum(g[:, 1] + qrot(Df, off["heel"])[:, 1] - hgt["heel"], g[:, 1] + qrot(Df, off["ball"])[:, 1] - hgt["ball"]) - bump
        edge = heel_edge if heel_edge is not None else shoe_margin
        if edge is not None:                                # the back edge of the heel (and of a shoe's heel, `edge` further back) stays out of the floor at heel strike
            hb = np.array([0.0, -body.P0[ft][1], -(body.proxy or {}).get("limbs", {}).get(f"foot_{x}", {}).get("heel_back", 0.06) - edge])
            low = np.minimum(low, g[:, 1] + qrot(Df, hb)[:, 1])
        g[:, 1] -= np.minimum(low, 0)                       # never under the floor, planted or not (and clear of it in swing)
        goals[x] = g
        ba = body[f"ball_{x}"]; toe = np.array([0.0, 0.0, max(toe_len(body, x), 0.02)])     # toes never dig in either:
        by = g[:, 1] + qrot(Df, off["ball"])[:, 1]; dig = (0.5 * body.P0[ba][1] - by) - qrot(D[:, ba], toe)[:, 1]   # > 0: the tip is under the floor
        wt = smooth(np.clip(maximum_filter1d(dig, 9, mode="nearest") / 0.012 + 0.6, 0, 1), 2.5)       # then they lie level with the floor
        D[:, ba] = qslerp(D[:, ba], qmul(qarc(qrot(Df, UP), UP), Df), wt)
    # pelvis drop where a goal is out of reach
    drop = np.zeros(F)
    for x in "lr":
        th = body[f"thigh_{x}"]; L = (body.len(f"thigh_{x}", f"calf_{x}") + body.len(f"calf_{x}", f"foot_{x}")) * 0.997
        d = goals[x] - P[:, th]; hd2 = d[:, 0] ** 2 + d[:, 2] ** 2; over = np.linalg.norm(d, axis=1) > L
        need = -d[:, 1] - np.sqrt(np.maximum(L * L - hd2, 0))                  # how far the hip must come down
        drop = np.maximum(drop, np.where(over, np.maximum(need, 0), 0))
    if drop.max() > 0:
        drop = np.maximum(smooth(maximum_filter1d(drop, 9, mode="nearest"), 3.0), drop); pelvis = pelvis - drop[:, None] * UP; P = fk(body, D, pelvis)
    for x in "lr":
        th, ca, ft = body[f"thigh_{x}"], body[f"calf_{x}"], body[f"foot_{x}"]
        # the knee's side: where the retarget put it, plus the thigh's own "knee forward" (a straight source leg leaves the first
        # undefined: measured as a 48 degree flip in one frame in rom-a)
        h0, k0, a0 = body.P0[th], body.P0[ca], body.P0[ft]; u0 = (a0 - h0) / np.linalg.norm(a0 - h0); kf = k0 - (h0 + u0 * ((k0 - h0) @ u0))
        kf = np.array([0.0, 0.0, 1.0]) if np.linalg.norm(kf) < 1e-4 else kf / np.linalg.norm(kf)
        hint = P[:, ca] + straight(P[:, th], P[:, ca], goals[x])[:, None] * 0.3 * qrot(D[:, th], kf)     # only while the leg is near straight
        mid, end = two_bone(P[:, th], goals[x], hint, body.len(f"thigh_{x}", f"calf_{x}"), body.len(f"calf_{x}", f"foot_{x}"))
        apply_two_bone(body, D, P, th, ca, ft, mid, end)
    return D, pelvis, dict(pelvis_drop_max_mm=float(drop.max() * 1000))

# ---- arms against the body's own volume -----------------------------------------------------------------------------
def proxy_push(body, D, P, p, r):
    """Deepest penetration of a sphere (centre p (F,3), radius r) into the torso sections and the thighs: (depth (F,), push (F,3))."""
    F = len(p); depth = np.zeros(F); push = np.zeros((F, 3))
    for seg in body.proxy["torso"]:
        j = body[seg["joint"]]; S = np.array(seg["slices"]); loc = qrot(qinv(D[:, j]), p - P[:, j])
        y = loc[:, 1]; ok = (y > S[0, 0] - 0.012) & (y < S[-1, 0] + 0.012)
        cz = np.interp(y, S[:, 0], S[:, 1]); a = np.interp(y, S[:, 0], S[:, 2]) + r; b = np.interp(y, S[:, 0], S[:, 3]) + r
        kx = loc[:, 0] / a; kz = (loc[:, 2] - cz) / b; k = np.sqrt(kx * kx + kz * kz); g = np.stack([kx / a, np.zeros(F), kz / b], 1)
        gn = np.maximum(np.linalg.norm(g, axis=1), 1e-9); d = np.where(ok & (k < 1), (1 - k) * np.maximum(k, 0.05) / gn, 0); d = np.minimum(d, np.minimum(a, b))
        better = d > depth; depth = np.where(better, d, depth); push = np.where(better[:, None], qrot(D[:, j], g / gn[:, None]) * d[:, None], push)
    for x in "lr":
        A, B = P[:, body[f"thigh_{x}"]], P[:, body[f"calf_{x}"]]; R = body.proxy["limbs"][f"thigh_{x}"]; ab = B - A; L2 = (ab * ab).sum(1)
        t = np.clip(((p - A) * ab).sum(1) / L2, 0, 1); c = A + ab * t[:, None]; rad = np.interp(t, [0.25, 0.6, 0.95], R) + r
        v = p - c; dist = np.maximum(np.linalg.norm(v, axis=1), 1e-9); d = np.maximum(rad - dist, 0)
        better = d > depth; depth = np.where(better, d, depth); push = np.where(better[:, None], v / dist[:, None] * d[:, None], push)
    # (a head sphere was tried in round 4 and not kept: the package was rebuilt under the test at the same moment, so its effect
    #  was never separated from that. Hands at the face are not cleared.)
    return depth, push

def arm_spheres(body, D, P, x):
    R = body.proxy["limbs"]; la, ha = body[f"lowerarm_{x}"], body[f"hand_{x}"]; rl = R[f"lowerarm_{x}"]
    palm = P[:, ha] + qrot(D[:, ha], 0.6 * (body.P0[body[f"middle_01_{x}"]] - body.P0[ha]))
    out = {"elbow": (P[:, la], rl[0] * 0.9), "forearm": ((P[:, la] + P[:, ha]) / 2, rl[1] * 0.9), "wrist": (P[:, ha], rl[2] * 0.9), "palm": (palm, R[f"hand_{x}"][0])}
    for f in ("thumb", "index", "middle", "pinky"):           # a hand resting in the lap digs in with its fingers first
        j = body[f"{f}_03_{x}"]; out["tip_" + f] = (P[:, j] + qrot(D[:, j], 0.6 * (body.P0[j] - body.P0[body[f"{f}_02_{x}"]])), 0.011)
        k = body[f"{f}_02_{x}"]; out["mid_" + f] = (P[:, k], 0.012)
    return out

def arm_penetration(body, D, pelvis):
    """Max depth in mm per frame of either arm's spheres inside the torso or thigh proxies."""
    P = fk(body, D, pelvis); out = np.zeros(len(D))
    for x in "lr":
        for p, r in arm_spheres(body, D, P, x).values(): out = np.maximum(out, proxy_push(body, D, P, p, r)[0])
    return out * 1000

def clear_arms(body, D, pelvis, rounds=7):
    """Push wrists and elbows out of the body's own volume (a heavier body needs the arms further out), smoothly in time,
    and re-solve the arm by two-bone IK. The hand keeps its world orientation."""
    from scipy.ndimage import maximum_filter1d
    for x in "lr":
        ua, la, ha = body[f"upperarm_{x}"], body[f"lowerarm_{x}"], body[f"hand_{x}"]
        l1, l2 = body.len(f"upperarm_{x}", f"lowerarm_{x}"), body.len(f"lowerarm_{x}", f"hand_{x}")
        for _ in range(rounds):
            P = fk(body, D, pelvis); sp = arm_spheres(body, D, P, x); psh = {k: proxy_push(body, D, P, p, r + 0.002) for k, (p, r) in sp.items()}
            if max(v[0].max() for v in psh.values()) < 0.0015: break
            hand = [k for k in psh if k in ("wrist", "palm") or k.startswith(("tip_", "mid_"))]; dep = np.stack([psh[k][0] for k in hand]); best = dep.argmax(0)
            w = np.stack([psh[k][1] for k in hand])[best, np.arange(len(best))] + 0.5 * psh["forearm"][1] + 0.6 * psh["elbow"][1]
            e = psh["elbow"][1] + 0.5 * psh["forearm"][1]
            def ease(v):                                    # widen each push by 3 frames either side, then smooth: no pops
                m = np.linalg.norm(v, axis=1); mm = maximum_filter1d(m, 7, mode="nearest"); d = smooth(v, 2.0); dn = np.maximum(np.linalg.norm(d, axis=1), 1e-9)
                return d / dn[:, None] * smooth(mm, 2.0)[:, None] * (dn > 1e-7)[:, None]
            w, e = ease(w), ease(e)
            s0, e0, w0 = body.P0[ua], body.P0[la], body.P0[ha]; u0 = (w0 - s0) / np.linalg.norm(w0 - s0); ef = e0 - (s0 + u0 * ((e0 - s0) @ u0)); ef = ef / max(np.linalg.norm(ef), 1e-9)
            mid, end = two_bone(P[:, ua], P[:, ha] + w, P[:, la] + e + 0.5 * w + straight(P[:, ua], P[:, la], P[:, ha] + w)[:, None] * 0.1 * qrot(D[:, ua], ef), l1, l2)   # the upper arm's own elbow side steadies a straight arm
            apply_two_bone(body, D, P, ua, la, ha, mid, end)
    return D

def depop(body, D, limit=12.0, only=None):
    """Source pops (a solver flipping between two answers in one frame) on joints that carry no contact: where a joint's
    rotation relative to its parent steps more than `limit` degrees in a frame, the neighbourhood is replaced by a smoothed
    copy, eased in and out. Legs are left alone (their feet are planted)."""
    from scipy.ndimage import maximum_filter1d
    fixed = {}
    for n in MAPPED:
        if (n.split("_")[0] in ("thigh", "calf", "foot", "ball", "pelvis")) if only is None else (n.split("_")[0] not in only): continue
        j = body[n]; p = body.parent[j]; rel = qfix(qmul(qinv(D[:, p]), D[:, j]))
        for _ in range(3):
            st = qangle(rel[1:], rel[:-1]); bad = np.concatenate([[0.0], (st > limit).astype(float)])
            if not bad.any(): break
            w = smooth(maximum_filter1d(bad, 9, mode="nearest"), 2.5)[:, None]; w = np.clip(w * 1.6, 0, 1)
            rel = qnorm(rel * (1 - w) + qnorm(smooth(rel, 3.5)) * w); fixed[n] = fixed.get(n, 0) + int(bad.sum())
        D[:, j] = qmul(D[:, p], rel)
        for c in range(len(body.names)):                      # children keep their world rotation (their own relative rotation is checked in turn)
            pass
    return D, fixed

def forearm_twist(body, D, E):
    """The recorded wrist twist, spread onto the forearm twist joints by their place along the forearm (what the
    viewer's twist driver also does at run time; baked so a clip is right without the driver)."""
    for x in "lr":
        la, ha = body[f"lowerarm_{x}"], body[f"hand_{x}"]; a = body.dir(f"lowerarm_{x}", f"hand_{x}")
        rel = qmul(qinv(D[:, la]), D[:, ha]); rel = np.where(rel[:, 3:4] < 0, -rel, rel)
        ang = 2 * np.arctan2(rel[:, :3] @ a, rel[:, 3]); L = body.len(f"lowerarm_{x}", f"hand_{x}")
        for k in (1, 2):
            n = f"lowerarm_twist_0{k}_{x}"; E[n] = qaxis(a, ang * body.len(f"lowerarm_{x}", n) / L)
    return E

# ======================================================================================================================
# 5. Export and measurement
# ======================================================================================================================
def to_local(body, D, pelvis, root=None):
    F = len(D); q = np.zeros_like(D)
    for j, p in enumerate(body.parent):
        q[:, j] = qmul(D[:, j], body.Q0[j]) if p < 0 else qmul(qinv(body.Q0[p]), qmul(qmul(qinv(D[:, p]), D[:, j]), body.Q0[j]))
    q = qfix(qnorm(q)); pv = body["pelvis"]; pp = body.parent[pv]
    r = np.zeros((F, 3)) if root is None else root
    tp = qrot(qinv(body.Q0[pp]), pelvis - r - body.P0[pp]) if pp >= 0 else pelvis
    return q, tp

def write_clip(path, body, name, q, pelvis_local, root=None, extras=None, skip=()):
    """An animation-only GLB on the body's joints: rotation tracks, translation on the pelvis (and the root if it moves)."""
    t0, q0 = body.local_rest(); F = len(q); nodes = []; blob = bytearray(); views = []; accs = []
    for j, n in enumerate(body.names):
        nd = {"name": n, "translation": t0[j].tolist(), "rotation": q0[j].tolist()}; ch = [i for i, p in enumerate(body.parent) if p == j]
        if ch: nd["children"] = ch
        nodes.append(nd)
    def acc(a, typ, mm=False):
        a = np.ascontiguousarray(a, dtype=np.float32); views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": a.nbytes}); blob.extend(a.tobytes())
        d = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(a), "type": typ}
        if mm: d["min"] = [float(a.min())]; d["max"] = [float(a.max())]
        accs.append(d); return len(accs) - 1
    tin = acc(np.arange(F) / FPS, "SCALAR", True); samplers = []; channels = []
    def track(j, path_, a, typ):
        samplers.append({"input": tin, "output": acc(a, typ), "interpolation": "LINEAR"}); channels.append({"sampler": len(samplers) - 1, "target": {"node": j, "path": path_}})
    for j, n in enumerate(body.names):
        if n in skip or body.parent[j] < 0: continue
        if np.abs(q[:, j] - q0[j]).max() > 1e-6 or n in MAPPED: track(j, "rotation", q[:, j], "VEC4")
    track(body["pelvis"], "translation", pelvis_local, "VEC3")
    if root is not None: track(body["root"], "translation", root + t0[body["root"]], "VEC3")
    g = {"asset": {"version": "2.0", "generator": "synergon avatar-lab pipeline/motion.py", "extras": extras or {}}, "scene": 0,
         "scenes": [{"nodes": [i for i, p in enumerate(body.parent) if p < 0]}], "nodes": nodes,
         "animations": [{"name": name, "samplers": samplers, "channels": channels}], "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accs}
    js = json.dumps(g, separators=(",", ":")).encode(); js += b" " * ((-len(js)) % 4); blob += b"\0" * ((-len(blob)) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(blob))); f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)

def read_clip(path, body):
    """Back from the file: world deltas D (F,J,4), pelvis path and root path, by forward kinematics on `body`."""
    js, blob = read_glb_json(path); an = js["animations"][0]; t0, q0 = body.local_rest()
    def arr(i):
        a = js["accessors"][i]; v = js["bufferViews"][a["bufferView"]]; n = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
        return np.frombuffer(blob, np.float32, a["count"] * n, v["byteOffset"]).reshape(a["count"], n).astype(float)
    F = js["accessors"][an["samplers"][0]["input"]]["count"]; q = np.tile(q0, (F, 1, 1)); tp = np.tile(t0[body["pelvis"]], (F, 1)); root = np.zeros((F, 3))
    for c in an["channels"]:
        j = body[js["nodes"][c["target"]["node"]]["name"]]; a = arr(an["samplers"][c["sampler"]]["output"])
        if c["target"]["path"] == "rotation": q[:, j] = qnorm(a)
        elif j == body["pelvis"]: tp = a
        else: root = a - t0[j]
    return world_from_local(body, q, tp, root)

def world_from_local(body, q, tp, root=None, leg_scale=1.0, t_ref=None):
    """World deltas and pelvis path from local rotations (as a viewer would): Qw[j] = Qw[parent] * q[j], D = Qw * inv(Q0).
    leg_scale and t_ref reproduce the lab viewer's rule for a clip baked on another body: the pelvis offset from the
    authoring body's rest translation, scaled by leg length, added to this body's rest translation."""
    F = len(q); Qw = np.zeros_like(q); t0, _ = body.local_rest(); pv = body["pelvis"]
    for j, p in enumerate(body.parent): Qw[:, j] = q[:, j] if p < 0 else qmul(Qw[:, p], q[:, j])
    D = qmul(Qw, qinv(body.Q0)[None]); pp = body.parent[pv]; r = np.zeros((F, 3)) if root is None else root
    if t_ref is not None: tp = (tp - t_ref) * leg_scale + t0[pv]; r = r * leg_scale
    pelvis = r + body.P0[pp] + qrot(Qw[:, pp], tp)
    return D, pelvis, r

def measure(body, D, pelvis, con, q_local=None):
    """The designer's numbers for one clip on one body, measured on the pose as a viewer would play it."""
    P = fk(body, D, pelvis); m = {}; slide = 0.0; lift = 0.0; pen = 0.0; slides = []
    for x in "lr":
        ft = body[f"foot_{x}"]; off, hgt = foot_points(body, x); c = con[x]
        pts = {k: P[:, ft] + qrot(D[:, ft], o) for k, o in off.items()}
        tip = P[:, body[f"ball_{x}"]] + qrot(D[:, body[f"ball_{x}"]], [0, 0, max(toe_len(body, x), 0.02)])
        pen = max(pen, float(-(pts["heel"][:, 1] - hgt["heel"]).min()), float(-(pts["ball"][:, 1] - hgt["ball"]).min()), float(-(tip[:, 1] - 0.0).min() if True else 0))
        kind = np.where(c >= 2, 2, np.where(c == 1, 1, 0)); t = 0; F = len(c)
        while t < F:
            if kind[t]:
                j = t
                while j < F and kind[j] == kind[t]: j += 1
                p = pts["ball" if kind[t] == 2 else "heel"][t:j]; h = hgt["ball" if kind[t] == 2 else "heel"]
                d = float(np.linalg.norm((p - p[0])[:, [0, 2]], axis=1).max()); slides.append(d); slide = max(slide, d); lift = max(lift, float(np.abs(p[:, 1] - h).max()))
                t = j
            else: t += 1
    m["foot_slide_max_mm"] = round(slide * 1000, 1); m["foot_slide_mean_mm"] = round(float(np.mean(slides)) * 1000, 1) if slides else 0.0
    m["planted_height_error_max_mm"] = round(lift * 1000, 1); m["floor_penetration_max_mm"] = round(max(pen, 0) * 1000, 1)
    if body.proxy: ap = arm_penetration(body, D, pelvis); m["arm_into_body_max_mm"] = round(float(ap.max()), 1); m["arm_into_body_frames_over_5mm"] = int((ap > 5).sum())
    if q_local is not None:
        main = [j for j, n in enumerate(body.names) if n in MAPPED]
        st = qangle(q_local[1:, main], q_local[:-1, main]); m["joint_change_max_deg_per_frame"] = round(float(st.max()), 1)
        j, f = np.unravel_index(st.T.argmax(), st.T.shape); m["joint_change_where"] = f"{body.names[main[j]]} at {f / FPS:.2f} s"
    return m

# ======================================================================================================================
# 6. Build
# ======================================================================================================================
_src_cache = {}
def source_for(clip):
    o = CLIPS[clip]; key = (o["src"], bool(o.get("loop")), o.get("window"))
    if key not in _src_cache:
        s = resample(clean(load_source(o["src"])))           # the whole take is cleaned, then cut (no filter edge inside the window)
        if o.get("window"):
            a, b = int(round(o["window"][0] * FPS)), int(round(o["window"][1] * FPS)) + 1
            s.D = {k: q[a:b].copy() for k, q in s.D.items()}; s.root = s.root[a:b].copy(); s.chan = {k: c[a:b].copy() for k, c in s.chan.items()}
        if o.get("loop"): s = make_loop(s)
        s.con = contacts(s); _src_cache[key] = s
    return _src_cache[key]

def toes_up(body, D, pelvis, min_deg=1.0):
    """Round 6: while the ball of a foot is near the floor (within 25 mm of its planted height) the toes point at least min_deg up from
    horizontal, eased in time, so a shoe's toe box (longer than the bare toes the planter checks) stays out of the floor."""
    from scipy.ndimage import maximum_filter1d
    P = fk(body, D, pelvis)
    for x in "lr":
        ba = body[f"ball_{x}"]; f = qrot(D[:, ba], [0, 0, 1.0]); pitch = np.degrees(np.arcsin(np.clip(f[:, 1], -1, 1)))
        down = np.abs(P[:, ba, 1] - body.P0[ba][1]) < 0.025; need = np.where(down, np.maximum(min_deg - pitch, 0), 0)     # near the floor (a shoe's sole is under the toes)
        need = smooth(maximum_filter1d(need, 5, mode="nearest"), 1.5)
        side = np.cross(f, UP); side /= np.maximum(np.linalg.norm(side, axis=1, keepdims=True), 1e-9)
        D[:, ba] = qmul(qaxis(side, np.radians(need)), D[:, ba])        # rotating about f x up lifts the toe tip
    return D

def match_trunk(body, s, D, pelvis):
    """Round 7: the trunk line (hip centre to the base of the neck) leans as the source's does on average. The delta retarget leaned
    the walk 6 degrees further forward than the actor (86_15: 4.7 against 10.7 degrees), which read as a stoop in the side views;
    the difference is taken out as one constant extension of everything above the pelvis, about the pelvis's own side axis."""
    head, _ = s.positions(); hs = (head["lfemur"] + head["rfemur"]) / 2; vs = head["lowerneck"] - hs
    src = float(np.degrees(np.arccos(np.clip(vs[:, 1] / np.linalg.norm(vs, axis=1), -1, 1))).mean())
    P = fk(body, D, pelvis); hc = (P[:, body["thigh_l"]] + P[:, body["thigh_r"]]) / 2; vt = P[:, body["neck_01"]] - hc
    tgt = float(np.degrees(np.arccos(np.clip(vt[:, 1] / np.linalg.norm(vt, axis=1), -1, 1))).mean()); d = tgt - src
    if d <= 0: return D, 0.0
    sub = set(); j0 = body["spine_01"]
    for j in range(len(body.names)):
        k = j
        while k >= 0 and k != j0: k = body.parent[k]
        if k == j0: sub.add(j)
    R = qaxis(qrot(D[:, body["pelvis"]], [1.0, 0, 0]), np.full(len(D), np.radians(-d)))
    for j in sub: D[:, j] = qmul(R, D[:, j])
    return D, round(d, 1)

def lift_head(body, D, target_deg):
    """Raise the gaze of a take whose actor watched the floor: a constant extension about the thorax's side axis, shared
    30 / 65 / 100 % down neck_01, neck_02 and head, so that the head's mean pitch over the clip becomes target_deg (degrees
    below level); every captured head movement is kept."""
    f = qrot(D[:, body["head"]], [0, 0, 1.0]); mean = float(np.degrees(np.arcsin(-f[:, 1])).mean()); lift = max(mean - target_deg, 0.0)
    ax = qrot(D[:, body["spine_05"]], [1.0, 0, 0])
    for n, k in (("neck_01", 0.3), ("neck_02", 0.65), ("head", 1.0)): D[:, body[n]] = qmul(qaxis(ax, np.full(len(D), np.radians(-lift * k))), D[:, body[n]])
    return D, round(lift, 1)

def build_clip(body, clip, fix_arms=True, do_plant=True):
    s = source_for(clip); D, pelvis, info = retarget(body, s)
    E = lib_fingers(body, len(s.root), s) if getattr(body, "lib", None) else fingers(body, s)      # the package's pose library when it has one
    if CLIPS[clip].get("trunk_match"): D, info["trunk_lean_removed_deg"] = match_trunk(body, s, D, pelvis)
    if CLIPS[clip].get("head_pitch") is not None: D, info["head_lift_deg"] = lift_head(body, D, CLIPS[clip]["head_pitch"])
    D = followers(body, D, E); raw = (D.copy(), pelvis.copy())
    # a folded leg swung through 120 degrees in five frames (rom-a, 15.4 s: the source's solve, foot in the air): legs are eased
    # before the planting, which then re-solves any planted foot
    legs = [body[f"{n}_{x}"] for x in "lr" for n in ("thigh", "calf", "foot", "ball")]; relL = {j: qmul(qinv(D[:, body.parent[j]]), D[:, j]) for j in legs}
    D, info["leg_pops_smoothed"] = depop(body, D, limit=CLIPS[clip].get("leg_limit", 28.0), only=("thigh", "calf"))      # a walking knee reaches 20 degrees a frame: only what no leg does
    for j in legs:
        if body.names[j] not in info["leg_pops_smoothed"]: D[:, j] = qmul(D[:, body.parent[j]], relL[j])
    if do_plant:
        D, pelvis, pi = plant(body, D, pelvis, s.con, yaw_lock=CLIPS[clip].get("yaw_lock", False), swing_clear=CLIPS[clip].get("swing_clear", 0.0), heel_edge=CLIPS[clip].get("heel_edge"),
                              shoe_margin=CLIPS[clip].get("shoe_margin"), level_roll=CLIPS[clip].get("level_roll", False)); info.update(pi)
        if CLIPS[clip].get("toe_limit"):
            D, info["toe_pops_smoothed"] = depop(body, D, limit=CLIPS[clip]["toe_limit"], only=("ball",))      # the toes carry no contact point
            D = toes_up(body, D, pelvis)                                     # and never point down while the ball is on the floor (a shoe's toe box is longer than the toes)
    D = followers(body, D, E)
    chain = [body[n] for n in MAPPED]                         # relative rotations, so a parent's repair carries its children
    rel = {j: qmul(qinv(D[:, body.parent[j]]), D[:, j]) for j in chain if body.names[j].split("_")[0] in ("lowerarm", "hand", "neck", "head", "spine", "clavicle", "upperarm")}
    D, info["pops_smoothed"] = depop(body, D)
    for j in sorted(rel):
        n = body.names[j]
        if n not in info["pops_smoothed"]: D[:, j] = qmul(D[:, body.parent[j]], rel[j])
    D, more = depop(body, D); D = followers(body, D, E)
    if fix_arms and body.proxy:
        D = clear_arms(body, D, pelvis)
        relA = {j: qmul(qinv(D[:, body.parent[j]]), D[:, j]) for j in chain if body.names[j].split("_")[0] in ("lowerarm", "hand")}
        D, info["arm_pops_after_clearance"] = depop(body, D, limit=CLIPS[clip].get("arm_limit", 14.0), only=("upperarm", "lowerarm", "hand"))          # the clearance itself must not pop (F05, rom-b squat)
        for j in sorted(relA):
            if body.names[j] not in info["arm_pops_after_clearance"]: D[:, j] = qmul(D[:, body.parent[j]], relA[j])
        D = followers(body, D, E)
    E = forearm_twist(body, D, E); D = followers(body, D, E)
    con = s.con; root = None
    if CLIPS[clip].get("loop"):
        n = s.loop["frames"]; sl = slice(n, 2 * n + 1); D, pelvis = D[sl].copy(), pelvis[sl].copy(); con = {x: c[sl] for x, c in con.items()}
        raw = (raw[0][sl], raw[1][sl]); stride = s.loop["stride"] * info["leg_scale"]; pelvis = pelvis - (pelvis[0] * [1, 0, 1])
        raw = (raw[0], raw[1] - raw[1][0] * [1, 0, 1]); root = np.outer(np.arange(n + 1) / n, stride)
        info["loop_seam_deg"] = float(qangle(D[0], D[-1]).max()); info["loop_seam_pelvis_mm"] = float(np.linalg.norm(pelvis[-1] - stride - pelvis[0]) * 1000)
        D[-1] = D[0]; pelvis[-1] = pelvis[0] + stride                       # the tiled cycles are periodic; the seam above is what this overwrites
        info["loop"] = dict(frames=n, stride_m=np.round(stride, 4).tolist(), velocity_m_s=np.round(stride / (n / FPS), 4).tolist(), source_frames_30fps=[s.loop["first"], s.loop["last"]])
        if CLIPS[clip].get("tile"):                 # round 8: the closed captured cycle walked on for `tile` cycles (travel in the pelvis, no root track)
            N = int(round(CLIPS[clip]["tile"] * n)) + 1; i = np.arange(N); k = i // n; m = i % n
            D = D[m].copy(); pelvis = pelvis[m] + k[:, None] * stride; con = {x: c[m] for x, c in con.items()}
            raw = (raw[0][m], raw[1][m] + k[:, None] * stride); root = None; info["loop"]["tiled_cycles"] = CLIPS[clip]["tile"]
    D, pelvis, root = face_forward(body, D, pelvis, root)
    return dict(D=D, pelvis=pelvis, root=root, con=con, info=info, raw=raw, src=s)

def face_forward(body, D, pelvis, root=None):
    """Every clip starts over the origin facing +Z (the capture's own place and heading mean nothing to a viewer)."""
    f = qrot(D[0, body["pelvis"]], [0, 0, 1.0]); R = qaxis([0, 1.0, 0], -np.arctan2(f[0], f[2])); o = pelvis[0] * [1, 0, 1]
    D = qmul(np.broadcast_to(R, D.shape), D); pelvis = qrot(R, pelvis - o)
    D[:, [j for j, p in enumerate(body.parent) if p < 0]] = QI      # the root joint itself stays unrotated: the pelvis track is in its frame
    return D, pelvis, (None if root is None else qrot(R, root))

# ======================================================================================================================
# 6b. The relaxed stand (VD/REVIEW-05, "what must change" item 3) and the standing idle built on it
# ======================================================================================================================
STAND = dict(   # design values for a relaxed adult stance, figure frame (+X left, +Y up, +Z front); degrees and metres
    stance="r",              # weight on the right leg; the left is the free leg
    feet_extra=0.03,         # ankle centres this much wider apart than the hip joints: feet about hip width
    toe_out=(11.0, 7.0),     # foot yaw outward, free / stance
    free_forward=0.04,       # the free foot stands this far forward of the stance foot
    free_out=0.01,           # and this much further out
    hip_ahead=0.025,         # hip centre ahead of the stance ankle (the line of gravity falls just in front of the ankle)
    shift=0.035,             # hip centre moved this far from the feet midline toward the stance foot
    roll=3.0,                # pelvis drops this much on the free side
    yaw=3.0,                 # pelvis turns the free-side hip forward (the free foot is forward)
    stance_knee=4.0,         # stance knee flexion (the free knee follows from the lower hip, by IK)
    shoulder_roll=2.0,       # shoulder line tilts the other way, free side up: the trunk answers the pelvis
    lean=1.0,                # thorax pitched forward over the lumbar spine
    clav_down=4.0,           # clavicles lowered: relaxed shoulders with the arms down
    arm_flex=3.0,            # upper arm carried forward of vertical
    elbow=14.0,              # elbow flexion: the slight forward carry of the forearm (hand centre about 9 cm ahead of the shoulder joint)
    palm_back=15.0,          # palm faces the thigh, turned this much backward
    wrist_flex=6.0,          # wrist flexion toward the palm
    abd_min=5.0, abd_max=24.0,   # shoulder abduction, solved per body and side in this range
    clear_mm=12.0,           # forearm, elbow and hand at least this far from trunk and thighs (room for sleeve and trouser cloth)
    upper_in_mm=18.0,        # upper arm beyond 40 % of its length no deeper than this into the chest side: it rests on the flank, and the
                             # un-flattened mesh overlaps there (5 mm, the designer's body limit, takes 17-24 degrees: arms held out, looked)
)

def load_lib(pkg_dir, man):
    """The package's pose library: dof definitions (manifest `dofs`) and poses (posesFile; RR's HAND_RELAXED is the relaxed hand)."""
    f = os.path.join(pkg_dir, man.get("posesFile") or "poses.json"); poses = json.load(open(f)) if os.path.exists(f) else []
    return {"dofs": man.get("dofs", []), "poses": {p.get("id", p.get("name")): p.get("dofs", {}) for p in poses}, "file": os.path.relpath(f, LAB)}

def dof_rel(lib, joint, values):
    """A joint's rotation relative to its parent as the viewer applies dofs (rest frames are world-aligned): R(a1, v1) R(a2, v2) ..."""
    q = QI.copy()
    for d in lib["dofs"]:
        if d["joint"] == joint and values.get(d["id"]): q = qmul(q, qaxis(d["axis"], np.radians(values[d["id"]])))
    return q

def lib_fingers(body, F, s=None, hand="HAND_RELAXED", t0=None):
    """Finger joints from the pose library's hand pose as relative deltas E (F,4); the library's right-hand values are used
    for both sides by dof id (the dofs are mirrored). A small finger life (degrees, two slow sines per finger, flexion only)
    keeps the hands from freezing (HF19); with t0 it is zero at that time (the RELAXED_STAND frame is exactly the library pose)."""
    vals = body.lib["poses"][hand]; tt = np.arange(F) / FPS - (t0 or 0.0); E = {}
    for x in "lr":
        fast = np.zeros(F)
        if s is not None and x + "hand" in s.D and F > 2:            # the hand opens a little when it moves fast (as fingers() does)
            w = qangle(s.D[x + "hand"][1:], s.D[x + "hand"][:-1]) * FPS; fast = -np.clip(smooth(np.concatenate([w[:1], w]), 6.0) / 40.0, 0, 5)
        ph = 0.0 if x == "l" else 1.7
        for fi, f in enumerate(mo_bodies.FINGERS):
            amp = (0.5 if f == "thumb" else 1.0) * (0.7 + 0.3 * np.cos(ph + fi))
            life = amp * (2.5 * np.sin(tt * 2 * np.pi * (0.13 + 0.031 * fi)) + 1.5 * np.sin(tt * 2 * np.pi * (0.41 + 0.07 * fi)))
            for k in (1, 2, 3):
                j = f"{f}_0{k}_{x}"
                if j not in body.ix: continue
                q = np.tile(QI, (F, 1))
                for d in body.lib["dofs"]:
                    if d["joint"] != j: continue
                    v = np.full(F, float(vals.get(d["id"].replace(f"_{x}.", "_r."), 0.0)))
                    if d["id"].endswith(".flex"): v = v + (life + fast) * (1.0 if k < 3 else 0.4)
                    q = qmul(q, qaxis(np.broadcast_to(d["axis"], (F, 3)), np.radians(v)))
                E[j] = q
    return E

def _frame(a, b):
    a = a / np.linalg.norm(a); b = b - a * (a @ b); b = b / np.linalg.norm(b); return np.stack([a, b, np.cross(a, b)], 1)

def _quat(R):
    from scipy.spatial.transform import Rotation
    return Rotation.from_matrix(R).as_quat()                      # x, y, z, w

def stand_pose(body, abd, S=STAND):
    """One frame of the relaxed stand on this body: world deltas D (1,J,4) and pelvis (1,3). abd = (left, right) shoulder
    abduction in degrees (solved per body by solve_stand). Feet flat on their rest heights (soles on the floor)."""
    J = len(body.names); D = np.tile(QI, (1, J, 1)); P0 = body.P0; X, Y, Z = np.eye(3); r = np.radians
    st = S["stance"]; fr = "l" if st == "r" else "r"; sg = {"l": 1.0, "r": -1.0}
    hipw = abs(P0[body["thigh_l"], 0] - P0[body["thigh_r"], 0]); w = hipw + S["feet_extra"]
    ank = {x: np.array([sg[x] * w / 2, P0[body[f"foot_{x}"], 1], 0.0]) for x in "lr"}; ank[fr] = ank[fr] + [sg[fr] * S["free_out"], 0, S["free_forward"]]
    toe = {fr: S["toe_out"][0], st: S["toe_out"][1]}
    for x in "lr":
        h = (P0[body[f"ball_{x}"]] - P0[body[f"foot_{x}"]]) * [1, 0, 1]; t = r(toe[x])
        Df = qarc(h, [sg[x] * np.sin(t), 0, np.cos(t)]); D[0, body[f"foot_{x}"]] = Df; D[0, body[f"ball_{x}"]] = Df
    Rp = qmul(qaxis(Y, -sg[fr] * r(S["yaw"])), qaxis(Z, -sg[fr] * r(S["roll"]))); D[0, body["pelvis"]] = Rp
    c = (P0[body["thigh_l"]] + P0[body["thigh_r"]]) / 2 - P0[body["pelvis"]]
    mid_x = (ank["l"][0] + ank["r"][0]) / 2
    pel = np.array([mid_x + sg[st] * S["shift"], 0.0, ank[st][2] + S["hip_ahead"]]) - qrot(Rp, c)
    l1, l2 = body.len(f"thigh_{st}", f"calf_{st}"), body.len(f"calf_{st}", f"foot_{st}")
    d = np.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * np.cos(r(S["stance_knee"])))
    hip = pel + qrot(Rp, P0[body[f"thigh_{st}"]] - P0[body["pelvis"]]); dx, dz = hip[0] - ank[st][0], hip[2] - ank[st][2]
    pel[1] += ank[st][1] + np.sqrt(max(d * d - dx * dx - dz * dz, 0)) - hip[1]; pelvis = pel[None]
    tot_roll, tot_yaw = sg[fr] * (S["shoulder_roll"] + S["roll"]), sg[fr] * S["yaw"]
    share = {"spine_01": 0.30, "spine_02": 0.25, "spine_03": 0.20, "spine_04": 0.15, "spine_05": 0.10}; lean = {"spine_03": 0.4, "spine_04": 0.3, "spine_05": 0.3}
    prev = Rp
    for n, k in share.items():
        e = qmul(qaxis(Y, r(tot_yaw * k)), qaxis(Z, r(tot_roll * k)))
        if n in lean: e = qmul(qaxis(X, r(S["lean"] * lean[n])), e)
        prev = qmul(prev, e); D[0, body[n]] = prev
    head = QI.copy()                                                    # head level, looking straight ahead (the rest head)
    D[0, body["neck_01"]] = qslerp(prev, head, 0.35); D[0, body["neck_02"]] = qslerp(prev, head, 0.7); D[0, body["head"]] = head
    for x in "lr": D[0, body[f"clavicle_{x}"]] = qmul(prev, qaxis(Z, -sg[x] * r(S["clav_down"])))
    P = fk(body, D, pelvis); info = {}
    for i, x in enumerate("lr"):
        ua, la, ha = body[f"upperarm_{x}"], body[f"lowerarm_{x}"], body[f"hand_{x}"]
        u0 = body.dir(f"upperarm_{x}", f"lowerarm_{x}"); f0 = body.dir(f"lowerarm_{x}", f"hand_{x}"); h0 = np.cross(u0, f0); h0 /= np.linalg.norm(h0)
        e0 = np.arccos(np.clip(u0 @ f0, -1, 1)); a = r(abd[i]); fl = r(S["arm_flex"])
        u1 = np.array([sg[x] * np.cos(fl) * np.sin(a), -np.cos(fl) * np.cos(a), np.sin(fl)]); h1 = np.cross(u1, Z); h1 /= np.linalg.norm(h1)
        Dua = _quat(_frame(u1, h1) @ _frame(u0, h0).T); Dla = qmul(qaxis(h1, r(S["elbow"]) - e0), Dua)
        ax, n0 = hand_axes(body, x); f1 = qrot(Dla, f0); n1 = qrot(Dla, n0)
        tgt = np.array([-sg[x] * np.cos(r(S["palm_back"])), 0.0, -np.sin(r(S["palm_back"]))])
        pj = lambda v: (v - f1 * (v @ f1)) / np.linalg.norm(v - f1 * (v @ f1)); a1, a2 = pj(n1), pj(tgt)
        psi = np.arctan2(np.cross(a1, a2) @ f1, a1 @ a2); Dh = qmul(qaxis(f1, psi), Dla); n2 = qrot(Dh, n0)
        wa = np.cross(f1, n2); wa /= np.linalg.norm(wa); Dh = qmul(qaxis(wa, r(S["wrist_flex"])), Dh)
        D[0, ua], D[0, la], D[0, ha] = Dua, Dla, Dh
        info[x] = dict(abduction_deg=round(float(abd[i]), 2), forearm_turn_deg=round(float(np.degrees(psi)), 1), palm_medial_before_turn=round(float(-sg[x] * n1[0]), 2))
    P = fk(body, D, pelvis)
    for x in "lr":
        th, ca, ft = body[f"thigh_{x}"], body[f"calf_{x}"], body[f"foot_{x}"]
        hint = (P[:, th] + ank[x][None]) / 2 + np.array([sg[x] * 0.03, 0, 0.3])
        mid, end = two_bone(P[:, th], ank[x][None], hint, body.len(f"thigh_{x}", f"calf_{x}"), body.len(f"calf_{x}", f"foot_{x}"))
        apply_two_bone(body, D, P, th, ca, ft, mid, end)
        u, v_ = body.P0[ca] - body.P0[th], body.P0[ft] - body.P0[ca]; uu, vv = qrot(D[0, th], u), qrot(D[0, ca], v_)
        info[x]["knee_flexion_deg"] = round(float(np.degrees(np.arccos(np.clip(uu @ vv / np.linalg.norm(uu) / np.linalg.norm(vv), -1, 1)))), 1)
    return D, pelvis, info

def _finish(body, D, E):
    """Followers (fingers from E, eyes, twist and helper joints) and the forearm twist, as build_clip finishes a clip."""
    D = followers(body, D, E); E = forearm_twist(body, D, dict(E)); return followers(body, D, E)

class Surface:
    """A person's skinned trunk-and-thigh surface, sampled densely (about 4 mm) so a nearest-point query is a surface distance,
    with the sample normals for the inside test; and the arm vertex sets that are tested against it."""
    TRUNK = ("pelvis", "spine", "thigh", "glute", "hip_belly", "groin", "lap_thigh")
    def __init__(self, b):
        nm = np.array(b.names)[b.dom]; tris = b.mesh["tris"]; pre = lambda m, *ps: np.array([n.startswith(ps) for n in m])
        side = lambda x: np.array([n.endswith("_" + x) for n in nm])
        self.b = b; self.tris = tris[pre(nm[tris[:, 0]], *self.TRUNK) & pre(nm[tris[:, 1]], *self.TRUNK) & pre(nm[tris[:, 2]], *self.TRUNK)]
        self.chest = tris[pre(nm[tris[:, 0]], "spine", "armpit_chest", "clavicle") & pre(nm[tris[:, 1]], "spine", "armpit_chest", "clavicle") & pre(nm[tris[:, 2]], "spine", "armpit_chest", "clavicle")]
        self.low = {x: np.where(pre(nm, "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky") & side(x))[0] for x in "lr"}
        self.up = {}
        for x in "lr":
            A, B = b.P0[b[f"upperarm_{x}"]], b.P0[b[f"lowerarm_{x}"]]; t = ((b.v - A) @ (B - A)) / ((B - A) @ (B - A))
            self.up[x] = np.where(pre(nm, "upperarm") & side(x) & (t > 0.4))[0]
        g = np.linspace(0, 1, 5); u, w = np.meshgrid(g, g); k = (u + w) <= 1 + 1e-9; self.bary = np.stack([1 - u[k] - w[k], u[k], w[k]], 1)
    def _samples(self, v, tris):
        a, b_, c = v[tris[:, 0]], v[tris[:, 1]], v[tris[:, 2]]; n = np.cross(b_ - a, c - a); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        p = (self.bary[None, :, 0:1] * a[:, None] + self.bary[None, :, 1:2] * b_[:, None] + self.bary[None, :, 2:3] * c[:, None]).reshape(-1, 3)
        return p, np.repeat(n, len(self.bary), 0)
    def measure(self, D, P):
        """Per side, mm: forearm/hand/elbow depth inside trunk or thighs (0 = outside), their smallest gap, upper-arm depth in the chest."""
        from scipy.spatial import cKDTree
        v = skin(self.b, D, P); out = {}
        sp, sn = self._samples(v, self.tris); tree = cKDTree(sp); cp, cn = self._samples(v, self.chest); ctree = cKDTree(cp)
        for x in "lr":
            q = v[self.low[x]]; d, i = tree.query(q); sd = ((q - sp[i]) * sn[i]).sum(1); ins = (sd < 0) & (d < 0.05)
            q2 = v[self.up[x]]; d2, i2 = ctree.query(q2); sd2 = ((q2 - cp[i2]) * cn[i2]).sum(1); ins2 = (sd2 < 0) & (d2 < 0.05)
            out[x] = {"low_depth_mm": round(float(-sd[ins].min() * 1000) if ins.any() else 0.0, 1), "low_gap_mm": round(float(d[~ins].min() * 1000) if (~ins).any() else 0.0, 1),
                      "upper_depth_mm": round(float(-sd2[ins2].min() * 1000) if ins2.any() else 0.0, 1)}
        return out

def solve_stand(body, checks, S=STAND):
    """Shoulder abduction per side: the smallest (0.25 degree steps) at which, on every mesh in `checks` (this person on the
    body, abstract and dressed packages: (body, Surface, pelvis offset)), forearm, elbow and hand stay outside trunk and thighs
    with S['clear_mm'] to spare and the upper arm is no deeper than S['upper_in_mm'] into the chest."""
    def ok(a):
        D, pel, _ = stand_pose(body, a, S); D = _finish(body, D, lib_fingers(body, 1, t0=0.0)); res = {"l": True, "r": True}; worst = {}
        for bk, surf, off in checks:
            m = surf.measure(D[0], fk(bk, D, pel + off)[0])
            for x in "lr":
                good = m[x]["low_depth_mm"] <= 0.0 and m[x]["low_gap_mm"] >= S["clear_mm"] and m[x]["upper_depth_mm"] <= S["upper_in_mm"]
                res[x] &= good; worst.setdefault(x, []).append(m[x])
        return res, worst
    a = [S["abd_min"], S["abd_min"]]; done = [False, False]
    while not all(done):
        res, _ = ok(a)
        for i, x in enumerate("lr"):
            if not done[i]:
                if res[x]: done[i] = True
                elif a[i] >= S["abd_max"]: done[i] = True
                else: a[i] = min(a[i] + 1.0, S["abd_max"])
    for i, x in enumerate("lr"):                                          # back off in quarter degrees while it still passes
        while a[i] - 0.25 >= S["abd_min"]:
            b_ = list(a); b_[i] -= 0.25
            if ok(b_)[0][x]: a = b_
            else: break
    res, worst = ok(a)
    return a, res, worst

def build_idle(body, abd, seconds=8.0, t0=1.0, S=STAND):
    """The standing idle: the relaxed stand under a slow layer (pelvis sway and roll, breathing in the thorax and clavicles,
    head drift, arm sway, finger life), every term zero at t0, so the frame at t0 is exactly the relaxed stand (RELAXED_STAND
    = the frame at t = 1.0 s of IDLE_STAND, VD/review-packet.json). The feet stay on the stand's targets (no slide by
    construction). 8 s loop. The layer is procedural: no standing idle take is on disk."""
    F = int(round(seconds * FPS)) + 1; ph = 2 * np.pi * (np.arange(F) / FPS - t0) / seconds
    sway, breath, drift = np.sin(ph), np.sin(3 * ph), 0.6 * np.sin(2 * ph) + 0.4 * np.sin(ph)
    D = np.zeros((F, len(body.names), 4)); pel = np.zeros((F, 3))
    for t in range(F):
        s_ = dict(S, shift=S["shift"] + 0.010 * sway[t], roll=S["roll"] + 1.0 * sway[t], shoulder_roll=S["shoulder_roll"] + 0.4 * sway[t],
                  lean=S["lean"] + 0.5 * breath[t], clav_down=S["clav_down"] - 0.6 * breath[t], arm_flex=S["arm_flex"] + 0.8 * drift[t], elbow=S["elbow"] + 1.0 * np.sin(2 * ph[t] + 0.0))
        d_, p_, _ = stand_pose(body, (abd[0] + 0.3 * breath[t], abd[1] + 0.3 * breath[t]), s_); D[t], pel[t] = d_[0], p_[0]
    Y, X = np.eye(3)[1], np.eye(3)[0]
    for t in range(F):                                                   # head drift: a little look-around, zero at t0
        hq = qmul(qaxis(Y, np.radians(1.5 * drift[t])), qaxis(X, np.radians(0.6 * breath[t])))
        D[t, body["head"]] = qmul(hq, D[t, body["head"]]); D[t, body["neck_02"]] = qslerp(D[t, body["neck_02"]], D[t, body["head"]], 0.3)
    D = _finish(body, D, lib_fingers(body, F, t0=t0)); D[-1] = D[0]; pel[-1] = pel[0]
    return dict(D=D, pelvis=pel, root=None, con={x: np.full(F, 3) for x in "lr"}, info=dict(leg_scale=1.0, abduction_deg=list(map(float, abd)), relaxed_stand_frame=int(round(t0 * FPS)),
                synthesised="relaxed stand (pipeline/motion.py STAND, arms solved per body) + procedural layer zero at t = %.1f s; not a captured idle" % t0), raw=(D.copy(), pel.copy()), src=None)

def foot_slide(body, D, pelvis, near=(0.002, 0.005)):
    """Foot slide measured on the result, independent of any contact label: the heel and ball points of each foot (the same
    points the planter uses) count as on the floor in a frame when they are within `near` of their planted height; the
    horizontal step of a point between two consecutive on-floor frames is its slide in mm per frame. Reported for a strict
    contact band (2 mm: the foot is down) and a loose one (5 mm: also a toe or heel skimming the floor at lift-off and
    touch-down); plus the largest drift over one unbroken run inside the strict band (mm)."""
    P = fk(body, D, pelvis); out = {}
    for band in near:
        steps = []; drift = 0.0; on_frac = {}; worst = (0.0, "")
        for x in "lr":
            ft = body[f"foot_{x}"]; off, hgt = foot_points(body, x)
            for k, o in off.items():
                p = P[:, ft] + qrot(D[:, ft], o); on = np.abs(p[:, 1] - hgt[k]) < band; on_frac[f"{x}_{k}"] = round(float(on.mean()), 2)
                st = np.linalg.norm(np.diff(p[:, [0, 2]], axis=0), axis=1); both = on[1:] & on[:-1]; steps += list(st[both])
                if both.any() and st[both].max() > worst[0]: i_ = np.where(both)[0][st[both].argmax()]; worst = (float(st[i_]), f"{x} {k} at {(i_ + 1) / FPS:.2f} s")
                t = 0
                while t < len(on):
                    if on[t]:
                        j = t
                        while j < len(on) and on[j]: j += 1
                        drift = max(drift, float(np.linalg.norm((p[t:j, [0, 2]] - p[t, [0, 2]]), axis=1).max())); t = j
                    else: t += 1
        steps = np.array(steps) * 1000 if steps else np.zeros(1)
        out[f"within_{int(band * 1000)}mm"] = {"slide_mm_per_frame_max": round(float(steps.max()), 2), "where": worst[1], "slide_mm_per_frame_p95": round(float(np.percentile(steps, 95)), 2),
                                               "drift_in_one_contact_max_mm": round(drift * 1000, 1), "on_floor_fraction": on_frac}
    s_ = out["within_2mm"]; out.update({"slide_mm_per_frame_max": s_["slide_mm_per_frame_max"], "slide_mm_per_frame_p95": s_["slide_mm_per_frame_p95"], "drift_in_one_contact_max_mm": s_["drift_in_one_contact_max_mm"],
                "how": "heel and ball points within 2 mm (and, second figure, 5 mm) of their planted height count as on the floor; horizontal step between consecutive on-floor frames at %d fps; no contact label used" % FPS})
    return out

def packet_slide(body, D, pelvis):
    """The packet renderer's foot-slide measure (viewer/packet.ts, round 6), on joint positions: the foot (ankle) and ball joints count
    as planted while within 12 mm of their lowest height in the clip and moving less than 10 mm a frame horizontally; slide = the
    largest horizontal distance from where a run of 3 frames or more began. Heel and toe roll count, as the designer counts them."""
    P = fk(body, D, pelvis); out = {}
    for j in ("foot_l", "foot_r", "ball_l", "ball_r"):
        q = P[:, body[j]]; lo = q[:, 1].min(); worst = 0.0; run = []; prev = None
        def flush():
            nonlocal worst
            if len(run) >= 3: worst = max(worst, max(float(np.hypot(*(r[[0, 2]] - run[0][[0, 2]]))) for r in run))
        for t in range(len(q)):
            slow = prev is None or np.hypot(*(q[t, [0, 2]] - prev[[0, 2]])) < 0.010
            if q[t, 1] <= lo + 0.012 and slow: run.append(q[t])
            else: flush(); run = []
            prev = q[t]
        flush(); out[j] = round(worst * 1000, 1)
    out["max"] = max(out.values()); return out

def fit_dofs(body, lib, D, frame=0):
    """One frame of world deltas -> the package's dof values (degrees), least squares per joint in the viewer's dof order;
    fingers come from the library pose itself. Returns (values, worst residual in degrees and where)."""
    from scipy.optimize import least_squares
    by = {}
    for d in lib["dofs"]: by.setdefault(d["joint"], []).append(d)
    out = {}; worst = (0.0, "")
    for j, ds in by.items():
        if j not in body.ix or j.split("_")[0] in mo_bodies.FINGERS: continue
        p = body.parent[body[j]]; E = qfix(qmul(qinv(D[frame, p]), D[frame, body[j]])[None])[0]
        def f(x):
            q = QI.copy()
            for d, v in zip(ds, x): q = qmul(q, qaxis(d["axis"], v))
            q = qmul(qinv(E), q); q = q if q[3] >= 0 else -q; return qlog(q[None])[0]
        sol = least_squares(f, np.zeros(len(ds)), bounds=([np.radians(d["min"]) for d in ds], [np.radians(d["max"]) for d in ds]))
        res = float(np.degrees(np.linalg.norm(f(sol.x))))
        if res > worst[0]: worst = (res, j)
        for d, v in zip(ds, sol.x):
            if abs(np.degrees(v)) > 0.05: out[d["id"]] = round(float(np.degrees(v)), 3)
    hand = lib["poses"]["HAND_RELAXED"]
    for d in lib["dofs"]:
        if d["joint"].split("_")[0] in mo_bodies.FINGERS:
            v = hand.get(d["id"].replace("_l.", "_r."), 0.0)
            if v: out[d["id"]] = round(float(v), 3)
    return out, (round(worst[0], 2), worst[1])

def dofs_pose(body, lib, values):
    """The viewer's pose mode in numpy: D from dof values (rest frames world-aligned), pelvis at rest, then the lower foot
    joint back on its rest height (viewer/src/main.ts applyPose)."""
    D = np.tile(QI, (1, len(body.names), 1))
    for j, p in enumerate(body.parent):
        e = dof_rel(lib, body.names[j], values); D[0, j] = e if p < 0 else qmul(D[0, p], e)
    pel = body.P0[body["pelvis"]][None].copy(); P = fk(body, D, pel)
    drop = min(P[0, body["foot_l"], 1] - body.P0[body["foot_l"], 1], P[0, body["foot_r"], 1] - body.P0[body["foot_r"], 1]); pel[0, 1] -= drop
    return D, pel

def seated_window(con, pelvis, body):
    """Frames where the figure sits: pelvis well below standing height."""
    h = pelvis[:, 1]; stand = np.percentile(h, 97); low = h < stand - 0.25 * (stand - h.min()) - 0.08
    idx = np.where(low)[0]
    return (int(idx[0]), int(idx[-1])) if len(idx) else None

def write_rest(body, out):
    os.makedirs(out, exist_ok=True)
    json.dump({"names": body.names, "parent": body.parent, "pos": np.round(body.P0, 6).tolist(), "rot": body.Q0.tolist(), "tips": body.tips, "palm_half_thickness": body.proxy["limbs"]["hand_l"][0]}, open(os.path.join(out, "rest.json"), "w"))

def cmd_rest(a):
    """rest.json for every packet person of the package (the seated operator is solved and fitted for all of them; the captured
    clips are baked only for the persons given to `build`)."""
    pkg_dir = os.path.join(LAB, a.package) if not os.path.isabs(a.package) else a.package; base, man = load_package(pkg_dir); mesh = load_package_mesh(pkg_dir, man)
    for person in (man.get("packet", {}).get("persons") or {}):
        write_rest(package_person(pkg_dir, base, man, mesh, person), os.path.join(pkg_dir, "clips", person)); print("rest", person)

def cmd_build(a):
    persons = a.persons.split(","); clips = a.clips.split(",") if a.clips else list(CLIPS); report = {}
    pkg = None
    if a.package:
        pkg_dir = os.path.join(LAB, a.package) if not os.path.isabs(a.package) else a.package
        base, man = load_package(pkg_dir); bad = check_skeleton(base)
        if bad: print("SKELETON CHECK FAILED for", pkg_dir); [print("  -", b) for b in bad]; sys.exit(1)
        pkg = (pkg_dir, base, man, load_package_mesh(pkg_dir, man))
    if pkg: persons = [p for p in persons if p in (pkg[2].get("packet", {}).get("persons") or {})]
    for person in persons:
        if pkg:
            body = package_person(pkg[0], pkg[1], pkg[2], pkg[3], person); out = os.path.join(pkg[0], "clips", person); os.makedirs(out, exist_ok=True)
            write_rest(body, out)                                    # for operator.ts run headless (B4/operator-test.ts)
        else: body = load_standin(person); out = os.path.join(a.out or os.path.join(LAB, "B4", "clips"), person)
        os.makedirs(out, exist_ok=True); report[person] = {}
        if pkg: body.lib = load_lib(pkg[0], pkg[2])                # the package's pose library: HAND_RELAXED for the fingers
        for clip in clips:
            if CLIPS[clip].get("synth"): print(f"{person:5s} {clip}: built by `motion.py stand` (the relaxed stand is solved per body on its mesh)"); continue
            r = build_clip(body, clip); q, tp = to_local(body, r["D"], r["pelvis"], r["root"]); s = r["src"]
            path = os.path.join(out, clip + ".glb")
            write_clip(path, body, clip, q, tp, r["root"], extras={"source": "CMU Graphics Lab Motion Capture Database, take " + CLIPS[clip]["src"], "credit": CREDIT, "fps": FPS, "body": person, "skeleton": body.signature()})
            D2, pelvis2, root2 = read_clip(path, body)       # measured on what was written, not on what was meant
            m = measure(body, D2, pelvis2, r["con"], q)
            raw = measure(body, r["raw"][0], r["raw"][1], r["con"])
            m["before_planting"] = {k: raw[k] for k in ("foot_slide_max_mm", "floor_penetration_max_mm", "arm_into_body_max_mm") if k in raw}
            m["frames"] = len(q); m["seconds"] = round((len(q) - 1) / FPS, 2); m.update({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r["info"].items() if k not in "lr"})
            side = {"clip": clip, "what": CLIPS[clip]["what"], "source": "CMU take " + CLIPS[clip]["src"], "licence": "CMU: free to copy, modify and redistribute; not to be resold as data", "credit": CREDIT,
                    "fps": FPS, "frames": len(q), "body": person, "skeleton": body.signature(), "contacts": {x: c.tolist() for x, c in r["con"].items()},
                    "contact_code": "0 none, 1 heel only, 2 ball only, 3 flat", "cleaning_removed_p99_deg": round(float(np.median([v for k, v in s.cleaned.items() if k != "root_mm"])), 2) if s is not None else None, "metrics": m}
            if clip == "seated-base":
                w = seated_window(r["con"], r["pelvis"], body); side["seated_frames"] = w; m["seated_seconds"] = [round(w[0] / FPS, 2), round(w[1] / FPS, 2)] if w else None
                if w: write_idle(os.path.join(out, "seated-idle.json"), body, r["D"], r["pelvis"], w)
            json.dump(side, open(os.path.join(out, clip + ".json"), "w"))
            report[person][clip] = m
            print(f"{person:5s} {clip:16s} {m['seconds']:6.2f} s  slide {m['foot_slide_max_mm']:5.1f} mm (raw {m['before_planting']['foot_slide_max_mm']:6.1f})  floor pen {m['floor_penetration_max_mm']:4.1f} (raw {m['before_planting']['floor_penetration_max_mm']:5.1f})"
                  f"  arm-in-body {m.get('arm_into_body_max_mm', -1):5.1f} (raw {m['before_planting'].get('arm_into_body_max_mm', -1):5.1f})  step {m['joint_change_max_deg_per_frame']:5.1f} deg ({m['joint_change_where']})")
    # the lab viewer's own rule (the median man's clip on another body, pelvis offset scaled by leg length) for comparison
    naive = {}
    if pkg:
        mf = os.path.join(pkg[0], "clips", "metrics.json"); old = json.load(open(mf)).get("per_body_retarget", {}) if os.path.exists(mf) else {}
        for p_, v_ in report.items(): old.setdefault(p_, {}).update(v_)                      # clips not rebuilt now keep their numbers
        json.dump({"per_body_retarget": old, "how": "each GLB read back, forward kinematics on that person's joints; arm penetration against proxies fitted to that person's mesh (see metrics-skin.json for the skinned mesh)"}, open(mf, "w"), indent=1)
        write_manifest(pkg[0], pkg[2], persons, clips); return
    if "M50" in persons:
        ref = load_standin("M50"); t_ref = ref.local_rest()[0][ref["pelvis"]]
        legs = lambda b: b.len("thigh_l", "calf_l") + b.len("calf_l", "foot_l")
        for person in persons:
            if person == "M50": continue
            body = load_standin(person); naive[person] = {}
            for clip in clips:
                if CLIPS[clip].get("synth"): continue
                r = build_clip(ref, clip); q, tp = to_local(ref, r["D"], r["pelvis"], r["root"])
                D, pelvis, _ = world_from_local(body, q, tp, r["root"], legs(body) / legs(ref), t_ref)
                m = measure(body, D, pelvis, r["con"]); naive[person][clip] = {k: m[k] for k in ("foot_slide_max_mm", "planted_height_error_max_mm", "floor_penetration_max_mm", "arm_into_body_max_mm")}
    json.dump({"per_body_retarget": report, "median_clip_played_on_other_body": naive, "limits": {"foot_slide_max_mm": 10, "body_penetration_mm": 5, "joint_change_deg_per_frame": 15},
               "how": "measured by reading each written GLB back and running forward kinematics on the body it was built for; arm penetration against elliptical torso sections and thigh capsules fitted to that body's mesh (a proxy, not the skinned mesh)"},
              open(os.path.join(LAB, "B4", "metrics-retarget.json"), "w"), indent=1)

def write_manifest(pkg_dir, man, persons, clips):
    """B1 owns the package manifest: this writes the block to merge (clips/manifest-block.json) and a derived manifest
    inside clips/ that the viewer and the packet renderer can open today, without touching B1's file."""
    cdir = os.path.join(pkg_dir, "clips"); have = lambda c, p: os.path.exists(os.path.join(cdir, p, c + ".glb"))
    persons = sorted(p for p in os.listdir(cdir) if os.path.exists(os.path.join(cdir, p, "rest.json")))      # what is on disk, whatever this call built
    order = list(man.get("packet", {}).get("persons") or {}); persons.sort(key=lambda p: order.index(p) if p in order else 99)
    names = [c for c in list(CLIPS) + ["operate8", "demo30"] if any(have(c, p) for p in persons)]
    src = lambda c: next(p for p in persons if have(c, p)); first = persons[0]
    cl = [{"name": c, "source": f"clips/{src(c)}/{c}.glb", "perBody": {p: f"clips/{p}/{c}.glb" for p in persons if have(c, p)}, "loop": c in ("walk-loop", "operate8", "idle-stand"), **({"source_take": "CMU " + CLIPS["move-stand"]["src"]} if c == "move-stand" else {}), "seated": c in ("operate8", "demo30")} for c in names]
    dur = lambda c: round((json.load(open(os.path.join(cdir, src(c), c + ".json")))["frames"] - 1) / FPS, 3)
    pk = {"MOVE_STAND": ({"clip": "move-stand", "duration": dur("move-stand"), "source": "CMU take " + CLIPS["move-stand"]["src"] + "; " + CLIPS["move-stand"]["what"]} if "move-stand" in names else {"clip": "walk", "duration": 2.6} if "walk" in names else None),
          "IDLE_STAND": {"clip": "idle-stand", "duration": dur("idle-stand")} if "idle-stand" in names else None}
    if "operate8" in names: pk["OPERATE"] = {"clip": "operate8", "duration": 8, "seat": True}
    pk = {k: v for k, v in pk.items() if v}
    poses = {}
    sf = os.path.join(cdir, "relaxed-stand.json")
    if "idle-stand" in names and os.path.exists(sf):          # RELAXED_STAND = the frame at t = 1.0 s of IDLE_STAND (VD/review-packet.json), per body
        rs = json.load(open(sf)); poses["RELAXED_STAND"] = {"clip": "idle-stand", "time": 1.0, "dofs": rs["dofs_all_bodies"],
                                                            "note": "clip frame per body (arms solved per body); `dofs` is one dof set that holds on every person of this package (arms at the widest body's abduction), for a renderer that needs a dof pose (pose overrides such as C6)"}
    mot = {p: json.load(open(os.path.join(cdir, p, "motion.json"))) for p in persons if os.path.exists(os.path.join(cdir, p, "motion.json"))}
    motion = {"persons": mot, "note": "B4: per packet person, collision capsules (joint-relative, rest world axes, metres) and seated tissue extents for viewer/src/operator.ts; a body is matched to a person by `key` (rest head and left-hand joint positions)"} if mot else None
    json.dump({"clips": cl, "packet": {"clips": pk, **({"poses": poses} if poses else {})}, **({"motion": motion} if motion else {}), "note": "merge into the package manifest: `clips` replaces the empty list, `packet.clips` the empty block, `packet.poses.RELAXED_STAND` REPLACES the builder's own RELAXED_STAND (round 6). MOVE_STAND is captured (CMU 86_15); IDLE_STAND is the relaxed stand under a procedural layer (not a captured idle). Clips named operate8 / demo30 switch the seated-operator plug-in on (viewer/src/operator.ts), which re-solves them live on the current body and draws the stand-in rig."},
              open(os.path.join(cdir, "manifest-block.json"), "w"), indent=1)
    m = json.loads(json.dumps(man)); up = lambda sdir: "../" + sdir
    m["glb"] = up(m["glb"]); m["clips"] = [dict(c, source=c["source"][6:], perBody={p: v[6:] for p, v in c["perBody"].items()}) for c in cl]
    if m.get("posesFile"): m["posesFile"] = up(m["posesFile"])
    bk = m.get("shape", {}).get("bake")
    for b_ in ([] if not bk else (bk if isinstance(bk, list) else [bk])): b_["file"] = up(b_["file"])
    m.setdefault("packet", {})["clips"] = pk
    if poses: m["packet"].setdefault("poses", {}).update(poses)
    if motion: m["motion"] = motion
    m["note"] = "B4's derived manifest (the package manifest plus motion); B1's file is the source of everything else."
    json.dump(m, open(os.path.join(cdir, os.path.basename(pkg_dir) + ".motion.avatar.json"), "w"))

def cmd_bake(a):
    """Operator sequences solved headless (B4/operator-test.ts writes <clip>.frames.json beside rest.json) -> clip GLBs."""
    pkg_dir = os.path.join(LAB, a.package) if not os.path.isabs(a.package) else a.package; base, man = load_package(pkg_dir); mesh = load_package_mesh(pkg_dir, man)
    persons = sorted(p for p in os.listdir(os.path.join(pkg_dir, "clips")) if os.path.exists(os.path.join(pkg_dir, "clips", p, "rest.json")))
    for person in persons:
        body = package_person(pkg_dir, base, man, mesh, person)
        for name in ("operate8", "demo30"):
            f = os.path.join(pkg_dir, "clips", person, name + ".frames.json")
            if not os.path.exists(f): continue
            d = json.load(open(f)); order = [d["names"].index(n) for n in body.names]
            q = qfix(np.array([fr["q"] for fr in d["frames"]])[:, order]); tp = np.array([fr["p"] for fr in d["frames"]])
            write_clip(os.path.join(pkg_dir, "clips", person, name + ".glb"), body, name, q, tp, extras={"source": "viewer/src/operator.ts run headless (inverse kinematics, no captured data)", "fps": FPS, "body": person, "skeleton": body.signature()}, skip=("eye_l", "eye_r"))
            print("baked", person, name, len(q), "frames")
    write_manifest(pkg_dir, man, persons, [c for c in CLIPS if os.path.exists(os.path.join(pkg_dir, "clips", persons[0], c + ".glb"))])

def cmd_fit(a):
    """Per packet person, from the mesh: collision capsules for the run-time arm solve (trunk sections as horizontal
    stadium capsules riding on the spine joints, tapered thigh capsules), arm radii, and how far the seated body's own
    tissue reaches below and behind the hip centre (skinned in the seated pose of operate8's first frame). Written to
    clips/<person>/motion.json and into the manifest block (`motion.persons`), which operator.ts reads."""
    pkg_dir = os.path.join(LAB, a.package) if not os.path.isabs(a.package) else a.package; base, man = load_package(pkg_dir); mesh = load_package_mesh(pkg_dir, man)
    cdir = os.path.join(pkg_dir, "clips"); persons = sorted(p for p in os.listdir(cdir) if os.path.exists(os.path.join(cdir, p, "rest.json"))); out = {}
    for person in persons:
        b = package_person(pkg_dir, base, man, mesh, person); nm = np.array(b.names)[b.dom]; L = b.proxy["limbs"]; caps = []
        for seg in b.proxy["torso"]:
            S = np.array(seg["slices"])
            for y, cz, hx, hz in S[::2]:
                hx, hz = hx + 0.0, hz + 0.0                          # the sections are 98th / 99th percentiles of the skin; no inflation (round 3's 4 mm stood the elbows wide)
                if hx >= hz: caps.append({"joint": seg["joint"], "a": [-(hx - hz), y, cz], "b": [hx - hz, y, cz], "ra": hz, "rb": hz})
                else: caps.append({"joint": seg["joint"], "a": [0, y, cz - (hz - hx)], "b": [0, y, cz + (hz - hx)], "ra": hx, "rb": hx})
        for x in "lr":
            d = b.P0[b[f"calf_{x}"]] - b.P0[b[f"thigh_{x}"]]; R = L[f"thigh_{x}"]
            caps.append({"joint": f"thigh_{x}", "a": (d * 0.12).tolist(), "b": (d * 0.6).tolist(), "ra": R[0], "rb": R[1]})
            caps.append({"joint": f"thigh_{x}", "a": (d * 0.6).tolist(), "b": (d * 0.97).tolist(), "ra": R[1], "rb": R[2]})
        fit = {"key": [round(float(v), 4) for v in (b.P0[b["head"]].tolist() + b.P0[b["hand_l"]].tolist())], "capsules": [{k: (np.round(v, 4).tolist() if isinstance(v, (list, np.ndarray)) else (round(float(v), 4) if not isinstance(v, str) else v)) for k, v in c.items()} for c in caps],
               "arm": {"upper": [round(L["upperarm_l"][1], 4), round(L["upperarm_l"][2], 4)], "fore": [round(L["lowerarm_l"][0], 4), round(L["lowerarm_l"][2], 4)], "hand": round(max(L["hand_l"][0] * 1.2, 0.02), 4)}}
        f = os.path.join(cdir, person, "operate8.frames.json")
        if os.path.exists(f):
            d = json.load(open(f)); order = [d["names"].index(n) for n in b.names]; q = np.array([d["frames"][0]["q"]])[:, order]; tp = np.array([d["frames"][0]["p"]])
            D, pelvis, _ = world_from_local(b, q, tp); P = fk(b, D, pelvis); v = skin(b, D[0], P[0]); hc = (P[0, b["thigh_l"]] + P[0, b["thigh_r"]]) / 2
            rec = np.radians(d["targets"].get("recline", 10)); nb = np.array([0.0, np.sin(rec), np.cos(rec)])
            seat = np.array([n.startswith(("pelvis", "thigh", "spine_01")) for n in nm]) & (np.abs(v[:, 0]) < 0.24) & (v[:, 2] > hc[2] - 0.16) & (v[:, 2] < hc[2] + 0.28)
            back = np.array([n.startswith(("spine_03", "spine_04", "spine_05", "clavicle")) for n in nm]); butt = np.array([n.startswith(("pelvis", "spine_01", "thigh")) for n in nm]) & (v[:, 1] > hc[1] - 0.05)
            fit["seat"] = {"buttock_below_hip_m": round(float(hc[1] - np.percentile(v[seat, 1], 0.5)), 4), "back_behind_hip_m": round(float(-np.percentile((v[back] - hc) @ nb, 0.5)), 4),
                           "pelvis_behind_hip_m": round(float(-np.percentile((v[butt] - hc) @ nb, 0.5)), 4), "pose": "operate8 frame 0; back measured along the backrest normal"}
        mj = os.path.join(cdir, person, "motion.json"); old = json.load(open(mj)).get("seat", {}) if os.path.exists(mj) else {}
        keep = {k: v for k, v in old.items() if k in ("hip_above_pan_m", "pan_drop_m", "compress_m", "hip_above_pan_survey_m", "eye_height_vs_survey_mm", "sitting_height_vs_survey_mm", "sink_mm", "rule")}
        if keep: fit.setdefault("seat", {}).update(keep)          # the round-6 seat rule (B4/seat-test.ts + motion.py seatsink) is solved separately: keep it
        out[person] = fit; json.dump(fit, open(mj, "w"))
        print(person, len(caps), "capsules; arm", fit["arm"], "seat", fit.get("seat"))
    write_manifest(pkg_dir, man, persons, [c for c in CLIPS if os.path.exists(os.path.join(cdir, persons[0], c + ".glb"))])

def cmd_skin(a):
    """What the skeleton numbers cannot say, measured on the person's skinned mesh (linear + dual-quaternion blend by the
    package's _DQS mask, as the viewer skins): skin against the grip cylinders, forearms and hands inside the trunk and
    thighs, and the body against the seat pan. -> packages/<name>/clips/metrics-skin.json"""
    from scipy.spatial import cKDTree
    pkg_dir = os.path.join(LAB, a.package) if not os.path.isabs(a.package) else a.package; base, man = load_package(pkg_dir); mesh = load_package_mesh(pkg_dir, man)
    cdir = os.path.join(pkg_dir, "clips"); persons = sorted(p for p in os.listdir(cdir) if os.path.exists(os.path.join(cdir, p, "rest.json"))); out = {}
    for person in persons:
        b = package_person(pkg_dir, base, man, mesh, person); nm = np.array(b.names)[b.dom]; tris = mesh["tris"]; res = out.setdefault(person, {})
        pre = lambda *ps: np.array([n.startswith(ps) for n in nm])
        core = np.where(pre("pelvis", "spine", "neck", "head", "thigh"))[0]
        arm = {x: np.where(pre("lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky") & np.array([n.endswith("_" + x) for n in nm]))[0][::2] for x in "lr"}
        def normals(v):
            fn = np.cross(v[tris[:, 1]] - v[tris[:, 0]], v[tris[:, 2]] - v[tris[:, 0]]); n = np.zeros_like(v)
            for k in range(3): np.add.at(n, tris[:, k], fn)
            return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        trunk = np.where(pre("pelvis", "spine"))[0]; upper = {}
        for x in "lr":                                       # the upper arm from 40 % of its length on (the armpit end touches the chest by nature)
            A, B = b.P0[b[f"upperarm_{x}"]], b.P0[b[f"lowerarm_{x}"]]; tt = ((b.v - A) @ (B - A)) / ((B - A) @ (B - A))
            upper[x] = np.where(pre("upperarm") & np.array([n.endswith("_" + x) for n in nm]) & (tt > 0.4))[0][::2]
        pairs = [""]; up_worst = [0.0]
        def arms_in_body(D, P):
            v = skin(b, D, P); n = normals(v); tree = cKDTree(v[core]); worst = 0.0; tt_ = cKDTree(v[trunk])
            for x in "lr":
                if not len(upper[x]): continue
                d, i = tt_.query(v[upper[x]]); c = trunk[i]; sd = ((v[upper[x]] - v[c]) * n[c]).sum(1); ins = (sd < 0) & (d < 0.05)
                if ins.any(): up_worst[0] = max(up_worst[0], float(-sd[ins].min()))
            for x in "lr":
                d, i = tree.query(v[arm[x]]); c = core[i]; sd = ((v[arm[x]] - v[c]) * n[c]).sum(1)
                inside = (sd < 0) & (d < 0.06)
                if inside.any() and float(-sd[inside].min()) > worst:
                    worst = float(-sd[inside].min()); k = np.where(inside)[0][sd[inside].argmin()]; pairs[0] = f"{nm[arm[x][k]]} in {nm[c[k]]}"
            return worst, v
        def run(D, pelvis, step):
            P = fk(b, D, pelvis); dep = []; what = ""; up_worst[0] = 0.0
            for t in range(0, len(D), step):
                w_ = arms_in_body(D[t], P[t])[0]
                if dep and w_ > max(dep): what = pairs[0]
                dep.append(w_)
            dep = np.array(dep) * 1000
            return {"arm_into_body_mesh_max_mm": round(float(dep.max()), 1), "upper_arm_into_trunk_mesh_max_mm": round(up_worst[0] * 1000, 1), "worst_pair": what or pairs[0], "frames_over_5mm_of_sampled": [int((dep > 5).sum()), len(dep)], "worst_at_s": round(int(dep.argmax()) * step / FPS, 2)}
        for clip in ([] if a.operator_only else (a.clips.split(",") if a.clips else list(CLIPS))):
            f = os.path.join(cdir, person, clip + ".glb")
            if os.path.exists(f): D, pelvis, _ = read_clip(f, b); res[clip] = run(D, pelvis, a.step * (4 if clip == "seated-base" else 1))
        for name in ("operate8", "demo30"):
            f = os.path.join(cdir, person, name + ".frames.json")
            if not os.path.exists(f): continue
            d = json.load(open(f)); order = [d["names"].index(n) for n in b.names]; q = np.array([fr["q"] for fr in d["frames"]])[:, order]; tp = np.array([fr["p"] for fr in d["frames"]])
            D, pelvis, _ = world_from_local(b, q, tp); P = fk(b, D, pelvis); r = run(D, pelvis, a.step); R = d.get("gripRadius", 0.02)
            groups = {x: {"palm": np.where(pre("hand_" + x) | (pre("index_meta", "middle_meta", "ring_meta", "pinky_meta") & np.array([n.endswith("_" + x) for n in nm])))[0],
                          **{f: np.where(np.array([n.startswith(f + "_0") and n.endswith("_" + x) for n in nm]))[0] for f in mo_bodies.FINGERS}} for x in "lr"}
            pen = 0.0; gaps = {g: [] for g in groups["l"]}; seat_pen = 0.0; T = d["targets"]; ped_pen = 0.0; sole_gap = []; arm_box = 0.0
            feet = {x: np.where(np.array([n.startswith(("foot_", "ball_")) and n.endswith("_" + x) for n in nm]))[0] for x in "lr"}
            pan = T["seat"][1] - T.get("hipAbovePan", 0.085 * (b.len("thigh_l", "calf_l") / 0.44)); low = np.where(pre("pelvis", "thigh"))[0]
            for t in range(0, len(D), a.step):
                g = d["frames"][t].get("grip", {})
                for x in "lr":
                    if not g.get(x, {}).get("on"): continue
                    c, ax = np.array(g[x]["centre"]), np.array(g[x]["axis"])
                    for gn, idx in groups[x].items():
                        if not len(idx): continue
                        v = skin(b, D[t], P[t], idx); rel = v - c; h = rel @ ax; ok = np.abs(h) < 0.06
                        if not ok.any(): continue
                        sd = np.linalg.norm(rel - np.outer(h, ax), axis=1)[ok] - R; gaps[gn].append(float(sd.min())); pen = max(pen, float(-sd.min()))
                for pr in (d["frames"][t].get("props") or []):
                    at, sz = np.array(pr["at"]), np.array(pr["size"])
                    if pr.get("role") == "pedal":                     # how far foot skin is under the pedal's top face, and how near the sole is to it
                        th = np.radians(pr.get("pitch", 0)); Rm = np.array([[1, 0, 0], [0, np.cos(th), -np.sin(th)], [0, np.sin(th), np.cos(th)]])
                        for x in "lr":
                            loc = (skin(b, D[t], P[t], feet[x]) - at) @ Rm; on = (np.abs(loc[:, 0]) < sz[0] / 2) & (np.abs(loc[:, 2]) < sz[2] / 2) & (loc[:, 1] > -0.03)
                            if on.sum() > 20: h = loc[on, 1] - sz[1] / 2; ped_pen = max(ped_pen, float(-h.min())); sole_gap.append(float(h.min()))
                    elif pr.get("role") == "armrest":
                        loc = np.abs(skin(b, D[t], P[t], core) - at); ins = (loc < sz / 2).all(1)
                        if ins.any(): arm_box = max(arm_box, float((sz / 2 - loc[ins]).min(1).max()))
                if t % (a.step * 5) == 0:
                    v = skin(b, D[t], P[t], low); on = (v[:, 2] > -0.04) & (v[:, 2] < 0.38) & (np.abs(v[:, 0]) < 0.23); seat_pen = max(seat_pen, float(pan - v[on, 1].min()) if on.any() else 0.0)
            r.update({"grip_skin_penetration_max_mm": round(max(pen, 0) * 1000, 1),
                      "grip_gap_mm_median_and_worst": {g: [round(float(np.median(v)) * 1000, 1), round(float(np.max(np.abs(v))) * 1000, 1)] for g, v in gaps.items() if v},
                      "seat_pan_penetration_max_mm": round(max(seat_pen, 0) * 1000, 1), "foot_into_pedal_max_mm": round(max(ped_pen, 0) * 1000, 1),
                      "sole_to_pedal_mm_median": round(float(np.median(sole_gap)) * 1000, 1) if sole_gap else None, "armrest_pad_into_body_mesh_max_mm": round(arm_box * 1000, 1)})
            res[name] = r
        for k, v in res.items(): print(person, k, json.dumps(v))
    out["how"] = "mesh skinned in numpy with the package's 4 weights and _DQS mask (positions: linear blend mixed with dual quaternion per vertex), no pose correctives, no twist-joint drivers beyond the forearm twist baked in the clip; arm depth = how far forearm and hand vertices sit behind the nearest trunk / thigh / head vertex along its normal (within 60 mm); grip gap = nearest skin of each finger and of the palm to the cylinder surface (negative = inside it); every %d-th frame" % a.step
    f = os.path.join(cdir, "metrics-skin.json")
    if (a.operator_only or a.clips) and os.path.exists(f):
        old = json.load(open(f))
        for p_, v_ in out.items():
            if isinstance(v_, dict): old.setdefault(p_, {}).update(v_)
        out = dict(old, how=out["how"])
    json.dump(out, open(f, "w"), indent=1)

def write_idle(path, body, D, pelvis, window, seconds=20.0):
    """A loopable additive layer from the seated take for operator.ts: per joint, the rotation away from the window's
    mean pose as a rotation vector (radians) in rest world axes relative to the parent, 30 fps."""
    a, b = window; n = int(seconds * FPS); mid = (a + b) // 2; a = max(a + 30, mid - n // 2); b = min(b - 30, a + n); n = b - a
    js = {"fps": FPS, "frames": n, "joints": {}, "note": "rotation vector of inv(mean) * (inv(D[parent]) * D[joint]); the last second cross-fades into the first"}
    w = np.clip((np.arange(n) - (n - FPS)) / FPS, 0, 1)[:, None]
    for nme in ["spine_01", "spine_03", "spine_05", "neck_01", "head", "clavicle_l", "clavicle_r"]:
        j = body[nme]; rel = qfix(qmul(qinv(D[a:b, body.parent[j]]), D[a:b, j])); mean = qnorm(rel.mean(0)); r = qlog(qmul(qinv(mean)[None], rel))
        r = smooth(r, 2.0); r = r * (1 - w) + r[0] * w
        js["joints"][nme] = np.round(r, 5).tolist()
    h = pelvis[a:b, 1] - pelvis[a:b, 1].mean(); js["pelvis_sway_m"] = np.round(smooth((pelvis[a:b] - pelvis[a:b].mean(0)) * (1 - w), 3.0), 5).tolist()
    json.dump(js, open(path, "w"))

def clip_arms(checks, path, step=3):
    """Arms against trunk and thighs on every mesh in `checks`, over the frames of a written clip (read back on each body)."""
    out = {}
    for bk, surf, _ in checks:
        D, pelvis, _r = read_clip(path, bk); P = fk(bk, D, pelvis); w = {x: {"low_depth_mm": 0.0, "low_gap_mm": 1e9, "upper_depth_mm": 0.0} for x in "lr"}; at = {}
        for t in range(0, len(D), step):
            m = surf.measure(D[t], P[t])
            for x in "lr":
                if m[x]["low_depth_mm"] > w[x]["low_depth_mm"]: at[x] = round(t / FPS, 2)
                w[x] = {"low_depth_mm": max(w[x]["low_depth_mm"], m[x]["low_depth_mm"]), "low_gap_mm": min(w[x]["low_gap_mm"], m[x]["low_gap_mm"]), "upper_depth_mm": max(w[x]["upper_depth_mm"], m[x]["upper_depth_mm"])}
        out[bk.source.split("package ")[-1].split(" person")[0]] = {**{x: w[x] for x in "lr"}, "deepest_at_s": at}
    return out

def cmd_stand(a):
    """VD/REVIEW-05 item 3 for every packet person of the package: the relaxed stand (arms solved per body against the meshes
    of this package and of the `--also` packages), the standing idle built on it (`idle-stand`, RELAXED_STAND = its frame at
    1.0 s) and the captured standing clip `move-stand` (MOVE_STAND); measured, written to clips/<person>/, the dof fallback
    and the numbers to clips/relaxed-stand.json, then the manifest block."""
    pkg_dir = os.path.join(LAB, a.package) if not os.path.isabs(a.package) else a.package; base, man = load_package(pkg_dir)
    bad = check_skeleton(base)
    if bad: print("SKELETON CHECK FAILED for", pkg_dir); [print("  -", b_) for b_ in bad]; sys.exit(1)
    mesh = load_package_mesh(pkg_dir, man); lib = load_lib(pkg_dir, man); cdir = os.path.join(pkg_dir, "clips")
    also = []
    for d in (a.also.split(",") if a.also else []):
        d = os.path.join(LAB, d) if not os.path.isabs(d) else d; bs, ms = load_package(d); also.append((d, bs, ms, load_package_mesh(d, ms)))
    persons = ([] if a.persons == "-" else a.persons.split(",")) if a.persons else list(man["packet"]["persons"])     # "-": only the package-wide dof set
    sf = os.path.join(cdir, "relaxed-stand.json"); rep = json.load(open(sf)) if os.path.exists(sf) else {}
    rep["persons"] = rep.get("persons", {}); rep["how"] = ("arms: the person's mesh skinned in numpy as the viewer skins it (4 weights, _DQS blend; RR's helper joints are not driven), trunk and thigh triangles sampled every 4 mm; "
        "low = forearm, elbow region, hand and fingers; depth = how far a vertex lies behind the nearest trunk/thigh surface sample along its normal; gap = the smallest distance of an outside vertex; upper = upper arm beyond 40 % of its length against the chest")
    mets = json.load(open(os.path.join(cdir, "metrics.json"))) if os.path.exists(os.path.join(cdir, "metrics.json")) else {"per_body_retarget": {}}
    for person in persons:
        b = package_person(pkg_dir, base, man, mesh, person); b.lib = lib; out = os.path.join(cdir, person); os.makedirs(out, exist_ok=True); write_rest(b, out)
        checks = [(b, Surface(b), np.zeros(3))]
        for d, bs, ms, mm in also:
            if person in (ms.get("packet", {}).get("persons") or {}):
                bk = package_person(d, bs, ms, mm, person); checks.append((bk, Surface(bk), bk.P0[bk["root"]] - b.P0[b["root"]]))
        if a.move_only: R = rep["persons"][person]
        else:
            if a.abd: abd = [float(x) for x in a.abd.split(",")]; res = None
            else: abd, res, _ = solve_stand(b, checks)
            R = {"abduction_deg": {"l": abd[0], "r": abd[1]}, "passed": res, "checked_on": [c[0].source for c in checks]}
            r = build_idle(b, abd); q, tp = to_local(b, r["D"], r["pelvis"], None); path = os.path.join(out, "idle-stand.glb")
            write_clip(path, b, "idle-stand", q, tp, None, extras={"source": "pipeline/motion.py build_idle (relaxed stand + procedural layer; no captured data)", "fps": FPS, "body": person, "skeleton": b.signature()})
            D2, p2, _ = read_clip(path, b); m = measure(b, D2, p2, r["con"], q); m.update(foot_slide(b, D2, p2)); m["frames"] = len(q); m["seconds"] = round((len(q) - 1) / FPS, 2)
            k = r["info"]["relaxed_stand_frame"]; _, _, info = stand_pose(b, abd)
            R["stand"] = {"frame": k, "time_s": k / FPS, "legs_and_arms": info, "arms_on_meshes": {c[0].source.split("package ")[-1].split(" person")[0]: c[1].measure(D2[k], fk(c[0], D2[k:k + 1], p2[k:k + 1] + c[2])[0]) for c in checks}}
            R["idle_arms_on_meshes"] = clip_arms(checks, path); R["idle"] = m
            vals, resid = fit_dofs(b, lib, D2, k); R["dofs"] = vals; R["dof_fit_worst_residual_deg"] = resid
            json.dump({"clip": "idle-stand", "what": CLIPS["idle-stand"]["what"], "source": "none (built by pipeline/motion.py)", "fps": FPS, "frames": len(q), "body": person, "skeleton": b.signature(),
                       "contacts": {x: c.tolist() for x, c in r["con"].items()}, "contact_code": "0 none, 1 heel only, 2 ball only, 3 flat", "relaxed_stand": R, "metrics": m}, open(os.path.join(out, "idle-stand.json"), "w"))
            mets["per_body_retarget"].setdefault(person, {})["idle-stand"] = m
            print(f"{person:12s} stand: abduction L {abd[0]:.2f} R {abd[1]:.2f}  " + "  ".join(f"{n}: L {v['l']} R {v['r']}" for n, v in R["stand"]["arms_on_meshes"].items()))
            print(f"{'':12s} idle: slide {m['slide_mm_per_frame_max']} mm/frame, step {m['joint_change_max_deg_per_frame']} deg ({m['joint_change_where']}); arms over the clip: " + json.dumps(R["idle_arms_on_meshes"]))
        if not a.skip_move:
            r = build_clip(b, "move-stand"); q, tp = to_local(b, r["D"], r["pelvis"], None); path = os.path.join(out, "move-stand.glb")
            write_clip(path, b, "move-stand", q, tp, None, extras={"source": "CMU Graphics Lab Motion Capture Database, take " + CLIPS["move-stand"]["src"], "credit": CREDIT, "fps": FPS, "body": person, "skeleton": b.signature()})
            D2, p2, _ = read_clip(path, b); m = measure(b, D2, p2, r["con"], q); raw = measure(b, r["raw"][0], r["raw"][1], r["con"])
            m["before_planting"] = {k_: raw[k_] for k_ in ("foot_slide_max_mm", "floor_penetration_max_mm", "arm_into_body_max_mm") if k_ in raw}
            m["independent"] = foot_slide(b, D2, p2); m["independent_before_planting"] = foot_slide(b, r["raw"][0], r["raw"][1]); m["packet_measure"] = packet_slide(b, D2, p2)
            m["frames"] = len(q); m["seconds"] = round((len(q) - 1) / FPS, 2); m.update({k_: (round(v, 3) if isinstance(v, float) else v) for k_, v in r["info"].items() if k_ not in "lr"})
            m["arms_on_meshes"] = clip_arms(checks, path)
            json.dump({"clip": "move-stand", "what": CLIPS["move-stand"]["what"], "source": "CMU take " + CLIPS["move-stand"]["src"], "licence": "CMU: free to copy, modify and redistribute; not to be resold as data", "credit": CREDIT,
                       "fps": FPS, "frames": len(q), "body": person, "skeleton": b.signature(), "contacts": {x: c.tolist() for x, c in r["con"].items()}, "contact_code": "0 none, 1 heel only, 2 ball only, 3 flat",
                       "cleaning_removed_p99_deg": round(float(np.median([v for k_, v in r["src"].cleaned.items() if k_ != "root_mm"])), 2), "metrics": m}, open(os.path.join(out, "move-stand.json"), "w"))
            mets["per_body_retarget"][person]["move-stand"] = m; R["move_stand"] = {k_: m[k_] for k_ in ("seconds", "foot_slide_max_mm", "floor_penetration_max_mm", "planted_height_error_max_mm", "joint_change_max_deg_per_frame", "joint_change_where", "independent", "arms_on_meshes")}
            print(f"{'':12s} move-stand {m['seconds']} s: slide (planter labels) {m['foot_slide_max_mm']} mm, independent {m['independent']['slide_mm_per_frame_max']} mm/frame (p95 {m['independent']['slide_mm_per_frame_p95']}), drift {m['independent']['drift_in_one_contact_max_mm']} mm; "
                  f"before planting {m['independent_before_planting']['slide_mm_per_frame_max']} mm/frame; floor pen {m['floor_penetration_max_mm']}; step {m['joint_change_max_deg_per_frame']} ({m['joint_change_where']}); arms " + json.dumps(m["arms_on_meshes"]))
        rep["persons"][person] = R
        cur = json.load(open(sf)) if os.path.exists(sf) else {}; cur.setdefault("persons", {})[person] = R; cur.update({k_: v for k_, v in rep.items() if k_ != "persons"}); rep["persons"] = {**cur["persons"], **rep["persons"]}
        json.dump(cur, open(sf, "w"), indent=1)                                  # one person at a time: runs per person may go in parallel
        mf_ = os.path.join(cdir, "metrics.json"); curm = json.load(open(mf_)) if os.path.exists(mf_) else {"per_body_retarget": {}}
        curm.setdefault("per_body_retarget", {}).setdefault(person, {}).update(mets["per_body_retarget"].get(person, {})); json.dump(curm, open(mf_, "w"), indent=1)
    # one dof set for every person of the package (renderers that need a dof pose): the first packet person's fit, with each
    # arm taken from the person whose arm stands widest; checked on every person and mesh
    if os.path.exists(sf): rep["persons"] = {**json.load(open(sf)).get("persons", {}), **rep["persons"]}
    order = [p for p in man["packet"]["persons"] if p in rep["persons"]]
    if order:
        ref = order[0]; vals = dict(rep["persons"][ref]["dofs"])
        for i, x in enumerate("lr"):
            wide = max(order, key=lambda p_: rep["persons"][p_]["abduction_deg"][x])
            for k_ in [k_ for k_ in vals if k_.split("_")[0] in ("clavicle", "shoulder", "elbow", "forearm", "wrist") and k_.split(".")[0].endswith("_" + x)]: vals.pop(k_)
            vals.update({k_: v for k_, v in rep["persons"][wide]["dofs"].items() if k_.split("_")[0] in ("clavicle", "shoulder", "elbow", "forearm", "wrist") and k_.split(".")[0].endswith("_" + x)})
            rep.setdefault("dofs_all_bodies_arms_from", {})[x] = wide
        rep["dofs_all_bodies"] = vals; rep["dofs_all_bodies_check"] = {}
        for person in order:
            b = package_person(pkg_dir, base, man, mesh, person); b.lib = lib; D, pel = dofs_pose(b, lib, vals); D = _finish(b, D, lib_fingers(b, 1, t0=0.0)); P = fk(b, D, pel)
            feet = {x: round(float((P[0, b[f"foot_{x}"], 1] - b.P0[b[f"foot_{x}"], 1]) * 1000), 1) for x in "lr"}
            rep["dofs_all_bodies_check"][person] = {"ankle_above_rest_height_mm": feet, "arms": Surface(b).measure(D[0], P[0])}
            print("dofs (all bodies) on", person, json.dumps(rep["dofs_all_bodies_check"][person]))
    rep["params"] = STAND; cur = json.load(open(sf)) if os.path.exists(sf) else {}; cur.update({k_: v for k_, v in rep.items() if k_ != "persons"}); cur.setdefault("persons", {}).update(rep["persons"])
    json.dump(cur, open(sf, "w"), indent=1)
    write_manifest(pkg_dir, man, persons, list(CLIPS))

def seat_sink(b, frames, pan_y, lift=0.0):
    """How deep the un-flattened buttock and thigh skin of a seated body sits below the seat pan's top, per sampled frame (m):
    vertices whose dominant joint is pelvis, thigh (and its twist joints) or the glute / hip-belly / groin helpers, over the pan
    (|x| < 0.28 m, from 0.30 m behind to 0.34 m ahead of the hip centre: the pan's flat part, before its 40 mm front round-off).
    Also the lowest such skin below the hip centre at each frame (m) and where the deepest point is."""
    nm = np.array(b.names)[b.dom]; reg = np.where(np.array([n.startswith(("pelvis", "thigh", "glute", "hip_belly", "groin")) for n in nm]))[0]
    out = []
    for fr in frames:
        q = np.array(fr["q"])[None]; tp = np.array(fr["p"])[None]; D, pelvis, _ = world_from_local(b, q, tp); P = fk(b, D, pelvis)
        v = skin(b, D[0], P[0], reg); hc = (P[0, b["thigh_l"]] + P[0, b["thigh_r"]]) / 2
        on = (np.abs(v[:, 0]) < 0.28) & (v[:, 2] > hc[2] - 0.30) & (v[:, 2] < hc[2] + 0.34)
        k = np.argmin(v[on, 1]); vv = v[on][k]
        out.append({"t": fr.get("t"), "sink_m": float(pan_y + lift - vv[1]), "lowest_below_hip_m": float(hc[1] - vv[1]), "hip_above_pan_m": float(hc[1] - pan_y - lift),
                    "deepest": f"{nm[reg][on][k]} at x {vv[0] - hc[0]:+.3f}, z {vv[2] - hc[2]:+.3f} from the hip centre"})
    return out

def cmd_seatsink(a):
    """Seat sink per person from seat-test frames (B4/seat-test.ts), on the body package and on --also packages (abstract: lifted
    by their sole). Prints and writes <dir>/sink-<mode>.json."""
    res = {}; tests = json.load(open(os.path.join(a.dir, f"seat-{a.mode}.json")))
    pk = {}
    for name in ["body-clay", "body-clay-f"] + (a.also.split(",") if a.also else []):
        d = os.path.join(LAB, "packages", name); bs, ms = load_package(d); pk[name] = (d, bs, ms, load_package_mesh(d, ms))
    for person, t in tests.items():
        fr = json.load(open(os.path.join(a.dir, f"{person}.{a.mode}.frames.json"))); res[person] = {"hip_above_pan_mm": t["hip_above_pan_mm"], "hand_mm": t["hand_contact_error_max_mm"], "foot_mm": t["foot_contact_error_max_mm"], "leg_reach_mm": t["leg_out_of_reach_max_mm"]}
        for name, (d, bs, ms, mm) in pk.items():
            if person not in (ms.get("packet", {}).get("persons") or {}): continue
            if name.startswith("body-clay") and name != t["pkg"]: continue
            b = package_person(d, bs, ms, mm, person); lift = float(b.P0[b["root"]][1])
            s = seat_sink(b, fr["frames"], t["pan_y"], lift)
            res[person][name] = {"sink_frame0_mm": round(s[0]["sink_m"] * 1000, 1), "sink_max_mm": round(max(x["sink_m"] for x in s) * 1000, 1), "at_s": s[int(np.argmax([x["sink_m"] for x in s]))]["t"],
                                 "lowest_below_hip_frame0_mm": round(s[0]["lowest_below_hip_m"] * 1000, 1), "deepest_frame0": s[0]["deepest"]}
        print(a.mode, person, json.dumps(res[person]))
    json.dump(res, open(os.path.join(a.dir, f"sink-{a.mode}.json"), "w"), indent=1)

def cmd_check(a):
    pkg_dir = os.path.join(LAB, a.package) if not os.path.isabs(a.package) else a.package
    try: body, man = load_package(pkg_dir)
    except Exception as e: print("SKELETON CHECK FAILED: cannot read the package:", repr(e)); sys.exit(1)
    ref = None; cdir = os.path.join(pkg_dir, "clips")
    side = [f for f in (os.listdir(cdir) if os.path.isdir(cdir) else []) if f.endswith(".json")]
    if side: ref = json.load(open(os.path.join(cdir, side[0]))).get("skeleton")
    elif a.against_standin: ref = load_standin("M50").signature()
    bad = check_skeleton(body, ref)
    if bad:
        print("=" * 100); print("SKELETON CHECK FAILED:", pkg_dir); [print("  -", b) for b in bad]; print("=" * 100); sys.exit(1)
    print("skeleton check passed:", len(body.names), "joints (%d helpers beyond the 82: %s); frames signature" % (len(check_skeleton.helpers), ", ".join(check_skeleton.helpers) or "none"), body.signature())

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("--package"); b.add_argument("--out"); b.add_argument("--persons", default="F05,M50,M95H"); b.add_argument("--clips")
    c = sub.add_parser("check"); c.add_argument("--package", required=True); c.add_argument("--against-standin", action="store_true")
    k = sub.add_parser("bake"); k.add_argument("--package", required=True)
    rs = sub.add_parser("rest"); rs.add_argument("--package", required=True)
    ft = sub.add_parser("fit"); ft.add_argument("--package", required=True)
    m = sub.add_parser("skin"); m.add_argument("--package", required=True); m.add_argument("--step", type=int, default=3); m.add_argument("--operator-only", action="store_true"); m.add_argument("--clips")
    sd = sub.add_parser("stand"); sd.add_argument("--package", required=True); sd.add_argument("--also"); sd.add_argument("--persons"); sd.add_argument("--abd"); sd.add_argument("--skip-move", action="store_true"); sd.add_argument("--move-only", action="store_true")
    ss = sub.add_parser("seatsink"); ss.add_argument("--dir", required=True); ss.add_argument("--mode", required=True); ss.add_argument("--also")
    a = ap.parse_args(); {"seatsink": cmd_seatsink, "stand": cmd_stand, "build": cmd_build, "check": cmd_check, "bake": cmd_bake, "skin": lambda a: cmd_skin(a), "fit": cmd_fit, "rest": cmd_rest}[a.cmd](a)
