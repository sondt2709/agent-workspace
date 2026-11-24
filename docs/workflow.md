# Agent Workspace — Workflow

| Item | Value |
|---|---|
| Document | The work process of AW, step by step |
| Version | 0.3 (phase 1), 2026-11-22 |
| Readers | Product owner, architects, implementers, coding agents |
| Rules from | `principles.md`, `decisions/2026-11-22-task-model.md`, `decisions/2026-11-22-device-sync.md`, `decisions/2026-11-22-phases.md`, `decisions/2026-11-22-relay-transport.md` (push) |
| Changes in 0.3 | MCP tools next to the `aw` commands (section 8), macOS notifications, tmux and Orca as session hosts |

This document tells what happens from "the human has a task" to "the task is done". It does not depend on one agent workflow. Section 10 shows how two different workflows use the same steps. The answers of the product owner are in `decisions/2026-11-22-task-model.md` §5.

## 1. Devices
| Role | Example | Creates tasks | Implements | Notes |
|---|---|---|---|---|
| local | MacBook Pro | Yes | Yes | The main device. 1 per person. AW works with this device only. |
| remote | ubuntu-01, a second laptop | Yes (its agents) | Yes, default | 0 or more. Each project has an ordered list of implementing devices. |
| mobile | Pixel 9 | Yes | No | A remote control. |

1. The devices sync the AW folder (for example `~/AW/`) with built-in Syncthing, in 3 separate Syncthing folders: `tasks`, `knowledge` and `secure` (section 9).
2. Each device writes only its own log files. Code goes through git, never through the AW folder.
3. **Presence comes from AW heartbeats, not from the Syncthing connection state.** Each device writes a heartbeat every 30 s. The other devices show it offline after 90 s with no new heartbeat. In the test, a frozen laptop stayed "connected" in Syncthing for 2 minutes.
4. awd supervises both Syncthing processes (the monitor and the worker). It restarts the engine when the worker stops or does not answer its REST API.

## 2. Task fields
| Field | Written by | Note |
|---|---|---|
| Id | AW | A UUIDv7. It never changes. Folders, links and tmux window names use it. The work branch is `aw/<key>` as at the first session, and it does not change after a rekey (4.8.3). |
| Key | AW | `AW-12`, a display alias. A collision gives one task a new key (`task.rekeyed`), and the thread shows the change. `aw` commands accept the key or the id. |
| First message | The human who creates the task | The first input of the agent. AW passes it as is, for example `/my-team:implement Add a rate limit to the public API`. |
| Approach | The agent | Versioned. The human confirms it at the gate "Confirm approach". |
| Test server | The human, or the agent proposes it | A name from `secure/test-servers.yaml`. |
| Credentials | The human | Names of encrypted entries. Every event writer and the text files of a task replace a credential value with `[redacted:<name>]`, also in base64 and URL-encoded form. |
| Assignee | The human (or the project switch for subtasks) | `agent@device`, for example `claude@ubuntu-01`. AW never assigns a task alone (4.1, 4.6). |
| Parent, subtasks, dependencies | The agent or the human | A subtask starts only when its dependencies are done. |
| Thread | The session device, plus each device for its own answers | The raw text of all human and agent messages, questions, answers, gates, approach versions, artifacts and system messages (4.3). Never a summary. |

The description is a view of these fields. AW builds it when it sends the task to another platform (phase 2).

## 3. Stages and gates
| Stage | The task enters when | The task leaves when |
|---|---|---|
| Backlog | The human parks the task, or a task has no assignee. | The human assigns it or starts it. |
| Discuss | The session starts with the first message. | The human confirms the approach. |
| Ready | The approach is confirmed. A subtask starts here (4.6). | AW sends "Start implementing" (4.7). |
| Implement | AW sends "Start implementing". | The agent posts the result. |
| Review | The agent posts the result (`aw result`). | The human approves the result, or requests changes (back to Implement). |
| Done | The human approves the result. | — |

- **Needs you** is a lane, not a stage. It shows each task with an open gate.
- **Paused** is a state on top of a stage, always with a cause and a next step: usage limit (resumes at 14:00), device offline (waits until the device is back; the human can assign the task to another device), device restart (resumes alone), login expired (needs you), waiting for sync, moved to another device.
- Only a gate action of the human moves a task past a gate. A comment never changes the stage.

