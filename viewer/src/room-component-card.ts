// An inspector always carries an instance ID as well as its selected member.
// The same card is used in the sidebar and in movable comparison windows.
import { adjWords, type AdjWord } from "../../shared/words.ts";
import { h } from "./dom.ts";
import { action, displayNumber, iconAction } from "./room-controls.ts";
import type { JointValue } from "../../shared/pose.ts";
import type { RoomInstance, RoomJoint, RoomRelease } from "../../shared/room.ts";

export type ComponentEdit = (joint:RoomJoint,value:JointValue|null) => Promise<boolean>;
type PoseValues=Record<string,JointValue>;
export type BeginPoseGesture=(card:HTMLElement,joints:RoomJoint[],reset:()=>void)=>{
  update:(values:PoseValues)=>void;commit:(values:PoseValues)=>void;cancel:()=>void;
};
interface CardOptions {
  item:RoomInstance; release:RoomRelease; part:string;
  beginGesture:BeginPoseGesture;
  apply:(values:Record<string,JointValue|null>)=>Promise<boolean>; dock?:()=>void; edit:ComponentEdit; close:()=>void; pop?:()=>void; placement:()=>void;
}

export function componentPanel(title:string,item:RoomInstance,part:string,close:()=>void,pop?:()=>void,dock?:()=>void) {
  const card = h("section","rm-component-card");
  card.setAttribute("aria-label",title+" controls for "+item.label);
  card.dataset.component = part; card.dataset.instance = item.id;
  const header = h("header","rm-card-head",h("div",null,h("div","rm-kicker",item.label),h("h2",null,title)));
  if (pop) header.append(iconAction("Pop out component controls",pop,"pop"));
  if (dock) header.append(iconAction("Dock component controls",dock,"collapse"));
  header.append(iconAction("Close component controls",close,"close")); card.append(header);
  return card;
}

export function componentCard({item,release,part,edit,apply,beginGesture,close,pop,dock,placement}:CardOptions) {
  const member=release.members.find(m=>m.id===part);
  const card=componentPanel(member?.label || item.label,item,part,close,pop,dock);
  const joints = release.joints.filter(j=>member?.controls?.includes(j.id) && (!j.locked || j.assumed));
  if (!joints.length) {
    card.append(h("p","rm-help","This part is fixed to its object."),action("Object placement",placement,"axis"));
    return card;
  }
  const axes=joints.flatMap(joint=>adjWords(joint).map(word=>({joint,word})));
  for (const axis of axes) {
    const pair=axis.word.pad;
    if (!pair || axis.word.key!==pair[0]) continue;
    const other=axes.find(a=>a.word.key===pair[1]);
    if (other) card.append(directionPad(axis,other,item,apply,card,beginGesture));
  }
  const paired=new Set(axes.filter(axis=>axis.word.pad?.every(key=>axes.some(a=>a.word.key===key))).map(axis=>axis.word.key));
  const precise=h("details","rm-disclosure",h("summary",null,"Exact adjustments"));
  for (const joint of joints) {
    const angle=joint.type!=="prismatic", scale=angle ? 180/Math.PI : 1000, unit=angle ? "°" : "mm";
    const pose=item.pose[joint.id] ?? joint.neutral, values=Array.isArray(pose) ? [...pose] : [pose];
    const labels=joint.type==="ball" ? ["Roll","Pitch","Yaw"] : [""];
    labels.forEach((axis,k)=>{
      const name=[joint.label ?? joint.id,axis].filter(Boolean).join(" · ");
      const row=h("div","rm-adjust-row",h("span","rm-adjust-name",name));
      const offset=Array.isArray(joint.neutral) ? joint.neutral[k] : 0;
      const range=h("input"); range.type="range"; range.min=String((joint.lower+offset)*scale); range.max=String((joint.upper+offset)*scale);
      const exact=h("input"); exact.type="number"; exact.step="any"; exact.min=range.min; exact.max=range.max;
      const lo=Number(range.min), hi=Number(range.max);
      range.step=String(Math.min(angle ? 0.1 : 1,(hi-lo)/200 || 1));
      const initial=displayNumber(values[k]*scale,3);
      range.value=initial;exact.value=initial;
      range.setAttribute("aria-label",name);exact.setAttribute("aria-label",name+" in "+(angle?"degrees":"millimetres"));
      range.dataset.joint=joint.id;exact.dataset.joint=joint.id;
      const jointValue=(n:number)=>joint.type==="ball" ? values.map((v,i)=>i===k?n/scale:v) : n/scale;
      const commit=async(n:number)=>{
        if (!Number.isFinite(n) || n<lo-1e-6 || n>hi+1e-6) { exact.reportValidity();return; }
        const ok=await edit(joint,jointValue(n));
        if (!ok) {range.value=initial;exact.value=initial;}
      };
      const gesture=wirePoseGesture(range,card,beginGesture,[joint],()=>({[joint.id]:jointValue(range.valueAsNumber)}),
        ()=>{range.value=initial;exact.value=initial;});
      range.oninput=()=>{exact.value=displayNumber(range.valueAsNumber,2);gesture.input();};
      range.onchange=()=>{if(!gesture.handlesChange()) void commit(range.valueAsNumber);};
      exact.onchange=()=>{if(exact.value!=="" && exact.checkValidity()){range.value=exact.value;void commit(exact.valueAsNumber);}else exact.reportValidity();};
      exact.onkeydown=e=>{if(e.key==="Enter") {e.preventDefault();exact.blur();exact.focus({preventScroll:true});}};
      row.append(h("label","rm-adjust-value",exact,h("span",null,unit)),range);
      const key=joint.type==="ball" ? joint.id+":"+k : joint.id;
      (paired.has(key)?precise:card).append(row);
    });
  }
  if (paired.size) card.append(precise);
  if (joints.some(j=>Object.hasOwn(item.pose,j.id))) {
    card.append(action("Reset component",()=>void apply(Object.fromEntries(joints.map(j=>[j.id,null]))),"undo","rm-text-action"));
  }
  return card;
}

