---
title: Screens first, for people who are not terminal experts
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0015 — Screens first, for people who are not terminal experts

## Context
Nicolas, 2026-11-20: tomorrow the tool is given to people who are neither strong coders nor heavy AI users. They must be able to work through a simple interface and follow the developments.

## Decision
- **Everything can be done from the screens.** A person runs a whole mission without typing in a terminal: describe the request, answer questions, validate the split, follow progress, validate the result. This rule guides every screen.
- **The terminal stays reachable at all times**, for whoever wants it: the screens are an interface over the terminals, not a replacement.
- **The conversation with Pilot is a discussion panel in the page**: the person's messages, Pilot's questions asked in rounds as in a grilling, each with a recommended answer and buttons to accept it, and the spec building up beside it.
- **One person per installation in the first version.** No accounts, no rights, no shared server. Texts and code speak of "the operator" (the person who drives), never of Nicolas, so that the tool can be handed to someone else without rewriting. Several people on one mission comes later.
- **Validation and merge are two separate steps.** The operator validates the result by using it and reading the QA report. Merging the main PR into the project belongs to a technical owner named per project.

## Why
If non-technical people use it, the screen is the product. Keeping the terminal reachable costs nothing and keeps experts fast.
