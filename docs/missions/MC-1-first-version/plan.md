---
title: Plan of the first version
status: to be validated by Nicolas
date: 2026-11-20
author: Pilot
ticket: MC-1
---

# Plan of the first version

## Goal
An operator runs a whole mission from the screens, without typing in a terminal: a request in Linear, a spec written with Pilot, a validated split, tickets built and reviewed, a QA, a validation, stacked PRs. First on the Linear team Jiroo, used as the test ground, then on a real FlashGolf ticket.

## Decisions
All in `docs/adr/` (0001 to 0016). This plan does not repeat them. The method is decision 0014; the screens-first rule is decision 0015.

## Limits
- Nothing is taken from the old code without an explicit decision, piece by piece.
- Until milestone 2, the only Linear team the system reads and writes is Jiroo (key `JIR`), chosen by Nicolas on 2026-11-20 as the test ground. It is a real project: the system only touches the tickets Nicolas names for a test, and no other team.
- Each slice ships with its tests, is reviewed by the other model family, and is shown to Nicolas on screen before the next one.
- In a slice, Codex builds the engine part and Claude the screen part, as two sub-tickets.
- The flow goes into role skills. A slice adds code only for what must never fail and for what the screen displays.

## Slices of milestone 1
Each slice is a thin, complete path that can be shown alone.

| Slice | What the operator can do when it is done | Blocked by |
|---|---|---|
| 1 A mission appears | Open a project's issues, pick an issue of the Linear team Jiroo and ask to have it developed: the mission is created, shows in the Development list and opens on its page (title, stage) in the separate Herdr | the Linear access key |
| 2 A new ticket and the questions | Create a new ticket from the project's issues (title, what you want), then answer Pilot's questions one at a time, each with a proposed answer to validate or change, with the list of questions beside it. An answer reaches Pilot once | 1 |
| 3 The spec | Read the spec Pilot wrote, in the page. It is in `docs/missions/<ticket>/spec.md` on the mission branch; the main ticket carries its summary and link | 2 |
| 4 The plan and the launch | Read Pilot's draft split into slices with what blocks each one, ask for changes, validate, then launch: the sub-tickets are created in Linear and the Lead takes the mission with a fresh context | 3 |
| 5 One ticket, built and reviewed | Follow one ticket from start to accepted: a dev builds it test-first, a reviewer of the other family reviews it, its stacked PR is merged into the mission branch. Answer a dev's request in place | 4 |
| 6 All the tickets | See the next ready ticket start by itself until all are accepted. A high-risk ticket has its approach reviewed before code and two reviews | 5 |
| 7 Test and validate | Read the QA report, validate or say what is wrong (the Lead turns it into fix tickets in the same mission), close. The merge of the main PR is a separate step for the technical owner | 6 |

**Milestone 1**: Nicolas runs a whole mission on the Linear team Jiroo, from the screens only.

Slice 1 also settles the base: TypeScript strict, tests, project check, the separate Herdr installation, and what Herdr accepts as a screen file (decision 0012). It stays a slice: it ends with something on screen.

## Change of course, 2026-11-24
Two real runs of slice 5 on Jiroo showed that agents started on the Mac inside a home-made sandbox cannot do a real project's work (no database, no browser tests). Nicolas decided the following; decisions 0003, 0007 and 0008 are to be amended accordingly.

- **Agents run in `runtime`** (`la-fabrique-ai/runtime`), in containers on ai-dev, one VM per project: Jiroo and the portail for now. The engine no longer starts agents; it hands each ticket to the lead of the project's runtime team and follows it. Dev and reviewer are both Claude there, each in its own container.
- **Publication is the operator's click.** Agents never push. The click fetches and ships the tickets' branches from the Mac (signed with the operator's key), then the engine merges the tickets' pull requests into the mission's main branch. `main` stays the operator's.
- **The Lead decides, per mission, whether the tickets ship as a stack of pull requests or not.** A stack suits tickets that build on one another. A mission made of independent changes, such as a spec of acceptance feedback with several fixes, needs no stack: each ticket starts from the main branch. In runtime a stack stays with one dev, and a task starts from `main` or from another task, never from an arbitrary branch.
- **A failing agent is an alert**: in the banner of the Development page, as a notification, and in the Inbox.
- **Two projects in the layout**: Jiroo with the Linear connector, the portail with the Markdown connector.

Order of the next bits, each reviewed and shown before the next: the engine hands a ticket to runtime and follows it; publication; several projects; Markdown connector; Inbox.

## After milestone 1
| Slice | Result |
|---|---|
| Two devs | Switching to two devs in Prepare; the Lead recomputes the split; two ready tickets run at once |
| Tokens | Consumption per mission, per agent and per ticket |
| Markdown connector | Tickets as Markdown files; Mission Control tracks its own tickets with it |
| Linear import | A project's Linear documents copied into its `docs/` |
| Remote machine | Devs started on ai-dev |
| Screen finish | Conformity with the mockups, French texts chosen by Nicolas |
| Our own skills | The role skills refined from what the missions taught (`retro`) |

**Milestone 2**: a real mission on FlashGolf, on a small ticket chosen by Nicolas. Jiroo, Jira and several people on one mission come after.

## What depends on Nicolas
- Create a Linear access key for the connector, and name the Jiroo tickets used for the tests.
- Mockups: the preparation flow is validated (`docs/mockups/prepare-flow/`, 26 states); its open points are listed in `docs/mockups.md`. Still to simplify with Nicolas, slice by slice: Development, Inbox, Test, Validate.
