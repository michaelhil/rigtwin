// Generated screen images (neutral test content, no photo pixels, no text) and a small PNG encoder.
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

export interface Texture { name: string; png: Uint8Array; width: number; height: number }
export function screenTextures(): Record<string, Texture> {
  return {
    screen_main: { name: "screen_main", width: 1024, height: 256, png: mosaic(1024, 256, [5, 3], 4) },
    screen_touch: { name: "screen_touch", width: 512, height: 256, png: panel(512, 256) },
  };
}
