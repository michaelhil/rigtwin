# Does B1's core rebuild a fitted body from transfer-<sex>.npz? Resolves the target names to mh_core names and compares on Anny's vertices.
#   python check_transfer.py <package folder name, e.g. rp-male-v2> <sex>
import sys, os, numpy as np
H = os.path.dirname(os.path.abspath(__file__)) + "/"; sys.path.insert(0, H + "../pipeline")
import mh_core as mh
pkg, sex = sys.argv[1], sys.argv[2]
T = np.load(H + f"packages/{pkg}/transfer-{sex}.npz"); names = [str(n) for n in T["target_names"]]; Wt = T["target_weights"]
have = mh.list_targets()
def resolve(n):
    cat, rest = n.split(":", 1)
    for cand in ([rest] if cat == "local_change" else [f"{cat}-{rest}", rest, f"macrodetails/{cat}-{rest}", f"macrodetails/{cat}/{rest}", f"{cat}/{rest}"]):
        if cand in have: return cand
    return None
res = [resolve(n) for n in names]; miss = [n for n, r in zip(names, res) if r is None]
print("targets", len(names), "unresolved", len(miss), miss[:6], "| prefixes", sorted(set(n.split(":")[0] for n in names)))
print("examples", [(n, r) for n, r in zip(names, res)][:3], [(n, r) for n, r in zip(names, res) if n.startswith(("height", "prop", "breast", "african", "asian", "cauc"))][:4])
if not miss:
    base = mh.load_base(); a2h = np.load(H + "../B1/anny_to_hm08.npy"); S = np.load(H + f"../RP/{os.environ.get('RP_OUT', 'out')}/fit-{sex}.npz")
    worst = 0
    for p in (0, 5, 100, 255):
        v = mh.apply_targets(base.v, {r: float(w) for r, w in zip(res, Wt[p]) if abs(w) > 1e-12})           # glTF frame, metres
        mine = S["V"][p].astype(np.float64); mine = np.stack([mine[:, 0], mine[:, 2], -mine[:, 1]], 1)       # Anny (x, -y fwd, z up) -> glTF
        worst = max(worst, float(np.abs(v[a2h] - mine).max()))
    print(f"mh_core.apply_targets(base, weights) vs the fitted Anny body on Anny's 13,718 vertices: max difference {worst * 1000:.4f} mm (4 people)")
