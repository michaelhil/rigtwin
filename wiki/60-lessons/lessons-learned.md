---
title: Lessons learned
tldr: Fifty-five numbered lessons (L-01 to L-55) from building a 3D asset from photos with a team of AI agents, each one sentence with its evidence and how it is now applied, grouped by topic, with a top ten and a map to the failures and patterns behind them.
status: living
updated: 2026-11-23
tags: [lessons, measurement, modelling, review, agents, viewer, planning]
---

# Lessons learned

## TL;DR

- The result looked finished long before it was right, several times: a model missing its left side, an accuracy figure "verified by three methods", a model that passed 18 checks and was rejected. **Completeness, accuracy and credibility each need their own independent test.**
- Sizes from photos closed to 0–2 % against parts of known size once one large feature set the scale. They are still **unchecked against a tape**, and depth along the camera's line of sight cannot be checked from these photos at all.
- The tools are fast (build 0.13 s, all checks 4 s). A modeller spent 2–5 % of its time waiting for them. Quality is limited by what the agent looks at and by who reviews it.
- The most valuable findings came from fresh agents that did their own calculations and from the owner looking at a picture.
- Each lesson names its evidence. Incidents are in [failures-and-fixes.md](failures-and-fixes.md) (`F-`), reusable procedures in [patterns.md](patterns.md) (`P-`), things not yet done in [ideas.md](ideas.md) (`I-`).

## Top ten

