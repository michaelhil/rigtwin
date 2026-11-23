---
title: Reusable patterns
tldr: Twenty-two procedures (P-01 to P-22) that worked in this project and can be reused on the next asset, each with when to use it, how to do it, what it cost here and what it found here.
status: living
updated: 2026-11-23
tags: [lessons, patterns, process, review, measurement, agents]
---

# Reusable patterns

## TL;DR

- A pattern here is a procedure that was **actually run** in this project and produced a result worth its cost. Costs are agent minutes and tokens as reported by the agent harness, on one run.
- Six concern planning and review (P-01 to P-04, P-15, P-16), five concern measuring and honest numbers (P-05 to P-08, P-18), six concern building and checking (P-09 to P-14), five concern records and presentation (P-17, P-19 to P-22).
- The three with the highest yield per minute: fresh reviewers who compute (P-03), the complete blockout with a coverage check (P-09), and the scale closure table (P-05).
- Patterns that were planned and not run (planted-error test of the reviewer, hold-out points clicked by a person, separately authored acceptance specification) are **not** listed here; they are in [ideas.md](ideas.md).
- Lessons behind each pattern: [lessons-learned.md](lessons-learned.md). Incidents: [failures-and-fixes.md](failures-and-fixes.md).

## Overview

| ID | Pattern | Use when | Cost here |
|---|---|---|---|
| P-01 | Matched-brief trials | choosing between two tool stacks | 2 agents, 54 agent-min, 0.54 M tokens |
| P-02 | Position-taking and simplicity critics | a first plan draft exists | 2 agents, 25 agent-min, 0.50 M tokens |
| P-03 | Fresh adversarial reviewers who compute | a plan or result is about to be relied on | 5 agents, 81 agent-min, 1.61 M tokens |
| P-04 | Closure check of review findings | after rewriting against a review | 1 agent, 13 min, 0.28 M tokens |
| P-05 | Scale from one large feature, with a closure table | sizes come from photos | part of the 48 min measurement run |
| P-06 | Gauge features | solving a camera | same run |
| P-07 | Detectability table | verifying placement by overlay | same run |
| P-08 | Honest classes and ranges | any number enters the model | built into the parameter loader |
| P-09 | Complete blockout before form | starting an asset | 46 min including all tooling |
| P-10 | Spec-driven parallel modellers with workspaces | more than one modeller | 27–41 min per group, in parallel |
| P-11 | One renderer for agents and people | agents must judge pictures | none extra |
| P-12 | Photo-matched outline overlays | comparing a model with a photo | 1.6–9 s per set |
| P-13 | Failure-born checks | after any failure | 4 s per check run |
| P-14 | Independent reader | a tool writes a file format | one 256-line script |
| P-15 | The ruthless two-edged reviewer | a model is called finished | 27 min, 0.30 M tokens per round |
| P-16 | Two-lens UX review, separate implementer in a copy | an interface is disputed | 2 reviews 32 min + implementer 62 min, 1.10 M tokens |
| P-17 | Masked evidence copies | source images show people or names | 22 min, 0.34 M tokens |
| P-18 | Modellers as a second measurement pass | modellers have solved cameras | none extra |
| P-19 | Tool-written timeline | performance must be reported | one small module |
| P-20 | Milestone images | the model changes stage | seconds per stage |
| P-21 | Negative tests of the checks | a check is added | minutes |
| P-22 | Assumed but usable | a motion or value has no evidence | part of the viewer redesign |

---

## Planning and review

<a id="p-01"></a>
### P-01 — Matched-brief trials

- **When.** Two or more tool stacks could do the job and the choice would be argued from opinion.
- **How.** Write one small brief with numbered pass criteria. Give it unchanged to one agent per stack. Each builds the same small thing and reports pass or fail per criterion, with timings and installed size. Choose afterwards.
- **Cost here.** Two agents, 24.1 and 29.6 minutes, 0.54 M tokens together.
- **Found here.** Both stacks (Blender used as a library; TypeScript with three.js) passed all seven criteria. The choice was then made on rebuild time (0.06–0.08 s against 1.1 s), installed size (50 MB against 781 MB) and licence. The trials also exposed silent invalid geometry (F-11) and a non-deterministic operator (F-12).
- **Caution.** Scope the trials identically **and completely enough to be shown**: these trials both left out the left pod and the picture reached the owner without saying so (F-01).

