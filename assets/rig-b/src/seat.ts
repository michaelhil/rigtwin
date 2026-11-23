// Seat group: pedestal, carrier, base tray, pan (cushion + white lower shell), hub covers,
// back shell (angular outline, rounded edges, dark rear panel), back cushion, head pad.
//
// Two frames are used. Parts that recline are authored in the BACK frame (origin on the hub axis,
// Z along the back, X toward the operator's front). Parts fixed to the seat base are authored
// relative to the hub axis with upright axes and then moved into the base frame.
//
// The white shells and the upholstery are lofts through half sections (mirrored): each section is
// a short polyline of named corners whose corners are rounded with stated radii, so large faces
// stay flat and the edges between them are real fillets. The black tray stays a faceted cage.
import type { Ctx, GroupModule } from "../../../generator/assemble.ts";
import type { Vec3 } from "../../../generator/math.ts";
import { CageBuilder, interp, interpSmooth, refine, uniqueSorted, filletPolyline, fullRing, blendSections, dropSlivers, type P2 } from "./lib/seat-shape.ts";

const EPS = Math.sqrt(Number.EPSILON);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Height of the seat base frame above the deck. */
const baseZ = (c: Ctx) => c.p("seat.pedestal_height") + c.p("seat.carrier_height");
/** Hub axis in the base frame: [x, z]. */
const hubLocal = (c: Ctx): [number, number] => { const h = c.arr("seat.hub_centre_xz") as number[]; return [h[0] - c.p("seat.pos_x"), h[1] - baseZ(c)]; };

/** The back shell: station table resolved to metres, and its rounded sections. */
function shell(c: Ctx) {
  const D = c.p("seat.back_shell_depth"), th = c.p("seat.recline_neutral");
  const wt = c.p("seat.back_top_width") / 2, ws = c.p("seat.back_width_shoulder") / 2, ww = c.p("seat.back_width_waist") / 2;
  const rows = c.arr("seat.back_shell_stations") as number[][];
  const hub = c.arr("seat.hub_centre_xz") as number[], top = rows[rows.length - 1];
  // length along the back so that the highest point of the reclined shell reaches the measured top height
  const L = (c.p("seat.back_top_z") - hub[1] - top[5] * D * Math.sin(th)) / Math.cos(th);
  const radii = [0, ...(c.arr("seat.shell_edge_radii") as number[]), 0], segs = c.p("seat.round_segments"), share = c.p("seat.round_max_share");
  const kinks = c.arr("seat.back_shell_kinks") as number[], span = c.p("seat.back_shell_kink_span"), steps = c.p("seat.back_shell_round_steps");
  const [ry, rz, rt] = c.arr("seat.back_top_rounding") as number[], zTop = 1 - rz / L;

  /** Corner points of the half section at zf as [y, x]: rear centre, rear face edge, corner crease, lip corner, front centre. */
  const corners = (zf: number) => {
    const [, a, b, cc, xr, xl, yrr, ysc, xsc] = interp(rows, zf);
    const w = a * wt + b * ws + cc * ww, xa = xr * D, xf = xl * D;
    return { w, z: zf * L, xr: xa, xl: xf, pts: [[0, xa], [yrr * w, xa], [ysc * w, xa + xsc * (xf - xa)], [w, xf], [0, xf]] as P2[] };
  };
  /** Rounded half section of the straight-sided shell at zf. */
  const plain = (zf: number): Vec3[] => { const k = corners(zf); return filletPolyline(k.pts, radii, segs, share).map(([y, x]) => [x, y, k.z] as Vec3); };
  /** Rounded half section of the finished shell at zf: kinks between stations are rounded, and so is the top. */
  const section = (zf: number): Vec3[] => {
    if (zf > zTop) {
      const k = corners(zTop), xm = (k.xr + k.xl) / 2, depth = k.xl - k.xr;
      const sa = clamp01(1 - ((1 - zf) * L) / rz), cy = 1 - Math.sqrt(1 - sa * sa);
      return plain(zTop).map((p) => [xm + ((p[0] - xm) * (depth - 2 * rt * cy)) / depth, (p[1] * (k.w - ry * cy)) / k.w, zf * L] as Vec3);
    }
    for (const zk of kinks) if (Math.abs(zf - zk) < span) return blendSections(plain(zk - span), plain(zk), plain(zk + span), (zf - zk + span) / (2 * span));
    return plain(zf);
  };
  /** Stations at which the shell is sampled: table rows, kink rounding, top rounding. */
  const stations = (): number[] => {
    const zs = rows.map((r) => r[0]).filter((z) => z < zTop && !kinks.some((k) => Math.abs(z - k) < span));
    for (const zk of kinks) for (let i = 0; i <= steps; i++) zs.push(zk - span + (2 * span * i) / steps);
    for (let i = 0; i <= steps; i++) zs.push(1 - (rz / L) * (1 - Math.sin(((Math.PI / 2) * i) / steps)));
    return uniqueSorted(zs, EPS);
  };
  /** Where the upholstery meets the white lip at zf (end of the lip rounding on the front face): [x, y]. */
  const lip = (zf: number): [number, number] => { const p = section(zf)[3 * segs + 3]; return [p[0], p[1]]; };
  return { D, L, th, ws, rows, hub, radii, segs, share, corners, section, stations, lip };
}
type Shell = ReturnType<typeof shell>;

