## Why

People who use Orca want to see the AW sessions of a device in Orca (decision `2026-11-22-modules.md`, `prd.md` AGT-19). Phase 1 ships `host-orca` as an optional session host plugin next to `host-tmux`, with the same session behaviour. The plugin is a placeholder now.

## What Changes

- `plugins/host-orca`: an `OrcaHost` that implements `SessionHost` through the Orca CLI (`docs/phase-1.md` 9.9):
  - detect: the path of `AW_ORCA`, then the macOS app bundle, then `orca-ide` or `orca` in `PATH`; `status --json` must say the runtime is ready; the version must be 1.4.257 or later; the host stores the full path.
  - open in 2 steps: `worktree create` (the repo is added to Orca first when Orca does not know it), then `terminal create --command "exec env AW_NODE=... AW_HOME=... <aw-launch> <session>"`. The command has no message, no user text and no token.
  - input: `terminal send --text <text> --enter --wait-submit 10 --json`, only when the hooks say the agent is idle and no permission dialog is open. After an ambiguous failure the host sends again with `--retry-request <id>`.
  - output: hooks and the transcript only. The host never reads the Orca screen.
  - stop: the process-group stop of `docs/phase-1.md` 9.7 on the pid from `terminal create`, then `terminal close`. The stored pids are used only while Orca shows the same terminal incarnation.
  - a fake Orca CLI for tests, built from captured real outputs, that runs each terminal in a private tmux server.
- `shared/plugin-api`: optional `SessionHost` members `readsScreen`, `worktree()`, `find()` and `submit()`, and the optional `PaneRef.instance`. `host-tmux` does not change.
- awd: one host per session. A new session runs in Orca when the task asks for `orca`, else when the checkout binding asks for it, else when "Use Orca on this device" is on. A running session keeps its host. When Orca is off or missing, the session runs in tmux and the task gets one comment.
- Device bindings: `use_orca` (default `false`) and an optional `session_host` per checkout.
- New session: `task.created` and `task.assigned` get an optional `session_host`; the local API (`createTask`, `assignTask`) and the CLI (`aw task create|assign --host tmux|orca`) take it.
- Settings: `AW_ORCA` (the Orca binary).
- Docs: the minimum Orca version is 1.4.257 (the version of the real test device), not 1.4.268. The result of an Orca restart is recorded in `docs/phase-1.md` 9.9.

## Capabilities

### New Capabilities
- `session-host-orca`: the Orca session host: detect, the 2-step open, input, output, the stop, restart behaviour and the fake Orca CLI.

### Modified Capabilities
- `agent-sessions`: the host choice of a new session, one host per session record, and delivery through a host that does not read the screen.
- `workspace-schemas`: the bindings fields `use_orca` and `session_host`, and the optional `session_host` of `task.created` and `task.assigned`.
- `local-api`: the optional `session_host` of create task and assign task.
- `aw-cli`: the option `--host tmux|orca` of `aw task create` and `aw task assign`.

## Impact

- New code: `plugins/host-orca/src/` (host, CLI adapter, process table, fake Orca), tests in `plugins/host-orca` and `daemon/src/sessions/orca.e2e.test.ts`.
- Changed code: `shared/plugin-api/src/session-host.ts`, `shared/schema/src/documents.ts` and `events.ts`, `shared/client/src/schemas.ts`, `daemon/src/sessions/{plugins,service,manager,records,testing}.ts`, `daemon/src/settings.ts`, `daemon/src/service/workspace.ts`, `daemon/src/api/app.ts`, `daemon/src/cli/run.ts`.
- Generated files: `contracts/schemas/`, `contracts/samples/`, `contracts/openapi.yaml`, `android/shared/generated/`.
- No new library: `execa` is in `docs/tech-stack.md` already.
- Real tests on the Linux remote device use a private Orca runtime (`ORCA_USER_DATA_PATH`, `orca-ide serve`), so the Orca app of the person and its repos stay untouched.
