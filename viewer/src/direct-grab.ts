// Project joint motion onto the current camera so a grabbed point follows the pointer.
// The station viewer and every placed room asset supply their own joint values and transforms.
import { Vector3, type Camera, type Mesh } from "three";

export interface GrabAxis {
  lo:number; hi:number;
  value():number;
  trial(value:number):void;
}
export interface GrabJoint<A extends GrabAxis> { child:string; slide:boolean; axes:A[] }

export function projectedGrab<A extends GrabAxis>(
  mesh:Mesh,world:Vector3,camera:Camera,width:number,height:number,chain:GrabJoint<A>[],minimumTravel=12,
) {
  const local=mesh.worldToLocal(world.clone());
  const currentPoint=()=>local.clone().applyMatrix4(mesh.matrixWorld);
  function project(point:Vector3) {
    const v=point.clone().project(camera);
    return [(v.x+1)*width/2,(1-v.y)*height/2] as const;
  }
  function motion(axis:A) {
    const v=axis.value(),step=v+.001<=axis.hi ? .001 : -.001;
    const start=currentPoint(),a=project(start);
    axis.trial(v+step);
    const end=currentPoint(),b=project(end);
    axis.trial(v);
    return {x:(b[0]-a[0])/step,y:(b[1]-a[1])/step,metres:start.distanceTo(end)/Math.abs(step)};
  }
  function visibleTravel(axis:A) {
    const delta=motion(axis),pixels=Math.hypot(delta.x,delta.y);
    const origin=currentPoint(),side=new Vector3().setFromMatrixColumn(camera.matrixWorld,0);
    const a=project(origin),b=project(origin.addScaledVector(side,.01));
    const pixelsPerMetre=Math.hypot(a[0]-b[0],a[1]-b[1])/.01;
    return delta.metres>1e-6 && pixels>=.3*delta.metres*pixelsPerMetre && pixels*(axis.hi-axis.lo)>=minimumTravel;
  }
  const slides=chain.filter(j=>j.slide).flatMap(j=>j.axes).filter(visibleTravel);
  const groups=new Map<string,GrabJoint<A>[]>();
  for (const joint of chain) {
    const group=groups.get(joint.child);
    if (group) group.push(joint); else groups.set(joint.child,[joint]);
  }
  let hinges:A[]=[];
  for (const group of groups.values()) {
    if (group.some(j=>j.slide)) break;
    hinges=group.flatMap(j=>j.axes).filter(visibleTravel).slice(0,2);
    if (hinges.length) break;
  }
  if (!hinges.length && !slides.length) return null;

  function choose(dx:number,dy:number) {
    function alignment(axis:A) {
      const v=motion(axis),len=Math.hypot(v.x,v.y)*Math.hypot(dx,dy);
      return len ? Math.abs(dx*v.x+dy*v.y)/len : 0;
    }
    let best=-1,slide:A|undefined;
    for (const axis of slides) {
      const score=alignment(axis);
      if (score>best) {best=score;slide=axis;}
    }
    if (!slide) return hinges;
    if (!hinges.length) return [slide];
    if (hinges.length===2) return best>=.8 ? [slide] : hinges;
    const hinge=alignment(hinges[0]);
    return hinge>=.8 || hinge>=best ? hinges : [slide];
  }

  function follow(axes:A[],x:number,y:number) {
    const stopped=new Set<number>();
    for(let n=0;n<4;n++) {
      const p=project(currentPoint()),dx=x-p[0],dy=y-p[1];
      if (Math.hypot(dx,dy)<.3) break;
      const free=axes.map((_,i)=>i).filter(i=>!stopped.has(i));
      if (!free.length) break;
      const slopes=axes.map(motion);
      const one=(i:number)=>{
        const v=slopes[i],square=v.x*v.x+v.y*v.y;
        return square>1 ? (dx*v.x+dy*v.y)/square : 0;
      };
      const changes=axes.map(()=>0);
      if(free.length===1) changes[free[0]]=one(free[0]);
      else {
        const [a,b]=slopes,det=a.x*b.y-b.x*a.y;
        if (Math.abs(det)>.05*Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y)) {
          changes[0]=(dx*b.y-b.x*dy)/det;changes[1]=(a.x*dy-dx*a.y)/det;
        } else {changes[0]=one(0)/2;changes[1]=one(1)/2;}
      }
      for(const i of free) {
        const axis=axes[i],half=(axis.hi-axis.lo)/2;
        const wanted=axis.value()+Math.max(-half,Math.min(half,changes[i]));
        const v=Math.max(axis.lo,Math.min(axis.hi,wanted));
        if(wanted!==v)stopped.add(i);
        axis.trial(v);
      }
    }
  }
  return {choose,follow};
}
