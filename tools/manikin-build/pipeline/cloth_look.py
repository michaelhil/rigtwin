# Cloth form (owner: B8): clay pictures of a simulation result under raking light (probe for the team).
#   Blender -b -P pipeline/cloth_look.py -- <work folder> <out png prefix> <garment>[,<garment>] [frame ...]
import bpy, sys, os, json, math
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]; work, out, names = argv[0], argv[1], argv[2].split(","); frames = [int(a) for a in argv[3:] if not a.startswith("--")]
with_body = "--body" in argv                                                         # round 2: show the collider (body, shoes, seat pan) in a darker clay
AZ = [int(x) for x in next((a.split("=")[1] for a in argv if a.startswith("--az=")), "0,40,90,180").split(",")]
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene


def mk(nm, v, t, col, rough=0.9):
    v = np.stack([v[:, 0], -v[:, 2], v[:, 1]], 1)                                  # +Y up -> Blender's +Z up
    me = bpy.data.meshes.new(nm); me.from_pydata(v.astype(float).tolist(), [], t.astype(int).tolist()); me.update()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(nm, me); sc.collection.objects.link(ob)
    m = bpy.data.materials.new(nm); m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    me.materials.append(m); return ob


sc.render.engine = "BLENDER_EEVEE"; sc.render.resolution_x = 900; sc.render.resolution_y = 1200; sc.render.film_transparent = False
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.35, 0.36, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.35
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 4.0; sun.data.angle = 0.05; sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 70


def look(az, target, dist, sun_az):
    a = math.radians(az); cam.location = Vector(target) + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0.15)); d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    s = math.radians(az + sun_az); sd = Vector((math.sin(s), -math.cos(s), 0.9)); sun.rotation_euler = (-sd).to_track_quat("-Z", "Y").to_euler()


for f in frames:
    obs = []
    for name in names:
        d = np.load(os.path.join(work, name + ".npz")); sim = np.load(os.path.join(work, name + ".sim.npy"), mmap_mode="r")
        obs.append(mk(name, np.array(sim[f]), d["t"], (0.55, 0.55, 0.56)))
    allv = np.concatenate([np.array([v.co for v in o.data.vertices]) for o in obs]); c = (allv.min(0) + allv.max(0)) / 2; ext = float((allv.max(0) - allv.min(0)).max())
    if with_body:
        import struct
        raw = open(os.path.join(work, names[0] + ".body.pc2"), "rb").read(); n, k = struct.unpack_from("<i", raw, 16)[0], struct.unpack_from("<i", raw, 28)[0]
        bv = np.frombuffer(raw, "<f4", n * 3, 32 + f * n * 12).reshape(n, 3); obs.append(mk("body", bv.astype(np.float64), np.load(os.path.join(work, names[0] + ".npz"))["body_t"], (0.32, 0.25, 0.22), 0.6))
    for az in AZ:
        look(az, c, ext * 3.1, 70); sc.render.filepath = "%s-f%03d-az%d.png" % (out, f, az); bpy.ops.render.render(write_still=True)
    for o in obs: bpy.data.objects.remove(o)
