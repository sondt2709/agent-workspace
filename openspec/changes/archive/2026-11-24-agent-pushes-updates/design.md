## Context
- The Stop hook writes `message.agent {text: last_assistant_message}` (`daemon/src/sessions/manager.ts`, case `stop`). `aw message` and the MCP tool `message` write the same event through the 1-second buffer. The event has no source.
- `desktop/src/renderer/src/activity-model.ts` and `android/control` `ActivityRule` show each `message.agent` in Activity. Both test `contracts/fixtures/activity/cases.json`.
- A notice of AW is `message.sent` by `aw@<device>`. It shows in Activity.
- The adapter (`plugins/agent-claude/src/claude.ts`) reads `session_id` only from SessionStart, and awd does not compare it with the AW session id. On 2026-11-25, the spool files of 4 real sessions all had the AW session id, also the 177 events with an `agent_id` (subagents).
- The session view of the merge (`shared/core/src/merge/task.ts`, Kotlin `TaskFold.kt`) has the session id, the host, the cwd and the branch. It has no terminal and no session name. The session record has `launch.name` and `pane {window, pane, pid}`.

## Goals / Non-Goals

**Goals:**
- Activity shows only what the agent sends to AW, the gates and the task changes.
- The Session tab keeps each turn text word for word (principle 8).
- The agent knows that only AW calls reach the human. AW reminds it once when a turn ends with no update.
- A person can see which Claude session and which terminal a task uses. awd warns when hook events of another Claude session arrive.

**Non-Goals:**
- The model, the context use, the cost or the tokens of a session.
- A change of the Reply gate from a turn that ends with a question.
- A change of old events or a migration.

## Decisions

### D1. A `source` field on `message.agent`, not a new event type
`message.agent` gets `source: "turn" | "tool"`, optional. The Stop hook writes `turn`. `aw message` and MCP `message` write `tool`. Activity hides only `turn`, so an old event (no source) shows as before.
- Alternative: a new event `session.turn`. An older app shows an unknown type in Session only, but each reader of the thread (the `thread` tool, the gate context, the handoff) must learn a second type. The field keeps one type for one concept.

### D2. The turn rule is in the text that the agent reads
The rule goes in 3 places: `SKILL.md` (at most 6,000 characters), the MCP server instructions (fewer than 4,096 characters), and the AW rules of `context.md`. The rule is: "Your text output goes only to the Session log. The human reads only AW. End each turn with an AW call. A `message` is short, for a phone screen, and does not repeat a gate."

### D3. The update check reads the merged log
At a Stop, awd looks at the events of the session after the start of the turn. The start of the turn is the last `message.human` or `session.resumed` of the session. The turn has an update when the agent actor wrote one of these events in that range:
- `message.agent` with source `tool`
- `gate.opened`
- `approach.proposed`
- `task.ready`
- `result.posted`
- `task.done`
- `task.learned`

The Stop write goes through `buffer.now`, which writes the waiting buffered events first. So a buffered `aw message` of the turn is in the log before the check. A check from the log also works after an awd restart.
- Alternative: a flag in the session record, set by each agent command. It needs a change in each command, and a crash between a command and the save loses it.

### D4. The notice after a turn with no update
awd writes the notice when all of these are true:
- The turn has no update (D3).
- No gate of the task is open (a person already has an item to act on), and no Reply gate opened at this Stop.
- The task is not done.
- The turn did not start with a nudge notice.
- The turn did not start with text that a person typed in the terminal (source `typed` with no delivery id), because that person reads the terminal.

The notice is `message.sent {id, text, to_session, kind: "nudge"}` by `aw@<device>`, and safe delivery sends it as `[AW notice <id>] …`. The event id comes from the spool file of the Stop (the hook write), so a retry does not write it again. The text is: "Your turn ended with no AW update, and the human reads only AW. Send the update now: `message` (short), or `ask`, `approach`, `result` or `gate`. Then end your turn." Activity hides `message.sent` with `kind: nudge`.

### D5. The hook session check warns and keeps the events
The adapter returns `sessionId` for each hook event. When it is not null and not the AW session id, awd writes the comment "Hook events of another Claude session (<first 8 characters>) arrive in this session. AW keeps them. Check the terminal of this task." once per foreign id. The record keeps the list `foreign_sessions`. Then awd handles the event as before (the decision of the human: warn, not drop).

### D6. The link data is in `session.started` and in the session view
`session.started` gets `name` (the `-n` value, null when none) and `terminal {window, pane}` (null fields when not known). A resume opens a new pane, so the `session.resumed` of an `[AW resume]` input gets the `terminal` and the `pids` of that pane. The merge copies them into the session view (TypeScript and Kotlin). A `session.resumed` with no terminal ("Resume again") keeps the values. The Session summary shows:
- The full session id: it is the Claude session id (`--session-id`).
- The name.
- The terminal: `tmux window <w> · pane <p>`, or the Orca terminal.
- The pid.

## Risks / Trade-offs
- [The agent ignores the rule and gets a notice after many turns] → The notice costs 1 turn and AW sends at most 1 per turn. The real Claude run with haiku measures it.
- [A person loses the text of a turn that was the only answer] → The Session tab shows it in full. The notice asks the agent to send it.
- [The check misses an update that is still in the buffer] → The Stop write flushes the buffer first (D3). A test covers `aw message` and a Stop in the same second.
- [New fields change the expected merged views in `contracts/fixtures/merge/`] → Update the expected files, and run the TypeScript and Kotlin merge tests.

## Migration Plan
No migration. Old events have no source and no kind, and they keep their place. An app of the old version shows a `turn` message in Activity until it updates. Rollback: revert the change. The new fields are optional, so the old code reads the new events.

## Open Questions
None.
