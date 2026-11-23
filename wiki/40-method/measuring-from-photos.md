---
title: Measuring from photos
tldr: The measuring procedure as executed for Rig B - camera from metadata, structure from motion, bundle adjustment in a model frame fixed on the platform deck, scale closure against purchased parts, triangulation and single-view rays, honest classes and ranges, and what the photos cannot check.
status: living
updated: 2026-11-23
tags: [measurement, method, cameras, uncertainty]
---

# Measuring from photos

## TL;DR

- Three photos of Rig B give two real viewpoints: one from the operator's position (photo 2532) and two nearly identical ones from the rear right (2511, 2530; 0.26 m apart).
- The model frame is fixed on the **platform deck** (plane, rectangle, one length). Those gauge features agree with the photos by construction and are never counted as verification.
- With the deck width set to the owner's 1.50 m, purchased parts close the scale: soundbar 1.003, pedal pitch 1.00, monitor 1.02 (*measured*).
- Every value is one of three honest classes: **two-view** (triangulated), **single-view** (one sight line plus a stated assumption), **by eye**. Of 118 table records: 26, 60 and 20; 7 are recorded as real gaps with no value.
- A 50 mm error along the rear-right line of sight moves a point 0–2 pixels. The seat back, armrest pads, emergency stop and the monitor's distance cannot be verified from these photos, however good an overlay looks.

Terms (gauge, bundle adjustment, reprojection error, triangulation) are explained once below and in
the [glossary](../00-overview/glossary.md). The scripts that did this work live in the measurement
agent's working folder, which is not part of the repository; this page is written so that an agent
can re-implement them. Libraries used: numpy, Pillow, OpenCV (headless), scipy, pycolmap.

## Frames and units

| Frame | Definition |
|---|---|
| Pixel frame | The **upright** photo as displayed, scaled to 1500 × 2000 px. Originals are 4284 × 5712 px, so 1 working pixel = 2.856 original pixels. Picks are made on the originals and stored in working pixels with decimals. |
| Camera frame | x right, y down, z forward (the OpenCV convention). `x_cam = R · X_model + t`. |
| Model frame | Metres. Z up, X forward (operator toward the main display), Y to the operator's left. Origin: centre of the deck's top surface. |

Projection of a model point `X`: `x = R·X + t`, `u = f·x₀/x₂ + cx`, `v = f·x₁/x₂ + cy`. One focal
length `f` for both axes, principal point at the image centre (750, 1000), no lens distortion
(the phone stores corrected images; *assumed*, not verified).

## Step 1. Read the camera from the photo metadata

Ten of the eleven photos come from the phone's main camera (26 mm equivalent); one is ultra-wide
and is used for context only.

```
f_px = f35 / 43.27 × image diagonal in pixels
     = 26 / 43.27 × sqrt(1500² + 2000²) = 1502.3 px        (working frame)
```

Do not let a solver estimate the focal length from three photos: in the investigation it came out
between 1328 and 3090 px (*tested*). Later, the deck rectangle itself gave a mild correction (step 5).
Check for a depth map in the file before assuming one: here the second image in each file is a
brightness gain map, not depth (*tested*).

## Step 2. Sort photos by rig instance and by what may have moved

Four physical rigs appear in the photos. Photos of different rigs match each other in feature
matching (18–26 verified false matches between rigs, *tested*) and would corrupt a joint solve, so
each rig is solved alone. Within one rig, list parts on arms and slides as "may have moved between
shots". On Rig B the touchscreen moved between photos; the monitor did not (≤ 20 mm, 2°).

## Step 3. Structure from motion for a first camera set

Structure from motion (SfM) finds camera positions from features matched between photos. Run with
the focal length fixed at the metadata value, it registered all three Rig B photos with 35 3D points
and 0.32 px reprojection error (the distance between where a 3D point lands in a photo and where it
was observed). Two facts matter:

- the 35 points are almost all on the room floor, wall and window frames. The rig itself is glossy
  and featureless. SfM gives **cameras**, not rig geometry;
- the result has no position, orientation or scale of its own (seven free numbers).

## Step 4. The model frame and its gauge features

A *gauge feature* is something used to pin the frame down. It fits by construction, so a small
residual on it proves nothing.

