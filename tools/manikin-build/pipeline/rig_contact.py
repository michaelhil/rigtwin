# Resting contact as capsule contact (owner: RR, round 5). Skin lying on skin (belly on thigh, arm on chest, forearm on
# thigh) cannot be made clean by joints: one surface has to stop at the other. The rig supplies
#   - contact capsules along thigh, upper arm and forearm, fitted to that limb's skin and linear in the shape components,
#   - receiver masks (vertex attributes): who may be pushed by which kind of capsule, zero on the limb itself,
#   - the rule, with this numpy reference of it (rig_rom uses it; the viewer's vertex stage implements the same maths).
# Manifest block and attributes are documented in pipeline/README.md, section "Rig".
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import scipy.sparse as sp
import mh_core as mh
import rig as rg

KNEE = 0.006            # default softness of the contact edge, metres
KNEES = {"thigh": 0.008, "upperarm": 0.006, "forearm": 0.006}     # per capsule kind: softness of the contact edge
# "lip" per kind: (full, none) depths in metres. Skin that is inside the limb by up to `full` is brought out to rest on it; deeper
# skin is brought out less and less, and skin deeper than `none` is left where it is. So the receiver's rim lifts into a rolled
# lip and then dives steeply into the fold: the visible line is one decisive crossing, not two skins grazing each other, and a
# heavy belly is not lifted off the thigh as a shelf (pushing ALL of it out made a ledge 3 cm high: tried, pictures in RR/NOTES.md)
LIPS = {"thigh": (0.016, 0.040), "upperarm": (0.024, 0.048), "forearm": (0.015, 0.030)}
RADIUS_PERCENTILE = 85  # a capsule end's radius: this percentile of its skin's distance from the capsule axis (limbs are not round)
RULE = "capsule-lip/1"
# kind, limb joint -> far joint, slab positions along the bone for the two capsule ends, radius factor
LIMBS = (("thigh", "thigh", "calf", (0.22, 0.86), 0.97), ("upperarm", "upperarm", "lowerarm", (0.30, 0.92), 0.97), ("forearm", "lowerarm", "hand", (0.10, 0.95), 0.97))
MASKS = {"thigh": "_CT_THIGH", "upperarm": "_CT_UPPERARM", "forearm": "_CT_FOREARM"}
TRUNK = ("pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05")


def _sstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def _limb_vertices(pack, verts):
    """Per limb and side: the body vertices that are that limb's skin, with their position along the bone (fixed index sets)."""
    body = mh.load_base().vgroups["body"]; J = pack.joints(verts); W = pack.W.tocsc(); out = {}
    for kind, j0, j1, (ta, tb), _ in LIMBS:
        for s in ("l", "r"):
            cols = [i for i, n in enumerate(rg.JOINTS) if n.endswith("_" + s) and (n.startswith(j0) or (kind == "thigh" and n.startswith(("lap_thigh", "knee_front"))) or (kind == "upperarm" and n.startswith("armpit_arm")))]
            if kind == "forearm": cols = [i for i, n in enumerate(rg.JOINTS) if n.endswith("_" + s) and n.startswith("lowerarm")]
            w = np.asarray(W[:, cols].sum(1)).ravel(); a = J[rg.JI[f"{j0}_{s}"]]; b = J[rg.JI[f"{j1}_{s}"]]; u = b - a; t = (verts - a) @ u / (u @ u)
            ends = []
            for tc in (ta, tb):
                idx = np.nonzero(body & (w > 0.6) & (np.abs(t - tc) < 0.09))[0]; ends.append(idx)
            out[(kind, s)] = ends
    return out


