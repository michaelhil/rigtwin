---
title: "Desk reviews, method changes, lessons"
tldr: Three fresh reviewers accepted the desk model with minor fixes and found, in every round, things the builder could not see. Two auditors then showed that the record claimed more accuracy than it had tested, that some values had been set to satisfy a check, and that nobody had judged the sizes independently. The model card, the record and the written method were corrected; twelve lessons follow.
status: living
updated: 2026-11-27
order: 4
tags: [operator-desk, review, lessons, method]
---

# Desk reviews, method changes, lessons

## TL;DR

- **Three reviews, three times "accept with minor fixes", then a closing review: "accept".** The parts list was accepted unchanged each time. The 19 findings were about form, colour, light and one misplaced part.
- **Two audits** by agents that took no part found the deeper problems: accuracy was asserted, not tested; a few values were moved until a check passed; and sizes had no judge other than the person who measured them.
- **What we did:** every size statement now reads "unverified, probably within 2–4 %"; the moved value was put back; the desk-height motion is locked; the phone app's labels are no longer called "measured".
- **The written method changed** (version 0.2.0): four new rules for every object, a route for "a rule in the picture", and a checklist for desks.
- **The one thing we would do differently:** ask the site three questions before modelling instead of after.

## Who checked what

| Check | Looked at | Verdict | Findings |
|---|---|---|---|
| Review 1 | the simple first model | accept with minor fixes | 6 |
| Review 2 | the shaped model with textures | accept with minor fixes | 8 |
| Review 3 | the model after the fixes | accept with minor fixes; "recognisable at a glance from every view" | 5 |
| Method audit | the whole record, the measuring scripts (re-run with wrong inputs on purpose), the photos | method credible; accuracy asserted, not tested | 8 |
| Code and platform review | the model in the viewer and in a room, the shared tools | code sound; model not ready for ergonomic screening | 12 |

A reviewer is a fresh AI agent that receives a packet: renders of the model, the parts list, the
purpose, and the photos. It never sees the builder's notes or explanations. Each round used a new
one, so no reviewer could grow used to the model. The last fixes (after review 3 and the audits) were
checked by a fourth fresh reviewer, who accepted the model and noted two small leftovers: a display
mount that sits 16 mm inside the wall base, and a faint shading crease on one end screen. Both are
left as they are and listed as known deviations.

## What the reviewers found

**Review 1, on the simple model.** Layout and proportions right. The top raised by the assumed 40 cm
drives the small screens into the large ones. The canopy's depth is in conflict (app against
photos). Legs are straight posts where the photos show a bowed blade. Desktop ends are faceted. Each
wall field should be two panels with a seam. The dark materials merge into one black. It also ranked
what the shaping round must get right, the desktop outline first, and listed detail not worth
making.

**Review 2, on the shaped model.** The lights are dull where the photos show them glowing. The leg
blades are beige where the photos show grey: the builder had taken the colour from one photo in warm
light. The felt textures look like stone. The wood grain is invisible at normal distance. The key
field is the same colour as the keyboard body. The wall's base shows under the desk where the photo
shows carpet. Shading bands on the end screens. The rails should be bright aluminium.

**Review 3, on the fixed model.** Print the real gap between the small and large screens with the top
raised, and lower the limit if it is under 2 cm. The loudspeaker blocks should slope. The wall's
base looks like a deep steel box from behind; the model has a thin slab. Felt grain still too coarse.
The mouse is faceted.

What stands out: **each round found something the builder had looked at many times and not seen.**
The beige legs and the dull lights are the clearest cases. And each reviewer said plainly what it
could not judge: sizes, clearances, the underside, anything behind something else.

## What the audits found

### 1. Accuracy was asserted, not tested

