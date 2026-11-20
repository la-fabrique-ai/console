---
title: A single flow, four screens, in French
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0002 — A single flow, four screens, in French

## Context
The old system mixed several pages per step and several views of the same content.

## Decision
A mission follows four steps: prepare, develop, test, validate. The first version covers them all, each reduced to the essentials. Four screens: Inbox, Development (the list of missions), the page of a mission (same frame from start to end, the blocks change content depending on the step), the terminal of an agent. All texts are in French, written by Codex and chosen by Nicolas, in one batch per screen. The Claude Design mockups of Prepare and Develop serve as art direction; QA and Validate get two or three variants to validate before the code.

## Why
Nicolas wants the same blocks from preparation to validation, and simple screens.
