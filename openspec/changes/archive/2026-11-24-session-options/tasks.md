## 1. Spike

- [x] 1.1 Prove deny rules, the PreToolUse deny and the PermissionRequest hook in `bypassPermissions` on the real Claude Code (the Linux test server, haiku); record the spike in the gate
- [x] 1.2 Prove the warning dialog and `skipDangerousModePermissionPrompt` in the `--settings` file
- [x] 1.3 Record the hook events of an in-process agent team

## 2. Schema and fold

- [x] 2.1 `shared/schema`: `permissionMode`, `sessionOptions`, `project.permission_mode`, `session_options` on `task.created` and `task.assigned`, `session.started` fields, event `session.stop_requested`; samples (valid and invalid)
- [x] 2.2 `shared/core` fold: `session_options` from a person only, `created_by`, the session fields, `session.stop_requested`; `effectiveSessionOptions()`; unit tests
- [x] 2.3 Merge case `contracts/fixtures/merge/session-options/`; regenerate the expected views; `pnpm schema:generate`
- [x] 2.4 Kotlin fold (`android/shared`) and `SessionOptions.effective`; `MergeCasesTest` passes

## 3. awd

- [x] 3.1 `daemon/src/sessions/guard.ts` (the PreToolUse check) and `aw-hook` deny with the spool `denied` field; awd comment "AW denied …"; unit tests
- [x] 3.2 Adapter `sessionSettings()` and the mode map (`plugins/agent-claude`, `shared/plugin-api`); deny rules from `HUMAN_COMMANDS`; tests
- [x] 3.3 Service and API: `session_options` on create and assign, `permission_mode` on project edit, 403 for a session caller; `shared/client`; OpenAPI
- [x] 3.4 CLI flags `--permission-mode`, `--agent-teams`, `--work-in`, `--folder` on `task create|assign`, `--permission-mode` on `project edit`
- [x] 3.5 Session manager: effective options at the start, record `launch.agent_teams`, `session.started` fields; worktree `aw-<key>` (tmux and Orca aliases); checkout mode (one per checkout); folder mode (checks, no branch, no push); trust of a chosen folder
- [x] 3.6 Stop on `session.stop_requested`
- [x] 3.7 tmux e2e with the fake agent: launch args per mode, guard in skip mode, agent subtask has no skip, worktree name, checkout refuses a second session, folder mode, stop request

## 4. Desktop

- [x] 4.1 `SessionOptionsFields` (mode, teams "experimental", Work in with "Choose…"), in New task, New session and "Assign to another device…"; the checkout warning
- [x] 4.2 Task header chips and Properties rows (Permissions, Agent teams, Works in with Copy and Open); bridge `openFolder`
- [x] 4.3 Project settings: the default permission mode
- [x] 4.4 Renderer tests; `cd desktop && task check`
- [x] 4.5 npc-11 (lead request): the workspace dialogs Add a workspace, Rename and Remove live in `DialogsProvider`, so a window resize across 600 px does not close them (a test that failed first)

## 5. Phone

- [x] 5.1 `android/control`: options in the New task draft and the assign action, `stopSession` (`session.stop_requested`), the task rows; JVM tests
- [x] 5.2 `android/app`: New task fields, the task values, "Stop session" and "New session"

## 6. Docs and checks

- [x] 6.1 `docs/workflow.md`, `docs/phase-1.md` 3 and 9, `docs/architecture.md` 4.6, `SECURITY.md`, `docs/design.md`
- [x] 6.2 Real Claude on the Linux test server: one AW skip session with the real plugin (no dialog, guard denies `sh -c "aw gate answer …"`)
- [x] 6.3 Desktop journey (off-screen, dark, light, 400 px) and phone journey (the Linux test server, own AVD)
- [x] 6.4 Break each new test once; root `task check` on the commit
