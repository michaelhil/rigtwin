# Decomposing an object into components, joints and frames

How to get from photos to the spec: the tree, what is attached to what, what moves, and where
the reference frames go. Record formats are in `asset-contract.md`. Examples use neutral objects
(a desk lamp, a tool cabinet).

## Contents

- Status
- One tree plus tags
- Procedure
- When something gets its own node, and when to stop
- Order: a hypothesis, tested by the blockout
- Establishing connections from photos
- Mount frames and joint records
- Pivots on physical axes
- The expected-motion table
- Left/right completeness
- Reference frames
- What is universal and what belongs in a playbook

## Status

Exercised once: the first asset's tree was written by a research agent before the build and
then used and revised during it. The first independent review found nothing missing, extra or
wrongly split, apart from two cases that only showed when joints moved (see "Order"). This
guidance therefore describes a decomposition that held up, not one produced by an agent
following this file. Not exercised: a checkpoint where the person reviews the tree; a second
asset type.

## One tree plus tags

- **The tree is structural.** A part's parent is whatever carries it and moves it. Exactly one
  parent per node.
- **Function is tags and frames, not a second tree.** What the user sees, touches or rests on
  is recorded as tags on nodes plus `D_` frames and `S_` surfaces under the node they belong to.
- If a functional grouping cuts across the structure (a display carried by a side arm), the
  structure decides the parent and the tags carry the function.
- A node may carry several roles. Tags used so far: `structure`, `adjustable`, `control`,
  `display`, `body_contact`, `safety`, and the body part a control serves (`hand`, `foot`).
  Extend the list per asset type; keep it small enough to query.
- **Groups** (three to six per asset) cut the tree into units a user shows or hides together
  and one modeller can own.

## Procedure

1. State the purpose and the consumers (from intake). They decide which interfaces must exist.
2. Inventory every visible thing per photo: what it is, which photos, which instance.
3. Group into bodies. A body would stay in one piece if unbolted. Evidence: seams, material
   breaks, fastener rows, shadow gaps, the same relative pose across photos and instances.
4. Find the load path of every body: what touches it, what carries it. That gives the parent.
5. For every parent–child link ask: can it move, who moves it, when?
6. Apply the node criteria and the stopping rule below.
7. Add interfaces: mount frames, reference frames, functional surfaces.
8. Tag every node; assign groups.
9. List parameters per node with class and evidence.
10. Record what was not seen: unseen sides, unverified joints, guessed ranges.
11. Build the whole-object blockout and revise the tree from what it shows.

## When something gets its own node, and when to stop

A thing becomes a node if at least one holds:

| # | Criterion | Example |
|---|---|---|
| N1 | It moves relative to its carrier | a lamp's arm |
| N2 | Its position is adjustable at installation or by the user | a clamp that slides along a rail |
| N3 | It is replaceable by a variant | one of two head sizes |
| N4 | It is a purchased item with published dimensions | the bulb unit |
| N5 | It is an interface for a person: a display, a control, a surface the body touches | a switch, a handle |
| N6 | It needs its own material, visibility or collision handling | a glowing panel |
| N7 | It is a reference frame or mount frame | the beam origin |

**Stop** when none applies. Fasteners, seams, stitching and styling stay in the parent mesh. A
purchased item is one node unless a part of it moves in a way the purpose needs. Small controls
that a simulator must light or press are nodes; buttons on a handle are tagged points until a
consumer needs them to move. Test: *"Can I name one assessment, one simulator behaviour or one
variant that needs this node?"* If not, merge it.

## Order: a hypothesis, tested by the blockout

Decomposition comes first, as a hypothesis from the photos. The whole-object blockout tests it,
and node IDs settle after that; values never freeze. Signs the tree is wrong:

- a joint cannot move without tearing a mesh or leaving a hole (a node is missing, or a
  flexible part must be split so that part of it moves with the lever);
- a child leaves its carrier when a joint moves (a multi-link mechanism was built as one rigid
  mesh);
- a moving part passes through a fixed neighbour inside its stated range;
- one parameter change forces edits in two nodes (an interface is missing);
- two photos disagree about a relative pose the tree calls rigid (a joint is missing);
- a node meets none of N1–N7 (merge it).

The first three were all found by the independent reviewer on the first asset, by moving every
joint to its limits. Do that yourself before review.

After downstream users bind to IDs, changing topology or IDs needs a recorded decision.

## Establishing connections from photos

Evidence, strongest first:

