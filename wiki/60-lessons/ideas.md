---
title: Ideas and improvements not yet done
tldr: Twenty-four ideas (I-01 to I-24) that came up during the work and were not carried out, each with the reason it matters and a rough size. The first five close gaps in the evidence for the method; the rest extend the asset, the checks and the viewer.
status: living
updated: 2026-11-23
tags: [lessons, ideas, backlog]
---

# Ideas and improvements not yet done

## TL;DR

- Nothing on this page has been built. Planned work with an owner and an order is on [next-steps](../90-next/next-steps.md); this page is the wider pool.
- The five that matter most for trusting the method: test the reviewer with planted errors (I-01), a locked acceptance specification with points held out by a person (I-02), a scripted interference check at joint limits (I-03), scoring against tape values (I-04), and a second object built by a fresh agent with only the Skill (I-05).
- Sizes are rough: **S** up to one agent-hour, **M** a few agent-hours, **L** about a day of agent work with several agents, **XL** a project phase. They are *judgment*, made after one run.
- Several come straight from the approved plan and were skipped when the owner asked for a fully autonomous run; those are marked "planned, not run".
- When an idea is carried out, move its result to the page it belongs to and mark the entry "done, see …". Do not renumber.

## Overview

| ID | Idea | Size | Origin |
|---|---|---|---|
| I-01 | Test the reviewer with planted errors of graded size | S | planned, not run |
| I-02 | Locked acceptance specification by a separate author; points held out and clicked by a person | M | planned, not run |
| I-03 | Scripted interference check at joint limits | M | round-1 review |
| I-04 | Score the frozen photo estimates against tape values | S | planned, waits for a tape |
| I-05 | Second, different object built by a fresh agent with only the Skill | L | planned, not run |
| I-06 | Fit parameters and cameras together by least squares | L | measurement |
| I-07 | A click page for point picking by a person | M | planned, not built |
| I-08 | The other rig configurations as overlays on the same asset | M each | photos |
| I-09 | The assessment layer: sized manikins, reach and vision analysis | XL | plan |
| I-10 | Viewing-distance envelope from the monitor arm's range | M | planned, not run |
| I-11 | Simulator binding: real joysticks and pedals, live pictures on the screens, first-person view | L | plan |
| I-12 | Deployment from GitHub on every push | S | coordinator |
| I-13 | Look up the makers' sheets still missing | S | measurement, review |
| I-14 | Look up the anthropometric source for the eye points | S | round 2 |
| I-15 | Frame rate and exposure on a weak laptop and a phone | S | UX review |
| I-16 | An artist-made shell for presentation | M | plan |
| I-17 | A scripted surface-quality and triangle-distribution check | M | round-1 review |
| I-18 | The three re-adjustment drills | S | planned, not run |
| I-19 | Frames-in-bulk output and per-component export for other tools | M | planned, not built |
| I-20 | A reviewer from another model family, or a person | S | critique |
| I-21 | A measuring tool in the viewer that shows ranges | M | planned, not built |
| I-22 | Fewer draw calls: one material per button with the ring as vertex colour | S | round-1 review |
| I-23 | Remove or use the 11 parameters that nothing reads | S | check warning |
| I-24 | Agent start and stop times written by a wrapper, not by the agent | S | timeline errors |

---

## Evidence for the method

<a id="i-01"></a>
### I-01 — Test the reviewer with planted errors

