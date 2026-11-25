"""Props (owner: B6): models the operator's props by script.  Runs INSIDE Blender 5.2 (bevels, normals, UVs):

    tools/Blender.app/Contents/MacOS/Blender -b -P pipeline/prop_model.py -- headset belt collar shoes

Reads B6/cache/ref.npz (B6/prop_ref.py: the base body and B2's garments, bare soles on y = 0) and writes
packages/props/src/<prop>.npz: split vertices with normals and UVs, triangles, a material zone per triangle and the
binding data props.py needs (anchor weights, soft weights, binding group).  No brand marks anywhere.
"""
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
LAB = __import__("labpaths").LAB
import prop_geo as g, prop_shoe
from prop_geo import Part, unit
PKG = "operator-m"
OUT = os.path.join(LAB, "packages/props/src")          # --out DIR: write <DIR>/<pkg>/<prop>.npz instead (test builds)

ZONES = ["polymer", "polymer_satin", "leatherette", "metal", "foam", "accent", "grille", "rubber",      # headset
         "belt_leather", "belt_metal", "collar_cloth",
         "shoe_upper", "shoe_cap", "shoe_midsole", "shoe_outsole", "shoe_lace", "shoe_lining", "trouser_cloth", "last", "sock", "shoe_eyelet"]
Z = {n: i for i, n in enumerate(ZONES)}
GROUPS = ["rigid", "surface", "buckle", "affine"]
G = {n: i for i, n in enumerate(GROUPS)}
X, Y, Zax = np.eye(3)


def log(*a): print("[prop_model]", *a, flush=True)


# ------------------------------------------------------------------------------------------------ reference surfaces
class Ref:
    def __init__(self):
        d = np.load(os.path.join(LAB, "B6/cache/ref-%s.npz" % PKG))
        self.d = d; self.body_v = d["full_v"]; self.body_t = d["full_t"]

    ALIAS = {"cap": ("garment_cap", "cap"), "garment_trousers": ("garment_trousers",), "garment_shirt": ("garment_top", "garment_shirt"),
             "shoe_boots": ("shoe",), "hair_short": ("hair",)}

    def eye(self):
        """Left eye joint and the head scale relative to the base the numbers below were tuned on (eye half distance 28.9 mm)."""
        jn = [str(x).lower() for x in self.d["joint_names"]]; e = self.d["joint_head"][jn.index("eye_l")]
        return e, float(abs(e[0]) / 0.0289)

    def mesh(self, n):
        """B2's mesh names change between builds: resolve by prefix.  None when the package has no such mesh."""
        for pre in self.ALIAS.get(n, (n,)):
            for k in self.d.files:
                if k.endswith("_v") and k.startswith(pre) and k[:-2] + "_t" in self.d.files: return self.d[k], self.d[k[:-2] + "_t"]
        return None

    def tree(self, names, ymin=None, ymax=None):
        V = []; T = []; o = 0
        for n in names:
            m = (self.body_v, self.body_t) if n == "body" else self.mesh(n)
            if m is None: log("reference has no", n); continue
            v, t = m
            if ymin is not None or ymax is not None:
                c = v[t].mean(1)[:, 1]; t = t[(c > (ymin if ymin is not None else -9)) & (c < (ymax if ymax is not None else 9))]
            V.append(v); T.append(t + o); o += len(v)
        V = np.vstack(V); T = np.vstack(T)
        return BVHTree.FromPolygons(V.tolist(), T.tolist()), V, T


def ray(tree, o, d, dist=1.0):
    hit, n, i, t = tree.ray_cast(Vector(o), Vector(d), dist)
    return (None, None) if hit is None else (np.array(hit), t)


def nearest(tree, p):
    hit, n, i, d = tree.find_nearest(Vector(p))
    return np.array(hit), d, np.array(n)


# ------------------------------------------------------------------------------------------------ Blender side
def to_bl(v): return np.stack([v[:, 0], -v[:, 2], v[:, 1]], 1)
def from_bl(v): return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)


def mirror_part(p, name):
    v = p.v.copy(); v[:, 0] *= -1
    q = Part(name, v, [f[::-1] for f in p.faces], p.zone, p.group, p.bevel, p.sharp, p.soft.copy(), {})
    for k, a in p.attr.items(): q.attr[k] = a.copy() if hasattr(a, "copy") else a
    q.attr["aL"], q.attr["aR"] = p.attr.get("aR", 0.0), p.attr.get("aL", 0.0)
    if isinstance(q.attr.get("orient"), np.ndarray): q.attr["orient"] = q.attr["orient"] * [-1, 1, 1]
    return q


