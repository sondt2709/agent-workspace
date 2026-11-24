## Why
The Activity tab shows the full text of each agent turn. The Stop hook writes `last_assistant_message` as `message.agent`, and `aw message` writes the same event, so the apps cannot separate them. In a trial (AW-3), 4 of 5 agent messages in Activity came from the Stop hook, each with 2,500 to 3,500 characters. They repeated the approach and the gate that the agent also sent through AW. The original requirement is that the agent sends its updates to AW through MCP or the CLI. AW keeps the session output, but it does not put that output in Activity.

## What Changes
- `message.agent` gets the optional field `source`: `turn` (the Stop hook) or `tool` (`aw message` and the MCP tool `message`). An old event has no source.
- Activity shows a `message.agent` only with the source `tool` or with no source. A `turn` message shows only in the Session tab, word for word (principle 8).
- The plugin skill, the MCP server instructions and the AW rules of `context.md` tell the agent:
  - Its text output goes only to the Session log.
  - It ends each turn with an AW call: `ask`, `approach`, `ready`, `result`, `gate`, `message`, `learn` or `done`.
  - A `message` is short and for a phone screen. It does not repeat a gate.
- A turn that ends with no AW call, no open gate of the task and no Reply gate gets one notice. The notice tells the agent to send its update through AW. AW sends at most 1 notice per turn and never after the turn of a notice. `message.sent` gets the optional field `kind`, and a notice of this kind has `kind: nudge`. Activity does not show it.
- awd compares the `session_id` of each hook event with the AW session id. On a mismatch it writes the comment "Hook events of another Claude session (<id>) arrive in this session" once per foreign id, and it keeps the events.
- `session.started` gets the Claude session name (`-n <key>`) and the terminal (`window`, `pane`). `session.resumed` gets the terminal and the pids of the new pane. The Session summary on the desktop and the phone shows the full session id, the name, the terminal and the pid.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `agent-sessions`: the Stop hook writes `message.agent` with source `turn`. A new requirement covers the notice after a turn with no update. A new requirement covers the hook session check. `session.started` gets the name and the terminal.
- `mcp-server`: the tool `message` writes the source `tool`. The server instructions give the turn rule.
- `aw-cli`: `aw message` writes the source `tool`.
- `agent-claude-plugin`: a new requirement for the update rules of the skill.
- `workspace-schemas`: `message.agent.source`, `message.sent.kind`, `session.started.name` and `session.started.terminal`.
- `desktop-app`: the Activity rule hides `turn` messages and nudge notices. The Session summary shows the link data.
- `android-app`: the same Activity rule and Session summary on the phone.

## Impact
- Code: `shared/schema/src/events.ts`, `shared/core/src/merge/task.ts`, `daemon/src/sessions/manager.ts`, `daemon/src/sessions/context.ts`, `daemon/src/mcp/` (instructions), `plugins/agent-claude/src/claude.ts` (the session id of each hook), `plugins/agent-claude/plugin/skills/aw/SKILL.md`, the fake agent, `desktop/src/renderer/src/activity-model.ts`, `desktop/src/renderer/src/components/TaskDetail.tsx`, the Kotlin merge in `android/shared`, `android/control` (`ActivityRule`, `TaskDetail`).
- Contracts: the generated schemas, samples and Kotlin classes (`pnpm schema:generate`), and `contracts/fixtures/activity/cases.json`.
- Docs: a new decision `docs/decisions/2026-11-25-agent-pushes-updates.md`, `docs/phase-1.md` 9.6, `docs/architecture.md` 4.5, `docs/workflow.md` 4, `docs/design.md` 8.6.
- Data: no migration. Old events keep their place in Activity.
- Cost: a notice is one more agent turn. AW sends it only after a turn with no update.
