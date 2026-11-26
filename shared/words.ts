// Plain-language wording, shared by the page and the commands: names of parts, what a click picks first, and how each
// adjustment is called, with a word for each end of its travel. Pure data plus small formatters;
// nothing here touches the model. Everything falls back to the description file's own labels, so a
// part or joint added later still appears (with its generated name) until a word is written for it.
import type { ManifestComponent, ManifestJoint } from './manifest.ts';

// ---------------------------------------------------------------------------------------------- parts
export const TOUCHSCREEN_NAMES = ["touchscreen", "touch screen", "tablet", "side screen", "little monitor", "small screen"];

/** Rows of the parts list (a group of the description file, or one of its assemblies). */
const ROW_NAMES: Record<string, string> = {
  platform: 'Platform', seat: 'Seat', pods: 'Armrests', stand: 'Monitor stand', pedals: 'Pedals',
  C_pod_L: 'Left armrest', C_pod_R: 'Right armrest',
};
/** [full name, name inside its own row]; `$s` is "Left"/"Right", `$n` a number. */
const PART_RULES: [RegExp, string, string?][] = [
  [/^C_platform$/, 'Platform deck', 'Deck'],
  [/^C_platform_fitting_(\d+)$/, 'Deck pull handle $n', 'Pull handle $n'],
  [/^C_seat_pedestal$/, 'Seat pedestal', 'Pedestal'],
  [/^C_seat_carrier$/, 'Seat mount', 'Mount'],
  [/^C_seat_base$/, 'Seat frame', 'Frame'],
  [/^C_seat_pan$/, 'Seat cushion', 'Cushion'],
  [/^C_seat_hub_([LR])$/, '$s backrest hinge cover', '$s hinge cover'],
  [/^C_seat_back_shell$/, 'Backrest shell'],
  [/^C_seat_back_cushion$/, 'Backrest cushion'],
  [/^C_seat_headrest$/, 'Headrest'],
  [/^C_pod_shell_([LR])$/, '$s armrest housing', 'Housing'],
  [/^C_pod_plate_([LR])$/, '$s armrest top plate', 'Top plate'],
  [/^C_pod_armrest_([LR])$/, '$s armrest pad', 'Armrest pad'],
  [/^C_joy_base_([LR])$/, '$s joystick base', 'Joystick base'],
  [/^C_joy_lever_([LR])$/, '$s joystick grip', 'Joystick grip'],
  [/^C_pod_keyswitch_([LR])$/, '$s key switch', 'Key switch'],
  [/^C_pod_button_([LR])_(\d+)$/, '$s button $n', 'Button $n'],
  [/^C_pod_estop_[LR]$/, 'Emergency stop'],
  [/^C_ts_arm$/, 'Touchscreen arm'],
  [/^C_ts_screen$/, 'Touchscreen display'],
  [/^C_stand_column_([LR])$/, '$s stand column', '$s column'],
  [/^C_stand_shelf$/, 'Shelf'],
  [/^C_stand_soundbar$/, 'Soundbar'],
  [/^C_stand_monarm$/, 'Monitor arm'],
  [/^C_stand_monitor$/, 'Monitor'],
  [/^C_pedal_base$/, 'Pedal base'],
  [/^C_pedal_arm_1$/, 'Left pedal'], [/^C_pedal_arm_2$/, 'Middle pedal'], [/^C_pedal_arm_3$/, 'Right pedal'],
];
/** A generated label made presentable: no bracketed detail, no builder's words. */
export function tidyLabel(label: string): string {
  const s = label.replace(/\s*\([^)]*\)/g, '').replace(/\s+assembly$/i, '').replace(/\bpod\b/gi, 'armrest').replace(/\bactive area\b/gi, 'screen').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : label;
}
function fill(t: string, m: RegExpMatchArray): string {
  const side = m.slice(1).find((x) => x === 'L' || x === 'R'), num = m.slice(1).find((x) => /^\d+$/.test(x));
  return t.replace('$s', side === 'L' ? 'Left' : side === 'R' ? 'Right' : '').replace('$n', num ?? '').trim();
}
/** Plain name of a part: `full` stands alone (card, pointer label), `short` is used inside its row of the list. */
export function partName(it: Pick<ManifestComponent, 'id' | 'label'>): { full: string; short: string } {
  for (const [re, full, short] of PART_RULES) { const m = it.id.match(re); if (m) return { full: fill(full, m), short: fill(short ?? full, m) }; }
  const t = tidyLabel(it.label); return { full: t, short: t };
}
export const rowName = (id: string, fallback: string) => ROW_NAMES[id] ?? tidyLabel(fallback);

