"""pc_proof.py (owner: B3): before/after proof for correctives.py on the hm08 body under RR's rig (82 joints, twist
drivers, 4-influence weights) and the lab viewer's masked dual-quaternion blend. RR's metrics per pose and body,
clay close-ups for the median man.
  $PY -I pipeline/pc_proof.py --bodies=median [--no-pictures]      $PY -I pipeline/pc_proof.py --bodies=thin,heavy --no-pictures
Probes for the team and the designer only."""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import mh_core as mh, pc_geom as g, correctives as pc, rig as rr

OUT = os.path.normpath(os.path.join(__import__("labpaths").LAB, "B3")); NB = pc.NBODY
BODIES = {"median": dict(gender=1.0, weight=0.5, muscle=0.5), "thin": dict(gender=1.0, weight=0.0, muscle=0.3), "heavy": dict(gender=1.0, weight=1.0, muscle=0.5)}
PICS = ("elbow_90", "elbow_135", "elbow_112", "knee_90", "knee_135", "hip_90", "shoulder_fwd90", "shoulder_abd90", "wrist_flex70", "neck_rot70", "seated_hip90_knee90", "SEATED_GRIPS")

class Body:
    def __init__(self, name, pack, static=None, source=None):
        self.name = name; self.pack = pack; self.v = mh.phenotype(**BODIES[name]); self.T = pc.correspondence()["T"]
        self.morphs, self.drivers, self.info = pc.build(self.v, pack=pack, helpers=False, source=source)
        self.sk = self.info["skinner"]; self.P = self.info["poses"]; self.G = self.info["G"]; self.vol0 = g.total_volume(self.sk.V, self.T)
        if static is not None: self.morphs, self.drivers = static          # the viewer's case: one set of deltas on every shape
    def pose(self, dofs):
        M = self.sk.matrices(dofs); w = pc.driver_weights(self.pack, self.drivers, dofs)
        V = self.sk.V + sum(x * self.morphs[n][:NB] for n, x in w.items() if x > 0)
        return self.sk.skin(M), self.sk.skin(M, V), {k: round(v, 2) for k, v in w.items() if v > 0}

def cases(B):
    P = B.P; G = B.G; ax = B.pack.axes; out = []
    hin = {"elbow": (G["u_arm"], G["f_arm"], np.asarray(ax["elbow_l.hinge"], float), "elbow_l.flex"), "knee": (G["u_leg"], G["f_leg"], np.asarray(ax["knee_l.hinge"], float), "knee_l.flex")}
    for n in ("elbow_90", "elbow_135", "knee_90", "knee_135", "hip_90", "shoulder_fwd90", "shoulder_abd90", "wrist_flex70", "wrist_ext60", "neck_flex45", "neck_rot70"):
        if B.info["source"].get(n) == "none": continue
        out.append((n, P[n]["dofs"], dict(P[n], hinge=hin.get(n.split("_")[0]))))
    for n, key, dof, val in (("elbow_112", "elbow_135", "elbow_l.flex", 112.5 - G["elbow_rest"]), ("knee_45", "knee_90", "knee_l.flex", 45 - G["knee_rest"]), ("knee_112", "knee_135", "knee_l.flex", 112.5 - G["knee_rest"])):
        out.append((n + " (between keys)", {dof: val}, dict(P[key], hinge=hin.get(n.split("_")[0]))))
    seat = dict(P["hip_90"], c=(G["hip"] + G["kn"]) / 2 + np.array([0, 0.1, 0.15]), r=0.45, half=0.50, hinge=None)
    out.append(("seated_hip90_knee90", {**P["hip_90"]["dofs"], **P["knee_90"]["dofs"]}, seat))
    sg = next(p for p in rr.poses(B.pack) if p["name"] == "SEATED_GRIPS")
    out.append(("SEATED_GRIPS (RR's operator pose, both sides)", {k: v for k, v in sg["dofs"].items() if not k.startswith("pelvis")}, seat))
    return out

def metrics(B, V, p, dofs):
    c = p["c"]; T = B.T; V0 = B.sk.V; near = np.linalg.norm(V0 - c, axis=1) < p["r"]; Fs = T[near[T].all(1)]
    r = {"dV_ml": round((g.total_volume(V, T) - B.vol0) * 1e6)}
    sel = (np.linalg.norm(V - c, axis=1) < p["half"] * 1.3)[T].all(1); n, bad = g.self_intersections(V, T[sel]); r["isect"] = n
    badfull = np.zeros(len(T), bool); badfull[sel] = bad
    if p.get("hinge"):
        u, f, ax, dof = p["hinge"]; f2 = g.rot(ax, dofs[dof]) @ f; outw = lambda ff: -g.unit(np.cross(ax, g.unit(u + ff)))
        r["tip"] = round(g.ray_far(V, Fs, c, outw(f2)) / g.ray_far(V0, Fs, c, outw(f)), 2)
        r["section"] = round(g.section_area(V, Fs, c, g.unit(u + f2)) / g.section_area(V0, Fs, c, g.unit(u + f)), 2)
    return r, badfull

def main():
    pics = "--no-pictures" not in sys.argv; names = ["median"]
    for a in sys.argv:
        if a.startswith("--bodies="): names = a.split("=")[1].split(",")
    pack = rr.convert_rig(mh.load_rig("default")); print("refit", json.dumps(rr.refit(pack)), flush=True)
    med = Body("median", pack); print("gains", json.dumps(med.info["gains"]), flush=True); rows = []; res = {}; tag = "-".join(names)
    for bn in names:
        for vn in (("own",) if bn == "median" else ("static", "refit")):
            B = med if bn == "median" else Body(bn, pack, static=(med.morphs, med.drivers) if vn == "static" else None)
            if vn == "refit": print(bn, "refit gains", json.dumps(B.info["gains"]), flush=True)
            for name, dofs, p in cases(B):
                if vn == "refit" and name not in ("hip_90", "knee_135", "elbow_135", "shoulder_fwd90", "seated_hip90_knee90", "knee_90", "elbow_90"): continue
                before, after, w = B.pose(dofs); rec = {"weights": w}; imgs = {}
                for t, V in (("before", before), ("after", after)): rec[t], bad = metrics(B, V, p, dofs); imgs[t] = (V, bad)
                res[f"{bn}/{vn}/{name}"] = rec; rows.append((bn, vn, name, rec)); print(bn, vn, name, json.dumps(rec), flush=True)
                if pics and bn == "median" and name.split(" ")[0] in PICS:
                    import pc_render; pc_render.sheet_for(OUT + "/pictures", B, name, p, imgs, rec)
    json.dump(dict(gains=med.info["gains"], metrics=res), open(OUT + f"/proof-metrics-{tag}.json", "w"), indent=1)
    with open(OUT + f"/proof-table-{tag}.md", "w") as fh:
        fh.write("| Body | Deltas | Pose | Before (twist joints + masked DQS) | After (+ pc correctives) |\n|---|---|---|---|---|\n")
        fmt = lambda r: ", ".join(f"{k} {v}" for k, v in r.items())
        for bn, vn, name, rec in rows: fh.write(f"| {bn} | {vn} | {name} | {fmt(rec['before'])} | {fmt(rec['after'])} |\n")
if __name__ == "__main__": main()
