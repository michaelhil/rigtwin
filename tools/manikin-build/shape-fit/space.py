# The runtime shape space of one sex: a principal-component basis of the fitted bodies' vertex offsets, the linear map
# from the survey's measurements to its coefficients, the joints as a linear function of the same coefficients, the
# validation on every survey person who was NOT fitted, and the controls. Writes out/space-<sex>.npz + out/stats-<sex>.json.
# usage: python space.py <sex> [K]
import sys, time, json
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from rp import *
torch.set_num_threads(4)
sex = sys.argv[1]; K = int(sys.argv[2]) if len(sys.argv) > 2 else 40
Fz = np.load(HERE + OUTD + f"fit-{sex}.npz"); D = ansur(sex)
idx = Fz["idx"]; n = len(idx); NP = len(D["stature"])
V = Fz["V"].astype(np.float64); H = Fz["H"].astype(np.float64)
# every body stands with its soles on z = 0 and its hip joints centred on x = y = 0 (so shape changes never move the feet)
sole = V[:, SPEC["sets"]["foot"], 2].min(1); mid = (H[:, BI["upperleg01.L"]] + H[:, BI["upperleg01.R"]]) / 2
shift = np.stack([mid[:, 0], mid[:, 1], sole], 1)[:, None]; V -= shift; H -= shift
X = np.stack([D[d] for d in DIMS], 1); mu = X.mean(0); sd = X.std(0); Z = (X - mu) / sd      # the whole survey of this sex
U1 = np.array([1.0 if d == "weightkg" else 1000.0 for d in DIMS])
OUT = {"sex": sex, "fitted": int(n), "extremes_in_fitted": int(Fz["n_ext"]), "survey_people": int(NP), "fit_seconds": float(Fz["seconds"])}

# ---- 1. fit error (mesh vs the person's own survey row), over the fitted people
e = Fz["measured"] - Fz["target"]; UA = np.array([1.0 if d == "weightkg" else 1000.0 for d in ALL])
OUT["fit_error"] = {d: {"mean": round(float(e[:, i].mean() * UA[i]), 2), "mean_abs": round(float(np.abs(e[:, i]).mean() * UA[i]), 2), "p95_abs": round(float(np.percentile(np.abs(e[:, i]), 95) * UA[i]), 2)} for i, d in enumerate(ALL)}
OUT["phenotypes"] = {k: [round(float(Fz["phen"][:, i].min()), 3), round(float(Fz["phen"][:, i].mean()), 3), round(float(Fz["phen"][:, i].max()), 3)] for i, k in enumerate(M.phenotype_labels)}
lc = Fz["local"]; OUT["locals_at_limit_share"] = round(float((np.abs(lc) > 1.2).mean()), 4)
OUT["largest_locals"] = {str(Fz["keys"][i]): round(float(np.abs(lc[:, i]).mean()), 3) for i in np.argsort(-np.abs(lc).mean(0))[:12]}

# ---- 2. principal components of the vertex offsets (unit-variance coefficients over the fitted sample)
Vm = V.mean(0); Xc = (V - Vm).reshape(n, -1)
Uu, S, Vt = np.linalg.svd(Xc, full_matrices=False)
ev = S ** 2 / (S ** 2).sum()
OUT["explained_variance"] = {str(k): round(float(ev[:k].sum()), 5) for k in (4, 8, 12, 16, 24, 32, 40)}
rec = lambda k: np.sqrt((((Uu[:, :k] * S[:k]) @ Vt[:k] - Xc).reshape(n, -1, 3) ** 2).sum(-1))
OUT["reconstruction_mm"] = {str(k): {"mean": round(float(rec(k).mean() * 1000), 3), "p99": round(float(np.percentile(rec(k), 99) * 1000), 3), "max": round(float(rec(k).max() * 1000), 2)} for k in (8, 16, 24, 32)}
sc = np.sqrt(n - 1)
PC = Vt[:K] * (S[:K] / sc)[:, None]              # (K, 3N) metres per unit coefficient
C = Uu[:, :K] * sc                               # (n, K) coefficients of the fitted people
# ---- 3. joints: linear in the same coefficients (least squares over the fitted bodies)
Hm = H.mean(0); JPC, *_ = np.linalg.lstsq(C, (H - Hm).reshape(n, -1), rcond=None)
jr = np.sqrt((((C @ JPC).reshape(n, -1, 3) - (H - Hm)) ** 2).sum(-1))
OUT["joint_regression_mm"] = {"mean": round(float(jr.mean() * 1000), 3), "p99": round(float(np.percentile(jr, 99) * 1000), 3), "max": round(float(jr.max() * 1000), 2)}

tV, tJ = torch.tensor(Vm.reshape(-1), dtype=FT), torch.tensor(Hm.reshape(-1), dtype=FT); tPC, tJPC = torch.tensor(PC, dtype=FT), torch.tensor(JPC, dtype=FT)
def body(c):
    c = torch.as_tensor(c, dtype=FT); return (tV + c @ tPC).reshape(len(c), N, 3), (tJ + c @ tJPC).reshape(len(c), len(BL), 3)
