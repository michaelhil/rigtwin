# RP's measurement-driven shape space (RP/packages/rp-<sex>/) carried onto the full 19,158-vertex hm08 mesh, so helper
# geometry (which clothes bind to), joint cubes (which joints are computed from) and the 32 body vertices Anny drops all
# follow. Owner: B1. Recipe: RP/REPORT.md section 7 / `howToApplyToMPFB2` in each *.shape.json.
#   1. evaluate RP's fitted people (Anny phenotypes + local changes by MakeHuman target name) with MakeHuman's targets,
#      interpolated as Anny interpolates them (anchors read in anny/models/phenotype.py: gender 0 = male, 1 = female;
#      age 2/3 = "young"; muscle / weight / cup / firmness min-average-max at 0, 0.5, 1; height min-max at 0, 1;
#      proportions ideal-uncommon at 0, 1; a target file's weight = the product of the weights of the variations in its name);
#   2. subtract each person's `shift`;   3. least squares on RP's coefficients C.
import functools, hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import mh_core as mh

LAB = __import__("labpaths").LAB
DEFAULT_ROOT = os.path.join(LAB, "RP", "packages")
CACHE = os.path.join(LAB, "B1", "cache")
SEXNAME = {"m": "male", "f": "female"}
VAR = {"gender": ["male", "female"], "age": ["newborn", "baby", "child", "young", "old"], "muscle": ["minmuscle", "averagemuscle", "maxmuscle"],
       "weight": ["minweight", "averageweight", "maxweight"], "height": ["minheight", "maxheight"], "proportions": ["idealproportions", "uncommonproportions"],
       "cupsize": ["mincup", "averagecup", "maxcup"], "firmness": ["minfirmness", "averagefirmness", "maxfirmness"]}
ANCHOR = {k: (np.linspace(-1 / 3, 1, 5) if k == "age" else np.linspace(0, 1, len(v))) for k, v in VAR.items()}
RACES = ("african", "asian", "caucasian")
to_gl = lambda p: np.stack([p[..., 0], p[..., 2], -p[..., 1]], -1)          # Anny / Blender (x, -y fwd, z up) -> glTF


def _interp(value, anchors, extrapolate=True):
    """anny.utils.interpolation.linear_interpolation_coefficients for one value."""
    a = np.asarray(anchors); v = float(value)
    if not extrapolate: v = min(max(v, a[0]), a[-1])
    i = int(np.clip(np.searchsorted(a, v, side="left"), 1, len(a) - 1)); t = (v - a[i - 1]) / (a[i] - a[i - 1])
    w = np.zeros(len(a)); w[i - 1] = 1 - t; w[i] = t
    return w


@functools.lru_cache(maxsize=None)
def _macro_files():
    """[(target key, [variation tokens])] for every macro target file whose name is made of variation names only."""
    known = set(t for vs in VAR.values() for t in vs) | set(RACES); out = []
    for key in mh.list_targets():
        if not (key.startswith("macrodetails/") or key.startswith("breast/")): continue
        toks = [t for t in key.split("/")[-1].split("-") if t != "universal"]
        if toks and all(t in known for t in toks): out.append((key, toks))
    return out


def anny_macro_weights(ph, extrapolate=True):
    """ph: {gender, age, muscle, weight, height, proportions[, cupsize, firmness]} in Anny's convention -> {target: weight}."""
    w = {r: 1 / 3 for r in RACES}
    for k, names in VAR.items():
        for n, x in zip(names, _interp(ph.get(k, 0.5), ANCHOR[k], extrapolate)): w[n] = x
    out = {}
    for key, toks in _macro_files():
        x = 1.0
        for t in toks: x *= w[t]
        if abs(x) > 1e-12: out[key] = x
    return out


@functools.lru_cache(maxsize=None)
def _opposites():
    tj = json.load(open(os.path.join(mh.DATA, "targets", "target.json"))); opp = {}
    def walk(o):
        if isinstance(o, dict):
            op = o.get("opposites")
            if isinstance(op, dict):
                for side in ("left", "right", "unsided"):
                    p, n = op.get("positive-" + side), op.get("negative-" + side)
                    if p: opp[p] = n or None
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(tj); return opp


def local_weights(labels, values):
    out = {}; opp = _opposites(); known = mh.list_targets(); missing = set()
    for lab, v in zip(labels, values):
        if v == 0: continue
        lab = str(lab); name = lab if v > 0 else opp.get(lab)
        if name is None and v < 0:
            for a, b in (("-incr", "-decr"), ("-up", "-down"), ("-out", "-in"), ("-forward", "-backward"), ("-convex", "-concave")):
                if lab.endswith(a) and lab[:-len(a)] + b in known: name = lab[:-len(a)] + b
        if name is None or name not in known: missing.add(lab); continue
        out[name] = out.get(name, 0.0) + abs(float(v))
    return out, missing