| # | Evidence | Look for | Strength |
|---|---|---|---|
| E1 | Fastener at a contact | screws, bolts, clamps where two bodies touch | strong |
| E2 | Continuous load path | a bracket, arm or post traceable from child to parent | strong |
| E3 | Floating test | the body reaches no other support, so what it touches carries it | strong for "who", weak for "where" |
| E4 | Co-variation | two bodies keep the same relative pose in every photo and instance while a third differs | medium to strong |
| E5 | Seams, gaps, material breaks | a step, dark gap or change of finish | medium |
| E6 | Mechanism class | a round hub cover means a pivot; a flexible boot means a gimballed lever; a ball in a split socket means a ball joint | medium for type, weak for range |
| E7 | Absence | no rail, lever or knob visible | weak; never proves rigidity |

Level recorded on the joint: **seen** (E1 or E2, or the part in two poses), **inferred** (E3 or
E4, or E5 with E6), **assumed** (E6 alone, or nothing). For each uncertain connection write
**the observation that would prove it wrong**; the list doubles as a shot list for a site visit.

## Mount frames and joint records

A connection is three things: the parent–child link; a mount frame (position and orientation on
the parent, given by parameters), on which the child's own origin sits; and a joint record
(type, axis, limits, neutral, kind, evidence, locked, signal).

Consequences worth keeping: moving a part changes one mount parameter and no geometry; a rigid
connection can still be shifted by a later measurement; swapping a purchased part for another
model is a change of device record.

## Pivots on physical axes

The origin of a moving node lies on its real axis of motion, never at a bounding-box centre.
Locate it, in order of preference, from:

1. a visible axle, pin or hub cover (the axis runs through the centres of the two covers);
2. the same part seen in two poses (for a rotation, the perpendicular bisectors of two points'
   displacements meet at the pivot; for a slide, the displacement is the axis);
3. the geometry of the mechanism class (a gimbal centre lies on the lever axis inside its base);
4. a vendor drawing;
5. symmetry or tangency (a cylinder's axis; a visible rail).

A pivot from method 3 is class `assumed`, basis `convention`, with a range. Say what depends on
it: travel at a handle equals lever length times angle, so pivot depth changes both reach and
how the lever looks when deflected.

## The expected-motion table

For every joint, list the nodes that move with it; everything else must stay still. Write it at
decomposition time in words a person can read and correct ("when the arm swivels: arm, head and
beam frame move; base and clamp do not"), then as the spec's `[motion]` table. The check poses
every joint and compares. It proves the built tree matches the table. It does not prove the
real object moves that way, and it does not detect collisions or torn meshes.

## Left/right completeness

- Every sided node has a counterpart unless the spec lists it as single-sided; pairs that are
  deliberately not mirror images are listed too. Handed differences (a control present on one
  side only) are real and must be looked for in the photos, not mirrored away.
- A brief that names one side must name the other, or cite the spec instead of listing parts.
- An unseen side is filled by symmetry or from another instance, with that basis recorded.
- The coverage and left/right checks exist because a whole side was once left out of a trial
  build and the figures gave no hint.

## Reference frames

- Built by expressions over parameters; never placed by eye; children of the body they are
  fixed to. The label states the definition.
- Give a frame to: the origin; the floor; every point an assessment will measure from or to
  (where a person sits or stands, where the eyes are, where a hand or foot acts); every display
  or signal surface (centre, normal, size, curvature); every control's contact point.
- Frames on moving parts move with them. Where a carrier adjusts, keep a fixed and a live frame.
- A frame that imitates a standard's reference point without that standard's procedure is
  labelled "estimated".
- Derive human-related points (eye, hand) from a stated body size and offer small, median and
  large versions, not a single point.
- The concrete frame sets per asset type are in the playbooks.

## What is universal and what belongs in a playbook

| Universal (here) | Asset-type (a playbook) |
|---|---|
| procedure, node criteria, stopping rule | usual components, groups and tags |
| one tree plus tags | which reference frames are mandatory |
| evidence types, levels, falsifying observation | mechanism priors and typical ranges, with sources |
| mount frames, pivot rule, joint record | which joints are commonly only assumed |
| expected-motion table, left/right table | which later assessments need which frame |
| three kinds of variable | typical pitfalls |

Known strains, from a paper test against other asset types (not built): several user positions
sharing one interface; identical modules repeated; a part that moves passively; a reference that
is a region; closed mechanical loops; enclosures whose openings matter for vision; an asset that
is a sub-assembly of a larger one. See "Known gaps" in `asset-contract.md`.
