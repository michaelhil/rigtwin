---
title: Project log
tldr: The dated, append-only record of the project - from the owner's first request through planning, plan approval, implementation, the owner's mid-run requests, the model reviews, the viewer redesign, the usage-limit interruption and recovery, to the final fixes. Newest entries at the bottom; append, never rewrite.
status: living
updated: 2026-11-24
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

## 2026-11-24

**Time not recorded** — The owner approved the platform plan, version 7, with an independent simplicity
monitor; step 1 (agent control) started. The monitor blocked the first design three times (undo of
"own" changes, a commit rule for only some pose paths, the release split); all three were changed
before building. [Platform plan](30-plan/platform-plan.md), [D-38](20-decisions/decision-log.md#d-38)
to [D-43](20-decisions/decision-log.md#d-43).

**Time not recorded** — Step 1 built by two builder agents in a separate worktree on top of the
manikin branch: the command layer, the server with its live channel, the viewer as a live client,
`bun run rig`, the operating Skill, the host's unit, Caddy route and setup script, and the deploy and
dist checks. A security review (four must-fix findings, eleven should-fix) and the monitor's checkpoint
review (the local server's Host check moved to cover every path) were answered before the merge.
[Viewer](50-implementation/viewer.md#the-shared-scene-platform-step-1),
[deployment](50-implementation/deployment.md), [checks](40-method/checks.md).

**Time not recorded** — On the host, the setup script's read-only check found port 4180 taken: the
server moved to 4190 ([D-45](20-decisions/decision-log.md#d-45)); host check H10 added the hiding of
the host's other applications to the unit. Host check H14 (300 live streams that never read) failed:
the kernel's TCP memory passed its pressure threshold.

**About 16:15** — The owner decided that the public site gets the platform without the person in the
seat until the new manikin is approved ([D-44](20-decisions/decision-log.md#d-44)). Step 1 was moved
onto `main` as the branch `platform-step1-main`, without any manikin file, datum, check, render set or
control; the engine keeps only the two extension points the live client uses. A harness bug found on
the way (the setup script's test read "the site file before the setup" from the latest commit, so it
would have failed after any commit with the new file) was fixed with a fixture.

**About 16:35** — Fix for H14: each live stream ends after 512 kB, its place held until its connection
is gone; 150 streams in all, 12 per network block ([D-46](20-decisions/decision-log.md#d-46)). H14 run
again on the host with the new bundle: passed (TCP memory at 49 % of the threshold, the server at
66 MB, other sites unaffected). Committed as `aec6272` on `platform-step1-main` (not pushed, not
merged): full check, 53 of 53 viewer checks, 14 of 14 two-browser steps and the deploy's dry run all
pass; the page loads one script of 733 kB. The setup on the host and the merge wait for the owner's yes.
[Next steps](90-next/next-steps.md#0-platform-step-1-the-rollout-and-after).

**Later the same day** — This wiki pass for the platform: the new [platform plan](30-plan/platform-plan.md)
page, decisions D-38 to D-46, and the viewer, deployment, tech stack, checks, tools, skills, next steps
and summary pages.

**16:17 (the Caddy change; the rest within the hour before and after)** — The host setup, with the
owner's yes, which the entries above leave out: `setup-server.sh --check` twice (the first stopped at
the taken port, the second passed every host check), then `--apply` (the system user and data folder,
Bun 1.4.0 with a matching checksum, the Caddy route installed with a backup while every other site on
the host answered as before, the unit installed and retrying every 2 s), then `--probe` (passed: Bun
serves on loopback under the unit's hardening, sees only rigtwin's folders, cannot reach the internet),
then the load test H14 (failed once, passed after the fix noted above). The service now waits for the
first release that contains the server.
[The server and its host setup](50-implementation/server-and-host-setup.md#order-of-the-first-rollout).

**Later the same day** — The simplicity monitor's review before the merge: approved with changes. The
wiki still said the setup was waiting for the owner's yes; corrected on the deployment, viewer, summary,
plan and next-steps pages, and the server's part of the deployment page became a page of its own. The
unit no longer names other programs on the host: `/var/lib` is hidden whole except rigtwin's data
folder, like `/srv` and `/opt`, and the probe checks all three (the changed unit is installed and
probed again before the merge). A stream that reaches its byte budget now ends with an `end` event, on
which the page reconnects at once instead of after a second. What remains: the merge and push with the
owner's yes, the check on the host after the deploy, the ten-minute idle test and the two-browser test
on the live site. [Next steps](90-next/next-steps.md#0-platform-step-1-the-rollout-and-after).

**About 17:06** — The owner said yes to the merge; `main` was pushed with platform step 1. The automatic
deploy refused it in its own check, before anything was uploaded; the live site stayed as it was. Two
causes, both only visible on a fresh checkout on Linux: the new command and server tests ran before the
build, so the built model they read did not exist yet; and the setup script's test harness used two
commands in their macOS form (`stat -f`, `sed -i ''`), so 11 of its 74 cases failed on the Ubuntu runner.
Fixed: those tests run after the build; the harness uses forms that work on both systems and prints the
end of a failed run's output; the rollback test's stand-in for `mv -T` no longer assumes macOS. Proved in
a fresh clone without a build, and with stand-ins for GNU `stat` and `sed` that reproduced exactly the 11
failures before the fix. [Checks](40-method/checks.md).

**About 17:30** — The second push (`ff90f30`) deployed: platform step 1 is live. `api/health` on
mightwork.ai reports the deployed revision; on the host the server's code answers 404 in seven
spellings (H12), the unit's exposure score is 1.4 with its limits in effect (H8) and the service is
active. The ten-minute idle test through Caddy was started.

**About 17:40** — The two-browser check on the live site, with the new `tools/live-site-check.ts`:
passed (nine lines ok, 4.4 s). A 1° turn of the monitor from the command line appeared in both pages
with the line "Claude Code · 5145 — Monitor: turn 1° right"; Undo on one page put it back in both; a
5 mm slider move in one page appeared in the other, and `history.undo` of its version put it back; a
view command reached only the named page; nothing was logged; the public scene's pose was the same
before and after (versions 0 to 4). [The server and its host
setup](50-implementation/server-and-host-setup.md#order-of-the-first-rollout).

**Evening** — The owner asked why one request ("make the backrest straight") took so long and for "a very
significant re-engineering" of agent control. Measured: six agent turns and about 30 kB read for one number;
the server answered each command in 0.3 s. A proposal (intent commands, MCP served by the server, a
generated catalogue of what each adjustment means, pictures, a smaller Skill, an agent benchmark) was written,
and the owner said "do the work here, push and deploy" ([D-47](20-decisions/decision-log.md#d-47)). Built on
the branch `agent-v2` from `platform-step1-main`: `shared/commands/intent.ts`, `server/mcp.ts`, `api/picture`,
the page's `look` and pictures, `.mcp.json`, the Skill v2, `tools/agent-docs.ts` and `tools/agent-eval.ts`
([D-48](20-decisions/decision-log.md#d-48) to [D-52](20-decisions/decision-log.md#d-52)). Tried by hand
through MCP against a local server with a real page: one `look {"view": "operator", "picture": true}` came
back with a 41 kB picture of the operator's view. The benchmark could not run: the Claude Code command line on
this machine is not signed in. [Platform plan](30-plan/platform-plan.md#step-15-agent-interface-v2-2026-11-24),
[agent interface](80-reference/agent-interface.md).

**Later** — An independent security review of the v2 diff (before any push): one must-fix, JSON-RPC
batches (a 60 kB request of 1,276 `tools/list` calls answered with 8.5 MB, counted as one request), and
four should-fixes: table lookups by names such as "constructor" ended in a 500; the content-type check
took `text/plain;x=application/json`, and locally any localhost page could post; one stranger could hold
all 20 picture slots; a viewer code was kept before it was checked. All fixed with tests
(`server/mcp.test.ts`), and from its notes: request names ending in `-<number>` are reserved for the
server, `state` no longer shows names that callers chose, and the command line writes a picture into a
fresh private folder. Kept as it is: `.mcp.json` loads the public sandbox's tools in every session of
this repository (the owner's request for fast agent control; what they return is now server-made text,
numbers and pictures from the browser the owner names).
