# Decision: The Inbox shows incoming messages, Tasks has "Needs you", and a project is a filter

| Item | Value |
|---|---|
| Date | 2026-11-27 |
| Status | Accepted by the product owner (prototype `inbox-prototype` v6 and the gate of 2026-11-27) |
| Changes | `prd.md` 6, INB-01, SIG-01 to SIG-11 (Mattermost moves to phase 1); `design.md` 8.2 to 8.4 and 9; `architecture.md` 6.2; openspec `nav-tasks-needs-you` and `inbox-mattermost` |

## Request
People get requests and questions in chat tools and copy them into tasks by hand. The person asked for an Inbox that can collect the messages, sort each topic into Action, Question or Info, suggest a task or an answer, and talk with the agent about a card. The sidebar with one row per project did not fit this, and "Needs you" in the Inbox mixed two kinds of items.

## Decision
1. The **Inbox** shows the cards of the incoming messages. A card has a category (Action, Question, Info), an urgency, the original messages and a suggestion. A card opens in a dialog on the desktop and as its own screen on the phone.
2. **Tasks** has the tabs "Needs you", "Working" and "All". "Needs you" holds what the old Inbox tab held (gates, assign, files to fix, then "Updates").
3. A **project is a filter**, not a sidebar row: a multi-select chip with a search field in Tasks and in the Inbox. The page Projects lists the projects.
4. A **card can have no project**. A **task always has a project**: "Create task" from a card asks for one.
5. The first source is **Mattermost**, through `@mattermost/client` (REST API v4, a personal access token kept as an AW credential). The Mattermost MCP server of the Agents plugin is off by default and needs an admin and OAuth, so AW does not use it.
6. **One computer collects** at a time: the main device or the remote device. The phone never reads the source. Adding the token from the phone is not in this change.
7. **One triage session** per workspace sorts the batches: Claude Code in tmux on the collecting computer, not a task. It writes cards only through its own MCP tools. A reply to the source needs a click of the person and is posted once.

## Reasons
- The person reads incoming work in one list and decides there; the agents' questions stay with the tasks.
- Many projects do not fit a sidebar; a filter works with 2 or 20.
- Polling with a cursor and an idempotent post needs a REST client; an agent never calls the chat tool.
- A remote collector keeps the Inbox full while the laptop is closed (principle 2).

## Not in this decision
- WhatsApp, Gmail and other sources.
- "Save to knowledge" of an Info card.
- Editing the source configuration on the phone (the phone shows it read-only).
