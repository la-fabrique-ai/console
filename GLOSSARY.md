# Console

The Console prepares, develops, validates and closes work described in tickets, whatever ticket system holds them.

## Tickets

**Ticket**:
A unit of work recorded in a ticket system and read or written by the Console, in one payload common to every connector.
_Avoid_: Issue, Item

**Sub-ticket**:
A ticket whose parent is another ticket, one level below it in the ticket system's hierarchy.
_Avoid_: Child issue

**Level**:
The rank of a ticket in its system's hierarchy (for example component, epic, task, sub-task); a ticket system may have a single level.
_Avoid_: Type (for the hierarchy rank)

**Status**:
The ticket system's own workflow state of a ticket, with its native identity and wording.
_Avoid_: State

**Status category**:
The Console's fixed classification of a status: backlog, ready, active, done, canceled or unknown.
_Avoid_: Status type

**Ready**:
The category of a ticket that may begin now.

## Where tickets live

**Ticket system**:
The external service or local files that hold the tickets of a Console.
_Avoid_: Tracker, provider

**Connector**:
The bundled adapter that translates one ticket system to and from the Console's ticket model; one connector serves a whole Console.
_Avoid_: Plugin, driver (except as the configuration key)

**Scope**:
The single area of a ticket system that one Console project works in, such as a team, a backlog, or a project's Markdown folder.
_Avoid_: Team, backlog (as generic terms)

**Grouping**:
An optional subdivision of a scope, which some ticket systems do not have.
_Avoid_: Project (for this meaning)

**Console project**:
A configured unit of work in the Console, tied to exactly one scope and one or more repositories.
