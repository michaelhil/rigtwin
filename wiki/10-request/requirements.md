---
title: Requirements and system features
tldr: The owner's requests broken down into 69 numbered requirements (R-01 to R-69) in thirteen groups, each with the owner's own words, plus the 25 concrete system features (SF-01 to SF-25) that follow from them.
status: stable
updated: 2026-11-23
tags: [request, requirements, features]
---

# Requirements and system features

## TL;DR

- 69 requirements, `R-01` to `R-69`, each one sentence, each traced to a short quote from [original-request.md](original-request.md). Typing errors in quotes are the owner's.
- They fall into thirteen groups: purpose; the asset; sources and gap filling; tooling; the agent process; the Skill; the viewer; project set-up; the planning process; the implementation; the wiki; GitHub and deployment; later requests.
- Requirements R-01 to R-47 come from the first request and the two messages during the investigation. R-48 to R-65 come from the approval message. R-66 to R-69 came during the build.
- Whether each requirement was met is not stated here. The status column points to [../70-results/goal-assessment.md](../70-results/goal-assessment.md), which is the only place that judges it.
- 25 system features, `SF-01` to `SF-25`, say what the system must contain to meet the requirements. (`F-` IDs are reserved for failures, hence `SF-`.)

## How to use this page

- Cite a requirement by its ID from any other page. IDs are stable and never reused.
- A requirement that is a question ("is it worth using Blender?") is written as "decide and justify". The answer is in the decision log or the plan, not here.
- "The owner" is the human factors researcher who commissioned the work. "The rig" is the white remote-operation station with two joysticks shown in the photographs.

Every row's status is: see [goal assessment](../70-results/goal-assessment.md).

## A. Purpose and scope

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-01 | Check whether an open, modular environment and workflow for modelling, evaluating and live-testing remote operating stations is feasible, including tool stack, workflow, capabilities and scope. | "check the feasibility of developing an open, modular envornment and worklow for modeling, evaluating (eg against ergonomic standrards) and live-testing" | [see goal assessment](../70-results/goal-assessment.md) |
| R-02 | Start with how to build custom 3D assets, since everything will revolve around a 3D environment. | "I first want you to focus on how to build custom 3D assets" | [see goal assessment](../70-results/goal-assessment.md) |
| R-03 | As the first step, make a credible 3D model of the rig using only the pictures. | "make a credible 3D model of that rog, using just the pictures" | [see goal assessment](../70-results/goal-assessment.md) |
| R-04 | Model only the white rig with the joysticks, and use only the pictures that show it. | "only use pictures of the rig (the white one with the joyrsticks)" | [see goal assessment](../70-results/goal-assessment.md) |
| R-05 | Keep the later validation and simulation or training work in mind during the modelling phase, although it is done separately later. | "Im just bringing these up as a heads-up so you can consider them in the modeling phase" | [see goal assessment](../70-results/goal-assessment.md) |
| R-06 | Make the approach reusable for many later tasks with different assets, use cases and clients. | "We will have many such tasks with varying assets and use cases" | [see goal assessment](../70-results/goal-assessment.md) |

## B. The asset

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-07 | Establish whether a credible model can be built from the pictures at all. | "is it feasible from the pictures?" | [see goal assessment](../70-results/goal-assessment.md) |
| R-08 | Say where data has to be enhanced or invented, such as the measurements the owner does not have. | "where to you have to enhance or invent certain data, such as the actual measurement, which i dont have" | [see goal assessment](../70-results/goal-assessment.md) |
| R-09 | Build the asset so it can be adjusted later when real measurements arrive. | "make sure the asset can be adjusted later if and when we have actual measureemnts" | [see goal assessment](../70-results/goal-assessment.md) |
| R-10 | Give the model a functional and structural decomposition, covering everything that can be parameterised or moved (screen, seat, joystick), instead of one monolithic object. | "The modal shouldnt just be a monolithic entitiy, instead it should have a functional and structureal decomposition" | [see goal assessment](../70-results/goal-assessment.md) |
| R-11 | Make the asset usable for assessment under different conditions, for example reach depending on seat position. | "assessment of the asset under different conditions (eg reachability depending on seat position)" | [see goal assessment](../70-results/goal-assessment.md) |
| R-12 | Make the asset usable later in a 3D training simulator. | "or if we want to use this in a 3D training simulator" | [see goal assessment](../70-results/goal-assessment.md) |
| R-13 | Choose a format for the asset that keeps its modularity and its parameters. | "What format should the asset be in, and how do we preserve modularity and parameterisability?" | [see goal assessment](../70-results/goal-assessment.md) |

