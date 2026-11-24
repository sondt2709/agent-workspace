## Context

The session manager (`daemon/src/sessions/manager.ts`) claims tasks, opens windows, drains the hook spool, resolves gates, delivers texts and resumes dead panes every 5 s. The task loop (`daemon/src/loop/`) writes the stages and the `waiting_for_sync` pause. The merge already folds `task.paused`/`task.resumed` (with `needs_human` giving a "Needs you" reason), the slot events of the workspace log (only from the device that has the resource, with a fencing token that never goes back), `queue.reordered` and `health.yaml`. The resume logic has the 6 findings of the focused review. Nothing reads the statusline, the sign-in state or the boot time for sessions.

## Goals / Non-Goals

**Goals:** the 9 items of the continuity handoff on the session device, with pure policy functions that unit tests cover, and small hooks in the manager.

**Non-Goals:** slot leases across devices (a lease of a resource on another device); the release pipeline that signs the tarball; `aw doctor`; the Inbox UI of the pauses (desktop and phone show the Paused chip already); `network_lost` (the device cannot tell it from a peer that is offline); the sign-in flow from the phone (4.6.7 item 2).

## Decisions

1. **New folder `daemon/src/continuity/`.** One file per concern: `resume.ts` (the resume policy, pure), `pause.ts` (the pause writer: writes `task.paused` only when the cause or the text changes, and `task.resumed` only for its own causes), `usage.ts` (statusline signals, StopFailure, the continue rule, pure), `queue.ts` (order and count, pure), `watchdog.ts` (pure state per session), `slots.ts` (the slot service), `wake.ts` (the wake branch), `health.ts` (the health document), `auth.ts` (sign-in state), `update.ts` and `launcher.ts` (self-update), `processes.ts` (`ps` of a pane pid). The manager calls them; this keeps `manager.ts` changes to wiring (parallel note).

2. **Resume count with progress (review item 1).** SessionStart no longer resets `resumes`. Progress resets it: a Stop or a PostToolUse hook after the window opened, or 10 min alive since the window opened (`PROGRESS_ALIVE_MS`). A hard limit: at most 5 resumes in a rolling hour (`resume_times` in the record), then `failed` with the comment "Resume failed" and the gate "Take over terminal". Alternative: reset at SessionStart plus a hard limit only: an agent that dies after SessionStart would then use the 5 resumes in 25 s each hour.

3. **Exit 3 does not count (review item 2).** A dead pane with status 3 (aw-launch: awd not ready in 10 s) opens again with the same mode and no count change, at most once per 30 s (`LAUNCH_WAIT_RETRY_MS`), and at most 20 times in a row; after that it counts as a normal failure. Alternative: a longer wait in aw-launch: the window still dies when awd starts slowly.

4. **Lost transcript (item 3).** When the next resume would reach the limit (or the agent refused it) and the adapter says that no conversation exists while `first_seen` is true, AW starts the session again with `--session-id` and `continue.md` = the first input + "\n\nAW note: the earlier conversation of this session was lost. Read `aw thread <key>` before you act." This counts as a restart (limit 3). The resumes before it stay: the first `--resume` can still work when the adapter is wrong.

5. **Early resume keeps the first input (item 4).** A resume of a session with `first_seen` false sends the first input file as the message (aw-launch makes the same short text for a long input), so the UserPromptSubmit hook still writes the source `first`.

6. **Unknown window (item 5).** Before a resume opens a window, AW lists the panes named `aw-<task>`. For each live pane that is not the stored one, it reads `ps -o pgid=,args=` of the pane pid: a process that has the session id in its arguments is adopted (the record gets that pane), else AW stops it (process group) and closes it. So one task never has 2 windows.

7. **`CLAUDE_CONFIG_DIR` (item 6).** `launch.env` gets `CLAUDE_CONFIG_DIR` only when awd has it in its environment. Setting it to the default `~/.claude` would move the state file of Claude Code (`~/.claude.json` → `~/.claude/.claude.json`) and log the user out. The trust state file follows the same rule.

8. **Pauses are events of the owner device**, written through the log buffer: `usage_limit`, `usage_limit_weekly`, `continue_cap`, `agent_error`, `device_restart`, `login_expired`. `device_offline` stays the view of the presence (`presence.offline_tasks`): the offline device cannot write, and another device is not the owner. `device_revoked`: the revoked device stops its sessions; its later events are ignored by the merge (`revoked_at`), so the pause is a view of the device record for the other devices (open issue for the UI). `task.resumed` is written when the cause ends: the next prompt or tool event after a usage or agent-error pause, the SessionStart after a device restart, a valid login.

9. **Usage signals.** `aw-statusline` (the session `statusLine` command in the session settings file) reads the statusline JSON, writes `usage.json` in the session folder (0600) when `rate_limits` changed, then runs the user's own `statusLine.command` (from `<config>/settings.json`, given by awd as `AW_USER_STATUSLINE`) with the same input and prints its output. awd reads `usage.json` at each check (no spool file per redraw). The adapter parses the payload (`parseStatusLine`): `resets_at` is Unix seconds. A StopFailure `rate_limit`:
   - 7-day window at 100 % or a reset more than 24 h away → `usage_limit_weekly`, AW continues at `resets_at` + 2 min;
   - else `usage_limit`, Claude Code continues by itself; AW continues itself only when the Notification `quota_auto_resume_disabled` came, or after a restart of the window;
   - no known window → `usage_limit` with no resume time.
   `quota_auto_resume_fired` writes `task.resumed`; `quota_auto_resume_stale` sends Enter. An AW continue is a notice "The usage limit was reset at <time>. Continue the task." (safe delivery). The 4th continue in one session opens "Continue after usage limit" and the pause `continue_cap` (needs the human). The answer resets the count.

