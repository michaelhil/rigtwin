# Measuring from photos and filling gaps

The procedure as it worked on the first asset (casual phone photos, three of the reference
instance, no tape values). Run by the `asset-measurer` agent before any modeling. Its outputs
supersede every earlier guess.

## Contents

- Status
- 1. Sort the evidence
- 2. One camera set, tied to named gauge features
- 3. Scale and closure
- 4. Measure by class
- 5. Ranges
- 6. What the photos cannot check
- 7. Look at an overlay
- 8. Filling gaps: the source hierarchy
- 9. When a person's figure and the photos disagree
- 10. Outputs
- 11. Capture protocol (when better input can be requested)
- 12. One-page measurement request

## Status

Exercised once: steps 1–10, by one measuring agent, on one object. Not exercised: hold-out
points clicked by a person; machine-written records that stop a `photo` value being edited by
hand; a frozen dimension table scored against tape values. Until tape values exist, every size
verdict is "unverified", however small the residuals.

## 1. Sort the evidence

- Work on copies under `private/`; originals are read-only. Pick points on full-resolution
  originals, not on reduced copies.
- For each photo note: which instance of the object it shows; which parts may have moved since
  another photo (anything on an arm, slide or hinge); lens and focal length from the metadata.
- Count distinct viewpoints, not photos. Two photos taken a short step apart from far away are
  one viewpoint: they cannot triangulate depth along their shared line of sight.
- Other instances of the same product are evidence for shape and for unseen sides, never for
  this instance's adjustable positions.

## 2. One camera set, tied to named gauge features

A camera set has no position, orientation or scale of its own. Tie it to the model frame with a
small set of **gauge features** on fixed structure:

| Gauge | Fixes | Typical feature |
|---|---|---|
| A plane | up direction, one height | the flat top of the base the object stands on |
| A rectangle or two directions on it | origin, forward and sideways | traced straight edges of that base |
| One length | scale | one known size on that base |

- List the gauge features by name in the report. They have zero residual by construction:
  **never count them as verification** and never score the model against them.
- Trace long edges with a sub-pixel edge follower (hundreds of points per edge) instead of
  clicking corners; locate small marks by centroid; check every pick on a zoomed tile.
- Solve all cameras of one instance together in the model frame (bundle adjustment with a
  robust loss), using background matches, picked ties and the edge constraints. Start the focal
  length from the photo metadata.
- Test stability: solve again with focal length fixed and free, with one photo's constraints
  removed, without the background matches. Report how far camera centres and key ratios move.
- A solve with exactly as many constraints as unknowns has no residual to inspect. Check it on
  features that were not used. One such solve looked fine and had the camera height wrong; only
  two unused vertical edges in the room showed it.
- Line-only data can admit a mirror-image solution. Reject solutions that put traced points
  outside the object.
- Never solve a camera on a movable part, and never against the model part you are about to judge.
- If a photo shows too little fixed structure, leave it unsolved and say so.

## 3. Scale and closure

1. Set scale from one length (a figure from the person, or a purchased part of known size).
2. In that frame, measure every other part whose true size is known. Build the closure table:
   part, measured, published, ratio, how it was measured, comment.
3. Ratios within about 3 % of 1: the scale closes. Use the cleanest tests (two-view corners) as
   the judge and mark model fits and one-ray results as weak.
4. A disagreement is investigated, never averaged:
   - Was the published size ever tied to the element actually measured?
   - Does the element lie on the plane the one-ray measurement assumed? (A 7 % conflict on the
     first asset failed both questions; the reference was dropped, not averaged in.)
   - One part off by a large, consistent ratio with good residuals, while everything else
     closes, is a wrong identification (another size variant of the product), not a scale error.
5. If a stated length could refer to two edges (inner or outer), state which was adopted, the
   confidence and the consequence if wrong.
6. If the scale still does not close, everything scaled from it carries the mismatch as its
   range, and the coordinator asks the person for one confirmed number.

## 4. Measure by class

| Class | How | May claim |
|---|---|---|
| Two-view point | triangulated between photos whose sight lines differ by 25° or more; accepted only if the two sight lines meet within a few pixels (a test that does not involve the model) | a range; on the first asset such measurements of known sizes came out within 0–2 %, not yet confirmed by tape |
| Two-view line | an edge traced in both photos, intersected as two planes | as above; good for long edges without corners |
| One ray on a measured plane | a sight line cut with a plane measured two-view | a range; state the plane |
| One ray on an assumed plane | a sight line cut with a symmetry plane or a guessed side plane | a range that includes the plane error; state the sensitivity ("7 mm per 50 mm off-plane") |
| Model fit | a parametric shape of known proportions fitted to its outline | weak when the free-size fit is barely better than the published size |
| By eye | a proportion judged in a photo | no coverage |
| None | no route exists | nothing: record the gap as a gap |

Wrong correspondences happen with rows of look-alike features. A pick whose sight lines miss by
many pixels is dropped and listed, not forced.

## 5. Ranges

- "± x" means: expected to contain the true value about nine times in ten. By-eye and invented
  values make no such claim; give them at least ±15 % or a stated floor if a range is needed.
- A method's own error bar understates the truth. If several derivations exist, the range must
  cover every one that has not been shown wrong.
- An untested explanation for an outlier is not a resolution. Re-derive by a route that shares
  neither the scale reference nor the assumed plane.
- Round to what the method supports (5–10 mm for photo values, coarser for assumptions).

