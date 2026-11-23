---
title: Gallery
tldr: Every picture of the project in order - the eleven masked source photos by rig, the planning trials, the blockout, modelling rounds 1 to 3 with the reviewers' sheets, the final model from several views, the model laid over the photos, and the browser viewer before and after its redesign - each with a caption saying what to look at.
status: living
updated: 2026-11-23
tags: [results, images, gallery]
---

# Gallery

## TL;DR

- About a hundred pictures in the order the work happened: source photos, trials, blockout, round 1, review 1, round 2, review 2, round 3, the final model, model against photos, viewer.
- **Photographs** appear only as masked copies (people and names blurred, metadata removed). Every other picture is a **render of the model**, made by the same viewer page a person uses.
- Captions say what to look at and what the picture shows or fails to show. Left and right always mean the operator's.
- For the story behind the rounds read [modelling rounds](../50-implementation/modeling-rounds.md); for the asset itself the [model card](rig-b-model-card.md); for the viewer the [viewer page](../50-implementation/viewer.md).

Where a picture is a sheet of several views, the caption names the views from left to right, top to
bottom. Build fingerprints (for example `0b6d8248b63f`, the final build) are printed in the footer of
contact sheets. All renders were made on 2026-11-23.

## 1. The source photographs (masked)

Eleven phone photographs of four physical units of the same rig design, from the owner's folder of
pictures of the rig. No tape measurements came with them. Directions below are corrected where the
photo descriptions file says "rear left" ([F-27](../60-lessons/failures-and-fixes.md#f-27)).

![Contact sheet of the eleven masked source photographs](../img/photos/contact-sheet.jpg)
*All eleven masked photos with their numbers: two of Rig A in a van (2502, 2503), three of Rig B, the reference rig (2511, 2530, 2532), six of Rigs C1 and C2 in a control room (2515 to 2520).*

### Rig A, in a van

![Photo 2502: the seat and console inside a van](../img/photos/photo-2502.jpg)
*Photo 2502, Rig A: the seat from the rear right inside the van's cargo space, the wide monitor on the bulkhead, the right joystick with the touchscreen, an open electronics drawer in the platform. The seat back shell here helped shape the model's shell; no camera was solved for it.*

![Photo 2503: the van seen through its open rear door](../img/photos/photo-2503.jpg)
*Photo 2503, Rig A: ultra-wide shot through the open rear door, strongly distorted. Context only: it shows where the rig sits, and nothing was measured from it.*

### Rig B, the reference rig

![Photo 2511: Rig B from the rear right with camera feeds on the monitor](../img/photos/photo-2511.jpg)
*Photo 2511, Rig B from the rear right with the camera feeds running: seat shell, both joysticks, the curved monitor on its white stand, the touchscreen and the platform. One of the three photos the cameras were solved from; it stands only 0.26 m from photo 2530, so the two count as one viewpoint for depth.*

![Photo 2530: Rig B from the rear right with the screens off](../img/photos/photo-2530.jpg)
*Photo 2530, Rig B from the rear right and slightly above, screens off: the whole platform outline with its pull handles, the right pod with its cup recess and emergency stop, the stand. The model's main matched view.*

![Photo 2532: the operator's view forward over the seat](../img/photos/photo-2532.jpg)
*Photo 2532, Rig B from above the seat looking forward and down: both joysticks and their grips, the key switch, the stand columns, the three pedals, the soundbar and the touchscreen. The only operator's-eye view and the only photo that pins positions along the rear-right line of sight.*

### Rigs C1 and C2, in a control room

![Photo 2515: two rigs side by side seen along their left sides](../img/photos/photo-2515.jpg)
*Photo 2515, Rigs C1 (front) and C2 from the doorway along their left sides: seat profile, pedals, stand with keyboard shelf and loudspeakers, platform edge with its glowing underside; the camera-feed screen is blurred. The source of most borrowed seat and pod shapes, since Rig B's left side is never photographed.*

![Photo 2516: close view across the right-hand consoles](../img/photos/photo-2516.jpg)
*Photo 2516, control room: close view across the right-hand consoles of both rigs toward the door: joystick, ring-lit buttons, emergency stop, the touchscreen arm from behind, the backrest upholstery and a gooseneck microphone. No camera could be solved; used by eye for the backrest front and the touchscreen arm.*

![Photo 2517: monitor backs and monitor arms from above and behind](../img/photos/photo-2517.jpg)
*Photo 2517, control room: from above and behind the curved monitors: the monitor backs, the articulated monitor arms and loudspeakers. The model's monitor back and arm links come from here, because on Rig B they are hidden behind the monitor.*

![Photo 2518: a rig from behind the seat, facing a wall display](../img/photos/photo-2518.jpg)
*Photo 2518, control room: the rig nearest the door from behind the seat: seat back, both joysticks, gooseneck microphone, touchscreen, keyboard on the shelf and the curved monitor (blurred) below a wall display.*

![Photo 2519: the stand, touchscreen and right joystick from the seat](../img/photos/photo-2519.jpg)
*Photo 2519, control room: closer view from the seat of the same rig: the stand with its keyboard shelf, the touchscreen, the right joystick, two loudspeakers; the monitor and wall display are blurred.*

![Photo 2520: a rig from the front left with the seat in profile](../img/photos/photo-2520.jpg)
*Photo 2520, Rig C2 from the front left: the curved monitor on its stand, a control box under the shelf, the left joystick, the gooseneck microphone and the seat in side profile. Its camera was solved from three deck edges and two room verticals and accepted with caution.*

## 2. The planning trials

Two agents built the same small brief with two stacks before a stack was chosen. Both models silently
lack the left armrest pod and joystick ([F-01](../60-lessons/failures-and-fixes.md#f-01)).

![Trial A: four views of a simple blockout with joint labels](../img/trials/trial-a-blockout-four-views.jpg)
*Trial A (Blender used as a library): front, side, plan and three-quarter views with labelled joints and a colour test pattern on the monitor. Look for the left pod: there is none.*

![Trial B: the rig at rest and posed, and the right joystick at rest and deflected](../img/trials/trial-b-joint-pose.jpg)
*Trial B (TypeScript with three.js, the stack chosen): the posing test, neutral and posed (joystick deflected, back reclined, touchscreen turned), and the right joystick at rest and deflected. Again only the right pod exists.*

## 3. The first complete blockout

Simple solids for every component, both sides, all 20 joints and the reference frames, before any
shaping: 11,162 triangles, 62 draw primitives, 0.33 MB.

![Blockout contact sheet: six views of the complete simple model](../img/blockout/blockout-contact-sheet.jpg)
*The blockout from the front, rear, left, right, above and in three-quarter view. Both pods and both joysticks are present; the footer says "Omitted: none". The seat is a smooth white block, the pods simple wedges.*

![The blockout with every part in its own colour and a legend](../img/blockout/blockout-component-colours.jpg)
*The blockout coloured by component, with the legend of component names on the right: the check that every node of the tree exists and sits where it should.*

![The blockout seen through the solved camera of photo 2530](../img/blockout/blockout-photo-camera-render-only.jpg)
*The blockout through the camera solved for photo 2530 (render only, no photo pixels). Comparing this view with the photo is how placement was judged from the first build on.*

## 4. Round 1

Three modellers worked in parallel, one per group, for 27 to 41 minutes each.

### Round 1 per group

![Seat, round 1, six views](../img/round1/seat-round1-six-views.jpg)
*Seat, round 1: rear three-quarter, front three-quarter, left, right, top, front. The shell outline and dark rear panel are right; cushion and backrest are flat facets with hard creases, which the reviewer rejected.*

![Pods, round 1, three views of both armrest pods](../img/round1/pods-round1-group.jpg)
*Both pods, round 1, rear three-quarter, front three-quarter and left: plates, grips, buttons and the touchscreen read correctly; each leg is a slab with a rounded capsule attached below.*

![Left joystick, round 1, close-up](../img/round1/pods-round1-joystick-left.jpg)
*The left grip, round 1, with its two rockers and two buttons, on a bellows of four thick folds. The grips were the reviewer's "best parts of the model"; the bellows was rigid and tore when the lever moved.*

![Platform, round 1, three views](../img/round1/platform-round1-group.jpg)
*Platform, round 1: deck panels, white rim with rounded corners, pull handles; the white band below the rim is too tall (finding T1).*

![Stand, round 1, three views](../img/round1/stand-round1-group.jpg)
*Stand, round 1: columns, tilted shelf, soundbar, curved monitor and its arm. The arm is one rigid piece, so the monitor left it when its height changed (finding J2).*

![Pedal set, round 1, from the operator's side](../img/round1/pedals-round1-closeup.jpg)
*Pedals, round 1, between the two columns: dimpled pads on leaning arms and the heel plate. A cross bar of the frame lay inside the pedals' travel (finding J3).*

### Round 1 assembled

![Round 1 contact sheet: the assembled model in six views](../img/round1/assembled-round1-contact-sheet.jpg)
*The assembled round-1 model in six views: 30,742 triangles, 68 draw primitives, 0.77 MB, every check passing. The reviewer still rejected 8 of 45 parts. Note the flat paper-white surfaces (exposure finding R1).*

## 5. Review round 1

Sheets rendered by the first reviewer agent from its own camera specifications; it read the model file
with its own code and never saw the builders' notes. Verdict: "In between: a credible layout carrying a
few toy-grade parts. Not accepted yet."

![Ten views of the whole rig, round 1](../img/review1/review1-whole-rig-ten-views.jpg)
*Ten whole-rig views: the three Rig B photo cameras, a low three-quarter, a standing adult's view and five orthographic views. Reads as the rig from every side; whites are flat.*

![The seat from eight angles, round 1](../img/review1/review1-seat-views.jpg)
*The seat from eight angles: the faceted cushion and flat-planed backrest behind findings S1 (blocker) and S2.*

![The pods from eight angles, round 1](../img/review1/review1-pods-views.jpg)
*The pods from eight angles: the slab-and-capsule leg (P1), the inflated armrest pad (P4) and the touchscreen arm like a baton (P5).*

![Close-ups of the rejected parts](../img/review1/review1-rejected-parts.jpg)
*The worst offenders, as the reviewer framed them: seat pan and backrest close up and from the front left, the right pod's armrest corner, a joystick pitched 20°, the monitor at its lowest, the touchscreen arm's base, the left pod's outer side.*

![The joysticks at their limits, round 1](../img/review1/review1-joystick-poses.jpg)
*Joysticks at ±20° in pitch and roll: the collar cuts into the top pleat on one side and lifts off on the other (J1). The neutral close-up shows the joint frames.*

![Monitor and touchscreen at their limits, round 1](../img/review1/review1-monitor-touchscreen-poses.jpg)
*Monitor low, high, tilted and panned, then the touchscreen arm and screen in two poses each. At the low limit the monitor hangs below its arm (J2).*

![Pedals at full travel, round 1](../img/review1/review1-pedal-full-travel.jpg)
*Middle pedal at full travel from the operator's side and from behind: the arm passes through the upper cross bar (J3).*

![Reference frames shown as small axes on the rig, round 1](../img/review1/review1-reference-frames.jpg)
*Reference frames as small coloured axes: seat references, grip points, emergency stop, pedal faces and screen centres. The single eye point then sat at a tall man's height and behind the seat reference (U1).*

## 6. Round 2

The same three modellers, resumed with the findings for their group, 13 to 15 minutes each.

### Round 2 per group

![Seat pan, round 2, six views](../img/round2/seat-round2-cushion-six-views.jpg)
*Seat cushion, round 2, in the round-1 views: a smooth loft with a rolled front lip and mild 35 mm bolsters; the hub covers in their housings.*

![Backrest, round 2, six views](../img/round2/seat-round2-backrest-six-views.jpg)
*Backrest, round 2: smooth upholstery with a soft recessed insert, rounded bolsters and head pad; the shell has rounded top corners.*

![Pods, round 2, three views](../img/round2/pods-round2-group.jpg)
*Both pods, round 2, in the round-1 views: leg and blade are now one faceted moulding.*

![Pod leg and blade from the outer side, round 2](../img/round2/pods-round2-leg-and-blade.jpg)
*The right pod from the outer side: a creased, tapering leg and a flat blade with its rear end cut in three flats (later finding N4).*

![The left joystick in eight poses, round 2](../img/round2/pods-round2-joystick-deflected.jpg)
*Joysticks in eight poses: the upper pleats ride with the lever, so the bellows flexes mid-height instead of tearing. Pivot lowered from 45 to 12 mm above the plate (an assumed value).*

![Stand, round 2, three views](../img/round2/stand-round2-group.jpg)
*Stand, round 2: the monitor arm is split into a base on the shelf and links that slide with the monitor.*

![Monitor arm at three heights, from behind and from the side](../img/round2/stand-round2-arm-three-heights.jpg)
*Monitor at its low, neutral and high positions (−0.095, 0, +0.060 m), from behind and from the side: the links follow and stay clear of soundbar and shelf.*

![Pedals at rest and at full travel, round 2](../img/round2/pedals-round2-rest-and-full-travel.jpg)
*Pedals at rest and at 20°, from behind, the side and the operator's side: the frame rods are clear of the sweep.*

![Platform, round 2, three views](../img/round2/platform-round2-group.jpg)
*Platform, round 2: band lowered to 0.105 m, re-measured through the cameras; handles cut from 472 to 136 triangles each.*

![Five close views of the whole rig with the round-2 materials](../img/round2/materials-round2-whole-rig-close.jpg)
*Round-2 materials in five views: satin white shell, lighter satin leather, matte black plastic, anti-glare screens. The blacks of joysticks and pedals are still very dark (finding N3).*

### Round 2 assembled

![Round 2 contact sheet: the assembled model in six views](../img/round2/assembled-round2-contact-sheet.jpg)
*The assembled round-2 model, build `c32727406a5c`: 28,042 triangles (fewer than round 1), 67 draw primitives, 0.72 MB.*

## 7. Review round 2

A fresh reviewer: "ACCEPTED AFTER THE LISTED FIXES"; 41 parts accepted, 5 with minor fixes, none
rejected; "the model is no longer a toy in any view".

![Five orthographic views of the whole rig, round 2](../img/review2/review2-whole-rig-five-views.jpg)
*Front, rear, left, right and top: proportions and stance as photographed.*

![Six views of the seat cushion, round 2](../img/review2/review2-seat-cushion.jpg)
*The cushion from the front, from above in place, from the side, from the rear right, as a wireframe and from above between the pods: smooth; the reviewer's only remark, a small pinch at each end of the lip (N6), is not visible at this size.*

![Eight views of the joysticks, round 2](../img/review2/review2-joysticks.jpg)
*Joystick grips, bellows and plates from eight angles, with one wireframe: the right button sets on each grip, but near-black from the operator's eye.*

![Nine views of the stand and monitor arm, round 2](../img/review2/review2-stand-and-arm.jpg)
*Stand and monitor arm from nine viewpoints, including the operator's: the columns' half-round operator-side faces read as pipes (N2).*

## 8. Round 3: the final fixes, before and after

One agent, 17 minutes: the three fixes the round-2 reviewer required and a joint-limit bug. Each pair
is the same camera, round 2 on the left, round 3 on the right.

![Right cup recess before round 3](../img/round3/round3-cup-recess-before.jpg) ![Right cup recess after round 3](../img/round3/round3-cup-recess-after.jpg)
*Fix 1, right pod: before, a white spike at the tip of the plate notch and a slot cut through the tray wall; after, the seam closed and a shallow spout.*

![Left cup recess before round 3](../img/final/final-cup-left-before.png) ![Left cup recess after round 3](../img/final/final-cup-left-after.png)
*Fix 1, left pod from the front and outer side: the white spike beside the cup and the step in the tray wall are gone.*

![Stand columns from the operator's eye before round 3](../img/round3/round3-columns-before.jpg) ![Stand columns from the operator's eye after round 3](../img/round3/round3-columns-after.jpg)
*Fix 2, the columns from the operator's eye: half-round faces that read as pipes, then flat faces with 12 mm corner radii, as in photo 2532.*

![Column sections seen from above before round 3](../img/final/final-column-section-before.png) ![Column sections seen from above after round 3](../img/final/final-column-section-after.png)
*Fix 2, the two column sections cut and seen from above: round at both ends before; flat with tight corners on the operator's side after, the far end still round (photo 2530).*

![Right joystick close-up before round 3](../img/final/final-joystick-right-before.png) ![Right joystick close-up after round 3](../img/final/final-joystick-right-after.png)
*Fix 3, the right joystick: rubber and plastic lifted from near-black to dark grey with some sheen, so bellows folds and grip buttons show their form.*

![Pedals from the operator's side before round 3](../img/final/final-pedals-before.png) ![Pedals from the operator's side after round 3](../img/final/final-pedals-after.png)
*Fix 3, the pedals from the seat: pad studs, arms and heel plate separate from the dark deck.*

## 9. The final model

Build `0b6d8248b63f`: 28,070 triangles, 67 draw primitives, 0.72 MB, all checks passing.

### Whole rig

![The final model from the rear right, three-quarter view](../img/final/final-rear-three-quarter.jpg)
*The final model from the rear right, close: seat shell, right pod with cup recess, emergency stop and touchscreen, flat-faced columns, soundbar and monitor.*

![The final model from the front, three-quarter view](../img/final/final-front-three-quarter.jpg)
*From the front left: the white back of the monitor and its arm on the shelf, the pedal set between the columns, the seat front and both armrests. The seat front is borrowed from other rigs.*

![The view from the median eye point, final model](../img/final/final-operators-eye.jpg)
*From the median eye point, looking forward and down, as in photo 2532: grips, buttons, columns, pedals and touchscreen.*

![Final contact sheet: six views](../img/model/rig-b-contact-sheet.jpg)
*The final contact sheet, front, rear, left, right, top and three-quarter, footer "28,070 triangles · 67 draw primitives · 0.72 MB · GLB 0b6d8248b63f · Omitted: none".*

![The final model from the rear right, at a distance](../img/model/rig-b-view-rear-right.jpg) ![The final model from the front left, at a distance](../img/model/rig-b-view-front-left.jpg)
*The whole rig from the rear right and the front left at a distance, neutral pose.*

![The final model from the operator's left side](../img/model/rig-b-view-side.jpg) ![The final model from the operator's eye, wide](../img/model/rig-b-view-operators-eye.jpg)
*From the operator's left (the side no Rig B photo shows) and a wide operator's view of monitor, stand, touchscreen and pedals.*

### Groups on their own

![The platform group on its own](../img/model/rig-b-group-platform.jpg)
*Platform: 5 parts, 2,152 triangles: deck panels, white rim and band, dark plinth, four pull handles.*

![The seat group on its own](../img/model/rig-b-group-seat.jpg)
*Seat: 9 parts, 8,516 triangles: pedestal, mechanism, cushion, hub covers, back shell, backrest, headrest.*

![The pods group on its own](../img/model/rig-b-group-pods.jpg)
*Pods: 22 nodes with geometry (21 parts and the touchscreen surface), 11,618 triangles.*

![The stand group on its own](../img/model/rig-b-group-stand.jpg)
*Stand: 8 nodes with geometry (7 parts and the monitor surface), 3,436 triangles.*

![The pedals group on its own](../img/model/rig-b-group-pedals.jpg)
*Pedals: 4 parts, 2,348 triangles: base with heel plate and frame, three pedals.*

### Parts and motion

![Every part of the final model in its own colour, with a legend](../img/model/rig-b-parts-colour-coded.jpg)
*Every part in its own colour with the legend of part names: 46 parts and 2 screen surfaces.*

![Moving parts at their limits, sixteen views](../img/model/rig-b-joint-limits.jpg)
*Moving parts at both limits: seat slide ±100 mm, recline 0° and 35°, monitor height −95/+60 mm and tilt ±15°, left joystick ±20° in pitch and roll, left armrest ±50 mm, middle pedal 0° and 20°. Seat motions are assumed.*

![Assumed and inferred joints at their upper limits together](../img/final/final-limits-upper.jpg) ![Assumed and inferred joints at their lower limits together](../img/final/final-limits-lower.jpg)
*The joint-limit fix: monitor tilt, monitor pan, recline, seat swivel and seat tilt all at their upper limits, then all at their lower limits, in six views each. Before round 3 a pose exactly at a stated limit was refused.*

## 10. The model against the photos

The model rendered through each solved photo camera, beside the masked photo, and its part outlines
drawn on the photo. This is how placement was judged. Sideways errors of a few centimetres show; an
error along the line of sight barely moves a point (0–2 pixels for 50 mm in photos 2511 and 2530), so
a good fit there proves little about depth ([F-07](../60-lessons/failures-and-fixes.md#f-07)).

![Photo 2530, the model from its camera, and the outlines on the photo](../img/matched/rig-b-photo-2530-strip.jpg)
*Photo 2530: platform, seat, pods, joysticks, stand and monitor outlines lie on their photographed edges within a few centimetres.*

![Photo 2511, the model from its camera, and the outlines on the photo](../img/matched/rig-b-photo-2511-strip.jpg)
*Photo 2511: the same fit with the monitor on; the touchscreen was turned between this photo and 2530, so its pose fits only one of them.*

![Photo 2532, the model from its camera, and the outlines on the photo](../img/matched/rig-b-photo-2532-strip.jpg)
*Photo 2532, the operator's view: columns, shelf, soundbar, pedals and both joysticks. The only view that pins depth along the rear-right line.*

![Photo 2515 of Rig C1, the model from its camera, and the outlines](../img/matched/rig-c1-photo-2515-strip.jpg)
*Photo 2515, Rig C1, camera solved from the deck outline alone: platform, stand and pods fit; the model's back outline sits forward of the photographed back, because Rig C1's back is reclined about 4° more than Rig B's. The C1 keyboard and loudspeakers are not in the model.*

![Photo 2520 of Rig C2, the model from its camera, and the outlines](../img/matched/rig-c2-photo-2520-strip.jpg)
*Photo 2520, Rig C2, camera accepted with caution: platform and columns fit; the monitor outline sits above the photographed monitor and the seat outlines are offset by several centimetres. Either this rig is set differently or the camera is off; this photo cannot tell which.*

![Outlines on photos 2530, 2511 and 2532 at full size](../img/matched/rig-b-photo-2530-outline.jpg) ![Outlines on photo 2511 at full size](../img/matched/rig-b-photo-2511-outline.jpg) ![Outlines on photo 2532 at full size](../img/matched/rig-b-photo-2532-outline.jpg)
*Full-size outline images for the three Rig B photos, for close inspection.*

![Outlines on photo 2515 at full size](../img/matched/rig-c1-photo-2515-outline.jpg) ![Outlines on photo 2520 at full size](../img/matched/rig-c2-photo-2520-outline.jpg)
*Full-size outline images for Rigs C1 and C2.*

![Photo 2530 and the model side by side](../img/matched/rig-b-photo-2530-side-by-side.jpg) ![Photo 2511 and the model side by side](../img/matched/rig-b-photo-2511-side-by-side.jpg) ![Photo 2532 and the model side by side](../img/matched/rig-b-photo-2532-side-by-side.jpg)
*Masked photo and render side by side for the three Rig B photos.*

![Photo 2515 and the model side by side](../img/matched/rig-c1-photo-2515-side-by-side.jpg) ![Photo 2520 and the model side by side](../img/matched/rig-c2-photo-2520-side-by-side.jpg)
*Masked photo and render side by side for Rigs C1 and C2.*

## 11. The viewer, before and after the redesign

### Before

![The first viewer on the blockout](../img/viewer/viewer-v1-on-blockout.jpg)
*The first viewer, on the blockout: a long checklist of parts on the left, view buttons and 24 joint sliders on the right, the model in the middle 58 % of the window.*

![The first viewer on the round-2 model](../img/viewer/viewer-before-default.jpg) ![The first viewer with the monitor surface selected](../img/viewer/viewer-before-monitor-selected.jpg)
*The first viewer on the round-2 model, as it opened, and with the monitor's active area selected: the details appear at the bottom left, far from the sliders on the right; locked seat sliders show padlocks. The owner called it "overcomplicated".*

### After

![The redesigned viewer as it opens](../img/viewer/viewer-after-default.jpg)
*The redesigned viewer: six group rows, four buttons at the top right, a hint line at the bottom; the model takes 82.8 % of the window.*

![The monitor selected, with its card](../img/viewer/viewer-after-monitor-card.jpg)
*The monitor selected: its card has Hide, Show only this, Zoom to, one height slider and one pad for turn and tilt; the strip at the top offers "Back to as photographed".*

![The seat moved within its assumed ranges, with the amber notice](../img/viewer/viewer-after-seat-assumed-notice.jpg)
*The seat moved 5 cm back and reclined to 20°: every seat slider carries an "assumed range" tag, the card explains why, and an amber notice stays on the picture.*

![The right joystick dragged in the picture](../img/viewer/viewer-after-joystick-dragged.jpg)
*The right joystick dragged in the picture: the pad shows 1° left and 7.5° forward.*

![Only the seat shown](../img/viewer/viewer-after-show-only-seat.jpg)
*"Show only this" on the seat: all 9 seat parts stay, 37 parts are hidden, "Show all" brings them back.*

![The operator's-eye view in the viewer](../img/viewer/viewer-after-operators-eye.jpg)
*The operator's-eye view: the camera on the median eye point, looking at the monitor's camera-tile test picture.*

![Parts coloured by how sure the sizes are](../img/viewer/viewer-after-how-sure.jpg)
*"How sure are we?": 0 parts measured on the rig, 2 from the maker's drawing, 19 measured in photos, 25 estimated; a part takes the colour of its least certain size.*

![The phone layout with the monitor's card as a bottom sheet](../img/viewer/viewer-after-phone-monitor-sheet.jpg)
*At 390 px wide: the model fills the screen, the parts list becomes a drawer and the monitor's card a bottom sheet.*

### Lighting

![The rig with the earlier lighting](../img/viewer/exposure-before.jpg) ![The rig with the corrected lighting](../img/viewer/exposure-after.jpg)
*Before and after the exposure correction, same view: lit whites came down from 244–249 to 221–231 of 255, so the shell's facets and the columns' roundness show.*
