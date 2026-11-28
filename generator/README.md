# Generator, viewer and tools: developer note

Written for a modeller starting cold. Read the build brief first; this note says how the code here
implements it and how to work with it.

## The loop

```
bun install                                   # once; the only install step
bun run build [--only seat[,pods]]            # params + spec + src -> assets/rig-b/build/rig-b.glb + manifest (about 0.15 s)
bun run check [--fast]                        # every check; non-zero exit on failure (about 4 s; --fast skips the browser, 1.5 s)
bun run render --set sheet                    # contact sheet -> work/renders/sheet/sheet.png (about 4 s)
bun run render --set groups --only seat       # one group isolated, three views
bun run render --set focus --fit C_joy_lever_L [--only pods] [--mode ids]   # close-ups framed on parts
bun run render --set ids | ortho | matched | ui | selftest | all
bun run render --set matched --cam IMG_2530   # against a photo: render, ID colours, outlines on the photo, blend
bun run serve                                 # viewer at http://127.0.0.1:4173/
bun run dist                                  # self-contained dist/ (verified from a sub-path)
bun run render --set wiki                     # every model image of the wiki, stable names, into wiki/img/model/ and wiki/img/matched/
bun run render --set matched --photos wiki/img/photos   # publishable photo comparisons from the masked photos only
bun run wiki index | lint | build             # generated index, wiki checks, static wiki site (dist/wiki)
bun run deploy --dry-run                      # then without --dry-run: publish to production (wiki/50-implementation/deployment.md)
bun test generator                            # kit known-answer tests (also part of check)
```

**Working in parallel.** Several people building at once overwrite each other's
`assets/rig-b/build/`. Give yourself a build folder (a name): add `--build <name>` to `build`, `render`,
`check` and `serve` (or `export SYNERGON_BUILD_DIR=<name>`). Build output then goes to
`work/<name>/build/` and renders to `work/<name>/renders/<set>/`. Set `SYNERGON_AGENT=<your role>`
so the automatic lines in `work/timeline.jsonl` carry your name.

`--only <group>` builds the whole frame tree but only that group's meshes, and imports only that
group's source file, so a half-edited file in another group cannot break your build. The sheet
footer says when a build is partial. `bun run check` always does a full build.

Images that contain photo pixels (matched side-by-side, outlines on the photo) are written to
`private/renders/matched/`, not `work/`, because photos must stay under `private/`. The one exception is
`--photos wiki/img/photos` (and `--set wiki`): the photo layer is then the masked copy, the server has no
route to `private/` except the re-scaled camera file, and the results go to `wiki/img/matched/`.

## Where things are

| Path | What |
|---|---|
| `assets/rig-b/spec/rig.toml` | the tree: nodes, parents, groups, mount frames, joints, datums, expected motion, left/right table |
| `assets/rig-b/params/*.toml` | every number: `devices.toml`, one file per group, optional `measured.toml` (read last, overrides) |
| `assets/rig-b/src/<group>.ts` | one function per component id that returns meshes |
| `shared/` | code used by BOTH generator and viewer: `pose.ts` (joint value -> transform), `manifest.ts` (types), `math.ts` |
| `generator/` | `params.ts` loader, `expr.ts` expressions, `kit.ts` + `cage.ts` geometry, `assemble.ts`, `glb.ts` writer, `materials.ts`, `textures.ts`, `build.ts` |
| `viewer/` | `src/main.ts` (TypeScript), `index.html`, `viewer.css`; bundled on the fly, no manual step |
| `tools/` | `check.ts`, `render.ts` (headless driver), `serve.ts`, `bundle.ts`, `dist.ts`, `glb_inspect.py` (independent reader) |

## How parameters flow

1. `params/*.toml`: one record per independent number (or list) with `value`, `unit`, `class`,
   `tier`, `evidence` (and `range`, `basis`). The loader refuses an incomplete record and names it.
   Inline form is fine: `rim_width = { value = 0.032, unit = "m", class = "assumed", basis = "by_eye", tier = "cosmetic", evidence = "…" }`.
2. Units are converted once in the loader. Code only ever sees **metres and radians**
   (`mm`, `cm`, `in`, `deg` are converted; `ratio`, `count`, `1` are left alone).
3. Files are read in the order `devices`, the groups, `measured`; a later record with the same key
   replaces the earlier one (the manifest records `replaces`).
4. Mount frames and joint limits in `spec/rig.toml` are small expressions over parameter keys
   (`"pods.joy_spacing / 2"`, `"pods.button_xy_L[2][0]"`, `tan()`, `sqrt()` …). To move a part,
   change the parameter, not the spec.
5. A component function reads parameters with `c.p("seat.hub_radius")` (number) or
   `c.arr("pods.plate_outline")` (list). Every read is recorded, so the manifest knows which
   parameters, and which evidence classes, each component rests on; the viewer shows that on click
   and in the "By data source" colouring. An unknown key stops the build and suggests the closest.