- **Why.** The reviewer decides whether the model is credible, and nobody knows what it can detect. It found a seat cushion that was a faceted trough; would it find a seat 6 cm too far back, or a joystick 3 cm too tall? Without a threshold its "accept" has no stated power ([F-09](failures-and-fixes.md#f-09), [L-26](lessons-learned.md#l-26)).
- **What.** Build variants of the model with one known error each (sizes 1, 2, 5, 10 cm; one wrong shape; one clean copy). Give each to a fresh reviewer with the standard brief. Report the detection rate per error size and the false alarms on the clean copy.
- **Size.** S per variant; about 6 variants. The build takes 0.2 s, so the cost is reviewer time (27 minutes per review here).

<a id="i-02"></a>
### I-02 — A locked acceptance specification and points held out by a person

- **Why.** In this run the builders, the checks and the reviewer were all agents of one kind. The plan's answer was a specification written by a separate agent and approved by the owner before modelling, plus about forty landmark points clicked by the owner and never shown to the builders.
- **What.** An acceptance-author agent; a small click page (I-07); a comparison script with a fixed tolerance.
- **Size.** M, plus about 40 minutes of the owner's time.

<a id="i-03"></a>
### I-03 — Scripted interference check at joint limits

- **Why.** Three joints failed in use although the motion check passed ([F-19](failures-and-fixes.md#f-19)). The reviewer and one modeller each wrote a one-off test.
- **What.** With the independent reader, pose each joint at lower limit, neutral and upper limit; count vertices of the moving subtree inside other closed meshes; list pairs that are allowed to touch. Add to `bun run check`.
- **Size.** M. Starting points: the reviewer's `geom.py` and the structure modeller's `clearance.py` (both in the unpublished work folder).

<a id="i-04"></a>
### I-04 — Score the photo estimates against tape values

- **Why.** No size in the model has been checked against a real measurement. The dimension table was frozen before modelling, so it can be scored fairly.
- **What.** When tape values arrive: per dimension, error and whether the stated range contained the truth; then replace the values (class *measured*) and rebuild.
- **Size.** S for the agents; 30–40 minutes on site for a person.

<a id="i-05"></a>
### I-05 — A second, different object built with only the Skill

- **Why.** One object and one run do not show that the method transfers.
- **What.** The owner photographs a different object with moving parts casually, tapes about ten dimensions and seals them. A fresh agent session gets the Skill and the template only, builds to blockout level and freezes its predictions; then the tape values are opened.
- **Size.** L (the plan estimated 4–6 agent-hours; this run suggests less).

---

## Measuring

<a id="i-06"></a>
### I-06 — Fit parameters and cameras together

- **Why.** Cameras were solved first and parameters measured through them one at a time. A joint least-squares fit of the model's key parameters and all cameras to traced edges would use every photo at once and give proper uncertainties.
- **Size.** L. Risk: with depth unobservable from the main photos ([F-07](failures-and-fixes.md#f-07)) the fit needs priors, and those must stay visible.

<a id="i-07"></a>
### I-07 — A click page for a person

- **Why.** Needed for I-02; also the fastest way for the owner to settle a disputed landmark.
- **Size.** M.

<a id="i-13"></a>
### I-13 — Look up the makers' sheets still missing

- **Why.** Four values rest on guesses where a sheet probably exists: the 13.3-inch touchscreen's outer size (width now 0.33 ± 0.03 m by proportion), the joystick's pivot height (0.012 ± 0.02 m assumed), the pedals' travel, and the seat's make and model.
- **Size.** S each, once the model labels are known; the labels are on the tape list.

<a id="i-14"></a>
### I-14 — Look up the anthropometric source for the eye points

- **Why.** The three eye heights (0.685 / 0.765 / 0.845 m above the seat surface) are quoted from memory of a published table, and the 0.2 m forward offset from "rough figures from memory". They drive every viewing-distance number.
- **Size.** S.

---

## The asset

<a id="i-08"></a>
### I-08 — The other rig configurations as overlays

- **Why.** The photos show the same seat and pods in a van (Rig A) and in a control room (Rigs C1, C2) with a keyboard shelf, loudspeakers, a steering-wheel base under the shelf and a gooseneck microphone. An overlay is a small parameter and spec difference on the same asset.
- **Size.** M per configuration. Note that the left side of the reference rig's seat is already borrowed from these instances.

<a id="i-16"></a>
### I-16 — An artist-made shell for presentation

- **Why.** If presentation quality is ever needed, a modelled mesh for the seat shell could replace the generated one. Blender remains uninstalled.
- **Cost.** That component would stop following its parameters. Size M.

<a id="i-22"></a>
### I-22 — Fewer draw calls

- **Why.** The model uses 67 of 80 allowed draw primitives; the ring buttons, key switch and emergency stop take two each. A one-material button with the ring as vertex colour would save about 6. A first trial in round 2 was dropped.
- **Size.** S.

<a id="i-23"></a>
### I-23 — The 11 parameters that nothing reads

- **Why.** Every check run warns about them. Some are deliberate records (the owner's 1.4 m and 1.2 m); others are makers' values the model does not use (monitor arm lift and reach, the catalogue size of the emergency stop).
- **What.** Mark deliberate records as such so the warning lists only real leftovers.
- **Size.** S.

---

## Checks and review

<a id="i-17"></a>
### I-17 — A surface-quality and triangle-distribution check

- **Why.** The round-1 rejection of the upholstery was about facets, which a script could flag: the largest angle between neighbouring face normals on parts tagged as body contact, and triangles per tagged area ([F-18](failures-and-fixes.md#f-18), [F-22](failures-and-fixes.md#f-22)).
- **Size.** M. It would support the reviewer, not replace it.

<a id="i-18"></a>
### I-18 — The three re-adjustment drills

- **Why.** The owner asked that the asset can be adjusted when measurements arrive. The plan had three drills to prove it with no code change: replace an estimate by a measured value; swap a purchased device for another model; change a joint's range. They were not run as drills, although the round-2 work changed many parameters without touching the generator.
- **Size.** S.

<a id="i-20"></a>
### I-20 — A reviewer from another model family, or a person

- **Why.** Builders and reviewers share whatever blind spots the model family has.
- **Size.** S to try with one review; a person who knows the rig would be best.

<a id="i-24"></a>
### I-24 — Agent times written by a wrapper

- **Why.** Agents' own duration figures were wrong three times ([F-28](failures-and-fixes.md#f-28)).
- **What.** The coordinator, or a hook, appends a start line and an end line per agent run with the harness figures.
- **Size.** S.

---

## Viewer and deployment

<a id="i-12"></a>
### I-12 — Deployment from GitHub on every push

- **Why.** Deployment is one command run from the owner's machine. Running it from the repository on every push needs a deploy key on the server, which is a credential and therefore the owner's decision.
- **Size.** S once decided.

<a id="i-15"></a>
### I-15 — Frame rate and exposure on other devices

- **Why.** All figures come from one Apple M2 and a headless browser capped at 60 frames per second. Touch input was not driven. A weak integrated GPU and a phone were not tested.
- **Size.** S.

<a id="i-21"></a>
### I-21 — A measuring tool that shows ranges

- **Why.** The plan promised "measuring with ranges shown": click two reference points, read the distance with the range that follows from the parameters' ranges. It would make the uncertainty visible exactly where a researcher is tempted to read a number.
- **Size.** M.

---

## Later phases

<a id="i-09"></a>
### I-09 — The assessment layer

- **Why.** No open-source tool with sized manikins and reach and vision analysis was found during the investigation; it has to be built. The asset already provides seat references, eye points for three body sizes, grip points, pedal faces and screen surfaces as named frames.
- **Size.** XL. See [next-steps](../90-next/next-steps.md).

<a id="i-10"></a>
### I-10 — Viewing-distance envelope

- **Why.** A first, honest demonstration of the assessment interface: the monitor arm's range turned into the range of viewing distances and angles for three eye points, each quantity reported as determined or undetermined, with no pass or fail.
- **Size.** M.

<a id="i-11"></a>
### I-11 — Simulator binding

- **Why.** The joints for joysticks and pedals already carry signal names (`joy_L.x`, `joy_L.y`, `joy_R.x`, `joy_R.y`, `pedal_1` to `pedal_3`). The browser's gamepad interface could drive them from real hardware; the two screen surfaces have their own materials and could show live pictures; the eye points give a first-person view.
- **Size.** L.

<a id="i-19"></a>
### I-19 — Output for other tools

- **Why.** An assessment tool will want every reference frame for many poses at once, and some tools want one mesh file per component. Both were planned and neither was built.
- **Size.** M.
