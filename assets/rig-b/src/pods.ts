// Pods group: both armrest pods, joysticks, plate controls, touchscreen and its arm.
// Geometry is written once for the LEFT pod (+Y is the outer side) and mirrored for the right.
// The pod frame is pitched with the plate: X runs forward along the plate, Z is the plate normal.
// Shape lists in params/pods.toml are in LEVEL coordinates (x forward horizontal, z up, same
// origin); `frames()` turns them into the pod frame.
import type { Ctx, GroupModule } from "../../../generator/assemble.ts";
import type { Mesh, Part } from "../../../generator/kit.ts";
import type { Vec2, Vec3 } from "../../../generator/math.ts";
import { arc, superRing, pleats, pillow, domeProfile, leanY } from "./lib/pods-shapes.ts";

/** Mirror left-authored parts for the right pod. */
const sided = (c: Ctx, parts: Part[]): Part[] => (c.side === "R" ? c.kit.mapParts(parts, c.kit.mirrorY) : parts);

/** Level coordinates -> pod frame. */
const frames = (c: Ctx) => {
  const t = c.p("pods.plate_tilt"), cs = Math.cos(t), sn = Math.sin(t);
  return {
    /** a level (x, y) lying on the plate plane -> pod-frame (x, y) */
    onPlate: (p: number[]): Vec2 => [p[0] / cs, p[1]],
    /** a level point -> pod frame */
    toPod: (x: number, y: number, z: number): Vec3 => [x * cs - z * sn, y, x * sn + z * cs],
  };
};

/** Cup recess: centre on the plate plane (pod frame). */
const cupCentre = (c: Ctx): Vec2 => frames(c).onPlate(c.arr("pods.cup_centre"));

