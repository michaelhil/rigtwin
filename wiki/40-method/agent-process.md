---
title: The agent process
tldr: How the agents were organised in this run - a coordinator, an infrastructure agent, a measurement agent, three modellers in parallel, an independent reviewer, two interface reviewers and an implementer - what each brief contained, how collisions were avoided, and which parts of the approved process were not exercised.
status: living
updated: 2026-11-23
tags: [method, agents, process, review]
---

# The agent process

## TL;DR

- One **coordinator** (the main session) wrote the briefs, made rulings on conflicts, assembled and checked results, and looked at the viewer itself. It modelled nothing.
- Work was split by **file ownership**: infrastructure, measurement, three modellers (seat; pods; platform + stand + pedals), each in its own workspace. Parallel modelling took 41 min of wall clock for 104 agent-minutes.
- A **reviewer that reads no builder notes** made its own renders and its own geometry checks and returned a verdict per component. Round 1: 28 accepted, 9 accepted with minor fixes, 8 rejected; the model was not accepted.
- The scripts caught invalid meshes and wrong keys in seconds; the reviewer caught what no script looks for: parts of the wrong *kind*, and parts that fail when moved.
- Human gates, the owner's clicks, a locked acceptance spec and a planted-error test of the reviewer were **not** exercised. The owner asked for a fully autonomous run.

Terms are in the [glossary](../00-overview/glossary.md).

## Who did what

| Role | Form | Owned | Received | Wall clock (*harness-reported*) |
|---|---|---|---|---|
| Coordinator | main session | briefs, rulings, wiki, repository, deployment | the owner's requests, every agent's final reply | whole run |
| Infrastructure agent | one agent | `generator/`, `viewer/`, `tools/`, `shared/`, `package.json`, the spec, first blockout of every group | build brief | 46 min |
| Measurement agent | one agent | measurement scripts, cameras, dimension table, shape points, crops | build brief, photos, the investigation's SfM result | 48 min |
| Photo-masking agent | one agent | masked photo copies for the wiki | photos | 22 min |
| Modeller: seat | one agent, resumed for round 2 | `src/seat.ts`, `params/seat.toml`, seat entries of the spec | build brief + modeller instructions + measurement outputs | 41 + 14 min |
| Modeller: pods | same | `src/pods.ts`, `params/pods.toml`, pod entries of the spec | same | 36 + 15 min |
| Modeller: structure | same | platform, stand, pedals: three source files, three parameter files; in round 2 also the shared material values | same | 27 + 13 min |
| Reviewer, round 1 | fresh agent | its own folder of renders and scripts; the review report | photos, the built GLB, brief sections on mission, frames, tree and budget, tool notes, crop captions | 27 min |
| Reviewer, round 2 | another fresh agent | same | the same plus the round-1 report | running when this page was written |
| Interface reviewers A and B | two fresh agents, independent of each other | one review document each; no viewer file | the running viewer, the owner's complaint | 15 and 17 min |
| Interface implementer | one agent | a copy of the viewer (`viewer-next`), the acceptance script | both reviews, viewer source | 62 min |

The first three ran in parallel; then the three modellers and the two interface reviewers; then the
reviewer; then round 2 and the implementer.

```
17:15 ─┬─ infrastructure ───────────── 18:01 blockout
       ├─ measurement ──────────────── 18:03 table, cameras
       └─ photo masking ─── 17:38
18:05 ─┬─ modeller: structure ─── 18:32
       ├─ modeller: pods ──────────── 18:41
       ├─ modeller: seat ─────────────── 18:46      coordinator assembles: build, check, sheet, matched
       └─ interface reviews A, B ─ 18:37
18:48 ─── reviewer, round 1 ───────── 19:14          "not accepted"
19:15 ─┬─ three modellers, round 2 ── 19:30          coordinator assembles again
       └─ interface implementer (18:38 → 19:40)      coordinator runs acceptance, swaps the viewer in
19:43 ─── reviewer, round 2 (fresh) ─ …
                                         times in UTC, 2026-11-23, from the timeline file
```

## Why this shape

