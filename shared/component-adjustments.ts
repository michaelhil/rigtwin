// Relate picked surfaces to the joints that users can actually operate. A surface inherits its
// housing. Functional units (e.g. a joystick base and lever) use the same grouping as the station viewer.
import type { Manifest } from "./manifest.ts";
import { UNITS, WHOLE_ROWS } from "./words.ts";

export function componentAdjustments(manifest:Manifest): Map<string,string[]> {
  const parts=new Map([...manifest.components,...manifest.surfaces].map(p=>[p.id,p]));
  const result=new Map<string,string[]>();
  for (const part of parts.values()) {
    const owner=part.kind==="surface" && part.parent ? parts.get(part.parent) ?? part : part;
    const unit=UNITS.find(u=>u.parts.includes(owner.id));
    // The first pick on a seat or pedal belongs to that functional group.
    const scope=WHOLE_ROWS.includes(owner.group ?? "") ? [...parts.values()].filter(p=>p.group===owner.group).map(p=>p.id) :
      unit?.parts ?? [owner.id];
    const carried=new Set<string>();
    for (const id of scope) {
      let current=parts.get(id);
      while (current && current.group===owner.group && !carried.has(current.id)) {
        carried.add(current.id);current=current.parent ? parts.get(current.parent) : undefined;
      }
    }
    if (owner.assembly) {
      for (const p of parts.values()) {
        let current:typeof p | undefined=p;
        const seen=new Set<string>();
        while (current && !seen.has(current.id)) {
          if (current.id===owner.id) {carried.add(p.id);break;}
          seen.add(current.id);current=current.parent ? parts.get(current.parent) : undefined;
        }
      }
    }
    result.set(part.id,manifest.joints.filter(j=>carried.has(j.child)).map(j=>j.id));
  }
  return result;
}
