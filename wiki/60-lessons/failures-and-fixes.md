---
title: Failures and fixes
tldr: Every failure of the project as a numbered incident (F-01 to F-32), each with what happened, who found it, the cause, the fix, the guard that now prevents it and its status. Starts with the missing left joystick.
status: living
updated: 2026-11-23
tags: [lessons, failures, checks, review, planning, viewer]
---

# Failures and fixes

## TL;DR

- 32 entries: 12 from planning (two of them from the trial builds), 5 from measuring and building, 6 from the model reviews, 3 from the viewer, 4 from project hygiene and record keeping, 1 from running many agents at once (the usage-limit interruption), and 1 from the first automatic deployment.
- The owner found 4 of them by looking (F-01, F-23, F-24, F-25). Fresh reviewing agents found 14. Scripted checks found 5. The builders, the coordinator and the documentation writers found the rest.
- Almost every failure has the same shape: **something was left unstated or unchecked, and the result still looked finished.** A model without its left side, a "verified" accuracy figure, a slider that did nothing.
- Every fix is paired with a guard: a check that runs on every build, a rule in the briefs, or a reviewer step. Guards that were planned and **not** exercised in this run are named as open (F-09).
- For the short version of what to do differently, read [lessons-learned.md](lessons-learned.md). Reusable procedures are in [patterns.md](patterns.md).

## How to read an entry

| Field | Meaning |
|---|---|
| Found by | owner, reviewer (an independent agent), check (a script), modeller or other builder, coordinator |
| Guard | What now stops a repeat. "Rule" = written in the brief or the Skill; "check" = runs in `bun run check` |
| Status | **fixed** (corrected and guarded), **handled** (cannot be fixed with this evidence; recorded and bounded), **open** (not done) |

IDs are stable. Check names refer to the list printed by `bun run check` (see [../80-reference/tools.md](../80-reference/tools.md)).

## Overview

| ID | Failure | Found by | Phase | Status |
|---|---|---|---|---|
| F-01 | Whole left armrest pod and joystick missing from the trial models | owner | planning | fixed |
| F-02 | First plan draft built the toolkit before the asset and showed nothing early | reviewer | planning | fixed |
| F-03 | Accuracy overstated ("±4–10 cm, verified by three methods") | reviewer | planning | fixed |
| F-04 | Two scale references disagreed by 7 % | reviewer | planning | fixed |
| F-05 | A height conflict "resolved" by an untested correction | reviewer | planning | fixed |
| F-06 | A camera solved on a part that had moved | reviewer | planning | fixed |
| F-07 | Photo overlays cannot see errors along the line of sight | reviewer | planning | handled |
| F-08 | The plan said the photos stay "on this machine only" | reviewer | planning | fixed |
| F-09 | The planned process let the builder mark its own work | reviewer | planning | partly open |
| F-10 | "Credible" quietly narrowed; budget understated and unbounded | reviewer | planning | fixed |
| F-11 | A trial wrote invalid geometry with exit code 0; shape numbers leaked into code | builder | planning | fixed |
| F-12 | A trial's output differed from run to run | check | planning | fixed |
| F-13 | The owner's three scale figures conflict with the photos | builder | measuring | handled |
| F-14 | Purchased parts were wrongly identified or wrongly tied to a feature | builder | measuring | fixed |
| F-15 | A camera for another rig failed its own check; three photos could not be solved | check | measuring | handled |
| F-16 | The measurement table contained errors that the modellers found | modeller | modelling | fixed |
| F-17 | Parallel modellers broke each other's builds | check | modelling | fixed |
| F-18 | Round 1 rejected: toy-grade upholstery and pod legs | reviewer | review | fixed in round 2 |
| F-19 | Three moving parts failed when moved | reviewer | review | fixed in round 2 |
| F-20 | Overexposed rendering hid the form | reviewer | review | fixed |
| F-21 | The eye point sat at a tall man's height, behind the seat reference | reviewer | review | fixed in round 2 |
| F-22 | Triangles spent on small parts while body-contact surfaces were starved | reviewer | review | fixed in round 2 |
| F-23 | Viewer written in JavaScript in a TypeScript project | owner | viewer | fixed |
| F-24 | First viewer overcomplicated: 103 controls | owner | viewer | fixed |
| F-25 | Seat adjustments locked with no way to unlock | owner | viewer | fixed |
| F-26 | Planning files with client names copied into the project folder | coordinator | hygiene | fixed |
| F-27 | Viewing directions wrong in photo descriptions | reviewer, writer | hygiene | partly open |
| F-28 | Agents' self-reported durations were wrong | builder, writer | hygiene | handled |
| F-29 | Round-2 review: three small defects left | reviewer | review | fixed in round 3 |
| F-30 | Seven agents stopped by a usage limit | harness | process | recovered |
| F-31 | Banned-word check false positive on images | check | hygiene | fixed |
| F-32 | First automatic deploy refused: favicon 404 and a two-minute benchmark on the runner | check | deployment | fixed |

