---
title: Tech stack as built
tldr: The project runs on Bun and TypeScript with three.js as the only library that reaches the browser; Python (standard library) reads the model file independently; a cached headless Chromium makes every render. Six pinned npm packages (fifteen installed), all MIT or Apache-2.0. Blender, photogrammetry and segmentation models were deliberately not used.
status: living
updated: 2026-11-23
tags: [stack, implementation, dependencies, repository]
---

# Tech stack as built

## TL;DR

- **Bun** runs everything written in TypeScript (generator, tools, tests) and bundles the viewer. **three.js** is the one library in the browser and also the generator's math and file writer. **Python 3** reads the model file independently, with its standard library only.
- **Six direct npm packages**, versions pinned exactly; fifteen installed in all (66 MB). Licences: MIT and Apache-2.0. Only three.js ships to the browser (viewer script 726 kB).
- Renders and page tests use a **headless Chromium** already in the machine's Playwright cache (build 1248), driven directly over the DevTools protocol; no Playwright package.
- The **measurement** used numpy, Pillow, OpenCV, SciPy and pycolmap in a throwaway Python environment outside the repository. The values it produced live in the parameter files; the scripts do not.
- **Not used, on purpose:** Blender, automatic photogrammetry, segmentation models, a CAD kernel, a UI framework. Reasons and the tests behind them are in [Options considered](../20-decisions/options-considered.md).

Versions are those on the build machine (one Apple M2, macOS) on 2026-11-23. Decisions:
[D-01](../20-decisions/decision-log.md#d-01) to [D-05](../20-decisions/decision-log.md#d-05),
[D-13](../20-decisions/decision-log.md#d-13), [D-29](../20-decisions/decision-log.md#d-29).
Commands are in the [tool reference](../80-reference/tools.md).

## Runtimes and tools

| Component | Version | Used for | Where it comes from |
|---|---|---|---|
| Bun | 1.4.0 | runs TypeScript directly; package manager; bundler for the viewer; test runner | installed on the machine; the only runtime the project asks for |
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

**What reaches the browser:** one bundled script (`viewer.js`, 726 kB: three.js plus the project's own
viewer and shared code), one stylesheet (15.7 kB), one HTML page, the model file (0.72 MB) and its
description file (0.22 MB). No CDN, no web font, no analytics, no server-side code.

## Repository layout

| Path | Holds | Committed |
|---|---|---|
| `assets/rig-b/params/` | every number of the asset as a parameter record: `devices.toml` (makers' data), one file per group, optional `measured.toml` (read last; overrides) | yes |
| `assets/rig-b/spec/rig.toml` | the component tree, mount frames, joints, reference frames, the expected-motion and left/right tables | yes |
| `assets/rig-b/src/` | one module per group (`platform.ts`, `seat.ts`, `pods.ts`, `stand.ts`, `pedals.ts`) and group helpers in `lib/` | yes |
| `assets/rig-b/build/` | the built model file and description file | no (rebuilt in 0.2 s) |
| `generator/` | parameter loader, expression evaluator, geometry kit and faceted cage, assembler, GLB writer, materials, generated screen images, build command, kit tests, developer note | yes |
| `shared/` | code used by both generator and viewer: the pose function, the description-file types, math | yes |
| `viewer/` | the viewer page: `index.html`, `viewer.css`, `src/*.ts` | yes |
| `tools/` | check, render driver, server, bundler, distribution, deploy, wiki, timeline, version, viewer acceptance script, the Python model reader, the contact-sheet page | yes (`tools/.venv/` excluded) |
| `wiki/` | this wiki, with its images under `wiki/img/` (masked photos and renders only) | yes |
| `.claude/skills/`, `.claude/agents/` | the Agent Skill and the three agent definitions ([Skills and agents](../80-reference/skills-and-agents.md)) | yes |
| `deploy/` | the web-server site file for the production server | yes (being prepared at the time of writing) |
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
| Not needed at all | Node.js, Playwright, Blender, Docker, a database, a CDN, any server-side code, any paid or closed tool | 0 |

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
| Code from the owner's Leitbild project | its ideas were reused, not its code ([D-20](../20-decisions/decision-log.md#d-20)) |

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
