---
title: A ticket base of our own, one connector per project
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0004 — A ticket base of our own, one connector per project

## Context
Nicolas wants a system independent of the ticket tool: Linear today, Jiroo, Jira or plain MD files tomorrow.

## Decision
The system has its own ticket base, which is the reference for the engine. One connector per project feeds it from the external tool and reports the changes back to it. A project has only one connector. Order: Linear, then MD files, then Jiroo and Jira. Fields of a ticket: identifier and displayed key; origin (connector, external identifier, link); title; description in Markdown; type (main or sub-ticket) and parent; status; priority (0 to 4); size (Light, Standard, Heavy); level (normal or high-risk); order, dependencies, file area; planned dev; comments. Eight common statuses, translated by each connector: To do, In preparation, In progress, In review, In test, To validate, Done, Cancelled. The screens show them in French. No attachments, sprints or points in the first version.

## Why
Linear and Jiroo both sort their statuses into categories specific to each team: a common list translated by the connector suits both. Beads was ruled out on 2026-11-20 so as not to depend on a third-party tool.
