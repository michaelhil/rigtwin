---
title: Decision log
tldr: 36 decisions, D-01 to D-36, in the order they were taken on 2026-11-23, each with context, alternatives, reason, who decided, status and consequences. D-01 to D-20 come from the approved plan; D-21 to D-36 were taken after approval, by the owner or by the coordinator during the build.
status: living
updated: 2026-11-23
tags: [decisions, log]
---

# Decision log

## TL;DR

- The plan's core decisions (D-01 to D-20) held through the build: parametric code as the route, text parameters as the source, TypeScript with three.js, a GLB plus a description file, no Blender, no live monitoring agent.
- The owner took seven decisions after approval: internal test and no confidentiality concern (D-21), a full autonomous run (D-22), the name (D-23), usable assumed adjustments (D-31), the public addresses (D-32), a private repository (D-33) and the ban on the rig maker's name (D-35).
- The most consequential later ruling is D-24: where the photographs disagree with the owner's three scale figures, the photo value is modelled and the owner's figure is recorded as conflicting evidence. A tape measure must settle it.
- Four plan decisions were changed in execution: human gates (D-14 → D-22), masking (D-18 → D-21), serial modelling (→ D-26) and locked assumed motions in the viewer (D-10 → D-31).
- New decisions get the next free number. To retire one, mark it "superseded by D-xx"; never delete or renumber.

## How to read an entry

