---
title: Tool reference
tldr: Every command of the project (build, check, render, serve, rig, dist, wiki, deploy; the acceptance, live and deploy tests; the setup script; the independent model reader) with its options, outputs and typical run time, plus the shared scene's commands, the viewer's URL and script interface, the workspaces and where every output goes.
status: living
updated: 2026-11-24
tags: [reference, tools, commands, viewer, agents]
---

# Tool reference

## TL;DR

- `bun install` once; then `bun run build` (0.2 s), `bun run check` (4.2 s, 20 checks), `bun run render --set sheet` (1.4 s plus 0.4 s browser start). Typical times are medians from the project's timeline, one Apple M2, 2026-11-23.
- Renders come from the real viewer page driven by a headless Chromium; anything with photo pixels is written under `private/`, never `work/` or `wiki/`.
- Agents drive the viewer by **URL parameters** (`view`, `only`, `hide`, `fit`, `pose`, `mode`, `cam`, …) or by `window.viewer.apply({...})` with the same keys.
- Parallel agents set `RIGTWIN_WORKSPACE` (own build and render folders) and `RIGTWIN_AGENT` (their name in the timeline). `RIGTWIN_VIEWER_DIR` points the tools at a copy of the viewer.
- `bun run deploy` checks, builds, packages and publishes, and switches back if the live pages fail; see [deployment](../50-implementation/deployment.md).
- Since [platform step 1](../30-plan/platform-plan.md), **`bun run rig <command> '<json>'`** changes, shows, measures and undoes things in the shared scene that every open viewer follows live, on the laptop (`bun run serve`) or on the public sandbox (`--server https://mightwork.ai/rigtwin`). Its commands are listed [below](#the-shared-scene-commands-and-tests).

Every tool appends one line per run to the timeline file (`work/timeline.jsonl`, not committed):
`{"ts", "agent", "event", "seconds", "note"}`. The "Typical time" column below is the median and range
of those lines up to 20:53 UTC on 2026-11-23 (613 lines) (one machine, one run of the project; treat as
indications). What the checks verify is on the [checks](../40-method/checks.md) page; how the tools
fit together is in [the pipeline](../40-method/pipeline.md).

## Before the first command

| Need | Detail |
|---|---|
| Bun | the only runtime for TypeScript (version 1.4.0 on the build machine); `bun install` is the only install step and installs exact versions (`bunfig.toml`: `exact = true`) |
| Chromium | for every command that renders or tests the page. Found in the Playwright browser cache (`~/Library/Caches/ms-playwright/chromium_headless_shell-*` or `chromium-*`); no Playwright package is installed. Override with `RIGTWIN_CHROME=<path to a Chromium binary>` |
| Python 3 | standard library only, for the independent model reader |
| Photos and cameras | under `private/` (not committed). Without them `render --set matched` renders nothing and says so; everything else works |

## Commands

| Command | What it does | Options | Inputs → outputs | Typical time |
|---|---|---|---|---|
| `bun run build` | parameters + spec + component code → model file and description file | `--only <group>[,<group>]` builds only those groups' meshes (the frame tree stays complete); `--workspace <name>`; `--asset <id>` (default `rig-b`); `--out <dir>`; `--quiet`; `--no-timeline` | `assets/rig-b/params/*.toml`, `spec/rig.toml`, `src/*.ts` → `assets/rig-b/build/rig-b.glb` and `rig-b.manifest.json` | full 0.19 s (0.12–0.32 and one of 0.79; 42 runs); `--only` 0.12 s (0.09–0.38, 62 runs); a failing build stops in 0.03–0.21 s naming the component and the reason |
| `bun run check` | full build, then every check; exit code 1 if one fails | `--fast` skips the checks that need the browser; `--workspace <name>` | build → printed `ok` / `warn` / `FAIL` lines | 4.2 s (3.8–4.8, 24 runs); `--fast` 2.1 s (1.8–2.7, 4 runs) |
| `bun run render` | drives the viewer page headless and writes images | `--set <set>[,<set>]` (below; default `sheet`); `--only <group or id>[,…]`; `--fit <group or id>[,…]`; `--cam <photo>[,…]`; `--pose J_x:val,…`; `--mode ids\|class`; `--out <dir>`; `--workspace <name>`; `--viewer <dir>`; `--photos <dir>` (use masked photos) | current build → PNG or JPEG files (see "Where outputs go") | per set, below; browser start 0.38 s (0.26–2.47, 144 runs) |
| `bun run serve` | local web server laid out like the deployed folder, with the rigtwin server (local mode) on the same port under `/api/` | `--port <n>` (default 4173); `--workspace <name>`; `--viewer <dir>`; `--data <dir>` (where the shared scene is kept; default `../rigtwin-projects/` next to the repository, the scene in `playground/doc.json`); `--no-api` (static files only, as before step 1) | → `http://127.0.0.1:4173/`: `/` viewer (bundled in memory, rebuilt when a file changes), `/asset/` build, `/wiki/` built wiki, `/version.json` (with a `server` entry when the API is on), `/api/` the server; local only: `/private/`, `/work/`. Every path answers only to the Host names 127.0.0.1, localhost, [::1] or *.localhost (403 otherwise), so a web page elsewhere cannot reach the local files by DNS rebinding | starts at once; bundling about 0.1 s |
| `bun run rig` | runs one command on a rigtwin server and prints one JSON reply that names the server it came from | `list` (the server's own catalogue, with arguments and examples); `--server <url>` (default `$RIG_URL` or `http://127.0.0.1:4173`); `--viewer <code>` (the browser a view command is for: its code is in the viewer's More menu); `--group <id>` (names the request a change belongs to, so `history.undo {"group": …}` undoes it whole); `--expected-version <n>` (the scene version the change is based on: refused as stale if a joint it names changed after it) | `bun run rig pose.set '{"joints": {"J_mon_height": -0.03}}' --group lower-monitor` → `{"server": "http://127.0.0.1:4173 (local, revision …)", "ok": true, "version": 1, "you": {…}, "recorded": 1, "result": {"changes": [{"joint", "label", "before", "after", "unit", "said"}]}}`; a refusal carries `error: {code, message, hint, schema?}`. Exit code 0 ran, 1 refused, 2 not sent | well under a second |
| `bun run dist` | assembles the self-contained deployable folder and verifies it | `--out <dir>` (default `dist`); `--no-verify` | → `dist/index.html`, `viewer.css`, `viewer.js`, `asset/rig-b.glb`, `asset/rig-b.manifest.json`, `wiki/`, `version.json`; then served from the sub-path `/rigtwin/` and loaded in headless Chromium: every request must succeed, no console error | 0.5 s (0.03–0.80, 6 runs, before the wiki was included); 1.3 s with the wiki (1 successful run: 124 files, 17.0 MB) |
| `bun run wiki index` | regenerates `wiki/index.md` from the pages' front matter | — | `wiki/**/*.md` → `wiki/index.md` | 0.004–0.013 s |
| `bun run wiki lint` | front matter, links, anchors, images and captions, stable IDs, page length, index freshness | — | `wiki/` → findings; exit code 1 on errors | 0.01–0.02 s |
| `bun run wiki build` | renders the wiki as a static site (relative links, search, generated index) | `--out <dir>` (default `dist/wiki`) | `wiki/` → HTML site | 0.12–0.15 s (3 successful runs; 0.07–0.25 s including runs that stopped on broken links) |
| `bun run deploy` | refuses unless the check and the wiki lint pass and the working tree is committed; then build, documentation images, wiki index and site, dist; copies the folder to the production server as a new release, switches the live link in one step, checks the live pages over HTTPS and switches back if they fail. A release with a server is first checked against the live route (`api/health` must not answer 404) and, after the switch, must report its own revision on `api/health` within 20 s; `server/server.js` must never answer 200 | `--dry-run` (every local step; prints the server commands without running them); `--prepared` (upload, switch and check a `dist/` that a dry run of the same clean commit has just built; the GitHub workflow runs the two as separate steps so the deploy key is on disk only for the network part); `--rollback` (back one release; refused to a release without a server once the live one has one); `--allow-lint`, `--allow-dirty`, `--no-images`, `--config <file>` | settings in `deploy.config.json` → the production server; `dist/deploy-receipt.json` | one dry run 16.6 s before step 1 (check 4.6, documentation images 10.1, dist 1.3); the full check now takes about 105 s of it; see [deployment](../50-implementation/deployment.md) |
| `bun run test` | `bun test generator`: known-answer tests of the geometry kit (5 tests); also part of `check` | — | — | part of the check time |
| `bun run typecheck` | `tsc --noEmit` over generator, shared code, viewer, tools and asset sources; also part of `check` | — | — | part of the check time |
| `bun tools/ui-accept.ts` | the viewer's 53 acceptance checks, driven like a person (real pointer, wheel and key events, a fresh page per check, three window sizes) | `--viewer <dir>`; `--origin <url>` (test a running server); `--baseline <url>` (a second server with the previous viewer, for check T49); `--shots <dir>` (default `work/renders/ui-accept`); `--json <file>`; `--only T12,T31` | viewer source → screenshots and `ui-accept.json`; exit code 1 if a check fails | full run 115 s (111–125, 9 runs); a few checks with `--only` 3–46 s |
| `bun tools/live-accept.ts` | the shared scene in real browsers: two (and a third) headless pages and the real command line on one local server with an empty temporary scene, driven with real pointer input; steps [below](#the-shared-scene-commands-and-tests); also part of the full `check` | — | → `ok` / `FAIL` lines; exit code 1 if a step fails | about 12 s (11.6 s on 2026-11-24) |
| `bun tools/live-site-check.ts <url>` | the two-browser acceptance on a deployed site: two headless pages and the real command line; a 1° turn of the monitor from the command line and its Undo on a page, a 5 mm slider move and `history.undo` of its version, one view command, the "Shared scene" block, nothing logged. Four changes and one view command in all; it compares the pose before and after and puts its two joints back if it stops half-way | the site's address, e.g. `https://mightwork.ai/rigtwin` | the public scene → nine printed `ok`/`FAIL` lines; exit code 1 on a failure | about 5 s |
| `bun tools/live-idle-test.ts` | does the live channel survive a long quiet spell on a real route (the laptop, or `https://mightwork.ai/rigtwin` through Caddy)? Keeps `api/live` open, counts the heartbeats (one every 15 s), then makes one small change in its own group (1° or 5 mm) and undoes it; both must arrive on the same open stream. If the undo is refused it prints the command to undo by hand | `--url <base>` (required); `--minutes <n>` (default 10); `--joint <id>` (default `J_mon_tilt`; refuses assumed and three-angle joints) | → progress lines; exit 0 when all holds, 1 with the reason, 2 for bad options | the minutes given |
| `bash deploy/setup-server.sh` | one-time setup of the rigtwin server on the production host, as root and only with the owner's yes: system user and data folder, Bun 1.4.0 from the official zip checked against a pinned SHA-256, the Caddy site file (validated, backed up, reloaded, every other site checked before and after, the backup put back on any failure), the service unit | `--check` (changes nothing; prints the state and the host checks of `deploy/HOST-CHECKS.md`); `--apply` (idempotent); `--probe` (after `--apply`: runs Bun once under the unit's hardening, host check H7); `--undo [--purge-data]` | the three files `deploy/setup-server.sh`, `deploy/mightwork-apex.caddy`, `deploy/rigtwin-server.service`, copied to the host → the host's configuration; log in `/var/log/rigtwin-setup.log` and `journalctl -t rigtwin-setup` | see [the server and its host setup](../50-implementation/server-and-host-setup.md) |
| `bash tools/deploy-tests/setup-server.test.sh` | the setup script against a stand-in host folder (74 cases); part of `check` | `[path/to/setup-server.sh]` (test another copy) | → `setup-server.sh test: N passed, M failed` | about 9 s |
| `bun tools/deploy-tests/deploy-checks.ts` | the deploy's live-site checks against local stand-ins of the site (16 cases); needs `dist/`; part of the full `check` | — | → `deploy checks test: …` | part of about 90 s for both deploy tests |
| `bash tools/deploy-tests/rollback.test.sh` | `bun run deploy --rollback` with a stand-in `ssh` on a local folder (17 cases); needs `dist/`; part of the full `check` | — | → `rollback test: …` | as above |
| `bun tools/deploy-tests/idle-local.ts` | `live-idle-test.ts` against the built server directly and behind the dist verify's Caddy-like proxy | `--minutes <n>` (default 0.5, longer than Bun's default 10 s idle timeout) | → ok or the reason | twice the minutes |
| `bun tools/deploy-tests/stream-load.ts` | the host's load test (host check H14): 300 attempts at a live stream that never reads and 50 full-pose edits a second against a throwaway server in deployed mode; pass criteria on the [checks](../40-method/checks.md#the-hosts-load-test-host-check-h14) page; not part of `check` | `--seconds <n>` (60); `--streams <n>` (300); `--edits <n>` (50 a second); `--limit-mb <n>` (150); `--budget-kb <n>` (512); `--bundle <server.js> --asset <dir>` (a release's bundle, as on the host) | → memory, CPU, health time and (Linux) TCP memory every 5 s; `stream load: passed` or `FAILED` | the seconds given plus the read-out |
| `python3 -I tools/glb_inspect.py <file.glb>` | independent reader of the model file (standard library only; shares no code with the generator) | `--poses <poses.json>` adds posed matrices; `--tree` | GLB → one JSON document: nodes, meshes, statistics, joint motion sets | used inside `check` |
| `bash .claude/skills/modeling-3d-assets-from-references/scripts/check-vocabulary.sh` | keeps the Skill free of asset-type words and banned names | `--banned-b64 <base64>[,…]` | Skill files and agent definitions → hits by position; exit 0 clean, 1 hits, 2 no banned list | under a second |

