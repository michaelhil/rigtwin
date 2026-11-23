---
title: Research sources
tldr: One short section for each of the sixteen documents behind the plan (eight specialist reports, two critiques, five adversarial reviews, one closure check), giving the question it answered, what it established with the key numbers, what it could not verify, and which wiki pages carry its content. The full texts are in the project's private archive.
status: stable
updated: 2026-11-23
tags: [reference, research, sources, reviews]
---

# Research sources

## TL;DR

- Sixteen documents were written by AI agents on 2026-11-23 before the plan was approved: reports 01–08, critiques A and B, reviews R1–R5 and closure check R6.
- They are **not in the repository**, because they name the client and customers and refer to unmasked photographs. They are kept in the project's private archive. This page is their public summary.
- The most important tested facts: automatic reconstruction found 35 points, almost none on the rig; two scale references disagreed by about 7 %; one height was derived as anything from 660 to 800 mm; both trial stacks built a blockout in under half an hour; neither produced a convincing seat.
- None of the five adversarial reviewers approved draft 2. Their 92 blocker and major findings reshaped the plan.
- Every section says what its author could **not** verify. Treat those items as open.

## How to read this page

Each section has the same four parts. Numbers are quoted exactly from the documents. "Tested" means
run on the project machine on the real photographs. Agent durations and token counts are in
[../30-plan/approved-plan.md](../30-plan/approved-plan.md). Photographs are named by number, as in
`img/photos/`; Rig A is in a van, Rig B is the reference rig, Rigs C1 and C2 are in a control room.

## The eight specialist reports

### 01 — Photo evidence and measurement

- **Question:** how much metric truth is in the eleven rig photographs?
- **Established:** a coverage table of every component against every rig and photo. No photo is a true side, front, rear or top view; no adjustment is seen in two states, so no range of motion can be observed. Rig B is the best reference. Purchased parts were identified with confidence from about 90 % (joysticks) through medium (monitor, touchscreen) to low (soundbar). The most robust single scale reference is the monitor's outer height, 364 ± 1 mm, the same for every candidate model. Three measuring attempts gave the shelf height as 680 ± 35, 800 ± 45 and 690 ± 55 mm; a simulated error bar of ±45 mm sat beside a real error of about 115 mm. Two photos of Rig B taken three hours apart are "not rigid": the touchscreen corners moved 22–33 px between them. Rig B's monitor measures 1182 ± 20 mm across.
- **Could not verify:** any seat dimension; the cause of the height disagreement; exact models of monitor, touchscreen and soundbar; the seat's origin; platform symmetry.
- **Later corrected by reviews R1 and R2:** its "reconciled" values (for example shelf 690 ± 45 mm) rested on an untested correction, and its claim of ±5–7 % in plan was too confident. Its eye-to-screen figure (780 mm) was the photographer's phone, not an eye.
- **Carried forward in:** [../30-plan/approved-plan.md](../30-plan/approved-plan.md) (size estimation, gap filling), [../20-decisions/options-considered.md](../20-decisions/options-considered.md) (scale), and the measuring pages under `40-method/`.

### 02 — Reconstruction methods

- **Question:** which route leads from these photographs to a 3D model?
- **Established (tested):** classical structure from motion ran in 48 s and solved cameras for 3 of 3 Rig B photos and 3 of 6 control-room photos, but gave no usable geometry of the rig (35 points for Rig B, 186 for Rig C1, almost all on background or on the monitor picture). Focal length from photo metadata is reliable; self-calibration ranged from 1328 to 3090 px against 1502. Seven shelf screws picked by the agent in two photos predicted six held-out positions in a third within 0.7–3.4 px, with left and right patterns equal within 1.6–3.3 %. A learned depth model ran in 18 s and confirmed the camera rotations within 0.5–2.1° but failed as a measuring tool (ratios off by 9 % up to a factor of 3.6). Photos of different rigs matched each other and must be kept apart.
- **Established (desk research):** published tests show agents' visual self-critique levelling off after about two rounds, with roughly a third of visual checks wrong; models point to the same physical point in two views correctly 5–16 % of the time against 94 % for people; no published benchmark covers this task.
- **Could not verify:** single-image depth, generative 3D and splatting were not run; the Rig C1 cameras rest on a possibly live screen image.
- **Carried forward in:** [../20-decisions/options-considered.md](../20-decisions/options-considered.md) (route, isolation), decision D-01, D-06.

