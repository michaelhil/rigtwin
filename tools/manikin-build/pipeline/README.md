# Avatar-lab pipeline

Python 3.11, numpy, scipy. Run with the Anny environment and `-I`:

```
PY=$MANIKIN_PYTHON
cd work/avatar-lab && $PY -I pipeline/build_body.py            # writes packages/body-clay/
```

With `-I` the script folder is not on `sys.path`; start your script with

```python
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # pipeline/
import mh_core as mh, glb
```

Each owner documents its module in its own section and edits only that section (this file was overwritten once
by two writers at the same minute: append or edit in place, never rewrite the whole file).

---

## Core (owner: B1) — `mh_core.py`, `glb.py`, `build_body.py`, `core_*.py`

**2026-11-25 01:57 (written 01:57:03 man, 01:57:45 woman): rebuilt by RR (B1 not running) on RR's round-8 rig: only `poses.json` changes (E34/E35 lift the foot, E36 soles flat); B4's 00:47 block and B5's eyes as before; freeze against the build before (00:13, motion re-merged 00:49): no vertex, joint or shape change; previous builds in `RR/packages/body-clay.r8` / `.r7` (and `-f`); B2, B7: rebuild from it.**
Status (B1 keeps this current): **round 7 rebuilt 2026-11-24 19:55 on RR's round-4 rig: `packages/body-clay/` (man)
and `packages/body-clay-f/` (woman), FORMAT v0.4. FROZEN by the designer's conditional pass and unchanged by this rebuild
(compared file against file, `B1/core_freeze.py`): topology, UVs, vertex order, rest vertex positions, the shape file, the
82 animated joint names with their order and parents, every kept joint's rest position, world-aligned rest frames, the
dof ids. Changed: skin weights, helper drivers, two more helper joints. B2, B7, B6: rebuild (table below).**
A copy of this section is in `B1/core-readme.md`.

### What changed, rounds 2 to 7 (for B2 wardrobe, B7 abstract style, B3 correctives, B4 motion, B5 eyes, B6 props)

