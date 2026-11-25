"""pc_soma_io: minimal readers for the SOMA-X 0.3.0 assets (Apache-2.0) used by pc_soma.py. Owner: B3.
No pxr, no soma package: the USDA is ASCII and only five arrays are needed. Downloaded files are data only."""
import os, re, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SOMA = os.path.normpath(os.path.join(__import__("labpaths").LAB, "downloads", "soma-x", "assets"))
CACHE = os.path.join(__import__("labpaths").LAB, "pipeline", "pc_data", "soma_rig_cache.npz")

def _arr(line):
    s = line[line.index("=") + 1:]
    return np.array(re.sub(r"[\[\]\(\),]", " ", s).split(), dtype=np.float64)

def load_rig():
    """SOMA template rig from the USDA: joint names and parents (110), bind world matrices (column-vector convention,
    cm), c_skin_mid bind points (cm), faces, skin weights (sparse V x 110)."""
    import scipy.sparse as sp
    if os.path.exists(CACHE):
        z = np.load(CACHE, allow_pickle=False)
        W = sp.csr_matrix((z["w_data"], z["w_indices"], z["w_indptr"]), shape=tuple(z["w_shape"]))
        return dict(names=[str(s) for s in z["names"]], parent=z["parent"], bind=z["bind"], rest=z["rest"], points=z["points"], fvi=z["fvi"], fvc=z["fvc"], W=W)
    out = {}; mesh = None; skel = False; last = None
    with open(os.path.join(SOMA, "SOMA_template_rig.usda"), "r") as fh:
        for line in fh:
            s = line.strip()
            if s.startswith('def Mesh "'): mesh = s.split('"')[1]
            elif s.startswith('def Skeleton "'): skel = True
            elif s.startswith('def SkelAnimation'): skel = False
            if skel and s.startswith("uniform matrix4d[] bindTransforms") and "bind" not in out:
                out["bind"] = np.transpose(_arr(s).reshape(-1, 4, 4), (0, 2, 1))
            elif skel and s.startswith("uniform matrix4d[] restTransforms") and "rest" not in out:
                out["rest"] = np.transpose(_arr(s).reshape(-1, 4, 4), (0, 2, 1))
            elif skel and s.startswith("uniform token[] joints") and "paths" not in out:
                out["paths"] = re.findall(r'"([^"]+)"', s)
            elif mesh == "c_skin_mid":
                if s.startswith("point3f[] points") and "points" not in out: out["points"] = _arr(s).reshape(-1, 3)
                elif s.startswith("int[] faceVertexIndices") and "fvi" not in out: out["fvi"] = _arr(s).astype(np.int64)
                elif s.startswith("int[] faceVertexCounts") and "fvc" not in out: out["fvc"] = _arr(s).astype(np.int64)
                elif s.startswith("int[] primvars:skel:jointIndices"): out["ji"] = _arr(s).astype(np.int64); last = "ji"
                elif s.startswith("float[] primvars:skel:jointWeights"): out["jw"] = _arr(s); last = "jw"
                elif s.startswith("elementSize") and last: out[last + "_n"] = int(s.split("=")[1]); last = None
                elif s.startswith("uniform token[] skel:joints"): out["mesh_paths"] = re.findall(r'"([^"]+)"', s)
    paths = out["paths"]; names = [p.split("/")[-1] for p in paths]; pi = {p: i for i, p in enumerate(paths)}
    parent = np.array([pi.get(p.rsplit("/", 1)[0], -1) if "/" in p else -1 for p in paths])
    n = len(out["points"]); k = out["ji_n"]; col = np.array([pi[p] for p in out.get("mesh_paths", paths)])[out["ji"]]
    W = sp.coo_matrix((out["jw"], (np.repeat(np.arange(n), k), col)), shape=(n, len(paths))).tocsr(); W.eliminate_zeros()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    np.savez_compressed(CACHE, names=np.array(names), parent=parent, bind=out["bind"], rest=out["rest"], points=out["points"], fvi=out["fvi"], fvc=out["fvc"],
                        w_data=W.data, w_indices=W.indices, w_indptr=W.indptr, w_shape=np.array(W.shape))
    return dict(names=names, parent=parent, bind=out["bind"], rest=out["rest"], points=out["points"], fvi=out["fvi"], fvc=out["fvc"], W=W)

def load_obj(path):
    v = []; f = []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "): v.append(line.split()[1:4])
            elif line.startswith("f "): f.append([int(t.split("/")[0]) - 1 for t in line.split()[1:]])
    return np.array(v, dtype=np.float64), f

def tri_faces(faces):
    out = []
    for f in faces:
        for k in range(1, len(f) - 1): out.append((f[0], f[k], f[k + 1]))
    return np.array(out, dtype=np.int64)

def faces_from_counts(fvi, fvc):
    out = []; p = 0
    for c in fvc:
        out.append(list(fvi[p:p + c])); p += c
    return out

class Correctives:
    """SOMA-X pose-corrective model (soma/correctives_model.py, CorrectivesMLP.forward) in numpy/scipy."""
    def __init__(self):
        import torch, scipy.sparse as sp
        ck = torch.load(os.path.join(SOMA, "correctives_model.pt"), map_location="cpu", weights_only=True)
        self.C = int(ck["C_max"]); self.tanh = bool(ck.get("use_tanh", True)); self.unit = ck.get("unit", "cm")
        self.bind = ck["bindpose"].numpy().astype(np.float64)[:, :3, :3]; J = self.bind.shape[0]; self.J = J
        W1 = ck["W1"].to_dense().numpy().astype(np.float64); M1 = ck["M1_mask"].to_dense().numpy()
        W1 *= np.repeat(np.repeat(M1, 6, 0), self.C, 1)
        W2 = ck["W2"].coalesce(); M2 = ck["M2_mask"].to_dense().numpy().astype(bool)
        idx = W2.indices().numpy(); val = W2.values().numpy().astype(np.float64)
        keep = M2[idx[0] // self.C, idx[1] // 3]
        self.W1 = W1; self.W2 = sp.csr_matrix((val[keep], (idx[0][keep], idx[1][keep])), shape=tuple(W2.shape)); self.M2 = M2
    def __call__(self, X):  # X: (78,3,3) parent-local absolute rotations of the public joints (Root first)
        x = np.einsum("jki,jkl->jil", self.bind, X); x[:, 0, 0] -= 1; x[:, 1, 1] -= 1
        z = np.maximum(x[:, :, :2].reshape(-1) @ self.W1, 0)
        if self.tanh: z = np.tanh(z)
        return (self.W2.T @ z).reshape(-1, 3), z   # cm, SOMA bind frame

def public():
    j = json.load(open(os.path.join(SOMA, "SOMA_procedural_transforms.json")))
    z = np.load(os.path.join(SOMA, "SOMA_neutral.npz"), allow_pickle=False)
    names = [str(s) for s in z["t_pose_world__v0.2.0__joint_names"]]
    return dict(names=names, parents=z["t_pose_world__v0.2.0__parent_ids"].astype(int), tpose_world=z["t_pose_world__v0.2.0"].astype(np.float64),
                main=j["public_rig_derivation"]["main_joint_names"], tris=z["triangles"].astype(np.int64), mirror=z["mirror_vert_indices"].astype(np.int64),
                mean=z["mean"].astype(np.float64), segments={k[8:]: z[k] for k in z.files if k.startswith("segment_")})
