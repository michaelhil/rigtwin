// The room loads this module only when the Assessment tab is opened.
import type { AssessmentReport,Evidence,Finding,ProfileInfo,Settings } from "../../shared/assessment.ts";
import type { RoomScene } from "../../shared/room.ts";
import { h,link } from "./dom.ts";
import { action,field,section,select } from "./room-controls.ts";
import type { RoomMeasurement } from "./room-view.ts";
import { PUBLIC_ROOM } from "./room-paths.ts";

interface PanelOptions {
  workspaceId:string;apiRoot:string;getScene:()=>RoomScene;showMeasurement:(value:RoomMeasurement|null)=>void;
}
interface RunReply {report:AssessmentReport;saved:{id:string;name:string}|null;replayed:boolean}
const metres=(n:number)=>Number(n.toFixed(4))+" m";
const opts=(items:[string,string][])=>items.map(([value,label])=>({value,label}));
const note=(s:string)=>h("p","rm-help",s);
function input(type:string,placeholder="") {
  const el=h("input"); el.type=type;el.placeholder=placeholder;el.maxLength=512;
  if(type==="number") {el.min="0";el.max="1000";el.step="any";}
  return el;
}
function detail(label:string,body:HTMLElement) {
  const group=h("details","rm-disclosure",h("summary",null,label),body);
  return group;
}
function criterionLimits(f:Finding) {
  const {minimum,maximum}=f.limits;
  if (minimum!==undefined && maximum!==undefined) return metres(minimum)+" to "+metres(maximum);
  if (minimum!==undefined) return "At least "+metres(minimum);
  if (maximum!==undefined) return "At most "+metres(maximum);
  return "";
}
export function createAssessmentPanel({apiRoot,getScene,showMeasurement}:PanelOptions) {
  const root=h("div","rm-assessment"),settingsPane=h("div"),results=h("div"),savedPane=h("div");
  const status=h("p","rm-help"),stale=note(""),work=h("div","rm-disclosure-body");
  status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const name=input("text","Optional"),observation=input("text","On-site lighting and reflections");
  const evidenceTarget=select("Measurement to bound",[]),radius=input("number"),source=input("text","Inspection record or survey");
  const evidence=detail("Independent measurement evidence",h("div","rm-disclosure-body",
    field("Measurement",evidenceTarget),field("Total uncertainty ± m",radius),field("Evidence reference",source),
    note("Cover geometry, pose and site conditions for the measured segment.")));
  const onSite=detail("Manual observation",h("div","rm-disclosure-body",field("Reflected glare",observation)));
  const run=action("Run assessment",()=>void perform(runAssessment),"check","rm-primary rm-wide");
  work.append(field("Save run as",name),onSite,evidence,run,status);
  root.append(settingsPane,section("Run assessment",work),stale,results,savedPane);
  let info:ProfileInfo|null=null,reply:RunReply|null=null,picked=0,busy=false,active=false,started=false,displayedRevision=-1;
  let collectSettings:()=>Partial<Settings>=()=>({});
  let boundRevision=-1;

  async function command<T>(id:string,args:object,expectedVersion?:number):Promise<T> {
    const response=await fetch(apiRoot+"/command",{method:"POST",headers:{"Content-Type":"application/json","X-Synergon":"1","X-Synergon-Client":"person"},
      body:JSON.stringify({id,args,...(expectedVersion===undefined?{}:{expectedVersion})})});
    const receipt=await response.json();
    if(!response.ok || !receipt.ok) throw new Error([receipt?.error?.message??"Assessment request failed.",receipt?.error?.hint].filter(Boolean).join(" "));
    return receipt.result;
  }
  async function perform(job:()=>Promise<void>) {
    if(busy)return;
    busy=true;root.setAttribute("aria-busy","true");run.disabled=true;status.textContent="";
    try {await job();} catch(e) {status.textContent=e instanceof Error ? e.message : String(e);}
    finally {busy=false;root.removeAttribute("aria-busy");run.disabled=!info;}
  }
  function buildSettings() {
    if(!info)return;
    const current=info.settings,profile=select("Rule profile",info.profiles.map(p=>({value:p.id,label:p.title})),current.profile);
    const jurisdiction=select("Jurisdiction",opts([["unknown","Unknown"],["us-general-industry","US general industry"],["other","Other jurisdiction"]]),current.jurisdiction);
    const task=select("Task",opts([["unknown","Unknown"],["seated-display-reading","Seated display reading"],["other","Other task"]]),current.task);
    const exit=select("Threshold is exit access",opts([["unknown","Unknown"],["yes","Yes"],["no","No"]]),current.exitAccess);
    const minimum=input("number"),reference=input("text","Document and clause");
    minimum.value=current.customer ? String(current.customer.minimum) : "";reference.value=current.customer?.reference??"";
    const customer=h("div","rm-disclosure-body",field("Minimum plan opening (m)",minimum),field("Customer requirement reference",reference));
    const purpose=note("");
    function selectedProfile() {
      customer.hidden=PUBLIC_ROOM || profile.value!=="customer-layout";
      purpose.textContent=info?.profiles.find(p=>p.id===profile.value)?.purpose??"";
    }
    profile.onchange=selectedProfile;selectedProfile();
    collectSettings=()=>{
      const values:Partial<Settings>={profile:profile.value as Settings["profile"],jurisdiction:jurisdiction.value as Settings["jurisdiction"],
        task:task.value as Settings["task"],exitAccess:exit.value as Settings["exitAccess"]};
      if(!customer.hidden) {
        if(!minimum.value.trim() && !reference.value.trim())values.customer=null;
        else {
          if(!minimum.value.trim() || !reference.value.trim() || !minimum.checkValidity())throw new Error("Enter both a minimum opening and its customer document reference.");
          values.customer={minimum:Number(minimum.value),reference:reference.value.trim()};
        }
      }
      return values;
    };
    const apply=action("Apply settings",()=>void perform(async()=>{await saveSettings();status.textContent="Project assessment settings saved.";}));
    const body=h("div","rm-disclosure-body",field("Rule profile",profile),purpose,field("Jurisdiction",jurisdiction),field("Task",task),field("Threshold is exit access",exit));
    if(!PUBLIC_ROOM)body.append(customer);
    body.append(apply);
    settingsPane.replaceChildren(section("Assessment settings",body));
  }
  async function saveSettings() {
    if(!info)throw new Error("Open the installed assessment profile first.");
    const patch=collectSettings();
    if(!Object.entries(patch).some(([k,v])=>JSON.stringify(info!.settings[k as keyof Settings])!==JSON.stringify(v)))return;
    info=await command<ProfileInfo>("assessment.configure",{...patch,expectedSettingsPin:info.settingsPin});
  }
  function selection() {
    const f=reply?.report.findings[picked];
    const current=!!reply && !reply.replayed && reply.report.revision===getScene().version;
    if(active)showMeasurement(f?.points && current ? {points:f.points,...(f.roles.eye && f.roles.displayCentre ? {instances:[f.roles.eye.instance,f.roles.displayCentre.instance] as [string,string]} : {}),label:f.title+(f.nominal===null?"":" · "+metres(f.nominal))} : null);
  }
  function showFindings() {
    results.replaceChildren();if(!reply)return;
    const {report}=reply, f=report.findings[picked];
    const list=select("Finding",report.findings.map((item,i)=>({value:String(i),label:item.title+" · "+item.binding+" · "+item.status})),String(picked));
    list.onchange=()=>{picked=Number(list.value);showFindings();results.querySelector("select")?.focus();};
    const body=h("div","rm-disclosure-body",field("Finding",list));
    if(f) {
      body.append(h("strong",null,f.status),note(f.reason));
      if(f.nominal!==null)body.append(note("Measured "+metres(f.nominal)));
      if(criterionLimits(f))body.append(note("Criterion limit · "+criterionLimits(f)));
      if(f.interval)body.append(note("Measurement interval · "+f.interval.map(metres).join(" to ")));
      if(f.uncertainty)body.append(note(f.uncertainty));
      if(f.observation)body.append(note("Observation · "+f.observation));
      const refs=Object.entries(f.roles).map(([role,ref])=>role+" · "+ref.instance+"/"+ref.member);
      const geometry=h("div","rm-disclosure-body",...refs.map(note));
      if(f.edges.length)geometry.append(note(f.edges.join(" to ")));
      if(f.points) geometry.append(note(f.points.map(point=>"("+point.map(n=>Number(n.toFixed(3))).join(", ")+")").join(" to ")+" m"));
      if(refs.length||f.points)body.append(detail("Measured geometry",geometry));
      body.append(note(f.interpretation),link("Standards entry",f.citation,"rm-link"),note(f.edition+" · "+f.clause));
      if(f.source.startsWith("https://"))body.append(link("Original source",f.source,"rm-link"));
    }
    body.append(detail("Run provenance",h("div","rm-disclosure-body",note(report.evaluator+" · revision "+report.revision),
      note([report.population,report.posture].filter(Boolean).join(" · ")),note("Rule pin "+report.rulePin),note("Bindings "+report.bindingPin),
      ...report.geometryPins.map(note),note("Outside this run · "+report.unassessed.join(", ")))));
    results.append(section("Findings",body));
    refreshScene();selection();
  }
  function focusFindings() {
    if (!active || root.closest('[inert]')) return;
    const heading=results.querySelector<HTMLElement>('h2');
    if (!heading) return;
    heading.tabIndex=-1;
    heading.focus({preventScroll:true});
    heading.scrollIntoView({block:"start"});
  }
  function refreshScene() {
    const version=getScene().version;
    if(boundRevision!==-1 && version!==boundRevision) {radius.value="";source.value="";boundRevision=-1;}
    stale.textContent=!reply ? "" : reply.replayed ? "Showing the frozen geometry from revision "+reply.report.revision+"." :
      reply.report.revision!==version ? "Layout changed since revision "+reply.report.revision+". Run again to update these findings." : "";
    stale.hidden=!stale.textContent;
  }
  function showSaved() {
    if(!info?.saved.length){savedPane.replaceChildren();return;}
    const list=select("Saved assessment",info.saved.map(r=>({value:r.id,label:r.name+" · revision "+r.revision})));
    const replay=action("Replay saved assessment",()=>void perform(async()=>{
      reply=await command<RunReply>("assessment.replay",{id:list.value});picked=0;showFindings();status.textContent="Reproduced "+reply.saved?.name+".";focusFindings();
    }));
    savedPane.replaceChildren(section("Saved assessments",h("div","rm-disclosure-body",field("Saved assessment",list),replay)));
  }
  async function runAssessment() {
    await saveSettings();
    const version=getScene().version,args:{observation?:string;saveName?:string;evidence?:Evidence[]}={};
    if(name.value.trim())args.saveName=name.value.trim();
    if(observation.value.trim())args.observation=observation.value.trim();
    if(radius.value || source.value.trim()) {
      if (!radius.value || !radius.checkValidity() || !source.value.trim() || !evidenceTarget.value || boundRevision!==version) throw new Error("Select a current measurement, its independent error bound and its reference.");
      args.evidence=[{binding:evidenceTarget.value,basis:"independent",radius:Number(radius.value),source:source.value.trim()}];
    }
    const prev=reply?.report.findings[picked];
    reply=await command<RunReply>("assessment.run",args,version);
    picked=Math.max(0,reply.report.findings.findIndex(f=>f.criterion===prev?.criterion&&f.binding===prev?.binding));
    const bounds=[...new Set(reply.report.findings.filter(f=>f.nominal!==null && f.criterion!=="project.doorway-width").map(f=>f.binding))];
    const old=evidenceTarget.value;evidenceTarget.replaceChildren(...bounds.map(id=>new Option(id,id,false,id===old)));
    boundRevision=version;showFindings();
    if(reply.saved && info) {info.saved.push({...reply.saved,revision:version});showSaved();name.value="";}
    status.textContent=reply.saved ? "Saved "+reply.saved.name+"." : "Evaluated revision "+version+".";
    focusFindings();
  }
  async function load() {
    info=await command<ProfileInfo>("assessment.profiles",{});buildSettings();showSaved();status.textContent="";
  }
  const retry=action("Reload assessment profiles",()=>void perform(load));
  return {
    render() {
      active=true;
      if(!started){started=true;settingsPane.replaceChildren(section("Assessment profiles",retry));void perform(load);}
      if(displayedRevision!==getScene().version){displayedRevision=getScene().version;refreshScene();}
      selection();return root;
    },
    deactivate(){active=false;showMeasurement(null);},
  };
}
