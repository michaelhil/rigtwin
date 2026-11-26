import { test,expect } from "bun:test";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRoomLibrary } from "./room-library.ts";
import { newRoom,roomCommand } from "./room-model.ts";
import type { OperatorOptions } from "../shared/room-person.ts";

test("room operator uses the pinned body definitions, named postures, scoped aims and existing undo writer",async()=>{
  const tmp=mkdtempSync(join(tmpdir(),"room-operator-controls-"));
  try{
    const {catalog}=await loadRoomLibrary(tmp);
    let current=newRoom("f5822df0-a772-499c-b9a5-1db5cf95788a","Rig operator",catalog,"demo");
    const call=(id:string,args:object={})=>{const result=roomCommand(current,catalog,{id,args});current=result.record;return result.result;};
    const set=(args:object)=>call("person.set",{host:"station-a",...args});
    const options=call("person.options",{host:"station-a"}) as OperatorOptions;
    expect(options.presets).toContain("P5 woman");
    expect(options.postures).toContain("RELAXED_STAND");
    expect(options.controls.map(c=>c.id)).toContain("r_sittingheight");
    const eye=()=>call("person.measure",{to:{instance:"station-a",member:"S_mon_screen"}}) as {metres:number};
    const baseline=eye().metres;
    set({preset:"P5 woman",tone:"dark",glasses:false,headset:false});expect(current.scene.person?.state.sex).toBe("female");
    expect(Math.abs(eye().metres-baseline)).toBeGreaterThan(.005);
    set({style:"clay",body:{stature:1610,r_sittingheight:.2}});expect(current.scene.person?.state.preset).toBeNull();
    expect(current.scene.person?.state.body.stature).toBe(1610);
    const version=current.scene.version;expect(()=>set({body:{stature:3000}})).toThrow();expect(current.scene.version).toBe(version);
    set({aims:{right_hand:{mode:"point",target:"S_ts_screen"},left_foot:{mode:"floor"}}});
    set({aims:{right_hand:{mode:"touch",target:"S_ts_screen"}}});
    expect(current.scene.person?.state.aims?.right_hand).toEqual({mode:"touch",target:"S_ts_screen"});
    expect(current.scene.person?.state.aims?.left_foot).toEqual({mode:"floor"});
    set({posture:"relaxed stand"});expect(current.scene.person?.state.posture).toBe("RELAXED_STAND");expect(current.scene.person?.state.aims).toBeUndefined();
    expect(eye).toThrow("operating posture");expect(()=>set({aims:{look:"S_mon_screen"}})).toThrow("operating posture");
    call("undo");expect(current.scene.person?.state.posture).toBe("operating");expect(current.scene.person?.state.aims?.right_hand).toMatchObject({mode:"touch"});
    call("person.set",{host:"station-b"});expect(current.scene.person?.host).toBe("station-b");
    expect(()=>call("person.options",{host:"display-a"})).toThrow("station");
  }finally{rmSync(tmp,{recursive:true,force:true});}
},20000);