// White moulded shell. Two solids: the upright rim band under the plates (with the keyhole-shaped
// cup recess), and ONE faceted cage for everything below it: the tray's underside, the leg that
// drops from it and the flat blade that runs back to beside the recline hub. The top of the cage is
// buried in the band; its top face is the floor of the cup.
const shell = (c: Ctx) => {
  const k = c.kit, F = frames(c), tp = c.p("pods.plate_thickness"), rim = c.p("pods.tray_rim_height"), bev = c.p("pods.shell_bevel");
  const front = (c.arr("pods.tray_outline_front") as number[][]).map(F.onPlate), rear = (c.arr("pods.tray_outline_rear") as number[][]).map(F.onPlate);
  const cup = cupCentre(c), rc = c.p("pods.cup_radius"), hw = c.p("pods.cup_slot_halfwidth");

  // rim band: tray outline with the cup recess cut in from the outer edge
  const D = front[front.length - 1], E = rear[0];
  const edgeY = (x: number) => D[1] + ((E[1] - D[1]) * (x - D[0])) / (E[0] - D[0]);
  const a = Math.acos(hw / rc);
  const keyhole: Vec2[] = [[cup[0] + hw, edgeY(cup[0] + hw)], ...arc(cup, rc, a, -Math.PI - a, 20), [cup[0] - hw, edgeY(cup[0] - hw)]];
  const band = k.translate(k.extrude([...front, ...keyhole, ...rear], rim, { bevelTop: c.p("pods.plate_bevel"), bevelBottom: 0 }), [0, 0, -tp - rim]);

  // --- cage, tray part: top ring (tray outline) and the underside stations front to rear
  const zt = -tp - rim + bev + bev / 4, yin = front[0][1];

  // spout: the slot in the band is filled up to a ramp that rises from the cup floor (the cage top, zt)
  // to a lip below the band top, so the tray edge stays whole under a shallow channel. Sharp edges: its
  // outer face lies flush in the band's outer face.
  const yc = cup[1] + Math.sqrt(rc * rc - hw * hw), zLip = -tp - c.p("pods.cup_spout_depth"), zb = -tp - rim, xa = cup[0] - hw, xb = cup[0] + hw;
  const spout = k.prism([[xa, yc, zt], [xb, yc, zt], [xb, edgeY(xb), zLip], [xa, edgeY(xa), zLip]], [[xa, yc, zb], [xb, yc, zb], [xb, edgeY(xb), zb], [xa, edgeY(xa), zb]]);
  const [A, B1, B2, C1, C2] = front, G = rear[rear.length - 1], Fp = rear[1];
  const st = c.arr("pods.tray_keel") as number[][], n = st.length - 1;
  const mx = st[1][0] / Math.cos(c.p("pods.plate_tilt")), M: Vec2 = [mx, C2[1] + ((D[1] - C2[1]) * (mx - C2[0])) / (D[0] - C2[0])];
  const points: Record<string, Vec3> = {};
  for (const [name, p] of Object.entries({ A, B1, B2, C1, C2, M, D, E, F: Fp, G })) points[name] = [p[0], p[1], zt];
  st.forEach(([x, z, yo], i) => { points["i" + i] = F.toPod(x, yin, z); points["o" + i] = F.toPod(x, yo, z); });
  const faces: string[][] = [
    ["A", "B1", "B2", "C1", "C2", "M", "D", "E", "F", "G"],
    ["A", ...st.map((_, i) => "i" + (n - i)), "B1"],
    ["B1", "i0", "B2"], ["B2", "i0", "o0", "C1"], ["C1", "o0", "C2"],
    // E-o2-o3-F is not planar; as one face its pulled-back corner at F stood out of the band as a loose
    // flap, so it is two triangles
    ["C2", "o0", "o1", "M"], ["M", "o1", "o2", "D"], ["D", "o2", "E"], ["E", "o2", "F"], ["F", "o2", "o3"], ["F", "o3", "o" + n, "G"],
    ["G", "o" + n, "i" + n, "A"],
  ];
  // underside. Between stations 1 and 2 the leg takes its place, except for a narrow strip along the
  // inner edge (the leg's inner face stands a little outside the tray's); j1 and j2 are the inner
  // corners of the leg's top on the station lines.
  const yi = c.p("pods.blade_inner_y");
  points.j1 = F.toPod(st[1][0], yi, st[1][1]); points.j2 = F.toPod(st[2][0], yi, st[2][1]);
  for (let i = 0; i < n; i++) {
    if (i === 1) faces.push(["i1", "i2", "j2", "j1"]);
    else faces.push(["i" + i, "i" + (i + 1), ...(i === 0 ? ["j1"] : []), "o" + (i + 1), "o" + i, ...(i === 2 ? ["j2"] : [])]);
  }

  // --- cage, leg and blade. Their inner faces share one plane. The blade's outer face is a
  // flat plane; the leg's outer face is a second plane that leaves the blade plane at the foot of the
  // leg and leans outward to the tray; the triangle between them is the diagonal crease facet.
  const blade = c.arr("pods.blade_outline") as number[][], legFront = c.arr("pods.leg_front") as number[][], [rx, rz] = c.arr("pods.leg_rear_top") as number[];
  const yb = c.p("pods.blade_outer_y"), foot = blade[blade.length - 1], slope = (st[1][2] - yb) / (st[1][1] - foot[1]);
  const yLeg = (z: number) => yb + slope * (z - foot[1]);
  const bi = blade.map((_, j) => "bi" + j), bo = blade.map((_, j) => "bo" + j), fi = legFront.map((_, j) => "fi" + j), fo = legFront.map((_, j) => "fo" + j);
  blade.forEach(([x, z], j) => { points[bi[j]] = F.toPod(x, yi, z); points[bo[j]] = F.toPod(x, yb, z); });
  legFront.forEach(([x, z], j) => { points[fi[j]] = F.toPod(x, yi, z); points[fo[j]] = F.toPod(x, yLeg(z), z); });
  points.Ri = F.toPod(rx, yi, rz); points.Rb = F.toPod(rx, yb, rz); points.Q = F.toPod(c.p("pods.leg_crease_top_x"), yLeg(rz), rz);
  const last = blade.length - 1, lf = legFront.length - 1;
  faces.push(["j1", "j2", "Ri", ...bi, ...fi]);                                    // inner face of leg and blade
  faces.push(["bi0", "Ri", "Rb", "bo0"]);                                            // rear face of the leg above the blade
  for (let j = 0; j < last; j++) faces.push([bi[j + 1], bi[j], bo[j], bo[j + 1]]);   // blade edge: top, round end, bottom
  faces.push(["fi0", bi[last], bo[last], "fo0"]);                                    // foot
  for (let j = 0; j < lf; j++) faces.push([fi[j + 1], fi[j], fo[j], fo[j + 1]]);     // leg front, sweeping back to the foot
  faces.push(["j1", fi[lf], fo[lf], "o1"]);                                          // sweep from the leg front into the tray underside
  faces.push([...bo].reverse());                                                     // flat outer face of the blade
  faces.push([bo[last], "bo0", "Rb", "Q"]);                                          // crease facet
  faces.push([bo[last], "Q", "o2", "o1", ...[...fo].reverse()]);                     // outer face of the leg
  faces.push(["Ri", "j2", "o2"], ["Ri", "o2", "Rb"], ["Q", "Rb", "o2"]);             // sweep from the leg rear into the tray underside
  const body = k.cage({ points, faces, bevel: bev });

  return sided(c, [k.part("shell_white", band, spout, body)]);
};

