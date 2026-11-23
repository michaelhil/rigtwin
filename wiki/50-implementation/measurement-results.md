---
title: Measurement results
tldr: What the photos gave for Rig B - the scale closes within 0-2 % against purchased parts, five cameras were solved, 118 dimensions were recorded with a class and a range, and all three of the owner's figures conflict with the photos. Nothing here has been checked against a tape measure.
status: living
updated: 2026-11-23
tags: [measurement, results, uncertainty, cameras]
---

# Measurement results

## TL;DR

- **Scale:** the deck's side-to-side width was set to the owner's 1.50 m. Purchased parts then measure 1.003 (soundbar), 1.00 (pedal pitch) and 1.02 (monitor) of their makers' sizes (*measured*).
- **Cameras:** the three photos of Rig B were solved together on the platform deck (edge traces 0.18–0.90 px rms); two photos of other rigs were solved from the deck outline; three photos could not be solved.
- **The owner's three figures all conflict with the photos:** the deck is 1.41 m front to back, not 1.5; the seat back top is 1.28 m above the deck (1.48 m above the floor), not 1.4; 1.2 m fits headrest to screen, not eye to screen. The model follows the photos and asks for a tape.
- **118 dimension records:** 26 two-view, 60 single-view, 20 assumed (11 by eye, 9 from another rig), 3 owner, 2 vendor, 7 recorded gaps. In the model this became 303 parameter records, 198 of them assumed or invented.
- **Not checkable from these photos:** depth along the rear-right line of sight. A 50 mm error there moves a point 0–2 px, against about 35 px sideways. The whole seat back, both armrest pads and the monitor's distance are in that blind direction.

This page gives the **results**. The procedure that produced them, with its terms, is in
[Measuring from photos](../40-method/measuring-from-photos.md); how gaps were filled is in
[Filling gaps](../40-method/filling-gaps.md). Terms are in the [glossary](../00-overview/glossary.md).
All values are in metres, in the model frame (Z up, X forward toward the main display, Y to the
operator's left, origin at the centre of the deck's top surface). Source of the numbers: the
measurement agent's report and dimension table of 2026-11-23, the parameter files of the round-2
build, and the two review reports.

## Inputs

| Input | What it gave |
|---|---|
| 11 phone photos, 4284 × 5712 px | 3 show Rig B (photos 2511, 2530, 2532). 2511 and 2530 were taken 0.26 m apart from the rear right, so Rig B has **two real viewpoints**, not three. The others show Rig C1, Rig C2 and details |
| Photo metadata | focal length 1502.3 px in the 1500 × 2000 working frame |
| The owner's figures (verbal, 2026-11-23) | platform 1.5 × 1.5 m; seat 1.4 m high; head to display 1.2 m; room 4.5 × 5.8 × 2.48 m |
| Makers' published data | monitor (49-inch 32:9, 1800R curve), soundbar, joysticks, touchscreen, pedal set |

## Scale and closure

The model frame is fixed on the deck (its plane, its rectangle and one length). Its lateral width is
the scale unit. Everything else was then measured in that frame and compared with makers' sizes.

