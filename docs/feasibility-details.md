# Agent Workspace — Feasibility details

| Item | Value |
|---|---|
| Document | Feasibility details: spikes, verdicts, evidence and sources |
| Version | 0.6 |
| Date | 2026-11-22 |
| Readers | System architects, maintainers |
| Summary | [feasibility.md](feasibility.md) (plain-language summary for stakeholders) |
| Decisions | [decisions/2026-11-22-phases.md](decisions/2026-11-22-phases.md), [decisions/2026-11-22-device-sync.md](decisions/2026-11-22-device-sync.md), [decisions/2026-11-22-task-model.md](decisions/2026-11-22-task-model.md), [decisions/2026-11-22-relay-transport.md](decisions/2026-11-22-relay-transport.md) |

## 1. Method
| Round | Scope | Method | Limits |
|---|---|---|---|
| 1 | `architecture.md` v0.1 and `tech-stack.md` v0.1 | 8 reviewers tried to refute each claim with official documentation and small local spikes. | No real agent session. Nothing deployed. |
| 2 | Continuity (C1–C8), Claude terms and limits (T1–T6) | 2 adversarial verifiers. Documentation, help output of Claude Code 2.1.330, types of the Agent SDK 0.3.330, 3 local spikes. | No Claude session. No Linux machine. No LaunchDaemon installed. |
| 3 | Own relay, own storage, push (r1–r6) | 1 verifier. Spike `own-relay`. | One machine. No real phone, Cloudflare edge or R2 bucket. Phase 2 background only (section 12). |
| 4 | Built-in Syncthing on the laptop and the remote device (ST1–ST15) | Hands-on spike `syncthing`: Syncthing v2.1.7, 2 official-binary instances (A "laptop", B "remote") and 1 embedded instance (C "mac-mini-lab"), all configured through REST only. | One Mac (macOS arm64), loopback addresses. No real network, no Linux. |
| 5 | Built-in Syncthing on Android, phone sync pattern, push (AN1–AN22) | Source reading of `researchxxl/syncthing-android` at commit 71fca13 (2026-11-21), its releases and APKs, Android, Play, FCM and UnifiedPush documentation. | No AW build. No real phone. Latency is an estimate. |
| 6 | Real devices (VS1–VS8, VA1–VA7, VM1–VM7, VD1), section 10 | A Mac (local), a Linux x86_64 box that runs 24/7 (remote), an Android 14 emulator on that box (mobile). Syncthing v2.1.7, Claude Code 2.1.330 with an AW plugin, a design review of `workflow.md`. | One home LAN. Emulator only. No push. |

Verdicts:
- **Verified**: the evidence confirms the claim.
- **Partly**: the claim is true with a condition, or for one part only.
- **Unverified**: the evidence does not decide the claim.
- **Refuted**: the evidence contradicts the claim.

All sources were accessed on 2026-11-22. Claude Code documentation pages are under `https://code.claude.com/docs/en/`; this document gives only the page name, for example `hooks#stopfailure`. Spike files are not in the repository. Spike `syncthing` keeps its scripts in `scripts/` and its raw numbers in `results/*.json`.

## 2. Result
| Round | Claims | Verified | Partly | Unverified | Refuted |
|---|---|---|---|---|---|
| 1 | 37 | 7 | 19 | 0 | 11 |
| 2 | 14 | 5 | 7 | 1 | 1 |
| 3 | 6 | 0 | 6 | 0 | 0 |
| 4 | 15 | 12 | 2 | 1 | 0 |
| 5 | 22 | 16 | 4 | 1 | 1 |
| 6 | 23 | 10 | 12 | 1 | 0 |
| Total | 117 | 50 | 50 | 4 | 13 |

Phase 1 is feasible. Each partly true or refuted claim changed the design. Round 6 gave runtime proof with a real Claude session and a real network between 2 devices, and found no reason to change the architecture. It gave 22 design changes (section 10.5). No round tested a real phone, a mobile network or push. Section 13 lists the open risks, and section 14 lists the checks.

## 3. Terms
| Term | Meaning |
|---|---|
| Main device (role local) | A laptop, for example MacBook Pro. The user installs AW there first. AW works with this device only. |
| Remote device (role remote) | An optional device that is often 24/7, for example ubuntu-01 or mac-mini-lab. New tasks run here by default. |
| Phone (role mobile) | For example Pixel 9. A remote control. It runs no agents. |
| Owner device | The device that runs the session of a task. Only this device changes the task state. |
| Workspace folder | The synced folder of one workspace, for example `~/AW/personal/`. It is never inside a code checkout. |
| SyncTransport | The AW interface for sync (`architecture.md` 6.1): `addPeer`, `removePeer`, `addFolder`, `wrote`, `syncNow`, `pause`, `resume`, `status`, `events`. Phase 1 has one implementation, `SyncthingTransport`. |
| Session host | The process that owns the terminal of an agent session: tmux, or direct PTY (`node-pty`) when tmux is not installed. |
| Terminal mode | AW starts the user's own unmodified `claude` CLI in a terminal. The user signs in with the user's own plan. |
| Structured mode | AW drives Claude through the Agent SDK with the user's own API key or cloud-provider credentials. |
| Plan | A Claude subscription: Pro, Max, Ultra (consumer), Team or Enterprise (commercial). |

## 4. Spikes
| Spike | Round | Setup | Result |
|---|---|---|---|
| Daemon | 1 | Node 24.14 and 24.22, Electron 45.4.1 (`ELECTRON_RUN_AS_NODE`), Docker `node:24-slim` | `node:sqlite`: 10k inserts in one transaction in 25–35 ms. `node-pty` 1.1.0: no Linux prebuilds. `node-pty` 1.2.0 beta works on macOS, Linux and Electron. |
| Agent runtime | 1 | `claude --help` (2.1.330), `@anthropic-ai/claude-agent-sdk` 0.3.330 | All planned CLI flags and hook events exist. The SDK ships its own Claude Code binary unless `pathToClaudeCodeExecutable` is set. |
| Orca | 1 | `orca --help` (1.4.268) | `--agent` needs `--surface terminal`. A token in `--command` goes into the shell history. |
| Android crypto | 1 | Tink 1.24.0 (Java) and `@noble` (Node) | XChaCha20-Poly1305 and X25519 interoperate. `javax.crypto` has no XChaCha20. |
| Session host (C4) | 2 | macOS arm64, `node-pty` 1.2.0-beta.18, tmux 3.7c; `kill -9` of the parent | `node-pty` child died 2 s after the parent. tmux on a private socket: pane alive, output continued, `send-keys` worked from a new process. |
| Usage-limit pause (C2) | 2 | Stand-in parser with documented StopFailure input, statusline JSON, terminal texts | StopFailure + statusline gave `{"cause":"usage_limit_five_hour","resumesAt":...}`. Terminal text gave only "resets 3:45pm". |
| Permission hook (C7) | 2 | Stand-in PermissionRequest command hook | An answer after 2 s gave `deny` with a message. No answer within the wait gave `deny` with `interrupt: true`. |
| Syncthing (ST1–ST15) | 4 | Syncthing v2.1.7 on macOS arm64; instances A, B (official binary) and C (`aw-syncd`, embedded `lib/syncthing`); ports 18384–18399 and 22100–22110 | 0 conflicts in 400 writes per device. New file visible in 2.7 s. "Sync now" visible in 1.28 s, complete in 1.55 s. Recovery after pause, restart and `kill -9` with 0 errors. Idle CPU about 0.05 %. |

## 5. Round 1 verdicts that stay in the design
Round 1 also checked the Cloudflare relay, R2 and the central push gateway. Those rows are phase 2 background (section 12). The rows below are phase 1.