export function placeFloatingCard(frame:HTMLElement,x=frame.offsetLeft,y=frame.offsetTop) {
  const stage=frame.parentElement;
  if (!stage) return;
  frame.style.left=Math.max(4,Math.min(stage.clientWidth-frame.offsetWidth-4,x))+"px";
  frame.style.top=Math.max(4,Math.min(stage.clientHeight-frame.offsetHeight-4,y))+"px";
}

/** Live scene updates rebuild controls. Keep the keyboard on the same adjustment
 * and keep the user's open sections in each separate inspector. */
export function replaceComponentCard(container:HTMLElement,card:HTMLElement) {
  const previous=container.querySelector<HTMLElement>(".rm-component-card");
  const same=previous?.dataset.component===card.dataset.component && previous?.dataset.instance===card.dataset.instance;
  if (same && previous?.hasAttribute("data-pose-gesture")) return;
  const active=document.activeElement as HTMLElement|null;
  const moveFocus=!!active && active!==container && container.contains(active);
  const selector="input,button,select,textarea,summary,[tabindex]";
  function controlKey(el:HTMLElement) {
    const label=el.getAttribute("aria-label") || el.title || el.getAttribute("name") ||
      (el.matches('input[type="checkbox"]') ? el.closest("label")?.textContent : el.textContent);
    return [el.tagName,el.getAttribute("type"),label?.trim()].join("/");
  }
  const focusKey=same && moveFocus ? controlKey(active!) : undefined;
  const opened=new Set(same ? [...previous!.querySelectorAll("details[open] > summary")].map(s=>s.textContent) : []);
  container.replaceChildren(card);
  const heading=card.querySelector<HTMLElement>("h2")!;
  heading.tabIndex=-1;
  function restore() {
    for (const details of card.querySelectorAll("details"))
      if (opened.has(details.querySelector(":scope > summary")?.textContent ?? "")) details.open=true;
    if (!moveFocus || (document.activeElement!==document.body && document.activeElement!==heading)) return;
    const match=focusKey && [...card.querySelectorAll<HTMLElement>(selector)].find(el=>controlKey(el)===focusKey);
    (match || heading).focus({preventScroll:true});
  }
  restore();
  // Operator fields arrive after loading the selected avatar's control definitions.
  if (same && card.dataset.component==="@operator" && (moveFocus || opened.size) && !card.querySelector("select")) {
    const observer=new MutationObserver(()=>{
      observer.disconnect();
      if (card.isConnected) restore();
    });
    observer.observe(card,{subtree:true,childList:true});
  }
}

type PadAxis = {joint:RoomJoint; word:AdjWord};
// Native ranges supply input events. A pad supplies its position from pointer events.
// Both hold one local gesture until release, including when the pointer leaves the card.
function wirePoseGesture(control:HTMLElement,card:HTMLElement,begin:BeginPoseGesture,joints:RoomJoint[],
  values:()=>PoseValues,reset:()=>void,track?:(event:PointerEvent)=>void) {
  let pointer:number|null=null,gesture:ReturnType<BeginPoseGesture>|undefined;
  let changed=false,ignoreChange=false;
  function input() {
    if (gesture) {changed=true;gesture.update(values());}
    else if (ignoreChange) reset();
  }
  function stopListening() {
    window.removeEventListener("keydown",escape,true);
    window.removeEventListener("blur",abort);
  }
  function abort() {gesture?.cancel();}
  function escape(e:KeyboardEvent) {
    if (e.key!=="Escape") return;
    e.preventDefault();e.stopPropagation();abort();
  }
  function finish(event:PointerEvent,commit:boolean) {
    if (event.pointerId!==pointer) return;
    if (commit && track && gesture) {track(event);input();}
    const active=gesture;
    gesture=undefined;pointer=null;stopListening();
    if (commit && changed) active?.commit(values()); else active?.cancel();
    if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
    // A native range can emit change as its default action after pointerup.
    setTimeout(()=>{if(pointer===null)ignoreChange=false;},0);
  }
  control.addEventListener("pointerdown",e=>{
    if (!e.isPrimary || e.button!==0 || gesture) return;
    pointer=e.pointerId;changed=false;ignoreChange=true;
    gesture=begin(card,joints,()=>{gesture=undefined;stopListening();reset();});
    control.setPointerCapture(e.pointerId);
    window.addEventListener("keydown",escape,true);window.addEventListener("blur",abort);
    if (track) {track(e);input();}
  });
  control.addEventListener("pointermove",e=>{if (track && gesture && e.pointerId===pointer) {track(e);input();}});
  control.addEventListener("pointerup",e=>finish(e,true));
  control.addEventListener("pointercancel",e=>finish(e,false));
  control.addEventListener("lostpointercapture",e=>finish(e,false));
  return {input,handlesChange:()=>ignoreChange};
}

