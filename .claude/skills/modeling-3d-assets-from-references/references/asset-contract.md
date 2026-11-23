# Asset contract

What every asset built with this Skill must satisfy, as implemented by the project toolkit
(`generator/`, `shared/`, `tools/check.ts`). Consumers (viewer, assessment scripts, simulators)
bind to this contract, so change it only with a recorded decision. Examples use a neutral object,
an articulated desk lamp.

## Contents

- Source and compiled files
- Frames and units
- Names
- The spec
- Parameter records
- Three kinds of variable
- Joints
- Expected motion and left/right
- Reference frames and functional surfaces
- GLB conventions
- The description file
- Budgets
- What the checks prove, and what they do not
- Known gaps in the contract

## Source and compiled files

| Path | Role |
|---|---|
| `assets/<asset>/spec/*.toml` | the tree: nodes, groups, mount frames, joints, reference frames, expected motion, left/right table |
| `assets/<asset>/params/devices.toml`, `<group>.toml`, `measured.toml` | every number, one record each |
| `assets/<asset>/src/<group>.ts` (+ `src/lib/<group>-*.ts`) | one function per component id, returning meshes |
| `assets/<asset>/build/<asset>.glb`, `<asset>.manifest.json` | compiled output; never edited, not committed |

The spec, parameters and generator code are the only editable authority. Photos, solved cameras
and anything with photo pixels live under `private/` and are never deployed.

## Frames and units

- Metres and radians everywhere in code. Parameter files may use `mm`, `cm`, `in`, `deg`; the
  loader converts once. `ratio`, `count` and `1` are left alone.
- Right-handed, **Z up, X forward** (from the user toward what they face), **Y to the user's
  left**.
- The origin sits on a named physical feature of the fixed structure that a person could find
  with a tape. The description file states it.
- glTF is Y-up. The conversion happens once, as the rotation of the root node. Every node below
  the root is in the frame above. Some importers mirror glTF on load; a consumer's notes must
  say how it was handled.
- A moving part's node origin lies on its physical axis of motion. Meshes are authored in the
  component's own frame.

## Names

Pattern: `^(C|J|D|S)_[a-z0-9]+(_([a-z0-9]+|[LR]))*$`

| Prefix | Is | Example |
|---|---|---|
| `C_` | component (may be an assembly without its own mesh) | `C_lamp_arm_lower` |
| `J_` | joint frame between a parent and a child | `J_lamp_shoulder` |
| `D_` | reference frame (datum) | `D_lamp_beam_origin` |
| `S_` | functional surface with its own material and UVs | `S_lamp_panel` |

`_L` and `_R` are the **user's** left and right and may stand mid-name (`C_clamp_L_1`). A name
is a stable ID: never reused, never renamed once something downstream uses it. Each GLB node's
`extras.id` equals its name. Test the pattern against the real tree before handing out a brief:
the first version of this pattern rejected names its own author had written.

## The spec

One TOML file per asset. Top level: `asset`, `title`, `groups` (three to six, used for show/hide
and for dividing work).

```toml
[nodes.C_lamp_arm_lower]
parent = "C_lamp_base"
group  = "arm"
label  = "Lower arm"
pos    = ["0", "0", "lamp.base_height"]      # expressions over parameter keys
rpy    = ["0", "lamp.arm_rest_angle", "0"]   # roll X, pitch Y, yaw Z
joints = ["J_lamp_swivel", "J_lamp_shoulder"]  # inserted between parent and node, outermost first
tags   = ["structure", "adjustable"]
# assembly = true  -> the node carries no mesh of its own
```

`pos`, `rpy` and joint limits are small expressions over parameter keys (`"lamp.arm_length / 2"`,
`sin()`, `tan()`, `sqrt()`, list indexing). To move a part, change the parameter, not the spec.
A component is left out only through the group module's `omitted = { C_x: "reason" }`.

## Parameter records

One record per independent number or list:

```toml
[lamp.arm_length]
value    = 0.42
unit     = "m"
range    = 0.02          # ± in the same unit; meant to contain the truth about 9 times in 10
class    = "photo"       # measured | vendor | photo | assumed | invented
basis    = "by_eye"      # only for some classes, see below
tier     = "layout"      # critical | layout | cosmetic
evidence = "Two-view triangulation between photos 3 and 7 (31° between sight lines); ..."
```

