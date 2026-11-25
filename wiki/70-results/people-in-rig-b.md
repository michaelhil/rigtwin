---
title: Three people in Rig B
tldr: The package's three presets (P5 woman, P50 man, P95 man) seated in the real rig, with a heavier test body beside them: the 0.47 m seat is too deep for the P5 woman and the pedals 12 cm beyond her feet as photographed, the P95 man's hips meet the armrest pods, every grip is in reach, and the monitor's top edge stands 10 to 24 cm above every eye; the sizes are photo estimates.
status: living
updated: 2026-11-25
tags: [results, manikin, ergonomics, seat, reach, sight]
---

# Three people in Rig B

## TL;DR

- **What was done:** the manikin's seated operator was bound to Rig B's own points (seat cushion, front edge, backrest, armrest pads, grip handles, heel rest, pedal faces, both screens) instead of the lab's stand-in rig. Seated: the package's three presets, **P5 woman** (1.525 m, 58.3 kg), **P50 man** (1.756 m, 85.5 kg) and **P95 man** (1.870 m, 96.6 kg), and beside them, kept apart, a **tall heavy test body** (1.869 m, 115 kg; the lab's M95H test person, not a preset).
- **P5 woman:** with her back on the backrest the seat's front edge lies 102 mm beyond her knee crease (24 mm by a survey estimate), and her feet fall 116 mm short of the pedals with the seat and the pedal tray as photographed. With the seat fully forward and the tray fully back (both assumed ranges) she reaches them.
- **P95 man:** his thighs and hips meet the armrest pods' inner sides by 16 to 17 mm (the body's collision capsules against the parts' boxes; the survey's hip breadth leaves 49 mm each side). The heavier test body meets them by 26 to 27 mm. The P50 man has 2 to 3 mm. The joystick bases sit 12 mm beyond the pods' inner edges, above the plates: a thigh does not reach them past the pod.
- **Reach:** every grip is within reach for all (73 to 84 % of the arm's length); while gripping, the forearm lies 13 mm (P95 man) to 68 mm (P5 woman) above the armrest pad.
- **Sight:** the main monitor's centre is 0.85 to 0.88 m from the eye; its top edge stands 235 mm (P5 woman), 142 mm (P50 man) and 99 mm (P95 man) above the eye. The touchscreen is 27 to 37 degrees below the eye.
- **How sure:** these are consequences of the model's sizes, which are photo estimates never checked against a tape; the seat depth hangs on the backrest surface position (±0.04 m, borrowed from other rigs) and the seat and pedal ranges are assumed.

## The rig points the person needs

Nine empty markers added to the rig on 2026-11-25 (`assets/rig-b/spec/rig.toml`), each built from the rig's own
parameter records; the GLB's geometry stays byte-identical (build `098d38cfc6c3` against `0b6d8248b63f`). Positions in
metres, model frame, neutral pose. The pedal faces, grip palm points, seat reference and screens were there already.

| Point | Carried by | What it is | Position (x, y, z) |
|---|---|---|---|
| `D_seat_front` | seat base | foremost point of the cushion's front roll, centre line (`seat.cushion_front_lip_x`, `cushion_top_z_front`, `cushion_lip_radius`) | −0.120, 0, 0.405 |
| `D_backrest_ref` | seat back | the live seat reference carried by the back, so it turns with the recline; x is the backrest's normal, z runs up the back | −0.590, 0, 0.385 |
| `D_armrest_L`, `_R` | armrest pads | top centre of each pad, x along the pad | −0.548, ±0.321, 0.667 |
| `D_grip_axis_L`, `_R` | joystick levers | middle of the handle section a closed hand wraps (from the end of the slim neck to the start of the head), z along the handle there (29° forward, 10° inward): new records `pods.grip_centre`, `grip_axis_rp`, `grip_radius` (0.026 m), `grip_hold_span`, derived from the grip's shape records; the build writes the lever's radius along this axis beside it (`profile`, `hold`) | −0.139, ±0.302, 0.728 |
| `D_heel_rest` | pedal unit | top of the heel plate at its operator-side lip (`pedals.heel_profile`) | 0.200, 0, 0.036 |
| `D_pod_inner_L`, `_R` | pod shells | the pod's inner side as a contact surface (the tray's inner edge, z toward the seat); the build writes how far the shell stands out toward the seat along the pod, and over which height, within `pods.inner_surface_band` (`surface`), and the solver's contact layer presses a wide thigh against it (`contactPlanes` `pod_L`, `pod_R`) | −0.190, ±0.251, 0.546 |

