# Observing and reviewing

How to look at a build, what a look can and cannot establish, and how to run the independent
reviewer. The reviewer's own instructions are in `.claude/agents/asset-reviewer.md`.

## Contents

- Status
- The observation kit
- What an AI model's eye can be trusted with
- Running the independent reviewer
- The two-edged standard
- Verdicts, severities and findings
- Rounds
- Reviewing the viewer itself
- The planted-error test (recommended, not yet exercised)

## Status

Exercised: the observation kit; two independent review rounds on assembled models (the first
rejected, the second accepted after three small fixes); two independent usability reviews of
the viewer. In both rounds the reviewer was a general agent with shell access, working in its
own folder under a written brief: it made its own renders and wrote its own GLB reader and
collision counts, and that is where its hardest findings came from. **Not exercised:** the
read-only `asset-reviewer` definition as written; isolation enforced by tooling (it was by
instruction, and each reviewer stated what it had not read); a leak test; the planted-error
test; human gates.

A read-only reviewer cannot make renders or numbers of its own. Until that has been tried, the
coordinator either puts joint-limit renders and a script-made list of interpenetrations into
the packet, or runs the reviewer as a general agent under the same instructions and says so.

## The observation kit

All views come from the same viewer the person uses, driven headless, so agents and people
judge the same renderer.

| View | Command | Use it to see |
|---|---|---|
| Contact sheet | `bun run render --set sheet` | the whole object from several sides; the footer prints triangles, draw primitives, size, GLB hash, **omitted and missing components**, and warns on a partial build |
| Orthographic set | `--set ortho` | proportions without perspective |
| ID colours | `--set ids` | each component in a flat distinct colour: missing, merged or misplaced parts |
| Per-group views | `--set groups [--only <group>]` | one group isolated, three views |
| Close-ups | `--set focus --fit <id>[,<id>] [--mode ids]` | a component framed on its own |
| Photo-matched | `--set matched [--cam <photo>]` | render through the solved camera; ID colours; outlines drawn on the photo; a blend. Written to `private/renders/` |
| Joint-limit poses | add `--pose J_x:<value>[,J_y:<value>]` | every unlocked joint at lower and upper limit: tears, parts leaving their carrier, parts passing through neighbours |
| By data source | `--mode class` | which parts rest on measured, vendor, photo, assumed or invented values |
| Reference frames | viewer parameter `frames=1` | where the frames sit and which way they point |
| Viewer page | `--set ui` | the page as a user first sees it |

Rules for looking:

- Put render and photo crop side by side at the same viewpoint and compare feature by feature.
  Describe the photo first, then the render.
- Never accept on one view. Include a view from where a standing person would see the object
  and the views the photos were taken from.
- **Check exposure before judging form.** Lit light-coloured surfaces must stay clearly below
  clipping. On the first asset they sat at about 245 of 255 with no gradient, which hid every
  facet and bevel that had been modeled; bringing them to about 200–225 was the cheapest
  single gain in credibility. Measure pixel values; do not guess.
- Similar dark materials need visibly different colour and roughness, or parts are told apart
  only by position.
- Keep milestone images whenever the model changes stage, and never delete them.

## What an AI model's eye can be trusted with

| Act on it | Needs a tool or a second look | Never; use code |
|---|---|---|
| a part is missing or extra; gross proportion; the kind of shape; signature features present or absent; colour and material; "reads as a toy" | left/right swaps; attached or floating; which of two renders is closer | any size, distance or angle as a number; differences under roughly 10 %; collisions and clearances; hierarchy and pivots |

Consequences:

- A reviewer's remark about size is a **hint**. It goes to the dimension table or back to
  measurement; nobody changes a measured value because a render "looks" off.
- Collisions and overlaps were found reliably only by posing joints and counting vertices of
  one mesh inside another with a script.
- A photo-matched overlay cannot show an error along the camera's line of sight. Read it with
  the cannot-check list from the measurement report.

## Running the independent reviewer

**Who.** A new agent instance for every round, started as its own agent type, never as a copy
of the coordinator's conversation. It must not be one of the builders.

**What it gets.**

- The reference photos and captioned crops, with the instance each shows.
- A snapshot of the build (GLB and description file copied aside, hash noted), so it does not
  review a moving target.
- The observation kit rendered from that snapshot, including joint-limit poses and frames. If
  the reviewer has shell access it makes its own renders; if it is the read-only
  `asset-reviewer`, the coordinator prepares this packet and renders more views on request.
- The purpose, audience and budgets from intake, and the playbook for the asset type.
- The component list (ids and labels), opened only at step 3 below.

