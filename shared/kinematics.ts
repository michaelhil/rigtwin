// Read the node tree of a rigtwin GLB and pose it with joint values, giving the world frame (model frame:
// metres, Z up) of every node. Posing goes through shared/pose.ts, the single definition. Used in Bun by the
// command measure.distance (shared/commands/core.ts) on the server; the viewer gets the same frames from its
// own three.js scene.
import { composeTrs, poseFromRest, type JointKinematics, type JointValue, type Trs } from "./pose.ts";
import type { Quat, Vec3 } from "./math.ts";

export interface KNode { name: string; parent: number; t: Vec3; q: Quat; joint?: JointKinematics & { locked: boolean } }

/** Node tree of a rigtwin GLB, parents before children. The root's own rotation (the glTF Y-up conversion) is
 *  dropped so that every frame is in the model frame, as the manifest's are. Translations and rotations are
 *  the stored JSON numbers (rounded to 1e-6 and 1e-7); quaternions are normalised on reading. */
export function nodesFromGlb(bytes: Uint8Array): KNode[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB file");
  const jsonLen = dv.getUint32(12, true), gl = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const out: KNode[] = [];
  const visit = (i: number, parent: number, isRoot: boolean) => {
    const n = gl.nodes[i], j = n.extras?.joint, q = (isRoot ? [0, 0, 0, 1] : (n.rotation ?? [0, 0, 0, 1])) as number[];
    const l = Math.hypot(q[0], q[1], q[2], q[3]), me = out.length;
    out.push({
      name: n.name, parent, t: (isRoot ? [0, 0, 0] : (n.translation ?? [0, 0, 0])) as Vec3, q: [q[0] / l, q[1] / l, q[2] / l, q[3] / l],
      ...(j ? { joint: { type: j.type, axis: j.axis, lower: j.lower, upper: j.upper, neutral: j.neutral, locked: j.locked } } : {}),
    });
    for (const c of n.children ?? []) visit(c, me, false);
  };
  visit(gl.scenes[0].nodes[0], -1, true);
  return out;
}

/** World frame of every node for the given joint values (others at neutral). */
export function worldFrames(nodes: KNode[], values: Record<string, JointValue> = {}): Record<string, Trs> {
  const world: Record<string, Trs> = {}, list: Trs[] = [];
  for (const [i, n] of nodes.entries()) {
    const rest: Trs = { t: n.t, q: n.q };
    const local = n.joint && values[n.name] !== undefined ? poseFromRest(rest, n.joint, values[n.name]) : rest;
    list[i] = n.parent < 0 ? local : composeTrs(list[n.parent], local);
    world[n.name] = list[i];
  }
  return world;
}
