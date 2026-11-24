# Decision: the agent sends its updates to AW

| Item | Value |
|---|---|
| Date | 2026-11-25 |
| Status | Accepted by the product owner |
| Replaces | "Stop writes each agent reply" in Activity: `../phase-1.md` 9.6 item 4 and the hook table, `../architecture.md` 4.5 item 5, `../workflow.md` 4.1 |
| Related | Principles 4, 7 and 8, `../design.md` 8.6, openspec change `agent-pushes-updates` |

## Context
The Stop hook wrote the full text of each agent turn as `message.agent`, and Activity showed each one. In a trial, 4 of 5 agent messages of a task came from the Stop hook, each with 2,500 to 3,500 characters, and they repeated the approach and the gates. The product owner wants the agent to send its updates through MCP or the `aw` CLI. AW does not take the session output for Activity.

## Decision
1. The agent sends each update through AW: `ask`, `approach`, `ready`, `result`, `gate`, `message`, `learn` or `done`. The skill, the MCP server instructions and `context.md` tell it to end each turn with one of these.
2. The Stop hook still writes the text of the turn, word for word (principle 8), as `message.agent` with `source: turn`. It shows only in the Session tab.
3. `aw message` and the MCP tool `message` write `message.agent` with `source: tool`. Activity shows a `message.agent` with the source `tool` or with no source (an older event).
4. A turn with no update, no open gate and no Reply gate gets one notice, `message.sent` with `kind: nudge`: "Your turn ended with no AW update…". AW sends at most 1 per turn, never after the turn of a nudge, and not after text that a person typed in the terminal. The notice shows only in Session.
5. awd compares the `session_id` of each hook event with the AW session id. On a mismatch it writes one comment for each foreign id and keeps the events.
6. `session.started` and `session.resumed` name the Claude session (`name`), the terminal (`window`, `pane`) and the pids. The Session summary shows them.

## Consequences
1. Activity has the task changes, the gates, the answers, and what the agent sent. The Session tab has each turn text and each notice.
2. A nudge costs one agent turn. It comes only after a turn with no update.
3. Old events keep their place. An app of an older version shows a `turn` message in Activity until it updates.
