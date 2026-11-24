## 1. Resume fixes (inputs/resume-review.md)

- [x] 1.1 Record fields `resume_times`, `launch_waits`, `restart_boot`, `continues`, `usage_pause`, `auto_resume_disabled`, `agent_errors`, `agent_retry`; pure `resumePlan()` in `daemon/src/continuity/resume.ts` with unit tests
- [x] 1.2 Manager: progress reset (Stop, PostToolUse, 10 min alive), hard limit 5 per hour, exit 3 not counted, lost transcript fresh start with note, first input on an early resume, "Take over terminal" on failure
- [x] 1.3 Adopt or stop an unknown `aw-<task>` window before a resume (`ps` of the pane pid)
- [x] 1.4 `CLAUDE_CONFIG_DIR` in `launch.env` only when awd has it; the trust state file follows it
- [x] 1.5 Fake agent: refuse `--session-id` of a session with a transcript

## 2. Pauses, usage, agent errors, sign-in

- [x] 2.1 `pause.ts`: write `task.paused`/`task.resumed` with no duplicates
- [x] 2.2 `aw-statusline` (bin, plugin wrapper, settings `statusLine`, `AW_USER_STATUSLINE`); adapter `parseStatusLine`; `usage.json`
- [x] 2.3 `usage.ts` pure rules: cause, resume time, AW continue time, cap of 3; manager wiring for StopFailure, the quota notifications, the continue notice and the gate
- [x] 2.4 Agent error backoff and "Take over terminal" after 3
- [x] 2.5 `auth.ts` AuthMonitor (hourly), `login_expired` pause, 3-day warning (comment and push), no new start
- [x] 2.6 Device restart: a window opened before the boot time, the `device_restart` pause and the restart comment

## 3. Queue, watchdog, revoke, wake, health

- [x] 3.1 `queue.ts` pure order and count; `AW_MAX_WORKING`; gate in the claim loop (login, 90 % window, 95 % disk)
- [x] 3.2 `watchdog.ts` pure state; 30 s check in the manager
- [x] 3.3 Revoked own device: stop sessions, no claims; remove `credentials/` of records that leave `running`
- [x] 3.4 `wake.ts`: commit, branch, push, comment on a `moved` stop
- [x] 3.5 `health.ts`: health document at most once per 60 s

## 4. Test slots

- [x] 4.1 `slots.ts` SlotService (acquire, renew, release, expiry, end of session, reboot)
- [x] 4.2 Session routes, client methods, CLI `aw slot acquire|release`, `AGENT_COMMANDS`, MCP tools; OpenAPI regenerated

## 5. Self-update

- [x] 5.1 `update.ts`: signature check (node:crypto Ed25519), unpack, `current` and `previous` links, `failed-starts` file, healthy reset
- [x] 5.2 `launcher.ts`: the POSIX launcher script with the rollback after 3 failed starts, tested with `sh`

## 6. Docs and checks

- [x] 6.1 Docs: `phase-1.md` 9.6, 9.7, 9.8; `architecture.md` 4.6, 4.7; `AGENTS.md` Status
- [x] 6.2 `task check` green (JAVA_HOME), one commit, archive the change
