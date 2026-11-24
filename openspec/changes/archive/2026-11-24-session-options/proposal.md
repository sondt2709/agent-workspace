## Why

People need to skip permissions, to use Claude Code agent teams, and to start a session in a chosen folder (decision 36, review `ui-ux.md` 5.4, F-6, F-7, F-8). In a trial (ux-1) the task worked in a worktree of the session host, and no screen said where. Each session runs with `--permission-mode default` in `<AW_HOME>/worktrees/<task id>`, and nothing can change it (`daemon/src/sessions/manager.ts`). The phone cannot stop a session or start a new one (ptf-3).

## What Changes

- A permission mode for each session: Default, Accept edits, Skip permissions. A project default (synced) and a per-task value in New task, New session and Assign. Only a person sets the options; the fold ignores them on an agent event, and awd refuses them from a session caller. A project default "Skip permissions" counts only for a task that a person created, so an agent subtask never gets it.
- A spike on the real Claude Code proves that deny rules and a PreToolUse deny hold in skip mode, and that a wrapper (`sh -c`) passes a deny rule. So AW adds its own guard in the PreToolUse hook for each mode: person `aw` commands, the awd socket, and AW files.
- Agent teams: an "experimental" per-task switch. The session settings turn on the Claude Code agent team setting with the in-process display.
- Work in: Separate worktree (default), Project checkout (one session at a time), Other folder. New worktree folders get the task key (`aw-AW-1`) for tmux and Orca.
- The task shows "Works in <path> · branch aw/<key>" with Copy and Open, a red chip "Skips permissions" and a chip "Agent teams", on the desktop and the phone.
- The phone sets the options in New task and New session, and gets "Stop session" (new person event `session.stop_requested`).
- Desktop fix npc-11 (lead request): the workspace dialogs move into the dialog provider, so a narrow window does not close them.
- CLI flags: `aw task create|assign --permission-mode --agent-teams --work-in --folder`, `aw project edit --permission-mode`.
- **BREAKING** (format, minor): `project.yaml` gets `permission_mode`; `task.created` and `task.assigned` get `session_options`; `session.started` gets `permission_mode`, `agent_teams`, `work_in`; new event `session.stop_requested`. Older readers keep the fields (loose objects); older events read as the defaults.

## Capabilities

### New Capabilities

- `session-options`: the permission mode, agent teams and the working folder of a session: who sets them, the effective value, the guard, the launch, what each screen shows, the phone actions.

### Modified Capabilities

- `workspace-schemas`: the new fields and the event `session.stop_requested`.
- `workspace-merge`: the fold keeps `session_options` only from a person, adds `created_by` and the session folder, mode and teams to the task view, and accepts `session.stop_requested` only from a person.
- `agent-sessions`: the worktree folder name by key, the Project checkout and Other folder modes, the stop on `session.stop_requested`.
- `agent-claude-plugin`: the launch arguments and the session settings for each mode and for agent teams; the deny rules of the person commands.

## Impact

- Code: `shared/schema`, `shared/core/src/merge`, `android/shared` (fold, generated classes), `daemon/src/sessions` (manager, new guard), `daemon/src/bin/aw-hook.ts`, `daemon/src/service/workspace.ts`, `daemon/src/api`, `daemon/src/cli`, `plugins/agent-claude`, `plugins/host-orca`, `shared/plugin-api`, `shared/client`, `desktop/src` (dialogs, task Properties, project Settings), `android/control`, `android/app`.
- Contracts: generated schemas, samples and Kotlin classes; `contracts/openapi.yaml`; a new merge case `contracts/fixtures/merge/session-options/`; the expected views of the other merge cases get the new view fields.
- Docs: `docs/workflow.md`, `docs/phase-1.md` 3 and 9, `docs/architecture.md` 4.6, `SECURITY.md`, `docs/design.md`.
- Security: high. Skip mode runs each command with no gate; the guard and the residual risk are in `SECURITY.md`.
