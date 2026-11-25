# Cloth form (owner: B8): one cloth simulation per garment in Blender 5.x, headless.
#   Blender -b -P pipeline/cloth_sim.py -- <work folder> <garment mesh name> [--render]
# Reads what `cloth.py prep` wrote (body and skinned garment as PC2 point caches, pins, cloth numbers), writes
# <garment>.sim.npy (frames x vertices x 3, float32, the package's frame: metres, +Y up).
import bpy, sys, os, json, time
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]; work, name = argv[0], argv[1]
cfg = json.load(open(os.path.join(work, name + ".json"))); d = np.load(os.path.join(work, name + ".npz")); N = cfg["frames"]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.gravity = (0.0, -9.81, 0.0); sc.frame_start = 1; sc.frame_end = N; sc.render.fps = 30


def mk(nm, v, t):
    me = bpy.data.meshes.new(nm); me.from_pydata(v.astype(float).tolist(), [], t.astype(int).tolist()); me.update()
    ob = bpy.data.objects.new(nm, me); sc.collection.objects.link(ob); return ob


def cache(ob, path):
    m = ob.modifiers.new("cache", "MESH_CACHE"); m.cache_format = "PC2"; m.filepath = path; m.frame_start = 1.0; m.play_mode = "SCENE"
    m.time_mode = "FRAME"; m.deform_mode = "OVERWRITE"; m.interpolation = "LINEAR"; m.forward_axis = "POS_Y"; m.up_axis = "POS_Z"
    return m


body = mk("body", d["body_v"], d["body_t"]); cache(body, os.path.join(work, name + ".body.pc2"))
body.modifiers.new("col", "COLLISION"); body.collision.thickness_outer = 0.0015; body.collision.thickness_inner = 0.02
body.collision.cloth_friction = 12.0; body.collision.damping = 0.5

g = mk("cloth", d["v"], d["t"]); pin = d["pin"]; vg = g.vertex_groups.new(name="pin")
for i in np.where(pin > 0.002)[0]: vg.add([int(i)], float(pin[i]), "REPLACE")
cache(g, os.path.join(work, name + ".goal.pc2"))
cl = g.modifiers.new("cloth", "CLOTH"); s = cl.settings; c = cfg["cloth"]
s.quality = int(c.get("quality", 8)); s.mass = c["mass"]; s.air_damping = c["air"]
s.tension_stiffness = c["tension"]; s.compression_stiffness = c["compression"]; s.shear_stiffness = c["shear"]; s.bending_stiffness = c["bending"]
dm = float(c.get("damping", 8.0)); s.tension_damping = dm; s.compression_damping = dm; s.shear_damping = dm; s.bending_damping = dm / 8
s.vertex_group_mass = "pin"; s.pin_stiffness = float(c.get("pin_stiffness", 1.0))
s.shrink_min = -float(cfg["grow"])                                   # a negative shrink lengthens the cloth: the slack that makes folds
cs = cl.collision_settings; cs.use_collision = True; cs.distance_min = 0.003; cs.collision_quality = int(c.get("collision_quality", 3)); cs.use_self_collision = "--self" in argv
if cs.use_self_collision: cs.self_distance_min = 0.002; cs.self_friction = 5
cl.point_cache.frame_start = 1; cl.point_cache.frame_end = N

out = np.zeros((N, len(d["v"]), 3), np.float32); buf = np.zeros(len(d["v"]) * 3, np.float32); t0 = time.time()
for f in range(1, N + 1):
    sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get(); me = g.evaluated_get(dg).data
    me.vertices.foreach_get("co", buf); out[f - 1] = buf.reshape(-1, 3)
    if f % 10 == 0 or f == 1:
        print("frame %d  %.0f s  moved %.4f max from goal" % (f, time.time() - t0, float(np.abs(out[f - 1] - d["v"]).max())), flush=True)
np.save(os.path.join(work, name + ".sim.npy"), out)
print("done", name, out.shape, "%.0f s" % (time.time() - t0))
