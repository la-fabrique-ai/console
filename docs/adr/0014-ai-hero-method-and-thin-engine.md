---
title: The AI Hero method, a thin engine, roles as skills
status: accepted
date: 2026-11-20
author: Pilot
supersedes: 0003 (the file-area rule as the rule for parallel work)
---

# 0014 — The AI Hero method, a thin engine, roles as skills

## Context
Matt Pocock's skills (AI Hero, installed in Claude and Codex) run a whole flow, from interview to PR, with about thirty instruction files and no engine: the agent carries the flow, and the state lives in the tickets and in git. The old Mission Control enforced its flow with 13,000 lines of code. Survey: `docs/research/skills-ai-hero.md`.

## Decision
Their method becomes our way of working; Mission Control is a thin layer on top of it.

- **The flow lives in role skills.** Pilot, Lead, dev, reviewer and QA each follow a skill kept in this repository, derived from the AI Hero texts and rewritten to respect our decisions: Pilot does not publish to the ticket tool, a dev never reviews itself, PRs go through the stack.
- **Code keeps only what must never fail, and what the screens need**: sending an answer once, the four write gestures to the ticket tool, opening and merging PRs, the validation gates, the state the screens display.
- **Vertical slices.** The Lead splits a mission into tickets that each cut through engine, screen and tests and can be shown alone. Each ticket says which tickets block it; a ticket is ready when its blockers are done. With two devs, two ready tickets run at the same time, each in its own worktree. The file area is a check the Lead makes to avoid conflicts; the blocking edges decide.
- **Spec template**, from `to-spec`: problem, solution, user stories, implementation decisions, testing decisions, out of scope. The user stories stay short: only what the mission delivers. No file paths or code snippets.
- **Document layout**, the one their skills know: `GLOSSARY.md` at the root, `docs/adr/` for decisions, `docs/agents/` for the project settings (where the tickets live, labels).
- **A request carries a recommended answer**, so that "yes" is enough.
- **A decision is written only if** it is hard to reverse, surprising without its context, and the result of a real trade-off.
- **To build Mission Control now**, used as they are: `grilling`, `domain-modeling`, `to-tickets` (for the idea, not for publishing), `tdd`, `code-review`, `diagnosing-bugs`, `pr`, `writing-for-agents`, `retro`, `prototype`. Not used: `to-spec`, `implement`, `implement-spec`, `triage`, `wayfinder`, which contradict decisions 0005, 0007 and 0008.

## Why
An instruction is less reliable than a program, so what must never fail stays in code. Everything else is cheaper to write, to read and to change as a skill, and can be refined over time.