### 03 — Toolchain and asset format

- **Question:** which authoring tools, source of truth and delivery format?
- **Established:** the source of truth should be text (parameters plus generator code), never a Blender file or CAD document. The compiled asset should be one GLB plus one description file bound by a fingerprint; no ratified glTF extension carries joint limits. Three kinds of variable (design parameter, adjustment, runtime control) must be kept apart. Axis convention: metres, Z up, X forward, Y left, converted once on export. A native Python mesh stack of four packages (44 MB) built sample parts in 1.3 s and wrote a 31 kB model file with hierarchy and metadata (*tested*). No ready open-source digital human tool exists.
- **Recommended, and not adopted:** Python for the generator. The plan chose TypeScript after the trials.
- **Could not verify:** most standards editions and several quoted offsets (from memory); engine support for some glTF extensions; whether native code reaches a credible seat.
- **Carried forward in:** decisions D-02, D-05, D-12; [../20-decisions/options-considered.md](../20-decisions/options-considered.md) (stack, source, format); [standards.md](standards.md).

### 04 — Decomposition, connections, reference frames and parameters

- **Question:** how should the rig be broken down, and how are connections and reference points represented?
- **Established:** one tree, not two: the hierarchy is structural, the human-factors view is tags and frames. Decomposition comes first as a hypothesis and is tested by a blockout. The rig breaks down into 5 assemblies and about 45 nodes, with 7 continuous control motions and about 20 adjustments. What the photos prove about adjustability is thin: seen are the monitor arm, the touchscreen's ball arm, armrest pads in different positions on different rigs, and pedals clamped on rails; not seen are seat slide rails, a swivel or a recline lever. The pods are carried by the seat. Every connection is a pair of frames plus a joint record, with the observation that would prove it wrong. A paper test against three other asset types (a multi-operator console, a machine cab, a body-worn remote control) produced five changes to the method.
- **Could not verify:** any dimension (none was estimated); any seat motion; the identity of purchased items; standards text (read only as sample pages by a helper agent).
- **Later corrected by review R3:** its seat reference was mis-defined against ISO 5353 and its ±25 mm was not defensible; recline should be locked like the other assumed motions.
- **Carried forward in:** decisions D-09, D-10, D-11; the decomposition pages under `40-method/`; [standards.md](standards.md).

### 05 — Agent process and the Skill

- **Question:** who models, under what guidance, who monitors, how iterative, and when is it finished?
- **Established (desk research, nothing executed):** one modeller, one independent reviewer, scripts and one human; nobody watches the modeller's thoughts live. The reviewer never says "approved": it reports findings and a script derives the status. "Done" is computed, not declared. Published results: visual self-verification levels off after about two rounds; the best AI verifier agreed with humans 0.66 against 0.79 between humans; one authoritative note overturned up to 40 % of a judging agent's correct verdicts; multi-agent work uses about 15 times the tokens of a chat.
- **Could not verify:** every budget and estimate (no run was made); how good a reviewer is on this material.
- **Later corrected by review R4:** as written the process was self-certifying and the reviewer's isolation was on paper only.
- **Carried forward in:** decision D-14; [../30-plan/approved-plan.md](../30-plan/approved-plan.md) (process, Skill); the process pages under `40-method/`.

### 06 — Leitbild reuse, web viewer, naming and scaffold

- **Question:** what can be reused from the owner's earlier project, how to view the asset in a browser, and what to call the project?
- **Established:** no Leitbild code is reusable (no joints, hierarchy, materials or glTF output; renderer tied to a map); its verification practices are. A three.js static page was prototyped (152 lines of script) and driven without a window: tree with show and hide, joint sliders with limits, click to identify, measuring, named views; two runs gave byte-identical images; seven library files of 2.36 MB against about 11.5 MB for the nearest alternative (*tested*). Twelve name candidates with collision checks. Start the repository private.
- **Could not verify:** photo overlay in the viewer; textures; other browsers; human usability of the tree and sliders.
- **Carried forward in:** decisions D-13, D-18, D-20, D-23; [../20-decisions/options-considered.md](../20-decisions/options-considered.md) (viewer, names, repository).

### 07 — Hands-on trial A: Blender as a Python library