def make_mesh(part):
    me = bpy.data.meshes.new(part.name)
    me.from_pydata(to_bl(part.v).tolist(), [], part.faces); me.update()
    bm = bmesh.new(); bm.from_mesh(me)
    if part.attr.get("recalc", True): bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    else:
        bm.normal_update(); ref_ = part.attr.get("orient")
        if isinstance(ref_, np.ndarray):
            r = Vector(to_bl(ref_[None])[0].tolist()); sgn = sum(f.calc_area() * f.normal.dot(f.calc_center_median() - r) for f in bm.faces)
        elif part.attr.get("orient_up"): sgn = sum(f.calc_area() * f.normal.z for f in bm.faces)
        else: sgn = 1
        if sgn < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    nface0 = len(me.polygons)
    if part.bevel or part.attr.get("subsurf"):
        ob = bpy.data.objects.new(part.name, me); bpy.context.collection.objects.link(ob)
        if part.bevel:
            m = ob.modifiers.new("b", "BEVEL"); m.width = part.bevel[0]; m.segments = part.bevel[1]
            m.limit_method = "ANGLE"; m.angle_limit = math.radians(part.bevel[2] if len(part.bevel) > 2 else 40); m.harden_normals = False
        if part.attr.get("subsurf"):
            m = ob.modifiers.new("s", "SUBSURF"); m.levels = part.attr["subsurf"]
        dg = bpy.context.evaluated_depsgraph_get(); me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob); me = me2
    n = len(me.vertices); modified = n != len(part.v)
    a = me.attributes.new("zone", "INT", "FACE")
    zone = part.zone if (not modified and not np.isscalar(part.zone)) else (part.zone if np.isscalar(part.zone) else part.zone[0])
    a.data.foreach_set("value", (np.full(len(me.polygons), zone, np.int32) if np.isscalar(zone) else np.asarray(zone, np.int32)))
    for key in ("aL", "aR", "aT"):
        val = part.attr.get(key, 0.0)
        arr = np.full(n, float(val)) if np.isscalar(val) or modified else np.asarray(val, float)
        me.attributes.new(key, "FLOAT", "POINT").data.foreach_set("value", arr.astype(np.float32))
    soft = part.soft if not modified else np.zeros(n)
    for key, default in (("sd", 1.0), ("sl", 0.0), ("role", 0.0)):
        val = part.attr.get(key)
        arr = np.full(n, default) if (val is None or modified) else np.asarray(val, float)
        me.attributes.new(key, "FLOAT", "POINT").data.foreach_set("value", arr.astype(np.float32))
    me.attributes.new("soft", "FLOAT", "POINT").data.foreach_set("value", soft.astype(np.float32))
    me.attributes.new("grp", "INT", "POINT").data.foreach_set("value", np.full(n, G[part.group], np.int32))
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(part.sharp))
    return me