| ID | Area | Claim (v0.1) | Verdict | Design change |
|---|---|---|---|---|
| R11 | Model | Slot leases give 0 collisions | Partly | Fencing token, TTL on the owner's monotonic clock, revoke credentials on expiry. The device that has the resource gives the lease. |
| R17 | Knowledge | 3-way merge | Partly | Replaced: the higher-priority version wins, and the other version goes to the history with Undo (device-sync decision rule 6). |
| R19 | Agent | Status through http hooks | Partly | SessionStart accepts only command and `mcp_tool` hooks. All state hooks are command hooks (`aw hook <event>`) that write to a spool file while `awd` is down. |
| R20 | Agent | The adapter runs the user's binary | Refuted for SDK mode | Set `pathToClaudeCodeExecutable`. Never ship the SDK binary packages. |
| R21 | Agent | Structured mode with a subscription | Refuted (T4) | Terminal mode with a plan. Structured mode only with the user's own API key or cloud credentials. |
| R23 | Agent | `aw ask` inside the session | Partly | `aw ask` returns at once. The answer arrives as input to the session (Bash tool timeout 2 min). |
| R24 | Orca | `worktree create --agent` starts Claude | Refuted as written | Two-step flow; `--surface terminal`; launcher script for tokens. Orca as a session host is not verified. |
| R25 | Daemon | Node 24 LTS | Partly | Node 24 ≥ 24.15 (same major as Electron). CI also on Node 26 LTS. |
| R26 | Daemon | No native rebuild per Electron version | Partly | `node-pty` 1.2.0 (beta), `@parcel/watcher` 2.6: N-API prebuilds, signed in the app. |
| R27 | Daemon | Runs as a user service | Partly | Linux: systemd user units with `loginctl enable-linger`. macOS: a LaunchDaemon with `UserName` (C5). |
| R28 | Daemon | Keychain locked after reboot over SSH | Partly | macOS: `@napi-rs/keyring` with a 0600 file fallback. Linux: 0600 file. |
| R29 | Desktop | Electron auto-update and signing | Verified | The Apple Developer Program (99 USD per year) is required. |
| R31 | Push | Push carries only an id | Partly | Push carries an encrypted preview (RFC 8291, ≤3 KB) and always shows a notification (AN16). |
| R33 | Identity | Recovery phrase is optional | Refuted | Master key = recovery phrase, confirmed before the second device. |
| R35 | Android | `javax.crypto` for XChaCha20 and X25519 | Refuted | Tink 1.24 behind an interface. |
| R37 | Android | minSdk 29 / targetSdk 36 | Partly | Target and compile SDK 37 (AN2). Ask for `ACCESS_LOCAL_NETWORK` (AN20). |

## 6. Round 2: continuity

### C1. Resume after a crash or a reboot — Partly
**Evidence** (documentation; VA5 confirms `--resume` with a real session):
- Sessions "are saved continuously to local transcript files" (`~/.claude/projects/<project>/<session-id>.jsonl`). `--resume` also takes the absolute path of a transcript.
- "a tool that was still running when the previous process ended ... doesn't get rerun when you resume". Background Bash and monitor tasks are not restored.
- A plain `--resume` keeps the session id. `--mcp-config`, `--settings`, `--tools`, `--allowedTools` and similar flags are not restored. `bypassPermissions` is not restored.
- Blockers: the "Resume this conversation?" dialog on Pro, Max and Ultra; 2 processes on one transcript lose messages; `cleanupPeriodDays` (default 30) deletes transcripts silently; a usage-limit wait "doesn't restart when you resume".
- **Sources.** `sessions`, `cli-reference`, `settings-reference#cleanupperioddays`, `interactive-mode#wait-for-a-usage-limit-to-reset`; `sdk.d.ts` 0.3.330.

**Design consequence.**
1. AW makes the UUID and starts each session with `--session-id <uuid>`. To recover, the fixed launcher runs `claude --resume <uuid> <stored launch flags> -- "<continue message>"` in the same tmux window and reads the message from a file (VA5).
2. The continue message names the interrupted step, for example "ubuntu-01 restarted while `npm test` ran. Check the result."
3. Before a resume, AW checks that no live process owns the session id (the tracked pids of the pane and its process group, never `pgrep -f`). One writer per transcript.
4. AW detects the resume dialog and selects Resume. On an unknown screen, or after 2 failed resumes and a failed handoff, AW opens the gate "Take over terminal".
5. AW copies each transcript at Stop and SessionEnd, and resumes from the copy after the 30-day sweep. AW never puts a resumed session back in bypass mode silently.

### C2. Usage-limit detection and reset time — Partly
**Evidence.**
- StopFailure "Runs instead of Stop when the turn ends due to an API error", with `error` such as `rate_limit`. It has no reset time.
- Statusline JSON: `rate_limits.five_hour.resets_at` and `rate_limits.seven_day.resets_at` (Unix seconds) and `used_percentage`. Only for Pro, Max and Ultra, and only after the first API response.
- Terminal text: "You've hit your session limit · resets 3:45pm", with no date and no time zone. The built-in wait (v2.1.234+) continues the task after the reset, except in background sessions and `-p` runs, for a reset more than 24 h away, and after 3 automatic continuations. Notification types `quota_auto_resume_fired`, `quota_auto_resume_stale`, `quota_auto_resume_disabled`.
- **Sources.** `hooks#stopfailure`, `hooks#notification`, `statusline#rate-limit-usage`, `interactive-mode#wait-for-a-usage-limit-to-reset`, `errors`, `costs`; spike C2.

**Design consequence.**
1. Each session gets a `statusLine` command through `--settings`. It calls the user's own statusline and sends `rate_limits` to `awd`.
2. StopFailure `rate_limit` plus a window at 100 % sets "Paused: usage limit. Resumes at 15:45." AW sends no push for a pause that resumes alone.
3. For a reset less than 24 h away, Claude Code continues. AW confirms with `quota_auto_resume_fired` and sends Enter on `quota_auto_resume_stale`.
4. For a reset more than 24 h away, AW starts its own timer at `resets_at` + 2 min. After 3 automatic continuations, AW opens the gate "Continue after usage limit" (T2).
5. All sessions on one login share the window. AW starts no queued task on that login while the window is full.

### C3. Headless login — Partly
**Evidence.**
- `claude setup-token` makes a one-year OAuth token and "does not save the token anywhere". It cannot start Remote Control sessions. Login over SSH: the user opens the URL on another device and pastes the code at "Paste code here".
- Storage: Linux `~/.claude/.credentials.json` (0600); macOS Keychain, with a file fallback when the Keychain is locked over SSH.
- "Using Claude Code doesn't extend the login." The duration is not documented. `claude auth status` gives JSON with `authMethod` and `loginExpiresAt` (v2.1.318+). "developers may not collect, store, or intermediate Claude.ai credentials or session tokens".
- **Sources.** `authentication`, `cli-reference`, `troubleshoot-install`, `errors#login-expired`, `legal-and-compliance`.

**Design consequence.**
1. Setup step "Sign in to Claude on ubuntu-01": AW opens `claude auth login` in a terminal on that device. The code is only keystrokes. AW never parses, logs or stores it.
2. AW reads only `claude auth status --json`, once per hour. 3 days before the end date, AW pushes "Sign in again on ubuntu-01 before <date>". After the end, the task shows "Paused: login expired".
3. `setup-token` is an advanced option for a headless Mac mini (decision D7). AW starts `claude` in the user's login shell and never reads the token. Never use `--bare`.

### C4. Sessions survive an `awd` restart — Verified
**Evidence.**
- Spike C4 (section 4): a PTY that `awd` owns dies with `awd`; a tmux session lives on and accepts input from a new process.
- systemd `KillMode` defaults to `control-group`, so a tmux server that `awd.service` forks dies on `systemctl restart awd`. launchd kills the process group unless `AbandonProcessGroup` is set. Round 6 confirmed it with a real session (VA6).
- Claude Code background sessions are a research preview: "Service install is disabled in this version", no usage-limit wait, and a machine restart stops them.
- **Sources.** Spike C4; `systemd.kill`; `man launchd.plist` (Darwin 25.6.0); `agent-view`; `env-vars`.

**Design consequence.**
1. The default session host is tmux on a private socket (`tmux -L aw`), one window per session (`aw-<task-id>`), outside the cgroup of `awd` (`aw-sessions.service`). On macOS, `AbandonProcessGroup=true`.
2. `awd` reads agent output from hooks (Stop `last_assistant_message`) and the transcript. `capture-pane` is only a second check for an open dialog (VA7). Sessions get `CLAUDE_CODE_NONBLOCKING_STDOUT=1`.
3. At start, `awd` matches tmux windows to sessions by pane pid and resumes only sessions with no live process.
4. Direct PTY is a fallback only; there each `awd` restart uses the resume path of C1. Background sessions (`--bg`) are a later session-host option.

### C5. Start at boot without a user login — Partly
**Evidence** (documentation only):
- `loginctl enable-linger` starts a user manager at boot for a user who is not logged in. A LaunchAgent starts only at a GUI login; a LaunchDaemon with `UserName` runs in the system domain.
- FileVault mounts the home folder only after a login. On Apple silicon with macOS 26+, FileVault can be unlocked over SSH after a restart. Background processes on macOS cannot read Desktop, Documents or Downloads without a TCC grant.
- **Sources.** `loginctl`, `systemd.kill`; `man launchd.plist`; Apple TN2083; Apple Platform Security; `authentication#credential-management`.