6. Dimensions do not belong in `src/*.ts`. `check` lists decimal literals it finds there. Shape
   lists (profiles, outlines, cage stations) are parameters too, preferably as proportions.

## Adding or changing a component

1. It must be a node in `spec/rig.toml` (id, parent, group, `pos`/`rpy`, joints). The frame tree,
   joints and datums come from the spec alone.
2. In `assets/rig-b/src/<group>.ts` add a function under `components`, keyed by the node id:

```ts
C_stand_shelf: (c) => {
  const k = c.kit, [sx, sy] = c.arr("stand.shelf_size"), t = c.p("stand.shelf_thickness");
  const slab = k.extrude(k.roundedRectOutline(sx, sy, c.p("stand.shelf_radius"), 8), t, { bevel: c.p("stand.column_bevel") });
  return k.part("shell_white", k.translate(slab, [0, 0, -t]));   // one Part, or an array of Parts
},
```

   - Author the mesh **in the component's own frame** (the node origin; for a moving part that is
     its axis of motion). Z up, X forward, Y to the operator's left.
   - `c.id`, `c.side` (`"L"`, `"R"` or `null`), `c.sy` (+1 for left, -1 for right).
   - Left/right pairs: write the left one, return `kit.mapParts(parts, kit.mirrorY)` for the right
     (see `sided()` in `pods.ts`). Frames are never mirrored, only meshes. `check` verifies pairs.
   - A part names a material from `generator/materials.ts`: `shell_white`, `leather_black`,
     `plastic_black`, `panel_dark`, `deck_dark`, `rubber_black`, `metal_dark`, `metal_bright`,
     `glass_black`, `estop_red`, `estop_yellow`, `screen_main`, `screen_touch`, and the abstract control-room screens `screen_process`, `screen_process_b`, `screen_trend`, `screen_trend_b`, `screen_overview`, `screen_console`.
   - Parts with the same material are merged; **each remaining part is one draw call**. The budget
     is 80 for the whole rig (the blockout uses 62), so small components should use one material.
   - `S_` surfaces are built the same way and must have 0–1 UVs (`kit.sheet`, `kit.arcSheet`).
3. To leave a component out on purpose, export `omitted = { C_x: "reason" }` from the group file.
   A component with neither a function nor a reason fails `check`
   ("C_x missing: in tree, not in GLB, not in omitted").
4. Every mesh is checked when it is built: NaN, empty, zero-area triangles, non-unit normals,
   triangles wound against their normals, collapsed extent. The build stops with the component id.

## Kit functions (`c.kit`)

Every primitive is centred in x/y and **sits on z = 0, growing upward** (only `sphere` is centred).
Meshes are plain `{ positions, normals, uvs?, indices }`.

Shading: normals come from a crease angle (default 50°) with area weighting. A single chamfer strip
between two large faces therefore shades as a rounded edge while the faces stay flat: use `bevel`
(2–6 mm) on visible hard edges; it costs two triangles per edge.

| Function | Gives |
|---|---|
| `box(sx, sy, sz, { bevel })` | flat-faced box with chamfered edges |
| `roundedBox(sx, sy, sz, radius, { bevel, bevelTop, bevelBottom, segments })` | box with rounded vertical edges |
| `cylinder(r, h, { segments, bevel, radiusTop })`, `cone(r, h)` | cylinder / frustum along Z |
| `tube(rOuter, rInner, h, { bevel })` | hollow ring section |
| `sphere(r, { segments })` | ball centred on the origin |
| `extrude(outline, h, { bevel, bevelTop, bevelBottom, crease })` | 2D outline pushed up Z with chamfered rims (concave outlines are fine) |
| `revolve(profile, { segments, crease })` | lathe about Z; profile is `[radius, z]` listed bottom to top |
| `bellowsProfile(rBottom, rTop, h, ribs, depth)` | zig-zag profile for `revolve` (rubber boot) |
| `loft(rings, { capStart, capEnd, crease })` | skin through rings of 3D points (same count each): leaning tapered columns, grips, cushions |
| `ring(outline, origin, { scale, rpy })` | place a 2D outline in space, to feed `loft` |
| `sweepArc(section, radius, angle, { segments })` | closed `[depth, z]` section swept round a vertical axis: the curved monitor |
| `arcSheet(radius, arcLength, height, { segments, lift })` | curved screen face with UVs, matching `sweepArc`'s front |
| `sheet(width, height)` | flat screen face with UVs, facing -X |
| `tubePath(points, radius, { segments })` | round tube along a polyline: arms, bars |
| `cage({ points, faces, bevel, mirror, material })` | **faceted hard shell** from named corner points and quad / n-gon faces; see below |
| `cageParts(…)` | the same, split by per-face material: `{ loop: [...], material: "panel_dark" }` |
| `prism(top, bottom, { bevel })` | faceted solid between two polygons: trays, wedges, blades |
| `roundedRectOutline`, `obroundOutline`, `ellipseOutline`, `circleOutline`, `rectOutline`, `offsetOutline`, `outlineArea` | 2D outlines (counter-clockwise) |
| `translate`, `rotate(mesh, axis, angle)`, `rotateRpy`, `place(mesh, pos, rpy)`, `scale`, `mirrorY`, `transform` | move meshes |
| `merge(...meshes)`, `part(material, ...meshes)`, `mergeParts`, `mapParts` | combine |
| `recomputeNormals(mesh, crease)`, `assertMesh`, `bounds`, `triangleCount`, `shade`, `earclip`, `triangulate3` | lower level |