| Gauge | Feature on Rig B |
|---|---|
| Plane z = 0 | deck top: four traced deck edges in photos 2511 and 2530, the front edge in 2532, five deck screws seen in 2530 and 2532 |
| Origin and X, Y directions | the deck rectangle (boundary between the black deck and the white rim): edges at x = ±0.706, y = ±0.750 |
| Scale | deck lateral width = 1.50 m (the owner's figure) |
| **Not** gauge | stand, pedals, seat, pods, monitor: all measured in that frame |

**Edge tracing.** The deck boundary is traced on the full-resolution original with a sub-pixel edge
follower:

```
trace_edge(photo, p0, p1, dark_side_point):
    for stations every 2 px along the seed segment p0→p1:
        sample grey values along the normal (±8 px, step 0.175 px), averaged over 3 neighbours
        smooth; take the strongest gradient of the expected sign; refine by a parabola through 3 samples
    fit a line by RANSAC (400 trials, 0.7 px tolerance)
    repeat 4 times: extend along the fitted line across the image; keep stations that are
        within 0.7 px of the line, have at least 45 % of the reference contrast,
        and belong to a run of at least 8 consecutive accepted stations; refit by least squares
    return line, accepted points, rms
```

Result: 70–440 points per edge, 0.06–0.35 px rms. Screw sockets are located as the centroid of the
darkest compact spot near a hand pick; every pick was looked at on a zoomed, gridded tile.

## Step 5. Bundle adjustment in the model frame

Bundle adjustment solves cameras and points together by minimising reprojection error. Here it is
done directly in the model frame, with the deck as the only gauge.

| Item | Value |
|---|---|
| Unknowns | 3 camera poses (6 numbers each), deck length-to-width ratio `a`, optionally the focal length, all 3D points |
| Observations | 35 SfM background tracks (σ 0.7 px); 12 hand-picked ties (σ 1 px): 5 deck screws forced onto z = 0, 7 shelf nut tops; 9 deck edge traces, about 40 points each (σ 0.5 px) |
| Edge residual | signed pixel distance of each traced point from the projected model line: front and rear at x = ±a·W/2, left and right at y = ±W/2, z = 0 |
| Loss | soft-L1, scale 2 |
| Start values | each rear photo alone from the rectangle (planar pose from the four corner intersections, then refined on the edge points with `a` free); the third camera through the SfM relative poses; the SfM-to-model scale by a 1-D search that puts photo 2532's traced front edge on the model's front edge |

```
resid(params):
    for each tie point i, each photo k that sees it:  (project(cam_k, X_i) − pick_ik) / σ_i
    for each traced edge e in photo k:                 dist(points_e, project(cam_k, model_line_e)) / 0.5
solution = least_squares(resid, start, loss = soft_l1)
```

Residuals after adjustment (*measured*):

| Item | Residual |
|---|---|
| Deck edge traces (9) | 0.18–0.90 px rms each |
| Deck screws, two views, forced onto z = 0 | 0.7–2.4 px |
| Shelf nuts | 0.1–0.9 px in photos 2530 and 2532; right-hand nuts 2.6–3.4 px in 2530 and 2511 |
| SfM tracks (35), worst view | median 1.3, 90th percentile 2.5, maximum 3.6 px |
| Camera centres across variants (focal fixed or free, without SfM tracks, without 2532's edge) | move ≤ 20 mm |
| Deck length / width across the same variants | 0.938–0.943 |
| Focal length | 1515.5 px solved; +0.9 % on the metadata value |

A systematic 2.6–3.4 px offset remains on the right-hand shelf nuts in the rear-right views (about
5 mm at that distance). It did not go away and is inside the stated ranges. The result that the
deck is **not square** (1.41 m front to back for 1.50 m width) comes out of this step: a square
deck fits 2.5 px worse and needs a focal length about 12 % off the metadata value.

## Step 6. Scale, and closure against parts of known size

One length sets the scale: deck width 1.50 m. *Closure* means measuring every part whose size is
known from its maker in that same frame and comparing.

| Part | Measured (m) | Maker's figure (m) | Ratio | How measured | Comment |
|---|---|---|---|---|---|
| Soundbar length | 0.411 | 0.410 | **1.003** | two-view corners | clean test |
| Pedal pitch | 0.140 | 0.14 (derived) | **1.00** | two-view pad corners | clean test |
| Monitor outer height | 0.373 | 0.365 | 1.02 | curved-panel model fit | weak: maker's size fits to 2.5 px, free size to 1.8 px |
| Monitor chord | 1.202 | 1.174 | 1.02 | model fit | the more curved candidate model is rejected (7–9 px) |
| Joystick plinth | 0.093–0.109 | 0.1067 | 0.87–1.02 | one ray on the plate plane | soft rubber edge; weak |
| Joystick grip top above plate | 0.22 | 0.2399 | 0.92 | another rig, one ray | weak |
| Touchscreen outer height | 0.205 | 0.2444 (15.6-inch) | **0.84** | two-view corners | the part was misidentified: it is the 13.3-inch size |
| Touchscreen active height | 0.1655 | 0.1946 / 0.165 (13.3-inch) | 0.85 / **1.00** | two-view corners | confirms the smaller size |
| Pedal heel-rest width | 0.402–0.420 | 0.388 | 1.04–1.08 | one ray, height unknown | wrong reference; no longer used |

Rules applied when a ratio is off: do **not** average. Ask which assumption could be wrong.
A 16 % scale error is excluded by every other part, so the touchscreen identification was wrong.
The heel rest does not lie on the deck plane, so its ray-on-deck width means nothing; the pedal
unit closes through its pedal pitch instead. This resolved a 7 % disagreement between two scale
references that had blocked the plan.

One doubt remains and is carried: whether 1.50 m is the black deck or the outer size including the
15 mm rim (2 % apart). Soundbar and pedals favour the deck, the monitor the outer size. Adopted:
the deck, at about 60 : 40. If wrong, every photo-derived length is 2 % too large. Stated ranges do
**not** include this.

## Step 7. Picking and accepting landmarks

A landmark is a named physical point: a screw socket, a nut top, a sharp corner. Picks are made on
gridded zoom tiles of the original and refined by code where possible (dark-spot centroid, edge
follower). A pick seen in two photos is accepted only if the two sight lines meet within a few
pixels; that test does not involve the model. Rejected in this run: two shelf nuts picked in photo
2511 (22 px off: the wrong nut) and a seat stitch line whose two picks were not the same line.
Rounded edges and silhouettes are not landmarks: the visible outline moves with the viewpoint.

## Step 8. Measuring: five routes

| Route | Class | Algorithm | Used for |
|---|---|---|---|
| (a) Two-view point | two-view | linear triangulation from the two projection matrices, refined by least squares on reprojection error; report the error in each view and the angle between sight lines (26–49° here) | shelf nuts, soundbar, pedal pads, touchscreen left edge, plate screws |
| (b) Two-view line | two-view | an edge traced in both photos: each image line back-projects to a plane; the 3D line is the intersection of the two planes | plate tilt, cushion stitch line, arm post |
| (c) One ray on a **measured** plane | single-view | intersect the pixel ray with a plane found by (a): deck z = 0, shelf plane through seven nut tops, tilted plate plane | shelf outline, column feet, controls on the plates, deck handles |
| (d) One ray on an **assumed** plane | single-view | same, with the plane assumed: the seat's symmetry plane y = 0, an assumed side plane | seat back top, back shell outline, pod blade |
| (e) Model fit | single-view | fit a parametric shape to picks in two photos | the curved monitor: centre, yaw, tilt, optionally width and height, against four corners in one photo and the bottom-edge curve in the other |

```
ray_on_plane(cam, pixel, n, d):                 # plane n·X = d
    r = normalise(Rᵀ · [(u − cx)/f, (v − cy)/f, 1]);  C = −Rᵀ·t
    return C + r · (d − n·C) / (r·n)
```

For route (d) each record states the assumption **and** how much the result moves if it is wrong.
Example: the top of the seat back, one ray on y = 0, moves 7 mm for a 50 mm error in the plane;
the recline hub moves 55 mm in height for 40 mm of plane error. The first is usable; the second is
taken from another rig's side view instead.

## The three honest classes, and what "±" means

| Class in the table | Meaning | Records (of 118) |
|---|---|---|
| `photo` / `two_view` | sight lines from two photos meet within a few pixels | 26 |
| `photo` / `single_view` | one ray plus the assumption named in the evidence text | 60 |
| `assumed` / `by_eye` | proportion judged in a photo; no coverage claimed | 11 |
| `assumed` / `cross_instance` | measured on another rig of the same product | 9 |
| `measured` (owner) and `vendor` | given, not derived | 3 and 2 |
| `none` | a real gap: recorded with a reason and no value | 7 |

A range written "± x" is meant to contain the true value about nine times in ten. It is a judgment
built from pick spread, the spread across photos and the sensitivity to the stated assumption; it
is not a computed confidence interval. By-eye values carry no range. A range may never leave out a
derivation that has not been shown to be wrong.

## What a photo cannot check (detectability)

For each landmark and photo, compute how many pixels a 50 mm error would move it. Pixel shift per
50 mm, by direction X / Y / Z (*calculated with the solved cameras*):

| Feature | Photo 2530 | Photo 2511 | Photo 2532 |
|---|---|---|---|
| Shelf centre | 19 / 30 / 33 | 17 / 27 / 30 | 25 / 57 / 54 |
| Monitor centre | 21 / 33 / 41 | 18 / 29 / 34 | 17 / 79 / 89 |
| Seat back top | out of frame | 52 / 32 / 61 | not visible |
| Hub centre | 49 / 46 / 40 | 42 / 40 / 41 | not visible |
| Pod plate front (right) | 28 / 39 / 37 | 24 / 35 / 35 | 62 / 79 / 53 |
| Pedal heel edge | 24 / 29 / 27 | 22 / 27 / 27 | 44 / 51 / 31 |
| Armrest pad rear (right) | 57 / 52 / 52 | 46 / 43 / 50 | not visible |

The table hides the real problem. The two rear photos look along the platform's diagonal, so a
50 mm move **along their line of sight** shifts a point 0 px in photo 2530 and 1–2 px in 2511. Only
parts also seen in photo 2532 are pinned in that direction. Not verifiable from these photos: the
whole seat back, the hub, the rear two thirds of the cushion, both armrest pads behind their front
edge, the emergency stop, the right pod's outer edge, blade and leg, the monitor's distance
(±0.04 m, held by a model fit), the right half of the touchscreen. For these parts a matched
overlay looks right even when the part is 5–10 cm off. The modellers were told so, and told to
trust the table and the side view of another rig, not the overlay.

## Cameras for other rig instances

Other rigs have no multi-photo solve. Their camera is found from the traced deck outline alone,
taking the deck as 1.412 × 1.500 m (as measured on Rig B) and the focal length from Rig B. Starts
from 12 directions; solutions whose traced points fall outside the deck are rejected (line-only
data admits a mirrored solution).

| Photo | Rig | Solved from | Check on features not used | Verdict |
|---|---|---|---|---|
| 2515 | C1 | 4 deck edges (0.23 px) | fourth edge 2.6 px when solved on the other three; two room verticals 0.8 and 1.5 px; deck handles 7–8 px | accepted |
| 2520 | C2 | 3 deck edges + 2 room verticals | deck handle 5.5 px | accepted with caution; values through it are `cross_instance`, ±0.05 m |
| 2516, 2517, 2518 | C | — | — | not solved: too little platform outline visible |

Photo 2520 solved from three lines alone is exactly determined and **failed** its check (room
verticals missed by 24–52 px, camera height 0.2 m wrong). The verticals were then added to the
solve. An exactly determined solve has zero residual and no evidence value.

## How values are recorded

Three files leave the measurement stage (working files, outside the repository):

```toml
# dimension table: one record per dimension
[stand.shelf_tilt_deg]
value = 9.9
unit = "deg"
range = 0.8                # ± in the record's unit; omitted for by-eye values
class = "photo"            # measured | vendor | photo | assumed | none
basis = "two_view"         # photo: two_view | single_view;  assumed: by_eye | cross_instance
tier = "critical"          # critical | layout | cosmetic
evidence = "Plane through 7 triangulated nut tops; roll about X 0.25 deg. Unchanged within 0.3 deg across the variants of the camera solve."

# shape points: named 3D points for profiles and outlines
[stand.shelf_L_outer_near]
xyz = [0.4268, 0.3039, 0.782]
class = "photo"
basis = "two_view"
range = 0.01
source = "Rig B"
note = "top of shelf fixing nut"
```

The camera file holds, per photo: image size, `fx`, `fy`, `cx`, `cy`, `R` (3 × 3), `t`, the rig
shown, how it was solved and its residuals. The viewer reads it on the local server to render
through the photo's camera (`cam=` in the [tool reference](../80-reference/tools.md)).

A modeller copies a value into a parameter record (format in the
[asset contract](asset-contract.md)) and repeats the evidence in the record's `evidence` text. The
parameter loader has only the class `photo`; whether a value is two-view or single-view is stated
in the evidence text. The platform, stand, seat and pedal files start it with "Two views." or
"Single view."; the pods file names the photos and the plane instead (an inconsistency to clean
up). *Not implemented:* a machine-checked link from a parameter to its measurement record.

## Worked example: the shelf height

Before this run, three derivations of the shelf's height above the deck existed:

| Derivation | Result |
|---|---|
| Operator's-eye photo, single view | 663–680 mm |
| The two rear photos as a stereo pair | 800 mm, with a calculated error bar of ±45 mm |
| Another rig, by proportion | 690 mm |

The first report chose 690 ± 45 and explained the 800 away as an effect of the short baseline.
That explanation was never tested; two of the three routes shared a scale reference; and ±45 does
not cover 800. Reviewers then triangulated between the operator's-eye photo and a rear photo and
got 700–750 mm depending on the scale reference, and noticed that the shelf is tilted.

How it was resolved in this run (*measured*):

1. Seven shelf nut tops were triangulated between photos 2530 and 2532 (residuals 0.1–0.9 px).
2. A plane through them fits to 0.3 mm rms and is tilted **9.9°** (far edge low). All earlier
   routes had assumed a horizontal shelf.
3. Shelf top = nut plane minus 3 mm: **0.785 m at the operator-side edge, 0.735 m at the far edge**
   (±0.010 and ±0.012). "The shelf height" was never one number.
4. The scale reference behind the low values (the pedal heel rest) was shown to be wrong in the
   closure step.

Lessons kept in the method: a method's own error bar understates the truth; a correction that has
not been tested is not a resolution; routes that share a scale reference are not independent; the
range must cover every derivation not shown to be wrong.

## Corrections the modellers made later, using the solved cameras

The solved cameras stay useful after the table is written: a modeller can project a candidate shape
into a photo, or cast its own ray onto a known plane. Corrections made that way, each recorded in
the parameter's evidence text:

| Parameter | Table value | Corrected value | How |
|---|---|---|---|
| Stand column depth at the foot | 0.15 ± 0.03 | 0.22 ± 0.02 | the table took the sight line at 40° to the X axis; the ray from the solved camera is at 24°, which turns the same projected width into about 0.25; silhouettes of both columns compared with the projected section |
| White band height of the platform | 0.15 ± 0.04 (one steep pick) | 0.105 ± 0.01 | brightness read along vertical lines on two faces through the solved cameras, in 1 cm steps, in two photos |
| Emergency stop height above the plate | about 0.045 | 0.029 ± 0.006 | head height compared with its own 33 mm width in the same photo, corrected for the viewing angle; the conflict is written in the record |
| Deck panel joints | not measured (`none`) | panel outlines ± 0.02 | the modeller's own rays on the deck plane (single view) |
| Touchscreen width | 0.33 (by proportion) | kept at 0.33, conflict recorded | a free fit of the housing rectangle prefers 0.36–0.39; width and turn of the screen cannot be separated in these photos |
| Pod plate height, left and right | 0.510 and 0.527 | 0.519 for both | mean, so that the pods are mirror images; the 17 mm difference is kept visible in the record |

The same rule applies to these as to the table: a size mismatch goes back to a measurement, never
to a nudge by eye, and a conflict between two readings is written down, not averaged away.

## Where the photos overruled the owner's figures

Recorded here because they are outcomes of the method, not errors in it (a tape must settle them):
the deck is 1.41 m front to back, not 1.5; the top of the seat back is 1.28 ± 0.03 m above the deck
on two rigs, not 1.4 (above the room floor it is 1.48); 1.2 m fits headrest to screen (1.14–1.21),
not eye to screen centre (0.97–1.05). The owner's figures are kept as parameter records of class
`measured` that no geometry reads.

## When to distrust a result

- The target is near the frame edge or was taken with the ultra-wide camera.
- The ray meets its plane at a grazing angle.
- The length runs along the viewing direction.
- A two-photo result with a small baseline (the two rear photos count as one viewpoint).
- The solve is exactly determined (as many equations as unknowns).
- The result changes by more than its range when a few points are added.
