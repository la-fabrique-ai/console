---
title: Pilot prepares everything, the Lead executes
status: accepted
date: 2026-11-20
author: Pilot
supersedes: 0003 and 0014 (the Lead as the one who splits)
---

# 0016 — Pilot prepares everything, the Lead executes

## Context
Decisions 0003 and 0014 gave the split to the Lead. Nicolas asked, on 2026-11-20, whether preparation belongs to Pilot or to the Lead, "for a question of context".

## Decision
Pilot runs the whole preparation: the interview, the spec and the split into tickets. The operator validates the spec, then the plan. At launch, the sub-tickets are created and the Lead starts with a fresh context. It reads three files — the spec, the split and the operator's answers to the questions — then coordinates the devs, the reviews and the QA. The Lead may propose an adjustment to the plan along the way; it does not redo it.

The preparation is five screens, in this order: the request, the questions (one question on screen at a time, with Pilot's proposed answer, "validate" or "change", and the list of all questions in a block beside it), the spec, the plan (tickets in order, one or two devs, estimated duration), the launch. Reference: `docs/mockups/suggestions/prepare-flow.html`, validated by Nicolas as a direction on 2026-11-20.

## Why
The split needs the reasons heard during the interview. The Lead's context stays free for the development, which is its longest part. The handover goes through files, not through what an agent remembers. It is also the order of the AI Hero skills: interview, spec and split in one session, development in fresh agents.
