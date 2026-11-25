# GLB writer for avatar packages (FORMAT.md v0.1): glTF 2.0 binary, metres, +Y up, facing +Z; one skin shared by every
# mesh; smooth normals computed on the unsplit topology and vertices split only at UV seams; four influences per vertex,
# pruned and renormalised here; morph targets with POSITION and NORMAL deltas and extras.targetNames.
# Owner: B1. API documented in pipeline/README.md, section "Core".
import json, os, struct
from dataclasses import dataclass, field
import numpy as np
import scipy.sparse as sp
import mh_core as mh


@dataclass
class Skeleton:
    names: list
    parent: np.ndarray
    head: np.ndarray                 # (B,3) rest world positions
    rot: np.ndarray = None           # (B,4) rest world rotations x,y,z,w; None = world-aligned


@dataclass
class Mesh:
    name: str
    v: np.ndarray
    tris: np.ndarray
    material: str
    uv: np.ndarray = None
    tri_uv: np.ndarray = None
    joints: np.ndarray = None
    weights: object = None           # (n,4) with `joints`, or a sparse/dense (n,B) matrix (pruned here)
    morphs: dict = field(default_factory=dict)
    morph_normals: bool = True
    normals: np.ndarray = None
    color: np.ndarray = None         # COLOR_0: (n,) -> red channel, (n,3) or (n,4)
    attrs: dict = None               # custom vertex attributes, e.g. {"_DQS": (n,)}: 1-D -> SCALAR, (n,k) -> VECk; float32, or uint8/uint16 for integer arrays
    extras: dict = None


_CT = {np.dtype(np.float32): 5126, np.dtype(np.uint16): 5123, np.dtype(np.uint8): 5121, np.dtype(np.uint32): 5125}
_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


class _Buf:
    def __init__(self): self.parts = []; self.views = []; self.accs = []; self.off = 0
    def view(self, b, target=None):
        pad = (-len(b)) % 4
        v = {"buffer": 0, "byteOffset": self.off, "byteLength": len(b)}
        if target: v["target"] = target
        self.views.append(v); self.parts.append(b + b"\0" * pad); self.off += len(b) + pad
        return len(self.views) - 1
    def acc(self, arr, typ, dtype, target=None, minmax=False, normalized=False):
        a = np.ascontiguousarray(arr, dtype=dtype)
        d = {"bufferView": self.view(a.tobytes(), target), "componentType": _CT[np.dtype(dtype)], "count": int(a.shape[0]), "type": typ}
        if normalized: d["normalized"] = True
        if minmax: d["min"] = a.min(0).reshape(-1).tolist(); d["max"] = a.max(0).reshape(-1).tolist()
        self.accs.append(d); return len(self.accs) - 1


def _qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])


def _qrot(q, v):
    x, y, z, w = q; u = np.array([x, y, z])
    return v + 2 * np.cross(u, np.cross(u, v) + w * v)