This table is the canonical list of phase 1 gates. The other documents refer to it.

| Gate | Opened by | Human actions | Push, timeout or reminder |
|---|---|---|---|
| Answer question | `aw ask`, or the `AskUserQuestion` tool | Select an option, or write an answer | Push. No timeout. Reminder push after 1 h and 24 h. |
| Reply | A turn that ends with a question, and no question, approach or reply gate of the same turn is open | Write a reply | Push. No timeout. Reminder push after 1 h and 24 h. |
| Confirm approach | `aw approach`, or the `ExitPlanMode` tool | Confirm · Request changes (with a comment) | Push. No timeout. Reminder push after 1 h and 24 h. |
| Assign task | A task with no assignee (4.1, 4.6) | Assign `agent@device` | Push when an agent created the task. Reminder push after 24 h. |
| Approve command | A permission request of the agent | Allow once · Allow for this task · Deny | Push. The hook waits 120 s, then denies. While the agent waits, a late "Allow" becomes a one-time approval for that request id. AW closes the gate ("Denied after 120 s") at the next turn of the session, or at another request more than 120 s later (rule 4). |
| Approve result | `aw result` | Approve · Request changes | Push. No timeout. Reminder push after 1 h and 24 h. |
| Approve knowledge change | An agent change to a rule, a locked file or shared knowledge | Approve · Reject | No push. It stays in the daily digest until the human answers. |
| Approve device | A new device asks to pair | Approve · Reject | No push. The pairing code expires after 10 min. |
| Continue after usage limit | 3 automatic continues in one session | Continue now · Wait for the reset | Push. No timeout. Reminder push after 24 h. |
| Take over terminal | An unknown screen, or a failed resume and handoff | Open the terminal · Stop the task | Push. No timeout. Reminder push after 1 h and 24 h. |
| Fix a file | A schema error after a manual edit | Open file · Restore last valid version | No push at open. Reminder push after 24 h. |
| Custom gate | `aw gate` from a workflow | The decisions in the gate file, or a reply | Push. No timeout. Reminder push after 1 h and 24 h. |

1. Each gate has a unique id (a UUIDv7). Each answer names the gate id and the version that it answers. An answer to an old version becomes a comment.
2. The session device resolves a gate with the first answer that it receives. A later answer becomes a comment.
3. No gate opens by itself to move a task. AW never changes the agent or the device of a task (`decisions/2026-11-23-manual-move.md`).
4. **Gates with no session.** The owner device closes each open gate that no session can use, with the answer "Session ended" (rule 2 then makes each later answer a comment):
   - "Approve command" when its session ends, for each reason (stopped, crashed, moved, replaced, done).
   - "Answer question", "Reply", "Confirm approach", "Continue after usage limit" and "Custom gate" when a person stopped the session, or the task is done. After a move or a replace, the next session gets these gates. After a crash, "Resume again" resumes the same session.
   - "Approve result", "Take over terminal" and the gates that need no session stay open.
5. A test slot lease lasts 30 min, and the session heartbeat renews it. A test server that stays up for Review stops at the approval, 24 h after "Request changes", or when the human stops it.

## 4. Main flow
### 4.1 Create the task
1. On local or mobile, the human selects the project and writes the first message. Optional: assignee, test server, credentials, parent task, and the session options (4.2.1).
2. The creating device writes `task.created` with a new id and the next free key that it knows.
3. A task with no assignee stays in Backlog and opens the gate "Assign task" ("Needs you: assign"). AW never assigns it alone (task-model decision §5.1).
4. Syncthing copies the log to the other devices. Mobile can create a task while the laptop sleeps; the remote device sees it directly.

