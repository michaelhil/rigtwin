---
title: Tool reference
tldr: Every command of the project (bun run build, check, render, serve, dist, wiki, deploy, test, typecheck; the viewer acceptance script; the independent model reader; the Skill's vocabulary check) with its options, inputs, outputs and typical run time, plus the viewer's URL interface for agents, the workspaces and environment variables, and where every output goes.
status: living
updated: 2026-11-23
tags: [reference, tools, commands, viewer, agents]
---

# Tool reference

## TL;DR

- `bun install` once; then `bun run build` (0.2 s), `bun run check` (4.2 s, 20 checks), `bun run render --set sheet` (1.4 s plus 0.4 s browser start). Typical times are medians from the project's timeline, one Apple M2, 2026-11-23.
- Renders come from the real viewer page driven by a headless Chromium; anything with photo pixels is written under `private/`, never `work/` or `wiki/`.
- Agents drive the viewer by **URL parameters** (`view`, `only`, `hide`, `fit`, `pose`, `mode`, `cam`, …) or by `window.viewer.apply({...})` with the same keys.
- Parallel agents set `RIGTWIN_WORKSPACE` (own build and render folders) and `RIGTWIN_AGENT` (their name in the timeline). `RIGTWIN_VIEWER_DIR` points the tools at a copy of the viewer.
- `bun run deploy` checks, builds, packages and publishes, and switches back if the live pages fail; see [deployment](../50-implementation/deployment.md).

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
| `bun run serve` | local web server laid out like the deployed folder | `--port <n>` (default 4173); `--workspace <name>`; `--viewer <dir>` | → `http://127.0.0.1:4173/`: `/` viewer (bundled in memory, rebuilt when a file changes), `/asset/` build, `/wiki/` built wiki, `/version.json`; local only: `/private/`, `/work/` | starts at once; bundling about 0.1 s |
| `bun run dist` | assembles the self-contained deployable folder and verifies it | `--out <dir>` (default `dist`); `--no-verify` | → `dist/index.html`, `viewer.css`, `viewer.js`, `asset/rig-b.glb`, `asset/rig-b.manifest.json`, `wiki/`, `version.json`; then served from the sub-path `/rigtwin/` and loaded in headless Chromium: every request must succeed, no console error | 0.5 s (0.03–0.80, 6 runs, before the wiki was included); 1.3 s with the wiki (1 successful run: 124 files, 17.0 MB) |
| `bun run wiki index` | regenerates `wiki/index.md` from the pages' front matter | — | `wiki/**/*.md` → `wiki/index.md` | 0.004–0.013 s |
| `bun run wiki lint` | front matter, links, anchors, images and captions, stable IDs, page length, index freshness | — | `wiki/` → findings; exit code 1 on errors | 0.01–0.02 s |
| `bun run wiki build` | renders the wiki as a static site (relative links, search, generated index) | `--out <dir>` (default `dist/wiki`) | `wiki/` → HTML site | 0.12–0.15 s (3 successful runs; 0.07–0.25 s including runs that stopped on broken links) |
| `bun run deploy` | refuses unless the check and the wiki lint pass and the working tree is committed; then build, documentation images, wiki index and site, dist; copies the folder to the production server as a new release, switches the live link in one step, checks the live pages over HTTPS and switches back if they fail | `--dry-run` (every local step; prints the server commands without running them); `--rollback` (back one release); `--allow-lint`, `--allow-dirty`, `--no-images`, `--config <file>` | settings in `deploy.config.json` → the production server; `dist/deploy-receipt.json` | one dry run 16.6 s (check 4.6, documentation images 10.1, dist 1.3); see [deployment](../50-implementation/deployment.md) |
| `bun run test` | `bun test generator`: known-answer tests of the geometry kit (5 tests); also part of `check` | — | — | part of the check time |
| `bun run typecheck` | `tsc --noEmit` over generator, shared code, viewer, tools and asset sources; also part of `check` | — | — | part of the check time |
| `bun tools/ui-accept.ts` | the viewer's 53 acceptance checks, driven like a person (real pointer, wheel and key events, a fresh page per check, three window sizes) | `--viewer <dir>`; `--origin <url>` (test a running server); `--baseline <url>` (a second server with the previous viewer, for check T49); `--shots <dir>` (default `work/renders/ui-accept`); `--json <file>`; `--only T12,T31` | viewer source → screenshots and `ui-accept.json`; exit code 1 if a check fails | full run 115 s (111–125, 9 runs); a few checks with `--only` 3–46 s |
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

**Keys for people:** Esc clears the selection (or closes a menu), A shows all, F zooms to the selection,
H hides it, I shows only it.

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
| Deployable folder | `dist/` | no |
| Timeline of tool runs | `work/timeline.jsonl` | no |
| Wiki site | `dist/wiki/` | no |

`private/` and `work/` are excluded from version control (`.gitignore`), as are `dist/`,
`node_modules/` and `assets/*/build/`. The repository layout folder by folder is on the
[tech stack](../50-implementation/tech-stack.md#repository-layout) page.