// Black plates; the top of the control plate is z = 0 of the pod frame. Control plate with the
// half-round cup notch, the rear plate the armrest pad slides on, and the small fixed things that
// are not components of their own (blank plug on the left; cover plate and arm hanger on the right).
const plate = (c: Ctx) => {
  const k = c.kit, F = frames(c), tp = c.p("pods.plate_thickness"), bev = c.p("pods.plate_bevel");
  const cup = cupCentre(c), rn = c.p("pods.cup_notch_radius"), [a0, a1] = c.arr("pods.cup_notch_angles") as number[], [s0, s1] = c.arr("pods.slide_notch_angles") as number[];
  const control = k.translate(k.extrude([...(c.arr("pods.plate_outline") as number[][]).map(F.onPlate), ...arc(cup, rn, a0, a1, 14)], tp, { bevelTop: bev }), [0, 0, -tp]);
  const ts = c.p("pods.slide_plate_thickness");
  const slide = k.translate(k.extrude([...(c.arr("pods.slide_plate_front") as number[][]).map(F.onPlate), ...arc(cup, rn, s0, s1, 9), ...(c.arr("pods.slide_plate_rear") as number[][]).map(F.onPlate)], ts, { bevelTop: bev }), [0, 0, -tp]);
  const parts = sided(c, [k.part("plastic_black", control, slide)]);
  if (c.side === "L") {
    const [px, py] = c.arr("pods.plug_xy_L") as number[], [pr, ph] = c.arr("pods.plug_size") as number[];
    parts.push(k.part("plastic_black", k.translate(k.revolve(domeProfile(pr, ph), { segments: 12 }), [px, py, 0])));
  } else {
    const [cx, cy] = c.arr("pods.cover_xy_R") as number[], [cl, cw, ct] = c.arr("pods.cover_size") as number[];
    const cover = k.translate(k.box(cl, cw, ct, { bevel: ct / 3 }), [cx, cy, 0]);
    // hanger tab tucked under the tray nose, stud and the lower ball of the touchscreen arm
    const [bx, by] = c.arr("pods.ts_base_xy") as number[], bz = c.p("pods.ts_base_height"), rb = c.p("pods.ts_ball_radius"), [gl, gw, gt] = c.arr("pods.ts_bracket") as number[], gs = c.p("pods.ts_base_stud");
    const zb = bz - rb - gs;
    const tab = k.translate(k.box(gl, gw, gt, { bevel: gt / 4 }), [bx + gw / 2 - gl / 2, by, zb - gt]);
    const stud = k.translate(k.cylinder(rb / 2, gs + rb / 2, { segments: 10 }), [bx, by, zb]);
    const ball = k.translate(k.sphere(rb, { segments: 14 }), [bx, by, bz]);
    parts.push(k.part("plastic_black", cover, tab, stud, ball));
  }
  return parts;
};

// Frame: top centre of the pad. Upholstered pad on its base board; the outer side tapers toward the rear.
const armrest = (c: Ctx) => {
  const k = c.kit, [pl, pw] = c.arr("pods.pad_size") as number[], h = c.p("pods.pad_height"), taper = c.p("pods.pad_taper");
  const mesh = pillow(k, k.roundedRectOutline(pl, pw, c.p("pods.pad_corner_radius"), 7), {
    height: h, edge: c.p("pods.pad_edge_radius"), base: c.arr("pods.pad_base") as [number, number], crown: c.p("pods.pad_crown"),
    warp: (p) => [p[0], -pw / 2 + (p[1] + pw / 2) * (1 - (taper * (pl / 2 - p[0])) / pl), p[2]],
  });
  return sided(c, [k.part("leather_black", k.translate(mesh, [0, 0, -h]))]);
};