- **Decided by** is one of: *owner*; *coordinator* (the AI agent that ran the project and wrote the plan); *plan* (coordinator's decision inside the plan, approved by the owner with the words "Plan approved"); *review finding* (forced by one of the reviews summarised in [../80-reference/sources.md](../80-reference/sources.md)).
- The plan itself lists seven decisions as D1 to D7. They map to this log as: D1 → D-01, D2 → D-03, D3 → D-04, D4 → D-14, D5 → D-15, D6 → D-10, D7 → D-16.
- All dates are 2026-11-23. "Before approval" and "after approval" give the order.
- Breadth behind each decision: [options-considered.md](options-considered.md). Changes from the plan: [../30-plan/deviations.md](../30-plan/deviations.md).

## Decisions from the approved plan

### D-01 — No automatic 3D reconstruction; an agent writes parametric generator code

- **Decided by / status:** plan; in force.
- **Context:** the owner asked how to get from photographs to a 3D model.
- **Alternatives:** photogrammetry, learned multi-view geometry, single-image depth, generative image-to-3D, splatting, a human artist.
- **Reason:** *tested*: photogrammetry found 35 points for Rig B, almost none on the rig. The other automatic routes give one fused, unscaled mesh and mostly fail the open-source or hardware constraint.
- **Consequences:** the model reproduces what the modeller understood from the photos; anything misread is built confidently and wrongly, so checks and review carry correctness.

### D-02 — The only editable source is text: parameter files plus generator code

- **Decided by / status:** plan; in force.
- **Context:** the asset must be re-adjustable when measurements arrive.
- **Alternatives:** a Blender file; a CAD document.
- **Reason:** text can be compared between versions and read by an agent; each value can carry unit, source and range.
- **Consequences:** the model file and the description file are build products and are never edited by hand.

### D-03 — Generator and viewer in TypeScript with three.js, run by Bun; measurement in Python

- **Decided by / status:** plan; in force.
- **Context:** two trial routes both built a working blockout.
- **Alternatives:** Blender as a library; a native Python mesh stack; code CAD on OpenCascade; OpenSCAD.
- **Reason:** *tested*: rebuild 0.07 s against 1.1 s; 50 MB against 781 MB; MIT licence.
- **Consequences:** no solid-modelling kernel, so shaped parts are hand-built from a small kit; three.js writes invalid geometry without an error, so a format validator and geometry checks run on every build.

### D-04 — Blender is not installed

- **Decided by / status:** plan; in force.
- **Context:** the owner asked whether Blender is worth using.
- **Alternatives:** Blender as the foundation; Blender as an optional finishing stage.
- **Reason:** in the trial it was not what made the asset parametric or articulated. For the seat the missing ingredient is evidence (about forty corner points in 3D from oblique views), which no tool supplies.
- **Consequences:** no photoreal renders. If presentation quality is wanted later, an artist-made shell can sit under the same node, and would then no longer follow the parameters.

### D-05 — The asset is one GLB model file plus one JSON description file

- **Decided by / status:** plan; in force.
- **Context:** the owner asked what format keeps modularity and parameters.
- **Alternatives:** metadata only inside the GLB; OpenUSD; URDF or MJCF; STEP.
- **Reason:** every candidate consumer reads GLB; no ratified glTF extension carries joint limits, so a custom description is needed anyway, and a separate JSON file can be compared between versions.
- **Consequences:** every consumer other than the project's own viewer needs a small piece of code to apply joints from the description file. Robotics and CAD formats are derived on request.

### D-06 — The rig is not isolated from the background

- **Decided by / status:** plan; in force.
- **Context:** the owner asked whether the rig must be extracted from the pictures.
- **Alternatives:** segmentation masks; silhouette comparison.
- **Reason:** nothing is extracted from pixels; the background is what fixed the camera positions (*tested*).
- **Consequences:** agents work on gridded crops per component. Masks are used for privacy only.

### D-07 — Sizes carry a class and a range; the scale must close before modelling

- **Decided by / status:** plan, after review findings; in force.
- **Context:** the first size estimates disagreed (two scale references by about 7 %; one height derived as 660 to 800 mm).
- **Alternatives:** publish one value with the method's own error bar.
- **Reason:** *tested*: a method's own error bar (±45 mm) understated the real error (about 115 mm).
- **Consequences:** every dimension is two-view, single-view or by-eye. "±x" means the true value is expected inside about nine times in ten. The named gauge features that tie cameras to the model are never counted as verification.

### D-08 — Gaps are filled from a ranked list of sources, and the class travels with the value

- **Decided by / status:** plan; in force.
- **Context:** the owner asked how missing data is filled reliably.
- **Alternatives:** fill by judgment without labels.
- **Reason:** invented values must not look measured.
- **Consequences:** five classes (measured, vendor, photo, assumed, invented). A value filled from an ergonomic standard cannot later be assessed against that standard.

### D-09 — One tree; decomposition first, as a hypothesis the blockout tests

- **Decided by / status:** plan; in force.
- **Context:** the owner asked whether to decompose first or model first, and wanted a functional and a structural decomposition.
- **Alternatives:** two separate hierarchies; model first and cut it up afterwards.
- **Reason:** a part's parent is whatever carries it; the human-factors view is a set of tags and reference frames on the same nodes, so the two cannot drift apart.
- **Consequences:** names are stable identifiers; values never freeze.

### D-10 — Motions that are only assumed are in the model, locked

- **Decided by / status:** plan; in force for the asset; **changed for the viewer by D-31**.
- **Context:** no photo shows the seat sliding, swivelling, changing height, tilting or reclining, or the pedal tray moving.
- **Alternatives:** leave them out; include them unlocked.
- **Reason:** keeps the tree stable and keeps guessed motion out of every result.
- **Consequences:** the owner's own example (reach against seat position) cannot be answered until the client confirms the motions. On this rig the joysticks ride with the seat, so hand reach would not change anyway.

### D-11 — Seat references are labelled "estimated", not as a standardised seat index point

- **Decided by / status:** plan, after a review finding; in force.
- **Context:** the first draft called the seat reference an ISO 5353 seat index point with a range of ±25 mm.
- **Alternatives:** keep the standard's name.
- **Reason:** the standard's conditions (adjustments at centre, a loaded measuring device, or the seat maker's statement) are not met.
- **Consequences:** two frames, a fixed and a live seat reference, with ranges of about ±70 mm vertically and ±60 mm or more front to back. See [../80-reference/standards.md](../80-reference/standards.md).

### D-12 — Conventions: metres and radians; Z up, X forward, Y to the operator's left

- **Decided by / status:** plan; origin fixed by the coordinator in the build contract; in force.
- **Context:** the trials used three different conventions.
- **Alternatives:** the file format's own Y-up axes throughout; an origin on the floor under the seat pedestal (proposed by the toolchain research).
- **Reason:** matches robotics tools and the fore-aft, vertical habit of the seat-based standards. The origin is the centre of the platform deck's top surface, which the deck outline defines in the photos.
- **Consequences:** one conversion to the file format's axes, at the root node on export. Node names follow one pattern with prefixes `C_`, `J_`, `D_`, `S_`.

### D-13 — The viewer is a three.js page, and the same page is the agents' renderer

- **Decided by / status:** plan; in force.
- **Context:** the owner asked for a good browser environment.
- **Alternatives:** Babylon.js; the `model-viewer` component; renders from the authoring tool.
- **Reason:** least material; the person sees what the agent checked; export errors cannot hide.
- **Consequences:** a screenshot is not a measurement; sizes are computed from the files, not read off images.

