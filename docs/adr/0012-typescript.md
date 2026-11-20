---
title: The engine is written in strict TypeScript
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0012 — The engine is written in strict TypeScript

## Context
The old engine is in plain JavaScript. Nicolas asks for something more solid.

## Decision
The engine and the connectors are in strict TypeScript. Node 24 runs TypeScript directly: no compilation step to run a command, and a type check in the project verification. The ticket model, the state of a mission and the contract of the commands are shared types. The screens stay JavaScript files as long as Herdr App does not load anything else; they use these same types through a check of their annotations. To verify in batch 0: what Herdr App accepts as a screen file.

## Why
Types enforce the contract between engine, connectors and screens, where the old system relied on tests and conventions.

## Accepted
Nicolas, 2026-11-20: « S'il y a moyen de faire du TypeScript, on fait tout en TypeScript » (if TypeScript is possible, everything is in TypeScript). Engine, connectors and tests are in TypeScript. The screens too, if Herdr App loads them or if a build step from TypeScript stays simple; slice 1 settles it.
