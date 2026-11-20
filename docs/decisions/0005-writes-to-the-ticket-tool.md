---
title: Four write actions in the ticket tool
status: accepted
date: 2026-11-20
author: Pilot
supersedes: none
---

# 0005 — Four write actions in the ticket tool

## Context
The engine must not damage the ticket tool of a real project.

## Decision
The engine writes to the external tool only through four actions of the connector: create the sub-tickets of the split, after Nicolas's validation; change their status; add a comment (report, link to the PR); put in the main ticket a short summary of the spec and the link to its file. Never a deletion. The Lead's split stays a draft in our base until Nicolas has validated it.

## Why
Actions that are few and named can be tested and reviewed. A broad two-way synchronization cannot be kept under control.
