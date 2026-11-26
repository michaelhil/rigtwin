---
title: Workstation and doorway screening
tldr: Screen seated display reading and a doorway cross-section using cited public guidance and an optional project requirement.
status: living
updated: 2026-11-26
tags: [assessment, standards, ergonomics]
---

# Workstation and doorway screening

## TL;DR

Use the US workstation profile for a US general-industry workplace with seated computer display reading. The customer layout profile adds a documented project-specific minimum to the same public checks. Each finding concerns one task, operator or cross-section. Record the applicable jurisdiction and exit-access designation with the project. Check other governing rules separately, including locally adopted codes and accessibility requirements.

## Display viewing distance

OSHA's advisory workstation eTool gives a preferred viewing distance for seated computer use. The evaluator uses the published metric range and measures from the solved operating eye midpoint to the centre of the selected active display surface. The model represents one point on the screen. Select seated display reading only when that subtask is present. On Rig B, control reach, seat adjustment, off-axis viewing, text legibility and prolonged operation require separate checks. [OSHA, Monitors, Viewing distance, Figure 1](https://www.osha.gov/etools/computer-workstations/components/monitors)

```toml
id = "osha.display-distance"
title = "Display viewing distance"
edition = "OSHA Computer Workstations eTool, web edition checked 2026-11-26"
source = "https://www.osha.gov/etools/computer-workstations/components/monitors"
clause = "Viewing distance, Figure 1 and Possible Solutions"
anchor = "display-viewing-distance"
applies = "us-seated-reading"
measure = "eye-display"
roles = ["eye", "displayCentre"]
units = "m"
minimum = 0.50
maximum = 1.00
interpretation = "Preferred metric range for eye to front of screen, sampled at the active centre."
```

## Exit access at the threshold

29 CFR 1910.36(g)(2) specifies a minimum exit-access width of 28 inches. The evaluator converts inches to metres exactly and checks the longest continuous unoccupied interval on the drawn threshold. Confirm that this section is US general-industry exit access. Establish the clear width at the relevant height, accounting for hardware, projections and the door leaf, before drawing a physical conclusion. Capacity, height and the rest of the route require additional assessment. [OSHA, 29 CFR 1910.36(g)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.36)

```toml
id = "osha.exit-access-width"
title = "Exit access at the threshold"
edition = "29 CFR 1910.36, OSHA text checked 2026-11-26"
source = "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.36"
clause = "1910.36(g)(2), first sentence"
anchor = "exit-access-at-the-threshold"
applies = "us-exit-access"
measure = "door-opening"
roles = ["threshold"]
units = "m"
minimum = 0.7112
interpretation = "One cross-section of exit access. Confirm effective clearance and measurement uncertainty on site."
```

## Reflected glare

Observe the occupied station under representative lighting, with its usual screen content. Record disturbing reflections, the window or light source and the condition under which the reflection appeared. The scene window gives the observer context. [OSHA, Workstation Environment, Glare](https://www.osha.gov/etools/computer-workstations/workstation-environment)

```toml
id = "osha.glare-observation"
title = "Reflected glare"
edition = "OSHA Computer Workstations eTool, web edition checked 2026-11-26"
source = "https://www.osha.gov/etools/computer-workstations/workstation-environment"
clause = "Glare, Potential Hazard and Possible Solutions"
anchor = "reflected-glare"
applies = "us-seated-reading"
measure = "observation"
roles = []
units = "observation"
interpretation = "Observe reflections from the operating position with representative lighting and screen content."
```

## Customer doorway requirement

A customer may specify the minimum continuous opening between projected obstructions on a layout drawing. Enter the agreed width and its document reference or clause locally. This check concerns the drawing in metres. Its exact geometric result can guide a layout change before hardware or as-built measurements are available. The additional requirement has its own finding and preserves the applicable public exit-access check.

```toml
id = "project.doorway-width"
title = "Customer doorway requirement"
edition = "Synergon project requirement template, revision 1"
source = "project:customer-requirement"
clause = "Project-supplied document reference"
anchor = "customer-doorway-requirement"
applies = "customer-drawing"
measure = "door-opening"
roles = ["threshold"]
units = "m"
limitFrom = "customer.minimum"
interpretation = "Minimum continuous opening on the drawing, using projected footprints at the threshold."
```