### D-14 — No agent watches the builder's reasoning live

- **Decided by / status:** plan; in force. The human gates it relied on were **replaced by D-22**.
- **Context:** the owner asked who monitors the modelling agent's thought process.
- **Alternatives:** a live monitoring agent; no review at all.
- **Reason:** *judgment*, supported by published evidence: a watcher would read the builder's own justifications. Instead: scripts on every build, an independent reviewer, and the owner at gates.
- **Consequences:** the reviewer sees photos and renders, not the builder's notes.

### D-15 — The rig is built first; the toolkit and the Skill are extracted afterwards

- **Decided by / status:** plan, after the simplicity critique; in force.
- **Context:** the first draft built a general toolkit and an eleven-file Skill before any asset existed.
- **Alternatives:** toolkit first.
- **Reason:** writing them before one asset exists would be guessing.
- **Consequences:** the Skill after one asset is version 0.x; see D-28.

### D-16 — No logos on the model

- **Decided by / status:** plan; in force (the build contract adds: no decals or text either).
- **Reason:** protects the owner with the client.

### D-17 — Rig B is the reference rig

- **Decided by / status:** plan (question Q3, recommendation "yes"); in force.
- **Context:** four physical rigs appear in the photos; none is covered all round.
- **Alternatives:** Rig C1 (best whole-platform view); a composite with no reference.
- **Reason:** Rig B has the only operator's-eye view and the only usable two-view pair, and stands alone in its room.
- **Consequences:** what Rig B does not show is borrowed from Rigs C1 and C2 and tagged as borrowed. The model is "composite, configuration B" and matches no single real station exactly.

### D-18 — A private repository; photographs never committed; neutral rig names

- **Decided by / status:** plan, after review findings; in force. The masking part was **changed by D-21**.
- **Context:** the photos show people, third parties' names and location data; the first draft wrongly said they stay "on this machine only".
- **Reason:** a photo an agent looks at is transmitted to the AI provider; a public history cannot be cleanly withdrawn.
- **Consequences:** rigs are Rig A, B, C1, C2 everywhere.

### D-19 — "Just the pictures" includes public vendor datasheets

- **Decided by / status:** plan, stated as a reading for the owner to contest; no objection recorded.
- **Reason:** purchased parts are better modelled from published dimensions than from photos, and they double as scale references.

### D-20 — No code is reused from the Leitbild project; its practices are

- **Decided by / status:** plan; in force.
- **Reason:** its 3D model has no joints, hierarchy, materials or glTF output. Reused practices: one editable authority, an independent reader of exported geometry, negative controls, a "not qualified for" list.

## Decisions after approval

### D-21 — Internal test; confidentiality is no concern

