---
title: Independent review, validated approach for high-risk tickets
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0007 — Independent review, validated approach for high-risk tickets

## Context
A dev of the old system stopped because the project rules asked to have its approach validated before coding, and the engine did not have that step.

## Decision
Normal ticket: one review, by a reviewer from the other model family than the dev, on a specific commit. High-risk ticket (security, authentication, payments, data migrations): the dev writes its approach, the reviewer validates it, the dev codes, then two reviews. The reviewer does not fix; any fix requires a new review.

## Why
The step exists in the rules of the projects: the engine must carry it instead of discovering it through a blocker.
