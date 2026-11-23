// Stand group: two leaning tapered columns, tilted shelf, soundbar, clamped monitor arm (posed rigid
// links), curved monitor with a bulged rear shell, and its screen surface.
import type { Ctx, GroupModule } from "../../../generator/assemble.ts";
import type { Vec2, Vec3 } from "../../../generator/math.ts";
import { cornerRect, linkBar, rod, roundedSlab } from "./lib/stand-shapes.ts";

// Shelf plane and stand origin in the rig frame, from the measured edges (the spec uses the same expressions).
const layout = (c: Ctx) => {
  const tilt = c.p("stand.shelf_tilt"), near = c.p("stand.shelf_near_edge_x"), far = c.p("stand.shelf_far_edge_x"), zNear = c.p("stand.shelf_top_z_near_edge");
  return {
    tilt, near, far,
    originX: c.p("stand.column_rear_nose_x") + c.p("stand.column_depth_foot") / 2,
    topZ: (x: number) => zNear - (x - near) * Math.tan(tilt),
    depth: (far - near) / Math.cos(tilt),
    normal: [Math.sin(tilt), 0, Math.cos(tilt)] as Vec3,
  };
};
const MONITOR_SEGMENTS = 28, ARM_SIDES = 10;
// Column section corners in cornerRect's order: the two far-end corners (+x) make a half-round, the two
// operator-side corners (-x) are the tight radii either side of the flat operator face (44 points per ring as before).
const COLUMN_CORNER_SEGMENTS = [12, 12, 8, 8];

// Frame: on the deck under the foot centre. D-shaped section: flat face toward the operator with tight
// corner radii, straight sides, half-round far end. Foot on the deck, deeper head lying in the shelf's
// underside plane; the straight loft between them gives lean and taper.
const column = (c: Ctx) => {
  const k = c.kit, g = layout(c), w = c.p("stand.column_width"), [bf, bh] = c.arr("stand.column_bevel"), th = c.p("stand.shelf_thickness");
  const xh = c.p("stand.column_head_centre_x"), rn = c.p("stand.column_face_corner_radius");
  const head: Vec3 = [xh - th * g.normal[0] - g.originX, 0, g.topZ(xh) - th * g.normal[2]];
  const section = (depth: number) => cornerRect(depth, w, [w / 2, w / 2, rn, rn], COLUMN_CORNER_SEGMENTS);
  const foot = section(c.p("stand.column_depth_foot")), top = section(c.p("stand.column_depth_top"));
  const rpy: Vec3 = [0, g.tilt, 0];
  return k.part("shell_white", k.loft([
    k.ring(k.offsetOutline(foot, bf), [0, 0, 0]),
    k.ring(foot, [(head[0] / head[2]) * bf, 0, bf]),
    k.ring(top, [head[0] - bh * g.normal[0], 0, head[2] - bh * g.normal[2]], { rpy }),
    k.ring(k.offsetOutline(top, bh), head, { rpy }),
  ]));
};

