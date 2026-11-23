---
title: The approved plan
tldr: Version 3 of the plan, approved by the owner on 2026-11-23, rewritten for the wiki. It judged the task feasible as a structural, articulated, re-measurable layout model, with sizes and looks not yet shown, and set out a five-stage method built on parametric code, honest size ranges, scripted checks and an independent reviewer.
status: stable
updated: 2026-11-23
tags: [plan, method, justification, process]
---

# The approved plan

## TL;DR

- **Verdict:** feasible as a structural, articulated, re-measurable layout model. Not yet shown at approval: that the sizes are right, or that it will look like the rig.
- **Method:** an agent writes generator code and a parameter file in which every number has a source and a range; the photos are used to decide the decomposition, estimate the numbers and check the result through solved cameras.
- **Stack and format:** TypeScript with three.js run by Bun; Python for photo measurement and independent checks; one GLB model file plus one JSON description file. Blender is not installed.
- **Process:** a builder, a separate author of the acceptance tests, scripts on every build, an isolated reviewer, and the owner at four short sessions. No agent watches the builder think.
- **How it was made:** eight specialist agents, two internal critics, five fresh adversarial reviewers (none approved draft 2), a rewrite, and a closure check: 16 agents, about 4.49 million tokens, 336 agent-minutes.

## About this page

This is the approved plan in the wiki's words: complete in substance, shorter than the original, and
without client or customer names. The original, with the research reports behind it, is kept in the
project's private archive. The plan was approved with the words "Plan approved". What was then done
differently is in [deviations.md](deviations.md); read that page before treating anything below as a
description of what was built. Terms are explained in the [glossary](../00-overview/glossary.md).

"Tested" means run on the project machine on the real photos. Everything else is judgment or
untested, and marked.

## 1. Verdict and limits

**Feasible as a structural, articulated, re-measurable layout model. Not yet shown: that the sizes are right, or that it will look like the rig.**

The photos support well: which components exist, what is attached to what, what moves with what,
which parts are purchased products, and a parametric model in which every dimension is a labelled
number that can be replaced.

| Limit | Statement at approval |
|---|---|
| Sizes | Every dimension of the custom-built parts was an estimate not checked against any measurement. The two scale references for Rig B differed by about 7 % (*tested*); derivations of one shelf height ran from about 660 to 800 mm. Honest statement: **about ±10 % in plan and about ±8–12 cm in height.** Purchased parts come from vendor drawings once their model is confirmed; for the monitor and touchscreen two candidate models each remained, differing by 47 mm and 61 mm in width |
| Looks | The seat shell, the armrest-pod fairings and the joystick heads make the rig recognisable. Neither trial build produced a convincing version of any of them. The limit is evidence, not tools: no square-on side view of the seat, and no seat dimension measured. Expect a stylised rig unless a side photo and tape values arrive |
| Assessment | For dimensions relative to the seat, the combined uncertainty (about ±8–13 cm) is about as large as the difference between a small and a large operator. The model can show structure, what moves with what, and which questions to ask. **It cannot support any statement about who fits** until the critical dimensions are taped |
| The owner's example | "Reachability depending on seat position" is a special case here: the pods with the joysticks are carried by the seat, so hand-to-joystick distance does not change when the seat moves. Seat adjustment would change the distance to pedals, screens and touchscreen. No photo shows that the seat adjusts at all |
| Beyond geometry | Published reviews of teleoperation put most human-factors risk in perception and cognition (latency, restricted field of view, lost depth cues, workload). A geometric model addresses the smaller part |

**Is this the right approach?** For this kind of object, yes: mostly plates, tubes, boxes and angular
shells, where the value is structure, adjustability and traceable dimensions. Two caveats: an AI
model is a weak judge of size and subtle visual difference, so numeric checks and human review carry
correctness; and a skilled 3D artist would produce a better-looking rig faster, but not the
parameter file with sources, the joints, a rebuild when measurements arrive, or a repeatable method.

