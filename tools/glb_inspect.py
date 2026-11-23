#!/usr/bin/env python3
"""Independent GLB reader (Python standard library only; shares no code with the generator).

  python3 -I tools/glb_inspect.py <file.glb> [--poses poses.json] [--tree]

Prints one JSON document: nodes with parents and extras, per-node mesh statistics (triangles,
non-finite values, zero-area triangles, non-unit normals, bounds in the node frame and in the model
frame), totals, and for every joint node the set of nodes that move when it is posed.

Joint posing here is this file's own implementation of the convention described in the manifest:
  node transform(value) = rest · motion(neutral)^-1 · motion(value)
  motion: revolute = rotation about axis; prismatic = translation along axis; ball = Rz(yaw)·Ry(pitch)·Rx(roll)
`bun run check` compares its results with the shared TypeScript implementation (shared/pose.ts).
With --poses {"J_x": [value, ...]} the posed local matrices are included for that comparison.
"""
import json
import math
import struct
import sys


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise SystemExit("not a GLB file")
    off, doc, blob = 12, None, b""
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            doc = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            blob = chunk
        off += 8 + clen
    return doc, blob, len(data)


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def mat_identity():
    return [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]


def mat_translate(t):
    m = mat_identity()
    m[0][3], m[1][3], m[2][3] = t
    return m


def mat_from_quat(q):
    x, y, z, w = q
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0.0],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0.0],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def mat_axis_angle(axis, angle):
    # Rodrigues' formula
    n = math.sqrt(sum(a * a for a in axis)) or 1.0
    x, y, z = (a / n for a in axis)
    c, s = math.cos(angle), math.sin(angle)
    t = 1 - c
    return [
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0.0],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0.0],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def mat_rigid_inverse(m):
    r = [[m[j][i] for j in range(3)] for i in range(3)]
    t = [-sum(r[i][k] * m[k][3] for k in range(3)) for i in range(3)]
    return [r[0] + [t[0]], r[1] + [t[1]], r[2] + [t[2]], [0.0, 0.0, 0.0, 1.0]]


def motion(joint, value):
    kind = joint["type"]
    if kind == "revolute":
        return mat_axis_angle(joint["axis"], value)
    if kind == "prismatic":
        return mat_translate([a * value for a in joint["axis"]])
    if kind == "ball":
        roll, pitch, yaw = value
        return mat_mul(mat_axis_angle([0, 0, 1], yaw), mat_mul(mat_axis_angle([0, 1, 0], pitch), mat_axis_angle([1, 0, 0], roll)))
    raise SystemExit("unknown joint type " + kind)


def local_matrix(node):
    return mat_mul(mat_translate(node.get("translation", [0, 0, 0])), mat_from_quat(node.get("rotation", [0, 0, 0, 1])))


def posed_local(node, value):
    j = node["extras"]["joint"]
    return mat_mul(mat_mul(local_matrix(node), mat_rigid_inverse(motion(j, j["neutral"]))), motion(j, value))


def world_matrices(doc, override=None):
    nodes, out = doc["nodes"], {}

    def walk(i, parent):
        m = mat_mul(parent, override[i] if override and i in override else local_matrix(nodes[i]))
        out[i] = m
        for c in nodes[i].get("children", []):
            walk(c, m)

    for root in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        walk(root, mat_identity())
    return out


COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
FORMATS = {5126: "f", 5123: "H", 5125: "I", 5121: "B"}


def accessor(doc, blob, index):
    a = doc["accessors"][index]
    view = doc["bufferViews"][a["bufferView"]]
    n = COMPONENTS[a["type"]]
    fmt = "<" + FORMATS[a["componentType"]] * (n * a["count"])
    flat = struct.unpack_from(fmt, blob, view.get("byteOffset", 0) + a.get("byteOffset", 0))
    return flat, n


