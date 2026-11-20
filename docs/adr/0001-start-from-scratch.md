---
title: Start from scratch, engine included
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0001 — Start from scratch, engine included

## Context
The old system stacks four generations of screens (14 screens) and an engine of 13,000 lines, 96 commands and more than 110 numbered decisions in the code. Each fix breaks another one. Nicolas, on 2026-11-19: « c'est une usine à gaz » ("it is an over-engineered machine").

## Decision
We rebuild screens and engine in a new repository, `~/Developer/mission-control`, with a separate Herdr installation. From the old system we take only proven building blocks, one by one, when they serve the new need: access to Linear, sending to a terminal, starting an agent. The old system is frozen (blocking fixes only), finishes the missions in progress, then stops. No history is transferred.

## Why
A deliberately small scope gives a readable result. A cleanup of the old engine would keep its architecture, which is the source of the complexity.
