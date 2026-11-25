// The interface between the person module (MV-core: index.ts, avatar.ts) and the rig binding (MV-rig: rig-binding.ts),
// agreed through the coordinator on 2026-11-25. The person module calls rigBinding(person, rig) after the person loads, after
// every change of body shape and after every change of the rig's joints, and solves the seated pose again afterwards.
//
// Frames: the package frame is the person's (metres, +Y up, +Z the way the figure faces, +X the figure's left, soles on
// y = 0). The rig's MODEL frame is the rig's (metres, Z up, X forward, Y the operator's left); `place` puts the package frame
// into it.
import type * as THREE from "three";
import type { Operator, Targets, ContactPlane, V3 } from "./operator.ts";
import type { Manifest } from "../../../shared/manifest.ts";

export interface PersonView {
  manifest: any;                                 // the package's manifest
  op: Operator;                                  // the seated-operator solver, its rest built for the current shape; op.fit set when the body is a baked person
  restWorldP: Map<string, THREE.Vector3>;        // rest joint positions for the current shape, package frame
  measures: Record<string, number>;              // shape.measures read-back of the current shape, mm (eyeheightsitting, buttockkneelength, poplitealheight, ...)
  controls: Record<string, number>;              // the survey controls of the current shape
}
export interface RigView {
  manifest: Manifest;                            // the rig's description file
  neutralFrame(id: string): ReturnType<RigView["frame"]>;
  point(id: string): number[] | null;            // current world position of a D_ / S_ / C_ node, rig MODEL frame, joints as posed
  frame(id: string): { origin: number[]; x: number[]; y: number[]; z: number[] } | null;   // the same with its axes (model frame)
}
export interface RigBinding {
  place: { origin: V3; yawDeg: number };   // the package frame's origin in the rig MODEL frame (on the deck top below the hip), and its turn about model Z (0 = facing model +X; the seat swivel)
  targets: Partial<Targets>;                     // merged over defaultTargets(op), package frame
  contactPlanes: ContactPlane[];                 // seat (with the real cushion as `pan`) and backrest, package frame
  stickLean?: { l: [number, number]; r: [number, number] };   // the real grips' lean, degrees, in the sense of Controls.stick: added to the scripted deflection before each solve
  report?: Record<string, unknown>;              // findings (seat depth against the knee crease, mount clearance, pedals)
}
export type RigBindingFn = (person: PersonView, rig: RigView) => RigBinding;