## C. Sources, gap filling and the route from photo to model

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-14 | Explain how to get from pictures to a 3D model, and how the 3D structure is actually generated. | "how to go from picture to 3D model" … "how do we actually generate the 3D structure?" | [see goal assessment](../70-results/goal-assessment.md) |
| R-15 | Decide whether the rig must be isolated or extracted from the pictures, and describe how if it is. | "Do we need to isolate or extract the rig from the pictures?" … "how the rig is isolated from the packground int he photos , and if that is needed" | [see goal assessment](../70-results/goal-assessment.md) |
| R-16 | Describe in detail how missing data is filled in reliably. | "how augmentation is doen realiabliy" | [see goal assessment](../70-results/goal-assessment.md) |
| R-17 | Describe in detail how sizes are estimated. | "how sizes are estiamted" | [see goal assessment](../70-results/goal-assessment.md) |
| R-18 | Describe in detail how the parts are connected. | "how things are connecrted" | [see goal assessment](../70-results/goal-assessment.md) |
| R-19 | Build the model in a way that is both good in quality and simple. | "how do we build a model in a good-quality and simple way?" | [see goal assessment](../70-results/goal-assessment.md) |

## D. Tooling constraints

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-20 | Decide and justify whether Blender is worth using for asset generation and how to proceed if so; install it if needed, but consider alternatives. | "Is it worth using Blender for asset generation? if so, how do we proceed?" … "install Blender if needed, but also consider alternatives" | [see goal assessment](../70-results/goal-assessment.md) |
| R-21 | Decide whether the model can be generated natively or whether other tools are needed. | "can we do it natively , or are other tools needed" | [see goal assessment](../70-results/goal-assessment.md) |
| R-22 | Use open-source software only. | "always only opern source" | [see goal assessment](../70-results/goal-assessment.md) |
| R-23 | Use as few dependencies and as little external software as possible. | "use as few dependencies or external software as possible" | [see goal assessment](../70-results/goal-assessment.md) |
| R-24 | Reach the required quality with the simplest means. | "achieving my required quality goals with the simplest means" | [see goal assessment](../70-results/goal-assessment.md) |

## E. The agent process

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-25 | Decide where decomposition comes in: first, or after modelling. | "where the componet decomposition comes in (decomp first, then model; or other way around)" | [see goal assessment](../70-results/goal-assessment.md) |
| R-26 | Define who does the modelling and under what guidance. | "For the actual modeling, who does that, and under what guidance ?" | [see goal assessment](../70-results/goal-assessment.md) |
| R-27 | Define the thought process the modelling agent follows. | "what \"thought process\" does the modeling agent go thru when considering the modeling?" | [see goal assessment](../70-results/goal-assessment.md) |
| R-28 | Define who monitors that thought process, who gives feedback, and what feedback. | "who monitors this thought process , and who gies feadback (eg monitoring / guidance agent? what feedback should it give?)" | [see goal assessment](../70-results/goal-assessment.md) |
| R-29 | Define how far the modelling is step by step and iterative. | "To what extent is the modeling process step-by-step and iterative?" | [see goal assessment](../70-results/goal-assessment.md) |
| R-30 | Balance iteration against a good pace, say what is needed and why, and check that the approach is the right one. | "How do we balance this against good pace of progress; what is needed and why; do we use the right appraoch?" | [see goal assessment](../70-results/goal-assessment.md) |
| R-31 | Define how the agent observes and controls the modelling. (The owner wrote "monitoring"; read as the modelling.) | "How does the agent observe and control the monitoring?" | [see goal assessment](../70-results/goal-assessment.md) |
| R-32 | Define how the agent knows it is finished. | "when does it know it is finished" | [see goal assessment](../70-results/goal-assessment.md) |
| R-33 | Define how checking and documentation are done. | "how does it do the checking and documentation?" | [see goal assessment](../70-results/goal-assessment.md) |

