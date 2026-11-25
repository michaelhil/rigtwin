// Only rig IDs travel in the scene. The rig binding works out the points at the current adjustment.
export type HandAim = { mode: "rest" } | { mode: "point" | "touch"; target: string };
export type FootAim = { mode: "floor" } | { mode: "on"; target: string };
export interface PersonAims {
  look?: string;
  left_hand?: HandAim;
  right_hand?: HandAim;
  left_foot?: FootAim;
  right_foot?: FootAim;
}

export const AIM_LIMBS = ["left_hand", "right_hand", "left_foot", "right_foot"] as const;