**Design consequence.**
1. Linux: systemd user units `awd.service` and `aw-sessions.service` with `Restart=always`, plus `sudo loginctl enable-linger <user>` once.
2. macOS: `/Library/LaunchDaemons/<id>.plist` with `UserName`, `RunAtLoad`, `KeepAlive` and `AbandonProcessGroup`. Admin rights once.
3. `aw doctor` runs `claude auth status --json` in the daemon context. The macOS checklist covers sleep, restart after power failure, FileVault and checkouts outside Desktop, Documents and Downloads.

### C6. Auto-compaction — Verified
**Evidence.** "Claude Code compacts automatically as you approach the limit". PostCompact fires after auto-compact with `trigger` and `compact_summary`. CLAUDE.md and SessionStart hooks that match `compact` are re-injected. Failure texts: "automatic compaction failed" and "Context limit reached". **Sources.** `context-window`, `hooks#postcompact`, `errors#prompt-is-too-long`, `sessions`.

**Design consequence.** AW gives the task context through a SessionStart command hook that matches `startup`, `resume` and `compact`. On PostCompact, AW writes "Context compacted at 14:20" in the task thread. On a compaction failure, AW starts a new session with a handoff. `aw doctor` warns when auto-compact is off.

### C7. Permission questions answered remotely — Partly
**Evidence.**
- PermissionRequest returns `allow` or `deny` with `updatedInput`, `message` and `interrupt`. AskUserQuestion needs `updatedInput` with `allow`.
- The default timeout is 600 s for command hooks. No documented maximum. On timeout, the normal terminal prompt appears. The Notification `permission_prompt` fires after about 6 s, also for sandbox network requests.
- `defer` works only in `-p` mode with a single tool call: refuted for terminal mode. `permissions.denyInsteadOfPrompting` (v2.1.319+) denies a call that would wait on a prompt.
- Round 6: allow and deny from another device worked in a real session; a deny reached the model only as a tool error (VA4).
- **Sources.** `hooks#permissionrequest`, `hooks#defer-a-tool-call-for-later`, `settings-reference#permissions-denyinsteadofprompting`, `agent-view`; spike C7.

**Design consequence.**
1. The hook is a command hook (`aw hook permission`). It waits 120 s, then denies with `interrupt`; the agent waits at the open gate. Each request has a unique id (VA4). The hook survives an `awd` restart.
2. AW rules answer first. Only unmatched calls become an "Approve command" gate with the command, the folder and the effect. AskUserQuestion becomes the "Answer question" gate.
3. AW passes `denyInsteadOfPrompting=true`. Not verified: the hook runs before the deny. If not, AW turns it off and uses the timeout and `permission_prompt` as the safety net.
4. A late "Allow" becomes a one-time approval for that exact request id, delivered as the next input; a deny also goes to the agent as the human's next input. A session that waits at a gate does not count toward the parallel-session maximum.

### C8. Parallel sessions on one login — Verified
**Evidence.** "running ten agents in parallel uses quota roughly ten times as fast". Parallel sessions "share a saved login and coordinate its renewal". The refresh error "another Claude Code process is refreshing it" is transient. No documented maximum of parallel sessions. **Sources.** `agent-view#limitations`, `troubleshoot-install`, `errors`, `costs`.

**Design consequence.** Default 2 working sessions per agent. Count the usage per login; above 90 % of the 5-hour window, start no new queued task. One process and one checkout per session. Retry the refresh error after 60 s with no pause. One Inbox item per login at a usage-limit pause.

## 7. Round 2: Claude terms and limits

### T1. The user's own Claude Code — Verified
**Evidence.** Anthropic does not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". "The Claude Code binary must not be modified", and no authentication method may be removed. Developers may not "offer Claude.ai login into their own applications" or "collect, store, or intermediate Claude.ai credentials". On remote machines, start `claude` "inside tmux or screen". **Sources.** `legal-and-compliance`; support article 13189465; `remote-control`.

**Design consequence.** The user installs `claude` with Anthropic's installer and signs in through Anthropic's flow. AW never bundles or patches the binary and never reads credentials. AW reads only `claude auth status`, the statusline JSON and hook events. Naming: "AW agent, powered by Claude".

### T2. Automatic sessions on a consumer plan — Unverified
**Evidence.**
- Consumer Terms section 3 forbids access "through automated or non-human means" except with an API key "or where we otherwise explicitly permit it".
- Anthropic's own unattended features on a plan: auto-continue after a limit, background sessions ("background job · unattended"), `setup-token` for scripts, the GitHub Action on a subscription.
- For third-party tools, API key authentication is "preferred". Plan limits "assume ordinary, individual usage".
- Support 15036540 (2026-06-15): SDK, `claude -p` and third-party app usage "still draw from your subscription limits".

**Reading.** Not clearly forbidden: Claude Code makes the requests for the subscriber's own work. Not clearly allowed: no page names an outside orchestrator. Likely tolerated at personal scale; the risk grows with volume. **Sources.** Consumer Terms; `interactive-mode`; `agent-view`; `iam`; `github-actions`; support articles 13189465 and 15036540.

**Design consequence** (decision D5). On a plan, AW runs interactive `claude` in tmux, never `-p` or the SDK. Claude Code's auto-continue stays on. AW sends its own "continue" only after a device restart or for a reset more than 24 h away, at most 3 times per session, then opens a gate. Queued tasks start only from a human action or a rule of the plan owner.

### T3. Plan limits and 24/7 work — Partly
**Evidence.** Pro $20/month: "More usage than Free, every 5 hours and every week". Max $100/month: "For all-day work", "5x Pro usage every 5 hours and every week". Ultra (formerly "Max 20x") $200/month: "No 5-hour limit for verified accounts", "10x Pro usage every week". Limits are shared across Claude and Claude Code. "there's no fixed message count". Anthropic may add other caps "at our discretion". On 2026-05-06 Anthropic doubled the five-hour limits. One agent 24/7 is 168 h per week; Max is sold for the all-day work of one person. **Sources.** `https://claude.com/pricing`; support articles 17728952, 11049741, 11647753, 11145838; `statusline`.

**Design consequence.** Never write "Max 20x" as a current plan. Device health shows "Plan: 5-hour 62 % · resets 15:45; week 41 % · resets Mon 09:00" and a projection. A weekly pause offers Wait, usage credits, or an API key.

### T4. The API key path — Verified
**Evidence.** Prices per million tokens (input / cache write 5 min / cache hit / output): Opus 5.5 $4 / $5 / $0.20 / $20; Sonnet 5.5 $2 / $2.50 / $0.10 / $10; Fable 5.2 $8 / $10 / $0.20 / $40; Haiku 5.5 (prompts up to 100k) $0.10 / $0.125 / $0.01 / $0.50. Anthropic benchmark: "around $13 per developer per active day". The verifier made an estimate, not an Anthropic figure. It assumes 90 requests per hour and 100k cached context. One busy Sonnet 5.5 session costs about $1,170 per month at 50 % busy and $2,300 at 24/7. Opus 5.5 costs about $2,300 and $4,700. Products that use the Agent SDK "should use API key authentication". Max, Ultra and Team include monthly API credits ($100, $200, pooled up to $500) for `claude -p` and the SDK, not for interactive Claude Code. **Sources.** `https://platform.claude.com/docs/en/about-claude/pricing`; `costs`; `agent-sdk/overview`; `legal-and-compliance`; support article 17154008.

**Design consequence.** Structured mode uses only the user's own key, never a shipped or pooled key. AW shows the cost per task and per agent and supports `--max-budget-usd`.

### T5. Team and Enterprise — Partly
**Evidence.** The Commercial Terms contain no automated-access clause. Team seats have 5-hour and weekly windows shared with Claude chat; a Premium seat is about Max level. Under `forceLoginOrgUUID`, API-key sessions are "blocked at startup". **Sources.** Commercial Terms; `costs`; `https://claude.com/pricing`; support articles 11845131 and 17154008; `iam`.

**Design consequence.** T2 risk is lower on Team. 24/7 work still does not fit a seat. Shared 24/7 agents use a workspace API key (phase 2, with People). AW explains admin rules and does not fail silently.

### T6. A session for another person on my plan — Refuted
**Evidence.** "You may not share your Account login information ... with anyone else." Developers may not "route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users". An API key in an organization is allowed for its authorized users. The line is who drives the session. **Sources.** Consumer Terms; support articles 13189465 and 17154008; `legal-and-compliance`; `github-actions`.

**Design consequence** (phase 2, decision D8). Each agent has a credential owner. On a plan agent, only the plan owner starts sessions, sends input and answers gates. Other People create tasks and comment.

