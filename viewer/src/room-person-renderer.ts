// This chunk is requested only for an occupied station in 3D. The solver receives host-local frames and targets.
import type { WebGLRenderer } from "three";
import { Avatar } from "./person/avatar.ts";
import { rigBinding, rigViewFromNodes } from "./person/rig-binding.ts";
import { section } from "./person/params.ts";
import type { RoomInstance, RoomPerson } from "../../shared/room.ts";
import type { PlacedAsset } from "./room-assets-renderer.ts";

const timing = section("runtime");

export class RoomAvatar {
  private avatar?: Avatar;
  private url = "";
  private appearance = "";
  private retired = false;
  constructor(private renderer: WebGLRenderer) {}

  async seat(station: PlacedAsset, instance: RoomInstance, person: RoomPerson, current: () => boolean) {
    const state = person.state, name = (state.style === "clay" ? "clay" : "operator") + (state.sex === "female" ? "-f" : "-m");
    const url = new URL("manikin/" + name + "/" + name + ".avatar.json",new URL(station.release.modelUrl,location.href)).href;
    if (url !== this.url || !this.avatar) {
      const next = new Avatar(this.renderer, "/libs/basis/");
      try { await next.loadPackage(url); }
      catch (err) { if (next.root) next.dispose(); throw err; }
      if (this.retired) { next.dispose(); return; }
      this.avatar?.dispose(); this.avatar=next; this.url=url; this.appearance="";
    }
    if (!current()) return;
    const av = this.avatar;
    const appearance = JSON.stringify([state.body,state.glasses,state.headset,state.tone]);
    if (appearance !== this.appearance) {
      const controls = av.manifest.shape.controls as {id:string; default?:number}[];
      av.setShape(Object.fromEntries(controls.map(c => [c.id,state.body[c.id] ?? c.default ?? 0])));
      if (state.style === "dressed") {
        if (av.tone !== state.tone) await av.setTone(state.tone);
        const wear = Object.fromEntries(["glasses","headset"].flatMap(key => {
          const slot = av.slots.find(s=>s.id===key);
          return slot ? [[key,state[key as "glasses"|"headset"] ? slot.default : null]] : [];
        }));
        await av.wear(wear);
      }
      this.appearance=appearance;
    }
    if (!current()) return;
    const op = av.state("operator");
    av.state("eyes").time=timing.eye_still_time;
    av.state("eyes").seed=timing.eye_seed;
    op.time=timing.still_time; op.on=true;
    if (!op._op || op._key !== av.restKey()) av.update(0);
    const rig = rigViewFromNodes(station.asset.manifest,station.asset.nodes,instance.pose);
    const binding = rigBinding({ op:op._op, manifest:av.manifest, measures:av.measures, controls:av.shape, weights:av.weights },rig,state.aims);
    av.binding=binding;
    const [x,y,z] = binding.place.origin;
    av.holder.position.set(x,z,-y);
    av.holder.rotation.set(0,Math.PI/2+binding.place.yawDeg*Math.PI/180,0);
    station.modelFrame.add(av.holder);
    station.holder.updateWorldMatrix(true,true);
    av.holder.visible=true;
    av.update(0);
    if (av.state("operator")._bound !== av.binding) av.update(0);
  }
  hide() { if (this.avatar) this.avatar.holder.visible=false; }
  dispose() { this.retired=true; this.avatar?.dispose(); this.avatar=undefined; }
}
