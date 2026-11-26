// The description file written next to the GLB (<asset>.manifest.json): types shared by the
// generator (writer), the viewer and the tools (readers).
import type { JointKinematics, JointValue } from "./pose.ts";

export type ParamClass = "measured" | "vendor" | "photo" | "assumed" | "invented";
export const PARAM_CLASSES: ParamClass[] = ["measured", "vendor", "photo", "assumed", "invented"];
export type ParamValue = number | ParamValue[];

export interface ParamRecord {
  key: string;
  value: ParamValue;      // SI: metres, radians
  unit: string;           // m | rad | 1
  given: ParamValue;      // as written in the parameter file
  given_unit: string;
  range?: number;         // SI
  class: ParamClass;
  basis?: string;
  tier: string;
  evidence: string;
  source: string;         // file name
  replaces?: string;      // file whose record this one replaced
}

export interface Box { min: number[]; max: number[] }

export interface ManifestComponent {
  id: string; kind: "component" | "surface"; group: string | null; parent: string | null; label: string; tags: string[]; assembly: boolean;
  class: ParamClass | null; class_counts: Record<string, number>; params: string[];
  triangles: number; primitives: number; materials: string[]; bbox: Box | null; origin: number[];
}
export interface ManifestJoint extends JointKinematics {
  id: string; node: string; parent: string; child: string; unit: "m" | "rad";
  kind: "adjustment" | "control"; evidence: "seen" | "inferred" | "assumed"; locked: boolean; signal: string | null;
  /** stored node transform (at neutral): translation and quaternion x, y, z, w in the parent frame */
  rest: { t: number[]; q: number[] };
  origin: number[];
}
export interface ManifestDatum {
  id: string; parent: string; label: string; origin: number[]; x_axis: number[]; z_axis: number[];
  /** a component's radius about this datum's z axis: [t, radius] pairs, t along z from the origin (spec `profile`), metres */
  profile?: number[][];
  /** a parameter list [from, to] along z copied beside the profile (spec `profile.hold`), metres */
  hold?: number[];
  /** how far a component stands out along this datum's z at each x: [x, height, y from, y to], counting the part between
   *  `band` [from, to] along y; the y range is where it stands within `edge` of that height (spec `surface`): a contact
   *  surface, metres */
  surface?: number[][];
  band?: number[];
  edge?: number;
}

export interface Manifest {
  schema: string; asset: string; title: string;
  conventions: Record<string, string>;
  build: { partial: boolean; only: string[] | null };
  groups: string[];
  components: ManifestComponent[];
  surfaces: ManifestComponent[];
  joints: ManifestJoint[];
  datums: ManifestDatum[];
  motion: Record<string, string[]>;
  omitted: { id: string; reason: string }[];
  missing: string[];
  not_built: string[];
  materials: Record<string, { color: number[]; metallic: number; roughness: number; note: string }>;
  parameters: Record<string, ParamRecord>;
  parameter_class_counts: Record<string, number>;
  parameters_unused: string[];
  /** Fixed frame of the orthographic views (model frame), from the spec's [stage]; absent: the viewer's default for the first asset. */
  stage?: Box;
  totals: { triangles: number; vertices: number; primitives: number; nodes: number; meshes: number; materials: number; textures: number; bbox: Box };
  glb: { file: string; bytes: number; sha256: string };
}

/** Photo-matched camera (private/evidence/cameras.json): x_cam = R · X_model + t, OpenCV axes, pixels of the upright image. */
export interface PhotoCamera { image?: string; width: number; height: number; fx: number; fy: number; cx: number; cy: number; R: number[][]; t: number[]; note?: string }
export type { JointKinematics, JointValue };
