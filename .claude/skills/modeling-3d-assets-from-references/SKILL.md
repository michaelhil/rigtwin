---
name: modeling-3d-assets-from-references
description: >-
  Builds credible, modular, parametric 3D assets (a GLB with a named component tree, joints and
  reference frames, plus a description file) from reference photos, sketches or partial
  measurements, using generator code and parameter records in which every value has a source and a
  range, camera-matched comparison against the photos, automated checks and an independent
  reviewer. Use whenever the task is to model, reconstruct, block out, refine, re-dimension,
  review or resume a 3D model of a physical object (workstation, cockpit, rig, console, vehicle
  interior, machine, furniture, equipment) from pictures or incomplete data, even if the user only
  says "make a 3D model of this from these photos"; when a model must stay adjustable as real
  measurements arrive; or when a component and joint decomposition is needed for ergonomic
  assessment or simulation. Not for photogrammetry or 3D scanning, free-form sculpting, texture
  painting or text-to-3D generation.
compatibility: >-
  Needs the project toolkit beside it: parameter loader, generator, checks, headless render driver
  and viewer (run with Bun; Python 3 for the independent reader). Written for Claude Code in a
  repository with this project's structure.
metadata:
  version: "0.1.0"
---

# Modeling 3D assets from references

Turns photos and partial sizes of a real object into a parametric, articulated asset: generator
code + parameter records → one GLB + one description file, checked by scripts and judged by an
independent reviewer. **Unit of reuse:** this Skill drives the project's toolkit (`generator/`,
`tools/`, `viewer/`, `shared/`) and cannot build anything without it. **[E]** = exercised on
the first asset; **[N]** = not yet exercised.

## Invariants

1. **Numbers live in parameter records, never in generator code.** A tape value must be able to
   replace an estimate without a code change.
2. **Every record says how it is known**: class, basis, range, tier, evidence. An invented value
   that looks measured will be used as if it were.
3. **No size, distance or angle is set or judged by eye in a render or overlay.** Sizes come
   from the dimension table; a mismatch goes back to measurement. Eyes are unreliable below
   about 10 %, and an overlay cannot see depth along its line of sight.
4. **Cameras are solved on named, fixed gauge features before any overlay is trusted**, never on
   the part being judged or on a part that may have moved between photos. Otherwise the overlay
   agrees by construction.
5. **Scale is closed against other known sizes before modeling.** A range must cover the
   disagreement between methods; a conflict is recorded, not averaged, and not explained away by
   a correction nobody tested.
6. **The spec lists every component and every build is compared with it.** Each component is
   built or listed as omitted with a reason, left and right alike. A whole side was once missing
   and nothing noticed.
7. **Block out the whole object, every component, before refining any.** The blockout tests the
   tree and the proportions. A brief never scopes a component out silently.
8. **One written definition turns a joint value into a transform**, shared by generator and
   viewer and compared with an independent reader. A moving part's origin lies on its physical
   axis.
9. **The builder does not mark its own work.** Scripts decide what is numeric; a reviewer who
   has not seen the builders' notes decides whether the model matches the references. Nobody
   weakens a check, a budget or the spec to get a pass.
10. **Two-edged standard: no toy, no wasted detail.** Credible at a glance to someone who knows
    the object; nothing that costs triangles or build time without helping recognition or use.
11. **Photos are confidential by default.** Originals are read-only; anything containing photo
    pixels stays in `private/`; no brand, client or personal names in the repository.
12. **Report honestly.** Failed attempts, deviations and what the photos cannot check are part
    of the result.

## Resuming work on an asset

State is in files, not in memory. There is no status script yet [N], so:

1. Invoke this Skill by name at the start of every session; "continue" alone may not load it.
   After compaction, re-read any reference you rely on.
2. Read the asset's notes: the coordinator notes, the newest `work/review/round<N>.md`, and the
   project wiki's overview and log if present.
3. `bun run build && bun run check`. The checks, not the notes, say what is true now.
4. `bun run render --set sheet` and look: the footer lists omitted and missing components and
   says when a build is partial.
5. Read `assets/<asset>/build/<asset>.manifest.json`: class counts, `omitted`, joints.
6. Find the earliest unfinished step of the sequence below and continue there. Never conclude
   "done" from how complete the folder looks.

## Intake for a new asset

Ask the person, in one message, and record the answers verbatim:

- **Purpose**: what will consume the asset (which assessments, which simulation, a viewer)?
- **Audience**: who must find it credible, and what would make them call it a toy?
- **Target level**: blockout or formed model; triangle, size and frame-rate budgets.
- **Reference instance**: if the photos show several instances or variants, which one is modeled?
- **Known sizes**: tape values, drawings, model labels of purchased parts. For each figure:
  measured from where to where?
- **Confidentiality**: names to keep out; may agents see unmasked photos; will anything be public?
- Can better input be requested? If yes, send the capture protocol and measurement request from
  `references/measuring-from-photos.md` before estimating.

## The sequence

1. **Evidence set [E].** Working copies under `private/`; per photo: which instance, what may
   have moved, which viewpoints are really distinct; crops per component with captions.
2. **Cameras and scale closure [E].** `asset-measurer` ties one camera set to named gauge
   features, sets scale from one known size and tests it against the others.
3. **Dimension table [E].** Each dimension with class, range and evidence; what the photos
   cannot check; conflicts with stated figures; a ranked tape request. The coordinator writes a
   ruling for each conflict.
4. **Decomposition spec [E].** Tree, groups, mount frames, joints with kind and evidence level,
   reference frames, expected-motion and left/right tables. Show the person the tree [N].
5. **Whole-object blockout with EVERY component [E].** Simple solids of the right size, in the
   right place, on their pivots. The contact sheet prints the omitted list.