| Choice | Reason |
|---|---|
| Infrastructure before modelling | modelling speed depends on a build under a second and a contact sheet in a few seconds; the brief demanded both before any shape work |
| Measurement as its own agent, in parallel with infrastructure | measuring is a different skill (camera geometry, picking) and its outputs are data files with a fixed format, so nothing blocks on it |
| The infrastructure agent builds the blockout of **every** group | proves the tree, the joints and the checks end to end before three agents depend on them |
| Three modellers, split by component group | the groups meet only at mount frames, which live in parameters; each has its own source and parameter file |
| A reviewer that is not a modeller and reads no notes | a builder sees what it meant to build; the owner asked for a separate ruthless reviewer that would reject a toy |
| Two interface reviewers with different methods, then a separate implementer | two independent readings of the same page (a design inventory, and a scripted first-time-user walkthrough) agree on what matters; the implementer then cannot review its own design |

## How collisions were avoided

1. **Folder ownership**, written in the brief: each path has one owner; nobody edits another
   agent's files; a needed change elsewhere goes into the final reply.
2. **Workspaces.** `--workspace <name>` (or `RIGTWIN_WORKSPACE`) sends build output to
   `work/<name>/build/` and renders to `work/<name>/renders/`, so three agents building at once do
   not overwrite each other's GLB. `RIGTWIN_AGENT` labels each agent's timeline lines.
3. **Partial builds.** `bun run build --only <group>` imports only that group's module, so a
   half-edited source file elsewhere cannot break the loop. The frame tree is still complete.
4. **Targeted edits of the shared spec.** Each modeller changes only the entries of its own nodes,
   re-reads the file immediately before each edit and never rewrites it whole.
5. **The kit is shared and frozen.** A new operation goes into the group's own helper module
   (`src/lib/<group>-*.ts`); a real kit bug gets the smallest possible fix and a line in a change
   log. Two entries were made: a brighter generated screen image, and retuned material values.
6. **The interface implementer worked on a copy** of the viewer (`--viewer <dir>`); the coordinator
   swapped it in after the acceptance run passed.

What still collided (*from the timeline*): parameter files and the spec are loaded whole even in a
partial build. A syntax error in one modeller's parameter file stopped another modeller's build
(once), and about ten builds across both rounds failed on someone else's half-finished edit (a key
renamed, datum nodes listed before their parent); seven of them hit one modeller within two
minutes in round 2. Each failure named the file and the key, and cleared on the other agent's next
save. The fix for a larger team is one working copy per agent, merged by the coordinator.

## The modeller's loop

Per component, as written in the brief and the modeller instructions:

1. **Evidence.** Open the photo crops now, not from memory; note which faces are never seen.
2. **Identify.** What it is, what it attaches to, what moves.
3. **Dimensions.** From the measurement table and the known sizes; never nudge a measured value by eye.
4. **Shape.** Write three to five *signature features* that make the part recognisable; choose the
   simplest kit operation that shows them.
5. **Build → check → render** (group view, orthographic views, photo-matched views, close-ups) and
   **look** at the render beside the photo crop, feature by feature.
6. **Decide:** accept, fix the single most consequential mismatch, or record what is still wrong.
   At most four iterations per component per round.

What "done" meant for a group: the right *kind* of shape; dimensions entered as records with honest
class, range and evidence; edges that catch light; correct materials; parts that meet their
neighbours without floating or cutting into them; pivots on the physical axes; no detail that costs
triangles without helping recognition; inside the triangle budget.