def fit_capsules(pack, verts, limb_sets=None):
    """Capsules for one body: [{"id", "kind", "joint", "a", "b", "ra", "rb"}], a and b relative to the joint (rest world
    axes, metres). Each end is the centroid of a slab of the limb's own skin; its radius is a high percentile of that
    skin's distance from the line through the two centroids, so the receiver comes to rest on (or just clear of) the limb."""
    sets = limb_sets or _limb_vertices(pack, verts); J = pack.joints(verts); out = []
    for kind, j0, j1, _, fac in LIMBS:
        for s in ("l", "r"):
            ia, ib = sets[(kind, s)]; ca = verts[ia].mean(0); cb = verts[ib].mean(0); u = rg.unit(cb - ca)
            rad = lambda idx, c: float(np.percentile(np.linalg.norm((verts[idx] - c) - np.outer((verts[idx] - c) @ u, u), axis=1), RADIUS_PERCENTILE))
            j = rg.JI[f"{j0}_{s}"]
            out.append({"id": f"{kind}_{s}", "kind": kind, "joint": f"{j0}_{s}", "mask": MASKS[kind], "knee": KNEES[kind], "lip": list(LIPS[kind]), "a": ca - J[j], "b": cb - J[j], "ra": fac * rad(ia, ca), "rb": fac * rad(ib, cb)})
    return out


def masks(pack, verts):
    """Receiver masks, one per capsule kind, (19158,) float32 in 0..1: who may be pushed. Zero on the pushing limb itself."""
    W = pack.W.tocsc(); J = pack.joints(verts); body = mh.load_base().vgroups["body"]
    col = lambda pred: np.asarray(W[:, [i for i, n in enumerate(rg.JOINTS) if pred(n)]].sum(1)).ravel()
    trunk = col(lambda n: n in TRUNK or n.startswith(("hip_belly", "groin", "armpit_chest")))
    thigh = col(lambda n: n.startswith(("thigh", "lap_thigh")))
    hipy = 0.5 * (J[rg.JI["thigh_l"]][1] + J[rg.JI["thigh_r"]][1]); hipz = J[rg.JI["thigh_l"]][2]
    out = {}
    # belly, lap and flank, pushed by the thighs: trunk skin from just below the hip joints to the lower ribs, not the back
    out["_CT_THIGH"] = _sstep(trunk, 0.45, 0.85) * _sstep(verts[:, 1], hipy - 0.08, hipy - 0.02) * (1 - _sstep(verts[:, 1], hipy + 0.26, hipy + 0.36)) * _sstep(verts[:, 2], hipz - 0.07, hipz - 0.01)
    # side of chest, breast and flank, pushed by the upper arms: trunk skin (clavicle skin included), not within 7-13 cm of a shoulder joint
    trunk2 = trunk + col(lambda n: n.startswith("clavicle"))
    dsh = np.minimum(np.linalg.norm(verts - J[rg.JI["upperarm_l"]], axis=1), np.linalg.norm(verts - J[rg.JI["upperarm_r"]], axis=1))
    out["_CT_UPPERARM"] = _sstep(trunk2, 0.55, 0.9) * _sstep(dsh, 0.05, 0.10) * _sstep(verts[:, 1], hipy - 0.02, hipy + 0.06)
    # thigh tops and belly, pushed by the forearms
    out["_CT_FOREARM"] = _sstep(trunk + thigh, 0.6, 0.9) * (1 - _sstep(verts[:, 1], hipy + 0.26, hipy + 0.36))
    return {k: (v * body).astype(np.float32) for k, v in out.items()}


