---
title: The pipeline, end to end
tldr: How eleven phone photos became a parametric, articulated 3D asset and a browser viewer; each stage with its inputs, outputs, command, who does it and how long it took on this machine.
status: living
updated: 2026-11-23
tags: [method, pipeline, performance]
---

# The pipeline, end to end

## TL;DR

- Nothing is extracted from pixels. Photos are **measured** (cameras solved, points triangulated), the numbers go into **parameter files**, and **code** turns parameters into geometry.
- The compiled asset is two files: a `.glb` model and a JSON **description file** (the manifest; see the [glossary](../00-overview/glossary.md)). Source of truth is `assets/rig-b/params/*.toml`, `assets/rig-b/spec/rig.toml` and `assets/rig-b/src/*.ts`.
- The inner loop is fast: build 0.13 s, all checks 4 s, a six-view contact sheet 1.4 s (*measured*, one Apple M2 machine). The slow parts are agent work: measuring 48 min, modelling 27–41 min per component group, an independent review 27 min.
- Every render an agent looks at comes from the same viewer page a person uses, driven headless.
- An independent reviewer that never sees the builders' notes decides whether the model is credible; scripts decide everything numeric.

## Diagram

```
 11 photos (phone, portrait)                                             person supplies
    │   sort by rig instance: Rig B = photos 2511, 2530, 2532
    ▼
 EVIDENCE SET        working copies 1500 × 2000 px, gridded crops, captions
    │                (masked copies for the wiki are a separate, parallel job)
    ▼
 CAMERA SOLVE        focal length from photo metadata
    │                → structure from motion: 3 cameras, 35 background points
    │                → sub-pixel traces of the deck edges
    │                → bundle adjustment directly in the model frame
    │                gauge features: deck plane, deck rectangle, deck width 1.50 m
    ▼
 SCALE CLOSURE       parts of known size measured in that frame
    │                soundbar 1.003 · pedal pitch 1.00 · monitor 1.02
    ▼
 DIMENSION TABLE     118 records  +  215 named 3D shape points  +  5 solved cameras
    │
    ▼
 PARAMETERS          assets/rig-b/params/*.toml      303 records (as of round 2)
    │                value · unit · range · class · basis · tier · evidence
    │                      ▲
    │                      └── measured.toml, read last: real measurements override
    ▼
 SPEC                assets/rig-b/spec/rig.toml
    │                tree · mount frames · joints · datums · expected motion · left/right table
    ▼
 COMPONENT MODULES   assets/rig-b/src/<group>.ts   one function per component, geometry kit
    │
    ▼
 ASSEMBLER ─► GLB WRITER ─► rig-b.glb + rig-b.manifest.json        bun run build     0.13 s
    │
    ▼
 CHECKS              20 checks, non-zero exit on failure           bun run check     4 s
    │
    ▼
 RENDERS             ortho · sheet · ID colours · groups · focus   bun run render    1–3 s
    │                · photo-matched (through the solved cameras)
    ▼
 INDEPENDENT REVIEW  own renders, own GLB reader ─► findings ─► fixes ─► next round
    │
    ▼
 VIEWER              same page the renders come from; 53 acceptance checks of the page
    │
    ▼
 DISTRIBUTION BUILD  dist/ = viewer bundle + asset, verified from a sub-path   bun run dist   0.5 s
```

## Stages

Durations are from the project's timeline file (470 timed lines, 2026-11-23, 17:15–19:50 UTC) and from
the agent harness. They come from **one Apple M2 machine** and one run; treat them as indications.
"Agent" durations are wall-clock for one agent, including its reading time.