def finish(parts, name, uv_angle=66.0, margin=0.006, bake=0, weighted_normals=True):
    """Join the parts, triangulate, unwrap, weighted normals, export npz."""
    bm = bmesh.new()
    for p in parts:
        me = make_mesh(p); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    zv0 = np.empty(len(me.polygons), np.int32); me.attributes["zone"].data.foreach_get("value", zv0); zones_used = sorted(set(zv0.tolist()))
    # Unwrap zone by zone: no UV island ever holds two material zones, so a zone border is a geometric edge with padding
    # on both sides in the atlas (vector-sharp at any distance), never a colour step running through texels.
    bpy.ops.object.mode_set(mode="EDIT")
    for z in sorted(set(a.value for a in me.attributes["zone"].data)) if False else zones_used:
        bpy.ops.mesh.select_all(action="DESELECT"); bpy.ops.object.mode_set(mode="OBJECT")
        zv = np.empty(len(me.polygons), np.int32); me.attributes["zone"].data.foreach_get("value", zv)
        me.polygons.foreach_set("select", (zv == z).tolist()); bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(uv_angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.select_all(action="SELECT"); bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(margin=margin, margin_method="FRACTION", shape_method="AABB", rotate=True)     # a true margin, and boxes: the concave packer laid islands over one another (men's shoe, round 3)
    except Exception as e: log("pack_islands:", e)
    bpy.ops.object.mode_set(mode="OBJECT")
    ao_path = os.path.join(LAB, "packages/props/maps", "%s_%s_ao.png" % (PKG, name)); os.makedirs(os.path.dirname(ao_path), exist_ok=True)
    if bake:
        try:
            sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.samples = 24; sc.cycles.device = "CPU"
            img = bpy.data.images.new(name + "_ao", bake, bake); mt = bpy.data.materials.new(name + "_bake"); mt.use_nodes = True
            nd = mt.node_tree.nodes.new("ShaderNodeTexImage"); nd.image = img; mt.node_tree.nodes.active = nd; me.materials.append(mt)
            sc.render.bake.margin = 6; bpy.ops.object.bake(type="AO")
            img.filepath_raw = ao_path; img.file_format = "PNG"; img.save(); log("baked AO", ao_path)
        except Exception as e: log("AO bake failed:", e)
    if weighted_normals:
        m = ob.modifiers.new("wn", "WEIGHTED_NORMAL"); m.keep_sharp = True; m.mode = "FACE_AREA"; m.weight = 50
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); em = ev.to_mesh()
    nl = len(em.loops); nv = len(em.vertices); nf = len(em.polygons)
    co = np.empty(nv * 3, np.float32); em.vertices.foreach_get("co", co); co = from_bl(co.reshape(-1, 3).astype(np.float64))
    lv = np.empty(nl, np.int32); em.loops.foreach_get("vertex_index", lv)
    cn = np.empty(nl * 3, np.float32); em.corner_normals.foreach_get("vector", cn); cn = from_bl(cn.reshape(-1, 3).astype(np.float64))
    uv = np.empty(nl * 2, np.float32); em.uv_layers.active.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
    ls = np.empty(nf, np.int32); em.polygons.foreach_get("loop_start", ls)
    assert all(len(p.vertices) == 3 for p in em.polygons)
    zone = np.empty(nf, np.int32); em.attributes["zone"].data.foreach_get("value", zone)
    att = {}
    for k in ("aL", "aR", "aT", "soft", "sd", "sl", "role"):
        a = np.empty(nv, np.float32); em.attributes[k].data.foreach_get("value", a); att[k] = a
    grp = np.empty(nv, np.int32); em.attributes["grp"].data.foreach_get("value", grp)
    key = np.concatenate([lv[:, None].astype(np.float64), np.round(cn, 3), np.round(uv, 5)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    tris = inv[(ls[:, None] + np.arange(3)[None, :])]
    src = lv[first]
    out = dict(v=co[src], n=unit(cn[first]), uv=uv[first].astype(np.float64), tris=tris.astype(np.int32), zone=zone, src=src.astype(np.int32),
               anchors=np.stack([att["aL"], att["aR"], att["aT"]], 1)[src], soft=att["soft"][src], sd=att["sd"][src], sl=att["sl"][src], grp=grp[src], zones=np.array(ZONES), groups=np.array(GROUPS),
               role=att["role"][src])
    ev.to_mesh_clear()
    path = os.path.join(OUT, PKG, name + ".npz"); os.makedirs(os.path.dirname(path), exist_ok=True)
    np.savez(path, **out)
    log(name, "unsplit verts", nv, "split verts", len(src), "triangles", nf, "bbox", out["v"].min(0).round(3), out["v"].max(0).round(3))
    bpy.data.objects.remove(ob)
    return out


# ================================================================================================ headset
def build_headset(R):
    tree, HV, HT = R.tree(["body", "cap", "hair_short"], ymin=1.40)
    tree_cap, _, _ = R.tree(["cap"])
    bv = R.body_v
    A_, B_, CW, DEPTH, NS = 0.041, 0.053, 0.021, 0.032, 32          # cup half sizes, cushion width, shell depth, segments
    eye, hs = R.eye()
    win = bv[(bv[:, 1] > eye[1] - 0.065 * hs) & (bv[:, 1] < eye[1] + 0.025 * hs) & (bv[:, 2] > eye[2] - 0.12 * hs) & (bv[:, 2] < eye[2] - 0.04 * hs) & (bv[:, 0] > 0)]
    ear = win[win[:, 0] > win[:, 0].max() - 0.0115]                 # the outer rim of the ear, found from the eye joint
    log("eye joint", eye.round(4), "head scale %.3f" % hs)
    cy = 0.5 * (ear[:, 1].min() + ear[:, 1].max()) + 0.002; cz = 0.5 * (ear[:, 2].min() + ear[:, 2].max()) - 0.001
    log("ear", ear.min(0).round(4), ear.max(0).round(4), "cup centre y z", round(cy, 4), round(cz, 4))

    # --- where the cushion lands: rays along -x on the mid line of the cushion ring; least-squares plane = the cup's tilt
    mid = g.superellipse(A_ - CW / 2, B_ - CW / 2, 40)
    pts = []
    for u, v in mid:
        h, t = ray(tree, (0.25, cy + v, cz + u), (-1, 0, 0))
        if h is not None: pts.append(h)
    pts = np.array(pts)
    M = np.c_[np.ones(len(pts)), pts[:, 1] - cy, pts[:, 2] - cz]; coef, *_ = np.linalg.lstsq(M, pts[:, 0], rcond=None)
    x0, ky, kz = coef; lim = math.tan(math.radians(14)); ky = float(np.clip(ky, -lim, lim)); kz = float(np.clip(kz, -lim, lim))
    Wd = unit(np.array([1.0, -ky, -kz])); U = unit(Zax - (Zax @ Wd) * Wd); V = np.cross(U, Wd)
    log("contact plane x0 %.4f, tilt about z %.1f deg (top out), about y %.1f deg (front out)" % (x0, math.degrees(math.atan(ky)), math.degrees(math.atan(kz))))
    C0 = np.array([x0, cy, cz])                                   # on the contact plane
    # --- ear clearance and cushion depth
    loc = (bv - C0); eu, evv, ew = loc @ U, loc @ V, loc @ Wd
    inside = ((np.abs(eu) / (A_ - CW)) ** 2 + (np.abs(evv) / (B_ - CW)) ** 2 < 1.0) & (bv[:, 0] > 0.03)
    ear_w = float(ew[inside].max())
    wb = max(ear_w + 0.003, 0.017)                                 # baffle plane above the contact plane
    log("ear top %.1f mm above the contact plane; baffle at %.1f mm" % (ear_w * 1000, wb * 1000))
    Cb = C0 + Wd * wb                                              # cup origin: baffle plane centre

    def P(u, v, w): return Cb + np.multiply.outer(u, U) + np.multiply.outer(v, V) + np.multiply.outer(w, Wd)

    base2 = g.superellipse(A_, B_, NS); tg2 = unit(np.roll(base2, -1, 0) - np.roll(base2, 1, 0)); nr2 = np.stack([tg2[:, 1], -tg2[:, 0]], 1)
    def ring(d, w, n=NS):
        """A true offset of the cup outline for small d (even panel gaps and accent ring); the scaled outline further in."""
        s1 = base2 - nr2 * d; s2 = g.superellipse(A_ - d, B_ - d, n); f = float(g.smoothstep(d, 0.015, 0.024))
        s = (1 - f) * s1 + f * s2; return P(s[:, 0], s[:, 1], np.full(n, w))

    # --- cushion: every vertex gets its own depth from a ray along the cup axis, smoothed round the ring
    prof = [(0.0015, 0.0), (-0.0012, 0.22), (-0.0016, 0.58), (0.0012, 0.88), (0.0055, 1.0), (CW - 0.0055, 1.0),
            (CW - 0.0012, 0.88), (CW + 0.0006, 0.50), (CW - 0.0030, 0.0)]
    rings = []; soft = []
    depth = np.zeros((len(prof), NS))
    for k, (d, f) in enumerate(prof):
        s = g.superellipse(A_ - d, B_ - d, NS)
        for j in range(NS):
            o = P(s[j, 0], s[j, 1], 0.0)
            h, t = ray(tree, o + Wd * 0.03, -Wd, 0.12)
            depth[k, j] = (t - 0.03) if h is not None else wb
    depth = np.clip(depth, 0.007, 0.034)
    dmid = np.median(depth[4:6], axis=0)                           # per column: the contact depth
    for _ in range(2): dmid = 0.5 * dmid + 0.25 * (np.roll(dmid, 1) + np.roll(dmid, -1))
    log("cushion depth mm: min %.1f mean %.1f max %.1f" % (dmid.min() * 1000, dmid.mean() * 1000, dmid.max() * 1000))
    for k, (d, f) in enumerate(prof):
        s = g.superellipse(A_ - d, B_ - d, NS)
        dk = depth[k].copy()
        if 4 <= k <= 5: dk = np.minimum(dk, dmid + 0.004)          # contact rows follow the surface (never below it)
        else: dk = dmid
        w = -(dk - 0.0006) * f
        rings.append(P(s[:, 0], s[:, 1], w)); soft.append(np.full(NS, f))
    cv, cf = g.loft(rings, close_r=True)
    side = dict(aL=1.0)
    parts = [Part("cushion_L", cv, cf, Z["leatherette"], sharp=180, soft=np.concatenate(soft), attr=dict(side))]
    # --- baffle cloth inside the opening
    br = ring(CW - 0.004, -0.0012); bv_, bf_ = g.loft([br, ring(CW + 0.008, -0.0022)], cap_end=True)
    parts.append(Part("baffle_L", bv_, bf_, Z["grille"], sharp=40, attr=dict(side, recalc=False)))
    # --- shell
    sh = [(0.0, 0.0), (0.0, 0.0038), (0.0016, 0.0043), (0.0016, 0.0060), (0.0, 0.0066), (0.0010, 0.0170),
          (0.0050, 0.0260), (0.0105, 0.0302), (0.0127, 0.0312), (0.0132, 0.0298), (0.0204, 0.0304), (0.0210, 0.0292)]
    sr = [ring(d, w) for d, w in sh]
    sv, sf = g.loft(sr, cap_start=False, cap_end=True)
    nq = NS
    zone = []
    for i in range(len(sh) - 1):
        z = Z["polymer"]
        if i == 7: z = Z["accent"]
        if i >= 9: z = Z["polymer_satin"]
        if i >= 10: z = Z["grille"]                                 # recessed vent panel in the face plate
        zone += [z] * nq
    zone += [Z["grille"]] * nq
    parts.append(Part("shell_L", sv, sf, zone, sharp=58, attr=dict(side)))
    # --- yoke: a fork round the upper half of the shell, pivots front and rear, hub on top
    # The fork, hub and rails stand in their own frame (leaning LEAN going up); the cup tilts inside the fork about the
    # pivot axis U, as a real cup does when it settles on the head.
    WY = 0.0135; NY = 19; th = np.radians(np.linspace(-14, 194, NY))
    LEAN = math.radians(-2.0)
    Vy = unit(Y * math.cos(LEAN) + X * math.sin(LEAN)); Vy = unit(Vy - (Vy @ U) * U); Wy = np.cross(Vy, U)
    Pc = P(0.0, 0.0, WY)
    log("cup tilt inside the fork %.1f deg" % math.degrees(math.acos(np.clip(Vy @ V, -1, 1))))
    ya, yb = A_ + 0.0060, B_ + 0.0072
    yp = Pc + np.multiply.outer(ya * np.cos(th), U) + np.multiply.outer(yb * np.sin(th), Vy)
    rad = unit(yp - Pc)
    def yprof(i):
        k = g.smoothstep(1 - abs(i - NY // 2) / (NY / 2.0), 0.45, 1.0)       # heavier at the top
        return g.rrect(0.0056 + 0.0024 * k, 0.0125 + 0.0045 * k, 0.0019, 1)
    yv, yf = g.sweep(yp, rad, yprof, round_ends=0.004)
    parts.append(Part("yoke_L", yv, yf, Z["polymer"], sharp=40, attr=dict(side)))
    for sgn, nm in ((1, "f"), (-1, "r")):
        c = P(sgn * (A_ + 0.0035), 0.0, WY)
        pv, pf = g.cylinder(c, U * sgn, 0.0062, 0.0100, 10, up=V)
        parts.append(Part("pivot_%s_L" % nm, pv, pf, Z["polymer"], bevel=(0.0011, 1), sharp=40, attr=dict(side)))
        pv, pf = g.cylinder(c + U * sgn * 0.0048, U * sgn, 0.0030, 0.0016, 8, up=V)
        parts.append(Part("pin_%s_L" % nm, pv, pf, Z["metal"], sharp=40, attr=dict(side)))
    hub_c = Pc + Vy * (yb + 0.0070)
    hv, hf = g.box(hub_c, np.array([U, Vy, Wy]), (0.0125, 0.0090, 0.0066))
    parts.append(Part("hub_L", hv, hf, Z["polymer"], bevel=(0.0030, 2), sharp=40, attr=dict(side)))
    # --- slider: twin steel rails from the hub into the band end
    SL = 0.024; s0 = hub_c + Vy * 0.006; s1 = s0 + Vy * (SL + 0.016)
    for sgn, nm in ((1, "f"), (-1, "r")):
        path = np.array([s0 + U * sgn * 0.0062, s1 + U * sgn * 0.0062])
        rv, rf = g.sweep(path, Wy, g.circle(0.0015, 6))
        parts.append(Part("rail_%s_L" % nm, rv, rf, Z["metal"], sharp=50, attr=dict(side)))
    # --- band: from the top of the left rails over the cap to the right; ends are thicker housings
    E = s0 + Vy * SL                                                # band end (left); mirrored for the right
    top_hit, t = ray(tree_cap, (0.0, 1.9, E[2]), (0, -1, 0)); cap_top = top_hit[1]
    PAD_T, BAND_T = 0.011, 0.0046
    apex = np.array([0.0, cap_top + PAD_T - 0.0015 + BAND_T / 2, E[2]])
    k1 = 0.60 * (apex[1] - E[1]); k2 = 0.50 * E[0]
    left = g.bezier(E, E + Vy * k1, apex + X * k2, apex, 40)
    left = g.resample(left, 14)
    right = left[::-1].copy(); right[:, 0] *= -1
    bp = np.vstack([left, right[1:]]); nb = len(bp)
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(bp, axis=0), axis=1))]; L = arc[-1]
    centre = np.array([0.0, E[1], E[2]])
    out = unit(bp - centre); T_ = g.tangents(bp); out = unit(out - (out * T_).sum(1, keepdims=True) * T_)
    dend = np.minimum(arc, L - arc)
    def bprof(i):
        e = 1 - g.smoothstep(dend[i], 0.026, 0.040)                # 1 in the end housing
        mid_ = g.smoothstep(dend[i], 0.03, L / 2)
        return g.rrect(BAND_T + 0.0058 * e, 0.024 + 0.006 * mid_ + 0.002 * e, 0.0018 + 0.0012 * e, 1)
    bv2, bf2 = g.sweep(bp, out, bprof, round_ends=0.003)
    # anchor weights along the band: the ends go with the cups, the top with the cap
    def band_w(pts):
        s = np.clip(np.interp(pts[:, 0], bp[::-1, 0], arc[::-1]) / L, 0, 1)      # x is monotonic along the band
        wt = np.sin(np.pi * s) ** 2; wl = np.where(s < 0.5, 1 - wt, 0.0); wr = np.where(s >= 0.5, 1 - wt, 0.0)
        return wl, wr, wt
    wl, wr, wt = band_w(bv2)
    parts.append(Part("band", bv2, bf2, Z["polymer"], sharp=40, attr=dict(aL=wl, aR=wr, aT=wt)))
    # --- pad under the band, pressed onto the cap
    sel = np.where(dend > L / 2 - 0.085)[0]
    pp = bp[sel] - out[sel] * (BAND_T / 2 + PAD_T / 2 - 0.0005)
    pv, pf = g.sweep(pp, out[sel], g.rrect(PAD_T, 0.031, 0.0042, 2), round_ends=0.010)
    # conform: nothing of the pad below the cap surface
    moved = 0
    for i in range(len(pv)):
        j = np.argmin(np.linalg.norm(pp - pv[i], axis=1)); n_ = out[sel][j]
        h, t = ray(tree_cap, pv[i] + n_ * 0.03, -n_, 0.06)
        if h is not None and t < 0.03 + 0.0008:
            pv[i] = h + n_ * 0.0008; moved += 1
    wl, wr, wt = band_w(pv)
    parts.append(Part("pad", pv, pf, Z["leatherette"], sharp=180, attr=dict(aL=wl, aR=wr, aT=wt)))
    log("band: end", E.round(4), "apex", apex.round(4), "length %.0f mm" % (L * 1000), "pad verts pressed onto the cap:", moved)
    # clearance of the band over the cap
    cl = [nearest(tree, p - o * BAND_T / 2)[1] for p, o in zip(bp, out)]
    log("band underside to head/cap: min %.1f mm, at 45 deg %.1f mm" % (min(cl) * 1000, cl[len(cl) // 4] * 1000))

    # --- right side = mirror of everything so far that belongs to the left cup
    for p in list(parts):
        if p.name.endswith("_L"): parts.append(mirror_part(p, p.name[:-2] + "_R"))

    # --- boom microphone on the left cup
    tc = P(0.018, -0.034, 0.0)                                     # turret on the lower front of the shell
    tv, tf = g.cylinder(tc + Wd * 0.0262, Wd, 0.0108, 0.0150, 12, up=V)
    parts.append(Part("turret", tv, tf, Z["polymer"], bevel=(0.0016, 2), sharp=40, attr=dict(side)))
    tv, tf = g.cylinder(tc + Wd * 0.0340, Wd, 0.0062, 0.0012, 10, up=V)
    parts.append(Part("turret_cap", tv, tf, Z["polymer_satin"], sharp=40, attr=dict(side)))
    mouth = bv[(np.abs(bv[:, 0]) < 0.004) & (bv[:, 1] > eye[1] - 0.083 * hs) & (bv[:, 1] < eye[1] - 0.055 * hs)]
    my = eye[1] - 0.069 * hs; mz = float(mouth[:, 2].max())
    Mic = np.array([0.040, my - 0.004, mz + 0.004])
    b0 = tc + Wd * 0.0285
    d0 = unit(U * 0.88 - V * 0.42)
    ctrl = [b0, b0 + d0 * 0.022, b0 + d0 * 0.046 + Wd * 0.002, Mic + np.array([0.040, 0.006, -0.034]), Mic + np.array([0.020, 0.002, -0.010]), Mic + np.array([0.008, 0.0, -0.002])]
    bpth = g.resample(g.catmull(ctrl, 8), 14)
    barc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(bpth, axis=0), axis=1))]
    def boomprof(i):
        e = 1 - g.smoothstep(barc[i], 0.018, 0.034)
        pr = g.circle(0.0027 + 0.0019 * e, 6)
        pr[:, 0] *= 1 + 0.5 * e                                    # the root is a flat arm in the turret's plane
        return pr
    bmv, bmf = g.sweep(bpth, Wd, boomprof, caps=True)
    parts.append(Part("boom", bmv, bmf, Z["polymer"], sharp=60, attr=dict(side)))
    cl = [nearest(tree, p)[1] for p in bpth]
    log("boom length %.0f mm, closest to the face %.1f mm; mic centre" % (barc[-1] * 1000, min(cl) * 1000), Mic.round(4), "to face %.1f mm" % (nearest(tree, Mic)[1] * 1000))
    tdir = unit(bpth[-1] - bpth[-2])
    cvv, cff = g.cylinder(bpth[-1] + tdir * 0.002, tdir, 0.0042, 0.007, 8)
    parts.append(Part("mic_collar", cvv, cff, Z["polymer_satin"], bevel=(0.0008, 1), sharp=40, attr=dict(side)))
    fc = bpth[-1] + tdir * 0.016
    n1 = unit(np.cross(tdir, Y)); n2 = np.cross(tdir, n1)
    fr = []
    for a in np.radians(np.linspace(-78, 78, 6)):
        r = 0.0118 * math.cos(a) ** 0.85; z = 0.0150 * math.sin(a)
        c = g.circle(r, 10); fr.append(fc + tdir * z + c[:, :1] * n1 + c[:, 1:2] * n2)
    fv, ff = g.loft(fr, cap_start=True, cap_end=True)
    parts.append(Part("mic_foam", fv, ff, Z["foam"], sharp=180, attr=dict(side)))

    # --- cable stub with a ribbed strain relief at the bottom rear of the left cup
    ang = math.radians(-104); cu, cvv_ = (A_ - 0.001) * math.cos(ang), (B_ - 0.001) * math.sin(ang)
    c0 = P(cu, cvv_ + 0.004, 0.0125); dn = unit(-V * 0.96 - U * 0.25)
    ctrl = [c0, c0 + dn * 0.008, c0 + dn * 0.014, c0 + dn * 0.019]
    cp = g.resample(g.catmull(ctrl, 8), 8); carc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(cp, axis=0), axis=1))]
    ribs = [5.0, 5.0, 4.0, 4.7, 3.7, 4.3, 3.3, 3.8, 2.9]
    def cabprof(i):
        k = int(round(carc[i] / 0.0027))
        r = ribs[min(k, len(ribs) - 1)] * 0.001
        return g.circle(r, 6)
    kv, kf = g.sweep(cp, U, cabprof, caps=True, round_ends=0.0022)
    parts.append(Part("cable", kv, kf, Z["rubber"], sharp=60, attr=dict(side)))
    log("cable end", cp[-1].round(4), "to body %.1f mm" % (nearest(R.tree(["body", "garment_shirt"], ymin=1.3)[0], cp[-1])[1] * 1000))
    meta = dict(cup_centre=Cb, cup_axes=np.array([U, V, Wd]), cup_half=(A_, B_), band_apex=apex, mic=Mic)
    return parts, meta


