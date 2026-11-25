---
title: The person's commands
tldr: The person in the seat is part of the shared scene (rigtwin-scene/2): person.set, person.pose and person.clear change it with undo and the stale check, and the server measures it without a browser (eye, sight lines with a gaze cone, reach, clearances, each with unit and source); with a person shown, look's operator view uses its solved eye.
status: draft
updated: 2026-11-25
tags: [commands, agents, manikin, server, ergonomics, implementation]
---

# The person's commands

## TL;DR

- **Commands.**
  - `person.set` sets the preset (P5 woman, P50 man, P95 man: the package's own stature-percentile presets; or any preset of the package by name), sex, style (dressed or clay), skin tone, glasses and headset, and body controls by id. The cap is always worn.
  - `person.pose` sets the posture: operating, relaxed stand, or a pose of the package's library.
  - `person.clear` leaves nobody in the seat.
  - Agents use one MCP tool, `person`, that does all three.
  - Each change is one entry in the history, with the server-made author, on every page at once. It can be undone by version or by request.
- **Queries.** `person.report` (for agents, `measure {"person": ...}`) gives:
  - the eye point, both eyes;
  - sight lines to the main monitor and the touchscreen, with a gaze cone defined in `runtime-queries.toml`;
  - reach to each grip, as a share of the arm's length;
  - clearances: thighs to the grip mounts, knee crease to the seat front, hips to the armrest pods, head to the frame, feet to the pedals.

  Every number has its unit and its source.
- **No browser needed.** The server reads the person's packages: the manifests, and the skeleton from each GLB's JSON chunk. It then runs the person's own solver and the rig binding, the code the page runs. Its eye matches the eye the page draws in a still view. Only the drawn person (meshes, skin, idle motion, mesh-level contact) is the browser's.
- **Format.** `rigtwin-scene/2` adds `person` to the document. The server migrates a stored `/1` document at start: pose, version and history stay, and the default person is added.
- **Not shown:** that any of it is right. The numbers rest on the rig's photo-estimated sizes and the survey's body. The gaze cone is a reporting convention quoted from memory, not an assessment.

## The commands

| Command | Kind | Arguments | Notes |
|---|---|---|---|
| `person.set` | edit | `preset`, `sex` (female, male), `style` (dressed, clay), `tone` (light, medium, dark), `glasses`, `headset`, `body` {control id: value} | At least one field. A preset also sets the sex and resets the body to that preset. A change of sex alone gives that sex's median. Body ids are the package's: `stature` (mm), `mass` (kg), the survey's `r_*` controls (SD). With nobody in the seat, the default person is added first. `cap: false` is refused (`not_optional`). |
| `person.pose` | edit | `posture` | `operating`, `relaxed stand` (stored as the package's `RELAXED_STAND`, the idle-stand clip at 1.0 s), or a library pose by id or name (`E37`, `E37 seated_slump`) |
| `person.clear` | edit | none | Nobody in the seat. Undo brings the person back. |
| `person.report` | query | `what`: eye, sight, reach, clearance, all | Numbers for the operating posture. A note says so when another posture is shown. |
| `person` (MCP tool) | edit | the fields of `person.set`, plus `posture` and `clear` | One request with a server-made name (`person-p5-woman-12`). The reply gives before → after and the key numbers. |

Request-level `group` and `expectedVersion` work as for `pose.set`.

- **Stale check.** The person is one key (`person`). An edit based on a version after which the person changed is refused as stale. A joint change in between does not count, and a person change does not make a joint edit stale.
- **Undo.**
  - `history.undo {version}` and `{group}` put back the whole person as it was.
  - The agents' `undo` tool does the same.
  - The page undoes its own change with `history.undo` and the version or group from the reply.
  - Changes can be undone one after another, newest first: in the stale check a change and its undo cancel each other (doc.ts `inEffect`; for joints too). A later change by someone else that is still in effect keeps an older one stale.

The three percentile presets are the package's own presets with their exact values, so the page, the package and the
commands agree (the coordinator's decision of 2026-11-25): a stature percentile with the survey's build for it, the usual
ergonomic convention.

| Preset | Package preset | Body | Collision capsules |
|---|---|---|---|
| P5 woman | Small woman (stature P5) | 1525 mm, 58.3 kg | yes: the body matches the lab's baked person F05 |
| P50 man | Median man (also the default person) | 1756.2 mm, 85.5 kg | yes: matches M50 |
| P95 man | Tall man (stature P95) | 1870 mm, 96.6 kg | derived from its shape weights (`body-fit.ts`) |

The lab's tall heavy test body (`M95H`, 1869 mm, 115 kg) is a preset of the package by that name, kept for clearance worst
cases; it is not "P95 man". A body that is not one of the baked persons (P95 man, any slider body) gets collision capsules
derived from its shape weights by MV-rig's `viewer/src/person/body-fit.ts`, so every clearance is measured for every body;
the report names the capsules' source (`clearance.body_capsules`).

## The numbers, for the three presets

The rig as photographed, back on the backrest, hands on the grips, feet on pedals 1 and 3 (`person.report`, server only);
the last column is the tall heavy test body, by its name. The M95H column equals the binding's in
[Three people in Rig B](../70-results/people-in-rig-b.md); P5 woman and P50 man differ from that page's F05 and M50 by at most
2 mm of stature and 0.5 kg, and their numbers by about a millimetre.

| | P5 woman | P50 man | P95 man | M95H |
|---|---|---|---|---|
| Eye above the cushion, m | 0.700 | 0.793 | 0.835 | 0.839 |
| Main monitor: distance, m; centre below the eye, °; off the normal, ° | 0.884; −4.3 (above); 7.8 | 0.860; 1.8; 1.7 | 0.858; 4.6; 1.1 | 0.851; 4.9; 1.4 |
| Main monitor's top edge above the eye, mm | 235 | 142 | 100 | 97 |
| Monitor centre inside the gaze cone (0–30° below horizontal, ±15° sideways) | no | yes | yes | yes |
| Touchscreen: distance, m; below the eye, °; to the right, ° | 0.809; 27.4; 31.8 | 0.840; 33.6; 32.8 | 0.856; 36.3; 33.3 | 0.858; 36.5; 33.3 |
| Grips, share of the arm's length (left, right) | 0.84, 0.84 | 0.77, 0.77 | 0.74, 0.74 | 0.73, 0.74 |
| Knee crease behind (+) the seat's front edge, mm: solved body; survey estimate | −102; −24 | −8; +32 | +28; +66 | +30; +79 |
| Thigh to the left joystick base; lever, mm | 109; 165 | 41; 86 | −3; 23 | −13; 13 |
| Hips to the pods (left, right), mm; survey hip room each side, mm | 26, 28; 56 | 2, 3; 58 | −17, −16; 49 | −27, −26; 31 |
| Head to the nearest part (the headrest), mm | 22 | 35 | 37 | 43 |
| Feet short of the pedals, mm | 116 | 0 | 0 | 0 |

The whole main monitor is outside the cone for everyone: its ends are about 35° to each side. A report takes 15 to 40 ms
on the server (one solve; more under load), then comes from a cache until the person or the rig changes.

### Where each number comes from

| Group | Source |
|---|---|
| Eye | The solved pose: the rig binding, then the still the page shows. The seat-height rule is the survey sitting eye height (shape measure `eyeheightsitting`) less the cushion's compression (`seat.eye_cushion_compression`). |
| Sight | `S_mon_screen` and `S_ts_screen`, posed, and the active areas' sizes (`monitor.active_arc`, `active_height`, `radius`; `touchscreen.active_width`, `active_height`). The curved screen's side edges come toward the viewer by the arc's sagitta. The cone is `[queries.sight]` in `runtime-queries.toml`. |
| Reach | Shoulder from the solved pose; the grips `D_grip_axis_L/R`; arm length = upper arm, forearm and hand to the grip point. |
| Thighs, hips | The body's collision capsules (a baked person's fit, or derived from the shape weights) against the parts (`C_joy_base_*`, `C_joy_lever_*`, `C_pod_shell_*`), posed. This is an upper bound on any overlap. The survey cross-check is half of (the pod gap less `hipbreadthsitting`). |
| Knee | `D_seat_front` and `D_backrest_ref`; the crease from the solved knee less the thigh's radius; the survey estimate is 0.81 × `buttockkneelength`. |
| Head | A sphere about the person's head centre (`anchors.head_centre`), radius 0.5 × `headlength` (`[queries.head]`), against the boxes of the headrest, the monitor, its stand and the touchscreen. The cap, its brim, the glasses and the headset are not counted. |
| Feet | The solved legs' reach to the heel rest and the pedal faces. |

## What needs a browser

Nothing that is a number. The server reads each package's manifest (shape model, joint deltas, survey measures, baked persons' fits, hand poses) and the skeleton nodes in its GLB. It never reads the meshes, textures or shape files.

It builds the rest skeleton for the body exactly as `avatar.ts applyShape` does: 5 µm from the lab's fixtures. It runs `viewer/src/person/operator.ts` and `rig-binding.ts` in Bun, then the still at the runtime `still_time` that a still view shows.

- **Agreement with the page.** `tools/live-accept.ts` step 10 compares the server's eye with `viewer.person.anchor("eye_midpoint")` in a still view, for the three presets, with a 3 mm limit. Measured: 0.1 mm or less for all three (2026-11-25, after MV-core's fix of the binding after a body change; before it, 31 and 37 mm). The camera of look's operator view sits within 0.01 mm of the server's eye point.
- **Live views.** The page's idle motion moves the drawn eye by a few millimetres.
- **Other postures.** Postures other than operating are dof poses and clips that only the browser applies. The server reports the operating posture and says so.

