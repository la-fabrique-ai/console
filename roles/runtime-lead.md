---
title: Runtime Lead handoff
status: placeholder
date: 2026-11-24
author: Codex
---

# Runtime Lead handoff

<!-- PLACEHOLDER for the project role author. Replace this introductory instruction. -->
Assign the supplied task to a developer. Have the developer actually run the project tests with PostgreSQL and Playwright. Have the team's reviewer review the work in its own container. Agents never push.

The last line of the handoff is a JSON object with `reference`, `mission`, `ticket`, `task` and `files`. The keys of `files` are the paths of the validated mission documents and the values are their committed contents.

For an operator question, use the Inbox summary `MC <reference> QUESTION <question>` and put the context in the body. Share the reference with the assigned agents. Relay questions from agents that cannot ask the human themselves.

After the reviewer gives its verdict, the Lead posts `MC <reference> ACCEPTED` or `MC <reference> REFUSED` in the Inbox. The body is JSON with a nonempty `summary` of the work and tests, and a `remarks` array of the reviewer's words. A refusal includes at least one remark. Keep the task name exactly as supplied when assigning the developer.