- **Decided by / status:** owner (answers to the plan's questions Q1 and Q2); in force.
- **Context:** the plan had made masked working copies a precondition for further work.
- **Consequences:** masking for agent viewing was dropped. Masking was kept for every image published in the wiki, because the production site is public (coordinator).

### D-22 — A full autonomous test implementation; reviewer rounds in place of human gates

- **Decided by / status:** owner (direction), coordinator (how); in force for this run only.
- **Context:** the plan had four owner sessions, about forty owner clicks, an acceptance specification by a separate agent and a look sample judged by the owner.
- **Alternatives:** follow the staged plan.
- **Reason:** the owner asked for a complete result in one go, checked by "a separate ruthless agent".
- **Consequences:** acceptance rests on a ruthless reviewer agent plus the coordinator's verification in the browser. No acceptance-author agent was used. No hold-out points clicked by a person exist.

### D-23 — The project is called `rigtwin`

- **Decided by / status:** owner; in force.
- **Context:** the owner rejected the plan's shortlist ("all bad. keep it simpler. no german or norwegian").
- **Consequences:** folder in the owner's Documents folder, which is not cloud-synced on this machine.

### D-24 — Photo values are modelled where they conflict with the owner's scale figures

- **Decided by / status:** coordinator, on the measurement agent's results; in force until a tape measurement arrives. **For the owner to confirm.**
- **Context:** the owner gave three figures: platform 1.5 × 1.5 m; seat 1.4 m high; head to display 1.2 m.
- **What was found (*measured* from the photos):** with the deck width set to 1.50 m the scale closes within 0–2 % (soundbar 0.411 m against 0.410 m). The deck is then about 1.41 m front to back, not 1.5. The top of the seat back is 1.28 ± 0.03 m above the deck on Rig B and 1.27–1.28 m on Rig C1, not 1.4. The distance from headrest to screen is 1.14–1.21 m, which fits 1.2; eye to screen centre is about 0.97–1.05 m in the measurement report (the coordinator's notes round it to 0.95–1.05 m).
- **Alternatives:** model the owner's figures and ignore the photos.
- **Reason:** the deck width is used as the one scale input; the other two figures are then predictions the photos contradict.
- **Consequences:** the owner's figures are written into the parameters' evidence text as conflicting evidence. All three need a tape.

### D-25 — A coverage check, an "omitted" list and a left/right counterpart check

- **Decided by / status:** coordinator, after the owner's report; in force.
- **Context:** the trial model shown in the plan lacked the left joystick.
- **Cause found:** the coordinator's brief for the trial named only the right armrest pod; the figures did not list what was left out; no check compared the model with the component tree.
- **Consequences:** every component in the tree must be in the model file or in an `omitted` list with a reason; every left part must have its right counterpart; every image sheet lists omissions.

### D-26 — Three modelling agents work in parallel

- **Decided by / status:** coordinator; in force for this run.
- **Context:** the plan built components one after another and deferred parallel builders to a later asset.
- **How:** one modeller each for the seat; the two pods with joysticks, controls and touchscreen; and the platform, stand, monitor and pedals. Each owns its own source and parameter files under a shared contract.
- **Consequences:** a build option that generates only one group's meshes, so one group can be worked on while another is mid-edit.

### D-27 — A fixed performance budget

- **Decided by / status:** coordinator, from the owner's request; in force.
- **What:** whole rig at most 150,000 triangles (target 60,000–120,000), 4 MB, 80 draw calls; 60 frames per second on the project machine at 1600 × 1000; a build well under 5 s.
- **Consequences:** no stitching, screws, cables, logos or text.

### D-28 — The Skill is extracted after the build

- **Decided by / status:** coordinator; in force.
- **Context:** the plan wanted a six-file Skill draft before modelling.
- **Consequences:** a build brief served as the working guidance during the build.

### D-29 — The viewer is written in TypeScript and shares its posing code with the generator

- **Decided by / status:** coordinator, after the owner's question; in force.
- **Context:** the first viewer was a JavaScript file with no build step.
- **Consequences:** generator and viewer use the same code to turn a joint value into a part's position, so they cannot disagree.

### D-30 — The viewer's interface is redesigned after two independent reviews

- **Decided by / status:** owner (direction), coordinator (how); in force.
- **How:** two independent reviewers (one on interaction design, one walking through as a first-time user), then a separate implementer.
- **What they proposed:** 103 controls reduced to 19; the 3D view enlarged from 58 % to 82 % of the window; one card for the selected part; two-axis pads in place of separate sliders; direct manipulation; no lock.

### D-31 — Assumed adjustments are usable in the viewer, marked "assumed range"

- **Decided by / status:** owner; in force. Changes D-10 for the viewer only.
- **Context:** "why cant i adjust the seat? the lock is confusing for users unless there is a way to unlock".
- **Consequences:** a pose that uses an assumed motion is exploratory; it says nothing about what the real rig can do.

### D-32 — Public addresses and deployment by one command

- **Decided by / status:** owner (addresses), coordinator (pipeline); in force.
- **What:** viewer at `mightwork.ai/rigtwin`, wiki at `mightwork.ai/rigtwin/wiki`. One deploy command builds, checks, packages, copies a dated release to the server, switches a link and verifies the live pages.
- **Alternatives:** deployment from GitHub's automation; offered as a follow-up, because it needs a new access key on the server and no credentials are created unasked.

### D-33 — The repository is private, and version control starts only at the end

- **Decided by / status:** owner (private), coordinator (timing); in force.

### D-34 — The touchscreen is modelled at the 13.3-inch size

- **Decided by / status:** coordinator, on the measurement agent's result; in force.
- **Context:** the plan carried two candidate models; the build contract first assumed the 15.6-inch one.
- **Reason:** *measured*: outer height 0.205 m and active height 0.1655 m, both 0.84–0.85 of the 15.6-inch figures.

### D-35 — The rig maker's name and the customer names never appear in the repository

- **Decided by / status:** owner (rig maker's name), plan (customer names); in force.
- **Consequences:** a check scans every file outside the private folders on every run.

### D-36 — Photographs in the wiki are masked copies

- **Decided by / status:** coordinator; in force.
- **What:** people and names blurred, metadata removed. Unmasked photographs never enter the repository.