## 8. Round 4: built-in Syncthing on the laptop and the remote device
| ID | Claim | Verdict |
|---|---|---|
| ST1 | The latest stable official binary can be downloaded and checked against the release checksum | Verified |
| ST2 | `awd` can configure Syncthing only through REST, with no restart | Verified |
| ST3 | With the default config, Syncthing opens listeners and contacts public servers before REST can turn them off | Verified |
| ST4 | With per-device file ownership, concurrent writes give no conflicts and equal content | Verified |
| ST5 | Same-file edits on 2 devices give a conflict copy, with risky details for AW | Verified |
| ST6 | Latency depends on `fsWatcherDelayS` and on how often a file changes | Verified |
| ST7 | "Sync now" with `POST /rest/db/scan` works; a scan after every small append makes things worse | Verified |
| ST8 | Completion numbers can show 100 % when nothing is synced | Verified |
| ST9 | `/rest/events` gives the event types for a sync status UI | Verified |
| ST10 | Sync continues after pause, resume, restart and `kill -9` | Verified |
| ST11 | The footprint on a laptop is small | Verified |
| ST12 | `lib/syncthing` can be embedded in a small Go program (`aw-syncd`) | Partly |
| ST13 | Changes pass on through a connected device; with the laptop asleep, other devices need direct links | Verified |
| ST14 | AW (MIT) can ship Syncthing (MPL-2.0) | Partly |
| ST15 | The notarized binary can be nested in the notarized Electron app without signing it again | Unverified |

### ST1, ST14, ST15. Packaging and license
**Evidence.**
- Release v2.1.7 (2026-10-21, not a prerelease). `syncthing-macos-arm64-v2.1.7.zip` is 13.4 MB; its sha256 matches `sha256sum.txt.asc`. The binary is 35.7 MB, built with go1.27.3. The PGP signature was not checked.
- `codesign`: "Developer ID Application: Kastelo AB", hardened runtime. `spctl`: "accepted, source=Notarized Developer ID". Nesting inside an Electron app signed by another team was not tested.
- MPL-2.0 section 3.2: a distributor of the executable must make the source available. Section 3.3: a Larger Work keeps its own license. Section 2.3: no trademark rights. Forum posts ask that products not use the name or logo without asking.
- **Sources.** `https://github.com/syncthing/syncthing/releases/tag/v2.1.7`; `https://www.mozilla.org/en-US/MPL/2.0/` and its FAQ; `https://forum.syncthing.net/t/using-syncthing-logo/21626`; spike `syncthing/dl/`.

**Design consequence.**
1. The build pins the version, checks the sha256 (and the PGP signature in CI), and ships one binary per OS and architecture.
2. The installer ships `THIRD_PARTY_NOTICES` with the MPL text, `AUTHORS.txt` and a link to the v2.1.7 source. The UI says "Sync by Syncthing" as plain text, with no logo.
3. Packaging check: put the binary in `Contents/Resources`, notarize, run on a clean Mac. Fallback: AW signs the unchanged binary with its own Developer ID.

### ST2, ST3. Control and a safe first start
**Evidence.**
- `scripts/setup.py` configures everything with REST: `PATCH /rest/config/options`, `PUT /rest/config/devices/<id>`, `PUT /rest/config/folders/aw-ws`, `POST /rest/db/ignores`. `/rest/config/restart-required` stayed `false`. A folder PATCH restarts the folder. `.stignore` is not synced, so each device needs its own ignores.
- First start with the default config: TCP and QUIC on `[::]:22000`, the relay pool, 3 global discovery servers, local discovery. Defaults: `urAccepted 0`, `crashReportingEnabled true`, device name = OS hostname. REST was up 0.05–0.12 s after start. On real devices, the default first start used public discovery and opened router port mappings for 33 s before REST turned them off (VS2).
- `syncthing generate --no-port-probing`, one config edit, then `serve`: only 127.0.0.1 listeners and no relay or discovery lines in the log.
- **Sources.** Spike `syncthing/scripts/setup.py`, `scripts/st.py`, `run/A/syncthing.log`, `probe2/p2.log`.

**Design consequence.**
1. First start: `syncthing generate --home <aw>/sync --no-port-probing`. Write `config.xml` from a template: listen address, announce off, relays off, NAT off, `urAccepted -1`, crash reports off, `autoUpgradeIntervalH 0`, a device name from AW, a random API key, GUI on 127.0.0.1 or a short Unix-socket path. Then `serve --no-browser --no-upgrade --no-restart`.
2. After the first start, all changes go through REST. Avoid frequent folder-config changes.
3. `awd` sets the ignore `*.aw-tmp` through REST on each device. The index is in `~/.aw/index/`, outside the synced folder.
4. The setting "Use community discovery and relay servers" maps to `globalAnnounceEnabled` and `relaysEnabled` (decision D18).

### ST4, ST5. Ownership and conflicts
**Evidence.**
- `test_a`: 2 rounds; A and B ran at the same time with 200 operations each (70 % JSONL appends to `tasks/AW-n/log/<device>.jsonl`, 30 % rewrites of the `task.yaml` that the device owns). 0 conflict files. Equal sha256 of every file. Convergence 4.88 s and 5.32 s after the last write. No temp files left.
- `test_b`, same file edited on both sides: the newer content stays, and the other goes to `task.sync-conflict-<date>-<time>-<short id>.yaml`. Round 6 showed that the short id is the WINNER's id: the copy holds the content of the other device (VS4).
- A JSONL file appended on both sides: line A1 is only in the conflict copy. A reader of the main file loses it. Delete against modify: after A deleted `tasks/AW-96/` while B appended, both sides had `tasks/AW-96/log/ubuntu-01.jsonl` again, without `task.yaml`.
- **Sources.** Spike `syncthing/scripts/test_a.py`, `scripts/test_b.py`, `results/test_a.json`, `results/test_b.json`.

**Design consequence.**
1. Keep the ownership rules and the layout of the device-sync decision. Write YAML with temp + rename, with a temp name that matches `*.aw-tmp`.
2. The indexer never ignores a `*.sync-conflict-*` file. The highest-priority online device resolves it at once and records the result in its own log. It finds the author with a sha256 journal of its own writes; the name gives only the winner. Keep `maxConflicts` at 10 or more: 0 deletes the losing edit silently (VS4).
3. Never delete task folders. Use an `archived` field. The index accepts orphan log files.
4. The local SQLite index is rebuilt from the files, not from Syncthing completion values.

### ST6, ST7. Latency and "Sync now"
**Evidence** (2 instances on one Mac, loopback; p50 / p95):
- New file: 2.70 / 2.71 s with `fsWatcherDelayS=1` (n=20 per direction); 9.70 / 10.41 s with the default 10 (n=10).
- Hot file (append every 250 ms for 15 s), no scan: 4.26 / 7.59 s with delay 1; 23.5 / 30.2 s with the default.
- Hot file with a targeted scan after each append: 8.69 / 15.38 s. Writes batched every 1 s plus a targeted scan: 1.54 / 2.04 s.
- Full scan: visible on B in 1.28 / 1.29 s, completion 100 % in 1.56 / 1.57 s (n=20). The file was visible before 100 % in 20 of 20 runs. No pull errors. **Sources.** Spike `syncthing/scripts/test_c.py`, `scripts/test_d.py`, `results/test_c_delay1.json`, `results/test_c_default.json`, `results/test_d.json`, `results/test_hot.jsonl`.

**Design consequence.**
1. Set `fsWatcherDelayS=1` on the workspace folder.
2. The log writer buffers and writes each file at most once per second, then calls `POST /rest/db/scan?folder=<id>&sub=<path>`. A gate or a state change is written and scanned at once.
3. "Sync now" and "sync before sleep" = a full scan first, then the per-device check of ST8, with a timeout. The result is "Synced 2 s ago" or "3 changes not synced". "No recent update" allows 8 s or more for sync (VS6).
4. Live terminal output never goes through Syncthing. In phase 1, the live terminal works only on the same LAN or Tailscale (spike S9). From other networks, the phone shows the last snapshot.

### ST8, ST9. Sync status
**Evidence.**
- B stopped, A wrote 1 change: completion for B = 99.99778 %, `needItems` 1, `remoteState` "unknown", not connected. Completion with no device while all peers were offline: 100, `needItems` 0.
- In `test_a`, the trees were already equal while completion said 52.6 % and 47.4 %.
- Event counts on B: StateChanged 1494, ItemStarted 3014, FolderCompletion 310, FolderErrors 2. Event ids restart from 1 after a restart. `LocalChangeDetected` and `RemoteChangeDetected` come only from `/rest/events/disk` (documentation).
- **Sources.** Spike `syncthing/run/A/events.jsonl`, `scripts/events.py`; `https://docs.syncthing.net/dev/events.html`.