## F. The Skill

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-34 | Document the decomposition method, the general modelling approach, guidance and targets in an Agent Skill. | "should all be documented in a Agent Skill" | [see goal assessment](../70-results/goal-assessment.md) |
| R-35 | Make the Skill refinable, reusable and good, because it is the foundation for later assets. | "that can be refined and re-used" … "this Skill is foundational and has to be good" | [see goal assessment](../70-results/goal-assessment.md) |

## G. The viewer

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-36 | Provide a good way to view the asset in a web browser. | "Consider a good envirnment to view the asset in a web browser" | [see goal assessment](../70-results/goal-assessment.md) |
| R-37 | Check the 3D capability of the owner's Leitbild project and reuse its ideas, unless something better comes up. | "check the Leitbild 3D capability on this machine and see if any of those ideas can be re-used (but dont use these if some better soultions come up)" | [see goal assessment](../70-results/goal-assessment.md) |

## H. Project set-up

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-38 | Turn the feasibility test into a project on GitHub. | "We want to turn this feasibility test into a project on github" | [see goal assessment](../70-results/goal-assessment.md) |
| R-39 | Consider and suggest suitable project names. | "consdier and suggest suitable names" | [see goal assessment](../70-results/goal-assessment.md) |
| R-40 | Create a local project folder on the owner's machine. | "create a local folder on this machine" | [see goal assessment](../70-results/goal-assessment.md) |

## I. The planning process itself

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-41 | Use a team of specialist agents for the investigation and planning. | "set up a specialist agent teams to do the investigation and planning" | [see goal assessment](../70-results/goal-assessment.md) |
| R-42 | Include an agent that takes the owner's position. | "including agent that take my position" | [see goal assessment](../70-results/goal-assessment.md) |
| R-43 | Include an agent that asks throughout whether this could be simpler. | "an agent that monitors from the perspective \"could this be simpler\"" | [see goal assessment](../70-results/goal-assessment.md) |
| R-44 | Produce a detailed plan that meets the goals at the highest level and describes every critical aspect in detail. | "make a detailed plan to achieve my goals at the highest level" … "describes all critical aspects in detail" | [see goal assessment](../70-results/goal-assessment.md) |
| R-45 | Have a completely new team review the plan adversarially and ruthlessly, find and fix flaws, and check it against the goals and standards. | "with a completeley new fresh agent teams, make a complete adversarial and ruthless review of the plan, identify and fix any flaws" | [see goal assessment](../70-results/goal-assessment.md) |
| R-46 | Present the plan for approval with its significant choices, uncertainties and open questions. | "present the plan for approaval, including any significant choices, uncertainties and open questions" | [see goal assessment](../70-results/goal-assessment.md) |
| R-47 | Ask the owner questions at any stage when needed. | "at any stage, ask me questions if needed" | [see goal assessment](../70-results/goal-assessment.md) |

