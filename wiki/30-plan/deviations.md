---
title: Deviations from the approved plan
tldr: What was done differently from the approved plan and why. The largest change is the owner's direction to run a full implementation autonomously, which replaced the plan's human gates, owner clicks and separate acceptance author with reviewer rounds and the coordinator's checks in the browser.
status: living
updated: 2026-11-23
tags: [plan, deviations, process]
---

# Deviations from the approved plan

## TL;DR

- The plan was staged, with four owner sessions and two decision gates. The owner approved it and in the same message asked for a full test implementation in one run. Reviewer rounds and the coordinator's verification in the browser took the place of the gates.
- Four plan mechanisms meant to stop the builder marking its own work were not used in this run: the separate acceptance author, the owner's hold-out clicks, the owner's look-sample verdict, and the two gates. This weakens what the result proves; it is stated here so nobody assumes otherwise.
- Privacy masking was dropped for what agents see and kept for what is published.
- Three modellers worked in parallel where the plan built components one after another, and the Skill was extracted after the build instead of drafted before it.
- The owner changed the viewer during the build: TypeScript, a simpler interface, and assumed adjustments that can be used instead of being locked.

## How to read this page

Each row gives what the plan said, what was done, the reason and who decided. "Owner" is the
project owner; "coordinator" is the AI agent that ran the project. Decision numbers refer to
[../20-decisions/decision-log.md](../20-decisions/decision-log.md). The plan is summarised in
[approved-plan.md](approved-plan.md). All of this happened on 2026-11-23. The numbers `V-1` onward
are local to this page; they are not one of the wiki's global ID series.

## Deviations

| # | The plan said | What was done | Reason | Decided by |
|---|---|---|---|---|
| V-1 | Five stages with four owner sessions: approval of an acceptance spec, a first look with a look-sample verdict and about forty clicks, Gate 1, Gate 2. Work stops at each gate | One autonomous run from approval to a finished model. A ruthless reviewer agent reviewed the assembled model in rounds; the coordinator verified the result in the browser | The owner approved the plan and asked in the same message for "a full test implementation of the pipeline" with "a separate ruthless agent" | Owner (direction); coordinator (how). D-22 |
| V-2 | A separate agent writes the acceptance spec before modelling; the owner approves it; it is then locked so the builder cannot tune the tests | No acceptance-author agent was used. The build contract written by the coordinator defined the checks, the component tree and the budgets | Follows from V-1: there was no owner session at which to approve a spec | Coordinator. D-22 |
| V-3 | The owner clicks about forty points, giving hold-out landmarks no builder has touched and a measure of how far the agent's picks are from a person's | No owner clicks. Points were picked by the measurement agent and checked by geometric residuals | Follows from V-1 | Coordinator. D-22 |
| V-4 | From stage A on, agents see only masked working copies (people, screen content, customer names masked; location data removed); the owner marks the regions | Agents worked on unmasked working copies kept in the private folder. Masked copies were made for every image published in the wiki | The owner answered "confidentiality is no concern". Masking was kept for publication because the production site is public | Owner (answer); coordinator (keeping it for publication). D-21, D-36 |
| V-5 | The builder is one agent working through the components in order of risk, seat first. Parallel builders were deferred to a later asset | Three modellers in parallel, one per component group: seat; pods with joysticks, controls and touchscreen; platform, stand, monitor and pedals. An infrastructure agent first built the generator, viewer, checks and a blockout; a measurement agent produced the cameras and the dimension table | Pace. The groups could be separated by file ownership under one shared contract | Coordinator. D-26 |
| V-6 | A six-file Skill draft is written before modelling and corrected afterwards | The Skill was written after the build, extracted from what was used. During the build a build brief served as the working guidance | The plan's own principle (rig first, toolkit afterwards) applied one step further | Coordinator. D-28 |
| V-7 | Generator and viewer in TypeScript | The first viewer was a JavaScript page with no build step, as the viewer research had recommended. After the owner asked "why is viewer.js a js and not ts" it was converted to TypeScript, and the code that turns a joint value into a part's position is shared with the generator | The owner's question | Coordinator, after the owner's question. D-29 |
| V-8 | A viewer with a part tree, sliders generated from the joints, reference frames, measuring and photo-matched views | The first viewer had a separate slider per joint (for example monitor height, tilt and pan). The owner found it "overcomplicated". Two independent interface reviewers (one on interaction design, one walking through as a first-time user) proposed reducing 103 controls to 19, enlarging the 3D view from 58 % to 82 % of the window, one card for the selected part, two-axis pads in place of separate sliders, and direct manipulation. A separate implementer rebuilt the interface | The owner's request | Owner (direction); coordinator (how). D-30 |
| V-9 | Motions that are only assumed (seat slide, swivel, height, tilt, recline; pedal tray) are locked | They stay marked as assumed in the asset, but in the viewer they can be used, tagged "assumed range" | The owner: "the lock is confusing for users unless there is a way to unlock" | Owner. D-31 |
| V-10 | No measured value existed. The scale was to be closed on purchased parts, ideally with one confirmed number from the client. Tape values were to stay sealed until the prediction table was frozen | The owner gave three figures with the approval. The deck width (1.50 m) was used as the one scale input; the scale then closed within 0–2 %. The other figures conflicted with the photos (deck about 1.41 m long; seat back 1.28 m above the deck, not 1.4); the photo values were modelled and the owner's figures recorded as conflicting evidence | The figures arrived unsealed and before any freeze, so they could not serve as a blind test. One was needed to close the scale | Coordinator, on the measurement results. D-24. **The owner should confirm** |
| V-11 | Version control and a commit guard from the start of stage A | Version control was started only at the end, after the build | So that no branch prompt interrupted the parallel build | Coordinator. D-33 |
| V-12 | The plan stopped at a local viewer and a feasibility report | A wiki inside the repository, a private GitHub repository and a public deployment of viewer and wiki were added | The owner's implementation request | Owner. D-32, D-33 |
| V-13 | Project name to be chosen from Tilpass, Greifraum, Operatorium or `hfe-workbench`; a folder that does not sync to a cloud drive | `rigtwin`, in the Documents folder (which is not cloud-synced on this machine) | The owner rejected the shortlist | Owner. D-23 |

