import type { Ctx, GroupModule } from "../../../generator/assemble.ts";

export function panel(c: Ctx) {
  const p = (key: string) => c.p("display." + key), h = p("height");
  return { material: "plastic_black", mesh: c.kit.translate(c.kit.box(p("thickness"), p("width"), h, { bevel: p("bevel") }), [0, 0, -h / 2]) };
}

/** The lit area with abstract process content (generator/textures.ts); the wall display passes its own picture. */
export const screenOf = (material: string) => (c: Ctx) => {
  const p = (key: string) => c.p("display." + key), rim = p("border");
  return { material, mesh: c.kit.sheet(p("width") - 2 * rim, p("height") - 2 * rim) };
};
export const screen = screenOf("screen_process");

export const components: GroupModule["components"] = {
  C_panel: panel, S_screen: screen,
  C_mount(c) {
    const p = (key: string) => c.p("display." + key), bevel = p("bevel");
    const base = c.kit.box(p("base_depth"), p("base_width"), p("base_height"), { bevel });
    const post = c.kit.box(p("post_depth"), p("post_width"), p("centre"), { bevel });
    const arm = c.kit.box(p("standoff"), p("post_width"), p("post_depth"), { bevel });
    return [{ material: "panel_dark", mesh: base }, { material: "metal_dark", mesh: post },
      { material: "metal_dark", mesh: c.kit.translate(arm, [-p("standoff") / 2, 0, p("centre") - p("post_depth")]) }];
  },
};