Iterations actually used (*from the modellers' timeline lines*): seat back shell 7 (above the cap),
seat lower shell 5, joystick grip 4, bellows 3, pod shell 3, touchscreen arm 3, stand 2, pedals 2,
platform 1. One build-render-look cycle took well under a minute of machine time; the agent's
reading and thinking dominate. Round 2 took 13–15 min per modeller for the findings of its group.

One rule from the measurement agent turned out to matter in the loop: for parts seen only from the
rear-right photo pair, a matched overlay looks right even when the part is 5–10 cm off along that
view. Modellers were told to trust the table there, not the overlay.

## The independent reviewer

**Receives:** the photographs; the built GLB (it keeps a snapshot and quotes its SHA-256); the
brief's sections on the mission, frames and names, the component tree and the budget; the tool
notes, so it can render; the crop captions. **Does not read:** the builders' notes, the modellers'
final replies, the measurement report. It makes all its renders itself, with its own driver script,
and takes geometry figures from its own GLB reader, not from the builders' tools.

Isolation was by instruction, not by a sandbox: the reviewer ran in the same folder as everyone
else. The plan's packet folder outside the repository, and its test that a marker string in the
builders' notes cannot be reached, were not set up.

**Procedure** (as reflected in the round-1 report):

1. **Inventory from the photos alone**, before any render: each component and the features that
   make it recognisable; then compare with the model's tree.
2. **Whole-rig impression** from its own renders (ten views).
3. **Per component:** close-ups, side by side with the photo crop; joints at their limits;
   reference frames; its own intersection tests (38 pairs) and posed collision tests.
4. **Performance and economy:** triangles that buy nothing; things to remove or simplify.
5. **What it could not judge**, stated explicitly.

**Verdict format:**

| Part of the report | Content |
|---|---|
| Overall verdict | one sentence, then what is right, what stops acceptance, and "accept when" with the list of finding ids |
| Verdict per component | `ACCEPT`, `ACCEPT WITH MINOR FIXES` or `REJECT`, with one line of reason |
| Findings | id, component, severity, **Photo** (which photo region), **Render** (which image), **Wrong** (observation, with numbers from its own reader), **Change** (what to build instead, with a triangle estimate). A size remark is a hint to check against the measurement table, not an instruction |
| Severity | BLOCKER = reads as a toy, or unusable for evaluation or training; MAJOR = clearly wrong to someone who knows the rig, or fails in use; MINOR = polish |
| The ten changes that most increase credibility per unit of effort | ordered list |
| What I could not judge | unseen sides, depth along the rear view, assumed ranges |

**Round 1 result:** "In between: a credible layout carrying a few toy-grade parts. Not accepted
yet." 45 components with geometry: 28 accepted, 9 with minor fixes, 8 rejected (seat cushion, back
cushion, both pod shells, both joystick bases, monitor arm, pedal base); 1 blocker, 8 major
findings. Three of the major findings were moving parts that failed when moved (the joystick boot
tore, the monitor left its arm, pedals passed through a cross bar). All scripts had passed.

**Rounds.** The same modeller agents were resumed with the findings for their group. The second
review is done by a fresh agent that also reads the round-1 report, so it can say what was fixed.
<!-- UPDATE after the final modelling round: round-2 verdict and whether a round 3 was run -->

## The interface reviews and the implementer

The owner found the first viewer overcomplicated. Two reviewers looked at it independently:
reviewer A made an inventory of every control and a heuristic evaluation (103 controls on the
default page) and proposed a design with 19; reviewer B drove the page like a first-time user
through 12 tasks at two window sizes with real pointer events (the 3D view had 58 % of the window)
and listed blockers. Neither changed a viewer file. Both were told to keep the machine interface
for agents: every URL parameter and the `viewer.*` functions.

A separate implementer received both reviews, rebuilt the page in a copy, and turned both reviews'
checklists into an acceptance script of 53 checks driven by real pointer, wheel and key events
(see [Checks](checks.md)). It also compared the machine interface with the previous viewer picture
by picture. The coordinator ran the script itself before swapping the new viewer in.

## What a brief contained

The build brief shared by every build agent had twelve sections. As a reusable template:

