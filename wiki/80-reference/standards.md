---
title: Human-factors standards and the seat reference
tldr: Which ergonomic standards bear on a seated remote-operation station, as far as this project established it, what each would need from the 3D asset, and why the asset carries "estimated seat reference" frames instead of a standardised seat index point. No standard was read in full; every statement is marked read in part or recalled, and must be confirmed against purchased texts.
status: living
updated: 2026-11-23
tags: [reference, standards, human-factors, seat-reference]
---

# Human-factors standards and the seat reference

## TL;DR

- **No standard is written for a seated teleoperation station.** ISO 15817 is the only earth-moving standard scoped to remote operation, and it is written around a remote control box. The cab standards assume an operator on the machine. ISO 11064-4 is the closest fit for a station in a control room.
- **Nothing here was read from a purchased standard.** The agents read public sample pages (often only scope, terms and the first clauses, sometimes through character recognition) or recalled content from memory. Confirm every statement before citing it.
- **Much of what the standards require is not geometry**: control marking, forces, display luminance and glare, camera mapping, latency, tasks, the user population. A 3D asset cannot hold it.
- **The asset carries two seat reference frames labelled as estimates**, not an ISO 5353 seat index point, because none of that standard's conditions is met. Their range is about ±70 mm vertically and ±60 mm or more front to back.
- **A value filled in from a standard must never be assessed against that standard.** The model would look compliant by construction.

## How statements are marked

| Mark | Meaning |
|---|---|
| **read in part** | An agent read the public sample text of the standard on 2026-11-23 (scope, definitions, early clauses; not the full text, and usually not the dimension tables) |
| **read in part, OCR** | As above, but from an image-only sample through character recognition; table labels were partly lost |
| **search level** | Known only from a search-result summary or the publisher's status page |
| **recalled** | From an agent's memory, not checked in this project |

The project owner, as a human factors researcher, probably has the texts. This page is the project's
working picture, not an authority.

## Which standards bear on the station

| Standard | Subject | Fit to a seated remote station | What it would need from the asset | Not geometry (the asset cannot hold it) | How known |
|---|---|---|---|---|---|
| ISO 15817:2012 | Earth-moving machinery: safety requirements for remote operator control systems | The only one scoped to remote control. Written around a "remote control box" (a device, not on the machine, that transmits signals); a seated station meets the definition but was plainly not the object in mind | Presence and position of the remote stop; control positions | Controls return to neutral or are hold-to-run; direction marking of controls; protection against unintended actuation; a warning when hazardous zones are not visible to the operator | read in part; confirmed-2023 status at search level |
| ISO 17757:2019 | Autonomous and semi-autonomous machine systems | Excludes remote control and points to ISO 15817 | — | — | search level |
| ISO 10968:2020 | Earth-moving machinery: operator's controls | Scope is machines under direct control; points to ISO 15817 for remote control. By analogy only | Contact-surface centres, neutral positions, movement axes and travel, spacing between controls and pedals | — | read in part |
| ISO 5353:1995 | Seat index point | Assumes a machine seat with stated adjustments. See the seat reference section below | The seat reference itself, and the definition of the neutral position | A loaded measuring device or the seat maker's statement | read in part |
| ISO 6682:1986 | Zones of comfort and reach for controls | Zones are given relative to the seat index point. Its annex assumes a seat with 150 mm fore-aft travel, a back angle of 10° ± 5° and controls fixed to the machine. Here the hand controls move with the seat and the seat may not slide at all, so the zones apply by analogy only | The seat reference; every control's grip or contact point through its whole travel; the seat's range of travel; the back angle | — | read in part, OCR |
| ISO 3411:2007 | Operator dimensions and minimum operator space envelope | Cab standard; by analogy only | The seat reference; the geometry around the seat (pods, stand, shelf, monitor) | — | scope read in part; envelope dimensions not read |
| ISO 11112 | Operator's seat: dimensions and requirements | Cab standard; by analogy only | Seat dimensions and adjustment ranges | — | a superseded edition (1995) opened as a sample; otherwise recalled |
| ISO 5006:2017 | Operator's field of view (direct view from the machine) | Governs direct view. In a remote station the whole view is through cameras and monitors, so it does not apply directly | Eye points relative to the seat reference | — | edition at search level; content recalled |
| ISO 16001:2017 | Visibility aids: camera and monitor systems | Relevant because the whole view is indirect. Has clauses on monitor location and image | Monitor position and size relative to the eye | Camera fields of view, the layout of camera tiles on the monitor, image sizes at the viewing distance | contents and scope read in part |
| ISO 11064-4:2013 | Control centres: layout and dimensions of workstations | **Closest fit for the control-room rigs.** States it is primarily for non-mobile control centres and seated, display-based workstations | Deck (foot support) plane, eye positions, display centres and directions, viewing distance, reach from the seat, leg and knee clearance under the shelf, seat and armrest heights | Percentiles computed from the expected user population; footwear and clothing allowances | terms and principles read in part; dimension tables not read |
| ISO 9241-5:2024 | Workstation layout and postural requirements | Screen workstation standard; fits by analogy. Calls the foot-support surface the "reference plane" | Seat and surface heights with adjustment ranges, leg room, display position relative to the eye | — | terms read in part |
| ISO 9241-303 | Requirements for electronic visual displays | Applies to the displays | Viewing distance, viewing angle to the display, display size and curvature | Character size on screen | search level |
| ISO 9241-410 | Physical input devices | Applies to the joysticks as input devices | Grip geometry and travel | — | named only |
| ISO 13850 | Emergency stop | Applies to the emergency stop; called up by ISO 15817 | Position of the emergency stop and whether it is unobstructed in every pose of the touchscreen | — | the reference to it was read in ISO 15817; the standard itself not read |
| EN 894-1 to -4, ISO 9355-1 to -3 | Displays and control actuators at machinery | Apply by analogy | Eye point and line of sight; display positions for vision zones; control positions for actuation zones; control type and travel | — | structure read in part (EN 894-4:2010, ISO 9355-2:1999, ISO 9355-3:2006); zone angles not accessible |
| ISO 14738:2002 | Anthropometric requirements for workstations at machinery | By analogy | Deck plane, seat surface height, leg-room width, knee depth, foot space | — | allowances read in part; tables not read |
| ISO 11226, EN 1005-4 | Static working postures | Apply to a posed manikin, not to the asset | The asset's contact surfaces and control positions, to pose a manikin | A posture model and a manikin | recalled |
| ISO 7250-1, ISO 15534 | Body measurement definitions; access openings | Background for any manikin | Clearances and access dimensions | — | recalled |
| ISO 15536-1:2005, -2:2007 | Computer manikins: requirements, verification | Governs the assessment tool that would have to be built, not the asset | — | Documentation and verification of the manikin | search level |

