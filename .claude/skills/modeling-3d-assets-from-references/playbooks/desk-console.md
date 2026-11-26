# Playbook: desks and consoles with displays

Asset-type knowledge for a workstation that is furniture plus screens: a control-room desk, a
dispatcher's console, a trading or monitoring desk. Everything here comes from one asset (a
curved desk with two end screens, a shelf with three small displays, two large displays on a
rear wall, a canopy, a keyboard unit) built from fifteen phone photos, a metre rule in one of
them and labels from a phone's measuring app. A starting hypothesis, not a rule. Sizes are in
that asset's parameter files, not here.

## Usual components and groups

| Group | Components (each a node) | Notes |
|---|---|---|
| desk | desktop; shelf behind it; legs; lifting columns if it adjusts; end screens; panel and tray under the top | store the desktop's outline once, as proportions; end screens, shelf and seams index into it |
| wall | frame boards; fabric or felt fields; base; equipment stand-ins; rails | thinner than it looks from the front; look at it from the side before modeling |
| canopy | body with its edge layers; light strip; spotlights; fan plate | the underside is seen only from the operator's side |
| displays | each display with its screen surface; posts, arms and brackets | glass distinct from housing; the lit area has its own aspect ratio |
| input | keyboard unit, touch panel surface, mouse | loose objects: modeled where photographed, and said so |

Leave out: single keys, grille slats, fan vanes, rail slots, cables, display-back sockets.

## Frames a consumer needs

Floor anchor at a point a tape can find (under the centre of the desktop's front edge);
desktop surface and front-edge frames, fixed and live if the top adjusts; one surface and one
centre frame per screen, normal toward the viewer, the touch panel included; a keyboard frame;
**seated and standing eye references**, labelled as assumed design references: without a seat
or a person, no sight line can be measured at the desk.

## Joints, and what is commonly only assumed

- Height adjustment: casual photos show one height. Ask the site before modeling: does the top
  move, between which heights, **and what rides with it** (displays on the top do; displays on a
  wall or post do not). Until answered: joint assumed and locked.
- Display tilt: a pivot is usually visible from behind, in one position; the range is not.
- Never present a limit that came from a clearance solver as a range of the object.

## Measuring

- Lay the rule on the desktop and photograph it from above; also lay it front to back and stand
  it upright, or the depth and height directions have no test.
- Soft scale checks: the pitch of a standard keyboard (19.05 mm, but key-top height is then an
  unknown too); display housings by diagonal class.
- Screens fool measuring apps: labels on dark glossy surfaces were 9–13 % short.
- Legs, panels and end screens are seen at grazing angles from the front: measure them on
  their own faces from the side.
- The underside, the inside of a base and the far end of the top are rarely photographed: ask
  for them, or they are invented.

## Typical pitfalls (each happened)

- A dark band read as a deep part was a face seen at an angle.
- A box under the top was placed 0.3 m too far forward by eye; a base was made 0.2 m too deep
  twice. Only visible floor gave it away.
- At an assumed typical travel the displays on the desk ran into the displays on the wall.
- Felt tiled by mirroring shows a lattice; lights without emission read as grey pucks.

## Views a reviewer asked for

Operator's eye; underside; canopy from below; each screen's frame drawn; the raised pose close
up; one material at 1 m beside a photo crop; the model with and without its texture layer.

## Ten minutes on site

Does the top rise and what rides; overall width and depth; floor to desktop; one display's
size and lean (a phone's level on the glass); floor to the canopy; base depth; model labels.
