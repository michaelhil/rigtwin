"""Texture sets and material parameters for the Operator packages.  Owner: B2.

Everything here is derived from CC0 pack textures or generated; nothing is downloaded.  Output goes to a
cache folder (work/avatar-lab/B2/cache/) as PNG/JPEG that glb.write_glb embeds.  Texture budget: 2K head+body
skin (one shared MakeHuman layout), 2K workwear, 1K shoes, 1K eyes, 512 lashes/brows, 1K hair, 512 cap.
"""
from __future__ import annotations
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = __import__("labpaths").LAB
PACKS = os.path.join(LAB, "downloads", "makehuman-assets", "extracted")
SYS = os.path.join(PACKS, "makehuman_system_assets_cc0")
CACHE = os.path.join(LAB, "B2", "cache")

# designer's palette: muted, mid-value, no pure black or white (sRGB 0..255)
PALETTE = {
    "shirt": (66, 92, 104),        # petrol slate
    "trousers": (52, 56, 66),      # dark blue-grey
    "shoe": (86, 88, 92),          # grey
    "sole": (150, 150, 144),       # lighter sole line
    "cap": (58, 72, 84),
    "accent": (196, 132, 44),      # one small accent (cap button, headset ring)
    "headset": (44, 46, 50),
    "cushion": (34, 34, 37),
    "frame": (60, 62, 66),
}

# round 6: the "medium" of rounds 5 was the pack's young_lightskinned_*_diffuse3 (East Asian, but a LIGHT skin: it read as light).
# Medium is now skins01's "midtoned female" by callharvey3d (CC0, pack metadata; RA/pack-asset-licences.tsv), the only mid-toned
# skin in the downloaded packs (median albedo luminance 115 against 184 light and 64 dark); no mid-toned male skin exists in
# them, so the man's medium uses it too (face, neck and hands are what shows; it has no beard shadow).
MIDTONED = os.path.join(PACKS, "skins01_cc0", "skins", "callharvey3d_midtoned_female", "harvey_midtoned_female_diffuse.png")
SKINS = {   # sex -> tone -> diffuse (all CC0, 2048, diffuse only; a relative path is in the system pack)
    "m": {"light": "young_caucasian_male/young_lightskinned_male_diffuse.png",
          "medium": MIDTONED,
          "dark": "young_african_male/young_darkskinned_male_diffuse.png"},
    "f": {"light": "young_caucasian_female/young_lightskinned_female_diffuse.png",
          "medium": MIDTONED,
          "dark": "young_african_female/young_darkskinned_female_diffuse.png"},
}
AKSEL = os.path.join(PACKS, "skins02_cc0", "skins", "mindfront_aksel_skin")     # CC0: the only normal + specular set


def _ensure(p):
    os.makedirs(os.path.dirname(p), exist_ok=True); return p


def _lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def _blur(a, r):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255


def height_to_normal(h, strength=1.0):
    """h (H,W) float, tiling -> normal map uint8 (H,W,3), OpenGL convention (+Y up), as glTF wants."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * 0.5 * strength        # image y is down; +V is up
    n = np.dstack([-dx, -dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n


def _pack_normal(n):
    return Image.fromarray(np.clip((n * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8))


def _combine_normals(a, b, wb=1.0):
    """Add the slopes of b onto a (both unit normals in tangent space)."""
    x = a[..., 0] / np.maximum(a[..., 2], 1e-3) + wb * b[..., 0] / np.maximum(b[..., 2], 1e-3)
    y = a[..., 1] / np.maximum(a[..., 2], 1e-3) + wb * b[..., 1] / np.maximum(b[..., 2], 1e-3)
    n = np.dstack([x, y, np.ones_like(x)])
    return n / np.linalg.norm(n, axis=2, keepdims=True)


def _load_normal(path, size):
    a = np.asarray(Image.open(path).convert("RGB").resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
    n = a * 2 - 1
    return n / np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)


def weave_height(size, kind="twill", pitch=4):
    """Tileable weave height field. twill: diagonal ribs; plain: over-under checker; knit: not used."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    if kind == "twill":
        h = 0.5 + 0.5 * np.sin((x + y) * (2 * np.pi / pitch)) * (0.75 + 0.25 * np.sin((x - y) * (2 * np.pi / (pitch * 2))))
    else:
        wx = np.abs(np.sin(x * np.pi / pitch)); wy = np.abs(np.sin(y * np.pi / pitch))
        over = ((np.floor(x / pitch) + np.floor(y / pitch)) % 2) > 0
        h = np.where(over, wx * 0.6 + 0.4, wy * 0.6)
    return h