/** Corner points of a radial section of the lower shell or of the tray, as [y, radius from the hub axis]:
 *  the back shell's lowest section laid on a ray from the hub, with the rear face at `rRear` and the front
 *  edge at `rFront` (fractions of the seam's rear radius), width scale `sy`, outward growth `grow`. */
function radialCorners(S: Shell, rRear: number, rFront: number, sy: number, grow: number): P2[] {
  const k = S.corners(S.rows[0][0]), R0 = Math.hypot(k.xr, k.z), rr = rRear * R0 + grow, rf = rFront * R0;
  return k.pts.map(([y, x]) => [y * sy + (grow * y) / k.w, rf + ((rr - rf) * (x - k.xl)) / (k.xr - k.xl)] as P2);
}
/** Place [y, radius] points on the ray `psi` beyond the reclined back axis (rearward and down); hub-relative upright axes. */
const onRay = (S: Shell, psi: number, pts: P2[]): Vec3[] => { const a = S.th + psi; return pts.map(([y, r]) => [-r * Math.sin(a), y, r * Math.cos(a)] as Vec3); };

const hub = (c: Ctx) => {
  const k = c.kit, R = c.p("seat.hub_housing_radius"), t = c.p("seat.hub_thickness"), rc = c.p("seat.hub_cover_radius"), t1 = t + c.p("seat.hub_cover_proud"), b = c.p("seat.hub_edge");
  // housing and one plain cover disc
  const profile: [number, number][] = [[0, 0], [R, 0], [R, t - b], [R - b, t], [rc, t], [rc, t1 - b], [rc - b, t1], [0, t1]];
  const body = k.revolve(profile, { segments: c.p("seat.hub_segments") });
  return k.part("plastic_black", k.rotate(body, [1, 0, 0], (-c.sy * Math.PI) / 2)); // axis along Y, facing outward
};

