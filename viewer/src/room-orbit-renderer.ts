import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { doorClearance } from "../../shared/room-geometry.ts";
import { roomPoint, type RoomDimensions, type RoomPoint } from "../../shared/room.ts";
import type { CameraPreset, OrbitCamera, RoomViewLink } from "./room-camera-state.ts";
import type { Drawing, RoomViewCallbacks } from "./room-plan-renderer.ts";
import { roomDirectGrab } from "./room-direct-grab.ts";

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
  private readonly eyeCamera = new THREE.PerspectiveCamera(62,1,.015,2000);
  private eyeActive = false;
  private eyeDirection=new THREE.Vector3(0,0,-1);
  private eyeLook={yaw:0,pitch:0,fov:62};
  private eyeDrag?:{id:number;x:number;y:number;yaw:number;pitch:number};
  private gridVisible = true;
  private readonly controls: OrbitControls;
  private readonly shadow = new THREE.DirectionalLight(0xffffff, 2.3);
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly tags = document.createElement("div");
  private readonly pointer = new THREE.Vector2();
  private readonly ray = new THREE.Raycaster();
  private drawing?: Drawing;
  private lastRoom = "";
  private awaitingFocusedModel = false;
  private pendingOperatorFit?:{id:string;camera:string;preset:CameraPreset};
  private width = 1;
  private height = 1;
  private halfWidth = 4;
  private halfHeight = 4;
  private frame = 0;
  private visible = true;
  private down?: [number,number];
  private grab?: {pointer:number;x:number;y:number;moved:boolean;plan:NonNullable<ReturnType<typeof roomDirectGrab>>};

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
    this.renderer.domElement.addEventListener("pointerdown", e => { if (e.isPrimary && e.button === 0) this.down = [e.clientX,e.clientY]; });
    const canvas=this.renderer.domElement;
    canvas.addEventListener("pointerdown",e=>{
      if (!this.callbacks.onAdjust || !this.drawing?.member || this.eyeActive || this.grab || e.button!==0 ||
          !e.isPrimary || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const hit=this.hit(e);
      const plan=hit && roomDirectGrab(this.drawing,hit,this.camera,this.width,this.height);
      if (!plan) return;
      this.grab={pointer:e.pointerId,x:e.clientX,y:e.clientY,moved:false,plan};
      this.controls.enabled=false;canvas.style.cursor="grabbing";canvas.setPointerCapture(e.pointerId);
    },true);
    canvas.addEventListener("pointermove",e=>{
      const grab=this.grab;
      if (!grab || e.pointerId!==grab.pointer) return;
      const dx=e.clientX-grab.x,dy=e.clientY-grab.y;
      if (!grab.moved && Math.hypot(dx,dy)<4) return;
      grab.moved=true;
      const r=canvas.getBoundingClientRect();
      grab.plan.move(dx,dy,e.clientX-r.left,e.clientY-r.top);
      this.invalidate();
    });
    canvas.addEventListener("pointerdown",e=>{
      if(!this.eyeActive || e.button!==0)return;
      this.eyeDrag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:this.eyeLook.yaw,pitch:this.eyeLook.pitch};canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove",e=>{
      const drag=this.eyeDrag;if(!drag || e.pointerId!==drag.id || !this.eyeActive)return;
      const yaw=drag.yaw-(e.clientX-drag.x)*.004;
      this.eyeLook.yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));
      this.eyeLook.pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,drag.pitch+(e.clientY-drag.y)*.004));
      this.applyEyeLook();
    });
    canvas.addEventListener("wheel",e=>{
      if(!this.eyeActive)return;e.preventDefault();this.eyeLook.fov=Math.max(22,Math.min(95,this.eyeLook.fov+e.deltaY*.035));this.applyEyeLook();
    },{passive:false});
    canvas.addEventListener("pointerup",()=>{this.eyeDrag=undefined;});
    canvas.addEventListener("pointercancel", () => { this.down = undefined; this.eyeDrag=undefined;this.finishGrab(false); });
    canvas.addEventListener("lostpointercapture",e=>{
      if (this.grab?.pointer===e.pointerId) {this.down=undefined;this.finishGrab(false);}
    });
    this.renderer.domElement.addEventListener("pointerup", e => {
      if (!e.isPrimary) return;
      if (this.grab?.pointer===e.pointerId && this.finishGrab(true)) {this.down=undefined;return;}
      if (!this.down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1]); this.down = undefined;
      if (moved > 4 || !this.drawing) return;
      const hit=this.hit(e)?.object;
      for(let node:THREE.Object3D|null|undefined=hit;node;node=node.parent) {
        if(node.userData.roomOperator) { callbacks.onSelect(node.userData.roomOperator,"@operator",e.shiftKey);return; }
      }
      callbacks.onSelect(hit?.userData.roomInstance ?? this.drawing?.focused ?? null, hit?.userData.roomMember, e.shiftKey);
    });
  }

  private hit(e:PointerEvent) {
    this.furniture.updateWorldMatrix(true,true);
    const bounds=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX-bounds.left)/bounds.width*2-1,1-(e.clientY-bounds.top)/bounds.height*2);
    this.ray.setFromCamera(this.pointer,this.eyeActive?this.eyeCamera:this.camera);
    const meshes:THREE.Mesh[]=[];
    const collect=(obj:THREE.Object3D)=>{if(obj instanceof THREE.Mesh)meshes.push(obj);};
    this.furniture.traverseVisible(collect);this.room.traverseVisible(collect);
    return this.ray.intersectObjects<THREE.Mesh>(meshes,false)[0];
  }
  private finishGrab(commit:boolean,scene=this.drawing?.scene) {
    const grab=this.grab;
    if (!grab) return false;
    this.grab=undefined;
    if (!commit) this.down=undefined;
    const {plan}=grab,values=commit && grab.moved ? plan.changes() : {};
    plan.restore(scene);
    this.controls.enabled=!this.eyeActive;
    this.renderer.domElement.style.cursor="";
    if (this.renderer.domElement.hasPointerCapture(grab.pointer)) this.renderer.domElement.releasePointerCapture(grab.pointer);
    this.invalidate();
    if (Object.keys(values).length) this.callbacks.onAdjust?.(plan.instance,values,plan.version);
    return grab.moved;
  }
  show(on: boolean) { if(!on)this.finishGrab(false); this.visible = on; this.host.hidden = !on; if (on) this.invalidate(); }
  update(d: Drawing) {
    if (this.grab && (d.scene.version!==this.grab.plan.version || d.selected!==this.grab.plan.instance || d.member!==this.grab.plan.member)) {
      this.down=undefined;this.finishGrab(false,d.scene);
    }
    const previous=this.drawing;
    const scopeChanged=(previous?.focused??null)!==(d.focused??null);
    const instance=d.scene.instances.find(i=>i.id===d.focused);
    const priorInstance=previous?.scene.instances.find(i=>i.id===d.focused);
    const releaseChanged=!!priorInstance && priorInstance.release!==instance?.release;
    this.drawing = d;
    this.room.visible = !d.focused;
    if(scopeChanged)this.finishGrab(false);
    const key = JSON.stringify(d.scene.room), first = !this.lastRoom;
    if (this.lastRoom !== key) { this.lastRoom = key; this.buildRoom(d.scene.room); }
    for (const model of d.models.values()) {
      if (model.holder.parent !== this.furniture) this.furniture.add(model.holder);
      model.holder.visible=!d.focused || model.id===d.focused;
      model.select(model.id === d.selected ? d.member : null);
    }
    const row = d.scene.instances.find(i => i.id === d.selected), rel = d.releases.find(r => r.id === row?.release);
    clearObjects(this.overlay);
    if (!d.focused && row && rel) {
      const {min,max} = rel.footprint;
      const footprint = [[min[0],min[1]],[max[0],min[1]],[max[0],max[1]],[min[0],max[1]],[min[0],min[1]]];
      this.overlay.add(line(footprint.map(([x,y]) => world(roomPoint(row,[x,y,.016]))),0x13705f));
    }
    if (d.measurement) this.overlay.add(line(d.measurement.points.map(world),0x13705f));
    else if (!d.focused && row && rel && d.scene.instances.every(i=>d.releases.some(r=>r.id===i.release))) {
      const gap = doorClearance(d.scene,row,d.releases);
      const shown = gap.metres > .0005 ? gap : gap.opening;
      this.overlay.add(line(shown.points.map(([x,y]) => world([x,y,.022])),0x13705f));
    }
    const modelReady=!!(d.focused && d.models.has(d.focused));
    if (first || scopeChanged || releaseChanged || (this.awaitingFocusedModel && modelReady)) this.fit();
    else if(instance && priorInstance && (instance.x!==priorInstance.x || instance.y!==priorInstance.y)) {
      const delta=world([instance.x-priorInstance.x,instance.y-priorInstance.y,0]);
      this.camera.position.add(delta);this.controls.target.add(delta);this.controls.update();
    }
    this.awaitingFocusedModel=!!d.focused && !modelReady && (scopeChanged || releaseChanged || this.awaitingFocusedModel);
    this.invalidate();
  }
  resize(w: number,h: number) {
    if (w!==this.width || h!==this.height) this.finishGrab(false);
    this.width=w; this.height=h;
    this.renderer.setSize(w,h,false);
    this.eyeCamera.aspect=w/h; this.eyeCamera.updateProjectionMatrix();
    this.frustum(); this.invalidate();
  }
  private frustum() {
    const ratio = Math.max(.1,this.width/this.height);
    const extent = Math.max(this.halfHeight,this.halfWidth/ratio)*1.12;
    this.camera.top = extent; this.camera.bottom = -extent;
    this.camera.left = -ratio*extent; this.camera.right = ratio*extent;
    this.camera.updateProjectionMatrix();
  }
  cameraState():OrbitCamera {
    return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),zoom:this.camera.zoom,halfWidth:this.halfWidth,halfHeight:this.halfHeight};
  }
  restoreCamera(state:OrbitCamera) {
    this.awaitingFocusedModel=false;this.pendingOperatorFit=undefined;
    this.leaveEye(); this.halfWidth=state.halfWidth;this.halfHeight=state.halfHeight;
    this.camera.position.fromArray(state.position);this.controls.target.fromArray(state.target);this.camera.zoom=state.zoom;
    this.controls.update();this.frustum();this.invalidate();
  }
  showGrid(visible:boolean) {
    this.gridVisible=visible;
    this.room.traverse(o=>{if(o.name==="room-grid")o.visible=visible;});
    this.invalidate();
  }
  operatorReady(id:string) {
    const pending=this.pendingOperatorFit;
    if (!pending || pending.id!==id || this.drawing?.focused!==id)return;
    this.pendingOperatorFit=undefined;
    if(!this.grab && !this.eyeActive && pending.camera===JSON.stringify(this.cameraState()))this.fit(pending.preset);
  }
  lookState(){return {...this.eyeLook};}
  restoreLook(state:NonNullable<RoomViewLink["look"]>) { this.eyeLook={...state};this.applyEyeLook(); }
  private applyEyeLook() {
    const direction=this.eyeDirection, yaw=Math.atan2(direction.x,-direction.z)+this.eyeLook.yaw;
    const pitch=Math.max(-Math.PI/2+.001,Math.min(Math.PI/2-.001,Math.asin(THREE.MathUtils.clamp(direction.y,-1,1))+this.eyeLook.pitch));
    const delta=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    this.eyeCamera.up.set(0,1,0);this.eyeCamera.lookAt(this.eyeCamera.position.clone().add(delta));
    this.eyeCamera.fov=this.eyeLook.fov;this.eyeCamera.updateProjectionMatrix();this.eyeCamera.updateMatrixWorld();this.invalidate();
  }
  eye(from:RoomPoint,to:RoomPoint) {
    this.finishGrab(false);
    const p=world(from),target=world(to);
    if (p.distanceToSquared(target)<1e-12)throw new Error("The operator’s eye and look target coincide.");
    if(!this.eyeActive)this.eyeLook={yaw:0,pitch:0,fov:62};
    this.eyeActive=true;this.controls.enabled=false;
    this.eyeCamera.position.copy(p);this.eyeDirection.copy(target).sub(p).normalize();this.applyEyeLook();
    this.host.dataset.camera="operator";this.invalidate();
  }
  leaveEye() { this.eyeActive=false;this.eyeDrag=undefined;this.controls.enabled=true;delete this.host.dataset.camera;this.invalidate(); }
  fit(preset:CameraPreset="overview") {
    this.finishGrab(false);
    if (!this.drawing) return;
    this.leaveEye();
    this.furniture.updateMatrixWorld(true);
    const { width:w, depth:d, height:h } = this.drawing.scene.room;
    const focus=this.drawing.scene.instances.find(i=>i.id===this.drawing!.focused);
    let bounds:THREE.Box3,waitForOperator=false;
    if (focus) {
      const model=this.drawing.models.get(focus.id);
      bounds=new THREE.Box3();
      if (model) {
        bounds.expandByObject(model.model);
        const operator=model.modelFrame.children.find(o=>o.visible && o.userData.roomOperator===focus.id);
        if(operator) bounds.expandByObject(operator);
        else waitForOperator=this.drawing.scene.person?.host===focus.id;
      }
      // Provide a usable starting frame while this release streams in. Its exact mesh supplies the final fit.
      if(bounds.isEmpty()) {
        const rel=this.drawing.releases.find(r=>r.id===focus.release);
        const radius=rel?Math.max(.15,...rel.footprint.min.map(Math.abs),...rel.footprint.max.map(Math.abs)):1;
        bounds.set(world([focus.x-radius,focus.y+radius,0]),world([focus.x+radius,focus.y-radius,radius*2]));
      }
    } else {
      bounds=new THREE.Box3(new THREE.Vector3(0,0,-d),new THREE.Vector3(w,h,0));
      for (const model of this.drawing.models.values()) bounds.expandByObject(model.model);
    }
    const center = bounds.getCenter(new THREE.Vector3()), longest = bounds.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    const dirs:Record<CameraPreset,RoomPoint>={overview:[.76,.92,1.12],front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,.000001]};
    this.controls.minPolarAngle=.000001;this.controls.maxPolarAngle=Math.PI*.5;
    const assetDirs:Record<CameraPreset,RoomPoint>={overview:[-.74,.55,.6],front:[1,0,0],back:[-1,0,0],left:[0,0,-1],right:[0,0,1],top:[.000001,1,0]};
    const direction=focus?new THREE.Vector3(...assetDirs[preset]).applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(focus.yaw)):new THREE.Vector3(...dirs[preset]);
    this.camera.position.copy(center).addScaledVector(direction.normalize(),longest*1.7);
    this.camera.near = Math.max(.001,longest*.001); this.camera.far = Math.max(100,longest*6);
    this.camera.zoom=1;
    this.controls.update(); this.camera.updateMatrixWorld(true);
    let ex=0,ey=0;
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
      const v = new THREE.Vector3(x,y,z).applyMatrix4(this.camera.matrixWorldInverse);
      ex=Math.max(ex,Math.abs(v.x)); ey=Math.max(ey,Math.abs(v.y));
    }
    this.halfWidth = ex; this.halfHeight = ey;
    this.pendingOperatorFit=focus && waitForOperator ? {id:focus.id,camera:JSON.stringify(this.cameraState()),preset} : undefined;
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
    const grid=new THREE.Group();grid.name="room-grid";grid.visible=this.gridVisible;this.room.add(grid);
    for (let x=step;x<w;x+=step) grid.add(line([world([x,0,.002]),world([x,d,.002])],0xbec7bc));
    for (let y=step;y<d;y+=step) grid.add(line([world([0,y,.002]),world([w,y,.002])],0xbec7bc));
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
      const camera=this.eyeActive?this.eyeCamera:this.camera;
      const {room:r,instances} = this.drawing.scene, cam=camera.position;
      for (const [side,g] of this.wallGroups) {
        g.visible = side === "south" ? cam.z < 0 : side === "north" ? cam.z > -r.depth : side === "west" ? cam.x > 0 : cam.x < r.width;
      }
      this.renderer.render(this.scene,camera);
      const labels = document.createDocumentFragment();
      for (const i of instances) {
        const model = this.drawing.models.get(i.id);
        if (!model || !model.holder.visible) continue;
        const h = model.asset.manifest.totals.bbox.max[2]-model.release.anchor[2];
        const v = world([i.x,i.y,h+.09]).project(camera);
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
    this.finishGrab(false);
    this.visible=false; cancelAnimationFrame(this.frame);
    this.controls.dispose(); clearObjects(this.room); clearObjects(this.overlay);
    this.shadow.shadow.dispose(); this.environment.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.tags.remove();
  }
}
