---
title: How this wiki works
tldr: Conventions for reading and extending the wiki. Every page has front matter with a TL;DR; the index and the HTML site are generated from the pages; the log is append-only.
status: stable
updated: 2026-11-23
tags: [meta]
---

# How this wiki works

This wiki is the single source of truth for the Synergon project: for the people who run it and
for the AI agents that continue the work. If something here disagrees with a chat transcript, a
commit message or an agent's memory, the wiki wins; if the wiki is wrong, fix the wiki.

## Layout

| Folder | Holds | Typical question it answers |
|---|---|---|
| `00-overview/` | One-page summary, glossary | What is this and where does it stand? |
| `10-request/` | The owner's requests verbatim; requirements derived from them | What was asked for? |
| `20-decisions/` | Options considered; the decision log | Why this way and not another? |
| `30-plan/` | The approved plan; deviations from it | What did we commit to, and what changed? |
| `40-method/` | The pipeline, the measuring and gap-filling procedures, decomposition, the asset contract, the agent process, the checks | How is an asset made? |
| `50-implementation/` | Stack, timeline and performance data, measurement results, modeling rounds, viewer, deployment | What was actually built, and how long did it take? |
| `60-lessons/` | Numbered lessons, failures and fixes, reusable patterns, ideas | What did we learn? |
| `70-results/` | The asset's model card, gallery, critique, goal assessment | What is the result and how good is it? |
| `80-reference/` | Skills and agents, tools, standards, research sources | Where is the detail? |
| `90-next/` | Next steps and open questions | What now? |
| `img/` | Images, by topic | — |

`index.md` lists every page with its one-line summary and is **generated** (`bun run wiki index`);
do not edit it by hand. `log.md` is a dated, append-only record of what happened.

## Page rules

1. **Front matter** on every page:

   ```yaml
   ---
   title: Short title
   tldr: One or two sentences a reader can stop after.
   status: stable | living | draft      # living = expected to change as the project grows
   updated: 2026-11-23
   tags: [measurement, viewer]
   ---
   ```

2. The body starts with the page title and then a **TL;DR** section of at most five bullets.
3. One topic per page. If a page passes about 400 lines, split it and link the parts.
4. **IDs are stable and never reused**: requirements `R-01`, decisions `D-01`, lessons `L-01`,
   failures `F-01`, patterns `P-01`, ideas `I-01`, checks `C-01`. Refer to them by ID from other
   pages. To retire one, mark it "superseded by …"; do not delete or renumber.
5. Say how each statement is known when it matters: *tested* (run on the machine), *measured*
   (with the number), *judgment*, *not verified*. Give numbers with units and, for sizes, ranges.
6. Link with relative Markdown links (`../40-method/pipeline.md`). Images go under `img/<topic>/`
   and are referenced relatively; every image has a caption line below it.
7. Plain language first. Explain a term once and add it to the glossary.
8. No brand, client or customer names from the source photographs anywhere in this repository,
   including image pixels and file names. Rigs are "Rig A" (in a van), "Rig B" (the reference
   rig), "Rig C1" and "Rig C2" (control room). Makers of purchased components (monitor,
   joystick, pedals) may be named where a dimension comes from their published drawing. A check
   scans for banned words on every run.
9. Photographs in the wiki are the masked copies under `img/photos/` (people and names blurred,
   metadata removed). Unmasked photographs never enter the repository.

## For agents continuing this work

- Read `00-overview/summary.md`, then `index.md`, then only the pages your task needs.
- Before changing how assets are built, read `40-method/asset-contract.md` and
  `60-lessons/lessons-learned.md`.
- When you finish a piece of work: update the pages it affects, append a dated entry to `log.md`
  (what changed, why, links), add lessons with new IDs, run `bun run wiki index` and
  `bun run check`.
- Record failures as carefully as successes. A failure with its cause and its guard is the most
  reusable thing in this wiki.