## How the people are seated

The binding (`viewer/src/person/rig-binding.ts`) reads only the rig's own points and parameter records; its few own
numbers are in `assets/manikin/params/runtime-rig.toml`, the body's allowances in `runtime-person.toml`.

| Item | Rule | From |
|---|---|---|
| Seat height | the hip sits so that, with the trunk at the backrest's neutral recline (12°), the eye is the person's survey sitting eye height less the cushion's compression (20 mm) above the cushion top under the hip | the lab's rule of round 6b; `seat.eye_cushion_compression` |
| Fore and aft | the back lies on the backrest plane as the solver's allowances say (upper back touches, pelvis presses 30 mm) | `D_backrest_ref`; `operator.targets.back_clear`, `pelvis_press` |
| Recline, seat tilt | the trunk takes the backrest's angle; the hip keeps its height, the eye goes where the trunk takes it | `D_backrest_ref` posed |
| Hands | the closed hand centred on the handle section a hand wraps, on its own axis (29° forward, 10° inward), the fingers following the lever's real radius along it; a flat palm 50 mm behind each pad's front end | `D_grip_axis_L/R` with its `profile`, `D_armrest_L/R` |
| Feet | left foot on pedal 1, right foot on pedal 3, heel on the heel plate, the sole under the ball on the middle of the pad | `D_heel_rest`, `D_pedal_face_1..3` |
| Gaze | main monitor centre; touch point the touchscreen's centre | `S_mon_screen`, `S_ts_screen` |
| Contact | the cushion as one slab through its top under the hip and its front crest (the drawn top rises 60 mm over its front 15 cm, so the slab stands up to 33 mm above it in between; the real centre-line profile is handed over too) and the backrest plane | `D_seat_ref_live`, `D_seat_front`, `seat.cushion_*` |

The seated eye is survey-true to under 1 mm for every seat height, slide, swivel and every armrest, joystick, pedal
and monitor setting (*tested*: `viewer/src/person/rig-binding.test.ts`). It lands within 4 mm of the rig's own
small-woman eye point for the P5 woman, 18 mm above the median point for the P50 man and 18 mm below the large point for
the P95 man.

## The findings

All at the rig's photographed pose, back on the backrest, hands on the grips, feet on their home pedals. Clearance:
positive = a gap, negative = an overlap. *Measured* on the model with the person's skeleton and collision capsules:
the lab's baked ones where the body is a baked person (the P5 woman and P50 man presets are the lab's F05 and M50
bodies), otherwise derived from the body's shape (see below). The last column is a test body, not a preset.