def transfer_target(name):
    """RP's v2 target names -> this core's target keys: 'universal:male-young-…' = macrodetails/universal-male-young-…,
    'height:' / 'proportions:' = macrodetails/height/… / proportions/…, 'breast:' = breast/…, 'race:' (or a bare race
    file) = macrodetails/…, 'local_change:<name>' = the target file <name>."""
    kind, _, rest = name.partition(":")
    if not rest: return name if name in mh.list_targets() else "macrodetails/" + name
    return {"universal": "macrodetails/universal-" + rest, "height": "macrodetails/height/" + rest, "proportions": "macrodetails/proportions/" + rest,
            "breast": "breast/" + rest, "race": "macrodetails/" + rest, "racegenderage": "macrodetails/" + rest, "local_change": rest}.get(kind, rest)


def paths(sex, root=None, tag=""):
    """Files of RP's package for one sex. tag "" = RP/packages/rp-<sex>/; "-v2" = rp-<sex>-v2/ (RP's refit), and so on."""
    root = root or DEFAULT_ROOT; s = SEXNAME[sex]; name = f"rp-{s}{tag}"; d = os.path.join(root, name)
    if not os.path.isdir(d): raise FileNotFoundError("no %s under %s" % (name, root))
    sj = [f for f in os.listdir(d) if f.endswith(".shape.json")][0]; mf = [f for f in os.listdir(d) if f.endswith(".avatar.json")][0]
    tf = [f for f in os.listdir(d) if f.startswith("transfer") and f.endswith(".npz")][0]
    return {"dir": d, "tag": name, "shape": os.path.join(d, sj), "bin": os.path.join(d, json.load(open(os.path.join(d, sj)))["bin"]["file"]),
            "manifest": os.path.join(d, mf), "transfer": os.path.join(d, tf)}


def anny_space(sex, root=None, tag=""):
    """RP's own base and targets on Anny's 13,718 vertices, glTF frame: (index into hm08 (N,), base (N,3), targets (K,N,3))."""
    p = paths(sex, root, tag); sj = json.load(open(p["shape"])); N, K = sj["vertices"], sj["targets"]
    raw = open(p["bin"], "rb").read()
    base = np.frombuffer(raw, dtype=np.float32, count=N * 3).reshape(N, 3).astype(np.float64)
    t = np.frombuffer(raw, dtype=np.int16, count=K * N * 3, offset=N * 12).reshape(K, N, 3).astype(np.float64) / 32767.0
    t *= np.array(sj["bin"]["targetScale"])[:, None, None]
    return np.array(sj["makehumanVertex"]["index"]), to_gl(base), to_gl(t), sj


