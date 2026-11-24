## Why
awd can store tasks and gates, but it cannot run an agent yet. People must be able to start Claude Code sessions on their own computers, answer them from any device, and read each original message in the thread (principles 1, 2 and 8, `docs/phase-1.md` 9.1 to 9.7).

## What Changes
- New interfaces in `shared/plugin-api`: `AgentRuntimeAdapter` and `SessionHost` (`docs/architecture.md` 6.2).
- New plugin `plugins/host-tmux`: the default session host. It uses a private tmux socket (`tmux -L aw`), a config with `remain-on-exit on` and `exit-empty off`, exec-form windows, input with `load-buffer` and `paste-buffer -p` and one Enter, `capture-pane` only for dialogs and the watchdog, the exact pids, and a stop of the process group.
- New plugin `plugins/agent-claude`: the AW plugin directory for Claude Code (`.claude-plugin/plugin.json` with `"name": "aw"`, `skills/aw/SKILL.md`, `hooks/hooks.json`, `bin/aw`, `bin/aw-hook`), the Claude adapter (version, auth type, launch arguments, hook payload parser, worktree trust entry), and a fake `claude` for tests that sends hook payloads copied from the verification on 2026-11-22.
- New `daemon/bin/aw-launch`: the fixed launcher. It reads the first input from a file, pre-trusts the worktree, checks `/readyz`, exports the session environment, and runs `claude` with `--` before the message.
- New session manager in `daemon/src/sessions/`: claims with an epoch, start, resume after a crash or an awd restart, stop by process group, reconcile at start, the hook spool, safe delivery with a delivery id, gate resolution for the gates of the session, the permission gate (120 s), and the 1-second log buffer for session events.
- New local API routes `/v1/sessions/...` and new `aw` commands for agents: `aw ask`, `aw message`, `aw stage`, `aw artifact add`, `aw handoff`, plus `aw session list|stop` and `aw thread --from`. The hooks run the separate binary `aw-hook` (`daemon/src/bin/aw-hook.ts`), not an `aw` command. Inside a session the CLI refuses the commands of a person.
- `aw service install` on Linux also writes the systemd user unit `aw-sessions.service`, so a restart of awd does not stop tmux. The LaunchAgent and the LaunchDaemon get `AbandonProcessGroup`.
- `/readyz` reports the session host (`ok` or `failed`).

## Capabilities

### New Capabilities
- `agent-sessions`: claims, start, resume, stop and reconcile of agent sessions; the hook spool; the thread from hooks; safe delivery; gates from hooks; the permission gate; the log buffer.
- `session-host-tmux`: the tmux session host.
- `agent-claude-plugin`: the AW plugin directory for Claude Code, the Claude adapter, `aw-launch` and the fake agent.

### Modified Capabilities
- `aw-cli`: the agent commands, the refusal of the commands of a person inside a session, `aw session`, and `aw thread --from`.
- `local-api`: the session routes and the session host check of `/readyz`.
- `awd-service`: the settings for tmux and the agent binary, the session manager at start, and the `aw-sessions` unit.

## Impact
- Code: `shared/plugin-api`, `plugins/host-tmux`, `plugins/agent-claude`, new files in `daemon/src/sessions/`, `daemon/src/api/sessions.ts`, `daemon/src/cli/agent.ts`, `daemon/bin/aw-launch`, `daemon/src/bin/aw-launch.ts`, `daemon/src/bin/aw-hook.ts`. Small edits in `daemon/src/service/daemon.ts`, `daemon/src/service/workspace.ts`, `daemon/src/api/app.ts`, `daemon/src/cli/run.ts`, `daemon/src/settings.ts`, `daemon/src/units/units.ts` and `shared/client/src/schemas.ts`.
- Contract: `contracts/openapi.yaml` gets the session routes (regenerated with `pnpm api:generate`).
- Dependencies: `execa` (already in `tech-stack.md`) in `plugins/host-tmux` and `plugins/agent-claude`. No new library.
- New environment variables in the settings module: `AW_TMUX`, `AW_TMUX_SOCKET`, `AW_CLAUDE`, `AW_CLAUDE_MODEL`, and the session variables `AW_SESSION`, `AW_TASK`, `AW_WORKSPACE` that `aw-launch` exports for the agent commands.
- The user's Claude Code state file (`~/.claude.json`): `aw-launch` adds only the trust entry of a worktree that AW created, after a backup, on a covered Claude Code version.
- Docs: `docs/phase-1.md` 9, `docs/architecture.md` 4.5 and 4.6, `docs/workflow.md` 8, `docs/tech-stack.md` 1.3, `AGENTS.md` Status, `e2e/README.md` (the opt-in real Claude Code run).
- Undo: remove the new folders and files, revert the small edits, and run `pnpm api:generate`.