| Section | Content | Why it is there |
|---|---|---|
| 1. Mission | what to build; the owner's own words; what "credible" means in observable terms; that a reviewer will reject a toy | the agent must know the bar, not just the task |
| 2. Hard rules | banned names; no logos or text; where photos may live; nothing installed system-wide; no repository operations; stay inside your files; numbers in parameter files; report honestly | constraints that must hold whatever else happens |
| 3. Stack | the approved tools and versions | prevents each agent choosing its own |
| 4. Frames, units, names | axes, origin, naming pattern | the contract between parallel agents |
| 5. The component tree | every node with its joints | same |
| 6. Parameters | the record format and the loader's rules | same |
| 7. Known facts | the owner's figures, maker's data, provisional estimates with ranges; "use these, do not re-guess" | stops agents re-deriving, differently, what is known |
| 8. Shared file formats | cameras file, GLB + manifest, timeline line, milestone images | so outputs of one agent are inputs of another |
| 9. Folder ownership | path → owner | collision avoidance |
| 10. Commands | build, check, render, serve, with the speed required | everyone uses the same loop |
| 11. Quality and performance budget | triangles, bytes, draw calls, frame rate; shading and material expectations | measurable targets |
| 12. The loop | evidence → identify → dimensions → shape → build, check, render, look → decide; iteration cap | the thought process, written down |

A role brief (here: the modeller instructions) adds:

| Part | Content |
|---|---|
| Read first, in order | the common brief, the tool notes, the measurement outputs |
| Rulings | decisions the coordinator has made since the common brief, which override it (which deck size, which seat height, which touchscreen size) |
| How to work without colliding | workspace name, files owned, how to touch shared files |
| What "done" means | observable criteria for this role |
| Verification the agent must do itself | run the full check; look at its own renders beside the photo crops; keep one milestone image set; append timings to the timeline |
| Final reply | a word limit and a fixed list: what was built, what is still wrong and why, counts, iterations and time, changes to shared files, conflicts found, paths of images; "be honest about weaknesses: the reviewer will find them anyway" |

Two habits made the briefs work: stating **known facts with their status** (measured, maker's,
provisional), and asking for **failures as carefully as successes** in the reply.

## What the coordinator checked personally

- After each assembly of the three groups: a full build, the full check, a contact sheet and the
  photo-matched renders, and it looked at the images (*timeline: 18:46, 19:30, 19:40 UTC*).
- The viewer in a real browser pane: rotate, zoom, hide a group, no console errors.
- Every conflict between a source and the photos, as a written ruling: deck 1.50 × 1.41 m; seat
  back top 1.28 m with the owner's 1.40 m recorded as conflicting evidence; touchscreen 13.3-inch.
- The root cause of a failure reported by the owner (the missing left joystick): the trial's brief
  had named only the right pod, the figures did not list omissions, and no coverage check existed.
  All three were fixed in the method, not only in the model.
- The interface acceptance run (53 of 53) before swapping the viewer.
- Each agent's duration, tokens and tool calls as reported by the harness, for the performance record.

## Parts of the approved process that were not exercised

| Planned | What happened instead |
|---|---|
| Human gates after the blockout and after form | none; the reviewer agent and the coordinator stood in |
| About forty points clicked by the owner as held-out landmarks, and as a measure of the agent's picking accuracy | not done; no held-out landmark table exists |
| The owner's verdict on a "look sample" | replaced by the reviewer's verdict |
| An acceptance author writing a locked spec before modelling | not used; the build brief and the checks served as the spec, and the builders could in principle change the checks |
| Reviewer isolated in a packet folder, with a reachability test | isolation by instruction only |
| Three sealed reviewer steps | the photo-first inventory was done; naming every component from renders with no list was not evidenced |
| Planted-error test of the reviewer (a part removed, a part mirrored, dimensions off by 5, 10, 20 %) | not done. The reviewer's detection threshold is therefore unknown; its clean verdicts on sizes carry little weight |
| Shifting ten parameters by 75 mm to see whether the comparison flags them | not done |
| A status script and state file; a deviation budget; a process audit per gate | not built; the timeline file and the coordinator's notes served |
| Modelling in series for the first asset | three modellers in parallel |
| Photos masked before agents see them | dropped (the owner: confidentiality is no concern); masking kept for published wiki images |
| The Skill written first and followed | the build brief served as working guidance; the Skill was extracted afterwards |

The deviations page under `30-plan/` records the reasons. The consequence to keep in mind: what
this run demonstrates is the build loop, the checks and the review of *likeness*. It does not
demonstrate verified sizes.
