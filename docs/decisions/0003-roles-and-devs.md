---
title: Five roles, one or two devs
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0003 — Five roles, one or two devs

## Context
Parallel work was the biggest source of complexity: areas, lanes, locks, resumes.

## Decision
Five roles: Pilot, Lead, dev, reviewer, QA, plus a simple watcher. On the preparation screen, the Lead first proposes a split into tickets in sequence, for one dev. Nicolas can switch to two devs: the Lead recomputes the draft. Each ticket declares the files or folders it touches; two tickets run at the same time only if their file areas do not overlap, otherwise they run one after the other and the screen says so. The rule is checked at the split, with no lock along the way. The tool of each dev (Claude or Codex) is chosen at the same moment.

## Why
A single rule, checked once, replaces the whole mechanism of areas.
