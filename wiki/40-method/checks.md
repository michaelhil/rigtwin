---
title: Checks
tldr: Every automatic check of the asset and the platform (bun run check, 28 checks, 8 of them added by platform step 1 for the commands, the server, the live page and the deploy), of the distribution build (2) and of the viewer page (53), with what each verifies, the real failure it exists to catch, and its current result; plus the host's load test, what is not checked and how to add a check.
status: living
updated: 2026-11-24
tags: [checks, quality, method, viewer]
---

# Checks

## TL;DR

- `bun run check` runs 28 checks and exits non-zero if one fails: the 20 checks of the asset (about 4 s) and 8 added by [platform step 1](../30-plan/platform-plan.md) for the command layer, the server, the live page and the deploy (C-75 to C-82). The full run now takes about 105 s, most of it the deploy tests. On 2026-11-24 all pass, with one standing warning (11 parameters read by nothing).
- The checks read the built GLB through an **independent reader** written in Python that shares no code with the generator. A writer checked only by its own reader hides its own mistakes.
- Each check exists because of a real failure or a named risk. The coverage check exists because an early trial silently lacked the whole left armrest pod and joystick.
- `bun tools/ui-accept.ts` drives the viewer page like a person (real pointer, wheel and key events) through 53 checks in about 2 min. All pass. Since step 1 the load check (T10) counts every script of the default page against 800 kB in all ([D-43](../20-decisions/decision-log.md#d-43)).
- `bun tools/live-accept.ts` drives the shared scene in two real browsers and the command line (14 steps, about 12 s; also part of the full check as C-82). The host's load test `tools/deploy-tests/stream-load.ts` is run by hand on the production host (host check H14).
- **Not checked by any script:** parts cutting into each other, parts that tear when moved, agreement with the photos, and whether sizes are true. An independent reviewer and a tape cover those.

Ids `C-01 …` are stable; refer to them from other pages. Commands and options are in the
[tool reference](../80-reference/tools.md). Terms are in the [glossary](../00-overview/glossary.md).

<!-- UPDATE after the final modelling round: the "Result" columns and the counts quoted in them -->
Results of C-01 to C-74 below are **as of round 2** (build `c32727406a5c…`, run on 2026-11-23 on one Apple M2
machine), except T10 (C-31), which is as of 2026-11-24. The platform's checks (C-75 to C-83) and the totals are
**as of 2026-11-24**, on the branch `platform-step1-main` (build `0b6d8248…`, same machine).

## How a check run behaves

- It always does a **full** build first (never `--only`), into the default build folder or, with
  `--workspace <name>`, into that workspace.
- A failure in the type check or tests is reported and the run continues; a failure while loading
  parameters or building stops the run, because nothing after it would mean anything.
- `ok`, `warn` and `FAIL` lines; only `FAIL` changes the exit code. When everything passes, 18
  lines are printed: C-19 and C-20 print only when they fail.
- `--fast` skips the checks that need the headless browser or a built `dist/`: C-17 to C-20 and C-80 to C-82.
  The fast set still runs the setup script's harness (C-79, about 9 s).
- The deploy tests (C-80, C-81) need `dist/`; without it the run prints a warning "skipped: no dist/" instead.
- The last line is appended to the timeline file with the duration.

## Checks of the asset (`bun run check`)

| Id | Name as printed | Verifies, and how | The failure it exists to catch | Result |
|---|---|---|---|---|
| C-01 | types | `tsc --noEmit` over generator, shared code, viewer, tools and asset sources | Generator and viewer must agree on the manifest's shape and the pose code. Added when the viewer became TypeScript so both import the same types. No recorded incident | ok |
| C-02 | kit tests | `bun test generator`: 5 known-answer tests. Closed primitives face outward and have their analytic volume; the cage accepts a mirrored, bevelled, concave case and rejects inconsistent winding; guards refuse NaN and degenerate input; screen sheets have u = 0 at the operator's left and v = 0 at the top; expressions and the pose function give known results | The kit is hand-written (no solid-modelling kernel). A primitive that is inside-out or the wrong size would spoil every component built from it | ok, 5 pass |
| C-03 | parameters | Every record has value, unit, class, tier, evidence; valid unit, class, tier, range. Reports counts per class. Warns about records read by nothing and about loader warnings | Values that look measured but carry no source. In the first trial six dimensions were typed into code with no record at all | ok, 303 complete records; warn: 11 read by nothing |
| C-04 | build | The spec loads (one root, names, parents before children, joints defined and used once, every joint in the motion table); every expression resolves; every component function returns valid meshes (finite, non-empty, unit normals, no zero-area triangles, none wound against its normals, not collapsed); only palette materials; surfaces have texture coordinates | Recorded in the timeline: 21 failed builds, two of them deliberate tests. Five were triangles wound against their normals (invisible from outside), ten unknown or renamed parameter keys, three TOML syntax errors, two spec ordering errors, one zero-height cylinder. Each stopped in about 0.2 s or less with the component id and the reason | ok, 0.18 s |
| C-05 | determinism | A second build in a separate process gives the same GLB SHA-256 and a byte-identical manifest | The SHA is how a render, a review and a deployed copy are tied to one build (the reviewer quotes it; the viewer uses it to notice a rebuild). The library exporter of the trial did not give stable bytes | ok |
| C-06 | independent reader | `tools/glb_inspect.py` (Python standard library only) parses the GLB and reports nodes, meshes and triangles | A file that only its own writer can read. The trial's exporter wrote invalid geometry without an error | ok: 89 nodes, 48 meshes, 28,042 triangles |
| C-07 | names | Every node name matches the pattern, is unique, and equals `extras.id` | Names are the identifiers everything else binds to. The first pattern in the brief rejected the brief's own names (`C_pod_button_L_1`); it was relaxed and is now tested | ok, 89 names |
| C-08 | coverage | Every node of the spec is in the GLB under the right parent; every non-assembly component has a mesh **or** is in `omitted` with a non-empty reason, never both; every joint of the spec is a joint node; nothing is in the GLB that the spec does not list | **An early trial lacked the whole left armrest pod and joystick.** Cause: its brief named only the right pod, no figure listed omissions, nothing compared the model with the tree. The owner noticed, not the agents | ok: 69 tree nodes, 20 joints, 48 with geometry, 0 omitted |
| C-09 | left/right | Every id with `_L` or `_R` has its counterpart unless listed as `single`; both of a pair have geometry; origins are mirror images about Y = 0 and mesh bounds mirror within 2 mm unless listed as `free` | The same incident, and its cousin: a "mirrored" part whose frame was mirrored but whose mesh was not | ok: 15 pairs, 3 single-sided |
| C-10 | geometry | From the independent reader: no non-finite values, no zero-area triangles, unit normals, indices in range, no empty mesh, surfaces have texture coordinates; manifest and GLB agree on triangles, bytes and primitives; the root rotation is exactly the Z-up to Y-up conversion | A second opinion on C-04 from different code. In round 1 it reported zero-area triangles in two groups while the third group's modeller was finishing | ok, 48 meshes |
| C-11 | glTF validator | The Khronos validator on the GLB bytes: 0 errors and 0 warnings required | It caught an invalid file in the trial that every viewer had displayed without complaint | ok: 0 errors, 0 warnings, 0 infos, 0 hints |
| C-12 | expected motion | The independent reader poses every joint to a limit and lists the nodes whose world transform changed; the set must equal the spec's `[motion]` entry exactly; every entry must match at least one node | A node hung on the wrong frame moves with the wrong joint (the eye points must follow the seat's slide but not its recline). It checks *which* nodes move, **not** that meshes stay joined: see "Not checked" | ok, 20 joints |
| C-13 | pose conformance | 96 test poses (each joint at lower, upper, neutral, 37 % and 81 %; ball joints at three values): the 3 × 4 matrices from `shared/pose.ts` and from the Python reader agree within 2e-6 | The trials had three slightly different joint conventions in three codebases | ok, largest difference 2.4e-8 |
| C-14 | budget | Triangles ≤ 150,000; GLB ≤ 4 MB; draw primitives ≤ 80. Names the three heaviest components | The owner asked for good viewing and modelling performance. Without a cap, detail creeps in where it buys nothing (the reviewer found 880-triangle hub covers hidden behind another part) | ok: 28,042 triangles, 67 primitives, 0.72 MB; heaviest `C_seat_pan` 2,606 |
| C-15 | banned words | Scans every file name and every file under 30 MB (text and binary) outside `private/`, `work/`, `node_modules/`, `.git`, `.venv`, `.claude` for the rig maker's and a customer's name in any capitalisation; device makers' names are allowed only in parameter files and the manifest. The words are stored encoded so the check does not contain them; more can be listed in a private file | The owner's instruction that these names never appear in the repository, including image pixels and file names | ok, 72 files scanned at the time; the wiki adds to that number |
| C-16 | numbers in source | Lists decimal literals and integers of three or more digits in `assets/*/src/*.ts` (comments and strings ignored; 0.5 allowed). Advisory: a warning | The six literals of the first trial. A dimension in code has no class, no range and cannot be overridden by a measurement | ok, none found |
| C-17 | projection self-test | Marker spheres at eight known model points are rendered through two synthetic cameras and every solved photo camera; their pixel centroids must match plain pinhole arithmetic within 1 px | Photo-matched views are how likeness is judged. A sign or axis slip in the camera path would shift every overlay plausibly. In the investigation an overlay "to 1.8 px" had been solved on the wrong features and hid a 7 cm error | ok: 45 points over 7 cameras, worst 0.216 px |
| C-18 | frame rate | Frames per second over 90 forced frames of the default view at 1600 × 1000 in headless Chromium; warns below 55 | The owner's performance requirement | ok, 60 fps (capped by the display rate) |
| C-19 | draw calls | Fails if a still default view needs more than 82 draw calls. Printed only on failure | A viewer that redraws shadows every frame doubles its draw calls; the shadow map is now redrawn only when something moves | passes silently: 68 calls for 67 primitives plus the ground |
| C-20 | viewer console | Any error or warning in the page console during C-17 to C-19 fails the run. Printed only on failure | A page that renders but logs errors | passes silently |

### Checks added by platform step 1

Step 1 ([platform plan](../30-plan/platform-plan.md)) added the command layer, the server, the viewer as a
live client and the deployed service. Their checks run in the same `bun run check`; results of 2026-11-24.

| Id | Name as printed | Verifies, and how | The failure it exists to catch | Result |
|---|---|---|---|---|
| C-75 | commands | `bun test shared/commands`: argument checking and the shape of errors; `pose.set` units for all 20 joints; limits, including a three-angle mount; assumed adjustments refused unless asked for; the stale check per joint; undo by version and by request ([D-40](../20-decisions/decision-log.md#d-40)); the history cap of 200; a rebuilt asset; `scene.find` ranking; `measure.distance` against an independent 4 × 4 matrix computation from the model file | A command that moves the wrong joint, takes degrees for metres, or lets an old edit overwrite a newer one | ok, 26 pass |
| C-76 | server | `bun test server`: two live clients over real HTTP (a change on one appears on the other; stale refusal with the reason; undo by request; resume after a dropped stream; a server process killed and restarted with both clients catching up); view commands only to the addressed browser; the deployed guards (body size, streams per visitor, per network block and in all, edit rate, nearly full disk) and none locally; author ids made by the server ([D-41](../20-decisions/decision-log.md#d-41)); the Host check; the release watch; and since the host's load test, the byte budget of a live stream: a stream ends after its budget, the page comes back with `since=` and gets only what it missed, and the ended stream's place still counts until its connection is gone ([D-46](../20-decisions/decision-log.md#d-46)) | Two browsers that disagree; a server restart that loses changes; one visitor filling the server; a stranger's stalled streams filling the host's network memory | ok, 19 pass |
| C-77 | live client | `bun test viewer/src`: the page's reconnect rules with a stand-in EventSource and clock, after Leitbild's reconnect cases: backoff 1, 2, 4 … 30 s; one resync after a reconnect; a visible page or the network coming back tries at once; nothing reconnects after `disconnect()`; and one case of our own: the server's `end` event (a stream's byte budget) reconnects at once | The part of a live system that takes longest to get right (Leitbild's reconnect took eight months) | ok, 6 pass |
| C-78 | server options | `server/server.ts` passes `development: false` to `Bun.serve` | Error pages that show the server's code to visitors | ok |
| C-79 | setup script | `bash tools/deploy-tests/setup-server.test.sh`: the real `deploy/setup-server.sh` against a stand-in host folder (check, apply, a second apply that changes nothing, undo, probe; failed validation, failed reload, another site answering differently, a checksum mismatch, three machine types; a hang-up, a closed output and a broken pipe right after the Caddy reload each put the old site file back) | A setup that breaks the host's other sites or leaves Caddy half-changed. The harness itself had a bug found on 2026-11-24: it took the site file "live before the setup" from the last commit (`git show HEAD:…`), so after any commit containing the new Caddy file 22 of its cases failed, which would have stopped the first automatic deploy. It now reads the fixture `tools/deploy-tests/fixtures/mightwork-apex.before-setup.caddy` (the file live today, SHA-256 `60efbcdb…`). A second harness bug stopped the first automatic deploy of step 1: it used `stat -f` and `sed -i ''`, which exist only on macOS, so 11 cases failed on the Ubuntu runner; it now uses forms that work with both, and prints the end of a failed run's output below the failure | ok, 74 passed, 0 failed |
| C-80 | deploy checks | `bun tools/deploy-tests/deploy-checks.ts`: the live-site checks of `tools/deploy.ts` against local stand-ins of the site built from `dist/`: a release without a server; the route probe before the switch; an old revision, then the new one; a 502 for 20 s; a wrong revision; `server/server.js` served | A deploy that switches to a release whose server never comes up, or that publishes the server's code | ok, 16 passed, 0 failed |
| C-81 | deploy rollback | `bash tools/deploy-tests/rollback.test.sh`: `bun run deploy --rollback` with a stand-in `ssh` on a local folder: refused to go back to a release without a server once the live one has one; the server checks after a rollback; the dry run | A rollback that silently drops the server or exposes its code | ok, 17 passed, 0 failed |
| C-82 | live viewer | `bun tools/live-accept.ts`: two headless browsers and the real command line on one local server with an empty temporary scene (steps listed in the [tool reference](../80-reference/tools.md#the-shared-scene-commands-and-tests)) | Everything above working in a real page: a slider move, a command, Undo on the activity line, a stale refusal, a link preview, view routing, a forged author id, a server restart, the network coming back, and the page without a server | ok, 14 of 14 steps |

Two older checks changed with step 1: `bun run render` and `ui-accept` start the server with an **empty
temporary scene**, so no pose of the shared Playground can reach a published picture, and `ui-accept` empties it
again before every page.

## Check of the distribution build (`bun run dist`)

| Id | Verifies, and how | The failure it exists to catch | Result |
|---|---|---|---|
| C-21 | Refuses a partial build or one with missing components. Then serves `dist/` under the sub-path `/rigtwin/` and loads it once in headless Chromium: no request outside the sub-path, no request mentioning `private` or `work/`, no console error, more than zero triangles drawn | The viewer is deployed under a sub-path, so one absolute URL breaks it. The local server also serves private photo cameras; a deployed copy must never ask for them | ok: 5 files, 1.68 MB; 5 requests; 28,106 triangles drawn (the model's 28,042 plus the 64 of the ground disc) (round 2) |
| C-83 | Since step 1: bundles `server/server.ts` into `dist/server/server.js` and refuses a bundle that takes code from anywhere but `server/` and `shared/` or imports anything Bun does not provide itself. The verify step then starts the built server (local mode, free port, empty temporary data folder) and answers `/rigtwin/api/*` from it as Caddy does: `api/health` must report the release's revision and scene format, `api/live` must deliver a `snapshot` within 5 s, and `server/server.js`, `server/` and `server` must answer 404 | The viewer asks `api/health` on a release with a server, so a verify without one would fail on its own request; viewer code or an npm package slipping into the server; the server's code being served | ok (2026-11-24): server bundle 65,471 bytes from 10 modules; health and live channel answered through `/rigtwin/api/`; `server/` refused; 155 requests answered, 0 failed |

## Checks of the viewer page (`bun tools/ui-accept.ts`)

The script opens a fresh page per test at 1440 × 900 (some also at 1024 × 768 and 390 × 800) and
acts through the browser's own input events. It reads joint limits from the manifest, so it does
not break when the model is rebuilt. Each check came from one of the two interface reviews; "before"
is what the reviews measured on the first viewer. All 53 pass (113.9 s in round 2; 115.6 s on 2026-11-24 with the
live client, which the page loads but which stays quiet until something changes).

Moving the platform onto `main` without the manikin changed **no** check of this script: the manikin's commit
never touched `tools/ui-accept.ts`, and only the comment explaining T10's budget was reworded.

| Id | Script id | Verifies | Before the redesign | Result |
|---|---|---|---|---|
| C-22 | T01 | Controls visible on the default page ≤ 20 | 103 | 16 |
| C-23 | T02 | Words on screen by default ≤ 60 | 396 | 41 |
| C-24 | T03 | No jargon on the default page (node ids, "triangles", "revolute", "locked", "datum" and 20 more patterns) | — | 0 |
| C-25 | T04 | No slider, disabled control or padlock on the default page | 24 sliders, 6 dead | 0 / 0 / 0 |
| C-26 | T05 | Share of the window given to the 3D view: ≥ 80 % at 1440, ≥ 70 % at 1024, ≥ 55 % and ≥ 360 px wide at 390 | 58 % / 41 % / 0 % | 82.8 % / 78.1 % / 100 % |
| C-27 | T06 | Parts list: ≤ 8 rows, no scrolling | — | 6 rows |
| C-28 | T07 | A hint line names rotate and zoom, disappears after the first drag, and is absent with `ui=0` | none | pass |
| C-29 | T08 | No pointer target smaller than 24 × 24 px | 65 | 0 |
| C-30 | T09 | The cursor over the 3D view is not the default arrow | — | grab |
| C-31 | T10 | Page ready ≤ 1 s; every script the default page loads ≤ 800 kB in all (was `viewer.js` ≤ 760 kB until step 1; [D-43](../20-decisions/decision-log.md#d-43)) | 687 kB script | 2026-11-24: 210 ms; 1.70 MB in 9 requests; 1 script, 733 kB |
| C-32 | T11 | No row label is cut off | — | 0 |
| C-33 | T12 | Hide the monitor: click it, "Hide" (≤ 2 actions), and bring it back (≤ 3); no monitor pixel left | 4 actions with a trap | 2 and 3 |
| C-34 | T12b | Hide the touchscreen the same way | — | 2 actions |
| C-35 | T13 | Hide a whole group with one click on its eye | — | 1 click, 8 items |
| C-36 | T14 | "Show all" is on screen whenever something is hidden | — | pass |
| C-37 | T14b | With everything hidden, a message and "Show all" remain | — | pass |
| C-38 | T15 | A click on a screen picks the monitor or touchscreen, never its picture surface | — | pass |
| C-39 | T16 | Show only the seat: click it, "Show only this" (2 actions), all seat parts and nothing else | 4–6 actions, one mesh left | 2 actions, 9 of 9 |
| C-40 | T17 | Esc and a click on empty space clear the selection; a second click on the part does not | — | pass |
| C-41 | T18 | Keys H (hide), I (show only), A (show all), F (frame) | — | pass |
| C-42 | T19 | Double-click a part zooms to it (target within 0.1 m of its centre) | not available | 0.005 m |
| C-43 | T20 | The active view button stays readable under the pointer | — | pass |
| C-44 | T22 | Three drags of 300 px turn the view fully; the wheel alone zooms to the right joystick in ≤ 15 notches without panning | 35–40 notches plus a hidden right-drag | 360°; 6 notches |
| C-45 | T23 | Operator's-eye view: reachable; a drag looks around in place (eye moves < 2 cm) | eye moved 26 cm | 2 clicks; 0.3 cm |
| C-46 | T24 | The monitor's card holds only the monitor's adjustments: one slider and one two-way pad, no jargon | 24 sliders in one global list | 1 slider + 1 pad |
| C-47 | T25 | Lower and tilt the monitor in ≤ 3 actions, right direction first time | 7 actions | 3 actions |
| C-48 | T26 | "As photographed" returns an adjustment in one click | hidden double-click per slider | pass |
| C-49 | T27 | One "Reset all" returns view, hidden parts, colours, selection and adjustments to a fresh load | 10 actions, inexact | pass (the message says "differs: camera" for a difference below 1e-6 m; cosmetic) |
| C-50 | T28 | Armrest pad back, and right joystick forward, in ≤ 2 actions each | 4 actions | 2 and 2 |
| C-51 | T29 | "How sure are we?": plain legend with a count of parts per class, ≤ 2 actions | — | 2 clicks |
| C-52 | T30 | "Copy link" reproduces the view: same hidden set and selection, camera within 1 cm and 1°, adjustments within 1e-3 | impossible | 0.06 cm, 0.01° |
| C-53 | T30b | "Save picture" gives the 3D view without panels, with a band carrying the assumed-range sentence when it applies | — | 1192 × 934 px |
| C-54 | T31 | Slide the seat back 5 cm and recline it to 20° in ≤ 3 actions, within 0.5 cm and 1° | impossible (locked) | 3 actions |
| C-55 | T32 | No disabled control and no padlock in any card (every row, unit and part selected in turn); ≤ 9 sliders in a card | 6 dead sliders | 0; at most 5 |
| C-56 | T33 | The seat's card: five working sliders, each tagged "assumed range", with the caution sentence | — | pass |
| C-57 | T34 | While an assumed adjustment is in use, an amber notice stays on the picture whatever is selected | — | pass |
| C-58 | T34-1024 | The same notice is visible over the 3D view at 1024 × 768 | — | pass |
| C-59 | T34-390 | … and at 390 × 800 | — | pass |
| C-60 | T35 | "Back to as photographed" on the notice resets the assumed adjustments only | — | pass |
| C-61 | T36 | The seat's sliders stop exactly at the manifest's limits | — | −0.1 … 0.1 m; 0 … 0.610865 rad |
| C-62 | T37 | For scripts nothing changed: `setJoint` on a locked joint throws without `force`; `pose=` moves it and shows the notice; six joints remain locked and assumed in the manifest; `state().assumed_in_use` names them | — | pass |
| C-63 | T38 | Drag the selected monitor in the picture: height changes, tilt and turn do not, the camera does not move, limits hold | not available | pass |
| C-64 | T39 | Drag the selected seat cushion (slide) and then its headrest (recline); camera still | not available | pass |
| C-65 | T40 | Drag a joystick grip: it deflects in the pointer's direction and stops at ±20° | not available | pass |
| C-66 | T41 | Drag the selected armrest pad; stops at its limit | not available | pass |
| C-67 | T42 | Dragging an unselected part or empty space still rotates the view and changes no adjustment | — | pass |
| C-68 | T44 | An idle page draws nothing (0 frames in 2 s; main thread < 2 % busy) | 120 frames, 7–8 % busy | 0 frames, 0.11 % |
| C-69 | T45 | Pointing at parts does not redraw shadows | draw calls doubled on every hover change | 68 at rest, 68 pointing, 133 when a part moves |
| C-70 | T46 | ≥ 55 fps while something changes every frame at 1440 × 900 | — | 61 fps still; 61 fps with outline, moving joint and shadows |
| C-71 | T49 | The machine interface gives the same pictures and state as the previous viewer for 14 parameter sets (needs `--baseline <url>`) | — | **skipped**: no baseline given; a skip is reported as a pass |
| C-72 | T50 | No page error or warning during the whole run | — | 0 |
| C-73 | T52 | Phone-width window: model first, parts list as a drawer, card as a bottom sheet ≤ 47 % of the height, no sideways overflow | the 3D view had 0 % of the window | pass |
| C-74 | T53 | Exposure: lit white not clipped (95th percentile ≤ 235 of 255), shaded white at least 35 lower, blacks between 22 and 110 and apart from each other | whites at 244–249, form lost | lit white 223–231, shaded 164, 0 % clipped |

The script's own ids (T01 …) have gaps because some review items were merged or dropped. The
implementer reported C-71 as passing against the previous viewer when it was last run with a
baseline (*not re-run for this page*).

## The host's load test (host check H14)

`tools/deploy-tests/stream-load.ts` is not part of `bun run check` (it takes a minute); it is run by hand before a
release that changes the server, on the production host against a throwaway server from the release's bundle
(`deploy/HOST-CHECKS.md`). It runs the built server in deployed mode, asks for 300 live streams that never read (6 per
visitor, one visitor per network block) and sends 50 full-pose edits a second from 50 other visitors. Every 5 s it
prints the server's memory and CPU, how fast `api/health` answers, and on Linux the kernel's TCP memory against its
pressure threshold. At the end it reads every stream out.

It **passes** when the server's resident memory stays at or below 150 MB, `api/health` answers 200 within a second
every time, every stream the server took was ended by the server (by its byte budget or as too slow), no stream got
more than the budget (512 kB) plus one event, and the TCP memory stays below the pressure threshold.

On 2026-11-24 the first run on the host failed: TCP memory reached 59,172 pages against a threshold of 58,837,
because Linux absorbed about 770 kB per stalled stream and the server's 1 MB queue limit never triggered. With the
byte budget and the lower stream limits ([D-46](../20-decisions/decision-log.md#d-46)) the second run passed: 150 of
150 streams ended by the server, largest 527,904 bytes, server peak 66 MB, health 0–1 ms, TCP memory peak 28,698 pages
(49 % of the threshold). Detail: [the server and its host setup](../50-implementation/server-and-host-setup.md#host-check-h14-live-streams-that-do-not-read).

## Not checked by any script

Knowing the holes matters as much as knowing the checks.

| Not checked | How it showed | What covers it today |
|---|---|---|
| Parts cutting into each other at rest (interpenetration), parts floating | soundbar sunk 8 mm into the shelf; armrest pads inside the back shell (review round 1) | the reviewer's own intersection tests (38 pairs); a modeller's one-off interference script |
| Meshes that tear or collide when a joint moves | joystick boot tore; monitor slid off its arm; pedals passed through a cross bar. All checks passed at the time | the reviewer posed every joint to its limits and looked |
| The right *kind* of shape | seat cushion as a faceted trough | the reviewer |
| Agreement with the photos, as numbers | no held-out landmark table exists | outline overlays through the solved cameras, judged by eye |
| Sizes being true | photos cannot verify depth along the rear view ([Measuring from photos](measuring-from-photos.md)) | nothing: a tape |
| A `photo` value changed without a new measurement | — | the evidence text, read by a person |
| `evidence: assumed` implies `locked: true` | true in the data | C-62 counts six such joints; the spec loader does not enforce it |
| Pivots inside the geometry of their hub | — | the reviewer |

The plan called for the first two as scripted checks (solid and collision tests in Python). They
were not built in this run and are the most valuable next addition.

## How to add a check

To `bun run check` (`tools/check.ts`):

1. Decide what real failure it catches. If you cannot name one, do not add it.
2. Add a block that ends in `report(ok, "name", "one-line summary", details)`. `ok` is `true`,
   `false` or `"warn"`; `details` are lines naming the node and what to do about it.
3. Read the model through the independent reader's output (`glb.nodes`, `glb.joints`: names,
   parents, extras, origins, mesh statistics, bounds in the model frame) or the manifest, not
   through generator internals.
4. Keep the whole run near 4 s. Anything that needs the browser goes in the last block, which
   `--fast` skips.
5. **Prove it can fail.** Break the model on purpose once and see the check go red with a useful
   message (the infrastructure agent did this with a zero-height cylinder and a misspelt key).
6. Add a row here with the next free id (`C-84`), and say what it exists to catch.

To the viewer acceptance script (`tools/ui-accept.ts`): add
`await test("T54", "name", async () => { const s = await open(1440, 900); … record("T54", "name", pass, value, limit); await close(s); })`.
Use the `Session` helpers (`find(id)` gives a pixel on a visible part, `click`, `drag`, `wheel`,
`key`, `slide`), read limits with `defs(s)`, and never hard-code a number of the model.