| Part | Measured | Maker's size | Ratio | How measured | Verdict |
|---|---|---|---|---|---|
| Soundbar length | 0.411 | 0.410 | **1.003** | corners in two views | closes |
| Pedal pitch (centre to centre) | 0.140 | 0.14 | **1.00** | pad corners in two views | closes |
| Monitor outer height | 0.373 | 0.365 | 1.02 | curved-panel model fit | weak test (the maker's size fits to 2.5 px, a free size to 1.8 px) |
| Monitor width (chord) | 1.202 | 1.195 (chord) | 1.02 as first compared; 1.006 against the chord | model fit; 1000R curve rejected (7–9 px) | the table compared it with a 1.174 chord computed from 1.195 taken as the arc; see corrections below |
| Joystick plinth | 0.093–0.109 | 0.1067 | 0.87–1.02 | one ray on the plate plane | weak (soft rubber edge) |
| Joystick grip top above the plate | 0.22 | 0.2399 | 0.92 | Rig C1, one ray | weak |
| Touchscreen outer height | 0.205 | 0.2444 (15.6-inch) | **0.84** | corners in two views | wrong product size assumed: it is the 13.3-inch unit |
| Touchscreen active height | 0.1655 | 0.165 (13.3-inch) | **1.00** | corners in two views | closes for the 13.3-inch size |
| Pedal heel-rest width | 0.402–0.420 | 0.388 | 1.04–1.08 | one ray, height unknown | wrong reference: the 0.388 was never tied to this element; no longer used for scale |

*Verdict (measured):* the platform scale agrees with the purchased parts within 0–2 %. The 7 %
disagreement found during planning ([F-04](../60-lessons/failures-and-fixes.md#f-04)) came from the
pedal heel-rest reference, which was the wrong element. A scale error of 16 % is excluded by every
other part, so the touchscreen mismatch meant a wrong product identification
([F-14](../60-lessons/failures-and-fixes.md#f-14)), now modelled at 13.3 inches
([D-34](../20-decisions/decision-log.md#d-34)).

### Which 1.5 m the owner's figure was taken as

| Question | Answer | How known |
|---|---|---|
| Deck (black surface inside the rim) or outer size? | **The deck.** The white rim is 15 mm wide, so the two readings differ by 2 %. Soundbar and pedal pitch favour the deck (1.00 against 0.98); the monitor favours the outer size (1.00 against 1.02) | measured; confidence about 60 : 40 (*judgment of the measurement agent*) |
| Which side is 1.5? | **The lateral side.** If the fore-aft side were 1.5 the soundbar would measure 0.437 and the monitor 1.28 wide; both are excluded | measured |
| Consequence if the reading is wrong | every photo-derived length is 2 % too large (15 mm on the shelf height) | calculated |

The deck is **not square**: length / width = 0.941 ± 0.01, that is about 1.41 × 1.50 m inside the rim
and about 1.44 × 1.53 m outside it. The ratio came out at 0.93–0.95 from each rear photo separately,
0.941 from the joint solve and 0.94–0.96 on Rig C1. A square deck would need a focal length of about
1700 px; the metadata say 1502.

## Cameras solved, and their residuals

**Rig B: one bundle adjustment of three cameras in the model frame** (35 background tracks from
structure from motion, 12 hand-picked ties, 9 deck edge traces).

| Item | Residual or result |
|---|---|
| Deck edge traces, 9 edges | 0.18–0.90 px rms each |
| Deck screws (two views, held on the deck plane) | 0.7–2.4 px |
| Shelf nuts (two or three views) | 0.1–0.9 px; the right-hand nuts 2.6–3.4 px in photos 2530 and 2511 (about 5 mm at that range; inside the stated ranges; cause not found) |
| Background tracks (35) | median 1.3 px, 90th percentile 2.5, maximum 3.6 |
| Focal length | 1515.5 px solved, against 1502.3 from the metadata (+0.9 %) |
| Stability over solve variants (focal fixed or free, without tracks, without one edge) | camera centres move ≤ 20 mm; deck ratio 0.938–0.943 |

The deck features are **gauge**: they agree with the photos by construction and are not counted as
verification ([P-06](../60-lessons/patterns.md#p-06)).

**Other rigs** (camera from the traced deck outline alone, deck taken as 1.412 × 1.500 m):

| Photo | Rig | Solved from | Check on features not used | Verdict |
|---|---|---|---|---|
| 2515 | C1 | 4 deck edges (0.23 px) | fourth edge 2.6 px when solved on three; two room verticals 0.8 and 1.5 px; deck handles 7–8 px | accepted |
| 2520 | C2 | 3 deck edges + 2 room verticals | deck handle 5.5 px | accepted with caution; values through it are `cross_instance`, ±0.05 |
| 2516, 2517, 2518 | C | — | — | not solved: too little platform outline visible |

Photo 2520 solved from three deck lines alone was exactly determined and **failed** its check (room
verticals missed by 24–52 px; camera height 0.2 m wrong); see
[F-15](../60-lessons/failures-and-fixes.md#f-15). The camera path itself is tested on every
`bun run check` by the projection self-test ([C-17](../40-method/checks.md#c-17)): 45 points over 7
cameras, worst 0.216 px.

## The owner's three figures

| Figure as given | The owner said | The photos give | Model uses | Conflict |
|---|---|---|---|---|
| Platform | 1.5 × 1.5 m | 1.50 side to side (taken as the scale); **1.41 ± 0.02 front to back** (deck); outer about 1.44 × 1.53 | 1.50 × 1.41 | holds for one side only |
| Seat height | 1.4 m | top of the seat back **1.28 ± 0.03 above the deck** on Rig B and 1.27–1.28 on Rig C1; the deck top is 0.20 above the room floor, so **1.48 above the floor** | 1.28 above the deck | "above the deck" is 0.12 short, "above the floor" 0.08 long; neither fits |
| Head to display | 1.2 m | **eye to main-screen centre about 0.89–1.05**; **headrest to screen 1.08–1.21** | screen and seat as measured; three eye points (see below) | 1.2 fits the back of the head, not the eye |

Detail of the third row (*calculated with the solved cameras and the model*):

| Distance to the main-screen centre (x 0.34, z 1.135–1.145) | Value | Source |
|---|---|---|
| From the median eye point of the round-2 model | 0.893 | round-2 reviewer, own measurement on the model file |
| From the provisional eye point of the measurement stage (x −0.60, z 1.22) | 0.97 | measurement report |
| From the centre of the head | 1.05 | measurement report |
| From the headrest front, round-2 model | 1.08 | round-2 reviewer |
| From the upholstery at head height | 1.14 | measurement report |
| From that surface to the screen's ends | 1.21 | measurement report |

An eye point 1.2 m from the screen centre would lie inside the backrest shell. The monitor sits on an
arm and may have stood further away when the owner measured. Why it matters: from 0.95 m the screen
spans about 64° of the operator's view, from 1.20 m about 52° (round-1 reviewer); from the round-2
median eye it spans 74° horizontally.

The room figures (4.5 × 5.8 × 2.48 m) were used only as a check on photo 2515: two wall-corner
verticals agree with the platform-solved camera to 0.8 and 1.5 px. The ceiling came out 2.56–2.68 m,
3–8 % above 2.48, a long extrapolation that settles nothing.

**How the conflict is handled** ([D-24](../20-decisions/decision-log.md#d-24),
[F-13](../60-lessons/failures-and-fixes.md#f-13), [L-07](../60-lessons/lessons-learned.md#l-07)):

1. The geometry follows the photo values, which two rigs and the outline overlays support.
2. The owner's figures stay in the parameter files as records of class `measured`
   (`platform.deck_width_y`, `seat.back_top_height_user`, `layout.eye_to_display`). The first is the
   scale unit; the other two are read by no geometry and appear in the build's "read by nothing"
   warning, on purpose.
3. Each conflicting record says so in its evidence text, and the conflict is listed for the owner.
4. Both independent reviewers left the point **open** (finding U2): "a decision, not a modelling
   fault". A tape measurement on the rig must settle it before any vision or reach evaluation.

Possible explanations that the photos cannot test: a rounded figure from memory; a measurement to a
different point; a seat raised or more upright when measured; a monitor further forward or back.

## Counts per class

**Dimension table of the measurement stage** (118 records):

| Class | Basis | Records | Meaning |
|---|---|---|---|
| photo | two-view | 26 | sight lines from two photos meet within a few pixels |
| photo | single-view | 60 | one sight line plus a stated assumption (a plane, a symmetry) |
| assumed | by eye | 11 | proportion judged in a photo; no range claimed |
| assumed | cross-instance | 9 | measured on another rig of the same product |
| measured | owner | 3 | the owner's figures |
| vendor | — | 2 | makers' data |
| none | — | 7 | a real gap, recorded with a reason and no value |

By tier: 30 critical, 60 layout, 28 cosmetic.

**Parameter records of the round-2 model** (303; the modellers added the shape and cosmetic values):

| Class | Critical | Layout | Cosmetic | All |
|---|---|---|---|---|
| measured | 3 | 0 | 0 | 3 |
| vendor | 6 | 12 | 4 | 22 |
| photo | 22 | 34 | 24 | 80 |
| assumed | 2 | 50 | 125 | 177 |
| invented | 0 | 0 | 21 | 21 |
| **All** | **33** | **96** | **174** | **303** |

Of the 33 critical values, 31 rest on the owner, a maker or a photo measurement; 2 are assumed.
Components take the least certain class among the non-cosmetic values they read: 20 components are
`photo`, 30 `assumed`, 2 `vendor` (description file, round 2). The round-3 build (`0b6d8248b63f`)
has 305 records: two more assumed, cosmetic-tier values for the fixes; component classes unchanged.
Confirmed against the published build: 305 records (measured 3, vendor 22, photo 80, assumed 179, invented 21).

## Biggest gaps

Recorded as `none` (no value) or held only by assumption:

| Gap | Why | What would settle it |
|---|---|---|
| Backrest surface at cushion level, and so the depth of the seat pan | never visible on Rig B | tape: cushion depth to the backrest |
| Seat widths at shoulder and waist | side planes of all profile points are assumed | tape |
| Seat pedestal position | hidden under the seat in every Rig B photo | tape, or a photo from the side |
| Monitor arm links and head | hidden behind the monitor | maker's drawing of the arm; a photo from behind |
| Touchscreen width, its arm base, its pose in photo 2511 | right corners seen in one photo only; the screen moved between photos | the label on the unit; tape |
| Pedal base footprint and heel-rest height | hidden by the stand and pads | tape |
| Platform plinth; white band height | hidden; one steep pick (later re-measured, see below) | tape |
| Headrest as a separate part | there is none: the narrow top of the back serves as one | settled by the photos |
| Deck panel seams | visible, not measured | later traced by a modeller (see below) |

## What cannot be checked from the photos

The two rear photos of Rig B look along the platform's diagonal. For a point about 2.2 m away,
**a 50 mm error sideways moves it about 35 px in the photo; a 50 mm error along the line of sight
moves it 0–2 px** (0 px in photo 2530, 1–2 px in 2511). Only parts that photo 2532 also shows are
pinned in that direction.

Pixel shift for a 50 mm error, X / Y / Z (*calculated with the solved cameras*; full table in the
[method page](../40-method/measuring-from-photos.md#what-a-photo-cannot-check-detectability)):

| Feature | Photo 2530 | Photo 2511 | Photo 2532 |
|---|---|---|---|
| Monitor centre | 21 / 33 / 41 | 18 / 29 / 34 | 17 / 79 / 89 |
| Seat back top | out of frame | 52 / 32 / 61 | not visible |
| Armrest pad rear (right) | 57 / 52 / 52 | 46 / 43 / 50 | not visible |

These numbers look comfortable; the table hides the blind direction, which is a combination of X
and Y. **Not verifiable from these photos**, however good an overlay looks: the whole seat back (top,
facets, bolsters, inset panel), the recline hub and lower shell, the rear two thirds of the cushion
and the backrest surface, both armrest pads behind their front edge, the emergency stop, the right
plate's outer edge and rear end, the right pod's blade and leg, the monitor's distance (held only by
a model fit and one edge, ±0.04), the right half of the touchscreen, and the rear half of the
platform (gauge, not verified). For these parts a matched overlay looks right even when the part is
5–10 cm off. For the seat, a shift along the blind line trades about 0.6 mm sideways and up to
1.4 mm in height per millimetre of depth.

What was done about it: the modellers were told to trust the table and the side views of Rig C1,
not the overlay ([F-07](../60-lessons/failures-and-fixes.md#f-07),
[L-04](../60-lessons/lessons-learned.md#l-04), [L-05](../60-lessons/lessons-learned.md#l-05),
[P-07](../60-lessons/patterns.md#p-07)). Both reviewers listed "depth along the rear-right viewing
line" under what they could not judge.

## Corrections the modellers made later

With the solved cameras the modellers could cast their own sight lines. They found errors in the
table and corrected the parameter records, each with the evidence written in the record
([F-16](../60-lessons/failures-and-fixes.md#f-16), [P-18](../60-lessons/patterns.md#p-18)):

| Item | Dimension table | Model | How it was found |
|---|---|---|---|
| Stand column depth (front to back) | 0.15–0.19 | **0.22 at the foot, 0.245 at the head** (±0.02) | the table used a sight line at 40° to the X axis; the ray from the solved camera is at 24°; silhouettes of both columns compared with the projected section in photo 2530 |
| Monitor width | 1.195 compared as if it were the arc | **1.195 is the chord** (the straight width makers list); along the 1800R curve that is 1.218 m of arc, leaving 10 mm of bezel beside a 1.197 m active arc | maker's data re-read; photo fit of the chord 1.19–1.20 |
| Touchscreen | 15.6-inch unit (0.387 × 0.244 housing) | **13.3-inch unit**: housing height 0.205 and active height 0.1655 triangulated; active width 0.294 from the 16:9 shape; housing width 0.33 by proportion (a free fit prefers 0.36–0.39: width and turn cannot be separated in these photos) | two-view corners; the 0.84 ratio; [D-34](../20-decisions/decision-log.md#d-34) |
| Emergency stop | head about 0.03 across on a 0.04 collar, about 0.045 tall | **0.029 ± 0.006 tall, head 0.037 across** | head height compared with its own width in photo 2530, corrected for the viewing angle (0.020–0.025); head width from two readings, 0.033 and 0.037 (the round-1 reviewer suggested 38–40 mm). The maker's catalogue size of 30 mm stays as an unused record |
| Pod top plates | left 0.510 ± 0.015, right 0.527 ± 0.010 above the deck at the front screws | **0.519 on both sides** | the pods are built as mirror images; the **17 mm difference** is kept visible in the record, not averaged away silently |
| Platform white band | 0.15 ± 0.04 (one steep pick) | **0.105 ± 0.01** | brightness read along vertical lines through the solved cameras, in 1 cm steps, in two photos; agrees with the round-1 reviewer's hint |
| Deck panel joints | not measured | outlines ± 0.02 | the modeller's own rays on the deck plane |

The rule is the same as for the table: a size mismatch goes back to a measurement, never to a
nudge by eye, and a conflict is written down rather than averaged away.

## The most useful tape measurements

Ranked by how much each would settle (from the measurement report, with the reviewers' additions):

1. Deck: both sides, and the outer size. Settles the 2 % scale question and the 1.41.
2. Top of the seat back above the deck, and **which point the owner's 1.4 m referred to**.
3. Deck top above the room floor.
4. Seat cushion: front lip height, depth to the backrest, width.
5. Backrest surface (at cushion level and at head height) to the screen centre, and **what the 1.2 m
   was measured from**.
6. Recline hub centre: height above the deck and distance behind the cushion's front lip.
7. Shelf: height of its near and far edges above the deck; length and depth.
8. Pod top plate: height at the front and rear, both sides; distance between the two joystick centres.
9. Armrest pad top, front and rear, and pad length. The model has 0.26–0.32 above the cushion,
   "at the high end" (round-2 reviewer).
10. Touchscreen housing width and height (the label settles 13.3 against 15.6), and the pedal
    heel-rest edge: width and height above the deck.

Also wanted, not a tape value: the seat's make and model (its maker's seat reference point would
replace the estimated one; see [standards](../80-reference/standards.md)), and which adjustments
really exist on the seat, pods and pedals. A measured value goes into `measured.toml` and replaces
the estimate with no code change (*tested*; see
[Filling gaps](../40-method/filling-gaps.md#overriding-with-a-real-measurement)).