**Design consequence.**
1. The status shows per device: connected or offline, `needItems` and `needBytes`, and "synced" only when `remoteState=="valid"` and `needItems==0`. Never show the aggregate completion. 99.998 % never displays as 100 %.
2. The status feed uses StateChanged, FolderSummary, FolderCompletion, Device* and FolderErrors events. Item* events are too many for the UI. The reader resets `since` after a restart and reads the full status after a gap.

### ST10, ST11. Recovery and footprint
**Evidence.**
- Device pause: 0 of 100 files reached B; after resume, all equal in 2.50 s. Folder pause: equal 0.31 s after resume. SIGTERM, 100 writes, start: equal in 2.49 s. `kill -9` of B after 305 of 2,001 files (2,000 × 4 KB plus 64 MiB): equal 11.55 s after restart, 0 errors, no temp files left.
- `POST /rest/system/restart` with `--no-restart`: the process exits and does not come back. The official binary runs as 2 processes (monitor and worker). RSS: 20 MB + 42 MB at start; worker 62–96 MB after 2,415 files. `STMONITORED=1` (a hidden flag): 1 process of 37 MB. Idle CPU about 0.05 %. Index 3.4–10 MB.
- **Sources.** Spike `syncthing/scripts/test_e.py`, `results/test_e.json`; `src/syncthing/cmd/syncthing/main.go`.

**Design consequence.** The supervisor in `awd` owns both Syncthing processes (monitor and worker): start, health check with `/rest/system/ping`, restart with backoff, stop before an AW update. Pause and resume map to "Pause sync" and the sleep hooks. `STMONITORED=1` is optional and needs a test per version. Presence uses AW heartbeat events, not the connection state (VS7).

### ST12. Embedding (`aw-syncd`) — Partly
**Evidence.** It built with go1.26.6 in 29 s; `-tags noassets,noupgrade -trimpath -s -w` gave 28.0 MB. As node C, it ran as 1 process (35–60 MB, 2 sockets on 127.0.0.1) and synced all 2,416 files with A and B. It has 5 problems. `go get ...@v2.1.7` fails, because the module path has no `/v2`. Only the pseudo-version `v1.30.0-rc.1.0.20261020195438-d6d0181f7d46` works. 2 `replace` directives must be copied. `cfg.Modify` blocks until `cfg.Serve` runs. The version shows "unknown-dev" without ldflags. The source says that the API is "not intended as a stable API at this time". **Sources.** Spike `syncthing/aw-syncd/main.go`; `lib/syncthing/internals.go`, `lib/syncthing/syncthing.go`; `https://github.com/syncthing/syncthing/commits/main/lib/syncthing`.

**Design consequence.** Keep `aw-syncd` as a tested fallback behind `SyncTransport`, not as the phase 1 default. If used: pin a commit, copy the replace directives, set the version ldflags, keep REST as the control API, and build against each new Syncthing tag in CI.

### ST13. Full mesh — Verified
**Evidence.** C was connected only to A. A change written on C reached B in 2.57 s through A. **Sources.** Spike `syncthing/run/C/aw-syncd.log`.

**Design consequence.** Pairing adds every device to every other device and shares the workspace folder with all of them. Then the remote device and the phone sync while the laptop sleeps.

## 9. Round 5: built-in Syncthing on Android
| ID | Claim | Verdict |
|---|---|---|
| AN1 | The fork builds Syncthing as a native executable `libsyncthingnative.so` in `jniLibs`, not with gomobile | Verified |
| AN2 | The fork pins Go 1.27.4, NDK 30.0.16248370, target SDK 37, min SDK 23 and Syncthing commit d6d0181 (v2.1.7 line) | Verified |
| AN3 | The arm64 APK is about 19 MB; the engine is 35.2 MB extracted | Verified |
| AN4 | The app starts the engine as a child process and controls it through REST with an API key | Verified |
| AN5 | The REST listener can use a Unix socket | Partly |
| AN6 | The fork keeps a `specialUse` foreground service on all the time | Verified |
| AN7 | The fork has run conditions (Wi-Fi, SSID, charging, power save, time schedule) | Verified |
| AN8 | The fork is not on Google Play; the official app stopped partly because of Play | Verified |
| AN9 | The fork and the engine are MPL-2.0, and the fork is active | Verified |
| AN10 | Option 1: bundle the engine and control it through REST, with low effort and enough control | Verified |
| AN11 | Option 2: gomobile-bind `lib/syncthing` works, on an unsupported API | Verified |
| AN12 | Option 3: a maintained non-Go BEP implementation exists for Kotlin/JVM | Refuted |
| AN13 | Option 4: iroh has Kotlin and Node bindings for the core, not for iroh-blobs or iroh-docs | Verified |
| AN14 | Doze delays network and WorkManager; periodic work runs at most every 15 min | Verified |
| AN15 | FCM accepts Web Push with VAPID through the UnifiedPush embedded FCM distributor | Partly |
| AN16 | A high-priority FCM message can start a foreground service, but FCM lowers the priority if no notification shows | Partly |
| AN17 | On Android 15+, `dataSync` services have 6 h per 24 h and cannot start from `BOOT_COMPLETED` | Verified |
| AN18 | A phone gate answer reaches the owner device in about 5–30 s when both are online | Unverified |
| AN19 | Play reviews each foreground service type and recommends user-initiated data transfer jobs | Verified |
| AN20 | Target API 37 needs the `ACCESS_LOCAL_NETWORK` runtime permission for LAN traffic | Verified |
| AN21 | Community relays see the IP address, the device id and the traffic volume, not the content | Verified |
| AN22 | A bundled executable runs with target SDK 37; Play acceptance is not proven | Partly |

### AN1–AN4, AN22. Build and control
**Evidence.**
- `build-syncthing.py` runs `go run build.go -goos android -goarch <arch> -cc <ndk clang> -no-upgrade build` with `CGO_ENABLED=1`, `EXTRA_LDFLAGS=-checklinkname=0` and `SOURCE_DATE_EPOCH=0`. It moves the binary to `jniLibs/<abi>/libsyncthingnative.so`. `useLegacyPackaging = true` extracts it on install so the app can run it.
- `libs.versions.toml`: Go 1.27.4, NDK 30.0.16248370, target SDK 37, min SDK 23. The submodule is at d6d0181. The last commit (2026-11-21) bumps Go. Release v2.1.7.1-rc.3: arm64 APK 19,011,825 bytes, universal APK 61,999,838 bytes, arm64 engine 35,194,928 bytes.
- `SyncthingRunnable.java`: `ProcessBuilder` with `serve --no-browser`, `STHOMEDIR`, `STNOUPGRADE=1`, `STMONITORED=1`. `RestApi.java`: `https://127.0.0.1:8384`, `/rest/config`, `/rest/db/completion`, `/rest/events`. The REST docs say "The interface is subject to change." The fork is not on Play, so there is no proof that Play accepts a bundled executable. Play forbids downloaded code; this code is bundled.
- **Sources.** `https://github.com/researchxxl/syncthing-android/blob/71fca13/` (`syncthing/build-syncthing.py`, `app/build.gradle.kts`, `gradle/libs.versions.toml`, `SyncthingRunnable.java`, `RestApi.java`); `https://github.com/researchxxl/syncthing-android/releases/tag/v2.1.7.1-rc.3`; `https://docs.syncthing.net/dev/rest.html`.

**Design consequence.**
1. AW CI builds the official Syncthing source at the same pinned tag as the desktop, with the fork's recipe. Output: `libawsync.so` for arm64-v8a and x86_64 (emulator) in an App Bundle. Go, NDK and Syncthing versions live in one version file.
2. AW writes its own Kotlin REST client. It copies no Java code of the fork, so no MPL files enter the AW app code.
3. The Kotlin client and the TypeScript client in `awd` implement the same REST contract. Contract tests run per pinned Syncthing version.

### AN5. Unix socket — Partly
**Evidence.** The Syncthing docs say: "Unix sockets are supported by specifying an absolute path". The fork uses TCP 127.0.0.1:8384. No Android test was found. **Sources.** `https://docs.syncthing.net/users/guilisten.html`.

**Design consequence.** Put the REST listener on a socket in the app files folder, so other apps cannot reach it. Fallback: 127.0.0.1 on a random port with HTTPS and a random API key. Spike S3 (section 14).

