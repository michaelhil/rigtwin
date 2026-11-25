// Plug-in point for run-time motion layers, as in the lab (work/avatar-lab/viewer/src/plugins.ts). A plug-in is called once per
// person per frame: `frame` AFTER the dof pose has been written to the joints and BEFORE the manifest's drivers (so twist
// joints and corrective morphs follow what it did); `late` after the drivers with world matrices current (the eyes, which
// must follow the final head pose). In the product the plug-ins are the seated operator (avatar.ts), the eyes and the cloth
// pose; they are listed by avatar.ts, not registered globally.
import * as THREE from "three";

/** The parts of three the plug-ins use, handed over in the context. Not the whole namespace: a namespace passed as a value keeps
 *  the bundler from leaving anything of three out, which put 156 kB more into the script the page loads before it is ready. */
export const T3 = { Vector2: THREE.Vector2, Vector3: THREE.Vector3, Quaternion: THREE.Quaternion, MathUtils: THREE.MathUtils, NoColorSpace: THREE.NoColorSpace, RepeatWrapping: THREE.RepeatWrapping };

export interface FrameContext {
  THREE: typeof T3;
  dt: number;                                   // seconds since the last frame (0 for a still)
  manifest: any;                                // the package's manifest (FORMAT.md)
  bones: Map<string, THREE.Bone>;               // joints by name
  rootBone: THREE.Bone; root: THREE.Object3D;   // skeleton root joint; the package's scene root
  restQ: Map<string, THREE.Quaternion>;         // rest local rotation of every joint
  restWorldP: Map<string, THREE.Vector3>;       // rest position of every joint for the CURRENT body shape (package frame)
  restWorldP0: Map<string, THREE.Vector3>;      // the same for the package's base shape (as in the GLB)
  dofValues: Record<string, number>;            // degrees
  mode: "pose" | "clip"; clip: string; time: number; legScale: number;
  seated: boolean;                              // the person is seated (the operator layer is on)
  anchor(name: string): THREE.Vector3 | null;   // world position of a manifest anchor or joint
  load(url: string): Promise<THREE.Texture>;    // a side texture of the package (PNG, JPEG or KTX2), relative to the manifest
  state: Record<string, any>;                   // this plug-in's own settings
}
export interface Plugin {
  name: string;
  init?(ctx: FrameContext): void | Promise<void>;
  frame(ctx: FrameContext): void;
  late?(ctx: FrameContext): void;
  ownsPose?(ctx: FrameContext): boolean;
  state?: Record<string, any>;
}
