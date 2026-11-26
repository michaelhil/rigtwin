import type { RoomInstance, RoomRelease, RoomScene } from "../../shared/room.ts";
import type { OperatorOptions } from "../../shared/room-person.ts";
import { h } from "./dom.ts";
import { action,field,select } from "./room-controls.ts";

interface Context {
  item:RoomInstance;release:RoomRelease;scene:RoomScene;apiRoot:string;
  write:(id:string,args:Record<string,unknown>,base?:number)=>Promise<boolean>;
  details:(key:string,label:string,children:Node[],hint?:string)=>HTMLElement;
}
const definitions=new Map<string,Promise<OperatorOptions>>();
function choices(c:Context,sex:string,style:string) {
  const key=[c.apiRoot,c.release.id,sex,style].join("/");
  let existing=definitions.get(key);
  if (!existing) {
    existing=fetch(c.apiRoot+"/command",{method:"POST",headers:{"Content-Type":"application/json","X-Synergon":"1"},body:JSON.stringify({id:"person.options",args:{host:c.item.id,sex,style}})})
      .then(async r=>{ const data=await r.json(); if(!r.ok||!data.ok)throw new Error(data.error?.message??"Cannot load operator controls.");return data.result as OperatorOptions; })
      .catch(e=>{definitions.delete(key);throw e;});
    definitions.set(key,existing);
  }
  return existing;
}
const asChoices=(values:string[])=>values.map(value=>({value,label:value}));
export function roomOperatorControls(c:Context) {
  const {item,scene,release,write,details}=c,base=scene.version,person=scene.person;
  const submit=(patch:Record<string,unknown>)=>write("person.set",{host:item.id,...patch},base);
  if(!person || person.host!==item.id) {
    const host=scene.instances.find(i=>i.id===person?.host);
    const btn=action(host?"Move operator here":"Seat an operator",()=>void submit({}),"person");
    return details(item.id+"/operator","Seated operator",host?[h("p","rm-help","Currently attached to "+host.label+"."),btn]:[btn]);
  }
  const state=person.state,body=h("div","rm-disclosure-body"),content:Node[]=[body];
  const choice=(label:string,items:{label:string;value:string}[],value:string,apply:(value:string)=>void)=>{
    const picker=select(label,items,value);picker.onchange=()=>apply(picker.value);return field(label,picker);
  };
  const change=(key:string)=>(v:string)=>void submit({[key]:v});
  const setup=async()=>{
    const config=await choices(c,state.sex,state.style);
    body.append(choice("Body preset",[{value:"",label:"Custom body"},...asChoices(config.presets)],state.preset??"",v=>{if(v)void submit({preset:v});}),
      choice("Sex",asChoices(["female","male"]),state.sex,change("sex")),
      choice("Appearance",[{value:"dressed",label:"Work clothes"},{value:"clay",label:"Clay"}],state.style,change("style")));
    if(state.style==="dressed") {
      body.append(choice("Skin tone",config.tones.map(t=>({value:t.id,label:t.label})),state.tone,change("tone")));
      for(const [key,label] of [["glasses","Safety glasses"],["headset","Headset"]] as const) {
        const check=h("input");check.type="checkbox";check.checked=state[key];check.onchange=()=>void submit({[key]:check.checked});
        body.append(h("label","rm-field-label",check," "+label));
      }
    }
    const dimensions=h("div","rm-disclosure-body"),form=h("form","rm-disclosure-body");
    for(const ctrl of config.controls) {
      const title=ctrl.label+" ("+ctrl.unit+")",el=h("input");
      const original=state.body[ctrl.id]??ctrl.default;
      el.type="number";el.name=ctrl.id;el.step="any";el.min=String(ctrl.min);el.max=String(ctrl.max);el.value=String(original);
      el.dataset.original=el.value;el.required=true;
      (["stature","mass"].includes(ctrl.id)?form:dimensions).append(field(title,el));
    }
    form.append(h("details","rm-disclosure",h("summary",null,"Body proportions"),dimensions));
    const save=h("button","rm-button","Apply body measurements");save.type="submit";form.append(save);
    form.onsubmit=e=>{
      e.preventDefault();const changes:Record<string,number>={};
      for (const el of form.querySelectorAll("input")) if(el.value!==el.dataset.original)changes[el.name]=Number(el.value);
      if(Object.keys(changes).length)void submit({body:changes});
    };
    body.append(form,choice("Posture",config.postures.map(value=>({value,label:value==="operating"?"Operating":value==="RELAXED_STAND"?"Relaxed stand":value})),state.posture,change("posture")));
    if(state.posture!=="operating") { body.append(h("p","rm-help","This library posture is shown beside its host. Select Operating to bind the seat, measure the eye and set targets."));return; }
    const targets=release.members.filter(m=>/^[CDS]_/.test(m.id)).map(m=>({value:m.id,label:m.label}));
    const aims=state.aims??{};
    const patch=(key:string,v:unknown)=>void submit({aims:{[key]:v}});
    body.append(choice("Gaze",[{value:"",label:"Default gaze"},...targets],aims.look??"",v=>patch("look",v||null)));
    for(const [key,label] of [["left_hand","Left hand"],["right_hand","Right hand"],["left_foot","Left foot"],["right_foot","Right foot"]] as const) {
      const hand=key.endsWith("hand"),aim=aims[key],mode=aim?.mode??"default";
      const modes=hand?[["default","Grip joystick"],["rest","Rest on armrest"],["point","Point at target"],["touch","Touch target"]]:
        [["default","On pedal"],["floor","On floor"],["on","On target"]];
      const m=select(label+" action",modes.map(([value,label])=>({value,label})),mode);
      const t=select(label+" target",targets,aim&&"target" in aim?aim.target:targets[0]?.value);
      const targetField=field(label+" target",t),needsTarget=()=>["point","touch","on"].includes(m.value);
      targetField.hidden=!needsTarget();
      const apply=action("Apply "+label.toLowerCase()+" target",()=>{if(t.value)patch(key,{mode:m.value,target:t.value});});
      apply.hidden=!needsTarget();
      m.onchange=()=>{
        targetField.hidden=apply.hidden=!needsTarget();
        if(!needsTarget())patch(key,m.value==="default"?null:{mode:m.value});
      };
      body.append(field(label+" action",m),targetField,apply);
    }
  };
  void setup().catch(e=>body.append(h("p","rm-error",e instanceof Error?e.message:String(e))));
  content.push(action("Unseat operator",()=>void write("person.set",{host:null},base),undefined,"rm-quiet"));
  return details(item.id+"/operator","Seated operator",content,"Attached");
}