| # | Lesson | In one line |
|---|---|---|
| 1 | [L-16](#l-16) | Build every component as a blockout first, both sides, and check coverage on every build. |
| 2 | [L-24](#l-24) | Passing every check does not make a model credible; an independent reviewer must look. |
| 3 | [L-27](#l-27) | A reviewer must make its own renders and its own numbers, never read the builder's report. |
| 4 | [L-02](#l-02) | Take scale from one large, flat, static feature and close it against every part of known size before modelling. |
| 5 | [L-04](#l-04) | A photo overlay cannot see errors along the line of sight; work out per feature what a 50 mm error does in pixels. |
| 6 | [L-09](#l-09) | No range may exclude a derivation that has not been shown wrong. |
| 7 | [L-32](#l-32) | A brief that leaves something out must say so, and every output must repeat it. |
| 8 | [L-19](#l-19) | Render every joint at both limits; the hierarchy check does not see tearing or collisions. |
| 9 | [L-39](#l-39) | Put a part's controls on the part: one card for what is selected, nothing global. |
| 10 | [L-12](#l-12) | Give every number a class and print the counts where nobody can miss them. |

## Map: lessons to failures and patterns

| Lesson | Failures | Patterns | | Lesson | Failures | Patterns |
|---|---|---|---|---|---|---|
| [L-01](#l-01) | F-03 | P-03 | | [L-26](#l-26) | F-09, F-11 | P-21 |
| [L-02](#l-02) | F-04 | P-05 | | [L-27](#l-27) | F-04, F-09 | P-03, P-15 |
| [L-03](#l-03) | F-06, F-15 | P-06 | | [L-28](#l-28) | F-22 | P-15 |
| [L-04](#l-04) | F-07 | P-07 | | [L-29](#l-29) | F-12, F-23 | P-14 |
| [L-05](#l-05) | F-07 | P-07 | | [L-30](#l-30) | — | P-11 |
| [L-06](#l-06) | F-04, F-14 | P-05 | | [L-31](#l-31) | — | P-12 |
| [L-07](#l-07) | F-13 | P-08 | | [L-32](#l-32) | F-01 | P-13 |
| [L-08](#l-08) | — | P-05, P-06 | | [L-33](#l-33) | F-23 | — |
| [L-09](#l-09) | F-03 | P-08 | | [L-34](#l-34) | F-17 | P-10 |
| [L-10](#l-10) | F-05 | P-08 | | [L-35](#l-35) | F-28 | P-19 |
| [L-11](#l-11) | F-13, F-16 | P-08 | | [L-36](#l-36) | F-18, F-19 | P-03, P-10 |
| [L-12](#l-12) | F-03 | P-08 | | [L-37](#l-37) | F-11, F-12 | P-01 |
| [L-13](#l-13) | F-15 | P-08 | | [L-38](#l-38) | F-24 | P-11, P-16 |
| [L-14](#l-14) | F-25 | P-22 | | [L-39](#l-39) | F-24 | P-16 |
| [L-15](#l-15) | F-21 | — | | [L-40](#l-40) | F-24 | P-16 |
| [L-16](#l-16) | F-01 | P-09, P-13 | | [L-41](#l-41) | F-25 | P-22 |
| [L-17](#l-17) | F-18 | P-15 | | [L-42](#l-42) | F-24 | P-16 |
| [L-18](#l-18) | F-22 | P-15 | | [L-43](#l-43) | F-02 | P-02 |
| [L-19](#l-19) | F-19 | — | | [L-44](#l-44) | F-02, F-10 | P-02, P-04 |
| [L-20](#l-20) | F-11 | P-13 | | [L-45](#l-45) | F-10 | — |
| [L-21](#l-21) | F-16 | P-18 | | [L-46](#l-46) | — | P-20 |
| [L-22](#l-22) | — | P-11 | | [L-47](#l-47) | F-10 | — |
| [L-23](#l-23) | F-20 | — | | [L-48](#l-48) | F-26, F-31 | P-13 |
| [L-24](#l-24) | F-18, F-19 | P-15 | | [L-49](#l-49) | F-08 | P-17 |
| [L-25](#l-25) | F-01, F-11, F-12 | P-13 | | [L-50](#l-50) | F-27 | — |
| [L-51](#l-51) | F-30 | P-20 | | [L-53](#l-53) | F-30 | — |
| [L-52](#l-52) | F-30, F-31 | — | | [L-54](#l-54) | F-29 | — |
| [L-55](#l-55) | F-32 | — | | | | |

---

## Measuring from photos

<a id="l-01"></a>
**L-01. Agreement between methods that share an input is not verification.**

- The plan's second draft called a shelf height "verified by three methods"; two of the three used the same scale reference and the three results ran from 660 to 800 mm (F-03).
- Now: before two results are compared, list their inputs; only results with no shared input count as independent.

<a id="l-02"></a>
**L-02. Take scale from one large, flat, static feature and close it against every part of known size before any modelling.**

- With the platform width set to 1.50 m the soundbar measured 0.411 m against 0.410 from its maker, the pedal spacing 0.140 against 0.14, the monitor 1.02 of its maker's size (*measured*). The earlier 7 % conflict (F-04) disappeared.
- Now: the closure table is a required output of the measurement stage ([P-05](patterns.md#p-05)).

<a id="l-03"></a>
**L-03. Solve cameras on named static features, never on the part being judged, and accept a camera only with a residual on features it was not solved from.**

- A camera solved on the monitor's corners fitted to 1.8 px and proved nothing (F-06). A camera solved from three deck edges alone missed room verticals by 24–52 px (F-15).
- Now: gauge features are listed, their residuals are labelled "zero by construction", and each camera has a held-out check ([P-06](patterns.md#p-06)).

<a id="l-04"></a>
**L-04. A photo overlay cannot see errors along the line of sight.**

- For a point 2.2 m away, 50 mm sideways is about 35 px and 50 mm along the view is 0–2 px (F-07). The seat back, hub, armrest pads and the monitor's distance are affected on the reference rig.
- Now: every dimension is marked checkable or not checkable, from a table of pixel shift per 50 mm per feature and photo ([P-07](patterns.md#p-07)).

<a id="l-05"></a>
**L-05. Two photos from nearly the same place are one viewpoint.**

- Two of the three photos of the reference rig were taken 0.26 m apart. Only the third, from the seat, pins anything in depth, and it does not show the seat.
- Now: the capture protocol for the next object asks for square-on views from all four sides, one from above and one from the user's eye point, and for each movable part at both extremes.

<a id="l-06"></a>
**L-06. Identifying a purchased part from a photo is itself an estimate.**

- The touchscreen was taken as the 15.6-inch model and is the 13.3-inch one (its height is 0.84 of the larger); the pedal unit's width was tied to the wrong element (F-14, F-04).
- Now: a maker's dimension is used as exact only after it passes the closure table; otherwise it carries a range.

<a id="l-07"></a>
**L-07. A person's remembered round figure is evidence with a range, not ground truth.**

- The owner's "1.5 × 1.5 m", "1.4 m" and "1.2 m" all disagree with the photos as first read: the deck is 1.50 × 1.41, the seat back top 1.28 above the deck, the eye about 1 m from the screen (F-13).
- Now: such figures are stored as records with class *measured, basis user*, their reading is written down, and a conflict is kept visible and sent back as a question.

<a id="l-08"></a>
**L-08. Trace long straight edges; do not pick points.**

- The deck's black-and-white boundary was followed with 70–440 points per edge to 0.06–0.35 px. The deck's length-to-width ratio then held at 0.938–0.943 across the variants of the solve that were tried. Hand-picked points produced wrong correspondences (two shelf nuts 22 px off; a stitch line matched to the wrong seam).
- Now: edge tracing is the default for gauge features; every pick is checked on a zoomed tile.

## Filling gaps honestly

<a id="l-09"></a>
**L-09. No range may exclude a derivation that has not been shown wrong.**

- A ±45 mm range was once chosen that did not cover the third derivation of the same height (F-03).
- Now: this is a written rule; when two derivations disagree the range covers both until a test removes one.

<a id="l-10"></a>
**L-10. An untested explanation is not a resolution.**

- A flat −115 mm was applied to all heights from one method because of a hypothesis about its bias (F-05).
- Now: widen the range, name the test that would decide, and leave the numbers alone until it has run.

<a id="l-11"></a>
**L-11. Keep conflicts visible in the record instead of averaging them away.**

- The two pod plates differ by 17 mm in height; the model uses the mean and the parameter says "CONFLICT kept visible". The owner's 1.4 m is a record of its own that nothing reads.
- Now: a conflicting value gets its own record or an explicit sentence in the evidence field.

<a id="l-12"></a>
**L-12. Give every number a class and print the counts where nobody can miss them.**

- The model has 303 parameters: 3 measured, 22 from makers' data, 80 from photos, 177 assumed, 21 invented. That one line says more about the model's standing than any picture.
- Now: the build prints the counts, the check prints them, the viewer colours parts by them, and the model card leads with them ([P-08](patterns.md#p-08)).

<a id="l-13"></a>
**L-13. Borrowing from another instance of the same product works, if every borrowed value is tagged.**

- The reference rig and a control-room rig agree to 1–2 cm on pod plate, armrest pad, blade tip and hub; but the other rig's back is reclined about 4° more (top 7 cm further back).
- Now: borrowed values have basis *cross-instance*; a camera for another rig needs its own check (F-15).

<a id="l-14"></a>
**L-14. An assumed motion should be usable and marked, not locked.**

- Locking the seat kept guessed motion out of results and made the viewer look broken (F-25).
- Now: assumed adjustments work in the viewer with an "assumed range" tag and a notice that stays on the picture and on saved images; for scripts they stay locked unless forced ([P-22](patterns.md#p-22)).

<a id="l-15"></a>
**L-15. Human reference points need a stated body size and must be derived from the seat.**

- A single eye point placed as a coordinate turned out to be a tall man's, behind the seat reference (F-21).
- Now: three eye points (small, median, large) hang from the live seat reference and move with it; their source values are marked as quoted from memory and unverified.

## Modelling

<a id="l-16"></a>
**L-16. Build every component as a blockout first, both sides, all joints and reference frames, and check coverage on every build.**

- The trials lacked a whole side and nothing noticed (F-01). The first complete blockout (48 meshes, 20 joints, 11,162 triangles) took one agent 46 minutes including the generator, the viewer and the checks; form work afterwards never broke structure.
- Now: the `coverage` and `left/right` checks run on every build and the omitted list is printed on every contact sheet ([P-09](patterns.md#p-09)).

<a id="l-17"></a>
**L-17. A matching outline says nothing about surface quality.**

- Round 1's seat cushion matched the photos in outline and was "a faceted low-polygon trough" of 686 triangles (F-18).
- Now: body-contact surfaces are lofted with smooth normals and judged in close-up renders from the operator's side, not only in overlays.

<a id="l-18"></a>
**L-18. Spend triangles where the body touches and the eye rests.**

- In round 1 one ring button had more triangles than the head pad (F-22). Round 2 has fewer triangles in total (28,042 against 30,742) and far better upholstery.
- Now: the budget check prints the heaviest components; the reviewer lists what to remove.

<a id="l-19"></a>
**L-19. Render every joint at both limits, and split the geometry where the motion happens.**

- Three joints passed the motion check and failed in use: a torn joystick boot, a monitor 0.24 m below its arm, pedals through a bar (F-19).
- Now: limit-pose renders are part of each modeller's hand-over; a scripted interference check is idea [I-03](ideas.md#i-03).

<a id="l-20"></a>
**L-20. Numbers live in parameter files, and a check enforces it.**

- A trial leaked six shape ratios into code (F-11).
- Now: the `numbers in source` check scans the asset's source for dimension-like literals; an unknown parameter name stops the build and suggests the closest names.

<a id="l-21"></a>
**L-21. Modellers with solved cameras are a second measurement pass.**

- They found five errors in the frozen table, including a column depth of 0.22 m where the table said 0.15 (F-16).
- Now: modellers report conflicts with the table and record old value, new value and reason; they never adjust a value by eye ([P-18](patterns.md#p-18)).

<a id="l-22"></a>
**L-22. Keep the loop fast; then the cost is looking and thinking.**

- Build 0.13 s (median of 90), contact sheet 1.4 s, all checks 4.2 s. The three modellers' logged tool time was 1.6 %, 3.3 % and 5.4 % of their working time (*measured* from the timeline; their own helper scripts are not logged).
- Now: the brief sets limits (build well under 5 s, contact sheet under 15 s) and caps iterations at four per component per round.

<a id="l-23"></a>
**L-23. Measure the exposure.**

- Whites at 244–249 of 255 erased the form the modellers had built (F-20). After the correction lit white sits at a median of 221 and shaded white at 164.
- Now: the acceptance script measures white and black levels per material.

## Checking and review

<a id="l-24"></a>
**L-24. Passing every check does not make a model credible.**

- Round 1 passed all 18 checks and the reviewer rejected 8 of 45 components (F-18, F-19).
- Now: scripts decide what is numeric; a reviewer decides whether it looks and works like the rig; neither replaces the other.

<a id="l-25"></a>
**L-25. The checks worth having are the ones born from a failure.**

- Coverage, left/right, determinism, expected motion, pose conformance, numbers in source, banned words and the projection self-test each exist because something specific went wrong.
- Now: each check's description names its failure ([P-13](patterns.md#p-13)).

<a id="l-26"></a>
**L-26. Test the checks with planted errors, and the reviewer too.**

- The infrastructure agent planted a zero-height cylinder and a misspelled parameter and confirmed that the build stops. **The reviewer was never tested this way**: its detection threshold is unknown (F-09).
- Now: negative tests exist for the build; the reviewer test is the first item under ideas ([I-01](ideas.md#i-01)).

<a id="l-27"></a>
**L-27. A reviewer must make its own renders and its own numbers.**

- The 7 % scale conflict was found by a reviewer who joined one agent's points with another agent's cameras (F-04). The round-1 reviewer wrote its own reader of the model file and ran 38 intersection tests.
- Now: reviewers are fresh agents, are not given the builders' notes, and are told to compute ([P-03](patterns.md#p-03)).

<a id="l-28"></a>
**L-28. Ask the reviewer what to remove as well as what to add.**

- The round-1 review listed about 6,500 triangles to take out and where to spend 4,600 of them.
- Now: the reviewer's brief has two edges: reject a toy, and reject needless detail ([P-15](patterns.md#p-15)).

<a id="l-29"></a>
**L-29. An independent reader in another language catches what shared code hides.**

- A Python reader that shares no code with the TypeScript writer re-reads the hierarchy, poses every joint and feeds several checks. It agrees with the shared pose function on 96 poses to 2.4e-8.
- Now: any new output format gets a reader that is not built on the writer ([P-14](patterns.md#p-14)).

<a id="l-30"></a>
**L-30. One renderer for agents and people.**

- Every image an agent or reviewer judged came from the viewer page the owner uses, driven without a window. Nothing "looked fine in the tool" and different in the browser.
- Now: there is no second renderer ([P-11](patterns.md#p-11)).

<a id="l-31"></a>
**L-31. Component outlines drawn on the photo beat a blended overlay.**

- A 50 % blend of render and photo is nearly useless where dark parts lie on dark parts; coloured outlines with a legend were readable at once (*judgment* of two builders and the reviewer).
- Now: the photo-matched render set includes an outline mode ([P-12](patterns.md#p-12)).

## Agent process and briefing

<a id="l-32"></a>
**L-32. A brief that leaves something out must say so, and every output must repeat it.**

- "Right pod only" was in the brief to keep a trial small; the picture that reached the owner said "trial blockout" (F-01).
- Now: omissions are data (`omitted` list with reasons) and are printed on every sheet.

<a id="l-33"></a>
**L-33. Agents build what the brief says, word for word.**

- "Plain ES modules, no build step" produced a JavaScript viewer in a TypeScript project (F-23).
- Now: a brief is read against the project's conventions before it is sent; conventions are stated in the brief's first section.

<a id="l-34"></a>
**L-34. Parallel agents need isolation at the file level.**

- At least 11 of 16 failed builds came from another agent's file being mid-edit (F-17).
- Now: each modeller owns its source and parameter files, builds with `--only`, renders into its own build folder, and touches the shared spec only with small edits ([P-10](patterns.md#p-10)).

<a id="l-35"></a>
**L-35. Agents cannot tell the time; let the tools write the durations.**

- Three self-reported durations were wrong by a factor of 1.7 to 10 (F-28).
- Now: build, check, render, bundle and acceptance tools append their own timed lines; agent runs are timed by the harness ([P-19](patterns.md#p-19)).

<a id="l-36"></a>
**L-36. Use fresh agents to review and the same agents to rework.**

- Round 2, by the three modellers resumed with the reviewer's findings, took 13–15 minutes each; round 1 had taken 27–41. The reviewers were new each time.
- Now: the coordinator keeps the modellers' agent IDs for resuming and never reuses a reviewer.

<a id="l-37"></a>
**L-37. Run two small trials with the same brief before choosing a stack.**

- Both stacks passed the same seven requirements; the choice was then made on rebuild time (under 0.1 s against 1.1 s), installed size (50 MB against 781 MB) and licence, and the trials exposed F-11 and F-12 early.
- Now: [P-01](patterns.md#p-01). Cost here: two agents, 24 and 30 minutes.

## Viewer and UX

<a id="l-38"></a>
**L-38. The agents' inspection bench is not the person's viewer.**

- The first viewer showed 103 controls because agents and modellers each needed some of them (F-24).
- Now: people get 16 controls; agents use the address parameters and a script interface, which need no panels.

<a id="l-39"></a>
**L-39. Put a part's controls on the part.**

- The monitor's three adjustments were entries 14–16 of 20 in a global list. Now a click on the monitor opens one card with a height slider and one two-axis pad, and the selected part can be dragged in the picture.
- Evidence: lowering and tilting the monitor went from 7 actions to 3 (*tested* by script).

<a id="l-40"></a>
**L-40. Count the controls and measure the picture's share of the window.**

- "Overcomplicated" became 103 controls, 157 pointer targets, 58 % of the window, 35–40 wheel notches. The redesign was accepted against the same counts (16 controls, 82.8 %, 6 notches).
- Now: the 53 acceptance checks are a script anyone can re-run ([P-16](patterns.md#p-16)).

<a id="l-41"></a>
**L-41. A disabled control without an explanation reads as broken.**

- Six greyed sliders with a padlock were the first thing in the list (F-25).
- Now: no control is shown disabled; a limitation is said in words next to the control.

<a id="l-42"></a>
**L-42. Change the interface for people without changing the interface for agents, and do it in a copy.**

- The redesign was built in a copy of the viewer while modellers kept rendering with the old one. Fourteen address-parameter sets give pixel-identical pictures in both (one deliberate change: the operator's-eye view now sits exactly on the eye point).
- Now: the comparison is acceptance test T49.

## Planning and documentation

<a id="l-43"></a>
**L-43. Build one asset first; extract the toolkit and write the Skill afterwards.**

- The toolkit-first draft was judged about a quarter premature (F-02).
- Now: the Skill was written after the build, from what was used.

<a id="l-44"></a>
**L-44. Before an adversarial review, have one agent take the owner's position and one ask "could this be simpler"; after it, have another check that the findings were closed.**

- The two critics turned the plan around in 7 and 18 minutes. The five adversarial reviewers then found about twenty blockers; none approved. A closure checker tracked 92 findings: 55 closed, 34 partly, 1 open, 2 declined.
- Now: [P-02](patterns.md#p-02), [P-03](patterns.md#p-03), [P-04](patterns.md#p-04).

<a id="l-45"></a>
**L-45. Do not narrow the goal to what looks achievable; report each aspect separately.**

- "Credible" had become "layout-credible" (F-10).
- Now: structure, sizes, looks and method each get their own verdict, and "unverified" is an allowed verdict.

<a id="l-46"></a>
**L-46. Record as you go: milestone images, a timeline, the reviewers' reports.**

- This wiki's pictures, timings and failure entries exist because each agent copied milestone images and appended timeline lines while it worked (472 lines by the time documentation began).
- Now: both are in the build brief ([P-20](patterns.md#p-20)).

<a id="l-47"></a>
**L-47. Estimates made before the tools exist are unreliable; compare them honestly afterwards.**

- The plan estimated 21–33 agent-hours and 10–20 million tokens for the build stages. The build to the round-2 model took about 6.4 agent-hours and 4.5 million tokens in under 2.5 hours elapsed. The comparison is not clean: the human gates, the separate acceptance author, the reviewer test and the second-object trial did not run.
- Now: the performance page states what was and was not included.

## Project hygiene

<a id="l-48"></a>
**L-48. Scan everything that can be committed for banned names, including file names and image bytes.**

- Planning files naming the client were copied into the project folder by the application, not by an agent (F-26).
- Now: the `banned words` check runs on every check run; the words are stored encoded. Binary files are scanned only for the never-allowed names, because short words occur by chance in compressed bytes (F-31).

<a id="l-49"></a>
**L-49. State data flows literally, and publish masked copies even when confidentiality is waived.**

- "On this machine only" was false the moment an agent viewed a photo (F-08). The owner waived confidentiality for the work; the deployed wiki is still public.
- Now: 11 masked photos (88 blurred regions, metadata removed and verified) are the only photographs in the repository ([P-17](patterns.md#p-17)).

<a id="l-50"></a>
**L-50. Left and right always mean the operator's.**

- Two photos were described as "from the rear left" when they are from the rear right (F-27).
- Now: the convention is in the asset contract; a direction in a caption is checked against a part that exists on one side only (the emergency stop and touchscreen are on the right).

## Running many agents

<a id="l-51"></a>
**L-51. Work in files, not in an agent's memory: then an interruption costs minutes, not work.**

- Seven agents stopped mid-task at a usage limit (F-30). Every one had written its pages, tools or model changes to disk as it went, so the replacements started from those files and nothing was redone.
- Now: every brief asks for incremental writes, milestone images and timeline lines; the coordinator keeps `coordinator-notes`, an agent-run table and the timeline outside the repository.

<a id="l-52"></a>
**L-52. After an interruption, prove the state before continuing: compare hashes, list what exists, run the checks.**

- The model files' timestamps had changed during the interruption; the coordinator compared the build with the reviewed snapshot (identical SHA-256, 0 parameter changes) before trusting it, and the full check run exposed a latent check bug (F-31).
- Now: recovery starts with build, hash comparison, `bun run check` and an inventory of pages and tools.

<a id="l-53"></a>
**L-53. Budget usage for parallel phases; a stopped agent cannot be resumed on an exhausted model.**

- The documentation phase ran seven agents at once. When the limit hit, resuming the stopped agents would have retried the exhausted model; fresh agents on another model, each told what already existed, finished the work.
- Now: the coordinator runs at most four agents at once in heavy phases and writes "continue from disk" briefs when restarting.

<a id="l-54"></a>
**L-54. A spot check is a legitimate close-out when the reviewer prescribes it; record who did it and what was looked at.**

- The round-2 reviewer accepted the model subject to three small fixes and said a spot check of those places sufficed. The coordinator inspected before/after renders of each place and the operator's-eye view and recorded the result, instead of a third full review.
- Now: the modelling-rounds page states the spot check and its scope; a larger change would need a fresh reviewer.

<a id="l-55"></a>
**L-55. A new machine finds what the development machine hides; let the pipeline refuse rather than trust the first run.**

- The first automatic deploy failed its checks on the GitHub runner (F-32): full Chrome asks for a favicon that the local headless browser never requests, and software rendering made a benchmark take two minutes. Nothing was uploaded, because the deploy refuses on any failed check.
- The model file's bytes also differ between the macOS and Linux builds (SHA-256 `0b6d8248…` locally, `7e71301a…` on the runner): floating-point functions differ slightly between platforms. Each platform is deterministic on its own (two builds, same hash), so the determinism check holds per platform and the live check compares against the build that was uploaded.
- Now: the CI-specific behaviour is explicit in the check (`CI` set: no frame-rate measurement); the deployed model's hash is the runner's.