# ================================================================================================ belt
def polar_loop(tree, centre, y, n, r0=0.5, axis=None):
    """Outline of a surface seen from outside: n rays towards `centre` in the horizontal plane at height y."""
    out = []
    for a in np.linspace(0, 2 * np.pi, n, endpoint=False):
        d = np.array([math.sin(a), 0.0, math.cos(a)])               # a = 0 is the front (+Z), a = 90 deg the left (+X)
        c = np.array([centre[0], y, centre[2]])
        h, t = ray(tree, c + d * r0, -d, r0)
        out.append(h if h is not None else c * np.nan)
    out = np.array(out); bad = np.isnan(out[:, 0]); idx = np.arange(n)
    if bad.any() and not bad.all():                                  # a gap (fly, low front rise): bridge it from its neighbours
        for k in range(3): out[bad, k] = np.interp(idx[bad], idx[~bad], out[~bad, k], period=n)
    return out


def smooth_loop(P, it=2):
    for _ in range(it): P = 0.5 * P + 0.25 * (np.roll(P, 1, 0) + np.roll(P, -1, 0))
    return P


def build_belt(R):
    tree, TV, TT = R.tree(["garment_trousers"])
    top = float(TV[:, 1].max()); W_, TH, CLR, N = 0.036, 0.0034, 0.0012, 56
    yc = top - 0.014 - W_ / 2
    band = TV[np.abs(TV[:, 1] - yc) < 0.02]; c = np.array([0.0, yc, 0.5 * (band[:, 2].min() + band[:, 2].max())])
    lo = smooth_loop(polar_loop(tree, c, yc - W_ / 2, N)); mid = smooth_loop(polar_loop(tree, c, yc, N)); hi = smooth_loop(polar_loop(tree, c, yc + W_ / 2, N))
    up = unit(hi - lo); tang = unit(np.roll(mid, -1, 0) - np.roll(mid, 1, 0)); nrm = unit(np.cross(up, tang))
    nrm *= np.sign(((mid - c) * nrm).sum(1))[:, None]
    girth = np.linalg.norm(np.roll(mid, -1, 0) - mid, axis=1).sum()
    log("belt: trouser top %.3f, belt centre y %.3f, girth %.0f mm" % (top, yc, girth * 1000))
    pr = g.rrect(TH, W_, 0.0012, 1)
    rings = [mid[i] + nrm[i] * (CLR + TH / 2) + pr[:, :1] * nrm[i] + pr[:, 1:2] * up[i] for i in range(N)]
    V_ = np.vstack(rings); F = []
    k = len(pr)
    for i in range(N):
        for j in range(k):
            a = i * k + j; b = i * k + (j + 1) % k; i2 = (i + 1) % N
            F.append((a, i2 * k + j, i2 * k + (j + 1) % k, b))
    parts = [Part("belt_strap", V_, F, Z["belt_leather"], group="surface", sharp=45)]
    def station(a_deg):
        """Frame on the belt's outer face at angle a (interpolated)."""
        f = (a_deg % 360) / 360 * N; i = int(f) % N; j = (i + 1) % N; t = f - int(f)
        m = (1 - t) * mid[i] + t * mid[j]; n_ = unit((1 - t) * nrm[i] + t * nrm[j]); u_ = unit((1 - t) * up[i] + t * up[j])
        return m + n_ * (CLR + TH), n_, u_, unit(np.cross(u_, n_))
    # strap tip: a second layer running from the buckle to the wearer's left, rounded end
    tip = []
    for a in np.linspace(-2, 34, 12):
        o, n_, u_, t_ = station(a); e = g.smoothstep(a, 34, 26)
        pr2 = g.rrect(TH, W_ * (0.55 + 0.45 * e), 0.0012, 1)
        tip.append(o + n_ * (TH / 2 + 0.0002) + pr2[:, :1] * n_ + pr2[:, 1:2] * u_)
    tv, tf = g.loft(tip, cap_start=True, cap_end=True)
    parts.append(Part("belt_tip", tv, tf, Z["belt_leather"], group="surface", sharp=45))
    # keeper and trouser loops: flat strips wrapped round the belt
    def wrap(a_deg, width, zone, name, drop=0.0, over=2 * TH + 0.001, t_=0.0016):
        o, n_, u_, tg = station(a_deg)
        h = W_ / 2 + 0.004 + drop
        path = [o - n_ * (TH + CLR + 0.0005) + u_ * (h + 0.006), o - n_ * (TH * 0.3) + u_ * (h + 0.002), o + n_ * (over - TH) + u_ * (h - 0.004), o + n_ * (over - TH) - u_ * (h - 0.004),
                o - n_ * (TH * 0.3) - u_ * (h + 0.002), o - n_ * (TH + CLR + 0.0005) - u_ * (h + 0.006)]
        pth = g.resample(g.catmull(path, 4), 11)
        v, f = g.sweep(pth, n_, g.rrect(t_, width, 0.0006, 1), caps=True)
        parts.append(Part(name, v, f, zone, group="surface", sharp=50))
    wrap(14, 0.010, Z["belt_leather"], "keeper", drop=-0.003, over=3 * TH + 0.001)
    for i, a in enumerate((42, 100, 180, 260, 318)):
        wrap(a, 0.011, Z["trouser_cloth"], "loop%d" % i, drop=0.001, over=TH + 0.0012)
    # buckle: a rounded frame with a prong, lying on the strap at the front
    o, n_, u_, tg = station(0)
    bw, bh, rr = 0.046, W_ + 0.010, 0.0022
    fp = g.rrect(bw, bh, 0.007, 3)
    path = o + n_ * (TH + rr + 0.0004) + fp[:, :1] * tg + fp[:, 1:2] * u_ - tg * 0.004
    fv, ff = g.sweep(path, n_, g.rrect(2 * rr, 2 * rr * 0.9, 0.0012, 1), closed=True)
    parts.append(Part("buckle_frame", fv, ff, Z["belt_metal"], group="buckle", sharp=50))
    c0 = o + n_ * (TH + rr + 0.0004) - tg * 0.004
    pin = [c0 + tg * (bw / 2 - rr) - n_ * 0.0006, c0 + n_ * 0.0016, c0 - tg * (bw / 2 - 0.001) + n_ * 0.0012]
    pv, pf = g.sweep(g.resample(g.catmull(pin, 4), 6), n_, g.circle(0.0015, 6), caps=True, round_ends=0.0008)
    parts.append(Part("buckle_prong", pv, pf, Z["belt_metal"], group="buckle", sharp=60))
    bar = [c0 + tg * (bw / 2 - rr) + u_ * (bh / 2 - rr), c0 + tg * (bw / 2 - rr) - u_ * (bh / 2 - rr)]
    return parts, dict(belt_y=yc, belt_width=W_, girth=girth)


