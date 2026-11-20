---
title: Plan of the first version
status: to be validated by Nicolas
date: 2026-11-20
author: Pilot
ticket: MC-1
---

# Plan of the first version

## Goal
Nicolas runs a complete mission with the new system: a request in Linear, a spec, a validated split, tickets developed and reviewed, a QA, his validation, stacked PRs. First on a trial Linear team, then on a real FlashGolf ticket.

## Decisions
All in `docs/decisions/` (0001 to 0013). This plan does not repeat them.

## Limits
- Nothing is taken from the old code without an explicit decision, block by block.
- No write to a real Linear project before milestone 2.
- Each batch is delivered with its tests, reviewed by the other model family, and shown on screen or on the command line before the next one.
- A batch fits in one agent session and is reviewed in one pass. If bigger, it is split again by the Lead.

## Batches of milestone 1 — the minimal full flow
| Batch | Expected result | Finished when | Dev |
|---|---|---|---|
| 0 Foundation | Repository in strict TypeScript, tests, project verification; a separate Herdr installation that shows an empty Mission Control screen | The verification passes; the screen opens in the separate Herdr; we know what Herdr accepts as a screen file | Codex (engine), Claude (screen) |
| 1 Tickets | The ticket model, the base, the Linear connector in read mode | A ticket of the trial team appears in the base with all its fields | Codex |
| 2 Mission | The state of a mission and its four steps, readable in a file | A mission is created from a ticket and moves from step to step by command | Codex |
| 3 Agents and requests | Start an agent in a terminal, send it a text only once, receive a request and answer it | A request raised by an agent receives its answer in its terminal, once, even if the command is replayed | Codex |
| 4 Basic screens | Inbox, Development and the frame of the page of a mission | Nicolas opens a mission from the list and answers a request in place | Claude |
| 5 Prepare | Pilot writes the spec in `docs/`, the Lead proposes a split as a draft, Nicolas validates, the sub-tickets are created in Linear | On the trial team: spec written, split validated, sub-tickets created, summary and link in the main ticket | Codex (engine), Claude (page) |
| 6 Develop | A dev codes a ticket, a reviewer reviews it, the PR of the ticket is merged into the mission branch; high-risk tickets included | Two tickets in sequence are accepted, each with its stacked PR | Codex (engine), Claude (page) |
| 7 Test and validate | QA, Nicolas's validation, fixes in the same mission, closing | A trial mission goes all the way to closing, with a refusal fixed along the way | Codex (engine), Claude (page) |

**Milestone 1**: a complete mission on the trial Linear team, run by Nicolas.

## Next batches
| Batch | Expected result |
|---|---|
| 8 Two devs | The switch to two devs on the preparation screen, the split recomputed, the file area rule |
| 9 Tokens | The consumption per mission, per agent and per ticket |
| 10 MD connector | Tickets as Markdown files, to prove that the model does not depend on Linear |
| 11 Linear import | The Linear documents of a project copied into its `docs/` |
| 12 Remote machine | Devs started on ai-dev |
| 13 Screen polish | Conformity to the mockups, French texts chosen by Nicolas |

**Milestone 2**: a real mission on FlashGolf, on a small ticket chosen by Nicolas. Jiroo and Jira come after.

## What depends on Nicolas
- Create the trial Linear team and an access key for the connector.
- Say whether the repository is published on GitHub (private), needed for the PRs of the project itself.
- Validate the mockups of QA and Validate, and choose the texts.
- Confirm decision 0012 (TypeScript).