### What the picture means

1. **For the control-room rigs, ISO 11064-4 with ISO 9241-5 is the nearest yardstick**; the cab standards (ISO 5353, 3411, 6682, 10968, 11112) are usable by analogy only. Whether the cab family or the control-room family is "right" for a remote station is a question for the assessment phase. The asset's reference frames serve both.
2. **ISO 11064-4 asks for more than one eye position**: it requires eye positions for four postures (bent forward, erect, reclined, relaxed), reach for the 5th percentile and clearance for the 95th, from the expected user population (*read in part*). A single "provisional eye point" in the asset does not serve it; an eye position depends on population, posture and seat reference.
3. **Published reviews of teleoperation put most of the human-factors risk in perception and cognition**: latency, restricted field of view, lost depth and motion cues, situation awareness, workload (*search level*). A geometric model addresses the smaller part.
4. **The assessment phase must first build a digital human layer.** No open-source tool with sized manikins, posture prediction and reach and vision analysis was found. What exists are parts: body meshes, parametric bodies, kinematics libraries and public anthropometry of a US military population.
5. **Two regulatory questions were flagged and not answered**: whether display-screen-equipment rules apply to a room station (the European directive excludes control cabs of machinery), and how the European machinery regulation of 2023 treats a remote station (*search level*; application from January 2027 to be confirmed).

### Axis traps

ISO 6682 puts its origin at the seat index point with X forward, **Y to the right** and Z up (*read
in part*). The asset uses Y to the operator's **left**. On a nearly symmetric rig a mirrored lateral
coordinate would not be noticed, so any assessment needs an explicit, tested conversion.

## What the asset cannot support, whatever the standard