<a id="p-02"></a>
### P-02 — Position-taking and simplicity critics

- **When.** A first plan exists and before any expensive review.
- **How.** One agent is told to be the person who commissioned the work and to read the plan as that person. A second is told only to ask "could this be simpler" and to count the plan's moving parts. Neither sees the other.
- **Cost here.** 6.7 and 17.8 minutes; 0.50 M tokens.
- **Found here.** The owner's advocate: the plan was written for builders, had no objective accuracy test, scheduled the seat last and showed nothing early. The simplicity critic counted about 325 named things and judged about a quarter premature (asset before toolkit; Skill after asset). The plan was turned from toolkit-first to asset-first (F-02).

<a id="p-03"></a>
### P-03 — Fresh adversarial reviewers who compute

- **When.** Before a plan is approved or a result is relied on.
- **How.** New agents with no access to earlier critiques or to the author's reasoning. One lens each (here: technical; evidence audit; human factors and downstream use; process and Skill; compliance and pre-mortem). Each is told to re-derive numbers from the raw files and to join results that different agents produced. Each must end with approve or not approve.
- **Cost here.** Five agents, 11–22 minutes each, 81 agent-minutes, 1.61 M tokens.
- **Found here.** None approved. About twenty blockers: the 7 % scale conflict (F-04), the overstated accuracy (F-03), the untested correction (F-05), the camera solved on a moved part (F-06), depth blindness of overlays (F-07), the false confidentiality statement (F-08), the self-certifying process (F-09), the narrowed goal (F-10), and the observation that the owner's own example (reach against seat position) is a special case on this rig because the armrest pods ride with the seat.
- **Caution.** Reviewers and builders here are the same model family; shared blind spots are not excluded (see [critique](../70-results/critique.md)).

<a id="p-04"></a>
### P-04 — Closure check of review findings

- **When.** After a document has been rewritten against a review.
- **How.** One further fresh agent gets the new version and the reviews, lists every blocker and major finding, and marks each closed, partly closed, open or declined with a reason. It also looks for new inconsistencies introduced by the rewrite.
- **Cost here.** 12.9 minutes, 0.28 M tokens.
- **Found here.** 92 findings: 55 closed, 34 partly, 1 open, 2 declined; twelve new inconsistencies. The open one and the most important partial ones were then edited.

<a id="p-15"></a>
### P-15 — The ruthless two-edged reviewer

- **When.** A model is about to be called finished. One round per build round.
- **How.** A fresh agent that never sees the builders' notes. Step 1: list from the photos alone what the object consists of and what makes each part recognisable; compare with the model's tree. Step 2: whole-object impression from its own renders. Step 3: a verdict per component (accept, accept with minor fixes, reject), each finding with the photo region, the render, what is wrong and what to change. Step 4: pose every joint at its limits and test intersections with its own reader of the file. Step 5: performance and economy, including **what to remove**. It ends with a ranked list of the ten changes that buy most credibility per unit of effort, and a list of what it could not judge.
- **Cost here.** Round 1: 26.8 minutes, 0.30 M tokens, about 150 renders, 38 intersection tests.
- **Found here.** 28 accepted, 9 accepted with minor fixes, 8 rejected of 45; one blocker and eight major findings (F-18 to F-22). About 6,500 triangles to remove.
- **Caution.** Not yet tested with planted errors (I-01).

<a id="p-16"></a>
### P-16 — Two-lens UX review, then a separate implementer working in a copy

- **When.** Someone says an interface is too complicated, and before anyone starts changing it.
- **How.** Two independent reviewers with different lenses (here: an interaction designer making an inventory and a heuristic evaluation; a first-time user walking through twelve tasks with real pointer input). Both must count and measure. Both end with acceptance tests that a script can run. A third agent implements in a copy of the application, turns the acceptance tests into a script, and the copy replaces the original only when the script passes.
- **Cost here.** Reviews 15.0 and 16.6 minutes; implementer 61.9 minutes; 1.10 M tokens together.
- **Found here.** 103 controls reduced to 16; picture share 58 % to 82.8 %; 53 of 53 acceptance checks; the agents' address interface unchanged pixel for pixel in 14 parameter sets ([viewer](../50-implementation/viewer.md)).

