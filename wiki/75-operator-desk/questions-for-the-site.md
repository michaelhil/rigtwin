---
title: "Questions for the site about the desk"
tldr: Three questions only the site can answer (does the top rise and what rises with it, how deep is the canopy, are the screen tilts adjustable) and the ten tape readings that would turn the desk model's estimates into measurements - about ten minutes at the desk with a tape and a phone.
status: living
updated: 2026-11-27
order: 6
tags: [operator-desk, open-questions, measurement, next]
---

# Questions for the site about the desk

## TL;DR

- **Three questions** decide whether the model can be used for more than layout: does the top rise, how deep is the canopy, do the screens tilt.
- **Ten tape readings**, in order of value, would replace the model's weakest numbers. Photograph each with the tape in the frame.
- A reading goes into one text file; the model rebuilds itself around it. No modelling work is needed.
- Two points the photos contradict themselves on are listed at the end: the canopy's depth and the depth of the wall's base.
- Nothing here is urgent for room layout. All of it matters before the model is used to judge viewing angles or working heights.

This page is written so that it can be taken to the desk.

## Three questions

1. **Does the desktop rise?** If so: between which heights (floor to the top's surface, lowest and highest), and **what rises with it?** Do the three small screens ride on the top? Do the large screens or the rear wall move? In the photos the top stood at about 0.77 m. The model keeps it there.
2. **How deep is the canopy?** Along its side, from the front edge back to the front of the wall's side board. The photos say 0.87 m, the phone's measuring app said 0.73 m.
3. **Can the screens be tilted in use?** Large screens: fixed at installation, or adjustable, and how far? The same for the three small screens.

## Ten tape readings, most useful first

Please photograph each reading with the tape in the picture, so the end points are clear.

| # | Reading | The model now says | Why it matters |
|---|---|---|---|
| 1 | Canopy: front edge to the front of a side board, along the side | 0.87 m (0.81–0.93) | settles the one open conflict; everything on the canopy hangs on it |
| 2 | Floor to the desktop's surface as it stands; and at its lowest and highest position if it moves | 0.77 m (± 0.03); travel unknown | working height; the first thing an ergonomic check reads |
| 3 | Overall width of the top, end to end at the widest | 2.41 m (± 0.07) | footprint; the widest range in the model |
| 4 | Depth of the top at the centre: front edge to the rear edge of the working surface | 0.603 m | the only test of the scale from front to back |
| 5 | Floor to the canopy's lower front edge, straight down | 1.895 m (± 0.03) | the only test of the scale in height |
| 6 | One small screen: housing width and height; its lean (a phone's level app laid on the glass) | 0.617 × 0.366 m; 16° (± 5°) | the lean is the weakest important value |
| 7 | One large screen: housing width and height; forward tilt (level app); floor to its lower edge | 1.11 × 0.632 m; 12.7° (± 2.5°) | viewing angle to the upper screens |
| 8 | Desktop front edge (centre) to the face of the middle small screen, and to the face of a large screen | about 0.83 m, measured level, to the top edge of the middle small screen | viewing distance |
| 9 | Rear wall: floor to the lower rail; depth of the base front to back; overall width and height | base 0.125 m deep (contested); 1.16 m wide; 1.98 m high | settles the second contradiction |
| 10 | One leg: length on the floor; and the distance between the two legs | at least 0.72 m; 1.54 m between centres | knee room and footprint |

If possible also: **close photos of the type labels** on the five screens and the keyboard unit. With
the model names, the makers' published drawings replace eight assumed values. These photos stay
private; no name is published or written into the model.

## If there is time for five photos

The full list is in the [photo guide](photo-guide.md#how-to-take-documentation-photos-next-time).
The five that would add most to what already exists:

1. The whole desk **square-on from the side**, from 4 m or more, main lens.
2. The metre rule **standing upright** against the desk edge, and **lying front to back** on the top.
3. From **above the right end** of the top.
4. From the **floor, looking under the top**.
5. The top at a **second height**, from the same spot as a photo at the first height.

Please send the phone's original files (cable, file transfer or an album shared as originals).

## Where the photos contradict themselves

**Canopy depth.** Two slanted views put the canopy's side at 0.87–0.89 m. One measurement of the
phone's app says 0.73 m for the same span, and the end points of that measurement are the right
ones. A check in a third photo speaks for 0.87 m or more. The model uses 0.87 m; the reason for the
app's figure is not known.

**Depth of the rear wall's base.** From the front, carpet is visible under the desk up to about 93 cm
behind the front edge, so the base cannot start before that: 12.5 cm deep at most. From behind, a
wide-lens photo shows an open box with a floor, side walls and equipment that looks deeper than that.
The two have not been reconciled. It may be that a panel seen through the open base belongs to the
desk and not to the wall.

## What happens with the answers

- A tape reading is entered as one record in the file `assets/operator-desk/params/measured.toml`. The model is rebuilt; every part that depends on that size follows. This was tried with three trial values before publication.
- One step is still done by hand: limits that were worked out from clearances (how far a screen can tilt before it touches its neighbour) have to be worked out again after a size changes.
- When the answers to the three questions are in, the height motion is unlocked with its real range, and the tilt ranges are replaced.
- The size statement on the [overview](overview.md) changes from "unverified" to "checked against ten tape readings", with the differences listed.