- **Required:** `value`, `unit`, `class`, `tier`, `evidence`. The loader refuses an incomplete
  record and names it. Unknown fields, an unknown basis, or `assumed` without a basis are warnings.
- **Class** is how the value is known, strongest first: `measured` (on this object, by a
  person), `vendor` (published drawing of an identified purchased part), `photo` (calculated
  from photos), `assumed` (a stated basis but no calculation), `invented` (a plain guess or a
  modeling device such as a segment count).
- **Basis:** `user` for measured; for assumed one of `by_eye`, `cross_instance`, `symmetry`,
  `convention`, `standard_default`. For `photo`, start the evidence text with the method
  (two-view, one ray on a measured plane, one ray on an assumed plane, model fit); the loader's
  basis list does not yet hold those words.
- **Range** is omitted for by-eye and invented values, which claim no coverage.
- **Tier:** `critical` values feed an assessment or a body-contact dimension; `layout` values
  place parts; `cosmetic` values only affect looks.
- **Evidence** names photos, points, the assumption made and its sensitivity. Conflicting
  evidence is written into the same text.
- **Shape lists** (profiles, outlines, corner points) are parameters too, stored as proportions
  of the component's main dimensions so the shape rescales when a main dimension is corrected.
- **File order:** `devices`, the group files, then `measured`. A later record with the same key
  replaces the earlier one and the description file records `replaces`. A real measurement
  therefore arrives as a record in `measured.toml`, with who and when in its evidence.
- **A stated figure that is not modeled** stays as its own record (for example
  `<name>_user`), so it is not lost. The check reports it as "read by nothing": a warning.
- A component's class is the least certain class among the non-cosmetic records it reads,
  mount frame included. The viewer can colour the model by it.

## Three kinds of variable

| Kind | Example | In the compiled asset |
|---|---|---|
| Design parameter | arm length, base diameter | baked into geometry; rebuild to change |
| Adjustment | arm angle set by the user now and then | a joint with limits; no rebuild |
| Runtime control | a dimmer lever | a joint or state with a signal name |

Ranges of motion are parameter records like any length.

## Joints

```toml
[joints.J_lamp_shoulder]
type     = "revolute"     # revolute | prismatic | ball   (a rigid link has no joint record)
axis     = [0, 1, 0]      # in the joint frame
pos      = ["0", "0", "lamp.shoulder_height"]   # mount of the joint frame
lower    = "-lamp.shoulder_range"
upper    = "lamp.shoulder_range"
neutral  = "0"
kind     = "adjustment"   # adjustment | control
evidence = "inferred"     # seen | inferred | assumed
locked   = false
signal   = "lamp.dimmer"  # controls only: a stable name a simulator binds to
```

- **One definition:** node transform = mount(pos, rpy) · motion(value). It lives in
  `shared/pose.ts`, used by generator and viewer; the GLB stores each joint at `neutral`.
  Revolute values are radians about `axis`, prismatic values metres along it, ball joints take
  `[roll, pitch, yaw]`.
- **Evidence level is about whether the motion exists**, separately from its range: `seen`
  (a fastener, axle or two poses in the photos), `inferred` (load path, co-variation across
  instances), `assumed` (mechanism class only).
- **`locked`** marks a joint the asset does not vouch for. It must still be possible to try the
  motion: a viewer offers it labelled "assumed range" with a way back to the photographed pose.
  A control that is visibly locked with no way to unlock confuses users; that was reported.
- A mechanism with more links than its output needs (a multi-link arm) is modeled by the motion
  it produces. Either drive the visible links from the same joint value or lock the joint; never
  leave a joint whose child leaves its carrier.

## Expected motion and left/right

```toml
[motion]
J_lamp_shoulder = ["C_lamp_arm_*", "C_lamp_head", "D_lamp_beam_*", "S_lamp_panel"]

[symmetry]
single = ["C_clamp_knob_R"]     # exists on one side only
free   = ["C_clamp_L"]          # pair present but deliberately not mirror images (list the left id)
```

