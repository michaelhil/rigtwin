---
title: Decomposition and connections
tldr: How an object is split into components - one structural tree plus tags for function - how connections and pivots are established from photos and recorded, and the real tree of Rig B as built, with its 20 joints and 14 reference frames.
status: living
updated: 2026-11-23
tags: [method, decomposition, joints, datums]
---

# Decomposition and connections

## TL;DR

- **One tree.** A part's parent is whatever carries it and moves it. What the operator sees, touches or sits on is expressed as tags and reference frames on that tree, never as a second tree.
- A thing gets its own node only if it moves, is adjustable, is replaceable, is purchased, is something the operator uses or touches, needs its own material, or is a reference frame. Otherwise it stays inside its parent.
- A connection is three records: the parent link, a **mount frame** given by parameters, and a **joint** (type, axis, limits, neutral, kind, evidence, locked). Pivots sit on the physical axis.
- The spec carries an **expected-motion table**; every check run poses each joint and compares what moved with that table.
- Rig B as built: 5 groups, 46 components with geometry, 2 screen surfaces, 7 assemblies, 20 joints (6 assumed and locked), 14 reference frames.

Terms: node, joint, datum (reference frame), mount frame, surface are in the
[glossary](../00-overview/glossary.md). Formats are in the [asset contract](asset-contract.md).

## Method

### Two views, one tree

| View | Question it answers | How it is stored |
|---|---|---|
| Structural | What is a separate rigid body? What carries what? What moves when a joint moves? | the node hierarchy; exactly one parent per node |
| Functional (human factors) | What does the operator see, touch, sit on? What must an assessment or simulator find? | `tags` on nodes; reference frames (`D_`) and screen surfaces (`S_`) as children of the node they belong to |

When the two disagree, the structure wins: the touchscreen is a display, but it hangs on the right
armrest pod, so it lives under that pod and carries the tags `display` and `control`.

### When something gets its own node

| # | Criterion | Example on Rig B |
|---|---|---|
| N1 | It moves relative to its carrier | joystick lever, backrest, pedal arm |
| N2 | Its position is adjustable | armrest pad, monitor, touchscreen |
| N3 | It could be replaced by a variant | monitor, soundbar |
| N4 | It is a purchased item with maker's dimensions | monitor, touchscreen, pedal set, joystick |
| N5 | The operator sees, operates or rests on it | emergency stop, armrest pad, seat cushion |
| N6 | It needs its own material or its own handling | a screen's lit area |
| N7 | It is a reference frame | grip point, pedal face, eye point |