---

## Measuring and honest numbers

<a id="p-05"></a>
### P-05 — Scale from one large feature, with a closure table

- **When.** Sizes must come from photos and at least one real length is known.
- **How.** Choose the largest flat, static feature with a known length (here the platform deck, 1.50 m wide). Trace its edges to sub-pixel accuracy. Solve the cameras in a frame fixed to it. Then measure every part whose size is known from its maker and tabulate measured, maker's value and ratio. A part that does not close is examined, not averaged.
- **Cost here.** Part of the measurement agent's 48.4 minutes (0.39 M tokens).
- **Found here.** Soundbar 1.003, pedal spacing 1.00, monitor 1.02. Touchscreen 0.84: wrong model assumed (F-14). Pedal heel rest 1.04–1.08: wrong reference (F-04).

<a id="p-06"></a>
### P-06 — Gauge features

- **When.** Any camera is solved from a photo.
- **How.** Name the features that define the frame (plane, origin, directions, scale). State that their residuals are zero by construction and never quote them as accuracy. Keep them static: nothing on an arm, a slide or a hinge. Accept a camera only with a residual on features that were not used to solve it.
- **Found here.** Deck edges 0.18–0.90 px after adjustment; held-out checks accepted two cameras for other rigs and rejected a first attempt (F-15). The viewer's projection self-test (45 points, worst 0.216 px) verifies the camera maths only.

<a id="p-07"></a>
### P-07 — Detectability table

- **When.** Placement is to be verified by laying the model over photos.
- **How.** For each important feature and each photo, compute how many pixels a 50 mm error moves it along each axis and along the line of sight. Mark every dimension checkable or not checkable.
- **Found here.** Along the shared line of sight of the two rear-right photos a 50 mm move is 0–2 px. Not checkable: the whole seat back, the hub, the rear of the cushion, both armrest pads behind their front edge, the emergency stop, the monitor's distance ([measurement-results](../50-implementation/measurement-results.md#what-cannot-be-checked-from-the-photos)).

<a id="p-08"></a>
### P-08 — Honest classes and ranges

- **When.** Any number enters a parameter file.
- **How.** One record per independent number: value, unit, range, class (measured, vendor, photo, assumed, invented), basis, tier (critical, layout, cosmetic) and an evidence sentence. The loader refuses an incomplete record. A range is meant to contain the truth about nine times in ten and must not exclude a derivation that has not been shown wrong. A conflict is written into the record. A component's class is its least certain non-cosmetic parameter.
- **Found here.** 303 records: 3 measured, 22 vendor, 80 photo, 177 assumed, 21 invented. By component: 27 assumed, 19 photo, 2 vendor, 0 measured.

<a id="p-18"></a>
### P-18 — Modellers as a second measurement pass

- **When.** Modellers work with the solved cameras.
- **How.** Tell them to take dimensions from the table, never to nudge by eye, and to report any value the photos contradict with the old value, the new value and the method.
- **Found here.** Five corrections (F-16), among them a column depth off by 0.07 m.

---

## Building and checking

<a id="p-09"></a>
### P-09 — Complete blockout before form

- **When.** At the start of every asset.
- **How.** Write the component tree first. Build every component as a simple solid, both sides, with every joint, reference frame and functional surface, and every check running. Only then start on form, group by group.
- **Cost here.** 46.4 minutes for one agent, including the generator, the first viewer, 18 checks and the conversion to TypeScript.
- **Found here.** 48 meshes, 20 joints, 11,162 triangles, 0.33 MB. No form round afterwards broke structure, names or motion.

<a id="p-10"></a>
### P-10 — Spec-driven parallel modellers with workspaces

- **When.** Several modellers work on one model.
- **How.** One spec file holds the tree, mounts and joints. Each group has its own source module and parameter file, owned by one modeller. `build --only <group>` builds all frames and only that group's meshes. Each modeller renders into its own workspace. Shared files get small targeted edits only.
- **Cost here.** Round 1: 26.7, 36.1 and 41.3 minutes in parallel (41 minutes elapsed for 104 agent-minutes). Round 2: 13.2, 14.2 and 14.5 minutes.
- **Found here.** It works, with friction: 11 failed builds from files caught mid-edit before workspaces were in use (F-17).