## 2. What was promised

| # | Deliverable |
|---|---|
| 1 | A first look at the end of stage A: a *look sample* (seat back, one pod, one joystick head beside the photo), the whole rig as an articulated blockout in a browser viewer, and the frozen table of photo-derived dimensions |
| 2 | The rig asset: one `.glb` model file and one `.json` description file (parts, joints with limits, reference points, every dimension with range and source), generated from a text parameter file and code |
| 3 | A browser viewer opened locally: part tree, click to identify, joint sliders, reference points, measuring with ranges shown, photo-matched views |
| 4 | A model card: what the model is, how each dimension is known, and what it is *not qualified for* |
| 5 | An accuracy result the owner controls: a second object photographed and taped by the owner, tape values sealed, the method's predictions scored against them (stage E) |
| 6 | The Agent Skill and its toolkit, as a project template |
| 7 | A feasibility report |

| Cost item | Estimate (all low confidence) |
|---|---|
| Agent working time, stages A–D | 21–33 hours over 5–8 sessions |
| Stage E | 4–6 hours |
| Tokens, stages A–D | 10–20 million |
| The owner's time | About 4–5 hours in total |
| Disk | Under 0.5 GB; nothing installed system-wide |

Approval committed stages A and B with a ceiling of 18 agent-hours and a stop-and-report rule.
**Cut order if time ran short:** fine detail; form on cosmetic parts; materials; the device-swap
drill; viewer extras. **Never cut:** sources and ranges on every number, the measurement closure,
the hold-out check, the independent review, the model card.

### Questions put to the owner

| # | Question | Answer |
|---|---|---|
| Q1 | What is the first model for, and who will see it? | "internal test" |
| Q2 | Confidentiality: viewing a photo transmits it to the AI provider; the photos show people, third parties' names and location data | "ok; confidentiality is no concern" |
| Q3 | Model Rig B, borrowing from the control-room rigs with each borrowed value tagged? | Not answered separately; approved with the plan |
| Q4 | Can someone go back with a tape; will the owner send the client the measurement sheet and ask for a side photo and drawings? | Not answered; three scale figures were given instead |
| Q5 | Will the owner photograph and tape a second object for stage E? | Not answered |
| Q6 | Name, folder, GitHub account, licence | Name `rigtwin` chosen later; private repository |
| Q7 | A different limit than 18 agent-hours for stages A and B? | Not answered |
| Q8 | Which assessments first (reach, vision, posture, clearance)? | Not answered |

## 3. How it works

### 3.1 Route and scope

- **Target:** the white rig with the joysticks: platform, seat, armrest pods, joysticks and panel controls, touchscreen and arm, monitor stand, monitor arm, monitor, pedals, soundbar. Not the van, the machines or the rooms.
- **Sources:** the 11 photos showing the rig, and public vendor datasheets for identified purchased parts.
- **Route:** parameters in, geometry out, with code as the source.
- **Levels:** *blockout* (simple solids with correct hierarchy, pivots, reference points and overall sizes); *form* (recognisable shapes, materials, screens as separate surfaces); *detail* (labels and fine features; not in this test). Target: form for the whole rig.

### 3.2 Isolation from the background: none

Nothing is extracted from pixels. The agent works on zoomed crops with a pixel grid. The background
is kept on purpose, because floor texture, wall outlets and window lines fixed the camera positions
(*tested*). Masking is for privacy, and for blanking screens whose changing content corrupts
matching. Photos of different rigs are kept apart, because they matched each other in testing.

### 3.3 How sizes are estimated

