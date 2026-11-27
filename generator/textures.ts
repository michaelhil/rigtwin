// Generated screen images (neutral test content, no photo pixels, no text) and a small PNG encoder.
// Only the textures a model's materials name are written into its file.
import { deflateSync } from "node:zlib";

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Encode 8-bit RGB as PNG (no interlace, filter 0). */
export function encodePng(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

class Canvas {
  data: Uint8Array;
  constructor(public w: number, public h: number, bg: number[]) {
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.data.set(bg, i * 3);
  }
  rect(x0: number, y0: number, x1: number, y1: number, color: (u: number, v: number) => number[]) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) {
      this.data.set(color((x - x0) / Math.max(1, x1 - x0 - 1), (y - y0) / Math.max(1, y1 - y0 - 1)).map((c) => Math.max(0, Math.min(255, Math.round(c)))), (y * this.w + x) * 3);
    }
  }
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** A camera-wall style mosaic: tiles with a soft horizon gradient. Top-left tile carries a thin accent bar. */
function mosaic(w: number, h: number, cols: number[], gap: number): Uint8Array {
  const c = new Canvas(w, h, [10, 12, 16]);
  const rows = cols.length, rowH = Math.floor((h - gap * (rows + 1)) / rows);
  cols.forEach((n, r) => {
    const tileW = Math.floor((w - gap * (n + 1)) / n), y0 = gap + r * (rowH + gap);
    for (let k = 0; k < n; k++) {
      const x0 = gap + k * (tileW + gap), horizon = 0.38 + 0.17 * Math.sin(k * 1.7 + r * 2.3);
      const sky = mix([150, 172, 200], [190, 200, 212], (k % 3) / 2), ground = mix([122, 126, 128], [156, 148, 134], ((k + r) % 3) / 2);
      c.rect(x0, y0, x0 + tileW, y0 + rowH, (u, v) => {
        const tilt = (u - 0.5) * 0.12 * (k % 2 ? 1 : -1);
        return v < horizon + tilt ? mix(sky, mix(sky, [236, 240, 244], 0.7), v / Math.max(0.01, horizon)) : mix(ground, mix(ground, [70, 72, 76], 0.6), (v - horizon) / (1 - horizon));
      });
    }
  });
  c.rect(gap, gap, gap + Math.floor(w / 16), gap + Math.max(2, Math.floor(h / 72)), () => [230, 236, 244]);
  return encodePng(w, h, c.data);
}

/** A control panel: dark background with rows of soft tiles. */
function panel(w: number, h: number): Uint8Array {
  const c = new Canvas(w, h, [14, 17, 24]);
  const g = Math.floor(h / 24);
  c.rect(0, 0, Math.floor(w * 0.16), h, () => [22, 27, 38]);
  for (let r = 0; r < 5; r++) c.rect(g, g * 2 + r * g * 4, Math.floor(w * 0.16) - g, g * 2 + r * g * 4 + g * 2, () => (r === 1 ? [70, 110, 190] : [40, 48, 64]));
  for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
    const x0 = Math.floor(w * 0.2) + k * Math.floor(w * 0.195), y0 = g * 3 + r * Math.floor(h * 0.4);
    c.rect(x0, y0, x0 + Math.floor(w * 0.17), y0 + Math.floor(h * 0.3), (_, v) => mix([44, 54, 74], [30, 37, 52], v));
  }
  c.rect(Math.floor(w * 0.2), h - g * 3, Math.floor(w * 0.96), h - g * 2, () => [70, 110, 190]);
  return encodePng(w, h, c.data);
}

