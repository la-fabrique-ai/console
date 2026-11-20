---
title: Reference mockups
status: in force
date: 2026-11-20
author: Pilot
---

# Reference mockups

The mockups are in the repository, under `docs/mockups/`: the HTML pages, their sources and one `README.md` per screen. A machine that has the code has them too.

The screenshots (37 MB of PNG) stay outside the repository, in `~/Developer/mockups/mission-control/<screen>/screens/`: they are regenerated from the HTML pages.

| Screen | Folder | State |
|---|---|---|
| Prepare | `docs/mockups/prepare/` | Claude Design, validated by Nicolas on 2026-11-19. Read `README.md`. |
| Develop | `docs/mockups/develop/` | Claude Design, validated by Nicolas on 2026-11-19, 83 states. Read `README.md`. |
| Preparation flow (issues, request, questions, spec, split, plan, launch) | `docs/mockups/prepare-flow/` | Claude Design, validated by Nicolas on 2026-11-20, 26 states, in French. Read `README.md`. Its last step, Plan, is the Prepare page above. |
| Test, Validate | to do | Two or three variants in the same frame, to be validated by Nicolas before the code. |
| Inbox, Development | to do | Variants to propose with the first screens. |

These are art directions, not specifications: they show features that the first version does not have (Kanban, deviations from the plan, pause, up to three devs). See `docs/context.md` for what is kept. The texts are in English in the Prepare and Develop mockups and in French in the preparation flow; the screens will be in French, with four stages ([[0002-flow-and-screens]]). The preparation flow is the reference for the frame, the composer and the French tone.

Open points of the preparation flow, to be settled by Nicolas before the slice that needs them:
- State 17 shows the Lead splitting the spec, while decision [[0016-pilot-prepares-lead-executes]] gives the split to Pilot.
- The Plan page keeps "Approve and launch" in its banner, without the composer of the other steps.
- An answer written by the operator is rephrased by Pilot and validated once more, as drawn.