def block(pack, base_v, targets=None):
    """The manifest block `contact` and the vertex attributes for the body: capsules fitted on the base shape, each with
    `shape`: {component: {"a", "b", "ra", "rb"}} deltas (capsule of a person = base + sum of weight * delta), and the masks."""
    sets = _limb_vertices(pack, base_v); base = fit_capsules(pack, base_v, sets); r6 = lambda v: [round(float(x), 6) for x in np.atleast_1d(v)]
    caps = [{"id": c["id"], "kind": c["kind"], "joint": c["joint"], "a": r6(c["a"]), "b": r6(c["b"]), "ra": round(c["ra"], 6), "rb": round(c["rb"], 6), "mask": MASKS[c["kind"]], "knee": KNEES[c["kind"]], "lip": list(LIPS[c["kind"]]), "shape": {}} for c in base]
    for t, d in (targets or {}).items():
        cur = fit_capsules(pack, base_v + d, sets)
        for c, b0, c1 in zip(caps, base, cur):
            dd = {"a": r6(c1["a"] - b0["a"]), "b": r6(c1["b"] - b0["b"]), "ra": round(c1["ra"] - b0["ra"], 6), "rb": round(c1["rb"] - b0["rb"], 6)}
            if max(abs(x) for v in dd.values() for x in np.atleast_1d(v)) > 2e-5: c["shape"][t] = dd
    man = {"rule": RULE, "knee": KNEE, "capsules": caps,
           "note": "receiver vertices (mask attribute > 0) inside a capsule are pushed out along its radial direction; see pipeline/README.md, Rig, 'Capsule contact'"}
    return man, masks(pack, base_v)


def person_capsules(contact_block, morph_weights):
    """Capsules of one person: base + sum of shape weight * delta."""
    out = []
    for c in contact_block["capsules"]:
        a = np.array(c["a"], float); b = np.array(c["b"], float); ra = c["ra"]; rb = c["rb"]
        for t, w in (morph_weights or {}).items():
            d = c["shape"].get(t)
            if d and w: a = a + w * np.array(d["a"]); b = b + w * np.array(d["b"]); ra += w * d["ra"]; rb += w * d["rb"]
        out.append({**c, "a": a, "b": b, "ra": ra, "rb": rb})
    return out


def rest_clearance(mask_of, caps, names, J_rest, x_rest, knee=KNEE):
    """Done once per body shape (the viewer: when it bakes the shape). For every capsule and receiver vertex:
        d0 = distance of the REST vertex from the rest capsule's axis segment, r0 = the capsule's radius there
        rho = mask * clamp((d0 - knee) / r0, 0, 1)
    rho is how far out, as a fraction of the capsule's radius, that vertex is entitled to be pushed: 1 for skin that is
    clear of the limb at rest (belly, chest wall), less for skin that is inside the capsule at rest because it is attached
    next to the limb (groin, armpit), 0 for unmasked skin. So nothing moves at rest and the push fades smoothly into the
    crease instead of tearing the skin where receiver and limb are one surface. Returns {capsule id: (n,)}."""
    ix = {n: i for i, n in enumerate(names)}; out = {}
    for c in caps:
        m = mask_of.get(c["mask"])
        if m is None or c["joint"] not in ix: continue
        j = ix[c["joint"]]; a = J_rest[j] + np.asarray(c["a"]); b = J_rest[j] + np.asarray(c["b"]); ab = b - a
        t = np.clip((x_rest - a) @ ab / (ab @ ab), 0, 1); d0 = np.linalg.norm(x_rest - (a + t[:, None] * ab), axis=1); r0 = c["ra"] + t * (c["rb"] - c["ra"])
        out[c["id"]] = m * np.clip((d0 - c.get("knee", knee)) / r0, 0, 1)
    return out