A failed `build` exits with the component id and the reason (for example "8 triangle(s) wound against
their normals" or "unknown parameter 'pods.tray_rimm' … Closest: …"). Of 21 failed builds in the
timeline, two were deliberate tests of the checks ([P-21](../60-lessons/patterns.md#p-21)).

### Render sets

| Set | Produces | Images | Typical time |
|---|---|---|---|
| `sheet` | contact sheet: five orthographic views and one perspective view, footer with counts, omitted and missing parts, partial-build warning | 1 | 1.39 s (1.18–1.54, 18 runs) |
| `ortho` | front, rear, left, right, top, orthographic, with axis gizmo and 0.5 m scale bar | 5 | 1.10 s (0.93–1.18, 8) |
| `ids` | each component in its own flat colour, with legend | 3 | 0.70 s (0.61–0.75, 7) |
| `groups` | one sheet per group shown on its own, three views | 5 (or one per `--only` group) | 0.81 s (0.62–3.70, 26) |
| `matched` | per solved photo camera: render, ID colours, outlines on the photo, 50 % blend, side-by-side. Images with photo pixels go to `private/renders/matched/` | 20 for 5 cameras | 8.0 s (7.3–9.1, 7 runs with all 5 cameras); 3.3 s (1.5–6.4, 35 runs) for fewer cameras or one group |
| `matched --photos wiki/img/photos` | the same through the **masked** photos: `rig-<rig>-photo-<n>-side-by-side.jpg`, `-outline.jpg`, `-strip.jpg`, each under 400 kB, into `wiki/img/matched/` | 15 | not timed separately |
| `focus` | six views framed on `--fit` parts; add `--only` to isolate them | 1 sheet | 1.41 s (1.17–1.78, 43) |
| `ui` | the page as a person sees it: default, by component, by data source | 3 | 0.68 s (0.58–0.81, 6) |
| `selftest` | projection self-test: marker spheres through synthetic and solved cameras; fails above 1 px | 0 (a JSON file) | 0.04 s (5) |
| `wiki` | every model image the wiki uses, under stable names, into `wiki/img/model/` (contact sheet, colour-coded parts, one sheet per group, four 1600 px views, joint limits) and the masked comparisons into `wiki/img/matched/`; refuses a partial build | 27 | 9.6 s (9.4–10.4, 20 runs) |
| `all` | `ortho`, `sheet`, `ids`, `groups`, `matched` | 34 | 16.3 s (1 run); with `ui` and `selftest` 14.3–16.1 s |

## The viewer's URL interface

Agents and scripts drive the same page people use. Every parameter is optional; lists are
comma-separated. Wherever a part is named, it may be a component id (`C_stand_monitor`), a group name
(`seat`, `pods`, `stand`, `pedals`, `platform`) or one of the units `joystick_L`, `joystick_R`,
`touchscreen`. Source: the header of `viewer/src/main.ts` and `viewer/src/engine.ts`.

| Parameter | Values | Effect |
|---|---|---|
| `view` | `three_quarter` (default), `front`, `rear`, `left`, `right`, `top`, `front_quarter`, `operator` | standard camera; `operator` sits on the median eye point |
| `proj` | `persp` (default), `ortho` | projection |
| `camera` | `px,py,pz,tx,ty,tz[,fovDeg]` | explicit camera position and target in the model frame (metres) |
| `cam` | a photo name, for example `IMG_2530` | camera of a solved photo; only on the local server, which reads the private camera file |
| `overlay` | `none`, `photo`, `blend`, `outline` | how the photo is shown with `cam` |
| `only` | parts | show only these |
| `hide` | parts | hide these |
| `fit` | parts | frame the view on these instead of the whole rig |
| `pose` | `J_x:value,…` | joint values: degrees for revolute joints, metres for prismatic ones, `roll/pitch/yaw` in degrees for ball joints (`J_ts_arm:0/25/0`). Moves assumed joints too, and the page then shows the amber notice |
| `mode` | `normal` (default), `ids`, `class` | materials; one colour per component; colour by size class |
| `wire` | `1` | wireframe |
| `frames` | `1` | show joint and reference frames |
| `legend` | `1` | legend for `ids` or `class` |
| `hud` | `1` | axis gizmo, and a 0.5 m scale bar in orthographic views |
| `caption` | text | a caption on the image |
| `ui` | `0` | hide every panel and button: the 3D view alone |
| `sel` | a part | select it (its card opens) |
| `asset`, `name` | folder, asset name | where the model is (default `asset/rig-b`) |
| `look` | `now` (default), `previous`, or `exposure:0.9,env:0.5,key:2,fill:0.3` (also `tone`, `kx`, `ky`, `kz`) | lighting; `previous` restores the lighting before the exposure correction, for comparing old renders |

The page keeps its own address in step with what is on screen (camera, hidden parts, selection,
adjustments), so a link copied by a person is also a valid input for an agent.

Examples:

```
/?view=front&proj=ortho&hud=1
/?only=seat&fit=seat&mode=class&legend=1
/?pose=J_mon_height:-0.05,J_mon_tilt:-9,J_seat_recline:20&sel=C_stand_monitor
/?cam=IMG_2530&overlay=outline            (local server only)
/?view=operator&ui=0
```

**Script interface** (`window.viewer`, available when `window.viewerReady` is true; `window.viewerError`
holds a load error): `apply(options)` (reset, then apply the same keys as the URL; resolves when drawn),
`state()` (view, photo, hidden parts, joint values, camera, triangles and draw calls, frame rate,
selection, assumed joints in use), `setView`, `setPhotoCamera`, `setOverlay`, `setVisible`, `showOnly`,
`showAll`, `hideAll`, `setJoint(id, value, {force})` (assumed, locked joints need `force`), `resetJoints`,
`setMode`, `setFrames`, `select`, `zoomTo`, `selfTest`, `pickAt(x, y)`, `project(point)`,
`worldPosition(id)`, `cameras()`, `cameraInfo(name)`, `manifest()`, `benchmark(n)`, `rows()`,
`shareUrl()`, `picture()`, `frame()`.

`viewer.live()` (since step 1) gives the state of the shared scene on this page, or `null` when the page has
no server: `code` (the session code view commands name), `version` (the scene version the page holds), `preview`
(a link's pose shown with Apply), `unsaved` (joints changed here and not saved yet), `activity` (the text of the
activity line, or `null`), `resyncs`, and the connection's `connected`, `attempt`, `waiting` and `stopped`.

**Keys for people:** Esc clears the selection (or closes a menu), A shows all, F zooms to the selection,
H hides it, I shows only it.

## The shared scene: commands and tests

The rigtwin server (`server/server.ts`, the same code on the laptop and on the host) keeps one shared scene, the
Playground: the pose of the rig and its last 200 changes. Every viewer that shows it follows changes live over
server-sent events and sends its own changes as commands ([D-39](../20-decisions/decision-log.md#d-39)). The commands
of step 1, from `shared/commands/core.ts` (`bun run rig list` shows each with its arguments and examples):

| Command | Kind | What it does |
|---|---|---|
| `scene.summary` | query | what is open: the asset, the scene version, every moved joint with its value and unit, and the recent changes (version, who, group, what changed) |
| `scene.find` | query | ids by plain words, ranked: parts (`C_`, `S_`), joints (`J_`, with unit, neutral value, travel and evidence) and datums (`D_`, reference points such as eye points and grips) |
| `pose.set` | edit | set one or more joints: degrees for turning joints and for each angle of a three-angle mount (`[roll, pitch, yaw]`, absolute), metres for sliding joints; values outside the travel are refused; assumed adjustments only with `allowAssumed`; recorded as one change |
| `history.undo` | edit | undo one change (`{"version": n}`) or every change of a request (`{"group": id}`) as a new change; refused as stale if a joint it would put back was changed again since ([D-40](../20-decisions/decision-log.md#d-40)) |
| `measure.distance` | query | distance in metres between two frames (parts, datums, surfaces, joint frames) at the current pose: a point estimate from the photo-estimated sizes, no range yet |
| `view.set` | view | show a named view in one browser (`--viewer <code>`): `operator` (the operator's eye), `three_quarter`, `front`, `rear`, `left`, `right`, `top`, `front_quarter` |
| `view.show` | view | choose what one browser shows: `only`, `hide`, or `all` again |
| `view.select` | view | select a part or group in one browser, as a click would (its card opens) |

**Agent interface v2** ([D-48](../20-decisions/decision-log.md#d-48)) adds five intent commands over these, in
`shared/commands/intent.ts`, and offers them as MCP tools at `POST api/mcp`; their full description, the catalogue of
adjustments and the MCP instructions are on the generated page [agent interface](agent-interface.md).

| Command | Kind | What it does |
|---|---|---|
| `adjust` | edit | move adjustments named in plain words: `{"target": "backrest", "to": "upright"}`, `{"target": "monitor height", "by": "-3 cm"}`, several in `changes`; relative changes worked out on the server; a server-made request name; assumed adjustments moved and marked |
| `look` | view | a named view, `only` / `hide` / `all`, `select`, and with `picture: true` a JPEG of the browser's view; locally without a code to every page |
| `measure` | query | the distance between two points named in words ("median eye" to "monitor screen") |
| `undo` | edit | "last" (default), "mine", a request name or a version |
| `state` | query | what is moved and the last three changes in a few lines; `detail` "catalogue" or "history" |

`GET api/trace` returns the last 100 trace records (one per request; [D-53](../20-decisions/decision-log.md#d-53)); the viewer shows them under Trace.
`bun run rig <command> '<json>' --text` prints only the reply's text; `--out <file>` names where a picture goes.
`bun tools/agent-docs.ts` regenerates the Skill's reference and the agent-interface page (`--check` only compares).
`bun tools/agent-eval.ts` is the agent benchmark (ten owner requests, headless Claude Code, the step-1 interface as the
baseline; it spends tokens and needs a signed-in Claude Code command line).

The request-level values `group`, `expectedVersion` and `session` (the browser's code) travel with the request,
never inside the arguments. Authors are labels the server makes from a keyed hash of the caller's id ("Person ·
3f2a", "Claude Code · 3f2a"; [D-41](../20-decisions/decision-log.md#d-41)). Scripts can `import { call, catalogue }
from "./tools/rig.ts"`: `call(id, args, {server, viewer, group, expectedVersion, client})` returns the same reply
object (callers default to the label "Script"). On a remote server, a group name in a reply that is not this run's own
`--group` comes back as `untrusted_group`, and `--group` itself is refused if it contains a banned name.

The steps of `bun tools/live-accept.ts`:

1. a slider move in browser A appears in B, with B's activity line naming A (A shows none for its own change);
2. `bun run rig pose.set` appears in both, with the activity line;
3. Undo on B's activity line undoes it in both;
4. a stale edit (A holds a slider while Claude Code moves the same joint) is refused, the reason is shown and A shows the shared value again;
5. a link with `pose=` shows Apply and saves nothing by itself; Dismiss returns to the shared pose, Apply saves it;
6. a view command reaches only the browser whose code it names;
7. a stranger who copies B's author id from the live channel cannot make B ignore the change;
8. after a server restart both pages reconnect by themselves with backoff, catch up and resync exactly once; the browser coming back online reconnects at once;
9. without a server the page works as before: no request under `api/`, nothing logged.

## Workspaces and environment variables

| Variable | Same as | Effect |
|---|---|---|
| `RIGTWIN_WORKSPACE=<name>` | `--workspace <name>` on `build`, `check`, `render`, `serve` | build output goes to `work/<name>/build/`, renders to `work/<name>/renders/<set>/`, so agents building at the same time do not overwrite each other's model |
| `RIGTWIN_AGENT=<role>` | — | the `agent` field of the tool's timeline lines; unset gives `unnamed` (3 such lines in this run) |
| `RIGTWIN_VIEWER_DIR=<dir>` | `--viewer <dir>` on `serve`, `render`, `ui-accept` | viewer source folder (default `viewer`); how the interface implementer tested a copy while others kept rendering with the original |
| `RIGTWIN_CHROME=<path>` | — | Chromium binary, when the Playwright cache has none |

Workspaces isolate outputs, not inputs: parameter files and the spec are shared, so a syntax error in
one agent's file can still stop another agent's build (it happened; see
[agent process](../40-method/agent-process.md#how-collisions-were-avoided)).

## Where outputs go

| Output | Default place | Committed? |
|---|---|---|
| Model file and description file | `assets/rig-b/build/` (with a workspace: `work/<name>/build/`) | no; rebuilt from source by `build` and `dist` |
| Renders | `work/renders/<set>/` (with a workspace: `work/<name>/renders/<set>/`) | no |
| Anything containing photo pixels (matched outlines, blends, side-by-sides from the originals) | `private/renders/matched/` | never |
| Masked photo comparisons and model images for the wiki | `wiki/img/matched/`, `wiki/img/model/` | yes |
| Viewer acceptance screenshots and results | `work/renders/ui-accept/` | no |
| Deployable folder (with `server/server.js`, the server bundled into one file, never served) | `dist/` | no |
| The shared scene of `bun run serve` | `../rigtwin-projects/playground/doc.json` (outside the repository; `--data <dir>` elsewhere) | no |
| Timeline of tool runs | `work/timeline.jsonl` | no |
| Wiki site | `dist/wiki/` | no |

`private/` and `work/` are excluded from version control (`.gitignore`), as are `dist/`,
`node_modules/` and `assets/*/build/`. The repository layout folder by folder is on the
[tech stack](../50-implementation/tech-stack.md#repository-layout) page.