# ================================================================================================ collar (mock-neck base layer)
def build_collar(R):
    """A stand collar that closes the shirt's open neck: a ring round the neck with a rolled top edge, running down
    under the shirt as a yoke so the opening shows cloth, not a hole.  Bound to the body surface."""
    eye, hs = R.eye()
    ax = unit(np.array([0.0, 0.949, 0.316])); c = np.array([0.0, eye[1] - 0.1358 * hs, eye[2] - 0.1116 * hs])      # neck base and axis, placed from the eye joint
    tree, BV, BT = R.tree(["body"], ymin=c[1] - 0.2, ymax=c[1] + 0.13 * hs)
    e1 = unit(Zax - (Zax @ ax) * ax); e2 = np.cross(ax, e1)            # e1 forward, e2 = to the character's left
    NT, H_TOP, EASE = 40, 0.040, 0.0030
    cols = []
    for a in np.linspace(0, 2 * np.pi, NT, endpoint=False):
        rd = math.cos(a) * e1 + math.sin(a) * e2
        front = 0.5 + 0.5 * math.cos(a)
        phis = np.radians(np.linspace(25, 120, 70)); hits = []
        for ph in phis:
            d = unit(math.cos(ph) * ax + math.sin(ph) * rd)
            h, t = ray(tree, c + d * 0.45, -d, 0.45)
            if h is None or np.linalg.norm(h - c) > 0.11 * hs:
                if len(hits) >= 6: break                                   # the body is hidden under the top from here on
                continue
            hits.append(h)
        if len(hits) < 6: hits = [c + unit(math.cos(ph) * ax + math.sin(ph) * rd) * 0.062 * hs for ph in phis[:30]]
        hits = np.array(hits); hgt = (hits - c) @ ax
        top_h = H_TOP - 0.008 * front                                  # a little lower at the throat
        i_top = int(np.argmax(hgt < top_h))
        # A band only: it ends just below the neck base and its lower edge lies on the skin.  (Round 2 ran a yoke down
        # the chest under the shirt; on the women it came through the shirt, so it is gone.  The body keeps its skin
        # in the shirt's opening now, format 0.3, so there is no hole left to close.)
        low = -(0.006 + 0.014 * front) * hs
        rad_ = np.linalg.norm((hits - c) - np.outer(hgt, ax), axis=1); ii = np.arange(len(hits))
        r_top = float(rad_[i_top]); rlim = r_top + (0.010 + 0.012 * front) * hs          # never out over the trapezius
        below = np.where(((hgt < low) | (rad_ > rlim)) & (ii > i_top + 4))[0]; i_bot = int(below[0]) if len(below) else len(hits) - 1
        lower = np.where(((hgt < low - 0.009 * hs) | (rad_ > rlim + 0.008 * hs)) & (ii > i_bot))[0]; i_ext = int(lower[0]) if len(lower) else len(hits) - 1
        sel = np.r_[np.linspace(i_top, i_bot, 6), np.linspace(i_bot, i_ext, 4)[1:]].round().astype(int)
        col = hits[sel]
        rr = unit(col - (c + np.outer((col - c) @ ax, ax)))
        ease = EASE * np.r_[1.0, 1.0, 1.0, 1.0, 0.85, 0.6, 0.3, 0.05, -0.25]
        outer = col + rr * ease[:, None]
        roll_top = outer[0] + ax * 0.0022 - rr[0] * 0.0016
        inner = [outer[0] - rr[0] * 0.0030 - ax * 0.0002, outer[0] - rr[0] * 0.0030 - ax * 0.008]
        cols.append(np.vstack([inner[1], inner[0], roll_top, outer]))
    cols = np.array(cols)                                              # (NT, 12, 3)
    for k in range(cols.shape[1]): cols[:, k] = smooth_loop(cols[:, k], 1)
    rings = [cols[:, k] for k in range(cols.shape[1])]
    v, f = g.loft(rings)
    log("collar: neck axis", ax.round(3), "top edge y %.3f..%.3f, lowest y %.3f" % (rings[2][:, 1].min(), rings[2][:, 1].max(), rings[-1][:, 1].min()))
    return [Part("collar", v, f, Z["collar_cloth"], group="surface", sharp=180, attr=dict(recalc=False, orient=c + ax * 0.02))], dict(neck_axis=ax)   # an open band: faces turned away from the neck axis explicitly