const parts: GroupModule["components"] = {
  // Frame: on the deck at the pedestal axis. Black cylinder on a low foot ring.
  C_seat_pedestal: (c) => {
    const k = c.kit, h = c.p("seat.pedestal_height"), r = c.p("seat.pedestal_radius"), fh = c.p("seat.flange_height"), bev = c.p("seat.carrier_bevel");
    const foot = k.cylinder(c.p("seat.flange_radius"), fh, { segments: 40, bevel: fh / 3 });
    const post = k.translate(k.cylinder(r, h - fh, { segments: 40, bevel: bev }), [0, 0, fh]);
    return k.part("plastic_black", foot, post);
  },
  // Frame: top of the pedestal. Mechanism box, hidden under the seat.
  C_seat_carrier: (c) => {
    const k = c.kit, s = c.arr("seat.carrier_size") as number[], h = c.p("seat.carrier_height");
    return k.part("metal_dark", k.roundedBox(s[0], s[1], h, c.p("seat.carrier_radius"), { bevel: c.p("seat.carrier_bevel"), segments: 3 }));
  },
  // Frame: top of the carrier. Black tray that cradles the white lower shell, plus the structure under the cushion.
  C_seat_base: (c) => {
    const k = c.kit, S = shell(c), [hx, hz] = hubLocal(c), bev = c.p("seat.tray_bevel");
    const ang = c.p("seat.base_tray_angle"), names = ["rc", "rr", "sc", "lf", "fc"];
    const cg = new CageBuilder();
    const rings = (c.arr("seat.base_tray_sweep") as number[][]).map(([f, sr, sf, sy, grow], i) => onRay(S, f * ang, radialCorners(S, sr, sf, sy, grow)).map((p, j) => cg.pt(names[j] + i, p)));
    cg.bands(rings);
    cg.face(rings[rings.length - 1]);
    cg.face([...rings[0]].reverse());
    const tray = k.translate(k.cage(cg.orientByVolume().spec({ mirror: true, bevel: bev })), [hx, 0, hz]);
    const [x0, x1] = c.arr("seat.base_block_x") as number[], zt = hz + c.p("seat.base_block_top"), bw = c.p("seat.base_block_width"), tp = c.p("seat.base_block_taper");
    const ringAt = (s: number, z: number): Vec3[] => k.roundedRectOutline((x1 - x0) * s, bw * s, bev * 6, 1).map((p) => [p[0], p[1], z] as Vec3);
    const block = k.translate(k.prism(ringAt(1, zt), ringAt(tp, 0), { bevel: bev }), [hx + (x0 + x1) / 2, 0, 0]);
    // side cheeks: flat black plates that carry the hub housings and join them to the tray and to the structure under the cushion
    const [a0, a1] = c.arr("seat.base_cheek_arc") as number[], rA = c.p("seat.hub_housing_radius") * c.p("seat.base_cheek_ring"), [y0, y1] = c.arr("seat.base_cheek_y") as number[];
    const steps = c.p("seat.base_cheek_arc_steps"), outline = (c.arr("seat.base_cheek_outline") as number[][]).map((p) => [p[0], p[1]] as [number, number]);
    for (let i = 0; i <= steps; i++) { const a = a0 + ((a1 - a0) * i) / steps; outline.push([rA * Math.cos(a), rA * Math.sin(a)]); }
    const plate = k.translate(k.rotate(k.extrude(outline, y1 - y0, { bevel: bev }), [1, 0, 0], Math.PI / 2), [hx, y1, hz]);
    return k.part("plastic_black", tray, block, plate, k.mirrorY(plate));
  },
  // Seat cushion (leather) and the white lower shell that continues the back shell round the hubs.
  C_seat_pan: (c) => {
    const k = c.kit, S = shell(c), [hx, hz] = hubLocal(c), bz0 = baseZ(c), px = c.p("seat.pos_x"), crease = c.p("seat.soft_crease");
    // --- white lower shell: the back shell's section just above its lower end, then radial sections round the hub
    const ang = c.p("seat.lower_shell_angle"), [lap, lapGrow] = c.arr("seat.lower_shell_lap") as number[];
    const ca = Math.cos(S.th), sa = Math.sin(S.th), w0s = S.corners(S.rows[0][0]).w;
    const lowerRings = (c.arr("seat.lower_shell_sweep") as number[][]).map(([f, sr, sf, sy]) => {
      if (f === 0) return S.section(S.rows[0][0] + lap).map(([x, y, z]) => { const g = 1 + lapGrow / Math.hypot(x, z); return [(x * ca - z * sa) * g, y * (1 + lapGrow / w0s), (x * sa + z * ca) * g] as Vec3; });
      return onRay(S, f * ang, filletPolyline(radialCorners(S, sr, sf, sy, 0), S.radii, S.segs, S.share));
    });
    const lower = k.translate(k.loft(lowerRings.map(fullRing), { crease: c.p("seat.shell_crease") }), [hx, 0, hz]);

    // --- cushion: lofted from the rear end over the top and round the front lip to its underside
    const lipX = c.p("seat.cushion_front_lip_x"), depth = lipX - c.p("seat.backrest_surface_x_at_cushion");
    const zF = c.p("seat.cushion_top_z_front"), zR = c.p("seat.cushion_top_z_rear");
    const w0 = c.p("seat.pan_width") / 2, w1 = c.p("seat.pan_width_rear") / 2, sweep = c.p("seat.cushion_front_sweep");
    const [cy, edge, gd, gw, sideTuck] = c.arr("seat.cushion_profile") as number[];
    const radii = [0, 0, 0, ...(c.arr("seat.cushion_radii") as number[]), 0, 0], segs = c.p("seat.round_segments"), share = c.p("seat.round_max_share");
    const R = c.p("seat.cushion_lip_radius"), Rc = c.p("seat.cushion_corner_radius"), lipSteps = c.p("seat.cushion_lip_steps"), lipAngle = c.p("seat.cushion_lip_angle");
    const rows = c.arr("seat.cushion_sections") as number[][], seam = c.p("seat.cushion_cross_seam"), dSeam = gw / depth;
    const zbot = zF - 2 * R - edge;                             // underside: the lip rolls right under at the front
    /** Half section: centre -> centre panel edge -> seam groove -> bolster ramp -> crest -> outer edge -> underside.
     *  `s` flattens it (1 = full relief). The two underside points sit at (bx, bz) when given: round the lip that is its axis. */
    const sec = (x: number, hw: number, zc: number, rise: number, st: number, sw: number, s: number, dip: number, bx = x, bz = zbot): Vec3[] => {
      const ys = st * hw;
      const pts: P2[] = [[0, zc - dip], [ys - gw, zc - dip], [ys, zc - gd * s], [ys + gw, zc], [cy * hw, zc + rise * s], [hw, zc + (rise - edge) * s], [hw - sideTuck, bz], [0, bz]];
      return filletPolyline(pts, radii, segs, share).map(([y, z], i, all) => [(i < all.length - 2 ? x : bx) - sweep * sw * (y / hw) * (y / hw) - px, y, z - bz0] as Vec3);
    };
    const at = (xf: number) => { const [, wr, h, rise, st, sw] = interpSmooth(rows, xf); return { x: lipX - xf * depth, hw: w0 + (w1 - w0) * wr, zc: zR + h * (zF - zR), rise, st, sw }; };
    const xfs = uniqueSorted([...refine(rows.map((r) => r[0]), c.p("seat.cushion_rows_per_interval")), seam - dSeam, seam, seam + dSeam], EPS).reverse();
    const rings: Vec3[][] = xfs.map((xf) => { const a = at(xf); return sec(a.x, a.hw, a.zc, a.rise, a.st, a.sw, 1, Math.abs(xf - seam) < EPS ? gd : 0); });
    const f = at(rows[0][0]);                                   // where the top meets the lip roll
    for (let i = 1; i <= lipSteps; i++) {                       // sections fanned round the lip axis; the relief fades out below the nose
      const a = (lipAngle * i) / lipSteps, cs = 1 - Math.cos(Math.min(a, Math.PI / 2)), s = clamp01(2 - a / (Math.PI / 2));
      rings.push(sec(f.x + (lipX - f.x) * Math.sin(a), f.hw - Rc * cs, f.zc - R * (1 - Math.cos(a)), f.rise, f.st, f.sw, s, 0, f.x, f.zc - R));
    }
    const cushion = k.loft(rings.map(fullRing), { crease });
    return [k.part("shell_white", lower), k.part("leather_black", cushion)];
  },
  C_seat_hub_L: hub,
  C_seat_hub_R: hub,

  // White back shell: lofted through rounded half sections (rear centre -> rear face edge -> corner crease -> lip -> front centre).
  // Angular outline, flat faces, rounded edges and top corners. The dark panel lies on the rear face.
  C_seat_back_shell: (c) => {
    const k = c.kit, S = shell(c), L = S.L;
    const secs = S.stations().map((zf) => S.section(zf));
    const white = k.loft(secs.map(fullRing), { crease: c.p("seat.shell_crease") });
    // --- dark panel: a ribbon on the rear face with rounded corners
    const prof = secs.map((s) => [s[0][2], s[0][0]]), rearX = (z: number) => interp(prof, z)[1];
    const pan = c.arr("seat.back_panel_outline") as number[][], rp = c.p("seat.back_panel_corner_radius"), lift = c.p("seat.back_panel_lift"), cs = c.p("seat.back_panel_corner_steps");
    const zb = pan[0][0] * L, zt = pan[pan.length - 1][0] * L, hwAt = (z: number) => interp(pan, z / L)[1] * S.ws;
    const outline: [number, number][] = [];
    for (let i = 0; i <= cs; i++) { const b = (Math.PI / 2) * (1 - i / cs), z = zb + rp * (1 - Math.sin(b)); outline.push([z, hwAt(z) - rp * (1 - Math.cos(b))]); }
    for (const z of uniqueSorted([...prof.map((p) => p[0]), ...pan.map((r) => r[0] * L)], EPS)) if (z > zb + rp + EPS && z < zt - rp - EPS) outline.push([z, hwAt(z)]);
    for (let i = 0; i <= cs; i++) { const b = ((Math.PI / 2) * i) / cs, z = zt - rp * (1 - Math.sin(b)); outline.push([z, hwAt(z) - rp * (1 - Math.cos(b))]); }
    const pts: Vec3[] = [], tris: number[] = [];
    outline.forEach(([z, hw], r) => {
      pts.push([rearX(z) - lift, -hw, z], [rearX(z) - lift, hw, z]);
      if (r > 0) tris.push(2 * r - 2, 2 * r + 1, 2 * r - 1, 2 * r - 2, 2 * r, 2 * r + 1);   // facing the rear
    });
    return [k.part("shell_white", white), k.part("panel_dark", k.shade(pts, tris, { crease: c.p("seat.shell_crease") }))];
  },

  // Back upholstery, one lofted skin: recessed centre insert (the body-contact surface of the backrest) -> soft step ->
  // pad -> bolster ramp -> rounded bolster crest -> down to the white lip -> inside the shell.
  C_seat_back_cushion: (c) => {
    const k = c.kit, S = shell(c), D = S.D, tuck = c.p("seat.back_cushion_tuck");
    const rows = c.arr("seat.back_cushion_stations") as number[][];
    const [iz0, iz1, icorner, inset, recess, g, blend] = c.arr("seat.back_insert") as number[];
    const radii = [0, ...(c.arr("seat.back_cushion_radii") as number[]), 0, 0, 0], segs = c.p("seat.round_segments"), share = c.p("seat.round_max_share");
    // shift the pad so that the insert surface passes through the stated backrest surface point at cushion-top height
    const dx = c.p("seat.backrest_surface_x_at_cushion") - S.hub[0], dz = c.p("seat.cushion_top_z_rear") - S.hub[1];
    const xbT = dx * Math.cos(S.th) + dz * Math.sin(S.th), zbT = -dx * Math.sin(S.th) + dz * Math.cos(S.th);
    const shift = xbT + recess - interp(rows, zbT / S.L)[1] * D;
    const z0 = rows[0][0], z1 = rows[rows.length - 1][0];
    const zs = uniqueSorted([...refine(rows.map((r) => r[0]), c.p("seat.back_cushion_rows_per_interval")), ...S.stations(), iz1 - icorner, iz1, iz1 + blend].filter((z) => z >= z0 && z <= z1), EPS);
    const rings = zs.map((zf) => {
      const [, xp, yp, xb, yb] = interpSmooth(rows, zf), [xlip, ylip] = S.lip(zf), z = zf * S.L, xpad = xp * D + shift;
      const rec = zf < iz0 ? 0 : recess * (1 - clamp01((zf - iz1) / blend));
      const yi = yp * S.ws - inset - icorner * S.L * clamp01((zf - (iz1 - icorner)) / icorner);
      const pts: P2[] = [[0, xpad - rec], [yi - g, xpad - rec], [yi + g, xpad], [yp * S.ws, xpad], [yb * ylip, xb * D], [ylip, xlip], [ylip - tuck / 2, xlip - tuck], [0, xlip - tuck]];
      return filletPolyline(pts, radii, segs, share).map(([y, x]) => [x, y, z] as Vec3);
    });
    return k.part("leather_black", k.loft(rings.map(fullRing), { crease: c.p("seat.soft_crease") }));
  },

  // Head pad on the narrow upper zone: flat front, rounded edges, sides running back to the white edge, shallow V at the bottom.
  C_seat_headrest: (c) => {
    const k = c.kit, S = shell(c), D = S.D, tuck = c.p("seat.back_cushion_tuck");
    const rows = c.arr("seat.headrest_stations") as number[][];
    const radii = [0, c.p("seat.headrest_radius"), 0, 0, 0], segs = c.p("seat.round_segments"), share = c.p("seat.round_max_share");
    const rings = refine(rows.map((r) => r[0]), c.p("seat.headrest_rows_per_interval")).map((zf) => {
      const [, xp, yp, drop] = interpSmooth(rows, zf), [xlip, ylip] = S.lip(zf), ye = yp * ylip;
      const pts: P2[] = [[0, xp * D], [ye, xp * D], [ylip, xlip], [ylip - tuck / 2, xlip - tuck], [0, xlip - tuck]];
      return filletPolyline(pts, radii, segs, share).map(([y, x]) => [x, y, (zf - drop * clamp01(1 - y / ye)) * S.L] as Vec3);
    });
    return k.part("leather_black", k.loft(rings.map(fullRing), { crease: c.p("seat.soft_crease") }));
  },
};

// every mesh of the group goes through the sliver filter
export const components: GroupModule["components"] = Object.fromEntries(Object.entries(parts).map(([id, fn]) => [id, (c: Ctx) => {
  const res = fn(c);
  return (Array.isArray(res) ? res : [res]).map((p) => ({ material: p.material, mesh: dropSlivers(p.mesh) }));
}]));
