// One parsed file per installed pin. Model nodes and materials belong to placements; geometry and textures belong to the file.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { nodesFromGlb, type KNode } from "../../shared/kinematics.ts";
import type { Manifest } from "../../shared/manifest.ts";
import { poseFromRest, type JointValue, type Trs } from "../../shared/pose.ts";
import type { RoomInstance, RoomRelease } from "../../shared/room.ts";

export interface RoomAsset { source: THREE.Group; manifest: Manifest; nodes: KNode[] }
export interface PlanPart { id: string; path: string; fill: string; top: number }

export async function loadRoomAsset(release: RoomRelease): Promise<RoomAsset> {
  const [model, description] = await Promise.all([fetch(release.modelUrl), fetch(release.manifestUrl)]);
  if (!model.ok || !description.ok) throw new Error(`Cannot load ${release.label} ${release.version} (${model.status}/${description.status}).`);
  const [data, manifest]: [ArrayBuffer, Manifest] = await Promise.all([model.arrayBuffer(), description.json()]);
  if (crypto.subtle) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== manifest.glb.sha256) throw new Error(`Geometry and manifest disagree for ${release.label} ${release.version}.`);
  }
  const parsed = await new GLTFLoader().parseAsync(data, new URL(".", new URL(release.modelUrl, location.href)).href);
  return { source: parsed.scene, manifest, nodes: nodesFromGlb(new Uint8Array(data)) };
}

export function disposeRoomAsset(asset: RoomAsset) {
  const materials = new Set<THREE.Material>(), geometry = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>();
  asset.source.traverse(o => {
    if (o instanceof THREE.Mesh) {
      geometry.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) materials.add(mat);
    }
  });
  for (const mat of materials) {
    for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
    mat.dispose();
  }
  for (const g of geometry) g.dispose();
  for (const t of textures) t.dispose();
}

// Project the visible sides of the actual triangles. Adjacent triangles with opposite
// directed edges cancel. The remaining contours preserve concavities, holes and separate
// solids in a mesh primitive. Nonzero winding fills overlapping surfaces on the drawing.
function planProjection(mesh: THREE.Mesh, matrix: THREE.Matrix4): {path:string; top:number} {
  const xyz = mesh.geometry.attributes.position, index = mesh.geometry.index;
  const v = new THREE.Vector3(), xs = new Float64Array(xyz.count), ys = new Float64Array(xyz.count);
  const keys: string[] = [], coordinates = new Map<string,string>();
  let top = -Infinity;
  for (let i=0;i<xyz.count;i++) {
    v.fromBufferAttribute(xyz,i).applyMatrix4(matrix);
    xs[i]=v.x; ys[i]=-v.z; top=Math.max(top,v.y);
    const key=Math.round(v.x*1e6)+","+Math.round(-v.z*1e6);
    keys.push(key);
    coordinates.set(key,v.x.toFixed(4)+","+(-v.z).toFixed(4));
  }
  const edges=new Map<string,Map<string,number>>();
  const consume=(from:string,to:string) => {
    const next=edges.get(from)!, count=next.get(to)!;
    if (count===1) { next.delete(to); if (!next.size) edges.delete(from); }
    else next.set(to,count-1);
  };
  const edge=(from:string,to:string) => {
    if (from===to) return;
    if (edges.get(to)?.has(from)) { consume(to,from); return; }
    let next=edges.get(from);
    if (!next) edges.set(from,next=new Map());
    next.set(to,(next.get(to) ?? 0)+1);
  };
  for (let i=0;i<(index?.count ?? xyz.count);i+=3) {
    const a=index?index.getX(i):i, b=index?index.getX(i+1):i+1, c=index?index.getX(i+2):i+2;
    if ((xs[b]-xs[a])*(ys[c]-ys[a])-(ys[b]-ys[a])*(xs[c]-xs[a])<=1e-11) continue;
    edge(keys[a],keys[b]); edge(keys[b],keys[c]); edge(keys[c],keys[a]);
  }
  const paths:string[]=[];
  while (edges.size) {
    const first=edges.keys().next().value!;
    let from=first;
    const points=[coordinates.get(first)!];
    do {
      const to=edges.get(from)?.keys().next().value;
      if (to===undefined) break;
      consume(from,to); from=to;
      if (from!==first) points.push(coordinates.get(from)!);
    } while (from!==first);
    if (points.length>=3) paths.push("M"+points.join("L")+"Z");
  }
  return {path:paths.join(""),top};
}

export class PlacedAsset {
  readonly holder = new THREE.Group();
  readonly modelFrame = new THREE.Group();
  readonly model: THREE.Group;
  readonly parts: THREE.Mesh[] = [];
  readonly objects = new Map<string, THREE.Object3D>();
  readonly rest = new Map<string, Trs>();
  planParts: PlanPart[] = [];
  private poseKey?: string;
  private planKey?: string;
  private projections=new Map<THREE.Mesh,{matrix:THREE.Matrix4;part:PlanPart}>();

