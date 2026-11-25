---
title: The person in the viewer
tldr: The designer-passed manikin runs in the product viewer as its own script, loaded after the rig is ready (still 0.25 s and 748 kB of scripts); the dressed operator sits in the real rig 0.6 s later. Shader changes are confined to its materials (the rig's pictures are identical to main's to the pixel); it idles at 30 frames a second only in a live view; a frame costs 10 to 15 ms against 3 to 4 ms for the rig.
status: draft
updated: 2026-11-25
tags: [viewer, manikin, implementation, rendering, performance]
---

# The person in the viewer

## TL;DR

- **What:** the lab's working manikin code, ported into `viewer/src/person/`: package loader, the body shape baked on the CPU from the survey controls, joint drivers, eight-influence dual-quaternion skinning, eyes, cloth pose, seat contact, styles, wardrobe and skin tones, and the seated-operator solver. The person sits in the real rig through the rig binding (`rig-binding.ts`, owner MV-rig).
- **The rig is unchanged.** No three.js shader chunk is changed for everyone; each person material patches its own shader. With the person loaded but not shown, the rig's 16 standard pictures (8 views in perspective and orthographic, a posed and selected rig) are identical to those of `main`: 0 of 20.7 million pixels differ.
- **Loading:** the page is ready in 0.21 to 0.25 s, with 748 kB of scripts before ready (budget 800 kB, test T10); the person's own script (250 kB) and the default package (about 10 MB: geometry, KTX2 textures, shape files) come after, with the line "Loading the person…", and the person shows about 0.6 s after the rig on this machine (test T10b).
- **Drawing:** the page still draws only on change. The person breathes, shifts and blinks only while shown in a live view, at most 30 frames a second; a still view (`ui=0`, scripts, the render tool) draws nothing and its pictures repeat exactly (test T44b).
- **Cost:** about 10 to 15 ms a frame at 1600 × 1000 on the M2 with the person idling (the rig alone 3 to 4 ms); its pose takes 0.4 ms of that, the rest is the GPU (skinning in the colour and shadow passes, the soft-shadow filter).
- **Not yet:** ambient occlusion on the person, the eye light, the designer's look in the product scene (phase 5). The person's controls and its credits line are [the person panel](person-panel.md) (phase 4).

## Where it lives

| File | What it holds | Ported from (work/avatar-lab/viewer/src/) |
|---|---|---|
| `index.ts` | the chunk's entry: loading line, default package from `version.json`, placement in the rig, idle ticker, `viewer.person` | new |
| `avatar.ts` | one person: loader (GLTFLoader with MeshoptDecoder and KTX2Loader), shape bake (raw or meshopt shape files), joint deltas, dof poses, drivers, styles, wardrobe, tones | `main.ts` class `Avatar` |
| `shaders.ts` | the person's shader patch: skinning, contact, soft shadows | `dqs.ts`, `contact.ts` (shader part), `studio.ts` (soft shadows) |
| `contact.ts` | seat pan and backrest rows, the sink map and roll field, capsules; the real cushion's profile | `contact.ts` |
| `materials.ts` | skin, eye, lash, cornea, hair, cloth, leather, rubber recipes | `materials.ts` |
| `operator.ts` | the seated-operator solver | `operator.ts` |
| `eyes.ts`, `cloth-pose.ts`, `plugins.ts` | eye movement and lids; cloth fold normal and correctives; the plug-in contract | same names |
| `params.ts`, `toml.d.ts` | the run-time numbers | new |
| `types.ts` | the interface with the rig binding | new |
| `rig-binding.ts` | targets, placement and contact planes from the rig's own points | MV-rig's |

`main.ts` imports `person/index.ts` only after the page is ready; `tools/bundle.ts` splits the build into `viewer.js`, the chunk it shares with
the person code (three.js and the engine) and the person chunk. `tools/serve.ts` and `tools/dist.ts` serve `assets/manikin/` at
`asset/manikin/` and three's KTX2 transcoder at `libs/basis/`; `version.json` names the default package when the release carries it.

## What was ported, and what was left out

Ported in behaviour unchanged: the loader and shape bake, joint deltas and inverse bind matrices, the twist and corrective drivers with the
sign-safe reading (a joint rotation with w < 0 is read as the same rotation), eight influences per vertex, dual-quaternion skinning mixed by
the `_DQS` mask, the B5 eyes (saccades, vergence, blinks, lids riding over the cornea, lid-shadow planes), the cloth fold normal and the
trouser correctives, the seat contact of round 7 (pan solid, sink map, the displaced tissue rolled back out), capsules, the skin recipe with
its wrapped terminator and per-tone clear coat, the hair, lash and cloth recipes, the wardrobe with per-pixel body masks (the glasses and
headset can be taken off, the cap cannot), and the seated-operator solver. The solver was checked against the lab's on the rest skeletons
of operator-m and operator-f over 2,400 frames of two scripts, with and without a person's fit: the largest difference in any joint
rotation or the pelvis position was 4 × 10⁻¹⁶.

