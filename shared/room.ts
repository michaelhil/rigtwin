import type { OperatorOptions,OperatorPatch } from "./room-person.ts";
// The scene is Z-up. x grows east, y north, and positive yaw turns east towards north.
// Placement uses the release's declared floor anchor. Joint settings use metres/radians.
import type { ProjectTransfer } from "./project.ts";
import type { PersonState } from "./commands/doc.ts";
import type { JointValue, JointType } from "./pose.ts";

export const ROOM_SCHEMA = "synergon-room/1" as const;

export interface RoomOpening { offset: number; width: number }
export interface RoomDimensions {
  width: number; depth: number; height: number;
  door: RoomOpening;   // south wall, offset from west
  window: RoomOpening; // north wall, offset from west
}
export interface RoomInstance {
  id: string;
  label: string;
  release: string;
  x: number; y: number; yaw: number;
  pose: Record<string, JointValue>;
}
export interface RoomPerson { host: string; state: PersonState }
export interface RoomScene {
  schema: typeof ROOM_SCHEMA;
  id: string;
  name: string;
  version: number;
  room: RoomDimensions;
  instances: RoomInstance[];
  person: RoomPerson | null;
}
export interface RoomRef { instance: string; member: string }
export type RoomPoint = [number, number, number];
export interface RoomMember { id: string; label: string; controls?: string[]; kind?: "datum" | "part" | "joint" }
export interface RoomJoint {
  id: string; label?: string; type: JointType; lower: number; upper: number;
  neutral: JointValue; locked?: boolean; assumed?: boolean;
  /** Signed unit axis in the joint mount frame. Ball joints use three angles. */
  axis?: number[] | null;
}
export interface RoomRelease {
  id: string; label: string; kind: "station" | "display" | "desk";
  asset: string; version: string; digest: string; modelUrl: string; manifestUrl: string;
  anchor: RoomPoint; variant?: string; frame?: string;
  members: RoomMember[]; joints: RoomJoint[];
  footprint: { min: [number, number]; max: [number, number] }; seat?: boolean;
}
export interface RoomCatalog {
  transfer?: ProjectTransfer;
  releases: RoomRelease[];
  /** Positions in the posed asset frame measured from its declared floor anchor. */
  point(instance: RoomInstance, member: string): RoomPoint;
  jointAxesInRoom?(instance: RoomInstance, joints: RoomJoint[]): Record<string,RoomPoint>;
  configureOperator?(instance:RoomInstance, prior:PersonState, patch:OperatorPatch):PersonState;
  operatorOptions?(instance:RoomInstance, state:PersonState):OperatorOptions;
  defaultPerson?(instance: RoomInstance): PersonState;
  eye?(instance: RoomInstance, state: PersonState): RoomPoint;
}

export function roomVector(yaw:number, local:RoomPoint): RoomPoint {
  const angle=yaw*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  return [c*local[0]-s*local[1],s*local[0]+c*local[1],local[2]];
}

export function roomPoint(instance: Pick<RoomInstance, "x" | "y" | "yaw">, local: RoomPoint): RoomPoint {
  const [x,y,z]=roomVector(instance.yaw,local);
  return [instance.x+x, instance.y+y, z];
}
