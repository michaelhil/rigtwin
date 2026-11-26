// The view title is also its navigation. Changing scope only changes this viewer.
import type { RoomScene } from "../../shared/room.ts";
import { h } from "./dom.ts";
import { action, icon } from "./room-controls.ts";

export function roomScope(open:(instance:string | null)=>Promise<void>) {
  const name=h("span",null,"Full room");
  const heading=h("h1","rm-stage-title",name,icon("chevron"));
  const summary=h("summary","rm-scope-trigger",heading);
  summary.setAttribute("aria-label","View scope");
  summary.title="View the full room or focus on one asset";
  const choices=h("div","rm-scope-menu");
  const selector=h("details","rm-scope-selector",summary,choices);
  const back=action("Full room",()=>activate(null),"room","rm-scope-back");
  back.setAttribute("aria-label","Return to full room");
  const divider=icon("next"), path=h("nav","rm-scope-path",back,divider,selector);
  path.setAttribute("aria-label","View navigation");
  const subtitle=h("p","rm-stage-size");
  const node=h("header","rm-stage-head",h("div","rm-scope-head",path,subtitle));
  let focus:string|null=null, objects:RoomScene["instances"]=[], menuDirty=true;
  function activate(id:string|null) {
    selector.open=false;
    summary.focus({preventScroll:true});
    void open(id);
  }
  function option(label:string,id:string|null) {
    const button=action(label,()=>activate(id),id===null?"room":"cube","rm-scope-option");
    button.setAttribute("aria-label",id===null?"View full room":"Focus on "+label);
    button.setAttribute("aria-pressed",String(id===focus));
    if(id===focus) button.append(icon("check"));
    return button;
  }
  function list() {
    if (!menuDirty) return;
    menuDirty=false;
    choices.replaceChildren(option("Full room",null));
    if (objects.length) {
      choices.append(h("div","rm-scope-caption","Focus on an asset"),...objects.map(item=>option(item.label,item.id)));
    }
  }
  selector.addEventListener("toggle",()=>{if(selector.open) list();});
  document.addEventListener("pointerdown",e=>{if(selector.open && !selector.contains(e.target as Node)) selector.open=false;});
  selector.addEventListener("focusout",e=>{if(e.relatedTarget && !selector.contains(e.relatedTarget as Node)) selector.open=false;});
  selector.addEventListener("keydown",e=>{
    if(e.key==="Escape") {e.preventDefault();e.stopPropagation();selector.open=false;summary.focus();return;}
    if(e.key!=="ArrowDown" && e.key!=="ArrowUp") return;
    e.preventDefault();
    if(!selector.open) {selector.open=true;list();}
    const buttons=[...choices.querySelectorAll("button")], here=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next=here<0 ? (e.key==="ArrowDown"?0:buttons.length-1) : (here+(e.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;
    buttons[next]?.focus();
  });
  return {node, update(scene:RoomScene,id:string|null,mode:"plan"|"3d") {
    const changed=id!==focus || objects.length!==scene.instances.length || objects.some((o,n)=>o.label!==scene.instances[n]?.label || o.id!==scene.instances[n]?.id);
    focus=id;objects=scene.instances;
    const item=objects.find(i=>i.id===id);
    back.hidden=!item;divider.style.display=item?"":"none";
    name.textContent=item?.label ?? "Full room";
    const view=mode==="3d"?"3D view":"Floor plan";
    subtitle.textContent=item?view:view+" · "+scene.room.width+" × "+scene.room.depth+" m";
    if(changed) menuDirty=true;
    if(selector.open) list();
  }};
}
