# Fit Anny's own parameters to real ANSUR II people, a whole stratified sample per sex in one batch.
# usage: python fit.py <sex> <n> <iters1> <iters2>
import sys, time
import faulthandler; faulthandler.dump_traceback_later(int(__import__("os").environ.get("FH", "100000")), exit=True); sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from rp import *
sex, n, it1, it2 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
D = ansur(sex); NP = len(D["stature"]); rng = np.random.default_rng(1)
# ---- stratified sample: the extremes of size, weight, build and proportions, then a random draw
bmi = D["weightkg"] / D["stature"] ** 2
crit = {"stature": D["stature"], "weight": D["weightkg"], "bmi": bmi, "relative sitting height": D["sittingheight"] / D["stature"],
        "relative arm length": (D["acromionradialelength"] + D["radialestylionlength"]) / D["stature"], "waist to chest": D["waistcircumference"] / D["chestcircumference"],
        "shoulder to hip": D["biacromialbreadth"] / D["hipbreadth"], "short and heavy": bmi - 60 * (D["stature"] - D["stature"].mean()),
        "limb muscle for the waist": (D["forearmcircumferenceflexed"] + D["calfcircumference"]) / D["waistcircumference"]}
k = max(1, n // 60); pick = []
for name, c in crit.items():
    o = np.argsort(c); pick += list(o[:k]) + list(o[-k:])
pick = list(dict.fromkeys(pick)); rest = [i for i in rng.permutation(NP) if i not in set(pick)]
idx = np.array(pick + rest[: n - len(pick)]); n_ext = len(pick)
T = torch.tensor(np.stack([D[d][idx] for d in ALL], 1), dtype=FT)
SD = torch.tensor([D[d].std() for d in ALL], dtype=FT)
WCH = float(__import__("os").environ.get("RP_WCHEST", "1")); LREG = float(__import__("os").environ.get("RP_LREG", "1e-3"))
WCB = float(__import__("os").environ.get("RP_WCHESTB_MALE", "1")) if sex == "male" else 1.0; LAPW = float(__import__("os").environ.get("RP_LAP", "0"))
WT = torch.tensor([{"stature": float(__import__("os").environ.get("RP_WSTAT", "4")), "weightkg": 4.0, "sittingheight": 2.0, "chestcircumference": WCH, "chestbreadth": WCB}.get(d, 1.0) for d in DIMS] + [W_EXTRA] * len(EXTRA), dtype=FT)
torch.set_num_threads(4)
b = Basis(sex); B = len(idx); T_ALL = T; CH = 128
ROUGH = [0.0]
res = {k: [] for k in ("praw", "lraw", "V", "H", "Mm", "per", "ph", "vol", "rho")}
t0 = time.time()
for c0 in range(0, B, CH):
    T = T_ALL[c0:c0 + CH]; Bc = len(T)
    praw = torch.zeros(Bc, 4, requires_grad=True); lraw = torch.zeros(Bc, b.G, requires_grad=True)
    def forward():
        c = b.coefs(praw, lraw); V, H = b.body(c)
        m = measure(V, H, sex); m["_rough"] = ((c[:, KP:] @ b.BLap) ** 2).reshape(len(c), N, 3).sum(-1).mean(1) * 1e6     # mm^2
        return V, H, torch.stack([m[d] for d in ALL], 1), m
    def loss_fn(Mm):
        z = (Mm - T) / SD
        l = 1.3 * torch.tanh(lraw)
        return (WT * z ** 2).sum(1) / WT.sum() + LREG * (l ** 2 * (1 + 2 * b.fatmus)).sum(1) + LAPW * ROUGH[0]
    for stage, iters, params in ((1, it1, [{"params": [praw], "lr": 0.08}]), (2, it2, [{"params": [praw], "lr": 0.03}, {"params": [lraw], "lr": 0.05}])):
        opt = torch.optim.Adam(params)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=0.003)
        for it in range(iters):
            V, H, Mm, m = forward(); ROUGH[0] = m["_rough"]; per = loss_fn(Mm); loss = per.sum()
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            if it % 50 == 0 or it == iters - 1: print(f"{sex} chunk {c0} stage {stage} it {it:4d} mean loss {float(per.mean().detach()):.4f} worst {float(per.max().detach()):.3f}  {time.time() - t0:.0f} s", flush=True)
    with torch.no_grad():
        V, H, Mm, m = forward(); ROUGH[0] = m["_rough"]; per = loss_fn(Mm); res.setdefault("rough", []).append(m["_rough"].detach().clone())
        for k, v in (("praw", praw), ("lraw", lraw), ("V", V), ("H", H), ("Mm", Mm), ("per", per), ("ph", b.phen(praw)), ("vol", m["_volume"]), ("rho", m["_density"])): res[k].append(v.detach().clone())
praw, lraw, V, H, Mm, per, ph = (torch.cat(res[k]) for k in ("praw", "lraw", "V", "H", "Mm", "per", "ph")); T = T_ALL
m = {"_volume": torch.cat(res["vol"]), "_density": torch.cat(res["rho"])}
np.savez(HERE + OUTD + f"fit-{sex}.npz", idx=idx, n_ext=n_ext, subjectid=D["subjectid"][idx], praw=praw.detach().numpy(), lraw=lraw.detach().numpy(), V=V.numpy().astype(np.float32),
         H=H.numpy().astype(np.float32), measured=Mm.numpy(), target=T.numpy(), loss=per.numpy(), phen=ph.numpy(), local=(1.3 * torch.tanh(lraw)).detach().numpy(),
         keys=np.array(b.keys), dims=np.array(ALL), seconds=time.time() - t0, rough=torch.cat(res["rough"]).numpy(), volume=m["_volume"].numpy(), density=m["_density"].numpy())
e = (Mm - T).numpy(); u = np.array([1.0 if d == "weightkg" else 1000.0 for d in ALL])
print(f"{sex}: {B} people ({n_ext} extremes) in {time.time() - t0:.0f} s; fit error on the mesh (mm; weight kg): mean, mean |e|, p95 |e|")
for i, d in enumerate(ALL): print(f"   {d:32s} {e[:, i].mean() * u[i]:+7.1f} {np.abs(e[:, i]).mean() * u[i]:7.1f} {np.percentile(np.abs(e[:, i]), 95) * u[i]:7.1f}")
print("roughness of the local offsets, mm^2: mean", float(torch.cat(res["rough"]).mean()), "p95", float(torch.cat(res["rough"]).quantile(0.95)))
print("phenotypes mean/min/max", {k: (round(float(ph[:, i].mean()), 2), round(float(ph[:, i].min()), 2), round(float(ph[:, i].max()), 2)) for i, k in enumerate(M.phenotype_labels)})
