// Assembler: declarative spec + resolved parameters + per-group component functions
//   -> node tree (components, joint frames, datums, surfaces) ready for the GLB writer, plus the
//      facts the manifest needs. The frame tree is built from the spec alone, so it exists even
//      when a group's source is absent or not requested.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Vec3, type Mat4, identity, matMul, translation, matFromQuat, quatFromRpy, quatMul, rotationRpy, xformDir, xformPoint, norm } from "../shared/math.ts";
import { jointTransform, trsFromPose, type JointValue } from "../shared/pose.ts";
import type { ManifestComponent, ManifestJoint, ManifestDatum, Box, ParamClass } from "../shared/manifest.ts";
import { kit, type Kit, type Part, type Mesh, assertMesh, mergeParts, triangleCount } from "./kit.ts";
import { evalExpr } from "./expr.ts";
import { ParamTable } from "./params.ts";
import { PALETTE } from "./materials.ts";
import type { OutNode } from "./glb.ts";

// The side marker _L / _R may sit before a trailing index or word (C_pod_button_L_1, J_joy_L_roll).
export const NAME_PATTERN = /^(C|J|D|S)_[a-z0-9]+(_([a-z0-9]+|[LR]))*$/;

export interface NodeSpec { parent?: string; group?: string; label?: string; pos?: (string | number)[]; rpy?: (string | number)[]; joints?: string[]; assembly?: boolean; tags?: string[] }
export interface JointSpec {
  type: "revolute" | "prismatic" | "ball"; axis?: number[]; pos?: (string | number)[]; rpy?: (string | number)[];
  lower: string | number; upper: string | number; neutral: string | number | (string | number)[];
  kind: "adjustment" | "control"; evidence: "seen" | "inferred" | "assumed"; locked: boolean; signal?: string;
}
export interface Spec { asset: string; title: string; groups: string[]; nodes: Record<string, NodeSpec>; joints: Record<string, JointSpec>; motion: Record<string, string[]>; symmetry?: { single?: string[]; free?: string[] } }

/** What a component function receives. */
export interface Ctx {
  /** Component id, e.g. "C_pod_shell_L". */
  id: string;
  /** "L", "R" or null, from the id. */
  side: "L" | "R" | null;
  /** +1 for L (and unsided), -1 for R: multiply a left-side Y by this. */
  sy: number;
  /** A numeric parameter in SI units (metres, radians). */
  p: (key: string) => number;
  /** A list parameter (profile, outline, corner points) in SI units. */
  arr: (key: string) => any;
  kit: Kit;
}
export type ComponentFn = (c: Ctx) => Part | Part[];
export interface GroupModule { components: Record<string, ComponentFn>; omitted?: Record<string, string> }

