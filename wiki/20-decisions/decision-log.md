---
title: Decision log
tldr: 52 decisions, D-01 to D-52, each with context, alternatives, reason, who decided, status and consequences. D-01 to D-20 come from the approved plan, D-21 to D-37 from the first build, D-38 to D-46 from platform step 1 and D-47 to D-52 from agent interface v2 (all 2026-11-23 and 24).
status: living
updated: 2026-11-24
tags: [decisions, log, platform]
---

# Decision log

## TL;DR

- The plan's core decisions (D-01 to D-20) held through the build: parametric code as the route, text parameters as the source, TypeScript with three.js, a GLB plus a description file, no Blender, no live monitoring agent.
- The owner took eight decisions after approval (the eighth, automatic deployment, is D-37): internal test and no confidentiality concern (D-21), a full autonomous run (D-22), the name (D-23), usable assumed adjustments (D-31), the public addresses (D-32), a private repository (D-33) and the ban on the rig maker's name (D-35).
- The most consequential later ruling is D-24: where the photographs disagree with the owner's three scale figures, the photo value is modelled and the owner's figure is recorded as conflicting evidence. A tape measure must settle it.
- Four plan decisions were changed in execution: human gates (D-14 → D-22), masking (D-18 → D-21), serial modelling (→ D-26) and locked assumed motions in the viewer (D-10 → D-31).
- Platform step 1 (2026-11-24) added D-38 to D-46: the platform plan approved ([D-38](#d-38)); server-sent events plus POST commands ([D-39](#d-39)); undo by entry or request ([D-40](#d-40)); server-made author ids ([D-41](#d-41)); no release split ([D-42](#d-42)); the 800 kB budget for every script ([D-43](#d-43)); no manikin on the public site until approved ([D-44](#d-44)); port 4190 ([D-45](#d-45)); the stream byte budget ([D-46](#d-46)).
- Agent interface v2 (2026-11-24, "step 1.5") added D-47 to D-52: built here and deployed on the owner's word ([D-47](#d-47)); intent commands in plain words ([D-48](#d-48)); assumed adjustments moved and marked ([D-49](#d-49)); MCP served by the server itself ([D-50](#d-50)); pictures from the browser and views to every local page ([D-51](#d-51)); the meaning of each adjustment next to the page's words ([D-52](#d-52)).
- New decisions get the next free number. To retire one, mark it "superseded by D-xx"; never delete or renumber.

## How to read an entry

- **Decided by** is one of: *owner*; *coordinator* (the AI agent that ran the project and wrote the plan); *plan* (coordinator's decision inside the plan, approved by the owner with the words "Plan approved"); *review finding* (forced by one of the reviews summarised in [../80-reference/sources.md](../80-reference/sources.md)).
- The plan itself lists seven decisions as D1 to D7. They map to this log as: D1 → D-01, D2 → D-03, D3 → D-04, D4 → D-14, D5 → D-15, D6 → D-10, D7 → D-16.
- D-01 to D-37 are dated 2026-11-23 ("before approval" and "after approval" give the order); D-38 to D-46 are dated 2026-11-24.
- Breadth behind each decision: [options-considered.md](options-considered.md). Changes from the plan: [../30-plan/deviations.md](../30-plan/deviations.md).

## Decisions from the approved plan

### D-01 — No automatic 3D reconstruction; an agent writes parametric generator code

- **Decided by / status:** plan; in force.
- **Context:** the owner asked how to get from photographs to a 3D model.
- **Alternatives:** photogrammetry, learned multi-view geometry, single-image depth, generative image-to-3D, splatting, a human artist.
- **Reason:** *tested*: photogrammetry found 35 points for Rig B, almost none on the rig. The other automatic routes give one fused, unscaled mesh and mostly fail the open-source or hardware constraint.
- **Consequences:** the model reproduces what the modeller understood from the photos; anything misread is built confidently and wrongly, so checks and review carry correctness.

### D-02 — The only editable source is text: parameter files plus generator code

- **Decided by / status:** plan; in force.
- **Context:** the asset must be re-adjustable when measurements arrive.
- **Alternatives:** a Blender file; a CAD document.
- **Reason:** text can be compared between versions and read by an agent; each value can carry unit, source and range.
- **Consequences:** the model file and the description file are build products and are never edited by hand.

### D-03 — Generator and viewer in TypeScript with three.js, run by Bun; measurement in Python

- **Decided by / status:** plan; in force.
- **Context:** two trial routes both built a working blockout.
- **Alternatives:** Blender as a library; a native Python mesh stack; code CAD on OpenCascade; OpenSCAD.
- **Reason:** *tested*: rebuild 0.07 s against 1.1 s; 50 MB against 781 MB; MIT licence.
- **Consequences:** no solid-modelling kernel, so shaped parts are hand-built from a small kit; three.js writes invalid geometry without an error, so a format validator and geometry checks run on every build.

### D-04 — Blender is not installed

- **Decided by / status:** plan; in force.
- **Context:** the owner asked whether Blender is worth using.
- **Alternatives:** Blender as the foundation; Blender as an optional finishing stage.
- **Reason:** in the trial it was not what made the asset parametric or articulated. For the seat the missing ingredient is evidence (about forty corner points in 3D from oblique views), which no tool supplies.
- **Consequences:** no photoreal renders. If presentation quality is wanted later, an artist-made shell can sit under the same node, and would then no longer follow the parameters.

### D-05 — The asset is one GLB model file plus one JSON description file

- **Decided by / status:** plan; in force.
- **Context:** the owner asked what format keeps modularity and parameters.
- **Alternatives:** metadata only inside the GLB; OpenUSD; URDF or MJCF; STEP.
- **Reason:** every candidate consumer reads GLB; no ratified glTF extension carries joint limits, so a custom description is needed anyway, and a separate JSON file can be compared between versions.
- **Consequences:** every consumer other than the project's own viewer needs a small piece of code to apply joints from the description file. Robotics and CAD formats are derived on request.

### D-06 — The rig is not isolated from the background

- **Decided by / status:** plan; in force.
- **Context:** the owner asked whether the rig must be extracted from the pictures.
- **Alternatives:** segmentation masks; silhouette comparison.
- **Reason:** nothing is extracted from pixels; the background is what fixed the camera positions (*tested*).
- **Consequences:** agents work on gridded crops per component. Masks are used for privacy only.

### D-07 — Sizes carry a class and a range; the scale must close before modelling

- **Decided by / status:** plan, after review findings; in force.
- **Context:** the first size estimates disagreed (two scale references by about 7 %; one height derived as 660 to 800 mm).
- **Alternatives:** publish one value with the method's own error bar.
- **Reason:** *tested*: a method's own error bar (±45 mm) understated the real error (about 115 mm).
- **Consequences:** every dimension is two-view, single-view or by-eye. "±x" means the true value is expected inside about nine times in ten. The named gauge features that tie cameras to the model are never counted as verification.

### D-08 — Gaps are filled from a ranked list of sources, and the class travels with the value

- **Decided by / status:** plan; in force.
- **Context:** the owner asked how missing data is filled reliably.
- **Alternatives:** fill by judgment without labels.
- **Reason:** invented values must not look measured.
- **Consequences:** five classes (measured, vendor, photo, assumed, invented). A value filled from an ergonomic standard cannot later be assessed against that standard.

### D-09 — One tree; decomposition first, as a hypothesis the blockout tests

- **Decided by / status:** plan; in force.
- **Context:** the owner asked whether to decompose first or model first, and wanted a functional and a structural decomposition.
- **Alternatives:** two separate hierarchies; model first and cut it up afterwards.
- **Reason:** a part's parent is whatever carries it; the human-factors view is a set of tags and reference frames on the same nodes, so the two cannot drift apart.
- **Consequences:** names are stable identifiers; values never freeze.

### D-10 — Motions that are only assumed are in the model, locked

- **Decided by / status:** plan; in force for the asset; **changed for the viewer by D-31**.
- **Context:** no photo shows the seat sliding, swivelling, changing height, tilting or reclining, or the pedal tray moving.
- **Alternatives:** leave them out; include them unlocked.
- **Reason:** keeps the tree stable and keeps guessed motion out of every result.
- **Consequences:** the owner's own example (reach against seat position) cannot be answered until the client confirms the motions. On this rig the joysticks ride with the seat, so hand reach would not change anyway.

### D-11 — Seat references are labelled "estimated", not as a standardised seat index point

- **Decided by / status:** plan, after a review finding; in force.
- **Context:** the first draft called the seat reference an ISO 5353 seat index point with a range of ±25 mm.
- **Alternatives:** keep the standard's name.
- **Reason:** the standard's conditions (adjustments at centre, a loaded measuring device, or the seat maker's statement) are not met.
- **Consequences:** two frames, a fixed and a live seat reference, with ranges of about ±70 mm vertically and ±60 mm or more front to back. See [../80-reference/standards.md](../80-reference/standards.md).

### D-12 — Conventions: metres and radians; Z up, X forward, Y to the operator's left

- **Decided by / status:** plan; origin fixed by the coordinator in the build contract; in force.
- **Context:** the trials used three different conventions.
- **Alternatives:** the file format's own Y-up axes throughout; an origin on the floor under the seat pedestal (proposed by the toolchain research).
- **Reason:** matches robotics tools and the fore-aft, vertical habit of the seat-based standards. The origin is the centre of the platform deck's top surface, which the deck outline defines in the photos.
- **Consequences:** one conversion to the file format's axes, at the root node on export. Node names follow one pattern with prefixes `C_`, `J_`, `D_`, `S_`.

### D-13 — The viewer is a three.js page, and the same page is the agents' renderer

- **Decided by / status:** plan; in force.
- **Context:** the owner asked for a good browser environment.
- **Alternatives:** Babylon.js; the `model-viewer` component; renders from the authoring tool.
- **Reason:** least material; the person sees what the agent checked; export errors cannot hide.
- **Consequences:** a screenshot is not a measurement; sizes are computed from the files, not read off images.

### D-14 — No agent watches the builder's reasoning live

- **Decided by / status:** plan; in force. The human gates it relied on were **replaced by D-22**.
- **Context:** the owner asked who monitors the modelling agent's thought process.
- **Alternatives:** a live monitoring agent; no review at all.
- **Reason:** *judgment*, supported by published evidence: a watcher would read the builder's own justifications. Instead: scripts on every build, an independent reviewer, and the owner at gates.
- **Consequences:** the reviewer sees photos and renders, not the builder's notes.

### D-15 — The rig is built first; the toolkit and the Skill are extracted afterwards

- **Decided by / status:** plan, after the simplicity critique; in force.
- **Context:** the first draft built a general toolkit and an eleven-file Skill before any asset existed.
- **Alternatives:** toolkit first.
- **Reason:** writing them before one asset exists would be guessing.
- **Consequences:** the Skill after one asset is version 0.x; see D-28.

### D-16 — No logos on the model

- **Decided by / status:** plan; in force (the build contract adds: no decals or text either).
- **Reason:** protects the owner with the client.

### D-17 — Rig B is the reference rig

- **Decided by / status:** plan (question Q3, recommendation "yes"); in force.
- **Context:** four physical rigs appear in the photos; none is covered all round.
- **Alternatives:** Rig C1 (best whole-platform view); a composite with no reference.
- **Reason:** Rig B has the only operator's-eye view and the only usable two-view pair, and stands alone in its room.
- **Consequences:** what Rig B does not show is borrowed from Rigs C1 and C2 and tagged as borrowed. The model is "composite, configuration B" and matches no single real station exactly.

### D-18 — A private repository; photographs never committed; neutral rig names

- **Decided by / status:** plan, after review findings; in force. The masking part was **changed by D-21**.
- **Context:** the photos show people, third parties' names and location data; the first draft wrongly said they stay "on this machine only".
- **Reason:** a photo an agent looks at is transmitted to the AI provider; a public history cannot be cleanly withdrawn.
- **Consequences:** rigs are Rig A, B, C1, C2 everywhere.

### D-19 — "Just the pictures" includes public vendor datasheets

- **Decided by / status:** plan, stated as a reading for the owner to contest; no objection recorded.
- **Reason:** purchased parts are better modelled from published dimensions than from photos, and they double as scale references.

### D-20 — No code is reused from the Leitbild project; its practices are

- **Decided by / status:** plan; in force.
- **Reason:** its 3D model has no joints, hierarchy, materials or glTF output. Reused practices: one editable authority, an independent reader of exported geometry, negative controls, a "not qualified for" list.

## Decisions after approval

### D-21 — Internal test; confidentiality is no concern

- **Decided by / status:** owner (answers to the plan's questions Q1 and Q2); in force.
- **Context:** the plan had made masked working copies a precondition for further work.
- **Consequences:** masking for agent viewing was dropped. Masking was kept for every image published in the wiki, because the production site is public (coordinator).

### D-22 — A full autonomous test implementation; reviewer rounds in place of human gates

- **Decided by / status:** owner (direction), coordinator (how); in force for this run only.
- **Context:** the plan had four owner sessions, about forty owner clicks, an acceptance specification by a separate agent and a look sample judged by the owner.
- **Alternatives:** follow the staged plan.
- **Reason:** the owner asked for a complete result in one go, checked by "a separate ruthless agent".
- **Consequences:** acceptance rests on a ruthless reviewer agent plus the coordinator's verification in the browser. No acceptance-author agent was used. No hold-out points clicked by a person exist.

### D-23 — The project is called `rigtwin`

- **Decided by / status:** owner; in force.
- **Context:** the owner rejected the plan's shortlist ("all bad. keep it simpler. no german or norwegian").
- **Consequences:** folder in the owner's Documents folder, which is not cloud-synced on this machine.

### D-24 — Photo values are modelled where they conflict with the owner's scale figures

- **Decided by / status:** coordinator, on the measurement agent's results; in force until a tape measurement arrives. **For the owner to confirm.**
- **Context:** the owner gave three figures: platform 1.5 × 1.5 m; seat 1.4 m high; head to display 1.2 m.
- **What was found (*measured* from the photos):** with the deck width set to 1.50 m the scale closes within 0–2 % (soundbar 0.411 m against 0.410 m). The deck is then about 1.41 m front to back, not 1.5. The top of the seat back is 1.28 ± 0.03 m above the deck on Rig B and 1.27–1.28 m on Rig C1, not 1.4. The distance from headrest to screen is 1.14–1.21 m, which fits 1.2; eye to screen centre is about 0.97–1.05 m in the measurement report (the coordinator's notes round it to 0.95–1.05 m).
- **Alternatives:** model the owner's figures and ignore the photos.
- **Reason:** the deck width is used as the one scale input; the other two figures are then predictions the photos contradict.
- **Consequences:** the owner's figures are written into the parameters' evidence text as conflicting evidence. All three need a tape.

### D-25 — A coverage check, an "omitted" list and a left/right counterpart check

- **Decided by / status:** coordinator, after the owner's report; in force.
- **Context:** the trial model shown in the plan lacked the left joystick.
- **Cause found:** the coordinator's brief for the trial named only the right armrest pod; the figures did not list what was left out; no check compared the model with the component tree.
- **Consequences:** every component in the tree must be in the model file or in an `omitted` list with a reason; every left part must have its right counterpart; every image sheet lists omissions.

### D-26 — Three modelling agents work in parallel

- **Decided by / status:** coordinator; in force for this run.
- **Context:** the plan built components one after another and deferred parallel builders to a later asset.
- **How:** one modeller each for the seat; the two pods with joysticks, controls and touchscreen; and the platform, stand, monitor and pedals. Each owns its own source and parameter files under a shared contract.
- **Consequences:** a build option that generates only one group's meshes, so one group can be worked on while another is mid-edit.

### D-27 — A fixed performance budget

- **Decided by / status:** coordinator, from the owner's request; in force.
- **What:** whole rig at most 150,000 triangles (target 60,000–120,000), 4 MB, 80 draw calls; 60 frames per second on the project machine at 1600 × 1000; a build well under 5 s.
- **Consequences:** no stitching, screws, cables, logos or text.

### D-28 — The Skill is extracted after the build

- **Decided by / status:** coordinator; in force.
- **Context:** the plan wanted a six-file Skill draft before modelling.
- **Consequences:** a build brief served as the working guidance during the build.

### D-29 — The viewer is written in TypeScript and shares its posing code with the generator

- **Decided by / status:** coordinator, after the owner's question; in force.
- **Context:** the first viewer was a JavaScript file with no build step.
- **Consequences:** generator and viewer use the same code to turn a joint value into a part's position, so they cannot disagree.

### D-30 — The viewer's interface is redesigned after two independent reviews

- **Decided by / status:** owner (direction), coordinator (how); in force.
- **How:** two independent reviewers (one on interaction design, one walking through as a first-time user), then a separate implementer.
- **What they proposed:** 103 controls reduced to 19; the 3D view enlarged from 58 % to 82 % of the window; one card for the selected part; two-axis pads in place of separate sliders; direct manipulation; no lock.

### D-31 — Assumed adjustments are usable in the viewer, marked "assumed range"

- **Decided by / status:** owner; in force. Changes D-10 for the viewer only.
- **Context:** "why cant i adjust the seat? the lock is confusing for users unless there is a way to unlock".
- **Consequences:** a pose that uses an assumed motion is exploratory; it says nothing about what the real rig can do.

### D-32 — Public addresses and deployment by one command

- **Decided by / status:** owner (addresses), coordinator (pipeline); in force.
- **What:** viewer at `mightwork.ai/rigtwin`, wiki at `mightwork.ai/rigtwin/wiki`. One deploy command builds, checks, packages, copies a dated release to the server, switches a link and verifies the live pages.
- **Alternatives:** deployment from GitHub's automation; offered as a follow-up, because it needs a new access key on the server and no credentials are created unasked. The owner chose it afterwards: [D-37](#d-37).

### D-33 — The repository is private, and version control starts only at the end

- **Decided by / status:** owner (private), coordinator (timing); in force.

### D-34 — The touchscreen is modelled at the 13.3-inch size

- **Decided by / status:** coordinator, on the measurement agent's result; in force.
- **Context:** the plan carried two candidate models; the build contract first assumed the 15.6-inch one.
- **Reason:** *measured*: outer height 0.205 m and active height 0.1655 m, both 0.84–0.85 of the 15.6-inch figures.

### D-35 — The rig maker's name and the customer names never appear in the repository

- **Decided by / status:** owner (rig maker's name), plan (customer names); in force.
- **Consequences:** a check scans every file outside the private folders on every run.

### D-36 — Photographs in the wiki are masked copies

- **Decided by / status:** coordinator; in force.
- **What:** people and names blurred, metadata removed. Unmasked photographs never enter the repository.

<a id="d-37"></a>
### D-37 — Every push to main deploys automatically, through a restricted account

- **Decided by / status:** owner (automatic deployment, 2026-11-23, answering "Should a push to GitHub deploy to mightwork.ai automatically?" with "Yes, set it up"); coordinator (how); in force.
- **What:** a GitHub Actions workflow runs `bun run deploy --no-images` on every push to `main`. GitHub holds a new SSH key that the server accepts only for the unprivileged account `rigtwin-deploy`, and only for the exact commands of the deploy script inside `/srv/rigtwin` (a forced-command gate); the server's host key is pinned in the repository. Manual deploys use the same account and gate.
- **Alternatives:** the existing root login as the deploy key (rejected: a leaked secret would give full control of a server that hosts other sites); a deploy user with an ordinary shell (rejected: a leaked secret would allow any command as that user); building on the server from a pull (rejected: the server would need Bun, Chrome and the repository credentials).
- **Reason:** the owner asked for "a pipeline so that future updates will be pushed to prod"; least privilege keeps a leaked GitHub secret from reaching anything but the `/rigtwin/` release folders.
- **Consequences:** images that need the private photo cameras are not regenerated on the runner; after a model change they are regenerated locally and committed. Details: [deployment](../50-implementation/deployment.md#continuous-deployment-from-github).

## Decisions of platform step 1 (2026-11-24)

These were taken on 2026-11-24, for the platform plan ([plan v7](../30-plan/platform-plan.md)) and its
first step, agent control. "Simplicity monitor" is the independent reviewer that asks of every part of
the design whether it could be simpler; its objections and the coordinator's answers are kept in the
project's working files.

<a id="d-38"></a>
### D-38 — The platform plan (version 7) is approved, starting with step 1

- **Decided by / status:** owner (2026-11-24, "approved to proceed", with an independent simplicity monitor); in force.
- **What:** rigtwin becomes a working platform in five steps that can each be stopped after: agent control, honest numbers, assessment, an agent in the app, the control room. Step 1 is started; steps 2 to 5 are decided after the owner has tried it.
- **Consequences:** every change to the scene becomes a command that buttons, Claude Code and later an agent in the app all use. Details: [the platform plan](../30-plan/platform-plan.md).

<a id="d-39"></a>
### D-39 — The live channel is server-sent events plus plain POST commands, not WebSocket

- **Decided by / status:** plan (the multi-user expert's report and the step-1 design); in force.
- **What:** browsers receive changes on one `GET api/live` event stream (a heartbeat every 15 s, resume with `Last-Event-ID` or `?since=`); every change is sent as `POST api/command`. This copies the core of Leitbild (the owner's other project: one server-side truth, numbered changes, a stale check, a snapshot on joining) but not its WebSocket transport.
- **Alternatives:** WebSocket as in Leitbild (rejected: Leitbild needed eight months to get reconnecting right by hand); polling (rejected: changes would arrive late and every open page would load the server).
- **Reason:** an event stream resumes from the last event it saw and passes through Caddy without special settings; commands are ordinary requests that a command line or a script can send.
- **Consequences:** the page reconnects by itself with Leitbild's rules (backoff 1 to 30 s, at once when the page becomes visible or the network returns, one resync), tested with Leitbild's cases. A browser over the laptop's HTTP/1.1 can hold six streams per host, so a seventh viewer tab on the laptop waits; the public site uses HTTP/2.

<a id="d-40"></a>
### D-40 — Undo reverts a named change or a named request, not "my last change"

- **Decided by / status:** simplicity monitor (blocking objection 1), accepted by the coordinator; in force.
- **What:** `history.undo {version}` reverts one entry and `history.undo {group}` reverts every entry of one request, each as a new entry, refused as stale when a joint it touches has changed since.
- **Alternatives:** "undo own last change" (rejected: the owner's Undo in the browser must undo Claude Code's change, and on an open server "own" cannot be established).
- **Consequences:** the activity line's Undo names the entry it undoes; Claude Code tags each request with a group (`--group lower-monitor`) and undoes it in one step.

<a id="d-41"></a>
### D-41 — Author ids are made by the server; no text written by a client is stored except a request's group name

- **Decided by / status:** simplicity monitor and security review (M3), accepted by the coordinator; in force.
- **What:** the server labels each author from the declared kind ("Person", "Claude Code", "Script") and a keyed hash of a random client id ("Person · 3f2a"), with a secret made on the host at the first start. The client's own id is never stored or shown, so copying an id read on the live channel does not make a stranger look like someone else.
- **Alternatives:** names typed by visitors (rejected for step 1: they would need the text limits and the banned-names rule); the client id as the author (rejected: anybody can read it off the stream).
- **Consequences:** the page knows its own changes by the versions its requests recorded, never by author id. On a remote server `bun run rig` prints other requests' group names as `untrusted_group`, because they are claims.

<a id="d-42"></a>
### D-42 — No release split: the server travels in today's release folder, never served

- **Decided by / status:** simplicity monitor (blocking objection 3), accepted by the coordinator; supersedes the plan's release split; in force.
- **What:** `server/server.js` is part of each release next to the viewer. Caddy answers 404 for `/rigtwin/server/*` (installed by the setup script before any release with a server), the deploy checks that 404, and a rollback refuses a release without a server once the host runs one. The deploy account's gate is unchanged.
- **Alternatives:** separate `site/` and `server/` folders per release (rejected: two new gate patterns, a reinstall of the gate as root, a rollback floor for the whole site, and most of the security review's release risks).
- **Consequences:** the order of the first rollout matters: the Caddy rule must be on the host before a release with `server/` reaches `main` ([order of the first rollout](../50-implementation/server-and-host-setup.md#order-of-the-first-rollout)); it was installed on 2026-11-24.

<a id="d-43"></a>
### D-43 — The viewer's download budget counts every script of the default page: at most 800 kB, ready within 1 s

- **Decided by / status:** simplicity monitor (step 1 checkpoint review), accepted by the coordinator; in force.
- **What:** acceptance check T10 adds up every script the default page loads and allows 800 kB in all (before: 760 kB for `viewer.js` alone). "Ready in at most 1 s" stays.
- **Alternatives:** splitting default features into a second script (rejected: the visitor loads the same bytes, only the measured file shrinks); raising the old limit without a rule (rejected).
- **Reason:** the live client is a default feature the owner asked for; three.js is most of the script and its prebuilt modules cannot be trimmed by the bundler.
- **Consequences:** only modules that are off by default are split, each with its own budget. On the platform branch without the manikin the page loads one script of 733 kB and is ready in about 210 ms (*measured* 2026-11-24).

<a id="d-44"></a>
### D-44 — The public site gets the platform without the person in the seat, until the owner approves the new manikin

- **Decided by / status:** owner (2026-11-24: "No manikin yet: deploy the platform without the person: it appears on mightwork.ai only after you approve the new manikin"); in force.
- **What:** platform step 1 was moved onto `main` on its own branch (`platform-step1-main`) without any part of the manikin work, which stays on its own branch until the owner approves it.
- **Consequences:** the engine keeps only the two extension points the live client uses (before and after a reset of the page); the reference-frame reader `shared/kinematics.ts` stays because `measure.distance` uses it. The manikin is documented by its own pass when it is approved.

<a id="d-45"></a>
### D-45 — The rigtwin server listens on 127.0.0.1:4190

- **Decided by / status:** coordinator (2026-11-24); in force.
- **What:** the plan's port 4180 is already used by another service on the production host (found by the setup script's read-only check); the unit, the Caddy route, the setup script and its test use 4190.
- **Consequences:** the setup script still refuses to install when its port is taken by another program.

<a id="d-46"></a>
### D-46 — A live stream ends after 512 kB; at most 150 streams, 12 per network block

- **Decided by / status:** coordinator, on host check H14 (2026-11-24); in force.
- **What:** the server ends a live stream once it has been given 512 kB in all, read or not (the browser reconnects with `since=` and receives only what it missed); the ended stream's place still counts in the limits until its connection is gone (at most 45 s). The plan's 300 streams in all and the security review's 30 per network block become 150 and 12.
- **Alternatives:** relying on the 1 MB queue limit alone (rejected: on the host's Linux kernel each non-reading stream held about 770 kB in socket buffers before that limit could act).
- **Reason:** *measured* on the host: without the budget, 300 non-reading streams took the kernel's TCP memory past its pressure threshold (59,172 against 58,837 pages); with it, 150 of 150 were ended by the server and TCP memory peaked at 49 % of the threshold.
- **Consequences:** at worst about 150 × 0.5 MB = 75 MB of socket memory. A stream that gets only heartbeats and occasional changes lasts for hours; one that reaches its budget ends with an `end` event, on which the page reconnects at once. Details: [the server and its host setup](../50-implementation/server-and-host-setup.md#host-check-h14-live-streams-that-do-not-read).

<a id="d-47"></a>
### D-47 — Agent interface v2 is built before step 2, in this session, and deployed on the owner's word

- **Decided by / status:** owner (2026-11-24: "do the work here, push and deploy"); in force.
- **What:** after a slow run of "make the backrest straight" on the public sandbox (six agent turns and about 30 kB read for one number; the server answered each command in 0.3 s), the owner asked for "a very significant re-engineering" of agent control. The proposal (kept in the project's working files) was built at once as a step between 1 and 2, by the session "Platform work status" because the coordinator was busy, on the branch `agent-v2` based on `platform-step1-main`.
- **Reason:** steps 2 to 5 each add agent-facing commands; building them on the step-1 interface would multiply lookups and prose.
- **Consequences:** the five owner decisions of the proposal were taken by their recommended answers (step 1.5 now; act-and-mark for assumed adjustments; pictures on the public sandbox with guards; built here; benchmark on demand). The benchmark itself waits for a signed-in Claude Code command line (see [next steps](../90-next/next-steps.md)).

<a id="d-48"></a>
### D-48 — Intent commands: plain words in, one checked reply out

- **Decided by / status:** owner, on the proposal (2026-11-24); in force.
- **What:** five commands over the step-1 layer (`shared/commands/intent.ts`): `adjust`, `look`, `measure`, `undo`, `state`. `adjust` resolves its target from plain words or an id (refusing `ambiguous` with the candidates when two are about as likely), takes `to` (a number, units, a named position such as "upright" or "as photographed") or `by` (a relative amount, worked out on the server when the edit is recorded, so no prior read and no expected version), records one request with a name the server makes ("seat-recline-21"), and replies with before → after, the undo handle and what else is moved.
- **Alternatives:** keeping only `pose.set` with better documentation (rejected: the four-call loop find → summary → set → summary stays); free-text commands parsed by a model on the server (rejected: no model on the server in step 1, and replies must be exact).
- **Consequences:** the low-level commands stay unchanged for scripts, tests and the page. Agents no longer invent group names, so the banned-name check on group names matters only for the low-level path.

<a id="d-49"></a>
### D-49 — `adjust` moves an assumed adjustment and marks it, instead of refusing it

- **Decided by / status:** owner, on the proposal (2026-11-24); in force.
- **What:** `pose.set` still refuses an assumed adjustment without `allowAssumed`; `adjust` moves it and its reply says, every time, that it is an assumed adjustment. The Skill and the MCP instructions tell the agent to say so, and to ask first only when it chose an assumed adjustment the owner did not name.
- **Reason:** five of the seat's adjustments are assumed, so almost every seat request hit the refusal and a round trip to the owner, although the owner had named the adjustment. The honesty rule needs the words, not the stop.

<a id="d-50"></a>
### D-50 — MCP served by the rigtwin server itself, tools only; two entries in `.mcp.json`

- **Decided by / status:** owner, on the proposal (2026-11-24); in force.
- **What:** `POST api/mcp` (Streamable HTTP, JSON answers, no server-initiated stream) offers the five intent commands as tools, on the laptop and on mightwork.ai, through the same path and guards as `api/command`. Tool schemas and descriptions come from the registry; the server's instructions (at most 4,096 characters) carry the rules and one line per adjustment. `.mcp.json` names `rigtwin` (local) and `rigtwin-public` with `alwaysLoad`, so the tool name says which scene an agent acts on and the tools are in context from the first turn.
- **Alternatives:** a stdio wrapper around `bun run rig` (rejected: the Claude API's MCP connector, the route for the step-4 agent in the app, takes only remote HTTP servers); one entry with a target argument (rejected: the target would again be decided per call).
- **Consequences:** no host change: Caddy already routes `/rigtwin/api/*`. After the security review of 2026-11-24: one JSON-RPC message per request (batches would let one rate-limited request carry hundreds of calls and megabytes of reply), a content type of exactly `application/json`, and only the server's own `Origin` (locally `http://<Host>`, so another local dev server's page cannot drive the scene). The caller is "Claude Code · <id>", with the id made from the MCP session.

<a id="d-51"></a>
### D-51 — Pictures from the browser on request; views to every page of a local server

- **Decided by / status:** owner, on the proposal (2026-11-24); in force.
- **What:** `look {picture: true}` sends a reply id with the view event; the page draws at once (also in a background tab), makes a JPEG of at most 60 kB (under Caddy's 64 KiB request limit, so the host needs no change) and posts it to `api/picture`, which accepts it only for a picture being waited for, from the page that was asked, once, as a JPEG; `look` waits at most 8 s and says so when no picture came. At most 20 pictures are waited for at once, 2 per visitor and 1 per browser (security review: one stranger could otherwise hold every slot). On a local server, `look` without a code goes to every open page; on the public sandbox it needs the code, which the MCP session remembers.
- **Consequences:** agents can check a view by looking at it. A picture from the public sandbox is drawn by whichever page holds the code: data, not evidence.

<a id="d-52"></a>
### D-52 — What each adjustment means is written next to the page's words

- **Decided by / status:** coordinator of agent interface v2 (2026-11-24); in force. A deviation from the proposal, which put it in the asset's spec.
- **What:** every adjustment rule in `shared/words.ts` now also says what the value 0 means ("backrest vertical", "as photographed", "released") and gives everyday names ("backrest", "seat back"). The catalogue agents read is generated from it and from the description file; a unit test fails when a joint has no rule, no zero or no names.
- **Reason:** the page's direction words were already there and shared by the page and the commands; adding the meaning to the spec would have changed the description file and the model's checksum for no gain in step 1.5. When the next asset arrives, its words go in the same place.
