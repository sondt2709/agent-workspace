## Why

Principle 2 says "keep working forever": the work must continue after a reboot, a crash, an update or a usage limit, and each stop must show its cause and when the work continues. The sessions-tmux task built the resume, but a focused review found 6 problems in it (`inputs/resume-review.md`), and the pause states, the usage limits, the agent queue, the test slots, the watchdog, the wake branch, the device health and the self-update are not built yet.

## What Changes

- Fix the resume logic: a resume count that resets only after progress, plus a hard limit (5 resumes per hour); `aw-launch` exit 3 (awd not ready) does not count; a lost transcript starts the session again with the first input and a note; the first input is kept on an early resume; an unknown window of the same task is adopted or stopped before a resume; `CLAUDE_CONFIG_DIR` goes into `launch.env` when awd has it. The fake agent refuses `--session-id` of a session that has a transcript ("already in use").
- Pause states with a cause, a next step and the resume time: `usage_limit`, `usage_limit_weekly`, `continue_cap`, `device_restart`, `device_revoked`, `agent_error` and `login_expired` (`task.paused` / `task.resumed`). `device_offline` stays a view of the presence (the offline device cannot write).
- Usage limits from the statusline (`rate_limits.*`) and StopFailure `rate_limit`: Claude Code continues alone after a 5-hour reset; AW continues after a weekly reset (or when the auto continue is off) at most 3 times, then opens "Continue after usage limit".
- Sign-in state from `claude auth status --json` once per hour: a comment and a push 3 days before `loginExpiresAt`, the pause `login_expired` (with a push) when the login ended, and no new session start.
- Agent queue: at most `maxWorking` (default 2, `AW_MAX_WORKING`) working sessions per agent on a device; a session at a gate or paused does not count; the queued tasks start in the order of `queue.reordered`, then by creation.
- Test slots: `aw slot acquire|release` and the MCP tools `slot_acquire`/`slot_release`: leases with fencing tokens and a 30-minute TTL from the device that has the resource, a queue position when all slots are taken, renewal by the holder, release at the session end, revoke at expiry and after a reboot.
- Watchdog: "No recent update" (`task.progress`) after 2 min with no hook event and no screen change, a check after 15 min ("Busy for 15 min: <step>" or the gate "Take over terminal" for a prompt that no hook reported).
- A revoked device stops its sessions; each session that ends loses its `credentials/` folder.
- A laptop that wakes after the human moved its task pushes its unpushed work as `aw/<key>-<device>-<time>` and writes a system comment.
- Device health: `tasks/devices/<device>/health.yaml` at most once per 60 s.
- Self-update mechanism: `~/.aw/versions/<version>/`, a `current` link, an Ed25519 signature check of the tarball and a launcher that goes back to the previous version after 3 failed starts. The release pipeline signs later.

## Capabilities

### New Capabilities
- `session-continuity`: pause states, usage limits, sign-in state, agent queue, watchdog, revoked device, wake branch and device health.
- `test-slots`: slot leases with fencing tokens, TTL, queue and release.
- `self-update`: versions folder, signature check, `current` link and rollback.

### Modified Capabilities
- `agent-sessions`: "Reconcile and resume" gets the progress reset, the hard limit, the exit-3 rule, the lost transcript, the early resume and the unknown window.
- `agent-claude-plugin`: `aw-launch` exports `CLAUDE_CONFIG_DIR`; the plugin has `bin/aw-statusline`; the fake agent refuses a used session id.
- `mcp-server`: `slot_acquire` and `slot_release` are built.
- `aw-cli`: `aw slot acquire|release` are agent commands.
- `local-api`: the session routes `slots/acquire` and `slots/release`.

## Impact

- `daemon/src/continuity/` (new): resume policy, pauses, usage, queue, watchdog, slots, wake branch, health, auth monitor, update.
- `daemon/src/sessions/manager.ts`, `service.ts`, `records.ts`: hooks into the new module.
- `daemon/src/bin/aw-statusline.ts` (new), `plugins/agent-claude/plugin/bin/aw-statusline`, `plugins/agent-claude/src/claude.ts` (statusline parser), the fake agent.
- `daemon/src/mcp/tools.ts`, `daemon/src/api/sessions.ts`, `daemon/src/cli/agent.ts`, `shared/client`, `contracts/openapi.yaml`.
- Docs: `docs/phase-1.md` 9.6 and 9.7, `docs/architecture.md` 4.6 and 4.7, `AGENTS.md` Status.
- No new library: `@noble/curves` is already in the catalog (`shared/identity`).
