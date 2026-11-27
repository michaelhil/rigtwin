import type { GroupModule } from "../../../generator/assemble.ts";
import { panel, screenOf } from "../../floor-display/src/display.ts";

export const components: GroupModule["components"] = {
  C_panel: panel, S_screen: screenOf("screen_overview"),
  C_mount(c) {
    const p = (key: string) => c.p("display." + key), depth = p("standoff"), h = p("plate_height");
    const plate = c.kit.box(depth, p("plate_width"), h, { bevel: p("bevel") });
    return { material: "metal_dark", mesh: c.kit.translate(plate, [-depth / 2, 0, p("centre") - h / 2]) };
  },
};