# ================================================================================================ shoes: sole unit and toe cap on B2's boots
SOLE = 0.028          # sole height: bare foot sole (y = 0) to the ground, metres.  THE parameter (override: --sole 0.030)


def foot_measures(R):
    jn = [str(x).lower() for x in R.d["joint_names"]]; ank = R.d["joint_head"][jn.index("foot_l")]
    bv = R.body_v; near = np.linalg.norm(bv[:, [0, 2]] - ank[[0, 2]], axis=1)
    fv = bv[(bv[:, 0] > 0) & (bv[:, 1] < ank[1] - 0.002) & (near < 0.33)]
    m = prop_shoe.measure_foot(fv, sole_y=float(fv[:, 1].min()))
    H = prop_shoe.collar_height(m) + m["sole_y"]
    lv = bv[(bv[:, 0] > 0) & (bv[:, 1] > H - 0.004) & (bv[:, 1] < H + 0.012) & (near < 0.12)]
    m["leg"] = prop_shoe.measure_leg(lv, m); m["ankle"] = ank
    log("foot: length %.0f mm, ball %.0f mm at t %.2f, heel %.0f mm, sole y %.4f, toes out %.1f deg; leg at the collar (%.0f mm up): %.0f x %.0f mm" % (
        m["length"] * 1000, m["ball_w"] * 1000, m["ball_t"], m["heel_w"] * 1000, m["sole_y"], math.degrees(math.atan2(m["F"][0], m["F"][2])), m["leg"]["H"] * 1000, 2000 * m["leg"]["ax"], 2000 * m["leg"]["b"]))
    return m, ank, fv


