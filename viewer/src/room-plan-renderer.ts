// A dimensioned, north-up floor drawing in CSS pixels. Its geometry is in room metres.
import { doorClearance, type DoorGap } from "../../shared/room-geometry.ts";
import { roomPoint, type RoomInstance, type RoomPoint, type RoomRelease, type RoomScene } from "../../shared/room.ts";
import type { PlanCamera } from "./room-camera-state.ts";
import type { PlacedAsset } from "./room-assets-renderer.ts";
import type { JointValue } from "../../shared/pose.ts";

type Point = [number, number];
const NS = "http://www.w3.org/2000/svg";
type Attributes = Record<string, string | number>;
function element<K extends keyof SVGElementTagNameMap>(tag: K, a: Attributes = {}, label?: string) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
  if (label !== undefined) e.textContent = label;
  return e;
}
const line = (a: Point, b: Point, cls: string) => element("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls });
const label = (p: Point, text: string, cls: string) => element("text", { x: p[0], y: p[1], class: cls, "text-anchor": "middle", "dominant-baseline": "central" }, text);
const format = (n: number) => n.toFixed(2) + " m";
const path = (d: string, cls: string) => element("path", { d, class: cls });
const meter = (x: number) => Number(x.toFixed(3));

export interface RoomMeasurement { points: [RoomPoint, RoomPoint]; label: string; instances?:[string,string] }
export type RoomPlacement = Pick<RoomInstance, "x" | "y" | "yaw">;
export interface RoomViewCallbacks {
  onFocusChange?(instance:string|null, mode:"plan"|"3d", selected:string|null, member?:string):void;
  onSelect(instanceId: string | null, memberId?: string, additional?: boolean): void;
  onPlace(instanceId: string, placement: RoomPlacement): void;
  onAdjust?(instanceId:string,values:Record<string,JointValue>,version:number):void;
  onError?(message: string): void;
}
export type Lighting = "day" | "lamps";
export interface Drawing {
  focused?:string|null;
  scene: RoomScene; releases: RoomRelease[]; models: Map<string, PlacedAsset>;
  selected: string | null; member: string | null; measurement: RoomMeasurement | null; hiddenParts?: ReadonlySet<string>; colours?:"natural"|"parts"|"evidence";
  /** day: the room's daylight; lamps: the room dimmed and the assets' lamps lit, so their light shows. */
  lighting?: Lighting;
}
type Gesture = { pointer: number; start: Point; local: Point; pan: Point; moved: boolean; rotate: boolean; object?: RoomInstance; member?: string };

let diagramIndex = 0;
export class RoomPlan {
  readonly svg = element("svg", { class: "rv-plan", role: "group", "aria-label": "Dimensioned room plan, north up" });
  private readonly uid = "rv-" + ++diagramIndex;
  private drawing?: Drawing;
  private width = 1;
  private height = 1;
  private scale = 1;
  private origin: Point = [0, 0];
  private zoom = 1;
  private pan: Point = [0, 0];
  private gesture: Gesture | null = null;
  private preview: RoomInstance | null = null;

  constructor(host: HTMLElement, private callbacks: RoomViewCallbacks) {
    host.append(this.svg);
    this.svg.addEventListener("pointerdown", this.down);
    this.svg.addEventListener("pointermove", this.move);
    this.svg.addEventListener("pointerup", this.up);
    this.svg.addEventListener("pointercancel", this.cancel);
    this.svg.addEventListener("wheel", this.wheel, { passive: false });
    this.svg.addEventListener("dblclick", e => { if (!(e.target as Element).closest("[data-instance]")) this.fit(); });
  }

  update(drawing: Drawing) {
    const object = this.gesture?.object;
    if (object) {
      const fresh = drawing.scene.instances.find(i => i.id === object.id);
      if (!fresh || ["release", "x", "y", "yaw"].some(k => fresh[k as keyof RoomInstance] !== object[k as keyof RoomInstance])) this.cancel();
    }
    this.drawing = drawing;
    this.paint();
  }
  resize(width: number, height: number) { this.width = width; this.height = height; this.paint(); }
  fit() { this.zoom = 1; this.pan = [0, 0]; this.paint(); }
  cameraState(): PlanCamera { return { center:this.local([this.width/2,this.height/2]),zoom:this.zoom }; }
  restoreCamera(state:PlanCamera) {
    this.zoom=state.zoom;this.pan=[0,0];this.layout();
    const [x,y]=this.pixel(...state.center);
    this.pan=[this.width/2-x,this.height/2-y];this.paint();
  }
  cancel = () => {
    if (this.gesture && this.svg.hasPointerCapture(this.gesture.pointer)) this.svg.releasePointerCapture(this.gesture.pointer);
    this.gesture = null; this.preview = null; this.svg.classList.remove("rv-dragging"); this.paint();
  };

  private local([x, y]: Point): Point { return [(x - this.origin[0]) / this.scale, (this.origin[1] - y) / this.scale]; }
  private pixel = (x: number, y: number): Point => [this.origin[0] + x * this.scale, this.origin[1] - y * this.scale];
  private pointer = (e: MouseEvent): Point => { const rect = this.svg.getBoundingClientRect(); return [e.clientX - rect.left, e.clientY - rect.top]; };
  private down = (e: PointerEvent) => {
    if ((e.button !== 0 && e.button !== 1) || this.gesture || !this.drawing) return;
    const target = e.target as Element, hit = e.button === 0 ? target.closest<SVGElement>("[data-instance]") : null;
    const object = this.drawing.scene.instances.find(i => i.id === hit?.dataset.instance);
    const p = this.pointer(e), member = target.closest<SVGElement>("[data-member]")?.dataset.member;
    const rotate = !!target.closest("[data-rotate]");
    this.gesture = { pointer: e.pointerId, start: p, local: this.local(p), pan: [...this.pan], moved: false, rotate, object, member };
    this.svg.setPointerCapture(e.pointerId);
    if (object && rotate) this.callbacks.onSelect(object.id);
    e.preventDefault();
  };
  private move = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || g.pointer !== e.pointerId) return;
    const p = this.pointer(e), dx = p[0] - g.start[0], dy = p[1] - g.start[1];
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    g.moved = true; this.svg.classList.add("rv-dragging");
    if (!g.object) this.pan = [g.pan[0] + dx, g.pan[1] + dy];
    else {
      const [px, py] = this.local(p), i = g.object;
      if (g.rotate) {
        const delta = Math.atan2(py - i.y, px - i.x) - Math.atan2(g.local[1] - i.y, g.local[0] - i.x);
        const step = e.shiftKey ? 15 : 1;
        const yaw = ((Math.round((i.yaw + delta * 180 / Math.PI) / step) * step) % 360 + 360) % 360;
        this.preview = { ...i, yaw };
      } else this.preview = { ...i, x: meter(i.x + px - g.local[0]), y: meter(i.y + py - g.local[1]) };
    }
    this.paint();
  };
  private up = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || g.pointer !== e.pointerId) return;
    const preview = this.preview;
    this.cancel();
    if (preview && g.moved) {
      this.callbacks.onSelect(preview.id);
      this.callbacks.onPlace(preview.id, { x: preview.x, y: preview.y, yaw: preview.yaw });
    }
    else if (g.object && !g.moved && !g.rotate) this.callbacks.onSelect(g.object.id, g.member, e.shiftKey);
    else if (!g.object && !g.moved && e.button === 0) this.callbacks.onSelect(null);
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.gesture || !this.drawing) return;
    const p = this.pointer(e), local = this.local(p);
    this.zoom = Math.min(7, Math.max(.35, this.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? .035 : .0015))));
    this.layout();
    const after = this.pixel(...local);
    this.pan = [this.pan[0] + p[0] - after[0], this.pan[1] + p[1] - after[1]];
    this.paint();
  };

  private layout() {
    if (!this.drawing) return;
    const { room, instances } = this.drawing.scene;
    let x0 = 0, y0 = 0, x1 = room.width, y1 = room.depth;
    for (const i of instances) {
      const box = this.drawing.releases.find(r => r.id === i.release)?.footprint;
      if (!box) continue;
      for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) {
        const [wx, wy] = roomPoint(i, [x, y, 0]);
        x0 = Math.min(x0, wx); y0 = Math.min(y0, wy); x1 = Math.max(x1, wx); y1 = Math.max(y1, wy);
      }
    }
    const small = this.width < 550 || this.height < 350;
    const padX = small ? 38 : Math.min(93, this.width * .085);
    const padY = small ? 47 : Math.min(86, this.height * .12);
    this.scale = Math.max(1, Math.min((this.width - padX * 2) / (x1 - x0), (this.height - padY * 2) / (y1 - y0))) * this.zoom;
    this.origin = [this.width / 2 - (x0 + x1) * .5 * this.scale + this.pan[0], this.height / 2 + (y0 + y1) * .5 * this.scale + this.pan[1]];
  }

  private paint() {
    if (!this.drawing || this.width <= 1 || this.height <= 1) return;
    const { scene, releases, models, selected, member } = this.drawing;
    this.layout();
    const { room } = scene, { width: w, depth: d, door, window: win } = room, s = this.scale, P = this.pixel;
    const [left, bottom] = P(0, 0), [right, top] = P(w, d);
    const content = document.createDocumentFragment();
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute("data-scale", String(s));
    const defs = element("defs"), step = s >= 32 ? .5 : s >= 14 ? 1 : 5;
    const grid = element("pattern", { id: this.uid + "-grid", width: step * 2 * s, height: step * 2 * s, x: left, y: bottom, patternUnits: "userSpaceOnUse" });
    const minor = step * s, major = 2 * minor;
    grid.append(path(`M${minor} 0V${major}M0 ${minor}H${major}`, "rv-minor"), path(`M0 ${major}V0H${major}`, "rv-major"));
    defs.append(grid); content.append(defs);
    const floor = { x: left, y: top, width: w * s, height: d * s };
    content.append(element("rect", { ...floor, class: "rv-floor" }), element("rect", { ...floor, fill: `url(#${this.uid}-grid)` }));

    const wall = (x: number, y: number, tx: number, ty: number) => line(P(x,y), P(tx,ty), "rv-wall");
    content.append(wall(0, 0, 0, d), wall(w, 0, w, d), wall(0,d,win.offset,d), wall(win.offset + win.width,d,w,d),
      wall(0,0,door.offset,0), wall(door.offset + door.width,0,w,0));
    const [wx, wy] = P(win.offset, d), ww = win.width * s;
    content.append(element("rect", { x: wx, y: wy - 3, width: ww, height: 6, class: "rv-window" }),
      line([wx,wy], [wx+ww,wy], "rv-window-mid"), line([wx+ww/2,wy-3], [wx+ww/2,wy+3], "rv-window-mid"));
    const [dx, dy] = P(door.offset, 0), dw = door.width * s;
    content.append(path(`M ${dx+dw} ${dy} A ${dw} ${dw} 0 0 0 ${dx} ${dy-dw}`, "rv-swing"),
      line([dx,dy], [dx,dy-dw], "rv-leaf"), line([dx,dy], [dx+dw,dy], "rv-threshold"));
    content.append(this.dimension([left, top], [right, top], -29, format(w)),
      this.dimension([left, top], [left, bottom], -29, format(d), true));
    if (ww > 60) content.append(label([wx + ww/2, wy + 15], "Window", "rv-feature"));
    if (dw > 22) {
      const entry = label([dx+dw/2,dy+19], "Door", "rv-feature");
      entry.append(element("title", {}, "South doorway · " + format(door.width))); content.append(entry);
    }
    if (!scene.instances.length) {
      const mid = P(w/2, d/2);
      content.append(label([mid[0],mid[1]-9], "FLOOR AREA", "rv-area-title"),
        label([mid[0],mid[1]+12], Math.round(w*d*100)/100 + " m²", "rv-area"));
    }
    const labels = element("g"), handles = element("g");
    const instances = scene.instances.map(i => i.id === this.preview?.id ? this.preview : i);
    for (const i of instances) {
      const rel = releases.find(r => r.id === i.release);
      if (!rel) continue;
      const { min, max } = rel.footprint, [cx,cy] = P(i.x,i.y);
      const sel = i.id === selected, group = element("g", { "data-instance": i.id, role: "button", "aria-label": i.label, class: "rv-object",
        transform: `translate(${cx},${cy}) scale(${s},${-s}) rotate(${i.yaw})` });
      group.append(element("title", {}, i.label + " · " + rel.label));
      group.append(element("rect", { x: min[0], y: min[1], width: max[0]-min[0], height: max[1]-min[1], class: "rv-footprint" }));
      const model = models.get(i.id);
      if (model && model.release.id === i.release) {
        for (const p of model.planParts) {
          if (p.path && (!this.drawing.hiddenParts || model.partVisible(p.id,this.drawing.hiddenParts))) group.append(element("path", { d: p.path, fill: model.displayColour(p.id,this.drawing.colours??"natural")??p.fill, class: sel && member === p.id ? "rv-part rv-chosen" : "rv-part", "data-member": p.id }));
        }
      } else group.append(element("rect", { x:min[0], y:min[1], width:max[0]-min[0], height:max[1]-min[1], class: "rv-loading-shape" }));
      const corners = [roomPoint(i, [min[0],min[1],0]), roomPoint(i, [min[0],max[1],0]), roomPoint(i, [max[0],min[1],0]), roomPoint(i, [max[0],max[1],0])];
      const labelX = (Math.min(...corners.map(p => p[0]))+Math.max(...corners.map(p => p[0])))/2;
      let labelY = P(labelX, Math.min(...corners.map(p => p[1])))[1] + 14;
      if (labelY > this.height-20) labelY = P(labelX, Math.max(...corners.map(p => p[1])))[1]-15;
      const name = label([P(labelX,0)[0],labelY], i.label, sel ? "rv-object-label rv-active-label" : "rv-object-label");
      name.setAttribute("data-instance", i.id);
      name.dataset.above = String(P(labelX,Math.max(...corners.map(p=>p[1])))[1]-14);
      if (scene.person?.host === i.id) {
        const marker=element("g",{"data-instance":i.id});
        const person=element("g",{"data-member":"@operator","aria-label":"Operator controls for "+i.label,
          role:"button",tabindex:0,class:"rv-operator-marker",transform:`translate(${P(labelX,0)[0]},${labelY-16})`});
        person.append(element("title",{},"Operator controls for "+i.label),
          element("circle",{r:8,fill:"var(--rv-floor)",stroke:"var(--rv-teal)"}),
          element("circle",{cx:0,cy:-2.8,r:2.1,fill:"var(--rv-teal)"}),
          element("path",{d:"M-4 4C-4 0 4 0 4 4",fill:"none",stroke:"var(--rv-teal)","stroke-width":1.3}));
        person.addEventListener("keydown",e=>{
          if (e.key==="Enter" || e.key===" ") {e.preventDefault();this.callbacks.onSelect(i.id,"@operator",e.shiftKey);}
        });
        marker.append(person);handles.append(marker);
      }
      labels.append(name);
      if (sel) {
        const gap = 4/s, handle = 21/s, mid = (min[0]+max[0])/2;
        group.append(element("rect", { x:min[0]-gap,y:min[1]-gap,width:max[0]-min[0]+2*gap,height:max[1]-min[1]+2*gap,class:"rv-selected-bounds" }),
          line([mid,max[1]+gap],[mid,max[1]+handle],"rv-stem"));
        // Keep a large transparent hit target on touch without covering a visible component.
        const grip = element("g", { "data-rotate": i.id, class: "rv-rotation", role: "button", "aria-label": "Rotate " + i.label });
        grip.append(element("circle", {cx:mid,cy:max[1]+handle,r:12/s,fill:"transparent"}), element("circle", {cx:mid,cy:max[1]+handle,r:4.2/s,class:"rv-handle"}),
          element("title", {}, "Drag to rotate. Hold Shift for 15° steps."));
        const topHandle=element("g", { "data-instance":i.id, transform:group.getAttribute("transform")! });
        topHandle.append(grip);
        handles.append(topHandle);
      }
      content.append(group);
    }
    const active = instances.find(i => i.id === selected);
    const measurement = this.drawing.measurement;
    if (measurement && !this.preview) content.append(this.measured(measurement.points.map(p => P(p[0],p[1])) as [Point,Point], measurement.label));
    else if (active && instances.every(i => releases.some(r => r.id === i.release))) {
      const gap = doorClearance({ ...scene, instances }, active, releases);
      const draw = (gap: DoorGap, caption: string) => this.measured(gap.points.map(([x,y]) => P(x,y)) as [Point,Point], caption, gap.edges);
      if (gap.metres > .0005) content.append(draw(gap, format(gap.metres) + " to door"));
      else content.append(draw(gap.opening, format(gap.opening.metres) + " clear opening"));
    }
    content.append(labels, handles, this.legend());
    this.svg.replaceChildren(content);
    this.arrangeNames(labels);
  }

  private arrangeNames(labels: SVGGElement) {
    // Keep the actual font's extents, endpoint marks and measuring line legible at any fit or zoom.
    const origin=this.svg.getBoundingClientRect();
    const reserved = [...this.svg.querySelectorAll<SVGGraphicsElement>(".rv-measure-label,.rv-endpoint,.rv-feature,.rv-handle")].map(e=>{
      const b=e.getBoundingClientRect(); return new DOMRect(b.left-origin.left,b.top-origin.top,b.width,b.height);
    });
    const ruler = this.svg.querySelector<SVGLineElement>(".rv-measure-line");
    const crossesRuler = (r: DOMRect) => {
      if (!ruler) return false;
      const x1=ruler.x1.baseVal.value,y1=ruler.y1.baseVal.value,x2=ruler.x2.baseVal.value,y2=ruler.y2.baseVal.value;
      if (Math.max(x1,x2)<r.left || Math.min(x1,x2)>r.right || Math.max(y1,y2)<r.top || Math.min(y1,y2)>r.bottom) return false;
      const side=(x:number,y:number)=>(x2-x1)*(y-y1)-(y2-y1)*(x-x1);
      const corners=[side(r.left,r.top),side(r.left,r.bottom),side(r.right,r.top),side(r.right,r.bottom)];
      return Math.min(...corners)<=0 && Math.max(...corners)>=0;
    };
    for (const name of labels.querySelectorAll("text")) {
      const b=name.getBBox(),x=name.x.baseVal[0].value,y=name.y.baseVal[0].value;
      const above=Number(name.dataset.above)-y, side=Math.min(36,b.width*.35);
      const candidates:Point[]=[[0,0],[0,above],[side,0],[-side,0],[side,above],[-side,above]];
      let placed=false;
      for (const [dx,dy] of candidates) {
        const r=new DOMRect(b.x+dx-3,b.y+dy-3,b.width+6,b.height+6);
        if (r.left<1 || r.right>this.width-1 || r.top<1 || r.bottom>this.height-1 || crossesRuler(r)) continue;
        if (reserved.some(o=>r.left<o.right && r.right>o.left && r.top<o.bottom && r.bottom>o.top)) continue;
        name.setAttribute("x",String(x+dx)); name.setAttribute("y",String(y+dy));
        reserved.push(r); placed=true; break;
      }
      if (!placed) name.remove();
    }
  }

  private dimension(a: Point, b: Point, offset: number, text: string, vertical = false) {
    const g = element("g", {class:"rv-dimension"});
    const move = (p: Point, delta: number): Point => vertical ? [p[0]+delta,p[1]] : [p[0],p[1]+delta];
    const start = move(a,offset), end = move(b,offset);
    const mid: Point = [(start[0]+end[0])/2,(start[1]+end[1])/2];
    g.append(line(start,end,"rv-dim-line"));
    for (const p of [a,b]) {
      const [x,y] = move(p,offset);
      g.append(line(move(p,-8),move(p,offset-5),"rv-extension"),line([x-3,y+4],[x+3,y-4],"rv-dim-line"));
    }
    const t = label(mid, text, "rv-dim-label");
    if (vertical) t.setAttribute("transform", `rotate(-90 ${mid[0]} ${mid[1]})`);
    g.append(t);
    return g;
  }

  private measured([a,b]: [Point,Point], text: string, edges: string[] = []) {
    const g = element("g", { class: "rv-measure", "data-edges": edges.join(" "), "aria-label": text });
    g.append(element("title", {}, [text, ...edges].join(" · ")), line(a,b,"rv-measure-line"));
    for (const p of [a,b]) g.append(element("circle", {cx:p[0],cy:p[1],r:3,class:"rv-endpoint"}));
    const mid: Point = [(a[0]+b[0])/2,(a[1]+b[1])/2-10];
    g.append(label(mid,text,"rv-measure-label"));
    return g;
  }

  private legend() {
    const g = element("g", {class:"rv-legend"});
    const m = [0.01,.02,.05,.1,.2,.5,1,2,5,10,20,50,100].reduce((best,n) => n*this.scale<93 ? n : best,.01);
    const length = m*this.scale, x = 20, y = this.height-19;
    g.append(path(`M${x},${y-4}v4h${length}v-4`, "rv-scale"), label([x+length/2,y-10],m+" m","rv-scale-label"));
    const nx = this.width-25, ny = this.height-27;
    g.append(path(`M${nx},${ny-2}l-3,9l3,-2l3,2z`, "rv-north"),label([nx,ny-10],"N","rv-scale-label"));
    return g;
  }
}