def apply(x, rho, caps, names, Jp, G, knee0=KNEE):
    """The rule (reference): x (n,3) skinned positions; rho from rest_clearance(); caps: this person's capsules; Jp (B,3) posed
    joint positions; G (B,3,3) joint world rotations. For every capsule, on the UNMOVED point:
        p = closest point of the posed segment a-b, r = radius there, d = |x - p|, n = (x - p) / d
        e = rho * r - d                                   (how far inside its entitled distance the vertex is)
        push = 0 for e <= -knee;  (e + knee)^2 / (4 knee) for |e| < knee;  e for e >= knee
        push *= 1 - smoothstep(lip[0], lip[1], e)        (the lip: deep skin stays, see LIPS)
    and the pushes are combined as  x += sum(push_c^2 n_c) / sum(push_c).  Returns (new x, deepest push in metres)."""
    ix = {n: i for i, n in enumerate(names)}; num = np.zeros_like(x); den = np.zeros(len(x)); deepest = 0.0
    for c in caps:
        rh = rho.get(c["id"])
        if rh is None or c["joint"] not in ix: continue
        j = ix[c["joint"]]; a = Jp[j] + G[j] @ np.asarray(c["a"]); b = Jp[j] + G[j] @ np.asarray(c["b"]); ab = b - a
        sel = np.nonzero(rh > 0.003)[0]
        if not len(sel): continue
        xs = x[sel]; t = np.clip((xs - a) @ ab / (ab @ ab), 0, 1); p = a + t[:, None] * ab; r = c["ra"] + t * (c["rb"] - c["ra"])
        dv = xs - p; d = np.maximum(np.linalg.norm(dv, axis=1), 1e-9); e = rh[sel] * r - d; knee = c.get("knee", knee0)
        push = np.where(e <= -knee, 0.0, np.where(e >= knee, e, (e + knee) ** 2 / (4 * knee)))
        if c.get("lip"):
            e1, e2 = c["lip"]; u = np.clip((e - e1) / (e2 - e1), 0, 1); push = push * (1 - u * u * (3 - 2 * u))
        if push.size: deepest = max(deepest, float(push.max()))
        num[sel] += (dv / d[:, None]) * (push ** 2)[:, None]; den[sel] += push
    ok = den > 1e-9; out = x.copy(); out[ok] += num[ok] / den[ok][:, None]
    return out, deepest


GLSL = """
// capsule contact, vertex stage, after skinning and after the plane flatten; x = position in the mesh frame.
// Once per shape bake, on the CPU, per capsule c and vertex (rest position x0, rest capsule a0-b0):
//   t0 = clamp(dot(x0 - a0, b0 - a0) / dot(b0 - a0, b0 - a0), 0, 1);  d0 = |x0 - (a0 + t0 (b0 - a0))|;  r0 = mix(ra, rb, t0)
//   rho[c] = mask * clamp((d0 - knee) / r0, 0, 1)             mask = the capsule kind's vertex attribute (_CT_THIGH, ...)
// Per frame, per capsule c placed with its joint (a = jointPos + jointRot * c.a, same for b):
//   float t = clamp(dot(x - a, b - a) / dot(b - a, b - a), 0., 1.);  vec3 p = a + t * (b - a);  float r = mix(ra, rb, t);
//   vec3 dv = x - p;  float d = max(length(dv), 1e-9);  float e = rho * r - d;
//   float push = e <= -knee ? 0. : (e >= knee ? e : (e + knee) * (e + knee) / (4. * knee));
//   push *= 1. - smoothstep(lip.x, lip.y, e);
//   num += dv / d * push * push;  den += push;
// x += den > 1e-9 ? num / den : vec3(0.);
"""


# ================================================================================================ FORMAT.md v0.5, section 2f
# The viewer's block (RL's proposal, as built in viewer/src/contact.ts): a capsule's axis is the line between two posed joints
# (`span` of it), radii at the two ends, `radiusPerTarget` per shape component; receivers are the channels of the vertex
# attribute `_CONTACT` (x: belly, lap and groin fold, pushed by thighs and forearms; y: chest, breast and flank, pushed by
# the upper arms; z: the limb's own skin that may give way; w = 0). This part fits those capsules and paints those masks.
F_LIMBS = (("thigh", "thigh", "calf", (0.22, 0.95), "x", 0.008), ("upperarm", "upperarm", "lowerarm", (0.25, 0.95), "y", 0.006), ("forearm", "lowerarm", "hand", (0.05, 0.95), "x", 0.006))
F_PROXIES = (("trunk", "pelvis", "spine_03", (0.0, 1.0)), ("chest", "spine_03", "spine_05", (0.0, 1.0)))
F_PERCENTILE = 80