/** The pleated rubber boot, shared by base and lever: heights above the mounting plane. */
const boot = (c: Ctx) => {
  const [h1, h2] = c.arr("pods.joy_plinth") as number[], d = c.p("joystick.bellows_diameter"), [sb, st] = c.arr("pods.bellows_scale") as number[];
  return { h1, h2, rb: (d * sb) / 2, rt: (d * st) / 2, z0: h2 - h1 / 5, z1: c.p("pods.bellows_top"), count: c.p("pods.bellows_ribs"), fixed: c.p("pods.bellows_fixed"), depth: c.p("pods.bellows_fold_depth"), segments: 20 };
};

// Frame: mounting plane (plate top) on the joystick axis. Moulded square base rising into a round
// shoulder, and the LOWER pleats of the rubber boot with a taut inner sleeve above them. The upper
// pleats belong to the lever, so the boot opens and closes at mid height when the lever moves.
const joyBase = (c: Ctx) => {
  const k = c.kit, f = c.p("joystick.flange_size") / 2, B = boot(c), [p1, p2] = c.arr("pods.joy_plinth_power") as number[], N = 24;
  const at = (a: number, pw: number, z: number): Vec3[] => superRing(a, a, pw, N).map((p) => [p[0], p[1], z]);
  const b = B.h1 / 5;
  const plinth = k.loft([at(f - b, p1, 0), at(f, p1, b), at(f, p1, B.h1 - b), at(f - b, p1, B.h1), at((f + B.rb) / 2, p2, (B.h1 + B.h2) / 2), at(B.rb, 2, B.h2)]);
  const lower = k.revolve(pleats(B.rb, B.rt, B.z0, B.z1, B.count, B.depth, 0, B.fixed, c.arr("pods.bellows_sleeve") as Vec2), { segments: B.segments, crease: 60 });
  return k.part("rubber_black", plinth, lower);
};

// Frame: lever pivot, Z along the lever. Upper pleats of the boot (rubber), collar on top of them,
// neck, handle bending forward, broad head with a button face. The left grip carries two rockers and two buttons, the right grip a
// thumb stick and four buttons; both have a small knob on the inner side.
const joyLever = (c: Ctx) => {
  const k = c.kit, top = c.p("joystick.grip_top_height"), pivot = c.p("pods.joy_pivot_height"), N = 24, B = boot(c);
  const rows = c.arr("pods.grip_sections") as number[][], pitch = c.arr("pods.grip_section_pitch") as number[], pw = c.arr("pods.grip_section_power") as number[];
  const body = k.loft(rows.map(([fz, xo, a, b], i) => k.ring(superRing(a, b, pw[i], N), [xo, 0, fz * top - pivot], { rpy: [0, pitch[i], 0] })));

  // button face: built flat (x = up the face, y = across, z = out of the face), then leaned back
  const [fw, fh, ft] = c.arr("pods.grip_face") as number[], [fx, fz] = c.arr("pods.grip_face_pos") as number[], tilt = c.p("pods.grip_face_tilt");
  const [br, bp] = c.arr("pods.grip_button") as number[], flip = c.side === "R" ? -1 : 1; // lists give "across" as seen in place; the right grip is mirrored afterwards
  const face: Mesh[] = [k.translate(k.roundedBox(fh, fw, ft, fw / 4, { bevelTop: ft / 3, segments: 3 }), [0, 0, -ft])];
  const button = (across: number, up: number) => face.push(k.translate(k.cylinder(br, bp, { segments: 12, bevel: bp / 3 }), [up, across * flip, 0]));
  if (c.side === "R") {
    for (const [ax, up] of c.arr("pods.grip_buttons_R") as number[][]) button(ax, up);
    const [sx, su, sr, sp] = c.arr("pods.grip_stick_R") as number[];
    face.push(k.translate(k.cylinder(sr / 2, sp, { segments: 8 }), [su, sx * flip, 0]), k.translate(k.sphere(sr, { segments: 10 }), [su, sx * flip, sp]));
  } else {
    for (const [ax, up] of c.arr("pods.grip_buttons_L") as number[][]) button(ax, up);
    const [rw, rh, rp] = c.arr("pods.grip_rocker_size") as number[];
    for (const [ax, up] of c.arr("pods.grip_rockers_L") as number[][]) face.push(k.translate(k.box(rh, rw, rp, { bevel: rp / 3 }), [up, ax * flip, 0]));
  }
  const facePlaced = k.translate(k.rotate(k.merge(face), [0, 1, 0], tilt - Math.PI / 2), [fx, 0, fz - pivot]);

  // knob on the inner side of the head (left grip: -Y)
  const [kr, kp, kh] = c.arr("pods.grip_side_button") as number[], f = kh / top;
  let j = rows.findIndex((r) => r[0] >= f);
  if (j < 1) j = rows.length - 1;
  const u = (f - rows[j - 1][0]) / (rows[j][0] - rows[j - 1][0]), mix = (i: number) => rows[j - 1][i] + (rows[j][i] - rows[j - 1][i]) * u;
  const knob = k.translate(k.rotate(k.cylinder(kr, kp + kr, { segments: 10, bevel: kr / 3 }), [1, 0, 0], Math.PI / 2), [mix(1), -mix(3) + kr, kh - pivot]);

  // turned toward the operator, then cranked inward above the skirt
  const turned = k.rotate(k.merge(body, facePlaced, knob), [0, 0, 1], c.p("pods.grip_yaw"));
  const upper = k.translate(k.revolve(pleats(B.rb, B.rt, B.z0, B.z1, B.count, B.depth, B.fixed, B.count), { segments: B.segments, crease: 60 }), [0, 0, -pivot]);
  return sided(c, [k.part("plastic_black", leanY(k, turned, c.p("pods.grip_lean_from") - pivot, Math.tan(c.p("pods.grip_lean_in")))), k.part("rubber_black", upper)]);
};

