---
title: Project log
tldr: The dated, append-only record of the project - from the owner's first request through planning, plan approval, implementation, the owner's mid-run requests, the model reviews, the viewer redesign, the usage-limit interruption and recovery, to the final fixes. Newest entries at the bottom; append, never rewrite.
status: living
updated: 2026-11-23
tags: [meta, log, history]
---

# Project log

## TL;DR

- One entry per significant event, oldest first. **Append new entries at the end**; correct an old entry only by adding a new one that says so.
- Times are **local time (CET, UTC+1)**, converted from the UTC time stamps of the project's timeline file; where no time stamp exists the entry says "time not recorded".
- 2026-11-23 is the whole history so far: about 3.5 hours of planning, then implementation from 18:15 to the reviewed model at 21:01, an interruption at about 21:03, and the final fixes by 21:51.
- Each entry links the page that has the detail.

How to add an entry: the date as a heading if it is new, then a line "**HH:MM** — what happened, why, links".
Agents finishing a piece of work add an entry here (see the [wiki conventions](README.md)).

## 2026-11-23

**Time not recorded (early afternoon; about 14:45 if the planning phase took 3.5 hours)** — The
owner's original request: check the feasibility of an open, modular workflow for modelling,
evaluating and live-testing remote-operation stations; first, a credible 3D model of one rig from
its photos; investigate and plan with a specialist agent team, including an agent taking the owner's
position and one asking "could this be simpler", then a fresh adversarial review, then present the plan
for approval. [Original request](10-request/original-request.md), [requirements](10-request/requirements.md).

**Time not recorded** — Investigation: eight specialist agents in parallel (photo evidence and
measurement, reconstruction methods, toolchain and format, decomposition and human-factors semantics,
agent process and Skill design, reuse, viewer and naming, and two hands-on trials building the same
small brief with Blender as a library and with TypeScript and three.js). 218 agent-minutes.
[Research sources](80-reference/sources.md), [options considered](20-decisions/options-considered.md).

**Time not recorded** — During the investigation the owner asked to model only "the white one with the
joysticks" (Rig B; [R-04](10-request/requirements.md)) and that the plan describe in detail how missing
data is filled, how the rig is isolated from the background, how sizes are estimated and how parts are
connected ([R-15](10-request/requirements.md) to [R-18](10-request/requirements.md)).