<a id="p-11"></a>
### P-11 — One renderer for agents and people

- **When.** Agents have to judge pictures of something a person will later look at.
- **How.** The viewer is a static page. A render driver opens it without a window and sets everything through address parameters (view, camera, hidden groups, pose, colour mode, photo camera). Contact sheets, coloured-by-component views, photo-matched views and the acceptance script all go through it.
- **Found here.** No "looked different in the browser" incident. A contact sheet takes 1.4 s; a full set of all render types 14–16 s.

<a id="p-12"></a>
### P-12 — Photo-matched outline overlays

- **When.** Comparing placement and proportion with a photo.
- **How.** Render the model through the photo's solved camera at the photo's size. Offer three modes: render only, blend, and coloured component outlines drawn on the photo with a legend. Images containing photo pixels stay in the private folder.
- **Found here.** Outlines are the most useful single image for placement; a 50 % blend is weak for dark parts on dark parts. The reviewer's outline sheet over three photos showed agreement "within a few centimetres" for seat top, monitor, shelf, columns, pods, joysticks and deck. See P-07 for what such an image cannot show.

<a id="p-13"></a>
### P-13 — Failure-born checks

- **When.** After every failure.
- **How.** Ask what scripted test would have caught it; add that test to the one check command; write the failure into the check's description.
- **Found here.**

| Check | Born from |
|---|---|
| coverage; left/right | F-01 |
| geometry; glTF validator; numbers in source | F-11 |
| determinism | F-12 |
| pose conformance; types | F-23 |
| projection self-test | F-06 |
| banned words | F-26 |
| exposure levels (acceptance test T53) | F-20 |

<a id="p-14"></a>
### P-14 — Independent reader

- **When.** A tool you wrote produces a file other tools will trust.
- **How.** Write a reader for the file in another language using only its standard library and the format's specification. Let it recompute what the writer claims (node count, triangle count, hierarchy, posed transforms) and compare.
- **Found here.** `tools/glb_inspect.py` (Python) re-reads 89 nodes, 48 meshes and 28,042 triangles, poses all 20 joints, and agrees with the shared TypeScript pose function on 96 poses to 2.4e-8.

<a id="p-21"></a>
### P-21 — Negative tests of the checks

- **When.** A check or a guard is added.
- **How.** Plant the error the guard is for and confirm a loud failure with a useful message.
- **Found here.** A zero-height cylinder: "radius and height must be positive". A misspelled parameter: "unknown parameter … Known in 'pods': …". Both stop the build with a non-zero exit code.

---

## Records and presentation

<a id="p-17"></a>
### P-17 — Masked evidence copies

- **When.** Source images show people, names or screen content and the documentation will be public.
- **How.** A dedicated agent inspects every photo at full resolution, records regions in a file, applies them with a script, strips metadata and verifies the output. Unmasked working copies live only in a scratch folder and are deleted at the end.
- **Cost here.** 22.1 minutes, 0.34 M tokens.
- **Found here.** 11 photos, 88 regions, only the minimal file header left as metadata.

<a id="p-19"></a>
### P-19 — Tool-written timeline

- **When.** The project will report its own performance.
- **How.** Every tool (build, check, render, bundle, acceptance) appends one JSON line with a timestamp, the agent's name from an environment variable, the event and the measured seconds. Agents add lines for milestones. Agent run times come from the harness.
- **Found here.** 472 lines by the start of documentation; tool lines were reliable, agent-written durations were not (F-28).

<a id="p-20"></a>
### P-20 — Milestone images

- **When.** The model visibly changes stage.
- **How.** Copy the contact sheet and one or two telling views into a numbered milestone folder; never delete them. Render-only images, so they can be published.
- **Found here.** Ten milestone folders with 106 images; a selection of them is this wiki's [gallery](../70-results/gallery.md).

<a id="p-22"></a>
### P-22 — Assumed but usable

- **When.** A motion or value has no evidence but people will want to try it.
- **How.** Keep it marked in the data (evidence *assumed*, locked for scripts unless forced). In the interface let it work, tag it, show a persistent notice while it is in use, put the sentence on saved pictures, and give one click back to the photographed state.
- **Found here.** Five seat adjustments and the pedal tray went from dead sliders to working ones without losing the warning (F-25).