export function loadSpec(dir: string): Spec {
  const spec = Bun.TOML.parse(readFileSync(join(dir, "rig.toml"), "utf8")) as unknown as Spec;
  const errs: string[] = [];
  spec.nodes ??= {}; spec.joints ??= {}; spec.motion ??= {};
  const roots = Object.entries(spec.nodes).filter(([, n]) => !n.parent).map(([id]) => id);
  if (roots.length !== 1) errs.push(`exactly one root node expected, found ${roots.length}: ${roots.join(", ")}`);
  const usedJoints = new Map<string, string>();
  for (const [id, n] of Object.entries(spec.nodes)) {
    if (!NAME_PATTERN.test(id) || id.startsWith("J_")) errs.push(`node '${id}': name must match ${NAME_PATTERN} and start with C_, D_ or S_`);
    if (n.parent && !spec.nodes[n.parent]) errs.push(`node '${id}': parent '${n.parent}' is not a node`);
    if (id.startsWith("C_") && n.parent && !spec.groups.includes(n.group ?? "")) errs.push(`node '${id}': group '${n.group}' is not one of ${spec.groups.join(", ")}`);
    for (const k of ["pos", "rpy"] as const) if (n[k] && n[k]!.length !== 3) errs.push(`node '${id}': ${k} needs 3 entries`);
    for (const j of n.joints ?? []) {
      if (!spec.joints[j]) errs.push(`node '${id}': joint '${j}' is not defined under [joints]`);
      if (usedJoints.has(j)) errs.push(`joint '${j}' is used by both '${usedJoints.get(j)}' and '${id}'`);
      usedJoints.set(j, id);
    }
    for (let p = n.parent, i = 0; p; p = spec.nodes[p]?.parent) if (++i > 100) { errs.push(`node '${id}': parent chain loops`); break; }
  }
  for (const [id, j] of Object.entries(spec.joints)) {
    if (!NAME_PATTERN.test(id) || !id.startsWith("J_")) errs.push(`joint '${id}': name must start with J_ and match ${NAME_PATTERN}`);
    if (!usedJoints.has(id)) errs.push(`joint '${id}' is not used by any node`);
    if (!["revolute", "prismatic", "ball"].includes(j.type)) errs.push(`joint '${id}': type '${j.type}'`);
    if (j.type !== "ball" && (!Array.isArray(j.axis) || j.axis.length !== 3)) errs.push(`joint '${id}': axis needs 3 numbers`);
    if (!["adjustment", "control"].includes(j.kind)) errs.push(`joint '${id}': kind '${j.kind}'`);
    if (!["seen", "inferred", "assumed"].includes(j.evidence)) errs.push(`joint '${id}': evidence '${j.evidence}'`);
    if (typeof j.locked !== "boolean") errs.push(`joint '${id}': locked must be true or false`);
    if (j.kind === "control" && !j.signal) errs.push(`joint '${id}': control joints need a signal name`);
    if (!spec.motion[id]) errs.push(`joint '${id}': no entry in the [motion] table`);
  }
  for (const id of Object.keys(spec.motion)) if (!spec.joints[id]) errs.push(`[motion] lists '${id}', which is not a joint`);
  if (errs.length) throw new Error(`spec invalid (${errs.length}):\n  ` + errs.join("\n  "));
  return spec;
}

export type BuiltComponent = ManifestComponent;
export type BuiltJoint = ManifestJoint;
export interface Assembly {
  root: OutNode;
  components: BuiltComponent[];
  surfaces: BuiltComponent[];
  joints: BuiltJoint[];
  datums: ManifestDatum[];
  omitted: { id: string; reason: string }[];
  missing: string[];
  notBuilt: string[];
  errors: string[];
  bbox: Box;
}

const r6 = (v: number) => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
const r7 = (v: number) => { const x = Math.round(v * 1e7) / 1e7; return x === 0 ? 0 : x; };

