---
title: Critique
tldr: An honest list of what is weak in the result - the model (sizes never taped, depth seen from one viewpoint, borrowed left side, assumed adjustments and pivots), the method (no planted-error test of the reviewer, no human gates, one object and one run, builders and reviewers of one model family, scale resting on one spoken figure), the viewer, the documentation and the process.
status: living
updated: 2026-11-23
tags: [results, critique, limitations, review]
---

# Critique

## TL;DR

- **The model's sizes are unverified.** Not one part is classed measured; the only measured number that shapes the geometry is the owner's spoken 1.5 m, which also sets the scale of everything else. Front-to-back positions of the seat, armrests and monitor cannot be checked from these photos at all.
- **Credibility was judged by agents only.** Two fresh reviewer agents judged the model, but they were never tested on models with known, planted errors, and they come from the same model family as the builders. No person who knows the rig has given a verdict on its likeness.
- **The plan's human controls were not exercised:** no gates, no points clicked by the owner, no separately written acceptance specification. The run is one object, one run, one machine.
- **The Skill is untested.** Version 0.1.0 was written after the build from what was done; nobody has yet built anything by following it.
- Smaller weaknesses: assumed seat adjustments, joystick pivot and touchscreen arm; a high armrest; viewer rough edges; documentation written by several agents in parallel; seven agents stopped by a usage limit.

## How to read this page