function directionPad(x:PadAxis,y:PadAxis,item:RoomInstance,apply:CardOptions["apply"],card:HTMLElement,begin:BeginPoseGesture) {
  const axes=[x,y], title=x.word.padLabel ?? "Adjust direction";
  const thumb=h("i"), pad=h("div","rm-direction-pad",thumb);
  pad.tabIndex=0; pad.setAttribute("role","group"); pad.setAttribute("aria-label",title);
  pad.setAttribute("aria-description","Use the arrow keys to adjust the two axes.");
  const range=axes.map(({joint,word})=>{
    const offset=Array.isArray(joint.neutral)?joint.neutral[word.comp!]:0;
    const value=item.pose[joint.id] ?? joint.neutral;
    const current=Array.isArray(value)?value[word.comp!]:value;
    const lo=joint.lower+offset, span=joint.upper-joint.lower;
    const fraction=span ? (current-lo)/span : 0.5;
    return {lo,span,fraction:word.flip ? 1-fraction : fraction};
  });
  const clamp=(value:number)=>Math.max(0,Math.min(1,value));
  let point=range.map(r=>clamp(r.fraction));
  function paint() {thumb.style.left=point[0]*100+"%";thumb.style.top=(1-point[1])*100+"%";}
  function currentValues() {
    const values:Record<string,JointValue>={};
    axes.forEach(({joint,word},n)=>{
      const value=range[n].lo+(word.flip ? 1-point[n] : point[n])*range[n].span;
      if (word.comp===null) values[joint.id]=value;
      else {
        const previous=values[joint.id] ?? item.pose[joint.id] ?? joint.neutral;
        if (Array.isArray(previous)) {const next=[...previous];next[word.comp]=value;values[joint.id]=next;}
      }
    });
    return values;
  }
  const reset=()=>{point=range.map(r=>r.fraction);paint();};
  function track(event:PointerEvent) {
    const box=pad.getBoundingClientRect();
    point=[clamp((event.clientX-box.left)/box.width),clamp((box.bottom-event.clientY)/box.height)];paint();
  }
  wirePoseGesture(pad,card,begin,axes.map(a=>a.joint),currentValues,reset,track);
  pad.onkeydown=e=>{
    const deltas:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
    const delta=deltas[e.key];if (!delta) return;
    e.preventDefault();point=point.map((v,n)=>clamp(v+delta[n]*(e.shiftKey?0.1:0.01)));paint();
    void apply(currentValues()).then(ok=>{if (!ok) reset();});
  };
  paint();
  return h("div","rm-direction",h("strong",null,title),h("small",null,y.word.hi),
    h("div","rm-direction-row",h("small",null,x.word.lo),pad,h("small",null,x.word.hi)),h("small",null,y.word.lo));
}

export function floatingCard(stage:HTMLElement,index:number) {
  const frame=h("aside","rm-floating-card");frame.setAttribute("role","dialog");
  frame.tabIndex=-1;
  stage.append(frame);
  placeFloatingCard(frame,20+24*(index%5),48+24*(index%5));
  let drag:{id:number;x:number;y:number;left:number;top:number}|undefined;
  frame.addEventListener("pointerdown",e=>{
    const target=e.target as Element;
    if (e.button!==0 || !target.closest(".rm-card-head") || target.closest("button")) return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:frame.offsetLeft,top:frame.offsetTop};
    frame.focus({preventScroll:true});
    frame.setPointerCapture(e.pointerId);e.preventDefault();
  });
  frame.onpointermove=e=>{
    if(drag?.id!==e.pointerId)return;
    placeFloatingCard(frame,drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);
  };
  frame.onpointerup=frame.onpointercancel=()=>{drag=undefined;};
  frame.onkeydown=e=>{
    if (!e.altKey || !(e.target===frame || (e.target as Element).closest(".rm-card-head"))) return;
    const dx=e.key==="ArrowLeft" ? -16 : e.key==="ArrowRight" ? 16 : 0;
    const dy=e.key==="ArrowUp" ? -16 : e.key==="ArrowDown" ? 16 : 0;
    if (dx || dy) { e.preventDefault(); placeFloatingCard(frame,frame.offsetLeft+dx,frame.offsetTop+dy); }
  };
  return frame;
}