| Step | What happens |
|---|---|
| 1 | Read focal length and lens from each photo's metadata and hold them fixed. The ultra-wide shot is context only |
| 2 | Sort photos by rig and by what may have moved; parts on arms or slides get a pose per photo |
| 3 | Solve the cameras for one rig together, from features on the room background |
| 4 | Tie the camera set to the model through a few named *gauge features* (deck points for the horizontal plane, deck features for direction and origin, one length for scale). These agree by construction and are never counted when the model is scored |
| 5 | Close the scale before modelling: every known-size part visible on the rig is measured in that one frame, and the ratios must match the vendor ratios within 3 %. Otherwise everything carries the mismatch as its range |
| 6 | Pick landmarks (named physical points) on zoomed gridded crops. A pick seen in two photos is accepted only if the two sight-lines meet within a few pixels |
| 7 | Measure by class (table below) |
| 8 | State the range. "± x" is meant to contain the true value about nine times in ten. No range may leave out a derivation that has not been shown to be wrong |
| 9 | Project a metric grid and the measured points back onto the photo and look. A wrong plane or swapped axis is obvious to the eye and invisible in numbers |
| 10 | Write each photo-derived value into a machine-written record; a later change without a new record fails the build |
| 11 | Freeze and date the full prediction table; it is what gets scored when tape values arrive |

| Class | How | Typical range | Applies to |
|---|---|---|---|
| Two-view | Triangulated between the operator's-eye photo and a rear photo | expected ±3–5 % once the scale is closed (*judgment*, not demonstrated) | stand, shelf, joysticks, pod fronts, deck features near the stand |
| Single-view | One sight-line plus an assumption (a known plane, the symmetry plane, a vertical of known length) | at least ±10 % | pedals, seat, backrest, armrest pads, rear of the platform, monitor position |
| By-eye | Proportion judged in a photo | no coverage claimed | seat details, shell shapes, anything seen only on another rig |

**What the photos cannot check** (*calculated with the real cameras*): for a point about 2.2 m from
the camera, a 50 mm error across the view moves it about 35 pixels, but a 50 mm error along the view
moves it 0–2 pixels. The seat, backrest, armrest pads and monitor are seen only from the rear, so
their front-to-back position cannot be verified from these photos. Every dimension is therefore
marked "checkable to about x mm" or "not checkable from these photos".

**Estimates at approval** (Rig B, heights above the deck, mm; spans across derivations): shelf top
660–800, most likely 700–750; pod top plate 430–535; joystick spacing about 600 ± 50; stand column
inner gap 434–466; deck above the floor 150–213; deck about 1390–1515 wide and 1520–1625 long;
monitor width across the curve about 1180; seat cushion top not measured; seat to joystick, pedals
and stand front to back: **no estimate**. The measurement work in the build replaced these; see the
pages under `50-implementation/`.

### 3.4 How missing data is filled reliably

Use the highest-ranked source that applies, and record which.

| Rank | Source | Class | Basis recorded |
|---|---|---|---|
| 1 | Real measurement of this object | `measured` | who, when, instrument |
| 2 | Vendor drawing of a purchased part (both candidates carried if the model is unsure) | `vendor` | address, model, confidence |
| 3 | Photo measurement by calculation, with a machine-written record | `photo` | two-view or single-view |
| 4 | Judged by eye in a photo | `assumed` | `by_eye` |
| 5 | The same component on another rig | `assumed` | `cross_instance` |
| 6 | Left/right mirror symmetry | `assumed` | `symmetry` |
| 7 | Mechanical or manufacturing convention | `assumed` | `convention` |
| 8 | Ergonomic standard or typical product value | `assumed` | `standard_default` |
| 9 | Plain guess for completeness | `invented` | — |

What makes it reliable is enforced by the build, not by good intentions:

- Every record carries value, unit, range, class, basis, evidence and a tier (ergonomic-critical, layout, cosmetic). The loader refuses an incomplete record.
- Numbers live only in the parameter file; a check rejects dimensions written into code.
- **A value filled from a standard cannot later be assessed against that standard.** Any check that touches it returns "not assessable".
- Ergonomic-critical values that are assumed or invented are printed on the model card as "unverified critical values"; any result depending on them reports "undetermined".
- Whether a motion exists has its own evidence level (seen, inferred, assumed). Assumed motions are locked.
- Photo values are rounded to 5 or 10 mm and assumptions to 10 or 50 mm.
- A measurement arrives as an entry in a separate file with who, when and tolerance. The build reports which values changed and whether each new value fell inside the old range; the old estimate is kept as the method's track record.

