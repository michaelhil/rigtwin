---
title: Filling gaps (augmentation)
tldr: How values that the photos do not give are filled in, how each value says where it came from, what the build enforces so invented values cannot pass as measured, and how a real measurement overrides an estimate.
status: living
updated: 2026-11-23
tags: [method, parameters, uncertainty, provenance]
---

# Filling gaps (augmentation)

## TL;DR

- Most of the model is not measured. As of round 2, of 303 parameter records, 3 are the owner's figures, 22 come from makers' data, 80 from photo measurement, **177 are assumed and 21 invented**.
- Every number is a record with a **class** (how it is known), a **basis** (for assumptions: which kind), a **range**, a **tier** (how much it matters) and an **evidence** sentence. The build refuses an incomplete record.
- A component's class is the least certain class among the non-cosmetic values it reads. The viewer colours parts by it ("How sure are we?").
- A real measurement goes into `measured.toml`, which is read last and replaces the estimate without any code change (*tested*).
- Several rules of the approved plan are conventions today, not build failures. They are marked "not enforced" below.

Terms: class, basis, tier, datum, joint are in the [glossary](../00-overview/glossary.md). The
record format is specified in the [asset contract](asset-contract.md).

## Source hierarchy

Use the highest-ranked source that applies, and record which one.

| Rank | Source | May be used when | `class` | `basis` |
|---|---|---|---|---|
| 1 | Real measurement of this object | it exists | `measured` | `user` (who, when, how, in the evidence text) |
| 2 | Maker's drawing or data sheet of a purchased part | the model is identified; otherwise carry the candidates and let the range cover them | `vendor` | — |
| 3 | Photo measurement by calculation | cameras are solved and the route is stated (two views, or one view plus a named assumption) | `photo` | — |
| 4 | Judged by eye in a photo | no calculation route exists | `assumed` | `by_eye` |
| 5 | The same component on another rig instance | same product, no visible contradiction | `assumed` | `cross_instance` |
| 6 | Left/right mirror symmetry | no handed feature at that place | `assumed` | `symmetry` |
| 7 | Mechanical or manufacturing convention | the feature is clearly of a standard kind | `assumed` | `convention` |
| 8 | Ergonomic standard or typical product value | only where a designer would plausibly have used it | `assumed` | `standard_default` |
| 9 | Plain guess, or a modelling device, for completeness | nothing above applies | `invented` | — |

Classes are ordered `measured > vendor > photo > assumed > invented`. "Invented" covers two things
in practice: guesses about parts no photo shows (the seat mechanism under the cushion) and numbers
that only steer the mesh (segment counts of a shape list, bevel widths).

A value identified from a maker's data can still be wrong if the part was misidentified. That
happened: the touchscreen was first entered as a 15.6-inch model; two-view measurement gave 0.84 of
its height; the group file now overrides the device record with the 13.3-inch size, outer width by
proportion and marked `assumed` (see [Measuring from photos](measuring-from-photos.md)).

## How an assumed value and its range are chosen

| Basis | Value | Range |
|---|---|---|
| `cross_instance` | the value measured on the other rig | the difference seen between rigs plus the measuring range (here usually ±0.03–0.05 m) |
| `symmetry` | the mirrored value | the range of the visible side |
| `convention` | what the convention gives (a 16:9 panel: active width = active height × 16/9) | the spread of the convention |
| `standard_default` | the centre of the product class or of the standard's range | the span of the class; often left without a range because no coverage is claimed |
| `by_eye` | the proportion judged in the photo | none claimed. The plan's guide: think of at least ±15 % or ±60 mm, whichever is larger |

A range written "± x" claims to contain the truth about nine times in ten. A record without a range
makes no claim. As of round 2, 126 of 303 records carry a range: 73 of 80 photo values, 16 of 22
vendor values, 35 of 177 assumed values, none of the invented ones.

## The tier: how much a value matters

| Tier | Meaning | Examples |
|---|---|---|
| `critical` | changes reach, posture or vision results by itself | deck width, plate height, joystick position, shelf height, seat back top, grip reference point |
| `layout` | changes clearances, fit, or how recognisable the rig is | column spacing, adjustment ranges, pad size |
| `cosmetic` | appearance only | bevels, radii, button sizes, shape lists of shells |

The tier decides what counts toward a component's class: cosmetic values are ignored unless the
component reads nothing else. So a joystick base built from the maker's flange size, with assumed
bevels, is classed `vendor`, not `assumed`.

## What keeps invented values from looking measured

| Rule | How it is enforced | Status |
|---|---|---|
| Every record has `value`, `unit`, `class`, `tier`, `evidence` | the loader stops the build and lists every bad record (check C-03) | **enforced**, *tested* |
| `class` and `tier` come from fixed lists; `range` is a non-negative number | loader error | **enforced** |
| An `assumed` record without a `basis`, an unknown `basis`, an unknown field | loader warning, shown by `check` | warned |
| Numbers live in parameter files, not in component code | `check` lists decimal literals and integers of three or more digits in `assets/*/src` (C-16) | advisory (a warning, not a failure); currently none found |
| A misspelt parameter key cannot silently read nothing | unknown key stops the build and suggests the closest names | **enforced**, *tested* |
| Each component knows which values it rests on | every read is recorded; the manifest lists per component the keys, the count per class, and the weakest non-cosmetic class | **enforced** by construction |
| A parameter nobody reads is visible | build note and `check` warning "read by nothing" | warned (11 as of round 2: maker's figures kept for reference and two of the owner's figures) |
| Uncertain parts can be seen | viewer mode `mode=class` ("How sure are we?") colours each part by class, with a count per class | available |
| A motion that was never seen cannot pass as known | joints carry `evidence` (seen, inferred, assumed) and `locked`; scripts cannot move a locked joint without `force`; the viewer tags it "assumed range" and shows a notice on the picture and in saved pictures | **enforced** in the viewer (acceptance checks T31–T37); the six assumed joints are all locked, but the spec loader does not yet force that pairing |
| A `photo` value is backed by a machine-written measurement record; changing it without a new record fails the build | — | **not enforced.** Evidence is free text |
| Rounding by class (photo to 5 or 10 mm, assumptions to 10 or 50 mm) | — | **not enforced.** Converted pod-frame coordinates such as 0.0274 appear in photo records |
| Surfaces no photo shows are flagged "unseen" | — | **not implemented** |
| Critical values of class `assumed` or `invented` are printed as "unverified critical values" | can be derived from the manifest (two as of round 2: `seat.backrest_surface_x_at_cushion`, `pods.grip_palm`) | not automated |

