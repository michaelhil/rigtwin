# Changelog

## 0.2.0 — 2026-11-27

After the second asset: a desk with displays, built by one agent following 0.1.0, reviewed
three times by the read-only reviewer and then audited (method and code) by agents that took
no part.

**Based on**

- that asset's journal (a verdict per step), measurement register, three reviews, the method
  audit, the platform review and the coordinator's nineteen rulings.

**Promotion rule applied.** Into the core, because both assets showed it or it repairs an
invariant: a closure test must be shown able to fail (invariant 5); no value is changed to
pass a check, and sizes need a judge other than the measurer (invariant 9); one batched
question to the person at the dimension-table gate; hold-out photos; grazing rays,
exactly determined fits and by-eye depth as failure modes; `--asset` in the commands.
As "exercised once": the measurement-first route with a scale rule, the gravity-aided cameras
and the verdict on a phone's measuring app (measuring reference, section 0); drills; the model
card. As a playbook: `playbooks/desk-console.md`. Left with the asset: its values, rulings and
texture swatches. Not changed: the confidentiality wording (an optional swatch layer exists on
the second asset by the owner's request; a wording needs the owner's approval).

**What the second asset showed about this Skill**

- It transferred: evidence set, dimension table, spec, blockout, checks and review worked
  unchanged; the camera-first order and the playbook did not apply.
- Accuracy was asserted, not tested: closure figures that could not fail, a measurer who was
  also the modeller, a hold-out photo used up. Sizes: probably within 2–4 %, unverified.
- Values were set by a new check until it passed. The rule against it is now invariant 9.
- Still open for 1.0, unchanged: a fresh agent with only the template, and sealed tape values.


## 0.1.0 — 2026-11-23

First version, written after the first asset was built, from what was actually done.

**Based on**

- one asset: a seated teleoperation station, modeled from eleven casual phone photos (three of
  the reference instance) and three sizes given from memory, with no tape values;
- the working documents of that build: the shared build brief, the common instructions for the
  three parallel modellers, the generator's developer note, the measurement report, both
  independent reviews, two usability reviews of the viewer, and the coordinator's notes of
  rulings, failures and deviations;
- the planning research and its adversarial review, used for the parts of the design that the
  build confirmed, and listed as "not exercised" where it did not.

**What is exercised and what is not**

| Exercised once | Not exercised |
|---|---|
| evidence set, cameras on gauge features, scale closure, dimension table | hold-out points clicked by a person; scoring a frozen table against tape values |
| decomposition spec, whole-object blockout, the checks, photo-matched views | a checkpoint where the person reviews the tree; a locked acceptance spec by a separate author |
| three modellers in parallel with build folders and file ownership | the `component-modeller` and `asset-measurer` definitions as files (the agents ran from prose briefs) |
| independent review, two rounds, by general agents with shell access | the read-only `asset-reviewer` definition; enforced isolation; the planted-error test |
| a retrospective (this Skill) | drills as a formal step; a model card produced by following this Skill; resume by a cold session |
| | human gates; a second object; a second repository; the tools with any asset id but the first (0.2.0: a second object and asset id are now exercised) |

**Honest limits**

- This Skill was distilled after the fact. No agent has yet built anything by following it.
- Its decomposition guidance describes a tree written by a research agent before the build.
- Every size verdict for the first asset is "unverified" until tape values arrive.
- The Skill is not self-contained: it needs the project toolkit. The template for a new project
  is this repository's structure without the first asset's folder.

**It becomes 1.0 only when** a fresh agent, in a new session and given only the template,
builds a second, different object with it: an object and casual photos chosen by the owner,
with the owner's tape values kept sealed until the dimension table is frozen, and judged by
rules written down beforehand (the checks pass at blockout level; most sealed values fall
inside their stated ranges; the Skill triggers without being named; no vocabulary from the
first asset appears in the output). One such run is still thin evidence, and the entry for 1.0
will say so.

## How this Skill changes

After every asset, run a retrospective and sort each lesson:

- **universal** → `SKILL.md` or a reference;
- **asset-type** → a playbook;
- **asset-specific** → that asset's own notes.

**Promotion rule:** a lesson enters the core (SKILL.md, references, agent definitions) only
after it has appeared in two different assets, or when it repairs a broken invariant.
Everything else goes to a playbook. Removal counts too: a step or view that found nothing
across two assets is a candidate for deletion.

Before committing a change: run `scripts/check-vocabulary.sh`; bump `metadata.version` in
`SKILL.md`; add an entry here; record the Skill version on each asset's model card. The person
approves changes to the invariants.