### AN6, AN7, AN14, AN17, AN19, AN20. Run pattern on the phone
**Evidence.**
- The fork: `SyncthingService` with `foregroundServiceType="specialUse"`, always `startForeground`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, a boot receiver, and location permissions for SSID rules.
- Doze "Suspends network access" and WorkManager tasks until a maintenance window. "The minimum repeat interval ... is 15 minutes." Play allows a battery exemption only when the core function breaks. Android 15+: `dataSync` has "a total of 6 hours in a 24-hour period"; the timer resets when the user opens the app; `onTimeout()` gives a few seconds to stop; no start from `BOOT_COMPLETED`.
- Play needs a description, the user impact and a video per foreground service type. For user-requested transfers, it recommends a user-initiated data transfer job. Target API 37: local network protection is "mandatory and enforced". Without the permission, TCP times out and UDP gets `EPERM`.
- **Sources.** Fork `AndroidManifest.xml`, `RunConditionMonitor.java`; `https://developer.android.com/develop/background-work/services/fgs/timeout`, `.../fgs/service-types`, `.../background-tasks/uidt`; `https://developer.android.com/training/monitoring-device-state/doze-standby`; `https://support.google.com/googleplay/android-developer/answer/13392821`; `https://developer.android.com/privacy-and-security/local-network-permission`.

**Design consequence** (updated with VM4, VM6; design change 21).
1. One `specialUse` foreground service with a permanent, low-priority notification runs the engine while the phone has a paired workspace. No battery exemption, no location permission.
2. Each app open restarts the engine and sets the reconnect interval to 5 s. The app warns when the battery mode is "Restricted", because sync then stops until a force-stop (VM4).
3. Why one always-on service, not the short `dataSync` sync periods of the round 5 research: with the service, a file arrived in 3.1 s in deep Doze (VM4). A period after a push depends on push, which is not verified (S1, VM7). Only the phone dials, so a cold period adds a connection wait to each answer (VM6). Android 15+ limits `dataSync` to 6 h per 24 h (AN17), so the service type is `specialUse`.
4. Risks: the Play review of `specialUse` (AN19, spike S4) and the battery use on a real phone (VM5, spike S10 in `phase-1.md` 13). Fallback after S4 or S10: `dataSync` periods of at most 5 min after a push, an answer or "Sync now", with "Sync now" as a user-initiated data transfer job.
5. The Play declaration has a short video: the permanent notification, a gate push, the answer arrives.
6. The pairing flow asks for `ACCESS_LOCAL_NETWORK` and explains it. Without it, sync uses Tailscale or the internet path.

### AN8, AN9. Distribution and license
**Evidence.** The fork ships on GitHub, F-Droid and Obtainium. The official README: "Google making Play publishing something between hard and impossible and no active maintenance"; archived 2024-12. The fork declares `MANAGE_EXTERNAL_STORAGE`, which Play restricts. License MPL-2.0; 3,395 stars, 8 open issues, 15 commits from 2026-11-03 to 2026-11-21. **Sources.** `https://github.com/researchxxl/syncthing-android`; `https://github.com/syncthing/syncthing-android`; `https://forum.syncthing.net/t/discontinuing-syncthing-android/23002`; `https://support.google.com/googleplay/android-developer/answer/10467955`.

**Design consequence.** AW keeps all synced data in app-private storage, one folder per workspace, and declares no `MANAGE_EXTERNAL_STORAGE`. AW ships the Syncthing notice and a source link. Plan a Play internal-testing review early (spike S4).

### AN10–AN13. Options for the phone engine
**Evidence.**
- Option 1 (bundle + REST): shipped by the fork for years; REST covers config, ignores, scan, pause, completion and events. Estimate: 1–2 weeks. Option 2 (gomobile): `lib/syncthing` exports `New`, `Start`, `Stop`, `Wait`; a maintainer: "lib had never been intended or supported for public consumption"; Sushitrain (iOS) does this at the same commit.
- Option 3: `syncthing-lite` archived 2020; `syncthing-java` exists "for historic reasons". Option 4: iroh-ffi v1.2.0 (Maven `computer.iroh:iroh`, npm `@number0/iroh`) covers the 1.0 core only; iroh-blobs, iroh-docs and iroh-gossip "are out of scope".
- **Sources.** `https://github.com/syncthing/syncthing/blob/v2.1.7/lib/syncthing/syncthing.go`; `https://forum.syncthing.net/t/go-module-path-for-syncthing-lib-remains-at-v1-unable-to-import-v2/25532`; `https://github.com/pixelspark/sushitrain`; `https://github.com/syncthing/syncthing-lite`; `https://github.com/n0-computer/iroh-ffi`; `https://github.com/n0-computer/iroh-blobs`.

**Design consequence.** Phase 1 uses option 1. Option 2 is plan B behind `SyncTransport`, if Android blocks bundled executables, or for iOS. Option 3 is removed. Option 4 is a phase 2 candidate: each device writes only its own append-only files, so an AW protocol "send the bytes after offset N, plus blobs by hash" over iroh streams is small. It can replace Syncthing on the phone through the same interface.

### AN15, AN16. Push
**Evidence.**
- UnifiedPush: "Google FCM servers can handle webpush requests out of the box, but they require a VAPID authorization." Artifact `org.unifiedpush.android:embedded-fcm-distributor` 2.5.0. It uses Google's FCM library, so it is not allowed on F-Droid. The FCM docs do not describe the Web Push endpoint.
- A high-priority FCM message is an exemption for a foreground-service start. Messages without a visible notification "may be deprioritized". FCM v2 (EAP) runs no app code unless `mutable_content` is set.
- **Sources.** `https://unifiedpush.org/kdoc/embedded_fcm_distributor/`; `https://unifiedpush.org/news/20250131_push_for_decentralized/`; `https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start`; `https://firebase.google.com/docs/cloud-messaging/android/message-priority`; `https://firebase.google.com/docs/cloud-messaging/send/v2-api`.

**Design consequence.**
1. Push is required in phase 1. The owner device of the gate sends Web Push (RFC 8030, 8291, 8292) with its own VAPID key to the endpoint of the embedded FCM distributor. No AW server. Fallback: the person's own ntfy server (task-model decision §5.4). Spike S1 must pass before the phone release.
2. Each gate push carries an encrypted preview and always posts a notification. On receipt, the app starts the foreground service when it does not run. A tap on the notification opens the gate card.

### AN18, AN21. Latency and community relays
**Evidence.**
- Latency is an estimate: the phone appends the answer to its own log, the engine starts, Syncthing finds the peer (LAN, global discovery or a relay), the index exchange runs, a small file transfers. There is no store-and-forward in phase 1. Round 6 measured 2.3 s p50 (1.3 s with a scan) between the emulator and the remote on one LAN (VM3); a real phone and network are not measured.
- Syncthing docs: "The connection between two devices is still end to end encrypted." A relay learns the IP and device id, and "can see the amount of traffic flowing between devices". Relaying is on by default.
- **Sources.** `https://docs.syncthing.net/users/relaying.html`.

**Design consequence.** The UI shows "Answer sent, waiting for MacBook Pro" until the owner device writes "resolved". Settings say plainly what the community servers see, with one switch "LAN and Tailscale only". R2 in phase 2 removes the wait. AW's own iroh relay can replace the community relays in phase 2.

## 10. Verification on real devices (2026-11-22)
Setup:
- Local: a MacBook (macOS arm64). Remote: the remote test box (Linux x86_64, 24/7) on the same home LAN; Tailscale used a direct path. Mobile: an Android 14 emulator (Google APIs x86_64 image, no Play Store) on the remote test box.
- Syncthing v2.1.7 official binaries, configured through REST only. The clock offset between the devices (0.16 s ± 0.007 s) is removed from every latency number.
- Claude Code 2.1.330 in tmux on the remote test box, with an AW test plugin (hooks, the `aw` skill, the `aw` CLI) and an `awd` stand-in. The answers of the Mac and the phone were written as their log lines, so the agent timings do not include sync.
- The phone engine was the test APK of the maintained fork, because AW has no Android build yet.

