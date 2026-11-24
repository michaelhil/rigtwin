---
title: Next steps
tldr: What to do next, in priority order and by whom: platform step 1 is live (2026-11-24) and the owner tries it; then a tape session with four questions for the owner, a planted-error test of the reviewer, the Skill on a second object, small fixes, other rig configurations, the assessment and simulator phases, and routine maintenance.
status: living
updated: 2026-11-24
tags: [next-steps, planning, open-questions]
---

# Next steps

## TL;DR

- **Platform step 1 first** ([the platform plan](../30-plan/platform-plan.md)): it is built on the branch `platform-step1-main` and passes every check. It is live on mightwork.ai since 2026-11-24: the host was set up and the merge deployed, both with the owner's yes, and the two-browser check on the live site passed. What remains: the result of the ten-minute idle test, the owner trying it, and the re-forecast of the later steps ([below](#0-platform-step-1-the-rollout-and-after)). The public site gets it without the manikin ([D-44](../20-decisions/decision-log.md#d-44)).
- **First, a tape session** on the reference rig (owner or client, 30–40 minutes on site) with four questions answered: which of the owner's three figures is right, what really adjusts on the seat, pods and pedals, the touchscreen's model label, and the seat's maker and model. Nothing else improves the model's accuracy as much.
- **Second, test the reviewer** with planted errors of known size (agents, a few hours). Until then its "accepted" has no stated power.
- **Third, build a second, different object** with only the Skill, against tape values the owner keeps sealed (owner and agents). That is what turns Skill 0.1.0 into 1.0.
- Then: small fixes and hardening, other rig configurations as overlays, and the two later phases, **assessment** (a digital human layer has to be built; standards to buy) and **simulator** (real joysticks and pedals through the browser, live pictures on the screens, a first-person view).
- Continuous deployment from GitHub is **done** (2026-11-23): every push to `main` deploys. Routine changes follow the maintenance steps at the end.

## 0. Platform step 1: the rollout, and after

**Owner and agents, size S.** Platform step 1 is built and checked (2026-11-24). The details and
commands are on the page [the server and its host setup](../50-implementation/server-and-host-setup.md).

| # | Step | Who | Status |
|---|---|---|---|
| 1 | The owner's yes to the host setup, after reading `setup-server.sh --check` | owner | **done** 2026-11-24 (the first check moved the port to 4190) |
| 2 | `setup-server.sh --apply` on the host (the Caddy route and its 404 rule first, then the service), `--probe` (host check H7), the load test (H14) | agents, with the owner's yes | **done** 2026-11-24. The unit's file rules were made generic afterwards; it was installed and probed again (passed) before step 3 |
| 3 | Merge `platform-step1-main` to `main` and push; the automatic deploy puts the first release with the server live and requires its health check | agents, with the owner's yes | **done** 2026-11-24. The first push was refused by the deploy's own check on the runner (two faults that only show on a fresh Linux checkout; nothing was uploaded); the second (`ff90f30`) deployed, and `api/health` reports that revision |
| 4 | `setup-server.sh --check` again on the host (H8, H12) | agents | **done** 2026-11-24: the server's code answers 404 in seven spellings; the unit's exposure score is 1.4 with its limits in effect; the service is active |
| 5 | `bun tools/live-idle-test.ts --url https://mightwork.ai/rigtwin` (10 minutes idle through Caddy, then one change and its undo) | agents | started after the deploy on 2026-11-24; its result is recorded in the [log](../log.md) |
| 6 | The two-browser acceptance on the live site (`bun tools/live-site-check.ts https://mightwork.ai/rigtwin`) | agents | **done** 2026-11-24: all nine lines ok, and the public scene left as it was found |
| 7 | The owner tries it: "lower the monitor 3 cm and show me the operator's view", watched on mightwork.ai, then undone | owner (about 15 minutes) | to do |
| 8 | Re-forecast steps 2–5 with the real hours of step 1 | agents | to do |