The largest gaps on this rig: joystick geometry (vendor drawing, about 90 % confident of the model);
monitor and touchscreen size (two candidates each); Rig B's unseen left seat side (borrowed from a
control-room rig); the left pod (mirror of the right, minus the emergency stop, plus the key
switch); every seat dimension (by eye; top of the tape sheet); whether and how far the seat adjusts
(typical ranges, locked); undersides and the platform plinth (invented).

### 3.5 Decomposition

- **One tree.** A part's parent is whatever carries it and moves it. The human-factors view is tags and reference frames on those parts, not a second tree.
- **A thing gets its own node if** it moves relative to its carrier; is adjustable; is replaceable by a variant; is a purchased item; is a human-factors interface (display, control, body-contact surface); needs its own material; or is a reference frame.
- **Stopping rule.** If no assessment, simulator behaviour or variant needs the node, merge it. Panel buttons, the key switch and the emergency stop are nodes, because a simulator must light and press them.
- **Order.** Decomposition first, as a hypothesis from the photos; a whole-rig blockout tests it; names and joints then freeze. Values never freeze.

```
rig
├─ platform (deck, rim, plinth)
├─ seat
│   ├─ pedestal                 fixed to the platform
│   └─ carrier                  swivel · height            (assumed, locked)
│       └─ base                 front-back slide · tilt    (assumed, locked)
│           ├─ pan
│           ├─ back             recline about the hub axis (position seen; motion assumed, locked)
│           │                   shell, headrest, microphone mount
│           ├─ pod, left        shell · plate · armrest pad (slides; height assumed, locked) · joystick base → lever (2 axes) · key switch · buttons
│           └─ pod, right       same + emergency stop + touchscreen arm (ball joints) → touchscreen
├─ stand
│   ├─ columns (leaning), shelf (possibly tilted)
│   ├─ monitor arm → monitor
│   └─ on the shelf: soundbar (other rigs: speakers, keyboard; a wheel base under the shelf)
└─ pedals                       tray slide                 (assumed, locked)
    └─ base, three pedal arms (each pivots)
```

Seven continuous control motions (two per joystick, three pedals) plus button, key and emergency-stop
states. Functional groups, as tags: displays; primary controls; secondary controls; emergency
control; body contact; structure and supports; clearance boundaries.

### 3.6 How things are connected

**Establishing an attachment from photos**, strongest evidence first: a fastener at the contact; a
traceable load path; the floating test (the body reaches no other support); co-variation (two bodies
keep the same relative pose across photos and rigs while a third differs); seams and material
breaks; a mechanism prior (a rubber bellows means a gimballed lever); absence (weak). Each
attachment is recorded with its evidence, a level (seen, inferred, assumed) and **the observation
that would prove it wrong**, which doubles as a shot list for the next site visit.

**Representing a connection** takes three things: the parent–child link; a *mount frame* on the
parent, given by parameters, where the child's origin sits; and a joint record (type, axis, limits,
neutral value, adjustment or runtime control, evidence level, locked or not, and for controls a
signal name). Moving the stand 5 cm changes one mount parameter and no geometry.

**Pivots sit on the physical axis**, never at the centre of a bounding box.

**The expected-motion table** is the check on connections: each build moves every joint through its
range and compares what moved against a table a person can read.

| When this moves | These move with it | These must not |
|---|---|---|
| Seat slide (if it exists) | seat pan, back, both pods, both joysticks, touchscreen | platform, stand, monitor, pedals |
| Backrest recline (if it exists) | backrest, headrest, microphone | seat pan, pods |
| Armrest pad slide | that pad | the pod, the joystick |
| Monitor arm | monitor | shelf, soundbar |
| Joystick lever | lever and grip | base, pod |
| A pedal | that pedal arm | the base, the other pedals |