### 4.2 Start the session
1. The daemon on the device of the assignee (`agent@device`) sees `task.assigned`. It writes `task.claimed {epoch, device, session}` with an epoch 1 higher than the highest epoch that it knows. It claims only when the task has no accepted claim, or when the newest accepted `task.assigned` sorts after the accepted claim. When the accepted claim is on another device (a move, `architecture.md` 4.3.4), it claims after `task.released` of that device, or at once when that device is offline.
2. A claim counts only from the device of the current assignee. The merge ignores a claim from another device and reports it (`not_assignee_device`). So AW never moves a task by itself, and a laptop that wakes after the human moved its task cannot take it back (`decisions/2026-11-23-manual-move.md`).
3. Only the session with the highest epoch runs. The merge order (HLC, then device id) picks the same winner on every device.
4. After a wake or a reconnect, the daemon reads the merged log first. It stops each session with a lower epoch, and the task shows "Moved to ubuntu-01".
5. The daemon writes the first input to `~/.aw/sessions/<session-id>/first-input.md`. It never puts user text in a shell command line.
6. The daemon starts the fixed wrapper `aw-launch <session-id>` in a tmux window (default), or in an Orca terminal when the device turned on `host-orca` (`worktree create`, then `terminal create`). It uses separate arguments and no shell string.
7. The wrapper marks the worktree as trusted (`architecture.md` 4.6.2), so that the trust screen does not open. It checks `/readyz` on the awd socket and exports `AW_MCP_URL` and `AW_MCP_TOKEN`. Then it runs (`phase-1.md` 9.1):
   `claude --session-id <uuid> -n <key> --plugin-dir <aw-plugin> --settings <session-settings> --permission-mode <mode> --allowedTools "Bash(aw ask *)" ... "Bash(aw thread *)" "mcp__plugin_aw_aw__*" -- "<first input>"`. The mode comes from the session options (4.2.1).
8. The tmux window has `remain-on-exit` on, so AW can read the exit status. AW records the exact pid and the process group of the session.
9. The AW plugin registers the AW MCP server and gives the agent the AW skill ("The human is not at this terminal. Use the AW tools, or the `aw` commands when the tools are missing, for each question, approach, result and handoff. The answer arrives as your next input."). At SessionStart, it gives at most 10,000 characters: the task fields, the rules, the list of knowledge files, and "Read the full thread with `aw thread <key> --ancestors` before you act."
10. The agent follows its own workflow. AW does not know or read that workflow.

