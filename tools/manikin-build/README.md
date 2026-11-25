# tools/manikin-build: how the manikin packages were made (for the record)

**Mac only. Never run on the deployment machine.** The deployment pipeline (Bun on Linux) only serves the committed
packages under `assets/manikin/`; nothing here runs there, and `bun run check` only verifies the committed files
against their checksums (`PROVENANCE.json`) and budgets (`assets/manikin/params/packaging.toml`).

Two stages:

1. **Build** (the avatar lab's code, copied here): the MakeHuman body, the survey-fitted shape space, the game-style
   rig, eyes, garments, props, hair, cloth folds, the clay style and the motion clips, written as the lab's
   uncompressed packages (`work/avatar-lab/packages/`). Python, Blender, PyTorch, the open downloads; hours.
2. **Pack** (`pack.ts`): the passed lab packages compressed into the product packages (meshopt geometry, KTX2
   textures, quantised shape files, tones as texture sets, shared clips and maps), with provenance and budgets; a
   minute. `compare.ts` then renders the designer's key shots from the lab and from the packed copy and compares them.

## What it needs

| Need | Version used | Where it comes from |
|---|---|---|
| macOS on Apple silicon | macOS 26, M2 | |
| Python | 3.11, with numpy, scipy, Pillow, torch, and anny 0.6.2 (Apache-2.0) for the shape fit | a virtual environment of your own; name it in `MANIKIN_PYTHON` |
| Blender | 5.2.4 (GPL-3.0-or-later, build tool only) | blender.org; the lab keeps it in `work/avatar-lab/tools/Blender.app` |
| The open downloads | as logged with URL, size, SHA-256 and licence in `work/avatar-lab/downloads/MANIFEST.md` | MPFB2 2.0.18 (MakeHuman hm08 data, CC0), MakeHuman asset packs (CC0, CC-BY 4.0), CMU motion capture, Poly Haven fabrics (CC0), SOMA-X assets (Apache-2.0; only for the corrective trials) |
| The ANSUR II public survey files | 2012 release | `private/ansur2/` (never committed); only the shape fit reads them, and no survey row reaches a package |
| Bun | 1.4 | for `pack.ts`, `compare.ts` |
| KTX-Software toktx | 4.4.2 (Apache-2.0) | the official macOS release, unpacked without installing into `work/tools/ktx/` (see the downloads manifest) |
| glTF-Transform, meshoptimizer, sharp | 4.5.1, 1.1.1 (MIT), 0.35.5 (Apache-2.0) | this folder's own `package.json` and `bun.lock`: run `bun install` in `tools/manikin-build/` first. The repository root does not install them, so the deployment runner never does |

## Paths (no absolute path is in the code)

| What | Default | Override |
|---|---|---|
| The lab's working data (downloads, builders' caches, packages) | `<repository>/work/avatar-lab` | `MANIKIN_LAB`, or `"lab"` in `tools/manikin-build/config.json` (relative to the repository or absolute; a local file, ignored by git) |
| Python | none | `MANIKIN_PYTHON` (the scripts' usage lines say `$PY`; set `PY=$MANIKIN_PYTHON`) |
| toktx | `<repository>/work/tools/ktx/bin/toktx` | `MANIKIN_TOKTX`, or `--toktx` |

The copied scripts read the lab root through `pipeline/labpaths.py` (`__import__("labpaths").LAB` where the lab's own
code computed it from its file location). `SOURCES.json` lists every copied file with the SHA-256 of the lab
original and whether a path was rewritten; nothing else was changed. Run from a worktree, point `MANIKIN_LAB` at the
main checkout's `work/avatar-lab`.

## Stage 1: build (the lab's commands)

`pipeline/README.md` is the lab's own record of every module, its owner and round, in full. The packages in
`assets/manikin/` were built by, in this order (`PY=$MANIKIN_PYTHON`, from the lab folder, which holds `pipeline/`):

```
$PY -I shape-fit/fit.py m 256 50 250 ; $PY -I shape-fit/space.py m 40 ; $PY -I shape-fit/export.py m   # the shape space (and f): RP/packages/rp-<sex>-v2
$PY -I pipeline/build_body.py                                            # packages/body-clay, body-clay-f (rig, weights, eyes, shape file)
$PY -I pipeline/motion.py build --package packages/body-clay             # clips baked per packet person (and body-clay-f)
$PY -I pipeline/motion.py bake  --package packages/body-clay ; $PY -I pipeline/motion.py stand --package packages/body-clay --also packages/abstract-m
$PY -I pipeline/build_body.py --merge-motion
$PY -I pipeline/abstract.py                                              # packages/abstract-m, abstract-f: the clay figure (REVIEW-08)
tools/Blender.app/Contents/MacOS/Blender -b -P pipeline/prop_model.py -- headset belt collar shoes   # the props' sources
$PY -I pipeline/cloth.py prep ... ; cloth_sim.py ... ; cloth_bake.py ...   # the cloth folds: pipeline/README.md, "Cloth form", "Run it" (rounds 1 to 3)
$PY -I pipeline/build_operator.py m light ; $PY -I pipeline/build_operator.py m medium --name operator-m-medium --out packages/operator-m-medium
$PY -I pipeline/build_operator.py m dark --name operator-m-dark --out packages/operator-m-dark     # and the same for f: the dressed operator (REVIEW-10)
```

Each package's `PROVENANCE.json` names the lab package it came from, the SHA-256 of every lab file read, and the
repository revision at packing time (the lab itself is not under version control).

## Stage 2: pack

```
(cd tools/manikin-build && bun install)                                  # once: glTF-Transform, meshoptimizer, sharp
MANIKIN_LAB=<main checkout>/work/avatar-lab bun tools/manikin-build/pack.ts [--only operator-m,clay-f] [--no-clips]
MANIKIN_LAB=<main checkout>/work/avatar-lab bun tools/manikin-build/compare.ts [--runs dressed,tones,clay]
bun run check                                                            # checksums, budgets, licences, names, symlinks
```

`pack.ts` writes `assets/manikin/<package>/` (manifest, GLB, shape files, side maps, tones, `PROVENANCE.json`),
`assets/manikin/clips/<sex>/` and `assets/manikin/shared/maps/`, and stops if a budget is broken. What it changes
against the lab packages, and why, is in the asset contract (`wiki/40-method/asset-contract.md`, "Character
assets"); every number is a record in `assets/manikin/params/packaging.toml`. `compare.ts` stages a lab-format copy
under the lab checkout's `work/manikin-compare/` (the lab viewer reads only `work/`), renders the designer's key
shots C1, B1, F1 and F5 from both with `work/avatar-lab/viewer/packet.ts`, and writes `report.json` with the
pixel differences and difference images.

## What is not here

- The lab's caches and outputs (B1 to B9, RP, RR folders, `pipeline/pc_data/`): working data under `work/`.
- The builders' one-off probes, sheets and checks (`B2/kit_*`, `B5/eye_*`, `RR/*`): they inspected the packages
  and did not produce them.
- The lab viewer and packet renderer (`work/avatar-lab/viewer/`): the product viewer's person module is its port.
