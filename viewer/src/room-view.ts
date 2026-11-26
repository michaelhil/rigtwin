// Local camera and selection never write to the room. A pointer gesture commits one placement through the caller's scene writer.
import { disposeRoomAsset, loadRoomAsset, PlacedAsset, type RoomAsset } from "./room-assets-renderer.ts";
import { RoomPlan, type Drawing, type RoomMeasurement, type RoomViewCallbacks } from "./room-plan-renderer.ts";
import type { RoomOrbit } from "./room-orbit-renderer.ts";
import type { RoomAvatar } from "./room-person-renderer.ts";
import type { CameraPreset, RoomViewLink } from "./room-camera-state.ts";
import type { RoomInstance, RoomPoint, RoomRelease, RoomScene } from "../../shared/room.ts";
import type { JointValue } from "../../shared/pose.ts";

export type { RoomMeasurement, RoomPlacement, RoomViewCallbacks } from "./room-plan-renderer.ts";
export type RoomViewMode = "plan" | "3d";
export function mountRoomView(host: HTMLElement, callbacks: RoomViewCallbacks) {
  const stage = document.createElement("div"); stage.className="rv-stage rv-no-labels";
  const orbitHost=document.createElement("div"); orbitHost.className="rv-orbit"; orbitHost.hidden=true;
  const status=document.createElement("div"); status.className="rv-status"; status.setAttribute("role","status"); status.hidden=true;
  host.append(stage);
  const plan=new RoomPlan(stage,callbacks);
  stage.append(orbitHost,status);
  const assets=new Map<string,RoomAsset>(), fetching=new Set<string>(), failures=new Map<string,string>();
  const models=new Map<string,PlacedAsset>();
  let posePreview:{instance:string;values:Record<string,JointValue>}|undefined;
  let poseFrame=0;
  let boundPreview=false;
  function applyPose(model:PlacedAsset,instance:RoomInstance) {
    const values=posePreview?.instance===instance.id ? posePreview.values : undefined;
    const posed=values ? {...instance,pose:{...instance.pose,...values}} : instance;
    model.apply(posed,mode==="plan");
    return posed;
  }
  function paintPoses(previewOnly=false) {
    if (!scene || disposed) return;
    for (const item of scene.instances) {
      const model=models.get(item.id);
      if (!model) continue;
      const posed=applyPose(model,item);
      if (scene.person?.host===item.id && (posed!==item || boundPreview)) {
        if (mode==="3d" && !loadingPerson) person?.previewPose(model,posed,scene.person);
        boundPreview=posed!==item;
      }
    }
    if (previewOnly && mode==="3d") orbit?.invalidate();
    else paint();
  }
  function schedulePose() {
    if (!poseFrame && !disposed) poseFrame=requestAnimationFrame(()=>{poseFrame=0;paintPoses(true);});
  }
  let scene:RoomScene | undefined, releases:RoomRelease[]=[];
  const hiddenParts = new Set<string>();
  let grid=true, labels=false, eye=false;
  let colours:"natural"|"parts"|"evidence"="natural";
  const cameraChanged=()=>stage.dispatchEvent(new Event("room-camera-change",{bubbles:true}));
  const leaveEye=()=>{eye=false;orbit?.leaveEye();if(personKey && scene?.person)person?.show(true);cameraChanged();};
  let focused:string|null=null, paintedScope:string|null=null, focusEpoch=0;
  let roomReturn:RoomViewLink|undefined;
  const shownInstances=()=>focused ? scene?.instances.filter(i=>i.id===focused)??[] : scene?.instances??[];
  let selected:string|null=null, member:string|null=null, measurement:RoomMeasurement|null=null;
  let mode:RoomViewMode="plan", orbit:RoomOrbit|undefined, disposed=false;
  let orbitLoading:Promise<void>|undefined;
  let person:RoomAvatar|undefined, loadingPerson=false, personKey="", requestedPerson="", personEpoch=0, personWaiting=false;
  const notice = (message?:string) => { status.textContent=message ?? ""; status.hidden=!message; };
  const report = (e:unknown) => {
    const message=e instanceof Error ? e.message : String(e);
    notice(message); callbacks.onError?.(message);
  };
  function statusLine() {
    if (!scene) return;
    for (const i of shownInstances()) if (failures.has(i.release)) { notice(failures.get(i.release)); return; }
    if (shownInstances().some(i => !models.has(i.id))) notice("Loading layout objects…");
    else if (personWaiting && mode === "3d") notice("Seating the operator…");
    else notice();
  }
  function size() {
    const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
    plan.resize(w,h); orbit?.resize(w,h);
  }
  const observer=new ResizeObserver(size); observer.observe(stage);

  function paint() {
    if (!scene || disposed) return;
    const showMeasurement=!focused || measurement?.instances?.every(id=>id===focused);
    const data:Drawing={scene,releases,models,focused,selected,member,measurement:showMeasurement?measurement:null,hiddenParts,colours};
    for(const model of models.values())if(!focused || model.id===focused)model.applyDisplay(hiddenParts,colours);
    if (mode === "plan") plan.update(data);
    if (orbit && (mode==="3d" || focused!==paintedScope)) {orbit.update(data);paintedScope=focused;}
  }

  async function syncPerson() {
    const seated=scene?.person, obj=scene?.instances.find(i=>i.id===seated?.host), model=obj && models.get(obj.id);
    const key=(mode==="3d" && orbit && seated && model && obj && (!focused || obj.id===focused)) ? JSON.stringify([model.release.id,obj.id,obj.pose,seated.state]) : "";
    if (key!==requestedPerson) { requestedPerson=key; personEpoch++; }
    if (!key) { person?.hide(); personKey=""; personWaiting=false;delete stage.dataset.seatedHost;delete stage.dataset.operatorPosture; return; }
    if (loadingPerson || personKey===key || !orbit || !seated || !model || !obj) return;
    const epoch=personEpoch;
    const current=()=>!disposed && personEpoch===epoch;
    // Rebinding hides and mutates the current avatar. If this job is superseded,
    // even returning to the previous key needs a fresh bind before it is visible.
    personKey="";
    loadingPerson=true; personWaiting=true; person?.hide(); statusLine();
    let error:unknown;
    try {
      const {RoomAvatar}=await import("./room-person-renderer.ts");
      if (!current()) return;
      person ??= new RoomAvatar(orbit.renderer);
      await person.seat(model,obj,seated,current);
      if (current()) { personKey=key; stage.dataset.seatedHost=obj.id; stage.dataset.operatorPosture=seated.state.posture;person.show(!eye);orbit?.operatorReady(obj.id); }
    } catch (e) { if (current()) { personKey=key; error=e; } }
    finally {
      loadingPerson=false; personWaiting=false;
      if (!disposed) {
        if (personKey!==requestedPerson) void syncPerson();
        statusLine(); if (error) report(error); orbit?.invalidate();
      }
    }
  }

  function assetsChanged() {
    if (!scene || disposed) return;
    for (const [id,model] of models) {
      if (!scene.instances.some(i=>i.id===id && i.release===model.release.id)) { model.dispose(); models.delete(id); }
    }
    for (const i of scene.instances) {
      let model=models.get(i.id);
      if (!model) {
        const rel=releases.find(r=>r.id===i.release);
        if (!rel) { failures.set(i.release,"Missing installed release " + i.release); continue; }
        const source=assets.get(rel.id);
        if (!source) {
          if (!fetching.has(rel.id) && !failures.has(rel.id)) {
            fetching.add(rel.id);
            void loadRoomAsset(rel).then(loaded => { if (disposed) disposeRoomAsset(loaded); else assets.set(rel.id,loaded); })
              .catch(e=>{
                if(disposed)return;
                failures.set(rel.id,String(e instanceof Error ? e.message : e));
                if(shownInstances().some(i=>i.release===rel.id))report(e);
              })
              .finally(()=>{ fetching.delete(rel.id); assetsChanged(); });
          }
          continue;
        }
        model=new PlacedAsset(source,rel,i.id); models.set(i.id,model);
      }
      applyPose(model,i);
    }
    if (!scene.person) {delete stage.dataset.seatedHost;delete stage.dataset.operatorPosture;}
    paint(); void syncPerson(); statusLine();
  }

  async function switchView(next:RoomViewMode) {
    if (disposed) return;
    if(next==="plan")leaveEye();
    mode=next; plan.cancel(); plan.svg.style.display=mode==="plan" ? "block" : "none";
    stage.dataset.view=mode; orbitHost.hidden=mode!=="3d";
    orbit?.show(mode==="3d");
    if (next==="3d" && !orbit) {
      orbitLoading ??= (async()=>{
        notice("Opening 3D view…");
        try {
          const {RoomOrbit}=await import("./room-orbit-renderer.ts");
          if (disposed) return;
          orbit=new RoomOrbit(orbitHost,callbacks);
          orbit.show(mode==="3d");orbit.showGrid(grid);size();
        } catch(e) {
          if (!disposed) { mode="plan";stage.dataset.view=mode;orbitHost.hidden=true;plan.svg.style.display="block";report(e); }
        } finally {orbitLoading=undefined;}
      })();
      await orbitLoading;
    }
    paintPoses(); void syncPerson(); statusLine();
  }
  function cameraState():RoomViewLink {
    return { mode,selected,member,plan:plan.cameraState(),...(focused?{focused}:{}),...(labels?{labels:true}:{}),
      ...(mode==="3d" && orbit?{orbit:orbit.cameraState(),eye,...(eye?{look:orbit.lookState()}:{})}:{}) };
  }
  async function focusAsset(id:string|null,exitMode?:RoomViewMode) {
    if (!scene || disposed || id===focused)return;
    if (id && !scene.instances.some(i=>i.id===id))throw new Error("This object is no longer in the room.");
    const epoch=++focusEpoch;
    if (id && !focused) {
      roomReturn=cameraState();
      // Plan and orbit keep distinct navigation. Preserve the inactive room orbit too.
      if (orbit)roomReturn.orbit=orbit.cameraState();
    }
    const previous=roomReturn;
    leaveEye();focused=id;
    if (id) {
      if (selected!==id)member=null;
      selected=id;stage.dataset.focusedAsset=id;
      await switchView("3d");
      if(epoch!==focusEpoch || disposed)return;
      if(mode!=="3d") {await focusAsset(null,"plan");return;}
    } else {
      delete stage.dataset.focusedAsset;roomReturn=undefined;
      await switchView(exitMode??previous?.mode??"plan");
      if(epoch!==focusEpoch || disposed)return;
      const item=scene.instances.find(i=>i.id===previous?.selected);
      selected=item?.id??null;
      const validMember=item && (previous?.member==="@operator" ? scene.person?.host===item.id :
        releases.find(r=>r.id===item.release)?.members.some(m=>m.id===previous?.member));
      member=validMember?previous!.member:null;
      size();
      if(previous?.plan)plan.restoreCamera(previous.plan);
      if(previous?.orbit)orbit?.restoreCamera(previous.orbit);
      paint();
    }
    callbacks.onFocusChange?.(focused,mode,selected,member??undefined);
    stage.dispatchEvent(new CustomEvent("room-focus-change",{bubbles:true,detail:{
      restoreEye:!id && mode==="3d" && previous?.eye,look:previous?.look
    }}));
  }
  const setView=(next:RoomViewMode)=>focused && next==="plan" ? focusAsset(null,"plan") : switchView(next);
  stage.dataset.view=mode;
  return {
    previewPose(instance:string,values:Record<string,JointValue>) {posePreview={instance,values};schedulePose();},
    clearPosePreview() {if (posePreview) {posePreview=undefined;schedulePose();}},
    setScene(next:RoomScene,catalog:RoomRelease[]) {
      if (disposed) return;
      scene=next; releases=catalog;
      if(focused && !scene.instances.some(i=>i.id===focused))void focusAsset(null);
      if (selected && !scene.instances.some(i=>i.id===selected)) { selected=null; member=null; measurement=null; }
      assetsChanged();
    },
    select(id:string|null,memberId?:string) {
      selected=focused??id; member=!focused || focused===id?memberId??null:null; paint();
    },
    setView, focusAsset, focusedAsset:()=>focused,
    getView():RoomViewMode { return mode; },
    setMeasurement(value:RoomMeasurement|null) { measurement=value; paint(); },
    fit() { leaveEye(); if (mode==="plan") plan.fit(); else orbit?.fit(); },
    preset(preset:CameraPreset) {leaveEye();orbit?.fit(preset);},
    eye(from:RoomPoint,to:RoomPoint) {
      if(!orbit || mode!=="3d") throw new Error("Open the 3D view to use the operator’s eye.");
      orbit.eye(from,to);eye=true;person?.hide();cameraChanged();
    },
    leaveEye,
    cameraState,
    restoreLook(state:NonNullable<RoomViewLink["look"]>) {orbit?.restoreLook(state);},
    restoreCamera(state:RoomViewLink){size();if(state.plan)plan.restoreCamera(state.plan);if(state.orbit)orbit?.restoreCamera(state.orbit);},
    releases(){return releases;},
    display(){return {grid,labels,colours};},
    setDisplay(next:{grid:boolean;labels:boolean;colours:"natural"|"parts"|"evidence"}){
      grid=next.grid;labels=next.labels;colours=next.colours;paint();
      stage.classList.toggle("rv-no-grid",!grid);stage.classList.toggle("rv-no-labels",!labels);orbit?.showGrid(grid);
    },
    components(instance:string){
      const i=scene?.instances.find(i=>i.id===instance),release=releases.find(r=>r.id===i?.release);
      return (release?.members??[]).filter(m=>m.kind==="part" || /^[CS]_/.test(m.id)).map(m=>({id:m.id,label:m.label,visible:!hiddenParts.has(instance+"/"+m.id)}));
    },
    setComponentVisible(instance:string,member:string,visible:boolean){
      const key=instance+"/"+member;if(visible)hiddenParts.delete(key);else hiddenParts.add(key);paint();
    },
    showAllComponents(){
      if(focused) {for(const key of hiddenParts)if(key.startsWith(focused+"/"))hiddenParts.delete(key);}
      else hiddenParts.clear();paint();
    },
    async picture(){if(shownInstances().some(i=>failures.has(i.release)))throw new Error("Resolve the missing asset before saving its picture.");
      if(shownInstances().some(i=>!models.has(i.id)) || personWaiting)throw new Error("The scene is still loading. Try again after its assets appear.");
      const {roomPicture}=await import("./room-picture.ts");return roomPicture(stage,mode);},
    dispose() {
      if (disposed) return;
      disposed=true;cancelAnimationFrame(poseFrame); personEpoch++; observer.disconnect(); plan.cancel(); person?.dispose();
      for (const model of models.values()) model.dispose();
      orbit?.dispose();
      for (const asset of assets.values()) disposeRoomAsset(asset);
      stage.remove(); assets.clear(); models.clear();
    },
  };
}