| | P5 woman (preset) | P50 man (preset) | P95 man (preset) | Tall heavy test body (not a preset) |
|---|---|---|---|---|
| Body | 1.525 m, 58.3 kg (the lab's F05 body) | 1.756 m, 85.5 kg (the lab's M50 body) | 1.870 m, 96.6 kg | 1.869 m, 115 kg (the lab's M95H body) |
| Capsules used | baked | baked | derived | baked |
| Survey sitting eye height, m | 0.720 | 0.813 | 0.855 | 0.859 |
| Hip above the cushion top, m | 0.066 | 0.080 | 0.088 | 0.087 |
| Knee crease behind (+) or in front of (−) the seat's front edge, solved body, mm | −102.4 | −8 | 28.2 | 30.4 |
| The same by the survey (0.81 × buttock-knee length), mm | −24.3 | 32.2 | 66.4 | 78.9 |
| Cushion top above the thigh's underside over the front rise, mm | 138.7 | 79.6 | 7.3 | 13.6 |
| Legs short of the home pedals, mm | 115.5 | 0 | 0 | 0 |
| Thigh or hip to the pod shells (left / right), mm | 26.3 / 27.7 | 1.8 / 3.1 | −17 / −15.6 | −27.2 / −25.8 |
| Thigh to the joystick base's bounding box, reachable only through the pod's inner side (left / right), mm | 108.6 / 110 | 40.5 / 41.8 | −2.9 / −1.4 | −13.1 / −11.7 |
| Leg to the joystick levers (left / right), mm | 164.7 / 165.9 | 86 / 87.1 | 22.7 / 24 | 12.5 / 13.8 |
| Leg to the armrest pads (left / right), mm | 97.4 / 99.2 | 47.2 / 48.8 | 7.4 / 9 | −2.1 / −0.4 |
| Forearm to the armrest pad while gripping (left / right), mm | 68 / 68.4 | 23.6 / 23.9 | 12.6 / 12.9 | 12.7 / 12.9 |
| Room each side between the pods (0.502 m) and the survey's seated hip breadth, mm | 55.8 | 58.1 | 48.7 | 30.7 |
| Shoulder to the left grip's centre, m; share of the arm's length | 0.467; 0.85 | 0.491; 0.77 | 0.502; 0.74 | 0.498; 0.73 |
| Grip out of reach, mm | 0 | 0 | 0 | 0 |
| Eye to the main monitor's centre, m; centre below the eye, degrees | 0.884; −4.2 | 0.861; 1.8 | 0.860; 4.7 | 0.853; 4.9 |
| Monitor's active top edge above the eye, mm | 234.6 | 141.6 | 99.2 | 95.7 |
| Eye to the touchscreen's centre, m; centre below the eye, degrees | 0.809; 27.4 | 0.840; 33.6 | 0.862; 36.1 | 0.860; 36.5 |
| Foot pitch on the pedal, degrees; press travel left, degrees | 39.3; 12 | 34.5; 9.8 | 33.2; 9.2 | 32.9; 9.1 |

What it means, in plain words:

- **The seat is too deep for the P5 woman.** Sitting back, the front edge presses into the back of her knees; to
  avoid it she would sit forward and lose the backrest. The P50 man is at the edge (8 mm into the crease by the
  body, 32 mm clear by the survey estimate); the P95 man has 28 to 66 mm.
- **The P5 woman cannot reach the pedals as photographed.** With the seat slid 0.10 m forward and the pedal tray
  0.10 m back (the ends of both assumed ranges) her feet reach them, the cushion's front rise stands 84 mm less above her thighs'
  underside (55 mm remain), and the front edge still lies 90 mm beyond her knee crease.
- **The P95 man is tight between the pods.** The capsules are round, so they overstate the hips' width; the
  survey's hip breadth leaves 49 mm each side (31 mm for the heavier test body). The joystick bases are not a contact of
  their own: they stand on the plates 12 mm outboard of the pods' inner edges, so a thigh reaches a base's bounding box
  (−3 mm P95 man, −13 mm test body) only by passing the pod's inner side, which the contact layer now stops it at. With the
  seat forward the test body's thighs meet the joystick levers too.
- **The monitor stands high.** Its top edge is above every eye, by 99 to 235 mm (a common office rule puts it at or
  below eye height); the short woman looks up 4° to its centre. The monitor's height joint has 0.095 m of travel down.
- **The front rise of the cushion lifts the thighs** of the P5 woman and the P50 man: the drawn top stands 80 to 139 mm above the
  thigh's underside, which the contact layer shows as compressed tissue and which, in a real seat, is pressure under
  the thigh.

## Every body, not only the baked persons

The lab measured collision capsules (trunk sections, thighs, arm radii) on the mesh of each baked person only, so a
preset such as the package's "Tall man (stature P95)" (1.870 m, 96.6 kg) or any body set with the sliders had none.
`tools/person-capsules.ts` runs the lab's own measurement, ported, on the full clay body of each sex for 400 bodies
across the controls and fits every measured number linearly in the 40 shape weights, like the joint deltas
(`viewer/src/person/body-capsules.json`). `viewer/src/person/body-fit.ts` turns them into capsules for any body; the
binding uses a baked fit where one exists. Shins and forearms are derived for every body.

For each of the lab's ten baked persons, the derived capsules against the baked ones (largest differences, mm). The
thigh capsules run between the same joints, so their end points agree; the trunk sections are compared at the baked
sections' heights (end points: the two centres of each stadium).

| Baked person | Thigh radius | Thigh end points | Trunk radius | Trunk end points (sections compared) | Arm radii, palm | Heel |
|---|---|---|---|---|---|---|
| F05 | 0.7 | 0.1 | 13.8 | 15.9 (13, 1 sparse left out) | 1.9 | 0.1 |
| F50_THIN | 1.2 | 0.1 | 5.3 | 13.2 (13, 1 sparse left out) | 2.3 | 0.0 |
| F50_MID | 1.3 | 0.1 | 11.6 | 15.7 (13, 1 sparse left out) | 2.3 | 0.1 |
| F50_HEAVY | 1.2 | 0.1 | 11.9 | 21.1 (13, 1 sparse left out) | 3.1 | 0.0 |
| F05_LONGARM | 0.6 | 0.1 | 15.1 | 18.1 (13, 1 sparse left out) | 0.8 | 0.0 |
| M50 | 2.4 | 0.1 | 6.6 | 12.6 (14) | 0.3 | 0.0 |
| M95H | 4.8 | 0.1 | 4.6 | 10.5 (13) | 0.4 | 0.1 |
| M50_THIN | 2.4 | 0.0 | 4.4 | 18.8 (14) | 0.4 | 0.1 |
| M50_MID | 2.3 | 0.0 | 6.8 | 20.1 (14) | 0.6 | 0.0 |
| M50_HEAVY | 2.1 | 0.1 | 10.7 | 13.1 (14) | 0.7 | 0.0 |

Thighs within 4.8 mm, arms within 3.1 mm, heel within 0.1 mm. The trunk sections agree to 3.7 mm or better for half of
them, but differ by up to 15 mm in radius and 21 mm at the ends at the belly and the shoulders: there the packages' belly
and armpit helper joints, added after the lab's bake, hold skin that the bake counted as trunk. F05's lowest baked
section (a 15 mm ring of 12 points) has no counterpart. The clearance findings use thighs, hips, shins and forearms.

The hands now wrap the real handle: the grip centre is the middle of the handle section a closed hand wraps (78 mm
long, 31 to 35 mm in radius), and the solver gets the lever's own radius along its axis (`targets.grip.l/r.profile`,
80 mm below to 80 mm above the centre), written by the rig's build: the lever's mesh cut across the axis
(`D_grip_axis_*` `profile` in the description file; within 1 mm of the built mesh, *tested*). Below the section lies the
slim neck (21 mm, 40 mm under the centre), then the skirt flaring to 50 mm over the boot; the right grip's head is wider
where its thumb stick stands.

## How sure

| Finding | Depends on | Standing |
|---|---|---|
| Seat depth against the knee | `seat.backrest_surface_x_at_cushion` (−0.59 ± 0.04, *assumed*, borrowed from other rigs) and `seat.cushion_front_lip_x` (*photo*, ±0.02); the crease from the solved knee joint less the thigh's radius there | the depth is uncertain by about ±45 mm; the solved and survey creases differ by 40 to 80 mm; the sign for F05 holds under both |
| Pedal reach | pedal faces (*photo*), heel plate (*photo*), seat slide and tray range (**assumed**, ±0.10 m each) | that she falls short as photographed holds; whether the real adjustments are enough is not known |
| Pod and joystick clearance | the parts' bounding boxes (tilted with the plate) and the body's round collision capsules, baked or derived | an upper bound on any overlap; the survey hip breadth is the cross-check; the armrest pads are measured as the boxes they are |
| Eye and screens | the survey-true seat rule, the monitor centre (*photo*, x ±0.04) | eye height *tested*; screen distances depend on the monitor's x |

The rig's model card lists the seven reference points added for the person ([model card](rig-b-model-card.md#reference-frames)).
The numbers come from `rigBinding(...).report` and change with every rig adjustment and every body.
