---
title: A single type of request, answered in place
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0006 — A single type of request, answered in place

## Context
The old system distinguished question, blocker, alert, authorization and mockup choice, each with its own states. A blocker could not be answered from the page.

## Decision
An agent that needs Nicolas creates a request. Nicolas sees it in the Inbox and in the page of the mission, and answers it in the same place, with a text or with a click on a proposed answer. The answer arrives in the agent's terminal, only once. Nicolas can also hand the request over to the Lead. Only a screen can answer: an agent never answers in Nicolas's place.

## Why
A single mechanism covers all cases and avoids side effects between types.
