// Capture the displayed drawing at the current camera. SVG computed styles make plan exports self-contained.
const styles = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "vector-effect",
  "display",
  "visibility",
  "paint-order",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
];
async function drawPlan(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, w: number, h: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const inNodes = [svg, ...svg.querySelectorAll("*")],
    outNodes = [clone, ...clone.querySelectorAll("*")];
  for (let i = 0; i < inNodes.length; i++) {
    const source = getComputedStyle(inNodes[i]),
      target = outNodes[i] as SVGElement;
    for (const key of styles) {
      const val = source.getPropertyValue(key).replace(/url\(["']?[^)]*#([^)"']+)["']?\)/g, "url(#$1)");
      target.style.setProperty(key, val);
    }
  }
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.style.display = "block";
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    ctx.drawImage(image, 0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function roomPicture(stage: HTMLElement, mode: "3d" | "plan"): Promise<Blob> {
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await frame();
  await frame();
  const view = stage.getBoundingClientRect(),
    w = Math.round(view.width),
    h = Math.round(view.height);
  if (w < 1 || h < 1) throw new Error("Open a visible room drawing to save its picture.");
  const canvas = document.createElement("canvas"),
    scale = Math.min(devicePixelRatio || 1, 2, 4096 / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot export a drawing.");
  ctx.scale(scale, scale);
  ctx.fillStyle = getComputedStyle(stage).backgroundColor;
  ctx.fillRect(0, 0, w, h);
  if (mode === "plan") await drawPlan(ctx, stage.querySelector<SVGSVGElement>(".rv-plan")!, w, h);
  else {
    const gl = stage.querySelector("canvas");
    if (!gl) throw new Error("The 3D view is still opening.");
    ctx.drawImage(gl, 0, 0, w, h);
    for (const tag of stage.querySelectorAll<HTMLElement>(".rv-orbit-tag")) {
      const r = tag.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const s = getComputedStyle(tag),
        x = r.x - view.x,
        y = r.y - view.y;
      ctx.fillStyle = s.backgroundColor;
      ctx.fillRect(x, y, r.width, r.height);
      ctx.fillStyle = s.color;
      ctx.font = s.font;
      ctx.textBaseline = "middle";
      ctx.fillText(tag.textContent ?? "", x + 5, y + r.height / 2, r.width - 7);
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Picture export failed."))), "image/png"),
  );
}