### 10.1 Sync between the Mac and the remote test box
| ID | Check | Verdict | Evidence | Design change |
|---|---|---|---|---|
| VS1 | Pairing through REST only | Partly | Pending device seen in 0.19 s, connected in 0.29 s (TLS 1.3), folder shared and idle in 2.6 s, `requiresRestart` false. Re-pairing with the default reconnect interval (60 s) took up to 56 s; with 5 s, at most 5.1 s (n=3). | 16 |
| VS2 | Safe first start | Verified | Default config: public discovery and UPnP/NAT-PMP port mappings for 33 s before REST turned them off. `config.xml` written before the first `serve`: 0 discovery, relay, NAT or announce log lines in 47 s; only the sync listener and the GUI on 127.0.0.1. | 11 |
| VS3 | Per-device logs, 2 × 300 appends to 20 tasks | Verified | 600 of 600 lines, 0 bad JSON lines, 0 conflict copies, 40 equal files, 0 pull errors. Converged 3.36 s after the last append (an append every 20 ms) and 2.08 s (every 200 ms). | — |
| VS4 | Same `task.yaml` changed on both devices | Partly | The conflict copy name carried the WINNER's short id in 4 of 4 runs; this refutes the reading of ST5. A resolver that read the name as the loser kept the wrong version. A resolver with a sha256 journal of its own writes kept the local version in 2 of 2 runs (converged in 1.58 s and 1.88 s, no file left). `maxConflicts=0`: no copy, and the local edit was gone. | 12 |
| VS5 | "Sync now" | Verified | Scan call 0.01–0.07 s. Total 1.60–1.70 s for 1 file (n=5) and 3.63–3.85 s for 200 files (n=3); at 100 % the remote had every file. Without a scan first: completion 100 %, `needItems` 0, and the remote did not have the file. A paused peer: 99.996 %, `needItems` 4, `remoteState` unknown. | 14 |
| VS6 | Latency on LAN and Tailscale (n=40 per direction) | Verified | New file: p50 2.40 / 2.12 s on LAN (Mac to remote / remote to Mac), p95 3.77 / 3.39 s; on Tailscale p50 2.34 / 2.05 s. Hot file (an append every 0.5 s): p50 3.92 s (LAN) and 4.76 s (Tailscale), max 8.13 s. Write plus a targeted scan (n=30): p50 1.33 s, p95 1.59 s on both. | 14 |
| VS7 | Laptop sleep for 2 min | Partly | Both Syncthing processes of the Mac frozen (SIGSTOP): after 120 s the remote still showed the Mac as connected; 50 remote events arrived 1.19 s after the wake. Shutdown: the remote saw it in 0.3 s; catch-up 2.26 s after the start. A first run froze only the monitor process and is not counted. | 15 |
| VS8 | Undo with Syncthing versioning | Partly | `simple`: kept the remote overwrite and the remote delete, not the Mac's own overwrite. A REST restore reached the remote in 6.66 s. The versions folder did not sync. `staggered` outside the AW folder: kept 1 version of 2. | 13 |

### 10.2 Agent session on the remote test box
| ID | Check | Verdict | Evidence | Design change |
|---|---|---|---|---|
| VA1 | Start in tmux with the AW plugin | Partly | Plugin, skill, hooks and `aw` loaded. The first message arrived through UserPromptSubmit 0.9 s after SessionStart. A new folder showed the "trust this folder" screen, and no hook reported it. Without the allow rule `Bash(aw *)`, `aw ask` waited at a permission dialog. | 17 |
| VA2 | The answer reaches the agent as the next input | Verified | tmux: answer to resolved 0.26 s, to UserPromptSubmit 0.40 s, to the first tool 2.59 s, to Stop 4.90 s. Messages delivered in 0.22–0.40 s. Orca terminal: UserPromptSubmit 1.89 s after the answer. The agent finished the task each time. | 4 |
| VA3 | The agent reads the original first message | Verified | `aw thread AW-1` gave the first message word for word, and the agent quoted it. | 1, 2 |
| VA4 | Approve or deny from another device | Partly | 5 requests resolved 0.02–0.22 s after the answer. A deny reached the model only as a tool error. After a forced stop, an old answer to the counter id `p-4` approved a new Write request with the same id in 1 ms. Random ids (`p-8c8b3757`) fixed it. | 18 |
| VA5 | Forced stop (`kill -9`) and resume | Partly | `--resume <uuid>` kept the session id, loaded the plugin again (SessionStart `resume`) and got the continue message 13 s after the kill. The agent did not run the interrupted step again. One resume lost the continue message because of the flag order. A background `sleep 40` kept running after the kill. | 8, 17, 19 |
| VA6 | `awd` crash | Verified | The session kept working while `awd` was down. An answer written during the outage was delivered 0.47 s after the `awd` start. | — |
| VA7 | Orca worktree and terminal | Partly | The CLI created the repo entry, the worktree and the terminal. A real session ran and got the answer in 1.84 s. The terminal read gave text 2 columns wide, so AW cannot read the screen. | 20 |

### 10.3 Android engine on the emulator
| ID | Check | Verdict | Evidence | Design change |
|---|---|---|---|---|
| VM1 | Image and test APK | Verified | The APK matched its published sha256 and signature. Engine `libsyncthingnative.so` 37.4 MB. | — |
| VM2 | Engine inside the app, REST pairing | Verified | Connected 1.48 s after the device and the folder were added. After a force-stop, the config stayed and the engine reconnected in 1.13 s. | — |
| VM3 | Phone sync latency (n=20 per direction) | Verified | Phone to remote p50 2.33 s, max 2.85 s; remote to phone p50 2.29 s. With a REST scan: p50 1.32 / 1.30 s, max 1.57 s. 84 files, no loss. | 14 |
| VM4 | Doze | Partly | Forced deep idle, no battery exemption, foreground service on (net policy `blocked=DOZE`, `allowed=FOREGROUND`): a file arrived in 3.12 s and 3.10 s. Battery "Restricted": no foreground service, no connection, no file after 92 s, nor 66 s after the next app open. A force-stop plus open got it in 3.95 s. | 21 |
| VM5 | Footprint | Partly | APK about 20 MB, 61 MB installed. Engine RSS 48–50 MB, app PSS 47 MB, engine CPU 0.26 % over 300 s idle. The emulator has no power model and reports 0 mAh. | 21 |
| VM6 | Reconnect after a restart of the remote | Partly | Only the phone dialed, with a 20 s interval: 9.1–16.3 s after a 7–21 s outage, and 1.8 s after the start that ended a 268 s outage. | 16 |
| VM7 | Push wake-up | Unverified | Not tested: it needs a test app with Firebase, or an ntfy server and app. | Spike S1 |

### 10.4 Design review of `workflow.md` (VD1) — Partly
The review found 9 must-fix items (D1–D9), 13 should-fix items (D10–D22) and 7 strong points: one writer per log file, a description built from fields, `aw ask` returns at once, tmux survives the daemon, workflow independence, a permission hook without the daemon, principle 8 in the base design. Mapping to the design changes:
- D1 → 1, D21 → 2, D2 → 3, D3 → 4, D4 → 5, D5 → 6, D6 → 7, D7 → 8, D8 → 9, D9 → 10, D10, D11 and D22 → 22. `workflow.md` also takes D12 (one rule for gate answers), D13 (Done and Cancel), D15 (device capabilities), D16 (continuity rules), D19 (lid close is best effort), D20 (permission mode per project) and D18 (push sender, AN15; task-model decision §5.4).
- D14: a subtask starts at Ready with the confirmed approach of its parent; its workflow can still open "Confirm approach" (task-model decision §5.2).
- D17: the phone can send free text to a running session, delivered as the next input by change 4. It can add or replace a credential but cannot read it, because it seals the value to the device keys of the computers only (task-model decision §5.3).

### 10.5 Design changes
All 22 go into `workflow.md` before implementation. The numbers match the column "Design change".
1. The session device writes every human and agent message to the thread as raw text: the first message, typed text, delivered answers (UserPromptSubmit) and agent replies (Stop hook).
2. The first input = the first message + the confirmed approach word for word + "read `aw thread --ancestors` first". Hook context ≤ 10,000 characters.
3. AskUserQuestion, ExitPlanMode and a turn that ends with a question become gates.
4. Delivery only when no dialog is open: paste, then press Enter once. A hook confirms each delivery id.
5. One session per task: `task.claimed` with an epoch. A laptop that wakes after its task moved pushes its unpushed work as the branch `aw/<key>-<device>-<time>`, writes a thread comment (`comment.added`) and never drops it.
6. A task with no assignee, from a human or an agent, goes to "Needs you: assign". AW never assigns it alone. The only exception is the project switch "Assign new subtasks to the default device", off by default (task-model decision §5.1).
7. Task folders use the internal id, not the key.
8. The first message goes to a file, and a fixed wrapper starts the session. The message is never in a shell command line.
9. Every event writer redacts credential values.
10. AW sends "Start implementing" only after `aw ready` passes on the implementing device.
11. Write `config.xml` before the first Syncthing start. Use REST only after that.
12. `maxConflicts` ≥ 10. The copy name carries the winner's short id. The resolver uses a sha256 journal of the device's own writes.
13. Undo: `simple` versioning outside the AW folder, plus AW's copy-before-write for local edits.
14. A targeted REST scan after each own write. "Sync now" starts with a scan. Allow ≥ 8 s for sync before "No recent update".
15. Presence from AW heartbeat events, not the Syncthing connection state. Supervise both Syncthing processes (monitor and worker).
16. Reconnect interval 5 s during pairing and while the phone app is open.
17. Launcher: pre-trust the worktree, allow `Bash(aw *)`, put `--` before the message, set tmux `remain-on-exit`.
18. Each permission answer names a unique request id. A deny also goes to the agent as the human's next input. "Approve command" waits 120 s, then denies; a late "Allow" becomes a one-time approval for that exact request id.
19. A forced stop kills the whole process group. Track exact pids.
20. Read agent output from hooks and the transcript, never from the Orca screen. Find the Orca binary with `aw doctor` (config path, macOS app bundle `orca`, then `orca-ide` or `orca` on PATH) and call it by its full path.
21. Android: one always-on `specialUse` foreground service with a permanent notification runs the engine. The app warns for battery "Restricted" mode and restarts the engine at each app open. Section 9 (AN6 group) explains why an always-on service, not short `dataSync` periods, which stay the fallback.
22. Separate Syncthing folders: `tasks` (all devices), `knowledge` (all devices), `secure` (credentials and test-server config; local and remote only). Each gate has a timeout or a reminder rule.

