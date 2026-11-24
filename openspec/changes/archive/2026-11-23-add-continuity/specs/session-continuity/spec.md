## ADDED Requirements

### Requirement: Pause events of the session device
The session device SHALL write `task.paused {cause, resumes_at, next_step, needs_human}` (by `aw@<device>`) for the causes `usage_limit`, `usage_limit_weekly`, `continue_cap`, `agent_error`, `device_restart` and `login_expired`, only when the task is not paused with the same cause and text, and SHALL write `task.resumed` when the cause ends. `device_offline` SHALL stay a view of the presence, with no event. A pause SHALL NOT be a gate; only `continue_cap`, `login_expired` and an `agent_error` after 3 failures SHALL need the human.

#### Scenario: No second pause event
- **WHEN** two StopFailure `rate_limit` hooks arrive with the same reset time
- **THEN** the task log has one `task.paused` with the cause `usage_limit`

#### Scenario: Restart of the device
- **WHEN** awd starts after a reboot and resumes a running session
- **THEN** the task gets `task.paused device_restart` before the resume, and `task.resumed` and the comment "<device> restarted at <time>. AW resumed the session at <time>." after the SessionStart

### Requirement: Usage limits
awd SHALL read the usage windows of the statusline (`rate_limits.five_hour` and `rate_limits.seven_day`, `used_percentage` and `resets_at` in Unix seconds) from `usage.json` of the session, which `aw-statusline` writes. A StopFailure with the error `rate_limit` SHALL pause the task: `usage_limit_weekly` when the 7-day window is at 100 % or the reset is more than 24 h away, else `usage_limit`, with `resumes_at` = the reset time when known. For a `usage_limit`, Claude Code continues by itself: AW SHALL write `task.resumed` at the Notification `quota_auto_resume_fired` or at the next prompt or tool event, and SHALL press Enter at `quota_auto_resume_stale`. AW SHALL continue the session itself at `resets_at` + 2 min for a `usage_limit_weekly`, or for a `usage_limit` after `quota_auto_resume_disabled`, with a notice. After 3 continues of AW in one session, the next limit SHALL open the gate "Continue after usage limit" and the pause `continue_cap` (needs the human); its answer SHALL reset the count. AW SHALL send no push for a usage pause.

#### Scenario: 5-hour limit
- **WHEN** the statusline has `five_hour.used_percentage` 100 and `resets_at` in 2 h, and a StopFailure `rate_limit` arrives
- **THEN** the task has the pause `usage_limit` with `resumes_at` at the reset, `needs_human` false, and AW sends no text at the reset

#### Scenario: Weekly limit
- **WHEN** the 7-day window is at 100 % with a reset in 3 days, and a StopFailure `rate_limit` arrives
- **THEN** the pause is `usage_limit_weekly`, and at the reset + 2 min the session gets one notice to continue

#### Scenario: Cap of 3 continues
- **WHEN** AW continued a session 3 times after weekly limits and a 4th limit comes
- **THEN** the gate "Continue after usage limit" opens and the pause is `continue_cap` with `needs_human` true

### Requirement: Agent errors
A StopFailure with another error SHALL pause the task `agent_error` with a retry at 1, 2 and 4 min; at the retry time AW SHALL send a notice to continue. A Stop SHALL reset the count. The 3rd failure in a row SHALL open the gate "Take over terminal" and set `needs_human`.

#### Scenario: Server error
- **WHEN** a StopFailure `server_error` arrives
- **THEN** the task has the pause `agent_error` with `resumes_at` in 1 min, and one notice reaches the session after it

### Requirement: Sign-in state
awd SHALL run `claude auth status --json` at the start and once per hour and SHALL keep only `loggedIn`, `authMethod` and `loginExpiresAt`. When the login ended, each task with a running session SHALL get the pause `login_expired` (needs the human, one push) and AW SHALL start no new session. Less than 3 days before `loginExpiresAt`, each task with a running session SHALL get one comment, and the device SHALL send one push per login end date. A valid login SHALL write `task.resumed` for each `login_expired` pause.

#### Scenario: Login expired
- **WHEN** `claude auth status --json` says `loggedIn: false`
- **THEN** the running tasks have the pause `login_expired` with `needs_human` true, and a newly assigned task gets no claim

### Requirement: Agent queue
Each agent on a device SHALL have a maximum of working sessions (`AW_MAX_WORKING`, default 2). A running session whose task has an open gate or a pause SHALL NOT count. A new session (not a resume) SHALL start only while the count is below the maximum, the login is valid, the 5-hour window is at most 90 % and the disk of `AW_HOME` is below 95 %. The queued tasks SHALL start in the order of the newest `queue.reordered` of the agent, then by creation order.

#### Scenario: Third task waits
- **WHEN** 3 tasks are assigned to `claude@<device>` and 2 sessions work
- **THEN** the third task has no claim until one of the 2 sessions opens a gate or ends

### Requirement: Watchdog
Every 30 s, awd SHALL check each running session with a live pane: the time of the last hook event and a hash of the visible screen. With no open gate and no pause, after 2 min with no hook event and no screen change, it SHALL write `task.progress` "No recent update for 2 min" with the last terminal line, once per quiet period. After 15 min of quiet it SHALL write "Busy for 15 min: <step>" for a pending tool, or open "Take over terminal" for a dialog on the screen that no hook reported. AW SHALL NOT kill a live process. Other devices SHALL add 8 s for the sync delay.

#### Scenario: Quiet session
- **WHEN** a running session has no hook event and no screen change for 2 min
- **THEN** the task has one `task.progress` that starts with "No recent update"

### Requirement: Revoked device
When the own device record is revoked, the session manager SHALL stop each running session and SHALL claim no task. A session record that leaves `running` SHALL lose its `credentials/` folder.

#### Scenario: Revoke while a session runs
- **WHEN** the device record of this device becomes revoked
- **THEN** the session state is `stopped`, its token is revoked, and `credentials/` of the session folder is gone

### Requirement: Wake branch
When a session stops because a person assigned its task to another device, AW SHALL commit the uncommitted changes of the worktree, and when the worktree has commits that no remote has, it SHALL create the branch `aw/<key>-<device>-<HHMM>` and push it to `origin`. It SHALL write a `comment.added` that names the branch, or says that the push failed and the branch is local. With no unpushed work it SHALL write nothing.

#### Scenario: Laptop wakes after a move
- **WHEN** the worktree of a moved task has an uncommitted file and the laptop sees the new assignment
- **THEN** a branch `aw/<key>-<device>-<time>` has the file, and the thread has a comment that names the branch

### Requirement: Device health
Each session manager SHALL write `tasks/devices/<device>/health.yaml` at most once per 60 s with the boot time, the versions, the sessions with their state (`running`, `gate`, `paused`, `ended`), the usage windows and the login end date, the disk use, and the placeholders `sync: []` and `last_backup: null`.

#### Scenario: Health file
- **WHEN** a session runs on the device
- **THEN** `health.yaml` validates against `health.v1` and lists the session with the state `running`
