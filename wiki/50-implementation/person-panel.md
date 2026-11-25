---
title: The person panel
tldr: A click on the person (or its row in the parts list) opens its panel: three survey presets, sex, stature, weight and 36 survey measures, dressed or clay, tone, glasses and headset, with Undo, every change recorded in the shared scene as person.set. The CC BY clothing is credited on the view, in saved pictures and under More, Credits; the panel loads after the page is ready.
status: draft
updated: 2026-11-25
tags: [viewer, manikin, interface, implementation, accessibility]
---

# The person panel

## TL;DR

- **What it is:** phase 4 of manikin v1, on the branch `manikin-v1` only. It works on [the person in the viewer](person-in-viewer.md). It is a panel for the person in the seat, in the same place and style as the part card. The two take turns.
- **How it opens:** click the person in the 3D view, or click the new row **Person** at the end of the parts list (Enter works too). The person gets a faint outline. A click on the rig works as before.
- **What it changes:**
  - Who: Short woman (P5), Median man (P50), Tall man (P95), and Woman or Man.
  - Body: stature and weight, and the survey's 36 other measures under "More measurements", each in its unit and with the size that results.
  - Look: Dressed operator or Clay figure. For the dressed operator also skin tone (Light, Medium, Dark) and glasses and headset on or off. The cap stays on.
  - "Back to <preset>" and Undo.