Screen UV convention: u = 0 at the operator's left (+Y), v = 0 at the top.

### The faceted cage

For angular shells (seat back, pod fairings). You give corner points by name and faces as loops of
point names; with `mirror: true` you give only the +Y half and points with y = 0 are shared.

- Each face is pulled back from its edges by `bevel` and keeps its own flat normal; edge strips and
  corner patches are stitched between the faces and share their vertices, so facets stay flat and
  the chamfers shade as soft edges.
- Faces that meet at less than 4° (`flatAngle`) get no chamfer between them, so a face may be split
  (for a different material, or along the mirror plane) without a visible seam.
- A closed cage is turned outward automatically. An open cage must be wound counter-clockwise seen
  from outside. Inconsistent winding is an error that names the edge and both faces.
- `bevel` is one distance for the whole cage and is clamped to 30 % of its shortest edge: one very
  short edge shrinks every chamfer, so avoid slivers in the cage.
- `C_seat_back_shell` in `seat.ts` is the worked example: stations bottom to top, each a half ring
  of six points, quads between stations, caps, a dark centre band by per-face material.

## Lamps

A component may return `c.kit.lamp({ kind: "spot" | "strip", at, dir, colour, intensity, ... })` among its parts. The lamp
is written into the node's extras (`lamps`) and the viewer makes it a real light (a spot light with shadows, or an area
light for a strip). `intensity` is a relative visual brightness, not a photometric value; `c.kit.cctColour(kelvin)` gives
the colour of a colour temperature. The operator desk's canopy uses it for its two downlights and its light strip.

## Joints and the shared pose function

`shared/pose.ts` is the single definition: `node transform = mount · motion(value)`. The generator
calls it to write the GLB at the neutral value; the viewer calls it to pose. The independent reader
`tools/glb_inspect.py` has its own implementation, and `check` compares the two on 96 test poses
and also poses every joint to confirm it moves exactly the nodes listed in the spec's `[motion]`
table. Ball joints take `[roll, pitch, yaw]`. Locked joints are in the tree but the viewer shows
them disabled.

## The viewer is TypeScript (change of plan)

The brief first asked for a plain-JavaScript viewer with vendored three.js and no build step. The
coordinator changed this during the build: the viewer is now TypeScript (`viewer/src/main.ts`),
bundled with Bun together with three.js from `node_modules`, so that the generator and the viewer
import the same `shared/` code (manifest types and, above all, the pose function) and the whole
project is type-checked by `check`. There is still no manual build step: `serve` and `render`
bundle in memory (about 0.1 s) and re-bundle when a file under `viewer/` or `shared/` changes;
`dist` writes the bundle to disk.

Viewer URL parameters (also the keys of `viewer.apply({...})` used by the driver): `view`, `proj`,
`camera`, `cam`, `overlay`, `only`, `hide`, `fit`, `pose`, `mode`, `wire`, `frames`, `legend`,
`hud`, `caption`, `ui`. They are documented at the top of `viewer/src/main.ts`. Photo cameras are
read from `private/evidence/cameras.json` only when the page comes from the local dev server.

## Deviations from the brief

- Node-name pattern relaxed to `^(C|J|D|S)_[a-z0-9]+(_([a-z0-9]+|[LR]))*$`: the brief's pattern
  rejects its own names `C_pod_button_L_1` and `J_joy_L_roll` (side marker not at the end).
- Photo-containing renders go to `private/renders/`, not `work/renders/` (photo rule).
- "≤ 80 draw calls" is enforced as draw primitives in the GLB; the viewer redraws the shadow map
  only when something moves, so a still view costs primitives + 1 calls.
- Seat height: the owner's figure "seat 1.4 m high" fits neither reading. The measured photo
  cameras give the seat-back top at 1.28 m above the deck (1.48 m above the floor) on two rigs, so
  the geometry uses `seat.back_top_z` = 1.28 (class photo) and records the owner's figure as
  `seat.back_top_height_user` (class measured, basis user, not read by the geometry) until a tape
  settles it. An early blockout parameter `seat.back_top_from_floor` was removed.
- Viewer in TypeScript with a bundle instead of plain modules (see above).