def mesh_stats(doc, blob, mesh):
    st = {"primitives": len(mesh["primitives"]), "triangles": 0, "vertices": 0, "non_finite": 0, "degenerate": 0, "bad_normals": 0,
          "index_out_of_range": 0, "materials": [], "has_uv": [], "min": [math.inf] * 3, "max": [-math.inf] * 3}
    points = []
    for prim in mesh["primitives"]:
        pos, _ = accessor(doc, blob, prim["attributes"]["POSITION"])
        nv = len(pos) // 3
        st["vertices"] += nv
        st["materials"].append(doc["materials"][prim["material"]]["name"] if "material" in prim else None)
        st["has_uv"].append("TEXCOORD_0" in prim["attributes"])
        st["non_finite"] += sum(1 for v in pos if not math.isfinite(v))
        if "NORMAL" in prim["attributes"]:
            nor, _ = accessor(doc, blob, prim["attributes"]["NORMAL"])
            for i in range(0, len(nor), 3):
                l = math.sqrt(nor[i] ** 2 + nor[i + 1] ** 2 + nor[i + 2] ** 2)
                if not (abs(l - 1) < 1e-3):
                    st["bad_normals"] += 1
        else:
            st["bad_normals"] += nv
        if "TEXCOORD_0" in prim["attributes"]:
            uv, _ = accessor(doc, blob, prim["attributes"]["TEXCOORD_0"])
            st["non_finite"] += sum(1 for v in uv if not math.isfinite(v))
        idx, _ = accessor(doc, blob, prim["indices"])
        st["triangles"] += len(idx) // 3
        for t in range(0, len(idx), 3):
            a, b, c = idx[t], idx[t + 1], idx[t + 2]
            if a >= nv or b >= nv or c >= nv:
                st["index_out_of_range"] += 1
                continue
            ax, ay, az = pos[a * 3: a * 3 + 3]
            ux, uy, uz = pos[b * 3] - ax, pos[b * 3 + 1] - ay, pos[b * 3 + 2] - az
            vx, vy, vz = pos[c * 3] - ax, pos[c * 3 + 1] - ay, pos[c * 3 + 2] - az
            cx, cy, cz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            if not (cx * cx + cy * cy + cz * cz > 1e-24):
                st["degenerate"] += 1
        for i in range(0, len(pos), 3):
            p = pos[i: i + 3]
            points.append(p)
            for k in range(3):
                if p[k] < st["min"][k]:
                    st["min"][k] = p[k]
                if p[k] > st["max"][k]:
                    st["max"][k] = p[k]
    return st, points


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    doc, blob, size = read_glb(args[0])
    poses = json.load(open(args[args.index("--poses") + 1])) if "--poses" in args else {}
    nodes = doc["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    world = world_matrices(doc)
    root = doc["scenes"][doc.get("scene", 0)]["nodes"][0]
    # the model frame is the frame of the root node's children: undo the root's own transform
    to_model = mat_rigid_inverse(world[root])
    out_nodes, totals = [], {"triangles": 0, "vertices": 0, "primitives": 0, "non_finite": 0, "degenerate": 0, "bad_normals": 0}
    for i, n in enumerate(nodes):
        rec = {"name": n.get("name"), "parent": nodes[parent[i]].get("name") if i in parent else None, "extras": n.get("extras", {}),
               "has_trs": [k for k in ("translation", "rotation", "scale", "matrix") if k in n]}
        m = mat_mul(to_model, world[i])
        rec["origin"] = [round(m[k][3], 6) for k in range(3)]
        if "mesh" in n:
            st, points = mesh_stats(doc, blob, doc["meshes"][n["mesh"]])
            lo, hi = [math.inf] * 3, [-math.inf] * 3
            for p in points:
                for k in range(3):
                    v = m[k][0] * p[0] + m[k][1] * p[1] + m[k][2] * p[2] + m[k][3]
                    lo[k] = min(lo[k], v)
                    hi[k] = max(hi[k], v)
            st["model_min"], st["model_max"] = [round(v, 6) for v in lo], [round(v, 6) for v in hi]
            rec["mesh"] = st
            for k in totals:
                totals[k] += st[k]
        out_nodes.append(rec)

    def moved_by(index, value):
        over = {index: posed_local(nodes[index], value)}
        w2 = world_matrices(doc, over)
        moved = []
        for k in range(len(nodes)):
            if any(abs(w2[k][r][c] - world[k][r][c]) > 1e-7 for r in range(3) for c in range(4)):
                moved.append(nodes[k].get("name"))
        return moved

    joints = []
    for i, n in enumerate(nodes):
        j = n.get("extras", {}).get("joint")
        if not j:
            continue
        if j["type"] == "ball":
            step = max(abs(j["lower"]), abs(j["upper"])) / 2
            test = [j["neutral"][0] + step, j["neutral"][1] - step, j["neutral"][2] + step / 2]
        else:
            test = j["upper"] if abs(j["upper"] - j["neutral"]) >= abs(j["lower"] - j["neutral"]) else j["lower"]
        rec = {"name": n["name"], "joint": j, "test_value": test, "moved": moved_by(i, test), "rest": local_matrix(n)}
        if n["name"] in poses:
            rec["posed"] = [{"value": v, "matrix": posed_local(n, v)} for v in poses[n["name"]]]
        joints.append(rec)

    result = {
        "file": args[0], "bytes": size, "generator": doc["asset"].get("generator"), "asset_extras": doc["asset"].get("extras"),
        "root": nodes[root].get("name"), "root_rotation": nodes[root].get("rotation"),
        "counts": {"nodes": len(nodes), "meshes": len(doc.get("meshes", [])), "materials": len(doc.get("materials", [])), "textures": len(doc.get("textures", [])), "images": len(doc.get("images", []))},
        "totals": totals, "materials": [m.get("name") for m in doc.get("materials", [])],
        "extensions_used": doc.get("extensionsUsed", []), "nodes": out_nodes, "joints": joints,
    }
    if "--tree" in args:
        def show(i, depth):
            n = nodes[i]
            mesh = out_nodes[i].get("mesh")
            print("  " * depth + (n.get("name") or "?") + (f"  [{mesh['triangles']} tris, {'+'.join(str(x) for x in mesh['materials'])}]" if mesh else "") + (f"  ({n['extras']['joint']['type']})" if "joint" in n.get("extras", {}) else ""))
            for c in n.get("children", []):
                show(c, depth + 1)
        show(root, 0)
    else:
        json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