The server bundle (`tools/dist.ts`) may take these files besides `server/` and `shared/`:
- `viewer/src/person/operator.ts`, `rig-binding.ts` and `params.ts`;
- the run-time records `assets/manikin/params/runtime*.toml`.

All are plain TypeScript and TOML, with no three.js at run time. The release carries the packages under `asset/manikin/`.

## look's eye

- **Operator view with a person.** With a person in the seat in the operating posture, `look {"view": "operator"}` sends the person's solved eye with the view as `eye_point`, in the model frame.
- **A stature with a person.** `look {"eye": {"stature_cm": X}}` uses the shown person's body at that stature, its eye solved the same way. The reply says "not a ratio".
- **Follows the seat.** The page keeps the eye point in the frame of `D_eye_median` (`viewer/src/engine.ts`, `S.eyeLocal`), so it rides with the seat as the rig's eye points do. It does not follow the backrest recline, as before.
- **The fallback.** With nobody in the seat, or a person who is standing, the operator's view uses the rig's median eye point and a stature uses the assumed ratio `seat.eye_height_per_stature` (0.455), as before. `eye {person: small|median|large}` still means the rig's three eye points.

## The scene format

`rigtwin-scene/2` adds `person` to the document: `null`, or a `PersonState` with these fields:
- `style`, `sex`, `tone`, `glasses`, `headset`, `preset`;
- `body`: stature and mass always, any other control only when it is not at its default of 0 SD;
- `posture`: `operating`, or the library pose's name.

