# Mission Control — rules for agents

## Before you work
Read `GLOSSARY.md` and `docs/context.md`, then the spec or the plan of your mission in `docs/missions/<ticket>/`, then the decisions it cites in `docs/adr/`. A dev reads only its ticket, its mission and the cited decisions.

## Where documents go
- `docs/context.md`: the project in one page. Updated by Pilot when a mission is closed, if a decision changed the architecture or a rule.
- `docs/adr/`: one decision per file, numbered. A decision is never edited: a new one supersedes it and says so. It is valid only with Nicolas's agreement.
- `docs/missions/<ticket>/`: `spec.md`, `split.md`, `report.md`. One file per author: two agents never write the same file.
- `docs/index.md`: generated, never written by hand.
- Each document carries a header: title, status, date, author.

## Agent skills
- Issue tracker: `docs/agents/issue-tracker.md`. Domain documents: `docs/agents/domain.md`. Vocabulary: `GLOSSARY.md`.
- Skills used as they are (Matt Pocock's AI Hero skills): `grilling` before each slice, `domain-modeling`, `tdd`, `code-review`, `diagnosing-bugs`, `pr`, `writing-for-agents`, `prototype`, `retro`.
- Not used: `to-spec`, `implement`, `implement-spec`, `triage`, `wayfinder`. They publish to the ticket tool, self-review or merge without a PR per ticket (decisions 0005, 0007, 0008).
- A slice cuts through engine, screen and tests and can be shown alone (decision 0014).

## Working rules
- A ticket or a brief says what to obtain and how we will know it is finished. The dev chooses its approach.
- Tests are written before the code for anything that touches sending to a terminal, the ticket tool or git.
- The author of a change never reviews it: the reviewer is from the other model family, on a specific commit.
- No push, merge, remote repository creation or write to a real ticket tool without Nicolas's explicit agreement, as long as the system does not do it itself as part of a validated mission.
- No secret in the repository, the logs, the screenshots or the briefs.
- No mention of the author (Claude or Codex) in commits and PRs.
- Code, commits and repository documents are in English. All on-screen text is in French, written by Codex and chosen by Nicolas. Reports and questions addressed to Nicolas are in French, in simple words.
- No patch-over: a defect is fixed at its cause. If the cause is not found, say so instead of adding a layer.
- Never modify the old system or its Herdr installation.

## Sizing: keep it small
The old system became an over-engineered machine because every imagined case became a rule. Here, the measure of a good batch is what it did not add.

- Do what the batch asks, nothing more. No command, state, option or setting that the success criterion does not require.
- Do not handle a hypothetical case. If you see an edge case that the batch does not ask for, do not code it: note it in your report, under "Deliberately not handled", in one line. Nicolas decides.
- No abstraction for a single use. One more layer, interface or file is justified by two real uses, not by a future use.
- Before adding a state or a command, check that an existing one is not enough, and say so in the report.
- Size: an engine batch aims for a few hundred lines of code, tests aside. Beyond 400 lines, stop and ask: the batch is too big or you are doing too much.
- Proportionate tests: they check the contract of the batch (what goes in, what comes out, the refusals asked for), not every imaginable branch. The tests do not clearly exceed the code they check.
- A refusal or an error code exists only if someone uses it: a screen that shows it, or an agent that acts on it.
- The report ends with three short lists: "Done", "Deliberately not handled", "Could be removed".
- The reviewer checks proportion like everything else: anything the batch did not ask for is a "to remove" remark.