**Reference frames** are built by code from geometry and parameters, never placed by eye: origin and
deck plane; two seat reference frames, both labelled as estimates (see
[../80-reference/standards.md](../80-reference/standards.md)); a provisional eye point; a frame at
each display's active area; a grip reference on each joystick; a contact frame on each pedal face,
panel control and the emergency stop. Convention: metres; Z up; X forward toward the main display; Y
to the operator's left.

### 3.7 How the 3D structure is generated

Each component is a function from parameters to a mesh in the component's own frame, built from a
small kit: box, rounded box, cylinder; extrude a 2D outline; revolve a profile; sweep a section along
an arc (the curved monitor); loft between cross-sections (leaning, tapered columns); mirror; and a
**faceted cage with mirror and bevel** for the seat shell and pod fairings. The seat shell is
angular: large near-flat facets, crisp creases, chamfers, inset upholstery. Both trials built it as
a smooth blended surface, which is the wrong kind of shape. The cage is a set of named corner points
stored as proportions of the seat's main dimensions, so the shell rescales when those are taped.

### 3.8 Stack and format

| Layer | Choice |
|---|---|
| Generator and viewer | TypeScript with three.js, run by Bun; an own GLB writer |
| Rendering for the agent | The same viewer page in an open-source browser without a window |
| Photo measurement and independent checks | Python in one isolated environment |
| Format conformance | The Khronos glTF validator on every build |
| Parameters / description | TOML / JSON |

The source is the parameter files plus generator code. The compiled asset is one `.glb` and one
description file that records the model file's fingerprint. Three kinds of variable are kept apart:

| Kind | Example | In the compiled asset |
|---|---|---|
| Design parameter | platform length, column spacing, monitor curvature | baked into geometry; rebuild to change |
| Adjustment | seat slide, monitor height and tilt, armrest pad position | a node movement with limits; no rebuild |
| Runtime control | joystick deflection, pedal travel, button state | a node movement or state, with a signal name |

Planned viewer: a static page with part tree and show/hide; click to identify; sliders generated
from the joints; reference frames; two-point measuring that shows the range; named and
photo-matched views; colour by part and by source.

### 3.9 The agent process

| Role | Form | Owns |
|---|---|---|
| Builder | The main session | Parameters, generator, measurements |
| Acceptance author | A separate agent, run once before modelling | The acceptance spec: tolerances, which landmarks are held out, the expected-motion table, the drills, the look test, the deviation budget |
| Checker | Scripts on every build | Pass or fail on everything numeric |
| Reviewer | An agent with no access to the repository or the builder's notes | Findings on whether the model matches the photos |
| The owner | Four short sessions, two of them gates | Approval of the spec, hold-out clicks, the look test, acceptance |

**The builder's loop, per component:** (1) evidence: open the crops now, not from memory, and say
which faces are never seen; (2) identify: what it is, purchased or bespoke, what it attaches to,
what moves; (3) dimensions from the measuring scripts, each with class and range; (4) shape: the
simplest kit operation, and three to five signature features; (5) predict, then build, one
hypothesis per iteration; (6) fix every script failure before opening any image; (7) describe the
photo, then the render, feature by feature; (8) decide exactly one of: accept, fix the single most
consequential mismatch, or record a deviation. At most three iterations per component per level,
because published gains level off after two or three rounds.

**What an AI model's eye can be trusted with:**

| Act on it | Needs a tool or a second look | Never; use code |
|---|---|---|
| A part missing or extra; gross proportion; the kind of shape; signature features present; colour and material | Left/right swaps; attached or floating; which of two renders is closer | Any size, distance or angle as a number; differences under roughly 10 %; collisions and clearances; hierarchy and pivots |

**The reviewer** works from a packet copied outside the repository, in three sealed steps (inventory
from photos only; naming every component from renders only; then comparison). It has no "approve"
output; a script derives the status. Before its clean reports count, it is tested on prepared
packets with planted errors of known size.