def write_glb(path, meshes, skeleton, materials, animations=None, generator="rigtwin avatar-lab pipeline/glb.py", extras=None):
    B = _Buf(); nodes = []; gl_meshes = []; gl_mats = []; mat_ix = {}; images = []; textures = []; tex_of = {}; stats = {"meshes": []}
    scene_nodes = []; skins = []
    # ---- skeleton
    nb = 0
    if skeleton is not None:
        nb = len(skeleton.names)
        assert len(set(skeleton.names)) == nb, "joint names must be unique"
        head = np.asarray(skeleton.head, dtype=np.float64); par = np.asarray(skeleton.parent)
        rot = None if skeleton.rot is None else np.asarray(skeleton.rot, dtype=np.float64)
        ibm = np.zeros((nb, 4, 4), dtype=np.float32)
        for i in range(nb):
            p = int(par[i]); assert p < i, "parents must come before children"
            if rot is None:
                t = head[i] - (head[p] if p >= 0 else 0); n = {"name": skeleton.names[i], "translation": [float(x) for x in t]}
                M = np.eye(4); M[:3, 3] = -head[i]
            else:
                q = rot[i] / np.linalg.norm(rot[i])
                if p >= 0:
                    qp = rot[p] / np.linalg.norm(rot[p]); qpi = qp * np.array([-1, -1, -1, 1])
                    t = _qrot(qpi, head[i] - head[p]); ql = _qmul(qpi, q)
                else:
                    t = head[i]; ql = q
                n = {"name": skeleton.names[i], "translation": [float(x) for x in t], "rotation": [float(x) for x in ql]}
                x, y, z, w = q
                R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
                M = np.eye(4); M[:3, :3] = R.T; M[:3, 3] = -R.T @ head[i]
            ibm[i] = M.T                                  # glTF matrices are column-major
            nodes.append(n)
        for i in range(nb):
            if par[i] >= 0: nodes[int(par[i])].setdefault("children", []).append(i)
        roots = [i for i in range(nb) if par[i] < 0]; scene_nodes += roots
        skins.append({"joints": list(range(nb)), "inverseBindMatrices": B.acc(ibm.reshape(-1, 16), "MAT4", np.float32), "skeleton": roots[0]})

    def material(name):
        if name in mat_ix: return mat_ix[name]
        src = dict(materials.get(name, {})); imgs = src.pop("_images", {})
        m = {"name": name, **src}
        for slot, file in imgs.items():
            key = os.path.abspath(file)                          # one image per source file (an ORM used for two slots was written twice; B2, round 6)
            if key not in tex_of:
                data = open(file, "rb").read()
                images.append({"bufferView": B.view(data), "mimeType": _MIME[os.path.splitext(file)[1].lower()], "name": os.path.basename(file)})
                textures.append({"source": len(images) - 1, "sampler": 0}); tex_of[key] = len(textures) - 1
            ref = {"index": tex_of[key]}
            if slot in ("baseColorTexture", "metallicRoughnessTexture"): m.setdefault("pbrMetallicRoughness", {})[slot] = ref
            else: m[slot] = ref
        mat_ix[name] = len(gl_mats); gl_mats.append(m)
        return mat_ix[name]

    target_names = None
    for me in meshes:
        v = np.asarray(me.v, dtype=np.float64); tris = np.asarray(me.tris, dtype=np.int64)
        n0 = mh.smooth_normals(v, tris) if me.normals is None else np.asarray(me.normals, dtype=np.float64)
        if me.uv is not None and me.tri_uv is not None:
            vmap, uvmap, t2 = mh.split_seams(tris, me.tri_uv)
            uv = np.asarray(me.uv, dtype=np.float64)[uvmap].copy(); uv[:, 1] = 1.0 - uv[:, 1]
        else:
            used = np.unique(tris); remap = np.full(len(v), -1); remap[used] = np.arange(len(used))
            vmap = used; t2 = remap[tris]; uv = None
        # drop nothing else: vmap also removes vertices no triangle uses
        attrs = {"POSITION": B.acc(v[vmap], "VEC3", np.float32, 34962, True), "NORMAL": B.acc(n0[vmap], "VEC3", np.float32, 34962)}
        if uv is not None: attrs["TEXCOORD_0"] = B.acc(uv, "VEC2", np.float32, 34962)
        if skeleton is not None and me.weights is not None:
            if me.joints is None: J, W = mh.prune_weights(me.weights, 4)
            else: J, W = np.asarray(me.joints), np.asarray(me.weights, dtype=np.float32)
            assert J.max() < nb
            attrs["JOINTS_0"] = B.acc(J[vmap], "VEC4", np.uint8 if nb <= 256 else np.uint16, 34962)
            attrs["WEIGHTS_0"] = B.acc(W[vmap], "VEC4", np.float32, 34962)
        if me.color is not None:
            col = np.asarray(me.color, dtype=np.float64)
            if col.ndim == 1: col = np.stack([col, np.zeros_like(col), np.zeros_like(col), np.ones_like(col)], 1)
            attrs["COLOR_0"] = B.acc(col[vmap], "VEC4" if col.shape[1] == 4 else "VEC3", np.float32, 34962)
        for an, arr in (me.attrs or {}).items():
            arr = np.asarray(arr)
            dt = (np.uint8 if arr.max() < 256 else np.uint16) if arr.dtype.kind in "iu" else np.float32      # integer arrays (joint indices) stay integers
            attrs[an] = B.acc(arr[vmap].reshape(len(vmap), -1), "SCALAR" if arr.ndim == 1 else "VEC%d" % arr.shape[1], dt, 34962)
        prim = {"attributes": attrs, "indices": B.acc(t2.reshape(-1, 1), "SCALAR", np.uint16 if len(vmap) < 65535 else np.uint32, 34963), "material": material(me.material)}
        names = list(me.morphs)
        if names:
            if target_names is None: target_names = names
            tg = []
            for nm in names:
                d = np.asarray(me.morphs[nm], dtype=np.float64)
                t = {"POSITION": B.acc(d[vmap], "VEC3", np.float32, 34962, True)}
                if me.morph_normals:
                    dn = mh.smooth_normals(v + d, tris) - n0
                    t["NORMAL"] = B.acc(dn[vmap], "VEC3", np.float32, 34962)
                tg.append(t)
            prim["targets"] = tg
        gm = {"name": me.name, "primitives": [prim]}
        if names: gm["weights"] = [0.0] * len(names); gm["extras"] = {"targetNames": names}
        if me.extras: gm.setdefault("extras", {}).update(me.extras)
        gl_meshes.append(gm)
        node = {"name": me.name, "mesh": len(gl_meshes) - 1}
        if "JOINTS_0" in attrs: node["skin"] = 0
        nodes.append(node); scene_nodes.append(len(nodes) - 1)
        stats["meshes"].append({"name": me.name, "vertices": int(len(vmap)), "source_vertices": int(len(np.unique(tris))), "triangles": int(len(t2)), "targets": len(names)})

    g = {"asset": {"version": "2.0", "generator": generator}, "scene": 0, "scenes": [{"nodes": scene_nodes}], "nodes": nodes, "meshes": gl_meshes,
         "materials": gl_mats, "accessors": B.accs, "bufferViews": B.views}
    if skins: g["skins"] = skins
    if images: g["images"] = images; g["textures"] = textures; g["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    if animations: g["animations"] = _animations(animations, B, nodes)
    if extras: g["extras"] = extras
    g["accessors"] = B.accs; g["bufferViews"] = B.views
    blob = b"".join(B.parts); g["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(g, separators=(",", ":")).encode(); js += b" " * ((-len(js)) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)
    stats["bytes"] = os.path.getsize(path); stats["bones"] = nb
    return stats


def _animations(anims, B, nodes):
    """anims: [{"name", "times": (n,), "rotations": {joint name: (n,4)}, "translations": {joint name: (n,3)}}]"""
    ix = {n["name"]: i for i, n in enumerate(nodes)}; out = []
    for a in anims:
        tin = B.acc(np.asarray(a["times"], dtype=np.float32).reshape(-1, 1), "SCALAR", np.float32, None, True)
        samplers = []; channels = []
        for path, key, typ in (("rotation", "rotations", "VEC4"), ("translation", "translations", "VEC3")):
            for j, arr in (a.get(key) or {}).items():
                samplers.append({"input": tin, "output": B.acc(arr, typ, np.float32), "interpolation": "LINEAR"})
                channels.append({"sampler": len(samplers) - 1, "target": {"node": ix[j], "path": path}})
        out.append({"name": a["name"], "samplers": samplers, "channels": channels})
    return out


def read_glb(path):
    d = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", d, 0); assert magic == 0x46546C67 and ver == 2 and total == len(d)
    n, t = struct.unpack_from("<II", d, 12); js = json.loads(d[20:20 + n]); o = 20 + n
    n2, t2 = struct.unpack_from("<II", d, o)
    return js, d[o + 8:o + 8 + n2]


_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_DT = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}


def accessor(js, blob, i):
    a = js["accessors"][i]; bv = js["bufferViews"][a["bufferView"]]
    arr = np.frombuffer(blob, dtype=_DT[a["componentType"]], count=a["count"] * _NC[a["type"]], offset=bv.get("byteOffset", 0) + a.get("byteOffset", 0))
    return arr.reshape(a["count"], _NC[a["type"]])


def validate(path):
    """Structural self-check; returns a list of problems (empty = clean)."""
    js, blob = read_glb(path); bad = []
    for i, a in enumerate(js["accessors"]):
        bv = js["bufferViews"][a["bufferView"]]
        need = a["count"] * _NC[a["type"]] * np.dtype(_DT[a["componentType"]]).itemsize
        if need > bv["byteLength"]: bad.append("accessor %d overruns its view" % i)
        if bv.get("byteOffset", 0) % 4: bad.append("view of accessor %d not 4-byte aligned" % i)
    nb = len(js["skins"][0]["joints"]) if js.get("skins") else 0
    for m in js["meshes"]:
        for p in m["primitives"]:
            at = p["attributes"]; n = js["accessors"][at["POSITION"]]["count"]
            for k, ai in at.items():
                if js["accessors"][ai]["count"] != n: bad.append("%s: %s count differs" % (m["name"], k))
            idx = accessor(js, blob, p["indices"])
            if idx.max() >= n: bad.append("%s: index out of range" % m["name"])
            if len(idx) % 3: bad.append("%s: index count not a multiple of 3" % m["name"])
            nn = np.linalg.norm(accessor(js, blob, at["NORMAL"]), axis=1)
            if np.abs(nn - 1).max() > 1e-3: bad.append("%s: %d normals not unit length" % (m["name"], int((np.abs(nn - 1) > 1e-3).sum())))
            if not np.isfinite(accessor(js, blob, at["POSITION"])).all(): bad.append("%s: non-finite positions" % m["name"])
            if "JOINTS_0" in at:
                J = accessor(js, blob, at["JOINTS_0"]); W = accessor(js, blob, at["WEIGHTS_0"])
                if J.max() >= nb: bad.append("%s: joint index out of range" % m["name"])
                tot = W.sum(1) + (accessor(js, blob, at["WEIGHTS_1"]).sum(1) if "WEIGHTS_1" in at else 0)        # glTF: all sets together sum to 1
                if np.abs(tot - 1).max() > 1e-4: bad.append("%s: weights do not sum to 1" % m["name"])
                if "JOINTS_1" in at and accessor(js, blob, at["JOINTS_1"]).max() >= nb: bad.append("%s: JOINTS_1 index out of range" % m["name"])
                if ((W == 0) & (J != 0)).any(): bad.append("%s: zero weight with a non-zero joint" % m["name"])
            if "_JOINTS8_0" in at:
                J8 = np.concatenate([accessor(js, blob, at["_JOINTS8_0"]), accessor(js, blob, at["_JOINTS8_1"])], 1); W8 = np.concatenate([accessor(js, blob, at["_WEIGHTS8_0"]), accessor(js, blob, at["_WEIGHTS8_1"])], 1)
                if J8.max() >= nb: bad.append("%s: 8-influence joint index out of range" % m["name"])
                if np.abs(W8.sum(1) - 1).max() > 1e-4: bad.append("%s: 8-influence weights do not sum to 1" % m["name"])
            for t in p.get("targets", []):
                for k, ai in t.items():
                    if js["accessors"][ai]["count"] != n: bad.append("%s: target %s count differs" % (m["name"], k))
            if p.get("targets") and len(m.get("extras", {}).get("targetNames", [])) != len(p["targets"]): bad.append("%s: targetNames length" % m["name"])
    return bad