Changes forced by the product: one contact texture per person instead of one shared through every three.js material; the operator's gaze
point handed to the eyes directly, not through a global; the person's materials take the rig's key light and its shadow map, with the light's
size and the map's frustum as their own uniforms (so the rig's light keeps its settings) and a 1.5 mm shadow offset of their own (the rig's
12 mm one drew a fringe along every contact in the lab); the clay figure is its own package (`clay-m`, `clay-f`), so "clay" swaps packages and
keeps the body controls; the seat contact follows the real cushion's centre-line profile from the rig binding instead of one flat slab.

Clips were ported afterwards (the coordinator's decision of 2026-11-25): loaded on demand from `assets/manikin/clips/`, the take baked for
the body preferred, sampled at a time in a still and played in a live view, with the same sign-safe drivers after them; the relaxed stand
(`RELAXED_STAND`, clip `idle-stand` at 1.0 s) and the walk come this way. Left out: the lab's debug views, the plain stool, the stand-in props (the real rig is drawn), several people at
once, the lab's studio lights and post-processing chain (presentation, not the person's look), ambient occlusion (the lab's GTAO pass works
on the whole picture and would change the rig's; not cheap to confine), the eye light (a rectangular light in front of the face would light
the rig too; the eye's own catch light remains), the procedural iris for an eye without the B5 marker (no package has one).

## The rig looks exactly as today

Every shader change is installed per material (`onBeforeCompile`): skinning, contact, the skin, eye, hair and cloth recipes and the shadow
filter. `THREE.ShaderChunk` and `THREE.ShaderLib` are read, never written; the depth material of each person mesh is its own. The proof
(`work/mv-core/pixels.ts` and `compare.ts`, not committed): `main`'s viewer (`git archive` of 67e22d9) and this branch with `person=off` (the
person code and the default package load, nothing is shown), headless Chromium, 1440 × 900, eight views in perspective and orthographic
projection plus a posed rig with a selection: **16 pictures, 20,736,000 pixels, 0 differ.**

## Loading and drawing

| | Measured (M2, local server) | Budget |
|---|---|---|
| Page ready | 0.21–0.25 s | ≤ 1 s (T10) |
| Scripts before ready | 748 kB in 2 files (was 745 kB in 1) | ≤ 800 kB (T10) |
| Person's scripts after ready | 308 kB (person chunk 250 kB, KTX2 transcoder 58 kB) | ≤ 400 kB (T10b) |
| Bytes after ready | 10.3 MB in 18 requests (dressed man, light tone) | MP's 10 MB target |
| Person shown | 0.63 s after the page was ready | ≤ 6 s here (T10b) |
| Package load, binding, shape bake | 0.31–0.36 s, 2.5–47 ms, 18 ms | — |

Idle motion runs only while the person is shown in a live view, at most `[runtime] idle_fps` = 30 frames a second, measured 30.0 (T44b).
A still view poses the person at a fixed time (`still_time` 0 s for the solver, `eye_still_time` 1 s for the eyes, the packet's seed) and
draws nothing until something changes; two pictures 1.5 s apart are identical. With the person hidden the page draws nothing at rest, as
before (T44, now run with `person=off`).

## Frame cost with the person shown

`viewer.person.bench(n, { idle })`, 1600 × 1000, default view, each frame finished with a one-pixel read, median of 90 frames:

| | Rig alone | Person still (camera moving) | Person idling (pose, contact and shadow map every frame) |
|---|---|---|---|
| Run 1 | 4.5 ms | 14.9 ms | 14.8 ms |
| Run 2 | 3.3 ms | 9.5 ms | 9.9 ms |
| `bun run check` | — | — | 15.4 ms (153 draw calls) |

The person's pose update (solver, drivers, contact rows, eyes) is 0.4 ms of a frame; the rest is the GPU. The machine was never idle
(other agents ran), so the spread is load, not the method. At 30 idle frames a second the person takes about a third of the GPU.

## Run-time numbers

Every number the person code uses is a record of `assets/manikin/params/runtime-person.toml` (445 records: value, unit, range, class, tier,
evidence), read through `params.ts`; the bundle carries only the values and refuses an incomplete record, and `bun run check` validates every
`runtime*.toml` (MV-rig's `runtime-rig.toml` too). What stays in the code is arithmetic (halves, unit vectors, epsilons, indices) and the
eye model's own method constants.

## Script interface

`viewer.person`: `ready` (a promise), `state()`, `definition()` (controls, presets, tones, wardrobe slots, clips, poses, licences),
`show(on)`, `set({ sex, style, tone, wear, shape, pose, script, clip, time })`, `place({ origin, yawDeg } | null)` (off the seat, model frame),
`anchor(name)` (model frame), `pickAt(x, y)`, `object()`, `still(on)`, `bench(n, { idle })`. Every change raises the window event
`rigtwin:person` with the state. A swap of package (sex, or the clay figure) keeps the tone, what is worn and the pose; another sex takes
the new package's default body unless a shape comes in the same call. URL: `person=0` (no person code), `person=off` (loaded, not shown), `person=<manifest url>`, `person_style`,
`person_sex=m|f`, `person_tone`, `person_wear=glasses:none,headset:none`, `person_shape=<preset>`, `person_idle=0`. The render tool and the rig's checks use
`person=0`: the rig's documentation pictures stay pictures of the rig.

## The designer's packet in the product (phase 5)

`tools/person-packet.ts` renders the designer's fixed shot list (`work/avatar-lab/VD/review-packet.json`, with the designer's own
corrections) in this viewer: the real rig, the product's light, tone curve and exposure, one frozen build of the viewer for the whole
run, no shared scene. Same shot ids, persons (F05, M50, M95H, M50_HEAVY, F50_HEAVY, M50_THIN, F50_THIN), azimuths, distances and lenses.
Seated shots use the operator layer on the rig binding; standing shots put the person beside the rig on the side where the product's key
light falls as the lab's studio key did, and turn the figure for each azimuth (the rig stays behind it). Line-ups become series (one
person at a time); the lab's grey "clay" mode becomes the clay figure; wire, checker and the 40 mm cylinder are skipped with the reason.
Extra product views: the default view, the operator's eye view, front, left.