| | Round 1 | Rounds 2 to 7 (now) |
|---|---|---|
| Packages | `body-clay` (both sexes on a sex slider) | **one per sex**: `body-clay` (man), `body-clay-f` (woman). RP's space is per sex (two bases, two sets of components), so is `bb.context(sex=...)` |
| Vertex order, faces, UVs | hm08 | **unchanged** (full array 19,158 rows; body 0..13379; triangle list `c.tris` identical) |
| Rest shape `c.base_v` | MakeHuman macro phenotype halfway between the sexes | **RP's base for that sex** (all 38 dimensions at the survey mean: a 1756 mm / 85.5 kg man, a 1629 mm woman). Everything fitted to the old base must be refitted |
| Rest pose | hm08's own A-pose | **unchanged**: RR's rig keeps the authored pose (upper arms 48 degrees below horizontal, elbows bent 45 (man) / 39 (woman), knees 7 / 9). `.mhclo` offsets still apply unrotated; `RigPack.bake()` is the identity |
| Origin | soles y = 0, hip joints x = z = 0 | the same (RP's convention; `c.offset` is now zero, `c.floor` 0) |
| Shape morph names | `male`, `heavy_m`, ..., `m_waist` (23) | **`pc00` ... `pc31`** (the first 32 of RP's 40 components; `c.targets`). All 40 are in `c.all_targets` for CPU baking. `pc_*` (with underscore) stays free for B3's pose correctives |
| Shape controls | sex, stature, weight, build, ... | RP's: `stature` (mm), `mass` (kg), then 36 standard scores `r_<dimension>`; no `sex` control. `person(sex, stature_mm, mass_kg, **extra)` still works; `sex` is only compared with the context's sex (`achieved["sex_mismatch"]`) |
| Joints | MPFB2 `default`, 163, names `upperarm01_L` | **RR's 82**, Unreal-mannequin names, lowercase `_l` / `_r` (`rig.JOINTS`): `c.skeleton` |
| Weights | painted, truncated to 4 | `c.W` sparse (19158, 82) full influences; **`c.J4`, `c.W4`** RR's least-squares 4-influence fit (use these); `c.dqs` (19158,) the `_DQS` mask. For a garment: `rig.for_layer(c.pack, W_on_default_bones, verts)` -> J4, W4, dqs, W82 |
| Joint deltas | `c.joint_targets[name]` (163,3) | `c.joint_targets[name]` **(82,3)**, for `pc00`..`pc31` |
| Dofs, drivers, poses | interim (mine) | RR's (`c.rr["dofs"]`, `["drivers"]`, `["poses"]`, `["anchors"]`); `poses.json` beside the GLB |
| Body mesh | built inline | **`bb.body_mesh(c, hide=mask, name="body", material=...)`** (the hide-mask argument B2 asked for) |
| GLB writer | | `glb.Mesh(attrs={"_DQS": mask})` writes any custom vertex attribute (float, or uint8 / uint16 for integer arrays) |
| **Round 3: 8 influences** | 4 only | `JOINTS_0` / `WEIGHTS_0` unchanged (RR's 4-influence fit, complete alone). New, **self-contained 8-influence set** in custom attributes: `_JOINTS8_0` + `_WEIGHTS8_0` (influences 1-4), `_JOINTS8_1` + `_WEIGHTS8_1` (5-8), heaviest first, the eight sum to 1. On the body it equals RR's full weights (no body vertex has more than 8): error against full weights 0.0001 mm, against 6.5 mm (man) / 5.4 mm (woman) for the 4-influence fit over the designer's 39 poses. In code: `c.J8`, `c.W8` (19158,8); for a garment `bb.skin_attrs(dqs, *bb.eight(W82))` |
| **Round 3: hands** | | rebuilt after RR's 18:24 change: `poses.json` has `HAND_FLAT`, the opposed thumb (`thumb_01_*.twist` dof), closed fingers; `rig.person_joints(package, person)` works on both packages |
| **Round 7: RR's rig, round 4** | 100 joints | **102 joint names**: RR's 82 (unchanged), 16 helper joints (`lap_thigh_l`, `lap_thigh_r` are new), B5's 4 lid joints. No name was removed and no kept joint moved. **Two things that are not "appended at the end"**: the helper list is ordered by side, so `lap_thigh_l` sits after `shoulder_front_l` and the indices of the right-side helpers and of the lid joints moved up by one or two (address joints by name, never by an index kept from an older build); and `armpit_arm_l/_r` now hang under `upperarm_twist_01_*` instead of `upperarm_*` (same rest position; the armpit pair is idle). **Skin weights changed** (helpers take weight from their own parent only; wider knee falloff): garments and shoes must take their weights again through `rig.for_layer()` (B2, B7, B6: rebuild; nothing fitted to rest positions or to the shape needs refitting). No vertex has more than eight influences now, so the 8-influence set is RR's full weights again (0.0001 mm). 14 `twist` drivers (8 segments, 6 helper records) + 2 `morph`. B4's block is merged for all ten persons (five per package) |
| **Round 6: helper joints ON** | present, unweighted | `bb.HELPERS = True` is the default: RR's 14 leaf joints (`knee_front`, `glute`, `hip_belly`, `groin`, `armpit_chest`, `armpit_arm`, `shoulder_front`, `_l` / `_r`) now **carry weight and have drivers** (plain `twist` records marked `"helper": true`). `bb.context()` has 96 joints (RR's 82, same names and indices as before, then the 14); the packages have 100 (then B5's four lid joints). **What to do**: B2, B7: rebuild; garments take the helpers through `rig.for_layer()` / `RigPack.transfer()` on their own weights, and need the 8-influence set (`bb.skin_attrs(dqs, *bb.eight(W))`): the 4-influence fit is off by up to 10.7 mm with helpers on. B4: bake again (helper joints are driven, never animated; clips need no tracks for them, but the per-person collision data should come from this body). `--helpers off` builds the round-5 body |
| **Round 6: nine influences** | | (gone in round 7: RR's weights never exceed eight. The fallback stays in `eight_influences()`: rows with more than eight take RR's least-squares fit with k = 8) |
| **Round 5: shape baked on the CPU** | 32 GPU morphs `pc00`..`pc31` | **the body GLB has no shape morph targets any more.** All 40 components are in `<name>.shape.bin` (13,380 body vertices in hm08 order, package frame, int16 deltas: rounding 0.0013 mm) with the manifest's `shape.bake`; the body mesh carries `_SRC` (= hm08 vertex index). `c.targets` now holds all 40 (`pc00`..`pc39`), `c.joint_targets` and `shape.model` too. **A garment, shoe, eye or style mesh that must follow all 40 needs its own file**: `block, err = bb.write_shape_bin(path, base (N,3), {name: delta (N,3)})`, add `"meshes": [...]`, append the block to `shape.bake` (a list is allowed) and give the mesh `_SRC` (row in its file); or keep GPU morphs for the first components and accept the mismatch against the body (up to 9-14 mm for the last eight). `--no-bake --shapes 32` still builds the old form |
| **Round 5: lids (B5's request)** | no lid joints | the two packages are built through `eyes.eye_context()`: **96 joint names** (the last four: `eyelid_upper_l`, `eyelid_lower_l`, `eyelid_upper_r`, `eyelid_lower_r`, children of `head`), eye joints on `eyes.eye_fit()` (moved 2.7 mm on the man, 1.3 mm on the woman), about 500 lid vertices re-seated (at most 3.0 / 2.0 mm) in the base and in every component, `_DQS` = 1 on them, their `_JOINTS8_*` rows repeat the 4-set. **`bb.context()` itself is unchanged (92 joints, no lids)**: B2 and B7 keep calling `eyes.eye_context(bb.context(sex))`. `--no-eyes` builds without |
| **Round 5: motion block** | merged at build | merged at every build **and by `build_body.py --merge-motion`** (no rebuild; B4 can run it after a bake). `build.motion_block.sha1` records which block is in the manifest; `bb.motion_stale(out, name)` tells when the file has moved on. B4's clips were baked on 92 joints; the lid joints added since have no tracks, which is harmless (joints are addressed by name) |
| **Round 5: joints** | 90 names in round 4 | **92** from RR (96 with the lids): RR added `groin_l`, `groin_r`. Helper joints stay unweighted and undriven here. Their order among the names after index 81 changed: address joints by name |
| **Round 5: checks on a baked package** | | RR's `rom_check` and `write_reference` read `shape.bake` since round 6 and raise on what they cannot read; the unbaked twins in `B1/rom-pkg/` are no longer used. Any other tool that takes a person from the GLB's morph targets gets the base body: read the shape file (`bb.read_shape_bin`) |
| **Round 4: shape space v2** | RP's first space | **`c.base_v` and every `pc00`..`pc31` delta changed** (RP's refit: no stacked-target ledges, chest girth and upper-arm length corrected; base multiplied by RP's `base_scale`). Names, controls, persons, vertex order unchanged. `bb.context()` defaults to v2 (`shape_tag="-v2"`; `""` gives the first space). Anything fitted to the old base (garments, masks, eyes, lasts, baked clips, style offsets) is stale |
| **Round 4: joints** | 82 | **90 names**: RR added `knee_front_*`, `glute_*`, `hip_belly_*`, `shoulder_front_*` (leaf helper joints at the end of the list; the first 82 keep their order). In these packages they carry **no weight and no driver** (`build_body.HELPERS = False`, `--helpers on`), because RR's section does not yet call them ready; switching them on later changes weights and drivers, not names |
| **Round 4: pose correctives** | none | body morphs 33 and 34: **`pc_wrist_l_flex70`, `pc_wrist_r_flex70`** (B3's, the only ones the designer admitted), with their `morph` drivers in the manifest; `c.correctives` (dense (19158,3), same form as `c.targets`: garments take `fit(base_v + d) - fit(base_v)`), `c.corrective_drivers` |
| **Round 4: sole height** | | **`rest.soleHeight`** (metres added to y above bare soles; 0.0 in the clay bodies) is the one place: `viewer/src/eyes.ts`, `abstract.py` and `build_operator.py` already read or write that key. A dressed or abstract package writes its own value there |
| **Round 4: motion** | `clips: []` | B4's `clips/manifest-block.json` is merged at build time (`clips`, `packet.clips`, `motion`) when the file is beside the package. **The clips there were baked on the round-3 bodies: B4 must bake again on v2** |
| **Round 4: packet** | derived shot list | `packet-shots.json` and the `pose_*` angles are gone (the renderer reads `poses.json` by id); `packet.otherPackages` names the other sex's package, so mixed line-ups render |
| **Round 3: format** | 0.2 | manifest says `rigtwin-avatar/0.3`. Per v0.3 section 2b the body keeps every triangle (garments bring `bodyMask` textures in the body's UV0, which is hm08's, unchanged); `body_mesh(hide=)` stays for variants that really delete |

**Two ways to carry eight influences, and they exclude each other** (for RL and the coordinator to settle):

- *separate* (what the packages hold now): `JOINTS_0` / `WEIGHTS_0` stay RR's 4-influence fit, complete alone, so
  `rom_check`, B2's checks and any plain loader see what they saw before; the eight are a second, whole set in
  `_JOINTS8_*` / `_WEIGHTS8_*`. three's loader keeps underscore attributes (as `_joints8_0`, ...), so the viewer can use
  them by swapping them in for `skinIndex` / `skinWeight` and `skinIndex1` / `skinWeight1` after loading.
- *gltf* (`build_body.py --skin8 gltf`, builds and validates; not in the packages): `JOINTS_1` / `WEIGHTS_1` with glTF's
  meaning, which `viewer/src/dqs.ts` reads today: set 0 = the heaviest four of the eight and no longer sums to 1 alone.
  A loader that ignores the second set then shows plain truncation (up to 17.9 mm off) instead of RR's fit (8.0 mm),
  and everything that reads `JOINTS_0` as "the skin" must read both sets.

Either way the viewer has to deal with one thing: `GLTFLoader` calls `normalizeSkinWeights()` on set 0 (line 4009 in
r187), and `dqs.ts` then adds the second set on top, so a vertex with eight influences is weighted by more than 1 in
the linear path. With the gltf form: scale set 0 by (1 - sum of set 1). With the separate form the problem does not arise.

Settled: the viewer skins with `_JOINTS8_*` / `_WEIGHTS8_*` (the "separate" form above), bakes shape on the CPU,
and RR's helper joints are on. Checked on the round-7 packages: RR's `rom_check` on thin, median, heavy and both sexes
(`packages/*/rom-check.md`): shoulder forward 80 on the heavy man 0.4 mm in the trunk (was 20 mm); RL's `rig-check`
against RR's evaluator, 11 poses on four bodies, at most 0.004 mm. Still open, not mine to close: skin against skin in
the lap and under the arm (contact capsules, RR and RL, are next): the deepest self-penetration inside the working range
is now 30 mm on the median man (seated look over the shoulder), 24 mm on M95H, 36 mm on the heavy woman (seated reach);
the shoulder pads at abduction 170 (+3.8 l median man, +5.1 l M95H).

### Frame and units (everything the core returns)

**Metres, glTF frame: +X the character's left, +Y up, +Z the way it faces.** The MakeHuman OBJ is already in
that frame in decimetres, so `v_m = v_obj * 0.1` (checked: `joint-l-*` cubes have x > 0, toes point to +z).
The rig JSON `default_position`s belong to another default character and are not used: joints are always
computed from vertices. Arrays are `float64` unless noted.
**Vertex arrays are always the full hm08 array (19,158 rows, the OBJ order)**: body (0..13379), helper geometry
and joint cubes together, because clothes (`.mhclo`) bind to helper vertices and joints are defined by the cubes.
`load_base().v` is in MakeHuman's own origin (soles at y = -0.817); `build_body.context().base_v` is the
package's rest shape: soles on y = 0 and the hip-joint midpoint on x = 0, z = 0.

**Rest pose (measured, not assumed): hm08's own rest pose is already an A-pose** (upper arms 48 degrees below
horizontal, elbows bent about 43, feet apart) and no rig re-poses it: the package rest pose = MakeHuman's authoring pose,
so `.mhclo` offsets apply unrotated.

### `mh_core.py`

```python
DATA: str                       # downloads/mpfb2/extracted/mpfb/data (absolute)
NV = 19158

class Base:                     # load_base() result (cached; read-only: copy .v before changing it)
    v: ndarray (19158,3)        # rest vertices, metres, glTF frame, MakeHuman origin (not floor-shifted)
    quads: int ndarray (18486,4)        # vertex indices, OBJ order (hm08 is all quads), counter-clockwise from outside
    quad_uv: int ndarray (18486,4)      # indices into uv
    uv: ndarray (21334,2)       # OBJ convention (v up); the GLB writer flips to glTF (v down)
    quad_group: int ndarray (18486,)    # index into group_names
    group_names: list[str]      # "body" (13,378 quads), "helper-tights" 2,650, "helper-skirt" 684, "helper-hair" 198,
                                # "helper-l-eye"/"helper-r-eye" 70 each, "helper-genital" 182, "helper-upper-teeth"/
                                # "helper-lower-teeth" 48 each, "helper-l-eyelashes-1/2", "helper-r-eyelashes-1/2",
                                # "helper-tongue" 224, and one "joint-*" group per joint cube
    vgroups: dict[str, bool ndarray (19158,)]   # mesh_metadata/basemesh_vertex_groups.json: "body" (0..13379),
                                # "HelperGeometry", "JointCubes", "helper-l-eye", "helper-tights", "joint-l-shoulder", ...,
                                # "Left", "Right", "Mid"
    mirror: int ndarray (19158,)        # hm08.mirror: index of the mirrored vertex (itself on the mid line)

def load_base() -> Base
def body_quads(base, groups=("body",)) -> int ndarray (k,)     # quad indices whose OBJ group is in `groups`.
                                # No "body" quad touches a non-body vertex (checked), and the body alone is a closed
                                # surface (0 boundary edges).

# ---- targets (sparse vertex offsets; files are gzip text "index dx dy dz" in decimetres) ----
def list_targets() -> dict[str, str]            # name -> path. Both the short file name ("measure-waist-circ-incr") and
                                                # the path relative to targets/ ("macrodetails/height/male-young-...-maxheight")
def load_target(name_or_path) -> (idx int ndarray (k,), delta ndarray (k,3))    # metres, glTF frame (cached, read-only)
def target_dense(name_or_path) -> ndarray (19158,3)
def apply_targets(verts, weights: dict[str, float]) -> ndarray (19158,3)        # verts + sum w * target; verts not modified
def macro_weights(gender=0.5, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5,
                  cupsize=0.5, firmness=0.5, race=(1/3, 1/3, 1/3), mpfb_exact=False) -> dict[str, float]
                                # MakeHuman's macro interpolation (macrodetails/macro.json): the target files and weights
                                # of one phenotype; feed to apply_targets(). gender 0 = woman, 1 = man; age 0.5 = 25 years.
                                # mpfb_exact=True keeps MPFB's -0.01..1.01 bounds (a slider at 1.0 is then 99 % of the end).
def phenotype(base_v=None, **macro) -> ndarray (19158,3)        # = apply_targets(base.v, macro_weights(**macro))

# ---- rigs ----
class Rig:
    name: str                   # "default" (163 bones), "default_no_toes", "game_engine", "mixamo", "cmu_mb", ...
    bones: list[str]            # MakeHuman names ("upperarm01.L"); parents come before children
    parent: int ndarray (B,)    # -1 for the root
    roll: ndarray (B,)          # radians, Blender bone roll as stored
    head_spec, tail_spec: list[dict]    # the JSON records: strategy CUBE (cube_name: mean of the 8 cube vertices),
                                        # VERTEX (vertex_index) or MEAN (vertex_indices)
    Rh, Rt: scipy.sparse.csr (B,19158)  # joint regressors: heads = Rh @ verts, tails = Rt @ verts (rows sum to 1)
    weights: scipy.sparse.csr (19158,B) # painted weights as stored: every body and helper vertex has weights summing
                                        # to 1 (0.9998..1); up to 8 influences per vertex; joint cubes are weighted too
def load_rig(name="default") -> Rig
def joint_positions(verts, rig) -> (heads ndarray (B,3), tails ndarray (B,3))   # exact for any morphed verts (linear)
def bone_frames(heads, tails, roll) -> ndarray (B,3,3)          # Blender's rest bone matrix (columns x, y = along the bone, z)
                                                                # in the glTF frame, for whoever wants bone-local axes
def ground_offset(verts, base=None) -> float    # y of the soles (lowest body vertex)
def prune_weights(W_sparse_or_dense, k=4) -> (J int ndarray (n,k), W float32 ndarray (n,k))    # top-k, renormalised;
                                                # zero weights carry joint 0. Plain truncation: RR's refit() is better.

# ---- geometry helpers ----
def triangulate(quads, quad_uv=None) -> tris (2k,3) [, tri_uv (2k,3)]
def smooth_normals(verts, tris) -> ndarray (n,3)                # area-weighted, on the *unsplit* topology (UV seams stay smooth)
def split_seams(tris, tri_uv) -> (vmap int (m,), uvmap int (m,), tris2 (t,3))   # one output vertex per (vertex, uv) pair
def subdivide(nv, quads, quad_uv=None, n_uv=0) -> (S, quads2[, Suv, quad_uv2]) # one Catmull-Clark step as a sparse matrix:
                                                # new_verts = S @ verts (rows sum to 1), so targets, weights (S @ W),
                                                # regressors carry over; UVs subdivided linearly (seams stay put)
```

### `glb.py`

(B2, 2026-11-24, round 6, with the coordinator's leave while B1 is not running: `write_glb` now writes one image and one texture per
source file; a file named in two `_images` slots of any material, e.g. a prop's ORM as `metallicRoughnessTexture` and
`occlusionTexture`, was stored twice. Nothing else changed.)

```python
@dataclass
class Skeleton:
    names: list[str]            # unique glTF node names (MPFB bones: dots replaced by underscores, "upperarm01_L")
    parent: int ndarray (B,)    # parents before children, -1 = root
    head: ndarray (B,3)         # rest world positions, metres, glTF frame, floor-shifted
    rot: ndarray (B,4) | None = None    # optional rest world rotations (x,y,z,w); None = world-aligned joint frames

@dataclass
class Mesh:
    name: str                   # FORMAT.md prefix: "body", "eye_L", "garment_shirt", "shoe_pair", ...
    v: ndarray (n,3)            # positions, unsplit topology; may be the full 19,158 array: unused vertices are dropped
    tris: int ndarray (t,3)
    material: str               # key into `materials`
    uv: ndarray (m,2) | None    # OBJ convention (v up)
    tri_uv: int ndarray (t,3) | None    # per-corner uv indices; the writer splits seams and keeps normals smooth across them
    joints: int ndarray (n,4) | None    # with weights (n,4): written as given
    weights: ndarray (n,4) | scipy.sparse (n,B) | None      # a sparse / dense (n,B) matrix is pruned to 4 and renormalised here
    morphs: dict[str, ndarray (n,3)]    # POSITION deltas per target name (same names on every mesh that follows the body)
    morph_normals: bool = True  # NORMAL deltas = smooth normals of (v + delta) minus those of v
    normals: ndarray (n,3) | None = None    # override; default smooth_normals(v, tris)
    color: ndarray (n,) | (n,3) | (n,4) | None = None       # COLOR_0 (float; a 1-D array goes to the red channel)
    attrs: dict[str, ndarray] | None = None                 # custom vertex attributes: {"_DQS": (n,)} -> SCALAR float32,
                                                            # (n,k) -> VECk. FORMAT.md v0.2's dual-quaternion mask goes here
    extras: dict | None = None

def write_glb(path, meshes: list[Mesh], skeleton: Skeleton | None, materials: dict[str, dict],
              animations: list[dict] | None = None, generator="...", extras=None) -> dict
        # materials: name -> glTF material dict without the name (e.g. {"pbrMetallicRoughness": {...}});
        #   a value may hold "_images": {"baseColorTexture": "/abs/path.png", "normalTexture": ..., "occlusionTexture": ...,
        #   "metallicRoughnessTexture": ...}: the writer embeds the file and fills the slot (PNG/JPEG/WebP).
        # animations: [{"name", "times": (n,), "rotations": {joint: (n,4)}, "translations": {joint: (n,3)}}]
        # One skin shared by every mesh. `extras.targetNames` on every mesh with morphs. Indices uint16 when the split
        # vertex count allows, JOINTS_0 uint8 when B <= 256, WEIGHTS_0 float32.
        # Returns {"bytes", "bones", "meshes": [{"name","vertices","source_vertices","triangles","targets"}]}.
def read_glb(path) -> (json dict, bin bytes)
def accessor(json, bin, index) -> ndarray       # for checks
def validate(path) -> list[str]                 # structural self-check (accessor bounds, unit normals, weights sum to 1,
                                                # index range, target counts); [] = clean
```

### `build_body.py` and `core_rp.py`: the body packages and what other builders share with them

```
$PY -I pipeline/build_body.py                        # both: packages/body-clay (man), packages/body-clay-f (woman); 14 s
$PY -I pipeline/build_body.py --sex f [--rig rr|default] [--shape-root DIR] [--shape-tag -v2] [--shapes 40] [--no-bake] [--no-eyes] [--helpers off] [--skin8 gltf] [--out DIR]
$PY -I pipeline/build_body.py --merge-motion [--sex m|f]     # only re-merge clips/manifest-block.json into the manifest(s)
```

```python
import build_body as bb
c = bb.context(sex="m", rig="rr", shape_root=None, shape_tag="-v2", n_shape=40)   # cached per argument set
c.base_v        # (19158,3) rest shape of that sex (RP's base on the full hm08 mesh), soles on y = 0, hip joints on x = z = 0
c.targets       # {"pc00": (19158,3), ... "pc39"}: the package's shape components as dense deltas on the full vertex array
                #   (helper geometry and joint cubes included): garment morph = fit(base_v + d) - fit(base_v)
c.all_targets   # the same 40 (kept from the rounds when the package held 32)
bb.write_shape_bin(path, base, targets) -> (bake block without "meshes", rounding error);  bb.read_shape_bin(path, block)
c.skeleton      # glb.Skeleton (98 joints: RR's 82 + 16 helpers; build() adds B5's 4 lid joints; share one object per package)
c.W             # sparse (19158,82) full-influence weights;  c.J4, c.W4: the 4-influence fit;  c.dqs: (19158,) `_DQS`
c.joint_targets # {"pc00": (82,3), ...} joint deltas (RR's regressors applied to the targets: exact)
c.pack, c.rr    # RR's RigPack and rig.for_body() result (dofs, drivers, poses, anchors, refit statistics)
c.space         # core_rp.load_space() result: RP's manifest and shape json, file paths, the transfer check
c.rig, c.base, c.tris, c.tri_uv, c.quads, c.quad_uv, c.sex
c.J8, c.W8      # (19158,8) the 8-influence set (heaviest first, sum 1);  c.skin8: its statistics
bb.eight(W_sparse, k=8) -> (J, W);  bb.skin_attrs(dqs, J8, W8) -> the `attrs` dict (`_DQS`, `_JOINTS8_0`, ...) for any mesh on the skeleton
bb.body_mesh(c, hide=None, name="body", material="clay_body", morphs=None) -> glb.Mesh
                # hide: bool (19158,) per vertex or bool (len(c.tris),) per triangle; a triangle goes when all three vertices are hidden
bb.shape_model(c) -> (controls, model, measures, person, mesh, weights, info)       # RP's, cut to the package's morphs
                # person(sex, stature_mm, mass_kg=None, **extra) -> (control values, achieved);  mesh(values, all_components=False)
                # weights(values, all_components=False) -> {"pc00": w, ...} exactly as the viewer computes them
bb.build(out=None, sex="m", rig="rr", shape_root=None, shape_tag="-v2", n_shape=40, hide=None)
bb.PERSONS      # the designer's persons per sex (stature mm, weight kg, extra controls)
c.correctives, c.corrective_drivers, c.corrective_info      # B3's admitted pose correctives for this body (bb.CORRECTIVES)
bb.SHAPE_TAG = "-v2";  bb.N_SHAPE = 40;  bb.BAKE = True;  bb.EYES = True;  bb.HELPERS = True;  bb.SKIN8_MODE = "separate"      # switches, also on the command line
bb.with_eyes(c)  # the context as B5's eye_context makes it (what build() writes);  bb.remerge_motion(sex);  bb.motion_stale(out, name)

import core_rp
core_rp.load_space(sex, root=None, tag="") -> {"base", "targets" (40,19158,3), "names", "manifest", "shape", "check", "paths"}
core_rp.coefficients(space, {"stature": 1.80, "weightkg": 90, ...}) -> (40,)        # RP's measurement map (metres, kg)
core_rp.anny_macro_weights(phenotypes) / local_weights(labels, values)              # Anny's interpolation of MakeHuman targets
```

How RP's space gets onto the full mesh (RP/REPORT.md section 7): RP's 256 fitted people per sex are evaluated with
MakeHuman's own target files on all 19,158 vertices (v2: with the exact target weights in `transfer-<sex>.npz`; the
first space: interpolated the way Anny interpolates them), shifted as RP shifted them, regressed on RP's coefficients,
and the base multiplied by `base_scale`. Check against RP's Anny-space files on the 13,718 shared vertices: base within
0.0001 mm, targets within 0.0013 mm (the int16 step of RP's file), both sexes. So any tape RP runs reads the same on
this mesh; the helpers and the 32 nipple vertices now follow (least-squares residual on helper vertices 1.0 mm RMS).

---

## Rig (owner: RR) — `rig.py`, `rig_*.py`

Status line (RR keeps this current): **22:05, round 7: the shared bodies `packages/body-clay`, `body-clay-f` are rebuilt on
this rig (by RR, B1 not running; freeze check clean, `RR/NOTES.md`). B2, B7: rebuild from them.** Against B1's round-7 build
(RR's round-4 rig), with `rig.py` as it stands; joint names, order and parents unchanged (below):

1. **`lap_thigh` is off** (round 5; fraction 0: no weight, no driver; the two joints stay).
2. **`armpit_chest` is on again**: fraction 0.25 of shoulder abduction, falloff 0.5 (was off; joint and parent unchanged). One
   more helper driver record per side (`upperarm_*` source, abduction axis). It takes the side of the chest along with
   `spine_05`, so the arm no longer sits in the chest at low elevations (median man, seated look over the shoulder 23.6 -> 14.4 mm;
   tall heavy man, shoulder forward 45, 23.7 -> 13.8) while shoulder forward 80 stays at 0.0 on every body (the round-4 fix).
3. **`knee_front` takes nothing behind the knee** (its share fades out between 2 cm in front of and 2 cm behind the joint
   centre); falloff 0.33 / gain 0.92 as before. Median man, hip 95 knee 110: 17.5 -> 14.7 mm (back of the knee).
4. **Over-8 rule**: a vertex the helpers push over 8 influences keeps its 8 largest weights (round 4 kept its painted weights,
   which dropped the helpers on 9 groin and lower-belly vertices: heavy woman seated 23.5 -> 28.0 mm; now 23.5 again).
5. **Round 7: knee weights smoothed** (`rig.KNEE_SMOOTH = (0.14, 40, 0.5)`): within 14 cm of each knee joint the body's
   weights are Laplacian-smoothed (40 passes), the kneecap helper's share kept as it is; garments, shoes and hair take the
   smoothed body weights there (nearest body vertex, `transfer()` / `for_layer()` do it). It removes the vertical crease on the
   outer side of the seated knee (F05, M50) and the jagged fold behind the heavy man's knee (M95H): both came from the painted
   thigh/calf blend, which is narrow there (present with the kneecap helper off too). Knee 110: M50 11.2 -> 4.9 mm, M95H 15.8 ->
   10.3, heavy woman 26.8 -> 24.0; worst tip 0.973–0.995 (was 0.962–0.987). `RR/pictures/r7-lab-m.png`, `r7-lab-f.png`,
   `r7-viewer-knee-zoom.png`.
7. **Round 8 (REVIEW-06): feet in the standing ankle poses and the squat.** E34 (ankle dorsiflexion 20) and E35 (plantarflexion
   45) now lift that foot clear, as a person shows the movement: hip and knee flex (hip half the knee) until the foot's lowest
   skin point is `rig.FOOT_CLEAR` (25 mm) above the floor; the other foot stays planted (`"lifted"` in the pose record). E36 (deep
   squat) keeps both soles flat sideways too (ankle inversion cancels the 7-10 degree roll the rest pose's hip abduction gave each
   foot). Weights, joints and rest pose unchanged; only `poses.json` changes.
8. Optional to ship, unchanged from round 5: **capsule contact** (FORMAT.md 2f, `rig_contact.py`, recipe below).

**Round 8, viewer (`main.ts` `update()`, clip branch; RR, the renderer engineer idle):** C6's folded head (REVIEW-06) was
the clip path piling `poseAdd` offsets onto bones every frame (the relaxed stand's neck and head kept last frame's rotation:
a 40-degree turn became 120). The branch now starts every frame from the rest pose and marks the mixer's accumulators stale so
every track is written again (three.js writes a track only when its value changed; my first version without that showed every
held clip at rest from about 01:30 to 02:01). Checked: C6 turn 40 + nod 25 = 42.6 right, 21.7 down, as in pose mode;
B1 not at rest; I1 eight distinct frames; `--self-test` passes.

**The knee notch and knee-top shards of rounds 4–6 were the viewer's twist drivers** reading the operator layer's quaternions
with `w < 0` as a near-360-degree twist; fixed by the renderer engineer in `viewer/src/main.ts` at 21:24 (`?signsafe=0` shows the
old behaviour). Checked on the round-7 packages: in the seated-operator pose the fixed viewer and my evaluator agree on every
driven joint (0.00 degrees; `RR/viewer_pose_dump.ts` + `RR/oppose.py`). `rig-check` still poses only `poses.json`.

**Joint list unchanged: 98 = 82 animated + 16 helpers, same names, order and parents as your round-7 packages** (checked
against `packages/body-clay*/`; your 4 lid joints follow them, 102 in all). Helpers, in order: `knee_front_l`, `glute_l`,
`hip_belly_l`, `groin_l`, `armpit_chest_l`, `armpit_arm_l`, `shoulder_front_l`, `lap_thigh_l`, then the same eight `_r`.
Appended joints stay appended: anything new goes after these and nothing is re-ordered or re-parented.

**What B1 does to rebuild** (my own build of exactly this is `RR/build_r7.py` -> `RR/packages/r7-m`, `r7-f`; the shared bodies
were built with `RR/build_shared_r6.py`, the same call without the contact block):

```python
# build_body.build(), with rig.py as it stands (items 1-5 come with it: weights and drivers):
import rig_contact as rc
block, attr = rc.f_block(c.pack, c.base_v, c.targets)       # about 3 s; block = FORMAT.md 2f, attr = (19158, 4) float32
# body mesh:  attrs={..., "_CONTACT": attr}                   # VEC4 float; w is 0
# manifest:   manifest["contact"] = block
# garments, shoes, hair (B2): their own _CONTACT = rc.f_attr_layer(layer_verts, c.base_v, attr)   # nearest body vertex
# or patch a written package: rc.write_contact(glb_path, manifest_path, c.base_v, attr, block)
```

What you should then measure (`rom_check`, deepest overlap outside the end range, mm; `RR/rom/r7-final.md`, with rounds 3, 4
and 6 beside it): M50_THIN 15.7, M50 15.2, M50_MID 14.0, M50_HEAVY 22.0, M95H 21.6, F05 20.9, F50_THIN 17.4, F50_MID 23.2,
F50_HEAVY 25.5, F05_LONGARM 19.4 (the same with contact); worst knee/elbow tip 0.973–0.995; shoulder forward 80, arm in trunk
0.0 on all ten. `rig-check` against the viewer, contact on, 8 poses, M50, M95H, F05, F50_HEAVY: within 0.003 mm.

**`rig.JOINTS` / `rig.PARENT` are the single source of joint names and parents: 98 joints = `rig.BASE_JOINTS` (the 82
animated ones, frozen: names, order, rest pose) + `rig.HELPER_JOINTS` (16, driven only, never animated, appended at the end).**
Rest frames are world-aligned for every joint (`Skeleton.rot = None`), so every `axis` in `dofs` and `drivers` is a unit
vector in the glTF world frame of the rest pose. Everything is in the core's frame (metres, full 19,158-row arrays).

**Rest pose: the authored hm08 pose, not re-posed** (upper arms abducted about 42 degrees, elbows bent 45, knees 7;
`pack.rest_note`): the weights were painted for it and a bind in mid-range deforms better both ways. The designer's
A_POSE is a pose in `poses.json`.

### Helper joints (round 3)

| Helper (`_l`, `_r`) | Parent | Sits on | Driver: source, axis, fraction | What it does |
|---|---|---|---|---|
| `knee_front` | thigh | knee joint | calf, knee hinge, 0.50 | the kneecap rides at half the knee angle: round knee front, tip ratio 0.91 -> 0.96–0.99. Falloff 0.33 of the shank, gain 0.92, front of the knee only (round 6); 0.45 / 0.80 tried in round 5 and reverted |
| `glute` | pelvis | hip joint | thigh, hip flexion, 0.45 | the buttock follows the thigh part of the way: no angular step at the gluteal fold |
| `hip_belly` | pelvis | `spine_04` | thigh, hip flexion, 0.25 | the lower belly swings forward a little over the rising thigh |
| `groin` | pelvis | 60 % down the thigh | thigh, hip flexion, 0.06 | the front groin crease is pulled in, so belly and thigh dive into a fold |
| `armpit_chest` | `spine_05` | shoulder joint | upper arm, abduction, 0.25 (falloff 0.5; **on again** in round 6) | the side of the chest follows `spine_05` and a quarter of the arm's adduction: arm out of the chest at the grips and when the trunk turns |
| `armpit_arm` | `upperarm_twist_01` | shoulder joint | **off** | did not flatten arm against chest reliably; tried again in round 6 with the round-3 donors and a flexion-free axis: no better than `armpit_chest` alone |
| `shoulder_front` | clavicle | shoulder joint | upper arm, flexion, 0.40 | the front of the shoulder follows the arm forward (clavicle weight only) |
| `lap_thigh` | `thigh_twist_01` | knee joint | **off** since round 5 | no visible gain; doubled the deepest lap overlap |

Weights: each helper takes `gain * smoothstep(1 - distance to its seed / radius)` of its donors' painted weight (seeds are
found on the body surface, radii scale with the limb; `rig.HELPERS`, `rig._helper_seeds`). At rest the skin is exactly as
painted; in motion too wherever a helper's donors are its own parent (`glute`, `groin`, `knee_front` take weight across a joint on purpose). `transfer()` / `for_layer()` apply the same rule to garments, so cloth follows the helpers. Helpers add
influences but never more than 8 (a vertex that would exceed 8 keeps its 8 largest weights, renormalised; round 6): use the 8-influence set; the 4-influence fit is not usable with helpers on.

`rig.HELPERS_ON = False` (B1's `HELPERS = False`) keeps the 16 joints in the skeleton with no weight and no driver.

### Capsule contact (round 5): `rig_contact.py`

```python
import rig_contact as rc
block, attr = rc.f_block(c.pack, c.base_v, c.targets)     # block: manifest["contact"], exactly FORMAT.md 2f's form
                                                          # attr: (19158,4) float32 for the body mesh: attrs={"_CONTACT": attr}
garment_attr = rc.f_attr_layer(layer_verts, c.base_v, attr)                  # garments: the nearest body vertex's values
rc.write_contact(glb, manifest_json, c.base_v, attr, block)                  # or patch an already written package
rc.f_block(..., receivers=("upperarm", "thigh", "forearm"))                  # all receivers: NOT the default, see below
```

- **Capsules** (8, the viewer's limit). Pushing: `upperarm_l/_r` (receivers "y": side of chest, breast, flank). Written as
  proxies (`receivers: null`) with `"receiversWhenReady": "x"`: `thigh_l/_r` and `forearm_l/_r` (they would push belly and
  lap). Proxies only: `trunk`, `chest`. Axis = the joint line (`span` keeps the limb's root out); `radius` = the 80th
  percentile of the limb skin's distance from that line at each end, fitted on the base shape; `radiusPerTarget` = the same
  fit on base + each shape component, so thin and heavy bodies get their own (median man's thigh: 123 mm at the hip end,
  74 mm at the knee; upper arm 73 / 50 mm).
- **Why the thighs and forearms do not push (the default `receivers=("upperarm",)`)**: under the viewer's present rule a
  masked vertex is pushed all the way onto the capsule, and the skin that overlaps in the lap is mostly the fold next to the
  thigh's own root. With thigh and forearm receivers on, the deepest overlap at hip 95 on the median man rose from 15 to
  34 mm (the groin fold folding on itself; `RR/rom/rom-check-r5-m-work-off.md` -> `-work-on.md`) and the short woman seated
  from 20.7 to 26.8 mm (`RR/rom/r5-contact-off-on.md`). They become safe with the two
  amendments below; then I switch them on and re-measure.
- **`_CONTACT`**: x = lower belly, lap and flank (for the thighs and forearms, when they push); y = side of chest, breast and
  flank (the upper arms); z = the limb skin that may give way (thigh, upper arm); w = 0. x and y are **zero for skin that is
  inside, or within 1.5 knee of, a pushing capsule in the rest pose**, rising to 1 over the next 4 cm (otherwise the viewer
  would push it out in the rest pose).
- `flatten` is written as 0 (the limb's own flatten off): 0.6–0.7 in the viewer showed no gain; `rom_check` does not
  evaluate it.
- `rom_check` applies the viewer's receiver rule (`rc.f_apply`, the maths of `labCapsules`) when the package carries the
  block; `contact=False` switches it off.

**What it does and does not do** (contact off -> on, `RR/packages/r5-m`, `r5-f`; numbers `RR/rom/r5-final.md`; viewer
pictures `RR/pictures/r5-viewer-contact.png`, `r5-viewer-arm-zoom.png`): upper arm in the trunk, seated on the grips,
median man 9.5 -> 9.4 mm (110 -> 78 intersecting pairs), heavy man 16.4 -> 16.1 (212 -> 144), short woman 8.0 -> 4.5
(130 -> 80), heavy woman 15.4 -> 13.2 (258 -> 224); look over the shoulder, median man 23.6 -> 20.4; shoulder forward 45,
tall heavy man 23.7 -> 20.2. In the viewer: on the heavy woman (S-F1) the sliver of flank showing through the grip arm is
mostly gone, on the heavy man it is thinner; **the lap seam (S-F7) and the serrated line under the reaching arm (S-E38
az -45) are unchanged.**

**Two amendments I propose to FORMAT.md 2f / `contact.ts` (for RL; both are in my reference as `rc.rest_clearance` +
`rc.apply`):** (1) the mask should scale the capsule's *radius for that vertex*, not the push: at shape bake
`rho = mask * clamp((d0 - knee) / r0, 0, 1)` from the rest pose, then per frame push toward `rho * r`; nothing moves at
rest and the push fades into the fold instead of having to be masked off around it. (2) a `lip: [full, none]` per capsule:
skin inside by up to `full` is brought out, deeper skin progressively less, none beyond `none`. Without (2), pushing a
whole belly out of a thigh capsule makes a ledge 2 to 3 cm high on median and heavy men (tried, own format, notes). With
both, my reference has no ledge, a faint band remains on the lower belly in the seated reach (`RR/pictures/r5-contact-m.png`),
and the gain is modest. Also missing from 2f: an offset of the capsule's ends from the
joint line (the thigh's flesh is not centred on the bone).

### Exposed pose range (the designer's review 1)

Dof `min` / `max` are now the **extended envelope** (shoulder flexion to 120, abduction to 90 clinical, elbow to 135, hip
and knee to 110). Every pose in `poses.json` carries `"envelope": "working" | "extended" | "end"`; the seven end-range
poses (E02, E04, E06, E11, E27, E33, E36) stay in the file for tests only and must not be displayed.
`for_body()["envelopes"]` has the clinical ranges for the manifest. Clavicle share of abduction is 10 % (was 18 %).
New poses W01..W10: the seated working envelope (hip 85/95, knee 90/110, elbow 100, shoulder forward 45/80, grip arm
abducted 10 with elbow 95, seated reach, seated lean).

### How `build_body.py` calls this (B1) — unchanged

```python
import rig
r = rig.for_body(c.base_v, c.targets)        # c.base_v: grounded rest vertices, 19158 rows
c.skeleton = r["skeleton"]; c.W = r["W"]     # 98 joints; sparse (19158, 98) full weights (helpers included when on)
c.joint_targets = r["joint_targets"]         # {target: (98,3)}: exact, joints are affine in the vertices (helpers sit on joints)
# body mesh: joints=r["J4"], weights=r["W4"], attrs {"_DQS": r["dqs"], 8-influence set from r["W"]}
# manifest: dofs, drivers (twist drivers for twist AND helper joints; helper records carry "helper": true), controls (optional),
#           anchors, posesFile poses.json = r["poses"], envelopes = r["envelopes"], rest note r["rest_note"], refit r["refit"]
rig.rom_check(out)                           # rom-check.json / .md in the package; reads FORMAT v0.4 baked shapes (shape.bake + _SRC)
```

Garments, shoes, hair (B2): `J4, W4, dqs, W96 = rig.for_layer(r["pack"], W_on_default_bones, layer_verts)`; 8-influence set
from `W96`.

### API

```python
JOINTS (98), BASE_JOINTS (82), HELPER_JOINTS (16), PARENT, JI, NJ
convert_rig(mpfb_rig=None, weights=None, verts=None, repose=None) -> RigPack
    # .Rj (98,19158) joint regressors, .W (19158,98), .J4/.W4 after refit(), .dq_mask, .rest, .axes, .offsets, .helpers,
    # .joints(verts), .skeleton(verts, floor), .transfer(W_default_bones, verts), .bake / .bake_mesh (identity unless repose)
refit(pack) -> stats;  for_body(base_v, targets) -> dict;  for_layer(pack, W_default_bones, verts) -> (J4, W4, dqs, W96)
dqs_mask(W);  write_dqs(glb_path, {mesh: (verts, mask)})          # for writers without a custom-attribute slot
dofs(pack) -> 105 records; drivers(pack) -> twist records (8 for twist joints + 6 for helpers); controls(pack) -> optional sliders
poses(pack) / write_poses(pack, path);  clinical_to_dofs(pack, angles, base=None);  envelope_of(clinical, id)
hand_dofs(pack, "HAND_GRIP40", "l"|"r"); HAND_POSES: RELAXED, FLAT, FIST, SPREAD, GRIP40, POINT (RR owns the values)
fk(names, parent, joints_rest, dof_list, driver_list, dof_values, apply_drivers=True, root_offset=None) -> (M, posed joints, local R)
pose_matrices(pack, joints_rest, dof_values);  skin(verts, J, W, M, dq_mask=None);  pad(W_sparse)
person_joints(package_dir, person) -> {joint: [x, y, z]}          # rest joints of a packet person from a built package (B4)
rom_check(package_dir, out_dir=None, persons=(...), use_mask=True, tag="", full_person="M50") -> dict
rig_rom.write_reference(package_dir, out_dir, pose_ids, person=None)   # <pose>.f32 dumps for viewer/rig-check.ts
rig_rom.check_bodies(rig_rom.pk_from_pack(pack, tris), {name: verts})  # the same metrics in memory, no GLB
```

`rom_check` evaluates what the viewer draws: baked or morphed shape of the named preset, dofs, `twist` drivers (twist and
helper joints), `morph` / `morphPose` correctives, the 8-influence set when present, the `_DQS` blend. It raises on a
driver type or shape encoding it does not implement, instead of posing the wrong thing. Metrics per pose: volume change,
thinnest section through the joint, elbow/knee tip ratio, twist section, new self-intersecting pairs and between which
joints, `arm_in_trunk_mm`, estimated deepest overlap, triangle area ratio; summary rows leave end-range poses out.

Notes for RL: (1) helper drivers are plain `twist` records; nothing to add. (2) The viewer's twist angle
`2*atan2(q.xyz . axis, q.w)` should take `q` with `w >= 0`, or a rotation past 180 degrees makes the driven joints jump. Round 6:
this is what breaks the knee in the seated-operator shots (status line above).
(3) `pc_wrist_r_flex70` fires at 11 % under pure forearm pronation 80 (the `morph` driver reads the hand's rotation about
the wrist-flexion axis, which pronation leaks into); the evaluator reproduces it, but it is cross-talk B3 / RL should remove.

---

## Wardrobe and head kit (owner: B2) — `mh_wardrobe.py`, `materials.py`, `build_operator.py`, `kit_*.py`

Status (B2, 2026-11-25 06:36, final4b): packages rebuilt once more for REVIEW-10 item 1 (shirt normal map only; B1, B2, W7, G1 in
`B2/pictures/final4b-{m,f}/`, the extended dropped-triangle check in `final4b-holes/`). Before that, final4 (05:46): **all six packages rebuilt with round 13 (the shirt for REVIEW-09 item 1), B8's rounds 2
and 3 and the eye specialist's new lash; full packets `B2/pictures/final4-{m,f}/`, tones `final4-tones/`, the dropped-triangle check
`final4-holes/`; faults `B2/pictures/KNOWN-ISSUES-final.md`; not reviewed.** What changed for others:
"Round 13", "Round 12" and "Round 11" below. Older status:
Status (B2, 2026-11-24, round 5): **`packages/operator-m`, `operator-f` (and `-medium`, `-dark` of each) rebuilt after
VD/REVIEW-04 on B5's round 3 head and B6's round 3 trainer and headset; packets in `B2/pictures/review-m/{quick,W}`,
`review-f/{quick,W}`, `tones/`; round 6 (coordinator's list: forehead, ponytail, trouser leg, shirt pieces, glasses, B8 hem fade,
cap, tones, ORM dedupe, knee notch) built after B1's 22:01 body; round 7 (the woman's hair: a bob under the cap; shirt cuffs and hem;
collar liner under the band) rendered into `review-{m,f}-r7/`; not reviewed. Faults I see: `B2/pictures/KNOWN-ISSUES.md`; causes and numbers: `B2/NOTES.md` round 5.**
(Older status lines of rounds 3 and 4 are in `B2/NOTES.md`.)

```
$PY -I pipeline/build_operator.py m [light|medium|dark] [--check]      # -> packages/operator-m/ (GLB = default outfit, garments/*.glb, maps/mask_*.png, CREDITS.md)
$PY -I pipeline/build_operator.py f --check                            # --check writes penetration.json over every top x trousers x shoes
$PY -I pipeline/build_operator.py m --outfit trousers=jeans,cap=none --colours top=sand --name probe --out B2/cache/probe
bun pipeline/kit_fetch_fabrics.ts --list                               # Poly Haven fabric sets; run by the coordinator only
```

### Round 13 (after VD/REVIEW-09 item 1, the shirt at 1.5 m; details: `B2/NOTES.md` round 13): what changed for others

- **The shirt is refined once** where it faces the camera (`refine_top`, `subdivide_once`: one Loop step with red-green closure from the
  neck joint down 300 mm, out to 60 mm beyond the shoulder joints, no forearm; the collar points stay corners): 3,384 -> 8,656 (man) /
  8,980 (woman) triangles. The refined asset is linear in the pack's (`SubAsset`: fit, weights and UVs are `S @` the original's), so
  the fit per shape target, the morph deltas, the bridging form and the weights are made exactly as before, on the finer mesh.
- **Buttons are new geometry**: the pack's discs, holes and thread pieces are dropped; 14 domed discs (11 mm, 12 segments, rim wall) in
  the shirt's own mesh and material, rigid on the cloth under their centre, their top mapped onto a button picture in the atlas (four
  holes, crossed thread). `B2_NO_BUTTONS=1` leaves them out (the snapshot for the shirt's cloth run).
- **Shirt normal map** (`shirt_details`, `w13_<sex>_top_shirt_{base,normal}.jpg` in `B2/cache`): stitched placket edges, back yoke,
  armhole seams at the shoulder points with a slight ease fold on the sleeve side, the side and shoulder seams (real UV island borders
  only: `materials.seam_height` now welds UV duplicates), and the pockets' outlines with a flap line, drawn in metres on the cloth.
  B8's standing fold map is re-baked on the refined shirt (`B2/baked/shirt-<sex>`, commands in round 11 below; the snapshot is built
  with `B2_NO_B8_DRESS=1 B2_NO_BUTTONS=1 B2_KEEP_BODY=1`, and the map it was composed over is saved beside it as `under_n.jpg`). At
  build time `recompose_shirt_map` solves the folds back out of B8's composite and lays them over THIS build's detail map, so the
  seams, pockets and buttons can change without a new cloth run. The recovered fold is limited to 25 degrees (`SHIRT_FOLD_MAX_DEG`;
  final4's unlimited solve drew a crease of the run as a dark slit on F05, VD/REVIEW-10 item 1).
- **Cloth runs need every body triangle**: a run on a dressed package of this round (hidden body triangles dropped, below) lets the
  shirt sag 40 mm into the chest, because the body is the collider. Build snapshots for cloth runs with `B2_KEEP_BODY=1`.
- **Form fixes** (`shirt_form`): the dome acts on the field above a 25 mm smooth base (60 mm sphere) and the smoothing keeps
  max(formed, smoothed formed): the old field lifted the chest's slopes (9 mm over the upper chest, 20-24 mm either side of the
  sternum), which made the faceted patch and the dark sternum. Pockets lose their box by its authored height before the form
  (`pocket_heights`), then sit 1.5 mm proud with a relaxed outline. The collar's fall is laid onto the yoke behind the neck
  (`collar_settle`).
- **Body index buffer**: body triangles deep under the mandatory shirt and trousers leave the dressed package's index buffer
  (`drop_triangles`; vertices and their order kept): 26,756 -> 19,447 / 19,504. `B2_KEEP_BODY=1` keeps them. Checked against such a
  reference build over every combination (cap, glasses, headset, style, colourways): `bun B2/kit_holes.ts <package> <reference>
  <persons> <out>`, then `python -I B2/kit_holes_diff.py <out>`; final4: no difference as drawn.
- **B8's round 3** is taken after round 2 (`cb.dress_extra`, its README lines). The woman's hair module is called with
  `HAIR_CAP_P` (fringe 6.5 mm, strand-end scatter 0.08).

### Round 12 (final3): B9's hair, the skin's clear coat per tone

- **The woman's hair is B9's** (`hair_cap.build`, README "Hair under the cap"), with B9's three lines: `HAIR_PICK` defaults to
  empty (no bob; `B2_HAIR=bob_b` brings it back for comparison), the piece is added before the clay figure, and the hair slot holds
  only `hp.garment`.
- **Clear coat per tone** (RL's field on `materials.skin_body`): dark `clearcoat` 0.08, `clearcoatRoughness` 0.5; medium 0.15 / 0.39;
  light keeps the viewer's 0.22 / 0.28 (`TONE_SKIN`).

### Round 11 (after VD/REVIEW-07; details: `B2/NOTES.md` round 11): what changed for others

- **Rig parity.** Every mesh of the dressed package carries the body's eight-influence set (`build_body.SKIN8`: `_JOINTS8_0/1`,
  `_WEIGHTS8_0/1`, heaviest first, sum 1), as the body package does; `JOINTS_0`/`WEIGHTS_0` stay the 4-influence fit. Body: RR's
  eight, with B5's eye-context rows (lid joints) kept; garments, hair, liner, glasses: `bb.eight` of `rig.for_layer`'s full weights,
  blended the same way as the 4-set at the knees and on the shoe; B6's props bind on the body's eight (the reference meshes are
  handed to `props.build` with their eight as weights); B5's meshes and the clay eyeballs carry their own weights as eight. The
  penetration check skins with eight.
- **Budget.** B6's trainer maps at 1024 (`TRAINER_MAP`). The trainer, headset and collar band go onto the CPU shape bake
  (`.wear.shape.bin`; one bake row per position and normal, so the viewer's recomputed normals are their authored ones, measured
  under 0.2 degrees); the clay style's last stays on the GPU (its normals are not its faces'). **The collar band is merged into the
  trainer's mesh** (`shoe_safety_trainer`, material `prop_shoes` with an atlas: the trainer's maps over the band's), one draw call
  fewer; there is no mesh `garment_collar` any more and the top lists only `garment_top_shirt`. The clay style's blank eyeballs are
  14 rings x 32 segments (800 triangles each, was 3,648). Shirt buttonhole patches and thread crosses are gone (the discs stay).
- **Shirt form.** `shirt_form` (hoop tension: each section's convex hull; drape: each profile's concave majorant; a parabolic dome of
  90 mm over every peak; capped at 40 mm, faded at sleeves, collar and hem), `pocket_flatten` (the pockets as 2 mm plates on it),
  collar zone relaxed and its edge loops smoothed, cuff ends relaxed, button discs rigid on the cloth and 1.2 mm off it.
- **B8's round 2** is taken at the end of every build (`B8_DRESS`, `cloth_bake.dress2`): the trousers' four seated correctives, the
  seated fold map with its `poseNormal` record, and the shirt's standing map **re-baked on this fit** into `B2/baked/shirt-{m,f}/`:
  ```
  SNAP=B2/cache/r11snap/operator-m (a copy of a build with B2_NO_B8_DRESS=1, links body-clay, body-clay-f, props beside it)
  $PY -I pipeline/cloth.py prep $SNAP $S/shirt-m garment_top_shirt --over-skinned --frames=40 --who=M50     # the woman: F50_MID
  tools/Blender.app/Contents/MacOS/Blender -b -P pipeline/cloth_sim.py -- $S/shirt-m garment_top_shirt
  $PY -I B2/kit_shirtmap.py $SNAP $S/shirt-m B2/baked/shirt-m M50     # = cloth.py bake_stand, plus no folds over the chest front
  ```
  (`kit_shirtmap.py` passes `bake_stand` a mask: B8's stiff centre band and, new, no simulated folds over the chest between 40-80 mm
  and 260-320 mm below the neck joint: the run's folds draped from the bust and converged at its apex, which then read as a point.)
- **Skin per tone** (`TONE_SKIN`, dark and medium): mid-scale colour blotches evened below the eyes (lips kept), roughness raised, a
  matte floor on cheeks, chin and upper lip. The iris preset defaults to `eyes.IRIS_BY_TONE[tone]`.

### Final rebuild (rounds 8 and 9; details: `B2/NOTES.md` rounds 8, 9)

- **Motion**: B4's block is merged into every operator manifest after `bb.build` (`bb.merge_motion`, `clips/` paths relinked to
  `../body-clay[-f]/clips/`), so the dressed packages carry the clips, the packet poses (RELAXED_STAND) and the seat rule.
- **Eyes (B5 round 4)**: the `BROW_F` override is gone (brows are `eyes.BROWS[sex]`); `eye_lash_texture(..., brow_rgb=TONES[tone]["brow"])`.
- **Shirt**: the front of the hem raised toward the side height, feathered (`TAIL_LIFT` 0.7, at most `TAIL_MAX` 25 mm, faded over
  `TAIL_BAND` 200 mm, the hem loop smoothed after it); the pull toward the trousers (`HEM_TUCK`) is off.
- **Hair (bob)**: the cap test per shape target.
- **Hair (bob)**: card alpha opaque with soft tips; strands 4 mm off the skin round the face before the cap's draw-in.

### Round 7: what changed for others (details: `B2/NOTES.md` round 7)

- **The woman's hair**: the ponytail is retired; mesh `hair_bob_b` (hair01 pack, `toigo_blunt_bob`, CC0) under the cap, fitted by
  `cap_hair` (whole cap in the cover test, hair drawn 6 mm under it). `B2_HAIR=short_a,short_b,bob_a,bob_b,tucked` builds several
  candidates into one package (slot `hair`, `allowNone`). Mesh name changed: `hair_tied` -> `hair_bob_b`.
- **Shirt**: cuff buttons left out; 4 mm more ease at the cuffs; the hem drawn toward the trousers (`HEM_TUCK`).
- **Collar liner** stays 0.8 mm under B6's collar band where the band covers it (B6: your band's lower edge is clean again).
- **Trousers**: leg relaxation to 200-340 mm above the shoe.

### Round 6: what changed for others (details: `B2/NOTES.md` round 6)

- **Meshes and names unchanged.** `hair_tied` (woman) is smaller: the tail and the hair behind the ears only; temples and forehead
  are painted. The cap's weave detail is now the denim twill (`maps/fabric_jersey_n.jpg` is gone).
- **Skin albedo**: the packs' own scalp paint is replaced by plain skin; painted hair only from 45-70 degrees round the head from the
  front (none on the forehead); scalp roughness at least 0.85. **Medium tone** = skins01 `callharvey3d_midtoned_female` (CC0) for both sexes.
- **Trousers**: B8's standing fold map, flat over the bottom 120-220 mm (`b8_hem_faded`); the leg relaxed (Taubin) from the hem to
  100-220 mm above the shoe; round the knees (90-150 mm) the skinning of the bound body vertices (`KNEE_BODY`).
- **Shirt**: buttons and cuff pieces take the skinning of the cloth under them; 4 mm more over the trousers (`WAIST_EXTRA`).
- **Glasses**: metallic 0, roughness 0.3, lens alpha 0.015.
- **Check**: also on `M50_HEAVY` and `F50_HEAVY` (`CHECK_PERSONS`).
- **`glb.py`** (B1's, with leave): one image per source file (the props' ORM was stored twice).

### Round 5: one outfit in colourways, the trainer first, shape files, the clay style inside

**For B6, B7, B8, RL: mesh names and the base changed in this round.**

- **Meshes in `operator-<sex>.glb`** (no side GLBs any more; `garments/` is gone): `body`, `garment_trousers_work`,
  `garment_top_shirt` (collar liner merged in), `garment_cap_work_cap`, `shoe_safety_trainer` (B6), `hair_tied` (woman only),
  `eyeball_l`, `eyeball_r`, `eye_wetline`, `lashes` (B5; brow cards inside), `glasses`, `prop_headset`, `garment_collar` (B6), and for
  the clay style `body_clay`, `clay_eyeball_l`, `clay_eyeball_r`, `shoe_last`. **`shoe_shoes_ankle_boot` and `teeth` no longer exist.**
- **Base**: rest face is now `eyes.eye_rest_expression(base_v, sex)` (B5); the **cap changed shape** (affine image of the authored
  cap per body, turned back `CAP_TILT` = 2 degrees, `stiff_fit`): B6's headset binds to `garment_cap` and should be looked at again.
- **One outfit in colourways** (`OUTFITS`: operator, operator_petrol, operator_dark, operator_sand): shirt, work trousers (the men's
  cut on both sexes), B6's trainer, cap; headset and glasses on or off. The cap is not optional (`allowNone: false`).
- **The trainer is built first** (`props.build([body], names, which=("shoes",))` on the bare body) and is an inner layer for the
  trousers. Where the hem lies on it (12-45 mm) the cloth takes the shoe's shape deltas and skin weights (`g.ride`).
- **Under the shirt the trousers lie 3 mm off the skin** (`HUG`; zone = more than 35-75 mm above the shirt's hem line by azimuth).
- **Shape on the CPU for my meshes too**: `shape.bake` is a LIST: `<name>.shape.bin` (`body`), `<name>.wear.shape.bin` (trousers,
  shirt, cap, glasses, hair; `_SRC` = row in the file), `<name>.clay.shape.bin` (`body_clay`, `clay_eyeball_*`). B6's and B5's meshes
  keep GPU morph targets (explicit normals: the bake would smooth their hard edges and crease their UV seams).
- **Textures**: skin albedo JPEG 2048 (no alpha is read), roughness zones 1024; cloth base and fold normal 1024 (cap 512), no cloth
  roughness map (constant, in the factor); B6's prop maps re-encoded PNG -> JPEG at build (`diet`; normals quality 95, 4:4:4).
- **`styles`**: `dressed` hides `body_clay`, `clay_eyeball_*`, `shoe_last`; `clay` (`wardrobe: false`, `bodyMask: false`) shows only
  them, in B7's material (`abstract.P`). `clay_style()` calls B7's `Style`, `lid_rotations`, `lid_lip`, `styled_target`, `fill_rows`,
  `eyeball` and B6's `last`. No subdivision of head and hands in this copy.
- **Tones**: `$PY -I pipeline/build_operator.py m dark --name operator-m-dark --out packages/operator-m-dark` (and `medium`, `f`).
- **Check** (`--check`, `penetration.json`): poses stand, elbow 90, ankle +20, ankle -30, hip 95; rows now carry `pass_ankle`. Against
  the shoe only the cloth's own surface counts (not the hem's inner lip), floor-facing shoe faces are left out (the underside of the
  rolled lip), and a hem point counts only when a ray from some outward direction meets the SHOE first, within 8 mm of it
  (`_shoe_in_front`); `penetration.json` keeps the reading before that confirmation as `hem_geometric_mm`.
- **Trousers normal map = B8's standing fold map** (`B8_TROUSERS_FOLD` = `B8/baked/candidate/garment_trousers_work_fold_stand_n.jpg`,
  1024, same slot and UVs, both sexes; `B2_NO_B8=1` builds with my own map). Not B8's shirt or seated maps, no corrective shapes.
- **For B6, the trainer's body mask** (`maps/mask_shoes_safety_trainer.png`): every body vertex below 105 mm above the bare sole is
  hidden (the top of the foot, 30-90 mm, at full value), the cut lies 4-6 mm below the lip at the sides; its `cover` map flags the whole
  foot, so RL's zero-skin-pixel test counts any skin there, in every outfit (the vamp is never under the trousers). What the mask hides:
  by the check's reading the men's toes stand up to 14-16 mm outside the trainer (71-93 points, at the first lace: your patch), the
  women's 9 mm.
- `B2/kit_glb_bytes.py <glb>`: where a GLB's bytes go (images, base geometry, morph targets per mesh).

### Round 4: what the build does at the neck, and the first set

- **First set** (coordinator): top `shirt`, trousers `work` (the woman's package takes the women's cut `mindfront_female_trousers_1`
  through `src_f`), shoes `ankle_boot` and B6's `safety_trainer`, `cap`, `glasses`, `headset`, B6's collar band; six outfits. The
  hooded jacket and the jeans are out until they pass the check.
- **Neck** (the ragged edge, the specks): (1) a top's coverage test reaches 45 mm, not 90 (at 90 the collar counted as covering the
  back of the neck up to the hairline: holes in the skin there, the "red and blue specks"); (2) with B6's collar band worn, the
  shirt's mask in the neck zone is measured from the band: skin stays for `NECK_SETBACK` = 30 mm below the band's top edge all
  round; (3) `collar_liner`: a strip of the skin's own topology from 16 to 40 mm below the band's top edge, lifted 1.5 mm off the
  skin at its upper edge and out to 3 mm under the shirt at its lower edge, in the shirt's material and merged into the shirt mesh:
  looking into the collar one sees skin, then cloth, never the cut line or the inside of the figure.
- **Shape on the CPU**: on by default (`<name>.shape.bin` for THIS body with B1's `write_shape_bin`, `_SRC` on the body, no shape
  morphs on the body). `B2_NO_BAKE=1` turns it off. Garments still carry the 40 shape morphs.
- **Eyes block**: `eyes.eye_manifest` writes positions in the bare-sole frame; the package is lifted by the sole height, so the build
  now adds the lift to `sides.*.centre` and `lift[].verts` (they were 28 mm low in round 3).

### The wardrobe (`build_operator.GARMENTS`, `DEFAULT`, `OUTFITS`)

One entry per garment: slot (`shoes`, `trousers`, `top`, `cap`, `glasses`), source `.mhclo`, licence and author, material class, colourways
(sRGB; applied as the material's base colour over a NEUTRAL texture), `over` (slots it must stay outside of), `rim` (edge geometry).
Adding a garment = adding an entry. What the build does with each:

1. **Fit** on the base and on every shape target (`Asset.fit`), deltas by difference: the body's morph names on every mesh.
2. **Layer by rule, independent of what else is worn** (round 3: the layer clearance really is 5 mm now; it was 3 mm before, my
   earlier text was wrong): shoes; every trousers option clears every shoes option; every top is worn out
   and clears every trousers option (`wd.clear_outside`: clearance measured only against inner points facing the same way as the
   cloth, spread smoothly, moved along the cloth's own normal; `wd.follow_main` carries buttons and pocket flaps along).
   Cloth over skin at collar and cuffs: 7 mm; layer over layer: 5 mm.
3. **Edge geometry** (`wd.Rim`): every open border is turned in through 2.5 mm and run 22 mm back along the inside in three rings,
   smoothed along the loop.
4. **Weights**: barycentric transfer of the MPFB default weights, then `rig.for_layer` (RR): 82 joints, 4 influences, `_DQS`.
5. **Body-hide mask** per garment, `maps/mask_<slot>_<id>.png`: 1024, 8-bit, body UV0, image row 0 = glTF v 0, white = hidden.
   `value/255 = 0.5 + (d - 0.030) / 0.032`, d = distance along the skin from the garment's opening inward (`wd.coverage`,
   `wd.hide_distance`, `wd.raster_scalar`). The viewer's rule (lighten-combine the worn masks, cut at 0.5) therefore cuts the skin
   on a smooth line 30 mm inside every opening. Body triangles that every option of an always-filled slot hides deeply are left
   out of the body mesh (`bb.body_mesh(c, hide=)`).
6. **Textures** (`materials.neutral_set`): neutral albedo (no colour, no baked light, no occlusion map), the authored fold normal
   at half strength, roughness 0.9. **Weave**: the Poly Haven scan's normal map as the cloth class's tiling detail normal (FORMAT.md
   2c): `maps/fabric_<linen|denim|jersey>_n.jpg`, `detailScale` = (metres per UV unit of that garment) / (0.16 or 0.12 m per repeat),
   strength 0.55-0.6 (`materials.FABRIC`; `spec["fabric"]`). Boots: the leather scan baked into their 1K normal (no detail slot for
   that class). Skin: `materials.skin_rgba` (cropped hair over MPFB's scalp region; the brow cards' texture painted in: no brow mesh).
7. **Sole**: the pack boot's 16 mm sole band is stretched to **28 mm** in every fit (`sole_height`), the same as B6's shoe, so swapping
   shoes does not change the ground offset; the package is lifted by that height.

Manifest: `wardrobe.slots[].garments[]` = `{id, label, meshes, source (side GLB, when not in the main GLB), bodyMask, colourways:
[{id, label, srgb, materials: {<material>: {color}}}], licence, author, worn, soleHeight}`; `wardrobe.outfits[] = {id, label,
wear: {slot: {garment, colourway} | null}}`; `wardrobe.bodyMask` and `wardrobe.layering` record the numbers above. This is what
`viewer/src/main.ts` reads today (FORMAT.md has no wardrobe block yet: RL, please take this text or correct it).

### Eyes (B5) and props (B6) inside the Operator build

- **Eyes are B5's now, called directly** (no `eye_kit.py` needed): `e = eyes.eye_context(c)`; the **body** (`e.base_v`, `e.targets`,
  `e.rig["W"]`, `e.rig["dqs"]`) and the **lashes** (fitted on `e.base_v`, weights from `e.rig["W"]`, `_DQS` 1) are built on it; skeleton =
  `e.rig["skeleton"]` (the body's joints + four lid joints); `eyes.eye_meshes(e, "shell")`, `eyes.eye_wet`, `eyes.eye_manifest`
  (manifest block `eyes`), lid joints added to `shape.jointDeltas`. Brows, cap, glasses, garments and props stay on the source body
  with weights from the MPFB default bones through `rig.for_layer` (indices in the first 82 joints), so nothing but the lashes blinks.
  The MakeHuman eye is no longer exported. B5: change iris colour with `build(iris=...)`; anything else you need is a change in
  `build_operator.build` between the lines `e = eyes.eye_context(c)` and `head.append(merge_meshes("lashes_brows", ...))`: tell me.
- Lens: alpha 0.025, roughness 0.03 (was 0.08 and veiled the eyes).
- **Rest expression** (`relaxed_expression`): MakeHuman expression units baked into the rest shape before the eye context is made:
  inner brows up 0.10 left / 0.07 right, brows up 0.04 / 0.02, mouth-corner-puller 0.07 and mouth-elevation 0.03 with the left side 30 %
  stronger; at most 1.0 mm, 964 vertices. Lid opening is left to `eyes.eye_lid_fit`. B5 or VD: give me other weights and I change the table.
- **Props**: `props.build(pre, skel.names, which=("headset", "collar", "shoes"), lift=0.0, pkg="operator-<sex>", body=<whole body>)` on
  the unlifted mesh list, both sexes; manifest slot `headset` (allowNone), `garment_collar` listed with the top that is worn, and
  B6's `shoe_safety_trainer` as a second `shoes` option (side GLB, its own body mask). `--no-props` leaves them out.
- Lashes are B5's `eyes.eye_lashes` (material `lashes_soft`); glasses are one mesh `glasses` (frame and lens told apart by `COLOR_0`
  alpha, one blended draw call); teeth are only in `garments/teeth.glb` (mouth closed in every pose). Default outfit: 12 draw calls.
- **Helper joints (RR, round 3)**: garments get them through `rig.for_layer` -> `RigPack.transfer`, which applies the same
  position-based helper weights as on the skin (read in `rig.py`, `_transfer` / `_helper_weights`); nothing to do here but rebuild.

### For B6: answers and the binding call

- Tops: **the work shirt is worn out over the trousers** (`worn: "out"` on the garment in the manifest): the belt is hidden.
- Mesh names (your `REFS` prefixes still match): `body`, `garment_top_shirt` / `garment_top_jacket`, `garment_trousers_work` /
  `garment_trousers_jeans`, `shoe_shoes_ankle_boot`, `garment_cap_work_cap`, `glasses`, B5's lash mesh, `eyeball_l`, `eyeball_r`,
  `eye_wetline`. **Changed in round 3: the boot's sole (28 mm, bottom 12 mm lower), glasses and lash mesh names, no `teeth` and no
  `lashes_brows` in the main GLB, a second top (`garment_top_jacket`, side GLB). Re-run your binding.** **Changed today: base body (B1 round 2, then a rest expression of at most 1 mm on the face), shirt (new asset, 7 mm
  ease at the collar), cap mesh name (was `cap`). Re-run your binding.** I add a line here whenever base or names change.
- Collar-flap mask and a closed trouser waist: not done. The shirt's collar is not a separate UV island in this asset; I can give you
  the triangles within 45 mm of its neck border loop (`Garment.border`) as a start, and the trouser waist has a 22 mm inner lip
  (`wd.Rim`), not a cap: say which you need.
- Binding a modelled mesh the way garments are bound (follows any body, same morph names):

```python
import mh_wardrobe as wd, build_body as bb
c = bb.context("m")
a = wd.bind_mesh("belt", v, tris, c.base_v, c.tris, uv=uv, tri_uv=tri_uv, mode="nearest")   # mode="rigid": one body triangle, head scale references
g = a.fit(c.base_v + c.targets["pc03"]); Wd = a.weights(c.rig.weights)                      # then rig.for_layer(c.pack, Wd, a.fit(c.base_v))
```

### Needs from others

RL: a tiling weave detail normal for `cloth` beside the fold normal map (a 2K outfit atlas is 1.4 px per mm); a soft front fill under the
cap brim; line-up shots need two packages now that the body is one per sex (G1 is skipped on `operator-m`). RR / B3: lap correctives (shirt
hem and trouser lap collapse 25-34 mm at hip 95). B6: the props sized on `operator-f` too; shoes on a last; draw calls are 14 with
headset and collar (limit 12).

---

## Motion (owner: B4) — `motion.py`, `mo_math.py`, `mo_bodies.py`; run time: `viewer/src/operator.ts`

Status (B4, round 6, the designer's REVIEW-05 item 3 and the seat placement): **a real relaxed stand, a captured standing clip,
a new seat rule.** Everything is in the motion block the builders already merge (`packages/body-clay/clips/manifest-block.json`,
`packages/body-clay-f/clips/manifest-block.json`); the clips are baked per packet person, all ten.

- **Why I1 was eight identical pictures:** not the clip. `walk.glb` moves (44–107° joint change between the sampled frames, 3.3 m
  of travel). The `{ shot: true }` defaults in `viewer/src/main.ts` `lab.apply` carry `pose: {}`, and `setPose` ran after
  `setClip`, which stopped the clip, so every clip frame was the rest pose (the splayed hands of HF14). The renderer engineer fixed
  it (21:10: pose first, clip wins; `poseAdd` puts dof offsets such as C6's head turn on top of a clip frame).
- **`RELAXED_STAND` = `{ clip: "idle-stand", time: 1.0 }`** (the packet's own definition: the frame at 1.0 s of IDLE_STAND), plus
  `dofs`: one dof set that holds on every person of the package, for a renderer that needs a dof pose. The stand (`motion.py`
  `STAND`, every value commented): weight on the right leg, hip centre 35 mm toward it, pelvis dropped 3° and turned 3° on the free
  side, free foot 40 mm forward, stance knee 4° (free knee about 18°, by IK), shoulders tilted 2° the other way, thorax 1° forward,
  head level; upper arms 3° forward, elbows 14°, palms to the thighs 15° back, wrists 6°; **hands: the pose library's
  `HAND_RELAXED`** (RR's dofs, both sides); feet flat on their rest heights. **Shoulder abduction is solved per body and side** on
  the person's own skinned mesh (body and abstract packages; the dressed body is the body package's mesh): the smallest angle at
  which forearm, elbow and hand stay 12 mm clear of trunk and thighs and the upper arm is no deeper than 18 mm into the chest side
  (it rests on the flank; 5 mm would take 17–24° and the arms stand out, looked). Numbers: `clips/relaxed-stand.json`.
- **`IDLE_STAND` = `idle-stand`** (8 s loop): the stand under a slow layer (pelvis sway and roll, breathing, head drift, arm sway,
  finger life), every term zero at 1.0 s. **The layer is procedural, not captured**: no standing idle take is on disk.
- **`MOVE_STAND` = `move-stand`**, captured: CMU 86_15, 0.0–9.0 s, a slow walk (0.4–1.0 m/s) round a loop of about 1.2 m radius,
  turning about 380°; 9.0 s, so the packet's eight evenly spaced frames are 1.125 s apart. Retargeted with the existing code, plus
  these options of this clip (`CLIPS["move-stand"]`): a grounded foot keeps its heading (no swivel about the ball while turning),
  a swinging foot clears the floor by up to 12 mm (the take's feet skim it), the heel's back edge (+35 mm for a shoe) stays out of the floor, the toes are eased and point up while the ball is near the floor, a grounded foot does not roll onto its edge; the
  actor watched the floor (head 29° down on average), so the gaze is raised by a constant to 12° down, every head movement kept.
  Hands: the library's relaxed hand with a small finger life.
- **Foot slide, measured without contact labels** (`motion.py foot_slide`): heel and ball points count as down when within 2 mm of
  their planted height; their horizontal step between two down frames is the slide in mm per frame. `move-stand`: 3.1–3.9 mm/frame
  at most, 4.2–5.5 mm drift within one contact (99–107 mm/frame before planting); 15–19 mm/frame in a 5 mm band (toe lift-off and
  heel touch-down skimming); joint change 11.9–13.3°/frame; forearms and hands 0 mm inside the body (M95H 1.1 mm, abstract mesh).
  Stand, abstract mesh: forearm, elbow and hand 0 mm inside trunk or thighs on all ten, smallest gap 12–31 mm; abduction 5–8° (thin,
  mid), 8–11° (M50), 16–20° (M95H, M50_HEAVY), 21–24° (F50_HEAVY); upper arm up to 18 mm into the chest side (heavy builds). Table:
  `B4/NOTES.md`, round 6.

**Seat (the contact engineer's finding, `RL/contact-r6/NOTES.md`).** Two causes of the 31–50 mm sink, both measured:
1. **On the abstract and dressed packages the operator layer never found its person**: `motion.persons[*].key` is the rest head and
   left-hand position of the bare-sole body; those packages stand 28 mm higher on their soles, so no key matched (checked: 28.0 mm
   off, 0.05 mm after removing the lift). Without a person there are no collision capsules and the seat falls back to
   0.125 × thigh/0.44 (about 107–137 mm).
2. **The rule itself**: the pan was 20–37 mm above the person's popliteal height (operator.ts estimates it from joints: calf +
   ankle − 45 mm), so heavy thighs sank at the front edge; and the round-3 hip rule (30 % of the tissue, 20–40 mm) was taken on the
   0.5th percentile of the skin, which left 10–25 mm of deeper skin.

**Seat rule, round 6b (default, the coordinator's decision: seated dimensions first, looks second)** (per person,
`clips/<person>/motion.json` `seat`, so `motion.persons`): pan top at the person's survey popliteal height (manifest measure
`poplitealheight`, plus the package's sole) = `pan_drop_m` below operator.ts's joint estimate; hip centre `hip_above_pan_m` above it,
chosen so that **the seated eye height is the person's survey value (`eyeheightsitting`, a hard seat) less the cushion's own
compression**, `cushion_compress_m` = 20 mm (a firm 80 mm foam cushion deflecting about a quarter of its thickness; believed). The
eye is measured in the operator posture (trunk reclined 10°; the survey sits erect). Measured (`B4/seat-test.ts`, `motion.py
seatsink`, the sith check), seated eye vs survey / sitting height vs survey, mm: M50 −20.0 / −32.5, M95H −20.0 / −32.9, M50_HEAVY
−20.0 / −30.4, F05 −20.1 / −33.2, F50_HEAVY −20.0 / −31.7 (all ten: eye −19.9 to −20.1, vertex −29.9 to −33.2; so on the hard-seat
equivalent the eye is exact and the head top 10–13 mm low). Hip 60–83 mm above the pan. The buttock and thigh skin then sinks
deeper into the drawn pan (M50 52, M95H 63, M50_HEAVY 61, F05 46, F50_HEAVY 40 mm, abstract mesh, flatten off; `compress_m`
carries it per person) for the contact flatten to read as compressed tissue. Hands on grips and feet on pedals 0.00 mm.

**Option `seatRule: "compression"`** (`lab.apply({ plugins: { operator: { seatRule: "compression" } } })`): round 6's rule, the
deepest skin `compress_rule_m` = 15 mm + 10 mm × (BMI − 19)/15 (15–25 mm) into the pan (`hip_above_pan_compression_m`, 85–159 mm);
it puts the men's seated eye 47–56 mm above the survey (their seated mesh hangs about 5 cm lower under the hip than the survey
heights allow) and the women's within ±10 mm (F50_HEAVY +33).

**`viewer/src/operator.ts`, round 6 (B4; mine again after the contact and renderer engineers finished):**
- Person match in the bare-sole frame (`rest.soleHeight` taken off the key): the shod packages now find their person (capsules, seat).
- The seat above, from `motion.persons[*].seat` (`hip_above_pan_m`, `compress_m`, `pan_drop_m`; `seatRule` option for the compression rule).
- **Seat depth fitted per person: the pan's front edge 50 mm short of the person's seated knee crease** (knee joint less the thigh's
  radius there, from the capsules), never deeper than the rig (front edge 0.38 m ahead of the hip centre); `T.seatFront` (set it to
  fix the depth: a front edge beyond the crease is then reported in `state.report.clash`, not hidden). One token in the contact
  engineer's seat-pan block: `front = T.seatFront ?? 0.38`.
- **Two-bone IK hinge sign** (`twoBone`): a sign flip mirrored the rest hinge, so the upper arms and thighs were turned 166–180°
  about their own axes and the elbows and knees bent the other way round their rest hinge; the twist drivers flipped wherever that
  crossed 180°. Removed (twist now 0–14°, elbows and knees flex about their own hinge).
- Feet pivot on the back edge of the heel plus 15 mm for a shoe (`heel_back_m` from the fit), pedal hinges moved under it.
- Grips raised until grip and closed hand clear the thighs by 15 mm over the stick's whole travel; armrest pad 5 mm lower; the
  backrest only touches the upper back (it took 15 mm the plane flatten does not reach there).
- Packet metrics (renderer's own, abstract-m / operator-m, OPERATE M50, F05, M95H): joint change 180 -> 8.3°/frame; shoes below
  the floor 5.3–7.3 -> 0 mm; F05 calves in the seat front edge 36 -> 0 and in the pan 22 -> 0 mm; thighs and forearms in the
  armrests 10–15 -> 0; F05 forearm in the trunk 12 -> 0, M95H 27 -> 8 mm; grip errors 1.1–2.2 mm.
- **Grip <-> touchscreen path (6b)**: the hand left the grip by pulling back with the fingers wrapped round it (left little finger
  20 mm inside, 2.2 and 3.8 s); now it slides up the stick (14 cm), crosses over held up, turns over a wider span and comes down onto
  the touch point (`blend`). Left grip penetration 20 -> 5–7 mm (F05 7.2, M95H 5.0; the short woman's touch point lies close above
  her raised grip); joint change under 15°/frame.
- **MOVE_STAND shoes (6b)**: the 6 mm was foot roll (a grounded foot kept the take's inversion and the sole's edge went in), not heel
  or toes. A grounded foot's roll is levelled in `plant` for shod clips; shoes 5.9 -> 1.4 mm (renderer). The renderer's 24.8 mm
  "slide" counts heel and toe roll within 12 mm of the floor; the label-free 2 mm-band measure reads 3.1–3.9 mm/frame, drift 4.2–5.5
  mm per contact (limit 10).
- Operator clips re-baked on all of it (`B4/operator-test.ts`, `motion.py bake`).
- **Round 8 (REVIEW-06):** MOVE_STAND is now an upright walk: CMU 07_01's cleanest cycle (seam closed) walked on for 4.5 cycles,
  4.93 s (`CLIPS["move-stand"]`, `tile`; the 86_15 loop walk is kept as `move-stand-86`, not built). Foot slide by the packet's own
  measure (`motion.py packet_slide`, the same rule as `viewer/packet.ts`) 8.0–9.8 mm on all ten (limit 10); joint change ≤ 15.1°/frame.
  **B1: re-merge the block** (MOVE_STAND duration 4.93; the packages still say 9.0, so the packet samples past the end and wraps).
  Grips: each stick stands on a mount (housing under the pivot, L-bracket to the armrest front); the pivot rises and the stick
  shortens (to 60 mm) until the mount clears the thigh capsules by 10 mm; what cannot clear is reported (`state.report.clash`, prop
  `clash: true`): the women's mounts touch by 1–4 mm (capsule measure), an ergonomic finding. Packet: stick and mount in the thigh 0 mm
  (was 5.9–7.0). **Not fixed: the left hand 7.2–7.6 mm into its grip on release and return** (limit 3).
- **Round 9: finger, palm and forearm against the grip (`operator.ts`).** `clampFingers`: each finger and thumb segment is a capsule
  of its radius measured on the hand mesh (`B4/finger_radii.py`; `SEG_R`, median man per unit hand size, F05 and M95H within 1 mm);
  where one enters the grip cylinder by more than the held grip itself has it (+0.5 mm), that finger opens, distal joints first,
  at most 240°/s opening and 90°/s closing, holding on a same-frame re-solve (the packet's dt 0 had made it jump 42°). Palm (three
  wrist-to-knuckle capsules, 24 mm per unit hand) and the forearm's last 120 mm are pushed off the grip; the held grip's own contact
  is allowed on the stick and fades out as the hand leaves; toward the screen the correction turns the hand about the fingertip.
  Between grip and screen the fingers take the pointing shape only after the fist is off the stick. Packet (I2, I3): hand-on-grip
  error while gripping M50 0.9, F05 1.7, M95H 1.1 mm; release/return M50 1.1, F05 1.8, M95H 1.2 mm (was 3.8, 7.2, 3.9); F05's palm
  at the screen 4.6 mm clear of her grip (was 2.5 in); joint change ≤ 13.7°/frame. Operator clips re-baked.
- **Round 7**: stand-in armrests stand on a post down to the seat pan (`standInProps`; seat-pan block unchanged). MOVE_STAND: the
  delta retarget leaned the trunk 6° more than the actor (hip-to-neck line 10.7° against 4.7° from vertical), read as a stoop in the
  side views; `match_trunk` takes the mean difference out above the pelvis (now 5.7°). Heel strike pivots on the heel's back edge
  (+15 mm for a shoe) instead of lifting the ankle over it. Renderer: shoes 1.3 mm under the floor, joint change 11.4°/frame.

**Builders, to take all of it in:**
- **B1** (`pipeline/build_body.py`, `merge_motion`): let the block's poses replace yours (RELAXED_STAND):
  ```python
  for k, v in b.get("packet", {}).items():
      if k == "poses": man["packet"].setdefault("poses", {}).update(v)
      elif k != "clips": man["packet"].setdefault(k, v)
  ```
  then `$PY -I pipeline/build_body.py --merge-motion` (both sexes). No rebuild needed.
- **B7** (`abstract.py`): nothing new; the next rebuild after B1's merge copies `clips`, `packet.clips`, `packet.poses` and
  `motion` from the body package and relinks the clip paths, as now.
- **B2** (`build_operator.py`, after `man = bb.build(tmp, sex)`): the dressed packages get no motion today (the body manifest is
  rebuilt in a cache folder without the block). Add:
  ```python
  bb.merge_motion(man, os.path.join(LAB, "packages", bb.NAMES[sex]))
  rl = lambda o: {k: rl(x) for k, x in o.items()} if isinstance(o, dict) else [rl(x) for x in o] if isinstance(o, list) else ("../%s/%s" % (bb.NAMES[sex], o) if isinstance(o, str) and o.startswith("clips/") else o)
  man["clips"] = rl(man.get("clips", []))
  if "motion" in man: man["motion"] = rl(man["motion"])
  ```
- Proof copies made exactly that way (manifest patched, big files linked): `B4/proof_packages.py` -> `B4/packages/`.

```
$PY -I pipeline/motion.py stand --package packages/body-clay --also packages/abstract-m        # stand, idle, move-stand, block
$PY -I pipeline/motion.py stand --package packages/body-clay-f --also packages/abstract-f      # (--persons P, --move-only, --persons -)
bun work/avatar-lab/B4/seat-test.ts <dir> fallback|fit|new [hip.json];  $PY -I pipeline/motion.py seatsink --dir <dir> --mode <m> --also abstract-m,abstract-f
$PY -I B4/proof_packages.py;  bun work/avatar-lab/viewer/packet.ts work/avatar-lab/B4/packages/abstract-m --also work/avatar-lab/B4/packages/abstract-f --out work/avatar-lab/B4/pictures/r6/abstract-m --only B1,G1,I1 --no-bench
```


Status (B4, round 5): 100-joint packages. `motion.py rest --package` writes `clips/<person>/rest.json` for **every** packet
person, so the seated operator is fitted and baked for all ten (captured clips still for F05 / M50 / M95H). Feet rest on their
home pedals; armrest pads are placed clear of each body's capsules, and what cannot be cleared is reported
(`plugins.operator.state.report.clash`, `.collision`, `.person`; props carry `role`, `shadow`, `clash`). Seated shots:
`packets/b4-motion-{m,f}/round-04/`. **B1: please re-merge `clips/manifest-block.json`.**

Status (B4, round 4): re-baked on the v0.4 packages (92 joints; the shape is read from `<name>.shape.bin`). The order is
`build --package` → `NO_FIT=1 bun B4/operator-test.ts` → `fit --package` → `bun B4/operator-test.ts` → `bake --package` →
`skin --package`. **B1: the merged `motion` block is stale; re-merge `clips/manifest-block.json`.** Set I: `packets/b4-motion-{m,f}/round-03/`
(rendered from the derived manifest in `clips/`).

Status (B4, round 3): per-person collision capsules and seated tissue extents are measured at bake time
(`motion.py fit --package`, after a first `operator-test.ts` pass; then `operator-test.ts` again, `bake`, `skin`) and written to
`clips/<person>/motion.json` and `motion.persons` in `clips/manifest-block.json`. `operator.ts` uses them for a collision-aware
elbow swivel and for seating the body on its own tissue, and publishes `plugins.operator.state.contactPlanes`
(`[{ name: "seat" | "backrest", point, normal, compress_m }]`, avatar frame, metres) for RR's helper joints and the viewer's
contact flatten. New clip `idle-stand` (synthesised, not captured). Every clip starts over the origin facing +Z. Set I:
`packets/b4-motion-{m,f}/round-02/`.

Status (B4, round 2): **clips are baked per packet person on the real packages** (`packages/body-clay/clips/{M50,M95H}/`,
`packages/body-clay-f/clips/F05/`), skin numbers in `clips/metrics-skin.json`, set I rendered through the packet renderer
(`packets/b4-motion-{m,f}/round-01/`). Round-2 commands:

```
$PY -I pipeline/motion.py build --package packages/body-clay      # six clips per packet person + rest.json + metrics.json
bun work/avatar-lab/B4/operator-test.ts                           # operator.ts on those bodies -> <person>/<script>.frames.json
$PY -I pipeline/motion.py bake --package packages/body-clay       # -> operate8.glb, demo30.glb, manifest-block.json, <name>.motion.avatar.json
$PY -I pipeline/motion.py skin --package packages/body-clay       # skinned-mesh measurements (grip, arms in body, seat pan)
bun work/avatar-lab/viewer/packet.ts work/avatar-lab/packages/body-clay/clips/body-clay.motion.avatar.json \
    --out work/avatar-lab/packets/b4-motion-m/round-01 --shots work/avatar-lab/packages/body-clay/packet-shots.json --only I --no-bench
```

**B1**: please merge `clips/manifest-block.json` into the manifest (`clips`, `packet.clips`); until then the derived manifest in
`clips/` is what opens with motion. **RL**: the plug-in needs the body's girth to keep forearms out of the flank
(`ctx.measures` or the person id would do). Round-1 status, kept for the record: clips, measurements and the seated operator ran on stand-in bodies (the 82-joint
skeleton placed on the hm08 mesh for F05 / M50 / M95H, `B4/standin/`). No package is on the 82-joint skeleton yet:
`motion.py check` fails on `body-clay`, `operator-m`, `operator-f` (they carry the 163-bone MPFB rig), as it should.

```
PY=$MANIKIN_PYTHON        # from work/avatar-lab
$PY -I pipeline/mo_bodies.py                               # stand-in bodies -> B4/standin/<person>.json + .glb (clay, crude weights)
$PY -I pipeline/motion.py build                            # -> B4/clips/<person>/<clip>.glb + <clip>.json, B4/metrics-retarget.json (35 s)
$PY -I pipeline/motion.py check --package packages/<name>  # exit 1 and a loud list if joint names, parents or rest frames differ
$PY -I pipeline/motion.py build --package packages/<name>  # once the check passes: -> packages/<name>/clips/ on the package's base body
bun work/avatar-lab/B4/operator-test.ts                    # seated sequences headless on three bodies -> B4/metrics-operator.json
bun work/avatar-lab/B4/strips.ts [name filter]             # B4's own frame dumps (stand-in, clay) -> B4/pictures/
```

**Clips** (CMU ASF/AMC, 30 fps, rotations on the mapped joints, translation on `pelvis`, and on `root` for the loop):
`rom-a` (143_21), `rom-b` (79_22), `walk` (07_01), `walk-loop` (one cycle of 07_01; `root` carries the constant
velocity), `sit-down-get-up` (143_18), `seated-base` (86_15) plus `seated-idle.json` (a 20 s additive layer for
`operator.ts`). Each `<clip>.json` holds the source take, the CMU credit line, per-frame foot contacts
(0 none, 1 heel, 2 ball, 3 flat), the skeleton signature the clip was baked on, and its measured numbers.

**What the pipeline does**: own ASF/AMC reader → despike and 7 Hz zero-phase low-pass on world rotations → 30 fps →
world-space retarget in "delta space" (a joint's world rotation away from rest; T-pose to A-pose offsets by shortest
arcs down each limb; so the maths is independent of joint-frame conventions, only the exported numbers are not) →
pelvis path scaled by leg length → neck spread thorax-to-head (CMU's own split flips) → feet re-planted where the
*source* foot is down (pivot locked at the heel, then the ball; two-bone IK; pelvis lowered where a leg would
over-stretch; toes kept out of the floor) → arms pushed out of the body's own volume (torso sections and thigh
capsules measured on that body's mesh) → wrist twist spread onto `lowerarm_twist_01/02` → relaxed fingers.

**A clip is baked per body.** The viewer's rule (one clip, pelvis offset scaled by leg length) is measured in
`metrics-retarget.json` under `median_clip_played_on_other_body`: feet slide 4–26 mm and arms enter the heavy body.
For slider bodies a run-time foot planter is needed (contacts are in the sidecar for it); not built.

**Interfaces I need / propose**

- **B1 / RR**: a package on `rig.JOINTS` (world-aligned rest frames: the stand-in has the same, so the signature
  should match). Then `motion.py build --package`. For other persons I need rest joint positions per person:
  `ctx.skeleton` evaluated at the packet persons, or `jointDeltas` + preset weights in the manifest.
- **RR, finger poses: one library, yours.** `rig.HAND_POSES` → `poses` in the manifest is the source;
  `operator.ts` `adoptHandPoses(manifest)` replaces its built-in numbers with `HAND_RELAXED`, `HAND_POINT`,
  `HAND_FIST`, `HAND_GRIP40` when it finds them (dof ids `<finger>_0<k>_r.flex`). Please add `HAND_FLAT` (palm on an
  armrest or screen). `operator.ts` keeps only the per-body wrap of the power grip (flex each finger joint until the
  next joint touches the cylinder) and uses your `HAND_GRIP40` where the wrap cannot reach.
- **B5, eyes**: `operator.ts` owns `neck_01`, `neck_02`, `head`; `eyes.ts` owns `eye_l`, `eye_r`, lids, blinks,
  saccades. Each frame the plug-in publishes the gaze point (world, metres) as `plugins.operator.state.gazeTarget`
  and calls `globalThis.rigtwinEyes?.setGazeTarget(point)` if you register that object. Hand-over rule: the eyes go
  to the target at once; the head turns only for the part of the gaze angle beyond ±12° (plus 35 % of the part
  inside), critically damped (about 0.35 s), shared 25 / 30 / 45 % over `neck_01` / `neck_02` / `head`; so compute
  eye-in-head from the head's *current* pose every frame (run after the plug-in) and the eyes counter-rotate while
  the head catches up. Until `eyes.ts` exists the plug-in aims the eye joints itself (clamped to 35°); it does not blink.
- **RL**: two lines at the bottom of `viewer/src/plugins.ts`:
  `import { seatedOperator } from "./operator.ts"; plugins.push(seatedOperator);` then
  `lab.apply({ plugins: { operator: { on: true, script: "operate8" | "demo30", time: <s> } } })`. The stand-in rig
  (`standInProps(op, controls)`: boxes and cylinders) is not drawn by the viewer; targets are parameters
  (`state.targets`, type `Targets`), so the plain seat's grips can be passed in.

---

## Viewer conventions the pipeline must meet (RL, 2026-11-24; the full text is `../FORMAT.md` v0.3)

- **Dual-quaternion mask**: the vertex attribute is **`_DQS`** (SCALAR float), not `COLOR_0` (three multiplies the base
  colour by `COLOR_0`).
- **Body under cloth**: do not delete body triangles. The body mesh stays complete; each garment brings
  **`bodyMask`** = an 8-bit image in the **body's UV0 layout, the same way up as the body's base-colour image**,
  white = skin hidden, ending **6–10 mm inside** the garment's opening with a soft ramp, continuous across UV seams
  (pad islands 8 px or more). Optional **`cover`** (same layout, starting about 15 mm inside the opening) = where skin
  must never show; the packet's zero-skin-pixel test counts skin there. The viewer combines the masks of what is worn
  (lighter wins), cuts the skin with an anti-aliased edge and pushes masked skin 3 mm inward (`maskPush`).
- **Garment hems** may be cut per pixel as well: `alphaMode: "MASK"` with the cut in the base-colour alpha.
- **Cloth detail normal**: `materials.<name>` keys `detail` ("weave" | "twill" | "knit" | "leather" | "none") or
  `detailNormal` (a tiling image), `detailScale` (repeats per unit of UV0), `detailStrength`. Applied on top of the fold
  normal map. Poly Haven fabric normals can go in `detailNormal`.
- **Wardrobe and styles** blocks: FORMAT.md section 2a (the Operator packages already follow it). An abstract style
  needs the complete body.
- A fault of mine that showed in your probes: dual-quaternion normals were wrong whenever the figure was turned (dark
  flanks, sleeves, inseams). Fixed in `viewer/src/dqs.ts`; re-render before judging those patches.
- **Seat contact (round 6)**: the seat pan is a solid (80 mm cushion, 560 mm wide, square sides, 40 mm bull-nose front edge,
  drawn by `standInProps` and handed to `viewer/src/contact.ts` as the seat plane's `pan`), not a plane. Skinned vertices
  inside it move out along its own surface normal (up on the top, turning forward over the nose). A mask on the **rest**
  position decides how far: thigh and buttock are brought fully onto the seat with a 20 mm soft edge and a small sideways
  bulge; knee, back of the knee and calf get contact only (12 mm brought out, nothing beyond 30 mm), so the knee never
  flattens. Garments take part the same way (their rest positions). Nothing to supply from the pipeline; the only input is
  the rest knee and hip heights the operator layer reads from the skeleton. Notes and before / after: `RL/contact-r6/`.
  **Round 7: volume kept.** Each frame (once per pose change) the viewer draws the body flat from below into a 64 x 64 "sink
  map" per contact surface (seat, backrest): how deep thigh, buttock and back lie inside it. The displaced tissue is put back as a
  soft roll beside the contact (sides and back of the buttock, sides of the thighs; up along the backrest where it blocks), so the
  seated body keeps its volume within 0.3 litres. Nothing to supply from the pipeline. `RL/contact-r7/`.

---

## Correctives (owner: B3) — `correctives.py`, `pc_*.py`, `pc_data/`

Status (B3, 2026-11-24): **14 targets delivered (elbow, knee, wrist, shoulder forward 90); hip, shoulder abduction and
neck are NOT delivered: neither source of shapes improved them (measured, `B3/NOTES.md`).** Naming note: RP's shape
morphs are `pc00…` (no underscore); the pose correctives are `pc_<joint>_<side>_<pose>`.

```python
import correctives as pc
out = pc.add_correctives(ctx)        # ctx = bb.context(); or a dict {"base_v": (19158,3), "pack": RigPack}
out["correctives"]                   # name -> (19158,3) deltas on the baked rest shape, metres: same form as ctx.targets.
                                     #   Body: add to the body mesh's morphs. Garments: fit(base_v + d) - fit(base_v).
                                     #   Helper geometry near the skin carries the delta too (clothes bind to it).
out["corrective_drivers"]            # FORMAT.md records to append to the manifest's `drivers`:
                                     #   {"type":"morph","target":"pc_elbow_l_90","dof":"elbow_l.flex","from":0,"to":43.1}
                                     #   {"type":"morph","target":"pc_elbow_l_135","dof":"elbow_l.flex","from":43.1,"to":88.1}
                                     #   {"type":"morphPose","target":"pc_shoulder_l_fwd90","joint":"upperarm_l","pose":{…},"radius":75}
out["corrective_info"]               # per-target max mm and vertex count, source per key pose, skinning solved against
pc.driver_weights(pack, drivers, dof_values)   # reference evaluation of those drivers for one pose (what the viewer must do)
```

- Deltas are **rest-pose deltas, applied before skinning**, solved against the viewer's own deformation:
  `rig.pose_matrices` + `rig.skin(V, J4, W4, M, dq_mask)` (4 influences, masked dual quaternion). If the weights, the
  mask or the twist drivers change, call `add_correctives` again: a corrective is only exact for the skinning it was
  solved against. `mode="linear"` / `"dual"` solve for the viewer's debug modes.
- Hinges have two key poses (90° and 135° anatomical); the second target is stored as the step from the first, so both
  drivers are plain 0→1 ramps on the same dof and add up. Angles in the drivers are dof degrees from the rest pose.
- `SOURCE` (in `correctives.py`) says where each key pose's target shape comes from: `"contact"` (own contact +
  volume solve, `contact_target`), `"soma"` (SOMA-X corrective model on SOMA weights, carried over the Anny wrap),
  `"soma+contact"`, `"none"`. Change it only with numbers from `pc_rom.py`.
- Needs at build time: `downloads/soma-x/assets/` (122 MB, Apache-2.0) and torch (the Anny environment), only for the
  `"soma"` targets. `pc_data/anny_to_hm08.npy` = Anny vertex -> hm08 vertex; `pc_data/soma_rig_cache.npz` = parsed USDA.
- Licence line for a package that ships `pc_wrist_*` or `pc_shoulder_*`: "pose corrective shapes derived from NVIDIA
  SOMA-X 0.3.0 (Apache-2.0), https://github.com/NVlabs/SOMA-X". The elbow and knee targets are our own computation.

Checks: `$PY -I pipeline/pc_rom.py --persons=M50,M50_THIN,M50_HEAVY,M95H --tag=final` (RR's `rig_rom.analyse` on
`packages/body-clay`, before and after, package untouched, writes `B3/rom-before-after-final.md`);
`$PY -I pipeline/pc_proof.py --bodies=median` (own metrics and clay close-ups into `B3/pictures/`).

---

## Props (owner: B6) — `props.py`, `prop_model.py`, `prop_shoe.py`, `prop_geo.py`, `prop_io.py`; `packages/props/`

Status (B6, 2026-11-24, round 4): **the abstract style's last is new; not reviewed.** Headset, collar band and the mid-cut
safety trainer are as in round 3 (both sexes, 102 joints, 40 shape components). Belt: not maintained, do not use. Faults and
what was looked at: `B6/NOTES.md` (round 4 at the end). Nothing third-party: every prop is modelled by script, no brand marks.

**The round-4 last** (`prop_shoe.CleanLast`, every number in `prop_shoe.R4`): a simplified low work trainer in one piece, built
ray by ray round the ankle joint. The **collar is the upper's own top edge**: it lies on the skin all round (1.3 mm into the
leg), hugs the leg 2.6 mm off the skin (3.8 mm at the heel), rolls over a soft edge about 2 mm high and closes inside with a
9 mm lining and a floor: no lip tube, no step, no funnel part. It is low at the sides, under the ankle bones (0.655 x the ankle
joint's height above the bare sole: 55 mm man, 44.5 mm woman), 0.86 x at the heel, 1.13 x at the front of the ankle. Plan: the
foot's footprint hull with a round toe, set out 3.5 mm, 9 mm toe room; walls the foot + 5 mm; vamp and toe box one designed
dome (a wall and a superellipse roof) 8 mm over the toes, 4.5 mm over the instep; the foot is at least 2 mm (normal) inside
the toe box. Sole: one band with a crisp ledge and a rounded foot, 33 mm at the heel and 25 mm at the forefoot (the drop), toe
spring 18 mm at the tip, heel bevel, 28 mm under the bare sole from the heel to the ball as before. Heel counter and toe
bumper as overlays. **12,464 triangles a pair** (round 3: 3,628). The last now carries the body's **eight influences and
`_DQS`** (interpolated from the body triangle under each vertex), so the collar moves exactly as the skin it lies on.

**Round 5 (2026-11-25, the coordinator's fix of B7's final K1):** heel tab 0.95 x the ankle joint's height (80 mm man, 64.6
woman; was 0.86), front 1.08 (91 / 73; was 1.13) rising later (`p_front` 3), so from behind the back edge runs up into the
sides instead of two points at the corners (about half their old height remains at el 10); the heel counter's edge is one
smooth sweep with a soft bevel that runs down under the sole's ledge, it ends at 100 degrees and no longer meets the toe
bumper (their junction was the 4 mm S-jog on the inner heel). 12,296 triangles a pair. **Sources installed in
`packages/props/src/operator-{m,f}/` (B6, 2026-11-25 on the coordinator's word): B7 rebuilds with steps 2 to 4 below.**

**To B7 (abstract style): rebuild `packages/abstract-m` and `abstract-f` on it, exactly so** (from `work/avatar-lab`):

1. Put the tested sources in place (B6 does not write `packages/`): `cp B6/r4src/operator-m/last.npz
   B6/r4src/operator-m/last.meta.npz packages/props/src/operator-m/`, and the same for `operator-f`. (Or make them anew:
   `$B -b -P pipeline/prop_model.py -- --pkg operator-m last`, the same for `operator-f`; it writes there and reads
   `B6/cache/ref-operator-{m,f}.npz`, refreshed 21:44. Run `$PY -I B6/prop_ref.py operator-{m,f}` first if the base body changed.)
2. One line in `abstract.py` `last_cut`: the new last has no separate funnel (lining and floor belong to the upper), so
   `floor` stays `inf` and the cut is `lip - leg_below_lip` (lip = `last.meta.npz: collar_height`, now the **lowest** collar
   edge: 55.2 mm man, 44.5 mm woman, so the leg is cut at 35.2 / 24.5 mm, 12 mm under the lining floor's lowest point).
   That is right as it is, but `"funnel_floor_lowest_mm": inf` is written to the manifest as `Infinity`, which the
   browser's JSON parser rejects: write `None` when it is not finite. Nothing else in `abstract.py` changes.
3. `$PY -I pipeline/abstract.py`. Expect: last 12,464 triangles a pair; the body keeps about 2,600 more triangles (the foot
   from 35 mm up stays inside the shoe); total about 112,700 / 112,900; GLB about 12.8 MB (was 9.3: mostly the last's 40
   GPU shape morphs on 8,300 vertices).
4. Check: `B7/abs_collar.py` no longer finds the last's parts (it looks for a lip tube and a funnel); use
   `$PY -I B6/r4_collar.py packages <out.json> packages/props/src` (part of each vertex from `last.npz: role`) and
   `$PY -I B6/r4_fit.py packages packages/props/src` (the bare foot inside the last). Shots: `--shots B6/r4-shots.json`
   (F9, W4b, K1, A1, E34, E35, E36, K5 on five builds).

B2 (dressed style): nothing changes; the trainer (`build_shoe`) and `props.build` for headset, collar and shoes are as in
round 3 (the eight-influence path is taken for the last only). Still standing from round 3: the trainer is mid-cut with no
sock, so its body mask must end 6 to 10 mm below its lip (about 105 mm above the bare sole on the man); the collar band
(`garment_collar`) is a band only, so the shirt's mask must end below its top edge.

```
PY=$MANIKIN_PYTHON;  B=work/avatar-lab/tools/Blender.app/Contents/MacOS/Blender      # from work/avatar-lab
$PY -I B6/prop_ref.py operator-m                             # reference: garments from packages/operator-m, whole body from packages/body-clay
$B -b -P pipeline/prop_model.py -- --pkg operator-m headset collar shoes last [--sole 0.028]   # -> packages/props/src/operator-m/*.npz, maps/*_ao.png
$PY -I pipeline/props.py packages/operator-m [--which headset,collar,shoes]    # -> a TEST side GLB packages/props/operator-m-props.glb (mesh names end in _b6)
                                                             #    and a lab-viewer manifest packages/props/operator-m/operator-m-b6.avatar.json
bun work/avatar-lab/viewer/serve.ts   ->  ?pkg=/work/avatar-lab/packages/props/operator-m/operator-m-b6.avatar.json     (from the repository root)
```

(`operator-f` the same; its whole body comes from `body-clay-f`.) The props are **sized on the package they are built
for**: ear, mouth and neck from the `eye_l` joint, foot and leg from `foot_l` and the body's vertices, cap and top by
mesh-name prefix. After a change of base body or wardrobe run the three steps again, **while the packages are at
rest**. The test manifest points at B2's own files (no copy) and hides B2's built-in copies of the props; its shoe has
no body mask on purpose (any skin outside the shoe is a poke-through).

In `build_operator.py` / `abstract.py`, before `write_glb` (both call it already):

```python
import props
extra, mats, info = props.build(meshes, skeleton.names, which=("headset", "collar", "shoes"), lift=LIFT, pkg="operator-m", body=whole_body)
# meshes: glb.Mesh list (names by prefix: body, garment_cap*, garment_top*); body: the WHOLE body mesh (feet) with .morphs and .weights;
# lift: what has been added to y relative to bare soles on y = 0.  info["soleHeight_m"] = 0.028 with these shoes.
# which=("last",) -> mesh `shoe_last`.  Ready-made on the clay bodies: packages/props/body-clay-last.glb, body-clay-f-last.glb.
```

Returned meshes: `prop_headset`, `garment_collar`, `shoe_safety_trainer`, `shoe_last`; the reference's morph target
names (a body whose shape is baked from `<name>.shape.bin` is read through `_SRC`: `prop_io.load_package`), explicit
normals, per-vertex UVs, dense weights; one material per prop (`prop_<name>`, viewer class `plain`): base colour +
ORM (baked ambient occlusion in R) + normal map (faint grain; on the shoe a stitch line 2.7 mm inside every overlay
panel's edge), painted from the zones in `packages/props/zones.json`. **No UV island holds two material zones**, so
zone borders are geometric edges, sharp at any distance. Atlases: headset 1024, shoes 2048, others 512.

How each follows the body: **headset** skinned to `head` only; cups translate with the skull round each ear, the band top
with the cap, the band flexes between; cushion faces ride on the head surface. **Collar** every vertex on its nearest
triangle of body + top. **Shoes, last**: per side, the least-squares affine map of the foot vertices under each shape
component (fit error at worst 0.34 mm RMS), vertical part faded out below the insole (sole height and ground plane never
change), blended towards a surface binding on the leg (trainer: 55 % to 90 % of the collar height; round-4 last: from 26 to
5 mm under its collar edge). No morph normals on rigid and affine props. `_DQS` and the eight-influence attributes are
written on the last only (`props.SKIN8`, from the reference body's own attributes).

---

## Eyes (owner: B5) — `eyes.py`, `eye_*`; viewer: `viewer/src/eyes.ts`, eye / cornea / lash recipes in `viewer/src/materials.ts`

(Re-added 2026-11-24 evening: the first copy of this section was lost when the file was rewritten.)

Status (round 2): **in `packages/operator-m` / `-f` through B2's direct calls** (`eyes.eye_context`, `eye_meshes`, `eye_wet`,
`eye_manifest`; there is no `eye_kit.py` and none is needed). These signatures are frozen. Notes, numbers, sources and what
still reads wrong: `B5/NOTES.md`; pictures `B5/pictures/11..21-r2-*.png` (round 1: `01..10`).

```
$PY -I pipeline/eyes.py check [m|f]                     # lid numbers -> B5/lid-numbers.json
$PY -I pipeline/eyes.py test shell [--no-glasses] [--f] [hazel|brown|dark|green|blue|grey]   # -> B5/packages/eyes-shell[-bare][-f]/ (a bust)
bun work/avatar-lab/B5/eye_shots2.ts && $PY -I B5/eye_sheets2.py                              # round-2 proof sheets
```

```python
import eyes
e = eyes.eye_context(bb.context(sex))   # use INSTEAD of the body context for the BODY mesh and the LASHES only
e.base_v, e.targets     # lids re-seated on the ball (base and every shape target): opened to the designed iris coverage (1.2 mm
                        # top, 0.3-0.7 bottom), margin ring 0.12-0.40 mm above the ball, corneal bulge under the lid
e.skeleton              # the body's joints + eyelid_upper_l, eyelid_lower_l, eyelid_upper_r, eyelid_lower_r (children of head);
                        # eye_l / eye_r moved onto the centre fitted to the lid margin ring
e.W, e.dqs              # weights with the lid joints (lid vertices: head + 2 lids), `_DQS` = 1 on lids
e.W_src                 # the body's own weights padded to the new joint count: for caps, glasses, brows, hair
e.joint_targets         # + rows for the four lid joints (they move with the eye joints)
e.rig                   # dict(skeleton, W, joint_targets, dqs, lids) for the calls below
eyes.eye_meshes(e, "shell", W=e.W, names=e.skeleton.names)   # eyeball_l, eyeball_r (688 v each; COLOR_0 = eye-local position, no UV)
eyes.eye_wet(e, e.rig)                                        # (eye_wetline mesh, source vertices): tear line on the lower lids
eyes.eye_manifest(e, e.rig)                                   # manifest block "eyes"; add ["irisPresets"] = eyes.IRIS
eyes.eye_iris_texture(path)                                   # structure texture (R fibres, G pigment, B veins); colour = two manifest colours
```

Materials: `eye_ball` with glTF `extras.b5eye = {kind: "shell", limbus, irisPlane, scale}` and manifest
`{"class": "eye", "iris": {"outer": [r,g,b], "inner": [r,g,b]}, "catchLight": 0.32}`; `eye_wet` (`extras.b5eye.kind = "wet"`,
class `eye`); lashes: manifest class `lashes` (`alphaTest`, `darken`); a lens that only reflects (no veil):
`{"class": "cornea", "additive": true, "thinFilm": 0.5}`.

Viewer (`eyes.ts`, registered in `plugins.ts`, runs in `late`): `globalThis.rigtwinEyes.setGazeTarget(point | null)`,
`.setMode("portrait" | "screen" | "idle")`, `.blink()`; `lab.apply({ plugins: { eyes: { on, mode, seed, time, target,
targetRel: {az, el, dist}, script, gaze: {yaw, pitch}, blink, iris, ownHead, restLids } } })`. It reads the block with the
package's `rest.soleHeight` added, keeps every listed lid vertex above the eye surface for the current body shape, lid angle
and gaze, and does nothing for a package without an `eyes` block (abstract style).

**Round 3 (head at 1.2 m, review 04), what B2's build must change to carry it** (shown on my busts, sheets `B5/pictures/22..26-r3-*`):
1. `eyes.eye_lashes(e, erig, sex)` now returns lash line + short lash cards + caruncle + **brow cards** in the one `lashes` mesh, with a
   NEW atlas layout: regenerate the texture every build, `eyes.eye_lash_texture(path, sex=sex)` (delete the cached
   `B2/cache/eye_lash_soft.png`: the old file under the new UVs is garbage), and **drop the brow decal** from the skin albedo.
   Manifest: `"lashes_soft": {"class": "lashes", "alphaTest": eyes.LASH[sex]["alpha_test"], "darken": 1.0}` as before.
2. Rest face: replace `relaxed_expression` by `eyes.eye_rest_expression(base_v, sex)` (level, closed, slightly engaged mouth).
3. Skin detail: `"skin_body": {"class": "skin", "microTiling": 140, "microStrength": 0.16}` (pores of about 1 mm at 0.16 instead of
   2 mm cells at 0.35; `microStrength` is a new option of the skin recipe, default unchanged).
4. Do NOT use the additive thin-film lens (`class: cornea, additive, thinFilm`): it glares white over the eye. Keep the 2.5 % blend.
Viewer-side, already live for every package: portrait gaze at a far point 10 degrees off the lens with angle kappa 2.5 degrees
(the crossed eyes of review 04; the gaze rule is SUPERSEDED in round 4, below), shaded warm eye-white with a darker rim, a weaker soft eye light beside RL's rectangle.

**Round 4 (2026-11-24 night: crossed eyes at their cause, brows, lashes). What must be rebuilt** (numbers and pictures: `B5/NOTES.md` round 4,
`B5/pictures/r4/`, `27-r4-*`, `28-r4-*`):
- **B2 (wardrobe builder): rebuild every operator package** (`m`, `f`, and the medium / dark tones) with the current `eyes.py`, garments included.
  In `build_operator.py`: delete `if sex == "f": eyes.BROW_ASSET = BROW_F` (no longer read: brows are `eyes.BROWS[sex]`, eyebrow010 / eyebrow012);
  pass the tone's brow colour, `eyes.eye_lash_texture(lash_tex, sex=sex, brow_rgb=TONES[tone]["brow"])` (new optional argument; without it the
  light-tone colour is used); keep `"alphaTest": eyes.LASH[sex]["alpha_test"]` for `lashes_soft`: it now writes **0**, and any value above 0
  brings the hard painted edges back. Nothing else changes in B2's code. What the rebuild changes: the face round the inner corners in the base
  and in every shape target (`eyes.eye_canthus`, MakeHuman's `push2-out`, woman 1.0, man 1.6), lids re-seated, eye and lid joints about 0.7 / 0.9 mm
  toward the nose, the `eyes` block (centres, canthi, lift list), the `lashes` mesh (new brow cards, upturned lash cards, larger caruncle) and
  its atlas. Cap, glasses, headset and hair are fitted on the source body: unaffected. Check: `bun work/avatar-lab/B5/eye_measure.ts <package>
  --out <dir> --views C1az0 --conds primary,rule` then `$PY -I B5/eye_measure.py <dir>`: every iris within 1 mm of the opening's centre.
- Round 4b adds nothing to B2's code: the same rebuild also writes the longer lid list (`P.lift_list` 7 mm) that the run-time lid clearance needs
  on thin builds. Freeze check: the inner-corner correction moves the 445 hm08 rest vertices listed in `B5/canthus-vertices.json` (largest 3.27 mm
  woman, 5.23 mm man); the lid re-seat moves lid vertices as before.
- Live without a rebuild (round 4b): lash and brow cards alpha-blended (`viewer/src/materials.ts`, recipe `lashes`: premultiplied, depth write off,
  polygon offset, discard below 0.03; `blend: false` restores alpha-to-coverage), kept out of the shadow map and of override-material passes by
  `eyes.ts`; lid vertices keep the chord sag of their longest edge off the ball.
- Round 5 (review 07): B2 passes the tone's iris, `build(..., iris=eyes.IRIS_BY_TONE[tone])` (light hazel, medium brown, dark `deep`), and rebuilds
  for the darker lash line. Viewer side, live: C9's relative targets, the eye range clamp and the main-sequence rate limit (`eyes.ts`), and in
  `viewer/packet.ts` the shot's default eye state now clears `targetRel` (one line; C9's target leaked into later shots).
- Round 6 (review 09, lash line at 1.2 m): B2 rebuilds every operator package, both sexes, all tones; the `lashes` mesh (a fourth lash-line row) and
  its atlas changed. No code change.
- **B7 (abstract builder): rebuild abstract-m and abstract-f** with no code change: `abstract.py` calls `eyes.eye_context()`, so its lids and
  eye joints (and the sculpted eyeballs on them) take the new inner corners; without the rebuild its joints differ from the dressed packages' by
  0.7 / 0.9 mm. The clay style inside B2's operator packages follows B2's rebuild by itself.
- **B1**: `body-clay`, `body-clay-f` pass through `eye_context()` too; rebuild them for the same joints in every package.
- Live in the viewer already (`viewer/src/eyes.ts`, no rebuild): portrait gaze = straight ahead of the face at 1.2 m (= into the lens at C1 az 0),
  scan spread 2 / 1 deg, first re-fixation after the mode's fixation time, a still recomputed when the figure or head turned since. The packet
  renderer needs no change (its portrait shots use the module's default).

Rules found the hard way:
- **Lash and brow cards: `alphaTest` 0 with alpha-to-coverage.** three.js draws alpha-to-coverage as `smoothstep(alphaTest, alphaTest + fwidth)`:
  a cut-off turns every soft edge of a hair atlas into a hard one.
- **Only the body and the lashes ride the lids.** The cap's brim corners are bound to the lash helper vertices in its
  `.mhclo`; fitted with `e.W` the cap blinks (seen). Fit everything else on the source context with `e.W_src`.
- The eye never scales (RP): radius 14.75 mm constant; every morph of the eyeball is the eye joint's `jointDelta`.
- The lid joints need dual-quaternion skinning (`_DQS` = 1 on lid vertices and on the lashes): linear blending sinks the
  lid 0.9 mm into the ball mid-blink (measured).
- No MakeHuman eye expression units (`eye-*-closure`, `-slit`, `-opened-up`) on a head with these lids: they fight the joints
  (the closure target leaves the lids 4-7 mm open on RP's base).

Requests:
- **B1 / RR**: keep in any rig change the four lid joints (children of `head`, at the eye centre, world-aligned), `_DQS` = 1
  on every vertex with a lid weight and on the lashes, and the eye joints at `eyes.eye_fit(base, base_v, side)[0]`. Lid
  vertices carry three influences; their `_JOINTS8_*` rows may repeat the 4-set.
- **RL**: the `eyes` block in FORMAT.md as `eyes.eye_manifest` writes it (`sides.{l,r}`: joint, mesh, radius, centre, hinge,
  upper / lower {joint, closeDeg}, canthusMedial / Lateral, apexUpper / Lower; `lift`; `bulge`; `irisPresets`); C7-C9 in the
  packet renderer through `plugins.eyes` (`gaze`, `blink`, `targetRel` + `time`). The cornea's soft highlight is now in the eye
  shader; the eye fill only needs to lift the socket (a shadowless light is fine).
- **B2**: rest expression from the MakeHuman units on disk, small and unequal: `eyebrows-left-down` 0.10, `eyebrows-right-down`
  0.06, `eyebrows-left-inner-up` 0.05, `mouth-compression` 0.08, `mouth-corner-puller` 0.04, `nose-left-elevation` 0.03; no eye
  units (the lowered, unequal lids are `eyeParams.restLidUpper` = 1.2 / 0.5 degrees in `eyes.ts`). Lashes: thinner cards than the
  pack's are still needed; `eyes.eye_lashes` (own cards + caruncle) is experimental and failed (roots under the lid overhang).

---

## Shape (owner: RP) — `RP/` (`rp.py`, `fit.py`, `space.py`, `export.py`), packages `RP/packages/rp-<sex>-v2/`

*This section was lost in a rewrite of this file and is restored here by B1 (2026-11-24 19:10) from RP's own texts:
`RP/NOTES.md` and the `howToApplyToMPFB2` list in `rp-<sex>-v2.shape.json`. RP: replace it with your wording.*

**Current files: `RP/packages/rp-male-v2/`, `RP/packages/rp-female-v2/`** (fit results in `RP/out3/`, settings in
`RP/env-v2.sh`). The first space (`packages/rp-male/`, `rp-female/`, `out/`) is superseded; `out2/` and `out3-first/`
are intermediate experiments. Each package holds `<name>.avatar.json` (38 controls, the linear map, read-back
measures, presets, prior), `<name>.shape.json` (the full map, statistics, tape definitions), `<name>.shape.bin` (base
and 40 targets on Anny's 13,718 vertices) and `transfer-<sex>.npz`.

Applying the space to the MakeHuman hm08 mesh (verbatim from the v2 `shape.json`):

- Vertex order: the N = 13,718 vertices are a subset of the MakeHuman hm08 base mesh in the same order; makehumanVertex.index[i] is the hm08 index of vertex i (identical to Anny's base_mesh_vertex_indices and to B1/anny_to_hm08.npy). Body 0..13379 without 1778..1793 and 8450..8465 (32 vertices Anny drops), tongue 13380..13605, eyeballs 14598..14741.
- Not covered: those 32 body vertices and every helper vertex (joint cubes, clothes helpers, eyelashes, teeth, hair). Exact way to get them: transfer-<sex>.npz holds, for each fitted person p, `target_weights[p]` over `target_names` (MakeHuman target files: 'universal:male-young-maxmuscle-averageweight' is macrodetails/universal-male-young-maxmuscle-averageweight, 'height:' and 'proportions:' and 'breast:' and the race files likewise; 'local_change:<name>' is the target file <name>), and this space's coefficients `C[p]`. body_p = hm08 base + sum_t target_weights[p][t] * target_t (apply_targets with these weights, NOT macro_weights(): Anny's phenotype scales differ from MakeHuman's sliders, e.g. Anny gender 0 = male, and its height and proportions blend the two end targets linearly). Then subtract `shift[p]` (Anny/Blender axes: x, -y forward, z up), fullTargets = least_squares(C, bodies - mean(bodies)), fullBase = (mean(bodies) + b0 . fullTargets) * base_scale (a uniform scale about the floor origin that removes the map's constant stature offset; `base_scale` is in the transfer file; targets are not scaled). On Anny's own vertices this reproduces the fitted bodies (export.py prints the check).
- Units: metres (MakeHuman target files are decimetres; MPFB2 objects are metres at scale 0.1).
- Axes: +x the body's left, -y forward, +z up (Blender and MPFB2, Anny). MakeHuman files are y up, z forward: (x, y, z)_file = (x, z, -y)_here. The GLB is glTF: (x, z, -y)_here as well.
- Origin: every body here stands with its soles on z = 0 and the midpoint of the hip joints on x = y = 0; `shift` in the transfer file is what was subtracted from Anny's frame per person. Use the base of the .shape.bin as the basis shape, not MPFB2's default.
- Skeleton: joints here are Anny's 104 bone heads. For another rig (MPFB2 default, 163 bones) take joint deltas from that rig's own vertex regressors applied to the full targets; they are linear, so jointDelta[k] = regressor . fullTargets[k].
- Controls, statistics and the measurement map do not depend on the mesh; only tape (vertex and edge ids, Anny order) does: re-index with makehumanVertex.index.

Added by RP at 18:48: multiply `fullBase` by `base_scale` (in `transfer-<sex>.npz`: 1.0026 men, 1.0008 women; about the
floor origin, after the shift; targets are not scaled). It removes the map's constant stature offset, so the mean
person has the mean stature (held-out stature error then +0.0 mean, 2.7 mm mean absolute).

What changed in v2 and the numbers before and after: `RP/NOTES.md`. Done by the core as written above:
`pipeline/core_rp.py` (`load_space(sex, tag="-v2")`), checked against RP's v2 files on the shared vertices
(base 0.0001 mm, targets 0.0013 mm).

---

## Abstract style (owner: B7) — `abstract.py`, `abs_*.py`

(Re-added 2026-11-24 evening: the first copy of this section was lost when the file was rewritten. A copy is kept in `B7/abs-readme.md`.)

Status (B7, round 8, 2026-11-25): **`packages/abstract-m` and `abstract-f` built once on the bodies, props and viewer of 02:10 (walk 4.93 s), with the woman's rounder bust apex (`chest_dome_bell_f`); 112,574 / 112,736 triangles; 3 mm rule met at all 76 control ends per sex; collar clean; full packet with its frame-rate run in `B7/packet-final3/` (median 90 fps, machine not quiet), shoe list `B7/packet-final3-f/`; not reviewed. Faults I see: `B7/KNOWN-ISSUES.md`;
numbers and decisions: `B7/NOTES.md` (rounds 4 to 8 at the end).** Specification: `VD/ABSTRACT-AND-WARDROBE.md` section 1 (the "clay figure"; no panel lines).

```
$PY -I pipeline/abstract.py                     # both sexes -> packages/abstract-m, packages/abstract-f  (about 15 s each)
$PY -I pipeline/abstract.py --sex f [--no-subdiv] [--out DIR]
$PY -I B7/abs_check.py                          # every shape control at both ends, style against bare body (RP's 37 dimensions, waist depth beside the navel), joints -> B7/check.json
$PY -I B7/abs_collar.py                         # the leg in the last's collar, five builds, standing / seated / ankle +20, -30, -45 / squat -> B7/collar.json
bun work/avatar-lab/viewer/packet.ts work/avatar-lab/packages/abstract-m/abstract-m.avatar.json --also work/avatar-lab/packages/abstract-f/abstract-f.avatar.json --out <folder> --set seated-envelope
```

Round 4 in short: shape targets get thin-plate fills on the navel, groin and cleft (rest: membrane); the waist dome (2 rings) is solved on RP's waist tape + the depth beside the navel and follows targets by a central secant over +-2 units; the leg is cut 3 mm below the last's funnel floor (`last_cut`); one Catmull-Clark level on the whole body, the body's control points set out by 0.7 (v - S_V v) first so the girths stay (`subdiv_comp`); lids end 0.2 mm inside a 64-segment ball; the mouth bag set back and the lower lip tucked under the upper. Parameters: `P` at the top of `abstract.py`.

The style is a function on the **same vertex array** as the body (19,158 rows, same order, faces and UVs):

```python
import abstract as ab, build_body as bb, eyes, copy
c = bb.context("m"); e = eyes.eye_context(c)                 # B5's lids and lid joints: the style's source body
c2 = copy.copy(c); c2.base_v = e.base_v; c2.targets = e.targets
st = ab.Style(c2, eye=e.eye)                                 # regions found on the rest shape (landmarks from the MPFB joints)
v  = st.base()                                               # styled rest vertices (19158,3), lids not yet lowered
lids = ab.lid_rotations(e, ab.P["lid_lower"])                # per side: (lid vertices, rotations about B5's hinge, eye centre, degrees)
d  = ab.styled_target(st, e, lids, "pc00", e.targets["pc00"])   # the styled shape target, lowered lids included
W  = st.fill_rows(W_sparse)                                  # skin weights (or any per-vertex rows) carried over the filled patches
st.regions  # bool masks: nostril, mouth (the bag behind the lips), nipple, navel, groin, cleft;  st.masks: ear, face, lidrim, fingertip
st.girth(v, y)                                               # tape measure at height y (hull perimeter of the exact plane cut)
```

`v_style(shape) = N(A v(shape))`. **A is linear** (it commutes with the shape targets): membrane fills (uniform Laplace
solve, border fixed) of the nostril insides, the mouth bag (lips welded), nipples, navel crater, groin and buttock cleft,
then masked smoothing (Taubin on face, ears, fill borders and a wide navel patch; plain on the nipple and groin patches and
the finger tips). **N is designed on the rest shape**: a broad dome where the nipples were, its height solved so that the
chest girth at nipple height is the bare body's; MakeHuman's `mouth-angles-up`; the lids tapered onto the ball (`lid_lip`) and kept on it under every target (`styled_target`); domes over the chest and navel
fills solved on RP's tapes at rest and per target (`Style.rp_tape`, `_dome`, `chest_target`).
The filled patches also take the skin weights of the skin round them. (`P["own_last"] = True` brings back round 1's toe
box on a slab; off.)

Meshes, one material `clay_figure`: `body` (one Catmull-Clark level on the whole body (round 4; rounds 1 to 3: head and hands);
triangles under the last's collar left out; `_SRC`, `_DQS`, the 8-influence set; GPU morphs = B3's `pc_*` only),
`eyeball_l/r` (sculpted, on the eye joints at B5's centre and radius, blank, gaze level),
`shoe_last` (B6's `props.build(which=("last",))` on this body, 40 GPU morphs so that its hard sole edge survives).
Shape: **`<name>.shape.bin`** (FORMAT.md 2d) for body and eyeballs. Everything is lifted by the dressed package's
`rest.soleHeight`, read at build time.

Package additions to the body's manifest: `rest.soleHeight`, `styles: {clay}`,
a `style` block (sole height, material, a tint per packet person, the two eye variants), my copy of `poses.json` (RR's
relaxed hand added to every pose that sets no fingers), clip paths pointing at the body package and `style.npz` (base and per-target offsets on the 19,158-row array).

Requests: **RL** a style that can bring its own body mesh and shape file (so the clay figure can live in the dressed
package), a tint per person, and the eye module's lid-clearance step for a package without an `eyes` block. **B5** a way to
run lids and gaze on a sculpted ball (no shader). **B6** (round 4) the collar's lip buckles at the back of the men's ankles at -45 degrees plantarflexion; a dark slit low on the heel counter; the lip stands off the Achilles hollow. **RP** adopt waist depth beside the navel (+-20 mm of the mid line left out of the anterior extreme) at the next refit.

---

## Cloth form (owner: B8) — `cloth.py`, `cloth_sim.py`, `cloth_bake.py`, `cloth_look.py`

Status (B8, 2026-11-25, end of round 3; REVIEW-09 ruled round 2's seated trousers "readable at 3.2 m"). **In B2's build:** the
standing fold map (round 1) and the seated correctives, seated map and pose fade, and shirt map (round 2). **Ready for B2 now
(round 3, `B8/baked/r3/`):** standing hip flexion (thigh tightened at hip 90-130, standing only) and a heavy-build seated component
scaled by thigh girth; the operator pose of the median builds is pixel-identical. What they fix and what not: `B8/NOTES.md`
(round 3), `B8/pictures/r3-compare/`. Nothing of B2's is edited: the chain reads a built package and writes a dressed copy.

Round 1 below ("Run it" to "For RL"), then round 2.

### Run it

```
PY=$MANIKIN_PYTHON; BLENDER=tools/Blender.app/Contents/MacOS/Blender
S=<scratch folder outside the lab>; W=$S/cloth-m; WS=$S/cloth-m-seat           # caches: about 100 to 150 MB a garment and set
SNAP=B8/snapshot/operator-m; rm -rf $SNAP; cp -R packages/operator-m $SNAP     # work on a fixed copy: B2's rebuilds change vertex order
$PY -I pipeline/cloth.py prep $SNAP $W  garment_trousers_work                       # free sheet: the standing set
$PY -I pipeline/cloth.py prep $SNAP $WS garment_trousers_work --soft=0.15           # spring-tied sheet: the seated set
$BLENDER -b -P pipeline/cloth_sim.py -- $W  garment_trousers_work > $W/trousers.log 2>&1    # one Blender at a time; about 3 min
$BLENDER -b -P pipeline/cloth_sim.py -- $WS garment_trousers_work > $WS/trousers.log 2>&1
$PY -I pipeline/cloth.py prep $SNAP $W  garment_top_shirt --over                    # --over: the finished trousers join the collider
$PY -I pipeline/cloth.py prep $SNAP $WS garment_top_shirt --over --soft=0.15        # then cloth_sim.py for both (about 4 min each)
$PY -I pipeline/cloth.py bake  $SNAP $W $WS $W/baked                                # 12 s: maps, morph targets, previews, bake-report.json
$PY -I pipeline/cloth.py dress $SNAP $W/baked B8/packages/<name> stand 0            # dressed copy; `seat` for the seated map; 0 = no morphs
bun viewer/packet.ts B8/packages/<name> --shots B8/shots-men.json --out B8/pictures/<set> --only A1,B2 --no-bench --no-skin-test
$PY -I pipeline/cloth.py transfer <old work> <new work> <garment>                   # after a rebuild: prep the new package into <new work>
                                                                                 # first, then carry the finished run over by nearest vertex
$BLENDER -b -P pipeline/cloth_look.py -- $W <png prefix> garment_trousers_work 35 113    # clay of the simulated sheet, raking light
```

`dress` takes every garment that has a `<mesh>.cloth.json` in the baked folder: to dress one garment, give it a folder with only
that garment's files (as `B8/baked/candidate/`). `packet.ts` needs the package and `--out` under `work/`.

**Inputs:** a built package (`packages/operator-m`; the person is `--who=M50` by default), Blender 5.2.4 in `tools/`. **Outputs**
per garment (`B8/baked/1024/`, `2048/`, `candidate/`): `<mesh>_fold_stand_n.jpg` and `<mesh>_fold_seat_n.jpg` (tangent-space
normal maps in UV0, B2's authored map already inside), `<mesh>.cloth.npz` (morph target deltas `p_<target>`, `n_<target>` in the
GLB vertex order of the baked package), `<mesh>.cloth.json` (FORMAT.md `morph` drivers), previews, `bake-report.json`.

### What it does

1. **`prep`** reads the package as the viewer does (`rig_rom.load_package`, shape of the person from the manifest's model, garment
   shape from morph targets or from the `.wear.shape.bin`), poses body and garment over 114 frames (36 standing, 48 moving to
   `SEATED_GRIPS`, 30 seated; `rig.fk`, `rig.skin`) and writes them as PC2 point caches. The garment is welded, B2's rim rings and
   loose pieces (buttons, pocket flaps, collar liner) are taken out and later ride on their nearest simulated vertex; the cloth
   sheet is subdivided (one level from 10,000 triangles up, else two) with curved midpoints (`Topo.refine`). Pins: geodesic
   distance from the opening loops (`KIND[..]["pin"]`: waist and collar wide, cuffs and trouser hems narrow, the shirt hem free).
2. **`cloth_sim.py`**: body = Mesh Cache + Collision (outer 1.5 mm); garment = Mesh Cache (the skinned garment is the pin target)
   + Cloth. Numbers in `cloth.KIND` and in `B8/NOTES.md`.
3. **`bake`**: drape = simulated minus skinned sheet. Sixty smoothing passes split it into a shape part and a fold part. Fold part
   -> tangent-space normal map, `cloth_bake.SIZE` = 1024 (B2's maps are 1024; 2048 showed no gain at 1.5 m), JPEG q90; T along +u,
   B along -v (the frame three.js builds for a glTF without tangents); fold walls clamped at about 55 degrees. Seated shape part ->
   corrective morph targets in the rest pose, capped at 35 mm: trousers `cloth_trousers_lap_l/_r` (hip flexion 15 to 80) and
   `cloth_trousers_knee_l/_r` (knee flexion 15 to 88); shirt `cloth_top_waist_l/_r` and `cloth_top_elbow_l/_r` (elbow 5 to 49).
4. **`dress`** copies the package, appends the map (and unless `0` the morph targets and drivers) to the GLB; B2's vertices,
   weights, `_DQS`, `_SRC` stay. B2's old map stays in the GLB unreferenced (149 KB more than needed in the dressed copy).

### For B2: how to take it

- **Now: the trousers' standing map, nothing else.** In the trousers material, use
  `B8/baked/candidate/garment_trousers_work_fold_stand_n.jpg` (1024, 149 KB) instead of `w7_<m|f>_trousers_work_normal.jpg`
  (1024, 152 KB): same slot and size, so no extra GPU memory or download, no morph targets, no drivers, no viewer change. It is
  in UV space, so it holds on every body without a new run, and in your 20:24 build the woman's trousers are the same asset with the
  same UVs and authored map as the man's (checked), so it can go on both; on her the hem break is worse (dark scuffs at the
  ankle; `B8/pictures/compare/woman-trousers-F05-az0.jpg`). Or run `cloth_bake.dress(pkg, "B8/baked/candidate", out,
  "stand", "0")` after `build_operator`. Tell the designer the hem flaw with it.
- **It stays valid** while the trousers' UVs and authored normal map stay. If the authored map changes: `prep` the new package,
  `transfer` the finished runs (from `cloth-m3`, `cloth-m3-seat` in B8's scratch, or simulate again), `bake` (12 s).
- **Not to take:** the shirt maps (placket and centre-back ridge), the seated maps and the eight morph targets (they do not read;
  the seated map would also need the pose-blended slot below), anything for the woman's shirt (another mesh, not baked).
- **The silhouette** is not done: `Topo.refine` would add the loops, but it is not applied to the render mesh (every vertex
  attribute would have to be carried: UV, weights, `_SRC`, shape targets). One level on the shirt sheet alone gives 19,400
  triangles, over the 15,000 limit unless the buttons (128 triangles each) are thinned.

### Cost

| | |
|---|---|
| simulation | 3 to 4 min per garment and set on the M2 (trousers 177 s free, 166 s tied; shirt 247 s, 216 s); 14 min for all four, one Blender at a time; prep under a minute; caches outside the lab |
| bake, dress, render | 12 s; 2 s; 3 to 8 s for the A1 and B2 shots of two persons |
| maps | 1024 JPEG: trousers stand 149 KB, seat 140 KB; shirt stand 54 KB, seat 43 KB. GPU about 5.6 MB each with mipmaps, the same as the map each replaces; a pose-blended seated map would add 5.6 MB per garment |
| morph targets (not in the candidate) | 8: 4 on the trousers (8,190 vertices), 4 on the shirt (5,432); position and normal, 196 KB and 130 KB a target, 1.3 MB in all |
| candidate package | GLB 19.71 MB against 19.56 MB (the old map left in; replacing it in B2's build is 3 KB smaller) |

### For RL: the pose-blended normal slot

Round 1 proposed it; round 2 built it as a plug-in (`viewer/src/cloth-pose.ts`, registered at the end of `viewer/src/plugins.ts`)
with the manifest record shown under round 2. RL: please take it into FORMAT.md 2c (or move it into `materials.ts`) and say if the
record should change. When garments get `_CONTACT`, the lap morph and the thigh capsules push the same cloth: scale
`cloth_trousers_lap_*` by `1 - _CONTACT.x`.

### Round 2 (2026-11-25, after VD/REVIEW-07): seated trousers, the pose fade, the shirt map

Built on B2's 01:05 packages (copied to `B8/snapshot/operator-{m,f}`, byte-identical when copied at 01:45). Results in
`B8/baked/r2/{m,f}/seat/` and `B8/baked/r2/{m,f}/shirt/`; dressed copies `B8/packages/operator-{m,f}`; pictures
`B8/pictures/r2-{before,after}-{m,f}/` (shot lists `B8/shots-r2-{m,f}.json`) and `B8/pictures/r2-compare/` (left before, right after). **The standing trouser map is untouched**:
`B8/baked/candidate/` (which B2's build reads) was not changed.

**Method, seated trousers.** `cloth.py prep_seat` (constants `cloth.SEAT2`): the waistband is the only pin (full within 30 mm of
the top loops, none past 80 mm); the hems are free; the colliders are the seated body, the worn trainers and a seat pan (a slab
with a 40 mm rounded front edge, top 6 mm under the body's lowest seated point, front edge 20 mm behind the calves) that rises
120 mm into place after the legs have moved; 180 frames (30 standing, 60 moving to `SEATED_GRIPS`, 20 for the pan, 70 settling).
The run is read by `cloth_bake.bake_seat2` as a **height field over the skinned seated garment** (along each skinned vertex's
normal, where does the simulated cloth lie?), not by vertex identity: the simulated cloth rode 150-200 mm up the shin, and
matching by vertex would have carried the hem and every fold up with it and opened the body mask at the ankle. The lower leg,
where no simulated cloth lies over the skinned one, stays as skinned (fade 60-160 mm along the cloth from the hem); the run's own
lowest 50 mm (its free hem) is never matched. The smooth part of the field (16 smoothing passes, what the 11 mm GLB mesh can
carry) becomes the **4 corrective morph targets**; the rest (clamped at 8 mm, 3 passes against the run's crumple noise) is the
**seated fold map** (1024, B2's authored trouser map underneath).

**The pose fade (viewer).** `viewer/src/cloth-pose.ts`, registered in `viewer/src/plugins.ts` (two lines at the end, the file's
documented extension point). For a cloth material with `poseNormal` in the manifest it mixes the GLB's normal map (B2's standing
map) with the seated map by a weight per side: the larger current weight of the named morph targets (so the fade follows the
same hip and knee ramps as the correctives), chosen by the vertex's rest x (+x = the figure's left), blended over 30 mm. Without
the record it does nothing. Proposed FORMAT.md 2c amendment (for RL):

```jsonc
"cloth_trousers_work": { "class": "cloth", …,
  "poseNormal": { "posed": "maps/garment_trousers_work_fold_seat_n.jpg",                 // same UV0 as the GLB's normal map
                  "weight": { "l": ["cloth_trousers_lap_l", "cloth_trousers_knee_l"], "r": ["cloth_trousers_lap_r", "cloth_trousers_knee_r"] },
                  "side": 0.03 } }
```

**Shirt.** A standing run on the current fit (`cloth.py prep … garment_top_shirt --over-skinned --frames=40`: collar and cuffs
pinned, hem free, the skinned trousers in the collider), baked by `cloth_bake.bake_stand` at 1024 with B2's authored shirt map
underneath; no folds within 35 mm of the centre line and all from 70 mm (`SHIRT_CENTRE`): the placket and the centre back are
stiff, interfaced strips in a real shirt, and free in the run they buckled into the glossy ridge of round 1. **Baked on the
current (01:05) fit, not on B2's coming fit with ease**; a map in UV space, it will sit on the new fit as long as the UVs stay,
but its folds belong to the shrink-wrapped shape and should be baked again on the new fit (one 40-frame run, 40 s, and 3 s of bake).

### Run it (round 2)

```
PY=$MANIKIN_PYTHON; BLENDER=tools/Blender.app/Contents/MacOS/Blender; S=<scratch>
SNAP=B8/snapshot/operator-m; rm -rf $SNAP; cp -R packages/operator-m $SNAP                    # (operator-f: --who=F50_MID)
$PY -I pipeline/cloth.py prep_seat $SNAP $S/seat --who=M50                                      # 3 s
$BLENDER -b -P pipeline/cloth_sim.py -- $S/seat garment_trousers_work > $S/seat/trousers.log 2>&1   # 180 frames, 4 to 5 min
$PY -I pipeline/cloth.py bake_seat2 $SNAP $S/seat B8/baked/r2/m/seat M50                         # 3 s: morph targets, seated map
$PY -I pipeline/cloth.py prep $SNAP $S/shirt garment_top_shirt --over-skinned --frames=40 --who=M50
$BLENDER -b -P pipeline/cloth_sim.py -- $S/shirt garment_top_shirt > $S/shirt/shirt.log 2>&1      # 40 frames, 40 s
$PY -I pipeline/cloth.py bake_stand $SNAP $S/shirt B8/baked/r2/m/shirt M50                       # 3 s: the shirt's standing map
$PY -I pipeline/cloth.py dress2 $SNAP B8/baked/r2/m/seat B8/packages/operator-m B8/baked/r2/m/shirt   # dressed copy (stops if the trousers mesh changed)
bun viewer/packet.ts B8/packages/operator-m --shots B8/shots-r2-m.json --out B8/pictures/r2-after-m --no-bench --no-skin-test
$BLENDER -b -P pipeline/cloth_look.py -- $S/seat <png prefix> garment_trousers_work 29 179 --body --az=40,90,180   # clay of the run with its colliders
```

After a rebuild that keeps the trousers' fit but changes the vertex order: `prep_seat` the new package into a new folder,
`cloth.py transfer <old seat folder> <new seat folder> garment_trousers_work`, `bake_seat2` (no new simulation). `B8/packages/`
and `B8/snapshot/` hold links to `packages/body-clay`, `body-clay-f` and `props`, which the manifests reach by relative path.

### For B2: the exact integration (round 2)

In `build_operator.py`, after a package is written (`pkg` its folder, `sex` "m" or "f"), as a post-process:

```python
import cloth_bake as cb, shutil
tmp = pkg + ".b8"; cb.dress2(pkg, os.path.join(LAB, "B8", "baked", "r2", sex, "seat"), tmp, shirt=os.path.join(LAB, "B8", "baked", "r2", sex, "shirt"))
shutil.rmtree(pkg); os.rename(tmp, pkg)
```

What that does, if you would rather write it yourself: (1) the trousers mesh gets 4 morph targets, `cloth_trousers_lap_l/_r`
(driver `hip_<s>.flex` 15 to 80) and `cloth_trousers_knee_l/_r` (`knee_<s>.flex` 15 to 88), positions and normals from
`garment_trousers_work.cloth.npz` (`p_<target>`, `n_<target>`, GLB vertex order of the 01:05 build; `.cloth.json` has the drivers and
a hash of the positions they belong to); (2) `maps/garment_trousers_work_fold_seat_n.jpg` and the `poseNormal` record above on
`cloth_trousers_work`; the standing map in the GLB stays yours; (3) the shirt material's normal texture becomes
`garment_top_shirt_fold_stand_n.jpg`. `dress2` stops with a message when the trousers mesh is not the one baked on: then the three
commands above (`prep_seat`, `transfer`, `bake_seat2`), about 10 s.

### Cost (round 2)

| | |
|---|---|
| simulation | seated trousers 180 frames: 271 s (M50), 315 s (F50_MID); shirt 40 frames: 40 s, 37 s; one Blender at a time; caches outside the lab (about 250 MB a seated run) |
| bake, dress, render | `bake_seat2` 4 to 6 s, `bake_stand` 3 s, `dress2` 2 s, the round-2 shot list 20 to 30 s a package |
| morph targets | 4 per package (`cloth_trousers_lap_l/_r`, `_knee_l/_r`), position and normal: 786 KB of GLB; largest move 31 mm (man), 28 mm (woman) |
| maps | 1024 JPEG: seated trousers 133 / 135 KB, the second normal map of the trousers (+5.6 MB GPU with mipmaps); shirt 50 / 53 KB, replaces B2's 17 KB shirt map (no GPU change) |
| GLB | +0.84 MB a package (21.54 -> 22.38 MB man, 22.46 -> 23.30 MB woman): over the designer's 20 MB, which the packages already were |
| viewer | one more texture sample per trousers fragment; the shader is rebuilt once per avatar |

### Round 3 (2026-11-25, after VD/REVIEW-09 items 4 and 5): standing hip flexion, heavy builds seated

On copies of B2's 03:33 packages (`B8/snapshot/operator-{m,f}`, which already carry round 2 as B2 took it; three proof poses
H110, H130, H90S were added to the copies' `poses.json` only). **Round 2's four correctives and `B8/baked/r2/` are unchanged**, so
the seated result of the median builds at the operator pose is unchanged; round 3 adds targets on top, in `B8/baked/r3/{m,f}/`.

- **Standing hip flexion** (`cloth.py prep_raise`, `cloth_bake.bake_raise`): a standing drape of the right leg raised to E26
  (hip 90, knee 90) and on to E27 (hip 120, knee 130), waistband pinned, hems free, body and trainers colliding, no seat, 220
  frames. Read as a height field over the garment as it renders at each key pose (skinned plus round 2's correctives at that pose's
  weights). Targets `cloth_trousers_raise1_<s>` (hip 15 -> 90) and `cloth_trousers_raise2_<s>` (hip 90 -> 120, the step from E26 to
  E27), on the thigh only (from just above the knee), the left side mirrored from the right. Driven by hip flexion alone, so a
  raised leg with a straighter knee still gets the thigh's correction. **Zeroed while the avatar is seated** by
  `viewer/src/cloth-pose.ts` (block `clothCorrectives.standingOnly`): they can never change the operator pose.
- **Heavy builds seated** (`cloth.py prep_seat --who=M50_HEAVY` / `F50_HEAVY`, `cloth_bake.bake_heavy`): the heavy build's seated
  correctives minus the median's, one target per side, `cloth_trousers_heavy_<s>` (hip 15 -> 80). The plug-in applies it only when
  seated and scales it by how much fuller the current thigh is: `(g - g_median) / (g_heavy - g_median)`, clamped to 0..1.25, where
  `g` is the mean distance of a ring of trouser vertices at mid-thigh from each leg's centre, measured on the current rest shape (the
  shape bake rewrites the positions, so the factor follows the sliders and every person in a group shot). 0 at the median and on
  thinner builds: their seated result is round 2's.
- **These six targets have no manifest driver.** The plug-in sets their weights in its `frame` step from the joint angle (read
  as the viewer's morph drivers read it). It does that before the viewer's seat contact pass, which renders the trousers into the
  sink map; weights set after it (round 3's first try, `late`) changed the seated median picture through the contact flatten. Checked:
  F1 and F7 for M50 and F05 are **pixel-identical** to B2's 03:33 build (mean and max difference 0).
- Under the raised thigh the run's own cloth still hangs 14-25 mm (gravity); the designer asks for no bag, so down-facing cloth on
  the thigh is taken to within 10 mm of the skin (`R3.hug_*`), never pushed out.

```
SNAP=B8/snapshot/operator-m; rm -rf $SNAP; cp -R packages/operator-m $SNAP          # (women: operator-f, --who=F50_MID / F50_HEAVY)
$PY -I pipeline/cloth.py prep_raise $SNAP $S/raise --who=M50
$PY -I pipeline/cloth.py prep_seat  $SNAP $S/heavy --who=M50_HEAVY
$BLENDER -b -P pipeline/cloth_sim.py -- $S/raise garment_trousers_work > $S/raise/trousers.log 2>&1     # 220 frames, 5 min
$BLENDER -b -P pipeline/cloth_sim.py -- $S/heavy garment_trousers_work > $S/heavy/trousers.log 2>&1     # 180 frames, 4 min
$PY -I pipeline/cloth.py bake_raise $SNAP $S/raise B8/baked/r2/m/seat B8/baked/r3/m M50                  # 2 s
$PY -I pipeline/cloth.py bake_heavy $SNAP $S/heavy B8/baked/r2/m/seat B8/baked/r3/m M50_HEAVY M50       # 5 s
$PY -I pipeline/cloth.py dress_extra $SNAP B8/baked/r3/m B8/packages/operator-m                           # on a package that has round 2
bun viewer/packet.ts B8/packages/operator-m --shots B8/shots-r3-m.json --out B8/pictures/r3-after-m --no-bench --no-skin-test
```

### For B2: the exact integration (round 3)

In `build_operator.py`, right after the round-2 block (`cb.dress2(...)`, which stays as it is):

```python
        extra_ = os.path.join(LAB, "B8", "baked", "r3", sex)
        if os.path.isdir(extra_):
            tmp_ = out.rstrip("/") + ".b8x"
            try:
                cb.dress_extra(out, extra_, tmp_); shutil.rmtree(out); os.rename(tmp_, out); log("B8 round 3 taken: raise and heavy correctives")
            except SystemExit as ex:
                shutil.rmtree(tmp_, ignore_errors=True); log("B8 round 3 dress FAILED (the package is left with round 2):", ex)
```

`dress_extra` appends 6 morph targets to the trousers (`cloth_trousers_raise1_l/_r`, `raise2_l/_r`, `heavy_l/_r`; positions and
normals from `B8/baked/r3/<sex>/garment_trousers_work.{raise,heavy}.npz`) and writes the manifest block `clothCorrectives` (`targets`:
target, dof, from, to, when, girth; `girth`: probe, median, heavy, clamp). No manifest drivers are added. It stops with a message
when the trousers mesh is not the 03:33 one; then `prep_raise` / `prep_seat` the new package, `cloth.py transfer` the finished runs,
and bake again (about 10 s, no new simulation).

### Cost (round 3)

| | |
|---|---|
| simulation | raise 220 frames: 297 s (M50), 329 s (F50_MID); heavy seated 180 frames: 219 s (M50_HEAVY), 266 s (F50_HEAVY) |
| bake, dress | `bake_raise` 2 s, `bake_heavy` 5 s, `dress_extra` 2 s |
| morph targets | +6 a package (10 in all on the trousers); 1.18 MB of GLB: 17.32 -> 18.50 MB (man), 17.58 -> 18.77 MB (woman), under 20 MB |
| maps | none new |
| viewer | per frame and avatar: six joint-angle reads; the girth (about 300 vertices) is measured again only when the body shape changes |

---

## Hair under the cap (owner: B9) — `hair_cap.py`

The woman's hair after VD/REVIEW-07 item 1 (new method: no pack hair cards under the cap). **One opaque, sculpted piece
designed for the cap**: a low bun just below the cap's back rim and the hair of the back, sides and temples pulled back
into it, a shell of real thickness (up to 9 mm where it gathers into the bun). Alpha only on a 4 mm outer fringe of single
strands at the hairline. B2's painted hairline in the skin stays as it is and shows through the fringe. **The man needs
nothing**: `build(..., sex="m")` returns None, and his painted fade, which passes, is untouched.

```python
import hair_cap
hp = hair_cap.build(c, e, meshes, tone="light"|"medium"|"dark", sex="f", out=out_dir)
# c = bb.context(sex) with B2's rest expression, e = eyes.eye_context(c); meshes = the build's mesh list in the bare-sole
# frame (finds garment_cap*, glasses*, prop_headset* by name; each with .morphs on every shape target)
hp.mesh        # glb.Mesh "hair_low_bun": 833 vertices, 1,402 triangles; morphs on all 40 targets (B2's wear bake takes them);
               # attrs _DQS, _JOINTS8_0/1, _WEIGHTS8_0/1 (8 influences), TANGENT (strand direction); JOINTS_0/WEIGHTS_0 = 4-fit
hp.materials   # {"hair_cap_low_bun": glTF material with _images}, hp.classes {"hair_cap_low_bun": {"class": "hair", ...}}
hp.garment     # wardrobe entry for slot "hair" (bodyMask maps/mask_hair_low_bun.png, cover maps/cover_hair_low_bun.png)
hp.licence, hp.stats
```

**Fitting, per shape target, with the cap.** The shell is a regular 9 mm grid on the head, every point bound to the body
triangle it lies on and lifted along the normal by a designed thickness; it is cut along a smooth hairline field (MPFB's
scalp region, a designed nape curve, a designed temple and sideburn patch, kept 1.5-4.5 mm off B7's ear). On each target it
is rebuilt from that target's body and held inside that target's cap (rays along the normal; a cone under the cap's edges
and folded band), under the headset cushion and under the glasses arms (a cone under every point of them). The bun is
stiff like the cap: on each target it takes the least-squares affine map of the cap's own vertices (B2's `stiff_fit`), so
bun and cap keep their relation on every body and every mix of targets. The bun's base follows the shell (seated 3.5 mm in).

**Skinning.** The skin's own weights under the shell (RR's full weights interpolated: the 8-influence set, and RR's
4-influence fit in `JOINTS_0`/`WEIGHTS_0`, so the hair also matches a 4-influence body), `_DQS` the skin's, and the cap's
head-only skinning on the bun, within 4-16 mm of it and under the cap's rim. **Scalp mask**: white from 4 mm inside the start
of the fringe (it always ends under opaque hair), body UV0, B2's seam treatment; cover 4 mm further in.

**Look.** Class `hair` (RL's recipe: anisotropic highlight across the strands, alpha-to-coverage). Base colour + alpha 1024
(neutral grey combed strands, the tone's colour 1.45 x `TONES` hair as the factor, B2's paint gain), strand normal map 512,
occlusion-roughness 256. Textures are generated (seeded) into `B9/cache/` on first use.

**Numbers** (`B9/packages/operator-f-hair*`, the viewer's metrics): the piece is 1,402 triangles, one draw call, 7.3 MB of GPU
texture. The woman's outfit with it: **119,972 triangles** (was 121,428 with the bob), 13 draw calls (unchanged: B2's), GPU
textures 159.3 MB (was 157.6), download 21.8 MB (was 22.5). Build time about 8 s per tone.

**Checks** (`B9/check_hair.py <package>`: F05, F50_THIN, F50_MID, F50_HEAVY, F05_LONGARM x rest, relaxed stand, seated,
E22-E25, E37, E39, C6-C6d, neck extension 60, lateral 45; the viewer's skinning): no hair vertex outside the cap and no hair
edge through the cap in any case; 3 hair edges through the glasses' arm tip behind the ear (in the fringe and thin zone);
the cushion meets the hair and runs up to 3.2 mm into it (hidden inside the cushion); unmasked skin through the opaque hair
at most 0.3 mm at rest, 2.6 mm on F50_HEAVY looking over the shoulder (E39).

**Test packages** (copies of B2's built women with only the bob swapped for this piece; everything else is B2's file
for file): `$PY -I B9/make_packages.py light medium dark` -> `B9/packages/operator-f-hair`, `-medium`, `-dark`.
Pictures: `B9/pictures/<tone>/` (the designer's list, `--only C1,C3,B1,W4d --persons F05,F50_HEAVY,F50_THIN`) and
`B9/pictures/<tone>-more/` (`--shots B9/shots-hair.json`: C1, C3, B1 for F50_HEAVY and F50_THIN, W4d for F05 and F50_THIN).

**For B2: the lines to add to `build_operator.py`** (nothing else changes; checked against the file as of 03:10. The piece
already carries the 8-influence set, so round 11's `put8` leaves it alone; with round 11's collar-into-shoes merge the woman's
outfit becomes 12 draw calls):

```python
# 1. no bob any more (the module-level default)
HAIR_PICK = [x for x in os.environ.get("B2_HAIR", "").split(",") if x]          # was "bob_b"

# 2. in build(), after the props block and the round-11 collar merge, just before "# ---- the clay figure in the SAME package":
    hp = None
    if sex == "f":                                     # B9: the woman's hair under the cap (README "Hair under the cap")
        import hair_cap
        hp = hair_cap.build(c, e, pre, tone=tone, sex=sex, out=out)
        pre.append(hp.mesh); mats.update(hp.materials); classes.update(hp.classes)

# 3. in build(), after the `if sex == "f" and HAIR_PICK:` slot block, before `LABEL = ...`:
    if hp is not None:
        slots["hair"] = [hp.garment]; pick = {**pick, "hair": hp.garment["id"]}; man["licence"].append(hp.licence)
```

**Faults I still see** (all frames of `B9/pictures/*` opened at 1:1): the bun is a smooth, even mound with no wraps in its
form and a small swirl point at its centre; on the dark tone its highlight and the band under the cap read greyish; the
hairline is a finely uneven but fairly hard line against light skin, the temple patch's lower edge a straight diagonal; a
pale sliver of sheen where bun and nape meet behind the ear cup at az 90.