Not tested in round 6: a mobile network and the community relay, a real lid close (the test froze the process), battery mAh and real CPU sleep on a phone, push, Play Store policy for the foreground service, the permission hook timeout path, and an Orca restart.

## 11. Phase 1 sync structure from rounds 4 to 6
Phase 1 uses the final module boundaries ([decisions/2026-11-22-phases.md](decisions/2026-11-22-phases.md) rule 3). Phase 2 adds implementations and changes no phase 1 code.

| Interface | Phase 1 implementation | Fallback | Later |
|---|---|---|---|
| `SyncTransport` (`architecture.md` 6.1: `addPeer`, `removePeer`, `addFolder`, `wrote`, `syncNow`, `pause`, `resume`, `status`, `events`) | `SyncthingTransport`: desktop and remote = the pinned official binary as a child of `awd`, controlled through REST (TypeScript); Android = `libawsync.so`, controlled through REST (Kotlin) | `aw-syncd` (ST12), gomobile (AN11) | Phase 2: `R2Transport`, `IrohTransport`. Phase 3: Google Drive. |
| File layout | Syncthing folders `tasks` and `knowledge` (all devices) and `secure` (local and remote only). `tasks/<task-id>/task.yaml`, `tasks/<task-id>/log/<device>.jsonl`, where `<task-id>` is the internal id (`phase-1.md` 3.1) | — | Unchanged in phase 2 and 3 |
| Local index | SQLite in `~/.aw/index/`, outside the synced folders, rebuilt from the files, never synced | — | Unchanged |

Rules for `awd` and the Android app:
1. Write the safe config before the first start (ST3, VS2). After that, use REST only.
2. Supervise both engine processes (ST10). Presence comes from AW heartbeats (VS7).
3. Write each log file at most once per second, then scan that path (ST7, VS6). "Sync now" starts with a full scan (VS5).
4. Never delete task folders (ST5). Keep `maxConflicts` ≥ 10 and a sha256 journal of the device's own writes (VS4).
5. "Synced" only from per-device `needItems`, `remoteState` and the connection state (ST8).
6. Full mesh between all devices (ST13). Reconnect interval 5 s during pairing and while the phone app is open (VS1, VM6).
7. Set the ignore `*.aw-tmp` on each device (ST2).
8. Undo: `simple` versioning outside the AW folder, plus copy-before-write (VS8).

## 12. Phase 2 background (earlier relay, storage and push checks)
The relay transport decision replaced the WebSocket relay on Cloudflare Durable Objects with iroh. These earlier findings stay useful for phase 2:
1. **Relay (R03, R04, R07, r3).** A relay "ok" is not a delivery: use end-to-end acks and an outbox. The relay sets `from`. Revoke needs a signed device list with sequence numbers. A replay within 60 s passed, so a nonce is needed. A paused link kept 3 of 3 frames in the outbox.
2. **Storage (R13, R14, R16, r5).** `If-None-Match: *` and `If-Match` gave `[200, 412]` on 4 servers; Garage gave a lost update and is refused. R2 needs a payment method, free 10 GB-month. Presigned URLs last 1 s to 7 days and cannot be revoked early.
3. **Network (r2, r6, D4).** Android blocks cleartext `ws://`; a self-signed `wss://` certificate needs a pin in code. Doze stops background sockets on every route. Tailscale conflicts with a work VPN on Android. The offline alert keeps 1 record on the person's own relay, off by default.

## 13. Open risks
1. Automatic sessions on a consumer plan are a grey area (T2). 24/7 work does not fit Pro or Max, and the weekly cap of Ultra ends continuous work early (T3).
2. A plan login has a fixed end date that use does not extend (C3). A 24/7 remote device needs a human to sign in again.
3. Unattended resume blockers (C1): the resume dialog, the 30-day transcript sweep, launch flags that are not restored.
4. Headless Mac (C5): FileVault after a power cut; a GUI Keychain login is likely not readable by a daemon (not tested).
5. A real session confirmed SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, Notification, Stop, SessionEnd and `--resume` (VA1–VA5). From the documentation only: the PermissionRequest timeout, the statusline under `--settings`, the `denyInsteadOfPrompting` order, PostCompact. Claude Code changes fast; contract tests per version are necessary.
6. The Syncthing REST API "is subject to change", and `lib/syncthing` is not a stable API (ST12). Pin the version and run contract tests.
7. Web Push with VAPID to FCM is documented by UnifiedPush, not by Google (AN15). FCM can lower the priority of pushes (AN16). Fallback: ntfy.
8. Play acceptance of a bundled executable and of the `specialUse` foreground service declaration is not proven (AN22, AN19). Fallback: `dataSync` periods (section 9, AN6 group), and F-Droid and GitHub releases.
9. Notarization of the Mac app with a nested binary signed by another team is not tested (ST15).
10. Phone and owner device are often not online together. An answer then waits (AN18). R2 in phase 2 removes the wait.
11. Community discovery and relay servers see IP addresses, device ids and traffic volume (AN21). A default first start opens router ports and contacts public servers (VS2).
12. Delete against modify brings back orphan files (ST5). The conflict copy name gives only the winner, so the priority rule depends on the write journal (VS4).
13. Syncthing versioning keeps only the changes of other devices (VS8). AW's copy-before-write must cover every local edit.
14. All tests ran on one home LAN, and Tailscale used a direct path. A mobile network and the community relay are not tested.
15. Battery "Restricted" mode stops phone sync until a force-stop (VM4). Battery use on a real phone is not measured (VM5).
16. AW cannot read the Orca terminal screen (VA7). Session survival over an Orca restart is not tested.

## 14. Next checks
Phase 1 spikes (ids of `phase-1.md` 13):
1. **S1 Push.** Send Web Push with VAPID to a Pixel 9 in Doze through the embedded FCM distributor and through ntfy. Measure the delivery time, the kept priority and the start of the foreground service when it does not run. Required before the phone release.
2. **S2 Phone sync.** Round 6 measured the emulator on LAN (VM2–VM6). Measure a real Pixel 9: engine cold start, connection time and the full gate round trip on Wi-Fi, mobile data and a community relay.
3. **S3 REST on a Unix socket** on Android 17 (API 37).
4. **S4 Play internal testing** with the bundled engine, the `specialUse` foreground service declaration and the video.
5. **S5 Mac packaging.** Nest the official binary in the Electron app, notarize, run on a clean Mac.
6. **S6 Sync before sleep.** Close the lid of a real Mac. Measure the time that the app gets after `suspend`.
7. **S7 Permission order and timeout.** Run a command that no rule allows with `denyInsteadOfPrompting: true`. Check that "Approve command" opens. Let the 120 s pass, then send a late "Allow". Check the one-time approval.
8. **S8 3 devices for 7 days.** A laptop that sleeps, ubuntu-01 and a Pixel 9 with "Sync now" and sync before sleep. Count conflict copies, repaired copies and lost lines. Test knowledge undo. Measure the phone battery for 24 h.
9. **S9 Live channel.** Connect the Kotlin app to awd over `wss://` with certificates pinned to the device keys, on LAN and Tailscale.

Other phase 1 checks:
1. **Real Claude session for 7 days** on a Linux remote device (systemd user units, linger, tmux in `aw-sessions.service`). Round 6 ran 2 short sessions. Send `kill -9` to `awd`, restart `awd`, reboot, update AW. After each step, check C1, C2, C4, C6 and C7. Record `used_percentage` per agent-hour.
2. **Orca restart.** Restart Orca while a session runs in an Orca terminal. The session must continue.
3. **Mac mini.** Install the LaunchDaemon on Apple silicon with macOS 26. Cut the power. Check the FileVault SSH unlock and `claude auth status --json` from the daemon.
4. Record `loginExpiresAt` for 30 days, and ask Anthropic for a written position on T2.

Phase 2: the iroh spikes in the relay transport decision, and a knowledge backup to a real R2 bucket with 2 writers and a full restore.
