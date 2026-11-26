// A preview changes only the grabbed placement's rendered joint transforms.
// The room writer receives the changed values once, at pointer release.
import type { Camera, Intersection, Mesh, Object3D } from "three";
import { poseFromRest, type JointValue } from "../../shared/pose.ts";
import { adjWords } from "../../shared/words.ts";
import { projectedGrab, type GrabAxis, type GrabJoint } from "./direct-grab.ts";
import type { Drawing } from "./room-plan-renderer.ts";

export function roomDirectGrab(d:Drawing,hit:Intersection<Mesh>,camera:Camera,width:number,height:number) {
  const instance=d.scene.instances.find(i=>i.id===d.selected);
  const model=instance && d.models.get(instance.id);
  if (!model || !instance || !d.member || hit.object.userData.roomInstance!==model.id) return null;
  const member=model.release.members.find(m=>m.id===d.member);
  if (!member?.controls?.length) return null;
  const allowed=new Set(member.controls),chain:GrabJoint<GrabAxis>[]=[];
  const states=new Map<string,{initial:JointValue;value:JointValue;neutral:JointValue;show:(v:JointValue)=>void}>();
  const selectedNode=model.objects.get(member.id);
  let within=false;
  for (let ancestor:Object3D|null=hit.object;ancestor;ancestor=ancestor.parent) {
    if (ancestor===selectedNode) within=true;
    const id=String(ancestor.userData.id),rest=model.rest.get(id);
    if (!allowed.has(id) || !rest) continue;
    const joint=model.asset.manifest.joints.find(j=>j.id===id),control=model.release.joints.find(j=>j.id===id);
    if (!joint || !control || (control.locked && !control.assumed)) continue;
    const initial=instance.pose[id] ?? joint.neutral,node=ancestor;
    const state={initial,value:initial,neutral:joint.neutral,show(v:JointValue) {
      const trs=poseFromRest(rest,joint,v);
      node.position.fromArray(trs.t);node.quaternion.fromArray(trs.q);
      node.updateWorldMatrix(true,true);
    }};
    states.set(id,state);
    const axes=adjWords(joint).filter(w=>!w.fine).map(({comp})=>{
      const offset=comp===null ? 0 : (joint.neutral as number[])[comp];
      return {
        lo:offset+joint.lower,hi:offset+joint.upper,
        value:()=>comp===null ? state.value as number : (state.value as number[])[comp],
        trial:(n:number)=>{
          state.value=comp===null ? n : (state.value as number[]).map((v,i)=>i===comp ? n : v);
          state.show(state.value);
        },
      };
    });
    chain.push({child:joint.child,slide:joint.type==="prismatic",axes});
  }
  if (!within || !chain.length) return null;
  const plan=projectedGrab(hit.object,hit.point,camera,width,height,chain,4);
  if (!plan) return null;
  let axes:GrabAxis[]|undefined;
  return {
    instance:instance.id,member:member.id,version:d.scene.version,
    move(dx:number,dy:number,x:number,y:number) {axes??=plan.choose(dx,dy);plan.follow(axes,x,y);},
    changes() {
      const changed:Record<string,JointValue>={};
      for(const [id,{value:v,initial}] of states) {
        const dirty=Array.isArray(v) ? v.some((n,i)=>Math.abs(n-(initial as number[])[i])>1e-7) : Math.abs(v-(initial as number))>1e-7;
        if (dirty) changed[id]=v;
      }
      return changed;
    },
    restore(scene=d.scene) {
      const item=scene.instances.find(i=>i.id===instance.id && i.release===instance.release);
      if (item) for (const [id,state] of states) state.show(item.pose[id] ?? state.neutral);
    },
  };
}
