# Markdown ticket connector

Tickets are Markdown files kept in each project's repository, one file per ticket. No account, credential or
network access is involved. Select it for the whole Console with `"tracker": {"driver": "markdown"}`.

## Location

`<first repository of the project>/la-fabrique/output/tickets/<KEY>.md`, for example
`/path/to/portail/la-fabrique/output/tickets/PORTAIL-12.md`. The key prefix is the project key in capitals. The
folder is created by the first creation; an absent folder is an empty, complete collection. The Console writes
these files but never commits: the owner commits them with the project.

A project needs an explicit scope, which is its key: `"ticketScope": {"connection": "primary", "scopeId": "portail"}`.

## File

```
---
id: 6f1c2d4e-0000-4000-8000-000000000000
key: PORTAIL-12
title: Afficher la carte
status: ready
parent: PORTAIL-11
blocked-by: PORTAIL-9, PORTAIL-10
labels: agent:codex, niveau:standard
created: 2026-11-19T10:00:00.000Z
updated: 2026-11-19T10:00:00.000Z
---

Description in Markdown.

## Commentaires

### 2026-11-19T10:05:00.000Z — Lead

Comment text.
```

`id` is opaque and never changes; `key` must match the file name. A value starting or ending with a space or a
quote is written as a JSON string. Statuses are fixed: `backlog` (Backlog), `ready` (Prêt), `active` (En cours),
`done` (Terminé), `canceled` (Annulé); any other value reads as category `unknown`. Children and blocked tickets
are derived from the other files' `parent` and `blocked-by`.

## Behaviour

- Reads return the common `Ticket` payload (`../ticket.mjs`) through the engine's current issue shape.
- A file that cannot be read as a ticket marks the collection incomplete with its reason; it is never dropped
  silently, and its number is never reused.
- Creation is journaled by `operationId` and replay-safe; a new file never replaces an existing one. Status
  changes and comments replace the file whole, after reading it again.
- Capabilities: comments, children, enriched reads and writes. No groupings, documents, milestones, priority or
  assignee: filters on them match nothing.
- Agents read and edit the files at their absolute path (see `agent-instructions.md`).

## Limits

The Console lock does not cover edits made by hand or by an agent at the same moment; the later write wins.