The plan's "not qualified for" list follows from one calculation by the human-factors reviewer
(*calculated on the plan's own numbers*): quantities relative to the seat combine two or three
estimated positions, giving about ±80–130 mm, while the spread they are meant to resolve between a
small and a large operator is about 100–190 mm.

| Assessment | Does a conclusion survive at photo accuracy? |
|---|---|
| Hand reach, vertical | Yes: inside the comfort zone across the whole range |
| Hand reach, lateral | Marginal |
| Hand reach, front to back | No: the zone is shallower than the uncertainty, and at approval there was no estimate at all |
| Forearm support height | No |
| Posture angles | No |
| Vertical viewing angle | Sign only, for one case |
| Legibility | No, and character size is interface data the asset will never hold |
| Knee clearance under the shelf | No: flips inside the range |
| Foot support for a small operator | No: flips |
| Foot clearance between the stand columns | Survives as a lead worth a tape measurement, not as a finding |

These rows were worked with round anthropometric figures from memory, for sensitivity only. The
build's own measurements changed several inputs; the conclusion that seat-relative verdicts need a
tape did not change.

## The seat reference: why "estimated", and why two frames

### What ISO 5353:1995 says (*read in part*)

- The seat index point is "fixed with respect to the machine and does not move with the seat through its adjustment and/or oscillation range".
- It is determined with all fore, aft, vertical and angular adjustments in their centre position.
- It is determined with a measuring device loaded to 65 kg (approximating a 75 kg operator) after flexing the cushions, and recorded from a fixing point named by the seat maker.
- It is a characteristic of the seat and may be specified by the seat manufacturer.
- For workplace design it is equivalent to the intersection of the seat's central plane with the theoretical pivot axis between torso and thighs.

### Why none of that is met here

| Condition | On this rig |
|---|---|
| Adjustments at centre | Whether the seat adjusts at all is unknown; the ranges are unknown, so "centre" cannot be placed |
| A loaded measuring device | Nothing was loaded; no device has been near the seat |
| The seat maker's statement | The seat is not identified. A pump bulb on a hose at Rig B's hub suggests a commercial seat or upholstery kit inside the shell |
| Known seat surfaces | No seat dimension was measured before the build; backrest and cushion positions were by eye |

### What the first draft did, and what was wrong with it

The decomposition research proposed a fixed "design" seat index point and a live "H-point" with a
range of ±25 mm. The human-factors review found four faults (*read in part and calculated*):

1. The fixed point was defined at "neutral", and neutral was "as photographed", which is not the centre of an unknown range.
2. "H-point" is a term from vehicle packaging, defined by a different device with different loads.
3. Two published relations between the seat index point and the seat reference point were mixed: one gives 97 mm above and 130 mm in front (ISO 3462:1980, *search level*), another 90 mm above and 140 mm in front (ISO 3776:1989, *read in part*). Applied in two different constructions they land about 30 mm apart.
4. The ±25 mm left out the dominant terms: the position and angle of the backrest and cushion, and how far a thick cushion compresses under load.

### What the asset carries instead

| Frame | Attached to | Meaning |
|---|---|---|
| `D_seat_ref_fixed` | The seat pedestal (does not move with any adjustment) | Estimated seat reference in the as-modelled neutral position |
| `D_seat_ref_live` | The seat base (moves with every seat adjustment) | The same point carried along when the seat is moved |

Both are labelled "estimated from photo-derived surfaces; not an ISO 5353 seat index point". Stated
range at approval: about ±70 mm vertically and ±60 mm or more front to back (*judgment* of the
human-factors reviewer). The seat maker's stated value, if the seat is a commercial one, replaces
the whole estimate; that is why the seat's make and model is the first item on the measurement sheet
for the client.

### What to ask for on site

In the order the human-factors review ranked them: the seat's maker and model, and whether the maker
states a seat index point; a loaded reading (a rigid board on the cushion with a person of stated
weight sitting on it, height of the board at the backrest; the same against the backrest; cushion and
backrest angles from a phone inclinometer on the boards); distances forward from the loaded backrest
to each joystick, the emergency stop, each pedal face and the stand; which adjustments exist, each
as yes or no plus range.

## Rules the project adopted from this

| Rule | Why | Where enforced |
|---|---|---|
| A value taken from a standard is tagged `standard_default` and any check against that standard returns "not assessable" | Otherwise filling gaps from standards makes the model look compliant by construction | Parameter records; see [../40-method/asset-contract.md](../40-method/asset-contract.md) |
| Never adjust a photo estimate because it looks ergonomically odd | The one place an estimate disagrees with a standard is exactly what an assessment exists to find | Measuring procedure |
| Motions that are only assumed are flagged as assumed | No photo shows the seat sliding, swivelling, rising, tilting or reclining | Joint records; decisions D-10 and D-31 in [../20-decisions/decision-log.md](../20-decisions/decision-log.md) |
| The seat references are named as estimates | The standard's conditions are not met | Decision D-11 |
| No compliance statement leaves the project | Sizes are unverified | The "not qualified for" list in [../30-plan/approved-plan.md](../30-plan/approved-plan.md) |

## Not verified

- No standard was read in full or from a purchased copy.
- The zone coordinates of ISO 6682, the envelope dimensions of ISO 3411, the vision-zone angles of EN 894 and ISO 9355-2, and the dimension tables of ISO 11064-4 and ISO 14738 were not accessible.
- Edition years other than those marked "search level" or "read in part" are recalled.
- The regulatory questions, and which standards the client itself works to.

The research behind this page is summarised in [sources.md](sources.md) (reports 03 and 04, review
R3); the full texts are in the project's private archive.