6. **Checks [E].** `bun run check` passes on a full build. Make each new check fail once on
   purpose before relying on it.
7. **Photo-matched comparison [E].** `bun run render --set matched`: render, ID colours and
   outlines through each solved camera. Read it beside the cannot-check list.
8. **Independent review [E].** A fresh `asset-reviewer`; a verdict per component and overall.
9. **Form rounds [E].** One `component-modeller` per group, in parallel, each running the loop
   below; the coordinator assembles, runs the full check, keeps milestone images and calls a
   fresh review. Repeat until the stop rules say stop.
10. **Drills [N].** Change listed parameters within their ranges and rebuild; enter a value in
    `measured.toml` and rebuild with no code change; swap a purchased part's device record.
11. **Model card [N].** Class counts, deviations, unverified critical values, what cannot be
    checked, review verdicts, and the Skill version that produced the asset.
12. **Retrospective [E, once].** Sort lessons into universal, asset-type and asset-specific
    (rule in `CHANGELOG.md`).

**Delegating.** Give each agent a named build folder, the files it owns and the coordinator's
rulings. Modellers build with `--build <name> --only <group>`, edit only their own nodes in
the shared spec, and leave the toolkit and the checks alone. Resume the same modeller for the
next round; start a new reviewer every round. Human gates (approving the spec, a first look,
acceptance) belong to the design but were replaced by the reviewer on the first asset [N].

## The builder's loop, per component

1. **Evidence.** Open the photo crops now, not from memory; note which faces are never seen.
2. **Identify.** What it is, what carries it, what moves about which axis, bought or bespoke.
3. **Dimensions.** From the dimension table and vendor records, entered as parameter records.
   Never nudge a measured value by eye.
4. **Shape.** Write three to five signature features that make the part recognisable. Get the
   kind of shape right first (faceted or soft, flat or curved); choose the simplest kit
   operation that shows those features.
5. **Build, check, render, look.** `build --only <group>` → `check` → render (`groups`, `ortho`,
   `focus`, `matched`) → compare render and crop feature by feature, from the photo's viewpoint.
   Move every joint of the part to both limits and look again. Check that the part meets its
   neighbours: no floating, no interpenetration.
6. **Decide exactly one:** accept; fix the single most consequential mismatch; or record a
   deviation and say which evidence or tool is missing.

## Commands

```bash
bun install                                   # once
bun run build [--only <group>[,<group>]] [--build <name>] [--asset <id>]
bun run check [--fast] [--build <name>]   # --fast skips the two browser checks
bun run render --set sheet|ortho|ids|groups|matched|focus|ui|selftest|all \
    [--only <group or id>] [--fit <group or id>] [--cam <photo>] [--pose J_x:val,...] \
    [--mode ids|class] [--build <name>] [--out <dir>]
bun run serve [--port <n>] [--build <name>]   # the viewer, locally
bun run dist [--out <dir>] [--no-verify]          # self-contained deployable folder
bash .claude/skills/modeling-3d-assets-from-references/scripts/check-vocabulary.sh
```

Set `SYNERGON_BUILD_DIR=<name>` and `SYNERGON_AGENT=<role>` when working in parallel. Images with
photo pixels are written under `private/renders/`. Every agent appends timings to
`work/timeline.jsonl`. `generator/README.md` lists the kit operations. Only `build` takes
`--asset`; `check`, `render`, `serve` and `dist` still hard-code the first asset's id [N].

## Stop rules

- **Per component:** at most four iterations per round. Then record the deviation and move on.
- **Per round:** every finding is answered "fixed" or "contested, with a measurement". Only a
  later build and a fresh review, or a measurement, closes it.
- **Rounds:** plan for two or three. If a third review rejects the same component, stop: the
  cause is missing evidence or a missing tool, not effort.
- **Finished** means: full check passes; the newest review has no REJECT and no open blocker;
  drills pass; the model card lists every deviation. The builder cannot declare it.
- **Report the verdict in parts:** structure and motion; sizes ("unverified" until tape values
  exist); looks; re-adjustability. Never one word.
- **Do not polish past the standard.** When a component passes, leave it.

## When to stop and ask a person

- The scale does not close (known sizes disagree by more than about 3 %) and nothing settles it.
- A stated figure conflicts with the photos: record both, model the better supported, ask what
  it was measured from and to.
- It is unclear which instance is the reference, or whether a motion exists that the purpose
  depends on.
- A critical-tier value is assumed or invented and the next use would rely on it.
- A component fails its iterations for lack of evidence: ask for the photo that would settle it.
- Anything about confidentiality, publishing, pushing or deploying.
- Any change to a check, a budget, or node IDs that something downstream already uses.

## Where to read more

- `references/asset-contract.md`: read when writing a spec, parameters, joints or frames.
- `references/measuring-from-photos.md`: read before solving cameras, estimating or filling a
  size, handling a conflicting figure, or asking for photos and tape values.
- `references/decomposing.md`: read before changing the tree, joints, pivots or motion table.
- `references/reviewing.md`: read before rendering for judgment or briefing the reviewer.
- `references/failure-modes.md`: read when something looks right too easily, or after a surprise.
- `playbooks/seated-workstation.md`: read when the asset is a seated operator station.
- `CHANGELOG.md`: version, basis, what would make this 1.0, and how lessons enter the Skill.

## Status of this version

- **Exercised, once, on one asset:** steps 1–9 with three parallel modellers and two review
  rounds; the retrospective that produced this text.
- **Not exercised:** human gates; hold-out points clicked by a person; an acceptance spec by a
  separate author; a planted-error test of the reviewer; drills; a second object or repository.
- **Template for a new project:** this repository's structure (Skill, agent definitions,
  toolkit) without the first asset's folder. Keep no personal copy: it would shadow this one.
