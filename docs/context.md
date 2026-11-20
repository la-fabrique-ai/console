---
title: Mission Control — the project in one page
status: in force
date: 2026-11-20
author: Pilot
---

# Mission Control

## Goal
Nicolas hands over a request (a ticket) and follows its development by coding agents until its validation. The tool must stay simple and readable: a single flow, few screens, only the essentials.

## The flow of a mission
1. **Prepare**: Pilot writes the spec with Nicolas. The Lead proposes a split into tickets, as a draft. Nicolas validates; the sub-tickets are then created.
2. **Develop**: one or two devs code the tickets. Each ticket is reviewed by an independent reviewer.
3. **Test**: the QA agent tests against the criteria of the spec.
4. **Validate**: Nicolas checks, then closes. If he refuses, the Lead turns it into fix tickets in the same mission.

## The roles
Pilot (spec), Lead (split and coordination), dev (1 or 2), reviewer (other model family than the dev), QA. A watcher starts the next agent when the previous one has finished.

## The building blocks
- **Screens**: native in Herdr App, in a separate Herdr installation. Four screens: Inbox, Development, the page of a mission, the terminal of an agent. In French.
- **Engine**: in TypeScript, run from the command line. One readable state per mission.
- **Tickets**: a ticket base owned by the system, fed by one connector per project (Linear first, then MD files, Jiroo, Jira).
- **Code**: one branch and one PR per ticket, stacked on the PR of the mission. GitHub, through `gh`.
- **Plans and memory**: in `docs/` of each project's repository.

## What the first version does not do
Budget limits and alerts, pause and resume, tracking of deviations from the plan, a "since your last visit" summary, Kanban, more than two devs, import of the old system's history.

## Rule of conduct
Each special case does not become a rule. Before adding a state or a command, we check that no existing one is enough. See [[0001-start-from-scratch]].