def _shoe_meta(m, L, fv):
    return dict(sole_height=SOLE, ground_y=m["sole_y"] - SOLE, foot_forward=m["F"], foot_length=m["length"], foot_box=np.array([fv.min(0) - 0.004, fv.max(0) + 0.004]),
                last_length=L.Ls, collar_height=L.H, opening=np.array([L.tb, L.tf, L.bb]), **getattr(L, "meta", {}))


def build_shoes(R):
    """S1 mid-cut safety trainer on a last (prop_shoe.py); left and its mirror."""
    m, ank, fv = foot_measures(R)
    parts, L = prop_shoe.build_shoe(m, SOLE, Z)
    for p in list(parts): parts.append(mirror_part(p, p.name + "_R"))
    return parts, _shoe_meta(m, L, fv)


def build_last(R):
    """The abstract style's shod foot (round 4, prop_shoe.CleanLast): a simplified low work trainer whose collar is the upper's own
    rolled top edge on the leg, a sole with drop and toe spring, heel counter and toe bumper; same sole height as the trainer."""
    m, ank, fv = foot_measures(R)
    bv, bt = R.body_v, R.body_t; P_ = bv[bt]; tc = P_.mean(1)
    skin = P_[(tc[:, 0] > 0.03) & (np.linalg.norm(tc[:, [0, 2]] - ank[[0, 2]], axis=1) < 0.33) & (P_[:, :, 1].max(1) < 0.24)]      # the left lower leg and foot
    near = np.linalg.norm(bv[:, [0, 2]] - ank[[0, 2]], axis=1); fv2 = bv[(bv[:, 0] > 0) & (bv[:, 1] < 0.2) & (near < 0.33)]
    parts, L = prop_shoe.build_last(m, SOLE, Z, skin, fv2)
    log("last:", L.info)
    for p in list(parts): parts.append(mirror_part(p, p.name + "_R"))
    return parts, _shoe_meta(m, L, fv)


BUILDERS = {"headset": build_headset, "belt": build_belt, "collar": build_collar, "shoes": build_shoes, "last": build_last}
BAKE = {"headset": 1024, "shoes": 1024}



def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    global SOLE, PKG
    if "--pkg" in argv: PKG = argv[argv.index("--pkg") + 1]; argv = [x for i, x in enumerate(argv) if x != "--pkg" and argv[i - 1] != "--pkg"]
    if "--sole" in argv: SOLE = float(argv[argv.index("--sole") + 1]); argv = [x for i, x in enumerate(argv) if x != "--sole" and argv[i - 1] != "--sole"]
    global OUT
    if "--out" in argv: OUT = os.path.abspath(argv[argv.index("--out") + 1]); argv = [x for i, x in enumerate(argv) if x != "--out" and argv[i - 1] != "--out"]
    names = [a for a in argv if not a.startswith("-")] or list(BUILDERS)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    R = Ref()
    for n in names:
        parts, meta = BUILDERS[n](R)
        out = finish(parts, n, bake=BAKE.get(n, 0), weighted_normals=n != "last")
        np.savez(os.path.join(OUT, PKG, n + ".meta.npz"), **{k: np.asarray(v) for k, v in meta.items()})


if __name__ == "__main__":
    main()
