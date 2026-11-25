---
title: Goal assessment
tldr: Of the first 69 requirements, 55 are met, 11 partly, none not met and 3 not yet done (GitHub and the production wiki). The run shows a credible, modular, parametric, articulated model built from casual photos by AI agents, with honest provenance; it does not show that the sizes are right or that the Skill transfers to another object.
status: living
updated: 2026-11-25
tags: [results, assessment, requirements]
---

# Goal assessment

## TL;DR

- **Requirements R-01 to R-69: 55 met, 11 partly, 0 not met, 3 not yet.** The three "not yet" are the GitHub project and its private push, and the wiki on the production server; they come after this page. The deployment pipeline exists but has not yet published.
- **R-70 and R-71 (2026-11-25), the new name and workspaces:** both met; see [their rows](#n-the-new-name-and-workspaces).
- **Achieved, on the evidence:** a model of Rig B that two independent reviewer agents judged credible ("no longer a toy in any view"), modular (46 parts, any of them hideable), parametric (305 numbers with source and range, re-measurable without code changes), articulated (20 joints, collision-free at their limits), built from eleven casual photos by AI agents, viewable in a browser, by a method that is written down.
- **Not achieved, or not shown:** that the sizes are right (nothing taped; the owner's three figures conflict with the photos); that the Skill works for another object; what the planned human controls (gates, hold-out clicks, a locked acceptance specification, a tested reviewer) would have found.
- The partly met requirements cluster around **later use** (assessment, simulator, reach against seat position) and **reuse** (the Skill), not around the model itself.
- This is the only page that judges the requirements; the requirements themselves are on [requirements](../10-request/requirements.md). Weaknesses are argued on the [critique](critique.md) page.

## How the verdicts are given

| Verdict | Meaning |
|---|---|
| **met** | the evidence shows the requirement is satisfied as written |
| **partly** | some of it is satisfied; the row says which part is missing |
| **not met** | tried and failed, or decided against |
| **not yet** | not done at the time of writing, still planned |

Evidence is a wiki page, an image, a check (`C-` IDs on the [checks page](../40-method/checks.md)) or a
decision (`D-`). How each piece is known is said where it matters: *tested* (run on the machine),
*measured*, *judgment*, *not verified*. Numbers are from the final build `0b6d8248b63f` of
2026-11-23.

## Requirement by requirement

### A. Purpose and scope

| ID | Verdict | Evidence |
|---|---|---|
| [R-01](../10-request/requirements.md#r-01) | partly | The modelling part of the environment was built and run end to end ([pipeline](../40-method/pipeline.md)); evaluating and live testing were assessed on paper only ([approved plan §3.11](../30-plan/approved-plan.md#311-the-wider-environment)): a digital human layer and a simulator binding still have to be built |
| [R-02](../10-request/requirements.md#r-02) | met | The whole run was about building a custom 3D asset ([modelling rounds](../50-implementation/modeling-rounds.md)) |
| [R-03](../10-request/requirements.md#r-03) | met | Round-2 verdict "accepted after the listed fixes", fixes made in round 3 ([modelling rounds](../50-implementation/modeling-rounds.md#round-3-the-final-fixes)); sources were the eleven photos plus public makers' data ([D-19](../20-decisions/decision-log.md#d-19)). Credibility is the *judgment* of two reviewer agents; no person has judged the likeness yet |
| [R-04](../10-request/requirements.md#r-04) | met | Only the white rig with joysticks is modelled; room, van and machines are not ([model card](rig-b-model-card.md#reference-configuration-and-what-was-borrowed)) |
| [R-05](../10-request/requirements.md#r-05) | met | Reference frames for seat, eyes, grips, pedals and emergency stop; screens as separate surfaces; signal names on the seven controls; the "not assessable" rule ([asset contract](../40-method/asset-contract.md), [decomposition](../40-method/decomposition.md)) |
| [R-06](../10-request/requirements.md#r-06) | partly | Skill 0.1.0, three agent definitions and the toolkit exist as a template ([skills and agents](../80-reference/skills-and-agents.md)); not yet used on a second asset ([I-05](../60-lessons/ideas.md#i-05)) |

### B. The asset

| ID | Verdict | Evidence |
|---|---|---|
| [R-07](../10-request/requirements.md#r-07) | met | Answer given and demonstrated: yes for structure, motion and recognisable form; sizes only as estimates with ranges ([approved plan](../30-plan/approved-plan.md#1-verdict-and-limits), [model card](rig-b-model-card.md)) |
| [R-08](../10-request/requirements.md#r-08) | met | Every one of 305 numbers states its class: 179 assumed and 21 invented are labelled as such; the critical assumed values are listed ([model card](rig-b-model-card.md#parameters), C-03) |
| [R-09](../10-request/requirements.md#r-09) | met | A record in `measured.toml` replaces an estimate with no code change (*tested* on a scratch copy, [filling gaps](../40-method/filling-gaps.md#overriding-with-a-real-measurement)); procedure on the [model card](rig-b-model-card.md#updating-the-model-when-tape-measurements-arrive). The plan's drills were not run as drills ([I-18](../60-lessons/ideas.md#i-18)) |
| [R-10](../10-request/requirements.md#r-10) | met | One structural tree with functional tags: 46 parts in 5 groups, 20 joints, 14 reference frames ([decomposition](../40-method/decomposition.md)); coverage and motion *tested* on every build (C-08, C-12) |
| [R-11](../10-request/requirements.md#r-11) | partly | Seat references, eye points, grip points, pedal faces and adjustments exist; but the seat adjustments are assumed, on this rig the joysticks ride with the seat, and no assessment code exists ([critique](critique.md#the-model), [I-09](../60-lessons/ideas.md#i-09)) |
| [R-12](../10-request/requirements.md#r-12) | partly | A standard GLB with signal names and screen surfaces; read only by the project's three.js viewer so far; no binding to real controls ([I-11](../60-lessons/ideas.md#i-11)) |
| [R-13](../10-request/requirements.md#r-13) | met | One GLB plus one JSON description file tied by the GLB's fingerprint ([D-05](../20-decisions/decision-log.md#d-05), [asset contract](../40-method/asset-contract.md)) |

### C. Sources, gap filling and the route from photo to model

| ID | Verdict | Evidence |
|---|---|---|
| [R-14](../10-request/requirements.md#r-14) | met | [Pipeline](../40-method/pipeline.md), [measuring from photos](../40-method/measuring-from-photos.md); the 3D structure is generated by code from parameters with a small shape kit ([D-01](../20-decisions/decision-log.md#d-01)) |
| [R-15](../10-request/requirements.md#r-15) | met | Decided and justified: no isolation; the background fixes the cameras ([D-06](../20-decisions/decision-log.md#d-06)) |
| [R-16](../10-request/requirements.md#r-16) | met | Nine-rank source hierarchy, classes and ranges enforced by the loader ([filling gaps](../40-method/filling-gaps.md)); several rules are conventions, not enforced ([critique](critique.md#the-method)) |
| [R-17](../10-request/requirements.md#r-17) | met | [Measuring from photos](../40-method/measuring-from-photos.md), [measurement results](../50-implementation/measurement-results.md): scale closure 0–2 %, 118 dimension records with classes |
| [R-18](../10-request/requirements.md#r-18) | met | Evidence levels E1–E7, mount frames, joint records, pivots on physical axes ([decomposition](../40-method/decomposition.md)) |
| [R-19](../10-request/requirements.md#r-19) | met | Quality: accepted by the round-2 reviewer. Simplicity: six pinned npm packages, one library in the browser, build 0.2 s ([tech stack](../50-implementation/tech-stack.md)). *Judgment* |

### D. Tooling constraints

| ID | Verdict | Evidence |
|---|---|---|
| [R-20](../10-request/requirements.md#r-20) | met | Decided and justified: Blender not installed ([D-04](../20-decisions/decision-log.md#d-04), [options considered](../20-decisions/options-considered.md)) |
| [R-21](../10-request/requirements.md#r-21) | met | Generated natively in TypeScript with three.js; Python standard library for the independent reader ([D-03](../20-decisions/decision-log.md#d-03)) |
| [R-22](../10-request/requirements.md#r-22) | met | All software MIT or Apache-2.0 ([tech stack](../50-implementation/tech-stack.md)). The AI agents themselves are a commercial service, which the requirement did not address |
| [R-23](../10-request/requirements.md#r-23) | met | Six pinned npm packages (fifteen installed), three.js the only library in the browser; the measurement environment stayed in the private working folder ([tech stack](../50-implementation/tech-stack.md)) |
| [R-24](../10-request/requirements.md#r-24) | met | Accepted model at 28,070 triangles with a 0.2 s build and no 3D authoring tool. *Judgment* |

### E. The agent process

| ID | Verdict | Evidence |
|---|---|---|
| [R-25](../10-request/requirements.md#r-25) | met | Decomposition first, as a hypothesis the blockout tests ([D-09](../20-decisions/decision-log.md#d-09)) |
| [R-26](../10-request/requirements.md#r-26) | met | Modellers per group under a build brief and a shared contract ([agent process](../40-method/agent-process.md)) |
| [R-27](../10-request/requirements.md#r-27) | met | The builder's loop, eight steps, at most three iterations per component and level ([approved plan §3.9](../30-plan/approved-plan.md#39-the-agent-process), Skill) |
| [R-28](../10-request/requirements.md#r-28) | met | No live watcher; scripted checks on every build and an independent reviewer that never reads the builders' notes ([D-14](../20-decisions/decision-log.md#d-14), [P-15](../60-lessons/patterns.md#p-15)). Its detection threshold is untested ([I-01](../60-lessons/ideas.md#i-01)) |
| [R-29](../10-request/requirements.md#r-29) | met | Blockout, then three rounds with review between them ([modelling rounds](../50-implementation/modeling-rounds.md)) |
| [R-30](../10-request/requirements.md#r-30) | met | Round 1: 27–41 min per modeller; round 2: 13–15 min; round 3: 17 min; tools 0.2–5 s per step ([timeline and performance](../50-implementation/timeline-and-performance.md)). Approach judged in the plan and borne out. *Judgment* |
| [R-31](../10-request/requirements.md#r-31) | met | One renderer for agents and people, photo-matched views, contact sheets, checks ([P-11](../60-lessons/patterns.md#p-11), [gallery](gallery.md#10-the-model-against-the-photos)) |
| [R-32](../10-request/requirements.md#r-32) | partly | Defined in the plan (a status script against a locked acceptance specification); in this run "finished" was the reviewer's verdict plus the coordinator's checks, because the specification was not written ([deviations](../30-plan/deviations.md)) |
| [R-33](../10-request/requirements.md#r-33) | met | 20 checks on every build, 53 on the viewer ([checks](../40-method/checks.md)); timeline, milestone images, this wiki |

### F. The Skill

| ID | Verdict | Evidence |
|---|---|---|
| [R-34](../10-request/requirements.md#r-34) | met | `modeling-3d-assets-from-references` 0.1.0 with invariants, sequence, builder's loop, stop rules, references and a playbook ([skills and agents](../80-reference/skills-and-agents.md)) |
| [R-35](../10-request/requirements.md#r-35) | partly | A refinement rule and changelog exist; reuse and quality are untested until a fresh agent builds a second object with it ([I-05](../60-lessons/ideas.md#i-05)) |

### G. The viewer

| ID | Verdict | Evidence |
|---|---|---|
| [R-36](../10-request/requirements.md#r-36) | met | Static three.js page; 53 of 53 acceptance checks (one a skip); 60 fps ([viewer](../50-implementation/viewer.md)) |
| [R-37](../10-request/requirements.md#r-37) | met | Checked; practices reused, code not ([D-20](../20-decisions/decision-log.md#d-20)) |

### H. Project set-up

| ID | Verdict | Evidence |
|---|---|---|
| [R-38](../10-request/requirements.md#r-38) | not yet | The project is set up for GitHub (private by decision [D-33](../20-decisions/decision-log.md#d-33)); the push is the coordinator's last step. See [pending items](#pending-items) |
| [R-39](../10-request/requirements.md#r-39) | met | Names suggested twice; the owner chose a first name ([D-23](../20-decisions/decision-log.md#d-23)), replaced by Synergon on 2026-11-25 ([D-56](../20-decisions/decision-log.md#d-56)) |
| [R-40](../10-request/requirements.md#r-40) | met | `~/Documents/synergon`, not cloud-synced ([D-23](../20-decisions/decision-log.md#d-23)) |

### I. The planning process itself

| ID | Verdict | Evidence |
|---|---|---|
| [R-41](../10-request/requirements.md#r-41) | met | Eight specialist agents in the investigation ([approved plan §9](../30-plan/approved-plan.md#9-how-the-plan-was-made)) |
| [R-42](../10-request/requirements.md#r-42) | met | An owner's-advocate agent critiqued draft 1 ([P-02](../60-lessons/patterns.md#p-02)) |
| [R-43](../10-request/requirements.md#r-43) | met | A simplicity monitor counted about 325 named things in draft 1 and found about a quarter removable ([P-02](../60-lessons/patterns.md#p-02)) |
| [R-44](../10-request/requirements.md#r-44) | met | Version 3 of the plan, approved ([approved plan](../30-plan/approved-plan.md)) |
| [R-45](../10-request/requirements.md#r-45) | met | Five fresh adversarial reviewers (92 blocker and major findings, none approved draft 2) and a closure check ([sources](../80-reference/sources.md)) |
| [R-46](../10-request/requirements.md#r-46) | met | Plan presented with choices, uncertainties and eight questions; approved ("Plan approved") |
| [R-47](../10-request/requirements.md#r-47) | partly | Eight questions were put with the plan; two were answered. During the autonomous build the coordinator ruled on conflicts itself (for example [D-24](../20-decisions/decision-log.md#d-24)) and lists them for the owner instead of stopping to ask; the open questions are on [next steps](../90-next/next-steps.md) |

### J. The implementation request

| ID | Verdict | Evidence |
|---|---|---|
| [R-48](../10-request/requirements.md#r-48) | met | Cause found (the trial brief named only the right pod; nothing compared the model with the tree); guards: coverage check C-08, left/right check C-09, omitted lists on every sheet ([F-01](../60-lessons/failures-and-fixes.md#f-01), [D-25](../20-decisions/decision-log.md#d-25)) |
| [R-49](../10-request/requirements.md#r-49) | partly | The deck width (1.5 m) is the scale of the whole model; the other two figures and the deck length conflict with the photos and are recorded but not modelled; the room figures served only as a check ([D-24](../20-decisions/decision-log.md#d-24), [model card](rig-b-model-card.md#the-owners-three-figures-against-the-photos)) |
| [R-50](../10-request/requirements.md#r-50) | met | Photos → cameras and dimension table → blockout → three modelling rounds with two reviews → viewer → wiki, in one run ([pipeline](../40-method/pipeline.md)) |
| [R-51](../10-request/requirements.md#r-51) | met | Rotate, zoom, pan in the viewer, *tested* by acceptance checks T19 and T22; quality accepted by the round-2 reviewer; the coordinator's notes record a hand check of the final build in a browser (local server, 1440 × 900: loads, orbit and zoom, hide a group, drag the right joystick). Final verification of the published build: see [pending items](#pending-items) |
| [R-52](../10-request/requirements.md#r-52) | met | Every part and group can be hidden, shown alone and shown again (acceptance checks T12–T16, T18; [gallery](gallery.md#after)) |
| [R-53](../10-request/requirements.md#r-53) | met | Checks on every build; round 1 failed review, causes found (wrong kind of shape, rigid parts, exposure, triangle distribution), process and briefs changed, round 2 passed ([F-18](../60-lessons/failures-and-fixes.md#f-18) to [F-22](../60-lessons/failures-and-fixes.md#f-22)) |
| [R-54](../10-request/requirements.md#r-54) | met | Two fresh reviewers; round 1 rejected 8 of 45 parts as toy-grade; round 2 accepted after three fixes ([modelling rounds](../50-implementation/modeling-rounds.md)) |
| [R-55](../10-request/requirements.md#r-55) | partly | Credible: yes, by the reviewers' judgment. Usable for evaluation: not yet, because sizes are untaped and seat adjustments assumed ([model card, not qualified for](rig-b-model-card.md#not-qualified-for)). Usable for training: the asset is ready to bind, the simulator is not built |
| [R-56](../10-request/requirements.md#r-56) | met | 28,070 triangles of 150,000, 0.72 of 4 MB, 67 of 80 draw primitives (C-14); round-2 reviewer: "Nothing to remove" |

### K. The wiki

| ID | Verdict | Evidence |
|---|---|---|
| [R-57](../10-request/requirements.md#r-57) | partly | Every part the owner listed has a page: request, requirements, options, plan, stack, process, implementation with timings, lessons, the result with critique, this justification, next steps ([index](../index.md)). Final entries (deployment facts, the log's last lines) are left to the coordinator |
| [R-58](../10-request/requirements.md#r-58) | met | Sections by question, front matter and TL;DR on every page, stable IDs, a generated index and a lint ([README](../README.md)). Readability for the intended reader is untested |
| [R-59](../10-request/requirements.md#r-59) | met | Masked source photos, every modelling stage and the viewer before and after ([gallery](gallery.md)) |
| [R-60](../10-request/requirements.md#r-60) | met | 54 lessons, 31 failures, 22 patterns, 24 ideas, each with a summary ([lessons learned](../60-lessons/lessons-learned.md)) |
| [R-61](../10-request/requirements.md#r-61) | met | The wiki is the `wiki/` folder of the repository |

### L. GitHub and deployment

| ID | Verdict | Evidence |
|---|---|---|
| [R-62](../10-request/requirements.md#r-62) | not yet | Private repository decided ([D-33](../20-decisions/decision-log.md#d-33)); push pending. See [pending items](#pending-items) |
| [R-63](../10-request/requirements.md#r-63) | met | Banned-word check C-15 on every run: 317 files scanned outside the private folders, names and image bytes included, none found (2026-11-23) |
| [R-64](../10-request/requirements.md#r-64) | partly | Pipeline built: `bun run deploy` with dry run, checks, dated releases, atomic switch, live verification and rollback ([deployment](../50-implementation/deployment.md)); a dry run was made. Publishing to the production address is pending. See [pending items](#pending-items) |
| [R-65](../10-request/requirements.md#r-65) | not yet | The deploy step builds the wiki into the same release under `/wiki`; not yet published. See [pending items](#pending-items) |

### M. Later requests, during the build

| ID | Verdict | Evidence |
|---|---|---|
| [R-66](../10-request/requirements.md#r-66) | met | A first name chosen by the owner ([D-23](../20-decisions/decision-log.md#d-23)); replaced by Synergon on 2026-11-25 ([D-56](../20-decisions/decision-log.md#d-56)) |
| [R-67](../10-request/requirements.md#r-67) | met | Viewer in TypeScript, pose code shared with the generator ([D-29](../20-decisions/decision-log.md#d-29)); type check C-01 on every run |
| [R-68](../10-request/requirements.md#r-68) | met | Two independent UX reviews, a separate implementer; 103 controls → 16, model 58 % → 82.8 % of the window, one card per part ([viewer](../50-implementation/viewer.md#the-redesign)) |
| [R-69](../10-request/requirements.md#r-69) | met | Seat adjustments usable, tagged "assumed range", with a notice and a way back; no lock ([D-31](../20-decisions/decision-log.md#d-31), acceptance checks T31–T37) |

### N. The new name and workspaces

| ID | Verdict | Evidence |
|---|---|---|
| [R-70](../10-request/requirements.md#r-70) | met | Every current file renamed, and `bun run check` scans for the first name so it cannot come back ([D-56](../20-decisions/decision-log.md#d-56)); live at synergon.mightwork.ai since 2026-11-25; the earlier address answers 404 and its service, account and folders are removed from the host (archived on the owner's machine first); the repository is `michaelhil/synergon`. Left: the local folder names on the owner's machine, renamed after the session that made the move |
| [R-71](../10-request/requirements.md#r-71) | met | Live since 2026-11-25 ([D-57](../20-decisions/decision-log.md#d-57), [workspaces on the server](../50-implementation/workspaces.md), [the viewer's pages](../50-implementation/viewer.md#workspaces-on-the-page)) |

### Tally

| Group | met | partly | not met | not yet |
|---|---|---|---|---|
| A. Purpose and scope (R-01–R-06) | 4 | 2 | 0 | 0 |
| B. The asset (R-07–R-13) | 5 | 2 | 0 | 0 |
| C. Sources and route (R-14–R-19) | 6 | 0 | 0 | 0 |
| D. Tooling (R-20–R-24) | 5 | 0 | 0 | 0 |
| E. Agent process (R-25–R-33) | 8 | 1 | 0 | 0 |
| F. The Skill (R-34–R-35) | 1 | 1 | 0 | 0 |
| G. The viewer (R-36–R-37) | 2 | 0 | 0 | 0 |
| H. Project set-up (R-38–R-40) | 2 | 0 | 0 | 1 |
| I. Planning (R-41–R-47) | 6 | 1 | 0 | 0 |
| J. Implementation (R-48–R-56) | 7 | 2 | 0 | 0 |
| K. Wiki (R-57–R-61) | 4 | 1 | 0 | 0 |
| L. GitHub and deployment (R-62–R-65) | 1 | 1 | 0 | 2 |
| M. Later requests (R-66–R-69) | 4 | 0 | 0 | 0 |
| N. The new name and workspaces (R-70–R-71) | 2 | 0 | 0 | 0 |
| **All 71** | **57** | **11** | **0** | **3** |

## System features

The 25 system features are what the system must contain ([requirements](../10-request/requirements.md#system-features-derived-from-the-requirements)).

| ID | Verdict | Evidence |
|---|---|---|
| [SF-01](../10-request/requirements.md#sf-01) | met | 305 complete records; loader refuses incomplete ones (C-03) |
| [SF-02](../10-request/requirements.md#sf-02) | met | `measured.toml` override, *tested* on a scratch copy; the estimate stays in its file |
| [SF-03](../10-request/requirements.md#sf-03) | met | Same inputs, same bytes (C-05); kit tests (C-02) |
| [SF-04](../10-request/requirements.md#sf-04) | met | GLB plus description file with the GLB's SHA-256 |
| [SF-05](../10-request/requirements.md#sf-05) | met | 89 named nodes, names checked (C-07) |
| [SF-06](../10-request/requirements.md#sf-06) | met | 20 joints with all fields; signal names on 7 controls |
| [SF-07](../10-request/requirements.md#sf-07) | met | 14 reference frames and 2 screen surfaces built from parameters |
| [SF-08](../10-request/requirements.md#sf-08) | met | Design parameters, 13 adjustments, 7 controls kept apart |
| [SF-09](../10-request/requirements.md#sf-09) | met | Cameras from metadata, solved per rig, gauge features, scale closure, classes ([measuring from photos](../40-method/measuring-from-photos.md)) |
| [SF-10](../10-request/requirements.md#sf-10) | met | Nine-rank hierarchy, class travels with the value |
| [SF-11](../10-request/requirements.md#sf-11) | partly | Parent link, mount frame and joint record with evidence level for every attachment; the observation that would disprove a connection is written only for the uncertain ones, on the [decomposition](../40-method/decomposition.md#uncertain-connections-and-what-would-settle-them) page, not per record |
| [SF-12](../10-request/requirements.md#sf-12) | met | Photo-matched views for five photos; projection self-test C-17 ([gallery](gallery.md#10-the-model-against-the-photos)) |
| [SF-13](../10-request/requirements.md#sf-13) | met | The viewer page, driven headless, made every render ([P-11](../60-lessons/patterns.md#p-11)) |
| [SF-14](../10-request/requirements.md#sf-14) | met | C-03 to C-15 cover every item listed |
| [SF-15](../10-request/requirements.md#sf-15) | met | C-08: 69 tree nodes present, 0 omitted |
| [SF-16](../10-request/requirements.md#sf-16) | met | Used by the modellers in rounds 1–3 ([modelling rounds](../50-implementation/modeling-rounds.md)) |
| [SF-17](../10-request/requirements.md#sf-17) | met | Two reviews by fresh agents with their own renders and readers; not tested with planted errors |
| [SF-18](../10-request/requirements.md#sf-18) | met | [Viewer](../50-implementation/viewer.md); exposure corrected after review |
| [SF-19](../10-request/requirements.md#sf-19) | met | Acceptance checks T12–T18 |
| [SF-20](../10-request/requirements.md#sf-20) | met | Cards generated from the joints; assumed adjustments usable and marked |
| [SF-21](../10-request/requirements.md#sf-21) | met | 28,070 / 150,000 triangles, 0.72 / 4 MB, 67 / 80 primitives, build 0.2 s (C-14) |
| [SF-22](../10-request/requirements.md#sf-22) | partly | Skill, reviewer definition, toolkit and viewer exist; never used to start a new asset |
| [SF-23](../10-request/requirements.md#sf-23) | met | This wiki, its generated index, the log and the timeline |
| [SF-24](../10-request/requirements.md#sf-24) | met | Photos and their pixels stay in private folders; published photos masked; C-15 |
| [SF-25](../10-request/requirements.md#sf-25) | partly | `bun run deploy` built and dry-run; not yet published |

System features: 22 met, 3 partly, 0 not met, 0 not yet.

## Was the goal achieved?

### What the proof of concept set out to show

The owner's first step was "a credible 3D model of that rig, using just the pictures", decomposed so it
can be re-measured, moved and assessed later, made by AI agents in a way that can be repeated for other
assets ([original request](../10-request/original-request.md)). Taken apart, the claim to test was:
**a credible, modular, parametric, articulated model can be built from casual photos by AI agents,
with honest provenance, viewable in a browser, through a documented, reusable method.**

### Where the evidence supports "achieved"

| Part of the claim | Evidence | Strength |
|---|---|---|
| **Credible** | A fresh reviewer rejected round 1 ("a credible layout carrying a few toy-grade parts"); another fresh reviewer accepted round 2 after three small fixes, which were made: 41 of 46 parts accepted outright, none rejected; outlines over the three Rig B photos fit "within a few centimetres" | *judgment* of two independent agents with their own renders and geometry scripts; the reviewer's threshold is untested and no person has judged it |
| **Modular** | 46 parts in 5 groups under one tree, each named, each hideable and selectable; coverage and naming checked on every build | *tested* (C-07, C-08, acceptance checks) |
| **Parametric** | 305 records; geometry and mount frames are expressions over them; a tape value replaces an estimate with no code change | *tested* (C-03, C-16, override on a scratch copy) |
| **Articulated** | 20 joints with type, axis, limits, kind and evidence; each moves exactly the expected parts; every joint at both limits without tearing or collision | *tested* (C-12, C-13) and the round-2 reviewer's collision scripts |
| **From casual photos, by AI agents** | Eleven phone photos, no tape; every step from camera solving to the final fixes done by agents; the owner gave direction, figures and four corrections | the record of the run ([agent process](../40-method/agent-process.md)) |
| **Honest provenance** | Every number carries class, range and evidence; 179 assumed and 21 invented values are labelled; the owner's conflicting figures are recorded, not hidden; the viewer colours parts by certainty and marks assumed motions | *tested* by the loader; visible in the viewer |
| **Viewable in a browser** | A static page, 60 fps on the build machine, 16 controls, 53 acceptance checks | *tested* on one machine; production *not yet* |
| **Documented method** | Pipeline, measuring, gap filling, decomposition, contract, agent process and checks written up; 54 lessons and 31 failures with guards | this wiki |

On those eight parts the proof of concept is **achieved**: each is shown by a test or an independent
judgment, not only by the builders' account.

### Where it is not

- **Accuracy is unverified.** No dimension has been checked against a tape, and depth along the main
  photos' line of sight cannot be checked from these photos at all. All three of the owner's figures
  conflict with the photo values. Under the plan's own scale ("verified", "ranges too narrow", or
  "unverified") the sizes are **unverified**, which the plan named as a legitimate outcome. Until a tape
  session the model must not be used for the purposes on its
  [not-qualified-for list](rig-b-model-card.md#not-qualified-for).
- **Reusability is unproven.** The method is written down and a Skill exists, but no fresh agent has
  built a second, different object with it. By the plan's rule the Skill stays at 0.x until that is
  done against sealed tape values ([I-05](../60-lessons/ideas.md#i-05)).
- **The planned human controls were not exercised.** The owner asked for an autonomous run, so the
  gates, the owner's hold-out clicks, a separately written and locked acceptance specification and the
  planted-error test of the reviewer did not happen ([deviations](../30-plan/deviations.md)). Their
  absence weakens "credible" from "confirmed by a person who knows the rig" to "judged by two
  independent agents".
- **Later use is prepared, not demonstrated.** The asset carries what assessment and simulation need
  (frames, signal names, screen surfaces, ranges, a "not assessable" tag), but no assessment or
  simulator code exists, and on this rig the owner's own example (reach against seat position) is
  degenerate, because the joysticks ride with the seat and the seat's motions are assumed.

### Verdict

**The feasibility question is answered "yes" for the model and the method that made it; "not yet
known" for its accuracy and for the method's transfer to another object.** The next steps that would
close the gap are, in order: a tape session with the owner's questions answered, the planted-error test
of the reviewer, and a second object built from the Skill against sealed tape values
([next steps](../90-next/next-steps.md)).

## Pending items

Completed by the coordinator on 2026-11-23. With these three items done, the rows R-38, R-51, R-62, R-64 and R-65 above are met as far as they concern verification, publication and deployment.

**Final browser verification** (coordinator, 2026-11-23, about 21:55 local time, the in-app Chromium browser at 1440 × 900, local server, build `0b6d8248b63f`): the model loads with no errors; rotate and zoom work; hiding the *Monitor stand* group hides its 7 parts and shows "7 parts hidden · Show all"; clicking the right joystick opens its card with one two-axis "Push the stick" pad; dragging the pad deflects the stick (14.6° forward, 9.7° sideways) and the address updates so the view can be shared. Earlier in the same session on the redesigned viewer: the monitor card (height slider and one turn-and-tilt pad) and sliding the seat 8.8 cm back with the "assumed range" notice. The deployed copy is checked again after deployment (below). Result: passed.

**GitHub push**: private repository (named <https://github.com/michaelhil/synergon> from the cutover), first commit `5d673d1` on `main`, 2026-11-23 about 22:20 local time; checked before pushing: nothing from `private/`, `work/` or `dist/`, no unmasked photograph, no personal path or address, banned-word check clean.

**Production deployment**: the live site, viewer and wiki, first release `20261123T212137Z-5d673d1`; all nine live checks passed (model size and SHA-256 included); private paths return 404; the coordinator loaded the live viewer and wiki in a browser with no errors. Details in [deployment](../50-implementation/deployment.md#production-state).