**Finished** means a status script reports every item of the locked acceptance spec. The builder
does not get to say so. The verdict is given per aspect: structure and motion; sizes (verified,
ranges too narrow, or unverified); looks; re-adjustability; method transfer.

### 3.10 The Agent Skill

The unit of reuse is a **project template**: the Skill, the reviewer definition, the toolkit and the
viewer together, because the Skill's checks are code. Planned files: a main file of about 150 lines
(invariants, intake questions, sequence, builder's loop, commands, stop rules); references for the
asset contract, measuring from photos, decomposing and reviewing; two agent definitions; and a
playbook for seated workstations written after the rig. Rig-specific words and numbers live only in
the playbook. A lesson enters the core only when it has shown up in two different assets. After the
rig the Skill is version 0.x; it becomes 1.0 only when a fresh session, given only the template,
builds a different object against sealed tape values.

### 3.11 The wider environment

| Part | State after this plan | Still needed |
|---|---|---|
| Modelling | Method, toolkit, Skill, one asset | Better evidence per asset; a second asset type |
| Evaluating | The asset carries named reference frames, joint limits, sources and ranges | **A digital human layer has to be built.** No open-source tool with sized manikins, posture prediction and reach and vision analysis was found |
| Live testing | A model file in a format the common open engines read (only three.js tested); controls have signal names; screens are separate surfaces | A simulated machine and its camera views; binding to real joysticks and pedals; a first-person viewpoint; latency |

## 4. Stages

| Stage | Work | Before moving on | Agent hours |
|---|---|---|---|
| A. Foundations and first look | Set-up; **measurement closure** and frozen prediction table; acceptance spec written, approved and locked; generator, kit, checks, viewer; **look sample**; whole-rig blockout | The owner's look-sample verdict and clicks | 8–12 |
| B. Check and decide | Hold-out comparison; what is and is not checkable; expected-motion check; reviewer tested with planted errors, then first review | Gate 1 | 4–6 |
| C. Form | Components in order of risk, seat first; materials; drills; second review; model card | Gate 2 | 6–10 |
| D. Extract and report | Toolkit and template consolidated; Skill corrected; playbook; feasibility report | Acceptance | 3–5 |
| E. Transfer and accuracy | A fresh session with only the template builds the owner's second object; sealed tape values scored | Acceptance | 4–6 |

## 5. Success criteria

1. **Structure and motion:** full tree, every joint with limits and evidence level, every reference frame; the expected-motion table holds.
2. **Honest numbers:** every parameter has class, range and evidence; unverified critical values listed; every dimension marked checkable or not.
3. **Photo agreement:** held-out landmarks within a fixed tolerance (1.5 % of image height for a blockout, 1 % for form, at the ninetieth percentile and worst case).
4. **Re-adjustability:** three drills pass with no code change (change parameters within range; enter a measured value; swap the monitor's device record).
5. **Review:** the reviewer met the minimum on its own test; no open blocker; deviations within budget.
6. **Looks:** the owner judges the formed model, beside the photos, as recognisably the rig. A fail is reported as a fail.
7. **Sizes:** verified (at least 8 of 10 taped values inside their frozen ranges), ranges too narrow, or unverified. "Unverified" is a legitimate outcome.
8. **Method:** stage E passes.

**Not qualified for**, whatever the result: any statement about which operators fit; any posture
score; any legibility or viewing-angle verdict; any clearance verdict with less than about 13 cm
margin where the seat is involved, or 10 cm elsewhere; the reachable range of the touchscreen arm;
any compliance statement.

## 6. Risks

| # | Risk | Handling |
|---|---|---|
| 1 | The scale references disagree by 7 % | Closure step; one confirmed number; ranges widened until closed |
| 2 | The seat's front-to-back position cannot be checked from these photos | Marked "not checkable"; top of the tape sheet |
| 3 | The look sample is not recognisable | Shown at the first look with options, not deferred |
| 4 | The generator must be largely written fresh; the faceted-cage operation is untested | First modelling task |
| 5 | The agent's point picking is unreliable beyond the one tested feature | The owner's clicks, compared with its picks |
| 6 | The reviewer misses errors or shares the builder's blind spots | Planted-error test; trusted only above its detection threshold |
| 7 | The builder tunes its own tests | Spec by a separate author, locked |
| 8 | Cameras for photos of other rigs are solved from the model and prove nothing | Solved from platform and stand points only and tested on held-out points; otherwise anything traced through them is "by eye" |
| 9 | Feeding a solved camera to the viewer is untested | Known-answer test against the numeric projection |
| 10 | No tape values ever arrive | Stage E; the report says "unverified" |
| 11 | Budget goes into tooling | Ceiling, stop rule, cut order |
| 12 | Client material leaks | Private repository, commit guard, neutral names |
| 13 | The assessment phase finds the asset lacks something | Bulk output of frames; per-component mesh export; locked placeholders for seat motions |

## 7. Not verified at approval

- No dimension of the rig had been checked against a measurement. No seat dimension had been measured even from photos.
- The cause of the height disagreements, and which scale reference was wrong, were unknown.
- The tested cameras were validated against a third photo taken close to the second: a consistency check, not an independent one.
- No published benchmark covers an agent building a dimensionally faithful, articulated model of a real product from casual photos.
- Monitor and touchscreen models, and the seat's origin, were not confirmed. That Rig B has the same monitor arm as the other rigs was inferred from one visible post.
- Standards details were partly read from sample pages or recalled.
- The faceted-cage operation, a solved camera in the viewer, reviewer isolation and unattended running were untested.
- All time, token and cost figures were estimates.

## 8. Why this plan

| Choice | Evidence behind it | How known |
|---|---|---|
| Parametric code, not reconstruction | Structure from motion found 35 points for Rig B, almost none on the rig; a learned depth model was off by 9 % up to a factor of 3.6 on a known pattern | *tested* |
| Cameras from the background, focal length from metadata | Self-calibration ranged from 1328 to 3090 px against 1502; six held-out points predicted within 0.7–3.4 px | *tested* |
| Ranges that cover disagreement | One method's error bar was ±45 mm; the real error was about 115 mm. Two scale references disagreed by about 7 % | *tested* |
| "Not checkable" as a recorded state | A 50 mm error along the view moves a point 0–2 pixels at the rear photos' distance | *calculated* |
| TypeScript with three.js | Rebuild 0.07 s against 1.1 s; 50 MB against 781 MB; MIT against GPL | *tested* |
| No Blender | Both routes failed on the seat for lack of evidence, not tools | *tested* (trials), *judgment* |
| GLB plus description file | No ratified glTF extension carries joint limits; one library dropped embedded metadata on re-reading | *desk research*, *tested* |
| Scripts and an independent reviewer, no live watcher | Visual self-checks level off after about two rounds and about a third of visual verdicts are wrong or undecided; numeric feedback beats them; a judge handed a conclusion tends to adopt it | *desk research* |
| Rig first, Skill afterwards | About half of the 325 named things in draft 1 were not needed for the first asset | simplicity critique, *judgment* |
| Honest limits in the verdict | Seat-relative uncertainty (about ±8–13 cm) equals the spread between small and large operators | *calculated* by a reviewer |

## 9. How the plan was made

Three steps, as the owner asked: a specialist team, internal critique from the owner's position and
from "could this be simpler", then a fresh adversarial team.

| Step | Who | Result |
|---|---|---|
| Investigation | Eight specialist agents in parallel | Eight reports; two working blockouts; measurement scripts; a viewer prototype |
| Draft 1 | Coordinator | A toolkit-first plan in Python |
| Internal critique | An agent taking the owner's position; an agent asking "could this be simpler" | Owner's advocate: written for builders, no objective accuracy test, seat scheduled last, nothing visible early. Simplicity monitor: of about 325 named things, 168 essential, 74 deferrable, 83 removable; build the rig before the toolkit; keep the route that was actually tested |
| Draft 2 | Coordinator | An asset-first plan with two gates |
| Adversarial review | Five fresh agents with no access to the critiques or the coordinator's reasoning | **None approved.** 92 blocker and major findings, about twenty of them blockers |
| Version 3 | Coordinator | Rewritten against the reviews |
| Closure check | One further fresh agent | 55 of 92 findings closed, 34 partly, 1 open, 2 declined with reasons; no blocker open. New inconsistencies introduced by version 3: the plan says twelve; the closure report's own table lists 25 (the sources disagree) |
| Final edits | Coordinator | The approved document. These last edits were not checked again |

| Reviewer | Main finding | What changed |
|---|---|---|
| Technical | The two scale references disagree by about 7 %; the height conflict was closed by an untested correction; the checks could not see depth errors; the trial code was a demonstration | Closure step; classes by what the photos allow; "not checkable" as a state; faceted-cage operation; generator written fresh |
| Evidence audit | The accuracy was presented as verified and was not; "exact" purchased parts and "the only proven route" were overstated; trial times were 22–29 minutes, not hours | Verdict and size section rewritten; provisional spans in place of confident values; costs re-estimated |
| Human factors and downstream use | Seat-relative uncertainty equals the anthropometric spread; the owner's example is a special case; the seat reference did not match ISO 5353; "on this machine only" was false | Limits stated in the verdict; seat reference renamed; "not qualified for" list extended; data handling rewritten; standards table added |
| Process and Skill | The process was self-certifying; reviewer isolation and its test were weak; the Skill was not reusable elsewhere | Acceptance spec by a separate author, locked; machine-written records; hold-out clicks; deviation budget; planted errors of graded size; project template as the unit of reuse |
| Compliance and pre-mortem | "Credible" had been narrowed to "layout-credible"; looks could fail quietly; no ceiling on budget | Two limits in the verdict; look sample first; verdict per aspect; ceiling, stop rule and cut order |

| Phase | Agent | Duration (min) | Tokens | Tool calls |
|---|---|---|---|---|
| Investigation | Agent process and Skill design | 12.8 | 222,991 | 48 |
| Investigation | Reuse, viewer, naming | 16.0 | 261,216 | 49 |
| Investigation | Toolchain and asset format | 16.4 | 217,977 | 56 |
| Investigation | Hands-on trial B (TypeScript with three.js) | 24.1 | 270,714 | 65 |
| Investigation | Decomposition and human-factors semantics | 28.1 | 246,194 | 55 |
| Investigation | Hands-on trial A (Blender as a library) | 29.6 | 272,693 | 67 |
| Investigation | Reconstruction methods | 31.8 | 261,512 | 106 |
| Investigation | Photo evidence and measurement | 59.4 | 350,100 | 96 |
| Critique of draft 1 | Owner's advocate | 6.7 | 166,286 | 15 |
| Critique of draft 1 | Simplicity monitor | 17.8 | 328,844 | 28 |
| Review of draft 2 | Compliance and pre-mortem | 11.2 | 196,322 | 20 |
| Review of draft 2 | Process and Skill | 13.3 | 295,987 | 39 |
| Review of draft 2 | Technical | 16.8 | 338,510 | 35 |
| Review of draft 2 | Human factors and downstream use | 17.7 | 324,553 | 65 |
| Review of draft 2 | Evidence audit | 21.7 | 450,245 | 44 |
| Closure check of version 3 | Closure verifier | 12.9 | 280,841 | 19 |

Totals as reported by the agent harness: 16 agents, about 4.49 million tokens, 336 agent-minutes.
The agents ran in parallel within each step; elapsed time for the whole phase was about 3.5 hours
including the coordinator. Per-report summaries are in [../80-reference/sources.md](../80-reference/sources.md).