## The "not assessable" rule

A value filled from a standard cannot later be assessed against that standard. If the seat's slide
range was entered as "typical for an operator seat", a later compliance check of that range would
pass by construction and mean nothing. Therefore:

- such values carry `basis = "standard_default"`;
- any assessment that touches one must return **"not assessable"**, not a pass;
- any result that depends on a critical value of class `assumed` or `invented` must report
  "undetermined", not a number.

Status: the tag exists and is in the manifest. **No assessment code exists yet, so nothing enforces
the rule.** It is a requirement on the next phase. The 18 tagged records as of round 2:

| Group | Records with `standard_default` |
|---|---|
| Seat | recline minimum and maximum, swivel range, height range, slide range, tilt range; sitting eye heights (small, median, large) and eye-forward offset |
| Pods | joystick pivot height above the plate; touchscreen arm ball radius and ball range |
| Stand | monitor tilt range, monitor pan range |
| Pedals | tray travel, pedal travel |
| Layout | eye height (not read by any geometry) |

So every seat adjustment range, every monitor adjustment range except its height travel, and all
three eye points are "not assessable" until someone measures or asks the maker.

## Overriding with a real measurement

1. Create `assets/rig-b/params/measured.toml` (it does not exist yet).
2. Add a complete record under the **same key** as the estimate:

```toml
[stand.shelf_top_z_near_edge]
value = 778
unit = "mm"
range = 2
class = "measured"
basis = "user"
tier = "critical"
evidence = "Tape, <who>, <date>: shelf top at the operator-side edge above the deck."
```

3. Run `bun run build`. No code changes.

What happens (*tested* on a scratch copy of the parameter folder): files are read in the order
`devices.toml`, the group files, `measured.toml`; the later record replaces the earlier one; units
are converted (778 mm becomes 0.778 m); the manifest record gains `"source": "measured.toml"` and
`"replaces": "stand.toml"`; the class count moves (measured 3 → 4, photo 80 → 79); everything that
depends on the key through the spec's expressions or the component functions moves with it. An
incomplete record in `measured.toml` stops the build like any other.

The estimate stays in its group file, so the method's track record is not lost. *Not implemented:*
the plan's before-and-after report (which values changed, by how much, whether the new value fell
inside the old range, and which other values shared its scale reference). Today that comparison is
done by hand from the two files.

The same mechanism is how a group file overrides a device record: as of round 2 five touchscreen
values in `pods.toml` replace those of `devices.toml`, and the manifest says so.

## Class counts of the current model

<!-- UPDATE after the final modelling round: all numbers in this section come from the build output -->
**As of round 2** (build `c32727406a5c…`, 303 records; from `bun run build` and the manifest):

| Class | Records | critical | layout | cosmetic | With a range |
|---|---|---|---|---|---|
| measured | 3 | 3 | 0 | 0 | 2 |
| vendor | 22 | 6 | 12 | 4 | 16 |
| photo | 80 | 22 | 34 | 24 | 73 |
| assumed | 177 | 2 | 50 | 125 | 35 |
| invented | 21 | 0 | 0 | 21 | 0 |
| **Total** | **303** | 33 | 96 | 174 | 126 |

Assumed records by basis: by eye 117, another rig 41, standard or typical value 18, convention 1,
symmetry 0 as a declared basis (the left pod is a mirror of the right in code, and positions were
averaged between sides; no record names symmetry as its basis).

Records by file: `devices.toml` 39, `platform.toml` 20, `seat.toml` 88, `pods.toml` 104,
`stand.toml` 30, `pedals.toml` 22.

Components (54 nodes with a class: the 52 component nodes below the root and the 2 screen surfaces)
by weakest non-cosmetic class: **32 assumed, 20 photo, 2 vendor, 0 measured**; the root has no class.
No component is classed `measured`, because every component also reads photo or assumed values.

Three things a reader should take from these numbers:

1. Only **one** measured value shapes the geometry: the deck width, which is also the scale of
   everything else. The owner's other two figures (seat height 1.40 m, head to display 1.20 m) are
   recorded but not used, because the photos contradict the way they were first read.
2. 146 of the 198 assumed and invented records are cosmetic. The claim "credible layout" rests on
   the 33 critical and 96 layout records, of which 52 are assumed.
3. The whole seat is classed `assumed`: its front-to-back position cannot be checked from the
   photos, and its mechanism is not visible.

## Procedure for a new gap

1. Name the quantity as a tape would measure it, and decide its tier.
2. Walk down the source hierarchy and stop at the first source that applies.
3. Write the record: value, unit, class, basis, range (or none), tier, and an evidence sentence that
   names the photos, the route and any conflict. Write conflicts in capitals so they can be found.
4. If two sources disagree, do not average. Keep the higher-ranked one, record the other in the
   evidence text or as its own unused record.
5. Build, then look at the part in `mode=class` and in a matched view.
6. Add the quantity to the list of tape measurements that would help most, if its tier is critical.