export const components: GroupModule["components"] = {
  C_stand_column_L: column,
  C_stand_column_R: column,

  // Frame: centre of the shelf top surface, tilted with the shelf (+X down the slope, away from the operator).
  // D-shaped plate: small radii on the operator side, large arcs on the far corners.
  C_stand_shelf: (c) => {
    const k = c.kit, g = layout(c), t = c.p("stand.shelf_thickness"), [rf, rn] = c.arr("stand.shelf_corner_radii");
    const outline = cornerRect(g.depth, c.p("stand.shelf_length"), [rf, rf, rn, rn], [12, 12, 4, 4]);
    return k.part("shell_white", k.translate(roundedSlab(k, outline, t, c.p("stand.shelf_edge_radius"), 2), [0, 0, -t]));
  },

  // Frame: on the shelf top under the bar's front-bottom edge, tilted with the shelf; the bar extends toward +X.
  C_stand_soundbar: (c) => {
    const k = c.kit, L = c.p("soundbar.length"), D = c.p("soundbar.depth"), H = c.p("soundbar.height"), gap = c.p("soundbar.foot_gap");
    const [cap, capScale] = c.arr("soundbar.end_cap"), section = c.arr("soundbar.section") as Vec2[];
    const station = (y: number, s: number): Vec3[] => section.map(([u, v]) => [D * (0.5 + (u - 0.5) * s), y, gap + H * (0.5 + (v - 0.5) * s)]);
    const body = k.loft([station(L / 2, capScale), station(L / 2 - cap, 1), station(-L / 2 + cap, 1), station(-L / 2, capScale)]);
    const foot = (y: number) => k.translate(k.box(D / 2, 2 * cap, 2 * gap), [D / 2, y, 0]);
    return k.part("plastic_black", body, foot(L / 2 - 4 * cap), foot(-L / 2 + 4 * cap));
  },

  // Frame: on the shelf top at the post axis, axes parallel to the rig's. Edge clamp, base ring and post stand
  // square on the tilted shelf. Everything above rides the height joint (C_stand_monarm_links).
  C_stand_monarm: (c) => {
    const k = c.kit, g = layout(c), th = c.p("stand.shelf_thickness");
    const r = c.p("monarm.post_diameter") / 2, ph = c.p("stand.arm_post_height"), [bl, bw, bt, jaw] = c.arr("stand.arm_base");
    const px = c.arr("stand.arm_post_xy")[0], bev = bt / 4, edge = (g.far - px) / Math.cos(g.tilt);          // shelf far edge, along the slope from the post axis
    return k.part("shell_white", [
      k.translate(k.roundedBox(bl, bw, bt, bw / 4, { bevelTop: bev, segments: 2 }), [edge + bt - bl / 2, 0, 0]), // plate on the shelf
      k.translate(k.box(bt, bw / 2, th + 2 * bt), [edge + bt / 2, 0, -th - bt]),                                // back of the clamp
      k.translate(k.box(jaw, bw / 2, bt), [edge + bt - jaw / 2, 0, -th - bt]),                                  // jaw under the shelf
      k.cylinder(r + bt / 2, 2 * bt, { segments: ARM_SIDES, bevel: bev }),                                      // base ring
      k.cylinder(r, ph, { segments: ARM_SIDES, bevel: bev }),                                                   // post
    ].map((m) => k.rotate(m, [0, 1, 0], g.tilt)));
  },

  // Frame: on the post axis at the sliding collar, axes parallel to the rig's. Collar, lower link, elbow,
  // upper link, wrist and ball head, posed rigid so that the ball sits on the monitor pivot.
  C_stand_monarm_links: (c) => {
    const k = c.kit, g = layout(c), s = c.p("stand.arm_collar_height");
    const elbow = c.arr("stand.arm_elbow") as Vec3, [lw, lh] = c.arr("stand.arm_link_section"), jr = c.p("stand.arm_joint_radius"), hl = c.p("stand.arm_head_length");
    const [px, py] = c.arr("stand.arm_post_xy"), mc = c.arr("stand.monitor_centre"), bev = lh / 12;
    const pivot: Vec3 = [mc[0] + c.p("monitor.depth_centre") - px - s * g.normal[0], mc[1] - py, mc[2] - g.topZ(px) - s * g.normal[2]];
    const along = (d: number): Vec3 => [g.normal[0] * d, 0, g.normal[2] * d];
    const upper: Vec3 = [elbow[0], elbow[1], elbow[2] + lh], wrist: Vec3 = [pivot[0] + hl, pivot[1], pivot[2]];
    const up = (p: Vec3, a: number, b: number): [Vec3, Vec3] => [[p[0], p[1], p[2] + a], [p[0], p[1], p[2] + b]];
    const joint = { segments: ARM_SIDES, bevel: bev };
    return k.part("shell_white",
      rod(k, along(-lh / 2 - bev), along(lh / 2 + bev), jr, joint),                                             // collar on the post
      linkBar(k, [0, 0, 0], elbow, lw, lh, bev, 3),                                                             // lower link
      rod(k, ...up(elbow, -lh / 2 - bev, lh + lh / 2 + bev), jr, joint),                                        // elbow housing
      linkBar(k, upper, wrist, lw, lh, bev, 3),                                                                 // upper link
      rod(k, ...up(wrist, -lh / 2 - bev, lh / 2 + bev), (jr * 4) / 5, joint),                                   // wrist housing
      rod(k, wrist, pivot, (lh * 3) / 8, { segments: ARM_SIDES }),                                              // head neck
      k.translate(k.sphere(c.p("stand.arm_ball_radius"), { segments: ARM_SIDES }), pivot),                      // ball head on the monitor pivot
    );
  },

  // Frame: arm head pivot behind the panel centre; screen toward -X. The front face lies on a cylinder of the
  // curvature radius; the rear shell is thin at the rim and bulges toward the middle.
  C_stand_monitor: (c) => {
    const k = c.kit, R = c.p("monitor.radius"), h = c.p("monitor.outer_height"), e = c.p("monitor.depth_edge"), D = c.p("monitor.depth_shell");
    const dc = c.p("monitor.depth_centre"), b = c.p("monitor.bevel"), [rim, proud] = c.arr("monitor.rim"), [u0, u1, v0, v1] = c.arr("monitor.shell_bulge");
    const [bossR, plate, plateT] = c.arr("monitor.boss"), ball = c.p("stand.arm_ball_radius");
    const half = Math.asin(c.p("monitor.outer_width") / (2 * R));                                             // half arc angle, from the chord
    const fall = (t: number) => (t <= 0 ? 1 : t >= 1 ? 0 : (1 + Math.cos(Math.PI * t)) / 2);
    const rings: Vec3[][] = [];
    for (let i = 0; i <= MONITOR_SEGMENTS; i++) {
      const u = -1 + (2 * i) / MONITOR_SEGMENTS, a = u * half, d = e + (D - e) * fall((Math.abs(u) - u0) / (u1 - u0)), s = e + (d - e) / 3, z = h / 2;
      const section: Vec2[] = [[proud, -z + rim], [proud + rim, -z], [e - b, -z], [e, -z + b], [s, -z * v1], [d, -z * v0], [d, z * v0], [s, z * v1], [e, z - b], [e - b, z], [proud + rim, z], [proud, z - rim]];
      rings.push(section.map(([depth, zz]) => [-R + (R + depth) * Math.cos(a) - dc, (R + depth) * Math.sin(a), zz] as Vec3));
    }
    const shell = k.loft(rings);
    const zg = h / 2 - rim, gb = proud / 2;
    const glass = k.translate(k.sweepArc([[0, -zg + gb], [gb, -zg], [2 * proud, -zg], [2 * proud, zg], [gb, zg], [0, zg - gb]], R, 2 * half - (2 * rim) / R, { segments: MONITOR_SEGMENTS }), [-dc, 0, 0]);
    const back = -dc + D - b, mount = -ball - (plateT * 3) / 2;      // the mounting plate stands just clear of the arm's ball head
    const boss = k.translate(k.rotate(k.cylinder(bossR, mount - back, { segments: 28, bevel: b }), [0, 1, 0], Math.PI / 2), [back, 0, 0]);
    const vesa = k.translate(k.rotate(k.roundedBox(plate, plate, plateT, plate / 8, { segments: 3 }), [0, 1, 0], Math.PI / 2), [mount, 0, 0]);
    return [k.part("glass_black", glass), k.part("shell_white", shell, boss, vesa)];
  },

  // Frame: centre of the screen face. Active area with 0–1 UVs (u = 0 at the operator's left, v = 0 at the top).
  S_mon_screen: (c) => {
    const k = c.kit;
    return k.part("screen_main", k.arcSheet(c.p("monitor.radius"), c.p("monitor.active_arc"), c.p("monitor.active_height"), { segments: MONITOR_SEGMENTS, lift: c.p("monitor.surface_lift") }));
  },
};