// Black barrel, bright lock face, key standing in it.
const keyswitch = (c: Ctx) => {
  const k = c.kit, [rb, hb] = c.arr("pods.keyswitch_body") as number[], [rl, hl] = c.arr("pods.keyswitch_lock") as number[], [kt, kw, kh] = c.arr("pods.keyswitch_key") as number[];
  return [
    k.part("plastic_black", k.cylinder(rb, hb, { segments: 18, bevel: rb / 6 }), k.translate(k.box(kt, kw, kh, { bevel: kt / 4 }), [0, 0, hb + hl])),
    k.part("metal_bright", k.translate(k.cylinder(rl, hl, { segments: 14, bevel: hl / 4 }), [0, 0, hb])),
  ];
};

// Ring-lit push button: matte black bezel and cap with a sunk channel, and the lit ring lying in it.
// The ring is a second material: without it the buttons disappear on the black plate in the operator's view.
const ringButton = (c: Ctx) => {
  const k = c.kit, [R, h] = c.arr("pods.button_bezel") as number[], [ri, ro] = c.arr("pods.button_ring") as number[];
  const bezel = k.revolve([[0, 0], [R, 0], [R - h / 2, h], [ro, h], [ro, h / 3], [ri, h / 3], [ri, h], [0, h]], { segments: 12 });
  const ring = k.revolve([[ro, h / 3], [ro, (h * 2) / 3], [ri, (h * 2) / 3], [ri, h / 3], [ro, h / 3]], { segments: 12 });
  return [k.part("plastic_black", bezel), k.part("shell_white", ring)];
};

// Blank dome plug in an unused button hole.
const plug = (c: Ctx) => {
  const k = c.kit, [r, h] = c.arr("pods.plug_size") as number[];
  return k.part("plastic_black", k.revolve(domeProfile(r, h), { segments: 12 }));
};

