"""pc_render: clay close-ups for the correctives proof (owner: B3). The rasteriser is RR's (RR/spike.py render()),
with a raking key light. Probes for the team and the designer only."""
import os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import pc_geom as g

def render(V, Fs, c, half, view, up, size=300, ss=2, bad=None, clay=(0.72, 0.70, 0.67)):
    z = -np.asarray(view, float); z /= np.linalg.norm(z); x = np.cross(up, z); x /= np.linalg.norm(x); y = np.cross(z, x)
    Wp = size * ss; N = g.vnormals(V, Fs)
    Pc = (V - c); sx = (Pc @ x / half * 0.5 + 0.5) * Wp; sy = (0.5 - Pc @ y / half * 0.5) * Wp; sz = Pc @ z
    light = (-0.75 * x + 0.45 * y + 0.5 * z); light /= np.linalg.norm(light)
    img = np.full((Wp, Wp, 3), 0.93); zb = np.full((Wp, Wp), -1e9)
    SX = sx[Fs]; SY = sy[Fs]; vis = np.nonzero((SX.max(1) >= 0) & (SX.min(1) <= Wp) & (SY.max(1) >= 0) & (SY.min(1) <= Wp))[0]
    for fi in vis:
        a, b, d = Fs[fi]
        xs = np.array([sx[a], sx[b], sx[d]]); ys = np.array([sy[a], sy[b], sy[d]])
        x0 = max(int(xs.min()), 0); x1 = min(int(xs.max()) + 1, Wp - 1); y0 = max(int(ys.min()), 0); y1 = min(int(ys.max()) + 1, Wp - 1)
        if x0 > x1 or y0 > y1: continue
        den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(den) < 1e-9: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
        w1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den; w2 = 1 - w0 - w1
        ins = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not ins.any(): continue
        zz = w0 * sz[a] + w1 * sz[b] + w2 * sz[d]; sub = zb[y0:y1 + 1, x0:x1 + 1]; upd = ins & (zz > sub)
        if not upd.any(): continue
        n = w0[..., None] * N[a] + w1[..., None] * N[b] + w2[..., None] * N[d]; n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-9)
        front = (n @ z) > 0; lam = np.clip(n @ light, 0, 1); hv = light + z; hv /= np.linalg.norm(hv); spec = np.clip(n @ hv, 0, 1) ** 30
        base = np.array(clay) if bad is None or not bad[fi] else np.array([0.90, 0.12, 0.10])
        col = base * (0.18 + 0.82 * lam[..., None]) + 0.10 * spec[..., None]
        col = np.where(front[..., None], col, np.array([0.25, 0.28, 0.40]))
        sub[upd] = zz[upd]; img[y0:y1 + 1, x0:x1 + 1][upd] = col[upd]
    img = img.reshape(size, ss, size, ss, 3).mean((1, 3))
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)

def font(sz):
    try: return ImageFont.load_default(size=sz)
    except TypeError: return ImageFont.load_default()

def sheet(path, title, cols, rows_imgs, row_labels, notes):
    size = rows_imgs[0][0].shape[0]; pad = 6; top = 50; lab = 46; foot = 20 * len(notes) + 8
    Wd = pad + len(cols) * (size + pad); Ht = top + len(rows_imgs) * (size + pad) + lab + foot
    im = Image.new("RGB", (Wd, Ht), (255, 255, 255)); dr = ImageDraw.Draw(im)
    dr.text((pad, 6), title, fill=(0, 0, 0), font=font(17)); dr.text((pad, 28), "PROBE for the team and the designer. Not for the owner. Red = self-intersecting triangles.", fill=(150, 0, 0), font=font(12))
    for r, imgs in enumerate(rows_imgs):
        for ci, a in enumerate(imgs): im.paste(Image.fromarray(a), (pad + ci * (size + pad), top + r * (size + pad)))
        dr.text((pad + 4, top + r * (size + pad) + 4), row_labels[r], fill=(60, 60, 60), font=font(11))
    yb = top + len(rows_imgs) * (size + pad)
    for ci, (name, sub) in enumerate(cols):
        dr.text((pad + ci * (size + pad) + 2, yb), name, fill=(0, 0, 0), font=font(13)); dr.text((pad + ci * (size + pad) + 2, yb + 17), sub, fill=(40, 40, 40), font=font(10))
    for i, nl in enumerate(notes): dr.text((pad, yb + lab + 20 * i), nl, fill=(0, 0, 0), font=font(12))
    im.save(path)

VIEWS = {"elbow": [("front, lateral", (0.6, 0.3, 1.0), (0, 1, 0)), ("from the trunk side", (-1.0, 0.4, 0.5), (0, 1, 0))],   # camera positions
         "knee": [("lateral side", (1, 0, 0), (0, 1, 0)), ("back three-quarter", (0.6, 0.1, -1), (0, 1, 0))],
         "hip": [("lateral side", (1, 0.1, 0.1), (0, 1, 0)), ("front three-quarter", (0.6, 0.35, 1), (0, 1, 0)), ("from below and behind", (0.5, -0.7, -0.6), (0, 1, 0))],
         "seated": [("lateral side", (1, 0.1, 0.1), (0, 1, 0)), ("front three-quarter", (0.6, 0.35, 1), (0, 1, 0)), ("from below and behind", (0.5, -0.7, -0.6), (0, 1, 0))],
         "shoulder": [("front", (0.25, 0.1, 1), (0, 1, 0)), ("from above and behind", (0.3, 0.6, -0.7), (0, 1, 0)), ("armpit, from below in front", (0.5, -0.6, 0.6), (0, 1, 0))],
         "wrist": [("radial side", (0.3, 0.6, 0.7), (0, 1, 0))], "neck": [("three-quarter", (0.6, 0.1, 1), (0, 1, 0)), ("back", (0.3, 0.2, -1), (0, 1, 0))]}

def sheet_for(outdir, B, name, p, imgs, rec):
    os.makedirs(outdir, exist_ok=True); short = name.split(" ")[0]; views = VIEWS[short.split("_")[0].lower()]
    labels = {"before": "Before: twist joints + masked dual quaternion", "after": "After: + pc correctives"}
    cols = [(labels[k], ", ".join(f"{a} {b}" for a, b in rec[k].items())) for k in ("before", "after")]
    rows = [[render(imgs[k][0], B.T, p["c"], p["half"], -np.asarray(v, float), up, size=420, bad=imgs[k][1]) for k in ("before", "after")] for _, v, up in views]
    sheet(os.path.join(outdir, short + ".png"), f"B3 correctives proof: {name} ({B.name} man)", cols, rows, [v[0] for v in views],
          ["hm08 body, RR's rig (4 influences). dV = whole-body volume change in ml; isect = intersecting triangle pairs near the joint;",
           "tip = joint centre to outer skin relative to rest; section = cut through the joint on the bisecting plane, relative to rest.",
           "Morph weights from the drivers: " + json.dumps(rec.get("weights", {}))])
