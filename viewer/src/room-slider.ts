import { h } from "./dom.ts";
import { displayNumber } from "./room-controls.ts";

export interface Drag {
  update(): void;
  commit(): void;
  cancel(): void;
}

export interface SliderSpec {
  key: string;
  label: string;
  unit: string;
  value: number;
  step: number;
  /** The track can cover a useful interval even when exact entry is unbounded. */
  low: number;
  high: number;
  min?: number;
  max?: number;
}

export type BeginSlider = (read: () => number, reset: () => void) => Drag;

export function sliderRow(
  spec: SliderSpec,
  save: (value: number) => Promise<boolean>,
  begin: BeginSlider,
  focusKey: string,
) {
  const label = h("span", "rm-adjust-name", spec.label);
  const range = h("input");
  range.type = "range";
  range.min = String(Math.min(spec.low, spec.value));
  range.max = String(Math.max(spec.high, spec.value));
  range.step = String(spec.step);
  range.setAttribute("aria-label", spec.label);
  range.dataset.focus = focusKey + "/slider";

  const exact = h("input");
  exact.type = "number";
  exact.step = "any";
  exact.required = true;
  exact.name = spec.key;
  if (spec.min !== undefined) exact.min = String(spec.min);
  if (spec.max !== undefined) exact.max = String(spec.max);
  exact.setAttribute("aria-label", spec.label + " (" + spec.unit + ")");
  exact.dataset.focus = focusKey + "/value";
  exact.title = "Type an exact value";

  const valueLabel = h("label", "rm-adjust-value", exact, h("span", null, spec.unit));
  const row = h("div", "rm-adjust-row", label, range, valueLabel);
  let saved = spec.value;

  function show(value: number) {
    range.value = String(value);
    exact.value = document.activeElement === exact ? String(value) : displayNumber(value, 3);
    range.setAttribute("aria-valuetext", exact.value + " " + spec.unit);
  }
  function reset() { show(saved); }

  async function commit(value: number) {
    if (value === saved) return reset();
    const previous = saved;
    saved = value;
    show(value);
    if (!await save(value) && saved === value) {
      saved = previous;
      reset();
    }
  }
  function finish(accept: boolean) {
    if (!row.hasAttribute("data-typing")) return;
    delete row.dataset.typing;
    if (accept && exact.validity.valid) void commit(exact.valueAsNumber);
    else reset();
    row.dispatchEvent(new Event("room-edit-end", {bubbles:true}));
  }
  exact.onfocus = () => {
    exact.value = String(saved);
    exact.select();
  };
  exact.oninput = () => { row.dataset.typing = ""; };
  exact.onblur = () => { finish(true); reset(); };
  exact.onkeydown = event => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (exact.reportValidity()) finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };

  const drag = wireDrag(range, cancel => begin(() => range.valueAsNumber, cancel), reset);
  range.oninput = () => {
    exact.value = displayNumber(range.valueAsNumber, 3);
    range.setAttribute("aria-valuetext", exact.value + " " + spec.unit);
    drag.input();
  };
  range.onchange = () => { if (!drag.handlesChange()) void commit(range.valueAsNumber); };
  show(saved);
  return { row, range, exact };
}

// Native ranges supply input events. A pad supplies its position from pointer events.
// Both hold one local gesture until release, including when the pointer leaves the card.
export function wireDrag(control:HTMLElement, begin:(reset:()=>void)=>Drag, reset:()=>void, track?:(event:PointerEvent)=>void) {
  let pointer:number|null=null,gesture:Drag|undefined;
  let changed=false,ignoreChange=false;
  function input() {
    if (gesture) {changed=true;gesture.update();}
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
    if (commit && changed) active?.commit(); else active?.cancel();
    if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
    // A native range can emit change as its default action after pointerup.
    setTimeout(()=>{if(pointer===null)ignoreChange=false;},0);
  }
  control.addEventListener("pointerdown",e=>{
    if (!e.isPrimary || e.button!==0 || gesture) return;
    pointer=e.pointerId;changed=false;ignoreChange=true;
    gesture=begin(()=>{gesture=undefined;stopListening();reset();});
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