def load_space(sex, root=None, tag="", verbose=False):
    """-> dict: base (19158,3) and targets (K,19158,3) on the full hm08 mesh (glTF frame, soles on y = 0, hip joints on
    x = z = 0), names, RP's manifest, shape json, and `check`: the agreement with RP's Anny-space targets. Cached on disk."""
    p = paths(sex, root, tag)
    h = hashlib.sha1(); [h.update(open(p[k], "rb").read()) for k in ("transfer", "bin", "shape")]; key = h.hexdigest()[:12]
    cf = os.path.join(CACHE, "rp-full-%s-%s.npz" % (sex, key)); os.makedirs(CACHE, exist_ok=True)
    man = json.load(open(p["manifest"])); sj = json.load(open(p["shape"]))
    if os.path.exists(cf):
        z = np.load(cf, allow_pickle=True)
        return {"base": z["base"], "targets": z["targets"], "names": ["pc%02d" % k for k in range(len(z["targets"]))], "manifest": man, "shape": sj, "check": json.loads(str(z["check"])), "paths": p, "key": key}
    z = np.load(p["transfer"], allow_pickle=True); labels = [str(x) for x in z["phenotype_labels"]]
    P = z["phenotypes"]; Lv = z["locals"]; Ll = [str(x) for x in z["local_labels"]]; C = z["C"]; b0 = z["b0"]; shift = to_gl(z["shift"])
    base = mh.load_base(); n = len(P); bodies = np.zeros((n, mh.NV, 3)); miss = set()
    scale = float(z["base_scale"]) if "base_scale" in z.files else 1.0
    exact = "target_weights" in z.files                                    # RP's second transfer form: exact MakeHuman target weights per person
    if exact:
        tn = [transfer_target(str(x)) for x in z["target_names"]]; TW = z["target_weights"]; known = mh.list_targets()
        miss = {str(x) for x, k in zip(z["target_names"], tn) if k not in known}
        for i in range(n):
            bodies[i] = mh.apply_targets(base.v, {k: float(x) for k, x in zip(tn, TW[i]) if x != 0 and k in known}) - shift[i]
    else:
        for i in range(n):
            w = anny_macro_weights(dict(zip(labels, P[i]))); lw, m = local_weights(Ll, Lv[i]); miss |= m
            for k, x in lw.items(): w[k] = w.get(k, 0.0) + x
            bodies[i] = mh.apply_targets(base.v, w) - shift[i]
    mean = bodies.mean(0)                                                  # RP's recipe, literally: C are scores about the mean
    T, *_ = np.linalg.lstsq(C, (bodies - mean).reshape(n, -1), rcond=None); T = T.reshape(C.shape[1], mh.NV, 3)
    fb = (mean + np.einsum("k,kvi->vi", b0, T)) * scale                    # b0: the coefficients of the map's centre (all dimensions at their mean);
                                                                           # base_scale (v2): uniform, about the floor origin, removes the map's constant stature offset
    idx, ab, at, _ = anny_space(sex, root, tag)
    resid = bodies - (mean + np.einsum("nk,kvi->nvi", C, T))
    recon_anny = ab + np.einsum("nk,kvi->nvi", C - b0, at)                   # RP's own reconstruction of the same people
    body = base.vgroups["body"]
    check = {"people": n, "components": int(C.shape[1]), "transfer_form": "exact target weights" if exact else "phenotypes and local changes (re-interpolated here)", "base_scale": scale, "unknown_local_labels": sorted(miss),
             "meanC_abs_max": float(np.abs(C.mean(0)).max()),
             "base_vs_anny_max_mm": float(np.abs(fb[idx] - ab).max() * 1000), "base_vs_anny_mean_mm": float(np.linalg.norm(fb[idx] - ab, axis=1).mean() * 1000),
             "targets_vs_anny_max_mm": float(np.abs(T[:, idx] - at).max() * 1000), "targets_vs_anny_rms_mm": float(np.sqrt(((T[:, idx] - at) ** 2).sum(2).mean()) * 1000),
             "people_vs_anny_recon_max_mm": float(np.linalg.norm(bodies[:, idx] - recon_anny, axis=2).max() * 1000),
             "people_vs_anny_recon_mean_mm": float(np.linalg.norm(bodies[:, idx] - recon_anny, axis=2).mean() * 1000),
             "lstsq_residual_body_max_mm": float(np.linalg.norm(resid[:, body], axis=2).max() * 1000), "lstsq_residual_body_rms_mm": float(np.sqrt((resid[:, body] ** 2).sum(2).mean()) * 1000),
             "lstsq_residual_helpers_max_mm": float(np.linalg.norm(resid[:, ~body], axis=2).max() * 1000), "lstsq_residual_helpers_rms_mm": float(np.sqrt((resid[:, ~body] ** 2).sum(2).mean()) * 1000),
             "soles_y_mm": float(fb[body, 1].min() * 1000)}
    np.savez_compressed(cf, base=fb, targets=T, check=json.dumps(check))
    if verbose: print(json.dumps(check, indent=1))
    return {"base": fb, "targets": T, "names": ["pc%02d" % k for k in range(len(T))], "manifest": man, "shape": sj, "check": check, "paths": p, "key": key}


def coefficients(space, dims):
    """RP's map: {dimension: value in metres (weightkg in kg)} -> (40,) coefficients; missing dimensions at their mean."""
    m = space["shape"]["map"]; names = space["shape"]["dims"]
    z = np.array([((dims.get(n, m["mean"][i]) - m["mean"][i]) / m["sd"][i]) for i, n in enumerate(names)])
    return z @ np.array(m["W"])


def survey_check(space, sex, n=6, seed=7, keep=32):
    """A few survey people (rows chosen at random; whether RP fitted them is not recorded in the transfer file) through
    RP's map onto the full mesh: stature re-measured as top of the body minus the soles, with all components and with
    the first `keep`. Reads private/ansur2 (never copied anywhere)."""
    import csv
    f = os.path.normpath(os.path.join(LAB, "..", "..", "private", "ansur2", "ANSUR_II_%s_Public.csv" % SEXNAME[sex].upper()))
    if not os.path.exists(f): return {"skipped": "survey file not found"}
    rows = list(csv.reader(open(f, encoding="latin1"))); head = [h.strip().lower() for h in rows[0]]
    rs = np.random.RandomState(seed); pick = rs.choice(len(rows) - 1, n, replace=False) + 1; body = mh.load_base().vgroups["body"]; out = []
    for r in pick:
        d = {}
        for nme in space["shape"]["dims"]:
            x = float(rows[r][head.index(nme)]); d[nme] = x / 10 if nme == "weightkg" else x / 1000
        c = coefficients(space, d); rec = {"survey_stature_mm": round(d["stature"] * 1000), "survey_weight_kg": round(d["weightkg"], 1)}
        for label, k in (("all", len(c)), ("first_%d" % keep, keep)):
            v = space["base"] + np.einsum("k,kvi->vi", c[:k], space["targets"][:k]); rec["stature_mm_" + label] = round(float((v[body, 1].max() - v[body, 1].min()) * 1000), 1)
        rec["max_vertex_move_from_dropping_mm"] = round(float(np.linalg.norm(np.einsum("k,kvi->vi", c[keep:], space["targets"][keep:])[body], axis=1).max() * 1000), 1)
        out.append(rec)
    return out


if __name__ == "__main__":
    for s in (sys.argv[1:] or ["m", "f"]):
        sp_ = load_space(s, verbose=True); print(s, sp_["paths"]["tag"], sp_["base"].shape, sp_["targets"].shape)