def _joint_line_radius(verts, idx, a, b, t):
    """Radius at parameter t of the joint line a-b: a high percentile of the limb skin's distance from that line in a slab."""
    u = b - a; tt = (verts[idx] - a) @ u / (u @ u); sel = idx[np.abs(tt - t) < 0.09]
    if len(sel) < 6: sel = idx[np.argsort(np.abs(tt - t))[:12]]
    d = verts[sel] - a; d = d - np.outer(d @ u, u) / (u @ u)
    return float(np.percentile(np.linalg.norm(d, axis=1), F_PERCENTILE))


def _f_sets(pack, verts):
    body = mh.load_base().vgroups["body"]; W = pack.W.tocsc(); out = {}
    for kind, j0, j1, span, ch, knee in F_LIMBS:
        for s in ("l", "r"):
            cols = [i for i, n in enumerate(rg.JOINTS) if n.endswith("_" + s) and n.startswith(j0)]
            out[f"{kind}_{s}"] = np.nonzero(body & (np.asarray(W[:, cols].sum(1)).ravel() > 0.6))[0]
    trunk = np.asarray(W[:, [rg.JI[n] for n in TRUNK]].sum(1)).ravel()
    out["trunk"] = np.nonzero(body & (trunk > 0.8))[0]; out["chest"] = out["trunk"]
    return out


def f_fit(pack, verts, sets=None):
    """[{id, from, to, span, radius [r0, r1], receivers, knee}] for one body, in FORMAT 2f's form (radii as numbers)."""
    sets = sets or _f_sets(pack, verts); J = pack.joints(verts); out = []
    for kind, j0, j1, span, ch, knee in F_LIMBS:
        for s in ("l", "r"):
            a = J[rg.JI[f"{j0}_{s}"]]; b = J[rg.JI[f"{j1}_{s}"]]; idx = sets[f"{kind}_{s}"]
            out.append({"id": f"{kind}_{s}", "from": f"{j0}_{s}", "to": f"{j1}_{s}", "span": list(span), "radius": [_joint_line_radius(verts, idx, a, b, span[0] + 0.05), _joint_line_radius(verts, idx, a, b, span[1] - 0.08)], "receivers": ch, "knee": knee})
    for pid, j0, j1, span in F_PROXIES:
        a = J[rg.JI[j0]]; b = J[rg.JI[j1]]; idx = sets[pid]
        out.append({"id": pid, "from": j0, "to": j1, "span": list(span), "radius": [_joint_line_radius(verts, idx, a, b, 0.15), _joint_line_radius(verts, idx, a, b, 0.85)], "receivers": None})
    return out


def f_attr(pack, verts, caps, rest_guard=True):
    """`_CONTACT` (19158,4) float32 for the body. x, y: receiver regions, taken to ZERO for skin that is inside or within
    1.5 knee of a pushing capsule at rest (the viewer's rule scales the push by the mask, so anything inside a capsule at rest
    with a non-zero mask would be pushed out in the rest pose) and rising to 1 over the next 4 cm; z: limb skin facing the trunk."""
    m = masks(pack, verts); J = pack.joints(verts); out = np.zeros((len(verts), 4), np.float32)
    reg = {"x": np.maximum(m["_CT_THIGH"], 0), "y": m["_CT_UPPERARM"]}
    for ch in ("x", "y"):
        g = np.ones(len(verts))
        for c in caps:
            if c["receivers"] != ch or not rest_guard: continue
            a0 = J[rg.JI[c["from"]]]; b0 = J[rg.JI[c["to"]]]; a = a0 + c["span"][0] * (b0 - a0); b = a0 + c["span"][1] * (b0 - a0); ab = b - a
            t = np.clip((verts - a) @ ab / (ab @ ab), 0, 1); d0 = np.linalg.norm(verts - (a + t[:, None] * ab), axis=1); r0 = c["radius"][0] + t * (c["radius"][1] - c["radius"][0])
            g = np.minimum(g, _sstep(d0 - r0, 1.5 * c["knee"], 1.5 * c["knee"] + 0.04))
        out[:, 0 if ch == "x" else 1] = reg[ch] * g
    W = pack.W.tocsc(); col = lambda pred: np.asarray(W[:, [i for i, n in enumerate(rg.JOINTS) if pred(n)]].sum(1)).ravel()
    out[:, 2] = _sstep(col(lambda n: n.startswith(("thigh", "upperarm", "lap_thigh", "armpit_arm"))), 0.6, 0.95) * mh.load_base().vgroups["body"]
    return out