# ----------------------------------------------------------------------------------------------- UV rasterising
def raster_classes(uv, tri_uv, tri_class, size, grow=6):
    """Class id image (H,W) uint8 from triangles in UV space (0 = nothing); grown by `grow` px so bilinear
    filtering and mip-maps never reach the background."""
    im = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(im)
    P = uv[tri_uv]                                    # (t,3,2)
    X = P[..., 0] * size; Y = (1 - P[..., 1]) * size
    for t in np.argsort(tri_class):
        c = int(tri_class[t])
        if c: d.polygon([(X[t, 0], Y[t, 0]), (X[t, 1], Y[t, 1]), (X[t, 2], Y[t, 2])], fill=c, outline=c)
    a = np.asarray(im)
    if grow:
        g = np.asarray(im.filter(ImageFilter.MaxFilter(2 * grow + 1)))
        a = np.where(a > 0, a, g)
    return a


def seam_height(uv, tri_uv, size, width=3, stitch=True, inset=7):
    """Seams and stitching from the UV island borders: a raised welt along each border with a stitched
    groove just inside it. -> height (H,W) float in about -1..1."""
    # round 13: UV vertices at the same place are one (the packs duplicate UV indices along cuts that are not island borders,
    # which drew short stitched seams all over the shirt)
    _, wid = np.unique(np.round(np.asarray(uv, np.float64) * 2 ** 16).astype(np.int64), axis=0, return_inverse=True); wid = wid.ravel()
    e = np.concatenate([tri_uv[:, [0, 1]], tri_uv[:, [1, 2]], tri_uv[:, [2, 0]]]); ew = wid[e]; ok = ew[:, 0] != ew[:, 1]; e, ew = e[ok], ew[ok]
    key = np.minimum(ew[:, 0], ew[:, 1]).astype(np.int64) * len(uv) + np.maximum(ew[:, 0], ew[:, 1])
    uniq, idx, cnt = np.unique(key, return_index=True, return_counts=True)
    border = e[idx[cnt == 1]]
    welt = Image.new("L", (size, size), 0); dw = ImageDraw.Draw(welt)
    for a, b in border:
        p, q = uv[a], uv[b]
        dw.line([(p[0] * size, (1 - p[1]) * size), (q[0] * size, (1 - q[1]) * size)], fill=255, width=width * 2 + 1)
    w = np.asarray(welt.filter(ImageFilter.GaussianBlur(width * 0.6)), dtype=np.float32) / 255
    h = w * 0.8
    if stitch:
        # the stitch line: the iso-line of a wider blur at `inset` px from the border, broken into dashes
        far = np.asarray(welt.filter(ImageFilter.GaussianBlur(inset)), dtype=np.float32) / 255
        ring = np.exp(-((far - 0.22) / 0.035) ** 2)
        y, x = np.mgrid[0:size, 0:size]
        dash = ((x + y) // 5 % 2).astype(np.float32) * 0.6 + ((x - y) // 5 % 2).astype(np.float32) * 0.4
        h = h - ring * 0.5 + ring * dash * 0.7
    return h


# ----------------------------------------------------------------------------------------------- skin
def skin_set(sex, tone, size=2048):
    """-> dict(baseColor, normal, orm, notes). Albedo: pack diffuse with the large-scale baked shading halved;
    normal: the CC0 Aksel set (same UV layout) at reduced strength; ORM: roughness zones from Aksel's specular."""
    out = os.path.join(CACHE, f"skin_{sex}_{tone}_" + os.path.splitext(os.path.basename(SKINS[sex][tone]))[0])   # the source in the name: no stale cache when it changes
    paths = {"baseColor": out + "_base.jpg", "normal": os.path.join(CACHE, "skin_normal.png"), "orm": os.path.join(CACHE, "skin_orm.jpg")}
    if not os.path.exists(paths["baseColor"]):
        src = SKINS[sex][tone] if os.path.isabs(SKINS[sex][tone]) else os.path.join(SYS, "skins", SKINS[sex][tone])
        a = np.asarray(Image.open(src).convert("RGB").resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
        lum = _lum(a); low = _blur(lum, size / 40)
        flat = a * (np.clip(low.mean() / np.maximum(low, 0.05), 0.75, 1.35) ** 0.5)[..., None]     # half of the baked shading out
        Image.fromarray(np.clip(flat * 255, 0, 255).astype(np.uint8)).save(_ensure(paths["baseColor"]), quality=92)
    if not os.path.exists(paths["normal"]):
        n = _load_normal(os.path.join(AKSEL, "Aksel_Skin_NRM.png"), size)
        n[..., :2] *= 0.6; n /= np.linalg.norm(n, axis=2, keepdims=True)                 # the body part is a muscle sculpt: calm it
        _pack_normal(n).save(_ensure(paths["normal"]))
    if not os.path.exists(paths["orm"]):
        s = np.asarray(Image.open(os.path.join(AKSEL, "Aksel_Skin_SPEC.png")).convert("L").resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
        cover = s > 0.02
        sm = np.where(cover, s, s[cover].mean())
        rough = np.clip(0.62 - (sm - sm[cover].mean()) * 1.6, 0.32, 0.8)                  # shinier where the artist painted more specular
        orm = np.dstack([np.ones_like(rough), rough, np.zeros_like(rough)])
        Image.fromarray((orm * 255).astype(np.uint8)).save(_ensure(paths["orm"]), quality=90)
    return paths


# ----------------------------------------------------------------------------------------------- workwear
def garment_set(name, asset, tri_uv, tri_class, class_spec, size=2048, weave_pitch=3):
    """Recolour an authored garment atlas per class, keep its small detail, flatten its painted light, add
    seams from UV borders and a weave to its fold normal map.
    class_spec: {class_id: dict(colour=(r,g,b), rough=float, weave="twill"|"plain"|None, keep=0..1)}"""
    out = os.path.join(CACHE, name)
    paths = {"baseColor": out + "_base.jpg", "normal": out + "_normal.jpg", "orm": out + "_orm.jpg"}
    if all(os.path.exists(p) for p in paths.values()): return paths
    cls = raster_classes(asset.uv, tri_uv, tri_class, size)
    tex = asset.textures
    a = np.asarray(Image.open(tex["diffuse"]).convert("RGB").resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
    lum = _lum(a)
    detail = np.clip(lum / np.maximum(_blur(lum, size / 85), 0.02), 0.55, 1.35)           # seams, stitches, yarn; no big shading
    base = np.zeros_like(a); rough = np.full(lum.shape, 0.85, np.float32)
    seams = seam_height(asset.uv, tri_uv, size)
    n = _load_normal(tex["normalmap"], size) if "normalmap" in tex else np.dstack([np.zeros_like(lum), np.zeros_like(lum), np.ones_like(lum)])
    wh = np.zeros_like(lum)
    rng = np.random.default_rng(7)
    mottle = _blur(rng.random(lum.shape).astype(np.float32), 1.2); mottle = (mottle - mottle.mean()) / max(mottle.std(), 1e-6)
    for c, spec in class_spec.items():
        m = cls == c
        col = (np.array(spec["colour"], np.float32) / 255) ** 2.2
        keep = spec.get("keep", 0.7)
        d = 1 + (detail - 1) * keep + mottle * spec.get("mottle", 0.02)
        base[m] = (np.clip(col[None, :] * d[m][:, None], 0, 1) ** (1 / 2.2))
        rough[m] = spec.get("rough", 0.85)
        if spec.get("weave"):
            wh[m] = weave_height(size, spec["weave"], weave_pitch)[m] * spec.get("weave_amp", 0.5)
    bg = cls == 0
    base[bg] = np.array(PALETTE["trousers"], np.float32) / 255
    Image.fromarray(np.clip(base * 255, 0, 255).astype(np.uint8)).save(_ensure(paths["baseColor"]), quality=92)
    n2 = _combine_normals(n, height_to_normal(seams, 1.6))
    n2 = _combine_normals(n2, height_to_normal(wh, 1.0))
    _pack_normal(n2).save(paths["normal"], quality=94)
    ao = np.ones_like(lum)
    if "aomap" in tex:
        ao = np.asarray(Image.open(tex["aomap"]).convert("L").resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
        ao = 0.35 + 0.65 * ao
    rough = np.clip(rough - seams * 0.05, 0.3, 1)
    Image.fromarray((np.dstack([ao, rough, np.zeros_like(ao)]) * 255).astype(np.uint8)).save(paths["orm"], quality=90)
    return paths


def flat_set(name, colour, size=512, weave=None, pitch=3, uv=None, tri_uv=None, rough=0.8, seams=False):
    """A plain-colour set with an optional weave and UV-border seams (cap, headset parts)."""
    out = os.path.join(CACHE, name)
    paths = {"baseColor": out + "_base.png", "normal": out + "_normal.png"}
    if all(os.path.exists(p) for p in paths.values()): return paths
    rng = np.random.default_rng(3)
    mottle = _blur(rng.random((size, size)).astype(np.float32), 1.0); mottle = (mottle - mottle.mean()) / max(mottle.std(), 1e-6)
    col = np.array(colour, np.float32)[None, None, :] * (1 + mottle[..., None] * 0.025)
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(_ensure(paths["baseColor"]))
    h = weave_height(size, weave, pitch) * 0.5 if weave else np.zeros((size, size), np.float32)
    n = height_to_normal(h, 1.0)
    if seams and uv is not None:
        n = _combine_normals(n, height_to_normal(seam_height(uv, tri_uv, size, width=2, inset=5), 1.6))
    _pack_normal(n).save(paths["normal"])
    return paths


def recolour_alpha(name, src, colour, size=None, gain=1.0):
    """Hair, brows, lashes: keep the alpha and the strand contrast of a pack texture, set the colour."""
    out = _ensure(os.path.join(CACHE, name + ".png"))
    if os.path.exists(out): return out
    im = Image.open(src).convert("RGBA")
    if size: im = im.resize((size, size), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32) / 255
    lum = _lum(a[..., :3]); cov = a[..., 3] > 0.05
    ref = np.percentile(lum[cov], 75) if cov.any() else 1.0
    col = (np.array(colour, np.float32) / 255)[None, None, :] * np.clip(lum / max(ref, 1e-3), 0.25, 1.8)[..., None] * gain
    out_a = np.dstack([np.clip(col, 0, 1), a[..., 3:4]])
    # bleed colour under transparent texels so mip-maps do not bring in a dark or bright fringe
    out_a[~cov, :3] = np.array(colour, np.float32) / 255 * 0.8
    Image.fromarray((out_a * 255).astype(np.uint8)).save(out)
    return out


def eye_texture(colour="brown", size=1024):
    """The pack's iris + sclera atlas, opaque (its transparent corner belonged to the outer shell)."""
    out = _ensure(os.path.join(CACHE, f"eye_{colour}.jpg"))
    if not os.path.exists(out):
        im = Image.open(os.path.join(SYS, "eyes", "materials", f"{colour}_eye.png")).convert("RGBA")
        bg = Image.new("RGBA", im.size, (214, 208, 202, 255)); im = Image.alpha_composite(bg, im).convert("RGB")
        im.resize((size, size), Image.LANCZOS).save(out, quality=93)
    return out


# ----------------------------------------------------------------------------------------------- wardrobe sets (v2)
NEUTRAL = 0.8      # linear value of a garment's neutral albedo; colourway factor = linear colour / NEUTRAL


def lin(rgb):
    return [(x / 255.0) ** 2.2 for x in rgb]


def colour_factor(rgb, alpha=1.0):
    """glTF baseColorFactor that tints a neutral garment texture to the sRGB colour `rgb`."""
    return [round(min(c / NEUTRAL, 1.0), 4) for c in lin(rgb)] + [alpha]


def neutral_set(name, asset, tri_uv, size=2048, fold=0.5, keep=0.25, rough=0.9, gain_img=None, rough_img=None, seams=True, stitch=False, seam_strength=0.6, grain=None):
    """One material standard for every garment: a NEUTRAL albedo (no colour, no baked light: only the high-frequency
    detail of the authored texture at `keep`), tinted by the colourway through baseColorFactor; the authored fold
    normal at `fold` strength plus seam welts and stitching generated from the UV island borders; roughness high
    (matte, the sheen is the shader's); no occlusion map (the packs' baked occlusion belongs to another pose and
    body and read as stains). gain_img / rough_img: optional (size,size) float images for parts of different
    value or finish in one atlas (sole against upper)."""
    out = os.path.join(CACHE, name)
    paths = {"baseColor": out + "_base.jpg", "normal": out + "_normal.jpg", "orm": out + "_orm.jpg"}
    if all(os.path.exists(p) for p in paths.values()): return paths
    tex = asset.textures
    d = np.ones((size, size), np.float32)
    if "diffuse" in tex and os.path.exists(tex["diffuse"]) and keep > 0:
        a = np.asarray(Image.open(tex["diffuse"]).convert("RGB").resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
        lum = _lum(a) + 0.02
        d = 1 + (np.clip(lum / np.maximum(_blur(lum, size / 170), 0.02), 0.7, 1.3) - 1) * keep
    rng = np.random.default_rng(11)
    mottle = _blur(rng.random((size, size)).astype(np.float32), 1.1); mottle = (mottle - mottle.mean()) / max(mottle.std(), 1e-6)
    T = NEUTRAL * d * (1 + mottle * 0.02)
    if gain_img is not None: T = T * gain_img
    srgb = np.clip(T, 0, 1) ** (1 / 2.2)
    Image.fromarray(np.clip(np.dstack([srgb] * 3) * 255, 0, 255).astype(np.uint8)).save(_ensure(paths["baseColor"]), quality=92)
    flat = np.dstack([np.zeros((size, size), np.float32), np.zeros((size, size), np.float32), np.ones((size, size), np.float32)])
    n = flat
    key = "normalmap" if "normalmap" in tex else None
    if key and os.path.exists(tex[key]) and fold > 0:
        n = _load_normal(tex[key], size); n[..., :2] *= fold; n /= np.linalg.norm(n, axis=2, keepdims=True)
    sh = None
    if seams:
        sh = seam_height(asset.uv, tri_uv, size, width=max(2, size // 700), stitch=stitch, inset=max(5, size // 290))
        n = _combine_normals(n, height_to_normal(_blur(sh.astype(np.float32) * 0.5 + 0.5, 1.0) * 2 - 1, seam_strength))
    if grain:                                                        # a scanned tiling normal baked in (for classes without a detail slot): (path, repeats, strength)
        gp, reps, gs = grain
        g = np.asarray(Image.open(gp).convert("RGB").resize((size // reps, size // reps), Image.LANCZOS), dtype=np.float32) / 255 * 2 - 1
        g = np.tile(g, (reps + 1, reps + 1, 1))[:size, :size]; g[..., :2] *= gs; g /= np.linalg.norm(g, axis=2, keepdims=True)
        n = _combine_normals(n, g)
    _pack_normal(n).save(paths["normal"], quality=94)
    r = np.full((size, size), rough, np.float32) if rough_img is None else rough_img.astype(np.float32)
    Image.fromarray((np.dstack([np.ones_like(r), np.clip(r, 0.05, 1), np.zeros_like(r)]) * 255).astype(np.uint8)).save(paths["orm"], quality=90)
    return paths


def skin_rgba(name, sex, tone, hide=None, hair=None, hair_rgb=(44, 33, 27), size=2048, decals=None, scalp=None, soft=False):
    """Skin albedo with (a) a cropped-hair fade painted from a UV-space hair field (0..1) and (b) the body-hide
    mask of the default outfit in the alpha channel (alpha < 0.5 = hidden; the iso-line is smooth because the
    mask is an interpolated distance field). -> PNG path."""
    out = _ensure(os.path.join(CACHE, name + ".png"))
    if os.path.exists(out): return out
    src = skin_set(sex, tone, size)["baseColor"]
    a = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32) / 255
    if scalp is not None:
        # round 6: the pack skins paint their own hair or stubble on the scalp region and down to the hairline; with a cap on, the
        # band between brows and brim showed it (a speckled, shaved forehead; on the dark tone a pale band). The scalp region,
        # widened by the fade, becomes plain skin continued from around it (normalised convolution, about 25 mm reach).
        from scipy import ndimage
        m = np.asarray(Image.fromarray((np.clip(np.nan_to_num(scalp), 0, 1) * 255).astype(np.uint8)).resize((size, size), Image.BILINEAR), dtype=np.float32) / 255
        m = np.clip(ndimage.gaussian_filter(m, size / 170) * 1.6, 0, 1); w = 1 - m; big = size / 40
        fill = np.dstack([ndimage.gaussian_filter(a[..., k] * w, big) for k in range(3)]) / np.maximum(ndimage.gaussian_filter(w, big), 1e-3)[..., None]
        a = a * w[..., None] + np.clip(fill, 0, 1) * m[..., None]
    if hair is not None:
        h = np.asarray(Image.fromarray((np.clip(np.nan_to_num(hair), 0, 1) * 255).astype(np.uint8)).resize((size, size), Image.BILINEAR), dtype=np.float32) / 255
        h = _blur(h, size / 170)                                             # about 6 mm of fade at the hairline
        rng = np.random.default_rng(5)
        fine = rng.random((size, size)).astype(np.float32); fine = _blur(fine, 0.7); fine = (fine - fine.mean()) / max(fine.std(), 1e-6)
        if soft:                                                         # hair drawn back (the woman): an even tone, no stubble
            cover = np.clip(h * 1.15 - 0.05 + fine * 0.03 * (h > 0.02), 0, 0.95)
            col = (np.array(hair_rgb, np.float32) / 255)[None, None, :] * (1 + fine[..., None] * 0.06)
        else:
            cover = np.clip(h * 1.25 - 0.12 + fine * 0.10 * (h > 0.02), 0, 0.92)   # stubble thins out toward the edge
            col = (np.array(hair_rgb, np.float32) / 255)[None, None, :] * (1 + fine[..., None] * 0.22)
        a = a * (1 - cover[..., None]) + np.clip(col, 0, 1) * cover[..., None]
    for d in (decals or []):                                         # alpha cards painted into the skin (brows): one draw call less, no floating card
        tex = np.asarray(Image.open(d["texture"]).convert("RGBA"), dtype=np.float32) / 255; th, tw = tex.shape[:2]
        P = d["skin_uv"][d["tris"]] * size; P[..., 1] = size - P[..., 1]            # (t,3,2) pixel positions in the skin image
        Q = d["uv"][d["tri_uv"]] * np.array([tw, th]); Q[..., 1] = th - Q[..., 1]   # the same corners in the card texture
        col = np.array(d["colour"], np.float32) / 255
        for t in range(len(P)):
            (x0, y0), (x1, y1), (x2, y2) = P[t]
            xa, xb = int(np.floor(min(x0, x1, x2))), int(np.ceil(max(x0, x1, x2))); ya, yb = int(np.floor(min(y0, y1, y2))), int(np.ceil(max(y0, y1, y2)))
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(den) < 1e-9 or xb <= xa or yb <= ya: continue
            xs, ys = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
            l0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / den; l1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / den; l2 = 1 - l0 - l1
            m = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            if not m.any(): continue
            qx = np.clip((l0 * Q[t, 0, 0] + l1 * Q[t, 1, 0] + l2 * Q[t, 2, 0]).astype(int), 0, tw - 1); qy = np.clip((l0 * Q[t, 0, 1] + l1 * Q[t, 1, 1] + l2 * Q[t, 2, 1]).astype(int), 0, th - 1)
            smp = tex[qy, qx]; al = (smp[..., 3] * d.get("strength", 0.85) * m)[..., None]
            lum = _lum(smp[..., :3])[..., None]; shade = col[None, None, :] * (0.7 + 0.6 * lum / max(float(lum.max()), 1e-3))
            sub = a[ya:yb + 1, xa:xb + 1]; sub[:] = sub * (1 - al) + np.clip(shade, 0, 1) * al
    alpha = np.ones((size, size), np.float32)
    if hide is not None:
        m = np.asarray(Image.fromarray((np.clip(np.nan_to_num(hide), 0, 1) * 255).astype(np.uint8)).resize((size, size), Image.BILINEAR), dtype=np.float32) / 255
        alpha = 1 - m
    Image.fromarray((np.dstack([np.clip(a, 0, 1), alpha]) * 255).astype(np.uint8)).save(out)
    return out


FABRICS = os.path.join(LAB, "downloads", "polyhaven", "fabrics")      # Poly Haven CC0 scans (fetched by the coordinator; downloads/MANIFEST.md)
FABRIC = {   # key -> (normal map file, size of one repeat on the garment in metres, detail strength)
    # One repeat = 0.45 m puts the scans' 3-texel thread pitch at about 1.3 mm: a work fabric whose weave reads in the hand and
    # cuff close-ups (at 0.16 m, round 3, the pitch was 0.5 mm and nothing showed). Strength 1 = the scan's own relief.
    "linen": ("rough_linen_nor_gl_1k.jpg", 0.45, 1.0), "denim": ("denim_fabric_04_nor_gl_1k.jpg", 0.45, 1.0),
    "poplin": ("stretch_poplin_nor_gl_1k.jpg", 0.30, 1.0), "jersey": ("jersey_melange_nor_gl_1k.jpg", 0.35, 1.0), "leather": ("brown_leather_nor_gl_1k.jpg", 0.12, 0.6)}