#### 4.2.1 Session options
A person sets 3 options in New task, New session and "Assign to another device…", on the desktop, the phone or with `aw task create|assign` (openspec session-options):
1. **Permissions**: Default (the agent asks for each command and edit that has no rule), Accept edits (it edits files in its folder with no question), or Skip permissions (`--permission-mode bypassPermissions`: no gate for each command). The project has a default (`project.yaml` `permission_mode`, `aw project edit --permission-mode`). Skip permissions is the default mode (owner decision 38): a new workspace, a new project and a project with no value use it, and New task (desktop and phone) preselects it. A person can choose Default or Accept edits for a task, a project or new projects. Only a person sets "Skip permissions": the merge ignores the options of an agent event, awd refuses them from a session caller, and a project default "Skip permissions" counts only for a task that a person created. So a subtask of an agent never gets it. The task shows a red chip "Skips permissions". The AW guard checks only the command text, so a hidden command can still act as the person in AW (`SECURITY.md`); the warning of the option says so.
2. **Agent teams** (experimental): the session settings turn on the Claude Code agent team setting with the in-process display. The teammates run in the pane of the lead and get its permission mode. AW follows the lead session: a question or a plan of a teammate opens no gate (the hook tells the teammate to ask the lead). A resume continues without the teammates.
3. **Work in**: a separate worktree (default, `~/.aw/worktrees/aw-<key>` with tmux, the Orca worktree `aw-<key>` with Orca), the project checkout (AW checks out `aw/<key>` there; one session at a time; it changes the branch and the files of the person's checkout; a clean AW worktree of an earlier session of the task is removed first), or another folder (an absolute folder on the session device, as it is: no worktree, no branch, no checkpoint push).
The task shows "Works in <folder> · branch aw/<key>" with Copy, and Open on the session device. In each mode the AW guard of the PreToolUse hook denies a person `aw` command, the awd socket and the AW files (`phase-1.md` 9.1.7).

### 4.3 Thread and delivery
1. The session device writes each message to the thread as raw text:
   - `message.human` from the `UserPromptSubmit` hook, with its source (`first`, `typed`, `answer`, `phone`) and the `delivery_id` of a delivered text.
   - `message.agent` from the `Stop` hook (`last_assistant_message`) with `source: turn`. It shows only in the Session tab. The agent sends its updates through AW: a turn with no update gets one notice `message.sent {kind: nudge}` (`decisions/2026-11-25-agent-pushes-updates.md`).
2. AW reads agent output only from the hooks and the transcript. It never reads the terminal screen (an Orca terminal can be 2 columns wide).
3. A device that sends an answer or a message writes it to its own log first: `gate.answered`, or `message.sent {id, text, to_session}`. Only the session device writes `message.human`, so the thread has each text once. `aw thread` shows an undelivered `message.sent` as "Not delivered yet".
4. The session device delivers the text to the session with one function:
   1. Wait until no dialog is open (no permission prompt, no picker, no auto-continue wait).
   2. Add the prefix `[AW answer <gate-id>]` or `[AW message <message-id> from <device>]`.
   3. Paste the text with bracketed paste (`tmux load-buffer`, `paste-buffer -p`), then press Enter once.
   4. Wait for the `UserPromptSubmit` hook to confirm the id. Make at most 3 attempts, 30 s apart. Then show "Answer not delivered" with the pane snapshot.
5. The phone can send free text to a running session. It goes through the same delivery as the next input (task-model decision §5.3).

### 4.4 Questions
1. The agent runs `aw ask AW-12 "Which limit per client?" --details-file limits.md --option "100/min::Enough for the web app" --option "1000/min::For the batch jobs"`. The command returns at once.
2. AW writes `gate.opened` (kind `question`) and opens the gate. The question is the title. The details are the text: the full context of the decision (the options, trade-offs, risks and a recommendation), because the human sees only the gate. Details over 16 KiB keep their start in the gate, and the full text is in `artifacts/<device>/text-<gate>.md`. An option with a description adds `questions` to the gate.
3. The device that owns the gate sends a Web Push (VAPID) to the phone through the UnifiedPush embedded FCM distributor, with no AW server. The fallback is the person's own ntfy server. Push is required in phase 1, and a spike runs before the phone release (task-model decision §5.4). The desktop app shows a macOS notification with one action per option. A click opens the task (`architecture.md` 4.10).
4. The human answers on any device. That device writes `gate.answered` to its own log.
5. The session device resolves the gate (section 3), writes `gate.resolved`, and delivers the answer (4.3).
6. Hooks catch the questions of a workflow that does not use `aw`:
   - `AskUserQuestion`: a `PreToolUse` hook opens the gate "Answer question" with each question, its header, its multiSelect value and each option with its description (`questions`). It denies the tool with "AW sent this question to the human as gate `<id>`. End your turn." With 2 or more questions or a multiSelect question, the card shows each question with its options and "Send answers". The answer is one text in the format of the Claude Code tool result: `"<question>"="<label>", "<question>"="<label>, <label>"`.
   - A turn that ends with a question, when no question, approach or reply gate of the same turn is open: the `Stop` hook opens the gate "Reply".
7. A question or reply gate with no details (an older gate, or a question like "see the message above") shows "Context" on its card: the agent messages after the last event of a person before the gate, at most 5.

### 4.5 Approach
1. When the agent and the human agree, the agent runs `aw approach AW-12 --file approach.md`. The file is Markdown. Optional decisions, each with a recommendation, show as choices.
2. In plan mode, a `PreToolUse` hook on `ExitPlanMode` turns the plan into the same gate.
3. The gate "Confirm approach" opens. The human confirms, or requests changes with a comment. Each new file is a new version.
4. On confirm, the stage changes to Ready, and AW delivers "Approach v2 confirmed. Run `aw ready AW-12` and end your turn." The decisions of the file (`--decisions`, a JSON array of `{question, options, recommended}`) show in the gate; "Confirm" accepts the recommended options, and another choice goes in the comment of "Request changes".
5. The confirmed approach becomes a task field. The thread keeps all versions.

### 4.6 Subtasks
1. After the approach is confirmed, the agent can create tasks: `aw task create --parent AW-12 --title "…" --first-message-file m.md --depends-on AW-13`. It can copy fields from the parent with `--from-parent`, or set them with `--test-server`, `--credential` and `--link` (task-model decision §5.2).
2. A task that an agent creates opens "Assign task" too (the "Needs you" reason `assign`; it is not a gate event, because the answer is a `task.assigned`). The human assigns it to `agent@device`. Only when the project switch "Assign new subtasks to the default device" is on, AW assigns a new subtask to the default agent at the first online device of the project list. The switch does not assign a subtask of a task that an agent created: an agent subtask never starts another subtask by itself. The switch does not assign a subtask in another project than its parent either: that subtask waits for the human. An agent gives a subtask only the credential names of its own task. The switch sets only the first assignment: the merge ignores a later assignment of an agent (`assignment_not_allowed`). The switch is off by default.
3. A subtask starts at Ready with the confirmed approach of its parent. Its workflow can still open "Confirm approach" when it needs its own approach.
4. A subtask starts when it has an assignee and its dependencies are done.

### 4.7 Ready to implement
1. The agent checks that it has enough information, by its own workflow. Then it runs `aw ready AW-12`. The command returns at once.
2. When something is missing, the agent runs `aw ready AW-12 --missing "test account for role X"`, which opens one question per item ("Missing: test account for role X"). When the human answers them, AW starts the checks again.
3. The daemon on the implementing device checks:
   1. The latest `task.ready` of the agent has no open missing item.
   2. The human confirmed the approach.
   3. The task has an assignee.
   4. The `knowledge` and `secure` folders are at 100 % with each connected device. Until then the task shows "Waiting for sync: knowledge 92 %" (the pause `waiting_for_sync`). With no sync engine (one device), this check passes.
   5. No dependency of the task is open, and the agent ran `aw ready` in this session on this device.
4. When all checks pass, AW sends "Start implementing". The stage changes to Implement only at this send.
5. When the implementing device is the session device, "Start implementing" is the next input of the same session.
6. When the human assigned the task to an agent on another device, the discuss device ends its session (`session.ended reason=moved`). The implementing device claims the task (4.2) and starts a new session with the first input of 4.8.1. That agent runs `aw ready` again, and AW sends "Start implementing" only after the checks pass on that device.

### 4.8 Implement
1. The first input of a new session holds the first message and the confirmed approach word for word, then "Read `aw thread <key> --ancestors` first." `aw thread` pages a long thread with `--from <n>`.
2. Each session works in its own worktree of the project checkout on that device.
3. The agent commits its work on the work branch `aw/<key>`. AW pushes the branch to `origin` at each Stop of the session with the highest epoch, with an explicit `--force-with-lease` (`architecture.md` 4.6 item 8). The branch name stays the same after a rekey. Exception: when that name is the branch of another task of the project, the branch on `origin` is `aw/<new key>`.
4. During the work the agent uses:
   - `aw stage AW-13 "Run the tests"` for progress,
   - `aw slot acquire k3d` and `aw slot release` for test slots,
   - `aw artifact add AW-13 report.html` for artifacts.
5. Credentials come to the session as files with mode 0600 when the session starts. An environment variable is used only when a tool needs one. A resumed session gets them again.
6. A permission request of the agent opens the gate "Approve command", unless a rule decides:
   1. Each request has a unique request id, and each answer names it. The hook waits 120 s for an answer, then denies.
   2. A deny also goes to the agent as the human's next input: "The human denied `<command>`: `<comment>`".
   3. A late "Allow" becomes a one-time approval for that request id. AW delivers "Approved: run it again", and the hook allows the same request once.

### 4.9 Review
1. The agent runs `aw result AW-13 --file result.md` with its artifacts, for example a PR link, a test report or a demo video.
2. The gate "Approve result" opens. When the workflow keeps a test server running for a manual check, the task shows "Test server running: k3d on ubuntu-01".
3. The human approves, or requests changes with a comment. A request sends the task back to Implement in the same session.

### 4.10 Done
1. After the approval, the agent gets "Result approved" as its next input, and it does the last steps of its workflow (for example archive, retrospective, clean-up).
2. The agent runs `aw learn AW-13 --file` for each learned item, or `aw learn AW-13 --nothing-new` (decision D3). Each run writes `task.learned`, so the thread shows "Learned by claude@ubuntu-01: <path>" or "Nothing new learned".
   1. AW does not block `done` without this step. The `done` reply reminds the agent.
   2. When the session of a done task ends with no `task.learned`, AW writes the comment "AW-13 is done with no learned item and no "Nothing new" (decision D3)."
3. The task is Done at the first `Stop` after "Result approved", or when the agent runs `aw done` (only after an approved result). AW then writes `session.ended {reason: done}` and closes the window at that `Stop`.
4. When a subtask is done, the session device of the parent delivers "Subtask AW-13 done" to the parent session. When that session ended, it starts a new one with the notice as the first input. When a person stopped that session, AW starts none: the notice goes to the next session that the person starts.

## 5. Continuity
| Event | What AW does | What the human sees |
|---|---|---|
| The laptop sleeps | After 90 s with no heartbeat, the other devices show it offline, and its running tasks show `device_offline`. The tasks wait, also the queued tasks: AW opens no gate and moves no task. The human can select "Assign to another device…" on a paused task; that writes a human `task.assigned`, and the new device claims the task and continues from the last pushed step. | "Paused: MacBook Pro offline" with the action "Assign to another device…" |
| The laptop wakes after the human moved its task | The daemon reads the merged log and stops the old session. It pushes the unpushed work as the branch `aw/<key>-<device>-<time>` and writes a thread comment (`comment.added`, because it is no longer the owner). It never drops the work. | "Moved to ubuntu-01. Unpushed work is on aw/AW-12-macbook-pro-0315." |
| Remote device reboots or AW updates | tmux keeps the sessions during an AW update. After a reboot, AW resumes each session with `claude --resume <id> … -- "<continue message>"`. The message names the interrupted step. | "Server restarted at 03:12. AW resumed the session at 03:13." |
| Forced stop of a session | AW kills the whole process group of the session, from the recorded pids. It never uses `pgrep -f`. Then it resumes as after a reboot. | "Session stopped at 10:41. AW resumed it at 10:41." |
| AW service crash | The sessions continue in tmux. The restarted service delivers each missed answer. | No change |
| Usage limit | Claude Code continues alone after a 5-hour reset. AW continues after a weekly reset, at most 3 times, then asks. | "Paused: usage limit · resumes at 14:00" |
| No progress | "No recent update" shows only when the session runs, has no open gate, and has no hook event and no terminal change for 2 min. A sync delay of up to 8 s is normal and shows no warning. | "No recent update" |

## 6. Where the human acts
| Action | local | mobile |
|---|---|---|
| Create a task, answer, confirm, approve, assign | Yes | Yes |
| Get a notice of a gate or finished work | macOS notification from the menu bar app, also with the window closed | Push |
| Read the thread, the approach, the artifacts | Yes | Yes |
| Send a message to a running session | Yes | Yes (4.3) |
| Stop a session, start a new session, set the session options (4.2.1) | Yes | Yes |
| Archive or unarchive a task | Yes | Yes |
| Watch the terminal | Yes | A snapshot |
| Take over the terminal | Yes (`tmux attach`, over SSH for ubuntu-01) | No |
| Add a credential | Yes | Add or replace only. The phone seals the value to the device keys of all paired computers and cannot read it. |
| Edit knowledge files | Yes | Small edits |
| Pair or remove a device | Yes | Approve only |

### 6.1 Stop a session, archive a task (openspec task-actions)
1. The task header of the desktop and the phone has a "⋯" menu: "Stop session…", "Archive task…" and "Unarchive task".
2. "Stop session…" works for a session on each device. The app writes `session.stop_requested {session}`, and the session device stops the session with the reason `stopped`. AW starts no new session until a person starts one.
3. "Archive task…" with a running session shows one confirm that names the session device. AW writes `session.stop_requested`, then `task.archived`.
4. The session device stops the session of an archived task with the reason `stopped`. An unarchive (`task.unarchived`) starts no session.
5. The archived tasks show in the group "Archived" of the desktop List and of the phone Tasks list.
6. The commands of a person: `aw task stop <task>`, `aw task archive <task> [--stop]`, `aw task unarchive <task>`. Without `--stop`, a running session gives the error `conflict`.

## 7. Before the laptop closes
1. The human selects "Sync" before the laptop closes. A laptop closed without a sync is the user's own mistake: AW shows the unsynced changes after the wake, and suggests no move.
2. AW starts a targeted REST scan of each folder, then waits until the other online devices have all its changes. Without the scan, Syncthing can report "synced" too early.
3. The app shows "Synced 12 s ago", or "3 changes not synced" with the files.
4. On a lid close, AW does a best-effort scan. After the wake, it shows "3 changes did not sync before sleep".
5. AW also starts a targeted scan after each of its own writes, so that a change reaches the other devices in about 1.3 s.

## 8. Agent interface: MCP tools and aw commands
Each MCP tool and its `aw` command call the same awd code and write the same event. Agents use the tools (`mcp__plugin_aw_aw__<tool>`). Hooks, scripts and agents with no MCP use the commands.

| MCP tool | `aw` command | Event | Effect |
|---|---|---|---|
| `thread` | `aw thread <key> [--ancestors] [--from <n>]` | — | Prints the original thread, and the threads of all ancestors with `--ancestors` |
| `ask` | `aw ask <key> <text> [--details <text> \| --details-file <path>] [--options "a\|b" \| --option "<label>::<description>"...]` | `gate.opened` (question) | Opens the gate "Answer question" with the question as the title and the details as the text |
| `approach` | `aw approach <key> --file` | `approach.proposed`, `gate.opened` | Opens the gate "Confirm approach" |
| `task_create` | `aw task create … [--from-parent] [--test-server] [--credential] [--link]` | `task.created` | A new task or subtask |
| `message` | `aw message <key> <text>` | `message.agent` (`source: tool`) | A short update to the human in Activity |
| `gate` | `aw gate open <key> --file gate.md [--decisions <json>] [--options]` | `gate.opened` (kind `custom`) | Opens a gate with any Markdown and optional decisions, each with a recommendation |
| `ready` | `aw ready <key> [--missing]` | `task.ready` / `gate.opened` | Starts the ready checks |
| `stage` | `aw stage <key> <text>` | `task.progress` | Updates the progress line |
| `slot_acquire`, `slot_release` | `aw slot acquire/release <resource>` | `slot.*` | Test slot lease from the owner device |
| `artifact_add` | `aw artifact add <key> <file>` | `artifact.added` | Copies the file into the task folder. Only a file in the working folder of the session (after symlinks), at most 50 MB |
| `result` | `aw result <key> --file` | `result.posted`, `gate.opened` | Opens the gate "Approve result" |
| `handoff` | `aw handoff <key> --file` | `handoff.written` | Context for the next session. The same file rule as `artifact_add` |
| `learn` | `aw learn <key> --file` / `--nothing-new` | `knowledge.changed` and `task.learned` / `task.learned` | A new knowledge file, or "Nothing new" (4.10) |
| `done` | `aw done <key>` | `task.done` | Ends the task after an approval |
| Resources: task fields (`aw://task`), knowledge list (`aw://knowledge`) | `aw kb list`, `aw kb context <key>`. `aw task show <key>` is not in the allow rules: in a session it asks the person first | — | Read-only |

In a session, each `aw` command reads a `--file`, `--decisions` or `--first-message-file` path only in the working folder of the session (after symlinks), the same rule as `artifact_add`. `-` reads stdin.

The launcher allows the agent commands (`Bash(aw ask *)`, `Bash(aw message *)`, `Bash(aw stage *)`, `Bash(aw artifact add *)`, `Bash(aw handoff *)`, `Bash(aw thread *)`, `Bash(aw approach *)`, `Bash(aw ready *)`, `Bash(aw result *)`, `Bash(aw done *)`, `Bash(aw gate open *)`, `Bash(aw task create *)`, `Bash(aw slot acquire *)`, `Bash(aw slot release *)`, `Bash(aw learn *)`, `Bash(aw kb write *)`, `Bash(aw kb search *)`, `Bash(aw kb show *)`, `Bash(aw kb list *)`, `Bash(aw kb context *)`) and `mcp__plugin_aw_aw__*`, so the agent interface never opens the gate "Approve command". A command of a person (`aw gate answer`, `aw task assign`, `aw kb accept`, ...) is not allowed: it opens "Approve command", the CLI refuses it in a session (`phase-1.md` 9.1.6), and awd refuses it to a session caller (`phase-1.md` 5.10). A token lets a session change only its own task, create subtasks of it (`aw task create` in a session is a subtask of the session task; `--assignee` is refused) and read the threads of its parents. In phase 1, `slot_acquire` gives a lease only to a session on the device that has the resource (`phase-1.md` 9.6.12).

A text of AW to a session ("Start implementing", "Result approved" after the answer, "Subtask AW-13 done") is a `message.sent` by `aw@<device>`. The safe delivery (4.3) gives it with the prefix `[AW notice <id>]`, and the session writes it as `message.human` with the source `notice`.

## 9. Files
```
~/AW/acme/                                   3 Syncthing folders per workspace
├── tasks/                                   folder "tasks": all devices
│   ├── workspace.yaml · log/<device>.jsonl  workspace events (also project.removed: phase-1.md 6.9)
│   ├── projects/billing-api/project.yaml    device list, default agent, links, main repo, switches, archived, added_at
│   ├── devices/<device>/heartbeat/<date>.jsonl  1 line per 30 s (writer: that device)
│   ├── devices/<device>/health.yaml         at most once per 60 s (writer: that device)
│   ├── devices/pixel-9/sealed/<id>.age      credentials sealed by the phone
│   └── 0193a7c2-5b1e-…/                     one folder per task, named by the internal id
│       ├── task.yaml                        snapshot with the key AW-12 (writer: the session device)
│       ├── log/macbook-pro.jsonl            events written by the laptop
│       ├── log/ubuntu-01.jsonl              events written by the remote device
│       ├── log/pixel-9.jsonl                events written by the phone
│       ├── approach/v1.md, v2.md
│       └── artifacts/<device>/…             the phone downloads them on request
├── knowledge/                               folder "knowledge": all devices
│   ├── shared/… · projects/billing-api/…
│   └── log/<device>.jsonl
└── secure/                                  folder "secure": local and remote only
    ├── test-servers.yaml
    └── credentials/<name>.age               encrypted with the workspace credential key
~/.aw/                                       never synced: keys, index, sessions/<session-id>/first-input.md
~/.aw/sync-versions/<folder>/                Syncthing "simple" versioning, outside the AW folder
```
1. A key collision never moves a folder, because the folder name is the id. The ready check (4.7) waits only for `knowledge` and `secure`, so the busy logs in `tasks` do not block it.
2. The phone seals a credential to the device keys of all paired computers. A computer imports it into `secure/credentials/`, encrypts it with the workspace credential key and writes `credential.imported`. Then the phone removes its file.

One event is one line:
`{"v":1,"id":"0193a7d4-…","task":"0193a7c2-…","dev":"pixel-9","hlc":"2026-11-22T10:15:03.120Z#0001","type":"gate.answered","data":{"gate":"0193a7d0-…","version":1,"answer":"1000/min"}}`

## 10. Two workflows, the same steps
A team can run AW with its own skill (here the example namespace `my-team:`) or with OpenSpec only. The steps of AW are the same.

| Step | A team skill (`my-team:implement`) | OpenSpec only |
|---|---|---|
| First message | `/my-team:implement Add a rate limit …` | `/opsx:explore Add a rate limit …` |
| Discuss | Questions with `aw ask` | Explore; questions with `aw ask` |
| Questions in the terminal | `AskUserQuestion` and a final question become gates (4.4) | The same |
| Approach | The approach summary of the skill as `approach.md` | The proposal and design summary as `approach.md` |
| Subtasks | Optional | Optional |
| Implement | The implement and test steps of the skill | `/opsx:apply`, `/opsx:verify` |
| Review | The result with its evidence as `result.md` | The verify report as `result.md` |
| Done | The last step of the skill | `/opsx:archive` |

## 11. Verification
The process was verified on a local Mac, the remote test box (Linux, tmux, Orca, Claude Code) and an Android 14 emulator (`feasibility-details.md` section 10). Not tested yet: push wake-up (spike before the phone release), a real remote network and relay, a real lid close, battery use on a Pixel 9, the timeout path of the permission hook.
