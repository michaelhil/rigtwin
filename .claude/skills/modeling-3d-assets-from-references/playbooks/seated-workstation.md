# Playbook: seated operator stations

Asset-type knowledge for stations where one person sits and works with hand controls, foot
controls and displays: teleoperation rigs, simulator cockpits, control desks with a fixed seat.
Everything here comes from one asset (a seated teleoperation station on a platform, with
joysticks on armrest pods, a pedal set, a curved main monitor on a stand and a touchscreen on an
arm). Treat it as a starting hypothesis for the next station, not as a rule. Sizes are in that
asset's parameter files, not here.

## Contents

- Usual components and groups
- Usual joints, and which are commonly only assumed
- Body-contact surfaces
- Reference frames
- What later work will need from the asset
- Typical pitfalls
- What to ask for on a site visit

## Usual components and groups

Five groups worked for show/hide and for dividing the work between three modellers (seat; pods;
platform + stand + pedals).

| Group | Components (each a node) | Notes |
|---|---|---|
| platform | deck with rim and plinth; flush fittings | usually carries the gauge features: flat, fixed, with long straight edges |
| seat | pedestal; carrier (swivel, height); base (slide, tilt); pan; recline hub covers left and right; back shell; back cushion; headrest | the hard shell and the upholstery are different kinds of shape: angular outline with generous edge radii against soft rounded volumes |
| pods | per side: shell, top plate, armrest pad, joystick base and lever, panel buttons, key switch or E-stop; a touchscreen on an arm from one pod | left and right differ in their controls: look, do not mirror blindly |
| stand | columns, shelf, monitor arm, monitor with its screen surface, soundbar or other items resting on the shelf | columns may lean and taper; the shelf may be tilted |
| pedals | base with heel plate; one arm per pedal | a purchased unit: one base node plus one node per pedal |

Tags used: `structure`, `adjustable`, `control`, `display`, `body_contact`, `safety`, `hand`,
`foot`, `floor`.

Stopping rule in practice: grip buttons are part of the lever mesh; panel buttons, the key
switch and the E-stop are nodes because a simulator must light and press them; screws, seams,
stitching, cables and labels are left out.

## Usual joints, and which are commonly only assumed

| Joint | Type | Kind | Evidence usually available | Pivot or axis from |
|---|---|---|---|---|
| Seat swivel, height, slide, tilt | revolute / prismatic | adjustment | **assumed**: mechanisms hide under the seat | pedestal axis; platform axes |
| Seat recline | revolute | adjustment | position **seen** (hub covers); motion **assumed** unless two photos show different angles | the line through the two hub covers |
| Armrest pad slide | prismatic | adjustment | **inferred** when the pad sits differently on another instance | along the pod's top plate |
| Joystick roll and pitch | two revolute | control, with signal names | **seen**; travel from the vendor drawing | on the lever axis inside the base; check the drawing, it changes travel at the grip |
| Pedals | revolute | control | **seen** | the pin at the foot of the pedal arm |
| Pedal tray slide | prismatic | adjustment | **assumed** | along visible rails |
| Monitor height, tilt, pan | prismatic + revolute | adjustment | **inferred** (it hangs on an articulated arm) | model the motion the arm produces; the arm must follow or the joint be locked |
| Touchscreen arm | ball joints | adjustment | **seen** (it sat differently in two photos) | centre of each socket |

Assumed adjustments stay usable in the viewer with an "assumed range" label and a way back to
the photographed pose. The owner of the first asset asked for exactly this after meeting a lock
with no key.

Motion faults the first review found, worth trying on every station: the joystick's rubber boot
was rigid and tore when the lever moved (fix: the upper pleats move with the lever); the monitor
slid off a one-piece arm; a pedal passed through a cross bar inside its own travel.

## Body-contact surfaces

Seat pan, back cushion, headrest, armrest pads, heel plate, joystick grips. They are the first
things an operator's-eye view shows and the surfaces every posture assessment touches.

- Give them smooth lofted surfaces and enough triangles before any small hardware gets detail.
  The first build spent more triangles on one ring button than on the headrest, and the seat
  pan was rejected as a faceted trough.
- Keep them separate parametric parts whatever happens to the shells around them.
- Their heights and depths are critical-tier values and usually among the least verifiable from
  casual photos (the cushion rear and backrest front are rarely seen face on).

## Reference frames