**Step 1.5, agent interface v2** (2026-11-24, [D-47](../20-decisions/decision-log.md#d-47)): built, checked and
deployed. What remains:

| # | Step | Who | Status |
|---|---|---|---|
| 1 | Sign in the Claude Code command line on this machine once (`claude`, then `/login`), so the benchmark can start headless runs | owner | to do |
| 2 | `bun tools/agent-eval.ts --baseline-dir <checkout of 8898e66>`: the ten requests with the step-1 interface and with v2; record the numbers on the [platform plan](../30-plan/platform-plan.md#step-15-agent-interface-v2-2026-11-24) | agents | waiting for 1 |
| 3 | The owner tries it in a new Claude Code session in this repository: approve the two MCP servers once, then "make the backrest straight", "show me the operator's view" (with the browser's code) | owner | to do |

Also waiting for the owner:

- **GitHub settings** (security review): move the secret `DEPLOY_SSH_KEY` into the environment
  `production`, limited to `main`, and protect `main`.
- **Decision 5 of the plan**: whether to use the prepared, restricted Claude Code setting
  (`tools/claude-sandbox-settings.json`) for work against the public sandbox.
- **The manikin**: it stays off the public site until the owner approves the new one
  ([D-44](../20-decisions/decision-log.md#d-44)); its branch then moves onto `main` after the platform,
  and the manikin's own wiki pass follows.
- **Platform step 2** (honest numbers) starts only when the owner says so, after trying step 1.

## Who does what

| Who | Means |
|---|---|
| **Owner** | the human factors researcher who commissioned the work; decides, answers questions, may measure |
| **Client** | the company that built and runs the rigs; holds the rigs, the parts lists and the makers' documents |
| **Agents** | AI agents in a session on the project repository, briefed from this wiki |

Sizes as on the [ideas page](../60-lessons/ideas.md): **S** up to one agent-hour, **M** a few
agent-hours, **L** about a day with several agents, **XL** a project phase. They are *judgment* after
one run.

## In priority order

| # | Step | Who | Size | Why in this place | Ideas |
|---|---|---|---|---|---|
| 1 | Tape session and the owner's answers | owner or client; agents prepare and enter | S for agents; 30–40 min on site | the only route to "sizes verified"; settles the three conflicting figures | [I-04](../60-lessons/ideas.md#i-04), [I-13](../60-lessons/ideas.md#i-13) |
| 2 | Planted-error test of the reviewer | agents | S per variant, about 6 variants | gives the review a stated detection threshold | [I-01](../60-lessons/ideas.md#i-01), [I-20](../60-lessons/ideas.md#i-20) |
| 3 | Skill trial on a second object with sealed tape values | owner (object, photos, tape); agents (build) | L | the only test of reuse; the condition for Skill 1.0 | [I-05](../60-lessons/ideas.md#i-05), [I-02](../60-lessons/ideas.md#i-02), [I-07](../60-lessons/ideas.md#i-07) |
| 4 | Small fixes and hardening | agents | S–M each | closes known gaps before more is built on the asset | [I-03](../60-lessons/ideas.md#i-03), [I-18](../60-lessons/ideas.md#i-18), [I-23](../60-lessons/ideas.md#i-23) |
| 5 | Other rig configurations as overlays | agents; owner chooses which | M each | the same seat and pods appear in a van and a control room | [I-08](../60-lessons/ideas.md#i-08) |
| 6 | Assessment phase | owner (questions, standards); agents (build) | XL | the owner's purpose; needs steps 1 and 2 first | [I-09](../60-lessons/ideas.md#i-09), [I-10](../60-lessons/ideas.md#i-10), [I-19](../60-lessons/ideas.md#i-19), [I-21](../60-lessons/ideas.md#i-21) |
| 7 | Simulator phase | agents; owner or client provides hardware | L | the training use; the asset is already prepared for it | [I-11](../60-lessons/ideas.md#i-11) |
| 8 | Continuous deployment from GitHub | done 2026-11-23 | — | every push to `main` deploys through a restricted account | [D-37](../20-decisions/decision-log.md#d-37) |
| 9 | Maintenance | agents, on request | per change | keeps model, wiki and production in step | — |

Steps 2 and 3 do not depend on step 1 and can run in parallel with it.

## 1. The tape session and the owner's questions

**Questions for the owner** (or, through the owner, the client):

| # | Question | Why it matters | Where the conflict is recorded |
|---|---|---|---|
| Q-a | **Which of the three figures is right**, and measured between which points? Platform "1.5 × 1.5 m" (photos: 1.50 × 1.41 m); seat "1.4 m high" (photos: seat back top 1.28 m above the deck, 1.48 m above the floor); head to display "1.2 m" (photos: eye to screen centre 0.89–1.05 m, headrest to screen 1.08–1.21 m) | the deck width is the scale of the whole model; viewing distance drives every vision result | [D-24](../20-decisions/decision-log.md#d-24), [F-13](../60-lessons/failures-and-fixes.md#f-13), [model card](../70-results/rig-b-model-card.md#the-owners-three-figures-against-the-photos) |
| Q-b | **What really adjusts?** On the seat: slide, height, swivel, tilt, recline (and how far). On the pods: does the armrest pad slide, or are there fixed hole positions? On the pedals: does the tray slide? | six joints are assumed; without this, reach against seat position cannot be studied | [model card, joints](../70-results/rig-b-model-card.md#joints) |
| Q-c | **The touchscreen's model label** | confirms the 13.3-inch size and gives its outer width (now by proportion, 0.33 ± 0.03 m) | [D-34](../20-decisions/decision-log.md#d-34) |
| Q-d | **The seat's maker and model** | the maker's seat reference point would replace the two estimated seat references; adjustment ranges come with it | [standards](../80-reference/standards.md) |

Still open from the plan and worth an answer at the same time: will the owner send the client a
measurement sheet and ask for drawings (plan question Q4); which assessments come first (reach, vision,
posture or clearance; plan question Q8).

**The ten tape measurements** that would settle most, ranked, are on
[measurement results](../50-implementation/measurement-results.md#the-most-useful-tape-measurements):
the deck on both sides and outside the rim; the seat back top; the deck above the floor; the cushion
(front lip height, depth to the backrest, width); backrest to screen centre; the recline hub; the shelf
edges; the pod plates and joystick spacing; the armrest pad top (now "at the high end"); the
touchscreen housing and the pedal heel edge. Record who measured, when, with what tool and between
which two points.

**Photos that would close the largest gaps** (any phone, the same day): Rig B from its left side; the
backrest front; behind the monitor (the arm); under the right pod's nose (the touchscreen arm's base);
under the seat (the mechanism). Each answers an "observation that would settle it" on the
[decomposition page](../40-method/decomposition.md#uncertain-connections-and-what-would-settle-them).

**What the agents then do** (S): save the current description file, enter each value in
`assets/rig-b/params/measured.toml`, rebuild, score every estimate in or out of its range, look at the
changed parts against the photos, and update the model card, the measurement results and the log. The
procedure and a tested snippet are on the
[model card](../70-results/rig-b-model-card.md#updating-the-model-when-tape-measurements-arrive). The
plan's rule: sizes count as **verified** if at least 8 of 10 taped values fall inside their stated
ranges; otherwise "ranges too narrow" or "unverified".

## 2. Test the reviewer with planted errors

**Agents, about six variants of size S** ([I-01](../60-lessons/ideas.md#i-01)). Build copies of the
model each with one known error (a part 1, 2, 5 or 10 cm out of place; one wrong shape; one clean copy),
give each to a fresh reviewer with the standard brief, and report detection per error size and false
alarms on the clean copy. The build takes 0.2 s, so the cost is reviewer time (18–27 minutes per review
in this run). If affordable, run one of the reviews with an agent of another model family or with a
person who knows the rig ([I-20](../60-lessons/ideas.md#i-20)), because builders and reviewers here
share a family.

## 3. The Skill on a second, different object

**Owner and agents, size L** ([I-05](../60-lessons/ideas.md#i-05)). The condition for Skill 1.0,
from its changelog ([skills and agents](../80-reference/skills-and-agents.md#version-010-and-what-makes-it-10)):

1. The owner chooses a different object with moving parts, photographs it casually, tapes about ten
   dimensions and **keeps the values sealed**.
2. A fresh agent session, given only the project template (Skill, agent definitions, toolkit, viewer),
   builds it to blockout level and freezes its dimension table with ranges.
3. The tape values are opened and scored.
4. The rules are written down beforehand: the checks pass at blockout level; most sealed values fall
   inside their ranges; the Skill triggers without being named; no vocabulary from Rig B appears in the
   output.

Add, if the owner can spare about 40 minutes, the plan's other independent controls: a separately
written acceptance specification and about forty points clicked by the owner and kept from the builders
([I-02](../60-lessons/ideas.md#i-02)), which needs a small click page ([I-07](../60-lessons/ideas.md#i-07)).

## 4. Small fixes and hardening

**Agents, S to M each.** None changes the model's layout.

| Item | Source |
|---|---|
| A scripted interference check at joint limits, in `bun run check` | [I-03](../60-lessons/ideas.md#i-03); collisions are now found only by a reviewer looking |
| Automate the before-and-after report for tape values | [model card](../70-results/rig-b-model-card.md#updating-the-model-when-tape-measurements-arrive) |
| Run the three re-adjustment drills (enter a measured value, swap a device record, change a range) | [I-18](../60-lessons/ideas.md#i-18) |
| The reviewer's remaining minor findings: blade end and tray tail (N4), lip pinch (N6), hard shadow on the cushion (N7), pedal-face convention in the labels (N8) | [model card, known deviations](../70-results/rig-b-model-card.md#known-deviations) |
| Look up the makers' sheets still missing (touchscreen outer size, joystick pivot height, pedal travel) | [I-13](../60-lessons/ideas.md#i-13) |
| Look up the anthropometric source of the eye points; make them follow the recline | [I-14](../60-lessons/ideas.md#i-14) |
| Mark the 11 deliberately unused parameter records so the check warns only about real leftovers | [I-23](../60-lessons/ideas.md#i-23) |
| Correct "rear left" to "rear right" for photos 2511 and 2530 in the photo descriptions file | [F-27](../60-lessons/failures-and-fixes.md#f-27) |
| Frame rate and exposure on a weak laptop and a phone; touch input | [I-15](../60-lessons/ideas.md#i-15) |
| Enforce in the loader what is now convention: assumed joints locked, rounding by class | [filling gaps](../40-method/filling-gaps.md#what-keeps-invented-values-from-looking-measured) |

## 5. Other rig configurations as overlays

**Agents; the owner chooses which, size M each** ([I-08](../60-lessons/ideas.md#i-08)). The photos
show the same seat and pods in a van (Rig A) and in a control room (Rigs C1, C2) with a keyboard shelf,
loudspeakers, a control box or steering-wheel base under the shelf and a gooseneck microphone. Each
configuration is a small parameter and spec difference on the same asset; the reference rig already
borrows its seat's left side from those units, so their photos are partly measured.

## 6. The assessment phase

**Owner (questions, standards) and agents (building), size XL.** It should start after steps 1 and 2,
because every assessment result depends on taped sizes and on a reviewer whose threshold is known.
Since 2026-11-24 it is planned in detail as steps 2 and 3 of [the platform plan](../30-plan/platform-plan.md)
(honest numbers, then the assessment module), with the manikin from the parallel session as its
digital human.

**What must be built** (the asset itself is ready: named reference frames, joints with limits, screen
surfaces, classes and ranges):

| Piece | Why | Ideas |
|---|---|---|
| A **digital human layer**: sized manikins (at least small, median and large), posed in the seat, with reach and vision analysis | no open-source tool with sized manikins, posture prediction and reach and vision analysis was found; only parts exist (body meshes, parametric bodies, kinematics libraries, public anthropometry) | [I-09](../60-lessons/ideas.md#i-09) |
| **Frames in bulk**: every reference frame for many poses in one file | an assessment tool needs positions over the whole adjustment range, not one pose at a time | [I-19](../60-lessons/ideas.md#i-19) |
| **Per-component mesh export (OBJ)** | some analysis tools want one mesh file per part | [I-19](../60-lessons/ideas.md#i-19) |
| A first, honest demonstration: the **viewing-distance envelope** from the monitor arm's range for the three eye points, each quantity reported as determined or undetermined, no pass or fail | shows the interface without overclaiming | [I-10](../60-lessons/ideas.md#i-10) |
| A **measuring tool in the viewer** that shows a distance with its range | makes the uncertainty visible where a reader is tempted to read a number | [I-21](../60-lessons/ideas.md#i-21) |
| Code that enforces the **"not assessable"** and **"undetermined"** rules | a value filled from a standard must not pass an assessment against that standard | [filling gaps](../40-method/filling-gaps.md#the-not-assessable-rule) |

**Which standards to buy.** Nothing in this project was read from a purchased standard
([standards](../80-reference/standards.md)); the owner may already hold the texts. Suggested order
(*judgment* from that page): ISO 11064-4 and ISO 9241-5 (the nearest yardstick for a seated,
display-based station in a control room); ISO 15817 (the only standard scoped to remote operator control
systems, and ISO 13850 for the emergency stop it calls up); ISO 16001 (camera and monitor systems, since
the whole view is indirect); ISO 5353 and ISO 6682 (seat index point and reach zones, by analogy);
ISO 15536-1 and -2 (requirements and verification for computer manikins, for the layer to be built).

## 7. The simulator phase

**Agents; owner or client provides hardware, size L** ([I-11](../60-lessons/ideas.md#i-11)).

| Piece | What exists already | What to build |
|---|---|---|
| **Real joysticks and pedals** through the browser's Gamepad interface | joints with signal names `joy_L.x`, `joy_L.y`, `joy_R.x`, `joy_R.y`, `pedal_1` to `pedal_3`, limits from the maker or assumed | a mapping from device axes to signals, with calibration and dead zones |
| **Live camera views on the screen surfaces** | `S_mon_screen` and `S_ts_screen` are separate meshes with their own materials and texture coordinates | a video or rendered source per surface; a camera tile layout as on the real monitor |
| **First-person view from the eye points** | `D_eye_small`, `D_eye_median`, `D_eye_large`; the viewer's operator's-eye view already uses the median one | a mode that follows a head position; later head tracking |
| Buttons, key switch and emergency stop | separate nodes, so they can be lit and pressed | pressed and lit states, and their signals |
| Latency and the machine being controlled | — | a simulated machine and its cameras; the human-factors risk is mostly here, not in geometry |

## 8. Continuous deployment from GitHub

**Done on 2026-11-23** at the owner's request ([D-37](../20-decisions/decision-log.md#d-37)). Every
push to `main` runs every check and deploys; the key GitHub holds can only run the deploy script's own
commands inside `/srv/rigtwin` through the unprivileged account `rigtwin-deploy`. After a model change,
regenerate the wiki's images locally (`bun run render --set wiki`) and commit them: the runner has no
private photo cameras. Details: [deployment](../50-implementation/deployment.md#continuous-deployment-from-github).

## 9. Maintenance: how to change the model and redeploy

**Agents, on request.** Read the [asset contract](../40-method/asset-contract.md) and the
[lessons](../60-lessons/lessons-learned.md) first.

1. **Change a number:** edit its record in `assets/rig-b/params/<group>.toml`, keeping class, range and
   evidence true; a tape value goes into `measured.toml` instead. Never write a dimension into code.
2. **Change a shape:** edit the component's function in `assets/rig-b/src/<group>.ts`; a new part also
   needs a node in `assets/rig-b/spec/rig.toml`, a motion entry if it moves, and its left or right
   counterpart if it has one.
3. **Build and check:** `bun run build` (about 0.2 s), `bun run check` (about 5 s, must report 0
   failures); render and look at the changed part from several sides and at its joint limits.
4. **Have it reviewed** if the change is visible: a fresh reviewer with its own renders, not the agent
   that made the change.
5. **Update the wiki:** the model card, the gallery if pictures changed (`bun run render --set wiki`),
   a dated line in the [log](../log.md); then `bun run wiki index` and `bun run wiki lint` until no
   error.
6. **Commit and push:** a push to `main` deploys automatically (GitHub Actions); watch the run in the
   repository's Actions tab. To deploy by hand instead: `bun run deploy --dry-run`, read what it prints,
   then `bun run deploy`. Either way the deploy refuses to publish failing checks, lint errors or
   uncommitted changes, and switches back if the live check fails
   ([deployment](../50-implementation/deployment.md#updating-production-after-a-change)).