export async function assemble(spec: Spec, params: ParamTable, opts: { srcDir: string; only?: string[] }): Promise<Assembly> {
  const errors: string[] = [], omitted: Assembly["omitted"] = [], missing: string[] = [], notBuilt: string[] = [];
  const built = opts.only?.length ? spec.groups.filter((g) => opts.only!.includes(g)) : spec.groups;
  for (const g of opts.only ?? []) if (!spec.groups.includes(g)) throw new Error(`--only: '${g}' is not a group (${spec.groups.join(", ")})`);

  // group modules (only the requested ones are imported, so a half-edited file elsewhere cannot break this build)
  const modules: Record<string, GroupModule> = {};
  for (const g of built) {
    try {
      const mod = await import(pathToFileURL(join(opts.srcDir, g + ".ts")).href);
      if (!mod.components || typeof mod.components !== "object") throw new Error("the module must export `components`");
      modules[g] = mod as GroupModule;
    } catch (e: any) { errors.push(`${g}.ts: cannot load: ${e.message}`); }
  }

  const ev = (e: string | number | undefined, reader: string, what: string) => (e === undefined ? 0 : evalExpr(e, (k) => params.get(k, reader).value, `${reader} ${what}`));
  const ev3 = (e: (string | number)[] | undefined, reader: string, what: string): Vec3 => [ev(e?.[0], reader, what), ev(e?.[1], reader, what), ev(e?.[2], reader, what)];

  const out = new Map<string, OutNode>(), world = new Map<string, Mat4>();
  const components: BuiltComponent[] = [], surfaces: BuiltComponent[] = [], joints: BuiltJoint[] = [], datums: Assembly["datums"] = [];
  const total = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const originOf = (m: Mat4) => [r6(m[3]), r6(m[7]), r6(m[11])];
  // the component that "owns" a node for parameter bookkeeping: a surface counts toward its parent component
  const ownerOf = (id: string) => (id.startsWith("S_") ? spec.nodes[id].parent! : id);

  for (const [id, n] of Object.entries(spec.nodes)) {
    try {
      const reader = ownerOf(id);
      let parentOut = n.parent ? out.get(n.parent) : undefined, parentWorld = n.parent ? world.get(n.parent)! : identity();
      if (n.parent && !parentOut) throw new Error(`parent '${n.parent}' must be listed before '${id}' in the spec`);
      let chainParent = n.parent ?? "";
      for (const jid of n.joints ?? []) {
        const j = spec.joints[jid];
        const pos = ev3(j.pos, reader, `joint ${jid} pos`), rpy = ev3(j.rpy, reader, `joint ${jid} rpy`);
        const lower = ev(j.lower, reader, `joint ${jid} lower`), upper = ev(j.upper, reader, `joint ${jid} upper`);
        const axis = j.type === "ball" ? null : norm(j.axis as Vec3);
        let neutral: JointValue;
        if (j.type === "ball") neutral = (Array.isArray(j.neutral) ? j.neutral : [0, 0, 0]).map((e) => r6(ev(e, reader, `joint ${jid} neutral`)));
        else {
          neutral = r6(ev(j.neutral as string | number, reader, `joint ${jid} neutral`));
          if (neutral < lower - 1e-9 || neutral > upper + 1e-9) throw new Error(`joint ${jid}: neutral ${neutral} is outside [${lower}, ${upper}]`);
        }
        // the one shared definition: node transform = mount · motion(value), stored at value = neutral
        const { t, q } = jointTransform(trsFromPose(pos, rpy), { type: j.type, axis }, neutral);
        if (!(lower <= upper)) throw new Error(`joint ${jid}: lower ${lower} > upper ${upper}`);
        const node: OutNode = {
          name: jid, translation: t, rotation: q, children: [],
          extras: { id: jid, kind: "joint", joint: { type: j.type, axis: axis ? axis.map(r6) : null, lower: r6(lower), upper: r6(upper), neutral, unit: j.type === "prismatic" ? "m" : "rad", kind: j.kind, evidence: j.evidence, locked: j.locked, signal: j.signal ?? null } },
        };
        (parentOut ? parentOut.children : []).push(node);
        parentWorld = matMul(parentWorld, matMul(translation(t), matFromQuat(q)));
        joints.push({ id: jid, node: jid, parent: chainParent, child: id, type: j.type, axis: axis ? axis.map(r6) : null, lower: r6(lower), upper: r6(upper), neutral, unit: j.type === "prismatic" ? "m" : "rad", kind: j.kind, evidence: j.evidence, locked: j.locked, signal: j.signal ?? null, rest: { t: t.map(r6), q: q.map(r7) }, origin: originOf(parentWorld) });
        parentOut = node; chainParent = jid;
      }
      const pos = ev3(n.pos, reader, "pos"), rpy = ev3(n.rpy, reader, "rpy");
      const node: OutNode = { name: id, translation: pos, rotation: quatFromRpy(rpy), children: [], extras: {} };
      const W = matMul(parentWorld, matMul(translation(pos), rotationRpy(rpy)));
      out.set(id, node); world.set(id, W);
      if (parentOut) parentOut.children.push(node);

      if (id.startsWith("D_")) {
        node.extras = { id, kind: "datum", label: n.label ?? id };
        datums.push({ id, parent: n.parent ?? "", label: n.label ?? id, origin: originOf(W), x_axis: xformDir(W, [1, 0, 0]).map(r6), z_axis: xformDir(W, [0, 0, 1]).map(r6) });
        continue;
      }
      const isSurface = id.startsWith("S_");
      const group = n.group ?? (isSurface ? spec.nodes[n.parent!].group : undefined) ?? null;
      let parts: Part[] = [];
      if (!n.assembly && group) {
        if (!built.includes(group)) notBuilt.push(id);
        else if (modules[group]) {
          const fn = modules[group].components[id], why = modules[group].omitted?.[id];
          if (fn) {
            const side = /_L(_|$)/.test(id) ? "L" : /_R(_|$)/.test(id) ? "R" : null;
            const ctx: Ctx = { id, side, sy: side === "R" ? -1 : 1, p: (k) => params.num(k, reader), arr: (k) => params.arr(k, reader), kit };
            const res = fn(ctx);
            parts = mergeParts((Array.isArray(res) ? res : [res]).filter(Boolean));
            if (!parts.length) throw new Error("the component function returned no parts");
            for (const p of parts) {
              if (!PALETTE[p.material]) throw new Error(`unknown material '${p.material}'. Palette: ${Object.keys(PALETTE).join(", ")}`);
              assertMesh(p.mesh, `[${p.material}]`);
            }
            if (isSurface && parts.some((p) => !p.mesh.uvs)) throw new Error("surface meshes need 0–1 UVs (use kit.sheet or kit.arcSheet)");
            node.parts = parts;
          } else if (why) omitted.push({ id, reason: why });
          else missing.push(id);
        }
      }
      // bookkeeping
      let bbox: BuiltComponent["bbox"] = null, tris = 0;
      if (parts.length) {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const p of parts) {
          tris += triangleCount(p.mesh);
          for (let i = 0; i < p.mesh.positions.length; i += 3) {
            const w = xformPoint(W, [p.mesh.positions[i], p.mesh.positions[i + 1], p.mesh.positions[i + 2]]);
            for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
          }
        }
        for (let k = 0; k < 3; k++) { total.min[k] = Math.min(total.min[k], min[k]); total.max[k] = Math.max(total.max[k], max[k]); }
        bbox = { min: min.map(r6), max: max.map(r6) };
      }
      const rec: BuiltComponent = {
        id, kind: isSurface ? "surface" : "component", group, parent: n.parent ?? null, label: n.label ?? id, tags: n.tags ?? [], assembly: !!n.assembly,
        class: null, class_counts: {}, params: [], triangles: tris, primitives: parts.length, materials: parts.map((p) => p.material), bbox, origin: originOf(W),
      };
      (isSurface ? surfaces : components).push(rec);
    } catch (e: any) { errors.push(`${id}: ${e.message}`); }
  }

  // parameter provenance per component (after all nodes: surfaces add to their parent's readers)
  for (const rec of [...components, ...surfaces]) {
    const keys = [...(params.usage.get(ownerOf(rec.id)) ?? [])].sort();
    rec.params = keys; rec.class_counts = params.classCounts(keys); rec.class = params.weakestClass(keys) as ParamClass | null;
    const node = out.get(rec.id);
    if (node) node.extras = { id: rec.id, kind: rec.kind, group: rec.group, class: rec.class, label: rec.label, ...(rec.assembly ? { assembly: true } : {}) };
  }
  const rootId = Object.keys(spec.nodes).find((id) => !spec.nodes[id].parent)!;
  const root = out.get(rootId)!;
  // glTF is Y-up: convert once, here. x_gltf = x, y_gltf = z, z_gltf = -y.
  root.rotation = quatMul([-Math.SQRT1_2, 0, 0, Math.SQRT1_2], root.rotation);
  return { root, components, surfaces, joints, datums, omitted, missing, notBuilt, errors, bbox: { min: total.min.map(r6), max: total.max.map(r6) } };
}

export type { Mesh, Part };