  constructor(readonly asset: RoomAsset, readonly release: RoomRelease, readonly id: string) {
    this.model = asset.source.clone(true);
    this.holder.name = id;
    this.holder.add(this.modelFrame);
    this.modelFrame.add(this.model);
    const [x, y, z] = release.anchor;
    this.modelFrame.position.set(-x, -z, y);
    this.model.traverse(o => {
      if (o.userData.id) this.objects.set(o.userData.id, o);
      if (!(o instanceof THREE.Mesh)) return;
      let member: THREE.Object3D | null = o;
      while (member && !["component", "surface"].includes(member.userData.kind)) member = member.parent;
      o.userData.roomMember = member?.userData.id ?? o.name;
      o.userData.roomInstance = id;
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      o.castShadow = true;
      o.receiveShadow = true;
      this.parts.push(o);
    });
    for (const j of asset.manifest.joints) {
      const o = this.objects.get(j.id);
      if (o) this.rest.set(j.id, { t: o.position.toArray(), q: o.quaternion.toArray() });
    }
  }

  apply(i: RoomInstance,project=true) {
    this.holder.position.set(i.x, 0, -i.y);
    this.holder.rotation.y = THREE.MathUtils.degToRad(i.yaw);
    const nextPose = JSON.stringify(i.pose);
    if (this.poseKey !== nextPose) {
      this.poseKey = nextPose;
      this.pose(i.pose);
    }
    if (project && this.planKey!==nextPose) {
      this.planParts=this.plan();
      this.planKey=nextPose;
    }
  }

  private pose(values: Record<string, JointValue>) {
    for (const joint of this.asset.manifest.joints) {
      const o = this.objects.get(joint.id), rest = this.rest.get(joint.id);
      if (!o || !rest) continue;
      const trs = values[joint.id] === undefined ? rest : poseFromRest(rest, joint, values[joint.id]);
      o.position.fromArray(trs.t);
      o.quaternion.fromArray(trs.q);
    }
  }

  private plan(): PlanPart[] {
    this.holder.updateWorldMatrix(true, true);
    const inverse = this.holder.matrixWorld.clone().invert(), mat = new THREE.Matrix4();
    return this.parts.map(mesh => {
      mat.multiplyMatrices(inverse, mesh.matrixWorld);
      const cached=this.projections.get(mesh);
      if (cached?.matrix.equals(mat)) return cached.part;
      const projected = planProjection(mesh,mat);
      const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const color = source.color?.clone();
      if (source.userData.roomBaseColour!==undefined) color?.setHex(source.userData.roomBaseColour);
      color?.convertLinearToSRGB();
      const light = color ? Math.round(40 + (color.r * .25 + color.g * .65 + color.b * .1) * 44) : 70;
      const part = {
        id: String(mesh.userData.roomMember), ...projected,
        fill: `hsl(143,9%,${light}%)`,
      };
      this.projections.set(mesh,{matrix:mat.clone(),part});
      return part;
    }).sort((a, b) => a.top - b.top);
  }

  partVisible(member:string,hidden:ReadonlySet<string>) {
    for(let node=this.objects.get(member);node;node=node.parent??undefined)
      if(hidden.has(this.id+"/"+node.userData.id))return false;
    return !hidden.has(this.id+"/"+member);
  }
  displayColour(member:string,mode:"natural"|"parts"|"evidence"):string|undefined {
    if(mode==="natural")return;
    if(mode==="evidence") {
      const cls=this.asset.manifest.components.find(n=>n.id===member)?.class;
      const colours:Record<string,string>={measured:"#2e9e5b",vendor:"#2f7fd1",photo:"#e0a526",assumed:"#d9603b",invented:"#9a55c4"};
      return colours[cls??""]??"#8a8f98";
    }
    let value=0;
    for(const c of member)value=(value*31+c.charCodeAt(0))>>>0;
    return "hsl("+(value%360)+",52%,58%)";
  }
  applyDisplay(hidden:ReadonlySet<string>,mode:"natural"|"parts"|"evidence") {
    for(const mesh of this.parts) {
      const member=mesh.userData.roomMember;
      mesh.visible=this.partVisible(member,hidden);
      const colour=this.displayColour(member,mode);
      for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material]) if(mat instanceof THREE.MeshStandardMaterial) {
        const neutral=mat.userData.roomBaseColour??=mat.color.getHex();
        if(colour)mat.color.setStyle(colour);else mat.color.setHex(neutral);
      }
    }
  }
  select(member: string | null) {
    const target = member ? this.objects.get(member) : null;
    for (const mesh of this.parts) {
      let node: THREE.Object3D | null = mesh;
      while (node && node !== target) node = node.parent;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m instanceof THREE.MeshStandardMaterial) {
          const original = m.userData.roomBaseEmissive ??= m.emissive.getHex();
          m.emissive.setHex(node && target ? 0x176b58 : original);
        }
      }
    }
  }

  dispose() {
    this.holder.removeFromParent();
    for (const mesh of this.parts) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  }
}
