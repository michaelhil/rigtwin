---
title: Timeline and performance
tldr: How long everything took on 2026-11-23, phase by phase - about 3.5 hours of planning with 16 agents, then 2 hours 46 minutes from the first implementation step to the round-2 verdict with 14 agent runs - with every agent run's duration, tokens and tool calls, the measured run times of every tool, and the model's size at each stage. All figures come from one Apple M2 machine and one run.
status: living
updated: 2026-11-23
tags: [performance, timeline, agents, implementation]
---

# Timeline and performance

## TL;DR

- **Planning** (investigation, two trials, critiques, five adversarial reviews, a closure check): 16 agents, 336 agent-minutes, 4.48 million tokens, about **3.5 hours** elapsed.
- **Implementation to the round-2 verdict:** 14 agent runs (11 agents, three resumed once), 402 agent-minutes, 4.93 million tokens, **2 h 46 min** elapsed (17:15–20:01 UTC). Agents ran in parallel, so agent time is 2.4 times the elapsed time.
- **The tools are not the bottleneck:** a full build takes 0.19 s, all checks 4.2 s, a contact sheet 1.4 s plus 0.4 s browser start, the viewer's 53 acceptance checks 115 s. Agents' reading and thinking take the minutes.
- **Model size by stage:** blockout 11,162 triangles → round 1 30,742 → round 2 28,042 → round 3 28,070; budget 150,000. The GLB stayed under 0.8 MB against a 4 MB budget.
- A **usage limit** stopped seven agents at about 20:03 UTC; work resumed on another model at 20:32 with nothing lost. Documentation, round 3 and deployment figures from the agent harness are pending.

All figures come from **one Apple M2 machine and one run** of the project; treat them as indications,
not benchmarks. Times are **UTC** on 2026-11-23 (local time is UTC+1).

## Where the figures come from