// ---- Abstract process displays for the control-room assets: a plant mimic, trends, a site overview and a control
// panel. Shapes and colours only (no text, no logos), reminiscent of process control screens; deterministic.
const BG = [16, 22, 32], FRAME = [44, 56, 72], PIPE = [112, 132, 154], GRID = [30, 40, 54];
const TEAL = [46, 164, 170], GREEN = [70, 186, 116], AMBER = [232, 172, 52], RED = [214, 78, 66], CYAN = [86, 182, 232], VIOLET = [150, 128, 214];
class Painter extends Canvas {
  px(x: number, y: number, c: number[]) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data.set(c, (y * this.w + x) * 3); }
  box(x: number, y: number, w: number, h: number, c: number[]) { this.rect(Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h), () => c); }
  outline(x: number, y: number, w: number, h: number, t: number, c: number[]) {
    this.box(x, y, w, t, c); this.box(x, y + h - t, w, t, c); this.box(x, y, t, h, c); this.box(x + w - t, y, t, h, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, t: number, c: number[]) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; this.box(x - t / 2, y - t / 2, t, t, c); }
  }
  disk(cx: number, cy: number, r: number, c: number[]) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) this.px(cx + x, cy + y, c); }
  ring(cx: number, cy: number, r: number, t: number, c: number[]) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y); if (d <= r && d > r - t) this.px(cx + x, cy + y, c); } }
  /** A smooth wandering curve inside a box: the look of a process trend. */
  trend(x: number, y: number, w: number, h: number, seed: number, c: number[], t = 2) {
    let px = x, py = 0;
    for (let i = 0; i <= w; i += 2) {
      const u = i / w, v = 0.5 + 0.22 * Math.sin(u * 7 + seed) + 0.12 * Math.sin(u * 19 + seed * 2.3) + 0.06 * Math.sin(u * 43 + seed * 5.1);
      const qx = x + i, qy = y + h * (1 - v);
      if (i) this.line(px, py, qx, qy, t, c);
      px = qx; py = qy;
    }
  }
  tank(x: number, y: number, w: number, h: number, level: number, fill: number[]) {
    this.box(x, y + h * (1 - level), w, h * level, mix(BG, fill, 0.75));
    this.outline(x, y, w, h, 3, PIPE);
    this.box(x + w + 6, y, 6, h, GRID); this.box(x + w + 6, y + h * (1 - level), 6, h * level, fill);
  }
  valve(cx: number, cy: number, r: number, open: boolean) {
    const c = open ? GREEN : AMBER;
    for (let i = 0; i <= r; i++) { this.box(cx - r + i, cy - i / 1.6, 1.5, (2 * i) / 1.6, c); this.box(cx + r - i, cy - i / 1.6, 1.5, (2 * i) / 1.6, c); }
  }
  pump(cx: number, cy: number, r: number, running: boolean) { this.disk(cx, cy, r, mix(BG, running ? GREEN : RED, 0.35)); this.ring(cx, cy, r, 3, running ? GREEN : RED); this.line(cx - r * 0.5, cy, cx + r * 0.6, cy, 3, running ? GREEN : RED); }
}
const header = (c: Painter, h: number) => {
  c.box(0, 0, c.w, h, [24, 32, 46]); c.box(0, h, c.w, 1, FRAME);
  [GREEN, GREEN, AMBER, GREEN].forEach((col, i) => c.disk(c.w - 18 - i * 16, h / 2, 4, col));
  for (let i = 0; i < 4; i++) c.box(10 + i * 62, h * 0.32, 48, h * 0.36, i === 1 ? [60, 92, 140] : [38, 50, 68]);
};

/** A plant mimic: tanks, pumps, valves and a heat exchanger joined by pipes, with lamps and a strip of trends. */
function processMimic(w: number, h: number, seed: number): Uint8Array {
  const c = new Painter(w, h, BG), top = Math.round(h * 0.07);
  header(c, top);
  const y0 = top + h * 0.1, th = h * 0.36, tw = w * 0.09;
  const tanks = [[w * 0.05, 0.72, TEAL], [w * 0.2, 0.45, CYAN], [w * 0.35, 0.86, TEAL]] as const;
  const mid = y0 + th + h * 0.08;
  c.line(w * 0.03, mid, w * 0.93, mid, 4, PIPE);
  tanks.forEach(([x, level, col], i) => {
    const l = Math.min(0.95, Math.max(0.15, level + 0.12 * Math.sin(seed + i)));
    c.tank(x, y0, tw, th, l, col);
    c.line(x + tw / 2, y0 + th, x + tw / 2, mid, 4, PIPE);
    c.valve(x + tw / 2, y0 + th + (mid - y0 - th) / 2, 9, (i + seed) % 3 !== 1);
  });
  c.pump(w * 0.55, mid, 16, true); c.pump(w * 0.62, mid, 16, seed % 2 === 0);
  // heat exchanger
  const hx = w * 0.7, hy = y0 + th * 0.2, hw = w * 0.11, hh = th * 0.7;
  c.box(hx, hy, hw, hh, [26, 36, 50]); c.outline(hx, hy, hw, hh, 3, PIPE);
  for (let i = 0; i < 6; i++) c.line(hx + 8 + (i * (hw - 16)) / 6, hy + (i % 2 ? hh - 10 : 10), hx + 8 + ((i + 1) * (hw - 16)) / 6, hy + (i % 2 ? 10 : hh - 10), 2, AMBER);
  c.line(hx + hw / 2, hy + hh, hx + hw / 2, mid, 4, PIPE);
  c.line(hx + hw, hy + hh / 2, w * 0.93, hy + hh / 2, 4, PIPE); c.line(w * 0.93, hy + hh / 2, w * 0.93, mid, 4, PIPE);
  c.valve(w * 0.86, hy + hh / 2, 9, true);
  // flow markers along the main pipe
  for (let x = w * 0.1; x < w * 0.5; x += w * 0.08) c.line(x, mid - 5, x + 8, mid, 2, CYAN), c.line(x, mid + 5, x + 8, mid, 2, CYAN);
  // lamps
  for (let i = 0; i < 6; i++) c.disk(w * 0.05 + i * w * 0.07, mid + h * 0.07, 5, [GREEN, GREEN, AMBER, GREEN, GREEN, (seed + i) % 4 ? GREEN : RED][i]);
  // bottom: trend strip and an alarm list
  const by = h * 0.72, bh = h * 0.24;
  c.box(w * 0.03, by, w * 0.6, bh, [20, 28, 40]); c.outline(w * 0.03, by, w * 0.6, bh, 1, FRAME);
  for (let i = 1; i < 4; i++) c.box(w * 0.03, by + (i * bh) / 4, w * 0.6, 1, GRID);
  c.trend(w * 0.04, by + 6, w * 0.58, bh - 12, seed, CYAN); c.trend(w * 0.04, by + 6, w * 0.58, bh - 12, seed + 2.1, AMBER);
  for (let i = 0; i < 5; i++) {
    const y = by + i * (bh / 5) + 3;
    c.box(w * 0.66, y, w * 0.31, bh / 5 - 6, i === 0 && seed % 2 ? [70, 40, 36] : [28, 36, 50]);
    c.box(w * 0.66, y, 5, bh / 5 - 6, [RED, AMBER, AMBER, GREEN, GREEN][i]);
    c.box(w * 0.68, y + (bh / 5 - 6) * 0.35, w * (0.12 + 0.1 * ((i * 7 + seed) % 3) / 2), (bh / 5 - 6) * 0.3, [70, 84, 104]);
  }
  return encodePng(w, h, c.data);
}

