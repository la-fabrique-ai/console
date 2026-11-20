# Glossary

The words of the project. Code, documents and skills use these words and no synonyms. On screen, they appear in French.

| Term | Meaning |
|---|---|
| Mission | The work on one main ticket, from the request to its closing. It goes through four stages. |
| Stage | Prepare, Develop, Test, Validate. |
| Operator | The person who drives a mission from the screens. Not necessarily a developer. |
| Technical owner | The person, named per project, who merges the main PR. |
| Ticket | A unit of work in our own ticket base, fed by a connector. |
| Main ticket | The ticket the mission is about. |
| Sub-ticket | A ticket created by the split, child of the main ticket. |
| Slice | A sub-ticket that cuts through engine, screen and tests and can be shown alone. |
| Blocked by | The tickets that must be done before a ticket can start. |
| Ready ticket | A ticket whose blockers are all done. |
| High-risk ticket | A ticket touching security, authentication, payments or data migrations. Approach reviewed before code, two reviews. |
| Connector | The piece that links our ticket base to one ticket tool (Linear, Markdown files, Jiroo, Jira). One per project. |
| Write gesture | One of the four writes allowed to the ticket tool: create sub-tickets, change a status, add a comment, put the spec summary and link in the main ticket. |
| Spec | What the mission must deliver, written by Pilot with the operator. `docs/missions/<ticket>/spec.md`. |
| Split | The Lead's breakdown of the spec into slices. A draft until the operator validates it. `split.md`. |
| Report | What was done and learned, written by the Lead at closing. `report.md`. |
| Request | Anything an agent needs from the operator. It carries a recommended answer and is answered in place, once. |
| Pilot | The role that writes the spec with the operator. |
| Lead | The role that splits the spec and coordinates. |
| Dev | The role that builds one ticket. One or two per mission. |
| Reviewer | The role that reviews a ticket. Other model family than the dev. Never fixes. |
| QA | The role that tests the mission against the spec. |
| Watcher | The small program that starts the next agent when the previous one is done. |
| Role skill | The instruction file a role follows. The flow lives there, not in the engine. |
| Mission branch | The branch that collects the mission's tickets. Its PR to the project's main branch is the main PR. |
| Stacked PR | The PR of one ticket, targeting the mission branch. |
| Engine | The code that must never fail: sends, write gestures, PRs, validation gates, and the state the screens display. |
