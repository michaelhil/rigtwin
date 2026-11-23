# Failure modes

Symptom → cause → guard. Every row happened in this project (trials before the plan, or the
first asset's build). "Guard in place" names a check or tool that exists; "procedure" means the
guard is an instruction in this Skill and depends on the agent following it.

## Contents

- Coverage and structure
- Measuring
- Judging by looking
- Process and independence
- Presentation and use
- Confidentiality
- How to add a row

## Coverage and structure

| Symptom | Cause | Guard |
|---|---|---|
| A whole side of the object is missing from the result and nobody notices until the person does | The trial brief named only one side; figures did not list omissions; nothing compared the build with the component list | In place: coverage check (every spec node is in the GLB or in `omitted` with a reason); left/right check; the omitted list printed on every contact sheet. Procedure: a brief cites the spec, never a hand-typed subset; block out every component first |
| A flexible cover tears when its lever moves; a part leaves the arm that carries it; a moving part passes through a fixed bar | The tree was right at rest and never tried in motion; a multi-link mechanism was one rigid mesh; a joint was left unlocked with a range its geometry could not follow | Procedure: pose every unlocked joint at both limits before review; the reviewer does it again. Not in place: a collision sweep. The expected-motion check does not catch any of these |
| Generator, viewer and checker each pose a joint slightly differently | Three implementations of "joint value → transform" written separately in the trials | In place: one shared pose function used by generator and viewer; a conformance check against the independent reader on test poses |
| A naming rule rejects names its own author wrote | The rule was written before the tree | Procedure: run the name check on the real blockout before a brief goes out |
| Parallel builders overwrite each other's build output, or one half-edited file breaks everyone's build | Shared output folder and shared source tree | In place: `--workspace`, `--only <group>`. Procedure: file ownership table; shared spec edited only in one's own entries with small targeted edits; changes to shared kit code logged |

## Measuring

| Symptom | Cause | Guard |
|---|---|---|
| A stated range does not contain another derivation of the same dimension (the miss was more than twice the range) | A method's own error bar was taken as the uncertainty | Procedure: the range covers every derivation not shown wrong |
| Two scale references disagree by 7 % | The published size was never tied to the element measured, and that element was not on the assumed plane | Procedure: closure table before modeling; investigate, never average; drop the wrong reference and say why |
| A conflict is "resolved" by an explanation, and later re-derivation shows the explanation was wrong | The correction was plausible and never tested | Procedure: an untested correction is not a resolution; re-derive by a route sharing neither scale reference nor plane |
| The overlay fits, yet a part is in the wrong place | The camera was solved on a part that had moved between photos, or against the model part being judged | Procedure: gauge features only on fixed structure, named in the report, excluded from scoring; movable parts get a pose per photo |
| An exactly determined camera solve fits perfectly and is wrong (camera height clearly off) | No redundancy, so no residual | Procedure: check every solve on features it did not use |
| Overlays look right while a part is several centimetres off | The error lies along the camera's line of sight; two photos from nearly one viewpoint | Procedure: sensitivity table and cannot-check list in the measurement report; a coordinator ruling tells modellers which parts to take from the table, not the overlay |
| One purchased part measures 0.84 of its published size while everything else closes | The wrong size variant of the product was assumed | Procedure: read a large consistent ratio with good residuals as misidentification; carry both candidates until settled |
| A triangulated point lands somewhere absurd | The pick matched a look-alike neighbour in a row of identical features | Procedure: accept a pick only if its sight lines meet within a few pixels; list dropped picks |
| A figure given by the person fits no reading of the photos | The figure was remembered or rounded, or measured to an unknown point; the brief had fixed one reading | Procedure: record both, model the better supported, ask "from where to where", never adjust toward the figure |
| An invented value looks measured | A bare number in code or a record without provenance | In place: loader refuses records without class, tier and evidence; literal scan of component code; colour by data source; class counts in the description file. Not in place: machine-written measurement records behind `photo` values |

## Judging by looking

| Symptom | Cause | Guard |
|---|---|---|
| Modeled facets, bevels and curvature are invisible; the model looks like a paper cut-out | Rendering overexposed light surfaces to near clipping | Procedure: measure pixel values of lit light surfaces before judging form; in place after the first review: lower default exposure |
| A part is the wrong kind of shape: a smooth blob where the object is faceted, or flat folded planes where it is soft | The builder chose a kit operation before naming what makes the part recognisable | Procedure: three to five signature features first; kind of shape before size |
| Surfaces people touch and look at are crude while small hardware is finely modeled | Effort followed what is easy to parameterise | Procedure: per-component triangle listing in review; the two-edged standard |
| A size is "corrected" because a render looked off | Trust in the eye for magnitudes | Procedure: size remarks are hints; values change only through the dimension table |

## Process and independence

| Symptom | Cause | Guard |
|---|---|---|
| The builder reports success and the result is not good enough | The builder marks its own work; in the trials it also wrote the checks | In place: checks live in `tools/`, owned by nobody who models; an independent reviewer per round. Procedure: negative-test each new check; findings close only by a fresh review or a measurement. Not in place: a locked acceptance spec by a separate author |
| The reviewer could have read the builders' notes | Isolation was by instruction, in a shared folder | Procedure: fixed brief, separate folder, snapshot of the build. Not exercised: a read-only reviewer on a prepared packet; a leak test |
| A clean review is taken as proof | Nobody knows what size of error the reviewer catches | Not exercised: the planted-error test in `reviewing.md` |
| A new session "continues" without the rules, or declares the work done | The Skill was not loaded; state lived in a conversation | Procedure: invoke the Skill by name; resume from files and from the check. Not in place: a status script and state file |
| Guidance describes what a different agent did before the guidance existed | The Skill was written after the first asset, from its briefs | Stated in `CHANGELOG.md`; first real test is a second object built by a fresh agent |

## Presentation and use

| Symptom | Cause | Guard |
|---|---|---|
| The person asks why a part cannot be adjusted; a lock icon with no way to unlock | Motions with only assumed evidence were locked and shown as disabled controls | Rule in the contract: an assumed motion stays usable, labelled "assumed range", with one step back to the photographed pose |
| The viewer shows far more controls than the request needs and feels slow, though rendering is fast | Every joint and option exposed at once | Procedure: independent usability review that counts and measures; controls for a part appear when the part is selected |

## Confidentiality

| Symptom | Cause | Guard |
|---|---|---|
| A brand, client or person's name appears in code, parameters, file names or images | Names are visible in the photos and get copied into notes and evidence text | In place: banned-word check on every `bun run check`, with the words stored encoded; outputs with photo pixels go to `private/`; published images are masked copies with metadata stripped; `scripts/check-vocabulary.sh` for this Skill and the agent definitions, which the project check does not scan |
| Asset-specific words creep into the general method | The Skill was distilled from one asset | In place: `scripts/check-vocabulary.sh`. Procedure: the promotion rule in `CHANGELOG.md` |

## How to add a row

Write the symptom as it was first noticed, the cause as later established, and the guard that
would have caught it. Say whether the guard is in place or only a procedure. A failure with its
cause and guard is the most reusable thing this Skill holds.