def f_block(pack, base_v, targets=None, flatten=0.0, receivers=("upperarm",)):
    """(manifest block `contact` in FORMAT.md 2f's form, `_CONTACT` attribute (19158,4)). Radii are fitted on the base shape and
    follow the body through `radiusPerTarget` (re-fitted on base + each shape component). `flatten` 0 = the limb's own flatten
    off (the z channel is painted for when it is switched on). `receivers`: which limb kinds push; the others are written as
    proxies (receivers null). Default: the upper arms only. Thighs and forearms pushing the belly raised the deepest overlap
    at hip 95 on the median man (15 -> 34 mm, the groin fold folding on itself) under the viewer's present rule: off until
    the rule has the rest-relative radius and the lip (README, "Capsule contact")."""
    sets = _f_sets(pack, base_v); base = f_fit(pack, base_v, sets); caps = []
    for c in base:
        d = {**c, "radius": [round(c["radius"][0], 5), round(c["radius"][1], 5)], "radiusPerTarget": {}}
        if d["receivers"] and not d["id"].startswith(tuple(receivers)): d["receiversWhenReady"] = d["receivers"]; d["receivers"] = None
        if c["receivers"]: d["skin"] = 0.0
        if c["id"].startswith("thigh"): d["against"] = "trunk"; d["flatten"] = flatten
        if c["id"].startswith("upperarm"): d["against"] = "chest"; d["flatten"] = flatten
        caps.append(d)
    for t, dv in (targets or {}).items():
        cur = f_fit(pack, base_v + dv, sets)
        for d, b0, c1 in zip(caps, base, cur):
            dd = [round(c1["radius"][0] - b0["radius"][0], 5), round(c1["radius"][1] - b0["radius"][1], 5)]
            if max(abs(x) for x in dd) > 2e-4: d["radiusPerTarget"][t] = dd
    return {"capsules": caps, "by": "pipeline/rig_contact.py (RR): fitted to the limb skin, percentile %d of its distance from the joint line" % F_PERCENTILE}, f_attr(pack, base_v, base)


def f_person(block, morph_weights):
    out = []
    for c in block["capsules"]:
        r = list(c["radius"])
        for t, d in (c.get("radiusPerTarget") or {}).items():
            w = (morph_weights or {}).get(t, 0.0); r[0] += w * d[0]; r[1] += w * d[1]
        out.append({**c, "radius": r})
    return out


def f_apply(x, attr, caps, names, Jp):
    """The viewer's capsule rule as built (viewer/src/contact.ts, labCapsules), receivers only (no limb flatten):
    push = mask * (r + knee * ln(1 + exp((d - r) / knee)) - d) for d < r + 6 knee, pushes of all capsules ADDED."""
    ix = {n: i for i, n in enumerate(names)}; out = x.copy(); deepest = 0.0
    for c in caps:
        if not c.get("receivers") or c["from"] not in ix or c["to"] not in ix: continue
        m = attr[:, 0 if c["receivers"] == "x" else 1]; sel = np.nonzero(m > 0)[0]
        if not len(sel): continue
        a0 = Jp[ix[c["from"]]]; b0 = Jp[ix[c["to"]]]; a = a0 + c["span"][0] * (b0 - a0); b = a0 + c["span"][1] * (b0 - a0); ab = b - a; k = c.get("knee", 0.008)
        xs = x[sel]; t = np.clip((xs - a) @ ab / max(ab @ ab, 1e-8), 0, 1); q = xs - (a + t[:, None] * ab); d = np.linalg.norm(q, axis=1)
        r = c["radius"][0] + t * (c["radius"][1] - c["radius"][0]) + c.get("skin", 0.0); z = (d - r) / k
        push = np.where(d < r + 6 * k, (r + k * np.where(z > 20, z, np.log1p(np.exp(np.minimum(z, 20)))) - d) * m[sel], 0.0)
        n = np.where((d > 1e-5)[:, None], q / np.maximum(d, 1e-9)[:, None], np.array([0, 1.0, 0])); out[sel] += n * push[:, None]
        deepest = max(deepest, float(np.max(np.maximum(r - d, 0) * (m[sel] > 0.5), initial=0.0)))
    return out, deepest