## J. The implementation request

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-48 | Find out how and why the left joystick was missing from the first result, and how to prevent that kind of failure. | "it is missing the joystick on the left side; investigate how and why this failure occurred and how it can be avoided in the future" | [see goal assessment](../70-results/goal-assessment.md) |
| R-49 | Use the owner's scale figures: room 4.5 m deep, 5.8 m wide, 2.48 m high; platform 1.5 × 1.5 m; seat 1.4 m high; head to display 1.2 m. | "some scale guidance: \"room that is in the pictures 4,5 m deep, 5,8 m wide and 2,48 m to the ceiling …\"" | [see goal assessment](../70-results/goal-assessment.md) |
| R-50 | Carry out a full test implementation of the pipeline. | "Now do a full test implementation of the pipeline" | [see goal assessment](../70-results/goal-assessment.md) |
| R-51 | Deliver a rotatable, zoomable, high-quality 3D version of the rig as an asset in a browser window. | "a rotatable, zoomable, high-quality  3D version of the rig as an asset in a browser window" | [see goal assessment](../70-results/goal-assessment.md) |
| R-52 | Let the user show or hide every element that was identified and modelled as a component. | "the ability to show / hide any element that was identified and modeled as a component" | [see goal assessment](../70-results/goal-assessment.md) |
| R-53 | Check the work regularly, above all the modelling quality; if quality is not reached in a few iterations, find the cause, change assumptions, tools or process, and try again. | "Regularly check your work" … "go back and find the cause, adjust your assumptions, tools, processes workflows etc if needed, and try again" | [see goal assessment](../70-results/goal-assessment.md) |
| R-54 | Use a separate, ruthless reviewing agent that will not accept a toy version of the rig. | "Have a separate ruthless agent who will not accept a micky-mouse version of the rig" | [see goal assessment](../70-results/goal-assessment.md) |
| R-55 | Make the model credible and usable for the intended evaluation and training work; photorealism is not required. | "we dont need need photrealistic copy, but it needs to be credible and usable for the intended evaluation and training precesses" | [see goal assessment](../70-results/goal-assessment.md) |
| R-56 | Do not make the model more detailed than needed, so that viewing and modelling both stay fast. | "make sure you dont make the model unnecessarily detailed, so we have good viewing performance and good performance during the modeling" | [see goal assessment](../70-results/goal-assessment.md) |

## K. The wiki

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-57 | Once the model is complete and verified in the browser, write a complete wiki about the proof of concept: the request, requirements and features, options, the plan and its justification, stack and process, the implementation with performance data, lessons and changes, the final result with critique, justification and next steps. | "write a complete llm-wiki about this proof of concept, including my original request, breakdown into key requirements and system features, options considered …" | [see goal assessment](../70-results/goal-assessment.md) |
| R-58 | Give the wiki a structure that can grow, that people can read, and that is the single source of truth for AI agents continuing the work. | "a good structure that can be extended as the project grows, making sure that it is human-readable, but also the single-source-of-truth reference for AI agents" | [see goal assessment](../70-results/goal-assessment.md) |
| R-59 | Include screenshots: the original photos, the model during modelling, and the result in the browser. | "include screenshots such as the original photos, screenshots during the modeling, and the results in the browser" | [see goal assessment](../70-results/goal-assessment.md) |
| R-60 | Document lessons, successes, failures, improvements, ideas, processes, algorithms, patterns, pipelines, skills and tools clearly and findably, with short summaries. | "document clearly  and easily findable all lessons learned, successes, failures, improvements, ideas, processes, algorithms, patterns, pipelines , agent skills and tools, etc; and short summaries / TLDRs" | [see goal assessment](../70-results/goal-assessment.md) |
| R-61 | Keep the wiki inside the repository. | "This wiki should be part of the repo." | [see goal assessment](../70-results/goal-assessment.md) |

## L. GitHub and deployment

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-62 | When everything is complete and verified, push the project to GitHub as a private repository. | "push it to github as a private repo" | [see goal assessment](../70-results/goal-assessment.md) |
| R-63 | Keep the rig maker's name out of the repository. | "Do not mention the name \"[rig maker]\" in the repo." | [see goal assessment](../70-results/goal-assessment.md) |
| R-64 | Deploy the viewer to the owner's production server at `mightwork.ai/rigtwin`, with a pipeline so that later updates are pushed the same way. | "deploy a version of the viewer to my prod box mightwork.ai, building a pipeline so that future updates will be pushed to prod" … "use mightwork.ai/rigtwin for the live viewer" | [see goal assessment](../70-results/goal-assessment.md) |
| R-65 | Publish the wiki on the production server as a subfolder, at `mightwork.ai/rigtwin/wiki`. | "also have the wiki on prod as a subfolder" … "mightwork.ai/rigtwin/wiki for the wiki" | [see goal assessment](../70-results/goal-assessment.md) |