| # | Stage | Inputs | Outputs | Command or tool | Who | Duration (*measured*) |
|---|---|---|---|---|---|---|
| 1 | Evidence set | Original photos | 1500 × 2000 px working copies; rig instance per photo; 34 gridded crops with captions | Python scripts of the measurement agent (`gridcrop`) | measurement agent; person supplies photos | crops 2 s; study of the photos is part of stage 3 |
| 1b | Masked copies for the wiki | Original photos | 11 masked photos, contact sheet, captions; metadata removed | masking script with a region list | separate agent | 22 min (88 masked regions) |
| 2 | Camera from metadata; structure from motion | Photo metadata; photos of one rig | Focal length 1502.3 px; 3 cameras and 35 points in an arbitrary frame | pycolmap, run in the investigation phase and reused | script | 48 s for all photo subsets (*from the investigation report, not re-run*) |
| 3 | Edge traces, gauge, bundle adjustment | Stage 2, originals at full resolution | 9 deck edge traces; 3 cameras in the model frame; deck length; refined focal length | `snap.py`, `ba_B.py` | measurement agent + script | 13.5 min including reading the brief and writing the tools |
| 4 | Scale closure, Rig B measurements, cameras for other rigs, overlays | Stage 3 | Closure table; named points for stand, pods, seat, monitor, pedals; 2 more cameras; grid overlays that were looked at | `measure_*.py`, `pose_other.py`, `finalize.py` | measurement agent + script | 22 min |
| 5 | Dimension table and shape points | Stage 4 | `dimension-table.toml` (118 records), `shape-points.toml` (215 points), report | `make_table.py` | measurement agent + script | 12 min |
| 6 | Infrastructure and blockout | Build brief | Geometry kit, parameter loader, assembler, GLB writer, checks, render driver, viewer; first complete blockout (11,162 triangles, 48 meshes, 20 joints) | — | infrastructure agent | 46 min |
| 7 | Parameters, spec, component modules | Dimension table, shape points, crops, solved cameras | `params/<group>.toml`, entries in `spec/rig.toml`, `src/<group>.ts` | modeller's loop (see [agent process](agent-process.md)) | three modeller agents in parallel | round 1: 27, 36 and 41 min; round 2: 13, 14 and 15 min |
| 8 | Build | params + spec + src | `rig-b.glb`, `rig-b.manifest.json` | `bun run build` | script | median 0.13 s over 89 builds (0.09–0.38 s) |
| 9 | Checks | Build | pass/fail per check | `bun run check` | script | median 4.2 s over 20 full runs; 1.8 s with `--fast` |
| 10 | Renders | Build, solved cameras | PNG images | `bun run render --set …` | script | sheet 1.4 s; one photo-matched set 1.5–3.4 s; all five cameras 9 s; plus 0.3–0.5 s browser start |
| 11 | Independent review | Photos, the built GLB, brief sections on mission and budget | Verdict per component, findings with severity | reviewer's own driver and GLB reader | reviewer agent | round 1: 27 min, about 150 renders |
| 12 | Fixes | Findings | Next build | stage 7–10 again | modeller agents | see stage 7, round 2 |
| 13 | Viewer review and redesign | Viewer page | Two interaction reviews; new viewer; acceptance script | — | two reviewer agents, one implementer agent | 15 and 17 min; 62 min |
| 14 | Viewer acceptance | Viewer, build | 53 pass/fail results, screenshots | `bun tools/ui-accept.ts` | script | 114–125 s |
| 15 | Distribution build | Full build, viewer source | `dist/` (5 files, 1.68 MB), loaded once from `/rigtwin/` in a headless browser | `bun run dist` | script | 0.5 s |

Stages 1–5 are described in [Measuring from photos](measuring-from-photos.md); stage 7 in
[Filling gaps](filling-gaps.md), [Decomposition](decomposition.md) and the
[asset contract](asset-contract.md); stage 9 and 14 in [Checks](checks.md); commands in the
[tool reference](../80-reference/tools.md).

## What flows between stages

| Artefact | Written by | Read by | In the repository? |
|---|---|---|---|
| Solved cameras (`cameras.json`: 5 cameras) | measurement scripts | viewer on the local server only (photo-matched views), modellers | no (describes private photos) |
| Dimension table, shape points | measurement scripts | modellers, who copy values into parameter records with evidence text | no (working files); the values live on in the parameter files |
| Parameter files | modellers | parameter loader | yes |
| Spec | infrastructure agent first, then each modeller for its own nodes | assembler, checks | yes |
| Component modules | modellers | assembler | yes |
| GLB + manifest | `bun run build` | viewer, checks, independent reader, reviewer | no (`assets/*/build/` is ignored; rebuilt in 0.13 s) |
| Renders | `bun run render` | modellers, reviewer, coordinator | no; a few are copied under `wiki/img/` |
| `dist/` | `bun run dist` | deployment | no |

## Properties the pipeline is built to keep

1. **One editable authority.** Numbers exist only in parameter files; the tree only in the spec.
   The GLB and the manifest are compiled output and are never edited.
2. **Same input, same bytes.** Two builds give the same SHA-256 (check C-05).
3. **A value never looks better known than it is.** Every number carries a class (see
   [Filling gaps](filling-gaps.md)); the build counts classes and the viewer can colour parts by them.
4. **Nothing is silently missing.** Every node of the spec must be in the GLB or in an "omitted"
   list with a reason (check C-08). This exists because an early trial lacked the whole left
   armrest pod and joystick and nobody noticed.
5. **One renderer.** Agents and people look at pictures from the same viewer code.
6. **The builder does not grade its own work.** Scripts grade numbers; a separate reviewer grades
   likeness.

## Where the executed pipeline differs from the approved plan

Stated here so the diagram is not read as more than it is; the reasons are recorded on the
deviations page under `30-plan/`.

- No held-out landmark table scored against a frozen prediction table; the photo comparison was
  done by outline overlays and by the reviewer's eye.
- Photo-class parameters point to their measurement in free text. There is no machine-written
  measurement record per value and no build failure when such a value is changed.
- No person clicked points, and no human gate was held; a reviewer agent and the coordinator stood in.
- The measurement working files are not part of the repository.
