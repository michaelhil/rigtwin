// Camera coordinates for sharing a local view. Orbit positions use the renderer's Y-up frame.
import type { RoomPoint } from "../../shared/room.ts";
export interface PlanCamera {
  center: [number, number];
  zoom: number;
}
export interface OrbitCamera {
  position: RoomPoint;
  target: RoomPoint;
  zoom: number;
  halfWidth: number;
  halfHeight: number;
}
export type CameraPreset = "overview" | "front" | "back" | "left" | "right" | "top";
export interface RoomViewLink {
  mode: "plan" | "3d";
  focused?: string;
  labels?: boolean;
  selected: string | null;
  member: string | null;
  plan?: PlanCamera;
  orbit?: OrbitCamera;
  eye?: boolean;
  look?: { yaw: number; pitch: number; fov: number };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bounded = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const vector = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => bounded(x, -1e8, 1e8));
export function readRoomViewLink(hash: string): RoomViewLink | null {
  const raw = new URLSearchParams(hash.slice(1)).get("view");
  if (!raw || raw.length > 2400) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!record(v) || !(v.mode === "3d" || v.mode === "plan")) return null;
    const identifier = (x: unknown) => x === null || (typeof x === "string" && x.length <= 128);
    if (
      v.focused !== undefined &&
      (typeof v.focused !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v.focused) || v.mode !== "3d")
    )
      return null;
    if (v.labels !== undefined && typeof v.labels !== "boolean") return null;
    if (!identifier(v.selected) || !identifier(v.member)) return null;
    if (v.plan !== undefined && (!record(v.plan) || !vector(v.plan.center, 2) || !bounded(v.plan.zoom, 0.35, 7)))
      return null;
    if (
      v.orbit !== undefined &&
      (!record(v.orbit) ||
        !vector(v.orbit.position, 3) ||
        !vector(v.orbit.target, 3) ||
        !bounded(v.orbit.zoom, 0.1, 30) ||
        !bounded(v.orbit.halfWidth, 1e-6, 1e8) ||
        !bounded(v.orbit.halfHeight, 1e-6, 1e8))
    )
      return null;
    if (v.eye !== undefined && typeof v.eye !== "boolean") return null;
    if (
      v.look !== undefined &&
      (!record(v.look) ||
        !bounded(v.look.yaw, -Math.PI, Math.PI) ||
        !bounded(v.look.pitch, -Math.PI, Math.PI) ||
        !bounded(v.look.fov, 22, 95))
    )
      return null;
    return v as unknown as RoomViewLink;
  } catch {
    return null;
  }
}