## M. Later requests, during the build

| ID | Requirement | The owner's words | Status |
|---|---|---|---|
| R-66 | Use a simple project name that is neither German nor Norwegian. (The owner then chose `rigtwin`.) | "all bad. keep it simpler. no german or norwegian" | [see goal assessment](../70-results/goal-assessment.md) |
| R-67 | Write the viewer in TypeScript, not JavaScript. (Asked as a question; read as a requirement.) | "why is viewer.js a js and not ts" | [see goal assessment](../70-results/goal-assessment.md) |
| R-68 | Simplify the viewer's interface after a review by independent interface-design agents, above all the controls for a single component. | "it is overcomplicated and takes a lot of time. do a pass with an indpendent UI/UX agents and find simplifiactions, especially simplifying controls for a single componet" | [see goal assessment](../70-results/goal-assessment.md) |
| R-69 | Let the user adjust the seat; do not show a lock the user cannot open. | "why cant i adjust the seat? the lock is confusing for users unless there is a way to unlock" | [see goal assessment](../70-results/goal-assessment.md) |

## Readings that were made explicit

Three requirements depend on how a sentence is read. Only the first reading was put to the owner
explicitly (in the plan, with "say if datasheets are out"); no objection was recorded.

| Requirement | Reading taken | Where stated |
|---|---|---|
| R-03 "using just the pictures" | The 11 rig photographs plus public vendor datasheets for the purchased parts visible in them. | Plan, questions section; decision D-19 |
| R-31 "observe and control the monitoring" | Observe and control the modelling. | Not stated anywhere; implied by how the plan answers the question |
| R-49 "a seat mounted on it that is 1,4 m high" | Top of the seat back above the platform deck. The reading is flagged, and the photographs gave a different value; see decision D-24. | The build's working contract and the coordinator's notes |

## System features derived from the requirements

These are the concrete things the system has to contain. They are requirements on the system, not a
report of what exists; for what was built see the pages under `50-implementation/` and the
[goal assessment](../70-results/goal-assessment.md). Terms are explained in the
[glossary](../00-overview/glossary.md).