- **Shared:** every change is shown at once and recorded in the shared scene as `person.set` ([the person's commands](person-commands.md)). Other browsers and agents see it. Undo takes back one change at a time, and a slider drag is one change.
- **Credits:** while the dressed operator is shown, one line at the bottom left of the 3D view credits the CC BY 4.0 shirt and trousers. The same line is in saved pictures and in agents' pictures. More, Credits shows the full credits (`assets/manikin/CREDITS.md`).
- **Cost:** 26 kB in the person's own script, which loads after the page is ready. The scripts before ready are 764 kB of the 800 kB budget (T10). The person's scripts after ready are 342 kB of 400 kB (T10b). *Measured.*
- **Checks:** nine new viewer checks, T60 to T67 and T46p (the frame rate with the person shown). All nine pass. All 65 checks of `tools/ui-accept.ts` passed when they were added; other checks have been added since.

## What is on it

| Block | Controls | Notes |
|---|---|---|
| Header | Hide, Undo, close (×) | Hide shows or hides the person in this browser only, like the eye in the parts list. Undo is greyed when there is nothing to take back |
| Who | Preset: Short woman P5, Median man P50, Tall man P95. Sex: Woman, Man | The presets are the package's own: "Small woman (stature P5)", "Median man", "Tall man (stature P95)", with their exact values. The commands use the same three. A change of sex alone gives that sex's median |
| Body | Stature (cm), Weight (kg), each with ↺ back to the preset's value; More measurements: 13 build and proportion measures and 23 finer ones | A survey measure is set in standard deviations (SD) away from what is typical for this stature and weight. Its readout gives the measure that results, e.g. "+1.00 SD · 652 mm". The slider ends say what the direction means (shorter … longer, lean … soft). The 36 sliders are built only when the section is first opened |
| Look | Style: Dressed operator, Clay figure. Skin tone: Light, Medium, Dark. Wearing: Glasses, Headset | Tone and wearing are shown only for the dressed operator. They are kept while the clay figure is shown, so switching back restores them |

The heading line says where the body stands, for example "Median man (P50) · Dressed operator" or "Changed from tall man (P95) · Dressed operator". In the second case a "Back to tall man" button appears beside the Body heading, like "As photographed" on a part's card.

## How a change travels

1. The panel shows the change here at once. All of its changes run through one queue in `viewer/src/person-panel.ts`, one after the other, because switching to another package (the other sex or the clay figure) takes a moment and nothing may overtake it.
2. It then records the change in the shared scene: `person.set` in MC's arguments (`preset`, `sex`, `style`, `tone`, `glasses`, `headset`, `body`). The change carries its own request `group`, plus `expectedVersion`, the scene version the change started from. It goes out through live.ts's own sender (`viewer.command`), so the page knows it as its own and its activity line does not announce it as someone else's.
3. A slider follows the pointer at once, with one update in flight at a time. The change is recorded once, when the slider is let go, or after a short pause for arrow keys. So one Undo takes back one drag.
4. **Undo** is `history.undo {group}` of the page's latest change. In the scene a change and its own undo cancel each other, so Undo after Undo works newest first. A refusal then means someone else changed the person since, and the panel says so.
5. A refusal (stale, out of range, a package that does not load) is said plainly in the panel. The person goes back to the shared state.
6. Changes from elsewhere (another browser through live.ts, an agent, a link) reach the panel through MV-core's `rigtwin:person` event, so the panel shows them the same way.

Without a server, or with one that does not know `person.set` (it answers `unknown_command`), the page keeps its own undo list and nothing is shared.

## Picking, the outline and the tip

- `interact.ts` asks `hooks.click` before it picks the rig. A click on the person takes the click when the person is nearer than the rig at that pixel: the part card closes and the panel opens.
- The pick is MV-core's `viewer.person.pickAt`: three.js picking on the posed meshes, about 6 ms a pick and 20 to 25 ms for the first one after a change. *Measured on the M2 under heavy load.*
- The selected person gets the faint line of the selection outline (the rig's parts get the strong one). The engine function `outlineExtra` draws it in its own mask layer. No material is touched.
- When the pointer rests on the person, the tip says "Person · adjustable" instead of naming the rig part behind it. The pick is too slow for every pointer move, so it happens only after the pointer rests.

## Credits

- **On the view:** one line at the bottom left of the 3D view, whenever the dressed operator is shown: "Clothing: work shirt by Elvaerwyn and work trousers by Mindfront (MakeHuman community, CC BY 4.0, adapted)." The licence is a link.
  - On a narrow window it sits just above the bottom sheet (T66).
  - Saved pictures and the pictures agents ask for carry it in their bottom left corner (`pictureCredits` in `ui.ts`).
  - The clay figure has no third-party clothing, so the line goes away while it is shown (T62).
- **More, Credits:** the clothing line and the motion line, then the rest of `assets/manikin/CREDITS.md`, bundled into the person's script:
  - the CC BY garments with title, author, source, licence and changes
  - the CMU terms and their credit line
  - the open licences of everything else
  - the build tools

## Keyboard, screen readers and narrow windows

- **Keyboard:** the Person row is a button (Enter or Space). Opening the panel from it moves the focus to the panel's heading. Tab goes through the panel in reading order. Esc closes the panel and returns the focus to the row. Esc closes the credits first when they are open.
- **Screen readers:**
  - Choices are native radio buttons in named groups; the presets are named "Short woman, P5".
  - Sliders have labels and spoken values ("175.6 cm", "+1.00 SD · 652 mm").
  - The row says whether the panel is open (`aria-expanded`).
  - Status lines are announced.
- **Narrow windows:** below 900 px the panel is a bottom sheet of at most 46 % of the height, as the part card is. The 3D view and the credits line end above it. Opening the panel from the parts drawer closes the drawer.

## Where it lives

| File | What changed |
|---|---|
| `viewer/src/person-panel.ts` | new: the panel, its row, the credits line and page, the adapter to the commands, picking and the tip |
| `viewer/src/main.ts` | one line: after the page is ready it imports the panel, which starts the person module |
| `viewer/src/engine.ts` | `hooks.click` (a click asked for before the rig is picked) and `outlineExtra` (the faint outline of another object) |
| `viewer/src/interact.ts` | one line: ask `hooks.click` first |
| `viewer/src/ui.ts` | `pictureCredits`: lines a saved picture carries |
| `viewer/viewer.css` | the panel shares the part card's rules; a section for the panel, the row, the credits line and page |
| `tools/ui-accept.ts` | checks T60 to T67, and three changes to the old ones (below) |

## Checks

| Script id | Verifies | Result (2026-11-25) |
|---|---|---|
| T60 | A click on the person selects it and opens its panel; the part card closes | panel open, the row marked, "Median man (P50)" |
| T61 | With the panel open, a click on the monitor selects it as before, and a click on empty space clears | monitor selected, card open, panel closed |
| T62 | Clay figure and back: tone and glasses kept; the credits line only while dressed; clay shows no tone or wearing rows | tone medium and glasses off kept; line shown, gone, shown |
| T63 | Tall man P95, then one stature drag, then Undo twice: back to Tall man, then to Median man | 187.0 cm, 180.0 cm, 187.0 cm, 175.6 cm; recorded in the shared scene |
| T64 | The credits line on the view; More, Credits names the garments' authors, CC BY 4.0, the motion source and the open licences; Esc closes it | all present |
| T65 | Enter on the Person row opens the panel with the focus on its heading; every control named; Tab in order; Esc closes and returns the focus | 0 unnamed controls |
| T66 | At 390 × 800 the panel is a bottom sheet ≤ 47 % of the height; the 3D view and the credits line end above it; no sideways scroll | 368 px (46 %); 0 px overflow |
| T46p | The frame rate of T46 at 1600 × 1000 with the default person shown, reported with the load average. It is never skipped; below 55 fps it is a warning on a loaded machine (load average at or above the core count) and a failure on a quiet one | 61 fps still, 60 fps with a selection and a moving joint (198,936 triangles, 153 draw calls; load average 4.4 on 8 cores). The designer's target is 60 fps; the final figure is taken on a quiet machine |
| T67 | A package that fails to load: the row says "not loaded", the panel and the notice say why, the rig still works | 404 said plainly; monitor selectable |

The old checks changed in three ways:
- Every page now waits for the person before a test starts, so the checks see the page as people do. T01 now counts 18 controls and T02 58 words, both within their limits.
- `find` takes a pixel where the part is not behind the person, and `empty` one where the person is not either.
- T46 measures the rig's frame rate with `person=off`. T46p measures the same with the person shown. The person's frame cost is also C-86 of `bun run check`, and its idle rate is T44b.

## Open

- No picture of the panel is in this wiki yet. Pictures of the person wait for the designer's ruling in the product scene (phase 5). The screenshots are in `work/mu/` and `work/mu/full/`.
- The panel has no posture control. `person.pose` (operating, relaxed stand) exists for agents.
- The pick uses linear blend skinning: a few millimetres off where the dual-quaternion zones bend. That does not matter for a click.
- The panel cannot redo an Undo.
- `ui-accept` now has a warning level, used only by T46p.
