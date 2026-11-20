---
title: One PR per ticket, stacked on the PR of the mission
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0008 — One PR per ticket, stacked on the PR of the mission

## Context
Nicolas wants a stack system: the main ticket has its PR, each sub-ticket has its own.

## Decision
The main PR goes from the mission branch to the main branch of the project. Each sub-ticket has its branch and its PR, which targets the mission branch. A ticket that depends on another starts after that one is merged. The system pushes the branches, opens the PRs as drafts and merges the PR of a ticket when the reviewer accepts it. The main PR belongs only to Nicolas: he merges it after his validation. GitHub only, through `gh`, in the first version.

## Why
Since all PRs target the mission branch, there is no chained rebase, and two tickets in parallel do not get in each other's way.