- `[motion]` lists, for every joint, the `C_`/`D_`/`S_` nodes that must move with it (`*` is a
  wildcard). Everything else must stay still. It is written to be read and corrected by a person.
- Every id with a side marker needs its counterpart at the mirrored position, with mirrored
  geometry, unless listed. Write the left part and mirror the meshes; frames are never mirrored.

## Reference frames and functional surfaces

- A `D_` node is a full frame, a child of the body it is fixed to, placed by expressions over
  parameters. It is constructed, never positioned by eye, so it moves when the geometry does.
- Its `label` carries the definition in words. A frame that stands in for a standardised
  reference point but was not determined the standard's way says "estimated" in its label.
- When a carrier adjusts, provide a fixed frame (does not move with the adjustment) and a live
  one (does), and say which is which.
- An `S_` node is a separate mesh with its own material and 0–1 UVs: u = 0 at the user's left,
  v = 0 at the top. A simulator can put a live image on it.
- Which frames an asset type needs is in its playbook.

## GLB conventions

- One named node per component, joint frame, reference frame and surface; no geometry outside.
- Parts with the same material are merged per component; each remaining part is one draw
  primitive. Materials come from a small named palette; no image contains photo content; no
  logos or text on the model.
- Smooth normals with a crease angle; visible hard edges carry a small bevel so they catch light.
- The writer is deterministic: two builds give the same SHA-256.
- Every mesh is tested when built: finite values, no zero-area triangles, unit normals,
  consistent winding.

## The description file

`<asset>.manifest.json`, types in `shared/manifest.ts`: `schema`, `asset`, `title`;
`conventions` (units, frame, glTF conversion, names, joints, classes); `build` (`partial`,
`only`); `groups`; `components` and `surfaces` (id, group, parent, label, tags, class, class
counts, parameters read, triangles, primitives, materials, bounding box, origin); `joints`
(kinematics, kind, evidence, locked, signal, rest transform); `datums` (origin, x and z axes);
`motion`; `omitted` (id and reason); `missing`; `not_built`; `materials`; `parameters` (the
resolved table with given value and unit, range, class, basis, tier, evidence, source file,
`replaces`); `parameter_class_counts`; `parameters_unused`; `totals`; `glb` (file, bytes,
SHA-256). A consumer should need nothing else to use the asset.

## Budgets

Set at intake; the toolkit's defaults are whole asset ≤ 150 000 triangles, GLB ≤ 4 MB, ≤ 80 draw
primitives, at least 55 frames per second headless at 1600 × 1000, a build well under 5 s and a
contact sheet under 15 s. Fast builds are a budget because modeling speed depends on them. Draw
primitives are usually the tighter limit: small parts with two materials each use it up.

## What the checks prove, and what they do not

`bun run check` runs, in order: type check; kit known-answer tests; parameter records complete
and build; determinism; an independent reader (Python, no shared code) re-reads the GLB; names;
coverage (every spec node in the GLB or in `omitted` with a reason, nothing extra); left/right;
geometry; glTF validator; expected motion; pose conformance (shared definition against the
independent reader on test poses); budgets; banned words; numeric literals in component code
(advisory); and, unless `--fast`, a projection self-test and frame rate in the headless browser.

These are consistency checks: they show that the GLB, the description file and the spec agree
and that the files are valid. They do not show that the real object is built or moves that way,
that any size is right, or that parts do not collide when a joint moves. Those rest on the
dimension table, the review and, in the end, a tape.

## Known gaps in the contract

Not implemented; each is expected to be needed by a later asset type (paper test only):

- a tag saying which of several user positions an interface serves, as a list;
- a module level in ids for repeated identical units;
- a class of motion that is passive (suspension) rather than adjustment or control;
- reference regions as well as reference points;
- a rule for closed mechanical loops: one driving joint plus followers, or the output motion only;
- machine-written measurement records behind every `photo` value, so a value cannot be nudged
  without a new record;
- a tag that makes a value filled from a standard "not assessable" against that standard;
- a collision sweep over the joint ranges.