def meas(c, chunk=400):
    out = []
    with torch.no_grad():
        for i in range(0, len(c), chunk):
            Vv, Hh = body(c[i:i + chunk]); m = measure(Vv, Hh, sex); out.append(torch.stack([m[d] for d in DIMS], 1).numpy())
    return np.concatenate(out)

# ---- 4. the map measurements -> coefficients: ridge regression on the fitted people; lambda by leave-out inside the sample
held = np.setdiff1d(np.arange(NP), idx)
def ridge(Zt, Ct, lam):
    A = np.column_stack([np.ones(len(Zt)), Zt]); R_ = lam * np.eye(A.shape[1]); R_[0, 0] = 0
    return np.linalg.solve(A.T @ A + R_, A.T @ Ct)            # (39, K): intercept row, then one row per dimension
rng = np.random.default_rng(3); perm = rng.permutation(n); va = perm[: n // 5]; tr = perm[n // 5:]
best = None
for lam in (0.03, 0.3, 1.0, 3.0, 10.0):
    Wl = ridge(Z[idx][tr], C[tr], lam); cp = np.column_stack([np.ones(len(va)), Z[idx][va]]) @ Wl
    err = float(np.abs((meas(cp) - X[idx][va]) / sd).mean())
    if best is None or err < best[0]: best = (err, lam)
OUT["ridge_lambda"] = best[1]
Wr = ridge(Z[idx], C, best[1]); b0, W = Wr[0], Wr[1:]           # coefficient = b0 + z · W

def table(err):
    return {d: {"mean": round(float(err[:, i].mean() * U1[i]), 2), "mean_abs": round(float(np.abs(err[:, i]).mean() * U1[i]), 2), "p95_abs": round(float(np.percentile(np.abs(err[:, i]), 95) * U1[i]), 2)} for i, d in enumerate(DIMS)}
t = time.time(); c_held = b0 + Z[held] @ W; m_held = meas(c_held)
OUT["heldout_people"] = int(len(held)); OUT["roundtrip_linear"] = table(m_held - X[held]); OUT["roundtrip_seconds"] = time.time() - t
OUT["coef_range_heldout"] = [round(float(c_held.min()), 2), round(float(c_held.max()), 2)]
# ---- 5. optional refinement in the browser: measure the mesh (the same tape, in JS) and correct once or twice with
# the constant Jacobian of the measurements with respect to the coefficients (a damped least-squares step)
m_fit = meas(C); Aj = np.column_stack([np.ones(n), C]); Jr, *_ = np.linalg.lstsq(Aj, m_fit, rcond=None); m0, Jm = Jr[0], Jr[1:]   # (K, 38)
WTd = np.array([{"stature": 4.0, "weightkg": 4.0, "sittingheight": 2.0}.get(d, 1.0) for d in DIMS])
Jw = Jm / sd * np.sqrt(WTd); G = np.linalg.solve(Jw @ Jw.T + 0.02 * np.eye(K), Jw)             # (K, 38)
def refine(c, target, steps=2):
    for _ in range(steps): c = c + ((target - meas(c)) / sd * np.sqrt(WTd)) @ G.T
    return c
c_ref = refine(c_held, X[held]); OUT["roundtrip_refined"] = table(meas(c_ref) - X[held])
lin = (m0 + c_held @ Jm) - m_held; OUT["linear_readback_error"] = table(lin)                    # the manifest's `measures` read-back vs the real tape

# ---- 6. controls through the conditional body model (the same formula as shared/body.ts)
Cov = np.cov(X.T)
def predict(given):
    a = [DIMS.index(k) for k in given]; bb = [i for i in range(len(DIMS)) if i not in a]
    x = mu.copy(); va_ = np.array([given[k] for k in given]); x[a] = va_
    if a: x[bb] = mu[bb] + Cov[np.ix_(bb, a)] @ np.linalg.solve(Cov[np.ix_(a, a)], va_ - mu[a])
    return x
def csd(d, given):
    a = [DIMS.index(k) for k in given]; i = DIMS.index(d)
    return float(np.sqrt(Cov[i, i] - Cov[i, a] @ np.linalg.solve(Cov[np.ix_(a, a)], Cov[a, i]))) if a else float(sd[i])
pc = lambda d, p: float(np.percentile(D[d], p))
cases = {}
def case(name, given, show):
    x = predict(given); c = (b0 + ((x - mu) / sd) @ W)[None]; m1 = meas(c)[0]; m2 = meas(refine(c, x[None]))[0]
    cases[name] = {"set": {k: round(v * (1 if k == "weightkg" else 1000), 1) for k, v in given.items()},
                   "result": {d: {"asked": round(float(x[DIMS.index(d)] * U1[DIMS.index(d)]), 1), "mesh_linear": round(float(m1[DIMS.index(d)] * U1[DIMS.index(d)]), 1), "mesh_refined": round(float(m2[DIMS.index(d)] * U1[DIMS.index(d)]), 1)} for d in show},
                   "coef_max_abs": round(float(np.abs(c).max()), 2)}
    return x, c
main = ["stature", "weightkg", "sittingheight", "waistcircumference", "chestcircumference", "acromionradialelength", "radialestylionlength", "buttockkneelength", "bicepscircumferenceflexed"]
for p in (1, 5, 50, 95, 99): case(f"stature P{p} only", {"stature": pc("stature", p)}, main)
case("short and heavy (stature P5, weight P95)", {"stature": pc("stature", 5), "weightkg": pc("weightkg", 95)}, main)
case("tall and thin (stature P95, weight P5)", {"stature": pc("stature", 95), "weightkg": pc("weightkg", 5)}, main)
case("weight P5 at stature P50", {"stature": pc("stature", 50), "weightkg": pc("weightkg", 5)}, main)
case("weight P99 at stature P50", {"stature": pc("stature", 50), "weightkg": pc("weightkg", 99)}, main)
g = {"stature": pc("stature", 5)}
arm = {**g, "acromionradialelength": predict(g)[DIMS.index("acromionradialelength")] + 2 * csd("acromionradialelength", g)}
arm["radialestylionlength"] = predict(arm)[DIMS.index("radialestylionlength")] + 2 * csd("radialestylionlength", arm)
case("long arms on a short person (stature P5, both arm segments +2 conditional SD)", arm, main)
g = {"stature": pc("stature", 50), "weightkg": pc("weightkg", 50)}
for sgn, nm in ((-2, "lean, muscular build"), (+2, "soft build")):
    case(f"{nm} (stature and weight P50, waist {sgn:+d} conditional SD)", {**g, "waistcircumference": predict(g)[DIMS.index("waistcircumference")] + sgn * csd("waistcircumference", g)}, main + ["forearmcircumferenceflexed", "calfcircumference", "thighcircumference", "bideltoidbreadth"])
case("long trunk, short legs (stature P50, sitting height +2 conditional SD)", {"stature": pc("stature", 50), "sittingheight": predict({"stature": pc("stature", 50)})[1] + 2 * csd("sittingheight", {"stature": pc("stature", 50)})}, main + ["poplitealheight", "kneeheightsitting"])
OUT["controls"] = cases

# ---- 7. the control parametrisation of the manifest: stature and weight in their units, then every other dimension as
# a standard score of what is left of it once the controls before it are known (a Cholesky factor of the covariance):
# every control combination is a plausible person, and all 38 together reproduce any person exactly.
ORDER = ["stature", "weightkg", "waistcircumference", "sittingheight", "acromionradialelength", "radialestylionlength", "biacromialbreadth", "hipbreadthsitting",
         "chestcircumference", "buttockkneelength", "kneeheightsitting", "bicepscircumferenceflexed", "thighcircumference", "calfcircumference", "neckcircumference"]
ORDER += [d for d in DIMS if d not in ORDER]
o = [DIMS.index(d) for d in ORDER]; Lc = np.linalg.cholesky(Cov[np.ix_(o, o)])
A = Lc.copy(); A[:, :2] = Lc[:, :2] @ np.linalg.inv(Lc[:2, :2])           # x[o] - mu[o] = A · [d stature, d weight, u3 … u38]
Ainv = np.linalg.inv(A)
u_held = (X[held][:, o] - mu[o]) @ Ainv.T
OUT["control_scores_heldout_p01_p99"] = {ORDER[i]: [round(float(np.percentile(u_held[:, i], 0.5)), 2), round(float(np.percentile(u_held[:, i], 99.5)), 2)] for i in range(2, 8)}
np.savez(HERE + OUTD + f"space-{sex}.npz", Vm=Vm, Hm=Hm, PC=PC, JPC=JPC, b0=b0, W=W, mu=mu, sd=sd, Cov=Cov, m0=m0, Jm=Jm, G=G, order=np.array(ORDER), A=A, C=C, idx=idx,
         ev=ev[:64], dims=np.array(DIMS))
json.dump(OUT, open(HERE + OUTD + f"stats-{sex}.json", "w"), indent=1)
print(sex, "K", K, "explained", OUT["explained_variance"], "recon", OUT["reconstruction_mm"], "joints", OUT["joint_regression_mm"], "lambda", best)
print(f"{'dimension':30s} | fit: mean  |e|  p95 | held-out linear: mean  |e|  p95 | refined: mean  |e|  p95   (mm; weight kg)")
for d in DIMS:
    a, b_, c_ = OUT["fit_error"][d], OUT["roundtrip_linear"][d], OUT["roundtrip_refined"][d]
    print(f"{d:30s} | {a['mean']:+6.1f} {a['mean_abs']:5.1f} {a['p95_abs']:5.1f} | {b_['mean']:+6.1f} {b_['mean_abs']:5.1f} {b_['p95_abs']:5.1f} | {c_['mean']:+6.1f} {c_['mean_abs']:5.1f} {c_['p95_abs']:5.1f}")
for k, v in cases.items(): print(k, v["set"], "| coef max", v["coef_max_abs"], "|", {d: (r["asked"], r["mesh_linear"], r["mesh_refined"]) for d, r in v["result"].items()})