| Frame | Fixed to | Definition | Note |
|---|---|---|---|
| `D_origin` | root | a tape-findable point on the platform (first asset: centre of the deck top) | gauge |
| `D_floor` | root | floor under the origin | needs the deck height above the floor |
| `D_seat_ref_fixed` | pedestal | seat reference that does not move with adjustments | **estimated** |
| `D_seat_ref_live` | seat base | on the centre line where the modeled cushion top meets the modeled backrest surface; moves with the seat | **estimated** |
| `D_eye_small`, `D_eye_median`, `D_eye_large` | seat base | from the live seat reference along the torso line, by sitting eye height of a small woman, a median adult and a tall man, less cushion compression, plus a forward offset | parameters of basis `standard_default` |
| `D_grip_L`, `D_grip_R` | each joystick lever | grip reference point from the vendor drawing; moves with the lever | sweep the joint to get the reach envelope |
| `D_pedal_face_<n>` | each pedal arm | centre of the pad face; x axis is the push direction | moves with pedal travel |
| `D_estop` and other contact points | the control | centre of the contact surface | |
| `S_<display>_screen` | each display | the active area as its own mesh; size and curvature from the device record | u = 0 at the operator's left, v = 0 at the top |

**Why the seat references are "estimated".** The standardised seat index point for operator
seats is defined on the real seat with a loaded measuring device, with every adjustment at the
centre of its range, or is stated by the seat maker. Photos give neither the load nor the
adjustment ranges. The frames here are built from photo-derived surfaces and labelled
"estimated, not a standardised seat index point", with a range of several centimetres. A seat
maker's stated value replaces the whole estimate, so the seat's make and model is the first
question for a site visit.

**Eye points.** The first build had a single eye point, at a tall man's eye height and behind
the seat reference; the reviewer caught it. Derive eye points from the seat reference with a
stated body size, place them ahead of the back line, and provide three.

## What later work will need from the asset

| Later work | Needs |
|---|---|
| Reach assessment | seat references; grip and contact frames through their whole travel; seat slide range with its evidence level; back angle |
| Vision assessment | eye points; display centres, normals, sizes, curvature; viewing distance. It is sensitive: the first asset's main screen subtends about 64° at 0.95 m and 52° at 1.20 m, and which is true awaits a tape |
| Posture and clearance | body-contact surfaces; leg room under the shelf; the entry gap between pod and stand; deck height |
| Control layout | contact centres, spacing between controls, travel and direction of each control |
| Simulator | stable node names; signal names on control joints; controls that can be lit and pressed as nodes; screen surfaces with UVs for a live image; the Y-up conversion at the root; a small triangle and draw-call count |

A value filled from an ergonomic standard cannot later be assessed against that standard. Any
result resting on critical values of class `assumed` or `invented` is reported as undetermined.

## Typical pitfalls

- **Pods that ride with the seat make hand reach independent of seat position.** Seat slide,
  height and swivel move the pods, joysticks and any pod-mounted screen together with the
  operator. Seat adjustments change reach to pedals and viewing distance, not reach to the hand
  controls. Get the parentage right (the pods' lower ends float above the deck: they hang from
  the seat base) or every reach study is wrong.
- **Arm-mounted screens move between photos.** Never use them as gauge features; give them a
  pose per photo; expect the main monitor's distance to be held only weakly.
- **Two photos from nearly the same spot are one viewpoint.** With one rear-quarter viewpoint
  and one operator's-eye view, the whole seat back, the rear of the cushion, the armrest pads
  and the monitor distance cannot be checked along the rear-quarter line of sight.
- **A platform said to be square may not be.** The first one measured 0.94 as long as wide.
- **"Seat height" and "head to display" are ambiguous figures.** From the floor or the deck? To
  the top of the back or the cushion? From the eye or the back of the head? Ask.
- **Purchased parts come in size variants.** A touchscreen measured 0.84 of the assumed model
  on two dimensions: it was the next size down.
- **White shells need exposure headroom; blacks need differentiation.** Leather, matte plastic
  and rubber must differ in colour and roughness or the seat, pods and boots merge.
- **Other instances differ in adjustable things** (recline angle, armrest position, items on
  the shelf) but agreed within one or two centimetres on fixed parts, so cross-instance
  profiles served for unseen sides.
- **Shell shape.** Hard seat and pod shells read wrong both as smooth blobs and as razor-edged
  facets; flat faces with rounded edges of stated radius worked.

## What to ask for on a site visit

Ranked by what the first asset lacked most:

1. Maker and model of the seat (does the maker state a seat index point?), and labels of every
   display, arm, joystick, pedal set and audio unit.
2. What adjusts, yes or no, and how far: seat slide, height, swivel, tilt, recline; armrest;
   pedal tray; display arms.
3. Platform: both sides, inner and outer, and deck height above the floor.
4. Top of the seat back above the deck; cushion front lip height, cushion depth and width.
5. From the backrest surface, at cushion level and at head height, forward to the main screen
   centre, each joystick centre and each pedal face.
6. Heights above the deck: armrest pad top, pod top plate front and rear, shelf near and far
   edge, screen centre.
7. Widths: joystick centre to centre; clear width between the pods; column gap.
8. One or two purchased-part sizes to confirm identification.
9. A square-on side photo of the seat and one from the side no photo showed.
