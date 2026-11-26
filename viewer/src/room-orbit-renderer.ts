import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { doorClearance } from "../../shared/room-geometry.ts";
import { roomPoint, type RoomDimensions, type RoomPoint } from "../../shared/room.ts";
import type { Drawing, RoomViewCallbacks } from "./room-plan-renderer.ts";

const world = ([x,y,z]: RoomPoint) => new THREE.Vector3(x,z,-y);
const unlit = (color: number) => new THREE.LineBasicMaterial({color});
function line(points: THREE.Vector3[], color: number) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), unlit(color));
}
function clearObjects(parent: THREE.Group) {
  parent.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
  parent.clear();
}
function box(group: THREE.Group, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number) {
  if (Math.min(sx,sy,sz) <= 0) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sz, sy), new THREE.MeshStandardMaterial({ color, roughness:.91 }));
  mesh.position.set(x+sx/2,z+sz/2,-y-sy/2);
  mesh.receiveShadow = true;
  group.add(mesh);
}
type Wall = "north" | "east" | "south" | "west";

export class RoomOrbit {
  readonly renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
  private readonly scene = new THREE.Scene();
  private readonly room = new THREE.Group();
  private readonly wallGroups = new Map<Wall,THREE.Group>();
  private readonly furniture = new THREE.Group();
  private readonly overlay = new THREE.Group();
  private readonly camera = new THREE.OrthographicCamera(-1,1,1,-1,.01,2000);
  private readonly controls: OrbitControls;
  private readonly shadow = new THREE.DirectionalLight(0xffffff, 2.3);
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly tags = document.createElement("div");
  private readonly pointer = new THREE.Vector2();
  private readonly ray = new THREE.Raycaster();
  private drawing?: Drawing;
  private lastRoom = "";
  private width = 1;
  private height = 1;
  private halfWidth = 4;
  private halfHeight = 4;
  private frame = 0;
  private visible = true;
  private down?: [number,number];

