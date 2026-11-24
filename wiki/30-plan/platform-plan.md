---
title: The platform plan (version 7)
tldr: The second plan, approved by the owner on 2026-11-24, in plain words. It turns rigtwin from one model into a working platform in five steps that can each be stopped after - agent control, honest numbers, assessment, an agent in the app, a control room - with an independent simplicity monitor. Step 1 is built; what it changed from the plan is listed here.
status: living
updated: 2026-11-24
tags: [plan, platform, agents, server, process]
---

# The platform plan (version 7)

## TL;DR

- **What:** every action on the scene becomes a command that the viewer's buttons, Claude Code and later an agent inside the app all use; one small server program, the same on the laptop and on mightwork.ai, keeps the shared scene and shows every change at once in every open viewer.
- **Five steps**, each ending with a review and the hours used: 1 agent control, 2 honest numbers, 3 assessment, 4 an agent in the app, 5 a control room. The owner decides after each step whether to go on.
- **Approved** by the owner on 2026-11-24 with an independent "could this be simpler?" monitor that approves each design before building and reviews each checkpoint ([D-38](../20-decisions/decision-log.md#d-38)).
- **Step 1 is built** on the branch `platform-step1-main`: the commands, the server, the viewer as a live client, `bun run rig`, the operating Skill and the deployed service with its guards. It goes live only after the host setup and a merge to `main`; the public site gets it **without the manikin** until the owner approves the new one ([D-44](../20-decisions/decision-log.md#d-44)).
- **Changed from the plan in step 1:** no release split ([D-42](../20-decisions/decision-log.md#d-42)), undo by entry or request ([D-40](../20-decisions/decision-log.md#d-40)), the scene document holds the pose only, port 4190 ([D-45](../20-decisions/decision-log.md#d-45)), a byte budget per live stream and lower stream limits ([D-46](../20-decisions/decision-log.md#d-46)); `view.picture`, projects and saved versions move to step 2.

## About this page

The first plan, for the model itself, is [the approved plan](approved-plan.md). This page is the second
plan, for the platform built around the model, written for the wiki: shorter than the original and in
plain words. The original (with its expert reports and reviews) is kept in the project's working files.
How step 1 was built is on the pages for the [viewer](../50-implementation/viewer.md),
[deployment](../50-implementation/deployment.md), the [checks](../40-method/checks.md) and the
[tools](../80-reference/tools.md).

## What the plan is for

The owner asked for a platform for assessments, not a report. Five ideas carry it:

1. **Every action is a command.** Moving parts, choosing what is shown, measuring, assessing, taking
   pictures, undoing: buttons, Claude Code and an agent in the app use the same commands, so an agent can
   do whatever a person can, and the person watches it happen.
2. **One small server**, the same program on the laptop and on mightwork.ai. It keeps every change (all
   undoable) and shows it at once in every open viewer.
3. **Honest numbers, live.** Every reference point recomputed for any size estimate; every person of a
   public body-size survey evaluated, fast enough to follow a drag.
4. **An assessment module**, off until switched on: one finding at a time, the guideline's limit drawn
   in 3D, every surveyed person as a dot, uncertain parts shown at both ends of their range.
5. **An agent that knows the method**: what each command does, what everything in the scene is called,
   when to ask, what to refuse (never "compliant"), and to check its own work by measuring again.

## The five steps

| Step | Afterwards the owner can | Where | Agent hours (ceiling) |
|---|---|---|---|
| 1 Agent control | tell Claude Code "lower the monitor 3 cm and show me the operator's view", watch it in the browser, undo it | laptop and mightwork.ai | 18–28 (30) |
| 2 Honest numbers | measure with ranges ("62 cm (55–69)"), look from a real person's eyes, open and save project versions | laptop and mightwork.ai | 24–36 (38) |
| 3 Assessment | assess Rig B one finding at a time; ask Claude Code to "show the sight lines for the women" | laptop; on mightwork.ai without Rig B's findings | 30–45 (48) |
| 4 Agent in the app | ask in an "Ask" panel, watch each step, stop or undo it | laptop and mightwork.ai (spending caps) | 16–26 (28) |
| 5 Control room | place, turn and swap several stations in one room with its windows and wall displays, by hand or by asking | laptop and mightwork.ai | 14–22 (24) |

The hours are the experts' own estimates summed (102–157, ceiling 164); earlier builds here took a third
to a half of their estimates, so the plan re-forecasts after step 1. Each step has a checkpoint at about
40 % and a stated cut order; never cut are the result words and bands, the checks that drawings equal
limits, the security guards and undo. Order: 1, 2, 3, then 4 and 5 side by side.

**Later, each on its own trigger:** goal-seeking ("so she looks slightly down"), a manikin that leans or
moves, other rig variants, the monitor arm as a real linkage, shared editing with presence, sign-in and
customer projects online, a connection for claude.ai or a phone.

## The owner's five decisions

| # | Question | Answer |
|---|---|---|
| 1 | Start step 1 now, decide the rest after trying it? | Yes |
| 2 | Who runs the one-time server setup? | This agent, from a reviewed script, with the owner's yes at that moment and a check of every other site on the host before and after |
| 3 | The agent in the app on mightwork.ai (before step 4) | Recommended: on behind a shared passphrase, with daily and monthly spending caps; to be decided before step 4 |
| 4 | Rig B's findings on the public site | Off until the owner says so ("not offered", not secret) |
| 5 | Claude Code against the public sandbox, where text comes from strangers | A separate, restricted Claude Code setting, prepared by the project, approved by the owner (`tools/claude-sandbox-settings.json`, prepared, not active) |

Defaults the owner can overrule: NUREG-0700 Rev. 4 and MIL-STD-1472H as free working yardsticks; the
US Army ANSUR II survey as the source of people; customer projects only on the laptop until sign-in
exists; numbers in scene files carry class, range and evidence like the asset's parameters.

## How it works, in short

- **Layers.** Core maths and pose, the model's file kinds, engines (kinematics, evaluation), one command
  registry, and on top the hosts (viewer, server, tools). Everything below the hosts is plain TypeScript,
  so the same code runs in the browser, the server and `bun run`.
- **Commands** have an id, a summary, an argument schema in metres and degrees, a kind (query, edit,
  view) and examples; a refusal carries a code, a message and a hint so that an agent can correct itself.
- **The shared document** holds what is saved; the camera, the selection and what is hidden stay per
  viewer. While a person drags, the change is a local preview; on release it becomes one command. A
  change based on an old version is refused as stale, and the refused side sees why. An agent's request
  is a group, shown step by step and undone in one step.
- **The server on mightwork.ai** is one service behind one Caddy route, hardened, without network
  access in steps 1–3, with numbered guards against abuse (request sizes, live connections, edit rates,
  disk).
- **People and results** (step 2 and 3): the real survey participants, not percentile figures; every
  result says whether it is within, probably within, open, probably outside or outside, and an assumed
  input makes it "open" at best.
- **The manikin** from the parallel session is used, not rebuilt: its person is set and posed through
  commands in step 2, and its tree reader `shared/kinematics.ts` is the seed of step 2's frame tree.

## Step 1 as built (2026-11-24)

Built by two builder agents and reviewed by the simplicity monitor at the design, at the checkpoint and
before the merge, and by a security review. All of it runs locally; on the host, the setup script's
read-only check and the load test H14 have run (2026-11-24), the setup itself and the first release
with the server wait for the owner's yes ([deployment](../50-implementation/deployment.md)).

| Part | What exists |
|---|---|
| Commands | eight: `scene.summary`, `scene.find`, `pose.set`, `history.undo`, `measure.distance` (a point estimate between reference frames), and `view.set`, `view.show`, `view.select` for one browser named by its session code; checked by the server against their schemas |
| Scene document | the pose of the rig and its last 200 changes, each with a server-made author label and the request's group; stored as `doc.json` |
| Server | `server/server.ts`: health, catalogue, commands, a live event stream with heartbeat and resume ([D-39](../20-decisions/decision-log.md#d-39)); the same program locally (inside `bun run serve`) and on the host |
| Viewer | a live client for every pose change: one line saying who changed what with its Undo, the session code and a statement about the sandbox under More; a link with a different pose opens as a preview with Apply ([viewer](../50-implementation/viewer.md)) |
| Command line | `bun run rig <command> '<json>'` with `--server`, `--viewer`, `--group`, `--expected-version` ([tools](../80-reference/tools.md)) |
| Skill | the operating Skill v0, `.claude/skills/operating-rigtwin/` ([skills and agents](../80-reference/skills-and-agents.md)) |
| Host | a hardened unit, a Caddy route, a setup script with `--check`, `--apply`, `--probe`, `--undo` and fourteen host checks; deploy and dist checks for the server |
| Checks | about 170 new automatic test cases (commands 26, server 19, reconnect rules 5, setup script 72, deploy 16 and 33 with rollback, two real browsers 14) ([checks](../40-method/checks.md)) |

### What step 1 changed from the plan

| Plan said | Built | Why |
|---|---|---|
| About 12 commands, including `view.picture`, `batch`, `project.open`, `version.save` | 8 commands; pictures for agents, projects and saved versions in step 2; no `batch` | `pose.set` of several joints with a group already does what `batch` does; the owner watches in step 1, so no picture route is needed yet |
| The document holds pose, placement, measurements and notes | the pose only, plus the last 200 changes | nothing in step 1 writes the rest; with no stored free text the text limits and the names rule have nothing to guard yet |
| "Undo own last change" | undo by entry or by request ([D-40](../20-decisions/decision-log.md#d-40)) | the owner's Undo must undo Claude Code's change |
| Release split into `site/` and `server/` | the server in today's release folder, never served ([D-42](../20-decisions/decision-log.md#d-42)) | the split needed a new gate and a rollback floor for the whole site |
| A per-session secret for steering a browser | the session code alone (8 characters) | a guessed code only moves a stranger's camera; unknown codes are rate-limited |
| Port 4180 | 4190 ([D-45](../20-decisions/decision-log.md#d-45)) | 4180 is taken on the host |
| 300 live connections in all | 150, 12 per network block, 512 kB per stream ([D-46](../20-decisions/decision-log.md#d-46)) | host check H14 |
| The viewer bundle within 760 kB | every script of the default page within 800 kB ([D-43](../20-decisions/decision-log.md#d-43)) | the live client is a default feature |
| Step 1 built on the manikin branch | moved onto `main` without the manikin ([D-44](../20-decisions/decision-log.md#d-44)) | the owner's decision of 2026-11-24 |

Effort: the builders reported about 1.5 agent hours to the checkpoint against 18–28 estimated; the
re-forecast of steps 2–5 is still to be made.

## Where the details are

The original plan, the six expert reports, the three adversarial reviews and the simplicity monitor's
log are in the project's working files, not in the repository. Their decisions are in the
[decision log](../20-decisions/decision-log.md) (D-38 to D-46); what comes next is on
[next steps](../90-next/next-steps.md).
