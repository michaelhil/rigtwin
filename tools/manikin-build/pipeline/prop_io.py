"""Props (owner: B6): read a package GLB back into simple meshes so props can bind to what B2 built."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import glb


class RefMesh:
    """Same field names as glb.Mesh where it matters: v, tris, morphs, joints (n,4), weights (n,4), uv (per vertex)."""
    def __init__(self, name, v, tris, morphs, joints, weights, uv):
        self.name, self.v, self.tris, self.morphs, self.joints, self.weights, self.uv = name, v, tris, morphs, joints, weights, uv


def load_package(path, lift=0.0, want=None, morphs=True):
    """name -> RefMesh from a package GLB (split vertices as stored).  `lift` is subtracted from y."""
    j, b = glb.read_glb(path)
    out = {}
    for m in j["meshes"]:
        name = m["name"]
        if want is not None and name not in want: continue
        p = m["primitives"][0]; a = p["attributes"]
        v = glb.accessor(j, b, a["POSITION"]).astype(np.float64); v[:, 1] -= lift
        tris = glb.accessor(j, b, p["indices"]).reshape(-1, 3).astype(np.int64)
        names = (m.get("extras") or {}).get("targetNames") or []
        mo = {}
        if morphs:
            for n, t in zip(names, p.get("targets", [])):
                mo[n] = glb.accessor(j, b, t["POSITION"]).astype(np.float64)
        J = glb.accessor(j, b, a["JOINTS_0"]).astype(np.int64) if "JOINTS_0" in a else None
        W = glb.accessor(j, b, a["WEIGHTS_0"]).astype(np.float64) if "WEIGHTS_0" in a else None
        uv = glb.accessor(j, b, a["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in a else None
        out[name] = RefMesh(name, v, tris, mo, J, W, uv)
    skin = j["skins"][0]; names = [j["nodes"][i]["name"] for i in skin["joints"]]
    if morphs: _baked_morphs(path, j, b, out)
    return out, names


def _baked_morphs(path, j, b, out):
    """FORMAT v0.4, 2d: a mesh whose shape is baked on the CPU has no shape morphs in the GLB; they are in
    <name>.shape.bin, indexed by the mesh's `_SRC` attribute."""
    import json, os
    man = os.path.splitext(path)[0] + ".avatar.json"
    if not os.path.exists(man): return
    bake = (json.load(open(man)).get("shape") or {}).get("bake")
    for block in (bake if isinstance(bake, list) else [bake] if bake else []):
        N = block["vertices"]; raw = open(os.path.join(os.path.dirname(path), block["file"]), "rb").read(); K = len(block["targets"])
        q = np.frombuffer(raw, dtype="<i2", count=K * N * 3, offset=N * 12).reshape(K, N, 3)
        for m in j["meshes"]:
            if m["name"] not in block.get("meshes", []) or m["name"] not in out: continue
            a = m["primitives"][0]["attributes"]
            src = glb.accessor(j, b, a["_SRC"]).astype(np.int64).ravel() if "_SRC" in a else np.arange(N)
            for k, n in enumerate(block["targets"]): out[m["name"]].morphs[n] = q[k][src].astype(np.float64) / 32767 * block["targetScale"][k]


def load_skeleton(path, lift=0.0):
    """glb.Skeleton of a package (rest joint positions from the inverse bind matrices; world-aligned frames)."""
    j, b = glb.read_glb(path); skin = j["skins"][0]; nodes = skin["joints"]
    names = [j["nodes"][i]["name"] for i in nodes]
    M = glb.accessor(j, b, skin["inverseBindMatrices"]).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
    head = np.linalg.inv(M)[:, :3, 3]; head[:, 1] -= lift
    par = np.full(len(nodes), -1); idx = {n: k for k, n in enumerate(nodes)}
    for n in nodes:
        for ch in j["nodes"][n].get("children", []):
            if ch in idx: par[idx[ch]] = idx[n]
    return glb.Skeleton(names, par, head, None)
