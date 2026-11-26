---
name: assessing-synergon
description: Select and apply source-backed screening criteria to a Synergon room, inspect uncertain findings and replay a saved assessment after project transfer.
---

# Assessing a room

Discover the named room from the installation's homepage and agent guide. Use the room command catalogue for the current workspace. Call `assessment.profiles` for the available profiles, their purpose and the Standards entry used by the evaluator.

Choose sources from the project's jurisdiction, purpose, task and documented customer agreement. For a US general-industry design with seated computer reading, choose `us-workstation` and cite the evaluator's [workstation screening entry](../../../wiki/85-standards/workstation-screening.md). Its OSHA eTool recommendations guide screening. Federal exit-access width applies only if the assessed threshold is exit access in the relevant workplace. An industrial operator reading a display can be assessed for that subtask. Control reach and seat adjustment remain outstanding.

For a local project with an agreed drawing clearance, select `customer-layout` and supply the approved minimum and document clause. Its additional finding concerns the projected opening on the drawing. Keep regulatory and contractual findings individually attributed. A more permissive customer requirement cannot relax an applicable legal obligation. If applicability, precedence or the contract is unclear, retain unknown facts and ask the responsible person to resolve the specific conflict. If the governing source is unavailable, ask for an authorised local copy or offer a named public approximation with its scope and provenance. Record any substitution explicitly and limit claims to the source actually checked.

Use `assessment.configure` to record the selection and known facts. Use `assessment.run` and refer to findings by criterion and binding. Each display uses an instance-qualified eye and screen centre. For physical evidence, supply a revision-specific total error bound for the reported segment, including geometry, posture and site conditions. Record the independent inspection or survey reference. An estimated or standard-derived input with unresolved influence keeps a physical finding open. For glare, report the observer's actual observations.

A named run freezes the scene, source rules, criterion limits, bindings and evidence. Use `assessment.replay` after import to recalculate it. Distinguish the frozen revision from the current room. Report the selected source, governing facts, measured interval, criterion limits, outstanding observation and unassessed tasks.

When extending the evaluator, encode another criterion as data and add a small measurement function for genuinely new geometry. Consider lazy loading a coherent optional user task when its UI or dependencies are substantial. Reuse current viewer and headless geometry before defining another extension mechanism.