/** Things made of several parts that a first click picks as one (a second click picks the single part). */
export const UNITS: { id: string; name: string; parts: string[] }[] = [
  { id: 'joystick_L', name: 'Left joystick', parts: ['C_joy_base_L', 'C_joy_lever_L'] },
  { id: 'joystick_R', name: 'Right joystick', parts: ['C_joy_base_R', 'C_joy_lever_R'] },
  { id: 'touchscreen', name: 'Touchscreen', parts: ['C_ts_arm', 'C_ts_screen'] },
];
/** Rows that a first click on any of their parts picks as a whole. */
export const WHOLE_ROWS = ['platform', 'seat', 'pedals'];

// ---------------------------------------------------------------------------------------------- how sizes are known
export const CLASS_ORDER = ['measured', 'vendor', 'photo', 'assumed', 'invented'];
export const CLASS_WORDS: Record<string, string> = {
  measured: 'measured on the rig', vendor: "from the maker's drawing", photo: 'measured in photos', assumed: 'estimated', invented: 'stand-in shape', none: 'no sizes of its own',
};
/** "7 values from the maker's drawing, 2 measured in photos, 9 estimated, 1 placeholder" */
export function knownAs(counts: Record<string, number>): string {
  const parts = CLASS_ORDER.filter((c) => counts[c]).map((c, i) => `${counts[c]} ${i === 0 ? (counts[c] === 1 ? 'value ' : 'values ') : ''}${c === 'invented' ? (i === 0 ? 'as placeholders' : counts[c] === 1 ? 'placeholder' : 'placeholders') : CLASS_WORDS[c]}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------- adjustments
/** One number a person can change: a joint, or one angle of a three-angle mount (`comp`). */
export interface AdjWord {
  key: string; joint: string; comp: number | null;
  label: string; lo: string; hi: string;
  /** shown the other way round (the joint's positive direction is the word on the left) */
  flip: boolean;
  /** heading the control sits under when a card holds several things */
  section: string; order: number;
  /** the other half of a two-direction pad: [key of the left-right value, key of the up-down value] */
  pad?: [string, string]; padLabel?: string;
  /** tucked under "Fine adjustments" */
  fine?: boolean;
  /** what the value 0 means, for agents ("backrest vertical", "as photographed"); empty for a joint without a rule */
  zero: string;
  /** other everyday names people use for this adjustment (agents resolve targets with them) */
  aliases: string[];
}
type Rule = [RegExp, number | null, Partial<AdjWord> & { label: string; lo: string; hi: string; section: string; order: number; zero: string; aliases: string[] }];
const ADJ_RULES: Rule[] = [
  [/^J_seat_slide$/, null, { label: 'Forward / back', lo: 'back', hi: 'forward', section: 'Seat position', order: 10, zero: 'as photographed', aliases: ['seat slide', 'seat fore aft', 'chair forward', 'slide the seat'] }],
  [/^J_seat_height$/, null, { label: 'Height', lo: 'lower', hi: 'higher', section: 'Seat position', order: 11, zero: 'as photographed', aliases: ['seat height', 'chair height', 'raise the seat', 'lower the seat'] }],
  [/^J_seat_recline$/, null, { label: 'Recline', lo: 'upright', hi: 'reclined', section: 'Backrest', order: 12, zero: 'backrest vertical', aliases: ['backrest', 'back rest', 'seat back', 'backrest angle', 'recline', 'lean back', 'straighten the back'] }],
  [/^J_seat_swivel$/, null, { label: 'Swivel', lo: 'right', hi: 'left', section: 'Turn and tilt', order: 13, zero: 'facing straight ahead, as photographed', aliases: ['swivel', 'turn the seat', 'seat rotation', 'chair turn'] }],
  [/^J_seat_tilt$/, null, { label: 'Seat tilt', lo: 'back', hi: 'forward', section: 'Turn and tilt', order: 14, zero: 'as photographed', aliases: ['seat tilt', 'cushion tilt', 'seat pan angle'] }],
  [/^J_pod_armrest_([LR])$/, null, { label: 'Forward / back', lo: 'back', hi: 'forward', section: '$s armrest pad', order: 20, zero: 'as photographed', aliases: ['armrest', 'arm rest', 'armrest pad', 'elbow rest'] }],
  [/^J_joy_([LR])_roll$/, null, { label: 'Left / right', lo: 'left', hi: 'right', section: '$s joystick', order: 30, pad: ['J_joy_$S_roll', 'J_joy_$S_pitch'], padLabel: 'Push the stick', zero: 'stick centred', aliases: ['joystick sideways', 'stick left right'] }],
  [/^J_joy_([LR])_pitch$/, null, { label: 'Forward / back', lo: 'back', hi: 'forward', section: '$s joystick', order: 31, pad: ['J_joy_$S_roll', 'J_joy_$S_pitch'], padLabel: 'Push the stick', zero: 'stick centred', aliases: ['joystick forward back', 'push the stick'] }],
  [/^J_ts_arm$/, 0, { label: 'Lean sideways', lo: 'left', hi: 'right', section: 'Touchscreen arm', order: 40, pad: ['J_ts_arm:0', 'J_ts_arm:1'], padLabel: 'Lean the arm', zero: 'an angle of the arm\'s own mount frame; use by, or to as photographed', aliases: ['touchscreen arm', 'screen arm'] }],
  [/^J_ts_arm$/, 1, { label: 'Lean', lo: 'back', hi: 'forward', section: 'Touchscreen arm', order: 41, pad: ['J_ts_arm:0', 'J_ts_arm:1'], padLabel: 'Lean the arm', zero: 'an angle of the arm\'s own mount frame; use by, or to as photographed', aliases: ['touchscreen arm', 'screen arm'] }],
  [/^J_ts_arm$/, 2, { label: 'Twist', lo: 'right', hi: 'left', section: 'Touchscreen arm', order: 42, fine: true, zero: 'an angle of the arm\'s own mount frame; use by, or to as photographed', aliases: ['touchscreen arm', 'screen arm'] }],
  [/^J_ts_screen$/, 2, { label: 'Turn', lo: 'left', hi: 'right', section: 'Touchscreen display', order: 50, pad: ['J_ts_screen:2', 'J_ts_screen:1'], padLabel: 'Turn and tilt the display', zero: 'an angle of the display\'s own mount frame; use by, or to as photographed', aliases: TOUCHSCREEN_NAMES }],
  [/^J_ts_screen$/, 1, { label: 'Tilt', lo: 'down', hi: 'up', section: 'Touchscreen display', order: 51, pad: ['J_ts_screen:2', 'J_ts_screen:1'], padLabel: 'Turn and tilt the display', zero: 'an angle of the display\'s own mount frame; use by, or to as photographed', aliases: TOUCHSCREEN_NAMES }],
  [/^J_ts_screen$/, 0, { label: 'Level', lo: 'left side down', hi: 'right side down', section: 'Touchscreen display', order: 52, fine: true, zero: 'an angle of the display\'s own mount frame; use by, or to as photographed', aliases: TOUCHSCREEN_NAMES }],
  [/^J_mon_height$/, null, { label: 'Height', lo: 'lower', hi: 'higher', section: 'Monitor', order: 60, zero: 'as photographed', aliases: ['monitor height', 'screen height', 'display height', 'raise the monitor', 'lower the monitor'] }],
  [/^J_mon_pan$/, null, { label: 'Turn', lo: 'left', hi: 'right', section: 'Monitor', order: 61, pad: ['J_mon_pan', 'J_mon_tilt'], padLabel: 'Turn and tilt', zero: 'facing the operator straight on, as photographed', aliases: ['monitor turn', 'monitor pan', 'rotate the monitor', 'screen turn'] }],
  [/^J_mon_tilt$/, null, { label: 'Tilt', lo: 'down', hi: 'up', section: 'Monitor', order: 62, pad: ['J_mon_pan', 'J_mon_tilt'], padLabel: 'Turn and tilt', zero: 'screen face vertical', aliases: ['monitor tilt', 'screen tilt', 'display tilt', 'monitor angle'] }],
  [/^J_pedal_tray$/, null, { label: 'Forward / back', lo: 'back', hi: 'forward', section: 'Pedal tray', order: 70, zero: 'as photographed', aliases: ['pedal tray', 'pedal position', 'move the pedals', 'footrest'] }],
  [/^J_pedal_1$/, null, { label: 'Left pedal', lo: 'released', hi: 'pressed', section: 'Press', order: 71, zero: 'released', aliases: ['left pedal', 'pedal 1'] }],
  [/^J_pedal_2$/, null, { label: 'Middle pedal', lo: 'released', hi: 'pressed', section: 'Press', order: 72, zero: 'released', aliases: ['middle pedal', 'pedal 2', 'centre pedal'] }],
  [/^J_pedal_3$/, null, { label: 'Right pedal', lo: 'released', hi: 'pressed', section: 'Press', order: 73, zero: 'released', aliases: ['right pedal', 'pedal 3'] }],
  // the operator desk (assets/operator-desk)
  [/^J_desk_height$/, null, { label: 'Height', lo: 'lower', hi: 'higher', section: 'Desk', order: 80, zero: 'as photographed', aliases: ['desk height', 'table height', 'desktop height', 'raise the desk', 'lower the desk'] }],
  [/^J_small_tilt_1$/, null, { label: 'Tilt', lo: 'upright', hi: 'back', section: 'Left small display', order: 81, zero: 'screen face vertical', aliases: ['left small display tilt', 'small display 1', 'left desk monitor'] }],
  [/^J_small_tilt_2$/, null, { label: 'Tilt', lo: 'upright', hi: 'back', section: 'Middle small display', order: 82, zero: 'screen face vertical', aliases: ['middle small display tilt', 'small display 2', 'middle desk monitor'] }],
  [/^J_small_tilt_3$/, null, { label: 'Tilt', lo: 'upright', hi: 'back', section: 'Right small display', order: 83, zero: 'screen face vertical', aliases: ['right small display tilt', 'small display 3', 'right desk monitor'] }],
  [/^J_big_tilt_([LR])$/, null, { label: 'Tilt', lo: 'upright', hi: 'forward', section: '$s large display', order: 84, zero: 'screen face vertical', aliases: ['large display tilt', 'big display tilt', 'wall display tilt'] }],
];
/** Words whose left end is the joint's positive direction (so the control reads left-to-right as people expect). */
const LEFT_IS_POSITIVE = new Set(['right|left']);
export const adjKey = (joint: string, comp: number | null) => (comp === null ? joint : `${joint}:${comp}`);

/** The adjustments one joint offers, in plain words (three for a three-angle mount). */
export function adjWords(j: Pick<ManifestJoint, 'id' | 'type'>): AdjWord[] {
  const comps: (number | null)[] = j.type === 'ball' ? [0, 1, 2] : [null], out: AdjWord[] = [];
  for (const comp of comps) {
    const key = adjKey(j.id, comp);
    const hit = ADJ_RULES.find(([re, c]) => c === comp && re.test(j.id));
    if (!hit) {
      const name = tidyLabel(j.id.replace(/^J_/, '').replaceAll('_', ' ')) + (comp === null ? '' : ` ${['lean', 'tilt', 'turn'][comp]}`);
      out.push({ key, joint: j.id, comp, label: name, lo: 'less', hi: 'more', flip: false, section: 'Other', order: 900 + (comp ?? 0), zero: '', aliases: [] });
      continue;
    }
    const m = j.id.match(hit[0])!, S = m[1] === 'L' || m[1] === 'R' ? m[1] : '', s = S === 'L' ? 'Left' : S === 'R' ? 'Right' : '';
    const sub = (t: string) => t.replace('$s', s).replace('$S', S).trim().replace(/^[a-z]/, (c) => c.toUpperCase());
    const w = hit[2], flip = LEFT_IS_POSITIVE.has(`${w.lo}|${w.hi}`);
    out.push({
      key, joint: j.id, comp, label: w.label, lo: flip ? w.hi : w.lo, hi: flip ? w.lo : w.hi, flip, section: sub(w.section), order: w.order, zero: w.zero, aliases: w.aliases,
      ...(w.pad ? { pad: [sub(w.pad[0]), sub(w.pad[1])] as [string, string], padLabel: w.padLabel } : {}), ...(w.fine ? { fine: true } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- numbers for people
/** A length in centimetres or an angle in degrees, the way a person would say it. */
export function sayValue(v: number, unit: 'm' | 'rad', signed = true): string {
  if (unit === 'm') { const cm = Math.round(v * 1000) / 10; return `${signed && cm > 0 ? '+' : cm < 0 ? '−' : ''}${Math.abs(cm).toFixed(Math.abs(cm) % 1 ? 1 : 0)} cm`; }
  const d = Math.round((v * 180) / Math.PI * 2) / 2; return `${signed && d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(Math.abs(d) % 1 ? 1 : 0)}°`;
}
/** "5 cm back", "12° up", or "as photographed" when the value sits at its starting point. A travel that starts
 *  at zero (backrest, pedal) is said in full: "20° reclined". */
export function sayOffset(w: AdjWord, value: number, range: { lo: number; hi: number; neutral: number }, unit: 'm' | 'rad'): string {
  const d = (value - range.neutral) * (w.flip ? -1 : 1), tol = unit === 'm' ? 0.0005 : 0.0044;
  if (Math.abs(d) < tol) return 'as photographed';
  if (Math.abs(range.lo) < 1e-9 && !w.flip) return value < tol ? w.lo : `${sayValue(value, unit, false)} ${w.hi}`;
  return `${sayValue(Math.abs(d), unit, false)} ${d > 0 ? w.hi : w.lo}`;
}
/** A parameter value from the description file in everyday units. */
export function sayParam(given: unknown, unit: string, range: number | undefined): string {
  if (typeof given !== 'number') return 'a list of values';
  let v = given, u = unit;
  if (u === 'm') { v = given * 100; u = 'cm'; } else if (u === 'mm' && Math.abs(given) >= 100) { v = given / 10; u = 'cm'; } else if (u === 'rad') { v = (given * 180) / Math.PI; u = '°'; } else if (u === 'deg') u = '°';
  const num = +v.toPrecision(4), tail = u === '1' || u === 'ratio' || u === 'count' ? '' : u === '°' ? '°' : ` ${u}`;
  let tol = '';
  if (range !== undefined && (unit === 'm' || unit === 'mm' || unit === 'cm' || unit === 'in')) { const mm = range * 1000; tol = mm >= 10 ? ` ± ${+(mm / 10).toPrecision(2)} cm` : ` ± ${+mm.toPrecision(2)} mm`; }
  else if (range !== undefined && (unit === 'deg' || unit === 'rad')) tol = ` ± ${+((range * 180) / Math.PI).toPrecision(2)}°`;
  return `${num}${tail}${tol}`;
}
/** "joystick.grip_top_height" -> "Grip top height" */
export const sayKey = (key: string) => { const s = key.split('.').slice(1).join(' ').replaceAll('_', ' ') || key; return s[0].toUpperCase() + s.slice(1); };

// ---------------------------------------------------------------------------------------------- one name for each adjustment
// Used by the page (activity line) and by the commands (bun run rig), so Claude Code and the page name an
// adjustment the same way: "Monitor: height", and with a value "Monitor: height 3 cm lower".
type JointDef = Pick<ManifestJoint, 'id' | 'type' | 'lower' | 'upper' | 'neutral' | 'unit'>;
/** "Monitor: height"; a three-angle mount by its heading alone ("Touchscreen arm"). */
export function jointName(j: JointDef): string {
  const w = adjWords(j)[0];
  return j.type === 'ball' ? w.section : `${w.section}: ${w.label.toLowerCase()}`;
}
/** "Monitor: height 3 cm lower" for an SI value; a three-angle mount by its name alone. */
export function sayJoint(j: JointDef, value: number | number[]): string {
  if (j.type === 'ball' || Array.isArray(value)) return jointName(j);
  return `${jointName(j)} ${sayOffset(adjWords(j)[0], value, { lo: j.lower, hi: j.upper, neutral: j.neutral as number }, j.unit)}`;
}