```
bun tools/person-packet.ts --quick --self-test --run quick-01      # the early-gate list, about 50 images
bun tools/person-packet.ts --run full-01                            # everything; --only F,P1  --persons M50,F05  --styles clay  --tones dark
```

Output: `<main checkout>/work/manikin-v1-packets/<run>/` with `shots/`, `sheets/` (the lab's sheet style), `manifest.json` (camera per
image in the model frame, what the rig hides of the person, skipped shots) and `metrics.json` (the person's vertices read back on the CPU
against every rig part's triangles: penetration by part and body region; hands against the real levers; shoes against the pedals; the eye
against the survey; the binding's findings; frame time per shot set). `--self-test` renders three shots alone and twice inside the run
and compares every pixel by the lab's rule (more than 2 of 255 counts).

What the tool found that the person module should fix: a still picture could depend on the shot before through the seat contact's
sink map (its time-based shortcut keeps or reads back asynchronously a map made just before); the tool clears that map before each
seated shot. `viewer.person.pickAt` raycasts with three's skinning, which reads only the first four of the eight influences (up to
190 mm off on this package).

## Fixes from the product review packet (MPK, 2026-11-25)

| Found | Cause | Fix | Check |
|---|---|---|---|
| After a change of body the person sat 31–67 mm too low or high | the rig binding used the previous body's solver | `rebind()` rebuilds the solver whenever the body's rest key changed | T10c: 0.00 mm (38–68 mm with the old code) |
| The operator's view sat 39–77 mm inside the person's head | the camera stayed on the rig's own eye point | with a person seated the view takes the person's own eye (engine `hooks.operatorEye`) and does not draw what is worn on the head | T10d: 0.00 mm from the eyes, nothing of the person within 25 cm on the line of sight |
| A still could show the previous shot's seat sink map | the sink map's moving-body shortcut ran in stills too | a still always draws and reads the map at once | T10e: the first still after a change = the same still again |
| Standing faces stared at the rig's screen | the eyes kept the seated gaze point | cleared when the operator layer does not drive the body | T10f |
| Picks up to 190 mm off | three's raycast skins with four influences | picks on the vertices as the person's shader skins them (`Avatar.skinnedPositions`) | T10g: median 0.08 mm against the depth the shader draws |
| Shoes 8 mm under the floor when standing | takes not grounded | the lower foot joint at its rest height for standing clips and poses | T10h: 0.0 mm |
| Hand skin 8–11 mm inside the levers | the solver held a 40 mm cylinder | on the real handle (`targets.grip.profile`, `hold`): the palm on the handle's surface at the middle of the hold section, its skin below where the button head widens; each finger's three joints solved together against the profile at their own height; the thumb opened until it clears; the lab's behaviour unchanged without a profile | T10i: at most 1.6 mm (P5 woman, P50 man, P95 man, both hands) |

**Grip, a finding (facts, no standard claimed):** the handle at the hold is 70 mm across (220 mm round). Held there, the middle finger wraps
116° (P5 woman, hand breadth 75 mm, length 171 mm), 124° (P50 man, 89 mm, 194 mm) and 133° (P95 man, 92 mm, 205 mm) round it, and the
middle fingertip stays 76, 67 and 59 mm from the thumb tip: for all three the handle is thicker than a full power grip can close around.

## Open problems

- The designer has not seen the person in the product scene: the lights, the tone curve and the exposure are the rig's, not the lab's.
- No ambient occlusion on the person; folds and contact lines are flatter than in the lab.
- Done in phase 4 ([the person panel](person-panel.md)): the credits line for the CC-BY garments is on the page and in saved pictures. Clicking the person selects it and opens its panel.
- Dark facets at the hip in close seated views: the trousers' waistband passes through the shirt (it goes when the trousers are hidden and
  stays with the contact, the body and the lighting changed), so it is the garments' layering at seated hip flexion in the package, not
  the port and not the lighting; to be confirmed in the lab at the same pose.