## Added to the plan, not changed in it

These were not in the approved plan and do not contradict it.

| Addition | Reason | Decided by |
|---|---|---|
| A coverage check, an `omitted` list on every image sheet, and a left/right counterpart check | The trial model shown in the plan lacked the left joystick. Cause: the coordinator's brief for the trial named only the right pod, the figures did not list omissions, and nothing compared the model with the component tree | Coordinator, after the owner's report. D-25 |
| A performance budget: at most 150,000 triangles, 4 MB and 80 draw calls; a build well under 5 s | The owner asked for good viewing and modelling performance | Coordinator. D-27 |
| A banned-word check on every run | The owner asked that the rig maker's name not appear in the repository | Owner. D-35 |
| A timeline file to which every agent appends timed steps, and milestone images kept at every visible stage | The owner asked for performance data and screenshots during modelling in the wiki | Coordinator |

## Parts of the plan this run did not carry out

Listed so that later work does not assume they exist. "Not established" means the sources available
to this page do not say; check the pages under `40-method/`, `50-implementation/` and
[../70-results/goal-assessment.md](../70-results/goal-assessment.md).

| Plan element | In this run |
|---|---|
| Acceptance spec by a separate author, approved and locked | Not done (V-2) |
| Hold-out landmarks clicked by the owner | Not done (V-3) |
| Look sample judged by the owner before the rest is built | Not done as a gate (V-1) |
| Gate 1 and Gate 2 | Replaced by reviewer rounds (V-1) |
| Reviewer tested with planted errors of known size before its reviews count | Not established |
| Reviewer isolated in a packet outside the repository, in three sealed steps | Not established. The round-1 reviewer states that it made its own renders, used its own model-file reader and did not read the builders' notes |
| Frozen, dated prediction table scored against sealed tape values | No sealed tape values exist; the owner's figures arrived open (V-10) |
| The three re-adjustability drills (change parameters, enter a measured value, swap the monitor record) | Not established |
| Stage E: a second object built by a fresh session from the template, against sealed tape values | Not done. The Skill therefore remains version 0.x by the plan's own rule |
| Measurement sheet and evidence requests sent to the client | Not established; outside the agents' reach |
| Bulk output of reference frames for many poses, and per-component mesh export | Not established |

## What the deviations cost in evidence

*Judgment of this page's author, from the plan's own reasoning.* The plan's reviewers found that
draft 2 was "self-certifying": the builder wrote its own tests. Version 3 answered with the
acceptance author, the owner's clicks and the gates. This run removed those again (V-1 to V-3) and
put a ruthless reviewer in their place. A reviewer catches what it can see in renders and photos;
the plan itself says an AI model's eye cannot be trusted with sizes, distances or differences under
roughly 10 %. So the result of this run can support "structure and looks reviewed independently",
but not "sizes verified". That matches the plan's own category "sizes: unverified".

## Time against the plan's estimate

The plan estimated 21–33 agent-hours for stages A to D. The implementation agents recorded when this
page was first written (13 rows: photo masking, infrastructure, measurement, three modellers in two
rounds, two interface reviews, one review round, the interface implementer) total 383 agent-minutes,
about 6.4 agent-hours of work, much of it in parallel. That figure is incomplete: later agents and
the coordinator's own time are not in it. The final figures are on the performance pages under
`50-implementation/`.

## Added after this page was first written

*This section is reserved for the coordinator. Add later deviations here with the date, the reason
and who decided, using the next free number (V-14 onward). Do not renumber the rows above.*

| # | Date | The plan said | What was done | Reason | Decided by |
|---|---|---|---|---|---|
| | | | | | |