**What it must not get.** Builders' notes and final reports; the coordinator's notes and
rulings; the builders' lists of signature features; known deviations; chat history; any
sentence in the delegation message that explains or excuses the model. A single authoritative
note can flip a correct verdict.

**Sealed steps**, in order, each written down before the next is opened:

1. *Photos only.* Inventory of what the photos show, with the reviewer's own signature features
   for each part and what appears to move.
2. *Renders only.* Whole-object impression from several viewpoints. What reads as a toy, in
   order of effect? What does not?
3. *Compare, now with the component list.* Is anything missing, extra or wrongly split? Then
   component by component against the photos.
4. *Motion.* Every joint at its limits.
5. *Reference frames and human dimensions.* Are they where a user of the asset would expect,
   and are the human-related values plausible for stated body sizes?
6. *Economy.* Triangles and draw primitives by component: what to remove, where they are missing.

**After the report.** The coordinator saves it verbatim, turns findings into task lists per
owner, and gives cross-cutting findings (rendering, materials) to exactly one owner. Builders
answer each finding "fixed" or "contested, with a measurement". Only a later build seen by a
fresh reviewer, or a measurement, closes a finding.

A later round's reviewer should form its own impression first and only then receive the
previous findings to confirm closure. (On the first asset round two received the round-one
report from the start; the stricter order is a recommendation.)

## The two-edged standard

The reviewer rejects in both directions:

- **No toy.** Someone who knows the object recognises it at a glance from any angle;
  proportions and layout are right; each component is the right kind of shape; edges catch
  light; materials read correctly; nothing floats, tears or intersects, at rest or when moved.
- **No wasted detail.** Nothing that costs triangles, draw primitives or build time without
  helping recognition or the stated use: no fasteners, stitching, cables, logos, text. Detail
  belongs on the surfaces people touch and look at most; small hardware gets the minimum. On
  the first asset one small button had more triangles than a main body-contact surface.

## Verdicts, severities and findings

- Per component: **ACCEPT**, **ACCEPT WITH MINOR FIXES** or **REJECT**, with one line of reason.
- Overall: the same three words, plus what stops acceptance and an explicit "accept when" list.
- Severity: **BLOCKER** reads as a toy or is unusable for the stated purpose; **MAJOR** is
  clearly wrong to someone who knows the object, or fails in use; **MINOR** is polish.
- A finding states: an id; the component; the photo and region; the render file; what is wrong
  (kind of shape first, then hints about size); the suggested change and its rough triangle
  cost.
- Mandatory sections: "Things to remove or simplify", "The changes that most increase
  credibility per unit of effort" (ranked), and "What I could not judge" (unseen faces,
  unverifiable directions, assumed ranges, anything needing a tape or a vendor drawing).
- Decisions that belong to the person (for example a stated figure overruled by a photo
  estimate) are listed as decisions needed, not as modeling faults.

## Rounds

1. Round one on the first assembled model that passes the full check.
2. Fix round: the same modellers resumed with their findings; cross-cutting fixes by one owner.
3. Full check, new milestone images, fresh reviewer.
4. Stop per the Skill's stop rules. Expect the first round to reject several components: on
   the first asset it rejected about one in six while accepting layout and proportions, and the
   second round closed those findings and asked for three small fixes.

## Reviewing the viewer itself

When the person finds the viewer hard to use, give it to independent usability reviewers who
drive the real page headless and **count and measure** before proposing anything: controls
visible at once, steps per common task, target sizes, load time and frame rate, what a control
does when used. They state the limits of their evidence (one machine, no real person tested).
A separate implementer then makes the changes, checked by a scripted acceptance run.

## The planted-error test (recommended, not yet exercised)

A reviewer's clean report means little until it is known what that reviewer catches. Before
relying on "no findings":

1. Prepare packets from the real build with known defects, one or two per packet: a part
   removed (one large, one small); a part mirrored; a size or position off by 5 %, 10 % and
   20 %; a pivot in the wrong place; an invented detail. Add one packet with nothing wrong.
2. Run each defect packet twice with fresh reviewers and the clean one once.
3. Record detection by defect type and size, false findings on the clean packet, and agreement
   between runs.
4. Rule set in advance: structural defects and errors of 20 % or more are caught in both runs
   with at most one false alarm, or the reviewer's clean reports do not count. Below the size
   it reliably catches, only the numeric checks apply; write that size on the model card.
5. If the reviewer's instructions are then changed, test again on new defects.

Also recommended and not exercised: a leak test (plant a unique marker in the builders' notes
and confirm it never appears in the reviewer's transcript), and running the reviewer on a
different model tier from the builders.