def write_contact(glb_path, manifest_path, verts, attr, block, mesh="body"):
    """Add the vertex attribute `_CONTACT` (VEC4 float) to a mesh of a written GLB and the block `contact` to its manifest
    (for writers without the slot; build_body can pass attrs={"_CONTACT": attr} to glb.Mesh and manifest["contact"] = block)."""
    import struct
    from scipy.spatial import cKDTree
    raw = open(glb_path, "rb").read(); jl = struct.unpack_from("<I", raw, 12)[0]; js = json.loads(raw[20:20 + jl]); bo = 20 + jl
    bl = struct.unpack_from("<I", raw, bo)[0]; blob = bytearray(raw[bo + 8:bo + 8 + bl]); n = 0
    tree = cKDTree(np.asarray(verts, dtype=np.float32))
    for me in js["meshes"]:
        if me["name"] != mesh: continue
        for prim in me["primitives"]:
            a = js["accessors"][prim["attributes"]["POSITION"]]; bv = js["bufferViews"][a["bufferView"]]; off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
            P = np.frombuffer(bytes(blob[off:off + a["count"] * 12]), dtype=np.float32).reshape(-1, 3)
            if "_SRC" in prim["attributes"]:
                a2 = js["accessors"][prim["attributes"]["_SRC"]]; bv2 = js["bufferViews"][a2["bufferView"]]; o2 = bv2.get("byteOffset", 0) + a2.get("byteOffset", 0)
                src = np.rint(np.frombuffer(bytes(blob[o2:o2 + a2["count"] * 4]), dtype=np.float32)).astype(np.int64); body_ix = np.nonzero(mh.load_base().vgroups["body"])[0]
                idx = body_ix[src] if src.max() < len(body_ix) else src
            else:
                dist, idx = tree.query(P); assert dist.max() < 1e-4, "write_contact: vertices do not match"
            data = np.asarray(attr, dtype=np.float32)[idx].tobytes()
            while len(blob) % 4: blob.append(0)
            js["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": 34962}); blob.extend(data)
            js["accessors"].append({"bufferView": len(js["bufferViews"]) - 1, "componentType": 5126, "count": len(P), "type": "VEC4"})
            prim["attributes"]["_CONTACT"] = len(js["accessors"]) - 1; n += len(P)
    while len(blob) % 4: blob.append(0)
    js["buffers"][0]["byteLength"] = len(blob); jb = json.dumps(js, separators=(",", ":")).encode(); jb += b" " * ((-len(jb)) % 4)
    open(glb_path, "wb").write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob)) + struct.pack("<II", len(jb), 0x4E4F534A) + jb + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    man = json.load(open(manifest_path)); man["contact"] = block; json.dump(man, open(manifest_path, "w"), indent=1)
    return n


def f_attr_layer(layer_verts, body_verts, body_attr):
    """`_CONTACT` for a garment, shoe or hair mesh: each vertex takes the values of the nearest body vertex (rest shapes)."""
    from scipy.spatial import cKDTree
    body = np.nonzero(mh.load_base().vgroups["body"])[0]
    return np.asarray(body_attr, dtype=np.float32)[body[cKDTree(np.asarray(body_verts)[body]).query(np.asarray(layer_verts))[1]]]
