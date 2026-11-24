## Why

At the end of each task, the agent must write what it learned or record "Nothing new" (`docs/prd.md` KB-05, decision D3, `docs/workflow.md` 4.10.2). Nothing writes `task.learned` today, `aw learn` has no `--nothing-new`, and the person cannot see on the task what the agent learned (gap M15). Also, a `files` knowledge file never reaches "Read now", because the session context gets no task paths, and the skill does not tell the agent to search the knowledge first (KB-16, KB-17).

## What Changes

- One awd service method records the learning step of a task: a learned item (a new knowledge file) or "Nothing new". Each call writes `task.learned` to the task log, by the agent of the session or the person.
- `aw learn <task> --nothing-new`, `nothing_new` on the MCP tool `learn`, and `nothing_new` on `POST /v1/workspaces/{ws}/knowledge/learn`. The reply has the task event (`task_event`).
- The event `task.learned` gets optional fields `path`, `change` and `suggestion` for a learned item.
- `aw thread` and the desktop thread show "Learned by claude@ubuntu-01: <path>" (with Undo on the desktop) and "Nothing new learned by claude@ubuntu-01".
- Task paths: the context builder matches the paths named in the title and the first message. The session context adds the paths named in the confirmed approach and the changed files of the session worktree. A `files` file whose glob matches one is in "Read now".
- The allow rules of a session add `aw learn`, `aw kb write`, `aw kb search`, `aw kb show`, `aw kb list` and `aw kb context`. `aw kb accept|reject` stay person commands.
- The AW skill, the MCP instructions and the session context tell the agent to search the knowledge first and to record `learn` or "Nothing new" before `done`.
- `done` stays possible with no learning step. The `done` reply and the "Result approved" notice remind the agent. At the end of the session of a done task with no `task.learned`, AW writes a thread comment.

## Capabilities

### New Capabilities
- `task-learning`: the learning step of a task (learned item or "Nothing new"), its event in the task log, the thread text, and the reminder when a task is done with no learning step.

### Modified Capabilities
- `knowledge-store`: "Read now" also matches the paths named in the title and the first message of the task.
- `agent-sessions`: the session context passes the task paths (approach text, changed files of the worktree) and has the 2 knowledge rules.
- `agent-claude-plugin`: the allow rules of the knowledge commands, and the skill rules "search the knowledge first" and "learn or nothing-new before done".
- `mcp-server`: the tool `learn` takes `nothing_new`.
- `aw-cli`: `aw learn --nothing-new` and the thread text of `task.learned`.
- `desktop-app`: the thread line of `task.learned` with Undo.

## Impact

- Code: `daemon/src/service/learning.ts` (new), `daemon/src/sessions/task-paths.ts` (new), `daemon/src/api/knowledge.ts`, `daemon/src/cli/kb.ts`, `daemon/src/cli/format.ts`, `daemon/src/mcp/tools.ts`, `daemon/src/sessions/manager.ts`, `daemon/src/sessions/context.ts`, `daemon/src/loop/loop.ts`, `daemon/src/loop/agent.ts`, `plugins/kb-files/src/context.ts`, `plugins/agent-claude/src/claude.ts`, `plugins/agent-claude/plugin/skills/aw/SKILL.md`, `desktop/src/renderer/src/components/Thread.tsx`.
- Contracts: `shared/schema` `task.learned` (optional fields), `shared/client` learn body and reply; generated `contracts/schemas`, `contracts/samples`, `contracts/openapi.yaml` and the generated Kotlin class. All additions are optional: old events and old clients stay valid.
- Docs: `docs/workflow.md` 4.10 and 8, `docs/phase-1.md` 5.9 and 9.1.6, `docs/architecture.md` 4.8.3.
- No new dependency, no environment variable, no migration.