- **Question:** can Blender, used as a library with no window, build, export, render and compare a parametric articulated blockout?
- **Established (tested):** yes. 47 named nodes, 8 joints, 4 reference frames, 8,082 triangles from one parameter file in about 1.1 s; frames rendered in about 0.35 s; the whole chain in 17 s; all seven requirements passed, three with caveats. Install 781 MB; tied to one exact Python version; GPL licence. Output became byte-identical only after one non-deterministic operation was replaced. Placing a camera by hand did not converge; a solve from four landmarks did.
- **Its own verdict:** Blender "is not what made the asset parametric or articulated"; that came from the parameter file, the joint convention, the description file and the checks.
- **Could not verify:** a faithful seat shell (its backrest was "clearly not the real seat shell"); running without a logged-in session.
- **Carried forward in:** decision D-04; the trial table in [../20-decisions/options-considered.md](../20-decisions/options-considered.md).

### 08 — Hands-on trial B: without Blender

- **Question:** the same brief, with code as the only source and no Blender.
- **Established (tested):** TypeScript with three.js run by Bun passed all seven requirements. Rebuild 0.07 s; 30–90 ms per frame; byte-identical output; generator 657 lines; 50 MB of packages. A second candidate (code CAD on OpenCascade, 573 MB) made a smooth valid backrest but its fillet failed at 12, 8 and 5 mm. An invalid curvature produced a broken file with exit code 0; only the format validator caught it (17,882 errors).
- **Its own verdict:** sufficient for a dimensionally credible, articulated, tagged model; "not sufficient, on its own, for a visually faithful seat shell, pod fairings and joystick grips".
- **Could not verify:** any dimension of the rig; the idea of replacing one component's mesh with one authored elsewhere.
- **Carried forward in:** decision D-03; the trial table in [../20-decisions/options-considered.md](../20-decisions/options-considered.md).

## The two critiques of draft 1

### Critique A — the owner's advocate

- **Question:** would the person who commissioned this be able to approve draft 1, and does it serve their interests?
- **Established:** the draft answered most technical questions but was "written for the people who will build it". It did not say what the owner gets, when, at what cost, or what may be told to the client. Three things were under-served: no objective test of the accuracy claim; no demonstrated route to a credible seat; and a "foundational" Skill declared finished after one asset. Ten required changes, among them: rewrite the summary for the commissioner, add a frozen prediction table, bring the seat question forward, show something early, sort decisions by who can make them.
- **Carried forward in:** the structure of [../30-plan/approved-plan.md](../30-plan/approved-plan.md) (what was promised, questions to the owner, limits first).

### Critique B — the simplicity monitor

- **Question:** could this be simpler without lowering the quality goals?
- **Established:** draft 1 named about 325 things; 168 essential now, 74 deferrable to a named trigger, 83 removable. The largest avoidable cost was order: a toolkit, an eleven-file Skill and a three-gate process specified before the first asset existed, while two working blockouts already existed. Under draft 1 the owner would first see a 3D rig after 8–14 agent-hours; it could be 2–4. The stack choice in draft 1 (Python) was the least tested of the candidates. It also listed what must **not** be simplified, including class, range and evidence on every parameter, cameras solved before any overlay is judged, an independent reviewer, the same-fingerprint build check and the re-adjustment drills.
- **Carried forward in:** decisions D-03, D-15; the "deferred" tables in [../20-decisions/options-considered.md](../20-decisions/options-considered.md).

## The five adversarial reviews of draft 2

None of the five approved. Each was a fresh agent with no access to the critiques or to the
coordinator's reasoning.

### R1 — Technical review

- **Question:** is the plan technically sound?
- **Established (tested, by joining two measurement pipelines the plan had never joined):** the two scale references for Rig B disagree by about 7 %. On one consistent scale the shelf top is about 750 mm above the platform (not 690 ± 45), the column gap about 466 mm (not 434 ± 15) and the platform about 213 mm above the floor (not 150 ± 50). The shelf is tilted about 10.5°. A 50 mm error along the viewing direction moves a point only 0–2 px in the rear photos, so the checks were blind in depth for half the rig. 25 of the trial's 27 parts could be turned into valid solids; six pairs of components interpenetrated. 3 blockers, 11 majors.
- **Could not verify:** which scale reference was wrong.
- **Carried forward in:** decision D-07; the scale closure and "not checkable" rules in [../30-plan/approved-plan.md](../30-plan/approved-plan.md).

### R2 — Evidence audit

