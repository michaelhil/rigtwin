// Shared material palette. Component functions name one of these for every part they return.
// Colours are written as sRGB and converted to the linear values glTF expects.
export interface Material {
  color: [number, number, number];   // sRGB 0..1
  metallic: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  emissiveTexture?: "screen_main" | "screen_touch";
  note: string;
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const PALETTE: Record<string, Material> = {
  shell_white:   { color: hex("#f1f1ee"), metallic: 0, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.3, note: "satin-gloss white moulded shells, rim, columns, shelf, arm" },
  leather_black: { color: hex("#2a2b2f"), metallic: 0, roughness: 0.6, note: "upholstery: cushions, armrest pads, headrest (satin, a little lighter than the plastics)" },
  plastic_black: { color: hex("#1e1f21"), metallic: 0, roughness: 0.64, note: "black plastic with a low sheen: plates, housings, grips, pedal frame" },
  panel_dark:    { color: hex("#2a2d33"), metallic: 0, roughness: 0.75, note: "dark inset panels and trims" },
  deck_dark:     { color: hex("#1f2228"), metallic: 0, roughness: 0.85, note: "platform deck panels" },
  rubber_black:  { color: hex("#1c1c1e"), metallic: 0, roughness: 0.62, note: "black rubber with a soft sheen: bellows, pedal pads" },
  metal_dark:    { color: hex("#3a3c40"), metallic: 1, roughness: 0.58, note: "dark anodised metal: arms, pedal arms, mechanisms" },
  metal_bright:  { color: hex("#c9cbd0"), metallic: 1, roughness: 0.28, note: "bright metal: button bezels, key switch, fittings" },
  glass_black:   { color: hex("#050506"), metallic: 0, roughness: 0.3, note: "screen bezels and unlit glass" },
  estop_red:     { color: hex("#c8171b"), metallic: 0, roughness: 0.4, note: "emergency stop head" },
  estop_yellow:  { color: hex("#e9bd16"), metallic: 0, roughness: 0.5, note: "emergency stop base" },
  screen_main:   { color: hex("#000000"), metallic: 0, roughness: 0.6, emissiveTexture: "screen_main", note: "main display active area (emissive test image, anti-glare surface)" },
  screen_touch:  { color: hex("#000000"), metallic: 0, roughness: 0.6, emissiveTexture: "screen_touch", note: "touchscreen active area (emissive test image, anti-glare surface)" },
};

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