---

## Planning phase

<a id="f-01"></a>
### F-01 — A whole side of the rig was missing from the trial models

- **What happened.** Both early trial builds (see [modeling-rounds](../50-implementation/modeling-rounds.md#the-two-early-trials)) had a right armrest pod with joystick and no left one. The plan showed a picture of one trial captioned "trial blockout" and nothing said a side was missing.
- **Found by.** The owner, looking at the plan's illustration: "it is missing the joystick on the left side; investigate how and why this failure occurred".
- **Cause.** Three things together. (1) The coordinator's brief for the two trials listed only the right pod, to keep the trials small. (2) The figure caption did not list what had been left out. (3) Nothing compared the built model with a list of the rig's components, so an omission could not fail anything.
- **Fix.** The first complete blockout contains every component on both sides (48 meshes, 20 joints).
- **Guard.** Check `coverage`: every node of the component tree is in the model file or in an `omitted` list with a reason (today: 69 tree nodes and 20 joints present, 0 omitted). Check `left/right`: 15 pairs present and mirrored, 3 parts declared single-sided. The omitted list is printed at the foot of every contact sheet ("Omitted: none"). Rule: a brief that leaves something out must say so, and so must every caption.
- **Status.** Fixed. *Tested*: both checks run on every build.

<a id="f-02"></a>
### F-02 — The first plan draft built the toolkit before the asset

- **What happened.** Draft 1 was a toolkit-first plan: general tools and the Skill first, the rig later, the seat last, and nothing for the owner to look at until late.
- **Found by.** Two critics run before the adversarial review: an agent taking the owner's position ("written for builders, no objective accuracy test, seat scheduled last, nothing visible early") and an agent asking "could this be simpler" (it counted about 325 named things in the draft and judged about a quarter premature).
- **Cause.** The coordinator planned from the builder's point of view and generalised before one asset existed.
- **Fix.** Draft 2 was asset-first: build the rig, then extract the toolkit and write the Skill from what was actually used.
- **Guard.** Pattern [P-02](patterns.md#p-02): run a position-taking critic and a simplicity critic on any plan before the adversarial review. Lessons [L-43](lessons-learned.md#l-43), [L-44](lessons-learned.md#l-44).
- **Status.** Fixed in the plan.

<a id="f-03"></a>
### F-03 — Accuracy was overstated

- **What happened.** Draft 2 said the sizes were good to "±4–10 cm, verified on one rig by three methods" and that purchased parts were exact.
- **Found by.** The evidence-audit reviewer, who re-derived the numbers. The three derivations of one shelf height ran from about 660 to 800 mm; two of the three shared a scale reference, so they were not independent; the chosen ±45 mm did not even cover the third.
- **Cause.** Agreement between methods that share an input was counted as verification, and a range was chosen to look reasonable.
- **Fix.** Version 3 of the plan states "about ±10 % in plan and about ±8–12 cm in height, unchecked against any measurement".
- **Guard.** Rule: **no range may exclude a derivation that has not been shown wrong.** Rule: say how each statement is known (tested, measured, judgment, not verified). Lessons [L-01](lessons-learned.md#l-01), [L-09](lessons-learned.md#l-09).
- **Status.** Fixed. The sizes are still unchecked against a tape; see [critique](../70-results/critique.md).

<a id="f-04"></a>
### F-04 — Two scale references disagreed by 7 %

- **What happened.** The pedal unit and the soundbar, both purchased parts of known size, gave scales 7 % apart. Nobody had noticed.
- **Found by.** The technical reviewer, who joined one agent's picked points with another agent's solved cameras. No one had put the two results together before.
- **Cause.** The width quoted for the pedal unit had been tied to the wrong physical element in the photo (a heel rest that does not lie on the deck and whose height is unknown).
- **Fix.** The measurement closure during implementation took the platform width as the scale and tested it against the purchased parts: soundbar 0.411 m measured against 0.410 m from the maker (ratio 1.003), pedal spacing 0.140 against 0.14 (1.00), monitor 1.02. The heel-rest width is no longer used.
- **Guard.** Pattern [P-05](patterns.md#p-05): scale from one large feature, then a closure table against every part of known size, before any modelling. Details in [measurement-results](../50-implementation/measurement-results.md).
- **Status.** Fixed. *Measured.*

<a id="f-05"></a>
### F-05 — A conflict was "resolved" by an untested correction

- **What happened.** Heights from one method came out lower than from another. The draft applied a flat −115 mm to every height from that method, on a hypothesis about the cause, and called the conflict resolved.
- **Found by.** The technical and evidence-audit reviewers.
- **Cause.** An explanation was treated as a result.
- **Fix.** The correction was removed; the range was widened to cover both derivations until the closure step could test them.
- **Guard.** Rule: an untested explanation is not a resolution; widen the range and name the test. Lesson [L-10](lessons-learned.md#l-10).
- **Status.** Fixed.

<a id="f-06"></a>
### F-06 — A camera was solved on a part that had moved

- **What happened.** One trial solved a photo's camera from the corners of the monitor, then quoted the fit as "1.8 px". The monitor is on an arm and had been moved between photos, and the wrong curvature had been assumed for it.
- **Found by.** The technical reviewer.
- **Cause.** A camera fitted to the very part being judged fits by construction; the small residual proves nothing.
- **Fix.** Cameras are solved on the platform deck (traced edges, deck screws), which does not move.
- **Guard.** Pattern [P-06](patterns.md#p-06): named, static gauge features; their residuals are never counted as verification. Check `projection self-test` (45 known points over 7 cameras, worst 0.216 px) verifies only that the viewer's camera maths equals the numeric projection, and says so.
- **Status.** Fixed.

<a id="f-07"></a>
### F-07 — Photo overlays cannot see errors along the line of sight

- **What happened.** The plan relied on laying the model over the photos to verify placement. For a point 2.2 m from the camera, a 50 mm sideways error moves it about 35 px; a 50 mm error along the viewing direction moves it 0–2 px. Two of the three photos of the reference rig are taken from nearly the same place.
- **Found by.** The technical reviewer; quantified per feature by the measurement agent ([table](../50-implementation/measurement-results.md#what-cannot-be-checked-from-the-photos)).
- **Cause.** A property of the evidence, not a mistake. The mistake would be to read a good overlay as proof.
- **Fix.** None possible from these photos. Each dimension is recorded as checkable or not; the modellers were told to trust the dimension table and side-view points from another rig for depth, not the overlay.
- **Guard.** The detectability table ([P-07](patterns.md#p-07)); the model card's list of what the model is not qualified for; the tape list.
- **Status.** Handled. The seat's front-to-back position remains unverifiable until someone measures it.

<a id="f-08"></a>
### F-08 — The plan said the photos stay "on this machine only"

- **What happened.** Draft 2 stated the photographs would stay on the owner's machine. Every photo an AI agent looks at is transmitted to the AI provider for processing; by then that had happened for all 16 photos in the folder.
- **Found by.** The human-factors reviewer and the compliance reviewer.
- **Cause.** "Not committed, not uploaded by us" was confused with "not transmitted".
- **Fix.** The plan was corrected and the owner was asked directly. Answer: "confidentiality is no concern". Masked copies (people and names blurred, metadata removed) are still used for everything published, because the deployed wiki is public.
- **Guard.** Rule: state data flows literally. Pattern [P-17](patterns.md#p-17), masked evidence copies.
- **Status.** Fixed.

<a id="f-09"></a>
### F-09 — The planned process let the builder mark its own work

- **What happened.** In draft 2 the building agent wrote its own checks, chose their tolerances and briefed its own critic.
- **Found by.** The process reviewer.
- **Cause.** One agent held all three roles: builder, test author and judge.
- **Fix in the plan.** Version 3 added an acceptance specification written by a separate agent and locked before modelling, landmark points held out and clicked by the owner, and a test of the reviewer with planted errors of known size.
- **What actually ran.** The owner directed a fully autonomous implementation. Independence came from: a fresh reviewer per round that never sees the builders' notes and makes its own renders and measurements; scripted checks; an independent reader of the model file written in another language. **Not exercised:** the separate acceptance author, the owner's hold-out clicks, and the planted-error test of the reviewer.
- **Guard.** Patterns [P-03](patterns.md#p-03), [P-14](patterns.md#p-14), [P-15](patterns.md#p-15).
- **Status.** Partly open. See [next steps](../90-next/next-steps.md) and idea [I-01](ideas.md#i-01).

<a id="f-10"></a>
### F-10 — "Credible" was quietly narrowed, and the budget was unbounded

- **What happened.** Draft 2 had redefined the owner's "credible 3D model" as "layout-credible", so that a rig that did not look like the rig could still be reported as a success. Its time estimate was low and had no ceiling.
- **Found by.** The compliance and pre-mortem reviewer; the budget also by the process and evidence reviewers.
- **Cause.** The goal was bent toward what looked achievable.
- **Fix.** Version 3 names two separate limits (sizes, looks), reports a verdict per aspect, removes the fallback wording, and sets a ceiling with a stop-and-report rule.
- **Guard.** The goal assessment goes through the owner's requirements in the owner's words ([goal-assessment](../70-results/goal-assessment.md)); looks are judged by a reviewer briefed to reject a toy.
- **Status.** Fixed.

<a id="f-11"></a>
### F-11 — A trial wrote invalid geometry silently, and shape numbers leaked into code

- **What happened.** In the TypeScript trial a curvature radius of 0 produced a model file full of invalid numbers, one console warning and **exit code 0**. The same trial's first pass had six shape ratios written as literals in code instead of parameters.
- **Found by.** The trial's own builder, by testing a bad input and by searching the code.
- **Cause.** The geometry code did not validate inputs or outputs; keeping numbers out of code was discipline, not something a tool enforced.
- **Fix and guard.** The geometry kit throws on non-finite output and on impossible inputs (a planted zero-height cylinder now stops the build: "radius and height must be positive"). Check `geometry` (all meshes finite, no zero-area triangles, unit normals). Check `glTF validator` (0 errors, 0 warnings). Check `numbers in source` (no dimension-like literals in the asset's source files). An unknown parameter name stops the build and suggests the closest names.
- **Status.** Fixed. *Tested* with planted errors by the infrastructure agent.

<a id="f-12"></a>
### F-12 — A trial's output differed from run to run

- **What happened.** In the Blender trial, two runs gave identical description files and different model files: one mesh operator returned the same triangles in a different order each time.
- **Found by.** The determinism comparison the trial had been asked to run.
- **Cause.** A library operator with unordered output.
- **Fix.** That mesh was built another way. The final generator has its own writer.
- **Guard.** Check `determinism`: two builds must give the same SHA-256 and an identical description file.
- **Status.** Fixed. *Tested* on every check run.

---

## Measuring and modelling

<a id="f-13"></a>
### F-13 — The owner's three scale figures conflict with the photos

- **What happened.** The owner gave three figures from memory. None is reproduced by the photo measurements as first read.

| Owner's figure | Photo measurement | Handling |
|---|---|---|
| Platform 1.5 × 1.5 m | 1.50 wide (taken as the scale) × 1.41 ± 0.02 front to back | Model uses 1.50 × 1.41 |
| Seat 1.4 m high | Top of seat back 1.28 ± 0.03 m above the deck, 1.48 above the room floor, on two rigs | Model uses 1.28; the 1.4 is stored as a conflicting record |
| Head to display 1.2 m | Headrest surface to screen 1.14–1.21 m; eye to screen centre about 0.97–1.05 m | Stored; eye points are derived from the seat instead |

- **Found by.** The measurement agent.
- **Cause.** Unknown. Round remembered figures, a different reference point, or a rig set up differently on the day are all possible; none can be tested from the photos.
- **Fix.** None; this is a decision for the owner. The model follows the photo measurements, keeps the owner's figures in the parameter records as conflicting evidence, and asks for a tape.
- **Guard.** Rule: a person's remembered figure is evidence with a range, not ground truth ([L-07](lessons-learned.md#l-07)); conflicts stay visible in the record instead of being averaged away.
- **Status.** Handled, **open for the owner**. See [measurement-results](../50-implementation/measurement-results.md#the-owners-three-figures).

<a id="f-14"></a>
### F-14 — Purchased parts were wrongly identified

- **What happened.** The plan treated purchased parts as exact once identified. Two identifications were wrong: the touchscreen is the 13.3-inch size, not the 15.6-inch one in the brief (its height measures 0.84 of the larger model's); and the pedal unit's width had been tied to the wrong element (F-04).
- **Found by.** The measurement agent, through the closure table.
- **Cause.** Identification from a photo is itself an estimate.
- **Fix.** Touchscreen height and active height use the triangulated values; its width (0.33 ± 0.03 m) is by proportion and marked *assumed* because the maker's sheet for that size was not looked up.
- **Guard.** Closure table before modelling; a maker's value needs a confirmed model, otherwise it carries a range.
- **Status.** Fixed in the model; the touchscreen width is still an estimate.

<a id="f-15"></a>
### F-15 — A camera for another rig failed its own check

- **What happened.** The camera for the photo of Rig C2 was first solved from three deck edges alone, which determines it exactly with nothing left over. Checked against two vertical room edges it missed by 24–52 px (camera height wrong by 0.2 m). Three further control-room photos show too little of any platform outline and were not solved at all.
- **Found by.** The measurement agent's own held-out check.
- **Fix.** The verticals were added to the solve; points taken through that camera are classed *cross-instance* with ±0.05 m. The three unsolved photos are left out of the camera file.
- **Guard.** A camera is accepted only with a residual on features not used to solve it ([P-06](patterns.md#p-06)).
- **Status.** Handled.

<a id="f-16"></a>
### F-16 — The measurement table contained errors the modellers found

- **What happened.** Modellers working with the solved cameras found values in the frozen dimension table that the photos contradict.

| Item | Table said | Modeller found | How |
|---|---|---|---|
| Stand column depth | 0.15 ± 0.03 m | 0.22 m at the foot, 0.245 at the head | The table took the sight line at 40° to the forward axis; the solved camera gives 24° |
| Monitor width 1.195 m | read as arc length | it is the chord (straight width); along the arc 1.218 | Maker's convention |
| Emergency stop height above plate | about 0.045 m | 0.029 m; head diameter 0.037 (maker's catalogue figure 0.03 not used) | Pixel spans in one photo |
| White band on the platform side | 0.15 m | 0.105 m | Brightness read along vertical lines in two photos |
| Pod top plates | one value | left 0.510, right 0.527 m: 17 mm apart | Kept visible; the model uses the mean so the pods mirror |

- **Found by.** The structure and pods modellers; the band height after the reviewer's hint.
- **Cause.** A single measuring pass by one agent, partly from single views with assumed planes.
- **Fix.** Parameter records carry the corrected value, the old value and the reason.
- **Guard.** Rule: modellers report conflicts with the table and never nudge a value by eye ([P-18](patterns.md#p-18)).
- **Status.** Fixed.

<a id="f-17"></a>
### F-17 — Parallel modellers broke each other's builds

- **What happened.** Three modellers edited one model at the same time. Of the 16 failed builds in the timeline that were not deliberate tests, at least 11 were caused by another agent's file being in the middle of an edit: a renamed parameter (8 builds of the structure modeller stopped on a parameter the pods modeller had just renamed), a parameter file with a syntax error, a spec entry in the wrong order. One modeller's full check also failed on zero-area triangles in the other two groups.
- **Found by.** The build and the checks, immediately and loudly.
- **Cause.** Shared parameter and spec files with no isolation.
- **Fix.** `--only <group>` builds the whole frame tree but only the named groups' meshes, and each modeller got a workspace (its own build and render folders). The shared spec file is changed only by small targeted edits.
- **Guard.** [P-10](patterns.md#p-10). Lesson [L-34](lessons-learned.md#l-34).
- **Status.** Fixed. Cost: a few minutes; no wrong output was produced.

---

## Model review

<a id="f-18"></a>
### F-18 — Round 1 was rejected: toy-grade upholstery and pod legs

- **What happened.** The first complete, formed model (30,742 triangles) passed all 18 scripted checks and was **not accepted** by the reviewer: "a credible layout carrying a few toy-grade parts". Eight of 45 components were rejected. The seat cushion was "a faceted low-polygon trough" (686 triangles, side crests 65–75 mm above the centre); the back upholstery "flat planes with hard creases"; each pod leg "a slab with a sausage attached".
- **Found by.** The independent reviewer, from its own renders and its own reader of the model file.
- **Cause.** The modellers matched outlines against photos, and outlines were right. Surface quality on soft parts is not visible in an outline, and no check measures it.
- **Fix (round 2).** Cushion, back cushion and head pad rebuilt as smooth lofted surfaces; shell edges rounded; pod leg and lower blade rebuilt as one faceted shape. Seat group 5,364 → 8,516 triangles.
- **Guard.** A reviewer round is mandatory before a model is called finished; the reviewer's brief asks for a verdict per component and names the toy triggers. Lessons [L-17](lessons-learned.md#l-17), [L-24](lessons-learned.md#l-24).
- **Status.** Fixed in round 2; confirmed closed by the round-2 reviewer (seat pan and back cushion accepted, the pan with minor deviations).

<a id="f-19"></a>
### F-19 — Three moving parts failed when moved

- **What happened.** The joints passed the `expected motion` check (each joint moves exactly the right nodes) and still failed in use. (1) The joystick's rubber boot was a rigid part of the base, so at ±20° the lever tore out of it. (2) The monitor's height joint had a range of −0.243 to +0.049 m, but the arm was one rigid mesh: at the low end the monitor hung 0.24 m below the arm, in mid-air. (3) At full travel the pedal arms passed through a cross bar (178 vertices inside the base).
- **Found by.** The reviewer, by posing every joint at its limits and testing intersections.
- **Cause.** The motion check tests the hierarchy, not the geometry at the limits. No modeller had rendered the limits.
- **Fix (round 2).** The boot is split: lower pleats fixed, upper pleats move with the lever, and the pivot moved from 45 mm to 12 mm above the mounting plane. The arm is split into a base and sliding links that carry the monitor; range now −0.095 to +0.06 m. The pedal rails were moved clear; the modeller's own interference test found 0 vertices inside over 27 monitor poses and 3 pedal poses.
- **Guard.** Rule: every joint is rendered at both limits before a round is handed over. A scripted limit-pose interference check is idea [I-03](ideas.md#i-03) (not built).
- **Status.** Fixed in round 2; confirmed closed by the round-2 reviewer, who posed every joint at both limits and ran its own penetration test.

<a id="f-20"></a>
### F-20 — Overexposed rendering hid the form

- **What happened.** Lit white surfaces rendered at 244–249 of 255 with almost no gradient; the same surfaces in the photos sit at 150–160 with visible shading. Facets, bevels and roundness the modellers had built could not be seen. The reviewer called it "the largest single contributor to a white plastic kit look".
- **Found by.** The reviewer, by measuring pixel values.
- **Cause.** Light and exposure were set once on the blockout and never measured.
- **Fix.** New lighting and tone curve in the viewer: lit white median 221 (223–231 at the bright end), shaded white 164, 0 % of pixels clipped. Materials retuned: matte black plastic, lighter satin leather, rougher deck and rubber.
- **Guard.** Acceptance test T53 in the viewer's acceptance script measures white and black levels per material on every run.
- **Status.** Fixed. *Measured.*

<a id="f-21"></a>
### F-21 — The eye point sat at a tall man's height

- **What happened.** The single eye reference point was 0.835 m above the seat reference and 10 mm behind it. A median adult's seated eye is nearer 0.79 m above the seat, less with cushion compression, and some centimetres in front of the seat reference.
- **Found by.** The reviewer.
- **Cause.** A default taken without stating a body size, placed as a fixed coordinate instead of being derived from the seat.
- **Fix (round 2).** Three eye points (small woman, median adult, tall man) are derived from the live seat reference: eye heights 0.685 / 0.765 / 0.845 m above the seat surface, 20 mm cushion compression, eye 0.2 m ahead of the back plane. They move with the seat.
- **Guard.** The values are classed *assumed* and their evidence text says they were quoted from memory of published tables and not looked up; they are on the model card's list of unverified critical values.
- **Status.** Fixed in structure; **the numbers themselves are unverified**.

<a id="f-22"></a>
### F-22 — Triangles were on the small parts

- **What happened.** In round 1 one ring button (308 triangles) had more triangles than the head pad (188); the four deck handles (1,888) had more than the whole seat upholstery (1,386). Twenty-two of 68 draw calls went to handles, buttons, the key switch and the emergency stop.
- **Found by.** The reviewer.
- **Cause.** Detail is easy to add to small turned parts and hard to add to soft surfaces; nothing compared the distribution with importance.
- **Fix (round 2).** Handles 472 → 136 each, ring buttons 308 → 240, joystick bases 2,012 → 924, hub covers 880 → 336, monitor arm 1,936 → 844 in two parts; the upholstery got 5,258. Total 30,742 → 28,042 with better shape.
- **Guard.** The `budget` check prints the three heaviest components (now the seat cushion, back cushion and right grip). The reviewer is briefed to remove as well as to demand ([P-15](patterns.md#p-15)).
- **Status.** Fixed in round 2.

---

## Viewer

<a id="f-23"></a>
### F-23 — The viewer was written in JavaScript

- **What happened.** The project is TypeScript, and the first viewer was a plain JavaScript file.
- **Found by.** The owner: "why is viewer.js a js and not ts".
- **Cause.** The coordinator's brief asked for "plain ES modules, no build step" to keep the viewer simple to serve.
- **Fix.** Viewer converted to TypeScript and bundled by Bun (about 15 minutes of agent time). The generator and the viewer now import one shared function that turns a joint value into a transform; the two trials and the first viewer had three diverging versions of that rule.
- **Guard.** Check `types` (the whole project compiles cleanly). Check `pose conformance`: on 96 test poses the shared TypeScript function and the independent Python reader agree (largest difference 2.4e-8 in the current run).
- **Status.** Fixed.

<a id="f-24"></a>
### F-24 — The first viewer was overcomplicated

- **What happened.** The owner: "it is overcomplicated and takes a lot of time". Two independent reviewers measured it: 103 controls on screen (157 pointer targets), 24 sliders in one global list, the 3D view 58 % of a 1440 × 900 window (41 % at 1024 × 768), node IDs and jargon visible, a click on a screen selected only its picture surface, "Isolate" on the seat left one mesh, zooming to a joystick took 35–40 wheel notches, no reset, no way to share a view.
- **Found by.** The owner; quantified by two reviewers with different lenses.
- **Cause.** The viewer had been built as the agents' inspection bench and handed to people unchanged.
- **Fix.** Redesign by a separate implementer in a copy of the viewer: 16 controls by default, the 3D view 82.8 % of the window, one card for the selected part holding only its own adjustments, one two-axis pad where a part has two rotations, dragging the selected part moves it, the state in the address so a link reproduces the view. 53 of 53 acceptance checks pass. Details in [viewer](../50-implementation/viewer.md).
- **Guard.** `bun tools/ui-accept.ts` re-runs the 53 checks with real pointer events.
- **Status.** Fixed. *Tested* by script; no person other than the owner has used it.

<a id="f-25"></a>
### F-25 — Seat adjustments were locked with no way to unlock

- **What happened.** The five seat adjustments and the pedal tray appeared as greyed sliders with a padlock. Nothing unlocked them. The owner: "why cant i adjust the seat? the lock is confusing for users unless there is a way to unlock".
- **Found by.** The owner; reproduced by both reviewers (a real drag left the value at 0).
- **Cause.** The plan locked motions that no photo shows ("keeps guessed motion out of every result") and the viewer showed the lock without an explanation or an exit.
- **Fix.** Assumed adjustments are usable. Each is tagged "assumed range"; while one is in use an amber notice stays on the picture ("Seat moved within assumed ranges — not confirmed on the real rig") with "Back to as photographed"; a saved picture carries the sentence. The description file still records these joints as assumed and locked, and scripts must pass an explicit flag to move them.
- **Guard.** Acceptance tests T31–T37. Pattern [P-22](patterns.md#p-22).
- **Status.** Fixed.

---

## Project hygiene and record keeping

<a id="f-26"></a>
### F-26 — Planning files with client names were copied into the project folder

- **What happened.** When the session moved to the project folder, the application copied the planning documents, which name the client and its customers, into the project root.
- **Found by.** The coordinator.
- **Fix.** Removed from the root; they live under `private/`, which with `work/` is excluded from version control.
- **Guard.** Check `banned words` scans every file that can be committed, including file names and image bytes (72 files at the time of writing, none found). The words are stored encoded so the check itself does not contain them.
- **Status.** Fixed.

<a id="f-27"></a>
### F-27 — Viewing directions were wrong in photo descriptions

- **What happened.** The first photo inventory described two photos of the reference rig as taken from the rear left; they are from the rear right (the near pod carries the emergency stop and the touchscreen, which are on the operator's right). The plan's appendix corrected this and six other misreadings (for example an object first read as a microphone that looks like a lumbar pump bulb). The same "rear left" wording is still in `img/photos/captions.json` for photos 2511 and 2530.
- **Found by.** A reviewer during planning; the remaining caption error by the writer of this page while checking images.
- **Cause.** Left and right in the image were confused with the operator's left and right.
- **Fix.** The measurement work uses the corrected directions. The gallery on this wiki gives the corrected direction.
- **Guard.** Convention: left and right always mean the operator's; a direction in a caption is checked against a single-sided part.
- **Status.** Partly open: `captions.json` still needs the two corrections (it belongs to another page owner).

<a id="f-28"></a>
### F-28 — Agents' self-reported durations were wrong

- **What happened.** Several timing lines written by agents were wrong and later corrected by the same agents or contradicted by the harness. The structure modeller logged 169 s and about 600 s for work that took about 27 minutes (its start marker had been overwritten). The pods modeller first wrote "about 25 min" of study, then corrected it to about 15. The round-1 reviewer wrote "total review about 45 min"; its own start and end stamps and the harness say 26.8.
- **Found by.** The agents themselves in two cases; the third by comparing the timeline with the harness figures.
- **Cause.** Agents have no reliable sense of elapsed time; hand-kept start markers get lost.
- **Fix.** The performance pages use harness figures for agent runs and tool-written lines for tool timings; agent-written durations are used only as notes.
- **Guard.** Pattern [P-19](patterns.md#p-19): tools write their own timing lines. Lesson [L-35](lessons-learned.md#l-35).
- **Status.** Handled.

<a id="f-29"></a>
### F-29 — Round 2 still had three small defects

- **What happened.** A fresh reviewer (not the round-1 reviewer) judged round 2 "ACCEPTED AFTER THE LISTED FIXES": 46 components, 41 accepted, 5 accepted with minor fixes, none rejected, no blocker; of the 28 round-1 findings 24 were closed, 3 partly and 1 open (the owner's three figures, which need a tape). Three defects were required to be fixed: a white spike, a through-slot and a loose flap at each pod's cup recess (N1); stand columns with a half-round nose that read as pipes from the operator's eye, although the photos show flat-faced posts (N2, which also corrects the build brief's word "obround"); black rubber and plastic so dark that grip buttons, bellows pleats and pedal pads were invisible (N3). It also found that a pose exactly at a joint limit was refused (N5).
- **Found by.** The round-2 reviewer: about 190 renders from 13 viewpoints, 34 photo side-by-sides, its own penetration and dimension scripts, 18 minutes.
- **Cause.** N1: a cage face that was not planar and a cut taken through the wall; N2: the brief described the section wrongly; N3: the round-2 material change overshot towards matte; N5: limits rounded in the description file and compared exactly.
- **Fix.** Round 3 (see [modeling rounds](../50-implementation/modeling-rounds.md#round-3-the-final-fixes)). The reviewer prescribed a spot check of the three places instead of a third full review; the coordinator did it and accepted.
- **Guard.** The reviewer reviews with its own renders and its own scripts; a fresh reviewer each round. Lesson [L-17](lessons-learned.md#l-17).
- **Status.** Fixed in round 3.

<a id="f-30"></a>
### F-30 — Seven agents stopped mid-task by a usage limit

- **What happened.** During the documentation phase seven agents were running in parallel (three wiki writers, the publishing-tools agent, the Skill author, and two modellers about to apply the round-3 fixes). All seven stopped with a rate-limit error when the account's usage limit for the model in use was reached.
- **Found by.** The harness (task notifications).
- **Cause.** Many agents running at once, each reading large sources and making many renders; no budget for usage per phase.
- **Fix.** The owner switched the session to another model. The coordinator compared the model on disk with the reviewed snapshot (identical SHA-256), listed which pages and tools already existed, fixed one check failure the interruption exposed (F-31), and started fresh agents with "continue from what is on disk" briefs. Nothing was lost because every agent wrote its work to files as it went.
- **Guard.** Work lives in files, never only in an agent's context; the coordinator keeps notes, an agent-run table and a timeline. Resuming a stopped agent on an exhausted model fails, so restart on another model with a brief that lists what exists. Lessons [L-51](lessons-learned.md#l-51) to [L-53](lessons-learned.md#l-53).
- **Status.** Recovered; about 30 minutes of elapsed time lost.

<a id="f-31"></a>
### F-31 — The banned-word check failed on two images by chance

- **What happened.** After two documentation images were added, `bun run check` failed: a three-letter device-maker word was "found" in two JPEG files.
- **Found by.** The check itself, by the coordinator after the interruption.
- **Cause.** The check scanned raw image bytes for every banned word; a short word occurs by chance in compressed data.
- **Fix.** Binary files (images, the model, fonts) are scanned only for the never-allowed names (rig maker, customer); text files get the full scan.
- **Guard.** The comment in `tools/check.ts` explains why. Lesson: a text check run on binary data needs a reason.
- **Status.** Fixed.

<a id="f-32"></a>
### F-32 — The first automatic deploy was refused on the GitHub runner

- **What happened.** The first GitHub Actions run (2026-11-23, commit `ac78fc6`) stopped before uploading anything: `bun run check` failed on the runner although it passed on the development machine. Production was not touched.
- **Found by.** The check, run by the deploy script on the runner, which refuses to deploy after any failure (the safeguard working as designed).
- **Cause.** Two differences between the runner and the development machine. (1) The runner uses full Google Chrome, which asks every page for `/favicon.ico`; the local headless shell does not. The 404 appeared in the viewer's console and the console check counts it as an error. Visitors with ordinary browsers got the same harmless 404 on the live site. (2) WebGL runs in software on the runner (no GPU): the 90-frame frame-rate benchmark took two minutes at 1 frame per second.
- **Fix.** The viewer and every wiki page declare an empty icon, so no browser asks for `favicon.ico`. On a CI runner (`CI` set) the check counts draw calls from one frame and does not measure the frame rate, which says nothing about real viewing there.
- **Guard.** The deploy refuses on any failed check, wherever it runs. Lesson [L-55](lessons-learned.md#l-55).
- **Status.** Fixed in the next commit.