| Kind of figure | Source | Reliability |
|---|---|---|
| Agent duration, tokens, tool calls | the agent harness, when each agent finished (copied into the coordinator's run table) | *measured*; the only source used for agent time |
| Tool run times (build, check, render, dist, acceptance, wiki) | lines the tools write themselves into the timeline file, with seconds measured by the tool | *measured* |
| Clock times of events | timestamps of the timeline lines; file modification times where noted | *measured*; file times are *inferred* |
| Durations written by agents about their own work | agent-written timeline lines | **unreliable**: three were wrong ([F-28](../60-lessons/failures-and-fixes.md#f-28)); used only as notes |
| Planning-phase clock times | not in the timeline (it starts at implementation) | the 3.5 h is the coordinator's estimate |

The timeline file had 613 lines by 20:53 UTC. All 613 are valid JSON. 24 have no seconds value
(start markers and summaries). 8 are out of order: agent-written lines with hand-entered timestamps
appended later (the photo-masking agent's first four lines, the round-3 agent's four step lines).
Three corrections were written by the agents themselves: the structure modeller's two summary lines
(169 s and about 600 s, really about 27 min; its start marker had been overwritten), the pods
modeller's study time (first "about 25 min", corrected to about 15), and the round-1 reviewer's
"total review about 45 min" (its own start and end stamps and the harness say 26–27 min). Lines from
tools run without `RIGTWIN_AGENT` carry the name `unnamed` (14 lines).

## Phases in order

| # | Phase | Clock (UTC) | Elapsed | Agent runs | Agent time | Tokens |
|---|---|---|---|---|---|---|
| 1 | Investigation and planning: eight specialist investigations including two hands-on trials, draft 1 | start not recorded (about 13:45 if the 3.5 h estimate holds) | | 8 | 218.2 min | 2,103,397 |
| 2 | Critiques of draft 1 (owner's advocate, simplicity monitor), draft 2 | | | 2 | 24.5 min | 495,130 |
| 3 | Adversarial reviews of draft 2, version 3 | | | 5 | 80.7 min | 1,605,617 |
| 4 | Closure check of version 3, final edits, the owner's approval | ends before 17:15 | | 1 | 12.9 min | 280,841 |
| | **Planning, all** | | **about 3.5 h** | **16** | **336.3 min** | **4,484,985** |
| 5 | Infrastructure and first blockout; measurement; masked photos for the wiki (in parallel) | 17:15–18:03 | 48 min | 3 | 116.9 min | 1,184,277 |
| 6 | Modelling round 1, three groups in parallel; coordinator assembles at 18:46 | 18:05–18:46 | 41 min | 3 | 104.1 min | 1,523,785 |
| 7 | Two independent interface reviews (in parallel with round 1) | about 18:21–18:37 | 16 min | 2 | 31.6 min | 556,899 |
| 8 | Independent review, round 1 | 18:48–19:14 | 26 min | 1 | 26.8 min | 301,737 |
| 9 | Viewer redesign by a separate implementer, in a copy; coordinator's acceptance run 19:42 | 18:38–19:40 | 62 min | 1 | 61.9 min | 540,630 |
| 10 | Modelling round 2, the same three modellers resumed | 19:15–19:30 | 15 min | 3 | 41.9 min | 407,597 (increase over round 1) |
| 11 | Independent review, round 2 (a fresh reviewer) | 19:43–20:01 | 18 min | 1 | 18.4 min | 410,935 |
| | **Implementation to the round-2 verdict** | **17:15–20:01** | **2 h 46 min** | **14** | **401.6 min** | **4,925,860** |
| 12 | Documentation, first pass: three wiki writers, the publishing tools, the Skill author (in parallel) | about 19:45–20:03 | about 18 min | 5 | not reported (stopped) | not reported |
| 13 | Interruption by the usage limit, and recovery | 20:03–20:35 | about 32 min | — | — | — |
| 14 | Round 3: the three final fixes and a limit bug (fresh agent on Opus 5.5) | 20:34–20:51 | 17 min | 1 | 17.3 min | 339,041 |
| 15 | Documentation, second pass (two wiki writers) and publishing tools finished (fresh agents on Opus 5.5); coordinator's final wiki pass | 20:34–21:30 | about 56 min | 3 | 79.1 min | 1,331,395 |
| 16 | GitHub (private repository, first commit) and deployment: web-server site installed, first release live, second release through the pipeline | 21:18–21:30 | about 12 min | — (coordinator) | — | — |

**Planning** is described in [How the plan was made](../30-plan/approved-plan.md#9-how-the-plan-was-made);
its reports are summarised in [Research sources](../80-reference/sources.md). **Implementation** is
described in [The agent process](../40-method/agent-process.md) and, for the model, in
[Modelling rounds](modeling-rounds.md).

**The interruption (phases 12–13).** At about 20:03 the model's usage limit was reached. Seven agents
stopped mid-task: the three wiki writers, the publishing-tools agent, the Skill author and the two
modellers who were about to apply the round-3 fixes. The timeline has no line between 20:03:11 and
20:32:20, and the wiki pages and Skill files written by the first pass stop changing at 20:01–20:03
(*file times*). The owner switched the session to another model. Recovery: the coordinator checked
that the model on disk was byte-identical to the reviewed round-2 snapshot (same SHA-256, build at
20:32:53), listed which pages and tools existed, and launched fresh agents with briefs saying what the
previous agent had finished. Its first check at 20:32 failed once; the check passed at 20:33 after the
banned-word check was changed to scan image bytes only for the never-allowed names (a three-letter
device-maker word had matched by chance inside two compressed JPEGs; the check's file time is 20:33,
so the link between the two is *inferred*). Nothing was lost, because every agent wrote to files as
it went and the coordinator keeps working notes and the timeline ([P-19](../60-lessons/patterns.md#p-19),
[L-46](../60-lessons/lessons-learned.md#l-46)). Resuming a stopped agent on the exhausted model was not
possible; the remedy was a fresh agent with a "continue from disk" brief.

**Against the plan's estimate.** The plan estimated 21–33 agent-hours for stages A to D. The build to
the round-2 verdict took 6.7 agent-hours (401.6 min). The comparison is not clean: the human gates, a
separately written acceptance spec, the reviewer test and the second-object trial did not run
([deviations](../30-plan/deviations.md#time-against-the-plans-estimate),
[L-47](../60-lessons/lessons-learned.md#l-47)).

## Every agent run

From the agent harness. Duration is wall clock for that agent. Tokens of the three resumed modellers
are reported cumulatively by the harness; the increase for round 2 is given in brackets and used in
the totals. Tool calls are per run.

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
| *Investigation, 8 agents* | | *218.2* | *2,103,397* | *542* |
| Critique of draft 1 | Owner's advocate | 6.7 | 166,286 | 15 |
| Critique of draft 1 | Simplicity monitor | 17.8 | 328,844 | 28 |
| *Critiques, 2 agents* | | *24.5* | *495,130* | *43* |
| Adversarial review | Compliance and pre-mortem | 11.2 | 196,322 | 20 |
| Adversarial review | Process and Skill | 13.3 | 295,987 | 39 |
| Adversarial review | Technical | 16.8 | 338,510 | 35 |
| Adversarial review | Human factors and downstream use | 17.7 | 324,553 | 65 |
| Adversarial review | Evidence audit | 21.7 | 450,245 | 44 |
| *Adversarial reviews, 5 agents* | | *80.7* | *1,605,617* | *203* |
| Closure check | Closure verifier | 12.9 | 280,841 | 19 |
| **Planning, 16 agents** | | **336.3** | **4,484,985** | **807** |
| Implementation | Masked photos for the wiki | 22.1 | 339,612 | 129 |
| Implementation | Infrastructure (generator, viewer, checks, first blockout) | 46.4 | 458,765 | 81 |
| Implementation | Measurement (closure, cameras, dimension table) | 48.4 | 385,900 | 170 |
| *Set-up, 3 agents* | | *116.9* | *1,184,277* | *380* |
| Modelling round 1 | Structure (platform, stand, monitor, pedals) | 26.7 | 463,101 | 130 |
| Modelling round 1 | Pods (pods, joysticks, controls, touchscreen) | 36.1 | 519,504 | 140 |
| Modelling round 1 | Seat | 41.3 | 541,180 | 139 |
| *Round 1, 3 agents* | | *104.1* | *1,523,785* | *409* |
| Interface review | A: interaction design | 15.0 | 241,038 | 64 |
| Interface review | B: first-time-user walkthrough | 16.6 | 315,861 | 73 |
| Review | Independent review, round 1 | 26.8 | 301,737 | 149 |
| Modelling round 2 | Structure, resumed | 13.2 | 583,036 (+119,935) | 41 |
| Modelling round 2 | Seat, resumed | 14.2 | 684,617 (+143,437) | 37 |
| Modelling round 2 | Pods, resumed | 14.5 | 663,729 (+144,225) | 54 |
| *Round 2, 3 runs* | | *41.9* | *407,597* | *132* |
| Viewer | Interface implementer (redesign, exposure, acceptance script) | 61.9 | 540,630 | 107 |
| Review | Independent review, round 2 (fresh reviewer) | 18.4 | 410,935 | 125 |
| **Implementation to the round-2 verdict, 14 runs** | | **401.6** | **4,925,860** | **1,439** |
| **Both phases, 30 runs** | | **737.9 (12.3 h)** | **9,410,845** | **2,246** |
| Round 3 and the second documentation pass, 4 runs (final fixes 17.3 min / 339,041; publishing tools 27.3 / 361,228; wiki writer D 26.9 / 511,636; wiki writer E 24.9 / 458,531) | | **96.4** | **1,670,436** | **667** |
| **All reported runs, 34** | | **834.3 (13.9 h)** | **11,081,281** | **2,913** |
| Documentation first pass (5 agents stopped by the usage limit) | | not reported | not reported | not reported |

**Not in these figures:** the coordinator's own time and tokens (the main session; not reported by
the harness), the five documentation agents stopped by the usage limit, and the agents started
after the interruption.

## Tool performance

Medians and ranges over the timeline lines up to 20:53 UTC. A "run" is one invocation. Seconds are
measured by the tool itself. The [tool reference](../80-reference/tools.md) explains each command.

| Tool | What | Runs | Median | Range | Note |
|---|---|---|---|---|---|
| `build` (full) | parameters → GLB and description file | 42 | 0.19 s | 0.12–0.32 s; one 0.79 s | |
| `build --only <group>` | one group's meshes, full frame tree | 62 | 0.12 s | 0.09–0.38 s | the modellers' inner loop |
| `build`, failed | stopped with the component and reason | 21 | 0.07 s | 0.03–0.21 s (3 without a time) | 2 deliberate tests of the checks; the others: triangles wound against their normals, unknown or renamed parameter keys, TOML syntax errors, spec order, a zero-height cylinder |
| `check` (full) | build + 20 checks | 24 passed, 4 failed | 4.2 s | 3.8–4.8 s | failed runs took the same time |
| `check --fast` | without the browser checks | 4 passed, 8 failed | 2.1 s | 1.4–2.7 s | most failures were another agent's half-finished file |
| `render --set sheet` | contact sheet | 18 | 1.39 s | 1.18–1.54 s | |
| `render --set ortho` | 5 orthographic views | 8 | 1.10 s | 0.93–1.18 s | |
| `render --set ids` | 3 views in ID colours | 7 | 0.70 s | 0.61–0.75 s | |
| `render --set groups` | one sheet per group | 26 | 0.81 s | 0.62–3.70 s | 3.7 s for all five groups |
| `render --set matched` (5 cameras) | 20 images through the solved cameras | 7 | 8.0 s | 7.3–9.1 s | |
| `render --set matched` (fewer cameras or one group) | | 35 | 3.3 s | 1.5–6.4 s | |
| `render --set focus` | close-up sheet | 43 | 1.41 s | 1.17–1.78 s | |
| `render --set ui` | 3 page screenshots | 6 | 0.68 s | 0.58–0.81 s | |
| `render --set selftest` | projection self-test | 5 | 0.04 s | 0.036–0.046 s | |
| `render --set wiki` | 27 documentation images | 20 | 9.6 s | 9.4–10.4 s | |
| `render` (all sets of a call, with browser start) | | 144 | 2.2 s | 0.5–16.3 s | 16.3 s for ortho, sheet, ids, groups and matched together; browser start 0.38 s (0.26–2.47) |
| `dist` | deployable folder, verified from a sub-path | 6 without the wiki, 1 with | 0.54 s | 0.03–0.80 s; 1.3 s with the wiki (124 files, 17.0 MB) | 2 failed on broken wiki links |
| `ui-accept` (full) | 53 checks of the viewer page | 9 | 115 s | 111–125 s | 6 passed 53/53; 3 failed (43/52, 52/53, 48/53) while the page was being built; plus 7 partial runs of 3–46 s |
| `wiki index` | | 6 | 0.010 s | 0.004–0.013 s | |
| `wiki lint` | | 5 | 0.017 s | 0.009–0.022 s | all five failed: pages still being written |
| `wiki build` | static site | 3 passed, 8 failed | 0.13 s | 0.07–0.25 s | |
| `deploy --dry-run` | check, build, documentation images, wiki, dist, no upload | 1 | 16.6 s | — | of two earlier attempts one refused after the check and one stopped at `dist` (broken wiki links); nothing was uploaded; later runs went to a local test server; the first real deployment took 24.8 s and a dry run 17.2 s |

Other measured speeds (*measured*, same machine): viewer ready 0.1–0.2 s after navigation on the local
server; 60–61 fps in headless Chromium at 1440 × 900 and 1600 × 1000 (capped by the display rate);
18 whole-rig views rendered by the reviewers' own drivers in 4.9–5.6 s; bundling the viewer about 0.1 s.

## Model statistics per stage

From the description files of the snapshots kept by the reviewers and of the current build.

| Stage | Build | Triangles | Draw primitives | GLB bytes | Nodes | Meshes | Joints | Reference frames | Parameter records (measured / vendor / photo / assumed / invented) |
|---|---|---|---|---|---|---|---|---|---|
| Trial A (planning) | — | 8,082 | — | — | 47 | 23 | 8 | 4 | not comparable |
| Trial B (planning) | — | not recorded | — | — | 56 | 27 | 9 | 4 | not comparable |
| Blockout, 18:00 | `5923aa5f9d01` | 11,162 | 62 | 331,016 | not recorded | 48 | 20 | not recorded | not recorded |
| Round 1, 18:46 | `fee042663dad` | 30,742 | 68 | 767,756 | 85 | 47 | 20 | 11 | 282 (3 / 22 / 79 / 169 / 9) |
| Round 2, 19:30 | `c32727406a5c` | 28,042 | 67 | 719,220 | 89 | 48 | 20 | 14 | 303 (3 / 22 / 80 / 177 / 21) |
| Round 3, 20:48 | `0b6d8248b63f` | 28,070 | 67 | 719,872 | 89 | 48 | 20 | 14 | 305 (3 / 22 / 80 / 179 / 21) |
| Budget | | ≤ 150,000 | ≤ 80 | ≤ 4 MB | | | | | |

The round-3 row was confirmed against the published build (SHA-256 `0b6d8248b63f…`).

Parameters by tier (round 3): 33 critical, 96 layout, 176 cosmetic. Joints by kind: 13 adjustments,
7 runtime controls; by evidence: 9 seen, 5 inferred, 6 assumed (the five seat joints and the pedal
tray). Eleven parameter records are read by no geometry, among them the owner's two conflicting
figures (on purpose) ([I-23](../60-lessons/ideas.md#i-23)).

**Triangles per group** (the reviewers' counts, which include the two screen surfaces):

| Group | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| Pods | 14,274 | 11,598 | 11,618 |
| Seat | 5,364 | 8,516 | 8,516 |
| Stand | 4,376 | 3,428 | 3,436 |
| Pedals | 3,236 | 2,348 | 2,348 |
| Platform | 3,492 | 2,152 | 2,152 |

The round-3 column is from the description file of the round-3 build (sum 28,070). The round-3
agent's notes say "+16 triangles per pod", which would give 11,630; the build has 20 more on the two
pods, not 32 (*measured*; the notes are agent-written).

## Iterations per component

As logged by the modellers (build-render-compare cycles; agent-written, so approximate). The brief
allowed four per component per round.

| Component or area | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| Seat back shell and dark panel | 7 (above the cap) | 2, shared with the upholstery | — |
| Seat lower shell, tray, cheeks, hubs | 5 | — | — |
| Seat cushion, back cushion, head pad | 4 | cushion 4, back upholstery 2 | — |
| Joystick grip | 4 | — | — |
| Joystick bellows | 3 | 3 looks and an 8-pose montage (finding J1) | — |
| Pod shell | 3 | 2 looks (finding P1) | cup recess 3 |
| Touchscreen arm | 3 | — | — |
| Touchscreen pose | 2 | — | — |
| Armrest pad | 2 | — | — |
| Emergency stop | 1 | — | — |
| Stand | 2 | not itemised | columns 1 |
| Pedals | 2 | not itemised | — |
| Platform | 1 (plus a seam-width tweak) | not itemised | — |
| Dark materials | — | — | 3 variants |

Seat modeller's own split of its 41 round-1 minutes: study of crops and measurement files about 8 min,
back shell about 16 min, lower shell and hubs about 9 min, cushions about 6 min.

## Interface statistics

| | First viewer | Redesign |
|---|---|---|
| Controls visible by default | 103 | 16 |
| Model's share of a 1440 × 900 window | 58 % | 82.8 % |
| Page ready (local server) | 99 ms median (review A's method) | 198 ms (acceptance check T10's method) |
| Download | 1.15 MB in 5 requests (script 687 kB) | 1.69 MB in 7 requests (script 726 kB; the model and its description file had grown) |
| Frames drawn by an idle page in 2 s | 120 | 0 |

Details on the [viewer](viewer.md) page.