10. **Agent error.** A StopFailure that is not `rate_limit` pauses `agent_error` with a retry at 1, 2, 4 min; at the retry time AW sends the notice "The last turn failed (<error>). Continue the task." A Stop resets the count. The 3rd failure in a row opens "Take over terminal".

11. **Sign-in.** `AuthMonitor` in `SessionService` runs `claude auth status --json` at start and once per hour (never a credential file). Logged out or `loginExpiresAt` in the past: each running session task gets `login_expired` (needs the human, push), and the manager starts no new session. Less than 3 days left: one comment per task with a running session and one push per login end date. A valid login writes `task.resumed` for the `login_expired` pauses.

12. **Agent queue.** `AW_MAX_WORKING` (default 2). Working = a running session of the agent on this device whose task has no open gate and no pause. A new claim (not a resume) waits while the count is at the maximum, the login is not valid, the 5-hour window is above 90 %, or the disk of `AW_HOME` is 95 % full. The order: the newest `queue.reordered` of the agent, then the other tasks by creation order. A task that waits has no event; it shows "Queued" in the clients (assignee and no claim). The disk limit is the setting `AW_DISK_FULL_PERCENT` (default 95; the tests set 100, because the test computer can be full).

13. **Test slots on the resource device only.** The merge accepts slot events only from the device that has the resource, and no request event exists. So `slot acquire` works for a session on that device; a session on another device gets `not_available` that names the device. The `SlotService` (one per workspace manager) keeps an in-memory FIFO per resource (entries expire after 2 min with no new call). Acquire: the lease of the same session again → `slot.renewed` (a renewal of the holder; awd also renews the lease of each running session at ttl/3, the session heartbeat of `workflow.md` 3 rule 4); a free slot and first in the queue → `slot.acquired` with the fencing token = the highest token of that slot in the workspace log + 1, TTL 30 min (at most 24 h); else the queue position. Release by the holder with its token → `slot.released`. Each check: a lease past its expiry → `slot.revoked expired`; a lease of a session that is no longer running → `slot.released`; after a new boot, each lease from before the boot → `slot.revoked reboot`. The TTL uses the expiry of the merge (HLC time + TTL); the device clock is the only writer, so it is monotonic enough for 30 min.

14. **Watchdog.** Every 30 s for each running session with a live pane: the time of the last hook event and the sha256 of the visible screen. With no open gate and no pause, after 2 min with no hook event and no screen change, AW writes `task.progress` "No recent update for 2 min. Last terminal line: <line>" once per quiet period. After 15 min of quiet: a pending tool → `task.progress` "Busy for 15 min: <step>"; a dialog on the screen (layout check) with no permission hook → the gate "Take over terminal". A dead process is the pane check (every 5 s). AW never kills a live process. Other devices add `SYNC_DELAY_MS` (8 s) to their own staleness rule (exported constant).

15. **Revoked device.** When the own device record is revoked, the manager stops each running session (`stopped`, tokens revoked) and claims nothing. Each record that leaves `running` loses its `credentials/` folder; at start, the folders of records that do not run are removed too.

16. **Wake branch.** A stop with the reason `moved` (the task is now assigned to another device): in the worktree, uncommitted changes are committed ("AW: unpushed work of <key> on <device>"), and when `git rev-list HEAD --not --remotes` is not empty the branch `aw/<key>-<device>-<HHMM UTC>` is created and pushed to `origin`. The comment (`comment.added`, by `aw@<device>`; it is no longer the owner) names the branch, or says that the push failed and the branch is local. With no unpushed work, no branch and no comment.

17. **Device health.** Each manager writes `tasks/devices/<device>/health.yaml` at most once per 60 s, and only when the content (other than `updated`) changed or 10 min passed: boot time, versions (aw, agent), sessions (`running`, `gate`, `paused`, `ended`), usage of the login (`default`) with `login_expires_at`, the disk use of `AW_HOME`, `sync: []` and `last_backup: null` (placeholder fields; the schema is loose).

18. **Self-update.** `~/.aw/versions/<version>/` holds an unpacked release; `~/.aw/versions/current` is a symlink, switched by a rename of a temp link. A release tarball `aw-<version>.tar.gz` has a detached Ed25519 signature `aw-<version>.tar.gz.sig` (base64) over the sha256 of the tarball; the public key is a constant of the release (none yet: the caller gives it). Verification uses `node:crypto` (`Ed25519` JWK), so no new dependency. The state is 2 links and 1 file that the shell can read: `current`, `previous` and `failed-starts`. The launcher script (POSIX sh, `launcherScript()`; `aw service install` writes it later) reads the count before each start; at 3 it switches `current` back to `previous` (`ln -sfn`, which replaces the link on GNU and BSD), then adds 1 and runs awd of `current`. awd sets `failed_starts` to 0 after it is ready for 60 s. `installRelease` never touches tmux or the sessions.

## Risks / Trade-offs

- [The statusline runs only after the first API answer, and only for subscription logins] → a StopFailure `rate_limit` with no window gives `usage_limit` with no resume time; Claude Code still continues alone.
- [The real payloads of the statusline, of the quota notifications and of StopFailure `rate_limit` are not captured] → the parser reads the documented fields; "Test later" names a capture.
- [`ps` arguments of the pane pid can be cut on some systems] → AW only adopts on an exact session id match; else it stops the window, which is safe because one task has one session.
- [Cross-device slots are not built] → `not_available` names the resource device; open issue.
- [The watchdog `task.progress` stays on the card until the next progress] → the next hook event writes newer thread events; the card shows the newest.

## Migration Plan

New optional record fields with defaults (`resume_times`, `progress_at`, `continues`, `agent_errors`, `launch_waits`). Old records parse. No file format change.

## Open Questions

None that block: the open issues go to the result handoff.