**Stopping rule.** If no assessment, no simulator behaviour and no variant needs the node, merge
it. Screws, seams, stitching and styling creases stay in the parent mesh. Buttons on a joystick
grip are part of the grip. Panel buttons, the key switch and the emergency stop **are** nodes,
because a simulator must be able to light and press them. A mechanism with more links than the
purpose needs is modelled by the pose it produces (the monitor arm's two links move as one piece).

### Order of work

1. **Hypothesis from the photos.** Inventory every visible thing per photo; group into bodies;
   find what carries each body; decide joints; apply the node criteria; tag; list what was not seen.
2. **Blockout.** A complete, crude model of the whole tree with every joint working. It tests the
   decomposition before effort goes into shapes.
3. **Freeze** the tree, the names and the joint list. Values never freeze.

Signs that the tree is wrong: a joint cannot move without tearing a mesh (a node is missing);
changing one parameter forces edits in two components (a mount frame is missing); two photos
disagree about a pose the tree calls rigid (an adjustment is missing).

In this run the first sign appeared twice after the blockout and was caught by the independent
reviewer, not by a check: the monitor left its arm when its height changed, and the joystick boot
tore when the lever moved. Fixes: a new node `C_stand_monarm_links` that rides the height joint,
and a boot split between the fixed base and the moving lever. The tree was therefore changed after
the blockout; the plan's formal freeze at a human gate was not exercised.

## Establishing connections from photos

Evidence, strongest first:

| # | Evidence | What to look for |
|---|---|---|
| E1 | Fastener at the contact | screws or clamps exactly where two bodies touch |
| E2 | Continuous load path | a bracket, arm or post traceable from the child to the parent |
| E3 | Floating test | the body reaches no other support, so what it touches must carry it |
| E4 | Co-variation | two bodies keep the same relative pose in every photo and on every rig while a third differs |
| E5 | Seams, gaps, material breaks | a step, a dark gap, a change of finish |
| E6 | Kind of mechanism | a round hub at a backrest means a recliner; a rubber bellows means a gimballed lever; a ball in a split socket means a ball joint |
| E7 | Absence | no rail, lever or slot visible: lowers confidence only |

Each joint carries an **evidence level**, separate from its range:

| Level | Rule | Consequence |
|---|---|---|
| `seen` | the motion or the mechanism is visible in a photo (E1, E2, or the part photographed in two poses) | free to move |
| `inferred` | follows from E3, E4, or E5 with E6 | free to move |
| `assumed` | E6 alone, or a typical feature of the product class | `locked = true`: scripts cannot move it without `force`; the viewer lets a person move it, tagged "assumed range" |

For each uncertain connection, write down the observation that would settle it. That list is the
shot list for the next site visit.

### Pivots sit on the physical axis

Never at the centre of a bounding box. Located, in order of preference, from:

| Method | On Rig B |
|---|---|
| A visible axle or hub cover | backrest recline: the line through the two round hub covers |
| The same part seen in two positions | armrest pad: further back on another rig, which gives the slide direction along the plate |
| The geometry of the mechanism | joystick: gimbal centre on the lever axis just above the plate; touchscreen arm: the centre of each ball; pedal: the hinge at the foot of the arm |
| A maker's drawing | joystick travel ±20° |
| Symmetry and tangency | seat swivel: the pedestal cylinder's axis |

## Representing a connection

```
node transform in its parent  =  [joint 1] · [joint 2] · … · pose(pos, rpy)
one joint                     =  pose(joint pos, joint rpy) · motion(value)
motion(value)                 =  rotation about `axis` (revolute, radians)
                                 translation along `axis` (prismatic, metres)
                                 Rz(yaw)·Ry(pitch)·Rx(roll) (ball; value = [roll, pitch, yaw])
```

- The **parent link** is the `parent` field of the node in the spec.
- The **mount frame** is `pos` and `rpy`: small expressions over parameter keys. Moving the stand
  5 cm changes one parameter and no geometry.
- The **joint record** names type, axis (in the joint frame), lower, upper, neutral, kind
  (`adjustment` or `control`), evidence, locked, and for controls a `signal` name a simulator can
  bind to. A node may list several joints; they are chained, outermost first.

There is one written definition of how a joint value becomes a transform (`shared/pose.ts`), used
by the generator and the viewer. An independent implementation in Python is compared with it on
96 test poses in every check run (C-13).

## Reference frames

Built from parameters by the spec, never placed by eye. Convention: metres; Z up; X forward
(operator toward the main display); Y to the operator's left; origin at the centre of the deck top.

Reference frames of Rig B (positions in the model frame, **as of round 2**):

| Frame | Child of | What it is | Position (m) |
|---|---|---|---|
| `D_origin` | root | centre of the deck top | 0, 0, 0 |
| `D_floor` | root | room floor under the deck centre | 0, 0, −0.200 |
| `D_seat_ref_fixed` | pedestal | top of the pedestal on the swivel axis; does not move with any adjustment | −0.360, 0, 0.150 |
| `D_seat_ref_live` | seat base | centre line, where the modelled cushion top meets the modelled backrest surface; moves with swivel, height, slide and tilt | −0.590, 0, 0.385 |
| `D_eye_small` | seat base | eye point, small woman | −0.537, 0, 1.077 |
| `D_eye_median` | seat base | eye point, median adult | −0.553, 0, 1.155 |
| `D_eye_large` | seat base | eye point, tall man | −0.570, 0, 1.233 |
| `D_eye_provisional` | seat base | same place as `D_eye_median`; kept so older references still resolve | −0.553, 0, 1.155 |
| `D_grip_L`, `D_grip_R` | joystick levers | palm centre on the grip surface; moves with the lever | −0.176, ±0.310, 0.701 |
| `D_estop` | emergency stop | centre of the red head | −0.208, −0.395, 0.578 |
| `D_pedal_face_1…3` | pedal arms | centre of each pedal face; moves with the pedal | 0.457, +0.14 / 0 / −0.14, 0.188 |

Honest limits of these frames:

- The two seat references are **estimated from the modelled surfaces**. Neither is a standardised
  seat index point: that would need the seat's adjustment ranges and a loaded measuring device, or
  the seat maker's figure.
- The eye points are built from the live seat reference, sitting eye heights of class
  `standard_default` quoted from memory of published tables (not looked up for this build), an
  assumed cushion compression of 0.02 m and the neutral recline. They move with the seat base but
  **not** with the recline joint. Treat them as placeholders.
- The two screen surfaces (`S_mon_screen`, `S_ts_screen`) are the frames for display assessments;
  the manifest gives each one's origin and bounding box, but not yet its normal, size and curvature
  as separate fields (they are in the parameters).

## The tree of Rig B as built

From `assets/rig-b/spec/rig.toml` and the manifest, **as of round 2**. Joints in brackets sit
between the node and its parent. `(asm)` = assembly node without a mesh.

```
C_rig (asm)                                              D_origin, D_floor
├─ C_platform                    deck panels, white rim, dark plinth
│   └─ C_platform_fitting_1..4   flush pull handles
├─ C_seat (asm)
│   ├─ C_seat_pedestal                                   D_seat_ref_fixed
│   └─ C_seat_carrier            [J_seat_swivel] [J_seat_height]
│       └─ C_seat_base           [J_seat_slide] [J_seat_tilt]
│           │                                            D_seat_ref_live, D_eye_small, _median, _large, _provisional
│           ├─ C_seat_pan        cushion in the white lower shell
│           ├─ C_seat_hub_L, _R  recline hub covers
│           ├─ C_seat_back (asm) [J_seat_recline]
│           │   ├─ C_seat_back_shell
│           │   ├─ C_seat_back_cushion
│           │   └─ C_seat_headrest
│           ├─ C_pod_L (asm)
│           │   ├─ C_pod_shell_L, C_pod_plate_L
│           │   ├─ C_pod_armrest_L          [J_pod_armrest_L]
│           │   ├─ C_joy_base_L
│           │   │   └─ C_joy_lever_L        [J_joy_L_roll] [J_joy_L_pitch]      D_grip_L
│           │   ├─ C_pod_keyswitch_L
│           │   └─ C_pod_button_L_1..4
│           └─ C_pod_R (asm)
│               ├─ C_pod_shell_R, C_pod_plate_R
│               ├─ C_pod_armrest_R          [J_pod_armrest_R]
│               ├─ C_joy_base_R
│               │   └─ C_joy_lever_R        [J_joy_R_roll] [J_joy_R_pitch]      D_grip_R
│               ├─ C_pod_estop_R                                                D_estop
│               ├─ C_pod_button_R_1..3
│               └─ C_ts_arm                 [J_ts_arm]
│                   └─ C_ts_screen          [J_ts_screen]
│                       └─ S_ts_screen      lit area of the touchscreen
├─ C_stand (asm)
│   ├─ C_stand_column_L, _R
│   ├─ C_stand_shelf
│   ├─ C_stand_soundbar
│   └─ C_stand_monarm            clamp and post
│       └─ C_stand_monarm_links  [J_mon_height]   collar, two links, head
│           └─ C_stand_monitor   [J_mon_tilt] [J_mon_pan]
│               └─ S_mon_screen  lit area of the main monitor
└─ C_pedals (asm)                [J_pedal_tray]
    ├─ C_pedal_base
    └─ C_pedal_arm_1..3          [J_pedal_1..3]                                 D_pedal_face_1..3
```

Three structural decisions worth knowing:

- **The pods hang on the seat base**, not on the platform (inferred: the pod's lower blade floats
  above the deck, in the same pose on every rig). So seat slide, tilt, height and swivel carry both
  pods, both joysticks, the emergency stop and the touchscreen.
- **The pod frame is tilted with the control plate** (about 9°, front low): X runs forward along
  the plate, Z is the plate's normal. Controls are placed by plate coordinates.
- **The stand stands on the platform**, fixed. The recessed deck fittings are read as pull handles,
  not tracks.

### Groups

Groups are the unit of show/hide in scripts and of work division between modellers.

| Group | Components with geometry | Triangles (as of round 2) | Holds |
|---|---|---|---|
| `platform` | 5 | 2,152 | deck, four pull handles |
| `seat` | 9 | 8,516 | pedestal, carrier, base, cushion, hubs, back shell, back cushion, headrest |
| `pods` | 22 (incl. 1 surface) | 11,598 | both pods with plates, armrest pads, joysticks, key switch, buttons, emergency stop, touchscreen and its arm |
| `stand` | 8 (incl. 1 surface) | 3,428 | columns, shelf, soundbar, monitor arm, monitor |
| `pedals` | 4 | 2,348 | base, three pedal arms |

### Joints

| Joint | Parent → child | Type | Axis | Lower … upper | Neutral | Kind | Evidence | Locked | Signal |
|---|---|---|---|---|---|---|---|---|---|
| `J_seat_swivel` | seat → carrier | revolute | Z | ±15° | 0 | adjustment | assumed | yes | — |
| `J_seat_height` | (chained) → carrier | prismatic | Z | ±0.04 m | 0 | adjustment | assumed | yes | — |
| `J_seat_slide` | carrier → base | prismatic | X | ±0.10 m | 0 | adjustment | assumed | yes | — |
| `J_seat_tilt` | (chained) → base | revolute | Y | ±5° | 0 | adjustment | assumed | yes | — |
| `J_seat_recline` | base → back | revolute | −Y (positive = leaning back) | 0 … 35° | 12° | adjustment | assumed | yes | — |
| `J_pod_armrest_L`, `_R` | pod → armrest pad | prismatic | X (along the plate) | ±0.05 m | 0 | adjustment | inferred | no | — |
| `J_joy_L_roll`, `J_joy_R_roll` | joystick base → lever | revolute | X | ±20° | 0 | control | seen | no | `joy_L.x`, `joy_R.x` |
| `J_joy_L_pitch`, `J_joy_R_pitch` | (chained) → lever | revolute | Y | ±20° | 0 | control | seen | no | `joy_L.y`, `joy_R.y` |
| `J_ts_arm` | right pod → touchscreen arm | ball | — | ±30° on each of roll, pitch, yaw | 23.4°, 15.4°, 0° | adjustment | seen | no | — |
| `J_ts_screen` | arm → touchscreen | ball | — | ±30° each | −14.5°, 0.3°, −16.1° | adjustment | seen | no | — |
| `J_mon_height` | arm base → arm links | prismatic | Z of the post (tilted with the shelf) | −0.095 … +0.060 m | 0 | adjustment | inferred | no | — |
| `J_mon_tilt` | arm links → monitor | revolute | Y (positive = top tips away) | ±15° | 3.5° | adjustment | inferred | no | — |
| `J_mon_pan` | (chained) → monitor | revolute | Z | ±30° | 0 | adjustment | inferred | no | — |
| `J_pedal_tray` | root → pedal set | prismatic | X | ±0.10 m | 0 | adjustment | assumed | yes | — |
| `J_pedal_1`, `_2`, `_3` | pedal set → pedal arm | revolute | Y (positive = pressed) | 0 … 20° | 0 | control | seen | no | `pedal_1`, `pedal_2`, `pedal_3` |

Twenty joints: 13 adjustments and 7 controls; 6 assumed (all locked), 5 inferred, 9 seen.
"Seen" for the joysticks and pedals means the mechanism is visible, not that its range was measured:
the joystick travel is a maker's figure, the pedal travel is `standard_default`. Neutral values that
are not zero are the photographed pose.

### The expected-motion table

Written in the spec under `[motion]`: for every joint, the component, datum and surface nodes that
must move when it moves (`*` is a wildcard). Everything else must stay still.

| When this moves | These move with it | These must not |
|---|---|---|
| Seat swivel, seat height | carrier, base, live seat reference, eye points, cushion, hubs, back, headrest, both pods with everything on them | pedestal, fixed seat reference, platform, stand, monitor, pedals |
| Seat slide, seat tilt | the same without the carrier | carrier, pedestal |
| Seat recline | back assembly, back shell, back cushion, headrest | cushion, pods, eye points |
| Armrest pad slide | that pad | the pod, the joystick |
| Joystick roll or pitch | that lever and its grip point | its base, the pod |
| Touchscreen arm ball | arm, touchscreen, its lit area | the pod |
| Touchscreen head ball | touchscreen, its lit area | the arm |
| Monitor height | arm links, monitor, its lit area | arm base, shelf, soundbar |
| Monitor tilt, monitor pan | monitor, its lit area | arm links |
| Pedal tray | pedal assembly, base, three arms, pedal faces | platform |
| A pedal | that arm and its face | base, other pedals |

### The left/right table

Every id with a side marker must have a counterpart at the mirrored position, unless the spec's
`[symmetry]` table says otherwise:

| Entry | Ids | Why |
|---|---|---|
| `single` (exist on one side only) | `C_pod_estop_R`, `C_pod_button_L_4`, `C_pod_keyswitch_L` | the real pods are handed |
| `free` (positions deliberately not mirrored) | `C_pod_button_L_1..3`, `C_stand_column_L` | button layouts differ between sides; the columns sit at a measured, slightly off-centre position |

### The functional view, as tags

| Function | Tag | Nodes |
|---|---|---|
| Displays | `display` | `C_stand_monitor`, `C_ts_screen` (the touchscreen is also `control`) |
| Primary controls | `control` + `hand` | `C_joy_lever_L`, `C_joy_lever_R` |
| | `control` + `foot` | `C_pedal_arm_1..3` |
| Secondary controls | `control` | joystick bases, key switch, seven panel buttons, touchscreen |
| Emergency control | `control` + `safety` | `C_pod_estop_R` |
| Body contact | `body_contact` | seat cushion, back cushion, headrest, both armrest pads |
| Adjustable | `adjustable` | seat carrier, seat base, seat back, both armrest pads, touchscreen arm and screen, monitor arm base and links, monitor |
| Structure | `structure` (+ `floor`) | platform, pedestal, carrier, base, both columns, shelf |

The tag set used so far is small and flat (nine words). The richer vocabulary considered in the
investigation (role, control type, body part, priority, station) was not needed for the viewer and
is left for the assessment phase. Tags are in the spec and the manifest; the viewer does not use them.

## Uncertain connections, and what would settle them

| Connection | Modelled as | Level | Would settle it |
|---|---|---|---|
| Seat swivel, height, slide, tilt | present, locked, typical ranges | assumed | ask the maker; a look under the seat |
| Seat recline | about the hub covers, 0–35°, photographed at 12° | position seen, motion assumed | two photos with different back angles |
| Pods carried by the seat base | fixed to it | inferred | a photo from below |
| Armrest pad | slides ±5 cm | inferred from another rig | may be two fixed hole positions |
| Monitor height | collar slides on the post, −9.5 … +6 cm | inferred; the arm is hidden behind the monitor on Rig B | a photo behind the monitor |
| Pedal set | on a sliding tray, ±10 cm | assumed | a photo with the pedals elsewhere |
