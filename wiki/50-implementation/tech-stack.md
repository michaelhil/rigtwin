---
title: Tech stack as built
tldr: Bun and TypeScript, with three.js the only library that reaches the browser; Python reads the model file independently; headless Chromium makes every render. Since platform step 1 a small Bun server with no added package holds the shared scene (commands over HTTP, changes as server-sent events). Six pinned npm packages, all MIT or Apache-2.0; no Blender or photogrammetry.
status: living
updated: 2026-11-24
tags: [stack, implementation, dependencies, repository, server]
---

# Tech stack as built

## TL;DR

- **Bun** runs everything written in TypeScript (generator, tools, tests) and bundles the viewer. **three.js** is the one library in the browser and also the generator's math and file writer. **Python 3** reads the model file independently, with its standard library only.
- **Six direct npm packages**, versions pinned exactly; fifteen installed in all (66 MB). Licences: MIT and Apache-2.0. Only three.js ships to the browser (viewer script 732,720 bytes on 2026-11-24, with the live client; 726 kB before).
- **The server (platform step 1, 2026-11-24)** is `server/server.ts` on `Bun.serve`, with the command layer in `shared/commands/` (its own small schema validator) and no new package: commands come in as JSON over HTTP POST, changes go out as server-sent events ([D-39](../20-decisions/decision-log.md#d-39)). `bun run dist` bundles it into one file for Bun; on the host it runs on Bun 1.4.0 installed from the official zip with a pinned SHA-256 ([the server and its host setup](server-and-host-setup.md)).
- Renders and page tests use a **headless Chromium** already in the machine's Playwright cache (build 1248), driven directly over the DevTools protocol; no Playwright package.
- The **measurement** used numpy, Pillow, OpenCV, SciPy and pycolmap in a throwaway Python environment outside the repository. The values it produced live in the parameter files; the scripts do not.
- **Not used, on purpose:** Blender, automatic photogrammetry, segmentation models, a CAD kernel, a UI framework. Reasons and the tests behind them are in [Options considered](../20-decisions/options-considered.md).

Versions are those on the build machine (one Apple M2, macOS) on 2026-11-23; the server's parts were
added on 2026-11-24 ([platform plan](../30-plan/platform-plan.md)). Decisions:
[D-01](../20-decisions/decision-log.md#d-01) to [D-05](../20-decisions/decision-log.md#d-05),
[D-13](../20-decisions/decision-log.md#d-13), [D-29](../20-decisions/decision-log.md#d-29).
Commands are in the [tool reference](../80-reference/tools.md).

## Runtimes and tools

| Component | Version | Used for | Where it comes from |
|---|---|---|---|
| Bun | 1.4.0 | runs TypeScript directly; package manager; bundler for the viewer and (`bun build --target bun`) for the server; test runner; since step 1 also the server's HTTP server (`Bun.serve`), locally and on the host | installed on the machine; the only runtime the project asks for. On the production host: `/opt/rigtwin/runtime/bun`, from the official 1.4.0 release zip, checked against a pinned SHA-256 by `deploy/setup-server.sh`; GitHub Actions checks `bun --revision` is `1.4.0+34cbb9a40` |
| TypeScript | 5.9.3 | type checking only (`tsc --noEmit`, part of `bun run check`); Bun runs the sources without a compile step | npm, pinned |
| three.js | 0.187.0 | generator: vectors, matrices and the GLB writer path; viewer: rendering, controls, loading | npm, pinned |
| Khronos glTF validator | 2.0.0-dev.3.10 | the file-format check on every `bun run check` | npm, pinned |
| marked | 18.2.1 | Markdown to HTML for the wiki site (`bun run wiki build`) | npm, pinned; no dependencies of its own |
| Python | 3.11.1 | `tools/glb_inspect.py`, the independent model reader: standard library only | system |
| Chromium headless shell | build 1248 | every render (`bun run render`), the projection and frame-rate checks, the viewer acceptance script, the distribution check | the machine's Playwright browser cache; `RIGTWIN_CHROME` can point elsewhere |
| uv | 0.11.28 | created the throwaway Python environments of the measurement and photo-masking agents | system |

**Python environments outside the repository** (in the agents' working folders, not committed):

| Environment | Python | Packages | Licences (from the package metadata) |
|---|---|---|---|
| Measurement | 3.11.1 | numpy 2.4.6, Pillow 13.0.0, opencv-python-headless 5.1.0.95, SciPy 1.17.1, pycolmap 4.2.1 | BSD-3-Clause (numpy, with MIT/Zlib/0BSD/CC0 parts), MIT-CMU (Pillow), Apache-2.0 (OpenCV), BSD (SciPy), BSD-3-Clause (pycolmap) |
| Photo masking | 3.13.14 | numpy 2.5.5, Pillow 13.0.0, opencv-python-headless 5.1.0.95 | as above |

pycolmap was used only to read the structure-from-motion result of the planning phase; it was not
re-run.

## Pinned packages and licences

`package.json` lists six packages; `bunfig.toml` sets `exact = true`, so installs never float.

| Package | Version | Kind | Licence | Pulls in |
|---|---|---|---|---|
| three | 0.187.0 | runtime (generator and browser) | MIT | — |
| gltf-validator | 2.0.0-dev.3.10 | runtime of the checks | Apache-2.0 | — |
| typescript | 5.9.3 | development | Apache-2.0 | — |
| @types/three | 0.187.0 | development (type definitions) | MIT | @dimforge/rapier3d-compat 0.12.0 (Apache-2.0), @tweenjs/tween.js 23.1.3, @types/stats.js 0.17.4, @types/webxr 0.5.24, fflate 0.8.3, meshoptimizer 1.1.1 (all MIT) |
| @types/bun | 1.3.3 | development (type definitions) | MIT | bun-types 1.3.3, @types/node, undici-types (MIT) |
| marked | 18.2.1 | development (wiki site) | MIT | — |

Fifteen packages are installed in all; `node_modules` is 66 MB. The nine pulled-in packages come only
from the two type-definition packages; none of them reaches the browser or the model file.

**What reaches the browser:** one bundled script (`viewer.js`, 732,720 bytes on 2026-11-24: three.js,
about 660 kB of it, plus the project's own viewer and shared code, including the live client), one
stylesheet (16 kB), one HTML page, the model file (0.72 MB) and its description file (0.22 MB). No CDN, no
web font, no analytics. The viewer acceptance check T10 counts every script the default page loads
against 800 kB in all and requires the page to be ready within 1 s ([D-43](../20-decisions/decision-log.md#d-43)).
The live client does not import the command layer, to keep the script small; it speaks the wire format
directly.

## The server side (platform step 1)

| Part | What | Where |
|---|---|---|
| HTTP server | `Bun.serve`: `GET api/health`, `GET api/commands`, `POST api/command` (JSON, header `X-Rigtwin: 1`), `GET api/live` (server-sent events: session, snapshot or the missed changes, heartbeat every 15 s); the guards of the open server in deployed mode only | `server/server.ts`, `server/limits.ts` |
| Command layer | a registry of commands (`scene.summary`, `scene.find`, `pose.set`, `history.undo`, `measure.distance`, and the view commands `view.set`, `view.show`, `view.select`); the scene document (pose, last 200 changes, per-joint stale check, undo by entry or group); a validator of about 80 lines for the part of JSON Schema it needs, written for it instead of a package | `shared/commands/` |
| Words | the plain-language names of parts and adjustments, moved from `viewer/src/words.ts` to `shared/words.ts` so the viewer, the commands and the command line say the same thing | `shared/words.ts` |
| Kinematics | reads the GLB's node tree and poses it; used by `measure.distance` on the server | `shared/kinematics.ts` |
| Live client | the viewer's side of the live channel and its reconnect rules | `viewer/src/live.ts`, `viewer/src/live-connection.ts` |
| Command line | `bun run rig <command> '<json>'`, `bun run rig list`, `--server`, `--viewer`, `--group` | `tools/rig.ts` |
| Bundle | `bun run dist` writes `dist/server/server.js` (65,471 bytes on 2026-11-24) and refuses code from outside `server/` and `shared/` or any import Bun does not provide | `tools/dist.ts` |

Nothing here added an npm package: `package.json` gained only the `rig` script.

## Repository layout

| Path | Holds | Committed |
|---|---|---|
| `assets/rig-b/params/` | every number of the asset as a parameter record: `devices.toml` (makers' data), one file per group, optional `measured.toml` (read last; overrides) | yes |
| `assets/rig-b/spec/rig.toml` | the component tree, mount frames, joints, reference frames, the expected-motion and left/right tables | yes |
| `assets/rig-b/src/` | one module per group (`platform.ts`, `seat.ts`, `pods.ts`, `stand.ts`, `pedals.ts`) and group helpers in `lib/` | yes |
| `assets/rig-b/build/` | the built model file and description file | no (rebuilt in 0.2 s) |
| `generator/` | parameter loader, expression evaluator, geometry kit and faceted cage, assembler, GLB writer, materials, generated screen images, build command, kit tests, developer note | yes |
| `shared/` | code used by the generator, the viewer and the server: the pose function, the description-file types, math, the plain-language words (`words.ts`, moved from the viewer in step 1), the node-tree kinematics (`kinematics.ts`) | yes |
| `shared/commands/` | the command layer (step 1): schema validator, registry, scene document, the commands, their unit tests | yes |
| `server/` | the rigtwin server (step 1): `server.ts`, `limits.ts`, the integration test `server.test.ts` | yes |
| `viewer/` | the viewer page: `index.html`, `viewer.css`, `src/*.ts` (since step 1 also `live.ts` and `live-connection.ts` with its test) | yes |
| `tools/` | check, render driver, local static server (with the server mounted under `/api/` since step 1), bundler, distribution, deploy, wiki, timeline, version, viewer acceptance script, the Python model reader, the contact-sheet page; new in step 1: `rig.ts` (the command line), `live-accept.ts` (two browsers and the command line on one server), `live-idle-test.ts` (the live channel idle through Caddy), `banned.ts` (the banned names, shared by the check and `rig`), `claude-sandbox-settings.json` (a prepared Claude Code setting for work against the public sandbox, not active) | yes (`tools/.venv/` excluded) |
| `tools/deploy-tests/` | tests of the deploy and the host setup against local stand-ins: the setup script's harness (with the fixture of the site file live before the setup), the deploy's live checks, rollback, idle test, stream load (host check H14) | yes |
| `wiki/` | this wiki, with its images under `wiki/img/` (masked photos and renders only) | yes |
| `.claude/skills/`, `.claude/agents/` | the Agent Skills (modelling, and since step 1 `operating-rigtwin`) and the three agent definitions ([Skills and agents](../80-reference/skills-and-agents.md)) | yes |
| `deploy/` | the production server's files: the Caddy site file, the deploy gate and pinned host key, and since step 1 the server's unit `rigtwin-server.service`, the one-time `setup-server.sh` and the host checklist `HOST-CHECKS.md` ([deployment](deployment.md)) | yes |
| `CLAUDE.md` | entry instructions for AI agents: read the wiki first; commands; rules that are easy to break | yes |
| `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, `deploy.config.json`, `LICENSE` (MIT), `.gitignore` | project files | yes |
| `private/` | original photos, solved cameras, measurement evidence, renders containing photo pixels, the planning records (which name the client) | **never** |
| `work/` | agents' working files: measurement scripts and tables, review reports and their renders, interface reviews, milestone images, coordinator notes, the timeline | **never** |
| `dist/` | the deployable folder built by `bun run dist` | no |
| `node_modules/` | installed packages | no |

The exclusions are in `.gitignore`; the banned-word check ([C-15](../40-method/checks.md#c-15)) scans
every file that can be committed, including file names and image bytes. Version control was started
only at the end of the build ([D-33](../20-decisions/decision-log.md#d-33)).

## Dependencies against "as few as possible"

The owner asked for open source only and "as few dependencies or external software as possible"
([R-22](../10-request/requirements.md), [R-23](../10-request/requirements.md)).

| Layer | What is needed | Count |
|---|---|---|
| In the browser | three.js | 1 library |
| To build and check the asset | Bun; three.js; the glTF validator; Python 3 standard library; a Chromium binary for the browser checks | 1 runtime, 2 npm packages, 1 system Python, 1 browser binary |
| To develop | TypeScript, two type-definition packages, marked | 4 npm packages (13 more installed with them) |
| To measure from photos (once per asset, outside the repository) | numpy, Pillow, OpenCV, SciPy, pycolmap | 5 PyPI packages in a throwaway environment |
| To run the server (step 1) | Bun only; Node's built-in modules as Bun provides them | 0 packages |
| Not needed at all | Node.js, Playwright, Blender, Docker, a database, a CDN, a web framework, a WebSocket library, any paid or closed tool | 0 |

Everything listed is open source (*checked* against the package metadata; Chromium's own licence
file is in its cache folder). *Judgment:* this meets the request; the one heavy item is Chromium,
which the project uses but does not install.

## Deliberately not used

| Not used | Why (summary; evidence in [Options considered](../20-decisions/options-considered.md)) |
|---|---|
| Blender | Trial A showed it works as a Python library, but it is 781 MB, tied to one Python version per release, GPL-licensed, and its builds took 1.1 s against 0.07 s ([D-04](../20-decisions/decision-log.md#d-04)). Not installed |
| Automatic 3D reconstruction (photogrammetry, scanning, image-to-3D) | Three photos of Rig B give two real viewpoints; the surfaces are glossy white and black; the result would be a mesh without parts, joints or parameters ([D-01](../20-decisions/decision-log.md#d-01)). Structure from motion was used only to seed the cameras |
| Segmentation models, cutting the rig out of the photos | Nothing is taken from pixels, so no mask is needed; the cameras are tied to the deck ([D-06](../20-decisions/decision-log.md#d-06)) |
| A CAD kernel (OpenCascade through build123d or CadQuery) | 573 MB and 58 packages; a fillet failed at the radii the shell needs; exactness the evidence does not support. The project has its own small geometry kit with tests |
| A UI framework (React, Svelte) or a 3D viewer component | a framework and a bundler for a page of a few hundred lines; existing viewer components have no joints or reference frames |
| Playwright as a library | the tools speak the DevTools protocol to the cached browser directly |
| Code from the owner's Leitbild project | its ideas were reused, not its code ([D-20](../20-decisions/decision-log.md#d-20)); step 1 takes its command-and-revision core and its reconnect cases, but not its WebSocket ([D-39](../20-decisions/decision-log.md#d-39)) |
| A database, a web framework, a WebSocket library (step 1) | the scene is one small JSON file written atomically; `Bun.serve` and server-sent events cover the routes and the live channel |

## Known weaknesses

| Weakness | Consequence | Status |
|---|---|---|
| The measurement scripts and the dimension table are not in the repository (they are in `work/`) | re-measuring after new photos means re-implementing the scripts from the [method page](../40-method/measuring-from-photos.md); the values and their evidence are in the parameter files | open |
| The geometry kit is hand-written | its correctness rests on 5 known-answer tests and the checks; no solid-modelling kernel stands behind it | accepted |
| Chromium comes from a cache that another tool installed | a fresh machine needs a Chromium binary (`RIGTWIN_CHROME`) before it can render or run the browser checks | open |
| Only `build` takes `--asset`; `check`, `render`, `serve` and `dist` assume the first asset's id | a second asset needs those tools generalised | open (noted in the Skill) |
| Parameter files and the spec are shared between parallel agents | one agent's syntax error stops another agent's build; about ten such failures in two rounds | open; the remedy is one working copy per agent |
| Frame rate and exposure measured only in headless Chromium on one Apple M2 | no data for weaker laptops or phones | [I-15](../60-lessons/ideas.md#i-15) |
| Two Python versions (3.11 and 3.13) were used by two agents | harmless for the throwaway environments; the committed reader needs only the standard library | accepted |
| Transitive type-definition packages (nine) | install size only; nothing ships | accepted |
| The Caddy file and the server's systemd unit cannot be tried on the laptop (no Caddy, no systemd on macOS) | they are validated only on the host, by the setup script (`caddy validate`, `systemd-analyze verify`, `--probe`) | accepted; done on the host on 2026-11-24 ([the setup script](server-and-host-setup.md#the-setup-script-and-the-host-checks)) |
| On the laptop the local server speaks HTTP/1.1, where a browser allows six streams per host | a seventh viewer tab on the same local server waits; the deployed site uses HTTP/2 through Caddy | accepted |
