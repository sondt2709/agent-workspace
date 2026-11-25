# Decision: Discuss is a conversation, and one proposal

| Item | Value |
|---|---|
| Date | 2026-11-26 |
| Status | Accepted by the product owner |
| Changes | `prd.md` 6, TSK-09 to TSK-12, TSK-19, TSK-25, TSK-27, MCP-01; `workflow.md` 3, 4.4, 4.5, 4.6 and 8; `phase-1.md` 3; `design.md` 8.6 and 8.19; `architecture.md`; the AW skill; decision `2026-11-25-task-page.md` item 7 is withdrawn |

## Request
In a real Discuss stage the person could not follow the task. Activity had 5 row styles, each question came twice (a message and a gate), the plan had choices in it, the agent asked "May I write approach v5?" as a gate, and that gate stayed open after v5 came. The person uses the term "proposal", not "approach". The agent did what the AW skill told it, so the framework must change first.

## Decision
1. The term is **proposal** in each place: the UI, the docs, the skill, the CLI (`aw proposal`), the MCP tool `proposal`, the notices and the stored names (`proposal.proposed`, the gate kind `approve_proposal`, `proposal/v<n>.md`, the task field `proposal: {latest, approved}`). Readers map the old names (`approach.proposed`, `confirm_approach`, `approach/`, `approach: {latest, confirmed}`); writers write only the new names. `aw approach`, the MCP tool `approach` and the route `/approach` stay as aliases.
2. The agent sends only two things in Discuss: **messages** and **one proposal**. It asks each question with `ask` (all questions in one ask, options as buttons, the recommendation in the text), never also with `message`.
3. The agent writes the proposal only when no question is open. A proposal has no open question and no choice. The agent never asks for permission to write it.
4. **One proposal**: a new version replaces the open one. The person can only **approve** it, or discuss it with a message. "Request changes" on a proposal is removed.
5. A new question or a new proposal closes the older open questions ("Replaced by a newer question", "Replaced by proposal v<n>"). A late answer becomes a comment.
6. The decisions of a gate (`--decisions`, the decision picker, "Send my choices") are removed.
7. Activity has 3 row styles: a message, the proposal card, a task line. Gate lines, version lines and AW notes show only in Session.
8. The proposal opens in full screen with a text size (14 to 24 px, steps of 2 px) that each device keeps.
9. The phone Inbox is the desktop Inbox.

## Reasons
- The person reads one conversation. A question is part of it, so it is a message, not a second kind of item.
- A proposal with choices is a question in disguise; the choices go in the discussion first.
- One open proposal and one open question at a time remove the stale gates that the person answered hours later.
- One term in the code and the UI: the agent reads event types and file paths in `aw thread`.

## Not in this decision
- A change to the stages or to "Approve result".
- A rewrite of old log lines: the logs are append-only.