| ID | Feature | Serves |
|---|---|---|
| SF-01 | **Parameter files with sources and ranges.** One record per independent number: value, unit, range, provenance class, basis, tier and evidence text. The loader refuses a record with a missing field. | R-08, R-09, R-16, R-13 |
| SF-02 | **A path for real measurements.** A measured value replaces an estimate as data; the model rebuilds with no change to code, and the old estimate stays visible. | R-09, R-49 |
| SF-03 | **A deterministic generator.** Code that turns the parameter files into geometry using a small kit of shape operations (box, extrude, revolve, sweep, loft, faceted cage, mirror, bevel). The same inputs give the same file, byte for byte. | R-14, R-19, R-21, R-24 |
| SF-04 | **A two-file asset.** One model file (GLB) and one description file (JSON manifest) per asset, tied together by the model file's fingerprint. | R-13, R-12 |
| SF-05 | **A component tree with stable names.** One named node per component, joint frame, reference frame and screen surface. A part's parent is whatever carries it. | R-10, R-52 |
| SF-06 | **Joints.** Each has a type, an axis, limits, a neutral value, a kind (adjustment or runtime control), an evidence level (seen, inferred, assumed) and, for controls, a signal name a simulator can bind to. | R-10, R-11, R-12 |
| SF-07 | **Reference frames and functional surfaces.** Origin, floor, two estimated seat references, joystick grips, pedal faces, emergency stop, a provisional eye point; each screen's active area as its own surface. All built by code from parameters. | R-11, R-12, R-05 |
| SF-08 | **Three kinds of variable kept apart.** Design parameters (baked into geometry), adjustments (a node movement with limits, no rebuild) and runtime controls (a node movement or state with a signal name). | R-13, R-10 |
| SF-09 | **A photo measurement procedure.** Camera data from each photo's metadata, cameras solved per rig instance, named gauge features, a scale closure step, landmarks triangulated where two views exist, every dimension labelled two-view, single-view or by-eye. | R-17, R-15, R-07 |
| SF-10 | **A source hierarchy for gap filling.** Nine ranked sources from "real measurement" down to "plain guess", each mapped to a provenance class that travels with the value. | R-16, R-08 |
| SF-11 | **Connection records.** Parent–child link, mount frame and joint record for every attachment, with the evidence for it and the observation that would prove it wrong. | R-18, R-10 |
| SF-12 | **Photo-matched views.** The model rendered through each photograph's solved camera and laid over the photograph. | R-31, R-33 |
| SF-13 | **One renderer for people and agents.** The browser viewer, driven without a window, produces the agent's images: standard views, contact sheets, views coloured by component. | R-31, R-36, R-24 |
| SF-14 | **Checks on every build.** Parameter records complete; names valid; geometry valid; file format valid; two builds identical; each joint moves exactly its own subtree; left and right counterparts present; size and triangle budget kept; banned words absent. | R-32, R-33, R-56, R-63 |
| SF-15 | **A coverage check.** Every component in the tree is either in the model file or in an `omitted` list with a reason. Exists because an early trial silently lacked the whole left armrest pod. | R-48, R-52 |
| SF-16 | **A modeller's loop.** Per component: collect evidence, identify, take dimensions from the measurement table, name the signature features, build, check, render, look, decide; with a cap on iterations. | R-26, R-27, R-29, R-30 |
| SF-17 | **An independent reviewer.** A separate agent that compares renders with photographs, reports findings per component and cannot be overruled by the builder's own account. | R-28, R-54, R-53 |
| SF-18 | **A browser viewer.** A static page that loads the two asset files and lets the user orbit and zoom, with lighting and materials good enough that the first impression is not a flat-shaded toy. | R-51, R-36, R-55 |
| SF-19 | **Show and hide per component.** Every modelled component and every component group can be switched on and off in the viewer. | R-52 |
| SF-20 | **Adjustment controls generated from the joints.** A small set of controls for the selected part; adjustments that are only assumed stay usable and are marked as assumed. | R-11, R-68, R-69 |
| SF-21 | **A performance budget.** At most 150,000 triangles, 4 MB and 80 draw calls for the whole rig; a build well under 5 seconds. | R-56, R-51 |
| SF-22 | **A reusable template.** The Agent Skill, the reviewer definition, the toolkit and the viewer together, so a new asset starts from them. | R-34, R-35, R-06 |
| SF-23 | **A wiki with generated index.** Pages with a summary block, stable IDs, a log, masked images and a record of timings. | R-57, R-58, R-59, R-60, R-61 |
| SF-24 | **Privacy and naming guards.** Source photographs and anything containing their pixels stay outside the repository; published images are masked; a check scans every file for banned names. | R-63, R-62 |
| SF-25 | **A deployment pipeline.** One command builds, checks, packages the viewer, asset and wiki, copies them to the server and verifies the live pages. | R-64, R-65 |

## Coverage of requirements by features

Requirements about deciding, explaining or organising (R-01, R-02, R-20, R-22, R-23, R-25,
R-37 to R-47, R-50, R-66, R-67) are met by documents and decisions, not by system features. They are
answered in [../20-decisions/decision-log.md](../20-decisions/decision-log.md),
[../20-decisions/options-considered.md](../20-decisions/options-considered.md) and
[../30-plan/approved-plan.md](../30-plan/approved-plan.md).