export const components: GroupModule["components"] = {
  C_pod_shell_L: shell, C_pod_shell_R: shell,
  C_pod_plate_L: plate, C_pod_plate_R: plate,
  C_pod_armrest_L: armrest, C_pod_armrest_R: armrest,
  C_joy_base_L: joyBase, C_joy_base_R: joyBase,
  C_joy_lever_L: joyLever, C_joy_lever_R: joyLever,
  C_pod_keyswitch_L: keyswitch,

  // Yellow collar, red mushroom head. Frame: on the plate; the top of the head is at estop_height.
  C_pod_estop_R: (c) => {
    const k = c.kit, H = c.p("pods.estop_height"), rh = c.p("pods.estop_head_radius"), [rf, rn, hc] = c.arr("pods.estop_collar") as number[];
    const collar = k.revolve([[0, 0], [rf, 0], [rf, hc / 4], [rn, hc / 2], [rn, hc], [0, hc]], { segments: 16 });
    const g = (H - hc) / 8;
    const head = k.revolve([[0, hc], [rn / 2, hc], [rn / 2, hc + g], [rh, hc + g], [rh, H - g], [rh - g, H], [0, H]], { segments: 16 });
    return [k.part("estop_yellow", collar), k.part("estop_red", head)];
  },

  // Frame: lower ball centre, Z along the arm. Double-socket arm: a socket cup at each end that leaves
  // its ball showing, a flat-sided waist between them, a clamp handle on the side. The balls
  // themselves belong to the pod (lower) and to the screen (upper).
  C_ts_arm: (c) => {
    const k = c.kit, L = c.p("pods.ts_arm_length"), [re, ls, ww, wd] = c.arr("pods.ts_arm_body") as number[], [ks, kl, kh] = c.arr("pods.ts_arm_knob") as number[];
    const z0 = -ls / 6, cup: Vec2[] = [[0, z0], [(re * 5) / 6, z0], [re, z0 + ls / 4], [re, z0 + (ls * 2) / 3], [(re * 2) / 3, z0 + ls], [0, z0 + ls]];
    const lower = k.revolve(cup, { segments: 14 }), upper = k.revolve(cup.map(([r, z]) => [r, L - z] as Vec2).reverse(), { segments: 14 });
    const waist = k.translate(k.box(wd, ww, L - ls, { bevel: wd / 5 }), [0, 0, ls / 2]);
    const stem = k.tubePath([[0, 0, L / 2], [0, -kl, L / 2]], ks, { segments: 8 });
    const handle = k.tubePath([[-kh / 2, -kl, L / 2], [kh / 2, -kl, L / 2]], ks, { segments: 8 });
    return k.part("plastic_black", lower, upper, waist, stem, handle);
  },

  // Frame: upper ball centre; screen face toward -X, width along Y, height along Z.
  // Flat glass front slab, stepped-in rear housing, round mount plate, stud and ball.
  C_ts_screen: (c) => {
    const k = c.kit, d = c.p("touchscreen.depth"), W = c.p("touchscreen.outer_width"), H = c.p("touchscreen.outer_height");
    const so = c.p("pods.ts_ball_standoff"), drop = c.p("pods.ts_mount_drop"), gd = c.p("pods.ts_glass_depth"), inset = c.p("pods.ts_rear_inset"), rc = c.p("pods.ts_corner_radius");
    const up = (m: Mesh) => k.rotate(m, [0, 1, 0], -Math.PI / 2); // slab lying in XY -> standing in YZ, its top face toward -X
    const glass = k.translate(up(k.roundedBox(H, W, gd, rc, { bevelTop: c.p("pods.ts_bevel"), bevelBottom: 0, segments: 4 })), [-so - d + gd, 0, drop]);
    const rear = k.translate(up(k.roundedBox(H - 2 * inset, W - 2 * inset, d - gd, rc, { bevelBottom: (d - gd) / 3, bevelTop: 0, segments: 4 })), [-so, 0, drop]);
    const [rm, tm] = c.arr("pods.ts_mount_plate") as number[], rb = c.p("pods.ts_ball_radius");
    const mount = k.translate(k.rotate(k.cylinder(rm, tm, { segments: 24, bevel: tm / 3 }), [0, 1, 0], Math.PI / 2), [-so, 0, 0]);
    const stud = k.tubePath([[-so + tm, 0, 0], [-rb / 2, 0, 0]], rb / 2, { segments: 10 });
    return [k.part("glass_black", glass), k.part("plastic_black", rear, mount, stud, k.sphere(rb, { segments: 14 }))];
  },
  // Frame: centre of the screen face.
  S_ts_screen: (c) => {
    const k = c.kit;
    return k.part("screen_touch", k.translate(k.sheet(c.p("touchscreen.active_width"), c.p("touchscreen.active_height")), [-c.p("touchscreen.surface_lift"), 0, 0]));
  },
};
for (const n of [1, 2, 3, 4]) components[`C_pod_button_L_${n}`] = ringButton;
for (const n of [1, 2]) components[`C_pod_button_R_${n}`] = ringButton;
components.C_pod_button_R_3 = plug;