- **Question:** does every claim in the plan hold against the reports and the raw files?
- **Established:** the accuracy statement was "the weakest part of the plan and is presented as the strongest". A further independent derivation put Rig B's shelf, pod controls and armrest pad roughly 50–100 mm above the plan's estimates. "The only route proven end to end" was false: the Blender trial passed the same requirements. The trials took about 22 and 29 minutes by file timestamps, not "1–2 hours". **Neither trial model had a left pod, pedals, soundbar, monitor arm, key switch or panel buttons.** Photos 2511 and 2530 are taken from the rear right. 5 blockers, 15 majors.
- **Carried forward in:** the verdict wording and "not verified" list in [../30-plan/approved-plan.md](../30-plan/approved-plan.md); decision D-25 (the missing left pod reappeared as the owner's report).

### R3 — Human factors and downstream use

- **Question:** does the asset carry what later assessment and simulation need?
- **Established:** the uncertainty of every seat-relative quantity (about ±80–130 mm) is as large as the spread from a small woman to a large man it is meant to resolve (about 100–190 mm); a worked table for reach, forearm support, posture, vision and clearance shows almost no conclusion surviving. The owner's example (reach against seat position) is a special case here because the hand controls ride with the seat. The seat reference was mis-defined against ISO 5353. The statement that photos stay "on this machine only" was false for an agent pipeline. No standard is written for a seated teleoperation station. No open digital human tool exists. 4 blockers, 10 majors.
- **Could not verify:** several standards values (from memory or from optical character recognition of sample pages); regulatory applicability.
- **Carried forward in:** decisions D-10, D-11, D-18; [standards.md](standards.md); the "not qualified for" list.

### R4 — Process and Skill

- **Question:** will the agent process and the Skill work in the actual product?
- **Established:** the process was "self-certifying": the builder wrote its own acceptance tests, tuned their thresholds after seeing results, briefed its own reviewer and could turn a failure into a "known deviation". The reviewer was independent "on paper only". The Skill folder alone could not build anything in another repository. Checked in the product: a reviewing agent can be made read-only, and images reach it. It re-estimated the work at 20–30 agent-hours. 5 blockers, 14 majors.
- **Carried forward in:** the roles, locked acceptance spec, planted-error test and project template in [../30-plan/approved-plan.md](../30-plan/approved-plan.md). Several of these were then not used in the run; see [../30-plan/deviations.md](../30-plan/deviations.md).

### R5 — Compliance audit and pre-mortem

- **Question:** does the plan do what the owner asked, and how would it fail?
- **Established:** 76 requirements audited: 38 met, 30 partly, 4 met in a way the owner would object to, 4 not met. The plan "can pass its own feasibility test while failing the client's": "credible" had been narrowed to "layout-credible" and a downgrade was already written into the pass criteria. Eight failure stories, the first being "It looks like a toy". Its lightest fix: a look sample at the very start. 3 blockers, 14 majors, 11 minors.
- **Carried forward in:** the two limits in the verdict, the look sample, the ceiling and cut order in [../30-plan/approved-plan.md](../30-plan/approved-plan.md); requirement R-54 echoes its first failure story.

## The closure check

### R6 — Closure check of version 3

- **Question:** did version 3 fix what the five reviews found?
- **Established:** of 92 blocker and major findings (R1: 14, R2: 20, R3: 14, R4: 19, R5: 25), 55 were closed, 34 partly closed, 1 open and 2 declined with reasons. Of 21 blocker-class findings, 15 were closed and 6 partly; none open. It listed 25 new problems that version 3 itself introduced (numbers and orderings that did not agree with each other) and ten ranked edits.
- **Not checked afterwards:** the coordinator's final edits in response.
- **Carried forward in:** "How the plan was made" in [../30-plan/approved-plan.md](../30-plan/approved-plan.md).

## Sources written after approval

These are working files of the build, also outside the repository. Their content is carried by the
pages under `40-method/`, `50-implementation/` and `70-results/`.

| Source | What it holds |
|---|---|
| The build brief | The working contract every build agent followed: mission, rules, stack, conventions, component tree, parameter format, known sizes, checks, budget, the modeller's loop |
| The measurement report | Cameras, gauge features, scale closure and the dimension table (118 records, 215 named points) |
| The review round files | The ruthless reviewer's verdict per component |
| The two interface reviews | The findings behind the simplified viewer |
| The coordinator's notes and the agent run table | The owner's later decisions, the deviations and the duration and token figures |
