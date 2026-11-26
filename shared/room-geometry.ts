import { roomPoint, type RoomInstance, type RoomRelease, type RoomScene } from "./room.ts";

type XY = [number, number];
export interface DoorGap { metres: number; edges: [string, string]; points: [XY, XY] }
export interface DoorClearance extends DoorGap { opening: DoorGap & { blockers: string[] } }
type Footprint = { id: string; vertices: XY[] };
// Traversing the release-local box counter-clockwise. Names stay with the object as it turns.
const SIDES = ["min-y", "max-x", "max-y", "min-x"];
const side = (p: Footprint, i: number) => p.id + "/footprint." + SIDES[i];
const EPS = 1e-10;

export function footprint(instance: RoomInstance, release: RoomRelease): Footprint {
  const { min, max } = release.footprint;
  const local: XY[] = [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]];
  return { id: instance.id, vertices: local.map(([x, y]) => {
    const world = roomPoint(instance, [x, y, 0]);
    return [world[0], world[1]];
  }) };
}

type Intersection = { start: number; end: number; left: string; right: string; id: string };
/** Clip a convex footprint against y = 0, then against the finite doorway segment. */
function across(p: Footprint, lo: number, hi: number): Intersection | null {
  const hits: { x: number; edge: string }[] = [];
  p.vertices.forEach(([x, y], i) => {
    const [u, v] = p.vertices[(i + 1) % 4], edge = side(p, i);
    if (Math.abs(y) < EPS) hits.push({ x, edge });
    if ((y < -EPS && v > EPS) || (y > EPS && v < -EPS)) hits.push({ x: x + (u - x) * y / (y - v), edge });
    if (Math.abs(v) < EPS) hits.push({ x: u, edge });
  });
  if (!hits.length) return null;
  hits.sort((a, b) => a.x - b.x);
  const first = hits[0], last = hits[hits.length - 1];
  if (first.x > hi + EPS || last.x < lo - EPS) return null;
  return { start: Math.min(hi, Math.max(lo, first.x)), end: Math.max(lo, Math.min(hi, last.x)),
    left: first.x < lo - EPS ? p.id + "/footprint.interior" : first.edge,
    right: last.x > hi + EPS ? p.id + "/footprint.interior" : last.edge, id: p.id };
}

function closest(point: XY, a: XY, b: XY): XY {
  const dx = b[0] - a[0], dy = b[1] - a[1], denom = dx * dx + dy * dy;
  const t = denom === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denom));
  return [a[0] + t * dx, a[1] + t * dy];
}

function gap(p: Footprint, lo: number, hi: number, hit?: Intersection): DoorGap {
  const threshold = "door/threshold", a: XY = [lo, 0], b: XY = [hi, 0];
  if (hit) return { metres: 0, edges: [threshold, hit.left], points: [[hit.start, 0], [hit.start, 0]] };
  let best: DoorGap = { metres: Infinity, edges: [threshold, ""], points: [a, a] };
  function candidate(door: XY, object: XY, edge: string) {
    const d = Math.hypot(door[0] - object[0], door[1] - object[1]);
    if (d < best.metres) best = { metres: d, edges: [threshold, edge], points: [door, object] };
  }
  p.vertices.forEach((c, i) => {
    const d = p.vertices[(i + 1) % 4], edge = side(p, i);
    candidate(a, closest(a, c, d), edge);
    candidate(b, closest(b, c, d), edge);
    candidate(closest(c, a, b), c, edge);
    candidate(closest(d, a, b), d, edge);
  });
  return best;
}

/** Shortest plan distance to the selected footprint; longest continuous clear width at the doorway.
 * The first point of the approach is always on the threshold. Equal-width openings use the western one. */
export function doorClearance(scene: RoomScene, instance: RoomInstance, releases: RoomRelease[]): DoorClearance {
  const lo = scene.room.door.offset, hi = lo + scene.room.door.width;
  const footprints = scene.instances.map(item => {
    const release = releases.find(r => r.id === item.release);
    if (!release) throw new Error("Missing pinned release " + item.release);
    return footprint(item, release);
  });
  const selected = footprints.find(p => p.id === instance.id);
  if (!selected) throw new Error("Missing instance " + instance.id);
  const blocks = footprints.map(p => across(p, lo, hi)).filter((b): b is Intersection => b !== null)
    .sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  let start = lo, left = "door/west-jamb";
  let opening: DoorGap = { metres: 0, points: [[lo, 0], [lo, 0]], edges: [left, blocks[0]?.left ?? left] };
  function consider(end: number, right: string) {
    if (end - start > opening.metres + EPS) opening = { metres: end - start, points: [[start, 0], [end, 0]], edges: [left, right] };
  }
  for (const block of blocks) {
    consider(block.start, block.left);
    if (block.end > start) { start = block.end; left = block.right; }
  }
  consider(hi, "door/east-jamb");
  return { ...gap(selected, lo, hi, blocks.find(b => b.id === selected.id)), opening: { ...opening, blockers: blocks.map(b => b.id) } };
}
