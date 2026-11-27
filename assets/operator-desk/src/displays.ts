// Operator desk, group "displays": two large displays on the wall, three small ones on posts on the shelf. BLOCKOUT.
// A display's node origin lies on its tilt axis; the housing stands in front of it (toward -x), the screen faces -x.
import type { Ctx, GroupModule } from "../../../generator/assemble.ts";
import type { Part } from "../../../generator/kit.ts";
import { wallShape } from "./lib/shape.ts";

/** A display: a thin slab with a raised back section, and the bracket plate behind it. `gap`: back of the housing to the tilt axis;
 *  `drop`: axis above the lower edge. The glass is a separate surface node in front of the slab, inside the bezel. */
function housing(c: Ctx, size: number[], thickness: number, edge: number, back: number[], gap: number, drop: number, stub: number[]): Part[] {
  const k = c.kit, [w, h] = size, b = c.p("detail.bevel"), front = -gap - thickness;
  const slab = k.translate(k.box(edge, w, h, { bevel: b }), [front + edge / 2, 0, -drop]);
  const bulge = k.translate(k.box(thickness - edge, w * back[0], h * back[1], { bevel: 2 * b }), [front + edge + (thickness - edge) / 2, 0, -drop + (h * (1 - back[1])) / 4]);
  return [k.part("housing_black", slab, bulge, k.translate(k.box(gap, stub[0], stub[1]), [-gap / 2, 0, -stub[1] / 2]))];
}
const big = (c: Ctx) => housing(c, c.arr("big.size"), c.p("big.thickness"), c.p("big.edge"), c.arr("big.back"), c.p("big.mount_gap"), c.arr("big.size")[1] / 2, c.arr("big.stub"));
const small = (c: Ctx) => housing(c, c.arr("small.size"), c.p("small.thickness"), c.p("small.edge"), c.arr("small.back"), c.arr("small.pivot")[0], c.arr("small.pivot")[1], c.arr("small.stub"));
// Each lit area shows abstract process content (generator/textures.ts), a different picture per screen.
const bigScreen = (material: string) => (c: Ctx) => { const [w, h] = c.arr("big.size") as number[], b = c.p("big.border"); return c.kit.part(material, c.kit.sheet(w - 2 * b, h - 2 * b)); };
// lit area 16:9 inside the side borders (the housing's extra height is its lower border)
const smallScreen = (material: string) => (c: Ctx) => { const [w] = c.arr("small.size") as number[], b = c.p("small.border"); return c.kit.part(material, c.kit.sheet(w - 2 * b, ((w - 2 * b) * 9) / 16)); };

/** Tilt axes of the three small displays in the model frame: [x, y, z, yaw] (the same expressions as the spec's joints). */
function smallAxes(c: Ctx): number[][] {
  const tilt = c.p("small.tilt"), yaw = c.p("small.yaw"), [w, h] = c.arr("small.size") as number[], [pg, pz] = c.arr("small.pivot") as number[], th = c.p("small.thickness");
  const back = (h - pz) * Math.sin(tilt) - (pg + th) * Math.cos(tilt), down = (pg + th) * Math.sin(tilt) + (h - pz) * Math.cos(tilt), [outer, middle] = c.arr("small.top_centre") as number[][];
  void w;
  return [[outer[0] - back * Math.cos(yaw), outer[1] - back * Math.sin(yaw), outer[2] - down, yaw], [middle[0] - back, middle[1], middle[2] - down, 0],
    [outer[0] - back * Math.cos(yaw), -outer[1] + back * Math.sin(yaw), outer[2] - down, -yaw]].map(([x, y, z, a]) => [x, y, z + c.p("desk.height"), a]);
}

export const components: GroupModule["components"] = {
  C_big_display_L: big, C_big_display_R: big, S_big_screen_L: bigScreen("screen_process"), S_big_screen_R: bigScreen("screen_trend"),
  C_small_display_1: small, C_small_display_2: small, C_small_display_3: small, S_small_screen_1: smallScreen("screen_trend_b"), S_small_screen_2: smallScreen("screen_process_b"), S_small_screen_3: smallScreen("screen_trend"),
  // Node: at the centre of the pair of large displays (front faces), on the centre line. A cross bar behind the two tilt axes,
  // a bracket at each axis, and a block from the bar back to the wall's felt face.
  C_big_arm: (c) => {
    const k = c.kit, [ad, al, ah] = c.arr("big.arm_size") as number[], reach = c.p("big.thickness") + c.p("big.mount_gap"), tilt = c.p("big.tilt"), yaw = c.p("big.yaw");
    const ax = reach * Math.cos(tilt) * Math.cos(yaw), ay = c.arr("big.centre")[1] + reach * Math.cos(tilt) * Math.sin(yaw), az = reach * Math.sin(tilt), gap = c.p("big.arm_gap"), [sw, sh] = c.arr("big.stub") as number[];
    const w = wallShape(c), z = c.arr("big.centre")[2] + az, wallFace = c.p("wall.front_x") + w.front(z) - c.arr("big.centre")[0], barRear = ax + gap + ad;
    const bar = k.translate(k.box(ad, al, ah, { bevel: c.p("detail.bevel") }), [ax + gap + ad / 2, 0, az - ah / 2]);
    const bracket = (y: number) => k.translate(k.box(gap, sw / 2, sh / 2), [ax + gap / 2, y, az - sh / 4]);
    const block = k.translate(k.box(wallFace - barRear, sw, ah), [(wallFace + barRear) / 2, 0, az - ah / 2]);
    return k.part("metal_dark", bar, bracket(ay), bracket(-ay), block);
  },
  // Carriage frame (= model frame at the photographed height). Per display: a wooden post on a metal foot on the shelf, and a
  // short metal arm from the post forward to the tilt axis.
  C_small_mounts: (c) => {
    const k = c.kit, [pd, pw, ph] = c.arr("small.post_size") as number[], [fd, fw, ft] = c.arr("small.post_foot") as number[], off = c.p("small.post_offset"), [aw, ah] = c.arr("small.arm_size") as number[];
    const shelf = c.p("desk.height") - c.p("desk.shelf_drop"), wood = [], metal = [];
    for (const [x, y, z, yaw] of smallAxes(c)) {
      const put = (m: ReturnType<typeof k.box>, dx: number, zz: number) => k.place(k.translate(m, [dx, 0, 0]), [x, y, zz], [0, 0, yaw]);
      wood.push(put(k.box(pd, pw, ph, { bevel: c.p("detail.bevel") }), off + pd / 2, shelf + ft));
      metal.push(put(k.box(fd, fw, ft), off + pd / 2, shelf), put(k.box(off, aw, ah), off / 2, z - ah / 2));
    }
    return [k.part("wood_light", wood), k.part("metal_dark", metal)];
  },
};