The record said the scale "closes to 0.2 % on the rule and 0.3 % on a keyboard's key spacing". The
auditor fed the scripts wrong lens values and a tilted phone. Both figures stayed the same, while the
depth of the desktop moved by several per cent. A test that cannot fail tests nothing. Details are on
the [accuracy page](measurements-and-accuracy.md#what-supports-the-scale-and-what-does-not).

*What we did:* the size statement everywhere is now "unverified; probably within 2–4 %; overall width
± 0.07 m". New rule in the method: a test of the scale must be shown able to fail.

### 2. Values were set to satisfy a check

The new clearance check moves every joint to its limits and lists collisions. The builder wrote the
check and then adjusted the model until it passed:

| Value | What happened | Now |
|---|---|---|
| Depth of a rail on the wall | cut from 15 to 12 mm so that a screen post cleared it | **put back** to 15 mm |
| Lean of the small screens | 22° to 16° because neighbouring housings overlapped by 6 mm | kept, because 16° is inside the measured range; described as "set by the check", not as a measurement |
| Height travel of the top | 40 cm, then 16 cm, then 5 cm: each time the largest value at which nothing collides | **locked**; labelled as an output of the check, not a property of the desk |
| Tilt ranges of the screens | cut to where nothing collides | labelled the same way |

A limit found this way can never fail the check that produced it, so the check says nothing about
it. And a 5 cm height range would read like a fact about the desk when it is only a fact about the
model.

*What we did:* new rule: no value is changed to make a check pass. Values a check influenced are
listed on the model card.

### 3. Nobody judged the sizes independently

Reviewers cannot judge sizes from pictures. The one agent measured, modelled, wrote the new check and
prepared the review packets. The held-back photo found three errors and was then used for a size
itself.

*What we did:* new rule: sizes need a judge other than the person who measured. In practice: a second
agent re-derives the five or six most important sizes from its own picks, or the site supplies tape
values that are kept sealed until the model's table is frozen. Two photos are held back, and the
record notes when one is used up.

### 4. Smaller corrections

- The canopy depth of 0.87 m stands (the auditor checked it a second way in the held-back photo), but its range was widened to 0.81–0.93 m and "measured in two photos" was corrected to "one slanted view per side".
- "Five repeated app labels" were one measurement shown in five screenshots.
- The app's labels had been filed as "measured", the strongest class. They are now "stated figures, ± 3 cm".
- The model had no eye position, so no sight line could be measured at the desk. Assumed seated and standing eye references were added, clearly labelled as design references.
- The standing checks did not cover the new object. They now run for every object in the project.
- In the room editor, a person cannot yet be seated at the desk (it has no chair). Sight lines are measured from the assumed eye references for now.

## What changed in the written method

The method is a written guide for AI agents (a "Skill") with reference pages and checklists. After
the desk it went from version 0.1.0 to 0.2.0. Its own rule for changes was applied: only what both
objects showed, or what repairs a core rule, becomes a rule for every object. The rest is recorded as
"tried once".

| Change | Status |
|---|---|
| A test of the scale must be shown able to fail | rule for every object |
| No value is changed to make a check pass; a limit derived from a check is labelled so | rule for every object |
| Sizes need a judge other than the measurer | rule for every object |
| One batch of questions to the owner once the table of sizes is drafted, before modelling | rule for every object |
| Hold back photos as tests, and record when one is used up | rule for every object |
| Three ways to get a wrong number: by eye along the line of sight; a grazing sight line; a fit that cannot show its error | added to the list of known failure modes |
| Scale first from a rule in the picture; simple cameras helped by the phone's record of gravity | reference section, "tried once" |
| Verdict on the phone's measuring app | reference section, "observed once" |
| A checklist for desks and consoles with screens | new checklist |
| Tools take the object's name; clearance check; lit and textured materials | in the shared tools |

What carried over from the first object without change: making the table of photos, the table of
sizes, the parts list, the simple first model, the checks and the review. What was particular to the
first object: working out cameras before scale, the heavy camera calculation as the only route, the
checklist for seated stations, and tools tied to one object.

Still open before the method can be called proven: a run by a fresh agent with only the written
method, on an object whose tape values are sealed beforehand.

## Lessons

1. **Put a rule in the picture.** One metre rule on the desktop carried the scale of the whole model. Nothing else in 36 images came close.
2. **A phone's measuring app is a rough guide.** ± 3 cm at best, and up to 17 % off without warning. It does not replace a tape.
3. **Depth judged by eye along the camera's line of sight is wrong.** Three times out of three here, by 20–30 cm.
4. **Hold back photos, more than one.** The single held-back photo found three errors. Then it was used up.
5. **A check you wrote yourself and then satisfied proves nothing.** Decide the value from evidence; let the check report.
6. **A test that cannot fail is not a test.** Feed it a wrong input and see whether the result moves.
7. **The builder cannot see its own model.** Fresh reviewers found beige legs and dead lights within minutes.
8. **Reviewers cannot judge sizes.** Looks and structure get reviewed; sizes need a second measurer or a tape.
9. **Build everything as plain boxes first.** The raised-top collision showed up before any time was spent on shapes.
10. **Ask early.** Three questions to the site would have saved the half hour spent on a clearance calculation and removed the weakest values in the model.
11. **Count measurements, not pictures.** Twenty-one screenshots held about a dozen measurements, and five of them were used.
12. **Leave the textures until the form is accepted.** They drew three of eight findings in review 2 for a gain that is barely visible at normal distance.

## What we would do differently next time

- Send the site the three questions and the tape list as soon as the table of sizes is drafted.
- Hold back two whole-object photos and never read a number in them.
- Have a second agent re-derive the five most important sizes from its own picks.
- Try every scale test with a wrong input before quoting its result.
- Never write a check and then tune values against it.
- Record the tokens each stage used. Only minutes were logged cleanly this time.
