---
title: Options considered
tldr: Every significant option that was weighed, in tables per topic, with the evidence behind it (tested on the machine, desk research or judgment), the verdict and the reason. The chosen route is an agent writing parametric generator code in TypeScript with three.js, delivered as a GLB plus a description file.
status: stable
updated: 2026-11-23
tags: [decisions, options, stack, measurement, viewer, process, naming]
---

# Options considered

## TL;DR

- **Route:** automatic reconstruction was tested and failed on these photographs (35 points, almost none on the rig). The accepted route is reference-guided parametric code: an agent reads the photos and writes parameters and generator code.
- **Stack:** two hands-on trials each built a working articulated blockout in under half an hour. TypeScript with three.js was chosen over Blender-as-a-library for speed (0.07 s against 1.1 s per build), size (50 MB against 781 MB) and licence.
- **Format:** one GLB model file plus one JSON description file. No ratified glTF extension carries joint limits, so a custom description is unavoidable.
- **Process:** an independent reviewer and scripted checks were accepted; an agent watching the builder think was rejected. Human gates were accepted in the plan and replaced by reviewer rounds for this run.
- **Name:** twelve candidates and a list of rejections; the owner rejected the shortlist and chose a first name from a later list; on 2026-11-25 the owner replaced it with Synergon ([D-56](decision-log.md#d-56)).

## How to read the tables

- **Evidence** says how the statement is known: *tested* (run on the project machine, an Apple M2 with 16 GB and no NVIDIA graphics card, on the real photos), *desk research* (read in documentation, registries or papers on 2026-11-23), *judgment*, or *not verified*.
- **Verdict** is one of: accepted; rejected; deferred (with what would trigger it); optional (with its trigger).
- Decisions are recorded formally in [decision-log.md](decision-log.md); this page gives the breadth behind them. The research reports are summarised in [../80-reference/sources.md](../80-reference/sources.md); their full texts are kept in the project's private archive.
- Photographs are referred to by number, as in the file names under `img/photos/`. Rig A is in a van, Rig B is the reference rig, Rigs C1 and C2 stand in a control room.

## 1. Route from photographs to a 3D model

| Option | What it is | Evidence | Verdict | Reason |
|---|---|---|---|---|
| Dense photogrammetry | Software finds matching image features across many overlapping photos, solves the cameras and builds a dense surface | *Tested* (structure from motion on CPU, 48 s for all photo subsets): cameras found for 3 of 3 Rig B photos and 3 of 6 control-room photos, but only 35 3D points for Rig B, almost all on the floor, wall outlets and window frames, and 186 for Rig C1, almost all on the picture shown on the monitor. *Desk research:* the dense stage needs an NVIDIA card | **Rejected** as the modelling route. **Accepted** in sparse form as a camera-solving aid | White shells, black leather and dark screens give no features. Two or three photos per rig. Even a perfect capture gives one fused surface with no parts, parameters or joints |
| Learned multi-view geometry | A neural network predicts cameras and per-pixel depth from a few photos | *Tested* (a small openly licensed model, 541 MB, 18 s on CPU for three photos): camera rotations agree with the classical solve within 0.5–2.1°; depth ratios on a known screw pattern were off by 9 % up to a factor of 3.6; 11.8 % median depth disagreement between views; focal length over-estimated by 10–13 %. *Desk research:* most models of this kind carry non-commercial licences | **Optional**, as a second opinion on camera poses when feature matching fails. **Rejected** as a source of geometry or dimensions | Coarse, not parametric, no parts; most are not open source |
| Single-image metric depth | A network estimates depth in metres from one photo | *Desk research* only; published errors range from about 3–7 % on favourable benchmarks to 19–43 % in a 2026 embedded benchmark. Not run | **Deferred**: use only for a future asset with no object of known size in any photo | Photo metadata plus one known-size object in view is more defensible and needs no extra software |
| Generative image-to-3D | A network produces a 3D mesh from one or a few images | *Desk research:* none claims dimensional fidelity; output is one fused mesh in a normalised box with invented backs; the good open ones need an NVIDIA card with 24 GB or more; several are not open source. Not run | **Rejected** | No scale, no structure, fails the open-source and hardware constraints |
| Neural radiance fields, Gaussian splatting | A scene representation trained from many posed photos | *Desk research* and recall: needs dense captures (typically 50–300 images); the result is not a mesh with parts | **Rejected** for modelling. Possible later as a photoreal backdrop if a video orbit of a rig is captured | Three views per rig; glossy surfaces |
| A human 3D artist | A person models the rig by hand in a modelling application | *Judgment:* would produce a better-looking rig faster | **Rejected** as the method. **Optional** for a presentation-quality shell placed under the same node, which would then no longer follow the parameters | Does not deliver the parameter file with sources, the joints and reference frames, a rebuild when measurements arrive, or a method an agent can repeat |
| **Reference-guided parametric code** | A program turns named numbers into geometry; photos are used to decide the decomposition, to estimate the numbers and to check the result | *Tested* by two hands-on trials (section 5) | **Accepted** | Modular and adjustable by construction; text source; works with photos of several rigs because it models the product, not one captured object |
| Solving parameters and cameras together | An optimiser fits model parameters and camera positions to all picked points at once | *Not tested* | **Deferred** until manual correction proves too slow | Not needed for a first asset |

## 2. Isolating the rig from the background

| Option | What it is | Evidence | Verdict | Reason |
|---|---|---|---|---|
| **No isolation; crops with a pixel grid** | The agent looks at zoomed crops per component, overlaid with a coordinate grid, and picks points on them | *Tested:* this is how all measurements were made | **Accepted** | Nothing is extracted from pixels; the agent reads the photo and writes geometry |
| **Keep the background** | Floor texture, wall outlets and window lines stay in the image | *Tested:* they are what fixed the camera positions for Rig B | **Accepted** | Cutting the rig out would make camera solving harder |
| Segmentation masks | A tool outlines the rig (a classical cut-out seeded by a box, or a small open segmentation model of about 75 MB) | *Desk research.* Not run | **Optional**: only if silhouette overlap is adopted as a measure | A mask adds no metric information |
| Silhouette comparison | Compare the outline of a render with the outline of the rig in the photo | *Judgment* | **Optional**, second-best to point comparisons; not in the core method | Point comparisons are more informative and need no mask |
| Masking for privacy | People, live screen content and names blurred, location metadata removed | *Tested* for the published images | Plan: **accepted** for everything agents see. Run: kept **for published images only** (owner: confidentiality is no concern); see [../30-plan/deviations.md](../30-plan/deviations.md) | Protects people and third parties |
| Masking screens for camera solving | Blank the screens before feature matching | *Tested* indirectly: the Rig C1 camera solve rests almost entirely on the picture shown on its monitor, which may have been live video | **Accepted** as a rule | Changing screen content corrupts matching |
| Keep rig instances apart | Solve cameras separately for each physical rig | *Tested:* photos of different rigs matched each other (26, 18 and 19 verified matches in three pairs) | **Accepted** | Pooling would corrupt the solve |

## 3. Estimating scale and sizes

| Option | What it is | Evidence | Verdict | Reason |
|---|---|---|---|---|
| **Camera data from photo metadata, held fixed** | Focal length taken from the file's metadata | *Tested:* letting the solver estimate it gave 1328–3090 px against 1502 px from metadata; reprojection error was lowest at the metadata value (0.32 px) and rose to 0.56–0.59 px at ±10 % | **Accepted** | Self-calibration is unreliable on this photo set |
| Vanishing-point camera solve | Orientation from parallel edges | *Tested* in part: ill-conditioned when lines are placed by eye; a free focal-length fit diverged | **Rejected** | The scenes lack three well-seen families of parallel lines |
| **Two-view triangulation, operator's-eye photo with a rear photo** | A point seen in two photos from clearly different directions is located in 3D | *Tested:* sight-lines meet at 20–34° on the shelf; six held-out points predicted within 0.7–3.4 px (image height 2000 px) | **Accepted**; class "two-view" | The only strong pair for Rig B. The test covered one flat feature in the best-covered zone |
| Two-view triangulation, the two rear photos | The same, using photos 2511 and 2530 | *Tested:* taken about 26 cm apart at more than 2 m; median triangulation angle 2.2° | **Rejected** as a pair; they count as one viewpoint | Depth is barely constrained |
| **One sight-line plus an assumption** | A point on a known plane, on the symmetry plane, or on a vertical of known length | *Tested:* good near its scale reference; one height moved from 660 to 700 mm across the plausible camera pitch | **Accepted**; class "single-view", range at least ±10 % | The only route for parts seen from one direction (seat, backrest, pedals) |
| Proportion judged in a photo | A ratio read by eye, sometimes on another rig | *Tested* once (crude, ±8–12 %); the audit found no script or pick file for it | **Accepted** only as class "by-eye", with no coverage claimed | Cannot be reproduced or checked |
| Purchased parts as scale references | Known sizes from vendor drawings (pedal unit, soundbar, monitor height) | *Tested:* two references disagreed by about 7 % in one consistent camera frame | **Accepted with a closure step**: all references must agree within 3 % before modelling | A single reference cannot reveal its own error |
| The owner's figures as scale | Platform 1.5 m wide, given by the owner after the plan | *Tested* in the build: with the deck width set to 1.50 m the soundbar measures 0.411 m against 0.410 m from the vendor, and the scale closes within 0–2 % | **Accepted**; see decision D-24 | Resolved the 7 % conflict: the pedal reference had been read off the wrong element |
| A method's own error bar | Simulated picking noise | *Tested:* gave ±45 mm where the real error was about 115 mm | **Rejected** as a range | Only a second, independent derivation reveals the error; the range must cover the disagreement |
| Agent-picked points | The agent reads pixel positions off gridded crops | *Desk research:* published tests show models pointing to the same physical point in two views correctly 5–16 % of the time, against 94 % for people. *Tested here:* 0.7–3.4 px on one feature | **Accepted** when every pick is checked by a geometric residual | Works on distinctive features; unproven elsewhere |
| Points clicked by the owner | About forty clicks on a simple page | *Not tested* | Plan: **accepted**. Run: **not used** (see deviations) | Would give hold-out points no builder has touched |
| A tape measure on site | Ten to fifteen readings, each photographed with the tape in frame | *Judgment:* "beats every algorithm" in the research | **Requested**; three owner figures arrived, no tape session | The only route to verified sizes |

## 4. Authoring stack

| Option | What it is | Evidence | Verdict | Reason |
|---|---|---|---|---|
| Blender as an application | The modelling program, driven by hand, by script or through a live-session agent connector | *Desk research:* system-level install; its file is binary and cannot be compared between versions; a live session is not reproducible | **Rejected**; not installed | State lives in a session; nothing can hold a source and range per value |
| Blender as a Python library | The same engine installed as a Python package, no window | *Tested* (trial A, section 5): works; 781 MB; tied to one exact Python version per release; GPL licence; interface changes between releases | **Rejected** as the foundation; not installed. **Optional** later for presentation images or bevels | It was not what made the trial asset parametric or articulated. For the seat the missing ingredient is evidence, which no tool supplies |
| **TypeScript with three.js, run by Bun** | Geometry built in code with the same library the viewer uses | *Tested* (trial B, section 5): rebuild 0.07 s; 50 MB; MIT licence | **Accepted** | Fastest loop, smallest install, one library for generator and viewer. Weaknesses: no solid-modelling kernel, so shaped parts are hand-built; it writes invalid geometry without an error, so independent checks are mandatory |
| Native Python mesh stack | numpy, manifold3d, trimesh and Pillow | *Tested* as a small check: 44 MB; five sample parts built in 1.3 s; a 31 kB GLB with hierarchy and metadata written and read back | **Rejected** for the generator; the solid kernel kept in the plan for independent checks | Recommended by the toolchain report, but not shown to be better, and a second language away from the viewer |
| Code CAD on OpenCascade | Exact solid modelling in Python (build123d; CadQuery shares the kernel) | *Tested* as a probe on the backrest: 573 MB and 58 packages; a loft made a valid solid in 0.04 s; a rim fillet failed at 12, 8 and 5 mm and succeeded at 3 mm; hollowing failed after the fillet; STEP export worked | **Optional**: when the client supplies or asks for STEP files | Exact solids are false precision for photo-derived sizes; the kernel is fragile exactly on organic forms |
| OpenSCAD | A scripting language for solid shapes | *Desk research:* last stable release 2021; no named hierarchy, metadata, joints or glTF output | **Rejected** without installing | Every requirement beyond raw shape would have to be built outside it |
| Other code-CAD and distance-field libraries, FreeCAD without a window | — | *Desk research* | **Rejected** | No advantage over the options above |
| Node graphs inside Blender as the parametric layer | Parameters live as inputs of a node tree in the Blender file | *Desk research* and trial A | **Rejected** | Harder for an agent to write and read back than code; no source or range per value |
| The Leitbild project's native model | The owner's earlier 3D source model and renderer | *Read, not executed:* no joints, hierarchy, materials or glTF output; the renderer is tied to a map | **Rejected** for code. Practices **accepted**: one editable authority, an independent reader of exported geometry, negative controls, keeping a self-check distinct from an independent check, a "not qualified for" list | Built for buildings on a map, not articulated products |

## 5. The two hands-on trials

Both trials were given the same brief (seven requirements: single parameter source, one-command
deterministic rebuild, model file with metadata that an independent reader can re-read, rendering
without a window, a parameter change, a photo comparison loop, posing at run time) and guessed
sizes. All numbers are *tested* on the project machine.

| | Trial A: Blender as a Python library | Trial B: TypeScript with three.js |
|---|---|---|
| Result | All seven requirements passed, three with caveats | All seven passed, the photo comparison with reservations |
| Model built | 47 named nodes, 8 joints, 4 reference frames, 23 meshes, 8,082 triangles | 56 nodes, 9 joints, 4 reference frames, 27 meshes, 15 components |
| Parameters | 143 entries in one file | 117 parameters in one file |
| Build time | about 1.1 s | 0.07 s |
| Render time | about 0.35 s per 1200 px frame | 30–90 ms per 1200 × 900 frame |
| Identical output on rebuild | Yes, after replacing one non-deterministic operation | Yes |
| Disk | 781 MB (the Blender package alone 724 MB) | 50 MB of packages, plus a browser build already on the machine |
| Generator size | 526 lines | 657 lines |
| Photo comparison | 6 iterations; placing the camera by hand did not converge, a four-landmark solve did | 5 iterations with a hand-matched camera |
| Seat shape | A smooth tapered shell; "clearly not the real seat shell" | A smooth lofted shell; "one featureless surface" |
| Licence | GPL-3.0 | MIT |
| Agent time and tokens | 29.6 min; 272,693 tokens | 24.1 min; 270,714 tokens |

What the trials did **not** show, found by the later reviews:

- Neither produced a convincing seat shell, pod fairing or joystick head. Both built the seat as a smooth blended surface, which is the wrong kind of shape for an angular, faceted shell.
- Neither model had a left armrest pod, pedals, a soundbar, a monitor arm, a key switch or panel buttons. The owner later noticed the missing left joystick; see decision D-25.
- Six dimensions were first written into the code of trial B instead of the parameter file. An invalid curvature produced a broken file with no error; only the format validator caught it (17,882 errors).
- The trials used different axes, file formats and joint conventions from the ones the plan then fixed, so their code was a demonstration, not a base to extend.

## 6. Source of truth

| Option | What it is | Evidence | Verdict | Reason |
|---|---|---|---|---|
| **Text parameter files plus generator code** | Parameters in TOML, one record per value; code compiles them to the asset | *Tested* in both trials | **Accepted** | Can be compared between versions and read by an agent without opening a tool; each value can carry unit, source and range; reproducible |
| A Blender file with drivers or node graphs | The model lives in the application's own file | *Desk research* | **Rejected** | Binary, tied to an application version, no place for a source per value. A side file would be needed anyway and would then be the real source |
| A CAD document | A FreeCAD file or STEP as the master | *Desk research* | **Rejected** | Same objections; exactness the evidence does not support |
| YAML for parameters | — | Trial B used it | **Rejected** in favour of TOML | Implicit typing is a known source of silent errors |

## 7. Delivery format

| Option | Keeps hierarchy | Keeps joints and limits | Keeps sources, frames, parameters | Evidence | Verdict | Reason |
|---|---|---|---|---|---|---|
| **GLB plus a JSON description file** | Yes | In the description file | In the description file | *Desk research:* every candidate consumer (three.js, Babylon.js, Godot, Bevy, Blender) reads GLB; no ratified glTF extension carries joint limits. *Tested:* only three.js | **Accepted** | Smallest robust answer; the description can be compared between versions and read without parsing a binary |
| Metadata only inside the GLB | Yes | As free-form extras | As free-form extras | *Tested:* one library dropped the extras on re-reading | **Rejected** as the only home | Tools differ in how they expose extras |
| OpenUSD | Yes | Yes | Yes, as custom attributes | *Desk research:* heaviest toolchain; weak browser and open game-engine support | **Rejected** as the master; revisit if a simulator requires it | Solves problems this project does not have |
| URDF, MJCF (robotics formats) | Link tree only | Yes | No | *Desk research* | **Deferred**: derived on request when a physics engine asks | Would lose parameters, sources, frames and materials |
| STEP | Assembly tree | No | No | *Desk research;* export tested in the CAD probe | **Deferred**: when the client's engineers ask | Needs a CAD kernel; no joints |
| Per-component OBJ meshes | — | — | — | *Judgment* (review finding) | **Accepted** in the plan as an extra export | Kinematics and physics libraries read it; cheap now, costly to retrofit |

## 8. Viewer

| Option | Evidence | Verdict | Reason |
|---|---|---|---|
| **three.js as a static page** | *Tested* by prototype (152 lines of script, 28 of page): load, tree with show and hide, joint sliders with limits, click to identify, measuring, named views, screenshots; runs without a window and without a graphics card; seven library files, 2.36 MB | **Accepted** | Least material; the same page serves as the agent's renderer |
| Babylon.js with its inspector | *Desk research:* about 11.5 MB without a build step; inspector gives a scene tree and property editing for free; already used in the Leitbild project | **Rejected**; a legitimate second choice | About five times the bytes; joint sliders and description-file logic would still have to be written |
| The `model-viewer` web component | *Desk research:* a drop-in turntable; no documented way to move nodes, show a tree or pick parts | **Rejected** as the inspector; fine later for embedding a preview | Too limited |
| Other viewers (Online3DViewer, PlayCanvas, A-Frame, the Khronos sample viewer, three-gltf-viewer) | *Desk research* | **Rejected** | No joints or reference frames; no advantage |
| Viewers excluded on licence (Needle Engine, xeokit) | *Desk research:* not open source, or AGPL | **Rejected** | Open-source constraint |
| React or Svelte wrappers around three.js | *Desk research:* need a framework and a bundler | **Rejected** | Violates "few dependencies" |
| A game engine exported to the web | *Desk research:* tens of megabytes | **Deferred** to the simulator phase | Too heavy for inspection |
| The Leitbild renderer | *Read* | **Rejected** | Tied to a map |

| Viewer language | Evidence | Verdict | Reason |
|---|---|---|---|
| Plain JavaScript with no build step | Recommended by the viewer research ("serve the folder"); the first build used it | **Superseded** | The owner asked why it was not TypeScript |
| **TypeScript** | The plan named TypeScript for generator and viewer; the owner's other project uses TypeScript throughout | **Accepted** after the owner's question; decision D-29 | One language; the code that turns a joint value into a part's position is shared with the generator |

## 9. Renderer for the agents

| Option | Evidence | Verdict | Reason |
|---|---|---|---|
| **The same viewer page, driven without a window** | *Tested:* five screenshots in about 2 s; byte-identical images on the software renderer; 30–90 ms per frame on the graphics chip | **Accepted** | The person sees exactly what the agent checked, and export errors (flipped axis, lost hierarchy, wrong units) cannot hide behind a correct-looking render from the authoring tool |
| Renders from Blender | *Tested* in trial A: about 0.35 s per frame, three render engines | **Rejected** | Would test the authoring tool's scene, not the delivered file; needs Blender |
| A small software rasteriser in Python | *Tested* by the toolchain research: a 25,000-triangle assembly in 0.6 s | **Not adopted** | The viewer covers the need |

## 10. Process designs

| Option | Evidence | Verdict | Reason |
|---|---|---|---|
| One agent, no reviewer, no gates | *Judgment:* faster by perhaps a third | **Rejected** | Published evidence on self-evaluation is consistent: agents praise their own work |
| An agent watching the builder's reasoning live | *Desk research:* in one study a single authoritative note overturned up to 40 % of a judging agent's correct verdicts (abstract only); *judgment:* roughly doubles token use | **Rejected** | A watcher would read the builder's own justifications, which is the anchoring condition the evidence warns about |
| **An independent reviewer** in a fresh context that sees photos and renders, never the builder's account, and has no "approve" output | *Desk research:* a separate evaluator is easier to make sceptical; visual self-checks level off after two to three rounds and about a third of visual verdicts are wrong or undecided | **Accepted** | The one extra agent that earns its cost |
| **Scripts for everything numeric** | *Desk research:* numeric feedback beats visual self-critique; *tested* in the trials (validator, transform comparison) | **Accepted** | An AI model is a weak judge of size |
| Many specialised agents (architect, analyst, manager) | *Desk research:* multi-agent work uses about 15 times the tokens of a chat and fits poorly where agents must share context | **Rejected** | Cost; the parameter file is shared state |
| A separate author for the acceptance tests | *Judgment* (review finding: the process was self-certifying) | Plan: **accepted**. Run: **not used** | The builder must not write its own tests |
| Testing the reviewer with planted errors | *Judgment* (review finding) | Plan: **accepted**. Run: not established from the sources of this page | A clean review means nothing unless the reviewer is known to catch errors |
| Parallel modelling agents | *Judgment:* worthwhile if bespoke parts dominate | Plan: **deferred** to a later asset. Run: **used**, three modellers; decision D-26 | The component groups could be separated by file ownership and a shared contract |
| Human gates (four short sessions, two of them decision gates) | *Judgment* | Plan: **accepted**. Run: **replaced** by reviewer rounds and the coordinator's checks in the browser; decision D-22 | The owner asked for a full autonomous test implementation |
| Rig first, toolkit and Skill extracted afterwards | *Judgment* (the simplicity critique) | **Accepted** | Writing them before one asset exists would be guessing |

## 11. Repository and privacy set-up

| Option | Evidence | Verdict | Reason |
|---|---|---|---|
| **One private repository**, with photographs and anything containing their pixels kept outside version control | *Judgment* | **Accepted** | Starting private costs nothing and removes the one irreversible mistake |
| A public framework repository plus a private asset repository per client | *Judgment* (naming and scaffold research) | **Deferred**: if the framework is published, export it to a fresh repository without history after a review | Git history cannot be cleanly unpublished |
| A public repository from the start | — | **Rejected** | The rig is a model of someone else's product; the photos show people and third parties and carry location data |
| Neutral rig names (Rig A, B, C1, C2); no client or customer name in any file | Review finding | **Accepted**; a check scans every file | The owner later asked for the same |
| Agents see only masked copies | Review finding | Plan: **accepted**. Run: **dropped** for agent viewing after the owner's answer; kept for published images | See deviations |
| Project folder in a location that does not sync to a cloud drive | Review finding | **Accepted** | Otherwise the photographs would be copied off the machine |
| Licence: MIT for code | *Judgment* | Proposed in the plan; not confirmed by the owner in the sources of this page | Same as the owner's other project |

## 12. Project names

Collision checks (GitHub, npm, PyPI) were run on 2026-11-23. They are not a trademark clearance.

| Name | Idea | Collisions found | Verdict |
|---|---|---|---|
| Greifraum | German ergonomics term for the reach zone | None | Shortlisted; rejected by the owner (German) |
| Tilpass | Norwegian "adapt, fit" | One empty repository of the same name | Recommended by the plan; rejected by the owner (Norwegian) |
| Operatorium | Coined: "the operator's place" | One small unrelated repository | Shortlisted; rejected by the owner |
| hfe-workbench | Plain description | None | Offered as the plain fallback; rejected by the owner |
| seatbuck | The physical ergonomic mock-up used in vehicle development | None | Not shortlisted: narrow automotive jargon |
| Sitzkiste | German for a seating buck | None | Not shortlisted: awkward in English |
| Kinesphere | The sphere of space reachable by the limbs | A user and several small repositories | Not shortlisted |
| workstation-twin | Digital twin of an operator workstation | None | Not shortlisted: "digital twin" over-promises for a photo-derived model |
| operator-station-lab | Scope in three words | None | Not shortlisted: long |
| Leitpult | German "control desk" | None | Not shortlisted: not a common word |
| Styrepult | Norwegian "control console" | None | Not shortlisted: hard to say in English |
| **The first name** (listed with ergorig) | Compact and typeable | None | Listed by the research as "generic"; **chosen by the owner** from a later list of plain English names; retired on 2026-11-25 for Synergon ([D-56](decision-log.md#d-56)) |
| Leitstand | German "control room" | An organisation with 10 repositories, an npm package and a tool of the same name | Rejected: taken |
| Rigwright | — | npm and PyPI taken | Rejected: taken |
| Anything with "cockpit" | — | A large existing project; npm and PyPI taken | Rejected: taken |
| Fernstand | German "remote station" | Free, but close to a registered mark for remote-control software in the same industry | Rejected: too close |
| ErgoTwin, CabForge, opstation, statio, passform, habilis, modulor, rigg, aptus | — | Existing repositories, products or packages | Rejected: taken |
| Sikt | Norwegian "sight" | Name of a public agency (recalled, not searched) | Rejected |

The owner's words on the shortlist: "all bad. keep it simpler. no german or norwegian". The later
list of plain English names from which Synergon was chosen is not preserved in the sources of this
page; only the choice is.

## Options that were deliberately deferred

| Deferred | Added when |
|---|---|
| Other rig configurations as overlay files | A second configuration is requested |
| Typed attachment interfaces | Parts are swapped across product families |
| Collision proxy shapes, coupled joints, further derived frames (torso line, heel point) | The assessment phase, with the standards in hand |
| Manikin, reach envelopes, virtual reality, live joystick input | The assessment and simulator phases |
| Publishing the framework | After a review and the client's agreement |