## 6. What the photos cannot check

For each key feature and photo, compute how many pixels a 50 mm error would move it along each
model axis, and along that photo's line of sight. Along the line of sight the answer is close to
zero. Then list, by part: "position along direction d cannot be verified from these photos".

Parts seen only from one viewpoint are in that list for depth. **A matched overlay will look
right for them even when they are several centimetres off.** For those parts the modellers
trust the dimension table and profiles from another instance, not the overlay, and the
coordinator says so in a ruling.

## 7. Look at an overlay

Project a metric grid and the measured points back onto each photo and look at the image. A
wrong plane, a swapped axis or a mirrored solution is obvious to the eye and invisible in the
residuals. This is a check of the measuring, not of the model.

## 8. Filling gaps: the source hierarchy

Use the highest-ranked source that applies and record which.

| Rank | Source | Use when | Class | Basis |
|---|---|---|---|---|
| 1 | Measurement of this object | it exists | `measured` | `user`: who, when, with what |
| 2 | Vendor drawing of a purchased part | the model is identified; if two candidates remain, carry both and let the range cover them | `vendor` | source, model, confidence |
| 3 | Calculation from photos | section 4 gives a route | `photo` | the method, first in the evidence text |
| 4 | Judged by eye in a photo | no calculation route | `assumed` | `by_eye` |
| 5 | Same component on another instance | same product, no visible contradiction | `assumed` | `cross_instance` |
| 6 | Mirror symmetry | no handed feature there | `assumed` | `symmetry` |
| 7 | Mechanical or manufacturing convention | the feature is clearly of a standard kind | `assumed` | `convention` |
| 8 | A standard or typical product value | a designer would plausibly have used it | `assumed` | `standard_default` |
| 9 | Plain guess, or a modeling device | nothing above applies | `invented` | none |

- Value = the centre of what the basis allows; range = its spread (for cross-instance: the
  difference seen between instances plus the measuring range).
- A value filled from a standard cannot later be assessed against that standard: the result
  would be compliant by construction. Say so in its evidence.
- Unseen faces get simple shapes of class `invented`; the model card lists them.

## 9. When a person's figure and the photos disagree

On the first asset all three figures given from memory disagreed with the photos once the scale
had closed. What worked:

1. Record both. The stated figure stays in the parameters as its own record (class `measured`,
   basis `user`), with a note that it is not modeled.
2. Model the better-supported value. Support means: independent routes agree, another instance
   agrees, the closure passes. Never move a photo value toward the stated figure.
3. Look for the reading under which the figure fits (measured from the floor instead of the
   base? to a different point? with a movable part elsewhere?). Report candidates; do not pick
   one silently.
4. Write untestable explanations as such.
5. Put the item at the top of the tape request with the question "from where to where?".
6. Tell the person plainly that a decision is needed, and what depends on it. The reviewer will
   list it as a decision, not as a modeling fault.

A stated figure that closes against purchased parts is used, as scale, and is then gauge.

## 10. Outputs

| File | Content |
|---|---|
| `private/evidence/cameras.json` | per photo: image size, focal lengths, principal point, rotation, translation, the frame they refer to; read by the viewer for matched views; never deployed |
| `work/measure/dimension-table.toml` | one record per dimension in parameter-record form, including class `none` for real gaps |
| `work/measure/shape-points.toml` | named 3D points for shape support, each with class, range and a note on its weak direction |
| `work/measure/crops/` + captions | best crop per component and viewpoint, with what it shows; contains photo pixels |
| `work/measure/REPORT.md` | headline results; method; gauge features; residuals; closure table and how each disagreement was handled; stated figures; completeness by class; what cannot be checked; notes for modellers; ranked tape request; failed or abandoned steps |

## 11. Capture protocol (when better input can be requested)

1. Ten to fifteen tape measurements, each photographed with the tape in frame. This beats every
   algorithm.
2. Scale in the scene: a folding rule along each axis and one standing upright, or several
   printed markers of known size taped flat.
3. One instance; nothing moved during the session; main lens only.
4. Rings of overlapping photos at knee, chest and overhead height, stepping sideways, with the
   surroundings in frame.
5. Square-on views from the front, rear, left and right from as far back as possible; one from
   above; one from the user's eye position; one from the floor looking under.
6. Each movable part at both extremes, photographed from the same spot.
7. Close-ups of every control group with a ruler in frame, and of every model label.
8. Screens off or showing a static pattern; no people; diffuse light.
9. Note which instance each photo shows; strip location data before sharing.

## 12. One-page measurement request

Send this when a visit is possible; fill the bracketed parts from the report's ranked list.

```
Measurement request for [asset], [date]. About 30 minutes with a tape and a phone.
Please photograph each reading with the tape in frame.

A. Labels and facts
 1. Maker and model label of every purchased part: [list].
 2. What adjusts, yes or no, and how far: [list of assumed joints].
 3. For each figure given earlier ([list]): from which point to which point was it taken?

B. Tape, most valuable first
 4. [the scale reference: both sides, inner and outer]
 5. [each conflicting figure, with the two candidate readings]
 6. [critical-tier values of class assumed or invented]
 7. [values the photos cannot check, by direction]
 8. [one or two purchased-part sizes, to confirm identification]

C. If possible
 9. A square-on side photo and a photo from [the missing viewpoint].
10. Each adjustable part at both ends of its travel.
```