  constructor(private host: HTMLElement, private callbacks: RoomViewCallbacks) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setClearColor(0xeeeee8);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = .87;
    this.renderer.domElement.setAttribute("aria-label","Orbiting 3D room layout");
    this.tags.className = "rv-orbit-tags";
    host.append(this.renderer.domElement,this.tags);
    this.scene.add(this.room,this.furniture,this.overlay,new THREE.HemisphereLight(0xebf1f3,0x9da697,1.12),this.shadow,this.shadow.target);
    const pmrem = new THREE.PMREMGenerator(this.renderer), studio = new RoomEnvironment();
    this.environment = pmrem.fromScene(studio,.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = .62;
    studio.dispose(); pmrem.dispose();
    this.shadow.castShadow = true;
    this.shadow.shadow.mapSize.set(2048,2048);
    this.shadow.shadow.bias = -.00018;
    this.shadow.shadow.normalBias = .008;
    this.controls = new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.minZoom = .1; this.controls.maxZoom = 30;
    this.controls.maxPolarAngle = Math.PI*.48;
    this.controls.minPolarAngle = .015;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("change", this.invalidate);
    this.camera.position.set(-5,6,7);
    this.controls.update();
    this.renderer.domElement.addEventListener("pointerdown", e => { if (e.button === 0) this.down = [e.clientX,e.clientY]; });
    this.renderer.domElement.addEventListener("pointercancel", () => { this.down = undefined; });
    this.renderer.domElement.addEventListener("pointerup", e => {
      if (!this.down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1]); this.down = undefined;
      if (moved > 4 || !this.drawing) return;
      const bounds = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set((e.clientX-bounds.left)/bounds.width*2-1,1-(e.clientY-bounds.top)/bounds.height*2);
      this.ray.setFromCamera(this.pointer,this.camera);
      const meshes = [...this.drawing.models.values()].flatMap(m => m.parts);
      const hit = this.ray.intersectObjects(meshes,false)[0]?.object;
      callbacks.onSelect(hit?.userData.roomInstance ?? null, hit?.userData.roomMember);
    });
  }

  show(on: boolean) { this.visible = on; this.host.hidden = !on; if (on) this.invalidate(); }
  update(d: Drawing) {
    this.drawing = d;
    const key = JSON.stringify(d.scene.room), first = !this.lastRoom;
    if (this.lastRoom !== key) { this.lastRoom = key; this.buildRoom(d.scene.room); }
    for (const model of d.models.values()) {
      if (model.holder.parent !== this.furniture) this.furniture.add(model.holder);
      model.select(model.id === d.selected ? d.member : null);
    }
    const row = d.scene.instances.find(i => i.id === d.selected), rel = d.releases.find(r => r.id === row?.release);
    clearObjects(this.overlay);
    if (row && rel) {
      const {min,max} = rel.footprint;
      const footprint = [[min[0],min[1]],[max[0],min[1]],[max[0],max[1]],[min[0],max[1]],[min[0],min[1]]];
      this.overlay.add(line(footprint.map(([x,y]) => world(roomPoint(row,[x,y,.016]))),0x13705f));
    }
    if (d.measurement) this.overlay.add(line(d.measurement.points.map(world),0x13705f));
    else if (row && rel && d.scene.instances.every(i=>d.releases.some(r=>r.id===i.release))) {
      const gap = doorClearance(d.scene,row,d.releases);
      const shown = gap.metres > .0005 ? gap : gap.opening;
      this.overlay.add(line(shown.points.map(([x,y]) => world([x,y,.022])),0x13705f));
    }
    if (first) this.fit();
    this.invalidate();
  }
  resize(w: number,h: number) {
    this.width=w; this.height=h;
    this.renderer.setSize(w,h,false);
    this.frustum(); this.invalidate();
  }
  private frustum() {
    const ratio = Math.max(.1,this.width/this.height);
    const extent = Math.max(this.halfHeight,this.halfWidth/ratio)*1.12;
    this.camera.top = extent; this.camera.bottom = -extent;
    this.camera.left = -ratio*extent; this.camera.right = ratio*extent;
    this.camera.updateProjectionMatrix();
  }
  fit() {
    if (!this.drawing) return;
    this.furniture.updateMatrixWorld(true);
    const { width:w, depth:d, height:h } = this.drawing.scene.room;
    const bounds = new THREE.Box3(new THREE.Vector3(0,0,-d),new THREE.Vector3(w,h,0));
    for (const model of this.drawing.models.values()) bounds.expandByObject(model.model);
    const center = bounds.getCenter(new THREE.Vector3()), longest = bounds.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(new THREE.Vector3(.76,.92,1.12).normalize(),longest*1.7);
    this.camera.near = Math.max(.001,longest*.001); this.camera.far = Math.max(100,longest*6);
    this.camera.zoom=1;
    this.controls.update(); this.camera.updateMatrixWorld(true);
    let ex=0,ey=0;
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
      const v = new THREE.Vector3(x,y,z).applyMatrix4(this.camera.matrixWorldInverse);
      ex=Math.max(ex,Math.abs(v.x)); ey=Math.max(ey,Math.abs(v.y));
    }
    this.halfWidth = ex; this.halfHeight = ey;
    this.frustum(); this.invalidate();
  }

  private buildRoom(r: RoomDimensions) {
    clearObjects(this.room); this.wallGroups.clear();
    const {width:w, depth:d, height:h, door, window:win} = r;
    const longest = Math.max(w,d,h);
    // Openings have plan dimensions only. Heights below are cutaway drawing conventions.
    const t = Math.min(.10,Math.min(w,d)*.018), sill=h*.34, head=h*.77, doorHead=h*.82;
    const base = 0xd5d6ce, plaster=0xb8c1bd, trim=0x899b96;
    box(this.room,-t,-t,-.075,w+2*t,d+2*t,.075,base);
    for (const n of ["north","east","south","west"] as const) { const g = new THREE.Group(); this.wallGroups.set(n,g); this.room.add(g); }
    const north = this.wallGroups.get("north")!, east=this.wallGroups.get("east")!, south=this.wallGroups.get("south")!, west=this.wallGroups.get("west")!;
    const horizontal = (g:THREE.Group,a:number,b:number,y:number,z:number,height:number) => box(g,a,y,z,b-a,t,height,plaster);
    horizontal(north,0,win.offset,d,0,h);
    horizontal(north,win.offset+win.width,w,d,0,h);
    horizontal(north,win.offset,win.offset+win.width,d,0,sill);
    horizontal(north,win.offset,win.offset+win.width,d,head,h-head);
    horizontal(south,0,door.offset,-t,0,h);
    horizontal(south,door.offset+door.width,w,-t,0,h);
    horizontal(south,door.offset,door.offset+door.width,-t,doorHead,h-doorHead);
    box(east,w,0,0,t,d,h,plaster); box(west,-t,0,0,t,d,h,plaster);
    const sash=t*.34;
    for (const z of [sill,head-sash]) box(north,win.offset,d,z,win.width,t,sash,trim);
    for (const x of [win.offset,win.offset+win.width/2-sash/2,win.offset+win.width-sash]) box(north,x,d,sill,sash,t,head-sill,trim);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.width,head-sill),new THREE.MeshStandardMaterial({color:0x99bcb4,transparent:true,opacity:.27,roughness:.3,side:THREE.DoubleSide,depthWrite:false}));
    glass.position.set(win.offset+win.width/2,(sill+head)/2,-d-t/2); north.add(glass);
    for (const [a,b] of [[0,door.offset],[door.offset+door.width,w]]) this.room.add(line([world([a,0,.006]),world([b,0,.006])],0x728176));
    this.room.add(line([world([0,0,.006]),world([0,d,.006]),world([w,d,.006]),world([w,0,.006])],0x728176));
    const arc: THREE.Vector3[] = [];
    for (let i=0;i<=32;i++) { const angle=i*Math.PI/64; arc.push(world([door.offset+door.width*Math.cos(angle),door.width*Math.sin(angle),.007])); }
    this.room.add(line(arc,0x9aaa99),line([world([door.offset,0,.008]),arc[arc.length-1]],0x627965));
    const step = Math.max(1,Math.ceil(longest/30));
    for (let x=step;x<w;x+=step) this.room.add(line([world([x,0,.002]),world([x,d,.002])],0xbec7bc));
    for (let y=step;y<d;y+=step) this.room.add(line([world([0,y,.002]),world([w,y,.002])],0xbec7bc));
    this.shadow.target.position.set(w/2,0,-d/2);
    this.shadow.position.copy(this.shadow.target.position).add(new THREE.Vector3(-longest,longest*1.8,longest*.6));
    Object.assign(this.shadow.shadow.camera,{left:-longest,right:longest,top:longest,bottom:-longest,near:.01,far:longest*5});
    this.shadow.shadow.camera.updateProjectionMatrix();
  }
  invalidate = () => {
    if (this.frame || !this.visible) return;
    this.frame = requestAnimationFrame(() => {
      this.frame=0;
      if (!this.visible || !this.drawing) return;
      const {room:r,instances} = this.drawing.scene, cam=this.camera.position;
      for (const [side,g] of this.wallGroups) {
        g.visible = side === "south" ? cam.z < 0 : side === "north" ? cam.z > -r.depth : side === "west" ? cam.x > 0 : cam.x < r.width;
      }
      this.renderer.render(this.scene,this.camera);
      const labels = document.createDocumentFragment();
      for (const i of instances) {
        const model = this.drawing.models.get(i.id);
        if (!model) continue;
        const h = model.asset.manifest.totals.bbox.max[2]-model.release.anchor[2];
        const v = world([i.x,i.y,h+.09]).project(this.camera);
        if (v.z < -1 || v.z > 1) continue;
        const tag=document.createElement("span"); tag.className="rv-orbit-tag"; tag.textContent=i.label;
        tag.dataset.instance=i.id;
        if (this.drawing.selected === i.id) tag.setAttribute("data-active","");
        tag.style.left=((v.x+1)*this.width/2)+"px"; tag.style.top=((1-v.y)*this.height/2)+"px"; labels.append(tag);
      }
      this.tags.replaceChildren(labels);
    });
  };
  dispose() {
    this.visible=false; cancelAnimationFrame(this.frame);
    this.controls.dispose(); clearObjects(this.room); clearObjects(this.overlay);
    this.shadow.shadow.dispose(); this.environment.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.tags.remove();
  }
}
