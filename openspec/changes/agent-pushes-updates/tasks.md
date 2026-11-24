## 1. Evidence before the change

- [x] 1.1 Run awd with `AW_HOME=/tmp/aw-before` and the fake agent on the base commit. Let the fake agent run `aw message` and end the turn with a long text. Take a screenshot of the desktop Activity tab.

## 2. Schema and contracts

- [x] 2.1 Add `message.agent.source`, `message.sent.kind`, `session.started.name` and `session.started.terminal` to `shared/schema/src/events.ts`, with schema tests (old event valid, bad source refused)
- [x] 2.2 Run `pnpm schema:generate` for the JSON Schemas, the samples and the Kotlin classes
- [x] 2.3 Add the cases of the turn message, the tool message, the old message and the nudge notice to `contracts/fixtures/activity/cases.json`

## 3. Daemon

- [x] 3.1 Write `source: turn` at the Stop hook and `source: tool` in `message()` (`daemon/src/sessions/manager.ts`), with tests for the CLI and MCP paths
- [x] 3.2 Return `sessionId` for each hook event in `plugins/agent-claude/src/claude.ts`. Add the foreign-session comment once per id, and keep the ids in the session record, with tests for a foreign id, a subagent event and an awd restart
- [x] 3.3 Add `name` and `terminal` to `session.started`, with a test
- [x] 3.4 Add the update check and the nudge notice at the Stop (`message.sent` with `kind: nudge`, an id from the spool step), with tests for text only, a message in the same second, no second notice, a person at the terminal, an open gate, a Reply gate and a done task
- [x] 3.5 Put the turn rule in the AW rules of `daemon/src/sessions/context.ts` and in the MCP server instructions (fewer than 4,096 characters), with tests

## 4. Plugin

- [x] 4.1 Rewrite `plugins/agent-claude/plugin/skills/aw/SKILL.md` with the Session log rule, the turn rule and the nudge rule, below 6,000 characters
- [x] 4.2 Let the fake agent run `aw message` and then end the turn with a long text (`plugins/agent-claude/src/testing/fake-claude.ts`)

## 5. Merge and apps

- [x] 5.1 Copy `name` and `terminal` into the session view of the TypeScript merge and of the Kotlin `TaskFold`. Keep them at `session.resumed`. Update the expected files in `contracts/fixtures/merge/`
- [x] 5.2 Desktop: hide `turn` messages and nudge notices in `activity-model.ts`. Show the link data in the session summary of `TaskDetail.tsx`. Show the turn text in the Session tab with its source
- [x] 5.3 Phone: the same rule in `android/control` `ActivityRule`, and the link rows in `TaskDetail.sessionSummary`, with JVM tests

## 6. Docs

- [x] 6.1 Write `docs/decisions/2026-11-25-agent-pushes-updates.md`
- [x] 6.2 Update `docs/phase-1.md` 9.6, `docs/architecture.md` 4.5, `docs/workflow.md` 4 and `docs/design.md` 8.6

## 7. Checks and evidence

- [x] 7.1 Break each new test once, see it fail, and restore the code
- [x] 7.2 Run `task check` and `task leakcheck`
- [x] 7.3 Run `task e2e`. Read the thread on the second device: the turn message has the source `turn`, the tool message has `tool`
- [x] 7.4 Run awd with `AW_HOME=/tmp/aw-after` and the fake agent. Take screenshots of the desktop Activity and Session tabs
- [x] 7.5 Run 1 or 2 short tasks with real Claude Code (haiku) on nuc-remote. Count `message.agent` by source and the nudge notices
- [ ] 7.6 Take a screenshot of the phone Activity on nuc-android