/** Trends and gauges: a chart with three curves and limit lines, a row of tiles and vertical bar gauges. */
function trends(w: number, h: number, seed: number): Uint8Array {
  const c = new Painter(w, h, BG), top = Math.round(h * 0.07);
  header(c, top);
  const ty = top + 10, tile = (w * 0.7 - 30) / 4;
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * (tile + 10);
    c.box(x, ty, tile, h * 0.14, [24, 33, 47]); c.box(x, ty, tile, 3, [CYAN, GREEN, AMBER, VIOLET][i]);
    c.box(x + 10, ty + h * 0.05, tile * (0.35 + 0.15 * Math.sin(seed + i)), h * 0.05, [92, 110, 134]);
  }
  const gx = 10, gy = ty + h * 0.14 + 12, gw = w * 0.7 - 10, gh = h - gy - 12;
  c.box(gx, gy, gw, gh, [20, 28, 40]); c.outline(gx, gy, gw, gh, 1, FRAME);
  for (let i = 1; i < 6; i++) c.box(gx, gy + (i * gh) / 6, gw, 1, GRID);
  for (let i = 1; i < 10; i++) c.box(gx + (i * gw) / 10, gy, 1, gh, GRID);
  for (let x = gx; x < gx + gw; x += 14) c.box(x, gy + gh * 0.18, 7, 2, AMBER), c.box(x, gy + gh * 0.84, 7, 2, AMBER);
  c.trend(gx + 4, gy + gh * 0.1, gw - 8, gh * 0.8, seed, CYAN, 3);
  c.trend(gx + 4, gy + gh * 0.25, gw - 8, gh * 0.6, seed + 1.7, GREEN, 2);
  c.trend(gx + 4, gy + gh * 0.35, gw - 8, gh * 0.5, seed + 4.2, VIOLET, 2);
  // bar gauges
  const bx = w * 0.74, bw = (w * 0.24 - 30) / 4, bh = h - ty - 22;
  for (let i = 0; i < 4; i++) {
    const x = bx + i * (bw + 10), level = 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(seed * 1.3 + i * 1.9));
    c.box(x, ty, bw, bh, [24, 33, 47]); c.outline(x, ty, bw, bh, 1, FRAME);
    c.box(x + 4, ty + bh * (1 - level), bw - 8, bh * level - 4, level > 0.8 ? AMBER : [TEAL, CYAN, GREEN, TEAL][i]);
    c.box(x - 3, ty + bh * 0.15, bw + 6, 2, RED);
  }
  return encodePng(w, h, c.data);
}

