"""pc_rom.py (owner: B3): RR's range-of-motion check (rig_rom.analyse, unchanged) on a built package, before and after
the pc correctives. The package on disk is not touched: the correctives are solved for its base body (build_body
context) and added in memory, with the drivers evaluated per pose as the viewer would.
  $PY -I pipeline/pc_rom.py [--persons=M50,M95H] [--poses=E10,E11,...] [--source=default|shoulder] [--tag=x]"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import build_body as bb, rig as rr, rig_rom as rom, correctives as pc

OUT = os.path.normpath(os.path.join(__import__("labpaths").LAB, "B3"))
VARIANTS = {"default": None, "shoulder": dict(pc.SOURCE, shoulder_fwd90="soma", shoulder_abd90="soma", shoulder_fwd170="soma", shoulder_abd170="soma"),
            "hip-soma": dict(pc.SOURCE, hip_90="soma+contact"), "hip-contact": dict(pc.SOURCE, hip_90="contact"), "all-soma": {}}

def brief(r):
    g = lambda d: round(min(d.values()), 2) if isinstance(d, dict) and d else None
    return dict(dV_ml=r.get("volume_change_ml"), section=g(r.get("section_area_ratio_at_joint")), tip=g(r.get("tip_ratio")), pairs=r.get("new_intersecting_pairs"), pen_mm=r.get("max_self_penetration_mm"))

def main():
    arg = {a.split("=")[0][2:]: a.split("=")[1] for a in sys.argv[1:] if a.startswith("--") and "=" in a}
    persons = arg.get("persons", "M50").split(","); pose_ids = arg.get("poses"); variant = arg.get("source", "default"); tag = arg.get("tag", variant)
    c = bb.context(); out = pc.add_correctives(c, source=VARIANTS[variant]); pk = rom.load_package(os.path.join(__import__("labpaths").LAB, "packages", "body-clay"))
    from scipy.spatial import cKDTree
    dist, idx = cKDTree(c.pack.bake(c.base_v)[:pc.NBODY]).query(pk.v); assert dist.max() < 1e-5, "package body vertices are not the build context's"
    D = {k: v[:pc.NBODY][idx] for k, v in out["correctives"].items()}; drivers = out["corrective_drivers"]; print("targets", len(D), json.dumps(out["corrective_info"]["source"]), flush=True)
    poses = [p for p in pk.poses if str(p.get("id", "")).startswith("E")]
    if pose_ids: poses = [p for p in poses if p["id"] in pose_ids.split(",")]
    big = np.array([not any(k in pk.names[j] for k in rom.SMALL) for j in pk.J[np.arange(len(pk.J)), pk.W.argmax(1)]]); orig = rr.skin; res = {}; first = True
    for person in persons:
        v0, J0, info = rom.body_of(pk, person); caps = rom.closed_volume_setup(pk.tris, len(pk.v)); tbig = big[pk.tris].all(1); cache = {}
        def rest_pairs(nt, v0=v0, tbig=tbig, cache=cache):
            if "k" not in cache:
                ids = np.nonzero(tbig)[0]; keys, _ = rom.intersecting_pairs(v0, pk.tris[tbig], ids); m = int(ids.max()) + 1; cache["k"] = keys // m * nt + keys % m
            return cache["k"]
        ctx = {"caps": caps, "vol0": rom.volume(v0, pk.tris, caps), "big": tbig, "rest_pairs": rest_pairs}
        for p in poses:
            if person != persons[0] and p["id"] not in rom.CRITICAL: continue
            w = pc.driver_weights(c.pack, drivers, p.get("dofs", {})); delta = sum(x * D[n] for n, x in w.items() if x > 0)
            t0 = time.time(); before = rom.analyse(pk, (v0, J0), p, ctx)
            if first: print("analyse keys", list(before.keys()), round(time.time() - t0, 1), "s", flush=True); first = False
            if isinstance(delta, np.ndarray):
                rr.skin = lambda v, J, W, M, m=None, _d=delta: orig(v + _d if np.shape(v) == _d.shape else v, J, W, M, m)
                try: after = rom.analyse(pk, (v0, J0), p, ctx)
                finally: rr.skin = orig
            else: after = before
            res[f"{person}/{p['id']}"] = dict(name=p.get("name"), weights={k: round(x, 2) for k, x in w.items() if x > 0}, before=brief(before), after=brief(after), before_full=before, after_full=after)
            print(person, p["id"], p.get("name"), "| before", json.dumps(brief(before)), "| after", json.dumps(brief(after)), "| w", json.dumps(res[f"{person}/{p['id']}"]["weights"]), flush=True)
    json.dump(dict(source=out["corrective_info"]["source"], rows=res), open(os.path.join(OUT, f"rom-before-after-{tag}.json"), "w"), indent=1, default=str)
    with open(os.path.join(OUT, f"rom-before-after-{tag}.md"), "w") as fh:
        fh.write("| Body | Pose | Before: dV ml / worst section / tip / new pairs / penetration mm | After | Corrective weights |\n|---|---|---|---|---|\n")
        f = lambda b: " / ".join(str(b[k]) for k in ("dV_ml", "section", "tip", "pairs", "pen_mm"))
        for k, r in res.items(): fh.write(f"| {k.split('/')[0]} | {r['name']} | {f(r['before'])} | {f(r['after'])} | {json.dumps(r['weights'])} |\n")
if __name__ == "__main__": main()
