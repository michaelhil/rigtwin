// Local camera and selection never write to the room. A pointer gesture commits one placement through the caller's scene writer.
import { disposeRoomAsset, loadRoomAsset, PlacedAsset, type RoomAsset } from "./room-assets-renderer.ts";
import { RoomPlan, type Drawing, type RoomMeasurement, type RoomViewCallbacks } from "./room-plan-renderer.ts";
import type { RoomOrbit } from "./room-orbit-renderer.ts";
import type { RoomAvatar } from "./room-person-renderer.ts";
import type { RoomRelease, RoomScene } from "../../shared/room.ts";

export type { RoomMeasurement, RoomPlacement, RoomViewCallbacks } from "./room-plan-renderer.ts";
export type RoomViewMode = "plan" | "3d";
export function mountRoomView(host: HTMLElement, callbacks: RoomViewCallbacks) {
  const stage = document.createElement("div"); stage.className="rv-stage";
  const orbitHost=document.createElement("div"); orbitHost.className="rv-orbit"; orbitHost.hidden=true;
  const status=document.createElement("div"); status.className="rv-status"; status.setAttribute("role","status"); status.hidden=true;
  host.append(stage);
  const plan=new RoomPlan(stage,callbacks);
  stage.append(orbitHost,status);
  const assets=new Map<string,RoomAsset>(), fetching=new Set<string>(), failures=new Map<string,string>();
  const models=new Map<string,PlacedAsset>();
  let scene:RoomScene | undefined, releases:RoomRelease[]=[];
  let selected:string|null=null, member:string|null=null, measurement:RoomMeasurement|null=null;
  let mode:RoomViewMode="plan", orbit:RoomOrbit|undefined, orbitLoading=false, disposed=false;
  let person:RoomAvatar|undefined, loadingPerson=false, personKey="", requestedPerson="", personEpoch=0, personWaiting=false;
  const notice = (message?:string) => { status.textContent=message ?? ""; status.hidden=!message; };
  const report = (e:unknown) => {
    const message=e instanceof Error ? e.message : String(e);
    notice(message); callbacks.onError?.(message);
  };
  function statusLine() {
    if (!scene) return;
    for (const i of scene.instances) if (failures.has(i.release)) { notice(failures.get(i.release)); return; }
    if (scene.instances.some(i => !models.has(i.id))) notice("Loading layout objects…");
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
    const data:Drawing={scene,releases,models,selected,member,measurement};
    if (mode === "plan") plan.update(data);
    if (mode === "3d" && orbit) orbit.update(data);
  }

  async function syncPerson() {
    const seated=scene?.person, obj=scene?.instances.find(i=>i.id===seated?.host), model=obj && models.get(obj.id);
    const key=(mode==="3d" && orbit && seated && model && obj) ? JSON.stringify([model.release.id,obj.id,obj.pose,seated.state]) : "";
    if (key!==requestedPerson) { requestedPerson=key; personEpoch++; }
    if (!key) { person?.hide(); personKey=""; personWaiting=false; return; }
    if (loadingPerson || personKey===key || !orbit || !seated || !model || !obj) return;
    const epoch=personEpoch;
    const current=()=>!disposed && personEpoch===epoch;
    loadingPerson=true; personWaiting=true; person?.hide(); statusLine();
    let error:unknown;
    try {
      const {RoomAvatar}=await import("./room-person-renderer.ts");
      if (!current()) return;
      person ??= new RoomAvatar(orbit.renderer);
      await person.seat(model,obj,seated,current);
      if (current()) { personKey=key; stage.dataset.seatedHost=obj.id; }
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
              .catch(e=>{ if (!disposed) { failures.set(rel.id,String(e instanceof Error ? e.message : e)); report(e); } })
              .finally(()=>{ fetching.delete(rel.id); assetsChanged(); });
          }
          continue;
        }
        model=new PlacedAsset(source,rel,i.id); models.set(i.id,model);
      }
      model.apply(i);
    }
    if (!scene.person) delete stage.dataset.seatedHost;
    paint(); void syncPerson(); statusLine();
  }

  async function setView(next:RoomViewMode) {
    if (disposed) return;
    mode=next; plan.cancel(); plan.svg.style.display=mode==="plan" ? "block" : "none";
    stage.dataset.view=mode; orbitHost.hidden=mode!=="3d";
    orbit?.show(mode==="3d");
    if (next==="3d" && !orbit && !orbitLoading) {
      orbitLoading=true; notice("Opening 3D view…");
      try {
        const {RoomOrbit}=await import("./room-orbit-renderer.ts");
        if (disposed) return;
        orbit=new RoomOrbit(orbitHost,callbacks);
        orbit.show(mode==="3d"); size();
      } catch(e) {
        if (!disposed) { mode="plan"; stage.dataset.view=mode; orbitHost.hidden=true; plan.svg.style.display="block"; paint(); report(e); }
        return;
      } finally { orbitLoading=false; }
    }
    paint(); void syncPerson(); statusLine();
  }
  stage.dataset.view=mode;
  return {
    setScene(next:RoomScene,catalog:RoomRelease[]) {
      if (disposed) return;
      scene=next; releases=catalog;
      if (selected && !scene.instances.some(i=>i.id===selected)) { selected=null; member=null; measurement=null; }
      assetsChanged();
    },
    select(id:string|null,memberId?:string) {
      selected=id; member=memberId ?? null; paint();
    },
    setView,
    getView():RoomViewMode { return mode; },
    setMeasurement(value:RoomMeasurement|null) { measurement=value; paint(); },
    fit() { if (mode==="plan") plan.fit(); else orbit?.fit(); },
    dispose() {
      if (disposed) return;
      disposed=true; personEpoch++; observer.disconnect(); plan.cancel(); person?.dispose();
      for (const model of models.values()) model.dispose();
      orbit?.dispose();
      for (const asset of assets.values()) disposeRoomAsset(asset);
      stage.remove(); assets.clear(); models.clear();
    },
  };
}