**Time not recorded** — Plan draft 1 (a toolkit-first plan); critiques by the owner's advocate and the
simplicity monitor; draft 2 (asset first); five fresh adversarial reviewers approved none of it (92
blocker and major findings); version 3 written against them; a closure check found 55 findings closed,
34 partly, 1 open, 2 declined with reasons. [Approved plan](30-plan/approved-plan.md#9-how-the-plan-was-made),
[F-02](60-lessons/failures-and-fixes.md#f-02) to [F-10](60-lessons/failures-and-fixes.md#f-10).

**Before 18:15** — The owner reviewed the plan: the trial model was missing the left joystick, with a
request to find out why ([F-01](60-lessons/failures-and-fixes.md#f-01)); scale figures from memory
(room 4.5 × 5.8 × 2.48 m, platform 1.5 × 1.5 m, seat 1.4 m high, head to display 1.2 m); answers:
internal test, confidentiality no concern ([D-21](20-decisions/decision-log.md#d-21)). **Plan
approved**, with the request for a full autonomous test implementation, a separate ruthless reviewer,
a complete wiki, a private GitHub repository and deployment to the owner's server
([D-22](20-decisions/decision-log.md#d-22), [deviations](30-plan/deviations.md)).

**Time not recorded** — Project name: the owner rejected the suggested names ("keep it simpler. no
german or norwegian") and chose **rigtwin**; public addresses `/rigtwin` for the viewer and
`/rigtwin/wiki` for the wiki on the owner's server ([D-23](20-decisions/decision-log.md#d-23),
[D-32](20-decisions/decision-log.md#d-32)).

**18:15** — Implementation started with three agents in parallel: infrastructure (generator, viewer,
checks, render driver, first blockout), measurement (cameras, scale closure, dimension table) and
masked photo copies for the wiki. [Agent process](40-method/agent-process.md),
[timeline](50-implementation/timeline-and-performance.md).

**Between 18:15 and 19:00** — The owner asked "why is viewer.js a js and not ts". The infrastructure
agent converted the viewer to TypeScript, bundled by Bun, sharing one pose function with the generator
([F-23](60-lessons/failures-and-fixes.md#f-23), [D-29](20-decisions/decision-log.md#d-29)).

**18:38** — Masked photos done: 11 photos, 88 masked regions, metadata removed, contact sheet and
captions in `wiki/img/photos/`.

**19:00** — First complete blockout: every component on both sides, 20 joints, 11,162 triangles, all
checks pass. [Modelling rounds](50-implementation/modeling-rounds.md#the-first-complete-blockout).

**19:03** — Measurement done: five cameras solved, scale closes within 0–2 % against purchased parts,
118 dimension records; the deck is 1.41 m front to back and the seat back top 1.28 m above the deck,
so the owner's figures conflict with the photos; the touchscreen is the 13.3-inch size.
[Measurement results](50-implementation/measurement-results.md), [D-24](20-decisions/decision-log.md#d-24),
[D-34](20-decisions/decision-log.md#d-34).

**19:05** — Round 1: three modellers in parallel (seat; pods; platform, stand and pedals), each in its
own workspace ([D-26](20-decisions/decision-log.md#d-26)).

**Before 19:21** — The owner: "in review, look at the UI. it is overcomplicated and takes a lot of
time", asking for independent interface reviews and simpler controls for a single component
([R-68](10-request/requirements.md)). Two independent interface reviews ran from about 19:21 to 19:37.
[Viewer](50-implementation/viewer.md).

**Before 19:35** — The owner: "why cant i adjust the seat? the lock is confusing for users unless there
is a way to unlock" ([R-69](10-request/requirements.md), [F-25](60-lessons/failures-and-fixes.md#f-25)).
Answered in interface review A: no lock; usable sliders tagged "assumed range" with a notice
([D-31](20-decisions/decision-log.md#d-31)).

**19:38** — A separate implementer started the viewer redesign in a copy of the viewer folder
([D-30](20-decisions/decision-log.md#d-30)).

**19:46** — Round 1 assembled by the coordinator: 30,742 triangles, 68 draw primitives, 0.77 MB, all
checks pass.

**19:48–20:14** — Independent review, round 1: **not accepted** ("a credible layout carrying a few
toy-grade parts"): 28 components accepted, 9 with minor fixes, 8 rejected; three moving parts failed
when moved; whites overexposed; eye point too high. [Modelling rounds](50-implementation/modeling-rounds.md#the-round-1-verdict),
[F-18](60-lessons/failures-and-fixes.md#f-18) to [F-22](60-lessons/failures-and-fixes.md#f-22).

**20:15–20:30** — Round 2: the same three modellers resumed with the findings for their groups:
smooth upholstery, one-piece pod legs, joystick boots that flex, a monitor arm that follows the
monitor, pedals clear of the frame, three eye points, matte materials. 28,042 triangles.

**20:40–20:42** — Viewer redesign finished: 16 controls instead of 103, the model 82.8 % of the window,
a card per selected part, exposure corrected (lit whites 244–249 → 221–231 of 255). The coordinator
ran the 53 acceptance checks (all passed), checked the page by hand and swapped the new viewer in.
[Viewer](50-implementation/viewer.md).

**20:43–21:01** — Independent review, round 2, by a fresh reviewer: **accepted after the listed fixes**:
41 accepted, 5 with minor fixes, 0 rejected; round-1 findings 24 closed, 3 partly, 1 open (the owner's
figures, which need a tape). Three small fixes required.
[Modelling rounds](50-implementation/modeling-rounds.md#the-round-2-verdict).

**About 20:45** — Documentation and publishing started with five agents in parallel: three wiki
writers, the publishing tools (wiki index, lint and site; documentation images; deployment script) and
the Skill author.

**About 21:03** — The model's usage limit was reached. Seven agents stopped mid-task: the three wiki
writers, the publishing-tools agent, the Skill author and the two modellers about to apply the round-3
fixes. Nothing was lost: every agent had written to files as it went.
[Timeline](50-implementation/timeline-and-performance.md#phases-in-order).

**21:32** — Recovery: the owner switched the session to another model. The coordinator confirmed that
the model on disk was byte-identical to the reviewed round-2 build, listed which pages and tools
existed, fixed a false positive of the banned-word check (a three-letter word matched by chance inside
two compressed JPEGs; image bytes are now scanned only for the never-allowed names), and launched fresh
agents with "continue from disk" briefs.

**21:35–21:51** — Round 3 by one agent: cup recess on both pods, flat-faced stand columns, lighter
black rubber and plastic, and the joint-limit rounding bug. Build `0b6d8248b63f`: 28,070 triangles,
67 draw primitives, 0.72 MB; all checks pass; 53 of 53 viewer acceptance checks. The coordinator
spot-checked the three places, as the round-2 reviewer had prescribed, and accepted them.
[Modelling rounds](50-implementation/modeling-rounds.md#round-3-the-final-fixes).

**21:50–21:57** — Deployment tool tried: a first run refused to deploy right after the check; a second
stopped at the distribution step on broken wiki links (pages still being written; nothing was
uploaded); a dry run then completed in 16.6 s; end-to-end runs against a local test server followed.
The web-server site file was validated on the production server and not yet installed.
[Deployment](50-implementation/deployment.md).

**From 21:35** — Wiki, second pass: the summary, glossary, this log, the implementation pages
(timeline and performance, measurement results, modelling rounds, viewer, tech stack) and the reference
pages for tools and for the Skill and agents were written from the run's records.
[Summary](00-overview/summary.md).

**About 22:20** — Results pages written (model card, gallery, critique, goal assessment,
next steps); the coordinator's final wiki pass filled every open marker, added failures F-29 to F-31 and
lessons L-51 to L-54; wiki lint clean (37 pages, 104 images, 0 errors). [Goal assessment](70-results/goal-assessment.md).

**About 21:55** — Final browser verification of the round-3 model by the coordinator (show/hide, the
selected-part card, the joystick pad, the address carrying the state). [Goal assessment](70-results/goal-assessment.md#pending-items).

**22:18** — Private GitHub repository created and the first commit (`5d673d1`) pushed, after checking
that nothing private, unmasked or personal was staged.

**22:20** — Web-server site for `mightwork.ai` installed on the production host, full configuration
validated, server reloaded; every other site on the host answered as before; certificate obtained.

**22:21** — First release deployed with `bun run deploy` in 24.8 s; all nine live checks passed.
Viewer at <https://mightwork.ai/rigtwin/>, wiki at <https://mightwork.ai/rigtwin/wiki/>.
[Deployment](50-implementation/deployment.md#production-state).

**About 22:30** — Wiki updated with the production state, committed, pushed and redeployed through the
same pipeline (second release; the script switched releases and re-checked the live site).

**About 23:10** — The owner chose automatic deployment. Set up: an unprivileged server account
`rigtwin-deploy` behind a forced-command gate that allows only the deploy script's commands inside
`/srv/rigtwin`; a new key stored as a GitHub secret; the server's host key pinned; a GitHub Actions
workflow running `bun run deploy --no-images` on every push to `main`. A manual deploy through the new
account worked (release `ac78fc6`). [D-37](20-decisions/decision-log.md#d-37),
[deployment](50-implementation/deployment.md#continuous-deployment-from-github).

**About 23:31** — The first automatic run refused to deploy: the check failed on the runner (favicon 404
in full Chrome; a two-minute software-rendered benchmark). Fixed and pushed.
[F-32](60-lessons/failures-and-fixes.md#f-32).

**About 23:35** — The second automatic run was refused too: Chrome did not start within 5 s on a cold
runner. Start-up limit raised to 30 s; pushed again. [F-32](60-lessons/failures-and-fixes.md#f-32).

**23:35** — The third automatic run deployed: every check passed on the runner, release
`20261123T223434Z-66c7bbd` went live in 70.1 s, all nine live checks passed, and the server's gate
allowed each of its commands. From now on every push to `main` deploys.
[Deployment](50-implementation/deployment.md#continuous-deployment-from-github).