An entry that changes the person carries `person: {before, after}`.

`parseDoc` reads a `/1` document and returns it as `/2`. The pose, the version and the history stay as they were. The person is the server's default (the dressed P50 man, the package's "Median man" exactly, when the release carries the packages, otherwise nobody), and no entry is recorded for it. The server writes the migrated document back at once.

- **Tests.** `shared/commands/person.test.ts` migrates a copy of a `/1` document with history. `server/server.test.ts` starts a server on a stored one, undoes an old request and restarts it.
- **The page** applies `doc.person` and `entry.person` through `viewer.person` (`viewer/src/live.ts`) and accepts `/1` and `/2` servers.
- **version.json** says `server.format: "rigtwin-scene/2"`.

## Files

| File | What |
|---|---|
| `shared/commands/person.ts` | the commands, the intent tool, the solve cache, `personEye` for look |
| `shared/commands/person-words.ts` | presets, postures, the person in words (no imports) |
| `shared/person-model.ts` | packages, bodies, the seated solve, the ergonomic numbers |
| `shared/commands/doc.ts` | `rigtwin-scene/2`, `PersonState`, the person in the stale check, undo and the migration |
| `assets/manikin/params/runtime-queries.toml` | the gaze cone, the head sphere, the cache size |
| `server/server.ts` | `loadPeople` (once per folder), the default person, the migration at start |
| `viewer/src/live.ts`, `viewer/src/engine.ts` | the person on the page, `viewer.command`, the eye point of the operator's view |
