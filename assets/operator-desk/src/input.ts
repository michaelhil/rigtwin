// Operator desk, group "input": keyboard unit with its touch panel, mouse. Keyboard node: centre of the unit's front edge on
// the desktop, +x toward the displays. Keys and grille slats are not modelled one by one: raised fields only.
import type { GroupModule } from "../../../generator/assemble.ts";
import { type P2, profileY } from "./lib/shape.ts";

export const components: GroupModule["components"] = {
  // A wedge: palm rest, sloping key deck, a flat rear part that carries two loudspeaker blocks with the raised, sloping touch
  // panel between them.
  C_keyboard: (c) => {
    const k = c.kit, [, w] = c.arr("keyboard.size") as number[], [r0, rh] = c.arr("keyboard.rest") as number[], [d0, h1, h2] = c.arr("keyboard.deck") as number[], lip = c.p("keyboard.lip");
    const [kd, kw, kt] = c.arr("keyboard.keys") as number[], [rd, rearH] = c.arr("keyboard.rear") as number[], [tw, tl, tt] = c.arr("keyboard.touch") as number[], slope = c.p("keyboard.touch_slope"), b = c.p("detail.bevel");
    const [gw, gd, gt] = c.arr("keyboard.grille") as number[], x1 = r0 + d0, x2 = x1 + rd;
    void rearH;
    const wedge: P2[] = [[0, 0], [x2, 0], [x2, h2], [x1, h2], [r0, h1], [r0, rh], [0, lip]], body = profileY(c, wedge, w, 0, b);
    // the key field: rows with grooves between them, on the sloping deck
    const rows = Math.round(c.p("keyboard.key_row_count")), rowDepth = c.p("keyboard.key_row_depth"), pitch = kd / rows, slopeDeck = Math.atan2(h2 - h1, d0), keys = [];
    for (let i = 0; i < rows; i++) keys.push(k.place(k.translate(k.box(rowDepth, kw, kt, { bevel: kt / 2 }), [(i + 0.5 - rows / 2) * pitch, 0, 0]), [r0 + d0 / 2, 0, (h1 + h2) / 2], [0, -slopeDeck, 0]));
    // loudspeaker blocks: boxes beside the touch panel whose tops slope toward the operator like the panel, to a share of its rise
    const side = (w - tw) / 2, blocks = [], plates = [], rise = c.p("keyboard.block_rise") * tl * Math.sin(slope), run = rise / Math.tan(slope);
    const wedgeTop: P2[] = [[x1, h2], [x1 + run, h2 + rise], [x2, h2 + rise], [x2, h2]];
    for (const s of [1, -1]) {
      const y = s * (tw / 2 + side / 2);
      blocks.push(profileY(c, wedgeTop, side - 2 * b, y, b));
      plates.push(k.place(k.translate(k.box(Math.min(gd, run / Math.cos(slope) - 4 * b), gw, gt, { bevel: gt / 2 }), [run / Math.cos(slope) / 2, 0, 0]), [x1, y, h2], [0, -slope, 0]));
    }
    const touch = k.place(k.translate(k.box(tl, tw, tt, { bevel: b }), [tl / 2, 0, 0]), [x1, 0, h2], [0, -slope, 0]);
    const prop = profileY(c, [[x1, h2], [x1 + tl * Math.cos(slope), h2], [x1 + tl * Math.cos(slope), h2 + tl * Math.sin(slope)]], tw - 4 * b, 0);
    return [k.part("kb_charcoal", body, blocks, touch, prop), k.part("key_black", keys, plates)];
  },
  S_keyboard_touch: (c) => {
    const [tw, tl] = c.arr("keyboard.touch") as number[], b = c.p("keyboard.touch_border");
    return c.kit.part("screen_console", c.kit.sheet(tw - 2 * b, tl - 2 * b));
  },
  // a low rounded block; nothing else of the mouse matters to the asset's purpose
  C_mouse: (c) => {
    const k = c.kit, [l, w, h] = c.arr("mouse.size") as number[];
    return k.part("plastic_black", k.roundedBox(l, w, h, w / 3, { bevelTop: h / 3, bevelBottom: c.p("detail.bevel"), segments: 3, crease: c.p("detail.smooth_crease") }));
  },
};