Each weakness says how it is known (*tested*, *measured*, *judgment*, *not verified*), what it means
for a user of the model, and what would remove it, with links to the [ideas](../60-lessons/ideas.md)
(`I-`) and [next steps](../90-next/next-steps.md). Quotes are from the two independent model reviews
and are short; their findings are summarised on [modelling rounds](../50-implementation/modeling-rounds.md).
What holds up is at the [end of the page](#what-holds-up).

## The model

| # | Weakness | Evidence | What it means | What would remove it |
|---|---|---|---|---|
| 1 | **Sizes unchecked against a tape** | 305 parameter records: 3 measured (the owner's spoken figures), 22 vendor, 80 photo, 179 assumed, 21 invented. Scale closure against purchased parts 0–2 % (*measured*), but no rig dimension has been taped | Any number read off the model is an estimate with a range. The plan's own honest figure was about ±10 % in plan and ±8–12 cm in height | Tape the ten values listed on [measurement results](../50-implementation/measurement-results.md#the-most-useful-tape-measurements); score the estimates ([I-04](../60-lessons/ideas.md#i-04)) |
| 2 | **Depth seen from one viewpoint only** | Photos 2511 and 2530 stand 0.26 m apart and look along the same diagonal; a 50 mm error along that line moves a point 0–2 pixels (against about 35 sideways) (*calculated*). Only photo 2532 pins depth, and it does not see the seat back, the armrest pads' rear or the monitor's distance (±0.04 m) | A good photo overlay proves nothing about how far back the seat sits or how far away the monitor is. The round-1 reviewer: "I cannot bound the error" | A side photo of the reference rig; tape values; a person clicking hold-out points ([I-02](../60-lessons/ideas.md#i-02)) |
| 3 | **Left side of Rig B's seat borrowed** | No Rig B photo shows the left side, the backrest front or the cushion's rear. 42 records are borrowed from Rigs A, C1 and C2, among them the critical `seat.backrest_surface_x_at_cushion` (−0.59 ± 0.04 m), which defines the live seat reference | The reference rig is "composite, configuration B" and matches no single station exactly; Rig C1's back is reclined about 4° more than Rig B's, so borrowed shapes may carry another rig's settings | One photo of Rig B from the left and one of the backrest front |
| 4 | **Assumed adjustments** | All five seat motions and the pedal tray are `assumed` (no photo shows any of them operated); their ranges and those of the monitor tilt and pan, the touchscreen balls and the pedals are typical values (`standard_default`) | The owner's own example, reach against seat position, cannot be answered. The joysticks ride with the seat, so hand reach would not change anyway; distances to pedals, screens and touchscreen would | Ask the maker or the client which adjustments exist and how far they go |
| 5 | **Monitor arm pose assumed** | The arm is hidden behind the monitor on Rig B; its shape comes from Rig C1 (photo 2517). A sliding collar stands in for the real spring arm's height travel, with a range set by eye (−0.095 … +0.060 m) | The main viewing distance, which drives every vision result, rests on a photographed position (x 0.34 ± 0.04 m) and an assumed arm | A photo behind the monitor; a tape from the backrest to the screen |
| 6 | **Touchscreen arm base unverifiable** | The arm's base under the pod nose is not visible in any Rig B photo; ball ranges ±30° are assumed; the 13.3-inch size rests on two-view heights, the width (0.33 ± 0.03 m) on proportion; the label was never read | Nothing can be said about where the touchscreen can be placed, which is why its reachable range is on the "not qualified for" list | Read the label; photograph the arm from below |
| 7 | **Joystick pivot height assumed** | 0.012 ± 0.02 m above the plate (`standard_default`); round 1 had 0.045. The round-1 reviewer showed what it changes: 28 mm of grip travel at 20° with the higher pivot, about 43 mm at the mounting plane | Grip travel and reach to the grip at full deflection; the "feel" of the simulated control | The maker's drawing ([I-13](../60-lessons/ideas.md#i-13)) |
| 8 | **Armrest pad high relative to the cushion** | Pad top 0.26 m (front) to 0.32 m (rear) above the cushion centre (round-2 reviewer, own measurement): "at the high end of a normal elbow rest height … worth one tape measurement". The outlines agree with the photos, so it was left | An assessment of arm support or shoulder posture would start from a value at the edge of normal | One tape measurement of pad top and cushion top |
| 9 | **Eye points are placeholders** | Sitting eye heights quoted from memory of published tables, not looked up; forward offset from rough figures; they do not follow the recline joint | Every viewing distance and angle depends on them | Look up the source ([I-14](../60-lessons/ideas.md#i-14)); later a manikin layer |
| 10 | **Minor deviations the reviewer accepted** | Blade end in three flats and a thick tray tail (N4); a pinch at the cushion lip (N6); a hard shadow edge across the cushion (N7); pedal-face convention missing from labels (N8); black pan sides (S5); soundbar feet 8 mm in the shelf (T2); no pressed or lit button states | Cosmetic; none affects layout or motion. The reviewer: "None of these needs detail or triangles" | A short polishing pass |

What the model does not try to be: photorealistic, or detailed below the level of controls (no
screws, cables, stitching, text). That was decided ([D-16](../20-decisions/decision-log.md#d-16),
[D-27](../20-decisions/decision-log.md#d-27)) and is not counted as a weakness here.

## The method

| # | Weakness | Evidence | What it means | What would remove it |
|---|---|---|---|---|
| 1 | **The reviewer was never tested with planted errors** | The plan required that the reviewer's clean reports count only after it found errors of known size in prepared models. Not done ([deviations](../30-plan/deviations.md)) | Its detection threshold is unknown. It found a faceted cushion and a tearing joystick boot; whether it would find a seat 6 cm too far back is not known. The plan itself says an AI model's eye cannot be trusted with sizes or differences under roughly 10 % | [I-01](../60-lessons/ideas.md#i-01): about six variants with errors of 1–10 cm and one clean copy |
| 2 | **No human gates, hold-out clicks or separately written acceptance specification** | The owner asked for a fully autonomous run ([D-22](../20-decisions/decision-log.md#d-22)); the coordinator's build contract defined the checks, the tree and the budgets; "finished" meant the reviewer's verdict plus the coordinator's checks | The draft-2 reviewers called the planned process "self-certifying"; version 3's answers to that were not used. The result supports "structure and looks reviewed independently", not "sizes verified" | [I-02](../60-lessons/ideas.md#i-02): an acceptance author, about 40 owner clicks, a fixed tolerance |
| 3 | **One object, one run** | One asset, built once, on one Apple M2, on one day | No spread: times, token counts and quality could differ on a rerun; what generalises is *judgment* | Rerun on a second object ([I-05](../60-lessons/ideas.md#i-05)) |
| 4 | **Builders and reviewers from the same model family** | All modellers, both reviewers, the UX reviewers and the coordinator are agents of one model family | Blind spots they share are not excluded; independence came from fresh context and own tools, not from a different kind of judge | A reviewer from another family, or a person who knows the rig ([I-20](../60-lessons/ideas.md#i-20)) |
| 5 | **The Skill has not been tried on a second object** | Version 0.1.0 was distilled after the build; the agents ran from prose briefs, and its three agent definitions were not used as files ([skills and agents](../80-reference/skills-and-agents.md)) | Whether a fresh agent can follow it to a good result is untested; by the plan's own rule it is not 1.0 | [I-05](../60-lessons/ideas.md#i-05) with sealed tape values |
| 6 | **The measurement closure rests on the owner's 1.5 m** | The deck's side-to-side width is the one scale input, a spoken figure. Whether it means the deck or the outer size was decided about 60 : 40 for the deck; if wrong, every photo-derived length is 2 % off (15 mm on the shelf height). The other two figures the owner gave conflict with the photos | The closure against the soundbar (1.003), pedal pitch (1.00) and monitor (1.02) is the only independent support of the scale, and it cannot detect an error of 2 % | Tape the deck on both sides and outside the rim |
| 7 | **No numeric photo agreement** | No held-out landmark table exists; overlays were judged by eye. The projection self-test (C-17) checks the camera arithmetic, not the model's fit | "Within a few centimetres" is the reviewers' visual judgment | [I-02](../60-lessons/ideas.md#i-02), [I-06](../60-lessons/ideas.md#i-06) |
| 8 | **No scripted collision check** | Tearing and collisions at joint limits were found by the reviewer looking, and by one-off scripts ([checks](../40-method/checks.md#not-checked-by-any-script)) | A later change can bring a collision back without any check failing | [I-03](../60-lessons/ideas.md#i-03) |
| 9 | **Several provenance rules are conventions, not enforced** | Photo values need no machine-written record; rounding by class is not applied; unseen surfaces are not flagged; the "not assessable" rule has no code to enforce it yet ([filling gaps](../40-method/filling-gaps.md#what-keeps-invented-values-from-looking-measured)) | The honesty of the numbers depends partly on agents following written rules | Enforce them in the loader and in the assessment code when it is built |
| 10 | **Re-adjustability not drilled** | The override by `measured.toml` was *tested* on a scratch copy; the three drills of the plan (enter a measured value, swap a device, change a range) were not run as drills, and the before-and-after report is not automated | Probably fine (round 2 changed many parameters without touching code), but not demonstrated as planned | [I-18](../60-lessons/ideas.md#i-18) |

## The viewer

The redesign cut the controls from 103 to 16 and passed 53 acceptance checks; its remaining rough
edges, from the UX work and the viewer page ([known rough edges](../50-implementation/viewer.md#known-rough-edges)):

| Rough edge | How known |
|---|---|
| Frame rate and exposure measured only in headless Chromium on one Apple M2, capped at 60 fps; weak GPUs and phones untested | *not verified* ([I-15](../60-lessons/ideas.md#i-15)) |
| Touch input never driven; narrow layouts tested with mouse events | *not verified* |
| The operator's-eye view needs two clicks (More, then Operator's eye); the first-time-user review asked for one | accepted deviation |
| One of the 53 acceptance checks (comparison with the previous viewer) is a skip unless a second server is given; the comparison was made once by hand | *tested*, partly |
| The acceptance script was written by the same agent that built the redesign, from the two reviews' checklists; the reviewers did not look at the result again | *judgment*: the checks measure what the reviewers proposed; the coordinator checked the page by hand, but no independent reviewer did |
| A hard shadow edge from the seat back falls across the cushion (N7) | open |
| No measuring tool that shows a distance with its range, although the plan promised one | [I-21](../60-lessons/ideas.md#i-21) |
| Photo-matched views work only on the local server, because the camera file stays private | by design |
| No recorded verdict from the owner on the redesigned viewer | *not verified* |

## The documentation

| Weakness | Evidence |
|---|---|
| Written by several agents in parallel from summaries | Five documentation agents in the first pass, restarted after the usage limit; each saw part of the record. The lint checks links, IDs, captions and front matter, not facts |
| Small numerical disagreements between sources survive | Planning tokens are 4.49 million on the plan page and 4.48 million on the timeline page; eye to screen is "0.95–1.05" in the coordinator's notes and "0.97–1.05" in the measurement report (both stated in [D-24](../20-decisions/decision-log.md#d-24)) |
| Some method pages quote round-2 counts | 303 records and 28,042 triangles "as of round 2" on the decomposition, checks and filling-gaps pages; the final build has 305 and 28,070 |
| The photo descriptions file still says "rear left" for photos 2511 and 2530 | [F-27](../60-lessons/failures-and-fixes.md#f-27); the gallery gives the corrected direction |
| Durations written by agents about their own work were wrong three times | [F-28](../60-lessons/failures-and-fixes.md#f-28); performance pages use the harness's figures |
| The raw sources are not linked | Review reports, measurement report and working notes stay in private working folders; the wiki summarises them, so a reader cannot check a quote without access to those private files |
| Nobody has read it as its intended reader | The plain-language aim has not been tried on a human factors researcher who is not a programmer |

## The process

| Weakness | Evidence | Lesson |
|---|---|---|
| **Seven agents stopped by a usage limit** | At about 20:03 UTC three wiki writers, the publishing-tools agent, the Skill author and the two modellers about to apply the round-3 fixes stopped mid-task. About 30 minutes passed before work resumed on another model; nothing was lost because every agent wrote to files and the coordinator keeps notes and a timeline ([timeline](../50-implementation/timeline-and-performance.md)) | Work in files; budget for usage limits; restart on another model with a "continue from disk" brief rather than resume an agent on an exhausted model |
| **Too many agents at once** | When the limit was reached, seven agents were running at the same time (five for documentation and publishing, two modellers) | Size the number of parallel agents to the usage budget, not only to the work |
| **One coordinator held many roles** | The same agent wrote the plan, the build contract and the briefs, ruled on the owner's figures ([D-24](../20-decisions/decision-log.md#d-24)), assembled the model, spot-checked round 3 and verified the viewer | Independence came only from the reviewers; round 3 was not re-reviewed by one |
| **The owner found what the agents missed** | The missing left joystick, the JavaScript viewer, the overcomplicated interface and the confusing seat lock were all found by the owner looking ([F-01](../60-lessons/failures-and-fixes.md#f-01), [F-23](../60-lessons/failures-and-fixes.md#f-23), [F-24](../60-lessons/failures-and-fixes.md#f-24), [F-25](../60-lessons/failures-and-fixes.md#f-25)) | A person looking early is worth more than another check ([L-24](../60-lessons/lessons-learned.md#l-24)) |
| **Version control started only at the end** | [D-33](../20-decisions/decision-log.md#d-33): no commit history of the build; past states survive as milestone images and review snapshots | Start version control on a branch the agents do not need to touch |
| **Plan estimates were far off** | The plan estimated 21–33 agent-hours for stages A to D; the implementation to the reviewed model took 402 agent-minutes (2 h 46 min elapsed), but without the gates, the clicks and the second object, so the two are not comparable | [L-47](../60-lessons/lessons-learned.md#l-47) |

## What holds up

Kept here so the critique is read against what *was* shown (details in the
[goal assessment](goal-assessment.md)):

- **Structure and coverage** are *tested* on every build: every component of the tree exists, both
  sides are present and mirrored, every joint moves exactly the parts it should (C-08, C-09, C-12).
- **Provenance** is complete: every one of 305 numbers carries its class, range and evidence, and the
  build refuses one that does not.
- **Credibility** was judged twice by fresh reviewers who made their own renders and numbers; the first
  rejected the model, the second accepted it after small fixes: "the model is no longer a toy in any
  view".
- **Speed and size** are far inside the budget: 0.2 s per build, 4.7 s for all checks, 28,070 triangles
  of 150,000.
- **The method's failures are recorded** with causes and guards (31 entries in
  [failures and fixes](../60-lessons/failures-and-fixes.md)).