/** A site overview for a wall display: zones, a network of units joined by lines, and tiles of small trends. */
function siteOverview(w: number, h: number): Uint8Array {
  const c = new Painter(w, h, [14, 20, 30]), top = Math.round(h * 0.06);
  header(c, top);
  const zones = [[0.03, 0.12, 0.3, 0.5], [0.36, 0.12, 0.28, 0.5], [0.67, 0.12, 0.3, 0.5]];
  zones.forEach(([x, y, zw, zh], i) => { c.box(w * x, h * y, w * zw, h * zh, [20, 29, 42]); c.outline(w * x, h * y, w * zw, h * zh, 2, FRAME); c.box(w * x, h * y, w * zw, 4, [CYAN, TEAL, VIOLET][i]); });
  const nodes: [number, number, number[]][] = [];
  zones.forEach(([x, y, zw, zh], z) => { for (let i = 0; i < 5; i++) nodes.push([w * (x + zw * (0.15 + 0.7 * ((i * 37 + z * 11) % 10) / 10)), h * (y + zh * (0.2 + 0.6 * ((i * 53 + z * 29) % 10) / 10)), (i + z) % 7 === 3 ? AMBER : (i * z) % 11 === 5 ? RED : GREEN]); });
  for (let i = 1; i < nodes.length; i++) { const a = nodes[i - 1], b = nodes[(i * 7) % nodes.length]; c.line(a[0], a[1], b[0], a[1], 2, PIPE); c.line(b[0], a[1], b[0], b[1], 2, PIPE); }
  for (const [x, y, col] of nodes) { c.disk(x, y, 11, mix([14, 20, 30], col, 0.3)); c.ring(x, y, 11, 3, col); }
  for (let i = 0; i < 6; i++) {
    const x = w * 0.03 + i * (w * 0.94) / 6, y = h * 0.66, tw2 = (w * 0.94) / 6 - 10, th2 = h * 0.3;
    c.box(x, y, tw2, th2, [20, 28, 40]); c.outline(x, y, tw2, th2, 1, FRAME);
    c.trend(x + 6, y + 10, tw2 - 12, th2 - 20, i * 1.37, [CYAN, GREEN, AMBER, CYAN, VIOLET, GREEN][i]);
  }
  return encodePng(w, h, c.data);
}

/** A touch control panel: tabs, a grid of keys with a few lit, and two sliders. */
function controlPanel(w: number, h: number): Uint8Array {
  const c = new Painter(w, h, [18, 22, 30]);
  for (let i = 0; i < 4; i++) c.box(8 + i * (w - 16) / 4, 6, (w - 16) / 4 - 6, h * 0.12, i === 0 ? [54, 96, 150] : [34, 42, 56]);
  const cols = 5, rows = 3, kw = (w * 0.66 - 16) / cols, kh = (h * 0.62) / rows, y0 = h * 0.22;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const lit = (r * cols + k) % 6 === 2, warn = r === 2 && k === 4;
    c.box(8 + k * kw, y0 + r * kh, kw - 6, kh - 6, warn ? [120, 86, 30] : lit ? [36, 110, 92] : [38, 47, 62]);
    c.box(8 + k * kw, y0 + r * kh, kw - 6, 3, warn ? AMBER : lit ? GREEN : [56, 66, 84]);
  }
  for (let i = 0; i < 2; i++) {
    const x = w * 0.72 + i * w * 0.13, sh = h * 0.62, level = i ? 0.35 : 0.7;
    c.box(x, y0, w * 0.06, sh, [30, 38, 52]); c.box(x, y0 + sh * (1 - level), w * 0.06, sh * level, [CYAN, TEAL][i]);
    c.box(x - 4, y0 + sh * (1 - level) - 3, w * 0.06 + 8, 6, [220, 228, 236]);
  }
  return encodePng(w, h, c.data);
}

export interface Texture { name: string; png: Uint8Array; width: number; height: number }
export function screenTextures(): Record<string, Texture> {
  return {
    screen_main: { name: "screen_main", width: 1024, height: 256, png: mosaic(1024, 256, [5, 3], 4) },
    screen_touch: { name: "screen_touch", width: 512, height: 256, png: panel(512, 256) },
    screen_process: { name: "screen_process", width: 768, height: 432, png: processMimic(768, 432, 0) },
    screen_process_b: { name: "screen_process_b", width: 768, height: 432, png: processMimic(768, 432, 3) },
    screen_trend: { name: "screen_trend", width: 768, height: 432, png: trends(768, 432, 0.4) },
    screen_trend_b: { name: "screen_trend_b", width: 768, height: 432, png: trends(768, 432, 2.6) },
    screen_overview: { name: "screen_overview", width: 1024, height: 576, png: siteOverview(1024, 576) },
    screen_console: { name: "screen_console", width: 512, height: 256, png: controlPanel(512, 256) },
  };
}
